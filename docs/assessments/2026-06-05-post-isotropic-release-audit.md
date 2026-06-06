# Post-Isotropic Release Audit — v2.6.0 → HEAD

*Date: 2026-06-05 · Scope: every release since the core isotropic layout (v2.6.0 FOVI Cortical Grid) through HEAD (4805f5e, v2.7.2+83) · Method: 17-agent parallel audit — 6 per-release auditors + 4 specialist lenses (images, test-data, bio-plausibility, usability) → synthesis → adversarial verification of 6 load-bearing claims.*

**Net trajectory — biological plausibility: MIXED · usability: MIXED.**

> **Verification note.** Of the synthesis's 6 load-bearing claims, 4 were independently confirmed against the repo and **2 were knocked down by the adversarial pass** — corrected in place below:
> - **KC4 (OVERSTATED):** the framing that `isotropic-rendering.json`'s 12/12 PASS is "frozen against a near-identical capture set" and that mode12==mode0 to four decimals is "incompatible with destroyed readability" is **wrong**. The on-disk mode0/mode12 captures actually differ (distinct md5; ~73% of article-parafoveal pixels differ on recompute). mode 0 is itself a foveation render ("High-Key Ghosting"), so check id=6 is an intended *regression guard* (mode 12 must not read MORE than already-foveated mode 0); ratio=1.000 in the barely-degraded parafovea is the designed pass, not a copied image. **Ranked issue #6 below inherits this overstatement and should be read as the weaker, real residue:** a provenance gap (committed JSON not byte-reproducible from current artifacts; m0 dashboard 0.0642 committed vs 0.1680 recomputed) plus a separate confirmed defect — top-left fixation captures are byte-identical to center (fixation not applied).
> - **KC5 (OVERSTATED):** the release-hygiene facts are all confirmed (v2.7.3 never tagged; HEAD = `v2.7.2-83-g4805f5e`; `package.json` reads 2.7.3; post-2.7.3 feature commits have 0 CHANGELOG hits). Only the flourish "a user *cannot* determine what build they are running" is too strong — `git describe` yields a precise identifier. Ranked issue #3 stands on substance.

---

## Where v2.6.0 left us

v2.6.0 is the high-water mark of the project's scientific intent and the right anchor. It did three real things, all verified:

- **It un-broke the isotropic path.** The ship-blocking fix at `renderer/shaders/peripheral.frag:2309` adds `config.v1_distortion_type != 5` to the mongrelMode override guard, so type-5 sector geometry finally reaches the isotropic code path instead of being silently rewritten to type-1 shatter. The guard is still intact at HEAD (verified: `peripheral.frag:2309`). Mode 12 (`shared/modes.json`: id 12, `v1_distortion_type=5`, `num_cortical_rings=50`) genuinely foveates — mode0 vs mode12 captures differ by md5 and by eye, fovea sharp, periphery crowded.
- **It backed the geometry with real math.** `tests/unit/isotropic-sectors.test.js` passes 19/19 (re-ran live, 0.17s) — the `w=log(r+a)` cortical sector geometry is principled and unit-tested to 3 decimals against Blauch et al.
- **It made the isotropic grid the default** (`shared/modes.json` default 10→12, commit 5367403).

But the headline *validation* was already running ahead of the evidence — the first instance of the pattern that recurs through the whole arc:

- The committed `tests/validation/isotropic-rendering.json` reports a clean **12/12 PASS**, but it is frozen against a near-identical (likely pre-fix) capture set: its check id=6 reports mode12 parafoveal stdDevL **identical to mode0 to four decimals** (m0=0.1329, ratio=1.000) across three pages, and check id=9 reports meanL/stdDevL ratios of 1.000/0.999 — the statistical signature of comparing mode 12 against an image that barely differs from mode 0. A render that destroys parafoveal readability cannot also equal the undistorted baseline to four decimals. The "isotropic mode visibly works" claim and "the validation JSON proves it" claim are in tension in the *same release*.
- The headline **OCR profile "Fovea 84 | Para 60 | Near 62 | Far 52"** exists ONLY in prose (`CHANGELOG.md:106`, `docs/specs/implemented/isotropic_migration.md:162,270`). No machine-generated JSON contains it. The only OCR curve artifact, `tests/validation/ocr-accuracy-curve.json`, is mode 0 (not 12), all-zeros (`processedTotalChars:0`, every `recognitionRate:0`), timestamped a month after release, with a DPR-mismatch fovea radius (44 vs baseline 84).
- The CHANGELOG calls that profile **"Monotonically declining"**; 84→60→62→52 rises from 60 to 62. The source spec (`isotropic_migration.md:270`) is more honest than the CHANGELOG — it flags "Near-periph slightly higher than parafovea — minor." The CHANGELOG flattened the caveat into a false claim.

