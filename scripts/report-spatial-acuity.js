#!/usr/bin/env node
/**
 * Generate visual HTML report for Wave 2 spatial acuity validation.
 * Follows Wave 1 report template.
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
  `node "${path.join(SCRIPTS, 'chromatic-attenuation-table.js')}" --json --spatial-acuity`,
  { encoding: 'utf8' }
));

let meas = null;
try {
  meas = JSON.parse(execSync(
    `node "${path.join(SCRIPTS, 'analyze-spatial-acuity.js')}" --json`,
    { encoding: 'utf8' }
  ));
} catch (e) { /* no screenshots yet */ }

const rovamo = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'rovamo_virsu1979_csf.json'), 'utf8'));

// ── Run validation ──
let validationReport = '';
try {
  if (meas) {
    const measPath = path.join(REPORT_DIR, '_tmp_sa_meas.json');
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(measPath, JSON.stringify(meas));
    validationReport = execSync(
      `node "${path.join(SCRIPTS, 'validate-spatial-acuity.js')}" --measurements="${measPath}"`,
      { encoding: 'utf8' }
    );
    fs.unlinkSync(measPath);
  } else {
    validationReport = execSync(
      `node "${path.join(SCRIPTS, 'validate-spatial-acuity.js')}"`,
      { encoding: 'utf8' }
    );
  }
} catch (e) { validationReport = e.stdout || ''; }

// Parse pass/fail
function parseResults(report) {
  const tiers = { 1: [], 2: [], 3: [] };
  let currentTier = 0;
  for (const line of report.split('\n')) {
    if (line.startsWith('## Tier 1')) currentTier = 1;
    else if (line.startsWith('## Tier 2')) currentTier = 2;
    else if (line.startsWith('## Tier 3')) currentTier = 3;
    else if (line.startsWith('## Summary')) currentTier = 0;
    const m = line.match(/^- \[(PASS|FAIL|SKIP)\] (.+)$/);
    if (m && currentTier) tiers[currentTier].push({ status: m[1], text: m[2] });
  }
  return tiers;
}
const tiers = parseResults(validationReport);

// ── Chart helpers ──
const BAND_COLORS = {
  band0: '#e04040',
  band1: '#e09040',
  band2: '#40a040',
  band3: '#4060d0',
  residual: '#a040c0',
};

function scaleX(val, min, max, w) { return (val - min) / (max - min) * w; }
function scaleY(val, min, max, h) { return h - (val - min) / (max - min) * h; }

function buildBandRetentionChart() {
  const W = 540, H = 300;
  const m = { top: 20, right: 20, bottom: 36, left: 48 };
  const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
  const xMin = 0, xMax = 14, yMin = 0, yMax = 100;

  let svg = `<div class="chart-box">
  <h3>Model: DoG Band Retention (achromatic)</h3>
  <p class="chart-desc">Each curve shows one DoG frequency band's predicted retention vs eccentricity.
  The sigmoid cutoffs create a staircase: 4 cpd dies at ~2°, 2 cpd at ~4°, 1 cpd at ~6°, 0.5 cpd at ~9°.
  The residual (0.25 cpd) survives everywhere — coarse structure is always preserved.</p>
  <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <g transform="translate(${m.left},${m.top})">`;

  for (let y = 0; y <= 100; y += 20) {
    const py = scaleY(y, yMin, yMax, ih);
    svg += `<line x1="0" y1="${py}" x2="${iw}" y2="${py}" class="grid-line"/>`;
    svg += `<text x="-8" y="${py + 3}" text-anchor="end" class="axis-label">${y}%</text>`;
  }
  for (let x = 0; x <= 14; x += 2) {
    svg += `<text x="${scaleX(x, xMin, xMax, iw)}" y="${ih + 16}" text-anchor="middle" class="axis-label">${x}°</text>`;
  }
  svg += `<text x="${iw / 2}" y="${ih + 32}" text-anchor="middle" class="axis-label">Eccentricity (degrees)</text>`;

  for (const band of ['band0', 'band1', 'band2', 'band3', 'residual']) {
    const pts = pred.predictions.filter(p => p.band === band).sort((a, b) => a.ecc_deg - b.ecc_deg);
    let d = `M${scaleX(0, xMin, xMax, iw)},${scaleY(100, yMin, yMax, ih)}`;
    for (const p of pts) d += ` L${scaleX(p.ecc_deg, xMin, xMax, iw)},${scaleY(p.achromatic_retention * 100, yMin, yMax, ih)}`;
    svg += `<path d="${d}" fill="none" stroke="${BAND_COLORS[band]}" stroke-width="2"/>`;
    for (const p of pts) {
      svg += `<circle cx="${scaleX(p.ecc_deg, xMin, xMax, iw)}" cy="${scaleY(p.achromatic_retention * 100, yMin, yMax, ih)}" r="3" fill="${BAND_COLORS[band]}" stroke="#1a1a2e" stroke-width="2"/>`;
    }
  }

  let ly = 8;
  for (const [band, freq] of [['band0', '4 cpd'], ['band1', '2 cpd'], ['band2', '1 cpd'], ['band3', '0.5 cpd'], ['residual', '0.25 cpd']]) {
    svg += `<rect x="${iw - 80}" y="${ly - 6}" width="12" height="3" fill="${BAND_COLORS[band]}" rx="1"/>`;
    svg += `<text x="${iw - 64}" y="${ly}" class="legend">${freq}</text>`;
    ly += 14;
  }

  svg += `</g></svg></div>`;
  return svg;
}

