/**
 * Tests for Mind2Web bbox transforms.
 *
 * Guards the AdSERP-burned failure class: silent doc-space/screen-space mixing.
 * The specific failure we want impossible: a distinctiveness sample taken at a
 * bbox center where the transform is wrong produces a plausible-looking RGBA
 * value that is in fact from the wrong pixel.
 */

'use strict';

const path = require('path');
const bb = require(path.resolve(__dirname, '../../scripts/mind2web-bbox-transform.js'));

describe('parseBbox', () => {
    it('parses a well-formed "x,y,w,h" string', () => {
        expect(bb.parseBbox('100,200,50,30')).toEqual({ x: 100, y: 200, w: 50, h: 30 });
    });

    it('parses floats', () => {
        expect(bb.parseBbox('110.5,607.39,264,78')).toEqual({ x: 110.5, y: 607.39, w: 264, h: 78 });
    });

    it('returns null on zero or negative dimensions', () => {
        expect(bb.parseBbox('100,200,0,30')).toBeNull();
        expect(bb.parseBbox('100,200,50,-1')).toBeNull();
    });

    it('returns null on malformed input', () => {
        expect(bb.parseBbox('100,200,50')).toBeNull();
        expect(bb.parseBbox('')).toBeNull();
        expect(bb.parseBbox(null)).toBeNull();
        expect(bb.parseBbox('a,b,c,d')).toBeNull();
    });
});

describe('docBboxCenter', () => {
    it('computes the center of a doc-space bbox', () => {
        expect(bb.docBboxCenter({ x: 100, y: 200, w: 40, h: 30 })).toEqual({ x: 120, y: 215 });
    });
});

describe('docToScreen / screenToDoc — round-trip', () => {
    const viewport = { w: 1280, h: 768 };

    it('round-trip: docToScreen then screenToDoc restores original', () => {
        const doc = { x: 640, y: 1000 };
        const scroll = 700;
        const screen = bb.docToScreen(doc, scroll, viewport);
        const restored = bb.screenToDoc(screen, scroll);
        expect(restored).toEqual(doc);
    });

    it('scroll of 0 is identity on Y', () => {
        const doc = { x: 100, y: 200 };
        expect(bb.docToScreen(doc, 0, viewport)).toEqual({ x: 100, y: 200 });
    });

    it('scroll_y only affects Y, never X', () => {
        const doc = { x: 500, y: 1500 };
        const s1 = bb.docToScreen(doc, 1200, viewport);
        expect(s1.x).toBe(500);
    });

    it('throws if screen_x is outside viewport (doc was wider than 1280 render)', () => {
        expect(() => bb.docToScreen({ x: 1300, y: 100 }, 0, viewport)).toThrow(/screen_x/);
        expect(() => bb.docToScreen({ x: -1, y: 100 }, 0, viewport)).toThrow(/screen_x/);
    });

    it('throws if screen_y is outside viewport after scroll', () => {
        // A point at doc_y=2000 with scroll_y=0 is at screen_y=2000, way below viewport.
        expect(() => bb.docToScreen({ x: 100, y: 2000 }, 0, viewport)).toThrow(/screen_y/);
        // Same point with correct scroll is inside.
        expect(() => bb.docToScreen({ x: 100, y: 2000 }, 1616, viewport)).not.toThrow();
    });

    it('throws on negative or non-finite scroll_y (silent bug class)', () => {
        expect(() => bb.docToScreen({ x: 100, y: 200 }, -1, { w: 1280, h: 768 })).toThrow(/scroll_y/);
        expect(() => bb.docToScreen({ x: 100, y: 200 }, NaN, { w: 1280, h: 768 })).toThrow(/scroll_y/);
    });
});

