# Git Analytics — Inside the Math: Scrutinizer

Observations from git history analysis (Feb 2026, 374 commits).
For the "numbers" section of the interactive essay.

## Comparable Stats Table (Scrutinizer vs Psychodeli+)

| Metric | Scrutinizer | Psychodeli+ |
| --- | --- | --- |
| **Commits** | 374 | 1,703 |
| **Calendar span** | 98 days | 340 days |
| **Active days** | 37 (38% hit rate) | 175 (52% hit rate) |
| **Lines written** | +46,908 | +492,839 |
| **Lines deleted** | -13,504 | -271,393 |
| **Net code** | +33,404 | +221,446 |
| **Codebase (JS)** | 11,057 lines / 42 files | ~130k lines / 275 files |
| **Shader lines** | 2,052 (2 frag + 1 vert) | ~4,500 (1 frag + 1 vert) |
| **Docs** | 46 markdown files | 128 markdown files |
| **Golden captures** | 95 PNGs across 8 versions | 78 images (essay) |
| **Versions released** | 16 tags (v1.0–v1.6.0) | Continuous deploy |
| **Reverts** | 7 (3 in one day) | ~15 |
| **Avg files/commit** | 3.6 | 3.4 |
| **Avg subject length** | 51 chars | 45 chars |
| **Peak commits/day** | 63 (Nov 23) | 45 |
| **Longest streak** | 14 consecutive days | 29 consecutive days |
| **AI co-authored** | 3 commits (1%) | ~88 commits (41% in Feb) |
| **Weekend %** | 43% (Sun+Sat) | 37% |

## Commit size evolution

| Month | Commits | Avg lines/commit | Avg files/commit | Avg subject length |
| --- | --- | --- | --- | --- |
| Nov '25 | 187 | 200 | 2.7 | 46 chars |
| Dec '25 | 164 | 140 | 4.0 | 54 chars |
| Jan '26 | 21 | 139 | 8.6 | 62 chars |
| Feb '26 | 2 | 1,490 | 5.0 | 55 chars |

### Three inflection points

1. **November 22–23, 2025** — 63 commits in a single day. The big bang: Initial commit → v1.1.4 in 48 hours. Electron scaffolding, first shader, first working foveal view. Pure velocity.

2. **December 13, 2025** — "The Revert Day." Three shader rollbacks in 30 minutes (Tier 1.6 → 1.5 → v1.3 baseline). Pushing perceptual fidelity past the stability frontier. The shader was too ambitious; artifacts forced retreat.

3. **January 31, 2026** — v1.5.0 ships. 21 commits that month but 8.6 files/commit — big cross-cutting changes. Mobile emulation, foveal calibrator, the slowest month but the most architecturally dense.

## The Revert Graph — Shader Tier Evolution

```
v1.0 ──────── v1.1 ────── v1.2 ──────── v1.3 ─────── v1.4.0
  │             │           │              │              │
  │ Basic blur  │ Overlay   │ Memory mask  │ WebGL 2.0    │ Tier 1.5
  │ peripheral  │ + HUD     │ + structure  │ peripheral2  │ Coupled Warp
  │ .frag       │           │   map        │ .frag born   │ + MIP Pooling
  │             │           │              │              │
  │             │           │              │         Dec 13: THE REVERT DAY
  │             │           │              │              │
  │             │           │              │     ┌────────┤
  │             │           │              │     │  14:41 │ ← roll back to Tier 1.6
  │             │           │              │     │  14:50 │ ← roll back to Tier 1.5
  │             │           │              │     │  15:11 │ ← full rollback to v1.3
  │             │           │              │     └────────┤
  │             │           │              │              │
  │             │           │              │              ▼
  │             │           │              │         v1.4.1 (stabilized)
  │             │           │              │              │
  │             │           │              │         v1.4.2 ─── v1.4.3 ─── v1.4.4
  │             │           │              │           │         │           │
  │             │           │              │        Oklab     Comparison   DoG bands
  │             │           │              │        color     metadata     (M-scaling)
  │             │           │              │        space
  │             │           │              │
  │             │           │              │         v1.5.0
  │             │           │              │           │
  │             │           │              │        Mobile emulation
  │             │           │              │        Foveal calibrator
  │             │           │              │
  │             │           │              │         v1.6.0 (current)
  │             │           │              │           │
  │             │           │              │        De-monolith into
  │             │           │              │        bio modules
```

## Temporal patterns

- **Peak hours:** 5–8 AM and 4–7 PM — morning creative bursts and evening sessions
- **Sunday dominates:** 99 commits (27%) — this is a passion project built on weekends
- **Day of week:** Sun (99) > Sat (63) = Mon (62) > Tue (45) > Thu (42) > Fri (34) > Wed (29)
- **63 commits in one day** (Nov 23) — the initial sprint, roughly one every 15 minutes
- **14 consecutive active days** was the longest streak (Nov 22 – Dec 5)

### Hour distribution
```
05:00   11    |  14:00   18
06:00   38    |  15:00    9
07:00   38    |  16:00   22
08:00   38    |  17:00   36
09:00   22    |  18:00   19
10:00   32    |  19:00   19
11:00   12    |  20:00   16
12:00    8    |  21:00   11
13:00    5    |  22:00    5
```

## Monthly churn

```
2025-11 | +24,680  -7,555   (net +17k)   ← THE BIG BANG
2025-12 | +17,690  -4,916   (net +13k)   ← Perceptual accuracy push
2026-01 |  +2,218    -374   (net +2k)    ← Mobile + calibration
2026-02 |  +2,320    -659   (net +2k)    ← De-monolith refactor
```

## Hot files (most touches across all 374 commits)

| Touches | File | % of commits |
| --- | --- | --- |
| 82 | main.js | 22% |
| 81 | renderer/scrutinizer.js | 22% |
| 64 | renderer/webgl-renderer.js | 17% |
| 61 | README.md | 16% |
| 46 | menu-template.js | 12% |
| 36 | docs/foveated-vision-model.md | 10% |
| 36 | docs/developers_guide.md | 10% |
| 35 | ROADMAP.md | 9% |
| 32 | renderer/shaders/peripheral.frag | 9% |
| 32 | package.json | 9% |

Top 2 files touched in 22% of all commits — the orchestrator and the electron shell. The shader (32 touches) tells the real story: each touch is a perceptual experiment.

## What the numbers reveal

Scrutinizer is a **sprint** where Psychodeli+ is a **marathon**.

- 374 commits in 98 days = 3.8 commits/active day (Psychodeli: 9.7)
- But: 16 tagged releases in 98 days = one release every 6 days
- The shader file has the best signal: 32 touches across 374 commits means 9% of all work touches the perceptual core
- The 3-revert day is the signature moment: the gap between "biologically correct" and "visually stable" is where the real engineering lives
- Only 3 AI co-authored commits (vs Psychodeli's 88) — not because AI was less involved, but because the developer handled git commits directly in Scrutinizer. In Psychodeli, AI started doing the commits. The co-author tag tracks git workflow, not AI contribution.
