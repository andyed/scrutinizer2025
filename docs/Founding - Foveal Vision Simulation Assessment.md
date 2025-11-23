

# **An Expert Assessment of Foveal and Peripheral Vision Simulation for Web Browser Environments**

This report provides a balanced and exhaustive assessment of employing gaze-contingent foveal and peripheral vision simulation within a web browser, specifically in the context of advanced tooling like scrutinizer2025. The methodology is analyzed based on its physiological fidelity, technical precedents (such as ViewSer), critical dependence on human factors calibration, and sufficiency for generating actionable design insights, drawing upon relevant psychophysical and neuroscientific literature.

## **I. The Physiological Imperative: Inhomogeneous Visual Processing and the Rationale for Simulation**

The foundational justification for simulating visual inhomogeneity rests upon the radical differences in resolution and processing capacity across the human visual field.

### **I.A. Defining the Regions of Human Visual Acuity and Acuity Decay**

Human vision is fundamentally constrained by the retinal structure, where only a minute portion of the visual field achieves high resolution. The fovea, the area of sharpest focus, is remarkably small, typically subtending only $1^{\\circ}$ to $2^{\\circ}$ of visual angle (dva).1 The central point of this region, the foveola, covers an even smaller area, approximately $1.3^{\\circ}$ dva.2 This central high-acuity region extends marginally into the parafovea, with central vision generally encompassing the range up to $4^{\\circ}$ or $5^{\\circ}$ dva.3

The critical phenomenon that validates the necessity of simulation is the rapid decline in visual acuity outside this central region. Acuity does not decay linearly but drops steeply, following an inverse-linear function defined by eccentricity ($E$).4 Specifically, acuity falls to half its maximum foveal value at just $2^{\\circ}$ of eccentricity.4 This steep decline is known as the eccentricity effect, where visual search performance (accuracy and speed) worsens rapidly as the target item moves further into the periphery.5 This deterioration is directly linked to the concentration of visual receptors; the fovea contains a high density of cones (responsible for detailed, color vision), while the periphery consists largely of rods, optimized for low light and motion, leading to decreased spatial acuity and reduced cortical magnification of peripheral stimuli.5

### **I.B. Dual Processing Pathways and Spatial Frequency Filtering (The Mechanism of Blur)**

Effective simulation must model the neurophysiological distinction between the two major visual pathways, the parvocellular (P) and magnocellular (M) pathways.6 The P pathway processes high spatial frequency information, governing detailed shape and color recognition, and dominates foveal processing. The M pathway, utilizing larger neurons, is sensitive to low spatial frequency information, motion, and gross luminance changes, making it critical for peripheral processing and attention guidance.6

The early "Icon Analysis" methodology demonstrated that successful design elements, particularly icons, must possess unique low spatial frequency compositions to ensure distinguishability in the periphery.6 When a user’s gaze (fixation point) jumps across a screen via rapid eye movements (saccades), most screen elements fall outside the sharp $1.5^{\\circ}$ field of focus and are processed by the M pathway at lower spatial frequencies.6 If an icon lacks a distinctive low-frequency component, it effectively disappears during visual search.6

This understanding dictates that the simulation’s peripheral masking must function specifically as a **low-pass spatial frequency filter**, rather than simple image blurring. Simple blurring risks removing the low spatial frequency contrast that the M-pathway relies upon for recognition and scene guidance, thereby creating a visual experience worse than natural peripheral vision.6 The success of peripheral search guidance depends inherently on the structurally preserved input of the Magnocellular pathway.3 Therefore, the simulation requires careful tuning to attenuate high spatial frequencies (P-pathway data) while preserving low spatial frequencies (M-pathway data), ensuring that while detailed information is impaired, the overall *gist* of the scene and the basic outline necessary for saccadic guidance remain viable.7

It is important to acknowledge that while the simulation accurately models the physical constraints on *retinal input*—what researchers call the "Blindspot" effect—it inherently fails to model the continuous *perceptual experience*. Modern research confirms that foveal and peripheral processing are not independent; the brain actively integrates signals across saccades and extrapolates high-resolution foveal information outward, generating a stable, homogeneous perceptual environment and reducing uncertainty.8 By presenting a constantly flickering, acuity-impaired periphery, the simulation necessarily overestimates the level of visual discontinuity perceived by the human user.

## **II. The Foundational Techniques: From ViewSer to Gaze-Contingent Web Systems**

The technical feasibility of gaze-contingent web simulation has been established in previous research, providing a clear lineage for current projects like scrutinizer2025.

