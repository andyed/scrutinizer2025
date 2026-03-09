#!/usr/bin/env node
/**
 * Band-weight analysis for 8 half-octave DoG bands.
 *
 * Pure math — no captures, no GPU. Computes per-band weights at fine
 * eccentricity steps for both linear M-scaling and CMF paths.
 *
 * Key question: at which eccentricities do 3-4 bands carry non-trivial
 * weights simultaneously? That's where DoG diverges from Gaussian blur.
 *
 * Usage:
 *   node scripts/analyze-dog-bands.js
 *   node scripts/analyze-dog-bands.js --e2=0.15,0.5,1.0,2.0
 *   node scripts/analyze-dog-bands.js --sharpness=0.0    # biological
 *   node scripts/analyze-dog-bands.js --sharpness=1.0    # sharp
 *   node scripts/analyze-dog-bands.js --cmf              # CMF path
 *   node scripts/analyze-dog-bands.js --json              # machine-readable
 */

const args = process.argv.slice(2);
function getArg(name, def) {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
}
const hasFlag = (name) => args.includes(`--${name}`);

const e2Values = getArg('e2', '0.15,0.5,1.0,2.0').split(',').map(Number);
const sharpness = parseFloat(getArg('sharpness', '0.0'));
const useCMF = hasFlag('cmf');
const jsonOutput = hasFlag('json');

// CMF defaults (Blauch, Konkle & Alvarez 2026)
const CMF_A = parseFloat(getArg('cmf-a', '2.78'));
const ECC_SCALING = parseFloat(getArg('ecc-scaling', '0.75'));
const FOVEA_DEG = 2.0;
const MAX_MIP = 4.0;
// cortical_max = ln(r_max + a) - ln(a), r_max ~ 40° typical
const R_MAX = 40.0;
const CORTICAL_MAX = Math.log(1 + R_MAX / CMF_A);

// Band center frequencies (cpd) — half-octave geometric series
const BAND_FREQ = [5.657, 4.0, 2.828, 2.0, 1.414, 1.0, 0.707, 0.5];
const RESIDUAL_FREQ = 0.354;

// Old 4-band cutoff multipliers for comparison
const OLD_CUTOFFS_LINEAR = [1.0, 3.0, 7.0, 15.0];

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function computeCutoffs(e2, cmf) {
  const c = new Array(8);
  if (cmf) {
    const scale = CORTICAL_MAX / MAX_MIP / (ECC_SCALING / 0.75);
    for (let k = 0; k < 8; k++) {
      c[k] = CMF_A * (Math.exp((k + 1) * 0.5 * scale) - 1.0) / FOVEA_DEG;
    }
  } else {
    // Linear: cutoff_k = E2 * (2^((k+1)/2) - 1)
    const mults = [0.41421, 1.0, 1.82843, 3.0, 4.65685, 7.0, 10.31371, 15.0];
    for (let k = 0; k < 8; k++) {
      c[k] = e2 * mults[k];
    }
  }
  return c;
}

function computeOldCutoffs(e2) {
  return OLD_CUTOFFS_LINEAR.map(m => e2 * m);
}

function computeWeights(normEcc, cutoffs, sharpness) {
  const transMult = 0.4 + (0.05 - 0.4) * sharpness; // mix(0.4, 0.05, sharpness)
  return cutoffs.map(c => {
    return 1.0 - smoothstep(c - c * transMult, c + c * transMult, normEcc);
  });
}

// Count bands with weight > threshold
function activeBands(weights, threshold = 0.05) {
  return weights.filter(w => w > threshold && w < (1.0 - threshold)).length;
}

// Equivalent Gaussian MIP level — weighted average of band LODs
// If DoG produces a different effective blur than this, it's frequency-selective
function equivalentMipLevel(weights) {
  // Each band k spans LOD k*0.5 to (k+1)*0.5
  // Band center LOD = (k+0.5)*0.5
  let totalWeight = 0;
  let weightedLod = 0;
  for (let k = 0; k < 8; k++) {
    const bandLod = (k + 0.5) * 0.5; // center of half-octave band
    weightedLod += weights[k] * bandLod;
    totalWeight += weights[k];
  }
  // residual is always 1.0
  const residualLod = 4.0;
  // Effective LOD if we replaced bands with single Gaussian
  if (totalWeight < 0.001) return residualLod;
  return weightedLod / totalWeight;
}

const results = {};

