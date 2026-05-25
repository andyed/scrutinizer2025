#!/usr/bin/env node
/**
 * BGRA audit comparison — drives Electron in TEST_MODE on Mode 20
 * (DOM-Aware Text, the only mode where sampleDomAwarePrimitive() fires)
 * to capture before/after frames for the AUDIT(bgra) sites flagged
 * at peripheral.frag:2011 and 2047.
 *
 * Run this twice manually:
 *   node scripts/compare-bgra-audit.js before  # capture with current (broken) code
 *   <apply Fix-B to peripheral.frag>
 *   node scripts/compare-bgra-audit.js after   # capture with fix applied
 *   node scripts/compare-bgra-audit.js diff    # pixel-diff before vs after
 *
 * Output: tests/golden-captures/bgra-audit/{before,after}_*.png + diff_*.png
 */
const path = require('path');
const fs = require('fs');
const { run } = require('./lib/capture-runner');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'tests', 'golden-captures', 'bgra-audit');
const REF_PAGES = `file://${path.join(ROOT, 'tests', 'reference-pages')}`;
const fullVersion = require('../package.json').version;

const PHASE = process.argv[2] || 'before';
if (!['before', 'after', 'diff'].includes(PHASE)) {
    console.error(`Usage: ${path.basename(__filename)} <before|after|diff>`);
    process.exit(2);
}

// Three pages × center-fixation. Mode 20 = DOM-Aware Text — the only mode
// where the audit sites fire. Pages chosen for chromatic non-text primitives
// (ecommerce buttons), pure colour swatches (chroma-uniform), and mixed
// chromatic-text (dashboard).
// Multi-fixation probes — the non-text L_categorical branch only contributes
// at 2-8° eccentricity (wordCoherence band). foveaRadius=45px ≈ 1° → that's
// 90-360px from the gaze. Vary fixation across each page so a chromatic
// primitive falls inside the band.
const PROBES = [
    { page: 'ecommerce.html', label: 'ecommerce_center',   fx: 0.5,  fy: 0.5  },  // baseline (known zero)
    { page: 'ecommerce.html', label: 'ecommerce_filters',  fx: 0.15, fy: 0.35 },  // fixate filter sidebar → products into parafovea
    { page: 'ecommerce.html', label: 'ecommerce_top',      fx: 0.5,  fy: 0.15 },  // fixate header → first row in parafovea
    { page: 'ecommerce.html', label: 'ecommerce_leftprod', fx: 0.27, fy: 0.45 },  // fixate on left product → neighbors in band
    { page: 'dashboard.html', label: 'dashboard_offaxis',  fx: 0.3,  fy: 0.3  },  // off-center on a varied panel layout
];

if (PHASE === 'diff') {
    let totalDiff = 0;
    for (const probe of PROBES) {
        const beforePath = path.join(OUTPUT_DIR, `before_${probe.label}_mode20.png`);
        const afterPath  = path.join(OUTPUT_DIR, `after_${probe.label}_mode20.png`);
        const diffPath   = path.join(OUTPUT_DIR, `diff_${probe.label}_mode20.png`);
        if (!fs.existsSync(beforePath) || !fs.existsSync(afterPath)) {
            console.warn(`SKIP ${probe.label}: missing before/after.`);
            continue;
        }
        const a = PNG.sync.read(fs.readFileSync(beforePath));
        const b = PNG.sync.read(fs.readFileSync(afterPath));
        if (a.width !== b.width || a.height !== b.height) {
            console.warn(`SKIP ${probe.label}: size mismatch (${a.width}x${a.height} vs ${b.width}x${b.height})`);
            continue;
        }
        const out = new PNG({ width: a.width, height: a.height });
        let changed = 0, sumDelta = 0, maxDelta = 0;
        for (let i = 0; i < a.data.length; i += 4) {
            const dr = Math.abs(a.data[i]     - b.data[i]);
            const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
            const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
            const d = dr + dg + db;
            // Visualise: amplified, red where pixels moved; faded grey elsewhere
            if (d > 6) {
                changed++;
                sumDelta += d;
                if (d > maxDelta) maxDelta = d;
                out.data[i]     = Math.min(255, 64 + d * 2);
                out.data[i + 1] = 0;
                out.data[i + 2] = 0;
            } else {
                const grey = Math.round((a.data[i] + a.data[i + 1] + a.data[i + 2]) / 12);
                out.data[i] = out.data[i + 1] = out.data[i + 2] = grey;
            }
            out.data[i + 3] = 255;
        }
        const totalPx = a.width * a.height;
        const pct = (100 * changed / totalPx).toFixed(2);
        const meanD = changed ? (sumDelta / changed).toFixed(1) : 0;
        fs.writeFileSync(diffPath, PNG.sync.write(out));
        console.log(`${probe.label.padEnd(16)} changed=${pct}% (${changed}/${totalPx}px)  meanΔ=${meanD}  maxΔ=${maxDelta}  → ${path.basename(diffPath)}`);
        totalDiff += changed;
    }
    if (totalDiff === 0) {
        console.log('\n→ No pixel differences. Either the fix is a no-op for these pages, or capture is non-deterministic.');
    }
    return;
}

const specs = PROBES.map(probe => ({
    filename: `${PHASE}_${probe.label}_mode20.png`,
    url: `${REF_PAGES}/${probe.page}`,
    mode: '20',
    fixationX: probe.fx, fixationY: probe.fy,
    selector: '', overlay: false,
    radius: '45', width: '1920', height: '1080', mobile: 'false',
}));

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
console.log(`Capturing PHASE=${PHASE} → ${OUTPUT_DIR}`);
run(specs, { outputDir: OUTPUT_DIR, appVersion: fullVersion, force: true })
    .then(result => {
        console.log(`OK: captured=${result.captured} skipped=${result.skipped} failed=${result.failed}`);
        if (result.failed > 0) process.exit(1);
    })
    .catch(err => { console.error(err); process.exit(1); });
