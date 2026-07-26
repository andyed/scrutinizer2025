'use strict';

const DEFAULT_SCROLL_TOLERANCE_PX = 2;

function finite(value) {
    return Number.isFinite(value) ? value : 0;
}

function normalizeScrollPosition(position) {
    const source = position && typeof position === 'object' ? position : {};
    return {
        x: finite(source.x !== undefined ? source.x : source.scrollX),
        y: finite(source.y !== undefined ? source.y : source.scrollY)
    };
}

function isFrameAtScrollPosition(framePosition, currentPosition, tolerancePx = DEFAULT_SCROLL_TOLERANCE_PX) {
    const frame = normalizeScrollPosition(framePosition);
    const current = normalizeScrollPosition(currentPosition);
    const tolerance = Number.isFinite(tolerancePx) && tolerancePx >= 0
        ? tolerancePx : DEFAULT_SCROLL_TOLERANCE_PX;
    return Math.abs(frame.x - current.x) <= tolerance &&
        Math.abs(frame.y - current.y) <= tolerance;
}

module.exports = {
    DEFAULT_SCROLL_TOLERANCE_PX,
    normalizeScrollPosition,
    isFrameAtScrollPosition
};
