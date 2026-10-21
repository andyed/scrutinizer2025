---
name: release
description: Release Scrutinizer (scrutinizer2025) as a major x.Y.0 or dot x.y.Z release, or rebuild the current version with `silent`. Covers the signed and notarized DMG, ZIP and latest-mac.yml on GitHub Releases, CHANGELOG, ROADMAP and README, and the scrutinizer-www download links and blog.
argument-hint: "[X.Y.Z | patch | minor | silent]"
---

# /release: Scrutinizer

This is the only release procedure for Scrutinizer. `DEPLOY.md` and `docs/release-process.md` point here. A personal skill with the same name outranks a project skill, so `~/.claude/skills/release/SKILL.md` must stay a short pointer to this file and never hold steps of its own. The pointer is also what a session started in `~/Documents/dev` sees first, because this repo's `.claude/skills/` loads only after a file in the repo has been read.

Run the steps in order and **stop on any failure**. Each push, tag push, `gh release` call and site deploy is public. Andy's go-ahead for them must be given in the session doing the release, because an approval relayed from another session is refused.

## Usage

```
/release X.Y.Z    # set package.json to X.Y.Z and release it
/release patch    # next patch version (2.8.1 → 2.8.2)
/release minor    # next minor version (2.8.1 → 2.9.0)
/release          # propose the next patch version, confirm it with Andy
/release silent   # rebuild and re-upload the current version: no bump, no tag, no notes
```

## Release types

| Type | Version | Release body | Blog | Site |
|---|---|---|---|---|
| Major | `x.Y.0` | `docs/release_notes_vX.Y.0.md` | new post in `scrutinizer-www/src/blog/` | homepage links, new post |
| Dot | `x.y.Z`, Z > 0 | dot-release template (step 8), links the parent post | none | homepage links, parent post's Download section |
| Silent | current | unchanged | none | none (the DMG filename is unchanged) |

## Prerequisites

- macOS with the Xcode command-line tools
- the Developer ID Application certificate in the login keychain (setup history: `docs/archive/release-prep.md`)
- `.env` in the main checkout with `APPLE_ID`, `APPLE_ID_PASSWORD`, `APPLE_TEAM_ID`
- `gh` authenticated with push access to `andyed/scrutinizer2025`
- `scrutinizer-www` cloned at `~/Documents/dev/scrutinizer-repo/scrutinizer-www`

## Fixed facts

