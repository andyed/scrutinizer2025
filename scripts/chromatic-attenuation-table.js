#!/usr/bin/env node
/**
 * Compute chromatic attenuation values at specific eccentricities.
 *
 * Reproduces the shader math from peripheral.frag so we can verify
 * what the GPU is actually computing vs. published psychophysical data.
 *
 * Usage:
 *   node scripts/chromatic-attenuation-table.js
 *   node scripts/chromatic-attenuation-table.js --fovea-radius=180 --viewport=1536x914
 *   node scripts/chromatic-attenuation-table.js --json              # structured output for validation
 *   node scripts/chromatic-attenuation-table.js --json --color-search  # predictions for color-search rings
 */

const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
function getArg(name, def) {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
}
const hasFlag = (name) => args.includes(`--${name}`);

// ── Viewport geometry ──
const foveaRadius = parseInt(getArg('fovea-radius', '45'));
const [vpW, vpH] = getArg('viewport', '1536x914').split('x').map(Number);
const fovea_deg = 1.0;  // 1° foveal radius (2° diameter) — matches shader

// ── Load castleCSF parameters from modes.json ──
const modesPath = path.join(__dirname, '..', 'shared', 'modes.json');
const modes = JSON.parse(fs.readFileSync(modesPath, 'utf8'));
// Find first mode with chromatic_pooling: true (checked in pipeline key)
const allModes = modes.modes ? Object.values(modes.modes) : Object.values(modes);
const castleMode = allModes.find(m =>
  m.pipeline?.chromatic_pooling === true
) || {};
const castlePeripheral = castleMode.pipeline || {};

const rg_decay = castlePeripheral.rg_decay ?? 0.072;
const rg_decay_slow = castlePeripheral.rg_decay_slow ?? 0.025;
const rg_knee_deg = castlePeripheral.rg_knee_deg ?? 20.0;
const rg_freq_decay = castlePeripheral.rg_freq_decay ?? 0.003;
const yv_decay = castlePeripheral.yv_decay ?? 0.014;
const yv_freq_decay = castlePeripheral.yv_freq_decay ?? 0.008;
const supra_exponent = castlePeripheral.supra_exponent ?? 0.5;

// Band spatial frequencies (cpd)
const bands = [
  { name: 'band0', freq: 4.0, label: '~4 cpd (serifs, fine text)' },
  { name: 'band1', freq: 2.0, label: '~2 cpd (letter bodies, small icons)' },
  { name: 'band2', freq: 1.0, label: '~1 cpd (words, UI elements)' },
  { name: 'band3', freq: 0.5, label: '~0.5 cpd (buttons, cards)' },
  { name: 'residual', freq: 0.25, label: '~0.25 cpd (backgrounds, large fields)' },
];

function atten(k_e, k_ef, freq, ecc_deg, supra, k_slow = null, knee = null) {
  // Biphasic base decay: fast rate to knee, slower beyond (Bowers et al. 2025)
  let base;
  if (k_slow !== null && knee !== null && ecc_deg > knee) {
    base = k_e * knee + k_slow * (ecc_deg - knee);
  } else {
    base = k_e * ecc_deg;
  }
  const threshold = Math.pow(10, -(base + k_ef * freq * ecc_deg));
  const appearance = Math.pow(threshold, supra);
  return { threshold, appearance };
}

// ── Compute viewport eccentricities ──
const halfW = vpW / 2;
const halfH = vpH / 2;
const cornerDist = Math.sqrt(halfW * halfW + halfH * halfH);

const samplePoints = [
  { label: 'Fovea edge', dist_px: foveaRadius },
  { label: 'Parafovea (2.5x)', dist_px: foveaRadius * 2.5 },
  { label: 'Horizontal edge', dist_px: halfW },
  { label: 'Vertical edge', dist_px: halfH },
  { label: 'Corner', dist_px: cornerDist },
];

