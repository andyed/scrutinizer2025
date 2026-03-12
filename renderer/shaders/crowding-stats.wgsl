// crowding-stats.wgsl — Tier 2.5 Pass 1
// Compute summary statistics per eccentricity-scaled tile:
//   mean L, sigma L, mean a, mean b (Oklab), 4 orientation energies
//
// Workgroup: 8x8 = 64 threads. One workgroup per tile.
// Each thread samples one pixel within the CMF-scaled tile region.
// Binary tree parallel reduction → thread 0 writes TileStats.
//
// References:
//   Rosenholtz et al. (2012) — mongrel summary statistics
//   Walton et al. (2021) — efficient peripheral synthesis
//   Blauch, Konkle & Alvarez (2026) — FOVI cortical magnification

struct Config {
    width: u32,
    height: u32,
    tile_size: u32,
    tile_count_x: u32,
    tile_count_y: u32,
    fovea_x: f32,
    fovea_y: f32,
    fovea_radius: f32,
    cmf_a: f32,
    cortical_max: f32,
    ecc_scaling: f32,
    aspect: f32,            // width / height (screen aspect ratio)
    fovea_aspect_ratio: f32, // elliptical fovea shape (default 1.33)
    temporal_blend: f32,     // EMA smoothing factor (0=frozen, 1=no smoothing)
    _pad2: f32,
    _pad3: f32,
};

// Per-tile output: 12 floats = 48 bytes
struct TileStats {
    mean_L: f32,
    sigma_L: f32,
    mean_a: f32,
    mean_b: f32,
    energy_h: f32,
    energy_v: f32,
    energy_d45: f32,
    energy_d135: f32,
    eccentricity: f32,
    mip_level: f32,
    sample_count: f32,
    _pad: f32,
};

@group(0) @binding(0) var<uniform> config: Config;
@group(0) @binding(1) var source_tex: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> stats: array<TileStats>;
@group(0) @binding(3) var<storage, read> prev_stats: array<TileStats>;

// Shared memory for parallel reduction (64 threads)
var<workgroup> sh_L: array<f32, 64>;
var<workgroup> sh_L2: array<f32, 64>;
var<workgroup> sh_a: array<f32, 64>;
var<workgroup> sh_b: array<f32, 64>;
var<workgroup> sh_eH: array<f32, 64>;
var<workgroup> sh_eV: array<f32, 64>;
var<workgroup> sh_eD45: array<f32, 64>;
var<workgroup> sh_eD135: array<f32, 64>;

// sRGB → linear (single channel)
fn srgb_to_linear(c: f32) -> f32 {
    if (c <= 0.04045) {
        return c / 12.92;
    }
    return pow((c + 0.055) / 1.055, 2.4);
}

// Linear RGB → Oklab (L, a, b)
// Ottosson (2020): https://bottosson.github.io/posts/oklab/
fn linear_to_oklab(rgb: vec3<f32>) -> vec3<f32> {
    let l_ = 0.4122214708 * rgb.r + 0.5363325363 * rgb.g + 0.0514459929 * rgb.b;
    let m_ = 0.2119034982 * rgb.r + 0.6806995451 * rgb.g + 0.1073969566 * rgb.b;
    let s_ = 0.0883024619 * rgb.r + 0.2817188376 * rgb.g + 0.6299787005 * rgb.b;

    let l_c = pow(max(l_, 0.0), 1.0 / 3.0);
    let m_c = pow(max(m_, 0.0), 1.0 / 3.0);
    let s_c = pow(max(s_, 0.0), 1.0 / 3.0);

    let L = 0.2104542553 * l_c + 0.7936177850 * m_c - 0.0040720468 * s_c;
    let a = 1.9779984951 * l_c - 2.4285922050 * m_c + 0.4505937099 * s_c;
    let b = 0.0259040371 * l_c + 0.7827717662 * m_c - 0.8086757660 * s_c;

    return vec3<f32>(L, a, b);
}

