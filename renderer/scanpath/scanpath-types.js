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
 * @typedef {Object} MouseTimelineEvent
 * @property {number} t - ms from recording start
 * @property {number} x - Screen-space pixel x
 * @property {number} y - Screen-space pixel y
 * @property {string} event - Event type (mousemove, click, mousedown, mouseup, etc.)
 * @property {string} [xpath] - XPath to DOM element
 */

/**
 * @typedef {Object} ScrollTimelineEvent
 * @property {number} t - ms from recording start
 * @property {number} scrollY - Cumulative vertical scroll offset in pixels
 */

/**
 * @typedef {Object} ScanpathMeta
 * @property {string} dataset - "ueyes"|"recgaze"|"mit1003"|"fixatons"|"onestop"|"coco-search18"|"adserp"
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
 * @property {MouseTimelineEvent[]} [mouseTimeline] - Dense mouse position + event stream
 * @property {ScrollTimelineEvent[]} [scrollTimeline] - Scroll offset keyframes
 */

module.exports = {};
