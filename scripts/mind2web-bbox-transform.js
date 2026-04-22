/**
 * Mind2Web bounding-box coordinate transforms.
 *
 * Prior art: docs/adserp-coordinate-system.md documents the exact failure
 * mode this file prevents — mixing document-space with screen-space silently.
 *
 * Terms
 * -----
 * doc-space   — pixels relative to the top-left of the full rendered document.
 *               Mind2Web's `bounding_box_rect` values are captured here at
 *               1280px-wide reflow. Y can exceed viewport height.
 * screen-space — pixels relative to the top-left of the 1280x768 Scrutinizer
 *               viewport. This is what the peripheral shader samples against.
 * scroll_y    — document-space pixels scrolled off the top of the viewport.
 *               screen_y = doc_y - scroll_y.
 *
 * Transforms are pure and symmetric. All failure modes throw explicitly —
 * silent out-of-viewport coordinates produce a distinctiveness sample at a
 * garbage pixel that looks plausible (the mode-15 failure class).
 */

'use strict';

// Defaults match the Arm-0 config (tests/validation/mind2web/arm-0-config.json).
// Callers should pass the viewport dims explicitly; this is only a fallback.
const DEFAULT_VIEWPORT = { w: 1280, h: 768 };

/**
 * Parse a Mind2Web bounding_box_rect string "x,y,w,h" into numbers.
 * Returns null on malformed input.
 */
function parseBbox(rectStr) {
    if (typeof rectStr !== 'string') return null;
    const parts = rectStr.split(',');
    if (parts.length !== 4) return null;
    const [x, y, w, h] = parts.map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
    if (w <= 0 || h <= 0) return null;
    return { x, y, w, h };
}

/**
 * Document-space bbox center → {x, y}.
 */
function docBboxCenter(bbox) {
    return { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 };
}

/**
 * Document-space point → screen-space. Throws if the point falls outside the
 * viewport after scroll correction — callers must pick a scroll_y that keeps
 * the point in view.
 */
function docToScreen(point, scroll_y, viewport = DEFAULT_VIEWPORT) {
    if (!Number.isFinite(scroll_y) || scroll_y < 0) {
        throw new Error(`scroll_y must be a non-negative finite number, got ${scroll_y}`);
    }
    const screen_x = point.x;
    const screen_y = point.y - scroll_y;
    if (screen_x < 0 || screen_x >= viewport.w) {
        throw new Error(`screen_x ${screen_x.toFixed(1)} is outside viewport [0, ${viewport.w})`);
    }
    if (screen_y < 0 || screen_y >= viewport.h) {
        throw new Error(`screen_y ${screen_y.toFixed(1)} is outside viewport [0, ${viewport.h}) at scroll_y=${scroll_y}`);
    }
    return { x: screen_x, y: screen_y };
}

/**
 * Inverse: screen-space point → document-space. Pure arithmetic, no bounds
 * check (screen→doc always succeeds; the doc value is just the unshifted Y).
 */
function screenToDoc(point, scroll_y) {
    return { x: point.x, y: point.y + scroll_y };
}

/**
 * Pick a scroll offset that puts the target bbox center near the vertical
 * middle of the viewport. Mirrors AdSERP's "user scrolls to bring target
 * roughly to center" assumption; documented in the memo as
 * scroll_gaze_policy=post_scroll_viewport_center.
 *
 * Returns scroll_y clamped to [0, max_scroll] where max_scroll keeps the page
 * from scrolling past its own end. Callers must supply the document height.
 *
 * @param {object} target_bbox - doc-space {x, y, w, h}
 * @param {number} doc_height  - doc-space total document height
 * @param {object} [viewport]
 * @returns {number} scroll_y in doc-space pixels
 */
function pickScrollForTarget(target_bbox, doc_height, viewport = DEFAULT_VIEWPORT) {
    if (!Number.isFinite(doc_height) || doc_height <= 0) {
        throw new Error(`doc_height must be a positive finite number, got ${doc_height}`);
    }
    const center_y = target_bbox.y + target_bbox.h / 2;
    const desired = center_y - viewport.h / 2;
    const max_scroll = Math.max(0, doc_height - viewport.h);
    return Math.max(0, Math.min(max_scroll, Math.round(desired)));
}

/**
 * Return true iff the bbox has non-zero overlap with the viewport after the
 * given scroll. Used to filter distractors that are off-screen at this
 * scroll — we cannot sample a pooled-stat at a pixel that isn't rendered.
 */
function bboxVisibleAfterScroll(bbox, scroll_y, viewport = DEFAULT_VIEWPORT) {
    const screen_top = bbox.y - scroll_y;
    const screen_bottom = screen_top + bbox.h;
    const screen_left = bbox.x;
    const screen_right = screen_left + bbox.w;
    if (screen_bottom <= 0 || screen_top >= viewport.h) return false;
    if (screen_right <= 0 || screen_left >= viewport.w) return false;
    return true;
}

/**
 * Eccentricity in pixels between two screen-space points.
 */
function screenEccentricityPx(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
}

module.exports = {
    DEFAULT_VIEWPORT,
    parseBbox,
    docBboxCenter,
    docToScreen,
    screenToDoc,
    pickScrollForTarget,
    bboxVisibleAfterScroll,
    screenEccentricityPx,
};
