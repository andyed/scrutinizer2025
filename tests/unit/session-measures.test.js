/**
 * Unit tests for shared/session-measures.js
 *
 * The measures module is pure (no Electron, no DOM, no fs) so these run
 * straight through. Load-bearing properties: null-not-NaN on missing data
 * (the WB-1 QC-gate signal), non-finite row skipping, and hand-checkable
 * median/IQR with linear interpolation.
 *
 * Spec: docs/specs/study-workbench-webapp.md (WB-1)
 */

'use strict';

const {
    taskMeasures,
    sessionMeasures,
    aggregateSessions
} = require('../../shared/session-measures');
const { buildEnvelope } = require('../../shared/session-capture');

const WHEN = new Date('2026-07-25T08:15:00.000Z');

/** A 3-4-5 triangle walk: two legs of length 5 each → mouseMilesPx 10. */
function happyTrail() {
    return {
        meta: { dataset: 'scrutinizer', participantId: 'p07', stimulusId: 'pv-001' },
        fixations: [],
        events: [
            { type: 'click', timestamp: 1200, data: {} },
            { type: 'click', timestamp: 2400, data: {} },
            { type: 'key', timestamp: 3000, data: {} },
            { type: 'scroll', timestamp: 3200, data: {} }
        ],
        mouseTimeline: [
            { t: 0, x: 0, y: 0, event: 'mousemove' },
            { t: 16, x: 3, y: 4, event: 'mousemove' },
            { t: 32, x: 6, y: 8, event: 'click' }
        ],
        scrollTimeline: [
            { t: 0, scrollY: 0 },
            { t: 500, scrollY: 640 },
            { t: 900, scrollY: 120 }
        ]
    };
}

function testEnvelope() {
    return buildEnvelope({
        sessionId: 'sess-a',
        participantId: 'p07',
        startedAt: WHEN.toISOString(),
        tasks: [
            {
                taskId: 'billing-navigation',
                durationMs: 42000,
                outcome: 'done',
                settings: {},
                events: [{ type: 'done', t: 42000 }]
            },
            {
                taskId: 'find-support',
                durationMs: 15000,
                outcome: 'quit',
                settings: {},
                events: [{ type: 'quit', t: 15000 }]
            }
        ],
        capture: {
            evtrackVersion: 'abc123',
            pollMs: 16,
            appVersion: '2.8.0',
            platform: 'darwin',
            screen: { w: 1512, h: 982 },
            window: { w: 1280, h: 800 },
            devicePixelRatio: 2
        }
    });
}

