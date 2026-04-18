# DOM-Aware Peripheral Perception — Implementation Plan

**Status:** approved direction, not yet started.
**Companion doc:** `docs/next-steps-2026-04.md` (discovery retrospective — what we learned in the session that motivated this plan).
**Estimated total effort:** ~7 weeks across 9 stages, each independently shippable.

## Claim

Scrutinizer's research contribution is treating screen content as a structured symbolic artifact whose peripheral perception is dominated by top-down recurrent priors, not as an undifferentiated naturalistic image to be feature-pooled. The DOM is the analogue, in simulation, of the lexical and affordance representations the brain feeds back into early visual cortex during reading and interface use (McClelland & Rumelhart 1981; Dehaene & Cohen 2011; Treisman 1985; Wolfe 2021).

This plan implements that claim. Eight primitive types — text, link, heading, icon, form_input, button, nav_item, image — each become first-class perceptual primitives with type-specific calibration curves keyed to published acuity/crowding/affordance literature.

## Architectural decisions (locked)

1. **Replace, not augment.** All DOM-classified perceptual primitives go through the dedicated DOM-aware path. The existing `peripheral.frag::sampleDoGReconstructed` MIP/DoG pipeline handles only non-primitive content (raster images, photos, background gradients).
2. **Baseline arm preserved as a separate mode** for psychophysics validation (Wallis-analogue 2IFC). Mode 16 = "no DOM-aware path at all," produces byte-identical pre-plan output. Per-type ablation modes (17–23) added as psychophysics protocols require them, not speculatively.
3. **Continuous parameters per primitive, not regime buckets.** Each primitive type gets a parameter family computed from primitive-type-specific calibration curves. The blend across regimes is smooth.
4. **Type-agnostic foundation, type-specific extensions.** Stages 0–5 build a foundation that accepts any primitive type via a registry; Stage 5 ships text as the first registered primitive; Stages 6–8 add additional types as independent ~1-week shipments.

## Eight-primitive taxonomy

Existing classifier: `renderer/preload.js:15–47` extracts 13 ARIA roles, but `preload.js:131–236` collapses everything interactive to `type=0.0, density=1.0`. The fine taxonomy is computed and thrown away. We will preserve it.

| Type | What it covers | Calibration grounding |
|---|---|---|
| `text` | Body text, paragraphs, prose | Bouma 1970, Pelli & Tillman 2008, Anstis 1974, Strasburger 2011 (tight) |
| `link` | Inline `<a>` within text | Text + chromatic acuity (Hansen et al. 2009) |
| `heading` | h1–h6 | Text with size-driven calibration shifts |
| `icon` | SVG/img ≤48×48 in interactive context | Strasburger 2011 shape acuity (sparse) |
| `form_input` | input/textarea/select | Treisman 1985 closure, rectangle detection (qualitative — research question) |
| `button` | Interactive `<button>` and role=button | Norman 1988 affordance + closure (qualitative — research question) |
| `nav_item` | descendants of `<nav>` or role=nav | Composite (text/link + group context) |
| `image` | raster/photo content | Falls through to baseline pipeline; included for completeness |
| `ui_surface` | landmarks, panels, dialog chrome | Residual; falls through to baseline pipeline |

Empirical-grounding honesty: text/link/heading are well-grounded. Icon is grounded in shape acuity but icon-specific peripheral literature is thin. Form_input and button calibrations are *research questions to validate empirically*, not pre-validated thresholds. Ship with uncertainty labels in code and docs.

## Unified parameter family

Three continuous parameters work across all 8 primitive types, with per-type calibration functions producing them:

- **`identityFidelity` ∈ [0,1]** — probability the primitive's specific instance is recoverable from the peripheral percept.
  - Text: word-form legibility (Pelli & Tillman crowding threshold).
  - Icons: shape discrimination vs. icon neighbors.
  - Form inputs: search-box vs. password-box discrimination.
  - Buttons: label readable; failing that, action-specific affordance.
  - Links: text identity + chromatic discriminability.
