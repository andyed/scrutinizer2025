# Usability Study Deep Links and Study Toolbar

> **Status:** Initial macOS implementation complete; signed/notarized browser verification pending
> **Implementation scope:** macOS first
> **Last updated:** 2026-07-16
> **Related:** [Usability-Testing Practitioner Guide](../tutorials/usability-testing-practitioner-guide.md), [Human Subjects Data Collection Platform](human_subjects_data_collection.md), [Phase 3 — Usability-testing foundation](../sprucing/phase-3-usability-foundation.md), [RFV Getting Started](../tutorials/getting-started-rfv.md)

## Summary

Register a `scrutinizer://` URL scheme so a UX researcher can place a task link in an ordinary browser-based instruction sheet. Clicking the link opens Scrutinizer, loads the task page, applies a validated set of temporary simulation settings, and replaces the normal URL-focused toolbar with task instructions and compressed origin visibility.

The first implementation is a **single-task launcher for packaged macOS builds**. It does not create a new experiment schema or data-collection system. Future study manifests will use the task-definition and `ScanpathData` formats already selected by the usability-testing foundation.

Example:

```text
scrutinizer://v1/task/start?url=https%3A%2F%2Fexample.com%2Faccount&task_id=billing-navigation&instructions=Where%20would%20you%20go%20to%20change%20your%20billing%20address%3F&fovea_radius_px=45&mode=12
```

Expected result:

1. macOS launches or activates Scrutinizer.
2. Scrutinizer validates the complete deep link before changing app state.
3. The target page opens with the requested runtime-only settings.
4. The toolbar enters Study mode and shows the task instruction, target origin, and a Done action.
5. Leaving Study mode restores the user's pre-task runtime state. The task does not overwrite saved preferences.

---

## Problem

Scrutinizer can be configured manually for an RFV walkthrough, but that makes a usability-testing session fragile:

- The researcher must reproduce the correct URL, foveal radius, model, and behavioral settings.
- Participants may see or edit browser controls instead of focusing on the task.
- The task instruction lives outside Scrutinizer and can be lost after the task page opens.
- Manual configuration makes sessions harder to reproduce across participants.

A study link makes the task definition portable while keeping the stimulus inside the installed, calibrated Scrutinizer app.

Strategically, this turns RFV from a reviewer-controlled visualization into a repeatable usability-testing intervention. Its scientifically motivated peripheral rendering is intended to approximate the information available to eye-movement planning outside fixation. The active loop is: modeled peripheral view → target selection → pointer movement as an emulated gaze shift → new foveal information and Visual Memory → next target selection. Detailed visual access is bound to the participant's pointer, so each movement reveals which region they choose to bring into functional focus. The participant and moderator share the same stimulus: the moderator can see what information was available before a move, what the participant revealed next, and where peripheral cues failed to guide the task. This is not a claim that pointer coordinates are physiological gaze; it is a controlled emulation of task-relevant visual access and fixation change.

## Goals

### macOS v1

- Open Scrutinizer from a link in Safari, Chrome, or another macOS browser.
- Support both cold launch and an already-running app.
- Load one HTTP(S) task URL.
- Apply a small, explicit set of validated settings for that task.
- Keep task settings in memory only; never persist them as user defaults.
- Put task instructions in the existing toolbar without changing its 40px height.
- Keep the target origin visible in compressed form.
- Let the user reveal the full URL without making it editable during the task.
- Provide a clear way to end the task and return to normal browsing.
- Fail closed on malformed or unsupported links.
- Preserve an extensible route for future study manifests and fixation-memory tasks.

### Future, not macOS v1

- Multi-task study sequencing.
- Consent, participant IDs, counterbalancing, and debrief flows.
- Behavioral or gaze data collection and export.
- Free-scan, timed, guided-fixation, replayed-scanpath, or preseeded-memory exposure phases.
- Question presentation and first-click response capture.
- Remote study configuration loading.
- Windows protocol delivery and installer verification.
- Linux protocol delivery.

## Non-goals

- Replacing `docs/specs/human_subjects_data_collection.md` with a second experiment schema.
- Claiming that mouse position is measured eye gaze.
- Allowing arbitrary renderer configuration through query parameters.
- Persisting task-provided settings.
- Supporting scripts, local files, `data:` URLs, or non-web target schemes.
- Hiding the destination origin completely.
- Building a general-purpose browser protocol or privileged command channel.

