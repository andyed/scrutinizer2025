#!/usr/bin/env node
/**
 * Replay a scanpath through Scrutinizer's pipeline and capture per-fixation frames.
 *
 * Loads an image as a stimulus, positions the foveal center at each fixation
 * in sequence, captures the rendered output as PNG. Produces a frame sequence
 * showing what the viewer could see at each point in their search.
 *
 * Uses the same Electron spawn pattern as capture-coco-periph.js.
 *
 * Usage:
 *   # Replay bundled demo sample (COCO-Search18, microwave search)
 *   node scripts/replay-scanpath.js --demo
 *
 *   # Replay specific scanpath file with image
 *   node scripts/replay-scanpath.js --scanpath=data/coco-search18/demo-sample.json \
 *       --image=path/to/000000034114.jpg --subject=0
 *
 *   # Options
 *   --mode=0            Rendering mode (default: 0 = MIP+DoG)
 *   --subject=0         Subject index within the scanpath file (default: 0)
 *   --output=output/    Output directory for frames
 *   --width=1680        Viewport width (default: stimulus display width)
 *   --height=1050       Viewport height (default: stimulus display height)
 *   --radius=45         Foveal radius in pixels
 *   --composite         Also capture the raw image (no effect) for comparison
 *   --dry-run           Print what would be captured without running
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
function getArg(name, def) {
    const a = args.find(x => x.startsWith(`--${name}=`));
    return a ? a.split('=')[1] : def;
}

const ROOT = path.join(__dirname, '..');
const dryRun = hasFlag('dry-run');
const isDemo = hasFlag('demo');
const composite = hasFlag('composite');
const modeId = getArg('mode', '0');
const subjectIdx = parseInt(getArg('subject', '0'));
const radiusPx = getArg('radius', '45');

// ── Load scanpath data ──────────────────────────────────────────

let scanpathFile = getArg('scanpath', null);
let imageFile = getArg('image', null);

if (isDemo) {
    scanpathFile = path.join(ROOT, 'data', 'coco-search18', 'demo-sample.json');
    // Demo image needs to be downloaded separately
    const demoCandidates = [
        path.join(ROOT, 'data', 'coco-search18', 'images', '000000034114.jpg'),
        path.join(ROOT, 'data', 'coco-search18', '000000034114.jpg'),
    ];
    imageFile = demoCandidates.find(f => fs.existsSync(f));
}

if (!scanpathFile || !fs.existsSync(scanpathFile)) {
    console.error(`Error: scanpath file not found: ${scanpathFile}`);
    if (isDemo) {
        console.error('\nDemo requires the COCO image. Download it:');
        console.error('  curl -o data/coco-search18/images/000000034114.jpg \\');
        console.error('    "http://images.cocodataset.org/val2014/COCO_val2014_000000034114.jpg"');
    }
    process.exit(1);
}

const scanpathData = JSON.parse(fs.readFileSync(scanpathFile, 'utf8'));

// Handle both demo-sample.json format and raw ScanpathData format
let fixations, meta;
if (scanpathData.scanpaths) {
    // demo-sample.json format: { scanpaths: [{ participant, task, fixations }] }
    const sp = scanpathData.scanpaths[subjectIdx];
    if (!sp) {
        console.error(`Subject index ${subjectIdx} out of range (${scanpathData.scanpaths.length} available)`);
        process.exit(1);
    }
    fixations = sp.fixations;
    meta = {
        image: scanpathData.image,
        task: scanpathData.task,
        participant: sp.participant,
        displayWidth: scanpathData.displaySize.width,
        displayHeight: scanpathData.displaySize.height,
        bbox: scanpathData.bbox
    };
} else if (scanpathData.fixations) {
    // Direct ScanpathData format
    fixations = scanpathData.fixations;
    meta = scanpathData.meta || {};
} else {
    console.error('Unrecognized scanpath format. Expected scanpaths[] or fixations[].');
    process.exit(1);
}

if (!imageFile || !fs.existsSync(imageFile)) {
    console.error(`Error: image file not found: ${imageFile}`);
    if (isDemo) {
        console.error('\nDownload the demo image:');
        console.error('  mkdir -p data/coco-search18/images');
        console.error('  curl -o data/coco-search18/images/000000034114.jpg \\');
        console.error('    "http://images.cocodataset.org/val2014/COCO_val2014_000000034114.jpg"');
    }
    process.exit(1);
}

const captureWidth = getArg('width', String(meta.displayWidth || 1680));
const captureHeight = getArg('height', String(meta.displayHeight || 1050));
const outputDir = path.resolve(getArg('output', path.join(ROOT, 'output', 'scanpath-replay')));

// ── Stimulus page generation ────────────────────────────────────

const STIMULUS_DIR = path.join(ROOT, 'output', 'stimulus_pages');

function generateStimulusPage(imagePath) {
    const absPath = path.resolve(imagePath);
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Scanpath Replay Stimulus</title>
<style>
  * { margin: 0; padding: 0; }
  body {
    width: ${captureWidth}px;
    height: ${captureHeight}px;
    background: #808080;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    image-rendering: auto;
  }
</style>
</head>
<body>
  <img src="file://${absPath}">
</body>
</html>`;

    fs.mkdirSync(STIMULUS_DIR, { recursive: true });
    const pagePath = path.join(STIMULUS_DIR, 'scanpath_stimulus.html');
    fs.writeFileSync(pagePath, html);
    return pagePath;
}

// ── Capture one frame at a given fixation position ──────────────

function captureFrame(stimulusUrl, fixX, fixY, outputFilename, mode) {
    return new Promise((resolve) => {
        if (dryRun) {
            console.log(`  [dry-run] ${outputFilename} @ (${fixX.toFixed(3)}, ${fixY.toFixed(3)})`);
            return resolve(true);
        }

        const env = {
            ...process.env,
            TEST_MODE: 'true',
            TEST_URL: stimulusUrl,
            TEST_MODES: mode,
            TEST_RADIUS: radiusPx,
            TEST_WIDTH: captureWidth,
            TEST_HEIGHT: captureHeight,
            TEST_FIXATION_X: fixX.toFixed(6),
            TEST_FIXATION_Y: fixY.toFixed(6),
            TEST_OVERLAY: 'false',
            TEST_OUTPUT_FILENAME: outputFilename,
            TEST_WAIT_CONGESTION: 'false',
            SCREENSHOT_MODE: 'update',
            ELECTRON_RUN_AS_NODE: undefined,
        };

        const child = spawn('npm', ['start'], {
            cwd: ROOT,
            env,
            stdio: 'pipe',
        });

        let stderr = '';
        child.stderr.on('data', (d) => { stderr += d.toString(); });

        child.on('close', (code) => {
            if (code === 0) {
                // Move screenshot from golden-captures to output dir
                const packageVersion = require(path.join(ROOT, 'package.json')).version.replace(/\.\d+$/, '');
                const src = path.join(ROOT, 'tests', 'golden-captures', `v${packageVersion}`, outputFilename);
                const dest = path.join(outputDir, outputFilename);

                if (fs.existsSync(src)) {
                    fs.renameSync(src, dest);
                    resolve(true);
                } else {
                    console.warn(`  Warning: screenshot not found at ${src}`);
                    resolve(false);
                }
            } else {
                console.error(`  Capture failed (exit ${code})`);
                if (stderr.length > 200) stderr = stderr.slice(-200);
                if (stderr) console.error(`  stderr: ${stderr}`);
                resolve(false);
            }
        });
    });
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
    console.log('═══ Scanpath Replay ═══\n');
    console.log(`  Image:       ${imageFile}`);
    console.log(`  Scanpath:    ${scanpathFile}`);
    console.log(`  Subject:     ${meta.participant || subjectIdx}`);
    console.log(`  Task:        ${meta.task || 'n/a'}`);
    console.log(`  Fixations:   ${fixations.length}`);
    console.log(`  Display:     ${captureWidth}×${captureHeight}`);
    console.log(`  Mode:        ${modeId}`);
    console.log(`  Radius:      ${radiusPx}px`);
    console.log(`  Output:      ${outputDir}`);
    if (meta.bbox) {
        console.log(`  Target bbox: [${meta.bbox.join(', ')}]`);
    }
    console.log();

    fs.mkdirSync(outputDir, { recursive: true });

    // Generate stimulus page
    const stimulusPage = generateStimulusPage(imageFile);
    const stimulusUrl = `file://${stimulusPage}`;

    // Optionally capture baseline (no effect)
    if (composite) {
        console.log('  Capturing baseline (no effect)...');
        await captureFrame(stimulusUrl, 0.5, 0.5, 'frame_baseline.png', 'disabled');
    }

    // Capture each fixation
    let success = 0;
    for (let i = 0; i < fixations.length; i++) {
        const fix = fixations[i];
        const duration = fix.tEnd - fix.tStart;

        // Convert pixel coordinates to normalized 0-1
        const normX = fix.x / parseInt(captureWidth);
        const normY = fix.y / parseInt(captureHeight);

        const filename = `frame_${String(i).padStart(3, '0')}_fix${fix.tStart}ms.png`;
        console.log(`  [${i + 1}/${fixations.length}] (${fix.x.toFixed(0)}, ${fix.y.toFixed(0)}) ${duration}ms → ${filename}`);

        const ok = await captureFrame(stimulusUrl, normX, normY, filename, modeId);
        if (ok) success++;
    }

    console.log(`\n  Done: ${success}/${fixations.length} frames captured → ${outputDir}`);

    // Write replay metadata alongside frames
    const replayMeta = {
        source: scanpathFile,
        image: imageFile,
        subject: meta.participant || subjectIdx,
        task: meta.task,
        mode: modeId,
        radius: radiusPx,
        display: { width: parseInt(captureWidth), height: parseInt(captureHeight) },
        bbox: meta.bbox,
        fixations: fixations.map((f, i) => ({
            index: i,
            x: f.x,
            y: f.y,
            tStart: f.tStart,
            tEnd: f.tEnd,
            duration: f.tEnd - f.tStart,
            frame: `frame_${String(i).padStart(3, '0')}_fix${f.tStart}ms.png`
        })),
        citation: 'Yang et al. "Predicting Goal-directed Human Attention Using Inverse Reinforcement Learning" CVPR 2020',
        timestamp: new Date().toISOString()
    };
    fs.writeFileSync(path.join(outputDir, 'replay-meta.json'), JSON.stringify(replayMeta, null, 2));
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
