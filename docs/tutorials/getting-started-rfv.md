# Getting Started: Restricted Focus Viewer for Usability Testing

Scrutinizer works as a **Restricted Focus Viewer** (RFV): it simulates a foveal-plus-peripheral visual scene, controls where detailed information is available, and makes the participant's functional focus visible through interaction. Its biologically motivated peripheral rendering aims to approximate the visual evidence that guides eye-movement planning. The clear region follows the pointer, so inspecting another part of the interface requires bringing that region into focus.

In the intended loop, the current peripheral view helps the participant choose a target; moving the pointer emulates a change in gaze; the newly clear region supplies detailed information; and Visual Memory can retain prior samples for the next decision. Participant and researcher see the same stimulus throughout that loop, so “see what your user sees” is a practical description of the method. Pointer position is an emulated fixation location and the participant-controlled locus of detailed visual access. It does not measure exact eye position or covert attention.

This guide covers setup, calibration, and the two features that make Scrutinizer practical for design dialogue: **Visual Memory** and **Comfort Mode**.

---

## 1. Quick Setup

1. [Download the latest release](https://github.com/andyed/scrutinizer2025/releases) or build from source (`npm install && npm start`)
2. Navigate to the page you want to evaluate
3. Press **Cmd+E** to toggle the foveated effect on/off
4. Move your cursor: the clear zone follows it, and everything else degrades

The effect is immediate. In a participant-controlled session, you see the same visual information the participant is given and observe where they choose to move the clear region next.

---

## 2. Foveal Size Calibration (Preliminary)

The foveal radius determines where degradation begins. If it is too large, the simulation is too generous. If it is too small, the simulation is artificially punishing.

### Default

Out of the box, Scrutinizer uses **45px radius** (~1 degree of visual angle on a MacBook Pro Retina at 50cm viewing distance). This maps to the anatomical fovea, the region of peak cone density where acuity is highest.

### Why calibrate?

The default assumes specific hardware and viewing distance. If you're on a different display or sitting closer/further away, 45px may not correspond to 1 degree for you. The pixel-to-degree mapping depends on:

- **Display pixel density** (PPI)
- **Viewing distance**
- **Display scaling** (Retina vs standard)

### Running the calibrator

The in-app menu entry is currently disabled while calibration performance in Electron lags the browser (see [Known Issues](../known-issues.md)). Run the [Motion Silence staircase](https://andyed.github.io/scrutinizer-www/foveal-calibration.html) in a browser on the same display instead ([method](../foveal-calibration-logic.md)). The tool presents a field of rotating crosses that appear to freeze in your periphery, which the method attributes to crowding. By adjusting the radius where you can still detect motion, it converges on your perceptual foveal boundary. Apply the result by choosing the nearest preset under **Simulation > Foveal > Foveal Radius**, then fine-tune with the arrow keys.

The procedure takes about 2 minutes. Follow the on-screen instructions:
1. Fixate the central cursor (don't move your eyes)
2. Press spacebar when you see the outer crosses start rotating again
3. The system adjusts the radius up or down based on your responses
4. After 8 reversals (sooner if the last 5 reversals fall within 30px), it shows your calibrated radius

### Adjusting manually

If you prefer a quick manual adjustment:
- **Arrow keys** (Left/Right) adjust the foveal radius by 10px per press while the effect is active
- Watch the boundary ring in the eccentricity overlay (**Simulation > Eccentricity Overlay**) to see the current extent

For most design review sessions, the default is close enough. Calibration matters more for research or when comparing results across evaluators.

---

## 3. Visual Memory

Users build up a scene representation through a sequence of fixations. Visual Memory simulates this accumulation.

### What it does

When Visual Memory is on, Scrutinizer tracks where you've fixated and keeps those areas partially clear. As you move the cursor across a page, previously-fixated regions retain some clarity. This is an operational setting loosely motivated by memory for previously fixated locations. It does not model the capacity or fidelity of human visual memory: iconic memory lasts a few hundred milliseconds (Sperling 1960), and detail carried across saccades is sparse (Irwin 1991).

### Modes

**Simulation > Behavior > Visual Memory:**

| Mode | Fixations retained | Use case |
|------|--------------------|----------|
| **Off** (default) | 0 | Strictest: what can you see right now, at this fixation? |
| **Limited (5)** | 5 | Simulates a quick scan: what do you know after ~5 glances? |
| **Extended (10)** | 10 | Longer exploration, approaching familiarity |
| **Infinite** | All | Cumulative reveal: shows how much of the page a thorough scan covers |

### When to use each

- **Off** for evaluating first-glance discoverability: "Can a user find this button without searching?"
- **Limited/Extended** for evaluating scan efficiency: "How many fixations until the user has oriented to the page structure?"
- **Infinite** for evaluating information coverage: "Even with unlimited viewing, are there regions that peripheral vision simply cannot resolve?"

### Inhibition of Return

There is also an **Inhibition of Return** mode (10 fixations, inverted: previously-fixated areas get *more* degradation). This is separated from the modes above because it serves a different purpose.

In real viewing, inhibition of return is an automatic oculomotor mechanism: the visual system suppresses re-fixation of recently attended locations, biasing the eyes toward novel regions. In an RFV session, visual memory already externalizes this function. The clarity trail shows where you've been, so revisiting is less likely.

IOR mode makes the cost of revisitation explicit by degrading previously-seen areas. Use it to evaluate how much a layout depends on re-reading: if a user needs to return to a region they already scanned, how much has been lost? Layouts that require frequent re-fixation (dense reference tables, forms with validation feedback far from the input) will feel especially punishing under IOR.

### Design dialogue prompt

Show stakeholders the page with Visual Memory set to Limited (5). Move the cursor through a plausible scan path (logo, headline, primary CTA, navigation). After 5 cursor positions, stop and ask: "Which important regions have become available, and which still require deliberate exploration?"

---

## 4. Comfort Mode

A strict 1-degree clear zone is anchored to the anatomical fovea but can feel punishingly small in an interactive review. In practice, microsaccades and small eye movements provide rapid access to nearby content beyond that region.

### What it does

**Simulation > Behavior > Comfort Mode (+1 degree clear zone)** extends the distortion-free region from 1 degree to approximately 2 degrees. This covers the microsaccade envelope, the zone that microsaccades and small saccades can reach within tens of milliseconds. These movements still carry brief suppression of visual sensitivity (Zuber & Stark 1966; Hafed & Krauzlis 2010), but the access cost is low.

When active, a subtle dashed ring appears at the original 1 degree fovea boundary, marking the anatomical fovea within the larger clear zone.

### The science

| Zone | Radius | Access cost | Movement type |
|------|--------|-------------|---------------|
| Foveola | 0-0.5 deg | Zero | Already resolved |
| Fovea | 0.5-1 deg | Near-zero | Microsaccades (10-30ms, brief microsaccadic suppression) |
| Comfort zone | 1-2 deg | Very low | Small saccades (20-30ms, brief suppression) |
| Parafovea | 2-5 deg | Moderate | Voluntary saccades (planning + suppression) |

The ~2 degree boundary is a working convention (see [Comfort Zone Research](../comfort-zone-research.md)). It is not a physiological threshold. Within it, content is reachable with movements lasting tens of milliseconds. Beyond 2 degrees, saccade planning and saccadic suppression add a cost. The user must decide to look there, and they briefly lose vision during the movement.

### When to use it

- **Comfort Mode OFF** (strict 1 deg): Research, validation, measuring worst-case peripheral discoverability
- **Comfort Mode ON** (+1 deg): Design review sessions, collaborative walkthroughs, stakeholder presentations

The question for strict mode is "What can the anatomical fovea resolve?" For Comfort Mode it is the more practical "What can a user comfortably access from this fixation point without real effort?"

For most design dialogue, Comfort Mode is a less restrictive working condition. It approximates rapid access around the current location while retaining meaningful degradation farther away. Use the same setting across comparable sessions and report whether it was enabled.

---

## 5. A Typical RFV Session

### Setup
1. Open the target page in Scrutinizer
2. Turn on the effect (Cmd+E)
3. Enable **Comfort Mode** (for design review) or leave it off (for strict evaluation)
4. Set Visual Memory to **Limited (5 fixations)**

### First pass: orientation scan
Move the cursor through a plausible first-pass path. For a left-to-right interface, one option is to begin near the top-left, then move through the headline and major layout regions. After 5 cursor positions, stop. This is a reviewer-driven walkthrough. It is not a recorded participant scanpath.

Ask: What do you know about this page? What is it for? Where would you go next?

### Second pass: task completion
Set a task: "Find the pricing page" or "Sign up for a trial." Move the cursor deliberately. Count fixations. Note where you get stuck, where the layout doesn't guide you to the next fixation target.

### Third pass: peripheral audit
Turn Visual Memory to **Off**. Park the cursor on the primary content area. Without moving it, evaluate: What can you see in the periphery? Can you read navigation labels? Can you tell that a sidebar exists? Is the page footer discoverable?

### Discussion points
- Regions that require many fixations to discover have poor peripheral salience
- Content that is invisible at moderate eccentricity (2-5 deg) needs stronger visual differentiation
- Dense text regions that become unreadable at small eccentricities may need layout intervention (spacing, grouping, contrast)

---

## 6. Interpreting What You See

### What peripheral degradation means for design

| What you see | What it means | Design response |
|-------------|---------------|-----------------|
| Element invisible at 3-5 deg | Low peripheral salience: users may not notice it without directed search | Increase size, contrast, or spacing; consider motion or color distinction |
| Text unreadable at 2-3 deg | Normal: text requires foveal resolution | Not a bug unless the text needs to be scannable (nav labels, headings) |
| Button blends into background at 5 deg | Low figure-ground separation in periphery | Increase contrast ratio, add border or shadow, increase padding |
| Two elements look identical at 5 deg | Crowding: peripheral vision pools nearby features | Increase spacing between elements, differentiate by color or size |
| Page structure unclear after 5 fixations | Poor visual hierarchy: no strong landmarks guide the scan | Strengthen heading/section contrast, add whitespace between regions |

### Reading span and text evaluation

When evaluating text-heavy pages, keep in mind that reading uses a different spatial strategy than scene viewing. The perceptual span during reading extends ~14-15 characters to the right of fixation (~5 degrees) but only 3-4 characters to the left (McConkie & Rayner 1975, 1976; reviewed by Rayner 1998). Within this span, useful letter information comes from about 7-8 characters on each side (~2 degrees), the *visual span* (Legge et al. 2007).

Forward reading saccades average ~7-9 characters (~2 degrees), meaning readers move through text in roughly foveal-width steps. In an RFV evaluation, a label that cannot be resolved from a nearby chosen fixation would require another viewing location under the model. Treat that as a discoverability hypothesis to investigate with participants. It does not show where their eyes will move.

Scrutinizer has a **Reading Span** overlay (**Simulation > Behavior > Reading Span**) that visualizes this asymmetric perceptual window.

### What Scrutinizer does NOT simulate

- **Attention and expectation:** real users have goals and experience that guide their eyes. Scrutinizer renders a model of the sensory input. It does not model how users interpret it.
- **Familiarity:** returning users may know where things are. Scrutinizer does not model an individual's learned layout knowledge.
- **Attention capture from motion:** live pages can contain animation and video, but the RFV model does not establish how strongly those events attract a participant's attention.
- **Measured gaze:** cursor position is a controlled proxy selected by the user unless an external gaze source is explicitly connected.

For moderated participant sessions and reproducible task setup, continue with the [Usability-Testing Practitioner Guide](usability-testing-practitioner-guide.md).

---

## Further Reading

- [Foveated Vision Model](../foveated-vision-model.md): full biological model behind the rendering pipeline
- [Comfort Zone Research](../comfort-zone-research.md): microsaccade envelope science
- [Foveal Calibration Logic](../foveal-calibration-logic.md): psychophysics behind the calibration tool
- [Blueprint Case Study](blueprint_case_study.md): alternative visualization mode for design reviews
- [Feature Congestion](https://andyed.github.io/scrutinizer-www/blog/congestion-score.html): quantitative clutter scoring

### References

- Jansen, Blackwell & Marriott (2003). A tool for tracking visual attention: The Restricted Focus Viewer. *Behavior Research Methods, Instruments, & Computers*.
- McConkie & Rayner (1975). The span of the effective stimulus during a fixation in reading. *Perception & Psychophysics*, 17(6), 578–586.
- McConkie & Rayner (1976). Asymmetry of the perceptual span in reading. *Bulletin of the Psychonomic Society*, 8, 365–368.
- Rayner (1998). Eye movements in reading and information processing. *Psychological Bulletin*.
- Legge, Cheung, Yu, Chung, Lee & Owens (2007). The case for the visual span as a sensory bottleneck in reading. *Journal of Vision*.
- Sperling (1960). The information available in brief visual presentations. *Psychological Monographs*, 74(11).
- Irwin (1991). Information integration across saccadic eye movements. *Cognitive Psychology*, 23(3), 420–456.
- Zuber & Stark (1966). Saccadic suppression: Elevation of visual threshold associated with saccadic eye movements. *Experimental Neurology*, 16(1), 65–79.
- Hafed & Krauzlis (2010). Microsaccadic suppression of visual bursts in the primate superior colliculus. *Journal of Neuroscience*, 30(28), 9542–9547.
- Rolfs (2009). Microsaccades: Small steps on a long way. *Vision Research*.
- Rosenholtz, Li & Nakano (2007). Measuring visual clutter. *Journal of Vision*.
- Ball & Owsley (1993). The useful field of view test: A new technique for evaluating age-related declines in visual function. *Journal of the American Optometric Association*, 64(1), 71–79.
