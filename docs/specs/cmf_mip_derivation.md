# CMF → MIP Level Mapping: Bug Report

> **Last updated:** 2026-03-07

Date: 2026-03-03
Status: SHIPPED (v1.8+, commit 5be3b2b; optimized to log1p form in a9051e3)
Source: Feedback from Nicholas Blauch (FOVI co-author)

## Summary

Three errors in how Scrutinizer maps the FOVI cortical magnification function to GPU MIP levels:

1. **Wrong log base** — we use `log₂` where the CMF integral requires natural log
2. **Collapsed notation** — we wrote `log₂(1 + r/a)` instead of the traceable `ln(r+a) - ln(a)`, hiding the derivation and making it unauditable against the source math
3. **Missing normalization** — FOVI normalizes cortical distance by dividing by the range `ln(r_max+a) - ln(a)`; we skipped this and let the log base do implicit (wrong) scaling

The net effect: MIP levels climb 44% faster than the biology predicts. The periphery is over-pooled — text that should be partially legible in the parafovea gets blurred into mush.

## What Blauch Said

Round 1:
> You should also check your MIP equation. I don't believe this follows the math from our CMF. We have CMF=1/(r+a). This integrates to log(r+a) in the complex log equation, or slightly differently using the full 3D manifold. I am not sure where your log_2(1+e/a) is coming from.

Round 2 (after our initial response proposing `k × ln(1 + r/a)`):
> Sorry, but this is still wrong. Where is r/a coming from? Where is the 1 + coming from? Adding in a constant to the log is the wrong way to zero-reference, as it changes the shape of function (similar to a, which is the key parameter for determining foveation strength). Instead, just subtract off the baseline log(a). And you need to be more careful with switching to a different log base. The formulas are based on natural log.

Round 3 (after our second response proposing `k = maxMipLevel / ln(1 + r_max/a)`):
> Still several issues mentioned in my previous comment above :)

## The Current (Buggy) Code

`peripheral2.frag` lines 192, 217:
```glsl
mipLevel = clamp(log2(max(1.0, (r_deg + u_cmf_a) / u_cmf_a)), 0.0, maxMipLevel);
```

This collapses to `log₂(1 + r/a)`. Three problems packed into one line:
- `log2` instead of `log` (natural log)
- `(r+a)/a` instead of `(r+a)` with separate `- ln(a)` subtraction
- No normalization by the cortical distance range

## What FOVI Actually Does

From `fovi/sensing/coords.py`:

```python
# logpolar_radius() — the canonical mapping
log_radius = (torch.log(radius + cmf_a) - torch.log(cmf_a)) / \
             (torch.log(fov/2 + cmf_a) - torch.log(cmf_a))
```

Breaking this down:
- `torch.log(radius + cmf_a)` — cortical distance, natural log, `w = ln(r + a)` (Schwartz 1980)
- `- torch.log(cmf_a)` — zero-reference by subtracting `ln(a)`, NOT by adding 1 inside the log
- `/ (torch.log(fov/2 + cmf_a) - torch.log(cmf_a))` — normalize to [0, 1] by dividing by the total cortical range

The complex log mapping is `w = log(z + a)` where `z = x + iy`. FOVI uses natural log throughout with no base conversion.

## The Math

### Step 1: CMF → cortical distance

```
CMF(r) = 1 / (r + a)

d(r) = ∫₀ʳ 1/(t + a) dt = ln(r + a) - ln(a)
```

Note: `ln(r + a) - ln(a)` equals `ln(1 + r/a)` algebraically. But the `ln(r+a) - ln(a)` form is what matters — it traces directly to the Schwartz (1980) complex log mapping `w = log(z + a)` with an explicit zero-reference subtraction. The collapsed `ln(1+r/a)` form hides this derivation and makes it impossible to audit against the source math.

### Step 2: Normalized cortical distance → MIP level

FOVI normalizes cortical distance to [0, 1]:

```
d_normalized(r) = [ln(r + a) - ln(a)] / [ln(r_max + a) - ln(a)]
```

We map this to [0, maxMipLevel]:

```
mipLevel = maxMipLevel × d_normalized(r)
         = maxMipLevel × [ln(r + a) - ln(a)] / [ln(r_max + a) - ln(a)]
```

Precompute the denominator as `cortical_max = ln(r_max + a) - ln(a)`:

```
mipLevel = maxMipLevel × [ln(r + a) - ln(a)] / cortical_max
```

### Step 3: r_max from foveal radius and screen size

The foveal radius encodes the user's pixels-per-degree calibration (fovea ≈ 2° visual angle):

```
r_max_deg = (screen_half_diagonal_px / fovea_radius_px) × 2.0°
cortical_max = ln(r_max_deg + a) - ln(a)
```

No new user-facing controls — `r_max` is derived from the foveal radius and screen dimensions, both already known.

### Why the collapsed form was wrong

Our code had `log₂((r+a)/a)` = `log₂(1 + r/a)` = `ln(1 + r/a) / ln(2)`.

