#!/usr/bin/env node
/**
 * Generate visual HTML report for Wave 3 crowding validation.
 * Follows Wave 2 report template (report-spatial-acuity.js).
 *
 * Usage:
 *   node scripts/report-crowding.js
 *   node scripts/report-crowding.js --open
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const SCRIPTS = __dirname;
const ROOT = path.join(SCRIPTS, '..');
const REPORT_DIR = path.join(ROOT, 'tests', 'validation', 'reports');
const hasFlag = (name) => process.argv.includes(`--${name}`);

// ── Load validation results ──
let validation = null;
try {
  const raw = execSync(
    `node "${path.join(SCRIPTS, 'validate-crowding.js')}" --json`,
    { encoding: 'utf8' }
  );
  validation = JSON.parse(raw);
} catch (e) {
  console.error('Warning: validate-crowding.js failed:', e.message);
}

// ── Load mode comparison (optional) ──
let modeComparison = null;
try {
  const raw = execSync(
    `node "${path.join(SCRIPTS, 'compare-crowding-modes.js')}" --json`,
    { encoding: 'utf8' }
  );
  const jsonMarker = raw.indexOf('--- JSON ---');
  if (jsonMarker >= 0) {
    modeComparison = JSON.parse(raw.slice(jsonMarker + '--- JSON ---'.length).trim());
  }
} catch (e) { /* mode comparison captures may not exist */ }

// ── Parse validation checks into tiers ──
function parseTiers(val) {
  const tiers = { 1: [], 2: [], 3: [] };
  if (!val || !val.checks) return tiers;
  for (const c of val.checks) {
    tiers[c.tier] = tiers[c.tier] || [];
    tiers[c.tier].push(c);
  }
  return tiers;
}

const tiers = parseTiers(validation);

// ── Chart helpers ──
function scaleX(val, min, max, w) { return (val - min) / (max - min) * w; }
function scaleY(val, min, max, h) { return h - (val - min) / (max - min) * h; }

// Chart 1: MIP Pooling vs Bouma — eccentricity vs pooling size with Bouma line
function buildMipBoumaChart() {
  const geom = validation?.geometry;
  if (!geom || !geom.mip_pooling) {
    return `<div class="chart-box"><h3>MIP Pooling vs Bouma (no data)</h3><svg width="540" height="300"><text x="270" y="150" text-anchor="middle" fill="#555" font-size="14">Run geometry analysis first</text></svg></div>`;
  }

  const W = 540, H = 300;
  const m = { top: 20, right: 20, bottom: 36, left: 48 };
  const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
  const xMin = 0, xMax = 16, yMin = 0, yMax = 8;

  const mipData = geom.mip_pooling;

  let svg = `<div class="chart-box">
  <h3>MIP Pooling Region vs Bouma Critical Spacing</h3>
  <p class="chart-desc">Blue: MIP pooling diameter in degrees (2^mipLevel / ppd). Red dashed: Bouma's 0.5&times;eccentricity.
  MIP pooling is ~5% of Bouma — intentionally small. MIP handles frequency-domain averaging;
  V1 Lateral Smash handles the spatial extent of crowding interference.</p>
  <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <g transform="translate(${m.left},${m.top})">`;

  // Grid
  for (let y = 0; y <= yMax; y += 1) {
    const py = scaleY(y, yMin, yMax, ih);
    svg += `<line x1="0" y1="${py}" x2="${iw}" y2="${py}" class="grid-line"/>`;
    svg += `<text x="-8" y="${py + 3}" text-anchor="end" class="axis-label">${y}°</text>`;
  }
  for (let x = 0; x <= 16; x += 2) {
    svg += `<text x="${scaleX(x, xMin, xMax, iw)}" y="${ih + 16}" text-anchor="middle" class="axis-label">${x}°</text>`;
  }
  svg += `<text x="${iw / 2}" y="${ih + 32}" text-anchor="middle" class="axis-label">Eccentricity (degrees)</text>`;

  // Bouma line (dashed red)
  const boumaD = `M${scaleX(0, xMin, xMax, iw)},${scaleY(0, yMin, yMax, ih)} L${scaleX(xMax, xMin, xMax, iw)},${scaleY(xMax * 0.5, yMin, yMax, ih)}`;
  svg += `<path d="${boumaD}" fill="none" stroke="#e04040" stroke-width="2" stroke-dasharray="6 3" opacity="0.7"/>`;
  svg += `<text x="${scaleX(14, xMin, xMax, iw) + 4}" y="${scaleY(7, yMin, yMax, ih)}" class="legend" fill="#e04040">Bouma 0.5&times;ecc</text>`;

  // MIP pooling (solid blue)
  let d = '';
  for (const p of mipData) {
    d += (d ? ' L' : 'M') + `${scaleX(p.ecc_deg, xMin, xMax, iw)},${scaleY(p.pool_deg, yMin, yMax, ih)}`;
  }
  svg += `<path d="${d}" fill="none" stroke="#4080e0" stroke-width="2"/>`;
  for (const p of mipData) {
    svg += `<circle cx="${scaleX(p.ecc_deg, xMin, xMax, iw)}" cy="${scaleY(p.pool_deg, yMin, yMax, ih)}" r="3" fill="#4080e0" stroke="#1a1a2e" stroke-width="2"/>`;
  }

  svg += `</g></svg></div>`;
  return svg;
}

