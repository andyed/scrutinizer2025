# Phase 0 — Close the science verification gap

*Goal of the phase: make "the science is stable" **true and provable**. Today the default render (mode 12) is defensible, but the gates that would catch the next regression are broken — they pass by reading nothing, compare files to themselves, or name scripts that don't exist. Fix the gates before building anything on top.*

**Prereq for every ticket that runs the app:** if `ls node_modules` is empty, run `npm install` at `scrutinizer2025/` root first (ticket [P1-1](phase-1-robustness-floor.md)).

Background maps to the old backlog: these are TODO.md items **M1, M2, M3, M4, B3**. This file is the executable version; the TODO entries can be deleted once these land.

---

## P0-1 — Fix or demote the crowding gate (M1)

**Goal:** `tests/validation/wave7c-crowding.json` must never let a zero-confidence OCR read (`"confidence 0.00 < 0.5"`) count as `pass: true`. Either the capture reads real letters and crowding actually shows, or the file is explicitly relabeled a known-failing diagnostic and dropped from any "validated claims" list.

**Files:**
- `scripts/validate-crowding-tier3.js` — the producer (writes `tests/validation/wave7c-crowding.json`; run via `npm run wave7c:validate`).
- `scripts/capture-crowding-tier3.js` — the capture (`npm run wave7c:capture`).
- `tests/validation/wave7c-crowding.json` — the current artifact (5/6 failing; the lone `pass:true` is `mode15_flanked_crowded` with detail `confidence 0.00 < 0.5` — passing by failure-to-detect).

**Steps:**
1. Read `scripts/validate-crowding-tier3.js` and find where each check's `pass` is computed. Locate the predicate for `*_flanked_crowded` (it currently treats "confidence below threshold" as "crowding happened").
2. Add a **readability precondition**: a `*_flanked_crowded` check may only be scored (pass or fail) if its paired `*_isolated_recognized` check read the letter with confidence ≥ 0.5. If the isolated letter was NOT read, the flanked check is `pass: false` with detail `"invalid: isolated letter unreadable (conf X) — cannot score crowding"`. A zero-read is never a pass.
3. Run the capture (`npm run wave7c:capture`) and inspect the PNGs it writes (path is logged) — confirm whether isolated letters are actually legible at the capture DPR. If they are not (likely a DPR / font-size / mode issue), fix the capture so an isolated letter reads before touching thresholds.
4. **Decision fork** — pick one and record it in the file's top-level `status` field:
   - **(a) Fixed:** isolated letters read (conf ≥ 0.5) and flanked letters crowd (lower conf). Ship the corrected JSON.
   - **(b) Diagnostic:** if crowding still can't be demonstrated, add `"status": "known-failing-diagnostic"` and a `"note"` explaining it, AND remove crowding from `docs/specs/implemented/wave3_crowding_validation.md`'s claims and any ROADMAP/CHANGELOG "validated" language. Grep for `crowding` in `CHANGELOG.md`, `ROADMAP.md`, `docs/specs/` and soften any "validated"/"replicates" phrasing to "diagnostic, not yet passing".
5. Add `process.exit(1)` on any non-diagnostic failure if not already present (see P0-5 pattern).

**Verify:**
```
npm run wave7c:capture && npm run wave7c:validate
# then:
node -e "const j=require('./tests/validation/wave7c-crowding.json'); const bad=j.checks.filter(c=>c.pass && /0\.00 < 0\.5/.test(c.detail||'')); console.log('pass-by-zero-read count:', bad.length); process.exit(bad.length? 1:0)"
```
**Done when:** the one-liner prints `pass-by-zero-read count: 0` and exits 0, AND either (a) real passes exist or (b) the file carries `status: known-failing-diagnostic` and the docs no longer claim crowding is validated.

