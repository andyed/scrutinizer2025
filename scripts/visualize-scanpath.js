#!/usr/bin/env node
/**
 * Generate scanpath visualizations from replay-scanpath.js output.
 *
 * Two modes:
 *   --diagram   Static composite: numbered fixation circles + saccade lines
 *               over the baseline image. Standard eye-tracking scanpath diagram.
 *   --animate   GIF or MP4 animation stitching foveated frames with
 *               duration-proportional hold times via ffmpeg.
 *   --both      Generate both.
 *
 * Usage:
 *   node scripts/visualize-scanpath.js --diagram
 *   node scripts/visualize-scanpath.js --animate
 *   node scripts/visualize-scanpath.js --both --dir=output/scanpath-replay
 *   node scripts/visualize-scanpath.js --animate --format=mp4
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const {
    loadPNG, savePNG,
    fillCircle, drawCircle, drawLine, fillRect,
    drawText, textWidth, textHeight,
    hslToRgb
} = require('./lib/png-draw');

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
function getArg(name, def) {
    const a = args.find(x => x.startsWith(`--${name}=`));
    return a ? a.split('=')[1] : def;
}

const ROOT = path.join(__dirname, '..');
const dir = path.resolve(getArg('dir', path.join(ROOT, 'output', 'scanpath-replay')));
const doDiagram = hasFlag('diagram') || hasFlag('both');
const doAnimate = hasFlag('animate') || hasFlag('both');
const animFormat = getArg('format', 'gif');
const animScale = parseInt(getArg('scale', '2'));

if (!doDiagram && !doAnimate) {
    console.error('Usage: node scripts/visualize-scanpath.js --diagram|--animate|--both');
    process.exit(1);
}

// ── Load metadata ───────────────────────────────────────────────

const metaPath = path.join(dir, 'replay-meta.json');
if (!fs.existsSync(metaPath)) {
    console.error(`Error: replay-meta.json not found in ${dir}`);
    console.error('Run replay-scanpath.js first.');
    process.exit(1);
}

const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const fixations = meta.fixations;

console.log('═══ Scanpath Visualization ═══\n');
console.log(`  Directory:  ${dir}`);
console.log(`  Fixations:  ${fixations.length}`);
console.log(`  Task:       ${meta.task || 'n/a'}`);
console.log(`  Subject:    ${meta.subject || 'n/a'}`);
console.log();

// ── Diagram ─────────────────────────────────────────────────────

function generateDiagram() {
    // Load background image
    const baselinePath = path.join(dir, 'frame_baseline.png');
    const firstFramePath = path.join(dir, fixations[0].frame);
    const bgPath = fs.existsSync(baselinePath) ? baselinePath : firstFramePath;

    if (!fs.existsSync(bgPath)) {
        console.error('  No baseline or frame image found for diagram background.');
        return false;
    }

    console.log('  Generating scanpath diagram...');
    const png = loadPNG(bgPath);

    // Draw target bbox if present (dashed green rectangle)
    if (meta.bbox) {
        const [bx, by, bw, bh] = meta.bbox;
        const dashLen = 8;
        const gap = 6;
        // Top and bottom edges
        for (let x = bx; x < bx + bw; x++) {
            if (Math.floor((x - bx) / (dashLen + gap)) % 2 === 0) {
                fillRect(png, x, by, 1, 2, 0, 200, 100, 180);
                fillRect(png, x, by + bh - 2, 1, 2, 0, 200, 100, 180);
            }
        }
        // Left and right edges
        for (let y = by; y < by + bh; y++) {
            if (Math.floor((y - by) / (dashLen + gap)) % 2 === 0) {
                fillRect(png, bx, y, 2, 1, 0, 200, 100, 180);
                fillRect(png, bx + bw - 2, y, 2, 1, 0, 200, 100, 180);
            }
        }
    }

    // Draw saccade lines (behind circles)
    for (let i = 0; i < fixations.length - 1; i++) {
        const f0 = fixations[i];
        const f1 = fixations[i + 1];
        drawLine(png,
            Math.round(f0.x), Math.round(f0.y),
            Math.round(f1.x), Math.round(f1.y),
            255, 255, 255, 160, 2
        );
    }

    // Draw fixation circles
    const fontScale = 2;
    for (let i = 0; i < fixations.length; i++) {
        const fix = fixations[i];
        const cx = Math.round(fix.x);
        const cy = Math.round(fix.y);
        const duration = fix.duration;

        // Radius scales with duration (14-30px range)
        const radius = Math.max(14, Math.min(30, 10 + duration / 30));

        // Color: HSL ramp from red (hue 0) to blue (hue 240) across fixations
        // Standard temporal coding in eye-tracking literature
        const hue = fixations.length > 1
            ? (i / (fixations.length - 1)) * 240
            : 120;
        const [cr, cg, cb] = hslToRgb(hue, 0.8, 0.45);

        // Filled circle (semi-transparent)
        fillCircle(png, cx, cy, Math.round(radius), cr, cg, cb, 180);

        // White outline
        drawCircle(png, cx, cy, Math.round(radius), 255, 255, 255, 220, 2);

        // Fixation number (1-indexed, centered)
        const label = String(i + 1);
        const tw = textWidth(label, fontScale);
        const th = textHeight(fontScale);
        const tx = cx - Math.round(tw / 2);
        const ty = cy - Math.round(th / 2);
        drawText(png, label, tx, ty, fontScale, 255, 255, 255);
    }

    const outPath = path.join(dir, 'scanpath-diagram.png');
    savePNG(outPath, png);
    console.log(`  → ${outPath}`);
    return true;
}

// ── Animation ───────────────────────────────────────────────────

function generateAnimation() {
    return new Promise((resolve) => {
        // Check ffmpeg
        const ffmpegPath = '/opt/homebrew/bin/ffmpeg';
        if (!fs.existsSync(ffmpegPath)) {
            console.error('  ffmpeg not found at /opt/homebrew/bin/ffmpeg');
            return resolve(false);
        }

        // Verify all frames exist
        const missingFrames = fixations.filter(f => !fs.existsSync(path.join(dir, f.frame)));
        if (missingFrames.length > 0) {
            console.error(`  Missing ${missingFrames.length} frame(s):`, missingFrames.map(f => f.frame).join(', '));
            return resolve(false);
        }

        console.log(`  Generating ${animFormat} animation...`);

        // Write concat demuxer file with per-frame durations
        const concatPath = path.join(dir, '_concat.txt');
        let concatContent = '';
        for (let i = 0; i < fixations.length; i++) {
            const fix = fixations[i];
            const framePath = path.resolve(dir, fix.frame);
            const holdSec = Math.max(0.1, fix.duration / 1000); // min 100ms hold
            concatContent += `file '${framePath}'\n`;
            concatContent += `duration ${holdSec.toFixed(3)}\n`;
        }
        // ffmpeg concat demuxer requires last frame repeated without duration
        const lastFrame = path.resolve(dir, fixations[fixations.length - 1].frame);
        concatContent += `file '${lastFrame}'\n`;
        fs.writeFileSync(concatPath, concatContent);

        const outName = `scanpath-animation.${animFormat}`;
        const outPath = path.join(dir, outName);

        // Remove existing output (ffmpeg won't overwrite without -y)
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

        const displayW = meta.display ? meta.display.width : 1680;
        const scaledW = Math.round(displayW / animScale);
        // Ensure even dimensions for MP4
        const scaleFilter = `scale=${scaledW}:-2:flags=lanczos`;

        let ffmpegArgs;
        if (animFormat === 'gif') {
            ffmpegArgs = [
                '-f', 'concat', '-safe', '0', '-i', concatPath,
                '-vf', `${scaleFilter},split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer`,
                '-loop', '0',
                outPath
            ];
        } else {
            // MP4
            ffmpegArgs = [
                '-f', 'concat', '-safe', '0', '-i', concatPath,
                '-vf', scaleFilter,
                '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart',
                outPath
            ];
        }

        const child = spawn(ffmpegPath, ffmpegArgs, { stdio: 'pipe' });
        let stderr = '';
        child.stderr.on('data', (d) => { stderr += d.toString(); });

        child.on('close', (code) => {
            // Clean up concat file
            try { fs.unlinkSync(concatPath); } catch (e) {}

            if (code === 0 && fs.existsSync(outPath)) {
                const size = (fs.statSync(outPath).size / 1024).toFixed(0);
                console.log(`  → ${outPath} (${size} KB)`);
                resolve(true);
            } else {
                console.error(`  ffmpeg exited with code ${code}`);
                if (stderr) console.error(`  ${stderr.slice(-300)}`);
                resolve(false);
            }
        });
    });
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
    if (doDiagram) generateDiagram();
    if (doAnimate) await generateAnimation();
    console.log('\n  Done.');
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
