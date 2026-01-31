# Scrutinizer v1.5.0 Release Notes

**Release Date:** January 30, 2026

## 📱 Mobile Emulation Mode
We've added a powerful new **Mobile Emulation** feature (accessible via `View > Mobile Emulation`). 
- **Device Profiles**: Instantly toggle between common mobile viewports including:
  - **iPhone 14 Pro** (390x844) / **Pro Max** (430x932)
  - **Pixel 7 Pro** (412x915) / **Galaxy S23 Ultra** (412x915)
  - **iPad Air** Landscape (1180x820) / Portrait (820x1180)
- **High-DPI Simulation**: All profiles use appropriate device scale factors (2x-3.5x).
- **User Agent Override**: Automatically switches the User Agent to a mobile Safari string, ensuring responsive sites load their mobile views.
- **Window Locking**: The window automatically resizes and locks to the phone's aspect ratio to prevent accidental resizing during testing.

![Mobile Emulation Example](../tests/golden-captures/v1.5.0/article_center_iphone14.png)

## 👆 Touch Event Simulation (Alpha)
Testing touch interactions on the desktop is now easier.
- **Option + Click**: While in Mobile Emulation mode, holding the `Option` (Alt) key and clicking simulates a genuine `touchStart` -> `touchEnd` sequence.
- *Note: This is an experimental alpha feature designed to unblock basic touch testing.*

## 🛠️ Responsive Toolbar
The toolbar has been redesigned to support the narrower mobile viewport.
- **Compact URL Trigger**: The wide text input has been replaced with a compact button.
- **Dedicated URL Dialog**: Clicking the address bar now opens a dedicated popup window for entering URLs, improving usability on small screens.

## 🐛 Bug Fixes & Improvements
- **Persistence**: Mobile emulation state is now saved between sessions.
- **Window Management**: Fixed issues where window bounds were not restoring correctly after exiting mobile mode.
- **Startup Stability**: Fixed a crash on startup caused by uninitialized settings.
