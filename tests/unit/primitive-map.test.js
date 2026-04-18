/**
 * Unit tests for renderer/primitive-map.js.
 *
 * Jest runs in node (no JSDOM), so we stub the minimum canvas / 2d-context
 * surface that PrimitiveMap touches. StructureMap uses the same pattern
 * and has the same constraint.
 */

'use strict';

function stubDocument() {
    global.document = {
        createElement() {
            let width = 0, height = 0;
            const ctx = {
                imageSmoothingEnabled: false,
                createImageData(w, h) {
                    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
                },
                putImageData() { /* no-op — PrimitiveMap doesn't read back */ },
                getContext() { return ctx; }
            };
            return {
                get width() { return width; },
                set width(v) { width = v; },
                get height() { return height; },
                set height(v) { height = v; },
                getContext() { return ctx; }
            };
        }
    };
}

beforeAll(stubDocument);
afterAll(() => { delete global.document; });

const PrimitiveMap = require('../../renderer/primitive-map');
const { PRIMITIVE_TYPE_IDS } = PrimitiveMap;

describe('PRIMITIVE_TYPE_IDS', () => {
    it('reserves id 0 for ui_surface (baseline fallback)', () => {
        expect(PRIMITIVE_TYPE_IDS.ui_surface).toBe(0);
    });

    it('covers all 8 primitives plus ui_surface residual', () => {
        const expected = ['ui_surface', 'text', 'link', 'heading', 'icon',
                          'form_input', 'button', 'nav_item', 'image'];
        for (const t of expected) {
            expect(PRIMITIVE_TYPE_IDS).toHaveProperty(t);
        }
        expect(Object.keys(PRIMITIVE_TYPE_IDS).length).toBe(expected.length);
    });

    it('ids are distinct and fit in a uint8', () => {
        const ids = Object.values(PRIMITIVE_TYPE_IDS);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) {
            expect(id).toBeGreaterThanOrEqual(0);
            expect(id).toBeLessThanOrEqual(255);
            expect(Number.isInteger(id)).toBe(true);
        }
    });
});

describe('PrimitiveMap.resize', () => {
    it('sizes the internal canvas to 50% of the viewport (rounded up)', () => {
        const pm = new PrimitiveMap();
        pm.resize(800, 600);
        expect(pm.width).toBe(400);
        expect(pm.height).toBe(300);
    });

    it('rounds fractional half-resolutions up', () => {
        const pm = new PrimitiveMap();
        pm.resize(801, 601);
        expect(pm.width).toBe(401);
        expect(pm.height).toBe(301);
    });

    it('no-ops when resize would not change dimensions', () => {
        const pm = new PrimitiveMap();
        pm.resize(800, 600);
        const imageData = pm.imageData;
        pm.resize(800, 600);
        expect(pm.imageData).toBe(imageData);  // same buffer reused
    });
});

