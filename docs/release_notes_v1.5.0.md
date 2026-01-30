# Scrutinizer v1.5.0 Release Notes

**Release Date:** January 30, 2026

## 📱 Mobile Emulation Mode
We've added a powerful new **Mobile Emulation** feature (accessible via `View > Mobile Emulation`). 
- **iPhone Simulation**: Instantly toggles the viewport to iPhone dimensions (390x844) with a 3x device scale factor.
- **User Agent Override**: Automatically switches the User Agent to a mobile Safari string, ensuring responsive sites load their mobile views.
- **Window Locking**: The window automatically resizes and locks to the phone's aspect ratio to prevent accidental resizing during testing.

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