- **`categoryFidelity` ∈ [0,1]** — probability the primitive's *type* (not identity) is recoverable.
  - Text: "this is text, not an icon" (extent + baseline rhythm).
  - Icons: "this is a glyph, not text or photo" (compact support + high internal contrast).
  - Form inputs: rectangle-plus-interior-contrast affordance detection.
  - Buttons: filled-rectangle-with-edge-contrast.
  - Links: chromatically-distinct-text-in-running-text.
- **`extentPresence` ∈ [0,1]** — probability the primitive's bounding region is detected at all (gist-level; Oliva & Torralba 2006). Roughly constant ~1.0 up to gist-loss eccentricity; separated as a parameter because the blob layer keys off it.

Text's prior plan (`letterFidelity` / `wordCoherence` / `paragraphPresence`) is the special case where each parameter has a tight literature-grounded equation.

## Three-layer compositor

Per primitive, three appearance layers are produced:

- **`L_canonical`** — pixel-perfect rendering. For all types: a sample from `u_texture` (the already-captured page). No separate font/icon rasterization.
- **`L_categorical`** — stylized representation that signals primitive type without preserving full identity. Text: an x-height-period horizontal envelope modulating vertical stroke-frequency texture (~3 cycles per x-height; Majaj et al. 2002 letter-channel spatial frequency). Single-frequency x-height banding alone is insufficient — it fails the horizontal/vertical stroke-energy ratio that distinguishes Latin text from horizontal gratings. Icons: centroid intensity + dominant-orientation Gabor. Form inputs: rectangle outline + interior-contrast shading. Buttons: filled rectangle with implied bevel.
- **`L_blob`** — bbox at mean luminance with type-coded modulation. Text: baseline rhythm. Icons: centered intensity blob. Form inputs: edge emphasis. Buttons: filled rectangle.

Stage 3 implementation note (revised): `L_categorical` and `L_blob` are produced **procedurally in the compositor shader** from per-primitive metadata (x-height, bbox, mean luminance from `u_texture` mips) rather than pre-rasterized into an appearance atlas. An atlas remains justified only for icons (Stage 6) where dominant-orientation Gabor requires per-instance PCA of the source pixels. This collapses the original 8–32 MB Stage 3 atlas budget to ~1–2 MB at Stage 6. The Stage 9 Wallis-analogue 2IFC battery should include sine-only vs. sine+stroke vs. atlas arms to settle the sufficiency question empirically.

Composite (in compositor shader, per fragment in DOM-aware regions):

```
col = identityFidelity                        × L_canonical
    + (categoryFidelity − identityFidelity)   × L_categorical
    + (extentPresence  − categoryFidelity)    × L_blob
    + (1 − extentPresence)                    × L_background
```

`L_background` is the baseline pipeline output (`sampleDoGReconstructed` / `sampleMIPPooled`) for the non-primitive case. Tangential smear at the bbox level scaled by `(1 − identityFidelity)`, kernel length capped at primitive x-height (text) or smallest bbox dimension (icons/inputs/buttons) — explicit cap to avoid the prior session's failure mode of comet-tail smears at corners.

## What already exists in the codebase

- `renderer/preload.js:15–47, 131–236` — DOM scan, role classification (load-bearing).
- `renderer/structure-map.js:53–77` — RGBA8 packing of rhythm/density/type/aria. All four channels survive to the GPU; only `.b/.g/.r` consumed by simulation today.
- `renderer/content-analysis.js:400–424` — single funnel from raw DOM blocks to structure map.
- `renderer/gestalt-processor.js:155–174` — clusters destroy text-ness when interactive children present (latent bug; PR-2 fix).
- `renderer/shaders/peripheral.frag` — main fragment shader; `sampleDoGReconstructed` at line 184 is the current text path; `u_fovea_protect` at lines 71/2016 is the foveal passthrough.
- `renderer/webgl-renderer.js:371–377, 771–772` — structure map texture binding, mirrored for the new primitive map.

## Channel budget — second texture, not bit-fighting

The existing `u_structureMap` RGBA8 is full. Add a parallel `u_primitiveMap` (RGBA8, same 50% resolution, same draw loop):
- R: primitive_type_id (0–255, 8-bit)
- G: calibration_param_0 (extent/strength)
- B: calibration_param_1 (contrast/rhythm)
- A: calibration_param_2 (identity_fidelity precomputed CPU-side)

