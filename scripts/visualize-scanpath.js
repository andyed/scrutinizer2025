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
const doGazeplot = hasFlag('gazeplot-diagram');
const animFormat = getArg('format', 'gif');
const animScale = parseInt(getArg('scale', '2'));

if (!doDiagram && !doAnimate && !doGazeplot) {
    console.error('Usage: node scripts/visualize-scanpath.js --diagram|--animate|--both|--gazeplot-diagram');
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

// ── Scanpath overlay (shared by diagram and gazeplot) ───────────

function drawScanpathOverlay(png) {
    // Compute scale factor: fixation coordinates are in display space (e.g. 1680×1050)
    // but the captured PNG may be at a higher resolution (Retina DPR)
    const displayW = meta.display ? meta.display.width : 1680;
    const displayH = meta.display ? meta.display.height : 1050;
    const scaleX = png.width / displayW;
    const scaleY = png.height / displayH;
    const avgScale = (scaleX + scaleY) / 2;
    console.log(`  Display: ${displayW}×${displayH}, Capture: ${png.width}×${png.height}, Scale: ${scaleX.toFixed(2)}×${scaleY.toFixed(2)}`);

    // Draw target bbox if present (dashed green rectangle)
    if (meta.bbox) {
        const [bx, by, bw, bh] = meta.bbox;
        const sbx = Math.round(bx * scaleX);
        const sby = Math.round(by * scaleY);
        const sbw = Math.round(bw * scaleX);
        const sbh = Math.round(bh * scaleY);
        const dashLen = Math.round(12 * avgScale);
        const gap = Math.round(8 * avgScale);
        const thick = Math.max(2, Math.round(2 * avgScale));
        for (let x = sbx; x < sbx + sbw; x++) {
            if (Math.floor((x - sbx) / (dashLen + gap)) % 2 === 0) {
                fillRect(png, x, sby, 1, thick, 0, 200, 100, 180);
                fillRect(png, x, sby + sbh - thick, 1, thick, 0, 200, 100, 180);
            }
        }
        for (let y = sby; y < sby + sbh; y++) {
            if (Math.floor((y - sby) / (dashLen + gap)) % 2 === 0) {
                fillRect(png, sbx, y, thick, 1, 0, 200, 100, 180);
                fillRect(png, sbx + sbw - thick, y, thick, 1, 0, 200, 100, 180);
            }
        }
    }

    // Draw saccade lines (behind circles)
    const lineThick = Math.max(2, Math.round(3 * avgScale));
    for (let i = 0; i < fixations.length - 1; i++) {
        const f0 = fixations[i];
        const f1 = fixations[i + 1];
        drawLine(png,
            Math.round(f0.x * scaleX), Math.round(f0.y * scaleY),
            Math.round(f1.x * scaleX), Math.round(f1.y * scaleY),
            255, 255, 255, 160, lineThick
        );
    }

    // Draw fixation circles
    const fontScale = Math.max(2, Math.round(3 * avgScale));
    for (let i = 0; i < fixations.length; i++) {
        const fix = fixations[i];
        const cx = Math.round(fix.x * scaleX);
        const cy = Math.round(fix.y * scaleY);
        const duration = fix.duration;

        const baseRadius = Math.max(14, Math.min(30, 10 + duration / 30));
        const radius = Math.round(baseRadius * avgScale);

        // HSL ramp red→blue (standard temporal coding in eye-tracking literature)
        const hue = fixations.length > 1 ? (i / (fixations.length - 1)) * 240 : 120;
        const [cr, cg, cb] = hslToRgb(hue, 0.8, 0.45);

        fillCircle(png, cx, cy, Math.round(radius), cr, cg, cb, 180);
        drawCircle(png, cx, cy, Math.round(radius), 255, 255, 255, 220, Math.max(2, Math.round(2 * avgScale)));

        const label = String(i + 1);
        const tw = textWidth(label, fontScale);
        const th = textHeight(fontScale);
        drawText(png, label, cx - Math.round(tw / 2), cy - Math.round(th / 2), fontScale, 255, 255, 255);
    }
}

// ── Diagram ─────────────────────────────────────────────────────

function generateDiagram() {
    const baselinePath = path.join(dir, 'frame_baseline.png');
    const firstFramePath = path.join(dir, fixations[0].frame);
    const bgPath = fs.existsSync(baselinePath) ? baselinePath : firstFramePath;

    if (!fs.existsSync(bgPath)) {
        console.error('  No baseline or frame image found for diagram background.');
        return false;
    }

    console.log('  Generating scanpath diagram...');
    const png = loadPNG(bgPath);
    drawScanpathOverlay(png);

    const outPath = path.join(dir, 'scanpath-diagram.png');
    savePNG(outPath, png);
    console.log(`  → ${outPath}`);
    return true;
}

// ── Animation ───────────────────────────────────────────────────

// ── Gazeplot diagram ────────────────────────────────────────────

function generateGazeplotDiagram() {
    const gazeplotPath = path.join(dir, 'gazeplot.png');
    if (!fs.existsSync(gazeplotPath)) {
        console.error('  No gazeplot.png found. Run replay-scanpath.js --demo --gazeplot first.');
        return false;
    }

    console.log('  Generating gazeplot diagram (visual memory + scanpath overlay)...');
    const png = loadPNG(gazeplotPath);
    drawScanpathOverlay(png);

    const outPath = path.join(dir, 'gazeplot-diagram.png');
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
    if (doGazeplot) generateGazeplotDiagram();
    if (doAnimate) await generateAnimation();
    console.log('\n  Done.');
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
