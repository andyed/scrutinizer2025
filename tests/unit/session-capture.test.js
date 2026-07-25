/**
 * Unit tests for shared/session-capture.js
 *
 * The envelope writer is pure (no Electron, no DOM, no fs), so these run
 * straight through. The load-bearing property is the superset relationship with
 * the shipped `scrutinizer-session-summary/1` record: a summary consumer must be
 * able to read a capture envelope unchanged.
 *
 * Spec: docs/specs/session-capture-procedural-replay.md
 */

'use strict';

const {
    buildEnvelope,
    envelopeFileName,
    validateEnvelope,
    toSummary,
    summaryFileName,
    sessionDirName,
    trailFileName,
    stimulusFileName,
    coordinateContract,
    utcStamp,
    CAPTURE_SCHEMA,
    SUMMARY_SCHEMA,
    SUMMARY_KEYS,
    ENVELOPE_BASENAME
} = require('../../shared/session-capture');

const WHEN = new Date('2026-07-25T08:15:00.000Z');

function validInput(overrides = {}) {
    return Object.assign({
        sessionId: 'sess-2026-07-25-a',
        participantId: 'p07',
        startedAt: WHEN.toISOString(),
        defaults: { radius: 60, mode: 12, enabled: true },
        tasks: [
            {
                taskId: 'billing-navigation',
                instructions: 'Where would you go to change your billing address?',
                startedAt: WHEN.toISOString(),
                durationMs: 42000,
                settings: { fovea_radius_px: 45, mode: 12, visual_memory_limit: 5 },
                events: [
                    { type: 'comment', t: 12000, comment: 'I cannot read the sidebar' },
                    { type: 'done', t: 42000 }
                ]
            },
            {
                taskId: 'find-support',
                settings: { fovea_radius_px: 45, mode: 0 },
                events: [{ type: 'quit', t: 15000 }]
            }
        ],
        capture: {
            evtrackVersion: 'cabb3b7ccfecee72a8970592642c86881a8fd437',
            pollMs: 16,
            appVersion: '2.8.0',
            platform: 'darwin',
            screen: { w: 1512, h: 982 },
            window: { w: 1280, h: 800 },
            devicePixelRatio: 2
        },
        pageVisits: [
            {
                pageVisitId: 'pv-001',
                taskId: 'billing-navigation',
                url: 'https://example.com/account',
                tStart: 0,
                tEnd: 42000,
                screenshot: 'stimuli/pv-001.png',
                stimulusWidth: 1280,
                stimulusHeight: 4210
            }
        ]
    }, overrides);
}

