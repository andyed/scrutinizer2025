# CMF-to-MIP Mapping Review (2026-03-03)

## Context
Nicholas Blauch (FOVI co-author) reviewed our CMF-to-MIP mapping and flagged issues across three rounds of feedback.

## The Core Confusion: Two Different Quantities

1. **Cortical distance**: d(r) = ln(r+a) - ln(a). Integral of CMF = 1/(r+a). Natural log. From Schwartz (1980) complex log mapping w = log(z+a).

2. **Resolution halvings**: h(r) = log2(M(0)/M(r)) = log2(1+r/a). Number of times resolution has halved from foveal baseline. Base-2 log. Directly maps to MIP level semantics.

These are proportional: h(r) = d(r)/ln(2). Factor of 1.443.

## Blauch's Three Objections (All Valid)

1. **Notation**: Write `ln(r+a) - ln(a)`, not `ln(1+r/a)`. The subtracted form shows the derivation (integral evaluated at bounds). The collapsed form hides zero-referencing.

2. **Log base**: FOVI uses natural log throughout. Our original `log2` was justified by MIP semantics but diverges from FOVI's formulation. Blauch wants natural log.

3. **Normalization**: FOVI normalizes cortical distance by dividing by the range. We should do the same: `mipLevel = maxMipLevel * d(r) / d(r_max)`.

## The ln(1+r/a) = ln(r+a)-ln(a) Equivalence
Algebraically identical. Blauch's objection is notational/pedagogical, not mathematical. But notation matters for code maintainability and reviewer trust.

## Correct Formulation

### Shader
```glsl
uniform float u_cmf_a;         // Schwartz shift parameter (2.78 deg)
uniform float u_cortical_max;  // ln(r_max+a) - ln(a), precomputed

float cortical_dist = log(r_deg + u_cmf_a) - log(u_cmf_a);
float mipLevel = clamp(maxMipLevel * cortical_dist / u_cortical_max, 0.0, maxMipLevel);
```

### DoG band cutoffs (inverting the mapping)
```
k * [ln(r+a) - ln(a)] = level  -->  r = a * [exp(level/k) - 1]
where k = maxMipLevel / cortical_max
equivalently: scale = cortical_max / maxMipLevel
r = a * [exp(level * scale) - 1]
```

### JS side
```javascript
const corticalMax = Math.log(rMaxDeg + cmfA) - Math.log(cmfA);
gl.uniform1f(this.corticalMaxLocation, corticalMax);
```

## Backward Compatibility
Setting corticalMax = maxMipLevel * Math.LN2 reproduces old log2(1+r/a) behavior.

## Open Question: Halvings vs Normalized Distance
- log2(1+r/a) directly gives number of resolution halvings (MIP semantics)
- FOVI normalization stretches to fill [0, maxMipLevel] regardless of r_max
- With a=2.78, r_max=16 deg: log2(1+16/2.78) = 2.76 halvings, so direct approach only reaches MIP 2.76
- FOVI normalization would stretch this to MIP 4.0
- Recommendation: use FOVI normalization for reviewer alignment, document the deviation from pure halvings

## References
- Schwartz (1980): Complex log mapping w=log(z+a), Vision Research 20(8)
- Blauch, Konkle & Alvarez (2026): FOVI, arXiv:2602.03766
- Balasubramanian et al. (2002): Two-parameter model w=k*log(z+a)
