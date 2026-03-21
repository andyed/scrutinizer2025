# Mongrel Textures — Architectural Plan

> **Last updated:** 2026-03-21 (v2.6)
> **Status:** Tiers 1–2.5 shipped. Tier 3 (full TTM synthesis) is the next major target.
> **Key question:** How to connect isotropic cortical sectors (v2.6) to summary-statistic pooling.

## The gap

Scrutinizer v2.6 has the correct pooling *regions* — isotropic cortical sectors derived from the CMF (Blauch, Alvarez & Konkle 2026). What it lacks is the correct pooling *computation* within them. The current displacement pipeline (Bender+Cutter) scrambles pixels but preserves their identity. Peripheral vision doesn't preserve pixel identity — it computes summary statistics over pooling regions and discards the rest (Rosenholtz 2012, Freeman & Simoncelli 2011).

The path from displacement to pooling is the central architectural challenge.

## Scientific foundation

The peripheral visual system compresses information through receptive field pooling. Within each pooling region, individual features are replaced by summary statistics:

| Statistic | What survives | What is destroyed |
|-----------|---------------|-------------------|
| Mean luminance/color | "Brightness" and approximate hue | Exact RGB values |
| Contrast energy | Texture vs. flat | Fine luminance detail |
| Dominant orientation | "Stripey" or "boxy" | Individual edge identity |
| Spatial frequency | Coarse vs. fine texture | Serifs, thin strokes |
| Element density | "Crowded" or "sparse" | Individual element count |

This is the Texture Tiling Model (TTM, Rosenholtz et al. 2012): peripheral vision represents the world as summary statistics within eccentricity-scaled pooling regions. Mongrel textures are synthetic images that match these statistics — they look the same in peripheral vision as the original, but are unrecognizable when fixated.

## Tier architecture

| Tier | What it does | Status | Key file(s) |
|------|-------------|--------|-------------|
| **1** | MIP-based resolution falloff | Shipped (v1.4) | `peripheral.frag` — `sampleMIPPooled()` |
| **1.5** | Density-gated V1 crowding | Shipped (v2.0) | `peripheral.frag` — crowding sigmoid |
| **1.6** | Per-channel chromatic decay (RG/YV) | Shipped (v1.9) | `peripheral.frag` — `chromaticAttenuate()` |
| **1.7** | CMF logarithmic MIP + isotropic grid | Shipped (v2.6) | `peripheral.frag` — type 5, `BenderConfig`/`CutterConfig` |
| **2** | Contrast-preserving pooling (WebGL2) | Planned | Fragment shader fallback for non-WebGPU hardware |
| **2.5** | Tile-based Oklab stats + oriented noise | Shipped (v2.3) | `crowding-stats.wgsl`, `crowding-synth.wgsl` |
| **3** | Full TTM synthesis within isotropic sectors | **Next target** | See below |

### What each tier adds

**Tiers 1–1.7 (shipped):** Eccentricity-dependent resolution loss. MIP chain provides spatial averaging. DoG band decomposition (12 bands) gives graded frequency rolloff instead of hard cutoff. Chromatic channels decay at biological rates (RG ~6x faster than YV). Isotropic sector geometry parameterizes displacement. The rendering *mechanism* is still pixel displacement, not statistical pooling.

**Tier 2 (planned):** Generate a statistical MIP texture encoding mean luminance + contrast variance per tile. The fragment shader reads these statistics and modulates noise amplitude to preserve local contrast during pooling. Prevents the "washed out" look of pure MIP averaging. WebGL2 compatible.

**Tier 2.5 (shipped):** WebGPU compute pipeline extracts per-tile Oklab statistics (luminance mean, luminance variance, chrominance variance) and synthesizes oriented sine gratings that match. Two-pass: stats extraction → noise synthesis. Under 0.3ms on integrated GPU. Auto-fallback to fragment shader if frame budget exceeded.

**Tier 3 (next target):** Full summary-statistic synthesis within isotropic cortical sectors. This is where the v2.6 isotropic grid connects to the v2.3 compute pipeline:

## Tier 3: Connecting sectors to statistics

### The architecture

```
Isotropic sector geometry (v2.6)
    ↓ defines pooling regions
Per-sector statistics extraction (WebGPU compute)
    ↓ mean color, contrast, orientation energy, density
Texture synthesis from statistics (WebGPU compute)
    ↓ produces mongrel texture matching the statistics
Fragment shader compositing
    ↓ blends mongrel with source based on eccentricity
Output
```

