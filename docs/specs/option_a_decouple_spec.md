# Option A: Decouple V4 Effects from V1 Displacement

> Spec version: 2.0 — 2026-03-30
> Prereqs: Option C (eccentricity-scaled sectors) ✅ shipped v2.7.1
> Unlocks: Wave 7c crowding asymmetry, Tier 3 pure-synthesis rendering, researcher-independent parameter variation
> Reviewed by: vision science agent, validation agent, codebase exploration agent

## Problem

`peripheral.frag` routes all V4 effects through a single gateway variable:

```glsl
// line 1183 — MIP blur depth
float coupledEccentricity = v1.distortionStrength * u_intensity * fovea_radius * blurMult;

// line 1297 — all V4 style effects (Frosted, Blueprint, desaturation, CA...)
float effectFactor = v1.distortionStrength;
```

`distortionStrength` is computed per-pixel in `processV1()` (line 927) from LGN suppression × V1 displacement amplitude × eccentricity scaling. Setting `v1_strength_mult: 0.0` zeroes `distortionStrength`, which kills MIP blur, chromatic decay, desaturation, contrast preservation, and all aesthetic effects. The entire V4 pipeline dies.

This coupling is an implementation convenience, not a biological constraint. V1 spatial displacement and V4 chromatic/pooling effects arise from different anatomical substrates.

## Biological Justification for Decoupling

| Process | Origin | Mechanism | Independent variable |
|---------|--------|-----------|---------------------|
| Spatial displacement (crowding) | V1 complex cells, V2 | Compulsory feature averaging within pooling regions | RF size ∝ CMF |
| Chromatic sensitivity loss | Retina, LGN | Cone distribution (S-cone dropoff, L-M ratio) | Eccentricity (Mullen 1991) |
| Rod desaturation | Retina | Rod/cone ratio transition | Eccentricity (Curcio et al. 1990) |
| Contrast preservation | M-cell pathway (LGN) | M vs P cell luminance emphasis | Pathway, not cortical pooling |
| Spatial pooling (blur) | V1–V2 RF growth | Receptive field size scaling | CMF (Schwartz 1977) |

All share eccentricity as the independent variable. None share a mechanism with V1 displacement. The refactor separates the *functions* of eccentricity while preserving eccentricity as the shared input.

**Effects that MUST remain coupled:**
- Pooling region size and crowding critical spacing — these are the same phenomenon (Bouma 1970; Pelli & Tillman 2008). Both derive from CMF.
- Chromatic spatial resolution is bounded by achromatic resolution at all eccentricities. The castleCSF per-band attenuation already enforces this correctly.

**Coupling the current architecture gets wrong:**
- Isolated elements at 15° retain too much color because density-gated `distortionStrength` is low (no flankers → low crowding → low chromatic decay). But chromatic sensitivity loss is retinal, not scene-dependent. An isolated red letter at 15° should still lose its redness.

## Architecture

### Core Insight: Per-Pixel, Not Per-Mode

The validation agent identified a critical flaw in the initial "3 new uniforms" proposal: `distortionStrength` varies per-pixel (modulated by LGN saliency, DOM density, distortion type). CPU-side uniforms cannot reproduce this. The decoupling must happen **inside the shader** via new fields on `V1_Signal`.

### New Struct: EccentricityProfile

Computed once per fragment in `processV4()`, consumed by all downstream effect stages. Replaces ad-hoc eccentricity recomputations scattered across V4.

```glsl
struct EccentricityProfile {
    float ecc_deg;              // degrees of visual angle from fixation
    float normEcc;              // [0,1] normalized eccentricity
    float corticalMag;          // M-scaling: 1 / (1 + ecc/e2), e2~2.5
    float masterT;              // unified smoothstep curve (currently line 1270)
    float colorOnset;           // t² — quadratic chromatic effect onset
    float rodOnset;             // t³ — cubic rod desaturation onset
    float poolingRadius;        // Bouma: ~0.5 × ecc_deg (crowding region)
    float acuityFactor;         // spatial resolution limit at this eccentricity
};
```