- [x] **P0-1 complete** — 2026-07-11. Outcome: fork (b). Added a readability precondition to `validate-crowding-tier3.js` — the `*_flanked_crowded` and `*_asymmetry_ratio` checks are now marked `valid:false` (unscorable, counts as failure, never a pass) whenever the paired isolated-letter baseline reads below 0.5 confidence. The script now writes a top-level `status` (`passing` / `known-failing-diagnostic` / `failing`) and exits non-zero on any unscorable check. Running against the existing captures: mode 12 (default, displacement) reads "S" isolated+flanked at 1.00 (no crowding, correct); modes 14/15 (synthesis, research-tier) have an unreadable isolated baseline → `status: known-failing-diagnostic`. The old pass-by-zero-read is gone (verify: `pass-by-zero-read count: 0`). Softened the milestone claim in the script header and `docs/CODEBASE_MAP.md:389`; `release_notes_v2.7.0.md` and `simulation-limitations.md` were already appropriately hedged. **Not done (deliberately out of scope):** making the synthesis-mode isolated captures actually readable is the fork-(a) "L" effort and depends on P2-4 DPR pinning — those modes are research-tier, so relabeling is the correct scope for P0-1.

---

## P0-2 — Re-freeze the radial-profile baseline from the real default (M2)

**Goal:** `radial-profile-baseline.json` and `radial-profile.json` are currently byte-identical except a 2ms timestamp (both 5520 bytes, written from the same in-memory object) → 0% drift is guaranteed by construction. Re-freeze the baseline from a *separate* capture run of the current default (mode 12), stamp the source mode into the JSON, and fail if the baseline's mode ≠ the modes.json default.

**Files:**
- `scripts/validate-radial-profile.js` — producer of both files.
- `tests/validation/radial-profile-baseline.json`, `tests/validation/radial-profile.json`.
- `shared/modes.json` — source of truth for the default (mode id 12, `category: "default"`).

**Steps:**
1. Read `scripts/validate-radial-profile.js`. Confirm the `--freeze-baseline` path writes the baseline from the same object it later compares against (the bug). Find where it captures/computes the profile.
2. Add a `mode` (or `sourceMode`) field to the written JSON recording which mode id produced it. Read the default id dynamically from `shared/modes.json` (`modes.find(m => m.category === 'default').id`) — do not hardcode 12.
3. Make freeze and compare **two separate captures**: freezing must run its own capture of the default, not reuse the comparison object. If the script structure forces reuse, split it into `--freeze-baseline` (capture → write baseline) and default-run (capture → write current → diff vs baseline).
4. Add a guard in the compare path: if `baseline.mode !== defaultModeFromModesJson`, exit non-zero with `"baseline mode N != modes.json default M — re-freeze required"`.
5. Delete the stale identical pair and regenerate: freeze once, then run compare once, from independent captures.

**Verify:**
```
node scripts/validate-radial-profile.js --freeze-baseline
node scripts/validate-radial-profile.js
node -e "const b=require('./tests/validation/radial-profile-baseline.json'), c=require('./tests/validation/radial-profile.json'); const strip=o=>{const x={...o}; delete x.timestamp; return JSON.stringify(x)}; console.log('baseline.mode=',b.mode,'identical-except-timestamp:', strip(b)===strip(c)); process.exit(b.mode===undefined? 1:0)"
```
**Done when:** `baseline.mode` is defined and equals the modes.json default (12), and the two files are NOT identical-except-timestamp after an independent compare run (a real profile diff, even if within tolerance, has different sample values than the frozen baseline OR the diff is a genuine 0 from a genuinely re-captured identical render — verify by confirming the two captures came from separate script invocations, not one shared object).

