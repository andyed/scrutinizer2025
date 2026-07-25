# Multi-Task Study Sessions

> **Status:** Implemented (parser, session state machine, interstitial, toolbar counter, summary writer, Link Builder session mode; unit-tested). Packaged macOS verification pending, per the v1 spec's rule that dev-mode behavior is not release evidence.
> **Implementation scope:** platform-neutral grammar; macOS first, Windows uses the same parser via its own delivery path
> **Last updated:** 2026-07-19
> **Related:** [Usability Study Deep Links and Study Toolbar](usability-study-deep-links.md), [Phase 3 — Usability-testing foundation](../sprucing/phase-3-usability-foundation.md), [Human Subjects Data Collection Platform](human_subjects_data_collection.md), [Usability-Testing Practitioner Guide](../tutorials/usability-testing-practitioner-guide.md)

## Summary

The v1 task link runs exactly one task. A moderated usability session almost never has one task: it has three to six, run in order, on the same participant, in the same sitting. Today the moderator holds that queue themselves — a sheet of separate Study Links fired by hand between tasks — and Scrutinizer has no concept that the tasks belong together (`activeStudy` in `main.js` is a single object; a second link *replaces* the first).

This spec adds a **session link**: one deep link carrying an ordered list of 2–8 tasks. Clicking it enters Study mode once; **Done** advances to the next task instead of exiting; the toolbar shows real progress ("Task 2 of 5"); the final Done exits, restores the pre-session runtime state, and writes a small local session summary. Between tasks, a neutral interstitial screen presents the next task's instructions at full size before the stimulus loads.

This is deliberately smaller than the Phase 3 `ExperimentRunner` (P3-1). It is ordered sequencing for a moderated session — no conditions × trials expansion, no counterbalancing math, no `ScanpathData` capture. Those remain P3 work. What this shares with P3 is the boundary: when ExperimentRunner lands, it should *emit* session launches in this format rather than inventing a second sequencing path.

Example:

```text
scrutinizer://v1/session/start?session_id=nav-study-p04&mode=12&fovea_radius_px=45&visual_memory_limit=5&t1.url=https%3A%2F%2Fexample.com&t1.task_id=find-billing&t1.instructions=Change%20the%20billing%20address%20on%20your%20account.&t2.url=https%3A%2F%2Fexample.com%2Fhelp&t2.task_id=find-refund-policy&t2.instructions=Find%20the%20refund%20policy.
```

## Goals

- One link runs an ordered sequence of 2–8 tasks inside Scrutinizer.
- Session-level defaults (mode, radius, memory, comfort) apply to every task; any task may override them.
- The participant sees "Task N of M" and per-task instructions; Done advances, final Done exits.
- An interstitial screen between tasks presents the next instruction readably and gives the moderator a natural pause to reset site state.
- Visual Memory resets at every task boundary, exactly as it does today between separate task links.
- One runtime snapshot at session entry; one restore at session exit. Mid-session task overrides never become the restore baseline (same rule as v1 task replacement).
- A minimal local session summary (IDs, per-task timestamps, outcomes) is written on session end.
- The grammar and parser stay platform-independent for the Windows delivery path.

## Non-goals

- Counterbalancing, condition expansion, or randomized task order — ExperimentRunner (P3-1).
- Behavioral/gaze capture, `ScanpathData` recording — DataCollector (P3-2).
- Consent/debrief screens — P3-5 (the interstitial framework here is where they will eventually mount, but they are not in this spec).
- Remote manifest loading. `scrutinizer://v1/study/run?config=<https-url>` remains reserved for studies too large or too dynamic for a self-contained link. This spec does not implement it.
- Branching, skip logic, or timed auto-advance.
- Unmoderated/self-serve operation guarantees. A session link *can* be run alone, but nothing here schedules, reminds, or uploads.

## Why inline task blocks, not a hosted manifest

