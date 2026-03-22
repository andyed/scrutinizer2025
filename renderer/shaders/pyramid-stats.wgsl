// pyramid-stats.wgsl — Tier 2.75 Cross-Scale Statistics Extraction
//
// Extracts per-tile summary statistics from Laplacian pyramid bands,
// including the cross-scale magnitude correlations that are the key
// quality improvement over Tier 2.5.
//
// Two entry points:
//   1. accumulate — Per-pixel: bin into tiles, accumulate raw sums
//   2. finalize   — Per-tile: compute means, variances, correlations
//
// Statistics per tile (TileStatsTier3):
//   - Per-band magnitude: mean |band_k| for k=0..3         (4 floats)
//   - Per-band variance: var(band_k) for k=0..3             (4 floats)
//   - Cross-scale magnitude correlation: corr(|b_k|,|b_{k+1}|) k=0..2 (3 floats)
//   - Mean color: L, a, b in Oklab                          (3 floats)
//   - Marginal skewness: skew(band_k) for k=0..3            (4 floats)
//   Total: 18 floats = 72 bytes per tile
//
// The accumulate pass uses atomicAdd on u32 storage buffers to handle
// arbitrary pixel-to-tile mappings without workgroup reduction constraints.
// Since WGSL lacks f32 atomics, we use fixed-point: multiply by 2^16,
// atomicAdd as u32, then divide by 2^16 * count in finalize.
//
// References:
//   Burt & Adelson (1983) — Laplacian pyramid (our decomposition basis)
//   Portilla & Simoncelli (2000) — full texture model (710+ stats on complex wavelets;
//       we compute ~18 stats on isotropic Laplacian bands — a strict subset)
//   Walton et al. (2021) — real-time oriented synthesis (we approximate with
//       variance scaling, not their histogram matching)
//   Rosenholtz et al. (2012) — TTM (requires oriented filters; our isotropic
//       approximation captures scale but not orientation)

// ─── Structures ───

struct StatsConfig {
    width: u32,          // band_0 width (= source half-res width)
    height: u32,         // band_0 height
    tile_size: u32,      // tile size in pixels (8)
    tile_count_x: u32,   // ceil(width / tile_size)
    tile_count_y: u32,   // ceil(height / tile_size)
    num_bands: u32,      // number of pyramid bands (4)
    // Band dimensions (w, h) for levels 0..3
    band0_w: u32, band0_h: u32,
    band1_w: u32, band1_h: u32,
    band2_w: u32, band2_h: u32,
    band3_w: u32, band3_h: u32,
    _pad0: u32,
    _pad1: u32,
};

// Output: 18 floats per tile
struct TileStatsTier3 {
    // Per-band mean absolute magnitude (4)
    mag0: f32, mag1: f32, mag2: f32, mag3: f32,
    // Per-band variance (4)
    var0: f32, var1: f32, var2: f32, var3: f32,
    // Cross-scale magnitude correlations (3)
    corr01: f32, corr12: f32, corr23: f32,
    // Mean color in Oklab (3)
    mean_L: f32, mean_a: f32, mean_b: f32,
    // Marginal skewness (4)
    skew0: f32, skew1: f32, skew2: f32, skew3: f32,
};

// ─── Accumulator structure (raw sums for finalize) ───
// Per tile, we accumulate:
//   count (1)
//   sum |band_k| (4), sum band_k^2 (4), sum |band_k|^2 (4)
//   sum |b_k|*|b_{k+1}_up| (3) — for cross-scale correlation
//   sum band_k^3 (4) — for skewness
//   sum L, a, b (3) — for mean color
// Total: 23 floats per tile
// Using i32 atomics with fixed-point scaling (multiply by 1024)

const FP_SCALE: f32 = 1024.0;
const FP_INV: f32 = 1.0 / 1024.0;
const ACCUM_STRIDE: u32 = 24u; // floats per tile in accumulator

