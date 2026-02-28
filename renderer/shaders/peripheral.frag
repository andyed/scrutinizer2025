#version 300 es
precision mediump float;

// === UNIFORMS ===
uniform sampler2D u_texture;      // Captured browser frame (Live)
uniform sampler2D u_maskTexture;  // Visual memory mask
uniform sampler2D u_structureMap; // Structure Map (R=Rhythm, G=Density, B=Type)
uniform sampler2D u_saliencyMap;  // Saliency Map (R=Saliency, grayscale)
uniform float u_useMask;

uniform vec2  u_resolution;
uniform vec2  u_mouse;
uniform vec2  u_mouse_stable; // Hysteresis-smoothed mouse for distortion
uniform float u_foveaRadius;
uniform float u_fovea_aspect_ratio; // Aspect ratio of foveal shape
uniform float u_pixelation;
uniform float u_intensity;
uniform float u_ca_strength;
uniform float u_debug_boundary;
uniform float u_debug_structure;
uniform float u_has_structure;
uniform float u_enable_saliency_modulation;
uniform float u_time; // Time in seconds for animation
uniform float u_velocity;         // Mouse velocity in px/ms
uniform float u_blurRadius;       // Simulated Pupil Aperture (0.0 = Sharp, 10.0 = Blurry)
uniform float u_mongrel_mode;     // 0.0 = Noise, 1.0 = Shatter


// === GRANULAR CONFIGURATION UNIFORMS ===
uniform float u_lgn_use_structure_mask;
uniform float u_lgn_use_saliency_gate;
uniform int   u_v1_distortion_type;
uniform float u_v1_strength_mult;
uniform int   u_v4_style_id;
uniform float u_lgn_ramp_end_mult;
uniform float u_v1_animate;

in vec2 v_texCoord;
out vec4 fragColor;

// === HELPER: SOURCE SAMPLER (The "True View") ===
// Centralizes sampling of the source capture to ensure consistent color handling.
// Electron captures are BGRA, but WebGL treats them as RGBA.
// We MUST swap R and B here to get the correct color.
// Uses textureLod(0) for consistency with MIP-based pooling (avoids subtle filtering differences).
vec4 sampleSource(vec2 uv) {
    vec4 col = textureLod(u_texture, uv, 0.0);
    float temp = col.r;
    col.r = col.b;
    col.b = temp;
    return col;
}

// === HELPER: VARIABLE BLUR ===
// Approximates Gaussian blur with variable radius using a 5-tap pattern.
// Radius is in pixels.
vec4 sampleBlurred(vec2 uv, float radius) {
    if (radius < 0.5) return sampleSource(uv);
    
    vec2 pixelSize = 1.0 / u_resolution;
    vec4 sum = vec4(0.0);
    float totalWeight = 0.0;
    
    // Center
    sum += sampleSource(uv) * 0.4;
    totalWeight += 0.4;
    
    // 4 Cardinal Neighbors
    // Stride increases with radius
    float stride = radius; 
    vec2 off1 = vec2(stride, 0.0) * pixelSize;
    vec2 off2 = vec2(-stride, 0.0) * pixelSize;
    vec2 off3 = vec2(0.0, stride) * pixelSize;
    vec2 off4 = vec2(0.0, -stride) * pixelSize;
    
    sum += sampleSource(uv + off1) * 0.15;
    sum += sampleSource(uv + off2) * 0.15;
    sum += sampleSource(uv + off3) * 0.15;
    sum += sampleSource(uv + off4) * 0.15;
    totalWeight += 0.6;
    
    return sum / totalWeight;
}

// === HELPER: MIP-BASED POOLING (Mongrel Tier 1) ===
// Uses hardware MIP-maps to approximate biological receptive field pooling.
// As eccentricity increases, we sample from lower-resolution MIP levels,
// simulating the larger pooling regions in peripheral vision.
// 
// Unlike blur, MIP pooling:
// - Genuinely averages larger areas (not just weighted samples)
// - Is essentially free (hardware-accelerated)
// - Provides consistent "pooling region" sizes at each eccentricity
//
// mipLevel: 0 = full resolution (fovea), ~4 = 16x16 pooling (far periphery)
vec4 sampleMIPPooled(vec2 uv, float eccentricity, float fovea_radius) {
    // Calculate MIP level based on eccentricity
    // Eccentricity is normalized distance from fovea edge
    // At fovea edge (eccentricity=0): mipLevel=0 (full res)
    // At far periphery (eccentricity~0.5): mipLevel=4 (16x16 pooling)
    
    float normalizedEcc = max(0.0, eccentricity) / fovea_radius;
    
    // Biological: receptive field size doubles every ~2° of eccentricity
    // We map this to MIP levels: each level doubles pooling region
    // Scaling factor adjusts how quickly we reach max pooling
    float mipScaling = 2.5; // Tune: higher = faster pooling growth
    float maxMipLevel = 4.0; // Cap at 16x16 pooling (level 4)
    
    float mipLevel = clamp(normalizedEcc * mipScaling, 0.0, maxMipLevel);
    
    // Sample using textureLod with computed MIP level
    // Note: textureLod performs trilinear filtering between MIP levels
    vec4 col = textureLod(u_texture, uv, mipLevel);
    
    // Apply BGRA -> RGBA swap (same as sampleSource)
    float temp = col.r;
    col.r = col.b;
    col.b = temp;
    
    return col;
}

