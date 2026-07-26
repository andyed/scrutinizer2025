'use strict';

/**
 * Session-capture envelope (`scrutinizer-session-capture/1`).
 *
 * Pure module — no Electron, no DOM, no filesystem — so the envelope can be
 * built and validated headlessly. The Electron lifecycle and atomic on-disk
 * publication live in main.js and shared/session-directory-writer.js.
 *
 * Spec: docs/specs/session-capture-procedural-replay.md
 *
 * The envelope is a strict superset of the shipped
 * `scrutinizer-session-summary/1` record: every key of the summary is present
 * with the same meaning, and the capture envelope adds `capture`, `coordinates`,
 * `pageVisits` and per-task `events`. `toSummary()` projects an envelope back
 * down to the summary shape, which is what makes the superset claim checkable.
 *
 * On-disk layout the envelope describes:
 *
 *   <sessionDirName()>/
 *     envelope.json            this record
 *     trail-<taskId>.json      ScanpathData per task
 *     stimuli/<pageVisitId>.png
 */

const { SESSION_SUMMARY_SCHEMA } = require('./study-session');

const CAPTURE_SCHEMA = 'scrutinizer-session-capture/1';
const SUMMARY_SCHEMA = SESSION_SUMMARY_SCHEMA;

/** Canonical name of the envelope inside a session directory. */
const ENVELOPE_BASENAME = 'envelope.json';

/**
 * Top-level keys the summary schema defines; the envelope must carry them all.
 * Mirrors buildSessionSummary() in shared/study-session.js — keep in sync.
 */
const SUMMARY_KEYS = [
    'schema', 'sessionId', 'participantId', 'appVersion', 'platform',
    'startedAt', 'endedAt', 'endReason', 'taskCount', 'defaults', 'tasks'
];

/** Per-task keys the summary schema defines (buildSessionSummary task records). */
const SUMMARY_TASK_KEYS = [
    'index', 'taskId', 'targetUrl', 'finalUrl', 'startedAt', 'endedAt',
    'durationMs', 'outcome', 'settings'
];

/** Task-level CIF events (spec §envelope.json: "Done / Quit / Comment"). */
const TASK_EVENT_TYPES = ['done', 'quit', 'comment'];

/**
 * Task outcome vocabulary the instrument writes
 * (docs/specs/usability-study-multi-task-sessions.md): 'done' (Done pressed)
 * or 'session_ended' (session terminated early during this task). null while
 * the task record is still open. `done` is a procedural completion signal,
 * not an analyst-adjudicated claim that the task goal was achieved. Note this
 * is distinct from the summary-level `endReason` vocabulary and from the
 * 'quit' *event* type above — a participant giving up is a Quit event inside
 * a task whose outcome is still done/session_ended/null.
 */
const TASK_OUTCOMES = ['done', 'session_ended'];
const CAPTURE_HEALTH_STATUSES = [
    'idle', 'awaiting_first_row', 'recording', 'stopped', 'empty', 'failed'
];

const SAFE_NAME = /[^A-Za-z0-9._-]+/g;