describe('buildEnvelope', () => {
    it('stamps the capture schema and derives taskCount', () => {
        const envelope = buildEnvelope(validInput());
        expect(envelope.schema).toBe(CAPTURE_SCHEMA);
        expect(envelope.extendsSchema).toBe(SUMMARY_SCHEMA);
        expect(envelope.taskCount).toBe(2);
    });

    it('carries the capture block: evtrack version, pollMs, DPR, screen, window', () => {
        const { capture } = buildEnvelope(validInput());
        expect(capture).toEqual({
            schema: CAPTURE_SCHEMA,
            evtrackVersion: 'cabb3b7ccfecee72a8970592642c86881a8fd437',
            pollMs: 16,
            appVersion: '2.8.0',
            platform: 'darwin',
            screen: { w: 1512, h: 982 },
            window: { w: 1280, h: 800 },
            devicePixelRatio: 2,
            health: null
        });
    });

    it('preserves a serializable capture-readiness snapshot', () => {
        const envelope = buildEnvelope(validInput({
            capture: Object.assign({}, validInput().capture, {
                health: {
                    status: 'stopped',
                    code: null,
                    message: null,
                    rowCount: 312,
                    taskId: 'billing-navigation',
                    pollMs: 16,
                    trackerSource: 'commonjs-host-bound',
                    trackerBinding: {
                        hostBound: true,
                        attached: true,
                        documentListeners: 14,
                        windowListeners: 4
                    }
                }
            })
        }));

        expect(envelope.capture.health).toEqual({
            status: 'stopped',
            code: null,
            message: null,
            rowCount: 312,
            taskId: 'billing-navigation',
            pollMs: 16,
            trackerSource: 'commonjs-host-bound',
            trackerBinding: {
                hostBound: true,
                attached: true,
                documentListeners: 14,
                windowListeners: 4
            }
        });
        expect(validateEnvelope(envelope).ok).toBe(true);
    });

    it('derives the coordinate contract from the capture DPR', () => {
        const { coordinates } = buildEnvelope(validInput());
        expect(coordinates.trailSpace).toBe('client-viewport-css-px');
        expect(coordinates.devicePixelRatio).toBe(2);
        expect(coordinates.pageSpace).toContain('scrollY');
        expect(coordinates.screenshotSpace).toContain('devicePixelRatio');
        expect(coordinates.reference).toBe('docs/adserp-coordinate-system.md');
    });

    it('lets an explicit coordinates block override the derived one', () => {
        const envelope = buildEnvelope(validInput({
            coordinates: { trailSpace: 'page-css-px' }
        }));
        expect(envelope.coordinates.trailSpace).toBe('page-css-px');
        expect(envelope.coordinates.devicePixelRatio).toBe(2);  // still derived
    });

    it('keeps per-task Done/Quit/Comment events with their text', () => {
        const [first, second] = buildEnvelope(validInput()).tasks;
        expect(first.events).toEqual([
            { type: 'comment', t: 12000, at: null, comment: 'I cannot read the sidebar' },
            { type: 'done', t: 42000, at: null }
        ]);
        expect(second.events[0].type).toBe('quit');
    });

    it('preserves non-summary task fields and defaults missing settings/events', () => {
        const envelope = buildEnvelope(validInput({
            tasks: [{ taskId: 'bare', durationMs: 5 }]
        }));
        expect(envelope.tasks[0].durationMs).toBe(5);
        expect(envelope.tasks[0].settings).toEqual({});
        expect(envelope.tasks[0].events).toEqual([]);
    });

    it('indexes page visits and infers the screenshot path when absent', () => {
        const envelope = buildEnvelope(validInput({
            pageVisits: [{
                pageVisitId: 'pv-002',
                taskId: 'find-support',
                url: 'https://example.com/help',
                tStart: 100,
                tEnd: 900,
                stimulusWidth: 1280,
                stimulusHeight: 2000
            }]
        }));
        expect(envelope.pageVisits[0].screenshot).toBe('stimuli/pv-002.png');
    });

    it('tolerates an empty input without throwing', () => {
        const envelope = buildEnvelope();
        expect(envelope.schema).toBe(CAPTURE_SCHEMA);
        expect(envelope.taskCount).toBe(0);
        expect(envelope.tasks).toEqual([]);
        expect(envelope.pageVisits).toEqual([]);
    });

    it('is JSON round-trippable', () => {
        const envelope = buildEnvelope(validInput());
        expect(JSON.parse(JSON.stringify(envelope))).toEqual(envelope);
    });
});

describe('superset of scrutinizer-session-summary/1', () => {
    it('carries every top-level summary key', () => {
        const envelope = buildEnvelope(validInput());
        for (const key of SUMMARY_KEYS) {
            expect(Object.prototype.hasOwnProperty.call(envelope, key)).toBe(true);
        }
    });

    it('adds exactly the capture blocks on top of the summary keys', () => {
        const envelope = buildEnvelope(validInput());
        const added = Object.keys(envelope).filter(key => SUMMARY_KEYS.indexOf(key) === -1);
        expect(added.sort()).toEqual(['capture', 'coordinates', 'extendsSchema', 'pageVisits']);
    });

    it('every task carries the summary task keys, plus events', () => {
        for (const task of buildEnvelope(validInput()).tasks) {
            expect(typeof task.taskId).toBe('string');
            expect(typeof task.settings).toBe('object');
            expect(Array.isArray(task.events)).toBe(true);
        }
    });

    it('toSummary() projects back to the summary shape', () => {
        const envelope = buildEnvelope(validInput());
        const summary = toSummary(envelope);

        expect(Object.keys(summary).sort()).toEqual([...SUMMARY_KEYS].sort());
        expect(summary.schema).toBe(SUMMARY_SCHEMA);
        expect(summary.sessionId).toBe(envelope.sessionId);
        expect(summary.participantId).toBe(envelope.participantId);
        expect(summary.taskCount).toBe(envelope.taskCount);
        expect(summary.tasks[0].settings).toEqual(envelope.tasks[0].settings);
        // The CIF event trail is a capture-only addition.
        expect(summary.tasks[0].events).toBeUndefined();
    });

    it('the projected summary preserves every summary-visible task value', () => {
        const envelope = buildEnvelope(validInput());
        const summary = toSummary(envelope);
        expect(summary.tasks[0].taskId).toBe('billing-navigation');
        expect(summary.tasks[0].durationMs).toBe(42000);
    });
});

