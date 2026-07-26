'use strict';

const path = require('node:path');
const { PNG } = require('pngjs');
const {
    createStimulusDiff,
    DEFAULTS,
    compareStimuli,
    closeStimulusDiffWorker
} = require('../../shared/stimulus-diff');

function png(width, height, pixelAt) {
    const image = new PNG({ width, height });
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const offset = (y * width + x) * 4;
            const rgba = pixelAt ? pixelAt(x, y) : [0, 0, 0, 255];
            image.data[offset] = rgba[0];
            image.data[offset + 1] = rgba[1];
            image.data[offset + 2] = rgba[2];
            image.data[offset + 3] = rgba[3];
        }
    }
    return PNG.sync.write(image);
}

function oversizedPngHeader(width, height) {
    const header = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header, 0);
    header.writeUInt32BE(13, 8);
    header.write('IHDR', 12, 'ascii');
    header.writeUInt32BE(width, 16);
    header.writeUInt32BE(height, 20);
    return header;
}

const services = [];

function service(options) {
    const instance = createStimulusDiff(options);
    services.push(instance);
    return instance;
}

afterEach(async () => {
    await Promise.all(services.splice(0).map(instance => instance.close()));
});

describe('stimulus PNG comparison worker', () => {
    test('exports the application-level compare and shutdown API', () => {
        expect(typeof compareStimuli).toBe('function');
        expect(typeof closeStimulusDiffWorker).toBe('function');
    });

    test('same PNG is not material and repeated calls reuse one worker', async () => {
        const comparator = service();
        const image = png(12, 12);

        const first = await comparator.compare(image, image);
        const second = await comparator.compare(image, Buffer.from(image));

        expect(first).toMatchObject({
            material: false,
            fallback: false,
            reason: 'identical_bytes',
            changedPixelCount: 0,
            changedPixelRatio: 0
        });
        expect(second.material).toBe(false);
        expect(comparator.stats().workerStarts).toBe(1);
    });

    test('dimension mismatch is always material without fallback', async () => {
        const result = await service().compare(png(10, 10), png(11, 10));
        expect(result).toMatchObject({
            material: true,
            fallback: false,
            reason: 'dimension_mismatch',
            left: { width: 10, height: 10 },
            right: { width: 11, height: 10 }
        });
    });

    test('meaningful change uses configurable channel, count, and ratio thresholds', async () => {
        const base = png(20, 20);
        const subtle = png(20, 20, (x, y) =>
            x === 0 && y === 0 ? [8, 0, 0, 255] : [0, 0, 0, 255]);
        const broad = png(20, 20, (x, y) =>
            y < 5 ? [255, 255, 255, 255] : [0, 0, 0, 255]);
        const comparator = service();

        const ignored = await comparator.compare(base, subtle);
        const material = await comparator.compare(base, broad);
        const configured = await comparator.compare(base, subtle, {
            channelThreshold: 0,
            minChangedPixels: 1,
            changedPixelRatio: 0
        });

        expect(DEFAULTS.minChangedPixels).toBeGreaterThan(1);
        expect(ignored).toMatchObject({ material: false, fallback: false });
        expect(material).toMatchObject({
            material: true,
            fallback: false,
            reason: 'material_change',
            changedPixelCount: 100,
            changedPixelRatio: 0.25
        });
        expect(configured).toMatchObject({
            material: true,
            fallback: false,
            changedPixelCount: 1
        });
    });

    test('oversized PNG dimensions fail safe before decode allocation', async () => {
        const comparator = service({ maxPixels: 1_000 });
        const oversized = oversizedPngHeader(50_000, 50_000);
        const result = await comparator.compare(oversized, Buffer.from(oversized));

        expect(result).toMatchObject({
            material: true,
            fallback: true,
            reason: 'pixel_limit',
            width: 50_000,
            height: 50_000,
            maxPixels: 1_000
        });
    });

    test('decode errors surface conservatively as material fallback', async () => {
        const malformed = Buffer.from('not a png');
        const result = await service().compare(malformed, Buffer.from(malformed));
        expect(result).toMatchObject({
            material: true,
            fallback: true,
            reason: 'decode_error'
        });
    });

    test('worker errors surface conservatively as material fallback', async () => {
        const comparator = service({
            workerPath: path.join(__dirname, 'missing-stimulus-diff-worker.js')
        });
        const result = await comparator.compare(png(2, 2), png(3, 3));
        expect(result).toMatchObject({
            material: true,
            fallback: true,
            reason: 'worker_error'
        });
    });

    test('worker timeout surfaces conservatively and close is explicit', async () => {
        const comparator = service({ timeoutMs: 1 });
        const left = png(300, 300);
        const right = png(300, 300, (x, y) =>
            (x + y) % 2 === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255]);

        const result = await comparator.compare(left, right);
        expect(result).toMatchObject({
            material: true,
            fallback: true,
            reason: 'timeout'
        });

        await comparator.close();
        expect(comparator.stats().closed).toBe(true);
        await expect(comparator.compare(left, right)).resolves.toMatchObject({
            material: true,
            fallback: true,
            reason: 'closed'
        });
    });

    test('bounded waiting queue fails safe instead of growing unbounded', async () => {
        const comparator = service({ maxQueue: 0 });
        const left = png(300, 300);
        const right = png(300, 300, () => [255, 255, 255, 255]);

        const first = comparator.compare(left, right);
        const overflow = await comparator.compare(left, right);
        expect(overflow).toEqual({
            material: true,
            fallback: true,
            reason: 'queue_full'
        });
        await first;
    });
});
