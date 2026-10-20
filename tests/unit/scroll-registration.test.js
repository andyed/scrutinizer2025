'use strict';

const {
    scrollToDip,
    registrationOffsetDip,
    rowSignature,
    estimateVerticalShift,
    FrameScrollRegistrar,
    MAX_SCROLL_LOCK_RECTS,
    scrollLockUvRects,
    inScrollLock
} = require('../../shared/scroll-registration');

// Synthetic text page: 18 px line pitch, blank leading between lines, a
// blank left margin, and glyph rows whose ink differs row to row the way
// letterforms do (so no two rows of a line share a signature).
function makePage(width, height, seed = 11) {
    const page = new Uint8Array(width * height * 4).fill(255);
    let s = seed;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let line = 0; line * 18 + 14 < height; line++) {
        const top = line * 18 + 3;
        let x = 40;
        while (x < width - 20) {
            const run = 3 + Math.floor(rnd() * 40);
            for (let y = top; y < top + 11; y++) {
                for (let xx = x; xx < Math.min(width - 20, x + run); xx++) {
                    if (rnd() < 0.55) continue;
                    const ink = Math.floor(rnd() * 120);
                    const i = (y * width + xx) * 4;
                    page[i] = ink; page[i + 1] = ink; page[i + 2] = ink;
                }
            }
            x += run + 4 + Math.floor(rnd() * 10);
        }
    }
    return page;
}

// Horizontal stripes with a 4 px period: every shift by a multiple of 4
// matches perfectly, so no estimate should claim confidence.
function makeStripes(width, height) {
    const page = new Uint8Array(width * height * 4).fill(255);
    for (let y = 0; y < height; y++) {
        if (y % 4 >= 2) continue;
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            page[i] = 0; page[i + 1] = 0; page[i + 2] = 0;
        }
    }
    return page;
}

// Viewport crop of the page at a scroll offset (device px), optionally with a
// sticky header painted over the top `header` rows and a sticky sidebar
// (static text that does not scroll) over columns [sidebar[0], sidebar[1]).
function crop(page, width, top, height, header = 0, sidebar = null) {
    const out = new Uint8Array(width * height * 4);
    out.set(page.subarray(top * width * 4, (top + height) * width * 4));
    for (let y = 0; y < header; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const v = (x % 50 < 25) ? 30 : 200;
            out[i] = v; out[i + 1] = v; out[i + 2] = v;
        }
    }
    if (sidebar) {
        // Fixed content: the same pixels at every scroll.
        const fixed = makePage(sidebar[1] - sidebar[0], height, 97);
        for (let y = 0; y < height; y++) {
            for (let x = sidebar[0]; x < sidebar[1]; x++) {
                const i = (y * width + x) * 4;
                const j = (y * (sidebar[1] - sidebar[0]) + (x - sidebar[0])) * 4;
                out[i] = fixed[j]; out[i + 1] = fixed[j + 1]; out[i + 2] = fixed[j + 2];
            }
        }
    }
    return out;
}

describe('scroll offsets in DIP', () => {
    it('scales CSS scroll by the page zoom', () => {
        expect(scrollToDip({ x: 10, y: 100, zoom: 1.5 })).toEqual({ x: 15, y: 150 });
        expect(scrollToDip({ scrollX: 4, scrollY: 8 })).toEqual({ x: 4, y: 8 });
    });

    it('reports how far the live page has scrolled past the source', () => {
        expect(registrationOffsetDip({ x: 0, y: 100 }, { x: 0, y: 140 })).toEqual({ x: 0, y: 40 });
        expect(registrationOffsetDip({ x: 0, y: 100, zoom: 2 }, { x: 0, y: 90, zoom: 2 })).toEqual({ x: 0, y: -20 });
    });

    it('drops the offset when the source is missing or the zoom changed', () => {
        expect(registrationOffsetDip(null, { x: 0, y: 140 })).toEqual({ x: 0, y: 0 });
        expect(registrationOffsetDip({ x: 0, y: 100, zoom: 1 }, { x: 0, y: 140, zoom: 1.25 })).toEqual({ x: 0, y: 0 });
    });
});

