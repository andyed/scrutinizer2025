# Usability-Testing Practitioner Guide

This guide explains how to use Scrutinizer's **Restricted Focus Viewer** (RFV) to control and reveal visual focus in a moderated usability session. It covers reproducible task setup, observation practice, and interpretation.

For basic installation, controls, calibration, Visual Memory, and Comfort Mode, begin with [Getting Started: Restricted Focus Viewer](getting-started-rfv.md). For the deep-link implementation contract, see [Usability Study Deep Links and Study Toolbar](../specs/usability-study-deep-links.md).

## The strategic value of RFV

Ordinary usability observation shows clicks, navigation, speech, and task outcomes, but much of the participant's moment-to-moment visual access remains hidden. RFV changes the task environment so that detailed information is available only around a participant-controlled location. To inspect a region, the participant must bring it into focus.

That intervention creates two linked benefits:

1. **Control:** every participant performs the task under the same documented restriction on visual information.
2. **Revelation:** movement of the clear region exposes the participant's functional focus—the places they choose to inspect in order to understand and act.

“See what your user sees” is therefore meaningful in an RFV session. The participant works from the rendered stimulus, and the researcher sees that same stimulus. The researcher can observe what was available before each move, which region the participant revealed next, and whether the interface provided enough peripheral information to guide that transition.

RFV does not claim that pointer coordinates equal exact physiological gaze. A participant may move their eyes within the display or direct covert attention outside the clear region. The pointer instead has a stronger operational meaning than an ordinary cursor: it controls where task-relevant detail can be acquired. Call this **functional focus** or **revealed focus**, reserving **gaze** for eye-tracker measurements.

## What this method is for

Scrutinizer is useful when a research question concerns what remains visually available away from a selected viewing location:

- Does the interface provide a noticeable next target?
- Does an important control disappear into nearby clutter?
- Does a task depend on reading labels that are not near the current location?
- Does color, spacing, size, or grouping make a region distinguishable before it is directly inspected?
- How easily can a participant recover after choosing the wrong region?

Use RFV findings as evidence about visual access, functional focus, and interaction behavior under the controlled condition. Combine them with participant comments and task outcomes; add eye tracking when the research question requires exact eye position, saccades, or covert-attention inference.

## Choose a session format

### Participant-controlled task

The participant moves the pointer and completes a realistic task while the moderator observes. This is the primary usability-testing format. Because the pointer controls access to detail, its movement reveals which regions the participant chooses to bring into functional focus, in what sequence, and for what apparent purpose.

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

Query values containing URLs, spaces, punctuation, or other reserved characters must be percent-encoded. The easiest path is the hosted [Study Link Builder](https://scrutinizer.app/study-link-builder.html), which assembles and percent-encodes the link and validates it with the same parser the installed app runs — a link that passes there will not be rejected on a participant's machine. To generate links programmatically instead, use `URLSearchParams` in browser JavaScript:

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

Explain that the pointer controls where detail is available and that the moderator will observe how the participant reveals and uses information. Do not describe this as eye tracking unless an eye tracker is actually connected. Obtain any consent required by the research plan.

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

- “The participant never brought the navigation into focused access before abandoning the task.”
- “The participant revealed the content column first, then moved to global navigation after the page failed to provide a useful peripheral cue.”
- “Under the 45px, Mode 12, Visual Memory 5 condition, four of six participants explored the content column before finding the account navigation.”
- “The billing destination was often noticed only after participants moved near the global navigation.”
- “Increasing separation between the two controls is a design hypothesis for the next iteration.”

Avoid conclusions such as:

- “Participants' eyes never looked at the navigation.” RFV establishes that they did not bring it into focused visual access; exact eye position requires eye tracking.
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
- A statement that the pointer controlled detailed visual access and revealed functional focus; note separately whether physiological gaze was measured

These details make RFV observations interpretable and make later replications meaningfully comparable.
