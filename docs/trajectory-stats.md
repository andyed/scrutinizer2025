# Scrutinizer Development Trajectory

Generated 2026-03-08 from git history. 479 commits, Nov 22 2025 — present.

## Three Phases

| Phase | Dates | Duration | Commits | Lines Changed | Daily Rate | Character |
|-------|-------|----------|---------|---------------|------------|-----------|
| **1. Build** | Nov 22 — Dec 31 | 40 days | 347 | 53,682 | 1,342 lines/day, 8.7 commits/day | Core renderer, modes, saliency pipeline |
| **2. Lull** | Jan 1 — Feb 26 | 55 days | 21 | 2,593 | 47 lines/day, 0.4 commits/day | Maintenance, a few specs |
| **3. Validation Sprint** | Feb 27 — Mar 8 | 10 days | 111 | 40,669 | 4,067 lines/day, 11.1 commits/day | Five-wave validation + paper + release |

Phase 3 produced **76% of Phase 1's total output in 25% of the time** (3× the daily rate). This is the scope expansion you're feeling.

## Phase 3 Breakdown: What Happened in 10 Days

### New files created: 143

| Category | Count | Examples |
|----------|-------|---------|
| Capture scripts | 10 | capture-color-search, capture-crowding, capture-halverson, capture-gaussian-comparison |
| Analysis scripts | 10 | analyze-color-search, analyze-crowding, analyze-halverson, analyze-spatial-acuity |
| Validation scripts | 6 | validate-color-search, validate-spatial-acuity, chromatic-attenuation-table |
| Spec docs | 17 | halverson_hornof, gaussian_blur_comparison, congestion_text_density, density_gated_crowding |
| Reference pages | 4 | color-search.html, spatial-acuity.html, halverson-mixed-density.html |
| Arxiv paper | 11 | scrutinizer-system-paper.tex, references.bib, appendix figures |
| Renderer | 3 | congestion-worker.js, congestion-core.js, complexity-hud.js |
| Release notes | 5 | v1.6.0 through v2.1.0 |

### Commit themes

| Theme | Phase 1 | Phase 3 | Interpretation |
|-------|---------|---------|----------------|
| fix | 110 | 36 | Still fixing, but less — code is stabilizing |
| fovea/shader/mode | 67 | 24 | Renderer work shifted from creation to tuning |
| wave/validation | 0 | 28 | Entirely new workstream |
| spec/doc/paper | 12 | 46 | 4× increase in writing vs coding |
| congestion/density | 0 | 16 | New research thread (Mode 9 graduation) |
| color/chromatic | 2 | 15 | Peripheral color went from zero to active |

### The scope graph

```
Phase 1: Build the pipeline
  renderer ███████████████████████
  tests    ██████████████████
  docs     ████████

Phase 2: Pause
  (scattered fixes)

Phase 3: Validate + write + extend
  tests    ██████████████████████████████ (113 files — golden captures, reference pages)
  docs     ████████████████████████       (66 files — specs, paper, release notes, journal)
  scripts  ██████████████                 (27 files — capture + analysis pipeline)
  renderer ████████████                   (18 files — shader tuning, congestion worker)
```

## Why Phase 3 is Wider Than Phase 1

Phase 1 built ONE thing: the rendering pipeline. Deep but narrow — shaders, modes, saliency, structure map, UI chrome.

Phase 3 is validating that pipeline against FIVE independent psychophysical domains, writing a paper, shipping release notes for 6 versions, and opening new research threads. Each validation wave spawns:
- A reference page (stimulus)
- A capture script
- An analysis script
- A spec doc
- Golden captures
- Possibly shader fixes

Multiply by 5 waves + the Gaussian comparison + the Halverson behavioral study + the congestion graduation path, and you get 143 new files in 10 days.

### The acceleration curve

```
                                       ← you are here
Lines/day                              |
4000 ┤                                ████
     │                                ████
3000 ┤                                ████
     │                                ████
2000 ┤                                ████
     │ ██                             ████
1000 ┤ ██                             ████
     │ ██                             ████
   0 ┤ ██─────────────────────────────████
     Phase 1        Phase 2         Phase 3
     (build)        (lull)          (validate)
```

## Weekend Loading

Phase 3 commits: 40% weekend (44 of 111). This weekend (Mar 7-8) alone: 31 commits, ~13,400 lines. That's more than all of Phase 2.

## What This Means for v2.1

The validation pipeline IS the v2.1 release. The scope feels large because each wave is a mini-project (stimulus → capture → analyze → document → fix shader → repeat). But the output is coherent: every file serves the same goal of grounding the paper's claims in measurement.

The risk isn't scope creep in the traditional sense (adding features nobody asked for). It's that each validation wave keeps revealing new research threads:
- Wave 3 → density-gated crowding spec
- Wave 5 → Halverson behavioral validation → congestion text density spec
- Gaussian comparison → separate validation track

Each thread is legitimate — they're findings from running the experiments. The discipline is deciding which go in v2.1 (validation + honest reporting of limits) vs v2.2+ (congestion graduation, pixel-level edge density, human subjects).

**v2.1 ships the measurement. v2.2 acts on what the measurements reveal.**
