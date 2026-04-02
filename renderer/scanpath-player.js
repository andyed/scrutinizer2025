/**
 * ScanpathPlayer — GazeModel-compatible scanpath replayer.
 *
 * Drop-in replacement for GazeModel that replays imported scanpath data
 * through the foveated rendering pipeline. Implements the same interface:
 * update(now), getPosition(), getVelocity(), getVelocityComponents(), getScale().
 *
 * Saccade trajectories use the minimum-jerk profile (Flash & Hogan 1985):
 *   s(t) = 10t³ - 15t⁴ + 6t⁵
 * This produces a bell-shaped velocity profile matching biological saccades.
 *
 * Saccade duration follows the main sequence (Bahill et al. 1975):
 *   duration_ms = 2.2 × amplitude_deg + 21
 */

const { saccadeDurationFromPixels } = require('./scanpath/coordinate-utils');
const MouseCursorPlayer = require('./mouse-cursor-player');

class ScanpathPlayer {
    constructor(config, canvas) {
        this.config = config;
        this.canvas = canvas;

        // Current interpolated position (physical canvas pixels)
        this.x = 0;
        this.y = 0;

        // Velocity state
        this.currentVelocity = 0;    // scalar px/ms
        this.currentVelocityX = 0;
        this.currentVelocityY = 0;

        // Scale factors (canvas CSS vs physical — needed by SVG overlay)
        this.scaleX = 1;
        this.scaleY = 1;

        // Scanpath data
        this.scanpath = null;        // ScanpathData
        this.timeline = [];          // Flattened timeline of fixation + saccade segments

        // Playback state
        this.state = 'idle';         // "idle"|"playing"|"paused"|"complete"
        this.speed = 1.0;
        this.playbackTime = 0;       // Virtual time in ms (affected by speed)
        this.wallStartTime = null;   // Real wall clock time when play() was called
        this.wallPauseTime = null;   // Wall time when paused (for resume offset)
        this.isSaccading = false;

        // Pixels per degree — for saccade duration estimation
        this.ppd = config.fovealRadius || 45;

        // Optional mouse cursor replay (loaded when scanpath has mouseTimeline)
        this.mousePlayer = null;

        // Optional scroll timeline (for page scroll sync)
        this.scrollTimeline = null;

        // Callback for scroll sync — set by the host to scroll the content view
        this.onScroll = null;
    }

    // ── GazeModel interface (stubs for compatibility) ──────────────

    /**
     * No-op — replay doesn't respond to mouse input.
     * Kept for interface compatibility with overlay.js event binding.
     */
    handleMouseMove(event) { }

    /**
     * No-op — replay doesn't track zoom.
     */
    handleZoomChanged(zoom) { }

    /**
     * Per-frame update. Advances playback time and interpolates position.
     * @param {number} now - performance.now() timestamp
     * @returns {{ isSaccading: boolean }}
     */
    update(now) {
        if (this.state !== 'playing' || this.timeline.length === 0) {
            return { isSaccading: false };
        }

        // Compute elapsed playback time from wall clock + speed
        const wallElapsed = now - this.wallStartTime;
        this.playbackTime = wallElapsed * this.speed;

        // Check completion
        const totalDuration = this.timeline[this.timeline.length - 1].tEnd;
        if (this.playbackTime >= totalDuration) {
            this.state = 'complete';
            // Hold at final fixation
            const lastSeg = this.timeline[this.timeline.length - 1];
            this.x = lastSeg.x2 !== undefined ? lastSeg.x2 : lastSeg.x;
            this.y = lastSeg.y2 !== undefined ? lastSeg.y2 : lastSeg.y;
            this.currentVelocity = 0;
            this.currentVelocityX = 0;
            this.currentVelocityY = 0;
            this.isSaccading = false;
            // Final update for mouse + scroll at end of timeline
            this._updateAuxiliary(totalDuration);
            return { isSaccading: false };
        }

        // Find current segment
        const seg = this._findSegment(this.playbackTime);
        if (!seg) return { isSaccading: false };

        const prevX = this.x;
        const prevY = this.y;

        if (seg.type === 'fixation') {
            this.x = seg.x;
            this.y = seg.y;
            this.isSaccading = false;
            this.currentVelocity = 0;
            this.currentVelocityX = 0;
            this.currentVelocityY = 0;
        } else if (seg.type === 'saccade') {
            // Minimum-jerk interpolation: s(t) = 10t³ - 15t⁴ + 6t⁵
            const segDuration = seg.tEnd - seg.tStart;
            const t = Math.max(0, Math.min(1, (this.playbackTime - seg.tStart) / segDuration));
            const t2 = t * t;
            const t3 = t2 * t;
            const t4 = t3 * t;
            const t5 = t4 * t;
            const s = 10 * t3 - 15 * t4 + 6 * t5;

            this.x = seg.x1 + (seg.x2 - seg.x1) * s;
            this.y = seg.y1 + (seg.y2 - seg.y1) * s;
            this.isSaccading = true;

            // Velocity from minimum-jerk derivative: s'(t) = 30t² - 60t³ + 30t⁴
            const sDot = 30 * t2 - 60 * t3 + 30 * t4;
            const dx = (seg.x2 - seg.x1) * sDot / segDuration;
            const dy = (seg.y2 - seg.y1) * sDot / segDuration;
            this.currentVelocityX = dx;
            this.currentVelocityY = dy;
            this.currentVelocity = Math.sqrt(dx * dx + dy * dy);
        }

        this._updateAuxiliary(this.playbackTime);

        return { isSaccading: this.isSaccading };
    }

