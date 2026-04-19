/**
 * Temporal variance regression — mode-20 motion-artifact ceiling.
 *
 * This test reads the JSON report produced by:
 *   node scripts/capture-temporal-variance.js
 *   uv run --python 3.12 scripts/validate-temporal-variance.py
 *
 * and asserts that the DOM-aware compositor's frame-to-frame variance in
 * the parafovea (1°–2°) and near periphery (2°–5°) does not exceed a
 * configurable multiple of the mode-16 baseline. A ratio > ceiling suggests
 * mode 20's sharp-edged procedural stripe field is producing enough
 * blend-weight shimmer with small gaze drifts to trigger peripheral
 * motion-onset attention capture (Abrams & Christ 2003; Franconeri & Simons
 * 2003) — the empirical gauge that tells us whether the compositor is
 * "inert" in the periphery or accidentally adding attention-capturing noise.
 *
 * The test is SKIPPED when the report isn't present, so npm test doesn't
 * force everyone to run the full capture pipeline. CI (or a local developer
 * running before a release) should invoke:
 *   npm run test:temporal-variance
 * which runs capture → analyze → unit in sequence.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join(
    __dirname, '..', 'temporal-variance', 'temporal-variance-report.json'
);

// Same threshold the Python analyzer uses by default. Kept in sync by
// convention — the analyzer writes its ceiling into the JSON report, so
// this test reads it from the report and doesn't hard-code.
const MOTION_SENSITIVE_BANDS = ['parafovea', 'near_peri'];

describe('Temporal variance — DOM-aware mode 20 motion-artifact ceiling', () => {
    if (!fs.existsSync(REPORT_PATH)) {
        test.skip('report not present — run `npm run test:temporal-variance` to generate', () => {});
        return;
    }

    const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
    const ceiling = report.ceiling;
    const baselineMode = report.baseline_mode;

    test('report carries the expected shape', () => {
        expect(report.per_mode).toBeDefined();
        expect(report.ratios).toBeDefined();
        expect(report.ratios['20']).toBeDefined();
        expect(typeof ceiling).toBe('number');
    });

    test(`mode 20 vs mode ${baselineMode}: motion-sensitive bands within ${report.ceiling}×`, () => {
        const ratios = report.ratios['20'];
        for (const band of MOTION_SENSITIVE_BANDS) {
            const r = ratios[band];
            // Skip NaN (band empty in the capture — rare; shouldn't fail the build)
            if (typeof r !== 'number' || Number.isNaN(r)) continue;
            expect(r).toBeLessThanOrEqual(ceiling);
        }
    });

    test('Python analyzer reported no failures for mode 20', () => {
        // Only mode-20 ratios are the subject of this regression. The analyzer
        // also emits failures for other (mode, band) pairs when they exceed
        // the ceiling — those are legitimate diagnostic signals (mode 16 vs
        // baseline 15 is naturally noisy because mode 16 is pre-TTM quiet
        // pipeline and 15 is TTM-synthesis-active). Filter them out here;
        // the test should only fail on mode-20-specific regressions.
        const mode20Failures = report.failures.filter(f => f.startsWith('mode 20 '));
        expect(mode20Failures).toEqual([]);
    });
});
