/**
 * ComplexityHUD — Interactive floating panel showing complexity stats.
 *
 * Displays a tabbed panel (Score / Stats / Spatial) that is:
 * - Directly clickable (tabs, close button)
 * - Draggable via the tab bar (click-vs-drag disambiguation at 3px threshold)
 * - Interactive via dynamic setIgnoreMouseEvents toggle
 *
 * The overlay window normally passes all clicks through to the browser below.
 * When the cursor enters the HUD, it signals main to disable mouse passthrough
 * so clicks land on the panel. When the cursor leaves, passthrough is restored.
 *
 * @module ComplexityHUD
 */
(() => {
    const RATINGS = [
        { max: 25, label: 'Low', bars: 1, color: '#43a047' },
        { max: 50, label: 'Medium', bars: 2, color: '#f9a825' },
        { max: 75, label: 'High', bars: 3, color: '#ef6c00' },
        { max: 100, label: 'Extreme', bars: 4, color: '#d32f2f' }
    ];

    function scoreColor(v) {
        if (v <= 25) return '#43a047';
        if (v <= 50) return '#f9a825';
        if (v <= 75) return '#ef6c00';
        return '#d32f2f';
    }

    class ComplexityHUD {
        /**
         * @param {string} containerId - DOM id of the container element
         * @param {Object} [options]
         * @param {Object} [options.ipcRenderer] - Electron ipcRenderer for interactivity IPC
         * @param {Function} [options.onClose] - Callback when close button is clicked
         */
        constructor(containerId, options = {}) {
            this.container = document.getElementById(containerId);
            if (!this.container) {
                console.warn('[ComplexityHUD] Container not found:', containerId);
                return;
            }

            this._ipc = options.ipcRenderer || null;
            this.onClose = options.onClose || null;
            this.activeTab = 'score';
            this._lastCStats = null;
            this._lastEStats = null;
            this._lastPerfStats = null;
            this._pending = false;
            this._dragging = false;

            this._buildDOM();
            this._setupInteractivity();
            this._setupDrag();
            this.setVisible(false);
        }

        _buildDOM() {
            const el = this.container;
            el.innerHTML = '';

            el.style.cssText = `
                position: fixed;
                bottom: 12px;
                left: 12px;
                width: 210px;
                background: rgba(10, 10, 12, 0.92);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 6px;
                font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
                font-size: 11px;
                color: #ccc;
                pointer-events: auto;
                z-index: 103;
                overflow: hidden;
            `;

            // Tab bar — also serves as drag handle (click-vs-drag at 3px threshold)
            this.tabBar = document.createElement('div');
            this.tabBar.style.cssText = `
                display: flex;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                user-select: none;
                cursor: grab;
            `;

            const tabs = ['score', 'stats', 'spatial', 'perf'];
            const tabLabels = { score: 'Score', stats: 'Stats', spatial: 'Spatial', perf: 'Perf' };
            this.tabButtons = {};

            for (const tab of tabs) {
                const btn = document.createElement('div');
                btn.textContent = tabLabels[tab];
                btn.dataset.tab = tab;
                btn.style.cssText = `
                    flex: 1;
                    text-align: center;
                    padding: 6px 0;
                    cursor: pointer;
                    font-size: 10px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    border-bottom: 2px solid transparent;
                    transition: border-color 0.15s, color 0.15s;
                `;
                btn.addEventListener('click', () => {
                    if (this._dragging) return;
                    this._setActiveTab(tab);
                    this._rerender();
                });
                this.tabButtons[tab] = btn;
                this.tabBar.appendChild(btn);
            }

            // Close button (×) in the tab bar
            this._closeBtn = document.createElement('div');
            this._closeBtn.textContent = '\u00d7';
            this._closeBtn.title = 'Close Congestion Report';
            this._closeBtn.style.cssText = `
                padding: 6px 8px;
                cursor: pointer;
                color: #666;
                font-size: 14px;
                line-height: 1;
                flex-shrink: 0;
                transition: color 0.15s;
            `;
            this._closeBtn.addEventListener('mouseenter', () => {
                this._closeBtn.style.color = '#fff';
            });
            this._closeBtn.addEventListener('mouseleave', () => {
                this._closeBtn.style.color = '#666';
            });
            this._closeBtn.addEventListener('click', () => {
                if (this._dragging) return;
                if (this.onClose) this.onClose();
            });
            this.tabBar.appendChild(this._closeBtn);

            el.appendChild(this.tabBar);

            // Content area (with transition for pending fade)
            this.contentArea = document.createElement('div');
            this.contentArea.style.cssText = 'padding: 8px 10px; min-height: 60px; transition: opacity 0.3s ease;';
            el.appendChild(this.contentArea);

            // Pending indicator (shifted left to clear close button)
            this.pendingIndicator = document.createElement('div');
            this.pendingIndicator.style.cssText = `
                position: absolute;
                top: 8px;
                right: 30px;
                font-size: 9px;
                color: #4fc3f7;
                opacity: 0;
                transition: opacity 0.3s ease;
                display: flex;
                align-items: center;
                gap: 4px;
                pointer-events: none;
            `;
            this.pendingIndicator.innerHTML = `
                <span style="display:inline-block;width:6px;height:6px;border:1.5px solid #4fc3f7;border-top-color:transparent;border-radius:50%;animation:hud-spin 0.8s linear infinite;"></span>
                <span>updating</span>
            `;
            el.appendChild(this.pendingIndicator);

            // Spinner keyframes (inject once)
            if (!document.getElementById('hud-spin-style')) {
                const style = document.createElement('style');
                style.id = 'hud-spin-style';
                style.textContent = '@keyframes hud-spin { to { transform: rotate(360deg); } }';
                document.head.appendChild(style);
            }

            this._setActiveTab('score');
        }

        /**
         * Toggle overlay window interactivity when cursor enters/leaves the panel.
         *
         * Entry detection: The overlay window is normally click-through
         * (setIgnoreMouseEvents(true, { forward: true })). In this mode, DOM events
         * on the HUD don't fire reliably — macOS forwards raw positions but Chromium
         * may not dispatch element-level events from them. So entry is detected via
         * handleMousePosition(), called by the host with coordinates from the
         * browser:mousemove IPC stream (which always works).
         *
         * Exit detection: Once we toggle setIgnoreMouseEvents(false), the window
         * receives events normally. Standard DOM mouseleave fires when the cursor
         * leaves the HUD, and we restore click-through mode.
         */
        _setupInteractivity() {
            if (!this._ipc) return;
            this._isInteractive = false;

            // Exit detection: fires when window is interactive (setIgnoreMouseEvents(false))
            this.container.addEventListener('mouseleave', () => {
                if (this._dragging) return;
                if (this._isInteractive) {
                    this._isInteractive = false;
                    this._ipc.send('overlay:set-interactive', false);
                }
            });

            // Fallback exit: document-level mousemove catches edge cases
            // (e.g. cursor moves off HUD but mouseleave doesn't fire)
            document.addEventListener('mousemove', (e) => {
                if (!this._isInteractive || this._dragging) return;
                if (this.container.style.display === 'none') return;
                const rect = this.container.getBoundingClientRect();
                const over = e.clientX >= rect.left && e.clientX <= rect.right &&
                             e.clientY >= rect.top && e.clientY <= rect.bottom;
                if (!over) {
                    this._isInteractive = false;
                    this._ipc.send('overlay:set-interactive', false);
                }
            });
        }

        /**
         * Call with cursor position (local window coordinates) to detect entry.
         * The host calls this from the browser:mousemove IPC stream, which fires
         * continuously regardless of setIgnoreMouseEvents state.
         * @param {number} clientX - X in local window coords
         * @param {number} clientY - Y in local window coords
         */
        handleMousePosition(clientX, clientY) {
            if (!this._ipc || this._isInteractive) return;
            if (this.container.style.display === 'none') return;

            const rect = this.container.getBoundingClientRect();
            const over = clientX >= rect.left && clientX <= rect.right &&
                         clientY >= rect.top && clientY <= rect.bottom;

            if (over) {
                this._isInteractive = true;
                this._ipc.send('overlay:set-interactive', true);
            }
        }

        /**
         * Drag behavior on the tab bar. Uses click-vs-drag disambiguation:
         * only starts dragging after 3px of movement. Under 3px = normal click
         * (tab switch or close button fires as expected).
         */
        _setupDrag() {
            const handle = this.tabBar;
            if (!handle) return;
            let dragState = null;

            handle.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                const rect = this.container.getBoundingClientRect();
                dragState = {
                    startX: e.clientX,
                    startY: e.clientY,
                    origLeft: rect.left,
                    origTop: rect.top
                };
            });

            window.addEventListener('mousemove', (e) => {
                if (!dragState) return;
                const dx = e.clientX - dragState.startX;
                const dy = e.clientY - dragState.startY;

                // Start dragging after 3px threshold
                if (!this._dragging) {
                    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
                    this._dragging = true;
                    handle.style.cursor = 'grabbing';
                }

                // Switch from bottom to top positioning on first drag
                this.container.style.left = (dragState.origLeft + dx) + 'px';
                this.container.style.top = (dragState.origTop + dy) + 'px';
                this.container.style.bottom = 'auto';
            });

            window.addEventListener('mouseup', () => {
                if (!dragState) return;
                const wasDragging = this._dragging;
                dragState = null;
                this._dragging = false;
                handle.style.cursor = 'grab';

                if (wasDragging && this._ipc) {
                    // The next mousemove will re-evaluate bounds and toggle
                    // interactivity off if cursor is outside the panel
                }
            });
        }

        _setActiveTab(tab) {
            this.activeTab = tab;
            for (const [key, btn] of Object.entries(this.tabButtons)) {
                if (key === tab) {
                    btn.style.borderBottomColor = '#4fc3f7';
                    btn.style.color = '#fff';
                } else {
                    btn.style.borderBottomColor = 'transparent';
                    btn.style.color = '#999';
                }
            }
        }

        /**
         * Mark the HUD as pending (stale data, new analysis in progress).
         * @param {boolean} pending - Whether data is stale
         * @param {boolean} [gentle=false] - Gentle mode (DOM mutation): less opacity
         *   fade since the current score is mostly valid. Full mode (scroll): strong
         *   fade since the viewport content changed significantly.
         */
        setPending(pending, gentle = false) {
            this._pending = pending;
            if (this.contentArea) {
                if (!pending) {
                    this.contentArea.style.opacity = '1';
                } else {
                    // Scroll: strong fade (0.35). Mutation: gentle fade (0.7).
                    this.contentArea.style.opacity = gentle ? '0.7' : '0.35';
                }
            }
            if (this.pendingIndicator) {
                this.pendingIndicator.style.opacity = pending ? '1' : '0';
            }
        }

        /**
         * Update HUD content with latest stats.
         * Note: pending state is managed externally via setPending() and the
         * congestion generation counter — not auto-cleared here.
         * @param {Object|null} congestionStats - { mean, p90, p10, max, quadrants }
         * @param {Object|null} edgeDensityStats - same shape
         */
        update(congestionStats, edgeDensityStats, perfStats) {
            if (!this.container || !this.contentArea) return;

            // Keep last valid stats across page loads — only overwrite with real data
            if (congestionStats) this._lastCStats = congestionStats;
            if (edgeDensityStats) this._lastEStats = edgeDensityStats;
            if (perfStats) this._lastPerfStats = perfStats;
            this._rerender();
        }

        _rerender() {
            const cStats = this._lastCStats;
            const eStats = this._lastEStats;

            if (!cStats && !eStats) {
                this.contentArea.innerHTML = '<span style="color:#aaa">Waiting for analysis...</span>';
                return;
            }

            const c = cStats || { mean: 0, p90: 0, p10: 0, max: 0, quadrants: {} };
            const e = eStats || { mean: 0, p90: 0, p10: 0, max: 0, quadrants: {} };

            // Score uses p90 (captures cluttered regions, not whitespace-dragged mean)
            // with sqrt scaling to spread the 0-100 range.
            // p90 answers: "how cluttered are the busy parts of this page?"
            const compositeScore = Math.round(Math.sqrt(c.p90 * 0.7 + e.p90 * 0.3) * 100);
            const rating = RATINGS.find(r => compositeScore <= r.max) || RATINGS[RATINGS.length - 1];

            switch (this.activeTab) {
                case 'score':
                    this._renderScore(compositeScore, rating);
                    break;
                case 'stats':
                    this._renderStats(c, e);
                    break;
                case 'spatial':
                    this._renderSpatial(c, e);
                    break;
                case 'perf':
                    this._renderPerf();
                    break;
            }
        }

        _renderScore(score, rating) {
            const c = rating.color;
            const bars = Array.from({ length: 4 }, (_, i) =>
                `<span style="display:inline-block;width:14px;height:10px;margin-right:2px;background:${i < rating.bars ? c : 'rgba(255,255,255,0.15)'};border-radius:1px;"></span>`
            ).join('');

            this.contentArea.innerHTML = `
                <div style="margin-bottom:4px;color:#ccc;font-size:10px;letter-spacing:0.3px;">COMPLEXITY</div>
                <div style="display:flex;align-items:baseline;gap:6px;">
                    <span style="font-size:28px;font-weight:bold;color:${c};">${score}</span>
                    <span style="color:#aaa;font-size:12px;">/ 100</span>
                </div>
                <div style="margin-top:6px;display:flex;align-items:center;gap:6px;">
                    ${bars}
                    <span style="color:${c};font-size:10px;font-weight:600;">${rating.label}</span>
                </div>
            `;
        }

        _renderStats(c, e) {
            const row = (label, mean, p90) =>
                `<div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                    <span style="color:#bbb;min-width:75px;">${label}</span>
                    <span style="color:#eee;">${mean.toFixed(2)}</span>
                    <span style="color:#bbb;">${p90.toFixed(2)}</span>
                </div>`;

            this.contentArea.innerHTML = `
                <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:9px;color:#aaa;">
                    <span style="min-width:75px;"></span><span>Mean</span><span>P90</span>
                </div>
                ${row('Congestion', c.mean, c.p90)}
                ${row('Edge Dens.', e.mean, e.p90)}
                <div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.12);font-size:9px;color:#aaa;">
                    Range: ${c.p10.toFixed(2)}\u2013${c.max.toFixed(2)} (cong)
                    &nbsp; ${e.p10.toFixed(2)}\u2013${e.max.toFixed(2)} (edge)
                </div>
            `;
        }

        _renderSpatial(c, e) {
            const q = c.quadrants || {};
            const qe = e.quadrants || {};

            // Quadrant values are per-region means — apply same sqrt scaling as composite
            const qScore = (cVal, eVal) => Math.round(Math.sqrt((cVal || 0) * 0.7 + (eVal || 0) * 0.3) * 100);
            const tl = qScore(q.topLeft, qe.topLeft);
            const tr = qScore(q.topRight, qe.topRight);
            const bl = qScore(q.bottomLeft, qe.bottomLeft);
            const br = qScore(q.bottomRight, qe.bottomRight);

            // Find hotspot (highest region)
            const regions = [
                { label: 'Top-Left', score: tl },
                { label: 'Top-Right', score: tr },
                { label: 'Bottom-Left', score: bl },
                { label: 'Bottom-Right', score: br }
            ];
            const hotspot = regions.reduce((a, b) => a.score >= b.score ? a : b);

            const cell = (label, v) => {
                const bg = `rgba(${v > 50 ? '239,108,0' : v > 25 ? '249,168,37' : '67,160,71'}, ${0.1 + v * 0.005})`;
                return `<td style="width:50%;text-align:center;padding:6px 2px;font-size:14px;font-weight:bold;color:${scoreColor(v)};background:${bg};border:1px solid rgba(255,255,255,0.10);">
                    ${v}<br><span style="font-size:8px;font-weight:normal;color:#bbb;">${label}</span>
                </td>`;
            };

            this.contentArea.innerHTML = `
                <table style="width:100%;border-collapse:collapse;margin-bottom:6px;">
                    <tr>${cell('Top-L', tl)}${cell('Top-R', tr)}</tr>
                    <tr>${cell('Bot-L', bl)}${cell('Bot-R', br)}</tr>
                </table>
                <div style="font-size:9px;color:#ccc;">
                    Hotspot: <span style="color:${scoreColor(hotspot.score)};font-weight:600;">${hotspot.label}</span> (${hotspot.score})
                </div>
            `;
        }

        _renderPerf() {
            const s = this._lastPerfStats;
            if (!s || s.fps === 0) {
                this.contentArea.innerHTML = '<span style="color:#aaa">Waiting for frames...</span>';
                return;
            }

            // FPS color: green ≥55, yellow ≥30, red <30
            const fpsColor = s.fps >= 55 ? '#43a047' : s.fps >= 30 ? '#f9a825' : '#d32f2f';
            const fmt = (v) => v.toFixed(2);

            // Phase breakdown bars
            const phaseColors = {
                gaze: '#43a047', memory: '#42a5f5', saliency: '#f9a825',
                congestion: '#ef6c00', render: '#d32f2f'
            };
            const phaseOrder = ['gaze', 'memory', 'saliency', 'congestion', 'render'];
            const totalAvg = s.avg || 1;

            let barsHtml = '';
            let legendHtml = '';
            for (const name of phaseOrder) {
                const p = s.phases[name];
                if (!p) continue;
                const pct = Math.max(1, (p.avg / totalAvg) * 100);
                const col = phaseColors[name] || '#888';
                barsHtml += `<div style="width:${pct}%;height:12px;background:${col};" title="${name}: ${fmt(p.avg)}ms avg"></div>`;
                legendHtml += `<span style="color:${col};margin-right:6px;">${name[0].toUpperCase()} ${fmt(p.avg)}</span>`;
            }

            this.contentArea.innerHTML = `
                <div style="margin-bottom:4px;color:#ccc;font-size:10px;letter-spacing:0.3px;">PERFORMANCE</div>
                <div style="font-size:28px;font-weight:bold;color:${fpsColor};line-height:1;">${Math.round(s.fps)}<span style="font-size:11px;color:#888;font-weight:normal;"> fps</span></div>
                <div style="margin:4px 0 2px;font-size:9px;color:#aaa;">
                    avg ${fmt(s.avg)}ms &nbsp; p95 ${fmt(s.p95)}ms &nbsp; max ${fmt(s.max)}ms
                </div>
                <div style="display:flex;height:12px;border-radius:2px;overflow:hidden;margin:4px 0;">${barsHtml}</div>
                <div style="font-size:8px;color:#aaa;line-height:1.4;">${legendHtml}</div>
            `;
        }

        /** Set a specific tab by name. */
        setTab(tab) {
            const valid = ['score', 'stats', 'spatial', 'perf'];
            if (valid.includes(tab)) {
                this._setActiveTab(tab);
                this._rerender();
            }
        }

        /** Cycle to next tab (for keyboard shortcut). */
        nextTab() {
            const tabs = ['score', 'stats', 'spatial', 'perf'];
            const idx = tabs.indexOf(this.activeTab);
            this._setActiveTab(tabs[(idx + 1) % tabs.length]);
            this._rerender();
        }

        /**
         * Toggle visibility.
         * @param {boolean} visible
         */
        setVisible(visible) {
            if (this.container) {
                this.container.style.display = visible ? 'block' : 'none';
            }
        }
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ComplexityHUD;
    }
    window.ComplexityHUD = ComplexityHUD;
})();