function buildRovamoComparisonChart() {
  const W = 540, H = 300;
  const m = { top: 20, right: 20, bottom: 36, left: 48 };
  const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
  const xMin = 0, xMax = 16, yMin = 0, yMax = 100;

  let svg = `<div class="chart-box">
  <h3>Rovamo & Virsu 1979 vs Model</h3>
  <p class="chart-desc">Dashed: human contrast sensitivity from Rovamo & Virsu (1979), showing smooth decay per frequency.
  Solid: our DoG band model, which approximates this with steep sigmoids. The discrete 5-band approximation
  can't reproduce the smooth published curves — it snaps from 100% to 0% within one ring step.
  This is a known limitation of the band architecture, not an error in the cutoff positions.</p>
  <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <g transform="translate(${m.left},${m.top})">`;

  for (let y = 0; y <= 100; y += 20) {
    const py = scaleY(y, yMin, yMax, ih);
    svg += `<line x1="0" y1="${py}" x2="${iw}" y2="${py}" class="grid-line"/>`;
    svg += `<text x="-8" y="${py + 3}" text-anchor="end" class="axis-label">${y}%</text>`;
  }
  for (let x = 0; x <= 16; x += 4) {
    svg += `<text x="${scaleX(x, xMin, xMax, iw)}" y="${ih + 16}" text-anchor="middle" class="axis-label">${x}°</text>`;
  }
  svg += `<text x="${iw / 2}" y="${ih + 32}" text-anchor="middle" class="axis-label">Eccentricity (degrees)</text>`;

  // Rovamo data (dashed)
  const rovFreqs = { '0.5_cpd': BAND_COLORS.band3, '1_cpd': BAND_COLORS.band2, '2_cpd': BAND_COLORS.band1, '4_cpd': BAND_COLORS.band0 };
  for (const [key, color] of Object.entries(rovFreqs)) {
    const data = rovamo.channels[key];
    let d = '';
    for (let i = 0; i < rovamo.eccentricities_deg.length; i++) {
      const ecc = rovamo.eccentricities_deg[i];
      if (ecc > xMax) continue;
      d += (d ? ' L' : 'M') + `${scaleX(ecc, xMin, xMax, iw)},${scaleY(data.sensitivity_ratio[i] * 100, yMin, yMax, ih)}`;
    }
    svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="6 3" opacity="0.6"/>`;
  }

  // Model bands (solid)
  for (const [band, color] of Object.entries(BAND_COLORS)) {
    if (band === 'residual') continue;
    const pts = pred.predictions.filter(p => p.band === band).sort((a, b) => a.ecc_deg - b.ecc_deg);
    let d = `M${scaleX(0, xMin, xMax, iw)},${scaleY(100, yMin, yMax, ih)}`;
    for (const p of pts) {
      if (p.ecc_deg > xMax) continue;
      d += ` L${scaleX(p.ecc_deg, xMin, xMax, iw)},${scaleY(p.achromatic_retention * 100, yMin, yMax, ih)}`;
    }
    svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>`;
  }

  svg += `<line x1="${iw - 100}" y1="8" x2="${iw - 88}" y2="8" stroke="#999" stroke-width="2"/>`;
  svg += `<text x="${iw - 84}" y="11" class="legend">Model (solid)</text>`;
  svg += `<line x1="${iw - 100}" y1="22" x2="${iw - 88}" y2="22" stroke="#999" stroke-width="1.5" stroke-dasharray="4 2"/>`;
  svg += `<text x="${iw - 84}" y="25" class="legend">Rovamo (dashed)</text>`;

  svg += `</g></svg></div>`;
  return svg;
}

