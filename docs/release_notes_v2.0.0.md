# Scrutinizer v2.0.0 Release Notes

**Release Date:** March 2026

## In This Release

1. [Minecraft Mode (Block Pooling)](#minecraft-mode-block-pooling): CMF-driven block quantization makes the pooling pipeline visible as discrete geometry. Blocks sized 4–64px by MIP level, per-channel Oklab neighbor averaging.
2. [Minecraft Eyeball (Polar Pooling)](#minecraft-eyeball-polar-pooling): Radial variant: wedge-shaped polar sectors sized by CMF, emanating from gaze. Radially elongated ~2:1 matching TTM-predicted pooling region geometry (see correction below).
3. [Blueprint Mode (ARIA Wireframe)](#blueprint-mode-aria-wireframe): Reverse-engineers wireframes from live web pages using ARIA roles, congestion, saliency, and DOM structure. Role-colored bounding boxes on a blueprint background.
4. [Density-Gated Crowding](#density-gated-crowding): V1 distortion now modulated by local element density. Isolated elements spared (0.3× floor), dense content gets full crowding.
5. [Chromatic Decay Recalibration](#chromatic-decay-recalibration): RG/YV decay constants refit to Bowers et al. 2025 contrast-sensitivity (detection-threshold) data.
6. [Eccentricity Scaling](#eccentricity-scaling): `u_ecc_scaling` uniform modulates pooling growth rate across CMF-enabled modes (Brown et al. 2023).
7. [Arxiv Paper Sync](#arxiv-paper-sync): Paper updated with shipped features and new Open Questions section.

---

## Minecraft Mode (Block Pooling)

Mode 4 renders the CMF pipeline as discrete block geometry instead of smooth blending. Each block is sized to `exp2(floor(mipLevel) + 2.0)`, producing 4, 8, 16, 32, or 64px blocks as eccentricity increases. The grid is fovea-relative: blocks recompute around the current gaze point.

Color averaging happens per-channel in Oklab space: four cardinal neighbors are sampled per block, converted to Oklab, and blended with channel-independent weights. RG boundaries merge between blocks while YV boundaries stay sharper. These are the same castleCSF pooling rates as Mode 0, visible as discrete color transitions.

The simulation pipeline is hard to explain in words, and Minecraft mode shows it directly. Block sizes *are* the MIP levels, and color averaging *is* the chromatic pooling.

## Minecraft Eyeball (Polar Pooling)

Mode 8 extends Minecraft into polar coordinates. Wedge-shaped sectors radiate from the gaze point, with ring spacing driven by CMF logarithmic scaling. Sectors are radially elongated ~2:1, approximating the geometry predicted by Rosenholtz's Texture Tiling Model pooling regions. *(Correction 2026-10-01: a spoke-count bug cancelled the elongation in this release, giving ~1:1 sectors. The bug was found in Wave 3 validation and fixed in v2.1.0.)* Same Oklab chromatic decay as Minecraft.

The polar geometry is strongest on `color-spectrum.html` where the continuous color gradient makes chromatic decay immediately visible across sector boundaries.

## Blueprint Mode (ARIA Wireframe)

Mode 3 renders live web pages as typed wireframes. ARIA role IDs (0–12) are stored in the structure map's alpha channel, and the shader maps each role to a distinct color: buttons (green), inputs (amber), headings (cyan), navigation (magenta), etc. Fovea shows original content; periphery transitions to full wireframe with role-colored bounding boxes on a dark blue blueprint background.

Uses the existing DOM structure extractor and requires no vision model. Works on any page with semantic HTML or ARIA roles.

## Density-Gated Crowding

The V1 distortion stage now reads local element density from the structure map and modulates crowding strength via a sigmoid gate:

```
crowdingFactor = mix(0.3, 1.0, sigmoid(steepness × (density - threshold)))
```

- **Threshold:** 0.6 (calibrated against structure map density values from `crowding.html`)
- **Steepness:** 20.0
- **Floor:** 0.3× (isolated elements still get residual acuity loss)

This closes the density-independent crowding gap documented in v1.9.0's simulation limitations. Dense text clusters and UI grids get full V1 distortion; isolated elements on whitespace are largely spared. Enabled on modes 0, 1, and 9.

## Chromatic Decay Recalibration

RG and YV decay constants updated from castleCSF parameters (Ashraf et al. 2024) to a fit of Bowers et al. (2025) contrast sensitivity at 15° (RG 29%, YV 79% of the 5° value). Both sources are detection thresholds. *(Note 2026-10-01: this recalibration first shipped in v1.9.0, release commit 18f5781.)*

| Channel | Old (castleCSF) | New (Bowers fit) | Source |
|---------|-----------------|---------------------|--------|
| RG decay | 0.059 | 0.072 | Bowers et al. 2025 |
| YV decay | 0.004 | 0.014 | Bowers et al. 2025 |

The shader's separate suprathreshold exponent (0.5; Jiang, Shooner & Mullen 2022) converts these threshold-based values toward color appearance. The RG/YV ratio narrows from 14.75:1 to 5.14:1, meaning blue-yellow now fades more noticeably than before while red-green remains the dominant loss.

## Eccentricity Scaling

New `u_ecc_scaling` uniform (default 0.75) modulates the pooling growth rate in `computeMipLevel()`. Normalized so 0.75 = no change from baseline. Applied to all CMF-enabled modes (0, 1, 4, 6, 8). DoG band cutoffs scale inversely to maintain consistent frequency separation.

Based on Brown et al. 2023 eccentricity-dependent pooling measurements.

## Arxiv Paper Sync

`docs/arxiv-paper/scrutinizer-system-paper.tex` updated to reflect shipped state:
- Density-gated crowding described with formula (was listed as future work)
- Chromatic decay recalibration cited
- Eccentricity scaling added
- Status section updated to v1.9.1 (now v2.0.0)
- New **Open Questions** section: 5 known gaps in the simulation

---

## Mode Registry

v2.0.0 ships 10 modes across 3 categories:

| ID | Mode | Category |
|----|------|----------|
| 0 | High-Key Ghosting | Research |
| 1 | Biological (Purkinje) | Research |
| 2 | Frosted Glass | Research |
| 3 | Blueprint (ARIA Wireframe) | Presentation |
| 4 | Minecraft (Block Pooling) | Presentation |
| 5 | Drunken Reading | Presentation |
| 6 | Log-Polar MIP | Research |
| 7 | Legacy v1.6 | Research |
| 8 | Minecraft Eyeball (Polar) | Presentation |
| 9 | Congestion-Gated Pooling | Experimental |