describe('taskMeasures', () => {
    test('happy path: outcome, time, mouse miles, counts, scroll range', () => {
        const task = testEnvelope().tasks[0];
        const measures = taskMeasures(task, happyTrail());
        expect(measures).toEqual({
            taskId: 'billing-navigation',
            outcome: 'done',
            success: true,
            timeOnTaskMs: 42000,
            mouseMilesPx: 10,        // 3-4-5 legs: 5 + 5
            mouseMilesDeg: null,     // no ppd given
            clickCount: 2,
            keyEventCount: 1,
            scrollRangePx: 640,      // max 640 - min 0
            trailRowCount: 3
        });
    });

    test('timeOnTaskMs falls back to startedAt/endedAt span, then null', () => {
        const derived = taskMeasures({
            taskId: 't',
            startedAt: WHEN.toISOString(),
            endedAt: new Date(WHEN.getTime() + 5000).toISOString()
        }, happyTrail());
        expect(derived.timeOnTaskMs).toBe(5000);

        const missing = taskMeasures({ taskId: 't' }, happyTrail());
        expect(missing.timeOnTaskMs).toBeNull();
    });

    test('empty trail: zero rows yield nulls, never NaN', () => {
        const measures = taskMeasures(
            { taskId: 't', outcome: 'done' },
            { meta: {}, fixations: [], events: [], mouseTimeline: [], scrollTimeline: [] }
        );
        expect(measures.trailRowCount).toBe(0);
        expect(measures.mouseMilesPx).toBeNull();
        expect(measures.mouseMilesDeg).toBeNull();
        expect(measures.scrollRangePx).toBeNull();
        expect(measures.clickCount).toBe(0); // events array present and empty
        expect(measures.keyEventCount).toBe(0);
        // Explicitly assert nothing leaked NaN into the record.
        for (const value of Object.values(measures)) {
            if (typeof value === 'number') expect(isFinite(value)).toBe(true);
        }
    });

    test('missing trail entirely: counts are null (unknown), not zero', () => {
        const measures = taskMeasures({ taskId: 't', outcome: 'quit' }, undefined);
        expect(measures.trailRowCount).toBe(0);
        expect(measures.mouseMilesPx).toBeNull();
        expect(measures.clickCount).toBeNull();
        expect(measures.keyEventCount).toBeNull();
        expect(measures.scrollRangePx).toBeNull();
        expect(measures.success).toBe(false);
    });

    test('non-finite coordinate rows are skipped, not summed', () => {
        const trail = happyTrail();
        // Splice a glitch row between the two real legs; path must stay 10.
        trail.mouseTimeline.splice(2, 0, { t: 24, x: NaN, y: 5, event: 'mousemove' });
        trail.mouseTimeline.push({ t: 48, x: Infinity, y: 0, event: 'mousemove' });
        const measures = taskMeasures({ taskId: 't' }, trail);
        expect(measures.mouseMilesPx).toBe(10);
        expect(measures.trailRowCount).toBe(5); // raw row count still reports every row

        // All rows non-finite → no motion data at all → null.
        const allBad = taskMeasures({ taskId: 't' }, {
            mouseTimeline: [{ t: 0, x: NaN, y: NaN, event: 'mousemove' }]
        });
        expect(allBad.mouseMilesPx).toBeNull();
    });

    test('ppd converts px path to degrees only when finite and positive', () => {
        const task = { taskId: 't' };
        expect(taskMeasures(task, happyTrail(), { ppd: 25 }).mouseMilesDeg).toBe(0.4); // 10 / 25
        expect(taskMeasures(task, happyTrail(), { ppd: 0 }).mouseMilesDeg).toBeNull();
        expect(taskMeasures(task, happyTrail(), { ppd: -3 }).mouseMilesDeg).toBeNull();
        expect(taskMeasures(task, happyTrail(), { ppd: NaN }).mouseMilesDeg).toBeNull();
        expect(taskMeasures(task, happyTrail(), {}).mouseMilesDeg).toBeNull();
    });
});

describe('sessionMeasures', () => {
    test('happy path: per-task records plus roster totals', () => {
        const envelope = testEnvelope();
        const result = sessionMeasures(
            envelope,
            { 'billing-navigation': happyTrail(), 'find-support': happyTrail() },
            { ppd: 25 }
        );
        expect(result.sessionId).toBe('sess-a');
        expect(result.participantId).toBe('p07');
        expect(result.tasks).toHaveLength(2);
        expect(result.tasks[0].mouseMilesDeg).toBe(0.4);
        expect(result.totals).toEqual({
            taskCount: 2,
            completedCount: 1,       // only billing-navigation is 'done'
            totalTimeMs: 57000,      // 42000 + 15000
            totalMouseMilesPx: 20    // 10 + 10
        });
    });

    test('task missing from trailsByTaskId gets trailRowCount 0 and null motion — no throw', () => {
        const envelope = testEnvelope();
        const result = sessionMeasures(envelope, { 'billing-navigation': happyTrail() });
        const orphan = result.tasks[1];
        expect(orphan.taskId).toBe('find-support');
        expect(orphan.trailRowCount).toBe(0); // the QC-gate signal: tracker never ran
        expect(orphan.mouseMilesPx).toBeNull();
        expect(orphan.clickCount).toBeNull();
        // Totals exclude the null, not treat it as zero.
        expect(result.totals.totalMouseMilesPx).toBe(10);
    });

    test('no trails map at all still yields a full record', () => {
        const result = sessionMeasures(testEnvelope(), undefined);
        expect(result.tasks).toHaveLength(2);
        expect(result.totals.totalMouseMilesPx).toBe(0);
        expect(result.tasks.every(task => task.trailRowCount === 0)).toBe(true);
    });
});

