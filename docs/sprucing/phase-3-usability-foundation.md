# Phase 3 — Usability-testing foundation

*Goal of the phase: build the minimal-credible foundation for running usability studies with Scrutinizer, reusing what already exists rather than inventing. The hard parts (scanpath replay, gazeplot pipeline with rigorous coordinates, behavioral instrumentation, a written platform spec) are already built — this phase adds the connective tissue.*

**Gate:** requires the Phase 2 control plane (P2-1) and per-trial condition toggle (P2-2). A study that can't set conditions programmatically or export a unified event log isn't credible. Do not start P3 until Phase 2 exits.

## What already exists (reuse, don't rebuild)

- **Scanpath replay engine** — `renderer/scanpath-player.js` (biologically-plausible saccades: minimum-jerk per Flash & Hogan 1985, main-sequence duration per Bahill 1975), `renderer/scanpath/scanpath-types.js` (`Fixation`/`ScanpathEvent`/`MouseTimelineEvent`/`ScrollTimelineEvent` with xpath DOM anchors), importers for AdSERP/COCO-Search18/uEyes. **`ScanpathData` is the ready-made session schema.**
- **Full-page gazeplot pipeline** — `scripts/capture-fullpage-gazeplot.js`, `scripts/batch-adserp-gazeplots.js`, and `docs/adserp-coordinate-system.md` (page-space vs screen-space, DPI scaling, scroll-offset subtraction — the most error-prone part of gaze work, already solved and documented).
- **Behavioral instrumentation** — `scrutinizer-www/src/js/{approach-retreat,clicksense,reading-doppler}.js` (dwell, AOI approach/retreat with a clicked/deferred/evaluated_rejected/not_approached taxonomy, IAB viewability, click-confidence, DOM-path targeting). Framework-free; portable into the renderer.
- **Written platform design** — `docs/specs/human_subjects_data_collection.md` (Mode A/B/C, config schema, export formats, IRB posture) and `docs/JSPSYCH_INTEGRATION_SPEC.md`.

**Rule:** adopt `ScanpathData` as the on-disk session format and the `human_subjects_data_collection.md` config JSON as the task-definition format. Do not invent new schemas.

---

## P3-1 — ExperimentRunner: load task JSON, sequence trials, stamp metadata

**Goal:** No `ExperimentRunner`/participant/session module exists (`grep ExperimentRunner|DataCollector|counterbalance renderer/ main.js` → nothing; session/participant is only a typedef field). Build the minimal core brick: load a task-definition JSON, sequence trials/tasks, and stamp each recorded session with participant + task + condition.

**Files:** new `renderer/experiment/experiment-runner.js`; task-definition format from `docs/specs/human_subjects_data_collection.md` (the config JSON with `conditions`, `trials_per_condition`, `counterbalance`, `ppd`, `iti_ms`, etc.).

**Steps:**
1. Read `docs/specs/human_subjects_data_collection.md` config schema — use it verbatim as the input format.
2. Build `ExperimentRunner` that: parses the config, expands conditions × trials, applies counterbalancing (`latin_square` per the spec), and yields an ordered trial list.
3. For each trial: call the Phase 2 control plane (`set-mode`/`set-enabled`) to apply the condition, run the trial, and stamp the recorded session (a `ScanpathData` object) with `{participantId, taskId, condition, trialIndex}`.
4. Keep it headless-testable: the runner logic (sequencing, counterbalancing) is pure and must have unit tests independent of the app.

**Verify:**
```
npx jest tests/unit/experiment-runner.test.js   # sequencing + counterbalance are pure logic
```
**Done when:** the runner loads the spec's config JSON, produces a correctly counterbalanced trial order (unit-tested), and drives conditions via the control plane.

- [ ] P3-1 complete · **depends on P2-1, P2-2**

---

## P3-2 — DataCollector: unified timestamped session record + local export

**Goal:** No unified event stream fuses behavioral signals with per-frame render/gaze state, and nothing exports locally (`renderer/logger.js` is a console forwarder; the behavioral libs sink to PostHog cloud). Build a `DataCollector` that merges the streams into one timestamped session record and writes local CSV+JSON per the spec's export schema. **This unification is what makes results credible and re-analyzable.**

**Files:** new `renderer/experiment/data-collector.js`; export schema from `human_subjects_data_collection.md` (per-trial CSV + per-fixation Scrutinizer-snapshot JSON).

**Steps:**
1. Merge three streams with a common `performance.now()` clock:
   - Behavioral episodes from the ported clicksense/approach-retreat/reading-doppler libs (P3-4).
   - Mouse/gaze samples (60Hz) — reuse the control plane's event log (P2-1 `export-event-log`).
   - Per-fixation Scrutinizer pipeline snapshots: MIP level, density gate, saliency, availability score at AOI centroids (the app already computes these internally; expose them at fixation time).
2. Write two artifacts per session: a trial-level CSV (stimulus, condition, target, response, RT, correct) and a per-fixation JSON (the pipeline snapshots). Use the AdSERP coordinate conventions (`docs/adserp-coordinate-system.md`) for all spatial fields.
3. Local-only: no cloud sink. Swap the behavioral libs' PostHog adapter for a local file writer (P3-4).

