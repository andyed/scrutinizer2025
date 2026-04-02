#!/usr/bin/env node
/**
 * Generate gazeplots for all prototypical AdSERP trials.
 *
 * Reads interesting-trials.json to find the prototypical trial for each
 * behavioral tag, then generates a gazeplot (visual memory accumulation)
 * capture for each.
 *
 * Usage:
 *   node scripts/batch-adserp-gazeplots.js --data=/path/to/AdSERP/data
 *   node scripts/batch-adserp-gazeplots.js --data=/path/to/AdSERP/data --mode=0
 */

const { spawn } = require('child_process');
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

// Load interesting trials
const interestingPath = path.join(dataDir, 'interesting-trials.json');
if (!fs.existsSync(interestingPath)) {
    console.error('Error: interesting-trials.json not found in data directory');
    process.exit(1);
}
const interesting = JSON.parse(fs.readFileSync(interestingPath, 'utf8'));

// Deduplicate prototypical trials
const seen = new Set();
const trials = [];
for (const [tag, info] of Object.entries(interesting.prototypical)) {
    if (!info.trial_id || seen.has(info.trial_id)) continue;
    // Skip trials with 0 fixations
    if (info.value === 0 && info.metric === 'fixation_count') continue;
    seen.add(info.trial_id);
    trials.push({ tag, ...info });
}

const outputDir = path.join(ROOT, 'output', 'adserp-gazeplots');
fs.mkdirSync(outputDir, { recursive: true });

console.log('═══ AdSERP Gazeplot Batch ═══\n');
console.log(`  Trials: ${trials.length}`);
console.log(`  Mode:   ${modeId}`);
console.log(`  Output: ${outputDir}\n`);

for (const t of trials) {
    console.log(`  ${t.tag}: ${t.trial_id} — "${t.query}" (${t.metric}=${t.value})`);
}
console.log();

// Run gazeplots sequentially
async function runGazeplot(trial) {
    return new Promise((resolve) => {
        const child = spawn('node', [
            path.join(ROOT, 'scripts', 'replay-adserp.js'),
            `--trial=${trial.trial_id}`,
            `--data=${dataDir}`,
            `--mode=${modeId}`,
            '--gazeplot',
        ], {
            cwd: ROOT,
            stdio: 'pipe',
            env: process.env,
        });

        let stdout = '';
        child.stdout.on('data', d => { stdout += d.toString(); });
        child.stderr.on('data', d => { stdout += d.toString(); });

        child.on('close', (code) => {
            // Find the screenshot in golden-captures and move to output dir
            const packageVersion = require(path.join(ROOT, 'package.json')).version.replace(/\.\d+$/, '');
            const filename = `adserp_${trial.trial_id}_mode${modeId}_gazeplot.png`;
            const src = path.join(ROOT, 'tests', 'golden-captures', `v${packageVersion}`, filename);
            const dest = path.join(outputDir, `${trial.tag}_${trial.trial_id}_gazeplot.png`);

            if (fs.existsSync(src)) {
                fs.copyFileSync(src, dest);
                console.log(`  ✓ ${trial.tag}: ${dest}`);
                resolve({ tag: trial.tag, trialId: trial.trial_id, screenshot: dest, ok: true });
            } else {
                // Check stdout for clues
                const errMatch = stdout.match(/Error:.*/);
                console.log(`  ✗ ${trial.tag}: capture failed` + (errMatch ? ` — ${errMatch[0]}` : ''));
                resolve({ tag: trial.tag, trialId: trial.trial_id, ok: false });
            }
        });
    });
}

async function main() {
    const results = [];
    for (const trial of trials) {
        console.log(`  Generating ${trial.tag} (${trial.trial_id})...`);
        const result = await runGazeplot(trial);
        results.push(result);
    }

    // Summary
    const ok = results.filter(r => r.ok).length;
    console.log(`\n═══ Done: ${ok}/${results.length} gazeplots ═══`);
    console.log(`  Output: ${outputDir}/`);

    // Write manifest
    fs.writeFileSync(
        path.join(outputDir, 'manifest.json'),
        JSON.stringify({ mode: modeId, generated: new Date().toISOString(), results }, null, 2)
    );
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