// Chart 2: Crowding Ratio by Eccentricity — 3 font-size series
function buildCrowdingRatioChart() {
  const meas = validation?.measurements;
  if (!meas || !meas.measurements) {
    return `<div class="chart-box"><h3>Crowding Ratio (no screenshots)</h3><svg width="540" height="300"><text x="270" y="150" text-anchor="middle" fill="#555" font-size="14">Capture screenshots first</text></svg></div>`;
  }

  const W = 540, H = 300;
  const m = { top: 20, right: 20, bottom: 36, left: 48 };
  const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
  const xMin = 0, xMax = 12, yMin = 0, yMax = 1.5;

  const fontColors = { 16: '#e09040', 28: '#4080e0', 48: '#40c060' };
  const data = meas.measurements;

  let svg = `<div class="chart-box">
  <h3>Crowding Ratio by Eccentricity</h3>
  <p class="chart-desc">Crowded/isolated cyan pixel ratio across 3 font sizes.
  Below 1.0 = crowding effect present. Below 0.8 at 6°+ is Tier 1 requirement.
  Similar ratios across font sizes validates Pelli &amp; Tillman size independence.</p>
  <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <g transform="translate(${m.left},${m.top})">`;

  for (let y = 0; y <= 1.4; y += 0.2) {
    const py = scaleY(y, yMin, yMax, ih);
    svg += `<line x1="0" y1="${py}" x2="${iw}" y2="${py}" class="grid-line"/>`;
    svg += `<text x="-8" y="${py + 3}" text-anchor="end" class="axis-label">${y.toFixed(1)}</text>`;
  }
  for (let x = 0; x <= 12; x += 2) {
    svg += `<text x="${scaleX(x, xMin, xMax, iw)}" y="${ih + 16}" text-anchor="middle" class="axis-label">${x}°</text>`;
  }
  svg += `<text x="${iw / 2}" y="${ih + 32}" text-anchor="middle" class="axis-label">Eccentricity (degrees)</text>`;

  // 0.8 threshold line
  svg += `<line x1="0" y1="${scaleY(0.8, yMin, yMax, ih)}" x2="${iw}" y2="${scaleY(0.8, yMin, yMax, ih)}" stroke="#e04040" stroke-width="1" stroke-dasharray="4 4" opacity="0.5"/>`;
  svg += `<text x="${iw - 2}" y="${scaleY(0.8, yMin, yMax, ih) - 4}" text-anchor="end" class="legend" fill="#e04040">0.8 threshold</text>`;

  // 1.0 reference line
  svg += `<line x1="0" y1="${scaleY(1.0, yMin, yMax, ih)}" x2="${iw}" y2="${scaleY(1.0, yMin, yMax, ih)}" stroke="#555" stroke-width="1" stroke-dasharray="4 4"/>`;

  for (const fs of [16, 28, 48]) {
    const color = fontColors[fs];
    const eccs = [3, 6, 10];
    const pts = eccs.map(ecc => {
      const rows = data.filter(r => r.fontSize === fs && r.ecc_deg === ecc && r.crowdingRatio !== null);
      if (rows.length === 0) return null;
      return { ecc, ratio: rows.reduce((s, r) => s + r.crowdingRatio, 0) / rows.length };
    }).filter(Boolean);

    if (pts.length < 2) continue;

    let d = '';
    for (const p of pts) {
      d += (d ? ' L' : 'M') + `${scaleX(p.ecc, xMin, xMax, iw)},${scaleY(p.ratio, yMin, yMax, ih)}`;
    }
    svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>`;
    for (const p of pts) {
      svg += `<circle cx="${scaleX(p.ecc, xMin, xMax, iw)}" cy="${scaleY(p.ratio, yMin, yMax, ih)}" r="4" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
    }
  }

  // Legend
  let ly = 8;
  for (const [fs, label] of [[16, '16px'], [28, '28px'], [48, '48px']]) {
    svg += `<rect x="${iw - 70}" y="${ly - 6}" width="12" height="3" fill="${fontColors[fs]}" rx="1"/>`;
    svg += `<text x="${iw - 54}" y="${ly}" class="legend">${label}</text>`;
    ly += 14;
  }

  svg += `</g></svg></div>`;
  return svg;
}

