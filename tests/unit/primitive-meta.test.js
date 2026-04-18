/**
 * Unit tests for renderer/primitive-meta.js.
 *
 * Same node-environment canvas stub as primitive-map.test.js.
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
                putImageData() { /* no-op */ },
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

const PrimitiveMeta = require('../../renderer/primitive-meta');

describe('PrimitiveMeta.resize', () => {
    it('sizes internal canvas to 50% of the viewport', () => {
        const pm = new PrimitiveMeta();
        pm.resize(800, 600);
        expect(pm.width).toBe(400);
        expect(pm.height).toBe(300);
    });

    it('no-op when dimensions unchanged', () => {
        const pm = new PrimitiveMeta();
        pm.resize(800, 600);
        const imageData = pm.imageData;
        pm.resize(800, 600);
        expect(pm.imageData).toBe(imageData);
    });
});

describe('PrimitiveMeta.drawBlock', () => {
    function make() {
        const pm = new PrimitiveMeta();
        pm.resize(800, 600);
        return pm;
    }

    it('encodes xHeightPx into R channel', () => {
        const pm = make();
        pm.drawBlock(0, 0, 20, 20, { xHeightPx: 7 });
        const idx = (5 * pm.width + 5) * 4;
        expect(pm.imageData.data[idx]).toBe(7);
        expect(pm.imageData.data[idx + 1]).toBe(0);
        expect(pm.imageData.data[idx + 2]).toBe(0);
        expect(pm.imageData.data[idx + 3]).toBe(0);
    });

    it('clamps xHeightPx ≥ 255 to 255 (pathological huge text)', () => {
        const pm = make();
        pm.drawBlock(0, 0, 20, 20, { xHeightPx: 1000 });
        const idx = (5 * pm.width + 5) * 4;
        expect(pm.imageData.data[idx]).toBe(255);
    });

    it('clamps negative or NaN xHeightPx to 0', () => {
        const pm = make();
        pm.drawBlock(0, 0, 20, 20, { xHeightPx: -5 });
        const idx1 = (5 * pm.width + 5) * 4;
        expect(pm.imageData.data[idx1]).toBe(0);

        pm.clear();
        pm.drawBlock(0, 0, 20, 20, { xHeightPx: NaN });
        const idx2 = (5 * pm.width + 5) * 4;
        expect(pm.imageData.data[idx2]).toBe(0);
    });

    it('missing meta writes zeros (shader falls back to baseline)', () => {
        const pm = make();
        pm.drawBlock(0, 0, 20, 20);
        const idx = (5 * pm.width + 5) * 4;
        expect(pm.imageData.data[idx]).toBe(0);
    });

    it('floors fractional xHeightPx (uint8 encoding)', () => {
        const pm = make();
        pm.drawBlock(0, 0, 20, 20, { xHeightPx: 7.9 });
        const idx = (5 * pm.width + 5) * 4;
        expect(pm.imageData.data[idx]).toBe(7);
    });

    it('last write wins for overlapping regions', () => {
        const pm = make();
        pm.drawBlock(0, 0, 40, 40, { xHeightPx: 12 });
        pm.drawBlock(10, 10, 20, 20, { xHeightPx: 8 });
        const sx = Math.floor(15 * 0.5);
        const sy = Math.floor(15 * 0.5);
        const idx = (sy * pm.width + sx) * 4;
        expect(pm.imageData.data[idx]).toBe(8);
    });

    it('does not throw when block extends past canvas edge', () => {
        const pm = make();
        expect(() => pm.drawBlock(750, 500, 200, 200, { xHeightPx: 10 })).not.toThrow();
    });

    it('skips zero-extent blocks', () => {
        const pm = make();
        const before = Array.from(pm.imageData.data);
        pm.drawBlock(10, 10, 0, 20, { xHeightPx: 10 });
        expect(Array.from(pm.imageData.data)).toEqual(before);
    });
});

describe('PrimitiveMeta.clear', () => {
    it('zeros the buffer', () => {
        const pm = new PrimitiveMeta();
        pm.resize(800, 600);
        pm.drawBlock(0, 0, 20, 20, { xHeightPx: 7 });
        pm.clear();
        expect(pm.imageData.data.every(b => b === 0)).toBe(true);
    });
});
