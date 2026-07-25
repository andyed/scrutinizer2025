/**
 * Unit tests for renderer/instrumentation/event-capture.js
 *
 * The adapter takes every external dependency by injection, so these tests use
 * a fake evtrack tracker, a plain-object window and a hand-cranked clock rather
 * than JSDOM — the same lightweight-mock convention as
 * dom-primitive-classifier.test.js. DOM targets are plain objects with the two
 * or three properties the masking walk actually reads.
 *
 * Spec: docs/specs/session-capture-procedural-replay.md
 */

'use strict';

const {
    createEventCapture,
    isEditableTarget,
    stripValueAttrs,
    DEFAULT_POLL_MS,
    POLLED_EVENTS
} = require('../../renderer/instrumentation/event-capture');

/** Fake evtrack TrackUI: captures the config and exposes the sink. */
function makeTracker() {
    return {
        settings: {
            sink: null,
            regularEvents: '*',
            pollingEvents: '',
            pollingMs: 150,
            taskName: 'evtrack',
            callback: null,
            saveAttributes: true,
            debug: false
        },
        config: null,
        sink: null,
        flushed: 0,
        record(config) {
            this.config = config;
            this.sink = config.sink;
        },
        flush() {
            this.flushed++;
        }
    };
}

function makeWindow(overrides = {}) {
    return Object.assign({
        scrollX: 0,
        scrollY: 0,
        innerWidth: 1280,
        innerHeight: 800,
        devicePixelRatio: 2,
        screen: { width: 1512, height: 982 }
    }, overrides);
}

/** Monotonic fake clock in ms. */
function makeClock(start = 1000) {
    let t = start;
    return {
        now: () => t,
        set: value => { t = value; },
        advance: delta => { t += delta; }
    };
}

/** Minimal DOM element stand-in. */
function el(tag, opts = {}) {
    const attrs = opts.attrs || {};
    return {
        nodeType: 1,
        tagName: tag.toUpperCase(),
        isContentEditable: opts.isContentEditable,
        parentNode: opts.parent || null,
        getAttribute(name) {
            return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
        }
    };
}

/** An evtrack row as the vendored sink delivers it. */
function row(overrides = {}) {
    return Object.assign({
        cursorId: 0,
        timestamp: 1700000000000,
        xpos: 100,
        ypos: 200,
        event: 'mousemove',
        xpath: '/html/body/div[1]',
        attrs: '{}',
        extras: '{}'
    }, overrides);
}

function harness(windowOverrides = {}) {
    const tracker = makeTracker();
    const win = makeWindow(windowOverrides);
    const clock = makeClock();
    const capture = createEventCapture({ tracker, window: win, now: clock.now });
    return { tracker, win, clock, capture };
}

describe('start() tracker configuration', () => {
    it('polls mousemove/scroll and captures discrete events as they fire', () => {
        const { tracker, capture } = harness();
        expect(capture.start({ taskId: 'billing-navigation' })).toBe(true);

        expect(tracker.config.pollingEvents).toBe(POLLED_EVENTS.join(' '));
        expect(tracker.config.pollingEvents).toBe('mousemove scroll');
        for (const name of ['mousedown', 'click', 'keydown', 'keyup', 'submit', 'wheel', 'resize']) {
            expect(tracker.config.regularEvents.split(' ')).toContain(name);
        }
        expect(tracker.config.regularEvents).not.toContain('mousemove');
        expect(tracker.config.pollingMs).toBe(DEFAULT_POLL_MS);
        expect(tracker.config.taskName).toBe('billing-navigation');
        expect(typeof tracker.config.sink).toBe('function');
    });

    it('pollMs is configurable and reported in the capture block', () => {
        const { tracker, capture } = harness();
        capture.start({ pollMs: 33 });
        expect(tracker.config.pollingMs).toBe(33);
        expect(capture.captureMeta().pollMs).toBe(33);
    });

    it('restores pristine tracker settings across restarts', () => {
        const { tracker, capture } = harness();
        capture.start();
        // evtrack rewrites these in place; emulate that.
        tracker.settings.regularEvents = ['click'];
        tracker.settings.pollingEvents = ['mousemove'];
        capture.stop();
        capture.start();
        expect(typeof tracker.settings.regularEvents).toBe('string');
        expect(typeof tracker.settings.pollingEvents).toBe('string');
    });

    it('stop() detaches the tracker listeners', () => {
        const { tracker, capture } = harness();
        capture.start();
        expect(capture.isRunning()).toBe(true);
        capture.stop();
        expect(tracker.flushed).toBe(1);
        expect(capture.isRunning()).toBe(false);
    });
});