Existing modes that read only `u_structureMap.b/.g/.r` are untouched → zero regression risk. Per-primitive bbox/instance metadata (atlas lookups) lives in a separate CPU-side per-frame buffer, not the texture.

## Stage breakdown

### Stage 0 — Baseline freeze (~0.5 day)

Lock the current pre-plan behavior as `mode 16 baseline_all` before any changes. Clone the highkey/mode 0 pipeline verbatim, mark `category: "research"`. Add to `scripts/capture-golden.js` so next run snapshots it. Lock the pipeline object in a Jest regression test.

**Files:** `shared/modes.json`, `scripts/capture-golden.js`, `tests/unit/validation-regression.test.js`.

**Ships:** Mode 16 switchable via menu, byte-identical to mode 0 on text content.

### Stage 1 — Type-agnostic calibration registry (~3 days)

New `renderer/peripheral-calibration.js` exporting:

```
registerPrimitiveCalibration(typeId, fn(block, eccDeg, viewportPpd)
  → {identityFidelity, categoryFidelity, extentPresence})
```

Ship only the `text` calibrator at this stage (Anstis/Strasburger acuity for `identityFidelity`; Bouma/Pelli for `categoryFidelity`; bbox extent for `extentPresence`). Other 7 types unregistered until their stages.

**Tests:** `tests/unit/peripheral-calibration.test.js` — Jest cases parameterized by Anstis/Bouma benchmark values at ecc = 0/2.5/5/10/20°. Anstis MAR ≈ 0.0875·e + 0.0633 deg. Bouma `s_crit ≈ 0.5·e` with `b ∈ [0.3, 0.5]` tolerance.

**Ships:** Pure JS module importable anywhere; nothing visual yet.

### Stage 2 — DOM extraction with primitive taxonomy (~2 days)

Extend `DomAdapter.classifyPrimitive(el)` returning one of the 8 type IDs. Heuristic order: heading → link → button → form_input → nav_item → icon → image → text → ui_surface. Icon detection: SVG/img ≤48×48 px AND (interactive ancestor OR aria-label).

Both `renderer/preload.js` and `renderer/dom-adapter.js` must change (preload is the inlined runtime copy).

Fix the gestalt destroy-ness bug in `renderer/gestalt-processor.js:155–174`: merged clusters carry a `children` array of primitives with their own bboxes; the merged bbox only gates spatial grouping. Compositor still sees individual primitives.

**Tests:** `tests/unit/dom-adapter-primitive-taxonomy.test.js` — 20 fixture elements (Gmail compose button, GitHub search box, Bootstrap nav, Material icon, etc.).

**Ships:** Each block emitted from DOM scan carries `primitiveType` field. Downstream still ignores it; pure plumbing.

### Stage 3 — Primitive-map texture + appearance atlas (~4 days)

New `renderer/primitive-map.js` mirrors `structure-map.js` for the new RGBA8 texture.
New `renderer/primitive-atlas.js` — offscreen render target where, per frame, each visible primitive gets three pre-baked layers (`L_canonical`/`L_categorical`/`L_blob`) stacked vertically in sub-rects. Per-primitive rasterizer registry parallels the calibration registry. Ship only the text rasterizer at this stage.

Wire both textures into `webgl-renderer.js` alongside the existing structure map. Add shader uniforms: `u_primitiveMap`, `u_primitiveAtlas`, `u_primitiveAtlasLookup` (instance_id → atlas rect).

**Tests:** Visual atlas inspection via debug mode dump. Atlas cache invalidation on scroll.

**Ships:** Atlas populated correctly for text on Articles fixture; nothing composited yet.

**Risks:** Atlas memory budget (500–2000 primitives × 64×64 ≈ 8–32 MB). Mitigation: lazy rasterization within current peripheral envelope only.

### Stage 4 — Compositor (~3 days)