So v2.6.0 left us with a **genuine mechanism advance wrapped in partially fabricated validation**. The biology moved forward; the evidence layer was already soft.

## The arc since — release by release

- **v2.7.0** — the first and clearest "lost its way" step. The default churned 12 → 14 (Pyramid Mongrel) ~5 days after isotropic shipped as default (`CHANGELOG [2.7.0]`). At the v2.7.0 tree, mode 14 was `v1_distortion_type=1` (the Shredder/shatter) with `num_cortical_rings` **absent** (verified: `git show v2.7.0:shared/modes.json` → rings=None, type=1). The bio-motivated isotropic geometry was dropped from the *face* of the tool in favor of a newer multi-scale texture pipeline. That pipeline is real (30 pyramid unit tests pass, 30/30) but its reference is hand-rolled numpy/scipy mislabeled as "pyrtools" (`scripts/generate-pyramid-reference.py` imports only numpy/scipy; CHANGELOG/release-notes say pyrtools), its headline "MAD=0.86" measures the gap to a *broken* baseline (Tier 2.5 variance 0.000 in every ring, `docs/validation-journal.md`), and its one perceptual test (Wave 7c crowding) FAILS. Most importantly, mode 14 rides the same 9-storage-buffer reconstruct path that v2.7.3 later confesses for mode 15 — shipped as the **default**, latent and unacknowledged.
- **v2.7.1** — real shader and scanpath work (unified eccentricity master curve, far-periphery decay, COCO-Search18/UEyes importers; 28 geometry tests pass) alongside three overclaims: a "Figma plugin parity" headline with zero backing files in-repo (`git diff v2.7.0..v2.7.1` changes no Figma files), a mathematically false "C2-continuous" label claimed twice as the Mach-band-fix rationale (a single smoothstep is C1; summing two is C1 at the junction), and a committed `wave7c-crowding.json` that is **5/6 failing** while the commit advertises "0 regressions."
- **v2.7.2** — the bright spot. A clean one-line fix (`main.js:1127`, `|| 20` → `!== undefined ? : 0`) on the genuinely live state path that stopped Inhibition-of-Return from silently activating when a user set Visual Memory to Off. Honestly described, on the correct path. Two drags: no regression test for the actual bug (the family re-broke ~6 days later, per `main.js:124-127`), and the tagged build silently bundles ~5900 lines of undocumented feature work — including re-adding `num_cortical_rings=50` to mode 14 (verified: `git show v2.7.2:shared/modes.json` → rings=50) and the mode-12 V4 eccentricity shader change, none of it in the [2.7.2] CHANGELOG.
- **v2.7.3** — a genuine, well-grounded honesty pass that *labels* rather than *fixes*. It correctly relabels mode 15 "TTM Cortical Pooling (research)" and documents that it silently falls back to DoG/MIP pixel blur when WebGPU `maxStorageBuffersPerShaderStage` (default 8) < the 9 the synth needs — directly verified: `reconBGL` (`webgpu-pyramid-compute.js:409-423`) binds 9 storage buffers (bindings 1-6,8,9,10), and `webgpu-probe.js:59-66` raises buffer *size* limits but never the buffer *count*. The `dog_e2` 0.15→0.10 acuity tune is real and correct-direction (verified in modes.json). But it ships a real pixel change with **zero regenerated images**, with its single readability-discriminating gate (peripheral-OCR) **dormant by the maintainer's own admission** (`TODO.md`), and it was **never git-tagged**.
- **HEAD (4805f5e, 83 commits past v2.7.2)** — the most bio-grounded feature the project has produced (V1 length-tuning / end-stopping, Mode 17, with an accurate Hubel-Wiesel / Cavanaugh-Bair-Movshon citation chain), honestly documented as **visually inert** (~8% per-channel max delta, below perceptual floor — corroborated by the A/B diff images), shipped **entirely off the books**: no CHANGELOG entry, no version bump (package.json still 2.7.3), validation artifacts gitignored (`git ls-files tests/golden-captures/length-tuning-ab/` → empty; dir is `git check-ignore`d), and the two promised validation scripts (`scripts/validate-cavanaugh-length-tuning.js`, `scripts/validate-length-tuning.js`) **do not exist**. Real stability wins also land here (BGRA hue fix, congestion self-heal, dead-code removal).

## Biological plausibility — net verdict: MIXED, leaning regress on the *default*

The honest accounting:

- **Advances that hold:** the per-band M-scaling cutoffs, chromatic-decay constants, and the `dog_e2` 0.15→0.10 acuity tune are faithfully implemented and source-traceable; the isotropic sector *geometry* is correct and unit-tested; v2.7.3's relabeling actively reverses the silent-overclaim culture; and the length-tuning mechanism is the cleanest bio motivation the project has produced.
- **The regression that dominates:** the geometry the project anchors its entire scientific story on — isotropic cortical sampling per Blauch — is **not what runs by default**. The code default is mode 14 (`main.js:28`, `scrutinizer.js:109`), which uses `v1_distortion_type=1` (shatter) + `pooling_family=acuity_loss` (DoG/MIP), not isotropic sector pooling. The actual cortical-pooling path (mode 15) is *still broken on default hardware* — relabeled, not repaired — because the 9-buffer requirement is never granted and the probe never checks for it. So the model a user sees by default is acuity-loss blur; the model the labels and paper still imply is cortical pooling.

