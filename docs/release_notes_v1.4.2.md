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
