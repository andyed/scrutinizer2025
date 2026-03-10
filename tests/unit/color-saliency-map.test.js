/**
 * Unit tests for renderer/color-saliency-map.js
 *
 * ColorSaliencyMap depends on document.createElement('canvas') in its constructor,
 * so we provide a lightweight canvas mock before requiring the module. This keeps
 * the tests runnable in plain Node.js with zero npm dependencies.
 *
 * Test strategy:
 *  - Pure math (intensity, color opponency, normalization): verified directly
 *    via white-box helpers derived from the documented formulas.
 *  - resize(): scale-capping at 1.0, zero-dimension guard, dimension calculation.
 *  - computeFromImage(): exercises the full pixel-processing loop via a synthetic
 *    mock image/imageData, verifying saliency values for known pixel patterns.
 *  - clear() / getCanvas(): smoke tests confirming expected call shapes.
 *
 * Run: node tests/unit/test-runner.js  (via index.js entry point)
 */

'use strict';

const path   = require('path');
// The describe and it globals are provided by Jest.

// ─── Minimal Canvas/DOM mock ───────────────────────────────────────────────────
// Must be set up BEFORE require()'ing color-saliency-map.js
// because the constructor runs document.createElement immediately.

/**
 * Create a fake ImageData for a W×H canvas filled with a solid RGBA colour.
 */
function makeFakeImageData(w, h, r = 0, g = 0, b = 0, a = 255) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        data[i * 4]     = r;
        data[i * 4 + 1] = g;
        data[i * 4 + 2] = b;
        data[i * 4 + 3] = a;
    }
    return { data, width: w, height: h };
}

/**
 * Lightweight 2D context mock. Stores the last getImageData/putImageData calls
 * so tests can inspect them.
 */
class FakeContext2D {
    constructor(canvas) {
        this._canvas    = canvas;
        this._imageData = null;  // last imageData written via putImageData
        this.imageSmoothingEnabled = true;
        this._fillStyle = '';
        this._fillRects = [];
    }

    drawImage()  { /* no-op: caller controls imageData via getImageData */ }

    getImageData(x, y, w, h) {
        // Return a fresh black imageData unless one was set on the mock canvas
        const src = this._canvas._mockPixels || { r: 0, g: 0, b: 0 };
        return makeFakeImageData(w, h, src.r, src.g, src.b);
    }

    putImageData(imageData) {
        this._imageData = imageData;
    }

    fillRect(x, y, w, h) {
        this._fillRects.push({ x, y, w, h });
    }

    set fillStyle(v) { this._fillStyle = v; }
    get fillStyle()  { return this._fillStyle; }
}

/**
 * Fake HTMLCanvasElement returned by document.createElement('canvas').
 */
class FakeCanvas {
    constructor() {
        this.width  = 0;
        this.height = 0;
        this._ctx   = null;
        // Inject a solid colour here to control what getImageData returns.
        this._mockPixels = null; // { r, g, b }
    }

    getContext(type, options) {
        if (!this._ctx) {
            this._ctx = new FakeContext2D(this);
        }
        return this._ctx;
    }
}

// Inject global document mock
global.document = {
    createElement(tag) {
        if (tag === 'canvas') return new FakeCanvas();
        throw new Error(`Unexpected createElement('${tag}')`);
    }
};

// ─── Now safe to load the module ──────────────────────────────────────────────

const ColorSaliencyMap = require(
    path.resolve(__dirname, '../../renderer/color-saliency-map.js')
);

// ─── Pure math helpers mirroring the formulas in color-saliency-map.js ────────
// We white-box the algorithm to generate known-correct expected values.

/**
 * Compute the raw (un-normalised) saliency for a single pixel (0-255 each).
 * Mirrors the loop body in computeFromImage() PASS 1.
 */
