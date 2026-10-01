# Study Workbench: browser-based study management + analysis

*Status: SPEC (2026-07-25). Companion to
[`session-capture-procedural-replay.md`](session-capture-procedural-replay.md).
Completes the three-tier architecture: the Electron app is the **participant
instrument only**; everything the moderator/analyst does (study design, session
QC, measures, replay, reporting) happens in a browser with no thick client.*

## Architecture position

```
scrutinizer-moderator (browser web app)             Scrutinizer (Electron)
  Designer ──► session/study links ─────────────────► participant runs study
  Library ◄── session directory (files) ◄──────────── DataCollector writes
  Analysis / Report (fully client-side)
```

- **Host:** new sub-repo `scrutinizer-repo/scrutinizer-moderator`, a
  standalone static web app separate from scrutinizer-www (www stays marketing/science;
  one lead per surface). Working name `scrutinizer-moderator`; final naming is
  parked with the other naming decisions. Framework-free ES6 modules, no
  bundler. Runs locally (`npx serve`) as the primary mode, since sessions are
  local files, with a GitHub Pages deploy as convenience; both are the same
  static artifact.
- **WB-2 migrates the link builder** out of scrutinizer-www: the Designer
  supersedes `study-link-builder.html`, and www links to the moderator app
  instead of hosting practitioner tooling.
- **The session directory is the API.** The workbench consumes exactly what the
  capture spec's DataCollector writes (`envelope.json` + `trail-*.json` +
  `stimuli/*.png`). No other interchange format.
- **Fully client-side.** Session data is loaded via `<input webkitdirectory>`
  (File System Access API where available) and never leaves the machine,
  consistent with the local-only retention posture. **The moderator app ships
  with no analytics at all** (no PostHog/ClickSense anywhere in the app).
- **No server.** Remote studies work by participants returning the session
  directory (zip). An optional ingest endpoint that materializes the same
  directory layout is the only piece that would ever need a server. It is explicitly
  deferred, and the seam is already defined.

## Shared-code rule

Computational logic is **born in the engine repo** (pure modules under
`shared/`, Jest-tested) and **vendored** to scrutinizer-moderator with an
output-identical verification, exactly as `shared/study-deep-link.js` already
is for scrutinizer-www. Newly vendored: `shared/session-capture.js` (validation, `toSummary`) and a
new `shared/session-measures.js` (below). The engine repo stays the source of
truth; each vendored copy begins with a header naming its source.

## Modules

### WB-1: Session Library + CIF measures (build first; serves the pilot)

- Import one or more session directories; run `validateEnvelope` and show
  errors (coordinate contract, DPR mismatch, schema).
- **QC gate:** a task whose trail has zero rows is flagged "capture
  misconfigured". This is where the inert-tracker footgun (script-tag
  injection) becomes visible instead of silent.
- Roster table: participant × task, outcome, duration, link status.
- New pure module `shared/session-measures.js`: Done-recorded rate,
  time-on-task, mouse miles (px and, when `ppd` is present, degrees), click
  count, per-task and aggregated across participants (median + IQR; no bare
  means for n<5). `outcome: 'done'` means the
  participant or moderator pressed Done; it is not an effectiveness measure or
  an analyst-adjudicated task-success claim. Jest-tested in the engine repo,
  vendored to the moderator app.

### WB-2: Study Designer (extends the link builder)

- Multi-task session composer: session defaults + ordered tasks (id, target
  URL, instruction text, per-task condition overrides in the deep-link
  vocabulary). Emits:
  - `scrutinizer://v1/session/start` link (vendored `study-deep-link.js`);
  - study-config JSON per `human_subjects_data_collection.md` (the P3-1
    ExperimentRunner manifest format, so one authoring surface serves both routes);
  - printable **moderator packet**: protocol script, consent + debrief text
    (`docs/templates/`), per-task checklist.

### WB-3: Replay + attention maps (2D, non-foveated)

**Implementation status:** first practitioner slice is available in
`scrutinizer-moderator`: full-page stimulus playback, scroll-corrected pointer
path, numbered click markers, page-transition/click timeline marks, scrub/play,
and a time-weighted cursor-dwell heatmap. Pre-rendered foveated-frame playback
and cross-session attention-map aggregation remain planned.

- Trail playback over the per-page stimulus screenshot: cursor path, click and
  task-event markers, timeline scrubber. Page-space via the envelope's
  coordinate contract; screenshots are the ground truth (drift-proof).
- Cursor-dwell heatmaps accumulated in page-space with the **same accumulation
  conventions as the gazeplot pipeline** so workbench maps and instrument maps
  are directly comparable.
- **Boundary (revised):** the browser never re-implements the shader pipeline.
  Foveated replay is still available *functionally* via pre-rendered
  frames: the engine's headless capture pipeline (`scripts/replay-scanpath.js
  --image --scanpath`, demonstrated on one AdSERP stimulus) renders per-fixation foveated frames,
  which land in the session directory (`foveated/<taskId>/frame-*.png`) and the
  workbench plays back as ordinary imagery. Counterfactual replay = re-running
  that CLI with different parameters; each render is stamped with its config.
  Live/interactive foveation stays in the instrument ("Open in Scrutinizer"
  deep link).

### WB-4: Report generator (ISO 25062:2025)

- Prefills the Annex B outline from loaded sessions: object of evaluation,
  evaluation type, participants, tasks (§7.4.5), **evaluation environment
  (§7.4.6) = the foveation config snapshots**, **independent variables (§7.8.4)
  = the deep-link params**, data collected, results tables from WB-1 measures.
- Analyst fills prose sections (exec summary, findings using the
  defect/problem/finding taxonomy, recommendations, conclusions).
- Export: self-contained HTML (print → PDF) + CSV of the measures tables.

### WB-5: Episode analytics (differentiator)

- Run the vendored `approach-retreat.js` offline over recorded trails: per-element
  episode taxonomy (clicked / deferred / evaluated_rejected / not_approached),
  grouped by xpath-derived element identity from the trail events (full AOI
  drawing is out of scope v1).

## Deliberately out of scope

- Server/ingest, accounts, hosted anything (seam: the session-dir zip).
- Surveys (rides with the Designer once a survey schema exists).
- In-browser foveation *shaders* (engine-repo-only, by rule). Pre-rendered
  foveated frames from the capture pipeline are in scope as playback imagery
  (WB-3 boundary note).
- Browser-run BubbleView participant page: attractive later (would remove the
  thick client for participants in one paradigm) but flagged: CSS/canvas blur is
  **not** the validated peripheral pipeline; if built, it must be labeled a
  coarse mode, never claimed as the instrument.

## Sequencing

WB-1 → WB-2 → WB-3 → WB-4 → WB-5. WB-1 is useful the day the pilot runs (it
turns raw session dirs into the findings memo's numbers); WB-2 replaces the
single-task link builder; WB-3/4 bring the workbench to parity with Uzilla ("integrated
analysis decreases the effort required to understand test results"); WB-5 goes
beyond that parity.
