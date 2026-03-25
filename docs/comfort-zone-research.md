# Comfort Zone: Fovea + Microsaccade Envelope

> Research compiled 2026-03-24

## The concept

The anatomical fovea is ~1° radius. But nobody perceives a 1° clear zone — fixational eye movements (microsaccades, drift) constantly shift the high-acuity region, creating a subjective experience of clarity extending to ~2-3°. This "comfort zone" is where content feels clear without conscious effort.

## Key numbers

| Movement / Region | Eccentricity | Source |
|-------------------|-------------|--------|
| Fovea (anatomy) | 0–1° | — |
| Microsaccade median | 0.3–0.5° | Rolfs 2009 |
| Microsaccade upper range | ~1° | Convention (continuum with small saccades) |
| **Fovea + microsaccade envelope** | **0–2°** | Synthesis |
| Visual span (letter recognition >80%) | ~1.7° each side | Legge et al. 2007 |
| Perceptual span (reading, rightward) | ~5° (14-15 chars) | Rayner 1998 |
| Parafovea boundary | ~5° | Anatomy |
| Forward reading saccade | ~2° (7-9 chars) | Rayner 1998 |
| UFOV (divided attention) | 10-15° (shrinks with load) | Ball et al. 1988 |

## Three zones for the simulator

| Zone | Radius | Use case | Degradation |
|------|--------|----------|-------------|
| **Fovea** | 1° (default 45px) | Biological accuracy | None |
| **Comfort** | 2-3° (~90-135px) | Design review, collaborative assessment | None or very mild |
| **Periphery** | 3°+ | Full simulation | Progressive degradation |

## Implementation (v2.7.1)

Comfort Mode is a checkbox toggle in **Simulation > Behavior**, right after Visual Memory.

**Approach: shader distance offset.** A new uniform `u_comfort_radius` subtracts a dead zone from the pixel-to-gaze distance before it enters the LGN/V1/V4 pipeline. Pixels within the comfort radius see `dist=0` (eccentricity zero, no degradation). Beyond it, normal eccentricity-based calculations resume.

```glsl
dist = max(0.0, dist - u_comfort_radius);
dist_stable = max(0.0, dist_stable - u_comfort_radius);
```

This preserves `fovealRadius` as the pixels-per-degree converter (used by CMF, DoG bands, Bouma crowding, reading span). The dead zone is purely spatial suppression — which is what microsaccades provide biologically.

**Visual indicator:** A subtle dashed SVG ring (#66ddaa, opacity 0.3) at the original 1° fovea boundary, visible when Comfort Mode is on. Marks the microsaccade sweet spot within the enlarged clear zone.

**Comfort radius = fovealRadius / canvas.height** (normalized screen units = +1° dead zone at default calibration).

## Scientific basis

No single paper defines "comfort zone" by name. The concept synthesizes:

- **Perceptual span** (Rayner 1998) — region from which useful info extracted per fixation
- **Visual span** (Legge et al. 2007) — sensory bottleneck for letter recognition
- **Microsaccade-maintained visibility** (Martinez-Conde et al. 2006) — fixational movements counteract fading
- **Functional visual field** (Sanders 1970, Wu & Wolfe) — task-dependent extent of useful vision
- **UFOV** (Ball & Owsley 1993) — info processed without eye/head movements

The key insight: microsaccades at 1-2/second with median amplitude 0.3-0.5° effectively "sweep" the high-acuity zone across a 2° region. This microsaccade-mediated refresh creates perceived clarity beyond the anatomical fovea.

## Connection to scanpath replay

When replaying published scanpath data, the comfort zone determines:
- How much clear content is visible per fixation (affects task performance predictions)
- Where degradation onset should be for realistic peripheral rendering
- Whether microsaccade jitter during fixation affects the simulation (it should — it keeps the comfort zone refreshed)

## References

- Martinez-Conde, Macknik & Hubel (2004). The role of fixational eye movements in visual perception. *Nature Reviews Neuroscience*.
- Rolfs (2009). Microsaccades: Small steps on a long way. *Vision Research*.
- Martinez-Conde, Macknik, Troncoso & Hubel (2006). Microsaccades counteract visual fading. *Neuron*.
- Rayner (1998). Eye movements in reading and information processing. *Psychological Bulletin*.
- Legge, Cheung, Yu, Chung, Lee & Owens (2007). The case for the visual span as a sensory bottleneck in reading. *JOV*.
- Ball, Beard, Roenker, Miller & Griggs (1988). Age and visual search. *J Gerontology*.
- Sanders (1970). Some aspects of the selective process in the functional visual field. *Ergonomics*.
- Levi, Klein & Aitsebaomo (1985). Vernier acuity, crowding and cortical magnification. *Vision Research*.
