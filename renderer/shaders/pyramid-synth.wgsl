// pyramid-synth.wgsl — Tier 2.75 Multi-Scale Texture Synthesis
//
// Generates a mongrel texture from per-tile cross-scale statistics.
// Each pixel gets its tile's target statistics; synthesis produces noise
// that matches those statistics at multiple spatial frequency bands.
//
// Two entry points:
//   1. seed_noise     — Generate deterministic white noise per band
//   2. match_stats    — Iteratively adjust noise to match target statistics
//                       (magnitude, cross-scale correlation, variance)
//   3. reconstruct    — Sum adjusted bands + residual → output RGBA
//
// The key operation is cross-scale correlation injection (step 2):
//   For each parent-child pair (k, k+1), adjust child magnitude
//   conditioned on parent magnitude and target correlation.
//   High correlation + strong parent → boost child (preserves edges).
//   Low correlation → leave independent (noise stays noise).
//
// References:
//   Burt & Adelson (1983) — Laplacian pyramid (our decomposition basis)
//   Walton et al. (2021) — real-time ventral metamers (we approximate with
//       variance scaling, not their full histogram matching on steerable pyramids)
//   Rosenholtz et al. (2012) — TTM theory motivates the approach; our isotropic
//       subset captures cross-scale structure but not orientation selectivity

// ─── Config ───

