/**
 * Unit tests for renderer/visual-memory.js
 *
 * VisualMemory is the visuospatial working memory simulation:
 * fixation detection, FIFO/infinite buffer, merge-on-proximity,
 * mask rendering, and inhibition-of-return mode.
 */

'use strict';

// VisualMemory's IIFE expects `window` and `document`.
// Mock just enough DOM for the canvas operations it uses.
function createMockCanvasCtx() {
    return {
        fillStyle: '',
        globalCompositeOperation: 'source-over',
        fillRect: jest.fn(),
        clearRect: jest.fn(),
        beginPath: jest.fn(),
        arc: jest.fn(),
        fill: jest.fn(),
        createRadialGradient: jest.fn(() => ({
            addColorStop: jest.fn()
        }))
    };
}

const mockCtx = createMockCanvasCtx();
global.document = {
    createElement: jest.fn((tag) => {
        if (tag === 'canvas') {
            return {
                width: 0,
                height: 0,
                getContext: jest.fn(() => createMockCanvasCtx())
            };
        }
        return {};
    })
};
global.window = global;

delete require.cache[require.resolve('../../renderer/visual-memory.js')];
require('../../renderer/visual-memory.js');
const VisualMemory = global.VisualMemory;

/**
 * Create a mock canvas for the constructor's canvas arg.
 */
function createMockCanvas(width = 1280, height = 960) {
    return { width, height };
}

function createVM(overrides = {}) {
    const config = {
        fixationVelocityThreshold: 0.1,
        dwellTimeThreshold: 150,
        foveaBypassMargin: 0.5,
        ...overrides
    };
    return new VisualMemory(config, createMockCanvas());
}

