# Cursor Trail Fidelity: presence, affordance, kinematics

*Status: SPEC / NOT IMPLEMENTED (2026-08-16).
Extends [`session-capture-procedural-replay.md`](session-capture-procedural-replay.md);
does not replace it. That spec defines the session record and the evtrack →
`ScanpathData` wire format, and its write path is implemented
(`renderer/instrumentation/event-capture.js`). This spec covers the five gaps
that remain in the cursor lane, and closes them **in-process**, without a native
screen recorder or OS-level event tap.*

## Decision and rationale

The cursor trail stays a first-party, in-renderer artifact. The one exception is
an out-of-viewport position fill sourced from the main process via Electron's
public `screen.getCursorScreenPoint()` (already used at `main.js:1616`), which
needs no native module and no Accessibility TCC grant.

Evaluated and rejected: a ScreenCaptureKit-based native recorder
(`node-mac-recorder` and its forks) for its cursor-tracking side channel. It
loses on every row of this comparison:

| | native OS tap | in-process (this spec) |
|---|---|---|
| Attribution | screen coords only; the element is unknown | element + xpath at the sample |
| Cursor shape | OS-rendered shape, guessed | resolved CSS `cursor`, plus the element that declared it |
| Rate | fixed poll (~60 Hz) | device-native via coalesced events |
| Clock | separate clock, sync-corrected post hoc | same `performance.now()` base as the trail |
| Cost | node-gyp + Electron ABI rebuild, notarized binary, TCC prompts | none |

The one capability only a native tap has (cursor position while Scrutinizer
is not frontmost) is recovered by C5 below at a fraction of the cost.

## What is missing today

`event-capture.js` polls `mousemove`/`scroll` at 16 ms and captures discrete
events including `blur`/`focus`. It does **not** record:

1. **Presence.** No `mouseleave`/`mouseenter` on the document, no
   `visibilitychange`. A cursor parked outside the window is indistinguishable
   from a stationary cursor inside it. Every dwell-based measure inherits that
   ambiguity: approach-retreat's `deferred` class is defined by return visits
   after a long non-click residence, and an abandoned cursor produces the same
   long residence.
2. **Affordance state.** The resolved CSS `cursor` at the hover point is the
   interface's signal to the participant about what is actionable. Not captured.
3. **Sub-sample kinematics.** 60 Hz undersamples fast cursor movement;
   submovement counts and peak-velocity estimates (the clicksense approach-
   dynamics lane) are aliased.
4. **Foveation coupling.** `event-capture.js` reserves a per-row `extras`
   callback for foveation state (`opts.extras`, wired at the tracker options),
   but nothing supplies it. In RFV mode the fovea follows the cursor, so a trail
   without the foveation config is not sufficient for counterfactual replay.
5. **Dark time.** HUD interaction flips the overlay out of click-through
   (`ipcMain.on('overlay:set-interactive')`, `main.js:934`), so the content
   window sees a `mouseleave` and the trail simply stops. App switches do the
   same. Both currently read as "participant sat still."

## C1: Presence intervals

Capture `mouseenter`/`mouseleave` on `document.documentElement`,
`visibilitychange`, and the existing window `blur`/`focus`, and reduce them to
an explicit interval list. Presence is a **derived-at-capture** exception to the
raw-rows rule, because the reduction is lossless and the raw edges are also
retained in `events[]`.

```jsonc
// ScanpathData.presenceTimeline — new, optional
[
  { "tStart": 0,     "tEnd": 18430, "state": "in_viewport" },
  { "tStart": 18430, "tEnd": 19110, "state": "in_chrome"   },  // C5-attributed
  { "tStart": 19110, "tEnd": 24007, "state": "app_blurred" },
  { "tStart": 24007, "tEnd": 61250, "state": "in_viewport" }
]
```

States: `in_viewport` | `in_chrome` (cursor inside the app frame but outside the
content area: toolbar or HUD) | `app_blurred` (window not focused) |
`tab_hidden` (`document.hidden`) | `unknown`.

Rules:
- Intervals tile the task with no gaps and no overlaps; the union equals task
  duration. This is an assertable invariant, so make it a test.
- Unbalanced edges (leave with no matching enter, task ends mid-interval) close
  at the task boundary and set `presenceHealth: "unbalanced_edges"`.
- Precedence when signals conflict: `tab_hidden` > `app_blurred` > `in_chrome` >
  `in_viewport`.
