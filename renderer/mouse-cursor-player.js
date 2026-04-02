/**
 * MouseCursorPlayer — replays recorded mouse movements independently of gaze.
 *
 * Interpolates dense mouse event data (~60Hz) to produce smooth cursor
 * position at any playback time. Shares the playback clock with
 * ScanpathPlayer but maintains its own position state.
 *
 * Mouse coordinates are in screen-space pixels (viewport-relative),
 * matching the AdSERP mouse-movement-data format.
 */

class MouseCursorPlayer {
    constructor() {
        this.timeline = [];   // [{t, x, y, event, xpath}] sorted by t
        this.x = 0;
        this.y = 0;
        this.currentEvent = null;   // Most recent event type
        this.currentEventAge = 0;   // ms since last non-mousemove event (for click flash)
        this._lastUpdateTime = 0;
        this._segmentIndex = 0;     // Cache for sequential access
    }

    /**
     * Load mouse timeline data.
     * @param {Array<{t: number, x: number, y: number, event: string}>} timeline
     *   Sorted by t (ms from trial start). Screen-space coordinates.
     */
    load(timeline) {
        this.timeline = timeline;
        this._segmentIndex = 0;
        if (timeline.length > 0) {
            this.x = timeline[0].x;
            this.y = timeline[0].y;
            this.currentEvent = timeline[0].event;
        }
    }

    /**
     * Update mouse position for current playback time.
     * Uses linear interpolation between adjacent events.
     *
     * @param {number} playbackTimeMs - Current playback time in ms
     */
    update(playbackTimeMs) {
        const tl = this.timeline;
        if (tl.length === 0) return;

        // Clamp to timeline bounds
        if (playbackTimeMs <= tl[0].t) {
            this.x = tl[0].x;
            this.y = tl[0].y;
            this.currentEvent = tl[0].event;
            this.currentEventAge = 0;
            return;
        }

        if (playbackTimeMs >= tl[tl.length - 1].t) {
            const last = tl[tl.length - 1];
            this.x = last.x;
            this.y = last.y;
            this.currentEvent = last.event;
            this.currentEventAge = playbackTimeMs - last.t;
            return;
        }

        // Sequential scan from cached index — fast for forward playback
        let idx = this._segmentIndex;
        // Reset if we've gone backward (seek)
        if (idx >= tl.length - 1 || tl[idx].t > playbackTimeMs) {
            idx = 0;
        }
        while (idx < tl.length - 1 && tl[idx + 1].t <= playbackTimeMs) {
            idx++;
        }
        this._segmentIndex = idx;

        const before = tl[idx];
        const after = tl[idx + 1];

        if (!after || before.t === after.t) {
            this.x = before.x;
            this.y = before.y;
        } else {
            // Linear interpolation between mouse events
            const t = (playbackTimeMs - before.t) / (after.t - before.t);
            this.x = before.x + (after.x - before.x) * t;
            this.y = before.y + (after.y - before.y) * t;
        }

        // Track the most recent non-mousemove event for visual feedback
        this.currentEvent = before.event;
        if (before.event === 'click' || before.event === 'mousedown' || before.event === 'mouseup') {
            this.currentEventAge = playbackTimeMs - before.t;
        } else {
            this.currentEventAge = Infinity;
        }

        this._lastUpdateTime = playbackTimeMs;
    }

    /**
     * @returns {{x: number, y: number}} Current mouse position in screen-space pixels
     */
    getPosition() {
        return { x: this.x, y: this.y };
    }

    /**
     * @returns {{event: string, age: number}} Current event type and ms since it occurred
     */
    getCurrentEvent() {
        return { event: this.currentEvent, age: this.currentEventAge };
    }

    /**
     * Reset to start.
     */
    reset() {
        this._segmentIndex = 0;
        this._lastUpdateTime = 0;
        if (this.timeline.length > 0) {
            this.x = this.timeline[0].x;
            this.y = this.timeline[0].y;
            this.currentEvent = this.timeline[0].event;
        }
        this.currentEventAge = 0;
    }
}

module.exports = MouseCursorPlayer;
