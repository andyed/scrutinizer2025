/**
 * WebGL Renderer for Scrutinizer
 * Implements GPU-accelerated foveal rendering with "Mongrel" receptive field simulation.
 */

(() => {
    try {
        const { ipcRenderer } = require('electron');
        const fs = require('fs');
        const path = require('path');
        ipcRenderer.send('log:renderer', '[WebGLRenderer] Script execution started');

        const Logger = require('./logger');

        // Load mode registry from shared/modes.json
        let modesRegistry = null;
        try {
            const modesPath = path.join(__dirname, '..', 'shared', 'modes.json');
            modesRegistry = JSON.parse(fs.readFileSync(modesPath, 'utf8'));
            ipcRenderer.send('log:renderer', `[WebGLRenderer] Loaded ${Object.keys(modesRegistry.modes).length} modes from registry`);
        } catch (e) {
            console.warn('[WebGLRenderer] Could not load modes.json, using built-in defaults:', e.message);
        }

        class WebGLRenderer {
            constructor(canvas) {
                this.canvas = canvas;

                // Initialize WebGL 2 Context
                const gl = canvas.getContext('webgl2', {
                    alpha: true,
                    antialias: false,
                    preserveDrawingBuffer: true
                });
                this.gl = gl;

                if (!this.gl) {
                    Logger.error('[WebGL] WebGL 2 is required but not supported by this browser. Please use Chrome 56+, Firefox 51+, or Safari 15+.');
                    throw new Error('WebGL 2 not supported');
                }

                // Load shaders from file
                const vsSource = fs.readFileSync(path.join(__dirname, 'shaders', 'peripheral.vert'), 'utf8');
                const fsSource = fs.readFileSync(path.join(__dirname, 'shaders', 'peripheral2.frag'), 'utf8');

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
                this.scrollbarWidthLocation = null;
                // this.aestheticModeLocation = null; // Removed in favor of granular uniforms

                // Granular Uniform Locations
                this.lgnUseStructureMaskLocation = null;
                this.lgnUseSaliencyGateLocation = null;
                this.v1DistortionTypeLocation = null;
                this.v1StrengthMultLocation = null;
                this.v4StyleIdLocation = null;
                this.lgnRampEndMultLocation = null;
                this.v1AnimateLocation = null;

                // DoG uniform locations
                this.dogEnabledLocation = null;
                this.dogE2Location = null;
                this.dogSharpnessLocation = null;

                // Cortical Magnification Function (CMF) uniform locations
                this.cmfEnabledLocation = null;
                this.cmfALocation = null;
                this.corticalMaxLocation = null;
                this.cmfColorSigmaLocation = null;
                this.desatFloorLocation = null;

                // Chromatic pooling (castleCSF per-channel decay)
                this.chromaticPoolingLocation = null;
                this.rgDecayLocation = null;
                this.yvDecayLocation = null;
                this.yvFreqDecayLocation = null;
                this.supraExponentLocation = null;

                // Congestion overlay uniform location
                this.showCongestionLocation = null;

                // Saccadic blindness (suppress fovea during movement)
                this.saccadicBlindnessLocation = null;

                // Congestion-gated pooling (hypothesis mode)
                this.congestionPoolingLocation = null;

                // High-res congestion map (from dedicated congestion worker)
                this.congestionMapLocation = null;
                this.hasCongestionMapLocation = null;
                this._hasCongestionMapData = false;

                // Default Configuration
                this.config = {
                    lgn_use_structure_mask: true,
                    lgn_use_saliency_gate: true,
                    v1_distortion_type: 1, // Shatter
                    v1_strength_mult: 1.0,
                    v4_style_id: 0, // High-Key
                    lgn_ramp_end_mult: 3.0,
                    v1_animate: false,
                    dog_enabled: false,
                    dog_e2: 0.5,
                    dog_sharpness: 0.0,
                    cmf_enabled: false,
                    cmf_a: 2.78,
                    cmf_color_sigma: 0.0,
                    chromatic_pooling: false,
                    rg_decay: 0.072,     // Suprathreshold RG decay (Bowers 2025: 29% at 15°)
                    rg_freq_decay: 0.003, // RG frequency-dependent decay (suprathreshold spatial summation)
                    yv_decay: 0.014,     // Suprathreshold YV decay (Bowers 2025: 79% at 15°)
                    yv_freq_decay: 0.008, // castleCSF k_ef for YV
                    supra_exponent: 0.5, // Threshold→appearance compression (Jiang et al. 2022)
                    show_congestion: 0,  // 0=off, 1=congestion heatmap, 2=saliency vs congestion
                    congestion_pooling: false,
                    saccadic_blindness: false
                };

                this.init(vsSource, fsSource);
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

            init(vsSource, fsSource) {
                const gl = this.gl;

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
                this.scrollbarWidthLocation = gl.getUniformLocation(this.program, "u_scrollbarWidth");
                this.timeLocation = gl.getUniformLocation(this.program, "u_time");
                // this.aestheticModeLocation = gl.getUniformLocation(this.program, "u_aesthetic_mode");

                // Granular Uniforms
                this.lgnUseStructureMaskLocation = gl.getUniformLocation(this.program, "u_lgn_use_structure_mask");
                this.lgnUseSaliencyGateLocation = gl.getUniformLocation(this.program, "u_lgn_use_saliency_gate");
                this.v1DistortionTypeLocation = gl.getUniformLocation(this.program, "u_v1_distortion_type");
                this.v1StrengthMultLocation = gl.getUniformLocation(this.program, "u_v1_strength_mult");
                this.v4StyleIdLocation = gl.getUniformLocation(this.program, "u_v4_style_id");
                this.lgnRampEndMultLocation = gl.getUniformLocation(this.program, "u_lgn_ramp_end_mult");
                this.v1AnimateLocation = gl.getUniformLocation(this.program, "u_v1_animate");

                // DoG uniform lookups
                this.dogEnabledLocation = gl.getUniformLocation(this.program, "u_dog_enabled");
                this.dogE2Location = gl.getUniformLocation(this.program, "u_dog_e2");
                this.dogSharpnessLocation = gl.getUniformLocation(this.program, "u_dog_sharpness");

                // Cortical Magnification Function (CMF) uniform lookups
                this.cmfEnabledLocation = gl.getUniformLocation(this.program, "u_cmf_enabled");
                this.cmfALocation = gl.getUniformLocation(this.program, "u_cmf_a");
                this.corticalMaxLocation = gl.getUniformLocation(this.program, "u_cortical_max");
                this.cmfColorSigmaLocation = gl.getUniformLocation(this.program, "u_cmf_color_sigma");
                this.desatFloorLocation = gl.getUniformLocation(this.program, "u_desat_floor");

                // Chromatic pooling uniform lookup
                this.chromaticPoolingLocation = gl.getUniformLocation(this.program, "u_chromatic_pooling");
                this.rgDecayLocation = gl.getUniformLocation(this.program, "u_rg_decay");
                this.rgFreqDecayLocation = gl.getUniformLocation(this.program, "u_rg_freq_decay");
                this.yvDecayLocation = gl.getUniformLocation(this.program, "u_yv_decay");
                this.yvFreqDecayLocation = gl.getUniformLocation(this.program, "u_yv_freq_decay");
                this.supraExponentLocation = gl.getUniformLocation(this.program, "u_supra_exponent");

                // Congestion overlay uniform lookup
                this.showCongestionLocation = gl.getUniformLocation(this.program, "u_show_congestion");

                // Saccadic blindness uniform lookup
                this.saccadicBlindnessLocation = gl.getUniformLocation(this.program, "u_saccadic_blindness");

                // Congestion-gated pooling uniform lookup
                this.congestionPoolingLocation = gl.getUniformLocation(this.program, "u_congestion_pooling");

                // High-res congestion map uniform lookups
                this.congestionMapLocation = gl.getUniformLocation(this.program, "u_congestionMap");
                this.hasCongestionMapLocation = gl.getUniformLocation(this.program, "u_hasCongestionMap");

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

                // Create texture with MIP-map support for Mongrel pooling
                // MIP-maps enable textureLod() in shader for eccentricity-based sampling
                this.texture = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, this.texture);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                // LINEAR_MIPMAP_LINEAR = trilinear filtering across MIP levels
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
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
                // LINEAR filter for smooth interpolation (prevents vertical line artifacts)
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
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

                // Create high-res congestion map texture (GL_TEXTURE4)
                this.congestionMapTexture = gl.createTexture();
                gl.activeTexture(gl.TEXTURE4);
                gl.bindTexture(gl.TEXTURE_2D, this.congestionMapTexture);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                // Initialize to BLACK (no congestion data)
                const dummyCongestion = new Uint8Array([0, 0, 0, 255]);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, dummyCongestion);
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
                // Use RGBA (raw) instead of sRGB to prevent automatic linearization.
                // This ensures the shader receives the exact color values from the source,
                // avoiding gamma shifts (darkening) when outputting directly to the screen.
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

                // Generate MIP-maps for Mongrel pooling (Tier 1)
                // This enables textureLod() to sample different resolution levels
                // based on eccentricity from fovea, simulating receptive field growth
                gl.generateMipmap(gl.TEXTURE_2D);
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

            uploadCongestionMap(image) {
                const gl = this.gl;
                gl.activeTexture(gl.TEXTURE4);
                gl.bindTexture(gl.TEXTURE_2D, this.congestionMapTexture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
                this._hasCongestionMapData = true;
            }

            clearCongestionMap() {
                const gl = this.gl;
                gl.activeTexture(gl.TEXTURE4);
                gl.bindTexture(gl.TEXTURE_2D, this.congestionMapTexture);
                const empty = new Uint8Array([0, 0, 0, 255]);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, empty);
                this._hasCongestionMapData = false;
            }

            updateConfigFromMode(modeId) {
                // Preserve runtime toggles that aren't mode-specific.
                // show_congestion is set by setShowCongestion() and must survive
                // the per-frame config reset — it's a user toggle, not a mode property.
                const savedShowCongestion = this.config.show_congestion;
                // chromatic_pooling can be overridden by menu toggle or TEST_CHROMATIC_POOLING.
                // Only preserve if explicitly overridden (flag set by toggleChromaticPooling).
                const savedChromaticOverride = this._chromaticPoolingOverride;
                const savedSaccadicBlindness = this._saccadicBlindnessOverride;

                // Default: High-Key (0)
                const defaults = {
                    lgn_use_structure_mask: true,
                    lgn_use_saliency_gate: true,
                    v1_distortion_type: 1, // Shatter
                    v1_strength_mult: 1.0,
                    v4_style_id: 0,
                    lgn_ramp_end_mult: 2.0,
                    v1_animate: false,
                    dog_enabled: false,
                    dog_e2: 0.5,
                    dog_sharpness: 0.0,
                    cmf_enabled: false,
                    cmf_a: 2.78,
                    cmf_color_sigma: 0.0,
                    congestion_pooling: false
                };

                this.config = { ...defaults };
                this.config.show_congestion = savedShowCongestion;
                // Defer chromatic override restore until after mode config loads (below)

                // Try registry-based lookup first
                if (modesRegistry && modesRegistry.modes) {
                    // Find mode by ID
                    const modeEntry = Object.values(modesRegistry.modes).find(m =>
                        m.id === Math.round(modeId)
                    );

                    if (modeEntry && modeEntry.pipeline) {
                        const p = modeEntry.pipeline;
                        this.config.lgn_use_structure_mask = p.lgn_use_structure_mask ?? defaults.lgn_use_structure_mask;
                        this.config.lgn_use_saliency_gate = p.lgn_use_saliency_gate ?? defaults.lgn_use_saliency_gate;
                        this.config.lgn_ramp_end_mult = p.lgn_ramp_end_mult ?? defaults.lgn_ramp_end_mult;
                        this.config.v1_distortion_type = p.v1_distortion_type ?? defaults.v1_distortion_type;
                        this.config.v1_strength_mult = p.v1_strength_mult ?? defaults.v1_strength_mult;
                        this.config.v1_animate = p.v1_animate ?? defaults.v1_animate;
                        this.config.v4_style_id = p.v4_style_id ?? defaults.v4_style_id;
                        this.config.dog_enabled = p.dog_enabled ?? defaults.dog_enabled;
                        this.config.dog_e2 = p.dog_e2 ?? defaults.dog_e2;
                        this.config.dog_sharpness = p.dog_sharpness ?? defaults.dog_sharpness;
                        this.config.cmf_enabled = p.cmf_enabled ?? defaults.cmf_enabled;
                        this.config.cmf_a = p.cmf_a ?? defaults.cmf_a;
                        this.config.cmf_color_sigma = p.cmf_color_sigma ?? defaults.cmf_color_sigma;
                        this.config.congestion_pooling = p.congestion_pooling ?? defaults.congestion_pooling;
                        this.config.chromatic_pooling = p.chromatic_pooling ?? defaults.chromatic_pooling;
                        this.config.rg_decay = p.rg_decay ?? defaults.rg_decay;
                        this.config.rg_freq_decay = p.rg_freq_decay ?? defaults.rg_freq_decay;
                        this.config.yv_decay = p.yv_decay ?? defaults.yv_decay;
                        this.config.yv_freq_decay = p.yv_freq_decay ?? defaults.yv_freq_decay;
                        this.config.supra_exponent = p.supra_exponent ?? defaults.supra_exponent;

                        // Store current mode metadata for export
                        this.currentMode = modeEntry;
                        // Restore manual chromatic pooling override if set
                        if (savedChromaticOverride !== undefined) {
                            this.config.chromatic_pooling = savedChromaticOverride;
                        }
                        if (savedSaccadicBlindness !== undefined) {
                            this.config.saccadic_blindness = savedSaccadicBlindness;
                        }
                        return;
                    }
                }

                // Fallback: Original hardcoded logic (for backward compatibility)
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
            render(width, height, mouseX, mouseY, foveaRadius, foveaAspectRatio = 1.33, intensity = 0.6, caStrength = 1.0, debugBoundary = 0.0, debugStructure = 0.0, useMask = 0.0, mongrelMode = 1.0, aestheticMode = 0.0, velocity = 0.0, stableMouseX = 0.0, stableMouseY = 0.0, hasStructure = 0.0, enableSaliencyModulation = 1.0, time = 0.0, scrollbarWidth = 17.0) {
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
                    ipcRenderer.send('log:renderer', `[WebGLRenderer] First render: ${width}x${height}, radius=${foveaRadius}, mode=${mongrelMode}`);
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

                gl.activeTexture(gl.TEXTURE4);
                gl.bindTexture(gl.TEXTURE_2D, this.congestionMapTexture);
                gl.uniform1i(this.congestionMapLocation, 4);
                gl.uniform1f(this.hasCongestionMapLocation, this._hasCongestionMapData ? 1.0 : 0.0);

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

                if (Math.random() < 0.005) {
                    const { ipcRenderer } = require('electron');
                    ipcRenderer.send('log:renderer', `[WebGLRenderer] Render: useMask=${useMask}`);
                }

                gl.uniform1f(this.velocityLocation, velocity);
                gl.uniform1f(this.mongrelModeLocation, mongrelMode);
                gl.uniform1f(this.mongrelModeLocation, mongrelMode);
                gl.uniform1f(this.timeLocation, time);
                gl.uniform1f(this.scrollbarWidthLocation, scrollbarWidth);
                // gl.uniform1f(this.aestheticModeLocation, aestheticMode);

                // Update Config based on Mode (Legacy Support / Preset Logic)
                this.updateConfigFromMode(aestheticMode);

                // Compute cortical_max from screen geometry + foveal calibration
                // Foveal radius encodes pixels-per-degree (fovea ≈ 2° visual angle).
                // r_max in degrees = (screen_half_diagonal / fovea_radius) × 2°.
                // cortical_max = ln(r_max + a) - ln(a), the total cortical distance range.
                const foveaDeg = 2.0;
                const halfDiag = Math.sqrt(width * width + height * height) / 2;
                const rMaxDeg = (halfDiag / foveaRadius) * foveaDeg;
                const cmfA = this.config.cmf_a || 2.78;
                const corticalMax = Math.log1p(rMaxDeg / cmfA);

                if (!this._lastCorticalMax || Math.abs(corticalMax - this._lastCorticalMax) > 0.01) {
                    console.log(`[WebGLRenderer] CMF cortical_max=${corticalMax.toFixed(3)} (r_max=${rMaxDeg.toFixed(1)}° a=${cmfA} fovea=${foveaRadius}px ${width}×${height})`);
                    this._lastCorticalMax = corticalMax;
                }

                // Upload Granular Uniforms
                gl.uniform1f(this.lgnUseStructureMaskLocation, this.config.lgn_use_structure_mask ? 1.0 : 0.0);
                gl.uniform1f(this.lgnUseSaliencyGateLocation, this.config.lgn_use_saliency_gate ? 1.0 : 0.0);
                gl.uniform1i(this.v1DistortionTypeLocation, this.config.v1_distortion_type);
                gl.uniform1f(this.v1StrengthMultLocation, this.config.v1_strength_mult);
                gl.uniform1i(this.v4StyleIdLocation, this.config.v4_style_id);
                gl.uniform1f(this.lgnRampEndMultLocation, this.config.lgn_ramp_end_mult);
                gl.uniform1f(this.v1AnimateLocation, this.config.v1_animate ? 1.0 : 0.0);
                gl.uniform1f(this.dogEnabledLocation, this.config.dog_enabled ? 1.0 : 0.0);
                gl.uniform1f(this.dogE2Location, this.config.dog_e2);
                gl.uniform1f(this.dogSharpnessLocation, this.config.dog_sharpness);
                gl.uniform1f(this.cmfEnabledLocation, this.config.cmf_enabled ? 1.0 : 0.0);
                gl.uniform1f(this.cmfALocation, this.config.cmf_a);
                gl.uniform1f(this.corticalMaxLocation, corticalMax);
                gl.uniform1f(this.cmfColorSigmaLocation, this.config.cmf_color_sigma);
                gl.uniform1f(this.desatFloorLocation, this.config.desat_floor ?? 1.0);
                gl.uniform1f(this.chromaticPoolingLocation, this.config.chromatic_pooling ? 1.0 : 0.0);
                gl.uniform1f(this.rgDecayLocation, this.config.rg_decay);
                gl.uniform1f(this.rgFreqDecayLocation, this.config.rg_freq_decay);
                gl.uniform1f(this.yvDecayLocation, this.config.yv_decay);
                gl.uniform1f(this.yvFreqDecayLocation, this.config.yv_freq_decay);
                gl.uniform1f(this.supraExponentLocation, this.config.supra_exponent);
                gl.uniform1f(this.hasStructureLocation, hasStructure);
                gl.uniform1f(this.enableSaliencyModulationLocation, enableSaliencyModulation);
                gl.uniform1i(this.showCongestionLocation, this.config.show_congestion);
                gl.uniform1f(this.saccadicBlindnessLocation, this.config.saccadic_blindness ? 1.0 : 0.0);
                gl.uniform1f(this.congestionPoolingLocation, this.config.congestion_pooling ? 1.0 : 0.0);

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
        }
        // Always expose to window for script tag loading
        window.WebGLRenderer = WebGLRenderer;
    } catch (err) {
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('log:renderer', `[WebGLRenderer] CRITICAL ERROR: ${err.message} `);
        if (err.stack) ipcRenderer.send('log:renderer', err.stack);
    }
})();