`masterT` already exists at line 1270 (`smoothstep(0.0, fovea_radius * 4.0, eccentricity)`). The profile makes it a first-class value rather than a local variable buried in V4.

### Extended V1_Signal

```glsl
struct V1_Signal {
    vec2  distortedUV;
    float distortionStrength;   // V1 displacement amplitude (unchanged)
    vec2  displacement;
    float scrambleZone;
    // --- NEW: independent V4 drivers ---
    float v4PoolingStrength;    // drives MIP blur depth (replaces distortionStrength in line 1183)
    float v4EffectStrength;     // drives V4 aesthetic effects (replaces distortionStrength in line 1297)
};
```

### Per-Pixel Computation in processV1()

For **legacy modes** (0–14), the new fields are identity-assigned:

```glsl
// Legacy equivalence — zero behavioral change
signal.v4PoolingStrength = signal.distortionStrength;
signal.v4EffectStrength  = signal.distortionStrength;
```

For **Tier 3 modes** (compute_tier >= 3.0), the new fields derive from eccentricity directly:

```glsl
// Tier 3: eccentricity-driven, independent of displacement
float eccStrength = lgn.suppressionFactor * eccentricityScale;
eccStrength *= (1.0 - memoryStrength);
signal.v4PoolingStrength = eccStrength;
signal.v4EffectStrength  = eccStrength;
// V1 displacement can be zero — V4 still functions
signal.distortionStrength = 0.0;
```

### Mode-Level Policy Control

A new field in `modes.json` controls which path processV1 takes:

```json
{
  "v4_eccentricity_source": "v1_coupled"    // legacy: v4 fields = distortionStrength
}
```

```json
{
  "v4_eccentricity_source": "eccentricity"  // Tier 3: v4 fields from eccentricity profile
}
```

Default (absent): `"v1_coupled"` — all existing modes unchanged.

Corresponding uniform:

```glsl
uniform float u_v4_eccentricity_source;  // 0.0 = v1_coupled, 1.0 = eccentricity
```

### Rewiring Points in processV4()

**Line 1183** — MIP blur depth:
```glsl
// BEFORE:
float coupledEccentricity = v1.distortionStrength * u_intensity * fovea_radius * blurMult;
// AFTER:
float coupledEccentricity = v1.v4PoolingStrength * u_intensity * fovea_radius * blurMult;
```

**Line 1297** — V4 effect factor:
```glsl
// BEFORE:
float effectFactor = v1.distortionStrength;
// AFTER:
float effectFactor = v1.v4EffectStrength;
```

For legacy modes, `v4PoolingStrength == distortionStrength` and `v4EffectStrength == distortionStrength`, so the output is identical.

### Compute Texture Compositing (Tier 3)

When `u_compute_tier >= 3.0` and `v4_eccentricity_source == "eccentricity"`:

```glsl
if (u_compute_tier >= 3.0) {
    vec4 computeSample = texture(u_computeStatTexture, computeUV);
    // Compute texture IS the pooled representation — no MIP fallback needed
    pooledCol = computeSample.rgb;
    // V4 effects (chromatic decay, desaturation, contrast) driven by
    // v4EffectStrength, which is eccentricity-based, not displacement-based.
    // Smooth content snap-back and magnocellular preservation still apply,
    // but keyed to eccentricity, so they don't undo the synthesis.
}
```

The 5 stacked issues from `tier3_lessons_learned.md` become individually addressable:
1. **Sector means too close to original** → synthesis quality issue, unchanged
2. **Blend factor capped at 60%** → `v4PoolingStrength` can be full eccentricity, not gated by displacement
3. **Smooth content snap-back** → now snaps back toward *synthesis* output, not undisplaced original
4. **Magnocellular contrast preservation** → keyed to eccentricity, appropriate strength
5. **Bilinear upsampling** → unchanged (compute texture resolution issue)

## Figma Insights

The Figma plugin port (`peripheral.figma.frag`) independently discovered patterns that validate this approach:

