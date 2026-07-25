# evtrack (vendored)

Client-side user-interaction tracker by Luis Leiva. Vendored — not an npm
dependency — because we ship a modified copy with the server leg removed.

| | |
|---|---|
| Upstream | https://github.com/luileito/evtrack |
| Vendored commit | `cabb3b7ccfecee72a8970592642c86881a8fd437` (2022-07-31, "Added gh action to close inactive issues") |
| Files taken | `js/src/tracklib.js`, `js/src/trackui.js`, `license/mit.txt` → `LICENSE` |
| License | Upstream is dual MIT / LGPL. **We elect the MIT option** (`LICENSE` here is upstream `license/mit.txt` verbatim). |

## Why vendored

This is the same telemetry format AdSERP shipped, so existing analysis tooling
(approach-retreat, clicksense) ingests Scrutinizer study output unchanged. See
`docs/specs/session-capture-procedural-replay.md`.

## The network sink is removed

Upstream posts rows to a PHP endpoint (`save.php`) over XHR/`sendBeacon`.
Session capture is **local-only**: rows never leave the process. Everything
related to that transport is deleted:

- `tracklib.js`: the whole `TrackLib.XHR` namespace.
- `trackui.js`: `initNewData`, `setUserId`, `appendData`, `send`; the
  `postServer` / `postInterval` settings; the scheduled first POST in
  `record()`; the POST inside `flush()`; the `_uid` / `_info` module state and
  the `INFO_SEPARATOR` record separator.
- `save.php` itself, and the `js/*.min.js` / `json2` / `load.js` bootstrap
  scripts (loader for the remote script tag), were never taken.

In its place, `TrackUI.settings.sink` is a function invoked synchronously from
`fillInfo` for every recorded row, with `(row, domEvent)`:

```js
row = { cursorId, timestamp, xpos, ypos, event, xpath, attrs, extras }
```

Same columns, same order as the upstream wire row — but passed as structured
fields rather than a space-joined string, so xpath/attrs containing spaces
survive. `domEvent` is the originating DOM event, passed through so the sink can
apply privacy masking (key identity on editable targets) without re-deriving the
target. `flush()` now only detaches listeners.

## Other edits

Every deviation from upstream is marked with a `// SCRUTINIZER:` comment. Beyond
the sink removal there are only load-time adaptations:

- `tracklib.js` guards its `window.TrackLib` read with `typeof window` and adds
  a CommonJS export, so the vendor copy can be `require()`d headlessly (Jest).
- `trackui.js` resolves `TrackLib` via `require('./tracklib.js')` when it is not
  a browser global. Its upstream `window.TrackUI = TrackUI` export is unchanged
  and doubles as the CommonJS export (top-level `this` is `module.exports`
  under CJS, `window` under a classic `<script>`).

Nothing else is adapted here. Configuration, coordinate conversion, buffering,
privacy masking and the `ScanpathData` mapping all live in the adapter,
`renderer/instrumentation/event-capture.js`.

## How to load it

Inject into the tracked page as classic scripts, `tracklib.js` first:

```html
<script src=".../vendor/evtrack/tracklib.js"></script>
<script src=".../vendor/evtrack/trackui.js"></script>
```

The IIFE binds `window`/`document` when it runs. Under a CommonJS `require()`
those are the (empty) module exports object, so `TrackLib.Events.add` gets an
undefined target and silently attaches nothing. That load path exists for tests
and tooling only — **it cannot capture**. The adapter therefore prefers
`window.TrackUI` and only falls back to `require`.

## Upstream gotchas worth knowing

- `pollingMs` is a **throttle on delivered events**, not a timer: a polled event
  is recorded only if `pollingMs` has elapsed since the last recorded row of any
  kind. A burst of discrete events therefore pushes the next mousemove sample
  out by up to `pollingMs`.
- `record()` mutates `settings.regularEvents` / `settings.pollingEvents` from a
  string into an array, so a second `record()` on the same module instance would
  crash on `.split`. The adapter restores a pristine settings snapshot before
  each start.
- `xpos`/`ypos` are `pageX`/`pageY` (page space). For `scroll` rows they are
  replaced by the scroll offsets. The adapter converts to the client-viewport
  CSS px the spec requires.
- `TrackLib.XPath.getXPath` walks `parentNode` without a null guard and
  references the legacy `HTMLDocument` global; the adapter wraps it so a
  detached node cannot kill capture.
