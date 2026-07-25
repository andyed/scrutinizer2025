/*! evtrack -- UI module */
(function(window) {
    var document = window.document;

    // SCRUTINIZER: upstream relied on TrackLib being a browser global set by a
    // sibling <script> tag. Resolve it for CommonJS loads too, so the capture
    // adapter and its unit tests can require() the vendor copy.
    var TrackLib = (window && window.TrackLib) ||
        (typeof require === 'function' ? require('./tracklib.js').TrackLib : null);

    // Define default events at the document level
    var _docEvents = 'mousedown mouseup mousemove mouseover mouseout mousewheel wheel';
    _docEvents += ' touchstart touchend touchmove deviceorientation keydown keyup keypress';
    _docEvents += ' click dblclick scroll change select submit reset contextmenu cut copy paste';
    // Define default events at the window level
    var _winEvents = 'load unload beforeunload blur focus resize error abort online offline';
    _winEvents += ' storage popstate hashchange pagehide pageshow message beforeprint afterprint';
    // Convert these event lists to actual array lists
    _docEvents = _docEvents.split(' ');
    _winEvents = _winEvents.split(' ');
    // Save a shortcut for "*" events
    var _allEvents = _docEvents.concat(_winEvents);

    // Arguments separator for the logged data
    var ARGS_SEPARATOR = ' ';
    // SCRUTINIZER: INFO_SEPARATOR ('|||', the record separator save.php expected)
    // is removed along with the server leg.

    // SCRUTINIZER: `_uid` (server-assigned user ID) and `_info` (the buffer the
    // XHR sink drained) are gone with the network leg. Rows are handed to
    // `settings.sink` synchronously; buffering is the adapter's job.
    // Tracking time, for pollingMs
    var _time = 0;

    /**
     * A small lib to track the user activity by listening to browser events.
     * Written in plain 'ol JavaScript. No dependencies. Also works in old browsers.
     * @namespace TrackUI
     * @author Luis Leiva
     * @version 0.3
     * @requires tracklib.js
     * @license Dual licensed under the MIT and GPL licenses.
     */
    var TrackUI = {
        /**
         * Default settings -- can be overridden on init.
         * @see README.md
         * @memberof TrackUI
         */
        settings: {
            // SCRUTINIZER: `postServer`/`postInterval` removed with the network
            // leg. `sink` is the local replacement: a function called with
            // (row, domEvent) for every recorded row, synchronously, in the
            // originating event handler.
            sink: null,
            // Events to be tracked whenever the browser fires them. Default:
            //      mouse-related: "mousedown mouseup mousemove mouseover mouseout mousewheel click dblclick"
            //      touch-related: "touchstart touchend touchmove"
            //   keyboard-related: "keydown keyup keypress"
            //     window-related: "load unload beforeunload blur focus resize error online offline"
            //             others: "scroll change select submit reset contextmenu cut copy paste"
            // If this property is empty, no events will be tracked.
            // Use space-separated values to indicate multiple events, e.g. "click mousemove touchmove".
            // The "*" wildcard can be used to specify all events.
            regularEvents: '*',
            // Events to be polled, because some events are not always needed (e.g. mousemove).
            // If this property is empty (default value), no events will be polled.
            // Use space-separated values to indicate multiple events, e.g. "mousemove touchmove".
            // The "*" wildcard can be used to specify all events.
            // Events in pollingEvents will override those specified in regularEvents.
            // You can leave regularEvents empty and use only pollingEvents, if need be.
            pollingEvents: '',
            // Sampling frequency (in ms) to register events.
            // If set to 0, every single event will be recorded.
            pollingMs: 150,
            // A name that identifies the current task.
            // Useful to filter logs by e.g. tracking campaign ID.
            taskName: 'evtrack',
            // A custom function to execute on each recording tick.
            callback: null,
            // Whether to dump element attributes together with each recorded event.
            saveAttributes: true,
            // Enable this to display some debug information
            debug: false,
        },
        /**
         * Init method.
         * @memberof TrackUI
         * @param {object} config - Tracking Settings
         * @see TrackUI.settings
         * @return {void}
         */
        record: function(config) {
            _time = new Date().getTime();
            // Override settings
            for (var prop in TrackUI.settings) {
                if (config.hasOwnProperty(prop) && config[prop] !== null) {
                    TrackUI.settings[prop] = config[prop];
                }
            }
            TrackUI.log('Recording starts...', _time, TrackUI.settings);
            TrackUI.addEventListeners();
            // SCRUTINIZER: upstream scheduled the first POST here. No sink to post to.
        },
        /**
         * Register event listeners.
         * @memberof TrackUI
         * @return {void}
         */
        addEventListeners: function() {
            if (TrackUI.settings.regularEvents == '*') {
                TrackUI.addCustomEventListeners(_allEvents);
            } else {
                TrackUI.log('Settings regular events...');
                TrackUI.settings.regularEvents = TrackUI.settings.regularEvents.split(' ');
                TrackUI.addCustomEventListeners(TrackUI.settings.regularEvents);
            }
            // All events in this set will override those defined in regularEvents
            if (TrackUI.settings.pollingEvents == '*') {
                TrackUI.addCustomEventListeners(_allEvents);
            } else {
                TrackUI.log('Settings polling events...');
                TrackUI.settings.pollingEvents = TrackUI.settings.pollingEvents.split(' ');
                TrackUI.addCustomEventListeners(TrackUI.settings.pollingEvents);
            }
            // Flush data on closing the window/tab
            TrackLib.Events.add(window, 'beforeunload', TrackUI.flush);
            TrackLib.Events.add(window, 'unload', TrackUI.flush);
        },
        /**
         * Register custom event listeners.
         * @memberof TrackUI
         * @param {array} eventList - List of DOM events (strings)
         * @return {void}
         */
        addCustomEventListeners: function(eventList) {
            TrackUI.log('Adding event listeners:', eventList);
            for (var i = 0; i < eventList.length; ++i) {
                var ev = eventList[i];
                if (!ev) continue;
                if (_docEvents.indexOf(ev) > -1) {
                    TrackLib.Events.add(document, ev, TrackUI.docHandler);
                    TrackUI.log('Adding document event:', ev);
                    // This is for IE compatibility, grrr
                    if (document.attachEvent) {
                        // See http://todepoint.com/blog/2008/02/18/windowonblur-strange-behavior-on-browsers/
                        if (ev == 'focus') TrackLib.Events.add(document.body, 'focusin', TrackUI.winHandler);
                        if (ev == 'blur') TrackLib.Events.add(document.body, 'focusout', TrackUI.winHandler);
                    }
                } else if (_winEvents.indexOf(ev) > -1) {
                    TrackLib.Events.add(window, ev, TrackUI.winHandler);
                    TrackUI.log('Adding window event:', ev);
                }
            }
        },
        // SCRUTINIZER: `initNewData`, `setUserId`, `appendData` and `send` (the
        // XHR/sendBeacon transport to save.php) are deleted. There is no server
        // leg: rows are delivered to `settings.sink` from `fillInfo` below.
        /**
         * Handle document events.
         * @memberof TrackUI
         * @param {object} e - DOM event
         * @return {void}
         */
        docHandler: function(e) {
            if (e.type.indexOf('touch') > -1) {
                TrackUI.touchHandler(e);
            } else {
                TrackUI.eventHandler(e);
            }
        },
        /**
         * Handle window events.
         * @memberof TrackUI
         * @param {object} e - DOM event
         * @return {void}
         */
        winHandler: function(e) {
            TrackUI.eventHandler(e);
        },
        /**
         * Generic callback for event listeners.
         * @memberof TrackUI
         * @param {object} e - DOM event
         * @return {void}
         */
        eventHandler: function(e) {
            e = TrackLib.Events.fix(e);

            if ('isTrusted' in e && !e.isTrusted) return;

            var timeNow = new Date().getTime();
            var eventName = e.type;
            var register = true;
            if (TrackUI.settings.pollingMs > 0 && TrackUI.settings.pollingEvents.indexOf(eventName) > -1) {
                register = (timeNow - _time >= TrackUI.settings.pollingMs);
            }

            if (register) {
                var cursorPos = TrackUI.getMousePos(e);
                var elemXpath = TrackLib.XPath.getXPath(e.target);
                var elemAttrs = TrackUI.settings.saveAttributes ? TrackLib.Util.serializeAttrs(e.target) : '{}';
                var extraInfo = '{}';
                if (typeof TrackUI.settings.callback === 'function') {
                    extraInfo = JSON.stringify(TrackUI.settings.callback(e));
                }
                if (eventName == 'scroll') {
                    cursorPos = TrackLib.Dimension.getScrollingPosition();
                }
                // SCRUTINIZER: the originating DOM event is passed through as a
                // trailing argument so the local sink can apply privacy masking
                // (key identity on editable targets) without re-deriving it.
                TrackUI.fillInfo(e.id, timeNow, cursorPos.x, cursorPos.y, eventName, elemXpath, elemAttrs, extraInfo, e);
                _time = timeNow;
            }
        },
        /**
         * Callback for touch event listeners.
         * @memberof TrackUI
         * @param {object} e - DOM event
         * @return {void}
         */
        touchHandler: function(e) {
            e = TrackLib.Events.fix(e);

            if ('isTrusted' in e && !e.isTrusted) return;

            var touches = e.changedTouches; // better
            if (touches) for (var i = 0, touch; i < touches.length; ++i) {
                touch = touches[i];
                touch.type = e.type;
                TrackUI.eventHandler(touch);
            }
        },
        /**
         * Cross-browser way to register the mouse position.
         * @memberof TrackUI
         * @param {object} e - DOM event
         * @return {Point} pos - Coordinates
         */
        getMousePos: function(e) {
            e = TrackLib.Events.fix(e);

            var cx = 0;
            var cy = 0;
            if (e.pageX || e.pageY) {
                cx = e.pageX;
                cy = e.pageY;
            } else if (e.clientX || e.clientY) {
                cx = e.clientX + document.body.scrollLeft + document.documentElement.scrollLeft;
                cy = e.clientY + document.body.scrollTop + document.documentElement.scrollTop;
            }
            // Sometimes the mouse coordinates are negative (e.g., in Opera)
            if (!cx || cx < 0) cx = 0;
            if (!cy || cy < 0) cy = 0;
            /**
             * @typedef {object} Point
             * @property {number} x - The X coordinate
             * @property {number} y - The Y coordinate
             */
            return {x: cx, y: cy};
        },
        /**
         * Fill in a log data row.
         * @memberof TrackUI
         * @param {...mixed} args - Any number of arguments
         * @return {void}
         */
        fillInfo: function(args) {
            var args = [].slice.apply(arguments);
            // SCRUTINIZER: upstream joined the row with ARGS_SEPARATOR and pushed
            // it onto `_info` for the XHR sink. The row is handed to the local
            // sink as structured fields instead (same columns, same order), so
            // xpath/attrs containing spaces survive round-tripping.
            var domEvent = args.length > 8 ? args[8] : null;
            if (typeof TrackUI.settings.sink === 'function') {
                TrackUI.settings.sink({
                    cursorId: args[0],
                    timestamp: args[1],
                    xpos: args[2],
                    ypos: args[3],
                    event: args[4],
                    xpath: args[5],
                    attrs: args[6],
                    extras: args[7],
                }, domEvent);
            }
            TrackUI.log(args.slice(0, 8).join(ARGS_SEPARATOR));
        },
        /**
         * Send remaining data (if any) to the backend server.
         * @memberof TrackUI
         * @param {object} e - DOM event
         * @return {void}
         */
        flush: function(e) {
            TrackUI.log('Flushing data...');
            var i;
            for (i = 0; i < _docEvents.length; ++i) {
                TrackLib.Events.remove(document, _docEvents[i], TrackUI.docHandler);
            }
            for (i = 0; i < _winEvents.length; ++i) {
                TrackLib.Events.remove(window, _winEvents[i], TrackUI.winHandler);
            }
            // SCRUTINIZER: upstream posted the tail of the buffer here. Detaching
            // the listeners is all that remains; the adapter already holds every
            // row it was handed.
        },
        /**
         * Show debug information in the JS console.
         * @memberof TrackUI
         * @param {...mixed} args - Any number of arguments
         * @return {void}
         */
        log: function(args) {
            if (TrackUI.settings.debug && typeof console.log === 'function') {
                console.log.apply(console, arguments);
            }
        },

    };

    // Expose
    window.TrackUI = TrackUI;
})(this);
