'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildEnvelope } = require('../../shared/session-capture');
const {
    assertComplete,
    writeSessionDirectory
} = require('../../shared/session-directory-writer');

const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
);

function envelope(overrides = {}) {
    return buildEnvelope(Object.assign({
        sessionId: 'writer-test',
        participantId: 'p-1',
        appVersion: '2.8.0',
        platform: 'darwin',
        startedAt: '2026-07-26T12:00:00.000Z',
        endedAt: '2026-07-26T12:01:00.000Z',
        endReason: 'completed',
        defaults: {},
        tasks: [{
            index: 1,
            taskId: 'find-help',
            targetUrl: 'https://example.com/',
            finalUrl: 'https://example.com/help',
            startedAt: '2026-07-26T12:00:00.000Z',
            endedAt: '2026-07-26T12:01:00.000Z',
            durationMs: 60000,
            outcome: 'done',
            settings: {},
            events: [{ type: 'done', t: 60000 }]
        }],
        capture: {
            evtrackVersion: 'cabb3b7ccfecee72a8970592642c86881a8fd437',
            pollMs: 16,
            appVersion: '2.8.0',
            platform: 'darwin',
            screen: { w: 1512, h: 982 },
            window: { w: 1280, h: 800 },
            devicePixelRatio: 2,
            health: {
                status: 'stopped',
                rowCount: 1,
                pollMs: 16,
                deliveryFailureCount: 0
            }
        },
        pageVisits: [{
            pageVisitId: 'pv-001',
            taskId: 'find-help',
            url: 'https://example.com/',
            tStart: 0,
            tEnd: 60000,
            screenshot: 'stimuli/pv-001.png',
            stimulusWidth: 1,
            stimulusHeight: 1
        }]
    }, overrides));
}

function trail() {
    return {
        meta: { taskId: 'find-help' },
        fixations: [],
        events: [],
        mouseTimeline: [{ t: 0, x: 10, y: 20, event: 'mousemove' }],
        scrollTimeline: [{ t: 0, scrollY: 0 }]
    };
}

describe('atomic session-directory writer', () => {
    let rootDir;

    beforeEach(() => {
        rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrutinizer-writer-'));
    });

    afterEach(() => {
        fs.rmSync(rootDir, { recursive: true, force: true });
    });

    it('publishes the envelope, task trail, and promised stimulus together', () => {
        const result = writeSessionDirectory({
            rootDir,
            envelope: envelope(),
            trailsByTaskId: new Map([['find-help', trail()]]),
            stimuliByPageVisitId: new Map([['pv-001', PNG]])
        });

        expect(fs.existsSync(path.join(result.directoryPath, 'envelope.json'))).toBe(true);
        expect(fs.existsSync(path.join(result.directoryPath, 'trail-find-help.json'))).toBe(true);
        expect(fs.readFileSync(path.join(result.directoryPath, 'stimuli', 'pv-001.png')))
            .toEqual(PNG);
        expect(fs.readdirSync(rootDir).some(name => name.includes('.partial-'))).toBe(false);
    });

    it('never overwrites an existing capture with the same session and start time', () => {
        const input = {
            rootDir,
            envelope: envelope(),
            trailsByTaskId: { 'find-help': trail() },
            stimuliByPageVisitId: { 'pv-001': PNG }
        };
        const first = writeSessionDirectory(input);
        const second = writeSessionDirectory(input);

        expect(second.directoryPath).not.toBe(first.directoryPath);
        expect(path.basename(second.directoryPath)).toMatch(/-2$/);
        expect(fs.existsSync(path.join(first.directoryPath, 'envelope.json'))).toBe(true);
    });

    it('refuses to expose a session if any task lacks a stimulus anchor', () => {
        const missingVisit = envelope({ pageVisits: [] });
        expect(() => assertComplete(
            missingVisit,
            { 'find-help': trail() },
            {}
        )).toThrow(/no captured page visit/);
        expect(fs.readdirSync(rootDir)).toEqual([]);
    });

    it('refuses missing and non-PNG stimulus bytes', () => {
        const inputEnvelope = envelope();
        expect(() => assertComplete(
            inputEnvelope,
            { 'find-help': trail() },
            {}
        )).toThrow(/No PNG stimulus/);
        expect(() => assertComplete(
            inputEnvelope,
            { 'find-help': trail() },
            { 'pv-001': Buffer.from('not-a-png') }
        )).toThrow(/not a PNG/);
    });

    it('refuses a PNG whose dimensions do not match the envelope', () => {
        const mismatched = envelope({
            pageVisits: [{
                pageVisitId: 'pv-001',
                taskId: 'find-help',
                url: 'https://example.com/',
                tStart: 0,
                tEnd: 60000,
                screenshot: 'stimuli/pv-001.png',
                stimulusWidth: 2,
                stimulusHeight: 1
            }]
        });
        expect(() => assertComplete(
            mismatched,
            { 'find-help': trail() },
            { 'pv-001': PNG }
        )).toThrow(/envelope promises 2×1/);
    });
});
