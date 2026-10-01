# Comfort Zone: Fovea + Microsaccade Envelope

> Research compiled 2026-03-24

## The concept

The anatomical fovea is ~1° radius. Fixational eye movements (microsaccades, drift) constantly shift the high-acuity region within a fixation. This note's working hypothesis is that they extend the region that feels clear to ~2-3°; no study measures this directly (see Scientific basis). This "comfort zone" is where content feels clear without conscious effort.

## Key numbers

| Movement / Region | Eccentricity | Source |
|-------------------|-------------|--------|
| Fovea (anatomy) | 0–1° | — |
| Microsaccade median | 0.3–0.5° | Rolfs 2009 |
| Microsaccade upper range | ~1° | Convention (continuum with small saccades) |
| **Fovea + microsaccade envelope** | **0–2°** | Synthesis |
| Visual span (letter recognition >80%) | ~1.7° each side | Legge et al. 2007 |
| Perceptual span (reading, rightward) | ~5° (14-15 chars) | McConkie & Rayner 1975; Rayner 1998 (review) |
| Parafovea boundary | ~5° | Anatomy |
| Forward reading saccade | ~2° (7-9 chars) | Rayner 1998 |
| UFOV (divided attention) | 10-15° (shrinks with load) | Ball et al. 1988 |

## Three zones for the simulator

| Zone | Radius | Use case | Degradation |
|------|--------|----------|-------------|
| **Fovea** | 1° (default 45px) | Biological accuracy | None |
| **Comfort** | 2-3° (~90-135px) | Design review, collaborative assessment | None or very mild |
| **Periphery** | 3°+ | Full simulation | Progressive degradation |

## Implementation (v2.7.0)

Comfort Mode is a checkbox toggle in **Simulation > Behavior**, right after Visual Memory.

**Approach: shader distance offset.** A new uniform `u_comfort_radius` subtracts a dead zone from the pixel-to-gaze distance before it enters the LGN/V1/V4 pipeline. Pixels within the comfort radius see `dist=0` (eccentricity zero, no degradation). Beyond it, normal eccentricity-based calculations resume.

```glsl
dist = max(0.0, dist - u_comfort_radius);
dist_stable = max(0.0, dist_stable - u_comfort_radius);
```

This preserves `fovealRadius` as the pixels-per-degree converter (used by CMF, DoG bands, Bouma crowding, reading span). The dead zone removes degradation by distance alone. It stands in for the small region that microsaccades and drift sample during a fixation. It does not model the eye movements themselves.

**Visual indicator:** A subtle dashed SVG ring (#66ddaa, opacity 0.3) at the original 1° fovea boundary, visible when Comfort Mode is on. It marks the anatomical fovea inside the enlarged clear zone.

**Comfort radius = fovealRadius / canvas.height** (normalized screen units = +1° dead zone at default calibration).

## Scientific basis

No single paper defines "comfort zone" by name. The concept is a synthesis of:

- **Perceptual span** (Rayner 1998): region from which useful info extracted per fixation
- **Visual span** (Legge et al. 2007): sensory bottleneck for letter recognition
- **Microsaccade-maintained visibility** (Martinez-Conde et al. 2006): fixational movements counteract fading
- **Functional visual field** (Sanders 1970; Wu & Wolfe 2022): task-dependent extent of useful vision
- **UFOV** (Ball et al. 1988; Ball & Owsley 1993): info processed without eye/head movements

The working hypothesis is that microsaccades at 1-2/second with median amplitude 0.3-0.5° "sweep" the high-acuity zone across a 2° region, and that this refresh may extend perceived clarity beyond the anatomical fovea. It has not been tested directly.

## Connection to scanpath replay

When replaying published scanpath data, the comfort zone determines:
- How much clear content is visible per fixation (affects task performance predictions)
- Where degradation onset should be for realistic peripheral rendering
- Whether microsaccade jitter during fixation affects the simulation (it should, because it keeps the comfort zone refreshed)

## References

- Martinez-Conde, Macknik & Hubel (2004). The role of fixational eye movements in visual perception. *Nature Reviews Neuroscience*.
- Rolfs (2009). Microsaccades: Small steps on a long way. *Vision Research*.
- Martinez-Conde, Macknik, Troncoso & Hubel (2006). Microsaccades counteract visual fading. *Neuron*.
- McConkie & Rayner (1975). The span of the effective stimulus during a fixation in reading. *Perception & Psychophysics*, 17, 578–586.
- Rayner (1998). Eye movements in reading and information processing. *Psychological Bulletin*.
- Legge, Cheung, Yu, Chung, Lee & Owens (2007). The case for the visual span as a sensory bottleneck in reading. *JOV*.
- Ball, Beard, Roenker, Miller & Griggs (1988). Age and visual search: Expanding the useful field of view. *Journal of the Optical Society of America A*, 5(12), 2210. doi:10.1364/JOSAA.5.002210
- Ball & Owsley (1993). The useful field of view test: A new technique for evaluating age-related declines in visual function. *Journal of the American Optometric Association*, 64(1), 71–79.
- Sanders (1970). Some aspects of the selective process in the functional visual field. *Ergonomics*.
- Wu & Wolfe (2022). The functional visual field(s) in simple visual search. *Vision Research*, 190, 107965.
- Levi, Klein & Aitsebaomo (1985). Vernier acuity, crowding and cortical magnification. *Vision Research*.
