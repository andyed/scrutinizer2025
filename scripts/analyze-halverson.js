#!/usr/bin/env node
/**
 * Analyze Halverson mixed-density captures for Wave 5 validation.
 *
 * Reads paired captures (filtered vs baseline) for each density condition
 * and measures per-group degradation to test the density gate prediction:
 * sparse groups should show less peripheral degradation than dense groups
 * at matched eccentricity.
 *
 * Method:
 *   1. For each condition (sparse, dense, mixed), load filtered + baseline PNGs
 *   2. Divide the image into 6 group regions matching the 2×3 grid layout
 *   3. Per group region, compute:
 *      - SSIM between filtered and baseline (structural preservation)
 *      - Mean luminance difference (overall degradation)
 *      - Edge density ratio (high-frequency preservation)
 *      - Text legibility proxy: contrast of dark-on-light text pixels
 *   4. Compare sparse vs dense groups at matched eccentricities
 *   5. Report: does peripheral degradation correlate with density?
 *
 * Validation targets (from Halverson & Hornof 2011):
 *   - Sparse groups should have HIGHER structural preservation (closer to baseline)
 *   - Dense groups should have LOWER structural preservation
 *   - In mixed condition, the sparse/dense difference should predict search order
 *   - The degradation gradient should match the density-dependent encoding errors
 *     that H&H found (10% miss rate for sparse, 50% for dense)
 *
 * Usage:
 *   node scripts/analyze-halverson.js
 *   node scripts/analyze-halverson.js --dir=path/to/captures
 *   node scripts/analyze-halverson.js --json
 *   node scripts/analyze-halverson.js --verbose
 */

const path = require('path');
const fs = require('fs');
const { PNG } = require('pngjs');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
function getArg(name, def) {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
}
const hasFlag = (name) => args.includes(`--${name}`);
const jsonOutput = hasFlag('json');
const verbose = hasFlag('verbose');

const ROOT = path.join(__dirname, '..');
const DEFAULT_DIR = path.join(ROOT, 'tests', 'golden-captures', 'validation', 'halverson');

function findCaptureDir() {
  const custom = getArg('dir', null);
  if (custom) return custom;
  return DEFAULT_DIR;
}

// ── Layout geometry (must match halverson-mixed-density.html) ──

const PPD_CSS = parseInt(getArg('ppd', '38'), 10);
// Actual pixel dimensions come from the PNG itself (Retina 2x)
// We'll detect DPR from the image width vs expected CSS width
const CSS_WIDTH = 1280;
const CSS_HEIGHT = 720;

// Group grid: 2 rows × 3 columns
// Positions in degrees from layout top-left
const GROUP_POSITIONS = [
  { col: 0, row: 0, xDeg: 0.0, yDeg: 0.0, label: 'TL' },
  { col: 1, row: 0, xDeg: 3.0, yDeg: 0.0, label: 'TC' },
  { col: 2, row: 0, xDeg: 6.0, yDeg: 0.0, label: 'TR' },
  { col: 0, row: 1, xDeg: 0.0, yDeg: 3.5, label: 'BL' },
  { col: 1, row: 1, xDeg: 3.0, yDeg: 3.5, label: 'BC' },
  { col: 2, row: 1, xDeg: 6.0, yDeg: 3.5, label: 'BR' },
];

const LAYOUT_W_DEG = 7.5;
const LAYOUT_H_DEG = 7.0;

// Density flags per condition (must match CONDITIONS in HTML)
const CONDITION_DENSITY = {
  sparse: [false, false, false, false, false, false],
  dense:  [true, true, true, true, true, true],
  mixed:  [true, false, true, false, true, false],
};

// Group bounding box size in degrees
const SPARSE_GROUP_H_DEG = 0.65 * 5;  // 5 words × spacing
const DENSE_GROUP_H_DEG = 0.33 * 10;  // 10 words × spacing
const GROUP_W_DEG = 2.5;              // estimated word width (generous to catch all text)

function loadPNG(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const data = fs.readFileSync(filePath);
  return PNG.sync.read(data);
}

