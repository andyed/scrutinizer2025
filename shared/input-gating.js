'use strict';

/**
 * Pointer-input gating for capture runs.
 *
 * `TEST_MODE=true` means "this process is a headless capture harness," which
 * quietly conflated two independent questions:
 *
 *   1. Should the *physical* mouse drive the fovea? For gazeplot and golden
 *      captures, no — a hand resting on the trackpad contaminates the render.
 *   2. May *scripted* pointer input drive the fovea? For the same captures,
 *      yes — scripted trajectories are the whole point of the run.
 *
 * One flag cannot answer both, so there are two, plus a per-event provenance
 * tag so the shared IPC handler can tell a real device from a test driver:
 *
 *   SCRUTINIZER_PHYSICAL_POINTER = 'accept' | 'ignore'
 *       Default: 'ignore' under TEST_MODE, 'accept' otherwise.
 *   SCRUTINIZER_SCRIPTED_POINTER = 'accept' | 'ignore'
 *       Default: 'accept' always. Set 'ignore' to prove a capture is inert.
 *
 * Untagged events are physical. That is the honest default: a real device
 * cannot tag itself, so only code that knows it is synthesizing input says so.
 *
 * Unrecognized values fall back to the default rather than throwing — a typo
 * in a capture script should not kill the run — but `describe()` renders the
 * effective policy for a startup log line so the typo is visible in the output.
 *
 * Spec: docs/specs/cursor-trail-fidelity.md
 */

/** Event came from a real input device (or from code that did not say). */
const PHYSICAL = 'physical';

/** Event was synthesized by a test driver, replay runner, or capture script. */
const SCRIPTED = 'scripted';

const ACCEPT = 'accept';
const IGNORE = 'ignore';

const PHYSICAL_ENV = 'SCRUTINIZER_PHYSICAL_POINTER';
const SCRIPTED_ENV = 'SCRUTINIZER_SCRIPTED_POINTER';

/**
 * Read a policy env var, falling back when unset or unrecognized.
 *
 * @param {Object} env
 * @param {string} name - Env var name
 * @param {string} fallback - ACCEPT or IGNORE
 * @returns {string} ACCEPT or IGNORE
 */
function readPolicy(env, name, fallback) {
    const raw = env && typeof env[name] === 'string' ? env[name].trim().toLowerCase() : '';
    if (raw === ACCEPT || raw === IGNORE) return raw;
    return fallback;
}

/**
 * Is this process a headless capture harness?
 *
 * @param {Object} [env=process.env]
 * @returns {boolean}
 */
function isTestMode(env = process.env) {
    return !!env && env.TEST_MODE === 'true';
}

/**
 * Policy for physical device input. Ignored by default under TEST_MODE.
 *
 * @param {Object} [env=process.env]
 * @returns {string} ACCEPT or IGNORE
 */
function physicalPointerPolicy(env = process.env) {
    return readPolicy(env, PHYSICAL_ENV, isTestMode(env) ? IGNORE : ACCEPT);
}

/**
 * Policy for synthesized input. Accepted by default everywhere.
 *
 * @param {Object} [env=process.env]
 * @returns {string} ACCEPT or IGNORE
 */
function scriptedPointerPolicy(env = process.env) {
    return readPolicy(env, SCRIPTED_ENV, ACCEPT);
}

/**
 * Classify an event's provenance from its optional metadata argument.
 *
 * Anything that does not explicitly claim to be scripted is physical, so a
 * dropped or malformed metadata argument fails toward suppression under
 * TEST_MODE rather than silently contaminating a capture.
 *
 * @param {Object} [meta] - Trailing IPC metadata, e.g. `{ source: 'scripted' }`
 * @returns {string} PHYSICAL or SCRIPTED
 */
function pointerSource(meta) {
    if (meta && typeof meta === 'object' && meta.source === SCRIPTED) return SCRIPTED;
    return PHYSICAL;
}

/**
 * Should a pointer event from this source reach the fovea?
 *
 * @param {string} source - PHYSICAL or SCRIPTED (see pointerSource)
 * @param {Object} [env=process.env]
 * @returns {boolean}
 */
function acceptsPointer(source, env = process.env) {
    const policy = source === SCRIPTED ? scriptedPointerPolicy(env) : physicalPointerPolicy(env);
    return policy === ACCEPT;
}

/**
 * One-line rendering of the effective policy, for a startup log.
 *
 * @param {Object} [env=process.env]
 * @returns {string}
 */
function describe(env = process.env) {
    return `physical=${physicalPointerPolicy(env)} scripted=${scriptedPointerPolicy(env)}` +
        `${isTestMode(env) ? ' (TEST_MODE)' : ''}`;
}

module.exports = {
    PHYSICAL,
    SCRIPTED,
    ACCEPT,
    IGNORE,
    PHYSICAL_ENV,
    SCRIPTED_ENV,
    isTestMode,
    physicalPointerPolicy,
    scriptedPointerPolicy,
    pointerSource,
    acceptsPointer,
    describe
};