describe('validateEnvelope', () => {
    it('accepts a well-formed envelope', () => {
        expect(validateEnvelope(buildEnvelope(validInput()))).toEqual({ ok: true, errors: [] });
    });

    it('rejects a non-object', () => {
        expect(validateEnvelope(null).ok).toBe(false);
        expect(validateEnvelope('nope').errors[0]).toMatch(/expected an object/);
    });

    it('catches a missing devicePixelRatio in the capture block', () => {
        const envelope = buildEnvelope(validInput({
            capture: Object.assign({}, validInput().capture, { devicePixelRatio: undefined })
        }));
        const result = validateEnvelope(envelope);
        expect(result.ok).toBe(false);
        expect(result.errors.join('\n')).toMatch(/capture\.devicePixelRatio/);
    });

    it('catches a missing coordinates block', () => {
        const envelope = buildEnvelope(validInput());
        delete envelope.coordinates;
        const result = validateEnvelope(envelope);
        expect(result.ok).toBe(false);
        expect(result.errors.join('\n')).toMatch(/coordinates: expected an object/);
    });

    it('catches an incomplete coordinate contract', () => {
        const envelope = buildEnvelope(validInput());
        delete envelope.coordinates.screenshotSpace;
        expect(validateEnvelope(envelope).errors.join('\n')).toMatch(/coordinates\.screenshotSpace/);
    });

    it('catches a DPR that disagrees between capture and coordinates', () => {
        const envelope = buildEnvelope(validInput());
        envelope.coordinates.devicePixelRatio = 1;
        expect(validateEnvelope(envelope).errors.join('\n')).toMatch(/disagrees with capture/);
    });

    it('catches missing summary keys (the superset contract)', () => {
        const envelope = buildEnvelope(validInput());
        delete envelope.participantId;
        delete envelope.defaults;
        const errors = validateEnvelope(envelope).errors.join('\n');
        expect(errors).toMatch(/missing summary key: participantId/);
        expect(errors).toMatch(/missing summary key: defaults/);
    });

    it('catches a taskCount that disagrees with tasks.length', () => {
        const envelope = buildEnvelope(validInput());
        envelope.taskCount = 5;
        expect(validateEnvelope(envelope).errors.join('\n')).toMatch(/taskCount: 5 does not match/);
    });

    it('catches a bad task-event type and a comment without text', () => {
        const envelope = buildEnvelope(validInput({
            tasks: [{
                taskId: 'x',
                settings: {},
                events: [{ type: 'abandoned', t: 1 }, { type: 'comment', t: 2 }]
            }]
        }));
        envelope.tasks[0].events[1].comment = 42;
        const errors = validateEnvelope(envelope).errors.join('\n');
        expect(errors).toMatch(/events\[0\]\.type/);
        expect(errors).toMatch(/events\[1\]\.comment/);
    });

    it('accepts the instrument outcome vocabulary, and null while a task is open', () => {
        for (const outcome of ['done', 'session_ended', null]) {
            const envelope = buildEnvelope(validInput({
                tasks: [{
                    taskId: 'billing-navigation',
                    outcome,
                    settings: {},
                    events: [{ type: 'done', t: 1000 }]
                }]
            }));
            expect(validateEnvelope(envelope)).toEqual({ ok: true, errors: [] });
        }
    });

    it('catches off-vocabulary task outcomes (e.g. "completed", "quit")', () => {
        // closeOpenTaskRecord() only ever writes done/session_ended; anything
        // else has no defined procedural meaning in session-measures.
        for (const outcome of ['completed', 'quit', 'timeout']) {
            const envelope = buildEnvelope(validInput());
            envelope.tasks[0].outcome = outcome;
            const errors = validateEnvelope(envelope).errors.join('\n');
            expect(errors).toMatch(/tasks\[0\]\.outcome: expected null or one of done\|session_ended/);
        }
    });

    it('catches a task event with neither t nor at', () => {
        const envelope = buildEnvelope(validInput({
            tasks: [{ taskId: 'x', settings: {}, events: [{ type: 'done' }] }]
        }));
        expect(validateEnvelope(envelope).errors.join('\n')).toMatch(/needs a finite t or an ISO at/);
    });

    it('accepts a task event stamped with an ISO time instead of ms', () => {
        const envelope = buildEnvelope(validInput({
            tasks: [{ taskId: 'x', settings: {}, events: [{ type: 'done', at: WHEN.toISOString() }] }],
            pageVisits: []
        }));
        expect(validateEnvelope(envelope).ok).toBe(true);
    });

    it('catches an unparseable startedAt', () => {
        const envelope = buildEnvelope(validInput({ startedAt: 'last tuesday' }));
        expect(validateEnvelope(envelope).errors.join('\n')).toMatch(/startedAt/);
    });

    it('catches an incomplete stimulus anchor', () => {
        const envelope = buildEnvelope(validInput({
            pageVisits: [{ pageVisitId: 'pv-9', taskId: 'billing-navigation' }]
        }));
        const errors = validateEnvelope(envelope).errors.join('\n');
        expect(errors).toMatch(/pageVisits\[0\]\.url/);
        expect(errors).toMatch(/pageVisits\[0\]\.tStart/);
        expect(errors).toMatch(/stimulusWidth/);
    });

    it('catches a page visit pointing at an unknown task', () => {
        const envelope = buildEnvelope(validInput({
            pageVisits: [{
                pageVisitId: 'pv-1',
                taskId: 'no-such-task',
                url: 'https://example.com/',
                tStart: 0,
                tEnd: 1,
                stimulusWidth: 1,
                stimulusHeight: 1
            }]
        }));
        expect(validateEnvelope(envelope).errors.join('\n')).toMatch(/matches no task/);
    });

    it('catches a missing evtrack version', () => {
        const envelope = buildEnvelope(validInput({
            capture: Object.assign({}, validInput().capture, { evtrackVersion: undefined })
        }));
        expect(validateEnvelope(envelope).errors.join('\n')).toMatch(/capture\.evtrackVersion/);
    });

    it('catches malformed capture-health diagnostics', () => {
        const envelope = buildEnvelope(validInput({
            capture: Object.assign({}, validInput().capture, {
                health: {
                    status: 'probably-fine',
                    rowCount: -1,
                    pollMs: -5
                }
            })
        }));
        const errors = validateEnvelope(envelope).errors.join('\n');
        expect(errors).toMatch(/capture\.health\.status/);
        expect(errors).toMatch(/capture\.health\.rowCount/);
        expect(errors).toMatch(/capture\.health\.pollMs/);
    });
});