**Verify:**
```
# run a scripted 2-trial session via the control plane, confirm both artifacts are written and parse
node -e "const c=require('fs'); /* read the emitted session dir, assert CSV rows + fixation JSON exist */"
```
**Done when:** a scripted session produces one CSV + one per-fixation JSON, spatially consistent with the AdSERP coordinate system, merging behavioral + gaze + pipeline-snapshot streams on one clock.

- [ ] P3-2 complete · **depends on P2-1, P1-5** (tier/DPR in snapshots)

---

## P3-3 — BubbleView click-to-deblur mode: the first study paradigm ⭐

**Goal:** Ship a BubbleView-style click-to-deblur task as the first usability paradigm — **no hardware, reuses the existing mouse-contingent aperture, yields attention heatmaps directly comparable to the gazeplot pipeline.** Highest-leverage first study type. (Research basis: `research/kim17bubbleview.pdf`; `docs/research-opportunities.md` §2.2 already proposes the BubbleView extension. The mouse-contingent foveation aperture in `renderer/gaze-model.js` is essentially an inverted BubbleView.)

**Files:** new task mode wiring; reuse `renderer/gaze-model.js` (aperture), `scripts/capture-fullpage-gazeplot.js` (heatmap output), `DataCollector` (P3-2).

**Steps:**
1. Add a BubbleView task mode: the stimulus renders fully degraded (peripheral pipeline everywhere); each click reveals a foveal "bubble" at the click point for a short window, and the click location + timestamp is recorded.
2. Accumulate click locations into an attention map using the **same** full-page gazeplot accumulation as `capture-fullpage-gazeplot.js` (scroll-corrected, page-space) so BubbleView maps and gaze maps are directly comparable.
3. Wire it through the ExperimentRunner (P3-1) and DataCollector (P3-2) so a BubbleView study is just a task-definition JSON.

**Verify:**
```
# scripted click sequence produces a heatmap PNG comparable to the gazeplot pipeline output
ls tests/golden-captures/bubbleview/ 2>/dev/null | head
```
**Done when:** a BubbleView session records clicks and produces an attention heatmap in the same coordinate frame as the gazeplot pipeline, drivable from a task-definition JSON with no eye tracker.

- [ ] P3-3 complete · **depends on P3-1, P3-2**

---

## P3-4 — Port the behavioral instrumentation into the renderer (local sink)

**Goal:** The clicksense/approach-retreat/reading-doppler libs live in `scrutinizer-www` and sink to PostHog. Port them into the Electron renderer to instrument any loaded page during a session, with a **local** file sink instead of cloud.

**Files:** copy `scrutinizer-www/src/js/{approach-retreat,clicksense,reading-doppler}.js` into `renderer/instrumentation/`; replace their `createPostHogAdapter` with a local adapter feeding `DataCollector` (P3-2).

**Steps:**
1. Vendor the three libs (they're framework-free). Keep them as a clean copy with a header noting the source-of-truth is `scrutinizer-www` (mirror the "don't rebuild in other repos" rule — decide which repo owns them, cross-link).
2. Replace the PostHog sink with a local adapter that emits `ar_episode`/`ar_click`/`ar_session_summary` events into the DataCollector's stream.
3. Attach them to the loaded-page context when a session is active.

**Verify:**
```
# during a scripted session, confirm approach-retreat episodes appear in the local session record (not PostHog)
```
**Done when:** the three libs run in-renderer, emit to the local DataCollector, and produce per-element behavioral signals in the session record.

- [ ] P3-4 complete · **depends on P3-2**

---

## P3-5 — Consent / debrief screen + local data-retention

**Goal:** `human_subjects_data_collection.md` documents an ethics/IRB posture and references a `docs/templates/` consent dir that doesn't exist. Add a lightweight consent/debrief flow and a stated local-only retention policy. (The app being Electron/offline already satisfies most of the posture.)

**Files:** new consent/debrief screens; create `docs/templates/` with consent + debrief text.

**Steps:**
1. Add a consent screen shown before a session starts (checkbox + participant-provided anonymous ID) and a debrief screen after.
2. Create `docs/templates/consent.md` and `docs/templates/debrief.md` (the referenced-but-missing templates).
3. State retention: data written local-only; if webcam gaze (MediaPipe/WebGazer) is added later, keep frames in-worker, never persist raw video.

**Verify:**
```
test -d docs/templates && ls docs/templates
```
**Done when:** consent + debrief screens gate a session, and the referenced template files exist.

- [ ] P3-5 complete

---

## Phase 3 exit criteria

A usability study runs end-to-end from a task-definition JSON: consent → counterbalanced trials with programmatic conditions → unified local session record (behavioral + gaze + pipeline snapshots) → attention heatmap in the gazeplot coordinate frame → debrief. The first shipped paradigm (BubbleView) needs no hardware. Every artifact is reproducible and re-analyzable. **This is the usability-testing foundation, built on a verified instrument.**

---

## Notes on scope discipline

- The Mode C "squint test" (researcher-as-participant loading a real page) **already works today** per the spec — it just lacks structured task-definition + export. P3-1/P3-2 give it exactly that. Ship Mode C first if you want an early win before full A/B studies.
- Eye-tracking hardware / WebGazer is explicitly **out of scope** for the minimal foundation — mouse trajectory is a documented cheap proxy, and BubbleView needs no tracker. Add hardware gaze only after the mouse-based foundation is solid.
