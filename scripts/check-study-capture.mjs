#!/usr/bin/env node
/**
 * check-study-capture.mjs: end-to-end gate for recorded studies.
 *
 * LOCAL ONLY. It launches the real app (from source, or a built package
 * with --app) with foveation on, so it needs a display and a GPU, like
 * check:scroll. It runs one recorded two-task study the way a participant
 * would, then puts the saved session directory through the checks the
 * Study Workbench runs before it computes any measure. The Workbench
 * vendors shared/session-capture.js byte-identically, so passing here
 * means the Workbench will admit it.
 *
 * What it does:
 *   1. Serves tests/fixtures/study/ on 127.0.0.1 and builds a
 *      scrutinizer://v1/session/start link: two tasks, foveation enabled,
 *      participant code in the link.
 *   2. Launches `electron . --study-link=<link>` (with --app, the
 *      package's own executable) with a throwaway profile and
 *      --remote-debugging-port, then drives it over CDP:
 *        consent  check the box, Agree
 *        task 1   Begin; pointer path; wheel and PageDown scrolling until
 *                 the delivery link is on screen; click it; pointer on the
 *                 new page; Done in the Study toolbar
 *        task 2   Begin; click the name field and type in it; tick a
 *                 checkbox; submit (the page changes, the URL does not);
 *                 Done
 *   3. Reads the completion screen's saved name and kind, then checks the
 *      session directory:
 *        - the completion screen reports a full capture
 *        - validateEnvelope and captureReadinessProblems find nothing
 *        - every stimulus PNG decodes at its declared size
 *        - capture DPR equals the window's devicePixelRatio
 *        - both tasks: outcome done, instructions kept, foveation enabled
 *        - task 1: two page visits, scroll rows past 0, scroll, key and
 *          click events
 *        - task 2: key events, all masked (typed into a field), change and
 *          submit events, a Done anchor whose pixels differ from the
 *          page's first anchor
 *        - session measures: finite time on task and pointer distance
 *
 * Exit 0 when every check passes, 1 when any fails, 2 when the harness
 * itself could not run (no app, no free port, a step timed out).
 *
 * usage: npm run check:study [-- --dpr=1] [--app=dist/mac-arm64/Scrutinizer.app]
 *                             [--port=9450] [--out=dir] [--json=report.json] [--keep]
 *   --dpr forces the device scale factor (run --dpr=1 and the native 2x on
 *   a Retina Mac to cover both); --out copies the saved session directory
 *   there (import it into the Workbench by hand); --json also records the
 *   app's anchor decisions; --keep leaves the app running and the profile
 *   on disk.
 *   --app runs a built package instead of the source tree: its own
 *   executable, with its pages loaded from Contents/Resources/app.asar. The
 *   release runs it on the signed build before uploading (release skill,
 *   step 6), because the package can differ from the tree it was built from:
 *   files left out of app.asar, paths that resolve differently inside it,
 *   signing and entitlement limits. Two side effects of launching a package:
 *   its update check runs ten seconds in, so a package older than the
 *   latest release can download that release and install it over itself
 *   when the gate quits it; and macOS registers the bundle, so it can answer
 *   scrutinizer:// links until it is deleted.
 *
 * The window opens at 40,40. If your own pointer moves over it during the
 * run, macOS delivers those moves to the page too and they enter the trail;
 * the checks still pass, but the pointer-distance numbers include them.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'study');
const require = createRequire(import.meta.url);
const {
    validateEnvelope, captureReadinessProblems, validateStimulusImage, trailFileName
} = require(path.join(ROOT, 'shared', 'session-capture.js'));
const { sessionMeasures } = require(path.join(ROOT, 'shared', 'session-measures.js'));
const { PNG } = require('pngjs');

const flags = Object.fromEntries(process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));

const sleep = ms => new Promise(r => setTimeout(r, ms));
class HarnessError extends Error {}

// --app: the package's pages live in its app.asar, so every file:// URL the
// harness waits for is rooted there instead of at the checkout.
let PACKAGED = null;
if (flags.app !== undefined) {
    const { packagedApp } = require(path.join(ROOT, 'scripts', 'lib', 'packaged-app.js'));
    try {
        PACKAGED = packagedApp(flags.app === true ? '' : String(flags.app));
    } catch (e) {
        console.error(`[check:study] harness error: ${e.message}`);
        process.exit(2);
    }
}
const APP_ROOT = PACKAGED ? PACKAGED.appRoot : ROOT;

const INTERSTITIAL = pathToFileURL(path.join(APP_ROOT, 'renderer', 'study-interstitial.html')).href;
const PARTICIPANT = 'check-p01';
const TASKS = [
    { id: 'find-delivery', page: 'shop.html', instructions: 'Find the delivery time for the island route. Then choose Done.' },
    { id: 'save-preference', page: 'preferences.html', instructions: 'Choose the compact digest and save your preferences. Then choose Done.' }
];
// Long enough for the capture's quiet period (500 ms) and settle cap
// (2000 ms) to pass and the anchor screenshot to land (main.js STUDY_CAPTURE_*).
const SETTLE_MS = 2800;

// ── Fixture server ──────────────────────────────────────────────────

function serveFixtures() {
    const server = http.createServer((req, res) => {
        const name = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
        const file = path.join(FIXTURES, name);
        // Fixture files only: no traversal, no directory listings.
        if (!name || name.includes('..') || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            res.writeHead(404, { 'content-type': 'text/plain' });
            res.end('not found');
            return;
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
    });
}

function studyLink(origin) {
    const p = new URLSearchParams();
    p.set('session_id', 'check-study');
    p.set('participant_id', PARTICIPANT);
    p.set('enabled', 'true');
    p.set('mode', '12');
    p.set('fovea_radius_px', '45');
    p.set('comfort_mode', 'false');
    p.set('visual_memory_limit', '0');
    TASKS.forEach((t, i) => {
        p.set(`t${i + 1}.url`, `${origin}/${t.page}`);
        p.set(`t${i + 1}.task_id`, t.id);
        p.set(`t${i + 1}.instructions`, t.instructions);
    });
    return `scrutinizer://v1/session/start?${p.toString()}`;
}

// ── App lifecycle (same pattern as check-scroll-hud.mjs) ───────────

function portFree(port) {
    return new Promise((resolve) => {
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

function launchApp(port, link) {
    const electronBin = PACKAGED ? PACKAGED.binary : require('electron');
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'scrutinizer-study-gate-'));
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
        showWelcomePopup: false,
        windowBounds: { x: 40, y: 40, width: 1280, height: 860 },
        visualMemory: 0,
        _foveaDegMigrated: true
    }, null, 2));
    const logPath = path.join(userData, 'app.log');
    const log = fs.openSync(logPath, 'w');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.TEST_MODE;
    const args = [
        // Electron from source is told which app to run; a package runs its own.
        ...(PACKAGED ? [] : [ROOT]),
        `--study-link=${link}`,
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userData}`,
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling'
    ];
    // --dpr=1 runs a Retina Mac as a 1x display (and the reverse), so one
    // machine covers both; without it the display's own DPR is used.
    if (flags.dpr) args.push(`--force-device-scale-factor=${Number(flags.dpr)}`);
    const child = spawn(electronBin, args, { cwd: ROOT, env, stdio: ['ignore', log, log] });
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
    return { ready, send, evaluate, isOpen: () => ws.readyState === WebSocket.OPEN, close: () => ws.close() };
}

async function waitFor(what, fn, timeoutMs = 20000, everyMs = 200) {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < timeoutMs) {
        try {
            const v = await fn();
            if (v) return v;
            last = v;
        } catch (e) {
            if (e instanceof HarnessError) throw e;
            last = e.message;
        }
        await sleep(everyMs);
    }
    const state = last === undefined ? '' : ` (last: ${String(typeof last === 'string' ? last : JSON.stringify(last)).slice(0, 300)})`;
    throw new HarnessError(`timed out after ${timeoutMs} ms waiting for ${what}${state}`);
}

/**
 * A connection to one target, found by predicate once and then followed by
 * id. The content view moves from file:// to http:// and back, which can
 * swap its renderer; reconnecting by id keeps following the same view.
 */
