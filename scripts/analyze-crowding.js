#!/usr/bin/env node
/**
 * Analyze crowding screenshots for Wave 3 validation.
 *
 * Reads existing golden captures (crowding_center.png) and measures
 * crowded vs isolated target visibility by finding cyan pixel clusters.
 *
 * Method: crowding.html places cyan targets (#50b4c8) with black flankers
 * on a light background. V1 distortion fragments letters into scattered
 * cyan pixels. We find distinct cyan clusters within each eccentricity
 * band × column, then compare the left cluster (crowded target + flanker
 * contamination) against the right cluster (isolated target). The ratio
 * of cyan density provides the crowding metric.
 *
 * Usage:
 *   node scripts/analyze-crowding.js                     # latest golden captures
 *   node scripts/analyze-crowding.js --version=2.0       # specific version
 *   node scripts/analyze-crowding.js --dir=path/to/pngs  # custom directory
 *   node scripts/analyze-crowding.js --json
 *   node scripts/analyze-crowding.js --scan              # raw cyan pixel map
 */

const path = require('path');
const fs = require('fs');
const { PNG } = require('pngjs');

const args = process.argv.slice(2);
function getArg(name, def) {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
}
const hasFlag = (name) => args.includes(`--${name}`);

const ROOT = path.join(__dirname, '..');

function findGoldenDir() {
  const custom = getArg('dir', null);
  if (custom) return custom;
  const version = getArg('version', null);
  const goldenBase = path.join(ROOT, 'tests', 'golden-captures');
  if (version) return path.join(goldenBase, `v${version}`);
  const dirs = fs.readdirSync(goldenBase)
    .filter(d => d.startsWith('v') && fs.statSync(path.join(goldenBase, d)).isDirectory())
    .sort((a, b) => {
      const va = a.replace('v', '').split('.').map(Number);
      const vb = b.replace('v', '').split('.').map(Number);
      for (let i = 0; i < Math.max(va.length, vb.length); i++) {
        if ((va[i] || 0) !== (vb[i] || 0)) return (va[i] || 0) - (vb[i] || 0);
      }
      return 0;
    });
  return dirs.length ? path.join(goldenBase, dirs[dirs.length - 1]) : null;
}

// ── Constants ──
const PX_PER_DEG = 38;
const VIEWPORT_W = 1200;
const VIEWPORT_H = 900;
const CYAN_THRESHOLD = 15;

const ROWS = [
  { deg: 3, label: '3°' },
  { deg: 6, label: '6°' },
  { deg: 10, label: '10°' },
];
const FONT_SIZES = [16, 28, 48];

// ── Detect fixation Y from cyan row symmetry ──
function detectFixationY(png) {
  const dpr = png.width > 2000 ? 2 : 1;
  // Scan for horizontal bands of cyan pixels
  const rowCyan = [];
  for (let py = 0; py < png.height; py++) {
    let cnt = 0;
    for (let px = 0; px < png.width; px += 2) { // skip every other for speed
      const idx = (py * png.width + px) * 4;
      if (png.data[idx + 2] - png.data[idx] > CYAN_THRESHOLD) cnt++;
    }
    if (cnt > 2) rowCyan.push({ py, cnt });
  }

  // Cluster consecutive rows
  const clusters = [];
  let cur = null;
  for (const r of rowCyan) {
    if (!cur || r.py - cur.endPy > 8) {
      cur = { startPy: r.py, endPy: r.py, total: 0 };
      clusters.push(cur);
    }
    cur.endPy = r.py;
    cur.total += r.cnt;
  }

  // Should be 6 main clusters (3 above + 3 below fixation) plus possibly 1 tiny one at fixation
  const mainClusters = clusters.filter(c => c.total > 50).sort((a, b) => a.startPy - b.startPy);
  if (mainClusters.length >= 6) {
    // Fixation Y = midpoint between cluster 3 (3° above) and cluster 4 (3° below)
    const midPy = (mainClusters[2].endPy + mainClusters[3].startPy) / 2;
    return midPy / dpr;
  }

  // Fallback: assume centered
  return (png.height / dpr) / 2;
}

