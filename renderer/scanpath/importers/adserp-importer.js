/**
 * AdSERP dataset importer.
 *
 * AdSERP: A large-scale dataset of display ad and organic result attention
 * on search engine result pages. 2,776 trials, 47 participants, Gazepoint
 * GP3 HD eye tracker (150 Hz) + mouse tracking.
 *
 * Key challenge: fixation data is in PAGE-SPACE pixels (absolute document
 * coordinates that grow with scroll), while mouse data is in SCREEN-SPACE
 * pixels (fixed viewport). Scroll events in the mouse CSV provide the
 * offset needed to reconcile the two coordinate systems.
 *
 * Data files per trial (keyed by ID like "p004-b1-t1"):
 *   fixation-data/{id}.csv    — timestamp,FPOGX,FPOGY,FPOGD (page-space px, ms)
 *   mouse-movement-data/{id}.csv — timestamp,xpos,ypos,event,xpath (screen-space px)
 *   trial-metadata/{id}.xml   — viewport dimensions, document size
 *   ad-boundary-data/{id}.json — ad bounding boxes (optional metadata)
 *
 * @see https://github.com/nicochaps/AdSERP
 */

const { saccadeDurationFromPixels } = require('../coordinate-utils');

/**
 * Parse AdSERP trial data into ScanpathData.
 *
 * @param {Object} files - Raw file contents keyed by type
 * @param {string} files.fixationCsv - Fixation CSV content
 * @param {string} files.mouseCsv - Mouse movement CSV content
 * @param {string} files.metadataXml - Trial metadata XML content
 * @param {string} [files.adBoundaryJson] - Ad boundary JSON content (optional)
 * @param {Object} [options]
 * @param {string} [options.trialId] - Trial identifier (e.g. "p004-b1-t1")
 * @returns {ScanpathData}
 */
function parse(files, options = {}) {
    const meta = parseMetadata(files.metadataXml);
    const scrollTimeline = parseScrollTimeline(files.mouseCsv);
    const mouseTimeline = parseMouseTimeline(files.mouseCsv);
    const fixations = parseFixations(files.fixationCsv, scrollTimeline, meta);
    const adBoundaries = files.adBoundaryJson ? JSON.parse(files.adBoundaryJson) : null;

    // Determine trial time origin — earliest timestamp across all streams
    const allTimestamps = [];
    if (fixations.raw.length > 0) allTimestamps.push(fixations.raw[0].absTimestamp);
    if (mouseTimeline.length > 0) allTimestamps.push(mouseTimeline[0].absTimestamp);
    const timeOrigin = Math.min(...allTimestamps);

    // Both fixation AND mouse coordinates are in page-space (absolute document
    // coordinates). Convert both to screen-space by subtracting scroll offset.
    const scanpathFixations = buildFixations(fixations.converted, fixations.raw, timeOrigin);

    // Mouse coordinates from evtrack are pageX/pageY (page-space, window-sized).
    // Rescale from window coords (1422x1137) to screen coords (1280x1024) to
    // match fixation coordinate space. Then subtract scroll offset from Y to
    // convert from page-space to screen-space (viewport-relative).
    const rx = meta.screenWidth / meta.windowWidth;   // 1280/1422 ≈ 0.9
    const ry = meta.screenHeight / meta.windowHeight;  // 1024/1137 ≈ 0.9
    const relativeMouseTimeline = mouseTimeline.map(evt => {
        const scrollY = interpolateScrollY(evt.absTimestamp, scrollTimeline);
        return {
            t: evt.absTimestamp - timeOrigin,
            x: evt.x * rx,
            y: (evt.y - scrollY) * ry,  // page→viewport in window coords, then scale to screen
            event: evt.event,
            xpath: evt.xpath
        };
    });

    // Convert scroll timeline to relative time
    const relativeScrollTimeline = scrollTimeline.map(evt => ({
        t: evt.absTimestamp - timeOrigin,
        scrollY: evt.scrollY
    }));

    // Parse trial ID for participant/batch/trial
    const trialId = options.trialId || 'unknown';
    const idMatch = trialId.match(/^(p\d+)-b(\d+)-t(\d+)$/);

    return {
        meta: {
            dataset: 'adserp',
            participantId: idMatch ? idMatch[1] : trialId,
            stimulusId: trialId,
            // Fixations are in screen-space pixels (1280x1024), not window-space.
            // ScanpathPlayer uses these to scale to physical canvas pixels.
            stimulusWidth: meta.screenWidth,
            stimulusHeight: meta.screenHeight,
            // AdSERP-specific metadata
            screenWidth: meta.screenWidth,
            screenHeight: meta.screenHeight,
            documentWidth: meta.documentWidth,
            documentHeight: meta.documentHeight,
            windowWidth: meta.windowWidth,
            windowHeight: meta.windowHeight,
            task: meta.task,
            query: meta.query,
            batch: idMatch ? parseInt(idMatch[2]) : null,
            trial: idMatch ? parseInt(idMatch[3]) : null,
            adBoundaries
        },
        fixations: scanpathFixations,
        mouseTimeline: relativeMouseTimeline,
        scrollTimeline: relativeScrollTimeline
    };
}

