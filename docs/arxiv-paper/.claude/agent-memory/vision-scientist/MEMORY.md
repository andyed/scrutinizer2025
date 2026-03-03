# Vision Scientist Agent Memory

## Scrutinizer Codebase Facts (verified 2026-03-01)
- Active shader: `peripheral2.frag` (946 lines), loaded by webgl-renderer.js line 44
- Legacy shader: `peripheral.frag` (1157 lines) -- NOT used, does NOT contain DoG bands
- peripheral2.frag has 34 uniforms (including 4 samplers), peripheral.frag has 28
- DoG band decomposition, FOVI CMF, and Gaussian color decay are ONLY in peripheral2.frag
- FOVI equation in shader: `log2((r_deg + a) / a)` which equals `log2(1 + e/a)` -- correct
- Unit tests: 3 test files, ~110 test cases total (43+35+32), NOT 138
- 23 JS modules in renderer/, not 4
- Chromatic aberration: simple horizontal R/B offset, not biologically parameterized
- Crowding: simplex noise domain warping + grid scramble, NOT Portilla-Simoncelli texture statistics

## Key Citation Issues Found
- Sherman & Guillery 2002: "~90% modulatory" needs verification -- they discuss driver vs modulator
- Livingstone & Hubel 1988 cited for "M/P asynchrony" re: chromatic aberration -- loose mapping
- Rosenholtz 2012 cited for crowding model, but implementation is noise not summary statistics
- Curcio 1990 + Dacey 1993 cited for peripheral encoding -- Curcio is about photoreceptors, not about filtering per se

## Biological Mapping Issues
- LGN "gating" via saliency is defensible but represents top-down attention modulation, not LGN relay function
- V4 label for color processing is simplified -- V4 does much more than color
- "Rod dominance" claim for peripheral desaturation conflates photopic and mesopic/scotopic conditions
