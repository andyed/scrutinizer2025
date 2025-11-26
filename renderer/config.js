// Configuration constants for Scrutinizer effect
const CONFIG = {
    // Foveal region settings
    fovealRadius: 180, // pixels - size of the clear vision area

    // Image processing settings
    blurRadius: 10, // pixels - amount of blur for peripheral vision (higher = more severe)
    desaturationAmount: 1.0, // 0-1, where 1 is full grayscale

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

    // Experimental settings
    useFoveatedBlur: true, // when true, use multi-resolution foveated blur instead of uniform blur

    // Debug settings
    enableLogger: true // Enable renderer logs passing through to main process terminal
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
