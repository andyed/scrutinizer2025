/**
 * SVG Overlay Manager
 * Handles vector-based debug overlays for Foveal, Parafoveal, and Radial Grid visualizations.
 * Handles vector-based debug overlays for Foveal, Parafoveal, and Radial Grid visualizations.
 * Replaces shader-based debug lines for crisper visuals and better control.
 *
 * DEVELOPER NOTE:
 * Want to add a new overlay? See "docs/developers_guide.md" -> "Adding a New Overlay".
 * PLEASE follow the performance guidelines (Group Translation vs Per-Element Updates).
 */
class SVGOverlay {
    constructor(containerId) {
        console.log(`[SVGOverlay] Initializing with container: ${containerId}`);
        this.containerId = containerId;
        this.svg = document.getElementById(containerId);

        if (!this.svg) {
            console.error('[SVGOverlay] Container not found:', containerId);
            return;
        }
        console.log('[SVGOverlay] Container found!');

        // Cache elements to avoid constant DOM queries/creation
        this.elements = {
            fovea: {
                group: this.createGroup('fovea-group'),
                // White with very subtle fill
                circle: this.createCircle('fovea-circle', 'none', '#ffffff', 1.5, 0.6),
                ticks: this.createGroup('fovea-ticks')
            },
            parafovea: {
                group: this.createGroup('parafovea-group'),
                // Cool Blue/Grey - "Scientific"
                circle: this.createCircle('parafovea-circle', 'none', '#a0c0ff', 1.5, 0.7)
            },
            grid: {
                group: this.createGroup('grid-group'),
                rings: this.createGroup('grid-rings'),
                spokes: this.createGroup('grid-spokes')
            }
        };

        // Tick cache
        this.tickPool = []; // reuse lines
        this.ringPool = []; // reuse circles
        this.spokePool = []; // reuse lines

        // Initial setup
        this.initFilters();
        this.initFoveaTicks();
    }

    initFilters() {
        // Create standard SVG drop shadow filter
        const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
        filter.setAttribute("id", "halo-shadow");
        filter.setAttribute("x", "-50%");
        filter.setAttribute("y", "-50%");
        filter.setAttribute("width", "200%");
        filter.setAttribute("height", "200%");

        const feDropShadow = document.createElementNS("http://www.w3.org/2000/svg", "feDropShadow");
        feDropShadow.setAttribute("dx", "0");
        feDropShadow.setAttribute("dy", "0");
        feDropShadow.setAttribute("stdDeviation", "1.5"); // Tighter shadow for crisp look
        feDropShadow.setAttribute("flood-color", "rgba(0,0,0,0.9)");

        filter.appendChild(feDropShadow);
        defs.appendChild(filter);
        this.svg.appendChild(defs);
    }

    createGroup(id, useFilter = true) {
        let g = document.getElementById(id);
        if (!g) {
            g = document.createElementNS("http://www.w3.org/2000/svg", "g");
            g.setAttribute('id', id);
            g.setAttribute('shape-rendering', 'geometricPrecision'); // Ensure crisp edges (no "optimizeSpeed")

            // Optimization: Hint to browser to promote to layer
            g.style.willChange = 'transform';

            if (useFilter) {
                // Store the intended filter for restoring later
                g.dataset.filter = 'url(#halo-shadow)';
                g.setAttribute('filter', 'url(#halo-shadow)');
            }
            this.svg.appendChild(g);
        }
        return g;
    }

    createCircle(id, fill, stroke, strokeWidth, opacity) {
        const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        c.setAttribute('id', id);
        c.setAttribute('fill', fill);
        c.setAttribute('stroke', stroke);
        c.setAttribute('stroke-width', strokeWidth);
        c.setAttribute('opacity', opacity);
        // Ensure nice rendering
        c.setAttribute('vector-effect', 'non-scaling-stroke');
        return c;
    }

    createLine(stroke, strokeWidth, opacity) {
        const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
        l.setAttribute('stroke', stroke);
        l.setAttribute('stroke-width', strokeWidth);
        l.setAttribute('opacity', opacity);
        return l;
    }

    initFoveaTicks() {
        // 12 Ticks
        const count = 12;
        for (let i = 0; i < count; i++) {
            // White ticks
            const line = this.createLine('#ffffff', 1.5, 0.8);
            this.elements.fovea.ticks.appendChild(line);
            this.tickPool.push(line);
        }

        // Append main static elements
        this.elements.fovea.group.appendChild(this.elements.fovea.circle);
        this.elements.fovea.group.appendChild(this.elements.fovea.ticks);

        this.elements.parafovea.group.appendChild(this.elements.parafovea.circle);

        // Setup parafovea style (dashed)
        this.elements.parafovea.circle.setAttribute('stroke-dasharray', '20, 10'); // Wider dash
        this.elements.parafovea.circle.setAttribute('stroke-linecap', 'butt'); // Cleaner ends

        // OPTIMIZATION: Do NOT filter the grid group to improve performance
        // The grid moves every frame, causing constant re-rasterization of the shadow if filtered.
        this.elements.grid.group.removeAttribute('filter');
        this.elements.grid.group.dataset.filter = ''; // No filter for grid ever

        this.elements.grid.group.appendChild(this.elements.grid.rings);
        this.elements.grid.group.appendChild(this.elements.grid.spokes);
    }