describe('vertical shift estimate', () => {
    const W = 320, H = 240, page = makePage(W, 2400);

    it('recovers the exact row shift between two crops', () => {
        const prev = rowSignature(crop(page, W, 300, H), W, H);
        const next = rowSignature(crop(page, W, 337, H), W, H);
        const est = estimateVerticalShift(prev, next, 0, 80);
        expect(est.confident).toBe(true);
        expect(est.shift).toBe(37);
    });

    it('is not fooled by line pitch or a sticky header', () => {
        const prev = rowSignature(crop(page, W, 300, H, 30), W, H);
        const next = rowSignature(crop(page, W, 318, H, 30), W, H);
        // 18 px = one line pitch; the window holds 0, 18 and 36.
        const est = estimateVerticalShift(prev, next, -4, 40);
        expect(est.confident).toBe(true);
        expect(est.shift).toBe(18);
    });

    it('follows the article column past a sticky sidebar', () => {
        // Sidebar covers 3 of 8 bands and holds still; the rest scrolls.
        const prev = rowSignature(crop(page, W, 300, H, 0, [0, 120]), W, H);
        const next = rowSignature(crop(page, W, 324, H, 0, [0, 120]), W, H);
        const est = estimateVerticalShift(prev, next, -10, 50);
        expect(est.confident).toBe(true);
        expect(est.shift).toBe(24);
        expect(est.bands.filter(b => b && b.confident && b.shift === 0).length).toBeGreaterThan(0);
    });

    it('declines to pick among periodic matches', () => {
        const stripes = makeStripes(W, 2400);
        const prev = rowSignature(crop(stripes, W, 300, H), W, H);
        const next = rowSignature(crop(stripes, W, 312, H), W, H);
        const est = estimateVerticalShift(prev, next, 0, 30);
        expect(est && est.confident).toBeFalsy();
    });

    it('declines to guess on a blank page', () => {
        const blank = new Uint8Array(W * H * 4).fill(255);
        const sig = rowSignature(blank, W, H);
        expect(estimateVerticalShift(sig, sig, -10, 10)).toBeNull();
    });
});

