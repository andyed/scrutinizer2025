'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
    CONSENT_TEXT_VERSION,
    STUDY_CONSENT_URL,
    STUDY_DECLINE_URL,
    PARTICIPANT_ID_SOURCES,
    isValidParticipantCode,
    parseConsentSentinel,
    resolveConsentParticipant,
    buildConsentRecord
} = require('../../shared/study-consent');
const { parseStudyDeepLink } = require('../../shared/study-deep-link');
const {
    buildEnvelope,
    validateEnvelope,
    CONSENT_PARTICIPANT_SOURCES
} = require('../../shared/session-capture');

const ROOT = path.resolve(__dirname, '../..');
const interstitial = fs.readFileSync(path.join(ROOT, 'renderer/study-interstitial.html'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

// The visible consent wording, tags stripped and whitespace collapsed, so
// markup and styling changes do not count as a wording change.
function consentWording(html) {
    const section = html.match(/<section id="consent"[\s\S]*?<\/section>/);
    if (!section) throw new Error('consent section not found');
    return section[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// One entry per shipped consent text. A participant agreed to the wording
// whose version their envelope records, so changing the wording under an
// existing version misstates what they saw.
const PINNED_WORDING = {
    'scrutinizer-consent/1': '4f68d73d4ea36c66fc70589078722866b0a42283d1687a53fb83e3f71e8ecafc'
};

describe('participant code rule', () => {
    it('accepts anonymous codes', () => {
        for (const code of ['P07', 'p-07', 'site_a.P07', 'x'.repeat(128)]) {
            expect(isValidParticipantCode(code)).toBe(true);
        }
    });

    it('rejects empty, spaced, over-length, and non-string values', () => {
        for (const code of ['', 'Jane Doe', 'P07!', 'x'.repeat(129), null, undefined, 7]) {
            expect(isValidParticipantCode(code)).toBe(false);
        }
    });

    it('matches the deep-link participant_id rule exactly', () => {
        const options = { radiusOptions: [45], modeIds: [12] };
        const tasks = 't1.url=https%3A%2F%2Fexample.com&t2.url=https%3A%2F%2Fexample.org';
        for (const code of ['P07', 'site_a.P07', 'x'.repeat(128), 'x'.repeat(129), 'Jane Doe', 'P07!']) {
            const link = `scrutinizer://v1/session/start?participant_id=${encodeURIComponent(code)}&${tasks}`;
            expect(parseStudyDeepLink(link, options).ok).toBe(isValidParticipantCode(code));
        }
    });
});

describe('parseConsentSentinel', () => {
    it('ignores ordinary navigations', () => {
        expect(parseConsentSentinel('https://example.com/')).toBeNull();
        expect(parseConsentSentinel('https://begin.study.scrutinizer.invalid/')).toBeNull();
        expect(parseConsentSentinel('https://consent.study.scrutinizer.invalid.example.com/')).toBeNull();
        expect(parseConsentSentinel(undefined)).toBeNull();
    });

    it('reads an agree with its participant code', () => {
        expect(parseConsentSentinel(`${STUDY_CONSENT_URL}?participant=P07`))
            .toEqual({ action: 'agree', participantId: 'P07' });
    });

    it('drops a malformed or missing code instead of passing it through', () => {
        expect(parseConsentSentinel(`${STUDY_CONSENT_URL}?participant=Jane%20Doe`))
            .toEqual({ action: 'agree', participantId: null });
        expect(parseConsentSentinel(STUDY_CONSENT_URL))
            .toEqual({ action: 'agree', participantId: null });
    });

    it('reads a decline', () => {
        expect(parseConsentSentinel(STUDY_DECLINE_URL)).toEqual({ action: 'decline' });
    });
});

describe('resolveConsentParticipant', () => {
    it('prefers the code the study link set', () => {
        expect(resolveConsentParticipant('P07', 'P99'))
            .toEqual({ ok: true, participantId: 'P07', source: 'link' });
    });

    it('takes the typed code when the link set none', () => {
        expect(resolveConsentParticipant(null, 'P99'))
            .toEqual({ ok: true, participantId: 'P99', source: 'consent_screen' });
    });

    it('refuses consent without any valid code', () => {
        expect(resolveConsentParticipant(null, null)).toEqual({ ok: false });
        expect(resolveConsentParticipant(null, 'Jane Doe')).toEqual({ ok: false });
    });
});

describe('consent record in the session envelope', () => {
    const record = buildConsentRecord({
        consentedAtMs: Date.parse('2026-09-30T21:00:00.000Z'),
        participantIdSource: 'consent_screen'
    });

    function envelope(consent) {
        return buildEnvelope({
            sessionId: 'walkup',
            participantId: 'P07',
            startedAt: '2026-09-30T21:00:00.000Z',
            tasks: [{ taskId: 'find-menu', settings: {}, events: [] }],
            capture: {
                evtrackVersion: 'cabb3b7', pollMs: 16, devicePixelRatio: 2,
                screen: { w: 1512, h: 982 }, window: { w: 1280, h: 800 }
            },
            consent
        });
    }

    it('stamps the text version, the time, and where the code came from', () => {
        expect(record).toEqual({
            textVersion: CONSENT_TEXT_VERSION,
            consentedAt: '2026-09-30T21:00:00.000Z',
            participantIdSource: 'consent_screen'
        });
        expect(envelope(record).consent).toEqual(record);
        expect(validateEnvelope(envelope(record)).ok).toBe(true);
    });

    it('keeps sessions captured before consent shipped admissible', () => {
        const legacy = envelope(undefined);
        expect(legacy.consent).toBeNull();
        expect(validateEnvelope(legacy).ok).toBe(true);
        delete legacy.consent;
        expect(validateEnvelope(legacy).ok).toBe(true);
    });

    it('rejects a partial or off-vocabulary record', () => {
        const partial = validateEnvelope(envelope({ textVersion: CONSENT_TEXT_VERSION }));
        expect(partial.ok).toBe(false);
        expect(partial.errors.join('\n')).toMatch(/consent\.consentedAt/);
        expect(partial.errors.join('\n')).toMatch(/consent\.participantIdSource/);
        const offVocab = validateEnvelope(envelope(Object.assign({}, record, { participantIdSource: 'moderator' })));
        expect(offVocab.ok).toBe(false);
    });

    it('keeps the vendored envelope vocabulary in step with the consent module', () => {
        expect(CONSENT_PARTICIPANT_SOURCES).toEqual(PARTICIPANT_ID_SOURCES);
    });
});

describe('consent and debrief screens', () => {
    it('declares the consent version the record stamps', () => {
        expect(interstitial).toContain(
            `<meta name="scrutinizer-consent-version" content="${CONSENT_TEXT_VERSION}">`);
    });

    it('pins the consent wording to its version', () => {
        const digest = crypto.createHash('sha256').update(consentWording(interstitial)).digest('hex');
        // If this fails, the consent copy changed: bump CONSENT_TEXT_VERSION
        // (here, in shared/study-consent.js and in the page's meta tag) and
        // add the new digest as a new entry. Never rewrite an old entry.
        expect(PINNED_WORDING[CONSENT_TEXT_VERSION]).toBe(digest);
    });

    it('navigates to the same sentinels main.js intercepts', () => {
        expect(interstitial).toContain(`const CONSENT_URL = '${STUDY_CONSENT_URL}'`);
        expect(interstitial).toContain(`const DECLINE_URL = '${STUDY_DECLINE_URL}'`);
        expect(main).toContain('parseConsentSentinel(url)');
        expect(main).toContain('acceptStudyConsent(win, consent.participantId)');
        expect(main).toContain('declineStudyConsent(win)');
    });

    it('applies the same participant code rule on the page', () => {
        expect(interstitial).toContain('const CODE_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;');
    });

    it('opens every session on consent and writes nothing without it', () => {
        expect(main).toContain("phase: 'consent',");
        expect(main).toMatch(/if \(study\.kind === 'session' && !study\.consent\) \{[\s\S]{0,200}return;/);
        expect(main).toContain('if (!activeStudy.consent) return;');
    });

    it('renders untrusted values with textContent only', () => {
        expect(interstitial).not.toContain('innerHTML');
        expect(interstitial).not.toContain('insertAdjacentHTML');
        expect(interstitial).not.toContain('document.write');
    });
});
