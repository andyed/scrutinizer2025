'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'renderer/toolbar.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'renderer/toolbar.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'renderer/toolbar.js'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

describe('Study toolbar contract', () => {
    it('contains task instructions, compressed origin, and Done controls', () => {
        expect(html).toContain('id="study-instruction"');
        expect(html).toContain('id="study-origin"');
        expect(html).toContain('id="study-done"');
    });

    it('supports entering, revealing, and exiting Study mode over IPC', () => {
        expect(js).toContain("ipcRenderer.on('toolbar:enter-study'");
        expect(js).toContain("ipcRenderer.on('toolbar:show-study-url'");
        expect(js).toContain("ipcRenderer.on('toolbar:exit-study'");
        expect(js).toContain("ipcRenderer.send('toolbar:study-done'");
    });

    it('retains the fixed 40px toolbar geometry', () => {
        expect(main).toContain('const TOOLBAR_HEIGHT = 40;');
        expect(css).toContain('height: 100%');
    });
});