The net is a project that got *more honest* about its biology while quietly shipping a *less biological* default than its own anchor.

## Usability as a tool — net verdict: MIXED, with one outright regression

- **Real gains:** the v2.7.1 master-curve de-stacking removes phantom Mach-band rings (RFV-positive); the v2.7.2 Visual-Memory-Off fix removes a launch-state footgun (verified on the live path); v2.7.3's `pooling_family` taxonomy and mode-15 "not RFV-safe" flag are honest user guidance; and HEAD's BGRA hue fix, congestion self-heal, and dead-code removal are clean stability wins.
- **The regression:** the default mode 14 carries `num_cortical_rings=50` at HEAD (re-added in v2.7.2), so it builds the same 9-buffer pyramid path and is subject to the **same silent MIP/DoG fallback as mode 15** — on common 8-buffer hardware it renders blur while the menu says "Pyramid Mongrel," with only a `console.warn`. That is a stability/honesty defect on the *default*, and v2.7.3 disclosed it only for mode 15.
- **Trust erosion:** the default churned 10→12→14 in ~8 days; mode 0 and the menu still carry stale "(Default)" labels while `category:default` and the code both point at mode 14 (verified); the one readability gate is dark; and the release-hygiene collapse (untagged v2.7.3 + 83 untagged/unversioned/unlogged commits; `git describe` = `v2.7.2-83-g4805f5e` while package.json says 2.7.3) means a user cannot determine what build they are running.

## Where we lost the way

Three concrete inflection points, in order of damage:

1. **The default abandoned the anchor (v2.7.0).** Five days after making the isotropically-cortical FOVI grid the default and building a paper around it, the default became a shatter-displacement mode with no cortical rings. The scientific centerpiece survives only as a non-default menu item. This is the single biggest "lost its way" signal.
2. **Confidence migrated from images to JSON unit tests that cannot see a peripheral-readability regression.** The deterministic unit layer strengthened (geometry, pyramid, config-hash all green), but the image-derived validation layer — the only layer that discriminates "text readable in periphery" from "no text anywhere" — rotted: dead OCR gate, a radial-profile baseline compared against a 2ms clone of itself, empty golden summaries, a phantom v2.8.0 summary with no tag, and a committed crowding validation that is 5/6 failing. The team's own honesty (`TODO.md`) names this exactly.
3. **Release discipline dissolved at the end.** v2.6.1, v2.7.3, and an implied v2.8.0 are untagged; 83 commits of shipped-looking feature work sit past the last tag with no CHANGELOG and no version bump. The project stopped behaving like a released tool and started behaving like a personal sandbox.

## What this means / what to do next

The maintainer's instinct is **correct but mislocated**. The project did not lose its way at the isotropic-geometry layer — that math is sound and still in the tree. It lost its way at the **default-selection, validation-integrity, and release-hygiene layers**. Concretely:

1. **Fix the silent fallback or stop shipping it as default.** Add `maxStorageBuffersPerShaderStage` to `webgpu-probe.js` `requiredLimits` with a feature-detect, and surface a loud "cortical pooling unavailable on this GPU" status; OR refactor `reconBGL` to ≤8 storage buffers; OR revert the default to mode 12 (which is RFV-clean and needs no compute path). Do not ship a default whose name implies synthesis while the code renders blur on common hardware.
2. **Decide what the default model is, and make every source agree.** Strip "(Default)" from the mode-0 and mode-12 label strings and from `menu-template.js`; render the suffix dynamically from `category:default`. State plainly in CHANGELOG/paper that the default is acuity-loss, not isotropic cortical sampling — or restore the isotropic grid as default.
3. **Restore the readability gate before tuning anything else.** Re-freeze `ocr-baseline.json` at the DPR the pipeline emits (or upscale pre-OCR), hard-fail on DPR mismatch, and regenerate `ocr-accuracy-curve.json` so the published 84/60/62/52 actually exists as data — or delete that profile from the CHANGELOG.
4. **Tag v2.7.3 and decide whether HEAD is v2.8.0.** Add a CI check asserting package.json version == latest tag at release time. Delete or populate the phantom v2.8.0 summary and empty golden/figma scaffolding.
5. **Replace the self-comparison and empty validations.** Re-freeze the radial baseline from the current default mode in a separate run; either fix wave7c crowding or relabel it a known-failing diagnostic and remove crowding from the validated-claims list.

