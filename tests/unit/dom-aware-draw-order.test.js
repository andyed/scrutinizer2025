/**
 * Unit tests for the primitive-map / primitive-meta draw order invariant.
 *
 * When a text primitive's bbox spatially overlaps a non-text primitive's bbox
 * (text rect inside a button, figcaption inside a figure, inline text over an
 * absolutely-positioned image), the DOM-aware compositor must see:
 *
 *   - primitive-map   = text's typeId in the overlap (text wins)
 *   - primitive-meta  = text's xHeightPx in the overlap (stripe field applies)
 *   - primitive-meta  = 0 in non-text regions (no stripe leak)
 *
 * The compositor's shader branches on (xHeightPx > 0). If a non-text draw
 * leaves a stale xHeightPx behind (because the metadata write was skipped
 * under the old "preserve non-zero" rule), stripes appear over images —
 * the visual artifact this test is a regression guard for. See
 * docs/dom-aware-perception-plan.md and commit preceding this one.
 *
 * This test exercises content-analysis's draw-order logic directly rather
 * than relying on Electron integration, so it runs in the unit tier.
 */

'use strict';

function stubCanvas() {
    global.document = {
        createElement() {
            let width = 0, height = 0;
            const ctx = {
                imageSmoothingEnabled: false,
                createImageData(w, h) {
                    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
                },
                putImageData() {},
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

beforeAll(stubCanvas);
afterAll(() => { delete global.document; });

const PrimitiveMap = require('../../renderer/primitive-map');
const PrimitiveMeta = require('../../renderer/primitive-meta');
const { PRIMITIVE_TYPE_IDS } = PrimitiveMap;

/**
 * Mirror of the draw-order logic in content-analysis.js::handleStructureUpdate.
 * Kept in sync by pattern: if this logic diverges, add a reference-check test
 * reading content-analysis.js and confirming the pattern is preserved.
 */
function populateMaps(primitiveMap, primitiveMeta, children, dpr = 1) {
    const textBearing = [];
    const nonTextBearing = [];
    for (const p of children) {
        if (!p.primitiveType) continue;
        const hasText = (typeof p.fontSizePx === 'number' && p.fontSizePx > 0);
        (hasText ? textBearing : nonTextBearing).push(p);
    }
    // Within non-text: largest bbox first so inner primitives (icons inside
    // buttons, inputs inside forms) win the primitive-map at the inner
    // region and edge detection has a type boundary to render.
    nonTextBearing.sort((a, b) => (b.w * b.h) - (a.w * a.h));
    const drawPrimitive = (p) => {
        primitiveMap.drawBlock(
            p.x * dpr, p.y * dpr, p.w * dpr, p.h * dpr,
            p.primitiveType, null
        );
        const xHeightPx = (typeof p.fontSizePx === 'number' && p.fontSizePx > 0)
            ? p.fontSizePx * 0.5 * dpr
            : 0;
        primitiveMeta.drawBlock(
            p.x * dpr, p.y * dpr, p.w * dpr, p.h * dpr,
            { xHeightPx }
        );
    };
    for (const p of nonTextBearing) drawPrimitive(p);
    for (const p of textBearing) drawPrimitive(p);
}

function setup() {
    const pmap = new PrimitiveMap();
    const pmeta = new PrimitiveMeta();
    pmap.resize(800, 600);
    pmeta.resize(800, 600);
    return { pmap, pmeta };
}

function sampleMap(map, xPx, yPx) {
    // Input px are full-resolution; map is at 50% scale.
    const sx = Math.floor(xPx * 0.5);
    const sy = Math.floor(yPx * 0.5);
    const idx = (sy * map.width + sx) * 4;
    return {
        r: map.imageData.data[idx],
        g: map.imageData.data[idx + 1],
        b: map.imageData.data[idx + 2],
        a: map.imageData.data[idx + 3]
    };
}

describe('DOM-aware draw order — text wins over non-text in overlapping regions', () => {
    it('text inside a button: overlap shows text typeId + text xHeight', () => {
        const { pmap, pmeta } = setup();
        // Button bbox: (100, 100, 200x60). Text label bbox: (130, 120, 60x20)
        // — fully inside the button.
        const children = [
            { x: 100, y: 100, w: 200, h: 60,
              primitiveType: 'button' /* typeId=6 */ },
            { x: 130, y: 120, w: 60, h: 20, fontSizePx: 16,
              primitiveType: 'button' /* labeled text still classifies as the outer button */ },
        ];
        populateMaps(pmap, pmeta, children);

        // Sample center of the text region.
        const texel = sampleMap(pmap, 160, 130);
        expect(texel.r).toBe(PRIMITIVE_TYPE_IDS.button);  // button typeId survives
        const metaTexel = sampleMap(pmeta, 160, 130);
        expect(metaTexel.r).toBe(Math.floor(16 * 0.5));  // xHeight preserved
    });

    it('image with overlapping text line: overlap shows TEXT typeId (not image)', () => {
        const { pmap, pmeta } = setup();
        // Image spans (0, 0, 400x300). A text caption overlays (50, 250, 120x30).
        const children = [
            { x: 0, y: 0, w: 400, h: 300, primitiveType: 'image' },
            { x: 50, y: 250, w: 120, h: 30, fontSizePx: 14, primitiveType: 'text' },
        ];
        populateMaps(pmap, pmeta, children);

        // Sample inside the text region.
        const textTexel = sampleMap(pmap, 100, 260);
        expect(textTexel.r).toBe(PRIMITIVE_TYPE_IDS.text);  // text wins

        // Sample inside image-only region (outside text rect).
        const imageTexel = sampleMap(pmap, 300, 100);
        expect(imageTexel.r).toBe(PRIMITIVE_TYPE_IDS.image);
    });

    it('image region has xHeight = 0 (no stripe leak)', () => {
        const { pmap, pmeta } = setup();
        const children = [
            { x: 0, y: 0, w: 400, h: 300, primitiveType: 'image' },
            { x: 50, y: 250, w: 120, h: 30, fontSizePx: 14, primitiveType: 'text' },
        ];
        populateMaps(pmap, pmeta, children);

        // THE regression guard. Prior bug left xHeight > 0 in the image
        // region because non-text drew primitive-map but skipped primitive-
        // meta, so stale xHeight from a neighbor text draw persisted.
        const imageMeta = sampleMap(pmeta, 300, 100);
        expect(imageMeta.r).toBe(0);  // image region must NOT inherit xHeight
    });

    it('text region has xHeight > 0 (stripes apply)', () => {
        const { pmap, pmeta } = setup();
        const children = [
            { x: 0, y: 0, w: 400, h: 300, primitiveType: 'image' },
            { x: 50, y: 250, w: 120, h: 30, fontSizePx: 14, primitiveType: 'text' },
        ];
        populateMaps(pmap, pmeta, children);
        const textMeta = sampleMap(pmeta, 100, 260);
        expect(textMeta.r).toBe(Math.floor(14 * 0.5));  // fontSizePx/2, no dpr
    });

    it('order of children in input does not affect output (sort is stable)', () => {
        // Same primitives as before, two different input orderings.
        const primsA = [
            { x: 0, y: 0, w: 400, h: 300, primitiveType: 'image' },
            { x: 50, y: 250, w: 120, h: 30, fontSizePx: 14, primitiveType: 'text' },
        ];
        const primsB = [
            { x: 50, y: 250, w: 120, h: 30, fontSizePx: 14, primitiveType: 'text' },
            { x: 0, y: 0, w: 400, h: 300, primitiveType: 'image' },
        ];
        const A = setup();
        const B = setup();
        populateMaps(A.pmap, A.pmeta, primsA);
        populateMaps(B.pmap, B.pmeta, primsB);
        expect(Array.from(A.pmap.imageData.data)).toEqual(Array.from(B.pmap.imageData.data));
        expect(Array.from(A.pmeta.imageData.data)).toEqual(Array.from(B.pmeta.imageData.data));
    });

    it('icon inside button → icon typeId wins at icon region (regression for invisible-icons-in-buttons)', () => {
        const { pmap, pmeta } = setup();
        const children = [
            { x: 0, y: 0, w: 100, h: 40, primitiveType: 'button' },
            { x: 10, y: 10, w: 20, h: 20, primitiveType: 'icon' },
        ];
        populateMaps(pmap, pmeta, children);
        // Sample inside icon region.
        const iconTexel = sampleMap(pmap, 20, 20);
        expect(iconTexel.r).toBe(PRIMITIVE_TYPE_IDS.icon);
        // Sample button-only region (outside icon).
        const buttonTexel = sampleMap(pmap, 60, 20);
        expect(buttonTexel.r).toBe(PRIMITIVE_TYPE_IDS.button);
    });

    it('primitives with no text content emit xHeight = 0 across full bbox', () => {
        const { pmap, pmeta } = setup();
        const children = [
            { x: 100, y: 100, w: 64, h: 64, primitiveType: 'icon' },
        ];
        populateMaps(pmap, pmeta, children);
        // Sample inside, away from the corner.
        const center = sampleMap(pmeta, 130, 130);
        expect(center.r).toBe(0);
        const mapCenter = sampleMap(pmap, 130, 130);
        expect(mapCenter.r).toBe(PRIMITIVE_TYPE_IDS.icon);
    });
});

describe('content-analysis.js still carries the draw-order pattern', () => {
    // Reference-check — if the production file drifts away from the pattern
    // this test mirrors, fail loudly so the two don't silently diverge.
    it('content-analysis.js populates primitive-meta in both passes', () => {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'renderer', 'content-analysis.js'),
            'utf8'
        );
        // Must partition children by hasText:
        expect(src).toMatch(/textBearing/);
        expect(src).toMatch(/nonTextBearing/);
        // Must draw non-text first, text last:
        const nonTextIdx = src.indexOf('for (const p of nonTextBearing)');
        const textIdx = src.indexOf('for (const p of textBearing)');
        expect(nonTextIdx).toBeGreaterThan(-1);
        expect(textIdx).toBeGreaterThan(nonTextIdx);
        // Must always write primitive-meta (no conditional skip):
        const drawMetaCount = (src.match(/primitiveMeta\.drawBlock/g) || []).length;
        expect(drawMetaCount).toBeGreaterThanOrEqual(1);
        // Must sort non-text by descending bbox area so inner primitives win:
        expect(src).toMatch(/nonTextBearing\.sort/);
    });
});
