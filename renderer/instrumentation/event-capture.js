'use strict';

/**
 * Session input-trail capture (P3-2a substrate).
 *
 * Wraps the vendored evtrack tracker (`vendor/evtrack/`, server leg removed)
 * and turns its rows into the `ScanpathData` timelines the replay read-side
 * already consumes (`renderer/scanpath/scanpath-types.js`). Nothing here talks
 * to the network or the filesystem — rows buffer in memory and the caller
 * decides where they go.
 *
 * Spec: docs/specs/session-capture-procedural-replay.md
 * Coordinates: docs/adserp-coordinate-system.md
 *
 * Loading: classic <script> tags (tracklib.js then trackui.js) remain supported.
 * Electron's preload may also require() the vendor: the vendored TrackUI now
 * binds to the real DOM window when one exists and exposes bindingHealth().
 * start() refuses an inert/unbound tracker instead of silently producing an
 * empty trail.
 *
 * Coordinate contract (what this module emits):
 *   mouseTimeline x/y  — client-viewport CSS px (evtrack pageX/pageY minus the
 *                        scroll offset read at the same instant)
 *   scrollTimeline     — window.scrollY, sampled on EVERY buffered row, not
 *                        only on scroll events; page space is derived downstream
 *                        as `yPage = y + scrollY`
 *   devicePixelRatio   — reported via environment(); screenshot space is
 *                        derived from it, never baked into the rows
 *
 * Privacy (hard requirement, see spec §Privacy):
 *   Key events whose target is input/textarea/select or sits under a
 *   contenteditable ancestor record only that a key event happened, plus the
 *   target xpath. Never the key identity, never the field value. `value`
 *   attributes are stripped from every captured attribute set regardless of
 *   event type. Non-editable targets may keep key identity (shortcut analysis).
 */

/** Default cursor sampling period, ~60 Hz. Local disk sink — cost is negligible. */
const DEFAULT_POLL_MS = 16;

/** Sampled through evtrack's polling throttle. */
const POLLED_EVENTS = ['mousemove', 'scroll'];

/** Captured as they fire. */
const DISCRETE_EVENTS = [
    'mousedown', 'mouseup', 'click', 'dblclick', 'wheel',
    'keydown', 'keyup', 'submit', 'change', 'contextmenu',
    'copy', 'paste', 'resize', 'blur', 'focus'
];

/** Upstream commit this adapter is written against. See vendor/evtrack/README.md. */
const EVTRACK_COMMIT = 'cabb3b7ccfecee72a8970592642c86881a8fd437';

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const KEY_EVENTS = new Set(['keydown', 'keyup', 'keypress']);

/** Raw event names that also earn an entry in ScanpathData.events[]. */
const STREAM_EVENTS = new Set([
    'click', 'dblclick', 'submit', 'change', 'contextmenu',
    'copy', 'paste', 'scroll', 'keydown', 'keyup'
]);

/** Guard against pathological/cyclic parent chains on detached trees. */
const MAX_ANCESTOR_WALK = 128;

/**
 * Is this event target a text-entry surface whose keystrokes must be masked?
 *
 * Walks ancestors so a keypress inside `<div contenteditable><span>|</span></div>`
 * masks too. Fails closed: anything we cannot inspect is treated as editable.
 *
 * @param {Object} node - DOM node (or a detached/mock stand-in)
 * @returns {boolean}
 */
function isEditableTarget(node) {
    if (!node) return false;
    try {
        let el = node;
        // Safari hands back text nodes; climb to the element.
        if (el.nodeType === 3 && el.parentNode) el = el.parentNode;
        for (let depth = 0; el && depth < MAX_ANCESTOR_WALK; depth++) {
            if (el.isContentEditable === true) return true;
            const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
            if (EDITABLE_TAGS.has(tag)) return true;
            if (typeof el.getAttribute === 'function') {
                const editable = el.getAttribute('contenteditable');
                if (editable !== null && editable !== undefined &&
                    String(editable).toLowerCase() !== 'false') {
                    return true;
                }
            }
            el = el.parentNode || null;
        }
    } catch (err) {
        // A target we cannot walk is a target we cannot clear — mask it.
        return true;
    }
    return false;
}

