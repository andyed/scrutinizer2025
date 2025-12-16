class StructureMap {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { alpha: true });
        // Disable smoothing for crisp data pixels
        this.ctx.imageSmoothingEnabled = false;

        this.width = 0;
        this.height = 0;
        this.scale = 0.5; // 50% resolution for performance
    }

    /**
     * Resize the internal canvas to match the viewport size.
     * @param {number} width - Viewport width in pixels.
     * @param {number} height - Viewport height in pixels.
     */
    resize(width, height) {
        // Calculate scaled dimensions
        const newWidth = Math.ceil(width * this.scale);
        const newHeight = Math.ceil(height * this.scale);

        if (this.width !== newWidth || this.height !== newHeight) {
            this.width = newWidth;
            this.height = newHeight;
            this.canvas.width = this.width;
            this.canvas.height = this.height;
            this.ctx.imageSmoothingEnabled = false;
        }
    }

    /**
     * Clear the canvas (reset to transparent black).
     */
    clear() {
        this.ctx.clearRect(0, 0, this.width, this.height);
    }

    /**
     * Draw a structure block onto the map.
     * @param {number} x - Viewport X position
     * @param {number} y - Viewport Y position
     * @param {number} w - Width
     * @param {number} h - Height
     * @param {number} type - Semantic Type: Text (1.0), Image (0.5), UI (0.0)
     * @param {number} density - Visual Mass (0.0 - 1.0)
     * @param {number} lineHeight - Rhythm (pixels)
     */
    drawBlock(x, y, w, h, type, density, lineHeight, saliency = 1.0) {
        const s = this.scale;

        // Encode channels: R=Rhythm, G=Density, B=Type
        const r = Math.min(255, Math.floor((lineHeight / 100.0) * 255));
        const g = Math.min(255, Math.floor(density * 255));
        const b = Math.min(255, Math.floor(type * 255));

        this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 1.0)`;
        this.ctx.fillRect(
            Math.floor(x * s),
            Math.floor(y * s),
            Math.ceil(w * s),
            Math.ceil(h * s)
        );
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