// ── Find cyan clusters in a horizontal band within a column ──
// Returns clusters with pixel counts and spatial spread stats.
function findCyanClusters(png, dpr, pyStart, pyEnd, pxLeft, pxRight) {
  // Collect all cyan pixel positions (in CSS coords)
  const cyanXCount = {};
  const cyanPositions = []; // [{x, y} in CSS] for spread calculation
  let totalCyan = 0;

  for (let py = pyStart; py <= pyEnd; py++) {
    for (let px = pxLeft; px < pxRight; px++) {
      const idx = (py * png.width + px) * 4;
      if (png.data[idx + 2] - png.data[idx] > CYAN_THRESHOLD) {
        const cssX = Math.round(px / dpr);
        const cssY = Math.round(py / dpr);
        cyanXCount[cssX] = (cyanXCount[cssX] || 0) + 1;
        cyanPositions.push({ x: cssX, y: cssY });
        totalCyan++;
      }
    }
  }

  // Cluster X positions (gap > 30 CSS px separates clusters)
  const xPositions = Object.keys(cyanXCount).map(Number).sort((a, b) => a - b);
  const clusters = [];
  let c = null;
  for (const x of xPositions) {
    if (!c || x - c.endX > 30) {
      c = { startX: x, endX: x, cyanPixels: 0 };
      clusters.push(c);
    }
    c.endX = x;
    c.cyanPixels += cyanXCount[x];
  }

  return { clusters, totalCyan, cyanPositions };
}

// Compute spatial spread (stddev of 2D positions) for a subset of cyan positions
function computeSpread(positions) {
  if (positions.length < 2) return { spreadX: 0, spreadY: 0, spread2D: 0 };
  const n = positions.length;
  const meanX = positions.reduce((s, p) => s + p.x, 0) / n;
  const meanY = positions.reduce((s, p) => s + p.y, 0) / n;
  const varX = positions.reduce((s, p) => s + (p.x - meanX) ** 2, 0) / n;
  const varY = positions.reduce((s, p) => s + (p.y - meanY) ** 2, 0) / n;
  return {
    spreadX: Math.sqrt(varX),
    spreadY: Math.sqrt(varY),
    spread2D: Math.sqrt(varX + varY), // RMS spread
  };
}

// ── Main analysis ──
function analyzeCrowdingCenter(png) {
  const dpr = png.width > 2000 ? 2 : 1;
  const cssW = png.width / dpr;
  const cssH = png.height / dpr;
  const vpOffX = (cssW - VIEWPORT_W) / 2;
  const fixY = detectFixationY(png);

  const results = [];

  for (let colIdx = 0; colIdx < FONT_SIZES.length; colIdx++) {
    const fontSize = FONT_SIZES[colIdx];

    // Column boundaries in capture CSS
    const colLeftCSS = vpOffX + colIdx * (VIEWPORT_W / 3);
    const colRightCSS = colLeftCSS + VIEWPORT_W / 3;

    for (const row of ROWS) {
      for (const [dir, sign] of [['above', -1], ['below', 1]]) {
        const rowCenterY = fixY + sign * row.deg * PX_PER_DEG;
        const bandH = Math.max(fontSize * 2, 40);

        const pyStart = Math.round((rowCenterY - bandH / 2) * dpr);
        const pyEnd = Math.round((rowCenterY + bandH / 2) * dpr);
        const pxLeft = Math.round(colLeftCSS * dpr);
        const pxRight = Math.round(colRightCSS * dpr);

        const { clusters, totalCyan, cyanPositions } = findCyanClusters(png, dpr, pyStart, pyEnd, pxLeft, pxRight);

        // Split clusters at largest gap: left = crowded, right = isolated
        let crowdedCyan = 0, isolatedCyan = 0;
        let splitX = Infinity; // CSS X threshold for splitting positions
        if (clusters.length >= 2) {
          let maxGap = 0, splitIdx = 0;
          for (let i = 1; i < clusters.length; i++) {
            const gap = clusters[i].startX - clusters[i - 1].endX;
            if (gap > maxGap) { maxGap = gap; splitIdx = i; }
          }
          splitX = (clusters[splitIdx - 1].endX + clusters[splitIdx].startX) / 2;
          for (let i = 0; i < splitIdx; i++) crowdedCyan += clusters[i].cyanPixels;
          for (let i = splitIdx; i < clusters.length; i++) isolatedCyan += clusters[i].cyanPixels;
        } else if (clusters.length === 1) {
          crowdedCyan = clusters[0].cyanPixels;
        }

        // Spatial spread: split positions at the same gap and measure each group's dispersion
        const crowdedPos = cyanPositions.filter(p => p.x < splitX);
        const isolatedPos = cyanPositions.filter(p => p.x >= splitX);
        const crowdedSpread = computeSpread(crowdedPos);
        const isolatedSpread = computeSpread(isolatedPos);

        // Spread ratio: >1 means crowded target is more dispersed (crowding effect)
        const spreadRatio = isolatedSpread.spread2D > 0
          ? crowdedSpread.spread2D / isolatedSpread.spread2D : null;

        const crowdingRatio = isolatedCyan > 0 ? crowdedCyan / isolatedCyan : null;

        results.push({
          ecc_deg: row.deg,
          position: dir,
          fontSize,
          colIdx,
          crowded: { cyanPixels: crowdedCyan, spread: round1(crowdedSpread.spread2D) },
          isolated: { cyanPixels: isolatedCyan, spread: round1(isolatedSpread.spread2D) },
          totalCyan,
          nClusters: clusters.length,
          crowdingRatio: crowdingRatio !== null ? round3(crowdingRatio) : null,
          spreadRatio: spreadRatio !== null ? round3(spreadRatio) : null,
        });
      }
    }
  }

  return results;
}