- **Checkout.** Release from the main checkout, `~/Documents/dev/scrutinizer-repo/scrutinizer2025`. `.env` is gitignored and exists only there; a worktree has no `.env`, so it can't sign or notarize.
- **Branches.** The checkout lives on `agent/usability-study-links`. Local `main` is stale and unused. Don't check it out and don't `git push origin main`. Releases push the tested sha to both `refs/heads/main` and `refs/heads/agent/usability-study-links` (step 7).
- **Shared tree.** Other sessions work in this checkout. Stage by explicit path, never `git add -A`, and never stash WIP you didn't write. As of 2026-10-20, `docs/specs/browser-features-and-extensions.md` holds another session's uncommitted notes.
- **Build.** arm64 only, one `package.json` at the root. `npm run build` runs `scripts/build-signed.js`: electron-builder, Developer ID signing, then notarization through `scripts/notarize.js` (the `afterSign` hook, 5–15 min).
- **Three assets.** `dist/Scrutinizer-X.Y.Z-arm64.dmg`, `dist/Scrutinizer-X.Y.Z-arm64-mac.zip`, `dist/latest-mac.yml`. electron-updater reads `releases/latest`, then `latest-mac.yml`, then the ZIP. The DMG is only the manual download. A release without the yml makes every installed copy's update check fail with `Cannot find latest-mac.yml ... HttpError: 404`. v2.7.1 and v2.7.2 shipped DMG-only and broke the updater that way (repaired 2026-10-19).
- **Updater feed.** The `publish` config in `package.json` is `provider: github`, `owner: andyed`, `repo: scrutinizer2025`.
- **Golden captures** go to `tests/golden-captures/vX.Y/`, the minor-version folder, so dot releases write into their major's folder.
- **Website.** `~/Documents/dev/scrutinizer-repo/scrutinizer-www`, branch `master`. A push to `master` deploys to GitHub Pages through `.github/workflows/deploy.yml` (see that repo's `DEPLOY.md`).
- **Pushes.** None on weekdays from 10am to 3pm PT. Every push command below carries the clock check in the same command.

## 1. Pre-flight

```bash
cd ~/Documents/dev/scrutinizer-repo/scrutinizer2025
git branch --show-current            # expect agent/usability-study-links
git fetch origin
git merge-base --is-ancestor origin/main HEAD && echo "HEAD contains origin/main"
git status --short                   # note anything that isn't yours; don't stage it
for k in APPLE_ID APPLE_ID_PASSWORD APPLE_TEAM_ID; do grep -q "^$k=." .env && echo "ok $k" || echo "MISSING $k"; done
node -p 'require("./package.json").version'
git describe --tags --abbrev=0       # previous release tag
[ -d node_modules ] || npm ci
```

- All three `.env` keys must print `ok`. Without them `npm run build` fails at notarization.
- If HEAD doesn't contain `origin/main`, stop and ask. Something was pushed to `main` that this checkout doesn't have.
- Settle the target version and the release type with Andy.
- List what ships: `git log vPREV..HEAD --oneline`.
- **If `docs/release_notes_vX.Y.Z.md` already exists, read it before writing anything.** It may be a draft for other, unreleased work. v2.8.1 found an unreleased Study Links draft there. Move such a draft aside, e.g. to `docs/release_notes_<topic>_draft.md`, after Andy agrees.
- Public prose announces only what Andy has cleared. As of 2026-10-20, Study Links aren't announced in release bodies or blog posts. A fixed bug gets one plain sentence, without before/after or mechanism.

For `silent`, skip to step 4.

## 2. Version, changelog, roadmap, README, release notes

- `package.json`: edit the `version` field directly. Don't use `npm version`, because it commits and tags on its own terms.
- `CHANGELOG.md`: add `## [X.Y.Z] - YYYY-MM-DD` in Keep-a-Changelog form. `tests/unit/release-version-tag-sync.test.js` fails without this heading.
- `ROADMAP.md`: add `### vX.Y.Z: <Title> (YYYY-MM-DD)` at the top of `## Release history`, with one or two bullets. For a major release, also move finished items out of "Next".
- `README.md`: update the `macOS Installer:` line near the top and the `### Download (vX.Y.Z)` section.
- `docs/release_notes_vX.Y.Z.md`:
  - Major: full notes, following earlier `docs/release_notes_v*.md`.
  - Dot: a condensed version of the CHANGELOG entry.

## 3. Commit and tag locally

```bash
git add package.json CHANGELOG.md ROADMAP.md README.md docs/release_notes_vX.Y.Z.md
git commit -m "release: vX.Y.Z — <brief summary>"
git tag -a vX.Y.Z -m "vX.Y.Z"
```

- **Tag before `npm test`.** `release-version-tag-sync.test.js` needs a `vX.Y.Z` tag to exist.
- Release tags are annotated.
- **If the release commit is amended, move the tag before anything is pushed:** `git tag -f -a vX.Y.Z -m "vX.Y.Z"`.
- Don't push yet.

## 4. Tests and gates

```bash
npm test                                   # unit, visual, memory, integration
npm run check:scroll                       # continuous-scroll HUD gate (launches the app)
node scripts/validate-color-search.js
git diff --stat tests/validation/reports/color-search-report.md
```

- `npm test` must pass.
- `npm run check:scroll` must exit 0. It is the only check that watches the HUD while the page moves, and a failure stops the release.
- `validate-color-search`: if Tier 1 fails, tell Andy. It is a warning, not a stop.
- **An ALL PASS from it can be empty.** When the rendered captures in `tests/golden-captures/validation/color-search/` (gitignored) are missing, it skips every rendered check and still prints ALL PASS. Tier 1 then reports 5 checks instead of 9. Report that as "model-only; rendered checks skipped", never as a pass. The last real rendered result (April 2026) had Tier 2 rendered-vs-model at 10/20 FAIL.
- **Restore the color-search report** with `git restore tests/validation/reports/color-search-report.md` unless you mean to update it. The script rewrites this tracked report and drops its hand-written correction notes.
- Record the tested sha with `git rev-parse HEAD`. Steps 6 and 7 must use the same sha. If anything is committed after this point, rerun this step.

## 5. Golden captures (skip for `silent`)

**The captures are local only.** `tests/golden-captures/` is gitignored, so git can't restore an overwritten baseline. The tracked, curated images are under `docs/golden/`.

**The captures aren't hermetic.** Under `TEST_MODE` they inherit the capturing user's saved prefs from `~/Library/Application Support/scrutinizer-electron/settings.json`, which as of 2026-10-20 is `comfortMode: true` and `intensity: 0.6`. They also render at the display's pixel ratio, despite `force-device-scale-factor=2`. Until that is fixed, a version's captures are only comparable with captures from the same machine, display and prefs. Don't recapture by reflex, and don't use captures as README or blog images.

1. Check whether rendering changed since the last release:
   `git diff --stat vPREV..HEAD -- renderer/shaders shared/modes.json renderer/webgl-renderer.js`.
   If nothing visual changed, skip captures and say so in the report.
2. Record the conditions: the two prefs above, and which display the capture window opens on.
3. Back up the current folder: `ditto tests/golden-captures/vX.Y tests/golden-captures/vX.Y-before-X.Y.Z`.
4. Capture: `npm run capture-golden`.
   - A shot is skipped only when its file exists, its spec is unchanged and the folder's manifest has the same app version.
   - At a new version, which includes every dot release, every shot in the minor folder is recaptured and overwritten.
   - `--force` also recaptures everything. An incremental run at an unchanged version skips everything.
5. Compare each new shot with its backup, like with like only.
   - The PNG width shows the pixel ratio. A 1920×1080 shot is 3840 px wide at DPR 2 and 1920 px at DPR 1. Check with `sips -g pixelWidth <backup> <new>`.
   - `.capture-manifest.json` records `capturedAt` per shot.
   - As of 2026-10-20, `tests/golden-captures/v2.8` holds 43 DPR-2 shots captured 2026-07-11 (desktop shots 3840 px wide) and 65 DPR-1 shots captured 2026-10-20 (desktop shots 1920 px wide).
   - A difference between shots taken under different conditions is not a regression. Restore such baselines from the backup.
6. Ask Andy to confirm the captures. Nothing under `tests/golden-captures/` is committed.

- `node scripts/capture-mode-comparison.js` writes to `docs/golden/mode-comparison/`, which is tracked. It is optional, has the same caveat, and is committed only on purpose.
- **Don't run `npm run golden-compare` for a dot release.** It reads `tests/golden-captures/v<full version>/`, but `capture-golden` writes the minor folder, so it finds no captures. It also writes tracked summaries under `docs/golden/`.

## 6. Build and check the package

```bash
npm run build      # run in the background: notarization takes 5-15 min
ls -lh dist/Scrutinizer-X.Y.Z-arm64.dmg dist/Scrutinizer-X.Y.Z-arm64-mac.zip dist/latest-mac.yml
APP=dist/mac-arm64/Scrutinizer.app
spctl -a -vv "$APP" 2>&1 | head -2                           # source=Notarized Developer ID
plutil -extract CFBundleShortVersionString raw "$APP/Contents/Info.plist"   # X.Y.Z
head -1 dist/latest-mac.yml                                  # version: X.Y.Z
grep -c -a '<marker>' "$APP/Contents/Resources/app.asar"      # must be >= 1
```

- All three assets must exist. The DMG should be over 50 MB.
- **Marker check.** Choose a string that only this release's change introduces, such as a new function, class or identifier from the diff, and confirm the packaged `app.asar` contains it. A count of 0 means the build packaged older sources. Don't upload it.
- Before a major release, open the DMG and smoke-test it:
  - it launches without a Gatekeeper warning
  - foveal mode toggles (Cmd+Shift+F)
  - the modes cycle
  - the saliency and structure overlays render

`silent`: the build's version is the current one, and the same checks apply.

## 7. Push (Andy's go-ahead, given in this session)

Every check gates the push in the same command:

```bash
SHA=$(git rev-parse HEAD); TAG=vX.Y.Z     # SHA must equal the sha tested in step 4
git fetch origin
dow=$(TZ=America/Los_Angeles date +%u); hr=$(TZ=America/Los_Angeles date +%H | sed 's/^0//')
if [ "$dow" -le 5 ] && [ "$hr" -ge 10 ] && [ "$hr" -lt 15 ]; then echo "BLOCKED: weekday 10am-3pm PT"
elif [ "$(git rev-parse "${TAG}^{commit}")" != "$SHA" ]; then echo "STOP: ${TAG} is not on HEAD; re-tag with -f"
elif ! git merge-base --is-ancestor origin/main "$SHA"; then echo "STOP: ${SHA} is not a fast-forward of origin/main"
else git push origin "${SHA}:refs/heads/main" "${SHA}:refs/heads/agent/usability-study-links" "refs/tags/${TAG}"; fi
```

- Push the sha, never a branch name, so a commit landed by another session can't ride along.
- Brace `${SHA}` and `${TAG}` before a `:` or `^`. In zsh, `$SHA:r` is a history modifier.
- `silent`: drop the tag check and the `refs/tags/${TAG}` refspec. The existing tag stays on the original release commit.
- Afterwards, `git rev-parse origin/main` must equal `$SHA`.

## 8. GitHub release

Major: `--notes-file docs/release_notes_vX.Y.0.md`.

Dot: write the body to a scratch file outside the repo, from this template:

```markdown
## vX.Y.Z

<release notes from the CHANGELOG entry>

### Downloads

- **macOS (Apple Silicon):** Scrutinizer-X.Y.Z-arm64.dmg (attached)

### Blog

For the full vX.Y feature overview, see the [vX.Y blog post](https://andyed.github.io/scrutinizer-www/blog/YYYY-MM-DD-vX.Y.html).
```

Add a before/after screenshot only for a visual change, and only from like-for-like captures (step 5).

```bash
gh release create vX.Y.Z \
  dist/Scrutinizer-X.Y.Z-arm64.dmg \
  dist/Scrutinizer-X.Y.Z-arm64-mac.zip \
  dist/latest-mac.yml \
  --title "vX.Y.Z — <short description>" \
  --notes-file <notes file>
```

`silent` replaces the assets on the existing release instead:

```bash
gh release upload vX.Y.Z \
  dist/Scrutinizer-X.Y.Z-arm64.dmg dist/Scrutinizer-X.Y.Z-arm64-mac.zip dist/latest-mac.yml \
  --clobber
```

electron-updater compares versions, so copies already on X.Y.Z won't fetch a silent rebuild. Only older installs and new downloads get it.

## 9. Verify the release

```bash
gh release view vX.Y.Z --json assets --jq '.assets[].name'
# must list the .dmg, the -arm64-mac.zip and latest-mac.yml
curl -sL -o /dev/null -w '%{http_code}\n' \
  https://github.com/andyed/scrutinizer2025/releases/latest/download/latest-mac.yml
# must print 200
gh release download vX.Y.Z --pattern latest-mac.yml --output - | head -3
# version: must equal X.Y.Z; files: must list the zip and the dmg with sha512s
```

If `latest-mac.yml` is missing, run `gh release upload vX.Y.Z dist/latest-mac.yml --clobber` and verify again. The release isn't done until all three checks pass.

## 10. Website and post-release (skip for `silent`)

All in `~/Documents/dev/scrutinizer-repo/scrutinizer-www`, on `master`. Use `git -C`, or return to scrutinizer2025 afterwards.

- **Homepage, every major and dot release.** In `src/index.html`, the homepage links a specific DMG, so update both:
  - the two download URLs, from `vPREV/Scrutinizer-PREV-arm64.dmg` to `vX.Y.Z/Scrutinizer-X.Y.Z-arm64.dmg`
  - the two version labels, from `vPREV` to `vX.Y.Z`

  Find them with `grep -n -E 'Scrutinizer-[0-9.]+-arm64\.dmg|v[0-9]+\.[0-9]+\.[0-9]+' src/index.html`.
- **Major: new blog post.**
  - Create `src/blog/YYYY-MM-DD-vX.Y.html` covering what changed and why, with validation results.
  - Add it to the `POSTS` array in `src/blog/js/blog-shell.js` and to `src/blog/index.html`.
  - `npm run build` regenerates `src/blog/feed.xml` from `POSTS`. Commit the regenerated feed with the post.
  - Don't use golden captures as images until they're hermetic (step 5).
  - Check the build locally: open `dist/blog/YYYY-MM-DD-vX.Y.html`.
- **Dot: parent post.** Update the DMG link in the parent post's `<h2>Download</h2>` section, e.g. `src/blog/2026-10-19-v2.8.html` for 2.8.x.
- **Homepage screenshots** are only replaced from hermetic captures, which don't exist yet.
- **Commit:** `site: update download link to vX.Y.Z`. A major release also needs a `docs(blog): vX.Y release post` commit.
- **Push**, after Andy's go-ahead:

```bash
WSHA=$(git -C ~/Documents/dev/scrutinizer-repo/scrutinizer-www rev-parse HEAD)
dow=$(TZ=America/Los_Angeles date +%u); hr=$(TZ=America/Los_Angeles date +%H | sed 's/^0//'); \
if [ "$dow" -le 5 ] && [ "$hr" -ge 10 ] && [ "$hr" -lt 15 ]; then echo "BLOCKED: weekday 10am-3pm PT"; \
else git -C ~/Documents/dev/scrutinizer-repo/scrutinizer-www push origin "${WSHA}:refs/heads/master"; fi
```

- **Verify the deploy**, about 2 minutes later:
  `curl -s https://andyed.github.io/scrutinizer-www/ | grep -o 'Scrutinizer-[0-9.]*-arm64.dmg' | sort -u`
  It must print only the new DMG.

## Report

End with:

- the version and the pushed sha
- the release URL
- the three verification results from step 9
- which golden captures changed, or why captures were skipped
- whether `check:scroll` ran
- what was left undone

## Files

| Artifact | Path |
|---|---|
| Version | `package.json` |
| Changelog | `CHANGELOG.md` |
| Roadmap | `ROADMAP.md`, `## Release history` |
| README download | `README.md`, the `macOS Installer:` line and `### Download` |
| Release notes | `docs/release_notes_vX.Y.Z.md` |
| Golden captures | `tests/golden-captures/vX.Y/` (gitignored, local), curated set in `docs/golden/` |
| Color validation report | `tests/validation/reports/color-search-report.md` (restore after the run) |
| Build output | `dist/`, packaged app at `dist/mac-arm64/Scrutinizer.app` |
| Signing | `scripts/build-signed.js`, `scripts/notarize.js`, `.env` |
| Website | `../scrutinizer-www/src/index.html`, `../scrutinizer-www/src/blog/` |
| Auto-update | `docs/auto_update.md` |
