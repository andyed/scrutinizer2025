/**
 * Unit tests for renderer/gestalt-processor.js
 *
 * Tests cover:
 *  - process()       — top-level entry: empty input, single block, multiple blocks
 *  - runDBSCAN()     — clustering: adjacent blocks form a cluster, isolated blocks
 *                       become noise (single-item clusters), large epsilon merges all
 *  - regionQuery()   — edge-to-edge distance math: touching, overlapping, far apart
 *  - expandCluster() — reachability chain: A→B→C where A and C don't directly touch
 *  - mergeClusters() — bounding box union, density averaging, type promotion rules
 *
 * Run: npm run test:unit
 */

'use strict';

const path = require('path');
// The describe and it globals are provided by Jest.

const GestaltProcessor = require(
    path.resolve(__dirname, '../../renderer/gestalt-processor.js')
);

// ─── Block factory ────────────────────────────────────────────────────────────

/**
 * Create a minimal block compatible with GestaltProcessor.
 * All fields required by mergeClusters() are included with sensible defaults.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {object} overrides - Optional field overrides (type, density, lineHeight)
 * @returns {object}
 */
function makeBlock(x, y, w, h, overrides = {}) {
    return {
        x, y, w, h,
        type:       overrides.type       !== undefined ? overrides.type       : 1.0,
        density:    overrides.density    !== undefined ? overrides.density    : 0.5,
        lineHeight: overrides.lineHeight !== undefined ? overrides.lineHeight : 16,
        ...overrides
    };
}

// ─── process() ────────────────────────────────────────────────────────────────

describe('GestaltProcessor.process', () => {
    it('process_emptyArray_returnsEmptyArray', () => {
        const gp = new GestaltProcessor();
        const result = gp.process([]);
        expect(result).toEqual([]);
    });

    it('process_nullInput_returnsEmptyArray', () => {
        const gp = new GestaltProcessor();
        const result = gp.process(null);
        expect(result).toEqual([]);
    });

    it('process_undefinedInput_returnsEmptyArray', () => {
        const gp = new GestaltProcessor();
        const result = gp.process(undefined);
        expect(result).toEqual([]);
    });

    it('process_singleBlock_returnsSingleBlock', () => {
        const gp = new GestaltProcessor();
        const block = makeBlock(100, 100, 50, 20);
        const result = gp.process([block]);
        expect(result.length).toBe(1);
    });

    it('process_returnsArray', () => {
        const gp = new GestaltProcessor();
        const result = gp.process([makeBlock(0, 0, 10, 10)]);
        expect(Array.isArray(result)).toBeTruthy();
    });

    it('process_adjacentBlocks_mergesIntoFewerResults', () => {
        const gp = new GestaltProcessor();
        // Two blocks side by side with a gap of 5px — well within textEpsilonX=60
        const blocks = [
            makeBlock(0,  0, 50, 20),
            makeBlock(55, 0, 50, 20),
        ];
        const result = gp.process(blocks);
        // They should be merged into a single cluster (one output block)
        expect(result.length).toBe(1);
    });

    it('process_widelySpacedBlocks_keepsThemSeparate', () => {
        const gp = new GestaltProcessor();
        // Horizontal gap of 200px — beyond textEpsilonX=60
        const blocks = [
            makeBlock(0,   0, 50, 20),
            makeBlock(300, 0, 50, 20),
        ];
        const result = gp.process(blocks);
        // Each block should remain as its own cluster/noise point
        expect(result.length).toBe(2);
    });

    it('process_outputBlocksHaveBoundingBoxProperties', () => {
        const gp = new GestaltProcessor();
        const result = gp.process([makeBlock(10, 20, 30, 40)]);
        const block = result[0];
        expect('x' in block).toBeTruthy();
        expect('y' in block).toBeTruthy();
        expect('w' in block).toBeTruthy();
        expect('h' in block).toBeTruthy();
    });
});

// ─── regionQuery() ────────────────────────────────────────────────────────────