- **Never** interpolate cursor position across a non-`in_viewport` interval.
  Consumers must treat those spans as censored and exclude them from dwell.

## C2: Affordance state

On each polled row, resolve the cursor the page is presenting:

```js
const el = document.elementFromPoint(x, y);
const shape = el ? getComputedStyle(el).cursor : null;   // 'pointer', 'text', …
```

Emit **on change only**. The value is piecewise-constant and the
change instants are the informative part.

```jsonc
// MouseTimelineEvent, additive optional fields
{ "t": 4820, "x": 611, "y": 342, "event": "mousemove", "xpath": "…",
  "cursorShape": "pointer",        // only on the row where it changed
  "buttons": 0 }                    // MouseEvent.buttons bitmask, every row
```

`buttons` separates free movement from drag and from select-to-read; both are
currently invisible between a `mousedown` and its `mouseup`.

Cost control: `elementFromPoint` + `getComputedStyle` forces style resolution.
Run it at most once per animation frame and skip it entirely when the pointer
has not moved since the last sample. If the frame budget regresses, this lane
degrades to hover-transition sampling (fire only when `xpath` changes). Measure
before choosing.

## C3: Sub-sample kinematics (opt-in)

Add a `pointermove` listener alongside evtrack's polled
`mousemove`. The shipped row stream stays canonical; this lane only enriches it.

```jsonc
{ "t": 4836, "x": 618, "y": 340, "event": "mousemove",
  "sub": [[3,2,-1],[4,3,-1],[5,2,0]] }   // [dtMs, dx, dy] since previous sample
```

Store deltas rather than absolutes, because the payload is the size driver. `getCoalescedEvents()`
returns the device-native trail (typically ~125 Hz for a mouse and ~90–120 Hz
for a trackpad, higher for gaming mice), so budget roughly 1–2 MB per five-minute
task. Local disk sink, but not free: gate behind `cursorKinematics: true` in the
study config and record the effective setting in the envelope.

Derive post hoc, never at capture: velocity, acceleration, submovement counts,
Fitts-style time-to-target, course corrections.

## C4: Foveation coupling

Supply the reserved `extras` hook. Emit the foveation state **on change**, with
one mandatory row at task start so every trail opens with a known config:

```jsonc
{ "t": 0, "extras": { "mode": "rfv", "modeId": 12, "foveaRadiusPx": 180,
                      "foveaX": 756, "foveaY": 491, "dpr": 2 } }
```

`foveaX`/`foveaY` are recorded even in RFV where they track the cursor: they are
what the renderer used, and drift between the cursor row and the
rendered fovea is a measurable, and therefore checkable, quantity. Same
coordinate contract as the trail (client-viewport CSS px), stated in the
envelope rather than inferred.

## C5: Out-of-viewport fill

While a study task is active and presence is not `in_viewport`, the main process
polls `screen.getCursorScreenPoint()` and forwards positions to the collector.
The existing poller at `main.js:1616` is the wrong instrument as written: it
returns early when the window is not focused (`main.js:1597`), which is exactly
the interval we need. Add a separate, study-scoped poller:

- Rate 100 ms (the trail polls at 16 ms). This lane records where the cursor
  went and is not used for kinematics.
- Runs only between task start and Done, only when C5 is enabled.
- Emits `{ t, screenX, screenY, state }` into `presenceTimeline`'s companion
  array, in **screen space**, a different frame from the trail. Declare it in
  the envelope's `coordinates` block alongside the existing three; downstream
  conversion needs `win.getContentBounds()`, so snapshot that per interval.
- Classifies `in_chrome` by testing the point against content bounds and the
  toolbar offset (`toolbarHeightForWindow()`, `main.js:123`).

**Privacy.** C5 records cursor position while the
participant is in another application. It must be disclosed in the consent text,
must record position only (never window titles, app identity, or screen content),
and must be independently disableable per study (`cursorOutOfViewport: false`),
with the effective value in the envelope. Default off for anything but internal
pilots until the consent language ships.

## Envelope and schema versioning

Trail rows gain only optional fields, so `ScanpathData` consumers that ignore
them keep working; approach-retreat and clicksense ingest them unchanged.

The envelope is different. A consumer computing dwell must know whether
presence gating was available, because its absence silently changes what a dwell
number means. Bump to `scrutinizer-session-capture/2` and add:

```jsonc
"capture": {
  "schema": "scrutinizer-session-capture/2",
  "lanes": ["cursor-basic", "presence", "affordance", "kinematics", "foveation"],
  "pollMs": 16,
  "cursorKinematics": true,
  "cursorOutOfViewport": false
}
```

Compat rule: an envelope with no `lanes` key is `["cursor-basic"]`. Analysis code
must branch on `lanes`, never on field presence in an arbitrary row.

## Health and QC

Extend `health()` (`event-capture.js:413`) with lane-scoped codes rather than
overloading the existing ones:

| code | meaning |
|---|---|
| `presence_unbalanced` | edges did not tile the task; intervals were force-closed |
| `affordance_degraded` | style-resolution budget exceeded; fell back to hover-transition sampling |
| `kinematics_unavailable` | `getCoalescedEvents` absent or returned only the parent event |
| `foveation_stale` | no `extras` row at task start |
| `oov_denied` | C5 enabled by config but no positions were produced |

A degraded lane must not fail the task. Only the existing substrate codes
(`tracker_inert`, `row_delivery_failed`, `empty_trail`) block admission.

## Validation

1. **Interval algebra** (unit, Jest). Scripted enter/leave/blur/hidden
   interleavings including unbalanced and simultaneous edges; assert tiling,
   ordering, and precedence.
2. **Synthetic driver** (integration, TEST_MODE). Dispatch a scripted pointer
   sequence with known dwell and known dark periods; assert reconstructed
   presence total equals wall clock to within one poll period, and that no
   position row falls inside a censored interval.
3. **Affordance ground truth.** A fixture page with known `cursor:` rules per
   region; assert the recorded shape transitions match the region boundaries.
4. **Kinematics parity.** Compare peak velocity from the 60 Hz rows against the
   coalesced trail on the same movement; report the aliasing gap. If it is small
   on real trackpad input, C3 is not worth its bytes. That is a legitimate
   outcome, and the test should be able to report it.
5. **Dwell delta.** Recompute approach-retreat episode durations on a captured
   session with and without presence gating. The delta measures the
   contamination in the current trail and is a reportable number for
   the leaky-cursor revision's validation section, as a measurement of dwell
   validity. The `final_dist`/`retreat_dist` leakage caveat is a separate issue.

The synthetic driver needs a run that ignores the physical mouse while still
accepting scripted pointer input. That is now available and does not need to be
re-litigated per test: `shared/input-gating.js` splits the old single TEST_MODE
question into `SCRUTINIZER_PHYSICAL_POINTER` (defaults to `ignore` under
TEST_MODE) and `SCRUTINIZER_SCRIPTED_POINTER` (defaults to `accept`), with
per-event provenance (untagged events are physical). Every path that moves the
fovea funnels through `forwardPointerToHud()` in `main.js`, so a driver test can
assert that a capture received exactly the scripted input.

## Consumer contract

What becomes computable once these land:

- **approach-retreat:** episode dwell with a censored-time denominator;
  `deferred` vs. abandoned-cursor disambiguation; entry episodes annotated with
  whether the cursor ever became `pointer` inside the AOI.
- **clicksense:** pre-click approach dynamics at device rate instead of 60 Hz;
  hold duration already comes from `mousedown`/`mouseup` in the discrete lane.
- **Counterfactual replay:** C4 makes "same session, different foveation
  parameters" reproducible, which was the original argument for procedural
  capture over video.

## Phasing

| Phase | Content | Touchpoints |
|---|---|---|
| 1 | C1 presence + envelope `/2` + health codes | `event-capture.js`, `shared/session-capture.js`, `shared/session-directory-writer.js`, `renderer/scanpath/scanpath-types.js` |
| 2 | C2 affordance + `buttons` | `event-capture.js` |
| 3 | C4 foveation `extras` | `event-capture.js`, renderer foveation state source |
| 4 | C3 kinematics (opt-in, gated on the parity test) | `event-capture.js` |
| 5 | C5 out-of-viewport fill (after consent language) | `main.js`, preload bridge, collector |

Phases 1–3 are cheap and unblock the dwell-validity work. Phase 4 is
conditional on its own validation. Phase 5 waits on the consent language.

## Out of scope

Video/screen recording of any kind (settled in the parent spec), native OS event
taps, cursor capture outside an active study task, webcam gaze, window/app
identity capture, and cross-machine clock sync.
