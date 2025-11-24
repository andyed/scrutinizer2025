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
            uniform float u_pixelation; // Controls how fast cells grow

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
                
                
                // Domain Warping (Positional Uncertainty) - Multi-Octave
                // Biology: Receptive fields get LARGER as you move to periphery
                
                // High-frequency noise (fine detail destruction - "The Static")
                // Good for sidebar text, body copy
                float fineScale = 400.0;
                float n1_fine = snoise(uv_corrected * fineScale);
                float n2_fine = snoise(uv_corrected * fineScale + vec2(100.0, 100.0));
                vec2 fineDisplacement = vec2(n1_fine, n2_fine) * 0.003 * strength;
                
                // Low-frequency noise (large feature destruction - "The Warper")
                // Good for destroying headlines, large text
                float coarseScale = 50.0;  // Much larger "waves"
                float n1_coarse = snoise(uv_corrected * coarseScale);
                float n2_coarse = snoise(uv_corrected * coarseScale + vec2(50.0, 50.0));
                
                // Scale coarse noise more aggressively in far periphery
                // smoothstep(0.4, 0.8, dist) = 0 near center, 1 at edges
                float coarseStrength = smoothstep(0.4, 0.8, dist);
                vec2 coarseDisplacement = vec2(n1_coarse, n2_coarse) * 0.006 * strength * coarseStrength;
                
                // Combine: Fine noise everywhere, coarse noise only at edges
                vec2 displacement = fineDisplacement + coarseDisplacement;
                vec2 newUV = uv + displacement;
                
                // Sample texture at warped location
                vec4 color = texture2D(u_texture, newUV);
                
                // SWIZZLE: Fix BGRA -> RGBA
                color.rgb = color.bgr;
                
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
                    saturation = max(0.0, saturation); // Allow full desaturation
                    
                    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
                    
                    // Contrast Boost (Magnocellular)
                    float contrast = 1.3;
                    float boostedGray = (gray - 0.5) * contrast + 0.5;
                    boostedGray = clamp(boostedGray, 0.0, 1.0);
                    
                    // Add Grain (Neural Noise / Visual Snow)
                    // Mix in some random noise to break the "smoothness"
                    float grain = rand(uv_corrected * 10.0) - 0.5; // -0.5 to 0.5
                    boostedGray += grain * 0.15; // 15% grain strength
                    boostedGray = clamp(boostedGray, 0.0, 1.0);
                    
                    // Rod Tint: Cyan-ish Grey
                    // Apply tint based on luminance: Darker = More Blue, Lighter = Neutral
                    vec3 rodTint = vec3(boostedGray * 0.6, boostedGray * 0.9, boostedGray * 1.0);
                    vec3 neutralGray = vec3(boostedGray);
                    
                    // Stronger tint in dark areas
                    float tintStrength = (1.0 - gray) * 0.8; 
                    vec3 finalRodColor = mix(neutralGray, rodTint, tintStrength);
                    
                    // Mix based on strength and saturation
                    vec3 peripheryColor = mix(finalRodColor, color.rgb, saturation);
                    
                    // Then mix that with the pure original color based on strength
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
        this.textureLocation = gl.getUniformLocation(this.program, "u_texture");

        console.log('[WebGL] Uniform Locations:', {
            resolution: this.resolutionLocation,
            mouse: this.mouseLocation,
            radius: this.foveaRadiusLocation,
            pixelation: this.pixelationLocation,
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
     */
    render(width, height, mouseX, mouseY, foveaRadius) {
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
        gl.uniform1f(this.pixelationLocation, 0.05); // Configurable?
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