describe('pickScrollForTarget — doc-space target → scroll that centers it vertically', () => {
    const viewport = { w: 1280, h: 768 };

    it('returns 0 when target is already within the first viewport', () => {
        // center at y=200, viewport half = 384, so desired = -184 → clamps to 0
        const scroll = bb.pickScrollForTarget({ x: 100, y: 180, w: 100, h: 40 }, 5000, viewport);
        expect(scroll).toBe(0);
    });

    it('centers a mid-page target so screen_y after scroll ≈ viewport center', () => {
        const target = { x: 100, y: 2000, w: 100, h: 40 };
        const scroll = bb.pickScrollForTarget(target, 5000, viewport);
        const center = bb.docBboxCenter(target);
        const screen = bb.docToScreen(center, scroll, viewport);
        expect(Math.abs(screen.y - viewport.h / 2)).toBeLessThan(1);
    });

    it('clamps to max_scroll when target is near the bottom of a short doc', () => {
        // doc is 900 tall, target at y=800. max_scroll = 900-768 = 132.
        const scroll = bb.pickScrollForTarget({ x: 100, y: 800, w: 100, h: 40 }, 900, viewport);
        expect(scroll).toBe(132);
    });

    it('throws on non-positive doc_height', () => {
        expect(() => bb.pickScrollForTarget({ x: 0, y: 0, w: 10, h: 10 }, 0, viewport)).toThrow(/doc_height/);
    });
});

describe('bboxVisibleAfterScroll', () => {
    const viewport = { w: 1280, h: 768 };

    it('returns true when bbox is fully inside viewport after scroll', () => {
        expect(bb.bboxVisibleAfterScroll({ x: 100, y: 1000, w: 80, h: 30 }, 900, viewport)).toBe(true);
    });

    it('returns false when bbox is entirely above the viewport', () => {
        expect(bb.bboxVisibleAfterScroll({ x: 100, y: 200, w: 80, h: 30 }, 900, viewport)).toBe(false);
    });

    it('returns false when bbox is entirely below the viewport', () => {
        expect(bb.bboxVisibleAfterScroll({ x: 100, y: 2000, w: 80, h: 30 }, 0, viewport)).toBe(false);
    });

    it('returns true on partial overlap with top edge', () => {
        // scroll=950 → screen_top = 1000-950 = 50. Visible.
        expect(bb.bboxVisibleAfterScroll({ x: 100, y: 1000, w: 80, h: 30 }, 950, viewport)).toBe(true);
    });

    it('returns false when bbox is horizontally off-screen (right side)', () => {
        expect(bb.bboxVisibleAfterScroll({ x: 1500, y: 100, w: 80, h: 30 }, 0, viewport)).toBe(false);
    });
});

describe('screenEccentricityPx', () => {
    it('computes euclidean pixel distance', () => {
        expect(bb.screenEccentricityPx({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    });

    it('is symmetric', () => {
        const a = { x: 100, y: 200 }, b = { x: 400, y: 600 };
        expect(bb.screenEccentricityPx(a, b)).toBe(bb.screenEccentricityPx(b, a));
    });
});

describe('AdSERP-history worked example: target below fold', () => {
    // This is the exact class of transform that burned AdSERP — doc_y=1500
    // cannot be used as a screen_y. The correct flow scrolls, transforms, and
    // both fovea + candidate-sample use the same transform.
    const viewport = { w: 1280, h: 768 };

    it('fovea + candidate sample go through the same transform; round-trip inside viewport', () => {
        const prior_target = { x: 200, y: 1500, w: 120, h: 40 };
        const candidate = { x: 400, y: 1580, w: 60, h: 20 };

        // Scroll to center prior target (the fovea anchor).
        const scroll_y = bb.pickScrollForTarget(prior_target, 5000, viewport);
        const fovea_doc = bb.docBboxCenter(prior_target);
        const candidate_doc = bb.docBboxCenter(candidate);

        const fovea_screen = bb.docToScreen(fovea_doc, scroll_y, viewport);
        const candidate_screen = bb.docToScreen(candidate_doc, scroll_y, viewport);

        // Fovea is near viewport vertical center.
        expect(Math.abs(fovea_screen.y - viewport.h / 2)).toBeLessThan(1);
        // Candidate is still inside viewport (no transform crash).
        expect(candidate_screen.x).toBeGreaterThanOrEqual(0);
        expect(candidate_screen.x).toBeLessThan(viewport.w);
        expect(candidate_screen.y).toBeGreaterThanOrEqual(0);
        expect(candidate_screen.y).toBeLessThan(viewport.h);

        // Eccentricity in screen-space is well-defined and equals
        // eccentricity in doc-space (scroll shifts both points identically).
        const ecc_screen = bb.screenEccentricityPx(fovea_screen, candidate_screen);
        const ecc_doc = bb.screenEccentricityPx(fovea_doc, candidate_doc);
        expect(ecc_screen).toBeCloseTo(ecc_doc, 6);
    });
});
