# Next Steps — Peripheral Pooling Fidelity (2026-04)

Master plan for closing the peripheral-signal-loss calibration gap against Brown et al. metamers and, more broadly, against established cortical pooling models. Written after the 2026-04-17 session that exposed the real structure of the gap.

## What the session established

**Mode 15 (`tier3_synthesis`) was running MIP/DoG fallback, not cortical sector pooling.** A WebGPU storage-buffer limit (`maxStorageBuffersPerShaderStage` default 8, pyramid-synth binds 9) caused `createBindGroupLayout` to fail silently. `peripheral.frag` fell through to `sampleMIPPooled`/`sampleDoGReconstructed`, which apply a pixel-local isotropic blur — not the radial/tangential cortical pooling mode 15's pipeline claims.

Consequences:
- Every prior `compare-brown` number for mode 15 was measuring geometry mismatch (rectilinear vs. radial pooling), not signal-loss magnitude. SSIM deltas were mostly meaningless.
- Peripheral text output was more legible than cortex would actually allow. Any demo/post/validation showing "how peripheral text looks in Scrutinizer" produced a scientifically wrong answer.
- `num_cortical_rings: 50` in `modes.json` was load-bearing but never actually took effect in the default path.

**Attempted fix (reverted 2026-04-17):** raised the storage-buffer limit so sectors actually ran; added a tangential 1D Gaussian pool in `sampleDoGReconstructed` gated by the structure-map text channel. Compare-brown Band 2 improved on crowding (+44% relative SSIM). **Visually unshippable:** sector reconstruction produced debilitating dithered-noise wedges on white space at the parafovea boundary, and the tangential smear was visibly implausible on text. Reverted all three code changes.

## Decisions locked in

1. Brown is **one** ground truth among several, not inevitable. Competing pooling theories: Rosenholtz mongrels, Freeman & Simoncelli 2011, Wallis 2019, Blauch 2026. Calibration against Brown is valid but narrow.
2. Scrutinizer does **not** claim full iterative Portilla-Simoncelli synthesis. Single-pass is a constraint and part of the research contribution.
3. Scrutinizer **does** claim cortical pooling. Rectilinear pixel blur on text is below the bar. Any text-handling path must be radially/tangentially pooled or honestly labeled as acuity reduction rather than cortical pooling.
4. RFV use cases are a hard constraint. Any peripheral output that introduces phantom features (false noise patterns that look like edges or objects) is disqualifying, regardless of scientific correctness.

## The layered model of the gap

Calibration is not one-dimensional. The stack, from deepest to surface:

| Layer | What it is | Current state |
|---|---|---|
| L1 Pooling geometry | Radial sectors vs. rectilinear tiles | Sector pipeline exists but visually broken on non-text content when activated |
| L2 Per-sector statistics | What gets computed inside each pool | Isotropic Laplacian bands; Brown uses 4-orientation × 4-scale steerable pyramid |
| L3 Reconstruction | Stats → pixels | Single-pass from seed; Brown iterates 300× |
| L4 Blend boundaries | Sector↔sector, periphery↔fovea | Hard gates; Brown has partition-of-unity overlap |

You cannot calibrate a layer until the layer below is correct. We spent effort tuning L2/L3/L4 against a broken L1 for some time.

## Next steps, priority ordered

### P0 — Honesty pass on the installed product

- [ ] CHANGELOG entry documenting that mode 15 was running MIP fallback prior to this discovery, and what that means for any past work produced with it.
- [ ] Rename or relabel modes by what they actually do, not what they aspire to. Proposal: split into `acuity_loss` (MIP/DoG, smooth, RFV-safe) and `cortical_pooling` (sector-based, research-only, artifacts expected). Stop conflating them under one "TTM Synthesis" label.
- [ ] Audit any demo or blog post that claims mode 15 shows cortical peripheral pooling.

### P1 — Fix L1 without reintroducing L2 problems

Several options; none free.

