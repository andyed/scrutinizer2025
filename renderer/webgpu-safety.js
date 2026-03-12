/**
 * WebGPU Safety Harness — Tier 2.5
 * 60-frame rolling window monitor with auto-fallback.
 * Ported from liquid-light-warp/src/renderer/safety-harness.ts
 *
 * No ESC binding (conflicts with Scrutinizer UI).
 * Kill is programmatic via onBudgetExceeded callback.
 */

class WebGPUSafetyHarness {
    /**
     * @param {GPUDevice} device
     * @param {{ onBudgetExceeded?: () => void }} [options]
     */
    constructor(device, options = {}) {
        this.device = device;
        this.onBudgetExceeded = options.onBudgetExceeded || null;

        this.frameTimes = [];
        this.HISTORY = 60;                   // 1 second at 60fps
        this.CRITICAL_THRESHOLD = 33.33;     // 30fps floor
        this.consecutiveCritical = 0;
        this.CRITICAL_LIMIT = 10;            // frames before auto-fallback

        this._killed = false;

        console.log('[WebGPU Safety] Harness active — auto-fallback after 10 consecutive critical frames');
    }

    /**
     * Record a frame time (ms). Returns { fps, warning }.
     * Fires onBudgetExceeded if 10 consecutive frames exceed 33ms.
     */
    recordFrame(frameTimeMs) {
        if (this._killed) return { fps: 0, warning: 'killed' };

        this.frameTimes.push(frameTimeMs);
        if (this.frameTimes.length > this.HISTORY) {
            this.frameTimes.shift();
        }

        const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
        const fps = 1000 / avg;

        let warning = null;
        if (frameTimeMs > this.CRITICAL_THRESHOLD) {
            this.consecutiveCritical++;
            warning = `Critical frame: ${frameTimeMs.toFixed(1)}ms (${this.consecutiveCritical}/${this.CRITICAL_LIMIT})`;

            if (this.consecutiveCritical >= this.CRITICAL_LIMIT) {
                console.warn('[WebGPU Safety] Budget exceeded — triggering fallback');
                if (this.onBudgetExceeded) this.onBudgetExceeded();
                this.kill();
            }
        } else {
            this.consecutiveCritical = 0;
        }

        return { fps, warning };
    }

    /**
     * Destroy device with double-destroy guard.
     */
    kill() {
        if (this._killed) return;
        this._killed = true;
        try {
            this.device.destroy();
        } catch (e) {
            // Device may already be lost
        }
        console.log('[WebGPU Safety] Device destroyed');
    }

    isAlive() {
        return !this._killed;
    }
}

module.exports = { WebGPUSafetyHarness };