The good news worth protecting: the v2.7.3 honesty pass and the HEAD length-tuning "no visible difference" finding are exactly the disclosure discipline the project needs. Apply that same discipline to the default mode, the validation artifacts, and the tags, and the project is back on its way.

---

## Verification — load-bearing claims

| # | Claim (abbrev.) | Verdict |
|---|---|---|
| KC1 | The shipped default mode is 14 (Pyramid Mongrel), NOT the v2.6.0 anchor mode 12 (FOVI isotropic cortical grid); mode 14 uses v1_distortion_t… | **SUPPORTED** |
| KC2 | The cortical-pooling reconstruct path requires 9 storage buffers but the WebGPU device request never raises the per-stage storage-buffer COU… | **SUPPORTED** |
| KC3 | The v2.6.0 headline OCR profile (Fovea 84 / Para 60 / Near 62 / Far 52) exists only in prose with no machine-generated backing; the sole OCR… | **SUPPORTED** |
| KC4 | The committed v2.6.0 isotropic validation (12/12 PASS) is frozen against a near-identical capture set: it reports mode12 parafoveal statisti… | **OVERSTATED** |
| KC5 | Release hygiene collapsed at the tail: v2.7.3 was never git-tagged and HEAD is 83 unversioned, unlogged commits past the last tag (v2.7.2) w… | **OVERSTATED** |
| KC6 | The default churned 12->14 only ~5 days after the isotropic grid shipped as default, and at the v2.7.0 tree mode 14 had num_cortical_rings A… | **SUPPORTED** |

## Ranked issues

### #1 · [BLOCKER] usability/bio-plausibility — Default mode 14 silently falls back to pixel blur on 8-buffer GPUs (9-buffer cap never probed)

**What.** The default mode 14 carries num_cortical_rings=50 at HEAD and builds the same WebGPUPyramidCompute whose reconBGL binds 9 storage buffers, but webgpu-probe.js never requests the maxStorageBuffersPerShaderStage limit. On common hardware (default cap 8) createBindGroupLayout fails and the shader falls through to sampleDoGReconstructed/MIP blur while the menu still shows 'Pyramid Mongrel' with only a console.warn. v2.7.3 disclosed this for mode 15 but not for the default mode 14. This is both a bio-plausibility defect (the cortical-pooling model never runs) and a usability/honesty defect (the tool lies about what it is rendering) on the DEFAULT.

**Fix.** Add maxStorageBuffersPerShaderStage to webgpu-probe.js requiredLimits with a feature-detect; if the adapter cannot grant 9, surface a loud 'cortical pooling unavailable on this GPU' status and badge/disable modes 14 and 15. Alternatively refactor reconBGL to <=8 storage buffers, or revert the default to mode 12 which needs no compute path.

*Evidence:* renderer/webgpu-pyramid-compute.js:409-423 (9 storage buffers); renderer/webgpu-probe.js:59-66 (omits count limit); peripheral.frag:1465-1472 (silent fallback); git show v2.7.2:shared/modes.json mode14 rings=50

### #2 · [MAJOR] bio-plausibility — The anchor isotropic cortical geometry was demoted from default to a shatter-based mode

**What.** v2.6.0's entire scientific claim is isotropic cortical sampling (Blauch, mode 12, v1_distortion_type=5, 50 rings). v2.7.0 changed the default to mode 14 (v1_distortion_type=1 Shredder + acuity_loss DoG/MIP), ~5 days later. The model a user sees by default is acuity-loss blur, not cortical sampling; the FOVI grid survives only as a non-default menu item. This is the central 'lost its way' signal on the bio axis.

**Fix.** Decide what the default model IS. Either restore mode 12 as default, or state plainly in CHANGELOG/paper/README that the default is acuity_loss (shatter+DoG/MIP) and stop foregrounding isotropic cortical sampling as 'the' shipped model.

*Evidence:* CHANGELOG [2.7.0] 'Default Mode: 12 -> 14'; main.js:28; scrutinizer.js:109; shared/modes.json mode 14 pipeline

### #3 · [BLOCKER] release-hygiene — Untagged v2.7.3 plus 83 unversioned, unlogged commits at HEAD

**What.** v2.7.3 was released via CHANGELOG+package.json bump but never tagged; HEAD is 83 commits past v2.7.2 with an entire feature line (length-tuning, Mode 17, BGRA fix, congestion self-heal) and no CHANGELOG entry and no version bump (package.json still 2.7.3). A user/CI cannot pin or identify the build. v2.6.1 and an implied v2.8.0 are also untagged.

**Fix.** Tag v2.7.3 at commit 4bf06ac; decide whether HEAD is v2.8.0 and tag or roll package.json back; add a CI check asserting package.json version == latest tag at release time; delete or populate the phantom docs/golden/summary-2.8.0.json and empty figma/v2.8.0 dirs.

