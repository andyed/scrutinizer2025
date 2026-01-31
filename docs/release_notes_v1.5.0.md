# Scrutinizer v1.5.0 Release Notes

**Release Date:** January 30, 2026

## 🚀 Major Release: Mobile & Simulation Overhaul
This release represents a significant milestone, combining powerful new **Mobile Emulation** capabilities with a major overhaul of the **Simulation Engine** (formerly scheduled for v1.4). It also introduces new tools specifically for **Academic Research**.

---

## 📱 Mobile Emulation Mode
We've added a powerful new **Mobile Emulation** feature (accessible via `View > Mobile Emulation`). 
- **Device Profiles**: Instantly toggle between common mobile viewports including:
  - **iPhone 14 Pro** (390x844) / **Pro Max** (430x932)
  - **Pixel 7 Pro** (412x915) / **Galaxy S23 Ultra** (412x915)
  - **iPad Air** Landscape (1180x820) / Portrait (820x1180)
- **High-DPI Simulation**: All profiles use appropriate device scale factors (2x-3.5x).
- **User Agent Override**: Automatically switches the User Agent to a mobile Safari string, ensuring responsive sites load their mobile views.
- **Window Locking**: The window automatically resizes and locks to the phone's aspect ratio to prevent accidental resizing during testing.
- **Touch Simulation (Alpha)**: Hold `Option` (Alt) + Click to simulate genuine touch events.

![Mobile Emulation Example](../tests/golden-captures/v1.5.0/article_center_iphone14.png)

## 🧠 Simulation Engine Upgrades
Biological accuracy has been significantly improved with new rendering techniques:

### 🌈 Oklab Saliency
The feature extraction engine now utilizes the **Oklab** color space instead of RGB.
- **Why?**: Oklab is perceptually uniform and separates Lightness (L) from Color (a, b), perfectly mimicking the eye's Magnocellular (Luminance) and Parvocellular (Color) pathways.
- **Result**: More stable, biologically readable saliency maps.

### 🌫️ MIP-Based Peripheral Pooling (Mongrel Tier 1)
Replaced the previous 5-tap Gaussian blur with **hardware MIP-map pooling**.
- **Accuracy**: Simulates the way receptive field sizes double with eccentricity (Rosenholtz et al.), creating a more realistic loss of peripheral detail than simple blur.
- **Performance**: **5x faster** rendering using hardware acceleration.

### 🚫 Inhibition of Return
A new Visual Memory mode (`Visual Memory > Inhibition of Return`) that simulates the brain's tendency to de-prioritize recently visited locations, encouraging exploration of new areas.

## 🎓 Academic Research Tools

### Citation-Ready Image Exports
Golden capture screenshots (and exported PNGs) now include **embedded metadata** for academic reproducibility. Data includes:
- Scrutinizer Version & Mode Configuration
- Foveal Radius, Intensity, and Settings
- Citation String (e.g., `Scrutinizer v1.5.0, Blueprint Mode`)
- *Extract using `exiftool` or the included node utility.*

### Declarative Mode Registry
Aesthetic modes are now centrally defined in `shared/modes.json`, making it easier for researchers to add, modify, and share custom simulation parameters without diving into the codebase.

## 🛠️ UI & Architecture
- **Responsive Toolbar**: Redesigned to support narrow mobile viewports; features a compact URL button and dedicated address dialog.
- **Visual Overlay 2.0**: The debug grid has been refined with linear spacing and variable stroke width for better visibility.
- **Auto-Updates**: Scrutinizer now checks for updates on startup and notifies you of new releases.

## 🐛 Bug Fixes
- **Persistence**: Mobile emulation state is now saved accurately between sessions.
- **Window Management**: Fixed issues where window bounds were not restoring correctly after exiting mobile mode.
- **Startup Stability**: Fixed a crash on startup caused by uninitialized settings.