1. **Explicit `eccentricityScale` as intermediate** (lines 472-493) — computed before combining with other factors, exactly the pattern we're formalizing.
2. **`pow(corticalStrength, 1.5)` instead of `cs²`** — demonstrates that eccentricity scaling and density-gated crowding are separable concerns that got fused in desktop.
3. **`max(saliency, density)` dual-signal protection** — cleaner union of protections vs. desktop's sequential multiplication.
4. **Same coupling exists at line 683** — `coupledEccentricity = v1.distortionStrength * ...`. Desktop fix propagates to Figma.

## Incremental Refactor Plan

### Step 0: Baseline Captures (pre-refactor)

Capture golden screenshots for ALL 15 modes before touching any shader code.

```bash
# Extend capture-golden.js to cover modes 2, 3, 4, 5, 8 (currently missing)
# Each mode: 2 reference pages × 2 fixation points = 4 images minimum
npm run capture-golden -- --force --version=pre-optionA
```

Add per-pixel diff metric to `golden-compare.js`:
- Max absolute per-channel difference
- Count of pixels exceeding threshold
- Tighten thresholds: SSIM ≥ 0.9999, PSNR ≥ 55 dB, max pixel diff ≤ 1/255

### Step 1: Add V1_Signal Fields + Policy Uniform

Add `v4PoolingStrength` and `v4EffectStrength` to `V1_Signal`. In `processV1()`, assign them to `distortionStrength` (identity). Add `u_v4_eccentricity_source` uniform, always 0.0. No behavioral change.

**Validate:** Golden compare, all 15 modes. Bit-identical.

### Step 2: Rewire V4 Reads

Replace `v1.distortionStrength` with `v1.v4PoolingStrength` (line 1183) and `v1.v4EffectStrength` (line 1297). Identity assignment means same values flow through.

**Validate:** Golden compare again. Still bit-identical. This is the highest-risk step — MIP LOD selection is quantized (integer levels). Any floating-point deviation in the eccentricity argument can flip MIP levels and produce completely different pixel colors. The identity assignment (`signal.v4PoolingStrength = signal.distortionStrength`) must be a direct copy, zero arithmetic.

### Step 3: Add EccentricityProfile

Move master curve `t` and derived values (`t²`, `t³`) into the profile struct. Compute once at the top of `processV4()`. Replace scattered recomputations. Purely structural — same values, cleaner flow.

**Validate:** Golden compare. Bit-identical.

### Step 4: Implement Eccentricity-Direct Path

When `u_v4_eccentricity_source == 1.0`, compute `v4PoolingStrength` and `v4EffectStrength` from eccentricity profile instead of `distortionStrength`. Only mode 15 (TTM Synthesis) uses this.

**Validate:** Modes 0–14 pixel-identical. Mode 15 expected to change — validate with Brown comparison (target SSIM 0.21–0.24 for mid periphery), visual inspection, and eventual Wave 7c crowding test.

### Step 5: modes.json Integration

Add `v4_eccentricity_source` field to mode 15 only. All other modes default to `"v1_coupled"`.

```json
{
  "id": 15,
  "name": "TTM Synthesis",
  "pipeline": {
    "v4_eccentricity_source": "eccentricity",
    "compute_tier": 3.0,
    "v1_strength_mult": 0.0
  }
}
```

## Legacy Equivalence Proof

For all modes where `v4_eccentricity_source == "v1_coupled"` (modes 0–14):

| Coupling point | Line | Before | After | Equivalence |
|---|---|---|---|---|
| MIP blur depth | 1183 | `v1.distortionStrength` | `v1.v4PoolingStrength` | `v4PoolingStrength := distortionStrength` in processV1 |
| V4 effect gate | 1297 | `v1.distortionStrength` | `v1.v4EffectStrength` | `v4EffectStrength := distortionStrength` in processV1 |

No new arithmetic. Direct struct field copy. Zero floating-point precision risk.

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| MIP LOD quantization flips | HIGH | Identity assignment = direct copy, no arithmetic. Step 2 golden compare catches any deviation. |
| Smooth content snap-back cascade | MEDIUM | `smoothContent` depends on `pooledCol` which depends on `coupledEccentricity`. Identity assignment preserves the chain. |
| V4 style branches (Frosted, Blueprint, MC) | MEDIUM | All gated by `effectFactor`. Identity assignment preserves values. |
| Mode 5 (Drunken Reading) non-determinism | LOW | Pin `u_time = 0.0` in capture pipeline for animated modes. |
| Compute tier fallback interaction | LOW | Fallback path uses `coupledEccentricity` which flows from `v4PoolingStrength`. Identity preserves. |

