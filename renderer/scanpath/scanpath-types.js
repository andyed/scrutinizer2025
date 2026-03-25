/**
 * Scanpath data types — shared by all importers and the ScanpathPlayer.
 *
 * Coordinates are physical canvas pixels (positive-down), matching GazeModel.getPosition().
 * Times are ms from start of recording.
 */

/**
 * @typedef {Object} Fixation
 * @property {number} x - Physical canvas pixel x
 * @property {number} y - Physical canvas pixel y
 * @property {number} tStart - Start time (ms from recording start)
 * @property {number} tEnd - End time (ms from recording start)
 */

/**
 * @typedef {Object} ScanpathEvent
 * @property {"click"|"scroll"} type
 * @property {number} timestamp - ms from recording start
 * @property {*} data - Event-specific payload
 */

/**
 * @typedef {Object} ScanpathMeta
 * @property {string} dataset - "ueyes"|"recgaze"|"mit1003"|"fixatons"|"onestop"
 * @property {string} participantId
 * @property {string} stimulusId
 * @property {number} stimulusWidth - Original stimulus pixels
 * @property {number} stimulusHeight - Original stimulus pixels
 * @property {number} [viewingDistanceCm]
 * @property {number} [screenWidthCm]
 */

/**
 * @typedef {Object} ScanpathData
 * @property {ScanpathMeta} meta
 * @property {Fixation[]} fixations
 * @property {ScanpathEvent[]} [events]
 */

module.exports = {};
