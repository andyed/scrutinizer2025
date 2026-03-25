/**
 * UEyes dataset importer.
 *
 * UEyes uses Gazepoint eye trackers exporting CSV with columns:
 *   FPOGX, FPOGY — normalized 0-1 fixation coordinates
 *   FPOGD — fixation duration in seconds (Gazepoint API v2.0)
 *
 * The dataset contains web/UI stimuli, making it the closest match
 * to Scrutinizer's target domain.
 *
 * @see https://github.com/ueyes-project
 */

const { normalizedToPixels } = require('../coordinate-utils');

/**
 * Parse UEyes Gazepoint CSV into ScanpathData array.
 *
 * Each participant+stimulus combination produces one ScanpathData object.
 * If the CSV contains multiple stimuli or participants, they are split
 * into separate entries.
 *
 * @param {string} csvContent - Raw CSV file content
 * @param {Object} options
 * @param {number} options.stimulusWidth - Stimulus width in pixels
 * @param {number} options.stimulusHeight - Stimulus height in pixels
 * @param {string} [options.participantId] - Override participant ID
 * @param {string} [options.stimulusId] - Override stimulus ID
 * @returns {ScanpathData[]}
 */
function parse(csvContent, options = {}) {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) return [];

    const header = lines[0].split(',').map(h => h.trim());
    const colX = header.indexOf('FPOGX');
    const colY = header.indexOf('FPOGY');
    const colD = header.indexOf('FPOGD');

    if (colX === -1 || colY === -1 || colD === -1) {
        throw new Error(
            `UEyes CSV missing required columns. Found: [${header.join(', ')}]. ` +
            `Need: FPOGX, FPOGY, FPOGD.`
        );
    }

    // Optional columns for multi-stimulus/participant files
    const colStim = header.indexOf('STIMULUS');
    const colPart = header.indexOf('PARTICIPANT');

    const stimWidth = options.stimulusWidth;
    const stimHeight = options.stimulusHeight;
    if (!stimWidth || !stimHeight) {
        throw new Error('UEyes importer requires stimulusWidth and stimulusHeight in options.');
    }

    // Group fixations by participant+stimulus
    const groups = new Map();

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = line.split(',');
        const nx = parseFloat(cols[colX]);
        const ny = parseFloat(cols[colY]);
        const durationRaw = parseFloat(cols[colD]);

        // FPOGD is in seconds (Gazepoint API v2.0) — convert to ms
        const duration = durationRaw * 1000;

        // Skip invalid rows
        if (!isFinite(nx) || !isFinite(ny) || !isFinite(duration) || duration <= 0) continue;
        // Skip out-of-range coordinates (blinks, tracking loss)
        if (nx < 0 || nx > 1 || ny < 0 || ny > 1) continue;

        const stimId = colStim !== -1 ? cols[colStim]?.trim() : (options.stimulusId || 'unknown');
        const partId = colPart !== -1 ? cols[colPart]?.trim() : (options.participantId || 'P0');
        const key = `${partId}::${stimId}`;

        if (!groups.has(key)) {
            groups.set(key, { participantId: partId, stimulusId: stimId, fixations: [] });
        }

        const { x, y } = normalizedToPixels(nx, ny, stimWidth, stimHeight);
        groups.get(key).fixations.push({ x, y, duration });
    }

    // Convert grouped fixations to ScanpathData with accumulated timing
    const results = [];
    for (const [, group] of groups) {
        let t = 0;
        const fixations = group.fixations.map(f => {
            const fix = {
                x: f.x,
                y: f.y,
                tStart: t,
                tEnd: t + f.duration
            };
            t += f.duration;
            // No explicit saccade gaps in UEyes — ScanpathPlayer will insert synthetic saccades
            return fix;
        });

        if (fixations.length === 0) continue;

        results.push({
            meta: {
                dataset: 'ueyes',
                participantId: group.participantId,
                stimulusId: group.stimulusId,
                stimulusWidth: stimWidth,
                stimulusHeight: stimHeight
            },
            fixations
        });
    }

    return results;
}

module.exports = { parse };
