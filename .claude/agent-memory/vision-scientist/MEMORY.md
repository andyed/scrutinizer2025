# Vision Scientist Agent Memory

## Scrutinizer Project Architecture
- Foveated vision renderer in WebGL (fragment shader: `renderer/shaders/peripheral2.frag`)
- Neuro-architecture pipeline: LGN (gating) -> V1 (geometry/distortion) -> V4 (aesthetics)
- DoG band decomposition (v1.6+): exploits hardware MIP chain for eccentricity-dependent spatial frequency attenuation
- Key doc: `docs/foveated-vision-model.md`
- BGRA->RGBA swap throughout shader due to Electron capture quirk

## Review Findings (2026-02-27)
- See `dog-review-findings.md` for detailed technical review of DoG implementation

### RESOLVED (2026-03-03)
- ~~MIP chain is NOT a Gaussian pyramid~~ — all docs now say "approximate Laplacian pyramid (box/bilinear, not Gaussian)" with Burt & Adelson 1983 citation
- ~~2x geometric progression for band cutoffs is steeper than biological M-scaling~~ — replaced with linear M-scaling: cutoff_k = E2 * (2^k - 1), giving 1, 3, 7, 15 × E2. E2 recalibrated (0.5→0.15 High-Key, 0.4→0.12 Biological)
- ~~Band differences can go negative; no clamping~~ — shader now clamps final result to [0,1]

### OPEN
- E2 parameter operates in normalized screen coords, not degrees of visual angle -- naming could mislead
- coupledEccentricity in processV4 cancels out fovea_radius, so DoG is driven by distortionStrength not geometric eccentricity
- Cones/"What" and Rods/"Where" labels in Section 1.1 conflate with dorsal/ventral stream terminology

## CMF-to-MIP Review (2026-03-03)
- See `cmf-mip-review.md` for detailed analysis of Blauch feedback
- Key finding: `ln(1+r/a)` is algebraically identical to `ln(r+a)-ln(a)` but Blauch wants the FOVI/Schwartz notation
- Correct shader form: `mipLevel = maxMipLevel * [ln(r+a) - ln(a)] / [ln(r_max+a) - ln(a)]`
- Pass `u_cortical_max = ln(r_max+a) - ln(a)` as uniform instead of collapsed `k`
- Two interpretations: "halvings" (log2, direct MIP) vs "normalized cortical distance" (ln, FOVI-style)
- Schwartz (1980): w = log(z+a), cortical distance = ln(r+a) - ln(a), CMF = 1/(r+a)
- FOVI code (coords.py): `log(radius+cmf_a) - log(cmf_a)` normalized by `log(fov/2+cmf_a) - log(cmf_a)`

## Key Parameters
- dog_e2: default 0.15 (High-Key), 0.12 (Biological) -- normalized units, not degrees
- dog_sharpness: 0.0=biological (wide transitions), 1.0=sharp
- fovea_radius normalized to screen height
- parafovea = 2.5x fovea_radius
