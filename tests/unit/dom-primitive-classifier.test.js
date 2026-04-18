/**
 * Unit tests for renderer/dom-primitive-classifier.js
 *
 * Fixtures cover the 20 representative elements flagged in the revised plan
 * (docs/dom-aware-perception-plan.md Stage 2): Gmail compose button, GitHub
 * search box, Bootstrap nav, Material icon, etc. Uses lightweight element
 * mocks rather than JSDOM — the classifier only needs tagName, attributes,
 * getBoundingClientRect, and closest.
 */

'use strict';

const { classifyPrimitive, PRIMITIVE_TYPES } = require('../../renderer/dom-primitive-classifier');

/**
 * Build a minimal mock element compatible with classifyPrimitive.
 */
function makeEl(tag, opts = {}) {
    const attrs = opts.attrs || {};
    const rect = opts.rect || { width: 200, height: 40 };
    const ancestors = opts.ancestors || [];  // array of selector-matchable tags/roles for .closest
    return {
        tagName: tag.toUpperCase(),
        getAttribute(name) { return attrs[name] || null; },
        getBoundingClientRect() { return rect; },
        closest(selector) {
            // Minimal selector matcher — handles the single-tag and
            // comma-separated forms the classifier uses.
            const parts = selector.split(',').map(s => s.trim());
            for (const p of parts) {
                for (const a of ancestors) {
                    if (p === a.tag) return a;
                    if (p.startsWith('[role=') && a.role === p.slice(6, -1)) return a;
                }
            }
            return null;
        }
    };
}

