# Glossary of Acronyms

Quick reference for acronyms and abbreviations used throughout the Scrutinizer codebase and documentation.

## Vision Science

| Acronym | Expansion | Context |
|---------|-----------|---------|
| **CMF** | Cortical Magnification Function | Log-mapping describing how the brain allocates disproportionate cortical area to foveal input. Parameterized via Schwartz (1980) / FOVI. |
| **CSF** | Contrast Sensitivity Function | Per-channel sensitivity curves (luminance, RG, BY) that vary with spatial frequency and eccentricity. See castleCSF (Ashraf et al. 2024). |
| **DoG** | Difference-of-Gaussians | Band-pass filter used for peripheral reconstruction. Scrutinizer uses 8 half-octave DoG bands at sqrt(2) spacing. |
| **FOVI** | Foveated Vision (model) | Cortical magnification parameterization from Blauch, Alvarez & Konkle (2026), adopted in v1.7. |
| **LGN** | Lateral Geniculate Nucleus | Thalamic relay/gating stage in the visual pathway. Scrutinizer's Stage 1 (structure masking, saliency modulation). |
| **RG** | Red–Green (opponent channel) | One of two chromatic opponent channels. Decays faster with eccentricity than BY. |
| **BY** | Blue–Yellow (opponent channel) | Chromatic opponent channel. More resilient in periphery than RG. |
| **YV** | Yellow–Violet (channel variant) | Alternate naming for the BY opponent channel axis used in some validation contexts. |
| **TTM** | Texture Tiling Model | Rosenholtz et al. (2012) model of peripheral vision as pooled summary statistics within tiling regions. |
| **V1** | Primary Visual Cortex (Visual Area 1) | First cortical processing stage — orientation, spatial frequency, crowding. Scrutinizer's Stage 2. |
| **V4** | Visual Area 4 | Cortical area for color constancy, shape, and aesthetic processing. Scrutinizer's Stage 3 (chromatic decay, pooling). |
| **IT** | Inferotemporal Cortex | Higher visual area for object recognition, referenced in the biological pathway diagram. |
| **FFA** | Fusiform Face Area | Cortical region selective for faces, referenced in the pathway diagram. |
| **PPA** | Parahippocampal Place Area | Cortical region selective for scenes, referenced in the pathway diagram. |
| **RFV** | Restricted Focus Viewer | Usability evaluation paradigm that restricts visible detail to a gaze-contingent window. Scrutinizer functions as an RFV. |
| **EPIC** | Executive-Process/Interactive Control (model) | Halverson & Hornof (2011) computational model of active visual search used in Wave 5 validation. |
| **cpd** | Cycles per degree | Unit of spatial frequency. Scrutinizer's DoG bands span 0.5–5.66 cpd. |
| **E2** | Half-resolution eccentricity | M-scaling parameter where acuity drops to 50% of foveal (e.g., `dog_e2: 0.15`). |
| **castleCSF** | Contrast sensitivity model (Ashraf et al. 2024) | Per-channel chromatic CSF covering color, area, spatiotemporal frequency, luminance, and eccentricity. |

## Color & Image

| Acronym | Expansion | Context |
|---------|-----------|---------|
| **OKLab** | OK Perceptual Lab color space | Perceptually uniform color space used in congestion and saliency computations (`oklab-utils.js`). |
| **sRGB** | Standard RGB | Default color space for web content and shader output. |
| **RGB** | Red, Green, Blue | Additive color model used throughout the rendering pipeline. |
| **HSL** | Hue, Saturation, Lightness | Color representation used in some saliency and congestion calculations. |
| **SSIM** | Structural Similarity Index Measure | Image quality metric (1.0 = identical). Used in golden-capture regression testing (threshold >= 0.98). |
| **PSNR** | Peak Signal-to-Noise Ratio | Image quality metric in dB. Used in golden-capture regression testing (threshold >= 35 dB). |
| **XMP** | Extensible Metadata Platform | Metadata standard. Citation-export embeds experiment metadata into PNG tEXt chunks. |
| **PNG** | Portable Network Graphics | Lossless image format used for screenshots and golden captures. |
| **DFT** | Discrete Fourier Transform | Used in spatial-acuity validation to extract frequency amplitudes from rendered stimuli. |
| **LOD** | Level of Detail | Refers to MIP chain levels that control resolution falloff with eccentricity. |
| **RGBA** | Red, Green, Blue, Alpha | Color model with transparency channel, used in texture sampling and framebuffer operations. |
| **BGRA** | Blue, Green, Red, Alpha | Alternate channel order used by Electron's `desktopCapturer` on some platforms. |