describe('GestaltProcessor.regionQuery', () => {
    it('regionQuery_sameBlock_returnsItself', () => {
        const gp = new GestaltProcessor();
        const block = makeBlock(0, 0, 50, 50);
        // A block always neighbours itself (distance = 0)
        const neighbors = gp.regionQuery([block], block, 10, 10);
        expect(neighbors.includes(0)).toBeTruthy();
    });

    it('regionQuery_touchingBlock_isIncluded', () => {
        const gp = new GestaltProcessor();
        // Block B starts exactly where block A ends — edge-to-edge distance = 0
        const a = makeBlock(0,  0, 50, 20);
        const b = makeBlock(50, 0, 50, 20);
        const neighbors = gp.regionQuery([a, b], a, 1, 1);
        // Edge gap is 0 which is < epsX=1, so b should be included
        expect(neighbors.includes(1)).toBeTruthy();
    });

    it('regionQuery_gapBeyondEps_blockExcluded', () => {
        const gp = new GestaltProcessor();
        // Gap of 100px horizontally; epsX = 50
        const a = makeBlock(0,   0, 50, 20);
        const b = makeBlock(200, 0, 50, 20);
        const neighbors = gp.regionQuery([a, b], a, 50, 50);
        expect(neighbors.includes(1)).toBeFalsy();
    });

    it('regionQuery_overlappingBlocks_alwaysNeighbors', () => {
        const gp = new GestaltProcessor();
        // Overlapping blocks — negative edge gap clamped to 0 → always within any eps
        const a = makeBlock(0,  0, 100, 50);
        const b = makeBlock(50, 0, 100, 50);
        const neighbors = gp.regionQuery([a, b], a, 0.1, 0.1);
        expect(neighbors.includes(1)).toBeTruthy();
    });

    it('regionQuery_withinEpsX_butBeyondEpsY_excluded', () => {
        const gp = new GestaltProcessor();
        // Horizontally close but vertically far
        const a = makeBlock(0,   0,  50, 20);
        const b = makeBlock(10, 200, 50, 20);
        const neighbors = gp.regionQuery([a, b], a, 100, 10);
        // Vertical gap ≈ 180px > epsY=10
        expect(neighbors.includes(1)).toBeFalsy();
    });

    it('regionQuery_emptyPoints_returnsEmptyArray', () => {
        const gp = new GestaltProcessor();
        const core = makeBlock(0, 0, 10, 10);
        const result = gp.regionQuery([], core, 100, 100);
        expect(result).toEqual([]);
    });
});

// ─── runDBSCAN() ──────────────────────────────────────────────────────────────

describe('GestaltProcessor.runDBSCAN', () => {
    it('runDBSCAN_emptyInput_returnsEmptyClusters', () => {
        const gp = new GestaltProcessor();
        const clusters = gp.runDBSCAN([], 60, 32);
        expect(clusters).toEqual([]);
    });

    it('runDBSCAN_singlePoint_treatedAsNoiseSingleItemCluster', () => {
        const gp = new GestaltProcessor();
        // A single point can never have minPts=2 neighbors, so it is noise.
        // Noise points are kept as single-item clusters.
        const block = makeBlock(0, 0, 50, 20);
        const clusters = gp.runDBSCAN([block], 60, 32);
        expect(clusters.length).toBe(1);
        expect(clusters[0].length).toBe(1);
    });

    it('runDBSCAN_twoAdjacentBlocks_formOneCluster', () => {
        const gp = new GestaltProcessor();
        // Gap of 5px — within epsX=60
        const blocks = [
            makeBlock(0,  0, 50, 20),
            makeBlock(55, 0, 50, 20),
        ];
        const clusters = gp.runDBSCAN(blocks, 60, 32);
        // Both blocks should end up in the same cluster
        const clusterSizes = clusters.map(c => c.length);
        expect(clusterSizes.includes(2)).toBeTruthy();
    });

    it('runDBSCAN_twoDistantBlocks_formTwoClusters', () => {
        const gp = new GestaltProcessor();
        // Gap 300px, epsX=60 — both become noise → two single-item clusters
        const blocks = [
            makeBlock(0,   0, 50, 20),
            makeBlock(400, 0, 50, 20),
        ];
        const clusters = gp.runDBSCAN(blocks, 60, 32);
        expect(clusters.length).toBe(2);
        clusters.forEach((c, i) => {
            expect(c.length).toBe(1);
        });
    });

    it('runDBSCAN_chainReachability_threeInARow_mergesAll', () => {
        const gp = new GestaltProcessor();
        // A─B─C: A and B are close, B and C are close, but A and C are not directly close.
        // DBSCAN chaining should still unify them.
        const blocks = [
            makeBlock(0,   0, 50, 20),  // A
            makeBlock(55,  0, 50, 20),  // B — 5px gap from A
            makeBlock(110, 0, 50, 20),  // C — 5px gap from B
        ];
        const clusters = gp.runDBSCAN(blocks, 60, 32);
        // All three should be in one cluster
        const biggest = Math.max(...clusters.map(c => c.length));
        expect(biggest).toBe(3);
        expect(clusters.length).toBe(1);
    });

    it('runDBSCAN_largeEpsilon_mergesAllBlocks', () => {
        const gp = new GestaltProcessor();
        // With huge epsilon, everything within a page should merge
        const blocks = [
            makeBlock(0,   0, 50, 20),
            makeBlock(100, 0, 50, 20),
            makeBlock(200, 0, 50, 20),
        ];
        const clusters = gp.runDBSCAN(blocks, 1000, 1000);
        expect(clusters.length).toBe(1);
    });

    it('runDBSCAN_zeroEpsilon_eachBlockIsIsolated', () => {
        const gp = new GestaltProcessor();
        // Zero epsilon: only a block's self-overlap (distance=0) qualifies,
        // but that gives only 1 neighbor per block → noise → single-item clusters
        const blocks = [
            makeBlock(0,  0, 50, 20),
            makeBlock(51, 0, 50, 20),
        ];
        const clusters = gp.runDBSCAN(blocks, 0, 0);
        // Each block should be its own noise cluster
        expect(clusters.length).toBe(2);
    });
});

