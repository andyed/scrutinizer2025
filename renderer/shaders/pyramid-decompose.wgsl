// pyramid-decompose.wgsl — Tier 2.75 Laplacian Pyramid
//
// Three entry points dispatched by the JS pipeline manager:
//   1. to_luminance   — Convert source rgba8unorm texture to f32 luminance buffer
//   2. blur_downsample — Gaussian blur (sigma=1, radius=3) + 2x box downsample
//   3. compute_band    — Upsample (nearest 2x) + subtract to produce bandpass
//
// The JS pipeline dispatches these in sequence for each pyramid level:
//   to_luminance → level[0]
//   For k = 0..3:
//     blur_downsample(level[k]) → level[k+1]
//     compute_band(level[k], level[k+1]) → band[k]
//   band[4] = level[4] (residual, copy)
//
// All intermediate data uses flat f32 storage buffers with explicit dimensions
// in uniforms, following the existing Tier 2.5 pattern.
//
// References:
//   Burt & Adelson (1983) — Laplacian pyramid
//   Rosenholtz et al. (2012) — TTM summary statistics
//   Walton et al. (2021) — real-time peripheral synthesis

// ─── Shared config ───

struct DecomposeConfig {
    src_width: u32,
    src_height: u32,
    dst_width: u32,
    dst_height: u32,
};

// ─── Entry point 1: RGBA8 texture → f32 luminance buffer ───

@group(0) @binding(0) var<uniform> config: DecomposeConfig;
@group(0) @binding(1) var source_tex: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;

// sRGB → linear (single channel)
fn srgb_to_linear(c: f32) -> f32 {
    if (c <= 0.04045) { return c / 12.92; }
    return pow((c + 0.055) / 1.055, 2.4);
}

// Linear RGB → Oklab L (lightness channel only)
fn linear_to_oklab_L(rgb: vec3<f32>) -> f32 {
    let l_ = 0.4122214708 * rgb.r + 0.5363325363 * rgb.g + 0.0514459929 * rgb.b;
    let m_ = 0.2119034982 * rgb.r + 0.6806995451 * rgb.g + 0.1073969566 * rgb.b;
    let s_ = 0.0883024619 * rgb.r + 0.2817188376 * rgb.g + 0.6299787005 * rgb.b;
    let l_c = pow(max(l_, 0.0), 1.0 / 3.0);
    let m_c = pow(max(m_, 0.0), 1.0 / 3.0);
    let s_c = pow(max(s_, 0.0), 1.0 / 3.0);
    return 0.2104542553 * l_c + 0.7936177850 * m_c - 0.0040720468 * s_c;
}

@compute @workgroup_size(16, 16)
fn to_luminance(
    @builtin(global_invocation_id) gid: vec3<u32>,
) {
    let x = gid.x;
    let y = gid.y;
    if (x >= config.src_width || y >= config.src_height) { return; }

    let srgb = textureLoad(source_tex, vec2<u32>(x, y), 0).rgb;
    let lin = vec3<f32>(
        srgb_to_linear(srgb.r),
        srgb_to_linear(srgb.g),
        srgb_to_linear(srgb.b),
    );
    // Oklab L — perceptually uniform lightness, compatible with reconstruct shader
    dst[y * config.src_width + x] = linear_to_oklab_L(lin);
}

// ─── Entry point 2: Gaussian blur + 2x downsample ───
//
// Each output pixel at (x, y) in the dst buffer corresponds to a 2x2 block
// starting at (2x, 2y) in the source. We compute the Gaussian-weighted average
// of a 7x7 neighborhood centered on each of the 4 source pixels, then average
// those 4 values (box downsample).
//
// Optimization: compute Gaussian directly on the output grid. For each output
// pixel, sample a 7x7 region centered at (2x+0.5, 2y+0.5) in source space.
// This is equivalent to blur-then-downsample for our purposes.

// Brute-force 2D Gaussian: each output thread reads a 7x7 patch (49 reads).
// At half-res (960x506) this is ~1900 workgroups with 256 threads each.
// Acceptable for our 0.3ms per-level budget. Shared memory optimization
// deferred until profiling shows it's needed.

@group(0) @binding(0) var<uniform> bd_config: DecomposeConfig;
@group(0) @binding(1) var<storage, read> bd_src: array<f32>;
@group(0) @binding(2) var<storage, read_write> bd_dst: array<f32>;

fn gaussian_kernel(offset: i32) -> f32 {
    // Pre-normalized Gaussian, sigma=1.0, radius=3
    // Computed: exp(-x^2/2) / sum, verified against numpy/scipy
    switch (offset) {
        case -3, 3: { return 0.00443; }
        case -2, 2: { return 0.05401; }
        case -1, 1: { return 0.24204; }
        case  0:    { return 0.39905; }
        default:    { return 0.0; }
    }
}

@compute @workgroup_size(16, 16)
fn blur_downsample(
    @builtin(global_invocation_id) gid: vec3<u32>,
) {
    let ox = gid.x;  // output pixel x
    let oy = gid.y;  // output pixel y
    if (ox >= bd_config.dst_width || oy >= bd_config.dst_height) { return; }

    let sw = bd_config.src_width;
    let sh = bd_config.src_height;

    // Source center for this output pixel (box downsample center)
    let cx = i32(ox * 2u);
    let cy = i32(oy * 2u);

    // Separable Gaussian blur: horizontal then vertical
    // Since we're reading from global memory anyway, do the full 2D kernel
    // as sum of separable products: G(dx)*G(dy)*src[cy+dy][cx+dx]
    var sum: f32 = 0.0;
    for (var dy: i32 = -3; dy <= 3; dy++) {
        let ky = gaussian_kernel(dy);
        let sy = clamp(cy + dy, 0, i32(sh) - 1);
        for (var dx: i32 = -3; dx <= 3; dx++) {
            let kx = gaussian_kernel(dx);
            let sx = clamp(cx + dx, 0, i32(sw) - 1);
            sum += ky * kx * bd_src[u32(sy) * sw + u32(sx)];
        }
    }

    bd_dst[oy * bd_config.dst_width + ox] = sum;
}

// ─── Entry point 3: Upsample (nearest 2x) + subtract → bandpass ───
//
// band[k](x,y) = level[k](x,y) - upsample(level[k+1])(x,y)
// upsample: nearest-neighbor 2x (each pixel in k+1 covers a 2x2 block in k)

@group(0) @binding(0) var<uniform> cb_config: DecomposeConfig;
@group(0) @binding(1) var<storage, read> cb_level_k: array<f32>;    // current level (full res)
@group(0) @binding(2) var<storage, read> cb_level_k1: array<f32>;   // next level (half res)
@group(0) @binding(3) var<storage, read_write> cb_band: array<f32>; // output band (full res)

@compute @workgroup_size(16, 16)
fn compute_band(
    @builtin(global_invocation_id) gid: vec3<u32>,
) {
    let x = gid.x;
    let y = gid.y;
    if (x >= cb_config.src_width || y >= cb_config.src_height) { return; }

    let idx = y * cb_config.src_width + x;
    let val_k = cb_level_k[idx];

    // Nearest-neighbor upsample from level k+1
    let sx = min(x / 2u, cb_config.dst_width - 1u);
    let sy = min(y / 2u, cb_config.dst_height - 1u);
    let val_k1_up = cb_level_k1[sy * cb_config.dst_width + sx];

    cb_band[idx] = val_k - val_k1_up;
}
