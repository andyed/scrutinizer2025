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



**For detailed theoretical discussion**, see [`docs/beta_gemini3_discussion.md`](docs/beta_gemini3_discussion.md)

---

## Related Work & Theoretical Foundation

### Use of Foveal Simulation for Web Design


- **Lagun, D. & Agichtein, E. (2011)**: ["ViewSer: A Tool for Large-Scale Studies of Web Search Result Examination"](http://www.mathcs.emory.edu/~dlagun/pubs/sigir636-lagun.pdf). *CHI 2011*.
  - See also: [ResearchGate Publication](https://www.researchgate.net/publication/221300903_ViewSer_enabling_large-scale_remote_user_studies_of_web_search_examination_and_interaction)
  - Summary: This study introduced a "restricted focus viewer" (blurring the screen except for a clear window under the mouse) to track user attention on Search Engine Results Pages (SERPs). Crucially, they validated that cursor-contingent viewing strongly correlates with actual eye-tracking data.
- **The Flashlight Project (2010)**: Schulte-Mecklenbeck, M., Murphy, R. O., & Hutzler, F. ["Flashlight: Recording Information Acquisition Online"](http://vlab.ethz.ch/flashlight/index.php). *SSRN*.
  - Available at: [SSRN](http://ssrn.com/abstract=1433225) or [DOI](http://dx.doi.org/10.2139/ssrn.1433225)
  - Summary: A process-tracing tool used in behavioral economics to study decision-making. It completely obscures the screen until the mouse hovers over a region, allowing researchers to record the exact sequence and duration of information acquisition (e.g., checking "Price" before "Rating").

- **Bednarik, R. & Tukiainen, M. (2007)**: ["Validating the Restricted Focus Viewer: A study using eye-movement tracking"](https://www.researchgate.net/publication/6144967_Validating_the_Restricted_Focus_Viewer_A_study_using_eye-movement_tracking). Behavior Research Methods.
  - Summary: A direct validation study comparing a "mouse-contingent" blur tool (Restricted Focus Viewer) against a hardware eye-tracker. They found that while task performance remained similar, the visual strategies differed—specifically, the artificial blur caused expert users to alter their natural scanning patterns.

- **Blackwell, A. F., Jansen, A. R., & Marriott, K. (2003)**: ["A tool for tracking visual attention: The Restricted Focus Viewer"](https://www.researchgate.net/publication/10779779_A_tool_for_tracking_visual_attention_The_Restricted_Focus_Viewer). Behavior Research Methods.
  - Summary: The seminal paper introducing the Restricted Focus Viewer (RFV). The authors developed a software tool that blurs the screen except for a mouse-driven window to study how people reason with diagrams. They demonstrated that for high-level cognitive tasks, mouse movements in the RFV provide a reliable proxy for visual attention.


### Vision Science & Cognitive Psychology

* **Ruth Rosenholtz (MIT):** [Mongrel Theory and peripheral summary statistics](https://dspace.mit.edu/handle/1721.1/6763)
    * *See also:* [The Visual System as a Statistician (PDF)](https://jov.arvojournals.org/article.aspx?articleid=2193856)
* **Anil Seth:** [The "Controlled Hallucination" model of perception (TED Talk)](https://www.ted.com/talks/anil_seth_your_brain_hallucinates_your_conscious_reality)
* **Peter Pirolli (Xerox PARC):** [Information Foraging Theory (Pirolli & Card, 1999)](https://review.ucsc.edu/fall09/images/Pirolli_Card_1999.pdf)
    * *Concept:* "Information Scent"
* **Cohen et al. (2020, PNAS):** ["The Refrigerator Light" illusion / The Bandwidth of Perceptual Experience](https://www.pnas.org/doi/10.1073/pnas.1915758117)

### UX & Design Practice

* **Jeff Johnson:** [*Designing with the Mind in Mind* (Elsevier)](https://www.sciencedirect.com/book/9780124079144/designing-with-the-mind-in-mind)
* **Susan Weinschenk:** [*100 Things Every Designer Needs to Know About People*](https://theteamw.com/books/100-things-every-designer-needs-to-know-about-people/)
* **Nielsen Norman Group:** [The "Heatmap Lie" / Eye Tracking Limitations](https://www.nngroup.com/articles/eye-tracking-setup/)
    * *Note:* References the gap between where we look (foveal) and what we process (peripheral).



