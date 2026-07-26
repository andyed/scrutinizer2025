# Session Capture — Procedural Replay (P3-2 substrate)

*Status: PROCEDURAL CAPTURE WRITE PATH IMPLEMENTED IN SOURCE (2026-07-26).
Decisions from the usability-pivot review: capture is
**procedural replay, not video**. This spec defines the on-disk session record and
the input-trail wire format. It refines P3-2 in
[`../sprucing/phase-3-usability-foundation.md`](../sprucing/phase-3-usability-foundation.md);
it does not replace the P3-2 stream-fusion work (pipeline snapshots, behavioral
episodes), which layers on top of this substrate.*

## Decision and rationale

A study session is recorded as a **timestamped event log plus stimulus anchors**,
sufficient to deterministically re-render what the participant could see at every
moment. No screen/video recording.

- Event logs are queryable and aggregatable; video is analysis debt (the original
  instrumented-browser argument: Edmonds, *BRMIC* 35(2), 2003).
- In RFV mode the cursor trail + foveation config **is** the percept. Procedural
  capture supports counterfactual replay (same session, different foveation
  parameters) — video cannot.
- The replay read-side already exists: `renderer/scanpath-player.js` consumes
  `ScanpathData` (`renderer/scanpath/scanpath-types.js`). Capture is the write
  side of that format. **Do not invent a new schema.**

## Session record layout

One directory per session:

```
<session_id>-<stamp>/
  envelope.json          # scrutinizer-session-capture/1
  trail-<taskId>.json    # ScanpathData per task (mouseTimeline, scrollTimeline, events)
  stimuli/<pageVisitId>.png   # one full-page screenshot per page-visit
```

### envelope.json (`scrutinizer-session-capture/1`)

Extends the shipped `scrutinizer-session-summary/1` (`shared/study-session.js`) —
same `sessionId`/`participantId`/`taskRecords` keys, so the summary is a strict
subset. Adds:

- `capture`: `{ schema: "scrutinizer-session-capture/1", evtrackVersion,
  pollMs, appVersion, platform, screen: {w,h}, window: {w,h}, devicePixelRatio }`
  plus an optional final `health` snapshot from the capture adapter.
- `coordinates`: explicit contract declaration (see below).
- `settings` per task: the deep-link vocabulary snapshot (already produced by
  `summarySettings()`) — this is the **foveation config snapshot** and maps to
  ISO 25062:2025 §7.4.6 *evaluation environment*; deep-link params map to
  §7.8.4 *independent variables*.
- `pageVisits`: `[{ pageVisitId, taskId, url, tStart, tEnd, screenshot,
  stimulusWidth, stimulusHeight }]` — the stimulus anchor index.
- `taskRecords[*]` gain `events`: Done / Quit / Comment (with comment text) —
  the CIF task-event trail.

### Input trail — evtrack wire schema → ScanpathData

The in-page tracker is a **vendored** copy of evtrack (Leiva,
github.com/luileito/evtrack; the same telemetry format AdSERP shipped, so
existing analysis tooling — approach-retreat, clicksense — ingests Scrutinizer
study output unchanged). Vendor rules: `renderer/instrumentation/vendor/evtrack/`,
MIT license option of the dual license, header noting upstream commit, **no
server leg** (the PHP POST sink is deleted; events buffer in-page and flush to
the session directory via the existing preload bridge).

Column mapping (evtrack → `ScanpathData`):

| evtrack | ScanpathData | Notes |
|---|---|---|
| `timestamp` | `t` | ms from task start (`performance.now()` rebased) |
| `xpos`,`ypos` | `MouseTimelineEvent.x,y` | **client-viewport CSS px** (see contract) |
| `event` | `MouseTimelineEvent.event` | mousemove/mousedown/mouseup/click/wheel/… |
| `xpath` | `MouseTimelineEvent.xpath` | DOM anchor (the Uzilla DOM-path idea) |
| `attrs` | `events[].data` for click/submit | element attributes at event time |
| `extras` (callback) | reserved | per-event foveation state if config changes mid-task |
| scroll events | `ScrollTimelineEvent.scrollY` | **sampled with every polled row**, not only on scroll events — required for percept reconstruction |
| key events | `events[]` with **masked** payload | see privacy |

Cursor fidelity: evtrack polling mode for `mousemove`/`scroll`, default
`pollMs: 16` (~60 Hz; local disk sink, cost is negligible), configurable per
study via deep-link/task config; the effective value is recorded in
`envelope.capture.pollMs`. Discrete events (click, key, submit) are event-driven.

### Capture readiness and failure semantics

