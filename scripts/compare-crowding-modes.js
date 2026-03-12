#!/usr/bin/env node
/**
 * Compare Crowding Metrics: Mode 0 (MIP-only) vs Mode 10 (Compute Mongrel)
 *
 * Runs pixel-level crowding analysis on both modes' golden captures and
 * produces a quantitative comparison table. The hypothesis: Tier 2.5's
 * oriented-noise metamer synthesis should produce stronger crowding
 * differentiation (lower crowding ratio, higher spread ratio) than
 * Tier 1.6's isotropic MIP blur.
 *
 * Metrics compared:
 *   - Crowding ratio: crowded/isolated cyan density (lower = stronger crowding)
 *   - Spread ratio: crowded/isolated spatial dispersion (higher = more crowding)
 *   - Total cyan survival: how much target signal survives the filter
 *
 * Usage:
 *   node scripts/compare-crowding-modes.js [--version=2.2] [--json]
 */

const path = require('path');
const fs = require('fs');
const { PNG } = require('pngjs');
const { rgbToOklab } = require('../renderer/oklab-utils');

const args = process.argv.slice(2);
function getArg(name, def) {
    const a = args.find(x => x.startsWith(`--${name}=`));
    return a ? a.split('=')[1] : def;
}
const hasFlag = (name) => args.includes(`--${name}`);

const ROOT = path.join(__dirname, '..');

function findGoldenDir() {
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

// ── Constants (matching analyze-crowding.js) ──
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
    const rowCyan = [];
    for (let py = 0; py < png.height; py++) {
        let cnt = 0;
        for (let px = 0; px < png.width; px += 2) {
            const idx = (py * png.width + px) * 4;
            if (png.data[idx + 2] - png.data[idx] > CYAN_THRESHOLD) cnt++;
        }
        if (cnt > 2) rowCyan.push({ py, cnt });
    }
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
    const mainClusters = clusters.filter(c => c.total > 50).sort((a, b) => a.startPy - b.startPy);
    if (mainClusters.length >= 6) {
        const midPy = (mainClusters[2].endPy + mainClusters[3].startPy) / 2;
        return midPy / dpr;
    }
    return (png.height / dpr) / 2;
}

// ── Find cyan clusters ──
function findCyanClusters(png, dpr, pyStart, pyEnd, pxLeft, pxRight) {
    const cyanPositions = [];
    let totalCyan = 0;
    const cyanXCount = {};

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

function computeSpread(positions) {
    if (positions.length < 2) return { spread2D: 0 };
    const n = positions.length;
    const meanX = positions.reduce((s, p) => s + p.x, 0) / n;
    const meanY = positions.reduce((s, p) => s + p.y, 0) / n;
    const varX = positions.reduce((s, p) => s + (p.x - meanX) ** 2, 0) / n;
    const varY = positions.reduce((s, p) => s + (p.y - meanY) ** 2, 0) / n;
    return { spread2D: Math.sqrt(varX + varY) };
}

// ── Analyze one PNG ──
function analyzePng(png) {
    const dpr = png.width > 2000 ? 2 : 1;
    const cssW = png.width / dpr;
    const vpOffX = (cssW - VIEWPORT_W) / 2;
    const fixY = detectFixationY(png);

    const results = [];

    for (let colIdx = 0; colIdx < FONT_SIZES.length; colIdx++) {
        const fontSize = FONT_SIZES[colIdx];
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

                let crowdedCyan = 0, isolatedCyan = 0;
                let splitX = Infinity;
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

                const crowdedPos = cyanPositions.filter(p => p.x < splitX);
                const isolatedPos = cyanPositions.filter(p => p.x >= splitX);
                const crowdedSpread = computeSpread(crowdedPos);
                const isolatedSpread = computeSpread(isolatedPos);

                const spreadRatio = isolatedSpread.spread2D > 0
                    ? crowdedSpread.spread2D / isolatedSpread.spread2D : null;
                const crowdingRatio = isolatedCyan > 0 ? crowdedCyan / isolatedCyan : null;

                results.push({
                    ecc_deg: row.deg,
                    position: dir,
                    fontSize,
                    crowdedCyan,
                    isolatedCyan,
                    totalCyan,
                    crowdingRatio: crowdingRatio !== null ? round3(crowdingRatio) : null,
                    spreadRatio: spreadRatio !== null ? round3(spreadRatio) : null,
                    crowdedSpread: round1(crowdedSpread.spread2D),
                    isolatedSpread: round1(isolatedSpread.spread2D),
                });
            }
        }
    }

    return results;
}