function getPixel(png, x, y) {
  if (x < 0 || x >= png.width || y < 0 || y >= png.height) return [255, 255, 255, 255];
  const idx = (y * png.width + x) * 4;
  return [png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]];
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Compute structural similarity proxy between two image regions.
 * Simplified SSIM: compares mean, variance, and covariance of luminance
 * within the specified bounding box.
 */
function regionSSIM(filtered, baseline, x0, y0, w, h) {
  let sumF = 0, sumB = 0, sumF2 = 0, sumB2 = 0, sumFB = 0;
  let n = 0;

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const [fr, fg, fb] = getPixel(filtered, x0 + dx, y0 + dy);
      const [br, bg, bb] = getPixel(baseline, x0 + dx, y0 + dy);
      const fL = luminance(fr, fg, fb);
      const bL = luminance(br, bg, bb);
      sumF += fL;
      sumB += bL;
      sumF2 += fL * fL;
      sumB2 += bL * bL;
      sumFB += fL * bL;
      n++;
    }
  }

  if (n === 0) return 0;

  const muF = sumF / n;
  const muB = sumB / n;
  const sigF2 = sumF2 / n - muF * muF;
  const sigB2 = sumB2 / n - muB * muB;
  const sigFB = sumFB / n - muF * muB;

  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;

  const ssim = ((2 * muF * muB + C1) * (2 * sigFB + C2)) /
               ((muF ** 2 + muB ** 2 + C1) * (sigF2 + sigB2 + C2));

  return ssim;
}

/**
 * Count edge pixels in a region using simple Sobel approximation.
 * Returns ratio of edge pixels to total pixels (0-1).
 */
function edgeDensity(png, x0, y0, w, h) {
  let edges = 0;
  let total = 0;
  const threshold = 30;

  for (let dy = 1; dy < h - 1; dy++) {
    for (let dx = 1; dx < w - 1; dx++) {
      const [r, g, b] = getPixel(png, x0 + dx, y0 + dy);
      const L = luminance(r, g, b);
      const [rR, gR, bR] = getPixel(png, x0 + dx + 1, y0 + dy);
      const [rD, gD, bD] = getPixel(png, x0 + dx, y0 + dy + 1);
      const LR = luminance(rR, gR, bR);
      const LD = luminance(rD, gD, bD);
      const grad = Math.abs(L - LR) + Math.abs(L - LD);
      if (grad > threshold) edges++;
      total++;
    }
  }

  return total > 0 ? edges / total : 0;
}

/**
 * Compute text contrast within a region.
 * Text is dark pixels on white background. Measure the contrast
 * between the darkest and lightest quintiles.
 */
function textContrast(png, x0, y0, w, h) {
  const lums = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const [r, g, b] = getPixel(png, x0 + dx, y0 + dy);
      lums.push(luminance(r, g, b));
    }
  }

  if (lums.length === 0) return 0;

  lums.sort((a, b) => a - b);
  const n = lums.length;
  const q20 = lums[Math.floor(n * 0.2)];  // dark quintile (text pixels)
  const q80 = lums[Math.floor(n * 0.8)];  // light quintile (background)

  return q80 - q20;  // higher = more legible text
}

/**
 * Extract a region from a PNG as a new PNG buffer.
 */
function extractRegion(png, x0, y0, w, h) {
  const out = new PNG({ width: w, height: h });
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const srcIdx = ((y0 + dy) * png.width + (x0 + dx)) * 4;
      const dstIdx = (dy * w + dx) * 4;
      if (x0 + dx >= 0 && x0 + dx < png.width && y0 + dy >= 0 && y0 + dy < png.height) {
        out.data[dstIdx] = png.data[srcIdx];
        out.data[dstIdx + 1] = png.data[srcIdx + 1];
        out.data[dstIdx + 2] = png.data[srcIdx + 2];
        out.data[dstIdx + 3] = png.data[srcIdx + 3];
      } else {
        out.data[dstIdx] = 255;
        out.data[dstIdx + 1] = 255;
        out.data[dstIdx + 2] = 255;
        out.data[dstIdx + 3] = 255;
      }
    }
  }
  return PNG.sync.write(out);
}

/**
 * Run Tesseract OCR on a PNG region and return recognized words.
 * Uses CLI tesseract (brew install tesseract).
 */
