/**
 * DOM primitive classifier for the DOM-aware peripheral perception path.
 *
 * Maps a DOM element to one of 8 perceptual primitive types:
 *   text, link, heading, icon, form_input, button, nav_item, image
 * (plus ui_surface as the fall-through residual for landmarks and chrome).
 *
 * Stays pure-JS-only (no electron imports) so Jest can test the logic
 * against JSDOM fixtures without stubbing renderer context.
 *
 * See docs/dom-aware-perception-plan.md for the primitive taxonomy and
 * how this feeds peripheral-calibration.js + the compositor.
 */

'use strict';

/**
 * Classify an element into one of 9 perceptual primitive types.
 *
 * Order matters: the first rule that matches wins. Heading is checked
 * before link/button because an <a> inside an <h1> is still perceptually
 * a heading at the bbox level.
 *
 * @param {HTMLElement} el
 * @returns {string} text | link | heading | icon | form_input | button |
 *                   nav_item | image | ui_surface
 */
function classifyPrimitive(el) {
    if (!el) return 'ui_surface';

    const tag = el.tagName && el.tagName.toLowerCase();
    const role = typeof el.getAttribute === 'function' ? el.getAttribute('role') : null;
    const type = typeof el.getAttribute === 'function' ? el.getAttribute('type') : null;

    // 1. Heading
    if (role === 'heading' || /^h[1-6]$/.test(tag || '')) return 'heading';

    // 2. Form input (text-entry controls). Checked before 'button' so submit
    // buttons are classified as 'button' rather than form_input.
    if (role === 'searchbox' || role === 'combobox' || role === 'textbox') return 'form_input';
    if (tag === 'textarea' || tag === 'select') return 'form_input';
    if (tag === 'input') {
        if (type === 'submit' || type === 'reset' || type === 'button') return 'button';
        if (type === 'checkbox' || type === 'radio') return 'button';
        return 'form_input';
    }

    // 3. Button
    if (role === 'button' || tag === 'button') return 'button';
    if (role === 'checkbox' || role === 'radio' || role === 'switch') return 'button';

    // 4. Nav item — descendants of a nav container are nav_items; the whole
    // nav element itself also lands here.
    if (role === 'navigation' || role === 'menubar' || tag === 'nav') return 'nav_item';
    if (role === 'menu' || role === 'menuitem' || role === 'tab' || role === 'tablist') return 'nav_item';

    // 5. Icon — small SVG/img in an interactive ancestor, or with an
    // aria-label (accessibility signal that a graphic carries meaning).
    // Runs before the generic 'image' fallback so a 24×24 toolbar SVG becomes
    // an icon, not an image.
    const iconBboxLimit = 48; // px; empirical upper bound for icon-sized graphics
    if (tag === 'svg' || tag === 'img' || tag === 'picture') {
        const r = typeof el.getBoundingClientRect === 'function'
            ? el.getBoundingClientRect()
            : null;
        const isSmall = r && r.width > 0 && r.height > 0 &&
                        r.width <= iconBboxLimit && r.height <= iconBboxLimit;
        const hasLabel = (typeof el.getAttribute === 'function') &&
                         (el.getAttribute('aria-label') || el.getAttribute('alt'));
        const inInteractive = typeof el.closest === 'function'
            ? !!el.closest('a, button, [role=button], [role=link]')
            : false;
        if (isSmall && (hasLabel || inInteractive)) return 'icon';
    }

    // 6. Link
    if (role === 'link' || tag === 'a') return 'link';

    // 7. Image (media fallback). Larger/un-labeled graphics land here.
    if (tag === 'img' || tag === 'svg' || tag === 'video' ||
        tag === 'canvas' || tag === 'picture') return 'image';

    // 8. Landmarks and chrome — 'ui_surface' tells the compositor to fall
    // through to the baseline peripheral pipeline.
    if (tag === 'header' || tag === 'footer' || tag === 'aside' || tag === 'main') return 'ui_surface';
    if (role === 'banner' || role === 'toolbar' || role === 'contentinfo' ||
        role === 'dialog' || role === 'alertdialog' || role === 'complementary' ||
        role === 'main') return 'ui_surface';

    // Default: body content is text. Caller may override if the element
    // has no text content (e.g., an empty wrapper <div>).
    return 'text';
}

const PRIMITIVE_TYPES = [
    'text', 'link', 'heading', 'icon',
    'form_input', 'button', 'nav_item', 'image', 'ui_surface'
];

module.exports = {
    classifyPrimitive,
    PRIMITIVE_TYPES,
};
