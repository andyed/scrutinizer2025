# Content Analysis Pipeline — Architecture & Performance

> **Last updated:** 2026-03-10

**Status**: Shipped (v1.6+, incrementally hardened through v2.2)
**Module**: `renderer/content-analysis.js`
**Orchestrator**: `renderer/scrutinizer.js` (Pipeline Orchestrator)
**Performance test**: `npm run test:perf` (`tests/perf-test.html`)

## Overview

ContentAnalysis handles all asynchronous content understanding — extracting structure, saliency, and congestion data from the captured page frame and delivering it to the GPU as textures. It runs two Web Workers and a synchronous structure map pipeline, all gated by dirty-checking and throttling to avoid redundant computation on static pages.

The system solves a fundamental tension: the shader needs fresh content data every frame for responsive rendering, but computing that data (saliency heatmaps, congestion statistics) is expensive and the content rarely changes between frames. The pipeline decouples computation frequency from render frequency through a worker → canvas → smoothing → GPU upload architecture.

## Data Flow

```
Electron capturePage (BGRA buffer, ~60fps)
    │
    ▼
processFrame() ─── Pre-allocated ImageData buffer (zero-alloc reuse)
    │
    ├──▶ uploadTexture()          GPU: u_texture (every frame)
    │
    ├──▶ submitFrameForSaliency() ──throttle──▶ Saliency Worker (off-thread)
    │        every 15th frame                      │
    │        + checksum dirty-check                ▼
    │                                 saliencyTargetCanvas ──▶ smoothing loop
    │                                                           (60 frames)
    │                                                              │
    │                                                              ▼
    │                                                    uploadSaliencyMap()
    │                                                    GPU: u_saliency
    │
    └──▶ _submitCongestionFrame() ──on-demand──▶ Congestion Worker (off-thread)
             scroll/mutation/nav events              │
             + busy guard                            ▼
             + checksum dirty-check        congestionTargetCanvas ──▶ smoothing loop
                                                                       (30 frames)
                                                                          │
                                                                          ▼
                                                               uploadCongestionMap()
                                                               GPU: u_congestion
```

### Structure Map (synchronous)

Structure data flows differently — it's not pixel-derived but DOM-derived:

```
Content script (DOM analysis via IPC)
    │
    ▼
handleStructureUpdate(blocks)
    ├── Block equality check (skip redundant)
    ├── GestaltProcessor.process() — merge adjacent text blocks
    ├── StructureMap.drawBlock() — rasterize to RGBA texture
    └── uploadStructureMap() → GPU: u_structure
```

## Performance Gates

Five mechanisms prevent the workers from burning cycles on static content:

### 1. Frame Throttle (saliency only)

```javascript
// submitFrameForSaliency()
this.saliencyFrameCounter++;
if (this.saliencyFrameCounter % 15 !== 0) return;  // ~250ms at 60fps
```

Saliency is submitted every 15th frame. At 60fps, this means a new saliency computation starts at most 4x/second. The smoothing loop (60 frames) ensures the texture transitions gradually even though the source updates infrequently.

Congestion has no frame throttle — it's event-driven (scroll, DOM mutation, navigation), not continuous.

### 2. Checksum Dirty-Check (both workers)

```javascript
// _computeFrameChecksum() — ~0.01ms per call
const SAMPLE_COUNT = 1024;
const stride = Math.max(4, Math.floor(length / (SAMPLE_COUNT * 4)) * 4);
let sumA = 0, sumB = 0;
for (let i = 0; i < length; i += stride) {
    sumA = (sumA + buffer[i] + buffer[i + 1]) | 0;
    sumB = (sumB + buffer[i + 2]) | 0;
}
return ((sumA & 0xFFFF) << 16) | (sumB & 0xFFFF);
```

Samples ~1024 evenly-spaced pixels from the raw buffer. Two 16-bit sums (RG + B channels) packed into a 32-bit integer. Cost is negligible (~10μs on 1920×1080). If the checksum matches the last submission, the worker call is skipped entirely — no BGRA→RGBA copy, no `createImageBitmap`, no `postMessage`.

On a static page, this eliminates 100% of worker submissions after the first computation settles.

Each worker maintains its own checksum (`_lastSaliencyChecksum`, `_lastCongestionChecksum`) so resolution changes or mode switches on one path don't force recomputation on the other.

### 3. Worker Busy Guard (congestion only)

```javascript
// submitForCongestion()
if (this._congestionWorkerBusy) return;
this._congestionWorkerBusy = true;
// ... cleared in onmessage handler
```

The congestion worker processes one frame at a time. If a new submission arrives while it's still computing, it's silently dropped. This prevents queue buildup on slow hardware or high-resolution settings.

The saliency worker lacks this guard — multiple submissions can queue in the message channel. This is acceptable because the 15-frame throttle limits submission rate, but a future improvement could add the same guard.

### 4. Smoothing Countdown (both workers)

When a worker delivers results, the raw output goes to a target canvas. The render loop then blends it toward a current canvas over N frames:

```javascript
// updateCongestionSmoothing() — called every render frame
if (this.congestionUpdateCountdown <= 0) return;  // Early return when settled

ctx.globalAlpha = 0.8;
ctx.drawImage(this.congestionTargetCanvas, 0, 0);  // Blend toward target
ctx.globalAlpha = 1.0;

renderer.uploadCongestionMap(this.congestionCurrentCanvas);  // GPU upload
this.congestionUpdateCountdown--;
```

| Worker | Countdown | Duration at 60fps | Blend alpha |
|--------|-----------|-------------------|-------------|
| Saliency | 60 frames | ~1 second | 0.8 |
| Congestion | 30 frames | ~0.5 seconds | 0.8 |

