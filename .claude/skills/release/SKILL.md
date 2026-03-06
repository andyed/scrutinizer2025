# /release — Scrutinizer Release Skill

Build, sign, notarize, and ship a Scrutinizer Electron release with golden captures and website update.

## Usage

- `/release` or `/release bump` — Full release: bump version, tests, golden captures, build signed DMG, GitHub release, update website.
- `/release silent` — Rebuild current version (hotfix rebuild). No version bump, no changelog, no golden captures, no tag.
- `/release patch` — Same as bump (default).
- `/release minor` — Bump minor version (e.g. 1.7.0 → 1.8.0).
- `/release 1.8.0` — Explicit version target.

## Args

- `bump` (default) — Bump the patch version (e.g. 1.7.0 → 1.7.1). Pass a specific version like `1.8.0` to set it explicitly.
- `minor` — Bump the minor version (e.g. 1.7.0 → 1.8.0).
- `silent` — Rebuild at the current version. No version bump, no changelog, no golden captures, no tag.

## Full Release Steps (`bump`)

Run each step sequentially. After each step, verify before proceeding. **STOP on any failure.**

### 1. Pre-flight checks
- Confirm working directory is `~/Documents/dev/scrutinizer-repo/scrutinizer2025`
- Verify clean git state: `git status` (no uncommitted changes)
- Verify `.env` has credentials:
  ```bash
  grep -c 'APPLE_ID\|APPLE_ID_PASSWORD\|APPLE_TEAM_ID' .env
  ```
  Must return 3.
- Read current version from `package.json`
- Confirm new version number with the user
- Verify `node_modules` exists; run `npm ci` if not

### 2. Bump version
- Edit `package.json` `version` field directly
- Do NOT use `npm version` — edit the file directly

### 3. Run tests
- `npm test`
- All tests must pass. **STOP on failure.**

### 4. Capture golden screenshots
- `npm run capture-golden`
- Captures to `tests/golden-captures/v{VERSION}/`
- Also run mode comparison: `node scripts/capture-mode-comparison.js`
- Verify captures exist: `ls tests/golden-captures/v{VERSION}/ | head -10`

### 5. Compare golden captures
- `npm run golden-compare`
- Or open both version dirs for manual comparison: `open tests/golden-captures/v{PREV}/ tests/golden-captures/v{VERSION}/`
- Look for visual regressions
- Ask user to confirm captures look good

### 6. Write release notes
- Summarize commits since last tag:
  ```bash
  git log $(git describe --tags --abbrev=0)..HEAD --oneline
  ```
- Create `docs/release_notes_v{VERSION}.md` following existing format (see `docs/release_notes_v1.5.0.md`, `docs/release_notes_v1.6.0.md`)
- Ask user for highlights or summarize from commits

### 7. Update CHANGELOG.md and ROADMAP.md
- Add version entry to `CHANGELOG.md`
- Move completed items in `ROADMAP.md` from "Next" to their feature sections

### 8. Commit release
- Stage:
  ```bash
  git add package.json docs/release_notes_v{VERSION}.md CHANGELOG.md ROADMAP.md tests/golden-captures/v{VERSION}/
  ```
  Also stage mode comparison captures if they exist:
  ```bash
  git add docs/golden/mode-comparison/ 2>/dev/null || true
  ```
- Commit: `release: v{VERSION} — {brief summary}`
- Do NOT push yet

### 9. Build signed DMG
- `npm run build`
- This runs `scripts/build-signed.js` → electron-builder → notarization (5-15 min)
- Verify output exists:
  ```bash
  ls -lh dist/Scrutinizer-{VERSION}-arm64.dmg dist/Scrutinizer-{VERSION}-arm64-mac.zip
  ```
- Verify DMG size is reasonable (>50MB)

### 10. Tag and push
- `git tag v{VERSION}`
- `git push origin main --tags`

