
# Scrutinizer - Foveal Vision Simulator

[![Electron](https://img.shields.io/badge/Electron-28.0-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![WebGL](https://img.shields.io/badge/WebGL-2.0-990000?style=flat-square&logo=webgl&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

A modern recreation of the 2007 Scrutinizer vision-simulating browser, built with Electron and **WebGL**, and positioned as a **design constraint model** for studying foveal vs. peripheral vision on the web.

[![Scrutinizer Demo](http://img.youtube.com/vi/LZB845_a5M4/0.jpg)](https://www.youtube.com/watch?v=LZB845_a5M4)


**Original project:** https://github.com/andyed/scrutinizer  


## What is Scrutinizer?

> [!IMPORTANT]
> **Vision is not a camera feed. It is a controlled hallucination.**
>
> We assume we see the world in high-definition 180° video. We don't. The human eye is a biological scanner with a terrifyingly narrow bandwidth.

### The Reality

> [!NOTE]
> **Foveal Vision (The "What")**
> You only possess "20/20 vision" in the **Fovea**—a tiny patch of retina roughly the size of your thumb held at arm's length (~2° of visual field).
>
> **Peripheral Vision (The "Where")**
> Everything else is the **Periphery**: a low-resolution, color-blind, motion-sensitive sensor that doesn't "see" objects, but merely guesses at their textures.

Your brain stitches these jittery, low-fidelity snapshots into a seamless timeline, editing out the blurs and blackouts in real-time. You are effectively blind to detail for 98% of your visual field.

### What Scrutinizer Does

Scrutinizer strips away the brain's post-processing to reveal the raw data your optic nerve actually receives.

1.  **Foveal Simulation**: A precise window of high-acuity focus that follows your cursor.
2.  **Peripheral Mongrels**: Uses "texture synthesis" algorithms to simulate **Visual Crowding**—where text and shapes disintegrate into statistical noise outside the center.
3.  **Rod-Weighted Luminance**: Simulates the spectral sensitivity of peripheral rod cells, revealing why "Aqua" buttons glow while red text vanishes.

> [!TIP]
> **Designers & Engineers**: Stop designing for the "Screenshot." Start designing for the **Scan**. Use Scrutinizer to test how your interfaces perform under real-world visual constraints.

## Features


> [!TIP]
> **New in 2025: Neural Processing Model (WebGL)**
> We've replaced the old optical blur with a biologically-accurate "Box Sampling with Noise" model, running entirely on the GPU:
> - **Parafoveal Jitter**: High-contrast but spatially uncertain (simulates crowding)
> - **Peripheral Block Sampling**: Pixelated/mosaic effect (simulates sparse photoreceptor density)
> - **Rod Sensitivity**: Cyan/Aqua elements glow in the periphery (505nm peak)

- 👁️ **Binocular foveal mask** that follows your mouse cursor with distinctive 16:9 shape
- 🎨 **Progressive desaturation** with real-time radial gradient (color → grayscale)
- 🧬 **ColorMatrix luminance weights** preserved for accurate grayscale conversion
- 📜 **Scroll detection** with automatic recapture
- 🔄 **DOM mutation detection** for dynamic content
- ⌨️ **Keyboard shortcuts** (ESC to toggle, Left/Right arrows to adjust size)
- 🎚️ **Menu-based controls** for radius and blur presets (Simulation menu)
- 🚀 **WebGL Pipeline** for 60fps performance and zero-copy rendering

## Download & Installation

Application builds pending. For now, run from source recommended. 

### Developer Setup (run from source)

```bash
# Install dependencies
npm install

# Run the application
npm start
```

## Usage

1. **Navigate**: Use **File → Open URL** (Cmd+L) to enter a website address.
2. **Enable**: Click the eye icon or press `Escape` to toggle foveal mode.
3. **Adjust**:
   - Use the **Simulation → Foveal Radius** menu to pick a radius preset.
   - Use **Simulation → Blur Amount** to adjust peripheral blur.
   - Or use **Left/Right arrow keys** (<>) while foveal mode is enabled.
4. **Observe**: Watch how easily key elements can be located using mostly peripheral vision.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Escape` | Toggle foveal mode on/off |
| `Right Arrow` (>) | Increase foveal radius (when foveal mode is enabled) |
| `Left Arrow` (<) | Decrease foveal radius (when foveal mode is enabled) |
| `Cmd+L` | Open URL dialog |

## Limitations

> [!WARNING]
> Scrutinizer is intentionally **approximate** and should be used as a **design constraint model**, not a precise physiological instrument.

- It models **retinal input constraints**, not the brain's transsaccadic integration.
- **Current implementation** uses Box Sampling with Noise, not full "Mongrel Theory" texture synthesis.
- It assumes a fixed relationship between screen pixels and **visual angle**.
- **Saccadic suppression** (blindness during eye movements) is not simulated.
- **Chromatic aberration** (R/B channel splitting) not yet implemented.

**Future development** (see `ROADMAP.md`) includes full Mongrel Theory implementation and WebGL-based domain warping.

## Technical Details

### How does it work?

The software captures the browser content and processes it through a custom **WebGL Fragment Shader** pipeline. This allows for complex, per-pixel visual effects that simulate the limitations of the human eye in real-time.

### Electron Architecture

This implementation leverages Electron's unique capabilities to interact with browser content:

#### Webview Tag
We use Electron's [`<webview>` tag](https://www.electronjs.org/docs/latest/api/webview-tag) to embed a fully-functional browser within the application. The webview is an isolated browser context that can load any web page while remaining sandboxed from the parent application.

#### IPC Communication
To track mouse movements and page events within the webview, we use Electron's **Inter-Process Communication (IPC)**:

1. **Injecting Code**: Using `webview.executeJavaScript()`, we inject tracking code into the loaded page
2. **Sending Events**: The injected code uses `ipcRenderer.sendToHost()` to send mouse coordinates, scroll events, and DOM mutations back to the parent
3. **Receiving Events**: The parent listens via `webview.addEventListener('ipc-message')` to receive these events

#### WebGL Rendering Pipeline

We moved from a CPU-based canvas approach to a fully GPU-accelerated pipeline to achieve 60fps performance:

```
DOM → Capture Page → GPU Texture Upload → WebGL Fragment Shader → Render
                                          ├─ Uniforms: Mouse Pos, Radius, Blur
                                          ├─ Pass 1: Rod-Sensitive Desaturation
                                          ├─ Pass 2: Variable Block Sampling (Periphery)
                                          └─ Pass 3: Foveal Masking
```

## Related Work & Theoretical Foundation

### Vision Science & Cognitive Psychology
- **Ruth Rosenholtz (MIT)**: Mongrel Theory and peripheral summary statistics
- **Anil Seth**: "Controlled hallucination" model of perception
- **Peter Pirolli (Xerox PARC)**: Information Foraging Theory - "information scent"
- **Cohen et al. (2020, PNAS)**: "Refrigerator Light" illusion

### UX & Design Practice
- **Jeff Johnson**: *Designing with the Mind in Mind*
- **Susan Weinschenk**: *100 Things Every Designer Needs to Know About People*
- **Nielsen Norman Group**: The "heatmap lie"

**For detailed theoretical discussion**, see `docs/beta_gemini3_discussion.md`.

## Contributors

### Original Scrutinizer (2007)
- **Creator**: Andy Edmonds
- **Coders**: James Douma @ Nitobi, Inc., Andy Edmonds, Evan Mullins
- **Designers**: Evan Mullins, Dave Hallock

### This Recreation (2025)
- Modern Electron/Canvas API implementation with enhanced physiological accuracy
- **Neural processing model** (Box Sampling with Noise) replaces optical blur
- Real-time progressive desaturation gradient
- Web Worker offloads processing for responsive UI

## License

Copyright (c) 2012-2025, Andy Edmonds. All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

- Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

