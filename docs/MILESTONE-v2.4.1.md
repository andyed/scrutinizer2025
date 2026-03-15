# Milestone: v2.4.1 — Strategic Rollback & Re-sequence

**Date**: 2026-03-15
**Status**: Planning (pre-execution)

## What happened

Three major changes were developed on main after v2.4.0 (tagged locally as v2.5.0 but never released):
1. **PR #4** — Foveal boundary LOD fix (V1-distorted UV gradients) + MIP fidelity test
2. **PR #5** — Biphasic RG chromatic decay (Bowers 2025)
3. **Mode 13** — WGSL-native isotropic cortical sampling

Integrating all three simultaneously created cascading issues that blocked release:

- **Scroll ghost shadows**: The async WebGPU readback (1-2 frame lag) was always present, but chromatic attenuation made the compute texture visually distinct from the source — the lag became visible as dark shadows during scroll.
- **Content-motion suppression backfired**: Attempted fix (setComputeTier(0) during scroll) caused mode 10 to oscillate between compute and MIP/DoG pipelines, worse than the original shadow.
- **Rebase conflicts**: PR #5's per-band Oklab attenuation vs local sector-frequency approach required manual conflict resolution in peripheral.frag. A `chromNormEcc` declaration was accidentally deleted, causing shader compilation failure (black screen). Caught by visual testing, not by our structural test suite.
- **chromaticAttenuate rewrite**: Stashed local changes rewrote from Oklab roundtrip to linear desaturation (gamut-safe). Correct in isolation, but added to the pile of simultaneous shader changes.

## What worked well

- **Isotropic CMF (v2.4)**: Cortical magnification sizing was clean and correct. The FOVI-derived sector geometry, fovea_deg correction, and polar quantization all validated well.
- **PR #4 blur fix**: Small, focused change (12 lines in peripheral.frag). Clean merge, clear improvement.
- **Test infrastructure**: 3,766 lines of new tests/scripts — capture runner, golden captures, MIP fidelity, isotropic sector validation, OCR peripheral, stimulus domain analysis.
- **AppleScript skill**: `/scrutinizer` menu automation works reliably for mode switching, screenshots, toggles.

## What we're keeping vs parking

### Cherry-pick onto v2.4.1 (reusable now)

| Asset | Lines | Why |
|-------|-------|-----|
| `scripts/lib/capture-manifest.js` | 109 | General capture infrastructure |
| `scripts/lib/capture-runner.js` | 163 | General capture infrastructure |
| `scripts/capture-golden.js` refactor | — | Batch capture improvements |
| `scripts/capture-mode-comparison.js` refactor | — | Batch capture improvements |
| `tests/unit/mip-fidelity.test.js` | 320 | Validates PR #4 directly |
| `tests/unit/validation-regression.test.js` | expanded | General regression guards |
| `bowers2025_sensitivity.json` | updated | Expanded from 3→5 eccentricities (added 45°, 60°), SEM values, digitization provenance, corrected citation (Gegenfurtner & Goettker, JoV 25:11:7), DOI |
| `hansen2009_color_naming.json` | updated | Corrected citation format, DOI, methodology notes (4AFC threshold task, not suprathreshold appearance) |
| `jest.config.js` | +1 line | Test config (if needed for mip-fidelity) |
| `.gitignore` | +7 lines | Review — likely general improvements |
| `tests/visual-test.html` | +16 lines | Review — may be general |
| `scripts/capture-reading-span.js` | +10 lines | Review — may be general capture fix |
| `docs/specs/control_panel.md` | 335 lines | General spec (not chromatic-dependent) |

### Preserved on feature branch (re-land later)

**Renderer / shader changes:**
| Asset | Depends on |
|-------|------------|
| `peripheral.frag` +442 lines — biphasic RG, chromaticAttenuate rewrite, V1 type 5 cortical, computeCorticalSector(), chromNormEcc | Chromatic + isotropic |
| `crowding-synth.wgsl` +379 lines — WGSL compute_sector(), sector-aware main() | Mode 13 |
| `crowding-stats.wgsl` — Config struct `_pad4` → `num_cortical_rings` | Mode 13 |
| `webgpu-crowding-compute.js` — passes `num_cortical_rings` at config index 20 | Mode 13 |
| `webgl-renderer.js` +41 lines — biphasic uniform plumbing, pipeline copy | Chromatic |
| `scrutinizer.js` +113 lines — content change detection, generation counter, scroll handling | Scroll shadow |
| `overlay.js` +9 lines | Minor |

**App / menu changes:**
| Asset | Depends on |
|-------|------------|
| `main.js` +513 lines — `--mode=N` CLI, batch test mode, capture infrastructure | Mixed (some reusable) |
| `menu-template.js` +158/-95 — menu reorg, radio groups, mode 13 entry | Mode 13 + general |
| `shared/modes.json` +139 lines — mode 13 definition, biphasic params on mode 10 | Chromatic + isotropic |

**Tests:**
| Asset | Lines | Depends on |
|-------|-------|------------|
| `tests/unit/stimulus-domain.test.js` | 398 | Chromatic model |
| `tests/unit/isotropic-sectors.test.js` | 278 | Mode 13 WGSL |
| `tests/unit/ocr-peripheral.test.js` | 203 | Isotropic sectors |
| `scripts/validate-blur-isotropy.js` | 344 | Mode 13 |
| `scripts/validate-isotropic-grid.js` | 133 | Mode 13 |
| `scripts/validate-peripheral-ocr.js` | 209 | Mode 13 |
| `tests/reference-pages/` | 3 pages | Chromatic/isotropic |
| `tests/ocr-text-grid.html` | 98 | OCR validation |
| `tests/validation/reports/` | updated | Chromatic model |
| `scripts/chromatic-attenuation-table.js` | +35 | Chromatic |
| `scripts/report-color-search.js` | +144 | Chromatic |
| `scripts/generate-brown-metamers.py` | +224 | Chromatic + MPS detection |

