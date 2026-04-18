/**
 * WebGPU Pyramid Compute — Tier 2.75
 *
 * Laplacian pyramid decomposition via WebGPU compute shaders.
 * Decomposes a half-resolution source frame into 4 frequency bands + residual.
 *
 * Architecture:
 *   1. to_luminance: RGBA8 texture → f32 luminance buffer (level 0)
 *   2. For k = 0..3:
 *      a. blur_downsample(level[k]) → level[k+1]
 *      b. compute_band(level[k], level[k+1]) → band[k]
 *   3. Residual = level[4] (lowest frequency content)
 *
 * Output: 4 band buffers + 1 residual buffer, ready for pyramid-stats extraction.
 *
 * Memory layout:
 *   level[0]: W × H          (source luminance)
 *   level[1]: W/2 × H/2
 *   level[2]: W/4 × H/4
 *   level[3]: W/8 × H/8
 *   level[4]: W/16 × H/16    (residual)
 *   band[0..3]: same dims as level[0..3]
 */

const fs = require('fs');
const path = require('path');

const PYRAMID_LEVELS = 4;
const CONFIG_SIZE = 16; // 4 u32s = 16 bytes (decompose config)
const STATS_CONFIG_SIZE = 96; // 24 u32s = 96 bytes (stats config, extended for sectors)
const SYNTH_CONFIG_SIZE = 80; // 20 f32s = 80 bytes (synth config, extended for sectors)
const TILE_SIZE = 8;
const ACCUM_STRIDE = 24; // i32s per tile in accumulator (includes skewness: sum x³ at offsets 19-22)
const STATS_STRIDE = 18; // floats per tile in TileStatsTier3 (includes skew0-3)
const FRAME_INTERVAL = 2; // compute every Nth frame (matches Tier 2.5)
const CMF_A = 2.78; // cortical magnification constant (Blauch et al. 2026)