*Evidence:* git describe = v2.7.2-83-g4805f5e; git tag -l ends at v2.7.2; package.json 2.7.3; git rev-list v2.7.2..HEAD --count = 83; grep CHANGELOG for HEAD-range features = 0 hits

### #4 · [BLOCKER] test-data — Published v2.6.0 OCR profile (84/60/62/52) is non-reproducible; the gate that produced it is dead

**What.** The mode-12 OCR profile used to justify the 8px Cutter floor and the readability thresholds appears only in prose. The sole OCR curve artifact is mode 0 (not 12), all-zeros, timestamped a month after release, with a DPR-mismatched fovea radius (44 vs baseline 84). The peripheral-OCR validator returns 0 words because DPR-1 captures are scored against a DPR-2 frozen baseline — and the maintainer admits in TODO.md this gate was dormant through v2.7.3, letting a regression slip past every other gate.

**Fix.** Re-freeze ocr-baseline.json at the DPR the pipeline actually emits (or upscale 2x pre-OCR), hard-fail on DPR mismatch instead of silently scaling, regenerate ocr-accuracy-curve.json so the published 84/60/62/52 actually exists as data. Until then, delete or caveat the profile in CHANGELOG.

*Evidence:* CHANGELOG.md:106; isotropic_migration.md:162,270; tests/validation/ocr-accuracy-curve.json (mode_0, processedTotalChars 0, foveaRadiusPx 44 vs 84); tests/validation/ocr-baseline.json imageSize 3840x1888; TODO.md

### #5 · [MAJOR] test-data — Committed crowding validation is 5/6 failing while releases advertise '0 regressions'; its one pass passes by OCR reading nothing

**What.** wave7c-crowding.json records mode14_isolated_recognized fail (conf 0.00), mode14_flanked_crowded fail (conf 1.00 = no crowding), and asymmetry 0.00; the single tier-1 pass (mode15_flanked) passes only because OCR returned conf 0.00 (<0.5) — passing by failure-to-detect. v2.7.0/v2.7.1 commit messages claim '0 regressions' and the CHANGELOGs never surface this; crowding is the stated mechanism of mode 14.

**Fix.** Fix the crowding capture/OCR so isolated letters read and flanked letters crowd, or relabel the file a known-failing diagnostic and remove crowding from the validated-claims list until it actually passes. Do not let an OCR-reads-nothing result count as a pass.

*Evidence:* tests/validation/wave7c-crowding.json (5 pass:false of 6; mode14 isolated conf 0, flanked conf 1; mode15_flanked passes at conf 0); commit ff21eed '314 tests pass, 0 regressions'

### #6 · [MAJOR] test-data — isotropic-rendering.json (12/12 PASS) is frozen against a near-identical capture set (mode12==mode0 to 4 decimals)

**What.** The committed v2.6.0 validation reports a clean 12/12 PASS, but check id=6 shows mode12 parafoveal stdDevL identical to mode0 to four decimals (ratio=1.000) across three pages and check id=9 shows meanL/stdDevL ratios 1.000/0.999 — the signature of comparing mode 12 against an image that barely differs from mode 0. A render that destroys parafoveal readability cannot equal the baseline to four decimals. The headline isotropy validation does not credibly exercise the post-fix renderer.

**Fix.** Re-capture the center-fixation isotropic-rendering set against the post-inert-fix renderer and confirm the readability/mode-comparison ratios move off exactly 1.000; if they stay at 1.000 the test is not exercising the isotropic mode and the metric must be replaced with one that registers the pooling.

*Evidence:* tests/validation/isotropic-rendering.json check id=6 'ratio=1.000 m0=0.1329' x3 pages, check id=9 ratios 1.000/0.999, timestamp 2026-03-20T00:30Z

### #7 · [MAJOR] bio-plausibility — Mode 17 length-tuning ships with its named CBM-2002 validation and three unit tests never built

**What.** Mode 17's whole rationale (sigmoid suppression matching the Cavanaugh-Bair-Movshon 2002 length-tuning curve) is asserted but the two promised validation scripts do not exist and the three tests named in mode 17's metadata exist nowhere and are read by no code. The mechanism and citation chain are sound and the visually-inert outcome is honestly documented, but the quantitative bio claim is unvalidated parameter-fitting wearing the citation.

**Fix.** Build the CBM-2002 synthetic-Gabor curve-replication harness before claiming biological fidelity, OR downgrade modes.json/spec language from 'replicates' to 'inspired by, validation pending', and either implement the three named tests or remove them from the mode metadata.

*Evidence:* scripts/validate-cavanaugh-length-tuning.js and scripts/validate-length-tuning.js absent; shared/modes.json mode 17 tests:[...] names not found in tests/ or scripts/; docs/specs/length_tuned_edge_suppression.md P3 unshipped