1. **Make sectors visually usable before re-activating.** Add partition-of-unity overlap between sectors (Gaussian-weighted), eliminate hard radial/tangential boundaries. This is standard Freeman-Simoncelli recipe. Expected cost: days. Expected outcome: edges gone, noise remains until L2 is addressed.
2. **Drop sectors, keep the honest-labeling framing.** Ship acuity mode as acuity; stop claiming cortical pooling for real-time output. Cheapest option. Research validity cost: medium.
3. **Precomputed per-page offline synthesis.** Allow Brown/Freeman pipeline to run offline on a captured page; serve the metamer back to Scrutinizer for display. Not real-time, but scientifically defensible for validation work. Cost: medium.

### P2 — If we pursue L2 (oriented statistics)

- [ ] Extend `pyramid-stats.wgsl` from isotropic Laplacian bands to a 4-orientation × 3-scale steerable pyramid. Memory increases 12×; each per-sector slot balloons.
- [ ] Storage-buffer count will increase again. Plan a bind-group refactor that combines related buffers so we stay under adapter limits even on laptop-class GPUs.
- [ ] Expected benefit: text reconstructs as oriented texture instead of noise. Expected cost: substantial; this is a multi-week effort that risks further destabilizing mode 15.

### P3 — If we pursue L3 (temporal refinement)

- [ ] Iterative refinement across frames when gaze is stable: amortize 5–10 frames of synthesis during fixation to approach Brown's iteration depth. Requires gaze-velocity gating and per-sector seed persistence.
- [ ] Much cheaper than per-frame iteration; produces a plausible "first frame is rough, settles over ~100ms" behavior that may actually match perceptual experience of re-fixation.
- [ ] Expected cost: moderate. Testable against human psychophysics (Freeman & Simoncelli 2011 detection thresholds) rather than Brown-style per-frame SSIM.

### P4 — Ground-truth reframing (parallel to any code work)

- [ ] Short position statement: what pooling assumptions Scrutinizer shares with Brown, Freeman, Blauch, and where it diverges. Scrutinizer is a real-time approximation, not a metamer generator. Brown is one computational ground truth, not the ground truth.
- [ ] Decide whether to chase Brown SSIM at all, or pivot calibration to human psychophysics (metamer detection thresholds — Freeman & Simoncelli 2011, Wallis et al. 2019).
- [ ] All future `compare-brown` output should live inside this frame.

## Kept infrastructure from the 2026-04-17 session

- `scripts/diff-brown-m15.js` — per-pixel luma-diff heatmap with band rings and per-band mean. Useful diagnostic for any future attempt.
- `tests/golden-captures/brown-metamers/manifest.json` — techmeme M15 pointer added; ecommerce/color-spectrum mode0 + mode15 fixtures now captured. Full six-fixture coverage.
- `scripts/capture-golden.js` — ecommerce + color-spectrum now request M15 variants.

## Discarded approaches (do not retry without rethinking)

- Raising `maxStorageBuffersPerShaderStage` and activating sectors naively. Produces noise wedges on white space at parafoveal boundary. Unshippable without L2/L4 work.
- Bolting a tangential Gaussian smear onto `sampleDoGReconstructed` gated by the structure map. Produced a plausibly-shaped smear in isolation but interacted badly with sector compute artifacts; the 7-tap kernel was still visibly too long even after capping step size and blend weight.
- Tuning SSIM on mode 15 before visual verification. `compare-brown` numbers can improve while output becomes visibly unshippable. Always visual-first.

## Open questions

- Is single-pass mode 15 worth pursuing at all, or does the research contribution actually live in the MIP/DoG acuity path + honest framing?
- What's the minimum oriented-statistics configuration that makes text reconstruction perceptually acceptable rather than noise?
- Can temporal refinement get us real-time-enough behavior without claiming per-frame metamer synthesis?
- Who is the right peer reviewer for the framing choice (Rosenholtz, Blauch, Duchowski)?
