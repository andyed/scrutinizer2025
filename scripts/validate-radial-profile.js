#!/usr/bin/env node
/**
 * Radial Contrast Profile — continuous degradation curve measurement.
 *
 * Measures Oklab luminance standard deviation at fine radial intervals
 * from fixation outward. This IS the curve that corticalStrength() will
 * reshape. Zone-based boundaries produce steps; continuous functions
 * produce smooth curves. The test captures both.
 *
 * Usage:
 *   node scripts/validate-radial-profile.js [options]
 *     --screenshot <path>   Processed screenshot (default: latest smoke_dashboard_mode<default>)
 *     --stimulus <class>    'flat' | 'uniform' | 'content'. Overrides filename
 *                           auto-detect. Selects which assertions are well-posed:
 *                           'uniform' asserts monotonic decline; 'content' runs
 *                           monotonic as a non-fatal diagnostic + baseline drift;
 *                           'flat' asserts no spurious peripheral injection.
 *                           Each class has its own frozen baseline. See
 *                           classifyStimulus (P0-2).
 *     --baseline <path>     Unfiltered reference (default: latest mode_disabled capture)
 *     --freeze-baseline     Capture and freeze a new radial profile baseline
 *     --num-rings <N>       Number of annular rings (default: 20)
 *     --max-r <N>           Maximum radius in fovea-radius units (default: 12.0)
 *     --fixation-x <0-1>    Horizontal fixation (default: 0.5)
 *     --fixation-y <0-1>    Vertical fixation (default: 0.5)
 *
 * Exit codes:
 *   0 = monotonic decline, no fog rings
 *   1 = validation failed
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PNG } = require('pngjs');
const { annularStdDev } = require('./lib/image-analysis');

const FOVEA_RADIUS_NORM = 45 / 1012;  // fovealRadius / CSS viewport height
const VALIDATION_DIR = path.join(__dirname, '..', 'tests', 'validation');

/**
 * Per-stimulus-class baseline path. Each stimulus class has its OWN frozen
 * baseline so drift is only ever compared like-for-like: the 'content' baseline
 * is the dashboard (legacy filename, kept for back-compat), 'uniform' is the
 * noise field, 'flat' is the achromatic control. Freezing from a uniform capture
 * can no longer clobber the content baseline.
 */
function baselinePathFor(cls) {
    return cls === 'content'
        ? path.join(VALIDATION_DIR, 'radial-profile-baseline.json')
        : path.join(VALIDATION_DIR, `radial-profile-baseline.${cls}.json`);
}

/**
 * The canonical default aesthetic mode, resolved from the app's own hardcoded
 * constant (main.js) rather than modes.json — modes.json currently tags TWO
 * modes (10 and 12) as category:"default" and doesn't even declare "default"
 * as a category, so it is not a reliable source (see TODO.md m1). main.js is
 * what actually ships. Returns a number, or null if it can't be parsed.
 */
function resolveDefaultMode() {
    try {
        const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
        const m = mainJs.match(/currentAestheticMode\s*=\s*(\d+)/);
        return m ? parseInt(m[1], 10) : null;
    } catch (_) {
        return null;
    }
}

/** Parse the mode id encoded in a smoke-capture filename, e.g. smoke_dashboard_mode12.png -> 12. */
function modeFromFilename(p) {
    const m = path.basename(p).match(/_mode(\d+)/);
    return m ? parseInt(m[1], 10) : null;
}

