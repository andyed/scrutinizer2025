# Vision Scientist Agent Memory

## Scrutinizer Project Architecture
- Foveated vision renderer in WebGL (fragment shader: `renderer/shaders/peripheral2.frag`)
- Neuro-architecture pipeline: LGN (gating) -> V1 (geometry/distortion) -> V4 (aesthetics)
- DoG band decomposition (v1.6+): exploits hardware MIP chain for eccentricity-dependent spatial frequency attenuation
- Key doc: `docs/foveated-vision-model.md`
- BGRA->RGBA swap throughout shader due to Electron capture quirk

## Review Findings (2026-02-27)
- See `dog-review-findings.md` for detailed technical review of DoG implementation
- MIP chain is NOT a Gaussian pyramid (box/bilinear filtering, not Gaussian convolution) -- doc should say "approximate"
- 2x geometric progression for band cutoffs is steeper than biological M-scaling (which is approximately linear)
- E2 parameter operates in normalized screen coords, not degrees of visual angle -- naming could mislead
- coupledEccentricity in processV4 cancels out fovea_radius, so DoG is driven by distortionStrength not geometric eccentricity
- Cones/"What" and Rods/"Where" labels in Section 1.1 conflate with dorsal/ventral stream terminology
- Band differences can go negative; no clamping before output

## Key Parameters
- dog_e2: default 2.5 (High-Key), 2.0 (Biological) -- normalized units, not degrees
- dog_sharpness: 0.0=biological (wide transitions), 1.0=sharp
- fovea_radius normalized to screen height
- parafovea = 2.5x fovea_radius