- [x] **P0-2 complete** — 2026-07-11. The M2 defect was worse than "compares a file to itself": a single `--freeze-baseline` run wrote *both* JSONs from one in-memory object (hence byte-identical but for a 2ms timestamp), AND it profiled `smoke_dashboard_mode0.png` — so the guard watched **mode 0** while the app ships **mode 12**. Fixes in `scripts/validate-radial-profile.js`: (1) resolve the canonical default from `main.js`'s hardcoded `currentAestheticMode` (modes.json is unreliable — it tags both mode 10 and 12 `category:"default"` and doesn't even declare "default" as a category, see m1); (2) default the profiled screenshot to the app default (mode 12), add a `--mode` flag, and parse the mode from the filename; (3) stamp `mode` + a `sourceHash` into both JSONs; (4) `--freeze-baseline` now **refuses** to freeze from a non-default mode and **exits** after writing (a single run can no longer emit both files from one object); (5) the compare step **fails** if `baseline.mode !== appDefault`, and **surfaces** a byte-identical self-comparison with a loud ⚠ instead of reporting a vacuous 0%-drift pass. Re-froze the baseline from `smoke_dashboard_mode12.png` (mode 12, hash b108f355…). Verified: baseline.mode=12; freezing from mode 0 is refused (exit 1); mode-0 vs mode-12 monotonicity differs (see finding below).
    - **Finding surfaced (out of P0-2 scope, chip spawned):** with the guard now on the real default, mode 12 **fails the monotonic check at 7.8–8.4°** (contrast *rises* in the periphery) while the old mode-0 target *passed* — i.e. the guard was watching a passing wrong-mode and hid a real property of the shipped default. Caveat: the smoke capture is a real *dashboard*, so this may be content-driven (a high-contrast element near 8°) rather than a render defect; the monotonic assertion may itself be mis-specified for real-content captures (RC-2.6 "spurious peripheral structure" is designed for controlled stimuli). Distinguishing needs a uniform/controlled stimulus, not a dashboard.
    - **Not done (needs capture):** true regression detection still requires a *fresh* mode-12 capture at compare time (currently self-compares the committed reference). That's the capture-pipeline / DPR-pin work in P2-4. The self-comparison is now explicitly flagged rather than masquerading as a pass.
    - **Finding RESOLVED — 2026-07-11: content-driven, not a render defect.** Distinguished by capturing mode 12 over controlled stimuli (new `tests/reference-pages/uniform-noise.html`, `scripts/capture-controlled-radial.js`). On radially-uniform fields (white noise, cell=3 and cell=8) mode 12 declines **monotonically through the 8° band** (0.110→0.061, no hump); the dashboard's 8° rise has no counterpart on uniform input. Angular-sector breakdown of the dashboard's 7.8–8.4° ring is the clincher: contrast is concentrated **E/W/NE/SW (0.056–0.082, the stat-card row + table columns) and near-zero to the S/SE (0.002–0.003, the blank lower half)** — a layout fingerprint, while the noise field is isotropic (~0.06 every sector). The grid control corroborates: periodic content makes its own non-monotonic radial structure but peaks at **5.5° and 11°, not 8°** — the peak tracks content geometry. So the monotonic assertion was **mis-specified for real-content captures**, exactly as suspected.
      - **Fix landed in `validate-radial-profile.js`:** stimulus classification (`flat`|`uniform`|`content`, auto-detected or `--stimulus`). Monotonic decline is **asserted only for `uniform`**; for `content` it is a non-fatal diagnostic and regressions are caught by drift vs a per-class frozen baseline. Each class has its own baseline (`radial-profile-baseline[.<class>].json`) so drift is always like-for-like. Net: the dashboard capture now **PASSES** (its 8° non-monotonicity is reported as content, not a failure), and monotonicity is genuinely gated on the noise field.
      - **Wired in:** `smoke_noise_mode12.png` + `smoke_flatgray_mode12.png` added to `capture-smoke.js`; `npm run validate:radial` gates content + uniform (both PASS); uniform baseline frozen (`radial-profile-baseline.uniform.json`, hash 6205c3a4…).
    - **Secondary finding (RC-2.6, real, still open):** the flat achromatic field is *not* perfectly flat under mode 12 — stdDev rises monotonically 0.0016 (2°) → 0.0042 (11.7°), i.e. the renderer injects a little peripheral structure from nothing (plausibly Portilla-Simoncelli synthesis / large-scale DoG firing on zero-variance input). It is ~15× below the dashboard hump and monotonic, so it did **not** cause the P0-2 failure, but it is a genuine RC-2.6 "spurious peripheral structure" target. Added a dedicated **peripheral-injection check** (flat class) + `npm run validate:radial:injection`, which currently **FAILs by design** (rise 0.0020 > 0.0010 tol) — kept as a non-gating diagnostic so it flags the artifact without blocking CI on an unfixed shader issue. Fix belongs in `renderer/shaders/peripheral.frag`.
      - **FIXED — 2026-07-11.** Root cause was NOT the DoG/PS-synthesis path (on a flat field all MIP levels are equal → all DoG bands are exactly zero → no injection). The injector is the **rod "eigengrau" grain** in the mode-0/1 V4 branch (`peripheral.frag` ~L1636): `rodColor += noiseVal * 0.08` where `noiseVal = rand(uv)` — per-pixel white noise added via `mix(finalCol, rodColor, desaturationFactor * 0.3)`, and `desaturationFactor` rides `rodDesat = t³`, which grows monotonically with eccentricity. It is an aesthetic consistency grain, not a scotopic-noise model, and it is ungated by input contrast — so on a zero-variance field it fabricates per-pixel structure that rises with eccentricity, the exact measured signature. **Fix:** contrast-gate the grain by local source structure (`smoothstep(0.002, 0.02, |mip1 − mip5|)` luminance energy at the undistorted uv). Flat field → gate ≈ 0 → grain off; noise/text → gate ≈ 1 → grain unchanged. Verified: `validate:radial:injection` rise **0.0020 → 0.0007** (PASS, < 0.0010); mid-periphery 3–8° bands collapse from ~0.002–0.003 to ~0.0000. No regression: uniform-noise monotonic PASS (0.0% drift — grain unchanged on structured content); OCR RC-2.6 phantom glyphs **improved** 26 → 16 far chars (1.8% → 1.1%). (`validate:radial` *content*/dashboard drift fails on a separate, pre-existing DPR-mismatched baseline — see notes below — not caused by this change: reverting the shader reproduces the identical foveal drift.)

