# Meeting Prep: Ruth Rosenholtz & Nicholas Blauch

**Date of meeting:** ~March 14, 2026
**Prepared:** 2026-03-04
**Context:** Both researchers' work is directly implemented in Scrutinizer's foveated vision pipeline

---

## 1. Ruth Rosenholtz -- Current State of Her Research

### Position & Trajectory
- **Principal Research Scientist, NVIDIA Research** (joined 2023, after visiting year)
- Previously 20+ years at MIT BCS/CSAIL
- At NVIDIA she bridges perception science and applied rendering -- exactly the graphics/perception intersection Scrutinizer occupies

### Key Recent Publications

**"Visual Attention in Crisis" (BBS, May 2024)**
- Her flagship theoretical paper. Published in Behavioral and Brain Sciences as a target article with 30+ commentaries.
- **Core claim:** The field of visual attention is in crisis. Many phenomena attributed to "attention" are better explained by the information loss in peripheral vision (i.e., by the TTM). She literally banned the word "attention" in her lab for a year to force more precise mechanistic language.
- **Proposed replacement:** "Task complexity" theory -- all perception results from performing a task, and tasks face a limit on complexity. This replaces vague appeals to "attention" with a measurable constraint.
- **Reception:** Highly contested. Multiple commentaries argue TTM fails on many psychophysical tasks due to its local, single-stage, feedforward, low-level nature. Bornet, Herzog & Doerig wrote "Starting a revolution with a refuted model?" The debate is live and unresolved.
- **Why it matters for Scrutinizer:** If Rosenholtz is right that peripheral encoding explains what we call "attention," then Scrutinizer's peripheral rendering is not just a visualization trick -- it is simulating the actual bottleneck. This would validate the approach at a deeper level than "it looks like what you see."

