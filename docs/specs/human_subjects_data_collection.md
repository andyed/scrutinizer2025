# Human Subjects Data Collection Platform

> **Last updated:** 2026-03-08

**Status:** Spec stub — not building yet
**Priority:** Future (post-v2.2)
**Depends on:** Halverson validation (Wave 5), scanpath replay infrastructure

## Vision

Turn Scrutinizer into a research instrument: run controlled experiments where participants search real or synthetic UI layouts with and without foveated rendering, collecting eye tracking + behavioral data that validates the pipeline against human performance.

The mixed-density stimulus (`halverson-mixed-density.html`) is the prototype. It already collects RT and accuracy per trial. The platform generalizes this into a configurable experiment runner with proper data collection, counterbalancing, and export.

## Two Operating Modes

### Mode A: Scrutinizer Off (Control)
Participant sees the unfiltered stimulus. Standard visual search task. Collects:
- Search time (precue click → target click)
- Fixation sequence (if eye tracker available)
- Number of fixations
- Saccade distances
- Error rate
- Mouse trajectory (cheap proxy for gaze when no tracker)

### Mode B: Scrutinizer On (Experimental)
Participant sees the stimulus rendered through Scrutinizer's pipeline at their current mouse/gaze position. Same task, same metrics. The question: **does the foveated rendering change search behavior, and if so, does it change it in the direction the pipeline predicts?**

If Scrutinizer is a good model of peripheral vision, search behavior should be *similar* in both conditions — the rendering is showing participants approximately what their visual system would have computed anyway. Divergences reveal where the simulation is wrong.

### Mode C: Scrutinizer as Usability Tool (Applied)
UX researcher loads a real web page into Scrutinizer, sets fixation points of interest (e.g., "fixate the main CTA, now look at the nav"), captures what a user would see peripherally at each fixation. No human subjects needed — the researcher IS the participant, using Scrutinizer as a "squint test" tool. This mode exists today; the platform just needs structured task definition and export.

## Data Collection Requirements

### Behavioral Data (no special hardware)
- **Trial-level**: stimulus ID, condition (on/off/mode), target, response, RT, correct/incorrect
- **Click coordinates**: where participant clicked, distance from target
- **Mouse trajectory**: sampled at 60Hz during search (x, y, timestamp)
- **Session metadata**: participant ID (anonymous), display size, viewing distance (self-reported or webcam-calibrated), browser, OS, ppd setting

### Eye Tracking Data (optional, requires hardware or WebGazer)
- **Fixation sequence**: (x, y, duration, timestamp) per fixation
- **Saccade data**: amplitude, direction, latency
- **Raw gaze stream**: for offline reanalysis
- **Integration**: WebGazer.js (webcam, ~150px accuracy) or external tracker via WebSocket

### Scrutinizer Pipeline Data (automatic)
- **Per-fixation snapshot**: MIP level map, density gate values, saliency map, chromatic retention at target and distractor locations
- **Availability score**: composite peripheral degradation at each group/element location
- **Structure map**: DOM layout density at capture time

## Experiment Configuration

```json
{
  "experiment_id": "halverson-mixed-density-replication",
  "stimuli": [
    {
      "id": "mixed-001",
      "url": "halverson-mixed-density.html?static=true&condition=mixed",
      "target_word": "honey",
      "target_group": 3,
      "target_eccentricity_deg": 2.1
    }
  ],
  "conditions": ["scrutinizer_off", "scrutinizer_mode0", "scrutinizer_mode4"],
  "trials_per_condition": 20,
  "counterbalance": "latin_square",
  "fixation_cross_ms": 500,
  "precue_timeout_ms": null,
  "max_trial_ms": 30000,
  "iti_ms": 800,
  "practice_trials": 5,
  "collect_mouse_trajectory": true,
  "collect_eye_tracking": false,
  "ppd": 38
}
```

## Data Export

### Per-trial CSV
```
participant,trial,condition,stimulus_id,target,target_ecc,response,correct,rt_ms,fixations,mean_saccade_deg,mouse_path_length
P001,1,scrutinizer_off,mixed-001,honey,2.1,honey,true,1842,6,2.3,1240
P001,2,scrutinizer_mode0,mixed-002,steel,3.4,rock,false,4210,12,1.8,2890
```

