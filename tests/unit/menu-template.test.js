/**
 * Unit tests for menu-template.js
 *
 * Targets a specific regression: the Visual Memory radio group used to
 * hardcode `checked: true` on "Off", so the menu display lied about the
 * actual saved/active setting. v2.7.2 fixed the runtime bug; this test
 * pins the menu-sync fix so it cannot silently regress again.
 */

'use strict';

jest.mock('electron', () => ({
    app: { getVersion: () => 'test', quit: jest.fn() },
    shell: { openExternal: jest.fn() },
    BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null }
}), { virtual: true });

const path = require('path');
const { buildMenuTemplate } = require(path.resolve(__dirname, '../../menu-template.js'));

function findSubmenu(template, label) {
    for (const item of template) {
        if (item.label === label) return item.submenu;
        if (item.submenu) {
            const found = findSubmenu(item.submenu, label);
            if (found) return found;
        }
    }
    return null;
}

function buildVisualMemoryRadios(currentVisualMemory) {
    const noop = () => {};
    const template = buildMenuTemplate(
        noop, noop,
        180, 10, false, 0, 0, 0, false, false, 256, 512,
        currentVisualMemory
    );
    const submenu = findSubmenu(template, 'Visual Memory');
    expect(submenu).not.toBeNull();
    return submenu.filter(i => i.type === 'radio');
}

describe('buildMenuTemplate — Visual Memory radio sync', () => {
    it('checks "Off" when currentVisualMemory is 0', () => {
        const radios = buildVisualMemoryRadios(0);
        const off = radios.find(r => r.label.startsWith('Off'));
        expect(off.checked).toBe(true);
        expect(radios.filter(r => r.checked).length).toBe(1);
    });

    it('checks "Limited (5 fixations)" when currentVisualMemory is 5', () => {
        const radios = buildVisualMemoryRadios(5);
        const limited = radios.find(r => r.label.includes('Limited'));
        expect(limited.checked).toBe(true);
        expect(radios.filter(r => r.checked).length).toBe(1);
    });

    it('checks "Extended (10 fixations)" when currentVisualMemory is 10', () => {
        const radios = buildVisualMemoryRadios(10);
        const extended = radios.find(r => r.label.includes('Extended'));
        expect(extended.checked).toBe(true);
        expect(radios.filter(r => r.checked).length).toBe(1);
    });

    it('checks "Infinite" when currentVisualMemory is -1', () => {
        const radios = buildVisualMemoryRadios(-1);
        const infinite = radios.find(r => r.label === 'Infinite');
        expect(infinite.checked).toBe(true);
        expect(radios.filter(r => r.checked).length).toBe(1);
    });

    it('checks "Inhibition of Return" when currentVisualMemory is 20', () => {
        const radios = buildVisualMemoryRadios(20);
        const inhibition = radios.find(r => r.label.includes('Inhibition'));
        expect(inhibition.checked).toBe(true);
        expect(radios.filter(r => r.checked).length).toBe(1);
    });

    it('defaults to "Off" when currentVisualMemory is omitted', () => {
        const noop = () => {};
        const template = buildMenuTemplate(noop, noop);
        const submenu = findSubmenu(template, 'Visual Memory');
        const radios = submenu.filter(i => i.type === 'radio');
        const off = radios.find(r => r.label.startsWith('Off'));
        expect(off.checked).toBe(true);
    });

    it('regression: never hardcodes Off as checked when a non-zero value is active', () => {
        // This is the exact failure mode of the original bug. With the old
        // hardcoded `checked: true` on Off, the Off radio would read checked
        // even when currentVisualMemory was 20 (Inhibition of Return).
        const radios = buildVisualMemoryRadios(20);
        const off = radios.find(r => r.label.startsWith('Off'));
        expect(off.checked).toBe(false);
    });
});