---

## P0-3 — Build the length-tuning validation or downgrade the claim (M3)

**Goal:** `shared/modes.json` mode 17 lists three tests (`length_tuning_long_edge_suppression`, `length_tuning_short_edge_preserved`, `length_tuning_cmf_scaling_invariant_across_eccentricity`) that exist nowhere, and the two promised scripts (`scripts/validate-cavanaugh-length-tuning.js`, `scripts/validate-length-tuning.js`) don't exist. Either build the Cavanaugh-Bair-Movshon 2002 synthetic-Gabor curve-replication harness, or remove the phantom test names and soften "replicates" → "inspired by, validation pending".

**Files:**
- `shared/modes.json` — mode 17 metadata (search `length_tuning`; `architectural_purpose` currently says "If validation passes (CBM 2002 curve replication…)").
- `scripts/` — where `validate-cavanaugh-length-tuning.js` / `validate-length-tuning.js` would live.

**Decision fork — pick based on available time; (b) is the honest minimum:**

**(a) Build it (L):** Create `scripts/validate-length-tuning.js` that renders mode 17 over a bar/Gabor sweep varying bar length at fixed eccentricity, measures response (or output-image energy) as a function of length, and checks for the end-stopping signature (long bars suppressed relative to short) per Cavanaugh, Bair & Movshon 2002. Emit a JSON artifact with pass/fail and `process.exit(1)` on fail. Wire it into `package.json` as `mode17:validate`.

**(b) Downgrade (S) — do this if not building (a):**
1. In `shared/modes.json`, remove the three phantom test names from mode 17's metadata.
2. Change `architectural_purpose` / any "replicates" wording to `"inspired by Cavanaugh-Bair-Movshon 2002 end-stopping; quantitative validation pending"`.
3. Grep `CHANGELOG.md`, `ROADMAP.md`, `docs/specs/` for mode 17 / length-tuning / "end-stopping" and align the language.

**Verify (b):**
```
grep -rn "length_tuning_long_edge_suppression\|length_tuning_short_edge_preserved\|length_tuning_cmf_scaling" shared/ tests/ scripts/ || echo "OK: no phantom test names remain"
grep -rn "replicates" shared/modes.json && echo "STILL CLAIMS replicates — fix" || echo "OK"
```
**Done when:** (a) the harness exists and runs with a real pass/fail, OR (b) grep finds no phantom test names and no "replicates" claim on mode 17.

- [x] **P0-3 complete** — 2026-07-11. Fork (b) downgrade. Emptied mode 17's `tests` array in `shared/modes.json` (the three names `length_tuning_long_edge_suppression` / `_short_edge_preserved` / `_cmf_scaling_invariant_across_eccentricity` were never-written phantoms; no code consumes `mode.tests`, verified). Rewrote `architectural_purpose` from "If validation passes (CBM 2002 curve replication…) parameters graduate" to "INSPIRED BY (not yet quantitatively validated against) Cavanaugh-Bair-Movshon 2002 … validation … is PENDING and not yet built." The design spec `docs/specs/length_tuned_edge_suppression.md` was already honest (marks length-tuning "gated off until validated," CBM 2002 as a forward-looking "target"/"P3"/"becomes `validate-cavanaugh-length-tuning.js`") — left unchanged. Verify: no phantom names remain, no "replicates" claim.

