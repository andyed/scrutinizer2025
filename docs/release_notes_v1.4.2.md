# Release Notes v1.4.2

## Saccadic Suppression ("Pupil Dilation" Model)

We have implemented a new biological simulation layer that mimics the eye's natural response to movement.

### The "Hunt vs. Gather" Cycle
The interface now "breathes" based on your activity:

*   **The Hunt (Movement)**: When you move the mouse fast, the simulated pupil dilates, creating a shallow depth-of-field effect. The periphery blurs out (Tunnel Vision), masking distractions while you search.
*   **The Gather (Fixation)**: When you stop, the pupil constricts. The periphery sharpens significantly, rewarding you with clarity for paying attention.

### Technical Changes
*   **Renderer**: Added velocity tracking and pupil state simulation (dilation/constriction).
*   **Shader**: Coupled the "Blur Radius" uniform to the MIP pooling logic, allowing dynamic scaling of peripheral acuity.

## Phase 5: Gated Semantic Saliency (Cognitive Alignment)
We have upgraded the Saliency System from a purely **Bottom-Up** (retinal) model to a **Top-Down** (cognitive) model.

### The "Cognitive Map"
The brain doesn't just see pixels; it sees objects. We now simulate this by using the **Structure Map** to "gate" the visual attention system:
*   **Inhibition (Silence the Noise)**: Empty areas (paper textures, compression artifacts, faint gradients) are now actively suppressed. If the semantic engine doesn't see an object, the visual system ignores the pixels.
*   **Excitation (Boost the Signal)**: Interactive elements (UI controls, buttons, inputs) receive a saliency boost, ensuring they remain visible ("pop") even if they have low visual contrast (e.g., "ghost" buttons).
*   **Temporal Sync**: The saliency heat-map is now perfectly synchronized with the content during scroll, eliminating the "laggy ghost" artifacts seen in v1.4.0.

### Benefit
*   **Cleaner Periphery**: No more flickering heat-maps on blank pages.
*   **Solid Scrolling**: The distortion field locks to the content.
*   **Resilient UI**: Critical controls remain visible in the periphery.


## New Feature: Reference Pages
A new **"Reference Pages"** submenu has been added to the **Go** menu.
*   Instantly load standard test fixtures (Dashboard, Article, E-commerce).
*   Perfect for verifying visual effects against known baselines without internet variability.
*   Accessible offline.

## Documentation Overhaul: Biology-First
We have completely restructured the documentation to follow the biological visual pathway.
*   **Retina → LGN → V1 → V4**: The `foveated-vision-model.md` now traces the journey of a photon from the eye to the cortex.
*   **Scientific Literature Review**: Updated to better support the biophysical claims of the simulation.

## Quality of Life
*   **Report Issue Improvements**: The "Report Issue" menu item now automatically includes your current App Version in the issue body, making debugging easier.
*   **Manual Update Check**: Added "Check for Updates..." to the Help menu to force a check if the auto-updater is feeling shy.
