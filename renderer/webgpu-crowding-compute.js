/**
 * WebGPU Crowding Compute — Tier 2.5
 * Two-pass pipeline: stats extraction → metamer synthesis.
 * Produces a texture that the WebGL fragment shader samples for
 * peripheral rendering when compute_tier > 2.0.
 *
 * Architecture: WebGPU compute runs independently of WebGL.
 * Source frame is uploaded to a WebGPU texture, compute runs two
 * passes, readback copies result to a Uint8Array, which is then
 * uploaded to WebGL TEXTURE5 via texImage2D.
 */

const fs = require('fs');
const path = require('path');

const TILE_SIZE = 8;           // 8x8 workgroup = 1 tile
const FRAME_INTERVAL = 2;     // Run every 2nd frame
const CONFIG_SIZE = 64;        // 16 floats × 4 bytes
const TEMPORAL_SMOOTHING = 0.3; // EMA blend factor (0=frozen, 1=no smoothing)

class WebGPUCrowdingCompute {
    /**
     * @param {GPUDevice} device
     * @param {number} width - half-resolution width
     * @param {number} height - half-resolution height
     */
    constructor(device, width, height) {
        this.device = device;
        this.width = width;
        this.height = height;
        this.frameCounter = 0;
        this._destroyed = false;

        this.tileCountX = Math.ceil(width / TILE_SIZE);
        this.tileCountY = Math.ceil(height / TILE_SIZE);
        this.totalTiles = this.tileCountX * this.tileCountY;
        this.totalPixels = width * height;

        // Load WGSL shaders from disk
        const shadersDir = path.join(__dirname, 'shaders');
        this.statsCode = fs.readFileSync(path.join(shadersDir, 'crowding-stats.wgsl'), 'utf8');
        this.synthCode = fs.readFileSync(path.join(shadersDir, 'crowding-synth.wgsl'), 'utf8');

        this._createBuffers();
        this._createTexture();
        this._createPipelines();

        // Readback state
        this._readbackPending = false;
        this._lastResult = null;

        console.log(`[WebGPU Crowding] Init: ${width}x${height}, ${this.totalTiles} tiles (${this.tileCountX}x${this.tileCountY})`);
    }

    // --- Factory helpers (matching liquid-light-warp pattern) ---

    _bgl(entries) {
        return this.device.createBindGroupLayout({ entries });
    }

    _pl(layout) {
        return this.device.createPipelineLayout({ bindGroupLayouts: [layout] });
    }

    _cp(code, layout) {
        return this.device.createComputePipeline({
            layout: this._pl(layout),
            compute: {
                module: this.device.createShaderModule({ code }),
                entryPoint: 'main',
            },
        });
    }

