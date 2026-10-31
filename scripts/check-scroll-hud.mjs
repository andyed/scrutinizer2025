#!/usr/bin/env node
/**
 * check-scroll-hud.mjs: motion gate for the foveated HUD.
 *
 * LOCAL ONLY. It launches the real Electron app from source and watches the
 * HUD while pages scroll, so it needs a display and a GPU. CI runs Jest in
 * Node with neither, so this gate runs on a developer machine before every
 * release build (DEPLOY.md). The capture scripts scroll instantly and then
 * settle, so none of them sees the HUD while the page is moving; this does.
 *
 * What it does:
 *   1. Picks a free port, launches `electron .` with --remote-debugging-port
 *      and a throwaway profile (no welcome popup, fixture as start page).
 *   2. Loads each fixture in tests/fixtures/scroll/ and scrolls it
 *      continuously: rAF scrollBy and wheel input, down and up, 8 and
 *      40 px/frame, 1.5 s per run.
 *        encoded-page.html  window scroll; a gray-code gutter makes every
 *                           captured frame name the scroll it shows
 *        lock-page.html     window scroll under a fixed header and a stuck
 *                           sticky header, each with its own gutter
 *        pane-page.html     an overflow:auto pane scrolls, the window holds
 *      Each run starts settled: the frame on screen and the newest DOM scan
 *      were taken at the start position, and both boxes are in the HUD's
 *      lock list.
 *   3. Samples the HUD during motion: canvas visibility (4 ms poll plus a
 *      MutationObserver), each received frame's registered scroll against
 *      the scroll its pixels show, and, on every render, the displayed
 *      content position. On the lock page it reads the HUD's own output
 *      (readPixels, with a radius that makes every pixel foveal; see
 *      installHudRecorder) at the article gutter and at both boxes.
 *   4. Interaction runs (serp-page.html, a results page that changes under
 *      the pointer): hover cards, iframe previews, an accordion, pushState
 *      tabs, typing into a suggestion box, and links to the next page. Each
 *      drives CDP mouse and key input for about 1.5 s with the page still,
 *      and samples canvas visibility and the alpha of the HUD's output
 *      (three rows and three columns per render). The HUD window is
 *      transparent, so a hidden canvas or a pixel with alpha below 255
 *      shows the unfoveated page.
 *
 * Fails (exit 1) when any run shows:
 *   - the overlay canvas hidden for any part of the scroll or interaction
 *     (> 0%), or, on an interaction run, any probed output pixel with
 *     alpha below 255;
 *   - registered - true scroll above 0 px on a frame the HUD registered
 *     (gutters decode whole CSS px, so "0" means |error| <= 0.5 px);
 *   - a backward step: displayed content moving against the scroll;
 *   - a fixed or sticky box drifting from its rest position, or drawn
 *     somewhere other than where the DOM puts it;
 *   - too little data to judge (no scroll, too few frames or renders, an
 *     interaction whose page events did not happen), or a scroll that
 *     reached the end of its fixture;
 *   - a run that cannot reach its settled start state.
 * Exit 2: the harness itself could not run (no free port, no app).
 *
 * usage: npm run check:scroll [-- --only=window,lock,pane,interact]
 *        [--interact=hover,iframe,expand,tabs,type,navigate] [--port=9350]
 *        [--ms=1500] [--json=report.json] [--raw=dir] [--keep]
 *        [--throttle=hud:2,page:2]
 *   --json writes the per-run metrics, --raw each run's sample logs.
 *   --keep leaves the app running and its profile on disk when done.
 *   --throttle slows the HUD's or the page's main thread N times over CDP,
 *     to rehearse a busy machine: hud:2 stretches captures from about 50 to
 *     70 ms apart, hud:4 to 100-150 ms (as seen with Psychodeli+ running).
 *     Twelve CPU-bound threads alone left the capture rate unchanged.
 *
 * Leave the app window alone while it runs (about two minutes): real mouse
 * and wheel input reach the page too.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'tests/fixtures/scroll');
const require = createRequire(import.meta.url);

const flags = Object.fromEntries(process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
}));
const DURATION = Number(flags.ms || 1500);
const ONLY = flags.only ? String(flags.only).split(',') : ['window', 'lock', 'pane', 'interact'];

// Below these counts a run cannot judge anything: a HUD that stopped
// rendering would otherwise pass every check vacuously. The 4 ms visibility
// poll gives about 200 samples a run at 2x, more at 1x, provided nothing
// blocks the HUD's main thread (the lock and interaction runs read pixels
// asynchronously for that reason); the MutationObserver still sees every
// change.
const MIN = { visSamples: 60, frames: 10, renders: 30, boxRenders: 10, scrollSteps: 30, alphaProbes: 20 };
// Gutters decode whole CSS px.
const TOL = 0.5;

const sleep = ms => new Promise(r => setTimeout(r, ms));
class HarnessError extends Error {}

// ── Fixtures and runs ───────────────────────────────────────────────

const fixtureUrl = (name) => pathToFileURL(path.join(FIXTURES, name)).href;

const FIXTURE = {
    window: {
        file: 'encoded-page.html',
        // 40 px/frame for 1.5 s travels 7200 px at 120 Hz, 8640 at 144 Hz.
        start: { down: 0, up: 12000 },
        wheelAt: () => ({ x: 600, y: 400 }),
        // Viewport rows (CSS px) where the window gutter is decoded.
        winRows: Array.from({ length: 9 }, (_, k) => 20 + k * 37)
    },
    lock: {
        file: 'lock-page.html',
        start: { down: 1500, up: 12000 },
        // Left margin: clear of main and of the inner pane, so the wheel
        // scrolls the window.
        wheelAt: () => ({ x: 160, y: 400 }),
        // Below the 60 px fixed header.
        winRows: Array.from({ length: 9 }, (_, k) => 80 + k * 37),
        boxes: [
            { name: 'fixed header', sel: '#hdr', gutterX: 40 },
            { name: 'sticky header', sel: '#sec', gutterX: 8 }
        ]
    },
    pane: {
        file: 'pane-page.html',
        start: { down: 200, up: 12000 },
        windowY: 400,
        wheelAt: (geo) => ({ x: Math.round(geo.left + geo.width / 2), y: Math.round(geo.top + geo.height / 2) }),
        winRows: Array.from({ length: 9 }, (_, k) => 20 + k * 37)
    }
};

const RUNS = [];
for (const fixture of ONLY) {
    if (fixture === 'interact') continue;
    if (!FIXTURE[fixture]) throw new Error(`unknown fixture '${fixture}' (window, lock, pane, interact)`);
    for (const driver of ['raf', 'wheel']) {
        for (const dir of [1, -1]) {
            for (const step of [8, 40]) RUNS.push({ fixture, driver, dir, step });
        }
    }
}
const runLabel = (r) => `${r.fixture} ${r.driver === 'raf' ? 'scrollBy' : 'wheel'} ${r.dir > 0 ? 'down' : 'up'} ${r.step}px`;

// Interaction runs on serp-page.html. `min` is the page events a run must
// produce to count (serp-page's own counters; navigate counts loads).
// navigate leaves the page on another URL, so it runs last.
const SERP = 'serp-page.html';
const INTERACT = {
    hover: { counter: 'cards', min: 6 },
    iframe: { counter: 'frames', min: 4 },
    expand: { counter: 'toggles', min: 6 },
    tabs: { counter: 'tabs', min: 6 },
    type: { counter: 'suggests', min: 10 },
    navigate: { counter: 'loads', min: 2 }
};
const ASKED = flags.interact ? String(flags.interact).split(',') : Object.keys(INTERACT);
for (const name of ASKED) {
    if (!INTERACT[name]) throw new Error(`unknown interaction '${name}' (${Object.keys(INTERACT).join(', ')})`);
}
// In INTERACT's order whatever the flag's, so navigate stays last.
const INTERACT_RUNS = !ONLY.includes('interact') ? [] : Object.keys(INTERACT).filter(k => ASKED.includes(k));
// Effects trail their input (a load or scan answers a click a few frames
// later), so an interaction run is judged until this long after its input.
const INTERACT_TAIL = 500;

// ── App lifecycle ───────────────────────────────────────────────────

function portFree(port) {
    return new Promise((resolve) => {
        // Nothing may answer on it, and we must be able to bind it.
        const probe = net.connect({ port, host: '127.0.0.1' });
        probe.once('connect', () => { probe.destroy(); resolve(false); });
        probe.once('error', () => {
            const srv = net.createServer();
            srv.once('error', () => resolve(false));
            srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
        });
    });
}

async function findFreePort(start) {
    for (let p = start; p < start + 50; p++) {
        if (await portFree(p)) return p;
    }
    throw new HarnessError(`no free port in ${start}-${start + 49}`);
}

function launchApp(port) {
    const electronBin = require('electron');
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'scrutinizer-scroll-gate-'));
    // Throwaway profile: no welcome popup over the HUD, a start page that
    // needs no network, and a window that fits a laptop screen.
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
        showWelcomePopup: false,
        startPage: fixtureUrl(FIXTURE.window.file),
        windowBounds: { x: 40, y: 40, width: 1280, height: 860 },
        visualMemory: 0,
        _foveaDegMigrated: true
    }, null, 2));
    const logPath = path.join(userData, 'app.log');
    const log = fs.openSync(logPath, 'w');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.TEST_MODE;
    const child = spawn(electronBin, [
        ROOT,
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userData}`,
        // Keep the HUD rendering and capturing if another window covers it.
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling'
    ], { cwd: ROOT, env, stdio: ['ignore', log, log] });
    fs.closeSync(log);
    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    return { child, exited, userData, logPath };
}

async function stopApp(app) {
    if (!app || app.child.exitCode !== null || app.child.signalCode !== null) return;
    // Signal only the process this script spawned.
    app.child.kill('SIGTERM');
    const done = await Promise.race([app.exited, sleep(8000).then(() => null)]);
    if (!done) {
        app.child.kill('SIGKILL');
        await app.exited;
    }
}

function tailLog(app, lines = 30) {
    try {
        return fs.readFileSync(app.logPath, 'utf8').split('\n').slice(-lines).join('\n');
    } catch {
        return '(no log)';
    }
}

// ── CDP ─────────────────────────────────────────────────────────────

function connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
        }
    };
    ws.onclose = () => {
        for (const { reject } of pending.values()) reject(new Error('CDP socket closed'));
        pending.clear();
    };
    const ready = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        if (ws.readyState !== WebSocket.OPEN) { reject(new Error('CDP socket not open')); return; }
        const mid = ++id;
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
    });
    const evaluate = async (expression) => {
        const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
        return r.result.value;
    };
    // Run a function defined in this file inside the target, with JSON args.
    const call = (fn, ...args) => evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
    return { ready, send, evaluate, call, close: () => ws.close() };
}

/**
 * Poll fn until it returns something truthy other than { ok: false, ... };
 * that shape is kept as the last state for the timeout message.
 */