// === NOISE HELPERS ===
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise(vec2 v){
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
            -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1;
    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
        + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m ;
    m = m*m ;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

// === EDGE DETECTION HELPERS ===
float sobel(vec2 uv) {
    vec2 pixelSize = 1.0 / u_resolution;
    float t = texture(u_texture, uv + vec2(0.0, -pixelSize.y)).r;
    float b = texture(u_texture, uv + vec2(0.0, pixelSize.y)).r;
    float l = texture(u_texture, uv + vec2(-pixelSize.x, 0.0)).r;
    float r = texture(u_texture, uv + vec2(pixelSize.x, 0.0)).r;
    float tl = texture(u_texture, uv + vec2(-pixelSize.x, -pixelSize.y)).r;
    float tr = texture(u_texture, uv + vec2(pixelSize.x, -pixelSize.y)).r;
    float bl = texture(u_texture, uv + vec2(-pixelSize.x, pixelSize.y)).r;
    float br = texture(u_texture, uv + vec2(pixelSize.x, pixelSize.y)).r;
    
    float gx = (tl + 2.0*l + bl) - (tr + 2.0*r + br);
    float gy = (tl + 2.0*t + tr) - (bl + 2.0*b + br);
    
    return sqrt(gx*gx + gy*gy);
}

// === OKLAB COLOR SPACE CONVERSION ===
// Based on Björn Ottosson's Oklab specification
// https://bottosson.github.io/posts/oklab/

// Convert sRGB component to linear RGB
float srgbToLinear(float c) {
    if (c <= 0.04045) {
        return c / 12.92;
    } else {
        return pow((c + 0.055) / 1.055, 2.4);
    }
}

// Convert linear RGB component to sRGB
float linearToSrgb(float c) {
    if (c <= 0.0031308) {
        return c * 12.92;
    } else {
        return 1.055 * pow(c, 1.0 / 2.4) - 0.055;
    }
}

// Convert sRGB vec3 to linear RGB
vec3 srgbToLinearVec(vec3 srgb) {
    return vec3(
        srgbToLinear(srgb.r),
        srgbToLinear(srgb.g),
        srgbToLinear(srgb.b)
    );
}

// Convert linear RGB vec3 to sRGB
vec3 linearToSrgbVec(vec3 linear) {
    return vec3(
        linearToSrgb(linear.r),
        linearToSrgb(linear.g),
        linearToSrgb(linear.b)
    );
}

// Convert linear sRGB to Oklab
vec3 linearSrgbToOklab(vec3 rgb) {
    // Convert linear sRGB to LMS cone response (M1 matrix)
    float l = 0.4122214708 * rgb.r + 0.5363325363 * rgb.g + 0.0514459929 * rgb.b;
    float m = 0.2119034982 * rgb.r + 0.6806995451 * rgb.g + 0.1073969566 * rgb.b;
    float s = 0.0883024619 * rgb.r + 0.2817188376 * rgb.g + 0.6299787005 * rgb.b;

    // Apply non-linearity (cube root)
    float l_ = pow(l, 1.0 / 3.0);
    float m_ = pow(m, 1.0 / 3.0);
    float s_ = pow(s, 1.0 / 3.0);

    // Convert to Lab coordinates (M2 matrix)
    return vec3(
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    );
}

// Convert Oklab to linear sRGB
vec3 oklabToLinearSrgb(vec3 lab) {
    // Convert Lab to LMS (inverse M2)
    float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
    float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
    float s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;

    // Apply inverse non-linearity (cube)
    float l = l_ * l_ * l_;
    float m = m_ * m_ * m_;
    float s = s_ * s_ * s_;

    // Convert LMS to linear sRGB (inverse M1)
    return vec3(
        +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    );
}

// Convert sRGB (0-1) to Oklab
vec3 rgbToOklab(vec3 srgb) {
    vec3 linear = srgbToLinearVec(srgb);
    return linearSrgbToOklab(linear);
}

// Convert Oklab to sRGB (0-1), clamped
vec3 oklabToRgb(vec3 lab) {
    vec3 linear = oklabToLinearSrgb(lab);
    vec3 srgb = linearToSrgbVec(linear);
    return clamp(srgb, 0.0, 1.0);
}

// === STATIC MONGREL SAMPLER ===
vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

float rand(vec2 co){
    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
}

vec4 sampleMongrel(sampler2D tex, vec2 uv, float strength, float intensity, float rhythm) {
    if (strength <= 0.01) return sampleSource(uv);

    // Modulate Y-frequency based on Line Height (rhythm)
    // rhythm = 0.0 (small/none) -> High Freq (Shimmer)
    // rhythm = 1.0 (large) -> Low Freq (Wobble)
    
    float baseDensity = 120.0;
    // If rhythm is present (>0), scale density down. 
    // rhythm 0.5 (50px) -> density ~ 20.0
    float densityY = mix(baseDensity, 10.0, rhythm);
    float densityX = baseDensity; // Keep X high freq to maintain horizontal shredding feel? Or scale both?
    // User said "lower the Y-frequency", implying X might stay high or scale differently.
    // Let's scale X slightly too but less aggressive.
    densityX = mix(baseDensity, 40.0, rhythm);

    float xID = floor(uv.x * densityX);
    float yID = floor(uv.y * densityY);

    // Strength only affects the AMPLITUDE of the jitter, not the grid structure
    float jitterScale = 0.04 * strength * intensity;
    
    // Hash based on fixed grid IDs
    float offX = (hash22(vec2(yID, xID)).x - 0.5) * jitterScale;
    float offY = (hash22(vec2(xID, yID + 13.0)).x - 0.5) * jitterScale;

    vec2 shatteredUV = uv + vec2(offX, offY);
    
    vec4 clean = sampleSource(shatteredUV);
    vec4 ghost = sampleSource(shatteredUV + vec2(0.01 * strength, 0.0));
    
    return mix(clean, ghost, 0.3);
}

// === NEURO-ARCHITECTURE PIPELINE ===

struct ModeConfig {
    bool lgn_use_structure_mask; // Should whitespace be protected?
    bool lgn_use_saliency_gate;  // Should high saliency be protected?
    int  v1_distortion_type;     // 0=Noise (Curves), 1=Shatter (Mongrel), 2=None
    float v1_strength_mult;      // Multiplier for distortion
    int  v4_style_id;            // 0=HighKey, 1=Lab, 2=Frosted, 3=Blueprint, 4=Cyberpunk, 5=Double Vision
    float lgn_ramp_end_mult;     // Multiplier for fovea_radius to determine ramp end
    bool v1_animate;             // Should distortion move over time?
};

struct LGN_Signal {
    float suppressionFactor; // 0.0 = Full Suppression, 1.0 = Full Effect
    float saliency;
    float density;
    float rhythm;
    float type;
};

struct V1_Signal {
    vec2 distortedUV;
    float distortionStrength;
    vec2 displacement;
};

// --- STAGE 1: LGN (Gating & Analysis) ---
LGN_Signal processLGN(vec2 uv, ModeConfig config, float dist, float fovea_radius) {
    LGN_Signal signal;
    
    // 1. Read Maps
    // Note: Structure and saliency maps are lower resolution than main texture
    // GL_LINEAR filtering handles upscaling smoothly
    vec4 structure = texture(u_structureMap, uv);
    signal.density = structure.g;
    signal.rhythm = structure.r;
    signal.type = structure.b;
    signal.saliency = texture(u_saliencyMap, uv).r;
    
    // 2. Calculate Base Suppression (Foveal Protection)
    // Ramp from fovea_radius to fovea_radius * ramp_mult
    float rampEnd = fovea_radius * config.lgn_ramp_end_mult;
    signal.suppressionFactor = smoothstep(fovea_radius, rampEnd, dist);
    
    // Removed pow(0.5) boost to restore nuance/linear falloff
    
    // 3. Structure Masking (Whitespace Protection)
    if (config.lgn_use_structure_mask) {
        if (u_has_structure > 0.5 && signal.density < 0.1) {
            signal.suppressionFactor = 0.0;
        }
    }
    
    // 4. Saliency Gating (Selective resource allocation)
    // High-saliency regions receive more processing bandwidth (less peripheral filtering).
    // Even at saliency=1.0, the floor is 0.3 — only the fovea gets full bandwidth.
    // Mirrors biological compute demand management: retina → optic nerve bottleneck.
    if (config.lgn_use_saliency_gate && u_enable_saliency_modulation > 0.5) {
        signal.suppressionFactor *= mix(1.0, 0.3, signal.saliency);
    }
    
    // 5. Inhibition of Return (Gating Suppression)
    // If u_useMask == 2.0, we are in Inhibition Mode.
    // Visited areas (high mask value) should be SUPPRESSED (hidden from LGN).
    // This removes their structural/salient protection, making them subject to full distortion.
    if (u_useMask > 1.5) {
        float rawMask = texture(u_maskTexture, uv).r;
        float inhibition = smoothstep(0.0, 0.5, rawMask);
        
        // Suppress signals based on inhibition level
        signal.saliency *= (1.0 - inhibition);
        signal.density *= (1.0 - inhibition);
        signal.rhythm *= (1.0 - inhibition);
        // We do NOT suppress suppressionFactor itself yet, because that is pure foveal distance.
        // But by killing saliency/density, we ensure "Structure Masking" and "Saliency Gating" fail.
    }

    return signal;
}

// --- STAGE 2: V1 (Geometry & Distortion) ---
// --- STAGE 2: V1 (Geometry & Distortion) ---
V1_Signal processV1(vec2 uv, vec2 uv_corrected, LGN_Signal lgn, ModeConfig config, float dist, float fovea_radius, float parafovea_radius, bool isFarPeriphery, bool isParafovea, float memoryStrength) {
    V1_Signal signal;
    signal.distortedUV = uv;
    signal.distortionStrength = 0.0;
    signal.displacement = vec2(0.0);
    
    // Eccentricity-Based Scaling: Parafovea vs Far Periphery
    // Parafovea (3-5°): Mild positional uncertainty, preserve geometry
    // Far Periphery (>8°): Aggressive scatter and dissolution
    // Parafovea (3-5°): Mild positional uncertainty, preserve geometry
    // Far Periphery (>8°): Aggressive scatter and dissolution
    // Eccentricity-Based Scaling: Parafovea vs Far Periphery
    // Parafovea (3-5°): Mild positional uncertainty, preserve geometry
    // Far Periphery (>8°): Aggressive scatter and dissolution
    // FIX: Replaced hard jump (0.15 -> 1.0) with smooth ramp to prevent "ring" artifact
    
    // We ramp from 0.15 (Parafovea level) to 1.0 (Periphery level)
    // Transition zone: Start of Far Periphery -> +30% raidus
    float transitionWidth = parafovea_radius * 0.3;
    float boundaryProgress = smoothstep(parafovea_radius, parafovea_radius + transitionWidth, dist);
    float eccentricityScale = mix(0.15, 1.0, boundaryProgress); 
    
    // FAR PERIPHERY DISTORTION BOOST
    // Continue increasing distortion linearly beyond the transition zone
    // to prevent the effect from plateauing at screen edges.
    if (boundaryProgress >= 1.0) {
        float deepDist = max(0.0, dist - (parafovea_radius + transitionWidth));
        eccentricityScale += deepDist * 2.5; // 2.5x linear increase
    }
    
    // Cyberpunk/Wireframe Override: We want structural distortion (blocks) to start immediately
    // in the parafovea to create a strong "tech" aesthetic.
    if (config.v4_style_id == 4 || config.v4_style_id == 3) {
        eccentricityScale = 1.0;
    }
    
    float strength = lgn.suppressionFactor * config.v1_strength_mult * eccentricityScale;
    
    // VISUAL MEMORY MODULATION
    // If this area is remembered (memoryStrength > 0), we must reduce distortion
    // to ensure the underlying geometry aligns with the clear overlay.
    // ONLY APPLY IN STANDARD MODE (1.0). In Inhibition mode (2.0), we want distortion!
    if (u_useMask < 1.5) {
        strength *= (1.0 - memoryStrength);
    }
    
    signal.distortionStrength = strength;
    
    signal.distortionStrength = strength;
    
    // === DOUBLE VISION MODE (Flowing Wave) ===
    if (config.v4_style_id == 5) {
        // Flowing Wave: Faster, stronger, more fluid than "Slow Wave"
        float waveSpeed = 0.5; 
        float waveFreq = 3.0;
        
        float waveX = sin(uv.y * waveFreq + u_time * waveSpeed);
        float waveY = cos(uv.x * waveFreq + u_time * waveSpeed * 0.7);
        
        // Higher amplitude for "Double Vision" feel
        vec2 waveOffset = vec2(waveX, waveY) * 0.015 * strength * u_intensity;
        
        signal.displacement = waveOffset;
        signal.distortedUV = uv + signal.displacement;
        signal.distortionStrength = strength;
        return signal;
    }

    if (config.v1_distortion_type == 2) {
        // None (but strength is passed to V4)
        return signal;
    }
    
    if (config.v1_distortion_type == 1) {
        // === SHATTER (Mongrel) -> REPLACED WITH SLOW WAVE (Comfort Mode) ===
        // User requested to remove rapid glitching.
        // We replace the high-freq jitter with a slow, smooth sine wave warp.
        
        // Slow Wave Distortion
        // Frequency: Very Low (0.1 Hz) - barely moving
        // Amplitude: Reduced for subtlety
        
        float waveSpeed = 0.1; // Was 0.5
        float waveFreq = 2.0;  // Was 4.0
        
        // Create a slow rolling wave
        float waveX = sin(uv.y * waveFreq + u_time * waveSpeed);
        float waveY = cos(uv.x * waveFreq + u_time * waveSpeed * 0.8);
        
        // Amplitude scales with strength (eccentricity)
        // Parafovea: Tiny warp
        // Periphery: Larger warp
        
        // Saliency Stabilization
        // Dampen wave amplitude in high-saliency areas to prevent "breathing" artifacts on faces/text.
        float waveDampener = 1.0;
        if (u_enable_saliency_modulation > 0.5) {
            // Reduce wave by up to 90% in highly salient areas
            waveDampener = 1.0 - (lgn.saliency * 0.9);
        }
        
        vec2 waveOffset = vec2(waveX, waveY) * 0.001 * strength * u_intensity * waveDampener; // Reduced from 0.005
        
        signal.displacement = waveOffset;
        signal.distortedUV = uv + signal.displacement;
        signal.distortionStrength = strength;
        
    } else if (config.v1_distortion_type == 0) {
        // === TIER 1.8.1: LATERAL SMASH (Anisotropic Crowding) ===
        // "The Melter" v2 - Aggressive horizontal crowding.
        
        vec2 uv_corrected = vec2(uv.x * u_fovea_aspect_ratio, uv.y);
        
        // 1. Micro-Noise (Stroke Melting)
        // INCREASED Frequency: 900.0 (was 800.0) to target thinner components.
        // INCREASED Amplitude: 0.004 (was 0.002) to bridge gaps between letters.
        // Gated by u_v1_animate to allow "Freezing" for tests/screenshots.
        float t = u_time * u_v1_animate;
        float micro = snoise(uv_corrected * 900.0 + vec2(t * 5.0)); 
        
        // 2. Macro-Noise (Word Shape Wobble)
        float macro = snoise(uv_corrected * 20.0 + vec2(t * 0.1));
        
        // 3. Combine
        // micro * 0.004 (high amp) + macro * 0.01 (structure)
        vec2 warp = vec2(micro * 0.004 + macro * 0.01);
        
        // 4. Horizontal Bias (Lateral Smash)
        // INCREASED: 6.0x (was 2.0x).
        // This forces letters to slide into each other laterally.
        warp.x *= 6.0;
        
        // 5. Apply Strength
        signal.displacement = warp * strength * u_intensity;
        
        signal.distortedUV = uv + signal.displacement;
        signal.distortionStrength = strength;
    } else if (config.v1_distortion_type == 3) {
        // === PIXELATE (Saliency-Guided) ===
        // Variable block size based on content density/saliency
        float combinedMetric = max(lgn.saliency, lgn.density);
        // Stepped metric for distinct block levels
        float steppedMetric = floor(combinedMetric * 4.0) / 4.0;
        
        // Target Max Block Size: HUGE blocks for "Minecraft" look
        float targetMaxBlock = 192.0;
        float targetMinBlock = 32.0; 
        
        // Cyberpunk: 3-5x larger blocks as requested
        if (config.v4_style_id == 4) {
            targetMaxBlock = 1200.0; // Massive blocks (was 800)
            targetMinBlock = 160.0;  // Big start (was 128)
        }
        
        float limitBlockSize = mix(targetMaxBlock, targetMinBlock, steppedMetric);
        
        // Modulate ACTUAL block size by strength (distance from fovea)
        // "Squarified Pixels": Quantize block size to powers of 2 to avoid radial moire.
        // This creates distinct "rings" of resolution (1, 2, 4, 8, 16...) instead of a smooth warp.
        float logMax = log2(limitBlockSize);
        float logCurrent = strength * logMax;
        float currentBlockSize = exp2(floor(logCurrent));
        
        currentBlockSize = max(1.0, currentBlockSize);
        
        vec2 pixelSize = vec2(currentBlockSize) / u_resolution;
        vec2 quantizedUV = floor(uv / pixelSize) * pixelSize + pixelSize * 0.5;
        
        // Glitch Displacement (Big Blocky Shifts)
        float motionGate = smoothstep(0.1, 5.0, u_velocity); 
        
        if (strength > 0.5 && steppedMetric < 0.5 && motionGate > 0.01) {
            float blockNoise = rand(quantizedUV + vec2(floor(u_time * 10.0))); 
            float threshold = 0.92 + (1.0 - motionGate) * 0.08; 
            
            if (blockNoise > threshold) { 
                float shift = (blockNoise - threshold) * 2.0; 
                quantizedUV.x += shift * 0.2 * strength * motionGate; 
            }
        }
        
        // Optimization: If strength is effectively zero (fovea), use exact UVs
        if (strength < 0.01) {
            signal.distortedUV = uv;
        } else {
            signal.distortedUV = quantizedUV;
        }
        signal.distortionStrength = strength;
    }
    
    return signal;
}

// --- STAGE 3: V4 (Aesthetics) ---
vec3 processV4(vec2 uv, V1_Signal v1, LGN_Signal lgn, ModeConfig config, float dist, float fovea_radius, float parafovea_radius, float saccadeFactor) {
    // === MIP-BASED POOLING (Mongrel Tier 1) ===
    // Uses hardware MIP-maps to approximate biological receptive field growth.
    // Replaces the previous 5-tap blur with true pooling.
    
    float eccentricity = max(0.0, dist - fovea_radius);
    
    // Always sample at MIP level 0 for fovea (guaranteed sharp)
    vec3 foveaCol = sampleSource(v1.distortedUV).rgb;
    
    // For periphery, use MIP pooling
    // Intensity modulates the pooling strength (lower intensity = less aggressive pooling)
    // TIER 1.8: COUPLED POOLING
    // We link the blur radius (MIP level) directly to the distortion strength.
    // This ensures that if Saliency/LGN suppresses the warp, the blur also vanishes.
    // MODIFIED for Saccadic Suppression:
    // Scale the effective eccentricity by u_blurRadius.
    // u_blurRadius range: 2.0 (Gather) -> 10.0 (Hunt)
    // Old Baseline: 2.0
    // New Gather: 2.0 * 0.3 + 1.0 = 1.6 (Slightly sharper than baseline, rewarding focus)
    // New Hunt:  10.0 * 0.3 + 1.0 = 4.0 (Double baseline, creating tunnel vision)
    float blurMult = 1.0 + (u_blurRadius * 0.3);
    float coupledEccentricity = v1.distortionStrength * u_intensity * fovea_radius * blurMult;
    vec3 pooledCol = sampleMIPPooled(v1.distortedUV, coupledEccentricity, fovea_radius).rgb;
    
    // Smooth blend from fovea to periphery to eliminate visible boundary
    // Blend zone: from fovea_radius to fovea_radius * 1.1 (10% transition band)
    // Intensity also modulates the blend factor to reduce pooling at low settings
    float baseBlend = smoothstep(0.0, fovea_radius * 0.1, eccentricity);
    float blendFactor = baseBlend * u_intensity;
    vec3 col = mix(foveaCol, pooledCol, blendFactor);
    
    // === MAGNOCELLULAR PATHWAY: Luminance Contrast Preservation ===
    // M-cells are highly sensitive to luminance (brightness) but blind to color/detail.
    // Even when the image is heavily distorted, the M-pathway preserves contrast.
    // This ensures a blue link on white background stays clearly distinct.
    // Note: Uses smooth ramp instead of hard boundary to avoid visible ring artifacts.
    if (eccentricity > 0.001) {
        vec3 cleanSample = sampleSource(uv).rgb; // Original, undistorted
        float cleanLuma = dot(cleanSample, vec3(0.299, 0.587, 0.114));
        float distortedLuma = dot(col, vec3(0.299, 0.587, 0.114));
        
        // Prevent division by zero
        float lumaRatio = cleanLuma / max(distortedLuma, 0.01);
        
        // Smooth contrast preservation: ramp in over same blend zone as MIP pooling
        // This ensures no additional visible boundary
        float contrastRamp = smoothstep(0.0, fovea_radius * 0.1, eccentricity);
        
        // Gradually reduce preservation strength with distance
        float contrastPreservation = mix(0.6, 0.3, smoothstep(0.0, parafovea_radius - fovea_radius, eccentricity));
        col *= mix(1.0, lumaRatio, contrastPreservation * contrastRamp);
    }
    
    // === ARCHITECTURAL GUARANTEE: FOVEA PROTECTION ===
    // The fovea must remain 100% authentic to the source.
    // We enforce a hard bypass if we are within the foveal radius.
    // Use 50% of fovea_radius as safety margin to ensure the transition
    // starts well outside the critical vision area.
    // We enforce a hard bypass if we are within the foveal radius.
    // Use 50% of fovea_radius as safety margin to ensure the transition
    // starts well outside the critical vision area.
    if (dist < fovea_radius * 0.5) {
        return col;
    }

    float effectFactor = v1.distortionStrength; // Use the actual applied strength
    
    // Smooth Transition from Hard Bypass
    // The bypass ends at fovea_radius * 0.5. We must ramp the effect up from there
    // to avoid a hard jump in intensity (since effectFactor is likely high there).
    float bypassTransition = smoothstep(fovea_radius * 0.5, fovea_radius * 0.7, dist);

    if (config.v4_style_id == 0) { // High-Key (Now: Desaturated)
        
        // === CHROMATIC ABERRATION (CA) ===
        // User Formula: distDithered = dist + noise * 0.3
        // caStrength = smoothstep(periphery_start, periphery_start + 0.25, distDithered)
        
        // === SALIENCY DAMPENING (Partial Protection) ===
        // High saliency/structure gets LESS desaturation/CA, but not zero.
        // We mix from 1.0 (full effect) to 0.85 (high effect) based on protection level.
        // Was 0.5, which let too much color through for thumbnails.
        float protection = max(lgn.saliency, lgn.density);
        float dampener = mix(1.0, 0.85, protection);
        
        // Combined Strength Multiplier
        // Controlled by global intensity slider AND local saliency
        // REMAPPED: Desaturation reaches full strength at 0.6 intensity
        // This ensures strong "Rod Vision" even at moderate distortion levels.
        float desatIntensity = smoothstep(0.0, 0.6, u_intensity);
        float strengthMult = desatIntensity * dampener;

        float noiseVal = (rand(uv) - 0.5);
        float distDithered = dist + noiseVal * 0.3;
        
        // Recalculate periphery_start (radius_norm * 1.2)
        float periphery_start = fovea_radius * 1.2;
        
        // CRITICAL FIX: Use clean dist for CA, not dithered
        // Dithered distance was causing CA to appear in random vertical lines
        float caFactor = smoothstep(periphery_start, periphery_start + 0.25, dist);
        
        // Apply Strength Modulation to CA
        caFactor *= strengthMult;
        
        // Apply CA if factor > 0
        if (caFactor > 0.01) {
            // Use ungated factor for CA strength too, or just the calculated caFactor
            // Let's use caFactor directly as it's distance based.
            float offset = 0.005 * caFactor; 
            vec2 caOffset = vec2(offset, 0.0); 
            
            col.r = sampleSource(v1.distortedUV + caOffset).r;
            col.b = sampleSource(v1.distortedUV - caOffset).b;
        }

        // === ROD VISION AESTHETIC (OKLAB) ===
        // Convert to Oklab for perceptually uniform desaturation
        vec3 lab = rgbToOklab(col);
        
        // 1. Contrast Boost on Lightness
        // Rods have high contrast sensitivity
        float contrast = 1.2;
        float L_contrasted = (lab.x - 0.5) * contrast + 0.5;
        L_contrasted = clamp(L_contrasted, 0.0, 1.0);
        
        // 2. Eigengrau Tint in Oklab Space
        // Eigengrau (dark blue-gray) in Oklab: L ≈ 0.1, a ≈ 0, b ≈ -0.05 (blue shift)
        vec3 eigengrauLab = vec3(0.1, 0.0, -0.05);
        vec3 whiteLab = vec3(1.0, 0.0, 0.0);
        
        // Map lightness: dark → eigengrau, bright → white
        vec3 rodColorLab = mix(eigengrauLab, whiteLab, L_contrasted);
        
        // Convert rod color back to RGB for grain
        vec3 rodColor = oklabToRgb(rodColorLab);
        
        // 3. Grain (applied in RGB space)
        float grainStrength = 0.08;
        rodColor += noiseVal * grainStrength;
        rodColor = clamp(rodColor, 0.0, 1.0);
        
        // === DECOUPLED DESATURATION (OKLAB) ===
        // Calculate desaturation strength purely based on distance, IGNORING LGN gating.
        // This ensures "Rod Vision" applies to everything in the periphery (including Reddit logo).
        float rampEnd = fovea_radius * config.lgn_ramp_end_mult;
        float desaturationFactor = smoothstep(fovea_radius, rampEnd, dist);
        
        // Apply Strength Modulation to Desaturation
        desaturationFactor *= strengthMult;
        
        // Saliency Modulation (Phase 3): Conservative rod vision relief
        // Far-periphery only, leverages temporal smoothing
        if (u_enable_saliency_modulation > 0.5 && dist > parafovea_radius) {
            float s = lgn.saliency;
            // 15% max reduction in desaturation at maximum saliency
            // Allows salient areas to retain slightly more color
            float rodMod = mix(1.0, 0.85, s);
            desaturationFactor *= rodMod;
        }
        
        // Desaturate in Oklab space by reducing chrominance
        vec3 desaturatedLab = lab;
        desaturatedLab.y *= (1.0 - desaturationFactor * bypassTransition); // a component
        desaturatedLab.z *= (1.0 - desaturationFactor * bypassTransition); // b component
        
        // Convert desaturated color back to RGB
        vec3 desaturatedColor = oklabToRgb(desaturatedLab);
        
        // Mix between desaturated color and rod color (eigengrau-tinted)
        // Higher desaturation factor → more rod color influence
        vec3 finalColor = mix(desaturatedColor, rodColor, desaturationFactor * bypassTransition * 0.3);
        return finalColor;
        
    } else if (config.v4_style_id == 1) { // Oklab (formerly "Lab")
        // === CHROMATIC ABERRATION (Copied from Default) ===
        float noiseVal = (rand(uv) - 0.5);
        
        // Saliency Dampening for CA
        float protection = max(lgn.saliency, lgn.density);
        float dampener = mix(1.0, 0.85, protection);
        float strengthMult = smoothstep(0.0, 0.6, u_intensity) * dampener;
        
        float periphery_start = fovea_radius * 1.2;
        float caFactor = smoothstep(periphery_start, periphery_start + 0.25, dist);
        caFactor *= strengthMult;
        
        if (caFactor > 0.01) {
            float offset = 0.005 * caFactor; 
            vec2 caOffset = vec2(offset, 0.0); 
            
            col.r = sampleSource(v1.distortedUV + caOffset).r;
            col.b = sampleSource(v1.distortedUV - caOffset).b;
        }

        // Use actual Oklab color space for desaturation
        vec3 lab = rgbToOklab(col);
        
        // Create rod-like color in Oklab space
        // Dark blue-gray tint with preserved lightness
        vec3 rodColorLab = vec3(
            lab.x * 0.96, // Slightly reduce lightness
            0.0,          // No green-red
            -0.05         // Slight blue shift
        );
        
        // Convert to RGB and add grain
        vec3 rodColor = oklabToRgb(rodColorLab);
        rodColor += (rand(uv) - 0.5) * 0.1;
        
        // Saccade suppression (darken during rapid eye movement)
        rodColor = mix(rodColor, vec3(0.01), saccadeFactor * 0.9);
        
        // DECOUPLED DESATURATION (Like Default)
        // Use distance-based ramp instead of geometry strength
        float rampEnd = fovea_radius * config.lgn_ramp_end_mult;
        float desaturationFactor = smoothstep(fovea_radius, rampEnd, dist);
        desaturationFactor *= strengthMult;
        
        // Saliency Modulation
        if (u_enable_saliency_modulation > 0.5 && dist > parafovea_radius) {
            float s = lgn.saliency;
            float rodMod = mix(1.0, 0.85, s);
            desaturationFactor *= rodMod;
        }
        
        // Mix based on desaturation factor
        return mix(col, rodColor, desaturationFactor);
        
    } else if (config.v4_style_id == 2) { // Frosted
        // Simple blur/desaturate
        vec3 frosted = mix(col, vec3(0.9), 0.3);
        return mix(col, frosted, effectFactor * 0.7 * bypassTransition);
        
    } else if (config.v4_style_id == 3) { // Wireframe (Gestalt)
        // === QUANTIZED WIREFRAME (Gestalt) ===
        // V1 is now forced to Type 3 (Pixelate), so v1.distortedUV is already blocky.
        
        // 1. Detect Edges on the PIXELATED UVs
        // This naturally finds the edges between the V1 blocks.
        float edge = sobel(v1.distortedUV);
        
        // 2. Compute Edge Intensity
        // Crisp lines
        float edgeIntensity = smoothstep(0.05, 0.1, edge);
        
        // 3. Aesthetic Coloring
        // User requested NO desaturation.
        // We use the original (blurred) color as the base.
        vec3 baseColor = col;
        
        // Lines: Cyan/White
        // Modulate line brightness by saliency
        // Sample saliency using the distorted UVs to match the blocks
        float s = texture(u_saliencyMap, v1.distortedUV).r; 
        vec3 lineCol = mix(vec3(0.0, 0.4, 0.6), vec3(0.5, 0.9, 1.0), s);
        
        // Overlay lines on top of base color
        // We add the lines to the base color (Screen/Add blend) or Mix?
        // Mix ensures visibility.
        return mix(baseColor, lineCol, edgeIntensity);
        
    } else if (config.v4_style_id == 4) { // Cyberpunk (Neon)
            // Pixelation is handled in V1 (now with larger blocks).
            
            // Clean up Fovea
            float cleanFactor = smoothstep(0.4, 0.8, effectFactor);
            
            // 1. Solid Fill (Halftone-ish)
            // Boost saturation significantly for that "Neon" look
            float luma = dot(col, vec3(0.299, 0.587, 0.114));
            vec3 saturated = mix(vec3(luma), col, 1.8); 
            
            // 2. Progressive Contrast Boost
            // "Ideally we'd do so progressively from the parafovea outward"
            // Ramp contrast from 1.0 (fovea) to 2.0 (periphery)
            float contrastRamp = smoothstep(fovea_radius, parafovea_radius * 2.0, dist);
            float contrastAmount = mix(1.0, 2.5, contrastRamp); // Strong contrast in periphery
            
            vec3 contrasted = (saturated - 0.5) * contrastAmount + 0.5;
            
            // 3. Halftone / Texture
            // Simple dot pattern or noise
            vec2 pixelUV = uv * u_resolution;
            float dotPattern = sin(pixelUV.x * 0.5) * sin(pixelUV.y * 0.5); // High freq grid
            
            // Mix texture: mostly solid (0.9), tiny bit of texture (0.1)
            vec3 textured = contrasted * (0.95 + 0.05 * dotPattern);
            
            // Clamp results
            vec3 finalColor = clamp(textured, 0.0, 1.0);
            
            // Apply bypassTransition to ensure smooth start
            return mix(col, finalColor, cleanFactor * bypassTransition);
    } else if (config.v4_style_id == 5) { // Double Vision (Fractal/Ooze)
        // CLEAN DOUBLE VISION: Just the flowing wave + saturation boost
        // Removed the "Oil Slick" (Red/Green) pattern as requested.
        
        // 1. Saturation Boost
        float luma = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 saturated = mix(vec3(luma), col, 1.6); // Strong saturation
        
        // 2. Subtle Fractal Noise Overlay (Optional, keeping it very subtle)
        // Use distorted UVs for organic feel
        vec2 warpUV = v1.distortedUV * 2.0;
        float n = snoise(warpUV + vec2(u_time * 0.1));
        float subtleNoise = n * 0.05 * effectFactor;
        
        vec3 finalColor = clamp(saturated + subtleNoise, 0.0, 1.0);
        
        return mix(col, finalColor, effectFactor * bypassTransition);
    }
    
    return col;
}

void main() {
    float aspect = u_resolution.x / u_resolution.y;
    vec2 uv = v_texCoord;
    vec2 uv_corrected = vec2(uv.x * aspect, uv.y);
    
    vec2 mouse_uv = u_mouse / u_resolution;
    vec2 mouse_corrected = vec2(mouse_uv.x * aspect, mouse_uv.y);
    
    vec2 delta = uv_corrected - mouse_corrected;
    delta.x /= u_fovea_aspect_ratio; 
    float dist = length(delta); 

    // Stable Mouse
    vec2 mouse_stable_uv = u_mouse_stable / u_resolution;
    vec2 mouse_stable_corrected = vec2(mouse_stable_uv.x * aspect, mouse_stable_uv.y);
    vec2 delta_stable = uv_corrected - mouse_stable_corrected;
    delta_stable.x /= u_fovea_aspect_ratio;
    float dist_stable = length(delta_stable); 

    float radius_norm = u_foveaRadius / u_resolution.y;
    float fovea_radius = radius_norm;
    float parafovea_radius = radius_norm * 2.5; // Macula: 0-5° (2.5x fovea)
    
    bool isParafovea = dist_stable > fovea_radius && dist_stable <= parafovea_radius;
    bool isFarPeriphery = dist_stable > parafovea_radius; 
    
    // --- CONFIGURATION (The "Hooks") ---
    ModeConfig config;
    
    // Map Uniforms to Config Struct
    config.lgn_use_structure_mask = u_lgn_use_structure_mask > 0.5;
    config.lgn_use_saliency_gate = u_lgn_use_saliency_gate > 0.5;
    config.v1_distortion_type = u_v1_distortion_type;
    config.v1_strength_mult = u_v1_strength_mult;
    config.v4_style_id = u_v4_style_id;
    config.lgn_ramp_end_mult = u_lgn_ramp_end_mult;
    config.v1_animate = u_v1_animate > 0.5;
    
    // === DOUBLE VISION MODE OVERRIDE ===
    // "Psychologically plausible as LGN is the stream separator"
    // In a psychedelic state, the LGN's gating function is compromised, leading to
    // a flood of unfiltered information (stream integration).
    if (config.v4_style_id == 5) {
        config.lgn_use_structure_mask = false;
        config.lgn_use_saliency_gate = false;
    }
    
    // Override V1 type if Mongrel Mode uniform says so (Legacy Toggle Support)
    // Only applies if we are in a "standard" mode (Shatter/Noise) to avoid breaking Cyberpunk/Blueprint
    if (config.v4_style_id != 5 && config.v1_distortion_type != 2 && config.v1_distortion_type != 3) {
        if (u_mongrel_mode < 0.5) {
            config.v1_distortion_type = 0; // Noise
        }
        else config.v1_distortion_type = 1; // Shatter
    }
    
    // Force Pixelate (Type 3) for Wireframe (Style 3) to get "rectangular closed shapes"
    if (config.v4_style_id == 3) {
        config.v1_distortion_type = 3;
    }

    // --- PIPELINE EXECUTION ---
    
    // 0. Early Mask Sampling (Visual Memory)
    // We need this for LGN gating AND V1 modulation
    float memoryStrength = 0.0;
    if (u_useMask > 0.5) {
        float rawMask = texture(u_maskTexture, v_texCoord).r;
        // Apply gain to snap to 1.0 (anti-ghosting)
        memoryStrength = smoothstep(0.0, 0.5, rawMask);
    }

    // 1. LGN: Analysis & Gating
    // Pass memoryStrength to LGN (we'll need to update the struct/function signature or just pass it)
    // Actually, let's just pass it to V1 directly since it's a geometric constraint.
    LGN_Signal lgn = processLGN(uv, config, dist, fovea_radius);
    
    // 2. V1: Geometry
    // Modulate V1 with memoryStrength to prevent "unremembering" (discontinuity)
    V1_Signal v1 = processV1(uv, uv_corrected, lgn, config, dist_stable, fovea_radius, parafovea_radius, isFarPeriphery, isParafovea, memoryStrength);
    
    // 3. V4: Aesthetics
    float saccadeFactor = smoothstep(4.0, 10.0, u_velocity);
    vec3 finalRGB = processV4(uv, v1, lgn, config, dist, fovea_radius, parafovea_radius, saccadeFactor);
    
    // === PARAFOVEAL ENHANCEMENTS (Pivot) ===
    // 1. Saturation Boost (2-5° region)
    // Boost saturation to compensate for lower acuity and guide attention.
    if (isParafovea) {
        vec3 col = finalRGB;
        float luma = dot(col, vec3(0.299, 0.587, 0.114));
        // Boost saturation by mixing away from grayscale
        // 20% boost seems appropriate for "slightly boost"
        finalRGB = mix(vec3(luma), col, 1.2); 
    }

    // 2. Peripheral Vignetting (>5°)
    // REMOVED: User feedback indicated this was an antipattern (dimming).
    // Keeping the block commented out for reference or future toggle.
    /*
    if (isFarPeriphery) {
        float vignetteDist = dist - parafovea_radius;
        float vignetteFactor = smoothstep(0.0, 0.5, vignetteDist);
        finalRGB *= mix(1.0, 0.7, vignetteFactor);
    }
    */
    
    // --- POST-PROCESSING (Rod Vision, Masking, Debug) ---
    
    vec4 color = vec4(finalRGB, 1.0);

    // Rod Vision / Scrollbar Check
    float scrollbarWidth = 17.0;
    float distFromRightEdge = u_resolution.x - (uv.x * u_resolution.x);
    bool isScrollbar = distFromRightEdge < scrollbarWidth;
    
    if (!isScrollbar) {
        // Visual Memory Mask (Post-Process Overlay)
        // We still overlay the clear image to ensure pixel-perfect clarity,
        // but now the underlying distortion (v1) should align with it.
        // ONLY IN STANDARD MODE (u_useMask < 1.5) and NOT IN DEBUG MODE
        // We disable visual memory during structure debug so the overlay isn't washed out by the clear image.
        if (u_useMask < 1.5 && u_useMask > 0.5 && u_debug_structure < 0.5) {
            if (memoryStrength > 0.9) {
            // Use sampleSource for guaranteed correct color
            vec4 clearColor = sampleSource(uv);
            color.rgb = clearColor.rgb;
        } else if (memoryStrength > 0.0) {
            vec4 clearColor = sampleSource(uv);
            color.rgb = mix(color.rgb, clearColor.rgb, memoryStrength);
        }
        }
    }
    
    // Force Debug OFF for Cyberpunk
    float debugLevel = u_debug_structure;
    if (config.v4_style_id == 4) debugLevel = 0.0;
    
    // DEBUG VIEW STANDARDIZATION:
    // If debugging, we replace the simulated/foveated view with the CLEAN source.
    // This ensures:
    // 1. Uniform brightness (no foveal "holes" in the overlay).
    // 2. Perfect alignment (Structure Map overlay matches undistorted Page).
    if (debugLevel > 0.5) {
        color = sampleSource(uv);
    }
    
    // Debug Visualization
    if (debugLevel > 2.5) {
        float mask = texture(u_maskTexture, v_texCoord).r;
        color.rgb = vec3(mask);
    } else if (debugLevel > 1.5) {
        // Heatmap for Saliency (Grayscale)
        // User Preference: Pure B&W is clearer for polarity
        // Use RAW saliency to bypass LGN inhibition/gating
        float s = texture(u_saliencyMap, v_texCoord).r;
        color.rgb = vec3(s);
    } else if (debugLevel > 0.5) {
        // Use RAW structure density to bypass LGN inhibition ("holes")
        float rawDensity = texture(u_structureMap, v_texCoord).g;
        if (rawDensity > 0.0) {
            color.rgb = mix(color.rgb, vec3(1.0, 0.0, 0.0), 0.5 * rawDensity);
        }
    }
    
    // Debug Boundary
    if (u_debug_boundary > 0.5) {
        vec2 diff = uv_corrected - mouse_corrected;
        float angle = atan(diff.y, diff.x);
        
        // --- MODE 1: BASIC FOVEAL OVERLAY ---
        if (u_debug_boundary > 0.5) { 
            float fw = fwidth(dist);
            
            // 1. Light Continuous Oval Stroke
            float borderDist = abs(dist - fovea_radius);
            float borderAlpha = 1.0 - smoothstep(0.0, fw * 2.0, borderDist);
            if (borderAlpha > 0.0) {
                color.rgb = mix(color.rgb, vec3(0.0, 1.0, 1.0), borderAlpha * 0.4);
            }

            // 2. Outward Ticks
            float tickLength = 0.015; // Longer ticks
            // Only draw outside fovea
            if (dist > fovea_radius && dist < fovea_radius + tickLength) {
                float tickRadial = 1.0; 
                // Fade out at tip
                tickRadial *= (1.0 - smoothstep(fovea_radius + tickLength * 0.5, fovea_radius + tickLength, dist));
                
                // Angular gaps
                float tickWidth = smoothstep(0.97, 0.98, cos(angle * 12.0)); // 12 ticks
                
                float tickAlpha = tickRadial * tickWidth;
                if (tickAlpha > 0.0) {
                    color.rgb = mix(color.rgb, vec3(0.0, 1.0, 1.0), tickAlpha * 0.9);
                }
            }
        }

        // --- MODE 2: PARAFOVEAL BOUNDARY ---
        if (u_debug_boundary > 1.5) { 
            float visualParafoveaRadius = parafovea_radius; 
            float parafoveaDist = abs(dist - visualParafoveaRadius);
            float fw = fwidth(parafoveaDist);
            
            // "More Ink": Thicker line and smaller gaps
            // Thicker: fw * 3.0
            float ringPresence = 1.0 - smoothstep(0.0, fw * 3.0, parafoveaDist);
            
            // Dashed pattern: sin(angle * 60) > -0.2 (Less gap)
            float dashPattern = smoothstep(-0.2, 0.1, sin(angle * 60.0));
            
            float ringAlpha = ringPresence * dashPattern;
            
            if (ringAlpha > 0.0) {
                color.rgb = mix(color.rgb, vec3(1.0, 0.5, 0.0), ringAlpha * 0.85);
            }
        }

        // --- MODE 3: SCIENTIFIC RADIAL GRID (HI-TECH) ---
        if (u_debug_boundary > 2.5) {
             // Grid starts at parafovea
             if (dist > parafovea_radius) {
                // A. Exponential Rings
                // dist = r0 * k^n  =>  n = log(dist/r0) / log(k)
                float r0 = parafovea_radius;
                float expansionFactor = 1.4; // How fast rings grow
                
                float n = log(dist / r0) / log(expansionFactor);
                float n_idx = round(n);
                float dist_to_ring = abs(n - n_idx);
                
                // Ring thickness
                float ringWidth = 0.02; // In "log space"
                float ringAlpha = 1.0 - smoothstep(0.0, ringWidth, dist_to_ring);
                
                // B. Radial Spokes
                // 16 spokes
                float spokeWidth = smoothstep(0.995, 0.998, cos(angle * 16.0));
                
                // Combine Grid
                float gridAlpha = max(ringAlpha, spokeWidth);
                
                // Distance Fade (optional, keep it clean for now)
                // Make it look "Hi-Tech" -> Low Alpha, Cyan/Blue
                vec3 gridColor = vec3(0.0, 0.8, 1.0); // Cyan-ish
                
                if (gridAlpha > 0.0) {
                    // Subtle additive overlay
                    color.rgb = mix(color.rgb, gridColor, gridAlpha * 0.15);
                    color.rgb += gridColor * gridAlpha * 0.1; // Additive bloom
                }
             }
        }
    }
    
    fragColor = color;
}