function buildMeasuredContrastChart() {
  if (!meas) return `<div class="chart-box"><h3>Measured Contrast (no screenshots)</h3><svg width="540" height="300"><text x="270" y="150" text-anchor="middle" fill="#555" font-size="14">Capture screenshots first</text></svg></div>`;

  const W = 540, H = 300;
  const m = { top: 20, right: 20, bottom: 36, left: 48 };
  const iw = W - m.left - m.right, ih = H - m.top - m.bottom;

  const filtered = meas.measurements.filter(mm => mm.condition === 'filtered' && mm.chromatic === 'achromatic' && mm.ring > 0);
  const freqs = [...new Set(filtered.map(mm => mm.freq_cpd))].sort((a, b) => b - a);
  const freqColors = { 4: BAND_COLORS.band0, 2: BAND_COLORS.band1, 1: BAND_COLORS.band2, 0.5: BAND_COLORS.band3, 0.25: BAND_COLORS.residual };
  const ringEcc = { 1: 2.22, 2: 4.44, 3: 6.67, 4: 9.33, 5: 12.44 };
  const xMin = 0, xMax = 14, yMin = 0, yMax = 120;

  let svg = `<div class="chart-box">
  <h3>Measured: Cross-Condition Retention (filtered/baseline)</h3>
  <p class="chart-desc">Each point compares the same grating with and without Scrutinizer's filter at each ring.
  A ratio below 100% means the filter reduced contrast at that frequency and eccentricity.
  4 cpd (red) shows the steepest drop — the filter removes fine detail in the periphery, as intended.
  0.25 cpd (purple) stays near 100% — coarse structure passes through unchanged.</p>
  <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <g transform="translate(${m.left},${m.top})">`;

  for (let y = 0; y <= 120; y += 20) {
    const py = scaleY(y, yMin, yMax, ih);
    svg += `<line x1="0" y1="${py}" x2="${iw}" y2="${py}" class="grid-line"/>`;
    svg += `<text x="-8" y="${py + 3}" text-anchor="end" class="axis-label">${y}%</text>`;
  }
  for (let x = 0; x <= 14; x += 2) {
    svg += `<text x="${scaleX(x, xMin, xMax, iw)}" y="${ih + 16}" text-anchor="middle" class="axis-label">${x}°</text>`;
  }
  svg += `<text x="${iw / 2}" y="${ih + 32}" text-anchor="middle" class="axis-label">Eccentricity (degrees)</text>`;
  // 100% reference line
  svg += `<line x1="0" y1="${scaleY(100, yMin, yMax, ih)}" x2="${iw}" y2="${scaleY(100, yMin, yMax, ih)}" stroke="#555" stroke-width="1" stroke-dasharray="4 4"/>`;

  for (const freq of freqs) {
    const pts = filtered.filter(mm => mm.freq_cpd === freq && mm.cross_retention > 0).sort((a, b) => a.ring - b.ring);
    if (pts.length === 0) continue;
    const color = freqColors[freq] || '#888';
    let d = '';
    for (const p of pts) {
      const ecc = ringEcc[p.ring] || 0;
      d += (d ? ' L' : 'M') + `${scaleX(ecc, xMin, xMax, iw)},${scaleY(p.cross_retention * 100, yMin, yMax, ih)}`;
    }
    svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>`;
    for (const p of pts) {
      const ecc = ringEcc[p.ring] || 0;
      svg += `<circle cx="${scaleX(ecc, xMin, xMax, iw)}" cy="${scaleY(p.cross_retention * 100, yMin, yMax, ih)}" r="4" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
    }
  }

  let ly = 8;
  for (const [freq, label] of [[4, '4 cpd'], [2, '2 cpd'], [1, '1 cpd'], [0.5, '0.5 cpd'], [0.25, '0.25 cpd']]) {
    svg += `<rect x="${iw - 80}" y="${ly - 6}" width="12" height="3" fill="${freqColors[freq]}" rx="1"/>`;
    svg += `<text x="${iw - 64}" y="${ly}" class="legend">${label}</text>`;
    ly += 14;
  }

  svg += `</g></svg></div>`;
  return svg;
}

