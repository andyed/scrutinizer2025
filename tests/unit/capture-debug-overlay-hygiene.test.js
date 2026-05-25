/**
 * Regression guard for CODEBASE_MAP gotcha #15.
 *
 * Visual debug overlays (Eccentricity Overlay, Structure Map view, Saliency
 * Map view) show raw input maps WITHOUT foveal distortion, LGN gating, or
 * visual memory — they misrepresent the foveation pipeline. They ship as
 * menu items deliberately, but a stray `overlay: true` or `mode: 'saliency'`
 * in a non-debug capture spec would land a polluted artifact in
 * tests/golden-captures/ that misleads downstream analysis.
 *
 * This test scans every `scripts/capture-*.js` for shot-spec literals and
 * enforces: if a shot enables debug rendering, its filename must declare it
 * (e.g. `_saliency.png`, `_structure.png`, `_eccentricity.png`, `_overlay.png`,
 * `_debug.png`, `_congestion.png`). Otherwise the spec is suspect.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SCRIPTS_DIR = path.resolve(__dirname, '../../scripts');
const DEBUG_MODE_STRINGS = ['saliency', 'structure', 'congestion_overlay', 'congestion_solo'];
const DEBUG_FILENAME_TOKENS = ['saliency', 'structure', 'eccentricity', 'overlay', 'debug', 'congestion'];

function findCaptureScripts() {
    return fs.readdirSync(SCRIPTS_DIR)
        .filter(f => f.startsWith('capture-') && f.endsWith('.js'))
        .map(f => path.join(SCRIPTS_DIR, f));
}

/**
 * Pull out shot-spec object literals from a capture script.
 * Each spec looks like `{ filename: '...', url: '...', mode: '...', overlay: ..., ... }`.
 * We don't run the script — we walk its source so the test is hermetic.
 */
function extractShotSpecs(source) {
    const specs = [];
    // Naive but effective: find every `filename: '...'` and grab a 600-char window
    // around it. Big enough to include the rest of the spec, small enough that
    // adjacent specs don't bleed in (specs are typically <250 chars).
    const fnRe = /filename\s*:\s*['"`]([^'"`]+\.png)['"`]/g;
    let m;
    while ((m = fnRe.exec(source)) !== null) {
        const filename = m[1];
        const start = Math.max(0, m.index - 50);
        const end = Math.min(source.length, m.index + 600);
        const window = source.slice(start, end);
        // Walk a brace-balanced range around the filename to bound this spec.
        // We don't need perfect parsing — we just need the assignments local to this spec.
        const overlayMatch = window.match(/overlay\s*:\s*(true|false)/);
        const modeMatch = window.match(/mode\s*:\s*['"`]([^'"`]+)['"`]/);
        specs.push({
            filename,
            overlay: overlayMatch ? overlayMatch[1] === 'true' : null,
            mode: modeMatch ? modeMatch[1] : null,
        });
    }
    return specs;
}

describe('capture-script debug-overlay hygiene (CODEBASE_MAP gotcha #15)', () => {
    const scripts = findCaptureScripts();

    it('finds capture scripts to scan', () => {
        expect(scripts.length).toBeGreaterThan(0);
    });

    it.each(scripts.map(p => [path.basename(p), p]))(
        '%s: debug-enabling shots declare it in the filename',
        (_name, filepath) => {
            const source = fs.readFileSync(filepath, 'utf-8');
            const specs = extractShotSpecs(source);
            const violations = [];
            for (const spec of specs) {
                const declaresDebug = DEBUG_FILENAME_TOKENS.some(t =>
                    spec.filename.toLowerCase().includes(t)
                );
                const enablesOverlay = spec.overlay === true;
                const enablesDebugMode = spec.mode && DEBUG_MODE_STRINGS.includes(spec.mode);
                if ((enablesOverlay || enablesDebugMode) && !declaresDebug) {
                    violations.push(
                        `${spec.filename}: overlay=${spec.overlay} mode=${spec.mode} ` +
                        `— enables debug rendering but filename does not declare it ` +
                        `(expected one of: ${DEBUG_FILENAME_TOKENS.join(', ')})`
                    );
                }
            }
            if (violations.length) {
                throw new Error(
                    `Debug-overlay hygiene violations in ${path.basename(filepath)}:\n  ` +
                    violations.join('\n  ')
                );
            }
        }
    );
});