async function waitFor(what, fn, timeoutMs = 20000, everyMs = 250) {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < timeoutMs) {
        try {
            const v = await fn();
            if (v && (typeof v !== 'object' || v.ok !== false)) return v;
            last = v;
        } catch (e) {
            if (e instanceof HarnessError) throw e;
            last = e.message;
        }
        await sleep(everyMs);
    }
    const state = last === undefined ? '' : ` (last: ${(typeof last === 'string' ? last : JSON.stringify(last)).slice(0, 300)})`;
    throw new HarnessError(`timed out after ${timeoutMs} ms waiting for ${what}${state}`);
}

async function attach(port, app) {
    const rootUrl = pathToFileURL(ROOT).href;
    const targets = await waitFor('the HUD and page targets', async () => {
        if (app.child.exitCode !== null) throw new HarnessError(`app exited (${app.child.exitCode})\n${tailLog(app)}`);
        const all = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        // The HUD must be this checkout's, not some other app on the port.
        const hudT = all.find(t => t.url.startsWith(rootUrl) && t.url.endsWith('renderer/overlay.html'));
        const pageT = all.find(t => t.type === 'page' && t.url.startsWith(pathToFileURL(FIXTURES).href));
        return hudT && pageT ? { hudT, pageT } : null;
    }, 60000, 500);
    const hud = connect(targets.hudT.webSocketDebuggerUrl);
    const page = connect(targets.pageT.webSocketDebuggerUrl);
    await hud.ready;
    await page.ready;
    return { hud, page };
}

// ── In-target code (serialized with Function#toString) ──────────────

/** HUD: foveation on, frames arriving, canvas up. */
function hudState() {
    const s = window._scrutinizer;
    const canvas = document.getElementById('overlay-canvas');
    if (!s || !canvas) return null;
    return {
        enabled: !!s.enabled,
        uploads: s.frameUploadCount || 0,
        visible: canvas.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
        dpr: devicePixelRatio, w: innerWidth, h: innerHeight,
        canvasW: canvas.width, canvasH: canvas.height
    };
}

/** HUD: registration state, to wait for a settled frame before a run. */
function hudRegistration() {
    const reg = window._scrutinizer.scrollRegistration();
    return {
        frameY: reg.frameScroll ? reg.frameScroll.y : null,
        liveY: reg.liveScroll ? reg.liveScroll.y : null,
        off: reg.frameOffsetCss.y,
        paneOff: reg.paneOffsetCss.y,
        livePaneY: reg.livePane ? reg.livePane.y : null,
        lock: reg.lock.length,
        lockRects: window._scrutinizer._scrollLockRects,
        // Scroll the newest DOM scan was measured at.
        structureY: window._scrutinizer._scrollSources.structure ? window._scrutinizer._scrollSources.structure.y : null
    };
}

