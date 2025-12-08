/**
 * SVG Overlay Manager
 * Handles vector-based debug overlays for Foveal, Parafoveal, and Radial Grid visualizations.
 * Replaces shader-based debug lines for crisper visuals and better control.
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
            if (useFilter) {
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

        // --- MODE 1: FOVEA ---
        if (mode > 0.5) {
            this.elements.fovea.group.style.removeProperty('display');

            // Update Circle
            this.elements.fovea.circle.setAttribute('cx', x);
            this.elements.fovea.circle.setAttribute('cy', y);
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
                line.setAttribute('x1', x + cos * tickStart);
                line.setAttribute('y1', y + sin * tickStart);
                line.setAttribute('x2', x + cos * tickEnd);
                line.setAttribute('y2', y + sin * tickEnd);
            }
        }

        // --- MODE 2: PARAFOVEA ---
        if (mode > 1.5) {
            this.elements.parafovea.group.style.removeProperty('display');

            this.elements.parafovea.circle.setAttribute('cx', x);
            this.elements.parafovea.circle.setAttribute('cy', y);
            this.elements.parafovea.circle.setAttribute('r', parafoveaRadius);
        }

        // --- MODE 3: RADIAL GRID ---
        if (mode > 2.5) {
            this.elements.grid.group.style.removeProperty('display');
            this.updateGrid(x, y, parafoveaRadius);
        }
    }

    updateGrid(x, y, startRadius) {
        // Reuse or create rings
        // Exponential rings: r = start * 1.4^n
        const diag = Math.sqrt(window.innerWidth ** 2 + window.innerHeight ** 2);
        const maxRadius = diag; // Cover screen
        const expansion = 1.15; // Lower expansion for higher frequency rings

        // --- Rings ---
        let currentR = startRadius * expansion; // Start one step out
        let ringIdx = 0;

        while (currentR < maxRadius) {
            let ring = this.ringPool[ringIdx];
            if (!ring) {
                ring = this.createCircle(`grid-ring-${ringIdx}`, 'none', '#00ccff', 1, 0.15);
                this.elements.grid.rings.appendChild(ring);
                this.ringPool.push(ring);
            }

            ring.setAttribute('cx', x);
            ring.setAttribute('cy', y);
            ring.setAttribute('r', currentR);
            ring.style.removeProperty('display');

            currentR *= expansion;
            ringIdx++;
        }

        // Hide unused rings
        for (let i = ringIdx; i < this.ringPool.length; i++) {
            this.ringPool[i].style.display = 'none';
        }


        // --- Spokes ---
        // 16 Spokes
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

            spoke.setAttribute('x1', x + cos * startRadius);
            spoke.setAttribute('y1', y + sin * startRadius);
            // Go to end of screen (simplification: just long enough)
            const far = maxRadius;
            spoke.setAttribute('x2', x + cos * far);
            spoke.setAttribute('y2', y + sin * far);
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
