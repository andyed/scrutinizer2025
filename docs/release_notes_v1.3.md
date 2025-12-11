# Scrutinizer v1.3 Release Notes

**"The Perceptual Accuracy Update"**

This release focuses on scientifically accurate color processing, improved foveal calibration, and enhanced visual overlays for better biological fidelity.

## 🎨 Major Features

### Oklab Color Space Integration
Upgraded peripheral vision color processing from RGB to **Oklab**, a perceptually uniform color space designed for image processing.

**Why Oklab?**
- **Perceptually uniform desaturation** - Eliminates "muddy" artifacts when converting colors to grayscale
- **Biologically accurate** - Separates Luminance (L) from Chrominance (a, b), matching the Magno (luminance) and Parvo (color) pathways in the visual cortex
- **Natural rod vision** - Better simulation of scotopic (low-light) vision with accurate cyan sensitivity at 505nm peak

**Technical Implementation:**
- Created `oklab-utils.js` with RGB ↔ Oklab conversion functions based on Björn Ottosson's official specification
- Updated `image-processor.js` to use Oklab for both standard and rod-sensitive desaturation
- Added GLSL Oklab conversion functions to `peripheral.frag` shader for GPU-accelerated processing
- Converted High-Key and Lab (now "Oklab") modes to use perceptually uniform desaturation
- Eigengrau tinting now works in Oklab space for more natural cold blue-gray appearance

**User-Facing Benefits:**
- More natural peripheral vision simulation
- No more muddy brown/green artifacts in desaturated regions
- Improved biological plausibility
- Seamless visual quality across all aesthetic modes

**Reference:** Ottosson, B. (2020). "A perceptual color space for image processing." https://bottosson.github.io/posts/oklab/

---

### Smooth Parafovea-Periphery Transition
Fixed abrupt visual transition at the parafovea boundary (2.5x fovea radius).

**Issues Resolved:**
- **Blur discontinuity** - Replaced piecewise linear/exponential function with continuous exponential curve
- **Contrast preservation jump** - Replaced hard 0.6 → 0.3 switch with smooth `smoothstep` gradient

**Result:** Seamless visual transition from parafovea to far periphery with no visible "kink" or boundary artifacts.

---

### Enhanced Foveal Calibration
Improved the web-based foveal calibration tool for better accuracy and usability.

**Improvements:**
- **Mobile support** - Fixed blank screen and control alignment issues on mobile devices
- **Tap interaction** - Added tap functionality as alternative to Spacebar for mobile users
- **Better visual feedback** - Improved rendering and alignment of calibration controls
- **Menu integration** - Direct access via `Simulation > Calibrate Foveal Size`

**Access:** Menu bar → Simulation → Calibrate Foveal Size, or navigate directly to the calibration URL

---

## 🧠 Biological Simulation

### Perceptually Uniform Color Processing
- **Oklab desaturation** - Chrominance (a, b) reduction while preserving lightness (L)
- **Rod sensitivity** - Cyan (505nm) retains slightly more saturation in periphery
- **Helmholtz-Kohlrausch effect** - Saturated colors appear brighter, properly modeled in Oklab space

### Improved Blur Curve
- **Continuous exponential** - Formula: `blur = 8.0 * (e^(2.0 * eccentricity) - 1.0)`
- **No hard boundaries** - Smooth acceleration from parafovea to periphery
- **Capped at 20px** - Prevents excessive softness in far periphery

---

## 🛠️ Technical Improvements

### Color Space Conversion
- **JavaScript utilities** - `oklab-utils.js` with gamma correction and convenience functions
- **GLSL shader functions** - Hardware-accelerated Oklab conversion on GPU
- **Proper gamma handling** - sRGB gamma correction (2.4 gamma with linear segment)

### Performance
- **Negligible overhead** - Oklab conversions (matrix math + cube roots) are fast on modern GPUs
- **Maintained frame rate** - No performance degradation from color space upgrade
- **Optimized calculations** - Pre-computed constants and efficient matrix operations

---

## 📚 Documentation Updates

### Scientific References
- Added Oklab color space reference to literature review
- Updated foveated vision model documentation with Oklab integration details
- Documented perceptual uniformity benefits and biological accuracy improvements

### Developer Guide
- Comprehensive Oklab implementation documentation
- Color space conversion formulas and matrices
- Integration guide for future color processing features

---

## 🔮 Upcoming Roadmap

- **Windows Support** - Continued development for Windows build and launch
- **Advanced Saliency** - Multi-scale saliency detection and inhibition of return
- **Calibrated Visual Angles** - Monitor distance/DPI calibration for precise degree-based measurements
- **Performance Profiling** - Detailed frame time analysis and optimization

---

## 📖 References

1. Ottosson, B. (2020). "A perceptual color space for image processing." https://bottosson.github.io/posts/oklab/
2. Strasburger, H., Rentschler, I., & Jüttner, M. (2011). "Peripheral vision and pattern recognition: A review." *Journal of Vision*, 11(5):13.
3. Rosenholtz, R. (2016). "Capabilities and Limitations of Peripheral Vision." *Annual Review of Vision Science*, 2:437-457.

---

## Acknowledgments

Special thanks to Björn Ottosson for creating and open-sourcing the Oklab color space specification, enabling more accurate and natural color processing in peripheral vision simulation.
