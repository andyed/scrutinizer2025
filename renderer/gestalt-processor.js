/**
 * GestaltProcessor
 * 
 * Implements "Gestalt Closure" for the Saliency System.
 * Transforms granular input blocks (individual letters, matrix items) into 
 * coherent perceptual groups (paragraphs, toolbars, cards).
 * 
 * Algorithm:
 * 1. Spatial Clustering (DBSCAN) with anisotropic distance.
 * 2. Morphological Closing (Dilation -> Merge -> Erosion).
 */
class GestaltProcessor {
    constructor() {
        this.config = {
            // DBSCAN Parameters
            textEpsilonX: 60,  // Reduced from 150 to prevent column merging
            textEpsilonY: 32,  // Reduced from 60 (approx 1.5 lines) to separate list items
            uiEpsilon: 50,     // Component grouping
            minPts: 2,         // Minimum items to form a group

            // Morphological Parameters
            padding: 10        // Reduced from 20 to tighten bounds
        };
    }

    /**
     * Main entry point. Process raw blocks into Gestalt Clusters.
     * @param {Array} blocks - Raw structure blocks
     * @returns {Array} - List of processed block objects (some merged)
     */
    process(blocks) {
        if (!blocks || blocks.length === 0) return [];

        // Unified Pass: Treat everything as "Visual Objects"
        // This allows headlines (UI/Links) to merge with snippets (Text) into "Cards".
        // Using the aggressive parameters for everything.
        const clusters = this.runDBSCAN(blocks, this.config.textEpsilonX, this.config.textEpsilonY);
        const mergedBlocks = this.mergeClusters(clusters);

        return mergedBlocks;
    }

    /**
     * Density-Based Spatial Clustering of Applications with Noise (Simplified)
     * @param {Array} points - List of blocks
     * @param {Number} epsX - Horizontal reach
     * @param {Number} epsY - Vertical reach
     */
    runDBSCAN(points, epsX, epsY) {
        const clusters = [];
        const visited = new Set();
        const noise = new Set();

        for (let i = 0; i < points.length; i++) {
            if (visited.has(i)) continue;
            visited.add(i);

            const neighbors = this.regionQuery(points, points[i], epsX, epsY);

            if (neighbors.length < this.config.minPts) {
                noise.add(i);
            } else {
                const cluster = [];
                this.expandCluster(points, points[i], neighbors, cluster, visited, epsX, epsY);
                clusters.push(cluster);
            }
        }

        // Add noise points as single-item clusters (don't discard them!)
        noise.forEach(index => {
            // Optimization: Only keep noise if it has significant mass?
            // For now, keep everything.
            clusters.push([points[index]]);
        });

        return clusters;
    }

    expandCluster(points, corePoint, neighbors, cluster, visited, epsX, epsY) {
        cluster.push(corePoint);

        for (let i = 0; i < neighbors.length; i++) {
            const neighborIdx = neighbors[i];
            const neighbor = points[neighborIdx];

            if (!visited.has(neighborIdx)) {
                visited.add(neighborIdx);
                const furtherNeighbors = this.regionQuery(points, neighbor, epsX, epsY);
                if (furtherNeighbors.length >= this.config.minPts) {
                    neighbors.push(...furtherNeighbors);
                }
            }

            // Check if already in *any* cluster (DBSCAN property)
            // In this implementation, we just add to current if not added yet
            // Assuming points are objects, need explicit check? 
            // Simplified: Rely on 'visited' to prevent processing, 
            // but need to ensure we don't double-add to cluster array.
            if (!cluster.includes(neighbor)) {
                cluster.push(neighbor);
            }
        }
    }

    regionQuery(points, core, epsX, epsY) {
        const neighbors = [];
        // Slow O(N) scan. 
        // TODO: Implement Grid/Quadtree for O(logN) if performance lags >500 blocks.
        for (let i = 0; i < points.length; i++) {
            const p = points[i];

            // Center-to-Center distance? Or Edge-to-Edge?
            // Gestalt is about visual gaps. Edge-to-Edge is better.
            const c1x = core.x + core.w / 2;
            const c1y = core.y + core.h / 2;
            const c2x = p.x + p.w / 2;
            const c2y = p.y + p.h / 2;

            const distX = Math.max(0, Math.abs(c1x - c2x) - (core.w / 2 + p.w / 2));
            const distY = Math.max(0, Math.abs(c1y - c2y) - (core.h / 2 + p.h / 2));

            // Allow overlap (negative distance) to count as 0

            if (distX < epsX && distY < epsY) {
                neighbors.push(i);
            }
        }
        return neighbors;
    }

    /**
     * Merges a list of clusters into single bounding boxes.
     *
     * The merged block carries:
     *   - an aggregate type (area-weighted dominant child type), used by
     *     structure-map consumers that expect a single pooled value
     *   - a `children` array of the original blocks, so the DOM-aware
     *     compositor (see docs/dom-aware-perception-plan.md) can iterate
     *     individual primitives without losing the merged bbox's role in
     *     spatial grouping.
     *
     * Previously any interactive child collapsed the whole cluster to
     * type=0.0 (UI), which destroyed text-ness whenever a paragraph
     * contained a single inline link. Now the aggregate is area-weighted:
     * a 300-word paragraph with one small link stays text.
     */
    mergeClusters(clusters) {
        return clusters.map(cluster => {
            if (cluster.length === 1) {
                // Single-member cluster: pass block through but still expose
                // children so downstream consumers can rely on the contract.
                const only = cluster[0];
                if (!only.children) {
                    return { ...only, children: [only] };
                }
                return only;
            }

            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            let totalDensity = 0;
            let lineHeightSum = 0;
            let primaryRole = 0;

            // Area-weighted type tallies — resolves the "paragraph with one
            // link becomes UI" bug by letting the dominant-content type win.
            let textArea = 0;
            let mediaArea = 0;
            let uiArea = 0;

            for (const b of cluster) {
                minX = Math.min(minX, b.x);
                minY = Math.min(minY, b.y);
                maxX = Math.max(maxX, b.x + b.w);
                maxY = Math.max(maxY, b.y + b.h);
                totalDensity += b.density;
                lineHeightSum += b.lineHeight;

                const area = Math.max(0, b.w) * Math.max(0, b.h);
                if (b.type >= 0.9) {
                    textArea += area;
                } else if (b.type >= 0.4) {
                    mediaArea += area;
                } else {
                    uiArea += area;
                }

                // Preserve most specific ARIA role through merge (highest ID wins)
                if (b.ariaRole && b.ariaRole > primaryRole) {
                    primaryRole = b.ariaRole;
                }
            }

            // Dominant type by area. Ties broken toward text (preserves
            // reading-path behavior; matches the bug-fix intent).
            let aggregateType;
            if (textArea >= mediaArea && textArea >= uiArea) {
                aggregateType = 1.0;
            } else if (mediaArea >= uiArea) {
                aggregateType = 0.5;
            } else {
                aggregateType = 0.0;
            }

            return {
                x: minX,
                y: minY,
                w: maxX - minX,
                h: maxY - minY,
                type: aggregateType,
                // Average density boosted by "Group Strength" (more items = more dense)
                density: Math.min(1.0, (totalDensity / cluster.length) * 1.2),
                lineHeight: lineHeightSum / cluster.length, // Average rhythm
                ariaRole: primaryRole,
                children: cluster
            };
        });
    }
}

module.exports = GestaltProcessor;
