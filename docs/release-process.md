# Scrutinizer Release Process

Step-by-step workflow for shipping a versioned release. Written to be automatable as a Claude Code skill.

## Prerequisites

- macOS with Xcode CLI tools
- Apple Developer certificate installed (see `docs/archive/release-prep.md`)
- `.env` file with `APPLE_ID`, `APPLE_ID_PASSWORD`, `APPLE_TEAM_ID`
- GitHub CLI (`gh`) authenticated with push access to `andyed/scrutinizer2025`
- Sibling repo `scrutinizer-www` cloned at `~/Documents/dev/scrutinizer-repo/scrutinizer-www/`

## Release Workflow

### 1. Bump Version

Update `package.json` version field:

```bash
cd ~/Documents/dev/scrutinizer-repo/scrutinizer2025
# Edit package.json "version" field to the new version
```

### 2. Run Tests

```bash
npm test
```

Verify no regressions in the Electron test suite.

### 3. Capture Golden Screenshots

```bash
npm run capture-golden
```

This runs `scripts/capture-golden.js` which:
- Launches Electron in `TEST_MODE` against reference pages in `tests/reference-pages/`
- Captures screenshots for each page × fixation × variant (standard, saliency, structure, mobile)
- Saves to `tests/golden-captures/v{VERSION}/`

Reference pages: `dashboard.html`, `article.html`, `ecommerce.html`, `techmeme.html`, `grid.html`

Variants per page:
| Variant | Description |
|---------|-------------|
| `standard` | Mode 0, no debug overlay |
| `saliency` | Saliency map debug visualization |
| `structure` | Structure map debug visualization |
| `iphone14` | iPhone 14 Pro (390×844) emulation |
| `ipad_air` | iPad Air Landscape (1180×820) emulation |

### 4. Compare Golden Captures

```bash
npm run golden-compare
```

Or manually compare against previous version:

```bash
open tests/golden-captures/v{PREV}/ tests/golden-captures/v{NEW}/
```

Look for:
- Unexpected visual regressions in rendering
- Correct saliency/structure overlay alignment
- Mobile layouts rendering at correct dimensions

### 5. Write Release Notes

Create `docs/release_notes_v{VERSION}.md` following the established format:

```
# Scrutinizer v{VERSION} Release Notes

**Release Date:** {date}

## Overview: {1-sentence summary}

## {Feature sections with biological motivation}

## Bug Fixes

## Files Changed
```

See existing notes (`docs/release_notes_v1.5.0.md`, `docs/release_notes_v1.6.0.md`) for style reference.

### 6. Update ROADMAP.md

- Move completed items from "Next" to their feature sections
- Mark newly specced features
- Update "What's Next" if priorities shifted

### 7. Commit Release

```bash
git add package.json docs/release_notes_v{VERSION}.md ROADMAP.md tests/golden-captures/v{VERSION}/
git commit -m "release: v{VERSION} — {brief summary}"
```

### 8. Build Signed DMG

```bash
npm run build
```

This runs `scripts/build-signed.js` which:
1. Loads `.env` credentials
2. Runs `electron-builder --mac`
3. Signs with Developer ID certificate
4. Notarizes via `scripts/notarize.js` (Apple notarytool, takes 5-15 min)

Output: `dist/Scrutinizer-{VERSION}.dmg` and `dist/Scrutinizer-{VERSION}-mac.zip`

### 9. Test the DMG

```bash
open dist/Scrutinizer-{VERSION}.dmg
```

Verify:
- App launches without Gatekeeper warnings
- Foveal mode activates (Cmd+Shift+F)
- All aesthetic modes cycle correctly
- Saliency and structure overlays render
- Mobile emulation works

### 10. Create GitHub Release

```bash
# Tag the release
git tag v{VERSION}
git push origin main --tags

# Create GitHub release with DMG artifact
gh release create v{VERSION} \
  dist/Scrutinizer-{VERSION}.dmg \
  dist/Scrutinizer-{VERSION}-mac.zip \
  --title "v{VERSION}" \
  --notes-file docs/release_notes_v{VERSION}.md
```

The `publish` config in `package.json` points to GitHub releases (`provider: "github"`, `owner: "andyed"`, `repo: "scrutinizer2025"`), so `electron-updater` will check GitHub releases for auto-updates.

### 11. Update Website (scrutinizer-www)

The marketing site lives in a sibling repo and deploys via GitHub Actions on push to `master`.

```bash
cd ~/Documents/dev/scrutinizer-repo/scrutinizer-www

# Update version badge and download link in src/index.html:
#   - Version badge (line ~249): v{PREV} → v{VERSION}
#   - Download URL (line ~255): v{PREV}/Scrutinizer-{PREV}-arm64.dmg → v{VERSION}/Scrutinizer-{VERSION}-arm64.dmg

# Commit and push (triggers GitHub Actions → GitHub Pages deploy)
git add src/index.html
git commit -m "site: update download link to v{VERSION}"
git push origin master
```

The deploy workflow (`.github/workflows/deploy.yml`) runs `npm run build` which copies `src/` → `dist/`, builds Tailwind CSS, then deploys `dist/` to GitHub Pages at `andyed.github.io/scrutinizer-www/`.

### 12. Verify Auto-Update

On a machine running the previous version, verify that `electron-updater` detects the new release and offers to update. The `latest-mac.yml` file is generated automatically by `electron-builder` and included in the GitHub release assets.

## Quick Reference

| Command | What it does |
|---------|-------------|
| `npm start` | Run app (via `scripts/run-electron.js`) |
| `npm run dev` | Run with logging enabled |
| `npm test` | Run in test mode |
| `npm run capture-golden` | Capture golden screenshots for current version |
| `npm run golden-compare` | Compare golden captures across versions |
| `npm run build` | Build signed + notarized DMG |
| `npm run build:unsigned` | Build unsigned DMG (local testing) |
| `npm run release` | Build + publish to GitHub releases |

## File Conventions

| File | Pattern |
|------|---------|
| Release notes | `docs/release_notes_v{MAJOR}.{MINOR}.{PATCH}.md` |
| Golden captures | `tests/golden-captures/v{VERSION}/{page}_{fixation}_{variant}.png` |
| Specs | `docs/specs/{feature_name}.md` |

## Version History

| Version | Date | Highlights |
|---------|------|------------|
| v1.2.0 | 2025 | Initial release |
| v1.3.0 | 2025 | Gestalt processor, structure map |
| v1.4.x | 2025 | Color saliency, OKLab, mobile emulation |
| v1.5.0 | 2025-12 | Frosted/Blueprint/Cyberpunk modes, mobile profiles |
| v1.6.0 | 2026-02 | De-monolith architecture, DoG peripheral reconstruction |