    /**
     * Update mouse cursor and scroll position for a given playback time.
     * Extracted so both mid-playback and completion paths can call it.
     * @param {number} timeMs
     */
    _updateAuxiliary(timeMs) {
        if (this.mousePlayer) {
            this.mousePlayer.update(timeMs);
        }
        if (this.scrollTimeline && this.onScroll) {
            const scrollY = this._interpolateScroll(timeMs);
            this.onScroll(scrollY);
        }
    }

    /**
     * @returns {{ x: number, y: number }} Current position in physical canvas pixels
     */
    getPosition() {
        return { x: this.x, y: this.y };
    }

    /**
     * @returns {number} Scalar velocity magnitude in px/ms
     */
    getVelocity() {
        return this.currentVelocity;
    }

    /**
     * @returns {{ vx: number, vy: number }} Velocity components for reading span
     */
    getVelocityComponents() {
        return { vx: this.currentVelocityX, vy: this.currentVelocityY };
    }

    /**
     * @returns {{ scaleX: number, scaleY: number }} Canvas scale factors for SVG overlay
     */
    getScale() {
        this._updateScale();
        return { scaleX: this.scaleX, scaleY: this.scaleY };
    }

    // ── Playback API ──────────────────────────────────────────────

    /**
     * Load scanpath data and build the playback timeline.
     * Inserts synthetic saccades between fixations that lack explicit gaps.
     *
     * @param {ScanpathData} scanpathData
     */
    load(scanpathData) {
        this.scanpath = scanpathData;

        // Compute scale from stimulus-space to physical canvas pixels.
        // The canvas may be 2x larger than CSS dimensions on HiDPI/Retina displays.
        // Fixation coordinates from importers are in stimulus-space pixels (the
        // experiment's display resolution), not physical canvas pixels.
        const stimW = scanpathData.meta.stimulusWidth;
        const stimH = scanpathData.meta.stimulusHeight;
        const canvasW = this.canvas ? this.canvas.width : stimW;
        const canvasH = this.canvas ? this.canvas.height : stimH;
        this._coordScaleX = (stimW && stimW > 0) ? canvasW / stimW : 1;
        this._coordScaleY = (stimH && stimH > 0) ? canvasH / stimH : 1;

        // Scale fixation coordinates before building timeline
        const scaledFixations = scanpathData.fixations.map(f => ({
            x: f.x * this._coordScaleX,
            y: f.y * this._coordScaleY,
            tStart: f.tStart,
            tEnd: f.tEnd
        }));

        this.timeline = this._buildTimeline(scaledFixations);
        this.state = 'idle';
        this.playbackTime = 0;

        // Set initial position to first fixation
        if (scaledFixations.length > 0) {
            this.x = scaledFixations[0].x;
            this.y = scaledFixations[0].y;
        }

        // Load mouse replay if timeline present — scale mouse coordinates too
        if (scanpathData.mouseTimeline && scanpathData.mouseTimeline.length > 0) {
            this.mousePlayer = new MouseCursorPlayer();
            const scaledMouse = scanpathData.mouseTimeline.map(evt => ({
                ...evt,
                x: evt.x * this._coordScaleX,
                y: evt.y * this._coordScaleY
            }));
            this.mousePlayer.load(scaledMouse);
        } else {
            this.mousePlayer = null;
        }

        // Load scroll timeline if present
        if (scanpathData.scrollTimeline && scanpathData.scrollTimeline.length > 0) {
            this.scrollTimeline = scanpathData.scrollTimeline;
        } else {
            this.scrollTimeline = null;
        }
    }

