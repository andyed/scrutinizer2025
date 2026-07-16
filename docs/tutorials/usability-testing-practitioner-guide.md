# Usability-Testing Practitioner Guide

This guide explains how to use Scrutinizer's **Restricted Focus Viewer** (RFV) in a moderated usability session. It focuses on reproducible task setup, observation practice, and appropriately cautious interpretation.

For basic installation, controls, calibration, Visual Memory, and Comfort Mode, begin with [Getting Started: Restricted Focus Viewer](getting-started-rfv.md). For the deep-link implementation contract, see [Usability Study Deep Links and Study Toolbar](../specs/usability-study-deep-links.md).

## What this method is for

Scrutinizer is useful when a research question concerns what remains visually available away from a selected viewing location:

- Does the interface provide a noticeable next target?
- Does an important control disappear into nearby clutter?
- Does a task depend on reading labels that are not near the current location?
- Does color, spacing, size, or grouping make a region distinguishable before it is directly inspected?
- How easily can a participant recover after choosing the wrong region?

Scrutinizer is not eye tracking. In the standard setup, the mouse cursor controls the clear region; it does not measure the participant's gaze. Results are observations made under a consistent visual constraint, not a literal record of what the participant saw.

Use RFV findings as evidence about interaction behavior and as hypotheses about peripheral discoverability. Combine them with participant comments, task outcomes, and—when the research question requires it—eye-tracking or other measures.

## Choose a session format

### Participant-controlled task

The participant moves the pointer and completes a realistic task while the moderator observes. This is the primary usability-testing format. It reveals how someone explores and acts under the RFV constraint, but pointer location must not be relabeled as gaze.

### Moderator-controlled walkthrough

The moderator moves through selected viewing locations while a participant or stakeholder describes what is available. This is useful for design critique and tightly controlled comparisons, but it is not a natural participant scanpath.

### Fixation-memory question

A future workflow may expose a participant to a defined set of locations, preserve those regions in Visual Memory, and then ask, “After seeing this, where would you go to do X?” Version 2.8.1 does not yet launch pre-seeded fixation-memory sets or capture the answer automatically. You can explore the idea manually, but label it as a facilitated prototype procedure.

## Prepare the study condition

Choose the condition before recruiting or comparing participants. Record it with the study plan.

| Setting | Decision to record | Practical guidance |
|---|---|---|
| Rendering mode | Mode ID | Use one mode across a comparison. Mode 12 is the current default unless the study is evaluating another model. |
| Foveal radius | Pixel radius and calibration method | Calibrate when visual angle matters. Otherwise document the chosen radius and keep display setup stable. |
| Comfort Mode | On or off | Off is stricter; on provides a larger low-distortion working region. Do not switch it mid-condition. |
| Visual Memory | Off, 5, 10, Infinite, or IOR | Off isolates the current location. Limited memory supports sequential exploration. Choose based on the question. |
| Effect state | On or off | A Study Link can explicitly enable the effect. Confirm it before the participant begins. |
| Display setup | Device, scaling, resolution, viewing distance | These affect the pixel-to-degree relationship and should be stable when comparing sessions. |

Run a pilot on the exact machine and build that participants will use. Check the target page, authentication state, consent flow, browser handoff, task wording, and Done behavior.

## Write neutral tasks

Task instructions should describe a goal without naming or visually describing its solution.

Prefer:

> You have moved. Change the billing address on your account.

Avoid:

> Use the Account menu in the upper-right corner to find Billing and change your address.

For a first-destination question, use wording such as:

> After looking over this page, where would you go first to change your billing address?

Keep the instruction short enough to remain readable in the Study toolbar. The current limit is 500 Unicode characters.

## Create a Study Link

A Study Link opens a packaged Scrutinizer build, loads one HTTP(S) page, applies temporary settings, and replaces normal browsing controls with the task instruction. Clicking **Done** restores the participant's previous runtime settings.

Minimal link:

```text
scrutinizer://v1/task/start?url=https%3A%2F%2Fexample.com
```

Reproducible task example:

```text
scrutinizer://v1/task/start?url=https%3A%2F%2Fexample.com%2Faccount&task_id=billing-address&instructions=You%20have%20moved.%20Change%20the%20billing%20address%20on%20your%20account.&fovea_radius_px=45&mode=12&enabled=true&comfort_mode=false&visual_memory_limit=5
```

Supported settings:

| Parameter | Example | Meaning |
|---|---|---|
| `url` | encoded `https://example.com/account` | Required task page; HTTP or HTTPS only |
| `task_id` | `billing-address` | Optional stable identifier using letters, digits, `.`, `_`, or `-` |
| `instructions` | encoded plain text | Optional toolbar instruction |
| `fovea_radius_px` | `45` | One of Scrutinizer's supported radius presets |
| `mode` | `12` | A valid Scrutinizer mode ID |
| `enabled` | `true` | Whether the effect begins enabled |
| `comfort_mode` | `false` | Whether Comfort Mode begins enabled |
| `visual_memory_limit` | `0`, `5`, `10`, `-1`, or `20` | Off, Limited, Extended, Infinite, or IOR |

Query values containing URLs, spaces, punctuation, or other reserved characters must be percent-encoded. To avoid hand-encoding, an instruction-sheet author can generate the complete link with `URLSearchParams` in browser JavaScript:

```html
<a id="start-task" href="#">Start task in Scrutinizer</a>
<script>
  const task = new URL('scrutinizer://v1/task/start');
  task.searchParams.set('url', 'https://example.com/account');
  task.searchParams.set('task_id', 'billing-address');
  task.searchParams.set('instructions',
    'You have moved. Change the billing address on your account.');
  task.searchParams.set('fovea_radius_px', '45');
  task.searchParams.set('mode', '12');
  task.searchParams.set('enabled', 'true');
  task.searchParams.set('comfort_mode', 'false');
  task.searchParams.set('visual_memory_limit', '5');
  document.querySelector('#start-task').href = task.toString();
</script>
```

Scrutinizer rejects unknown, duplicate, or invalid parameters rather than silently running a different condition.

## Prepare the participant instruction sheet

Tell participants what will happen before they click:

1. The browser may ask permission to open Scrutinizer. Choose **Open Scrutinizer**.
2. The task page will open in Study mode with the instruction at the top.
3. The clear region follows the pointer. This changes what is visually available around it.
4. Work as naturally as possible and think aloud only if that is part of the study protocol.
5. Select **Done** after completing the task or when the moderator asks you to stop.

Do not tell participants that the cursor is tracking their eyes. If pointer movement itself is under study, state exactly what will be observed and obtain any consent required by the research plan.

## Run the session

Before each task:

1. Reset the site to the intended starting state.
2. Confirm the participant is using the planned display setup.
3. Open the task from its Study Link rather than configuring Scrutinizer manually.
4. Confirm the task instruction, destination origin, and effect state.
5. Ask the participant to begin.

During the task:

- Do not coach pointer placement or name the intended target.
- Note the participant's first destination and the evidence they say they are using.
- Record hesitation, repeated exploration, reversals, missed controls, and recovery.
- Distinguish between “not noticed,” “noticed but misunderstood,” and “noticed but rejected.”
- Record page errors, loading delays, authentication problems, or unexpected animation separately from design observations.
- If the participant becomes uncomfortable, stop the condition. Do not prioritize protocol consistency over participant comfort.

After the task:

1. Record completion, abandonment, or moderator termination.
2. Ask a neutral retrospective question such as, “What were you looking for when you moved there?”
3. Select **Done** before starting another task.
4. Use a fresh Study Link for the next condition.

## Observation worksheet

Use one row per task. Add timestamps or recordings only when they are covered by the study's consent and data-handling plan.

| Field | Notes |
|---|---|
| Participant/session ID | Use the study's approved identifier; avoid unnecessary personal data |
| Scrutinizer version | Record the exact packaged build, for example 2.8.1 |
| Task ID | Match the Study Link's `task_id` |
| Target URL/origin | Record the intended stimulus and environment |
| Condition | Mode, radius, Comfort Mode, Visual Memory, display setup |
| Outcome | Completed, abandoned, timed out, or interrupted |
| First destination | What the participant selected or inspected first |
| Hesitations and reversals | Where exploration slowed or changed direction |
| Missed or confused regions | Separate visibility, comprehension, and choice problems |
| Recovery | How the participant found a new path |
| Participant explanation | Brief verbatim note or careful paraphrase |
| Moderator interventions | Record any prompt that could affect behavior |
| Technical incidents | Loading, authentication, rendering, protocol, or display issues |

## Interpret findings carefully

Appropriate conclusions include:

- “Under the 45px, Mode 12, Visual Memory 5 condition, four of six participants explored the content column before finding the account navigation.”
- “The billing destination was often noticed only after participants moved near the global navigation.”
- “Increasing separation between the two controls is a design hypothesis for the next iteration.”

Avoid conclusions such as:

- “Participants never looked at the navigation.” Pointer location is not measured gaze.
- “This is exactly what peripheral vision looks like.” Scrutinizer is a parameterized model.
- “The interface fails for all users.” Findings apply to the participants, tasks, build, and condition studied.
- “Five retained cursor locations equal five human fixations.” Visual Memory is an operational simulation setting.

Compare behavior within the same documented condition. If settings, display geometry, content, or build version change, treat that as a different condition.

## Troubleshooting

### macOS

- Use an installed, packaged Scrutinizer application. Development launches do not provide a reliable browser protocol registration test.
- The first click may produce an external-application confirmation in the browser.
- If a link opens the wrong copy of Scrutinizer, remove or rename older installed copies and reopen the current packaged build.
- A malformed link is rejected without partially changing the current task condition.

### Windows

Windows packaging is configured, but the 2.8.1 Study Link installation and browser-handoff procedure is awaiting platform verification. Do not publish Windows participant instructions until the installer registers `scrutinizer://`, cold and warm launches pass, and uninstall behavior has been checked.

### During a session

- If the destination requires authentication, prepare the session before task start without exposing another participant's data.
- If a site opens a new window or external application, record the event; Study mode intentionally limits task-changing controls.
- If simulation settings appear wrong, stop the task and inspect the Study Link. Do not correct settings manually and continue the same recorded condition.

## Reporting checklist

Include these details in a study report:

- Scrutinizer version and operating system
- Rendering mode and whether the effect was enabled
- Foveal radius and calibration procedure
- Comfort Mode and Visual Memory settings
- Display, scaling, resolution, and approximate viewing distance when relevant
- Whether the participant or moderator controlled the pointer
- Task wording and starting URL
- Participant count, recruitment context, and exclusions
- Technical incidents and moderator interventions
- A clear statement that pointer position was not measured gaze

These details make RFV observations interpretable and make later replications meaningfully comparable.