function round1(v) { return Math.round(v * 10) / 10; }
function round3(v) { return Math.round(v * 1000) / 1000; }
function round4(v) { return Math.round(v * 10000) / 10000; }

// ── Scan mode ──
function scanCyan(png) {
  const dpr = png.width > 2000 ? 2 : 1;
  const fixY = detectFixationY(png);
  const cssW = png.width / dpr;
  const vpOffX = (cssW - VIEWPORT_W) / 2;
  console.log(`Image: ${png.width}×${png.height}, DPR=${dpr}`);
  console.log(`Detected fixation Y: ${fixY.toFixed(0)} CSS`);
  console.log(`Viewport offset X: ${vpOffX.toFixed(0)} CSS\n`);

  for (const row of ROWS) {
    for (const [dir, sign] of [['above', -1], ['below', 1]]) {
      const rowY = fixY + sign * row.deg * PX_PER_DEG;
      console.log(`${row.deg}° ${dir} (y≈${rowY.toFixed(0)}css):`);

      for (let colIdx = 0; colIdx < 3; colIdx++) {
        const colLeftCSS = vpOffX + colIdx * (VIEWPORT_W / 3);
        const colRightCSS = colLeftCSS + VIEWPORT_W / 3;
        const bandH = 40;
        const pyS = Math.round((rowY - bandH / 2) * dpr);
        const pyE = Math.round((rowY + bandH / 2) * dpr);

        const { clusters } = findCyanClusters(png, dpr, pyS, pyE,
          Math.round(colLeftCSS * dpr), Math.round(colRightCSS * dpr));

        const clStr = clusters.map(c =>
          `x=${c.startX}-${c.endX}(${c.cyanPixels}px)`
        ).join(', ');
        console.log(`  col ${colIdx} (${FONT_SIZES[colIdx]}px): ${clusters.length} clusters — ${clStr || 'none'}`);
      }
    }
  }
}

// ── Load PNG ──
function loadPng(filepath) {
  if (!fs.existsSync(filepath)) return null;
  return PNG.sync.read(fs.readFileSync(filepath));
}