function targetHandle(port, app, what, predicate) {
    let id = null;
    let conn = null;
    async function list() {
        if (app.child.exitCode !== null) throw new HarnessError(`app exited (${app.child.exitCode})\n${tailLog(app)}`);
        return (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    }
    async function get() {
        if (conn && conn.isOpen()) return conn;
        const t = await waitFor(what, async () => {
            const all = await list();
            return id ? all.find(x => x.id === id) : all.find(predicate);
        }, 60000, 300);
        id = t.id;
        conn = connect(t.webSocketDebuggerUrl);
        await conn.ready;
        return conn;
    }
    return {
        get,
        async evaluate(expr) {
            try {
                return await (await get()).evaluate(expr);
            } catch (e) {
                // One retry across a renderer swap.
                if (!/socket|closed|context|destroyed/i.test(e.message)) throw e;
                conn = null;
                await sleep(150);
                return (await get()).evaluate(expr);
            }
        },
        async send(method, params) { return (await get()).send(method, params); },
        close() { if (conn) conn.close(); }
    };
}

// ── Participant input ──────────────────────────────────────────────

async function centerOf(t, selector) {
    const r = await t.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) return null;
        return { x: b.x + b.width / 2, y: b.y + b.height / 2, top: b.top, bottom: b.bottom, vh: innerHeight };
    })()`);
    return r;
}

const cursor = { x: 200, y: 200 };

async function moveTo(t, x, y, steps = 12) {
    const x0 = cursor.x;
    const y0 = cursor.y;
    for (let i = 1; i <= steps; i++) {
        // Eased path at roughly the capture's 16 ms poll rate.
        const k = 0.5 - Math.cos(Math.PI * i / steps) / 2;
        cursor.x = x0 + (x - x0) * k;
        cursor.y = y0 + (y - y0) * k;
        await t.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cursor.x, y: cursor.y });
        await sleep(16);
    }
}

async function click(t, selector) {
    let c = await waitFor(`${selector} to be visible`, async () => {
        const found = await centerOf(t, selector);
        if (!found && t.guard) await t.guard(selector);
        return found;
    }, 15000);
    if (c.top < 0 || c.bottom > c.vh) {
        // Below the fold (the consent text is long). Task pages scroll by
        // wheel before their clicks, so this only moves app screens.
        await t.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center', behavior: 'instant' })`);
        await sleep(150);
        c = await centerOf(t, selector);
    }
    await moveTo(t, c.x, c.y);
    await t.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
    await sleep(60);
    await t.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
    await sleep(100);
}

