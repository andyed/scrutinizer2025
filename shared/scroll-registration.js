'use strict';

// Scroll registration for the foveated HUD.
//
// The content view scrolls natively while the HUD shows the last captured
// frame, so the HUD draws each content-locked texture shifted by how far the
// live page has scrolled past the position that texture was made at. Two
// pieces live here:
//
//   registrationOffsetDip()  live scroll minus source scroll, in DIP
//   FrameScrollRegistrar     which scroll position a captured frame shows
//   scrollLockUvRects()      fixed/stuck-sticky boxes, which do not scroll
//
// The registrar exists because a timestamp cannot name a frame's scroll.
// capturePage copies whatever compositor frame viz aggregates next, and the
// page's scroll event reaches main a frame or more after that frame was
// painted (programmatic scrolls fire it on the following frame; threaded
// wheel scrolls present before the main thread learns of them). Measured at
// 8 px per frame, the request-time stamp lagged the pixels by 8-16 px and a
// post-capture stamp was off by one step in either direction. The registrar
// treats the two stamps as a prior window and finds the exact shift by
// matching the new frame's rows against a reference frame's.

function finite(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function scrollZoom(position) {
    const zoom = position && typeof position === 'object' ? position.zoom : undefined;
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/**
 * Scroll position in DIP (CSS px times the page zoom factor).
 * Accepts {x, y, zoom} or {scrollX, scrollY, zoom}.
 */
function scrollToDip(position) {
    const source = position && typeof position === 'object' ? position : {};
    const zoom = scrollZoom(source);
    return {
        x: finite(source.x !== undefined ? source.x : source.scrollX) * zoom,
        y: finite(source.y !== undefined ? source.y : source.scrollY) * zoom
    };
}

/**
 * How far (DIP) the live page has scrolled past the position a texture was
 * made at. Positive y = the page has scrolled down since, so the texture must
 * be sampled further down to line up with it. Zero when either position is
 * missing or the zoom differs (the page reflowed; no translation maps one
 * layout onto the other).
 */
function registrationOffsetDip(sourcePosition, livePosition) {
    if (!sourcePosition || !livePosition) return { x: 0, y: 0 };
    if (Math.abs(scrollZoom(sourcePosition) - scrollZoom(livePosition)) > 1e-3) return { x: 0, y: 0 };
    const source = scrollToDip(sourcePosition);
    const live = scrollToDip(livePosition);
    return { x: live.x - source.x, y: live.y - source.y };
}

const DEFAULT_COLUMNS = 256;
const DEFAULT_BANDS = 8;

/**
 * Banded row signature of a BGRA (or RGBA) buffer. The width is split into
 * `bands` vertical bands; each band samples columns/bands evenly spaced
 * pixels per row and keeps two sums of B + 2G + R, over its even and odd
 * samples. Channel order does not matter because B and R carry equal weight.
 *
 * Bands let a sticky sidebar or toolbar column hold still while the article
 * column moves; a full-width sum mixes the two and matches neither. Two
 * half-sums per band make a coincidental match between different rows much
 * rarer than one sum.
 *
 * @returns {{data: Int32Array, height: number, bands: number, samples: number}}
 *   data is laid out [row][band][even, odd]
 */
function rowSignature(buffer, width, height, columns = DEFAULT_COLUMNS, bands = DEFAULT_BANDS) {
    const nb = Math.max(1, Math.min(bands, Math.floor(width / 2)));
    const perBand = Math.max(2, Math.floor(columns / nb));
    const data = new Int32Array(height * nb * 2);
    const xs = new Int32Array(nb * perBand);
    for (let b = 0; b < nb; b++) {
        const x0 = b * width / nb;
        const bw = width / nb;
        for (let k = 0; k < perBand; k++) {
            xs[b * perBand + k] = Math.min(width - 1, Math.floor(x0 + (k + 0.5) * bw / perBand)) * 4;
        }
    }
    for (let r = 0; r < height; r++) {
        const base = r * width * 4;
        for (let b = 0; b < nb; b++) {
            let even = 0;
            let odd = 0;
            for (let k = 0; k < perBand; k++) {
                const i = base + xs[b * perBand + k];
                const v = buffer[i] + 2 * buffer[i + 1] + buffer[i + 2];
                if (k & 1) odd += v; else even += v;
            }
            const o = (r * nb + b) * 2;
            data[o] = even;
            data[o + 1] = odd;
        }
    }
    return { data, height, bands: nb, samples: perBand };
}

/**
 * Per-band vertical shift: for each band, the shift d (device px) in
 * [dMin, dMax] such that row r of `next` shows what row r + d of `prev`
 * showed. Only rows with vertical structure vote (blank bands match at every
 * shift), and a vote is "this row matches", so a sticky header, a playing
 * video or the newly exposed strip costs votes without dragging the result.
 * @private
 */
function bandShifts(prev, next, lo, hi, opts) {
    const { bands, samples } = next;
    const height = Math.min(prev.height, next.height);
    const matchTol = opts.matchTol !== undefined ? opts.matchTol : samples / 4;
    const edgeTol = opts.edgeTol !== undefined ? opts.edgeTol : samples * 2;
    const minVoters = opts.minVoters || 24;
    // Cost is bands x shifts x voters. A coarse pass over a few voters per
    // band screens the shifts; only the survivors get the full vote.
    const maxVoters = opts.maxVoters || 160;
    const coarseVoters = opts.coarseVoters || 32;
    const a = prev.data;
    const n = next.data;
    const rowStride = bands * 2;
    const span = hi - lo + 1;
    const results = [];
    const offsets = new Int32Array(height);
    const rowsOf = new Int32Array(height);
    const scores = new Float64Array(span);
    const votes = new Int32Array(span);
    const coarse = new Float64Array(span);

    // Fraction of the strided voters that match at shift d (0 below
    // minV voters); voters whose shifted row falls outside the frame abstain.
    // The matched count is left in lastMatches for the frame-level vote.
    let lastMatches = 0;
    const score = (count, stride, d, minV) => {
        const dOff = d * rowStride;
        let voters = 0;
        let matches = 0;
        for (let k = 0; k < count; k += stride) {
            const r = rowsOf[k] + d;
            if (r < 0 || r >= height) continue;
            voters++;
            const q = offsets[k];
            const p = q + dOff;
            const e = n[q] - a[p];
            if (e > matchTol || e < -matchTol) continue;
            const o = n[q + 1] - a[p + 1];
            if (o > matchTol || o < -matchTol) continue;
            matches++;
        }
        lastMatches = matches;
        return voters >= minV ? matches / voters : 0;
    };

    for (let b = 0; b < bands; b++) {
        let count = 0;
        for (let r = 1; r < height - 1; r++) {
            const q = r * rowStride + b * 2;
            const up = Math.abs(n[q] - n[q - rowStride]) + Math.abs(n[q + 1] - n[q + 1 - rowStride]);
            const down = Math.abs(n[q + rowStride] - n[q]) + Math.abs(n[q + 1 + rowStride] - n[q + 1]);
            if (up > edgeTol || down > edgeTol) {
                rowsOf[count] = r;
                offsets[count] = q;
                count++;
            }
        }
        if (count < minVoters) { results.push(null); continue; }
        const fullStride = Math.max(1, Math.floor(count / maxVoters));
        const coarseStride = Math.max(fullStride, Math.floor(count / coarseVoters));

        let coarseBest = 0;
        for (let d = lo; d <= hi; d++) {
            coarse[d - lo] = coarseStride > fullStride ? score(count, coarseStride, d, Math.min(minVoters, 8)) : 1;
            if (coarse[d - lo] > coarseBest) coarseBest = coarse[d - lo];
        }
        // Survivors: anything within reach of the coarse best, plus their
        // neighbours so the rival check sees adjacent shifts too.
        const keep = coarseBest * 0.5;
        let best = -1;
        for (let d = lo; d <= hi; d++) {
            const i = d - lo;
            const near = coarse[i] >= keep ||
                (i > 0 && coarse[i - 1] >= keep) || (i + 1 < span && coarse[i + 1] >= keep);
            if (!near) { scores[i] = 0; votes[i] = 0; continue; }
            scores[i] = score(count, fullStride, d, minVoters);
            votes[i] = scores[i] > 0 ? lastMatches : 0;
            if (best < 0 || scores[i] > scores[best - lo]) best = d;
        }
        if (best < 0) { results.push(null); continue; }
        let rival = 0;
        for (let d = lo; d <= hi; d++) {
            if (Math.abs(d - best) >= 2) rival = Math.max(rival, scores[d - lo]);
        }
        const bestScore = scores[best - lo];
        results.push({
            shift: best,
            score: bestScore,
            rival,
            weight: votes[best - lo],
            confident: bestScore >= 0.5 && rival <= bestScore * 0.5
        });
    }
    return results;
}

/**
 * Frame-level vertical shift from banded signatures, searched over
 * [dMin, dMax] device px. Each band that finds a confident shift votes for it
 * with its matched-row count; shifts within 1 px of each other pool.
 *
 * A moving pool beats the still (shift 0) pool once it carries a quarter of
 * the vote: sticky columns and headers legitimately vote 0 while the article
 * scrolls, but a page that did not scroll cannot make several bands agree on
 * one nonzero shift. Among moving pools the winner must outweigh the next
 * 1.5x. A lone animated band stays under the quarter and loses to the still
 * page.
 *
 * @returns {{shift:number, weight:number, rival:number, confident:boolean,
 *   bands:Array}|null}
 */
function estimateVerticalShift(prev, next, dMin, dMax, options = {}) {
    if (!prev || !next || prev.bands !== next.bands) return null;
    const height = Math.min(prev.height, next.height);
    const lo = Math.max(Math.ceil(dMin), -(height - 1));
    const hi = Math.min(Math.floor(dMax), height - 1);
    if (!(hi >= lo) || height < 8) return null;
    const bands = bandShifts(prev, next, lo, hi, options);
    const pools = new Map();
    for (const band of bands) {
        if (!band || !band.confident) continue;
        pools.set(band.shift, (pools.get(band.shift) || 0) + band.weight);
    }
    if (pools.size === 0) return null;
    const minVoters = options.minVoters || 24;
    const pooledWeight = (shift) =>
        (pools.get(shift) || 0) + (pools.get(shift - 1) || 0) + (pools.get(shift + 1) || 0);
    let total = 0;
    for (const w of pools.values()) total += w;
    const still = pooledWeight(0);
    const moving = [...pools.keys()].filter(s => Math.abs(s) >= 2)
        .map(shift => ({ shift, weight: pooledWeight(shift) }))
        .sort((x, y) => y.weight - x.weight);
    const lead = moving[0];
    let winner = null;
    let rival = 0;
    if (lead && lead.weight >= minVoters && lead.weight >= 0.25 * total) {
        for (const p of moving) {
            if (Math.abs(p.shift - lead.shift) >= 2) rival = Math.max(rival, p.weight);
        }
        if (lead.weight >= rival * 1.5) winner = lead;
    } else if (still >= minVoters) {
        rival = lead ? lead.weight : 0;
        if (still >= rival * 1.5) winner = { shift: 0, weight: still };
    }
    if (!winner) return { shift: lead ? lead.shift : 0, weight: lead ? lead.weight : still, rival, confident: false, bands };
    // The exact shift inside the winning pool is its band-heaviest member.
    let shift = winner.shift;
    for (const s of [winner.shift - 1, winner.shift + 1]) {
        if ((pools.get(s) || 0) > (pools.get(shift) || 0)) shift = s;
    }
    return { shift, weight: winner.weight, rival, confident: true, bands };
}

/**
 * Names the page scroll position each captured frame shows.
 *
 * Feed it every frame in arrival order. Two regimes:
 *
 * Window idle (no scroll reported for several captures): the stamp is exact
 * for the window's scroll, and the frame is drawn as captured. Pixel motion
 * here comes from an inner scroller, an animation, or a window scroll whose
 * event has not reached main yet; none of those is a window offset, so
 * booking it as one would shift the whole frame. A frame becomes the
 * reference only when its pixels match the previous idle frame unmoved: two
 * identical captures under one stamp are at that stamp, while a scroll-onset
 * frame (moved, still labelled with the stale stamp) differs from the frame
 * before it and cannot anchor the chain. Comparing with the previous frame
 * rather than the reference keeps a reference captured mid-load from going
 * stale for good. Such a frame is drawn from its stamp; if a window scroll
 * then reaches the HUD, reviseForScroll() re-registers it against the
 * reference and corrects its label in place.
 *
 * Window scrolling (or just stopped): the frame registers against the
 * reference, the last frame whose position is known. Its scroll is the
 * reference's plus the row shift between the two, searched in a window around
 * this frame's stamps. When the pixels did not move and the stamps agree the
 * page has settled and the stamp is exact. Unmoved stamps alone do not mean
 * settled: during a wheel scroll the scroll event can stall for two captures
 * while the page keeps painting.
 *
 * A scrolling frame that cannot be matched gets its post-capture stamp, which
 * can be a scroll step off, and comes back `trusted: false`: the caller should
 * keep the registered frame it has (the live offset keeps it on the page)
 * rather than draw this one off by a step. The stamp is trusted instead once
 * the stamps have settled, for a jump too long to search (Page Down, Home),
 * or after maxMisses misses in a row, so the HUD never waits long.
 */
class FrameScrollRegistrar {
    constructor(options = {}) {
        this.columns = options.columns || DEFAULT_COLUMNS;
        this.bands = options.bands || DEFAULT_BANDS;
        this.maxSearchPx = options.maxSearchPx || 2400;
        this.maxMisses = options.maxMisses || 3;
        this.reset();
    }

    reset() {
        this.ref = null;
        this.lastStampY = null;
        this.motionPeak = 0;
        this.imageStep = 0;
        this.direction = 0;
        this.idlePrev = null;
        this.suspect = null;
        this.misses = 0;
        this.lastMethod = 'none';
    }

    /**
     * The live scroll moved. If the frame on screen is an idle frame whose
     * pixels had moved (likely the first frame of this scroll, labelled with
     * the stamp from before it), register it against the reference now that
     * the scroll's extent is known, and fix its label in place: the object
     * register() returned is the one the renderer holds. Runs once per
     * suspect frame.
     * @param {{y:number, zoom?:number}} live
     * @returns {boolean} whether the label changed
     */
    reviseForScroll(live) {
        const suspect = this.suspect;
        this.suspect = null;
        const ref = this.ref;
        const liveY = finite(live && live.y, NaN);
        if (!suspect || !ref || !Number.isFinite(liveY) || suspect.ref !== ref) return false;
        if (Math.abs(scrollZoom(live) - ref.zoom) > 1e-3) return false;
        const span = Math.abs(liveY - ref.y);
        if (span === 0) return false;
        const dir = Math.sign(liveY - ref.y);
        const slack = Math.max(4, span);
        const lo = Math.min(ref.y, liveY) - (dir < 0 ? slack : 2);
        const hi = Math.max(ref.y, liveY) + (dir > 0 ? slack : 2);
        if ((hi - lo) * ref.scale > this.maxSearchPx) return false;
        const est = estimateVerticalShift(ref.sig, suspect.sig, (lo - ref.y) * ref.scale, (hi - ref.y) * ref.scale);
        if (!est || !est.confident || est.shift === 0) return false;
        suspect.result.y = ref.y + est.shift / ref.scale;
        suspect.result.method = 'revised';
        this.ref = { sig: suspect.sig, width: ref.width, height: ref.height, zoom: ref.zoom, scale: ref.scale, y: suspect.result.y };
        this.imageStep = Math.abs(suspect.result.y - ref.y);
        return true;
    }

    /**
     * @param {Object} frame
     * @param {Uint8Array} frame.buffer   BGRA pixels
     * @param {number} frame.width        device px
     * @param {number} frame.height       device px
     * @param {number} frame.viewWidth    DIP width the capture covers
     * @param {Object} frame.stamp        {x, y, zoom} read after capture
     * @param {Object} [frame.stampBefore] {x, y, zoom} read at capture request
     * @returns {{x:number, y:number, zoom:number, method:string, trusted:boolean}}
     */
    register(frame) {
        const stamp = frame.stamp || { x: 0, y: 0 };
        const before = frame.stampBefore || stamp;
        const zoom = scrollZoom(stamp);
        const stampY = finite(stamp.y);
        const beforeY = finite(before.y, stampY);
        const result = { x: finite(stamp.x), y: stampY, zoom, method: 'stamp', trusted: true };
        const width = frame.width | 0;
        const height = frame.height | 0;
        const viewWidth = finite(frame.viewWidth);
        if (!frame.buffer || width <= 0 || height <= 0 || viewWidth <= 0 ||
            frame.buffer.length < width * height * 4) {
            this.reset();
            this.lastMethod = result.method;
            return result;
        }
        // Device px per CSS px of page scroll.
        const scale = (width / viewWidth) * zoom;
        const sig = rowSignature(frame.buffer, width, height, this.columns, this.bands);
        const ref = this.ref;
        const comparable = ref && ref.width === width && ref.height === height &&
            Math.abs(ref.zoom - zoom) < 1e-3 && Math.abs(ref.scale - scale) < 1e-6;
        const prevStampY = this.lastStampY === null ? stampY : this.lastStampY;
        this.lastStampY = stampY;
        const anchor = (y, step) => {
            this.ref = { sig, width, height, zoom, scale, y };
            this.imageStep = step;
            this.misses = 0;
        };
        const done = () => { this.lastMethod = result.method; return result; };

        if (!comparable) {
            anchor(result.y, 0);
            this.idlePrev = { sig, y: result.y };
            return done();
        }

        const stampMotion = Math.max(Math.abs(stampY - prevStampY), Math.abs(stampY - beforeY));
        const settled = stampMotion === 0;
        // Recent motion per capture, from the stamps and from the last
        // image-measured step (truthful when the stamps stall). It decays
        // rather than drops so a stall keeps the search window wide.
        this.motionPeak = Math.max(stampMotion, this.imageStep, this.motionPeak * 0.8);

        if (this.motionPeak < 1) {
            const prev = this.idlePrev;
            this.idlePrev = { sig, y: result.y };
            const est = prev && prev.y === result.y
                ? estimateVerticalShift(prev.sig, sig, -scale, scale) : null;
            if (est && est.confident && est.shift === 0) {
                result.method = 'still';
                anchor(result.y, 0);
                this.suspect = null;
            } else {
                this.suspect = { sig, result, ref: this.ref };
            }
            return done();
        }
        this.idlePrev = null;
        this.suspect = null;

        // The stamps trail the pixels: the request-time read was never ahead
        // of the frame in any measured run, and the post-capture read was at
        // most a step either side. So the window opens a full slack only in
        // the direction of motion and a 2 px margin behind. That keeps the
        // reference's own position (shift 0, where sticky columns vote) out
        // of the window once the page has moved away from it. A stall keeps
        // the last direction.
        const dir = Math.sign(stampY - beforeY) || Math.sign(stampY - prevStampY) || this.direction;
        if (dir) this.direction = dir;
        const slack = Math.max(4, 2 * this.motionPeak);
        const margin = 2;
        const lo = Math.min(beforeY, stampY) - (dir > 0 ? margin : slack);
        const hi = Math.max(beforeY, stampY) + (dir < 0 ? margin : slack);
        const dMin = (lo - ref.y) * scale;
        const dMax = (hi - ref.y) * scale;
        const searchable = dMax - dMin <= this.maxSearchPx;
        const est = searchable ? estimateVerticalShift(ref.sig, sig, dMin, dMax) : null;
        if (est && est.confident) {
            if (est.shift === 0 && settled) {
                result.method = 'still';
            } else {
                result.y = ref.y + est.shift / scale;
                result.method = 'image';
            }
            anchor(result.y, Math.abs(result.y - ref.y) / (this.misses + 1));
        } else if (settled || !searchable || ++this.misses > this.maxMisses) {
            anchor(result.y, 0);
        } else {
            result.trusted = false;
        }
        return done();
    }
}

// The shader's u_scroll_lock array length (renderer/shaders/peripheral.frag).
const MAX_SCROLL_LOCK_RECTS = 16;

/**
 * Scroll-locked boxes as UV rects for the shader. Position-fixed boxes, and
 * sticky ones while stuck, keep their screen position while the page scrolls,
 * so the HUD must not shift the frame inside them. The DOM scan reports them
 * as viewport DIP rects {x, y, w, h}; this clips them to a cssW x cssH DIP
 * view and returns [x0, y0, x1, y1] in UV (0..1, y down). Rects inside a
 * larger kept rect are dropped, and past `max` the largest win.
 *
 * @returns {Array<number[]>}
 */
function scrollLockUvRects(rects, cssW, cssH, max = MAX_SCROLL_LOCK_RECTS) {
    if (!Array.isArray(rects) || !(cssW > 0) || !(cssH > 0)) return [];
    const uv = [];
    for (const r of rects) {
        if (!r) continue;
        const x0 = Math.max(0, finite(r.x) / cssW);
        const y0 = Math.max(0, finite(r.y) / cssH);
        const x1 = Math.min(1, (finite(r.x) + finite(r.w)) / cssW);
        const y1 = Math.min(1, (finite(r.y) + finite(r.h)) / cssH);
        if (x1 > x0 && y1 > y0) uv.push([x0, y0, x1, y1]);
    }
    uv.sort((a, b) => (b[2] - b[0]) * (b[3] - b[1]) - (a[2] - a[0]) * (a[3] - a[1]));
    const kept = [];
    for (const r of uv) {
        if (kept.length >= max) break;
        const inside = kept.some(k => r[0] >= k[0] && r[1] >= k[1] && r[2] <= k[2] && r[3] <= k[3]);
        if (!inside) kept.push(r);
    }
    return kept;
}

/** Whether UV point (u, v) falls in a lock rect; edges as in the shader. */
function inScrollLock(uvRects, u, v) {
    if (!Array.isArray(uvRects)) return false;
    return uvRects.some(r => u >= r[0] && v >= r[1] && u < r[2] && v < r[3]);
}

module.exports = {
    scrollZoom,
    scrollToDip,
    registrationOffsetDip,
    rowSignature,
    estimateVerticalShift,
    FrameScrollRegistrar,
    MAX_SCROLL_LOCK_RECTS,
    scrollLockUvRects,
    inScrollLock
};
