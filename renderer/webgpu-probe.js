/**
 * WebGPU Boot Probe — Tier 2.5
 * Safe initialization with adapter query, limit detection, and graceful fallback.
 * Ported from liquid-light-warp/src/renderer/webgpu-probe.ts
 */

// The Tier 2.75/3 pyramid reconstruct bind group (reconBGL in webgpu-pyramid-compute.js)
// binds 9 storage buffers per compute stage. The WebGPU default
// maxStorageBuffersPerShaderStage is 8, so cortical pooling (modes 14/15) needs the
// device created with at least this many. See audit 2026-06-05 (B2).
const CORTICAL_POOLING_STORAGE_BUFFERS = 9;

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

        // Request device with adapter's full limits. Critically, request the adapter's
        // full storage-buffer COUNT — not just buffer sizes — so the 9-buffer cortical
        // pooling reconstruct pass actually gets its buffers on GPUs that support >= 9,
        // instead of being silently capped at the WebGPU default of 8 and falling back
        // to MIP/DoG acuity blur under a "Pyramid Mongrel" label. See audit 2026-06-05 (B2).
        const requiredLimits = {
            maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
            maxBufferSize: limits.maxBufferSize,
            maxStorageBuffersPerShaderStage: limits.maxStorageBuffersPerShaderStage,
            maxComputeWorkgroupSizeX: limits.maxComputeWorkgroupSizeX,
            maxComputeInvocationsPerWorkgroup: limits.maxComputeInvocationsPerWorkgroup,
        };

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

        // Shader/validation error handler
        device.addEventListener('uncapturederror', (event) => {
            console.error('[WebGPU] Uncaptured error:', event.error);
        });

        // Cortical-pooling capability gate. If the granted device still caps storage
        // buffers below what the reconstruct pass needs, surface it loudly rather than
        // letting modes 14/15 render acuity-loss blur while claiming to pool. (B2)
        const corticalPoolingAvailable =
            device.limits.maxStorageBuffersPerShaderStage >= CORTICAL_POOLING_STORAGE_BUFFERS;
        if (!corticalPoolingAvailable) {
            warnings.push(
                `Cortical pooling unavailable: this GPU caps maxStorageBuffersPerShaderStage at ` +
                `${device.limits.maxStorageBuffersPerShaderStage} (need ${CORTICAL_POOLING_STORAGE_BUFFERS}). ` +
                `Modes 14/15 will fall back to MIP/DoG acuity blur, not sector cortical pooling.`
            );
        }

        console.log('[WebGPU Probe] Initialized successfully');
        if (warnings.length > 0) {
            warnings.forEach(w => console.warn('[WebGPU Probe]', w));
        }

        return {
            success: true,
            device,
            adapter,
            limits: device.limits,
            corticalPoolingAvailable,
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
