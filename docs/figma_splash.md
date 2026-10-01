Built on the latest in the cognitive science of vision, Scrutinizer Pro uses a real-time visual simulation to test your UI against the fundamental biological limits of human perception. Stop guessing how users see your work.

🧠 Core Value Proposition: Test Visual Reality (The "Why")

Scrutinizer Pro is a real-time simulation powered by a custom WebGL fragment shader. We simulate constraints of the retina and visual cortex to help you optimize how humans navigate your design.

1. Optimize Visual Trajectories (Saccadic Planning)

Peripheral vision has low resolution and is prone to crowding, so finding an element away from the point of gaze often takes several fixations.

Spacing matters because objects crowd. Acuity falls with eccentricity (simulated with box sampling). Crowding is a separate limit: closely spaced peripheral elements jumble together (simulated as positional uncertainty with domain warping). Crowded elements are hard to identify, so users need more fixations to find them.

Use the Foveal Pointer to simulate a fixation point and confirm that your grouping and whitespace provide enough perceptual separation to allow the eye to land accurately.

2. Ensure Structural Hierarchy (Luminance Contrast)

Color guides visual search, but chromatic sensitivity falls off in the periphery, red-green faster than blue-yellow (Mullen & Kingdom, 2002).

Hierarchy therefore has to be structural. If your design relies on color, peripheral vision may not be able to discriminate and scan paths will be impaired.

Simulate the reduced color perception and view your design in a luminance-mostly world. Ensure your CTAs and visual hierarchy are maintained purely by contrast and size.

⚙️ Key Plugin Features & Controls (The "How")

Scrutinizer gives you developer-grade controls to fine-tune your analysis:

Real-Time Simulation (60fps): Apply the full visual model to any frame or element at 60 frames per second for immediate, interactive feedback.

Intuitive Controls: Adjust Fovea Size and Peripheral Blur intensity (Low, Medium, High) directly from the plugin toolbar.

Exportable Artifacts: Use the "Save to Canvas" feature to instantly bake the current simulated view into a new Figma frame. Perfect for design critiques, documentation, and handover to engineering.

Built on Research: Developed using principles of Engineering Psychology and detailed foveated vision models. A parallel open source browser project exists aimed at supporting research, https://github.com/andyed/scrutinizer2025