for (const e2 of e2Values) {
  const cutoffs = computeCutoffs(e2, useCMF);
  const oldCutoffs = computeOldCutoffs(e2);

  console.log(`\n${'='.repeat(90)}`);
  console.log(`E2 = ${e2}  |  Path: ${useCMF ? 'CMF' : 'Linear'}  |  Sharpness: ${sharpness}`);
  console.log(`${'='.repeat(90)}`);

  // Show cutoffs
  console.log(`\nCutoff eccentricities (normalized to fovea radius):`);
  console.log(`  8-band: ${cutoffs.map(c => c.toFixed(3)).join(', ')}`);
  console.log(`  4-band: ${oldCutoffs.map(c => c.toFixed(3)).join(', ')}`);
  console.log(`  New bands interleave at: ${[cutoffs[0], cutoffs[2], cutoffs[4], cutoffs[6]].map(c => c.toFixed(3)).join(', ')}`);

  // Map cutoffs to degrees (normEcc * fovea_deg)
  console.log(`\nCutoff eccentricities (degrees, fovea_radius=${FOVEA_DEG}°):`);
  console.log(`  8-band: ${cutoffs.map(c => (c * FOVEA_DEG).toFixed(2) + '°').join(', ')}`);

  // Eccentricity sweep
  const eccSteps = [];
  for (let normEcc = 0; normEcc <= 20; normEcc += 0.25) {
    eccSteps.push(normEcc);
  }

  console.log(`\n  normEcc  ecc(°)  │ b0    b1    b2    b3    b4    b5    b6    b7    │ active  eqMIP`);
  console.log(`  ${'─'.repeat(86)}`);

  const sweepData = [];

  for (const normEcc of eccSteps) {
    const weights = computeWeights(normEcc, cutoffs, sharpness);
    const nActive = activeBands(weights);
    const eqMip = equivalentMipLevel(weights);
    const eccDeg = normEcc * FOVEA_DEG;

    sweepData.push({ normEcc, eccDeg, weights, nActive, eqMip });

    // Only print rows where something interesting happens
    const allOne = weights.every(w => w > 0.95);
    const allZero = weights.every(w => w < 0.05);
    if (allOne && normEcc > 0.5) continue; // skip boring "all 1.0" rows
    if (allZero && normEcc > cutoffs[7] * 1.5) continue; // skip boring "all 0.0" rows

    const wStr = weights.map(w => w.toFixed(3).padStart(5)).join(' ');
    const marker = nActive >= 3 ? ' ◀' : '';
    console.log(`  ${normEcc.toFixed(2).padStart(7)}  ${eccDeg.toFixed(1).padStart(5)}°  │ ${wStr}  │   ${nActive}     ${eqMip.toFixed(2)}${marker}`);
  }

  // Summary: where are the interesting zones?
  const zones = sweepData.filter(d => d.nActive >= 3);
  if (zones.length > 0) {
    const minEcc = zones[0].eccDeg;
    const maxEcc = zones[zones.length - 1].eccDeg;
    console.log(`\n  ◀ 3+ active bands zone: ${minEcc.toFixed(1)}° – ${maxEcc.toFixed(1)}° (${zones.length * 0.25 * FOVEA_DEG}° span)`);
  } else {
    console.log(`\n  ⚠ No zone with 3+ active bands found (try larger E2 or lower sharpness)`);
  }

  // Compare to measurement rings
  const RING_CSS_PX = [100, 200, 300, 420, 560];
  const FOVEA_RADIUS_PX = 90;
  console.log(`\n  Analysis ring coverage:`);
  for (const ringPx of RING_CSS_PX) {
    const normEcc = ringPx / FOVEA_RADIUS_PX;
    const eccDeg = normEcc * FOVEA_DEG;
    const weights = computeWeights(normEcc, cutoffs, sharpness);
    const nActive = activeBands(weights);
    const nNonZero = weights.filter(w => w > 0.01).length;
    const status = nActive >= 3 ? '✓ in zone' : nNonZero === 0 ? '✗ all pooled' : `~ ${nNonZero} partial`;
    console.log(`    ring @ ${ringPx}px = ${eccDeg.toFixed(1)}° (normEcc=${normEcc.toFixed(2)}): ${status}  w=[${weights.map(w => w.toFixed(2)).join(',')}]`);
  }

  // Inner ring suggestion
  console.log(`\n  Suggested inner measurement rings (for 3+ active bands):`);
  const goodRings = sweepData
    .filter(d => d.nActive >= 3)
    .filter((_, i) => i % 2 === 0) // every other for readability
    .slice(0, 5);
  for (const d of goodRings) {
    const ringPx = Math.round(d.normEcc * FOVEA_RADIUS_PX);
    console.log(`    ${ringPx}px (${d.eccDeg.toFixed(1)}°, normEcc=${d.normEcc.toFixed(2)}): ${d.nActive} active bands`);
  }

  results[e2] = sweepData;
}

// === OLD vs NEW comparison ===
console.log(`\n${'='.repeat(90)}`);
console.log(`OLD (4-band) vs NEW (8-band) — active band comparison`);
console.log(`${'='.repeat(90)}`);

for (const e2 of e2Values) {
  const newCutoffs = computeCutoffs(e2, useCMF);
  const oldCutoffs = computeOldCutoffs(e2);

  console.log(`\n  E2=${e2}:`);
  console.log(`  normEcc  │ old_active  new_active  │ Δ`);
  console.log(`  ${'─'.repeat(45)}`);

  for (let normEcc = 0; normEcc <= 20; normEcc += 0.5) {
    const oldW = computeWeights(normEcc, oldCutoffs, sharpness);
    const newW = computeWeights(normEcc, newCutoffs, sharpness);
    const oldActive = activeBands(oldW);
    const newActive = activeBands(newW);
    if (oldActive === 0 && newActive === 0 && normEcc > oldCutoffs[3] * 1.5) continue;
    if (oldActive === oldW.length && newActive === newW.length) continue;
    const delta = newActive - oldActive;
    const marker = delta > 0 ? ` +${delta} ◀` : '';
    console.log(`  ${normEcc.toFixed(1).padStart(7)}  │     ${oldActive}           ${newActive}       │${marker}`);
  }
}

if (jsonOutput) {
  console.log('\n--- JSON ---');
  console.log(JSON.stringify(results, null, 2));
}