describe('column mapping → ScanpathData', () => {
    it('maps evtrack columns onto MouseTimelineEvent fields', () => {
        const { tracker, capture } = harness({ scrollX: 0, scrollY: 0 });
        capture.start();
        tracker.sink(row({ xpos: 640, ypos: 480, event: 'mousemove', xpath: '/html/body/a[2]' }), { target: el('a') });

        const data = capture.toScanpathData();
        expect(data.mouseTimeline).toEqual([
            { t: 0, x: 640, y: 480, event: 'mousemove', xpath: '/html/body/a[2]' }
        ]);
        expect(data.fixations).toEqual([]);
    });

    it('converts page-space evtrack coords to client-viewport CSS px', () => {
        const { tracker, win, capture } = harness();
        capture.start();
        win.scrollY = 300;
        win.scrollX = 12;
        // evtrack reports pageX/pageY; the trail is viewport-relative.
        tracker.sink(row({ xpos: 112, ypos: 500 }), { target: el('div') });

        const data = capture.toScanpathData();
        expect(data.mouseTimeline[0].x).toBe(100);
        expect(data.mouseTimeline[0].y).toBe(200);
        // Page space is recoverable: yPage = y + scrollY
        expect(data.mouseTimeline[0].y + data.scrollTimeline[0].scrollY).toBe(500);
    });

    it('records click rows in events[] with value-stripped attrs', () => {
        const { tracker, capture } = harness();
        capture.start();
        tracker.sink(row({
            event: 'click',
            xpath: '/html/body/button[1]',
            attrs: '{"BUTTON":{"id":"submit","value":"Pay now"}}'
        }), { target: el('button') });

        const [event] = capture.toScanpathData().events;
        expect(event.type).toBe('click');
        expect(event.timestamp).toBe(0);
        expect(event.data.xpath).toBe('/html/body/button[1]');
        expect(event.data.attrs).toEqual({ BUTTON: { id: 'submit' } });
    });

    it('maps submit rows with their attrs payload', () => {
        const { tracker, capture } = harness();
        capture.start();
        tracker.sink(row({ event: 'submit', attrs: '{"FORM":{"action":"/search"}}' }), { target: el('form') });

        const [event] = capture.toScanpathData().events;
        expect(event.type).toBe('submit');
        expect(event.data.attrs).toEqual({ FORM: { action: '/search' } });
    });

    it('drops non-finite coordinates from the mouse timeline but keeps the scroll sample', () => {
        const { tracker, capture } = harness();
        capture.start();
        tracker.sink(row({ xpos: NaN, ypos: undefined, event: 'mousemove' }), { target: el('div') });

        const data = capture.toScanpathData();
        expect(data.mouseTimeline).toHaveLength(0);
        expect(data.scrollTimeline).toHaveLength(1);
    });

    it('reports viewport and DPR in meta so screenshot space is derivable', () => {
        const { capture } = harness();
        capture.start();
        const meta = capture.toScanpathData({ participantId: 'p07' }).meta;
        expect(meta.participantId).toBe('p07');
        expect(meta.devicePixelRatio).toBe(2);
        expect(meta.stimulusWidth).toBe(1280);
        expect(meta.stimulusHeight).toBe(800);
    });
});

