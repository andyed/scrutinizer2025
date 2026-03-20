# Empirical Claims Verification Checklist

Generated 2026-03-19. Every claim below attributes a specific finding or number to an external paper. Claims are sorted by risk — LOW confidence items need verification most urgently.

**Status key:** `[ ]` unverified, `[x]` verified correct, `[!]` verified WRONG, `[~]` partially correct (needs rewording)

---

## URGENT — Likely Wrong or Unverifiable

### Curcio photoreceptor count (Introduction)
- [x] "The retina compresses ~10^7 photoreceptor signals into ~10^6 optic nerve fibers (Curcio 1990)"
- **Problem:** Human retina has ~100-130M photoreceptors (~10^8), not ~10^7. Off by an order of magnitude.
- **FIXED:** Changed to "~130 million photoreceptor signals into ~1.2 million optic nerve fibers"

### Queen (2006) icon search (Applications)
- [x] "desktop icons with distinct low-spatial-frequency silhouettes are identified ~0.5 s faster in visual search (N=20, target-among-distractors task)"
- **Problem:** Article confirmed real (Boxes and Arrows blog). 0.5s finding is real. But N=10 users (not 20) — there were 20 trial images. Task was match-to-sample, not target-among-distractors.
- **FIXED:** Changed to "match-to-sample task (N=10, 20 trial images)"

### Hershler & Hochstein (2005) face pop-out (Saliency)
- [ ] "faces capture attention pre-attentively"
- **Problem:** Contested finding. VanRullen (2006) argued the "pop-out" was driven by low-level features (amplitude spectrum), not face-specific processing. Stating as established fact is risky.
- **Action:** Add nuance or cite the debate.

### Kuffler (1953) as DoG source (Architecture Table 2)
- [x] "Retinal GC → DoG via MIP chain (Kuffler 1953)"
- **Problem:** Kuffler discovered center-surround. DoG *model* came from Rodieck (1965).
- **FIXED:** Table 2 now cites both Kuffler 1953 and Rodieck 1965. Added Rodieck to references.bib.

---

## HIGH PRIORITY — Specific Numbers to Verify

### Mullen (2002) RG/BY ratio (Chromatic Decay)
- [ ] "red-green (L-M) sensitivity declines 4-5x faster than blue-yellow (S-(L+M))"
- **Risk:** Direction is correct (well-established). The specific 4-5x ratio is the question. Mullen & Kingdom 2002 may state a different ratio or frame it differently.

### Bowers (2025) decay parameters
- [ ] `rg_decay=0.085`, `yv_decay=0.014` calibrated from Bowers 2025
- [ ] "red-green sensitivity decline slows beyond ~40 degrees"
- **Risk:** Recent paper, specific numerical constants. Verify paper is published and these numbers are actually in it. The 40-degree inflection point is a specific claim.

### Jiang (2022) suprathreshold exponent (Open Problems)
- [ ] "power-law exponent 0.5" for suprathreshold luminance contrast correction
- **Risk:** 0.5 is suspiciously round. May be a range or context-dependent value in the actual paper.

### Blauch (2026) a=2.78
- [ ] "M(r) = 1/(r+a), a=2.78 degrees"
- **Risk:** Preprint parameter. Verify against current arxiv version (2602.03766). Value may have changed between revisions.

### Walton (2021) implementation details (Introduction)
- [ ] "real-time ventral metamers via smooth moments of steerable filter responses on GPU compute shaders... required CUDA/DirectX compute"
- **Risk:** Technical characterization of their method could be inaccurate. Verify: was it specifically "smooth moments of steerable filter responses"? Was it CUDA/DirectX specifically?

---

## MEDIUM PRIORITY — Should Verify

### McAlonan (2008) LGN gain (Architecture)
- [ ] "spatial attention enhances LGN gain at attended locations"
- **Risk:** McAlonan et al. 2008 studied attentional modulation in macaque LGN. "Enhances gain" is one interpretation — the paper may show suppression of unattended rather than (or in addition to) enhancement.

### Bouma (1970) proportionality constant
- [ ] "critical spacing scales linearly with eccentricity at ~0.5x"
- **Risk:** Bouma's original approximation. Actual values range 0.3-0.5 depending on conditions. ~0.5x is defensible but could be more precise.

### Toet & Levi (1992) crowding aspect ratio
- [ ] "radially-elongated interaction zones with ~2:1 aspect ratio"
- **Risk:** Commonly cited ratio but approximate. Some studies report different ratios.

### Dacey (1993) receptive field growth
- [ ] "ganglion cell receptive fields growing with eccentricity"
- **Risk:** Dacey 1993 studied midget/parasol morphology in macaque, which does show dendritic field size increasing. Correct direction — verify it's the right canonical cite.

### Portilla-Simoncelli timing (Introduction)
- [ ] "full Portilla-Simoncelli texture synthesis remains iterative (~seconds per frame)"
- **Risk:** "Iterative" is correct. "~seconds per frame" is vague and hardware-dependent. May want to specify image size or cite a benchmark.