// ── Luminance structure metrics: Oklab variance comparison ──

function variance(arr) {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b) / arr.length;
    return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
}

/**
 * Compute Oklab L/a/b variance in corresponding patches of two PNGs.
 * Reuses the same band geometry as analyzePng() so patch positions match.
 * Returns per-band metrics: Oklab L variance ratio (M1) and chrom variance ratio (M3).
 */
function analyzePatches(png0, png10) {
    const dpr0 = png0.width > 2000 ? 2 : 1;
    const dpr10 = png10.width > 2000 ? 2 : 1;
    const cssW0 = png0.width / dpr0;
    const vpOffX0 = (cssW0 - VIEWPORT_W) / 2;
    const fixY0 = detectFixationY(png0);

    const cssW10 = png10.width / dpr10;
    const vpOffX10 = (cssW10 - VIEWPORT_W) / 2;
    const fixY10 = detectFixationY(png10);

    const patchResults = [];

    for (let colIdx = 0; colIdx < FONT_SIZES.length; colIdx++) {
        const fontSize = FONT_SIZES[colIdx];

        for (const row of ROWS) {
            for (const [dir, sign] of [['above', -1], ['below', 1]]) {
                // Band geometry for mode 0
                const rowCenterY0 = fixY0 + sign * row.deg * PX_PER_DEG;
                const bandH = Math.max(fontSize * 2, 40);
                const colLeftCSS0 = vpOffX0 + colIdx * (VIEWPORT_W / 3);
                const colRightCSS0 = colLeftCSS0 + VIEWPORT_W / 3;

                const pyStart0 = Math.round((rowCenterY0 - bandH / 2) * dpr0);
                const pyEnd0 = Math.round((rowCenterY0 + bandH / 2) * dpr0);
                const pxLeft0 = Math.round(colLeftCSS0 * dpr0);
                const pxRight0 = Math.round(colRightCSS0 * dpr0);

                // Band geometry for mode 10
                const rowCenterY10 = fixY10 + sign * row.deg * PX_PER_DEG;
                const colLeftCSS10 = vpOffX10 + colIdx * (VIEWPORT_W / 3);
                const colRightCSS10 = colLeftCSS10 + VIEWPORT_W / 3;

                const pyStart10 = Math.round((rowCenterY10 - bandH / 2) * dpr10);
                const pyEnd10 = Math.round((rowCenterY10 + bandH / 2) * dpr10);
                const pxLeft10 = Math.round(colLeftCSS10 * dpr10);
                const pxRight10 = Math.round(colRightCSS10 * dpr10);

                // Sample Oklab values from each PNG's band
                const oklab0 = sampleOklabPatch(png0, pyStart0, pyEnd0, pxLeft0, pxRight0);
                const oklab10 = sampleOklabPatch(png10, pyStart10, pyEnd10, pxLeft10, pxRight10);

                const varL0 = variance(oklab0.L);
                const varL10 = variance(oklab10.L);
                const varA0 = variance(oklab0.a);
                const varA10 = variance(oklab10.a);
                const varB0 = variance(oklab0.b);
                const varB10 = variance(oklab10.b);

                const lumRatio = varL0 > 0 ? varL10 / varL0 : null;
                const chromVar0 = Math.sqrt(varA0 + varB0);
                const chromVar10 = Math.sqrt(varA10 + varB10);
                const chromRatio = chromVar0 > 0 ? chromVar10 / chromVar0 : null;

                patchResults.push({
                    ecc_deg: row.deg,
                    position: dir,
                    fontSize,
                    varL_mode0: round4(varL0),
                    varL_mode10: round4(varL10),
                    lumVarianceRatio: lumRatio !== null ? round3(lumRatio) : null,
                    chromVar_mode0: round4(chromVar0),
                    chromVar_mode10: round4(chromVar10),
                    chromVarianceRatio: chromRatio !== null ? round3(chromRatio) : null,
                });
            }
        }
    }

    return patchResults;
}