describe('scroll sampling', () => {
    it('samples scrollY on EVERY row, not only on scroll events', () => {
        const { tracker, win, capture } = harness();
        capture.start();

        win.scrollY = 0;
        tracker.sink(row({ event: 'mousemove' }), { target: el('div') });
        win.scrollY = 120;
        tracker.sink(row({ event: 'mousemove' }), { target: el('div') });
        win.scrollY = 240;
        tracker.sink(row({ event: 'click' }), { target: el('a') });

        const data = capture.toScanpathData();
        expect(data.scrollTimeline.map(s => s.scrollY)).toEqual([0, 120, 240]);
        // Only one of the three rows is a scroll event, yet all three are sampled.
        expect(data.events.filter(e => e.type === 'scroll')).toHaveLength(0);
    });

    it('takes scrollY from the row itself on scroll events and holds the cursor position', () => {
        const { tracker, win, capture } = harness();
        capture.start();

        tracker.sink(row({ xpos: 400, ypos: 300, event: 'mousemove' }), { target: el('div') });
        win.scrollY = 0;  // evtrack's scroll row is authoritative, not the window read
        tracker.sink(row({ xpos: 0, ypos: 640, event: 'scroll' }), { target: el('div') });

        const data = capture.toScanpathData();
        expect(data.scrollTimeline[1].scrollY).toBe(640);
        // Cursor did not move during the scroll — last known position carries forward.
        expect(data.mouseTimeline[1]).toMatchObject({ x: 400, y: 300, event: 'scroll' });

        const scrollEvent = data.events.find(e => e.type === 'scroll');
        expect(scrollEvent.data.scrollY).toBe(640);
    });
});

describe('timestamp rebasing', () => {
    it('rebases row times to task start using the injected monotonic clock', () => {
        const tracker = makeTracker();
        const clock = makeClock(5000);
        const capture = createEventCapture({ tracker, window: makeWindow(), now: clock.now });

        capture.start();          // t0 = 5000
        clock.set(5016);
        tracker.sink(row(), { target: el('div') });
        clock.set(5032);
        tracker.sink(row(), { target: el('div') });

        expect(capture.flush().map(r => r.t)).toEqual([16, 32]);
    });

    it('re-zeroes the clock on restart and discards the previous trail', () => {
        const tracker = makeTracker();
        const clock = makeClock(1000);
        const capture = createEventCapture({ tracker, window: makeWindow(), now: clock.now });

        capture.start();
        clock.set(1500);
        tracker.sink(row(), { target: el('div') });
        clock.set(2000);
        capture.start();          // new task: t0 = 2000
        clock.set(2100);
        tracker.sink(row(), { target: el('div') });

        const trail = capture.flush();
        expect(trail).toHaveLength(1);
        expect(trail[0].t).toBe(100);
    });

    it('keeps the evtrack wall-clock stamp alongside the rebased time', () => {
        const { tracker, capture } = harness();
        capture.start();
        tracker.sink(row({ timestamp: 1700000000123 }), { target: el('div') });
        expect(capture.flush()[0].wallClock).toBe(1700000000123);
    });
});