// ─── Bindings ───

// accumulate pass
@group(0) @binding(0) var<uniform> config: StatsConfig;
@group(0) @binding(1) var<storage, read> band0: array<f32>;
@group(0) @binding(2) var<storage, read> band1: array<f32>;
@group(0) @binding(3) var<storage, read> band2: array<f32>;
@group(0) @binding(4) var<storage, read> band3: array<f32>;
@group(0) @binding(5) var source_tex: texture_2d<f32>;  // for color
@group(0) @binding(6) var<storage, read_write> accum: array<atomic<i32>>;

// ─── Helper: sample band at a given pixel, handling resolution differences ───
// Bands 1-3 are at lower resolution than band 0.
// For a pixel at (x,y) in band_0 space, sample band_k by dividing by 2^k.

fn sample_band(band_idx: u32, x: u32, y: u32) -> f32 {
    switch (band_idx) {
        case 0u: {
            let bx = min(x, config.band0_w - 1u);
            let by = min(y, config.band0_h - 1u);
            return band0[by * config.band0_w + bx];
        }
        case 1u: {
            let bx = min(x / 2u, config.band1_w - 1u);
            let by = min(y / 2u, config.band1_h - 1u);
            return band1[by * config.band1_w + bx];
        }
        case 2u: {
            let bx = min(x / 4u, config.band2_w - 1u);
            let by = min(y / 4u, config.band2_h - 1u);
            return band2[by * config.band2_w + bx];
        }
        case 3u: {
            let bx = min(x / 8u, config.band3_w - 1u);
            let by = min(y / 8u, config.band3_h - 1u);
            return band3[by * config.band3_w + bx];
        }
        default: { return 0.0; }
    }
}

// Oklab conversion (same as crowding-stats.wgsl)
fn srgb_to_linear(c: f32) -> f32 {
    if (c <= 0.04045) { return c / 12.92; }
    return pow((c + 0.055) / 1.055, 2.4);
}

fn linear_to_oklab(rgb: vec3<f32>) -> vec3<f32> {
    let l_ = 0.4122214708 * rgb.r + 0.5363325363 * rgb.g + 0.0514459929 * rgb.b;
    let m_ = 0.2119034982 * rgb.r + 0.6806995451 * rgb.g + 0.1073969566 * rgb.b;
    let s_ = 0.0883024619 * rgb.r + 0.2817188376 * rgb.g + 0.6299787005 * rgb.b;
    let l_c = pow(max(l_, 0.0), 1.0 / 3.0);
    let m_c = pow(max(m_, 0.0), 1.0 / 3.0);
    let s_c = pow(max(s_, 0.0), 1.0 / 3.0);
    return vec3<f32>(
        0.2104542553 * l_c + 0.7936177850 * m_c - 0.0040720468 * s_c,
        1.9779984951 * l_c - 2.4285922050 * m_c + 0.4505937099 * s_c,
        0.0259040371 * l_c + 0.7827717662 * m_c - 0.8086757660 * s_c,
    );
}

fn atomicAddFP(idx: u32, val: f32) {
    let ival = i32(val * FP_SCALE);
    atomicAdd(&accum[idx], ival);
}

// ─── Entry point 1: Accumulate per-pixel statistics into tile bins ───