// Chart 3: Spacing Transition — displacement vs spacing ratio with sigmoid overlay
function buildSpacingChart() {
  const tier3 = validation?.measurements?.tier3;
  if (!tier3 || !tier3.sigmoidFit || !tier3.sigmoidFit.available || !tier3.sigmoidFit.dataPoints) {
    return `<div class="chart-box"><h3>Bouma Spacing Transition (no data)</h3><svg width="540" height="300"><text x="270" y="150" text-anchor="middle" fill="#555" font-size="14">Capture spacing screenshots first</text></svg></div>`;
  }

  const sf = tier3.sigmoidFit;
  const W = 540, H = 300;
  const mm = { top: 20, right: 20, bottom: 36, left: 48 };
  const iw = W - mm.left - mm.right, ih = H - mm.top - mm.bottom;
  const xMin = 0.1, xMax = 0.9, yMin = 0, yMax = 1.2;

  let svg = `<div class="chart-box">
  <h3>Bouma Spacing Transition</h3>
  <p class="chart-desc">Cyan survival vs flanker spacing ratio at 6° eccentricity. The sigmoid fit (orange)
  should center near 0.5&times; (Bouma's critical spacing). x0=${sf.x0}, k=${sf.k}, R&sup2;=${sf.r2}.</p>
  <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <g transform="translate(${mm.left},${mm.top})">`;

  for (let y = 0; y <= 1.0; y += 0.2) {
    const py = scaleY(y, yMin, yMax, ih);
    svg += `<line x1="0" y1="${py}" x2="${iw}" y2="${py}" class="grid-line"/>`;
    svg += `<text x="-8" y="${py + 3}" text-anchor="end" class="axis-label">${y.toFixed(1)}</text>`;
  }
  for (let x = 0.2; x <= 0.8; x += 0.1) {
    svg += `<text x="${scaleX(x, xMin, xMax, iw)}" y="${ih + 16}" text-anchor="middle" class="axis-label">${x.toFixed(1)}x</text>`;
  }
  svg += `<text x="${iw / 2}" y="${ih + 32}" text-anchor="middle" class="axis-label">Flanker Spacing (fraction of eccentricity)</text>`;

  // 0.5x vertical reference
  svg += `<line x1="${scaleX(0.5, xMin, xMax, iw)}" y1="0" x2="${scaleX(0.5, xMin, xMax, iw)}" y2="${ih}" stroke="#e04040" stroke-width="1" stroke-dasharray="4 4" opacity="0.5"/>`;
  svg += `<text x="${scaleX(0.5, xMin, xMax, iw) + 4}" y="12" class="legend" fill="#e04040">Bouma 0.5x</text>`;

  // Data points (blue)
  for (const dp of sf.dataPoints) {
    svg += `<circle cx="${scaleX(dp.ratio, xMin, xMax, iw)}" cy="${scaleY(dp.survival, yMin, yMax, ih)}" r="5" fill="#4080e0" stroke="#fff" stroke-width="2"/>`;
  }

  // Isolated reference
  if (sf.isolatedSurvival !== null) {
    svg += `<line x1="0" y1="${scaleY(sf.isolatedSurvival, yMin, yMax, ih)}" x2="${iw}" y2="${scaleY(sf.isolatedSurvival, yMin, yMax, ih)}" stroke="#40c060" stroke-width="1" stroke-dasharray="6 3" opacity="0.5"/>`;
    svg += `<text x="${iw - 2}" y="${scaleY(sf.isolatedSurvival, yMin, yMax, ih) - 4}" text-anchor="end" class="legend" fill="#40c060">isolated</text>`;
  }

  // Sigmoid fit curve (orange)
  if (sf.x0 !== null && sf.k !== null) {
    let d = '';
    for (let x = xMin; x <= xMax; x += 0.01) {
      // Reconstruct sigmoid in raw survival space
      const sVals = sf.dataPoints.map(dp => dp.survival);
      const sMin = Math.min(...sVals);
      const sMax = Math.max(...sVals);
      const range = sMax - sMin;
      const normalized = 1 / (1 + Math.exp(-sf.k * (x - sf.x0)));
      const y = sMin + normalized * range;
      d += (d ? ' L' : 'M') + `${scaleX(x, xMin, xMax, iw)},${scaleY(y, yMin, yMax, ih)}`;
    }
    svg += `<path d="${d}" fill="none" stroke="#e09040" stroke-width="2" opacity="0.8"/>`;
  }

  svg += `</g></svg></div>`;
  return svg;
}

