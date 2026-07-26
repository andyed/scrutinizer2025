'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'renderer/toolbar.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'renderer/toolbar.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'renderer/toolbar.js'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'renderer/preload.js'), 'utf8');

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

    it('shows session progress and falls back to the static label for single tasks', () => {
        expect(js).toContain('`Task ${viewState.taskNumber} of ${viewState.taskCount}`');
        expect(js).toContain("'Task'");
        expect(js).toContain('taskNumber');
        expect(js).toContain('taskCount');
    });

    it('advances sessions from Done instead of always exiting', () => {
        expect(main).toContain('advanceStudySession(win)');
        expect(main).toContain("activeStudy.kind === 'session'");
    });

    it('routes the interstitial Begin sentinel through will-navigate', () => {
        const interstitial = fs.readFileSync(path.join(ROOT, 'renderer/study-interstitial.html'), 'utf8');
        expect(interstitial).toContain('https://begin.study.scrutinizer.invalid/');
        expect(main).toContain("const STUDY_BEGIN_URL = 'https://begin.study.scrutinizer.invalid/'");
        expect(main).toContain('beginCurrentSessionTask(win)');
        // Untrusted instruction text must never be rendered as HTML.
        expect(interstitial).toContain('instructionsEl.textContent');
        expect(interstitial).not.toContain('innerHTML');
    });

    it('keeps the isolated capture bridge and main-process collector on one world id', () => {
        const mainWorld = main.match(/const STUDY_CAPTURE_WORLD_ID = (\d+);/);
        const preloadWorld = preload.match(/const STUDY_CAPTURE_WORLD_ID = (\d+);/);
        expect(mainWorld).not.toBeNull();
        expect(preloadWorld).not.toBeNull();
        expect(preloadWorld[1]).toBe(mainWorld[1]);
        expect(preload).toContain("ipcRenderer.sendSync('study:capture-row'");
        expect(main).toContain("ipcMain.on('study:capture-row'");
    });

    it('starts capture after task load and stops it before advancing', () => {
        expect(main).toContain('await captureStudyPageVisit(win, { restartTracker: true })');
        expect(main).toContain('await finalizeCurrentTaskCapture(win)');
        expect(main).toContain('const capture = writeCompleteStudyCapture(study, summary)');
    });
});
