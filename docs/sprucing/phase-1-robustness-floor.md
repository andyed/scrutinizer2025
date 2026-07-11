# Phase 1 — Robustness floor

*Goal of the phase: make the 554-test suite run automatically, make a clean clone actually testable, pin the reproducibility inputs, and stop silent quality degradation from reaching published figures. Can run alongside Phase 0.*

---

## P1-1 — Restore the runnable state (`npm install`) + friendly preflight

**Goal:** The entire Electron automation pipeline is dead on this machine — root `node_modules` is absent, so `capture_vision`, both MCP test files, and `npm test`'s Electron half fail at `Cannot find module 'electron'`. Restore it and make the failure legible next time.

**Files:** `scrutinizer2025/` root; `scripts/run-electron.js` (line ~2, where the electron require lives); `scripts/lib/capture-runner.js` if present.

**Steps:**
1. `npm install` at `scrutinizer2025/` root. (`cli/node_modules` is already installed and healthy — the standalone Playwright CLI works; this is only the root.)
2. Add a preflight guard: before the app spawns in `scripts/run-electron.js`, check `require.resolve('electron')` in a try/catch and, on failure, print `"[scrutinizer] electron not installed — run: npm install (at repo root)"` and `process.exit(1)` instead of a raw `MODULE_NOT_FOUND`.

**Verify:**
```
node -e "require.resolve('electron'); console.log('electron resolvable: OK')"
npm run capture-smoke 2>&1 | tail -5
```
**Done when:** `electron` resolves and `capture-smoke` runs (or fails on a real capture reason, not module-not-found).

- [x] **P1-1 complete** — 2026-07-11. `npm install` run at root (electron + all deps present). Added a preflight to `scripts/run-electron.js`: the `require('electron')` is wrapped in try/catch and on `MODULE_NOT_FOUND` prints "electron is not installed — run `npm install` at the scrutinizer2025 repo root" and exits 1, instead of a raw stack trace. Verified: with electron hidden, the message prints and node exits 1; restored cleanly.

---

## P1-2 — CI: run the unit suite on every push/PR

**Goal:** No CI exists anywhere except a Pages deploy on `scrutinizer-www`. The 554-test unit suite runs headless in ~9s — it should run automatically. This is the single biggest robustness gap and the cheapest to close.

**Files:** create `.github/workflows/test.yml` in `scrutinizer2025/`.

**Steps:**
1. Create a workflow triggered on `push` and `pull_request` that: checks out, sets up Node 20+, runs `npm ci`, runs `npx jest --selectProjects unit` (or `npm run test:unit` — check `package.json`; the unit project is headless and needs no display).
2. Do NOT run `test:visual` / `test:memory` / `test:integration` in CI — they launch Electron and need a display. Leave those local-only. Add a comment in the workflow saying so.
3. Depends on **P1-3** (the electron-mock fix) so the unit suite is actually green on a fresh CI checkout.

**Verify:**
```
# locally simulate the CI job:
npx jest --selectProjects unit 2>&1 | tail -5   # or: npm run test:unit
```
**Done when:** the workflow file exists, and the unit-only jest invocation is green locally (555 tests, 0 failed once P1-3 lands).

- [x] **P1-2 complete** — 2026-07-11. Added `.github/workflows/test.yml`: on push + pull_request, Node 20, `npm ci`, `npm run test:unit`. Sets `ELECTRON_SKIP_BINARY_DOWNLOAD=1` so CI skips electron's ~100MB postinstall (the unit suite is electron-free after P1-3). `test:visual` / `test:memory` / `test:integration` stay local-only (they launch a GUI). Verified the exact CI command (`npm run test:unit`) is green locally: 27 suites, 562 passed, 1 todo, 0 failed.

---

## P1-3 — Make unit tests pass on a clean clone (electron mock)

**Goal:** `tests/unit/logger.test.js:10` does `jest.mock('electron')`, which throws `Cannot find module 'electron'` when electron isn't installed — so the unit suite fails on a clean clone / CI even though it's pure-logic. Fix so unit tests never need the electron binary.

**Files:** `tests/unit/logger.test.js` (line ~10).

