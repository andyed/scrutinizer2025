// crowding-synth.wgsl — Tier 2.5 Pass 2
// Synthesize metamer texture from tile statistics.
// Foveal tiles (mip < 0.5) → alpha=0 (original source passthrough).
// Peripheral tiles → oriented noise matching tile stats, alpha = blend weight.
//
// Workgroup: 8x8, one thread per output pixel.
//
// References:
//   Rosenholtz et al. (2012) — summary statistics → mongrel perception
//   Walton et al. (2021) — real-time foveated synthesis

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
    aspect: f32,
    fovea_aspect_ratio: f32,
    temporal_blend: f32,
    _pad2: f32,
    _pad3: f32,
};

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
@group(0) @binding(1) var<storage, read> stats: array<TileStats>;
@group(0) @binding(2) var<storage, read_write> output: array<u32>;

// Positional hash for spatial jitter (IQ hash, deterministic)
fn hash21(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, vec3<f32>(p3.y + 33.33, p3.z + 33.33, p3.x + 33.33));
    return fract((p3.x + p3.y) * p3.z);
}

// Oklab → linear RGB
fn oklab_to_linear(lab: vec3<f32>) -> vec3<f32> {
    let l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
    let m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
    let s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;

    let l = l_ * l_ * l_;
    let m = m_ * m_ * m_;
    let s = s_ * s_ * s_;

    let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    let b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

    return vec3<f32>(r, g, b);
}

// linear → sRGB (single channel)
fn linear_to_srgb(c: f32) -> f32 {
    if (c <= 0.0031308) {
        return c * 12.92;
    }
    return 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

// Pack RGBA8 as u32 (little-endian: R in low byte)
fn pack_rgba8(r: f32, g: f32, b: f32, a: f32) -> u32 {
    let ri = u32(clamp(r * 255.0, 0.0, 255.0));
    let gi = u32(clamp(g * 255.0, 0.0, 255.0));
    let bi = u32(clamp(b * 255.0, 0.0, 255.0));
    let ai = u32(clamp(a * 255.0, 0.0, 255.0));
    return ri | (gi << 8u) | (bi << 16u) | (ai << 24u);
}

@compute @workgroup_size(8, 8)
fn main(
    @builtin(global_invocation_id) gid: vec3<u32>,
) {
    let px_x = gid.x;
    let px_y = gid.y;

    // Bounds check
    if (px_x >= config.width || px_y >= config.height) {
        return;
    }

    let pixel_idx = px_y * config.width + px_x;

    // Which tile does this pixel belong to?
    let tile_x = min(px_x / config.tile_size, config.tile_count_x - 1u);
    let tile_y = min(px_y / config.tile_size, config.tile_count_y - 1u);
    let tile_idx = tile_y * config.tile_count_x + tile_x;

    let tile = stats[tile_idx];

    // Foveal passthrough: if mip < 0.5, output transparent (alpha=0)
    if (tile.mip_level < 0.5) {
        output[pixel_idx] = pack_rgba8(0.0, 0.0, 0.0, 0.0);
        return;
    }

    // Blend weight: 0 at mip=0.5, 1.0 at mip=2.0
    let alpha = clamp((tile.mip_level - 0.5) / 1.5, 0.0, 1.0);

    // Pixel position for noise generation
    let px = vec2<f32>(f32(px_x), f32(px_y));

    // Spatial jitter to break tile regularity
    let jitter = hash21(px) * 2.0 - 1.0;

    // Oriented noise: weighted sum of 4 directional sine gratings
    // Frequency scales with mip level (coarser in periphery)
    let freq = 0.15 / max(tile.mip_level, 0.5);
    let total_energy = tile.energy_h + tile.energy_v + tile.energy_d45 + tile.energy_d135 + 0.001;

    // Normalized weights
    let wH = tile.energy_h / total_energy;
    let wV = tile.energy_v / total_energy;
    let wD45 = tile.energy_d45 / total_energy;
    let wD135 = tile.energy_d135 / total_energy;

    // Grating contributions (phase-shifted by jitter)
    let noise_h = sin(px.y * freq + jitter * 3.14159) * wH;
    let noise_v = sin(px.x * freq + jitter * 2.71828) * wV;
    let noise_d45 = sin((px.x + px.y) * freq * 0.707 + jitter * 1.618) * wD45;
    let noise_d135 = sin((px.x - px.y) * freq * 0.707 + jitter * 0.577) * wD135;

    let oriented_noise = noise_h + noise_v + noise_d45 + noise_d135;

    // Modulate luminance around tile mean by sigma
    let L = tile.mean_L + oriented_noise * tile.sigma_L * 1.5;

    // Reconstruct Oklab color with tile-mean chrominance
    let lab = vec3<f32>(clamp(L, 0.0, 1.0), tile.mean_a, tile.mean_b);
    let lin = oklab_to_linear(lab);

    // Convert to sRGB
    let srgb = vec3<f32>(
        linear_to_srgb(clamp(lin.r, 0.0, 1.0)),
        linear_to_srgb(clamp(lin.g, 0.0, 1.0)),
        linear_to_srgb(clamp(lin.b, 0.0, 1.0)),
    );

    output[pixel_idx] = pack_rgba8(srgb.r, srgb.g, srgb.b, alpha);
}
