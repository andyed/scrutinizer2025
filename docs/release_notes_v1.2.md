# Scrutinizer v1.2 Release Notes

**"The Saliency & Stability Update"**

This release focuses on major architectural improvements to performance and biological fidelity, alongside significant usability enhancements with the new Browser Toolbar.

## 🚀 Major Features

### Browser Toolbar
A fully functional browser toolbar has been added to the top of the window, providing standard navigation controls and improved state visibility.
*   **Navigation**: Back, Forward, Reload, and Home buttons.
*   **URL Bar**: Displays current URL and allows navigation to new sites.
*   **Fovea Toggle**: A dedicated eye icon button to toggle the foveal effect on/off.
    *   **Loading State**: The eye icon pulses blue/grey to indicate page loading status.
*   **Architecture**: Implemented as a separate `WebContentsView` to ensure robust input handling independent of the web content.

### Redesigned App Menu
The application menu has been completely reorganized for better discoverability and ease of use.
*   **Simulation Menu**: Centralized hub for all visual effects.
*   **Grouped Controls**: Settings are now logically grouped into **Foveal**, **Peripheral**, **Behavior**, and **Content Analysis**.
*   **Direct Access**: Quick access to critical toggles like "Mongrel Mode" and "Aesthetic Mode".

### Saliency Map & Web Worker
We've introduced a biologically-inspired **Saliency Map** to model bottom-up visual attention, now powered by a multi-threaded architecture.
*   **View Saliency Map**: New debug option to visualize the underlying saliency heatmap in real-time. See exactly which parts of the page are grabbing attention.
*   **Web Worker Offloading**: Saliency computation (pixel-level color analysis) has been moved to a dedicated Web Worker (`saliency-worker.js`). This eliminates UI stutter during slow mouse movements by unblocking the main thread.
*   **Saccadic Suppression**: Implemented a velocity-based optimization that skips heavy processing during rapid eye movements (saccades), mimicking the biological phenomenon of saccadic masking. This ensures the fovea remains responsive even during fast flicks.

### Visual Memory Refinements
The visual memory system has been tuned for greater realism and usability.
*   **Infinite Mode**: Now truly infinite, allowing you to "paint" the screen clear without decay.
*   **Dwell-Time Persistence**: Memory accumulation is now proportional to dwell time—longer fixations create more lasting clarity.
*   **Mask Visualization**: Added a new Debug Mode (3) to visualize the visual memory mask buffer.

## 🧠 Biological Simulation

*   **Rod Vision Aesthetic**: Implemented a true **Scotopic (Lab Mode)** aesthetic. It now correctly simulates rod vision characteristics:
    *   **Monochromatic Tint**: Cyan-blue shift.
    *   **Contrast Sensitivity**: Enhanced contrast in low-light conditions.
    *   **Film Grain**: Simulates neural noise in low-light signal processing.
*   **Parafoveal Accuracy**: Corrected the parafoveal boundary to **2.5x** the foveal radius (approx. 5° visual angle), aligning with biological macula dimensions.
*   **Eccentricity Scaling**: Distortion strength is now scaled based on eccentricity, preserving more geometric cues in the parafovea while maintaining crowding effects in the far periphery.

## 🛠️ Engineering & Quality

### "Golden Image" Testing Framework
We've established a robust visual regression testing pipeline to prevent "AI Hubris" and accidental regressions.
*   **Golden Images**: A set of reference screenshots (`tests/golden/`) defines the "correct" visual output.
*   **Automated Verification**: `npm test` now compares current output against these golden images.
*   **Parameterized Testing**: Integration tests can now be parameterized via environment variables (e.g., `TEST_URL`, `TEST_MODES`).

### Fixes & Improvements
*   **Screenshot Compatibility**: Fixed an issue where `Cmd+Shift+4` on macOS would cause the fovea to chase the crosshair. The fovea now pauses when modifier keys are held.
*   **Radius Persistence**: Fixed a bug where the "Large" (180px) fovea radius would reset to "Extra Large" (300px) on relaunch.
*   **Color Accuracy**: Fixed sRGB texture format issues to ensure accurate color rendering.
*   **High-Key Mode**: Fixed black level crushing in the High-Key Ghosting mode.

## 🔮 Upcoming Roadmap
*   **Windows Support**: Active development is underway to resolve build and launch issues on Windows.
*   **Marketing Site**: Launching the public landing page at [scrutinizer.app](https://scrutinizer.app) to showcase the tool, link documentation, and host future product updates.