/** HUD: stamp every DOM scan that reaches the HUD (installed once). */
function watchScans() {
    if (window.__gateScans) return true;
    window.__gateScans = { at: performance.now(), n: 0 };
    require('electron').ipcRenderer.on('structure-update', () => {
        window.__gateScans.at = performance.now();
        window.__gateScans.n++;
    });
    return true;
}

/** HUD: ms since the last DOM scan arrived. */
function msSinceScan() {
    return performance.now() - window.__gateScans.at;
}

/**
 * HUD recorder. Visibility of the overlay canvas, truth for every received
 * frame (decoded from the frame buffer), and per render the displayed
 * content position; with cfg.pixels, the HUD's own output decoded at the
 * article gutter and at each box's gutter.
 */
function installHudRecorder(cfg) {
    const { ipcRenderer } = require('electron');
    const now = () => performance.timeOrigin + performance.now();
    const s = window._scrutinizer;
    const canvas = document.getElementById('overlay-canvas');
    const R = window.__scrollGate = {
        cfg, frames: [], srcs: [], renders: [], vis: [],
        lastSrc: s._scrollSources.frame, shownTrue: null, shownTruePane: null
    };

    // Any style/class change anywhere in the HUD, plus a 4 ms poll for
    // changes the observer cannot see.
    const visible = () => canvas.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const mark = () => R.vis.push([now(), visible() ? 1 : 0]);
    R.observer = new MutationObserver(mark);
    R.observer.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['style', 'class', 'hidden'] });
    R.timer = setInterval(mark, 4);
    mark();

    // Median over rows of (decoded gutter value - row offset), from a BGRA
    // frame buffer. rowBase is the viewport y the gutter's own 0 sits at.
    const decodeFrame = (data, x0, rows, rowBase) => {
        const buf = data.buffer;
        if (!buf) return null;
        const W = data.width, H = data.height;
        const scale = W / (data.viewWidth || innerWidth) * (data.scrollZoom || 1);
        const vals = [];
        for (const rowCss of rows) {
            const r = Math.round(rowCss * scale);
            if (r >= H) continue;
            let v = 0, ok = true;
            for (let d = 0; d < 4; d++) {
                const x = Math.round((x0 + 6 * d + 3) * scale);
                const i = (r * W + x) * 4;
                const b = buf[i], g = buf[i + 1], rr = buf[i + 2];
                if (Math.abs(b - g) > 6 || Math.abs(g - rr) > 6) { ok = false; break; }
                v = v * 16 + Math.round(g / 17);
            }
            if (ok) vals.push(v - (rowCss - rowBase));
        }
        if (!vals.length) return null;
        vals.sort((a, b) => a - b);
        return vals[Math.floor(vals.length / 2)];
    };

    R.onFrame = (e, data) => {
        // The overlay's own listener ran first: a new source object means
        // this frame was registered and uploaded.
        const src = s._scrollSources.frame;
        const uploaded = !!src && src !== R.lastSrc;
        R.lastSrc = src;
        const trueY = decodeFrame(data, 0, cfg.winRows, 0);
        const truePane = cfg.pane ? decodeFrame(data, cfg.pane.left, cfg.pane.rows, cfg.pane.top) : null;
        // The pane's stamps from both sides of the capture, for --raw: a pane
        // registered at paneStamp with method 'stamp' mid-scroll took the
        // fallback rather than an image match.
        R.frames.push({
            t: now(), uploaded, trueY, truePane, stampY: data.scrollY,
            paneStamp: data.pane ? data.pane.y : null,
            paneStampBefore: data.paneBefore ? data.paneBefore.y : null
        });
        R.srcs.push(uploaded ? src : null);
        if (uploaded) { R.shownTrue = trueY; R.shownTruePane = truePane; }
    };
    ipcRenderer.on('hud:frame-captured', R.onFrame);

    // HUD output decode (cfg.pixels): 24 CSS px wide strips at the article
    // gutter and at each box's gutter, read right after the render, before
    // compositing clears the buffer. A synchronous readPixels waits for the
    // whole render on the GPU; on a 2x canvas that cut the HUD from about
    // 120 to 25-55 renders/s and starved the visibility poll and the
    // capture loop. Each render's strips go into a pixel buffer instead and are
    // decoded on a later render, once its fence has passed.
    const gl = s.renderer.gl;
    const scale = s.canvas.width / innerWidth;
    const H = s.canvas.height;
    const strips = [];
    let stripBytes = 0;
    if (cfg.pixels) {
        for (const x0 of [0, ...cfg.pixels.boxes.map(b => b.x)]) {
            const w = Math.ceil(24 * scale) + 1;
            strips.push({ x: Math.round(x0 * scale), w, offset: stripBytes });
            stripBytes += w * H * 4;
        }
    }
    const pixelHost = new Uint8Array(stripBytes);
    for (const st of strips) st.buf = pixelHost.subarray(st.offset, st.offset + st.w * H * 4);
    R.pixelPool = strips.length ? Array.from({ length: 16 }, () => {
        const pbo = gl.createBuffer();
        const prev = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, stripBytes, gl.STREAM_READ);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prev);
        return pbo;
    }) : [];
    R.pixelPending = [];
    const decodeOut = (st, x0, cssRow) => {
        // The device row under the CSS row's center.
        const r = Math.floor((cssRow + 0.5) * scale);
        if (r >= H) return null;
        const gy = H - 1 - r;
        let v = 0;
        for (let d = 0; d < 4; d++) {
            const xi = Math.round((x0 + 6 * d + 3) * scale) - st.x;
            const i = (gy * st.w + xi) * 4;
            const R_ = st.buf[i], G = st.buf[i + 1], B = st.buf[i + 2];
            if (Math.abs(R_ - G) > 10 || Math.abs(G - B) > 10) return null;
            v = v * 16 + Math.round(G / 17);
        }
        return v;
    };
    const median = (a) => {
        if (!a.length) return null;
        const b = a.slice().sort((x, y) => x - y);
        return b[Math.floor(b.length / 2)];
    };
    // A box is found when most decodable rows name the same top; rows of
    // whatever gray pixels a moved box left behind decode to noise.
    const agreed = (a) => {
        const m = median(a);
        if (m === null) return null;
        return a.filter(v => Math.abs(v - m) <= 1).length >= 0.6 * a.length ? m : null;
    };
    const decodePixels = (p) => {
        const prev = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, p.pbo);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixelHost);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prev);
        gl.deleteSync(p.sync);
        R.pixelPool.push(p.pbo);
        // Article: viewport row - page y.
        const art = [];
        for (let k = cfg.pixels.artTop; k < innerHeight - cfg.pixels.artBottom; k += 5) {
            const v = decodeOut(strips[0], 0, k);
            if (v !== null) art.push(v - k);
        }
        p.rec.art = median(art);
        // Boxes: the viewport row where the box's local 0 is drawn.
        p.rec.boxes = cfg.pixels.boxes.map((b, i) => {
            const tops = [];
            for (let k = Math.ceil(b.top) + 4; k < b.top + b.height - 4; k += 2) {
                const v = decodeOut(strips[i + 1], b.x, k);
                if (v !== null) tops.push(k - v);
            }
            return agreed(tops);
        });
    };
    // wait: block on the fence (end of the run) instead of skipping.
    R.drainPixels = (wait) => {
        while (R.pixelPending.length) {
            const p = R.pixelPending[0];
            const st = gl.clientWaitSync(p.sync, 0, 0);
            if (!wait && st !== gl.ALREADY_SIGNALED && st !== gl.CONDITION_SATISFIED) break;
            if (wait) gl.finish();
            R.pixelPending.shift();
            decodePixels(p);
        }
    };
    const probePixels = (rec) => {
        R.drainPixels(false);
        // Pool empty: this render goes unprobed (no art or boxes) rather
        // than stalling.
        const pbo = R.pixelPool.pop();
        if (!pbo) return;
        const prev = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        for (const st of strips) gl.readPixels(st.x, 0, st.w, H, gl.RGBA, gl.UNSIGNED_BYTE, st.offset);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prev);
        R.pixelPending.push({ pbo, rec, sync: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) });
        gl.flush();
    };
    if (cfg.pixels) {
        // Every pixel the source sample: no blur, pooling or scramble over
        // the gutters. A wide fovea is not enough on its own. In the cortical
        // (CMF) modes, the default 12 among them, the radius only converts px
        // to degrees, and V1's scramble starts at a fixed fraction of the
        // viewport's eccentricity extent, at any radius. The shader drops to
        // a fixed 25 deg extent, which puts every fragment near 0 deg, only
        // when the whole viewport spans under ~0.29 deg (u_cortical_max <=
        // 0.1): radius > half-diagonal / 0.29. A fixed 5000 px cleared that
        // on a 1x canvas (half-diagonal 753 px) but not on a 2x one (1505 px),
        // so the radius scales with the canvas, 100x past that threshold.
        R.savedRadius = s.config.fovealRadius;
        s.config.fovealRadius = 100 * Math.hypot(s.canvas.width, s.canvas.height) / 2 / 0.29;
    }
    // Output alpha (cfg.alpha): three full rows and three full columns per
    // render. The context has alpha and preserveDrawingBuffer, and the HUD
    // window is transparent, so alpha below 255 lets the page show through.
    // A synchronous readPixels waits for the whole render on the GPU and
    // starves the capture loop, so each probe reads into a pixel buffer and
    // is decoded on a later render, once its fence has passed.
    const alphaLines = [];
    let alphaBytes = 0;
    if (cfg.alpha) {
        for (const f of [0.2, 0.5, 0.8]) {
            for (const l of [{ x: 0, y: Math.round(f * H), w: s.canvas.width, h: 1 },
                { x: Math.round(f * s.canvas.width), y: 0, w: 1, h: H }]) {
                alphaLines.push({ ...l, offset: alphaBytes });
                alphaBytes += l.w * l.h * 4;
            }
        }
    }
    R.alphaPool = alphaLines.length ? Array.from({ length: 8 }, () => {
        const pbo = gl.createBuffer();
        const prev = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, alphaBytes, gl.STREAM_READ);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prev);
        return pbo;
    }) : [];
    R.alphaPending = [];
    const alphaHost = new Uint8Array(alphaBytes);
    const decodeAlpha = (p) => {
        const prev = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, p.pbo);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, alphaHost);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prev);
        gl.deleteSync(p.sync);
        R.alphaPool.push(p.pbo);
        let clear = 0, min = 255, n = 0;
        for (let i = 3; i < alphaHost.length; i += 4) {
            const a = alphaHost[i];
            if (a < 255) clear++;
            if (a < min) min = a;
            n++;
        }
        p.rec.alpha = { clear, min, n };
    };
    // wait: block on the fence (end of the run) instead of skipping.
    R.drainAlpha = (wait) => {
        while (R.alphaPending.length) {
            const p = R.alphaPending[0];
            const st = gl.clientWaitSync(p.sync, 0, 0);
            if (!wait && st !== gl.ALREADY_SIGNALED && st !== gl.CONDITION_SATISFIED) break;
            if (wait) gl.finish();
            R.alphaPending.shift();
            decodeAlpha(p);
        }
    };
    const probeAlpha = (rec) => {
        R.drainAlpha(false);
        // Pool empty: this render goes unprobed rather than stalling.
        const pbo = R.alphaPool.pop();
        if (!pbo) return;
        const prev = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        for (const l of alphaLines) gl.readPixels(l.x, l.y, l.w, l.h, gl.RGBA, gl.UNSIGNED_BYTE, l.offset);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prev);
        R.alphaPending.push({ pbo, rec, sync: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) });
        gl.flush();
    };

    // The constructor binds render onto the instance; wrap that and put it
    // back afterwards.
    R.ownRender = s.render;
    s.render = function gateRender() {
        R.ownRender.call(s);
        const reg = s.scrollRegistration();
        const rec = {
            t: now(),
            off: reg.frameOffsetCss.y,
            paneOff: reg.paneOffsetCss.y,
            live: reg.liveScroll ? reg.liveScroll.y : null,
            livePane: reg.livePane ? reg.livePane.y : null,
            frameY: reg.frameScroll ? reg.frameScroll.y : null,
            shownTrue: R.shownTrue,
            shownTruePane: R.shownTruePane,
            nlock: reg.lock.length
        };
        if (cfg.pixels) probePixels(rec);
        if (alphaLines.length) probeAlpha(rec);
        R.renders.push(rec);
    };
    return true;
}

