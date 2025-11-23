# Implementation Notes - Neural Processing Model

## Quick Reference

### Three Processing Zones

```
┌─────────────────────────────────────────────┐
│                                             │
│         FAR PERIPHERY (5×5 blocks)         │
│    ┌───────────────────────────────┐       │
│    │  NEAR PERIPHERY (3×3 blocks)  │       │
│    │   ┌───────────────────────┐   │       │
│    │   │  PARAFOVEA (jitter)   │   │       │
│    │   │   ┌───────────┐       │   │       │
│    │   │   │   FOVEA   │       │   │       │
│    │   │   │  (sharp)  │       │   │       │
│    │   │   └───────────┘       │   │       │
│    │   └───────────────────────┘   │       │
│    └───────────────────────────────┘       │
└─────────────────────────────────────────────┘
```

### Processing Parameters

| Zone | Radius | Processing | Effect |
|------|--------|------------|--------|
| **Fovea** | 0 → r1 | 1:1 copy | Sharp, full color |
| **Parafovea** | r1 → r2 | ±2px jitter | High contrast, illegible |
| **Near Periphery** | r2 → r3 | 3×3 blocks | Moderate pixelation |
| **Far Periphery** | r3 → ∞ | 5×5 blocks | Heavy pixelation |

Where:
- `r1 = fovealRadius × 0.3` (inner sharp zone)
- `r2 = fovealRadius × 0.8` (parafoveal boundary)
- `r3 = fovealRadius × 1.5` (near periphery boundary)

## Code Flow

### 1. Capture (scrutinizer.js)
```javascript
// html2canvas captures DOM → ImageData
const imageData = await html2canvas(webview);
```

### 2. Worker Processing (blur-worker.js)
```javascript
// Desaturate first (periphery is color-blind)
const desaturated = processor.desaturate(imageData, 1.0);

// Generate 3 levels
Level 0: applyNeuralProcessing(desaturated, width, height, 0); // Jitter
Level 1: applyNeuralProcessing(desaturated, width, height, 1); // 3×3 blocks
Level 2: applyNeuralProcessing(desaturated, width, height, 2); // 5×5 blocks
```

### 3. Compositing (scrutinizer.js render loop)
```javascript
// Layer from back to front with radial gradient masks
1. Draw Level 2 (5×5 blocks) everywhere
2. Mask out r2→r3, draw Level 1 (3×3 blocks)
3. Mask out r1→r2, draw Level 0 (jitter)
4. Mask out 0→r1, draw sharp original
5. Add binocular foveal overlay (full color)
```

## Jitter Implementation

### Noise Table Generation
```javascript
// Pre-generate for performance
const noiseTable = new Int8Array(width * height * 2);
for (let i = 0; i < noiseTable.length; i++) {
    noiseTable[i] = Math.floor((Math.random() - 0.5) * 5); // -2 to +2
}
```

### Pixel Lookup with Jitter
```javascript
const noiseIdx = (y * width + x) * 2;
const xOffset = noiseTable[noiseIdx];
const yOffset = noiseTable[noiseIdx + 1];

// Clamp to image bounds
const sourceX = Math.max(0, Math.min(width - 1, x + xOffset));
const sourceY = Math.max(0, Math.min(height - 1, y + yOffset));
```

**Why this works**: Letters stay high-contrast but their strokes are displaced, making them illegible while preserving the "texture" of text.

## Block Sampling Implementation

### UV Warping (Breaking the Grid)
```javascript
// Low-frequency wobble to break rigid grid
const warpScale = blockSize * 2;
const warpStrength = blockSize * 0.5;

const warpX = Math.sin((y / warpScale) * Math.PI * 2) * warpStrength;
const warpY = Math.cos((x / warpScale) * Math.PI * 2) * warpStrength;

const warpedX = x + warpX;
const warpedY = y + warpY;
```

**Why this works**: Sine waves create smooth, organic distortion. Text columns "snake" and wave instead of staying locked to pixel grid. Simulates inability to maintain Euclidean grid in periphery.

### Feature Migration (Scrambling)
```javascript
const blockSize = level === 1 ? 3 : 5;
const blockX = Math.floor(warpedX / blockSize) * blockSize;
const blockY = Math.floor(warpedY / blockSize) * blockSize;

// Randomly sample within block (not just top-left corner)
const migrationX = Math.floor((noiseTable[idx] / 2) % blockSize);
const migrationY = Math.floor((noiseTable[idx + 1] / 2) % blockSize);

const sourceX = blockX + migrationX;
const sourceY = blockY + migrationY;
```

**Why this works**: Instead of averaging or sampling from block origin, we randomly grab pixels from within the block. This creates "mongrels" - you see pieces of letters (curve of 'd', cross of 't') but in wrong positions. Simulates crowding where features are detected but unbound to objects.