function ocrRegion(pngBuffer, label) {
  const tmpDir = path.join(require('os').tmpdir(), 'halverson-ocr');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `${label}.png`);
  fs.writeFileSync(tmpFile, pngBuffer);

  try {
    // PSM 6 = assume uniform block of text
    const result = execSync(
      `tesseract "${tmpFile}" stdout --psm 6 -l eng 2>/dev/null`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    // Clean up: lowercase, split into words, filter empties
    const words = result.toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 1);
    return words;
  } catch (e) {
    if (verbose) console.log(`    OCR failed for ${label}: ${e.message}`);
    return [];
  }
}

// Word pool from the stimulus (must match halverson-mixed-density.html WORD_POOL)
const WORD_POOL_SET = new Set([
  'scale','sleep','post','flame','steel','rock','border','doorway','whistle','essay',
  'ramp','thaw','honey','sheep','horse','wire','east','jam','mink','coat',
  'kitten','eight','face','rail','birth','scare','choir','cable','skin','teeth',
  'hunt','ankle','shoe','clown','sleigh','dot','charm','lake','guy','youth',
  'quart','seed','soup','dive','square','staff','letter','yawn','net','cry',
  'room','flower','beer','hero','itch','nod','glass','sink','lady','trip',
  'apple','badge','bench','bird','blade','blind','block','board','bone','boot',
  'bowl','brain','bread','brick','bridge','brush','bunch','burst','cabin','cake',
  'camp','card','cave','chain','chair','chalk','chest','child','chin','church',
  'cliff','clock','cloth','cloud','coach','corn','couch','court','craft','crane',
  'crash','cream','cross','crowd','crown','curve','dance','dawn','death','depth',
  'desk','dish','dome','door','draft','drain','dream','dress','drift','drill',
  'drink','drive','drum','dust','dwarf','eagle','earth','edge','elbow','elm',
  'faith','feast','fence','field','film','flash','flesh','flight','flood',
  'floor','foam','fold','force','fork','fort','frame','front','frost','fruit',
  'gain','gang','gate','ghost','gift','globe','glove','goal','gold','grace',
  'grade','grain','grant','grape','grasp','grass','grave','grief','grill','grind',
  'grip','ground','grove','growth','guard','guess','guide','gulf','habit','hall',
  'hand','harm','haste','hat','hawk','hay','heart','hedge','heel','height',
  'herb','hill','hint','hole','hood','hook','horn','host','house','hull',
  'ice','ink','inn','iron','isle','jail','jar','jaw','jet','jewel',
  'joint','joy','judge','jug','juice','jump','jungle','key','kick','king',
  'kiss','knee','knife','knob','knot','lab','lace','lamp','land','lane',
  'lawn','leaf','ledge','leg','lens','lift','lime','limb','line','link',
  'lip','list','load','loan','lock','lodge','log','loop','lord','luck',
  'lung','maid','mail','map','mark','marsh','mask','match','maze','meal',
  'meat','mill','mind','mine','mint','mix','moat','mode','mood','moon',
  'moss','mount','mouse','mouth','mud','mug','myth','nail','name','neck',
  'nerve','nest','night','nose','note','nurse','oak','oath','oil','ounce',
  'owl','pace','pack','page','pain','paint','pair','palm','pan','park',
  'patch','path','pause','paw','peak','pearl','pen','pet','phrase','pile',
  'pine','pipe','pit','pitch','plain','plane','plant','plate','plot','plum',
  'plunge','point','pole','pond','pool','port','pot','pound','praise','press',
  'price','pride','prince','print','prize','proof','prose','pub','pulse','pump',
  'punch','purse','push','quail','queen','quote','race','rage','raid','rain',
  'range','rank','rat','ray','realm','rice','ridge','ring','rise','risk',
  'road','robe','rod','role','roof','root','rope','rose','round','route',
  'row','rug','rule','rush','rust','sack','sage','sail','saint','salt',
  'sand','sauce','scarf','scene','scent','school','scope','scout','screen','script',
  'seal','search','seat','shade','shaft','shame','shape','share','shell','shift',
  'shine','ship','shirt','shock','shore','shrub','siege','sight','sign','silk',
  'skill','skull','slate','slave','slice','slide','slope','slot','smile','smoke',
  'snake','snow','soil','sole','song','sort','soul','spark','spear','speech',
  'speed','spell','sphere','spice','spine','spite','split','spoon','sport','spray',
  'spring','spy','squad','stack','stage','stain','stair','stake','stall',
  'stamp','stand','star','state','steak','steam','stem','step','stick','stock',
  'stone','stool','store','storm','stove','strain','straw','stream','street','stress',
  'stretch','stride','string','strip','stroke','style','sum','sun','surf','surge',
  'swamp','swan','sweat','sweep','swing','sword','tail','tale','tank','tape',
  'taste','team','tear','term','test','theme','thorn','thread','throat','throne',
  'thumb','tide','tile','tip','toast','toe','tone','tongue','tool','top',
  'torch','touch','tour','tower','town','toy','trace','track','trade','trail',
  'train','trait','trap','trash','tray','treat','tree','trend','tribe','trick',
  'troop','truck','trunk','trust','truth','tube','tune','turn','tusk','tutor',
  'twist','type','valve','vault','verse','view','vine','voice','wage','waist',
  'walk','wall','wand','ward','waste','watch','wave','wax','wealth','web',
  'wedge','weed','weight','well','wheat','wheel','whip','width','will','wind',
  'wing','wish','witch','wolf','wood','wool','word','work','world','worm',
  'wound','wrap','wrist','yard','yell','zone'
]);

