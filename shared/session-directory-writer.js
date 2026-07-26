'use strict';

/**
 * Atomic writer for a complete scrutinizer-session-capture/1 directory.
 *
 * The Workbench treats the directory as the API, so it must never observe a
 * half-written envelope, missing trail, or promised-but-absent stimulus. Every
 * file is written into a hidden sibling directory, fsynced, then made visible
 * with one same-volume rename. Existing captures are never overwritten.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
    validateEnvelope,
    sessionDirName,
    trailFileName,
    stimulusFileName,
    ENVELOPE_BASENAME
} = require('./session-capture');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IHDR = Buffer.from('IHDR', 'ascii');

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function mapValue(collection, key) {
    if (collection instanceof Map) return collection.get(key);
    return isPlainObject(collection) && own(collection, key) ? collection[key] : undefined;
}

function captureError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function pngDimensions(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 24 ||
        !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
        buffer.readUInt32BE(8) !== 13 ||
        !buffer.subarray(12, 16).equals(PNG_IHDR)) {
        return null;
    }
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
}

function durableWrite(filePath, data, mode = 0o600) {
    const fd = fs.openSync(filePath, 'wx', mode);
    try {
        fs.writeFileSync(fd, data);
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
}

function syncDirectory(directoryPath) {
    let fd;
    try {
        fd = fs.openSync(directoryPath, 'r');
        fs.fsyncSync(fd);
    } catch (err) {
        // Some filesystems do not support directory fsync. File fsync + atomic
        // same-volume rename still preserves the no-partial-directory contract.
        if (!err || !['EINVAL', 'EBADF', 'ENOTSUP'].includes(err.code)) throw err;
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
}

function nextAvailablePath(rootDir, baseName) {
    let attempt = 1;
    let candidate = path.join(rootDir, baseName);
    while (fs.existsSync(candidate)) {
        attempt += 1;
        candidate = path.join(rootDir, `${baseName}-${attempt}`);
    }
    return candidate;
}

function assertComplete(envelope, trailsByTaskId, stimuliByPageVisitId) {
    const validation = validateEnvelope(envelope);
    if (!validation.ok) {
        throw captureError(
            'CAPTURE_ENVELOPE_INVALID',
            `Capture envelope is invalid: ${validation.errors.join('; ')}`
        );
    }

    for (const task of envelope.tasks) {
        const trail = mapValue(trailsByTaskId, task.taskId);
        if (!trail || typeof trail !== 'object') {
            throw captureError(
                'CAPTURE_TRAIL_MISSING',
                `No ScanpathData trail is available for task ${JSON.stringify(task.taskId)}.`
            );
        }
        if (!envelope.pageVisits.some(visit => visit.taskId === task.taskId)) {
            throw captureError(
                'CAPTURE_STIMULUS_MISSING',
                `Task ${JSON.stringify(task.taskId)} has no captured page visit.`
            );
        }
    }

    for (const visit of envelope.pageVisits) {
        const expected = stimulusFileName(visit.pageVisitId);
        if (visit.screenshot !== expected) {
            throw captureError(
                'CAPTURE_STIMULUS_PATH_INVALID',
                `Stimulus ${JSON.stringify(visit.pageVisitId)} must use ${JSON.stringify(expected)}.`
            );
        }
        const image = mapValue(stimuliByPageVisitId, visit.pageVisitId);
        if (!Buffer.isBuffer(image)) {
            throw captureError(
                'CAPTURE_STIMULUS_MISSING',
                `No PNG stimulus is available for page visit ${JSON.stringify(visit.pageVisitId)}.`
            );
        }
        const dimensions = pngDimensions(image);
        if (!dimensions) {
            throw captureError(
                'CAPTURE_STIMULUS_INVALID',
                `Stimulus ${JSON.stringify(visit.pageVisitId)} is not a PNG image.`
            );
        }
        if (dimensions.width !== visit.stimulusWidth ||
            dimensions.height !== visit.stimulusHeight) {
            throw captureError(
                'CAPTURE_STIMULUS_DIMENSIONS_MISMATCH',
                `Stimulus ${JSON.stringify(visit.pageVisitId)} is ` +
                `${dimensions.width}×${dimensions.height}, but the envelope promises ` +
                `${visit.stimulusWidth}×${visit.stimulusHeight}.`
            );
        }
    }
}

/**
 * @param {Object} input
 * @param {string} input.rootDir
 * @param {Object} input.envelope
 * @param {Object|Map} input.trailsByTaskId
 * @param {Object|Map} input.stimuliByPageVisitId
 * @returns {{directoryPath: string, directoryName: string}}
 */
function writeSessionDirectory({ rootDir, envelope, trailsByTaskId, stimuliByPageVisitId }) {
    if (typeof rootDir !== 'string' || rootDir.length === 0) {
        throw captureError('CAPTURE_ROOT_INVALID', 'A session-directory root is required.');
    }
    assertComplete(envelope, trailsByTaskId, stimuliByPageVisitId);

    fs.mkdirSync(rootDir, { recursive: true, mode: 0o700 });
    const baseName = sessionDirName(envelope.sessionId, envelope.startedAt);
    const finalPath = nextAvailablePath(rootDir, baseName);
    const random = crypto.randomBytes(8).toString('hex');
    const tempPath = path.join(rootDir, `.${path.basename(finalPath)}.partial-${process.pid}-${random}`);

    fs.mkdirSync(tempPath, { mode: 0o700 });
    try {
        const stimuliDir = path.join(tempPath, 'stimuli');
        fs.mkdirSync(stimuliDir, { mode: 0o700 });

        for (const task of envelope.tasks) {
            const trail = mapValue(trailsByTaskId, task.taskId);
            durableWrite(
                path.join(tempPath, trailFileName(task.taskId)),
                `${JSON.stringify(trail, null, 2)}\n`
            );
        }
        for (const visit of envelope.pageVisits) {
            durableWrite(
                path.join(tempPath, stimulusFileName(visit.pageVisitId)),
                mapValue(stimuliByPageVisitId, visit.pageVisitId)
            );
        }

        // Envelope last inside the hidden directory: if a debugger inspects
        // the partial path, it still cannot mistake it for a complete capture.
        durableWrite(
            path.join(tempPath, ENVELOPE_BASENAME),
            `${JSON.stringify(envelope, null, 2)}\n`
        );
        syncDirectory(stimuliDir);
        syncDirectory(tempPath);
        fs.renameSync(tempPath, finalPath);
        syncDirectory(rootDir);
    } catch (err) {
        try {
            fs.rmSync(tempPath, { recursive: true, force: true });
        } catch (cleanupErr) {
            // Preserve the write failure. Hidden partials are never admissible.
        }
        throw err;
    }

    return {
        directoryPath: finalPath,
        directoryName: path.basename(finalPath)
    };
}

module.exports = {
    assertComplete,
    pngDimensions,
    writeSessionDirectory
};
