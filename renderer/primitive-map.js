/**
 * PrimitiveMap — RGBA8 texture for DOM-aware peripheral perception.
 *
 * Mirrors renderer/structure-map.js at the same 50% viewport resolution.
 * Each primitive block is packed into one texel:
 *
 *   R: primitive_type_id (0–255, 8-bit int — see PRIMITIVE_TYPE_IDS)
 *   G: identityFidelity  (0–1 → 0–255)
 *   B: categoryFidelity  (0–1 → 0–255)
 *   A: extentPresence    (0–1 → 0–255)
 *
 * Channel ordering matches the monotone calibration ordering
 * (identity ≤ category ≤ extent), so the shader can sample `.g`, `.b`,
 * `.a` directly as the three parameters of the four-term composite in
 * docs/dom-aware-perception-plan.md.
 *
 * Primitive type id 0 is reserved for `ui_surface` (the baseline
 * fallback); the compositor's dispatch in Stage 4 keys off this.
 *
 * This module is decoupled from GL — it produces a canvas that the
 * renderer uploads via a parallel `uploadPrimitiveMap` in Stage 3b.
 */

'use strict';

// Primitive type → 8-bit id. Id 0 is the baseline fallback so that
// texels never initialized by drawBlock() correctly route through the
// existing non-primitive path.
const PRIMITIVE_TYPE_IDS = {
    ui_surface: 0,
    text:       1,
    link:       2,
    heading:    3,
    icon:       4,
    form_input: 5,
    button:     6,
    nav_item:   7,
    image:      8,
};

class PrimitiveMap {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { alpha: true });
        this.ctx.imageSmoothingEnabled = false;

        this.width = 0;
        this.height = 0;
        this.scale = 0.5;
        this.imageData = null;
    }

    resize(width, height) {
        const newWidth = Math.ceil(width * this.scale);
        const newHeight = Math.ceil(height * this.scale);

        if (this.width !== newWidth || this.height !== newHeight) {
            this.width = newWidth;
            this.height = newHeight;
            this.canvas.width = this.width;
            this.canvas.height = this.height;
            this.imageData = this.ctx.createImageData(this.width, this.height);
        }
    }

    clear() {
        this.imageData.data.fill(0);
    }

    /**
     * Write a primitive block's type+calibration into its bbox texels.
     * Last write wins for overlapping regions, same as structure-map.
     *
     * @param {number} x  Viewport X (full-resolution px)
     * @param {number} y  Viewport Y
     * @param {number} w  Width (full-resolution px)
     * @param {number} h  Height
     * @param {string} primitiveType  One of the keys in PRIMITIVE_TYPE_IDS;
     *                                 unknown types fall back to ui_surface.
     * @param {{identityFidelity:number, categoryFidelity:number, extentPresence:number}} calibration
     *        All three parameters in [0, 1]. Values outside the range are clamped.
     */
    drawBlock(x, y, w, h, primitiveType, calibration) {
        const s = this.scale;
        const sx = Math.max(0, Math.floor(x * s));
        const sy = Math.max(0, Math.floor(y * s));
        const sw = Math.min(this.width - sx, Math.ceil(w * s));
        const sh = Math.min(this.height - sy, Math.ceil(h * s));
        if (sw <= 0 || sh <= 0) return;

        const typeId = (primitiveType in PRIMITIVE_TYPE_IDS)
            ? PRIMITIVE_TYPE_IDS[primitiveType]
            : PRIMITIVE_TYPE_IDS.ui_surface;

        const cal = calibration || {};
        const r = typeId;
        const g = encode01(cal.identityFidelity);
        const b = encode01(cal.categoryFidelity);
        const a = encode01(cal.extentPresence);

        const data = this.imageData.data;
        for (let py = sy; py < sy + sh; py++) {
            for (let px = sx; px < sx + sw; px++) {
                const idx = (py * this.width + px) * 4;
                data[idx]     = r;
                data[idx + 1] = g;
                data[idx + 2] = b;
                data[idx + 3] = a;
            }
        }
    }

    flush() {
        this.ctx.putImageData(this.imageData, 0, 0);
    }

    getCanvas() {
        return this.canvas;
    }
}

function encode01(v) {
    if (typeof v !== 'number' || !isFinite(v)) return 0;
    if (v <= 0) return 0;
    if (v >= 1) return 255;
    return Math.floor(v * 255);
}

module.exports = PrimitiveMap;
module.exports.PrimitiveMap = PrimitiveMap;
module.exports.PRIMITIVE_TYPE_IDS = PRIMITIVE_TYPE_IDS;
