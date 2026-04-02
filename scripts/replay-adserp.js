#!/usr/bin/env node
/**
 * Replay an AdSERP trial through Scrutinizer's foveated rendering pipeline.
 *
 * Loads the actual SERP HTML as the underlying page, replays eye fixations
 * through the foveal simulation, replays mouse cursor movement as a visible
 * fake cursor, and syncs page scrolling from recorded scroll events.
 *
 * Usage:
 *   # Replay a specific trial
 *   node scripts/replay-adserp.js --trial=p004-b1-t1 \
 *       --data=../attentional-foraging/AdSERP/data
 *
 *   # Options
 *   --trial=p004-b1-t1   Trial ID (required)
 *   --data=<path>         Path to AdSERP/data/ directory (required)
 *   --mode=0              Rendering mode (default: 0 = MIP+DoG)
 *   --speed=1.0           Playback speed multiplier (default: 1.0)
 *   --radius=45           Foveal radius in pixels (default: 45)
 *   --width=1422          Viewport width (default: from trial metadata)
 *   --height=1137         Viewport height (default: from trial metadata)
 *   --overlay=true        Show debug overlay (default: true)
 *   --screenshot          Capture screenshot at end of replay
 *   --dry-run             Print trial info without launching
 *   --list                List available trial IDs in the data directory
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── Argument parsing ──────────────────────────────────────────

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
function getArg(name, def) {
    const a = args.find(x => x.startsWith(`--${name}=`));
    return a ? a.split('=').slice(1).join('=') : def;
}

const ROOT = path.join(__dirname, '..');
const trialId = getArg('trial', null);
const dataDir = getArg('data', null);
const modeId = getArg('mode', '0');
const speed = getArg('speed', '1.0');
const radiusPx = getArg('radius', '45');
const overlayEnabled = getArg('overlay', 'true') === 'true';
const doScreenshot = hasFlag('screenshot');
const gazeplot = hasFlag('gazeplot');
const dryRun = hasFlag('dry-run');
const listTrials = hasFlag('list');

// ── List mode ─────────────────────────────────────────────────

if (listTrials) {
    if (!dataDir) {
        console.error('Error: --data=<path> required for --list');
        process.exit(1);
    }
    const fixDir = path.join(dataDir, 'fixation-data');
    if (!fs.existsSync(fixDir)) {
        console.error(`Error: fixation-data directory not found: ${fixDir}`);
        process.exit(1);
    }
    const trials = fs.readdirSync(fixDir)
        .filter(f => f.endsWith('.csv'))
        .map(f => f.replace('.csv', ''))
        .sort();
    console.log(`${trials.length} trials in ${dataDir}:\n`);
    // Group by participant
    const byParticipant = {};
    for (const t of trials) {
        const pid = t.split('-')[0];
        if (!byParticipant[pid]) byParticipant[pid] = [];
        byParticipant[pid].push(t);
    }
    for (const [pid, ids] of Object.entries(byParticipant)) {
        console.log(`  ${pid}: ${ids.join(', ')}`);
    }
    process.exit(0);
}

// ── Validate inputs ───────────────────────────────────────────

if (!trialId) {
    console.error('Error: --trial=<id> required (e.g. --trial=p004-b1-t1)');
    console.error('Use --list --data=<path> to see available trials');
    process.exit(1);
}

if (!dataDir) {
    console.error('Error: --data=<path> required (path to AdSERP/data/ directory)');
    process.exit(1);
}

if (!fs.existsSync(dataDir)) {
    console.error(`Error: data directory not found: ${dataDir}`);
    process.exit(1);
}

// ── Load and import trial data ────────────────────────────────

// The importer runs in Node.js context (not renderer), so require directly
const adserp = require(path.join(ROOT, 'renderer', 'scanpath', 'importers', 'adserp-importer'));

let scanpathData;
try {
    scanpathData = adserp.loadTrial(path.resolve(dataDir), trialId);
} catch (e) {
    console.error(`Error loading trial ${trialId}: ${e.message}`);
    process.exit(1);
}

const meta = scanpathData.meta;

// Resolve SERP HTML path
const serpPath = meta.serpHtmlPath;
if (!serpPath) {
    console.error(`Error: SERP HTML not found for trial ${trialId}`);
    process.exit(1);
}

// Size Scrutinizer window to match original browser viewport so the SERP HTML
// reflows identically. Fixation coords (screen-space 1280x1024) get scaled to
// window-space (1422x1137) by ScanpathPlayer's stimulus→canvas scaling.
const captureWidth = getArg('width', String(meta.windowWidth || 1422));
const captureHeight = getArg('height', String(meta.windowHeight || 1137));

// ── Display trial info ────────────────────────────────────────

const totalDuration = scanpathData.fixations.length > 0
    ? scanpathData.fixations[scanpathData.fixations.length - 1].tEnd
    : 0;

console.log('═══ AdSERP Replay ═══\n');
console.log(`  Trial:       ${trialId}`);
console.log(`  Query:       ${meta.query}`);
console.log(`  Participant: ${meta.participantId}`);
console.log(`  SERP HTML:   ${serpPath}`);
console.log(`  Fixations:   ${scanpathData.fixations.length}`);
console.log(`  Mouse events:${(scanpathData.mouseTimeline || []).length}`);
console.log(`  Scroll events:${(scanpathData.scrollTimeline || []).length}`);
console.log(`  Duration:    ${(totalDuration / 1000).toFixed(1)}s`);
console.log(`  Viewport:    ${meta.windowWidth}x${meta.windowHeight} (screen: ${meta.screenWidth}x${meta.screenHeight})`);
console.log(`  Document:    ${meta.documentWidth}x${meta.documentHeight}`);
console.log(`  Mode:        ${modeId}`);
console.log(`  Speed:       ${speed}x`);
console.log(`  Radius:      ${radiusPx}px`);
console.log(`  Overlay:     ${overlayEnabled}`);
console.log();

if (dryRun) {
    console.log('  [dry-run] Would launch Electron with above settings.');
    console.log('\n  First 5 fixations:');
    for (let i = 0; i < Math.min(5, scanpathData.fixations.length); i++) {
        const f = scanpathData.fixations[i];
        console.log(`    ${i}: (${f.x.toFixed(0)}, ${f.y.toFixed(0)}) ${f.tStart}→${f.tEnd}ms (${f.tEnd - f.tStart}ms)`);
    }
    if (scanpathData.scrollTimeline && scanpathData.scrollTimeline.length > 0) {
        console.log('\n  Scroll range:');
        const maxScroll = Math.max(...scanpathData.scrollTimeline.map(s => s.scrollY));
        console.log(`    0 → ${maxScroll.toFixed(0)}px over ${scanpathData.scrollTimeline.length} events`);
    }
    process.exit(0);
}

// ── Write scanpath data to temp file ──────────────────────────

const tmpDir = path.join(ROOT, 'output', 'adserp-tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const scanpathFile = path.join(tmpDir, `${trialId}-scanpath.json`);
fs.writeFileSync(scanpathFile, JSON.stringify(scanpathData, null, 2));

// ── Launch Electron ───────────────────────────────────────────

const serpUrl = `file://${path.resolve(serpPath)}`;

const outputFilename = (doScreenshot || gazeplot)
    ? `adserp_${trialId}_mode${modeId}${gazeplot ? '_gazeplot' : ''}.png`
    : '';

const env = {
    ...process.env,
    TEST_MODE: 'true',
    TEST_URL: serpUrl,
    TEST_MODES: modeId,
    TEST_RADIUS: radiusPx,
    TEST_WIDTH: captureWidth,
    TEST_HEIGHT: captureHeight,
    TEST_OVERLAY: gazeplot ? 'false' : (overlayEnabled ? 'true' : 'false'),
    TEST_SCANPATH: scanpathFile,
    // Gazeplot uses the standard fixation-walk path (visual memory accumulation).
    // Live replay uses the AdSERP ScanpathPlayer path.
    TEST_ADSERP_MODE: gazeplot ? 'false' : 'true',
    TEST_ADSERP_SPEED: speed,
    TEST_VISUAL_MEMORY: gazeplot ? '-1' : undefined,
    TEST_WAIT_CONGESTION: 'false',
    SCREENSHOT_MODE: 'update',
    TEST_OUTPUT_FILENAME: outputFilename,
    ELECTRON_RUN_AS_NODE: undefined,
};

// Set initial fixation to first gaze position (normalized)
if (scanpathData.fixations.length > 0) {
    const firstFix = scanpathData.fixations[0];
    env.TEST_FIXATION_X = (firstFix.x / parseInt(captureWidth)).toFixed(6);
    env.TEST_FIXATION_Y = (firstFix.y / parseInt(captureHeight)).toFixed(6);
}

console.log('  Launching Scrutinizer...\n');

const child = spawn('npm', ['start'], {
    cwd: ROOT,
    env,
    stdio: 'inherit', // Pass through stdout/stderr for live feedback
});

child.on('close', (code) => {
    // Clean up temp file
    try { fs.unlinkSync(scanpathFile); } catch (e) { /* ok */ }

    if (code === 0) {
        console.log('\n  Replay complete.');
        if (outputFilename) {
            const packageVersion = require(path.join(ROOT, 'package.json')).version.replace(/\.\d+$/, '');
            const screenshotPath = path.join(ROOT, 'tests', 'golden-captures', `v${packageVersion}`, outputFilename);
            if (fs.existsSync(screenshotPath)) {
                console.log(`  Screenshot: ${screenshotPath}`);
            }
        }
    } else {
        console.error(`\n  Replay failed (exit ${code})`);
        process.exit(code);
    }
});
