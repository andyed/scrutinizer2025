// Configuration constants for Scrutinizer effect
const CONFIG = {
    // Foveal region settings
    fovealRadius: 90, // pixels - ~2° eccentricity on MBP Retina @ 20" (see docs/foveal-calibration-logic.md §7)
    fovealAspectRatio: 1.33, // width/height ratio of foveal shape (4:3 default)

    // Image processing settings
    blurRadius: 10, // pixels - amount of blur for peripheral vision (higher = more severe)
    desaturationAmount: 1.0, // 0-1, where 1 is full grayscale
    intensity: 0.6, // 0-1, strength of distortion effect

    // ColorMatrix luminance weights (from original ActionScript)
    LUM_R: 0.212671,
    LUM_G: 0.715160,
    LUM_B: 0.072169,

    // Performance settings
    scrollDebounce: 150, // ms - delay before recapturing after scroll
    mutationDebounce: 200, // ms - delay before recapturing after DOM change

    // Capture settings
    captureScale: 1.0, // scale factor for capture (lower = faster but less quality)

    // Animation settings
    maskSmoothness: 1, // 0-1, higher = more responsive (0.2 = smooth but laggy, 1.0 = instant)

    // Fixation detection thresholds
    fixationVelocityThreshold: 20.0, // px/ms - max velocity to count as fixation (relaxed for slow reading)
    dwellTimeThreshold: 50, // ms - minimum dwell time to confirm fixation
    saccadicSuppressionThreshold: 2.5, // px/ms - velocity above which to skip heavy processing
    velocityDecayMove: 0.003, // Slow adaptation when moving (stable)
    velocityDecayStop: 0.04, // Fast adaptation when stopping (snappy)
    foveaBypassMargin: 0.5, // Fraction of radius for visual memory proximity check

    // Experimental settings
    useFoveatedBlur: true, // when true, use multi-resolution foveated blur
    chromaticAberration: true, // Enable chromatic aberration
    mongrelMode: 0.0, // 0.0 = Noise/Fractal Crowding (Tier 2.0), 1.0 = Shatter/Slow Wave

    // DoG peripheral reconstruction (V4 MIP replacement)
    dogEnabled: false,      // false = legacy MIP pooling, true = DoG band reconstruction
    dogE2: 0.5,             // M-scaling E2 parameter (calibrated to normEcc range ~0-0.8)
    dogSharpness: 0.0,      // Band rolloff sharpness (0=biological/gradual, 1=sharp/crisp)

    // Debug settings
    enableLogger: true, // Enable renderer logs passing through to main process terminal
    debugBoundary: 0.0,
    debugStructure: 0.0,
    enableStructureMap: true,
    enableSaliencyModulation: true, // Saliency-based bandwidth allocation in LGN
    visualMemory: 0.0,
};

if (typeof module !== 'undefined' && module.exports) {
    const CALIBRATION_URL = 'https://andyed.github.io/scrutinizer-www/foveal-calibration.html';

    module.exports = {
        DEFAULT_SETTINGS: CONFIG,
        CALIBRATION_URL,
        // ... possibly other exports
    };
}