Tracker object presence is not capture readiness. `event-capture.start()` must
confirm that the vendored tracker bound to a real DOM window and attached event
listeners. It returns `false` with `health().code` set to
`tracker_unavailable`, `tracker_inert`, or `tracker_start_failed` when that
handshake fails; callers must not begin an analyzable task in that state.

While capture is running, zero rows is reported as `awaiting_first_row`, not as
success or failure. After `stop()`, zero rows becomes the explicit QC result
`status: "empty", code: "empty_trail"`. The serializable health snapshot is
included in `captureMeta().health` and `ScanpathData.meta.captureHealth`, so the
DataCollector and Workbench can distinguish setup failure from genuine
participant behavior without inferring from zeros.

The study lifecycle starts the tracker only after the task page finishes
loading. Tracking begins immediately and a provisional PNG is acquired before
settling, so behavior during the settle window keeps its original stimulus
anchor. A settled candidate waits for fonts, two animation frames, and a 500 ms
DOM-quiet window, bounded by a two-second hard deadline. If it materially
differs, it starts a second same-URL interval; otherwise it is discarded rather
than overwriting provisional evidence. Screenshot requests are serialized, but
the settle timer and pixel comparison run outside that queue. A newer page can
therefore wait only for an already-running screenshot, which has a five-second
deadline. A navigation sequence guard retains the prior valid anchor or fails
closed rather than attaching a PNG to the wrong URL. The tracker preserves
privacy-scrubbed rows across full navigations and stops before Done advances the
session. Each row crosses a sandboxed isolated world through a narrow preload
bridge; collector rejection or a renderer/main row-count mismatch becomes
`row_delivery_failed`, never a successful stop.

Completed artifacts are published with a same-volume atomic directory rename.
The writer refuses to publish unless every recorded task has a trail and at
least one referenced PNG stimulus. A failed or interrupted write may leave a
legacy timing summary for recovery, but never a partially admission-shaped
session directory.

### Coordinate contract

Follow `docs/adserp-coordinate-system.md`. The trail records **client-viewport
CSS px + scrollY**; page-space is derived (`yPage = y + scrollY`);
screenshot-space is derived via `devicePixelRatio`. The envelope's
`coordinates` block states all three and the DPR so no consumer guesses.
(`Fixation` coords in `ScanpathData` are physical canvas px — conversion happens
at replay import, as the AdSERP importer already does.)

### Stimulus anchors

One full-page screenshot per page-visit (navigation or SPA URL change), captured
via Chromium's full-page capture path (including content beyond the current
viewport) — a static archive, **not** a frame
stream. Rationale: live pages are non-stationary; re-rendering archived HTML
against drifted CSS is unfixable (AdSERP lesson). Replay prefers the live URL
and falls back to the screenshot through the static-stimulus path
(`docs/specs/static-stimulus-foveation.md`) when the page has drifted.

Done also takes a terminal candidate PNG. PNG decoding and pixel comparison run
on one bounded Node worker thread, never on Electron's main thread. The terminal
anchor is retained only when dimensions differ or the worker reports a material
pixel change; identical and immaterial candidates are discarded. Decode limits,
worker errors, and the bounded comparison timeout fail conservatively by
retaining the candidate. The Chromium capture itself has a five-second deadline
and terminal candidates are rejected if navigation races the screenshot. Done
is the evidence cutoff: later tracker rows are excluded, task duration uses the
participant's click, and the post-stop terminal anchor is indexed at that
logical boundary rather than presented as frame-exact acquisition. Chromium
debugger ownership and page-lifecycle coordination remain on the main process,
where `webContents` is valid.

## Privacy

- Keystrokes into `input`/`textarea`/`contenteditable`/`select` targets are
  masked: log that a key event occurred (+ target xpath), never the key identity
  or field value. Non-editable targets (shortcuts) may log key identity.
- No raw form values in `attrs` (strip `value`).
- Local-only sink; retention per P3-5 consent/debrief posture.

## Derived views (post hoc, never at capture time)

Compression at capture time is the one unrecoverable mistake — store raw rows;
derive: time-on-task, mouse miles, click count, and the procedural Done-recorded
rate; approach-retreat episode geometry (P3-4); gazeplot/attention maps.
Effectiveness/task success requires a separately defined analyst adjudication
and must not be inferred from `outcome: 'done'`. Report layer follows **ISO
25062:2025** (Annex B outline; cite it, not NIST CIF 1999).

## Out of scope

Video/screen recording, webcam gaze, cloud sinks, ExperimentRunner sequencing
(P3-1), pipeline-snapshot fusion (P3-2 proper), BubbleView (P3-3).
