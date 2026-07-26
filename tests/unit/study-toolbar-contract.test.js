'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'renderer/toolbar.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'renderer/toolbar.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'renderer/toolbar.js'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'renderer/preload.js'), 'utf8');
const overlay = fs.readFileSync(path.join(ROOT, 'renderer/overlay.js'), 'utf8');

describe('Study toolbar contract', () => {
    it('contains dedicated Back, task instruction, origin, and Done controls', () => {
        expect(html).toContain('id="study-back"');
        expect(html).toContain('class="study-instruction-row"');
        expect(html).toContain('id="study-instruction-label"');
        expect(html).toContain('id="study-instruction"');
        expect(html).toContain('id="study-origin"');
        expect(html).toContain('id="study-done"');
    });

    it('supports entering, revealing, and exiting Study mode over IPC', () => {
        expect(js).toContain("ipcRenderer.on('toolbar:enter-study'");
        expect(js).toContain("ipcRenderer.on('toolbar:show-study-url'");
        expect(js).toContain("ipcRenderer.on('toolbar:exit-study'");
        expect(js).toContain("ipcRenderer.send('toolbar:study-done'");
        expect(js).toContain("studyBack.addEventListener('click'");
    });

    it('uses a taller study toolbar and keeps content and HUD bounds aligned', () => {
        expect(main).toContain('const BROWSE_TOOLBAR_HEIGHT = 40;');
        expect(main).toContain('const STUDY_TOOLBAR_HEIGHT = 104;');
        expect(main).toContain('toolbarHeightForWindow(win)');
        expect(main).toContain('win.updateScrutinizerBounds = () =>');
        expect(main).toContain('win.scrutinizerHud.getContentSize()');
        expect(css).toContain('grid-template-rows: 40px 48px');
        expect(css).toContain('height: 100%');
    });

    it('allows Back only inside the active task history boundary', () => {
        expect(main).toContain('function armStudyHistoryFloor(win)');
        expect(main).toContain('activeIndex > win.studyHistoryFloorIndex');
        expect(main).toContain("wc.goToIndex(activeIndex + (direction === 'back' ? -1 : 1))");
        expect(main).toContain("navigateHistory(win, 'back')");
        expect(main).toContain("toolbar:update-nav-state', toolbarNavigationState(win)");
    });

    it('suppresses stale visualization frames during native page scrolling', () => {
        expect(preload).toContain("ipcRenderer.send('browser:scroll'");
        expect(main).toContain("ipcMain.on('browser:scroll'");
        expect(main).toContain('frameSequence');
        expect(main).toContain('scrollX: capturedScroll.x');
        expect(main).toContain('scrollY: capturedScroll.y');
        expect(overlay).toContain("require('../shared/scroll-freshness')");
        expect(overlay).toContain("overlayCanvas.dataset.scrollFreshness = present ? 'fresh' : 'waiting'");
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

    it('settles and serializes PNG anchors while keeping pixel comparison off-thread', () => {
        expect(main).toContain('const trackerReady = restartTracker ? injectStudyCapture(win, record)');
        expect(main).toContain('await waitForStudyCaptureSettle(wc)');
        expect(main).toContain("'stimulus_settle_timeout'");
        expect(main).toContain('record.captureQueuePromise = queued');
        expect(main).toContain('record.captureRequestSequence += 1');
        expect(main).toContain("console.log('[StudyCapture] Skipped superseded did-finish-load.')");
        expect(main).toContain('async function preserveSettledStudyCandidate(study, record, provisionalVisit, candidate)');
        expect(main).toContain('record.pageVisits.splice(provisionalIndex + 1, 0, settledVisit)');
        expect(main).toContain('await drainStudyCapturePostProcessing(record)');
        expect(main).toContain('difference = await compareStimuli(baseline, stimulus.buffer, {');
        expect(main).toContain('await captureDoneStimulusIfChanged(win, study, record, doneAt)');
        expect(main).toContain('closeOpenPageVisit(record, doneAt)');
        expect(main).toContain("closeOpenTaskRecord('done', doneAt)");
    });
});
