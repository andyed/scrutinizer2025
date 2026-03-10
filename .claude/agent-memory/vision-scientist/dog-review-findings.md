# DoG Band Decomposition Review (2026-02-27)

## Files Reviewed
- `/Users/andyed/Documents/dev/scrutinizer-repo/scrutinizer2025/docs/foveated-vision-model.md` (Section 5.1)
- `/Users/andyed/Documents/dev/scrutinizer-repo/scrutinizer2025/renderer/shaders/peripheral.frag` (sampleDoGReconstructed, lines 92-141)

## Key Issues

### 1. MIP chain != Gaussian pyramid
Doc claims hardware MIP is "already a Gaussian pyramid." It's box/bilinear filtered. Band differences are "Difference of Boxes" not true DoG.
- Ref: Burt & Adelson (1983) for true Laplacian pyramid
- Practical impact: muddier band isolation, spectral leakage, but qualitative result is OK

### 2. M-scaling progression
Shader uses geometric 2x progression (0.3, 0.6, 1.2, 2.4 * E2).
Biology predicts approximately linear growth: s_min(e) ~ s_0 * (1 + e/E_2).
- Ref: Rovamo & Virsu (1979), Levi, Klein & Aitsebaomo (1985), Watson (2014)
- Current implementation over-predicts resolution loss near fixation

### 3. E2 coordinate space mismatch
Literature E2 is in degrees of visual angle. Shader E2 is in normalized screen coordinates (eccentricity/fovea_radius).
Published E2 values: ~0.7-0.8 deg (Vernier), ~2.5 deg (grating acuity).
Shader defaults: 2.0-2.5 in normalized units -- incommensurable.

### 4. coupledEccentricity cancellation
processV4 passes coupledEccentricity = distortionStrength * intensity * fovea_radius * blurMult
sampleDoGReconstructed divides by fovea_radius -> normEcc = distortionStrength * intensity * blurMult
This means DoG is attention-gated, not purely position-dependent. Diverges from biology (RF size is fixed by retinal position).

### 5. Negative band values
mip0 - mip1 can be negative. Selective band attenuation (w < 1.0) + residual may produce out-of-range values.
No clamping before output. Could cause subtle color artifacts.

## Key References
- Rodieck (1965): DoG model for cat ganglion cells
- Enroth-Cugell & Robson (1966): X-cell linearity, DoG confirmation
- Burt & Adelson (1983): Laplacian pyramid
- Rovamo & Virsu (1979): Cortical magnification
- Levi, Klein & Aitsebaomo (1985): E2 formalization
- Watson (2014): Retinal ganglion cell density formula
- Sanes & Masland (2015): ~20+ RGC types in primates
- Pelli (2008): Crowding and V1