### **II.A. The ViewSer Precedent and Implementation History**

The concept was validated through projects such as ViewSer, a critical tool for enabling large-scale, remote, crowd-sourced user studies, particularly focused on web search result examination (SERP analysis).9 ViewSer proved that gaze-contingent masking could be deployed successfully without specialized hardware.

ViewSer's technical strength derived from its optimized browser-native architecture, utilizing an SVG-based implementation.9 This approach offered significant advantages over earlier methods by eliminating the need for separate browser plugins or Java applications, thereby ensuring superior scalability, responsiveness, and precise tracking within the native browser Document Object Model (DOM) environment.9

However, the DOM architecture imposed a critical limitation: ViewSer was restricted to revealing or occluding only *complete HTML DOM elements*.9 This architecture prevented the implementation of psychophysically necessary techniques such as partial or gradual occlusion, requiring a sharp boundary between "seen" and "unseen" areas, a fidelity constraint that modern simulation must overcome.

### **II.B. Implementation Roadmap for Higher Fidelity in Scrutinizer2025**

To achieve the nuanced, non-linear acuity decay dictated by physiological reality 4, scrutinizer2025 must necessarily move beyond the element-level limitations of ViewSer.9 Achieving a smooth, Gaussian-like falloff of acuity requires pixel-level image manipulation, achievable through Canvas rendering or highly optimized CSS/SVG filters designed for gradient masking.

This technical requirement draws an analogy to selective rendering used in high-fidelity computer graphics, where systems like Radiance introduce a selective guidance process based on an *importance map* derived from the user’s fixation point.10 This process prioritizes computational resources to render high visual quality only where attention is focused, mirroring the biological prioritization of the fovea.

The core design choice for scrutinizer2025 involves balancing the high scalability achieved by ViewSer’s simple DOM approach with the demand for high psychophysical fidelity (gradual blurring). Pursuing maximum fidelity, which requires complex pixel manipulation, implies a need for rigorous performance monitoring, especially concerning the eye-movement-to-display-update latency, to avoid disrupting the user’s experience.11

### **II.C. Utility of Simulation for Usability Observers**

The utility of gaze-contingent simulation extends beyond raw data collection to qualitative observation and design evaluation. Simulators, particularly those modeling visual impairment, are proven tools for fostering observer empathy and increasing awareness of design barriers.12 By forcing designers to perceive the web environment under the constraints experienced by the user, the simulation provides critical qualitative insight that complements purely quantitative metrics derived from eye-tracking data (gaze patterns, fixations).14

This qualitative understanding is powerful; watching the simulation live, seeing the user's constrained visual field projected, is deemed nearly as effective as testing the simulation firsthand for generating empathy.13 This transition moves observers from merely knowing *where* a user looked to understanding *what* they were perceptually capable of processing at that moment.15

Furthermore, the simulation serves as an efficient design stress test. It is highly effective as a pre-screening tool for identifying minor design flaws, such as elements lacking sufficient low spatial frequency contrast or the placement of overly distracting peripheral elements.7 By identifying and correcting these bottom-up attention problems early, the simulation maximizes the efficiency of subsequent, more time-consuming and costly testing stages involving real users and specialized eye-tracking hardware.12

## **III. Human Factors and The Visual Angle Calibration Problem**

The accuracy of foveal and peripheral simulation is entirely dependent upon correctly establishing the observer’s visual angle, a metric highly susceptible to variance in user posture and device type.

### **III.A. The Fundamental Requirement: The Visual Angle Calculation**

The size of the foveal mask in pixels must accurately correspond to a constant physiological measure, typically $1.5^{\\circ}$ to $2.0^{\\circ}$ dva. The visual angle is the angle subtended by a screen element at the observer's eye and determines the size of the image projected onto the retina.16

The conversion from pixels to visual degrees is calculated using the monitor’s physical properties (height $h$ and vertical resolution $r$) and the critical variable: the distance ($d$) between the observer and the screen.17 The formula used for this conversion means that the degrees-per-pixel factor is extremely sensitive to changes in $d$. Without an accurate measure of $d$, the simulation is geometrically flawed, leading to an incorrect representation of the physiological constraint.

### **III.B. Ergonomic Variance and Distance Sensitivity**

Ergonomic recommendations for desktop usage typically place the optimal viewing distance between 50 and 76 centimeters (20–30 inches) 18, with $d \\approx 60 cm$ often serving as the experimental standard.17

