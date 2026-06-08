# Static Stimulus Foveation (capability spec)

**Status:** PROVEN, formalizing. `scripts/replay-scanpath.js` already foveates a static image at scanpath
fixations (img-wrapper + ScanpathPlayer + capturePage; used for COCO-Search18). Verified 2026-06-07 on a
real AdSERP SERP screenshot at a real fixation (no live HTML render). This spec promotes it from a
per-dataset research script to a **first-class capability**.

## Why this is a core value prop
Today Scrutinizer foveates **live web** (DOM render + cursor). Static-stimulus foveation generalizes it to
**any captured image**, unlocking three use-classes:
1. **Research** — replay any eye-tracking corpus over its stimuli (AdSERP, COCO-Search18, …); reproducible
   psychophysics needs a *fixed* stimulus (live render drifts).
2. **Design review** — foveate a screenshot / Figma export / mockup / ad / dashboard with no live build.
3. **Robustness** — works when live render fails: archived pages, auth/paywall, JS-heavy, and the case that
   forced this — **Google CSS drift makes archived AdSERP HTML un-renderable**, so re-rendering is dead;
   the screenshot is the only faithful stimulus.

The render/gaze/upload layers are already source-agnostic (`uploadTexture`/`uploadStructureMap` are generic
`ImageData`; the fixation uniforms `u_mouse`/`u_mouse_stable` are position-agnostic; `ScanpathPlayer` feeds
arbitrary fixations). So this is a **new stimulus source, not a render-layer change** — clean and high-leverage.

## Current state (source truth; the TODO/CHANGELOG are stale)
- **Fixation is already arbitrary** — the "off-center-fixation bug" in TODO is stale; off-center works.
- **`replay-scanpath.js` is the static path** — `--image` + `--scanpath` → `generateStimulusPage()` writes an
  `<img>` wrapper → `TEST_MODE` capture per fixation. Coordinates are screenshot-space px.
- **The AdSERP importer renders HTML** (`adserp-importer.js` attaches `serpHtmlPath` but the live path does
  `loadURL`) → broken for archived SERPs. **It should route through the static path instead.**
- **Structure-map is DOM-only** (`preload.js`); on a plain `<img>` page the crowding/reading-span gates simply
  don't fire and the core CMF foveation applies intact (verified — the proof used no structure-map).

## The capability
A **Static Stimulus Source** = (raster image, fixation source, optional structure-map) → foveated output.
- **Fixation sources:** fixed point · interactive cursor over the image · **scanpath replay** (research).
- **Structure-map (graceful):** *none* → plain CMF (works now) · *external/OCR-derived* → enables
  crowding + reading-span on static images (the OCR→structure-map adapter from the foveated-scent work) ·
  *CV-derived* → full DOM-free parity for arbitrary images.
- **Entry points:** headless/CLI (research, exists) · GUI "Open Image…" (design review, roadmap) · IPC/env.

## Gaps to first-class (the work)
1. **Tall-page handling.** `generateStimulusPage` uses `object-fit: contain` → fine when viewport ≈ image,
   but it *scales* tall pages (SERPs are 1280×2378), breaking 1:1 coordinate alignment. Fix: either set
   viewport = image size (1:1, full-page foveation) **or** the physically-correct **viewport + scroll** mode
   (crop the screenshot to the scrolled viewport per fixation using the scanpath's scroll data — matches what
   the viewer actually saw; full-page-at-once over-degrades the bottom). The 2026-06-07 proof used a top-1024
   crop to sidestep this.
2. **Route archived/AdSERP replay through the static path** (not the HTML-render importer).
3. **Optional OCR structure-map** so reading-span/crowding fire on static text (see crforager
   `notes/gaze-stay-fit.md` / the foveated-scent program for the OCR→structure-map adapter).
4. **GUI "Open Image…"** for interactive design review.

## Recipe (proven)
```
node scripts/replay-scanpath.js --image=<png> --scanpath=<json> \
     --mode=0 --radius=45 --width=<W> --height=<H>
# scanpath JSON: { "fixations":[{"x":px,"y":px,"tStart":ms,"tEnd":ms}], "meta":{"displayWidth":W,"displayHeight":H} }
# AdSERP adapter (trial → crop/screenshot + scanpath JSON + command): crforager/scripts/adserp_to_scrutinizer_replay.py
```

## Verification
2026-06-07: AdSERP trial `p004-b1-t1`, top-1024 crop, fixation (676,198), mode 0 →
`output/scanpath-replay/frame_000_fix0ms.png` — foveal-sharp at the fixation, peripheral scramble.
Capability confirmed on SERP stimuli.
