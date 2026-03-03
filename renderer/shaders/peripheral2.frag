#version 300 es
precision mediump float;

// === UNIFORMS ===
uniform sampler2D u_texture;      // Captured browser frame (Live)
uniform sampler2D u_maskTexture;  // Visual memory mask
uniform sampler2D u_structureMap; // Structure Map (R=Rhythm, G=Density, B=Type)
uniform sampler2D u_saliencyMap;  // Saliency Map (R=Saliency, G=Congestion, B=EdgeDensity)
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
uniform float u_blurRadius;       // Simulated Pupil Aperture
uniform float u_mongrel_mode;     // 0.0 = Noise, 1.0 = Shatter


// === GRANULAR CONFIGURATION UNIFORMS ===
uniform float u_lgn_use_structure_mask;
uniform float u_lgn_use_saliency_gate;
uniform int   u_v1_distortion_type;
uniform float u_v1_strength_mult;
uniform int   u_v4_style_id;
uniform float u_lgn_ramp_end_mult;
uniform float u_v1_animate;

// DoG (Difference-of-Gaussians) peripheral reconstruction uniforms
uniform float u_dog_enabled;     // 0.0 = legacy MIP, 1.0 = DoG reconstruction
uniform float u_dog_e2;          // M-scaling E2 (half-resolution eccentricity)
uniform float u_dog_sharpness;   // Band rolloff sharpness (0=biological, 1=sharp)

// FOVI (Cortical Magnification) uniforms — Blauch, Alvarez & Konkle (2026)
uniform float u_fovi_enabled;     // 0.0 = legacy linear, 1.0 = CMF logarithmic
uniform float u_cmf_a;            // Cortical magnification constant (default 2.78)
uniform float u_fovi_color_sigma; // Gaussian color decay sigma (0.0 = disabled)
uniform float u_desat_floor;      // Min desaturation multiplier in salient regions (1.0 = full desat, 0.85 = 15% cap)

// Congestion overlay (Rosenholtz et al. 2007)
uniform int u_show_congestion;    // 0=off, 1=overlay, 2=solo

// Congestion-gated pooling (hypothesis mode)
uniform float u_congestion_pooling; // 0.0=off, 1.0=on

// High-resolution congestion map (from dedicated congestion worker)
// R=congestion, G=edgeDensity — higher quality than u_saliencyMap.gb at 256px
uniform sampler2D u_congestionMap;
uniform float u_hasCongestionMap; // 0.0=not available, 1.0=use high-res data

in vec2 v_texCoord;
out vec4 fragColor;

// === HELPER: SOURCE SAMPLER (The "True View") ===
vec4 sampleSource(vec2 uv) {
    vec4 col = textureLod(u_texture, uv, 0.0);
    float temp = col.r;
    col.r = col.b;
    col.b = temp;
    return col;
}

// === GRADIENT-AWARE SAMPLER (Mipmap Collapse Fix) ===
vec4 sampleSourceGrad(vec2 distortedUV, vec2 duvdx, vec2 duvdy) {
    vec4 col = textureGrad(u_texture, distortedUV, duvdx, duvdy);
    float temp = col.r;
    col.r = col.b;
    col.b = temp;
    return col;
}

