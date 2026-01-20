# Release Notes v1.4.4

**Release Date:** 2026-01-09

## Overview
This release introduces visible version numbering within the application interface to assist with debugging and verification.

## Key Changes

### User Interface
*   **Version Display (Splash Screen):** The application version (e.g., v1.4.4) is now displayed in the bottom-right corner of the startup splash screen.
*   **Version Display (Toolbar):** The current version is also visible in the persistent toolbar, located next to the foveal toggle button.

### Development & Testing
*   **Golden Screenshots:** Updated the visual regression testing baseline (golden screenshots) to match the current rendering engine state (v1.4.4).

## Implementation Details
*   Added `toolbar:set-version` IPC channel to propagate version info from main process to renderer.
*   Injected version string into splash window via `executeJavaScript` during initialization.