/** HUD: stop recording, restore the instance, return the log. */
function collectHudRecorder() {
    const s = window._scrutinizer;
    const R = window.__scrollGate;
    clearInterval(R.timer);
    R.observer.disconnect();
    require('electron').ipcRenderer.removeListener('hud:frame-captured', R.onFrame);
    s.render = R.ownRender;
    R.drainPixels(true);
    for (const pbo of R.pixelPool) s.renderer.gl.deleteBuffer(pbo);
    R.drainAlpha(true);
    for (const pbo of R.alphaPool) s.renderer.gl.deleteBuffer(pbo);
    if (R.savedRadius !== undefined) s.config.fovealRadius = R.savedRadius;
    // Labels can be revised after arrival (scroll-onset frames): read them now.
    R.frames.forEach((f, i) => {
        const src = R.srcs[i];
        f.regY = src ? src.y : null;
        f.regPane = src && src.pane ? src.pane.y : null;
        f.method = src ? src.method : 'skipped';
        f.paneMethod = src && src.pane ? src.pane.method : null;
    });
    delete window.__scrollGate;
    return JSON.stringify({ frames: R.frames, renders: R.renders, vis: R.vis });
}

/** Page: sample scroll positions every rAF until done. */
function installPageRecorder() {
    const now = () => performance.timeOrigin + performance.now();
    const pane = window.__pane;
    const P = window.__scrollGate = {
        scroll: [], start: 0, end: 0, done: false,
        // Scroll extents, to tell a run that hit the end of the page.
        max: document.documentElement.scrollHeight - innerHeight,
        paneMax: pane ? pane.scrollHeight - pane.clientHeight : null
    };
    const tick = () => {
        P.scroll.push({ t: now(), y: scrollY, pane: window.__pane ? window.__pane.scrollTop : null });
        if (!P.done) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
}

/** Page: scroll `target` by dy every rAF for ms; resolve when done. */
function driveScrollBy(target, dy, ms) {
    return new Promise((resolve) => {
        const P = window.__scrollGate;
        const now = () => performance.timeOrigin + performance.now();
        const el = target === 'pane' ? window.__pane : window;
        P.start = now();
        const step = () => {
            if (now() - P.start >= ms) { P.end = now(); resolve(true); return; }
            el.scrollBy(0, dy);
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    });
}

function markPage(key) {
    window.__scrollGate[key] = performance.timeOrigin + performance.now();
    return true;
}

function collectPageRecorder() {
    const P = window.__scrollGate;
    P.done = true;
    delete window.__scrollGate;
    return JSON.stringify(P);
}

/** Page: position the scroll for a run. */
function positionPage(windowY, paneY) {
    window.scrollTo(0, windowY);
    if (window.__pane && paneY !== null) window.__pane.scrollTop = paneY;
    return { y: scrollY, pane: window.__pane ? window.__pane.scrollTop : null };
}

/** Page: geometry of the pane's scrollport, viewport CSS px. */
function paneGeometry() {
    const p = window.__pane;
    const r = p.getBoundingClientRect();
    return { left: r.left + p.clientLeft, top: r.top + p.clientTop, height: p.clientHeight, width: p.clientWidth };
}

/** Page: viewport rects of the boxes that must hold still. */
function boxGeometry(boxes) {
    return boxes.map((b) => {
        const r = document.querySelector(b.sel).getBoundingClientRect();
        return { ...b, x: r.left + b.gutterX, top: r.top, height: r.height };
    });
}

// ── Interaction drivers (CDP input, serp-page.html) ─────────────────

const mouse = (page, type, x, y, extra = {}) =>
    page.send('Input.dispatchMouseEvent', { type, x, y, ...extra });

async function click(page, x, y) {
    await mouse(page, 'mouseMoved', x, y);
    await mouse(page, 'mousePressed', x, y, { button: 'left', clickCount: 1 });
    await mouse(page, 'mouseReleased', x, y, { button: 'left', clickCount: 1 });
}

const serpGeometry = (page) => page.evaluate('window.__serpGeometry()');
const serpCounters = async (page) => JSON.parse(await page.evaluate('JSON.stringify(window.__serp)'));

/** One mouse move per display frame through `points`, in turn, for ms. */
async function sweep(page, points, ms) {
    const t0 = Date.now();
    for (let i = 0; Date.now() - t0 < ms; i++) {
        const p = points[i % points.length];
        await mouse(page, 'mouseMoved', p.x, p.y);
        await sleep(16);
    }
}

/** Each returns the page events it caused when the page cannot count them. */
const DRIVE = {
    // Across each result on screen, entering a new one every 64 ms.
    async hover(page) {
        const g = await serpGeometry(page);
        const pts = g.results.filter(r => r.bottom < g.vh).flatMap(r =>
            [40, 200, 400, r.right - r.left - 40].map(dx => ({ x: Math.round(r.left + dx), y: r.y })));
        await sweep(page, pts, DURATION);
    },
    // Round each thumbnail, about 100 ms per preview.
    async iframe(page) {
        const g = await serpGeometry(page);
        const ring = [[-40, -20], [0, -20], [40, -20], [40, 20], [0, 20], [-40, 20]];
        const pts = g.videos.flatMap(v => ring.map(([dx, dy]) => ({ x: v.x + dx, y: v.y + dy })));
        await sweep(page, pts, DURATION);
    },
    // Open and close the questions in turn; answers move the ones below.
    async expand(page) {
        const t0 = Date.now();
        for (let i = 0; Date.now() - t0 < DURATION; i++) {
            const g = await serpGeometry(page);
            const q = g.questions.filter(b => b.bottom < g.vh);
            const b = q[i % q.length];
            await click(page, b.x, b.y);
            await sleep(100);
        }
    },
    async tabs(page) {
        const g = await serpGeometry(page);
        const t0 = Date.now();
        for (let i = 0; Date.now() - t0 < DURATION; i++) {
            const b = g.tabs[i % g.tabs.length];
            await click(page, b.x, b.y);
            await sleep(100);
        }
    },
    async type(page) {
        const g = await serpGeometry(page);
        await click(page, g.query.x, g.query.y);
        const text = ' crowding acuity eccentricity pooling saccade';
        const t0 = Date.now();
        for (let i = 0; Date.now() - t0 < DURATION; i++) {
            await page.send('Input.insertText', { text: text[i % text.length] });
            await sleep(40);
        }
    },
    // Follow "Next page" three times, each once the HUD has frames of the
    // page it landed on.
    async navigate(page, hud) {
        let loads = 0;
        const t0 = Date.now();
        while (loads < 3 && Date.now() - t0 < 8000) {
            const g = await serpGeometry(page);
            const from = await page.evaluate('location.href');
            await click(page, g.next.x, g.next.y);
            await waitFor('the next results page', () => page.evaluate(
                `location.href !== ${JSON.stringify(from)} && document.readyState === 'complete' && !!window.__serpGeometry`), 5000, 20);
            loads++;
            const up = (await hud.call(hudState)).uploads;
            await waitFor('frames from the next results page',
                async () => (await hud.call(hudState)).uploads > up + 2, 5000, 20);
        }
        return loads;
    }
};

// ── One run ─────────────────────────────────────────────────────────

async function runOne(run, { hud, page }) {
    const fx = FIXTURE[run.fixture];
    const dirKey = run.dir > 0 ? 'down' : 'up';
    const isPane = run.fixture === 'pane';
    const windowY = isPane ? fx.windowY : fx.start[dirKey];
    const paneY = isPane ? fx.start[dirKey] : null;
    await page.call(positionPage, windowY, paneY);
    await sleep(1200);
    const boxes = run.fixture === 'lock' ? await page.call(boxGeometry, fx.boxes) : null;

    // Settle: the frame on screen was captured at this position and
    // registered (offset 0), the newest DOM scan was measured here, and on
    // the lock page every box is in the HUD's lock list. A run that starts
    // from anything less measures the setup, not the scroll.
    const locked = (rects, b) => rects.some(r => Math.abs(r.y - b.top) <= 1 && Math.abs(r.h - b.height) <= 1 &&
        Math.abs(r.x - (b.x - b.gutterX)) <= 1);
    await waitFor(`a settled frame and DOM scan at y ${windowY}`, async () => {
        const r = await hud.call(hudRegistration);
        const ok = r.frameY !== null && Math.abs(r.off) <= TOL && Math.abs(r.paneOff) <= TOL &&
            r.structureY === windowY &&
            (!boxes || boxes.every(b => locked(r.lockRects, b))) &&
            (!isPane || r.livePaneY !== null);
        return ok || { ok: false, ...r };
    }, 10000);

    const cfg = { winRows: fx.winRows };
    let geo = null;
    if (isPane) {
        geo = await page.call(paneGeometry);
        const rows = [];
        for (let k = 0; k < 9; k++) {
            const y = geo.top + 20 + k * 37;
            if (y < geo.top + geo.height - 4) rows.push(y);
        }
        cfg.pane = { left: geo.left, top: geo.top, rows };
    }
    if (boxes) {
        cfg.pixels = { artTop: 80, artBottom: 40, boxes: boxes.map(b => ({ x: b.x, top: b.top, height: b.height })) };
    }

    await hud.call(installHudRecorder, cfg);
    await page.call(installPageRecorder);
    // Rest renders: the reference position of each box.
    await sleep(400);

    const dy = run.dir * run.step;
    if (run.driver === 'raf') {
        await page.call(driveScrollBy, isPane ? 'pane' : 'window', dy, DURATION);
    } else {
        const at = fx.wheelAt(geo);
        await page.call(markPage, 'start');
        const t0 = Date.now();
        while (Date.now() - t0 < DURATION) {
            page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: dy }).catch(() => {});
            await sleep(16);
        }
        await page.call(markPage, 'end');
    }
    // Trailing frames and renders.
    await sleep(600);
    const pageLog = JSON.parse(await page.call(collectPageRecorder));
    const hudLog = JSON.parse(await hud.call(collectHudRecorder));
    if (flags.raw) {
        fs.mkdirSync(String(flags.raw), { recursive: true });
        fs.writeFileSync(path.join(String(flags.raw), runLabel(run).replace(/ /g, '-') + '.json'),
            JSON.stringify({ run, geo, boxes, pageLog, hudLog }));
    }
    return analyze(run, pageLog, hudLog, boxes);
}