The reserved manifest route requires the researcher to host a JSON file at a stable HTTPS URL. That is fine for a lab and fatal for the scrappy path: a PM or designer with no infrastructure should be able to build a five-task session in the hosted Study Link Builder and paste one link into an instruction sheet. A session of ≤8 tasks with ≤500-char instructions each fits in a link that Safari, Chrome, and Edge all deliver reliably (enforced cap below). Studies that outgrow the cap are exactly the studies that need ExperimentRunner, and they get the manifest route then.

The existing prohibition on encoding fixation arrays in links is unaffected — task blocks are small, human-auditable, and validated field-by-field like every v1 parameter.

---

## Deep-link contract

### Route

```text
scrutinizer://v1/session/start
```

`v1/task/start` is unchanged. `v1/study/run` remains reserved and rejected.

### Raw-link cap

The entire raw link must be ≤ 8192 characters. Longer links fail with `LINK_TOO_LONG` before any other parsing. This keeps the link inside every mainstream browser's and both OSes' reliable custom-scheme delivery envelope.

### Session-level parameters

| Parameter | Required | Validation | Meaning |
|---|---:|---|---|
| `session_id` | No | 1–128 chars; letters, digits, `.`, `_`, `-` | Researcher-provided session identifier; appears in the session summary |
| `participant_id` | No | Same as `session_id` | Anonymous participant code; appears in the session summary. Researchers must not put names or identifying data here |
| `fovea_radius_px` | No | Same as v1 | Session default |
| `mode` | No | Same as v1 | Session default |
| `enabled` | No | Same as v1 | Session default |
| `comfort_mode` | No | Same as v1 | Session default |
| `visual_memory_limit` | No | Same as v1 | Session default |

Session-level settings play the role the user's runtime state plays for a v1 task link: the base that per-task overrides land on. Resolution order per task: **user runtime snapshot ← session defaults ← task overrides** (`buildStudyRuntimeState` applied twice).

### Task blocks

Task parameters are prefixed `t<index>.` with 1-based, contiguous indices: `t1.url`, `t1.instructions`, `t2.url`, …

| Parameter | Required | Validation |
|---|---:|---|
| `t<i>.url` | Yes | Identical to v1 `url` (absolute http/https, ≤4096 chars decoded, no credentials) |
| `t<i>.task_id` | No | Identical to v1 `task_id` |
| `t<i>.instructions` | No | Identical to v1 `instructions` (≤500 chars, plain text, rendered with `textContent`) |
| `t<i>.fovea_radius_px` | No | Identical to v1 | 
| `t<i>.mode` | No | Identical to v1 |
| `t<i>.enabled` | No | Identical to v1 |
| `t<i>.comfort_mode` | No | Identical to v1 |
| `t<i>.visual_memory_limit` | No | Identical to v1 |

### Structural rules

- Minimum 2 task blocks, maximum 8. One task is a `task/start` link; use that route. (`TOO_FEW_TASKS` / `TOO_MANY_TASKS`)
- Indices start at 1 and must be contiguous — `t1`, `t2`, `t4` fails with `NON_CONTIGUOUS_TASKS`. Order in the link is presentation order.
- Every declared index must include `t<i>.url` (`MISSING_TARGET_URL`, message names the task index).
- Unknown parameters — including unknown prefixed names like `t1.speed` and malformed prefixes like `t0.url` or `t01.url` — fail with `UNKNOWN_PARAMETER`.
- Duplicates fail with `DUPLICATE_PARAMETER`, as in v1.
- Validation is atomic across the whole link: task 6 having a bad mode ID means nothing launches. Error messages identify the failing task index so an 8-task link is debuggable ("Task 6: the requested Scrutinizer mode is not supported.").
- All v1 parsing rules (case-sensitive names, single decode, strict integers/booleans, plain-text instructions) carry over unchanged.

### Parser shape

Extend `shared/study-deep-link.js` with the route; per-field validation is shared with the v1 code paths, not duplicated. Normalized success value:

```js
{
  version: 'v1',
  route: 'session/start',
  session: { id, participantId, defaults: { /* overrides object */ } },
  tasks: [ { id, instructions, targetUrl, origin, overrides }, … ]  // length 2–8
}
```

New error codes: `LINK_TOO_LONG`, `TOO_FEW_TASKS`, `TOO_MANY_TASKS`, `NON_CONTIGUOUS_TASKS`. All existing codes are reused with task-index context where applicable.

---

## Runtime behavior

### Session state

`activeStudy` grows a session variant (still one app-wide study at a time):

```js
{
  kind: 'session',                    // v1 task links use kind: 'task'
  deepLink: { version, route },
  session: { id, participantId, defaults },
  tasks: [ /* normalized tasks */ ],
  taskIndex: 0,                       // current task, 0-based
  taskRecords: [                      // grows as tasks complete
    { taskId, index, startedAt, endedAt, outcome, finalUrl }
  ],
  previousRuntimeState: { /* snapshot at session entry */ },
  windowId,
  startedAt
}
```

`outcome` is `'done'` (participant/moderator pressed Done) or `'session_ended'` (session terminated early from the menu during this task). Timestamps are wall-clock ISO strings plus `performance.now()`-style monotonic offsets so later tooling can compute durations without timezone hazards.

### Lifecycle