describe('filename conventions', () => {
    it('uses <session_id>-<compact UTC stamp> for the session directory', () => {
        expect(sessionDirName('sess-2026-07-25-a', WHEN)).toBe('sess-2026-07-25-a-20260725T081500Z');
    });

    it('mirrors the summary convention for the envelope filename', () => {
        expect(summaryFileName('sess1', WHEN)).toBe('sess1-20260725T081500Z-summary.json');
        expect(envelopeFileName('sess1', WHEN)).toBe('sess1-20260725T081500Z-capture.json');
    });

    it("falls back to 'session' when there is no session id", () => {
        expect(envelopeFileName('', WHEN)).toBe('session-20260725T081500Z-capture.json');
        expect(envelopeFileName(null, WHEN)).toBe('session-20260725T081500Z-capture.json');
        expect(envelopeFileName(undefined, WHEN)).toBe('session-20260725T081500Z-capture.json');
    });

    it('sanitizes ids that would escape the session directory', () => {
        expect(envelopeFileName('../../etc/passwd', WHEN))
            .toBe('etc-passwd-20260725T081500Z-capture.json');
        expect(trailFileName('a/b c')).toBe('trail-a-b-c.json');
        expect(stimulusFileName('../pv 1')).toBe('stimuli/pv-1.png');
    });

    it('accepts an ISO string or epoch ms for the stamp', () => {
        expect(utcStamp('2026-07-25T08:15:00.000Z')).toBe('20260725T081500Z');
        expect(utcStamp(WHEN.getTime())).toBe('20260725T081500Z');
        expect(utcStamp('not a date')).toBe('19700101T000000Z');
    });

    it('names the per-task trail and the in-directory envelope per the spec layout', () => {
        expect(trailFileName('billing-navigation')).toBe('trail-billing-navigation.json');
        expect(ENVELOPE_BASENAME).toBe('envelope.json');
    });
});

