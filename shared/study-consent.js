'use strict';

/**
 * Study consent (P3-5): the pure half of the consent/debrief flow.
 *
 * The consent and debrief screens are states of the bundled study interstitial
 * (renderer/study-interstitial.html). That page has no IPC, so it answers the
 * main process by navigating to sentinel URLs on the reserved `.invalid` TLD,
 * which main.js intercepts in will-navigate and cancels. This module owns the
 * sentinel grammar, the participant-code rule, and the consent record stamped
 * into the session envelope, so all three are testable without Electron.
 *
 * Spec: docs/specs/usability-study-multi-task-sessions.md §Consent and debrief.
 */

/**
 * Identifies the exact consent wording shown on screen. The interstitial
 * carries the same string (guard-tested), so a recorded session says which
 * text the participant agreed to. Bump it whenever the consent copy changes.
 */
const CONSENT_TEXT_VERSION = 'scrutinizer-consent/1';

const STUDY_CONSENT_URL = 'https://consent.study.scrutinizer.invalid/';
const STUDY_DECLINE_URL = 'https://decline.study.scrutinizer.invalid/';

/** Where the participant code on a consent record came from. */
const PARTICIPANT_ID_SOURCES = ['link', 'consent_screen'];

// Same rule as `participant_id` in shared/study-deep-link.js (IDENTIFIER_PATTERN
// plus the 1–128 length bound). Duplicated rather than imported because the
// parser is vendored byte-identical into scrutinizer-www; a parity test pins
// the two together.
const PARTICIPANT_CODE_PATTERN = /^[A-Za-z0-9._-]+$/;
const PARTICIPANT_CODE_MAX = 128;

function isValidParticipantCode(value) {
    return typeof value === 'string' &&
        value.length >= 1 &&
        value.length <= PARTICIPANT_CODE_MAX &&
        PARTICIPANT_CODE_PATTERN.test(value);
}

/**
 * Classify a navigation target.
 *
 * @param {string} url
 * @returns {null | {action: 'agree', participantId: string|null} | {action: 'decline'}}
 *   null when the URL is not a consent sentinel. An agree whose code is
 *   missing or malformed returns participantId null; the caller decides
 *   whether the link already supplied one.
 */
function parseConsentSentinel(url) {
    if (typeof url !== 'string') return null;
    if (url === STUDY_DECLINE_URL || url.startsWith(STUDY_DECLINE_URL)) {
        return { action: 'decline' };
    }
    if (url !== STUDY_CONSENT_URL && !url.startsWith(`${STUDY_CONSENT_URL}?`)) return null;
    let code = null;
    try {
        code = new URL(url).searchParams.get('participant');
    } catch {
        code = null;
    }
    return { action: 'agree', participantId: isValidParticipantCode(code) ? code : null };
}

/**
 * Resolve which participant code a session runs under once consent is given.
 * A code from the study link wins: the moderator set it deliberately, and the
 * consent page shows it read-only. Otherwise the code typed on the consent
 * screen is required.
 *
 * @param {string|null} linkParticipantId
 * @param {string|null} screenParticipantId
 * @returns {{ok: true, participantId: string, source: string} | {ok: false}}
 */
function resolveConsentParticipant(linkParticipantId, screenParticipantId) {
    if (isValidParticipantCode(linkParticipantId)) {
        return { ok: true, participantId: linkParticipantId, source: 'link' };
    }
    if (isValidParticipantCode(screenParticipantId)) {
        return { ok: true, participantId: screenParticipantId, source: 'consent_screen' };
    }
    return { ok: false };
}

/**
 * The consent record written into the session envelope.
 *
 * @param {{consentedAtMs: number, participantIdSource: string}} input
 */
function buildConsentRecord({ consentedAtMs, participantIdSource }) {
    return {
        textVersion: CONSENT_TEXT_VERSION,
        consentedAt: new Date(consentedAtMs).toISOString(),
        participantIdSource
    };
}

module.exports = {
    CONSENT_TEXT_VERSION,
    STUDY_CONSENT_URL,
    STUDY_DECLINE_URL,
    PARTICIPANT_ID_SOURCES,
    PARTICIPANT_CODE_MAX,
    isValidParticipantCode,
    parseConsentSentinel,
    resolveConsentParticipant,
    buildConsentRecord
};
