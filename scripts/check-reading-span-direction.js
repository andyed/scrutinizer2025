#!/usr/bin/env node
/**
 * Reading span direction check
 *
 * Reads the captures written by scripts/capture-reading-span.js and asserts that
 * reading span moves the foveal protection zone AHEAD of the reading direction:
 * right of the pointer for a left-to-right sweep, left of it for right-to-left.
 *
 * Method: for each sweep, compare the reading-span-ON capture with its OFF
 * control at the same pointer position. Local high-frequency energy (|Laplacian|
 * of luminance) is averaged over the text row and smoothed along x. Where ON
 * minus OFF is positive, reading span preserved detail. The check takes the
 * centroid of that gain relative to the pointer.
 *
 * Exits non-zero when:
 *   - a capture or the manifest is missing,
 *   - ON and OFF barely differ (reading span did not activate: pointer off text,
 *     or velocity outside the shader's pursuit gate), or
 *   - the gain sits behind the reading direction.
 *
 * v2.4.0 to v2.8.0 shipped a sign error that moved the zone backward. Captures
 * from that shader fail this check; that failure is the fixture.
 *
 * Usage:
 *   node scripts/check-reading-span-direction.js
 *   node scripts/check-reading-span-direction.js --dir=<capture dir>
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const dirArg = process.argv.find(a => a.startsWith('--dir='));
const DIR = dirArg ? dirArg.split('=')[1] : path.join(ROOT, 'tests', 'golden-captures', 'reading-span');

// The zone shift is 0.7 x radius x activation; at the capture's ~0.2 px/ms the
// gain centroid lands 70-150 px from the pointer, so 20 px separates direction
// from noise.
const MIN_OFFSET_PX = 20;
// Mean |ON - OFF| relative to OFF energy near the pointer. Below this the two
// captures are effectively identical and the test says nothing. Measured
// 2026-10-02: inactive captures (pointer off text) score ~0.001, active sweeps
// 0.013-0.05.
const MIN_ACTIVATION = 0.005;
const WINDOW_PX = 400;
const BAND_HALF_PX = 30;
const SMOOTH_PX = 15;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function loadLuma(file) {
  const p = path.join(DIR, file);
  if (!fs.existsSync(p)) fail(`missing capture ${p} (run scripts/capture-reading-span.js)`);
  const png = PNG.sync.read(fs.readFileSync(p));
  const { width, height, data } = png;
  const luma = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    luma[i] = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
  }
  return { width, height, luma };
}

function highFreq({ width, height, luma }) {
  const hf = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      hf[i] = Math.abs(4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - width] - luma[i + width]);
    }
  }
  return hf;
}

function smooth(arr, k) {
  const out = new Float32Array(arr.length);
  const h = Math.floor(k / 2);
  for (let i = 0; i < arr.length; i++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - h); j <= Math.min(arr.length - 1, i + h); j++) { s += arr[j]; n++; }
    out[i] = s / n;
  }
  return out;
}

function columnProfile(hf, width, y0, y1) {
  const prof = new Float32Array(width);
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < width; x++) prof[x] += hf[y * width + x];
  }
  for (let x = 0; x < width; x++) prof[x] /= (y1 - y0);
  return smooth(prof, SMOOTH_PX);
}

// Row band with the largest ON/OFF difference near the expected text row.
function findBand(on, off, width, height, expectedY) {
  let best = expectedY, bestScore = -1;
  for (let yc = Math.max(BAND_HALF_PX, expectedY - 120); yc <= Math.min(height - BAND_HALF_PX - 1, expectedY + 120); yc += 4) {
    let s = 0;
    for (let y = yc - BAND_HALF_PX; y < yc + BAND_HALF_PX; y++) {
      for (let x = 0; x < width; x += 2) s += Math.abs(on[y * width + x] - off[y * width + x]);
    }
    if (s > bestScore) { bestScore = s; best = yc; }
  }
  return best;
}

function measure(name, onFile, offFile, startX, endX, textY, captureAt) {
  const on = loadLuma(onFile);
  const off = loadLuma(offFile);
  if (on.width !== off.width || on.height !== off.height) fail(`${name}: ON and OFF captures differ in size`);
  const { width, height } = on;
  const hOn = highFreq(on), hOff = highFreq(off);

  const cx = Math.round((startX + (endX - startX) * captureAt) * width);
  const yc = findBand(hOn, hOff, width, height, Math.round(textY * height));
  const pOn = columnProfile(hOn, width, yc - BAND_HALF_PX, yc + BAND_HALF_PX);
  const pOff = columnProfile(hOff, width, yc - BAND_HALF_PX, yc + BAND_HALF_PX);

  const lo = Math.max(0, cx - WINDOW_PX), hi = Math.min(width, cx + WINDOW_PX);
  let gainMass = 0, gainMoment = 0, absDiff = 0, offEnergy = 0;
  for (let x = lo; x < hi; x++) {
    const d = pOn[x] - pOff[x];
    absDiff += Math.abs(d);
    offEnergy += pOff[x];
    if (d > 0) { gainMass += d; gainMoment += d * (x - cx); }
  }
  const activation = offEnergy > 0 ? absDiff / offEnergy : 0;
  const gainCentroid = gainMass > 0 ? gainMoment / gainMass : 0;
  console.log(`${name.padEnd(4)} pointer x=${cx} row y=${yc}  activation=${activation.toFixed(3)}  ` +
    `gain centroid ${gainCentroid >= 0 ? '+' : ''}${gainCentroid.toFixed(0)} px (+ = right of pointer)`);
  return { activation, gainCentroid };
}

const manifestPath = path.join(DIR, 'reading-span-manifest.json');
if (!fs.existsSync(manifestPath)) fail(`missing ${manifestPath} (run scripts/capture-reading-span.js)`);
const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const ltr = measure('LTR', m.files.sweep_ltr, m.files.sweep_ltr_disabled, m.x0, m.x1, m.text_y, m.capture_at);
const rtl = measure('RTL', m.files.sweep_rtl, m.files.sweep_rtl_disabled, m.x1, m.x0, m.text_y, m.capture_at);

const problems = [];
for (const [name, r] of [['LTR', ltr], ['RTL', rtl]]) {
  if (r.activation < MIN_ACTIVATION) {
    problems.push(`${name}: reading span did not activate (activation ${r.activation.toFixed(3)} < ${MIN_ACTIVATION}); ` +
      'check that the capture point is on body text and the sweep speed is inside the pursuit gate');
  }
}
if (ltr.activation >= MIN_ACTIVATION && ltr.gainCentroid < MIN_OFFSET_PX) {
  problems.push(`LTR: detail gained ${ltr.gainCentroid.toFixed(0)} px from the pointer; expected > +${MIN_OFFSET_PX} (ahead, to the right)`);
}
if (rtl.activation >= MIN_ACTIVATION && rtl.gainCentroid > -MIN_OFFSET_PX) {
  problems.push(`RTL: detail gained ${rtl.gainCentroid.toFixed(0)} px from the pointer; expected < -${MIN_OFFSET_PX} (ahead, to the left)`);
}

if (problems.length) fail('\n  ' + problems.join('\n  '));
console.log('PASS: reading span moves the protection zone ahead of the reading direction in both sweeps');