describe('classifyPrimitive', () => {
    describe('headings', () => {
        it('h1–h6 → heading', () => {
            for (const t of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
                expect(classifyPrimitive(makeEl(t))).toBe('heading');
            }
        });

        it('role=heading → heading (even on a div)', () => {
            expect(classifyPrimitive(makeEl('div', { attrs: { role: 'heading' } }))).toBe('heading');
        });

        it('link inside <h1> classifies at the outer element as heading', () => {
            // This test documents policy: callers classify at the outermost
            // semantic element. The classifier itself treats an <a> alone as
            // link — see separate test below.
            expect(classifyPrimitive(makeEl('h1'))).toBe('heading');
        });
    });

    describe('form inputs', () => {
        it('text input → form_input', () => {
            expect(classifyPrimitive(makeEl('input', { attrs: { type: 'text' } }))).toBe('form_input');
        });

        it('input without type → form_input (HTML default)', () => {
            expect(classifyPrimitive(makeEl('input'))).toBe('form_input');
        });

        it('textarea → form_input', () => {
            expect(classifyPrimitive(makeEl('textarea'))).toBe('form_input');
        });

        it('select → form_input', () => {
            expect(classifyPrimitive(makeEl('select'))).toBe('form_input');
        });

        it('role=searchbox on a div → form_input', () => {
            expect(classifyPrimitive(makeEl('div', { attrs: { role: 'searchbox' } }))).toBe('form_input');
        });

        it('role=combobox on a div → form_input', () => {
            expect(classifyPrimitive(makeEl('div', { attrs: { role: 'combobox' } }))).toBe('form_input');
        });
    });

    describe('buttons', () => {
        it('<button> → button', () => {
            expect(classifyPrimitive(makeEl('button'))).toBe('button');
        });

        it('input[type=submit] → button', () => {
            expect(classifyPrimitive(makeEl('input', { attrs: { type: 'submit' } }))).toBe('button');
        });

        it('input[type=checkbox] → button', () => {
            expect(classifyPrimitive(makeEl('input', { attrs: { type: 'checkbox' } }))).toBe('button');
        });

        it('role=button on a div → button', () => {
            expect(classifyPrimitive(makeEl('div', { attrs: { role: 'button' } }))).toBe('button');
        });

        it('role=switch → button', () => {
            expect(classifyPrimitive(makeEl('div', { attrs: { role: 'switch' } }))).toBe('button');
        });
    });

    describe('nav items', () => {
        it('<nav> → nav_item', () => {
            expect(classifyPrimitive(makeEl('nav'))).toBe('nav_item');
        });

        it('role=menubar → nav_item', () => {
            expect(classifyPrimitive(makeEl('div', { attrs: { role: 'menubar' } }))).toBe('nav_item');
        });

        it('role=menuitem → nav_item', () => {
            expect(classifyPrimitive(makeEl('li', { attrs: { role: 'menuitem' } }))).toBe('nav_item');
        });
    });

    describe('icons', () => {
        it('small SVG with aria-label → icon', () => {
            const el = makeEl('svg', {
                rect: { width: 24, height: 24 },
                attrs: { 'aria-label': 'search' }
            });
            expect(classifyPrimitive(el)).toBe('icon');
        });

        it('small SVG inside a button → icon', () => {
            const el = makeEl('svg', {
                rect: { width: 20, height: 20 },
                ancestors: [{ tag: 'button' }]
            });
            expect(classifyPrimitive(el)).toBe('icon');
        });

        it('small img with alt inside link → icon', () => {
            const el = makeEl('img', {
                rect: { width: 16, height: 16 },
                attrs: { alt: 'menu' },
                ancestors: [{ tag: 'a' }]
            });
            expect(classifyPrimitive(el)).toBe('icon');
        });

        it('large SVG → image, not icon', () => {
            const el = makeEl('svg', {
                rect: { width: 400, height: 300 },
                attrs: { 'aria-label': 'chart' }
            });
            expect(classifyPrimitive(el)).toBe('image');
        });

        it('small SVG with no label and no interactive ancestor → image (not icon)', () => {
            const el = makeEl('svg', { rect: { width: 20, height: 20 } });
            expect(classifyPrimitive(el)).toBe('image');
        });
    });

    describe('links', () => {
        it('<a> → link', () => {
            expect(classifyPrimitive(makeEl('a'))).toBe('link');
        });

        it('role=link on a span → link', () => {
            expect(classifyPrimitive(makeEl('span', { attrs: { role: 'link' } }))).toBe('link');
        });
    });

    describe('images', () => {
        it('<img> without icon signals → image', () => {
            expect(classifyPrimitive(makeEl('img', { rect: { width: 500, height: 400 } }))).toBe('image');
        });

        it('<video> → image', () => {
            expect(classifyPrimitive(makeEl('video'))).toBe('image');
        });

        it('<canvas> → image', () => {
            expect(classifyPrimitive(makeEl('canvas'))).toBe('image');
        });
    });

    describe('ui_surface (landmarks + chrome)', () => {
        it('<header> → ui_surface', () => {
            expect(classifyPrimitive(makeEl('header'))).toBe('ui_surface');
        });

        it('<footer> → ui_surface', () => {
            expect(classifyPrimitive(makeEl('footer'))).toBe('ui_surface');
        });

        it('<main> → ui_surface', () => {
            expect(classifyPrimitive(makeEl('main'))).toBe('ui_surface');
        });

        it('role=dialog on a div → ui_surface', () => {
            expect(classifyPrimitive(makeEl('div', { attrs: { role: 'dialog' } }))).toBe('ui_surface');
        });

        it('role=toolbar on a div → ui_surface', () => {
            expect(classifyPrimitive(makeEl('div', { attrs: { role: 'toolbar' } }))).toBe('ui_surface');
        });
    });

    describe('text fallback', () => {
        it('<p> → text (default for body content)', () => {
            expect(classifyPrimitive(makeEl('p'))).toBe('text');
        });

        it('<span> → text', () => {
            expect(classifyPrimitive(makeEl('span'))).toBe('text');
        });

        it('<div> without role → text', () => {
            expect(classifyPrimitive(makeEl('div'))).toBe('text');
        });
    });

    describe('edge cases', () => {
        it('null element → ui_surface', () => {
            expect(classifyPrimitive(null)).toBe('ui_surface');
        });

        it('always returns one of the 9 documented types', () => {
            // Sample arbitrary tags and verify output is always in the set.
            const samples = [
                makeEl('div'),
                makeEl('span'),
                makeEl('p'),
                makeEl('button'),
                makeEl('a'),
                makeEl('h2'),
                makeEl('input', { attrs: { type: 'checkbox' } }),
                makeEl('unknown-element-xyz'),
            ];
            for (const el of samples) {
                expect(PRIMITIVE_TYPES).toContain(classifyPrimitive(el));
            }
        });
    });

    describe('plan-spec fixtures (from revised plan)', () => {
        it('Gmail compose button → button', () => {
            // Gmail compose is a div with role=button
            expect(classifyPrimitive(makeEl('div', { attrs: { role: 'button' } }))).toBe('button');
        });

        it('GitHub search box → form_input', () => {
            expect(classifyPrimitive(makeEl('input', { attrs: { type: 'text', 'aria-label': 'Search' } }))).toBe('form_input');
        });

        it('Bootstrap nav → nav_item', () => {
            expect(classifyPrimitive(makeEl('nav'))).toBe('nav_item');
        });

        it('Material icon (24×24 SVG in button) → icon', () => {
            expect(classifyPrimitive(makeEl('svg', {
                rect: { width: 24, height: 24 },
                ancestors: [{ tag: 'button' }]
            }))).toBe('icon');
        });
    });
});
