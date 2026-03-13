/**
 * Unit tests for renderer/config.js
 */

'use strict';

const path = require('path');
const configModule = require(path.resolve(__dirname, '../../renderer/config.js'));

describe('Config', () => {
    it('exports DEFAULT_SETTINGS object', () => {
        expect(configModule).toHaveProperty('DEFAULT_SETTINGS');
        const settings = configModule.DEFAULT_SETTINGS;
        
        // Verify key properties exist and have expected types
        expect(typeof settings.fovealRadius).toBe('number');
        expect(typeof settings.blurRadius).toBe('number');
        expect(typeof settings.useFoveatedBlur).toBe('boolean');
        expect(typeof settings.dogEnabled).toBe('boolean');
        expect(typeof settings.chromaticAberration).toBe('boolean');
        
        // Value checks to ensure no regressions parsing numbers
        expect(settings.LUM_R).toBeCloseTo(0.212671);
        expect(settings.LUM_G).toBeCloseTo(0.715160);
        expect(settings.LUM_B).toBeCloseTo(0.072169);
    });

    it('exports CALIBRATION_URL', () => {
        expect(configModule).toHaveProperty('CALIBRATION_URL');
        expect(typeof configModule.CALIBRATION_URL).toBe('string');
        expect(configModule.CALIBRATION_URL).toContain('foveal-calibration.html');
    });
});
