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

        // Request device with adapter's full limits
        const requiredLimits = {
            maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
            maxBufferSize: limits.maxBufferSize,
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
