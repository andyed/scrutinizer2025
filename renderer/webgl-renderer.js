/**
 * WebGL Renderer for Scrutinizer
 * Implements GPU-accelerated foveal rendering with "Mongrel" receptive field simulation.
 */

(() => {
    try {
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('log:renderer', '[WebGLRenderer] Script execution started');

        const Logger = require('./logger');

        class WebGLRenderer {
            constructor(canvas) {
                this.canvas = canvas;
                const contextAttributes = {
                    alpha: true, // Required for transparent window composition
                    antialias: false,
                    preserveDrawingBuffer: false
                };

                // Require WebGL 2 for derivative functions (fwidth, dFdx, dFdy)
                this.gl = canvas.getContext('webgl2', contextAttributes);

                if (!this.gl) {
                    Logger.error('[WebGL] WebGL 2 is required but not supported by this browser. Please use Chrome 56+, Firefox 51+, or Safari 15+.');
                    throw new Error('WebGL 2 not supported');
                }

                const { ipcRenderer } = require('electron');
                ipcRenderer.send('log:renderer', `[WebGLRenderer] WebGL context created: ${this.gl.constructor.name}`);

                this.program = null;
                this.texture = null;
                this.maskTexture = null;
                this.positionBuffer = null;
                this.texCoordBuffer = null;

                // Uniform locations
                this.resolutionLocation = null;
                this.mouseLocation = null;
                this.mouseStableLocation = null;
                this.foveaRadiusLocation = null; // Renamed to match shader concept (foveaRadius)
                this.pixelationLocation = null;
                this.intensityLocation = null;
                this.caStrengthLocation = null;
                this.debugBoundaryLocation = null;
                this.textureLocation = null;
                this.maskTextureLocation = null;
                this.useMaskLocation = null;
                this.velocityLocation = null;
                this.mongrelModeLocation = null;
                this.mongrelModeLocation = null;
                // this.aestheticModeLocation = null; // Removed in favor of granular uniforms

                // Granular Uniform Locations
                this.lgnUseStructureMaskLocation = null;
                this.lgnUseSaliencyGateLocation = null;
                this.v1DistortionTypeLocation = null;
                this.v1StrengthMultLocation = null;
                this.v4StyleIdLocation = null;
                this.lgnRampEndMultLocation = null;
                this.v1AnimateLocation = null;

                // Default Configuration
                this.config = {
                    lgn_use_structure_mask: true,
                    lgn_use_saliency_gate: true,
                    v1_distortion_type: 1, // Shatter
                    v1_strength_mult: 1.0,
                    v4_style_id: 0, // High-Key
                    lgn_ramp_end_mult: 3.0,
                    v1_animate: false
                };

                this.init();
                this.warmup();
            }

            warmup() {
                // Run async to avoid blocking main thread on startup
                setTimeout(() => {
                    // Save original canvas size
                    const originalWidth = this.canvas.width;
                    const originalHeight = this.canvas.height;

                    const dummyData = new Uint8Array(4 * 4 * 4);
                    dummyData.fill(128);
                    const dummyImage = new ImageData(new Uint8ClampedArray(dummyData), 4, 4);
                    this.uploadTexture(dummyImage);

                    // Render a single frame to force shader compilation
                    this.render(100, 100, 50, 50, 30);

                    // Restore original canvas size
                    if (originalWidth > 0 && originalHeight > 0) {
                        this.canvas.width = originalWidth;
                        this.canvas.height = originalHeight;
                    }

                    console.log('[WebGL] Shader warmup complete (Async)');
                }, 100);
            }

            init() {
                const gl = this.gl;

                const vsSource = `#version 300 es
                in vec2 a_position;
                in vec2 a_texCoord;
                out vec2 v_texCoord;
                void main() {
                    gl_Position = vec4(a_position, 0.0, 1.0);
                    v_texCoord = a_texCoord;
                }
            `;

                const fsSource = `#version 300 es
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
                    if (strength <= 0.01) return texture(tex, uv);
    
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
                    
                    vec4 clean = texture(tex, shatteredUV);
                    vec4 ghost = texture(tex, shatteredUV + vec2(0.01 * strength, 0.0));
                    
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
                V1_Signal processV1(vec2 uv, vec2 uv_corrected, LGN_Signal lgn, ModeConfig config, float dist, float fovea_radius, float parafovea_radius, bool isFarPeriphery, bool isParafovea) {
                    V1_Signal signal;
                    signal.distortedUV = uv;
                    signal.distortionStrength = 0.0;
                    signal.displacement = vec2(0.0);
                    
                    float strength = lgn.suppressionFactor * config.v1_strength_mult;
                    signal.distortionStrength = strength;
                    
                    if (config.v1_distortion_type == 2) {
                        // None (but strength is passed to V4)
                        return signal;
                    }
                    
                    if (config.v1_distortion_type == 1) {
                        // === SHATTER (Mongrel) ===
                        // Sample using smooth strength
                        // Pass rhythm (structure.r) to modulate frequency
                        vec4 rawColor = sampleMongrel(u_texture, uv, strength, u_intensity, lgn.rhythm);
                        
                        // Mongrel sampler returns a color, not UVs directly easily.
                        // For the pipeline, we need to adapt. 
                        // The original code mixed colors. Here we might need to cheat a bit or refactor sampleMongrel.
                        // To keep it clean, let's assume sampleMongrel does the heavy lifting and we just pass the result
                        // via a "virtual" UV or just handle it in V4. 
                        // ACTUALLY: The original code returned a color. 
                        // Let's stick to the pattern: V1 calculates UVs.
                        // But Mongrel is a multi-sample effect. 
                        // Compromise: V1 calculates the *primary* distorted UV.
                        
                        // Re-implementing simplified Mongrel displacement for UV pipeline
                        float jitterScale = 0.04 * strength * u_intensity;
                        float densityX = mix(120.0, 40.0, lgn.rhythm);
                        float densityY = mix(120.0, 10.0, lgn.rhythm);
                        float xID = floor(uv.x * densityX);
                        float yID = floor(uv.y * densityY);
                        float offX = (hash22(vec2(yID, xID)).x - 0.5) * jitterScale;
                        float offY = (hash22(vec2(xID, yID + 13.0)).x - 0.5) * jitterScale;
                        
                        signal.displacement = vec2(offX, offY);
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
                        vec2 warpVector = vec2(n1, n2) * warpAmp * strength * u_intensity;
                        
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
                vec3 processV4(vec2 uv, V1_Signal v1, LGN_Signal lgn, ModeConfig config, float dist, float saccadeFactor) {
                    vec3 col = texture(u_texture, v1.distortedUV).rgb;
                    
                    // Fix BGRA input (Electron capture is BGRA)
                    // Always swap R and B to get correct RGBA.
                    // Previously only applied to Shatter, but Cyberpunk (and others) need it too.
                    vec3 temp = col;
                    col.r = temp.b;
                    col.b = temp.r;
                    
                    float effectFactor = v1.distortionStrength; // Use the actual applied strength
                    
                    if (config.v4_style_id == 0) { // High-Key
                        float luma = dot(col, vec3(0.299, 0.587, 0.114));
                        vec3 gray = vec3(luma);
                        vec3 targetWhite = vec3(0.8, 0.85, 0.9);
                        
                        // Luma Mask: Only apply "Ghosting" to lighter tones.
                        // Deep blacks (luma < 0.2) should remain black.
                        float lumaMask = smoothstep(0.1, 0.4, luma);
                        
                        vec3 ghostColor = mix(gray, targetWhite, 0.4); 
                        float noise = (rand(uv) - 0.5) * 0.05;
                        ghostColor += noise;
                        ghostColor = mix(ghostColor, vec3(0.95, 0.98, 1.0), saccadeFactor * 0.5);
                        
                        // Apply effect based on Luma Mask
                        vec3 finalColor = mix(col, ghostColor, effectFactor * 0.95 * lumaMask);
                        return finalColor;
                        
                    } else if (config.v4_style_id == 1) { // Lab
                        float luma = dot(col, vec3(0.0, 0.6, 0.4)); 
                        vec3 rodColor = mix(vec3(0.02, 0.05, 0.1), vec3(0.6, 0.7, 0.8), luma) * 0.96;
                        rodColor += (rand(uv) - 0.5) * 0.1;
                        rodColor = mix(rodColor, vec3(0.01), saccadeFactor * 0.9);
                        return mix(col, rodColor, effectFactor);
                        
                    } else if (config.v4_style_id == 2) { // Frosted
                        vec3 frosted = mix(col, vec3(0.9, 0.92, 0.95), 0.6);
                        frosted = mix(frosted, vec3(1.0), saccadeFactor * 0.8);
                        return mix(col, frosted, effectFactor);
                        
                    } else if (config.v4_style_id == 3) { // Blueprint
                        vec3 bg = vec3(0.05, 0.1, 0.2);
                        vec3 fg = vec3(0.4, 0.8, 1.0);
                        vec2 gridUV = fract(uv * 40.0);
                        float gridLine = step(0.95, gridUV.x) + step(0.95, gridUV.y);
                        vec3 finalColor = mix(bg, bg * 1.5, gridLine * 0.3);
                        
                        if (lgn.rhythm > 0.0) {
                            float scanline = sin(uv.y * 800.0 * lgn.rhythm) * 0.5 + 0.5;
                            float brightness = lgn.density * 0.8 + 0.2;
                            vec3 typeColor = fg;
                            if (lgn.type < 0.2) typeColor = vec3(1.0, 0.5, 0.0);
                            if (lgn.type > 0.4 && lgn.type < 0.6) typeColor = vec3(0.0, 1.0, 0.5);
                            finalColor = mix(finalColor, typeColor * brightness, 0.8 * scanline);
                        }
                        return mix(col, finalColor, effectFactor);
                        
                    } else if (config.v4_style_id == 4) { // Cyberpunk
                         // Pixelation is handled in V1.
                         // Style: Saturated, No Tint, No Scanlines (Clean Digital Look).
                         // User requested "pixelation instead" of "outline text".
                         // Removing contrast boost and scanlines to avoid "etched" text artifacts.
                         
                         // HARD BYPASS
                         if (dist < 0.25) { 
                             return col;
                         }
                         
                         // Clean up Fovea
                         float cleanFactor = smoothstep(0.4, 0.8, effectFactor);
                         
                         // 1. Saturation Boost ONLY
                         // We skip contrast boost because it creates "outlines" on text.
                         float luma = dot(col, vec3(0.299, 0.587, 0.114));
                         vec3 saturated = mix(vec3(luma), col, 1.5); // Boost saturation of original color
                         
                         // Clamp results
                         vec3 finalColor = clamp(saturated, 0.0, 1.0);
                         
                         return mix(col, finalColor, cleanFactor);
                         
                    } else if (config.v4_style_id == 5) { // Trippy (Fractal/Ooze)
                        // Domain Warping for "Oil Slick" / Fractal look
                        
                        // Use distorted UVs for the base color, but also use them for the noise lookup
                        vec2 warpUV = v1.distortedUV * 2.0; // Scale up for detail
                        
                        // FBM-like layers
                        float n = snoise(warpUV + vec2(u_time * 0.1));
                        float n2 = snoise(warpUV * 2.0 - vec2(u_time * 0.15));
                        
                        // Combine noise to create a "fractal" value
                        float fractal = (n + n2 * 0.5) * 0.5 + 0.5; // 0..1
                        
                        // Color Shift: Iridescent / Oil Slick
                        // Shift hue based on fractal value + distance
                        vec3 shift = vec3(fractal, fractal + 0.33, fractal + 0.66);
                        
                        // Soft mixing with original color
                        // Instead of replacing, we tint/overlay
                        vec3 oilColor = col * (0.5 + 0.5 * sin(shift * 6.28 + u_time));
                        
                        // Boost saturation of the result
                        vec3 finalColor = mix(col, oilColor, 0.6); // 60% oil mix
                        
                        return mix(col, finalColor, effectFactor);
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
                    float parafovea_radius = radius_norm * 1.35;
                    float periphery_start = radius_norm * 1.2;
                    
                    bool isParafovea = dist_stable > fovea_radius && dist_stable <= periphery_start;
                    bool isFarPeriphery = dist_stable > periphery_start; 
                    
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
                    
                    // Override V1 type if Mongrel Mode uniform says so (Legacy Toggle Support)
                    // Only applies if we are in a "standard" mode (Shatter/Noise) to avoid breaking Cyberpunk/Blueprint
                    if (config.v4_style_id != 5 && config.v1_distortion_type != 2 && config.v1_distortion_type != 3) {
                        if (u_mongrel_mode < 0.5) {
                            config.v1_distortion_type = 0; // Noise
                        }
                        else config.v1_distortion_type = 1; // Shatter
                    }

                    // --- PIPELINE EXECUTION ---
                    
                    // 1. LGN: Analysis & Gating
                    LGN_Signal lgn = processLGN(uv, config, dist, fovea_radius);
                    
                    // 2. V1: Geometry
                    V1_Signal v1 = processV1(uv, uv_corrected, lgn, config, dist_stable, fovea_radius, parafovea_radius, isFarPeriphery, isParafovea);
                    
                    // 3. V4: Aesthetics
                    float saccadeFactor = smoothstep(4.0, 10.0, u_velocity);
                    vec3 finalRGB = processV4(uv, v1, lgn, config, dist, saccadeFactor);
                    
                    // --- POST-PROCESSING (Rod Vision, Masking, Debug) ---
                    
                    vec4 color = vec4(finalRGB, 1.0);

                    // Rod Vision / Scrollbar Check
                    float scrollbarWidth = 17.0;
                    float distFromRightEdge = u_resolution.x - (uv.x * u_resolution.x);
                    bool isScrollbar = distFromRightEdge < scrollbarWidth;
                    
                    if (!isScrollbar) {
                        // Visual Memory Mask
                        float maskVal = 0.0;
                        if (u_useMask > 0.5) {
                            maskVal = texture(u_maskTexture, v_texCoord).r;
                        }
                        
                        if (maskVal > 0.99) {
                            vec4 clearColor = texture(u_texture, uv);
                            color.rgb = clearColor.rgb;
                            // Fix BGRA if needed (texture usually returns correct RGB, but if we swizzled before...)
                            // Actually texture() returns RGB. Our V4 swizzles for Shatter.
                            // Let's assume clearColor is correct RGB.
                        } else if (maskVal > 0.0) {
                            vec4 clearColor = texture(u_texture, uv);
                            color.rgb = mix(color.rgb, clearColor.rgb, maskVal);
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
                        color.rgb = vec3(lgn.saliency);
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
                        if (u_debug_boundary > 1.5) { // Mode 2
                            float visualParafoveaRadius = fovea_radius * 2.5;
                            float parafoveaDist = abs(dist - visualParafoveaRadius);
                            float fw = fwidth(parafoveaDist);
                            float ringAlpha = (1.0 - smoothstep(0.0, fw * 2.0, parafoveaDist)) * smoothstep(0.0, 0.1, sin(angle * 40.0));
                            if (ringAlpha > 0.0) color.rgb = mix(color.rgb, vec3(1.0, 0.5, 0.0), ringAlpha * 0.7);
                        }
                    }
                    
                    fragColor = color;
                }
            `;

                this.program = this.createProgram(gl, vsSource, fsSource);
                const { ipcRenderer: ipc2 } = require('electron');
                ipc2.send('log:renderer', `[WebGLRenderer] Shaders compiled and program created successfully`);

                // Look up locations
                this.positionLocation = gl.getAttribLocation(this.program, "a_position");
                this.texCoordLocation = gl.getAttribLocation(this.program, "a_texCoord");

                this.resolutionLocation = gl.getUniformLocation(this.program, "u_resolution");
                this.mouseLocation = gl.getUniformLocation(this.program, "u_mouse");
                this.mouseStableLocation = gl.getUniformLocation(this.program, "u_mouse_stable");
                this.foveaRadiusLocation = gl.getUniformLocation(this.program, "u_foveaRadius");
                this.foveaAspectRatioLocation = gl.getUniformLocation(this.program, "u_fovea_aspect_ratio");
                if (!this.foveaAspectRatioLocation && this.foveaAspectRatioLocation !== 0) {
                    // Note: getUniformLocation returns null if not found. It might return an object (WebGLUniformLocation).
                    // In some browsers/implementations it might be strict.
                    // If it's null, the uniform is optimized away or missing.
                    console.warn('[WebGLRenderer] Warning: u_fovea_aspect_ratio uniform not found (may be optimized away if unused)');
                }
                this.pixelationLocation = gl.getUniformLocation(this.program, "u_pixelation");
                this.intensityLocation = gl.getUniformLocation(this.program, "u_intensity");
                this.caStrengthLocation = gl.getUniformLocation(this.program, "u_ca_strength");
                this.debugBoundaryLocation = gl.getUniformLocation(this.program, "u_debug_boundary");
                this.debugStructureLocation = gl.getUniformLocation(this.program, "u_debug_structure");
                this.textureLocation = gl.getUniformLocation(this.program, "u_texture");
                this.maskTextureLocation = gl.getUniformLocation(this.program, "u_maskTexture");
                this.structureMapLocation = gl.getUniformLocation(this.program, "u_structureMap");
                this.saliencyMapLocation = gl.getUniformLocation(this.program, "u_saliencyMap");
                this.hasStructureLocation = gl.getUniformLocation(this.program, "u_has_structure");
                this.enableSaliencyModulationLocation = gl.getUniformLocation(this.program, "u_enable_saliency_modulation");
                this.useMaskLocation = gl.getUniformLocation(this.program, "u_useMask");
                this.velocityLocation = gl.getUniformLocation(this.program, "u_velocity");
                this.mongrelModeLocation = gl.getUniformLocation(this.program, "u_mongrel_mode");
                this.mongrelModeLocation = gl.getUniformLocation(this.program, "u_mongrel_mode");
                // this.aestheticModeLocation = gl.getUniformLocation(this.program, "u_aesthetic_mode");

                // Granular Uniforms
                this.lgnUseStructureMaskLocation = gl.getUniformLocation(this.program, "u_lgn_use_structure_mask");
                this.lgnUseSaliencyGateLocation = gl.getUniformLocation(this.program, "u_lgn_use_saliency_gate");
                this.v1DistortionTypeLocation = gl.getUniformLocation(this.program, "u_v1_distortion_type");
                this.v1StrengthMultLocation = gl.getUniformLocation(this.program, "u_v1_strength_mult");
                this.v4StyleIdLocation = gl.getUniformLocation(this.program, "u_v4_style_id");
                this.lgnRampEndMultLocation = gl.getUniformLocation(this.program, "u_lgn_ramp_end_mult");
                this.v1AnimateLocation = gl.getUniformLocation(this.program, "u_v1_animate");

                // Create buffers
                this.positionBuffer = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
                    -1, -1,
                    1, -1,
                    -1, 1,
                    -1, 1,
                    1, -1,
                    1, 1,
                ]), gl.STATIC_DRAW);

                this.texCoordBuffer = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
                    0, 1,
                    1, 1,
                    0, 0,
                    0, 0,
                    1, 1,
                    1, 0,
                ]), gl.STATIC_DRAW);

                // Create texture (sRGB for accurate color reproduction)
                this.texture = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, this.texture);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

                // Create mask texture
                this.maskTexture = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                const dummyMask = new Uint8Array([0, 0, 0, 255]);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, dummyMask);

                // Create structure map texture
                this.structureMapTexture = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, this.structureMapTexture);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                // NEAREST filter is important for structure map to keep sharp edges for wireframe mode
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                // Initialize to WHITE (Full Density) so effects are visible by default before first scan
                const dummyStructure = new Uint8Array([255, 255, 255, 255]);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, dummyStructure);

                // Create saliency map texture (GL_TEXTURE3)
                this.saliencyMapTexture = gl.createTexture();
                gl.activeTexture(gl.TEXTURE3);
                gl.bindTexture(gl.TEXTURE_2D, this.saliencyMapTexture);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                // Initialize to BLACK (0.0 Saliency)
                const dummySaliency = new Uint8Array([0, 0, 0, 255]);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, dummySaliency);
                // LINEAR filter for smooth gradients
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            }

            createProgram(gl, vsSource, fsSource) {
                const vs = this.compileShader(gl, gl.VERTEX_SHADER, vsSource);
                const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, fsSource);

                const program = gl.createProgram();
                gl.attachShader(program, vs);
                gl.attachShader(program, fs);
                gl.linkProgram(program);

                if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                    throw new Error('Program link error: ' + gl.getProgramInfoLog(program));
                }
                return program;
            }

            compileShader(gl, type, source) {
                const shader = gl.createShader(type);
                gl.shaderSource(shader, source);
                gl.compileShader(shader);

                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                    const info = gl.getShaderInfoLog(shader);
                    gl.deleteShader(shader);
                    throw new Error('Shader compile error: ' + info);
                }
                return shader;
            }

            uploadTexture(image) {
                const gl = this.gl;
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, this.texture);
                // Use sRGB format for color-correct rendering
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
            }

            uploadMask(image) {
                const gl = this.gl;
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            }

            uploadStructureMap(image) {
                const gl = this.gl;
                gl.activeTexture(gl.TEXTURE2);
                gl.bindTexture(gl.TEXTURE_2D, this.structureMapTexture);
                // CRITICAL: Disable alpha premultiplication to preserve RGB values
                // Alpha channel stores saliency and must not affect RGB (rhythm, density, type)
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); // Restore default
            }

            uploadSaliencyMap(image) {
                const gl = this.gl;
                gl.activeTexture(gl.TEXTURE3);
                gl.bindTexture(gl.TEXTURE_2D, this.saliencyMapTexture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            }

            updateConfigFromMode(modeId) {
                // Default: High-Key (0)
                this.config = {
                    lgn_use_structure_mask: true,
                    lgn_use_saliency_gate: true,
                    v1_distortion_type: 1, // Shatter
                    v1_strength_mult: 1.0,
                    v4_style_id: 0,
                    lgn_ramp_end_mult: 3.0,
                    v1_animate: false
                };

                if (modeId > 0.5 && modeId < 1.5) { // Lab (1)
                    this.config.v4_style_id = 1;
                    this.config.lgn_ramp_end_mult = 3.0;
                } else if (modeId > 1.5 && modeId < 2.5) { // Frosted (2)
                    this.config.v4_style_id = 2;
                    this.config.lgn_ramp_end_mult = 3.0;
                } else if (modeId > 2.5 && modeId < 3.5) { // Blueprint (3)
                    this.config.v1_distortion_type = 2; // None
                    this.config.v4_style_id = 3;
                    this.config.lgn_ramp_end_mult = 2.0;
                } else if (modeId > 3.5 && modeId < 4.5) { // Cyberpunk (4)
                    this.config.v1_distortion_type = 3; // Pixelate (Saliency-Guided)
                    this.config.v4_style_id = 4;
                    this.config.lgn_ramp_end_mult = 2.0;
                } else if (modeId > 4.5) { // Trippy (5)
                    this.config.lgn_use_structure_mask = false;
                    this.config.v1_distortion_type = 0; // Noise
                    this.config.v1_strength_mult = 3.0;
                    this.config.v4_style_id = 5;
                    this.config.lgn_ramp_end_mult = 1.5;
                    this.config.v1_animate = true;
                }
            }

            clear() {
                const gl = this.gl;
                gl.clearColor(0.0, 0.0, 0.0, 0.0);
                gl.clear(gl.COLOR_BUFFER_BIT);
            }
            render(width, height, mouseX, mouseY, foveaRadius, foveaAspectRatio = 1.33, intensity = 0.6, caStrength = 1.0, debugBoundary = 0.0, debugStructure = 0.0, useMask = 0.0, mongrelMode = 1.0, aestheticMode = 0.0, velocity = 0.0, stableMouseX = 0.0, stableMouseY = 0.0, hasStructure = 0.0, enableSaliencyModulation = 1.0) {
                if (!this.program) {
                    console.error('[WebGLRenderer] render() called but program is null!');
                    return;
                }

                // Log first render
                if (!this.renderCallCount) {
                    this.renderCallCount = 0;
                }
                this.renderCallCount++;
                if (this.renderCallCount === 1) {
                    const { ipcRenderer } = require('electron');
                    ipcRenderer.send('log:renderer', `[WebGLRenderer] First render: ${width}x${height}, mouse = (${mouseX},${mouseY}), radius = ${foveaRadius}, ratio = ${foveaAspectRatio}, mode = ${mongrelMode} `);
                }

                // Safety check for aspect ratio to prevent division by zero in shader
                if (!foveaAspectRatio || foveaAspectRatio < 0.1) {
                    foveaAspectRatio = 1.33;
                }

                const gl = this.gl;

                if (this.canvas.width !== width || this.canvas.height !== height) {
                    this.canvas.width = width;
                    this.canvas.height = height;
                }
                gl.viewport(0, 0, width, height);

                // Enable blending for transparent window composition
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

                gl.useProgram(this.program);

                gl.enableVertexAttribArray(this.positionLocation);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
                gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

                gl.enableVertexAttribArray(this.texCoordLocation);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
                gl.vertexAttribPointer(this.texCoordLocation, 2, gl.FLOAT, false, 0, 0);

                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, this.texture);
                gl.uniform1i(this.textureLocation, 0);

                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
                gl.uniform1i(this.maskTextureLocation, 1);

                gl.activeTexture(gl.TEXTURE2);
                gl.bindTexture(gl.TEXTURE_2D, this.structureMapTexture);
                gl.uniform1i(this.structureMapLocation, 2);

                gl.activeTexture(gl.TEXTURE3);
                gl.bindTexture(gl.TEXTURE_2D, this.saliencyMapTexture);
                gl.uniform1i(this.saliencyMapLocation, 3);

                gl.uniform2f(this.resolutionLocation, width, height);
                gl.uniform2f(this.mouseLocation, mouseX, mouseY);
                gl.uniform2f(this.mouseStableLocation, stableMouseX, stableMouseY);
                gl.uniform1f(this.foveaRadiusLocation, foveaRadius);
                gl.uniform1f(this.foveaAspectRatioLocation, foveaAspectRatio);
                gl.uniform1f(this.pixelationLocation, 0.15 * intensity);
                gl.uniform1f(this.intensityLocation, intensity);
                gl.uniform1f(this.caStrengthLocation, caStrength);
                gl.uniform1f(this.debugBoundaryLocation, debugBoundary);
                gl.uniform1f(this.debugStructureLocation, debugStructure);
                gl.uniform1f(this.useMaskLocation, useMask);
                gl.uniform1f(this.velocityLocation, velocity);
                gl.uniform1f(this.mongrelModeLocation, mongrelMode);
                gl.uniform1f(this.mongrelModeLocation, mongrelMode);
                // gl.uniform1f(this.aestheticModeLocation, aestheticMode);

                // Update Config based on Mode (Legacy Support / Preset Logic)
                this.updateConfigFromMode(aestheticMode);

                // Upload Granular Uniforms
                gl.uniform1f(this.lgnUseStructureMaskLocation, this.config.lgn_use_structure_mask ? 1.0 : 0.0);
                gl.uniform1f(this.lgnUseSaliencyGateLocation, this.config.lgn_use_saliency_gate ? 1.0 : 0.0);
                gl.uniform1i(this.v1DistortionTypeLocation, this.config.v1_distortion_type);
                gl.uniform1f(this.v1StrengthMultLocation, this.config.v1_strength_mult);
                gl.uniform1i(this.v4StyleIdLocation, this.config.v4_style_id);
                gl.uniform1f(this.lgnRampEndMultLocation, this.config.lgn_ramp_end_mult);
                gl.uniform1f(this.v1AnimateLocation, this.config.v1_animate ? 1.0 : 0.0);
                gl.uniform1f(this.hasStructureLocation, hasStructure);
                gl.uniform1f(this.enableSaliencyModulationLocation, enableSaliencyModulation);

                if (Math.random() < 0.01) {
                    // console.log(`[WebGL] Render Mode: ${ mongrelMode }, Res: ${ width }x${ height }, Mouse: ${ mouseX },${ mouseY } `);
                }

                // Log first drawArrays call
                if (!this.drawCallCount) {
                    this.drawCallCount = 0;
                }
                this.drawCallCount++;
                if (this.drawCallCount === 10) {
                    const { ipcRenderer: ipc3 } = require('electron');
                    ipc3.send('log:renderer', `[WebGLRenderer] drawArrays called(10th call), canvas = ${this.canvas.width}x${this.canvas.height} `);
                    // Check for WebGL errors
                    const error = gl.getError();
                    if (error !== gl.NO_ERROR) {
                        ipc3.send('log:renderer', `[WebGLRenderer] WebGL Error: ${error} `);
                    }
                }

                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
        }

        if (typeof module !== 'undefined' && module.exports) {
            module.exports = WebGLRenderer;
        } else {
            window.WebGLRenderer = WebGLRenderer;
            console.log('[WebGLRenderer] Class exposed to window');
        }
    } catch (err) {
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('log:renderer', `[WebGLRenderer] CRITICAL ERROR: ${err.message} `);
        if (err.stack) ipcRenderer.send('log:renderer', err.stack);
    }
})();
