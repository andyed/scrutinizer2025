# Deploy: Scrutinizer (scrutinizer2025)

Releases go through the `/release` Claude Code skill.

## Canonical procedure

The **`/release`** skill at `.claude/skills/release/SKILL.md` in this repo is
the one release procedure. The full workflow lives there; don't duplicate it here.
`docs/release-process.md` is a pointer to it.

```
/release X.Y.Z        # set package.json to X.Y.Z and release it
/release patch|minor  # next patch / minor version
/release silent       # rebuild and re-upload the current version
```

Personal skills outrank project skills of the same name, so the maintainer's
`~/.claude/skills/release/SKILL.md` must stay a short pointer to the repo
copy. A session started outside this repo also reaches the procedure
through that pointer.

## Deploy surfaces (one release cycle touches all of these)

- **Scroll gate, before building:** `npm run check:scroll` must exit 0. It launches the app, so it runs locally (display and GPU), not in CI; see `scripts/check-scroll-hud.mjs`.
- **macOS DMG + ZIP:** signed + notarized via `npm run build`. Output: `dist/`
  (`Scrutinizer-X.Y.Z-arm64.dmg`, `Scrutinizer-X.Y.Z-arm64-mac.zip`,
  `latest-mac.yml`).
- **GitHub release:** attach all three:
  `gh release create vX.Y.Z dist/Scrutinizer-X.Y.Z-arm64.dmg dist/Scrutinizer-X.Y.Z-arm64-mac.zip dist/latest-mac.yml`
  with release notes. electron-updater installs from the ZIP via
  `latest-mac.yml` on the latest release; a DMG-only release makes every
  installed copy's update check fail with a 404 (v2.7.1 and v2.7.2 shipped
  this way).
- **Homepage download links (every release):** `../scrutinizer-www/src/index.html`
  links a specific DMG, so dot releases update it too.
- **Blog post (major releases only):** new file in `../scrutinizer-www/src/blog/`.
  Dot releases update the parent post's Download section instead. Deploy via the
  scrutinizer-www repo's own pipeline (see `../scrutinizer-www/DEPLOY.md`).
- **Homepage screenshots:** replaced in `../scrutinizer-www/` only from hermetic
  golden captures. Captures still inherit saved prefs and the display's DPR, so
  none qualify yet (the skill's step 5).
- **README download link:** updated in the main repo's README.md.

## Minimal-change protocol

Text-only patches to the blog / homepage go through `scrutinizer-www` (see its
own `DEPLOY.md`). Changes to the native app (rendering, UI, features) always go
through a full `/release` cycle; don't ship un-notarized DMGs.

## PostHog

The scrutinizer-www site writes to **Scrutinizer project (259660)**. This
native-app repo doesn't embed PostHog directly. App events are captured
through a different pipeline (scrutinizer session telemetry).

## See also

- `.claude/skills/release/SKILL.md`: full release workflow
- `../scrutinizer-www/DEPLOY.md`: for web-only patches
- `CHANGELOG.md`, `ROADMAP.md`
- `tests/golden-captures/`: visual regression captures per release