## Test Infrastructure Gaps

| Gap | Action | Priority |
|-----|--------|----------|
| Missing mode coverage in golden captures | Add modes 2, 3, 4, 5, 8 to `capture-golden.js` | P0 |
| No per-pixel diff metric | Add max abs diff + diff-count to `golden-compare.js` | P0 |
| No pixel-identical threshold preset | Add `--pixel-identical` flag (SSIM=0.9999, PSNR=55, maxDiff=1) | P0 |
| Unfilled regression anchors in `cortical-strength.test.js` | Fill `coupledEccentricity` values at known (mode, ecc, type) tuples | P1 |
| No A/B diff image output | Write amplified diff image highlighting regressions | P2 |
| Mode 5 determinism | Pin `u_time = 0.0` in capture pipeline | P1 |

## Researcher Extensibility

After the refactor, researchers can independently vary:

| Parameter | What it controls | Experiment type |
|-----------|-----------------|-----------------|
| `v1_strength_mult` | Displacement amplitude only | Crowding geometry studies |
| `v4_eccentricity_source` | Whether V4 keys off displacement or eccentricity | Mechanism comparison |
| `v4PoolingStrength` curve | MIP blur depth independently | Resolution limits |
| Chromatic decay rates (rg_decay, yv_decay) | Color sensitivity independently | Chromatic CSF validation |
| Sector geometry (num_cortical_rings, cmf_a) | Pooling region shape independently | CMF model comparison |

**Currently impossible:** "What does peripheral vision look like with normal spatial pooling but no chromatic decay?" or "What if chromatic decay is 2× faster than normal?" — both require the decoupled architecture.

The BenderConfig/CutterConfig pattern (lines 766–795) is the template for how pluggable mechanisms should work. The V4 refactor follows the same principle: parameterized structs, named apply functions, swappable via mode config.

## EccentricityProfile — Vision Science Reference

Transfer functions each field should implement, per published psychophysics:

| Field | Function | Key citation |
|-------|----------|--------------|
| `ecc_deg` | Input: pixel distance → degrees via fovea radius | Geometric |
| `corticalMag` | `M₀ / (1 + ecc/e2)`, e2 ≈ 2.5° | Schwartz 1977; Rovamo & Virsu 1979 |
| `masterT` | `smoothstep(0, fovea_radius × 4, eccentricity)` | Current implementation (line 1270) |
| `colorOnset` | `t²` — quadratic onset | Matches Mullen 1991 decay shape |
| `rodOnset` | `t³` — cubic onset, deferred to far periphery | Curcio et al. 1990 rod/cone transition |
| `poolingRadius` | `0.4–0.5 × ecc_deg` (Bouma's law) | Bouma 1970; Pelli & Tillman 2008 |
| `acuityFactor` | `1 / (1 + e2 × ecc)`, e2 per castleCSF | Watson 2014 |

The struct stores eccentricity in degrees to enable direct parameterization from published data. The current shader's `dist` is in pixel-normalized coordinates relative to `fovea_radius`, which makes validation against published functions harder than it needs to be.

## Files Modified

| File | Change | Risk |
|------|--------|------|
| `renderer/shaders/peripheral.frag` | V1_Signal extension, EccentricityProfile struct, 2 line rewires | HIGH — golden captures required |
| `renderer/webgl-renderer.js` | New uniform (`u_v4_eccentricity_source`), bind from mode config | LOW |
| `shared/modes.json` | Add `v4_eccentricity_source` to mode 15 only | LOW |
| `scripts/capture-golden.js` | Add modes 2, 3, 4, 5, 8 to variants | LOW |
| `scripts/golden-compare.js` | Add per-pixel diff metric, pixel-identical preset | LOW |

## Success Criteria

1. Modes 0–14: pixel-identical golden captures before/after (SSIM ≥ 0.9999)
2. Mode 15 (TTM Synthesis): V4 effects active with `v1_strength_mult: 0.0`
3. Brown comparison SSIM for mode 15 improves toward 0.21–0.24 target
4. 314+ tests pass, no regressions
5. Architecture supports Wave 7c crowding asymmetry test (isolated vs flanked)

## Lessons from Prior Restarts

This project has a pattern of Tier 3 / fragment shader attempts that get reverted. The isotropic implementation journal documents 8 attempts (7 failed). The Tier 3 lessons doc has 2 sessions with reverts. Git history shows 7 revert commits touching peripheral.frag. The pattern:

| Attempt | What happened | Root cause |
|---------|--------------|------------|
| Isotropic #1-6 | Gray blobs, pixel dust, tile artifacts | Tried to use sectors as rendering unit |
| Isotropic #7 | lodFloor killed texture while reducing readability | Blur ≠ scrambling |
| Tier 3 Session 1 | No visible degradation with v1=0 | 5 stacked compositing issues |
| Tier 3 Session 2 | Fragment shader changes caused hard bands, dim periphery | Per-parameter tweaking of deeply coupled pipeline |
| Multiple shader rollbacks | v1.3, v1.4.1, Tier 1.5, Tier 1.6 baselines | Advancing too many fronts simultaneously |

**The meta-lesson from isotropic attempt #8:** Success came from NOT using sectors as the rendering unit. "Sector geometry drives transition rate, not mechanism." The proven Bender+Cutter mechanism stayed; sectors parameterized it. Same principle applies here: the proven V4 pipeline stays; eccentricity parameterizes it instead of distortionStrength.

**Why this refactor is different from prior Tier 3 attempts:**

1. **No new rendering algorithm.** Steps 1-3 change zero visual output. The refactor is structural — rewiring data flow, not inventing new compositing.
2. **Identity assignment eliminates floating-point risk.** Prior attempts tweaked blend factors, snap-back thresholds, magnocellular preservation. Each tweak cascaded. Identity assignment means `new_value == old_value` by construction.
3. **Golden capture gates at each step.** Prior attempts validated at the end. This plan validates after every structural change, before any behavioral change.
4. **Behavioral change is isolated to mode 15.** Modes 0-14 never see the eccentricity-direct path. The blast radius is one research mode, not the whole pipeline.
5. **The fragment shader compositing is NOT being changed.** Tier 3 Session 2's failure came from changing blend caps, snap-back, and magnocellular in the fragment shader. This refactor changes WHERE the values come from, not HOW they're used.

### Abort Criteria

If any of these occur, stop and reassess rather than pushing through:
- Step 2 golden compare shows ANY pixel differences in modes 0-14
- Mode 15 with eccentricity-direct produces a hard band at the parafovea (the Session 2 failure mode)
- More than 2 uniforms need to be added beyond `u_v4_eccentricity_source`
- The EccentricityProfile struct grows beyond 8 fields

## Extensibility Value Proposition

### The Current Extensibility Gap

Scrutinizer has 65 uniforms and 15 modes, but the extensibility story has a false floor. The mode system presents a declarative configuration surface, but beneath it:

- **38 pipeline parameters** are exposed in modes.json, but only ~18 produce meaningful behavioral change without shader modification
- **V1 and V4 are coupled** — you can't study spatial degradation independently from chromatic degradation
- **Adding a distortion type** requires editing a 2000-line shader, not JSON
- **Hard-coded shader constants** (DoG band cutoffs, CMF function shape) aren't exposed as uniforms
- **Runtime toggles override mode values** without persisting — breaking reproducibility

The extensibility agent identified a 3-tier story: configuration-only (easy), texture source swapping (medium), shader customization (hard). The gap between tier 1 and tier 3 is too wide.

### What Option A Changes for Researchers

**Before (current):** "I want to study chromatic decay in the periphery without spatial distortion."
→ Set `v1_strength_mult: 0.0`
→ All V4 effects die (chromatic decay, desaturation, blur, contrast)
→ "That's not possible in this architecture."

**After (Option A):** Same request.
→ Set `v4_eccentricity_source: "eccentricity"`, `v1_strength_mult: 0.0`
→ V1 displacement is zero, V4 effects driven by eccentricity profile
→ Chromatic decay, desaturation, contrast preservation all work normally
→ Researcher sees peripheral color loss without spatial scrambling

### New Experiment Types Enabled

| Experiment | Before | After |
|-----------|--------|-------|
| Chromatic decay without crowding | Impossible | `v1_strength_mult: 0, v4_eccentricity_source: eccentricity` |
| Crowding without chromatic decay | Impossible (chromatic decay is gated by displacement) | `chromatic_pooling: false` works independently now |
| Pure TTM synthesis (no displacement) | Fragment shader kills all V4 | Compute texture as primary + eccentricity-driven V4 |
| A/B mechanism comparison | Manual shader editing | Toggle `v4_eccentricity_source` per mode |
| Isolated chromatic sensitivity at eccentricity | Scene-dependent (density gates color) | Eccentricity-driven (retinally correct) |
| Custom eccentricity transfer function | Requires shader edit | Override EccentricityProfile fields via new uniforms (future) |

### The BenderConfig/CutterConfig Precedent

The isotropic journal's success (attempt #8) established the pattern: extract mechanisms as parameterized structs with named apply functions, configurable via mode JSON. This refactor extends that pattern from V1 → V4:

```
V1 (shipped):  BenderConfig → applyBender()  — swappable via v1_distortion_type
               CutterConfig → applyCutter()  — swappable via v1_distortion_type

V4 (Option A): EccentricityProfile → drives all V4 effects
               v4_eccentricity_source → swaps coupling policy
```

Future extensions follow the same pattern:
- `PoolingConfig` → custom pooling behavior (hexagonal, sector-weighted, etc.)
- `ChromaticConfig` → custom chromatic decay (swap castleCSF for Mullen 1991 direct)
- `ContrastConfig` → custom M-cell/P-cell balance

Each is a struct + apply function + mode selector. No monolithic refactor — incremental extraction.

### Toward a Researcher Panel

The EccentricityProfile struct makes a concrete UI possible:

```
┌─ Eccentricity Profile ──────────────────────────┐
│ Source: [v1_coupled ▾]  [eccentricity ▾]         │
│                                                   │
│ Spatial pooling:  ██████████░░░░  v1_strength=0.8 │
│ Chromatic RG:     ████████░░░░░░  rg_decay=0.085  │
│ Chromatic BY:     ██████████████  yv_decay=0.014  │
│ Rod desaturation: ████░░░░░░░░░░  onset=t³        │
│ Contrast:         ██████████░░░░  magno=0.6       │
│                                                   │
│ [Export as Mode]  [Reset to Default]              │
└───────────────────────────────────────────────────┘
```

Each slider is an independent uniform. The "Export as Mode" button writes the current config to modes.json as a new entry. This closes the gap between interactive exploration and reproducible experiment.

### Impact on Figma Plugin

The Figma plugin (`peripheral.figma.frag`) has the same coupling at line 683. The desktop refactor establishes the pattern; the Figma port follows:

1. Add `v4PoolingStrength` / `v4EffectStrength` to Figma's V1_Signal
2. Identity assignment for current behavior
3. Future: Figma researchers can toggle eccentricity-direct mode too

The Figma plugin already has cleaner intermediates (`eccentricityScale` as explicit value). The desktop refactor catches up to Figma's clarity while going further with the policy switch.

## References

- Bouma 1970: Critical spacing = 0.5 × eccentricity
- Curcio et al. 1990, 1991: Photoreceptor distribution, S-cone density
- Freeman & Simoncelli 2011: Texture pooling model
- Hansen et al. 2009: Chromatic spatial resolution eccentricity
- Mullen 1991: Chromatic CSF eccentricity dependence
- Pelli & Tillman 2008: Crowding review
- Rosenholtz et al. 2012: TTM summary statistics
- Rovamo & Virsu 1979: M-scaling
- Schwartz 1977: Cortical magnification
- Strasburger et al. 2011: Comprehensive peripheral vision review
- Toet & Levi 1992: Crowding radial/tangential anisotropy
- Tyler 1987: Temporal sensitivity eccentricity