/**
 * Drop every `value` attribute from a serialized attribute set.
 *
 * evtrack hands us `'{"INPUT":{"type":"text","value":"…"}}'`. Accepts the JSON
 * string or an already-parsed object; always returns a plain object (`{}` when
 * unparseable) so downstream code never has to re-guess the shape.
 *
 * @param {string|Object} attrs
 * @returns {Object}
 */
function stripValueAttrs(attrs) {
    let parsed = attrs;
    if (typeof attrs === 'string') {
        try {
            parsed = JSON.parse(attrs);
        } catch (err) {
            return {};
        }
    }
    if (!parsed || typeof parsed !== 'object') return {};

    const scrub = (value, depth) => {
        if (depth > 8 || !value || typeof value !== 'object') return value;
        if (Array.isArray(value)) return value.map(item => scrub(item, depth + 1));
        const out = {};
        for (const key of Object.keys(value)) {
            if (key.toLowerCase() === 'value') continue;  // never a raw form value
            out[key] = scrub(value[key], depth + 1);
        }
        return out;
    };

    return scrub(parsed, 0);
}

/**
 * Key payload for a key event, honouring the masking rule.
 *
 * @param {Object} domEvent
 * @param {boolean} masked
 * @returns {Object}
 */
function keyPayload(domEvent, masked) {
    if (masked || !domEvent) return { masked: true };
    return {
        masked: false,
        key: typeof domEvent.key === 'string' ? domEvent.key : null,
        code: typeof domEvent.code === 'string' ? domEvent.code : null,
        ctrlKey: !!domEvent.ctrlKey,
        metaKey: !!domEvent.metaKey,
        altKey: !!domEvent.altKey,
        shiftKey: !!domEvent.shiftKey
    };
}

function finite(value) {
    return typeof value === 'number' && isFinite(value);
}

function readScrollOffsets(win) {
    if (!win) return { x: 0, y: 0 };
    const x = finite(win.scrollX) ? win.scrollX
        : finite(win.pageXOffset) ? win.pageXOffset : 0;
    const y = finite(win.scrollY) ? win.scrollY
        : finite(win.pageYOffset) ? win.pageYOffset : 0;
    return { x, y };
}

function defaultWindow() {
    return typeof window !== 'undefined' ? window : null;
}

function defaultClock() {
    const win = defaultWindow();
    if (win && win.performance && typeof win.performance.now === 'function') {
        return () => win.performance.now();
    }
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return () => performance.now();
    }
    return () => Date.now();
}

/**
 * Create a capture adapter.
 *
 * Everything external is injectable so the adapter is unit-testable without a
 * DOM: pass a fake `tracker` (anything with `record`/`flush`) and a fake
 * `window`, and drive rows straight through the sink.
 *
 * @param {Object} [deps]
 * @param {Object} [deps.window] - Window-like (scrollX/scrollY, innerWidth/…, screen, devicePixelRatio)
 * @param {Object} [deps.tracker] - evtrack `TrackUI`; lazily required from vendor/ when omitted
 * @param {Object} [deps.trackLib] - evtrack `TrackLib`; used only to harden getXPath
 * @param {function(): number} [deps.now] - Monotonic clock in ms (performance.now)
 * @returns {Object} capture instance
 */
