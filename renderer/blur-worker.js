/**
 * Web Worker for blur computation
 * Offloads expensive blur processing from main thread
 */

// Import ImageProcessor (will work in worker context)
// Paths are relative to the HTML document location (renderer/index.html)
importScripts('image-processor.js', 'config.js');

const processor = new ImageProcessor(CONFIG);

/**
 * Smoothstep function for smooth transitions (Hermite interpolation)
 * Returns value between 0 and 1 with smooth acceleration/deceleration
 */
function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

/**
 * 2-octave fractal noise for organic, non-repeating distortion
 * Prevents brain from detecting single sine wave pattern
 */
function fractalNoise(coord, frequency, phase) {
    // Octave 1: Main swell
    const wave1 = Math.sin(coord * frequency + phase);
    
    // Octave 2: Jitter (2.7x multiplier prevents wave alignment)
    const wave2 = Math.sin(coord * frequency * 2.7 + phase) * 0.4;
    
    return wave1 + wave2;
}

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
    
    // Phase for fractal noise (could be animated with frame count)
    const phase = 0; // Static for now, could add: Date.now() * 0.001 for swimming effect
    
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
        // PERIPHERAL: Neural texture synthesis with fractal noise
        const blockSize = level === 1 ? 3 : 5;
        
        // Fractal noise parameters - TIGHTENED for "shimmer" not "swell"
        // High frequency: character-width waves (~10-15px), not page-width
        // Low amplitude: subtle vertical sway, dominant horizontal scramble
        const freq = 0.5;  // 5x increase: "buzz" not "swim"
        const amp = blockSize * 0.3;  // Reduced: subtle distortion
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                
                // 2-octave fractal noise for organic distortion
                // Tighter waves break coherence of text lines (feature disintegration)
                const warpX = fractalNoise(y, freq, phase) * amp;
                const warpY = fractalNoise(x, freq, phase + 1.5) * amp; // Phase offset for X/Y independence
                
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
            
            // Rod-sensitive desaturation for peripheral vision
            // Boosts cyan/aqua (505nm rod peak) and implements Helmholtz-Kohlrausch effect
            const desaturated = processor.desaturateRodSensitive(
                new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height)
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
