# Vision: Controlled Hallucination and Mind's Eye

**Source:** https://gemini.google.com/share/866110499fa8  
**Date:** November 23, 2025

## The Whole Picture (Shortest Possible Blurb)

Vision is not a camera feed; it is a controlled hallucination. Your fovea acts as a high-resolution spotlight painting detail onto a blurry, motion-sensitive peripheral canvas (similar to foveated rendering). Crucially, you are effectively blind for ~40 minutes a day during eye movements (saccades), but your occipital lobe uses predictive modeling to "edit out" the blackouts and motion blur, stitching together a seamless timeline of reality that exists only in your mind's eye.

## Compelling Narratives & Mechanisms

### 1. The "Foveated Rendering" of Reality

You can frame foveal vs. peripheral vision exactly like a GPU optimization technique.

- **The Fovea (The High-Res Texture)**: Only the central 1-2 degrees of your vision (about the size of your thumb at arm's length) captures high-fidelity color and detail. This is the only part of the screen "fully rendered."
- **The Periphery (The Low-Poly Mesh)**: The rest of your visual field is surprisingly low-resolution, color-blind in the far reaches, and optimized almost exclusively for motion detection (magno-cellular pathways). It triggers the "camera" (eye) to move, but it doesn't actually see the object until the fovea lands on it.
- **The Illusion**: You feel like you see a detailed world in 180 degrees because your brain caches the details of where you just looked and predicts the details of where you will look.

### 2. Saccadic Masking: The "Cut" in the Film

Your eyes move roughly 3-5 times per second. During these ballistic jumps (saccades), the motion blur would be nauseating.

- **The mechanism**: To solve this, the visual cortex executes Saccadic Suppression. It cuts the feed. You are functionally blind during the movement.
- **Chronostasis (The Hack)**: To hide the "cut," your brain back-fills the gap in time. When your eyes land on a new target (e.g., a clock), your brain projects that new image backward in time to cover the milliseconds you were blind. This is why a clock's second hand sometimes appears to "hang" for longer than a second when you first look at it (the Stopped Clock Illusion). The brain is editing the timeline of your conscious experience in real-time.

### 3. The Occipital "Mind's Eye"

The occipital lobe is not just a passive receiver; it is a projector.

- **Predictive Coding**: According to theories like those of Anil Seth, the brain is a "prediction machine." Top-down signals (predictions) flow from the cortex to the occipital lobe, while bottom-up signals (sensory data) only report prediction errors (surprises).
- **V1 Visualization**: Research confirms that mental imagery activates the primary visual cortex (V1)—the same hardware used for seeing. When you "visualize" something, you are literally driving the occipital lobe in reverse. In the absence of data (like during a saccade or in the blind spot), the occipital lobe fills in the texture based on its internal model—effectively a "mind's eye" projection.

### Best Resource

**Anil Seth** - "Your brain hallucinates your conscious reality"  
Why this video is relevant: Anil Seth explicitly defines perception as "controlled hallucination," detailing how our brain generates the world from the inside out rather than passively receiving it.

## Color Receptor Coverage and Continuous Experience

Science has moved beyond the simple idea of "filling in" to a more computational model called **Ensemble Perception** and **Summary Statistics**.

### 1. The "Mongrel" Theory (Summary Statistics)

The leading modern theory, championed by **Ruth Rosenholtz (MIT)**, argues that the brain does not attempt to "render" the periphery in low resolution; instead, it compresses it into summary statistics.

- **The Mechanism**: Your peripheral vision doesn't save pixel data; it saves "texture data." It calculates the average color, orientation, and density of a patch of space.
- **The Result**: This creates what Rosenholtz calls "Mongrels"—weird, statistically accurate but spatially scrambled representations. If you are standing in a forest, your periphery doesn't see "green leaves"; it sees "green-ish high-frequency noise."
- **Why it feels continuous**: The brain is satisfied with this statistical summary. As long as the average color of the periphery matches the specific color of the fovea, the brain flags the scene as "continuous" and doesn't bother rendering the details.

### 2. The "Refrigerator Light" Illusion (Attentional Access)

A pivotal 2020 PNAS study (Cohen et al.) used VR eye-tracking to desaturate the user's peripheral vision to black-and-white in real-time. As long as the fovea (center) remained colored, almost a third of observers never noticed that the rest of the world was black and white.

- **The Narrative**: This supports the "Grand Illusion" theory of consciousness. The world is not a 360-degree painted canvas; it is a "query-based" system. The moment you ask "is that corner red?" your eyes dart there, the cones fire, and the brain answers "yes." The brain then falsely assumes "it must have been red the whole time."

### 3. The Pan-Field Color Illusion

Research by Balas and Sinha (2007) identified the "Pan-Field Color Illusion."

- **The Mechanism**: The brain assumes Uniformity of Illumination. If the central object is bathed in warm light, the brain extrapolates that color temperature across the entire peripheral "mesh."
- **Cortical Patching**: This happens in the V4 visual cortex (responsible for color). V4 neurons have massive receptive fields. When precise color data is missing from the periphery (due to sparse cones), V4 neurons appear to "pool" information from the fovea and flood the peripheral representation with that hue.

**Summary**: You are not seeing a continuous movie. You are seeing a high-res foveal thumbnail surrounded by a statistical spreadsheet of textures. The sensation of "continuous color" is a retrospective lie your brain tells you because it assumes the lighting conditions haven't changed.

## UX, Conversion, and Design Implications

### 1. The "Heatmap Lie" (UX & Conversion)

Standard heatmaps (red = looked at, blue = ignored) are dangerously misleading because they only track foveal attention.

- **The Reality**: Users often don't look at buttons they are about to click. Their peripheral vision (the "summary statistics") identified the button as "clickable-shaped" and "correctly colored" without needing a foveal check.
- **Banner Blindness as Feature Filtering**: The user's peripheral vision successfully computed the "summary statistics" of that rectangle, identified it as "Ads (Low Value)," and suppressed the saccade command. The user saw it; they just decided it wasn't worth the high-res texture load.

### 2. "Foveated Rendering" (VR & Gaming)

In VR, rendering the whole screen at 4K is a waste of GPU power. By tracking the eye, engines like Unreal and Unity now use Foveated Rendering—rendering the center at 100% quality and the periphery at 20% quality.

- **Why it works**: It proves mechanically that your peripheral vision is merely a "suggestion" of reality.

### 3. "Mongrels" & Visual Clutter (Data Viz)

Ruth Rosenholtz's work on "Mongrels" (visualizations of what your periphery actually sees).

- **The Narrative**: You can predict "visual clutter" not by counting objects, but by measuring "feature congestion." If the summary statistics of a dashboard are too messy, the user's brain cannot compress the periphery into a safe background.
- **Actionable Takeaway**: Good UI design is about making the peripheral "mongrel" look calm.

**Shortest Possible Blurb**: Heatmaps are a lie. They only show where the "camera" pointed, not what the brain processed. Your users "see" your entire interface via peripheral summary statistics (blurry averages of color/shape) to decide where to aim their foveal spotlight. If your primary button doesn't look like a button in the "blurry version" of your site, users will never aim their eyes at it to confirm. Design for the blur first; the details are just for confirmation.

## Usability / UX World

### The Whole Picture (Shortest Possible Blurb)

Peripheral vision is the "Chief of Staff"; Foveal vision is the "CEO." The periphery processes low-res "information scent" (shapes, contrast, motion) to decide if a saccade is worth the energy cost. If the periphery says "no scent," the fovea never looks, and the user technically "never saw it." Great UX hacks this by designing "proximal cues" (strong scent) in the periphery to trigger the eye movement, and using "skeleton screens" to hide the brain's 40ms blind spot during the jump.

### 1. Information Foraging: The "Scent" is Peripheral

- **The Narrative**: Users behave like predators in a forest. They don't analyze every tree (link/button); they scan for the "scent" of their prey (information).
- **The Mechanism**: The peripheral retina cannot read text, but it is excellent at detecting "Proximal Cues"—visual signals that imply value (blue underlined text, button shapes, specific icons).
- **UX Reality**: If a button is designed too flat or a link isn't clearly distinguished by contrast (scent), the peripheral retina filters it out as "background noise" before the fovea can ever inspect it.

### 2. Chronostasis: Hacking "Perceived Performance"

- **The Mechanism**: During a saccade (clicking a link or shifting focus), the user is blind for ~50-100ms. The brain will "back-fill" this gap with whatever image it sees after the eyes land.
- **UX Application**: If you show a Skeleton Screen (a gray wireframe structure) immediately, the eye lands on a stable structure. The brain back-dates this stable image to the start of the saccade, erasing the "loading" gap from the user's timeline.

### 3. The "F-Pattern" is a Failure of Scent

- **The Counter-Narrative**: The F-Pattern is actually a symptom of weak peripheral cues.
- **The Reality**: When the periphery finds no strong "scent" in the right-hand content, the eye hugs the "rail" of the left margin because it's the only predictable anchor. Good design breaks the F-Pattern by placing strong visual magnets in the right-hand periphery.

### Notable Online Resources

- **Nielsen Norman Group (NN/g)**: Articles on "Gaze Plot vs. Heatmap" and "Banner Blindness"
- **Luke Wroblewski**: Writes extensively on "Skeleton Screens" and perceived performance
- **Microsoft Research (Visualization & Interaction Group)**: Deep dives on "Peripheral Display"

## Word Form Priming and SERP Scanning

### The Whole Picture (Shortest Possible Blurb)

Users scan SERPs faster not because they care less (reduced confidence), but because their brains have cached the "texture" of the keywords. Word Form Priming pre-activates the visual cortex for specific shapes (e.g., the shape of "Python"), allowing the eye to identify matches peripherally without needing a full foveal stop. This is a hardware acceleration of the visual system, distinct from the software decision of "Satisficing" (picking the first "good enough" link).

### The Science: Priming vs. Satisficing

#### 1. The Mechanism: Word Form Priming (Hardware Acceleration)

- **Orthographic Priming**: When a user types a query (e.g., "best dslr camera"), the neural pathways for those specific letter shapes are "warmed up."
- **Perceptual Fluency**: As they scan the results, their brain processes the visual shape of "dslr" faster than "camera" or "best" because those shapes were just generated.
- **Parafoveal Preview**: Because the word form is primed, the user can identify it in their parafoveal vision before looking directly at it. This allows them to skip saccades entirely.

#### 2. The Counter-Narrative: "Reduced Confidence" (Satisficing)

Herbert Simon's "Satisficing" (1956): Users do not look for the best result (optimizing); they look for the first result that exceeds a minimum threshold of acceptability (satisficing).

### Key Resources & Published Works

1. **Information Foraging Theory** - Peter Pirolli (Xerox PARC)
   - Book: *Information Foraging Theory: Adaptive Interaction with Information* (Pirolli, 2007)
   
2. **The Neural Basis of Priming**
   - Paper: "Priming of pop-out: One few-trial case of rapid visual learning" (Maljkovic & Nakayama, 1994)
   - Key Concept: Repetition Suppression
   
3. **Rapid Resumption** - Ronald Rensink

**Summary**: Priming reduces the cost of seeing (the brain renders the keyword faster). Satisficing reduces the threshold of choosing (the user accepts a lower-quality match). Both happen, but Priming is the mechanism that explains the physical speed of the eye movement, while Satisficing explains the stop decision.

## The Fovea in UX Practice

### Mainstream UX ignores the biology; Elite UX obsesses over it.

### 1. The Mainstream "Cover-Up"

In 90% of UX articles, the term Fovea is rebranded as "Central Vision" or "Focus."

### 2. The "Secret Handshake" Authors

- **Jeff Johnson** (*Designing with the Mind in Mind*): Explicitly breaks down the eye into Foveal (High-Res) vs. Peripheral (Low-Res)
  - Quote: "The fovea is the only part of the retina that is high-resolution enough to read... The periphery is for 'Where?' The fovea is for 'What?'"
  
- **Susan Weinschenk** (*100 Things Every Designer Needs to Know About People*): Ph.D. in Psychology, primary bridge between Cognitive Psych and UX
  - The "Peripheral Governor" Theory: Peripheral vision dictates where central vision looks

### 3. Where "Fovea" is actually a buzzword

- **AdTech / Conversion Optimization**: Track "Time to Fixation"
- **VR / AR (Spatial Computing)**: Terms like "Foveated Rendering" and "Gaze-Contingent Displays" in Apple Vision Pro and Meta Quest documentation

## The Mongrel Theory in Detail

### Core Concept: Texture, not Blur

Standard design theory assumes peripheral vision is just low resolution (like a blurry JPG). **Mongrel Theory (Rosenholtz, MIT)** argues that peripheral vision is lossy compression via summary statistics.

- **How it works**: Your brain divides the periphery into "pooling regions." In each region, it doesn't save the pixels. Instead, it calculates a mathematical summary: "What is the average color? Average orientation? Density? Contrast?"
- **The Result**: The brain then "re-synthesizes" a texture based on those stats. It's like a Generative AI trying to rebuild a scene based on a text prompt.

### The "Mongrel" Visualization

A "Mongrel" is the actual visualization of this mathematical summary. It looks like a "style transfer" nightmare—objects melt into each other, text becomes a garbled texture, and specific locations are lost.

### Famous "Mongrel" Examples from MIT Perceptual Science Group

#### A. The "Parking Meter" Scene (The Classic)

- **The Mongrel**: The parking meters don't just get blurry; they multiply. The vertical lines of the meters and the vertical lines of the reflections in the car windows get "pooled" together.
- **The Sensation**: The periphery reports "lots of vertical, metallic stuff over there." It creates a texture of "meter-ness" rather than 5 distinct meters.

#### B. The "Google Maps" Mongrel

- **The Road Grid**: The grid-like streets of downtown remain surprisingly clear (because "grid" is a strong statistical summary).
- **The Winding Roads**: The curving roads in the suburbs turn into a nest of snakes. The brain captures "curviness" and "density" but loses the connectivity.

#### C. The "Subway Map" Crowding

- **The Text**: The station names don't blur into gray bars. They turn into "Letter-Like Texture." You see shapes that look like letters, but they are jumbled composites of the neighboring letters.
- **Crowding**: This demonstrates Visual Crowding. If you place two icons too close together in the periphery, the brain pools them into a single "mongrel" icon that looks like neither.

### Implications for Visual Design

- **The "Glitter" Problem**: If visuals have high-frequency noise (lots of small, high-contrast dots or lines), the peripheral summary statistic is just "noise."
- **Design for the Pool**: To make something noticeable in the periphery, it must have a unique summary statistic compared to its neighbors.
  - Bad: A red circle next to a red square (both summarize to "Red/Dark")
  - Good: A red circle next to a field of blue lines (distinct color AND orientation statistics)

## Scrutinizer 2025: Moving from Camera Blur to Neural Processing

### Current State

Scrutinizer successfully models optical defocus (what a camera lens does), but to model neural peripheral processing (what the brain does), it needs to break the image, not just soften it.

The current Gaussian blur implies the periphery is just "out of focus." Biologically, the periphery is fully focused (the lens doesn't change shape for the edges); the data is just spatially uncertain due to large receptive fields pooling the signal.

### Roadmap: From "Camera Blur" to "Rosenholtz Mongrel"

#### 1. The "Color Drop-Off" (Easy / High Impact)

- **The Biology**: Cone density drops off precipitously outside the fovea. The far periphery is effectively color-blind.
- **The Shader Logic**:
  - Calculate eccentricity (distance from mouse cursor)
  - Desaturate the image as eccentricity increases
  - Don't go to grayscale. Go to "Sepia/Mud"
  - Boost Contrast while dropping Saturation in the periphery (Magno-cellular pathway is blind to color but hyper-sensitive to contrast/luminance)

#### 2. The "Mongrel" Jitter (Domain Warping)

- **The Biology**: Visual Crowding - the brain knows "there are letters here," but it confuses their positions.
- **The Canvas Logic**: Use UV Displacement (Domain Warping)
  - Generate a low-frequency noise texture
  - Use that noise to offset the UV coordinates
  - Scale the strength based on eccentricity
- **Visual Result**: Text won't just look fuzzy; lines will wave and merge. Letters will overlap.

#### 3. Simulating the "Blind Spot" (The Optic Nerve)

- **The Biology**: A literal hole in vision ~15 degrees from the fovea (where the optic nerve exits)
- **The Simulation**: Add a circular region at ~15 degrees eccentricity with aggressive in-painting or heavy distortion

#### 4. The "Parafoveal" Transition (The Uncanny Valley)

- **The Nuance**: The drop-off in acuity is logarithmic, not linear
- **Implementation**: Keep text legible in the parafovea but introduce Interactional Crowding
  - Apply shader that slightly "magnetizes" letters together
  - The Parafovea is where reading happens "one step ahead"

### Canvas-Compatible Effects for Parafovea

#### 1. The "Jigsaw" Jitter (Simulating Crowding)

- **The Theory**: In the parafovea, the brain receives features but loses positional data, resulting in "feature migration"
- **The Canvas Hack**: Instead of averaging pixels (blur), displace them
- **Visual Result**: Text stays "sharp" (high contrast) but becomes illegible because strokes overlap

#### 2. Chromatic Aberration (The Magno-Cellular Split)

- **The Theory**: The peripheral retina is dominated by Magno cells (motion/contrast, colorblind) vs Parvo cells (color/detail)
- **The Canvas Hack**: Shift the Red channel slightly left and Blue channel slightly right as eccentricity increases
- **Why this works**: Creates "vibrating" edges, destroying precise contrast edges while keeping word "shape" intact

#### 3. The "DOM Hijinx" (Actual Text Replacement)

- **The Theory**: The "Bouma Shape" of a word is defined by its ascenders and descenders
- **The Implementation**: Swap inner characters while keeping first and last letters intact
  - Real: "The quick brown fox"
  - Parafovea: "The qcuik bwron fox"

### Recommendation for blur-worker.js

Don't try to implement a true Gaussian blur in JS for the whole screen—it's too slow. Instead, implement a "Box Sampling with Noise":

- **Fovea**: 1:1 pixel copy
- **Parafovea**: Copy pixels but add a random +/- 2px offset to the lookup index (simulates jitter/nystagmus)
- **Periphery**: Downsample. Only read every 4th pixel and draw it as a 4x4 block (simulates low photoreceptor density)

This "Blocky + Jittery" aesthetic is scientifically closer to a "Mongrel" than a smooth blur.

## Key Takeaways for Scrutinizer Development

1. **Vision is controlled hallucination**: The brain generates reality from predictions, not just passive input
2. **Peripheral vision uses summary statistics**: Not blur, but texture compression (Mongrel Theory)
3. **Saccadic suppression**: Users are blind 40 minutes/day during eye movements
4. **Parafoveal processing is critical**: This is where reading happens "one step ahead"
5. **Design implications**: Test interfaces in their "peripheral mongrel" form, not just sharp foveal view
6. **Canvas implementation**: Use jitter, chromatic aberration, and block sampling instead of pure Gaussian blur for biological accuracy
