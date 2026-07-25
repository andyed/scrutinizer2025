'use strict';

/**
 * CIF usability measures derived from capture sessions (WB-1 / P3-6).
 *
 * Pure module — no Electron, no DOM, no filesystem — so the Study Workbench
 * (scrutinizer-moderator, browser-only) can vendor it unchanged and the engine
 * repo can Jest-test it headlessly. Consumes exactly what the capture spec's
 * DataCollector writes: the `scrutinizer-session-capture/1` envelope
 * (shared/session-capture.js) plus per-task `ScanpathData` trails
 * (renderer/scanpath/scanpath-types.js).
 *
 * Measure definitions follow the Common Industry Format lineage as revised by
 * ISO 25062:2025 / ISO 9241-11. This module derives efficiency measures
 * (time-on-task, and mouse miles / interaction counts as effort proxies; the
 * instrumented-browser argument: Edmonds, BRMIC 35(2), 2003). It does not
 * derive effectiveness: the capture records that Done was pressed, not whether
 * the participant achieved the task goal. `completionRecorded` / `doneRate`
 * expose that procedural signal without relabeling it as task success.
 * Derivation happens post hoc, never at capture time — the capture spec stores
 * raw rows precisely so measures like these can be recomputed at will.
 *
 * Spec: docs/specs/study-workbench-webapp.md (WB-1),
 *       docs/specs/session-capture-procedural-replay.md (derived views).
 */

function finite(value) {
    return typeof value === 'number' && isFinite(value);
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Milliseconds between two task boundary stamps. Accepts either the summary
 * schema's ISO strings or already-numeric ms — the workbench sees both,
 * depending on whether the envelope came from a finished or a crashed session.
 * Returns null (never NaN) when either end is missing/unparseable, and null on
 * a negative span: a task that "ended before it started" is clock skew, and an
 * excluded value is honest where a clamped 0 would silently bias the median.
 */
function spanMs(startedAt, endedAt) {
    const start = finite(startedAt) ? startedAt : Date.parse(startedAt);
    const end = finite(endedAt) ? endedAt : Date.parse(endedAt);
    if (!finite(start) || !finite(end)) return null;
    const span = end - start;
    return span >= 0 ? span : null;
}

/**
 * Total euclidean path length over a mouse timeline, in the trail's own units
 * (client-viewport CSS px per the coordinate contract). "Mouse miles" is the
 * classic instrumented-browser efficiency proxy: more distance for the same
 * task means more motor effort hunting for the target.
 *
 * Rows with non-finite coordinates are skipped, not zeroed: a NaN row is a
 * capture glitch, and bridging the two finite neighbours under-counts less
 * than poisoning the whole sum. Returns null when no finite point exists —
 * "no motion data" must stay distinguishable from "did not move".
 *
 * @param {Array} mouseTimeline - MouseTimelineEvent[] ({t, x, y, event})
 * @returns {number|null}
 */
function mousePathLengthPx(mouseTimeline) {
    if (!Array.isArray(mouseTimeline)) return null;
    let sum = 0;
    let prev = null;
    let sawFinite = false;
    for (const row of mouseTimeline) {
        if (!isPlainObject(row) || !finite(row.x) || !finite(row.y)) continue; // skip glitch rows
        sawFinite = true;
        if (prev) {
            const dx = row.x - prev.x;
            const dy = row.y - prev.y;
            sum += Math.sqrt(dx * dx + dy * dy);
        }
        prev = row;
    }
    return sawFinite ? sum : null;
}

/** Count trail events of one ScanpathEvent type (only called for trails that ran). */
function countEvents(events, type) {
    if (!Array.isArray(events)) return 0;
    let count = 0;
    for (const event of events) {
        if (isPlainObject(event) && event.type === type) count += 1;
    }
    return count;
}

/**
 * Vertical scroll excursion (max - min scrollY) over the trail, in CSS px.
 * A viewport-height-free proxy for "how much of the page did they traverse";
 * null when no finite scroll sample exists.
 */
function scrollRange(scrollTimeline) {
    if (!Array.isArray(scrollTimeline)) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const row of scrollTimeline) {
        if (!isPlainObject(row) || !finite(row.scrollY)) continue;
        if (row.scrollY < min) min = row.scrollY;
        if (row.scrollY > max) max = row.scrollY;
    }
    return max >= min ? max - min : null;
}

