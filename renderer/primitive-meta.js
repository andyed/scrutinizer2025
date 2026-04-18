/**
 * PrimitiveMeta — per-primitive geometry metadata for the DOM-aware path.
 *
 * Parallel to structure-map and primitive-map, RGBA8 at 50% viewport
 * resolution. The procedural L_categorical and L_blob compositors need
 * geometry metadata that is NOT a calibration parameter (those live in
 * primitive-map.G/B/A in Stage 5):
 *
 *   R: xHeightPx     — primitive x-height in device pixels (0–255, clamped)
 *                      Stroke period for text L_categorical is derived as
 *                      xHeightPx / 3 shader-side (Majaj et al. 2002 letter-
 *                      channel spatial frequency).
 *   G: reserved      — (fontWeight bucket, stroke orientation bias; zero for now)
 *   B: reserved      — (future: icon dominant-orientation hint)
 *   A: reserved
 *
 * Kept in a dedicated texture rather than packing into primitive-map so the
 * two concerns (type+calibration vs. geometry metadata) stay separable for
 * the compositor and for future per-gaze re-upload strategies.
 *
 * See docs/dom-aware-perception-plan.md for channel rationale.
 */

'use strict';

class PrimitiveMeta {
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
     * Write a primitive's geometry metadata into its bbox texels.
     *
     * @param {number} x  Viewport X (full-resolution px)
     * @param {number} y  Viewport Y
     * @param {number} w  Width (full-resolution px)
     * @param {number} h  Height
     * @param {{xHeightPx?:number}} meta  xHeightPx in device pixels. Missing
     *        or non-finite values clamp to 0 so the shader sees "no metadata"
     *        and falls back to the baseline pipeline for that texel.
     */
    drawBlock(x, y, w, h, meta) {
        const s = this.scale;
        const sx = Math.max(0, Math.floor(x * s));
        const sy = Math.max(0, Math.floor(y * s));
        const sw = Math.min(this.width - sx, Math.ceil(w * s));
        const sh = Math.min(this.height - sy, Math.ceil(h * s));
        if (sw <= 0 || sh <= 0) return;

        const m = meta || {};
        const r = encodeU8(m.xHeightPx);
        const g = 0;
        const b = 0;
        const a = 0;

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

function encodeU8(v) {
    if (typeof v !== 'number' || !isFinite(v)) return 0;
    if (v <= 0) return 0;
    if (v >= 255) return 255;
    return Math.floor(v);
}

module.exports = PrimitiveMeta;
module.exports.PrimitiveMeta = PrimitiveMeta;