async function runInteraction(name, { hud, page }) {
    // Settle: page back to its load-time state, pointer off every target,
    // DOM scans quiet, the canvas up and frames arriving.
    await page.evaluate('window.__serpReset()');
    const g = await serpGeometry(page);
    await mouse(page, 'mouseMoved', g.rest.x, g.rest.y);
    const up = (await hud.call(hudState)).uploads;
    await waitFor(`the HUD to settle on ${SERP}`, async () => {
        const st = await hud.call(hudState);
        const quiet = await hud.call(msSinceScan);
        return st.visible && st.uploads > up + 3 && quiet > 800 ? st : { ok: false, ...st, quiet };
    }, 15000);

    const before = await serpCounters(page);
    await hud.call(installHudRecorder, { winRows: [], alpha: true });
    await sleep(300);
    // HUD samples carry timeOrigin + now(), wall-clock ms like Date.now().
    const start = Date.now();
    const counted = await DRIVE[name](page, hud);
    const end = Date.now();
    await sleep(INTERACT_TAIL + 200);
    const hudLog = JSON.parse(await hud.call(collectHudRecorder));
    const key = INTERACT[name].counter;
    const events = counted !== undefined ? counted : (await serpCounters(page))[key] - before[key];
    if (flags.raw) {
        fs.mkdirSync(String(flags.raw), { recursive: true });
        fs.writeFileSync(path.join(String(flags.raw), `interact-${name}.json`),
            JSON.stringify({ name, start, end, events, hudLog }));
    }
    return analyzeInteraction(name, start, end, events, hudLog);
}