describe('privacy masking', () => {
    function keyRowInto(target, extra = {}) {
        const { tracker, capture } = harness();
        capture.start();
        tracker.sink(row(Object.assign({ event: 'keydown', xpath: '/html/body/input[1]' }, extra)), {
            target,
            key: 'a',
            code: 'KeyA',
            ctrlKey: false,
            metaKey: false,
            altKey: false,
            shiftKey: false
        });
        return capture;
    }

    it('masks key identity for <input> targets but keeps the xpath', () => {
        const capture = keyRowInto(el('input'));
        const [event] = capture.toScanpathData().events;
        expect(event.type).toBe('key');
        expect(event.data.masked).toBe(true);
        expect(event.data.xpath).toBe('/html/body/input[1]');
        expect(event.data.key).toBeUndefined();
        expect(event.data.code).toBeUndefined();
        expect(JSON.stringify(event)).not.toContain('KeyA');
    });

    it('masks <textarea> and <select> targets', () => {
        for (const tag of ['textarea', 'select']) {
            const [event] = keyRowInto(el(tag)).toScanpathData().events;
            expect(event.data.masked).toBe(true);
            expect(event.data.key).toBeUndefined();
        }
    });

    it('masks a key event whose target sits under a contenteditable ANCESTOR', () => {
        const editor = el('div', { attrs: { contenteditable: '' } });
        const inner = el('span', { parent: el('b', { parent: editor }) });
        const [event] = keyRowInto(inner).toScanpathData().events;
        expect(event.data.masked).toBe(true);
        expect(event.data.key).toBeUndefined();
    });

    it('masks when the browser reports isContentEditable on the target', () => {
        const [event] = keyRowInto(el('div', { isContentEditable: true })).toScanpathData().events;
        expect(event.data.masked).toBe(true);
    });

    it('keeps key identity on non-editable targets (shortcut analysis)', () => {
        const { tracker, capture } = harness();
        capture.start();
        tracker.sink(row({ event: 'keydown', xpath: '/html/body' }), {
            target: el('body'),
            key: 'f',
            code: 'KeyF',
            ctrlKey: true,
            metaKey: false,
            altKey: false,
            shiftKey: false
        });

        const [event] = capture.toScanpathData().events;
        expect(event.data.masked).toBe(false);
        expect(event.data.key).toBe('f');
        expect(event.data.code).toBe('KeyF');
        expect(event.data.ctrlKey).toBe(true);
    });

    it('strips value attributes from every event, editable or not', () => {
        const { tracker, capture } = harness();
        capture.start();
        tracker.sink(row({
            event: 'change',
            attrs: '{"INPUT":{"type":"password","value":"hunter2","name":"pw"}}'
        }), { target: el('input') });

        const trail = capture.flush();
        expect(trail[0].attrs).toEqual({ INPUT: { type: 'password', name: 'pw' } });
        expect(JSON.stringify(capture.toScanpathData())).not.toContain('hunter2');
    });
});

describe('isEditableTarget', () => {
    it('recognizes the form-entry tags', () => {
        expect(isEditableTarget(el('input'))).toBe(true);
        expect(isEditableTarget(el('textarea'))).toBe(true);
        expect(isEditableTarget(el('select'))).toBe(true);
    });

    it('walks up to a contenteditable ancestor', () => {
        const editor = el('div', { attrs: { contenteditable: 'true' } });
        const child = el('span', { parent: editor });
        expect(isEditableTarget(child)).toBe(true);
    });

    it('climbs from a text node to its element parent', () => {
        const textNode = { nodeType: 3, parentNode: el('input') };
        expect(isEditableTarget(textNode)).toBe(true);
    });

    it('treats contenteditable="false" as not editable', () => {
        expect(isEditableTarget(el('div', { attrs: { contenteditable: 'false' } }))).toBe(false);
    });

    it('returns false for ordinary content', () => {
        expect(isEditableTarget(el('a', { parent: el('p', { parent: el('body') }) }))).toBe(false);
        expect(isEditableTarget(null)).toBe(false);
    });

    it('fails closed when the target cannot be inspected', () => {
        const hostile = {
            nodeType: 1,
            get tagName() { throw new Error('detached'); }
        };
        expect(isEditableTarget(hostile)).toBe(true);
    });

    it('terminates on a cyclic parent chain', () => {
        const a = el('div');
        const b = el('div', { parent: a });
        a.parentNode = b;
        expect(isEditableTarget(b)).toBe(false);
    });
});

