'use strict';

const { PNG } = require('pngjs');
const { captureReadinessProblems, validateStimulusImage } = require('../../shared/session-capture');
const { rowsToScanpathData } = require('../../renderer/instrumentation/event-capture');

function evidence() {
    const health = { status: 'stopped', code: null, rowCount: 2, taskId: 'one', pollMs: 16, deliveryFailureCount: 0 };
    // Exercise real adapter output, including a key row without pointer coords.
    const trail = rowsToScanpathData([
        { t: 0, x: 10, y: 20, scrollY: 0, event: 'mousemove' },
        { t: 16, x: null, y: null, scrollY: 0, event: 'keydown', masked: true }
    ], { taskId: 'one', pollMs: 16, captureHealth: { ...health } });
    const envelope = {
        capture: { pollMs: 16, health: { ...health, taskId: null } },
        tasks: [{ taskId: 'one', captureHealth: { ...health } }]
    };
    return { envelope, trails: { one: trail } };
}

function problems(mutator) {
    const sample = evidence();
    mutator(sample);
    return captureReadinessProblems(sample.envelope, sample.trails);
}

test('real adapter output accepts raw-row health counts, not pointer-only counts', () => {
    expect(problems(() => {})).toEqual([]);
});

test('legacy files without readiness metadata remain admissible', () => {
    expect(problems(({ envelope, trails }) => {
        delete envelope.capture.health;
        delete envelope.tasks[0].captureHealth;
        delete trails.one.meta.captureHealth;
        delete trails.one.meta.taskId;
        delete trails.one.meta.pollMs;
    })).toEqual([]);
});

test.each([
    ['empty', t => { t.mouseTimeline = []; }],
    ['nonempty malformed', t => { t.mouseTimeline = [{}]; }],
    ['nonfinite coordinate', t => { t.mouseTimeline[0].x = Infinity; }],
    ['negative timestamp', t => { t.mouseTimeline[0].t = -1; }],
    ['string timestamp', t => { t.mouseTimeline[0].t = '0'; }],
    ['missing event name', t => { delete t.mouseTimeline[0].event; }],
    ['unordered scroll', t => { t.scrollTimeline.reverse(); }],
    ['bad scroll coordinate', t => { t.scrollTimeline[0].scrollY = '0'; }],
    ['bad event type', t => { t.events[0].type = 'made-up'; }],
    ['bad event time', t => { t.events[0].timestamp = NaN; }],
    ['bad event payload', t => { t.events[0].data.x = 'x'; }],
    ['missing event array', t => { delete t.events; }],
    ['wrong task', t => { t.meta.taskId = 'two'; }],
    ['wrong poll interval', t => { t.meta.pollMs = 250; }],
    ['trail health failed', t => { t.meta.captureHealth.status = 'failed'; }],
    ['trail health incomplete', t => { t.meta.captureHealth.status = 'recording'; }],
    ['trail health row mismatch', t => { t.meta.captureHealth.rowCount = 100; }],
    ['trail health delivery failure', t => { t.meta.captureHealth.deliveryFailureCount = 1; }]
])('%s blocks admission', (_label, mutate) => {
    expect(problems(({ trails }) => mutate(trails.one)).length).toBeGreaterThan(0);
});

test('failed per-task health blocks despite a healthy aggregate and trail', () => {
    expect(problems(({ envelope }) => { envelope.tasks[0].captureHealth.status = 'failed'; }))
        .toEqual(expect.arrayContaining([expect.stringMatching(/task "one".captureHealth: capture failed/)]));
});

test('aggregate retained row count must agree with all task streams', () => {
    expect(problems(({ envelope }) => { envelope.capture.health.rowCount = 1; }))
        .toEqual(expect.arrayContaining([expect.stringMatching(/capture.health.rowCount: 1 disagrees with 2/)]));
});

test('missing task trails are rejected even without a file-loading diagnostic', () => {
    expect(problems(({ trails }) => { delete trails.one; }))
        .toEqual(expect.arrayContaining([expect.stringMatching(/missing input trail/)]));
});

test('colliding filesystem task names cannot alias the same trail', () => {
    expect(problems(({ envelope, trails }) => {
        envelope.tasks.push({ taskId: '..one' });
        trails['..one'] = trails.one;
    })).toEqual(expect.arrayContaining([expect.stringMatching(/duplicate task identity or trail filename/)]));
});

const visit = { screenshot: 'stimuli/one.png', stimulusWidth: 3, stimulusHeight: 2 };
const decode = async bytes => PNG.sync.read(Buffer.from(bytes));
const png = PNG.sync.write(new PNG({ width: 3, height: 2 }));

test('real PNG decoding accepts matching declared dimensions', async () => {
    await expect(validateStimulusImage(png, visit, decode)).resolves.toEqual([]);
});

test('PNG magic alone does not admit a truncated image', async () => {
    const result = await validateStimulusImage(png.subarray(0, 24), visit, decode);
    expect(result[0]).toMatch(/could not be decoded/);
});

test('corrupt PNG payload fails decoding', async () => {
    const corrupt = Buffer.from(png);
    corrupt[45] ^= 255;
    expect((await validateStimulusImage(corrupt, visit, decode))[0]).toMatch(/could not be decoded/);
});

test('wrong image type is rejected before decoding', async () => {
    const decoder = jest.fn();
    expect((await validateStimulusImage(Buffer.from('not png'), visit, decoder))[0]).toMatch(/not a PNG/);
    expect(decoder).not.toHaveBeenCalled();
});

test('decoded dimensions must match the envelope', async () => {
    expect((await validateStimulusImage(png, { ...visit, stimulusWidth: 30 }, decode))[0])
        .toMatch(/decoded 3×2 pixels disagree with declared 30×2/);
});

test('decoder failures are actionable admission errors', async () => {
    expect((await validateStimulusImage(png, visit, async () => { throw new Error('decode failed'); }))[0])
        .toMatch(/PNG could not be decoded \(decode failed\)/);
});