### Per-fixation CSV (if eye tracking)
```
participant,trial,fixation_num,x,y,duration_ms,saccade_amp_deg,target_ecc_deg,mip_level,density_gate,availability_score
```

### Scrutinizer snapshot JSON (per fixation)
```json
{
  "fixation": [640, 360],
  "groups": [
    {"id": 0, "centroid": [120, 80], "ecc_deg": 4.2, "mip_level": 2.1, "density": 0.73, "availability": 0.34},
    {"id": 1, "centroid": [320, 80], "ecc_deg": 2.8, "mip_level": 1.4, "density": 0.31, "availability": 0.71}
  ]
}
```

## Architecture Sketch

```
┌─────────────────────────────────────────────┐
│  ExperimentRunner                           │
│  - loads config JSON                        │
│  - manages trial sequence + counterbalance  │
│  - controls Scrutinizer on/off per trial    │
│  - collects behavioral data                 │
├─────────────────────────────────────────────┤
│  StimulusRenderer                           │
│  - loads reference page into BrowserView    │
│  - positions fixation cross / precue        │
│  - captures Scrutinizer pipeline state      │
├─────────────────────────────────────────────┤
│  DataCollector                              │
│  - mouse trajectory sampling (60Hz)         │
│  - WebGazer / external tracker integration  │
│  - per-trial + per-fixation logging         │
│  - export to CSV / JSON                     │
├─────────────────────────────────────────────┤
│  AnalysisPipeline                           │
│  - compare on vs off conditions             │
│  - compute availability → behavior corr     │
│  - generate H&H-style figures               │
│  - statistical tests (within-subjects)      │
└─────────────────────────────────────────────┘
```

## Ethics / IRB Considerations

- No deception — participants know they're doing a visual search task
- No PII collected — anonymous participant IDs
- Data stays local (Electron app, no server upload)
- Eye tracking data is processed locally and discarded after feature extraction (no raw video)
- If webcam used: explicit consent dialog, processing happens in Web Worker, no frames leave device
- Standard informed consent for visual search study (template in `docs/templates/`)
- For university collaboration (e.g., with Halverson): PI submits to their IRB, Scrutinizer is the instrument

## What Exists Today

- `halverson-mixed-density.html` — interactive search task with RT collection
- `reference-pages/` — 15 stimulus pages (static display mode via `?static=true`)
- `capture-*.js` scripts — screenshot-based measurement pipeline
- `analyze-*.js` scripts — pixel-level analysis of pipeline output
- `visual-memory.js` — fixation history with decay (could feed DataCollector)
- `gaze-model.js` — mouse-to-gaze input pipeline

## What Needs Building (Future)

1. **ExperimentRunner module** — trial sequencing, counterbalancing, condition switching
2. **DataCollector module** — mouse trajectory sampling, CSV/JSON export
3. **Scrutinizer toggle API** — programmatic on/off/mode-switch per trial (currently menu-driven)
4. **Pipeline state export** — snapshot MIP levels, density gate, saliency at arbitrary screen positions
5. **WebGazer integration** — optional webcam eye tracking (see `docs/specs/` webcam calibration backlog)
6. **Analysis scripts** — H&H-style comparison (fixation count, saccade distance, RT × condition × density)
7. **Consent flow** — participant info screen, consent checkbox, demographic survey (age, vision correction)

## Validation Study Design (When Ready)

**Halverson Replication + Extension:**

| Factor | Levels | Notes |
|--------|--------|-------|
| Rendering | Off, Mode 0 (High-Key), Mode 8 (Eyeball) | Within-subjects, counterbalanced |
| Density | Sparse, Dense, Mixed | Within-subjects, blocked |
| Participants | 20-30 | Power analysis TBD based on H&H effect sizes |

**Primary hypotheses:**
1. Search time increases with density (replicates H&H)
2. Search time is similar on vs off (Scrutinizer approximates real peripheral processing)
3. Where search time diverges on vs off, the direction correlates with availability score error (Scrutinizer over/under-degrades specific regions)
4. Sparse-first search order is preserved under Scrutinizer rendering

**Secondary measures:**
- Does Scrutinizer change saccade distance distribution?
- Does it change the fixate-nearby strategy?
- Does mouse trajectory (as gaze proxy) differ between conditions?