    /**
     * Start or resume playback.
     */
    play() {
        if (this.timeline.length === 0) return;

        if (this.state === 'paused' && this.wallPauseTime !== null) {
            // Resume — shift wall start to account for pause duration
            const pauseDuration = performance.now() - this.wallPauseTime;
            this.wallStartTime += pauseDuration;
            this.wallPauseTime = null;
        } else {
            // Fresh start
            this.wallStartTime = performance.now();
            this.playbackTime = 0;
        }
        this.state = 'playing';
    }

    /**
     * Pause playback at current position.
     */
    pause() {
        if (this.state !== 'playing') return;
        this.wallPauseTime = performance.now();
        this.state = 'paused';
    }

    /**
     * Step forward or backward by n fixations.
     * @param {number} n - Number of fixations to step (negative = backward)
     */
    step(n) {
        if (this.timeline.length === 0) return;

        // Find current fixation index
        let currentFixIdx = this._currentFixationIndex();
        const targetIdx = Math.max(0, Math.min(this.scanpath.fixations.length - 1, currentFixIdx + n));
        const targetFix = this.scanpath.fixations[targetIdx];

        // Find the timeline segment for this fixation
        const targetSeg = this.timeline.find(
            s => s.type === 'fixation' && s.fixationIndex === targetIdx
        );
        if (targetSeg) {
            this.playbackTime = targetSeg.tStart;
            this.x = targetFix.x;
            this.y = targetFix.y;
            // Recalibrate wall clock so update() continues from here
            this.wallStartTime = performance.now() - (this.playbackTime / this.speed);
        }

        if (this.state !== 'playing') {
            this.state = 'paused';
        }
    }

    /**
     * Jump to absolute time in the playback.
     * @param {number} timeMs - Target time in ms
     */
    seek(timeMs) {
        this.playbackTime = Math.max(0, timeMs);
        this.wallStartTime = performance.now() - (this.playbackTime / this.speed);

        // Interpolate position at seek target
        const seg = this._findSegment(this.playbackTime);
        if (seg) {
            if (seg.type === 'fixation') {
                this.x = seg.x;
                this.y = seg.y;
            } else {
                const segDur = seg.tEnd - seg.tStart;
                const t = (this.playbackTime - seg.tStart) / segDur;
                const s = 10 * t * t * t - 15 * t * t * t * t + 6 * t * t * t * t * t;
                this.x = seg.x1 + (seg.x2 - seg.x1) * s;
                this.y = seg.y1 + (seg.y2 - seg.y1) * s;
            }
        }
    }

    /**
     * Rewind to start.
     */
    reset() {
        this.playbackTime = 0;
        this.state = 'idle';
        this.wallStartTime = null;
        this.wallPauseTime = null;
        this.isSaccading = false;
        this.currentVelocity = 0;
        this.currentVelocityX = 0;
        this.currentVelocityY = 0;

        if (this.scanpath && this.scanpath.fixations.length > 0) {
            this.x = this.scanpath.fixations[0].x;
            this.y = this.scanpath.fixations[0].y;
        }

        if (this.mousePlayer) this.mousePlayer.reset();
        if (this.scrollTimeline && this.onScroll) this.onScroll(0);
    }

    /**
     * Set playback speed multiplier.
     * @param {number} multiplier - 0.5 = half speed, 2.0 = double speed, etc.
     */
    setSpeed(multiplier) {
        if (!isFinite(multiplier) || multiplier <= 0) return;

        // Preserve current playback position when changing speed
        const now = performance.now();
        if (this.state === 'playing') {
            this.playbackTime = (now - this.wallStartTime) * this.speed;
            this.wallStartTime = now - (this.playbackTime / multiplier);
        }
        this.speed = multiplier;
    }

