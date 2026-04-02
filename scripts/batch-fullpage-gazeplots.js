#!/usr/bin/env node
/**
 * Batch full-page foveated gazeplots for all prototypical AdSERP trials.
 *
 * Usage:
 *   node scripts/batch-fullpage-gazeplots.js --data=/path/to/AdSERP/data
 */

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
function getArg(name, def) {
    const a = args.find(x => x.startsWith(`--${name}=`));
    return a ? a.split('=').slice(1).join('=') : def;
}

const ROOT = path.join(__dirname, '..');
const dataDir = path.resolve(getArg('data', ''));
const modeId = getArg('mode', '0');

if (!dataDir || !fs.existsSync(dataDir)) {
    console.error('Error: --data=<path> required');
    process.exit(1);
}

// Load interesting trials — deduplicate, skip 0-fixation trials
const interestingPath = path.join(dataDir, 'interesting-trials.json');
if (!fs.existsSync(interestingPath)) {
    console.error('Error: interesting-trials.json not found');
    process.exit(1);
}
const interesting = JSON.parse(fs.readFileSync(interestingPath, 'utf8'));

const seen = new Set();
const trials = [];
for (const [tag, info] of Object.entries(interesting.prototypical)) {
    if (!info.trial_id || seen.has(info.trial_id)) continue;
    if (info.value === 0 && info.metric === 'fixation_count') continue;
    seen.add(info.trial_id);
    trials.push({ tag, ...info });
}

const outputDir = path.join(ROOT, 'output', 'adserp-fullpage-gazeplots');

console.log('═══ Batch Full-Page Gazeplots ═══\n');
console.log(`  Trials: ${trials.length}`);
console.log(`  Mode:   ${modeId}`);
console.log(`  Output: ${outputDir}\n`);

const results = [];
for (const trial of trials) {
    const outFile = path.join(outputDir, `${trial.trial_id}_fullpage_gazeplot.png`);
    console.log(`  [${results.length + 1}/${trials.length}] ${trial.tag}: ${trial.trial_id} — "${trial.query}"`);

    try {
        execFileSync('node', [
            path.join(ROOT, 'scripts', 'capture-fullpage-gazeplot.js'),
            `--data=${dataDir}`,
            `--trial=${trial.trial_id}`,
            `--mode=${modeId}`,
        ], {
            cwd: ROOT,
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 300000, // 5 min per trial
        });

        if (fs.existsSync(outFile)) {
            const sizeMB = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
            console.log(`    ✓ ${sizeMB}MB`);
            results.push({ tag: trial.tag, trialId: trial.trial_id, ok: true });
        } else {
            console.log(`    ✗ no output`);
            results.push({ tag: trial.tag, trialId: trial.trial_id, ok: false });
        }
    } catch (e) {
        console.log(`    ✗ ${e.message.split('\n')[0]}`);
        results.push({ tag: trial.tag, trialId: trial.trial_id, ok: false });
    }
}

const ok = results.filter(r => r.ok).length;
console.log(`\n═══ Done: ${ok}/${results.length} ═══`);
console.log(`  Output: ${outputDir}/`);