---

## Users and primary use cases

### UX researcher

Creates an instruction sheet containing links such as “Start task 1 in Scrutinizer.” Each link reproduces the intended page and simulation condition without asking the participant to configure the app.

### Participant

Clicks a link, approves the browser's external-app prompt if shown, and works in a task-focused Scrutinizer window. The task instruction remains visible while the full URL and simulation controls do not compete for attention.

### Design reviewer

Uses a task link to share a reproducible RFV observation with a colleague, without running a formal participant study.

---

## Terminology

- **Deep link:** A URL beginning with `scrutinizer://` that macOS routes to the installed app.
- **Task link:** The v1 deep-link route that opens a single target page and applies temporary settings.
- **Study mode:** A window state in which the toolbar presents task information and task-changing controls are locked.
- **Browse mode:** Scrutinizer's existing browser state with navigation, editable URL access, and simulation controls.
- **Study manifest:** A future task-definition document loaded through a reserved deep-link route. It must extend the existing human-subjects task definition rather than introduce an unrelated schema.
- **Fixation-memory set:** A list of remembered locations used by Scrutinizer's Visual Memory mask. It may be participant-generated, guided, replayed, or preseeded in a future study phase.

---

## Deep-link contract

### Scheme and routes

Registered scheme:

```text
scrutinizer
```

Implemented route:

```text
scrutinizer://v1/task/start
```

Reserved, not implemented in v1:

```text
scrutinizer://v1/study/run?config=<encoded-https-url>
```

The authority is the protocol version (`v1`); the pathname identifies the operation. A new incompatible contract uses a new authority such as `v2`. Existing v1 semantics must not change silently.

### Task-start parameters

| Parameter | Required | Type | Validation | Meaning |
|---|---:|---|---|---|
| `url` | Yes | Encoded URL | Absolute `http:` or `https:` URL; maximum 4096 characters after decoding | Page to load in the Scrutinizer content view |
| `task_id` | No | String | 1–128 characters; letters, digits, `.`, `_`, and `-` only | Stable researcher-provided task identifier |
| `instructions` | No | Plain text | Maximum 500 Unicode characters; rendered with `textContent`, never HTML | Instruction shown in the Study toolbar |
| `fovea_radius_px` | No | Integer | Must be one of the current `RADIUS_OPTIONS` values | Runtime foveal radius |
| `mode` | No | Integer | Must match an ID in `shared/modes.json` | Runtime aesthetic/model mode |
| `enabled` | No | Boolean | `true` or `false` only | Whether foveated rendering is enabled |
| `comfort_mode` | No | Boolean | `true` or `false` only | Runtime Comfort Mode state |
| `visual_memory_limit` | No | Integer | One of `0`, `5`, `10`, `-1`, or `20` | Runtime Visual Memory mode |

Defaults come from the user's current runtime state. The deep link overrides only parameters it explicitly supplies.

### Parameter rules

- Parameter names are case-sensitive.
- Duplicate parameters are invalid.
- Unknown parameters are invalid in v1. This catches misspelled study settings instead of silently running the wrong condition.
- Values are decoded exactly once by the standard `URL`/`URLSearchParams` implementation.
- `+` in a query value follows standard form-query behavior and becomes a space; literal plus signs must be percent-encoded.
- Instructions are plain text. Markup, links, and script execution are not supported.
- The parser returns a new normalized object and does not mutate application state.
- The complete link is validated before any navigation or settings change occurs.

### Example links

Minimal:

```text
scrutinizer://v1/task/start?url=https%3A%2F%2Fexample.com
```

Task-focused:

```text
scrutinizer://v1/task/start?url=https%3A%2F%2Fexample.com%2Faccount&task_id=billing-navigation&instructions=Where%20would%20you%20go%20to%20change%20your%20billing%20address%3F&fovea_radius_px=45&mode=12&visual_memory_limit=5
```

Instruction-sheet HTML:

```html
<a href="scrutinizer://v1/task/start?url=https%3A%2F%2Fexample.com%2Faccount&amp;task_id=billing-navigation&amp;instructions=Where%20would%20you%20go%20to%20change%20your%20billing%20address%3F&amp;fovea_radius_px=45&amp;mode=12">
  Start the billing-navigation task in Scrutinizer
</a>
```

Authoring tools should generate these links; researchers should not be expected to percent-encode them manually.