// Chart 4: Mode Comparison — mode 0 vs mode 10 crowding ratios
function buildModeComparisonChart() {
  if (!modeComparison) {
    return `<div class="chart-box"><h3>Mode 0 vs Mode 10 (no captures)</h3><svg width="540" height="300"><text x="270" y="150" text-anchor="middle" fill="#555" font-size="14">Capture mode 10 screenshots first</text></svg></div>`;
  }

  const W = 540, H = 300;
  const mm = { top: 20, right: 20, bottom: 36, left: 48 };
  const iw = W - mm.left - mm.right, ih = H - mm.top - mm.bottom;
  const xMin = 0, xMax = 12, yMin = 0, yMax = 1.5;

  const summary = modeComparison.summary;

  let svg = `<div class="chart-box">
  <h3>Mode 0 (MIP) vs Mode 10 (Mongrel)</h3>
  <p class="chart-desc">Crowding ratio comparison. Mode 10's oriented-noise metamer synthesis should
  produce stronger crowding differentiation (lower ratio) than Mode 0's isotropic MIP blur.
  Peripheral crowding: Mode 0=${summary.peripheral_crowding_ratio?.mode0?.toFixed(3) || 'N/A'},
  Mode 10=${summary.peripheral_crowding_ratio?.mode10?.toFixed(3) || 'N/A'}.</p>
  <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <g transform="translate(${mm.left},${mm.top})">`;

  for (let y = 0; y <= 1.4; y += 0.2) {
    const py = scaleY(y, yMin, yMax, ih);
    svg += `<line x1="0" y1="${py}" x2="${iw}" y2="${py}" class="grid-line"/>`;
    svg += `<text x="-8" y="${py + 3}" text-anchor="end" class="axis-label">${y.toFixed(1)}</text>`;
  }
  for (let x = 0; x <= 12; x += 2) {
    svg += `<text x="${scaleX(x, xMin, xMax, iw)}" y="${ih + 16}" text-anchor="middle" class="axis-label">${x}°</text>`;
  }
  svg += `<text x="${iw / 2}" y="${ih + 32}" text-anchor="middle" class="axis-label">Eccentricity (degrees)</text>`;

  // Extract per-eccentricity data from mode0 and mode10 results
  const mode0 = modeComparison.mode0 || [];
  const mode10 = modeComparison.mode10 || [];
  const eccs = [3, 6, 10];
  const modeColors = { 0: '#4080e0', 10: '#e09040' };

  for (const [modeResults, modeId, color] of [[mode0, 0, modeColors[0]], [mode10, 10, modeColors[10]]]) {
    const pts = eccs.map(ecc => {
      const rows = modeResults.filter(r => r.fontSize === 28 && r.ecc_deg === ecc && r.crowdingRatio !== null);
      if (rows.length === 0) return null;
      return { ecc, ratio: rows.reduce((s, r) => s + r.crowdingRatio, 0) / rows.length };
    }).filter(Boolean);

    if (pts.length < 2) continue;

    let d = '';
    for (const p of pts) {
      d += (d ? ' L' : 'M') + `${scaleX(p.ecc, xMin, xMax, iw)},${scaleY(p.ratio, yMin, yMax, ih)}`;
    }
    svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>`;
    for (const p of pts) {
      svg += `<circle cx="${scaleX(p.ecc, xMin, xMax, iw)}" cy="${scaleY(p.ratio, yMin, yMax, ih)}" r="4" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
    }
  }

  // Legend
  svg += `<rect x="${iw - 90}" y="2" width="12" height="3" fill="${modeColors[0]}" rx="1"/>`;
  svg += `<text x="${iw - 74}" y="8" class="legend">Mode 0 (MIP)</text>`;
  svg += `<rect x="${iw - 90}" y="16" width="12" height="3" fill="${modeColors[10]}" rx="1"/>`;
  svg += `<text x="${iw - 74}" y="22" class="legend">Mode 10 (Mongrel)</text>`;

  // Hypothesis results
  const hyp = modeComparison.hypotheses;
  if (hyp) {
    let hy = 40;
    for (const [key, label] of [
      ['h1_stronger_crowding', 'H1: Stronger crowding'],
      ['h2_more_dispersion', 'H2: More dispersion'],
      ['h3_foveal_preserved', 'H3: Foveal preserved'],
    ]) {
      const val = hyp[key];
      const color = val ? '#4ade80' : '#fbbf24';
      svg += `<circle cx="${iw - 86}" cy="${hy}" r="3" fill="${color}"/>`;
      svg += `<text x="${iw - 78}" y="${hy + 3}" class="legend">${label}: ${val ? 'PASS' : 'FAIL'}</text>`;
      hy += 14;
    }
  }

  svg += `</g></svg></div>`;
  return svg;
}