describe('coordinateContract', () => {
    it('defaults a missing or nonsensical DPR to 1', () => {
        expect(coordinateContract(undefined).devicePixelRatio).toBe(1);
        expect(coordinateContract(0).devicePixelRatio).toBe(1);
        expect(coordinateContract(NaN).devicePixelRatio).toBe(1);
    });

    it('states all three spaces plus the fixation caveat', () => {
        const contract = coordinateContract(2);
        expect(contract.trailSpace).toBe('client-viewport-css-px');
        expect(contract.pageSpace).toMatch(/yPage/);
        expect(contract.screenshotSpace).toMatch(/yShot/);
        expect(contract.fixationSpace).toMatch(/physical canvas px/);
    });
});

// Reconciliation guard (2026-07-25): the superset contract is checked against
// the REAL shipped summary builder, not a reproduced key list, so the two
// modules cannot drift silently. See shared/study-session.js.
describe('superset contract vs shared/study-session.js', () => {
    const { buildSessionSummary, SESSION_SUMMARY_SCHEMA } = require('../../shared/study-session');
    const { SUMMARY_TASK_KEYS } = require('../../shared/session-capture');

    function realSummary() {
        const startedAtMs = WHEN.getTime();
        return buildSessionSummary({
            session: { id: 'sess-2026-07-25-a', participantId: 'p07', defaults: {} },
            startedAt: startedAtMs,
            tasks: [{}],
            taskRecords: [{
                index: 0,
                taskId: 'find-price',
                targetUrl: 'https://example.test/',
                finalUrl: null,
                startedAtMs,
                endedAtMs: startedAtMs + 1000,
                outcome: 'done',
                runtimeState: { mode: 12, radius: 100, enabled: true, comfortMode: false, visualMemory: 0 }
            }]
        }, { endReason: 'completed', endedAt: startedAtMs + 2000, appVersion: '0.0.0-test', platform: 'test' });
    }

    test('SUMMARY_SCHEMA is the study-session constant', () => {
        expect(SUMMARY_SCHEMA).toBe(SESSION_SUMMARY_SCHEMA);
    });

    test('SUMMARY_KEYS / SUMMARY_TASK_KEYS match the real builder output exactly', () => {
        const summary = realSummary();
        expect([...SUMMARY_KEYS].sort()).toEqual(Object.keys(summary).sort());
        expect([...SUMMARY_TASK_KEYS].sort()).toEqual(Object.keys(summary.tasks[0]).sort());
    });

    test('a built envelope carries every real summary key, top-level and per-task', () => {
        const summary = realSummary();
        const envelope = buildEnvelope(validInput());
        for (const key of Object.keys(summary)) {
            expect(Object.prototype.hasOwnProperty.call(envelope, key)).toBe(true);
        }
        for (const key of Object.keys(summary.tasks[0])) {
            expect(Object.prototype.hasOwnProperty.call(envelope.tasks[0], key)).toBe(true);
        }
    });

    test('toSummary projects to exactly the real summary key set', () => {
        const summary = realSummary();
        const projected = toSummary(buildEnvelope(validInput()));
        expect(Object.keys(projected).sort()).toEqual(Object.keys(summary).sort());
        expect(Object.keys(projected.tasks[0]).sort()).toEqual(Object.keys(summary.tasks[0]).sort());
        expect(projected.schema).toBe(SESSION_SUMMARY_SCHEMA);
    });
});
