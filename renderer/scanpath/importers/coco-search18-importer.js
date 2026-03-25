/**
 * COCO-Search18 dataset importer.
 *
 * Zelinsky et al. (CVPR 2020) — largest lab-quality goal-directed visual
 * search fixation dataset. 6,202 COCO images, 18 target categories, 10
 * subjects per category, ~300k fixations.
 *
 * Data format: JSON array of scanpath objects:
 *   {
 *     name: "000000400966.jpg",
 *     subject: 2,
 *     task: "microwave",
 *     condition: "present",
 *     bbox: [x, y, w, h],
 *     X: [245.5, 300.1, ...],     // fixation x-coords (pixels, 1680x1050)
 *     Y: [128.0, 200.3, ...],     // fixation y-coords (pixels, 1680x1050)
 *     T: [190, 63, 180, 543],     // fixation durations (ms)
 *     length: 4,
 *     fixOnTarget: true,
 *     correct: 1,
 *     split: "train"
 *   }
 *
 * Display resolution: 1680 x 1050 pixels.
 *
 * @see https://sites.google.com/view/cocosearch/home
 * @see Yang et al. "Predicting Goal-directed Human Attention Using
 *      Inverse Reinforcement Learning" CVPR 2020, arXiv:2005.14310
 */

const { stimulusToCanvas } = require('../coordinate-utils');

// Original display resolution used in the experiment
const DISPLAY_WIDTH = 1680;
const DISPLAY_HEIGHT = 1050;

/**
 * Parse COCO-Search18 JSON into ScanpathData array.
 *
 * @param {string|Array} jsonContent - Raw JSON string or pre-parsed array
 * @param {Object} [options]
 * @param {number} [options.canvasWidth] - Target canvas width for coordinate scaling
 * @param {number} [options.canvasHeight] - Target canvas height for coordinate scaling
 * @param {string} [options.task] - Filter to specific task category (e.g. "microwave")
 * @param {string} [options.condition] - Filter to "present" or "absent"
 * @param {boolean} [options.correctOnly=true] - Only include correct trials
 * @param {string} [options.stimulusId] - Filter to specific image filename
 * @param {number} [options.subject] - Filter to specific subject ID
 * @returns {ScanpathData[]}
 */
function parse(jsonContent, options = {}) {
    const data = typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent;

    if (!Array.isArray(data)) {
        throw new Error('COCO-Search18 data must be a JSON array of scanpath objects.');
    }

    const correctOnly = options.correctOnly !== false; // default true
    const results = [];

    for (const entry of data) {
        // Validate required fields
        if (!entry.X || !entry.Y || !entry.T) continue;
        if (entry.X.length === 0) continue;
        if (entry.X.length !== entry.Y.length) continue;

        // Apply filters
        if (correctOnly && !entry.correct) continue;
        if (options.task && entry.task !== options.task) continue;
        if (options.condition && entry.condition !== options.condition) continue;
        if (options.stimulusId && entry.name !== options.stimulusId) continue;
        if (options.subject !== undefined && entry.subject !== options.subject) continue;

        // Build fixation array with timing
        const fixations = [];
        let t = 0;

        for (let i = 0; i < entry.X.length; i++) {
            const x = entry.X[i];
            const y = entry.Y[i];
            // T array may be shorter than X/Y if final fixation duration missing
            const duration = i < entry.T.length ? entry.T[i] : 250; // fallback 250ms

            // Skip out-of-bounds fixations
            if (!isFinite(x) || !isFinite(y) || x < 0 || y < 0) continue;
            if (x > DISPLAY_WIDTH || y > DISPLAY_HEIGHT) continue;

            // Scale to canvas coordinates if canvas dimensions provided
            let fx = x, fy = y;
            if (options.canvasWidth && options.canvasHeight) {
                const scaled = stimulusToCanvas(
                    x, y, DISPLAY_WIDTH, DISPLAY_HEIGHT,
                    options.canvasWidth, options.canvasHeight
                );
                fx = scaled.x;
                fy = scaled.y;
            }

            fixations.push({
                x: fx,
                y: fy,
                tStart: t,
                tEnd: t + duration
            });
            t += duration;
            // No explicit saccade gaps — ScanpathPlayer inserts synthetic saccades
        }

        if (fixations.length === 0) continue;

        results.push({
            meta: {
                dataset: 'coco-search18',
                participantId: `S${entry.subject}`,
                stimulusId: entry.name,
                stimulusWidth: DISPLAY_WIDTH,
                stimulusHeight: DISPLAY_HEIGHT,
                task: entry.task,
                condition: entry.condition,
                fixOnTarget: entry.fixOnTarget,
                correct: entry.correct,
                bbox: entry.bbox,
                split: entry.split
            },
            fixations
        });
    }

    return results;
}

/**
 * Get summary statistics for a parsed dataset.
 * Useful for selecting interesting scanpaths for demo/replay.
 *
 * @param {ScanpathData[]} scanpaths
 * @returns {Object} Summary with task counts, mean fixations per scanpath, etc.
 */
function summarize(scanpaths) {
    const tasks = {};
    let totalFixations = 0;
    let totalDuration = 0;

    for (const sp of scanpaths) {
        const task = sp.meta.task || 'unknown';
        if (!tasks[task]) tasks[task] = { count: 0, fixations: 0 };
        tasks[task].count++;
        tasks[task].fixations += sp.fixations.length;
        totalFixations += sp.fixations.length;

        const lastFix = sp.fixations[sp.fixations.length - 1];
        totalDuration += lastFix.tEnd;
    }

    return {
        totalScanpaths: scanpaths.length,
        totalFixations,
        meanFixationsPerScanpath: totalFixations / scanpaths.length,
        meanDurationMs: totalDuration / scanpaths.length,
        tasks
    };
}

module.exports = { parse, summarize, DISPLAY_WIDTH, DISPLAY_HEIGHT };