### 11. Create GitHub Release
- ```bash
  gh release create v{VERSION} \
    dist/Scrutinizer-{VERSION}-arm64.dmg \
    dist/Scrutinizer-{VERSION}-arm64-mac.zip \
    dist/latest-mac.yml \
    --title "v{VERSION}" \
    --notes-file docs/release_notes_v{VERSION}.md
  ```
- Verify:
  ```bash
  gh release view v{VERSION} --json assets --jq '.assets[].name'
  ```

### 12. Update website (scrutinizer-www)
- `cd ~/Documents/dev/scrutinizer-repo/scrutinizer-www`
- Edit `src/index.html`: update version badge and download URL
  - Version badge: `v{PREV}` → `v{VERSION}`
  - Download URL: `v{PREV}/Scrutinizer-{PREV}-arm64.dmg` → `v{VERSION}/Scrutinizer-{VERSION}-arm64.dmg`
- Commit: `site: update download link to v{VERSION}`
- Push: `git push origin master` (triggers GitHub Pages deploy)
- Return to scrutinizer2025 working directory after

### 13. Verify auto-update
- Confirm `latest-mac.yml` is in the release assets:
  ```bash
  gh release view v{VERSION} --json assets --jq '.assets[].name' | grep latest-mac.yml
  ```
  **If missing, upload it:** `gh release upload v{VERSION} dist/latest-mac.yml --clobber`
- Verify the yml content matches the built artifacts:
  ```bash
  gh release download v{VERSION} --pattern latest-mac.yml --output - | head -5
  ```
  Version field must say `{VERSION}` and file entries must list the DMG and ZIP with sha512 hashes.
- On a machine running the previous version, electron-updater should detect the update via Check for Updates

## Silent Update Steps (`silent`)

Same as full release but skip version bump, golden captures, release notes, changelog, roadmap, and tagging.

### 1. Pre-flight checks
- Same as full release (clean tree, env vars, read current version)

### 2. Run tests
- `npm test`
- **STOP on failure.**

### 3. Build signed DMG
- `npm run build`
- Verify DMG and ZIP exist at current version

### 4. Push
- `git push origin main` (no new tag)

### 5. Update GitHub release assets
- Replace existing assets on the current version's release:
  ```bash
  gh release upload v{VERSION} \
    dist/Scrutinizer-{VERSION}-arm64.dmg \
    dist/Scrutinizer-{VERSION}-arm64-mac.zip \
    dist/latest-mac.yml \
    --clobber
  ```
- Verify: `gh release view v{VERSION} --json assets --jq '.assets[].name'`

## Key Constraints

- **ARM64 only** — Scrutinizer builds arm64 (not universal). Build config targets `--mac` with arm64 architecture.
- **Single package.json** — Unlike Psychodeli+ (monorepo with root + apps/electron), Scrutinizer has only one `package.json` at root.
- **Notarization** — Handled by `scripts/notarize.js` via `afterSign` hook in electron-builder config. Requires `.env` with `APPLE_ID`, `APPLE_ID_PASSWORD`, `APPLE_TEAM_ID`.
- **GitHub Releases for auto-update** — `electron-updater` checks GitHub releases for `latest-mac.yml`. The publish config in `package.json` points to `provider: "github"`, `owner: "andyed"`, `repo: "scrutinizer2025"`.
- **Sibling website repo** — `scrutinizer-www` at `~/Documents/dev/scrutinizer-repo/scrutinizer-www/`. Download links and version badge live in `src/index.html`. Deploys via GitHub Pages on push to `master` branch.
- **Golden captures are version-stamped** — Saved to `tests/golden-captures/v{VERSION}/`. Compare against previous version visually.
- **Mode comparison captures** — `scripts/capture-mode-comparison.js` outputs to `docs/golden/mode-comparison/`. May need staging separately.
- **Working directory** — Always run from `~/Documents/dev/scrutinizer-repo/scrutinizer2025`. Don't `cd` into subdirs for git commands. The one exception is step 12 (website update) — return to scrutinizer2025 after.
- **Trust the user** — If they say something looks wrong, investigate the actual code path. Do not theorize the bug away.