/**
 * Compute OCR legibility: how many recognized words are valid English words
 * from the stimulus word pool?
 *
 * Previous approach compared filtered OCR against baseline OCR, but baseline
 * OCR itself is noisy on peripheral text, inflating scores when both produce
 * the same garbage. This approach compares against ground truth (the known
 * word pool), measuring what Halverson calls "encoding accuracy": can the
 * text actually be read?
 */
function ocrLegibility(filtered, baseline, x0, y0, w, h, label) {
  const filteredBuf = extractRegion(filtered, x0, y0, w, h);
  const baselineBuf = extractRegion(baseline, x0, y0, w, h);

  const baselineWords = ocrRegion(baselineBuf, `${label}_baseline`);
  const filteredWords = ocrRegion(filteredBuf, `${label}_filtered`);

  // Count valid word-pool hits in each
  const baselineValid = baselineWords.filter(w => WORD_POOL_SET.has(w));
  const filteredValid = filteredWords.filter(w => WORD_POOL_SET.has(w));

  if (baselineValid.length === 0) {
    return { baselineWords: 0, filteredWords: 0, matches: 0, matchRate: 0,
             baselineList: baselineWords, filteredList: filteredWords };
  }

  // Legibility = valid words in filtered / valid words in baseline
  const matchRate = filteredValid.length / baselineValid.length;

  return {
    baselineWords: baselineValid.length,
    filteredWords: filteredValid.length,
    matches: filteredValid.length,
    matchRate: Math.min(matchRate, 1.0),  // cap at 1.0
    baselineList: baselineWords,
    filteredList: filteredWords,
  };
}

