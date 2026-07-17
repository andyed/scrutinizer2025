# Scrutinizer v2.8.1 — Study Links for Usability Testing

**Status:** Draft
**Release date:** TBD
**Previous:** [v2.8.0](release_notes_v2.8.0.md)

Scrutinizer 2.8.1 turns Restricted Focus Viewing into a reproducible usability-testing workflow. RFV's scientifically motivated peripheral rendering aims to approximate the visual evidence used to plan the next eye movement; moving the pointer then emulates the change in fixation. This controls where detailed visual information is available and requires participants to reveal their functional focus as they work. Researchers can place a Study Link in an ordinary browser instruction sheet; clicking it opens the installed Scrutinizer app at the intended page with a temporary simulation condition and persistent task instructions.

## Highlights

### Launch a prepared task from the browser

Packaged builds register the versioned `scrutinizer://v1/task/start` route. A link can specify:

- The HTTP(S) page to open
- A stable task ID and plain-text instruction
- Foveal radius and rendering mode
- Whether the effect and Comfort Mode begin enabled
- The Visual Memory condition

The complete link is validated before Scrutinizer changes navigation or settings. Unsupported destinations, unknown parameters, duplicate parameters, and invalid setting values are rejected.

### A task-focused Study toolbar

During a launched task, Scrutinizer replaces its normal browsing controls with:

- The task instruction
- A compact destination origin
- A read-only full-URL toggle
- A clear **Done** action

Navigation and simulation-changing controls are locked while the task is active. Choosing Done returns the window to normal browsing and restores the runtime state that existed before the task. Study-provided values are never saved as the user's preferences.

### Practitioner documentation

The new [Usability-Testing Practitioner Guide](tutorials/usability-testing-practitioner-guide.md) covers:

- Choosing and documenting a study condition
- Writing neutral tasks
- Generating Study Links for browser instruction sheets
- Preparing participants for the external-app handoff
- Moderating without coaching pointer movement
- Recording outcomes with a reusable observation worksheet
- Interpreting pointer movement as revealed functional focus while keeping physiological gaze as a distinct measurement
- Reporting the build, display, calibration, and simulation settings needed for comparison

The existing [RFV Getting Started guide](tutorials/getting-started-rfv.md) has also been clarified around the method's central value: participant and researcher see the same modeled foveal-plus-peripheral stimulus; that peripheral view helps plan the next move; and movement of the clear region emulates a fixation change while revealing where the participant chooses to acquire detailed information. Eye tracking remains a separate measurement of exact eye position.

## Example

```text
scrutinizer://v1/task/start?url=https%3A%2F%2Fexample.com%2Faccount&task_id=billing-address&instructions=You%20have%20moved.%20Change%20the%20billing%20address%20on%20your%20account.&fovea_radius_px=45&mode=12&enabled=true&comfort_mode=false&visual_memory_limit=5
```

The complete parameter contract and security rules are documented in [Usability Study Deep Links and Study Toolbar](specs/usability-study-deep-links.md).

## Platform status

### macOS

The implementation handles both a cold launch and a Study Link sent to an already-running app. The packaged application metadata registers Scrutinizer as a viewer for the custom URL scheme.

Release verification still requires the signed and notarized build to be installed and tested from Safari and Chrome before publication.

### Windows

Study Links are **macOS-only in 2.8.1**. Windows NSIS and ZIP packaging are configured and the installer will register the URL scheme, but the app does not yet implement Windows deep-link delivery (no single-instance lock, no `second-instance` handler, no command-line URL parsing), so a clicked Study Link would never reach a running app. Windows support is tracked as follow-up work, not a pending verification.

## Post-audit hardening (2026-07-16)

A same-day audit of the Study Link work produced these fixes, included in 2.8.1:

- **Study toolbar contrast brought to the project's 8:1 floor.** The Done button was white-on-accent at 3.98:1 (below WCAG AA); it is now dark-on-light-blue at 11.18:1, which also makes the participant's exit control the most salient element on the toolbar. The destination-origin button (the participant's site-identity signal) moved from 7.01:1 to 8.49:1, and the browse-mode URL display from 4.43:1 to 8.52:1, with hover/active states verified.
- **Exit Study Mode menu command** (File menu, study mode only) — the spec-required researcher escape path when the study toolbar itself is unusable.
- **Deep-link launch race fixed:** a valid link arriving after app-ready but before the window existed was silently dropped; it now creates the study window. Window re-activation also consumes a buffered link instead of a stale study.
- **Error-dialog echo capped:** unknown parameter names (attacker-controlled) are truncated to 64 characters before display.

## Release checks still open

- Install the signed and notarized macOS build and test Safari and Chrome handoff
- Verify macOS cold launch, warm launch, Done restoration, and malformed-link rejection
- Resolve the repository's missing `v2.8.0` tag before the version/tag release guard can pass
- Bump `package.json` to 2.8.1 only when the release candidate is ready to tag