### What needs building

1. **Sector-aware statistics extraction.** Tier 2.5 uses fixed rectangular tiles. Tier 3 needs to compute statistics within the isotropic sector boundaries — ring-and-spoke geometry, not a uniform grid. The sector geometry is already computed in the JS reference implementation (19-test validated); it needs a WebGPU compute version that bins pixels into sectors and reduces per-sector.

2. **Cross-scale magnitude correlation.** The biggest gap in Tier 2.5 (identified in `isotropic_migration.md`). TTM preserves correlations between spatial frequency bands at the same location — this is what makes "texture-ified" output look like texture rather than noise. Without it, synthesis produces colored noise overlaid on blur. Portilla & Simoncelli (2000) formalize the required statistics; Walton et al. (2021) demonstrate real-time computation in CUDA.

3. **Phase alignment across scales.** Edges require phase coherence across frequency bands. Without it, synthesized edges look "painterly." This is lower priority than magnitude correlation but matters for content with strong structure (text blocks, UI panels).

4. **Eccentricity-graded blending.** The fovea sees the original image. The far periphery sees pure synthesis. The transition should be gradual — not a hard boundary. The current `smoothstep` blend (Tier 1) provides this for MIP pooling; Tier 3 needs an equivalent for synthesis output.

### Performance target

3-4ms on discrete GPU, with graceful fallback to Tier 2.5 (0.3ms) or Tier 1 (0.3ms) on integrated hardware. The sector geometry computation is negligible; the cost is in per-sector FFT/wavelet decomposition and synthesis.

### What this would look like

Text becomes horizontal stripes with matching density and color. Faces become blobs with correct skin tone and approximate shape. Logos become colored regions matching the original's spatial frequency profile. Navigation bars become stripey regions with correct orientation. This matches Rosenholtz's published mongrel images — peripheral vision's actual representation, not a simulation of its effects.

## Key files

| File | Purpose |
|------|---------|
| `renderer/shaders/peripheral.frag` | Fragment shader: MIP pooling, DoG bands, chromatic decay, V1 displacement |
| `renderer/webgpu-crowding-compute.js` | Tier 2.5: WebGPU compute pipeline manager |
| `renderer/shaders/crowding-stats.wgsl` | Tier 2.5 pass 1: tile statistics extraction |
| `renderer/shaders/crowding-synth.wgsl` | Tier 2.5 pass 2: oriented noise synthesis |
| `renderer/webgpu-safety.js` | Frame budget monitor with auto-fallback |
| `shared/modes.json` | Mode definitions (mode 10 = compute mongrel, mode 12 = isotropic default) |
| `tests/unit/isotropic-sectors.test.js` | 19-test geometry validation suite |
| `docs/specs/isotropic_cortical_sampling.md` | Isotropic grid math and verification |

## References

- Rosenholtz, R., Huang, J., & Ehinger, K. A. (2012). Rethinking the role of top-down attention in vision. *Frontiers in Psychology*.
- Freeman, J., & Simoncelli, E. P. (2011). Metamers of the ventral stream. *Nature Neuroscience*, 14(9):1195-1201.
- Balas, B., Nakano, L., & Rosenholtz, R. (2009). A summary-statistic representation in peripheral vision explains visual crowding. *Journal of Vision*, 9(12):13.
- Portilla, J. & Simoncelli, E. P. (2000). A parametric texture model based on joint statistics of complex wavelet coefficients. *IJCV*.
- Walton, D. R. et al. (2021). Beyond Blur: Real-time Ventral Metamers for Foveated Rendering. *SIGGRAPH*.
- Vacher, J. & Briand, T. (2021). Portilla-Simoncelli Texture Synthesis. *IPOL*.
- Blauch, N. M., Alvarez, G. A., & Konkle, T. (2026). FOVI: A biologically-inspired foveated interface for deep vision models. arXiv:2602.03766.
- Bouma, H. (1970). Interaction effects in parafoveal letter recognition. *Nature*, 226:177-178.
- Toet, A. & Levi, D. M. (1992). The two-dimensional shape of spatial interaction zones in the parafovea. *Vision Research*, 32(7):1349-1357.
- Schyns, P. G. & Oliva, A. (1994). From blobs to boundary edges. *Psychological Science*, 5:195-200.
