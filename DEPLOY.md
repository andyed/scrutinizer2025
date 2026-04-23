# Deploy — Scrutinizer (scrutinizer2025)

Scrutinizer has a well-established release skill. **Use it.**

## Canonical procedure

Use the **`/release`** Claude Code skill. Source at
`~/.claude/skills/release/SKILL.md`.

```
/release              # Release current version from package.json
/release 2.7.1        # Release specific version (bumps package.json)
```

The skill detects major (`x.Y.0`) vs dot (`x.y.Z`) releases and adjusts
artifacts. Full workflow documented in the skill itself — don't duplicate here.

## Deploy surfaces (one release cycle touches all of these)

- **macOS DMG:** signed + notarized via `npm run build`. Output: `dist/`.
- **GitHub release:** `gh release create vX.Y.Z ./dist/Scrutinizer-X.Y.Z.dmg`
  with release notes.
- **Blog post (major releases only):** new file in `../scrutinizer-www/src/blog/`.
  Deploy via the scrutinizer-www repo's own pipeline (see `../scrutinizer-www/DEPLOY.md`).
- **Homepage screenshots:** updated in `../scrutinizer-www/` if captures differ
  from current site images.
- **README download link:** updated in the main repo's README.md.

## Minimal-change protocol

Text-only patches to the blog / homepage go through `scrutinizer-www` — see its
own `DEPLOY.md`. Changes to the native app (rendering, UI, features) always go
through a full `/release` cycle; don't ship un-notarized DMGs.

## PostHog

The scrutinizer-www site writes to **Scrutinizer project (259660)**. This
native-app repo doesn't embed PostHog directly — app events are captured
through a different pipeline (scrutinizer session telemetry).

## See also

- `~/.claude/skills/release/SKILL.md` — full release workflow
- `../scrutinizer-www/DEPLOY.md` — for web-only patches
- `CHANGELOG.md`, `ROADMAP.md`
- `tests/golden-captures/` — visual regression captures per release