// ── Analysis ────────────────────────────────────────────────────────

function hiddenTime(vis, start, end) {
    const pts = vis.slice().sort((a, b) => a[0] - b[0]);
    let hidden = 0;
    let samples = 0;
    let hiddenSamples = 0;
    for (let i = 0; i < pts.length; i++) {
        const [t, v] = pts[i];
        if (t >= start && t <= end) { samples++; if (!v) hiddenSamples++; }
        const t1 = i + 1 < pts.length ? pts[i + 1][0] : end;
        const a = Math.max(t, start);
        const b = Math.min(t1, end);
        if (!v && b > a) hidden += b - a;
    }
    return { hidden, samples, hiddenSamples };
}

function maxAbs(a) {
    return a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
}

function analyze(run, pageLog, hudLog, boxes) {
    const { start, end } = pageLog;
    const fails = [];
    const m = { label: runLabel(run), run };
    const inScroll = (t) => t >= start && t <= end + 50;
    const isPane = run.fixture === 'pane';

    // Data sufficiency: the scroll happened.
    const series = pageLog.scroll.filter(s => s.t >= start && s.t <= end + 50).map(s => (isPane ? s.pane : s.y));
    const moved = series.length ? (series[series.length - 1] - series[0]) * run.dir : 0;
    m.scrolled = moved;
    if (!(moved >= MIN.scrollSteps * run.step * 0.5)) {
        fails.push(`scroll moved only ${moved.toFixed(0)} px in the scroll direction`);
    }
    // A run that reaches the top or bottom stops early and rests mid-run.
    const extent = isPane ? pageLog.paneMax : pageLog.max;
    const last = series.length ? series[series.length - 1] : null;
    if (last !== null && (last <= 0 || last >= extent)) {
        fails.push(`scroll reached the end of the ${isPane ? 'pane' : 'page'} (${last} of ${extent}); the fixture is too short for this display's frame rate`);
    }

    // 1. Visibility.
    const vis = hiddenTime(hudLog.vis, start, end);
    m.hiddenMs = vis.hidden;
    m.hiddenFraction = vis.hidden / Math.max(1, end - start);
    m.visSamples = vis.samples;
    if (vis.samples < MIN.visSamples) fails.push(`only ${vis.samples} visibility samples during the scroll`);
    if (vis.hidden > 0 || vis.hiddenSamples > 0) {
        fails.push(`overlay canvas hidden ${(100 * m.hiddenFraction).toFixed(1)}% of the scroll (${vis.hidden.toFixed(0)} ms, ${vis.hiddenSamples}/${vis.samples} samples)`);
    }

    // 2. Registered - true on frames the HUD registered.
    const frames = hudLog.frames.filter(f => inScroll(f.t));
    const reg = frames.filter(f => f.uploaded)
        .map(f => (isPane ? [f.regPane, f.truePane] : [f.regY, f.trueY]))
        .filter(([r, t]) => r !== null && t !== null)
        .map(([r, t]) => r - t);
    m.framesReceived = frames.length;
    m.framesRegistered = reg.length;
    m.regErrMax = maxAbs(reg);
    m.methods = {};
    for (const f of frames) m.methods[f.method] = (m.methods[f.method] || 0) + 1;
    if (reg.length < MIN.frames) fails.push(`only ${reg.length} registered frames with a decodable gutter`);
    const regBad = reg.filter(e => Math.abs(e) > TOL);
    if (regBad.length) {
        fails.push(`registered - true scroll off on ${regBad.length}/${reg.length} frames (max ${m.regErrMax.toFixed(1)} px)`);
    }

    // 3. Backward steps in the displayed content.
    const renders = hudLog.renders.filter(r => inScroll(r.t));
    m.renders = renders.length;
    // Lock runs judge only renders whose output was read back (probePixels
    // skips a render when its buffer pool is empty).
    const probed = renders.filter(r => r.boxes !== undefined);
    if (boxes) m.unprobed = renders.length - probed.length;
    let shown;
    if (run.fixture === 'lock') {
        shown = probed.map(r => r.art).filter(v => v !== null);
    } else if (isPane) {
        shown = renders.filter(r => r.shownTruePane !== null).map(r => r.shownTruePane + r.paneOff);
    } else {
        shown = renders.filter(r => r.shownTrue !== null).map(r => r.shownTrue + r.off);
    }
    let back = 0, backMax = 0;
    for (let i = 1; i < shown.length; i++) {
        const d = (shown[i] - shown[i - 1]) * run.dir;
        if (d < -TOL) { back++; backMax = Math.max(backMax, -d); }
    }
    m.shownRenders = shown.length;
    m.backSteps = back;
    m.backMax = backMax;
    if (shown.length < MIN.renders) fails.push(`only ${shown.length} renders with a known displayed position`);
    if (back) fails.push(`${back} backward steps in the displayed content (max ${backMax.toFixed(1)} px)`);

    // Informational: displayed content vs the scroll the HUD knows.
    const known = isPane
        ? renders.filter(r => r.shownTruePane !== null && r.livePane !== null).map(r => r.shownTruePane + r.paneOff - r.livePane)
        : run.fixture === 'lock'
            ? probed.filter(r => r.art !== null && r.live !== null).map(r => r.art - r.live)
            : renders.filter(r => r.shownTrue !== null && r.live !== null).map(r => r.shownTrue + r.off - r.live);
    m.shownVsLiveMax = maxAbs(known);

    // 4. Fixed and sticky boxes hold still on the HUD's output.
    if (boxes) {
        m.boxes = boxes.map((b, i) => {
            const rest = hudLog.renders.filter(r => r.t < start && r.boxes !== undefined).map(r => r.boxes[i]).filter(v => v !== null);
            const ref = rest.length ? rest[rest.length - 1] : null;
            const during = probed.map(r => r.boxes[i]).filter(v => v !== null);
            const missing = probed.length - during.length;
            const drift = ref === null ? [] : during.map(v => v - ref);
            const out = { name: b.name, domTop: b.top, restTop: ref, renders: during.length, missing, driftMax: maxAbs(drift) };
            if (ref === null) {
                fails.push(`${b.name}: not found on the HUD at rest`);
            } else if (Math.abs(ref - b.top) > TOL) {
                fails.push(`${b.name}: drawn at y ${ref} at rest, the DOM puts it at ${b.top}`);
            }
            if (during.length < MIN.boxRenders) fails.push(`${b.name}: decoded on only ${during.length} renders during the scroll`);
            // Off its rest position by more than its own gutter can show.
            if (missing) fails.push(`${b.name}: not found at its rest position on ${missing}/${probed.length} renders`);
            const bad = drift.filter(d => Math.abs(d) > TOL);
            if (bad.length) fails.push(`${b.name}: drifted on ${bad.length}/${drift.length} renders (max ${out.driftMax.toFixed(1)} px)`);
            return out;
        });
    }

    m.fails = fails;
    m.pass = fails.length === 0;
    return m;
}

