/**
 * ScrutinizerVisualizer
 * 
 * A standalone, framework-agnostic WebGL visualizer for the Scrutinizer foveal vision simulation.
 * Extracted from the Electron application for use in Figma plugins and other web environments.
 * 
 * Core features:
 * - "Mongrel" receptive field simulation (Box Sampling + Noise)
 * - Rod-weighted luminance (Scotopic vision)
 * - Domain warping (Positional uncertainty)
 * - Radial chromatic aberration (Lens split)
 */

class ScrutinizerVisualizer {
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
            console.error('[ScrutinizerVisualizer] Failed to initialize WebGL context.');
            throw new Error('WebGL not supported');
        }

        this.program = null;
        this.texture = null;
        this.positionBuffer = null;
        this.texCoordBuffer = null;

        this.init();
        this.warmup(); // Pre-compile shader to avoid lag
    }

    warmup() {
        // Create a tiny dummy texture and render it to force shader compilation
        const gl = this.gl;
        const dummyData = new Uint8Array(4 * 4 * 4); // 4x4 RGBA
        for (let i = 0; i < dummyData.length; i += 4) {
            dummyData[i] = 128;     // R
            dummyData[i + 1] = 128; // G
            dummyData[i + 2] = 128; // B
            dummyData[i + 3] = 255; // A
        }

        const dummyImage = new ImageData(new Uint8ClampedArray(dummyData), 4, 4);
        this.uploadTexture(dummyImage);

        // Render a few frames to trigger shader compilation and optimization
        for (let i = 0; i < 3; i++) {
            this.render(100, 100, 50, 50, 30);
        }

        console.log('[ScrutinizerVisualizer] Shader warmup complete');
    }

    init() {
        const gl = this.gl;

        // Vertex Shader
        const vsSource = `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            varying vec2 v_texCoord;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = a_texCoord;
            }
        `;

        // Fragment Shader - Core "Mongrel" peripheral simulation
        const fsSource = `
            precision mediump float;

            // === UNIFORMS (host-controlled parameters) ===
            uniform sampler2D u_texture;      // Captured frame
            uniform vec2  u_resolution;       // Canvas resolution in pixels
            uniform vec2  u_mouse;            // Foveal center in pixels (canvas space)
            uniform float u_foveaRadius;      // Foveal radius in pixels
            uniform float u_pixelation;       // Base pixelation scalar
            uniform float u_intensity;        // Global intensity multiplier
            uniform float u_ca_strength;      // Chromatic aberration enable (0.0 or 1.0)
            uniform float u_debug_boundary;   // Debug boundary toggle (0.0 or 1.0)

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

            float rand(vec2 co){
                return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
            }

            void main() {
                // === 1. COORDINATE SETUP ===
                float aspect = u_resolution.x / u_resolution.y;
                vec2 uv = v_texCoord;
                vec2 uv_corrected = vec2(uv.x * aspect, uv.y);
                
                vec2 mouse_uv = u_mouse / u_resolution;
                vec2 mouse_corrected = vec2(mouse_uv.x * aspect, mouse_uv.y);
                
                vec2 delta = uv_corrected - mouse_corrected;
                delta.x /= 1.77; // Squash X for 16:9 aspect
                float dist = length(delta);

                // === 2. ZONE RADII ===
                float radius_norm = u_foveaRadius / u_resolution.y;
                float fovea_radius = radius_norm;
                float parafovea_radius = radius_norm * 1.35;
                float periphery_start = radius_norm * 1.2;
                
                // === 3. STRENGTH MASKS ===
                float warpStrength = smoothstep(fovea_radius, parafovea_radius, dist);
                warpStrength = pow(warpStrength, 0.5);
                
                float noiseSample = rand(uv_corrected * 100.0);
                float distDithered = dist + (noiseSample - 0.5) * 0.3;
                float caStrength = smoothstep(periphery_start, periphery_start + 0.25, distDithered);
                
                float rodStrength = smoothstep(fovea_radius, periphery_start, dist);
                float scatterStrength = smoothstep(periphery_start, periphery_start + 0.2, dist);
                
                bool isParafovea = dist > fovea_radius && dist <= periphery_start;
                bool isFarPeriphery = dist > periphery_start;
                
                // === 4. DOMAIN WARPING ===
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
                
                float outerParafoveaStrength = smoothstep(parafovea_radius * 0.5, parafovea_radius, dist);
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
                
                // === 5. CHROMATIC ABERRATION ===
                vec2 ca_delta = uv_corrected - mouse_corrected;
                float ca_dist = length(ca_delta);
                vec2 ca_dir = ca_delta / (ca_dist + 0.0001);
                
                float aberrationAmt = 0.02 * caStrength * u_intensity * u_ca_strength;
                vec2 r_offset = ca_dir * aberrationAmt * 0.5;
                vec2 b_offset = ca_dir * aberrationAmt * 1.0;
                
                r_offset.x /= aspect;
                b_offset.x /= aspect;
                
                vec4 colorR = texture2D(u_texture, newUV - r_offset);
                vec4 colorG = texture2D(u_texture, newUV);
                vec4 colorB = texture2D(u_texture, newUV + b_offset);
                
                vec4 color;
                color.r = colorR.b; // BGRA swizzle (common for captured frames)
                color.g = colorG.g;
                color.b = colorB.r;
                color.a = 1.0;
                
                // === 6. SCROLLBAR PRESERVATION ===
                float scrollbarWidth = 17.0;
                float distFromRightEdge = u_resolution.x - (uv.x * u_resolution.x);
                bool isScrollbar = distFromRightEdge < scrollbarWidth;
                
                // === 7. ROD VISION ===
                if (rodStrength > 0.0 && !isScrollbar) {
                    float eccentricity = max(0.0, dist - fovea_radius);
                    // Exponential saturation falloff (Steeper curve as requested)
                    // saturation = 1.0 - sqrt(dist)
                    float saturation = 1.0 - pow(dist, 0.5);
                    saturation = clamp(saturation, 0.0, 1.0);
                    
                    // Modulate by intensity
                    saturation = mix(1.0, saturation, u_intensity);
                    
                    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
                    
                    // Contrast boost (Magnocellular pathway style), scaled by intensity.
                    float contrast = 1.0 + (0.3 * u_intensity);
                    float boostedGray = (gray - 0.5) * contrast + 0.5;
                    boostedGray = clamp(boostedGray, 0.0, 1.0);
                    
                    // Add grain (neural noise / visual snow) to break smooth gradients.
                    float grain = rand(uv_corrected * 10.0) - 0.5; // -0.5 to 0.5
                    // Scale grain by intensity
                    boostedGray += grain * 0.15 * u_intensity; 
                    boostedGray = clamp(boostedGray, 0.0, 1.0);
                    
                    // Rod tint: Eigengrau / Cold Dark Blue
                    // Was: vec3(0.6, 0.9, 1.0) (Cyan)
                    // New: vec3(0.5, 0.6, 0.8) (Cold Blue)
                    vec3 rodTint = vec3(boostedGray * 0.5, boostedGray * 0.6, boostedGray * 0.8);
                    vec3 neutralGray = vec3(boostedGray);
                    
                    float tintStrength = (1.0 - gray) * 0.8 * u_intensity; 
                    vec3 finalRodColor = mix(neutralGray, rodTint, tintStrength);
                    
                    vec3 peripheryColor = mix(finalRodColor, color.rgb, saturation);
                    color.rgb = mix(color.rgb, peripheryColor, rodStrength);
                }
                
                // === 8. DEBUG BOUNDARY ===
                if (u_debug_boundary > 0.5) {
                    float lineThickness = 0.003;
                    float border = 1.0 - smoothstep(0.0, lineThickness, abs(dist - fovea_radius));
                    if (border > 0.0) {
                        vec3 lineColor = vec3(0.5, 0.5, 0.5);
                        float alpha = border * 0.6;
                        color.rgb = mix(color.rgb, lineColor, alpha);
                    }
                }
                
                // (Cleaned up junk comments)

        gl_FragColor = color;
    }
        `;

        this.program = this.createProgram(gl, vsSource, fsSource);

        // Look up locations
        this.positionLocation = gl.getAttribLocation(this.program, "a_position");
        this.texCoordLocation = gl.getAttribLocation(this.program, "a_texCoord");

        this.resolutionLocation = gl.getUniformLocation(this.program, "u_resolution");
        this.mouseLocation = gl.getUniformLocation(this.program, "u_mouse");
        this.foveaRadiusLocation = gl.getUniformLocation(this.program, "u_foveaRadius");
        this.pixelationLocation = gl.getUniformLocation(this.program, "u_pixelation");
        this.intensityLocation = gl.getUniformLocation(this.program, "u_intensity");
        this.caStrengthLocation = gl.getUniformLocation(this.program, "u_ca_strength");
        this.debugBoundaryLocation = gl.getUniformLocation(this.program, "u_debug_boundary");
        this.textureLocation = gl.getUniformLocation(this.program, "u_texture");

        // Create buffers
        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1,
            -1, 1, 1, -1, 1, 1,
        ]), gl.STATIC_DRAW);

        this.texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            0, 1, 1, 1, 0, 0,
            0, 0, 1, 1, 1, 0,
        ]), gl.STATIC_DRAW);

        // Create texture
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    }

    render(width, height, mouseX, mouseY, foveaRadius, intensity = 0.6, caStrength = 1.0, debugBoundary = 0.0) {
        if (!this.program) return;
        const gl = this.gl;

        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        gl.viewport(0, 0, width, height);

        gl.useProgram(this.program);

        gl.enableVertexAttribArray(this.positionLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

        gl.enableVertexAttribArray(this.texCoordLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.vertexAttribPointer(this.texCoordLocation, 2, gl.FLOAT, false, 0, 0);

        gl.uniform2f(this.resolutionLocation, width, height);
        gl.uniform2f(this.mouseLocation, mouseX, mouseY);
        gl.uniform1f(this.foveaRadiusLocation, foveaRadius);
        gl.uniform1f(this.pixelationLocation, 0.15 * intensity);
        gl.uniform1f(this.intensityLocation, intensity);
        gl.uniform1f(this.caStrengthLocation, caStrength);
        gl.uniform1f(this.debugBoundaryLocation, debugBoundary);
        gl.uniform1i(this.textureLocation, 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
}

// Export for CommonJS and Browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScrutinizerVisualizer;
} else {
    window.ScrutinizerVisualizer = ScrutinizerVisualizer;
}