    /**
     * Get current playback progress.
     * @returns {{ currentTime: number, totalDuration: number, fixationIndex: number, totalFixations: number, state: string }}
     */
    getProgress() {
        const totalDuration = this.timeline.length > 0
            ? this.timeline[this.timeline.length - 1].tEnd
            : 0;
        return {
            currentTime: this.playbackTime,
            totalDuration,
            fixationIndex: this._currentFixationIndex(),
            totalFixations: this.scanpath ? this.scanpath.fixations.length : 0,
            state: this.state
        };
    }

    // ── Internal ──────────────────────────────────────────────────

    /**
     * Interpolate scroll offset at a given playback time.
     * @param {number} timeMs - Playback time in ms
     * @returns {number} Scroll Y offset in pixels
     */
    _interpolateScroll(timeMs) {
        const st = this.scrollTimeline;
        if (!st || st.length === 0) return 0;

        if (timeMs <= st[0].t) return 0;
        if (timeMs >= st[st.length - 1].t) return st[st.length - 1].scrollY;

        // Linear scan — scroll events are sparse enough that binary search isn't needed
        for (let i = 0; i < st.length - 1; i++) {
            if (timeMs >= st[i].t && timeMs < st[i + 1].t) {
                const t = (timeMs - st[i].t) / (st[i + 1].t - st[i].t);
                return st[i].scrollY + (st[i + 1].scrollY - st[i].scrollY) * t;
            }
        }
        return st[st.length - 1].scrollY;
    }

    /**
     * Build a flat timeline of alternating fixation and saccade segments.
     *
     * If input fixations have no explicit gaps (tEnd[i] === tStart[i+1]),
     * synthetic saccades are inserted using the main sequence duration estimate.
     *
     * @param {Fixation[]} fixations
     * @returns {Array} Timeline segments
     */
    _buildTimeline(fixations) {
        if (fixations.length === 0) return [];

        const timeline = [];
        let t = 0; // Running clock for the rebuilt timeline

        for (let i = 0; i < fixations.length; i++) {
            const fix = fixations[i];
            const fixDuration = fix.tEnd - fix.tStart;

            // Insert saccade before this fixation (except the first)
            if (i > 0) {
                const prev = fixations[i - 1];
                const explicitGap = fix.tStart - prev.tEnd;

                let saccDuration;
                if (explicitGap > 5) {
                    // Dataset provides explicit saccade timing
                    saccDuration = explicitGap;
                } else {
                    // Insert synthetic saccade (main sequence estimate)
                    const dx = fix.x - prev.x;
                    const dy = fix.y - prev.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    saccDuration = saccadeDurationFromPixels(dist, this.ppd);
                }

                timeline.push({
                    type: 'saccade',
                    tStart: t,
                    tEnd: t + saccDuration,
                    x1: prev.x,
                    y1: prev.y,
                    x2: fix.x,
                    y2: fix.y,
                    fixationIndex: i // index of the target fixation
                });
                t += saccDuration;
            }

            // Fixation segment
            timeline.push({
                type: 'fixation',
                tStart: t,
                tEnd: t + fixDuration,
                x: fix.x,
                y: fix.y,
                fixationIndex: i
            });
            t += fixDuration;
        }

        return timeline;
    }

    /**
     * Binary search for the timeline segment containing a given time.
     * @param {number} timeMs
     * @returns {Object|null} The segment, or null if out of range
     */
    _findSegment(timeMs) {
        const tl = this.timeline;
        if (tl.length === 0) return null;
        if (timeMs < 0) return tl[0];
        if (timeMs >= tl[tl.length - 1].tEnd) return tl[tl.length - 1];

        let lo = 0, hi = tl.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            if (timeMs < tl[mid].tStart) {
                hi = mid - 1;
            } else if (timeMs >= tl[mid].tEnd) {
                lo = mid + 1;
            } else {
                return tl[mid];
            }
        }
        return tl[lo] || tl[tl.length - 1];
    }

    /**
     * Determine the current fixation index from playback time.
     * @returns {number}
     */
    _currentFixationIndex() {
        const seg = this._findSegment(this.playbackTime);
        if (!seg) return 0;
        return seg.fixationIndex || 0;
    }

    /**
     * Update CSS-to-physical scale factors from canvas dimensions.
     */
    _updateScale() {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            this.scaleX = this.canvas.width / rect.width;
            this.scaleY = this.canvas.height / rect.height;
        }
    }
}

module.exports = ScanpathPlayer;