describe('PrimitiveMap.drawBlock', () => {
    function make(w = 400, h = 300) {
        const pm = new PrimitiveMap();
        pm.resize(w * 2, h * 2);  // resize halves to 400×300
        return pm;
    }

    it('encodes type_id into R channel', () => {
        const pm = make();
        pm.drawBlock(0, 0, 20, 20, 'text', { identityFidelity: 0, categoryFidelity: 0, extentPresence: 0 });
        // Sample texel (5, 5) — inside the block. 20px × 0.5 scale → 10 texels.
        const idx = (5 * pm.width + 5) * 4;
        expect(pm.imageData.data[idx]).toBe(PRIMITIVE_TYPE_IDS.text);
    });

    it('encodes calibration parameters into G/B/A channels in monotone order', () => {
        const pm = make();
        // identity=0.2, category=0.5, extent=0.8
        pm.drawBlock(0, 0, 20, 20, 'heading',
            { identityFidelity: 0.2, categoryFidelity: 0.5, extentPresence: 0.8 });
        const idx = (5 * pm.width + 5) * 4;
        expect(pm.imageData.data[idx + 1]).toBe(Math.floor(0.2 * 255));  // identity
        expect(pm.imageData.data[idx + 2]).toBe(Math.floor(0.5 * 255));  // category
        expect(pm.imageData.data[idx + 3]).toBe(Math.floor(0.8 * 255));  // extent
    });

    it('unknown primitive types fall back to ui_surface id=0', () => {
        const pm = make();
        pm.drawBlock(0, 0, 20, 20, 'made-up-type',
            { identityFidelity: 0.5, categoryFidelity: 0.5, extentPresence: 0.5 });
        const idx = (5 * pm.width + 5) * 4;
        expect(pm.imageData.data[idx]).toBe(PRIMITIVE_TYPE_IDS.ui_surface);
    });

    it('clamps calibration values to [0, 1] and guards NaN/Infinity', () => {
        const pm = make();
        pm.drawBlock(0, 0, 20, 20, 'text',
            { identityFidelity: -0.5, categoryFidelity: 1.5, extentPresence: NaN });
        const idx = (5 * pm.width + 5) * 4;
        expect(pm.imageData.data[idx + 1]).toBe(0);    // -0.5 → 0
        expect(pm.imageData.data[idx + 2]).toBe(255);  // 1.5 → 255
        expect(pm.imageData.data[idx + 3]).toBe(0);    // NaN → 0
    });

    it('missing calibration object writes zeros for G/B/A but keeps type_id', () => {
        const pm = make();
        pm.drawBlock(0, 0, 20, 20, 'text');
        const idx = (5 * pm.width + 5) * 4;
        expect(pm.imageData.data[idx]).toBe(PRIMITIVE_TYPE_IDS.text);
        expect(pm.imageData.data[idx + 1]).toBe(0);
        expect(pm.imageData.data[idx + 2]).toBe(0);
        expect(pm.imageData.data[idx + 3]).toBe(0);
    });

    it('last write wins for overlapping regions', () => {
        const pm = make();
        pm.drawBlock(0, 0, 40, 40, 'text', { identityFidelity: 1, categoryFidelity: 1, extentPresence: 1 });
        pm.drawBlock(10, 10, 20, 20, 'icon', { identityFidelity: 0.1, categoryFidelity: 0.2, extentPresence: 0.3 });
        // Sample inside the overlap — should be icon.
        const sx = Math.floor(15 * 0.5);
        const sy = Math.floor(15 * 0.5);
        const idx = (sy * pm.width + sx) * 4;
        expect(pm.imageData.data[idx]).toBe(PRIMITIVE_TYPE_IDS.icon);
    });

    it('clips blocks that extend off-canvas', () => {
        const pm = make();
        // Viewport is 800×600 here → canvas is 400×300. A 100-wide block at x=750
        // would otherwise spill past the 400-texel edge of the canvas.
        expect(() => pm.drawBlock(750, 500, 100, 100, 'text',
            { identityFidelity: 1, categoryFidelity: 1, extentPresence: 1 })).not.toThrow();
    });

    it('skips blocks with zero or negative extent', () => {
        const pm = make();
        const before = Array.from(pm.imageData.data);
        pm.drawBlock(10, 10, 0, 20, 'text',
            { identityFidelity: 1, categoryFidelity: 1, extentPresence: 1 });
        expect(Array.from(pm.imageData.data)).toEqual(before);
    });
});

describe('PrimitiveMap.clear', () => {
    it('zeros the pixel buffer', () => {
        const pm = new PrimitiveMap();
        pm.resize(800, 600);
        pm.drawBlock(0, 0, 40, 40, 'text', { identityFidelity: 1, categoryFidelity: 1, extentPresence: 1 });
        pm.clear();
        expect(pm.imageData.data.every(b => b === 0)).toBe(true);
    });
});

describe('ui_surface is baseline fallback', () => {
    it('explicit ui_surface primitives write id=0 so shader dispatch routes to baseline', () => {
        const pm = new PrimitiveMap();
        pm.resize(800, 600);
        pm.drawBlock(0, 0, 40, 40, 'ui_surface',
            { identityFidelity: 0.5, categoryFidelity: 0.5, extentPresence: 0.5 });
        const idx = 0;
        expect(pm.imageData.data[idx]).toBe(0);
    });
});
