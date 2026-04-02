#!/usr/bin/env node
/**
 * Generate interactive scanpath explorer for AdSERP trials.
 *
 * Self-contained HTML with:
 *  - SERP in 1280px iframe with foveated blur (SVG mask)
 *  - Scanpath overlay: numbered fixations, saccade lines
 *  - Timeline scrubber: drag to replay, shows fixation-by-fixation progression
 *  - Blur accumulates as you scrub forward (visual memory)
 *  - Toggle: gazeplot blur on/off
 *  - Fixation info panel
 *
 * Usage:
 *   node scripts/generate-interactive-scanpath.js --data=/path/to/AdSERP/data --trial=p029-b2-t10
 *   node scripts/generate-interactive-scanpath.js --data=/path/to/AdSERP/data --interesting
 */

const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
function getArg(name, def) {
    const a = args.find(x => x.startsWith(`--${name}=`));
    return a ? a.split('=').slice(1).join('=') : def;
}

const ROOT = path.join(__dirname, '..');
const dataDir = path.resolve(getArg('data', ''));
const singleTrial = getArg('trial', null);
const doInteresting = hasFlag('interesting');

if (!dataDir) { console.error('Error: --data=<path> required'); process.exit(1); }

const outputDir = path.join(ROOT, 'output', 'adserp-interactive');
fs.mkdirSync(outputDir, { recursive: true });

let trialIds = [];
if (singleTrial) {
    trialIds = [singleTrial];
} else if (doInteresting) {
    const ip = path.join(dataDir, 'interesting-trials.json');
    if (!fs.existsSync(ip)) { console.error('No interesting-trials.json'); process.exit(1); }
    const interesting = JSON.parse(fs.readFileSync(ip, 'utf8'));
    const seen = new Set();
    for (const [tag, info] of Object.entries(interesting.prototypical)) {
        if (info.trial_id && !seen.has(info.trial_id) && !(info.value === 0 && info.metric === 'fixation_count')) {
            seen.add(info.trial_id);
            trialIds.push(info.trial_id);
        }
    }
}

function generate(trialId) {
    const fixCsv = fs.readFileSync(path.join(dataDir, 'fixation-data', `${trialId}.csv`), 'utf8');
    const mouseCsv = fs.readFileSync(path.join(dataDir, 'mouse-movement-data', `${trialId}.csv`), 'utf8');
    const metaXml = fs.readFileSync(path.join(dataDir, 'trial-metadata', `${trialId}.xml`), 'utf8');
    const serpPath = path.join(dataDir, 'serps', `${trialId}.html`);
    if (!fs.existsSync(serpPath)) throw new Error('No SERP HTML');

    const get = (tag) => { const m = metaXml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)); return m ? m[1].trim() : ''; };
    const screenW = parseInt(get('screen').split('x')[0]) || 1280;
    const screenH = parseInt(get('screen').split('x')[1]) || 1024;
    const windowW = parseInt(get('window').split('x')[0]) || 1422;
    const windowH = parseInt(get('window').split('x')[1]) || 1137;
    const docH = parseInt(get('document').split('x')[1]) || 2642;
    const query = get('task').split('|').pop().trim().replace(/-/g, ' ');

    const fixations = fixCsv.trim().split('\n').slice(1).map(l => {
        const [t, x, y, d] = l.split(',').map(Number);
        return { t, x, y, d };
    }).filter(f => isFinite(f.t) && isFinite(f.x) && f.d > 0);

    // Click
    const rx = screenW / windowW, ry = screenH / windowH;
    const clickLines = mouseCsv.trim().split('\n').slice(1).filter(l => l.includes(',click,'));
    let click = null;
    if (clickLines.length > 0) {
        const c = clickLines[clickLines.length - 1].split(',');
        click = { x: parseFloat(c[1]) * rx, y: parseFloat(c[2]) * ry };
    }

    const serpAbsPath = path.resolve(serpPath);
    const maxY = Math.max(docH, ...fixations.map(f => f.y)) + 100;
    const fovealR = 60;

    // Check for pre-rendered Scrutinizer fullpage gazeplot
    const gazeplotDir = path.join(ROOT, 'output', 'adserp-fullpage-gazeplots');
    const gazeplotCandidates = [
        path.join(gazeplotDir, `${trialId}_fullpage_gazeplot.png`),
        path.join(gazeplotDir, `${trialId}_fullpage.png`),
    ];
    const gazeplotPath = gazeplotCandidates.find(p => fs.existsSync(p));
    const hasGazeplot = !!gazeplotPath;

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Scanpath Explorer: ${trialId}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #111; color: #eee; font-family: system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; align-items: center; }

