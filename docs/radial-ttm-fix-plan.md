# Radial TTM Fix — Plan (Workstreams 1 & 2)

**Prepared:** 2026-04-18. **Orthogonal to** `docs/dom-aware-perception-plan.md` — this addresses an independent broken baseline. **Depends on** the retrospective in `docs/next-steps-2026-04.md`.

---

## Revision 2026-04-18 (after Phase 1 landed) — Phase 2 priority revised

**Context:** Phase 1A + 1B landed (commit `4adc188`). Mode 15's pyramid-synth pipeline now validates + runs for the first time on this machine. User loaded Google.com in mode 15 to eyeball the output.

**What we observed:**
- Fovea pixel-perfect (foveal passthrough working).
- Text regions in periphery → **disintegrated particle-scatter**, text outlines vaguely visible but illegible.
- White space between text regions → **mostly clean**, no wedge artifact.
- No visible sector-boundary discontinuities in flat regions.

**What this means for Phase 2:** the science-agent's original noise-wedge root-cause ranking was wrong about the dominant mechanism in the actual output. Re-audit (this session) votes C — variance audit first, then targeted fix, POU deferred.

**Revised mechanism ranking:**

| Mechanism | Original rank | Revised rank | Notes |
|---|---|---|---|
| Hard sector-boundary wedges (POU target) | 70% | **≤10%** | Observation falsifies: white space is clean. Would only become visible on high-contrast UI boundaries *after* amplitude is fixed. |
| `noise_var = 0.5` hard-coded in `pyramid-synth.wgsl:314` → scale factor `sqrt(target_var / 0.5)` miscalibrated if actual noise variance ≠ 0.5 | not ranked | **~50%** | Load-bearing calibration constant. If the assumed noise-field variance is wrong, every band is mis-scaled and `detail_strength` amplification then shows the miscalibration as speckle. Classic Portilla-Simoncelli failure mode: magnitude matched marginally, phase not constrained. Text outlines visible (DC/residual correct) + identity destroyed (AC phase wrong) is that exact signature. |
| `detail_strength = mix(0.5, 3.0, alpha)` amplification (`reconstruct:482`) on mis-scaled `synth_luma` | 20% | **~30%** | Amplifies whatever upstream miscalibration exists. Gate or clamp is a band-aid over the symptom. |
| Low-population sector FP quantization (`FP_SCALE = 1024`) | 10% | **~10%** | Contributes to `synth_luma` amplitude variance in small-N sectors near fovea boundary. |

**Revised Phase 2 sequence:**

1. **Noise-variance audit (30 min, 1 commit).** Instrument a debug path that reports actual variance of `n0..n3` before `match_stats` (GPU readback + `console.log`). Cheapest info-gaining step. Strictly dominant over guessing which intervention to ship.
2. **If `noise_var ≠ 0.5`:** fix the root calibration. Options: (a) normalize the seeded noise to unit variance at generation time in `seed_noise`, (b) measure variance empirically per-run and pass to `match_stats` as a uniform. Option (a) is simpler. This may dissolve the speckle without any detail_strength intervention.
3. **If `noise_var ≈ 0.5`:** ship the variance-gate on `detail_strength` as the targeted intervention: `detail_strength = mix(0.5, 3.0, alpha) * smoothstep(eps, 10·eps, sector_variance)`. Ad-hoc but addresses mechanism #2 directly. The TTM-literature-correct fix (auto-correlation + cross-orientation phase in `match_stats`) is bigger and should follow only if the gate isn't sufficient.
4. **POU sector blending stays queued — but drops in priority.** Land only if high-contrast UI boundary regions start showing wedges *after* amplitude is fixed.

**Citations (Portilla-Simoncelli lineage):** marginal-variance-only matching produces correct envelope with wrong AC phase structure. The fix that escapes this failure mode is enforcing auto-correlation of magnitude and low-pass bands (Portilla & Simoncelli 2000 §IV; Freeman & Simoncelli 2011 §3.3). Our cross-scale magnitude injection at `pyramid-synth.wgsl:335-344` is an approximation of cross-scale correlation; it is applied to an already-mis-scaled noise field, so its correctness depends on step 2 being right.

**What's unchanged in the plan:** Phase 1A + 1B shipped as written. Phases 3, 4, W2 unchanged. Only the Phase 2 internal ordering + hypothesis was revised.

---

## Context

