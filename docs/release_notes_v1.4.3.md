# Release Notes v1.4.3

**Release Date:** 2026-01-04

## Overview
This release focuses on significant performance optimizations to improve startup time and interaction responsiveness, alongside robust fixes for visual stability in the interface.

## Key Changes

### Visual Stability
*   **Scrollbar Protection:** Implemented a robust shader-level exclusion for the scrollbar area. This prevents the "Visual Noising" effects from distorting the scrollbar, ensuring navigability is never compromised regardless of the active aesthetic mode.
*   **Biological Color Fidelity:** Refined the peripheral color model to better match human rod vision.
    *   **Protanopia Simulation:** Red objects in the far periphery now fade to dark grey/black instead of desaturated pink, simulating the rod cells' blindness to long wavelengths.
    *   **Usability Mode:** Implemented a "Progressive Fade" that crushes both Red and Yellow channels to prevent "mustard" artifacts, ensuring high-contrast UI elements (like buttons) remain visible and structurally intact as neutral grey forms.

### Performance Optimization
*   **Startup Speed:** Implemented a **Splash Screen** to provide immediate visual feedback while the core application initializes, eliminating the "white screen of death" effect at launch.
*   **Input Latency:** Fixed the "spinning cursor" issue when typing in search bars or interacting with complex pages. Optimized the DOM scanner to use `requestIdleCallback` for mutations, ensuring interactions remain buttery smooth.
*   **Zero-Lag Typing:** Identified and fixed a critical regression where DOM scans were triggering layout thrashing during input. The new **Typing Debounce** logic completely suspends structural analysis while you type, yielding 100% of the main thread to the browser for immediate feedback. Scans resume intelligently 1.5s after activity ceases.

### Implementation Details
*   **Splash Screen:** New lightweight `splash.html` window that hands off to the main window only when ready.
*   **Optimized Preload:** `DomAdapter` now prioritizes scroll events (High Priority) over general mutations (Low Priority), significantly reducing main thread blocking time.
*   **Dual-Window Architecture:** Refined the coordination between the main browser window and the overlay HUD window for smoother synchronization.

## Known Issues
*   Minor delay in peripheral blur updates during intense typing (intentional trade-off for input responsiveness).