/**
 * Per-task CIF measures from one envelope task record + its ScanpathData trail.
 *
 * A missing or empty trail yields trailRowCount 0 and null motion *and count*
 * measures — never a throw, never a fabricated zero. That null-not-zero
 * distinction is the WB-1 QC-gate signal: zero rows means the in-page tracker
 * never ran (the inert-tracker footgun), which must surface as "capture
 * misconfigured", not as a participant who sat perfectly still — and nulls,
 * unlike zeros, are excluded (and counted) by aggregateSessions, so a
 * misconfigured capture cannot drag cross-session medians toward zero.
 *
 * @param {Object} task - Envelope task record (summary task keys + events)
 * @param {Object} [scanpathData] - ScanpathData trail for this task, if captured
 * @param {Object} [opts]
 * @param {number} [opts.ppd] - Pixels per degree of visual angle; enables
 *   mouseMilesDeg so motion is comparable across screens/viewing distances.
 * @returns {Object} measures record
 */
function taskMeasures(task, scanpathData, opts = {}) {
    const record = isPlainObject(task) ? task : {};
    const trail = isPlainObject(scanpathData) ? scanpathData : null;
    const outcome = record.outcome !== undefined ? record.outcome : null;

    // Procedural completion signal, not effectiveness: `done` means the
    // participant or moderator pressed Done. It does not establish that the
    // participant achieved the task goal; that requires analyst adjudication
    // outside this capture-derived module.
    const completionRecorded = outcome === 'done';

    // Efficiency: prefer the recorded durationMs (the instrument computed it at
    // task end); derive from the boundary stamps only as fallback so partially
    // written records still yield a number when they can.
    const timeOnTaskMs = finite(record.durationMs)
        ? record.durationMs
        : spanMs(record.startedAt, record.endedAt);

    const mouseMilesPx = trail ? mousePathLengthPx(trail.mouseTimeline) : null;

    // Degrees of visual angle, when the study recorded geometry (ppd). Px paths
    // are incomparable across DPR/screen setups; degrees are the perceptual
    // unit the rest of the instrument (foveation config) already speaks.
    const ppd = finite(opts.ppd) && opts.ppd > 0 ? opts.ppd : null;
    const mouseMilesDeg = mouseMilesPx !== null && ppd !== null ? mouseMilesPx / ppd : null;

    // The QC-gate predicate: a trail whose mouse timeline has zero rows is one
    // the in-page tracker never wrote (inert-tracker footgun) — treat it
    // exactly like a missing trail for every per-trail measure.
    const trailRowCount = trail && Array.isArray(trail.mouseTimeline)
        ? trail.mouseTimeline.length : 0;
    const trailRan = trailRowCount > 0;

    return {
        taskId: record.taskId !== undefined ? record.taskId : null,
        outcome,
        completionRecorded,
        timeOnTaskMs,
        mouseMilesPx,
        mouseMilesDeg,
        // Counts are per-trail: with no trail — or a zero-row trail the
        // tracker never ran in — they are null (unknown), because a
        // fabricated 0 would read as "participant never clicked" in a report
        // and leak into cross-session aggregate medians.
        clickCount: trailRan ? countEvents(trail.events, 'click') : null,
        keyEventCount: trailRan ? countEvents(trail.events, 'key') : null,
        scrollRangePx: trailRan ? scrollRange(trail.scrollTimeline) : null,
        trailRowCount
    };
}

/**
 * Session-level measures: per-task records plus roll-up totals for the
 * Session Library roster row.
 *
 * @param {Object} envelope - scrutinizer-session-capture/1 envelope
 * @param {Object} [trailsByTaskId] - taskId → ScanpathData (parsed trail-*.json)
 * @param {Object} [opts] - {ppd} forwarded to taskMeasures
 * @returns {Object} {sessionId, participantId, tasks, totals}
 */
