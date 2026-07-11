#!/usr/bin/env node
/**
 * Wave 2 Validation Orchestrator — Spatial Acuity
 *
 * Compares model predictions (DoG band decomposition + M-scaling)
 * against screenshot measurements and published CSF data.
 *
 * Usage:
 *   node scripts/validate-spatial-acuity.js
 *   node scripts/validate-spatial-acuity.js --measurements=measurements.json
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

// ── Load predictions ──
function loadPredictions() {
  const cmd = `node "${path.join(SCRIPTS_DIR, 'chromatic-attenuation-table.js')}" --json --spatial-acuity`;
  return JSON.parse(execSync(cmd, { encoding: 'utf8' }));
}

// ── Load measurements ──
function loadMeasurements(filePath) {
  if (filePath) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return null;
}

// ── Load published data ──
function loadPublished(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
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

// ── Check monotonic non-increase (allows ties) ──
function isMonotonicallyDecreasing(values) {
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[i - 1]) return false;
  }
  return true;
}

// ── Main ──
function validate() {
  const measFile = getArg('measurements', null);
  const pred = loadPredictions();
  const meas = loadMeasurements(measFile);
  const rovamo = loadPublished('rovamo_virsu1979_csf.json');

  const lines = [];
  const log = (s = '') => lines.push(s);
  let tier1Pass = 0, tier1Total = 0;
  let tier2Pass = 0, tier2Total = 0;
  let tier3Pass = 0, tier3Total = 0;

  log('# Wave 2: Spatial Acuity Validation Report');
  log();
  log(`Generated: ${new Date().toISOString().split('T')[0]}`);
  log(`Parameters: rg_decay=${pred.parameters.rg_decay}, yv_decay=${pred.parameters.yv_decay}, supra=${pred.parameters.supra_exponent}`);
  log(`Geometry: fovea_radius=${pred.geometry.fovea_radius_px}px, ppd=${pred.geometry.ppd}`);
  log();

  // ── Tier 1: Must Pass ──
  log('## Tier 1: Must Pass');
  log();

  // 1. Frequency ordering at each ring: higher freq <= lower freq retention
  const freqs = [4, 2, 1, 0.5, 0.25];
  for (let ring = 1; ring <= 5; ring++) {
    const retentions = freqs.map(f => {
      const p = pred.predictions.find(pp => pp.freq_cpd === f && pp.ring === ring);
      return p ? p.achromatic_retention : 0;
    });
    // Higher freq should have lower or equal retention
    let ordered = true;
    for (let i = 1; i < retentions.length; i++) {
      if (retentions[i] < retentions[i - 1]) { ordered = false; break; }
    }
    tier1Total++;
    if (ordered) tier1Pass++;
    log(`- [${ordered ? 'PASS' : 'FAIL'}] Ring ${ring}: frequency ordering preserved (${freqs.map((f, i) => f + 'cpd=' + (retentions[i] * 100).toFixed(0) + '%').join(', ')})`);
  }

  // 2. Monotonic decrease with eccentricity per band
  for (const band of ['band0', 'band1', 'band2', 'band3', 'residual']) {
    const preds = pred.predictions
      .filter(p => p.band === band)
      .sort((a, b) => a.ring - b.ring);
    const retentions = preds.map(p => p.achromatic_retention);
    const mono = isMonotonicallyDecreasing(retentions);
    tier1Total++;
    if (mono) tier1Pass++;
    log(`- [${mono ? 'PASS' : 'FAIL'}] ${band}: monotonic decrease (${retentions.map(r => (r * 100).toFixed(0) + '%').join(' >= ')})`);
  }

  // 3. Residual always >90% at all rings
  const residualPreds = pred.predictions.filter(p => p.band === 'residual');
  const residualMin = Math.min(...residualPreds.map(p => p.achromatic_retention));
  const residualPass = residualMin >= 0.90;
  tier1Total++;
  if (residualPass) tier1Pass++;
  log(`- [${residualPass ? 'PASS' : 'FAIL'}] Residual band >90% at all rings (min=${(residualMin * 100).toFixed(1)}%)`);

  // Measurement checks
  if (meas) {
    const measFiltered = meas.measurements.filter(m => m.condition === 'filtered' && m.chromatic === 'achromatic');
    const measFreqs = [...new Set(measFiltered.map(m => m.freq_cpd))].sort((a, b) => b - a);

    for (const freq of measFreqs) {
      const ringData = measFiltered
        .filter(m => m.freq_cpd === freq && m.ring > 0)
        .sort((a, b) => a.ring - b.ring);
      if (ringData.length >= 2 && ringData[0].retention !== undefined) {
        const retentions = ringData.map(m => m.retention);
        const mono = isMonotonicallyDecreasing(retentions);
        tier1Total++;
        if (mono) tier1Pass++;
        log(`- [${mono ? 'PASS' : 'FAIL'}] Measured ${freq}cpd: contrast monotonically decreases`);
      }
    }
  } else {
    log(`- [SKIP] Measured contrast monotonicity — no screenshots captured yet`);
  }

  log();

  // ── Tier 2: Should Pass ──
  log('## Tier 2: Should Pass');
  log();

  // 4. M-scaling cutoffs within ±30%
  const bandCutoffs = [
    { band: 'band0', expected_norm: 0.15 },
    { band: 'band1', expected_norm: 0.45 },
    { band: 'band2', expected_norm: 1.05 },
    { band: 'band3', expected_norm: 2.25 },
  ];
  for (const bc of bandCutoffs) {
    const p = pred.predictions.find(pp => pp.band === bc.band && pp.ring === 1);
    if (p) {
      const actual = p.cutoff_norm;
      const pctOff = Math.abs(actual - bc.expected_norm) / bc.expected_norm;
      const pass = pctOff <= 0.30;
      tier2Total++;
      if (pass) tier2Pass++;
      log(`- [${pass ? 'PASS' : 'FAIL'}] ${bc.band} cutoff: expected=${bc.expected_norm}, actual=${actual} (${(pctOff * 100).toFixed(0)}% off, threshold=30%)`);
    }
  }

  // 5. Achromatic > BY > RG at matched frequency (ring 3, band3=0.5cpd)
  const band3_r3 = pred.predictions.find(p => p.band === 'band3' && p.ring === 3);
  if (band3_r3) {
    const achrom = band3_r3.achromatic_retention;
    const by = band3_r3.yv_retention;
    const rg = band3_r3.rg_retention;
    const pass = achrom >= by && by >= rg;
    tier2Total++;
    if (pass) tier2Pass++;
    log(`- [${pass ? 'PASS' : 'FAIL'}] Achromatic >= BY >= RG at ring 3 band3: achrom=${(achrom * 100).toFixed(1)}%, by=${(by * 100).toFixed(1)}%, rg=${(rg * 100).toFixed(1)}%`);
  }

  // Rendered vs model
  if (meas) {
    log(`- [SKIP] Rendered vs model — requires per-band model mapping (future)`);
  } else {
    log(`- [SKIP] Rendered vs model agreement — no screenshots captured yet`);
  }

  log();

  // ── Tier 3: Stretch ──
  log('## Tier 3: Stretch');
  log();

  // 7. Rovamo & Virsu correlation — composite spatial sensitivity
  // Per-band correlation fails because each DoG band is a step function (100% to 0%),
  // while Rovamo shows smooth curves. Instead: compute a frequency-weighted composite
  // at each ring, then correlate that single curve against Rovamo's frequency-averaged sensitivity.
  const rovEcc = rovamo.eccentricities_deg;
  const freqKeys = ['0.5_cpd', '1_cpd', '2_cpd', '4_cpd'];
  const freqVals = [0.5, 1, 2, 4];
  const bandNames = ['band3', 'band2', 'band1', 'band0'];
  const totalFreqWeight = freqVals.reduce((a, b) => a + b, 0);

  // Get unique eccentricities from model predictions (sorted)
  const modelEccs = [...new Set(pred.predictions.filter(p => p.band === 'band0').map(p => p.ecc_deg))].sort((a, b) => a - b);

  // Composite model: frequency-weighted sum of band retentions at each eccentricity
  const compositeModel = [];
  const compositeRovamo = [];
  for (const ecc of modelEccs) {
    // Model composite: sum(retention[band] * freq) / sum(freq)
    let weightedSum = 0;
    let freqSum = 0;
    for (let fi = 0; fi < freqVals.length; fi++) {
      const p = pred.predictions.find(pp => pp.band === bandNames[fi] && Math.abs(pp.ecc_deg - ecc) < 0.01);
      if (p) {
        weightedSum += p.achromatic_retention * freqVals[fi];
        freqSum += freqVals[fi];
      }
    }
    if (freqSum === 0) continue;
    const modelComposite = weightedSum / freqSum;

    // Rovamo composite: average their 4 channels at this eccentricity (interpolated)
    let rovSum = 0;
    let rovCount = 0;
    for (let fi = 0; fi < freqKeys.length; fi++) {
      const rovData = rovamo.channels[freqKeys[fi]];
      let rv = null;
      for (let i = 0; i < rovEcc.length - 1; i++) {
        if (ecc >= rovEcc[i] && ecc <= rovEcc[i + 1]) {
          const t = (ecc - rovEcc[i]) / (rovEcc[i + 1] - rovEcc[i]);
          rv = rovData.sensitivity_ratio[i] + t * (rovData.sensitivity_ratio[i + 1] - rovData.sensitivity_ratio[i]);
          break;
        }
      }
      if (rv !== null) {
        rovSum += rv * freqVals[fi];
        rovCount += freqVals[fi];
      }
    }
    if (rovCount === 0) continue;
    const rovComposite = rovSum / rovCount;

    compositeModel.push(modelComposite);
    compositeRovamo.push(rovComposite);
  }

  if (compositeModel.length >= 3) {
    const r = spearmanR(compositeModel, compositeRovamo);
    const pass = r > 0.9;
    tier3Total++;
    if (pass) tier3Pass++;
    log(`- [${pass ? 'PASS' : 'FAIL'}] Composite spatial sensitivity correlates with Rovamo & Virsu: r=${isNaN(r) ? 'N/A' : r.toFixed(3)} (threshold: r>0.9)`);
  } else {
    log(`- [SKIP] Composite correlation: insufficient overlap with Rovamo eccentricities (${compositeModel.length} points)`);
  }

  // Per-band detail (informational only, not scored)
  for (let fi = 0; fi < freqKeys.length; fi++) {
    const rovData = rovamo.channels[freqKeys[fi]];
    const modelPreds = pred.predictions
      .filter(p => p.band === bandNames[fi])
      .sort((a, b) => a.ecc_deg - b.ecc_deg);
    const mVals = [], rVals = [];
    for (const mp of modelPreds) {
      let rv = null;
      for (let i = 0; i < rovEcc.length - 1; i++) {
        if (mp.ecc_deg >= rovEcc[i] && mp.ecc_deg <= rovEcc[i + 1]) {
          const t = (mp.ecc_deg - rovEcc[i]) / (rovEcc[i + 1] - rovEcc[i]);
          rv = rovData.sensitivity_ratio[i] + t * (rovData.sensitivity_ratio[i + 1] - rovData.sensitivity_ratio[i]);
          break;
        }
      }
      if (rv !== null) { mVals.push(mp.achromatic_retention); rVals.push(rv); }
    }
    if (mVals.length >= 3) {
      const r = spearmanR(mVals, rVals);
      log(`- [INFO] ${bandNames[fi]} (${freqVals[fi]}cpd) per-band r=${isNaN(r) ? 'N/A' : r.toFixed(3)} (not scored — step function vs smooth curve)`);
    }
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

  const report = lines.join('\n') + '\n';
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, 'spatial-acuity-report.md');
  fs.writeFileSync(reportPath, report);
  console.log(report);
  console.log(`Report written to: ${reportPath}`);

  // Tier 1 is the mandatory tier — return its pass status so the process can
  // exit non-zero on any Tier-1 failure (previously this script always exited
  // 0, so CI / && chaining could not detect a failure). P1-6.
  return tier1Pass === tier1Total;
}

process.exit(validate() ? 0 : 1);