/**
 * Parse trial metadata XML.
 * @param {string} xmlContent
 * @returns {Object} Parsed dimensions and task info
 */
function parseMetadata(xmlContent) {
    // Simple regex extraction — no XML parser dependency needed
    const get = (tag) => {
        const m = xmlContent.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
        return m ? m[1].trim() : '';
    };

    const screen = get('screen').split('x').map(Number);
    const window = get('window').split('x').map(Number);
    const document = get('document').split('x').map(Number);
    const taskRaw = get('task');
    const url = get('url');

    // Extract query from URL: ?q=buy-something-here
    const queryMatch = url.match(/[?&]q=([^&]+)/);
    const query = queryMatch ? queryMatch[1].replace(/-/g, ' ') : '';

    return {
        screenWidth: screen[0] || 1280,
        screenHeight: screen[1] || 1024,
        windowWidth: window[0] || 1422,
        windowHeight: window[1] || 1137,
        documentWidth: document[0] || 1403,
        documentHeight: document[1] || 2642,
        task: taskRaw,
        query
    };
}

/**
 * Extract scroll offset timeline from mouse CSV.
 * Scroll events have event="scroll", xpos=0, ypos=cumulative scroll offset.
 *
 * @param {string} csvContent
 * @returns {Array<{absTimestamp: number, scrollY: number}>}
 */
function parseScrollTimeline(csvContent) {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) return [];

    const header = lines[0].split(',').map(h => h.trim());
    const colTs = header.indexOf('timestamp');
    const colY = header.indexOf('ypos');
    const colEvt = header.indexOf('event');

    const timeline = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols[colEvt]?.trim() !== 'scroll') continue;

        const ts = parseInt(cols[colTs]);
        const scrollY = parseFloat(cols[colY]);
        if (!isFinite(ts) || !isFinite(scrollY)) continue;

        timeline.push({ absTimestamp: ts, scrollY });
    }

    return timeline;
}

/**
 * Parse all mouse events from CSV into a dense timeline.
 *
 * @param {string} csvContent
 * @returns {Array<{absTimestamp: number, x: number, y: number, event: string, xpath: string}>}
 */
function parseMouseTimeline(csvContent) {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) return [];

    const header = lines[0].split(',').map(h => h.trim());
    const colTs = header.indexOf('timestamp');
    const colX = header.indexOf('xpos');
    const colY = header.indexOf('ypos');
    const colEvt = header.indexOf('event');
    const colXpath = header.indexOf('xpath');

    const events = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const event = cols[colEvt]?.trim();

        // Skip scroll events — those are in the scroll timeline
        // Keep: mousemove, click, mousedown, mouseup, mouseover, mouseout, load, pageshow
        if (event === 'scroll') continue;

        const ts = parseInt(cols[colTs]);
        const x = parseFloat(cols[colX]);
        const y = parseFloat(cols[colY]);
        if (!isFinite(ts)) continue;

        events.push({
            absTimestamp: ts,
            x: isFinite(x) ? x : 0,
            y: isFinite(y) ? y : 0,
            event: event || 'unknown',
            xpath: cols[colXpath]?.trim() || ''
        });
    }

    return events;
}

/**
 * Interpolate scroll offset at a given absolute timestamp.
 * Uses linear interpolation between the two nearest scroll events.
 *
 * @param {number} timestamp - Absolute timestamp (ms)
 * @param {Array<{absTimestamp: number, scrollY: number}>} scrollTimeline
 * @returns {number} Scroll Y offset in pixels
 */
function interpolateScrollY(timestamp, scrollTimeline) {
    if (scrollTimeline.length === 0) return 0;

    // Before first scroll event — page hasn't scrolled yet
    if (timestamp <= scrollTimeline[0].absTimestamp) return 0;

    // After last scroll event — hold final position
    if (timestamp >= scrollTimeline[scrollTimeline.length - 1].absTimestamp) {
        return scrollTimeline[scrollTimeline.length - 1].scrollY;
    }

    // Binary search for bracketing events
    let lo = 0, hi = scrollTimeline.length - 1;
    while (lo < hi - 1) {
        const mid = (lo + hi) >>> 1;
        if (scrollTimeline[mid].absTimestamp <= timestamp) {
            lo = mid;
        } else {
            hi = mid;
        }
    }

    const before = scrollTimeline[lo];
    const after = scrollTimeline[hi];
    const t = (timestamp - before.absTimestamp) / (after.absTimestamp - before.absTimestamp);
    return before.scrollY + (after.scrollY - before.scrollY) * t;
}

