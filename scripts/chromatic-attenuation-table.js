#!/usr/bin/env node
/**
 * Compute chromatic attenuation values at specific eccentricities.
 *
 * Reproduces the shader math from peripheral2.frag so we can verify
 * what the GPU is actually computing vs. published psychophysical data.
 *
 * Usage:
 *   node scripts/chromatic-attenuation-table.js
 *   node scripts/chromatic-attenuation-table.js --fovea-radius=180 --viewport=1536x914
 */

const args = process.argv.slice(2);
function getArg(name, def) {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
}

// ── Viewport geometry ──
const foveaRadius = parseInt(getArg('fovea-radius', '90'));
const [vpW, vpH] = getArg('viewport', '1536x914').split('x').map(Number);
const fovea_deg = 2.0;  // Hardcoded in shader

// ── castleCSF parameters (from modes.json) ──
const rg_decay = 0.059;
const rg_freq_decay = 0.003;
const yv_decay = 0.004;
const yv_freq_decay = 0.008;
const supra_exponent = 0.5;

// Band spatial frequencies (cpd)
const bands = [
  { name: 'band0', freq: 4.0, label: '~4 cpd (serifs, fine text)' },
  { name: 'band1', freq: 2.0, label: '~2 cpd (letter bodies, small icons)' },
  { name: 'band2', freq: 1.0, label: '~1 cpd (words, UI elements)' },
  { name: 'band3', freq: 0.5, label: '~0.5 cpd (buttons, cards)' },
  { name: 'residual', freq: 0.25, label: '~0.25 cpd (backgrounds, large fields)' },
];

function atten(k_e, k_ef, freq, ecc_deg, supra) {
  const threshold = Math.pow(10, -(k_e + k_ef * freq) * ecc_deg);
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

console.log('=== Chromatic Attenuation Predictions ===\n');
console.log(`Viewport: ${vpW} × ${vpH}`);
console.log(`Fovea radius: ${foveaRadius} px`);
console.log(`fovea_deg: ${fovea_deg}° (hardcoded in shader)`);
console.log(`supra_exponent: ${supra_exponent}`);
console.log(`RG: k_e=${rg_decay}, k_ef=${rg_freq_decay}`);
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
    const rg = atten(rg_decay, rg_freq_decay, band.freq, ecc_deg, supra_exponent);
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
  const rg_fine = atten(rg_decay, rg_freq_decay, 4.0, ecc_deg, supra_exponent);
  const rg_coarse = atten(rg_decay, rg_freq_decay, 0.25, ecc_deg, supra_exponent);
  const yv_fine = atten(yv_decay, yv_freq_decay, 4.0, ecc_deg, supra_exponent);
  const yv_coarse = atten(yv_decay, yv_freq_decay, 0.25, ecc_deg, supra_exponent);

  console.log(`${pt.label.padEnd(22)} ${ecc_deg.toFixed(1).padStart(5)}° ${(rg_fine.appearance * 100).toFixed(0).padStart(6)}%    ${(rg_coarse.appearance * 100).toFixed(0).padStart(6)}%    ${(yv_fine.appearance * 100).toFixed(0).padStart(6)}%    ${(yv_coarse.appearance * 100).toFixed(0).padStart(6)}%`);
}

// ── Cross-check vs Bowers at 15° ──
console.log('\n\n=== Cross-check: Model vs Bowers et al. 2025 at 15° ===\n');
const ecc15 = 15.0;
// Bowers measured broadband (mixed frequency). Use band2 (1cpd) as representative.
const rg_15 = atten(rg_decay, rg_freq_decay, 1.0, ecc15, supra_exponent);
const yv_15 = atten(yv_decay, yv_freq_decay, 1.0, ecc15, supra_exponent);
const rg_15_thresh = atten(rg_decay, rg_freq_decay, 1.0, ecc15, 1.0);
const yv_15_thresh = atten(yv_decay, yv_freq_decay, 1.0, ecc15, 1.0);

console.log(`  Channel      Bowers    Threshold   Appearance (supra=${supra_exponent})`);
console.log(`  RG at 15°    29%       ${(rg_15_thresh.threshold * 100).toFixed(1)}%        ${(rg_15.appearance * 100).toFixed(1)}%`);
console.log(`  YV at 15°    79%       ${(yv_15_thresh.threshold * 100).toFixed(1)}%        ${(yv_15.appearance * 100).toFixed(1)}%`);
console.log();
console.log('  Note: Bowers measures SENSITIVITY (detection threshold), not appearance.');
console.log('  Their values should align with our threshold column, not appearance.');
console.log('  The appearance column is our suprathreshold correction for saturated web colors.');