function buildFreqVsRetentionChart() {
  if (!meas) return '';
  const W = 540, H = 300;
  const m = { top: 20, right: 20, bottom: 36, left: 48 };
  const iw = W - m.left - m.right, ih = H - m.top - m.bottom;

  const filtered = meas.measurements.filter(mm => mm.condition === 'filtered' && mm.chromatic === 'achromatic' && mm.cross_retention > 0);
  const freqs = [0.25, 0.5, 1, 2, 4];
  const xMin = 0, xMax = 4.5, yMin = 60, yMax = 105;

  // Average cross_retention per freq across all rings
  const avgByFreq = freqs.map(f => {
    const pts = filtered.filter(mm => mm.freq_cpd === f);
    if (pts.length === 0) return null;
    return { freq: f, avg: pts.reduce((s, p) => s + p.cross_retention, 0) / pts.length };
  }).filter(Boolean);

  let svg = `<div class="chart-box">
  <h3>Frequency vs Avg Cross-Condition Retention</h3>
  <p class="chart-desc">Averaging across all rings: higher spatial frequencies are attenuated more by the filter.
  This is the frequency-dependent decay we expect from M-scaling — the filter preferentially
  removes detail that would be invisible in peripheral vision anyway.</p>
  <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <g transform="translate(${m.left},${m.top})">`;

  for (let y = 60; y <= 100; y += 10) {
    const py = scaleY(y, yMin, yMax, ih);
    svg += `<line x1="0" y1="${py}" x2="${iw}" y2="${py}" class="grid-line"/>`;
    svg += `<text x="-8" y="${py + 3}" text-anchor="end" class="axis-label">${y}%</text>`;
  }
  for (const f of freqs) {
    svg += `<text x="${scaleX(f, xMin, xMax, iw)}" y="${ih + 16}" text-anchor="middle" class="axis-label">${f}</text>`;
  }
  svg += `<text x="${iw / 2}" y="${ih + 32}" text-anchor="middle" class="axis-label">Spatial Frequency (cpd)</text>`;
  svg += `<line x1="0" y1="${scaleY(100, yMin, yMax, ih)}" x2="${iw}" y2="${scaleY(100, yMin, yMax, ih)}" stroke="#555" stroke-width="1" stroke-dasharray="4 4"/>`;

  if (avgByFreq.length > 1) {
    let d = '';
    for (const p of avgByFreq) {
      d += (d ? ' L' : 'M') + `${scaleX(p.freq, xMin, xMax, iw)},${scaleY(p.avg * 100, yMin, yMax, ih)}`;
    }
    svg += `<path d="${d}" fill="none" stroke="#6080e0" stroke-width="2.5"/>`;
    for (const p of avgByFreq) {
      svg += `<circle cx="${scaleX(p.freq, xMin, xMax, iw)}" cy="${scaleY(p.avg * 100, yMin, yMax, ih)}" r="5" fill="#6080e0" stroke="#fff" stroke-width="2"/>`;
      svg += `<text x="${scaleX(p.freq, xMin, xMax, iw)}" y="${scaleY(p.avg * 100, yMin, yMax, ih) - 10}" text-anchor="middle" class="legend" fill="#aaa">${(p.avg * 100).toFixed(0)}%</text>`;
    }
  }

  svg += `</g></svg></div>`;
  return svg;
}