**"COCO-Periph: Bridging the Gap Between Human and Machine Perception in the Periphery" (ICLR 2024)**
- Harrington, DuTell, Hamilton, Tewari, Stent, Freeman & Rosenholtz
- Modified TTM for use with DNNs; generated a large dataset of TTM-transformed COCO images
- **Key finding:** Common DNNs significantly underperform humans at peripheral object detection. Training on COCO-Periph partially closes the gap but DNNs still fail to capture human-like sensitivity to peripheral clutter.
- **Why it matters:** The modified TTM they built is more tractable than full TTM. Could inform Scrutinizer's Tier 2/3 mongrel texture implementation.
- Code: [github.com/RosenholtzLab/COCOPeriph](https://github.com/RosenholtzLab/COCOPeriph)

**"Efficient Dataflow Modeling of Peripheral Encoding in the Human Visual System" (ACM TAP, Jan 2023)**
- Brown, DuTell, Walter, Rosenholtz, Shirley, McGuire, Luebke
- A computationally efficient alternative to full TTM pooling: dataflow model that includes end-stopped features
- Explicitly designed for graphics applications (display tech, foveated rendering)
- Code: [github.com/ProgramofComputerGraphics/PooledStatisticsMetamers](https://github.com/ProgramofComputerGraphics/PooledStatisticsMetamers)
- **Three metamer generation modes:** single-region (Portilla-Simoncelli style), uniform pooling, gaze-centric (pooling regions grow with eccentricity)
- **Why it matters:** This is the closest existing work to what Scrutinizer's Tier 3 mongrel textures would implement. The gaze-centric mode is exactly what we need.

**"Detection of artifacts in clean and corrupted video pairs" (VSS 2025)**
- Williams, Evdokimov, Duinkharjav, Patney, Sun, Jung & Rosenholtz
- NVIDIA-focused work on artifact perception in foveated rendering -- directly relevant to Scrutinizer's concern about when peripheral filtering produces visible artifacts

**"Do Action Video Game Players Search Faster?" (VSS 2024)**
- With Josef Spjut (NVIDIA), Buetti, Lleras
- Continues her visual search program but now with NVIDIA's gaming/display research group

**EGSR 2024 Keynote: "Demystifying Peripheral Vision"**
- At Eurographics Symposium on Rendering (Imperial College London, July 2024)
- Addressed a graphics/rendering audience -- "peripheral vision is dominated not by loss of acuity, but by vulnerability to clutter (crowding)"
- Emphasized that eye movements involve "a complex tradeoff between information available in fovea vs. periphery, and the costs of shifting gaze"
- **This is the talk to reference.** She was speaking to exactly our audience (rendering people) about exactly our problem.

### GitHub / Code Availability
- **TTM implementation:** [github.com/RosenholtzLab/TTM](https://github.com/RosenholtzLab/TTM) (MATLAB, GPL-2.0, updated Feb 2024)
- **StatTexNet / StatNetExperiments:** Texture statistics network codebase (MIT license)
- **CCP_CSHL:** Demo for Cold Spring Harbor Course, Summer 2024

### The Clutter Metrics (Feature Congestion / Subband Entropy)
- Scrutinizer already implements congestion analysis (`renderer/congestion-core.js`, `renderer/congestion-worker.js`)
- Rosenholtz's original metrics (2005-2007) decompose clutter into Feature Congestion (how hard to add a pop-out item) and Subband Entropy (wavelet-domain information content)
- Could validate Scrutinizer's congestion map against her canonical implementation

---

## 2. Nicholas Blauch -- Current State of His Research

### Position & Trajectory
- **Postdoctoral Researcher, NVIDIA** (Seattle) -- working on "simulation-first approach to developing physical AI"
- **Ph.D. Neural Computation, Carnegie Mellon** (advisors: Marlene Behrmann & David C. Plaut)
- **Postdoc at Harvard Vision Sciences Lab** (Talia Konkle & George Alvarez) -- this is where FOVI was developed
- CMU alum connection with Andy (CMU/GIT/Clemson)
- Now at NVIDIA -- same organization as Rosenholtz

### Key Recent Publications

**"FOVI: A biologically-inspired foveated interface for deep vision models" (arXiv, Feb 3 2026)**
- Blauch, Alvarez & Konkle
- **The cortical magnification transform:** Reformats variable-resolution retina-like sensor array into uniformly dense V1-like sensor manifold
- **kNN convolution:** Receptive fields defined as k-nearest-neighborhoods on the sensor manifold, enabling kernel mapping from canonical reference frame to each neighborhood
- **Two demonstrated architectures:** (1) end-to-end kNN-CNN, (2) foveated DINOv3 ViT via LoRA adaptation
- **Key result:** Competitive performance at a fraction of computational cost of non-foveated baselines
- **The math Scrutinizer uses:** `log_radius = (log(radius + cmf_a) - log(cmf_a)) / (log(fov/2 + cmf_a) - log(cmf_a))` from `fovi/sensing/coords.py`
- Code and pretrained models publicly available (CC-BY-4.0)

**"Foveated sensing with KNN-convolutional neural networks" (Journal of Vision, July 2025)**
- Blauch, Alvarez & Konkle (VSS/JOV)
- The journal paper companion to FOVI -- focuses on the kNN-CNN architecture
- Uses log-polar map model linking retinal sampling to cortical magnification
- Models exhibit realistic cortical retinotopy: exponentially increasing RF size, constant shape as function of eccentricity
- Competitive with resource-matched CNNs on grid-like foveated images; increasing performance with multiple fixations
- **Also presented at CCN 2025:** "Foveated sensing in KNN-convolutional neural networks based on isotropic cortical magnification"

**"Retinotopic scaffolding of high-level vision" (PsyArXiv, 2025)**
- Blauch, Behrmann & Plaut
- How consistent category selectivity in ventral temporal cortex emerges from wiring constraints and retinotopic organization
- **Connection to FOVI:** If retinotopy scaffolds category selectivity, then foveated input (not uniform input) is essential for developing normal cortical organization. FOVI isn't just efficient -- it may be necessary for brain-like representations.

**"Individual variation in functional lateralization of human ventral temporal cortex" (Imaging Neuroscience, 2025)**
- Blauch, Plaut, Vin & Behrmann
- How individual differences in cortical organization arise from local competition and long-range coupling

**"TopoLM: brain-like spatio-functional organization in a topographic language model" (ICLR 2025)**
- Rathi, Mehrer, AlKhamissi, Binhuraib, Blauch & Schrimpf
- Extends topographic organization principles to language models -- shows Blauch thinks about cortical organization broadly, not just vision

### Prior Interaction with Scrutinizer
- **Three rounds of feedback on CMF-to-MIP mapping** (documented in `docs/specs/cmf_mip_derivation.md`)
- Identified three specific bugs: wrong log base, collapsed notation hiding derivation, missing normalization
- Net effect of bugs: MIP levels climbed ~47% faster than biology predicts (over-pooling)
- His feedback was detailed, technically precise, and consistent across three rounds -- he clearly read the code
- **He cares about mathematical fidelity to the Schwartz (1980) complex log mapping**

---

## 3. TTM vs FOVI: Overlap, Divergence, and Complementarity

### What They Share
Both models address the same fundamental observation: visual resolution degrades with eccentricity, and this isn't just blur -- it's a structured transformation.

| Dimension | TTM (Rosenholtz) | FOVI (Blauch/Konkle/Alvarez) |
|-----------|-------------------|-------------------------------|
| **What degrades** | Summary statistics computed over pooling regions | Spatial resolution via cortical magnification |
| **Mechanism** | Texture statistics pooling (Portilla-Simoncelli style) | Log-polar mapping based on Schwartz (1980) |
| **Pooling regions** | Grow linearly with eccentricity | Grow linearly with eccentricity (same fundamental constraint) |
| **What's preserved** | Statistical summaries: mean luminance, contrast energy, orientation, spatial frequency | Low-frequency spatial structure via resolution reduction |
| **What's lost** | Exact feature positions, letter identity, fine spatial frequency | High-frequency detail, fine spatial resolution |
| **Output** | Metamer images (look equivalent in periphery) | Sensor manifold for downstream DNN processing |
| **Computational cost** | Expensive (optimization-based metamer synthesis) | Cheap (geometric transform + kNN convolution) |
| **Use case** | Explaining perceptual phenomena (crowding, search, clutter) | Efficient vision models, active sensing |

### Where They Diverge

**1. Level of description**
- TTM operates at the **perceptual** level: it models what information is available after peripheral encoding. The output is a metamer -- an image that looks the same as the original when viewed peripherally.
- FOVI operates at the **computational** level: it models the geometric transform from retina to cortex. The output is a resampled image that a downstream network processes.

**2. What explains crowding?**
- TTM: Crowding is a natural consequence of summary statistics -- features within a pooling region are combined, destroying their individual identities. Crowding IS the peripheral representation.
- FOVI: Crowding is not explicitly modeled. It would emerge (or not) from the downstream network's inability to resolve features at the reduced resolution. This is left to the network architecture.

**3. The "attention" question**
- Rosenholtz (TTM): Attention may not exist as a separate mechanism -- peripheral encoding explains most phenomena attributed to attention ("Visual Attention in Crisis")
- FOVI: Doesn't take a position on attention. It's a front-end transform, not a theory of perception.

**4. Computability**
- Full TTM metamer synthesis requires iterative optimization (~seconds per image). Even the "efficient dataflow" version (Brown et al. 2023) is too slow for real-time.
- FOVI's log-polar transform is a single geometric resampling -- trivially real-time.

### How Scrutinizer Uses Both

**From FOVI:**
- The cortical magnification curve: `mipLevel = maxMipLevel * [ln(r+a) - ln(a)] / [ln(r_max+a) - ln(a)]`
- Parameter `a = 2.78 deg` (the Schwartz shift parameter)
- This drives the spatial resolution falloff in Mode 6 (FOVI mode)
- **Status:** Three bugs identified by Blauch, fix documented in `cmf_mip_derivation.md`, needs implementation

**From TTM (via Rosenholtz):**
- The conceptual framework: peripheral vision computes summary statistics, not just blur
- The mongrel texture spec (`docs/specs/mongrel_textures.md`): Tier 2 (contrast-preserving pooling) and Tier 3 (true statistical texture replacement) are explicitly designed to approximate TTM output
- The DoG band decomposition: separating spatial frequencies before attenuation, rather than applying uniform Gaussian blur, is inspired by the TTM's insight that different statistics survive to different eccentricities
- Visual clutter metrics (Feature Congestion) already implemented in congestion pipeline

**The complementarity:**
- FOVI provides the **spatial geometry** (how resolution scales with eccentricity)
- TTM provides the **content model** (what information survives at each eccentricity)
- Scrutinizer layers both: FOVI's CMF curve drives MIP level selection, while the DoG decomposition + mongrel texture framework approximates TTM's statistical encoding
- This is actually a reasonable architecture: use a fast geometric transform (FOVI-style) to set the resolution, then approximate the statistical encoding (TTM-style) at each resolution level

---

## 4. Questions to Prepare

### For Rosenholtz

**Lead with:**
1. "Scrutinizer uses DoG band decomposition on the hardware MIP chain as a real-time approximation of summary statistics pooling. The high-frequency bands drop first, low-frequency structure persists. How far off is this from TTM's actual encoding?"
   - She'll likely say: MIP blur preserves mean luminance and some coarse orientation but loses contrast energy and cross-correlation statistics that TTM preserves. The concern is that MIP blur makes everything uniformly washed-out, while TTM metamers maintain local contrast texture.

2. "We have a Tier 2/3 spec for statistical texture replacement in the periphery (mongrel textures). What are the minimum statistics we need to preserve for the rendering to be perceptually valid -- i.e., to produce metamers rather than just blur?"
   - She has explicit answers to this from 15+ years of TTM work. The key statistics are from the Portilla-Simoncelli texture model: marginal statistics of each subband, cross-scale correlations, and auto-correlations.

3. "Your EGSR keynote emphasized that peripheral vision is dominated by crowding, not acuity loss. Our DoG implementation attenuates high frequencies but doesn't explicitly model crowding (positional uncertainty). Is that a fatal flaw, or does frequency attenuation approximate crowding's effect on recognition?"
   - This gets at the core debate. She might argue that frequency attenuation alone doesn't capture crowding because crowding involves feature pooling (mixing identity of adjacent items), not just resolution loss.

4. "In 'Visual Attention in Crisis' you propose task complexity as the bottleneck rather than attention. For a tool designed to show designers what users 'actually see' -- should we frame it as showing the peripheral encoding, or showing the task-complexity limit?"
   - Conceptual framing question that shows you've read the BBS paper.

**Potential questions from her / criticisms to anticipate:**
- "Why MIP levels? The hardware MIP chain does box/bilinear filtering, not the biological equivalent. It's a Laplacian pyramid with the wrong kernel." Response: We know it's approximate (documented as "approximate Laplacian pyramid, box/bilinear, not Gaussian," citing Burt & Adelson 1983). The tradeoff is real-time performance at near-zero GPU cost. We want to understand how to improve fidelity within this constraint.
- "Your model has no feedback / recurrence. Peripheral vision is not purely feedforward." Response: Acknowledged in the paper's limitations. The saliency modulation pathway is a rough analog of top-down influence, but it's not recurrent.
- "How do you validate that what you're showing is perceptually equivalent to peripheral vision?" Response: We don't claim perceptual equivalence. We position Scrutinizer as a "design constraint model" -- it shows what spatial structure survives, not an exact rendering of peripheral experience.

### For Blauch

**Lead with:**
1. "We've implemented the corrected CMF mapping per your three rounds of feedback. Want to walk through the shader to verify?"
   - Show him the actual GLSL. He's already been in the code-level details.

2. "FOVI normalizes cortical distance to [0,1] and then a downstream network handles everything else. We map it to MIP levels instead, which adds a discrete quantization. Do you see that as a fundamental problem or an acceptable approximation for rendering?"
   - MIP levels are inherently discrete (0,1,2,3,4) with trilinear interpolation between them. This quantizes the continuous FOVI mapping. He'll likely say it's acceptable if the interpolation is smooth.

3. "Your 'Retinotopic scaffolding' paper argues that foveated input is essential for developing brain-like category selectivity. Does that imply anything about what a foveated rendering tool should preserve? E.g., should we care about semantic categories in the periphery, or is it sufficient to model the geometric/statistical encoding?"
   - Bridges his two research threads (FOVI + cortical topography).

4. "We currently show FOVI as one of several switchable modes (alongside DoG bands, legacy Gaussian blur). What's the most informative comparison we could make between FOVI's CMF curve and our DoG-based frequency decomposition?"
   - The paper already notes "Scrutinizer's effective cutoff falls 3.5-4.6x lower at matched eccentricities" than pure CMF. Understanding what accounts for this difference is the question.

5. "The FOVI model uses a=2.78 degrees as the Schwartz shift parameter. Is this the canonical value, or is there a range we should be testing?"
   - Shows you're thinking about parameter sensitivity, which is exactly what a careful implementer would worry about.

**Potential questions from him / criticisms to anticipate:**
- "Your DoG bands aren't modeling what FOVI models. FOVI is a spatial resampling; DoG is a frequency decomposition. They're operating on different dimensions." Response: Agreed -- that's why they're different modes. The comparison table in the paper makes this explicit. We see them as complementary: CMF drives where you lose resolution, DoG drives what frequencies you lose first.
- "Why not just use FOVI directly as your front end?" Response: FOVI outputs a transformed image for a DNN. We need a human-viewable rendering. The MIP chain gives us a way to present FOVI's resolution model in a form humans can interpret.
- "The `a` parameter should be fit to psychophysical data, not hardcoded." Response: What data would you recommend? Is the Watson & Ahumada (2005) CSF parameterization relevant here?

### Questions for Both (intersection points)

1. "Rosenholtz's TTM computes summary statistics over pooling regions that grow linearly with eccentricity. FOVI's CMF also implies linearly growing pooling regions (via the log-polar mapping). Are these the same pooling regions? Or are they computationally distinct?"
   - Both scale linearly with eccentricity (Bouma's law for crowding zones maps to the same scaling as cortical magnification). But TTM pooling regions tile the visual field, while FOVI's sensor manifold is a continuous mapping. The relationship is deep but the implementations diverge.

2. "What's the right way to think about the relationship between cortical magnification (geometric resolution loss) and crowding (statistical pooling)? Are they the same thing at different levels of description, or genuinely different mechanisms?"
   - This is THE fundamental question in peripheral vision right now. Pelli (2008) argued crowding and magnification are dissociable. Rosenholtz argues pooling explains crowding. This question shows you understand where the science currently sits.

3. "If we had eye tracking input instead of mouse position, what would change most about the rendering model? Saccade dynamics? Fixation stability? Or something about the peripheral encoding itself?"
   - Practical question that both would have strong opinions on. Rosenholtz would probably emphasize that eye tracking lets you model the actual visual field correctly. Blauch might emphasize that saccadic exploration changes what information is accumulated over time.

---

## 5. Literature Gaps That Real-Time Browser Implementation Might Address

### Gap 1: No real-time TTM-like encoding exists
The TTM requires iterative optimization to synthesize metamers. COCO-Periph generates them offline. Nobody has done real-time statistical texture replacement in a browser at 60fps. Scrutinizer's Tier 2/3 spec is a genuine contribution if implemented -- even approximately.

### Gap 2: No live-content foveated rendering tool
FOVI processes static images. BubbleView processes static images. ViewSer operated on live SERPs but with binary DOM-level masking. Scrutinizer is (to our knowledge) the only tool doing biologically-grounded peripheral filtering on live interactive web content at 60fps.

### Gap 3: No side-by-side comparison of peripheral vision models on the same content
The paper's comparison table (blur vs. DoG vs. CMF) is novel. Nobody has put these three approaches in the same tool so a researcher can switch between them and see the difference on the same web page.

### Gap 4: No web accessibility standards account for eccentricity
WCAG, Material Design, Apple HIG -- none of them include eccentricity-dependent contrast requirements. Scrutinizer could generate the data to inform such standards. This is the design-evaluation use case.

### Gap 5: Human peripheral performance on web layouts vs natural scenes
COCO-Periph tests peripheral object detection on COCO images. Nobody has done the equivalent for web interface elements (buttons, icons, navigation, cards). The structure map + peripheral rendering combination makes this testable.

---

## 6. Strategic Framing for the Meeting

### What Scrutinizer IS (position clearly):
- A **rendering platform** for comparing peripheral vision models on live web content
- A **design evaluation tool** that stress-tests information hierarchy under peripheral constraints
- A **research instrument** with switchable models (DoG, CMF/FOVI, future TTM-style) and 130+ unit tests
- An **open-source implementation** that bridges vision science literature and practical web development

### What Scrutinizer is NOT (avoid over-claiming):
- Not a faithful simulation of peripheral perception (acknowledged in paper's limitations)
- Not a perceptual metamers generator (Tier 3 aspiration, not current state)
- Not an eye-tracking replacement (mouse proxy, with eye-tracker branch point documented)
- Not a neural network -- the shader pipeline is explicitly a hand-tuned approximation

### The ask:
- Technical feedback on the implementation (Blauch has already been giving this)
- Guidance on which approximations matter most for perceptual validity
- Whether there's interest in using Scrutinizer as a platform for experiments in their groups
- Potential for a validation study: human peripheral discrimination thresholds vs. Scrutinizer's model predictions

---

## 7. Key Papers to Have Read / Be Ready to Reference

### Rosenholtz
- Rosenholtz (2024). "Visual Attention in Crisis." BBS. [PubMed](https://pubmed.ncbi.nlm.nih.gov/38699816/)
- Harrington et al. (2024). "COCO-Periph." ICLR 2024. [OpenReview](https://openreview.net/forum?id=MiRPBbQNHv)
- Brown et al. (2023). "Efficient Dataflow Modeling of Peripheral Encoding." ACM TAP. [ACM DL](https://dl.acm.org/doi/full/10.1145/3564605)
- Rosenholtz, Huang & Ehinger (2012). "Rethinking the role of top-down attention." Frontiers in Psychology.
- Balas, Nakano & Rosenholtz (2009). "Summary-statistic representation explains visual crowding." J. Vision.
- Rosenholtz, Li & Nakano (2007). "Measuring visual clutter." J. Vision.
- EGSR 2024 keynote: "Demystifying Peripheral Vision" [EGSR page](https://www.egsr2024.uk/keynotes/)

### Blauch
- Blauch, Alvarez & Konkle (2026). "FOVI." arXiv:2602.03766. [arXiv](https://arxiv.org/abs/2602.03766)
- Blauch, Alvarez & Konkle (2025). "Foveated sensing with KNN-CNNs." J. Vision 25(9). [JOV](https://jov.arvojournals.org/article.aspx?articleid=2809848)
- Blauch, Behrmann & Plaut (2025). "Retinotopic scaffolding of high-level vision." PsyArXiv.
- Blauch, Plaut, Vin & Behrmann (2025). "Individual variation in functional lateralization." Imaging Neuroscience.

### Foundational
- Schwartz (1980). Complex log mapping. Vision Research 20(8).
- Freeman & Simoncelli (2011). "Metamers of the ventral stream." Nature Neuroscience.
- Pelli (2008). "Crowding is unlike ordinary masking." Vision Research.
- Portilla & Simoncelli (2000). Parametric texture model. Int. J. Computer Vision.

---

## 8. Personal Notes on Researchers

### Rosenholtz
- Has been thinking about peripheral vision for 20+ years. Will notice superficial engagement immediately.
- Values precise mechanistic language (she banned "attention" from her lab). Be specific about what you mean.
- At NVIDIA now, so she's thinking about rendering applications. This is your bridge.
- The "Visual Attention in Crisis" paper generated pushback. She's used to defending her position.
- Her clutter metrics (Feature Congestion) are already in Scrutinizer -- mention this.

### Blauch
- Young researcher (recently completed postdoc). Technically precise -- his three rounds of feedback on the MIP mapping show he reads code carefully.
- CMU Neural Computation PhD -- shares CMU background with Andy
- Now at NVIDIA doing robotics simulation -- his interest in FOVI is partly about efficient perception for embodied AI
- He cares about mathematical fidelity to the source formulations. Do not approximate casually.
- The FOVI paper is only a month old (Feb 2026). He's actively thinking about and promoting this work.
- His broader research program (retinotopic scaffolding, cortical topography) suggests he sees FOVI as part of a bigger story about why foveated processing matters for brain-like computation, not just efficiency.

### Both are at NVIDIA
- This means they may already be in contact. Don't assume they haven't discussed Scrutinizer with each other.
- NVIDIA's rendering research group (Patney, Spjut) works on foveated rendering for VR/AR. Scrutinizer is doing something adjacent (foveated rendering for web evaluation). Position it as complementary, not competitive.
