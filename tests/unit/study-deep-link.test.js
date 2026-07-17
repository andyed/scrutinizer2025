'use strict';

const { parseStudyDeepLink } = require('../../shared/study-deep-link');

const OPTIONS = {
    radiusOptions: [20, 45, 70, 90],
    modeIds: [0, 12, 20]
};

function parse(query) {
    return parseStudyDeepLink(`scrutinizer://v1/task/start?${query}`, OPTIONS);
}

describe('study deep-link parser', () => {
    it('parses a minimal task link', () => {
        const result = parse(`url=${encodeURIComponent('https://example.com/account?tab=billing#card')}`);

        expect(result).toEqual({
            ok: true,
            value: {
                version: 'v1',
                route: 'task/start',
                task: {
                    id: null,
                    instructions: null,
                    targetUrl: 'https://example.com/account?tab=billing#card',
                    origin: 'https://example.com'
                },
                overrides: {}
            }
        });
    });

    it('parses every supported override and Unicode instructions', () => {
        const result = parse([
            `url=${encodeURIComponent('https://example.com/')}`,
            'task_id=checkout-01',
            `instructions=${encodeURIComponent('Where would you go? → Billing')}`,
            'fovea_radius_px=45',
            'mode=12',
            'enabled=false',
            'comfort_mode=true',
            'visual_memory_limit=-1'
        ].join('&'));

        expect(result.ok).toBe(true);
        expect(result.value.task.id).toBe('checkout-01');
        expect(result.value.task.instructions).toBe('Where would you go? → Billing');
        expect(result.value.overrides).toEqual({
            foveaRadiusPx: 45,
            mode: 12,
            enabled: false,
            comfortMode: true,
            visualMemoryLimit: -1
        });
    });

    test.each([
        ['not a URL', 'INVALID_URL'],
        ['https://v1/task/start?url=https%3A%2F%2Fexample.com', 'UNSUPPORTED_SCHEME'],
        ['scrutinizer://v2/task/start?url=https%3A%2F%2Fexample.com', 'UNSUPPORTED_VERSION'],
        ['scrutinizer://v1/study/run?url=https%3A%2F%2Fexample.com', 'UNSUPPORTED_ROUTE']
    ])('rejects %s', (raw, code) => {
        expect(parseStudyDeepLink(raw, OPTIONS)).toMatchObject({ ok: false, error: { code } });
    });

    test.each(['file:///tmp/a', 'javascript:alert(1)', 'data:text/html,hello', '/relative', 'https://user:pass@example.com'])
        ('rejects unsafe target %s', (target) => {
            expect(parse(`url=${encodeURIComponent(target)}`)).toMatchObject({
                ok: false,
                error: { code: 'UNSAFE_TARGET_URL' }
            });
        });

    it('rejects missing, unknown, and duplicate parameters', () => {
        expect(parse('task_id=x')).toMatchObject({ ok: false, error: { code: 'MISSING_TARGET_URL' } });
        expect(parse('url=https%3A%2F%2Fexample.com&raduis=45')).toMatchObject({ ok: false, error: { code: 'UNKNOWN_PARAMETER' } });
        expect(parse('url=https%3A%2F%2Fexample.com&mode=12&mode=0')).toMatchObject({ ok: false, error: { code: 'DUPLICATE_PARAMETER' } });
    });

    it('truncates over-length unknown parameter names in the error message', () => {
        // The key is attacker-controlled and the message reaches a native dialog.
        const result = parse(`url=https%3A%2F%2Fexample.com&${'k'.repeat(300)}=1`);
        expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN_PARAMETER' } });
        expect(result.error.message).toContain(`${'k'.repeat(64)}…`);
        expect(result.error.message).not.toContain('k'.repeat(65));
    });

    test.each([
        ['fovea_radius_px', '44'],
        ['fovea_radius_px', '45.0'],
        ['mode', '99'],
        ['mode', '12junk'],
        ['enabled', '1'],
        ['enabled', 'TRUE'],
        ['comfort_mode', 'yes'],
        ['visual_memory_limit', '3']
    ])('rejects invalid %s=%s', (key, value) => {
        expect(parse(`url=https%3A%2F%2Fexample.com&${key}=${value}`)).toMatchObject({
            ok: false,
            error: { code: 'INVALID_PARAMETER' }
        });
    });

    it('rejects invalid task metadata and over-length values', () => {
        expect(parse('url=https%3A%2F%2Fexample.com&task_id=has%20spaces')).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMETER' } });
        expect(parse(`url=https%3A%2F%2Fexample.com&instructions=${'x'.repeat(501)}`)).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMETER' } });
        expect(parse(`url=${encodeURIComponent(`https://example.com/${'x'.repeat(4090)}`)}`)).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMETER' } });
    });
});