New function `sampleDomAwarePrimitive(uv, eccentricity)` in `peripheral.frag`, sibling to `sampleDoGReconstructed` (~line 184). Reads `u_primitiveMap`, looks up atlas layers, executes the four-term composite. Dispatch: if `primitive_type_id == 0` (ui_surface/none), return baseline-arm output unchanged.

**Tests:** Mode 16 output must remain pixel-identical to pre-plan output on all golden fixtures (baseline arm preserved end-to-end).

**Risks:** Three extra texture samples per peripheral fragment. Profile on lowest-tier target (M1 MacBook iGPU) before merging. If too costly, gate behind `dom_aware_enabled` uniform that compiles out the branch when off.

### Stage 5 — Text as first primitive (~2 days)

Connect the text calibrator (Stage 1) + procedural text compositor (Stage 4) + per-gaze calibration wiring. First visible result.

Procedural `L_categorical_text` in the fragment shader: `horizontalEnvelope(y, xHeight) × strokeTexture(x, xHeight/3)` where the envelope is a square wave at x-height period and the stroke texture is a pseudo-random or oriented-noise term at ~3 cycles per x-height frequency. Uses `u_primitiveMeta` (Stage 3c) for the per-primitive x-height; `u_primitiveMap.r` carries `primitive_type_id` for the dispatch branch.

New `mode 20 dom_aware_text` inheriting mode 15 + `dom_aware_enabled: true, dom_aware_types: ["text"]`.

**Tests:** `tests/unit/dom-aware-text-compositor.test.js` band-wise luma-diff target. **Visual acceptance gate before any SSIM tuning** — the prior session showed SSIM can improve while output becomes visibly unshippable.

**Risks:** Tangential-pool failure mode from `docs/next-steps-2026-04.md`. Hard cap kernel length at primitive x-height; if visual check fails, *fix the visual first*, don't tune SSIM.

### Stage 6 — Icons (~1 week, independent)

Icon calibrator using Strasburger 2011 shape-acuity falloff with explicit honest-limitations note. Icon rasterizer: `L_categorical` = centroid + dominant-orientation Gabor; `L_blob` = centered intensity blob.

Mode 21 `dom_aware_text_icon`. Test fixtures: GitHub, Gmail (high icon density).

### Stage 7 — Form inputs + buttons (~1 week, joint)

Joint stage because calibration literature overlap is high (both lean on Treisman closure + rectangle detection; Norman affordance lit is qualitative). Calibrations admitted as research questions in code comments + the validation memo.

Rasterizer: `L_categorical` = rectangle outline + interior-contrast shading (inputs: light interior; buttons: filled with implied bevel).

Mode 22.

### Stage 8 — Links + nav_items (~4 days)

Links inherit text calibration + chromatic acuity term (Hansen et al. 2009; existing RG decay path at `peripheral.frag:76–81`). Nav items mostly compose from text/link/icon — rasterizer reuses prior types.

Mode 23.

### Stage 9 — Validation memo extension + psychophysics hooks (~2 days)

Extend the validation memo with per-primitive-type calibration tables. Mark icon/form_input/button parameters as research-questions-to-validate, not pre-validated thresholds. Document the per-primitive ablation modes available for 2IFC studies.

## Parallel execution tracks

The 9-stage sequence overstates the dependency chain. Real graph is sparser. Five tracks run concurrently in week 1; per-primitive work fans out further once text ships in Stage 5.

### Independent foundation tracks (week 1, no cross-dependencies)

- **Track A — Calibration registry** (Stage 1, pure JS): `renderer/peripheral-calibration.js` + Jest tests + literature citations. Independent of everything in the renderer.
- **Track B — DOM extraction** (Stage 2, pure DOM scanning): `DomAdapter.classifyPrimitive` + 8-type taxonomy + 20-fixture test suite. Independent of the shader pipeline.
- **Track C — Baseline freeze** (Stage 0, half day): mode 16 in `shared/modes.json` + capture-golden update + locked-snapshot test.
- **Track D — Gestalt children-preserving merge** (PR-2, latent bug fix): `renderer/gestalt-processor.js:130–176` + callers in `content-analysis.js:400–424`. Independent and unblocks per-primitive stages later.
- **Track E — Validation memo extension** (Stage 9, always-parallel): start writing as Track A lands the first calibrator. Documents code as it ships.