.header { width: ${screenW}px; padding: 10px 16px; background: #1a1a1a; border-bottom: 1px solid #333;
  display: flex; justify-content: space-between; align-items: center; }
.header h1 { font-size: 14px; font-weight: 600; }
.header h1 span { color: #aaa; font-weight: 400; }
.controls { display: flex; gap: 12px; align-items: center; font-size: 12px; }
.controls label { cursor: pointer; user-select: none; }
.controls input[type=checkbox] { margin-right: 4px; }
.btn { background: #333; border: 1px solid #555; color: #eee; padding: 3px 10px; border-radius: 4px;
  cursor: pointer; font-size: 11px; }
.btn:hover { background: #444; }
.btn.active { background: #2a5a8a; border-color: #4a8aca; }

.viewer { position: relative; width: ${screenW}px; height: 70vh; overflow-y: auto; overflow-x: hidden; background: #000; }
.serp-container { position: relative; width: ${screenW}px; min-height: ${maxY}px; }

/* Scrutinizer gazeplot image (real foveated rendering) */
.gazeplot-img { width: ${screenW}px; display: block; }
/* Fallback: plain SERP iframe when no gazeplot available */
.serp-iframe { width: ${screenW}px; height: ${maxY}px; border: none; display: block; }

.scanpath-svg { position: absolute; top: 0; left: 0; z-index: 10; pointer-events: none; }

.foveal-ring { position: absolute; z-index: 11; pointer-events: none; border: 2px solid rgba(255,255,255,0.7);
  border-radius: 50%; width: ${fovealR * 2}px; height: ${fovealR * 2}px; transform: translate(-50%, -50%);
  box-shadow: 0 0 20px rgba(255,255,255,0.3), inset 0 0 10px rgba(255,255,255,0.1);
  transition: left 0.08s, top 0.08s; display: none; }

.timeline { width: ${screenW}px; background: #1a1a1a; padding: 8px 16px; border-top: 1px solid #333; }
.timeline-track { position: relative; height: 40px; background: #222; border-radius: 4px; cursor: pointer; overflow: hidden; }
.timeline-ticks { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
.timeline-tick { position: absolute; bottom: 0; border-radius: 2px 2px 0 0; min-width: 2px; }
.timeline-playhead { position: absolute; top: 0; width: 2px; height: 100%; background: #ff4444; z-index: 2; }
.timeline-info { display: flex; justify-content: space-between; margin-top: 4px; font-size: 11px; color: #888; }

.info-panel { width: ${screenW}px; padding: 6px 16px; background: #1a1a1a; font-size: 11px; color: #aaa;
  display: flex; gap: 20px; border-top: 1px solid #222; }
.info-panel .val { color: #ccc; }
${hasGazeplot ? '.badge-real { color: #4a4; font-size: 10px; margin-left: 8px; }' : '.badge-fallback { color: #a84; font-size: 10px; margin-left: 8px; }'}
</style></head><body>

<div class="header">
  <h1>${trialId} <span>— ${query}</span>${hasGazeplot ? ' <span class="badge-real">&middot; Scrutinizer</span>' : ' <span class="badge-fallback">&middot; fallback</span>'}</h1>
  <div class="controls">
    <label><input type="checkbox" id="lines-toggle" checked> Saccade lines</label>
    <label><input type="checkbox" id="numbers-toggle" checked> Numbers</label>
    <button class="btn" id="play-btn">&#9654; Play</button>
    <button class="btn" id="reset-btn">Reset</button>
  </div>
</div>

<div class="viewer" id="viewer">
  <div class="serp-container">
    ${hasGazeplot
        ? `<img class="gazeplot-img" src="file://${gazeplotPath}" />`
        : `<iframe class="serp-iframe" src="file://${serpAbsPath}" scrolling="no"></iframe>`
    }
    <svg class="scanpath-svg" id="scanpath-svg" xmlns="http://www.w3.org/2000/svg"
         width="${screenW}" height="${maxY}" viewBox="0 0 ${screenW} ${maxY}"></svg>
    <div class="foveal-ring" id="foveal-ring"></div>
  </div>
</div>

<div class="timeline">
  <div class="timeline-track" id="timeline-track">
    <div class="timeline-ticks" id="timeline-ticks"></div>
    <div class="timeline-playhead" id="playhead"></div>
  </div>
  <div class="timeline-info">
    <span id="time-label">Fixation 0 / ${fixations.length}</span>
    <span id="duration-label">0.0s / ${((fixations.length > 0 ? fixations[fixations.length-1].t + fixations[fixations.length-1].d - fixations[0].t : 0) / 1000).toFixed(1)}s</span>
  </div>
</div>

<div class="info-panel">
  ${hasGazeplot ? '<span><a href="https://github.com/andyed/scrutinizer2025" style="color:#ff9933;text-decoration:none;font-weight:600;">Scrutinizer rendering</a></span>' : '<span style="color:#a84">Fallback (no gazeplot)</span>'}
  <span>Position: <span class="val" id="info-pos">—</span></span>
  <span>Duration: <span class="val" id="info-dur">—</span></span>
  <span>Fixations seen: <span class="val" id="info-seen">0</span></span>
  ${click ? `<span>Click: <span class="val">(${Math.round(click.x)}, ${Math.round(click.y)})</span></span>` : ''}
</div>

<script>
const fixations = ${JSON.stringify(fixations)};
const click = ${JSON.stringify(click)};
const FOVEAL_R = ${fovealR};
const W = ${screenW}, MAX_Y = ${maxY};
const N = fixations.length;
const T0 = N > 0 ? fixations[0].t : 0;
const TOTAL_DUR = N > 0 ? fixations[N-1].t + fixations[N-1].d - T0 : 0;

const durations = fixations.map(f => f.d);
const minD = Math.min(...durations) || 50, maxD = Math.max(...durations) || 500;
const radiusFor = d => 8 + (d - minD) / (maxD - minD + 1) * 22;
const colorFor = (i, n) => {
    const t = n > 1 ? i / (n - 1) : 0;
    return \`rgb(\${Math.round(50+205*t)},\${Math.round(50+100*(1-Math.abs(t-0.5)*2))},\${Math.round(255-205*t)})\`;
};

const svg = document.getElementById('scanpath-svg');
const linesToggle = document.getElementById('lines-toggle');
const numbersToggle = document.getElementById('numbers-toggle');
const playhead = document.getElementById('playhead');
const timelineTrack = document.getElementById('timeline-track');
const fovealRing = document.getElementById('foveal-ring');
const viewer = document.getElementById('viewer');

let currentIdx = N - 1; // Default: show ALL fixations
let playing = false;
let playTimer = null;

// Timeline ticks
const ticksEl = document.getElementById('timeline-ticks');
fixations.forEach((f, i) => {
    const tick = document.createElement('div');
    tick.className = 'timeline-tick';
    tick.style.left = (N > 1 ? (f.t - T0) / TOTAL_DUR * 100 : 0) + '%';
    tick.style.width = Math.max(0.5, f.d / TOTAL_DUR * 100) + '%';
    tick.style.height = Math.min(100, 20 + f.d / 10) + '%';
    tick.style.background = colorFor(i, N);
    tick.style.opacity = '0.5';
    ticksEl.appendChild(tick);
});

const svgNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
    const el = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
}

const lineEls = [], circleEls = [], textEls = [];

for (let i = 0; i < N; i++) {
    const f = fixations[i], r = radiusFor(f.d), color = colorFor(i, N);

    if (i > 0) {
        const prev = fixations[i-1];
        const line = svgEl('line', {
            x1: prev.x, y1: prev.y, x2: f.x, y2: f.y,
            stroke: color, 'stroke-width': 1.5, 'stroke-opacity': 0.4 });
        svg.appendChild(line); lineEls.push(line);
    } else { lineEls.push(null); }

    const circle = svgEl('circle', {
        cx: f.x, cy: f.y, r: r,
        fill: color, 'fill-opacity': 0.25,
        stroke: color, 'stroke-width': 2, 'stroke-opacity': 0.8 });
    svg.appendChild(circle); circleEls.push(circle);

    const fontSize = Math.max(9, Math.min(14, r));
    const text = svgEl('text', {
        x: f.x, y: f.y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-family': 'monospace', 'font-weight': 'bold', 'font-size': fontSize,
        fill: 'white', stroke: 'rgba(0,0,0,0.6)', 'stroke-width': 2, 'paint-order': 'stroke' });
    text.textContent = i + 1;
    svg.appendChild(text); textEls.push(text);
}

if (click) {
    const star = svgEl('polygon', {
        points: [0,-16, 6,-4, 16,-4, 8,4, 12,16, 0,8, -12,16, -8,4, -16,-4, -6,-4]
            .reduce((a, v, i) => { a.push(i%2===0 ? click.x+v : click.y+v); return a; }, []).join(','),
        fill: '#ff0000', 'fill-opacity': 0.5, stroke: '#ff0000', 'stroke-width': 2 });
    svg.appendChild(star);
    const label = svgEl('text', {
        x: click.x + 18, y: click.y + 4,
        'font-family': 'monospace', 'font-weight': 'bold', 'font-size': 11,
        fill: '#ff0000', stroke: 'white', 'stroke-width': 2, 'paint-order': 'stroke' });
    label.textContent = 'CLICK'; svg.appendChild(label);
}

// Toggle visibility
linesToggle.addEventListener('change', () => updateView());
numbersToggle.addEventListener('change', () => updateView());

function updateView() {
    for (let i = 0; i < N; i++) {
        const visible = i <= currentIdx;
        circleEls[i].style.display = visible ? '' : 'none';
        textEls[i].style.display = visible && numbersToggle.checked ? '' : 'none';
        if (lineEls[i]) lineEls[i].style.display = visible && linesToggle.checked ? '' : 'none';
        // Highlight current during playback
        circleEls[i].setAttribute('stroke-width', (playing && i === currentIdx) ? 4 : 2);
        circleEls[i].setAttribute('stroke-opacity', (playing && i === currentIdx) ? 1 : 0.8);
    }
    // Playhead
    if (currentIdx >= 0 && N > 1) {
        playhead.style.left = (fixations[currentIdx].t - T0) / TOTAL_DUR * 100 + '%';
    }
    // Foveal ring: only during playback
    if (playing && currentIdx >= 0) {
        const f = fixations[currentIdx];
        fovealRing.style.display = 'block';
        fovealRing.style.left = f.x + 'px'; fovealRing.style.top = f.y + 'px';
        // Auto-scroll
        const vr = viewer.getBoundingClientRect();
        const fy = f.y - viewer.scrollTop;
        if (fy < 100 || fy > vr.height - 100) viewer.scrollTo({ top: f.y - vr.height / 2, behavior: 'smooth' });
    } else {
        fovealRing.style.display = 'none';
    }
    // Info
    if (currentIdx >= 0) {
        const f = fixations[currentIdx];
        document.getElementById('info-pos').textContent = '(' + f.x + ', ' + f.y + ')';
        document.getElementById('info-dur').textContent = f.d + 'ms';
        document.getElementById('info-seen').textContent = (currentIdx + 1);
        document.getElementById('time-label').textContent = 'Fixation ' + (currentIdx+1) + ' / ' + N;
        document.getElementById('duration-label').textContent = ((f.t - T0) / 1000).toFixed(1) + 's / ' + (TOTAL_DUR / 1000).toFixed(1) + 's';
    }
}

function setFixation(idx) {
    currentIdx = Math.max(-1, Math.min(N - 1, idx));
    updateView();
}

// Timeline scrub
let dragging = false;
function timelineSeek(e) {
    const rect = timelineTrack.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    let best = 0;
    for (let i = 0; i < N; i++) { if (fixations[i].t <= T0 + pct * TOTAL_DUR) best = i; }
    setFixation(best);
}
timelineTrack.addEventListener('mousedown', e => { dragging = true; timelineSeek(e); });
document.addEventListener('mousemove', e => { if (dragging) timelineSeek(e); });
document.addEventListener('mouseup', () => { dragging = false; });

// Keyboard
document.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') { setFixation(currentIdx + 1); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { setFixation(currentIdx - 1); e.preventDefault(); }
    if (e.key === ' ') { togglePlay(); e.preventDefault(); }
    if (e.key === 'Home') { setFixation(0); e.preventDefault(); }
    if (e.key === 'End') { setFixation(N - 1); e.preventDefault(); }
});

// Play/pause
function togglePlay() {
    playing = !playing;
    document.getElementById('play-btn').textContent = playing ? '⏸ Pause' : '▶ Play';
    document.getElementById('play-btn').classList.toggle('active', playing);
    if (playing) {
        if (currentIdx >= N - 1) currentIdx = -1;
        playNext();
    } else {
        clearTimeout(playTimer);
        fovealRing.style.display = 'none';
        // Show all fixations when paused
        currentIdx = N - 1;
        updateView();
    }
}
function playNext() {
    if (!playing) return;
    const next = currentIdx + 1;
    if (next >= N) {
        playing = false;
        document.getElementById('play-btn').textContent = '▶ Play';
        fovealRing.style.display = 'none';
        currentIdx = N - 1; updateView();
        return;
    }
    setFixation(next);
    playTimer = setTimeout(playNext, Math.max(100, fixations[next].d * 0.5));
}
document.getElementById('play-btn').addEventListener('click', togglePlay);
document.getElementById('reset-btn').addEventListener('click', () => {
    playing = false; clearTimeout(playTimer);
    document.getElementById('play-btn').textContent = '▶ Play';
    currentIdx = N - 1; updateView();
    viewer.scrollTo({ top: 0 });
});

// Init: show all fixations (default view)
updateView();
</script>
</body></html>`;

    const outPath = path.join(outputDir, `${trialId}-explorer.html`);
    fs.writeFileSync(outPath, html);
    return { trialId, query, n: fixations.length, path: outPath };
}

// Main
console.log('═══ Interactive Scanpath Explorer ═══\n');
const results = [];
for (const id of trialIds) {
    try {
        const r = generate(id);
        results.push(r);
        console.log(`  ✓ ${id}: ${r.n} fixations → ${r.path}`);
    } catch (e) {
        console.log(`  ✗ ${id}: ${e.message}`);
    }
}

// Index
const indexHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>AdSERP Scanpath Explorers</title>
<style>
body { font-family: system-ui; max-width: 900px; margin: 2em auto; background: #111; color: #eee; }
a { color: #6af; } h1 { font-size: 1.5em; }
.trial { margin: 0.8em 0; padding: 0.8em 1em; background: #1a1a1a; border-radius: 6px; }
.meta { color: #888; font-size: 0.85em; margin-top: 2px; }
kbd { background: #333; padding: 1px 6px; border-radius: 3px; font-size: 0.85em; }
</style></head><body>
<h1>AdSERP Scanpath Explorers</h1>
<p style="color:#888">Controls: <kbd>←</kbd><kbd>→</kbd> step fixations &middot; <kbd>Space</kbd> play/pause &middot; <kbd>B</kbd> toggle blur &middot; drag timeline to scrub</p>
${results.map(r => `<div class="trial"><a href="${r.trialId}-explorer.html">${r.trialId}</a> — ${r.query}<div class="meta">${r.n} fixations</div></div>`).join('\n')}
</body></html>`;
fs.writeFileSync(path.join(outputDir, 'index.html'), indexHtml);

console.log(`\n  Generated ${results.length} explorers → ${outputDir}/`);
console.log(`  Index: ${outputDir}/index.html`);