async function wheel(t, deltaY) {
    await t.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cursor.x, y: cursor.y, deltaX: 0, deltaY });
    await sleep(70);
}

async function pressKey(t, key, code, vk) {
    // rawKeyDown runs the default action (PageDown scrolls) without text.
    await t.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk });
    await sleep(40);
    await t.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
    await sleep(120);
}

async function typeText(t, text) {
    for (const ch of text) {
        const upper = ch.toUpperCase();
        const code = /[a-z]/i.test(ch) ? `Key${upper}` : (ch === ' ' ? 'Space' : '');
        const vk = ch === ' ' ? 32 : upper.charCodeAt(0);
        await t.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, text: ch, unmodifiedText: ch, windowsVirtualKeyCode: vk });
        await t.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, windowsVirtualKeyCode: vk });
        await sleep(45);
    }
}

async function wander(t, points) {
    for (const [x, y] of points) await moveTo(t, x, y, 10);
}

// ── Study flow ──────────────────────────────────────────────────────

async function contentAt(content, what, test, timeoutMs = 30000, { guard = true } = {}) {
    return waitFor(what, async () => {
        const href = await content.evaluate('location.href');
        if (guard && !test(href)) await content.guard(what);
        const ready = await content.evaluate('document.readyState');
        return ready === 'complete' && test(href) ? href : null;
    }, timeoutMs, 200);
}

async function pressDone(toolbar) {
    await waitFor('the Study toolbar Done button', () => toolbar.evaluate(
        "(() => { const b = document.getElementById('study-done'); return !!(b && b.offsetParent !== null && !b.disabled); })()"
    ), 15000);
    await click(toolbar, '#study-done');
}

