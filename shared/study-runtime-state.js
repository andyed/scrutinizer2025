'use strict';

function buildStudyRuntimeState(baseline, overrides = {}) {
    return {
        ...baseline,
        radius: overrides.foveaRadiusPx !== undefined ? overrides.foveaRadiusPx : baseline.radius,
        enabled: overrides.enabled !== undefined ? overrides.enabled : baseline.enabled,
        visualMemory: overrides.visualMemoryLimit !== undefined ? overrides.visualMemoryLimit : baseline.visualMemory,
        comfortMode: overrides.comfortMode !== undefined ? overrides.comfortMode : baseline.comfortMode,
        mode: overrides.mode !== undefined ? overrides.mode : baseline.mode
    };
}

module.exports = { buildStudyRuntimeState };