**Steps:**
1. Change `jest.mock('electron')` to a **virtual mock**: `jest.mock('electron', () => ({ /* minimal shape logger.js uses: e.g. app, ipcMain */ }), { virtual: true });`. Read `renderer/logger.js` (or wherever the tested module lives) to see which electron exports it touches, and stub only those.
2. Confirm no other unit test imports electron transitively without a virtual mock.

**Verify:**
```
# with node_modules present but simulating no-electron is hard; simplest proof:
npx jest tests/unit/logger.test.js 2>&1 | tail -5
```
**Done when:** `logger.test.js` passes, and `npx jest --selectProjects unit` reports `1 failed` → `0 failed` (26/27 → 27/27 suites).

- [x] **P1-3 complete** — 2026-07-11. Added `{ virtual: true }` to the `jest.mock('electron', …)` in `tests/unit/logger.test.js` (it uses a factory but still tried to resolve the real module). Verified by hiding `node_modules/electron`: `logger.test.js` passes (5/5) and the **full** unit suite passes (27 suites, 562 tests) with electron absent — the whole unit layer is now clean-clone / lean-CI safe. (`menu-template.test.js` also references electron but was already safe.)

---

## P1-4 — Pin tessdata provenance so the OCR gate is regenerable

**Goal:** `scripts/validate-peripheral-ocr.js` comments claim `eng.traineddata` "ships at the repo root," but `.gitignore` ignores `*.traineddata` (it's untracked), and no doc says where to get it or which tessdata version produced the checked-in `ocr-baseline.json`. A clean clone can't run `validate:ocr` and nobody can verify the model version.

**Files:** create `scripts/download-tessdata.sh`; `tests/validation/ocr-baseline.json`; `scripts/validate-peripheral-ocr.js`; `CONTRIBUTING.md` or `README.md`.

**Steps:**
1. Create `scripts/download-tessdata.sh` that downloads a **pinned** `eng.traineddata` (specific tessdata_best commit/release URL) to the repo root, and verifies a recorded `sha256`.
2. Record the model `sha256` (and which tessdata repo: `tessdata` vs `tessdata_best`, and release tag) inside `tests/validation/ocr-baseline.json` under a `model` field, so baseline and model stay paired.
3. In `validate-peripheral-ocr.js`, if `eng.traineddata` is missing, print `"run scripts/download-tessdata.sh"` and exit non-zero instead of silently degrading.
4. Add one line to `CONTRIBUTING.md` / `README.md` pointing at the download script.

**Verify:**
```
bash scripts/download-tessdata.sh && node -e "const j=require('./tests/validation/ocr-baseline.json'); console.log('model recorded:', !!j.model, j.model||'')"
npm run validate:ocr 2>&1 | tail -5
```
**Done when:** the download script fetches a hash-verified model, the baseline JSON records the model identity, and `validate:ocr` runs from a clean clone after running the script.

- [x] **P1-4 complete** — 2026-07-11, with a finding. Empirically checked the checked-in `eng.traineddata` (5199098 B, sha `5dc5d8d6…`) against every standard source: it matches **none** — not `4.0.0_best` (15.4 MB), `4.0.0` (23.5 MB), `tessdata_fast` (4.1 MB), or legacy 3.04 (21.9 MB). So the baseline was scored with a **non-standard, unidentifiable** model — the real provenance gap. Resolution: (1) `scripts/download-tessdata.sh` installs a **pinned, sha-verified** canonical model (`4.0.0_best`, sha `8280aed0…`, verified by real download) as the go-forward model; (2) `ocr-baseline.json` now carries a `model` block recording both `scored_with` (the mystery model's sha, `source: unconfirmed`) and `pinned`; (3) `validate-peripheral-ocr.js` gained `preflightModel()` — exits 2 with "run scripts/download-tessdata.sh" if the model is missing, and warns (not silently) if the installed model's sha ≠ the baseline's `scored_with`; (4) CONTRIBUTING.md documents the step. Verified: missing-model exits 2 with the instruction; the current model matches `scored_with` so no false warning. **Follow-up (needs Electron OCR run):** re-freeze the baseline against the pinned model so `validate:ocr` is cleanly green on a fresh clone — until then it mismatch-warns. **Option for the maintainer:** force-add the exact 5.2 MB model (`git add -f eng.traineddata`) for immediate full reproducibility, if you prefer that over the download-script + re-freeze path (it's against the current `*.traineddata` ignore, so left as your call).

---

## P1-5 — Stamp compute tier into captures; add `--require-tier` (silent-fallback fix)

**Goal:** WebGPU→WebGL tier fallback is `console.warn`-only (`renderer/scrutinizer.js:196-198, 235-245, 681-686`), and captures never record which tier rendered them. A mode-15 figure silently rendered at the Tier 1.6 fallback is a **mislabeled figure** in a paper. Make the tier visible and lockable.

**Files:** `renderer/scrutinizer.js` (tier state: `computeTier`, `corticalPoolingAvailable`, `_fallbackToTier16`); `scripts/capture-golden.js`, `scripts/capture-smoke.js` (capture metadata writers).

**Steps:**
1. In the capture scripts, read the active `computeTier` and `corticalPoolingAvailable` from the renderer (via the existing IPC/eval path the capture uses) and write them into each capture's manifest/summary JSON alongside the image.
2. Add a `--require-tier=<N>` flag to the capture scripts: if the actual tier < required, **hard-fail** (`process.exit(1)`) instead of silently producing a degraded image.
3. Also surface `corticalPoolingAvailable: false` on the on-screen HUD (small badge) — a researcher running the GUI currently only sees the console (this is the tail of B2). Minimal: one line near the mode label.

**Verify:**
```
npm run capture-golden -- --require-tier=2 2>&1 | tail -5   # adjust flag syntax to the script
# confirm the manifest now has a tier field:
grep -rl "computeTier\|corticalPoolingAvailable" tests/golden-captures/ 2>/dev/null | head
```
**Done when:** every fresh capture manifest records `computeTier` + `corticalPoolingAvailable`, `--require-tier` hard-fails on shortfall, and the HUD shows a fallback badge.

- [~] **P1-5 core complete** — 2026-07-11. `renderer/scrutinizer.js` exposes `window.__scrutinizerTierState()` (aestheticMode, requested + active compute tier, corticalPoolingAvailable). `main.js` batch capture writes a `<filename>.tier.json` sidecar per shot with that state and logs a `⚠ DEGRADED (fell back)` line when active < requested. `--require-tier=<N>` added to `capture-smoke.js` + `capture-golden.js` (shared `checkRequiredTier()` in `capture-runner.js`) — hard-fails if any shot that *requested* ≥N rendered below it; shots that never requested the tier (mode 0 at tier 0) are not violations. **Verified with a real forced smoke capture:** sidecars written for all shots; `--require-tier=2.75` fails with 3 violations, `--require-tier=2.5` passes; unit suite green. Sidecars are gitignored under `tests/smoke-captures/` (golden ones are trackable as committed-image provenance).
    - **Genuine finding surfaced (chip spawned, task_8f7cb9b9):** the **default mode 12** requests Tier 2.75 (pyramid synthesis) but renders at **2.5** on this GPU (`corticalPoolingAvailable` is *true*, so this is NOT the B2 8-buffer issue — a different, higher-up pyramid-path fallback). Modes 14/15 too. So captures/figures of the default here are Tier 2.5, not the advertised 2.75 — exactly the mislabeling this ticket exists to make visible. Investigation (hardware limit vs silent pyramid bug vs wrong `compute_tier` in modes.json) spun off.
    - **Deferred — HUD fallback badge (step 3, the B2 tail):** not implemented. On this machine `corticalPoolingAvailable` is `true`, so a "pooling unavailable" badge would never render and I couldn't verify it — adding unverifiable UI would break the verify-before-claiming rule. The capture-provenance need (paper figures) is fully met by the sidecars + `--require-tier`; the on-screen badge is a smaller follow-up best done on a GPU that actually degrades pooling.

---

## P1-6 — Add failure exit codes to the three silent validators

**Goal:** `scripts/validate-color-search.js`, `scripts/validate-crowding.js`, `scripts/validate-spatial-acuity.js` print results and always exit 0 — so `&&`-chaining or CI can't detect their failure. (Other 13 validate/compare scripts already exit non-zero.)

**Files:** the three scripts above.

**Steps:**
1. In each, after computing pass/fail, add `process.exit(passed ? 0 : 1)`. Copy the threshold+exit pattern from `scripts/validate-crowding-tier3.js` (which already does it right).
2. Make the OCR gate's `RC-2.x` `console.warn` "?" outcomes count as failures when below a floor (`validate-peripheral-ocr.js` ~:127, :413, :437 currently downgrade to warn-and-continue).

**Verify:**
```
for s in validate-color-search validate-crowding validate-spatial-acuity; do node -e "const fs=require('fs'); const src=fs.readFileSync('scripts/$s.js','utf8'); console.log('$s exits:', /process\.exit\(/.test(src))"; done
```
**Done when:** all three print `exits: true`, and a deliberately-failing run exits non-zero.

- [x] **P1-6 complete** — 2026-07-11 (primary). `validate-color-search.js`, `validate-crowding.js`, `validate-spatial-acuity.js` now `return tier1Pass === tier1Total` from `validate()` and the call site is `process.exit(validate() ? 0 : 1)` — Tier 1 is the mandatory tier. All three syntax-check and print `exits: true`; `validate-spatial-acuity` runs and exits 0 (tier-1 pass), proving the path. **Deferred (step 2, OCR RC-2.x warnings → failures):** the B4 work deliberately left RC-2.x as advisory `console.warn` while hard-failing (exit 2) the serious cases, and the mode-0/mode-12 gate was just calibrated to pass; converting those warnings to failures risks destabilizing a freshly-tuned science gate, so it's held as a small separate follow-up rather than bundled here.

---

## P1-7 — Repo hygiene pass

**Goal:** Clear the accumulated clutter that makes the tree confusing and misleads audits.

**Steps (each independent):**
1. **Stale coverage report:** `git rm -r --cached coverage/` and add `coverage/` to `.gitignore` (jest regenerates it on demand; the committed report is 4 months stale and claims 4.2% vs a real 8.3%).
2. **Root artifact clutter:** delete the 13 root `test_*.png` and `texput.log` (all gitignored, local-only). Prune timestamped one-offs from `tests/golden/` (e.g. `site_www_figma_com_mode_0_2025-12-11T*.png`).
3. **Figma zips:** the two 33MB `scrutinizer-figma-v01.zip`/`v02.zip` at the family root duplicate/predate the git repo — confirm the git history supersedes them, then move to archival storage or delete. (Ask before deleting if provenance is unclear.)
4. **Uncommitted sibling edits:** `scrutinizer-figma` has 3 modified files including `peripheral.figma.frag` (unversioned shader edits on a research port — risk). Commit or discard them deliberately; don't leave shader changes dangling.

**Verify:**
```
git ls-files coverage/ | head; ls *.png 2>/dev/null | grep test_ | head; git -C ../scrutinizer-figma status -s
```
**Done when:** `coverage/` is untracked+ignored, root `test_*.png`/`texput.log` gone, figma zips resolved, sibling shader edits committed-or-reverted.

- [~] **P1-7 mostly complete** — 2026-07-11. Done (safe, in-repo): `git rm -r --cached coverage/` (39 stale files, 4-mo-old report claiming wrong %) + added `coverage/` to `.gitignore`; deleted the 13 gitignored root `test_*.png` + `texput.log`; deleted 61 gitignored one-off debug captures from a single 2025-12-11 `site_www_figma` session in `tests/golden/` (all untracked — 0 tracked golden files touched; suite still green 562/0). **Flagged for the maintainer, NOT actioned (destructive / cross-repo / unclear provenance):** (a) the two 34 MB `scrutinizer-figma-v0{1,2}.zip` at the family root (Nov 24/25 2025 snapshots, not tracked in the figma git repo — likely pre-git backups; delete or archive is your call); (b) `scrutinizer-figma`'s 3 uncommitted files incl. `peripheral.figma.frag` (unversioned shader edits in a sibling repo — commit-or-revert is a decision for that repo's owner, out of scope for an autonomous edit here).

---

## Phase 1 exit criteria

`npx jest --selectProjects unit` is green from a clean clone; a CI workflow runs it on push; `validate:ocr` is regenerable via a pinned tessdata script; every capture records its compute tier; the three silent validators now exit non-zero on failure; the tree is clean.
