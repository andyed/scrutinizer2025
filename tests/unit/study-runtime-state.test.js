'use strict';

const { buildStudyRuntimeState } = require('../../shared/study-runtime-state');

const BASELINE = Object.freeze({
    radius: 70,
    blur: 10,
    intensity: 0.6,
    enabled: true,
    visualMemory: 5,
    comfortMode: true,
    mode: 12
});

describe('study runtime state', () => {
    it('uses the baseline when no overrides are supplied', () => {
        expect(buildStudyRuntimeState(BASELINE)).toEqual(BASELINE);
        expect(buildStudyRuntimeState(BASELINE)).not.toBe(BASELINE);
    });

    it('applies every supported override without mutating the baseline', () => {
        const before = { ...BASELINE };
        const result = buildStudyRuntimeState(BASELINE, {
            foveaRadiusPx: 20,
            enabled: false,
            visualMemoryLimit: 0,
            comfortMode: false,
            mode: 0
        });

        expect(result).toEqual({
            ...BASELINE,
            radius: 20,
            enabled: false,
            visualMemory: 0,
            comfortMode: false,
            mode: 0
        });
        expect(BASELINE).toEqual(before);
    });

    it('preserves unrelated rendering settings', () => {
        expect(buildStudyRuntimeState(BASELINE, { mode: 20 })).toMatchObject({
            blur: 10,
            intensity: 0.6,
            mode: 20
        });
    });
});
