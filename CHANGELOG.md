# Changelog

## [1.5.0] - 2026-01-30

### Added
- **Mobile Emulation**: New "Mobile Emulation" submenu in View menu.
    - Simulates iPhone viewport (390x844), scale factor (3.0), and User Agent.
    - Automatically resizes and locks window to phone dimensions.
    - Restores previous window size and desktop mode when disabled.
- **Touch Simulation**: Added support for synthesizing touch events.
    - Hold `Option` (Alt) + Click while in Mobile Emulation mode to trigger `touchStart` sequence instead of mouse events.
- **Responsive Toolbar**: Redesigned toolbar URL input for better usability on narrow (mobile) screens.
    - Replaced inline text input with a clickable trigger button.
    - Added dedicated URL entry dialog window.

### Changed
- **Window Management**: Adjusted window bounds saving logic to ignore mobile emulation resizing, preserving user's desktop window preference.
- **Toolbar**: Updated toolbar layout to prevent overflow artifacts in small windows.
