/**
 * Web Worker for blur computation
 * Offloads expensive blur processing from main thread
 */

// Import ImageProcessor (will work in worker context)
// Paths are relative to the HTML document location (renderer/index.html)
importScripts('image-processor.js', 'config.js');

const processor = new ImageProcessor(CONFIG);

self.onmessage = function(e) {
    const { imageData, baseBlurRadius, buildPyramid, jobId } = e.data;
    
    try {
        if (buildPyramid) {
            // Build multi-level pyramid for progressive filtering
            // Each level removes progressively more high-frequency detail
            const levels = [];
            
            // Level 0: Mild blur (preserves structure, removes fine text)
            const level0 = processor.blur(
                new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height),
                baseBlurRadius * 0.3
            );
            levels.push(level0);
            
            // Level 1: Moderate blur (removes detail, preserves shapes/layout)
            const level1 = processor.blur(
                new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height),
                baseBlurRadius * 0.7
            );
            levels.push(level1);
            
            // Level 2: Heavy blur (keeps gist/gross structure, preserves low spatial frequencies)
            const level2 = processor.blur(
                new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height),
                baseBlurRadius * 1.3
            );
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