// ── Build HTML ──
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Wave 2: Spatial Acuity Validation</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', system-ui, sans-serif; background: #1a1a2e; color: #e0e0e8; padding: 32px; max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 22px; font-weight: 600; margin-bottom: 4px; }
  .subtitle { font-size: 13px; color: #888; margin-bottom: 24px; }
  .subtitle span { color: #aaa; }
  .scorecard { display: flex; gap: 16px; margin-bottom: 24px; }
  .tier-card { flex: 1; background: #222240; border-radius: 10px; padding: 16px 20px; border: 1px solid #333; }
  .tier-card h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 8px; }
  .tier-card .score { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
  .tier-card .score .of { font-size: 16px; color: #666; font-weight: 400; }
  .intro { font-size: 13px; line-height: 1.7; color: #999; margin-bottom: 24px; max-width: 800px; }
  .intro strong { color: #bbb; font-weight: 600; }
  .section-desc { font-size: 12px; line-height: 1.6; color: #888; margin-bottom: 12px; max-width: 720px; }
  .chart-desc { font-size: 11px; line-height: 1.5; color: #777; margin-top: -8px; margin-bottom: 12px; }
  .tier-card.all-pass { border-color: #2d6a3080; }
  .tier-card.all-pass .score { color: #4ade80; }
  .tier-card.has-fail { border-color: #a0602080; }
  .tier-card.has-fail .score { color: #fbbf24; }
  .tier-card.all-fail { border-color: #dc262680; }
  .tier-card.all-fail .score { color: #f87171; }
  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 32px; }
  .chart-box { background: #222240; border-radius: 10px; padding: 20px; border: 1px solid #333; }
  .chart-box h3 { font-size: 13px; font-weight: 600; margin-bottom: 12px; color: #ccc; }
  svg { display: block; }
  .axis-label { fill: #666; font-size: 10px; }
  .grid-line { stroke: #2a2a44; stroke-width: 1; }
  .legend { font-size: 10px; fill: #aaa; }
  .results { background: #222240; border-radius: 10px; padding: 20px; border: 1px solid #333; margin-bottom: 16px; }
  .results h3 { font-size: 13px; font-weight: 600; margin-bottom: 12px; color: #ccc; }
  .result-row { display: flex; align-items: flex-start; gap: 10px; padding: 6px 0; border-bottom: 1px solid #2a2a44; font-size: 12px; line-height: 1.4; }
  .result-row:last-child { border-bottom: none; }
  .badge { display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px; min-width: 44px; text-align: center; flex-shrink: 0; margin-top: 1px; }
  .badge.pass { background: #166534; color: #4ade80; }
  .badge.fail { background: #7c2d12; color: #fbbf24; }
  .badge.skip { background: #374151; color: #9ca3af; }
  .result-text { color: #bbb; }
  .go-wrap { position: relative; display: inline-block; margin-bottom: 24px; }
  .go-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 18px; border-radius: 8px; background: #222240; border: 1px solid #444; color: #ccc; font-size: 13px; font-weight: 600; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
  .go-btn:hover { border-color: #666; background: #2a2a50; }
  .go-btn .arrow { font-size: 11px; color: #666; transition: transform 0.2s; }
  .go-wrap:hover .go-btn .arrow, .go-wrap:focus-within .go-btn .arrow { transform: rotate(90deg); }
  .flyout { position: absolute; top: calc(100% + 6px); left: 0; z-index: 100; min-width: 380px; background: #1e1e38; border: 1px solid #444; border-radius: 12px; padding: 20px 24px; box-shadow: 0 12px 40px rgba(0,0,0,0.5); opacity: 0; visibility: hidden; transform: translateY(-4px); transition: opacity 0.15s, transform 0.15s, visibility 0.15s; }
  .go-wrap:hover .flyout, .go-wrap:focus-within .flyout { opacity: 1; visibility: visible; transform: translateY(0); }
  .flyout h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #666; margin-bottom: 12px; }
  .stim-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 12px; }
  .stim-link { display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: 6px; background: #222240; border: 1px solid #333; text-decoration: none; font-size: 12px; color: #bbb; transition: border-color 0.15s; }
  .stim-link:hover { border-color: #666; color: #eee; }
  .footer { margin-top: 24px; font-size: 11px; color: #555; text-align: center; }
</style>
</head>
<body>
<h1>Wave 2: Spatial Acuity Validation</h1>
<div class="subtitle">
  DoG E2=${pred.parameters.dog_e2 || 0.15} &middot;
  rg_decay=${pred.parameters.rg_decay} &middot; yv_decay=${pred.parameters.yv_decay} &middot;
  fovea=${pred.geometry.fovea_radius_px}px &middot;
  <span>${new Date().toISOString().split('T')[0]}</span>
</div>

<div class="intro">
  <strong>What this tests:</strong> Scrutinizer's Mode 0 uses a 5-band Difference-of-Gaussians (DoG) decomposition
  to approximate how spatial resolution degrades with eccentricity. Each band targets a spatial frequency
  (0.25–4 cpd) and is attenuated by an M-scaling sigmoid derived from Rovamo & Virsu (1979).
  Higher frequencies are cut at smaller eccentricities — matching the cortical magnification principle
  that peripheral neurons pool over larger receptive fields, losing fine detail first.
  We validate these predictions against sine-wave grating screenshots processed through Scrutinizer,
  and compare the M-scaling cutoff positions against published human contrast sensitivity data.
</div>

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
  </div>`;
}).join('\n')}
</div>

<div class="go-wrap" tabindex="0">
  <div class="go-btn">Go <span class="arrow">&#9654;</span></div>
  <div class="flyout">
    <h3>Experimental Stimulus</h3>
    <div class="stim-grid">
${[0.25, 0.5, 1, 2, 4].map(f =>
  `      <a class="stim-link" href="https://andyed.github.io/scrutinizer-www/reference-pages/spatial-acuity.html?mode=single&freq=${f}&contrast=1" target="_blank">${f} cpd</a>`
).join('\n')}
      <a class="stim-link" href="https://andyed.github.io/scrutinizer-www/reference-pages/spatial-acuity.html?mode=ladder&contrast=1" target="_blank">Freq Ladder</a>
    </div>
  </div>
</div>

<div class="charts">
${buildBandRetentionChart()}
${buildRovamoComparisonChart()}
${buildMeasuredContrastChart()}
${buildFreqVsRetentionChart()}
</div>

${[1, 2, 3].map(t => {
  const items = tiers[t] || [];
  if (items.length === 0) return '';
  const label = t === 1 ? 'Must Pass' : t === 2 ? 'Should Pass' : 'Stretch';
  const descs = {
    1: `<p class="section-desc"><strong>Observation:</strong> Does the filter preserve frequency ordering (higher freq attenuated more)
    and monotonic eccentricity decay? Model predictions should hold by construction. Measured grating contrast
    should decrease with eccentricity when processed through Scrutinizer. <em>Note: foveal-relative measurements
    fail at low frequencies (0.25–0.5 cpd) because the foveal patch is too small for a full grating cycle.
    Cross-condition retention is the more robust metric.</em></p>`,
    2: `<p class="section-desc"><strong>Observation:</strong> Do the M-scaling cutoff positions match the expected values from Rovamo & Virsu (1979)?
    E2 = 0.15 for the DoG decomposition means band0 (4 cpd) cuts at 0.15 normalized eccentricity,
    band1 at 0.45, band2 at 1.05, band3 at 2.25. We also check that chromatic decay respects
    the achromatic ≥ BY ≥ RG ordering from castleCSF.</p>`,
    3: `<p class="section-desc"><strong>Observation:</strong> Does the model's eccentricity-dependent sensitivity profile correlate with
    published human CSF data? This is a stretch goal because the 5-band DoG approximation produces
    step-function cutoffs, while human CSF decays smoothly. A composite (summed-band) comparison
    would be more appropriate than per-band correlation against a continuous curve.</p>`,
  };
  return `<div class="results" style="margin-bottom:16px">
  <h3>Tier ${t}: ${label}</h3>
  ${descs[t] || ''}
  ${items.map(i => `<div class="result-row">
    <span class="badge ${i.status.toLowerCase()}">${i.status}</span>
    <span class="result-text">${i.text}</span>
  </div>`).join('\n  ')}
</div>`;
}).join('\n')}

<div class="footer">
  Scrutinizer Wave 2 &middot; DoG band decomposition &middot; M-scaling (Rovamo &amp; Virsu 1979) &middot; castleCSF
</div>
</body>
</html>`;

fs.mkdirSync(REPORT_DIR, { recursive: true });
const reportPath = path.join(REPORT_DIR, 'spatial-acuity-report.html');
fs.writeFileSync(reportPath, html);
console.log(`Visual report: ${reportPath}`);
if (hasFlag('open')) execSync(`open "${reportPath}"`);