describe('FrameScrollRegistrar', () => {
    const W = 320, H = 240, page = makePage(W, 4000);
    // viewWidth in DIP: at 2x the 320 px frame covers 160 DIP.
    const frameAt = (cssY, stampY, stampBeforeY, scaleFactor = 2) => ({
        buffer: crop(page, W, Math.round(cssY * scaleFactor), H),
        width: W, height: H, viewWidth: W / scaleFactor,
        stamp: { x: 0, y: stampY, zoom: 1 },
        stampBefore: { x: 0, y: stampBeforeY, zoom: 1 }
    });

    it('names the true scroll when the stamps are a frame off', () => {
        const reg = new FrameScrollRegistrar();
        expect(reg.register(frameAt(100, 100, 100)).y).toBe(100);
        // Pixels at 111 while the stamps say 103 (after) and 95 (before).
        const second = reg.register(frameAt(111, 103, 95));
        expect(second.method).toBe('image');
        expect(second.y).toBe(111);
        const third = reg.register(frameAt(126.5, 134, 118));
        expect(third.method).toBe('image');
        expect(third.y).toBe(126.5);
    });

    it('keeps tracking when the scroll event stalls mid-scroll', () => {
        // Wheel scroll: the page paints 108 -> 124 while main still holds
        // 108, so both stamps and the previous stamp agree on a stale value.
        const reg = new FrameScrollRegistrar();
        reg.register(frameAt(100, 100, 100));
        expect(reg.register(frameAt(116, 108, 100)).y).toBe(116);
        const stalled = reg.register(frameAt(124, 108, 108));
        expect(stalled.method).toBe('image');
        expect(stalled.y).toBe(124);
        expect(reg.register(frameAt(140, 132, 124)).y).toBe(140);
    });

    it('clears chain error once the page is idle', () => {
        const reg = new FrameScrollRegistrar();
        reg.register(frameAt(100, 100, 100));
        // A blank frame forces the stamp fallback, one step off the pixels.
        const blank = { ...frameAt(120, 112, 104), buffer: new Uint8Array(W * H * 4).fill(255) };
        expect(reg.register(blank).y).toBe(112);
        reg.register(frameAt(120, 120, 120));
        const idle = reg.register(frameAt(120, 120, 120));
        expect(idle.method).toBe('still');
        expect(idle.y).toBe(120);
    });

    it('does not let a scroll-onset frame anchor the chain', () => {
        const reg = new FrameScrollRegistrar();
        reg.register(frameAt(100, 100, 100));
        reg.register(frameAt(100, 100, 100));
        // The page has started moving but main has not heard of it yet: drawn
        // from the stamp, as captured, and not used as the reference.
        const onset = reg.register(frameAt(108, 100, 100));
        expect(onset.trusted).toBe(true);
        expect(onset.y).toBe(100);
        const next = reg.register(frameAt(124, 116, 108));
        expect(next.method).toBe('image');
        expect(next.y).toBe(124);
    });

    it('corrects the onset frame label once the scroll reaches the HUD', () => {
        const reg = new FrameScrollRegistrar();
        reg.register(frameAt(100, 100, 100));
        reg.register(frameAt(100, 100, 100));
        const onset = reg.register(frameAt(108, 100, 100));
        expect(onset.y).toBe(100);
        expect(reg.reviseForScroll({ y: 116, zoom: 1 })).toBe(true);
        // Same object the renderer holds, fixed in place.
        expect(onset.y).toBe(108);
        expect(onset.method).toBe('revised');
        // Later frames register against the revised frame.
        expect(reg.register(frameAt(124, 124, 116)).y).toBe(124);
    });

    it('never books an inner scroller as window scroll', () => {
        // Window scroll stays 0 while the right half of the viewport scrolls
        // its own content 4 device px per capture (inside the search window).
        const inner = (k) => {
            const left = crop(page, W, 0, H);
            const right = crop(page, W, 400 + k * 4, H);
            const out = new Uint8Array(left);
            for (let y = 0; y < H; y++) {
                const row = y * W * 4;
                out.set(right.subarray(row + (W / 2) * 4, row + W * 4), row + (W / 2) * 4);
            }
            return { buffer: out, width: W, height: H, viewWidth: W / 2,
                stamp: { x: 0, y: 0, zoom: 1 }, stampBefore: { x: 0, y: 0, zoom: 1 } };
        };
        const reg = new FrameScrollRegistrar();
        const ys = [0, 1, 2, 3, 4, 5, 6, 7].map(k => reg.register(inner(k)));
        expect(ys.every(r => r.y === 0 && r.trusted)).toBe(true);
        // No window scroll arrives, so nothing is revised; a stray live update
        // equal to the stamp changes nothing either.
        expect(reg.reviseForScroll({ y: 0, zoom: 1 })).toBe(false);
    });

    it('keeps the reference position out of the window once the page moved away', () => {
        // Pixels that never move (all-sticky content) while the stamps say
        // the page scrolled 0 -> 240. Shift 0 matches perfectly, so it must
        // not be a candidate: matching it would pin the frame at 0.
        const reg = new FrameScrollRegistrar();
        const frozen = (stampY, beforeY) => ({ ...frameAt(0, stampY, beforeY), buffer: crop(page, W, 0, H) });
        reg.register(frozen(0, 0));
        reg.register(frozen(0, 0));
        reg.register(frozen(120, 40));
        const r = reg.register(frozen(240, 200));
        expect(r.method).not.toBe('image');
        expect(r.y).toBeGreaterThanOrEqual(198);
    });

    it('replaces a reference captured mid-load once the page holds still', () => {
        const reg = new FrameScrollRegistrar();
        // First frame after navigation: half-rendered page.
        const loading = { ...frameAt(0, 0, 0), buffer: crop(page, W, 1200, H) };
        reg.register(loading);
        reg.register(frameAt(0, 0, 0));
        expect(reg.register(frameAt(0, 0, 0)).method).toBe('still');
        // The scroll that follows registers against the loaded page.
        const r = reg.register(frameAt(12, 8, 0));
        expect(r.method).toBe('image');
        expect(r.y).toBe(12);
    });

    it('trusts the stamp when the page held still across captures', () => {
        const reg = new FrameScrollRegistrar();
        reg.register(frameAt(200, 200, 200));
        const still = reg.register(frameAt(200, 200, 200));
        expect(still.method).toBe('still');
        expect(still.y).toBe(200);
        expect(still.trusted).toBe(true);
    });

    it('does not chain a fallback stamp into later frames', () => {
        const reg = new FrameScrollRegistrar();
        reg.register(frameAt(100, 100, 100));
        // Unmatchable frame: stamp says 120, pixels are at 112.
        const blank = { ...frameAt(112, 120, 104), buffer: new Uint8Array(W * H * 4).fill(255) };
        const missed = reg.register(blank);
        expect(missed.method).toBe('stamp');
        expect(missed.trusted).toBe(false);
        // The next frame registers against the 100 reference, not the 120 stamp.
        const next = reg.register(frameAt(124, 128, 116));
        expect(next.method).toBe('image');
        expect(next.y).toBe(124);
    });

    it('falls back to the post-capture stamp when nothing matches', () => {
        const reg = new FrameScrollRegistrar();
        reg.register(frameAt(100, 100, 100));
        const blank = { ...frameAt(130, 130, 120), buffer: new Uint8Array(W * H * 4).fill(255) };
        const r = reg.register(blank);
        expect(r.method).toBe('stamp');
        expect(r.y).toBe(130);
        // Mid-scroll, so the caller should keep the frame it has.
        expect(r.trusted).toBe(false);
    });

    it('trusts an unmatched stamp when the page is idle', () => {
        const reg = new FrameScrollRegistrar();
        const blank = (y) => ({ ...frameAt(y, y, y), buffer: new Uint8Array(W * H * 4).fill(255) });
        reg.register(blank(50));
        const idle = reg.register(blank(50));
        expect(idle.method).toBe('stamp');
        expect(idle.trusted).toBe(true);
    });

    it('re-anchors after repeated misses so a page that never matches still updates', () => {
        const reg = new FrameScrollRegistrar({ maxMisses: 3 });
        const blank = (y, before) => ({ ...frameAt(y, y, before), buffer: new Uint8Array(W * H * 4).fill(255) });
        reg.register(blank(0, 0));
        const trust = [10, 20, 30, 40, 50].map(y => reg.register(blank(y, y - 10)).trusted);
        expect(trust).toEqual([false, false, false, true, false]);
    });

    it('starts over after a resize', () => {
        const reg = new FrameScrollRegistrar();
        reg.register(frameAt(100, 100, 100));
        const resized = { ...frameAt(120, 117, 110), height: H - 40, buffer: crop(page, W, 240, H - 40) };
        expect(reg.register(resized).method).toBe('stamp');
    });
});

