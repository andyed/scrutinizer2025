#!/usr/bin/env node
/**
 * Generate visual HTML report for Wave 1 color search validation.
 *
 * Reads prediction + measurement JSON and renders a self-contained HTML
 * dashboard with SVG charts, scorecard badges, and published data overlays.
 *
 * Usage:
 *   node scripts/report-color-search.js
 *   node scripts/report-color-search.js --open   # open in browser after generating
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const SCRIPTS = __dirname;
const ROOT = path.join(SCRIPTS, '..');
const REPORT_DIR = path.join(ROOT, 'tests', 'validation', 'reports');
const DATA_DIR = path.join(ROOT, 'tests', 'validation', 'published-data');
const hasFlag = (name) => process.argv.includes(`--${name}`);

// ── Load data ──
const pred = JSON.parse(execSync(
  `node "${path.join(SCRIPTS, 'chromatic-attenuation-table.js')}" --json --color-search`,
  { encoding: 'utf8' }
));

let meas = null;
try {
  meas = JSON.parse(execSync(
    `node "${path.join(SCRIPTS, 'analyze-color-search.js')}" --json`,
    { encoding: 'utf8' }
  ));
} catch (e) { /* no screenshots yet */ }

const bowers = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bowers2025_sensitivity.json'), 'utf8'));
const mullen = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'mullen_kingdom2002_rg_by.json'), 'utf8'));
const hansen = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'hansen2009_color_naming.json'), 'utf8'));

// ── Run validation to get pass/fail results ──
let validationReport = '';
try {
  if (meas) {
    const measPath = path.join(REPORT_DIR, '_tmp_meas.json');
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(measPath, JSON.stringify(meas));
    validationReport = execSync(
      `node "${path.join(SCRIPTS, 'validate-color-search.js')}" --measurements="${measPath}"`,
      { encoding: 'utf8' }
    );
    fs.unlinkSync(measPath);
  } else {
    validationReport = execSync(
      `node "${path.join(SCRIPTS, 'validate-color-search.js')}"`,
      { encoding: 'utf8' }
    );
  }
} catch (e) {
  validationReport = e.stdout || '';
}

// Parse pass/fail from report
function parseResults(report) {
  const tiers = { 1: [], 2: [], 3: [] };
  let currentTier = 0;
  for (const line of report.split('\n')) {
    if (line.startsWith('## Tier 1')) currentTier = 1;
    else if (line.startsWith('## Tier 2')) currentTier = 2;
    else if (line.startsWith('## Tier 3')) currentTier = 3;
    else if (line.startsWith('## Summary')) currentTier = 0;
    const m = line.match(/^- \[(PASS|FAIL|SKIP)\] (.+)$/);
    if (m && currentTier) {
      tiers[currentTier].push({ status: m[1], text: m[2] });
    }
  }
  return tiers;
}

const tiers = parseResults(validationReport);

