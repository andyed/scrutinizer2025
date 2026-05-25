// Configuration constants for Scrutinizer effect

// Single source of truth for the elliptical foveal aspect ratio (w:h).
// TODO(biology): 1.33 has no inline citation. Plausible post-hoc as horizontal-raphe
// asymmetry or Rayner reading-span collapsed to a symmetric ellipse, but neither is
// derived in source. When the constant is grounded, edit it HERE — all consumers
// (renderer/scrutinizer.js, renderer/webgl-renderer.js, renderer/webgpu-crowding-compute.js,
// scripts/compare-brown-metamers.js, renderer/shaders/crowding-stats.wgsl) read from
// CONFIG.fovealAspectRatio or the FOVEA_ASPECT_RATIO_DEFAULT export below.
const FOVEA_ASPECT_RATIO_DEFAULT = 1.33;

const CONFIG = {
    // Foveal region settings
    fovealRadius: 45, // pixels - ~1° foveal radius (2° diameter) on MBP Retina @ 20" (see docs/foveal-calibration-logic.md §7)
    fovealAspectRatio: FOVEA_ASPECT_RATIO_DEFAULT, // width/height ratio of foveal shape (4:3 default)

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
    congestionRecomputeCooldownMs: 5000, // ms - min gap between Feature Congestion
                                         // recomputes on DOM mutation. Prevents thrashing
                                         // the congestion worker on rapid DOM churn.
                                         // Trade-off: lower = fresher heatmap, higher worker
                                         // load; higher = staler heatmap, less CPU/GPU.
    metamerContentRefreshMs: 100,        // ms - max staleness for WebGPU metamer during
                                         // stationary gaze. Saccade landing + drift > 5°
                                         // still trigger immediate resynth; this is the
                                         // time-based floor that catches CSS animations
                                         // and hover effects (which don't fire DOM mutation
                                         // events). 100ms ≈ 10Hz peripheral refresh, close
                                         // to peripheral flicker-fusion threshold. Trade-off:
                                         // lower = fresher periphery on animated content +
                                         // more compute; higher = better freeze fidelity +
                                         // staler animations.
    congestionHeatmapStuckTimeoutMs: 10000, // ms - safety timeout for restoring the
                                            // congestion heatmap after scroll/nav hid it.
                                            // Normal restore fires when the congestion
                                            // worker emits fresh data (generation counter
                                            // advances). If the worker hangs or the page
                                            // never lets congestion compute (broken DOM,
                                            // permission denied), the heatmap would stay
                                            // hidden forever — this is the worst-case
                                            // fallback that re-asserts visibility with
                                            // possibly-stale data after the timeout.

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
    crowdingRadialBias: 2.0, // Radial:tangential crowding ratio (Toet & Levi 1992)

    // DoG peripheral reconstruction (V4 MIP replacement)
    dogEnabled: false,      // false = legacy MIP pooling, true = DoG band reconstruction
    dogE2: 0.5,             // M-scaling E2 parameter (calibrated to normEcc range ~0-0.8)
    dogSharpness: 0.0,      // Band rolloff sharpness (0=biological/gradual, 1=sharp/crisp)

    // V1 length-tuning / end-stopping — suppresses long edges (page-tall borders,
    // table column rules, dividers) so structural chrome stops dominating saliency.
    // Bio mechanism: hypercomplex cell endzone inhibition (Hubel & Wiesel 1965;
    // Cavanaugh, Bair & Movshon 2002). See docs/specs/length_tuned_edge_suppression.md.
    lengthTuningEnabled: false,    // gated off until validated; enable per-mode via modes.json
    lengthTuningStrength: 0.7,     // max suppression (0=off, 1=full kill). CBM 2002 reports
                                   // ~60-80% max surround suppression; 0.7 sits in the middle.
    lengthTuningMidpoint: 0.5,     // persistence value at half-max suppression. 0.5 = "edge
                                   // continues ~halfway through the probe window."
    lengthTuningSteepness: 8.0,    // sigmoid slope. CBM 2002 shoulder shape matches ~6-10.
    lengthTuningProbeSteps: 8,     // K_STEPS — costs 2 texture reads per step. 8 = ±16 px at
                                   // MIP 1 ≈ "very long" edge near the 45 px fovea.

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
        FOVEA_ASPECT_RATIO_DEFAULT,
        CALIBRATION_URL,
    };
}
