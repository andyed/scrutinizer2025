# Specification: Semantic Guidance & Linguistic Priming Layer (v3)

> [!NOTE]
> **Version 3.0** — Rewritten to align with the current Scrutinizer architecture (v2.1+). Replaces v2 spec. Grounded in existing pipeline components: `dom-adapter.js`, `saliency-worker.js`, `peripheral2.frag`, and the declarative mode registry.

> [!IMPORTANT]
> **Implementation Status: PLANNED**
>
> - [ ] Transformers.js v3 integration (model loading + Web Worker)
> - [ ] Goal embedding pipeline (user intent → vector)
> - [ ] Content embedding pipeline (DOM text nodes → vectors)
> - [ ] Scent texture channel in saliency worker output
> - [ ] Legibility gating in scent computation
> - [ ] Exploration/exploitation controller
> - [ ] Scent map overlay mode
> - [ ] Icon/symbol dictionary
> - [ ] `scent_gated` mode in `modes.json`
>
> **No external dependencies.** Runs entirely within Electron — no servers, no Qdrant, no external embedding APIs.

---

## 1. Executive Summary

This feature adds **top-down attentional control** to the Scrutinizer pipeline. A user-specified goal ("find the price", "check return policy") is embedded into a vector, compared against the text content of every DOM element the existing `dom-adapter.js` already extracts, and the resulting cosine similarity scores are painted into the saliency texture that the shader already consumes. High-scent regions receive saliency protection; low-scent regions degrade normally.

The integration touches two existing branch points:
- **Branch point #2 (Saliency):** Scent scores are blended into the R channel of `u_saliencyMap` (TEXTURE3).
- **Branch point #4 (Structure):** `dom-adapter.js` already harvests text nodes with bounding rects — we extend its output with semantic scores rather than building a parallel extraction pipeline.

No shader modifications are required. The scent signal enters through the same saliency gating path that already protects faces and luminance singletons.

---

## 2. User Experience

### 2.1 Goal Input

A text field in the toolbar (or a keyboard shortcut) accepts a free-text goal string. The goal is embedded once and cached until changed. An empty goal disables semantic guidance (pure bottom-up saliency).

### 2.2 Preset Intents

Quick-select menu of pre-embedded goal vectors:

| Label | Goal String | Behavior |
|-------|-------------|----------|
| **Just Browsing** | *(empty)* | $\beta_{semantic} = 0$. Bottom-up only. |
| **Find Item** | User-typed keywords | High $\beta_{semantic}$. Narrow search. |
| **Validate Trust** | "reviews, verified, secure, privacy, contact" | Skeptical scrutiny. |
| **Transact** | "buy, price, checkout, add to cart, sign up" | Action-oriented. |
| **Learn** | "specs, features, documentation, how-to, details" | Research mode. |

Presets are stored as pre-computed 384-dim Float32Arrays in a JSON file, regenerated at build time.

---

## 3. Scientific Basis

### 3.1 Information Scent (Pirolli & Card, 1999)

Users follow linguistic cues that estimate the probability of finding valuable information. This layer quantifies scent as cosine similarity between goal and content embeddings, then feeds it into the same LGN gating path that already modulates peripheral degradation.

### 3.2 Guided Search (Wolfe, 1994)

Attention combines bottom-up (visual) and top-down (task) activation:

$$A_{total} = \alpha \cdot A_{visual} + \beta \cdot A_{semantic}$$

The $\alpha / \beta$ balance is dynamic (Section 5.3).

### 3.3 Eccentricity-Semantics Interaction

A semantic match is irrelevant if the text is unreadable at that eccentricity. The scent score must be gated by legibility — the same $E_2$-based resolution model the shader already uses for band cutoffs (Section 5.2).

> **The "Eagle Eye" Fallacy.** A word matching the goal does not generate saliency if the visual system cannot resolve its letters at that eccentricity. Semantic signal must be gated by legibility. This forces the simulation to make exploratory saccades toward candidate regions before confirming a match — which is what humans actually do.

### 3.4 Parafoveal Preview (Rayner, 1998)