## Graphics & Rendering

| Acronym | Expansion | Context |
|---------|-----------|---------|
| **MIP** | Multum in Parvo ("much in little") | Pre-computed image pyramid for texture sampling. Core mechanism for eccentricity-dependent resolution falloff. |
| **GPU** | Graphics Processing Unit | Hardware accelerator for the WebGL/WebGPU rendering pipeline. |
| **WebGL** | Web Graphics Library | OpenGL ES API for the browser. Scrutinizer's primary rendering backend (Tier 1.6). |
| **WebGPU** | Web GPU API | Next-gen browser graphics/compute API. Powers Tier 2.5 peripheral texture synthesis via compute shaders. |
| **GLSL** | OpenGL Shading Language | Shader language for the WebGL fragment/vertex shaders (e.g., `peripheral.frag`). |
| **WGSL** | WebGPU Shading Language | Shader language for WebGPU compute pipelines (tile statistics, oriented noise synthesis). |
| **FPS** | Frames per Second | Rendering performance metric tracked in the frame timer. |
| **HUD** | Heads-Up Display | The ComplexityHUD overlay showing congestion score, stats, and spatial tabs. |
| **SVG** | Scalable Vector Graphics | Used for overlay rendering (`svg-overlay.js`) and referenced in the founding assessment. |
| **CSS** | Cascading Style Sheets | Web styling language; CSS pixels are the unit for foveal radius and viewport measurements. |
| **DPI** | Dots per Inch | Display density metric. Relevant to calibration and px/deg calculations. |
| **DPR** | Device Pixel Ratio | High-DPI scaling factor (`window.devicePixelRatio`); affects px/deg conversion. |
| **FBO** | Framebuffer Object | WebGL off-screen render target used in multi-pass rendering. |

## Software & Platform

| Acronym | Expansion | Context |
|---------|-----------|---------|
| **API** | Application Programming Interface | Public interface for Scrutinizer modules and the MCP server tools. |
| **CLI** | Command-Line Interface | The `scrutinizer-audit` headless auditor tool. |
| **MCP** | Model Context Protocol | AI-assisted design review server exposing `analyze_url`, `compare_pages`, and `capture_vision` tools. |
| **IPC** | Inter-Process Communication | Electron's main↔renderer messaging channel for structure updates, mode changes, and navigation. |
| **DOM** | Document Object Model | Browser tree structure. Scrutinizer reads the live DOM for density, text rhythm, ARIA roles, and Gestalt grouping. |
| **ARIA** | Accessible Rich Internet Applications | WAI-ARIA roles read from the DOM to inform semantic type detection in the structure map. |
| **HTML** | HyperText Markup Language | Web content format; also used for the 15 psychophysical reference stimuli. |
| **JSON** | JavaScript Object Notation | Data format for configuration (`modes.json`), published psychophysical data, and metadata sidecars. |
| **URL** | Uniform Resource Locator | Web addresses used in navigation, CLI auditing, and citation metadata. |
| **NPM** | Node Package Manager | JavaScript package manager; `npm start`, `npm test`, `npm run build`. |
| **DMG** | Disk Image | macOS installer format for signed/notarized Scrutinizer releases. |
| **NSIS** | Nullsoft Scriptable Install System | Windows installer builder referenced in build configuration. |
| **CI** | Continuous Integration | Automated testing/gating; the CLI supports `--fail-above N` for CI pipelines. |
| **SDK** | Software Development Kit | Referenced for Tobii eye-tracker integration (future gaze input). |
| **MIT** | MIT License | Open-source license used by Scrutinizer and face-api.js. |
| **DOI** | Digital Object Identifier | Persistent identifier for academic papers cited in validation and specs. |

## Acronyms in Academic Context

| Acronym | Expansion | Context |
|---------|-----------|---------|
| **HCI** | Human–Computer Interaction | Research domain; Scrutinizer validates against HCI models (Halverson & Hornof 2011). |
| **UI** | User Interface | General term for interactive elements; Scrutinizer analyzes UI density and saliency. |
| **UX** | User Experience | Design discipline; Scrutinizer aids UX evaluation of peripheral discoverability. |
| **MBP** | MacBook Pro | Reference hardware for calibration defaults (16" MBP M3 @ 20"). |
| **PPD** | Pixels per Degree | Visual angle conversion factor (~44 CSS px/° on MBP Retina @ 50 cm). |
| **WAI** | Web Accessibility Initiative | W3C initiative that defines the ARIA specification. |