/** Hidden stretches inside [start, end]: how many, and the longest in ms. */
function hiddenSpans(vis, start, end) {
    const pts = vis.slice().sort((a, b) => a[0] - b[0]);
    const spans = [];
    let from = null;
    for (const [t, v] of pts) {
        if (!v && from === null) from = Math.max(t, start);
        if (v && from !== null) { spans.push(Math.min(t, end) - from); from = null; }
    }
    if (from !== null) spans.push(end - from);
    const inside = spans.filter(d => d > 0);
    return { count: inside.length, longest: inside.length ? Math.max(...inside) : 0 };
}

function analyzeInteraction(name, start, end, events, hudLog) {
    const fails = [];
    const until = end + INTERACT_TAIL;
    const spec = INTERACT[name];
    const m = { label: `interact ${name}`, interaction: name, events };

    // Data sufficiency: the page really changed.
    if (!(events >= spec.min)) {
        fails.push(`only ${events} ${spec.counter} on the page (need ${spec.min}): the interaction did not happen`);
    }

    // 1. Visibility, through the tail.
    const vis = hiddenTime(hudLog.vis, start, until);
    const spans = hiddenSpans(hudLog.vis, start, until);
    m.hiddenMs = vis.hidden;
    m.hiddenFraction = vis.hidden / Math.max(1, until - start);
    m.hiddenSpans = spans.count;
    m.hiddenLongest = spans.longest;
    m.visSamples = vis.samples;
    if (vis.samples < MIN.visSamples) fails.push(`only ${vis.samples} visibility samples during the interaction`);
    if (vis.hidden > 0 || vis.hiddenSamples > 0) {
        fails.push(`overlay canvas hidden ${(100 * m.hiddenFraction).toFixed(1)}% of the interaction: ${spans.count} times, longest ${spans.longest.toFixed(0)} ms (${vis.hiddenSamples}/${vis.samples} samples)`);
    }

    // 2. Output alpha on every render.
    const renders = hudLog.renders.filter(r => r.t >= start && r.t <= until);
    const probed = renders.filter(r => r.alpha);
    const clear = probed.filter(r => r.alpha.clear > 0);
    m.renders = renders.length;
    m.alphaProbed = probed.length;
    m.seeThrough = clear.length;
    m.alphaMin = probed.reduce((a, r) => Math.min(a, r.alpha.min), 255);
    if (renders.length < MIN.renders) fails.push(`only ${renders.length} renders during the interaction`);
    if (probed.length < MIN.alphaProbes) fails.push(`output alpha read on only ${probed.length} renders`);
    if (clear.length) {
        const worst = clear.reduce((a, r) => Math.max(a, r.alpha.clear), 0);
        fails.push(`output alpha below 255 on ${clear.length}/${probed.length} renders (min ${m.alphaMin}; up to ${worst} of ${probed[0].alpha.n} probed pixels)`);
    }

    // 3. The capture loop kept running. Uploads are reported, not judged:
    // saccadic suppression skips them while the pointer jumps between
    // targets, and the HUD holds its last frame meanwhile.
    const frames = hudLog.frames.filter(f => f.t >= start && f.t <= until);
    m.framesReceived = frames.length;
    m.framesUploaded = frames.filter(f => f.uploaded).length;
    if (m.framesReceived < MIN.frames) fails.push(`only ${m.framesReceived} frames received during the interaction`);

    m.fails = fails;
    m.pass = fails.length === 0;
    return m;
}