## Performance Characteristics

### Complexity
- **Jitter**: O(n) where n = pixel count
  - Single lookup per pixel with offset
  - Noise table pre-generated once
  
- **Block Sampling**: O(n) but faster in practice
  - Simple integer division and multiplication
  - No convolution kernel
  - Better cache locality (repeated reads from block origins)

### Memory
- **Noise table**: `width × height × 2 bytes` (Int8Array)
- **Output buffers**: `width × height × 4 bytes × 3 levels`
- **Total**: ~13× the original image size (vs ~20× for Gaussian blur pyramid)

### Comparison to Gaussian Blur
| Metric | Gaussian Blur | Box Sampling |
|--------|---------------|--------------|
| CPU time | High (convolution) | Low (direct copy) |
| Memory | High (temp buffers) | Medium (noise table) |
| Cache efficiency | Poor (scattered reads) | Good (block locality) |
| Biological accuracy | Low (optics) | High (neural) |

## Tuning Parameters

### Jitter Amount
```javascript
// Current: ±2px
noiseTable[i] = Math.floor((Math.random() - 0.5) * 5);

// To increase crowding: ±3px
noiseTable[i] = Math.floor((Math.random() - 0.5) * 7);

// To decrease crowding: ±1px
noiseTable[i] = Math.floor((Math.random() - 0.5) * 3);
```

### Block Sizes
```javascript
// Current: 3×3 and 5×5
const blockSize = level === 1 ? 3 : 5;

// More aggressive: 4×4 and 8×8
const blockSize = level === 1 ? 4 : 8;

// More subtle: 2×2 and 4×4
const blockSize = level === 1 ? 2 : 4;
```

### Zone Radii
```javascript
// Current in scrutinizer.js
const r1 = this.config.fovealRadius * 0.3;  // Parafovea starts
const r2 = this.config.fovealRadius * 0.8;  // Near periphery starts
const r3 = this.config.fovealRadius * 1.5;  // Far periphery starts

// To expand parafovea:
const r1 = this.config.fovealRadius * 0.4;
const r2 = this.config.fovealRadius * 1.0;
```

## Debugging Tips

### Visualize Zones
Add colored overlays to see zone boundaries:
```javascript
// In render() after compositing
this.ctx.strokeStyle = 'red';
this.ctx.beginPath();
this.ctx.arc(this.mouseX, this.mouseY, r1, 0, Math.PI * 2);
this.ctx.stroke();
// Repeat for r2, r3 with different colors
```

### Check Noise Distribution
```javascript
// After generating noise table
const histogram = new Array(5).fill(0);
for (let i = 0; i < noiseTable.length; i++) {
    histogram[noiseTable[i] + 2]++;
}
console.log('Noise distribution:', histogram);
// Should be roughly uniform: [20%, 20%, 20%, 20%, 20%]
```

### Profile Performance
```javascript
// In applyNeuralProcessing()
const start = performance.now();
// ... processing ...
const end = performance.now();
console.log(`Level ${level} took ${end - start}ms`);
```

## Common Issues

### Issue: Jitter looks too random/noisy
**Solution**: Reduce jitter range from ±2px to ±1px

### Issue: Blocks are too visible/distracting
**Solution**: Reduce block sizes (5×5 → 4×4, 3×3 → 2×2)

### Issue: Performance degradation on large pages
**Solution**: 
1. Check if noise table generation is happening per frame (should be once)
2. Consider downsampling the capture before processing
3. Reduce capture frequency for static content

### Issue: Parafoveal text still readable
**Solution**: Increase jitter range from ±2px to ±3px

### Issue: Periphery looks too blocky
**Solution**: This is correct! Real peripheral vision has large receptive fields. But if needed, reduce block sizes or add slight blur on top of blocks.

## Future Enhancements (scrutinizer2025gl)

When moving to WebGL:
1. **Jitter**: Use texture offset in fragment shader
2. **Block sampling**: Use `texelFetch()` with integer division
3. **Chromatic aberration**: Sample R/B channels with different offsets
4. **Contrast boost**: Multiply luminance in periphery
5. **Domain warping**: Use noise texture to distort UV coordinates

Example GLSL:
```glsl
// Jitter
vec2 offset = texture2D(noiseTexture, vUV).xy * 0.01;
vec4 color = texture2D(sourceTexture, vUV + offset);

// Block sampling
vec2 blockUV = floor(vUV * resolution / blockSize) * blockSize / resolution;
vec4 color = texture2D(sourceTexture, blockUV);
```

## References

- `blur-worker.js`: Worker implementation
- `scrutinizer.js`: Compositing and rendering
- `docs/beta_gemini3_discussion.md`: Theoretical foundation
- `docs/neural_processing_upgrade.md`: Change summary
