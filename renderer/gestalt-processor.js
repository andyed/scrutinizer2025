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
            textEpsilonX: 150, // Simulation-Accurate: Wide enough for headlines (e.g. 20 chars)
            textEpsilonY: 60,  // Standard line-height gap (2-3 lines)
            uiEpsilon: 50,     // Component grouping
            minPts: 2,        // Minimum items to form a group

            // Morphological Parameters
            padding: 20       // "Squint" factor (Simulation safe)
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
     */
    mergeClusters(clusters) {
        return clusters.map(cluster => {
            if (cluster.length === 1) return cluster[0];

            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            let totalDensity = 0;
            let hasInteractive = false;
            let lineHeightSum = 0;

            for (const b of cluster) {
                minX = Math.min(minX, b.x);
                minY = Math.min(minY, b.y);
                maxX = Math.max(maxX, b.x + b.w);
                maxY = Math.max(maxY, b.y + b.h);
                totalDensity += b.density;
                lineHeightSum += b.lineHeight;

                // Type 0.0 is UI/Interactive. Type 1.0 is Text.
                // If we detect interaction, the whole group becomes interactive (Fitts's Law target).
                if (b.type < 0.9) hasInteractive = true;
            }

            return {
                x: minX,
                y: minY,
                w: maxX - minX,
                h: maxY - minY,
                // If the group contains any interactive elements (links), treat the whole blob as UI (0.0).
                // Otherwise it's purely passive text (1.0).
                type: hasInteractive ? 0.0 : 1.0,
                // Average density boosted by "Group Strength" (more items = more dense)
                density: Math.min(1.0, (totalDensity / cluster.length) * 1.2),
                lineHeight: lineHeightSum / cluster.length // Average rhythm
            };
        });
    }
}

module.exports = GestaltProcessor;
