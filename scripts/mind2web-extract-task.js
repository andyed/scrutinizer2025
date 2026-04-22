#!/usr/bin/env node
/**
 * Extract a Mind2Web task into files Scrutinizer can load.
 *
 * For each action step:
 *   - Writes the raw HTML DOM to a temp file
 *   - Extracts the target element selector (from pos_candidates)
 *   - Builds a scanpath entry (target element → gaze position)
 *
 * Usage:
 *   node scripts/mind2web-extract-task.js --website=new.mta.info [--task-index=0]
 *   node scripts/mind2web-extract-task.js --annotation-id=abc123
 */

const fs = require('fs');
const path = require('path');

const MIND2WEB_DIR = path.join(__dirname, '..', '..', '..', 'Mind2Web', 'data', 'data', 'train');
const OUTPUT_DIR = path.join(__dirname, '..', 'tests', 'mind2web-experiment');

// Parse args
const args = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => { const [k, v] = a.slice(2).split('='); return [k, v || 'true']; })
);

const targetWebsite = args.website;
const taskIndex = parseInt(args['task-index'] || '0', 10);
const annotationId = args['annotation-id'];

// Load all tasks
function loadAllTasks() {
    const tasks = [];
    for (const f of fs.readdirSync(MIND2WEB_DIR).sort()) {
        if (!f.endsWith('.json')) continue;
        const data = JSON.parse(fs.readFileSync(path.join(MIND2WEB_DIR, f), 'utf-8'));
        tasks.push(...data);
    }
    return tasks;
}

// Find the target task
const allTasks = loadAllTasks();
let task;
if (annotationId) {
    task = allTasks.find(t => t.annotation_id === annotationId);
} else if (targetWebsite) {
    const websiteTasks = allTasks.filter(t => t.website === targetWebsite);
    task = websiteTasks[taskIndex];
} else {
    console.error('Usage: --website=<name> or --annotation-id=<id>');
    process.exit(1);
}

if (!task) {
    console.error(`Task not found: website=${targetWebsite}, index=${taskIndex}`);
    process.exit(1);
}

console.log(`Task: ${task.confirmed_task}`);
console.log(`Website: ${task.website} (${task.domain})`);
console.log(`Actions: ${task.actions.length}`);
console.log(`Annotation ID: ${task.annotation_id}`);
console.log();

// Create output directory for this task
const taskDir = path.join(OUTPUT_DIR, `${task.website}_${task.annotation_id}`);
fs.mkdirSync(taskDir, { recursive: true });

// Extract each action step
const scanpath = [];

for (let i = 0; i < task.actions.length; i++) {
    const action = task.actions[i];
    const repr = task.action_reprs[i];
    const pos = action.pos_candidates[0];

    // Write DOM to file
    const domFile = path.join(taskDir, `step_${i}.html`);
    fs.writeFileSync(domFile, action.raw_html);

    // Extract target element info
    const targetInfo = {
        step: i,
        repr,
        operation: action.operation,
        tag: pos?.tag || 'unknown',
        // pos_candidates have attributes we can use to locate the element
        attributes: pos?.attributes ? JSON.parse(pos.attributes || '{}') : {},
        text: pos?.text || '',
        backend_node_id: pos?.backend_node_id,
        neg_count: action.neg_candidates.length,
        dom_file: `step_${i}.html`,
    };

    scanpath.push(targetInfo);

    console.log(`Step ${i}: ${repr}`);
    console.log(`  DOM: ${(action.raw_html.length / 1024).toFixed(0)}KB → ${domFile}`);
    console.log(`  Target: <${targetInfo.tag}> "${targetInfo.text.slice(0, 50)}"`);
}

// Write task manifest
const manifest = {
    website: task.website,
    domain: task.domain,
    subdomain: task.subdomain,
    annotation_id: task.annotation_id,
    confirmed_task: task.confirmed_task,
    action_count: task.actions.length,
    scanpath,
};

const manifestFile = path.join(taskDir, 'manifest.json');
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
console.log(`\nManifest: ${manifestFile}`);
console.log(`DOM files: ${taskDir}/step_*.html`);

// Quick stats
const totalDom = task.actions.reduce((sum, a) => sum + a.raw_html.length, 0);
console.log(`Total DOM: ${(totalDom / 1024 / 1024).toFixed(1)}MB across ${task.actions.length} steps`);
