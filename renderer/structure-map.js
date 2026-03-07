class StructureMap {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { alpha: true });
        // Disable smoothing for crisp data pixels
        this.ctx.imageSmoothingEnabled = false;

        this.width = 0;
        this.height = 0;
        this.scale = 0.5; // 50% resolution for performance
        this.imageData = null;
    }

    /**
     * Resize the internal canvas to match the viewport size.
     * @param {number} width - Viewport width in pixels.
     * @param {number} height - Viewport height in pixels.
     */
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

    /**
     * Clear the pixel buffer (reset to transparent black).
     */
    clear() {
        this.imageData.data.fill(0);
    }

    /**
     * Draw a structure block onto the map.
     * Uses raw ImageData to avoid canvas alpha compositing issues —
     * putImageData writes raw bytes, so last write wins for overlapping regions.
     *
     * @param {number} x - Viewport X position
     * @param {number} y - Viewport Y position
     * @param {number} w - Width
     * @param {number} h - Height
     * @param {number} type - Semantic Type: Text (1.0), Image (0.5), UI (0.0)
     * @param {number} density - Visual Mass (0.0 - 1.0)
     * @param {number} lineHeight - Rhythm (pixels)
     * @param {number} ariaRole - ARIA role ID (0–12), encoded in alpha channel
     */
    drawBlock(x, y, w, h, type, density, lineHeight, ariaRole = 0) {
        const s = this.scale;
        const sx = Math.max(0, Math.floor(x * s));
        const sy = Math.max(0, Math.floor(y * s));
        const sw = Math.min(this.width - sx, Math.ceil(w * s));
        const sh = Math.min(this.height - sy, Math.ceil(h * s));
        if (sw <= 0 || sh <= 0) return;

        // Encode channels: R=Rhythm, G=Density, B=Type, A=ariaRole
        const r = Math.min(255, Math.floor((lineHeight / 100.0) * 255));
        const g = Math.min(255, Math.floor(density * 255));
        const b = Math.min(255, Math.floor(type * 255));
        const a = Math.min(255, Math.floor((ariaRole / 12.0) * 255));

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

    /**
     * Flush the ImageData buffer to the canvas.
     * Must be called after all drawBlock() calls and before getCanvas().
     */
    flush() {
        this.ctx.putImageData(this.imageData, 0, 0);
    }

    /**
     * Get the canvas element for texture upload.
     */
    getCanvas() {
        return this.canvas;
    }
}

module.exports = StructureMap;
module.exports.StructureMap = StructureMap;
