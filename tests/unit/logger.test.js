/**
 * Unit tests for renderer/logger.js
 */

'use strict';

const path = require('path');

// Mock electron before requiring Logger.
// `virtual: true` lets this run when the electron *binary module* isn't
// installed (clean clone / lean CI that skips electron's postinstall). Without
// it, jest tries to resolve the real 'electron' module to register the mock and
// throws "Cannot find module 'electron'". renderer/logger.js only needs
// ipcRenderer.send, so the virtual stub is sufficient.
jest.mock('electron', () => ({
    ipcRenderer: {
        send: jest.fn()
    }
}), { virtual: true });

const Logger = require(path.resolve(__dirname, '../../renderer/logger.js'));
const { ipcRenderer } = require('electron');

describe('Logger', () => {
    let consoleLogSpy, consoleErrorSpy, consoleWarnSpy;

    beforeEach(() => {
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        ipcRenderer.send.mockClear();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('log() calls console.log and ipcRenderer.send', () => {
        Logger.log('hello', 'world');
        expect(consoleLogSpy).toHaveBeenCalledWith('hello', 'world');
        expect(ipcRenderer.send).toHaveBeenCalledWith('log:renderer', 'hello world');
    });

    it('error() calls console.error and prefixes [ERROR]', () => {
        Logger.error('oops');
        expect(consoleErrorSpy).toHaveBeenCalledWith('oops');
        expect(ipcRenderer.send).toHaveBeenCalledWith('log:renderer', '[ERROR] oops');
    });

    it('warn() calls console.warn and prefixes [WARN]', () => {
        Logger.warn('careful');
        expect(consoleWarnSpy).toHaveBeenCalledWith('careful');
        expect(ipcRenderer.send).toHaveBeenCalledWith('log:renderer', '[WARN] careful');
    });

    it('stringifies object arguments correctly', () => {
        Logger.log('data:', { key: 'value' });
        expect(consoleLogSpy).toHaveBeenCalledWith('data:', { key: 'value' });
        expect(ipcRenderer.send).toHaveBeenCalledWith('log:renderer', 'data: {"key":"value"}');
    });

    it('handles multiple object arguments', () => {
        Logger.error({ a: 1 }, { b: 2 });
        expect(consoleErrorSpy).toHaveBeenCalledWith({ a: 1 }, { b: 2 });
        expect(ipcRenderer.send).toHaveBeenCalledWith('log:renderer', '[ERROR] {"a":1} {"b":2}');
    });
});