describe('aggregateSessions', () => {
    /** One session with a single task carrying the given measures. */
    function sessionWith(taskId, overrides) {
        return {
            sessionId: 's',
            participantId: 'p',
            tasks: [Object.assign({
                taskId,
                outcome: 'done',
                success: true,
                timeOnTaskMs: null,
                mouseMilesPx: null,
                mouseMilesDeg: null,
                clickCount: null,
                keyEventCount: null,
                scrollRangePx: null,
                trailRowCount: 0
            }, overrides)],
            totals: { taskCount: 1, completedCount: 1, totalTimeMs: 0, totalMouseMilesPx: 0 }
        };
    }

    test('median and IQR by linear interpolation on a hand-computed example', () => {
        // timeOnTaskMs values 10, 20, 30, 40 (even n):
        //   median = (20+30)/2 = 25
        //   q1 at index 0.75 → 10 + 0.75*(20-10) = 17.5
        //   q3 at index 2.25 → 30 + 0.25*(40-30) = 32.5
        //   IQR = 15
        const sessions = [10, 20, 30, 40].map(ms =>
            sessionWith('t1', { timeOnTaskMs: ms, clickCount: 3, mouseMilesPx: ms * 2 }));
        const [agg] = aggregateSessions(sessions);
        expect(agg.taskId).toBe('t1');
        expect(agg.n).toBe(4);
        expect(agg.successRate).toBe(1);
        expect(agg.timeOnTaskMs).toEqual({ median: 25, iqr: 15, n: 4, nExcluded: 0 });
        // Odd n after scaling: mouseMilesPx = [20, 40, 60, 80] → same shape, ×2.
        expect(agg.mouseMilesPx).toEqual({ median: 50, iqr: 30, n: 4, nExcluded: 0 });
        expect(agg.clickCount).toEqual({ median: 3, iqr: 0, n: 4, nExcluded: 0 });
    });

    test('excludes nulls from stats and reports nExcluded', () => {
        const sessions = [
            sessionWith('t1', { timeOnTaskMs: 100, clickCount: 2, success: true }),
            sessionWith('t1', { timeOnTaskMs: 300, clickCount: null, success: false, outcome: 'quit' }),
            sessionWith('t1', { timeOnTaskMs: null, clickCount: 4, success: true })
        ];
        const [agg] = aggregateSessions(sessions);
        expect(agg.n).toBe(3);
        expect(agg.successRate).toBeCloseTo(2 / 3, 12);
        // Nulls excluded from the order statistics, counted in nExcluded.
        expect(agg.timeOnTaskMs).toEqual({ median: 200, iqr: 100, n: 2, nExcluded: 1 });
        expect(agg.clickCount).toEqual({ median: 3, iqr: 1, n: 2, nExcluded: 1 });
    });

    test('all-null measure yields null median/iqr, never NaN', () => {
        const [agg] = aggregateSessions([sessionWith('t1', {}), sessionWith('t1', {})]);
        expect(agg.timeOnTaskMs).toEqual({ median: null, iqr: null, n: 0, nExcluded: 2 });
        expect(agg.mouseMilesPx.median).toBeNull();
    });

    test('groups per taskId in first-seen order across sessions', () => {
        const s1 = {
            tasks: [
                sessionWith('alpha', { timeOnTaskMs: 1 }).tasks[0],
                sessionWith('beta', { timeOnTaskMs: 2 }).tasks[0]
            ]
        };
        const s2 = {
            tasks: [
                sessionWith('beta', { timeOnTaskMs: 4 }).tasks[0],
                sessionWith('alpha', { timeOnTaskMs: 3 }).tasks[0]
            ]
        };
        const aggregates = aggregateSessions([s1, s2]);
        expect(aggregates.map(record => record.taskId)).toEqual(['alpha', 'beta']);
        expect(aggregates[0].timeOnTaskMs.median).toBe(2); // alpha: (1+3)/2
        expect(aggregates[1].timeOnTaskMs.median).toBe(3); // beta: (2+4)/2
        expect(aggregates[0].n).toBe(2);
    });

    test('empty input aggregates to an empty list', () => {
        expect(aggregateSessions([])).toEqual([]);
        expect(aggregateSessions(undefined)).toEqual([]);
    });
});