---

## P0-4 — Make length-tuning captures reproducible (M4)

**Goal:** The A/B captures backing mode 17 live under `tests/golden-captures/length-tuning-ab/`, which is gitignored → unreproducible from a clone. Either force-add the captures + a machine-readable manifest, or commit a deterministic regeneration script. **Depends on P0-3 decision:** if P0-3 chose (b) downgrade, a regeneration script is the lighter path; if (a), commit the harness output.

**Files:**
- `tests/golden-captures/length-tuning-ab/` (currently `git check-ignore`'d — verify with `git check-ignore tests/golden-captures/length-tuning-ab/`).
- `.gitignore` (find the rule matching that path).

**Steps:**
1. Prefer a **regeneration script** over committing PNGs: if P0-3(a) built `scripts/validate-length-tuning.js`, that script IS the reproducer — commit it and a small `manifest.json` (mode ids, eccentricities, bar lengths, expected direction) and leave the PNGs ignored.
2. If no harness (P0-3 chose downgrade), then force-add the existing A/B captures so the historical claim is at least inspectable: `git add -f tests/golden-captures/length-tuning-ab/*.png` plus a `manifest.json` listing each file's mode + params.
3. Whichever path: add a `README.md` in that dir stating how to regenerate.

**Verify:**
```
git check-ignore -v tests/golden-captures/length-tuning-ab/manifest.json || echo "manifest tracked (good)"
git ls-files tests/golden-captures/length-tuning-ab/ | head
```
**Done when:** a clean clone can either regenerate the numbers (script committed) or inspect them (captures + manifest force-added), and `git ls-files` on that dir is non-empty.

- [x] **P0-4 complete** — 2026-07-11. Since P0-3 took the downgrade path (no harness), force-added the two source A/B captures (`border_mode14_baseline.png`, `border_mode17_lengthtuned.png`) plus the already-machine-readable `.capture-manifest.json` (records URL, fixation, radius, dimensions, mode, specHash per shot) from the `.gitignore`d `tests/golden-captures/length-tuning-ab/`. Added a `README.md` there with the regeneration command (both captures derive from the committed `tests/reference-pages/border-suppression.html`) and a status note that these show the *qualitative* A/B effect, not a quantitative CBM-2002 validation. The intermediate `diff_*.png` working artifacts stay untracked. `git ls-files` on the dir now returns 4 files.

---

## P0-5 — Release hygiene: version/tag truth + delete phantom 2.8.0 (B3)

**Goal:** HEAD is 35 commits past `v2.7.3` with `package.json` still `2.7.3`; `v2.6.1` was never tagged; the empty phantom `docs/golden/summary-2.8.0.json` (`results:[]`, `maxPixelDiff:255` = no-op gate) persists and is untracked; there's no automated `package.json version == latest git tag` check.

**Files:**
- `package.json` (version field).
- `CHANGELOG.md` (`[Unreleased]` section).
- `docs/golden/summary-2.8.0.json` (untracked phantom), `docs/golden/figma/v2.8.0/` (phantom dir).
- `tests/unit/release-version-tag-sync.test.js` (existing version==tag assertion — extend it).

**Steps:**
1. **Decide HEAD's version.** The `[Unreleased]` CHANGELOG covers real B1/B2/B4 work → this is a release. Bump `package.json` to `2.8.0`, move `[Unreleased]` → `[2.8.0] - 2026-07-11`, and (following the `/release` skill) tag `v2.8.0` at the release commit. If you'd rather not cut a release now, instead roll nothing but add a CHANGELOG note that HEAD is unreleased — do not leave version drift silent.
2. **Tag the gap:** `git tag v2.6.1 <commit>` if the v2.6.1 commit is identifiable from CHANGELOG history (it's referenced as shipped). If not identifiable, note in CHANGELOG that v2.6.1 was never tagged and is reachable only by commit.
3. **Delete the phantoms** (they are no-op gates that can only mislead): `rm docs/golden/summary-2.8.0.json` and `rm -rf docs/golden/figma/v2.8.0/` — UNLESS you populated `summary-2.8.0.json` with real SSIM/PSNR that can fail (see `docs/golden/README.md`). Update `docs/golden/README.md` to state parity is not currently computed if you delete.
4. **Extend the guard test:** `tests/unit/release-version-tag-sync.test.js` already asserts version==tag. Add two assertions: (a) `CHANGELOG.md` contains a heading matching `pkg.version`; (b) no `docs/golden/summary-*.json` has `results: []` with `maxPixelDiff: 255` (the phantom signature).

**Verify:**
```
npx jest tests/unit/release-version-tag-sync.test.js
test -f docs/golden/summary-2.8.0.json && echo "PHANTOM STILL PRESENT" || echo "OK: phantom gone"
node -e "const v=require('./package.json').version; const c=require('fs').readFileSync('CHANGELOG.md','utf8'); console.log('CHANGELOG has heading for',v,':', c.includes('['+v+']'))"
```
**Done when:** the jest guard passes with the two new assertions, the phantom 2.8.0 files are gone (or populated with a real gate), and CHANGELOG has a heading for the current `package.json` version.

- [~] **P0-5 partially complete** — 2026-07-11. Done (non-release parts): deleted the phantom `docs/golden/summary-2.8.0.json` (`results:[]` + `maxPixelDiff:255` no-op gate, was untracked) and the empty `docs/golden/figma/v2.8.0/`; added a "Current status" note to `docs/golden/README.md` (parity is manual, not in CI; latest real summary is 1.4.3); extended `tests/unit/release-version-tag-sync.test.js` with two assertions — (a) CHANGELOG has a heading for `package.json`'s version, (b) no golden summary is a no-op phantom (empty `results` + `maxPixelDiff >= 255`). All 3 guard tests pass; negative-tested that reintroducing the phantom fails the build. Current state is self-consistent: `package.json` 2.7.3 == tag `v2.7.3`, CHANGELOG has `[2.7.3]`.
    - **v2.6.1 tagged** — 2026-07-11 (annotated tag at `621efa8` 'arxiv: RFV framing…', the last commit of v2.6.1-described CHANGELOG content before the next commit `65e832b` starts the v2.7.0 mode-14 work; `621efa8`'s modes.json has no mode 14 yet). Tag is local, not pushed. Gap closed: v2.6.0 → v2.6.1 → v2.7.0…v2.7.3.
    - **HELD for user decision (release cut):** whether to bump `package.json` to **2.8.0** and tag `v2.8.0` at HEAD (35 commits past v2.7.3, `[Unreleased]` holds real B1/B2/B4 work). This is a release judgment call, not a mechanical fix — deferred pending the maintainer's call. The version==tag guard enforces consistency whichever way it's decided.

---

## Phase 0 exit criteria

All five tickets checked, and this command is clean:
```
npm run wave7c:validate; node scripts/validate-radial-profile.js; npx jest tests/unit/release-version-tag-sync.test.js
```
No gate passes by reading nothing; no baseline is a clone of itself; no phantom validation script names remain; version==tag holds. **Only then is "the science is at a stable point" a provable statement, not a hopeful one.**

---

### Phase 0 status — 2026-07-11

**Substantively complete.** P0-1, P0-2, P0-3, P0-4 done; P0-5 done except the held release decision. Verified:

- Crowding gate exits 1 with `status: known-failing-diagnostic` — no longer passes by reading nothing.
- Radial baseline stamped `mode: 12` (the real default); exits 1 on the genuine non-monotonicity it now surfaces (was hidden while watching mode 0).
- No phantom test names remain; phantom `summary-2.8.0.json` deleted.
- Release guard: 3/3 pass (version==tag, CHANGELOG heading, no no-op summaries). Full unit suite green (562 pass, 0 fail).

Two honest failures are now *visible by design* (crowding baseline unreadable on synthesis modes; mode-12 radial non-monotonicity at 7–9°) — both flagged for follow-up rather than papered over. The mind2web Arm-0 drift pins were refreshed after the P0-3 metadata edit (pipeline byte-unchanged).

**One item held for the maintainer:** whether to cut/tag **v2.8.0** at HEAD and tag the untagged **v2.6.1** (P0-5). Mechanical hygiene is done; only the release judgment call remains.
