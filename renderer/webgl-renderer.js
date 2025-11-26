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

                // Try WebGL 2 first, then WebGL 1, then experimental
                this.gl = canvas.getContext('webgl2', contextAttributes) ||
                    canvas.getContext('webgl', contextAttributes) ||
                    canvas.getContext('experimental-webgl', contextAttributes);

                if (!this.gl) {
                    Logger.error('[WebGL] Failed to initialize WebGL context. Your browser or hardware may not support it.');
                    throw new Error('WebGL not supported');
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
                this.aestheticModeLocation = null;

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

                const vsSource = `
                attribute vec2 a_position;
                attribute vec2 a_texCoord;
                varying vec2 v_texCoord;
                void main() {
                    gl_Position = vec4(a_position, 0.0, 1.0);
                    v_texCoord = a_texCoord;
                }
            `;

                const fsSource = `
                precision mediump float;
    
                // === UNIFORMS ===
                uniform sampler2D u_texture;      // Captured browser frame (Live)
                uniform sampler2D u_maskTexture;  // Visual memory mask
                uniform float u_useMask;
                
                uniform vec2  u_resolution;
                uniform vec2  u_mouse;
                uniform vec2  u_mouse_stable; // Hysteresis-smoothed mouse for distortion
                uniform float u_foveaRadius;
                uniform float u_pixelation;
                uniform float u_intensity;
                uniform float u_ca_strength;
                uniform float u_debug_boundary;
                uniform float u_velocity;         // Mouse velocity in px/ms
                uniform float u_mongrel_mode;     // 0.0 = Noise, 1.0 = Shatter
                uniform float u_aesthetic_mode;   // 0=HighKey, 1=Lab, 2=Frosted, 3=Blueprint, 4=Cyberpunk
    
                varying vec2 v_texCoord;
    
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
    
                vec4 sampleMongrel(sampler2D tex, vec2 uv, float strength, float intensity) {
                    if (strength <= 0.01) return texture2D(tex, uv);
    
                    // FIXED: Use constant cell density so the grid doesn't "swim" when strength changes
                    float cellDensity = 120.0; 
                    
                    float xID = floor(uv.x * cellDensity);
                    float yID = floor(uv.y * (cellDensity * 0.5));
    
                    // Strength only affects the AMPLITUDE of the jitter, not the grid structure
                    float jitterScale = 0.04 * strength * intensity;
                    
                    // Hash based on fixed grid IDs
                    float offX = (hash22(vec2(yID, xID)).x - 0.5) * jitterScale;
                    float offY = (hash22(vec2(xID, yID + 13.0)).x - 0.5) * jitterScale;
    
                    vec2 shatteredUV = uv + vec2(offX, offY);
                    
                    vec4 clean = texture2D(tex, shatteredUV);
                    vec4 ghost = texture2D(tex, shatteredUV + vec2(0.01 * strength, 0.0));
                    
                    return mix(clean, ghost, 0.3);
                }
    
                vec3 applyAestheticEffect(vec3 col, vec2 uv, sampler2D tex, float dist, float intensity, float startThreshold) {
                    float effectFactor = smoothstep(startThreshold, startThreshold + 0.55, dist); 
                    effectFactor = clamp(effectFactor * intensity, 0.0, 1.0);

                    // Saccadic Suppression (Motion Blur/Washout)
                    // Increased threshold to 4.0 px/ms (4000px/s) to prevent flashing on small "jiggles"
                    float saccadeFactor = smoothstep(4.0, 10.0, u_velocity);

                    // Mode Selection
                    // 0: High-Key Ghosting
                    // 1: Lab Mode (Scotopic)
                    // 2: Frosted Glass
                    // 3: Blueprint
                    // 4: Cyberpunk

                    if (u_aesthetic_mode < 0.5) {
                        // === 0: HIGH-KEY GHOSTING (Default) ===
                        // Desaturate + Lift Shadows
                        float luma = dot(col, vec3(0.299, 0.587, 0.114));
                        vec3 gray = vec3(luma);
                        vec3 targetWhite = vec3(0.8, 0.85, 0.9); // Cool light gray
                        vec3 ghostColor = mix(gray, targetWhite, 0.4); 
                        
                        // Digital Grain
                        float noise = (rand(gl_FragCoord.xy) - 0.5) * 0.05;
                        ghostColor += noise;
                        
                        // Saccadic: Wash out to white (Reduced intensity to 50% to prevent harsh flashing)
                        ghostColor = mix(ghostColor, vec3(0.95, 0.98, 1.0), saccadeFactor * 0.5);

                        return mix(col, ghostColor, effectFactor * 0.95); 

                    } else if (u_aesthetic_mode < 1.5) {
                        // === 1: LAB MODE (Scotopic) ===
                        // Dark, Blue-Tinted, Grainy
                        float luma = dot(col, vec3(0.0, 0.6, 0.4)); 
                        vec3 coldDark = vec3(0.02, 0.05, 0.1);
                        vec3 coldBright = vec3(0.6, 0.7, 0.8);
                        
                        vec3 rodColor = mix(coldDark, coldBright, luma);
                        rodColor *= 0.96; 
                        
                        float noise = (rand(gl_FragCoord.xy) - 0.5) * 0.1;
                        rodColor += noise;

                        // Saccadic: Fade to deep dark
                        rodColor = mix(rodColor, vec3(0.01, 0.01, 0.01), saccadeFactor * 0.9);

                        return mix(col, rodColor, effectFactor);

                    } else if (u_aesthetic_mode < 2.5) {
                        // === 2: FROSTED GLASS (iOS) ===
                        // Bright, Low Contrast, Milky
                        float luma = dot(col, vec3(0.299, 0.587, 0.114));
                        vec3 milk = vec3(0.9, 0.92, 0.95);
                        
                        // Reduce contrast by mixing towards milk
                        vec3 frostedColor = mix(col, milk, 0.6);
                        
                        // Saccadic: Whiteout
                        frostedColor = mix(frostedColor, vec3(1.0), saccadeFactor * 0.8);
                        
                        return mix(col, frostedColor, effectFactor);

                    } else if (u_aesthetic_mode < 3.5) {
                        // === 3: BLUEPRINT (UX) ===
                        // Visual Scent: Quantized Structural Edges (Optimized)
                        
                        float strength = smoothstep(u_foveaRadius, u_foveaRadius + 0.4, dist);
                        
                        // 1. Quantize UVs (Mosaic)
                        // FIXED: Use CONSTANT block size to prevent "swimming" grid when mouse moves
                        float blockSize = 30.0; 
                        vec2 blockDims = u_resolution / blockSize;
                        vec2 quantUV = floor(uv * blockDims) / blockDims + (vec2(0.5) / blockDims);
                        
                        // 2. Calculate Distortion ONCE (Optimization)
                        // Inline Mongrel logic to avoid 5x function calls
                        float cellDensity = 120.0; 
                        float xID = floor(quantUV.x * cellDensity);
                        float yID = floor(quantUV.y * (cellDensity * 0.5));
                        float jitterScale = 0.04 * strength * u_intensity;
                        
                        float offX = (hash22(vec2(yID, xID)).x - 0.5) * jitterScale;
                        float offY = (hash22(vec2(xID, yID + 13.0)).x - 0.5) * jitterScale;
                        
                        vec2 shatteredUV = quantUV + vec2(offX, offY);
                        
                        // 3. Base Color (Simple Lookup)
                        vec3 baseCol = texture2D(tex, shatteredUV).rgb;
                        
                        // 4. Edge Detection (Simple Lookups on Shattered UV)
                        // We assume the distortion is locally constant (valid for blocks)
                        float structureScale = 2.0 + 4.0 * effectFactor;
                        vec2 edgeStep = vec2(structureScale) / u_resolution;
                        
                        vec3 n = texture2D(tex, shatteredUV + vec2(0.0, edgeStep.y)).rgb;
                        vec3 s = texture2D(tex, shatteredUV - vec2(0.0, edgeStep.y)).rgb;
                        vec3 e = texture2D(tex, shatteredUV + vec2(edgeStep.x, 0.0)).rgb;
                        vec3 w = texture2D(tex, shatteredUV - vec2(edgeStep.x, 0.0)).rgb;
                        
                        float lumaN = dot(n, vec3(0.299, 0.587, 0.114));
                        float lumaS = dot(s, vec3(0.299, 0.587, 0.114));
                        float lumaE = dot(e, vec3(0.299, 0.587, 0.114));
                        float lumaW = dot(w, vec3(0.299, 0.587, 0.114));
                        
                        float edgeH = abs(lumaE - lumaW);
                        float edgeV = abs(lumaN - lumaS);
                        float edge = length(vec2(edgeH, edgeV));
                        
                        // 5. Sharpen & Threshold
                        edge = smoothstep(0.05, 0.2, edge);
                        
                        // 6. Compose
                        vec3 edgeColor = vec3(1.0) - baseCol;
                        vec3 final = mix(baseCol, edgeColor, edge);
                        
                        return mix(col, final, effectFactor);

                    } else {
                        // === 4: CYBERPUNK (VJ) ===
                        // High Contrast, Neon Tints
                        float luma = dot(col, vec3(0.299, 0.587, 0.114));
                        
                        // Crush blacks, boost whites
                        float contrastLuma = smoothstep(0.2, 0.8, luma);
                        
                        // Tint shadows Purple, Highlights Cyan
                        vec3 shadowColor = vec3(0.2, 0.0, 0.3); // Deep Purple
                        vec3 highlightColor = vec3(0.0, 0.8, 1.0); // Cyan
                        
                        vec3 cyberColor = mix(shadowColor, highlightColor, contrastLuma);
                        
                        // Saccadic: Glitchy bright
                        cyberColor = mix(cyberColor, vec3(1.0, 0.0, 1.0), saccadeFactor * 0.5); // Magenta flash
                        
                        return mix(col, cyberColor, effectFactor);
                    }
                }
    
                void main() {
                    float aspect = u_resolution.x / u_resolution.y;
                    vec2 uv = v_texCoord;
                    vec2 uv_corrected = vec2(uv.x * aspect, uv.y);
                    
                    vec2 mouse_uv = u_mouse / u_resolution;
                    vec2 mouse_corrected = vec2(mouse_uv.x * aspect, mouse_uv.y);
                    
                    vec2 delta = uv_corrected - mouse_corrected;
                    delta.x /= 1.77; 
                    float dist = length(delta); // Real distance (for lighting/rod vision)

                    // Stable Mouse (for Distortion/Mongrel)
                    vec2 mouse_stable_uv = u_mouse_stable / u_resolution;
                    vec2 mouse_stable_corrected = vec2(mouse_stable_uv.x * aspect, mouse_stable_uv.y);
                    vec2 delta_stable = uv_corrected - mouse_stable_corrected;
                    delta_stable.x /= 1.77;
                    float dist_stable = length(delta_stable); // Stable distance (for distortion)
    
                    float radius_norm = u_foveaRadius / u_resolution.y;
                    float fovea_radius = radius_norm;
                    float parafovea_radius = radius_norm * 1.35;
                    float periphery_start = radius_norm * 1.2;
                    
                    // Use STABLE distance for distortion zones
                    bool isParafovea = dist_stable > fovea_radius && dist_stable <= periphery_start;
                    bool isFarPeriphery = dist_stable > periphery_start; 
                    
                    vec4 color;
                    
                    // Use REAL distance for the mask to prevent "lag" (fovea follows mouse)
                    // Use QUANTIZED strength to prevent "shimmer" (noise pattern steps)
                    
                    // Blueprint Mode (3) should NOT have distortion, as it relies on clean edge detection
                    bool isBlueprint = abs(u_aesthetic_mode - 3.0) < 0.1;
                    
                    if (u_mongrel_mode > 0.5) {
                        // SHATTER
                        // Calculate smooth strength based on REAL distance
                        float mongrelStrength = smoothstep(fovea_radius, periphery_start + 0.4, dist);
                        
                        if (isBlueprint) mongrelStrength = 0.0; // Disable shatter for Blueprint
                        
                        // Sample using smooth strength (now stable because sampleMongrel is fixed)
                        vec4 rawColor = sampleMongrel(u_texture, uv, mongrelStrength, u_intensity);
                        
                        // BGRA Swizzle
                        color.r = rawColor.b;
                        color.g = rawColor.g;
                        color.b = rawColor.r;
                        color.a = 1.0;
                        
                    } else {
                        // NOISE
                        // Calculate smooth strength based on REAL distance
                        float warpStrength = smoothstep(fovea_radius, parafovea_radius, dist);
                        warpStrength = pow(warpStrength, 0.5);
                        
                        if (isBlueprint) warpStrength = 0.0; // Disable noise for Blueprint
                        
                        vec2 uv_noise = vec2(uv_corrected.x / 1.77, uv_corrected.y);
                        
                        float coarseScaleX = isFarPeriphery ? 2000.0 : 200.0;
                        float coarseScaleY = isFarPeriphery ? 1000.0 : 100.0;
                        float n1_warp_a = snoise(vec2(uv_noise.x * coarseScaleX, uv_noise.y * coarseScaleY));
                        float n2_warp_a = snoise(vec2(uv_noise.x * coarseScaleX, uv_noise.y * coarseScaleY) + vec2(50.0, 50.0));
                        
                        float n1_warp_b = snoise(vec2(uv_noise.x * coarseScaleX * 2.3, uv_noise.y * coarseScaleY * 2.3) + vec2(100.0, 100.0));
                        float n2_warp_b = snoise(vec2(uv_noise.x * coarseScaleX * 2.3, uv_noise.y * coarseScaleY * 2.3) + vec2(150.0, 150.0));
                        
                        float n1_warp = n1_warp_a + n2_warp_b * 0.5;
                        float n2_warp = n2_warp_a + n1_warp_b * 0.5;
                        
                        vec2 warpAmp = isFarPeriphery ? vec2(0.005, 0.004) : vec2(0.001, 0.0001);
                        vec2 warpVector = vec2(n1_warp, n2_warp) * warpAmp * warpStrength * u_intensity;
                        
                        float fineScale = isFarPeriphery ? 15000.0 : 6000.0;
                        vec2 warpedUV_noise = vec2((uv_corrected.x + warpVector.x) / 1.77, uv_corrected.y + warpVector.y);
                        
                        float n1_jitter = snoise(warpedUV_noise * fineScale);
                        float n2_jitter = snoise(warpedUV_noise * fineScale + vec2(100.0, 100.0));
                        
                        float outerParafoveaStrength = smoothstep(parafovea_radius * 0.5, parafovea_radius, dist); // Use real dist
                        vec2 jitterAmp;
                        if (isFarPeriphery) {
                            jitterAmp = vec2(0.01, 0.008);
                        } else if (isParafovea) {
                            float baseX = mix(0.001, 0.015, outerParafoveaStrength);
                            float baseY = mix(0.0001, 0.012, outerParafoveaStrength);
                            jitterAmp = vec2(baseX, baseY);
                        } else {
                            jitterAmp = vec2(0.0, 0.0);
                        }
                        
                        vec2 jitterVector = vec2(n1_jitter, n2_jitter) * jitterAmp * warpStrength * u_intensity;
                        vec2 displacement = warpVector + jitterVector;
                        vec2 newUV = uv + displacement;
                        
                        // CA Logic
                        float noiseSample = rand(uv_corrected * 100.0);
                        float distDithered = dist + (noiseSample - 0.5) * 0.3; // Use real dist
                        float caStrength = smoothstep(periphery_start, periphery_start + 0.25, distDithered);
                        
                        float aberrationAmt = 0.02 * caStrength * u_intensity * u_ca_strength;
                        vec2 r_offset = vec2(aberrationAmt * 0.5, 0.0);
                        vec2 b_offset = vec2(aberrationAmt * 1.0, 0.0);
                        
                        r_offset.x /= aspect;
                        b_offset.x /= aspect;
                        
                        vec4 colorR = texture2D(u_texture, newUV - r_offset);
                        vec4 colorG = texture2D(u_texture, newUV);
                        vec4 colorB = texture2D(u_texture, newUV + b_offset);
                        
                        color.r = colorR.b; // BGRA swizzle
                        color.g = colorG.g;
                        color.b = colorB.r;
                        color.a = 1.0;
                    }
    
                    // Rod Vision
                    float scrollbarWidth = 17.0;
                    float distFromRightEdge = u_resolution.x - (uv.x * u_resolution.x);
                    bool isScrollbar = distFromRightEdge < scrollbarWidth;
                    
                    if (!isScrollbar) {
                        // Pass v_texCoord (uv) for texture sampling, NOT uv_corrected!
                        vec3 finalRGB = applyAestheticEffect(color.rgb, v_texCoord, u_texture, dist, u_intensity, periphery_start);
                        
                        // === VISUAL MEMORY MASK ===
                        // Mix back to the original clear content where the mask is white
                        if (u_useMask > 0.5) {
                            float maskVal = texture2D(u_maskTexture, v_texCoord).r;
                            // Mask: White = Clear (Fovea), Black = Peripheral
                            // We want to show the 'finalRGB' (peripheral) where mask is Black (0.0)
                            // And show 'color.rgb' (clear/original) where mask is White (1.0)
                            // Wait, 'color.rgb' at this point is the base texture sample (swizzled).
                            // So mixing finalRGB with color.rgb based on maskVal is correct.
                            finalRGB = mix(finalRGB, color.rgb, maskVal);
                        }
                        
                        color.rgb = finalRGB;
                    }
                    
                    // Debug Boundary
                    if (u_debug_boundary > 0.5) {
                        float lineThickness = 0.003;
                        float border = 1.0 - smoothstep(0.0, lineThickness, abs(dist - fovea_radius));
                        if (border > 0.0) {
                            vec3 lineColor = vec3(0.5, 0.5, 0.5);
                            float alpha = border * 0.6;
                            color.rgb = mix(color.rgb, lineColor, alpha);
                        }
                    }
    
                    // Fog of War
                    if (u_useMask > 0.5) {
                        vec4 maskColor = texture2D(u_maskTexture, uv);
                        float clarity = maskColor.r;
                        clarity = smoothstep(0.1, 1.0, clarity);
    
                        vec4 cleanRaw = texture2D(u_texture, uv);
                        vec4 cleanPixel;
                        cleanPixel.r = cleanRaw.b;
                        cleanPixel.g = cleanRaw.g;
                        cleanPixel.b = cleanRaw.r;
                        cleanPixel.a = 1.0;
    
                        color = mix(color, cleanPixel, clarity);
                    }
                    
                    gl_FragColor = color;
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
                this.pixelationLocation = gl.getUniformLocation(this.program, "u_pixelation");
                this.intensityLocation = gl.getUniformLocation(this.program, "u_intensity");
                this.caStrengthLocation = gl.getUniformLocation(this.program, "u_ca_strength");
                this.debugBoundaryLocation = gl.getUniformLocation(this.program, "u_debug_boundary");
                this.textureLocation = gl.getUniformLocation(this.program, "u_texture");
                this.maskTextureLocation = gl.getUniformLocation(this.program, "u_maskTexture");
                this.useMaskLocation = gl.getUniformLocation(this.program, "u_useMask");
                this.velocityLocation = gl.getUniformLocation(this.program, "u_velocity");
                this.mongrelModeLocation = gl.getUniformLocation(this.program, "u_mongrel_mode");
                this.aestheticModeLocation = gl.getUniformLocation(this.program, "u_aesthetic_mode");

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

                // Create texture
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
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            }

            uploadMask(image) {
                const gl = this.gl;
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            }

            uploadMask(image) {
                const gl = this.gl;
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            }

            clear() {
                const gl = this.gl;
                gl.clearColor(0.0, 0.0, 0.0, 0.0);
                gl.clear(gl.COLOR_BUFFER_BIT);
            }
            render(width, height, mouseX, mouseY, foveaRadius, intensity = 0.6, caStrength = 1.0, debugBoundary = 0.0, useMask = 0.0, mongrelMode = 1.0, aestheticMode = 0.0, velocity = 0.0, stableMouseX = 0.0, stableMouseY = 0.0) {
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
                    ipcRenderer.send('log:renderer', `[WebGLRenderer] First render: ${width}x${height}, mouse=(${mouseX},${mouseY}), radius=${foveaRadius}, mode=${mongrelMode}`);
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

                gl.uniform2f(this.resolutionLocation, width, height);
                gl.uniform2f(this.mouseLocation, mouseX, mouseY);
                gl.uniform2f(this.mouseStableLocation, stableMouseX, stableMouseY);
                gl.uniform1f(this.foveaRadiusLocation, foveaRadius);
                gl.uniform1f(this.pixelationLocation, 0.15 * intensity);
                gl.uniform1f(this.intensityLocation, intensity);
                gl.uniform1f(this.caStrengthLocation, caStrength);
                gl.uniform1f(this.debugBoundaryLocation, debugBoundary);
                gl.uniform1f(this.useMaskLocation, useMask);
                gl.uniform1f(this.velocityLocation, velocity);
                gl.uniform1f(this.mongrelModeLocation, mongrelMode);
                gl.uniform1f(this.aestheticModeLocation, aestheticMode);

                if (Math.random() < 0.01) {
                    // console.log(`[WebGL] Render Mode: ${mongrelMode}, Res: ${width}x${height}, Mouse: ${mouseX},${mouseY}`);
                }
                
                // Log first drawArrays call
                if (!this.drawCallCount) {
                    this.drawCallCount = 0;
                }
                this.drawCallCount++;
                if (this.drawCallCount === 10) {
                    const { ipcRenderer: ipc3 } = require('electron');
                    ipc3.send('log:renderer', `[WebGLRenderer] drawArrays called (10th call), canvas=${this.canvas.width}x${this.canvas.height}`);
                    // Check for WebGL errors
                    const error = gl.getError();
                    if (error !== gl.NO_ERROR) {
                        ipc3.send('log:renderer', `[WebGLRenderer] WebGL Error: ${error}`);
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
        ipcRenderer.send('log:renderer', `[WebGLRenderer] CRITICAL ERROR: ${err.message}`);
        if (err.stack) ipcRenderer.send('log:renderer', err.stack);
    }
})();
