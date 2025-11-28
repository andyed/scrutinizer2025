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



### Ensemble Perception & Saccade Planning
*Why simple blur is insufficient for simulating reading behavior.*

* **Ariely, D. (2001)**: ["Seeing sets: Representation by statistical properties"](https://journals.sagepub.com/doi/10.1111/1467-9280.00327). *Psychological Science*.
    * **The Insight**: The brain processes groups of objects in the periphery as a "set," instantly calculating the **mean size** and density, even when individual objects are unidentified.
    * **Relevance to Scrutinizer**: This validates the **Wireframe Mode**. By rendering text as solid blocks of the *correct line height*, Scrutinizer provides the exact "statistical summary" (Mean Size) that the dorsal stream uses to categorize the region as "Text" vs "Image."

* **Rayner, K. (1998)**: ["Eye movements in reading and information processing: 20 years of research"](https://psycnet.apa.org/record/1998-10886-001). *Psychological Bulletin*.
    * **The Insight**: Saccade planning (deciding where to look next) relies heavily on low-spatial-frequency cues in the parafovea—specifically **word length** and **boundaries**.
    * **Relevance to Scrutinizer**: Standard Gaussian blur destroys word boundaries, making natural scanning impossible. The **Structure Map** approach preserves the "landing zones" for the eye, allowing researchers to validly test "Information Foraging" behavior even when text is unreadable.

* **Rosenholtz, R., et al. (2012)**: ["A summary statistic representation in peripheral vision explains visual search"](https://jov.arvojournals.org/article.aspx?articleid=2193856). *Journal of Vision*.
    * **The Insight**: Peripheral vision represents the world as "Texture Statistics" (Mongrels). We don't just see "blurry" letters; we see a "texture of letters."
    * **Relevance to Scrutinizer**: This motivates the **Simulation Mode**. Instead of blurring, we use the DOM's `font-weight` and `line-height` to drive a **Noise Field**. This ensures the "texture energy" of the periphery matches the reality of the document, preventing the "Pop-out Effect" (where a blurry gray bar looks *more* conspicuous than the original text).

* **Whitney, D., & Yamanashi Leib, A. (2018)**: ["Ensemble Perception"](https://www.annualreviews.org/doi/abs/10.1146/annurev-psych-010416-044232). *Annual Review of Psychology*.
    * **The Insight**: A comprehensive review of how the visual system compresses redundant information (like rows of text) into a "Gist."
    * **Relevance to Scrutinizer**: Supports the use of **Quantization** (blocking). The visual system compresses 10 lines of text into a single "Text Object." Scrutinizer visualizes this compression algorithm in real-time.

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

### Feature Detection in Primary Visual Cortex (V1)

The primary visual cortex (V1) is the first cortical area to receive visual information from the lateral geniculate nucleus (LGN) and serves as the foundation for feature extraction in the visual system.

#### Orientation Selectivity

* **Hubel, D. H., & Wiesel, T. N. (1962)**: [Receptive fields, binocular interaction and functional architecture in the cat's visual cortex](https://doi.org/10.1113/jphysiol.1962.sp006837). *The Journal of Physiology*.
    * **The Discovery**: Nobel-prize winning work demonstrating that V1 neurons respond selectively to oriented edges and bars at specific angles. Some cells respond maximally to vertical edges, others to horizontal, and others to oblique orientations spanning 360°.
    * **Relevance**: This establishes the fundamental building block of visual feature detection—the decomposition of visual scenes into oriented contours. The orientation selectivity is organized into **orientation columns** spanning the cortical surface.

* **Hubel, D. H., & Wiesel, T. N. (1968)**: [Receptive fields and functional architecture of monkey striate cortex](https://doi.org/10.1113/jphysiol.1968.sp008455). *The Journal of Physiology*.
    * **Extension to primates**: Confirmed that the functional architecture discovered in cats extends to primates, including the columnar organization and the distinction between simple and complex cells.

#### Simple vs. Complex Cells

* **Simple Cells**: Exhibit spatially segregated ON and OFF regions in their receptive fields. They respond best to oriented edges or bars at specific positions within the receptive field. The response is linear and can be predicted by summing LGN inputs.

* **Complex Cells**: Respond to oriented stimuli regardless of exact position within the receptive field (position invariance). They sum responses from multiple simple cells with the same orientation preference but different spatial phases. This provides the first level of translation invariance in the visual system.

#### Spatial Frequency Tuning

* **De Valois, R. L., Albrecht, D. G., & Thorell, L. G. (1982)**: [Spatial frequency selectivity of cells in macaque visual cortex](https://doi.org/10.1016/0042-6989(82)90113-4). *Vision Research*.
    * **The Insight**: V1 neurons act as spatial frequency filters, with different cells tuned to different scales of detail. Some respond best to fine textures (high spatial frequencies), others to coarse structures (low spatial frequencies).
    * **Relevance to Scrutinizer**: The box sampling and blur parameters in the peripheral simulation directly relate to the loss of high-frequency tuned neurons in peripheral visual field representations. V1's spatial frequency channels form a multi-scale decomposition analogous to a Fourier or wavelet transform.

* **Campbell, F. W., & Robson, J. G. (1968)**: [Application of Fourier analysis to the visibility of gratings](https://doi.org/10.1113/jphysiol.1968.sp008574). *The Journal of Physiology*.
    * **Psychophysical evidence**: Demonstrated that the human visual system processes spatial patterns via multiple independent channels tuned to different spatial frequencies—providing behavioral evidence for the neural mechanisms later discovered in V1.

#### V1 as a 2D Gabor Filter Bank

* **Marcelja, S. (1980)**: [Mathematical description of the responses of simple cortical cells](https://doi.org/10.1364/JOSA.70.001297). *Journal of the Optical Society of America*.
    * **Mathematical Model**: Showed that simple cell receptive fields can be accurately modeled as 2D Gabor functions—sinusoidal gratings modulated by Gaussian envelopes. This provides optimal localization in both spatial and frequency domains.

* **Daugman, J. G. (1985)**: [Uncertainty relation for resolution in space, spatial frequency, and orientation optimized by two-dimensional visual cortical filters](https://doi.org/10.1364/JOSAA.2.001160). *Journal of the Optical Society of America A*.
    * **The Optimization**: Demonstrated that Gabor functions achieve the theoretical lower bound on joint uncertainty in position and frequency (as defined by the uncertainty principle), suggesting V1 implements an information-theoretically optimal encoding strategy.

### Top-Down Influences in the Lateral Geniculate Nucleus (LGN)

While traditionally viewed as a relay station, the LGN is now understood to be heavily modulated by feedback from cortex, implementing attentional filtering and predictive processing mechanisms.

#### Anatomical Basis of Feedback

* **Sherman, S. M., & Guillery, R. W. (2002)**: [The role of the thalamus in the flow of information to the cortex](https://doi.org/10.1098/rstb.2002.1161). *Philosophical Transactions of the Royal Society B*.
    * **The Architecture**: Only ~10-20% of synaptic inputs to LGN neurons come from the retina. The majority (~30-40%) come from **feedback projections from V1**, with additional inputs from brainstem and other thalamic nuclei.
    * **Implication**: The LGN is not a passive relay but an active gating mechanism where cortical expectations can modulate which retinal signals reach awareness.

* **Sherman, S. M., & Guillery, R. W. (1998)**: [On the actions that one nerve cell can have on another: distinguishing "drivers" from "modulators"](https://doi.org/10.1073/pnas.95.12.7121). *PNAS*.
    * **Driver vs. Modulator**: Introduced the critical distinction between "driver" inputs (which define what a neuron responds to—from retina) and "modulator" inputs (which control the gain or sensitivity—from cortex). Corticothalamic feedback acts primarily as a modulator.

#### Attentional Modulation

* **McAlonan, K., Cavanaugh, J., & Wurtz, R. H. (2008)**: [Guarding the gateway to cortex with attention in visual thalamus](https://doi.org/10.1038/nature07382). *Nature*.
    * **The Discovery**: Demonstrated that spatial attention enhances LGN responses to stimuli at attended locations even before information reaches V1. This occurs through feedback from cortical attention networks.
    * **Mechanism**: Attention increases the gain of LGN neurons whose receptive fields overlap with the attended location, effectively amplifying signals from behaviorally relevant regions while suppressing distractors.

* **O'Connor, D. H., Fukui, M. M., Pinsk, M. A., & Kastner, S. (2002)**: [Attention modulates responses in the human lateral geniculate nucleus](https://doi.org/10.1038/nn957). *Nature Neuroscience*.
    * **Human evidence**: Using fMRI, showed that voluntary spatial attention increases BOLD responses in human LGN, confirming that attentional modulation of early visual pathways is not limited to animal models.

#### Predictive Coding and Feedback

* **Sillito, A. M., & Jones, H. E. (2002)**: [Corticothalamic interactions in the transfer of visual information](https://doi.org/10.1098/rstb.2001.1083). *Philosophical Transactions of the Royal Society B*.
    * **The Model**: Proposed that V1-to-LGN feedback implements predictive coding—the cortex sends predictions about expected input, and LGN primarily relays the "prediction error" (deviations from expectation) back to cortex.
    * **Evidence**: Pharmacological inactivation of V1 feedback changes LGN receptive field properties, including reduced spatial precision and altered temporal dynamics.

* **Jiang, Y., Purushothaman, G., & Casagrande, V. A. (2015)**: [The functional influence of pulvinar on the middle temporal visual area of the owl monkey](https://doi.org/10.1523/JNEUROSCI.2291-14.2015). *Journal of Neuroscience*.
    * **Higher-order thalamus**: Demonstrated that higher-order thalamic nuclei (like the pulvinar) serve as routing hubs for cortico-cortical communication, supporting the idea that thalamic nuclei implement dynamic gating of information flow based on behavioral state.

#### State-Dependent Gating

* **McCormick, D. A., & Bal, T. (1997)**: [Sleep and arousal: thalamocortical mechanisms](https://doi.org/10.1146/annurev.neuro.20.1.185). *Annual Review of Neuroscience*.
    * **The Insight**: LGN neurons can operate in different modes (tonic firing vs. burst firing) depending on neuromodulatory state. Cortical feedback, combined with inputs from brainstem (e.g., acetylcholine, norepinephrine), controls this gating.
    * **Relevance**: During sleep or inattention, LGN switches to "burst mode," reducing faithful relay of retinal signals. During alert states, feedback maintains "tonic mode" for high-fidelity transmission—demonstrating that even the earliest visual processing stage is state-dependent.

* **Briggs, F., & Usrey, W. M. (2008)**: [Emerging views of corticothalamic function](https://doi.org/10.1016/j.conb.2008.09.009). *Current Opinion in Neurobiology*.
    * **Comprehensive Review**: Synthesizes evidence that corticothalamic feedback regulates LGN gain, temporal precision, and spatial selectivity. Proposes that feedback implements "adaptive filtering" that optimizes the signal-to-noise ratio of visual inputs based on current behavioral demands.