if (!hasFlag('json')) {
console.log('=== Chromatic Attenuation Predictions ===\n');
console.log(`Viewport: ${vpW} × ${vpH}`);
console.log(`Fovea radius: ${foveaRadius} px`);
console.log(`fovea_deg: ${fovea_deg}° (hardcoded in shader)`);
console.log(`supra_exponent: ${supra_exponent}`);
console.log(`RG: k_e=${rg_decay}, k_slow=${rg_decay_slow}, knee=${rg_knee_deg}°, k_ef=${rg_freq_decay}`);
console.log(`YV: k_e=${yv_decay}, k_ef=${yv_freq_decay}`);
console.log();

// ── Published data for comparison ──
console.log('=== Published Reference (Bowers et al. 2025) ===');
console.log('Normalized to 5° baseline:\n');
console.log('  Ecc    Achromatic   Red-Green   Blue-Yellow');
console.log('  5°     100%         100%        100%');
console.log('  15°    76%          29%         79%');
console.log('  75°    12%          4%          18%');
console.log();

// ── Per sample point ──
for (const pt of samplePoints) {
  const normEcc = pt.dist_px / foveaRadius;
  const ecc_deg = normEcc * fovea_deg;

  console.log(`\n--- ${pt.label}: ${Math.round(pt.dist_px)} px, normEcc=${normEcc.toFixed(2)}, ecc_deg=${ecc_deg.toFixed(1)}° ---`);
  console.log();
  console.log(`  ${'Band'.padEnd(12)} ${'Freq'.padEnd(8)} ${'RG thresh'.padEnd(12)} ${'RG appear'.padEnd(12)} ${'YV thresh'.padEnd(12)} ${'YV appear'.padEnd(12)}`);
  console.log(`  ${'─'.repeat(12)} ${'─'.repeat(8)} ${'─'.repeat(12)} ${'─'.repeat(12)} ${'─'.repeat(12)} ${'─'.repeat(12)}`);

  for (const band of bands) {
    const rg = atten(rg_decay, rg_freq_decay, band.freq, ecc_deg, supra_exponent, rg_decay_slow, rg_knee_deg);
    const yv = atten(yv_decay, yv_freq_decay, band.freq, ecc_deg, supra_exponent);

    console.log(`  ${band.name.padEnd(12)} ${(band.freq + ' cpd').padEnd(8)} ${(rg.threshold * 100).toFixed(1).padStart(6)}%  →  ${(rg.appearance * 100).toFixed(1).padStart(5)}%   ${(yv.threshold * 100).toFixed(1).padStart(6)}%  →  ${(yv.appearance * 100).toFixed(1).padStart(5)}%`);
  }
}

// ── Summary: what the viewport edges should look like ──
console.log('\n\n=== Summary: Predicted appearance retention at viewport edges ===\n');
console.log(`${'Location'.padEnd(22)} ${'ecc°'.padEnd(6)} ${'RG fine'.padEnd(10)} ${'RG coarse'.padEnd(10)} ${'YV fine'.padEnd(10)} ${'YV coarse'.padEnd(10)}`);
console.log(`${'─'.repeat(22)} ${'─'.repeat(6)} ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(10)}`);

for (const pt of samplePoints) {
  const normEcc = pt.dist_px / foveaRadius;
  const ecc_deg = normEcc * fovea_deg;
  const rg_fine = atten(rg_decay, rg_freq_decay, 4.0, ecc_deg, supra_exponent, rg_decay_slow, rg_knee_deg);
  const rg_coarse = atten(rg_decay, rg_freq_decay, 0.25, ecc_deg, supra_exponent, rg_decay_slow, rg_knee_deg);
  const yv_fine = atten(yv_decay, yv_freq_decay, 4.0, ecc_deg, supra_exponent);
  const yv_coarse = atten(yv_decay, yv_freq_decay, 0.25, ecc_deg, supra_exponent);

  console.log(`${pt.label.padEnd(22)} ${ecc_deg.toFixed(1).padStart(5)}° ${(rg_fine.appearance * 100).toFixed(0).padStart(6)}%    ${(rg_coarse.appearance * 100).toFixed(0).padStart(6)}%    ${(yv_fine.appearance * 100).toFixed(0).padStart(6)}%    ${(yv_coarse.appearance * 100).toFixed(0).padStart(6)}%`);
}

// ── Cross-check vs Bowers at 15° ──
console.log('\n\n=== Cross-check: Model vs Bowers et al. 2025 at 15° ===\n');
const ecc15 = 15.0;
// Bowers measured broadband (mixed frequency). Use band2 (1cpd) as representative.
const rg_15 = atten(rg_decay, rg_freq_decay, 1.0, ecc15, supra_exponent, rg_decay_slow, rg_knee_deg);
const yv_15 = atten(yv_decay, yv_freq_decay, 1.0, ecc15, supra_exponent);
const rg_15_thresh = atten(rg_decay, rg_freq_decay, 1.0, ecc15, 1.0, rg_decay_slow, rg_knee_deg);
const yv_15_thresh = atten(yv_decay, yv_freq_decay, 1.0, ecc15, 1.0);

console.log(`  Channel      Bowers    Threshold   Appearance (supra=${supra_exponent})`);
console.log(`  RG at 15°    29%       ${(rg_15_thresh.threshold * 100).toFixed(1)}%        ${(rg_15.appearance * 100).toFixed(1)}%`);
console.log(`  YV at 15°    79%       ${(yv_15_thresh.threshold * 100).toFixed(1)}%        ${(yv_15.appearance * 100).toFixed(1)}%`);
console.log();
console.log('  Note: Bowers measures SENSITIVITY (detection threshold), not appearance.');
console.log('  Their values should align with our threshold column, not appearance.');
console.log('  The appearance column is our suprathreshold correction for saturated web colors.');
} // end if (!hasFlag('json'))

