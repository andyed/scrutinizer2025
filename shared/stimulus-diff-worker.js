'use strict';

/**
 * Worker-side PNG comparison for shared/stimulus-diff.js.
 *
 * PNG decode is intentionally isolated from Electron's main thread. Header
 * dimensions and the pixel ceiling are checked before pngjs is allowed to
 * allocate decoded RGBA buffers.
 */

const { parentPort } = require('node:worker_threads');
const { PNG } = require('pngjs');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function asBuffer(value) {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) {
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
    return null;
}

function readPngDimensions(buffer) {
    if (!buffer || buffer.length < 24 ||
        !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
        buffer.toString('ascii', 12, 16) !== 'IHDR') {
        return null;
    }
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
}

function exceedsPixelLimit(width, height, maxPixels) {
    return height > maxPixels || width > Math.floor(maxPixels / height);
}

function compare(message) {
    const left = asBuffer(message.left);
    const right = asBuffer(message.right);
    const options = message.options || {};

    if (!left || !right) {
        return { material: true, fallback: true, reason: 'invalid_input' };
    }

    const leftDimensions = readPngDimensions(left);
    const rightDimensions = readPngDimensions(right);
    if (!leftDimensions || !rightDimensions) {
        // Let pngjs provide the definitive decode decision below. Keeping the
        // result conservative matters more than exposing decoder internals.
        try {
            PNG.sync.read(left);
            PNG.sync.read(right);
        } catch (error) {
            return {
                material: true,
                fallback: true,
                reason: 'decode_error',
                detail: error && error.message ? error.message : String(error)
            };
        }
        return { material: true, fallback: true, reason: 'invalid_png_header' };
    }

    if (leftDimensions.width !== rightDimensions.width ||
        leftDimensions.height !== rightDimensions.height) {
        return {
            material: true,
            fallback: false,
            reason: 'dimension_mismatch',
            left: leftDimensions,
            right: rightDimensions
        };
    }

    const { width, height } = leftDimensions;
    if (exceedsPixelLimit(width, height, options.maxPixels)) {
        return {
            material: true,
            fallback: true,
            reason: 'pixel_limit',
            width,
            height,
            maxPixels: options.maxPixels
        };
    }

    const pixelCount = width * height;
    if (left.equals(right)) {
        return {
            material: false,
            fallback: false,
            reason: 'identical_bytes',
            width,
            height,
            pixelCount,
            changedPixelCount: 0,
            changedPixelRatio: 0
        };
    }

    let leftPng;
    let rightPng;
    try {
        leftPng = PNG.sync.read(left);
        rightPng = PNG.sync.read(right);
    } catch (error) {
        return {
            material: true,
            fallback: true,
            reason: 'decode_error',
            detail: error && error.message ? error.message : String(error)
        };
    }

    // Defend against a decoder/header discrepancy before indexing RGBA data.
    if (leftPng.width !== rightPng.width || leftPng.height !== rightPng.height ||
        leftPng.width !== width || leftPng.height !== height) {
        return {
            material: true,
            fallback: true,
            reason: 'decoded_dimension_mismatch'
        };
    }

    const channelThreshold = options.channelThreshold;
    let changedPixelCount = 0;
    for (let offset = 0; offset < leftPng.data.length; offset += 4) {
        if (Math.abs(leftPng.data[offset] - rightPng.data[offset]) > channelThreshold ||
            Math.abs(leftPng.data[offset + 1] - rightPng.data[offset + 1]) > channelThreshold ||
            Math.abs(leftPng.data[offset + 2] - rightPng.data[offset + 2]) > channelThreshold ||
            Math.abs(leftPng.data[offset + 3] - rightPng.data[offset + 3]) > channelThreshold) {
            changedPixelCount += 1;
        }
    }

    const changedPixelRatio = changedPixelCount / pixelCount;
    const material = changedPixelCount >= options.minChangedPixels &&
        changedPixelRatio >= options.changedPixelRatio;
    return {
        material,
        fallback: false,
        reason: material ? 'material_change' : 'below_threshold',
        width,
        height,
        pixelCount,
        changedPixelCount,
        changedPixelRatio
    };
}

if (!parentPort) {
    throw new Error('stimulus-diff-worker must run in a worker thread');
}

parentPort.on('message', (message) => {
    const id = message && message.id;
    try {
        parentPort.postMessage({ id, result: compare(message || {}) });
    } catch (error) {
        parentPort.postMessage({
            id,
            result: {
                material: true,
                fallback: true,
                reason: 'worker_compare_error',
                detail: error && error.message ? error.message : String(error)
            }
        });
    }
});