function finite(value) {
    return typeof value === 'number' && isFinite(value);
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Filesystem-safe fragment; never empty. Collapses `..` and trims leading or
 * trailing separators so an id can never walk out of the session directory.
 */
function slug(value, fallback) {
    const raw = value === undefined || value === null ? '' : String(value);
    const cleaned = raw.trim()
        .replace(SAFE_NAME, '-')
        .replace(/\.{2,}/g, '.')
        .replace(/^[-.]+|[-.]+$/g, '');
    return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Compact UTC stamp, e.g. `20260725T081500Z`.
 * @param {Date|string|number} [when]
 * @returns {string}
 */
function utcStamp(when) {
    const date = when instanceof Date ? when : new Date(when === undefined ? Date.now() : when);
    const iso = isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
    return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Session directory name: `<session_id or 'session'>-<compact UTC stamp>`.
 * @param {string} sessionId
 * @param {Date|string|number} [when]
 * @returns {string}
 */
function sessionDirName(sessionId, when) {
    return `${slug(sessionId, 'session')}-${utcStamp(when)}`;
}

/**
 * Envelope filename, mirroring the shipped summary convention
 * (`<session_id or 'session'>-<compact UTC stamp>-summary.json`) with a
 * `-capture` discriminator. Inside a session directory the canonical name is
 * `ENVELOPE_BASENAME` instead.
 *
 * @param {string} sessionId
 * @param {Date|string|number} [when]
 * @returns {string}
 */
function envelopeFileName(sessionId, when) {
    return `${sessionDirName(sessionId, when)}-capture.json`;
}

/**
 * The shipped summary filename convention, reproduced here so both artifacts
 * of one session sort together.
 * @param {string} sessionId
 * @param {Date|string|number} [when]
 * @returns {string}
 */
function summaryFileName(sessionId, when) {
    return `${sessionDirName(sessionId, when)}-summary.json`;
}

/**
 * Per-task input trail filename (`ScanpathData`).
 * @param {string} taskId
 * @returns {string}
 */
function trailFileName(taskId) {
    return `trail-${slug(taskId, 'task')}.json`;
}

/**
 * Stimulus anchor path, relative to the session directory.
 * @param {string} pageVisitId
 * @returns {string}
 */
function stimulusFileName(pageVisitId) {
    return `stimuli/${slug(pageVisitId, 'page-visit')}.png`;
}

/**
 * The coordinate contract block: states all three spaces and the DPR so no
 * consumer has to guess. Follows docs/adserp-coordinate-system.md.
 *
 * @param {number} devicePixelRatio
 * @returns {Object}
 */
function coordinateContract(devicePixelRatio) {
    const dpr = finite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
    return {
        reference: 'docs/adserp-coordinate-system.md',
        trailSpace: 'client-viewport-css-px',
        units: 'css-px',
        origin: 'top-left',
        yAxis: 'down',
        devicePixelRatio: dpr,
        pageSpace: 'yPage = y + scrollY (xPage = x + scrollX)',
        screenshotSpace: 'xShot = xPage * devicePixelRatio, yShot = yPage * devicePixelRatio',
        fixationSpace: 'ScanpathData.Fixation coords are physical canvas px; ' +
            'conversion happens at replay import, not at capture'
    };
}

/**
 * Normalize one task-level CIF event (Done / Quit / Comment).
 * @param {Object} event
 * @returns {Object}
 */
function normalizeTaskEvent(event) {
    const source = isPlainObject(event) ? event : {};
    const type = nonEmptyString(source.type) ? source.type.toLowerCase() : null;
    const out = {
        type,
        t: finite(source.t) ? source.t : null,
        at: nonEmptyString(source.at) ? source.at : null
    };
    if (type === 'comment') out.comment = typeof source.comment === 'string' ? source.comment : '';
    return out;
}

function normalizeTask(task) {
    const source = isPlainObject(task) ? task : {};
    const events = Array.isArray(source.events) ? source.events.map(normalizeTaskEvent) : [];
    return Object.assign({}, source, {
        // Summary task-record keys (buildSessionSummary shape) — always present.
        index: finite(source.index) ? source.index : null,
        taskId: source.taskId !== undefined ? source.taskId : null,
        targetUrl: source.targetUrl !== undefined ? source.targetUrl : null,
        finalUrl: source.finalUrl !== undefined ? source.finalUrl : null,
        startedAt: source.startedAt !== undefined ? source.startedAt : null,
        endedAt: source.endedAt !== undefined ? source.endedAt : null,
        durationMs: finite(source.durationMs) ? source.durationMs : null,
        outcome: source.outcome !== undefined ? source.outcome : null,
        // The deep-link vocabulary snapshot — the foveation config for this task
        // (ISO 25062:2025 §7.4.6 evaluation environment / §7.8.4 independent variables).
        settings: isPlainObject(source.settings) ? source.settings : {},
        events
    });
}

function normalizePageVisit(visit) {
    const source = isPlainObject(visit) ? visit : {};
    return {
        pageVisitId: source.pageVisitId !== undefined ? source.pageVisitId : null,
        taskId: source.taskId !== undefined ? source.taskId : null,
        url: source.url !== undefined ? source.url : null,
        tStart: finite(source.tStart) ? source.tStart : null,
        tEnd: finite(source.tEnd) ? source.tEnd : null,
        screenshot: source.screenshot !== undefined ? source.screenshot
            : (source.pageVisitId !== undefined ? stimulusFileName(source.pageVisitId) : null),
        stimulusWidth: finite(source.stimulusWidth) ? source.stimulusWidth : null,
        stimulusHeight: finite(source.stimulusHeight) ? source.stimulusHeight : null
    };
}

function normalizeCaptureHealth(health) {
    if (!isPlainObject(health)) return null;
    const binding = isPlainObject(health.trackerBinding)
        ? {
            hostBound: health.trackerBinding.hostBound === true,
            attached: health.trackerBinding.attached === true,
            documentListeners: finite(health.trackerBinding.documentListeners)
                ? health.trackerBinding.documentListeners : 0,
            windowListeners: finite(health.trackerBinding.windowListeners)
                ? health.trackerBinding.windowListeners : 0
        }
        : null;
    return {
        status: nonEmptyString(health.status) ? health.status : null,
        code: nonEmptyString(health.code) ? health.code : null,
        message: nonEmptyString(health.message) ? health.message : null,
        rowCount: finite(health.rowCount) ? health.rowCount : 0,
        taskId: health.taskId !== undefined ? health.taskId : null,
        pollMs: finite(health.pollMs) ? health.pollMs : null,
        deliveryFailureCount: finite(health.deliveryFailureCount)
            ? health.deliveryFailureCount : 0,
        trackerSource: nonEmptyString(health.trackerSource) ? health.trackerSource : null,
        trackerBinding: binding
    };
}

function normalizeCapture(capture) {
    const source = isPlainObject(capture) ? capture : {};
    const screen = isPlainObject(source.screen) ? source.screen : {};
    const win = isPlainObject(source.window) ? source.window : {};
    return {
        schema: CAPTURE_SCHEMA,
        evtrackVersion: source.evtrackVersion !== undefined ? source.evtrackVersion : null,
        pollMs: finite(source.pollMs) ? source.pollMs : null,
        appVersion: source.appVersion !== undefined ? source.appVersion : null,
        platform: source.platform !== undefined ? source.platform : null,
        screen: { w: finite(screen.w) ? screen.w : null, h: finite(screen.h) ? screen.h : null },
        window: { w: finite(win.w) ? win.w : null, h: finite(win.h) ? win.h : null },
        devicePixelRatio: finite(source.devicePixelRatio) ? source.devicePixelRatio : null,
        health: normalizeCaptureHealth(source.health)
    };
}

/**
 * Build a `scrutinizer-session-capture/1` envelope.
 *
 * @param {Object} input
 * @param {string} input.sessionId
 * @param {string} [input.participantId]
 * @param {string} [input.appVersion] - Falls back to capture.appVersion
 * @param {string} [input.platform] - Falls back to capture.platform
 * @param {string} [input.startedAt] - ISO 8601
 * @param {string} [input.endedAt] - ISO 8601; null until the session ends
 * @param {string} [input.endReason] - Summary vocabulary (completed/quit/…); null until end
 * @param {Object} [input.defaults] - Pre-study runtime defaults (summary schema)
 * @param {Object[]} [input.tasks] - Task records; each gains normalized `settings` + `events`
 * @param {Object} [input.capture] - Capture block, e.g. from eventCapture.captureMeta()
 * @param {Object} [input.coordinates] - Overrides for the derived coordinate contract
 * @param {Object[]} [input.pageVisits] - Stimulus anchor index
 * @returns {Object} envelope
 */
function buildEnvelope(input = {}) {
    const capture = normalizeCapture(input.capture);
    const tasks = (Array.isArray(input.tasks) ? input.tasks : []).map(normalizeTask);
    const pageVisits = (Array.isArray(input.pageVisits) ? input.pageVisits : []).map(normalizePageVisit);
    const coordinates = Object.assign(
        coordinateContract(capture.devicePixelRatio),
        isPlainObject(input.coordinates) ? input.coordinates : {}
    );

    return {
        // --- scrutinizer-session-summary/1 keys (strict subset) ---------------
        schema: CAPTURE_SCHEMA,
        sessionId: input.sessionId !== undefined ? input.sessionId : null,
        participantId: input.participantId !== undefined ? input.participantId : null,
        appVersion: input.appVersion !== undefined ? input.appVersion : capture.appVersion,
        platform: input.platform !== undefined ? input.platform : capture.platform,
        startedAt: input.startedAt !== undefined ? input.startedAt : null,
        endedAt: input.endedAt !== undefined ? input.endedAt : null,
        endReason: input.endReason !== undefined ? input.endReason : null,
        taskCount: tasks.length,
        defaults: isPlainObject(input.defaults) ? input.defaults : {},
        tasks,
        // --- capture additions -----------------------------------------------
        extendsSchema: SUMMARY_SCHEMA,
        capture,
        coordinates,
        pageVisits
    };
}

/**
 * Project an envelope down to the shipped summary shape. The summary is a
 * strict subset of the envelope, so this is a pure key selection.
 *
 * @param {Object} envelope
 * @returns {Object} scrutinizer-session-summary/1
 */
function toSummary(envelope) {
    const source = isPlainObject(envelope) ? envelope : {};
    const tasks = (Array.isArray(source.tasks) ? source.tasks : []).map(task => {
        const record = isPlainObject(task) ? task : {};
        const copy = {};
        for (const key of SUMMARY_TASK_KEYS) {
            copy[key] = record[key] !== undefined ? record[key] : null;
        }
        return copy;
    });
    const summary = {};
    for (const key of SUMMARY_KEYS) {
        summary[key] = source[key] !== undefined ? source[key] : null;
    }
    summary.schema = SUMMARY_SCHEMA;
    summary.taskCount = finite(source.taskCount) ? source.taskCount : tasks.length;
    summary.defaults = isPlainObject(source.defaults) ? source.defaults : {};
    summary.tasks = tasks;
    return summary;
}

/**
 * Validate an envelope.
 *
 * @param {Object} envelope
 * @returns {{ok: boolean, errors: string[]}}
 */
function validateEnvelope(envelope) {
    const errors = [];
    const push = message => errors.push(message);

    if (!isPlainObject(envelope)) {
        return { ok: false, errors: ['envelope: expected an object'] };
    }

    // Superset contract: every summary key must be present.
    for (const key of SUMMARY_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(envelope, key)) {
            push(`missing summary key: ${key}`);
        }
    }

    if (envelope.schema !== CAPTURE_SCHEMA) {
        push(`schema: expected "${CAPTURE_SCHEMA}", got ${JSON.stringify(envelope.schema)}`);
    }
    if (!nonEmptyString(envelope.sessionId)) push('sessionId: required non-empty string');
    if (envelope.participantId !== null && envelope.participantId !== undefined &&
        typeof envelope.participantId !== 'string') {
        push('participantId: expected a string or null');
    }
    if (!nonEmptyString(envelope.startedAt) || isNaN(Date.parse(envelope.startedAt))) {
        push('startedAt: required ISO 8601 timestamp');
    }
    if (envelope.endedAt !== null && envelope.endedAt !== undefined &&
        (!nonEmptyString(envelope.endedAt) || isNaN(Date.parse(envelope.endedAt)))) {
        push('endedAt: expected null or an ISO 8601 timestamp');
    }
    if (!isPlainObject(envelope.defaults)) push('defaults: expected an object');

    // --- tasks ---------------------------------------------------------------
    if (!Array.isArray(envelope.tasks)) {
        push('tasks: expected an array');
    } else {
        if (envelope.taskCount !== envelope.tasks.length) {
            push(`taskCount: ${envelope.taskCount} does not match tasks.length ${envelope.tasks.length}`);
        }
        envelope.tasks.forEach((task, i) => {
            if (!isPlainObject(task)) {
                push(`tasks[${i}]: expected an object`);
                return;
            }
            for (const key of SUMMARY_TASK_KEYS) {
                if (!Object.prototype.hasOwnProperty.call(task, key)) {
                    push(`tasks[${i}]: missing summary key ${key}`);
                }
            }
            if (!nonEmptyString(task.taskId)) push(`tasks[${i}].taskId: required non-empty string`);
            // Outcome vocabulary: only what closeOpenTaskRecord() ever writes.
            // Off-vocabulary values (e.g. 'completed', 'quit') have no defined
            // procedural meaning downstream, so reject them here. In
            // particular, do not expand this vocabulary with analyst outcome
            // labels: `done` records the Done trigger, not task success.
            if (task.outcome !== null && task.outcome !== undefined &&
                TASK_OUTCOMES.indexOf(task.outcome) === -1) {
                push(`tasks[${i}].outcome: expected null or one of ${TASK_OUTCOMES.join('|')}, ` +
                    `got ${JSON.stringify(task.outcome)}`);
            }
            if (!isPlainObject(task.settings)) push(`tasks[${i}].settings: expected an object`);
            if (!Array.isArray(task.events)) {
                push(`tasks[${i}].events: expected an array`);
                return;
            }
            task.events.forEach((event, j) => {
                if (!isPlainObject(event)) {
                    push(`tasks[${i}].events[${j}]: expected an object`);
                    return;
                }
                if (TASK_EVENT_TYPES.indexOf(event.type) === -1) {
                    push(`tasks[${i}].events[${j}].type: expected one of ${TASK_EVENT_TYPES.join('|')}, ` +
                        `got ${JSON.stringify(event.type)}`);
                }
                if (!finite(event.t) && !nonEmptyString(event.at)) {
                    push(`tasks[${i}].events[${j}]: needs a finite t or an ISO at`);
                }
                if (event.type === 'comment' && typeof event.comment !== 'string') {
                    push(`tasks[${i}].events[${j}].comment: expected a string`);
                }
            });
        });
    }

    // --- capture block -------------------------------------------------------
    if (!isPlainObject(envelope.capture)) {
        push('capture: expected an object');
    } else {
        const capture = envelope.capture;
        if (capture.schema !== CAPTURE_SCHEMA) {
            push(`capture.schema: expected "${CAPTURE_SCHEMA}"`);
        }
        if (!nonEmptyString(capture.evtrackVersion)) {
            push('capture.evtrackVersion: required — the vendored upstream commit');
        }
        if (!finite(capture.pollMs) || capture.pollMs < 0) {
            push('capture.pollMs: required finite non-negative number');
        }
        if (!finite(capture.devicePixelRatio) || capture.devicePixelRatio <= 0) {
            push('capture.devicePixelRatio: required finite positive number');
        }
        for (const field of ['screen', 'window']) {
            const dims = capture[field];
            if (!isPlainObject(dims) || !finite(dims.w) || !finite(dims.h)) {
                push(`capture.${field}: expected {w, h} finite numbers`);
            }
        }
        if (capture.health !== null && capture.health !== undefined) {
            const health = capture.health;
            if (!isPlainObject(health)) {
                push('capture.health: expected an object or null');
            } else {
                if (CAPTURE_HEALTH_STATUSES.indexOf(health.status) === -1) {
                    push(`capture.health.status: expected one of ` +
                        `${CAPTURE_HEALTH_STATUSES.join('|')}`);
                }
                if (!finite(health.rowCount) || health.rowCount < 0) {
                    push('capture.health.rowCount: expected a finite non-negative number');
                }
                if (health.pollMs !== null && health.pollMs !== undefined &&
                    (!finite(health.pollMs) || health.pollMs < 0)) {
                    push('capture.health.pollMs: expected null or a finite non-negative number');
                }
                if (health.deliveryFailureCount !== undefined &&
                    (!finite(health.deliveryFailureCount) || health.deliveryFailureCount < 0)) {
                    push('capture.health.deliveryFailureCount: expected a finite non-negative number');
                }
            }
        }
    }

    // --- coordinate contract -------------------------------------------------
    if (!isPlainObject(envelope.coordinates)) {
        push('coordinates: expected an object');
    } else {
        const coordinates = envelope.coordinates;
        for (const field of ['trailSpace', 'pageSpace', 'screenshotSpace']) {
            if (!nonEmptyString(coordinates[field])) {
                push(`coordinates.${field}: required — consumers must not have to guess`);
            }
        }
        if (!finite(coordinates.devicePixelRatio) || coordinates.devicePixelRatio <= 0) {
            push('coordinates.devicePixelRatio: required finite positive number');
        } else if (isPlainObject(envelope.capture) && finite(envelope.capture.devicePixelRatio) &&
            coordinates.devicePixelRatio !== envelope.capture.devicePixelRatio) {
            push('coordinates.devicePixelRatio: disagrees with capture.devicePixelRatio');
        }
    }

    // --- stimulus anchors ----------------------------------------------------
    if (!Array.isArray(envelope.pageVisits)) {
        push('pageVisits: expected an array');
    } else {
        const taskIds = Array.isArray(envelope.tasks)
            ? envelope.tasks.map(task => (isPlainObject(task) ? task.taskId : null))
            : [];
        envelope.pageVisits.forEach((visit, i) => {
            if (!isPlainObject(visit)) {
                push(`pageVisits[${i}]: expected an object`);
                return;
            }
            if (!nonEmptyString(visit.pageVisitId)) push(`pageVisits[${i}].pageVisitId: required`);
            if (!nonEmptyString(visit.url)) push(`pageVisits[${i}].url: required`);
            if (!nonEmptyString(visit.screenshot)) push(`pageVisits[${i}].screenshot: required`);
            if (!finite(visit.tStart)) push(`pageVisits[${i}].tStart: required finite ms`);
            if (!finite(visit.stimulusWidth) || !finite(visit.stimulusHeight)) {
                push(`pageVisits[${i}]: stimulusWidth/stimulusHeight required`);
            }
            if (taskIds.length > 0 && taskIds.indexOf(visit.taskId) === -1) {
                push(`pageVisits[${i}].taskId: ${JSON.stringify(visit.taskId)} matches no task`);
            }
        });
    }

    return { ok: errors.length === 0, errors };
}

module.exports = {
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
    SUMMARY_TASK_KEYS,
    TASK_EVENT_TYPES,
    TASK_OUTCOMES,
    CAPTURE_HEALTH_STATUSES,
    ENVELOPE_BASENAME
};
