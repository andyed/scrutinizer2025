/**
 * Release-hygiene guard (audit 2026-06-05, B3).
 *
 * Catches the "package.json bumped without a git tag" drift: v2.7.3 shipped via
 * a package.json + CHANGELOG bump on 2026-04-26 but was never tagged, so for weeks
 * package.json read 2.7.3 while the latest tag was v2.7.2 and HEAD sat 83 commits
 * past it. This asserts that whatever version package.json claims, a matching
 * `v<version>` git tag exists.
 *
 * Skips gracefully when run outside a git checkout, or in a clone with no tags
 * (e.g. a shallow CI fetch or a published tarball), so it never blocks non-repo
 * installs — it only fires where it can actually tell the truth.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const pkg = require(path.join(REPO_ROOT, 'package.json'));

function gitTags() {
    try {
        return execSync('git tag --list', { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
            .toString()
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
    } catch {
        return null; // git unavailable or not a checkout
    }
}

describe('release version/tag sync (B3)', () => {
    const tags = gitTags();
    const haveTags = Array.isArray(tags) && tags.length > 0;

    (haveTags ? it : it.skip)('package.json version has a matching v<version> git tag', () => {
        expect(tags).toContain(`v${pkg.version}`);
    });
});

describe('release hygiene (P0-5)', () => {
    it('CHANGELOG.md has a heading for the current package.json version', () => {
        const changelog = fs.readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
        // Keep-a-Changelog style: `## [2.7.3] ...`
        expect(changelog).toMatch(new RegExp(`^##\\s*\\[${pkg.version.replace(/\./g, '\\.')}\\]`, 'm'));
    });

    it('no golden summary is a no-op phantom (empty results + maxPixelDiff >= 255)', () => {
        const goldenDir = path.join(REPO_ROOT, 'docs', 'golden');
        const summaries = fs.existsSync(goldenDir)
            ? fs.readdirSync(goldenDir).filter((f) => /^summary-.*\.json$/.test(f))
            : [];
        const phantoms = summaries.filter((f) => {
            let j;
            try {
                j = JSON.parse(fs.readFileSync(path.join(goldenDir, f), 'utf8'));
            } catch {
                return false;
            }
            const emptyResults = Array.isArray(j.results) && j.results.length === 0;
            const noOpGate = j.thresholds && Number(j.thresholds.maxPixelDiff) >= 255;
            return emptyResults && noOpGate;
        });
        // A summary with zero results AND a maxPixelDiff of 255 can never fail —
        // it is a placeholder masquerading as a passing parity gate. See P0-5.
        expect(phantoms).toEqual([]);
    });
});
