/**
 * Coordinate conversion utilities for scanpath importers.
 *
 * All output coordinates are physical canvas pixels (positive-down),
 * matching GazeModel.getPosition() convention.
 */

/**
 * Convert normalized 0-1 coordinates to physical canvas pixels.
 * Used by UEyes (Gazepoint exports normalized gaze coordinates).
 *
 * @param {number} nx - Normalized x (0-1)
 * @param {number} ny - Normalized y (0-1)
 * @param {number} canvasWidth - Physical canvas width in pixels
 * @param {number} canvasHeight - Physical canvas height in pixels
 * @returns {{ x: number, y: number }}
 */
function normalizedToPixels(nx, ny, canvasWidth, canvasHeight) {
    return {
        x: nx * canvasWidth,
        y: ny * canvasHeight
    };
}

/**
 * Scale stimulus-space pixels to canvas pixels.
 * Preserves aspect ratio by fitting the stimulus within the canvas
 * (letterbox/pillarbox), then centering.
 *
 * @param {number} sx - Stimulus pixel x
 * @param {number} sy - Stimulus pixel y
 * @param {number} stimW - Original stimulus width in pixels
 * @param {number} stimH - Original stimulus height in pixels
 * @param {number} canvasW - Canvas physical width in pixels
 * @param {number} canvasH - Canvas physical height in pixels
 * @returns {{ x: number, y: number }}
 */
function stimulusToCanvas(sx, sy, stimW, stimH, canvasW, canvasH) {
    const scaleX = canvasW / stimW;
    const scaleY = canvasH / stimH;
    const scale = Math.min(scaleX, scaleY);

    // Center the scaled stimulus within the canvas
    const offsetX = (canvasW - stimW * scale) / 2;
    const offsetY = (canvasH - stimH * scale) / 2;

    return {
        x: sx * scale + offsetX,
        y: sy * scale + offsetY
    };
}

/**
 * Convert degrees of visual angle to pixels.
 * Requires viewing geometry from the dataset metadata.
 *
 * @param {number} degX - Horizontal degrees
 * @param {number} degY - Vertical degrees
 * @param {number} viewingDistanceCm
 * @param {number} screenWidthCm
 * @param {number} screenWidthPx - Physical pixel width of the screen
 * @returns {{ x: number, y: number }}
 */
function degreesToPixels(degX, degY, viewingDistanceCm, screenWidthCm, screenWidthPx) {
    const pxPerCm = screenWidthPx / screenWidthCm;
    const cmPerDeg = viewingDistanceCm * Math.tan(Math.PI / 180);

    return {
        x: degX * cmPerDeg * pxPerCm,
        y: degY * cmPerDeg * pxPerCm
    };
}

/**
 * Estimate saccade duration from amplitude using the main sequence
 * relationship (Bahill et al. 1975).
 *
 * @param {number} amplitudeDeg - Saccade amplitude in degrees of visual angle
 * @returns {number} Duration in ms
 */
function saccadeDurationMs(amplitudeDeg) {
    return 2.2 * amplitudeDeg + 21;
}

/**
 * Estimate saccade duration from pixel distance, using ppd to convert.
 * Falls back to 50ms if ppd is not available.
 *
 * @param {number} distancePx - Euclidean pixel distance between fixations
 * @param {number} [ppd] - Pixels per degree. If omitted, returns 50ms fallback.
 * @returns {number} Duration in ms
 */
function saccadeDurationFromPixels(distancePx, ppd) {
    if (!ppd || !isFinite(ppd) || ppd <= 0) return 50;
    const amplitudeDeg = distancePx / ppd;
    return saccadeDurationMs(amplitudeDeg);
}

module.exports = {
    normalizedToPixels,
    stimulusToCanvas,
    degreesToPixels,
    saccadeDurationMs,
    saccadeDurationFromPixels
};