**Docs (low risk, mostly keep on branch):**
| Asset | Notes |
|-------|-------|
| `docs/release_notes_v2.5.0.md` | Unreleased — stays on branch |
| `docs/specs/pre_pool_chromatic_attenuation.md` | 238 lines — chromatic spec |
| `docs/specs/control_panel.md` | 335 lines — general (could cherry-pick) |
| `docs/specs/isotropic_cortical_sampling.md` | expanded |
| `docs/fidelity-gaps.md` | 111 lines — gap tracker |
| `docs/developers_guide.md` | +153 lines |
| `docs/arxiv-paper/` | minor sync |
| `ROADMAP.md` | minor |

**Other:**
| Asset | Notes |
|-------|-------|
| `package.json` / `package-lock.json` | +142 — new deps for batch test mode |
| `.gitignore` | +7 lines |
| `screenshots/v24_reading_span_comparison.png` | 1.5 MB binary |

### Outside repo (safe regardless)

- AppleScript skill: `~/.claude/skills/scrutinizer/SKILL.md`
- Claude memory files: `~/.claude/projects/.../memory/`

## Existing branches

| Branch | Status | Contents |
|--------|--------|----------|
| `claude/fix-webgl-mip-sampling-3kHXs` | Fully merged | PR #4 + PR #5 source branch (both merged via merge commits) |
| `fix/webgl-mip-sampling` | Fully merged | Earlier iteration of MIP sampling fix |
| `fix/mode13-chromatic-pooling` | 5 unmerged commits | Pre-rebase version of mode 13 + chromatic work (TTM chromatic pooling, isotropic sectors, mode 13 definition, regression tests, chromatic pooling refactor). Diverged from main before PR #5 merge — this is the code that had to be rebased, causing the conflicts. |
| `metamer` | Stale | Early Tier 4 metamer prototype (4 commits). Pre-dates current architecture. Historical reference only. |
| `feature/webcontentsview` | Stale | Electron WebContentsView migration experiment. |
| `entire/checkpoints/v1` | Metadata | Entire.io session tracking checkpoint branch. |

**New branch to create:**
| Branch | Purpose |
|--------|---------|
| `feature/chromatic-isotropic` | Snapshot of current HEAD — preserves all v2.5 work for future cherry-picking |

Note: `fix/mode13-chromatic-pooling` contains an earlier version of the isotropic + chromatic work before rebasing onto PR #5. The new `feature/chromatic-isotropic` branch will capture the post-rebase state (with conflicts resolved, chromaticAttenuate rewritten, content detection added). Both are worth keeping — they represent two approaches to the same integration.

## Chosen path

### Step 1: Preserve current work
```
git branch feature/chromatic-isotropic    # snapshot everything at HEAD
```

### Step 2: Reset main to clean milestone
```
git reset --hard 0b54693                  # v2.4 + PR #4 (blur fix)
```
Target commit: `0b54693 Merge pull request #4` — last commit before any chromatic pooling work entered the tree.

### Step 3: Cherry-pick reusable test infrastructure
Cherry-pick or manually port the capture infrastructure and MIP fidelity test from the feature branch. These have no dependency on chromatic or isotropic shader changes.

### Step 4: Tag and release
```
git tag v2.4.1
```
Release notes: "Foveal boundary blur fix + MIP fidelity validation + capture infrastructure."

### Step 5: Re-land as separate PRs (future)

**PR A: Chromatic decay** (standalone)
- Biphasic RG decay (Bowers 2025)
- chromaticAttenuate (linear desaturation)
- Per-band Oklab attenuation in sampleDoGReconstructed
- stimulus-domain.test.js, Bowers/Hansen data
- Must address: scroll shadow visibility (chromatic makes compute lag visible)

**PR B: Isotropic cortical sampling** (after PR A or independent)
- Mode 13 WGSL compute_sector()
- Sector-aware synth main()
- isotropic-sectors.test.js, OCR test, validation scripts
- Must address: mode 13 diamond artifacts (the original motivation)

**PR C: Scroll shadow mitigation** (before or with PR A)
- Content change detection (pixel hash + IPC)
- Generation-tagged readbacks
- Strategy TBD — suppression was too aggressive, continuous resynth creates smear
- Options: freeze compute during scroll, fade-out compute on motion, double-buffer

## Architectural lesson

The scroll shadow is inherent to async readback. Any change that makes the compute texture look different from the source (chromatic attenuation, synthesis noise, color shifts) will make the 1-2 frame lag visible during content motion. This must be solved at the architecture level before shipping chromatic pooling — not patched after.

## Key commits reference

| Commit | Description |
|--------|-------------|
| `v2.4.0` / `18b67bc` | Last released version |
| `0b54693` | PR #4 merge — blur fix (v2.4.1 target) |
| `e80f588` | PR #5 merge — chromatic decay enters |
| `19e67ef` | chromaticAttenuate rewrite |
| `4039521` | Isotropic cortical sampling |
| `aeea5f2` | Mode 13 WGSL + content suppression |
| HEAD (uncommitted) | Suppression reverted, shadow persists |
