'use strict';

const {
    DEFAULT_SCROLL_TOLERANCE_PX,
    normalizeScrollPosition,
    isFrameAtScrollPosition
} = require('../../shared/scroll-freshness');

describe('scroll frame freshness', () => {
    it('normalizes live and capture payload field names', () => {
        expect(normalizeScrollPosition({ x: 14, y: 27 })).toEqual({ x: 14, y: 27 });
        expect(normalizeScrollPosition({ scrollX: 9, scrollY: 31 })).toEqual({ x: 9, y: 31 });
    });

    it('uses zero for missing or non-finite positions', () => {
        expect(normalizeScrollPosition(null)).toEqual({ x: 0, y: 0 });
        expect(normalizeScrollPosition({ x: NaN, scrollY: Infinity })).toEqual({ x: 0, y: 0 });
    });

    it('accepts subpixel drift inside the default tolerance', () => {
        expect(DEFAULT_SCROLL_TOLERANCE_PX).toBe(2);
        expect(isFrameAtScrollPosition({ x: 0, y: 100 }, { x: 1.5, y: 102 })).toBe(true);
    });

    it('rejects a captured frame from a stale scroll position', () => {
        expect(isFrameAtScrollPosition({ x: 0, y: 100 }, { x: 0, y: 103 })).toBe(false);
        expect(isFrameAtScrollPosition({ x: 0, y: 100 }, { x: 0, y: 101 }, 0)).toBe(false);
    });
});
