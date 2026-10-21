'use strict';

// DOM-scan scheduling in renderer/preload.js. The preload can't require
// local modules (see its header), so the real file runs here in a vm
// context against a fake page and a fake clock. The page is empty: what is
// under test is when scans run and which scroll they report, not what a
// scan finds.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '../../renderer/preload.js'), 'utf8');
const FRAME_MS = 16;

function loadPreload({ idleMs = 20 } = {}) {
    let now = 0;
    let seq = 0;
    const tasks = [];
    const schedule = (delay, fn) => {
        const id = ++seq;
        tasks.push({ at: now + Math.max(0, Number(delay) || 0), id, fn });
        return id;
    };
    const cancel = (id) => {
        const i = tasks.findIndex(t => t.id === id);
        if (i >= 0) tasks.splice(i, 1);
    };
    const advanceTo = (end) => {
        for (;;) {
            tasks.sort((a, b) => a.at - b.at || a.id - b.id);
            if (!tasks.length || tasks[0].at > end) break;
            const t = tasks.shift();
            now = t.at;
            t.fn();
        }
        now = end;
    };

    const winListeners = {};
    const docListeners = {};
    const ipcHandlers = {};
    const observers = [];
    const scans = [];
    const errors = [];

    const body = { tagName: 'BODY', children: [], getElementsByTagName: () => [], querySelectorAll: () => [] };
    const document = {
        body,
        documentElement: { clientWidth: 1280, clientHeight: 800 },
        scrollingElement: null,
        activeElement: body,
        addEventListener: (type, fn) => { (docListeners[type] = docListeners[type] || []).push(fn); },
        createTreeWalker: () => ({ nextNode: () => null })
    };
    const electron = {
        contextBridge: { exposeInIsolatedWorld() {} },
        webFrame: { getZoomFactor: () => 1 },
        ipcRenderer: {
            send(channel, ...args) {
                if (channel === 'structure-update') {
                    const [, trigger, scroll] = args;
                    scans.push({ t: now, trigger, y: scroll.y });
                }
            },
            sendSync: () => true,
            on: (channel, fn) => { ipcHandlers[channel] = fn; }
        }
    };

    const sandbox = {
        require: (id) => {
            if (id !== 'electron') throw new Error(`unexpected require('${id}')`);
            return electron;
        },
        console: { log() {}, warn() {}, error: (...a) => errors.push(a.join(' ')) },
        document,
        performance: { now: () => now },
        NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
        Element: class Element {},
        MutationObserver: class MutationObserver {
            constructor(cb) { observers.push(cb); }
            observe() {}
        },
        setTimeout: (fn, delay) => schedule(delay, fn),
        clearTimeout: cancel,
        // Frames land on a fixed 16 ms grid.
        requestAnimationFrame: (cb) => schedule(FRAME_MS - (now % FRAME_MS), () => cb(now)),
        requestIdleCallback: (cb, opts) => schedule(Math.min(idleMs, (opts && opts.timeout) || Infinity), () => cb()),
        getComputedStyle: () => ({ position: 'static' }),
        addEventListener: (type, fn) => { (winListeners[type] = winListeners[type] || []).push(fn); },
        scrollX: 0,
        scrollY: 0,
        innerWidth: 1280,
        innerHeight: 800
    };
    sandbox.window = sandbox;
    vm.runInNewContext(SRC, sandbox, { filename: 'renderer/preload.js' });
    for (const fn of winListeners.DOMContentLoaded || []) fn();

    return {
        scans,
        errors,
        sandbox,
        get now() { return now; },
        advanceTo,
        scrollWindowTo(y) {
            sandbox.scrollY = y;
            for (const fn of winListeners.scroll || []) fn({});
        },
        mutate() { for (const cb of observers) cb([]); },
        ipc(channel) { ipcHandlers[channel]({}); }
    };
}

