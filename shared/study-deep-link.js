'use strict';

const STUDY_SCHEME = 'scrutinizer';
const STUDY_VERSION = 'v1';
const TASK_START_PATH = '/task/start';
const SESSION_START_PATH = '/session/start';

// Delivery envelope: safe for macOS open-url and Windows ShellExecute argv.
const MAX_RAW_LINK_LENGTH = 8192;
const MIN_SESSION_TASKS = 2;
const MAX_SESSION_TASKS = 8;

const TASK_PARAMETERS = new Set([
    'url',
    'task_id',
    'instructions',
    'fovea_radius_px',
    'mode',
    'enabled',
    'comfort_mode',
    'visual_memory_limit'
]);

const SESSION_PARAMETERS = new Set([
    'session_id',
    'participant_id',
    'fovea_radius_px',
    'mode',
    'enabled',
    'comfort_mode',
    'visual_memory_limit'
]);

// t<index>.<field> — single-digit 1-based index (MAX_SESSION_TASKS is 8, so
// two-digit indices are unknown parameters by construction, as are t0/t01.
const TASK_BLOCK_PATTERN = /^t([1-9])\.(url|task_id|instructions|fovea_radius_px|mode|enabled|comfort_mode|visual_memory_limit)$/;

const VISUAL_MEMORY_LIMITS = new Set([0, 5, 10, -1, 20]);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/;
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

function validateTargetUrl(targetValue, prefix) {
    if (!targetValue) {
        return failure('MISSING_TARGET_URL', `${prefix}The study link does not specify a task page.`);
    }
    if (targetValue.length > 4096) {
        return failure('INVALID_PARAMETER', `${prefix}The task page URL is too long.`);
    }

    let target;
    try {
        target = new URL(targetValue);
    } catch {
        return failure('UNSAFE_TARGET_URL', `${prefix}The task page must be a complete http or https URL.`);
    }
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
        return failure('UNSAFE_TARGET_URL', `${prefix}The task page must be a safe http or https URL without embedded credentials.`);
    }
    return { ok: true, target };
}

function validateIdentifier(value, label, prefix) {
    if (value !== null && (value.length < 1 || value.length > 128 || !IDENTIFIER_PATTERN.test(value))) {
        return failure('INVALID_PARAMETER', `${prefix}The ${label} contains unsupported characters or is too long.`);
    }
    return { ok: true };
}

function validateInstructions(value, prefix) {
    if (value !== null && (value.length < 1 || value.length > 500)) {
        return failure('INVALID_PARAMETER', `${prefix}The task instructions are empty or too long.`);
    }
    return { ok: true };
}

// Reads the five override settings from a get(name) accessor. Returns
// { ok: true, overrides } or a failure with prefix-tagged message.
function validateOverrides(get, { radiusOptions, modeIds }, prefix) {
    const overrides = {};

    const radiusValue = get('fovea_radius_px');
    if (radiusValue !== null) {
        const radius = parseInteger(radiusValue);
        if (radius === null || !new Set(radiusOptions).has(radius)) {
            return failure('INVALID_PARAMETER', `${prefix}The requested foveal radius is not supported.`);
        }
        overrides.foveaRadiusPx = radius;
    }

    const modeValue = get('mode');
    if (modeValue !== null) {
        const mode = parseInteger(modeValue);
        if (mode === null || !new Set(modeIds).has(mode)) {
            return failure('INVALID_PARAMETER', `${prefix}The requested Scrutinizer mode is not supported.`);
        }
        overrides.mode = mode;
    }

    for (const [parameter, property] of [
        ['enabled', 'enabled'],
        ['comfort_mode', 'comfortMode']
    ]) {
        const value = get(parameter);
        if (value !== null) {
            const boolean = parseBoolean(value);
            if (boolean === null) {
                return failure('INVALID_PARAMETER', `${prefix}The ${parameter} setting must be true or false.`);
            }
            overrides[property] = boolean;
        }
    }

    const memoryValue = get('visual_memory_limit');
    if (memoryValue !== null) {
        const limit = parseInteger(memoryValue);
        if (limit === null || !VISUAL_MEMORY_LIMITS.has(limit)) {
            return failure('INVALID_PARAMETER', `${prefix}The requested Visual Memory setting is not supported.`);
        }
        overrides.visualMemoryLimit = limit;
    }

    return { ok: true, overrides };
}

// Validates one task's fields (shared by task/start and each session block).
// get(name) returns the raw value for a task-scoped field name or null.
function validateTask(get, options, prefix) {
    const targetResult = validateTargetUrl(get('url'), prefix);
    if (!targetResult.ok) return targetResult;

    const taskId = get('task_id');
    const idResult = validateIdentifier(taskId, 'task ID', prefix);
    if (!idResult.ok) return idResult;

    const instructions = get('instructions');
    const instructionsResult = validateInstructions(instructions, prefix);
    if (!instructionsResult.ok) return instructionsResult;

    const overridesResult = validateOverrides(get, options, prefix);
    if (!overridesResult.ok) return overridesResult;

    return {
        ok: true,
        task: {
            id: taskId,
            instructions,
            targetUrl: targetResult.target.toString(),
            origin: targetResult.target.origin,
            overrides: overridesResult.overrides
        }
    };
}