However, modern casual computing introduces radical variability. Casual laptop use often forces users closer to the screen than the optimal arm’s length, and mobile device usage involves significantly shorter distances, potentially 20–30 cm.20 This variance in $d$ fundamentally alters the required pixel size of the foveal mask. A physiological $2^{\\circ}$ fovea will occupy a dramatically smaller area in pixels on a screen viewed from 30 cm than one viewed from 75 cm.

The following table illustrates the extreme sensitivity of the necessary mask size (in pixels) for a constant $2.0^{\\circ}$ visual angle across typical viewing scenarios, highlighting the need for accurate distance calibration.

Simulated Foveal Diameter ($2.0^{\\circ}$ dva) in Pixels Across Typical Viewing Scenarios

| Device/Scenario | Typical Viewing Distance (d) | Assumed Monitor Height (h) | Assumed Vertical Resolution (r) | Calculated 2.0∘ dva Diameter (Pixels) |
| :---- | :---- | :---- | :---- | :---- |
| Desktop (Ergonomic) | 75 cm | 30 cm | 1440 px | $\\approx 78$ pixels |
| Desktop (Standard) | 60 cm | 30 cm | 1440 px | $\\approx 63$ pixels |
| Casual Laptop Use | 40 cm | 18 cm | 900 px | $\\approx 45$ pixels |
| Mobile Handheld (Reading) | 30 cm | 12 cm | 1920 px | $\\approx 31$ pixels |

### **III.C. The Psychophysical Complication of Perceived Spatial Frequency**

Beyond simple geometric scaling, the accuracy of the simulation is challenged by the complex way distance influences the *perception* of blur. The overall visibility of spatial structure cannot be modeled solely by calculating simple retinal frequencies.21

Psychophysical studies indicate that observers perceive spatial frequencies differently based on viewing distance. To match the perceived clarity of a closer image, a distant object must possess a *higher* physical spatial frequency.21 Conversely, if the simulation incorrectly assumes a user is viewing from 60 cm when they are actually at 30 cm, the simulated blur applied to the periphery might be perceptually far less severe than intended, even if the mask radius is geometrically correct in pixels.22

The necessity of calibration cannot be overstated. Since the visual angle is highly sensitive to distance, results generated without an accurately measured $d$ are psychophysically invalid. A failure to acquire $d$ could lead to a $2^{\\circ}$ fovea being incorrectly simulated as $0.8^{\\circ}$ or $4^{\\circ}$, fundamentally misrepresenting the visual constraint. This suggests that advanced simulation may require not only scaling the mask radius but also dynamically adjusting the contrast or spatial frequency filtering applied to the periphery to account for how distance changes the perception of blur quality.22

## **IV. A Balanced Assessment: Sufficiency, Accuracy, and Fidelity Limitations**

A critical evaluation of foveal simulation requires balancing its established utility for stress-testing design (sufficiency) against its intrinsic physiological measurement limitations (accuracy).

### **IV.A. Peripheral Sufficiency: Validation of Guidance Function**

The primary value of the simulation is its ability to test the efficiency of peripheral search guidance. Research confirms that the periphery is crucial for generating the "gist" of a scene and providing guidance for the subsequent saccades.7

Gaze-contingent masking experiments (like those reviewed from Nuthmann, 2014\) provide robust evidence validating this approach. Artificially impairing the high-resolution capacity of central vision through a "Blindspot" mask up to a $4.1^{\\circ}$ radius demonstrated that the initial stages of visual search and target localization remained surprisingly unimpaired.11 Foveal vision was not strictly necessary to attain normal target localization performance in many scene search tasks.3

This observation strongly validates the simulation as a design stress test. If a website layout or a key navigational icon fails to guide the user's attention efficiently under a $2^{\\circ}$ or $4^{\\circ}$ mask, it definitively indicates that the design elements lack the necessary distinctive low spatial frequency components required for efficient peripheral detection.3

However, this sufficiency is task-dependent. While peripheral vision facilitates efficient *guidance* (rapid search and localization), the research also revealed that when high-resolution information was withheld up to $4.1^{\\circ}$, it took significantly *longer to verify the identity* of the target.23 The simulation is thus ideally suited for optimizing high-level layout, navigation, and visual flow, where efficient saccadic planning is paramount. It is less reliable for testing tasks that require detailed verification or deep content comprehension, where the duration of the fixation and the P-pathway’s high-resolution input are critical.25

### **IV.B. Accuracy Critique: Biometry and Perceptual Integration**

The simulation must contend with two significant accuracy limitations rooted in the human visual system and current technology.