// The load-time scan: a mutation scan 500 ms after DOMContentLoaded, run on
// the first idle callback, then a 300 ms throttle.
function afterLoadScan(page) {
    page.advanceTo(600);
    expect(page.scans).toEqual([{ t: 520, trigger: 'mutation', y: 0 }]);
    // Throttle holds until 820.
}

describe('preload DOM-scan schedule', () => {
    it('scans a jump scroll that lands inside a mutation scan\'s throttle once the throttle clears', () => {
        const page = loadPreload();
        afterLoadScan(page);
        page.scrollWindowTo(1500);
        page.advanceTo(3000);

        const after = page.scans.filter(s => s.t >= 600);
        expect(after.length).toBeGreaterThan(0);
        expect(after[0]).toMatchObject({ trigger: 'scroll', y: 1500 });
        // Throttle end (820) plus at most one frame.
        expect(after[0].t).toBeLessThanOrEqual(820 + FRAME_MS);
        expect(page.errors).toEqual([]);
    });

    it('runs requests held during the throttle as one scan, not one per request', () => {
        const page = loadPreload();
        afterLoadScan(page);
        // Three scroll events and the 100 ms final scan all fall in the throttle.
        page.scrollWindowTo(1500);
        page.advanceTo(610);
        page.scrollWindowTo(1510);
        page.advanceTo(620);
        page.scrollWindowTo(1520);
        page.advanceTo(3000);

        expect(page.scans.filter(s => s.t >= 600)).toEqual([{ t: 832, trigger: 'scroll', y: 1520 }]);
    });

    it('scans a jump that lands while the mutation scan waits for idle time', () => {
        const page = loadPreload({ idleMs: 200 });
        page.advanceTo(550);
        expect(page.scans).toEqual([]);
        page.scrollWindowTo(1500);
        page.advanceTo(3000);

        // The pending mutation scan measures the new position; a scroll scan
        // still follows so the HUD sees a 'scroll' trigger for the move.
        expect(page.scans[0]).toEqual({ t: 700, trigger: 'mutation', y: 1500 });
        expect(page.scans.slice(1)).toEqual([{ t: 1008, trigger: 'scroll', y: 1500 }]);
    });

    it('does not lose a navigation force-scan that lands inside the throttle', () => {
        const page = loadPreload();
        afterLoadScan(page);
        page.sandbox.scrollY = 900;
        page.ipc('browser:force-scan');
        page.advanceTo(3000);

        expect(page.scans.filter(s => s.t >= 600)).toEqual([{ t: 832, trigger: 'scroll', y: 900 }]);
    });

    it('keeps the 16 ms scroll throttle during continuous scrolling', () => {
        const page = loadPreload();
        page.advanceTo(1000);
        const start = page.scans.length;
        for (let t = 1000, y = 0; t < 1500; t += 8, y += 8) {
            page.advanceTo(t);
            page.scrollWindowTo(y);
        }
        page.advanceTo(3000);

        const during = page.scans.slice(start);
        expect(during.length).toBeGreaterThan(10);
        for (let i = 1; i < during.length; i++) {
            expect(during[i].t - during[i - 1].t).toBeGreaterThanOrEqual(FRAME_MS);
        }
        // The last scan reports where the scroll stopped.
        expect(during[during.length - 1].y).toBe(496);
    });

    it('keeps the typing debounce: no mutation scan until 1.5 s after the last keystroke mutation', () => {
        const page = loadPreload();
        page.advanceTo(1000);
        const start = page.scans.length;
        page.sandbox.document.activeElement = { tagName: 'INPUT' };
        page.mutate();
        page.advanceTo(1400);
        page.mutate();
        page.advanceTo(2899);
        expect(page.scans.length).toBe(start);

        page.sandbox.document.activeElement = page.sandbox.document.body;
        page.advanceTo(4000);
        expect(page.scans.slice(start)).toEqual([{ t: 2920, trigger: 'mutation', y: 0 }]);
    });
});
