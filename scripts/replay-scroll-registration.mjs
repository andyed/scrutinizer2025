#!/usr/bin/env node
/**
 * replay-scroll-registration.mjs: run the HUD's scroll registrars over
 * captures that `npm run check:scroll -- --raw=<dir> --sigs` recorded.
 *
 * Each run file holds, in arrival order, what renderer/overlay.js handed its
 * registrars: every frame's row signatures and stamps, and the live window
 * and pane scrolls that revise scroll-onset frames. This feeds them to the
 * working tree's shared/scroll-registration.js the way the overlay does and
 * scores each frame the overlay would draw against the scroll its gutter
 * shows, as the gate does. A registrar change can then be judged on real
 * captures, a loaded machine's included, without rerunning the gate, whose
 * failures under load come one or two in thirty runs.
 *
 * Each run also counts the frames the overlay would not draw (it holds the
 * last one it did), since a registrar can score well by drawing less.
 *
 * usage: node scripts/replay-scroll-registration.mjs <dir|run.json>...
 *        [--frames] [--check] [--registrar=path]
 *   --frames     prints every frame around the scroll of each failing run
 *   --check      counts frames whose label or drawn flag differs from what
 *                the app recorded: zero when the registrar code is the one
 *                that recorded them, apart from a scroll-onset frame or two
 *                (the replay starts fresh registrars a few captures before
 *                the scroll, where the app's had been running)
 *   --registrar  replays another copy of shared/scroll-registration.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const registrarPath = (args.find(a => a.startsWith('--registrar=')) || '').slice('--registrar='.length);
const { FrameScrollRegistrar, PaneScrollRegistrar, scrollZoom } =
    require(registrarPath ? path.resolve(registrarPath) : '../shared/scroll-registration');
const { normalizeScrollPosition } = require('../shared/scroll-freshness');
const files = args.filter(a => !a.startsWith('--')).flatMap(p => (fs.statSync(p).isDirectory()
    ? fs.readdirSync(p).filter(f => f.endsWith('.json') && !f.startsWith('interact-')).sort().map(f => path.join(p, f))
    : [p]));
// The gate's tolerance: gutters decode whole CSS px.
const TOL = 0.5;

function signature(rec) {
    if (!rec) return undefined;
    const bytes = new Uint8Array(Buffer.from(rec.data, 'base64'));
    return { data: new Int32Array(bytes.buffer), height: rec.height, bands: rec.bands, samples: rec.samples };
}

/** Feed one run to fresh registrars; returns per-frame labels. */
function replay(hudLog) {
    const frameReg = new FrameScrollRegistrar();
    const paneReg = new PaneScrollRegistrar();
    const events = [
        ...hudLog.frames.map((f, i) => ({ seq: f.replay ? f.replay.seq : null, kind: 'frame', i, f })),
        ...(hudLog.live || []).map(e => ({ ...e }))
    ];
    if (events.some(e => e.kind === 'frame' && e.seq === null)) {
        // A frame without replay input (an empty capture) has no seq: keep it
        // after the event before it in arrival order.
        let last = -1;
        for (const e of events) {
            if (e.kind !== 'frame') continue;
            if (e.seq === null) e.seq = last + 0.5; else last = e.seq;
        }
    }
    events.sort((a, b) => a.seq - b.seq);
    const out = hudLog.frames.map(() => null);
    let lastFrameSequence = 0;
    for (const e of events) {
        if (e.kind === 'scroll') {
            const position = e.position;
            frameReg.reviseForScroll({ ...normalizeScrollPosition(position), zoom: scrollZoom(position) });
            continue;
        }
        if (e.kind === 'pane') {
            if (e.pane) paneReg.reviseForScroll(e.pane);
            continue;
        }
        const r = e.f.replay;
        if (!r) {
            frameReg.register({ width: 0, height: 0 });
            paneReg.reset();
            continue;
        }
        if (r.frameSequence <= lastFrameSequence) continue;
        lastFrameSequence = r.frameSequence;
        const zoom = scrollZoom({ zoom: r.zoom });
        const registered = frameReg.register({
            signature: signature(r.sig),
            width: r.width, height: r.height, viewWidth: r.viewWidth,
            stamp: { ...normalizeScrollPosition(r.stamp), zoom },
            stampBefore: { ...normalizeScrollPosition(r.stampBefore), zoom }
        });
        registered.pane = paneReg.register({
            paneSignature: signature(r.paneSig),
            width: r.width, height: r.height, viewWidth: r.viewWidth,
            pane: r.pane, paneBefore: r.paneBefore
        }, frameReg.moving);
        out[e.i] = { registered, drawn: registered.trusted && (!registered.pane || registered.pane.trusted) };
    }
    // Labels can be revised after arrival: read them now, as the gate does.
    return out.map(o => o && {
        drawn: o.drawn,
        regY: o.registered.y,
        regPane: o.registered.pane ? o.registered.pane.y : null,
        method: o.registered.method,
        paneMethod: o.registered.pane ? o.registered.pane.method : null
    });
}

