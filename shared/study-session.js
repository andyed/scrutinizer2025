'use strict';

const { buildStudyRuntimeState } = require('./study-runtime-state');

const SESSION_SUMMARY_SCHEMA = 'scrutinizer-session-summary/1';

// Resolution order per task: user runtime snapshot ← session defaults ← task
// overrides (spec: usability-study-multi-task-sessions.md §Runtime behavior).
function resolveTaskRuntimeState(snapshot, sessionDefaults, taskOverrides) {
    return buildStudyRuntimeState(buildStudyRuntimeState(snapshot, sessionDefaults), taskOverrides);
}

// The summary records the deep-link vocabulary (foveaRadiusPx,
// visualMemoryLimit), not the internal runtime field names.
function summarySettings(runtimeState) {
    return {
        mode: runtimeState.mode,
        foveaRadiusPx: runtimeState.radius,
        enabled: runtimeState.enabled,
        comfortMode: runtimeState.comfortMode,
        visualMemoryLimit: runtimeState.visualMemory
    };
}

function buildSessionSummary(study, { endReason, endedAt, appVersion, platform }) {
    return {
        schema: SESSION_SUMMARY_SCHEMA,
        sessionId: study.session.id,
        participantId: study.session.participantId,
        appVersion,
        platform,
        startedAt: new Date(study.startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        endReason,
        taskCount: study.tasks.length,
        defaults: study.session.defaults,
        tasks: study.taskRecords.map((record) => ({
            index: record.index,
            taskId: record.taskId,
            targetUrl: record.targetUrl,
            finalUrl: record.finalUrl !== undefined ? record.finalUrl : null,
            startedAt: new Date(record.startedAtMs).toISOString(),
            endedAt: record.endedAtMs !== undefined ? new Date(record.endedAtMs).toISOString() : null,
            durationMs: record.endedAtMs !== undefined ? Math.max(0, record.endedAtMs - record.startedAtMs) : null,
            outcome: record.outcome,
            settings: summarySettings(record.runtimeState)
        }))
    };
}

// <session_id or 'session'>-<compact UTC start stamp>-summary.json
function summaryFileName(summary) {
    const id = summary.sessionId || 'session';
    const stamp = summary.startedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    return `${id}-${stamp}-summary.json`;
}

module.exports = {
    SESSION_SUMMARY_SCHEMA,
    resolveTaskRuntimeState,
    buildSessionSummary,
    summaryFileName
};