describe('VisualMemory', () => {
    describe('constructor', () => {
        it('initializes with empty buffer and inactive state', () => {
            const vm = createVM();
            expect(vm.buffer).toEqual([]);
            expect(vm.isActive()).toBe(false);
            expect(vm.limit).toBe(0);
            expect(vm.inhibitionMode).toBe(false);
        });
    });

    describe('setLimit / isActive', () => {
        it('limit=0 means inactive', () => {
            const vm = createVM();
            vm.setLimit(0);
            expect(vm.isActive()).toBe(false);
            expect(vm.limit).toBe(0);
        });

        it('positive limit activates FIFO mode', () => {
            const vm = createVM();
            vm.setLimit(5);
            expect(vm.isActive()).toBe(true);
            expect(vm.limit).toBe(5);
            expect(vm.inhibitionMode).toBe(false);
        });

        it('limit=-1 activates infinite mode', () => {
            const vm = createVM();
            vm.setLimit(-1);
            expect(vm.isActive()).toBe(true);
            expect(vm.limit).toBe(-1);
        });

        it('limit=20 activates inhibition-of-return mode (limit=10)', () => {
            const vm = createVM();
            vm.setLimit(20);
            expect(vm.isActive()).toBe(true);
            expect(vm.limit).toBe(10);
            expect(vm.inhibitionMode).toBe(true);
        });

        it('switching modes resets buffer', () => {
            const vm = createVM();
            vm.setLimit(-1);
            vm.buffer.push({ x: 100, y: 100, radius: 50, timestamp: 1000 });
            expect(vm.buffer.length).toBe(1);

            vm.setLimit(5);
            expect(vm.buffer.length).toBe(0);
        });

        it('handles string-typed limit via Number() coercion', () => {
            const vm = createVM();
            vm.setLimit('-1');
            expect(vm.isActive()).toBe(true);
            expect(vm.limit).toBe(-1);
        });
    });

    describe('update — fixation detection', () => {
        it('does nothing when inactive (limit=0)', () => {
            const vm = createVM();
            vm.setLimit(0);
            vm.update(0, 640, 480, 0.01, 100);
            vm.update(200, 640, 480, 0.01, 100);
            expect(vm.buffer.length).toBe(0);
        });

        it('records fixation after dwell threshold', () => {
            const vm = createVM({ dwellTimeThreshold: 150 });
            vm.setLimit(-1);

            vm.update(0, 640, 480, 0.05, 100);
            expect(vm.buffer.length).toBe(0);

            vm.update(200, 640, 480, 0.05, 100);
            expect(vm.buffer.length).toBe(1);
            expect(vm.buffer[0].x).toBe(640);
            expect(vm.buffer[0].y).toBe(480);
        });

        it('does not record if velocity too high', () => {
            const vm = createVM({ dwellTimeThreshold: 150 });
            vm.setLimit(-1);

            vm.update(0, 640, 480, 0.5, 100);
            vm.update(200, 640, 480, 0.5, 100);
            expect(vm.buffer.length).toBe(0);
        });

        it('resets fixation timer when velocity spikes', () => {
            const vm = createVM({ dwellTimeThreshold: 150 });
            vm.setLimit(-1);

            vm.update(0, 640, 480, 0.05, 100);
            vm.update(100, 700, 480, 0.5, 100);   // saccade interrupts
            vm.update(200, 700, 480, 0.05, 100);   // restart fixation
            vm.update(300, 700, 480, 0.05, 100);   // only 100ms since restart
            expect(vm.buffer.length).toBe(0);

            vm.update(400, 700, 480, 0.05, 100);   // 200ms since restart — past threshold
            expect(vm.buffer.length).toBe(1);
            expect(vm.buffer[0].x).toBe(700);
        });

        it('ignores gaze outside canvas bounds', () => {
            const vm = createVM({ dwellTimeThreshold: 150 });
            vm.setLimit(-1);

            // Left of canvas
            vm.update(0, -10, 480, 0.05, 100);
            vm.update(200, -10, 480, 0.05, 100);
            expect(vm.buffer.length).toBe(0);

            // Right of canvas (canvas width=1280)
            vm.update(0, 1300, 480, 0.05, 100);
            vm.update(200, 1300, 480, 0.05, 100);
            expect(vm.buffer.length).toBe(0);

            // Exactly on boundary (0 is not strictly inside)
            vm.update(0, 0, 480, 0.05, 100);
            vm.update(200, 0, 480, 0.05, 100);
            expect(vm.buffer.length).toBe(0);
        });

        it('clears buffer when switched to inactive during use', () => {
            const vm = createVM({ dwellTimeThreshold: 150 });
            vm.setLimit(-1);
            vm.update(0, 640, 480, 0.05, 100);
            vm.update(200, 640, 480, 0.05, 100);
            expect(vm.buffer.length).toBe(1);

            vm.setLimit(0);
            vm.update(300, 640, 480, 0.05, 100);
            expect(vm.buffer.length).toBe(0);
        });
    });

    describe('FIFO eviction', () => {
        it('evicts oldest when buffer exceeds limit', () => {
            const vm = createVM({ dwellTimeThreshold: 0, foveaBypassMargin: 0 });
            vm.setLimit(3);

            const positions = [[100, 100], [300, 300], [500, 500], [700, 700]];
            let t = 0;
            for (const [x, y] of positions) {
                vm.update(t, x, y, 0.05, 100);
                t += 200;
                vm.update(t, x, y, 0.05, 100);
                t += 200;
                // Break fixation
                vm.update(t, x, y, 0.5, 100);
                t += 100;
            }

            expect(vm.buffer.length).toBe(3);
            expect(vm.buffer[0].x).toBe(300);
            expect(vm.buffer[1].x).toBe(500);
            expect(vm.buffer[2].x).toBe(700);
        });
    });

    describe('infinite mode (limit=-1)', () => {
        it('never evicts — buffer grows without bound', () => {
            const vm = createVM({ dwellTimeThreshold: 0, foveaBypassMargin: 0 });
            vm.setLimit(-1);

            let t = 0;
            for (let i = 0; i < 50; i++) {
                const x = 100 + i * 20;
                vm.update(t, x, 200, 0.05, 100);
                t += 200;
                vm.update(t, x, 200, 0.05, 100);
                t += 200;
                vm.update(t, x, 200, 0.5, 100);
                t += 100;
            }

            expect(vm.buffer.length).toBe(50);
        });

        it('bulk-loaded buffer persists through renderMask', () => {
            const vm = createVM();
            vm.setLimit(-1);
            vm.resize(1280, 960);

            // Simulate batch gazeplot: bulk-load buffer directly
            vm.buffer = [
                { x: 100, y: 100, radius: 50 },
                { x: 500, y: 300, radius: 50 },
                { x: 900, y: 600, radius: 50 }
            ];
            vm.maskDirty = true;

            expect(vm.buffer.length).toBe(3);
            expect(vm.isActive()).toBe(true);

            // renderMask reads buffer but shouldn't modify it
            const mockRenderer = { uploadMask: jest.fn() };
            vm.renderMask(mockRenderer);

            expect(vm.buffer.length).toBe(3);
            expect(mockRenderer.uploadMask).toHaveBeenCalledTimes(1);
            expect(mockRenderer.uploadMask).toHaveBeenCalledWith(vm.maskCanvas);
        });

        it('bulk-loaded buffer works with per-tile Y remapping', () => {
            const vm = createVM();
            vm.setLimit(-1);
            vm.resize(1280, 960);

            // Simulate batch tile capture: page-space fixations remapped per tile
            const pageFixations = [
                { x: 640, pageY: 200, radius: 45 },
                { x: 640, pageY: 1200, radius: 45 },
                { x: 640, pageY: 2400, radius: 45 }
            ];
            const scrollY = 960;
            const scaleX = 1.0, scaleY = 1.0;

            // Remap for tile at scrollY=960
            const shifted = pageFixations
                .map(f => ({
                    x: f.x * scaleX,
                    y: (f.pageY - scrollY) * scaleY,
                    radius: f.radius * scaleX
                }))
                .filter(p => p.y > -100 && p.y < 960 + 100);

            vm.buffer = shifted;
            vm.maskDirty = true;

            // pageY=200 → y=-760 (filtered), pageY=1200 → y=240 (kept), pageY=2400 → y=1440 (filtered)
            expect(vm.buffer.length).toBe(1);
            expect(vm.buffer[0].y).toBeCloseTo(240);
        });
    });

    describe('merge-on-proximity', () => {
        it('merges nearby fixations instead of adding new point', () => {
            const vm = createVM({ dwellTimeThreshold: 0, foveaBypassMargin: 0.5 });
            vm.setLimit(-1);

            // First fixation at (640, 480)
            vm.update(0, 640, 480, 0.05, 100);
            vm.update(200, 640, 480, 0.05, 100);
            expect(vm.buffer.length).toBe(1);

            // Break and re-fixate nearby (22px away, within mergeRadius = 100 * 0.5 = 50px)
            vm.update(400, 640, 480, 0.5, 100);
            vm.update(500, 660, 490, 0.05, 100);
            vm.update(700, 660, 490, 0.05, 100);

            expect(vm.buffer.length).toBe(1);
            expect(vm.buffer[0].x).toBe(660);
            expect(vm.buffer[0].y).toBe(490);
        });

        it('adds new point when outside merge radius', () => {
            const vm = createVM({ dwellTimeThreshold: 0, foveaBypassMargin: 0.5 });
            vm.setLimit(-1);

            vm.update(0, 200, 200, 0.05, 100);
            vm.update(200, 200, 200, 0.05, 100);

            vm.update(400, 200, 200, 0.5, 100);
            vm.update(500, 600, 600, 0.05, 100);
            vm.update(700, 600, 600, 0.05, 100);

            expect(vm.buffer.length).toBe(2);
        });
    });

    describe('reset', () => {
        it('clears buffer and fixation state', () => {
            const vm = createVM({ dwellTimeThreshold: 0 });
            vm.setLimit(-1);

            vm.update(0, 640, 480, 0.05, 100);
            vm.update(200, 640, 480, 0.05, 100);
            expect(vm.buffer.length).toBe(1);

            vm.reset();
            expect(vm.buffer.length).toBe(0);
            expect(vm.isFixating).toBe(false);
        });
    });

    describe('renderMask', () => {
        it('does nothing when inactive', () => {
            const vm = createVM();
            vm.setLimit(0);
            vm.resize(1280, 960);

            const mockRenderer = { uploadMask: jest.fn() };
            vm.renderMask(mockRenderer);
            expect(mockRenderer.uploadMask).not.toHaveBeenCalled();
        });

        it('uploads mask when active with points', () => {
            const vm = createVM();
            vm.setLimit(-1);
            vm.resize(1280, 960);

            vm.buffer = [{ x: 640, y: 480, radius: 100 }];
            const mockRenderer = { uploadMask: jest.fn() };
            vm.renderMask(mockRenderer);

            expect(mockRenderer.uploadMask).toHaveBeenCalledTimes(1);
            // Mask canvas should be 1/4 resolution
            expect(vm.maskCanvas.width).toBe(320);
            expect(vm.maskCanvas.height).toBe(240);
        });
    });

    describe('resize', () => {
        it('sets mask canvas to 1/4 resolution', () => {
            const vm = createVM();
            vm.resize(2560, 1920);
            expect(vm.maskCanvas.width).toBe(640);
            expect(vm.maskCanvas.height).toBe(480);
        });

        it('marks mask dirty after resize', () => {
            const vm = createVM();
            vm.maskDirty = false;
            vm.resize(1280, 960);
            expect(vm.maskDirty).toBe(true);
        });
    });

    describe('memory radius', () => {
        it('records fixation with 2.5x foveal radius', () => {
            const vm = createVM({ dwellTimeThreshold: 0, foveaBypassMargin: 0 });
            vm.setLimit(-1);

            vm.update(0, 640, 480, 0.05, 100);
            vm.update(200, 640, 480, 0.05, 100);

            expect(vm.buffer[0].radius).toBe(250);
        });
    });
});