async function runStudy(port, app, origin) {
    const content = targetHandle(port, app, 'the study content view',
        t => t.type === 'page' && t.url.startsWith(INTERSTITIAL));
    // A capture failure ends the session and shows the completion screen;
    // stop there with what it saved instead of timing out on the next step.
    content.guard = async (what) => {
        const href = await content.evaluate('location.href');
        if (href.startsWith(INTERSTITIAL) && href.includes('state=complete')) {
            const q = new URL(href).searchParams;
            throw new HarnessError(`study ended before ${what}: saved ${q.get('saved')} (saved_kind=${q.get('saved_kind')})\n` +
                tailLog(app, 400).split('\n').filter(l => /StudyCapture|\[Study\]/.test(l)).slice(-8).join('\n'));
        }
    };
    const toolbar = targetHandle(port, app, 'the Study toolbar',
        t => t.url.startsWith(pathToFileURL(APP_ROOT).href) && /renderer\/toolbar\.html/.test(t.url));
    const observed = {};

    // Consent. The participant code comes from the link, so the page shows
    // it read-only and only the agreement box and button remain.
    await contentAt(content, 'the consent screen', h => h.startsWith(INTERSTITIAL) && h.includes('state=consent'), 60000);
    await click(content, '#agree-check');
    await click(content, '#agree');

    // Task 1: scroll a long page by wheel and keyboard, follow a link.
    await contentAt(content, 'the task 1 introduction', h => h.startsWith(INTERSTITIAL) && h.includes('state=next'));
    await click(content, '#begin');
    await contentAt(content, 'task 1 page', h => h === `${origin}/${TASKS[0].page}`);
    await sleep(SETTLE_MS);
    await wander(content, [[300, 220], [620, 300], [480, 420], [260, 360]]);
    for (let i = 0; i < 6; i++) await wheel(content, 120);
    await pressKey(content, 'PageDown', 'PageDown', 34);
    await pressKey(content, 'PageDown', 'PageDown', 34);
    // Keep wheeling until the footer link is on screen.
    for (let i = 0; i < 40; i++) {
        const c = await centerOf(content, '#delivery-link');
        if (c && c.top >= 0 && c.bottom <= c.vh - 20) break;
        await wheel(content, 120);
    }
    observed.task1ScrollY = await content.evaluate('scrollY');
    observed.dpr = await content.evaluate('devicePixelRatio');
    await sleep(600);
    await click(content, '#delivery-link');
    await contentAt(content, 'the delivery page', h => h === `${origin}/delivery.html`);
    await sleep(SETTLE_MS);
    await wander(content, [[300, 160], [520, 240], [440, 300]]);
    await pressDone(toolbar);

    // Task 2: type into a field (keys must be masked), tick, submit in place.
    await contentAt(content, 'the task 2 introduction', h => h.startsWith(INTERSTITIAL) && h.includes('state=next') && h.includes('number=2'));
    await click(content, '#begin');
    await contentAt(content, 'task 2 page', h => h === `${origin}/${TASKS[1].page}`);
    await sleep(SETTLE_MS);
    await wander(content, [[260, 180], [420, 260]]);
    await click(content, '#name');
    await typeText(content, 'Ada Lovelace');
    observed.nameValue = await content.evaluate("document.getElementById('name').value");
    await click(content, '#compact');
    await click(content, '#save');
    await waitFor('the saved status', () => content.evaluate(
        "document.getElementById('status').textContent === 'Saved: compact digest'"), 5000);
    await sleep(900);
    await wander(content, [[360, 300], [300, 340]]);
    await pressDone(toolbar);

    const done = await contentAt(content, 'the completion screen',
        h => h.startsWith(INTERSTITIAL) && h.includes('state=complete'), 30000, { guard: false });
    const q = new URL(done).searchParams;
    observed.saved = q.get('saved');
    observed.savedKind = q.get('saved_kind');
    observed.completionStatus = await content.evaluate("(document.getElementById('capture-status') || {}).textContent || ''");
    content.close();
    toolbar.close();
    return observed;
}