Readers process word length and partial shape parafoveally before fixating. We model this by allowing partial scent signal (attenuated, not zeroed) at eccentricities where word shape but not letter identity is available — the zone between the crowding boundary and the acuity limit.

---

## 4. Technical Architecture

### 4.1 Embedding Engine: Transformers.js v3

Self-contained, ships with Scrutinizer. No external servers.

| Property | Value |
|----------|-------|
| **Library** | `@huggingface/transformers` v3 |
| **Model** | `Xenova/all-MiniLM-L6-v2` (384-dim) |
| **Format** | ONNX quantized (int8, ~23 MB) |
| **Runtime** | ONNX Runtime Web (WebGPU → WASM fallback) |
| **Execution** | Dedicated Web Worker (`scent-worker.js`) |
| **Caching** | Cache API — downloaded once, persisted across sessions |
| **Cold start** | ~2s (cached), ~8s (first download on fast connection) |

Why this model: 384 dimensions is sufficient for short UI text strings. Larger models (gte-large, mxbai-embed-large) improve accuracy on paragraphs but are oversized for button labels and menu items. The 23 MB footprint is comparable to face-api.js models already shipped.

### 4.2 Worker Architecture

A new `scent-worker.js` runs alongside the existing `saliency-worker.js`. They communicate through the main thread's texture compositor.

```
                ┌─────────────────────┐
  Goal string → │   scent-worker.js   │ → scent scores (per-block Float32)
  DOM blocks  → │  (Transformers.js)  │
                └─────────────────────┘
                           │
                           ▼
                ┌─────────────────────┐
  Frame pixels →│ saliency-worker.js  │ → RGBA texture (256px)
                │  (DoG + face + FC)  │   R: saliency (now includes scent)
                └─────────────────────┘   G: congestion
                           │              B: edge density
                           ▼              A: 255
                    u_saliencyMap
                     (TEXTURE3)
                           │
                           ▼
                  peripheral2.frag
                  (LGN saliency gate)
```

### 4.3 Integration with Existing Components