The smoothing serves two purposes:
- **Anti-flicker**: Raw worker output can shift abruptly between frames (different downscale, different content visible). Blending prevents visible pops.
- **CPU amortization**: The canvas `drawImage` + `texImage2D` upload runs only during the countdown window, not indefinitely. Once the countdown expires, the early return skips both operations — zero cost on static content.

### 5. Saccadic Suppression (frame level)

```javascript
// processFrame()
if (this.gazeModel.getVelocity() > this.config.saccadicSuppressionThreshold
    && !this.renderer.config.saccadic_blindness) {
    return;  // Skip entire frame during rapid eye movement
}
```

During fast mouse movement (simulating a saccade), the entire `processFrame()` is skipped — no texture upload, no worker submission. The biological analog: the visual system suppresses input during saccades because the retinal image is a blur anyway.

## Worker Resolution Settings

Both workers downsample the captured frame before processing. Configurable via menu.

| Worker | Default | Options | Setting Key | Menu Path |
|--------|---------|---------|-------------|-----------|
| Saliency | 256px | 256, 512 | `saliencyResolution` | Debug > Analysis > Saliency Resolution |
| Congestion | 512px | 256, 512, 768, 1024 | `congestionResolution` | Debug > Analysis > Congestion Resolution |

Both settings persist across launches via `settingsManager`.

Higher resolution improves spatial accuracy of the congestion/saliency heatmap at the cost of worker compute time. The congestion worker at 1024px on a 1920×1080 viewport produces a 1024×576 texture — the smoothing step (`drawImage` + GPU upload) at this resolution is the primary per-frame cost when active.

### Perf Test Results (1024×576, worst case)

```
npm run test:perf
```

Synthetic mouse trajectories (300 frames each), A/B with congestion smoothing ON vs OFF:

```
[Perf] static   | OFF: avg=0.01ms p95=0.10ms | ON: avg=0.02ms p95=0.10ms | delta: +0.00ms [PASS]
[Perf] drift    | OFF: avg=0.01ms p95=0.10ms | ON: avg=0.39ms p95=0.10ms | delta: +0.00ms [PASS]
[Perf] saccade  | OFF: avg=0.37ms p95=0.90ms | ON: avg=0.03ms p95=0.10ms | delta: -0.80ms [PASS]
[Perf] circle   | OFF: avg=0.36ms p95=0.80ms | ON: avg=0.05ms p95=0.10ms | delta: -0.70ms [PASS]
```

Pass threshold: p95 delta < 2ms. The smoothing path adds negligible cost even at maximum resolution.

## Congestion Submission Triggers

The congestion worker is event-driven, not continuous. Submissions happen on:

| Trigger | Debounce | Force | Source |
|---------|----------|-------|--------|
| Scroll | 600ms | Yes | `content-changed` IPC |
| DOM mutation | 800ms–5.3s (cooldown-aware) | Yes | `content-changed` IPC |
| Navigation | 500ms | Yes | `did-navigate` event |
| Mode switch (congestion-gated) | Immediate | No | `setAestheticMode()` |
| Resolution change | Immediate | Yes | `setCongestionResolution()` |
| Congestion report toggle | Immediate | No | `setShowCongestion()` |

The `force` flag bypasses the checksum dirty-check — scroll and mutation change the viewport content even if the pixel buffer happens to match a previous frame (e.g., scrolling back to a previously-seen position with identical pixel content but different logical position).

## Texture Slots

ContentAnalysis feeds three GPU texture units:

| Uniform | Upload method | Source | Update frequency |
|---------|--------------|--------|-----------------|
| `u_texture` | `uploadTexture()` | Raw page capture | Every frame |
| `u_saliency` | `uploadSaliencyMap()` | Smoothed saliency canvas | During countdown (60 frames) |
| `u_congestion` | `uploadCongestionMap()` | Smoothed congestion canvas | During countdown (30 frames) |
| `u_structure` | `uploadStructureMap()` | Rasterized DOM blocks | On DOM change |

## Pre-Allocated Buffer Reuse

The frame capture path avoids per-frame allocation:

```javascript
// processFrame() — reuses buffer across frames
if (!this.imageDataBuffer || this.lastBufferSize !== bufferSize) {
    this.imageDataBuffer = new Uint8ClampedArray(bufferSize);
    this.imageData = new ImageData(this.imageDataBuffer, width, height);
    this.lastBufferSize = bufferSize;
}
this.imageDataBuffer.set(buffer);  // Copy into existing allocation
```

The `Uint8ClampedArray` and its backing `ImageData` are allocated once at a given resolution, then reused via `.set()`. This eliminates ~60 allocations/second that would otherwise trigger GC pauses.

## FrameTimer Integration

The render loop instruments each pipeline phase via `FrameTimer` (zero-alloc rolling window, `renderer/frame-timer.js`):

```
beginFrame()
  ├── gaze model update          → mark('gaze')
  ├── visual memory update       → mark('memory')
  ├── saliency + congestion smoothing → mark('saliency')
  ├── WebGL render               → mark('render')
endFrame()
```

Live stats visible in ComplexityHUD > Perf tab: FPS, frame time (avg/p95/max), and phase breakdown as stacked bars.

## Known Gaps

- **Saliency worker has no busy guard** — if the worker is slow and submissions queue, multiple BGRA→RGBA copies are wasted. Low priority because the 15-frame throttle limits this to ~4 submissions/second.
- **BGRA→RGBA swap is O(n)** — both workers copy the entire buffer and swap channels before `createImageBitmap`. A WebGL-side swap (shader uniform or readback format) would eliminate this copy. Blocked on Electron's `capturePage` returning BGRA.
- **Checksum is approximate** — 1024 samples can miss small localized changes (e.g., a blinking cursor). Acceptable because saliency/congestion are spatial summaries — a few changed pixels don't meaningfully alter the heatmap.