// === HELPER: VARIABLE BLUR ===
vec4 sampleBlurred(vec2 uv, float radius) {
    if (radius < 0.5) return sampleSource(uv);
    
    vec2 pixelSize = 1.0 / u_resolution;
    vec4 sum = vec4(0.0);
    float totalWeight = 0.0;
    
    // Center
    sum += sampleSource(uv) * 0.4;
    totalWeight += 0.4;
    
    // 4 Cardinal Neighbors
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

// === DoG PERIPHERAL RECONSTRUCTION ===
// Decomposes the hardware MIP chain into an approximate Laplacian pyramid.
// Hardware mipmaps use box/bilinear filtering (not Gaussian convolution), so band
// differences are Difference-of-Boxes — an approximation of true DoG with some
// spectral leakage between bands. See Burt & Adelson (1983) for true Laplacian pyramids.
// Biology: retinal ganglion cells have center-surround RFs ≈ DoG filters.
// Field size grows with eccentricity. At fovea: all bands. In periphery: only low-freq survives.
vec4 sampleDoGReconstructed(vec2 uv, float eccentricity, float fovea_radius,
                             float dog_e2, float dog_sharpness) {
    float normEcc = max(0.0, eccentricity) / max(fovea_radius, 0.001);

    // Sample 5 MIP levels (existing hardware chain)
    vec4 mip0 = textureLod(u_texture, uv, 0.0);
    vec4 mip1 = textureLod(u_texture, uv, 1.0);
    vec4 mip2 = textureLod(u_texture, uv, 2.0);
    vec4 mip3 = textureLod(u_texture, uv, 3.0);
    vec4 mip4 = textureLod(u_texture, uv, 4.0);

    // Approximate DoG bands (box/bilinear MIP differences, not true Gaussian)
    vec4 band0 = mip0 - mip1;  // 1-2px: serifs, thin strokes
    vec4 band1 = mip1 - mip2;  // 2-4px: letter bodies, small icons
    vec4 band2 = mip2 - mip3;  // 4-8px: words, UI elements
    vec4 band3 = mip3 - mip4;  // 8-16px: buttons, layout blocks
    // residual = mip4          // DC: overall color/luminance

    // Per-band cutoff eccentricities — linear M-scaling
    // Rovamo & Virsu (1979), Levi, Klein & Aitsebaomo (1985):
    //   s_min(e) = s_0 * (1 + e/E2)
    // Band k (spatial scale 2^k px) drops out when s_min(e) > 2^k:
    //   cutoff_k = E2 * (2^k - 1)
    // With s_0 = 1px, this gives cutoffs at 1, 3, 7, 15 × E2.
    // Coarse structure (bands 2-3) persists far into the periphery —
    // biologically correct: you see WHERE a button is, not its label.
    float c0, c1, c2, c3;
    float e2 = max(dog_e2, 0.01);
    if (u_fovi_enabled > 0.5) {
        // CMF-derived: cutoff_i = a * (2^level - 1) / fovea_deg
        float fovea_deg = 2.0;
        c0 = u_cmf_a * (pow(2.0, 1.0) - 1.0) / fovea_deg;
        c1 = u_cmf_a * (pow(2.0, 2.0) - 1.0) / fovea_deg;
        c2 = u_cmf_a * (pow(2.0, 3.0) - 1.0) / fovea_deg;
        c3 = u_cmf_a * (pow(2.0, 4.0) - 1.0) / fovea_deg;
    } else {
        // Linear M-scaling: cutoff_k = E2 * (2^k - 1)
        c0 = e2 * 1.0;    // 2^1 - 1 = 1
        c1 = e2 * 3.0;    // 2^2 - 1 = 3
        c2 = e2 * 7.0;    // 2^3 - 1 = 7
        c3 = e2 * 15.0;   // 2^4 - 1 = 15
    }

    // Transition width: biological (wide, gradual) vs sharp (narrow, crisp)
    float transMult = mix(0.4, 0.05, dog_sharpness);

    // Per-band weights via smoothstep rolloff
    float w0 = 1.0 - smoothstep(c0 - c0 * transMult, c0 + c0 * transMult, normEcc);
    float w1 = 1.0 - smoothstep(c1 - c1 * transMult, c1 + c1 * transMult, normEcc);
    float w2 = 1.0 - smoothstep(c2 - c2 * transMult, c2 + c2 * transMult, normEcc);
    float w3 = 1.0 - smoothstep(c3 - c3 * transMult, c3 + c3 * transMult, normEcc);

    // Reconstruct: residual (always full) + weighted bands
    // Clamp to [0,1] — band differences can be negative, partial attenuation
    // may produce out-of-range values
    vec4 result = clamp(mip4 + band3 * w3 + band2 * w2 + band1 * w1 + band0 * w0, 0.0, 1.0);

    // BGRA → RGBA (Electron capture quirk)
    float temp = result.r;
    result.r = result.b;
    result.b = temp;

    return result;
}

// === LEGACY: Simple MIP pooling (used when DoG disabled) ===
vec4 sampleMIPPooled(vec2 uv, float eccentricity, float fovea_radius) {
    float normalizedEcc = max(0.0, eccentricity) / fovea_radius;
    float mipScaling = 2.5;
    float maxMipLevel = 4.0;

    float mipLevel;
    if (u_fovi_enabled > 0.5) {
        // FOVI: Logarithmic cortical magnification (CMF = 1/(r+a))
        float fovea_deg = 2.0;
        float r_deg = normalizedEcc * fovea_deg;
        mipLevel = clamp(log2(max(1.0, (r_deg + u_cmf_a) / u_cmf_a)), 0.0, maxMipLevel);
    } else {
        mipLevel = clamp(normalizedEcc * mipScaling, 0.0, maxMipLevel);
    }

    vec4 col = textureLod(u_texture, uv, mipLevel);

    float temp = col.r;
    col.r = col.b;
    col.b = temp;

    return col;
}

// === GRADIENT-AWARE MIP POOLING ===
vec4 sampleMIPPooledGrad(vec2 uv, vec2 duvdx, vec2 duvdy, float eccentricity, float fovea_radius) {
    float normalizedEcc = max(0.0, eccentricity) / fovea_radius;
    float mipScaling = 2.5;
    float maxMipLevel = 4.0;

    float mipLevel;
    if (u_fovi_enabled > 0.5) {
        // FOVI: Logarithmic cortical magnification (CMF = 1/(r+a))
        float fovea_deg = 2.0;
        float r_deg = normalizedEcc * fovea_deg;
        mipLevel = clamp(log2(max(1.0, (r_deg + u_cmf_a) / u_cmf_a)), 0.0, maxMipLevel);
    } else {
        mipLevel = clamp(normalizedEcc * mipScaling, 0.0, maxMipLevel);
    }

    vec4 col = textureGrad(u_texture, uv, duvdx * pow(2.0, mipLevel), duvdy * pow(2.0, mipLevel));

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
float srgbToLinear(float c) {
    if (c <= 0.04045) { return c / 12.92; } else { return pow((c + 0.055) / 1.055, 2.4); }
}
float linearToSrgb(float c) {
    if (c <= 0.0031308) { return c * 12.92; } else { return 1.055 * pow(c, 1.0 / 2.4) - 0.055; }
}
vec3 srgbToLinearVec(vec3 srgb) {
    return vec3(srgbToLinear(srgb.r), srgbToLinear(srgb.g), srgbToLinear(srgb.b));
}
vec3 linearToSrgbVec(vec3 linear) {
    return vec3(linearToSrgb(linear.r), linearToSrgb(linear.g), linearToSrgb(linear.b));
}
vec3 linearSrgbToOklab(vec3 rgb) {
    float l = 0.4122214708 * rgb.r + 0.5363325363 * rgb.g + 0.0514459929 * rgb.b;
    float m = 0.2119034982 * rgb.r + 0.6806995451 * rgb.g + 0.1073969566 * rgb.b;
    float s = 0.0883024619 * rgb.r + 0.2817188376 * rgb.g + 0.6299787005 * rgb.b;
    float l_ = pow(l, 1.0 / 3.0); float m_ = pow(m, 1.0 / 3.0); float s_ = pow(s, 1.0 / 3.0);
    return vec3(
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    );
}
vec3 oklabToLinearSrgb(vec3 lab) {
    float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
    float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
    float s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
    float l = l_ * l_ * l_; float m = m_ * m_ * m_; float s = s_ * s_ * s_;
    return vec3(
        +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    );
}
vec3 rgbToOklab(vec3 srgb) {
    vec3 linear = srgbToLinearVec(srgb);
    return linearSrgbToOklab(linear);
}
vec3 oklabToRgb(vec3 lab) {
    vec3 linear = oklabToLinearSrgb(lab);
    vec3 srgb = linearToSrgbVec(linear);
    return clamp(srgb, 0.0, 1.0);
}

// === STATIC MONGREL SAMPLER ===
// Robust hash function (Gold Noise variant)
vec2 hash22(vec2 p) {
    p = fract(p * vec2(5.3983, 5.4427));
    p += dot(p.yx, p.xy + vec2(21.5351, 14.3137));
    return fract(vec2(p.x * p.y * 95.4337, p.x * p.y * 97.597));
}

float rand(vec2 co){
    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
}

// === NEURO-ARCHITECTURE PIPELINE ===

struct ModeConfig {
    bool lgn_use_structure_mask;
    bool lgn_use_saliency_gate;
    int  v1_distortion_type;
    float v1_strength_mult;
    int  v4_style_id;
    float lgn_ramp_end_mult;
    bool v1_animate;
    bool fovi_enabled;
};

struct LGN_Signal {
    float suppressionFactor;
    float saliency;
    float congestion;   // Feature Congestion (Rosenholtz 2007) — local feature variance
    float edgeDensity;  // Edge Density — local Sobel magnitude density
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
    
    vec4 structure = texture(u_structureMap, uv);
    signal.density = structure.g;
    signal.rhythm = structure.r;
    signal.type = structure.b;

    // Saliency texture: R=saliency, G=feature congestion, B=edge density
    vec4 salTex = texture(u_saliencyMap, uv);
    signal.saliency    = salTex.r;

    // Congestion + edge density: prefer high-res dedicated worker when available
    if (u_hasCongestionMap > 0.5) {
        vec4 congTex = texture(u_congestionMap, uv);
        signal.congestion  = congTex.r;
        signal.edgeDensity = congTex.g;
    } else {
        signal.congestion  = salTex.g;
        signal.edgeDensity = salTex.b;
    }
    
    float rampEnd = fovea_radius * config.lgn_ramp_end_mult;
    signal.suppressionFactor = smoothstep(fovea_radius, rampEnd, dist);
    
    if (config.lgn_use_structure_mask) {
        if (u_has_structure > 0.5 && signal.density < 0.1) {
            signal.suppressionFactor = 0.0;
        }
    }
    
    // Saliency Gating (Selective resource allocation)
    // High-saliency regions get more processing bandwidth (less peripheral filtering).
    // Mirrors biological compute demand management: retina → optic nerve bottleneck.
    if (config.lgn_use_saliency_gate && u_enable_saliency_modulation > 0.5) {
        // NOTE: At saliency=1.0, suppression drops to 0.3 (text gets 70% bandwidth).
        // We override this in processV1 for the scramble zone.
        signal.suppressionFactor *= mix(1.0, 0.3, signal.saliency);
    }
    
    if (u_useMask > 1.5) {
        float rawMask = texture(u_maskTexture, uv).r;
        float inhibition = smoothstep(0.0, 0.5, rawMask);
        signal.saliency *= (1.0 - inhibition);
        signal.density *= (1.0 - inhibition);
        signal.rhythm *= (1.0 - inhibition);
    }

    return signal;
}

// --- STAGE 2: V1 (Geometry & Distortion) ---
V1_Signal processV1(vec2 uv, vec2 uv_corrected, LGN_Signal lgn, ModeConfig config, float dist, float fovea_radius, float parafovea_radius, bool isFarPeriphery, bool isParafovea, float memoryStrength) {
    V1_Signal signal;
    signal.distortedUV = uv;
    signal.distortionStrength = 0.0;
    signal.displacement = vec2(0.0);
    
    float transitionWidth = parafovea_radius * 0.3;
    float boundaryProgress = smoothstep(parafovea_radius, parafovea_radius + transitionWidth, dist);
    float eccentricityScale = mix(0.15, 1.0, boundaryProgress); 
    
    if (config.v4_style_id == 4 || config.v4_style_id == 3) {
        eccentricityScale = 1.0;
    }
    
    float strength = lgn.suppressionFactor * config.v1_strength_mult * eccentricityScale;
    
    if (u_useMask < 1.5) {
        strength *= (1.0 - memoryStrength);
    }
    
    signal.distortionStrength = strength;
    
    if (config.v4_style_id == 5) {
        // Double Vision Mode
        float waveSpeed = 0.5; 
        float waveFreq = 3.0;
        float waveX = sin(uv.y * waveFreq + u_time * waveSpeed);
        float waveY = cos(uv.x * waveFreq + u_time * waveSpeed * 0.7);
        vec2 waveOffset = vec2(waveX, waveY) * 0.015 * strength * u_intensity;
        signal.displacement = waveOffset;
        signal.distortedUV = uv + signal.displacement;
        signal.distortionStrength = strength;
        return signal;
    }

    if (config.v1_distortion_type == 2) {
        return signal;
    }
    
    // === TIER 3: NUCLEAR SCRAMBLE (The Shredder) ===
    if (config.v1_distortion_type == 1) {
        
        // 1. Base Fractal Warp (The "Bender")
        // Use uv_corrected for aspect-correct noise shapes
        vec2 warpUV = uv_corrected; 
        
        // High-frequency noise to create "heat haze" foundation
        // FIX: Removed u_time to kill jitter/animation. Static distortion only.
        // FIX: Reduced freq (800->150) to remove "fuzz/grain". Now more "glassy".
        float n1 = snoise(warpUV * 150.0); 
        float n2 = snoise(warpUV * 300.0) * 0.5;
        
        // Amplitude modulated by standard strength (initially)
        // FIX: Reduced base amp (0.003 -> 0.0024) to "turn down all distortion by 20%"
        vec2 fractalWarp = vec2(n1 + n2) * 0.0024 * strength * u_intensity;
        
        // Anisotropic Smash: 2x Horizontal Bias (Was 8x - too strong compared to scramble)
        fractalWarp.x *= 2.0; 

        // 2. Discrete Scramble (The "Cutter")
        // ZONE TUNING: Start immediately at Parafovea edge (1.0) -> Full by 1.5
        float scrambleZone = smoothstep(parafovea_radius * 1.0, parafovea_radius * 1.5, dist);
        
        vec2 discreteScramble = vec2(0.0);
        
        if (scrambleZone > 0.01) {
            // GRID TUNING: 400x300 (Was 800x300).
            // 800 was creating 2px cells -> Fuzz. 400 is ~4px cells -> Shreds.
            vec2 cellFreq = vec2(400.0, 300.0); 
            // Use uv_corrected for consistent square-ish cells.
            vec2 cellID = floor(uv_corrected * cellFreq);
            
            // Generate stable random offset per cell using Gold Noise
            vec2 jitter = hash22(cellID) - 0.5;
            
            // SCRAMBLE AMPLITUDE
            // Horizontal: +/- 0.8% (~16px) base (Was 1.0%)
            // Vertical: +/- 0.16% (~3px) base (Was 0.2%)
            // Edge density modulation: high-edge regions crowd more strongly
            float edgeCrowdMult = 1.0 + lgn.edgeDensity * 0.4;
            vec2 throwDist = vec2(0.008, 0.0016) * u_intensity * edgeCrowdMult;
            
            // PROGRESSIVE SCALING: Grow distortion with eccentricity
            // At 1.5 radii (start of full scramble): 1.0x
            // At 4.0 radii (far edge): ~2.0x+
            // This prevents the effect from plateauing/maxing out too early.
            float progressive = 1.0 + max(0.0, (dist - parafovea_radius * 1.5) / parafovea_radius);
            throwDist *= progressive;
            
            // Apply quadratic falloff so it ramps in aggressively
            discreteScramble = jitter * throwDist * scrambleZone * scrambleZone;
        }

        // 3. The Replacement Logic (Mix)
        // Transition from "Bending" (Parafovea) to "Shredding" (Periphery)
        // FIX: Removed +fractalWarp. User wants STABLE (static) periphery, not boiling.
        signal.displacement = mix(fractalWarp, discreteScramble, scrambleZone);
        
        signal.distortedUV = uv + signal.displacement;
        
        // 4. Bypass Strength Gating in Scramble Zone
        // CRITICAL FIX: If we are in the scramble zone, ignore saliency gating.
        // Saliency would otherwise allocate bandwidth to text, keeping it readable.
        if (scrambleZone > 0.5) {
             signal.distortionStrength = 1.0; // Force full effect
        } else {
             signal.distortionStrength = strength;
        }
        
    } else if (config.v1_distortion_type == 0) {
        // === TIER 2.0: FRACTAL CROWDING (Noise Mode) ===
        vec2 uv_corrected_local = vec2(uv.x * u_fovea_aspect_ratio, uv.y);
        // FIX: Removed animation time component.
        float t = 0.0; 
        
        float zoneA = smoothstep(fovea_radius, parafovea_radius, dist);
        float zoneB = smoothstep(parafovea_radius, parafovea_radius * 2.0, dist);
        
        // Static noise
        float n1 = snoise(uv_corrected_local * 800.0);
        float n2 = snoise(uv_corrected_local * 1600.0);
        
        float fractalNoise = n1 + (n2 * 0.5 * zoneB);
        float warpAmp = mix(0.006, 0.024, zoneB);
        vec2 finalWarp = vec2(fractalNoise) * warpAmp;
        
        float hBias = mix(6.0, 16.0, zoneB);
        finalWarp.x *= hBias;
        
        float shear = sin(uv.x * 200.0) * 0.003;
        // Static chop
        float chop = snoise(vec2(uv.x * 400.0, uv.y * 50.0)) * 0.020;
        float verticalDistortion = mix(shear, chop, zoneB);
        finalWarp.y += verticalDistortion;
        
        float effectiveStrength = max(strength, zoneB * 0.8);
        signal.displacement = finalWarp * effectiveStrength * u_intensity;
        signal.distortedUV = uv + signal.displacement;
        signal.distortionStrength = effectiveStrength;

    } else if (config.v1_distortion_type == 3) {
        // === PIXELATE (Saliency-Guided) ===
        float combinedMetric = max(lgn.saliency, lgn.density);
        float steppedMetric = floor(combinedMetric * 4.0) / 4.0;
        
        float targetMaxBlock = 192.0;
        float targetMinBlock = 32.0; 
        
        if (config.v4_style_id == 4) {
            targetMaxBlock = 1200.0; 
            targetMinBlock = 160.0;  
        }
        
        float limitBlockSize = mix(targetMaxBlock, targetMinBlock, steppedMetric);
        float logMax = log2(limitBlockSize);
        float logCurrent = strength * logMax;
        float currentBlockSize = exp2(floor(logCurrent));
        
        currentBlockSize = max(1.0, currentBlockSize);
        
        vec2 pixelSize = vec2(currentBlockSize) / u_resolution;
        vec2 quantizedUV = floor(uv / pixelSize) * pixelSize + pixelSize * 0.5;
        
        float motionGate = smoothstep(0.1, 5.0, u_velocity); 
        
        if (strength > 0.5 && steppedMetric < 0.5 && motionGate > 0.01) {
            float blockNoise = rand(quantizedUV + vec2(floor(u_time * 10.0))); 
            float threshold = 0.92 + (1.0 - motionGate) * 0.08; 
            
            if (blockNoise > threshold) { 
                float shift = (blockNoise - threshold) * 2.0; 
                quantizedUV.x += shift * 0.2 * strength * motionGate; 
            }
        }
        
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
    float eccentricity = max(0.0, dist - fovea_radius);
    
    vec2 duvdx = dFdx(uv);
    vec2 duvdy = dFdy(uv);
    
    vec3 foveaCol = sampleSourceGrad(v1.distortedUV, duvdx, duvdy).rgb;
    
    // TIER 1.8: COUPLED POOLING
    float blurMult = 1.0 + (u_blurRadius * 0.3);
    float coupledEccentricity = v1.distortionStrength * u_intensity * fovea_radius * blurMult;

    // Congestion-gated pooling: high congestion → stronger blur (more aggressive MIP)
    // Biological rationale: cluttered regions are already pooled by peripheral vision
    // into summary statistics — this makes the simulation match that prediction.
    // Rosenholtz et al. (2007) clutter + Rosenholtz et al. (2012) peripheral pooling.
    if (u_congestion_pooling > 0.5) {
        // congestion 0.0 → 1.0x MIP (no change)
        // congestion 1.0 → 2.0x MIP (double pooling)
        float congestionBoost = 1.0 + lgn.congestion * 1.0;
        coupledEccentricity *= congestionBoost;
    }

    vec3 pooledCol;
    if (u_dog_enabled > 0.5) {
        pooledCol = sampleDoGReconstructed(
            v1.distortedUV, coupledEccentricity, fovea_radius,
            u_dog_e2, u_dog_sharpness
        ).rgb;
    } else {
        pooledCol = sampleMIPPooledGrad(v1.distortedUV, duvdx, duvdy, coupledEccentricity, fovea_radius).rgb;
    }
    
    float baseBlend = smoothstep(0.0, fovea_radius * 0.1, eccentricity);
    float blendFactor = baseBlend * u_intensity;
    vec3 col = mix(foveaCol, pooledCol, blendFactor);
    
    // === MAGNOCELLULAR PATHWAY: Luminance Contrast Preservation ===
    if (eccentricity > 0.001) {
        vec3 cleanSample = sampleSource(uv).rgb;
        float cleanLuma = dot(cleanSample, vec3(0.299, 0.587, 0.114));
        float distortedLuma = dot(col, vec3(0.299, 0.587, 0.114));
        
        float lumaRatio = cleanLuma / max(distortedLuma, 0.01);
        
        float contrastRamp = smoothstep(0.0, fovea_radius * 0.1, eccentricity);
        
        // CRITICAL FIX: Kill contrast in far periphery to ensure ghostly text
        // mix(0.6, 0.1, ...) -> Starts at 60% preservation, drops to 10% in far periphery (was 0.0 which caused gray fog)
        float contrastPreservation = mix(0.6, 0.1, smoothstep(0.0, parafovea_radius - fovea_radius, eccentricity));
        
        col *= mix(1.0, lumaRatio, contrastPreservation * contrastRamp);
    }
    
    // === ARCHITECTURAL GUARANTEE: FOVEA PROTECTION ===
    if (dist < fovea_radius * 0.5) {
        return col;
    }

    float effectFactor = v1.distortionStrength; 
    float bypassTransition = smoothstep(fovea_radius * 0.5, fovea_radius * 0.7, dist);

    if (config.v4_style_id <= 1 || config.v4_style_id == 7) { // Research Modes: 0=Usability, 1=Biological(Purkinje), 7=Gaussian Desaturation
    
        // === SHARED BIOLOGICAL PIPELINE ===
        float noiseVal = (rand(uv) - 0.5);
        float protection = max(lgn.saliency, lgn.density);
        float dampener = mix(1.0, u_desat_floor, protection);
        
        float desatIntensity = smoothstep(0.0, 0.6, u_intensity);
        float strengthMult = desatIntensity * dampener;
        
        // 1. Chromatic Aberration
        float periphery_start = fovea_radius * 1.2;
        float caFactor = smoothstep(periphery_start, periphery_start + 0.25, dist);
        caFactor *= strengthMult;
        
        // CA Suppression (Parafovea) - High Scramble = Low CA
        float scrambleOnset = parafovea_radius * 1.0;
        float scrambleFull = parafovea_radius * 1.5;
        float scrambleStrength = smoothstep(scrambleOnset, scrambleFull, dist);
        float caSuppression = 1.0 - scrambleStrength;
        caFactor *= caSuppression;
        
        if (caFactor > 0.01) {
            float offset = 0.005 * caFactor; 
            vec2 caOffset = vec2(offset, 0.0);
            col.r = sampleSource(v1.distortedUV + caOffset).r;
            col.b = sampleSource(v1.distortedUV - caOffset).b;
        }

        // 2. Oklab Conversion
        vec3 lab = rgbToOklab(col);
        
        // 3. Rod Desaturation Factor
        float desaturationFactor;
        if (config.v4_style_id == 7 && u_fovi_color_sigma > 0.01) {
            // Gaussian exponential decay: models cone density falloff
            // desatFactor = 0 at fovea edge, asymptotic toward 1 in periphery
            float fovea_deg = 2.0;
            float normEcc = max(0.0, eccentricity) / max(fovea_radius, 0.001);
            float r_deg = normEcc * fovea_deg;
            desaturationFactor = 1.0 - exp(-r_deg / max(u_fovi_color_sigma, 0.1));
        } else {
            // Smoothstep ramp (modes 0 & 1): S-curve between fovea and ramp end
            float rampEnd = fovea_radius * config.lgn_ramp_end_mult;
            desaturationFactor = smoothstep(fovea_radius, rampEnd, dist);
        }
        desaturationFactor *= strengthMult;
        
        float fade = desaturationFactor * bypassTransition;
        
        // Apply Base Desaturation (Chrominance only)
        lab.y *= (1.0 - fade); 
        lab.z *= (1.0 - fade);
        
        // === DIVERGENCE: USABILITY VS BIOLOGY ===
        
        if (config.v4_style_id == 0 || config.v4_style_id == 7) {
            // === MODE 0/7: USABILITY (High-Key Ghosting) ===
            // Style 7 uses same aesthetic, only desaturation curve differs (Gaussian vs smoothstep)
            // Goal: Red buttons turn Grey (structural retention), not Black (invisible).
            
            // Red Kill Switch (Prevent Mustard)
            float rednessFactor = max(0.0, lab.y);
            if (rednessFactor > 0.0) {
                 float peripheralFade = smoothstep(parafovea_radius, periphery_start + (fovea_radius * 2.0), dist);
                 float desatStrength = peripheralFade * 0.95;
                 lab.y = mix(lab.y, 0.0, desatStrength); // Kill a (Red)
                 lab.z = mix(lab.z, 0.0, desatStrength); // Kill b (Yellow)
            }
            
            // Standard Rod Color Mix (Visual consistency / Fog)
            vec3 finalCol = oklabToRgb(lab);
            
            // Generate clean rod base (Eigengrau-ish)
            vec3 rodColorLab = vec3(0.96 * lab.x, 0.0, -0.05); 
            vec3 rodColor = oklabToRgb(rodColorLab);
            rodColor += noiseVal * 0.08;
            rodColor = clamp(rodColor, 0.0, 1.0);
            
            return mix(finalCol, rodColor, desaturationFactor * bypassTransition * 0.3);
            
        } else {
            // === MODE 1: BIOLOGICAL (Purkinje Darkening) ===
            // Goal: Simulation accuracy. Red objects vanish into shadows.
            
            // Purkinje Shift + Optical Vignette
            float deepPeriphery = smoothstep(parafovea_radius, periphery_start + (fovea_radius * 0.8), dist);
            float rednessFactor = max(0.0, lab.y * 2.0); // Boosted sensitivity
             
            if (rednessFactor > 0.0) {
                float purkinjeDarkness = deepPeriphery * rednessFactor;
                lab.y = mix(lab.y, 0.0, purkinjeDarkness);
                lab.z = mix(lab.z, 0.0, purkinjeDarkness);
                lab.x = mix(lab.x, 0.02, purkinjeDarkness); // Kill Light (Simulate Rod Blank)
            }
            
            // Safe Global Vignette (Contrast Dimming)
            // Lowers brightness/contrast at edges without creating a "tunnel"
            float globalDim = deepPeriphery * 0.4;
            lab.x = mix(lab.x, lab.x * 0.6, globalDim);
            
            return oklabToRgb(lab);
        }
        
    } else if (config.v4_style_id == 2) { // Frosted
        vec3 frosted = mix(col, vec3(0.9), 0.3);
        return mix(col, frosted, effectFactor * 0.7 * bypassTransition);
        
    } else if (config.v4_style_id == 3) { // Wireframe
        float edge = sobel(v1.distortedUV);
        float edgeIntensity = smoothstep(0.05, 0.1, edge);
        vec3 baseColor = col;
        float s = texture(u_saliencyMap, v1.distortedUV).r; 
        vec3 lineCol = mix(vec3(0.0, 0.4, 0.6), vec3(0.5, 0.9, 1.0), s);
        return mix(baseColor, lineCol, edgeIntensity);
        
    } else if (config.v4_style_id == 4) { // Cyberpunk
            float cleanFactor = smoothstep(0.4, 0.8, effectFactor);
            float luma = dot(col, vec3(0.299, 0.587, 0.114));
            vec3 saturated = mix(vec3(luma), col, 1.8); 
            float contrastRamp = smoothstep(fovea_radius, parafovea_radius * 2.0, dist);
            float contrastAmount = mix(1.0, 2.5, contrastRamp); 
            vec3 contrasted = (saturated - 0.5) * contrastAmount + 0.5;
            vec2 pixelUV = uv * u_resolution;
            float dotPattern = sin(pixelUV.x * 0.5) * sin(pixelUV.y * 0.5); 
            vec3 textured = contrasted * (0.95 + 0.05 * dotPattern);
            vec3 finalColor = clamp(textured, 0.0, 1.0);
            return mix(col, finalColor, cleanFactor * bypassTransition);
            
    } else if (config.v4_style_id == 5) { // Double Vision
        float luma = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 saturated = mix(vec3(luma), col, 1.6);
        vec2 warpUV = v1.distortedUV * 2.0;
        float n = snoise(warpUV + vec2(u_time * 0.1));
        float subtleNoise = n * 0.05 * effectFactor;
        vec3 finalColor = clamp(saturated + subtleNoise, 0.0, 1.0);
        return mix(col, finalColor, effectFactor * bypassTransition);

    } else if (config.v4_style_id == 6) { // FOVI: Gaussian color decay (rod-cone transition)
        if (u_fovi_color_sigma > 0.01) {
            float fovea_deg = 2.0;
            float normEcc = max(0.0, eccentricity) / max(fovea_radius, 0.001);
            float r_deg = normEcc * fovea_deg;
            float decay = exp(-r_deg / max(u_fovi_color_sigma, 0.1));
            float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
            col = mix(vec3(lum), col, decay);
        }
        return col;
    }

    return col;
}

// === CONGESTION HEATMAP (Rosenholtz 2007 visualization) ===
// Blue (low) → Yellow (mid) → Red (high) — perceptually ordered
vec3 congestionHeatmap(float t) {
    t = clamp(t, 0.0, 1.0);
    // 3-stop gradient: blue → yellow → red
    if (t < 0.5) {
        float s = t * 2.0; // 0..1 over first half
        return mix(vec3(0.1, 0.1, 0.8), vec3(1.0, 1.0, 0.0), s);
    } else {
        float s = (t - 0.5) * 2.0; // 0..1 over second half
        return mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), s);
    }
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

    vec2 mouse_stable_uv = u_mouse_stable / u_resolution;
    vec2 mouse_stable_corrected = vec2(mouse_stable_uv.x * aspect, mouse_stable_uv.y);
    vec2 delta_stable = uv_corrected - mouse_stable_corrected;
    delta_stable.x /= u_fovea_aspect_ratio;
    float dist_stable = length(delta_stable); 

    float radius_norm = u_foveaRadius / u_resolution.y;
    float fovea_radius = radius_norm;
    float parafovea_radius = radius_norm * 2.5; 
    
    bool isParafovea = dist_stable > fovea_radius && dist_stable <= parafovea_radius;
    bool isFarPeriphery = dist_stable > parafovea_radius; 
    
    ModeConfig config;
    config.lgn_use_structure_mask = u_lgn_use_structure_mask > 0.5;
    config.lgn_use_saliency_gate = u_lgn_use_saliency_gate > 0.5;
    config.v1_distortion_type = u_v1_distortion_type;
    config.v1_strength_mult = u_v1_strength_mult;
    config.v4_style_id = u_v4_style_id;
    config.lgn_ramp_end_mult = u_lgn_ramp_end_mult;
    config.v1_animate = u_v1_animate > 0.5;
    config.fovi_enabled = u_fovi_enabled > 0.5;

    if (config.v4_style_id == 5) {
        config.lgn_use_structure_mask = false;
        config.lgn_use_saliency_gate = false;
    }
    
    if (config.v4_style_id != 5 && config.v1_distortion_type != 2 && config.v1_distortion_type != 3) {
        if (u_mongrel_mode < 0.5) {
            config.v1_distortion_type = 0; 
        }
        else config.v1_distortion_type = 1; 
    }
    
    if (config.v4_style_id == 3) {
        config.v1_distortion_type = 3;
    }

    float memoryStrength = 0.0;
    if (u_useMask > 0.5) {
        float rawMask = texture(u_maskTexture, v_texCoord).r;
        memoryStrength = smoothstep(0.0, 0.5, rawMask);
    }

    LGN_Signal lgn = processLGN(uv, config, dist, fovea_radius);
    
    V1_Signal v1 = processV1(uv, uv_corrected, lgn, config, dist_stable, fovea_radius, parafovea_radius, isFarPeriphery, isParafovea, memoryStrength);
    
    float saccadeFactor = smoothstep(4.0, 10.0, u_velocity);
    vec3 finalRGB = processV4(uv, v1, lgn, config, dist, fovea_radius, parafovea_radius, saccadeFactor);
    
    if (isParafovea) {
        vec3 col = finalRGB;
        float luma = dot(col, vec3(0.299, 0.587, 0.114));
        finalRGB = mix(vec3(luma), col, 1.2); 
    }

    vec4 color = vec4(finalRGB, 1.0);

    float scrollbarWidth = 17.0;
    float distFromRightEdge = u_resolution.x - (uv.x * u_resolution.x);
    bool isScrollbar = distFromRightEdge < scrollbarWidth;
    
    if (!isScrollbar) {
        if (u_useMask < 1.5 && u_useMask > 0.5 && u_debug_structure < 0.5) {
            if (memoryStrength > 0.9) {
                vec4 clearColor = sampleSource(uv);
                color.rgb = clearColor.rgb;
            } else if (memoryStrength > 0.0) {
                vec4 clearColor = sampleSource(uv);
                color.rgb = mix(color.rgb, clearColor.rgb, memoryStrength);
            }
        }
    }
    
    float debugLevel = u_debug_structure;
    if (config.v4_style_id == 4) debugLevel = 0.0;
    
    if (debugLevel > 0.5) {
        color = sampleSource(uv);
    }
    
    if (debugLevel > 2.5) {
        float mask = texture(u_maskTexture, v_texCoord).r;
        color.rgb = vec3(mask);
    } else if (debugLevel > 1.5) {
        float s = texture(u_saliencyMap, v_texCoord).r;
        color.rgb = vec3(s);
    } else if (debugLevel > 0.5) {
        float rawDensity = texture(u_structureMap, v_texCoord).g;
        if (rawDensity > 0.0) {
            color.rgb = mix(color.rgb, vec3(1.0, 0.0, 0.0), 0.5 * rawDensity);
        }
    }
    
    if (u_debug_boundary > 0.5) {
        vec2 diff = uv_corrected - mouse_corrected;
        float angle = atan(diff.y, diff.x);
        
        if (u_debug_boundary > 0.5) { 
            float fw = fwidth(dist);
            
            float borderDist = abs(dist - fovea_radius);
            float borderAlpha = 1.0 - smoothstep(0.0, fw * 2.0, borderDist);
            if (borderAlpha > 0.0) {
                color.rgb = mix(color.rgb, vec3(0.0, 1.0, 1.0), borderAlpha * 0.4);
            }

            float tickLength = 0.015; 
            if (dist > fovea_radius && dist < fovea_radius + tickLength) {
                float tickRadial = 1.0; 
                tickRadial *= (1.0 - smoothstep(fovea_radius + tickLength * 0.5, fovea_radius + tickLength, dist));
                
                float tickWidth = smoothstep(0.97, 0.98, cos(angle * 12.0)); 
                
                float tickAlpha = tickRadial * tickWidth;
                if (tickAlpha > 0.0) {
                    color.rgb = mix(color.rgb, vec3(0.0, 1.0, 1.0), tickAlpha * 0.9);
                }
            }
        }

        if (u_debug_boundary > 1.5) { 
            float visualParafoveaRadius = parafovea_radius; 
            float parafoveaDist = abs(dist - visualParafoveaRadius);
            float fw = fwidth(parafoveaDist);
            
            float ringPresence = 1.0 - smoothstep(0.0, fw * 3.0, parafoveaDist);
            
            float dashPattern = smoothstep(-0.2, 0.1, sin(angle * 60.0));
            
            float ringAlpha = ringPresence * dashPattern;
            
            if (ringAlpha > 0.0) {
                color.rgb = mix(color.rgb, vec3(1.0, 0.5, 0.0), ringAlpha * 0.85);
            }
        }

        if (u_debug_boundary > 2.5) {
             if (dist > parafovea_radius) {
                float r0 = parafovea_radius;
                float expansionFactor = 1.4; 
                
                float n = log(dist / r0) / log(expansionFactor);
                float n_idx = round(n);
                float dist_to_ring = abs(n - n_idx);
                
                float ringWidth = 0.02; 
                float ringAlpha = 1.0 - smoothstep(0.0, ringWidth, dist_to_ring);
                
                float spokeWidth = smoothstep(0.995, 0.998, cos(angle * 16.0));
                
                float gridAlpha = max(ringAlpha, spokeWidth);
                
                vec3 gridColor = vec3(0.0, 0.8, 1.0); 
                
                if (gridAlpha > 0.0) {
                    color.rgb = mix(color.rgb, gridColor, gridAlpha * 0.15);
                    color.rgb += gridColor * gridAlpha * 0.1; 
                }
             }
        }
    }
    
    // === CONGESTION REPORT (Rosenholtz 2007) ===
    // Follows same pattern as structure/saliency debug views:
    // reset to source image, then paint the visualization on top.
    // This works independently of whether the foveal effect is active.
    if (u_show_congestion > 0) {
        // Raw congestion from content analysis — mouse-independent diagnostic.
        // Shows intrinsic clutter of each page region (Rosenholtz 2007).
        // Prefer high-res congestion map from dedicated worker when available.
        float congestion = 0.0;
        if (u_hasCongestionMap > 0.5) {
            congestion = texture(u_congestionMap, v_texCoord).r;
        } else {
            congestion = texture(u_saliencyMap, v_texCoord).g;
        }
        vec3 heatmapColor = congestionHeatmap(congestion);
        vec3 src = sampleSource(uv).rgb;
        color.rgb = mix(src, heatmapColor, 0.85);
    }

    fragColor = color;
}