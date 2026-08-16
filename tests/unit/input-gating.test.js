'use strict';

/**
 * Pointer input-gating policy (shared/input-gating.js).
 *
 * The behavior that matters: a TEST_MODE capture ignores the physical mouse
 * while still accepting scripted trajectories, and an untagged event is treated
 * as physical so a dropped metadata argument fails toward suppression rather
 * than toward a contaminated capture.
 *
 * Spec: docs/specs/cursor-trail-fidelity.md
 */

const gating = require('../../shared/input-gating');

const { PHYSICAL, SCRIPTED, ACCEPT, IGNORE } = gating;

describe('pointer input gating', () => {
    describe('default policy', () => {
        test('interactive run accepts physical input', () => {
            expect(gating.physicalPointerPolicy({})).toBe(ACCEPT);
        });

        test('TEST_MODE ignores physical input', () => {
            expect(gating.physicalPointerPolicy({ TEST_MODE: 'true' })).toBe(IGNORE);
        });

        test('scripted input is accepted in both', () => {
            expect(gating.scriptedPointerPolicy({})).toBe(ACCEPT);
            expect(gating.scriptedPointerPolicy({ TEST_MODE: 'true' })).toBe(ACCEPT);
        });

        test('TEST_MODE only counts when the value is exactly "true"', () => {
            expect(gating.physicalPointerPolicy({ TEST_MODE: '1' })).toBe(ACCEPT);
            expect(gating.physicalPointerPolicy({ TEST_MODE: 'TRUE' })).toBe(ACCEPT);
        });
    });

    describe('explicit override', () => {
        test('physical input can be re-enabled inside TEST_MODE', () => {
            const env = { TEST_MODE: 'true', SCRUTINIZER_PHYSICAL_POINTER: 'accept' };
            expect(gating.physicalPointerPolicy(env)).toBe(ACCEPT);
        });

        test('physical input can be suppressed outside TEST_MODE', () => {
            expect(gating.physicalPointerPolicy({ SCRUTINIZER_PHYSICAL_POINTER: 'ignore' })).toBe(IGNORE);
        });

        test('scripted input can be suppressed to prove a capture is inert', () => {
            expect(gating.scriptedPointerPolicy({ SCRUTINIZER_SCRIPTED_POINTER: 'ignore' })).toBe(IGNORE);
        });

        test('values are case- and whitespace-insensitive', () => {
            expect(gating.physicalPointerPolicy({ SCRUTINIZER_PHYSICAL_POINTER: '  IGNORE ' })).toBe(IGNORE);
        });

        test('unrecognized values fall back to the default, not to a throw', () => {
            expect(gating.physicalPointerPolicy({ SCRUTINIZER_PHYSICAL_POINTER: 'yes' })).toBe(ACCEPT);
            expect(gating.physicalPointerPolicy({
                TEST_MODE: 'true', SCRUTINIZER_PHYSICAL_POINTER: 'yes'
            })).toBe(IGNORE);
        });
    });

    describe('provenance', () => {
        test('explicit scripted metadata is honored', () => {
            expect(gating.pointerSource({ source: 'scripted' })).toBe(SCRIPTED);
        });

        test.each([
            ['missing', undefined],
            ['null', null],
            ['empty object', {}],
            ['unknown source', { source: 'wat' }],
            ['non-object', 'scripted']
        ])('%s metadata is treated as physical', (_label, meta) => {
            expect(gating.pointerSource(meta)).toBe(PHYSICAL);
        });
    });

    describe('acceptsPointer', () => {
        test('the capture case: physical suppressed, scripted still drives the fovea', () => {
            const env = { TEST_MODE: 'true' };
            expect(gating.acceptsPointer(PHYSICAL, env)).toBe(false);
            expect(gating.acceptsPointer(SCRIPTED, env)).toBe(true);
        });

        test('the interactive case: both accepted', () => {
            expect(gating.acceptsPointer(PHYSICAL, {})).toBe(true);
            expect(gating.acceptsPointer(SCRIPTED, {})).toBe(true);
        });

        test('an untagged event in TEST_MODE is dropped', () => {
            const env = { TEST_MODE: 'true' };
            expect(gating.acceptsPointer(gating.pointerSource(undefined), env)).toBe(false);
        });
    });

    describe('describe', () => {
        test('renders the effective policy and flags TEST_MODE', () => {
            expect(gating.describe({ TEST_MODE: 'true' }))
                .toBe('physical=ignore scripted=accept (TEST_MODE)');
            expect(gating.describe({})).toBe('physical=accept scripted=accept');
        });
    });
});