// Replicate computeMipLevel from peripheral.frag (lines 442-456)
// Both eccentricity and fovea_radius must be in the same coordinate space
// (UV-normalized, matching the fragment shader's aspect-corrected distance).
fn compute_mip_level_uv(eccentricity: f32, fovea_radius: f32) -> f32 {
    let normalized_ecc = max(0.0, eccentricity) / fovea_radius;
    let max_mip: f32 = 4.0;

    // CMF logarithmic scaling: Schwartz (1980), FOVI (Blauch et al. 2026)
    let r_deg = normalized_ecc * 2.0;
    let cortical_dist = log(1.0 + r_deg / config.cmf_a);
    let ecc_scale = config.ecc_scaling / 0.75;
    return clamp(max_mip * cortical_dist / config.cortical_max * ecc_scale, 0.0, max_mip);
}

@compute @workgroup_size(8, 8)
fn main(
    @builtin(workgroup_id) wg_id: vec3<u32>,
    @builtin(local_invocation_id) local_id: vec3<u32>,
    @builtin(local_invocation_index) local_idx: u32,
) {
    let tile_x = wg_id.x;
    let tile_y = wg_id.y;

    // Bounds check: skip tiles outside the grid
    if (tile_x >= config.tile_count_x || tile_y >= config.tile_count_y) {
        return;
    }

    let tile_idx = tile_y * config.tile_count_x + tile_x;
    let ts = config.tile_size;

    // Pixel coordinates for this thread within the tile
    let px_x = tile_x * ts + local_id.x;
    let px_y = tile_y * ts + local_id.y;

    // Compute tile center eccentricity in normalized UV space
    // Must match the fragment shader's aspect-corrected distance calculation:
    //   uv_corrected = vec2(uv.x * aspect, uv.y)
    //   delta.x /= fovea_aspect_ratio
    //   dist = length(delta)
    let tile_center_x = f32(tile_x * ts) + f32(ts) * 0.5;
    let tile_center_y = f32(tile_y * ts) + f32(ts) * 0.5;
    let w = f32(config.width);
    let h = f32(config.height);
    // Convert to UV space (0-1), then aspect-correct
    let uv_x = tile_center_x / w * config.aspect;
    let uv_y = tile_center_y / h;
    let fov_uv_x = config.fovea_x / w * config.aspect;
    let fov_uv_y = config.fovea_y / h;
    let dx = (uv_x - fov_uv_x) / config.fovea_aspect_ratio;
    let dy = uv_y - fov_uv_y;
    let ecc = sqrt(dx * dx + dy * dy);
    // fovea_radius is passed in pixel space; convert to same UV-normalized units
    let fovea_radius_norm = config.fovea_radius / h;
    let mip = compute_mip_level_uv(ecc, fovea_radius_norm);

    // Sample pixel (clamped to image bounds)
    let sx = clamp(px_x, 0u, config.width - 1u);
    let sy = clamp(px_y, 0u, config.height - 1u);
    let srgb = textureLoad(source_tex, vec2<u32>(sx, sy), 0);

    // Convert sRGB → linear → Oklab
    let lin = vec3<f32>(
        srgb_to_linear(srgb.r),
        srgb_to_linear(srgb.g),
        srgb_to_linear(srgb.b),
    );
    let lab = linear_to_oklab(lin);

    // Orientation energy: 4-directional gradient via neighbor differences
    // Horizontal: left-right, Vertical: top-bottom, Diagonals: corner differences
    let valid = (px_x > 0u && px_x < config.width - 1u && px_y > 0u && px_y < config.height - 1u);
    var eH: f32 = 0.0;
    var eV: f32 = 0.0;
    var eD45: f32 = 0.0;
    var eD135: f32 = 0.0;

    if (valid) {
        let luma_w = vec3<f32>(0.299, 0.587, 0.114);
        let lL = dot(textureLoad(source_tex, vec2<u32>(px_x - 1u, px_y), 0).rgb, luma_w);
        let lR = dot(textureLoad(source_tex, vec2<u32>(px_x + 1u, px_y), 0).rgb, luma_w);
        let lT = dot(textureLoad(source_tex, vec2<u32>(px_x, px_y - 1u), 0).rgb, luma_w);
        let lB = dot(textureLoad(source_tex, vec2<u32>(px_x, px_y + 1u), 0).rgb, luma_w);
        let lTL = dot(textureLoad(source_tex, vec2<u32>(px_x - 1u, px_y - 1u), 0).rgb, luma_w);
        let lBR = dot(textureLoad(source_tex, vec2<u32>(px_x + 1u, px_y + 1u), 0).rgb, luma_w);
        let lTR = dot(textureLoad(source_tex, vec2<u32>(px_x + 1u, px_y - 1u), 0).rgb, luma_w);
        let lBL = dot(textureLoad(source_tex, vec2<u32>(px_x - 1u, px_y + 1u), 0).rgb, luma_w);

        eH = abs(lR - lL);
        eV = abs(lB - lT);
        eD45 = abs(lBR - lTL);
        eD135 = abs(lBL - lTR);
    }

    // Store in shared memory
    sh_L[local_idx] = lab.x;
    sh_L2[local_idx] = lab.x * lab.x;
    sh_a[local_idx] = lab.y;
    sh_b[local_idx] = lab.z;
    sh_eH[local_idx] = eH;
    sh_eV[local_idx] = eV;
    sh_eD45[local_idx] = eD45;
    sh_eD135[local_idx] = eD135;

    workgroupBarrier();

    // Binary tree parallel reduction: 64→32→16→8→4→2→1
    for (var stride: u32 = 32u; stride > 0u; stride = stride >> 1u) {
        if (local_idx < stride) {
            sh_L[local_idx] += sh_L[local_idx + stride];
            sh_L2[local_idx] += sh_L2[local_idx + stride];
            sh_a[local_idx] += sh_a[local_idx + stride];
            sh_b[local_idx] += sh_b[local_idx + stride];
            sh_eH[local_idx] += sh_eH[local_idx + stride];
            sh_eV[local_idx] += sh_eV[local_idx + stride];
            sh_eD45[local_idx] += sh_eD45[local_idx + stride];
            sh_eD135[local_idx] += sh_eD135[local_idx + stride];
        }
        workgroupBarrier();
    }

    // Thread 0 writes tile statistics with temporal smoothing
    if (local_idx == 0u) {
        let n: f32 = 64.0;
        let inv_n = 1.0 / n;
        let cur_mean_L = sh_L[0] * inv_n;
        let mean_L2 = sh_L2[0] * inv_n;
        // NaN guard: clamp variance to >= 0 before sqrt
        let variance = max(mean_L2 - cur_mean_L * cur_mean_L, 0.0);
        let cur_sigma_L = sqrt(variance);
        let cur_mean_a = sh_a[0] * inv_n;
        let cur_mean_b = sh_b[0] * inv_n;
        let cur_eH = sh_eH[0] * inv_n;
        let cur_eV = sh_eV[0] * inv_n;
        let cur_eD45 = sh_eD45[0] * inv_n;
        let cur_eD135 = sh_eD135[0] * inv_n;

        // Temporal EMA: smooth only sigma and orientation energies to suppress
        // frame-to-frame noise shimmer. Means track content instantly (no lag
        // during cursor movement). Eccentricity and mip are geometric, not smoothed.
        let prev = prev_stats[tile_idx];
        let a = config.temporal_blend;
        // If prev frame had no samples (first frame), skip blending
        let has_prev = prev.sample_count > 0.0;
        let b = select(1.0, a, has_prev);

        stats[tile_idx] = TileStats(
            cur_mean_L,                          // means: instant (no smoothing)
            mix(prev.sigma_L, cur_sigma_L, b),   // sigma: smoothed
            cur_mean_a,
            cur_mean_b,
            mix(prev.energy_h, cur_eH, b),       // orientation: smoothed
            mix(prev.energy_v, cur_eV, b),
            mix(prev.energy_d45, cur_eD45, b),
            mix(prev.energy_d135, cur_eD135, b),
            ecc,
            mip,
            n,
            0.0,
        );
    }
}