struct SynthConfig {
    width: u32,           // band_0 / output width
    height: u32,          // band_0 / output height
    tile_size: u32,
    tile_count_x: u32,
    tile_count_y: u32,
    num_bands: u32,       // 4
    iteration: u32,       // current iteration (0-2)
    frame_seed: u32,      // per-frame seed for temporal stability
    fovea_x: f32,         // gaze position (normalized 0-1)
    fovea_y: f32,
    fovea_radius: f32,    // in pixels
    blend_start: f32,     // eccentricity where synthesis begins blending in
    blend_end: f32,       // eccentricity where synthesis is fully opaque
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

// Must match pyramid-stats.wgsl TileStatsTier3
struct TileStatsTier3 {
    mag0: f32, mag1: f32, mag2: f32, mag3: f32,
    var0: f32, var1: f32, var2: f32, var3: f32,
    corr01: f32, corr12: f32, corr23: f32,
    mean_L: f32, mean_a: f32, mean_b: f32,
    skew0: f32, skew1: f32, skew2: f32, skew3: f32,
};

const STATS_STRIDE: u32 = 14u;

// ─── Hash functions for deterministic noise ───

fn pcg_hash(input: u32) -> u32 {
    let state = input * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

fn hash_to_float(h: u32) -> f32 {
    return f32(h) / 4294967295.0;  // [0, 1]
}

fn noise_at(x: u32, y: u32, band: u32, seed: u32) -> f32 {
    // Deterministic noise: position + band + seed → [-1, 1]
    let h = pcg_hash(x + pcg_hash(y + pcg_hash(band + pcg_hash(seed))));
    return hash_to_float(h) * 2.0 - 1.0;
}

// ─── Entry point 1: Seed noise bands ───

@group(0) @binding(0) var<uniform> config: SynthConfig;
@group(0) @binding(1) var<storage, read_write> noise0: array<f32>;
@group(0) @binding(2) var<storage, read_write> noise1: array<f32>;
@group(0) @binding(3) var<storage, read_write> noise2: array<f32>;
@group(0) @binding(4) var<storage, read_write> noise3: array<f32>;

@compute @workgroup_size(16, 16)
fn seed_noise(
    @builtin(global_invocation_id) gid: vec3<u32>,
) {
    let x = gid.x;
    let y = gid.y;
    if (x >= config.width || y >= config.height) { return; }

    let seed = config.frame_seed;
    let idx = y * config.width + x;

    // Isotropic noise at each band's spatial frequency.
    // Sum 4 rotated sine gratings (0°, 45°, 90°, 135°) per band — cancels
    // orientation bias. Per-pixel phase jitter breaks spatial regularity.
    let px = vec2<f32>(f32(x), f32(y));

    // Band-specific frequencies (wavelength doubles per octave)
    let freq0 = 1.57;   // ~4px wavelength (high freq)
    let freq1 = 0.785;  // ~8px
    let freq2 = 0.393;  // ~16px
    let freq3 = 0.196;  // ~32px (low freq)

    // Per-pixel phase offsets from hash (different per band)
    let ph0 = noise_at(x, y, 10u, seed) * 6.283;
    let ph1 = noise_at(x, y, 11u, seed) * 6.283;
    let ph2 = noise_at(x, y, 12u, seed) * 6.283;
    let ph3 = noise_at(x, y, 13u, seed) * 6.283;

    // 4-orientation sum: 0°, 45°, 90°, 135° — isotropic
    let d45x = 0.7071;  // cos(45°)
    let d45y = 0.7071;  // sin(45°)

    noise0[idx] = 0.5 * (
        sin(px.x * freq0 + ph0) +
        sin(px.y * freq0 + ph0 * 1.3) +
        sin((px.x * d45x + px.y * d45y) * freq0 + ph0 * 0.7) +
        sin((px.x * d45x - px.y * d45y) * freq0 + ph0 * 1.7)
    );

    noise1[idx] = 0.5 * (
        sin(px.x * freq1 + ph1) +
        sin(px.y * freq1 + ph1 * 1.3) +
        sin((px.x * d45x + px.y * d45y) * freq1 + ph1 * 0.7) +
        sin((px.x * d45x - px.y * d45y) * freq1 + ph1 * 1.7)
    );

    noise2[idx] = 0.5 * (
        sin(px.x * freq2 + ph2) +
        sin(px.y * freq2 + ph2 * 1.3) +
        sin((px.x * d45x + px.y * d45y) * freq2 + ph2 * 0.7) +
        sin((px.x * d45x - px.y * d45y) * freq2 + ph2 * 1.7)
    );

    noise3[idx] = 0.5 * (
        sin(px.x * freq3 + ph3) +
        sin(px.y * freq3 + ph3 * 1.3) +
        sin((px.x * d45x + px.y * d45y) * freq3 + ph3 * 0.7) +
        sin((px.x * d45x - px.y * d45y) * freq3 + ph3 * 1.7)
    );
}

// ─── Entry point 2: Match statistics (one iteration) ───
//
// For each pixel:
//   1. Look up tile stats
//   2. Scale noise magnitude to match target per-band magnitude
//   3. Inject cross-scale correlation: adjust child based on parent

@group(0) @binding(0) var<uniform> ms_config: SynthConfig;
@group(0) @binding(1) var<storage, read> stats: array<f32>;  // flat TileStatsTier3
@group(0) @binding(2) var<storage, read_write> n0: array<f32>;
@group(0) @binding(3) var<storage, read_write> n1: array<f32>;
@group(0) @binding(4) var<storage, read_write> n2: array<f32>;
@group(0) @binding(5) var<storage, read_write> n3: array<f32>;

fn get_tile_stat(tile_idx: u32, offset: u32) -> f32 {
    return stats[tile_idx * STATS_STRIDE + offset];
}

@compute @workgroup_size(16, 16)
fn match_stats(
    @builtin(global_invocation_id) gid: vec3<u32>,
) {
    let x = gid.x;
    let y = gid.y;
    if (x >= ms_config.width || y >= ms_config.height) { return; }

    // Bilinear interpolation of tile statistics — eliminates crosshatch
    // at tile boundaries by smoothly blending variance/magnitude/correlation
    // between neighboring tiles.
    let ts = f32(ms_config.tile_size);
    let tcx = ms_config.tile_count_x;
    let tcy = ms_config.tile_count_y;

    let ftx = (f32(x) + 0.5) / ts - 0.5;
    let fty = (f32(y) + 0.5) / ts - 0.5;

    let tx0 = u32(clamp(i32(floor(ftx)), 0, i32(tcx) - 1));
    let ty0 = u32(clamp(i32(floor(fty)), 0, i32(tcy) - 1));
    let tx1 = min(tx0 + 1u, tcx - 1u);
    let ty1 = min(ty0 + 1u, tcy - 1u);

    let fx_f = clamp(ftx - floor(ftx), 0.0, 1.0);
    let fy_f = clamp(fty - floor(fty), 0.0, 1.0);

    let i00 = ty0 * tcx + tx0;
    let i10 = ty0 * tcx + tx1;
    let i01 = ty1 * tcx + tx0;
    let i11 = ty1 * tcx + tx1;

    // Interpolate all 11 statistics
    let target_mag0 = mix(mix(get_tile_stat(i00, 0u), get_tile_stat(i10, 0u), fx_f), mix(get_tile_stat(i01, 0u), get_tile_stat(i11, 0u), fx_f), fy_f);
    let target_mag1 = mix(mix(get_tile_stat(i00, 1u), get_tile_stat(i10, 1u), fx_f), mix(get_tile_stat(i01, 1u), get_tile_stat(i11, 1u), fx_f), fy_f);
    let target_mag2 = mix(mix(get_tile_stat(i00, 2u), get_tile_stat(i10, 2u), fx_f), mix(get_tile_stat(i01, 2u), get_tile_stat(i11, 2u), fx_f), fy_f);
    let target_mag3 = mix(mix(get_tile_stat(i00, 3u), get_tile_stat(i10, 3u), fx_f), mix(get_tile_stat(i01, 3u), get_tile_stat(i11, 3u), fx_f), fy_f);

    let target_var0 = mix(mix(get_tile_stat(i00, 4u), get_tile_stat(i10, 4u), fx_f), mix(get_tile_stat(i01, 4u), get_tile_stat(i11, 4u), fx_f), fy_f);
    let target_var1 = mix(mix(get_tile_stat(i00, 5u), get_tile_stat(i10, 5u), fx_f), mix(get_tile_stat(i01, 5u), get_tile_stat(i11, 5u), fx_f), fy_f);
    let target_var2 = mix(mix(get_tile_stat(i00, 6u), get_tile_stat(i10, 6u), fx_f), mix(get_tile_stat(i01, 6u), get_tile_stat(i11, 6u), fx_f), fy_f);
    let target_var3 = mix(mix(get_tile_stat(i00, 7u), get_tile_stat(i10, 7u), fx_f), mix(get_tile_stat(i01, 7u), get_tile_stat(i11, 7u), fx_f), fy_f);

    let target_corr01 = mix(mix(get_tile_stat(i00, 8u), get_tile_stat(i10, 8u), fx_f), mix(get_tile_stat(i01, 8u), get_tile_stat(i11, 8u), fx_f), fy_f);
    let target_corr12 = mix(mix(get_tile_stat(i00, 9u), get_tile_stat(i10, 9u), fx_f), mix(get_tile_stat(i01, 9u), get_tile_stat(i11, 9u), fx_f), fy_f);
    let target_corr23 = mix(mix(get_tile_stat(i00, 10u), get_tile_stat(i10, 10u), fx_f), mix(get_tile_stat(i01, 10u), get_tile_stat(i11, 10u), fx_f), fy_f);

    let idx = y * ms_config.width + x;

    // Current noise values
    var v0 = n0[idx];
    var v1 = n1[idx];
    var v2 = n2[idx];
    var v3 = n3[idx];

    let eps = 1e-6;

    // Step 1: Scale magnitudes to match target variance
    // target_var ≈ E[x^2] for zero-mean bandpass signals
    // Scale noise so its variance matches: noise *= sqrt(target_var / current_var)
    // 4-orientation sine sum scaled by 0.5: variance ≈ 0.5
    let noise_var = 0.5;
    let scale0 = select(0.0, sqrt(max(target_var0, 0.0) / noise_var), target_var0 > eps);
    let scale1 = select(0.0, sqrt(max(target_var1, 0.0) / noise_var), target_var1 > eps);
    let scale2 = select(0.0, sqrt(max(target_var2, 0.0) / noise_var), target_var2 > eps);
    let scale3 = select(0.0, sqrt(max(target_var3, 0.0) / noise_var), target_var3 > eps);

    v0 *= scale0;
    v1 *= scale1;
    v2 *= scale2;
    v3 *= scale3;

    // Step 2: Cross-scale correlation injection
    // For each parent-child pair, adjust child magnitude conditioned on parent.
    // If target correlation is high and parent has strong magnitude:
    //   child magnitude should also be strong (edges span scales).
    // If target correlation is low: leave child independent (noise).
    //
    // Method: v_child += target_corr * (|v_parent| - mean_parent_mag) * sign(v_child)
    // This shifts child magnitude toward parent magnitude, scaled by correlation.
    let corr_strength = 0.8; // stronger correlation injection for visible structure

    // corr01: band0 (parent) → band1 (child)
    let parent_dev0 = abs(v0) - target_mag0;
    v1 += target_corr01 * corr_strength * parent_dev0 * sign(v1);

    // corr12: band1 → band2
    let parent_dev1 = abs(v1) - target_mag1;
    v2 += target_corr12 * corr_strength * parent_dev1 * sign(v2);

    // corr23: band2 → band3
    let parent_dev2 = abs(v2) - target_mag2;
    v3 += target_corr23 * corr_strength * parent_dev2 * sign(v3);

    // Write back
    n0[idx] = v0;
    n1[idx] = v1;
    n2[idx] = v2;
    n3[idx] = v3;
}

// ─── Entry point 3: Reconstruct — sum bands + residual → output ───

@group(0) @binding(0) var<uniform> rc_config: SynthConfig;
@group(0) @binding(1) var<storage, read> rc_n0: array<f32>;
@group(0) @binding(2) var<storage, read> rc_n1: array<f32>;
@group(0) @binding(3) var<storage, read> rc_n2: array<f32>;
@group(0) @binding(4) var<storage, read> rc_n3: array<f32>;
@group(0) @binding(5) var<storage, read> rc_residual: array<f32>;  // lowest-freq luminance
@group(0) @binding(6) var<storage, read> rc_stats: array<f32>;     // for tile color
@group(0) @binding(7) var source_tex: texture_2d<f32>;             // original for foveal blend
@group(0) @binding(8) var<storage, read_write> output: array<u32>; // RGBA8 packed

// Oklab → linear RGB
fn oklab_to_linear(lab: vec3<f32>) -> vec3<f32> {
    let l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
    let m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
    let s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
    let l = l_ * l_ * l_;
    let m = m_ * m_ * m_;
    let s = s_ * s_ * s_;
    return vec3<f32>(
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
       -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
       -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    );
}

fn linear_to_srgb(c: f32) -> f32 {
    if (c <= 0.0031308) { return c * 12.92; }
    return 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

fn pack_rgba8(r: f32, g: f32, b: f32, a: f32) -> u32 {
    let ri = u32(clamp(r * 255.0, 0.0, 255.0));
    let gi = u32(clamp(g * 255.0, 0.0, 255.0));
    let bi = u32(clamp(b * 255.0, 0.0, 255.0));
    let ai = u32(clamp(a * 255.0, 0.0, 255.0));
    return ri | (gi << 8u) | (bi << 16u) | (ai << 24u);
}

@compute @workgroup_size(16, 16)
fn reconstruct(
    @builtin(global_invocation_id) gid: vec3<u32>,
) {
    let x = gid.x;
    let y = gid.y;
    if (x >= rc_config.width || y >= rc_config.height) { return; }

    let idx = y * rc_config.width + x;

    // Eccentricity from gaze (for blend weight)
    let fx = f32(x) - rc_config.fovea_x * f32(rc_config.width);
    let fy = f32(y) - rc_config.fovea_y * f32(rc_config.height);
    let ecc = sqrt(fx * fx + fy * fy);

    // Blend weight: 0 at fovea, 1 in far periphery
    let alpha = clamp(
        (ecc - rc_config.blend_start) / max(rc_config.blend_end - rc_config.blend_start, 1.0),
        0.0, 1.0
    );

    // If fully foveal, output transparent (original passthrough)
    if (alpha < 0.01) {
        output[idx] = pack_rgba8(0.0, 0.0, 0.0, 0.0);
        return;
    }

    // Sum synthesized bands to get bandpass detail (zero-mean modulation)
    let synth_luma = rc_n0[idx] + rc_n1[idx] + rc_n2[idx] + rc_n3[idx];

    // Bilinear interpolation of tile color to eliminate grid artifacts.
    // Sample the 4 nearest tile centers and blend by sub-tile position.
    let ts = f32(rc_config.tile_size);
    let tcx = rc_config.tile_count_x;
    let tcy = rc_config.tile_count_y;

    // Continuous tile coordinate (pixel center relative to tile grid)
    let ftx = (f32(x) + 0.5) / ts - 0.5;
    let fty = (f32(y) + 0.5) / ts - 0.5;

    // Integer tile indices for the 4 corners
    let tx0 = u32(clamp(i32(floor(ftx)), 0, i32(tcx) - 1));
    let ty0 = u32(clamp(i32(floor(fty)), 0, i32(tcy) - 1));
    let tx1 = min(tx0 + 1u, tcx - 1u);
    let ty1 = min(ty0 + 1u, tcy - 1u);

    // Fractional position within the tile quad
    let fx_frac = clamp(ftx - floor(ftx), 0.0, 1.0);
    let fy_frac = clamp(fty - floor(fty), 0.0, 1.0);

    // Sample Oklab chrominance (a, b) from 4 tiles and bilinear blend
    let i00 = ty0 * tcx + tx0;
    let i10 = ty0 * tcx + tx1;
    let i01 = ty1 * tcx + tx0;
    let i11 = ty1 * tcx + tx1;

    let a00 = rc_stats[i00 * STATS_STRIDE + 12u];
    let a10 = rc_stats[i10 * STATS_STRIDE + 12u];
    let a01 = rc_stats[i01 * STATS_STRIDE + 12u];
    let a11 = rc_stats[i11 * STATS_STRIDE + 12u];
    let tile_mean_a = mix(mix(a00, a10, fx_frac), mix(a01, a11, fx_frac), fy_frac);

    let b00 = rc_stats[i00 * STATS_STRIDE + 13u];
    let b10 = rc_stats[i10 * STATS_STRIDE + 13u];
    let b01 = rc_stats[i01 * STATS_STRIDE + 13u];
    let b11 = rc_stats[i11 * STATS_STRIDE + 13u];
    let tile_mean_b = mix(mix(b00, b10, fx_frac), mix(b01, b11, fx_frac), fy_frac);

    // Also interpolate tile mean L for luminance baseline
    let L00 = rc_stats[i00 * STATS_STRIDE + 11u];
    let L10 = rc_stats[i10 * STATS_STRIDE + 11u];
    let L01 = rc_stats[i01 * STATS_STRIDE + 11u];
    let L11 = rc_stats[i11 * STATS_STRIDE + 11u];
    let tile_mean_L = mix(mix(L00, L10, fx_frac), mix(L01, L11, fx_frac), fy_frac);

    // Eccentricity-graded content replacement (the crowding mechanism):
    //
    // Near fovea (alpha → 0): tile_mean_L + detail — preserves structure,
    //   letter identity survives because mean carries it.
    //
    // Far periphery (alpha → 1): tile_mean_L + STRONGER detail — synthesis
    //   dominates, tile mean is just the DC offset, bandpass noise is the content.
    //   Isolated letter: low-variance tile → weak noise → mean (letter shape) visible.
    //   Flanked letter: high-variance tile → strong noise → mean is average of
    //   multiple letters → identity destroyed. THIS IS CROWDING.
    //
    // The key: detail_strength scales with alpha AND tile variance.
    // High eccentricity + high variance = full replacement (crowding).
    // High eccentricity + low variance = mean dominates (isolated letter preserved).
    // Detail strength scales with eccentricity. synth_luma values are small
    // (Oklab L bands ~0.005-0.01) so amplification needs to be aggressive.
    // At alpha=1 (far periphery), 40x amplification brings ±0.01 band values
    // to ±0.4 visible luminance variation — enough to destroy text legibility
    // while preserving the tile-mean spatial structure (blobs, not letters).
    let detail_strength = mix(1.0, 40.0, alpha);
    let L = clamp(tile_mean_L + synth_luma * detail_strength, 0.0, 1.0);
    let lab = vec3<f32>(L, tile_mean_a, tile_mean_b);
    let lin = oklab_to_linear(lab);

    let srgb = vec3<f32>(
        linear_to_srgb(clamp(lin.r, 0.0, 1.0)),
        linear_to_srgb(clamp(lin.g, 0.0, 1.0)),
        linear_to_srgb(clamp(lin.b, 0.0, 1.0)),
    );

    output[idx] = pack_rgba8(srgb.r, srgb.g, srgb.b, alpha);
}