    update(x, y, foveaRadius, aspectRatio, mode, parafoveaRadius) {
        if (!this.svg) return;

        // Hide all initially
        this.elements.fovea.group.style.display = 'none';
        this.elements.parafovea.group.style.display = 'none';
        this.elements.grid.group.style.display = 'none';

        if (mode < 0.5) return; // Off

        // Aggressive Optimization:
        // If Grid is active (Mode 3, aka "hi-tech"), DISABLE filters on everything to save compositing cost.
        // If Grid is OFF, restore filters for nice visuals.
        const isHighPerformanceMode = (mode > 2.5);

        const setFilter = (el, enable) => {
            if (enable && el.dataset.filter) el.setAttribute('filter', el.dataset.filter);
            else el.removeAttribute('filter');
        };

        setFilter(this.elements.fovea.group, !isHighPerformanceMode);
        setFilter(this.elements.parafovea.group, !isHighPerformanceMode);

        // --- MODE 1: FOVEA ---
        if (mode > 0.5) {
            this.elements.fovea.group.style.removeProperty('display');
            // Translation for performance
            this.elements.fovea.group.setAttribute('transform', `translate(${x}, ${y})`);

            // Update Circle Radius (cheap)
            // Use 0,0 locally since we translated the group
            this.elements.fovea.circle.setAttribute('cx', 0);
            this.elements.fovea.circle.setAttribute('cy', 0);
            this.elements.fovea.circle.setAttribute('r', foveaRadius);

            // Update Ticks (Outward)
            const tickLen = 15;
            const tickStart = foveaRadius;
            const tickEnd = foveaRadius + tickLen;
            const count = this.tickPool.length;

            for (let i = 0; i < count; i++) {
                const angle = (i / count) * Math.PI * 2;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);

                const line = this.tickPool[i];
                // Local coords
                line.setAttribute('x1', cos * tickStart);
                line.setAttribute('y1', sin * tickStart);
                line.setAttribute('x2', cos * tickEnd);
                line.setAttribute('y2', sin * tickEnd);
            }
        }

        // --- MODE 2: PARAFOVEA ---
        if (mode > 1.5) {
            this.elements.parafovea.group.style.removeProperty('display');
            this.elements.parafovea.group.setAttribute('transform', `translate(${x}, ${y})`);

            this.elements.parafovea.circle.setAttribute('cx', 0);
            this.elements.parafovea.circle.setAttribute('cy', 0);
            this.elements.parafovea.circle.setAttribute('r', parafoveaRadius);
        }

        // --- MODE 3: RADIAL GRID ---
        if (mode > 2.5) {
            this.elements.grid.group.style.removeProperty('display');

            // Check if we need to rebuild the grid (radius changed significantly)
            // Tolerance of 1px to prevent float jitter rebuilding
            if (!this.lastGridRadius || Math.abs(this.lastGridRadius - foveaRadius) > 1.0) {
                this.buildGrid(parafoveaRadius, foveaRadius); // Pass current parafovea radius but use fovea for stepping
                this.lastGridRadius = foveaRadius;
            }

            // PERFORMANCE: Just translate the entire group!
            // No need to iterate 50+ elements every frame.
            this.elements.grid.group.setAttribute('transform', `translate(${x}, ${y})`);
        }
    }

    buildGrid(startRadius, stepSize) {
        // Clear existing using display:none logic or remove children?
        // Let's reuse pool logic but force a "reset" of positions

        // Linear rings: r = start + n * step
        const diag = Math.sqrt(window.innerWidth ** 2 + window.innerHeight ** 2);
        const maxRadius = diag; // Cover screen

        // Use fovea radius as the step size (e.g., 90px)
        const step = stepSize || 90;

        // --- Rings ---
        // Warning: StartRadius passed to update() is ParafoveaRadius.
        // We want the grid to start AFTER parafovea.
        // But since we are translating the group to (x,y), all circles are centered at (0,0).

        let currentR = startRadius + step; // Start one step out from parafovea
        let ringIdx = 0;

        while (currentR < maxRadius) {
            let ring = this.ringPool[ringIdx];
            if (!ring) {
                // Color: Cyan
                ring = this.createCircle(`grid-ring-${ringIdx}`, 'none', '#00ccff', 1, 0.15);
                this.elements.grid.rings.appendChild(ring);
                this.ringPool.push(ring);
            }

            // Variable Stroke Width: Thinner at edges
            const normalizedDist = Math.min(1.0, currentR / (window.innerHeight * 0.8));
            const width = Math.max(0.3, 1.2 * (1.0 - normalizedDist * 0.8));

            ring.setAttribute('cx', 0); // Local center
            ring.setAttribute('cy', 0);
            ring.setAttribute('r', currentR);
            ring.setAttribute('stroke-width', width);
            ring.style.removeProperty('display');

            currentR += step;
            ringIdx++;
        }

        // Hide unused rings
        for (let i = ringIdx; i < this.ringPool.length; i++) {
            this.ringPool[i].style.display = 'none';
        }


        // --- Spokes ---
        const spokeCount = 16;
        for (let i = 0; i < spokeCount; i++) {
            let spoke = this.spokePool[i];
            if (!spoke) {
                spoke = this.createLine('#80a0ff', 1, 0.15);
                this.elements.grid.spokes.appendChild(spoke);
                this.spokePool.push(spoke);
            }

            const angle = (i / spokeCount) * Math.PI * 2;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            // Start at parafovea (startRadius)
            spoke.setAttribute('x1', cos * startRadius);
            spoke.setAttribute('y1', sin * startRadius);

            const far = maxRadius;
            spoke.setAttribute('x2', cos * far);
            spoke.setAttribute('y2', sin * far);

            // Variable width? Spokes are long, so maybe constant or gradient (SVG gradients are expensive).
            // Let's keep it simple for now, maybe slightly thinner than rings.
            spoke.setAttribute('stroke-width', 0.8);

            spoke.style.removeProperty('display');
        }
    }
}

// Export for usage
if (typeof module !== 'undefined') {
    module.exports = SVGOverlay;
}
if (typeof window !== 'undefined') {
    window.SVGOverlay = SVGOverlay;
}