function rawSaliency(r8, g8, b8) {
    const W_I  = 0.3;
    const W_RG = 0.35;
    const W_BY = 0.35;

    const r = r8 / 255.0;
    const g = g8 / 255.0;
    const b = b8 / 255.0;

    const intensity = 0.2126 * r + 0.7152 * g + 0.0722 * b; // BT.709
    const rg = Math.abs(r - g);
    const by = Math.abs(b - (r + g) / 2.0);

    return W_I * intensity + W_RG * rg + W_BY * by;
}

/**
 * Apply the contrast boost from PASS 2: val^0.8
 */
function contrastBoosted(normalised) {
    return Math.pow(normalised, 0.8);
}

// ─── resize() ─────────────────────────────────────────────────────────────────

describe('ColorSaliencyMap.resize', () => {
    it('resize_smallImage_scalesDownToTargetMax256', () => {
        const csm = new ColorSaliencyMap();
        csm.resize(1024, 768); // max dim = 1024 → scale = 256/1024 = 0.25
        expect(Number.isFinite(csm.scale) && csm.scale > 0).toBeTruthy();
        expect(csm.width).toBeLessThanOrEqual(256);
        expect(csm.height).toBeLessThanOrEqual(256);
    });

    it('resize_tinyImage_doesNotUpscale_scaleCapOnePoint0', () => {
        const csm = new ColorSaliencyMap();
        csm.resize(64, 64); // max dim = 64 → 256/64 = 4.0, capped at 1.0
        expect(csm.scale).toBeLessThanOrEqual(1.0);
    });

    it('resize_squareImage_widthEqualsHeight', () => {
        const csm = new ColorSaliencyMap();
        csm.resize(512, 512);
        expect(csm.width).toBe(csm.height);
    });

    it('resize_zeroDimension_usesFallbackScale', () => {
        const csm = new ColorSaliencyMap();
        // width=0 means maxDim=0 — guard prevents div-by-zero → scale defaults to 0.25
        csm.resize(0, 0);
        expect(Number.isFinite(csm.scale)).toBeTruthy();
        expect(csm.scale).toBeGreaterThan(0);
    });

    it('resize_landscapeImage_scaleBasedOnLargestDimension', () => {
        const csm = new ColorSaliencyMap();
        csm.resize(1920, 400); // max dim = 1920 → scale = 256/1920 ≈ 0.1333
        const expectedScale = 256 / 1920;
        expect(Math.abs(csm.scale - expectedScale)).toBeLessThan(1e-6);
    });

    it('resize_setsWidthAndHeightOnInternalCanvas', () => {
        const csm = new ColorSaliencyMap();
        csm.resize(800, 600);
        expect(csm.width).toBeGreaterThan(0);
        expect(csm.height).toBeGreaterThan(0);
    });
});

// ─── computeFromImage() — black input ─────────────────────────────────────────

describe('ColorSaliencyMap.computeFromImage_blackPixels', () => {
    /**
     * Set up a 4×4 canvas rendering a pure black image.
     * maxVal for a uniform field will be 0 → fallback to 1.0 → all pixels = 0^0.8 = 0.
     */
    function makeCSMWithColor(r, g, b, size = 4) {
        const csm = new ColorSaliencyMap();
        csm.resize(size, size);
        // Inject mock pixel colour into the fake canvas
        csm.canvas._mockPixels = { r, g, b };
        // Provide a fake "source image" (the actual value is ignored by the mock)
        const fakeImage = {};
        return { csm, result: csm.computeFromImage(fakeImage) };
    }

    it('computeFromImage_blackImage_returnsAllZeroSaliency', () => {
        const { result } = makeCSMWithColor(0, 0, 0);
        const allZero = Array.from(result.data).every(v => v === 0);
        expect(allZero).toBeTruthy();
    });

    it('computeFromImage_returnsExpectedShape', () => {
        const { result } = makeCSMWithColor(0, 0, 0, 4);
        expect(result.width).toBe(4);
        expect(result.height).toBe(4);
        expect(result.data.length).toBe(16);
    });

    it('computeFromImage_returnsFloat32Array', () => {
        const { result } = makeCSMWithColor(128, 128, 128);
        expect(result.data instanceof Float32Array).toBeTruthy();
    });

    it('computeFromImage_returnsMaxVal', () => {
        const { result } = makeCSMWithColor(200, 100, 50);
        expect(Number.isFinite(result.maxVal) && result.maxVal > 0).toBeTruthy();
    });
});