// ── Main ──
function analyze() {
  const dir = findGoldenDir();
  if (!dir || !fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir || '(none)'}`);
    console.error('Run capture-golden.js first, or specify --dir=');
    process.exit(1);
  }

  // Support both naming conventions: crowding_center.png (golden) and crowding_center_filtered.png (capture-crowding.js)
  let centerFile = path.join(dir, 'crowding_center_filtered.png');
  if (!fs.existsSync(centerFile)) centerFile = path.join(dir, 'crowding_center.png');
  const centerPng = loadPng(centerFile);
  if (!centerPng) {
    console.error('No crowding capture found in ' + dir + ' (tried crowding_center_filtered.png and crowding_center.png)');
    process.exit(1);
  }

  if (hasFlag('scan')) {
    scanCyan(centerPng);
    return;
  }

  const results = analyzeCrowdingCenter(centerPng);

  if (hasFlag('json')) {
    console.log(JSON.stringify({ source: dir, measurements: results }, null, 2));
    return;
  }

  const dpr = centerPng.width > 2000 ? 2 : 1;
  const fixY = detectFixationY(centerPng);

  console.log(`=== Wave 3: Crowding Screenshot Analysis ===`);
  console.log(`Source: ${dir}`);
  console.log(`Image: ${centerPng.width}×${centerPng.height}, DPR=${dpr}`);
  console.log(`Detected fixation Y: ${fixY.toFixed(0)} CSS\n`);

  // Show per-column results
  for (const fontSize of FONT_SIZES) {
    const colResults = results.filter(r => r.fontSize === fontSize);
    console.log(`--- Column: ${fontSize}px ---\n`);
    console.log('Ecc(°)  Dir     Crowd(px)  Iso(px)  Cnt Ratio  Spread(c)  Spread(i)  Spr Ratio');
    console.log('------  ------  ---------  -------  ---------  ---------  ---------  ---------');

    for (const r of colResults.sort((a, b) => a.ecc_deg - b.ecc_deg || (a.position === 'above' ? -1 : 1))) {
      const cntRatio = r.crowdingRatio !== null ? r.crowdingRatio.toFixed(3) : '  N/A';
      const sprRatio = r.spreadRatio !== null ? r.spreadRatio.toFixed(3) : '  N/A';
      console.log(
        `${String(r.ecc_deg).padStart(6)}  ` +
        `${r.position.padEnd(6)}  ` +
        `${String(r.crowded.cyanPixels).padStart(9)}  ` +
        `${String(r.isolated.cyanPixels).padStart(7)}  ` +
        `${cntRatio.padStart(9)}  ` +
        `${r.crowded.spread.toFixed(1).padStart(9)}  ` +
        `${r.isolated.spread.toFixed(1).padStart(9)}  ` +
        `${sprRatio.padStart(9)}`
      );
    }
    console.log();
  }

  // Primary column summary (28px — optimal for crowding measurement)
  const primary = results.filter(r => r.fontSize === 28);
  console.log('--- Summary (28px column) ---\n');
  for (const deg of [3, 6, 10]) {
    const rows = primary.filter(r => r.ecc_deg === deg);
    const cntRatios = rows.map(r => r.crowdingRatio).filter(r => r !== null);
    const sprRatios = rows.map(r => r.spreadRatio).filter(r => r !== null);
    const crowded = rows.reduce((s, r) => s + r.crowded.cyanPixels, 0);
    const isolated = rows.reduce((s, r) => s + r.isolated.cyanPixels, 0);
    const avgCnt = cntRatios.length > 0 ? (cntRatios.reduce((a, b) => a + b) / cntRatios.length).toFixed(3) : 'N/A';
    const avgSpr = sprRatios.length > 0 ? (sprRatios.reduce((a, b) => a + b) / sprRatios.length).toFixed(3) : 'N/A';
    console.log(`  ${deg}°: cnt_ratio=${avgCnt}, spread_ratio=${avgSpr}  (crowd=${crowded}px, iso=${isolated}px)`);
  }

  // Validation
  console.log('\n--- Validation ---\n');

  const maxCyan = Math.max(...results.map(r => r.totalCyan));
  console.log(`[${maxCyan > 0 ? 'PASS' : 'FAIL'}] Cyan target signal detected (max=${maxCyan}px in a band)`);

  // At 10°, crowded and isolated should both be detectable in 48px column
  const far48 = results.filter(r => r.fontSize === 48 && r.ecc_deg === 10);
  const bothDetectable = far48.some(r => r.crowded.cyanPixels > 0 && r.isolated.cyanPixels > 0);
  console.log(`[${bothDetectable ? 'PASS' : 'FAIL'}] Both targets visible at 10° in 48px column`);

  // Total cyan should decrease with eccentricity (filter removes more at larger eccentricities)
  const totalByEcc = [3, 6, 10].map(deg => {
    return results.filter(r => r.ecc_deg === deg)
      .reduce((s, r) => s + r.totalCyan, 0);
  });
  const cyanDecays = totalByEcc[0] > totalByEcc[2];
  console.log(`[${cyanDecays ? 'PASS' : 'FAIL'}] Total cyan decreases with eccentricity (3°:${totalByEcc[0]}, 6°:${totalByEcc[1]}, 10°:${totalByEcc[2]})`);

  // Spread ratio: crowded target should be more dispersed at peripheral eccentricities
  // This is the primary crowding metric — V1 displacement scatters crowded letters
  const spr28_6 = primary.filter(r => r.ecc_deg === 6 && r.spreadRatio !== null);
  const maxSpr6 = spr28_6.length > 0 ? Math.max(...spr28_6.map(r => r.spreadRatio)) : 0;
  console.log(`[${maxSpr6 > 1.2 ? 'PASS' : 'FAIL'}] Spread ratio > 1.2 at 6° in 28px (max=${maxSpr6.toFixed(3)}) — crowding dispersion`);

  // Spread ratio at 3° should be near 1.0 (foveal, minimal crowding)
  const spr28_3 = primary.filter(r => r.ecc_deg === 3 && r.spreadRatio !== null);
  const meanSpr3 = spr28_3.length > 0 ? spr28_3.reduce((s, r) => s + r.spreadRatio, 0) / spr28_3.length : 1.0;
  console.log(`[${meanSpr3 < 1.1 ? 'PASS' : 'FAIL'}] Spread ratio ≈1.0 at 3° in 28px (mean=${meanSpr3.toFixed(3)}) — minimal near-foveal crowding`);

  // 48px column should show crowding ratio < 1.0 at large eccentricities (letters resolving worse when crowded)
  const far48ratios = results.filter(r => r.fontSize === 48 && r.ecc_deg >= 6 && r.crowdingRatio !== null);
  const crowdingVisible = far48ratios.some(r => r.crowdingRatio < 0.9);
  console.log(`[${crowdingVisible ? 'PASS' : far48ratios.length === 0 ? 'SKIP' : 'FAIL'}] Crowding effect visible in 48px column at ≥6° (ratio<0.9)`);

  // V1 plateau check: spread ratio should increase from 6° to 10° (not plateau/decrease)
  // Pre-fix expectation: FAIL (plateau at ~6° due to eccentricityScale clamping)
  const maxSpr10 = primary.filter(r => r.ecc_deg === 10 && r.spreadRatio !== null);
  const maxSpr10val = maxSpr10.length > 0 ? Math.max(...maxSpr10.map(r => r.spreadRatio)) : 0;
  const sprGrows = maxSpr10val > maxSpr6;
  console.log(`[${sprGrows ? 'PASS' : 'INFO'}] Spread ratio grows 6°→10° (6°:${maxSpr6.toFixed(3)}, 10°:${maxSpr10val.toFixed(3)}) — V1 plateau check`);
}

// ── Bouma Spacing Analysis ──
// Reads spacing_center_filtered.png and spacing_center_baseline.png.
// At each spacing ratio (0.2x–0.8x + isolated), measures cyan target survival
// through the filter. The survival curve should form a sigmoid around 0.5x (Bouma).

const SPACING_RATIOS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
const SPACING_ECC_DEG = 6;
const SPACING_CX = 600, SPACING_CY = 450;
const SPACING_VP_W = 1200, SPACING_VP_H = 900;

function analyzeSpacing() {
  const dir = findGoldenDir();
  if (!dir || !fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir || '(none)'}`);
    process.exit(1);
  }

  const filteredPng = loadPng(path.join(dir, 'spacing_center_filtered.png'));
  const baselinePng = loadPng(path.join(dir, 'spacing_center_baseline.png'));
  if (!filteredPng || !baselinePng) {
    console.error('spacing_center_filtered.png and/or spacing_center_baseline.png not found in ' + dir);
    console.error('Run: BASE_URL=file:///path/to/scrutinizer-www/src/reference-pages node scripts/capture-crowding.js --pages=spacing');
    process.exit(1);
  }

  const dpr = filteredPng.width > 2000 ? 2 : 1;
  const cssW = filteredPng.width / dpr;
  const cssH = filteredPng.height / dpr;

  // Viewport is centered in the window
  const vpOffX = (cssW - SPACING_VP_W) / 2;
  const vpOffY = (cssH - SPACING_VP_H) / 2;

  // Row geometry (matches crowding-spacing.html)
  const totalHeight = 600;
  const rowSpacing = totalHeight / (SPACING_RATIOS.length + 1); // 75px
  const startY = SPACING_CY - totalHeight / 2 + rowSpacing; // 225px in viewport
  const targetX = SPACING_CX + SPACING_ECC_DEG * PX_PER_DEG; // 828px in viewport

  // Convert to CSS coords in the full window
  const targetCSSX = vpOffX + targetX;

  console.log(`=== Wave 3: Bouma Spacing Analysis ===`);
  console.log(`Source: ${dir}`);
  console.log(`Image: ${filteredPng.width}×${filteredPng.height}, DPR=${dpr}`);
  console.log(`Viewport offset: (${vpOffX.toFixed(0)}, ${vpOffY.toFixed(0)}) CSS`);
  console.log(`Target X: ${targetCSSX.toFixed(0)} CSS (6° right of fixation)`);
  console.log();

  // Measure cyan at each row for both filtered and baseline
  const bandH = 50; // CSS px vertical band to sample
  const bandW = 120; // CSS px horizontal band centered on target

  const rows = [];
  const allRows = [...SPACING_RATIOS.map((r, i) => ({
    ratio: r,
    label: `${r.toFixed(1)}x`,
    y: vpOffY + startY + i * rowSpacing,
  })), {
    ratio: null,
    label: 'isolated',
    y: vpOffY + startY + SPACING_RATIOS.length * rowSpacing,
  }];

  for (const row of allRows) {
    const pyS = Math.round((row.y - bandH / 2) * dpr);
    const pyE = Math.round((row.y + bandH / 2) * dpr);
    const pxL = Math.round((targetCSSX - bandW / 2) * dpr);
    const pxR = Math.round((targetCSSX + bandW / 2) * dpr);

    // Count cyan pixels and collect luminance values in the band
    let filteredCyan = 0, baselineCyan = 0;
    const filteredPositions = [], baselinePositions = [];
    // Luminance samples in a tight patch around expected target center for variance analysis
    const patchHalf = Math.round(14 * dpr); // ~14 CSS px radius
    const patchCX = Math.round(targetCSSX * dpr);
    const patchCY = Math.round(row.y * dpr);
    const filteredLum = [], baselineLum = [];

    for (let py = pyS; py <= pyE; py++) {
      for (let px = pxL; px < pxR; px++) {
        const idx = (py * filteredPng.width + px) * 4;
        const bidx = (py * baselinePng.width + px) * 4;

        if (filteredPng.data[idx + 2] - filteredPng.data[idx] > CYAN_THRESHOLD) {
          filteredCyan++;
          filteredPositions.push({ x: px / dpr, y: py / dpr });
        }
        if (baselinePng.data[bidx + 2] - baselinePng.data[bidx] > CYAN_THRESHOLD) {
          baselineCyan++;
          baselinePositions.push({ x: px / dpr, y: py / dpr });
        }

        // Luminance in tight patch (captures V1 fragmentation)
        if (Math.abs(px - patchCX) <= patchHalf && Math.abs(py - patchCY) <= patchHalf) {
          const fLum = 0.2126 * filteredPng.data[idx] + 0.7152 * filteredPng.data[idx+1] + 0.0722 * filteredPng.data[idx+2];
          const bLum = 0.2126 * baselinePng.data[bidx] + 0.7152 * baselinePng.data[bidx+1] + 0.0722 * baselinePng.data[bidx+2];
          filteredLum.push(fLum);
          baselineLum.push(bLum);
        }
      }
    }

    const survival = baselineCyan > 0 ? filteredCyan / baselineCyan : null;
    const fSpread = computeSpread(filteredPositions);
    const bSpread = computeSpread(baselinePositions);
    const spreadRatio = bSpread.spread2D > 0 ? fSpread.spread2D / bSpread.spread2D : null;

    // Centroid displacement: how far did V1 shift the target's cyan center?
    const fCentroid = filteredPositions.length > 0
      ? { x: filteredPositions.reduce((s,p) => s+p.x, 0) / filteredPositions.length,
          y: filteredPositions.reduce((s,p) => s+p.y, 0) / filteredPositions.length }
      : null;
    const bCentroid = baselinePositions.length > 0
      ? { x: baselinePositions.reduce((s,p) => s+p.x, 0) / baselinePositions.length,
          y: baselinePositions.reduce((s,p) => s+p.y, 0) / baselinePositions.length }
      : null;
    const centroidDisp = (fCentroid && bCentroid)
      ? Math.sqrt((fCentroid.x - bCentroid.x)**2 + (fCentroid.y - bCentroid.y)**2)
      : null;

    // Patch luminance variance: V1 displacement fragments letters → higher variance
    function variance(arr) {
      if (arr.length < 2) return 0;
      const mean = arr.reduce((a,b) => a+b) / arr.length;
      return arr.reduce((s,v) => s + (v-mean)**2, 0) / arr.length;
    }
    const fVar = variance(filteredLum);
    const bVar = variance(baselineLum);
    const distortionRatio = bVar > 0 ? fVar / bVar : null;

    rows.push({
      ...row,
      filteredCyan, baselineCyan,
      survival,
      filteredSpread: fSpread.spread2D,
      baselineSpread: bSpread.spread2D,
      spreadRatio,
      centroidDisp,
      distortionRatio,
    });
  }

  // Output table — survival (pixel count) metric
  console.log('--- Pixel Survival (count-based, weak signal for crowding) ---\n');
  console.log('Spacing  Filtered(px)  Baseline(px)  Survival');
  console.log('-------  -----------  -----------  --------');

  for (const r of rows) {
    const surv = r.survival !== null ? r.survival.toFixed(3) : '  N/A';
    console.log(
      `${r.label.padEnd(9)}` +
      `${String(r.filteredCyan).padStart(10)}  ` +
      `${String(r.baselineCyan).padStart(11)}  ` +
      `${surv.padStart(8)}`
    );
  }

  const spacingRows = rows.filter(r => r.ratio !== null);
  const isoRow = rows.find(r => r.ratio === null);

  // Dispersion metrics — the correct signal for V1 Lateral Smash crowding
  console.log('\n--- Dispersion Metrics (V1 displacement signal) ---\n');
  console.log('Spacing  Centroid(px)  Distortion  Spr Ratio  Spread(f)  Spread(b)');
  console.log('-------  -----------  ----------  ---------  ---------  ---------');

  for (const r of rows) {
    const cd = r.centroidDisp !== null ? r.centroidDisp.toFixed(1) : 'N/A';
    const dr = r.distortionRatio !== null ? r.distortionRatio.toFixed(3) : 'N/A';
    const spr = r.spreadRatio !== null ? r.spreadRatio.toFixed(3) : 'N/A';
    console.log(
      `${r.label.padEnd(9)}` +
      `${cd.padStart(11)}  ` +
      `${dr.padStart(10)}  ` +
      `${spr.padStart(9)}  ` +
      `${r.filteredSpread.toFixed(1).padStart(9)}  ` +
      `${r.baselineSpread.toFixed(1).padStart(9)}`
    );
  }

  // Dispersion curve — should decrease with spacing (more dispersion at tight spacing)
  if (isoRow && isoRow.centroidDisp !== null) {
    console.log('\n--- Centroid Displacement vs Spacing (Bouma curve) ---\n');
    const maxDisp = Math.max(...rows.map(r => r.centroidDisp || 0));
    for (const r of spacingRows) {
      const barLen = maxDisp > 0 ? Math.round((r.centroidDisp || 0) / maxDisp * 40) : 0;
      const bar = '|'.repeat(barLen);
      console.log(`  ${r.label}  ${(r.centroidDisp || 0).toFixed(1).padStart(5)}px  ${bar}`);
    }
    console.log(`  iso    ${(isoRow.centroidDisp || 0).toFixed(1).padStart(5)}px  ${'|'.repeat(maxDisp > 0 ? Math.round((isoRow.centroidDisp || 0) / maxDisp * 40) : 0)}  <-- baseline`);
  }

  if (isoRow && isoRow.distortionRatio !== null) {
    console.log('\n--- Distortion Ratio vs Spacing ---\n');
    const maxDR = Math.max(...rows.map(r => r.distortionRatio || 0));
    for (const r of spacingRows) {
      const barLen = maxDR > 0 ? Math.round((r.distortionRatio || 0) / maxDR * 40) : 0;
      const bar = '#'.repeat(barLen);
      console.log(`  ${r.label}  ${(r.distortionRatio || 0).toFixed(3).padStart(6)}  ${bar}`);
    }
    console.log(`  iso    ${(isoRow.distortionRatio || 0).toFixed(3).padStart(6)}  ${'#'.repeat(maxDR > 0 ? Math.round((isoRow.distortionRatio || 0) / maxDR * 40) : 0)}  <-- baseline`);
  }
  console.log();

  // Find critical spacing using centroid displacement: where displacement crosses
  // the midpoint between max (tight) and iso (baseline)
  let criticalSpacingDisp = null;
  const isoDisp = isoRow ? (isoRow.centroidDisp || 0) : 0;
  const tightDisp = spacingRows[0] ? (spacingRows[0].centroidDisp || 0) : 0;
  const midDisp = (tightDisp + isoDisp) / 2;
  if (tightDisp > isoDisp * 1.2) { // Only if there's a meaningful range
    for (let i = 0; i < spacingRows.length - 1; i++) {
      const a = spacingRows[i], b = spacingRows[i + 1];
      const aD = a.centroidDisp || 0, bD = b.centroidDisp || 0;
      if ((aD >= midDisp && bD <= midDisp) || (aD <= midDisp && bD >= midDisp)) {
        const t = (midDisp - aD) / (bD - aD);
        criticalSpacingDisp = a.ratio + t * (b.ratio - a.ratio);
        break;
      }
    }
  }

  // Monotonicity check on centroid displacement (should decrease with spacing)
  let dispDecreases = true;
  for (let i = 0; i < spacingRows.length - 1; i++) {
    const a = spacingRows[i].centroidDisp || 0;
    const b = spacingRows[i + 1].centroidDisp || 0;
    if (b > a + 1.0) { // Allow 1px noise
      dispDecreases = false;
    }
  }

  console.log('--- Validation ---\n');

  // Dispersion-based checks (primary)
  const tightDispVal = spacingRows[0] ? (spacingRows[0].centroidDisp || 0) : 0;
  const wideDispVal = spacingRows[spacingRows.length - 1] ? (spacingRows[spacingRows.length - 1].centroidDisp || 0) : 0;
  const isoDispVal = isoRow ? (isoRow.centroidDisp || 0) : 0;
  const tightMoreThanIso = tightDispVal > isoDispVal * 1.3;
  console.log(`[${tightMoreThanIso ? 'PASS' : 'FAIL'}] Tight spacing (0.2x) more displaced than isolated (${tightDispVal.toFixed(1)}px vs ${isoDispVal.toFixed(1)}px)`);

  const wideNearIso = Math.abs(wideDispVal - isoDispVal) < Math.max(isoDispVal * 0.5, 3.0);
  console.log(`[${wideNearIso ? 'PASS' : 'INFO'}] Wide spacing (0.8x) displacement near isolated (${wideDispVal.toFixed(1)}px vs ${isoDispVal.toFixed(1)}px)`);

  console.log(`[${dispDecreases ? 'PASS' : 'INFO'}] Displacement generally decreases with spacing`);

  if (criticalSpacingDisp !== null) {
    const nearBouma = criticalSpacingDisp >= 0.3 && criticalSpacingDisp <= 0.7;
    console.log(`[${nearBouma ? 'PASS' : 'INFO'}] Critical spacing (dispersion midpoint) at ${criticalSpacingDisp.toFixed(2)}x (Bouma predicts ~0.5x)`);
  } else if (tightDisp <= isoDisp * 1.2) {
    console.log(`[INFO] Centroid displacement range too narrow for Bouma curve (tight=${tightDispVal.toFixed(1)}, iso=${isoDispVal.toFixed(1)})`);
  } else {
    console.log(`[INFO] No clean dispersion midpoint crossing found`);
  }

  // Distortion ratio checks
  const tightDR = spacingRows[0] ? (spacingRows[0].distortionRatio || 0) : 0;
  const isoDR = isoRow ? (isoRow.distortionRatio || 0) : 0;
  const drSignal = tightDR > isoDR * 1.1;
  console.log(`[${drSignal ? 'PASS' : 'INFO'}] Tight spacing has higher patch distortion than isolated (${tightDR.toFixed(3)} vs ${isoDR.toFixed(3)})`);

  // Legacy survival checks (secondary)
  console.log();
  console.log('--- Legacy (survival-based, weaker signal) ---\n');
  const isoSurvival = isoRow && isoRow.survival !== null ? isoRow.survival : 0;
  console.log(`[${isoSurvival > 0.7 ? 'PASS' : 'FAIL'}] Isolated target survival > 0.7 (${isoSurvival.toFixed(3)})`);

  if (hasFlag('json')) {
    console.log(JSON.stringify({ source: dir, spacingRows: rows, criticalSpacingDisp }, null, 2));
  }
}

try {
  if (hasFlag('spacing')) {
    analyzeSpacing();
  } else {
    analyze();
  }
} catch (err) {
  console.error(err);
  process.exit(1);
}
