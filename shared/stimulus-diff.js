'use strict';

/**
 * Reusable, conservative PNG comparison service.
 *
 * One service owns at most one worker and sends it one comparison at a time.
 * The waiting queue, decode pixel count, worker heap, and per-call time are all
 * bounded. Failures return `material: true, fallback: true` so callers can
 * safely retain a new stimulus rather than silently treating an unknown image
 * as unchanged.
 */

const path = require('node:path');
const { Worker } = require('node:worker_threads');

const DEFAULTS = Object.freeze({
    // 4K (8.3 MP) and 5K-ish captures fit, while pathological dimensions are
    // rejected before pngjs allocates two RGBA buffers.
    maxPixels: 16_000_000,
    // A pixel only counts when any RGBA channel moves by more than ~6%.
    channelThreshold: 16,
    // Ignore isolated rendering noise: require both an absolute floor and a
    // proportional floor (0.1% of the image).
    minChangedPixels: 64,
    changedPixelRatio: 0.001,
    timeoutMs: 5_000,
    maxQueue: 8
});

const WORKER_RESOURCE_LIMITS = Object.freeze({
    maxOldGenerationSizeMb: 192,
    maxYoungGenerationSizeMb: 16,
    stackSizeMb: 4
});

function finiteNumber(value, fallback, min, max) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
}

function integer(value, fallback, min, max) {
    return Math.floor(finiteNumber(value, fallback, min, max));
}

function normalizeOptions(base, overrides) {
    const source = Object.assign({}, base || {}, overrides || {});
    return {
        maxPixels: integer(source.maxPixels, DEFAULTS.maxPixels, 1, 100_000_000),
        channelThreshold: integer(source.channelThreshold, DEFAULTS.channelThreshold, 0, 255),
        minChangedPixels: integer(source.minChangedPixels, DEFAULTS.minChangedPixels, 1, 100_000_000),
        changedPixelRatio: finiteNumber(
            source.changedPixelRatio,
            DEFAULTS.changedPixelRatio,
            0,
            1
        ),
        timeoutMs: integer(source.timeoutMs, DEFAULTS.timeoutMs, 1, 120_000),
        maxQueue: integer(source.maxQueue, DEFAULTS.maxQueue, 0, 1_000)
    };
}

function asBuffer(value) {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) {
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
    return null;
}

function fallbackResult(reason, detail) {
    const result = { material: true, fallback: true, reason };
    if (detail) result.detail = detail;
    return result;
}

class StimulusDiffService {
    constructor(options = {}) {
        this.options = normalizeOptions(DEFAULTS, options);
        this.workerPath = options.workerPath || path.join(__dirname, 'stimulus-diff-worker.js');
        this.worker = null;
        this.active = null;
        this.queue = [];
        this.nextId = 1;
        this.closed = false;
        this.recycling = null;
        this.workerStarts = 0;
    }

    compare(leftPng, rightPng, overrides = {}) {
        if (this.closed) return Promise.resolve(fallbackResult('closed'));

        const left = asBuffer(leftPng);
        const right = asBuffer(rightPng);
        if (!left || !right) return Promise.resolve(fallbackResult('invalid_input'));

        const options = normalizeOptions(this.options, overrides);
        if ((this.active || this.recycling) && this.queue.length >= options.maxQueue) {
            return Promise.resolve(fallbackResult('queue_full'));
        }

        return new Promise((resolve) => {
            this.queue.push({
                id: this.nextId++,
                left,
                right,
                options,
                resolve,
                timer: null
            });
            this._drain();
        });
    }

    stats() {
        return {
            workerStarts: this.workerStarts,
            active: this.active !== null,
            queued: this.queue.length,
            closed: this.closed
        };
    }

    _startWorker() {
        if (this.worker) return this.worker;
        const worker = new Worker(this.workerPath, {
            resourceLimits: WORKER_RESOURCE_LIMITS
        });
        worker.unref();
        this.worker = worker;
        this.workerStarts += 1;

        worker.on('message', (message) => {
            if (this.worker !== worker || !this.active) return;
            if (!message || message.id !== this.active.id || !message.result) {
                this._failAndRecycle('worker_protocol_error');
                return;
            }
            const job = this.active;
            clearTimeout(job.timer);
            this.active = null;
            job.resolve(message.result);
            this._drain();
        });
        worker.on('error', (error) => {
            if (this.worker !== worker) return;
            this._failAndRecycle(
                'worker_error',
                error && error.message ? error.message : String(error)
            );
        });
        worker.on('exit', (code) => {
            if (this.worker !== worker) return;
            this.worker = null;
            if (this.active) {
                this._resolveActive(fallbackResult(
                    'worker_exit',
                    `worker exited with code ${code}`
                ));
            }
            this._drain();
        });
        return worker;
    }

    _drain() {
        if (this.closed || this.active || this.recycling || this.queue.length === 0) return;

        let worker;
        try {
            worker = this._startWorker();
        } catch (error) {
            const job = this.queue.shift();
            job.resolve(fallbackResult(
                'worker_start_error',
                error && error.message ? error.message : String(error)
            ));
            queueMicrotask(() => this._drain());
            return;
        }

        const job = this.queue.shift();
        this.active = job;
        job.timer = setTimeout(() => {
            if (this.active !== job) return;
            this._failAndRecycle('timeout');
        }, job.options.timeoutMs);

        try {
            worker.postMessage({
                id: job.id,
                left: job.left,
                right: job.right,
                options: job.options
            });
        } catch (error) {
            this._failAndRecycle(
                'worker_post_error',
                error && error.message ? error.message : String(error)
            );
        }
    }

    _resolveActive(result) {
        if (!this.active) return;
        const job = this.active;
        clearTimeout(job.timer);
        this.active = null;
        job.resolve(result);
    }

    _failAndRecycle(reason, detail) {
        this._resolveActive(fallbackResult(reason, detail));
        const worker = this.worker;
        this.worker = null;
        if (!worker) {
            this._drain();
            return;
        }

        // Await termination before starting a replacement: even on a timeout,
        // a service never owns two live workers at once.
        this.recycling = worker.terminate()
            .catch(() => undefined)
            .then(() => {
                this.recycling = null;
                this._drain();
            });
    }

    async close() {
        if (this.closed) {
            if (this.recycling) await this.recycling;
            return;
        }
        this.closed = true;
        this._resolveActive(fallbackResult('closed'));
        while (this.queue.length > 0) {
            this.queue.shift().resolve(fallbackResult('closed'));
        }
        if (this.recycling) await this.recycling;
        const worker = this.worker;
        this.worker = null;
        if (worker) {
            try {
                await worker.terminate();
            } catch (_) {
                // Shutdown is best-effort; comparison results already fail safe.
            }
        }
    }
}

function createStimulusDiff(options) {
    return new StimulusDiffService(options);
}

// Application-level convenience API: lazy worker creation, one shared service.
const defaultService = createStimulusDiff();

function compareStimuli(baselineBuffer, candidateBuffer, options) {
    return defaultService.compare(baselineBuffer, candidateBuffer, options);
}

function closeStimulusDiffWorker() {
    return defaultService.close();
}

module.exports = {
    DEFAULTS,
    StimulusDiffService,
    createStimulusDiff,
    compareStimuli,
    closeStimulusDiffWorker
};