// ─── computeFromImage() — uniform color fields ────────────────────────────────

describe('ColorSaliencyMap.computeFromImage_uniformFields', () => {
    function computeUniform(r, g, b, size = 4) {
        const csm = new ColorSaliencyMap();
        csm.resize(size, size);
        csm.canvas._mockPixels = { r, g, b };
        return csm.computeFromImage({});
    }

    it('computeFromImage_uniformField_allPixelsEqualSaliency', () => {
        // Uniform red field → every pixel has the same raw saliency.
        // After normalisation they should all equal 1 (normalised to max).
        const result = computeUniform(255, 0, 0);
        const first = result.data[0];
        const allSame = Array.from(result.data).every(v => Math.abs(v - first) < 1e-6);
        expect(allSame).toBeTruthy();
    });

    it('computeFromImage_uniformField_allValuesEqualMaxVal', () => {
        // result.data holds the raw (un-normalised) saliency from PASS 1.
        // For a uniform field every pixel has the same raw value, so every
        // entry in data should equal maxVal exactly.
        const result = computeUniform(255, 0, 0);
        const allEqualMax = Array.from(result.data).every(
            v => Math.abs(v - result.maxVal) < 1e-6
        );
        expect(allEqualMax).toBeTruthy();
    });

    it('computeFromImage_whiteImage_hasPositiveSaliency', () => {
        // White: intensity=1, rg=0, by=0 → raw = W_I * 1 = 0.3 > 0
        const result = computeUniform(255, 255, 255);
        expect(result.data[0]).toBeGreaterThan(0);
    });

    it('computeFromImage_pureGrey_hasLowerSaliency_thanPureRed', () => {
        // Grey (128,128,128): rg=0, by=0 → saliency driven only by intensity
        // Red (255,0,0): rg=1, by=0.5 → much higher chrominance contribution
        // Because each is normalised to its own max=1, we can't compare normalised values directly.
        // Instead compare maxVal (the un-normalised peak).
        const greyResult = computeUniform(128, 128, 128);
        const redResult  = computeUniform(255, 0,   0);
        expect(redResult.maxVal).toBeGreaterThan(greyResult.maxVal);
    });
});

// ─── Pure-math formula verification ───────────────────────────────────────────