/**
 * Classify a capture as 'flat', 'uniform', or 'content' — this drives which
 * assertions are well-posed (the P0-2 correction).
 *
 * Absolute monotonicity of annular Oklab-L stdDev is only meaningful when the
 * stimulus has radially-uniform spatial statistics. On a real page (dashboard)
 * it is NOT — the UI puts high-contrast elements (stat-card row, table columns)
 * in a peripheral eccentricity band with blank space below fixation, so annular
 * stdDev legitimately rises at ~8° with zero relation to foveation quality.
 * Verified: mode 12 over uniform-noise declines monotonically through 8°, while
 * the dashboard's 8° contrast is anisotropic (E/W/NE loud, S silent) — a content
 * fingerprint, not a peripheral.frag defect.
 *
 *   'flat'    — a solid achromatic field (no content anywhere). Correct output is
 *               ~0 stdDev everywhere; the meaningful check is that the renderer
 *               does NOT inject peripheral structure (stdDev rising with
 *               eccentricity). Monotonic/fog assertions are N/A here.
 *   'uniform' — radially-uniform texture (noise, grid). Monotonic decline IS
 *               asserted; fog check applies.
 *   'content' — a real page. Monotonic is a non-fatal diagnostic; regressions
 *               are caught by drift vs the frozen content baseline.
 *
 * Auto-detect from filename; overridable with --stimulus flat|uniform|content.
 */
function classifyStimulus(p, override) {
    if (override === 'flat' || override === 'uniform' || override === 'content') return override;
    const name = path.basename(p).toLowerCase();
    // Solid achromatic control fields — zero content by construction.
    if (/flatgray|chroma-uniform|gray_chromatic/.test(name)) return 'flat';
    // Controlled radially-uniform textures (see capture-controlled-radial.js).
    if (/ctrl_|noise|uniform|_grid/.test(name)) return 'uniform';
    return 'content';
}

/** Short content hash of a PNG file, so we can detect "comparing an image to itself". */
function fileHash(p) {
    try {
        return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);
    } catch (_) {
        return null;
    }
}

function computeProfile(pngPath, fixationX, fixationY, numRings, maxR) {
    const png = PNG.sync.read(fs.readFileSync(pngPath));
    const foveaRadiusPx = Math.round(FOVEA_RADIUS_NORM * png.height);
    const fixPxX = fixationX * png.width;
    const fixPxY = fixationY * png.height;

    const ringWidth = maxR / numRings;
    const rings = [];

    for (let i = 0; i < numRings; i++) {
        const rMin = i * ringWidth;
        const rMax = (i + 1) * ringWidth;
        const rMinPx = rMin * foveaRadiusPx;
        const rMaxPx = rMax * foveaRadiusPx;
        const rMidDeg = ((rMin + rMax) / 2);  // in fovea-radius units ≈ degrees

        const stats = annularStdDev(png, fixPxX, fixPxY, rMinPx, rMaxPx);

        rings.push({
            rMin, rMax, rMidDeg,
            ...stats,
        });
    }

    return {
        screenshot: path.basename(pngPath),
        imageSize: { width: png.width, height: png.height },
        foveaRadiusPx,
        fixation: { x: fixationX, y: fixationY },
        numRings, maxR,
        rings,
    };
}