function analyzeCondition(captureDir, condition) {
  const filteredPath = path.join(captureDir, `halverson_${condition}_filtered.png`);
  const baselinePath = path.join(captureDir, `halverson_${condition}_baseline.png`);

  const filtered = loadPNG(filteredPath);
  const baseline = loadPNG(baselinePath);

  if (!filtered || !baseline) {
    console.error(`  Missing captures for condition: ${condition}`);
    return null;
  }

  const densityFlags = CONDITION_DENSITY[condition];

  // Detect DPR from actual image width vs expected CSS width
  const DPR = Math.round(filtered.width / CSS_WIDTH) || 2;
  const PPD = PPD_CSS * DPR;
  const VIEWPORT_W = filtered.width;
  const VIEWPORT_H = filtered.height;

  if (verbose) {
    console.log(`  Image: ${VIEWPORT_W}×${VIEWPORT_H}, DPR=${DPR}, PPD=${PPD}`);
  }

  // Layout is centered in viewport (CSS coordinates scaled by DPR)
  const layoutWPx = LAYOUT_W_DEG * PPD;
  const layoutHPx = LAYOUT_H_DEG * PPD;
  const layoutX0 = Math.round((VIEWPORT_W - layoutWPx) / 2);
  const layoutY0 = Math.round((VIEWPORT_H - layoutHPx) / 2);

  // Fixation at center
  const fixX = VIEWPORT_W / 2;
  const fixY = VIEWPORT_H / 2;

  const groups = GROUP_POSITIONS.map((pos, gi) => {
    const isDense = densityFlags[gi];
    const groupHDeg = isDense ? DENSE_GROUP_H_DEG : SPARSE_GROUP_H_DEG;

    // Group bounding box in pixels
    const gx = layoutX0 + Math.round(pos.xDeg * PPD);
    const gy = layoutY0 + Math.round(pos.yDeg * PPD);
    const gw = Math.round(GROUP_W_DEG * PPD);
    const gh = Math.round(groupHDeg * PPD);

    // Eccentricity from fixation to group centroid (in degrees)
    const centroidX = gx + gw / 2;
    const centroidY = gy + gh / 2;
    const eccPx = Math.sqrt((centroidX - fixX) ** 2 + (centroidY - fixY) ** 2);
    const eccDeg = eccPx / PPD;

    // Metrics
    const ssim = regionSSIM(filtered, baseline, gx, gy, gw, gh);
    const edgeFiltered = edgeDensity(filtered, gx, gy, gw, gh);
    const edgeBaseline = edgeDensity(baseline, gx, gy, gw, gh);
    const edgeRatio = edgeBaseline > 0 ? edgeFiltered / edgeBaseline : 0;
    const contrastFiltered = textContrast(filtered, gx, gy, gw, gh);
    const contrastBaseline = textContrast(baseline, gx, gy, gw, gh);
    const contrastRatio = contrastBaseline > 0 ? contrastFiltered / contrastBaseline : 0;

    // OCR legibility — the key metric
    const ocrLabel = `${condition}_${pos.label}`;
    const ocr = ocrLegibility(filtered, baseline, gx, gy, gw, gh, ocrLabel);

    if (verbose && ocr.baselineWords > 0) {
      console.log(`    ${pos.label} OCR: baseline=[${ocr.baselineList.join(',')}] filtered=[${ocr.filteredList.join(',')}] → ${(ocr.matchRate*100).toFixed(0)}%`);
    }

    return {
      label: pos.label,
      isDense,
      eccDeg: +eccDeg.toFixed(2),
      ssim: +ssim.toFixed(4),
      edgeRatio: +edgeRatio.toFixed(4),
      contrastRatio: +contrastRatio.toFixed(4),
      ocrBaseline: ocr.baselineWords,
      ocrFiltered: ocr.filteredWords,
      ocrMatches: ocr.matches,
      ocrRate: +ocr.matchRate.toFixed(4),
      // Availability now weighted by OCR legibility
      availability: ocr.baselineWords > 0
        ? +ocr.matchRate.toFixed(4)
        : +(Math.pow(ssim * Math.max(edgeRatio, 0.01) * Math.max(contrastRatio, 0.01), 1/3)).toFixed(4),
    };
  });

  return { condition, groups };
}

