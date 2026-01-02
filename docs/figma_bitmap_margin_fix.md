# Figma Bitmap Margin Fix

To automatically suppress "leopard stripe" artifacts caused by black/transparent margins in Figma bitmap exports, we implemented a **Content Bounds Detection + Edge Color Fill** system.

## Problem

When images are pasted into Figma, the selection bounds may include transparent/black borders. When processed by the Scrutinizer shader:
1. Transparent pixels render as BLACK in WebGL
2. MIP-based pooling samples a wide footprint, blending black into content
3. V1 distortion warps UVs, potentially sampling outside valid content
4. This creates "leopard stripe" or "scalloped edge" artifacts

## Solution: Two-Stage Fix

### Stage 1: Content Bounds Detection (`detectContentBounds`)

When an image is uploaded:
1. Draw to a small (128px max) offscreen canvas for speed
2. Scan pixel data to find bounding box of visible content
   - Visible = alpha > 10 OR RGB > 15 (non-black)
3. Store as normalized UV coordinates: `[minX, minY, maxX, maxY]`

```typescript
this.contentBounds = this.detectContentBounds(image);
// e.g., [0.02, 0.05, 0.98, 0.95] for 2-5% margins
```

### Stage 2: Edge Color Fill (`fillTransparentWithEdgeColor`)

Before uploading to WebGL:
1. Sample edge pixels of detected content area
2. Calculate average (dominant) edge color
3. Fill entire canvas with that color
4. Draw original image on top

This ensures transparent pixels become the edge color, not black.

```typescript
ctx.fillStyle = detectedEdgeColor; // e.g., "rgb(245, 245, 245)"
ctx.fillRect(0, 0, width, height);
ctx.drawImage(image, 0, 0);
```

### Shader Protection (`peripheral.figma.frag`)

The shader receives `u_content_bounds` uniform and uses it for:

| Mechanism | Implementation | Purpose |
|-----------|----------------|---------|
| **UV Clamping** | `clamp(uv, u_content_bounds.xy, u_content_bounds.zw)` | Prevents sampling outside content |
| **MIP Edge Protection** | `5% + 1%×MIP` margin from content edge | Reduces blur footprint near edges |
| **V1 Edge Protection** | `2%` margin from content edge | Minimal distortion damping |

## Result

- ✅ No "leopard stripe" artifacts (black filled with edge color)
- ✅ Distortion works to actual content edges
- ✅ Corner content (e.g., NotebookLM logo) properly distorted
- ✅ No double-stacking (only fill + draw, no scaling)

## Parity

This is Figma-specific. The browser version doesn't need this because:
1. Electron screen captures don't have transparent borders
2. The browser captures the full viewport without padding