// ─── expandCluster() ──────────────────────────────────────────────────────────

describe('GestaltProcessor.expandCluster', () => {
    it('expandCluster_doesNotDuplicateBlocksInCluster', () => {
        const gp = new GestaltProcessor();
        // Two blocks where A sees B and B sees A → should not be added twice
        const a = makeBlock(0,  0, 50, 20);
        const b = makeBlock(55, 0, 50, 20);
        const points   = [a, b];
        const cluster  = [];
        const visited  = new Set([0]);  // We start from index 0
        const neighbors = gp.regionQuery(points, a, 60, 32);

        gp.expandCluster(points, a, neighbors, cluster, visited, 60, 32);

        // Verify no duplicate objects in cluster
        const unique = new Set(cluster);
        expect(unique.size).toBe(cluster.length);
    });
});

// ─── mergeClusters() ──────────────────────────────────────────────────────────

describe('GestaltProcessor.mergeClusters', () => {
    it('mergeClusters_emptyInput_returnsEmptyArray', () => {
        const gp = new GestaltProcessor();
        expect(gp.mergeClusters([])).toEqual([]);
    });

    it('mergeClusters_singleItemCluster_exposesChildrenArray', () => {
        const gp = new GestaltProcessor();
        const block = makeBlock(10, 20, 30, 40);
        const result = gp.mergeClusters([[block]]);
        // Single-member cluster: block fields pass through, and a children
        // array is exposed so downstream consumers can rely on the contract.
        expect(result[0].x).toBe(10);
        expect(result[0].y).toBe(20);
        expect(result[0].children).toEqual([block]);
    });

    it('mergeClusters_twoBlocks_boundingBoxUnion', () => {
        const gp = new GestaltProcessor();
        // Block A: (0,0,50,20)  Block B: (60,10,40,30)
        // Expected bounding box: x=0, y=0, w=100, h=40
        const a = makeBlock(0,  0,  50, 20);
        const b = makeBlock(60, 10, 40, 30);
        const result = gp.mergeClusters([[a, b]]);

        expect(result[0].x).toBe(0);
        expect(result[0].y).toBe(0);
        expect(result[0].w).toBe(100);
        expect(result[0].h).toBe(40);
    });

    // Regression guard for the paragraph-with-one-link bug flagged in
    // docs/dom-aware-perception-plan.md. Aggregate type is area-weighted
    // dominant, so a small inline link does not destroy text-ness.
    it('mergeClusters_paragraphWithInlineLink_staysText', () => {
        const gp = new GestaltProcessor();
        // Three text runs of equal size + one small inline link → text dominates.
        const text1 = makeBlock(0,   0, 200, 20, { type: 1.0 });
        const text2 = makeBlock(220, 0, 200, 20, { type: 1.0 });
        const text3 = makeBlock(440, 0, 200, 20, { type: 1.0 });
        const link  = makeBlock(210, 0,  30, 20, { type: 0.0 });
        const result = gp.mergeClusters([[text1, text2, text3, link]]);
        expect(result[0].type).toBe(1.0);
    });

    it('mergeClusters_uiDominant_becomesUI', () => {
        const gp = new GestaltProcessor();
        // Toolbar: three buttons, tiny text label → UI dominates.
        const b1 = makeBlock(0,   0, 60, 30, { type: 0.0 });
        const b2 = makeBlock(70,  0, 60, 30, { type: 0.0 });
        const b3 = makeBlock(140, 0, 60, 30, { type: 0.0 });
        const lbl = makeBlock(0, 40, 20, 10, { type: 1.0 });
        const result = gp.mergeClusters([[b1, b2, b3, lbl]]);
        expect(result[0].type).toBe(0.0);
    });

    it('mergeClusters_preservesChildrenArray', () => {
        const gp = new GestaltProcessor();
        const a = makeBlock(0,  0, 50, 20);
        const b = makeBlock(55, 0, 50, 20);
        const c = makeBlock(110, 0, 50, 20, { type: 0.0 });
        const result = gp.mergeClusters([[a, b, c]]);
        expect(result[0].children).toEqual([a, b, c]);
    });

    it('mergeClusters_allTextBlocks_typeRemainsText', () => {
        const gp = new GestaltProcessor();
        const a = makeBlock(0,  0, 50, 20, { type: 1.0 });
        const b = makeBlock(55, 0, 50, 20, { type: 1.0 });
        const result = gp.mergeClusters([[a, b]]);
        expect(result[0].type).toBe(1.0);
    });

    it('mergeClusters_density_cappedAtOne', () => {
        const gp = new GestaltProcessor();
        // High individual densities — after the 1.2 group-strength boost, must cap at 1.0
        const a = makeBlock(0,  0, 50, 20, { density: 1.0 });
        const b = makeBlock(55, 0, 50, 20, { density: 1.0 });
        const result = gp.mergeClusters([[a, b]]);
        expect(result[0].density).toBeLessThanOrEqual(1.0);
    });

    it('mergeClusters_density_averagedWithGroupBoost', () => {
        const gp = new GestaltProcessor();
        // Two blocks with density 0.5 each → average 0.5, × 1.2 = 0.6
        const a = makeBlock(0,  0, 50, 20, { density: 0.5 });
        const b = makeBlock(55, 0, 50, 20, { density: 0.5 });
        const result = gp.mergeClusters([[a, b]]);
        const expectedDensity = Math.min(1.0, 0.5 * 1.2);
        // Allow floating-point tolerance
        expect(Math.abs(result[0].density - expectedDensity)).toBeLessThan(1e-9);
    });

    it('mergeClusters_lineHeight_isAveragedAcrossCluster', () => {
        const gp = new GestaltProcessor();
        const a = makeBlock(0,  0, 50, 20, { lineHeight: 10 });
        const b = makeBlock(55, 0, 50, 20, { lineHeight: 20 });
        const result = gp.mergeClusters([[a, b]]);
        expect(result[0].lineHeight).toBe(15);
    });

    it('mergeClusters_multipleClusters_processedIndependently', () => {
        const gp = new GestaltProcessor();
        const cluster1 = [makeBlock(0, 0, 50, 20), makeBlock(55, 0, 50, 20)];
        const cluster2 = [makeBlock(500, 0, 80, 30)];
        const result = gp.mergeClusters([cluster1, cluster2]);
        expect(result.length).toBe(2);
    });

    it('mergeClusters_outputHasRequiredProperties', () => {
        const gp = new GestaltProcessor();
        const a = makeBlock(0, 0, 50, 20);
        const b = makeBlock(55, 0, 50, 20);
        const result = gp.mergeClusters([[a, b]]);
        const merged = result[0];
        ['x', 'y', 'w', 'h', 'type', 'density', 'lineHeight'].forEach(prop => {
            expect(prop in merged).toBeTruthy();
        });
    });
});

// ─── Default config ───────────────────────────────────────────────────────────

describe('GestaltProcessor.defaultConfig', () => {
    it('defaultConfig_hasExpectedEpsilonValues', () => {
        const gp = new GestaltProcessor();
        expect(gp.config.textEpsilonX).toBe(60);
        expect(gp.config.textEpsilonY).toBe(32);
        expect(gp.config.minPts).toBe(2);
    });

    it('defaultConfig_paddingIsPositive', () => {
        const gp = new GestaltProcessor();
        expect(gp.config.padding).toBeGreaterThan(0);
    });

    it('constructor_createsIndependentConfigPerInstance', () => {
        const gp1 = new GestaltProcessor();
        const gp2 = new GestaltProcessor();
        gp1.config.textEpsilonX = 999;
        expect(gp2.config.textEpsilonX).not.toBe(999);
    });
});
