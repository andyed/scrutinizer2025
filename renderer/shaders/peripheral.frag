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
uniform float u_crowding_radial_bias; // Radial:tangential crowding ratio (default 2.0)


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

// Oriented DoG — orientation-selective band attenuation (Appelle 1972, Toet & Levi 1992)
uniform float u_dog_oriented;      // 0.0 = isotropic (legacy), 1.0 = oriented
uniform float u_dog_orient_bias;   // Oblique effect strength (0=none, 1=biological ~50%, 2=exaggerated)
uniform float u_dog_radial_bias;   // Radial-tangential anisotropy (0=off, Phase 3)

// Gaussian blur comparison mode — eccentricity-scaled MIP blur without band decomposition
uniform float u_gaussian_blur_mode; // 0.0 = normal, 1.0 = comparison Gaussian

// FOVI (Cortical Magnification) uniforms — Blauch, Alvarez & Konkle (2026)
uniform float u_cmf_enabled;     // 0.0 = legacy linear, 1.0 = CMF logarithmic
uniform float u_cmf_a;            // Cortical magnification constant (default 2.78)
uniform float u_cortical_max;     // ln(r_max+a) - ln(a), precomputed on JS side
uniform float u_num_cortical_rings; // Number of cortical sampling rings
uniform float u_cmf_color_sigma; // Gaussian color decay sigma (0.0 = disabled)
uniform float u_ecc_scaling;     // Pooling growth rate (Brown et al. 2023, Bouma scaling, default 0.75)
uniform float u_desat_floor;      // Min desaturation multiplier in salient regions (1.0 = full desat, 0.85 = 15% cap)

// Chromatic pooling — per-channel RG/YV eccentricity decay (castleCSF; Ashraf et al. 2024)
// NOTE: castleCSF k_e values are *detection threshold* decay rates. Suprathreshold
// color appearance decays more slowly — Jiang, Shooner & Mullen (2022) found power-law
// exponent ~0.5 maps threshold sensitivity to perceived saturation at high contrasts.
uniform float u_saccadic_blindness; // 0.0=off, 1.0=suppress fovea during saccades
uniform vec2  u_velocity_dir;          // Directional velocity (px/ms) for reading span
uniform float u_reading_span;          // 0=strict circle, 1=asymmetric envelope (Rayner 1998)
uniform float u_reading_span_strength; // 0.7=comfort, 1.0=full Rayner asymmetry
uniform float u_chromatic_pooling;  // 0.0=off (legacy uniform desat), 1.0=on
uniform float u_rg_decay;           // RG (L-M) eccentricity decay k_e (default 0.072, Bowers et al. 2025 suprathreshold)
uniform float u_rg_freq_decay;      // RG frequency-dependent decay k_ef (default 0.003)
uniform float u_yv_decay;           // YV S-(L+M) base decay k_e (default 0.014, Bowers et al. 2025 suprathreshold)
uniform float u_yv_freq_decay;      // YV frequency-dependent decay k_ef (default 0.008)
uniform float u_supra_exponent;     // Threshold→appearance compression (default 0.5; 1.0=raw threshold)

// Congestion overlay (Rosenholtz et al. 2007)
uniform int u_show_congestion;    // 0=off, 1=overlay, 2=solo

// Congestion-gated pooling (hypothesis mode)
uniform float u_congestion_pooling; // 0.0=off, 1.0=on

// Density-gated crowding (Bouma 1970 approximation)
// Dense content (text clusters) gets full V1 distortion; sparse content (isolated elements) is spared.
uniform float u_crowding_density_threshold; // Density below this = minimal crowding (default 0.3)
uniform float u_crowding_density_steepness; // Sigmoid sharpness (default 10.0)

// High-resolution congestion map (from dedicated congestion worker)
// R=congestion, G=edgeDensity — higher quality than u_saliencyMap.gb at 256px
uniform sampler2D u_congestionMap;
uniform float u_hasCongestionMap; // 0.0=not available, 1.0=use high-res data
uniform vec2 u_congestionMapSize; // Width/height of congestion map texture (for Bouma LOD)

// WebGPU compute metamer texture (Tier 2.5 — crowding synthesis)
// RGBA: RGB = oriented noise metamer, A = blend weight (0=foveal passthrough, 1=full metamer)
uniform sampler2D u_computeStatTexture;
uniform float u_compute_tier; // 0.0=disabled, 2.5=active
uniform vec2 u_compute_frame_scale; // frame/canvas ratio for UV correction (1.0 if same)

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