**`dom-adapter.js` (branch point #4)** already produces:
```javascript
{ x, y, w, h, type, density, lineHeight, saliency, text? }
```

Currently `saliency` is hardcoded to 1.0 for all blocks. The integration:
1. Extend `dom-adapter.js` to include `text` content in its StructureBlock output (it already walks text nodes via TreeWalker — the text is available, just not exported).
2. Pass blocks with text to `scent-worker.js` for embedding.
3. Scent worker returns per-block scores.
4. `dom-adapter.js` writes scent scores into the `saliency` field of each block.
5. `saliency-worker.js` reads these scores when painting the R channel — scent-bearing blocks get boosted saliency.

**No new shader uniforms.** The scent signal enters through `u_saliencyMap` R channel, which the LGN saliency gate (`u_lgn_use_saliency_gate`) already reads. High-scent regions are protected; low-scent regions degrade normally.

**No new texture slots.** TEXTURE0–4 are all occupied. Scent is blended into the existing saliency texture before upload.

---

## 5. Pipeline Logic

### 5.1 Embedding Pipeline

Runs in `scent-worker.js`:

**On goal change:**
1. Tokenize goal string.
2. Run inference → $\vec{G}$ (1 × 384 Float32Array).
3. Cache $\vec{G}$ until next change.

**On DOM update** (triggered by `dom-adapter.js`, debounced 500 ms):
1. Receive StructureBlocks with text content.
2. Deduplicate text strings (many blocks share identical labels).
3. Batch embed unique strings → $\vec{C}_i$ (N × 384 matrix).
4. Compute cosine similarity: $S_i = \max(0, \cos(\vec{G}, \vec{C}_i))$.
5. Apply legibility gating (Section 5.2).
6. Apply exploration/exploitation weighting (Section 5.3).
7. Return per-block scent scores to main thread.

**Cadence:** Embeddings are recomputed when DOM changes (MutationObserver, 500 ms debounce) or viewport scrolls (IntersectionObserver). The goal vector is computed once. Cosine similarity is O(N × 384) — negligible compared to inference.

**Vector cache:** A `Map<string, Float32Array>` keyed on text content. Survives across DOM updates. Cleared on page navigation. Typical page has 50–200 unique text strings; cache prevents re-embedding unchanged content.

### 5.2 Legibility Gating

The scent score is modulated by whether the text is legible at its current eccentricity from gaze:

```javascript
const ecc = distanceFromGaze(block.rect, gazePoint);  // pixels → degrees
const minSize = E2_FONT_THRESHOLD * (1 + ecc / E2);   // M-scaling
const legibility = sigmoid((block.fontSize - minSize) / 4);
const S_effective = S_sem * legibility;
```

This uses the same $E_2$ (half-resolution eccentricity) parameter the shader uses for band cutoffs. At eccentricities where letters are irresolvable, scent drops to zero regardless of semantic match. Between the crowding boundary and the acuity limit, partial scent leaks through — modeling parafoveal word-shape processing.

**Gaze dependency:** Legibility gating makes scent scores gaze-contingent. When gaze moves, the legibility multiplier changes for every block. Recomputation is cheap (no re-embedding, just distance + sigmoid per block) and piggybacks on the existing gaze update loop.

### 5.3 Exploration / Exploitation Controller

Static $\alpha / \beta$ mixing feels robotic. Instead, the blend adapts to scent strength:

| State | Condition | Behavior |
|-------|-----------|----------|
| **Exploration** | $\max(S_{sem})$ across viewport is low | No strong scent. Boost bottom-up saliency. User is scanning. |
| **Exploitation** | $\max(S_{sem})$ is high | Strong scent. Suppress bottom-up saliency. User is locked on. |

$$\beta = \sigma(\max(S_{sem}) - k)$$
$$\alpha = 1.0 - \beta$$

Where $k$ is a threshold (default 0.4, tunable). The final saliency value per pixel blends bottom-up and semantic:

$$R_{pixel} = \alpha \cdot V_{bottomup} + \beta \cdot S_{effective}$$

This is computed in `saliency-worker.js` when painting the R channel, not in the shader.

### 5.4 Icon / Symbol Dictionary

`dom-adapter.js` already classifies elements by type (text=1.0, media=0.5, interactive=0.0). For interactive elements without visible text, a lightweight dictionary maps icon class patterns to semantic keywords before embedding:

| Pattern | Injected Text |
|---------|---------------|
| `cart`, `basket`, `shopping` | "Shopping Cart" |
| `search`, `magnify` | "Search" |
| `menu`, `hamburger`, `bars` | "Navigation Menu" |
| `user`, `account`, `profile` | "Account" |
| `heart`, `favorite`, `wishlist` | "Favorites" |
| `close`, `dismiss`, `×` | "Close" |

Implementation: regex scan on `className`, `aria-label`, `title`, and `alt` attributes. Runs during DOM extraction, before embedding. Extensible via JSON config.

---

## 6. Mode Registry Integration

Add a `scent_gated` mode to `shared/modes.json`:

```json
{
  "name": "scent_gated",
  "id": 10,
  "label": "Scent-Gated",
  "description": "Semantic saliency: goal-relevant content is protected, irrelevant content degrades",
  "lgn_use_structure_mask": true,
  "lgn_use_saliency_gate": true,
  "enable_saliency_modulation": 1.0,
  "scent_enabled": true,
  "scent_exploration_threshold": 0.4,
  "v1_distortion_type": 0,
  ...
}
```

The `scent_enabled` flag tells the main thread to start `scent-worker.js` and route DOM text to it. All other pipeline parameters (DoG bands, chromatic pooling, crowding) remain independent — scent only modulates the saliency channel.

Zero shader changes. The mode registry is the configuration interface (branch point #5).

---

## 7. Visualization

### 7.1 Scent Map Overlay

A toggleable overlay (like the existing congestion heatmap, `u_show_congestion`) renders only the semantic saliency channel. High-scent regions glow warm; low-scent regions are dark.

Implementation: reuse the congestion overlay rendering path with a different color ramp. The scent scores are already in the saliency texture R channel; the overlay just needs a uniform to select the display source.

### 7.2 Distractor Analysis

Elements with high bottom-up saliency ($V > 0.7$) but low semantic scent ($S < 0.2$) are flagged as distractors. Rendered as a sidebar list or DOM overlay:

> "The 'Sign Up' banner is visually dominant ($V=0.9$) but irrelevant to the 'Checkout' goal ($S=0.1$). **Distractor.**"

This is a design audit output — useful in `scrutinizer-audit` CLI headless mode.

### 7.3 Stats HUD Integration

The existing ComplexityHUD (Score/Facts/Spatial/Breakdowns tabs) gains a "Scent" tab showing:
- Goal string
- Top 5 scent-bearing elements (text + score)
- Top 3 distractors
- Exploration/exploitation state

---

## 8. CLI / MCP Integration

`scrutinizer-audit` gains a `--goal` flag:

```bash
scrutinizer-audit https://example.com --goal "find the price" --viewport desktop
```

Output includes scent scores per visible element, distractor list, and an aggregate "scent coverage" metric (fraction of viewport area covered by high-scent elements). The MCP server exposes the same via a `semantic_audit` tool.

---

## 9. Performance Budget

| Operation | Frequency | Cost | Thread |
|-----------|-----------|------|--------|
| Goal embedding | On change | ~50 ms | scent-worker |
| Content embedding (50 strings) | On DOM change (500 ms debounce) | ~200 ms | scent-worker |
| Cosine similarity (50 blocks) | On DOM change | < 1 ms | scent-worker |
| Legibility gating (50 blocks) | On gaze move (every frame) | < 0.1 ms | main |
| Texture painting | Every 15th frame | Absorbed into existing saliency paint | saliency-worker |

Model inference is the bottleneck. At ~4 ms/string (WebGPU) or ~15 ms/string (WASM), a 50-element page takes 200–750 ms. This is acceptable because:
- Embeddings are cached and only recomputed on DOM change.
- The scent texture updates asynchronously; the shader always has a valid (possibly stale) saliency map.
- Cold start (model load) is ~2s cached, amortized across the session.

---

## 10. Dependencies

| Package | Version | Size | Purpose |
|---------|---------|------|---------|
| `@huggingface/transformers` | ^3.0 | ~2 MB (code) | Inference runtime |
| `all-MiniLM-L6-v2` (ONNX int8) | — | ~23 MB (model) | Sentence embeddings |

No external servers. No database. Model is downloaded once from Hugging Face CDN and cached via Cache API. Fully offline after first load.

---

## 11. Open Questions

1. **Model size vs. accuracy.** all-MiniLM-L6-v2 (384-dim, 23 MB) is the safe choice. `gte-small` and `bge-small-en-v1.5` are newer and may perform better on short UI strings. Needs benchmarking on actual web page text.

2. **Multilingual.** MiniLM is English-only. For multilingual support, `paraphrase-multilingual-MiniLM-L12-v2` (471 MB) is too large. `multilingual-e5-small` (118 MB) is feasible but increases cold start. Defer until demand.

3. **Priming / frequency boost.** v2 spec proposed boosting repeated terms ($B_{freq} = \ln(1 + \text{count}) \cdot k$). This is biologically motivated (repetition priming lowers recognition thresholds) but adds complexity. Defer to post-MVP.

4. **Scent decay over time.** Once a user fixates a high-scent element and presumably reads it, should its scent decay? This models "information consumed" vs. "information available." Biologically interesting, unclear if useful for design audit.

---

## 12. References

1. **Pirolli, P., & Card, S.** (1999). Information Foraging. *Psychological Review*, 106(4), 643–675.
2. **Wolfe, J. M.** (1994). Guided Search 2.0. *Psychonomic Bulletin & Review*, 1(2), 202–238.
3. **Yarbus, A. L.** (1967). *Eye Movements and Vision*. Plenum Press.
4. **Rayner, K.** (1998). Eye movements in reading and information processing. *Psychological Bulletin*, 124(3), 372–422.
5. **Fu, W.-T., & Pirolli, P.** (2007). SNIF-ACT: A cognitive model of user navigation on the WWW. *Human–Computer Interaction*, 22(4), 355–412.
6. **Hugging Face.** (2024). Transformers.js v3 documentation. https://huggingface.co/docs/transformers.js