### Within-stage parallelism

- **Calibration functions are independent per primitive type.** Once the registry contract is locked, text/icon/form_input/button/link calibrators can be written by different developers in parallel. Their literature work is also independent.
- **Atlas rasterizers are independent per primitive type.** Once the atlas contract (sub-rect layout, layer count) is locked, one PR per primitive's rasterizer.
- **Jest runs files in parallel by default.** Per-primitive calibration test files, fixture extraction tests, and rasterizer output tests are all independent.

### Per-primitive parallel streams (after Stage 5 ships)

Once text ships end-to-end, Stages 6–8 are completely independent of each other:

- **Stream X**: Stage 6 (icon calibrator + rasterizer + mode 21)
- **Stream Y**: Stage 7 (form_input + button calibrators + rasterizers + mode 22)
- **Stream Z**: Stage 8 (link + nav_item calibrators + rasterizers + mode 23)

Each ships independently. Calendar collapses from 3 weeks sequential to ~1 week if three streams run concurrently.

### Always-parallel research workstreams

Independent of code, run alongside everything:

- Blog post editorial pass + citation verification (`docs/drafts/dom-aware-perception-post.md` if drafted in repo)
- Psychophysics 2IFC harness design (separate workstream; doesn't gate on rendering)
- Adversarial test fixture collection — pages where each primitive type appears densely, needed for Stages 6–8 testing anyway

### Sequential bottlenecks (do not try to parallelize)

- **Stage 4 compositor needs Stage 3's textures wired first.** Texture binding contract → shader uniform contract → composite math. Hard sequential.
- **Stage 5 visual acceptance gate needs human eyes.** No automation substitute. Stop-the-line gate before per-primitive work starts.
- **PR-2 gestalt fix should land before per-primitive stages.** Otherwise Stage 6+ has to deal with the merge bug and any test fixtures get retroactively invalidated.

### Compressed calendar (with parallelization)

| Week | Active tracks | Outcome |
|---|---|---|
| 1 | A + B + C + D + E concurrent | Mode 16 frozen; gestalt fixed; calibration + classifier shipped or near-shipped |
| 2 | A + B finish; Stage 3 atlas skeleton; E continues | Atlas + primitive map textures wired |
| 3 | Stage 4 compositor (sequential pinch) | Composite math wired; Mode 16 still byte-identical |
| 4 | Stage 5 text end-to-end + visual gate | Text ships; visual approval before fan-out |
| 5–6 | Streams X + Y + Z concurrent | Icons + form_input + button + link + nav_item all ship |

Net: ~6 weeks calendar (vs. 7 sequential). Bigger win than elapsed time: 4–5 isolated work threads on Day 1, so multiple sessions / agents / collaborators can contribute without colliding.

## Day-1 PRs (the literal first three)

Three PRs land in week 1, parallelizable, no cross-dependencies:

1. **PR-1: Stage 0 baseline freeze + mode 16 definition.** Half-day turnaround. Locks the pre-plan output before anything changes.
2. **PR-2: Gestalt children-preserving merge.** Bug fix independently valuable; unblocks all later stages. Touches `renderer/gestalt-processor.js:130–176` plus callers in `renderer/content-analysis.js:400–424`.
3. **PR-3: Primitive classifier in DomAdapter (no GPU changes yet).** Touches `renderer/preload.js` and `renderer/dom-adapter.js` with matching unit tests. Zero visual change; pure plumbing.

PR-4 (calibration module) can also land in week 1 since it's pure JS with no codebase dependencies. Treat it as the optional fourth Day-1 PR if a developer/agent has the time slot.

## Risks

- **Atlas memory** grows ~3× over text-only because the atlas serves all DOM-classified content. Mitigated by lazy-rasterization envelope.
- **Icon/form-input calibration grounding is empirically thin.** Ship with honest uncertainty labels; design each type's stage to be empirically testable in the separate psychophysics workstream.
- **Shader texture-sample count** climbs by 3 in the DOM-aware path. Profile on milestone iGPU before Stage 4 merge.
- **Gestalt fix has ripple effects.** Audit any mode that depends on "groups of text containing links become UI" (Blueprint mode at `peripheral.frag:1498–1548` is one suspect) in PR-2.
- **Tangential-smear regression** documented in `docs/next-steps-2026-04.md`. Hard kernel-length cap at primitive bbox dimension; visual gate before any SSIM tuning.

## Out of scope for this plan

- Closing the Brown-metamer SSIM gap on non-primitive (photo/raster) content.
- Fixing the WebGPU sector-compute storage-buffer issue (separate workstream).
- Psychophysics infrastructure (Wallis-analogue 2IFC harness) — separate research workstream; the DOM-aware path needs to render correctly first.
- Cross-language / non-Latin script handling. Latin alphabetic text only for v1.

## Validation grounding (summary; full memo separate)

| Primitive | Parameter | Grounding | Confidence |
|---|---|---|---|
| text | identityFidelity | Anstis 1974, Strasburger 2011 (acuity); Pelli & Tillman 2008 (crowding) | High |
| text | categoryFidelity | Bouma 1970 (`b ≈ 0.5`, ±0.15 inter-observer) | Medium-high |
| text | extentPresence | Oliva & Torralba 2006 (gist) | Medium |
| link | identityFidelity | text + Hansen et al. 2009 (chromatic) | High |
| heading | (text + size) | text calibration scaled | High |
| icon | identityFidelity | Strasburger 2011 shape acuity | Medium |
| icon | categoryFidelity | Compact-support + internal-contrast heuristic | Low (research question) |
| form_input | both | Treisman 1985 closure + rectangle detection | Low (research question) |
| button | both | Norman 1988 affordance (qualitative) + closure | Low (research question) |
| nav_item | inherited | composite of text/link/icon | Inherited |

## Research framing

This plan implements the position argued in the (drafted) blog post "Top-down vision for screens: why peripheral perception models need the DOM." The publishable claim is that screen content's structured symbolic nature makes pure feedforward pixel pooling an incomplete model, and that DOM-aware peripheral rendering is the simulation-side analogue of the recurrent top-down priors documented in 50+ years of reading research (Reicher 1969; McClelland & Rumelhart 1981; Plaut et al. 1996; Dehaene & Cohen 2011) and pre-attentive UI perception (Treisman 1985; Wolfe 2021; Rosenholtz 2016).

The Wallis-analogue 2IFC psychophysics study (separate workstream) tests this claim: does DOM-aware rendering produce screen metamers indistinguishable from the original under brief presentation, where pure pixel-pooling models fail?

## References

Anstis, S. M. (1974). *Vision Research*, 14, 589–592.
Bouma, H. (1970). *Nature*, 226, 177–178.
Dehaene, S., & Cohen, L. (2011). *Trends in Cognitive Sciences*, 15(6), 254–262.
Hansen, T., Pracejus, L., & Gegenfurtner, K. R. (2009). *Journal of Vision*, 9(4):26.
McClelland, J. L., & Rumelhart, D. E. (1981). *Psychological Review*, 88(5), 375–407.
Norman, D. A. (1988). *The Design of Everyday Things*.
Oliva, A., & Torralba, A. (2006). *Progress in Brain Research*, 155, 23–36.
Pelli, D. G., & Tillman, K. A. (2008). *Nature Neuroscience*, 11(10), 1129–1135.
Plaut, D. C., McClelland, J. L., Seidenberg, M. S., & Patterson, K. (1996). *Psychological Review*, 103(1), 56–115.
Reicher, G. M. (1969). *J Exp Psychology*, 81(2), 275–280.
Rosenholtz, R. (2016). *Annual Review of Vision Science*, 2, 437–457.
Strasburger, H., Rentschler, I., & Jüttner, M. (2011). *Journal of Vision*, 11(5):13.
Treisman, A. (1985). *CVGIP*, 31(2), 156–177.
Wallis, T. S. A., et al. (2019). *eLife*, 8, e42512.
Wolfe, J. M. (2021). *Psychonomic Bulletin & Review*, 28, 1060–1092.