---

## Study-mode toolbar

### Rationale

The existing toolbar reserves its flexible center region for the URL. During a task, the instruction is more important than the full location, but completely hiding the destination would remove useful origin and trust context. Study mode therefore replaces the editable URL presentation with instructions while retaining a compact origin control.

The toolbar remains exactly 40px high. HUD placement, content bounds, capture geometry, and fixation coordinates currently depend on that height.

### Browse mode

Existing behavior remains unchanged:

```text
[Back] [Forward] [Reload]  [Full URL]  [Fovea toggle]
```

### Study mode

Default presentation:

```text
[Task]  [Instruction text………………………………]  [example.com ▾]  [Done]
```

Requirements:

- `Task` is a non-interactive status label. If `task_id` is absent, use “Study task.”
- Instructions occupy the flexible center space and truncate with an ellipsis.
- Hovering or focusing the instruction exposes the complete text through an accessible label/title.
- Activating the instruction may toggle an expanded, read-only instruction presentation, but must not resize the 40px toolbar or alter the content/HUD coordinate frame.
- The origin control displays `URL.origin` without path, query, credentials, or fragment.
- Activating the origin control toggles the center presentation between task instructions and the full, read-only target URL. Activating it again restores instructions.
- URL updates caused by in-page navigation update the stored full URL and compressed origin, but do not replace the task instructions.
- `Done` exits Study mode, restores the pre-task runtime state, and returns the toolbar to Browse mode. It does not navigate away from the current page.

### Locked controls

While Study mode is active:

- Back, Forward, and Reload are hidden or disabled.
- Clicking the origin never opens the editable URL dialog.
- `Command+L` reveals the read-only full URL instead of opening URL editing.
- The toolbar fovea toggle is hidden or disabled.
- Menu actions that change a task-controlled setting are disabled or require leaving Study mode first.
- Page content remains interactive; target-page navigation is allowed and is reflected in the compressed origin/full-URL view.

The researcher escape path is the Done action plus an application-menu **Exit Study Mode** command. Exiting must be deliberate and must not be triggered by ordinary page navigation.

### Accessibility

- Toolbar controls have explicit accessible names independent of iconography.
- Instruction changes use a polite live region so assistive technology announces the active task once.
- Truncated instructions remain keyboard-focusable and expose their full text.
- Origin and full-URL states are distinguishable without color.
- Focus order is instruction, origin/full URL, Done; hidden Browse controls are removed from the tab order.
- The task instruction is outside the foveated content surface and remains readable.

---

## Runtime state and persistence

### Study session state

For macOS v1, one app-wide task may be active at a time. Store an in-memory object equivalent to:

```js
{
  deepLink: { version, route },
  task: { id, instructions, targetUrl },
  overrides: {
    foveaRadiusPx,
    mode,
    enabled,
    comfortMode,
    visualMemoryLimit
  },
  previousRuntimeState: { /* same setting fields */ },
  windowId,
  startedAt
}
```

This is runtime state, not the future on-disk experiment/session record.

### Persistence rules

- Deep-link overrides must not call `settingsManager.set`.
- Entering Study mode snapshots the current runtime values.
- Exiting Study mode restores that snapshot through runtime IPC only.
- Quitting during Study mode leaves persisted settings unchanged.
- A second valid task link replaces the active task in the same primary window. Restore the original pre-study snapshot only when finally exiting, rather than treating the current task's overrides as the new baseline.
- A second invalid task link leaves the active task untouched.
- Visual Memory is reset when entering a new task so history from another page cannot leak into the condition.

### Window behavior

- A cold-launch task opens in the primary Scrutinizer window.
- A task received while Scrutinizer is running uses the primary window, restores it if minimized, brings it to the front, and focuses it.
- A task received while the app has no open window creates a new primary window.
- v1 does not create one window per task.
- Scrutinizer's manual **New Window** feature remains available outside Study mode.

---

## macOS application lifecycle

### Packaging registration

Add an electron-builder protocol entry to `package.json`:

```json
{
  "build": {
    "protocols": [
      {
        "name": "Scrutinizer Study Link",
        "schemes": ["scrutinizer"],
        "role": "Viewer"
      }
    ]
  }
}
```

This generates the relevant `CFBundleURLTypes` entry in the packaged app's `Info.plist`. Registration must be verified against the signed/notarized `.app`, not only a development launch.

