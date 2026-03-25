/**
 * PNG pixel-level drawing utilities.
 *
 * Bitmap font (5×7), text rendering, rectangles, circles, lines.
 * All operations work directly on pngjs PNG data buffers.
 *
 * Extracted from generate-chromatic-comparison.js + new circle/line primitives.
 */

const fs = require('fs');
const { PNG } = require('pngjs');

// ── Bitmap font (5×7, ASCII subset) ─────────────────────────────

const CHAR_W = 5;
const CHAR_H = 7;
const CHAR_GAP = 1;

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
        'x': [0b00000,0b00000,0b10001,0b01010,0b00100,0b01010,0b10001],
    };
    for (const [ch, rows] of Object.entries(glyphs)) {
        f[ch] = rows;
    }
    return f;
}

// ── Pixel operations ────────────────────────────────────────────

/** Set a single pixel with alpha blending. */
function setPixel(png, x, y, r, g, b, a = 255) {
    if (x < 0 || x >= png.width || y < 0 || y >= png.height) return;
    const idx = (y * png.width + x) << 2;
    if (a === 255) {
        png.data[idx] = r;
        png.data[idx + 1] = g;
        png.data[idx + 2] = b;
        png.data[idx + 3] = 255;
    } else {
        const aa = a / 255;
        png.data[idx] = Math.round(r * aa + png.data[idx] * (1 - aa));
        png.data[idx + 1] = Math.round(g * aa + png.data[idx + 1] * (1 - aa));
        png.data[idx + 2] = Math.round(b * aa + png.data[idx + 2] * (1 - aa));
        png.data[idx + 3] = 255;
    }
}

// ── Text ────────────────────────────────────────────────────────

function drawChar(png, ch, x, y, scale, r, g, b) {
    const glyph = FONT[ch.toUpperCase()] || FONT['?'];
    if (!glyph) return;
    for (let row = 0; row < CHAR_H; row++) {
        for (let col = 0; col < CHAR_W; col++) {
            if (glyph[row] & (1 << (CHAR_W - 1 - col))) {
                for (let sy = 0; sy < scale; sy++) {
                    for (let sx = 0; sx < scale; sx++) {
                        setPixel(png, x + col * scale + sx, y + row * scale + sy, r, g, b);
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
    return cx - x;
}

function textWidth(text, scale) {
    return text.length * (CHAR_W + CHAR_GAP) * scale - CHAR_GAP * scale;
}

function textHeight(scale) {
    return CHAR_H * scale;
}

// ── Rectangles ──────────────────────────────────────────────────

function fillRect(png, x, y, w, h, r, g, b, a = 255) {
    for (let py = Math.max(0, y); py < y + h && py < png.height; py++) {
        for (let px = Math.max(0, x); px < x + w && px < png.width; px++) {
            setPixel(png, px, py, r, g, b, a);
        }
    }
}

// ── Circles ─────────────────────────────────────────────────────

/** Draw a filled circle with alpha blending. */
function fillCircle(png, cx, cy, radius, r, g, b, a = 255) {
    const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            if (dx * dx + dy * dy <= r2) {
                setPixel(png, cx + dx, cy + dy, r, g, b, a);
            }
        }
    }
}

/** Draw a circle outline (Bresenham midpoint, with thickness). */
function drawCircle(png, cx, cy, radius, r, g, b, a = 255, thickness = 2) {
    const outerR2 = radius * radius;
    const innerR2 = (radius - thickness) * (radius - thickness);
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            const d2 = dx * dx + dy * dy;
            if (d2 <= outerR2 && d2 >= innerR2) {
                setPixel(png, cx + dx, cy + dy, r, g, b, a);
            }
        }
    }
}

// ── Lines ───────────────────────────────────────────────────────

/** Draw a line with thickness using Bresenham + perpendicular expansion. */
function drawLine(png, x0, y0, x1, y1, r, g, b, a = 255, thickness = 2) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    const half = Math.floor(thickness / 2);

    let cx = x0, cy = y0;
    while (true) {
        // Draw a small filled region for thickness
        for (let ty = -half; ty <= half; ty++) {
            for (let tx = -half; tx <= half; tx++) {
                setPixel(png, cx + tx, cy + ty, r, g, b, a);
            }
        }

        if (cx === Math.round(x1) && cy === Math.round(y1)) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; cx += sx; }
        if (e2 < dx) { err += dx; cy += sy; }
    }
}

// ── PNG I/O ─────────────────────────────────────────────────────

function loadPNG(filepath) {
    const buffer = fs.readFileSync(filepath);
    return PNG.sync.read(buffer);
}

function savePNG(filepath, png) {
    const buffer = PNG.sync.write(png);
    fs.writeFileSync(filepath, buffer);
}

function createPNG(width, height) {
    return new PNG({ width, height });
}

// ── Color utilities ─────────────────────────────────────────────

/** Convert HSL (h: 0-360, s: 0-1, l: 0-1) to RGB (0-255 each). */
function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r1, g1, b1;
    if (h < 60) { r1 = c; g1 = x; b1 = 0; }
    else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
    else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
    else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
    else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }
    return [
        Math.round((r1 + m) * 255),
        Math.round((g1 + m) * 255),
        Math.round((b1 + m) * 255)
    ];
}

module.exports = {
    drawChar, drawText, textWidth, textHeight,
    fillRect, fillCircle, drawCircle, drawLine,
    setPixel, loadPNG, savePNG, createPNG,
    hslToRgb, FONT, CHAR_W, CHAR_H, CHAR_GAP
};