// ── Build HTML ──
const COLORS = {
  red: '#e04040',
  green: '#40a040',
  blue: '#4060d0',
  yellow: '#c0a020',
};

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Wave 1: Color Search Validation</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, 'Segoe UI', system-ui, sans-serif;
    background: #1a1a2e;
    color: #e0e0e8;
    padding: 32px;
    max-width: 1200px;
    margin: 0 auto;
  }
  h1 { font-size: 22px; font-weight: 600; margin-bottom: 4px; }
  .subtitle { font-size: 13px; color: #888; margin-bottom: 24px; }
  .subtitle span { color: #aaa; }

  /* Scorecard */
  .scorecard {
    display: flex;
    gap: 16px;
    margin-bottom: 32px;
  }
  .tier-card {
    flex: 1;
    background: #222240;
    border-radius: 10px;
    padding: 16px 20px;
    border: 1px solid #333;
  }
  .tier-card h3 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #888;
    margin-bottom: 8px;
  }
  .tier-card .score {
    font-size: 28px;
    font-weight: 700;
    margin-bottom: 4px;
  }
  .tier-card .score .of { font-size: 16px; color: #666; font-weight: 400; }
  .tier-card.all-pass { border-color: #2d6a3080; }
  .tier-card.all-pass .score { color: #4ade80; }
  .tier-card.has-fail { border-color: #a0602080; }
  .tier-card.has-fail .score { color: #fbbf24; }
  .tier-card.all-fail { border-color: #dc262680; }
  .tier-card.all-fail .score { color: #f87171; }
  .tier-label { font-size: 11px; color: #666; }

  /* Charts */
  .charts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-bottom: 32px;
  }
  .chart-box {
    background: #222240;
    border-radius: 10px;
    padding: 20px;
    border: 1px solid #333;
  }
  .chart-box.wide { grid-column: 1 / -1; }
  .chart-box h3 {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 12px;
    color: #ccc;
  }
  svg { display: block; }
  .axis-label { fill: #666; font-size: 10px; }
  .axis-line { stroke: #444; stroke-width: 1; }
  .grid-line { stroke: #2a2a44; stroke-width: 1; }
  .data-line { fill: none; stroke-width: 2; }
  .published-line { fill: none; stroke-width: 1.5; stroke-dasharray: 6 3; opacity: 0.5; }
  .data-dot { stroke-width: 2; }
  .meas-dot { stroke-width: 1.5; }
  .legend { font-size: 10px; fill: #aaa; }

  /* Results table */
  .results {
    background: #222240;
    border-radius: 10px;
    padding: 20px;
    border: 1px solid #333;
  }
  .results h3 {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 12px;
    color: #ccc;
  }
  .result-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid #2a2a44;
    font-size: 12px;
    line-height: 1.4;
  }
  .result-row:last-child { border-bottom: none; }
  .badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
    min-width: 44px;
    text-align: center;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .badge.pass { background: #166534; color: #4ade80; }
  .badge.fail { background: #7c2d12; color: #fbbf24; }
  .badge.skip { background: #374151; color: #9ca3af; }
  .result-text { color: #bbb; }

  /* Footer */
  .footer {
    margin-top: 24px;
    font-size: 11px;
    color: #555;
    text-align: center;
  }
  .footer a { color: #666; }
</style>
</head>
<body>

<h1>Wave 1: Chromatic Decay Validation</h1>
<div class="subtitle">
  rg_decay=${pred.parameters.rg_decay} &middot; yv_decay=${pred.parameters.yv_decay} &middot;
  supra=${pred.parameters.supra_exponent} &middot;
  fovea=${pred.geometry.fovea_radius_px}px &middot;
  <span>${new Date().toISOString().split('T')[0]}</span>
</div>

<!-- Scorecard -->
<div class="scorecard">
${[1, 2, 3].map(t => {
  const items = tiers[t] || [];
  const pass = items.filter(i => i.status === 'PASS').length;
  const total = items.filter(i => i.status !== 'SKIP').length;
  const label = t === 1 ? 'Must Pass' : t === 2 ? 'Should Pass' : 'Stretch';
  const cls = pass === total ? 'all-pass' : pass === 0 ? 'all-fail' : 'has-fail';
  return `  <div class="tier-card ${cls}">
    <h3>Tier ${t}: ${label}</h3>
    <div class="score">${pass} <span class="of">/ ${total}</span></div>
    <div class="tier-label">${items.filter(i=>i.status==='SKIP').length ? '(' + items.filter(i=>i.status==='SKIP').length + ' skipped)' : ''}</div>
  </div>`;
}).join('\n')}
</div>

<!-- Charts -->
<div class="charts">
${buildRetentionChart()}
${buildChannelComparisonChart()}
${buildPublishedOverlayChart()}
${buildMeasuredVsModelChart()}
</div>

<!-- Detailed results -->
${[1, 2, 3].map(t => {
  const items = tiers[t] || [];
  if (items.length === 0) return '';
  const label = t === 1 ? 'Must Pass' : t === 2 ? 'Should Pass' : 'Stretch';
  return `<div class="results" style="margin-bottom:16px">
  <h3>Tier ${t}: ${label}</h3>
  ${items.map(i => `<div class="result-row">
    <span class="badge ${i.status.toLowerCase()}">${i.status}</span>
    <span class="result-text">${i.text}</span>
  </div>`).join('\n  ')}
</div>`;
}).join('\n')}

<div class="footer">
  Scrutinizer Wave 1 &middot; castleCSF chromatic pooling &middot;
  Bowers 2025 &middot; Hansen 2009 &middot; Mullen &amp; Kingdom 2002
</div>

</body>
</html>`;

function svgChart(w, h, { margin = { top: 20, right: 20, bottom: 36, left: 48 } } = {}) {
  const iw = w - margin.left - margin.right;
  const ih = h - margin.top - margin.bottom;
  return { w, h, margin, iw, ih };
}

function scaleX(val, min, max, iw) { return (val - min) / (max - min) * iw; }
function scaleY(val, min, max, ih) { return ih - (val - min) / (max - min) * ih; }

function buildRetentionChart() {
  const c = svgChart(540, 300);
  const preds24 = pred.predictions.filter(p => p.size_px === 24);
  const xMin = 0, xMax = 14, yMin = 0, yMax = 100;

  let svg = `<div class="chart-box">
  <h3>Model: Composite Chroma Retention at 24px</h3>
  <svg width="${c.w}" height="${c.h}" viewBox="0 0 ${c.w} ${c.h}">
  <g transform="translate(${c.margin.left},${c.margin.top})">`;

  // Grid
  for (let y = 0; y <= 100; y += 20) {
    const py = scaleY(y, yMin, yMax, c.ih);
    svg += `<line x1="0" y1="${py}" x2="${c.iw}" y2="${py}" class="grid-line"/>`;
    svg += `<text x="-8" y="${py + 3}" text-anchor="end" class="axis-label">${y}%</text>`;
  }
  for (let x = 0; x <= 14; x += 2) {
    const px = scaleX(x, xMin, xMax, c.iw);
    svg += `<text x="${px}" y="${c.ih + 16}" text-anchor="middle" class="axis-label">${x}°</text>`;
  }
  svg += `<text x="${c.iw / 2}" y="${c.ih + 32}" text-anchor="middle" class="axis-label">Eccentricity (degrees)</text>`;

  // Model lines per color
  for (const color of ['red', 'green', 'blue', 'yellow']) {
    const pts = preds24
      .filter(p => p.color === color)
      .sort((a, b) => a.ecc_deg - b.ecc_deg);

    // Start from fovea (0°, 100%)
    let d = `M${scaleX(0, xMin, xMax, c.iw)},${scaleY(100, yMin, yMax, c.ih)}`;
    for (const p of pts) {
      d += ` L${scaleX(p.ecc_deg, xMin, xMax, c.iw)},${scaleY(p.composite_retention * 100, yMin, yMax, c.ih)}`;
    }
    svg += `<path d="${d}" class="data-line" stroke="${COLORS[color]}"/>`;

    // Dots
    for (const p of pts) {
      svg += `<circle cx="${scaleX(p.ecc_deg, xMin, xMax, c.iw)}" cy="${scaleY(p.composite_retention * 100, yMin, yMax, c.ih)}" r="3" fill="${COLORS[color]}" class="data-dot" stroke="#1a1a2e"/>`;
    }
  }

  // Legend
  let ly = 8;
  for (const color of ['red', 'green', 'blue', 'yellow']) {
    svg += `<rect x="${c.iw - 70}" y="${ly - 6}" width="12" height="3" fill="${COLORS[color]}" rx="1"/>`;
    svg += `<text x="${c.iw - 54}" y="${ly}" class="legend">${color}</text>`;
    ly += 14;
  }

  svg += `</g></svg></div>`;
  return svg;
}

function buildChannelComparisonChart() {
  const c = svgChart(540, 300);
  const preds24 = pred.predictions.filter(p => p.size_px === 24);
  const xMin = 0, xMax = 14, yMin = 0, yMax = 100;

  let svg = `<div class="chart-box">
  <h3>Per-Channel Retention: RG vs BY at 24px</h3>
  <svg width="${c.w}" height="${c.h}" viewBox="0 0 ${c.w} ${c.h}">
  <g transform="translate(${c.margin.left},${c.margin.top})">`;

  // Grid
  for (let y = 0; y <= 100; y += 20) {
    const py = scaleY(y, yMin, yMax, c.ih);
    svg += `<line x1="0" y1="${py}" x2="${c.iw}" y2="${py}" class="grid-line"/>`;
    svg += `<text x="-8" y="${py + 3}" text-anchor="end" class="axis-label">${y}%</text>`;
  }
  for (let x = 0; x <= 14; x += 2) {
    svg += `<text x="${scaleX(x, xMin, xMax, c.iw)}" y="${c.ih + 16}" text-anchor="middle" class="axis-label">${x}°</text>`;
  }
  svg += `<text x="${c.iw / 2}" y="${c.ih + 32}" text-anchor="middle" class="axis-label">Eccentricity (degrees)</text>`;

  // RG channel (use red as representative)
  const redPts = preds24.filter(p => p.color === 'red').sort((a, b) => a.ecc_deg - b.ecc_deg);
  let dRG = `M${scaleX(0, xMin, xMax, c.iw)},${scaleY(100, yMin, yMax, c.ih)}`;
  for (const p of redPts) dRG += ` L${scaleX(p.ecc_deg, xMin, xMax, c.iw)},${scaleY(p.rg_retention * 100, yMin, yMax, c.ih)}`;
  svg += `<path d="${dRG}" class="data-line" stroke="#e06060"/>`;

  // BY channel (use blue as representative)
  const bluePts = preds24.filter(p => p.color === 'blue').sort((a, b) => a.ecc_deg - b.ecc_deg);
  let dBY = `M${scaleX(0, xMin, xMax, c.iw)},${scaleY(100, yMin, yMax, c.ih)}`;
  for (const p of bluePts) dBY += ` L${scaleX(p.ecc_deg, xMin, xMax, c.iw)},${scaleY(p.yv_retention * 100, yMin, yMax, c.ih)}`;
  svg += `<path d="${dBY}" class="data-line" stroke="#6080e0"/>`;

  // Bowers data points
  for (let i = 0; i < bowers.eccentricities_deg.length; i++) {
    const ecc = bowers.eccentricities_deg[i];
    if (ecc > xMax) continue;
    const rgY = bowers.channels.rg.sensitivity_pct[i];
    const byY = bowers.channels.by.sensitivity_pct[i];
    svg += `<circle cx="${scaleX(ecc, xMin, xMax, c.iw)}" cy="${scaleY(rgY, yMin, yMax, c.ih)}" r="4" fill="none" stroke="#e06060" stroke-width="2" stroke-dasharray="2 2"/>`;
    svg += `<circle cx="${scaleX(ecc, xMin, xMax, c.iw)}" cy="${scaleY(byY, yMin, yMax, c.ih)}" r="4" fill="none" stroke="#6080e0" stroke-width="2" stroke-dasharray="2 2"/>`;
  }

  // Mullen & Kingdom curves
  let dMRG = '', dMBY = '';
  for (let i = 0; i < mullen.eccentricities_deg.length; i++) {
    const ecc = mullen.eccentricities_deg[i];
    if (ecc > xMax) continue;
    const cmd = i === 0 ? 'M' : ' L';
    dMRG += `${cmd}${scaleX(ecc, xMin, xMax, c.iw)},${scaleY(mullen.channels.rg.sensitivity_ratio[i] * 100, yMin, yMax, c.ih)}`;
    dMBY += `${cmd}${scaleX(ecc, xMin, xMax, c.iw)},${scaleY(mullen.channels.by.sensitivity_ratio[i] * 100, yMin, yMax, c.ih)}`;
  }
  svg += `<path d="${dMRG}" class="published-line" stroke="#e06060"/>`;
  svg += `<path d="${dMBY}" class="published-line" stroke="#6080e0"/>`;

  // Legend
  svg += `<rect x="${c.iw - 110}" y="2" width="12" height="3" fill="#e06060" rx="1"/>`;
  svg += `<text x="${c.iw - 94}" y="8" class="legend">RG (model)</text>`;
  svg += `<rect x="${c.iw - 110}" y="16" width="12" height="3" fill="#6080e0" rx="1"/>`;
  svg += `<text x="${c.iw - 94}" y="22" class="legend">BY (model)</text>`;
  svg += `<line x1="${c.iw - 110}" y1="33" x2="${c.iw - 98}" y2="33" stroke="#999" stroke-width="1.5" stroke-dasharray="4 2"/>`;
  svg += `<text x="${c.iw - 94}" y="36" class="legend">Mullen &amp; Kingdom</text>`;
  svg += `<circle cx="${c.iw - 104}" cy="47" r="3" fill="none" stroke="#999" stroke-width="1.5" stroke-dasharray="2 2"/>`;
  svg += `<text x="${c.iw - 94}" y="50" class="legend">Bowers 2025</text>`;

  svg += `</g></svg></div>`;
  return svg;
}

function buildPublishedOverlayChart() {
  const c = svgChart(540, 300);
  const xMin = 0, xMax = 20, yMin = 0, yMax = 100;

  let svg = `<div class="chart-box">
  <h3>Hansen 2009: Naming Accuracy vs Model Retention</h3>
  <svg width="${c.w}" height="${c.h}" viewBox="0 0 ${c.w} ${c.h}">
  <g transform="translate(${c.margin.left},${c.margin.top})">`;

  for (let y = 0; y <= 100; y += 20) {
    const py = scaleY(y, yMin, yMax, c.ih);
    svg += `<line x1="0" y1="${py}" x2="${c.iw}" y2="${py}" class="grid-line"/>`;
    svg += `<text x="-8" y="${py + 3}" text-anchor="end" class="axis-label">${y}%</text>`;
  }
  for (let x = 0; x <= 20; x += 5) {
    svg += `<text x="${scaleX(x, xMin, xMax, c.iw)}" y="${c.ih + 16}" text-anchor="middle" class="axis-label">${x}°</text>`;
  }
  svg += `<text x="${c.iw / 2}" y="${c.ih + 32}" text-anchor="middle" class="axis-label">Eccentricity (degrees)</text>`;

  // Hansen data (dashed lines with open dots)
  for (const hue of ['red', 'blue']) {
    const acc = hansen.hues[hue].naming_accuracy;
    let d = '';
    for (let i = 0; i < hansen.eccentricities_deg.length; i++) {
      const ecc = hansen.eccentricities_deg[i];
      if (ecc > xMax) continue;
      d += (d ? ' L' : 'M') + `${scaleX(ecc, xMin, xMax, c.iw)},${scaleY(acc[i] * 100, yMin, yMax, c.ih)}`;
    }
    svg += `<path d="${d}" class="published-line" stroke="${COLORS[hue]}"/>`;
    for (let i = 0; i < hansen.eccentricities_deg.length; i++) {
      const ecc = hansen.eccentricities_deg[i];
      if (ecc > xMax) continue;
      svg += `<circle cx="${scaleX(ecc, xMin, xMax, c.iw)}" cy="${scaleY(acc[i] * 100, yMin, yMax, c.ih)}" r="3.5" fill="none" stroke="${COLORS[hue]}" stroke-width="1.5"/>`;
    }
  }

  // Model retention curves (solid lines with filled dots)
  const preds24 = pred.predictions.filter(p => p.size_px === 24);
  for (const hue of ['red', 'blue']) {
    const pts = preds24.filter(p => p.color === hue).sort((a, b) => a.ecc_deg - b.ecc_deg);
    let d = `M${scaleX(0, xMin, xMax, c.iw)},${scaleY(100, yMin, yMax, c.ih)}`;
    for (const p of pts) {
      if (p.ecc_deg > xMax) continue;
      d += ` L${scaleX(p.ecc_deg, xMin, xMax, c.iw)},${scaleY(p.composite_retention * 100, yMin, yMax, c.ih)}`;
    }
    svg += `<path d="${d}" class="data-line" stroke="${COLORS[hue]}"/>`;
    for (const p of pts) {
      if (p.ecc_deg > xMax) continue;
      svg += `<circle cx="${scaleX(p.ecc_deg, xMin, xMax, c.iw)}" cy="${scaleY(p.composite_retention * 100, yMin, yMax, c.ih)}" r="3" fill="${COLORS[hue]}" stroke="#1a1a2e" stroke-width="2"/>`;
    }
  }

  svg += `<rect x="4" y="2" width="12" height="3" fill="#e04040" rx="1"/>`;
  svg += `<text x="20" y="8" class="legend">Red model</text>`;
  svg += `<rect x="4" y="16" width="12" height="3" fill="#4060d0" rx="1"/>`;
  svg += `<text x="20" y="22" class="legend">Blue model</text>`;
  svg += `<line x1="4" y1="33" x2="16" y2="33" stroke="#999" stroke-width="1.5" stroke-dasharray="4 2"/>`;
  svg += `<text x="20" y="36" class="legend">Hansen naming accuracy</text>`;

  svg += `</g></svg></div>`;
  return svg;
}

function buildMeasuredVsModelChart() {
  if (!meas) {
    return `<div class="chart-box">
    <h3>Measured vs Model (no screenshots yet)</h3>
    <svg width="540" height="300" viewBox="0 0 540 300">
      <text x="270" y="150" text-anchor="middle" fill="#555" font-size="14">Capture screenshots to populate this chart</text>
    </svg></div>`;
  }

  const c = svgChart(540, 300);
  const xMin = 0, xMax = 14, yMin = 0, yMax = 100;
  const preds24 = pred.predictions.filter(p => p.size_px === 24);
  const measFiltered = meas.measurements.filter(m => m.condition === 'filtered' && m.retention > 0);

  let svg = `<div class="chart-box">
  <h3>Measured Retention (filtered) vs Model</h3>
  <svg width="${c.w}" height="${c.h}" viewBox="0 0 ${c.w} ${c.h}">
  <g transform="translate(${c.margin.left},${c.margin.top})">`;

  for (let y = 0; y <= 100; y += 20) {
    const py = scaleY(y, yMin, yMax, c.ih);
    svg += `<line x1="0" y1="${py}" x2="${c.iw}" y2="${py}" class="grid-line"/>`;
    svg += `<text x="-8" y="${py + 3}" text-anchor="end" class="axis-label">${y}%</text>`;
  }
  for (let x = 0; x <= 14; x += 2) {
    svg += `<text x="${scaleX(x, xMin, xMax, c.iw)}" y="${c.ih + 16}" text-anchor="middle" class="axis-label">${x}°</text>`;
  }
  svg += `<text x="${c.iw / 2}" y="${c.ih + 32}" text-anchor="middle" class="axis-label">Eccentricity (degrees)</text>`;

  // Model lines (faint)
  for (const color of ['red', 'blue']) {
    const pts = preds24.filter(p => p.color === color).sort((a, b) => a.ecc_deg - b.ecc_deg);
    let d = `M${scaleX(0, xMin, xMax, c.iw)},${scaleY(100, yMin, yMax, c.ih)}`;
    for (const p of pts) d += ` L${scaleX(p.ecc_deg, xMin, xMax, c.iw)},${scaleY(p.composite_retention * 100, yMin, yMax, c.ih)}`;
    svg += `<path d="${d}" class="data-line" stroke="${COLORS[color]}" opacity="0.3"/>`;
  }

  // Measured points (larger, with connecting line)
  const ringEcc = { 0: 0, 1: 2.22, 2: 4.44, 3: 6.67, 4: 9.33, 5: 12.44 };
  for (const color of ['red', 'blue']) {
    const pts = measFiltered
      .filter(m => m.color === color)
      .sort((a, b) => a.ring - b.ring);
    if (pts.length === 0) continue;

    let d = '';
    for (const p of pts) {
      const ecc = ringEcc[p.ring] || 0;
      const ret = p.retention * 100;
      d += (d ? ' L' : 'M') + `${scaleX(ecc, xMin, xMax, c.iw)},${scaleY(ret, yMin, yMax, c.ih)}`;
    }
    svg += `<path d="${d}" fill="none" stroke="${COLORS[color]}" stroke-width="2" stroke-dasharray="4 3"/>`;
    for (const p of pts) {
      const ecc = ringEcc[p.ring] || 0;
      const ret = p.retention * 100;
      svg += `<circle cx="${scaleX(ecc, xMin, xMax, c.iw)}" cy="${scaleY(ret, yMin, yMax, c.ih)}" r="4.5" fill="${COLORS[color]}" stroke="#fff" stroke-width="1.5" class="meas-dot"/>`;
    }
  }

  svg += `<rect x="${c.iw - 100}" y="2" width="12" height="3" fill="#e04040" rx="1" opacity="0.3"/>`;
  svg += `<text x="${c.iw - 84}" y="8" class="legend">Model (faint)</text>`;
  svg += `<circle cx="${c.iw - 94}" cy="19" r="3.5" fill="#e04040" stroke="#fff" stroke-width="1"/>`;
  svg += `<text x="${c.iw - 84}" y="22" class="legend">Measured</text>`;
  svg += `<text x="${c.iw - 100}" y="40" class="legend" fill="#666">Note: Mode 0 base desaturation</text>`;
  svg += `<text x="${c.iw - 100}" y="52" class="legend" fill="#666">compresses measured range</text>`;

  svg += `</g></svg></div>`;
  return svg;
}

// ── Write report ──
fs.mkdirSync(REPORT_DIR, { recursive: true });
const reportPath = path.join(REPORT_DIR, 'color-search-report.html');
fs.writeFileSync(reportPath, html);
console.log(`Visual report: ${reportPath}`);

if (hasFlag('open')) {
  execSync(`open "${reportPath}"`);
}