function unknownParameterFailure(key) {
    // Cap the echo: the key is attacker-controlled and unbounded, and
    // this message is rendered in a native dialog.
    const label = key.length > 64 ? `${key.slice(0, 64)}…` : key;
    return failure('UNKNOWN_PARAMETER', `The study link contains an unsupported setting: ${label}.`);
}

// Rejects duplicates and any key not accepted by isAllowed. Returns null on
// success or a failure result.
function checkParameterNames(searchParams, isAllowed) {
    const seen = new Set();
    for (const [key] of searchParams) {
        if (!isAllowed(key)) return unknownParameterFailure(key);
        if (seen.has(key)) {
            return failure('DUPLICATE_PARAMETER', `The study link repeats the ${key} setting.`);
        }
        seen.add(key);
    }
    return null;
}

function parseTaskStart(parsed, options) {
    const nameFailure = checkParameterNames(parsed.searchParams, (key) => TASK_PARAMETERS.has(key));
    if (nameFailure) return nameFailure;

    const result = validateTask((name) => parsed.searchParams.get(name), options, '');
    if (!result.ok) return result;

    const { overrides, ...task } = result.task;
    return {
        ok: true,
        value: {
            version: STUDY_VERSION,
            route: 'task/start',
            task,
            overrides
        }
    };
}

function parseSessionStart(parsed, options) {
    const nameFailure = checkParameterNames(
        parsed.searchParams,
        (key) => SESSION_PARAMETERS.has(key) || TASK_BLOCK_PATTERN.test(key)
    );
    if (nameFailure) return nameFailure;

    // Bucket task-block parameters by index.
    const taskParams = new Map();
    for (const [key, value] of parsed.searchParams) {
        const match = TASK_BLOCK_PATTERN.exec(key);
        if (!match) continue;
        const index = Number(match[1]);
        if (!taskParams.has(index)) taskParams.set(index, new Map());
        taskParams.get(index).set(match[2], value);
    }

    const count = taskParams.size;
    if (count < MIN_SESSION_TASKS) {
        return failure('TOO_FEW_TASKS', `A study session needs at least ${MIN_SESSION_TASKS} tasks. For a single task, use a task link instead.`);
    }
    if (count > MAX_SESSION_TASKS) {
        return failure('TOO_MANY_TASKS', `A study session supports at most ${MAX_SESSION_TASKS} tasks.`);
    }
    const maxIndex = Math.max(...taskParams.keys());
    if (maxIndex !== count) {
        return failure('NON_CONTIGUOUS_TASKS', 'Session task numbers must start at 1 with no gaps.');
    }

    const sessionId = parsed.searchParams.get('session_id');
    const sessionIdResult = validateIdentifier(sessionId, 'session ID', '');
    if (!sessionIdResult.ok) return sessionIdResult;

    const participantId = parsed.searchParams.get('participant_id');
    const participantIdResult = validateIdentifier(participantId, 'participant ID', '');
    if (!participantIdResult.ok) return participantIdResult;

    const defaultsResult = validateOverrides((name) => parsed.searchParams.get(name), options, '');
    if (!defaultsResult.ok) return defaultsResult;

    const tasks = [];
    for (let index = 1; index <= count; index++) {
        const fields = taskParams.get(index);
        const result = validateTask((name) => (fields.has(name) ? fields.get(name) : null), options, `Task ${index}: `);
        if (!result.ok) return result;
        tasks.push(result.task);
    }

    return {
        ok: true,
        value: {
            version: STUDY_VERSION,
            route: 'session/start',
            session: {
                id: sessionId,
                participantId,
                defaults: defaultsResult.overrides
            },
            tasks
        }
    };
}

function parseStudyDeepLink(rawUrl, { radiusOptions = [], modeIds = [] } = {}) {
    if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
        return failure('INVALID_URL', 'The study link is empty or invalid.');
    }
    if (rawUrl.length > MAX_RAW_LINK_LENGTH) {
        return failure('LINK_TOO_LONG', 'The study link is too long to open reliably.');
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

    const options = { radiusOptions, modeIds };
    if (parsed.pathname === TASK_START_PATH) return parseTaskStart(parsed, options);
    if (parsed.pathname === SESSION_START_PATH) return parseSessionStart(parsed, options);
    return failure('UNSUPPORTED_ROUTE', 'This Scrutinizer version does not support that study link type.');
}

module.exports = {
    STUDY_SCHEME,
    STUDY_VERSION,
    TASK_START_PATH,
    SESSION_START_PATH,
    MAX_RAW_LINK_LENGTH,
    MIN_SESSION_TASKS,
    MAX_SESSION_TASKS,
    parseStudyDeepLink
};