After readiness, the packaged app calls `app.setAsDefaultProtocolClient('scrutinizer')` and logs a warning if registration returns false. This call is skipped when `app.isPackaged` is false. macOS can only register schemes already present in `Info.plist`; development registration is not an acceptable substitute for packaged verification.

References:

- [Electron deep links](https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app)
- [Electron `app` protocol-client API](https://www.electronjs.org/docs/latest/api/app#setasdefaultprotocolclientprotocol-path-args)
- [electron-builder protocol configuration](https://www.electron.build/docs/api/electron-builder.interface.protocol/)

### Event registration

Register the listener at module initialization, before `app.whenReady()`:

```js
app.on('open-url', (event, url) => {
  event.preventDefault();
  receiveStudyDeepLink(url);
});
```

The event can arrive before window creation. `receiveStudyDeepLink` therefore:

1. Parses and validates the link synchronously with the pure parser.
2. On failure, stores no pending task and schedules a safe error presentation after readiness.
3. If the app/window is not ready, stores the latest valid pending launch.
4. If ready, applies the launch immediately.

Use latest-valid-link-wins while starting. This avoids opening duplicate tasks when a participant clicks the same browser link more than once during launch.

### Cold launch

For a pending valid task:

1. Initialize `settingsManager` and snapshot persisted/current runtime defaults.
2. Apply overrides to an in-memory initial-state object, not to `settingsManager`.
3. Create the primary window with the task target URL.
4. Initialize the HUD with the overridden runtime state.
5. Initialize the toolbar directly in Study mode.
6. Do not show the welcome popup over the task.
7. Show the window only after the content, HUD, and Study toolbar have received their initial state, avoiding a flash of the saved start page or Browse toolbar.

### Warm launch

For an already-running app:

1. Parse and validate the entire link.
2. Snapshot runtime state if this is the first active task.
3. Reset Visual Memory.
4. Apply runtime settings through a new runtime-only overlay IPC that suppresses persistence.
5. Navigate the primary content view to the target URL.
6. Switch/update the toolbar to Study mode.
7. Restore, show, and focus the primary window.

Applying the toolbar and settings before or in the same turn as navigation prevents the old task instruction or editable URL from appearing with the new stimulus.

### App activation

The existing macOS `activate` handler must not discard an active or pending study. If the user closes the window without ending the task and later clicks the Dock icon, recreate the task window from in-memory state. If the app process was quit, no task state is restored.

---

## Proposed code changes

### New pure parser

Create:

```text
shared/study-deep-link.js
```

Exports:

```js
parseStudyDeepLink(rawUrl, { radiusOptions, modeIds })
```

Return a discriminated result rather than throwing across the app lifecycle boundary:

```js
{ ok: true, value: normalizedLaunch }
{ ok: false, error: { code, message } }
```

Suggested error codes:

- `INVALID_URL`
- `UNSUPPORTED_SCHEME`
- `UNSUPPORTED_VERSION`
- `UNSUPPORTED_ROUTE`
- `MISSING_TARGET_URL`
- `UNSAFE_TARGET_URL`
- `DUPLICATE_PARAMETER`
- `UNKNOWN_PARAMETER`
- `INVALID_PARAMETER`

### Main process

Modify `main.js` to add:

- Early `open-url` listener.
- Pending-link and active-study state.
- `receiveStudyDeepLink(rawUrl)`.
- `applyStudyLaunch(normalizedLaunch)`.
- `exitStudyMode()`.
- A runtime-only settings application path that does not persist.
- Guards around URL editing, navigation, reload, and task-controlled menu settings.
- Toolbar messages for entering/updating/exiting Study mode.
- Read-only `Command+L` behavior during Study mode.

Avoid routing task overrides through existing `settings:*changed` handlers because those handlers write to `settings.json`.

### Overlay runtime-control path

Modify:

```text
renderer/overlay.js
renderer/scrutinizer.js
```

Add a dedicated `study:apply-runtime-settings` IPC handler for the whitelisted study settings plus a `study:reset-visual-memory` command. Existing menu paths are not safe to reuse unchanged: Visual Memory and Comfort Mode currently notify the main process to persist their values, and enable/radius controls also have persistent user-setting paths.

The dedicated handler calls renderer methods with settings-notification suppression. Add an explicit `{ notifySettings: false }` option where a method currently emits `settings:*changed`; ordinary UI actions retain `{ notifySettings: true }` as their default. Directly updating foveal radius, model mode, and Visual Memory through their non-notifying renderer methods is permitted.

The study handler accepts only the already-normalized field set from the main process. Loaded page content must not be able to invoke it, and it must not forward `settings:*changed` events back to the main process.

### Toolbar renderer

Modify:

```text
renderer/toolbar.html
renderer/toolbar.css
renderer/toolbar.js
```

Add a simple view state:

```js
{ mode: 'browse' }
{ mode: 'study', instructions, taskId, currentUrl, showingUrl }
```

Proposed IPC:

```text
toolbar:enter-study
toolbar:update-study-url
toolbar:show-study-url
toolbar:exit-study
toolbar:study-done
```

`toolbar:update-url` continues to drive Browse mode. In Study mode it updates the stored task URL/origin without replacing instruction text.

### Packaging

Modify `package.json` to register the protocol. No entitlement change is expected for a custom URL scheme, but the signed and notarized artifacts must be verified.

### Tests

Add:

```text
tests/unit/study-deep-link.test.js
tests/unit/release-protocol-registration.test.js
```

Keep parsing and validation independent of Electron so it can run in the normal unit suite.

---

## Error behavior

An invalid link must never partially apply.

If Scrutinizer is closed:

- Launch the app into its normal Browse mode.
- Present a native, non-technical error: “Scrutinizer couldn't open this study task.”
- Include a concise reason such as “The task page must use http or https.”
- Do not display the raw full deep link in the error dialog.

If a study is already active:

- Keep the current task, page, and settings unchanged.
- Present the same safe error.

Unsupported reserved routes, including `study/run` in v1, must say that the installed Scrutinizer version does not yet support that study link.

Navigation failures after a valid launch are page-load failures, not parse failures. Keep Study mode and its instruction visible, show the normal load failure, and let the researcher exit the task.

---

## Security and privacy

Custom protocol links are untrusted external input.

- Permit only the exact `scrutinizer:` scheme, supported authority, and supported route.
- Permit only absolute HTTP(S) target URLs.
- Reject username/password URL credentials.
- Reject duplicate and unknown top-level parameters.
- Parse numeric and Boolean fields strictly; do not use truthiness or `parseInt` on partial strings.
- Render instructions as text, never HTML.
- Do not pass deep-link values to a shell, `eval`, `executeJavaScript`, file path, or command line.
- Do not expose a generic IPC method that accepts arbitrary settings objects from loaded web content.
- Do not persist the raw deep link.
- Avoid logging the complete deep link because its encoded target URL may contain sensitive query values. Log the route, task ID, and target origin only.
- Researchers should not put secrets, participant names, session tokens, or credentials in instruction-sheet links.
- The toolbar must retain compressed origin visibility so the participant can identify the site being used.

The OS or browser may ask the participant to confirm opening Scrutinizer. The instruction sheet should set that expectation and provide an adjacent installer/help link.

---

## Future fixation-memory and question flow

The v1 launcher deliberately leaves room for the observation discussed in the RFV guide: after a small number of fixations, ask what the user knows and where they would go next.

A future study task may define this state sequence:

```text
Instructions
  → exposure
  → freeze fixation-memory set
  → present question
  → collect first click or verbal response
  → save task result
```

Supported future exposure sources may include:

- `free_scan`: participant-generated fixations until a count or time limit.
- `guided_fixations`: researcher-prescribed points or DOM anchors.
- `replay_scanpath`: an existing `ScanpathData` sequence.
- `preseeded_memory`: a fixed memory set for a reproducible expert walkthrough.

Do not encode fixation arrays in the deep-link query. They are too large, coordinate-sensitive, and difficult to audit. The reserved `study/run?config=<https-url>` route should load a task definition that uses existing `ScanpathData` and the documented coordinate conventions.

Any preseeded location format must prefer normalized/page-space coordinates or existing DOM-anchor semantics over raw screen pixels. Raw pixels are not reproducible across viewport sizes, display scale factors, and responsive layouts.

This future flow depends on the ExperimentRunner and DataCollector work in Phase 3. It is not part of the macOS v1 acceptance criteria.

---

## Windows compatibility boundary

The link grammar and parser are platform-independent and must not encode macOS-specific assumptions. A future Windows implementation will reuse them.

Windows delivery differs:

- The NSIS installer registers the protocol association.
- Cold launches receive the link through `process.argv`.
- Warm launches use `requestSingleInstanceLock()` and the `second-instance` event.
- The installed NSIS build is the supported protocol owner; the ZIP build remains portable and is not expected to register reliably.

No Windows delivery code or release claim is included in the macOS v1 milestone.

---

## Test plan

### Unit: parser

- Minimal valid link.
- Every supported optional field.
- Unicode and punctuation in instructions.
- Nested target query parameters and fragments survive exactly.
- Missing target URL.
- Relative target URL.
- `file:`, `javascript:`, `data:`, and custom target schemes.
- Target credentials.
- Unsupported protocol version and route.
- Unknown parameter.
- Duplicate parameter.
- Empty, partial, floating-point, overflow, and out-of-range numeric values.
- Invalid Boolean spellings such as `1`, `yes`, and mixed case.
- Invalid mode ID and foveal radius.
- Over-length target, task ID, and instructions.

### Unit: packaging contract

- `package.json` contains exactly one `scrutinizer` scheme registration.
- Protocol role is `Viewer`.
- Scheme and parser constant cannot drift.

### Integration: main/toolbar state

- Valid launch enters Study mode and loads the normalized URL.
- Settings are applied without calling persistent settings setters or emitting renderer `settings:*changed` notifications.
- Invalid launch changes nothing.
- `toolbar:update-url` updates origin but retains instructions in Study mode.
- Command+L is read-only in Study mode.
- Done restores Browse mode and the pre-task runtime state.
- Starting task B while task A is active preserves the original pre-study restore point.
- Visual Memory resets between tasks.

### Packaged macOS verification

Run against the installed signed/notarized app, not only `npm start`:

1. Inspect the built app's `Info.plist` for the `scrutinizer` URL scheme.
2. Install/move Scrutinizer to `/Applications` and launch it once.
3. With Scrutinizer quit, open a task link from Safari.
4. Repeat from Chrome.
5. With Scrutinizer already running, open a second task link.
6. Repeat while the window is minimized and while all windows are closed but the app remains running.
7. Confirm the existing/primary window is restored and focused.
8. Confirm no saved start page or Browse toolbar flashes on cold launch.
9. Confirm the instruction stays visible through same-origin and cross-origin page navigation.
10. Confirm the origin control shows the actual current origin and can reveal the read-only full URL.
11. Confirm invalid links do not navigate or change settings.
12. Compare `settings.json` before and after task entry, replacement, exit, and app quit; it must be unchanged by task overrides.
13. Confirm the browser's external-app confirmation is understandable with the proposed instruction-sheet wording.

---

## Acceptance criteria: macOS v1

- [ ] The packaged app registers `scrutinizer://` with macOS.
- [ ] A valid task link works when the app is closed.
- [ ] A valid task link works when the app is already running, minimized, or has no open windows.
- [ ] Only supported HTTP(S) targets and whitelisted parameters are accepted.
- [ ] Validation is atomic: invalid links do not partially navigate or apply settings.
- [ ] Task settings are runtime-only and do not change `settings.json`.
- [ ] The task opens in the primary window without a saved-page or Browse-toolbar flash.
- [ ] Study mode shows task instructions, compressed current origin, read-only full URL access, and Done.
- [ ] Toolbar height remains 40px and content/HUD geometry is unchanged.
- [ ] Browse navigation, URL editing, and task-controlled simulation changes are locked during Study mode.
- [ ] Done restores the pre-task runtime state and normal toolbar.
- [ ] Visual Memory resets between task links.
- [ ] Parser, packaging-contract, and Study-toolbar state tests pass.
- [ ] Signed/notarized packaged verification passes in Safari and Chrome.

---

## Suggested implementation order

1. Add the pure parser and exhaustive unit tests.
2. Add packaging registration and packaging-contract test.
3. Add early macOS `open-url` capture plus pending-launch state.
4. Add runtime-only study state and cold/warm launch application.
5. Add toolbar Study mode and control guards.
6. Add state restoration and invalid-link error behavior.
7. Run unit/integration tests.
8. Build, install, and verify the signed/notarized macOS artifact with Safari and Chrome.

The implementation is complete only after packaged verification; a development-mode parser demonstration is not sufficient evidence that macOS protocol registration works.