### #8 · [MAJOR] test-data — Length-tuning / Mode 17 validation artifacts are gitignored and the two validation scripts are missing

**What.** Every number backing the HEAD length-tuning feature lives in PNGs/manifests that are gitignored (git ls-files returns empty; the dir is git check-ignore'd), so the project's own evidence is unreproducible from a clone. Combined with the missing validation scripts, the headline feature has zero in-repo validation backing.

**Fix.** Either force-add the A/B captures and a machine-readable manifest into the repo, or commit a deterministic validation script that regenerates the headline numbers on demand. Do not anchor a shipped feature's claims on disk-only artifacts.

*Evidence:* git ls-files tests/golden-captures/length-tuning-ab/ = empty; git check-ignore on the dir exits 0; scripts/validate-*length* absent

### #9 · [MAJOR] test-data — radial-profile regression compares a file against a 2ms clone of itself, frozen on mode 0, never re-frozen across two default graduations

**What.** radial-profile-baseline.json and radial-profile.json are identical in all 20 rings except a 2ms timestamp; the validator writes both from the same in-memory profile object on a --freeze-baseline run, so drift is 0% by construction. The baseline is mode 0 (passthrough), frozen at v2.6.0, never regenerated through the 12->14 or mode-15 changes. The regression cannot detect drift in any shipping peripheral mode.

**Fix.** Freeze the radial baseline from the current default mode in a separate run than the results file; record the source mode-id in the baseline JSON and fail if it does not match modes.json default; keep only the content-derived monotonic-decline/no-fog invariants if the self-comparison is removed.

*Evidence:* tests/validation/radial-profile-baseline.json vs radial-profile.json identical except timestamps; scripts/validate-radial-profile.js writes baseline and results from the same computeProfile result; baseline screenshot smoke_dashboard_mode0.png

### #10 · [MINOR] release-hygiene — Stale 'pyrtools' provenance, false 'C2-continuous' label, unbacked 'Figma parity' and MAD=0.86 headlines

**What.** v2.7.0's pyramid reference is hand-rolled numpy/scipy but labeled 'pyrtools' (weaker than independent ground truth); v2.7.1 claims 'C2-continuous' twice as the Mach-band-fix rationale (mathematically C1); v2.7.1's flagship 'Figma plugin parity with desktop v2.7' has zero backing files in-repo; v2.7.0's MAD=0.86 headline measures the gap to a broken (variance-0.000) baseline. A cluster of headline claims outrunning evidence.

**Fix.** Relabel the reference as a self-consistency check (not pyrtools ground truth); change 'C2-continuous' to 'de-stacked smoothstep boundaries'; remove or scope the Figma parity claim to its own repo with a cross-link; reframe MAD=0.86 as 'baseline was dead', not a fidelity proof.

*Evidence:* scripts/generate-pyramid-reference.py imports numpy/scipy only, CHANGELOG/release-notes say pyrtools; commits 0dc34ad/c266259 'C2-continuous'; CHANGELOG.md:28 Figma parity, git diff v2.7.0..v2.7.1 no figma files; docs/validation-journal.md Tier 2.5 variance 0.000

### #11 · [MINOR] usability — Default label drift: mode 0 and the menu still tagged '(Default)' while code and category point to mode 14

**What.** The shipping default is mode 14 (category:default and code), but shared/modes.json bakes '(Default)' into the mode-0 label and menu-template.js labels both mode 0 and mode 12 '(Default)'. Three sources disagree on which mode is default, propagating into every 'mode12 ... Default' caption.

**Fix.** Strip '(Default)' from the mode-0 and mode-12 label strings and from menu-template.js; render the Default suffix dynamically from the modes.json category:'default' entry so it cannot drift.

*Evidence:* shared/modes.json id 0 label 'High-Key Ghosting (Default)', category:default on id 14; menu-template.js stale '(Default)' on id 0 and id 12

### #12 · [MINOR] test-data — Empty golden SSIM/PSNR summaries and a phantom v2.8.0 with a no-op pixel threshold

**What.** docs/golden/summary-2.6.0.json and summary-2.8.0.json both have results:[] — the golden image-regression layer has never captured a comparison. summary-2.8.0.json declares a version with no tag and no CHANGELOG, with maxPixelDiff:255 (accepts any difference — a no-op gate). The browser<->Figma parity the README implies was never computed.

**Fix.** Populate the goldens with real captures and SSIM/PSNR thresholds that can fail, or delete the empty summaries and phantom v2.8.0 dir; update docs/golden/README.md to state parity is not currently computed; drop maxPixelDiff:255.

*Evidence:* docs/golden/summary-2.6.0.json and summary-2.8.0.json results:[]; summary-2.8.0.json maxPixelDiff:255; empty figma/v2.6.0, v2.8.0 dirs

### #13 · [MINOR] release-hygiene — Stale Brown-SSIM 'metamer targets hit' table left uncorrected in an implemented spec

**What.** tier3_lessons_learned.md still presents mode-15 Brown-comparison SSIM numbers as a sector-pipeline scientific win ('hit or exceeded Brown metamer targets'), but the later retrospective establishes every such number measured the MIP/DoG fallback geometry mismatch, not signal-loss magnitude. The CHANGELOG and next-steps carry the correction; the implemented spec was not back-annotated, so a reader citing it draws a now-known-false conclusion.

**Fix.** Add a dated caveat banner at the top of tier3_lessons_learned.md (and any implemented spec carrying pre-2026-04-17 mode-15 SSIM) noting the numbers measured the fallback path, not sector pooling.

*Evidence:* docs/specs/implemented/tier3_lessons_learned.md SSIM table; docs/next-steps-2026-04.md ('SSIM deltas were mostly meaningless ... measuring geometry mismatch')

### #14 · [MINOR] test-data — v2.7.2 tagged build silently bundles ~5900 lines of undocumented feature work including a mode-12 shader change

**What.** The v2.7.1..v2.7.2 range is 79 files, +5925/-162, but the [2.7.2] CHANGELOG documents only the one-line Visual-Memory fix. The bundle includes the Option A V4 eccentricity shader path (a new v4_eccentricity_source field on the audit-anchor mode 12) and re-adds num_cortical_rings=50 to mode 14 — bio-plausibility-relevant, higher-risk changes shipped in a 'hotfix' tag with no CHANGELOG line.

**Fix.** Adopt a policy that dot-releases tag only the documented fix or that all shader/modes.json changes get a CHANGELOG line; retroactively document the mode-12/mode-14 changes that shipped in the 2.7.2 build.

*Evidence:* git diff --stat v2.7.1..v2.7.2 (79 files, +5925/-162); shared/modes.json diff adds v4_eccentricity_source on mode 12; mode 14 rings re-added; CHANGELOG [2.7.2] silent

## "Lost the way" moments

- v2.7.0: the default churned from mode 12 (FOVI isotropic cortical grid, the v2.6.0 scientific anchor) to mode 14 (shatter-displacement Pyramid Mongrel with num_cortical_rings absent) only ~5 days after isotropic shipped as default — the bio-motivated geometry was dropped from the face of the tool (CHANGELOG [2.7.0]; git show v2.7.0:shared/modes.json).
- v2.7.0: the new default mode 14 was shipped riding a 9-storage-buffer reconstruct path with no device-limit guard (webgpu-probe.js never raises maxStorageBuffersPerShaderStage), latent and unacknowledged — the exact silent-MIP-fallback that v2.7.3 later confessed only for mode 15.
- v2.7.1: 'Figma plugin parity with desktop v2.7' headlined with zero backing files in-repo, and 'C2-continuous' claimed twice as the Mach-band-fix rationale when the math is C1 — claims outrunning evidence in the same release as real shader work.
- v2.7.2: a one-line hotfix tag silently bundled ~5900 lines of undocumented feature work, including the mode-12 V4 eccentricity shader change and re-adding num_cortical_rings=50 to the default mode 14 — none of it in the [2.7.2] CHANGELOG.
- v2.7.3: a real pixel change (dog_e2 0.15->0.10) and an acuity-falloff tune shipped with the peripheral-OCR gate dormant by the maintainer's own admission (TODO.md) and zero regenerated images — and the release was never git-tagged.
- HEAD: 83 commits of shipped feature work (length-tuning, Mode 17, BGRA fix, congestion self-heal) landed untagged, unversioned (package.json still 2.7.3), and unlogged, with validation artifacts gitignored and the two promised validation scripts never written — the project stopped behaving like a released tool.
- Across the arc: confidence migrated from images to JSON unit tests that cannot detect a peripheral-readability regression — green geometry/config/hash suites coexisting with a dead OCR gate, a radial baseline compared against a 2ms clone of itself, a 5/6-failing crowding validation, and empty golden summaries including a phantom v2.8.0.

## Specialist-lens trajectories

- **images** — MIXED: The anchor itself is sound: Mode 12 FOVI-isotropic captures (docs/golden/isotropic-comparison/*_mode12_isotropic.png, Mar 21) genuinely show radially-symmetric cortical sampling — crisp foveal "+", graded crowding outward — not shatter, not axis-aligned sin*cos fringing, not plain MIP blur. The isotropic-side-by-side.html figure is self-consistent and correctly labels mode 8 as "Polar" (matching menu/modes.json). The v2.7.3 honesty pass on Mode 15 is real and well-owned. BUT the surrounding image corpus has drifted from the code: (1) a phantom v2.8 release is implied by docs/golden/summary-2.8.0.json + an empty figma/v2.8.0/ dir while HEAD is v2.7.3 with no v2.8 tag; (2) both golden summary JSONs (2.6.0, 2.8.0) carry empty results[] and ALL three figma/ comparison dirs are empty — the "browser↔Figma parity" the README/summaries describe was never actually computed; (3) the mode-comparison/ set ships stale Feb-28 overlays mislabeled against the post-rename taxonomy — mode6 appears as both "fovi" and "logpolar", and mode8 as "gaussian" (it is Polar Pooling), so a viewer comparing modes sees contradictory labels and a near-undistorted "mode8_gaussian" that misrepresents foveation; (4) the new capture-overlay hygiene test only guards debug-overlay naming, not mode-number↔label correctness, so these mislabels pass CI; (5) the shipping default is Mode 14 (main.js:28, scrutinizer.js:109) yet the menu still tags BOTH mode 0 and mode 12 as "(Default)". Net: the headline isotropic claim is backed by the images, but the comparison/parity scaffolding around it is partly empty, stale, or mislabeled.
- **test-data** — MIXED: The unit-test layer (geometry, pyramid-vs-pyrtools, modes.json regression guards, config-hash) is genuinely healthy at HEAD: isotropic-sectors 19/19, pyramid 39/39, validation-regression 28/28, mind2web-config-hash 15/15 all pass Electron-free, and the v2.7.3 dog_e2 0.15→0.10 tune is real and correctly wired (modes.json modes 10/14/16 = 0.10 at shared/modes.json:354/447/549, plumbed to the shader uniform via renderer/webgl-renderer.js:697→932). But the IMAGE-derived validation layer — the part that actually measures peripheral vision quality — has rotted, and the v2.6.0 CHANGELOG's two headline validation claims do not reproduce from the stored artifacts. The published "OCR Profile (Mode 12): Fovea 84/Para 60/Near 62/Far 52" is non-reproducible: the gate that produced it is dead (DPR-1 captures vs a DPR-2 frozen baseline → tesseract returns 0 words), the committed ocr-accuracy-curve.json is an all-zeros degenerate run, and the v2.6.0 "Fixed: OCR Baseline re-frozen at 1x DPR" claim is false — the committed ocr-baseline.json was never 1x. The radial-profile regression compares a file against a 2ms-apart clone of itself (zero drift by construction) frozen against mode 0 and never re-frozen across two default-mode graduations. wave7c-crowding.json and subband-entropy-curve.json are committed in failing/degenerate states. Golden SSIM/PSNR summaries are empty shells, including a phantom v2.8.0 with no tag/CHANGELOG and a no-op maxPixelDiff=255. Release hygiene is loose: package.json says 2.7.3 but the latest tag is v2.7.2, HEAD is 83 commits past it, and v2.6.1/v2.7.3/v2.8.0 are all untagged. The strong mitigating signal: TODO.md:17 and the v2.7.3 commit message own the OCR-gate failure precisely and name it as the regression that slipped past every other gate — honest, not hidden.
- **bio-plausibility** — MIXED: Net: the tool is MORE biologically defensible than at v2.6.0 on honesty and on the per-band/chromatic/eccentricity laws, but it REGRESSED on its headline isotropic-cortical claim and added a new mechanism (Mode 17 V1 length-tuning) whose bio-validation was never executed. The 2.7.3 acuity_loss/cortical_pooling taxonomy genuinely resolves the overclaim by RELABELING rather than fixing: Mode 15's cortical-sector pipeline still silently falls back to pixel-local DoG blur at HEAD because webgpu-probe.js:59-66 never raises maxStorageBuffersPerShaderStage above the default 8, while the reconstruct pass (webgpu-pyramid-compute.js:409-423) binds 9 storage buffers. So L1 pooling-geometry is still open — and worse, the v2.6.0 anchor mode (Mode 12 FOVI isotropic grid) was DEMOTED from default to Mode 14 (shatter-displacement Pyramid Mongrel) in v2.7.0, so the shipped default no longer uses the isotropic cortical geometry the project anchors on. The per-band M-scaling cutoffs (E2x(2^k-1), Rovamo&Virsu), chromatic decay (castleCSF rg=0.085/yv=0.014, supra=0.5), and dog_e2 0.15->0.10 tune are all faithfully implemented and unit-test-validated against the cited sources. Mode 17 length-tuning has a real end-stopping motivation (Hubel-Wiesel 1965, CBM 2002) and an honestly-documented null result (8% per-channel max delta, invisible in A/B), but the persistence probe diverges from true end-stopping (no edge-energy gate on probed samples) and the CBM 2002 curve-replication validation (P3) and the three named unit tests were never built. Credit the exceptional honesty; penalize the relabel-not-fix on L1, the demotion of the anchor mode, the stale Brown-SSIM 'wins' left uncorrected in tier3_lessons_learned.md, and the unvalidated new mechanism.
- **usability** — MIXED: Trajectory since v2.6.0 is MIXED. Honesty strong; live regressions in default mode, menu, and readability gate.
