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
 * Run: node tests/unit/test-runner.js  (via index.js entry point)
 */

'use strict';

const path = require('path');
const { describe, it, assert } = require('./test-runner');

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
        assert.deepStrictEqual(result, []);
    });

    it('process_nullInput_returnsEmptyArray', () => {
        const gp = new GestaltProcessor();
        const result = gp.process(null);
        assert.deepStrictEqual(result, []);
    });

    it('process_undefinedInput_returnsEmptyArray', () => {
        const gp = new GestaltProcessor();
        const result = gp.process(undefined);
        assert.deepStrictEqual(result, []);
    });

    it('process_singleBlock_returnsSingleBlock', () => {
        const gp = new GestaltProcessor();
        const block = makeBlock(100, 100, 50, 20);
        const result = gp.process([block]);
        assert.strictEqual(result.length, 1, 'should return exactly 1 block');
    });

    it('process_returnsArray', () => {
        const gp = new GestaltProcessor();
        const result = gp.process([makeBlock(0, 0, 10, 10)]);
        assert.ok(Array.isArray(result), 'process() must return an Array');
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
        assert.strictEqual(result.length, 1,
            `expected 1 merged block, got ${result.length}`);
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
        assert.strictEqual(result.length, 2,
            `expected 2 separate blocks, got ${result.length}`);
    });

    it('process_outputBlocksHaveBoundingBoxProperties', () => {
        const gp = new GestaltProcessor();
        const result = gp.process([makeBlock(10, 20, 30, 40)]);
        const block = result[0];
        assert.ok('x' in block, 'missing x');
        assert.ok('y' in block, 'missing y');
        assert.ok('w' in block, 'missing w');
        assert.ok('h' in block, 'missing h');
    });
});

// ─── regionQuery() ────────────────────────────────────────────────────────────

describe('GestaltProcessor.regionQuery', () => {
    it('regionQuery_sameBlock_returnsItself', () => {
        const gp = new GestaltProcessor();
        const block = makeBlock(0, 0, 50, 50);
        // A block always neighbours itself (distance = 0)
        const neighbors = gp.regionQuery([block], block, 10, 10);
        assert.ok(neighbors.includes(0), 'block should neighbor itself');
    });

    it('regionQuery_touchingBlock_isIncluded', () => {
        const gp = new GestaltProcessor();
        // Block B starts exactly where block A ends — edge-to-edge distance = 0
        const a = makeBlock(0,  0, 50, 20);
        const b = makeBlock(50, 0, 50, 20);
        const neighbors = gp.regionQuery([a, b], a, 1, 1);
        // Edge gap is 0 which is < epsX=1, so b should be included
        assert.ok(neighbors.includes(1), 'touching block should be a neighbor');
    });

    it('regionQuery_gapBeyondEps_blockExcluded', () => {
        const gp = new GestaltProcessor();
        // Gap of 100px horizontally; epsX = 50
        const a = makeBlock(0,   0, 50, 20);
        const b = makeBlock(200, 0, 50, 20);
        const neighbors = gp.regionQuery([a, b], a, 50, 50);
        assert.ok(!neighbors.includes(1), 'far block should not be a neighbor');
    });

    it('regionQuery_overlappingBlocks_alwaysNeighbors', () => {
        const gp = new GestaltProcessor();
        // Overlapping blocks — negative edge gap clamped to 0 → always within any eps
        const a = makeBlock(0,  0, 100, 50);
        const b = makeBlock(50, 0, 100, 50);
        const neighbors = gp.regionQuery([a, b], a, 0.1, 0.1);
        assert.ok(neighbors.includes(1), 'overlapping blocks must always be neighbors');
    });

    it('regionQuery_withinEpsX_butBeyondEpsY_excluded', () => {
        const gp = new GestaltProcessor();
        // Horizontally close but vertically far
        const a = makeBlock(0,   0,  50, 20);
        const b = makeBlock(10, 200, 50, 20);
        const neighbors = gp.regionQuery([a, b], a, 100, 10);
        // Vertical gap ≈ 180px > epsY=10
        assert.ok(!neighbors.includes(1),
            'block far in Y should not be neighbor even if close in X');
    });

    it('regionQuery_emptyPoints_returnsEmptyArray', () => {
        const gp = new GestaltProcessor();
        const core = makeBlock(0, 0, 10, 10);
        const result = gp.regionQuery([], core, 100, 100);
        assert.deepStrictEqual(result, []);
    });
});