A key Scrutinizer goal is emulating the **radial metamer** (Brown / Freeman-Simoncelli / Rosenholtz pooled texture synthesis over polar sectors). Mode 15 `tier3_synthesis` is the target for that. It is currently **silently falling back to rectilinear MIP pooling** (`sampleDoGReconstructed` / `sampleMIPPooled`) because `createBindGroupLayout` fails validation on `reconBGL` in `renderer/webgpu-pyramid-compute.js` — the layout has 9 storage bindings and the default WebGPU limit is 8. The error is swallowed by `uncapturederror` and never propagates to JS control flow.

Every prior Brown→M15 SSIM comparison is therefore invalid. Mode 20 inherits mode 15 as `L_background`, so non-text regions of mode 20 also render MIP fallback rather than radial TTM.

## 1. Diagnosis pass

### 1.1 Current state of `webgpu-pyramid-compute.js`

The 9-buffer claim is accurate, but narrow — it applies to exactly **one** bind group layout.

| BGL | Storage buffers | Under default 8? |
|---|---|---|
| `luminanceBGL` | 1 | yes |
| `blurDownBGL` | 2 | yes |
| `bandBGL` | 3 | yes |
| `accumBGL` | 7 | yes |
| `finalizeBGL` | 2 | yes |
| `seedBGL` | 4 | yes |
| `matchBGL` | 7 | yes |
| **`reconBGL`** | **9** (noise 0-3 + residual + stats + output + 2 sector) | **NO** |

### 1.2 Where the silent fallback actually happens

`renderer/webgpu-probe.js:59-66` constructs `requiredLimits` with only four fields. `maxStorageBuffersPerShaderStage` is omitted, so the device uses the spec default of **8**.

- `createBindGroupLayout` with 9 storage entries is a **validation error**, not a throw
- Surfaces via `uncapturederror` but the probe's handler only `console.error`s — does NOT propagate to control flow or UI
- `WebGPUPyramidCompute` construction proceeds
- `compute()` runs all passes; the invalid recon pass becomes a no-op
- `synthOutputBuffer` retains zeros; `uploadComputeTexture` uploads zeros to `TEXTURE5`
- In `peripheral.frag:1284` (`if (u_compute_tier > 2.0)`), `computeSample.a == 0` → `mix(mipFallback, computeSample.rgb, 0.0) == mipFallback`

**That is the silent MIP fallback.**

### 1.3 Recommended diagnostic surface (land before any fix)

Wrap BGL + pipeline construction in `_createSynthPipelines` and `_createStatsPipelines`:

```js
device.pushErrorScope('validation');
this.reconBGL = this.device.createBindGroupLayout({ ... });
this.reconPipeline = this.device.createComputePipeline({ ... });
const err = await device.popErrorScope();
if (err) {
  this._reconPipelineValid = false;
  console.error('[WebGPU Pyramid] Recon pipeline invalid:', err.message);
  // caller falls back to Tier 2.5
}
```

Plus `isPipelineHealthy()` exposed to the renderer. `scrutinizer.js:637` calls it after construction; on failure, degrade `config.compute_tier` to 2.75 and surface a clear warning.

**Phase 1A is a prerequisite for everything else.** Without it, every future regression of this shape is just as invisible.

---

## 2. Workstream 1 — Fix mode 15 radial TTM

Five phases. Only Phase 1A and 1B are on the critical path for unblocking the pipeline; Phases 2 and 3 address the noise-wedge shippability problem independently.

### Phase 1A — Diagnostic surface (prerequisite)

**Effort:** ~0.5 day / 1 commit.

**Files touched:**
- `renderer/webgpu-pyramid-compute.js` — error scopes; `isPipelineHealthy()`
- `renderer/scrutinizer.js:637` — health check after `new WebGPUPyramidCompute(...)`; on failure, fall back + `console.error`
- `renderer/webgpu-probe.js:85-87` — upgrade `uncapturederror` handler to store last error on device object for retrieval
- Optional: complexity-HUD badge or toolbar toast indicating "compute tier degraded"

**Validation:** intentionally break `reconBGL` (add a 10th dummy binding) → confirm error surfaces. Existing Jest unit tests keep passing.

**Risk:** zero. Pure observability.

**Commit:** `diagnostic: surface WebGPU pipeline validation errors to scrutinizer runtime`

### Phase 1B — Lift buffer limit

**Effort:** ~1 day / 1 commit.

Two viable subpaths — recommend **path A (requiredLimits bump)** first, then **path B (buffer packing)** later if path A fails on low-end GPUs.

**Path A (ship first):** request `maxStorageBuffersPerShaderStage: 10`

- File: `renderer/webgpu-probe.js:59-66`
- `maxStorageBuffersPerShaderStage: Math.min(adapter.limits.maxStorageBuffersPerShaderStage, 10)` in `requiredLimits`
- Apple Silicon and recent desktop GPUs typically support 10–16
- If the adapter caps at 8, surface a warning; Phase 1A's health check then degrades to Tier 2.5