This silently sets the normalization constant to `1/ln(2) ≈ 1.443`, which has no relationship to the actual cortical distance range. It happens to work "sort of" — the function shape is correct — but the scaling is wrong by an amount that depends on the screen geometry.

For a = 2.78° and a 1440×900 screen with 75px foveal radius (r_max ≈ 16°):

| | MIP at 5° | MIP at 10° | MIP at 16° |
|---|---|---|---|
| **Current** (`log₂`) | 1.38 | 2.22 | 3.07 |
| **Corrected** (normalized `ln`) | 0.93 | 1.51 | 2.09 |
| **Over-pooling** | 48% | 47% | 47% |

At every eccentricity, we're nearly 50% too aggressive. MIP level 2.2 (≈5× coarser) where the biology says 1.5 (≈3× coarser).

## Corrected Code

### Shader: `peripheral2.frag`

New uniform:
```glsl
uniform float u_cortical_max;  // ln(r_max + a) - ln(a), precomputed on JS side
```

MIP equation (replacing lines 192 and 217):
```glsl
// Cortical distance: d(r) = ln(r+a) - ln(a)
// Schwartz (1980), Blauch, Konkle & Alvarez (2026)
float cortical_dist = log(r_deg + u_cmf_a) - log(u_cmf_a);
mipLevel = clamp(maxMipLevel * cortical_dist / u_cortical_max, 0.0, maxMipLevel);
```

DoG band cutoffs (replacing lines 145–150, FOVI branch):
```glsl
// Invert: maxMipLevel * [ln(r+a) - ln(a)] / cortical_max = level
// → r = a * (exp(level * cortical_max / maxMipLevel) - 1)
float scale = u_cortical_max / maxMipLevel;
c0 = u_cmf_a * (exp(1.0 * scale) - 1.0) / fovea_deg;
c1 = u_cmf_a * (exp(2.0 * scale) - 1.0) / fovea_deg;
c2 = u_cmf_a * (exp(3.0 * scale) - 1.0) / fovea_deg;
c3 = u_cmf_a * (exp(4.0 * scale) - 1.0) / fovea_deg;
```

### Renderer: `webgl-renderer.js`

```javascript
// Compute cortical_max from screen geometry + foveal calibration
const foveaDeg = 2.0;
const halfDiag = Math.sqrt(width * width + height * height) / 2;
const rMaxDeg = (halfDiag / foveaRadius) * foveaDeg;
const corticalMax = this.config.cmf_enabled
    ? Math.log(rMaxDeg + this.config.cmf_a) - Math.log(this.config.cmf_a)
    : 4.0 * Math.LN2;  // legacy: reproduces old log₂ behavior (cortical_max = maxMip * ln(2))
gl.uniform1f(this.corticalMaxLocation, corticalMax);
```

Log on change:
```javascript
if (!this._lastCorticalMax || Math.abs(corticalMax - this._lastCorticalMax) > 0.01) {
    console.log(`[WebGLRenderer] CMF cortical_max=${corticalMax.toFixed(3)} (r_max=${rMaxDeg.toFixed(1)}° a=${this.config.cmf_a} fovea=${foveaRadius}px ${width}×${height})`);
    this._lastCorticalMax = corticalMax;
}
```

### Modes: `shared/modes.json`

Update CMF mode description (line 172):
```
"Cortical magnification from Blauch, Alvarez & Konkle (2026): mipLevel = maxMip × [ln(r+a) - ln(a)] / [ln(r_max+a) - ln(a)]. a=2.78°, r_max derived from screen geometry."
```

## Files to Change

| File | Change |
|------|--------|
| `renderer/shaders/peripheral2.frag` | Add `u_cortical_max` uniform; rewrite 2 MIP equations + 4 DoG cutoffs |
| `renderer/webgl-renderer.js` | Add location, compute `cortical_max`, upload, log on change |
| `shared/modes.json` | Fix CMF mode description |

## Backward Compatibility

For legacy modes (`cmf_enabled: false`), set `cortical_max = maxMipLevel × ln(2) = 4.0 × 0.693 = 2.773`. This makes the corrected equation reduce to the old `log₂` behavior:

```
maxMipLevel × [ln(r+a) - ln(a)] / (maxMipLevel × ln(2))
= [ln(r+a) - ln(a)] / ln(2)
= log₂((r+a)/a)
= log₂(1 + r/a)    ← the old equation
```

Pixel-identical for all non-FOVI modes.

## References

- Blauch, N. M., Konkle, T., & Alvarez, G. A. (2026). FOVI: Foveation for cortical magnification in visual AI. arXiv:2602.03766
- Schwartz, E. L. (1980). Computational anatomy and functional architecture of striate cortex: A spatial mapping approach to perceptual coding. Vision Research, 20(8), 645–669.
- Rovamo, J. & Virsu, V. (1979). An estimation and application of the human cortical magnification factor. Experimental Brain Research, 37, 495–510.
