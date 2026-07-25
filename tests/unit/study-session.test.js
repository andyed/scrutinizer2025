'use strict';

const {
    SESSION_SUMMARY_SCHEMA,
    resolveTaskRuntimeState,
    buildSessionSummary,
    summaryFileName
} = require('../../shared/study-session');

const SNAPSHOT = Object.freeze({
    radius: 70,
    blur: 10,
    intensity: 0.6,
    enabled: true,
    visualMemory: 5,
    comfortMode: true,
    mode: 12
});

describe('resolveTaskRuntimeState', () => {
    it('layers snapshot ← session defaults ← task overrides', () => {
        const result = resolveTaskRuntimeState(
            SNAPSHOT,
            { mode: 20, foveaRadiusPx: 45 },
            { foveaRadiusPx: 20, visualMemoryLimit: 0 }
        );

        expect(result).toEqual({
            ...SNAPSHOT,
            mode: 20,        // session default wins over snapshot
            radius: 20,      // task override wins over session default
            visualMemory: 0  // task override wins over snapshot
        });
    });

    it('falls through to the snapshot when neither layer overrides', () => {
        expect(resolveTaskRuntimeState(SNAPSHOT, {}, {})).toEqual(SNAPSHOT);
    });
});

function sampleStudy() {
    const t0 = Date.parse('2026-07-19T18:04:22.113Z');
    return {
        session: {
            id: 'nav-study-p04',
            participantId: 'P04',
            defaults: { mode: 12, foveaRadiusPx: 45 }
        },
        tasks: [{}, {}, {}],
        startedAt: t0,
        taskRecords: [
            {
                index: 1,
                taskId: 'find-billing',
                targetUrl: 'https://example.com/',
                finalUrl: 'https://example.com/account/billing',
                startedAtMs: t0 + 1000,
                endedAtMs: t0 + 185220,
                outcome: 'done',
                runtimeState: { ...SNAPSHOT, radius: 45 }
            },
            {
                index: 2,
                taskId: null,
                targetUrl: 'https://example.com/help',
                startedAtMs: t0 + 190000,
                outcome: 'session_ended',
                runtimeState: SNAPSHOT
            }
        ]
    };
}

describe('buildSessionSummary', () => {
    const meta = {
        endReason: 'ended_early',
        endedAt: Date.parse('2026-07-19T18:31:07.902Z'),
        appVersion: '2.9.0',
        platform: 'darwin'
    };

    it('produces the documented schema with per-task records', () => {
        const summary = buildSessionSummary(sampleStudy(), meta);

        expect(summary.schema).toBe(SESSION_SUMMARY_SCHEMA);
        expect(summary).toMatchObject({
            sessionId: 'nav-study-p04',
            participantId: 'P04',
            appVersion: '2.9.0',
            platform: 'darwin',
            startedAt: '2026-07-19T18:04:22.113Z',
            endedAt: '2026-07-19T18:31:07.902Z',
            endReason: 'ended_early',
            taskCount: 3,
            defaults: { mode: 12, foveaRadiusPx: 45 }
        });

        expect(summary.tasks[0]).toEqual({
            index: 1,
            taskId: 'find-billing',
            targetUrl: 'https://example.com/',
            finalUrl: 'https://example.com/account/billing',
            startedAt: '2026-07-19T18:04:23.113Z',
            endedAt: '2026-07-19T18:07:27.333Z',
            durationMs: 184220,
            outcome: 'done',
            settings: {
                mode: 12,
                foveaRadiusPx: 45,
                enabled: true,
                comfortMode: true,
                visualMemoryLimit: 5
            }
        });
    });

    it('leaves unfinished tasks open rather than inventing end data', () => {
        const summary = buildSessionSummary(sampleStudy(), meta);
        expect(summary.tasks[1]).toMatchObject({
            index: 2,
            taskId: null,
            finalUrl: null,
            endedAt: null,
            durationMs: null,
            outcome: 'session_ended'
        });
    });
});

describe('summaryFileName', () => {
    it('uses the session ID and compact UTC stamp', () => {
        const summary = buildSessionSummary(sampleStudy(), {
            endReason: 'completed',
            endedAt: Date.now(),
            appVersion: 'x',
            platform: 'darwin'
        });
        expect(summaryFileName(summary)).toBe('nav-study-p04-20260719T180422Z-summary.json');
    });

    it('falls back to "session" when no session ID was supplied', () => {
        const study = sampleStudy();
        study.session.id = null;
        const summary = buildSessionSummary(study, {
            endReason: 'completed',
            endedAt: Date.now(),
            appVersion: 'x',
            platform: 'darwin'
        });
        expect(summaryFileName(summary)).toMatch(/^session-\d{8}T\d{6}Z-summary\.json$/);
    });
});