**Path B (future-proof, defer until Phase 3 demands it):** pack noise0-3 into one buffer

- File: `renderer/webgpu-pyramid-compute.js` + `renderer/shaders/pyramid-synth.wgsl`
- Replace 4 separate `noiseBuffers[]` with single `noiseBuffer` of `4 × levels[0].pixels × 4` bytes (pre-check size < `maxStorageBufferBindingSize`)
- WGSL indexing: `noise[band * N + idx]` where `N = width * height`
- Binding count 9 → 6 in `reconBGL`; also consolidates `seedBGL` from 4 to 1
- Does NOT disturb `accumBGL` (at 7, already fine)

**Validation:**
- Visual: load page in mode 15, observe compute texture carries non-zero content (eyeball the debug overlay or add a `u_debug_showComputeRaw` that renders `computeSample.rgb` directly)
- Console: `[WebGPU Probe]` should now log `maxStorageBuffersPerShaderStage: 10`
- `tests/unit/pyramid-sector-assignment.test.js` and `tests/unit/isotropic-sectors.test.js` — still pass (no behavior change in pure-JS sector math)

**Risk — blast radius:**
- Mode 14 (pyramid mongrel) uses the same `WebGPUPyramidCompute` class. Phase 1A health check ensures clean degrade. The default happy path is it *also* starts working as intended. Confirm mode 14 output doesn't visibly regress.
- Mode 16 and below (`compute_tier ≤ 2.5`) use `WebGPUCrowdingCompute`, which has its own BGL — count its storage buffers to be safe.
- Laptop Intel GPUs may report `maxStorageBuffersPerShaderStage == 8` as a hard cap. Auto-downgrade by Phase 1A. Acceptable short-term; path B is the long-term answer.

**Commit:** `fix: raise maxStorageBuffersPerShaderStage to 10 so mode-15 recon pipeline validates`

### Phase 2 — Partition-of-unity sector blending (the L4 fix)

**Effort:** ~2-3 days / 1-2 commits. **Fixes the noise-wedge artifact.** Independent of the buffer fix; can begin in parallel once Phase 1A lands.

**Noise-wedge root cause (high confidence):** `pyramid-synth.wgsl:240-258` (match_stats, sector branch) and `:441-446` (reconstruct, sector branch) do direct single-sector lookup with no interpolation. Tile mode does 4-neighbor bilinear — sector mode explicitly does not. That comment is half right (stats within a sector ARE uniform for a single pooling region) but wrong at the sector interface: adjacent pixels in *different* sectors jump discontinuously. On white space, `tile_mean_L` differs between neighboring sectors by a tiny amount (mostly from atomic-FP quantization noise), and that small color jump along a wedge-shaped boundary is exactly the visible artifact.

Secondary source: `reconstruct` line 490, `L = clamp(tile_mean_L + synth_luma * detail_strength, 0, 1)`. On sectors with small-but-nonzero variance from FP rounding, `synth_luma` inherits random noise magnitude, amplified by `detail_strength` up to 3.0.

**The fix — partition-of-unity (Freeman & Simoncelli 2011 §3.3):**

1. For every fragment, compute continuous ring index `n_cont` and continuous spoke index `k_cont` (already available at `pyramid-stats.wgsl:180` and `pyramid-synth.wgsl:187`)
2. Identify the **four** sector neighbors: inner-previous-spoke, inner-next-spoke, outer-previous-spoke, outer-next-spoke
3. Compute smooth partition-of-unity weight per neighbor using raised-cosine kernel (sum = 1)
4. Stats are a weighted sum of the 4 neighbors (not winner-take-all)

Special cases:
- Ring 0 (foveal singularity, 1 spoke) — degenerate, weight inner pair as center
- Outermost ring — clamp outer-neighbors to the ring itself (weights collapse to ring pair)
- Spoke wrap-around at ±π — modular arithmetic on spoke index

**Files touched:**
- `renderer/shaders/pyramid-synth.wgsl` — rewrite `computeSectorIdMS` and `computeSectorIdRC` to return a weighted neighbor bundle, not a single ID. Update `match_stats` and `reconstruct` to consume the bundle like tile-mode bilinear.
- Possibly extend `TileStatsTier3` accessor helpers to accept a weight vector and return blended stats
- `renderer/shaders/pyramid-stats.wgsl` — accumulate pass unchanged; pooling regions stay hard-partitioned at stats-extraction (correct). Only the *read-back* side blends.

