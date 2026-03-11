/**
 * FrameTimer — Zero-alloc rolling-window timer with phase breakdown.
 *
 * Pre-allocates Float64Arrays for frame totals and per-phase timings.
 * No per-frame GC pressure. p95 computed on-demand in getStats().
 *
 * @module FrameTimer
 */
(() => {
    class FrameTimer {
        /**
         * @param {number} [windowSize=120] - Rolling window size (frames). 120 ≈ 2s at 60fps.
         */
        constructor(windowSize = 120) {
            this.windowSize = windowSize;
            this.totals = new Float64Array(windowSize);
            this.phases = new Map(); // name → Float64Array
            this.cursor = 0;
            this.filled = 0; // how many frames recorded (caps at windowSize)
            this._frameStart = 0;
            this._lastMark = 0;
        }

        /** Call at the start of each frame. */
        beginFrame() {
            const t = performance.now();
            this._frameStart = t;
            this._lastMark = t;
        }

        /**
         * Record time since last mark (or beginFrame) under phaseName.
         * Phase arrays are allocated on first use — no upfront config needed.
         * @param {string} phaseName
         */
        mark(phaseName) {
            const t = performance.now();
            const delta = t - this._lastMark;
            this._lastMark = t;

            let arr = this.phases.get(phaseName);
            if (!arr) {
                arr = new Float64Array(this.windowSize);
                this.phases.set(phaseName, arr);
            }
            arr[this.cursor] = delta;
        }

        /** Call at the end of each frame. Records total and advances cursor. */
        endFrame() {
            const total = performance.now() - this._frameStart;
            this.totals[this.cursor] = total;
            this.cursor = (this.cursor + 1) % this.windowSize;
            if (this.filled < this.windowSize) this.filled++;
        }

        /**
         * Compute stats over the rolling window.
         * @returns {{ fps: number, avg: number, p95: number, max: number, phases: Object }}
         */
        getStats() {
            const n = this.filled;
            if (n === 0) return { fps: 0, avg: 0, p95: 0, max: 0, phases: {} };

            const sorted = this._sorted(this.totals, n);
            const avg = this._mean(sorted, n);
            const p95 = sorted[Math.floor(n * 0.95)];
            const max = sorted[n - 1];
            const fps = avg > 0 ? 1000 / avg : 0;

            const phases = {};
            for (const [name, arr] of this.phases) {
                const ps = this._sorted(arr, n);
                phases[name] = {
                    avg: this._mean(ps, n),
                    p95: ps[Math.floor(n * 0.95)]
                };
            }

            return { fps, avg, p95, max, phases };
        }

        /** Reset all recorded data. */
        reset() {
            this.totals.fill(0);
            for (const arr of this.phases.values()) arr.fill(0);
            this.cursor = 0;
            this.filled = 0;
        }

        // ── Internal helpers ───────────────────────────────────────────

        /** Copy n values from source into a temp array and sort. */
        _sorted(source, n) {
            // Reuse a single temp array per call — not stored, but cheap for 120 floats
            const tmp = new Float64Array(n);
            for (let i = 0; i < n; i++) tmp[i] = source[i];
            tmp.sort();
            return tmp;
        }

        _mean(sorted, n) {
            let sum = 0;
            for (let i = 0; i < n; i++) sum += sorted[i];
            return sum / n;
        }
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FrameTimer;
    }
    window.FrameTimer = FrameTimer;
})();
