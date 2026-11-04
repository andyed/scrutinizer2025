# Recorded-study capture and admission verification — 2026-10-20

A real session from a locally packaged Scrutinizer app was admitted by the
Study Workbench in Chrome. A corrupted PNG control was rejected with measures
withheld. The rehearsal also exposed and verified a repair for an unreachable
final replay anchor. This is local WIP verification, not a release or a human
usability-study result.

## Scope and provenance

- Engine: `scrutinizer2025`, branch `agent/usability-study-links`, base HEAD
  `5130629`, plus the uncommitted changes described below.
- Workbench: `scrutinizer-moderator`, base HEAD `68596ae`, plus local changes.
- Builder: `scrutinizer-www`, base HEAD `be8c951`, plus local changes.
- Package: arm64, app version 2.8.1, Electron 30.5.1; unsigned app directory,
  isolated profile, explicit `--study-link` argv launch. No install, publishing,
  version bump, commit, push, or release performed.
- Local artifacts: `output/capture-rehearsal-2026-10-20/` in the engine repo.
  `source-provenance.json` records source hashes and the app.asar hash. All five
  changed runtime files matched their packaged bytes exactly.
- Package: `package/mac-arm64/Scrutinizer.app` beneath that artifact directory.
  `build-local.cjs` records the local build configuration. The standard unsigned
  command unexpectedly invoked the notarization hook; the successful local
  build explicitly sets `afterSign: null`. Release configuration was not changed.

## Implemented

- Recorded study (2–8 tasks) is the builder default. Walkthroughs explicitly
  say they do not record and produce no Workbench session. Builder copy explains
  consent, local files, and the lack of audio/video capture. Builder-only
  analytics were removed; other website pages were not changed.
- The app identifies recorded studies and unrecorded walkthroughs, preserves
  task instructions in summary/envelope records, preserves a valid zero poll
  interval, and distinguishes a full capture, failed capture, and timing-only
  fallback on the completion screen.
- Canonical admission logic checks trail rows, coordinates, timestamps, event
  payloads, task identity, retained-row counts, sampling cadence, stopped health,
  and delivery failures. Legacy optional metadata remains supported. Workbench
  consumes the byte-identical vendored engine implementation.
- Workbench resolves exact trail paths and decodes each PNG locally, checking
  its pixel dimensions. Invalid captures receive no measures and cannot enter
  aggregates or replay.
- Comparison conditions include task target URL, task instructions, and poll
  interval, in addition to the prior environment/settings fields.
- Adjacent replay visits use one owner for boundary samples/clicks; the terminal
  Done anchor can own the endpoint. The real 4,239 ms task exposed that a 16 ms
  HTML range step snapped End to 4,224 ms. A 1 ms step now reaches the actual
  endpoint, both by keyboard scrubbing and automatic playback.

## Observed packaged capture

Session directory:
`profile/study-sessions/packaged-rehearsal-20261021T032617Z/` beneath the artifact
directory. Participant code `agent-p01`; synthetic pages served only on
localhost. Explicit baseline condition: simulation disabled, Mode 12, radius
45, comfort mode enabled, visual memory 0, poll interval 16 ms, DPR 1.

The app-selection tool remained pending while the session progressed. The
completed screen, saved files, and subsequent import/replay were directly
inspected; this record does not claim that the agent directly exercised every
consent/task gesture.

| Task | Duration | Retained rows | Click events | Result |
|---|---:|---:|---:|---|
| find-delivery | 7,077 ms | 172 | 1 | Navigated from shop to delivery page |
| save-preference | 4,239 ms | 108 | 3 | Checkbox/change/submit; saved state preserved at Done |

Both task health records and the aggregate health report `stopped`, with zero
delivery failures. Workbench displayed both tasks as linked and QC `ok`, with
280 total rows and four PNGs. Clicks are captured DOM click events, not an
assertion about the number of physical gestures or goal achievement.

The second task retained its initial PNG and a distinct zero-duration Done
anchor showing “Saved: compact digest.” Keyboard End and automatic playback
both reached page 2/2 at exactly 4,239 ms after the scrubber fix.

Independent copies in `import-controls/` preserve the original capture. The
negative copy has a distinct session ID and an eight-byte PNG signature in
place of its final PNG. Chrome reported `PNG could not be decoded`; no measures
were computed and the copy was excluded from every aggregate and replay.
The positive copy remained admitted. Native Chrome folder selection succeeded;
the extension's scripted folder selection did not deliver the files.

Evidence images in the artifact directory: `workbench-admitted.png`,
`workbench-negative-control.png`, and `replay-terminal-anchor.png`.

## Verification and remaining limits

- `npm test`: 43 unit suites, 872 passed, one todo; real desktop visual,
  memory, and integration checks passed after running with desktop access.
  A sandboxed attempt did not produce desktop test assertions and is not used
  as desktop evidence.
- Workbench: 17 integrity tests, measure smoke checks, 28 replay assertions,
  and all four vendor comparisons passed. Website build and desktop builder
  interaction checks passed. Combined diffs passed whitespace checks.
- Full scroll gate: 21/24 passed. Fixed/sticky-header cases failed once on
  backward movement and twice on insufficient visibility samples. An isolated
  fixed/sticky-header recheck passed 8/8 without a concurrent package build.
  Both reports are retained. The cause of the first failures is not proven;
  require a clean full gate before release, rather than treating the subset
  rerun as a complete release gate.
- This capture contains no scroll or keyboard events. It verifies navigation,
  ordinary pointer input, form events, and changed same-URL terminal state;
  it does not establish scrolling/keyboard collection end to end.
- OS `scrutinizer://` protocol dispatch, signed/notarized installation,
  Windows, DPR >1, long sessions, arbitrary SPAs, and human task success were
  not established by this rehearsal. Bounded PNG anchors are not video or
  continuous DOM replay.
- At the current narrow/zoomed Chrome viewport the roster is horizontally
  constrained and task IDs wrap poorly; responsive roster polish remains.
- The pre-existing edit to `docs/specs/browser-features-and-extensions.md`
  was preserved and excluded from this work. Compatible admission, builder,
  and replay changes from parallel agents were integrated; all remain
  uncommitted.