**Validation:**
- Visual: white page + dark text in mode 15. Expect: noise wedges disappear from white space; text region still shows pooled synthesis
- New `tests/validation/sector-blending/white-smoothness.test.js` — max per-pixel delta across a ring boundary ≤ 2/255 (1% luma step)
- `compare-brown-metamers.js` — SSIM on white-space bands should rise substantially

**Risk — perf:** 4× stats reads per fragment in `reconstruct`. `reconstruct` dispatches one thread per pixel → 4× storage-buffer reads per thread. On 3840×2024 canvas at half-res = ~7.7M threads × 72 bytes × 4 = ~2.2 GB/frame. Should fit bandwidth but measure. If too slow: 2-tap variant along dominant gradient is usually sufficient for POU.

**Commits:**
1. `renderer: partition-of-unity sector blending in pyramid-synth reconstruct`
2. (if split) `renderer: extend POU to match_stats for cross-scale correlation blend`

### Phase 3 — Oriented statistics primer (the L2 work, optional)

**Effort:** ~1 week / 2-3 commits. **Defer unless Phase 2 alone doesn't produce shippable output.**

Per `docs/next-steps-2026-04.md` P2:
- Extend `pyramid-stats.wgsl` from isotropic Laplacian bands to 4-orientation × 3-scale steerable pyramid approximation
- Per-sector stats balloon from 18 floats to ~54+ (12 oriented magnitudes + 12 oriented variances + 9 cross-orientation correlations, minus existing)
- `pyramid-decompose.wgsl` gains 4 oriented bandpass outputs per scale

**Requires Path B (buffer packing) from Phase 1B** — storage-buffer count exceeds 10 without consolidation. Plan a bind-group refactor at the same time.

**Risk:** Multi-week, flagged in `docs/next-steps-2026-04.md` as "risks further destabilizing mode 15." Keep behind a config flag.

### Phase 4 — Brown-metamer validation re-run

**Effort:** ~0.5 day / 1 commit.

- Run `scripts/compare-brown-metamers.js` against freshly captured mode 15 output (now real radial TTM)
- Capture new goldens: update `tests/golden-captures/brown-metamers/manifest.json` mode15 entries
- Update `CHANGELOG.md`: "mode 15 SSIM now measures real radial pooling, not MIP fallback"
- Update `docs/next-steps-2026-04.md` — mark P0/P1 items done

**Commit:** `validation: re-baseline Brown-metamer SSIM for mode 15 after radial TTM fix`

---

## 3. Parallel vs sequential

```
Phase 1A (diagnostic)  ─┬─▶ Phase 1B (buffer limit)  ──▶ Phase 2 (POU blending) ──▶ Phase 4 (validation)
                        │                                        │
                        └──────────── Phase 2 WGSL design in parallel, merge after 1B ────┘

Phase 3 (oriented stats) — deferred. Only start after Phase 2 proves L4 was the bottleneck.
```

- Phase 1A is the critical path for everything
- Phase 1B is required for the pipeline to actually run
- Phase 2 WGSL can be drafted and code-reviewed in parallel with 1B; visual validation blocks on 1B
- If Phase 2 alone produces shippable output, Phase 3 is a research extension, not a blocker

---

## 4. Noise-wedge root-cause hypothesis (ranked)

1. **Dominant (~70%):** hard winner-take-all sector assignment in `match_stats` and `reconstruct`. Each wedge-shaped sector uses slightly different `tile_mean_*` due to FP quantization. **The visible wedges ARE the sector shapes.**
2. **Secondary (~20%):** `detail_strength = mix(0.5, 3.0, alpha)` in `reconstruct:482` amplifies subpixel-small `synth_luma` noise up to 3× in far periphery.
3. **Tertiary (~10%):** low-population sectors near fovea boundary. Rings 1-2 with small spoke counts may contain <100 pixels. `FP_SCALE = 1024` atomic accumulation gives ~1/1024 per-sample quantization; small-N pools produce measurable per-sector random offset.

**Test to confirm:** render 100% uniform white image through mode 15 after Phase 1B. Wedges persist on uniform input → #1 confirmed. Wedges absent on uniform but present on white-with-JPEG-noise → #3 more significant.

**Mitigation by phase:**
- Phase 2 (POU) addresses #1 directly, largely addresses #3 (neighbors smooth quantization)
- #2 one-line fix: clamp `detail_strength` to `mix(0.5, 2.0, alpha)` OR gate on `max(var0..var3) > eps`. Include in Phase 2 commit.

---

## 5. Risk of regression (blast radius)

**Phase 1A (diagnostic):** zero regression risk. Pure observability.

