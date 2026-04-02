#!/usr/bin/env node
/**
 * Generate scanpath sequence diagrams for AdSERP trials.
 *
 * Overlays numbered fixation circles (sized by duration) and saccade lines
 * on the SERP HTML. Output is a self-contained HTML file that can be opened
 * in a browser or captured as a full-page screenshot.
 *
 * Usage:
 *   node scripts/generate-scanpath-diagram.js --data=/path/to/AdSERP/data --trial=p004-b1-t1
 *   node scripts/generate-scanpath-diagram.js --data=/path/to/AdSERP/data --interesting
 *   node scripts/generate-scanpath-diagram.js --data=/path/to/AdSERP/data --interesting --capture
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

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
const doCapture = hasFlag('capture');

if (!dataDir || !fs.existsSync(dataDir)) {
    console.error('Error: --data=<path> required');
    process.exit(1);
}

const outputDir = path.join(ROOT, 'output', 'adserp-scanpath-diagrams');
fs.mkdirSync(outputDir, { recursive: true });

// ── Collect trial IDs ─────────────────────────────────────────

let trialIds = [];
if (singleTrial) {
    trialIds = [singleTrial];
} else if (doInteresting) {
    const interestingPath = path.join(dataDir, 'interesting-trials.json');
    if (!fs.existsSync(interestingPath)) {
        console.error('Error: interesting-trials.json not found');
        process.exit(1);
    }
    const interesting = JSON.parse(fs.readFileSync(interestingPath, 'utf8'));
    const seen = new Set();
    for (const [tag, info] of Object.entries(interesting.prototypical)) {
        if (info.trial_id && !seen.has(info.trial_id) && info.value !== 0) {
            seen.add(info.trial_id);
            trialIds.push(info.trial_id);
        }
    }
} else {
    console.error('Error: --trial=<id> or --interesting required');
    process.exit(1);
}

// ── Generate diagram for one trial ────────────────────────────

function generateDiagram(trialId) {
    const fixCsv = fs.readFileSync(path.join(dataDir, 'fixation-data', `${trialId}.csv`), 'utf8');
    const metaXml = fs.readFileSync(path.join(dataDir, 'trial-metadata', `${trialId}.xml`), 'utf8');
    const serpPath = path.join(dataDir, 'serps', `${trialId}.html`);
    const mouseCsv = fs.readFileSync(path.join(dataDir, 'mouse-movement-data', `${trialId}.csv`), 'utf8');

    if (!fs.existsSync(serpPath)) throw new Error(`SERP HTML not found: ${serpPath}`);

    // Parse metadata
    const get = (tag) => { const m = metaXml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)); return m ? m[1].trim() : ''; };
    const windowDims = get('window').split('x').map(Number);
    const screenDims = get('screen').split('x').map(Number);
    const docDims = get('document').split('x').map(Number);
    const windowW = windowDims[0] || 1422, windowH = windowDims[1] || 1137;
    const screenW = screenDims[0] || 1280, screenH = screenDims[1] || 1024;
    const docH = docDims[1] || 2642;
    const query = get('task').split('|').pop().trim().replace(/-/g, ' ');

    // Fixations are in screenshot coords (1280px wide, matching screen resolution).
    // We'll force the SERP to render at 1280px so the layout matches. No scaling needed.

    // Parse fixations (page-space, screenshot coords)
    const fixations = fixCsv.trim().split('\n').slice(1).map(l => {
        const [t, x, y, d] = l.split(',').map(Number);
        return { t, x, y, d };
    }).filter(f => isFinite(f.t) && isFinite(f.x) && f.d > 0);

    // Find click position — mouse is in window page-space (1422-wide),
    // scale to screenshot space (1280-wide) to match fixation coords
    const rx = screenW / windowW;   // 1280/1422
    const ry = screenH / windowH;   // 1024/1137
    const clickLines = mouseCsv.trim().split('\n').slice(1).filter(l => l.includes(',click,'));
    let clickX = null, clickY = null;
    if (clickLines.length > 0) {
        const c = clickLines[clickLines.length - 1].split(',');
        clickX = parseFloat(c[1]) * rx;
        clickY = parseFloat(c[2]) * ry;
    }

    // Duration stats for circle sizing
    const durations = fixations.map(f => f.d);
    const minD = Math.min(...durations) || 50;
    const maxD = Math.max(...durations) || 500;

    // Map duration → circle radius (8px min, 30px max)
    const radiusFor = (d) => 8 + (d - minD) / (maxD - minD + 1) * 22;

    // Color ramp: early fixations blue → late fixations red
    const colorFor = (i, n) => {
        const t = n > 1 ? i / (n - 1) : 0;
        const r = Math.round(50 + 205 * t);
        const g = Math.round(50 + 100 * (1 - Math.abs(t - 0.5) * 2));
        const b = Math.round(255 - 205 * t);
        return `rgb(${r},${g},${b})`;
    };

    // Build SVG overlay
    const svgLines = [];
    const svgCircles = [];
    const n = fixations.length;

    // Saccade lines
    for (let i = 1; i < n; i++) {
        const prev = fixations[i - 1];
        const curr = fixations[i];
        svgLines.push(
            `<line x1="${prev.x}" y1="${prev.y}" x2="${curr.x}" y2="${curr.y}" ` +
            `stroke="${colorFor(i, n)}" stroke-width="1.5" stroke-opacity="0.4" />`
        );
    }

    // Fixation circles + numbers
    for (let i = 0; i < n; i++) {
        const f = fixations[i];
        const r = radiusFor(f.d);
        const color = colorFor(i, n);
        svgCircles.push(
            `<circle cx="${f.x}" cy="${f.y}" r="${r}" ` +
            `fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="2" stroke-opacity="0.8" />`
        );
        // Number label
        const fontSize = Math.max(9, Math.min(14, r));
        svgCircles.push(
            `<text x="${f.x}" y="${f.y}" text-anchor="middle" dominant-baseline="central" ` +
            `font-family="monospace" font-weight="bold" font-size="${fontSize}" ` +
            `fill="white" stroke="rgba(0,0,0,0.6)" stroke-width="2" paint-order="stroke">${i + 1}</text>`
        );
    }

    // Click marker (star/diamond)
    let clickSvg = '';
    if (clickX !== null && clickY !== null) {
        clickSvg = `
        <polygon points="${clickX},${clickY - 16} ${clickX + 6},${clickY - 4} ${clickX + 16},${clickY - 4} ${clickX + 8},${clickY + 4} ${clickX + 12},${clickY + 16} ${clickX},${clickY + 8} ${clickX - 12},${clickY + 16} ${clickX - 8},${clickY + 4} ${clickX - 16},${clickY - 4} ${clickX - 6},${clickY - 4}"
            fill="#ff0000" fill-opacity="0.5" stroke="#ff0000" stroke-width="2" />
        <text x="${clickX + 18}" y="${clickY + 4}" font-family="monospace" font-weight="bold" font-size="11"
            fill="#ff0000" stroke="white" stroke-width="2" paint-order="stroke">CLICK</text>`;
    }

    // Info box removed from SVG — moved to HTML header above the SERP
    const infoSvg = '';

    const svgOverlay = `
<svg xmlns="http://www.w3.org/2000/svg"
     style="position:absolute !important; top:0 !important; left:0 !important;
            width:100% !important; height:100% !important;
            pointer-events:none !important; z-index:2147483647 !important;"
     viewBox="0 0 ${screenW} ${docH}">
  <g opacity="1">
    ${svgLines.join('\n    ')}
    ${svgCircles.join('\n    ')}
    ${clickSvg}
    ${infoSvg}
  </g>
</svg>`;

    // Build a wrapper page with two stacked iframes:
    // 1. Blurred background — entire SERP with CSS blur
    // 2. Sharp foreground — same SERP, SVG-masked to fixation circles
    // 3. Scanpath SVG overlay on top with lines + numbers
    const serpAbsPath = path.resolve(serpPath);

    const allYs = fixations.map(f => f.y);
    if (clickY !== null) allYs.push(clickY);
    const maxY = Math.max(docH, ...allYs) + 100;

    // Foveal radius for clear circles (roughly 1° visual angle at reading distance)
    const fovealR = 60;

    // Build SVG mask with soft-edged circles at each fixation
    // Uses radialGradient for each fixation to create foveal falloff
    const maskCircles = fixations.map((f, i) => {
        const r = fovealR + radiusFor(f.d) * 0.5; // scale by duration slightly
        return `<circle cx="${f.x}" cy="${f.y}" r="${r}" fill="white" />`;
    }).join('\n      ');

    // The mask SVG: white circles on black background, blurred for soft edges
    const maskSvg = `
    <svg width="0" height="0" style="position:absolute;">
      <defs>
        <filter id="soften-mask">
          <feGaussianBlur stdDeviation="15" />
        </filter>
        <mask id="fixation-mask" maskUnits="userSpaceOnUse"
              x="0" y="0" width="${screenW}" height="${maxY}">
          <rect width="100%" height="100%" fill="black" />
          <g filter="url(#soften-mask)">
            ${maskCircles}
          </g>
        </mask>
      </defs>
    </svg>`;

    const totalDurationS = (durations.reduce((a, b) => a + b, 0) / 1000).toFixed(1);

    const wrapperHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Scanpath: ${trialId}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #1a1a1a; display: flex; flex-direction: column; align-items: center; }
.header {
  width: ${screenW}px; padding: 12px 16px; background: #111;
  font-family: system-ui, -apple-system, sans-serif; color: #eee;
  display: flex; justify-content: space-between; align-items: baseline;
  border-bottom: 2px solid #333;
}
.header h1 { font-size: 14px; font-weight: 600; }
.header h1 span { color: #888; font-weight: 400; }
.header .meta { font-size: 11px; color: #888; }
.header .meta em { font-style: normal; color: #aaa; }
.legend { display: flex; gap: 16px; font-size: 11px; color: #666; padding: 6px 16px; width: ${screenW}px; background: #111; }
.legend .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 3px; vertical-align: middle; }
.container { position: relative; width: ${screenW}px; height: ${maxY}px; }
.serp-blurred, .serp-sharp {
  position: absolute; top: 0; left: 0;
  width: ${screenW}px; height: ${maxY}px;
  border: none;
}
.serp-blurred { filter: blur(8px) saturate(0.3); z-index: 1; }
.serp-sharp { mask: url(#fixation-mask); -webkit-mask: url(#fixation-mask); z-index: 2; }
.scanpath-overlay { position: absolute; top: 0; left: 0; z-index: 3; pointer-events: none; }
</style></head><body>
${maskSvg}
<div class="header">
  <h1>${trialId} <span>— ${query}</span></h1>
  <div class="meta">
    <em>${n}</em> fixations &middot;
    <em>${totalDurationS}s</em> &middot;
    dur <em>${minD}–${maxD}ms</em>
  </div>
</div>
<div class="legend">
  <span><span class="dot" style="background:#3232ff"></span>early</span>
  <span><span class="dot" style="background:#ff3232"></span>late</span>
  <span>circle size = duration</span>
  ${clickX ? '<span style="color:#ff4444">★ = click</span>' : ''}
</div>
<div class="container">
  <iframe class="serp-blurred" src="file://${serpAbsPath}" scrolling="no"></iframe>
  <iframe class="serp-sharp" src="file://${serpAbsPath}" scrolling="no"></iframe>
  ${svgOverlay.replace('style="position:absolute', 'class="scanpath-overlay" style="position:absolute')}
</div>
</body></html>`;

    const outPath = path.join(outputDir, `${trialId}-scanpath.html`);
    fs.writeFileSync(outPath, wrapperHtml);

    return {
        trialId, query,
        fixationCount: n,
        htmlPath: outPath,
        docHeight: docH
    };
}

// ── Main ──────────────────────────────────────────────────────

console.log('═══ AdSERP Scanpath Diagrams ═══\n');

const results = [];
for (const id of trialIds) {
    try {
        const result = generateDiagram(id);
        results.push(result);
        console.log(`  ✓ ${id}: ${result.fixationCount} fixations → ${result.htmlPath}`);
    } catch (e) {
        console.log(`  ✗ ${id}: ${e.message}`);
    }
}

console.log(`\n  Generated ${results.length} diagrams → ${outputDir}/`);
console.log('  Open in browser to view. Scroll down to see full scanpath.');

// Write index HTML for easy browsing
const indexHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>AdSERP Scanpath Diagrams</title>
<style>
body { font-family: system-ui; max-width: 900px; margin: 2em auto; background: #1a1a1a; color: #eee; }
h1 { font-size: 1.5em; }
a { color: #6af; }
.trial { margin: 1em 0; padding: 1em; background: #222; border-radius: 8px; }
.trial h3 { margin: 0 0 0.3em; }
.meta { color: #888; font-size: 0.9em; }
</style></head><body>
<h1>AdSERP Scanpath Diagrams</h1>
<p>${results.length} trials generated ${new Date().toISOString().slice(0, 10)}</p>
${results.map(r => `
<div class="trial">
  <h3><a href="${r.trialId}-scanpath.html">${r.trialId}</a> — ${r.query}</h3>
  <span class="meta">${r.fixationCount} fixations | doc height: ${r.docHeight}px</span>
</div>`).join('\n')}
</body></html>`;
fs.writeFileSync(path.join(outputDir, 'index.html'), indexHtml);
console.log(`  Index: ${outputDir}/index.html`);