1. **Launch** (cold or warm — same rules as v1): validate atomically, snapshot runtime state once, enter Study mode, show the **interstitial for task 1**.
2. **Interstitial**: the content view shows a bundled neutral screen — task counter ("Task 1 of 5"), full instructions at readable size, and a single **Begin** button. No stimulus loads yet. This is app chrome loaded from the packaged app (never a `data:`/remote URL), and it is where the moderator resets site state, checks the participant is ready, or answers questions. The toolbar already shows Study mode with the same counter and instruction.
3. **Begin**: reset Visual Memory, apply the task's resolved runtime state (`snapshot ← session defaults ← task overrides`) through the existing `study:apply-runtime-settings` path, stamp `startedAt`, navigate the content view to `targetUrl`.
4. **Task runs**: identical to v1 Study mode — locked toolbar, compressed origin, read-only ⌘L, in-page navigation allowed and reflected.
5. **Done** (task N of M, N < M): stamp `endedAt`/`finalUrl`/`outcome: 'done'`, advance `taskIndex`, show the interstitial for task N+1. **No runtime restore happens here** — the session is still active.
6. **Done** (task M of M): stamp the final record, write the session summary, and enter `phase: 'complete'` — **still in Study mode**. The completion interstitial ("Session complete — you can hand the machine back to the moderator") shows unfoveated (same rule as other interstitials; restoring the participant's baseline here would re-foveate the completion text), and the toolbar instruction reads "Session complete — press Done to finish." Pressing **Done** on the completion screen performs the deferred restore of `previousRuntimeState` and exits Study mode to Browse.
7. **End Session early**: the existing application-menu escape (**Exit Study Mode**) is relabeled **End Study Session** when `kind === 'session'`. It stamps the current task `outcome: 'session_ended'`, writes the summary with the tasks completed so far, and enters the same completion state as step 6 (Done then restores and exits; the menu escape on the completion screen exits directly). Skipping a single task without ending the session is not supported in this version — the moderator's recourse is Done (recorded as done) or ending the session.

### Link collision rules

- A second valid **session or task link** arriving while a session is active replaces the whole active session (matching v1 replacement semantics). The original pre-session snapshot remains the restore point; the interrupted session's summary is written first with its partial records, so no timing data is silently lost.
- An invalid link changes nothing, as today.
- During launch, latest-valid-link-wins buffering is unchanged.

### Persistence rules

Identical to v1: no task or session setting ever reaches `settingsManager`; quitting mid-session leaves `settings.json` untouched. Quitting mid-session also writes the partial session summary during shutdown if the window is still alive; if the process dies uncleanly, in-memory records are lost (documented limitation — durable journaling is DataCollector territory).

---

## Toolbar

Study mode gains a progress counter in the leading label position:

```text
[Task 2 of 5]  [Instruction text………………………]  [example.com ▾]  [Done]
```

- The counter replaces the static "Task" label when `kind === 'session'`; single-task links keep today's presentation.
- The counter is non-interactive and included in the polite live region announcement when a task changes ("Task 2 of 5: Find the refund policy.").
- Everything else — truncation, expansion, origin toggle, read-only URL, 40px height, focus order — is unchanged from the v1 spec. The counter must not push the instruction area below usable width; at minimum widths the counter compresses to "2/5".

## Interstitial screen

- Bundled with the app (packaged resource, loaded into the content view like other app chrome); never remote, never a `data:` URL, no network access.
- Shows: task counter, full instruction text (rendered with `textContent`), target origin (so the moderator can confirm the right stimulus is next), Begin button.
- Foveated rendering is **disabled on the interstitial** regardless of task settings — instructions are meta-task text, and the participant should read them unimpeded. Task settings apply at Begin. The completion state gets the same exemption: the session's runtime restore is deferred until Done is pressed on the completion screen, so "Session complete" is never rendered foveated.
- Keyboard: Begin is focused by default; Enter activates. The screen is fully readable by assistive technology.
- The interstitial is the designated future mount point for consent (before task 1) and debrief (after task M) — P3-5 should extend this screen rather than adding a separate surface.

## Session summary artifact

On session end (complete, early-ended, replaced, or clean quit), write one JSON file:

```text
<userData>/study-sessions/<session_id or 'session'>-<startedAt compact>-summary.json
```

```json
{
  "schema": "scrutinizer-session-summary/1",
  "sessionId": "nav-study-p04",
  "participantId": "P04",
  "appVersion": "2.9.0",
  "platform": "darwin",
  "startedAt": "2026-07-19T18:04:22.113Z",
  "endedAt": "2026-07-19T18:31:07.902Z",
  "defaults": { "mode": 12, "foveaRadiusPx": 45, "visualMemoryLimit": 5 },
  "tasks": [
    {
      "index": 1,
      "taskId": "find-billing",
      "targetUrl": "https://example.com",
      "finalUrl": "https://example.com/account/billing",
      "startedAt": "…", "endedAt": "…",
      "durationMs": 184220,
      "outcome": "done",
      "settings": { "mode": 12, "foveaRadiusPx": 45, "visualMemoryLimit": 5 }
    }
  ]
}
```

- Local-only, never uploaded, no PII beyond the researcher-supplied IDs (which the docs direct to be anonymous codes).
- `finalUrl` can contain sensitive query strings from the participant's own navigation; the docs must say so, and the file lands in the researcher-controlled app-data directory, not a shared location.
- This is deliberately *not* DataCollector: no samples, no events, no per-fixation data. It exists because time-on-task per task is nearly free here and is the single most-requested quant number in a moderated study. DataCollector (P3-2) will supersede and embed it, keyed by the same `sessionId`/`taskId`.

## Study Link Builder

The hosted builder (`scrutinizer-www/src/study-link-builder.html`) gains a session mode:

- Add/remove/reorder task rows (URL + task ID + instructions + optional per-task overrides), session defaults section, session/participant ID fields.
- Live length meter against the 8192 cap; the builder refuses to emit an over-cap link and says which task to trim.
- Validates with the same parser build the app runs (as today), emits the link and the instruction-sheet HTML snippet.
- One-click "duplicate session with reordered tasks" so a researcher can hand-build counterbalanced orderings (A-B-C, B-C-A, …) until ExperimentRunner automates it. `participant_id` makes each copy distinct.

## Windows

Nothing in the grammar, parser, session state, interstitial, or summary is macOS-specific. Windows delivery reuses the v1 spec's boundary: NSIS protocol registration, `process.argv` cold launch, `second-instance` warm launch. The 8192-char cap is chosen to be safe for Windows `ShellExecute` command-line delivery as well as macOS `open-url`. The summary path uses Electron's `userData`, which resolves correctly on both platforms.

## Security and privacy

All v1 rules apply per task block (scheme/route whitelist, http(s)-only targets, no credentials, strict typing, text-only instructions, no shell/eval/executeJavaScript exposure, no raw-link logging). Additions:

- Log task *count* and session ID on launch, never the task URLs (log per-task origin only, as v1 does for the single target).
- The interstitial renders instruction text with `textContent`; task data never reaches it as HTML.
- The session summary is written with restrictive default permissions and documented as potentially sensitive (final URLs).
- `participant_id` documentation must be explicit: anonymous codes only, consistent with the human-subjects spec's IRB posture.

## Test plan

**Unit — parser** (extend `tests/unit/study-deep-link.test.js`):
- Minimal 2-task link; maximal 8-task link with every field.
- Cap: 8193-char link fails `LINK_TOO_LONG`; 1 task fails `TOO_FEW_TASKS`; 9 fails `TOO_MANY_TASKS`.
- `t1`,`t3` fails `NON_CONTIGUOUS_TASKS`; `t0.url`, `t01.url`, `t1.speed` fail `UNKNOWN_PARAMETER`.
- Missing `t2.url` fails with a message naming task 2; bad `t6.mode` fails atomically with task-6 context.
- Session defaults + per-task override resolution produces the documented layering.
- v1 `task/start` links still parse byte-identically (regression).

**Unit — runtime state**: `buildStudyRuntimeState` layered twice (snapshot ← defaults ← task) matches expected resolution for all override combinations.

**Unit — toolbar contract** (extend `tests/unit/study-toolbar-contract.test.js`): counter text for `kind: 'session'`, static label for `kind: 'task'`, live-region string includes counter + instruction.

**Integration — main**:
- Done on task N<M advances without touching `previousRuntimeState` or `settings.json`; Done on task M restores and exits.
- Visual Memory reset fires at every Begin.
- Early End Session stamps `session_ended` and writes a partial summary.
- Session-link replacement writes the interrupted session's summary before applying the new launch.
- Summary JSON validates against the schema and durations are non-negative and monotonic.

**Packaged verification** (macOS now, Windows when its delivery lands): a real 3-task session link from Safari and Chrome, cold and warm; confirm interstitial → Begin → task → Done cycling, no Browse-toolbar flash at any boundary, `settings.json` byte-identical before/after, summary file present and correct after final Done, after early End Session, and after app quit mid-task.

## Acceptance criteria

- [x] `scrutinizer://v1/session/start` parses 2–8 task blocks with session defaults and per-task overrides; validation is atomic with task-indexed errors.
- [x] Raw links over 8192 chars are rejected before parsing.
- [x] One snapshot at entry, one restore at exit; Done mid-session never restores or persists.
- [x] Interstitial gates every task; foveation off on the interstitial; Visual Memory resets at every Begin.
- [x] Toolbar shows "Task N of M" for sessions and remains 40px with unchanged geometry.
- [x] End Study Session menu escape ends early with a partial summary.
- [x] Session summary JSON is written on every exit path (complete, early, replaced, clean quit) and contains per-task timestamps, durations, outcomes, and final URLs.
- [x] v1 single-task links behave exactly as before (full regression on existing 28 tests).
- [x] Study Link Builder authors, validates, and length-guards session links without code.
- [x] No macOS-specific assumptions in parser, state, or summary paths.

 implementation order

1. Parser route + structural validation + exhaustive unit tests (pure, no Electron).
2. Session state machine in `main.js` (`kind`, `taskIndex`, `taskRecords`) + advance/exit logic + integration tests.
3. Interstitial screen + Begin wiring + Visual Memory reset at boundaries.
4. Toolbar counter + live-region update.
5. Session summary writer + all-exit-paths coverage.
6. Link Builder session mode.
7. Packaged macOS verification; Windows verification rides the Windows delivery milestone.
