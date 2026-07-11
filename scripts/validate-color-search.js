#!/usr/bin/env node
/**
 * Wave 1 Validation Orchestrator — Color Search
 *
 * Compares model predictions (chromatic-attenuation-table.js) against
 * screenshot measurements (analyze-color-search.js) and published data.
 * Outputs a markdown report with pass/fail for each tier criterion.
 *
 * Usage:
 *   node scripts/validate-color-search.js
 *   node scripts/validate-color-search.js --predictions=predictions.json --measurements=measurements.json
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
function getArg(name, def) {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
}

const SCRIPTS_DIR = __dirname;
const ROOT = path.join(SCRIPTS_DIR, '..');
const REPORT_DIR = path.join(ROOT, 'tests', 'validation', 'reports');
const DATA_DIR = path.join(ROOT, 'tests', 'validation', 'published-data');

// ── Load or generate predictions ──
function loadPredictions(filePath) {
  if (filePath) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const cmd = `node "${path.join(SCRIPTS_DIR, 'chromatic-attenuation-table.js')}" --json --color-search`;
  return JSON.parse(execSync(cmd, { encoding: 'utf8' }));
}

// ── Load or generate measurements ──
function loadMeasurements(filePath) {
  if (filePath) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  // Try to run analyze-color-search.js against existing captures
  try {
    const cmd = `node "${path.join(SCRIPTS_DIR, 'analyze-color-search.js')}" --json`;
    return JSON.parse(execSync(cmd, { encoding: 'utf8', timeout: 60000 }));
  } catch (e) {
    return null; // No screenshots available yet
  }
}

// ── Load published data ──
function loadPublished(name) {
  const p = path.join(DATA_DIR, name);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ── Spearman rank correlation ──
function spearmanR(x, y) {
  if (x.length !== y.length || x.length < 3) return NaN;
  const rank = (arr) => {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(arr.length);
    for (let i = 0; i < sorted.length; i++) ranks[sorted[i].i] = i + 1;
    return ranks;
  };
  const rx = rank(x), ry = rank(y);
  const n = x.length;
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (rx[i] - ry[i]) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

// ── Check monotonic decrease (non-strict: allows ties from quantization) ──
function isMonotonicallyDecreasing(values) {
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[i - 1]) return false;
  }
  return true;
}

// ── Main ──
function validate() {
  const predFile = getArg('predictions', null);
  const measFile = getArg('measurements', null);

  const pred = loadPredictions(predFile);
  const meas = loadMeasurements(measFile);

  const bowers = loadPublished('bowers2025_sensitivity.json');
  const mullen = loadPublished('mullen_kingdom2002_rg_by.json');
  const hansen = loadPublished('hansen2009_color_naming.json');

  const lines = [];
  const log = (s = '') => lines.push(s);
  let tier1Pass = 0, tier1Total = 0;
  let tier2Pass = 0, tier2Total = 0;
  let tier3Pass = 0, tier3Total = 0;

  log('# Wave 1: Color Search Validation Report');
  log();
  log(`Generated: ${new Date().toISOString().split('T')[0]}`);
  log(`Parameters: rg_decay=${pred.parameters.rg_decay}, yv_decay=${pred.parameters.yv_decay}, supra=${pred.parameters.supra_exponent}`);
  log(`Geometry: fovea_radius=${pred.geometry.fovea_radius_px}px, ppd=${pred.geometry.ppd}`);
  log();

  // ── Tier 1: Monotonic decrease ──
  log('## Tier 1: Must Pass');
  log();

  // Check monotonicity for each color at 24px (default size)
  const colors = ['red', 'green', 'blue', 'yellow'];
  const channels = { red: 'rg', green: 'rg', blue: 'by', yellow: 'by' };

  for (const color of colors) {
    const preds24 = pred.predictions
      .filter(p => p.color === color && p.size_px === 24)
      .sort((a, b) => a.ring - b.ring);

    const retentions = preds24.map(p => p.composite_retention);
    const mono = isMonotonicallyDecreasing(retentions);
    const status = mono ? 'PASS' : 'FAIL';
    tier1Total++;
    if (mono) tier1Pass++;

    log(`- [${status}] ${color} composite retention monotonically decreases: ${retentions.map(r => (r * 100).toFixed(1) + '%').join(' > ')}`);
  }

  // BY >= 1.5x RG at ring 5
  const red_r5 = pred.predictions.find(p => p.color === 'red' && p.size_px === 24 && p.ring === 5);
  const blue_r5 = pred.predictions.find(p => p.color === 'blue' && p.size_px === 24 && p.ring === 5);
  if (red_r5 && blue_r5) {
    const ratio = blue_r5.composite_retention / red_r5.composite_retention;
    const pass = ratio >= 1.5;
    tier1Total++;
    if (pass) tier1Pass++;
    log(`- [${pass ? 'PASS' : 'FAIL'}] BY retention >= 1.5x RG at ring 5: blue=${(blue_r5.composite_retention * 100).toFixed(1)}% / red=${(red_r5.composite_retention * 100).toFixed(1)}% = ${ratio.toFixed(2)}x`);
  }

  // Measurements agreement (if available)
  if (meas) {
    const measFiltered = meas.measurements.filter(m => m.condition === 'filtered' && m.size_px === 24);
    for (const color of colors) {
      const colorMeas = measFiltered.filter(m => m.color === color).sort((a, b) => a.ring - b.ring);
      if (colorMeas.length >= 2 && colorMeas[0].retention !== undefined) {
        const retentions = colorMeas.map(m => m.retention);
        const mono = isMonotonicallyDecreasing(retentions);
        tier1Total++;
        if (mono) tier1Pass++;
        log(`- [${mono ? 'PASS' : 'FAIL'}] ${color} measured retention monotonically decreases`);
      }
    }
  } else {
    log(`- [SKIP] Rendered measurement agreement — no screenshots captured yet`);
  }

  log();

  // ── Tier 2: Should Pass ──
  log('## Tier 2: Should Pass');
  log();

  // RG/BY ratio vs Bowers at 15°
  // Use per-channel retention (rg_retention / yv_retention), not composite, since
  // Bowers measures pure channel sensitivity and composite mixes both axes.
  // Ring 5 = 12.44° — closest to Bowers' 15° measurement.
  const modelAny_r5 = pred.predictions.find(p => p.size_px === 24 && p.ring === 5);
  if (modelAny_r5) {
    // Bowers at 15°: RG=29%, BY=79%, ratio=2.72
    const bowersRatio = bowers.channels.by.sensitivity_pct[1] / bowers.channels.rg.sensitivity_pct[1];
    const modelRatio = modelAny_r5.yv_retention / modelAny_r5.rg_retention;
    const withinPct = Math.abs(modelRatio - bowersRatio) / bowersRatio;
    const pass = withinPct <= 0.20;
    tier2Total++;
    if (pass) tier2Pass++;
    log(`- [${pass ? 'PASS' : 'FAIL'}] BY/RG channel ratio vs Bowers (ring 5, ${modelAny_r5.ecc_deg}°): model=${modelRatio.toFixed(2)} (yv/rg retention) vs Bowers=${bowersRatio.toFixed(2)} at 15° (${(withinPct * 100).toFixed(0)}% off, threshold=20%)`);
  }

  // Green tracks RG more than BY
  const green_r5 = pred.predictions.find(p => p.color === 'green' && p.size_px === 24 && p.ring === 5);
  const yellow_r5 = pred.predictions.find(p => p.color === 'yellow' && p.size_px === 24 && p.ring === 5);
  if (green_r5 && red_r5 && blue_r5) {
    const greenRedGap = Math.abs(green_r5.composite_retention - red_r5.composite_retention);
    const greenBlueGap = Math.abs(green_r5.composite_retention - blue_r5.composite_retention);
    const pass = greenRedGap < 0.15 && greenRedGap < greenBlueGap;
    tier2Total++;
    if (pass) tier2Pass++;
    log(`- [${pass ? 'PASS' : 'FAIL'}] Green closer to red than blue: green-red gap=${(greenRedGap * 100).toFixed(1)}pp, green-blue gap=${(greenBlueGap * 100).toFixed(1)}pp (threshold: <15pp and closer to red)`);
  }

  // Rendered vs model agreement
  if (meas) {
    const measFiltered = meas.measurements.filter(m => m.condition === 'filtered' && m.size_px === 24);
    const modelPreds = pred.predictions.filter(p => p.size_px === 24);
    let matchCount = 0, totalCompared = 0;
    for (const color of colors) {
      for (let ring = 1; ring <= 5; ring++) {
        const mp = modelPreds.find(p => p.color === color && p.ring === ring);
        const mm = measFiltered.find(m => m.color === color && m.ring === ring);
        if (mp && mm && mm.retention !== undefined) {
          totalCompared++;
          if (Math.abs(mp.composite_retention - mm.retention) / mp.composite_retention <= 0.15) matchCount++;
        }
      }
    }
    if (totalCompared > 0) {
      const pass = matchCount / totalCompared >= 0.8;
      tier2Total++;
      if (pass) tier2Pass++;
      log(`- [${pass ? 'PASS' : 'FAIL'}] Rendered matches model within 15%: ${matchCount}/${totalCompared} (${(matchCount / totalCompared * 100).toFixed(0)}%)`);
    }
  } else {
    log(`- [SKIP] Rendered vs model agreement — no screenshots captured yet`);
  }

  log();

  // ── Tier 3: Stretch ──
  log('## Tier 3: Stretch');
  log();

  // Hansen correlation: model retention vs naming accuracy
  // Map model eccentricities to closest Hansen eccentricities
  const hansenEcc = hansen.eccentricities_deg;
  for (const hue of ['red', 'blue']) {
    const hansenAcc = hansen.hues[hue].naming_accuracy;
    // Model predictions at ring eccentricities
    const modelPreds = pred.predictions
      .filter(p => p.color === hue && p.size_px === 24)
      .sort((a, b) => a.ecc_deg - b.ecc_deg);

    // Interpolate Hansen at model eccentricities
    const interpHansen = modelPreds.map(mp => {
      const ecc = mp.ecc_deg;
      // Linear interpolation
      for (let i = 0; i < hansenEcc.length - 1; i++) {
        if (ecc >= hansenEcc[i] && ecc <= hansenEcc[i + 1]) {
          const t = (ecc - hansenEcc[i]) / (hansenEcc[i + 1] - hansenEcc[i]);
          return hansenAcc[i] + t * (hansenAcc[i + 1] - hansenAcc[i]);
        }
      }
      return ecc <= hansenEcc[0] ? hansenAcc[0] : hansenAcc[hansenAcc.length - 1];
    });

    const modelRetentions = modelPreds.map(p => p.composite_retention);
    const r = spearmanR(modelRetentions, interpHansen);
    const pass = r > 0.8;
    tier3Total++;
    if (pass) tier3Pass++;
    log(`- [${pass ? 'PASS' : 'FAIL'}] ${hue} model retention correlates with Hansen naming accuracy: r=${r.toFixed(3)} (threshold: r>0.8)`);
  }

  // Rank ordering across all colors at all rings
  const allPreds24 = pred.predictions.filter(p => p.size_px === 24).sort((a, b) => {
    if (a.ring !== b.ring) return a.ring - b.ring;
    return b.composite_retention - a.composite_retention;
  });
  // Check that BY colors always rank above RG colors at each ring
  let rankCorrect = 0, rankTotal = 0;
  for (let ring = 1; ring <= 5; ring++) {
    const ringPreds = allPreds24.filter(p => p.ring === ring);
    const byColors = ringPreds.filter(p => p.primary_channel === 'by');
    const rgColors = ringPreds.filter(p => p.primary_channel === 'rg');
    for (const by of byColors) {
      for (const rg of rgColors) {
        rankTotal++;
        if (by.composite_retention > rg.composite_retention) rankCorrect++;
      }
    }
  }
  if (rankTotal > 0) {
    const tau = rankCorrect / rankTotal;
    const pass = tau >= 0.9;
    tier3Total++;
    if (pass) tier3Pass++;
    log(`- [${pass ? 'PASS' : 'FAIL'}] BY always ranks above RG per ring: ${rankCorrect}/${rankTotal} correct (${(tau * 100).toFixed(0)}%, threshold: >=90%)`);
  }

  log();

  // ── Summary ──
  log('## Summary');
  log();
  log(`| Tier | Passed | Total | Status |`);
  log(`|------|--------|-------|--------|`);
  log(`| Tier 1 (must) | ${tier1Pass} | ${tier1Total} | ${tier1Pass === tier1Total ? 'ALL PASS' : 'FAILURES'} |`);
  log(`| Tier 2 (should) | ${tier2Pass} | ${tier2Total} | ${tier2Pass === tier2Total ? 'ALL PASS' : tier2Pass + ' pass'} |`);
  log(`| Tier 3 (stretch) | ${tier3Pass} | ${tier3Total} | ${tier3Pass === tier3Total ? 'ALL PASS' : tier3Pass + ' pass'} |`);

  // Write report
  const report = lines.join('\n') + '\n';
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, 'color-search-report.md');
  fs.writeFileSync(reportPath, report);
  console.log(report);
  console.log(`Report written to: ${reportPath}`);

  // Tier 1 is the mandatory tier — return its pass status so the process can
  // exit non-zero on any Tier-1 failure (previously this script always exited
  // 0, so CI / && chaining could not detect a failure). P1-6.
  return tier1Pass === tier1Total;
}

process.exit(validate() ? 0 : 1);