// ── JSON output for validation pipeline ──
if (hasFlag('json')) {
  const ppd = foveaRadius / fovea_deg; // pixels per degree

  const colors = [
    { name: 'red',    primary: 'rg', oklab: { a: 0.152, b: 0.067 } },
    { name: 'green',  primary: 'rg', oklab: { a: -0.144, b: 0.108 } },
    { name: 'blue',   primary: 'by', oklab: { a: -0.004, b: -0.173 } },
    { name: 'yellow', primary: 'by', oklab: { a: -0.026, b: 0.143 } },
  ];

  const sizes = [16, 20, 24, 32, 48];

  // Default: predictions for standard band frequencies
  let rings = null;
  let predictions = [];

  if (hasFlag('color-search')) {
    // Color-search ring eccentricities (from color-search.html)
    const ringDistances = [100, 200, 300, 420, 560];
    rings = ringDistances.map((dist, i) => {
      const normEcc = dist / foveaRadius;
      const ecc_deg = normEcc * fovea_deg;
      return { ring: i + 1, dist_px: dist, norm_ecc: normEcc, ecc_deg };
    });

    for (const color of colors) {
      for (const size of sizes) {
        const freq_cpd = ppd / (2 * size);
        for (const ring of rings) {
          const rg = atten(rg_decay, rg_freq_decay, freq_cpd, ring.ecc_deg, supra_exponent, rg_decay_slow, rg_knee_deg);
          const yv = atten(yv_decay, yv_freq_decay, freq_cpd, ring.ecc_deg, supra_exponent);

          // Composite chroma retention: attenuate a and b independently, compute ratio of resulting chroma
          const a_atten = color.oklab.a * rg.appearance;
          const b_atten = color.oklab.b * yv.appearance;
          const chroma_orig = Math.sqrt(color.oklab.a ** 2 + color.oklab.b ** 2);
          const chroma_atten = Math.sqrt(a_atten ** 2 + b_atten ** 2);
          const composite_retention = chroma_orig > 0 ? chroma_atten / chroma_orig : 0;

          predictions.push({
            color: color.name,
            primary_channel: color.primary,
            size_px: size,
            freq_cpd: Math.round(freq_cpd * 1000) / 1000,
            ring: ring.ring,
            dist_px: ring.dist_px,
            ecc_deg: Math.round(ring.ecc_deg * 100) / 100,
            rg_retention: Math.round(rg.appearance * 10000) / 10000,
            yv_retention: Math.round(yv.appearance * 10000) / 10000,
            composite_retention: Math.round(composite_retention * 10000) / 10000,
          });
        }
      }
    }
  } else if (hasFlag('spatial-acuity')) {
    // Spatial acuity: per-band contrast retention at each ring
    const ringDistances = [100, 200, 300, 420, 560];
    rings = ringDistances.map((dist, i) => {
      const normEcc = dist / foveaRadius;
      const ecc_deg = normEcc * fovea_deg;
      return { ring: i + 1, dist_px: dist, norm_ecc: normEcc, ecc_deg };
    });

    const dog_e2 = castlePeripheral.dog_e2 ?? 0.15;

    for (const band of bands) {
      for (const ring of rings) {
        // DoG band weight: smooth transition based on M-scaling
        // Band k drops when norm_ecc > E2 × (2^k - 1)
        // With dog_sharpness=0, use a sigmoid transition
        const bandIndex = bands.indexOf(band);
        const cutoffMultiplier = bandIndex === 4 ? Infinity : Math.pow(2, bandIndex + 1) - 1;
        const cutoffNorm = dog_e2 * cutoffMultiplier;
        const cutoffDeg = cutoffNorm * fovea_deg;
        // Smooth weight: 1.0 at center, transitions to 0 around cutoff
        const bandWeight = cutoffMultiplier === Infinity ? 1.0 :
          1.0 / (1.0 + Math.exp(4.0 * (ring.norm_ecc - cutoffNorm) / dog_e2));

        // Per-channel attenuation (chromatic pooling)
        const rg = atten(rg_decay, rg_freq_decay, band.freq, ring.ecc_deg, supra_exponent, rg_decay_slow, rg_knee_deg);
        const yv = atten(yv_decay, yv_freq_decay, band.freq, ring.ecc_deg, supra_exponent);

        // Achromatic contrast retention is dominated by the DoG band weight
        // (spatial blur removes the band, reducing contrast)
        predictions.push({
          band: band.name,
          freq_cpd: band.freq,
          ring: ring.ring,
          dist_px: ring.dist_px,
          ecc_deg: Math.round(ring.ecc_deg * 100) / 100,
          norm_ecc: Math.round(ring.norm_ecc * 100) / 100,
          cutoff_norm: Math.round(cutoffNorm * 100) / 100,
          cutoff_deg: Math.round(cutoffDeg * 100) / 100,
          band_weight: Math.round(bandWeight * 10000) / 10000,
          achromatic_retention: Math.round(bandWeight * 10000) / 10000,
          rg_retention: Math.round((bandWeight * rg.appearance) * 10000) / 10000,
          yv_retention: Math.round((bandWeight * yv.appearance) * 10000) / 10000,
        });
      }
    }
  } else {
    // Generic: one entry per band per sample point
    for (const pt of samplePoints) {
      const normEcc = pt.dist_px / foveaRadius;
      const ecc_deg = normEcc * fovea_deg;
      for (const band of bands) {
        const rg = atten(rg_decay, rg_freq_decay, band.freq, ecc_deg, supra_exponent, rg_decay_slow, rg_knee_deg);
        const yv = atten(yv_decay, yv_freq_decay, band.freq, ecc_deg, supra_exponent);
        predictions.push({
          location: pt.label,
          dist_px: Math.round(pt.dist_px),
          ecc_deg: Math.round(ecc_deg * 10) / 10,
          band: band.name,
          freq_cpd: band.freq,
          rg_threshold: Math.round(rg.threshold * 10000) / 10000,
          rg_appearance: Math.round(rg.appearance * 10000) / 10000,
          yv_threshold: Math.round(yv.threshold * 10000) / 10000,
          yv_appearance: Math.round(yv.appearance * 10000) / 10000,
        });
      }
    }
  }

  const output = {
    parameters: { rg_decay, rg_decay_slow, rg_knee_deg, rg_freq_decay, yv_decay, yv_freq_decay, supra_exponent },
    geometry: { fovea_radius_px: foveaRadius, fovea_deg, ppd, viewport: `${vpW}x${vpH}` },
    ...(rings && { rings }),
    predictions,
  };

  console.log(JSON.stringify(output, null, 2));
}
