# Scientific Literature Review & Implementation Details

## Overview

This document describes the biological and cognitive science behind Scrutinizer's technical implementation. Scrutinizer is a biologically plausible simulation of the human foveated visual system, designed to reveal how peripheral vision influences attention, reading, and information foraging.

The document follows the visual pathway from **photoreceptors → retina → LGN → V1 → V4 → perception**, the order in which information flows through the brain.

## Table of Contents

1.  [The Visual Pathway: A Biological Foundation](#1-the-visual-pathway-a-biological-foundation)
    *   [Stage 1: Retina (Photoreceptors & Ganglion Cells)](#stage-1-retina-photoreceptors--ganglion-cells)
    *   [Stage 2: LGN (Gating & Parallel Streams)](#stage-2-lgn-gating--parallel-streams)
    *   [Stage 3: V1 (Feature Extraction & Crowding)](#stage-3-v1-feature-extraction--crowding)
    *   [Stage 4: V4 and Beyond (Color, Shape, Recognition)](#stage-4-v4-and-beyond-color-shape-recognition)
2.  [Scrutinizer's Implementation](#2-scrutinizers-implementation)
    *   [Peripheral Color (Chromatic Pooling)](#peripheral-color-chromatic-pooling)
    *   [Box Sampling (Retinal Ganglion Density)](#box-sampling-retinal-ganglion-density)
    *   [Domain Warping (Positional Uncertainty)](#domain-warping-positional-uncertainty)
    *   [Chromatic Aberration (Lens Effect)](#chromatic-aberration-lens-effect)
3.  [Research Validation](#3-research-validation)
    *   [Gaze-Contingent Research Protocols](#gaze-contingent-research-protocols)
    *   [Ensemble Perception & Saccade Planning](#ensemble-perception--saccade-planning)
4.  [Key References by Topic](#4-key-references-by-topic)

---

## 1. The Visual Pathway: A Biological Foundation

Understanding *why* foveal and peripheral vision differ requires tracing the path from light hitting the retina to conscious perception. Each stage introduces constraints that Scrutinizer models.

### Stage 1: Retina (Photoreceptors & Ganglion Cells)

The retina is a neural network that preprocesses visual information before sending it to the brain.

#### Photoreceptor Distribution

* **Curcio, C. A., et al. (1990)**: ["Human photoreceptor topography"](https://doi.org/10.1002/cne.902920402). *Journal of Comparative Neurology*.
    * **The Data**: Mapped the precise distribution of rods and cones across the human retina. Cones peak at ~200,000/mm² in the foveal center and drop to ~5,000/mm² at 20° eccentricity. Rods are absent from the fovea but peak at ~160,000/mm² at 20°.
    * **Relevance**: This distribution is the fundamental reason for foveal/peripheral differences. Scrutinizer's DoG band attenuation simulates the loss of fine spatial detail with eccentricity, which at display (photopic) light levels is set by cone and midget ganglion cell sampling. Rods contribute little at these light levels.

#### Ganglion Cell Wiring

* **Dacey, D. M. (1993)**: ["The mosaic of midget ganglion cells in the human retina"](https://doi.org/10.1523/JNEUROSCI.13-12-05334.1993). *Journal of Neuroscience*.
    * **The Data**: Mapped midget ganglion cell dendritic-field size across the human retina. Near the fovea each midget ganglion cell receives input from a single cone via one midget bipolar cell, the private-line pathway described anatomically by Polyak (1941). Dendritic fields grow with eccentricity, so each peripheral midget cell pools many cones.
    * **Relevance**: This convergence is why peripheral vision cannot resolve fine detail: the information is physically averaged before leaving the eye. Scrutinizer's DoG band attenuation (Box Sampling, Section 2) simulates the resulting loss of detail.

#### Center-Surround Processing

* **Kuffler, S. W. (1953)**: ["Discharge patterns and functional organization of mammalian retina"](https://doi.org/10.1152/jn.1953.16.1.37). *Journal of Neurophysiology*.
    * **The Discovery**: Retinal ganglion cells have "center-surround" receptive fields, so they respond to local contrast. This is the first stage of edge detection.
    * **Relevance**: Scrutinizer's saliency map uses center-surround (Difference-of-Gaussians) to detect edges and contrast, mimicking this retinal preprocessing.

### Stage 2: LGN (Gating & Parallel Streams)

The Lateral Geniculate Nucleus relays retinal signals to cortex and gates them: attention and expectation modulate what passes through.

#### Anatomical Architecture

* **Sherman, S. M., & Guillery, R. W. (2002)**: ["The role of the thalamus in the flow of information to the cortex"](https://doi.org/10.1098/rstb.2002.1161). *Philosophical Transactions of the Royal Society B*.
    * **The Architecture**: Only ~5-10% of synaptic inputs to LGN relay cells come from the retina. About 30% come from **feedback projections from V1** (layer 6), and most of the rest from local inhibitory neurons (interneurons and the thalamic reticular nucleus) and the brainstem.
    * **Relevance**: Because most of its input is modulatory, the LGN gates the retinal signal on its way to cortex. Scrutinizer's LGN stage simulates this gating as structure masking and saliency modulation.

#### Magnocellular vs Parvocellular Streams

* **Livingstone, M., & Hubel, D. (1988)**: ["Segregation of form, color, movement, and depth: anatomy, physiology, and perception"](https://doi.org/10.1126/science.3283936). *Science*.
    * **Finding**: Visual information splits into parallel streams at the LGN:
        * **Magnocellular (M)**: Fast, motion-sensitive, luminance-only, large receptive fields
        * **Parvocellular (P)**: Slower, color-sensitive, fine detail, small receptive fields
    * **Relevance**: Scrutinizer's V4 stage partially restores peripheral luminance contrast (its "magnocellular" contrast-preservation step), on the reasoning that the M-pathway's preserved contrast in the periphery is why motion detection works even when you can't identify objects. Scrutinizer's chromatic aberration is a separate lens effect and does not model M/P timing.

#### Attentional Modulation

* **McAlonan, K., Cavanaugh, J., & Wurtz, R. H. (2008)**: ["Guarding the gateway to cortex with attention in visual thalamus"](https://doi.org/10.1038/nature07382). *Nature*.
    * **The Discovery**: Spatial attention enhances LGN responses to stimuli at attended locations even before information reaches V1.
    * **Relevance**: Scrutinizer's saliency gating borrows the idea of selective gain in the LGN. McAlonan et al. studied spatial attention directed to a cued location. They did not test bottom-up salience, so the link is an analogy.

### Stage 3: V1 (Feature Extraction & Crowding)

The primary visual cortex (V1) is where the brain first constructs a representation of visual features: edges, orientations, spatial frequencies.

#### Orientation Selectivity

* **Hubel, D. H., & Wiesel, T. N. (1962)**: ["Receptive fields, binocular interaction and functional architecture in the cat's visual cortex"](https://doi.org/10.1113/jphysiol.1962.sp006837). *The Journal of Physiology*.
    * **The Discovery**: Nobel-prize winning work demonstrating that V1 neurons respond selectively to oriented edges and bars at specific angles.
    * **Relevance**: This establishes the fundamental building block of visual feature detection. Scrutinizer's Blueprint mode draws Sobel edge maps; these are gradient magnitudes with no orientation tuning, so they are an image-processing analogue of V1 edge responses at most.

#### Spatial Frequency Channels

* **Campbell, F. W., & Robson, J. G. (1968)**: ["Application of Fourier analysis to the visibility of gratings"](https://doi.org/10.1113/jphysiol.1968.sp008574). *The Journal of Physiology*.
    * **Finding**: The human visual system processes spatial patterns via multiple independent channels tuned to different spatial frequencies.
    * **Relevance**: Scrutinizer's DoG band decomposition (12 half-octave bands) removes high spatial frequencies in the periphery while preserving low frequencies, consistent with the coarser spatial-frequency tuning of peripheral vision.

#### Crowding: The Peripheral Bottleneck

* **Pelli, D. G. (2008)**: ["Crowding: a cortical constraint on object recognition"](https://doi.org/10.1016/j.conb.2008.09.008). *Current Opinion in Neurobiology*.
    * **Finding**: Crowding (the inability to identify objects in clutter) is a fundamental limit of peripheral vision that occurs in V1. It reflects a failure of feature binding, a separate limit from the acuity loss that blur models.
    * **Relevance**: Scrutinizer's domain warping and "lateral smash" simulate crowding by displacing features into each other, creating "mongrel" textures where individual letters cannot be identified even though their features are present.

* **Rosenholtz, R., et al. (2012)**: ["A summary statistic representation in peripheral vision explains visual search"](https://jov.arvojournals.org/article.aspx?articleid=2193856). *Journal of Vision*.
    * **Finding**: Peripheral vision represents the world as "texture statistics" (Mongrels). A peripheral word is seen as a "texture of letters."
    * **Relevance**: This is the theoretical foundation for Scrutinizer's approach. The default modes approximate its consequences (letter identity lost, layout and texture density kept) with DoG pooling and displacement gated by DOM-derived density and line rhythm. Those are layout features. The default modes compute no TTM summary statistics, while modes 10 and 14 synthesize textures that match per-tile summary statistics (WebGPU).

#### Neural Approximation of Peripheral Statistics

The Texture Tiling Model (TTM) predicts peripheral encoding and crowding, but its iterative synthesis process is computationally prohibitive for real-time applications, taking hours to generate a single "mongrel" image (Fridman et al., 2017). Work at MIT used deep learning to approximate these statistical constraints in a single feed-forward pass, cutting synthesis from hours to under a second.

##### SideEye and Foveated Generative Networks (FGN)

Fridman et al. (2017) introduced the **Foveated Generative Network (FGN)**, a fully convolutional architecture designed to learn the non-linear mapping between a foveal input and its peripheral representation (["SideEye: A generative neural network based simulator of human peripheral vision"](https://arxiv.org/abs/1706.04568), arXiv:1706.04568).

* **Architecture:** The model extends fully convolutional networks (FCN) with a spatial weight mask that propagates foveal distance constraints through the network biases.
* **Performance:** FGN achieves a **21,000-fold reduction** in processing time compared to TTM (from ~4.2 hours to ~0.7 seconds per image), fast enough for interactive design iteration.
* **Validation:** While pixel-wise comparison is impossible due to the stochastic nature of mongrels, FGN was statistically validated by comparing texture feature vectors in pooling regions, achieving a mean error of less than 8% relative to TTM outputs.
* **Application:** The authors demonstrated the utility of this speedup for **A/B testing** web layouts (comparing how visible a call-to-action button is in the periphery under two designs) and analyzing **logo recognizability** (e.g., assessing how brand identity degrades in the periphery).

##### GAN-Based Synthesis and Perceptual Metrics

Building on the FGN approach, Shumikhin (2020; ["Quantitative measures of crowding susceptibility in peripheral vision for large datasets"](https://dspace.mit.edu/handle/1721.1/129227), M.Eng. thesis, MIT) evaluated advanced generative architectures, including Cycle-GAN and **pix2pixHD**, for synthesizing high-resolution mongrels.

* **pix2pixHD:** This architecture was found to produce the highest quality mongrels, capturing the "jumbling" and texture pooling effects of TTM better than standard convolutional networks, particularly for text and fonts.
* **Quantitative Metrics:** Shumikhin went beyond qualitative assessment by using **ResNet-18 feature vectors** (Image2Vec) to measure the perceptual distance between original and mongrelized images. This allowed for the quantification of "crowding susceptibility" using **Cosine Similarity** and **Wasserstein Distance** on high-level semantic features.
* **Design Implications:** This framework was used to rank thousands of fonts by their resilience to crowding, finding that heavy fonts with high styling variation were generally less susceptible to peripheral degradation.

### Stage 4: V4 and Beyond (Color, Shape, Recognition)

Higher visual areas process increasingly abstract features: color constancy, shape, and eventually object recognition.

#### Color Processing

* **Zeki, S. (1980)**: ["The representation of colours in the cerebral cortex"](https://doi.org/10.1038/284412a0). *Nature*.
    * **The Discovery**: V4 contains neurons selective for color, independent of wavelength (color constancy).
    * **Relevance**: Scrutinizer's Oklab-based chromatic pooling in the periphery models the reduced chromatic spatial resolution of the P-pathway, while preserving M-pathway luminance contrast. Note: peripheral color is pooled, with mean chromaticity preserved over large regions. Scrutinizer's V4 shader stage attenuates opponent channels differentially (RG faster than YV) with spatial-frequency dependence. The stage name is a software label. The RG/YV asymmetry originates in retinal wiring (see the note under Peripheral Color Perception).

#### The "Controlled Hallucination"

* **Seth, A. K. (2014)**: ["A predictive processing theory of sensorimotor contingencies"](https://doi.org/10.1080/17588928.2013.877880). *Cognitive Neuroscience*.
    * **The Framework**: Perception is active prediction. The brain constructs a "best guess" of reality, filling in gaps with expectations.
    * **Relevance**: Predictive processing offers one account of why peripheral vision does not look degraded to the viewer: the brain fills in the gaps. Scrutinizer renders a model of the peripheral signal before this "autocorrect."

---

## 2. Scrutinizer's Implementation

The simulation runs in a custom **WebGL Fragment Shader** that processes the browser viewport in real time (60fps). The pipeline simulates four peripheral effects.

For detailed shader parameters, see [`foveated-vision-model.md`](foveated-vision-model.md).

### Peripheral Color (Chromatic Pooling)

Cone density falls steeply with eccentricity, and rods outnumber cones in the periphery (Curcio et al. 1990). Display viewing is photopic, so rods contribute little; peripheral color loss on screen comes from cone-opponent pathways pooling chromatic signals over larger regions.

- **Algorithm**: Per-band attenuation of the Oklab a (red-green) and b (blue-yellow) channels, plus a base desaturation and a slight blue-shifted tint at far eccentricities.
- **Effect**: As eccentricity increases, chromatic spatial resolution decreases: the visual system pools color over larger regions. Red-green opponency attenuates faster than blue-yellow (L-M is a foveal specialization). In scotopic/mesopic conditions, peak sensitivity shifts toward shorter wavelengths as rods take over (the Purkinje shift), so reds darken relative to blues and greens. Large colored regions retain mean chromaticity further into the periphery than small chromatic stimuli.

> **Biological Basis**: Curcio (1990) photoreceptor distribution; Mullen & Kingdom (2002) RG/YV opponency across the visual field; Ashraf et al. (2024) castleCSF.

### Box Sampling (Retinal Ganglion Density)

The density of Retinal Ganglion Cells (RGCs) drops steeply with eccentricity. This results in a loss of sampling resolution.

- **Algorithm**: We decompose the image into 12 half-octave DoG bands built from the GPU MIP chain and attenuate each band beyond an eccentricity cutoff (see [`foveated-vision-model.md`](foveated-vision-model.md) §5.1). Simple MIP pooling, with LOD scaled by eccentricity, is the fallback when DoG is disabled.
- **Effect**: Fine details in the periphery are averaged into larger blocks, destroying high-frequency information (like text) while preserving low-frequency structures (layout).

> **Biological Basis**: Dacey (1993) ganglion cell wiring; receptive field growth with eccentricity.

### Domain Warping (Positional Uncertainty)

Peripheral vision suffers from "crowding," the inability to isolate features. The brain receives a statistical summary of the texture in which feature positions are imprecise.

- **Algorithm**: We apply multi-octave **Simplex Noise** to the UV coordinates of the texture lookup.
- **Effect**:
    - **Fine Noise**: Jitters small details (text looks like "ants").
    - **Coarse Noise**: Warps large shapes (layout feels unstable).
    - **Lateral Smash**: Horizontal bias (2:1): displacement is twice as large horizontally as vertically. Crowding zones are elongated radially (Toet & Levi 1992), so a fixed horizontal bias matches the biology only near the horizontal meridian.

> **Biological Basis**: Pelli (2008) crowding; Rosenholtz (2012) texture statistics.

### Chromatic Aberration (Lens Effect)

Lateral chromatic aberration is an optical property of lenses, including the eye's (Thibos et al. 1990): different wavelengths are imaged at slightly different positions. Scrutinizer uses it as a visual cue for peripheral degradation. It is not a model of a neural process.

- **Algorithm**: The fovea-to-periphery blend boundary is shifted per color channel:
    - **Red Channel**: Boundary slightly farther out (red stays sharp a little longer).
    - **Blue Channel**: Boundary slightly closer in.
    - **Green Channel**: Anchored.
- **Effect**: A color fringe appears along the fovea/periphery transition. The effect runs in modes that use the High-Key or Biological V4 style (`v4_style_id` 0 or 1, which includes the default mode 12) and fades out where the grid scramble takes over.

> **Optical Basis**: Thibos, L. N., Bradley, A., Still, D. L., Zhang, X., & Howarth, P. A. (1990). [Theory and measurement of ocular chromatic aberration](https://doi.org/10.1016/0042-6989(90)90126-6). *Vision Research*.

---

## 3. Research Validation

### Gaze-Contingent Research Protocols

> **Context**: The studies below use "Gaze-Contingent Displays" (GCDs) as a **research protocol**. While they typically use simple Gaussian blur (unlike Scrutinizer's biologically plausible simulation), they validate the underlying method, in which restricting peripheral information forces users to reveal their cognitive focus through overt attention (mouse/eye movements).


- **Lagun, D. & Agichtein, E. (2011)**: ["ViewSer: Enabling Large-Scale Remote User Studies of Web Search Examination and Interaction"](http://www.mathcs.emory.edu/~dlagun/pubs/sigir636-lagun.pdf). *SIGIR 2011*. doi:10.1145/2009916.2009967
  - See also: [ResearchGate Publication](https://www.researchgate.net/publication/221300903_ViewSer_enabling_large-scale_remote_user_studies_of_web_search_examination_and_interaction)
  - Summary: This study introduced a "restricted focus viewer" (blurring the screen except for a clear window under the mouse) to track user attention on Search Engine Results Pages (SERPs). They validated that cursor-contingent viewing correlates strongly with eye-tracking data.
- **The Flashlight Project (2010)**: Schulte-Mecklenbeck, M., Murphy, R. O., & Hutzler, F. ["Flashlight: Recording Information Acquisition Online"](http://vlab.ethz.ch/flashlight/index.php). *SSRN*.
  - Available at: [SSRN](http://ssrn.com/abstract=1433225) or [DOI](http://dx.doi.org/10.2139/ssrn.1433225)
  - Summary: A process-tracing tool used in behavioral economics to study decision-making. It completely obscures the screen until the mouse hovers over a region, allowing researchers to record the exact sequence and duration of information acquisition (e.g., checking "Price" before "Rating").

- **Bednarik, R. & Tukiainen, M. (2007)**: ["Validating the Restricted Focus Viewer: A study using eye-movement tracking"](https://www.researchgate.net/publication/6144967_Validating_the_Restricted_Focus_Viewer_A_study_using_eye-movement_tracking). Behavior Research Methods.
  - Summary: A direct validation study comparing a "mouse-contingent" blur tool (Restricted Focus Viewer) against a hardware eye-tracker. They found that while task performance remained similar, the visual strategies differed: the artificial blur caused expert users to alter their natural scanning patterns.

- **Jansen, A. R., Blackwell, A. F., & Marriott, K. (2003)**: ["A tool for tracking visual attention: The Restricted Focus Viewer"](https://doi.org/10.3758/BF03195497). *Behavior Research Methods, Instruments, & Computers*.
  - Summary: The journal account of the Restricted Focus Viewer (RFV), first presented by Blackwell, Jansen & Marriott (2000, [Diagrams 2000](https://doi.org/10.1007/3-540-44590-0_17)). The authors developed a software tool that blurs the screen except for a mouse-driven window to study how people reason with diagrams. They demonstrated that for high-level cognitive tasks, mouse movements in the RFV provide a reliable proxy for visual attention.

- **Kim, N. W., Bylinskii, Z., et al. (2017)**: ["BubbleView: an interface for crowdsourcing image importance maps and tracking visual attention"](https://bubbleview.namwkim.org/). *ACM Transactions on Computer-Human Interaction (TOCHI)*.
  - See also: [GitHub Repo](https://github.com/namwkim/bubbleview)
  - **Summary**: This study introduced "BubbleView," a methodology where users click to reveal "bubbles" (foveal windows) on blurred images. They found that these discrete clicks serve as a high-fidelity proxy for eye fixations (0.9 correlation), enabling large-scale "eye tracking" via crowdsourcing (Mechanical Turk) without hardware.
  - **Relevance**: Validates Scrutinizer's premise that restricted peripheral viewing forces users to externalize their attentional strategy. It also supports the "blur-to-fovea" user interface pattern as a scientifically grounded research tool.



### Ensemble Perception & Saccade Planning
*Why simple blur is insufficient for simulating reading behavior.*

* **Ariely, D. (2001)**: ["Seeing sets: Representation by statistical properties"](https://journals.sagepub.com/doi/10.1111/1467-9280.00327). *Psychological Science*.
    * **Finding**: Observers extract the **mean size** of a set of objects accurately even when they cannot report which individual items were present.
    * **Relevance to Scrutinizer**: Motivates **Blueprint Mode**, which replaces content with typed bounding boxes and so keeps set-level layout information (block size, spacing) while removing item identity. Recognizing a region as "Text" or "Image" is a ventral-stream (object and category recognition) function.

* **Rayner, K. (1998)**: ["Eye movements in reading and information processing: 20 years of research"](https://psycnet.apa.org/record/1998-10886-001). *Psychological Bulletin*.
    * **Finding**: Saccade planning (deciding where to look next) relies heavily on low-spatial-frequency cues in the parafovea, chiefly **word length** and word **boundaries**.
    * **Relevance to Scrutinizer**: Standard Gaussian blur destroys word boundaries, making natural scanning impossible. The **Structure Map** approach preserves the "landing zones" for the eye, allowing researchers to validly test "Information Foraging" behavior even when text is unreadable.

* **Rosenholtz, R., et al. (2012)**: ["A summary statistic representation in peripheral vision explains visual search"](https://jov.arvojournals.org/article.aspx?articleid=2193856). *Journal of Vision*.
    * **Finding**: Peripheral vision represents the world as "Texture Statistics" (Mongrels). A peripheral word is seen as a "texture of letters."
    * **Relevance to Scrutinizer**: This motivates the **Simulation Mode**, which feeds the DOM's `font-weight` and `line-height` into a **Noise Field**. With these inputs, the "texture energy" of the periphery matches the reality of the document, and the "Pop-out Effect" (where a blurry gray bar looks *more* conspicuous than the original text) is avoided.

* **Whitney, D., & Yamanashi Leib, A. (2018)**: ["Ensemble Perception"](https://www.annualreviews.org/doi/abs/10.1146/annurev-psych-010416-044232). *Annual Review of Psychology*.
    * **Summary**: A review of how the visual system compresses redundant information (like rows of text) into a "Gist."
    * **Relevance to Scrutinizer**: Loosely motivates the scanner's Gestalt grouping, which merges vertically adjacent text nodes into paragraph clusters before the density channel is computed (see [`foveated-vision-model.md`](foveated-vision-model.md), Gestalt Grouping). The merge is a layout heuristic. It does not model ensemble coding.


### Applied Foveated Rendering & Perceptual Graphics
*Applications and research that bring gaze-contingent rendering to consumer hardware.*

* **Eyeware FidelityFX-SDK (Fork)**: [GitHub Repository](https://github.com/eyeware/FidelityFX-SDK)
    * **The Project**: A fork of AMD's FidelityFX SDK that integrates with the **Beam Eye Tracker** to enable foveated rendering with standard webcams.
    * **Technical Implementation**: The project uses **Variable Rate Shading (VRS)**, which lowers the shading rate in peripheral regions, driven by real-time gaze data.
    * **Relevance to Scrutinizer**: Foveated rendering has moved from a theoretical or lab-based technique to a consumer-accessible optimization. The efficiency principle Scrutinizer simulates, allocating resources to the fovea, is used here for performance in gaming and graphics.

* **Noised-Foveation (SIGGRAPH 2022)**: [GitHub Repository](https://github.com/taimoor6864/Noised-Foveation)
    * **The Research**: Tariq, T., Tursun, C., & Didyk, P. (2022). "Noise-based Enhancement for Foveated Rendering". *ACM Transactions on Graphics*. doi:10.1145/3528223.3530101
    * **The Concept**: This research exploits the human visual system's tolerance for peripheral noise. Reducing resolution removes high-frequency content, which reads as blur; they add procedural noise calibrated to restore the appearance of that content, so resolution can be reduced further before the degradation is noticed.
    * **Relevance to Scrutinizer**: Supports modeling the periphery as a noisy texture, as Scrutinizer's **Domain Warping** and **Noise Field** do. The goals are opposite: Tariq et al. calibrate the noise so degradation goes unnoticed, while Scrutinizer makes peripheral degradation visible.

### Remote Gaze Estimation & Calibration
*Real-time measurement of viewing distance and screen size is a prerequisite for accurate foveated rendering.*

* **EasyEyes Remote Calibrator**: [GitHub Repository](https://github.com/EasyEyes/remote-calibrator)
    * **The Tool**: A lightweight, web-based framework for calibrating screen size, viewing distance, and gaze position in remote participants using standard webcams.
    * **Relevance to Scrutinizer**: Needed so that "foveal" regions in a web simulation align with the user's anatomical fovea (approx. 2° visual angle). Without a pixels-to-degrees calibration, the eccentricities in the simulation are approximate.

---

## 4. Key References by Topic

### Retinal Architecture
| Author | Year | Key Contribution |
|--------|------|------------------|
| Curcio et al. | 1990 | Photoreceptor topography mapping |
| Dacey | 1993 | Midget ganglion cell dendritic-field size vs eccentricity |
| Kuffler | 1953 | Center-surround receptive fields |

### LGN & Attention
| Author | Year | Key Contribution |
|--------|------|------------------|
| Sherman & Guillery | 2002 | Thalamic feedback architecture |
| Livingstone & Hubel | 1988 | Magno/Parvo stream segregation |
| McAlonan et al. | 2008 | Attentional modulation in LGN |

### V1 & Feature Detection
| Author | Year | Key Contribution |
|--------|------|------------------|
| Hubel & Wiesel | 1962 | Orientation selectivity (Nobel Prize) |
| Campbell & Robson | 1968 | Spatial frequency channels |
| Marcelja | 1980 | Gabor filter model of simple cells |
| Daugman | 1985 | Optimal uncertainty in V1 encoding |

### Crowding & Peripheral Vision
| Author | Year | Key Contribution |
|--------|------|------------------|
| Bouma | 1970 | Critical spacing law: ~0.4-0.5× eccentricity |
| Pelli | 2008 | Crowding as cortical constraint |
| Pelli & Tillman | 2008 | Uncrowded window; stimulus-specific crowding (orientation, color, complexity) |
| Rosenholtz et al. | 2012 | Texture statistics / Mongrel theory |
| Whitney & Leib | 2018 | Ensemble perception review |
| Pelli, Palomares & Majaj | 2004 | Crowding is unlike ordinary masking |
| Toet & Levi | 1992 | Radial/tangential asymmetry of crowding zones |

### Peripheral Color Perception
| Author | Year | Key Contribution |
|--------|------|------------------|
| Mullen | 1985 | CSF for RG and YV chromatic gratings; RG bandpass, YV lowpass |
| Mullen & Kingdom | 2002 | Differential RG/YV opponency distribution across visual field |
| Abramov, Gordon & Chan | 1991 | Perceptive fields for color: size-dependent color appearance in periphery. Large stimuli achieve fovea-like color to 20°. |
| Hansen, Pracejus & Gegenfurtner | 2009 | Color perception in intermediate periphery (threshold data, not appearance) |
| Ashraf et al. | 2024 | castleCSF: contrast sensitivity function of color, area, spatiotemporal frequency, luminance & eccentricity. Key parameters: RG k_e=0.059, YV k_e=0.004 |
| Bowers, Gegenfurtner & Goettker | 2025 | Chromatic + achromatic CSF to 90° eccentricity. At 15°: RG≈29%, YV≈79% of 5° baseline. RG decay slows in far periphery. |
| Jiang, Shooner & Mullen | 2022 | Suprathreshold chromatic contrast perception in periphery. Power-law compression: appearance decays less steeply than detection threshold. Exponent ~0.5. |
| Gunther & Dalhaus | 2010 | RG color naming declines at ~40°, YV at ~45-50°. RG visual search impaired relative to YV at 45°. |
| Zlatkova et al. | 2021 | Chromatic resolution acuity and spatial summation at 20°. Red-green asymmetry (green harder); postreceptoral origin. |
| Newton & Eskew | 2003 | Chromatic detection and discrimination in periphery |

*Note: The RG/YV asymmetry follows from retinal wiring. L-M (red-green) opponency depends on 1:1 midget ganglion cell wiring exclusive to the fovea. As dendritic fields grow with eccentricity, midget cells receive mixed L+M input and opponency collapses. S-(L+M) (blue-yellow) uses dedicated small bistratified ganglion cells with retina-wide coverage and no center-surround organization, so YV sensitivity tracks close to achromatic. See [`specs/implemented/chromatic_pooling.md`](specs/implemented/chromatic_pooling.md) for Scrutinizer's implementation.*

### Gaze-Contingent Research
| Author | Year | Key Contribution |
|--------|------|------------------|
| Blackwell, Jansen & Marriott | 2000 | Restricted Focus Viewer (introduced) |
| Jansen, Blackwell & Marriott | 2003 | Restricted Focus Viewer (journal article) |
| Bednarik & Tukiainen | 2007 | RFV validation vs eye-tracking |
| Lagun & Agichtein | 2011 | ViewSer for SERP attention |
| Kim et al. | 2017 | BubbleView (Crowdsourced Attention) |

### Cognitive & UX Applications
| Author | Year | Key Contribution |
|--------|------|------------------|
| Pirolli & Card | 1999 | Information Foraging Theory |
| McConkie & Rayner | 1975 | Perceptual span in reading (moving window) |
| Rayner | 1998 | Eye movements in reading (review) |
| Seth | 2014 | Predictive processing / "Controlled Hallucination" |

### UX & Design Practice

* **Jeff Johnson:** [*Designing with the Mind in Mind* (Elsevier)](https://www.sciencedirect.com/book/9780124079144/designing-with-the-mind-in-mind)
* **Susan Weinschenk:** [*100 Things Every Designer Needs to Know About People*](https://theteamw.com/books/100-things-every-designer-needs-to-know-about-people/)

### Community Discussion

* **Reddit /r/askscience (2014):** ["The fovea is so small compared to the size of the visual field, so why does the world not appear to be of terribly low fidelity?"](https://www.reddit.com/r/askscience/comments/1wzp3g/the_fovea_is_so_small_compared_to_the_size_of_the/)
    * Most people are unaware of how limited their peripheral vision is until it is explicitly demonstrated, which is Scrutinizer's core motivation.

---

## Appendix: Extended V1 & LGN References

### Feature Detection in Primary Visual Cortex (V1)

#### Orientation Selectivity

* **Hubel, D. H., & Wiesel, T. N. (1962)**: [Receptive fields, binocular interaction and functional architecture in the cat's visual cortex](https://doi.org/10.1113/jphysiol.1962.sp006837). *The Journal of Physiology*.
    * Nobel-prize winning work demonstrating that V1 neurons respond selectively to oriented edges and bars at specific angles.

* **Hubel, D. H., & Wiesel, T. N. (1968)**: [Receptive fields and functional architecture of monkey striate cortex](https://doi.org/10.1113/jphysiol.1968.sp008455). *The Journal of Physiology*.
    * Confirmed that the functional architecture discovered in cats extends to primates.

#### Simple vs. Complex Cells

* **Simple Cells**: Exhibit spatially segregated ON and OFF regions. Respond to oriented edges at specific positions.
* **Complex Cells**: Position-invariant orientation selectivity. First level of translation invariance.

#### Spatial Frequency Tuning

* **De Valois, R. L., et al. (1982)**: [Spatial frequency selectivity of cells in macaque visual cortex](https://doi.org/10.1016/0042-6989(82)90113-4). *Vision Research*.
    * V1 neurons act as spatial frequency filters tuned to different scales.

#### V1 as a 2D Gabor Filter Bank

* **Marcelja, S. (1980)**: [Mathematical description of the responses of simple cortical cells](https://doi.org/10.1364/JOSA.70.001297). *JOSA*.
* **Daugman, J. G. (1985)**: [Uncertainty relation for resolution in space, spatial frequency, and orientation](https://doi.org/10.1364/JOSAA.2.001160). *JOSA A*.

### Top-Down Influences in the LGN

#### Anatomical Basis of Feedback

* **Sherman, S. M., & Guillery, R. W. (2002)**: [The role of the thalamus in the flow of information to the cortex](https://doi.org/10.1098/rstb.2002.1161). *Philosophical Transactions of the Royal Society B*.
  - **The Architecture:** Only ~5–10% of synaptic inputs to LGN neurons come from the retina (the "drivers"). The remaining ~90% are modulatory inputs that gate signal transmission:
    - **~30% from V1 Feedback:** Contextual modulation and focus.
    - **~30% from Local Inhibition (TRN/Interneurons):** Lateral inhibition and gain control.
    - **~25% from Brainstem:** Arousal and alertness regulation (cholinergic/noradrenergic pathways).
  - **Implication:** Cortical and brainstem inputs modulate how retinal signals pass through the LGN, so the LGN gates incoming sensory data. Scrutinizer's LGN stage simulates this gating as structure masking and saliency modulation.

* **Sherman, S. M., & Guillery, R. W. (1998)**: [On the actions that one nerve cell can have on another: distinguishing "drivers" from "modulators"](https://doi.org/10.1073/pnas.95.12.7121). *PNAS*.
    * **Driver vs. Modulator**: Introduced the distinction between "driver" inputs from the retina, which define what a neuron responds to, and "modulator" inputs from cortex, which control its gain or sensitivity. Corticothalamic feedback acts primarily as a modulator.

#### Attentional Modulation

* **McAlonan, K., Cavanaugh, J., & Wurtz, R. H. (2008)**: [Guarding the gateway to cortex with attention in visual thalamus](https://doi.org/10.1038/nature07382). *Nature*.
    * **The Discovery**: Demonstrated that spatial attention enhances LGN responses to stimuli at attended locations even before information reaches V1. This occurs through feedback from cortical attention networks.
    * **Mechanism**: Attention increases the gain of LGN neurons whose receptive fields overlap with the attended location, amplifying signals from behaviorally relevant regions while suppressing distractors.

* **O'Connor, D. H., Fukui, M. M., Pinsk, M. A., & Kastner, S. (2002)**: [Attention modulates responses in the human lateral geniculate nucleus](https://doi.org/10.1038/nn957). *Nature Neuroscience*.
    * **Human evidence**: Using fMRI, showed that voluntary spatial attention increases BOLD responses in human LGN, confirming that attentional modulation of early visual pathways is not limited to animal models.

#### Corticothalamic Feedback

* **Sillito, A. M., & Jones, H. E. (2002)**: [Corticothalamic interactions in the transfer of visual information](https://doi.org/10.1098/rstb.2002.1170). *Philosophical Transactions of the Royal Society B*.
    * **The Model**: Argued that thalamic function cannot be treated as a processing step separate from cortex: cortical feedback influences the firing pattern, synchronization and response mode of LGN relay cells.
    * **Evidence**: Reviews evidence that corticofugal feedback, including motion-driven feedback from MT relayed through V1 layer 6, modulates LGN responses and contributes to their length tuning.

* **Saalmann, Y. B., Pinsk, M. A., Wang, L., Li, X., & Kastner, S. (2012)**: [The pulvinar regulates information transmission between cortical areas based on attention demands](https://doi.org/10.1126/science.1223082). *Science*.
    * **Higher-order thalamus**: Simultaneous recordings in macaque pulvinar, V4 and TEO showed that the pulvinar synchronizes activity between cortical areas according to where attention is allocated, supporting the idea that thalamic nuclei gate information flow based on behavioral state.

#### State-Dependent Gating

* **McCormick, D. A., & Bal, T. (1997)**: [Sleep and arousal: thalamocortical mechanisms](https://doi.org/10.1146/annurev.neuro.20.1.185). *Annual Review of Neuroscience*.
    * **Finding**: LGN neurons can operate in different modes (tonic firing vs. burst firing) depending on neuromodulatory state. Cortical feedback, combined with inputs from brainstem (e.g., acetylcholine, norepinephrine), controls this gating.
    * **Relevance**: During sleep or inattention, LGN switches to "burst mode," reducing faithful relay of retinal signals. During alert states, feedback maintains "tonic mode" for high-fidelity transmission.

* **Briggs, F., & Usrey, W. M. (2008)**: [Emerging views of corticothalamic function](https://doi.org/10.1016/j.conb.2008.09.002). *Current Opinion in Neurobiology*.
    * **Review**: Synthesizes evidence that corticothalamic feedback regulates LGN gain, temporal precision, and spatial selectivity. Proposes that feedback implements "adaptive filtering" that optimizes the signal-to-noise ratio of visual inputs based on current behavioral demands.