@compute @workgroup_size(16, 16)
fn accumulate(
    @builtin(global_invocation_id) gid: vec3<u32>,
) {
    let x = gid.x;
    let y = gid.y;
    if (x >= config.width || y >= config.height) { return; }

    // Which tile does this pixel belong to?
    let tx = x / config.tile_size;
    let ty = y / config.tile_size;
    if (tx >= config.tile_count_x || ty >= config.tile_count_y) { return; }
    let tile_idx = ty * config.tile_count_x + tx;
    let base = tile_idx * ACCUM_STRIDE;

    // Sample all 4 bands at this pixel location
    let b0 = sample_band(0u, x, y);
    let b1 = sample_band(1u, x, y);
    let b2 = sample_band(2u, x, y);
    let b3 = sample_band(3u, x, y);

    let ab0 = abs(b0);
    let ab1 = abs(b1);
    let ab2 = abs(b2);
    let ab3 = abs(b3);

    // Accumulate count
    atomicAdd(&accum[base + 0u], 1);

    // sum |band_k| (offsets 1-4)
    atomicAddFP(base + 1u, ab0);
    atomicAddFP(base + 2u, ab1);
    atomicAddFP(base + 3u, ab2);
    atomicAddFP(base + 4u, ab3);

    // sum band_k^2 (offsets 5-8) — for variance
    atomicAddFP(base + 5u, b0 * b0);
    atomicAddFP(base + 6u, b1 * b1);
    atomicAddFP(base + 7u, b2 * b2);
    atomicAddFP(base + 8u, b3 * b3);

    // sum |b_k| * |b_{k+1}| (offsets 9-11) — for cross-scale correlation
    atomicAddFP(base + 9u, ab0 * ab1);
    atomicAddFP(base + 10u, ab1 * ab2);
    atomicAddFP(base + 11u, ab2 * ab3);

    // sum |band_k|^2 (offsets 12-15) — for correlation denominator
    atomicAddFP(base + 12u, ab0 * ab0);
    atomicAddFP(base + 13u, ab1 * ab1);
    atomicAddFP(base + 14u, ab2 * ab2);
    atomicAddFP(base + 15u, ab3 * ab3);

    // sum band_k^3 (offsets 16-19) — for skewness
    atomicAddFP(base + 16u, b0 * b0 * b0);
    atomicAddFP(base + 17u, b1 * b1 * b1);
    atomicAddFP(base + 18u, b2 * b2 * b2);
    atomicAddFP(base + 19u, b3 * b3 * b3);

    // Color: sample source texture for Oklab L, a, b (offsets 20-22)
    let srgb = textureLoad(source_tex, vec2<u32>(x, y), 0);
    let lin = vec3<f32>(
        srgb_to_linear(srgb.r),
        srgb_to_linear(srgb.g),
        srgb_to_linear(srgb.b),
    );
    let lab = linear_to_oklab(lin);
    atomicAddFP(base + 20u, lab.x);
    atomicAddFP(base + 21u, lab.y);
    atomicAddFP(base + 22u, lab.z);

    // offset 23 reserved (padding)
}

// ─── Entry point 2: Finalize — compute stats from accumulated sums ───

@group(0) @binding(0) var<uniform> fin_config: StatsConfig;
@group(0) @binding(1) var<storage, read> fin_accum: array<i32>;
@group(0) @binding(2) var<storage, read_write> tile_stats: array<TileStatsTier3>;

fn readFP(idx: u32) -> f32 {
    return f32(fin_accum[idx]) * FP_INV;
}

