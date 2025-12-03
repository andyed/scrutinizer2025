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
vec4 sampleSource(vec2 uv) {
    vec4 col = texture(u_texture, uv);
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
    int  v4_style_id;            // 0=HighKey, 1=Lab, 2=Frosted, 3=Blueprint, 4=Cyberpunk, 5=Trippy
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
    
    // 4. Saliency Gating (Fidelity Bias)
    if (config.lgn_use_saliency_gate && u_enable_saliency_modulation > 0.5) {
        signal.suppressionFactor *= (1.0 - signal.saliency);
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
    float eccentricityScale = isFarPeriphery ? 1.0 : 0.15; 
    
    // Cyberpunk/Wireframe Override: We want structural distortion (blocks) to start immediately
    // in the parafovea to create a strong "tech" aesthetic.
    if (config.v4_style_id == 4 || config.v4_style_id == 3) {
        eccentricityScale = 1.0;
    }
    
    float strength = lgn.suppressionFactor * config.v1_strength_mult * eccentricityScale;
    
    // VISUAL MEMORY MODULATION
    // If this area is remembered (memoryStrength > 0), we must reduce distortion
    // to ensure the underlying geometry aligns with the clear overlay.
    // memoryStrength 1.0 -> strength 0.0
    strength *= (1.0 - memoryStrength);
    
    signal.distortionStrength = strength;
    
    signal.distortionStrength = strength;
    
    // === TRIPPY MODE (Flowing Wave) ===
    if (config.v4_style_id == 5) {
        // Flowing Wave: Faster, stronger, more fluid than "Slow Wave"
        float waveSpeed = 0.5; 
        float waveFreq = 3.0;
        
        float waveX = sin(uv.y * waveFreq + u_time * waveSpeed);
        float waveY = cos(uv.x * waveFreq + u_time * waveSpeed * 0.7);
        
        // Higher amplitude for "Trippy" feel
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
        
        vec2 waveOffset = vec2(waveX, waveY) * 0.005 * strength * u_intensity * waveDampener;
        
        signal.displacement = waveOffset;
        signal.distortedUV = uv + signal.displacement;
        signal.distortionStrength = strength;
        
    } else if (config.v1_distortion_type == 0) {
        // === NOISE (Curves/Ooze) ===
        // Calculate warp strength specifically for noise (different falloff than shatter usually)
        // But we use the LGN passed strength for consistency now.
        
        vec2 uv_noise = vec2(uv_corrected.x / u_fovea_aspect_ratio, uv_corrected.y);
        
        // Add time offset if animated
        vec2 timeOffset = vec2(0.0);
        if (config.v1_animate) {
            timeOffset = vec2(sin(u_time * 0.2), cos(u_time * 0.15)) * 10.0;
        }
        
        float coarseScaleX = isFarPeriphery ? 2000.0 : 200.0;
        float coarseScaleY = isFarPeriphery ? 1000.0 : 100.0;
        float n1 = snoise(vec2(uv_noise.x * coarseScaleX, uv_noise.y * coarseScaleY) + timeOffset);
        float n2 = snoise(vec2(uv_noise.x * coarseScaleX, uv_noise.y * coarseScaleY) + vec2(50.0, 50.0) - timeOffset);
        
        vec2 warpAmp = isFarPeriphery ? vec2(0.005, 0.004) : vec2(0.001, 0.0001);
        
        // Saliency Modulation (Phase 2): Conservative, far-periphery only
        float saliencyWarpMod = 1.0;
        if (u_enable_saliency_modulation > 0.5 && isFarPeriphery) {
            float s = lgn.saliency;
            // 25% max warp reduction at maximum saliency
            saliencyWarpMod = mix(1.0, 0.75, s);
        }
        
        vec2 warpVector = vec2(n1, n2) * warpAmp * strength * u_intensity * saliencyWarpMod;
        
        // Add "breathing" motion to strength if animated
        if (config.v1_animate) {
            warpVector *= (1.0 + 0.2 * sin(u_time * 1.5));
        }
        
        signal.displacement = warpVector; // Simplified for brevity, jitter added in full impl
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
    // === VARIABLE BLUR (Gaussian Roll-off) ===
    // Calculate blur radius based on eccentricity
    float blurRadius = 0.0;
    
    if (dist > fovea_radius) {
        if (dist <= parafovea_radius) {
            // Parafovea (2-5°): 1px to 3px
            float t = (dist - fovea_radius) / (parafovea_radius - fovea_radius);
            blurRadius = mix(0.0, 3.0, t);
        } else {
            // Periphery (>5°): 3px to 15px+
            // Exponential increase
            float distFromPara = dist - parafovea_radius;
            blurRadius = 3.0 + distFromPara * 40.0; // Rapid increase
        }
    }
    
    // Use sampleBlurred instead of raw sampleSource
    vec3 col = sampleBlurred(v1.distortedUV, blurRadius).rgb;
    
    // === MAGNOCELLULAR PATHWAY: Luminance Contrast Preservation ===
    // M-cells are highly sensitive to luminance (brightness) but blind to color/detail.
    // Even when the image is heavily distorted, the M-pathway preserves contrast.
    // This ensures a blue link on white background stays clearly distinct.
    if (dist > fovea_radius) {
        vec3 cleanSample = sampleSource(uv).rgb; // Original, undistorted
        float cleanLuma = dot(cleanSample, vec3(0.299, 0.587, 0.114));
        float distortedLuma = dot(col, vec3(0.299, 0.587, 0.114));
        
    // Prevent division by zero
        float lumaRatio = cleanLuma / max(distortedLuma, 0.01);
        
        // Apply contrast boost (60% preservation in parafovea, less in far periphery)
        float contrastPreservation = dist < parafovea_radius ? 0.6 : 0.3;
        col *= mix(1.0, lumaRatio, contrastPreservation);
    }
    
    // === ARCHITECTURAL GUARANTEE: FOVEA PROTECTION ===
    // The fovea must remain 100% authentic to the source.
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
        
        float caFactor = smoothstep(periphery_start, periphery_start + 0.25, distDithered);
        
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

        // === ROD VISION AESTHETIC ===
        // 1. Base Luma (Monochrome)
        float luma = dot(col, vec3(0.299, 0.587, 0.114));
        
        // 2. Contrast Boost
        // Rods have high contrast sensitivity.
        // Simple S-curve or linear boost.
        float contrast = 1.2;
        float lumaContrast = (luma - 0.5) * contrast + 0.5;
        lumaContrast = clamp(lumaContrast, 0.0, 1.0);
        
        // 3. Eigengrau Tint (Cold Dark Blue)
        // "Darker regions shifted towards dark blue-grey"
        // We map black (0.0) to Eigengrau, and white (1.0) to White.
        vec3 eigengrau = vec3(0.02, 0.02, 0.1); // Deep cold blue
        vec3 rodColor = mix(eigengrau, vec3(1.0), lumaContrast);
        
        // 4. Grain
        // High-frequency noise
        float grainStrength = 0.08;
        rodColor += noiseVal * grainStrength;
        
        // === DECOUPLED DESATURATION ===
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
        
        // Apply effect based on Bypass Transition AND the new independent factor
        // We combine them: bypassTransition handles the smooth start from 0.25
        // desaturationFactor handles the ramp over the periphery.
        
        vec3 finalColor = mix(col, rodColor, desaturationFactor * bypassTransition);
        return finalColor;
        
    } else if (config.v4_style_id == 1) { // Lab
        float luma = dot(col, vec3(0.0, 0.6, 0.4)); 
        vec3 rodColor = mix(vec3(0.02, 0.05, 0.1), vec3(0.6, 0.7, 0.8), luma) * 0.96;
        rodColor += (rand(uv) - 0.5) * 0.1;
        rodColor = mix(rodColor, vec3(0.01), saccadeFactor * 0.9);
        
        // Saliency Modulation (Phase 3): Conservative rod vision relief
        float labEffectFactor = effectFactor;
        if (u_enable_saliency_modulation > 0.5 && dist > parafovea_radius) {
            float s = lgn.saliency;
            // 15% max reduction at maximum saliency
            labEffectFactor *= mix(1.0, 0.85, s);
        }
        
        return mix(col, rodColor, labEffectFactor);
        
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
    } else if (config.v4_style_id == 5) { // Trippy (Fractal/Ooze)
        // CLEAN TRIPPY: Just the flowing wave + saturation boost
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
    
    // === TRIPPY MODE OVERRIDE ===
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
        if (memoryStrength > 0.9) {
            // Use sampleSource for guaranteed correct color
            vec4 clearColor = sampleSource(uv);
            color.rgb = clearColor.rgb;
        } else if (memoryStrength > 0.0) {
            vec4 clearColor = sampleSource(uv);
            color.rgb = mix(color.rgb, clearColor.rgb, memoryStrength);
        }
    }
    
    // Force Debug OFF for Cyberpunk
    float debugLevel = u_debug_structure;
    if (config.v4_style_id == 4) debugLevel = 0.0;
    
    // Debug Visualization
    if (debugLevel > 2.5) {
        float mask = texture(u_maskTexture, v_texCoord).r;
        color.rgb = vec3(mask);
    } else if (debugLevel > 1.5) {
        // Heatmap for Saliency (Blue -> Green -> Red)
        // Restored from commit 83e13f1 (User Preference)
        float s = lgn.saliency;
        vec3 heatmap = vec3(0.0);
        
        if (s < 0.5) {
            // Blue -> Green
            heatmap = mix(vec3(0.0, 0.0, 1.0), vec3(0.0, 1.0, 0.0), s * 2.0);
        } else {
            // Green -> Red
            heatmap = mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), (s - 0.5) * 2.0);
        }

        color.rgb = heatmap;
    } else if (debugLevel > 0.5) {
        if (lgn.density > 0.0) {
            color.rgb = mix(color.rgb, vec3(1.0, 0.0, 0.0), 0.3 * lgn.density);
        }
    }
    
    // Debug Boundary
    if (u_debug_boundary > 0.5) {
            // ... (Keep existing boundary logic) ...
            // For brevity in this replacement, I'll assume the boundary logic is standard
            // and just needs to be preserved or re-added if I cut it.
            // I will re-add the boundary logic here to be safe.
            
        vec2 diff = uv_corrected - mouse_corrected;
        float angle = atan(diff.y, diff.x);
        
        if (u_debug_boundary > 0.5) { // Mode 1
            float tickLength = 0.007;
            float distFromFovea = abs(dist - fovea_radius);
            float fw = fwidth(distFromFovea);
            float tickRadial = 1.0 - smoothstep(tickLength - fw, tickLength + fw, distFromFovea);
            float tickAlpha = tickRadial * smoothstep(0.95, 0.98, cos(angle * 12.0));
            if (tickAlpha > 0.0) color.rgb = mix(color.rgb, vec3(0.0, 1.0, 1.0), tickAlpha * 0.7);
        }
        if (u_debug_boundary > 1.5) { // Mode 2: Parafovea Boundary
            // CRITICAL: Match actual parafoveal radius (1.35x, not 2.5x)
            float visualParafoveaRadius = parafovea_radius; // Use the real value
            float parafoveaDist = abs(dist - visualParafoveaRadius);
            float fw = fwidth(parafoveaDist);
            float ringAlpha = (1.0 - smoothstep(0.0, fw * 2.0, parafoveaDist)) * smoothstep(0.0, 0.1, sin(angle * 40.0));
            if (ringAlpha > 0.0) color.rgb = mix(color.rgb, vec3(1.0, 0.5, 0.0), ringAlpha * 0.7);
        }
    }
    
    fragColor = color;
}