// ── Build HTML ──
const geomParams = validation?.geometry?.parameters;
const paramStr = geomParams
  ? `cmf_a=${geomParams.CMF_A} &middot; ecc_scaling=${geomParams.ECC_SCALING} &middot; radial_bias=${geomParams.CROWDING_RADIAL_BIAS} &middot; fovea=${geomParams.FOVEA_RADIUS}px`
  : 'parameters unavailable';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Wave 3: Crowding Geometry Validation</title>
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
  .badge.info { background: #1e3a5f; color: #7db4e0; }
  .result-text { color: #bbb; }
  .footer { margin-top: 24px; font-size: 11px; color: #555; text-align: center; }
</style>
</head>
<body>
<h1>Wave 3: Crowding Geometry Validation</h1>
<div class="subtitle">
  ${paramStr} &middot;
  <span>${new Date().toISOString().split('T')[0]}</span>
</div>

<div class="intro">
  <strong>What this tests:</strong> Scrutinizer models crowding through three mechanisms:
  MIP pooling (V4 receptive field growth), polar sector quantization (V1/V4), and
  density-gated V1 displacement (Lateral Smash). We validate that these mechanisms collectively
  reproduce the spatial geometry of crowding described by Bouma (1970) — critical spacing
  proportional to eccentricity — and the radial:tangential asymmetry found by Toet &amp; Levi (1992).
  Tier 3 stretch goals test size independence (Pelli &amp; Tillman 2008), stimulus specificity,
  and the sharpness of the Bouma transition.
</div>

<div class="scorecard">
${[1, 2, 3].map(t => {
  const items = tiers[t] || [];
  const pass = items.filter(i => i.status === 'PASS').length;
  const total = items.filter(i => i.status !== 'SKIP').length;
  const label = t === 1 ? 'Must Pass' : t === 2 ? 'Should Pass' : 'Stretch';
  const cls = total === 0 ? 'has-fail' : pass === total ? 'all-pass' : pass === 0 ? 'all-fail' : 'has-fail';
  return `  <div class="tier-card ${cls}">
    <h3>Tier ${t}: ${label}</h3>
    <div class="score">${pass} <span class="of">/ ${total}</span></div>
  </div>`;
}).join('\n')}
</div>

<div class="charts">
${buildMipBoumaChart()}
${buildCrowdingRatioChart()}
${buildSpacingChart()}
${buildModeComparisonChart()}
</div>

${[1, 2, 3].map(t => {
  const items = tiers[t] || [];
  if (items.length === 0) return '';
  const label = t === 1 ? 'Must Pass' : t === 2 ? 'Should Pass' : 'Stretch';
  const descs = {
    1: `<p class="section-desc"><strong>Core checks:</strong> Does the filter differentiate crowded from isolated targets (ratio &lt; 0.8)?
    Do MIP pooling regions grow proportionally with eccentricity? Does the radial bias parameter
    ensure crowding extends further radially than tangentially?</p>`,
    2: `<p class="section-desc"><strong>Quantitative match:</strong> Is the MIP pooling diameter within a reasonable multiple of Bouma's
    0.5&times;eccentricity? Does the density gate produce measurably different effects at near vs far eccentricities?
    Is the radial:tangential ratio consistent with Toet &amp; Levi's ~2:1 finding?</p>`,
    3: `<p class="section-desc"><strong>Stretch goals:</strong> Size independence (Pelli &amp; Tillman 2008) — crowding ratio should be
    similar across font sizes at matched eccentricity. Stimulus specificity — harder flanker conditions should
    produce stronger crowding. Bouma transition — the spacing curve should show a sigmoid centered near 0.5&times;.</p>`,
  };
  return `<div class="results" style="margin-bottom:16px">
  <h3>Tier ${t}: ${label}</h3>
  ${descs[t] || ''}
  ${items.map(i => {
    const detailStr = i.detail ? ` (${typeof i.detail === 'object' ? JSON.stringify(i.detail) : i.detail})` : '';
    return `<div class="result-row">
    <span class="badge ${i.status.toLowerCase()}">${i.status}</span>
    <span class="result-text">${i.name.replace(/_/g, ' ')}${detailStr}</span>
  </div>`;
  }).join('\n  ')}
</div>`;
}).join('\n')}

<div class="footer">
  Scrutinizer Wave 3 &middot; Bouma (1970) &middot; Toet &amp; Levi (1992) &middot; Pelli &amp; Tillman (2008)
</div>
</body>
</html>`;

fs.mkdirSync(REPORT_DIR, { recursive: true });
const reportPath = path.join(REPORT_DIR, 'crowding-report.html');
fs.writeFileSync(reportPath, html);
console.log(`Visual report: ${reportPath}`);
if (hasFlag('open')) execSync(`open "${reportPath}"`);
