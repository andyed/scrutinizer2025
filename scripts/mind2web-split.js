#!/usr/bin/env node
/**
 * Mind2Web held-out split generator.
 *
 * Reads Arm-0 config for seed + fractions, walks the corpus at
 * ~/Documents/dev/Mind2Web/data/data/train/*.json, and emits a
 * website-hash-stratified dev/eval split to data/mind2web-split.json.
 *
 * Stratification: websites are deterministically ordered by
 * SHA256(seed + website) and greedily filled into dev until the task-count
 * fraction matches `dev_fraction`. No website can straddle.
 *
 * Per-primitive action counts in dev/eval are computed so the downstream
 * gate (bin-2 bootstrap N per primary primitive) can be verified.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PRIMARY_PRIMITIVES = ['button', 'link', 'form_input'];

// Same mapping used by the distribution peek. Must match for stats to align.
function mapTagToPrimitive(tag) {
    if (tag === 'button') return 'button';
    if (tag === 'a' || tag === 'link') return 'link';
    if (['textbox', 'combobox', 'checkbox', 'searchbox', 'input', 'select', 'option', 'radio'].includes(tag)) return 'form_input';
    if (['img', 'svg', 'path', 'icon'].includes(tag)) return 'icon_image';
    if (['tab', 'menuitem', 'nav'].includes(tag)) return 'nav_item';
    if (['heading', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) return 'heading';
    return 'other';
}

function parseActionRepr(repr) {
    const m = repr.match(/^\[([^\]]+)\]/);
    return m ? m[1] : null;
}

// Summarize one task into {website, n_actions, per_primitive_counts}.
// Does not retain raw_html or candidate attributes — keeps memory lean.
function summarizeTask(task) {
    const perPrim = {};
    for (const ar of (task.action_reprs || [])) {
        const tag = parseActionRepr(ar);
        if (!tag) continue;
        const prim = mapTagToPrimitive(tag);
        perPrim[prim] = (perPrim[prim] || 0) + 1;
    }
    return {
        website: task.website,
        annotation_id: task.annotation_id,
        n_actions: (task.action_reprs || []).length,
        per_primitive: perPrim,
    };
}

function loadSummaries(summariesPath) {
    const raw = JSON.parse(fs.readFileSync(summariesPath, 'utf-8'));
    if (!Array.isArray(raw.summaries)) throw new Error(`${summariesPath}: missing .summaries array`);
    return raw.summaries;
}

// Website-hash-stratified split.
// Returns {dev_websites, eval_websites} and computed stats.
function buildSplit(taskSummaries, opts) {
    const seed = opts.seed;
    const devFraction = opts.dev_fraction;

    // Group by website
    const byWebsite = new Map();
    for (const t of taskSummaries) {
        if (!byWebsite.has(t.website)) byWebsite.set(t.website, []);
        byWebsite.get(t.website).push(t);
    }

    // Deterministic per-website hash using (seed, website). Reproducible
    // across runs and invariant under task-order changes.
    const websites = [...byWebsite.keys()].map(name => ({
        name,
        hash: crypto.createHash('sha256').update(`${seed}|${name}`).digest('hex'),
        n_tasks: byWebsite.get(name).length,
        n_actions: byWebsite.get(name).reduce((a, t) => a + t.n_actions, 0),
    }));
    websites.sort((a, b) => a.hash.localeCompare(b.hash));

    const totalTasks = taskSummaries.length;
    const target = devFraction * totalTasks;

    const devWebsites = [];
    const evalWebsites = [];
    let devTasks = 0;
    for (const w of websites) {
        // Greedy: add to dev if doing so keeps us closer to target, else eval.
        const distIfDev = Math.abs((devTasks + w.n_tasks) - target);
        const distIfEval = Math.abs(devTasks - target);
        if (devTasks < target && distIfDev <= distIfEval) {
            devWebsites.push(w.name);
            devTasks += w.n_tasks;
        } else {
            evalWebsites.push(w.name);
        }
    }

    // Compute stats
    const statsFor = (siteList) => {
        let tasks = 0, actions = 0;
        const perPrim = {};
        for (const site of siteList) {
            for (const t of byWebsite.get(site)) {
                tasks += 1;
                actions += t.n_actions;
                for (const [prim, n] of Object.entries(t.per_primitive)) {
                    perPrim[prim] = (perPrim[prim] || 0) + n;
                }
            }
        }
        return { websites: siteList.length, tasks, actions, per_primitive: perPrim };
    };

    return {
        dev_websites: devWebsites.sort(),
        eval_websites: evalWebsites.sort(),
        stats: {
            dev: statsFor(devWebsites),
            eval: statsFor(evalWebsites),
            total: statsFor([...devWebsites, ...evalWebsites]),
        },
    };
}

function writeSplit(outPath, split, meta) {
    const out = {
        schema_version: 1,
        created: meta.created,
        config_hash_prefix: meta.config_hash_prefix,
        seed: meta.seed,
        method: 'website_hash_stratified',
        frozen: false,
        note: 'frozen=true must not be set until Step 5 dev-run audit has passed (see docs/stage9-mind2web-validation.md). Eval-split runs hard-refuse when frozen=false.',
        stats: split.stats,
        dev_websites: split.dev_websites,
        eval_websites: split.eval_websites,
    };
    // Canonical JSON-with-indent so diffs are readable and reproducible.
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf-8');
    return out;
}

module.exports = {
    mapTagToPrimitive, parseActionRepr, summarizeTask,
    loadSummaries, buildSplit, writeSplit,
    PRIMARY_PRIMITIVES,
};

if (require.main === module) {
    const repoRoot = path.resolve(__dirname, '..');
    const hasher = require(path.join(repoRoot, 'scripts/mind2web-config-hash.js'));
    const configPath = path.join(repoRoot, 'tests/validation/mind2web/arm-0-config.json');
    const cfg = hasher.loadConfig(configPath);
    hasher.validateLive(cfg, repoRoot);

    const summariesArg = process.argv.find(a => a.startsWith('--summaries='));
    const summariesPath = summariesArg
        ? summariesArg.split('=')[1]
        : path.join(repoRoot, 'data/mind2web-summaries.json');
    if (!fs.existsSync(summariesPath)) {
        console.error(`Summaries file not found at ${summariesPath}.`);
        console.error(`Generate it first:`);
        console.error(`  python3 scripts/mind2web-summarize.py --out data/mind2web-summaries.json`);
        process.exit(1);
    }

    const summaries = loadSummaries(summariesPath);
    const split = buildSplit(summaries, {
        seed: cfg.split.seed,
        dev_fraction: cfg.split.dev_fraction,
    });
    const outPath = path.join(repoRoot, 'data/mind2web-split.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const out = writeSplit(outPath, split, {
        created: new Date().toISOString().slice(0, 10),
        config_hash_prefix: hasher.hashPrefix(cfg),
        seed: cfg.split.seed,
    });
    console.log(`Wrote ${outPath}`);
    console.log(`Dev:  ${out.stats.dev.websites} sites, ${out.stats.dev.tasks} tasks, ${out.stats.dev.actions} actions`);
    console.log(`Eval: ${out.stats.eval.websites} sites, ${out.stats.eval.tasks} tasks, ${out.stats.eval.actions} actions`);
    const ratio = out.stats.dev.tasks / out.stats.total.tasks;
    console.log(`Dev task fraction: ${ratio.toFixed(4)} (target ${cfg.split.dev_fraction})`);
    console.log(`Per-primitive dev N:`);
    for (const p of PRIMARY_PRIMITIVES) {
        const n = out.stats.dev.per_primitive[p] || 0;
        console.log(`  ${p.padEnd(12)} ${n}`);
    }
}