async function main() {
    const args = process.argv.slice(2);
    let screenshotPath = null;
    let freezeBaseline = false;
    let numRings = 20;
    let maxR = 12.0;
    let fixationX = 0.5;
    let fixationY = 0.5;
    let modeArg = null;
    let stimulusArg = null;  // 'uniform' | 'content' — overrides filename auto-detect

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--screenshot' && args[i + 1]) screenshotPath = args[++i];
        else if (args[i] === '--freeze-baseline') freezeBaseline = true;
        else if (args[i] === '--mode' && args[i + 1]) modeArg = parseInt(args[++i], 10);
        else if (args[i] === '--stimulus' && args[i + 1]) stimulusArg = args[++i].toLowerCase();
        else if (args[i] === '--num-rings' && args[i + 1]) numRings = parseInt(args[++i], 10);
        else if (args[i] === '--max-r' && args[i + 1]) maxR = parseFloat(args[++i]);
        else if (args[i] === '--fixation-x' && args[i + 1]) fixationX = parseFloat(args[++i]);
        else if (args[i] === '--fixation-y' && args[i + 1]) fixationY = parseFloat(args[++i]);
    }

    const defaultMode = resolveDefaultMode();

    // Find screenshot — default to the current DEFAULT mode (12), not mode 0.
    // The old default here was smoke_dashboard_mode0.png, so the regression
    // guard watched mode 0 while the app shipped mode 12 (see TODO.md M2).
    if (!screenshotPath) {
        const smokeDir = path.join(__dirname, '..', 'tests', 'smoke-captures');
        const smokeFile = defaultMode != null
            ? `smoke_dashboard_mode${defaultMode}.png`
            : 'smoke_dashboard_mode12.png';
        screenshotPath = path.join(smokeDir, smokeFile);
        if (!fs.existsSync(screenshotPath)) {
            console.error(`No smoke capture found at ${screenshotPath}`);
            console.error('Run: npm run capture-smoke -- --force');
            process.exit(1);
        }
    }

    // Which mode did we actually profile? Explicit --mode wins; else parse the
    // filename; else fall back to the resolved app default.
    const profiledMode = modeArg != null ? modeArg
        : (modeFromFilename(screenshotPath) != null ? modeFromFilename(screenshotPath) : defaultMode);

    const stimulusClass = classifyStimulus(screenshotPath, stimulusArg);

    console.log(`Screenshot: ${path.basename(screenshotPath)}  (mode ${profiledMode == null ? '?' : profiledMode}, app default ${defaultMode == null ? '?' : defaultMode}, stimulus ${stimulusClass})`);

    // Compute radial profile — stamp the source mode + a content hash so the
    // baseline records WHAT it was frozen from and drift can never be 0 "by
    // construction" without it being visible that the same image was reused.
    const profile = computeProfile(screenshotPath, fixationX, fixationY, numRings, maxR);
    profile.mode = profiledMode;
    profile.stimulus = stimulusClass;
    profile.sourceHash = fileHash(screenshotPath);
    console.log(`Image: ${profile.imageSize.width}x${profile.imageSize.height}px  Fovea: ${profile.foveaRadiusPx}px`);

    // Freeze baseline if requested — REFUSE to freeze from a non-default mode
    // (that was the M2 bug: a mode-0 baseline silently compared against itself),
    // and EXIT after writing so a single invocation can't emit both the baseline
    // and the comparison file from one in-memory object.
    if (freezeBaseline) {
        if (defaultMode != null && profiledMode !== defaultMode) {
            console.error(`\n✗ Refusing to freeze baseline from mode ${profiledMode}: app default is mode ${defaultMode}.`);
            console.error(`  Re-freeze from the default, e.g.:`);
            console.error(`    node scripts/validate-radial-profile.js --screenshot tests/smoke-captures/smoke_dashboard_mode${defaultMode}.png --mode ${defaultMode} --freeze-baseline`);
            process.exit(1);
        }
        const baselinePath = baselinePathFor(stimulusClass);
        const dir = path.dirname(baselinePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(baselinePath, JSON.stringify({
            ...profile,
            timestamp: new Date().toISOString(),
        }, null, 2));
        console.log(`\nBaseline frozen to: ${baselinePath} (mode ${profiledMode}, stimulus ${stimulusClass})`);
        console.log('Baseline-only run complete. Run again WITHOUT --freeze-baseline to compare a capture against it.');
        process.exit(0);
    }

    // Display profile
    console.log('\n═══ Radial Contrast Profile (Oklab Luminance StdDev) ═══\n');
    console.log(`  ${'Ring'.padEnd(6)} ${'Ecc°'.padStart(5)} ${'StdDev'.padStart(8)} ${'Samples'.padStart(8)}  Visual`);
    console.log(`  ${'─'.repeat(55)}`);

    for (const ring of profile.rings) {
        if (ring.sampleCount < 10) continue;
        const bar = '█'.repeat(Math.round(ring.stdDevL * 200));
        console.log(`  ${ring.rMin.toFixed(1).padStart(3)}-${ring.rMax.toFixed(1).padEnd(3)} ${ring.rMidDeg.toFixed(1).padStart(5)} ${ring.stdDevL.toFixed(4).padStart(8)} ${String(ring.sampleCount).padStart(8)}  ${bar}`);
    }

    // Validation
    console.log('\n═══ Validation ═══\n');
    let pass = true;

    // Check monotonic decline (with tolerance for content variation).
    //
    // ASSERTED only on 'uniform' stimuli, where radially-uniform statistics make
    // monotonic decline a genuine property of correct foveation. On 'content'
    // captures it runs as a NON-FATAL diagnostic — a real page's layout can put
    // contrast in a peripheral band, so a rise there is content, not a defect
    // (see classifyStimulus). Content regressions are caught by baseline drift.
    const assertMonotonic = stimulusClass === 'uniform';
    const populated = profile.rings.filter(r => r.sampleCount >= 50);
    // Monotonic + fog are N/A on a flat field (no content to degrade — near-zero
    // stdDev everywhere is CORRECT, and would false-trip the fog check). The flat
    // field is validated by the peripheral-injection check below instead.
    if (stimulusClass !== 'flat' && populated.length >= 4) {
        let monotonic = true;
        // Use 3-ring moving average to smooth content variation
        for (let i = 3; i < populated.length; i++) {
            const avgPrev = (populated[i - 3].stdDevL + populated[i - 2].stdDevL + populated[i - 1].stdDevL) / 3;
            const avgCurr = (populated[i - 2].stdDevL + populated[i - 1].stdDevL + populated[i].stdDevL) / 3;
            if (avgCurr > avgPrev + 0.01) {
                const tag = assertMonotonic ? '✗' : '·';
                console.error(`  ${tag} Non-monotonic (smoothed): ring ${populated[i].rMin.toFixed(1)}° avg ${avgCurr.toFixed(4)} > ${avgPrev.toFixed(4)}`);
                monotonic = false;
            }
        }
        if (monotonic) {
            console.log('  ✓ Luminance contrast declines monotonically (3-ring smoothed)');
        } else if (assertMonotonic) {
            pass = false;
        } else {
            console.log('  ℹ Non-monotonicity above is content-driven (stimulus=content); not asserted. Regressions are caught by baseline drift below.');
        }
    }

    // Check no fog rings (stdDevL < 0.001 indicates grey averaging) — content/uniform only.
    if (stimulusClass !== 'flat') {
        const fogRings = populated.filter(r => r.stdDevL < 0.001 && r.rMidDeg > 1.0);
        if (fogRings.length > 0) {
            console.error(`  ✗ Fog detected: ${fogRings.length} ring(s) with stdDevL < 0.001`);
            for (const r of fogRings) {
                console.error(`    Ring ${r.rMin.toFixed(1)}-${r.rMax.toFixed(1)}° stdDevL=${r.stdDevL.toFixed(5)}`);
            }
            pass = false;
        } else {
            console.log('  ✓ No fog rings (all stdDevL >= 0.001)');
        }
    }

    // ── Peripheral-injection check (flat field only) ──
    //
    // On a solid achromatic field the correct output is ~0 contrast everywhere.
    // A renderer that HALLUCINATES peripheral structure (Portilla-Simoncelli
    // synthesis / large-scale DoG firing on a zero-variance input) shows stdDev
    // that RISES with eccentricity — the "spurious peripheral structure" RC-2.6
    // targets. We measure it as the rise from the inner periphery to the outer
    // periphery, excluding the foveal region (<2°, which holds the fixation cross).
    if (stimulusClass === 'flat') {
        const periph = populated.filter(r => r.rMidDeg >= 2.0);
        if (periph.length >= 6) {
            const third = Math.floor(periph.length / 3);
            const mean = a => a.reduce((s, r) => s + r.stdDevL, 0) / a.length;
            const inner = mean(periph.slice(0, third));
            const outer = mean(periph.slice(-third));
            const rise = outer - inner;
            // Tolerance: an ideal flat render sits at ~0; allow a small floor for
            // dithering/compression. A rise beyond this is injected structure.
            const RISE_TOL = 0.0010;
            console.log(`  Peripheral injection: inner(${periph[0].rMidDeg.toFixed(1)}–${periph[third - 1].rMidDeg.toFixed(1)}°)=${inner.toFixed(4)}  outer(${periph[periph.length - third].rMidDeg.toFixed(1)}–${periph[periph.length - 1].rMidDeg.toFixed(1)}°)=${outer.toFixed(4)}  rise=${rise.toFixed(4)}`);
            if (rise > RISE_TOL) {
                console.error(`  ✗ Spurious peripheral structure: contrast RISES ${rise.toFixed(4)} (> ${RISE_TOL}) toward the periphery on a flat field (renderer injecting structure — RC-2.6).`);
                pass = false;
            } else {
                console.log(`  ✓ No peripheral injection (rise ${rise.toFixed(4)} <= ${RISE_TOL})`);
            }
        }
    }

    // Compare to the frozen baseline FOR THIS STIMULUS CLASS, if one exists. Each
    // class has its own baseline (baselinePathFor) so drift is always like-for-like
    // — the content baseline is the dashboard, uniform is the noise field, etc. A
    // capture with no matching baseline is validated by the assertions above only.
    const BASELINE_PATH = baselinePathFor(stimulusClass);
    if (fs.existsSync(BASELINE_PATH)) {
        const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
        console.log(`\n  Baseline comparison (frozen ${baseline.timestamp.split('T')[0]}, mode ${baseline.mode ?? '?'}):`);

        // Guard 1: the baseline must be from the current app default. A baseline
        // frozen on a different mode makes drift meaningless (M2).
        if (defaultMode != null && baseline.mode !== defaultMode) {
            console.error(`  ✗ Baseline mode ${baseline.mode ?? '?'} != app default ${defaultMode} — re-freeze required (see TODO.md M2 / P0-2).`);
            pass = false;
        }
        // Guard 2: comparing the *same* image against itself yields 0 drift "by
        // construction" — surface it rather than reporting a vacuous pass.
        if (baseline.sourceHash && profile.sourceHash && baseline.sourceHash === profile.sourceHash) {
            console.log(`  ⚠ Current screenshot is byte-identical to the baseline's source (hash ${profile.sourceHash}); drift below is a self-consistency check, not regression detection. Compare a freshly captured screenshot to detect real drift.`);
        }

        let maxDrift = 0;
        let driftCount = 0;
        for (let i = 0; i < Math.min(profile.rings.length, baseline.rings.length); i++) {
            const cur = profile.rings[i];
            const base = baseline.rings[i];
            if (base.stdDevL > 0.001 && cur.sampleCount >= 50) {
                const drift = Math.abs(cur.stdDevL - base.stdDevL) / base.stdDevL;
                if (drift > maxDrift) maxDrift = drift;
                if (drift > 0.25) driftCount++;
            }
        }
        if (driftCount > 0) {
            console.error(`  ✗ ${driftCount} ring(s) drifted >25% from baseline (max drift: ${(maxDrift * 100).toFixed(1)}%)`);
            pass = false;
        } else {
            console.log(`  ✓ All rings within 25% of baseline (max drift: ${(maxDrift * 100).toFixed(1)}%)`);
        }
    }

    // Save results
    const resultsPath = path.join(__dirname, '..', 'tests', 'validation', 'radial-profile.json');
    const resultsDir = path.dirname(resultsPath);
    if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
    fs.writeFileSync(resultsPath, JSON.stringify({
        ...profile,
        timestamp: new Date().toISOString(),
    }, null, 2));
    console.log(`\nResults saved to: ${resultsPath}`);

    console.log('');
    const summary = {
        flat: 'no spurious peripheral injection (flat field).',
        uniform: 'monotonic decline, no fog (uniform field).',
        content: 'no fog, within baseline drift (content — monotonicity diagnostic only).',
    }[stimulusClass];
    if (pass) {
        console.log(`PASS: Radial contrast profile validates ${summary}`);
        process.exit(0);
    } else {
        console.error('FAIL: Radial contrast profile validation failed.');
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
