# Wave 1: Color Search Validation Report

Generated: 2026-03-17
Parameters: rg_decay=0.085, yv_decay=0.014, supra=0.5
Geometry: fovea_radius=45px, ppd=45

## Tier 1: Must Pass

- [PASS] red composite retention monotonically decreases: 73.9% > 57.0% > 48.1% > 41.6% > 37.0%
- [PASS] green composite retention monotonically decreases: 78.5% > 64.5% > 57.0% > 51.5% > 47.4%
- [PASS] blue composite retention monotonically decreases: 91.6% > 84.4% > 79.5% > 75.1% > 71.4%
- [PASS] yellow composite retention monotonically decreases: 91.0% > 83.5% > 78.5% > 74.2% > 70.4%
- [PASS] BY retention >= 1.5x RG at ring 5: blue=71.4% / red=37.0% = 1.93x
- [PASS] red measured retention monotonically decreases
- [PASS] green measured retention monotonically decreases
- [PASS] blue measured retention monotonically decreases
- [PASS] yellow measured retention monotonically decreases

## Tier 2: Should Pass

- [PASS] BY/RG channel ratio vs Bowers (ring 5, 12.44°): model=2.82 (yv/rg retention) vs Bowers=2.72 at 15° (4% off, threshold=20%)
- [PASS] Green closer to red than blue: green-red gap=10.4pp, green-blue gap=24.0pp (threshold: <15pp and closer to red)
- [FAIL] Rendered matches model within 15%: 10/20 (50%)

## Tier 3: Stretch

- [PASS] red model retention correlates with Hansen naming accuracy: r=1.000 (threshold: r>0.8)
- [PASS] blue model retention correlates with Hansen naming accuracy: r=1.000 (threshold: r>0.8)
- [PASS] BY always ranks above RG per ring: 20/20 correct (100%, threshold: >=90%)

## Summary

| Tier | Passed | Total | Status |
|------|--------|-------|--------|
| Tier 1 (must) | 9 | 9 | ALL PASS |
| Tier 2 (should) | 2 | 3 | 2 pass |
| Tier 3 (stretch) | 3 | 3 | ALL PASS |