@compute @workgroup_size(256)
fn finalize(
    @builtin(global_invocation_id) gid: vec3<u32>,
) {
    let tile_idx = gid.x;
    let total_tiles = fin_config.tile_count_x * fin_config.tile_count_y;
    if (tile_idx >= total_tiles) { return; }

    let base = tile_idx * ACCUM_STRIDE;
    let count = fin_accum[base + 0u];
    if (count == 0) {
        // Empty tile — zero everything
        tile_stats[tile_idx] = TileStatsTier3(
            0.0, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.0,
            0.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 0.0,
        );
        return;
    }

    let n = f32(count);
    let inv_n = 1.0 / n;

    // Per-band mean absolute magnitude
    let mag0 = readFP(base + 1u) * inv_n;
    let mag1 = readFP(base + 2u) * inv_n;
    let mag2 = readFP(base + 3u) * inv_n;
    let mag3 = readFP(base + 4u) * inv_n;

    // Per-band variance: E[x^2] - E[x]^2
    // Note: variance of the band values (not magnitudes)
    // E[x] for bandpass is ~0 (zero-mean), so var ≈ E[x^2]
    let var0 = readFP(base + 5u) * inv_n;
    let var1 = readFP(base + 6u) * inv_n;
    let var2 = readFP(base + 7u) * inv_n;
    let var3 = readFP(base + 8u) * inv_n;

    // Cross-scale magnitude correlation:
    // corr(|b_k|, |b_{k+1}|) = (E[|b_k|*|b_{k+1}|] - E[|b_k|]*E[|b_{k+1}|])
    //                           / (std(|b_k|) * std(|b_{k+1}|))
    // Where std(|b_k|) = sqrt(E[|b_k|^2] - E[|b_k|]^2)
    let cross01 = readFP(base + 9u) * inv_n;
    let cross12 = readFP(base + 10u) * inv_n;
    let cross23 = readFP(base + 11u) * inv_n;

    let mag0_sq = readFP(base + 12u) * inv_n;
    let mag1_sq = readFP(base + 13u) * inv_n;
    let mag2_sq = readFP(base + 14u) * inv_n;
    let mag3_sq = readFP(base + 15u) * inv_n;

    let std0 = sqrt(max(mag0_sq - mag0 * mag0, 0.0));
    let std1 = sqrt(max(mag1_sq - mag1 * mag1, 0.0));
    let std2 = sqrt(max(mag2_sq - mag2 * mag2, 0.0));
    let std3 = sqrt(max(mag3_sq - mag3 * mag3, 0.0));

    var corr01: f32 = 0.0;
    var corr12: f32 = 0.0;
    var corr23: f32 = 0.0;
    let eps = 1e-8;
    if (std0 * std1 > eps) { corr01 = (cross01 - mag0 * mag1) / (std0 * std1); }
    if (std1 * std2 > eps) { corr12 = (cross12 - mag1 * mag2) / (std1 * std2); }
    if (std2 * std3 > eps) { corr23 = (cross23 - mag2 * mag3) / (std2 * std3); }

    // Clamp correlations to [-1, 1] (numerical safety)
    corr01 = clamp(corr01, -1.0, 1.0);
    corr12 = clamp(corr12, -1.0, 1.0);
    corr23 = clamp(corr23, -1.0, 1.0);

    // Marginal skewness: E[x^3] / std^3
    let m3_0 = readFP(base + 16u) * inv_n;
    let m3_1 = readFP(base + 17u) * inv_n;
    let m3_2 = readFP(base + 18u) * inv_n;
    let m3_3 = readFP(base + 19u) * inv_n;

    let std_v0 = sqrt(max(var0, 0.0));
    let std_v1 = sqrt(max(var1, 0.0));
    let std_v2 = sqrt(max(var2, 0.0));
    let std_v3 = sqrt(max(var3, 0.0));

    var skew0: f32 = 0.0;
    var skew1: f32 = 0.0;
    var skew2: f32 = 0.0;
    var skew3: f32 = 0.0;
    if (std_v0 > eps) { skew0 = m3_0 / (std_v0 * std_v0 * std_v0); }
    if (std_v1 > eps) { skew1 = m3_1 / (std_v1 * std_v1 * std_v1); }
    if (std_v2 > eps) { skew2 = m3_2 / (std_v2 * std_v2 * std_v2); }
    if (std_v3 > eps) { skew3 = m3_3 / (std_v3 * std_v3 * std_v3); }

    // Mean color
    let mean_L = readFP(base + 20u) * inv_n;
    let mean_a = readFP(base + 21u) * inv_n;
    let mean_b = readFP(base + 22u) * inv_n;

    tile_stats[tile_idx] = TileStatsTier3(
        mag0, mag1, mag2, mag3,
        var0, var1, var2, var3,
        corr01, corr12, corr23,
        mean_L, mean_a, mean_b,
        skew0, skew1, skew2, skew3,
    );
}