    _createBuffers() {
        // Config uniform buffer (shared by both passes)
        this.configBuffer = this.device.createBuffer({
            size: CONFIG_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Stats storage buffers: 48 bytes per tile (12 floats)
        // Double-buffered for temporal smoothing — prev frame's stats
        // are read during current frame's stats pass to apply EMA.
        const statsSize = this.totalTiles * 48;
        this.statsBuffer = this.device.createBuffer({
            size: statsSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        this.prevStatsBuffer = this.device.createBuffer({
            size: statsSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        // Output storage buffer: 4 bytes per pixel (RGBA8 packed as u32)
        const outputSize = this.totalPixels * 4;
        this.outputBuffer = this.device.createBuffer({
            size: outputSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });

        // Readback buffer (MAP_READ)
        this.readbackBuffer = this.device.createBuffer({
            size: outputSize,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
    }

    _createTexture() {
        // Source texture: half-res frame uploaded from CPU
        this.sourceTexture = this.device.createTexture({
            size: [this.width, this.height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
    }

    _createPipelines() {
        // --- Pass 1: Stats (with temporal smoothing via prev frame) ---
        this.statsBGL = this._bgl([
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        ]);
        this.statsPipeline = this._cp(this.statsCode, this.statsBGL);
        this.statsBindGroup = this.device.createBindGroup({
            layout: this.statsBGL,
            entries: [
                { binding: 0, resource: { buffer: this.configBuffer } },
                { binding: 1, resource: this.sourceTexture.createView() },
                { binding: 2, resource: { buffer: this.statsBuffer } },
                { binding: 3, resource: { buffer: this.prevStatsBuffer } },
            ],
        });

        // --- Pass 2: Synth ---
        this.synthBGL = this._bgl([
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        ]);
        this.synthPipeline = this._cp(this.synthCode, this.synthBGL);
        this.synthBindGroup = this.device.createBindGroup({
            layout: this.synthBGL,
            entries: [
                { binding: 0, resource: { buffer: this.configBuffer } },
                { binding: 1, resource: { buffer: this.statsBuffer } },
                { binding: 2, resource: { buffer: this.outputBuffer } },
            ],
        });
    }

    /**
     * Should we compute this frame? Skips every other frame.
     */
    shouldCompute() {
        if (this._destroyed) return false;
        this.frameCounter++;
        return (this.frameCounter % FRAME_INTERVAL) === 0;
    }

    /**
     * Upload source frame and update config uniforms.
     * @param {Uint8Array} rgba - RGBA pixel data at half resolution
     * @param {number} foveaX - gaze X in half-res coordinates
     * @param {number} foveaY - gaze Y in half-res coordinates
     * @param {number} foveaRadius - foveal radius in half-res pixels
     * @param {{ cmf_a: number, ecc_scaling: number }} cmfConfig
     * @param {number} corticalMax - precomputed ln(r_max/a + 1)
     * @param {number} foveaAspectRatio - elliptical fovea shape (default 1.33)
     */
    uploadAndConfigure(rgba, foveaX, foveaY, foveaRadius, cmfConfig, corticalMax, foveaAspectRatio = 1.33) {
        if (this._destroyed) return;

        // Upload source texture
        this.device.queue.writeTexture(
            { texture: this.sourceTexture },
            rgba,
            { bytesPerRow: this.width * 4, rowsPerImage: this.height },
            [this.width, this.height],
        );

        // Update config uniform (16 floats = 64 bytes)
        const aspect = this.width / this.height;
        const config = new Float32Array([
            this.width,           // width (as float, overwritten as u32 below)
            this.height,          // height
            TILE_SIZE,            // tile_size
            this.tileCountX,      // tile_count_x
            this.tileCountY,      // tile_count_y
            foveaX,               // fovea_x
            foveaY,               // fovea_y
            foveaRadius,          // fovea_radius
            cmfConfig.cmf_a || 2.78,
            corticalMax,
            cmfConfig.ecc_scaling || 0.75,
            aspect,               // screen aspect ratio (w/h)
            foveaAspectRatio,     // elliptical fovea shape
            TEMPORAL_SMOOTHING,   // temporal_blend (EMA alpha)
            0.0,                  // _pad2
            0.0,                  // _pad3
        ]);
        // Config struct uses u32 for first 5 fields — reinterpret as u32
        const configU32 = new Uint32Array(config.buffer);
        configU32[0] = this.width;
        configU32[1] = this.height;
        configU32[2] = TILE_SIZE;
        configU32[3] = this.tileCountX;
        configU32[4] = this.tileCountY;

        this.device.queue.writeBuffer(this.configBuffer, 0, config);
    }

    /**
     * Dispatch both compute passes and copy to readback buffer.
     * Skips the copy if a readback is still pending (buffer still mapped).
     */
    dispatch() {
        if (this._destroyed) return;

        const encoder = this.device.createCommandEncoder();

        // Pass 1: Stats — one workgroup per tile
        const statsPass = encoder.beginComputePass();
        statsPass.setPipeline(this.statsPipeline);
        statsPass.setBindGroup(0, this.statsBindGroup);
        statsPass.dispatchWorkgroups(this.tileCountX, this.tileCountY);
        statsPass.end();

        // Pass 2: Synth — one workgroup per 8x8 pixel block
        const synthWgX = Math.ceil(this.width / 8);
        const synthWgY = Math.ceil(this.height / 8);
        const synthPass = encoder.beginComputePass();
        synthPass.setPipeline(this.synthPipeline);
        synthPass.setBindGroup(0, this.synthBindGroup);
        synthPass.dispatchWorkgroups(synthWgX, synthWgY);
        synthPass.end();

        // Copy current stats to prev for next frame's temporal smoothing
        const statsSize = this.totalTiles * 48;
        encoder.copyBufferToBuffer(this.statsBuffer, 0, this.prevStatsBuffer, 0, statsSize);

        // Only copy to readback buffer if it's not currently mapped
        if (!this._readbackPending) {
            const outputSize = this.totalPixels * 4;
            encoder.copyBufferToBuffer(this.outputBuffer, 0, this.readbackBuffer, 0, outputSize);
            this._dispatchedCopy = true;
        } else {
            this._dispatchedCopy = false;
        }

        this.device.queue.submit([encoder.finish()]);
    }

    /**
     * Async readback. Returns Uint8Array of RGBA pixels, or null if unavailable.
     * Only reads if a fresh copy was dispatched.
     */
    async readback() {
        if (this._destroyed || this._readbackPending || !this._dispatchedCopy) {
            return this._lastResult;
        }

        this._readbackPending = true;
        try {
            await this.readbackBuffer.mapAsync(GPUMapMode.READ);
            const mapped = new Uint8Array(this.readbackBuffer.getMappedRange());
            // Copy out before unmapping
            const result = new Uint8Array(mapped.length);
            result.set(mapped);
            this.readbackBuffer.unmap();
            this._lastResult = result;
        } catch (e) {
            // Device may have been lost during readback
            console.warn('[WebGPU Crowding] Readback failed:', e.message);
            this._lastResult = null;
        }
        this._readbackPending = false;
        this._dispatchedCopy = false;
        return this._lastResult;
    }

    /**
     * Resize for new frame dimensions.
     */
    resize(width, height) {
        if (width === this.width && height === this.height) return;
        this.destroy();
        this._destroyed = false;

        this.width = width;
        this.height = height;
        this.tileCountX = Math.ceil(width / TILE_SIZE);
        this.tileCountY = Math.ceil(height / TILE_SIZE);
        this.totalTiles = this.tileCountX * this.tileCountY;
        this.totalPixels = width * height;

        this._createBuffers();
        this._createTexture();
        this._createPipelines();

        console.log(`[WebGPU Crowding] Resized: ${width}x${height}`);
    }

    /**
     * Clean up all GPU resources.
     */
    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;

        this.configBuffer?.destroy();
        this.statsBuffer?.destroy();
        this.prevStatsBuffer?.destroy();
        this.outputBuffer?.destroy();
        this.readbackBuffer?.destroy();
        this.sourceTexture?.destroy();

        this.configBuffer = null;
        this.statsBuffer = null;
        this.prevStatsBuffer = null;
        this.outputBuffer = null;
        this.readbackBuffer = null;
        this.sourceTexture = null;

        console.log('[WebGPU Crowding] Destroyed');
    }
}

module.exports = { WebGPUCrowdingCompute };
