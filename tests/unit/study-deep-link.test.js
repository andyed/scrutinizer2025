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

function parseSession(query) {
    return parseStudyDeepLink(`scrutinizer://v1/session/start?${query}`, OPTIONS);
}

function taskBlock(index, url = `https://example.com/task${index}`) {
    return `t${index}.url=${encodeURIComponent(url)}`;
}

describe('study session deep-link parser', () => {
    it('parses a minimal two-task session', () => {
        const result = parseSession(`${taskBlock(1)}&${taskBlock(2)}`);

        expect(result).toEqual({
            ok: true,
            value: {
                version: 'v1',
                route: 'session/start',
                session: { id: null, participantId: null, defaults: {} },
                tasks: [
                    {
                        id: null,
                        instructions: null,
                        targetUrl: 'https://example.com/task1',
                        origin: 'https://example.com',
                        overrides: {}
                    },
                    {
                        id: null,
                        instructions: null,
                        targetUrl: 'https://example.com/task2',
                        origin: 'https://example.com',
                        overrides: {}
                    }
                ]
            }
        });
    });

    it('parses session defaults, IDs, and per-task overrides', () => {
        const result = parseSession([
            'session_id=nav-study',
            'participant_id=P04',
            'mode=12',
            'fovea_radius_px=45',
            'visual_memory_limit=5',
            taskBlock(1),
            't1.task_id=find-billing',
            `t1.instructions=${encodeURIComponent('Change the billing address.')}`,
            taskBlock(2),
            't2.mode=20',
            't2.enabled=false',
            't2.comfort_mode=true',
            't2.visual_memory_limit=0',
            't2.fovea_radius_px=70'
        ].join('&'));

        expect(result.ok).toBe(true);
        expect(result.value.session).toEqual({
            id: 'nav-study',
            participantId: 'P04',
            defaults: { mode: 12, foveaRadiusPx: 45, visualMemoryLimit: 5 }
        });
        expect(result.value.tasks[0]).toMatchObject({
            id: 'find-billing',
            instructions: 'Change the billing address.',
            overrides: {}
        });
        expect(result.value.tasks[1].overrides).toEqual({
            mode: 20,
            enabled: false,
            comfortMode: true,
            visualMemoryLimit: 0,
            foveaRadiusPx: 70
        });
    });

    it('parses a maximal eight-task session', () => {
        const query = Array.from({ length: 8 }, (_, i) => taskBlock(i + 1)).join('&');
        const result = parseSession(query);
        expect(result.ok).toBe(true);
        expect(result.value.tasks).toHaveLength(8);
    });

    it('rejects a raw link over the length cap', () => {
        const padded = `${taskBlock(1)}&${taskBlock(2)}&session_id=${'a'.repeat(9000)}`;
        const result = parseSession(padded);
        expect(result).toMatchObject({ ok: false, error: { code: 'LINK_TOO_LONG' } });
    });

    it('rejects fewer than two tasks', () => {
        expect(parseSession(taskBlock(1))).toMatchObject({
            ok: false,
            error: { code: 'TOO_FEW_TASKS' }
        });
    });

    it('rejects more than eight tasks', () => {
        const query = Array.from({ length: 9 }, (_, i) => taskBlock(i + 1)).join('&');
        expect(parseSession(query)).toMatchObject({
            ok: false,
            error: { code: 'TOO_MANY_TASKS' }
        });
    });

    it('rejects non-contiguous task indices', () => {
        expect(parseSession(`${taskBlock(1)}&${taskBlock(3)}`)).toMatchObject({
            ok: false,
            error: { code: 'NON_CONTIGUOUS_TASKS' }
        });
    });

    it('rejects malformed task prefixes as unknown parameters', () => {
        for (const bad of ['t0.url=https%3A%2F%2Fexample.com', 't01.url=https%3A%2F%2Fexample.com', 't1.speed=fast', 'turl=x']) {
            expect(parseSession(`${taskBlock(1)}&${taskBlock(2)}&${bad}`)).toMatchObject({
                ok: false,
                error: { code: 'UNKNOWN_PARAMETER' }
            });
        }
    });

    it('rejects duplicated task parameters', () => {
        expect(parseSession(`${taskBlock(1)}&${taskBlock(1)}&${taskBlock(2)}`)).toMatchObject({
            ok: false,
            error: { code: 'DUPLICATE_PARAMETER' }
        });
    });

    it('names the failing task in error messages and fails atomically', () => {
        const missing = parseSession(`${taskBlock(1)}&t2.task_id=orphan`);
        expect(missing).toMatchObject({ ok: false, error: { code: 'MISSING_TARGET_URL' } });
        expect(missing.error.message).toContain('Task 2:');

        const badMode = parseSession(`${taskBlock(1)}&${taskBlock(2)}&t2.mode=999`);
        expect(badMode).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMETER' } });
        expect(badMode.error.message).toContain('Task 2:');
    });

    it('validates task blocks with the same rules as single-task links', () => {
        expect(parseSession(`${taskBlock(1)}&t2.url=${encodeURIComponent('file:///etc/passwd')}`)).toMatchObject({
            ok: false,
            error: { code: 'UNSAFE_TARGET_URL' }
        });
        expect(parseSession(`${taskBlock(1)}&t2.url=${encodeURIComponent('https://user:pw@example.com')}`)).toMatchObject({
            ok: false,
            error: { code: 'UNSAFE_TARGET_URL' }
        });
    });

    it('rejects invalid session and participant IDs', () => {
        expect(parseSession(`${taskBlock(1)}&${taskBlock(2)}&session_id=${encodeURIComponent('has spaces')}`)).toMatchObject({
            ok: false,
            error: { code: 'INVALID_PARAMETER' }
        });
        expect(parseSession(`${taskBlock(1)}&${taskBlock(2)}&participant_id=${'p'.repeat(129)}`)).toMatchObject({
            ok: false,
            error: { code: 'INVALID_PARAMETER' }
        });
    });

    it('rejects task-block parameters on the task/start route', () => {
        expect(parse(`url=${encodeURIComponent('https://example.com')}&t1.url=${encodeURIComponent('https://example.com')}`)).toMatchObject({
            ok: false,
            error: { code: 'UNKNOWN_PARAMETER' }
        });
    });
});
