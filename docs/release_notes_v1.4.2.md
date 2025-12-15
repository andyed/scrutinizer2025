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
