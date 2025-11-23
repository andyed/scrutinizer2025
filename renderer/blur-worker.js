/**
 * Web Worker for blur computation
 * Offloads expensive blur processing from main thread
 */

// Import ImageProcessor (will work in worker context)
// Paths are relative to the HTML document location (renderer/index.html)
importScripts('image-processor.js', 'config.js');

const processor = new ImageProcessor(CONFIG);

/**
 * Apply biologically-accurate peripheral processing
 * Level 0: Parafoveal jitter (simulates crowding/feature migration)
 * Level 1: Light block sampling (sparse receptors)
 * Level 2: Heavy block sampling (very sparse receptors)
 */
function applyNeuralProcessing(sourceData, width, height, level) {
    const output = new ImageData(width, height);
    const src = sourceData.data;
    const dst = output.data;
    
    // Pre-generate noise table for jitter (much faster than Math.random() per pixel)
    const noiseTable = new Int8Array(width * height * 2);
    for (let i = 0; i < noiseTable.length; i++) {
        noiseTable[i] = Math.floor((Math.random() - 0.5) * 5); // -2 to +2 range
    }
    
    if (level === 0) {
        // PARAFOVEAL: Jitter (simulates crowding - features present but positions uncertain)
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                const noiseIdx = (y * width + x) * 2;
                
                // Add random offset to lookup position
                const xOffset = noiseTable[noiseIdx];
                const yOffset = noiseTable[noiseIdx + 1];
                const sourceX = Math.max(0, Math.min(width - 1, x + xOffset));
                const sourceY = Math.max(0, Math.min(height - 1, y + yOffset));
                const sourceIndex = (sourceY * width + sourceX) * 4;
                
                // Copy with jitter
                dst[i] = src[sourceIndex];
                dst[i + 1] = src[sourceIndex + 1];
                dst[i + 2] = src[sourceIndex + 2];
                dst[i + 3] = 255;
            }
        }
    } else {
        // PERIPHERAL: Neural texture synthesis (not digital downsampling)
        const blockSize = level === 1 ? 3 : 5;
        
        // Generate low-frequency noise for UV warping (breaks rigid grid)
        const warpScale = blockSize * 2;
        const warpStrength = blockSize * 0.5;
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                
                // Add low-frequency "wobble" to break the grid
                // Use simple sine waves for smooth, organic distortion
                const warpX = Math.sin((y / warpScale) * Math.PI * 2) * warpStrength;
                const warpY = Math.cos((x / warpScale) * Math.PI * 2) * warpStrength;
                
                // Calculate block origin with warping
                const warpedX = x + warpX;
                const warpedY = y + warpY;
                const blockX = Math.floor(warpedX / blockSize) * blockSize;
                const blockY = Math.floor(warpedY / blockSize) * blockSize;
                
                // Feature migration: randomly offset within the block to scramble features
                // This creates "mongrels" - features present but unbound to correct positions
                const migrationX = Math.floor((noiseTable[(y * width + x) * 2] / 2) % blockSize);
                const migrationY = Math.floor((noiseTable[(y * width + x) * 2 + 1] / 2) % blockSize);
                
                const sourceX = Math.max(0, Math.min(width - 1, blockX + migrationX));
                const sourceY = Math.max(0, Math.min(height - 1, blockY + migrationY));
                const sourceIndex = (sourceY * width + sourceX) * 4;
                
                // Copy with feature migration
                dst[i] = src[sourceIndex];
                dst[i + 1] = src[sourceIndex + 1];
                dst[i + 2] = src[sourceIndex + 2];
                dst[i + 3] = 255;
            }
        }
    }
    
    return output;
}

self.onmessage = function(e) {
    const { imageData, baseBlurRadius, buildPyramid, jobId } = e.data;
    
    try {
        if (buildPyramid) {
            // Build multi-level pyramid using neural processing model
            // This simulates how the brain actually processes peripheral vision
            // (summary statistics, not optical blur)
            const levels = [];
            
            // Desaturate the source image first (periphery is color-blind)
            const desaturated = processor.desaturate(
                new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height),
                1.0
            );
            
            // Level 0: Parafoveal jitter (high contrast but spatially uncertain)
            const level0 = applyNeuralProcessing(desaturated, imageData.width, imageData.height, 0);
            levels.push(level0);
            
            // Level 1: Light block sampling (moderate photoreceptor sparsity)
            const level1 = applyNeuralProcessing(desaturated, imageData.width, imageData.height, 1);
            levels.push(level1);
            
            // Level 2: Heavy block sampling (very sparse photoreceptors)
            const level2 = applyNeuralProcessing(desaturated, imageData.width, imageData.height, 2);
            levels.push(level2);
            
            // Send all levels back with transferable buffers
            self.postMessage({ 
                success: true,
                pyramid: levels,
                jobId
            }, levels.map(l => l.data.buffer));
            
        } else {
            // Single blur (fallback)
            const blurred = processor.blur(imageData, baseBlurRadius);
            
            self.postMessage({ 
                success: true,
                blurred: blurred,
                jobId
            }, [blurred.data.buffer]);
        }
        
    } catch (error) {
        self.postMessage({ 
            success: false,
            error: error.message 
        });
    }
};
