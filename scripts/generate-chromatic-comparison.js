#!/usr/bin/env node
/**
 * Generate side-by-side before/after comparisons of chromatic pooling captures.
 *
 * Uses pngjs for pixel-level compositing. Produces labeled images:
 *   LEFT  = "Legacy (Uniform Reduction)" — chromatic_off
 *   RIGHT = "Per-Channel Chromatic Pooling (castleCSF)" — chromatic_on
 *
 * Labels are rendered as filled rectangles with bitmap text (no native font
 * rendering in pngjs, so we use a simple 5x7 bitmap font).
 *
 * Usage:
 *   node scripts/generate-chromatic-comparison.js
 *   node scripts/generate-chromatic-comparison.js --version=1.8.0
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const pkgVersion = require('../package.json').version;
const versionArg = process.argv.find(a => a.startsWith('--version='));
const version = versionArg ? versionArg.split('=')[1] : pkgVersion;

const CAPTURE_DIR = path.join(ROOT, 'tests', 'golden-captures', `v${version}`);
const OUTPUT_DIR = path.join(ROOT, 'docs', 'golden', 'chromatic-comparison');

// Pairs to compare: [label, off_filename, on_filename]
const PAIRS = [
  ['Color Spectrum — Mode 0 (High-Key)',
    'color-spectrum_center_mode0_chromatic_off.png',
    'color-spectrum_center_mode0_chromatic_on.png'],
  ['Color Spectrum — Mode 1 (Biological / Purkinje)',
    'color-spectrum_center_mode1_chromatic_off.png',
    'color-spectrum_center_mode1_chromatic_on.png'],
  ['Dashboard — Mode 0 (High-Key)',
    'dashboard_center_mode0_chromatic_off.png',
    'dashboard_center_mode0_chromatic_on.png'],
];

// ── Bitmap font (5×7, ASCII 32–126) ──
// Each character is 5 columns × 7 rows, stored as 7 bytes (each byte = 5 MSBits)
const CHAR_W = 5;
const CHAR_H = 7;
const CHAR_GAP = 1;

// Minimal 5x7 bitmap font — covers A-Z, 0-9, common punctuation
// Each glyph: array of 7 numbers, each 5 bits wide (MSB = leftmost pixel)
const FONT = buildFont();

function buildFont() {
  const f = {};
  // prettier-ignore
  const glyphs = {
    ' ': [0b00000,0b00000,0b00000,0b00000,0b00000,0b00000,0b00000],
    'A': [0b01110,0b10001,0b10001,0b11111,0b10001,0b10001,0b10001],
    'B': [0b11110,0b10001,0b10001,0b11110,0b10001,0b10001,0b11110],
    'C': [0b01110,0b10001,0b10000,0b10000,0b10000,0b10001,0b01110],
    'D': [0b11110,0b10001,0b10001,0b10001,0b10001,0b10001,0b11110],
    'E': [0b11111,0b10000,0b10000,0b11110,0b10000,0b10000,0b11111],
    'F': [0b11111,0b10000,0b10000,0b11110,0b10000,0b10000,0b10000],
    'G': [0b01110,0b10001,0b10000,0b10111,0b10001,0b10001,0b01110],
    'H': [0b10001,0b10001,0b10001,0b11111,0b10001,0b10001,0b10001],
    'I': [0b01110,0b00100,0b00100,0b00100,0b00100,0b00100,0b01110],
    'J': [0b00111,0b00010,0b00010,0b00010,0b00010,0b10010,0b01100],
    'K': [0b10001,0b10010,0b10100,0b11000,0b10100,0b10010,0b10001],
    'L': [0b10000,0b10000,0b10000,0b10000,0b10000,0b10000,0b11111],
    'M': [0b10001,0b11011,0b10101,0b10101,0b10001,0b10001,0b10001],
    'N': [0b10001,0b11001,0b10101,0b10011,0b10001,0b10001,0b10001],
    'O': [0b01110,0b10001,0b10001,0b10001,0b10001,0b10001,0b01110],
    'P': [0b11110,0b10001,0b10001,0b11110,0b10000,0b10000,0b10000],
    'Q': [0b01110,0b10001,0b10001,0b10001,0b10101,0b10010,0b01101],
    'R': [0b11110,0b10001,0b10001,0b11110,0b10100,0b10010,0b10001],
    'S': [0b01110,0b10001,0b10000,0b01110,0b00001,0b10001,0b01110],
    'T': [0b11111,0b00100,0b00100,0b00100,0b00100,0b00100,0b00100],
    'U': [0b10001,0b10001,0b10001,0b10001,0b10001,0b10001,0b01110],
    'V': [0b10001,0b10001,0b10001,0b10001,0b10001,0b01010,0b00100],
    'W': [0b10001,0b10001,0b10001,0b10101,0b10101,0b11011,0b10001],
    'X': [0b10001,0b10001,0b01010,0b00100,0b01010,0b10001,0b10001],
    'Y': [0b10001,0b10001,0b01010,0b00100,0b00100,0b00100,0b00100],
    'Z': [0b11111,0b00001,0b00010,0b00100,0b01000,0b10000,0b11111],
    '0': [0b01110,0b10001,0b10011,0b10101,0b11001,0b10001,0b01110],
    '1': [0b00100,0b01100,0b00100,0b00100,0b00100,0b00100,0b01110],
    '2': [0b01110,0b10001,0b00001,0b00010,0b00100,0b01000,0b11111],
    '3': [0b11111,0b00010,0b00100,0b00010,0b00001,0b10001,0b01110],
    '4': [0b00010,0b00110,0b01010,0b10010,0b11111,0b00010,0b00010],
    '5': [0b11111,0b10000,0b11110,0b00001,0b00001,0b10001,0b01110],
    '6': [0b00110,0b01000,0b10000,0b11110,0b10001,0b10001,0b01110],
    '7': [0b11111,0b00001,0b00010,0b00100,0b01000,0b01000,0b01000],
    '8': [0b01110,0b10001,0b10001,0b01110,0b10001,0b10001,0b01110],
    '9': [0b01110,0b10001,0b10001,0b01111,0b00001,0b00010,0b01100],
    '-': [0b00000,0b00000,0b00000,0b11111,0b00000,0b00000,0b00000],
    '(': [0b00010,0b00100,0b01000,0b01000,0b01000,0b00100,0b00010],
    ')': [0b01000,0b00100,0b00010,0b00010,0b00010,0b00100,0b01000],
    '/': [0b00001,0b00010,0b00010,0b00100,0b01000,0b01000,0b10000],
    '.': [0b00000,0b00000,0b00000,0b00000,0b00000,0b01100,0b01100],
    ',': [0b00000,0b00000,0b00000,0b00000,0b00110,0b00100,0b01000],
    ':': [0b00000,0b01100,0b01100,0b00000,0b01100,0b01100,0b00000],
    '!': [0b00100,0b00100,0b00100,0b00100,0b00100,0b00000,0b00100],
    '?': [0b01110,0b10001,0b00001,0b00010,0b00100,0b00000,0b00100],
    '+': [0b00000,0b00100,0b00100,0b11111,0b00100,0b00100,0b00000],
    '=': [0b00000,0b00000,0b11111,0b00000,0b11111,0b00000,0b00000],
    '_': [0b00000,0b00000,0b00000,0b00000,0b00000,0b00000,0b11111],
    '~': [0b00000,0b00000,0b01000,0b10101,0b00010,0b00000,0b00000],
    '>': [0b01000,0b00100,0b00010,0b00001,0b00010,0b00100,0b01000],
    '<': [0b00010,0b00100,0b01000,0b10000,0b01000,0b00100,0b00010],
  };
  for (const [ch, rows] of Object.entries(glyphs)) {
    f[ch] = rows;
  }
  return f;
}

function drawChar(png, ch, x, y, scale, r, g, b) {
  const glyph = FONT[ch.toUpperCase()] || FONT['?'];
  if (!glyph) return;
  for (let row = 0; row < CHAR_H; row++) {
    for (let col = 0; col < CHAR_W; col++) {
      if (glyph[row] & (1 << (CHAR_W - 1 - col))) {
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = x + col * scale + sx;
            const py = y + row * scale + sy;
            if (px >= 0 && px < png.width && py >= 0 && py < png.height) {
              const idx = (py * png.width + px) << 2;
              png.data[idx] = r;
              png.data[idx + 1] = g;
              png.data[idx + 2] = b;
              png.data[idx + 3] = 255;
            }
          }
        }
      }
    }
  }
}

function drawText(png, text, x, y, scale, r, g, b) {
  let cx = x;
  for (const ch of text) {
    drawChar(png, ch, cx, y, scale, r, g, b);
    cx += (CHAR_W + CHAR_GAP) * scale;
  }
  return cx - x; // width drawn
}

function textWidth(text, scale) {
  return text.length * (CHAR_W + CHAR_GAP) * scale - CHAR_GAP * scale;
}

function fillRect(png, x, y, w, h, r, g, b, a = 255) {
  for (let py = y; py < y + h && py < png.height; py++) {
    for (let px = x; px < x + w && px < png.width; px++) {
      if (px >= 0 && py >= 0) {
        const idx = (py * png.width + px) << 2;
        if (a === 255) {
          png.data[idx] = r;
          png.data[idx + 1] = g;
          png.data[idx + 2] = b;
          png.data[idx + 3] = 255;
        } else {
          // Alpha blend
          const aa = a / 255;
          png.data[idx] = Math.round(r * aa + png.data[idx] * (1 - aa));
          png.data[idx + 1] = Math.round(g * aa + png.data[idx + 1] * (1 - aa));
          png.data[idx + 2] = Math.round(b * aa + png.data[idx + 2] * (1 - aa));
          png.data[idx + 3] = 255;
        }
      }
    }
  }
}

function copyImage(dst, src, dstX, dstY, srcW, srcH) {
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const si = (y * src.width + x) << 2;
      const di = ((dstY + y) * dst.width + (dstX + x)) << 2;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
}

function loadPNG(filepath) {
  const data = fs.readFileSync(filepath);
  return PNG.sync.read(data);
}

function savePNG(filepath, png) {
  const buffer = PNG.sync.write(png);
  fs.writeFileSync(filepath, buffer);
}

// ── Main ──

if (!fs.existsSync(CAPTURE_DIR)) {
  console.error(`Capture directory not found: ${CAPTURE_DIR}`);
  process.exit(1);
}

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const LABEL_H = 48;       // Height of label bar
const GAP = 4;             // Gap between left and right panels
const SCALE = 3;           // Bitmap font scale (3× = 15×21 px per char)
const DIVIDER_LABEL_SCALE = 2;

const LEFT_LABEL = 'BEFORE: Legacy (Uniform Reduction)';
const RIGHT_LABEL = 'AFTER: Per-Channel Chromatic Pooling';
const TITLE_SCALE = 3;

let generated = 0;

for (const [title, offFile, onFile] of PAIRS) {
  const offPath = path.join(CAPTURE_DIR, offFile);
  const onPath = path.join(CAPTURE_DIR, onFile);

  if (!fs.existsSync(offPath) || !fs.existsSync(onPath)) {
    console.warn(`⚠ Skipping "${title}" — missing capture files`);
    continue;
  }

  console.log(`\n▶ ${title}`);
  const offImg = loadPNG(offPath);
  const onImg = loadPNG(onPath);

  // Use smaller dimensions if they differ
  const imgW = Math.min(offImg.width, onImg.width);
  const imgH = Math.min(offImg.height, onImg.height);

  // Title bar at top + label bars above each panel + two panels side by side
  const TITLE_H = 52;
  const totalW = imgW * 2 + GAP;
  const totalH = TITLE_H + LABEL_H + imgH;

  const out = new PNG({ width: totalW, height: totalH });
  // Fill black
  fillRect(out, 0, 0, totalW, totalH, 18, 18, 18);

  // ── Title bar ──
  fillRect(out, 0, 0, totalW, TITLE_H, 10, 10, 10);
  const titleTw = textWidth(title, TITLE_SCALE);
  const titleX = Math.floor((totalW - titleTw) / 2);
  drawText(out, title, titleX, Math.floor((TITLE_H - CHAR_H * TITLE_SCALE) / 2), TITLE_SCALE, 220, 220, 220);

  // ── Left label bar (red-tinted) ──
  fillRect(out, 0, TITLE_H, imgW, LABEL_H, 60, 20, 20);
  const leftTw = textWidth(LEFT_LABEL, SCALE);
  const leftX = Math.floor((imgW - leftTw) / 2);
  drawText(out, LEFT_LABEL, leftX, TITLE_H + Math.floor((LABEL_H - CHAR_H * SCALE) / 2), SCALE, 255, 120, 120);

  // ── Right label bar (green-tinted) ──
  fillRect(out, imgW + GAP, TITLE_H, imgW, LABEL_H, 20, 50, 20);
  const rightTw = textWidth(RIGHT_LABEL, SCALE);
  const rightX = imgW + GAP + Math.floor((imgW - rightTw) / 2);
  drawText(out, RIGHT_LABEL, rightX, TITLE_H + Math.floor((LABEL_H - CHAR_H * SCALE) / 2), SCALE, 120, 255, 120);

  // ── Divider strip ──
  fillRect(out, imgW, TITLE_H, GAP, LABEL_H + imgH, 80, 80, 80);

  // ── Copy images ──
  const panelY = TITLE_H + LABEL_H;
  copyImage(out, offImg, 0, panelY, imgW, imgH);
  copyImage(out, onImg, imgW + GAP, panelY, imgW, imgH);

  // ── Watermark: subtle bottom-right attribution ──
  const watermark = 'Scrutinizer v' + version;
  const wmScale = 2;
  const wmW = textWidth(watermark, wmScale);
  fillRect(out, totalW - wmW - 16, totalH - CHAR_H * wmScale - 12,
    wmW + 12, CHAR_H * wmScale + 8, 0, 0, 0, 160);
  drawText(out, watermark, totalW - wmW - 10, totalH - CHAR_H * wmScale - 8,
    wmScale, 140, 140, 140);

  // ── Save ──
  const outName = offFile.replace('_chromatic_off.png', '_comparison.png');
  const outPath = path.join(OUTPUT_DIR, outName);
  savePNG(outPath, out);
  console.log(`  ✅ ${outPath}`);
  generated++;
}

console.log(`\n🎉 Generated ${generated} comparison images in ${OUTPUT_DIR}`);