let runs = 0, failed = 0, badFrames = 0, drawnFrames = 0, mismatches = 0, heldFrames = 0, longestHeld = 0;
for (const file of files) {
    const { run, pageLog, hudLog } = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!hudLog.frames.some(f => f.replay)) {
        console.log(`${path.basename(file)}: no replay input (record with --raw --sigs)`);
        continue;
    }
    const isPane = run.fixture === 'pane';
    const labels = replay(hudLog);
    const inScroll = (t) => t >= pageLog.start && t <= pageLog.end + 50;
    let bad = 0, drawn = 0, max = 0, held = 0, longestHold = 0;
    hudLog.frames.forEach((f, i) => {
        const l = labels[i];
        if (flags.has('--check') && f.replay) {
            const same = l && l.drawn === f.uploaded && (!f.uploaded ||
                (l.regY === f.regY && l.regPane === f.regPane));
            if (!same) {
                mismatches++;
                if (flags.has('--frames')) {
                    console.log(`    differs: ${path.basename(file)} frame ${i} at ${(f.t - pageLog.start).toFixed(0)} ms: ` +
                        `app ${f.uploaded ? 'drawn' : 'not drawn'} ${f.regY}/${f.regPane}, replay ` +
                        `${l && l.drawn ? 'drawn' : 'not drawn'} ${l ? `${l.regY}/${l.regPane}` : 'skipped'}`);
                }
            }
        }
        if (inScroll(f.t) && l) {
            // Frames the overlay would not draw: it holds the last one it did.
            held = l.drawn ? 0 : held + 1;
            longestHold = Math.max(longestHold, held);
            if (!l.drawn) heldFrames++;
        }
        if (!l || !l.drawn || !inScroll(f.t)) return;
        const reg = isPane ? l.regPane : l.regY;
        const truth = isPane ? f.truePane : f.trueY;
        if (reg === null || truth === null) return;
        drawn++;
        const err = reg - truth;
        if (Math.abs(err) > TOL) { bad++; max = Math.max(max, Math.abs(err)); }
    });
    runs++;
    drawnFrames += drawn;
    badFrames += bad;
    if (bad) failed++;
    longestHeld = Math.max(longestHeld, longestHold);
    const label = `${run.fixture} ${run.driver === 'raf' ? 'scrollBy' : 'wheel'} ${run.dir > 0 ? 'down' : 'up'} ${run.step}px`;
    console.log(`${bad ? 'FAIL' : 'ok  '}  ${path.basename(path.dirname(file))}/${label.padEnd(26)} drawn ${String(drawn).padStart(3)}  off ${bad}${bad ? ` (max ${max})` : ''}`);
    if (bad && flags.has('--frames')) {
        hudLog.frames.forEach((f, i) => {
            const l = labels[i];
            if (f.t < pageLog.start - 300 || f.t > pageLog.end + 400) return;
            const r = f.replay;
            const before = isPane ? f.paneStampBefore : (r ? r.stampBefore.y : f.stampBeforeY);
            const after = isPane ? f.paneStamp : f.stampY;
            const truth = isPane ? f.truePane : f.trueY;
            const reg = l ? (isPane ? l.regPane : l.regY) : null;
            const method = l ? (isPane ? l.paneMethod : l.method) : 'dropped';
            console.log(`    ${(f.t - pageLog.start).toFixed(0).padStart(6)} ms  ${l && l.drawn ? 'drawn' : '     '} ` +
                `${String(method).padEnd(8)} before ${before} after ${after} true ${truth} reg ${reg}` +
                `${reg !== null && truth !== null && l && l.drawn && Math.abs(reg - truth) > TOL ? `  off ${reg - truth}` : ''}`);
        });
    }
}
console.log(`\n${failed}/${runs} runs with a drawn frame off; ${badFrames}/${drawnFrames} drawn frames off; ` +
    `${heldFrames} not drawn, at most ${longestHeld} in a row` +
    (flags.has('--check') ? `; ${mismatches} frames differ from the recording` : ''));