function createEventCapture(deps = {}) {
    const win = deps.window !== undefined ? deps.window : defaultWindow();
    const now = typeof deps.now === 'function' ? deps.now : defaultClock();

    let tracker = deps.tracker || null;
    let trackerSource = tracker ? 'injected' : null;
    let lastTrackerBinding = null;
    let trackLib = deps.trackLib || null;
    let pristineSettings = null;
    let originalGetXPath = null;

    let rows = [];
    let running = false;
    let lifecycle = 'idle';
    let failure = null;
    let t0 = 0;
    let startedWallClock = 0;
    let effectivePollMs = DEFAULT_POLL_MS;
    let taskId = null;
    let lastX = null;
    let lastY = null;

    function resolveTracker() {
        if (tracker) return tracker;
        // Prefer the browser global produced by classic script injection.
        if (win && win.TrackUI) {
            tracker = win.TrackUI;
            trackerSource = 'browser-global';
            return tracker;
        }
        // Lazy: keeps requiring this module cheap and side-effect free. The
        // vendor binds a CommonJS preload to the real DOM host when available;
        // bindingHealth() below rejects a headless/inert instance.
        try {
            // eslint-disable-next-line global-require
            const loaded = require('./vendor/evtrack/trackui.js');
            tracker = (win && win.TrackUI) || loaded.TrackUI || null;
            if (tracker) {
                trackerSource = win && win.TrackUI === tracker
                    ? 'commonjs-host-bound'
                    : 'commonjs-headless';
            }
        } catch (err) {
            tracker = null;
        }
        return tracker;
    }

    function resolveTrackLib() {
        if (trackLib) return trackLib;
        try {
            // eslint-disable-next-line global-require
            trackLib = require('./vendor/evtrack/tracklib.js').TrackLib || null;
        } catch (err) {
            trackLib = (win && win.TrackLib) || null;
        }
        return trackLib;
    }

    /**
     * Upstream's getXPath walks parentNode with no null guard and touches the
     * legacy HTMLDocument global. A detached node must not be able to kill a
     * running study, so wrap it for the duration of the capture.
     */
    function hardenXPath() {
        const lib = resolveTrackLib();
        if (!lib || !lib.XPath || typeof lib.XPath.getXPath !== 'function') return;
        if (originalGetXPath) return;
        originalGetXPath = lib.XPath.getXPath;
        const original = originalGetXPath;
        lib.XPath.getXPath = function safeGetXPath(node, absolute) {
            try {
                const path = original.call(this, node, absolute);
                return typeof path === 'string' ? path : '';
            } catch (err) {
                return '';
            }
        };
    }

    function restoreXPath() {
        const lib = trackLib;
        if (lib && lib.XPath && originalGetXPath) {
            lib.XPath.getXPath = originalGetXPath;
        }
        originalGetXPath = null;
    }

    /**
     * evtrack's `record()` rewrites settings in place (strings become arrays),
     * so a second start on the same module instance would crash. Snapshot once,
     * restore before every start.
     */
    function resetTrackerSettings(activeTracker) {
        if (!activeTracker || !activeTracker.settings) return;
        if (!pristineSettings) {
            pristineSettings = Object.assign({}, activeTracker.settings);
            return;
        }
        Object.assign(activeTracker.settings, pristineSettings);
    }

    function trackerBinding() {
        if (!tracker || typeof tracker.bindingHealth !== 'function') return null;
        try {
            const binding = tracker.bindingHealth();
            if (!binding || typeof binding !== 'object') return null;
            return {
                hostBound: binding.hostBound === true,
                attached: binding.attached === true,
                documentListeners: finite(binding.documentListeners)
                    ? binding.documentListeners : 0,
                windowListeners: finite(binding.windowListeners)
                    ? binding.windowListeners : 0
            };
        } catch (err) {
            return {
                hostBound: false,
                attached: false,
                documentListeners: 0,
                windowListeners: 0
            };
        }
    }

    /**
     * Serializable capture-readiness snapshot for the DataCollector/envelope.
     *
     * `awaiting_first_row` is healthy immediately after listener attachment;
     * `empty` is only assigned after stop(), when a zero-row trail is a final
     * QC failure rather than a still-running capture.
     */
    function health() {
        let status = lifecycle;
        let code = failure ? failure.code : null;
        let message = failure ? failure.message : null;
        if (lifecycle === 'running') {
            status = rows.length > 0 ? 'recording' : 'awaiting_first_row';
        } else if (lifecycle === 'stopped' && rows.length === 0) {
            status = 'empty';
            code = 'empty_trail';
            message = 'Capture stopped without receiving any tracker rows.';
        }
        return {
            status,
            code,
            message,
            rowCount: rows.length,
            taskId,
            pollMs: effectivePollMs,
            trackerSource,
            trackerBinding: running
                ? (trackerBinding() || lastTrackerBinding)
                : lastTrackerBinding
        };
    }

    /**
     * Normalize one evtrack row and buffer it. Called synchronously from inside
     * the originating DOM event handler, so `window.scrollY` read here is the
     * offset that was in effect for this row.
     *
     * @param {Object} row - {cursorId, timestamp, xpos, ypos, event, xpath, attrs, extras}
     * @param {Object} [domEvent] - Originating DOM event, passed through by the vendor sink
     */
    function handleRow(row, domEvent) {
        if (!running || !row) return;

        const eventName = typeof row.event === 'string' ? row.event : 'unknown';
        const scroll = readScrollOffsets(win);
        const isScrollRow = eventName === 'scroll';

        // evtrack reports pageX/pageY; the trail is client-viewport CSS px.
        // On scroll rows xpos/ypos hold the scroll offsets, not the cursor —
        // the cursor did not move, so carry the last known position forward.
        let x = null;
        let y = null;
        if (isScrollRow) {
            x = lastX;
            y = lastY;
        } else {
            const px = row.xpos;
            const py = row.ypos;
            if (finite(px) && finite(py)) {
                x = px - scroll.x;
                y = py - scroll.y;
            } else {
                x = lastX;
                y = lastY;
            }
        }
        if (finite(x) && finite(y)) {
            lastX = x;
            lastY = y;
        } else {
            x = null;
            y = null;
        }

        // Scroll offset for this row: on a scroll row evtrack already carries
        // the authoritative offsets; otherwise sample the window.
        const scrollY = isScrollRow && finite(row.ypos) ? row.ypos : scroll.y;
        const scrollX = isScrollRow && finite(row.xpos) ? row.xpos : scroll.x;

        const isKey = KEY_EVENTS.has(eventName);
        // No event object means no target to clear — mask rather than guess.
        const masked = isKey && (!domEvent || isEditableTarget(domEvent.target));

        const buffered = {
            t: now() - t0,
            wallClock: finite(row.timestamp) ? row.timestamp : null,
            event: eventName,
            x,
            y,
            scrollX: finite(scrollX) ? scrollX : 0,
            scrollY: finite(scrollY) ? scrollY : 0,
            xpath: typeof row.xpath === 'string' ? row.xpath : '',
            attrs: stripValueAttrs(row.attrs),
            extras: parseExtras(row.extras),
            cursorId: finite(row.cursorId) ? row.cursorId : 0
        };
        if (isKey) {
            buffered.masked = masked;
            Object.assign(buffered, keyPayload(domEvent, masked));
        }
        rows.push(buffered);
    }

    function parseExtras(extras) {
        if (!extras) return {};
        if (typeof extras === 'object') return extras;
        if (typeof extras === 'string') {
            try {
                const parsed = JSON.parse(extras);
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (err) {
                return {};
            }
        }
        return {};
    }

    /**
     * Begin capture. Rebases the trail clock to this instant.
     *
     * @param {Object} [opts]
     * @param {string} [opts.taskId] - Stamped onto toScanpathData() output
     * @param {number} [opts.pollMs=16] - Cursor sampling period, ms
     * @param {string[]} [opts.polledEvents]
     * @param {string[]} [opts.discreteEvents]
     * @param {function(Object): Object} [opts.extras] - Per-row extras hook (foveation state)
     * @param {boolean} [opts.saveAttributes=true]
     * @param {boolean} [opts.debug=false]
     * @returns {boolean} whether capture started
     */
    function start(opts = {}) {
        if (running) stop();

        rows = [];
        lastX = null;
        lastY = null;
        taskId = opts.taskId || null;
        effectivePollMs = finite(opts.pollMs) && opts.pollMs >= 0 ? opts.pollMs : DEFAULT_POLL_MS;
        lastTrackerBinding = null;

        const activeTracker = resolveTracker();
        if (!activeTracker || typeof activeTracker.record !== 'function') {
            lifecycle = 'failed';
            failure = {
                code: 'tracker_unavailable',
                message: 'No event tracker with record() is available.'
            };
            return false;
        }

        t0 = now();
        startedWallClock = Date.now();
        running = true;
        lifecycle = 'running';
        failure = null;

        hardenXPath();
        resetTrackerSettings(activeTracker);

        const polled = opts.polledEvents || POLLED_EVENTS;
        const discrete = opts.discreteEvents || DISCRETE_EVENTS;

        try {
            activeTracker.record({
                sink: handleRow,
                regularEvents: discrete.join(' '),
                pollingEvents: polled.join(' '),
                pollingMs: effectivePollMs,
                taskName: taskId || 'scrutinizer-session',
                saveAttributes: opts.saveAttributes !== false,
                callback: typeof opts.extras === 'function' ? opts.extras : null,
                debug: !!opts.debug
            });

            const binding = trackerBinding();
            lastTrackerBinding = binding;
            if (binding && !binding.attached) {
                const error = new Error(
                    'Event tracker did not attach listeners to a DOM window.'
                );
                error.code = 'tracker_inert';
                throw error;
            }
        } catch (err) {
            try {
                if (typeof activeTracker.flush === 'function') activeTracker.flush();
            } catch (flushErr) {
                // Preserve the start failure; cleanup is best-effort.
            }
            running = false;
            lifecycle = 'failed';
            failure = {
                code: err && err.code === 'tracker_inert'
                    ? 'tracker_inert' : 'tracker_start_failed',
                message: err && err.message
                    ? err.message : 'Event tracker failed during start().'
            };
            restoreXPath();
            return false;
        }

        return true;
    }

    /**
     * Stop capture and detach listeners. Buffered rows are kept.
     * @returns {Object[]} the buffered trail
     */
    function stop() {
        lastTrackerBinding = trackerBinding() || lastTrackerBinding;
        if (running && tracker && typeof tracker.flush === 'function') {
            try {
                tracker.flush();
            } catch (err) {
                // Detaching must never throw out of a study teardown.
            }
        }
        running = false;
        if (lifecycle !== 'failed') lifecycle = 'stopped';
        restoreXPath();
        return flush();
    }

    /**
     * Read out the buffered trail.
     *
     * Non-draining by default — `toScanpathData()` needs the rows. Pass
     * `{drain: true}` for incremental write-out.
     *
     * @param {Object} [opts]
     * @param {boolean} [opts.drain=false]
     * @returns {Object[]}
     */
    function flush(opts = {}) {
        const out = rows.slice();
        if (opts.drain) rows = [];
        return out;
    }

    /** Discard everything buffered. */
    function reset() {
        rows = [];
        lastX = null;
        lastY = null;
        if (!running) {
            lifecycle = 'idle';
            failure = null;
        }
    }

    /**
     * Environment envelope fields: what a consumer needs to convert between
     * the three coordinate spaces without guessing.
     * @returns {Object}
     */
    function environment() {
        const screen = (win && win.screen) || {};
        return {
            devicePixelRatio: finite(win && win.devicePixelRatio) ? win.devicePixelRatio : 1,
            window: {
                w: finite(win && win.innerWidth) ? win.innerWidth : 0,
                h: finite(win && win.innerHeight) ? win.innerHeight : 0
            },
            screen: {
                w: finite(screen.width) ? screen.width : 0,
                h: finite(screen.height) ? screen.height : 0
            }
        };
    }

    /**
     * The envelope's `capture` block, as far as the renderer can fill it in.
     * @param {Object} [extra] - {appVersion, platform, evtrackVersion}
     * @returns {Object}
     */
    function captureMeta(extra = {}) {
        const env = environment();
        return {
            schema: 'scrutinizer-session-capture/1',
            evtrackVersion: extra.evtrackVersion || EVTRACK_COMMIT,
            pollMs: effectivePollMs,
            appVersion: extra.appVersion || null,
            platform: extra.platform ||
                (typeof navigator !== 'undefined' && navigator.platform) || null,
            screen: env.screen,
            window: env.window,
            devicePixelRatio: env.devicePixelRatio,
            health: health()
        };
    }

    /**
     * Map the buffered trail into ScanpathData.
     *
     * - `mouseTimeline` — one entry per row with usable coordinates
     * - `scrollTimeline` — one entry per row (scrollY sampled on every row, per spec)
     * - `events` — click/scroll/key/submit-class rows with their payloads
     * - `fixations` — empty: this substrate has no eye tracker
     *
     * @param {Object} [meta] - ScanpathMeta overrides (participantId, stimulusId, …)
     * @returns {Object} ScanpathData
     */
    function toScanpathData(meta = {}) {
        const mouseTimeline = [];
        const scrollTimeline = [];
        const events = [];

        for (const row of rows) {
            if (finite(row.x) && finite(row.y)) {
                const entry = { t: row.t, x: row.x, y: row.y, event: row.event };
                if (row.xpath) entry.xpath = row.xpath;
                mouseTimeline.push(entry);
            }

            // Every buffered row carries a scroll sample — reconstruction of the
            // percept needs the offset between scroll events, not just at them.
            scrollTimeline.push({ t: row.t, scrollY: row.scrollY });

            if (!STREAM_EVENTS.has(row.event)) continue;

            const data = {
                event: row.event,
                xpath: row.xpath,
                x: finite(row.x) ? row.x : null,
                y: finite(row.y) ? row.y : null,
                scrollY: row.scrollY,
                attrs: row.attrs
            };
            let type;
            if (KEY_EVENTS.has(row.event)) {
                type = 'key';
                data.masked = row.masked === true;
                if (!data.masked) {
                    data.key = row.key !== undefined ? row.key : null;
                    data.code = row.code !== undefined ? row.code : null;
                    data.ctrlKey = !!row.ctrlKey;
                    data.metaKey = !!row.metaKey;
                    data.altKey = !!row.altKey;
                    data.shiftKey = !!row.shiftKey;
                }
            } else if (row.event === 'scroll') {
                type = 'scroll';
                data.scrollX = row.scrollX;
            } else if (row.event === 'click' || row.event === 'dblclick') {
                type = 'click';
            } else {
                type = row.event;
            }
            events.push({ type, timestamp: row.t, data });
        }

        const env = environment();
        return {
            meta: Object.assign({
                dataset: 'scrutinizer',
                participantId: null,
                stimulusId: null,
                stimulusWidth: env.window.w,
                stimulusHeight: env.window.h,
                taskId,
                pollMs: effectivePollMs,
                devicePixelRatio: env.devicePixelRatio,
                startedAt: startedWallClock ? new Date(startedWallClock).toISOString() : null,
                captureHealth: health()
            }, meta),
            fixations: [],
            events,
            mouseTimeline,
            scrollTimeline
        };
    }

    return {
        start,
        stop,
        flush,
        reset,
        environment,
        captureMeta,
        health,
        toScanpathData,
        isRunning: () => running,
        // Exposed for the integration ticket: lets a host feed rows from a
        // different tracker instance (e.g. a guest webContents bridge).
        handleRow
    };
}

module.exports = {
    createEventCapture,
    isEditableTarget,
    stripValueAttrs,
    keyPayload,
    DEFAULT_POLL_MS,
    POLLED_EVENTS,
    DISCRETE_EVENTS,
    STREAM_EVENTS,
    EVTRACK_COMMIT
};