/**
 * Parse fixation CSV and convert from page-space to screen-space.
 *
 * @param {string} csvContent
 * @param {Array} scrollTimeline
 * @param {Object} meta - Trial metadata with viewport dimensions
 * @returns {{raw: Array, converted: Array}}
 */
function parseFixations(csvContent, scrollTimeline, meta) {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) return { raw: [], converted: [] };

    const header = lines[0].split(',').map(h => h.trim());
    const colTs = header.indexOf('timestamp');
    const colX = header.indexOf('FPOGX');
    const colY = header.indexOf('FPOGY');
    const colD = header.indexOf('FPOGD');

    if (colX === -1 || colY === -1 || colD === -1) {
        throw new Error(
            `AdSERP fixation CSV missing required columns. Found: [${header.join(', ')}]. ` +
            `Need: FPOGX, FPOGY, FPOGD.`
        );
    }

    const raw = [];
    const converted = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = line.split(',');
        const absTs = parseInt(cols[colTs]);
        const pageX = parseFloat(cols[colX]);
        const pageY = parseFloat(cols[colY]);
        const duration = parseFloat(cols[colD]); // already in ms for AdSERP

        if (!isFinite(absTs) || !isFinite(pageX) || !isFinite(pageY) ||
            !isFinite(duration) || duration <= 0) continue;

        // Skip fixations with obviously bad coordinates
        if (pageX < 0 || pageY < 0) continue;
        if (pageX > meta.documentWidth || pageY > meta.documentHeight) continue;

        raw.push({ absTimestamp: absTs, pageX, pageY, duration });

        // Convert page-space → screen-space using scroll offset at fixation time.
        // Gazepoint coordinates are in page-space (absolute document coordinates
        // that grow with scroll — Y values can exceed screen height).
        const scrollY = interpolateScrollY(absTs, scrollTimeline);
        const screenX = pageX; // No horizontal scroll in AdSERP
        const screenY = pageY - scrollY;

        converted.push({
            absTimestamp: absTs,
            x: screenX,
            y: screenY,
            duration
        });
    }

    return { raw, converted };
}

/**
 * Build ScanpathData fixation array from converted fixations.
 * Converts absolute timestamps to relative tStart/tEnd.
 *
 * @param {Array} convertedFixations
 * @param {number} timeOrigin - Earliest timestamp in the trial
 * @returns {Fixation[]}
 */
function buildFixations(convertedFixations, rawFixations, timeOrigin) {
    return convertedFixations.map((fix, i) => ({
        x: fix.x,
        y: fix.y,
        pageY: rawFixations[i] ? rawFixations[i].pageY : fix.y, // preserve page-space Y for tile capture
        tStart: fix.absTimestamp - timeOrigin,
        tEnd: (fix.absTimestamp - timeOrigin) + fix.duration
    }));
}

/**
 * Load all data files for an AdSERP trial from a data directory.
 * Convenience function for CLI usage (Node.js only).
 *
 * @param {string} dataDir - Path to AdSERP/data/ directory
 * @param {string} trialId - Trial ID (e.g. "p004-b1-t1")
 * @returns {ScanpathData}
 */
function loadTrial(dataDir, trialId) {
    const fs = require('fs');
    const path = require('path');

    const fixPath = path.join(dataDir, 'fixation-data', `${trialId}.csv`);
    const mousePath = path.join(dataDir, 'mouse-movement-data', `${trialId}.csv`);
    const metaPath = path.join(dataDir, 'trial-metadata', `${trialId}.xml`);
    const adPath = path.join(dataDir, 'ad-boundary-data', `${trialId}.json`);
    const serpPath = path.join(dataDir, 'serps', `${trialId}.html`);

    if (!fs.existsSync(fixPath)) throw new Error(`Fixation data not found: ${fixPath}`);
    if (!fs.existsSync(mousePath)) throw new Error(`Mouse data not found: ${mousePath}`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata not found: ${metaPath}`);

    const result = parse({
        fixationCsv: fs.readFileSync(fixPath, 'utf8'),
        mouseCsv: fs.readFileSync(mousePath, 'utf8'),
        metadataXml: fs.readFileSync(metaPath, 'utf8'),
        adBoundaryJson: fs.existsSync(adPath) ? fs.readFileSync(adPath, 'utf8') : null
    }, { trialId });

    // Attach SERP path for the CLI to use
    result.meta.serpHtmlPath = fs.existsSync(serpPath) ? serpPath : null;

    return result;
}

module.exports = { parse, loadTrial, parseMetadata, interpolateScrollY };