// === LOD-AWARE SAMPLER (Sector-area averaging) ===
// Samples at a specific MIP level for area-averaged coverage.
// Used by polar pooling to average across the sector area instead of
// point-sampling the center (which misses thin features like toolbars).
vec4 sampleSourceLod(vec2 uv, float lod) {
    vec4 col = textureLod(u_texture, uv, lod);
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

// Forward declarations — defined after Oklab conversion functions
vec3 rgbToOklab(vec3 srgb);
vec4 chromaticAttenuate(vec4 color, float rg_atten, float yv_atten);

// === DoG PERIPHERAL RECONSTRUCTION ===
// Decomposes the hardware MIP chain into an approximate Laplacian pyramid.
// Hardware mipmaps use box/bilinear filtering (not Gaussian convolution), so band
// differences are Difference-of-Boxes — an approximation of true DoG with some
// spectral leakage between bands. See Burt & Adelson (1983) for true Laplacian pyramids.
// Biology: retinal ganglion cells have center-surround RFs ≈ DoG filters.
// Field size grows with eccentricity. At fovea: all bands. In periphery: only low-freq survives.
vec4 sampleDoGReconstructed(vec2 uv, float eccentricity, float fovea_radius,
                             float dog_e2, float dog_sharpness, float visual_ecc,
                             vec2 undistortedUV) {
    float normEcc = max(0.0, eccentricity) / max(fovea_radius, 0.001);           // spatial bands (V1 distortion-coupled)
    float chromNormEcc = max(0.0, visual_ecc) / max(fovea_radius, 0.001);        // chromatic decay (true gaze eccentricity)

    // --- Oriented DoG Phase 2: 4-orientation energy decomposition ---
    // Uses undistorted UV so gradient measures content orientation, not V1 warp artifacts.
    // MIP 1 averages 2x2 blocks — robust to pixel noise, captures stroke-level orientation.
    //
    // Phase 1 used cos(2θ) which lumps H and V together. Phase 2 decomposes gradient
    // energy into 4 channels (H/V/D45/D135) matching V1 simple cell orientation tuning
    // (Hubel & Wiesel 1962). This enables independent H vs V weighting — text-heavy pages
    // are predominantly horizontal edges (baselines, ascenders) which can be favored over
    // vertical edges (column borders) if needed.
    float orientBonus = 0.0;
    if (u_dog_oriented > 0.5) {
        vec2 px = 2.0 / u_resolution;  // MIP 1 texel size
        // Luminance from BGRA-ordered texture: .b=Red, .g=Green, .r=Blue
        // Correct luma weights: 0.299*R(.b) + 0.587*G(.g) + 0.114*B(.r)
        vec3 lumaW = vec3(0.114, 0.587, 0.299);
        float lum_r = dot(textureLod(u_texture, undistortedUV + vec2(px.x, 0.0), 1.0).rgb, lumaW);
        float lum_l = dot(textureLod(u_texture, undistortedUV - vec2(px.x, 0.0), 1.0).rgb, lumaW);
        float lum_t = dot(textureLod(u_texture, undistortedUV + vec2(0.0, px.y), 1.0).rgb, lumaW);
        float lum_b = dot(textureLod(u_texture, undistortedUV - vec2(0.0, px.y), 1.0).rgb, lumaW);

        float gx = lum_r - lum_l;
        float gy = lum_t - lum_b;
        float g2 = gx * gx + gy * gy;

        // 4-channel orientation energy decomposition (V1 simple cell model)
        // Gradient (gx,gy) is perpendicular to the edge: a horizontal edge has gy >> gx.
        float energy_h = gy * gy;                        // Horizontal edges → vertical gradient
        float energy_v = gx * gx;                        // Vertical edges → horizontal gradient
        float gd1 = (gx + gy) * 0.7071;                 // 45° projection (1/√2)
        float gd2 = (gx - gy) * 0.7071;                 // 135° projection
        float energy_d45  = gd1 * gd1;
        float energy_d135 = gd2 * gd2;

        // Cardinal selectivity: |H - V energy| vs total gradient energy
        // Phase 1 cos(2θ) was correct but couldn't distinguish H from V.
        // Phase 2 keeps 4-channel decomposition for debug/future asymmetric H/V,
        // but uses max(H,V) vs max(D45,D135) for the cardinal fraction.
        // This avoids the degenerate cardinalFrac≡0.5 from summing overlapping projections.
        float cardinalMax = max(energy_h, energy_v);
        float obliqueMax = max(energy_d45, energy_d135);
        float cardinalFrac = cardinalMax / (cardinalMax + obliqueMax + 1e-6);

        // Gradient magnitude gate — flat regions get no bonus (prevents noise amplification)
        // Thresholds tuned for web UI: 1px borders between #fff and #e9ecef produce
        // gradMag ~0.01 at MIP 1. Lower gate to catch real UI edges while still
        // rejecting JPEG noise and flat regions.
        float gradMag = sqrt(g2);
        float edgeGate = smoothstep(0.005, 0.03, gradMag);

        orientBonus = cardinalFrac * edgeGate * u_dog_orient_bias;

        // --- Phase 3: Radial-tangential anisotropy (Toet & Levi 1992) ---
        // Crowding is ~2x stronger along the radial axis (toward/away from fovea).
        // Tangential edges (perpendicular to eccentricity vector) survive further.
        // Radial edges (parallel to eccentricity vector) get a penalty.
        if (u_dog_radial_bias > 0.001) {
            vec2 foveaUV = u_mouse / u_resolution;
            vec2 toFovea = undistortedUV - foveaUV;
            float dist = length(toFovea);
            if (dist > 1e-4) {
                vec2 radialDir = toFovea / dist;
                // Edge direction is perpendicular to gradient
                vec2 edgeDir = vec2(-gy, gx);
                float edgeMag = length(edgeDir);
                if (edgeMag > 1e-6) {
                    edgeDir /= edgeMag;
                    // Tangential direction = perpendicular to radial
                    vec2 tangDir = vec2(-radialDir.y, radialDir.x);
                    float tangentialAlign = abs(dot(edgeDir, tangDir));
                    // tangentialAlign: 1.0 = edge runs tangentially (survives longer)
                    //                  0.0 = edge runs radially (crowded more)
                    // Modulate orientBonus: tangential gets up to +30%, radial gets -15%
                    float radialMod = mix(
                        1.0 - u_dog_radial_bias * 0.15,  // radial penalty
                        1.0 + u_dog_radial_bias * 0.3,   // tangential bonus
                        tangentialAlign
                    );
                    orientBonus *= radialMod;
                }
            }
        }
    }

    // Sample 13 MIP levels at half-octave spacing (LOD 0.0 to 6.0 in 0.5 steps)
    // Half-integer LODs trigger hardware trilinear interpolation (2 bilinear reads + lerp),
    // giving us the half-octave Gaussian we need. 13 samples = 21 bilinear lookups total.
    // MIP 5-6 textures are tiny (60×33, 30×16 for 1920×1080) — reads are cache-free.
    vec4 mip[13];
    mip[0]  = textureLod(u_texture, uv, 0.0);
    mip[1]  = textureLod(u_texture, uv, 0.5);
    mip[2]  = textureLod(u_texture, uv, 1.0);
    mip[3]  = textureLod(u_texture, uv, 1.5);
    mip[4]  = textureLod(u_texture, uv, 2.0);
    mip[5]  = textureLod(u_texture, uv, 2.5);
    mip[6]  = textureLod(u_texture, uv, 3.0);
    mip[7]  = textureLod(u_texture, uv, 3.5);
    mip[8]  = textureLod(u_texture, uv, 4.0);
    mip[9]  = textureLod(u_texture, uv, 4.5);
    mip[10] = textureLod(u_texture, uv, 5.0);
    mip[11] = textureLod(u_texture, uv, 5.5);
    mip[12] = textureLod(u_texture, uv, 6.0);

    // 12 half-octave DoG bands — geometric sqrt(2) spacing
    // Odd-indexed cutoffs match old 4-band anchors exactly.
    // At intermediate eccentricities, 3-4 bands carry distinct fractional weights
    // simultaneously — measurable frequency-selective behavior that single-sample
    // Gaussian blur cannot reproduce.
    vec4 band[12];
    band[0]  = mip[0]  - mip[1];   // ~5.66 cpd  (finest detail, serifs)
    band[1]  = mip[1]  - mip[2];   // ~4.0 cpd   (thin strokes)
    band[2]  = mip[2]  - mip[3];   // ~2.83 cpd  (letter bodies)
    band[3]  = mip[3]  - mip[4];   // ~2.0 cpd   (small icons)
    band[4]  = mip[4]  - mip[5];   // ~1.41 cpd  (words, UI labels)
    band[5]  = mip[5]  - mip[6];   // ~1.0 cpd   (word groups)
    band[6]  = mip[6]  - mip[7];   // ~0.71 cpd  (buttons, panels)
    band[7]  = mip[7]  - mip[8];   // ~0.5 cpd   (layout blocks)
    band[8]  = mip[8]  - mip[9];   // ~0.354 cpd (large panels)
    band[9]  = mip[9]  - mip[10];  // ~0.250 cpd (page sections)
    band[10] = mip[10] - mip[11];  // ~0.177 cpd (half-page regions)
    band[11] = mip[11] - mip[12];  // ~0.125 cpd (full-width color fields)
    // residual = mip[12]           // ~0.088 cpd (DC, always preserved)

    // Per-band cutoff eccentricities — half-octave M-scaling
    // cutoff_k = E2 × (2^(k/2) − 1) for linear path
    // Odd-indexed cutoffs (c[1], c[3], c[5], c[7]) match old 4-band cutoffs exactly:
    //   c[1]=E2*1.0, c[3]=E2*3.0, c[5]=E2*7.0, c[7]=E2*15.0
    float c[12];
    float e2 = max(dog_e2, 0.01);
    if (u_cmf_enabled > 0.5) {
        // CMF-derived: c_k = cmf_a × (exp(k×0.5×scale) − 1) / fovea_deg
        // Schwartz (1980), Blauch, Konkle & Alvarez (2026)
        float fovea_deg = 1.0;  // 1° foveal radius (2° diameter)
        float maxMipLevel = 6.0;
        float scale = u_cortical_max / maxMipLevel / (u_ecc_scaling / 0.75);
        c[0]  = u_cmf_a * (exp(0.5 * scale) - 1.0) / fovea_deg;
        c[1]  = u_cmf_a * (exp(1.0 * scale) - 1.0) / fovea_deg;  // == old c0
        c[2]  = u_cmf_a * (exp(1.5 * scale) - 1.0) / fovea_deg;
        c[3]  = u_cmf_a * (exp(2.0 * scale) - 1.0) / fovea_deg;  // == old c1
        c[4]  = u_cmf_a * (exp(2.5 * scale) - 1.0) / fovea_deg;
        c[5]  = u_cmf_a * (exp(3.0 * scale) - 1.0) / fovea_deg;  // == old c2
        c[6]  = u_cmf_a * (exp(3.5 * scale) - 1.0) / fovea_deg;
        c[7]  = u_cmf_a * (exp(4.0 * scale) - 1.0) / fovea_deg;  // == old c3
        c[8]  = u_cmf_a * (exp(4.5 * scale) - 1.0) / fovea_deg;
        c[9]  = u_cmf_a * (exp(5.0 * scale) - 1.0) / fovea_deg;
        c[10] = u_cmf_a * (exp(5.5 * scale) - 1.0) / fovea_deg;
        c[11] = u_cmf_a * (exp(6.0 * scale) - 1.0) / fovea_deg;
    } else {
        // Linear M-scaling: cutoff_k = E2 * (2^(k/2) - 1), k=1..12
        c[0]  = e2 * 0.41421;   // sqrt(2) - 1
        c[1]  = e2 * 1.0;       // == old c0
        c[2]  = e2 * 1.82843;   // 2*sqrt(2) - 1
        c[3]  = e2 * 3.0;       // == old c1
        c[4]  = e2 * 4.65685;   // 4*sqrt(2) - 1
        c[5]  = e2 * 7.0;       // == old c2
        c[6]  = e2 * 10.31371;  // 8*sqrt(2) - 1
        c[7]  = e2 * 15.0;      // == old c3
        c[8]  = e2 * 21.62742;  // 16*sqrt(2) - 1
        c[9]  = e2 * 31.0;
        c[10] = e2 * 44.25483;  // 32*sqrt(2) - 1
        c[11] = e2 * 63.0;
    }

    // Oriented DoG: push cutoffs outward for cardinal-aligned content
    // Finest bands (k=0) get up to 50% boost, coarsest (k=11) get 10% — fine detail
    // benefits most from the oblique effect, coarse structure is already robust.
    // When orientBonus=0 (disabled or flat region), all boosts are 1.0 — no change.
    //
    // Eccentricity fade: the oblique effect diminishes with retinal eccentricity.
    // Fine bands lose the cardinal advantage by ~10° (Berkley et al. 1975),
    // coarse bands retain it to ~25° (Essock 1990). Rate depends on spatial frequency.
    // fovea_radius ≈ 1° foveal radius (2° diameter) → px_per_deg ≈ fovea_radius / 1.0
    float px_per_deg = max(fovea_radius / 1.0, 1.0);
    float visual_ecc_deg = visual_ecc / px_per_deg;

    for (int k = 0; k < 12; k++) {
        // Per-band eccentricity fade:
        //   Band 0 (finest, >4 cpd): fades 3°–10° (Berkley 1975: gone by 8–18°)
        //   Band 11 (coarsest, <0.125 cpd): fades 8°–25° (Essock 1990: persists to 40°)
        float fadeStart = mix(3.0, 8.0, float(k) / 11.0);
        float fadeEnd   = mix(10.0, 25.0, float(k) / 11.0);
        float eccFade   = 1.0 - smoothstep(fadeStart, fadeEnd, visual_ecc_deg);

        // For exaggerated demo/capture mode (bias > 3), bypass eccFade so the
        // orient bonus is visible at typical viewport scales. At biological
        // levels (bias ≤ 2), the eccFade is correct but produces sub-pixel
        // differences that don't survive JPEG compression.
        float effectiveEccFade = u_dog_orient_bias > 3.0 ? 1.0 : eccFade;

        float boost = 1.0 + orientBonus * effectiveEccFade * mix(0.5, 0.1, float(k) / 11.0);
        c[k] *= boost;
    }

    // Transition width: biological (wide, gradual) vs sharp (narrow, crisp)
    float transMult = mix(0.4, 0.05, dog_sharpness);

    // Per-band weights via smoothstep rolloff
    float w[12];
    for (int k = 0; k < 12; k++) {
        w[k] = 1.0 - smoothstep(c[k] - c[k] * transMult, c[k] + c[k] * transMult, normEcc);
    }

    // Cortical resolution floor: suppress DoG bands finer than the local cortical
    // sector can resolve (Nyquist limit of the pooling region). The sector radial
    // extent grows with eccentricity via CMF: dr ≈ (r + a) × (exp(w_step) - 1).
    // Bands below this floor carry no information the cortical grid could represent.
    // The 1.5 LOD shift models the CSF roll-off — suppression starts ~3× finer than
    // the hard Nyquist limit, not at the limit itself (see Rovamo & Virsu 1979).
    if (u_cmf_enabled > 0.5) {
        float ppd = px_per_deg;
        float r_deg_floor = normEcc * 1.0;  // fovea_deg = 1.0
        float N_rings = 50.0;  // Blauch default cortical ring count
        float w_step_floor = u_cortical_max / (N_rings - 1.0);
        float dr_deg = (r_deg_floor + u_cmf_a) * (exp(w_step_floor) - 1.0);
        float sectorExtent_px = dr_deg * ppd;
        float lodFloor = log2(max(1.0, sectorExtent_px)) - 1.5;

        // Displacement-distance boost REMOVED: it stripped high-frequency detail
        // from displaced content, creating grey fog instead of letter confusion.
        // The cortical lodFloor above handles the Nyquist limit; the Shredder's
        // displacement should preserve feature contrast, not blur it away.

        for (int k = 0; k < 12; k++) {
            float bandLod = float(k) * 0.5;
            w[k] *= smoothstep(lodFloor - 0.5, lodFloor + 0.5, bandLod);
        }
    }

    // Reconstruct: residual (always full) + weighted bands
    // Clamp to [0,1] — band differences can be negative, partial attenuation
    // may produce out-of-range values
    vec4 result;

    if (u_chromatic_pooling > 0.5) {
        // Per-band chromatic attenuation (castleCSF; Ashraf et al. 2024)
        // RG (L-M): steep base decay + weak freq dependence (suprathreshold spatial summation)
        // YV S-(L+M): slow base decay + strong freq dependence (coarse bands persist)
        float fovea_deg = 1.0;  // 1° foveal radius (2° diameter)
        float r_deg = chromNormEcc * fovea_deg;
        float ecc_deg;
        if (u_cmf_enabled > 0.5 && r_deg > fovea_deg) {
            // Cortical-mapped eccentricity: log(r+a) compresses far periphery.
            // Bowers (2025) measured biphasic RG decay — steep to ~15°, then slowing.
            // The log transform produces this shape naturally: fast cortical distance
            // growth near fovea, slowing with eccentricity. No explicit knee needed.
            // Anchored so effectiveEcc(15°) = 15° (Bowers reference eccentricity).
            float w = log(1.0 + r_deg / u_cmf_a);
            float w_fov = log(1.0 + fovea_deg / u_cmf_a);
            float w_ref = log(1.0 + 15.0 / u_cmf_a);
            ecc_deg = fovea_deg + (15.0 - fovea_deg) * (w - w_fov) / (w_ref - w_fov);
        } else {
            ecc_deg = r_deg;  // legacy linear path
        }

        // Threshold sensitivity → appearance compression (Jiang, Shooner & Mullen 2022)
        float supra = max(u_supra_exponent, 0.01);

        // Half-octave band center frequencies (cpd)
        // 13 values: 12 bands + 1 residual (mip[12])
        const float bandFreq[13] = float[13](5.657, 4.0, 2.828, 2.0, 1.414, 1.0, 0.707, 0.5, 0.354, 0.250, 0.177, 0.125, 0.088);

        // Per-band RG and YV attenuation
        float rg_atten[13], yv_atten[13];
        for (int k = 0; k < 13; k++) {
            rg_atten[k] = pow(pow(10.0, -(u_rg_decay + u_rg_freq_decay * bandFreq[k]) * ecc_deg), supra);
            yv_atten[k] = pow(pow(10.0, -(u_yv_decay + u_yv_freq_decay * bandFreq[k]) * ecc_deg), supra);
        }

        // BGRA → RGBA before Oklab round-trips (Electron capture quirk)
        // chromaticAttenuate() uses rgbToOklab() which assumes RGB channel order
        mip[12] = mip[12].bgra;
        for (int k = 0; k < 12; k++) { band[k] = band[k].bgra; }

        // Swatch preservation: large uniform color regions retain more chrominance.
        // mip[12] at LOD 6.0 averages ~64×64 source pixels — its Oklab chrominance
        // magnitude measures whether this region is a large color swatch (high chroma)
        // or mixed/text content (low chroma). Biology: S-cone signals pool over large
        // areas; isolated colored targets lose hue faster than uniform fields.
        vec3 swatchLab = rgbToOklab(mip[12].rgb);  // already RGBA after swap above
        float swatchChroma = length(vec2(swatchLab.y, swatchLab.z));
        float swatchBoost = smoothstep(0.01, 0.04, swatchChroma);  // 0 for achromatic/text, 1 for saturated swatch
        float swatchRetain = 1.0 + swatchBoost * 0.3;  // up to 30% more color for large swatches

        // Residual: NO swatch boost (prevents color halos at region boundaries)
        result = chromaticAttenuate(mip[12], rg_atten[12], yv_atten[12]);
        // Bands: swatch-modulated attenuation (clamped to 1.0 — never amplify beyond original)
        for (int k = 11; k >= 0; k--) {
            float eff_rg = min(rg_atten[k] * swatchRetain, 1.0);
            float eff_yv = min(yv_atten[k] * swatchRetain, 1.0);
            result += chromaticAttenuate(band[k], eff_rg, eff_yv) * w[k];
        }
        result = clamp(result, 0.0, 1.0);
        // Already in RGBA — skip the swap below
    } else {
        // Legacy: luminance-only reconstruction (no per-channel decay)
        result = mip[12];
        for (int k = 0; k < 12; k++) { result += band[k] * w[k]; }
        result = clamp(result, 0.0, 1.0);

        // BGRA → RGBA (Electron capture quirk)
        float temp = result.r;
        result.r = result.b;
        result.b = temp;
    }


    return result;
}

// === BOUMA-SCALED EDGE DENSITY ===
// Samples the congestion map's edge density channel (G) at a MIP level matching
// Bouma's critical spacing (0.5 × eccentricity in degrees). This integrates edge
// density over a Bouma-sized neighborhood — high values mean flankers are packed
// within the critical spacing window, triggering crowding distortion.
//
// The GPU MIP chain does the spatial integration for free: textureLod at LOD N
// averages over a 2^N × 2^N texel neighborhood, approximating the pooling region.
//
// dist: pixel distance from fovea center
// fovea_radius: fovea radius in pixels (~1° foveal radius)
// uv: texture coordinate to sample
float sampleBoumaEdgeDensity(float dist, float fovea_radius, vec2 uv) {
    float px_per_deg = max(fovea_radius / 1.0, 1.0);
    float ecc_deg = max(0.0, dist - fovea_radius) / px_per_deg;

    // Bouma's law: critical spacing ≈ 0.5 × eccentricity (Bouma 1970)
    float boumaRadiusDeg = 0.5 * ecc_deg;
    float boumaRadiusPx = boumaRadiusDeg * px_per_deg;

    // Convert pixel radius to congestion map texels
    float mapDim = max(u_congestionMapSize.x, 1.0);
    float boumaRadiusTexels = boumaRadiusPx * (mapDim / u_resolution.x);

    // LOD = log2(diameter) — how many MIP levels to traverse for this pooling window
    float boumaLOD = clamp(log2(max(1.0, 2.0 * boumaRadiusTexels)), 0.0, 5.0);

    if (u_hasCongestionMap > 0.5) {
        return textureLod(u_congestionMap, uv, boumaLOD).g;
    } else {
        // Fallback: saliency map edge density (B channel), coarser but functional
        return textureLod(u_saliencyMap, uv, min(boumaLOD, 3.0)).b;
    }
}

// === CMF MIP LEVEL COMPUTATION ===
// Shared by MIP pooling, Minecraft block sizing, and any eccentricity→resolution mapping.
// Returns 0.0 at fovea, up to maxMipLevel (6.0) in far periphery.
float computeMipLevel(float eccentricity, float fovea_radius) {
    float normalizedEcc = max(0.0, eccentricity) / fovea_radius;
    float maxMipLevel = 6.0;
    if (u_cmf_enabled > 0.5) {
        // Cortical distance: d(r) = log(1 + r/a), numerically stable form
        // Schwartz (1980), Blauch, Konkle & Alvarez (2026)
        float r_deg = normalizedEcc * 2.0;
        float cortical_dist = log(1.0 + r_deg / u_cmf_a);
        // ecc_scaling modulates pooling zone growth rate (Brown et al. 2023).
        // Normalized so 0.75 (their default) = no change from base CMF curve.
        float eccScale = u_ecc_scaling / 0.75;
        return clamp(maxMipLevel * cortical_dist / u_cortical_max * eccScale, 0.0, maxMipLevel);
    }
    return clamp(normalizedEcc * 2.5, 0.0, maxMipLevel);
}

// === POLAR SECTOR COMPUTATION ===
// Shared by V1 type 4 (polar quantize) and V4 style 8 (polar pooling).
// Computes which radial sector a fragment belongs to: ring index, spoke index,
// and the UV-space center of that sector.
struct PolarSector {
    float r;           // distance from fovea (aspect-corrected)
    float angle;       // -PI to PI
    float ring_inner;
    float ring_outer;
    float ring_center;
    float spokeCount;
    float spokeWidth;
    float spoke_center;
    float n_idx;       // ring index
    vec2 mouse_c;      // aspect-corrected mouse position (needed for UV reconstruction)
};

PolarSector computePolarSector(vec2 uv, float parafovea_radius) {
    PolarSector s;
    float aspect = u_resolution.x / u_resolution.y;
    vec2 uv_c = vec2(uv.x * aspect, uv.y);
    vec2 mouse_uv = u_mouse_stable / u_resolution;
    s.mouse_c = vec2(mouse_uv.x * aspect, mouse_uv.y);
    vec2 diff = uv_c - s.mouse_c;
    // Match dist's coordinate system: divide x by fovea_aspect_ratio
    // so ring radii are consistent with parafovea_radius and fovea_radius.
    vec2 diff_scaled = vec2(diff.x / u_fovea_aspect_ratio, diff.y);
    s.r = length(diff_scaled);
    s.angle = atan(diff_scaled.y, diff_scaled.x);

    // CMF-density ring spacing: ef=1.007 with bias=2.0 gives ring width ≈ r × 1.4%.
    // This tracks CMF block sizes: ~8px at mipLevel 1, ~16px at mipLevel 2.
    // ef=1.03 was 4× too coarse in the far periphery (65px vs CMF's 16px).
    float r0 = parafovea_radius;
    float ef = 1.007;
    float bias = u_crowding_radial_bias;
    float n_cont = log(max(s.r, r0) / r0) / log(ef);
    float n_biased = n_cont / bias;
    s.n_idx = floor(n_biased);

    s.ring_inner = r0 * pow(ef, s.n_idx * bias);
    s.ring_outer = r0 * pow(ef, (s.n_idx + 1.0) * bias);
    s.ring_center = (s.ring_inner + s.ring_outer) * 0.5;

    // Spoke count derived from ring geometry: arc length ≈ ring width.
    // This makes sectors approximately square before bias elongation.
    // With bias=2.0, radial extent is 2× tangential → 2:1 aspect ratio.
    // Use unbiased ring width for spoke count so radial bias creates 2:1 R:T sectors
    // (biased ringWidth = ring_outer - ring_inner is wider; dividing by it neutralized the elongation)
    float unbiasedWidth = s.ring_center * (ef - 1.0);
    s.spokeCount = max(6.0, floor(6.28318530718 * s.ring_center / unbiasedWidth));
    s.spokeCount = floor(s.spokeCount / 2.0) * 2.0; // keep even
    s.spokeWidth = 6.28318530718 / s.spokeCount;

    float spoke_idx = floor((s.angle + 3.14159265359) / s.spokeWidth);
    s.spoke_center = spoke_idx * s.spokeWidth - 3.14159265359 + s.spokeWidth * 0.5;

    return s;
}

// === LEGACY: Simple MIP pooling (used when DoG disabled) ===
vec4 sampleMIPPooled(vec2 uv, float eccentricity, float fovea_radius) {
    float mipLevel = computeMipLevel(eccentricity, fovea_radius);

    vec4 col = textureLod(u_texture, uv, mipLevel);

    float temp = col.r;
    col.r = col.b;
    col.b = temp;

    return col;
}

// === GRADIENT-AWARE MIP POOLING ===
vec4 sampleMIPPooledGrad(vec2 uv, vec2 duvdx, vec2 duvdy, float eccentricity, float fovea_radius) {
    float mipLevel = computeMipLevel(eccentricity, fovea_radius);

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
    // Sign-preserving cube root: pow(x, 1/3) is undefined for x<0 in GLSL ES 3.0.
    // Band differences (mip_k - mip_{k+1}) produce negative LMS values.
    float l_ = sign(l) * pow(abs(l), 1.0 / 3.0);
    float m_ = sign(m) * pow(abs(m), 1.0 / 3.0);
    float s_ = sign(s) * pow(abs(s), 1.0 / 3.0);
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

// === CHROMATIC ATTENUATION (castleCSF per-channel decay) ===
// Attenuates Oklab a (red-green) and b (blue-yellow) independently.
// RG is a foveal specialization (L-M opponent channel) that collapses ~2.5× faster
// than achromatic sensitivity. YV (S-(L+M)) persists far into periphery.
// Bowers, Gegenfurtner & Goettker (2025): at 15°, RG≈29%, YV≈79%.
vec4 chromaticAttenuate(vec4 color, float rg_atten, float yv_atten) {
    vec3 lab = rgbToOklab(color.rgb);
    lab.y *= rg_atten;   // a channel (red-green)
    lab.z *= yv_atten;   // b channel (blue-yellow)
    return vec4(oklabToRgb(lab), color.a);
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

// === DISTORTION COMPONENTS (Bender + Cutter) ===
// Parameterized for researcher swappability. Each V1 type builds its own
// config; researchers fork by inlining or replacing these functions.

struct BenderConfig {
    float freq;            // base noise frequency (150 for type 1, sector-derived for type 5)
    float octave2_scale;   // 2nd octave freq multiplier (2.0)
    float octave2_weight;  // 2nd octave amplitude (0.5)
    float amplitude;       // UV-space warp magnitude (0.0024)
    vec2  bias;            // per-axis strength (vec2(2.0, 1.0) for horiz/radial bias)
};

struct CutterConfig {
    vec2  cellFreq;        // grid frequency in UV space (vec2(400, 300))
    vec2  baseThrow;       // base displacement (vec2(0.008, 0.0016))
    float progressive;     // eccentricity growth factor
    float onset;           // scrambleZone (0–1)
};

vec2 applyBender(vec2 uv_in, BenderConfig cfg, float strength, float intensity) {
    float n1 = snoise(uv_in * cfg.freq);
    float n2 = snoise(uv_in * cfg.freq * cfg.octave2_scale) * cfg.octave2_weight;
    vec2 warp = vec2(n1 + n2) * cfg.amplitude * strength * intensity;
    warp *= cfg.bias;
    return warp;
}

vec2 applyCutter(vec2 uv_in, CutterConfig cfg, float intensity, float edgeCrowdMult) {
    if (cfg.onset < 0.01) return vec2(0.0);
    vec2 cellID = floor(uv_in * cfg.cellFreq);
    vec2 jitter = hash22(cellID) - 0.5;
    vec2 throwDist = cfg.baseThrow * intensity * edgeCrowdMult * cfg.progressive;
    return jitter * throwDist * cfg.onset * cfg.onset;
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
    bool cmf_enabled;
};

struct LGN_Signal {
    float suppressionFactor;
    float saliency;
    float congestion;   // Feature Congestion (Rosenholtz 2007) — local feature variance
    float edgeDensity;  // Edge Density — local Sobel magnitude density
    float density;
    float softDensity; // Blurred density (LOD 4) for smooth crowding gate at content edges
    float rhythm;
    float type;
};

struct V1_Signal {
    vec2 distortedUV;
    float distortionStrength;
    vec2 displacement;
    float scrambleZone;
};

// --- STAGE 1: LGN (Gating & Analysis) ---
LGN_Signal processLGN(vec2 uv, ModeConfig config, float dist, float fovea_radius) {
    LGN_Signal signal;
    
    // Ratio reconstruction: sharp LOD 0 for type/density, blurred LOD 4 for rhythm.
    // Rhythm = R/G at low resolution recovers the DOM rhythm signal that cliff-edges
    // destroy at full res (R and G both drop at boundaries, but their ratio is stable).
    vec4 structureSharp = textureLod(u_structureMap, uv, 0.0);
    vec4 structureBlur  = textureLod(u_structureMap, uv, 4.0);
    signal.type    = structureSharp.b;
    signal.density = structureSharp.g;
    float rawRhythm = structureBlur.r / max(structureBlur.g, 0.0005);
    signal.rhythm   = clamp(rawRhythm, 0.0, 1.0);
    // Soft density for crowding gate — blurred density tapers at content edges
    // instead of cliff-edging, giving smooth V1 strength transitions at DOM boundaries
    signal.softDensity = structureBlur.g;

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
    
    // LGN suppression via corticalStrength — continuous, no zone boundaries.
    float lgn_ecc_deg = max(0.0, dist) / max(fovea_radius, 0.001);
    float lgn_ecc_max = u_cortical_max > 0.1
        ? u_cmf_a * (exp(u_cortical_max) - 1.0) : 25.0;
    float lgn_cs = clamp(lgn_ecc_deg / lgn_ecc_max, 0.0, 1.0);
    float suppressEccEnd = config.lgn_ramp_end_mult / lgn_ecc_max;
    signal.suppressionFactor = smoothstep(0.0, suppressEccEnd, lgn_cs);
    
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
V1_Signal processV1(vec2 uv, vec2 uv_corrected, LGN_Signal lgn, ModeConfig config, float dist, vec2 delta_dir, float fovea_radius, float parafovea_radius, bool isFarPeriphery, bool isParafovea, float memoryStrength) {
    V1_Signal signal;
    signal.distortedUV = uv;
    signal.distortionStrength = 0.0;
    signal.displacement = vec2(0.0);
    signal.scrambleZone = 0.0;

    // === CORTICAL STRENGTH: continuous eccentricity function ===
    // Replaces zone-based smoothstep boundaries (fovea_radius, parafovea_radius).
    // Linear in visual degrees (Bouma's law: pooling region size ∝ eccentricity).
    // fovea_radius is units_per_deg (pixel-to-degree converter), not a spatial boundary.
    float ecc_deg = max(0.0, dist) / max(fovea_radius, 0.001);
    float ecc_max = u_cortical_max > 0.1
        ? u_cmf_a * (exp(u_cortical_max) - 1.0)  // derive from viewport extent
        : 25.0;
    float corticalStrength = clamp(ecc_deg / ecc_max, 0.0, 1.0);

    // Displacement strength: quadratic onset (crowding dead zone at fovea),
    // then linear growth. cs² keeps the fovea near-zero while letting far
    // periphery reach full strength. Calibrated to match v2.3 farScale profile.
    // Calibrated to match v2.3 farScale: ~4.0 at 15°.
    // cs²(15°) = (15/24.3)² = 0.38. 0.38 × 24.3 × 0.4 = 3.7. Close to v2.3's 4.0.
    float eccentricityScale = corticalStrength * corticalStrength * ecc_max * 0.4;

    if (config.v4_style_id == 4 || config.v4_style_id == 8) {
        eccentricityScale = 1.0;
    }
    
    float strength = lgn.suppressionFactor * config.v1_strength_mult * eccentricityScale;

    // V1 crowding gate: DOM density determines whether V1 displacement fires.
    // Text regions (density ≥ 0.3) get full V1 distortion; sparse/isolated elements
    // are spared. This is a coarse "is this content?" gate — fine-grained spacing
    // discrimination is handled by the Bouma-scaled MIP gate (processV4, line ~1000).
    // Floor at 0.3 so isolated elements still lose some acuity, just not full crowding.
    // Use soft (blurred) density for the crowding gate so V1 strength tapers
    // at content edges instead of cliff-edging at DOM boundaries
    float densityCrowding = 1.0 / (1.0 + exp(-u_crowding_density_steepness * (lgn.softDensity - u_crowding_density_threshold)));
    float crowdingFactor = mix(0.3, 1.0, densityCrowding);
    strength *= crowdingFactor;

    if (u_useMask < 1.5) {
        strength *= (1.0 - memoryStrength);
    }

    signal.distortionStrength = strength;

    if (config.v4_style_id == 5) {
        // Drunken Reading Mode
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
    // Restored v2.3 architecture (fixed grid + progressive scaling) with
    // corticalStrength-based scramble onset replacing zone boundaries.
    if (config.v1_distortion_type == 1) {

        // 1. Bender (fractal warp)
        BenderConfig bc;
        bc.freq = 150.0;
        bc.octave2_scale = 2.0;
        bc.octave2_weight = 0.5;
        bc.amplitude = 0.0024;
        bc.bias = vec2(2.0, 1.0);  // horizontal bias
        vec2 fractalWarp = applyBender(uv_corrected, bc, strength, u_intensity);

        // 2. Cutter (discrete scramble)
        // Crowding onset from corticalStrength: absent in central fovea (~0.5°),
        // ramps in by ~2.5° (Pelli & Tillman 2008 uncrowded window).
        float scrambleZone = smoothstep(0.02, 0.15, corticalStrength);
        signal.scrambleZone = scrambleZone;
        float edgeCrowdMult = 1.0 + lgn.edgeDensity * 0.4;

        CutterConfig cc;
        cc.cellFreq = vec2(400.0, 300.0);
        cc.baseThrow = vec2(0.008, 0.0016);
        cc.progressive = 1.0 + corticalStrength * ecc_max * 0.20;
        cc.onset = scrambleZone;
        vec2 discreteScramble = applyCutter(uv_corrected, cc, u_intensity, edgeCrowdMult);

        // 3. Mix: transition from bending (parafovea) to shredding (periphery)
        signal.displacement = mix(fractalWarp, discreteScramble, scrambleZone);
        signal.distortedUV = uv + signal.displacement;

        // 4. Bypass strength gating in scramble zone —
        // saliency would otherwise keep text readable
        if (scrambleZone > 0.5) {
             signal.distortionStrength = 1.0;
        } else {
             signal.distortionStrength = strength;
        }

    } else if (config.v1_distortion_type == 0) {
        // === RADIAL/TANGENTIAL ANISOTROPIC CROWDING ===
        // Crowding ~2:1 stronger radially (Toet & Levi 1992, Pelli et al. 2004).
        // Independent noise per axis to avoid correlation artifacts.

        vec2 uv_corrected_local = vec2(uv.x * u_fovea_aspect_ratio, uv.y);

        float zoneA = smoothstep(fovea_radius, parafovea_radius, dist);
        float zoneB = smoothstep(parafovea_radius, parafovea_radius * 2.0, dist);

        // Radial/tangential basis from fovea
        vec2 radDir = delta_dir;
        vec2 tanDir = vec2(-delta_dir.y, delta_dir.x);

        // Independent noise for each axis (offset seed decorrelates tangential)
        float nR1 = snoise(uv_corrected_local * 800.0);
        float nR2 = snoise(uv_corrected_local * 1600.0);
        float radialNoise = nR1 + (nR2 * 0.5 * zoneB);

        float nT1 = snoise(uv_corrected_local * 800.0 + vec2(43.17, 71.91));
        float nT2 = snoise(uv_corrected_local * 1600.0 + vec2(43.17, 71.91));
        float tangentialNoise = nT1 + (nT2 * 0.5 * zoneB);

        float warpAmp = mix(0.006, 0.024, zoneB);

        float radialDisp = radialNoise * warpAmp * u_crowding_radial_bias;
        float tangentialDisp = tangentialNoise * warpAmp;

        // Project back to UV space (undo aspect corrections on direction vectors)
        float aspect = u_resolution.x / u_resolution.y;
        float xScale = u_fovea_aspect_ratio / aspect;
        vec2 radDir_uv = vec2(radDir.x * xScale, radDir.y);
        vec2 tanDir_uv = vec2(tanDir.x * xScale, tanDir.y);

        vec2 finalWarp = radDir_uv * radialDisp + tanDir_uv * tangentialDisp;

        // Secondary distortion (shear/chop) projected tangentially
        float shearNoise = sin(uv.x * 200.0) * 0.003;
        float chopNoise = snoise(vec2(uv.x * 400.0, uv.y * 50.0)) * 0.020;
        float verticalDistortion = mix(shearNoise, chopNoise, zoneB);
        finalWarp += tanDir_uv * verticalDistortion;

        float effectiveStrength = max(strength, zoneB * 0.8);
        signal.displacement = finalWarp * effectiveStrength * u_intensity;
        signal.distortedUV = uv + signal.displacement;
        signal.distortionStrength = effectiveStrength;

    } else if (config.v1_distortion_type == 3) {
        // === MINECRAFT: CMF-driven block sizing ===
        // Block size = exp2(floor(mipLevel) + 2) → discrete steps: 4, 8, 16, 32, 64px.
        // Makes the CMF resolution curve visible as geometry — blocks grow
        // logarithmically from gaze outward. Discrete steps are the point:
        // this mode is a didactic visualizer showing actual MIP levels.
        // Blocks blend in at parafovea edge to avoid distracting grid shift on mouse move.
        float mipLevel = computeMipLevel(max(0.0, dist - fovea_radius), fovea_radius);

        // No blocks inside parafovea — blend in from parafovea edge outward
        float blockBlend = smoothstep(parafovea_radius, parafovea_radius * 1.5, dist);

        if (blockBlend < 0.001) {
            signal.distortedUV = uv;
            signal.distortionStrength = 0.0;
        } else {
            float blockPx = exp2(floor(mipLevel) + 2.0); // 4, 8, 16, 32, 64
            vec2 pixelSize = vec2(blockPx) / u_resolution;

            // Fixed screen-space grid — blocks don't shift with cursor movement.
            // Peripheral vision is extremely sensitive to coherent motion; a
            // fovea-relative grid causes visible jitter on every mouse move.
            vec2 quantizedUV = floor(uv / pixelSize) * pixelSize + pixelSize * 0.5;

            signal.distortedUV = mix(uv, quantizedUV, blockBlend);
            signal.distortionStrength = strength;
        }
    } else if (config.v1_distortion_type == 4) {
        // === POLAR QUANTIZE: Radial sector snapping (TTM pooling regions) ===
        // Unlike Cartesian Minecraft (type 3) which uses a fixed screen-space grid,
        // this variant is fovea-relative by design — polar grids don't cause
        // coherent edge motion like Cartesian grids do.
        float blockBlend = smoothstep(parafovea_radius, parafovea_radius * 1.5, dist);

        if (blockBlend < 0.001) {
            signal.distortedUV = uv;
            signal.distortionStrength = 0.0;
        } else {
            PolarSector ps = computePolarSector(uv, parafovea_radius);
            float aspect = u_resolution.x / u_resolution.y;

            // Reconstruct UV from sector center:
            // 1. Polar → Cartesian in the scaled space (fovea_aspect_ratio-divided x)
            // 2. Undo fovea_aspect_ratio to get back to aspect-corrected space
            // 3. Undo aspect to get back to UV space
            vec2 sector_offset = ps.ring_center *
                vec2(cos(ps.spoke_center), sin(ps.spoke_center));
            // Undo the fovea_aspect_ratio scaling on x
            sector_offset.x *= u_fovea_aspect_ratio;
            vec2 quantized_c = ps.mouse_c + sector_offset;
            vec2 quantizedUV = vec2(quantized_c.x / aspect, quantized_c.y);

            signal.distortedUV = mix(uv, quantizedUV, blockBlend);
            signal.distortionStrength = strength;
        }
    } else if (config.v1_distortion_type == 5) {
        // === CORTICAL ISOTROPIC (Blauch FOVI) ===
        // Sector geometry drives transition rate; mechanism is type 1's Bender+Cutter.
        // See docs/specs/isotropic_cortical_sampling.md

        if (u_num_cortical_rings > 1.5) {
            float ppd = max(fovea_radius / 1.0, 1.0);
            float r_deg = ecc_deg;  // already computed above

            // Sector extent (same formula as sampleDoGReconstructed)
            float N_rings = u_num_cortical_rings;
            float w_step = u_cortical_max / (N_rings - 1.0);
            float dr_deg = (r_deg + u_cmf_a) * (exp(w_step) - 1.0);
            float sectorPx = dr_deg * ppd;

            // === BENDER: frequency inversely proportional to sector extent ===
            float benderFreq = 150.0 * 7.0 / max(sectorPx, 4.0);

            BenderConfig bc;
            bc.freq = benderFreq;
            bc.octave2_scale = 2.0;
            bc.octave2_weight = 0.5;
            bc.amplitude = 0.0024;
            bc.bias = vec2(2.0, 1.0);  // 2:1 radial bias (Toet & Levi 1992)
            vec2 fractalWarp = applyBender(uv_corrected, bc, strength, u_intensity);

            // === CUTTER: cell size tracks sector extent ===
            // Floor at 8px prevents sub-character displacement at fovea.
            // Cap at 16px prevents visible grid artifacts on uniform backgrounds.
            float cellSizePx = clamp(sectorPx * 0.5, 8.0, 16.0);
            vec2 cellFreq = u_resolution / vec2(cellSizePx);

            // Match type 1's calibrated throw values — the distortion mechanism
            // (Bender+Cutter) is the same, only the cell geometry differs.
            // The isotropic sector grid provides the pooling structure;
            // displacement strength should match the proven shatter calibration.
            float scrambleZone = smoothstep(0.02, 0.15, corticalStrength);
            signal.scrambleZone = scrambleZone;
            float edgeCrowdMult = 1.0 + lgn.edgeDensity * 0.4;

            CutterConfig cc;
            cc.cellFreq = cellFreq;
            cc.baseThrow = vec2(0.008, 0.0016);  // matched to type 1 (shatter)
            cc.progressive = 1.0 + corticalStrength * ecc_max * 0.20;
            cc.onset = scrambleZone;
            vec2 discreteScramble = applyCutter(uv_corrected, cc, u_intensity, edgeCrowdMult);

            signal.displacement = mix(fractalWarp, discreteScramble, scrambleZone);
            signal.distortedUV = uv + signal.displacement;

            if (scrambleZone > 0.5) {
                signal.distortionStrength = 1.0;
            } else {
                signal.distortionStrength = strength;
            }
        }
    }

    return signal;
}

// --- STAGE 3: V4 (Aesthetics) ---
vec3 processV4(vec2 uv, V1_Signal v1, LGN_Signal lgn, ModeConfig config, float dist, float fovea_radius, float parafovea_radius, float saccadeFactor) {
    float eccentricity = max(0.0, dist - fovea_radius);
    
    // Screen-space derivatives of the distorted UV so textureGrad sees the
    // actual Jacobian of the V1 warp.  dFdx/dFdy on the undistorted uv would
    // ignore crowding-induced UV stretching, causing incorrect hardware LOD at
    // the foveal boundary (over-blurs radially, under-blurs tangentially).
    vec2 distDuvdx = dFdx(v1.distortedUV);
    vec2 distDuvdy = dFdy(v1.distortedUV);
    vec3 foveaCol = sampleSourceGrad(v1.distortedUV, distDuvdx, distDuvdy).rgb;
    
    // TIER 1.8: COUPLED POOLING
    float blurMult = 1.0 + (u_blurRadius * 0.3);
    float coupledEccentricity = v1.distortionStrength * u_intensity * fovea_radius * blurMult;

    // Congestion-gated pooling: Bouma-scaled edge density modulates MIP blur.
    // Dense flankers within critical spacing → stronger pooling (information loss).
    // Isolated elements → less blur, preserving identifiability.
    // Rosenholtz et al. (2007, 2012): clutter and crowding share pooling substrate.
    if (u_congestion_pooling > 0.5) {
        float boumaEdge = sampleBoumaEdgeDensity(dist, fovea_radius, uv);
        // Edge density 0.0 → 1.0x MIP (no change)
        // Edge density 1.0 → 2.0x MIP (double pooling)
        float congestionBoost = 1.0 + boumaEdge * 1.0;
        coupledEccentricity *= congestionBoost;
    }

    vec3 pooledCol;

    // Tier 2.5: WebGPU compute metamer — oriented noise matching pooling statistics.
    // Alpha encodes blend weight: 0 at fovea, 1 in far periphery.
    // Falls through to MIP/DoG for uncovered regions (alpha < 1).
    if (u_compute_tier > 2.0) {
        // Map canvas UV to frame UV: the compute texture covers the frame area,
        // which may be smaller than the canvas (e.g. toolbar chrome).
        vec2 computeUV = uv * u_compute_frame_scale;
        vec4 computeSample = texture(u_computeStatTexture, computeUV);
        float computeAlpha = computeSample.a;

        if (computeAlpha > 0.99) {
            // Full metamer coverage — skip MIP fallback
            pooledCol = computeSample.rgb;
        } else {
            // Partial blend — compute MIP fallback for uncovered portion
            vec3 mipFallback;
            if (u_dog_enabled > 0.5) {
                mipFallback = sampleDoGReconstructed(
                    v1.distortedUV, coupledEccentricity, fovea_radius,
                    u_dog_e2, u_dog_sharpness, eccentricity, uv
                ).rgb;
            } else {
                mipFallback = sampleMIPPooled(v1.distortedUV, coupledEccentricity, fovea_radius).rgb;
            }
            pooledCol = mix(mipFallback, computeSample.rgb, computeAlpha);
        }
    } else if (u_gaussian_blur_mode > 0.5) {
        // Eccentricity-scaled Gaussian blur via MIP chain (no band decomposition).
        // Same M-scaling curve as DoG, but uniform frequency degradation.
        pooledCol = sampleMIPPooled(v1.distortedUV, coupledEccentricity, fovea_radius).rgb;
    } else if (u_dog_enabled > 0.5) {
        pooledCol = sampleDoGReconstructed(
            v1.distortedUV, coupledEccentricity, fovea_radius,
            u_dog_e2, u_dog_sharpness, eccentricity,
            uv  // undistorted UV for orientation gradient (not V1-warped)
        ).rgb;
    } else {
        pooledCol = sampleMIPPooledGrad(v1.distortedUV, distDuvdx, distDuvdy, coupledEccentricity, fovea_radius).rgb;
    }

    // Smooth content detection: DoG band decomposition isn't identity on gradients —
    // hardware MIP uses box filtering, and per-band chromatic attenuation introduces
    // small color errors that compound across 12 bands. When pooledCol ≈ foveaCol
    // (smooth content), snap pooledCol to foveaCol so subsequent blend transitions
    // have nothing to amplify into Mach bands. On structured content (text, edges),
    // colorDelta is large and this is a no-op.
    float colorDelta = length(pooledCol - foveaCol);
    float smoothContent = 1.0 - smoothstep(0.01, 0.05, colorDelta);
    pooledCol = mix(pooledCol, foveaCol, smoothContent);

    // Blur blend: pixel-space transition from fovea edge outward.
    // Tight range keeps Mach bands at the fovea boundary where content masks them.
    // (corticalStrength transitions are too wide — visible rings on gradients.)
    float baseBlend = smoothstep(0.0, fovea_radius * 0.5, eccentricity);
    float blendFactor = baseBlend * u_intensity;

    vec3 col = mix(foveaCol, pooledCol, blendFactor);
    
    // === MAGNOCELLULAR PATHWAY: Luminance Contrast Preservation ===
    if (eccentricity > 0.001) {
        vec3 cleanSample = sampleSource(uv).rgb;
        float cleanLuma = dot(cleanSample, vec3(0.299, 0.587, 0.114));
        float distortedLuma = dot(col, vec3(0.299, 0.587, 0.114));
        
        float lumaRatio = cleanLuma / max(distortedLuma, 0.01);
        
        float contrastRamp = smoothstep(0.0, fovea_radius * 0.5, eccentricity);

        // Contrast preservation: 60% inner, 10% far periphery
        float contrastPreservation = mix(0.6, 0.1, smoothstep(0.0, parafovea_radius - fovea_radius, eccentricity));
        
        col *= mix(1.0, lumaRatio, contrastPreservation * contrastRamp);
    }
    
    // === FOVEA PROTECTION ===
    if (dist < fovea_radius * 0.5) {
        return col;
    }

    float effectFactor = v1.distortionStrength;
    // Color effects onset: tight pixel-space transition at fovea edge.
    // Wide corticalStrength transitions create visible Mach bands on gradients.
    float bypassTransition = smoothstep(fovea_radius * 0.5, fovea_radius * 0.7, dist);

    if (config.v4_style_id <= 1) { // Research Modes: 0=Usability, 1=Biological(Purkinje)
    
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
        float caSuppression = 1.0 - v1.scrambleZone;
        caFactor *= caSuppression;
        
        // CA: Simulate lateral chromatic aberration on the PROCESSED output.
        // Previous impl sampled raw source, destroying DoG pipeline results.
        // New approach: shift processed luminance per channel. Since we can't
        // re-read neighboring processed pixels in a single pass, we approximate
        // by shifting the fovea/periphery blend boundary per channel — red sees
        // a slightly closer fovea edge, blue a slightly further one. This creates
        // a color fringe at the fovea boundary without overwriting DoG output.
        if (caFactor > 0.01) {
            float offset = 0.005 * caFactor;
            float eccR = max(0.0, eccentricity - offset * fovea_radius * 4.0);
            float eccB = eccentricity + offset * fovea_radius * 4.0;
            float blendR = smoothstep(0.0, fovea_radius * 0.5, eccR) * u_intensity;
            float blendG = smoothstep(0.0, fovea_radius * 0.5, eccentricity) * u_intensity;
            float blendB = smoothstep(0.0, fovea_radius * 0.5, eccB) * u_intensity;
            col.r = mix(foveaCol.r, pooledCol.r, blendR);
            col.g = mix(foveaCol.g, pooledCol.g, blendG);
            col.b = mix(foveaCol.b, pooledCol.b, blendB);
        }

        // 2. Oklab Conversion
        vec3 lab = rgbToOklab(col);
        
        // 3. Rod Desaturation Factor
        float rampEnd = fovea_radius * config.lgn_ramp_end_mult;
        float desaturationFactor = smoothstep(fovea_radius, rampEnd, dist);
        desaturationFactor *= strengthMult;
        float fade = desaturationFactor * bypassTransition;

        // Apply Base Desaturation (Chrominance only)
        // When per-band chromatic pooling is active (castleCSF + Bowers 2025),
        // sampleDoGReconstructed() already applies differential RG/YV decay.
        // Stacking full base desat on top over-desaturates — periphery goes gray
        // when it should retain blue tint (YV persists biologically).
        // Reduce base desat to 40% strength when per-band is handling the work.
        // Without per-band (legacy path), base desat is the only color reduction.
        float baseFade = fade;
        if (u_chromatic_pooling > 0.5 && u_dog_enabled > 0.5) {
            baseFade *= 0.4;  // per-band does frequency-selective; base adds gentle rod ramp
        }
        lab.y *= (1.0 - baseFade);
        lab.z *= (1.0 - baseFade);
        
        // === DIVERGENCE: USABILITY VS BIOLOGY ===
        
        if (config.v4_style_id == 0) {
            // === MODE 0: USABILITY (High-Key Ghosting) ===
            // Goal: Red buttons turn Grey (structural retention), not Black (invisible).
            
            // Red Kill Switch (Prevent Mustard)
            // Per-band RG decay handles red suppression when chromatic pooling is active.
            // Only apply this blunt kill when falling back to base desaturation.
            if (u_chromatic_pooling < 0.5 || u_dog_enabled < 0.5) {
                float rednessFactor = max(0.0, lab.y);
                if (rednessFactor > 0.0) {
                     float peripheralFade = smoothstep(parafovea_radius, periphery_start + (fovea_radius * 2.0), dist);
                     float desatStrength = peripheralFade * 0.95;
                     lab.y = mix(lab.y, 0.0, desatStrength); // Kill a (Red)
                     lab.z = mix(lab.z, 0.0, desatStrength); // Kill b (Yellow)
                }
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
        
    } else if (config.v4_style_id == 3) { // Blueprint (ARIA Wireframe)
        vec4 structure = texture(u_structureMap, v1.distortedUV);
        float type = structure.b;
        float density = structure.g;
        float roleEncoded = structure.a;
        int roleId = int(roleEncoded * 12.0 + 0.5);

        vec4 salTex = texture(u_saliencyMap, v1.distortedUV);
        float saliency = salTex.r;
        float congestion = (u_hasCongestionMap > 0.5)
            ? texture(u_congestionMap, v1.distortedUV).r
            : salTex.g;

        bool hasStructure = (density > 0.05 || type < 0.95);

        // Edge detection on structure map for bounding box outlines
        vec2 ps = 1.0 / u_resolution;
        float dL = texture(u_structureMap, v1.distortedUV + vec2(-ps.x, 0.0)).g;
        float dR = texture(u_structureMap, v1.distortedUV + vec2( ps.x, 0.0)).g;
        float dT = texture(u_structureMap, v1.distortedUV + vec2(0.0, -ps.y)).g;
        float dB = texture(u_structureMap, v1.distortedUV + vec2(0.0,  ps.y)).g;
        float structEdge = abs(dL - dR) + abs(dT - dB);

        float tL = texture(u_structureMap, v1.distortedUV + vec2(-ps.x, 0.0)).b;
        float tR = texture(u_structureMap, v1.distortedUV + vec2( ps.x, 0.0)).b;
        float tT = texture(u_structureMap, v1.distortedUV + vec2(0.0, -ps.y)).b;
        float tB = texture(u_structureMap, v1.distortedUV + vec2(0.0,  ps.y)).b;
        float typeEdge = abs(tL - tR) + abs(tT - tB);

        float isEdge = smoothstep(0.02, 0.08, max(structEdge, typeEdge));

        // Role-based color palette
        vec3 roleColor;
        if (roleId == 1) roleColor = vec3(0.2, 0.8, 0.4);       // button: green
        else if (roleId == 2) roleColor = vec3(0.3, 0.6, 1.0);   // link: blue
        else if (roleId == 3) roleColor = vec3(1.0, 0.8, 0.2);   // input: yellow
        else if (roleId == 4) roleColor = vec3(1.0, 0.4, 0.4);   // heading: red
        else if (roleId == 5) roleColor = vec3(0.6, 0.4, 1.0);   // nav: purple
        else if (roleId == 6) roleColor = vec3(1.0, 0.6, 0.2);   // media: orange
        else if (roleId == 7) roleColor = vec3(0.4, 0.8, 0.8);   // list: teal
        else if (roleId == 8) roleColor = vec3(0.8, 0.4, 0.8);   // menu: magenta
        else if (roleId == 9) roleColor = vec3(0.9, 0.9, 0.3);   // checkbox: yellow
        else if (roleId == 10) roleColor = vec3(1.0, 0.3, 0.6);  // dialog: pink
        else if (roleId == 11) roleColor = vec3(0.5, 0.7, 1.0);  // header: light blue
        else if (roleId == 12) roleColor = vec3(0.5, 0.6, 0.7);  // footer: gray-blue
        else {
            // Fallback: use type channel for unknown roles
            if (type > 0.8) roleColor = vec3(0.6, 0.8, 1.0);      // text: cyan
            else if (type > 0.3) roleColor = vec3(1.0, 0.6, 0.2); // media: orange
            else roleColor = vec3(0.2, 0.8, 0.4);                  // UI: green
        }

        // Blueprint background: desaturated page content bleeds through for orientation.
        // Congestion controls the tint darkness — high congestion = more opaque blueprint,
        // low congestion = more of the original page visible.
        vec3 pageGhost = col * 0.25 + vec3(0.04, 0.06, 0.12);
        vec3 bgColor = mix(pageGhost, vec3(0.06, 0.09, 0.18), congestion * 0.7);
        vec2 gridUV = v1.distortedUV * u_resolution;
        float gridMajor = step(0.97, max(fract(gridUV.x / 100.0), fract(gridUV.y / 100.0)));
        float gridMinor = step(0.985, max(fract(gridUV.x / 20.0), fract(gridUV.y / 20.0)));
        bgColor += vec3(0.03) * gridMinor + vec3(0.06) * gridMajor;

        // Compose wireframe — congestion drives fill intensity (wider range: 5%–40%)
        vec3 wireframe = bgColor;
        if (hasStructure) {
            wireframe = mix(wireframe, roleColor, 0.05 + congestion * 0.35);
            wireframe += roleColor * saliency * 0.15;
        }
        wireframe = mix(wireframe, roleColor * (0.6 + saliency * 0.4), isEdge);

        // Fine image edges (subtle)
        float imageEdge = sobel(v1.distortedUV);
        float fineEdge = smoothstep(0.05, 0.15, imageEdge);
        wireframe = mix(wireframe, mix(vec3(0.15, 0.25, 0.4), roleColor * 0.5, density), fineEdge * 0.3);

        // Fovea/periphery transition
        float blueprintFade = smoothstep(fovea_radius * 0.3, fovea_radius * 1.2, dist);
        vec3 fovealBlend = col;
        if (hasStructure && blueprintFade < 0.5) {
            fovealBlend = mix(col, roleColor, isEdge * 0.3);
        }
        return mix(fovealBlend, wireframe, blueprintFade);

    } else if (config.v4_style_id == 4) { // Minecraft (Block Pooling)
            // Channel-independent neighbor color averaging in Oklab space.
            // Similar colors merge between blocks while distinct boundaries persist.
            // Blend strengths per channel reflect castleCSF chromatic pooling rates:
            //   L (luminance): moderate — spatial pooling
            //   a (RG): strongest — L-M opponent channel attenuates ~2.5× faster
            //   b (YV): weakest — S-(L+M) persists further into periphery
            // Effect blends in at parafovea edge (matching V1 block onset).
            float blockBlend = smoothstep(parafovea_radius, parafovea_radius * 1.5, dist);

            if (blockBlend < 0.001) {
                return col;
            }

            float mipLevel = computeMipLevel(max(0.0, dist - fovea_radius), fovea_radius);
            float blockPx = exp2(floor(mipLevel) + 2.0); // discrete: matches V1 block sizing
            vec2 pixelSize = vec2(blockPx) / u_resolution;

            // Sample 4 cardinal neighbors at block-center offsets
            vec3 labCenter = rgbToOklab(col);
            vec3 labN = rgbToOklab(sampleSourceGrad(v1.distortedUV + vec2(0.0, pixelSize.y), distDuvdx, distDuvdy).rgb);
            vec3 labS = rgbToOklab(sampleSourceGrad(v1.distortedUV - vec2(0.0, pixelSize.y), distDuvdx, distDuvdy).rgb);
            vec3 labE = rgbToOklab(sampleSourceGrad(v1.distortedUV + vec2(pixelSize.x, 0.0), distDuvdx, distDuvdy).rgb);
            vec3 labW = rgbToOklab(sampleSourceGrad(v1.distortedUV - vec2(pixelSize.x, 0.0), distDuvdx, distDuvdy).rgb);
            vec3 neighborAvg = (labN + labS + labE + labW) * 0.25;

            // Per-channel blend: 0 at parafovea → max at far periphery
            float t = clamp(mipLevel / 4.0, 0.0, 1.0);
            float blendL  = t * 0.4;  // luminance: moderate spatial pooling
            float blendA  = t * 0.6;  // RG: strongest — foveal specialization collapses
            float blendB  = t * 0.25; // YV: weakest — persists into periphery

            vec3 blended;
            blended.x = mix(labCenter.x, neighborAvg.x, blendL);
            blended.y = mix(labCenter.y, neighborAvg.y, blendA);
            blended.z = mix(labCenter.z, neighborAvg.z, blendB);

            // Per-channel chromatic decay directly in Oklab — a and b channels
            // ARE the L-M and S-(L+M) opponent axes. No RGB decomposition needed.
            // Suprathreshold ramps (Shooner, Jiang & Mullen 2022; Hansen et al. 2009):
            //   RG (a): foveal specialization, steep early onset, caps at 70%
            //   YV (b): NOT foveal-specific, slow onset, caps at 35%
            // Per-channel caps make the differential visible: red-green boundaries
            // dissolve while blue-yellow persists at the same eccentricity.
            float normEcc = max(0.0, dist - fovea_radius) / max(fovea_radius, 0.001);
            float ecc_deg = normEcc * 2.0;
            float rgFade = smoothstep(1.0, 12.0, ecc_deg) * 0.7;  // a: 70% max
            float yvFade = smoothstep(3.0, 20.0, ecc_deg) * 0.35; // b: 35% max
            blended.y *= (1.0 - rgFade); // a channel (red-green) fades first
            blended.z *= (1.0 - yvFade); // b channel (blue-yellow) persists

            vec3 result = oklabToRgb(blended);

            // Subtle grid line darkening (6%) for block visibility
            vec2 blockFrac = fract(uv / pixelSize);
            float edgeDist = min(min(blockFrac.x, 1.0 - blockFrac.x), min(blockFrac.y, 1.0 - blockFrac.y));
            float gridLine = 1.0 - 0.06 * (1.0 - smoothstep(0.0, 0.08, edgeDist));
            result *= gridLine;

            return mix(col, result, blockBlend * effectFactor * bypassTransition);
            
    } else if (config.v4_style_id == 5) { // Double Vision
        float luma = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 saturated = mix(vec3(luma), col, 1.6);
        vec2 warpUV = v1.distortedUV * 2.0;
        float n = snoise(warpUV + vec2(u_time * 0.1));
        float subtleNoise = n * 0.05 * effectFactor;
        vec3 finalColor = clamp(saturated + subtleNoise, 0.0, 1.0);
        return mix(col, finalColor, effectFactor * bypassTransition);

    } else if (config.v4_style_id == 7) { // Pooling Grid — educational polar overlay
        // Compute own eccentricity ramp (not dependent on V1 distortion strength)
        float gridFade = smoothstep(fovea_radius, fovea_radius * 2.0, dist) * bypassTransition;

        // Mild desaturation so content stays readable
        float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(col, vec3(lum), gridFade * 0.4);

        // Polar grid: concentric rings (log-spaced) + radial spokes
        // Fade in from parafovea edge outward
        float gridOnset = smoothstep(fovea_radius, parafovea_radius, dist);

        if (gridOnset > 0.001) {
            float aspect = u_resolution.x / u_resolution.y;
            vec2 uv_c = vec2(uv.x * aspect, uv.y);
            vec2 mouse_uv = u_mouse_stable / u_resolution;
            vec2 mouse_c = vec2(mouse_uv.x * aspect, mouse_uv.y);
            vec2 diff = uv_c - mouse_c;
            float angle = atan(diff.y, diff.x);

            // Log-spaced rings starting at parafovea — matches CMF scaling
            float r0 = parafovea_radius;
            float expansionFactor = 1.3;
            float n = log(dist / r0) / log(expansionFactor);
            float n_idx = round(n);
            float dist_to_ring = abs(n - n_idx);

            float ringWidth = 0.015;
            float ringAlpha = 1.0 - smoothstep(0.0, ringWidth, dist_to_ring);

            // Radial spokes — more spokes near fovea (16), thinning out
            // Spoke count decreases with eccentricity: pooling regions are wider tangentially at distance
            float spokeCount = mix(16.0, 8.0, smoothstep(parafovea_radius, parafovea_radius * 4.0, dist));
            float spokeWidth = smoothstep(0.99, 0.995, cos(angle * spokeCount));

            // Parafovea ring boundary (solid)
            float paraRingDist = abs(dist - parafovea_radius);
            float fw = fwidth(paraRingDist);
            float paraRing = 1.0 - smoothstep(0.0, fw * 2.5, paraRingDist);

            float gridAlpha = max(max(ringAlpha, spokeWidth), paraRing);

            // Grid color: cyan, subtle — page content shows through
            vec3 gridColor = vec3(0.0, 0.75, 0.9);
            float opacity = gridOnset * 0.25;
            col = mix(col, gridColor, gridAlpha * opacity);
            col += gridColor * gridAlpha * opacity * 0.15; // Slight additive glow
        }

        return col;

    } else if (config.v4_style_id == 8) { // Minecraft Eyeball (Polar Pooling)
        // Radial variant of Minecraft: wedge-shaped polar sectors sized by CMF,
        // emanating from gaze. Same Oklab chromatic decay as Minecraft (style 4).
        float blockBlend = smoothstep(parafovea_radius, parafovea_radius * 1.5, dist);
        if (blockBlend < 0.001) return col;

        PolarSector ps = computePolarSector(uv, parafovea_radius);
        float aspect = u_resolution.x / u_resolution.y;

        // --- RADIAL/TANGENTIAL NEIGHBOR SAMPLING ---
        // 2 radial (inner/outer ring centers) + 2 tangential (adjacent spokes)
        float ef = 1.007;
        float bias = u_crowding_radial_bias;
        float ring_inner_prev = ps.ring_inner / pow(ef, bias);
        float ring_center_inner = (ring_inner_prev + ps.ring_inner) * 0.5;
        float ring_outer_next = ps.ring_outer * pow(ef, bias);
        float ring_center_outer = (ps.ring_outer + ring_outer_next) * 0.5;

        float spoke_left  = ps.spoke_center - ps.spokeWidth;
        float spoke_right = ps.spoke_center + ps.spokeWidth;

        // Convert neighbor polar coords to UV.
        // Sector offsets are in the scaled space (fovea_aspect_ratio-divided x),
        // so we undo that scaling before converting back to UV.
        vec2 offRI = ring_center_inner * vec2(cos(ps.spoke_center), sin(ps.spoke_center));
        offRI.x *= u_fovea_aspect_ratio;
        vec2 uvRI = vec2((ps.mouse_c + offRI).x / aspect, (ps.mouse_c + offRI).y);

        vec2 offRO = ring_center_outer * vec2(cos(ps.spoke_center), sin(ps.spoke_center));
        offRO.x *= u_fovea_aspect_ratio;
        vec2 uvRO = vec2((ps.mouse_c + offRO).x / aspect, (ps.mouse_c + offRO).y);

        vec2 offTL = ps.ring_center * vec2(cos(spoke_left), sin(spoke_left));
        offTL.x *= u_fovea_aspect_ratio;
        vec2 uvTL = vec2((ps.mouse_c + offTL).x / aspect, (ps.mouse_c + offTL).y);

        vec2 offTR = ps.ring_center * vec2(cos(spoke_right), sin(spoke_right));
        offTR.x *= u_fovea_aspect_ratio;
        vec2 uvTR = vec2((ps.mouse_c + offTR).x / aspect, (ps.mouse_c + offTR).y);

        // Multi-sample radial grid: 3 samples across the ring's radial extent
        // (inner third, center, outer third), each at MIP matching 1/3 of the
        // ring width. Thin horizontal features (toolbars, logos) that occupy
        // only part of the ring can't be missed — at least one sample hits them.
        float ringWidthUV = ps.ring_outer - ps.ring_inner;
        float ringWidthPx = ringWidthUV * u_resolution.y;
        float maxMip = floor(log2(max(u_resolution.x, u_resolution.y)));
        float subMip = clamp(log2(max(ringWidthPx / 3.0, 1.0)), 0.0, maxMip);

        // 3 radial positions: centers of inner, middle, outer thirds
        float rInner = ps.ring_inner + ringWidthUV * (1.0 / 6.0);
        float rOuter = ps.ring_outer - ringWidthUV * (1.0 / 6.0);

        // Convert inner/outer radial positions to UV (same polar→UV pattern)
        vec2 offInner = rInner * vec2(cos(ps.spoke_center), sin(ps.spoke_center));
        offInner.x *= u_fovea_aspect_ratio;
        vec2 uvInner = vec2((ps.mouse_c + offInner).x / aspect, (ps.mouse_c + offInner).y);

        vec2 offOuter = rOuter * vec2(cos(ps.spoke_center), sin(ps.spoke_center));
        offOuter.x *= u_fovea_aspect_ratio;
        vec2 uvOuter = vec2((ps.mouse_c + offOuter).x / aspect, (ps.mouse_c + offOuter).y);

        // Average 3 radial sub-samples for center color
        vec3 labCenter = (rgbToOklab(sampleSourceLod(uvInner, subMip).rgb)
                        + rgbToOklab(sampleSourceLod(v1.distortedUV, subMip).rgb)
                        + rgbToOklab(sampleSourceLod(uvOuter, subMip).rgb)) / 3.0;

        // Neighbors: single sample at sector-wide MIP (they're for blending, not display)
        float sectorMip = clamp(log2(max(ringWidthPx, 1.0)), 0.0, maxMip);
        vec3 neighborAvg = (rgbToOklab(sampleSourceLod(uvRI, sectorMip).rgb)
                          + rgbToOklab(sampleSourceLod(uvRO, sectorMip).rgb)
                          + rgbToOklab(sampleSourceLod(uvTL, sectorMip).rgb)
                          + rgbToOklab(sampleSourceLod(uvTR, sectorMip).rgb)) * 0.25;

        // Per-channel blend (same rates as Minecraft style 4)
        float mipLevel = computeMipLevel(max(0.0, dist - fovea_radius), fovea_radius);
        float t = clamp(mipLevel / 4.0, 0.0, 1.0);
        vec3 blended;
        blended.x = mix(labCenter.x, neighborAvg.x, t * 0.4);   // L
        blended.y = mix(labCenter.y, neighborAvg.y, t * 0.6);   // a (RG)
        blended.z = mix(labCenter.z, neighborAvg.z, t * 0.25);  // b (YV)

        // Per-channel chromatic decay.
        // The smoothstep ranges (1→28°, 5→45°) from Minecraft style 4 were designed
        // for wide visual fields but barely engage on a desktop screen (~15° max ecc).
        // Tighten to match the actual ecc_deg range so desaturation is visible.
        float normEcc = max(0.0, dist - fovea_radius) / max(fovea_radius, 0.001);
        float ecc_deg = normEcc * 2.0;
        blended.y *= (1.0 - smoothstep(1.0, 12.0, ecc_deg) * 0.7);
        blended.z *= (1.0 - smoothstep(3.0, 20.0, ecc_deg) * 0.35);

        vec3 result = oklabToRgb(blended);

        // --- RING/SPOKE GRID LINES (6% darkening, same weight as Minecraft) ---
        float ringWidth = ps.ring_outer - ps.ring_inner;
        float ringEdgeDist = min(abs(ps.r - ps.ring_inner), abs(ps.r - ps.ring_outer));
        float ringEdge = 1.0 - 0.06 * (1.0 - smoothstep(0.0, ringWidth * 0.08, ringEdgeDist));

        float angle_in_spoke = mod(ps.angle + 3.14159265359, ps.spokeWidth);
        float spokeDist = min(angle_in_spoke, ps.spokeWidth - angle_in_spoke);
        float spokeEdge = 1.0 - 0.06 * (1.0 - smoothstep(0.0, ps.spokeWidth * 0.08, spokeDist));

        result *= min(ringEdge, spokeEdge);

        return mix(col, result, blockBlend * effectFactor * bypassTransition);

    } else if (config.v4_style_id == 6) { // FOVI: Gaussian color decay (rod-cone transition)
        if (u_cmf_color_sigma > 0.01) {
            float fovea_deg = 1.0;  // 1° foveal radius (2° diameter)
            float normEcc = max(0.0, eccentricity) / max(fovea_radius, 0.001);
            float r_deg = normEcc * fovea_deg;
            float decay = exp(-r_deg / max(u_cmf_color_sigma, 0.1));
            float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
            col = mix(vec3(lum), col, decay);
        }
        return col;
    }

    return col;
}

// === SALIENCY HEATMAP (for side-by-side comparison) ===
// Dark indigo (low) → Purple/Magenta (mid) → White (high)
// Cool palette contrasts with congestion's warm blue→yellow→red
vec3 saliencyHeatmap(float t) {
    t = clamp(t, 0.0, 1.0);
    if (t < 0.5) {
        float s = t * 2.0;
        return mix(vec3(0.05, 0.0, 0.15), vec3(0.7, 0.0, 0.7), s);
    } else {
        float s = (t - 0.5) * 2.0;
        return mix(vec3(0.7, 0.0, 0.7), vec3(1.0, 1.0, 1.0), s);
    }
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

    float radius_norm_pre = u_foveaRadius / u_resolution.y;

    // === READING SPAN: Asymmetric foveal envelope during reading ===
    // Rayner (1998): Perceptual span ~1.3° left, ~5° right (LTR).
    // Attentional, not acuity — reshape protection zone, not falloff.
    if (u_reading_span > 0.5) {
        float hSpeed = abs(u_velocity_dir.x);
        float vSpeed = abs(u_velocity_dir.y);

        // Gate: predominantly horizontal, pursuit speed (not saccade, not jitter)
        float horizontality = hSpeed / max(hSpeed + vSpeed, 0.001);
        float speedGate = smoothstep(0.05, 0.3, hSpeed) * (1.0 - smoothstep(2.5, 4.0, hSpeed));
        float readingGate = horizontality * speedGate;

        // Gate: text content under cursor (structure map B channel)
        vec2 cursorUV = u_mouse / u_resolution;
        float textGate = smoothstep(0.3, 0.6, textureLod(u_structureMap, cursorUV, 2.0).b);

        // Combined activation
        float readingActivation = readingGate * textGate * u_reading_span_strength;

        // Shift fovea center in reading direction
        float readDir = sign(u_velocity_dir.x); // +1 LTR, -1 RTL
        float shiftAmount = radius_norm_pre * 0.7 * readingActivation * readDir;
        delta.x += shiftAmount / u_fovea_aspect_ratio;
        dist = length(delta);

        // Apply same shift to stable delta for consistent V1 boundaries
        delta_stable.x += shiftAmount / u_fovea_aspect_ratio;
        dist_stable = length(delta_stable);
    }


    float radius_norm = u_foveaRadius / u_resolution.y;
    float fovea_radius = radius_norm;
    float parafovea_radius = radius_norm * 2.5;

    // Saccadic blindness: shrink foveal region during movement
    float saccadeFactor = smoothstep(4.0, 10.0, u_velocity);
    if (u_saccadic_blindness > 0.5) {
        fovea_radius *= (1.0 - saccadeFactor);
        parafovea_radius *= (1.0 - saccadeFactor);
    }

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
    config.cmf_enabled = u_cmf_enabled > 0.5;

    if (config.v4_style_id == 5) {
        config.lgn_use_structure_mask = false;
        config.lgn_use_saliency_gate = false;
    }
    
    if (config.v4_style_id != 5 && config.v1_distortion_type != 2 && config.v1_distortion_type != 3 && config.v1_distortion_type != 4 && config.v1_distortion_type != 5) {
        if (u_mongrel_mode < 0.5) {
            config.v1_distortion_type = 0; 
        }
        else config.v1_distortion_type = 1; 
    }
    
    if (config.v4_style_id == 3) {
        config.v1_distortion_type = 2; // No distortion for Blueprint
    }

    float memoryStrength = 0.0;
    if (u_useMask > 0.5) {
        float rawMask = texture(u_maskTexture, v_texCoord).r;
        memoryStrength = smoothstep(0.0, 0.5, rawMask);
    }

    LGN_Signal lgn = processLGN(uv, config, dist, fovea_radius);

    // Safe radial direction — fallback at fovea center (displacement is zero there anyway)
    vec2 radial_dir = dist_stable > 0.001 ? delta_stable / dist_stable : vec2(0.0, 1.0);

    V1_Signal v1 = processV1(uv, uv_corrected, lgn, config, dist_stable, radial_dir, fovea_radius, parafovea_radius, isFarPeriphery, isParafovea, memoryStrength);
    
    vec3 finalRGB = processV4(uv, v1, lgn, config, dist, fovea_radius, parafovea_radius, saccadeFactor);
    
    vec4 color = vec4(finalRGB, 1.0);

    float scrollbarWidth = 17.0;
    float distFromRightEdge = u_resolution.x - (uv.x * u_resolution.x);
    bool isScrollbar = distFromRightEdge < scrollbarWidth;

    // Scrollbar protection: bypass entire pipeline output.
    // V1 displacement + V4 color effects would scramble the scrollbar
    // since it's always in the far periphery.
    if (isScrollbar) {
        fragColor = sampleSource(uv);
        return;
    }

    if (u_useMask < 1.5 && u_useMask > 0.5 && u_debug_structure < 0.5) {
        if (memoryStrength > 0.9) {
            vec4 clearColor = sampleSource(uv);
            color.rgb = clearColor.rgb;
        } else if (memoryStrength > 0.0) {
            vec4 clearColor = sampleSource(uv);
            color.rgb = mix(color.rgb, clearColor.rgb, memoryStrength);
        }
    }
    
    float debugLevel = u_debug_structure;
    if (config.v4_style_id == 4) debugLevel = 0.0;
    
    if (debugLevel > 0.5) {
        color = sampleSource(uv);
    }
    
    if (debugLevel > 4.5) {
        // Debug 5: Oriented DoG band weight overlay
        // Brighter = more bands preserved. Green tint = orientation bonus active.
        float dist_dbg = length(uv_corrected - mouse_corrected);
        float ecc_dbg = max(0.0, dist_dbg - fovea_radius);
        float normEcc_dbg = ecc_dbg / max(fovea_radius, 0.001);
        float e2_dbg = max(u_dog_e2, 0.01);
        // Recompute band weights at this eccentricity (simplified — isotropic baseline)
        float bandCount = 0.0;
        for (int k = 0; k < 8; k++) {
            float c_dbg = e2_dbg * float[8](0.41421, 1.0, 1.82843, 3.0, 4.65685, 7.0, 10.31371, 15.0)[k];
            float tm = 0.4;
            bandCount += 1.0 - smoothstep(c_dbg - c_dbg * tm, c_dbg + c_dbg * tm, normEcc_dbg);
        }
        // 4-channel orientation energy (same computation as in sampleDoGReconstructed)
        vec2 px_dbg = 2.0 / u_resolution;
        vec3 lumaW_dbg = vec3(0.114, 0.587, 0.299); // BGRA-corrected luminance weights
        float lr = dot(textureLod(u_texture, uv + vec2(px_dbg.x, 0.0), 1.0).rgb, lumaW_dbg);
        float ll = dot(textureLod(u_texture, uv - vec2(px_dbg.x, 0.0), 1.0).rgb, lumaW_dbg);
        float lt = dot(textureLod(u_texture, uv + vec2(0.0, px_dbg.y), 1.0).rgb, lumaW_dbg);
        float lb = dot(textureLod(u_texture, uv - vec2(0.0, px_dbg.y), 1.0).rgb, lumaW_dbg);
        float gx_d = lr - ll; float gy_d = lt - lb;
        float g2_d = gx_d*gx_d + gy_d*gy_d;
        float e_h = gy_d*gy_d; float e_v = gx_d*gx_d;
        float gd1_d = (gx_d+gy_d)*0.7071; float gd2_d = (gx_d-gy_d)*0.7071;
        float cardMax_d = max(e_h, e_v);
        float oblMax_d = max(gd1_d*gd1_d, gd2_d*gd2_d);
        float cardFrac = cardMax_d / (cardMax_d + oblMax_d + 1e-6);
        float eg = smoothstep(0.005, 0.03, sqrt(g2_d));
        float ob = cardFrac * eg * u_dog_orient_bias;
        float base = bandCount / 8.0;
        vec3 diagColor = vec3(base, base + ob * 0.3, base);
        // Blend to source inside fovea — all-white there is uninformative
        float foveaBlend = smoothstep(0.0, fovea_radius * 0.3, ecc_dbg);
        color.rgb = mix(sampleSource(uv).rgb, diagColor, foveaBlend);
    } else if (debugLevel > 3.5) {
        // Debug 4: 4-channel orientation energy overlay
        // R = horizontal edges, G = vertical edges, B = diagonal (45°+135°)
        vec2 px_dbg4 = 2.0 / u_resolution;
        vec3 lumaW4 = vec3(0.114, 0.587, 0.299);
        float lr4 = dot(textureLod(u_texture, uv + vec2(px_dbg4.x, 0.0), 1.0).rgb, lumaW4);
        float ll4 = dot(textureLod(u_texture, uv - vec2(px_dbg4.x, 0.0), 1.0).rgb, lumaW4);
        float lt4 = dot(textureLod(u_texture, uv + vec2(0.0, px_dbg4.y), 1.0).rgb, lumaW4);
        float lb4 = dot(textureLod(u_texture, uv - vec2(0.0, px_dbg4.y), 1.0).rgb, lumaW4);
        float gx4 = lr4 - ll4; float gy4 = lt4 - lb4;
        float mag4 = sqrt(gx4*gx4 + gy4*gy4);
        // 4-channel energy
        float eH = gy4*gy4;  // horizontal edges
        float eV = gx4*gx4;  // vertical edges
        float gd1_4 = (gx4+gy4)*0.7071; float gd2_4 = (gx4-gy4)*0.7071;
        float eD = gd1_4*gd1_4 + gd2_4*gd2_4;  // diagonal edges (both)
        float eTotal = eH + eV + eD + 1e-6;
        float gate4 = smoothstep(0.005, 0.03, mag4);
        color.rgb = vec3(
            (eH / eTotal) * gate4,   // R: horizontal edges (text baselines)
            (eV / eTotal) * gate4,   // G: vertical edges (column borders)
            (eD / eTotal) * gate4    // B: diagonal edges (no bonus)
        );
    } else if (debugLevel > 2.5) {
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
    if (u_show_congestion == 1) {
        // Full-screen congestion heatmap overlay
        float congestion = 0.0;
        if (u_hasCongestionMap > 0.5) {
            congestion = texture(u_congestionMap, v_texCoord).r;
        } else {
            congestion = texture(u_saliencyMap, v_texCoord).g;
        }
        vec3 heatmapColor = congestionHeatmap(congestion);
        vec3 src = sampleSource(uv).rgb;
        color.rgb = mix(src, heatmapColor, 0.85);
    } else if (u_show_congestion == 2) {
        // Side-by-side: Saliency (left) vs Congestion (right)
        // Saliency = "what pops out?" (center-surround contrast)
        // Congestion = "how cluttered?" (local feature variance)
        vec3 src = sampleSource(uv).rgb;
        float midpoint = 0.5;
        float dividerWidth = 1.5 / u_resolution.x; // ~2px white line

        if (abs(v_texCoord.x - midpoint) < dividerWidth) {
            // Center divider
            color.rgb = vec3(1.0);
        } else if (v_texCoord.x < midpoint) {
            // Left half: saliency (cool purple palette)
            float sal = texture(u_saliencyMap, v_texCoord).r;
            color.rgb = mix(src, saliencyHeatmap(sal), 0.85);
        } else {
            // Right half: congestion (warm blue→yellow→red palette)
            float cong = 0.0;
            if (u_hasCongestionMap > 0.5) {
                cong = texture(u_congestionMap, v_texCoord).r;
            } else {
                cong = texture(u_saliencyMap, v_texCoord).g;
            }
            color.rgb = mix(src, congestionHeatmap(cong), 0.85);
        }
    }

    fragColor = color;
}