/**
 * WebGL Renderer for Scrutinizer
 * Implements GPU-accelerated foveal rendering with "Mongrel" receptive field simulation.
 */

class WebGLRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl', {
            alpha: false, // We don't need transparency on the main canvas
            antialias: false,
            preserveDrawingBuffer: false
        });

        if (!this.gl) {
            throw new Error('WebGL not supported');
        }

        this.program = null;
        this.texture = null;
        this.positionBuffer = null;
        this.texCoordBuffer = null;

        this.init();
        this.warmup(); // Pre-compile shader to avoid 20s lag on first real render
    }

    warmup() {
        // Create a tiny dummy texture and render it to force shader compilation
        // This eliminates the 20s GPU warmup lag on first real frame
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

        console.log('[WebGL] Shader warmup complete');
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

        // Fragment Shader - The "Mongrel"
        const fsSource = `
            precision mediump float;

            uniform sampler2D u_texture;
            uniform vec2 u_resolution;
            uniform vec2 u_mouse;
            uniform float u_foveaRadius;
            uniform float u_pixelation; // Base pixelation
            uniform float u_intensity;  // Global intensity multiplier (0.0 to 1.5)
            uniform float u_ca_strength; // Chromatic Aberration strength (0.0 or 1.0)

            varying vec2 v_texCoord;

            // Simplex 2D noise
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

            // Random function for Grain
            float rand(vec2 co){
                return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
            }

            void main() {
                // Normalize coordinates
                float aspect = u_resolution.x / u_resolution.y;
                vec2 uv = v_texCoord;
                vec2 uv_corrected = vec2(uv.x * aspect, uv.y);
                
                vec2 mouse_uv = u_mouse / u_resolution;
                vec2 mouse_corrected = vec2(mouse_uv.x * aspect, mouse_uv.y);
                
                // Calculate distance for Fovea Shape
                // User wants "roughly 16:9" (elliptical) shape
                vec2 delta = uv_corrected - mouse_corrected;
                // Squash X distance to make the shape wider (16:9 aspect = ~1.77)
                delta.x /= 1.77; 
                float dist = length(delta);

                float radius_norm = u_foveaRadius / u_resolution.y;
                // NO CLAMP: Allow radius to be larger than screen for "Disabled" state
                
                // Calculate Effect Strength (0.0 in Fovea, 1.0 in Periphery)
                // Smooth transition instead of hard cut
                float strength = smoothstep(radius_norm, radius_norm + 0.15, dist);
                
                // Scale strength by intensity (if intensity is 0, effect is 0)
                // But we want to keep the fovea clear regardless.
                // Actually, we want the *maximum* degradation to be scaled by intensity.
                
                
                // Domain Warping (Positional Uncertainty) - Multi-Octave
                // Biology: Receptive fields get LARGER as you move to periphery
                
                // High-frequency noise (fine detail destruction - "The Static")
                // Good for sidebar text, body copy
                float fineScale = 400.0;
                float n1_fine = snoise(uv_corrected * fineScale);
                float n2_fine = snoise(uv_corrected * fineScale + vec2(100.0, 100.0));
                // Scale displacement by intensity
                vec2 fineDisplacement = vec2(n1_fine, n2_fine) * 0.003 * strength * u_intensity;
                
                // Low-frequency noise (large feature destruction - "The Warper")
                // Good for destroying headlines, large text
                float coarseScale = 50.0;  // Much larger "waves"
                float n1_coarse = snoise(uv_corrected * coarseScale);
                float n2_coarse = snoise(uv_corrected * coarseScale + vec2(50.0, 50.0));
                
                // Scale coarse noise more aggressively in far periphery
                // smoothstep(0.4, 0.8, dist) = 0 near center, 1 at edges
                float coarseStrength = smoothstep(0.4, 0.8, dist);
                // Scale displacement by intensity
                vec2 coarseDisplacement = vec2(n1_coarse, n2_coarse) * 0.006 * strength * coarseStrength * u_intensity;
                
                // Combine: Fine noise everywhere, coarse noise only at edges
                vec2 displacement = fineDisplacement + coarseDisplacement;
                vec2 newUV = uv + displacement;
                
                // --- Chromatic Aberration (The Lens Split) ---
                // Calculate vector from fovea (mouse) to current pixel (uv_corrected)
                vec2 ca_delta = uv_corrected - mouse_corrected;
                float ca_dist = length(ca_delta);
                
                // Normalize direction
                vec2 ca_dir = ca_delta / (ca_dist + 0.0001); // Avoid divide by zero
                
                // Calculate Aberration Amount
                // Scales with distance from fovea AND intensity AND toggle
                // 0.015 is roughly 10-15 pixels on a 1080p screen
                float aberrationAmt = 0.015 * strength * u_intensity * u_ca_strength;
                
                // Calculate offsets
                // Red pulls IN (closer to mouse)
                vec2 r_offset = ca_dir * aberrationAmt * 0.5;
                // Blue pushes OUT (further from mouse) - Blue scatters more
                vec2 b_offset = ca_dir * aberrationAmt * 1.0;
                
                // Sample Channels Separately
                // We apply the displacement (noise) to all of them, THEN apply the chromatic shift
                // Note: We need to un-correct aspect ratio for the texture lookup if we used corrected coords for offset
                // But here 'displacement' is already in UV space.
                // Let's convert our offsets to UV space (divide X by aspect)
                r_offset.x /= aspect;
                b_offset.x /= aspect;
                
                vec4 colorR = texture2D(u_texture, newUV - r_offset);
                vec4 colorG = texture2D(u_texture, newUV); // Green is anchor
                vec4 colorB = texture2D(u_texture, newUV + b_offset);
                
                // Reassemble
                vec4 color = vec4(colorR.b, colorG.g, colorB.r, 1.0); // Note: Texture is BGRA, so R component is actually B?
                // Wait, texture2D returns what?
                // If the texture is uploaded as RGBA, it's RGBA.
                // But earlier code said: "SWIZZLE: Fix BGRA -> RGBA: color.rgb = color.bgr;"
                // This implies the source texture is BGRA (common in Electron/Skia).
                // So:
                // colorR.r is actually Blue? No.
                // If source is BGRA:
                // .r = Blue
                // .g = Green
                // .b = Red
                // .a = Alpha
                
                // We want:
                // Final Red Channel = Sampled Red (which is .b in BGRA source)
                // Final Green Channel = Sampled Green (which is .g in BGRA source)
                // Final Blue Channel = Sampled Blue (which is .r in BGRA source)
                
                color.r = colorR.b; // Red comes from the .b component of the Red-shifted sample
                color.g = colorG.g; // Green comes from the .g component of the Anchor sample
                color.b = colorB.r; // Blue comes from the .r component of the Blue-shifted sample
                color.a = 1.0;
                
                // Exclude scrollbar region (right edge, ~17px wide)
                // Keep scrollbar sharp and unaffected by peripheral effects
                float scrollbarWidth = 17.0;
                float distFromRightEdge = u_resolution.x - (uv.x * u_resolution.x);
                bool isScrollbar = distFromRightEdge < scrollbarWidth;
                
                // Rod Vision (Desaturation + Tint + Contrast + Grain)
                if (strength > 0.0 && !isScrollbar) {
                    // Exponential saturation falloff
                    float eccentricity = max(0.0, dist - radius_norm);
                    float saturation = exp(-3.0 * eccentricity);
                    // Scale saturation loss by intensity (higher intensity = less saturation)
                    // If intensity is 0, saturation should remain 1.0 (no loss)
                    // But our logic is inverted: saturation is 0.0 at periphery.
                    // Let's mix between original saturation and calculated saturation based on intensity.
                    saturation = mix(1.0, saturation, u_intensity);
                    saturation = max(0.0, saturation); 
                    
                    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
                    
                    // Contrast Boost (Magnocellular)
                    // Scale contrast boost by intensity
                    float contrast = 1.0 + (0.3 * u_intensity);
                    float boostedGray = (gray - 0.5) * contrast + 0.5;
                    boostedGray = clamp(boostedGray, 0.0, 1.0);
                    
                    // Add Grain (Neural Noise / Visual Snow)
                    // Mix in some random noise to break the "smoothness"
                    float grain = rand(uv_corrected * 10.0) - 0.5; // -0.5 to 0.5
                    // Scale grain by intensity
                    boostedGray += grain * 0.15 * u_intensity; 
                    boostedGray = clamp(boostedGray, 0.0, 1.0);
                    
                    // Rod Tint: Cyan-ish Grey
                    // Apply tint based on luminance: Darker = More Blue, Lighter = Neutral
                    vec3 rodTint = vec3(boostedGray * 0.6, boostedGray * 0.9, boostedGray * 1.0);
                    vec3 neutralGray = vec3(boostedGray);
                    
                    // Stronger tint in dark areas
                    float tintStrength = (1.0 - gray) * 0.8 * u_intensity; 
                    vec3 finalRodColor = mix(neutralGray, rodTint, tintStrength);
                    
                    // Mix based on strength and saturation
                    vec3 peripheryColor = mix(finalRodColor, color.rgb, saturation);
                    
                    // Then mix that with the pure original color based on strength
                    // If intensity is 0, we want strength to effectively be 0 for visual changes?
                    // No, strength is spatial. u_intensity is magnitude.
                    // If u_intensity is 0, displacement is 0, grain is 0, saturation is 1.0.
                    // So peripheryColor == color.rgb.
                    // So this mix is fine.
                    color.rgb = mix(color.rgb, peripheryColor, strength);
                }
                
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
        this.textureLocation = gl.getUniformLocation(this.program, "u_texture");

        console.log('[WebGL] Uniform Locations:', {
            resolution: this.resolutionLocation,
            mouse: this.mouseLocation,
            radius: this.foveaRadiusLocation,
            pixelation: this.pixelationLocation,
            intensity: this.intensityLocation,
            caStrength: this.caStrengthLocation,
            texture: this.textureLocation
        });

        // Create buffers
        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        // Full screen quad (2 triangles)
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
        // Texture coordinates (0..1)
        // Note: WebGL 0,0 is bottom-left. Images are usually top-down.
        // We flip Y here to match standard image coordinates
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
        // Set parameters so we can render any size image
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

    /**
     * Upload frame data to GPU
     * @param {ImageData|HTMLImageElement|ImageBitmap} image 
     */
    uploadTexture(image) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        // texImage2D is fast for ImageBitmap (Zero-copy if lucky)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    }

    /**
     * Render the frame
     * @param {number} width Canvas width
     * @param {number} height Canvas height
     * @param {number} mouseX Mouse X (0..width)
     * @param {number} mouseY Mouse Y (0..height)
     * @param {number} foveaRadius Radius in pixels
     * @param {number} intensity Intensity multiplier (0.0 to 1.5)
     * @param {number} caStrength Chromatic Aberration strength (0.0 or 1.0)
     */
    render(width, height, mouseX, mouseY, foveaRadius, intensity = 0.6, caStrength = 1.0) {
        if (!this.program) return;
        const gl = this.gl;

        // Resize canvas if needed
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        // Update viewport to match canvas size
        gl.viewport(0, 0, width, height);

        gl.useProgram(this.program);

        // Bind buffers
        gl.enableVertexAttribArray(this.positionLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

        gl.enableVertexAttribArray(this.texCoordLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.vertexAttribPointer(this.texCoordLocation, 2, gl.FLOAT, false, 0, 0);

        // Set uniforms
        // console.log(`[WebGL] Render: Res(${width},${height}) Mouse(${mouseX},${mouseY}) Rad(${foveaRadius})`);
        gl.uniform2f(this.resolutionLocation, width, height);
        gl.uniform2f(this.mouseLocation, mouseX, mouseY);
        gl.uniform1f(this.foveaRadiusLocation, foveaRadius);
        gl.uniform1f(this.pixelationLocation, 0.05 * intensity); // Scale pixelation by intensity
        gl.uniform1f(this.intensityLocation, intensity);
        gl.uniform1f(this.caStrengthLocation, caStrength);
        gl.uniform1i(this.textureLocation, 0);

        // Draw
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
}

// Export for usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebGLRenderer;
} else {
    window.WebGLRenderer = WebGLRenderer;
}