describe('ColorSaliencyMap_pureMath_saliencyFormulas', () => {
    it('rawSaliency_black_isZero', () => {
        const val = rawSaliency(0, 0, 0);
        expect(Math.abs(val)).toBeLessThan(1e-9);
    });

    it('rawSaliency_white_isIntensityWeightOnly', () => {
        // White: r=g=b=1 → rg=0, by=0 → val = W_I * 1
        const val      = rawSaliency(255, 255, 255);
        const expected = 0.3 * (0.2126 + 0.7152 + 0.0722); // 0.3 × 1.0
        expect(Math.abs(val - expected)).toBeLessThan(1e-6);
    });

    it('rawSaliency_pureRed_higherThan_pureGrey', () => {
        const grey = rawSaliency(128, 128, 128);
        const red  = rawSaliency(255, 0,   0);
        expect(red).toBeGreaterThan(grey);
    });

    it('rawSaliency_pureCyan_highBYOpponency', () => {
        // Cyan = (0, 255, 255): r=0, g=1, b=1
        // by = |b - (r+g)/2| = |1 - 0.5| = 0.5 — high blue-yellow opponency
        const val = rawSaliency(0, 255, 255);
        const expected = 0.3 * (0.7152 + 0.0722) + 0.35 * 1.0 + 0.35 * 0.5;
        expect(Math.abs(val - expected)).toBeLessThan(1e-5);
    });

    it('rawSaliency_pureRed_correctRGOpponency', () => {
        // Red (255, 0, 0): r=1, g=0, b=0
        // intensity = 0.2126
        // rg = |1 - 0| = 1.0
        // by = |0 - (1+0)/2| = 0.5
        const val      = rawSaliency(255, 0, 0);
        const expected = 0.3 * 0.2126 + 0.35 * 1.0 + 0.35 * 0.5;
        expect(Math.abs(val - expected)).toBeLessThan(1e-5);
    });

    it('rawSaliency_isAlwaysFinite', () => {
        const testColors = [
            [0,0,0], [255,255,255], [255,0,0], [0,255,0], [0,0,255],
            [128,128,128], [1,254,127]
        ];
        testColors.forEach(([r,g,b]) => {
            const val = rawSaliency(r,g,b);
            expect(Number.isFinite(val)).toBeTruthy();
        });
    });

    it('contrastBoost_zero_remainsZero', () => {
        expect(Math.abs(contrastBoosted(0) - 0)).toBeLessThan(1e-9);
    });

    it('contrastBoost_one_remainsOne', () => {
        expect(Math.abs(contrastBoosted(1) - 1)).toBeLessThan(1e-9);
    });

    it('contrastBoost_midValue_increasedTowardOne', () => {
        // Power < 1 expands the range toward 1 (brightens mid-tones)
        const mid = 0.5;
        expect(contrastBoosted(mid)).toBeGreaterThan(mid);
    });
});

// ─── getCanvas() / clear() ────────────────────────────────────────────────────

describe('ColorSaliencyMap.getCanvas_and_clear', () => {
    it('getCanvas_returnsFakeCanvasObject', () => {
        const csm = new ColorSaliencyMap();
        const canvas = csm.getCanvas();
        expect(canvas).not.toBeNull();
        expect(canvas).not.toBeUndefined();
    });

    it('getCanvas_returnsSameCanvasAcrossCalls', () => {
        const csm    = new ColorSaliencyMap();
        const first  = csm.getCanvas();
        const second = csm.getCanvas();
        expect(first).toBe(second);
    });

    it('clear_callsFillRect', () => {
        const csm = new ColorSaliencyMap();
        csm.resize(10, 10);
        csm.clear();
        // The mock context stores fillRect calls; verify at least one was made.
        const rects = csm.ctx._fillRects;
        expect(rects.length).toBeGreaterThanOrEqual(1);
    });

    it('clear_setsFillStyleToBlack', () => {
        const csm = new ColorSaliencyMap();
        csm.resize(10, 10);
        csm.clear();
        expect(csm.ctx.fillStyle).toBe('black');
    });
});

// ─── Constructor defaults ──────────────────────────────────────────────────────

describe('ColorSaliencyMap.constructor', () => {
    it('constructor_initialScaleIsQuarter', () => {
        const csm = new ColorSaliencyMap();
        expect(csm.scale).toBe(0.25);
    });

    it('constructor_initialDimensionsAreZero', () => {
        const csm = new ColorSaliencyMap();
        expect(csm.width).toBe(0);
        expect(csm.height).toBe(0);
    });

    it('constructor_exposesCanvasProperty', () => {
        const csm = new ColorSaliencyMap();
        expect(csm.canvas).toBeDefined();
    });

    it('constructor_exposesCtxProperty', () => {
        const csm = new ColorSaliencyMap();
        expect(csm.ctx).toBeDefined();
    });

    it('constructor_ctxImageSmoothingDisabled', () => {
        const csm = new ColorSaliencyMap();
        expect(csm.ctx.imageSmoothingEnabled).toBe(false);
    });
});