**Phase 1B path A:**
- Affects every WebGPU consumer through `webgpu-probe.js`: `WebGPUPyramidCompute` (modes 14, 15, 20) and `WebGPUCrowdingCompute` (modes 8-12ish tier 2.5)
- Request is additive: adapter grants if possible. Adapters that can't fail `requestDevice` → existing try/catch in `webgpu-probe.js:102-108` returns `success: false`, degrading the entire app to WebGL-only
- **Real regression risk for laptop-class GPUs.**
- **Mitigation:** check `adapter.limits.maxStorageBuffersPerShaderStage` first, only include in `requiredLimits` if adapter supports ≥10. Otherwise skip bump and rely on Phase 1A's health check to downgrade mode 15 to tier 2.5.
- Telemetry: capture affected-GPU rate

**Phase 1B path B:**
- Substantial WGSL refactor. Every noise read/write reindexed.
- Mitigate with dedicated Jest-visual regression test: pre/post refactor pixel-diff ≤ 1 LSB.

**Phase 2 (POU blending):**
- Affects only sector-mode mode 15 (and mode 20 once Workstream 2 lands). Mode 14 defaults to tile mode (no sectors).
- Perf regression is the main worry — see Phase 2 validation.

**Phase 3 (oriented stats):**
- Large. Config flag.

---

## 6. Workstream 2 — Mode 20 inherits radial TTM as L_background

Once Phase 4 lands, mode 20's dispatcher in `peripheral.frag:1900-1904` (`sampleDomAwarePrimitive`) takes `L_background = finalRGB`, which is the pooled color computed at line 1300/1312 — now genuine radial TTM. **No mode 20 code changes required.**

**Validation pass (~0.5 day, 1 commit):**

- Re-run `scripts/compare-brown-metamers.js` against both mode 15 and mode 20
- **Expect:** mode 15 SSIM rises substantially on non-text content. Mode 20 SSIM on *primitive* regions is unchanged (DOM compositor still owns those). Mode 20 SSIM on *non-primitive* regions now tracks mode 15.
- Update `docs/dom-aware-perception-plan.md:266` — remove "Closing the Brown-metamer SSIM gap on non-primitive content" from Out-of-scope; move to a Validation-targets section
- Update memory `project_scrutinizer_dom_aware_perception.md` — lift the "do NOT resume chasing Brown SSIM on mode 15" prohibition

**Commit:** `docs: lift non-primitive Brown-SSIM out-of-scope after radial TTM fix`

---

## 7. Time & commit summary

| Phase | Effort | Commits | Blocks |
|---|---|---|---|
| 1A diagnostic surface | 0.5 day | 1 | — |
| 1B buffer-limit fix (path A) | 1 day | 1 | Phase 1A |
| 2 POU sector blending | 2-3 days | 1-2 | Phase 1B (for visual validation) |
| 3 oriented stats (optional) | ~1 week | 2-3 | Phase 2 outcome + Path B from 1B |
| 4 Brown-metamer revalidation | 0.5 day | 1 | Phase 2 |
| W2 mode 20 inheritance + docs | 0.5 day | 1 | Phase 4 |
| **Minimum (without Phase 3)** | **~5 days** | **5-6 commits** | |

---

## 8. Known gotchas

- `pyramid-synth.wgsl:182, :205` and `pyramid-stats.wgsl:173` compute `r_deg` via different formulas that coincidentally agree. Inconsistency is a refactor trap during Phase 2 — unify at the same time.
- WGSL has no includes; `computeSectorIdMS` and `computeSectorIdRC` are copy-pasted. Phase 2 rewrites both — keep identical.
- `webgl-renderer.js:854` forces `effectiveTier = this.config.compute_tier` when `>= 3.0`, bypassing `_hasComputeData` gate. After Phase 1A on health-check failure, also drop `config.compute_tier` to 2.75 so the gate re-engages.
- `scripts/diff-brown-m15.js` should be the first validation tool after Phase 1B — per-pixel luma diff will instantly show whether the recon pipeline now produces signal.

---

## Critical Files

- `renderer/webgpu-pyramid-compute.js` — buffer allocation + pipeline construction
- `renderer/webgpu-probe.js` — device request, error handling
- `renderer/shaders/pyramid-synth.wgsl` — synthesis pipeline, sector math
- `renderer/shaders/pyramid-stats.wgsl` — stats accumulation
- `renderer/scrutinizer.js` — pipeline lifecycle, health-check hook site
- `renderer/shaders/peripheral.frag` — compute-sample branch (line 1284), DOM-aware compositor (`sampleDomAwarePrimitive`)
