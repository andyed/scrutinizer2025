/**
 * WebGPU Boot Probe — Tier 2.5
 * Safe initialization with adapter query, limit detection, and graceful fallback.
 * Ported from liquid-light-warp/src/renderer/webgpu-probe.ts
 */

/**
 * Probes WebGPU availability and capabilities with safety checks.
 * @returns {{ success: boolean, device?: GPUDevice, adapter?: GPUAdapter, limits?: GPUSupportedLimits, error?: string, warnings: string[] }}
 */
async function probeWebGPU() {
    const warnings = [];

    if (!navigator.gpu) {
        return {
            success: false,
            error: 'WebGPU not available. Requires Chrome/Edge 113+ or Safari 18+.',
            warnings,
        };
    }

    try {
        const adapter = await navigator.gpu.requestAdapter({
            powerPreference: 'high-performance',
        });

        if (!adapter) {
            return {
                success: false,
                error: 'Failed to get WebGPU adapter. GPU may not support WebGPU.',
                warnings,
            };
        }

        console.log('[WebGPU Probe] Adapter:', {
            vendor: adapter.info?.vendor || 'Unknown',
            architecture: adapter.info?.architecture || 'Unknown',
            device: adapter.info?.device || 'Unknown',
        });

        const limits = adapter.limits;
        console.log('[WebGPU Probe] Limits:', {
            maxStorageBufferBindingSize: `${(limits.maxStorageBufferBindingSize / 1024 / 1024).toFixed(0)} MB`,
            maxBufferSize: `${(limits.maxBufferSize / 1024 / 1024).toFixed(0)} MB`,
            maxComputeWorkgroupSizeX: limits.maxComputeWorkgroupSizeX,
            maxComputeInvocationsPerWorkgroup: limits.maxComputeInvocationsPerWorkgroup,
        });

        // Warn if storage buffer limit is below 128 MB
        const MIN_STORAGE = 128 * 1024 * 1024;
        if (limits.maxStorageBufferBindingSize < MIN_STORAGE) {
            warnings.push(
                `Storage buffer limit (${(limits.maxStorageBufferBindingSize / 1024 / 1024).toFixed(0)} MB) ` +
                `below recommended 128 MB. Compute textures may require tiling.`
            );
        }

        // Request device with adapter's full limits.
        //
        // The pyramid-synth recon bind group needs 9 storage-buffer bindings
        // but WebGPU's spec default is 8. Without bumping this, `reconBGL`
        // creation silently fails validation, `synthOutputBuffer` stays
        // zeroed, TEXTURE5 uploads zeros, and `peripheral.frag` at l.1284
        // falls through to MIP reconstruction — making "mode 15 TTM Tier 3"
        // actually render rectilinear pixel pooling rather than radial
        // texture synthesis. Every prior Brown→M15 SSIM was measuring the
        // wrong thing for this reason. See docs/radial-ttm-fix-plan.md.
        //
        // We request ≥10 only if the adapter supports it — otherwise skip
        // the bump and let `_createSynthPipelines`'s health check degrade
        // mode 15 to Tier 2.5 gracefully instead of blowing up requestDevice
        // for low-end GPUs (pre-2020 Intel iGPUs cap at 8).
        const TARGET_STORAGE_BUFFERS_PER_STAGE = 10;
        const adapterMaxStorageBuffers = limits.maxStorageBuffersPerShaderStage || 8;
        const requiredLimits = {
            maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
            maxBufferSize: limits.maxBufferSize,
            maxComputeWorkgroupSizeX: limits.maxComputeWorkgroupSizeX,
            maxComputeInvocationsPerWorkgroup: limits.maxComputeInvocationsPerWorkgroup,
        };
        if (adapterMaxStorageBuffers >= TARGET_STORAGE_BUFFERS_PER_STAGE) {
            requiredLimits.maxStorageBuffersPerShaderStage = TARGET_STORAGE_BUFFERS_PER_STAGE;
        } else {
            warnings.push(
                `Adapter caps maxStorageBuffersPerShaderStage at ${adapterMaxStorageBuffers}; ` +
                `mode 15 radial TTM recon pipeline needs ${TARGET_STORAGE_BUFFERS_PER_STAGE}. ` +
                `Mode 15 will degrade to Tier 2.5 (pyramid mongrel) on this device.`
            );
        }

        const device = await adapter.requestDevice({ requiredLimits });

        if (!device) {
            return {
                success: false,
                error: 'Failed to create WebGPU device.',
                warnings,
            };
        }

        // Device loss handler — distinguish intentional kill from accidental loss
        device.lost.then((info) => {
            console.error('[WebGPU] Device lost:', info.message);
            if (info.reason === 'destroyed') {
                console.log('[WebGPU] Device was intentionally destroyed (safety kill).');
            }
        });

        // Shader/validation error handler. Also stash the last error on the
        // device so pipeline health checks can retrieve it — the silent-
        // fallback bug (see radial-ttm-fix-plan.md) was invisible because
        // this handler only console.error'd without exposing anything to
        // the JS control flow.
        device._lastUncapturedError = null;
        device.addEventListener('uncapturederror', (event) => {
            console.error('[WebGPU] Uncaptured error:', event.error);
            device._lastUncapturedError = event.error;
        });

        console.log('[WebGPU Probe] Initialized successfully');
        if (warnings.length > 0) {
            warnings.forEach(w => console.warn('[WebGPU Probe]', w));
        }

        return {
            success: true,
            device,
            adapter,
            limits: device.limits,
            warnings,
        };

    } catch (error) {
        return {
            success: false,
            error: `WebGPU init failed: ${error instanceof Error ? error.message : String(error)}`,
            warnings,
        };
    }
}

module.exports = { probeWebGPU };