1. **Ignoring Perceptual Integration:** The method cannot replicate the cognitive processes that underpin stable vision. The human brain continuously integrates peripheral and foveal signals across saccades (transsaccadic integration), averaging percepts and actively extrapolating foveal information to create a subjectively stable and continuous visual environment.8 This perceptual stability is lost in the rapidly shifting, acuity-constrained view presented by a real-time mask.  
2. **Biometric Variability:** Even with perfect viewing distance calibration, the accuracy of gaze estimation across a population introduces significant error. Research using high-complexity stochastic eye models to simulate real-world eye-tracking outcomes confirmed that interpersonal variations in eye biometry, specifically anterior corneal asphericity, significantly influence gaze estimation algorithms.26 These biometric variations can lead to errors in gaze estimation as large as $0.7^{\\circ}$ up to $2^{\\circ}$ between participants.26

This measurement error directly rivals the size of the feature being simulated; the fovea is only $1^{\\circ}$ to $2^{\\circ}$ wide.1 An unmodeled $2^{\\circ}$ error means that the computed center of the "foveal" mask could be displaced entirely outside the user's true highest-acuity region. Therefore, claims of absolute, high-precision physiological accuracy are unobtainable without impractical user-specific biometric calibration. The simulation is best utilized as an **approximation model of visual constraint**, designed to test design robustness against general visual inhomogeneity, rather than a precision instrument for physiological mapping.

### **IV.C. Fidelity of Transition: Gradual Decay**

To maximize psychophysical fidelity, scrutinizer2025 must adopt advanced masking techniques that implement a gradual acuity decay. Moving beyond ViewSer’s sharp, DOM-level cutoffs 9 to a smoothly varying "Spotlight" effect aligns with best practices established in gaze-contingent experiments 23 and visual attention modeling.10 This gradual transition is essential because visual selective attention, which governs search performance, involves top-down cognitive processes, including recurrent activity in cortical regions like the posterior parietal cortex, not merely the attenuation of sensory input at the retina.27 A simulation only addressing sensory input remains fundamentally incomplete without modeling these top-down factors.

## **V. Practical Utility, Conclusions, and Future Research Roadmap for Scrutinizer2025**

### **V.A. Summary of Utility and Complementary Roles**

Gaze-contingent simulation occupies a unique and valuable niche in the HCI research toolkit. It serves as a necessary bridge between quantitative metrics gathered by eye-tracking technology (gaze patterns, fixations, speed) 14 and the essential qualitative understanding of the user’s constrained perceptual experience.15 Its strength lies in stress-testing bottom-up attention, ensuring high-priority design elements are detectable and discriminable via their low spatial frequency composition, even in the absence of sharp focus.6

However, the transferability of skills and insights gained in simulated environments to the real world is an open area of research.25 Because the simulation fails to capture the transsaccadic integration that stabilizes natural perception 8, designers must be careful not to over-engineer peripheral contrast based on the exaggerated difficulty experienced in the simulation. Findings from the simulation must be complemented by real-world user validation to ensure that optimization for the simulated constraint does not lead to unnecessary clutter or visual noise in a real-world interface. Finally, as with all eye-tracking methodologies, developers must be cognizant of the fact that unique gaze behaviors can be leveraged for non-intrusive authentication or individual recognition, a security consideration relevant as eye-tracking technology becomes ubiquitous.25

### **V.B. Recommendations for Mitigating Human Factors Variability**

To enhance the psychophysical validity of scrutinizer2025, the following technical and procedural requirements are recommended:

1. **Mandatory Calibration Module:** Due to the extreme sensitivity of visual angle calculations to viewing distance, a simple user-guided calibration step is essential.17 This module should require the user to input the physical monitor dimensions and a measured or estimated viewing distance ($d$). Results generated without this calibrated input should be explicitly flagged with a low-confidence warning regarding their physiological accuracy.  
2. **Psychophysically Tuned Filters:** The system should implement advanced rendering techniques (e.g., multi-channel image filtering 27) to model the non-linear, gradual acuity decay, moving beyond simple binary occlusion. The spatial frequency filtering parameters must be calibrated against the known hyperbolic decay function 4 and potentially adjusted based on distance to account for the perceived spatial frequency shifts.21  
3. **Future Work in Distance Estimation:** Future iterations should explore non-invasive methods for dynamic distance estimation (e.g., computer vision algorithms leveraging known screen size) to reduce reliance on subjective user input and automatically update the viewing distance parameter ($d$) in real-time.

