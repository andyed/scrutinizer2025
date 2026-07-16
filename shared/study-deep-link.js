'use strict';

const STUDY_SCHEME = 'scrutinizer';
const STUDY_VERSION = 'v1';
const TASK_START_PATH = '/task/start';

const ALLOWED_PARAMETERS = new Set([
    'url',
    'task_id',
    'instructions',
    'fovea_radius_px',
    'mode',
    'enabled',
    'comfort_mode',
    'visual_memory_limit'
]);

const VISUAL_MEMORY_LIMITS = new Set([0, 5, 10, -1, 20]);
const TASK_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const INTEGER_PATTERN = /^-?(?:0|[1-9]\d*)$/;

function failure(code, message) {
    return { ok: false, error: { code, message } };
}

function parseInteger(value) {
    if (!INTEGER_PATTERN.test(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
}

function parseBoolean(value) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return null;
}

function parseStudyDeepLink(rawUrl, { radiusOptions = [], modeIds = [] } = {}) {
    if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
        return failure('INVALID_URL', 'The study link is empty or invalid.');
    }

    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return failure('INVALID_URL', 'The study link is not a valid URL.');
    }

    if (parsed.protocol !== `${STUDY_SCHEME}:`) {
        return failure('UNSUPPORTED_SCHEME', 'This is not a Scrutinizer study link.');
    }
    if (parsed.hostname !== STUDY_VERSION) {
        return failure('UNSUPPORTED_VERSION', 'This Scrutinizer version does not support that study link version.');
    }
    if (parsed.pathname !== TASK_START_PATH) {
        return failure('UNSUPPORTED_ROUTE', 'This Scrutinizer version does not support that study link type.');
    }

    const seen = new Set();
    for (const [key] of parsed.searchParams) {
        if (!ALLOWED_PARAMETERS.has(key)) {
            return failure('UNKNOWN_PARAMETER', `The study link contains an unsupported setting: ${key}.`);
        }
        if (seen.has(key)) {
            return failure('DUPLICATE_PARAMETER', `The study link repeats the ${key} setting.`);
        }
        seen.add(key);
    }

    const targetValue = parsed.searchParams.get('url');
    if (!targetValue) {
        return failure('MISSING_TARGET_URL', 'The study link does not specify a task page.');
    }
    if (targetValue.length > 4096) {
        return failure('INVALID_PARAMETER', 'The task page URL is too long.');
    }

    let target;
    try {
        target = new URL(targetValue);
    } catch {
        return failure('UNSAFE_TARGET_URL', 'The task page must be a complete http or https URL.');
    }
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
        return failure('UNSAFE_TARGET_URL', 'The task page must be a safe http or https URL without embedded credentials.');
    }

    const taskId = parsed.searchParams.get('task_id');
    if (taskId !== null && (taskId.length < 1 || taskId.length > 128 || !TASK_ID_PATTERN.test(taskId))) {
        return failure('INVALID_PARAMETER', 'The task ID contains unsupported characters or is too long.');
    }

    const instructions = parsed.searchParams.get('instructions');
    if (instructions !== null && (instructions.length < 1 || instructions.length > 500)) {
        return failure('INVALID_PARAMETER', 'The task instructions are empty or too long.');
    }

    const overrides = {};

    const radiusValue = parsed.searchParams.get('fovea_radius_px');
    if (radiusValue !== null) {
        const radius = parseInteger(radiusValue);
        if (radius === null || !new Set(radiusOptions).has(radius)) {
            return failure('INVALID_PARAMETER', 'The requested foveal radius is not supported.');
        }
        overrides.foveaRadiusPx = radius;
    }

    const modeValue = parsed.searchParams.get('mode');
    if (modeValue !== null) {
        const mode = parseInteger(modeValue);
        if (mode === null || !new Set(modeIds).has(mode)) {
            return failure('INVALID_PARAMETER', 'The requested Scrutinizer mode is not supported.');
        }
        overrides.mode = mode;
    }

    for (const [parameter, property] of [
        ['enabled', 'enabled'],
        ['comfort_mode', 'comfortMode']
    ]) {
        const value = parsed.searchParams.get(parameter);
        if (value !== null) {
            const boolean = parseBoolean(value);
            if (boolean === null) {
                return failure('INVALID_PARAMETER', `The ${parameter} setting must be true or false.`);
            }
            overrides[property] = boolean;
        }
    }

    const memoryValue = parsed.searchParams.get('visual_memory_limit');
    if (memoryValue !== null) {
        const limit = parseInteger(memoryValue);
        if (limit === null || !VISUAL_MEMORY_LIMITS.has(limit)) {
            return failure('INVALID_PARAMETER', 'The requested Visual Memory setting is not supported.');
        }
        overrides.visualMemoryLimit = limit;
    }

    return {
        ok: true,
        value: {
            version: STUDY_VERSION,
            route: 'task/start',
            task: {
                id: taskId,
                instructions,
                targetUrl: target.toString(),
                origin: target.origin
            },
            overrides
        }
    };
}

module.exports = {
    STUDY_SCHEME,
    STUDY_VERSION,
    TASK_START_PATH,
    parseStudyDeepLink
};
