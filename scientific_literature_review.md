# Scientific Literature Review & Implementation Details

## Implementation Notes: The Biological Model

The simulation is powered by a custom **WebGL Fragment Shader** that processes the browser viewport in real-time (60fps). The pipeline implements four distinct biological constraints to model the limitations of the human visual system.

For a deeper look at the foveal / parafoveal / peripheral model and shader parameters, see [`docs/foveated-vision-model.md`](docs/foveated-vision-model.md).

### 1. Rod-Weighted Luminance (Scotopic Vision)
In the periphery, cone cells (color) are scarce, and rod cells (luminance) dominate. Rods have a peak sensitivity at **505nm (Cyan/Blue-Green)** and are blind to red light.

- **Algorithm**: We calculate a "Rod Tint" vector based on the pixel's luminance.
- **Effect**: As eccentricity increases, colors desaturate towards a cyan-grey. Red objects lose contrast and vanish, while blue/green objects appear brighter ("Purkinje shift").

### 2. Box Sampling (Retinal Ganglion Density)
The density of Retinal Ganglion Cells (RGCs) drops exponentially from the fovea. This results in a loss of sampling resolution.

- **Algorithm**: We use a variable-size pixelation filter. The "block size" scales with distance from the fovea.
- **Effect**: Fine details in the periphery are averaged into larger blocks, destroying high-frequency information (like text) while preserving low-frequency structures (layout).

### 3. Domain Warping (Positional Uncertainty)
Peripheral vision suffers from "crowding"—the inability to isolate features. The brain receives a statistical summary of the texture rather than precise coordinates.

- **Algorithm**: We apply multi-octave **Simplex Noise** to the UV coordinates of the texture lookup.
- **Effect**:
    - **Fine Noise**: Jitters small details (text looks like "ants").
    - **Coarse Noise**: Warps large shapes (layout feels unstable).

### 4. Radial Chromatic Aberration (The "Lens Split")
The Magno-cellular pathway (motion/luminance) processes information faster than the Parvo-cellular pathway (color), leading to temporal and spatial asynchrony.

- **Algorithm**: We split the color channels based on a radial vector from the fovea:
    - **Red Channel**: Pulled *inward* (towards fovea).
    - **Blue Channel**: Pushed *outward* (away from fovea).
    - **Green Channel**: Anchored.
- **Effect**: High-contrast edges in the periphery develop color fringes (Red/Cyan), creating a "vibrating" or "3D" effect that simulates the difficulty of locking focus on peripheral objects.

---

## Related Work & Theoretical Foundation

### Vision Science & Cognitive Psychology
- **Ruth Rosenholtz (MIT)**: Mongrel Theory and peripheral summary statistics
- **Anil Seth**: "Controlled hallucination" model of perception
- **Peter Pirolli (Xerox PARC)**: Information Foraging Theory - "information scent"
- **Cohen et al. (2020, PNAS)**: "Refrigerator Light" illusion

### UX & Design Practice
- **Jeff Johnson**: *Designing with the Mind in Mind*
- **Susan Weinschenk**: *100 Things Every Designer Needs to Know About People*
- **Nielsen Norman Group**: The "heatmap lie"

**For detailed theoretical discussion**, see [`docs/beta_gemini3_discussion.md`](docs/beta_gemini3_discussion.md)
