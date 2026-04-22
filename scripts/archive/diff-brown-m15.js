#!/usr/bin/env node
/**
 * Per-pixel diff map between Brown metamer and Scrutinizer mode15 output.
 * Produces a heatmap PNG highlighting where the two disagree, with band rings.
 *
 * Usage:
 *   node scripts/diff-brown-m15.js --fixture=article
 *   node scripts/diff-brown-m15.js --fixture=crowding --out=/tmp/diff.png
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'tests', 'golden-captures', 'brown-metamers', 'manifest.json');
const BROWN_DIR = path.join(ROOT, 'tests', 'golden-captures', 'brown-metamers');

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const fixture = args.fixture || 'article';
const outPath = args.out || path.join(BROWN_DIR, `${fixture}_center_diff.png`);

const FOVEA_ASPECT_RATIO = 1.33;
const BANDS_1X = [
  { id: 0, rMax: 90   },
  { id: 1, rMax: 180  },
  { id: 2, rMax: 360  },
  { id: 3, rMax: 720  },
];

function loadPng(p) {
  return PNG.sync.read(fs.readFileSync(p));
}

function cropPng(png, x, y, w, h) {
  if (x === 0 && y === 0 && w === png.width && h === png.height) return png;
  const out = new PNG({ width: w, height: h });
  for (let row = 0; row < h; row++) {
    const srcOff = ((y + row) * png.width + x) * 4;
    const dstOff = row * w * 4;
    png.data.copy(out.data, dstOff, srcOff, srcOff + w * 4);
  }
  return out;
}

function resizePng(png, targetW, targetH) {
  if (png.width === targetW && png.height === targetH) return png;
  const out = new PNG({ width: targetW, height: targetH });
  const sx = png.width / targetW;
  const sy = png.height / targetH;
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const srcX = Math.min(Math.floor(x * sx), png.width - 1);
      const srcY = Math.min(Math.floor(y * sy), png.height - 1);
      const si = (srcY * png.width + srcX) * 4;
      const di = (y * targetW + x) * 4;
      out.data[di]   = png.data[si];
      out.data[di+1] = png.data[si+1];
      out.data[di+2] = png.data[si+2];
      out.data[di+3] = 255;
    }
  }
  return out;
}

function alignImages(aPng, bPng) {
  if (aPng.width === bPng.width && aPng.height === bPng.height) return [aPng, bPng];
  let hiRes, loRes, hiIsA;
  if (Math.abs(aPng.width - bPng.width * 2) < 10) {
    hiRes = aPng; loRes = bPng; hiIsA = true;
  } else if (Math.abs(bPng.width - aPng.width * 2) < 10) {
    hiRes = bPng; loRes = aPng; hiIsA = false;
  } else {
    const tw = Math.min(aPng.width, bPng.width);
    const th = Math.min(aPng.height, bPng.height);
    return [resizePng(aPng, tw, th), resizePng(bPng, tw, th)];
  }
  const frameH1x = Math.round(hiRes.height / 2);
  const croppedLo = cropPng(loRes, 0, 0, loRes.width, frameH1x);
  const downHi = resizePng(hiRes, loRes.width, frameH1x);
  return hiIsA ? [downHi, croppedLo] : [croppedLo, downHi];
}

// Hot colormap: 0=black, 0.5=red, 1=yellow/white
function heat(v) {
  v = Math.max(0, Math.min(1, v));
  const r = Math.min(1, v * 2) * 255;
  const g = Math.max(0, v * 2 - 1) * 255;
  const b = v > 0.85 ? (v - 0.85) * 6.67 * 255 : 0;
  return [r | 0, g | 0, b | 0];
}

function luma(p, i) {
  return 0.2126 * p[i] + 0.7152 * p[i+1] + 0.0722 * p[i+2];
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const entry = manifest.comparisons.find(c => c.page === fixture);
  if (!entry || !entry.scrutinizer_mode15) {
    console.error(`No mode15 capture for fixture "${fixture}"`);
    process.exit(1);
  }
  const brownPath = path.join(BROWN_DIR, entry.brown + '.warped.png');
  const m15Path = path.join(ROOT, 'tests', 'golden-captures', entry.scrutinizer_mode15.replace(/^\.\.\//, ''));
  console.log(`Brown:  ${path.relative(ROOT, brownPath)}`);
  console.log(`M15:    ${path.relative(ROOT, m15Path)}`);

  let [a, b] = alignImages(loadPng(brownPath), loadPng(m15Path));
  const w = a.width, h = a.height;
  console.log(`Aligned: ${w}×${h}`);

  const gx = Math.round(w * (entry.gaze?.[0] ?? 0.5));
  const gy = Math.round(h * (entry.gaze?.[1] ?? 0.5));

  // Scale bands by foveal radius — 1x bands assume 45px/deg.
  // Align-path downsampled retina captures to the low-res frame, so bands stay in 1x pixels.
  const bands = BANDS_1X;

  const out = new PNG({ width: w, height: h });
  let sum = 0, sumSq = 0, maxDiff = 0, n = 0;
  const bandSums = bands.concat([{ id: 4, rMax: Infinity }]).map(() => ({ sum: 0, n: 0 }));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const dx = (x - gx) / FOVEA_ASPECT_RATIO;
      const dy = (y - gy);
      const r = Math.sqrt(dx*dx + dy*dy);

      const dL = Math.abs(luma(a.data, i) - luma(b.data, i));
      sum += dL; sumSq += dL*dL; n++;
      if (dL > maxDiff) maxDiff = dL;

      // Attribute to band
      let bIdx = 4;
      for (let k = 0; k < bands.length; k++) {
        if (r < bands[k].rMax) { bIdx = k; break; }
      }
      bandSums[bIdx].sum += dL;
      bandSums[bIdx].n++;

      // Heatmap: scale diff to [0,1] by /80 (0=identical, 80+ = saturated hot)
      const [rr, gg, bb] = heat(dL / 80);
      out.data[i]   = rr;
      out.data[i+1] = gg;
      out.data[i+2] = bb;
      out.data[i+3] = 255;
    }
  }

  // Draw band rings (white, 1px)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - gx) / FOVEA_ASPECT_RATIO;
      const dy = (y - gy);
      const r = Math.sqrt(dx*dx + dy*dy);
      for (const b of bands) {
        if (Math.abs(r - b.rMax) < 0.8) {
          const i = (y * w + x) * 4;
          out.data[i] = 255; out.data[i+1] = 255; out.data[i+2] = 255;
          break;
        }
      }
    }
  }

  fs.writeFileSync(outPath, PNG.sync.write(out));
  const mean = sum / n;
  const stddev = Math.sqrt(sumSq / n - mean*mean);
  console.log(`\nLuma |Δ| per band (0–255 scale):`);
  const labels = ['fovea(0-2°)', 'parafovea(2-4°)', 'near(4-8°)', 'mid(8-16°)', 'far(16+°)'];
  bandSums.forEach((b, i) => {
    const m = b.n > 0 ? (b.sum / b.n).toFixed(2) : 'n/a';
    console.log(`  Band ${i} ${labels[i].padEnd(18)}: mean=${m}  (n=${b.n})`);
  });
  console.log(`\nOverall: mean=${mean.toFixed(2)}  σ=${stddev.toFixed(2)}  max=${maxDiff.toFixed(0)}`);
  console.log(`Wrote: ${path.relative(ROOT, outPath)}`);
}

main();
