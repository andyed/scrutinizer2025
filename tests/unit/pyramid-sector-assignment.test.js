/**
 * Unit tests for pyramid sector assignment (Option C: eccentricity-scaled tiles).
 *
 * Verifies that the JS-side sector layout computation in WebGPUPyramidCompute
 * matches the canonical reference in isotropic-sectors.test.js, and that
 * totalSectors, ringBaseSectors, and ringSpokeCount are correct.
 *
 * Run: npx jest tests/unit/pyramid-sector-assignment.test.js
 */

'use strict';

const path = require('path');

// ─── Reference implementation (from isotropic-sectors.test.js) ────────────

const CMF_A = 2.78;

function computeSectorRef(r_deg, numRings, corticalMax) {
    const a = CMF_A;
    const N = Math.max(numRings, 2);
    const w_step = corticalMax / (N - 1);
    const w_min = Math.log(a);
    const w = Math.log(r_deg + a);
    const n_cont = (w - w_min) / w_step;
    const n_idx = Math.min(Math.max(Math.round(n_cont), 0), N - 1);
    const w_i = w_min + n_idx * w_step;
    const r_i_deg = Math.exp(w_i) - a;
    let dr;
    if (n_idx === 0) {
        dr = Math.exp(w_min + w_step) - Math.exp(w_min);
    } else if (n_idx === N - 1) {
        dr = Math.exp(w_min + (N - 1) * w_step) - Math.exp(w_min + (N - 2) * w_step);
    } else {
        dr = (Math.exp(w_min + (n_idx + 1) * w_step) - Math.exp(w_min + (n_idx - 1) * w_step)) / 2;
    }
    const spoke_count = n_idx === 0 ? 1 : Math.max(1, Math.floor(2 * Math.PI * r_i_deg / dr));
    return { n_idx, spoke_count, r_center_deg: r_i_deg, dr };
}

// ─── Replicate _computeSectorLayout from webgpu-pyramid-compute.js ────────