describe('scrollLockUvRects', () => {
    it('converts viewport DIP rects to UV over the view', () => {
        // Wikipedia's stuck TOC column at 1920x1012.
        const uv = scrollLockUvRects([{ x: 202, y: 24, w: 260, h: 421 }], 1920, 1012);
        expect(uv).toHaveLength(1);
        expect(uv[0][0]).toBeCloseTo(202 / 1920, 9);
        expect(uv[0][1]).toBeCloseTo(24 / 1012, 9);
        expect(uv[0][2]).toBeCloseTo(462 / 1920, 9);
        expect(uv[0][3]).toBeCloseTo(445 / 1012, 9);
    });

    it('clips to the view and drops empty or malformed rects', () => {
        const uv = scrollLockUvRects([
            { x: -50, y: 900, w: 200, h: 300 },
            { x: 10, y: 10, w: 0, h: 50 },
            { x: 2000, y: 0, w: 40, h: 40 },
            null,
            { x: NaN, y: 0, w: 10, h: 10 }
        ], 1000, 1000);
        expect(uv).toEqual([[0, 0.9, 0.15, 1], [0, 0, 0.01, 0.01]]);
    });

    it('drops boxes nested in a kept box and keeps the largest past the cap', () => {
        expect(scrollLockUvRects([
            { x: 0, y: 0, w: 100, h: 50 },
            { x: 10, y: 10, w: 20, h: 20 }
        ], 100, 100)).toEqual([[0, 0, 1, 0.5]]);
        const many = Array.from({ length: 40 }, (_, i) => ({ x: i * 10, y: 0, w: 5, h: 1 + i }));
        const kept = scrollLockUvRects(many, 1000, 1000);
        expect(kept).toHaveLength(MAX_SCROLL_LOCK_RECTS);
        expect(kept[0][3]).toBeCloseTo(40 / 1000, 9);
    });

    it('returns no rects without a view size', () => {
        expect(scrollLockUvRects([{ x: 0, y: 0, w: 10, h: 10 }], 0, 100)).toEqual([]);
        expect(scrollLockUvRects(undefined, 100, 100)).toEqual([]);
    });
});

describe('inScrollLock', () => {
    it('includes the min edge and excludes the max edge, as the shader does', () => {
        const rects = [[0.25, 0.5, 0.75, 1]];
        expect(inScrollLock(rects, 0.25, 0.5)).toBe(true);
        expect(inScrollLock(rects, 0.5, 0.75)).toBe(true);
        expect(inScrollLock(rects, 0.75, 0.75)).toBe(false);
        expect(inScrollLock(rects, 0.5, 0.49)).toBe(false);
        expect(inScrollLock([], 0.5, 0.5)).toBe(false);
        expect(inScrollLock(null, 0.5, 0.5)).toBe(false);
    });
});