function sessionMeasures(envelope, trailsByTaskId, opts = {}) {
    const source = isPlainObject(envelope) ? envelope : {};
    const trails = isPlainObject(trailsByTaskId) ? trailsByTaskId : {};
    const taskRecords = Array.isArray(source.tasks) ? source.tasks : [];

    const tasks = taskRecords.map(task => {
        const taskId = isPlainObject(task) ? task.taskId : null;
        // hasOwnProperty guard: a taskId like 'constructor' must not pull
        // prototype junk in as a trail.
        const trail = taskId !== null && Object.prototype.hasOwnProperty.call(trails, taskId)
            ? trails[taskId] : undefined;
        return taskMeasures(task, trail, opts);
    });

    // Totals sum only what exists; null measures (missing trails, unfinished
    // tasks) are excluded rather than treated as zero, matching the
    // exclude-and-count posture of aggregateSessions.
    let doneCount = 0;
    let totalTimeMs = 0;
    let totalMouseMilesPx = 0;
    for (const task of tasks) {
        if (task.completionRecorded) doneCount += 1;
        if (finite(task.timeOnTaskMs)) totalTimeMs += task.timeOnTaskMs;
        if (finite(task.mouseMilesPx)) totalMouseMilesPx += task.mouseMilesPx;
    }

    return {
        sessionId: source.sessionId !== undefined ? source.sessionId : null,
        participantId: source.participantId !== undefined ? source.participantId : null,
        tasks,
        totals: {
            taskCount: tasks.length,
            doneCount,
            totalTimeMs,
            totalMouseMilesPx
        }
    };
}

/**
 * Quantile with linear interpolation between order statistics (R-7, the
 * NumPy/Excel default) — deterministic and exact on the hand-computable small
 * n's a usability study actually has.
 * @param {number[]} sorted - Ascending finite values
 * @param {number} p - 0..1
 * @returns {number|null}
 */
function quantileLinear(sorted, p) {
    if (sorted.length === 0) return null;
    const index = (sorted.length - 1) * p;
    const lo = Math.floor(index);
    const hi = Math.ceil(index);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

/**
 * Median + IQR over one measure across participants, excluding nulls but
 * counting them. Median/IQR rather than mean/sd because usability samples are
 * small and time-on-task is right-skewed (WB-1: "small-n displayed honestly,
 * no bare means for n<5"). nExcluded keeps the missing-data denominator
 * visible in the report instead of vanishing into the summary statistic.
 */
function robustStats(values) {
    const usable = [];
    let nExcluded = 0;
    for (const value of values) {
        if (finite(value)) usable.push(value);
        else nExcluded += 1; // null (no trail / unfinished task) — excluded, reported
    }
    usable.sort((a, b) => a - b);
    const q1 = quantileLinear(usable, 0.25);
    const q3 = quantileLinear(usable, 0.75);
    return {
        median: quantileLinear(usable, 0.5),
        iqr: q1 !== null && q3 !== null ? q3 - q1 : null,
        n: usable.length,
        nExcluded
    };
}

/**
 * Aggregate per-task measures across participants (sessions).
 *
 * @param {Object[]} sessionMeasuresList - Outputs of sessionMeasures()
 * @returns {Object[]} one record per taskId, in first-seen task order:
 *   {taskId, n, doneRate, timeOnTaskMs, mouseMilesPx, clickCount}
 */
function aggregateSessions(sessionMeasuresList) {
    const list = Array.isArray(sessionMeasuresList) ? sessionMeasuresList : [];

    // Group by taskId, preserving first-seen order so the aggregate table
    // reads in protocol order, not alphabetical order.
    const order = [];
    const byTaskId = new Map();
    for (const session of list) {
        const tasks = isPlainObject(session) && Array.isArray(session.tasks) ? session.tasks : [];
        for (const task of tasks) {
            if (!isPlainObject(task)) continue;
            const taskId = task.taskId !== undefined ? task.taskId : null;
            if (!byTaskId.has(taskId)) {
                byTaskId.set(taskId, []);
                order.push(taskId);
            }
            byTaskId.get(taskId).push(task);
        }
    }

    return order.map(taskId => {
        const group = byTaskId.get(taskId);
        // Done rate over all attempts: completionRecorded is boolean-known for
        // every record (outcome null → Done not recorded), so the denominator
        // is n, not n-minus-missing. This is a procedural rate, not a task
        // success/effectiveness rate.
        let doneCount = 0;
        for (const task of group) {
            if (task.completionRecorded === true) doneCount += 1;
        }
        return {
            taskId,
            n: group.length,
            doneRate: group.length > 0 ? doneCount / group.length : null,
            timeOnTaskMs: robustStats(group.map(task => task.timeOnTaskMs)),
            mouseMilesPx: robustStats(group.map(task => task.mouseMilesPx)),
            clickCount: robustStats(group.map(task => task.clickCount))
        };
    });
}

module.exports = {
    taskMeasures,
    sessionMeasures,
    aggregateSessions
};