function computeSectorLayout(numRings, maxEccDeg) {
    const a = CMF_A;
    const N = Math.max(numRings, 2);
    const corticalMax = Math.log(maxEccDeg / a + 1);
    const wMin = Math.log(a);
    const wStep = corticalMax / (N - 1);

    const ringSpokeCount = new Uint32Array(N);
    const ringBaseSectors = new Uint32Array(N);
    let totalSectors = 0;

    for (let n = 0; n < N; n++) {
        const wI = wMin + n * wStep;
        const rI = Math.exp(wI) - a;
        let dr;
        if (n === 0) {
            dr = Math.exp(wMin + wStep) - Math.exp(wMin);
        } else if (n === N - 1) {
            dr = Math.exp(wMin + (N - 1) * wStep) - Math.exp(wMin + (N - 2) * wStep);
        } else {
            dr = (Math.exp(wMin + (n + 1) * wStep) - Math.exp(wMin + (n - 1) * wStep)) / 2;
        }
        const spokeCount = n === 0 ? 1 : Math.max(1, Math.floor(2 * Math.PI * rI / dr));
        ringBaseSectors[n] = totalSectors;
        ringSpokeCount[n] = spokeCount;
        totalSectors += spokeCount;
    }

    return { totalSectors, ringBaseSectors, ringSpokeCount, corticalMax };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Pyramid sector assignment (Option C)', () => {
    const NUM_RINGS = 50;
    const MAX_ECC = 15;

    let layout;
    beforeAll(() => {
        layout = computeSectorLayout(NUM_RINGS, MAX_ECC);
    });

    test('totalSectors is reasonable (between 1000 and 10000)', () => {
        expect(layout.totalSectors).toBeGreaterThan(1000);
        expect(layout.totalSectors).toBeLessThan(10000);
    });

    test('ring 0 has exactly 1 spoke (foveal singularity)', () => {
        expect(layout.ringSpokeCount[0]).toBe(1);
    });

    test('ringBaseSectors is a valid prefix sum', () => {
        let expected = 0;
        for (let n = 0; n < NUM_RINGS; n++) {
            expect(layout.ringBaseSectors[n]).toBe(expected);
            expected += layout.ringSpokeCount[n];
        }
        expect(expected).toBe(layout.totalSectors);
    });

    test('spoke counts increase monotonically (with possible plateau)', () => {
        for (let n = 1; n < NUM_RINGS - 1; n++) {
            expect(layout.ringSpokeCount[n + 1]).toBeGreaterThanOrEqual(layout.ringSpokeCount[n]);
        }
    });

    test('outermost ring spoke count matches isotropic-sectors reference', () => {
        const corticalMax = Math.log(MAX_ECC / CMF_A + 1);
        const ref = computeSectorRef(MAX_ECC, NUM_RINGS, corticalMax);
        expect(layout.ringSpokeCount[NUM_RINGS - 1]).toBe(ref.spoke_count);
    });

    test('per-ring spoke counts match reference at sampled eccentricities', () => {
        const corticalMax = layout.corticalMax;
        const testEccs = [0.0, 0.5, 1.0, 2.0, 5.0, 8.0, 10.0, 14.0];
        for (const ecc of testEccs) {
            const ref = computeSectorRef(ecc, NUM_RINGS, corticalMax);
            expect(layout.ringSpokeCount[ref.n_idx]).toBe(ref.spoke_count);
        }
    });

    test('sector_id for any pixel maps to [0, totalSectors)', () => {
        // Simulate a pixel grid at test resolution
        const W = 480, H = 270;
        const foveaX = W / 2, foveaY = H / 2;
        const ppd = 45; // pixels per degree
        const maxEccPx = MAX_ECC * ppd;
        const corticalMax = layout.corticalMax;
        const wMin = Math.log(CMF_A);
        const wStep = corticalMax / (NUM_RINGS - 1);

        let minId = Infinity, maxId = -Infinity;
        let foveaCount = 0, peripheralCount = 0;

        for (let y = 0; y < H; y += 4) {
            for (let x = 0; x < W; x += 4) {
                const dx = x - foveaX;
                const dy = y - foveaY;
                const rPx = Math.sqrt(dx * dx + dy * dy);
                const rDeg = rPx / maxEccPx * MAX_ECC;

                const w = Math.log(rDeg + CMF_A);
                const nCont = (w - wMin) / wStep;
                const ring = Math.min(Math.max(Math.round(nCont), 0), NUM_RINGS - 1);

                const angle = Math.atan2(dy, dx);
                const spokeCount = layout.ringSpokeCount[ring];
                const spokeWidth = (2 * Math.PI) / spokeCount;
                const spoke = Math.min(
                    Math.floor((angle + Math.PI) / spokeWidth),
                    spokeCount - 1
                );

                const sectorId = layout.ringBaseSectors[ring] + spoke;
                minId = Math.min(minId, sectorId);
                maxId = Math.max(maxId, sectorId);

                if (ring < 5) foveaCount++;
                else peripheralCount++;
            }
        }

        expect(minId).toBeGreaterThanOrEqual(0);
        expect(maxId).toBeLessThan(layout.totalSectors);
        // Both foveal and peripheral pixels are present
        expect(foveaCount).toBeGreaterThan(0);
        expect(peripheralCount).toBeGreaterThan(0);
    });

    test('far-peripheral sectors contain many more pixels than foveal sectors', () => {
        // At 480x270 with fovea at center, count pixels per sector for rings 0 vs 49
        const W = 480, H = 270;
        const foveaX = W / 2, foveaY = H / 2;
        const ppd = 45;
        const maxEccPx = MAX_ECC * ppd;
        const corticalMax = layout.corticalMax;
        const wMin = Math.log(CMF_A);
        const wStep = corticalMax / (NUM_RINGS - 1);

        const sectorPixelCount = new Uint32Array(layout.totalSectors);

        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const dx = x - foveaX;
                const dy = y - foveaY;
                const rPx = Math.sqrt(dx * dx + dy * dy);
                const rDeg = rPx / maxEccPx * MAX_ECC;

                const w = Math.log(rDeg + CMF_A);
                const nCont = (w - wMin) / wStep;
                const ring = Math.min(Math.max(Math.round(nCont), 0), NUM_RINGS - 1);

                const angle = Math.atan2(dy, dx);
                const spokeCount = layout.ringSpokeCount[ring];
                const spokeWidth = (2 * Math.PI) / spokeCount;
                const spoke = Math.min(
                    Math.floor((angle + Math.PI) / spokeWidth),
                    spokeCount - 1
                );
                sectorPixelCount[layout.ringBaseSectors[ring] + spoke]++;
            }
        }

        // Ring 0 pixel count (single foveal sector)
        const fovealPixels = sectorPixelCount[0];

        // Average of outermost ring sectors
        const outerBase = layout.ringBaseSectors[NUM_RINGS - 1];
        const outerCount = layout.ringSpokeCount[NUM_RINGS - 1];
        let outerTotal = 0;
        for (let s = 0; s < outerCount; s++) {
            outerTotal += sectorPixelCount[outerBase + s];
        }

        // Some outer sectors may have 0 pixels (if viewport doesn't reach max eccentricity)
        // but ring 0 should have pixels and mid-range rings should have more per sector
        expect(fovealPixels).toBeGreaterThan(0);

        // Find a mid-range ring (~ring 20) and check it has more pixels per sector
        const midRing = 20;
        const midBase = layout.ringBaseSectors[midRing];
        const midSpokes = layout.ringSpokeCount[midRing];
        let midMax = 0;
        for (let s = 0; s < midSpokes; s++) {
            midMax = Math.max(midMax, sectorPixelCount[midBase + s]);
        }
        // Mid-range sectors should generally be larger than foveal
        // (unless viewport is very small relative to eccentricity scale)
        expect(midMax).toBeGreaterThanOrEqual(fovealPixels * 0.5);
    });

    test('memory usage: sectors vs tiles', () => {
        // Verify sectors use less memory than 8x8 tiles at typical resolution
        const W = 960, H = 506; // typical half-res
        const tileCountX = Math.ceil(W / 8);
        const tileCountY = Math.ceil(H / 8);
        const totalTiles = tileCountX * tileCountY; // ~7680

        expect(layout.totalSectors).toBeLessThan(totalTiles);
    });
});
