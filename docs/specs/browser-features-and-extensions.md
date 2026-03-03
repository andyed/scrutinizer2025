# Spec: Chrome Extension Support & Browser Niceties

## Context

Scrutinizer is a research tool, not a general-purpose browser — but users spend long sessions browsing with it. Without extension support, they can't bring ad blockers, password managers, or readability tools. Without basic browser niceties (find-in-page, downloads, bookmarks), every session has friction that a normal browser wouldn't.

[electron-browser-shell](https://github.com/samuelmaddock/electron-browser-shell) demonstrates what's possible but is GPL-3.0 — we can't use its code. Electron's built-in `session.extensions` API (since v12) provides the foundation we need. This spec documents what to build, what not to build, and the known limitations.

---

## Current Architecture (relevant parts)

- **Electron 30.5.1** (Chromium 124)
- **Main window**: Single BrowserWindow with 2 WebContentsView children (toolbar 40px + content view)
- **HUD overlay**: Separate transparent frameless BrowserWindow, click-through, renders WebGL foveal simulation
- **Content view**: `contextIsolation: true`, `nodeIntegration: false`, preload.js for DOM scanning + mouse tracking
- **Session**: `session.defaultSession` — no custom partitions
- **Frame capture**: `contentView.webContents.capturePage()` → bitmap → HUD → WebGL texture
- **Settings**: `settings-manager.js` → `app.getPath('userData')/settings.json`

Key files:
| File | Role |
|------|------|
| `main.js` (73KB) | Window creation, IPC, lifecycle |
| `menu-template.js` | Application menu |
| `renderer/toolbar.html/js/css` | URL bar, nav buttons, fovea toggle |
| `renderer/preload.js` | DOM scanning, mouse/keyboard forwarding |
| `settings-manager.js` | JSON persistence |

---

## P0: Extension Loading & Content Scripts

### Extension storage

```
app.getPath('userData')/extensions/    ← unpacked extension directories
settings.json → extensions: [{ path, enabled, id, name }]
```

### Loading at startup

`session.defaultSession.extensions.loadExtension(path)` must be called every launch — Electron does not persist loaded extensions. The `settings.json` array is our persistence layer. Load in `app.whenReady()` after `createWindow()`.

### Menu

New `Browser` menu between `Go` and `Simulation`:

```
Browser > Extensions > Load Extension...          (folder picker)
Browser > Extensions > ─────────────────
Browser > Extensions > [Extension Name] ✓         (checkbox per ext)
Browser > Extensions > ─────────────────
Browser > Extensions > Remove All Extensions
```

### Content script compatibility

Content scripts run in an isolated world, separate from both the page and preload.js. The existing content view config (`contextIsolation: true`, `nodeIntegration: false`) is exactly what extensions expect. No changes to preload.js needed.

Coexistence is safe:
- Preload's MutationObserver + extension's DOM modifications: preload already debounces at 300ms
- Mouse capture (preload uses capture phase, extensions typically use bubble): no conflict
- Extension-injected DOM (1Password popups, Grammarly underlines): picked up by frame capture → appears in WebGL simulation. Correct behavior.

### Manifest version support

| Feature | MV2 (Electron 30) | MV3 (Electron 30) |
|---------|-------------------|-------------------|
| Background pages | Supported | N/A |
| Service workers | N/A | Partial/broken — Electron can't inject into SW context |
| Content scripts | Supported | Supported |
| `chrome.storage.local` | Supported | Supported |
| `chrome.webRequest` | Supported | Supported |
| Popup (browser_action/action) | Needs custom window | Needs custom window |

**Recommendation**: Document MV2 as the supported path. MV3 is experimental.

### Frame capture impact

`capturePage()` captures the composited page including extension DOM modifications:
- Ad blocker removes ads → cleaner capture (good)
- Dark Reader inverts colors → saliency/congestion maps reflect the modified page (correct, but should be documented)
- Readability reformats → captured as-is (correct)

---

## P1: Extension Popups, Find in Page, Downloads

### Extension popup support

Extensions with `browser_action.default_popup` (MV2) or `action.default_popup` (MV3) need a way to render. Approach:

1. Add extension icon container to `toolbar.html` (after fovea toggle)
2. Icons come from the extension manifest's `default_icon`
3. Click → main process creates a small BrowserWindow anchored below the icon
4. Popup loads `chrome-extension://{id}/{popup.html}`
5. Close on blur (browser-like behavior)

### Find in Page (Cmd+F)

Use `webContents.findInPage(text, options)` on the content view. UI: a hidden find bar in the toolbar that slides in on Cmd+F. Listen for `found-in-page` event to show match count.

### Downloads

Hook `session.defaultSession.on('will-download', ...)` in `createWindow()`. Electron shows a native save dialog by default — minimal UI work. Add a download state indicator in the toolbar (optional P2).

---

## P2: Browser Niceties

### Bookmarks

Lightweight JSON store at `app.getPath('userData')/bookmarks.json`. Menu item "Bookmark This Page" (Cmd+D). Bookmarks submenu in Browser menu lists saved pages. Flat list — no folders, no hierarchy. Research tool, not Chrome.

### History dropdown

`webContents.navigationHistory` provides `getEntryAtIndex()` and `getActiveIndex()`. Add "Recent Pages" submenu to Go menu, or long-press behavior on the back button.

### Browser menu structure

```
Browser > Find in Page...         Cmd+F
Browser > ─────────────
Browser > Bookmarks >
Browser >   Bookmark This Page    Cmd+D
Browser >   ─────────────
Browser >   [bookmark 1]
Browser >   [bookmark 2]
Browser > ─────────────
Browser > Extensions >
Browser >   Load Extension...
Browser >   ─────────────
Browser >   [ext 1] ✓
Browser >   [ext 2] ✓
Browser >   ─────────────
Browser >   Remove All
Browser > ─────────────
Browser > Clear Browsing Data...
```

---

## What NOT to Build

| Feature | Reason |
|---------|--------|
| **Tabs** | Already has multi-window (Cmd+N). Tabs would require toolbar redesign and HUD context switching per tab. Complexity far exceeds benefit for a research tool. |
| **Web Store integration** | Electron can't load .crx files. Only unpacked directories. A store integration would mislead. |
| **Permission dialogs** | Camera, mic, geolocation — not relevant for visual perception research. |
| **Sync/profiles** | Single-user research tool. |
| **Password autofill** | Let users bring their own extension (1Password, Bitwarden). |
| **chrome.contextMenus** | Electron doesn't integrate extension context menu items into right-click. Would need custom implementation — low ROI. |

---

## Known Limitations (Electron API Gaps)

1. **Unpacked only** — no .crx loading. Users must download and extract extensions manually.
2. **No `chrome.browserAction.onClicked`** — we handle popup opening manually via toolbar icon clicks.
3. **No badge rendering** — `setBadgeText` sets text but we must render it ourselves in the toolbar.
4. **MV3 service workers** — broken/partial in Electron 30.
5. **`chrome.tabs` partial** — `query`, `update`, `create` have limited support. Tab-heavy extensions may malfunction.
6. **Single webRequest listener** — Electron limitation. If Scrutinizer itself needs webRequest in the future, it will conflict with extension webRequest listeners.
7. **No `chrome.storage.sync`** — only `chrome.storage.local` available.

---

## New Files

| File | Purpose |
|------|---------|
| `extension-manager.js` | Encapsulate extension load/unload/persistence (main.js is already 73KB) |
| `bookmark-manager.js` | JSON read/write for bookmarks |

## Files to Modify

| File | Changes |
|------|---------|
| `main.js` | Extension loading at startup, popup window creation, find-in-page IPC, download handler |
| `menu-template.js` | New "Browser" menu with Extensions, Bookmarks, Find in Page |
| `settings-manager.js` | Add `extensions` and `bookmarks` to defaults |
| `renderer/toolbar.html` | Extension icons container, find bar |
| `renderer/toolbar.js` | Extension icon rendering/clicks, find bar input |
| `renderer/toolbar.css` | Extension icon styles, find bar styles |
| `renderer/preload.js` | **No changes needed** |

---

## Implementation Sequence

1. **Phase 1 (P0)**: `extension-manager.js`, settings persistence, menu items, load at startup. Test with uBlock Origin (MV2) and Dark Reader.
2. **Phase 2 (P1)**: Toolbar extension icons, popup windows, find-in-page, downloads.
3. **Phase 3 (P2)**: Bookmarks, history dropdown, clear data dialog.

## Verification

- Load uBlock Origin (MV2 unpacked) → ads blocked on content pages → frame capture reflects ad-free page
- Load Dark Reader → page colors change → saliency map reflects new colors
- Cmd+F → find bar appears → matches highlighted in content view
- Click download link → native save dialog → file saved
- Restart app → extensions reload from settings.json