### **V.C. Conclusion on Simulation Validity**

The simulation of foveal versus peripheral vision in a web browser is a robust and highly valuable technique, essential for optimizing visual search efficiency and providing powerful qualitative insights for HCI practitioners. Its efficacy is supported by the proven success of ViewSer 9 and psychophysical evidence confirming the sufficiency of peripheral vision for guiding attention and target localization.3

However, the technique’s greatest weakness lies in its claim to absolute physiological accuracy. The simulation cannot replicate the cognitive processes of transsaccadic perceptual integration 8, and its output is highly susceptible to unmodeled variances in user biomechanics and, most critically, the uncalibrated viewing distance ($d$).17 Given that measurement errors can approach the size of the fovea itself, scrutinizer2025 should be positioned as an indispensable, efficient **design constraint model** that maximizes the effectiveness of subsequent, high-fidelity user research, provided a rigorous calibration protocol is enforced.

#### **Works cited**

1. accessed November 22, 2025, [https://www.researchgate.net/figure/A-The-human-eye-and-its-visual-axis-The-fovea-1-to-2-of-visual-angle-contains-high\_fig3\_270004107\#:\~:text=The%20fovea%20(1%C2%B0%20to%202%C2%B0%20of%20visual%20angle,peripheral%20limit%20of%20the%20retina.](https://www.researchgate.net/figure/A-The-human-eye-and-its-visual-axis-The-fovea-1-to-2-of-visual-angle-contains-high_fig3_270004107#:~:text=The%20fovea%20\(1%C2%B0%20to%202%C2%B0%20of%20visual%20angle,peripheral%20limit%20of%20the%20retina.)  
2. Foveal vision anticipates defining features of eye movement targets \- PMC \- PubMed Central, accessed November 22, 2025, [https://pmc.ncbi.nlm.nih.gov/articles/PMC9581528/](https://pmc.ncbi.nlm.nih.gov/articles/PMC9581528/)  
3. Visual search in naturalistic scenes from foveal to peripheral vision: A comparison between dynamic and static displays, accessed November 22, 2025, [https://jov.arvojournals.org/article.aspx?articleid=2778288](https://jov.arvojournals.org/article.aspx?articleid=2778288)  
4. Visual acuity \- Wikipedia, accessed November 22, 2025, [https://en.wikipedia.org/wiki/Visual\_acuity](https://en.wikipedia.org/wiki/Visual_acuity)  
5. Eccentricity effect \- Wikipedia, accessed November 22, 2025, [https://en.wikipedia.org/wiki/Eccentricity\_effect](https://en.wikipedia.org/wiki/Eccentricity_effect)  
6. Icon Analysis \- Boxes and Arrows, accessed November 22, 2025, [https://boxesandarrows.com/icon-analysis/](https://boxesandarrows.com/icon-analysis/)  
7. Peripheral Vision Drives User Attention \- Progress Software, accessed November 22, 2025, [https://www.progress.com/blogs/the-surprising-potential-of-peripheral-vision-in-driving-user-attention](https://www.progress.com/blogs/the-surprising-potential-of-peripheral-vision-in-driving-user-attention)  
8. A review of interactions between peripheral and foveal vision \- PMC \- PubMed Central, accessed November 22, 2025, [https://pmc.ncbi.nlm.nih.gov/articles/PMC7645222/](https://pmc.ncbi.nlm.nih.gov/articles/PMC7645222/)  
9. (PDF) ViewSer: enabling large-scale remote user studies of web search examination and interaction \- ResearchGate, accessed November 22, 2025, [https://www.researchgate.net/publication/221300903\_ViewSer\_enabling\_large-scale\_remote\_user\_studies\_of\_web\_search\_examination\_and\_interaction](https://www.researchgate.net/publication/221300903_ViewSer_enabling_large-scale_remote_user_studies_of_web_search_examination_and_interaction)  
10. (PDF) Visual attention for efficient high-fidelity graphics \- ResearchGate, accessed November 22, 2025, [https://www.researchgate.net/publication/239066927\_Visual\_attention\_for\_efficient\_high-fidelity\_graphics](https://www.researchgate.net/publication/239066927_Visual_attention_for_efficient_high-fidelity_graphics)  
11. The importance of peripheral vision when searching 3D real-world scenes: A gaze-contingent study in virtual reality, accessed November 22, 2025, [https://pmc.ncbi.nlm.nih.gov/articles/PMC8287039/](https://pmc.ncbi.nlm.nih.gov/articles/PMC8287039/)  
12. VIP-Sim: A User-Centered Approach to Vision Impairment Simulation for Accessible Design, accessed November 22, 2025, [https://arxiv.org/html/2507.10479v1](https://arxiv.org/html/2507.10479v1)  
13. Exploring the Educational Value and Impact of Vision-Impairment Simulations on Sympathy and Empathy with XREye \- MDPI, accessed November 22, 2025, [https://www.mdpi.com/2414-4088/7/7/70](https://www.mdpi.com/2414-4088/7/7/70)  
14. Empirical Insights into Eye-Tracking for Design Evaluation \- MDPI, accessed November 22, 2025, [https://www.mdpi.com/2076-328X/14/12/1231](https://www.mdpi.com/2076-328X/14/12/1231)  
15. Comparing the Visual Perception According to the Performance Using the Eye-Tracking Technology in High-Fidelity Simulation Settings \- PubMed Central, accessed November 22, 2025, [https://pmc.ncbi.nlm.nih.gov/articles/PMC7998119/](https://pmc.ncbi.nlm.nih.gov/articles/PMC7998119/)  
16. Visual Angle Calculator, accessed November 22, 2025, [https://elvers.us/perception/visualAngle/](https://elvers.us/perception/visualAngle/)  
17. Degrees of visual angle \- OpenSesame \- Cogsci.nl, accessed November 22, 2025, [https://osdoc.cogsci.nl/3.2/visualangle/](https://osdoc.cogsci.nl/3.2/visualangle/)  
18. How to Find Perfect Monitor Distance from Eyes and Neck | BenQ US, accessed November 22, 2025, [https://www.benq.com/en-us/knowledge-center/knowledge/how-to-find-your-perfect-screen-distance.html](https://www.benq.com/en-us/knowledge-center/knowledge/how-to-find-your-perfect-screen-distance.html)  
19. How Far Should Your Screen Be? Recommended Distances Explored | Zenni Optical Blog, accessed November 22, 2025, [https://www.zennioptical.com/blog/recommended-screen-distances/](https://www.zennioptical.com/blog/recommended-screen-distances/)  
20. What's the Correct Distance to Sit from a Screen for Eye Safety? \- Slouch, accessed November 22, 2025, [https://slouchonline.com/how-far-away-should-the-screen-be-from-your-eyes/](https://slouchonline.com/how-far-away-should-the-screen-be-from-your-eyes/)  
21. Size Matters: The Influence of Viewing Distance on Perceived Spatial Frequency and Contrast \- IS\&T | Library, accessed November 22, 2025, [https://library.imaging.org/admin/apis/public/api/ist/website/downloadArticle/cic/13/1/art00065](https://library.imaging.org/admin/apis/public/api/ist/website/downloadArticle/cic/13/1/art00065)  
22. Test of a model of foveal vision by using simulations \- Optica Publishing Group, accessed November 22, 2025, [https://opg.optica.org/fulltext.cfm?uri=josaa-13-6-1131](https://opg.optica.org/fulltext.cfm?uri=josaa-13-6-1131)  
23. How do the regions of the visual field contribute to object search in real-world scenes? Evidence from eye movements \- PubMed, accessed November 22, 2025, [https://pubmed.ncbi.nlm.nih.gov/23937216/](https://pubmed.ncbi.nlm.nih.gov/23937216/)  
24. Visual search in naturalistic scenes from foveal to peripheral vision: A comparison between dynamic and static displays \- PubMed Central, accessed November 22, 2025, [https://pmc.ncbi.nlm.nih.gov/articles/PMC8802022/](https://pmc.ncbi.nlm.nih.gov/articles/PMC8802022/)  
25. Eye Tracking in Virtual Reality: a Broad Review of Applications and Challenges \- PMC, accessed November 22, 2025, [https://pmc.ncbi.nlm.nih.gov/articles/PMC10449001/](https://pmc.ncbi.nlm.nih.gov/articles/PMC10449001/)  
26. The influence of eye model parameter variations on simulated eye-tracking outcomes \- PMC, accessed November 22, 2025, [https://pmc.ncbi.nlm.nih.gov/articles/PMC10730094/](https://pmc.ncbi.nlm.nih.gov/articles/PMC10730094/)  
27. Simulating the role of visual selective attention during the development of perceptual completion \- PMC \- PubMed Central, accessed November 22, 2025, [https://pmc.ncbi.nlm.nih.gov/articles/PMC4101467/](https://pmc.ncbi.nlm.nih.gov/articles/PMC4101467/)