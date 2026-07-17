# Getting Started: Restricted Focus Viewer for Usability Testing

Scrutinizer works as a **Restricted Focus Viewer** (RFV): it controls where detailed visual information is available and makes the participant's functional focus visible through interaction. The clear region follows the pointer, so inspecting another part of the interface requires bringing that region into focus. Participant and researcher see the same restricted stimulus and can examine peripheral discoverability, visual hierarchy, information density, and the sequence of focus decisions without eye-tracking hardware.

This makes “see what your user sees” a practical description of the method: Scrutinizer renders the page the participant actually works from. The narrower caveat is that pointer position is not a measurement of exact eye position or covert attention; it is the participant-controlled locus of detailed visual access.

This guide covers setup, calibration, and the two features that make Scrutinizer practical for design dialogue: **Visual Memory** and **Comfort Mode**.

---

## 1. Quick Setup

1. [Download the latest release](https://github.com/andyed/scrutinizer2025/releases) or build from source (`npm install && npm start`)
2. Navigate to the page you want to evaluate
3. Press **Cmd+E** to toggle the foveated effect on/off
4. Move your cursor — the clear zone follows it, everything else degrades

The effect is immediate. In a participant-controlled session, you see the same visual information the participant is given and observe where they choose to move the clear region next.

---

## 2. Foveal Size Calibration (Preliminary)

The foveal radius determines where degradation begins. Getting it right matters — too large and the simulation is too generous, too small and it's artificially punishing.

### Default

Out of the box, Scrutinizer uses **45px radius** (~1 degree of visual angle on a MacBook Pro Retina at 50cm viewing distance). This maps to the anatomical fovea — the region of peak cone density where acuity is highest.

### Why calibrate?

The default assumes specific hardware and viewing distance. If you're on a different display or sitting closer/further away, 45px may not correspond to 1 degree for you. The pixel-to-degree mapping depends on:

- **Display pixel density** (PPI)
- **Viewing distance**
- **Display scaling** (Retina vs standard)

### Running the calibrator

**Simulation > Foveal > Run Calibration** opens the [Motion Silence staircase](../foveal-calibration-logic.md). The tool presents a field of rotating crosses that appear to freeze in your periphery due to crowding. By adjusting the radius where you can still detect motion, it converges on your perceptual foveal boundary.

The procedure takes about 2 minutes. Follow the on-screen instructions:
1. Fixate the central cursor (don't move your eyes)
2. Press spacebar when you notice the rotation stop or start
3. The system adjusts the radius up or down based on your responses
4. After ~8 reversals, it locks in your calibrated radius

### Adjusting manually

If you prefer a quick manual adjustment:
- **Arrow keys** (Left/Right) adjust the foveal radius by 10px per press while the effect is active
- Watch the boundary ring in the eccentricity overlay (**Simulation > Utility > Eccentricity Overlay**) to see the current extent

For most design review sessions, the default is close enough. Calibration matters more for research or when comparing results across evaluators.

---

## 3. Visual Memory

Real users don't see one fixation at a time — they build up a scene representation through a sequence of fixations. Visual Memory simulates this accumulation.

### What it does

When Visual Memory is on, Scrutinizer tracks where you've fixated and keeps those areas partially clear. As you move the cursor across a page, previously-fixated regions retain some clarity instead of immediately returning to full peripheral degradation. This simulates iconic and short-term visuospatial working memory.

### Modes

**Simulation > Behavior > Visual Memory:**

| Mode | Fixations retained | Use case |
|------|--------------------|----------|
| **Off** (default) | 0 | Strictest: what can you see right now, at this fixation? |
| **Limited (5)** | 5 | Simulates a quick scan — what do you know after ~5 glances? |
| **Extended (10)** | 10 | Longer exploration — approaching familiarity |
| **Infinite** | All | Cumulative reveal — shows how much of the page a thorough scan covers |

### When to use each

- **Off** for evaluating first-glance discoverability: "Can a user find this button without searching?"
- **Limited/Extended** for evaluating scan efficiency: "How many fixations until the user has oriented to the page structure?"
- **Infinite** for evaluating information coverage: "Even with unlimited viewing, are there regions that peripheral vision simply cannot resolve?"

### Inhibition of Return

There is also an **Inhibition of Return** mode (10 fixations, inverted — previously-fixated areas get *more* degradation). This is separated from the modes above because it serves a different purpose.

In real viewing, inhibition of return is an automatic oculomotor mechanism — the visual system suppresses re-fixation of recently attended locations, biasing the eyes toward novel regions. In an RFV session, visual memory already externalizes this function: the clarity trail shows you where you've been, which naturally discourages revisiting. You can see you've already looked there.

IOR mode makes the cost of revisitation explicit by degrading previously-seen areas. Use it to evaluate how much a layout depends on re-reading — if a user needs to return to a region they already scanned, how much has been lost? Layouts that require frequent re-fixation (dense reference tables, forms with validation feedback far from the input) will feel especially punishing under IOR.

### Design dialogue prompt

Show stakeholders the page with Visual Memory set to Limited (5). Move the cursor through a plausible scan path (logo, headline, primary CTA, navigation). After 5 cursor positions, stop and ask: "Which important regions have become available, and which still require deliberate exploration?"

---

## 4. Comfort Mode

A strict 1-degree clear zone is anchored to the anatomical fovea but can feel punishingly small in an interactive review. In practice, microsaccades and small eye movements provide rapid access to nearby content beyond that region.

### What it does

**Simulation > Behavior > Comfort Mode (+1 degree clear zone)** extends the distortion-free region from 1 degree to approximately 2 degrees. This covers the microsaccade envelope — the zone where small fixational eye movements provide free access without saccadic suppression.

When active, a subtle dashed ring appears at the original 1 degree fovea boundary, marking the microsaccade sweet spot within the larger clear zone.

### The science

| Zone | Radius | Access cost | Movement type |
|------|--------|-------------|---------------|
| Foveola | 0-0.5 deg | Zero | Already resolved |
| Fovea | 0.5-1 deg | Near-zero | Microsaccades (10-30ms, no suppression) |
| Comfort zone | 1-2 deg | Very low | Tiny saccades (20-30ms, negligible suppression) |
| Parafovea | 2-5 deg | Moderate | Voluntary saccades (planning + suppression) |

The key boundary: within ~2 degrees, eye movements are fast enough and small enough that the visual system maintains near-continuous perception. Beyond 2 degrees, saccade planning and saccadic suppression introduce real cost — the user must decide to look there, and they briefly lose vision during the movement.

### When to use it

- **Comfort Mode OFF** (strict 1 deg): Research, validation, measuring worst-case peripheral discoverability
- **Comfort Mode ON** (+1 deg): Design review sessions, collaborative walkthroughs, stakeholder presentations

The strict mode answers: "What can the anatomical fovea resolve?" Comfort mode answers the more practical question: "What can a user comfortably access from this fixation point without real effort?"

For most design dialogue, Comfort Mode provides a less restrictive working condition. It approximates rapid access around the current location while retaining meaningful degradation farther away. Use the same setting across comparable sessions and report whether it was enabled.

---

## 5. A Typical RFV Session

### Setup
1. Open the target page in Scrutinizer
2. Turn on the effect (Cmd+E)
3. Enable **Comfort Mode** (for design review) or leave it off (for strict evaluation)
4. Set Visual Memory to **Limited (5 fixations)**

### First pass: orientation scan
Move the cursor through a plausible first-pass path. For a left-to-right interface, one option is to begin near the top-left, then move through the headline and major layout regions. After 5 cursor positions, stop. This is a reviewer-driven walkthrough, not a recorded participant scanpath.

Ask: What do you know about this page? What is it for? Where would you go next?

### Second pass: task completion
Set a task: "Find the pricing page" or "Sign up for a trial." Move the cursor deliberately. Count fixations. Note where you get stuck — where the layout doesn't guide you to the next fixation target.

### Third pass: peripheral audit
Turn Visual Memory to **Off**. Park the cursor on the primary content area. Without moving it, evaluate: What can you see in the periphery? Can you read navigation labels? Can you tell that a sidebar exists? Is the page footer discoverable?

### Discussion points
- Regions that require many fixations to discover have poor peripheral salience
- Content that is invisible at comfortable viewing distance (2-5 deg) needs stronger visual differentiation
- Dense text regions that become unreadable at small eccentricities may need layout intervention (spacing, grouping, contrast)

---

## 6. Interpreting What You See

### What peripheral degradation means for design

| What you see | What it means | Design response |
|-------------|---------------|-----------------|
| Element invisible at 3-5 deg | Low peripheral salience — users may not notice it without directed search | Increase size, contrast, or spacing; consider motion or color distinction |
| Text unreadable at 2-3 deg | Normal — text requires foveal resolution | Not a bug unless the text needs to be scannable (nav labels, headings) |
| Button blends into background at 5 deg | Low figure-ground separation in periphery | Increase contrast ratio, add border or shadow, increase padding |
| Two elements look identical at 5 deg | Crowding — peripheral vision pools nearby features | Increase spacing between elements, differentiate by color or size |
| Page structure unclear after 5 fixations | Poor visual hierarchy — no strong landmarks guide the scan | Strengthen heading/section contrast, add whitespace between regions |

### Reading span and text evaluation

When evaluating text-heavy pages, keep in mind that reading uses a different spatial strategy than scene viewing. Rayner (1998) established that the perceptual span during reading extends ~14-15 characters to the right of fixation (~5 degrees) but only 3-4 characters to the left. Within this span, useful letter information comes from about 7-8 characters on each side (~2 degrees) — the *visual span* (Legge et al. 2007).

Forward reading saccades average ~7-9 characters (~2 degrees), meaning readers move through text in roughly foveal-width steps. In an RFV evaluation, a label that cannot be resolved from a nearby chosen fixation would require another viewing location under the model. Treat that as a discoverability hypothesis to investigate with participants, not proof of where their eyes will move.

Scrutinizer has a **Reading Span** overlay (**Simulation > Behavior > Reading Span**) that visualizes this asymmetric perceptual window.

### What Scrutinizer does NOT simulate

- **Attention and expectation** — real users have goals and experience that guide their eyes. Scrutinizer shows the sensory input, not the cognitive interpretation.
- **Familiarity** — returning users may know where things are. Scrutinizer does not model an individual's learned layout knowledge.
- **Attention capture from motion** — live pages can contain animation and video, but the RFV model does not establish how strongly those events attract a participant's attention.
- **Measured gaze** — cursor position is a controlled proxy selected by the user unless an external gaze source is explicitly connected.

For moderated participant sessions and reproducible task setup, continue with the [Usability-Testing Practitioner Guide](usability-testing-practitioner-guide.md).

---

## Further Reading

- [Foveated Vision Model](../foveated-vision-model.md) — full biological model behind the rendering pipeline
- [Comfort Zone Research](../comfort-zone-research.md) — microsaccade envelope science
- [Foveal Calibration Logic](../foveal-calibration-logic.md) — psychophysics behind the calibration tool
- [Blueprint Case Study](blueprint_case_study.md) — alternative visualization mode for design reviews
- [Feature Congestion](https://andyed.github.io/scrutinizer-www/blog/congestion-score.html) — quantitative clutter scoring

### References

- Jansen, Blackwell & Marriott (2003). A tool for tracking visual attention: The Restricted Focus Viewer. *Behavior Research Methods, Instruments, & Computers*.
- Rayner (1998). Eye movements in reading and information processing. *Psychological Bulletin*.
- Rolfs (2009). Microsaccades: Small steps on a long way. *Vision Research*.
- Rosenholtz, Li & Nakano (2007). Measuring visual clutter. *Journal of Vision*.
- Ball & Owsley (1993). The useful field of view test. *Optometry and Vision Science*.