class WebGPUPyramidCompute {
    /**
     * @param {GPUDevice} device
     * @param {number} width  — half-resolution width (from crowding compute)
     * @param {number} height — half-resolution height
     */
    /**
     * @param {GPUDevice} device
     * @param {number} width  — half-resolution width (from crowding compute)
     * @param {number} height — half-resolution height
     * @param {{ numRings: number, cmfA: number, maxEccDeg: number }|null} sectorConfig
     *   When non-null, uses CMF-based sector binning instead of fixed 8x8 tiles.
     *   Sectors scale with eccentricity (Blauch et al. 2026) — small foveal,
     *   large peripheral — so tile means in far periphery naturally destroy content.
     */
    constructor(device, width, height, sectorConfig = null) {
        this.device = device;
        this.width = width;
        this.height = height;
        this._destroyed = false;
        this.frameCounter = 0;
        this._synthSeed = 42; // stable seed, only changes on explicit resynth

        // Load shaders
        const shaderPath = path.join(__dirname, 'shaders', 'pyramid-decompose.wgsl');
        this.shaderCode = fs.readFileSync(shaderPath, 'utf8');
        const statsShaderPath = path.join(__dirname, 'shaders', 'pyramid-stats.wgsl');
        this.statsShaderCode = fs.readFileSync(statsShaderPath, 'utf8');
        const synthShaderPath = path.join(__dirname, 'shaders', 'pyramid-synth.wgsl');
        this.synthShaderCode = fs.readFileSync(synthShaderPath, 'utf8');

        // Compute level dimensions
        this.levels = [];
        let w = width, h = height;
        for (let k = 0; k <= PYRAMID_LEVELS; k++) {
            this.levels.push({ width: w, height: h, pixels: w * h });
            w = Math.floor(w / 2);
            h = Math.floor(h / 2);
        }

        // Tile grid dimensions (at band_0 resolution) — always computed for fallback
        this.tileCountX = Math.ceil(width / TILE_SIZE);
        this.tileCountY = Math.ceil(height / TILE_SIZE);
        this.totalTiles = this.tileCountX * this.tileCountY;

        // Sector mode: CMF-based eccentricity-scaled pooling regions
        this.useSectors = !!sectorConfig;
        if (this.useSectors) {
            this.numRings = sectorConfig.numRings || 50;
            this.cmfA = sectorConfig.cmfA || CMF_A;
            this.maxEccDeg = sectorConfig.maxEccDeg || 15;
            this.corticalMax = Math.log(this.maxEccDeg / this.cmfA + 1);
            this._computeSectorLayout();
        } else {
            this.numRings = 0;
            this.totalSectors = 0;
        }
        this.totalSlots = this.useSectors ? this.totalSectors : this.totalTiles;

        this._createResources();
        this._createPipelines();
        this._createStatsPipelines();
        this._createSynthPipelines();

        const totalBytes = this._totalMemoryBytes();
        const modeStr = this.useSectors
            ? `sectors (${this.numRings} rings, ${this.totalSectors} sectors)`
            : `tiles (${this.tileCountX}x${this.tileCountY})`;
        console.log(`[WebGPU Pyramid] Init: ${width}x${height}, ${PYRAMID_LEVELS} levels, ` +
                    `${modeStr}, ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
    }

    /**
     * Compute sector layout from CMF parameters (Blauch et al. 2026).
     * Produces ringBaseSectors[] (prefix sum) and ringSpokeCount[] arrays.
     * Canonical reference: tests/unit/isotropic-sectors.test.js:27-70
     */
    _computeSectorLayout() {
        const a = this.cmfA;
        const N = Math.max(this.numRings, 2);
        const wMin = Math.log(a);
        const wStep = this.corticalMax / (N - 1);

        this.ringSpokeCount = new Uint32Array(N);
        this.ringBaseSectors = new Uint32Array(N);

        let totalSectors = 0;
        for (let n = 0; n < N; n++) {
            const wI = wMin + n * wStep;
            const rI = Math.exp(wI) - a;

            let dr;
            if (n === 0) {
                dr = Math.exp(wMin + wStep) - Math.exp(wMin);
            } else if (n === N - 1) {
                dr = Math.exp(wMin + (N - 1) * wStep) - Math.exp(wMin + (N - 2) * wStep);
            } else {
                dr = (Math.exp(wMin + (n + 1) * wStep) - Math.exp(wMin + (n - 1) * wStep)) / 2;
            }

            const spokeCount = n === 0 ? 1 : Math.max(1, Math.floor(2 * Math.PI * rI / dr));
            this.ringBaseSectors[n] = totalSectors;
            this.ringSpokeCount[n] = spokeCount;
            totalSectors += spokeCount;
        }

        this.totalSectors = totalSectors;
    }

    _totalMemoryBytes() {
        let total = 0;
        // Level buffers (f32 per pixel)
        for (const lv of this.levels) total += lv.pixels * 4;
        // Band buffers (f32 per pixel, levels 0..3)
        for (let k = 0; k < PYRAMID_LEVELS; k++) total += this.levels[k].pixels * 4;
        return total;
    }

    _createResources() {
        // Source texture (shared with crowding compute — uploaded from CPU)
        this.sourceTexture = this.device.createTexture({
            size: [this.width, this.height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });

        // Level buffers: f32 per pixel at each resolution
        this.levelBuffers = [];
        for (let k = 0; k <= PYRAMID_LEVELS; k++) {
            const size = this.levels[k].pixels * 4;
            this.levelBuffers.push(this.device.createBuffer({
                size: Math.max(size, 16), // minimum 16 bytes
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
            }));
        }

        // Band buffers: f32 per pixel at levels 0..3
        this.bandBuffers = [];
        for (let k = 0; k < PYRAMID_LEVELS; k++) {
            const size = this.levels[k].pixels * 4;
            this.bandBuffers.push(this.device.createBuffer({
                size: Math.max(size, 16),
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
            }));
        }

        // Config uniform buffers (one per dispatch, since dimensions change)
        this.configBuffers = [];
        for (let i = 0; i < PYRAMID_LEVELS + 1; i++) {
            this.configBuffers.push(this.device.createBuffer({
                size: CONFIG_SIZE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            }));
        }

        // Stats accumulator buffer: ACCUM_STRIDE i32s per slot (tile or sector)
        const accumSize = this.totalSlots * ACCUM_STRIDE * 4;
        this.accumBuffer = this.device.createBuffer({
            size: Math.max(accumSize, 16),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, // COPY_DST for zeroing
        });

        // Stats output buffer: STATS_STRIDE f32s per slot (TileStatsTier3)
        const statsSize = this.totalSlots * STATS_STRIDE * 4;
        this.statsBuffer = this.device.createBuffer({
            size: Math.max(statsSize, 16),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });

        // Stats config buffer
        this.statsConfigBuffer = this.device.createBuffer({
            size: STATS_CONFIG_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Stats readback buffer
        this.statsReadbackBuffer = this.device.createBuffer({
            size: Math.max(statsSize, 16),
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        // Sector lookup buffers (CMF ring→sector mapping for WGSL shaders)
        if (this.useSectors) {
            this.sectorRingBaseBuffer = this.device.createBuffer({
                size: this.numRings * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            this.sectorSpokeCountBuffer = this.device.createBuffer({
                size: this.numRings * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            // Upload precomputed arrays
            this.device.queue.writeBuffer(this.sectorRingBaseBuffer, 0, this.ringBaseSectors);
            this.device.queue.writeBuffer(this.sectorSpokeCountBuffer, 0, this.ringSpokeCount);
        } else {
            // Dummy buffers for non-sector mode (simpler than dual BGLs)
            this.sectorRingBaseBuffer = this.device.createBuffer({
                size: 16,
                usage: GPUBufferUsage.STORAGE,
            });
            this.sectorSpokeCountBuffer = this.device.createBuffer({
                size: 16,
                usage: GPUBufferUsage.STORAGE,
            });
        }

        // Synthesis: 4 noise band buffers (all at band_0 resolution for simplicity)
        const noisePixels = this.levels[0].pixels;
        this.noiseBuffers = [];
        for (let k = 0; k < PYRAMID_LEVELS; k++) {
            this.noiseBuffers.push(this.device.createBuffer({
                size: Math.max(noisePixels * 4, 16),
                usage: GPUBufferUsage.STORAGE,
            }));
        }

        // Synthesis output buffer: RGBA8 packed as u32 (same as Tier 2.5)
        this.synthOutputBuffer = this.device.createBuffer({
            size: Math.max(noisePixels * 4, 16),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });

        // Synthesis config buffer
        this.synthConfigBuffer = this.device.createBuffer({
            size: SYNTH_CONFIG_SIZE, // 20 f32s = 80 bytes (extended for sectors)
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Synthesis output readback
        this.synthReadbackBuffer = this.device.createBuffer({
            size: Math.max(noisePixels * 4, 16),
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        // Readback buffers for band data (for validation / debug viz)
        this.bandReadbackBuffers = [];
        for (let k = 0; k < PYRAMID_LEVELS; k++) {
            const size = this.levels[k].pixels * 4;
            this.bandReadbackBuffers.push(this.device.createBuffer({
                size: Math.max(size, 16),
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            }));
        }
        // Residual readback
        const resSize = this.levels[PYRAMID_LEVELS].pixels * 4;
        this.residualReadbackBuffer = this.device.createBuffer({
            size: Math.max(resSize, 16),
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
    }

    _createPipelines() {
        const module = this.device.createShaderModule({ code: this.shaderCode });

        // Pipeline 1: to_luminance
        // Bindings: config (uniform), source_tex (texture), dst (storage)
        this.luminanceBGL = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        this.luminancePipeline = this.device.createComputePipeline({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.luminanceBGL] }),
            compute: { module, entryPoint: 'to_luminance' },
        });

        // Pipeline 2: blur_downsample
        // Bindings: config (uniform), src (read-only storage), dst (storage)
        this.blurDownBGL = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        this.blurDownPipeline = this.device.createComputePipeline({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.blurDownBGL] }),
            compute: { module, entryPoint: 'blur_downsample' },
        });

        // Pipeline 3: compute_band
        // Bindings: config (uniform), level_k (read), level_k1 (read), band (storage)
        this.bandBGL = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        this.bandPipeline = this.device.createComputePipeline({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.bandBGL] }),
            compute: { module, entryPoint: 'compute_band' },
        });
    }

    _createStatsPipelines() {
        const module = this.device.createShaderModule({ code: this.statsShaderCode });

        // Accumulate pass: config, band0-3, source_tex, accum, sector_ring_base, sector_spoke_count
        this.accumBGL = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
                { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            ],
        });
        this.accumPipeline = this.device.createComputePipeline({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.accumBGL] }),
            compute: { module, entryPoint: 'accumulate' },
        });

        // Finalize pass: config, accum (read-only), tile_stats (storage)
        this.finalizeBGL = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        this.finalizePipeline = this.device.createComputePipeline({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.finalizeBGL] }),
            compute: { module, entryPoint: 'finalize' },
        });
    }

    _createSynthPipelines() {
        // Push a validation error scope so any BGL / pipeline failure is
        // captured synchronously during construction instead of being
        // swallowed by the device's `uncapturederror` event. The root cause
        // of the silent MIP-fallback bug (see docs/radial-ttm-fix-plan.md)
        // was precisely that `reconBGL` creation failed silently with
        // 9 storage bindings under WebGPU's default 8-binding limit.
        this.device.pushErrorScope('validation');

        const module = this.device.createShaderModule({ code: this.synthShaderCode });

        // seed_noise: config, noise0-3 (read_write)
        this.seedBGL = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        this.seedPipeline = this.device.createComputePipeline({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.seedBGL] }),
            compute: { module, entryPoint: 'seed_noise' },
        });

        // match_stats: config, stats (read), noise0-3 (read_write), sector_ring_base, sector_spoke_count
        this.matchBGL = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            ],
        });
        this.matchPipeline = this.device.createComputePipeline({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.matchBGL] }),
            compute: { module, entryPoint: 'match_stats' },
        });

        // reconstruct: config, noise0-3 (read), residual (read), stats (read), source_tex, output, sector bufs
        this.reconBGL = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 7, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
                { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            ],
        });
        this.reconPipeline = this.device.createComputePipeline({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.reconBGL] }),
            compute: { module, entryPoint: 'reconstruct' },
        });

        // Pop validation error scope. popErrorScope returns a promise that
        // resolves to the first captured error (or null if none). Stash it
        // for isPipelineHealthy() — the caller can await + branch on it to
        // degrade mode 15 to Tier 2.5 instead of rendering zeros silently.
        this._synthHealthPromise = this.device.popErrorScope();
    }

    /**
     * Returns a promise that resolves to { healthy: boolean, error: GPUError|null }.
     * Call this after construction — if healthy is false, the synth pipeline
     * (including reconBGL, the 9-binding pipeline under the WebGPU default
     * 8-limit) failed validation. Caller should degrade compute_tier to
     * 2.5 (pyramid mongrel) or lower and surface a warning to the user
     * rather than silently rendering the MIP fallback.
     */
    async isPipelineHealthy() {
        if (!this._synthHealthPromise) return { healthy: true, error: null };
        const error = await this._synthHealthPromise;
        return { healthy: !error, error };
    }

    /**
     * Write config uniform for a given dispatch.
     * @param {number} configIndex — which config buffer to use
     * @param {number} srcW — source width
     * @param {number} srcH — source height
     * @param {number} dstW — destination width
     * @param {number} dstH — destination height
     */
    _writeConfig(configIndex, srcW, srcH, dstW, dstH) {
        const data = new Uint32Array([srcW, srcH, dstW, dstH]);
        this.device.queue.writeBuffer(this.configBuffers[configIndex], 0, data);
    }

    /**
     * Should we compute this frame? Skips every other frame (matches Tier 2.5).
     */
    shouldCompute() {
        if (this._destroyed) return false;
        this.frameCounter++;
        return (this.frameCounter % FRAME_INTERVAL) === 0;
    }

    /**
     * Upload source frame and run full pipeline: decompose → stats → synthesize.
     * @param {Uint8Array} rgba — RGBA pixel data at half resolution
     * @param {number} foveaX — gaze X (0-1 normalized)
     * @param {number} foveaY — gaze Y (0-1 normalized)
     * @param {number} foveaRadius — foveal radius in pixels
     * @param {number} [synthIterations=2] — number of stat-matching iterations
     */
    compute(rgba, foveaX = 0.5, foveaY = 0.5, foveaRadius = 45, synthIterations = 2) {
        if (this._destroyed) return;

        // Upload source texture
        this.device.queue.writeTexture(
            { texture: this.sourceTexture },
            rgba,
            { bytesPerRow: this.width * 4, rowsPerImage: this.height },
            [this.width, this.height],
        );

        const encoder = this.device.createCommandEncoder();

        // Step 1: Convert RGBA → luminance into level[0]
        this._writeConfig(0, this.width, this.height, 0, 0);
        const lumBG = this.device.createBindGroup({
            layout: this.luminanceBGL,
            entries: [
                { binding: 0, resource: { buffer: this.configBuffers[0] } },
                { binding: 1, resource: this.sourceTexture.createView() },
                { binding: 2, resource: { buffer: this.levelBuffers[0] } },
            ],
        });
        const lumPass = encoder.beginComputePass();
        lumPass.setPipeline(this.luminancePipeline);
        lumPass.setBindGroup(0, lumBG);
        lumPass.dispatchWorkgroups(
            Math.ceil(this.width / 16),
            Math.ceil(this.height / 16),
        );
        lumPass.end();

        // Steps 2-3: For each level, blur+downsample then compute band
        for (let k = 0; k < PYRAMID_LEVELS; k++) {
            const srcLevel = this.levels[k];
            const dstLevel = this.levels[k + 1];

            // 2a. Blur + downsample: level[k] → level[k+1]
            this._writeConfig(k + 1, srcLevel.width, srcLevel.height,
                              dstLevel.width, dstLevel.height);

            const bdBG = this.device.createBindGroup({
                layout: this.blurDownBGL,
                entries: [
                    { binding: 0, resource: { buffer: this.configBuffers[k + 1] } },
                    { binding: 1, resource: { buffer: this.levelBuffers[k] } },
                    { binding: 2, resource: { buffer: this.levelBuffers[k + 1] } },
                ],
            });
            const bdPass = encoder.beginComputePass();
            bdPass.setPipeline(this.blurDownPipeline);
            bdPass.setBindGroup(0, bdBG);
            bdPass.dispatchWorkgroups(
                Math.ceil(dstLevel.width / 16),
                Math.ceil(dstLevel.height / 16),
            );
            bdPass.end();

            // 2b. Compute band: level[k] - upsample(level[k+1]) → band[k]
            // Reuse config from step 2a (same src/dst dimensions)
            const cbBG = this.device.createBindGroup({
                layout: this.bandBGL,
                entries: [
                    { binding: 0, resource: { buffer: this.configBuffers[k + 1] } },
                    { binding: 1, resource: { buffer: this.levelBuffers[k] } },
                    { binding: 2, resource: { buffer: this.levelBuffers[k + 1] } },
                    { binding: 3, resource: { buffer: this.bandBuffers[k] } },
                ],
            });
            const cbPass = encoder.beginComputePass();
            cbPass.setPipeline(this.bandPipeline);
            cbPass.setBindGroup(0, cbBG);
            cbPass.dispatchWorkgroups(
                Math.ceil(srcLevel.width / 16),
                Math.ceil(srcLevel.height / 16),
            );
            cbPass.end();
        }

        // ─── Stats extraction: accumulate + finalize ───

        // Zero the accumulator buffer before accumulating
        const accumSize = this.totalSlots * ACCUM_STRIDE * 4;
        encoder.clearBuffer(this.accumBuffer, 0, accumSize);

        // Write stats config (24 u32s = 96 bytes, extended for sector mode)
        const statsConfig = new Uint32Array(24);
        const statsConfigF32 = new Float32Array(statsConfig.buffer);
        statsConfig[0] = this.width;
        statsConfig[1] = this.height;
        statsConfig[2] = TILE_SIZE;
        statsConfig[3] = this.tileCountX;
        statsConfig[4] = this.tileCountY;
        statsConfig[5] = PYRAMID_LEVELS;
        statsConfig[6] = this.levels[0].width;
        statsConfig[7] = this.levels[0].height;
        statsConfig[8] = this.levels[1].width;
        statsConfig[9] = this.levels[1].height;
        statsConfig[10] = this.levels[2].width;
        statsConfig[11] = this.levels[2].height;
        statsConfig[12] = this.levels[3].width;
        statsConfig[13] = this.levels[3].height;
        // Sector fields (slots 14-23)
        statsConfig[14] = this.useSectors ? 1 : 0;  // use_sectors
        statsConfig[15] = this.numRings;             // num_rings
        statsConfig[16] = this.totalSectors;         // total_sectors
        statsConfigF32[17] = foveaX * this.width;    // fovea_x_px (band_0 pixel coords)
        statsConfigF32[18] = foveaY * this.height;   // fovea_y_px
        statsConfigF32[19] = this.cmfA || CMF_A;     // cmf_a
        statsConfigF32[20] = this.corticalMax || 0;  // cortical_max
        // max_ecc_px: convert maxEccDeg to pixels at band_0 resolution
        // ppd ≈ foveaRadius (pixels) / fovea_deg (typically 1°)
        const ppd = foveaRadius; // pixels per degree at band_0 res (half-screen, so foveaRadius is already half)
        statsConfigF32[21] = (this.maxEccDeg || 15) * ppd;  // max_ecc_px
        statsConfig[22] = 0;  // reserved
        statsConfig[23] = 0;  // reserved
        this.device.queue.writeBuffer(this.statsConfigBuffer, 0, statsConfig);

        // Accumulate pass: iterate over band_0-resolution pixels
        const accumBG = this.device.createBindGroup({
            layout: this.accumBGL,
            entries: [
                { binding: 0, resource: { buffer: this.statsConfigBuffer } },
                { binding: 1, resource: { buffer: this.bandBuffers[0] } },
                { binding: 2, resource: { buffer: this.bandBuffers[1] } },
                { binding: 3, resource: { buffer: this.bandBuffers[2] } },
                { binding: 4, resource: { buffer: this.bandBuffers[3] } },
                { binding: 5, resource: this.sourceTexture.createView() },
                { binding: 6, resource: { buffer: this.accumBuffer } },
                { binding: 7, resource: { buffer: this.sectorRingBaseBuffer } },
                { binding: 8, resource: { buffer: this.sectorSpokeCountBuffer } },
            ],
        });
        const accumPass = encoder.beginComputePass();
        accumPass.setPipeline(this.accumPipeline);
        accumPass.setBindGroup(0, accumBG);
        accumPass.dispatchWorkgroups(
            Math.ceil(this.width / 16),
            Math.ceil(this.height / 16),
        );
        accumPass.end();

        // Finalize pass: one thread per tile
        const finalizeBG = this.device.createBindGroup({
            layout: this.finalizeBGL,
            entries: [
                { binding: 0, resource: { buffer: this.statsConfigBuffer } },
                { binding: 1, resource: { buffer: this.accumBuffer } },
                { binding: 2, resource: { buffer: this.statsBuffer } },
            ],
        });
        const finalizePass = encoder.beginComputePass();
        finalizePass.setPipeline(this.finalizePipeline);
        finalizePass.setBindGroup(0, finalizeBG);
        finalizePass.dispatchWorkgroups(Math.ceil(this.totalSlots / 256));
        finalizePass.end();

        // ─── Synthesis: seed → match (x iterations) → reconstruct ───

        // Write synth config (20 f32s = 80 bytes, extended for sectors)
        const synthConfig = new Float32Array(20);
        const synthConfigU32 = new Uint32Array(synthConfig.buffer);
        synthConfigU32[0] = this.width;
        synthConfigU32[1] = this.height;
        synthConfigU32[2] = TILE_SIZE;
        synthConfigU32[3] = this.tileCountX;
        synthConfigU32[4] = this.tileCountY;
        synthConfigU32[5] = PYRAMID_LEVELS;
        synthConfigU32[6] = 0; // iteration (updated per iteration)
        // Seed from gaze position — same gaze = same noise (no shimmer).
        // Changes only when gaze moves to a different tile.
        const gazeTileX = Math.floor(foveaX * this.width / TILE_SIZE);
        const gazeTileY = Math.floor(foveaY * this.height / TILE_SIZE);
        synthConfigU32[7] = (gazeTileX * 7919 + gazeTileY * 104729 + 42) & 0xFFFF;
        synthConfig[8] = foveaX;
        synthConfig[9] = foveaY;
        synthConfig[10] = foveaRadius;
        synthConfig[11] = foveaRadius * 1.5;  // blend_start: synthesis begins at 1.5x fovea
        synthConfig[12] = foveaRadius * 4.0;  // blend_end: fully opaque at 4x fovea
        // Sector fields (slots 13-19)
        synthConfigU32[13] = this.useSectors ? 1 : 0;  // use_sectors
        synthConfigU32[14] = this.numRings;             // num_rings
        synthConfigU32[15] = this.totalSectors;         // total_sectors
        synthConfig[16] = foveaX * this.width;          // fovea_x_px
        synthConfig[17] = foveaY * this.height;         // fovea_y_px
        synthConfig[18] = this.cmfA || CMF_A;           // cmf_a
        synthConfig[19] = this.corticalMax || 0;        // cortical_max
        this.device.queue.writeBuffer(this.synthConfigBuffer, 0, synthConfig);

        const wgX = Math.ceil(this.width / 16);
        const wgY = Math.ceil(this.height / 16);

        // Seed noise
        const seedBG = this.device.createBindGroup({
            layout: this.seedBGL,
            entries: [
                { binding: 0, resource: { buffer: this.synthConfigBuffer } },
                { binding: 1, resource: { buffer: this.noiseBuffers[0] } },
                { binding: 2, resource: { buffer: this.noiseBuffers[1] } },
                { binding: 3, resource: { buffer: this.noiseBuffers[2] } },
                { binding: 4, resource: { buffer: this.noiseBuffers[3] } },
            ],
        });
        const seedPass = encoder.beginComputePass();
        seedPass.setPipeline(this.seedPipeline);
        seedPass.setBindGroup(0, seedBG);
        seedPass.dispatchWorkgroups(wgX, wgY);
        seedPass.end();

        // Match stats (iterative)
        const matchBG = this.device.createBindGroup({
            layout: this.matchBGL,
            entries: [
                { binding: 0, resource: { buffer: this.synthConfigBuffer } },
                { binding: 1, resource: { buffer: this.statsBuffer } },
                { binding: 2, resource: { buffer: this.noiseBuffers[0] } },
                { binding: 3, resource: { buffer: this.noiseBuffers[1] } },
                { binding: 4, resource: { buffer: this.noiseBuffers[2] } },
                { binding: 5, resource: { buffer: this.noiseBuffers[3] } },
                { binding: 6, resource: { buffer: this.sectorRingBaseBuffer } },
                { binding: 7, resource: { buffer: this.sectorSpokeCountBuffer } },
            ],
        });
        for (let iter = 0; iter < synthIterations; iter++) {
            // Update iteration in config
            synthConfigU32[6] = iter;
            this.device.queue.writeBuffer(this.synthConfigBuffer, 0, synthConfig);

            const matchPass = encoder.beginComputePass();
            matchPass.setPipeline(this.matchPipeline);
            matchPass.setBindGroup(0, matchBG);
            matchPass.dispatchWorkgroups(wgX, wgY);
            matchPass.end();
        }

        // Reconstruct
        const reconBG = this.device.createBindGroup({
            layout: this.reconBGL,
            entries: [
                { binding: 0, resource: { buffer: this.synthConfigBuffer } },
                { binding: 1, resource: { buffer: this.noiseBuffers[0] } },
                { binding: 2, resource: { buffer: this.noiseBuffers[1] } },
                { binding: 3, resource: { buffer: this.noiseBuffers[2] } },
                { binding: 4, resource: { buffer: this.noiseBuffers[3] } },
                { binding: 5, resource: { buffer: this.levelBuffers[PYRAMID_LEVELS] } },
                { binding: 6, resource: { buffer: this.statsBuffer } },
                { binding: 7, resource: this.sourceTexture.createView() },
                { binding: 8, resource: { buffer: this.synthOutputBuffer } },
                { binding: 9, resource: { buffer: this.sectorRingBaseBuffer } },
                { binding: 10, resource: { buffer: this.sectorSpokeCountBuffer } },
            ],
        });
        const reconPass = encoder.beginComputePass();
        reconPass.setPipeline(this.reconPipeline);
        reconPass.setBindGroup(0, reconBG);
        reconPass.dispatchWorkgroups(wgX, wgY);
        reconPass.end();

        // ─── Copy to readback buffers ───

        // Synth output
        const synthSize = this.levels[0].pixels * 4;
        encoder.copyBufferToBuffer(
            this.synthOutputBuffer, 0,
            this.synthReadbackBuffer, 0,
            synthSize,
        );

        // Band buffers
        for (let k = 0; k < PYRAMID_LEVELS; k++) {
            const size = this.levels[k].pixels * 4;
            encoder.copyBufferToBuffer(
                this.bandBuffers[k], 0,
                this.bandReadbackBuffers[k], 0,
                size,
            );
        }
        // Residual (level[PYRAMID_LEVELS])
        const resSize = this.levels[PYRAMID_LEVELS].pixels * 4;
        encoder.copyBufferToBuffer(
            this.levelBuffers[PYRAMID_LEVELS], 0,
            this.residualReadbackBuffer, 0,
            resSize,
        );
        // Stats buffer
        const statsCopySize = this.totalSlots * STATS_STRIDE * 4;
        encoder.copyBufferToBuffer(
            this.statsBuffer, 0,
            this.statsReadbackBuffer, 0,
            statsCopySize,
        );

        this.device.queue.submit([encoder.finish()]);
    }

    /**
     * Read back band data for validation or debug visualization.
     * @param {number} bandIndex — 0..3 for frequency bands, 4 for residual
     * @returns {Promise<Float32Array|null>}
     */
    async readbackBand(bandIndex) {
        if (this._destroyed) return null;

        const isResidual = bandIndex >= PYRAMID_LEVELS;
        const buffer = isResidual ? this.residualReadbackBuffer : this.bandReadbackBuffers[bandIndex];
        const level = isResidual ? this.levels[PYRAMID_LEVELS] : this.levels[bandIndex];

        try {
            await buffer.mapAsync(GPUMapMode.READ);
            const mapped = new Float32Array(buffer.getMappedRange());
            const result = new Float32Array(mapped.length);
            result.set(mapped);
            buffer.unmap();
            return result;
        } catch (e) {
            console.warn(`[WebGPU Pyramid] Readback failed for band ${bandIndex}:`, e.message);
            return null;
        }
    }

    /**
     * Read back the synthesized output (RGBA8 packed as u32, same format as Tier 2.5).
     * Can be uploaded to WebGL TEXTURE5 via texImage2D.
     * @returns {Promise<Uint8Array|null>}
     */
    async readbackOutput() {
        if (this._destroyed) return null;
        try {
            await this.synthReadbackBuffer.mapAsync(GPUMapMode.READ);
            const mapped = new Uint8Array(this.synthReadbackBuffer.getMappedRange());
            const result = new Uint8Array(mapped.length);
            result.set(mapped);
            this.synthReadbackBuffer.unmap();
            return result;
        } catch (e) {
            console.warn('[WebGPU Pyramid] Synth readback failed:', e.message);
            return null;
        }
    }

    /**
     * Read back per-tile cross-scale statistics.
     * Returns array of TileStatsTier3 objects, or null if unavailable.
     * @returns {Promise<Float32Array|null>}
     */
    async readbackStats() {
        if (this._destroyed) return null;
        try {
            await this.statsReadbackBuffer.mapAsync(GPUMapMode.READ);
            const mapped = new Float32Array(this.statsReadbackBuffer.getMappedRange());
            const result = new Float32Array(mapped.length);
            result.set(mapped);
            this.statsReadbackBuffer.unmap();
            return result;
        } catch (e) {
            console.warn('[WebGPU Pyramid] Stats readback failed:', e.message);
            return null;
        }
    }

    /**
     * Parse a raw stats Float32Array into structured tile objects.
     * @param {Float32Array} raw — from readbackStats()
     * @returns {Array<object>}
     */
    parseStats(raw) {
        const slots = [];
        for (let i = 0; i < this.totalSlots; i++) {
            const o = i * STATS_STRIDE;
            slots.push({
                mag: [raw[o], raw[o+1], raw[o+2], raw[o+3]],
                variance: [raw[o+4], raw[o+5], raw[o+6], raw[o+7]],
                crossCorr: [raw[o+8], raw[o+9], raw[o+10]],
                color: { L: raw[o+11], a: raw[o+12], b: raw[o+13] },
                skewness: [raw[o+14], raw[o+15], raw[o+16], raw[o+17]],
            });
        }
        return slots;
    }

    /**
     * Get tile/sector grid dimensions.
     * @returns {{ tileCountX: number, tileCountY: number, totalTiles: number, tileSize: number, useSectors: boolean, totalSlots: number }}
     */
    getTileGrid() {
        return {
            tileCountX: this.tileCountX,
            tileCountY: this.tileCountY,
            totalTiles: this.totalTiles,
            tileSize: TILE_SIZE,
            useSectors: this.useSectors,
            totalSlots: this.totalSlots,
            totalSectors: this.totalSectors,
            numRings: this.numRings,
        };
    }

    /**
     * Get band dimensions.
     * @param {number} bandIndex — 0..3 for frequency bands, 4 for residual
     * @returns {{ width: number, height: number }}
     */
    getBandDimensions(bandIndex) {
        const levelIdx = bandIndex >= PYRAMID_LEVELS ? PYRAMID_LEVELS : bandIndex;
        return { width: this.levels[levelIdx].width, height: this.levels[levelIdx].height };
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

        // Sector layout is resolution-independent (depends on degrees, not pixels)
        // but totalSlots must be updated
        this.totalSlots = this.useSectors ? this.totalSectors : this.totalTiles;

        this.levels = [];
        let w = width, h = height;
        for (let k = 0; k <= PYRAMID_LEVELS; k++) {
            this.levels.push({ width: w, height: h, pixels: w * h });
            w = Math.floor(w / 2);
            h = Math.floor(h / 2);
        }

        this._createResources();
        // Pipelines don't need recreation (same shaders, layouts are dimension-independent)

        console.log(`[WebGPU Pyramid] Resized: ${width}x${height}`);
    }

    /**
     * Clean up all GPU resources.
     */
    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;

        this.sourceTexture?.destroy();
        for (const buf of this.levelBuffers) buf?.destroy();
        for (const buf of this.bandBuffers) buf?.destroy();
        for (const buf of this.configBuffers) buf?.destroy();
        for (const buf of this.bandReadbackBuffers) buf?.destroy();
        this.residualReadbackBuffer?.destroy();
        this.accumBuffer?.destroy();
        this.statsBuffer?.destroy();
        this.statsConfigBuffer?.destroy();
        this.statsReadbackBuffer?.destroy();
        this.sectorRingBaseBuffer?.destroy();
        this.sectorSpokeCountBuffer?.destroy();
        for (const buf of (this.noiseBuffers || [])) buf?.destroy();
        this.synthOutputBuffer?.destroy();
        this.synthConfigBuffer?.destroy();
        this.synthReadbackBuffer?.destroy();

        this.sourceTexture = null;
        this.levelBuffers = [];
        this.bandBuffers = [];
        this.configBuffers = [];
        this.bandReadbackBuffers = [];
        this.residualReadbackBuffer = null;
        this.accumBuffer = null;
        this.statsBuffer = null;
        this.statsConfigBuffer = null;
        this.statsReadbackBuffer = null;
        this.sectorRingBaseBuffer = null;
        this.sectorSpokeCountBuffer = null;
        this.noiseBuffers = [];
        this.synthOutputBuffer = null;
        this.synthConfigBuffer = null;
        this.synthReadbackBuffer = null;

        console.log('[WebGPU Pyramid] Destroyed');
    }
}

module.exports = { WebGPUPyramidCompute, PYRAMID_LEVELS };
