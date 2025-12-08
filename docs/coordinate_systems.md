
### 6. Coordinate Systems & DPI

Scrutinizer relies on precise alignment between three different coordinate spaces. Mismatches here lead to "drift" or "offsets" on High-DPI (Retina) screens.

#### The Pipeline

1.  **Screen Coordinates (Absolute)**
    *   **Source**: `preload.js` -> `ipcRenderer.send('browser:mousemove', e.screenX, e.screenY)`.
    *   **Unit**: Logical Pixels (DIPs).
    *   **Origin**: Top-Left of the physical monitor.
    *   **Why**: Bypasses browser zoom levels and internal layout shifts.

2.  **Local Visual Coordinates (HUD)**
    *   **Source**: `overlay.js` -> `localX = screenX - window.screenX`.
    *   **Unit**: Logical Pixels.
    *   **Origin**: Top-Left of the HUD window (Content Area).
    *   **Role**: The "Single Source of Truth" for where the mouse is relative to the overlay.

3.  **Physical Coordinates (WebGL)**
    *   **Source**: `scrutinizer.js` -> `targetMouseX = localX * scaleX`.
    *   **Unit**: Physical Pixels.
    *   **Scaling**: `scaleX` is approx `window.devicePixelRatio` (e.g., 2.0 on Retina).
    *   **Why**: WebGL needs full resolution for crisp rendering (no aliasing).

4.  **Logical Coordinates (SVG Overlay)**
    *   **Source**: `scrutinizer.js` -> `svgX = mouseX / scaleX`.
    *   **Unit**: Logical Pixels.
    *   **Why**: SVG elements defined in HTML use CSS units (Logical).

#### The Golden Rule
**"WebGL is Physical, SVG is Logical."**
When passing coordinates from the WebGL loop (Physical) back to the DOM/SVG (Logical), you **MUST** divide by the current scale factor (`this.scaleX` or `dpr`). Failure to do so results in the overlay moving 2x faster than the mouse (drift).
