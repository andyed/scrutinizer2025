# Sprucing Roadmap — verification-first hardening + usability-testing foundation

*Created 2026-07-11 · Source: 5-agent broad audit (simulation status, AI posture, tool automation, robustness, usability-readiness) · Supersedes the ad-hoc remediation tail in [`../../TODO.md`](../../TODO.md) "Post-Isotropic Audit Remediation".*

## Why this exists

The default-mode science (mode 12 FOVI isotropic) is **stable and defensible**, but the **verification layer that would catch the next regression is broken** — the crowding gate passes by reading nothing, the radial baseline is a clone of itself, and two named validation scripts don't exist. Adding usability testing on top of an unverified base would make study data meaningless. So the sequence is: **fix the gates first, floor the robustness, make the instrument drivable, then build usability testing.**

## How to use these docs

Each phase file is a list of **self-contained tickets**. Every ticket has the same shape so it can be executed cold, without reading the rest of the repo:

- **Goal** — one sentence, what "done" means.
- **Files** — exact paths (and line anchors where stable) to touch.
- **Steps** — ordered, concrete edits/commands.
- **Verify** — the command to run and the output that proves success.
- **Done when** — the checkbox condition.

**Rules for any executor (including low-complexity models):**

1. Do the tickets **in phase order**. Phase 3 depends on Phase 2's control-plane API; Phase 2 is only worth it once Phase 0/1 make the data trustworthy.
2. Within a phase, tickets are independent unless a ticket says "depends on X".
3. **Never** report a fix as working without running its **Verify** command and seeing the stated output. This whole roadmap exists because prose drifted from artifacts — do not add to that.
4. If a **Verify** command needs the app and `node_modules` is missing, run `npm install` at `scrutinizer2025/` root first (that's ticket **P1-1**).
5. Conventional commits: `type(scope): message`. One ticket ≈ one commit. Reference the ticket id in the body (e.g. `Closes P0-2`).
6. No GitHub pushes weekdays 10am–3pm PT (day-job hours) unless asked.

## Phases

| Phase | File | Theme | Rough size | Gate |
|-------|------|-------|-----------|------|
| **0** | [phase-0-science-verification.md](phase-0-science-verification.md) | Close the science verification gap (M1–M4, B3) | ~1 week | **Do first.** Makes "stable science" true. |
| **1** | [phase-1-robustness-floor.md](phase-1-robustness-floor.md) | CI, clean-clone tests, tessdata provenance, tier stamping, hygiene | ~0.5 week | Can run alongside Phase 0. |
| **2** | [phase-2-automation-ergonomics.md](phase-2-automation-ergonomics.md) | Persistent control plane, MCP registration, agent-posture fixes, DPR pin | ~1 week | Needs Phase 0/1 trustworthy. |
| **3** | [phase-3-usability-foundation.md](phase-3-usability-foundation.md) | ExperimentRunner, condition API, DataCollector, consent, BubbleView | ~2 weeks | Needs Phase 2 control plane. |

## Dependency logic (one line)

Phase 3's controlled studies need Phase 2's per-trial condition-toggle API → cleanest as part of the control plane → worth building only once Phase 0/1 make study data mean something.

## Status tracking

Check boxes in each phase file as tickets land. When a whole phase is green, add a dated line here:

- [~] Phase 0 — 2026-07-11: P0-1..P0-4 done, P0-5 done except the held v2.8.0/v2.6.1 release-tag decision. Unit suite green (562 pass). Two honest gate failures now visible by design (crowding diagnostic; mode-12 radial non-monotonicity, chip spawned).
- [~] Phase 1 — 2026-07-11: P1-1..P1-4, P1-6, P1-7 done (CI workflow, clean-clone-safe suite, tessdata provenance, validator exit codes, hygiene). **P1-5 deferred** (compute-tier stamping) — it edits the capture scripts the concurrent radial-investigation session is modifying, and needs the running app to verify; pick up once that session lands. Unit suite green (562 pass).
- [ ] Phase 2 complete —
- [ ] Phase 3 complete —