// ── Checks on the saved session ─────────────────────────────────────

function decodePng(bytes) {
    const png = PNG.sync.read(Buffer.from(bytes));
    return { width: png.width, height: png.height };
}

async function checkSession(dir, observed) {
    const checks = [];
    const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });

    check('completion screen reports a full capture', observed.savedKind === 'capture',
        `saved_kind=${observed.savedKind}; "${observed.completionStatus}"`);
    const envelope = JSON.parse(fs.readFileSync(path.join(dir, 'envelope.json'), 'utf8'));
    const v = validateEnvelope(envelope);
    check('envelope passes validateEnvelope', v.ok, v.errors.slice(0, 5).join('; '));

    const trails = {};
    for (const task of envelope.tasks || []) {
        const file = path.join(dir, trailFileName(task.taskId));
        if (fs.existsSync(file)) trails[task.taskId] = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    const problems = captureReadinessProblems(envelope, trails);
    check('captureReadinessProblems finds nothing', problems.length === 0, problems.slice(0, 5).join('; '));

    const imageProblems = [];
    for (const visit of envelope.pageVisits || []) {
        const bytes = fs.readFileSync(path.join(dir, visit.screenshot));
        imageProblems.push(...await validateStimulusImage(bytes, visit, async d => decodePng(d)));
    }
    check('every stimulus PNG decodes at its declared size', imageProblems.length === 0,
        imageProblems.length ? imageProblems.slice(0, 3).join('; ') : `${(envelope.pageVisits || []).length} PNGs`);

    const dpr = envelope.capture && envelope.capture.devicePixelRatio;
    check('capture DPR matches the window', dpr === observed.dpr, `capture ${dpr}, window ${observed.dpr}`);

    const byId = Object.fromEntries((envelope.tasks || []).map(t => [t.taskId, t]));
    for (const spec of TASKS) {
        const t = byId[spec.id] || {};
        check(`${spec.id}: outcome done, instructions kept, foveation on`,
            t.outcome === 'done' && t.instructions === spec.instructions && t.settings && t.settings.enabled === true,
            `outcome=${t.outcome}, instructions ${t.instructions === spec.instructions ? 'kept' : 'missing'}, enabled=${t.settings && t.settings.enabled}`);
    }

    const count = (trail, type) => (trail && Array.isArray(trail.events) ? trail.events.filter(e => e.type === type).length : 0);
    const visits = id => (envelope.pageVisits || []).filter(pv => pv.taskId === id);

    const t1 = trails[TASKS[0].id];
    const maxScroll = t1 && Array.isArray(t1.scrollTimeline) ? Math.max(0, ...t1.scrollTimeline.map(r => r.scrollY || 0)) : 0;
    check('find-delivery: link navigation recorded as a second page visit', visits(TASKS[0].id).length >= 2,
        `${visits(TASKS[0].id).length} visits`);
    check('find-delivery: scrolling captured', maxScroll > 0 && count(t1, 'scroll') > 0,
        `max scrollY ${maxScroll} (page reached ${observed.task1ScrollY}), ${count(t1, 'scroll')} scroll events`);
    check('find-delivery: keyboard and click captured', count(t1, 'key') > 0 && count(t1, 'click') > 0,
        `${count(t1, 'key')} key, ${count(t1, 'click')} click events`);

    const t2 = trails[TASKS[1].id];
    const keys2 = t2 && Array.isArray(t2.events) ? t2.events.filter(e => e.type === 'key') : [];
    const unmasked = keys2.filter(e => !e.data || e.data.masked !== true);
    check('save-preference: typing captured and every keystroke in the field masked',
        keys2.length > 0 && unmasked.length === 0 && observed.nameValue === 'Ada Lovelace',
        `${keys2.length} key events, ${unmasked.length} unmasked; field value ${observed.nameValue === 'Ada Lovelace' ? 'typed' : JSON.stringify(observed.nameValue)}`);
    check('save-preference: change and submit captured', count(t2, 'change') > 0 && count(t2, 'submit') > 0,
        `${count(t2, 'change')} change, ${count(t2, 'submit')} submit events`);
    const v2 = visits(TASKS[1].id);
    let anchorsDiffer = false;
    if (v2.length >= 2) {
        const first = fs.readFileSync(path.join(dir, v2[0].screenshot));
        const last = fs.readFileSync(path.join(dir, v2[v2.length - 1].screenshot));
        anchorsDiffer = !first.equals(last);
    }
    check('save-preference: Done anchor shows the changed page', anchorsDiffer,
        `${v2.length} anchors${v2.length ? `, last ${v2[v2.length - 1].screenshot}` : ''}`);

    const m = sessionMeasures(envelope, trails);
    const measured = (m.tasks || []).every(t => Number.isFinite(t.timeOnTaskMs) && Number.isFinite(t.mouseMilesPx) && t.mouseMilesPx > 0);
    check('session measures: finite time on task and pointer distance', measured,
        (m.tasks || []).map(t => `${Math.round(t.timeOnTaskMs)} ms, ${Math.round(t.mouseMilesPx)} px`).join(' | '));

    const summary = {
        dpr,
        stimuli: (envelope.pageVisits || []).map(pv => `${pv.taskId}:${pv.stimulusWidth}x${pv.stimulusHeight}`),
        rows: Object.fromEntries(Object.entries(trails).map(([id, tr]) => [id, (tr.scrollTimeline || []).length]))
    };
    return { checks, summary };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
    const { server, origin } = await serveFixtures();
    const port = flags.port ? Number(flags.port) : await findFreePort(9450);
    const link = studyLink(origin);
    const build = PACKAGED ? `package ${PACKAGED.bundle} (v${PACKAGED.version})` : `source tree ${ROOT}`;
    console.log(`[check:study] running the ${build}`);
    const app = launchApp(port, link);
    let exitCode = 2;
    let keepProfile = !!flags.keep;
    try {
        const observed = await runStudy(port, app, origin);
        if (!observed.saved) throw new HarnessError('completion screen named no saved session');
        const dir = path.join(app.userData, 'study-sessions', observed.saved);
        if (!fs.existsSync(path.join(dir, 'envelope.json'))) {
            throw new HarnessError(`no session directory at ${dir} (saved_kind=${observed.savedKind})\n${tailLog(app)}`);
        }
        const { checks, summary } = await checkSession(dir, observed);
        // The app's own account of each anchor it kept or discarded.
        summary.captureLog = tailLog(app, 5000).split('\n').filter(l => l.includes('[StudyCapture]'));
        summary.build = PACKAGED ? { package: PACKAGED.bundle, version: PACKAGED.version } : { source: ROOT };
        for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
        console.log(`[check:study] DPR ${summary.dpr}; stimuli ${summary.stimuli.join(', ')}; rows ${JSON.stringify(summary.rows)}`);
        if (flags.out) {
            const dest = path.resolve(String(flags.out), observed.saved);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.cpSync(dir, dest, { recursive: true });
            console.log(`[check:study] session copied to ${dest}`);
        }
        if (flags.json) {
            fs.writeFileSync(String(flags.json), JSON.stringify({ link, observed, summary, checks }, null, 2));
        }
        const failed = checks.filter(c => !c.ok).length;
        console.log(failed ? `[check:study] FAIL: ${failed} of ${checks.length} checks failed` : `[check:study] PASS: ${checks.length} checks`);
        exitCode = failed ? 1 : 0;
        if (failed) keepProfile = true;
    } catch (e) {
        keepProfile = true;
        console.error(`[check:study] harness error: ${e.message}`);
        if (!(e instanceof HarnessError)) console.error(e.stack);
        console.error(tailLog(app, 20));
    } finally {
        server.close();
        if (flags.keep) {
            console.log(`[check:study] app left running (pid ${app.child.pid}), profile ${app.userData}`);
        } else {
            await stopApp(app);
            if (keepProfile) console.log(`[check:study] profile kept for diagnosis: ${app.userData}`);
            else fs.rmSync(app.userData, { recursive: true, force: true });
        }
    }
    process.exit(exitCode);
}

main().catch((e) => {
    console.error(`[check:study] ${e.stack || e.message}`);
    process.exit(2);
});