function summarizeInteraction(m) {
    const parts = [
        `hidden ${(100 * m.hiddenFraction).toFixed(1)}% (${m.hiddenSpans}x, longest ${m.hiddenLongest.toFixed(0)} ms)`,
        `see-through ${m.seeThrough}/${m.alphaProbed} probed`,
        `${m.events} ${INTERACT[m.interaction].counter}`,
        `frames ${m.framesUploaded}/${m.framesReceived} uploaded`
    ];
    return `${m.pass ? 'PASS' : 'FAIL'}  ${m.label.padEnd(26)} ${parts.join('  ')}`;
}

function summarize(m) {
    const parts = [
        `hidden ${(100 * m.hiddenFraction).toFixed(1)}%`,
        `reg-true max ${m.regErrMax.toFixed(1)} on ${m.framesRegistered}/${m.framesReceived} frames`,
        `back ${m.backSteps}/${Math.max(0, m.shownRenders - 1)}`,
        `shown-live max ${m.shownVsLiveMax.toFixed(1)}`
    ];
    if (m.boxes) parts.push(m.boxes.map(b => `${b.name.split(' ')[0]} drift ${b.driftMax.toFixed(1)}${b.missing ? ` (lost ${b.missing})` : ''}`).join(', '));
    return `${m.pass ? 'PASS' : 'FAIL'}  ${m.label.padEnd(26)} ${parts.join('  ')}`;
}

// ── Main ────────────────────────────────────────────────────────────

/** Load a fixture and wait until the HUD is taking frames of it. */
async function openFixture(file, { hud, page }) {
    const url = fixtureUrl(file);
    await page.send('Page.navigate', { url });
    await waitFor(`${file} to load`, () => page.evaluate(
        `document.readyState === 'complete' && location.href === ${JSON.stringify(url)}`), 20000);
    // Frames from the new page flowing again.
    const before = (await hud.call(hudState)).uploads;
    await waitFor(`frames from ${file}`, async () => (await hud.call(hudState)).uploads > before + 3, 20000);
    // Start from a quiet page: load-time DOM scans still arriving would
    // change the lock list and structure maps under the first run.
    await waitFor(`DOM scans on ${file} to go quiet`,
        async () => (await hud.call(msSinceScan)) > 1500, 20000);
}

function report(m) {
    if (m.hiddenFraction === undefined) console.log(`FAIL  ${m.label}`);
    else console.log(m.interaction ? summarizeInteraction(m) : summarize(m));
    for (const f of m.fails) console.log(`        - ${f}`);
}

async function main() {
    const port = await findFreePort(Number(flags.port || 9350));
    console.log(`[check:scroll] launching ${path.relative(process.cwd(), ROOT) || '.'} with CDP on ${port}`);
    const app = launchApp(port);
    const onSignal = () => { stopApp(app).finally(() => process.exit(130)); };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    let conn = null;
    const results = [];
    let harnessError = null;
    try {
        conn = await attach(port, app);
        const { hud, page } = conn;
        await waitFor('the HUD to initialize', () => hud.call(hudState), 30000);
        await hud.call(watchScans);
        let st = await hud.call(hudState);
        if (!st.enabled) {
            await hud.evaluate("require('electron').ipcRenderer.emit('menu:toggle-foveal', {}); true");
        }
        st = await waitFor('foveation on, frames uploading, canvas visible',
            async () => { const s = await hud.call(hudState); return s.enabled && s.uploads > 3 && s.visible ? s : { ok: false, ...s }; }, 30000);
        console.log(`[check:scroll] HUD ${st.w}x${st.h} @${st.dpr}x, canvas ${st.canvasW}x${st.canvasH}; ` +
            `${RUNS.length} scroll and ${INTERACT_RUNS.length} interaction runs of ${DURATION} ms`);
        // A busy machine on purpose (see --throttle in the header).
        if (flags.throttle) {
            for (const part of String(flags.throttle).split(',')) {
                const [who, rate] = part.split(':');
                const target = who === 'hud' ? hud : who === 'page' ? page : null;
                if (!target || !(Number(rate) >= 1)) throw new Error(`bad --throttle part '${part}' (hud:N or page:N)`);
                await target.send('Emulation.setCPUThrottlingRate', { rate: Number(rate) });
            }
            console.log(`[check:scroll] CPU throttle ${flags.throttle}`);
        }

        let current = null;
        for (const run of RUNS) {
            const fx = FIXTURE[run.fixture];
            if (current !== run.fixture) {
                await openFixture(fx.file, conn);
                current = run.fixture;
            }
            let m;
            try {
                m = await runOne(run, conn);
            } catch (e) {
                if (e instanceof HarnessError) {
                    m = { label: runLabel(run), run, pass: false, fails: [e.message] };
                } else {
                    throw e;
                }
            }
            results.push(m);
            report(m);
        }

        if (INTERACT_RUNS.length) await openFixture(SERP, conn);
        for (const name of INTERACT_RUNS) {
            let m;
            try {
                m = await runInteraction(name, conn);
            } catch (e) {
                if (e instanceof HarnessError) {
                    m = { label: `interact ${name}`, interaction: name, pass: false, fails: [e.message] };
                } else {
                    throw e;
                }
            }
            results.push(m);
            report(m);
        }
    } catch (e) {
        harnessError = e;
    } finally {
        if (conn) { conn.hud.close(); conn.page.close(); }
        if (!flags.keep) {
            await stopApp(app);
            if (!harnessError) fs.rmSync(app.userData, { recursive: true, force: true });
        }
    }

    if (flags.json) {
        fs.writeFileSync(path.resolve(String(flags.json)), JSON.stringify({ duration: DURATION, results }, null, 2));
    }
    if (harnessError) {
        console.error(`[check:scroll] harness error: ${harnessError.message}`);
        console.error(`[check:scroll] app log: ${app.logPath}\n${tailLog(app)}`);
        return 2;
    }
    const failed = results.filter(r => !r.pass);
    console.log(failed.length
        ? `[check:scroll] FAIL: ${failed.length}/${results.length} runs failed`
        : `[check:scroll] PASS: ${results.length}/${results.length} runs`);
    if (flags.keep) {
        // Let this script exit while the app stays up.
        app.child.unref();
        console.log(`[check:scroll] app left running (pid ${app.child.pid}), profile ${app.userData}`);
    }
    return failed.length ? 1 : 0;
}

process.exitCode = await main();