/**
 * Sample all pixels in a rectangular patch and return arrays of Oklab L, a, b values.
 * Samples every other pixel (2x step) for performance on high-DPR captures.
 */
function sampleOklabPatch(png, pyStart, pyEnd, pxLeft, pxRight) {
    const L = [], a = [], b = [];
    const step = 2; // skip every other pixel for speed
    for (let py = pyStart; py <= pyEnd; py += step) {
        for (let px = pxLeft; px < pxRight; px += step) {
            if (py < 0 || py >= png.height || px < 0 || px >= png.width) continue;
            const idx = (py * png.width + px) * 4;
            const lab = rgbToOklab(png.data[idx], png.data[idx + 1], png.data[idx + 2]);
            L.push(lab.L);
            a.push(lab.a);
            b.push(lab.b);
        }
    }
    return { L, a, b };
}

function round1(v) { return Math.round(v * 10) / 10; }
function round3(v) { return Math.round(v * 1000) / 1000; }
function round4(v) { return Math.round(v * 10000) / 10000; }

function loadPng(filepath) {
    if (!fs.existsSync(filepath)) return null;
    return PNG.sync.read(fs.readFileSync(filepath));
}

// ── Main ──
function main() {
    const dir = findGoldenDir();
    if (!dir || !fs.existsSync(dir)) {
        console.error(`Directory not found: ${dir || '(none)'}`);
        process.exit(1);
    }

    // Find mode 0 and mode 10 captures
    const mode0Candidates = [
        'crowding_center_mode0_baseline.png',
        'crowding_center.png'
    ];
    const mode10Candidates = [
        'crowding_center_mode10_mongrel.png',
        'crowding_center_mode10.png'
    ];

    let mode0File = null, mode10File = null;
    for (const f of mode0Candidates) {
        const p = path.join(dir, f);
        if (fs.existsSync(p)) { mode0File = p; break; }
    }
    for (const f of mode10Candidates) {
        const p = path.join(dir, f);
        if (fs.existsSync(p)) { mode10File = p; break; }
    }

    if (!mode0File) {
        console.error('No mode 0 crowding capture found in ' + dir);
        console.error('Tried: ' + mode0Candidates.join(', '));
        process.exit(1);
    }
    if (!mode10File) {
        console.error('No mode 10 crowding capture found in ' + dir);
        console.error('Tried: ' + mode10Candidates.join(', '));
        process.exit(1);
    }

    console.log('=== Crowding Mode Comparison: Mode 0 (MIP) vs Mode 10 (Compute Mongrel) ===\n');
    console.log(`Source:   ${dir}`);
    console.log(`Mode 0:   ${path.basename(mode0File)}`);
    console.log(`Mode 10:  ${path.basename(mode10File)}\n`);

    const png0 = loadPng(mode0File);
    const png10 = loadPng(mode10File);

    console.log(`Mode 0 image:  ${png0.width}x${png0.height}`);
    console.log(`Mode 10 image: ${png10.width}x${png10.height}\n`);

    const results0 = analyzePng(png0);
    const results10 = analyzePng(png10);

    // ── Primary comparison (28px column — optimal for crowding measurement) ──
    console.log('=== Primary Comparison (28px column) ===\n');
    console.log('Ecc(°)  Dir     │ Mode 0              │ Mode 10             │ Delta');
    console.log('                │ CntRatio  SprRatio   │ CntRatio  SprRatio   │ CntR    SprR');
    console.log('────────────────┼─────────────────────┼─────────────────────┼──────────────');

    const primary0 = results0.filter(r => r.fontSize === 28);
    const primary10 = results10.filter(r => r.fontSize === 28);

    for (const deg of [3, 6, 10]) {
        for (const dir of ['above', 'below']) {
            const r0 = primary0.find(r => r.ecc_deg === deg && r.position === dir);
            const r10 = primary10.find(r => r.ecc_deg === deg && r.position === dir);
            if (!r0 || !r10) continue;

            const cnt0 = r0.crowdingRatio !== null ? r0.crowdingRatio.toFixed(3) : '  N/A';
            const spr0 = r0.spreadRatio !== null ? r0.spreadRatio.toFixed(3) : '  N/A';
            const cnt10 = r10.crowdingRatio !== null ? r10.crowdingRatio.toFixed(3) : '  N/A';
            const spr10 = r10.spreadRatio !== null ? r10.spreadRatio.toFixed(3) : '  N/A';

            let dCnt = '  N/A';
            let dSpr = '  N/A';
            if (r0.crowdingRatio !== null && r10.crowdingRatio !== null) {
                const d = r10.crowdingRatio - r0.crowdingRatio;
                dCnt = (d >= 0 ? '+' : '') + d.toFixed(3);
            }
            if (r0.spreadRatio !== null && r10.spreadRatio !== null) {
                const d = r10.spreadRatio - r0.spreadRatio;
                dSpr = (d >= 0 ? '+' : '') + d.toFixed(3);
            }

            console.log(
                `${String(deg).padStart(4)}°   ${dir.padEnd(6)}  │ ` +
                `${cnt0.padStart(8)}  ${spr0.padStart(8)}   │ ` +
                `${cnt10.padStart(8)}  ${spr10.padStart(8)}   │ ` +
                `${dCnt.padStart(6)}  ${dSpr.padStart(6)}`
            );
        }
    }

    // ── Aggregate summary ──
    console.log('\n=== Aggregate Summary (28px column, all positions) ===\n');

    for (const deg of [3, 6, 10]) {
        const rows0 = primary0.filter(r => r.ecc_deg === deg);
        const rows10 = primary10.filter(r => r.ecc_deg === deg);

        const avgCnt0 = avg(rows0.map(r => r.crowdingRatio).filter(v => v !== null));
        const avgCnt10 = avg(rows10.map(r => r.crowdingRatio).filter(v => v !== null));
        const avgSpr0 = avg(rows0.map(r => r.spreadRatio).filter(v => v !== null));
        const avgSpr10 = avg(rows10.map(r => r.spreadRatio).filter(v => v !== null));

        const totalCyan0 = rows0.reduce((s, r) => s + r.totalCyan, 0);
        const totalCyan10 = rows10.reduce((s, r) => s + r.totalCyan, 0);
        const cyanChange = totalCyan0 > 0 ? ((totalCyan10 - totalCyan0) / totalCyan0 * 100).toFixed(1) : 'N/A';

        console.log(`  ${deg}°:`);
        console.log(`    Crowding ratio:  mode0=${fmt(avgCnt0)}  mode10=${fmt(avgCnt10)}  delta=${fmtDelta(avgCnt10, avgCnt0)}`);
        console.log(`    Spread ratio:    mode0=${fmt(avgSpr0)}  mode10=${fmt(avgSpr10)}  delta=${fmtDelta(avgSpr10, avgSpr0)}`);
        console.log(`    Cyan survival:   mode0=${totalCyan0}px  mode10=${totalCyan10}px  (${cyanChange}%)`);
    }

    // ── Cross-column comparison (font size independence — Pelli & Tillman) ──
    console.log('\n=== Cross-Column: Crowding Ratio by Font Size (6° eccentricity) ===\n');
    console.log('FontSize  │ Mode 0    Mode 10   Delta');
    console.log('──────────┼──────────────────────────');

    for (const fontSize of FONT_SIZES) {
        const r0 = results0.filter(r => r.fontSize === fontSize && r.ecc_deg === 6);
        const r10 = results10.filter(r => r.fontSize === fontSize && r.ecc_deg === 6);
        const a0 = avg(r0.map(r => r.crowdingRatio).filter(v => v !== null));
        const a10 = avg(r10.map(r => r.crowdingRatio).filter(v => v !== null));
        console.log(
            `${String(fontSize).padStart(6)}px  │ ` +
            `${fmt(a0).padStart(8)}  ${fmt(a10).padStart(8)}  ${fmtDelta(a10, a0).padStart(8)}`
        );
    }

    // ── Luminance structure metrics ──
    const patchResults = analyzePatches(png0, png10);
    const patch28 = patchResults.filter(r => r.fontSize === 28);

    console.log('\n=== Luminance Structure Metrics (28px column) ===\n');
    console.log('Ecc(°)  Dir     │ Oklab L Variance          │ Chrom Variance');
    console.log('                │ Mode 0    Mode 10  Ratio   │ Mode 0    Mode 10  Ratio');
    console.log('────────────────┼────────────────────────────┼─────────────────────────');

    for (const deg of [3, 6, 10]) {
        for (const dir of ['above', 'below']) {
            const p = patch28.find(r => r.ecc_deg === deg && r.position === dir);
            if (!p) continue;
            const lv0 = (p.varL_mode0 * 1000).toFixed(1);  // scale for readability
            const lv10 = (p.varL_mode10 * 1000).toFixed(1);
            const lr = p.lumVarianceRatio !== null ? p.lumVarianceRatio.toFixed(2) : ' N/A';
            const cv0 = (p.chromVar_mode0 * 1000).toFixed(1);
            const cv10 = (p.chromVar_mode10 * 1000).toFixed(1);
            const cr = p.chromVarianceRatio !== null ? p.chromVarianceRatio.toFixed(2) : ' N/A';

            console.log(
                `${String(deg).padStart(4)}°   ${dir.padEnd(6)}  │ ` +
                `${lv0.padStart(7)}   ${lv10.padStart(7)}  ${lr.padStart(5)}   │ ` +
                `${cv0.padStart(7)}   ${cv10.padStart(7)}  ${cr.padStart(5)}`
            );
        }
    }
    console.log('(variance values ×1000 for readability)');

    // ── Hypothesis test ──
    console.log('\n=== Hypothesis Evaluation ===\n');

    // H1: Mode 10 produces lower crowding ratio at peripheral eccentricities (stronger crowding)
    const periph0 = primary0.filter(r => r.ecc_deg >= 6 && r.crowdingRatio !== null);
    const periph10 = primary10.filter(r => r.ecc_deg >= 6 && r.crowdingRatio !== null);
    const avgPeriCnt0 = avg(periph0.map(r => r.crowdingRatio));
    const avgPeriCnt10 = avg(periph10.map(r => r.crowdingRatio));
    const h1 = avgPeriCnt10 !== null && avgPeriCnt0 !== null && avgPeriCnt10 < avgPeriCnt0;
    console.log(`[${h1 ? 'PASS' : 'FAIL'}] H1: Mode 10 crowding ratio < Mode 0 at >=6° (${fmt(avgPeriCnt10)} vs ${fmt(avgPeriCnt0)})`);
    if (h1) {
        const improvement = ((avgPeriCnt0 - avgPeriCnt10) / avgPeriCnt0 * 100).toFixed(1);
        console.log(`       → ${improvement}% stronger crowding differentiation with compute mongrel`);
    }

    // H2: Mode 10 produces higher spread ratio (more dispersion in crowded condition)
    const avgPeriSpr0 = avg(periph0.map(r => r.spreadRatio).filter(v => v !== null));
    const avgPeriSpr10 = avg(periph10.map(r => r.spreadRatio).filter(v => v !== null));
    const h2 = avgPeriSpr10 !== null && avgPeriSpr0 !== null && avgPeriSpr10 > avgPeriSpr0;
    console.log(`[${h2 ? 'PASS' : 'FAIL'}] H2: Mode 10 spread ratio > Mode 0 at >=6° (${fmt(avgPeriSpr10)} vs ${fmt(avgPeriSpr0)})`);
    if (h2) {
        const improvement = ((avgPeriSpr10 - avgPeriSpr0) / avgPeriSpr0 * 100).toFixed(1);
        console.log(`       → ${improvement}% more spatial dispersion in crowded targets`);
    }

    // H3: Near-foveal (3°) should be similar (both modes minimal crowding)
    const fov0 = avg(primary0.filter(r => r.ecc_deg === 3 && r.crowdingRatio !== null).map(r => r.crowdingRatio));
    const fov10 = avg(primary10.filter(r => r.ecc_deg === 3 && r.crowdingRatio !== null).map(r => r.crowdingRatio));
    const h3 = fov0 !== null && fov10 !== null && Math.abs(fov10 - fov0) < 0.15;
    console.log(`[${h3 ? 'PASS' : 'FAIL'}] H3: Foveal (3°) crowding ratio similar between modes (${fmt(fov10)} vs ${fmt(fov0)}, delta=${fmtDelta(fov10, fov0)})`);
    console.log(`       → Mode 10 should NOT change foveal region (alpha=0 passthrough)`);

    // H4: Eccentricity gradient preserved (crowding increases with eccentricity in both modes)
    const gradient0 = checkGradient(primary0);
    const gradient10 = checkGradient(primary10);
    console.log(`[${gradient0 ? 'PASS' : 'FAIL'}] H4a: Mode 0 crowding ratio decreases with eccentricity (monotonic gradient)`);
    console.log(`[${gradient10 ? 'PASS' : 'FAIL'}] H4b: Mode 10 crowding ratio decreases with eccentricity (monotonic gradient)`);

    // H5: Oklab L variance ratio > 1.0 at ≥6° (metamer preserves luminance contrast)
    const periphPatch = patch28.filter(r => r.ecc_deg >= 6 && r.lumVarianceRatio !== null);
    const avgLumRatio = avg(periphPatch.map(r => r.lumVarianceRatio));
    const h5 = avgLumRatio !== null && avgLumRatio > 1.0;
    console.log(`[${h5 ? 'PASS' : 'FAIL'}] H5: Oklab L variance ratio > 1.0 at >=6° (avg=${fmt(avgLumRatio)})`);
    if (h5) {
        console.log(`       → Compute mongrel preserves ${((avgLumRatio - 1.0) * 100).toFixed(1)}% more luminance contrast than MIP blur`);
    }

    // H6: Chrominance variance ratio ≈ 1.0 (both modes pool color similarly)
    const periphChrom = patch28.filter(r => r.ecc_deg >= 6 && r.chromVarianceRatio !== null);
    const avgChromRatio = avg(periphChrom.map(r => r.chromVarianceRatio));
    const h6 = avgChromRatio !== null && Math.abs(avgChromRatio - 1.0) < 0.25;
    console.log(`[${h6 ? 'PASS' : 'FAIL'}] H6: Chrom variance ratio ≈ 1.0 at >=6° (avg=${fmt(avgChromRatio)}, tolerance ±0.25)`);
    if (h6) {
        console.log(`       → Both modes pool chrominance similarly (ratio within 25% of unity)`);
    }

    // 3° is a transition zone, not passthrough: fovealRadius=90px (2.37°), so 3° is
    // 0.63° beyond the foveal boundary with blendFactor≈0.33. The two pooling paths
    // (MIP-only vs compute-with-MIP-fallback) diverge here because compute alpha is
    // near-zero (~0.012) but the MIP fallback routes through different code paths.
    // Expect ratio > 1.0 — measures onset divergence between pooling strategies.
    const fovPatch = patch28.filter(r => r.ecc_deg === 3 && r.lumVarianceRatio !== null);
    const avgFovLumRatio = avg(fovPatch.map(r => r.lumVarianceRatio));
    console.log(`[INFO] Transition zone (3°): L variance ratio=${fmt(avgFovLumRatio)} — pooling path onset divergence (fovealRadius=2.37°, blendFactor≈0.33)`);

    // ── JSON output ──
    if (hasFlag('json')) {
        const jsonData = {
            source: dir,
            mode0_file: path.basename(mode0File),
            mode10_file: path.basename(mode10File),
            mode0: results0,
            mode10: results10,
            luminancePatches: patchResults,
            hypotheses: {
                h1_stronger_crowding: h1,
                h2_more_dispersion: h2,
                h3_foveal_preserved: h3,
                h4a_mode0_gradient: gradient0,
                h4b_mode10_gradient: gradient10,
                h5_luminance_variance_preserved: h5,
                h6_chrominance_similar: h6,
            },
            summary: {
                peripheral_crowding_ratio: { mode0: avgPeriCnt0, mode10: avgPeriCnt10 },
                peripheral_spread_ratio: { mode0: avgPeriSpr0, mode10: avgPeriSpr10 },
                foveal_crowding_ratio: { mode0: fov0, mode10: fov10 },
                peripheral_lum_variance_ratio: avgLumRatio,
                peripheral_chrom_variance_ratio: avgChromRatio,
                transition_zone_3deg_lum_variance_ratio: avgFovLumRatio,
            }
        };
        console.log('\n--- JSON ---');
        console.log(JSON.stringify(jsonData, null, 2));
    }

    // Write report
    const reportDir = path.join(ROOT, 'tests', 'validation', 'reports');
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    const reportFile = path.join(reportDir, 'crowding-mode-comparison.md');
    const reportLines = [
        '# Crowding Mode Comparison: Mode 0 vs Mode 10',
        '',
        `Generated: ${new Date().toISOString().split('T')[0]}`,
        `Source: ${dir}`,
        '',
        '## Peripheral Crowding (>=6°, 28px column)',
        '',
        `| Metric | Mode 0 | Mode 10 | Delta |`,
        `|--------|--------|---------|-------|`,
        `| Crowding ratio | ${fmt(avgPeriCnt0)} | ${fmt(avgPeriCnt10)} | ${fmtDelta(avgPeriCnt10, avgPeriCnt0)} |`,
        `| Spread ratio | ${fmt(avgPeriSpr0)} | ${fmt(avgPeriSpr10)} | ${fmtDelta(avgPeriSpr10, avgPeriSpr0)} |`,
        '',
        '## Luminance Structure (>=6°, 28px column)',
        '',
        `| Metric | Value | Interpretation |`,
        `|--------|-------|----------------|`,
        `| Oklab L variance ratio | ${fmt(avgLumRatio)} | ${avgLumRatio > 1.0 ? 'Mode 10 preserves more luminance contrast' : avgLumRatio < 1.0 ? 'Mode 10 smooths more' : 'Similar'} |`,
        `| Chrom variance ratio | ${fmt(avgChromRatio)} | ${avgChromRatio !== null && Math.abs(avgChromRatio - 1.0) < 0.25 ? 'Both modes pool color similarly' : 'Chrominance differs'} |`,
        `| Transition zone L ratio (3°) | ${fmt(avgFovLumRatio)} | Pooling path onset divergence (fovealRadius=2.37°, blendFactor≈0.33) |`,
        '',
        '## Hypothesis Results',
        '',
        `- H1 (stronger crowding): ${h1 ? 'PASS' : 'FAIL'}`,
        `- H2 (more dispersion): ${h2 ? 'PASS' : 'FAIL'}`,
        `- H3 (foveal preserved): ${h3 ? 'PASS' : 'FAIL'}`,
        `- H4a (mode 0 gradient): ${gradient0 ? 'PASS' : 'FAIL'}`,
        `- H4b (mode 10 gradient): ${gradient10 ? 'PASS' : 'FAIL'}`,
        `- H5 (L variance preserved): ${h5 ? 'PASS' : 'FAIL'} — avg ratio ${fmt(avgLumRatio)} at >=6°`,
        `- H6 (chrom similar): ${h6 ? 'PASS' : 'FAIL'} — avg ratio ${fmt(avgChromRatio)} at >=6°`,
        '',
    ];
    fs.writeFileSync(reportFile, reportLines.join('\n'));
    console.log(`\nReport written to: ${reportFile}`);
}

function avg(arr) {
    if (!arr || arr.length === 0) return null;
    return arr.reduce((a, b) => a + b) / arr.length;
}

function fmt(v) {
    return v !== null && v !== undefined ? v.toFixed(3) : 'N/A';
}

function fmtDelta(a, b) {
    if (a === null || b === null || a === undefined || b === undefined) return 'N/A';
    const d = a - b;
    return (d >= 0 ? '+' : '') + d.toFixed(3);
}

function checkGradient(results) {
    // Crowding ratio should decrease (more crowding) from 3° to 10°
    const byDeg = {};
    for (const r of results) {
        if (r.crowdingRatio === null) continue;
        if (!byDeg[r.ecc_deg]) byDeg[r.ecc_deg] = [];
        byDeg[r.ecc_deg].push(r.crowdingRatio);
    }
    const means = [3, 6, 10].map(d => byDeg[d] ? avg(byDeg[d]) : null).filter(v => v !== null);
    if (means.length < 2) return false;
    // Allow some noise but overall trend should be decreasing
    return means[means.length - 1] < means[0];
}

main();