### SNIF-ACT mechanism (Architecture)
- [x] "spreading activation between user goals and link text"
- **Problem:** SNIF-ACT uses cosine similarity of word vectors, not ACT-R spreading activation.
- **FIXED:** Changed to "cosine similarity between goal and link-text word vectors", "production system" instead of "declarative memory".

### Itti & Koch year (Saliency)
- [ ] Cited as Itti & Koch (2001)
- **Risk:** The computational model was Itti, Koch & Niebur (1998). The 2001 paper is a review/perspective. If citing the model, 1998 is more appropriate.

---

## LOW PRIORITY — Likely Correct (Textbook Level)

- [ ] Rovamo & Virsu (1979) — M-scaling. Canonical.
- [ ] Pelli & Tillman (2008) — crowding as binding failure. Canonical.
- [ ] Sherman & Guillery (2002) — LGN gating. Canonical.
- [ ] Freeman & Simoncelli (2011) — summary statistics in peripheral vision. Canonical.
- [ ] Rosenholtz et al. (2012) — TTM / texture synthesis mongrels. Canonical.

---

## Code Comments & Specs

### LOW — Verify Against Source

- [ ] `peripheral.frag:724` — "Bowers (2025): at 15 deg, RG approx 29%, YV approx 79%." Used to derive `rg_decay=0.072` (shader) or `0.085` (spec). **Also:** shader and spec disagree on the decay constant.
- [ ] `peripheral.frag:64` — "Jiang, Shooner & Mullen (2022) power-law exponent ~0.5." Paper (PMC9639675) reports 0.5-0.63 for RG — using 0.5 for all channels is a simplification.
- [ ] `chromatic_pooling.md:88-91` — castleCSF parameters: RG k_e=0.059, YV k_e=0.004, Achromatic k_e=0.024. Need verification against Ashraf et al. (2024) doi:10.1167/jov.24.4.5.
- [ ] `scanpath-replay-spec.md:236` — "duration_ms = 2.2 x amplitude_deg + 21" from Bahill et al. (1975). Coefficients need verification — Bahill focused on peak velocity, duration formula may be secondary derivation.
- [ ] `scanpath-replay-spec.md:245` — "peak_vel approx amplitude_deg x 500 deg/s." Oversimplification of main sequence — saturates for saccades >20 deg.
- [ ] `peripheral.frag:1495-1503` — "RG caps at 70%; YV caps at 35%." Attributed to Jiang/Hansen but these appear to be implementation choices, not directly reported values.
- [ ] `oblique_effect_validation.md:48` — "0 deg (fovea): 30-50% cardinal advantage (Appelle 1972)." Appelle is a review — some studies report 15-20% for contrast sensitivity. Range may be overstated.
- [ ] `oblique_effect_validation.md:27` — "Barbot et al. (2021, eLife): HVA is 20-120% at 6 deg." Very wide range — verify conditions that produce extremes.
- [ ] `peripheral.frag:418` — "Bowers (2025) biphasic RG decay — steep to ~15 deg then slowing." "Biphasic" is an interpretation — verify if paper uses this term.
- [ ] `chromatic_pooling.md:69-74` — Abramov, Gordon & Chan (1991): "fovea-like color to 20 degrees with large stimuli; largest stimuli fail at 40 degrees." Specific boundaries need verification.
- [ ] `applied_ui_saliency_validation.md:45` — "Halverson & Hornof (2011): text within 1 deg, color within 7.5 deg." These may be EPIC model parameters, not empirical findings.
- [ ] `applied_ui_saliency_validation.md:46` — "Mairena et al. (2019): Peripheral notification detection up to 62 deg." Very specific number.

### MEDIUM — Should Verify

- [ ] `peripheral.frag:1747` — "Rayner (1998): Perceptual span ~1.3 deg left, ~5 deg right." Degree values depend on viewing distance/font. More commonly reported in character units (3-4 left, 14-15 right).
- [ ] `chromatic_pooling.md:47-48` — "1:1 midget wiring only exists in fovea." Standard model but overstated — private-line wiring extends to 5-8 deg, collapse is gradual.
- [ ] `brown_dataflow_integration.md:200` — "Brown et al. (2023) use 0.75 as Bouma constant." Verify against doi:10.1145/3564605.

### Issues Found

- [!] **Missing citation:** `oblique_effect_validation.md:28` — "PNAS MT cortex data: 10.1% more cortical space for cardinal orientations in central MT, only 3.6% in peripheral MT." No author or year. Needs proper citation or removal.
- [!] **Internal inconsistency:** `u_rg_decay` is 0.072 in shader (line 70) but 0.085 in spec. The Bowers attribution covers both but they can't both be correct.
- [!] **Internal inconsistency:** Oblique effect fade is "~10 deg" in shader (line 345) but "8-18 deg" in spec (oblique_effect_validation.md:25).
- [!] **Already caught fabrication:** `density_gated_crowding.md:141` — "Zhang et al. 2015" was fabricated. Corrected to Pelli, Palomares & Majaj (2004).

---

## Process Notes

- Claims sourced from Claude's training data (not from a WebFetch during development) are higher risk
- The research log (`~/Documents/dev/research-log.jsonl`) can identify which papers were actually fetched/read during development
- Cross-reference against research log to identify which citations have URL provenance
