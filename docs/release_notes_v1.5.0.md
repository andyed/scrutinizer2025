# Scrutinizer v1.5.0 Release Notes

**Release Date:** January 30, 2026

## 🚀 Major Release: Mobile Emulation & Academic Research Tools
This release is a significant milestone, combining new **Mobile Emulation** capabilities with new tools for **Academic Research**.

---

## 📱 Mobile Emulation Mode
We've added a new **Mobile Emulation** feature (accessible via `View > Mobile Emulation`). 
- **Device Profiles**: Instantly toggle between common mobile viewports including:
  - **iPhone 14 Pro** (390x844) / **Pro Max** (430x932)
  - **Pixel 7 Pro** (412x915) / **Galaxy S23 Ultra** (412x915)
  - **iPad Air** Landscape (1180x820) / Portrait (820x1180)
- **High-DPI Simulation**: All profiles use appropriate device scale factors (2x-3.5x).
- **User Agent Override**: Automatically switches the User Agent to a mobile Safari string, ensuring responsive sites load their mobile views.
- **Window Locking**: The window automatically resizes and locks to the phone's aspect ratio to prevent accidental resizing during testing.
- **Touch Simulation (Alpha)**: Hold `Option` (Alt) + Click to simulate touch events.

![Mobile Emulation Example](https://raw.githubusercontent.com/andyed/scrutinizer2025/v1.5.0/tests/golden-captures/v1.5.0/article_center_iphone14.png)

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
- **Visual Overlay 2.0**: The debug grid has been refined with linear spacing and variable stroke width for better visibility (from v1.4.0).
- **Auto-Updates**: Scrutinizer now checks for updates on startup and notifies you of new releases (from v1.4.0).
- **Version Display**: Current version is now visible on the splash screen and toolbar (from v1.4.4).

## 🐛 Bug Fixes
- **Persistence**: Mobile emulation state is now saved accurately between sessions.
- **Window Management**: Fixed issues where window bounds were not restoring correctly after exiting mobile mode.
- **Startup Stability**: Fixed a crash on startup caused by uninitialized settings.