function printResults(results) {
  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Wave 5: Halverson Mixed-Density Validation');
  console.log('  Prediction: sparse groups show less degradation than dense');
  console.log('══════════════════════════════════════════════════════════════\n');

  for (const result of results) {
    if (!result) continue;

    console.log(`── ${result.condition.toUpperCase()} ──`);
    console.log('  Group  Dense?  Ecc°   SSIM   OCR(base) OCR(filt) OCR%   Legibility');
    console.log('  ─────  ──────  ────   ─────  ───────── ───────── ─────  ──────────');

    for (const g of result.groups) {
      console.log(
        `  ${g.label.padEnd(5)}  ${(g.isDense ? 'dense' : 'sparse').padEnd(6)}  ` +
        `${g.eccDeg.toFixed(1).padStart(4)}   ` +
        `${g.ssim.toFixed(3).padStart(5)}  ` +
        `${String(g.ocrBaseline).padStart(9)} ` +
        `${String(g.ocrFiltered).padStart(9)} ` +
        `${(g.ocrRate * 100).toFixed(0).padStart(5)}  ` +
        `${g.availability.toFixed(3).padStart(10)}`
      );
    }

    // Summary: sparse vs dense comparison (for mixed condition)
    const sparseGroups = result.groups.filter(g => !g.isDense);
    const denseGroups = result.groups.filter(g => g.isDense);

    if (sparseGroups.length > 0 && denseGroups.length > 0) {
      const meanSparse = sparseGroups.reduce((s, g) => s + g.availability, 0) / sparseGroups.length;
      const meanDense = denseGroups.reduce((s, g) => s + g.availability, 0) / denseGroups.length;
      const ratio = meanDense > 0 ? meanSparse / meanDense : 0;

      console.log(`\n  Sparse mean availability: ${meanSparse.toFixed(3)}`);
      console.log(`  Dense mean availability:  ${meanDense.toFixed(3)}`);
      console.log(`  Sparse/Dense ratio:       ${ratio.toFixed(3)}`);
      console.log(`  Prediction (ratio > 1.0): ${ratio > 1.0 ? '✓ PASS' : '✗ FAIL'}`);
    }
    console.log();
  }

  // ── Tier Summary ──
  console.log('── VALIDATION SUMMARY ──');
  console.log();
  console.log('Tier 1 (must pass):');
  console.log('  [T1.1] Sparse availability > dense availability in mixed condition');
  console.log('  [T1.2] Degradation increases with eccentricity (all conditions)');
  console.log('  [T1.3] Dense groups have lower edge preservation ratio');
  console.log();
  console.log('Tier 2 (should pass):');
  console.log('  [T2.1] Sparse/dense availability ratio > 1.2 (matching H&H 90%/50% encoding diff)');
  console.log('  [T2.2] Eccentricity × density interaction: dense degrades faster with eccentricity');
  console.log();
  console.log('Tier 3 (stretch):');
  console.log('  [T3.1] Availability score predicts H&H search order (sparse groups first)');
  console.log('  [T3.2] Availability gradient correlates with H&H saccade distances (r > 0.7)');

  // Run tier checks on mixed condition
  const mixed = results.find(r => r && r.condition === 'mixed');
  if (mixed) {
    const sparse = mixed.groups.filter(g => !g.isDense);
    const dense = mixed.groups.filter(g => g.isDense);
    const meanSparse = sparse.reduce((s, g) => s + g.availability, 0) / sparse.length;
    const meanDense = dense.reduce((s, g) => s + g.availability, 0) / dense.length;

    console.log('\n── TIER RESULTS (mixed condition) ──');
    console.log(`  T1.1 sparse > dense:    ${meanSparse > meanDense ? '✓' : '✗'} (${meanSparse.toFixed(3)} vs ${meanDense.toFixed(3)})`);

    // Check eccentricity monotonicity
    const sorted = [...mixed.groups].sort((a, b) => a.eccDeg - b.eccDeg);
    let monotonic = true;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].availability > sorted[i-1].availability + 0.05) {
        monotonic = false;
        break;
      }
    }
    console.log(`  T1.2 ecc monotonic:     ${monotonic ? '✓' : '~'} (tolerance 0.05)`);

    const meanEdgeSparse = sparse.reduce((s, g) => s + g.edgeRatio, 0) / sparse.length;
    const meanEdgeDense = dense.reduce((s, g) => s + g.edgeRatio, 0) / dense.length;
    console.log(`  T1.3 sparse edge > dense: ${meanEdgeSparse > meanEdgeDense ? '✓' : '✗'} (${(meanEdgeSparse*100).toFixed(1)}% vs ${(meanEdgeDense*100).toFixed(1)}%)`);

    const ratio = meanDense > 0 ? meanSparse / meanDense : 0;
    console.log(`  T2.1 ratio > 1.2:       ${ratio > 1.2 ? '✓' : '✗'} (${ratio.toFixed(3)})`);
  }
}

// ── Main ──

function main() {
  const captureDir = findCaptureDir();
  if (!fs.existsSync(captureDir)) {
    console.error(`Capture directory not found: ${captureDir}`);
    console.error(`Run capture first: node scripts/capture-halverson.js`);
    process.exit(1);
  }

  console.log(`Analyzing captures in: ${captureDir}`);

  const results = [];
  for (const condition of ['sparse', 'dense', 'mixed']) {
    results.push(analyzeCondition(captureDir, condition));
  }

  printResults(results);
}

main();
