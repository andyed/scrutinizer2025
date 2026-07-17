# Wave Plan — Usability Pivot (2026-07-16)

Sequencing plan from the 2026-07-16 four-track audit (usability-readiness, docs
roadmap, competitive landscape, brand positioning). Organizing goal: **from
"launcher shipped" (v2.8.1 Study Links) to "first real study run cleanly,
producing artifacts, with the public story matching the product."**

Amends, does not replace, the phase docs in this directory. Phase numbering
below refers to `phase-2-automation-ergonomics.md` / `phase-3-usability-foundation.md`.

## Wave 0 — Unblock the pilot (DONE 2026-07-16)

- [x] Study toolbar contrast to the 8:1 floor (Done 3.98→11.18, origin 7.01→8.49,
      browse URL 4.43→8.52; hover/active verified) — `renderer/toolbar.css`
- [x] Exit Study Mode menu command (spec §229 escape path) — `menu-template.js`, `main.js`
- [x] Deep-link ready-race fix + activate-consumes-pending-link — `main.js`
- [x] Unknown-parameter echo capped at 64 chars — `shared/study-deep-link.js`
- [x] Release-notes honesty: Windows deep links are unimplemented, not "being verified"

Exit: v2.8.1 release notes updated; release itself gated on Wave 1 verification.

## Wave 1 — Verify the delivery path, build the study kit, run the pilot (1–2 days)

- [ ] **Signed/notarized DMG handoff verification** — Safari + Chrome, cold + warm
      launch, Browse-toolbar-flash criterion. The release gate; nothing
      study-shaped happens until this passes.
- [x] `docs/templates/consent.md` + `debrief.md` (P3-5 partial; referenced by
      `human_subjects_data_collection.md`) — DONE 2026-07-16
- [x] Study Link builder page on scrutinizer-www (`src/study-link-builder.html`;
      parser vendored to `src/js/study-deep-link.js`, verified output-identical
      to the app's) — DONE 2026-07-16; doubles as the parameter cookbook
- [ ] **Pilot study: 2–3 participants, moderated**, using the practitioner guide
      and worksheet. Findings memo doubles as a case-study blog post.

Exit: completed pilot with findings memo.

## Wave 2 — Align the public story (1 day, parallel with Wave 1)

- [ ] scrutinizer-www off v2.7.0; Study Links get landing-page presence
- [ ] Demote the headline overclaim ("See what your users actually see" →
      glance framing); remove/justify "Pro" and "instrument/infrastructure"
      language implying tiers and services that don't exist
- [ ] One lead per surface: www = design-team story, README = researcher story,
      guides = practitioner story
- [ ] Blog post: "Usability testing with a Restricted Focus Viewer" —
      category-teaching vs static predictors (Attention Insight et al.) and
      uniform blur (DevTools/NoCoffee)

Push timing: no GitHub pushes weekdays 10:00–15:00 PT.

## Wave 3 — The platform (Phase 3, weeks)

Order deliberately inverts the P3 ticket numbering:

1. [ ] **P3-2 DataCollector first** — session JSON/CSV (task metadata, config
       snapshot, ScanpathData cursor trail, timestamps, Done event). Turns the
       existing single-task flow into something that produces artifacts.
2. [ ] **P3-1 ExperimentRunner** — multi-task sequencing/counterbalancing via the
       reserved `scrutinizer://v1/study/run?config=<url>` manifest route.
3. [ ] **P3-3 BubbleView** — flagship no-hardware paradigm; ship WITH its tutorial.
4. [ ] Docs riding along: known-issues.md rewrite for v2.8.x, practitioner hub
       index, release-notes consolidation into CHANGELOG, glossary fix (8→12 bands).

Double payoff: P3-2/P3-3 are also the instrument for the human-subjects
validation work (biological-plausibility roadmap in TODO.md).

## Wave 4 — Reach (backlog)

jsPsych plugin (academic wedge vs MouseView.js) → scanpath replay
(complement-to-eye-tracking positioning) → Windows deep-link support
(`requestSingleInstanceLock` + `second-instance` + argv parsing).

## Open decisions

1. **Phase 2 gate:** recommend Phase-2-lite — pull the deterministic DPR pin
   forward (capture reproducibility), defer control plane/MCP until after P3-2.
   Renegotiates the "do not start P3 until Phase 2 exits" rule in `README.md` here.
2. **P3-2 before P3-1** (as sequenced above).
3. **Pilot as Wave 1 exit criterion** (commits to recruiting 2–3 people).
4. **Link builder vs cookbook-only** (builder recommended, ~1 extra day).
5. **Naming:** Plixer Scrutinizer / scrutinizer-ci.com collisions noted; parked —
   don't deepen marketing spend on the name until decided.
