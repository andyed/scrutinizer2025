#!/usr/bin/env node
/**
 * AdSERP click-eye alignment test.
 *
 * Validates coordinate conversion by checking that at the moment of click,
 * the nearest fixation in time lands near the clicked element. A well-calibrated
 * conversion should show < 200px mean distance (within ~2-3° visual angle at
 * typical viewing distance).
 *
 * Uses interesting-trials.json for prototypical examples, plus random samples.
 *
 * Usage:
 *   node scripts/test-adserp-alignment.js --data=/path/to/AdSERP/data
 *   node scripts/test-adserp-alignment.js --data=/path/to/AdSERP/data --trial=p004-b1-t1
 */

const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
function getArg(name, def) {
    const a = args.find(x => x.startsWith(`--${name}=`));
    return a ? a.split('=').slice(1).join('=') : def;
}

const dataDir = path.resolve(getArg('data', ''));
const singleTrial = getArg('trial', null);

if (!dataDir || !fs.existsSync(dataDir)) {
    console.error('Error: --data=<path> required (path to AdSERP/data/)');
    process.exit(1);
}

const adserp = require(path.join(__dirname, '..', 'renderer', 'scanpath', 'importers', 'adserp-importer'));

// Load interesting trials if available
let testTrials = [];
const interestingPath = path.join(dataDir, 'interesting-trials.json');
if (singleTrial) {
    testTrials = [singleTrial];
} else if (fs.existsSync(interestingPath)) {
    const interesting = JSON.parse(fs.readFileSync(interestingPath, 'utf8'));
    // Pull prototypical trials
    for (const [tag, info] of Object.entries(interesting.prototypical || {})) {
        if (info.trial_id) testTrials.push(info.trial_id);
    }
    // Also sample some random trials
    const fixDir = path.join(dataDir, 'fixation-data');
    const allTrials = fs.readdirSync(fixDir).filter(f => f.endsWith('.csv')).map(f => f.replace('.csv', ''));
    for (let i = 0; i < 20; i++) {
        const t = allTrials[Math.floor(Math.random() * allTrials.length)];
        if (!testTrials.includes(t)) testTrials.push(t);
    }
} else {
    // Sample 30 random trials
    const fixDir = path.join(dataDir, 'fixation-data');
    const allTrials = fs.readdirSync(fixDir).filter(f => f.endsWith('.csv')).map(f => f.replace('.csv', ''));
    for (let i = 0; i < 30; i++) {
        testTrials.push(allTrials[Math.floor(Math.random() * allTrials.length)]);
    }
}

console.log(`═══ AdSERP Click-Eye Alignment Test ═══\n`);
console.log(`Testing ${testTrials.length} trials\n`);

const results = [];

for (const trialId of testTrials) {
    try {
        const sp = adserp.loadTrial(dataDir, trialId);

        // Find last click event (the choice click)
        const clicks = sp.mouseTimeline.filter(e => e.event === 'click');
        if (clicks.length === 0) {
            console.log(`  ${trialId}: no clicks — skipped`);
            continue;
        }
        const click = clicks[clicks.length - 1];

        // Fixations are in screen-space (scroll-corrected by importer).
        // Mouse clicks are also screen-space. Compare directly.
        // But also check against RAW page-space fixations for comparison.

        // Reload raw data to get page-space fixations for comparison
        const fs2 = require('fs');
        const fixCsv = fs2.readFileSync(path.join(dataDir, 'fixation-data', trialId + '.csv'), 'utf8');
        const fixLines = fixCsv.trim().split('\n').slice(1);
        const rawFixations = fixLines.map(line => {
            const [ts, x, y, d] = line.split(',').map(Number);
            return { absTs: ts, pageX: x, pageY: y, duration: d };
        }).filter(f => isFinite(f.absTs) && isFinite(f.pageX) && isFinite(f.pageY));

        // Find click's absolute timestamp: click.t is relative, so add time origin
        // The importer's fixations are scroll-corrected screen-space.
        // For comparison, find nearest fixation in the scroll-corrected output.
        let bestFix = null, bestTimeDist = Infinity;
        for (const f of sp.fixations) {
            const fixMid = (f.tStart + f.tEnd) / 2;
            const dt = Math.abs(fixMid - click.t);
            if (dt < bestTimeDist) {
                bestTimeDist = dt;
                bestFix = f;
            }
        }

        if (!bestFix || sp.fixations.length === 0) {
            console.log(`  ${trialId}: no fixations — skipped`);
            continue;
        }

        // Compare in screen-space (both click and fixation are screen-space)
        const dx = click.x - bestFix.x;
        const dy = click.y - bestFix.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Check if the click was during a scroll — gaze-click divergence
        // is expected to be larger during scroll (eyes track content, mouse stays)
        const scrollAtClick = sp.scrollTimeline.length > 0;

        const status = dist < 200 ? 'OK' : dist < 400 ? 'WARN' : 'BAD';
        const marker = status === 'OK' ? '✓' : status === 'WARN' ? '~' : '✗';

        console.log(`  ${marker} ${trialId}: click(${click.x.toFixed(0)},${click.y.toFixed(0)}) ` +
            `fix(${bestFix.x.toFixed(0)},${bestFix.y.toFixed(0)}) ` +
            `dist=${dist.toFixed(0)}px dt=${bestTimeDist.toFixed(0)}ms` +
            (scrollAtClick ? ' [scroll]' : ''));

        results.push({ trialId, dist, timeDist: bestTimeDist, scrollAtClick, status });

    } catch (e) {
        console.log(`  ${trialId}: ERROR — ${e.message}`);
    }
}

// Summary
console.log(`\n═══ Summary ═══\n`);

const valid = results.filter(r => r.timeDist < 500); // Only count fixations within 500ms of click
const ok = valid.filter(r => r.status === 'OK').length;
const warn = valid.filter(r => r.status === 'WARN').length;
const bad = valid.filter(r => r.status === 'BAD').length;

if (valid.length > 0) {
    const meanDist = valid.reduce((s, r) => s + r.dist, 0) / valid.length;
    const medianDist = valid.map(r => r.dist).sort((a, b) => a - b)[Math.floor(valid.length / 2)];
    const maxDist = Math.max(...valid.map(r => r.dist));

    console.log(`  Trials tested:  ${results.length}`);
    console.log(`  Within 500ms:   ${valid.length}`);
    console.log(`  Mean distance:  ${meanDist.toFixed(0)}px`);
    console.log(`  Median distance:${medianDist.toFixed(0)}px`);
    console.log(`  Max distance:   ${maxDist.toFixed(0)}px`);
    console.log(`  OK (<200px):    ${ok}  WARN (<400px): ${warn}  BAD (>400px): ${bad}`);
    console.log();

    if (meanDist > 300) {
        console.log(`  ⚠ Mean distance > 300px — coordinate conversion may be wrong`);
        console.log(`  Expected: < 200px mean for well-calibrated conversion`);
    } else if (meanDist < 200) {
        console.log(`  ✓ Alignment looks good (mean < 200px)`);
    }
} else {
    console.log(`  No valid trials (no clicks within 500ms of a fixation)`);
}