// ─── runDBSCAN() ──────────────────────────────────────────────────────────────

describe('GestaltProcessor.runDBSCAN', () => {
    it('runDBSCAN_emptyInput_returnsEmptyClusters', () => {
        const gp = new GestaltProcessor();
        const clusters = gp.runDBSCAN([], 60, 32);
        assert.deepStrictEqual(clusters, []);
    });

    it('runDBSCAN_singlePoint_treatedAsNoiseSingleItemCluster', () => {
        const gp = new GestaltProcessor();
        // A single point can never have minPts=2 neighbors, so it is noise.
        // Noise points are kept as single-item clusters.
        const block = makeBlock(0, 0, 50, 20);
        const clusters = gp.runDBSCAN([block], 60, 32);
        assert.strictEqual(clusters.length, 1, 'single block → 1 cluster');
        assert.strictEqual(clusters[0].length, 1, 'cluster contains the 1 block');
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
        assert.ok(clusterSizes.includes(2),
            `expected a cluster of size 2, got sizes [${clusterSizes}]`);
    });

    it('runDBSCAN_twoDistantBlocks_formTwoClusters', () => {
        const gp = new GestaltProcessor();
        // Gap 300px, epsX=60 — both become noise → two single-item clusters
        const blocks = [
            makeBlock(0,   0, 50, 20),
            makeBlock(400, 0, 50, 20),
        ];
        const clusters = gp.runDBSCAN(blocks, 60, 32);
        assert.strictEqual(clusters.length, 2,
            `expected 2 clusters, got ${clusters.length}`);
        clusters.forEach((c, i) => {
            assert.strictEqual(c.length, 1, `cluster[${i}] should have 1 item`);
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
        assert.strictEqual(biggest, 3,
            `expected largest cluster to have 3 members, got ${biggest}`);
        assert.strictEqual(clusters.length, 1,
            `expected 1 cluster total, got ${clusters.length}`);
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
        assert.strictEqual(clusters.length, 1,
            'with huge epsilon, all blocks should form 1 cluster');
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
        assert.strictEqual(clusters.length, 2,
            `expected 2 isolated clusters with eps=0, got ${clusters.length}`);
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
        assert.strictEqual(unique.size, cluster.length,
            `cluster has duplicates: ${cluster.length} items but ${unique.size} unique`);
    });
});

// ─── mergeClusters() ──────────────────────────────────────────────────────────

describe('GestaltProcessor.mergeClusters', () => {
    it('mergeClusters_emptyInput_returnsEmptyArray', () => {
        const gp = new GestaltProcessor();
        assert.deepStrictEqual(gp.mergeClusters([]), []);
    });

    it('mergeClusters_singleItemCluster_returnsOriginalBlock', () => {
        const gp = new GestaltProcessor();
        const block = makeBlock(10, 20, 30, 40);
        const result = gp.mergeClusters([[block]]);
        assert.strictEqual(result[0], block,
            'single-item cluster should return the original block reference');
    });

    it('mergeClusters_twoBlocks_boundingBoxUnion', () => {
        const gp = new GestaltProcessor();
        // Block A: (0,0,50,20)  Block B: (60,10,40,30)
        // Expected bounding box: x=0, y=0, w=100, h=40
        const a = makeBlock(0,  0,  50, 20);
        const b = makeBlock(60, 10, 40, 30);
        const result = gp.mergeClusters([[a, b]]);

        assert.strictEqual(result[0].x, 0,   'merged x should be minimum x');
        assert.strictEqual(result[0].y, 0,   'merged y should be minimum y');
        assert.strictEqual(result[0].w, 100, 'merged w should span both blocks (0 to 100)');
        assert.strictEqual(result[0].h, 40,  'merged h should span both blocks (0 to 40)');
    });

    it('mergeClusters_typeFlagPromotion_interactiveWinsOverText', () => {
        const gp = new GestaltProcessor();
        // One interactive block (type=0.0) mixed with text blocks (type=1.0)
        // → merged block should be type 0.0 (interactive)
        const text1 = makeBlock(0,  0, 50, 20, { type: 1.0 });
        const link  = makeBlock(55, 0, 50, 20, { type: 0.0 });
        const text2 = makeBlock(110,0, 50, 20, { type: 1.0 });
        const result = gp.mergeClusters([[text1, link, text2]]);
        assert.strictEqual(result[0].type, 0.0,
            'merged cluster with any interactive element should have type=0.0');
    });

    it('mergeClusters_allTextBlocks_typeRemainsText', () => {
        const gp = new GestaltProcessor();
        const a = makeBlock(0,  0, 50, 20, { type: 1.0 });
        const b = makeBlock(55, 0, 50, 20, { type: 1.0 });
        const result = gp.mergeClusters([[a, b]]);
        assert.strictEqual(result[0].type, 1.0,
            'cluster of only text blocks should have type=1.0');
    });

    it('mergeClusters_density_cappedAtOne', () => {
        const gp = new GestaltProcessor();
        // High individual densities — after the 1.2 group-strength boost, must cap at 1.0
        const a = makeBlock(0,  0, 50, 20, { density: 1.0 });
        const b = makeBlock(55, 0, 50, 20, { density: 1.0 });
        const result = gp.mergeClusters([[a, b]]);
        assert.ok(result[0].density <= 1.0,
            `density must not exceed 1.0, got ${result[0].density}`);
    });

    it('mergeClusters_density_averagedWithGroupBoost', () => {
        const gp = new GestaltProcessor();
        // Two blocks with density 0.5 each → average 0.5, × 1.2 = 0.6
        const a = makeBlock(0,  0, 50, 20, { density: 0.5 });
        const b = makeBlock(55, 0, 50, 20, { density: 0.5 });
        const result = gp.mergeClusters([[a, b]]);
        const expectedDensity = Math.min(1.0, 0.5 * 1.2);
        // Allow floating-point tolerance
        assert.ok(Math.abs(result[0].density - expectedDensity) < 1e-9,
            `expected density ${expectedDensity}, got ${result[0].density}`);
    });

    it('mergeClusters_lineHeight_isAveragedAcrossCluster', () => {
        const gp = new GestaltProcessor();
        const a = makeBlock(0,  0, 50, 20, { lineHeight: 10 });
        const b = makeBlock(55, 0, 50, 20, { lineHeight: 20 });
        const result = gp.mergeClusters([[a, b]]);
        assert.strictEqual(result[0].lineHeight, 15,
            'lineHeight should be the average of cluster members');
    });

    it('mergeClusters_multipleClusters_processedIndependently', () => {
        const gp = new GestaltProcessor();
        const cluster1 = [makeBlock(0, 0, 50, 20), makeBlock(55, 0, 50, 20)];
        const cluster2 = [makeBlock(500, 0, 80, 30)];
        const result = gp.mergeClusters([cluster1, cluster2]);
        assert.strictEqual(result.length, 2, 'two clusters → two output blocks');
    });

    it('mergeClusters_outputHasRequiredProperties', () => {
        const gp = new GestaltProcessor();
        const a = makeBlock(0, 0, 50, 20);
        const b = makeBlock(55, 0, 50, 20);
        const result = gp.mergeClusters([[a, b]]);
        const merged = result[0];
        ['x', 'y', 'w', 'h', 'type', 'density', 'lineHeight'].forEach(prop => {
            assert.ok(prop in merged, `merged block missing property: ${prop}`);
        });
    });
});

// ─── Default config ───────────────────────────────────────────────────────────

describe('GestaltProcessor.defaultConfig', () => {
    it('defaultConfig_hasExpectedEpsilonValues', () => {
        const gp = new GestaltProcessor();
        assert.strictEqual(gp.config.textEpsilonX, 60);
        assert.strictEqual(gp.config.textEpsilonY, 32);
        assert.strictEqual(gp.config.minPts, 2);
    });

    it('defaultConfig_paddingIsPositive', () => {
        const gp = new GestaltProcessor();
        assert.ok(gp.config.padding > 0, 'padding must be positive');
    });

    it('constructor_createsIndependentConfigPerInstance', () => {
        const gp1 = new GestaltProcessor();
        const gp2 = new GestaltProcessor();
        gp1.config.textEpsilonX = 999;
        assert.notStrictEqual(gp2.config.textEpsilonX, 999,
            'instances should not share config objects');
    });
});