describe('stripValueAttrs', () => {
    it('parses the evtrack JSON string and drops value at any depth', () => {
        expect(stripValueAttrs('{"INPUT":{"name":"q","value":"secret"}}'))
            .toEqual({ INPUT: { name: 'q' } });
        expect(stripValueAttrs({ value: 'x', DIV: { value: 'y', id: 'z' } }))
            .toEqual({ DIV: { id: 'z' } });
    });

    it('is case-insensitive about the attribute name', () => {
        expect(stripValueAttrs({ INPUT: { VALUE: 'secret', id: 'a' } }))
            .toEqual({ INPUT: { id: 'a' } });
    });

    it('returns {} for unparseable or missing input', () => {
        expect(stripValueAttrs('not json')).toEqual({});
        expect(stripValueAttrs(undefined)).toEqual({});
        expect(stripValueAttrs(null)).toEqual({});
    });
});

describe('defensive behaviour', () => {
    it('hardens getXPath so a detached node cannot kill capture, and restores it on stop', () => {
        const tracker = makeTracker();
        const trackLib = {
            XPath: {
                getXPath() { throw new Error('detached node'); }
            }
        };
        const capture = createEventCapture({ tracker, window: makeWindow(), trackLib });

        capture.start();
        expect(trackLib.XPath.getXPath({})).toBe('');
        capture.stop();
        expect(() => trackLib.XPath.getXPath({})).toThrow('detached node');
    });

    it('ignores rows delivered after stop()', () => {
        const { tracker, capture } = harness();
        capture.start();
        const sink = tracker.sink;
        capture.stop();
        sink(row(), { target: el('div') });
        expect(capture.flush()).toHaveLength(0);
    });

    it('reports start() failure instead of throwing when no tracker is available', () => {
        const capture = createEventCapture({ tracker: {}, window: makeWindow() });
        expect(capture.start()).toBe(false);
    });

    it('survives a row with no DOM event attached', () => {
        const { tracker, capture } = harness();
        capture.start();
        expect(() => tracker.sink(row({ event: 'keydown' }), null)).not.toThrow();
        const [event] = capture.toScanpathData().events;
        expect(event.data.masked).toBe(true);  // unknown target → masked
    });
});

describe('flush()', () => {
    it('is a non-draining read-out by default', () => {
        const { tracker, capture } = harness();
        capture.start();
        tracker.sink(row(), { target: el('div') });
        expect(capture.flush()).toHaveLength(1);
        expect(capture.flush()).toHaveLength(1);
        expect(capture.toScanpathData().mouseTimeline).toHaveLength(1);
    });

    it('drains when asked', () => {
        const { tracker, capture } = harness();
        capture.start();
        tracker.sink(row(), { target: el('div') });
        expect(capture.flush({ drain: true })).toHaveLength(1);
        expect(capture.flush()).toHaveLength(0);
    });

    it('stop() returns the buffered trail', () => {
        const { tracker, capture } = harness();
        capture.start();
        tracker.sink(row(), { target: el('div') });
        expect(capture.stop()).toHaveLength(1);
    });
});

describe('environment() / captureMeta()', () => {
    it('reports DPR, window and screen for the envelope', () => {
        const { capture } = harness();
        expect(capture.environment()).toEqual({
            devicePixelRatio: 2,
            window: { w: 1280, h: 800 },
            screen: { w: 1512, h: 982 }
        });
    });

    it('defaults DPR to 1 when the host does not report one', () => {
        const capture = createEventCapture({
            tracker: makeTracker(),
            window: makeWindow({ devicePixelRatio: undefined })
        });
        expect(capture.environment().devicePixelRatio).toBe(1);
    });

    it('stamps the vendored evtrack commit', () => {
        const { capture } = harness();
        const meta = capture.captureMeta({ appVersion: '2.8.0', platform: 'darwin' });
        expect(meta.schema).toBe('scrutinizer-session-capture/1');
        expect(meta.evtrackVersion).toMatch(/^[0-9a-f]{40}$/);
        expect(meta.appVersion).toBe('2.8.0');
        expect(meta.platform).toBe('darwin');
        expect(meta.devicePixelRatio).toBe(2);
    });
});
