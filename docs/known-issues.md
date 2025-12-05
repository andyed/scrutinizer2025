# Known Issues - Scrutinizer v1.0

## Popup Windows Don't Inherit Foveal Effect

**Status**: Known Issue - Deferred to v2.0  
**Severity**: Medium  
**Workaround**: Press ESC in popup window to manually toggle foveal mode

### Description

When opening links in new windows (target="_blank" or popup windows), the new window:
- ✅ Opens correctly in a new Scrutinizer window
- ✅ Receives settings (radius, blur, enabled state) from parent window
- ✅ Loads the URL correctly
- ❌ Does not automatically apply the foveal effect, even though `enabled: true` is received

### Root Cause

**Multi-process timing issue with `<webview>` tag architecture:**

1. Main process creates new BrowserWindow
2. Main process sends `settings:init-state` with `enabled: true`
3. Renderer receives state and stores in `pendingInitState`
4. Webview fires `dom-ready` event
5. Scrutinizer instance created
6. `toggleFoveal(true)` called with pending state
7. **Issue**: `scrutinizer.enable()` called but webview content not fully ready
8. Capture or processing fails silently
9. User sees un-foveated window

### Why Defer to v2.0?

The `<webview>` tag creates a separate process for each window, making state synchronization complex and timing-dependent. The **WebContentsView migration** (v2.0) will:

- Use same-process architecture for all windows
- Give main process direct control over all WebContentsViews
- Eliminate IPC timing issues
- Provide cleaner initialization flow
- Make multi-window state inheritance trivial

**Effort to fix now**: High (complex race condition handling, still fragile)  
**Effort after WebContentsView**: Low (direct state control)

See `docs/webcontentsview-migration.md` for full migration plan.

### Workaround for Users

**Option 1**: Press `ESC` in the popup window to manually toggle foveal mode

**Option 2**: Use the eye icon button in the toolbar

**Option 3**: Use the menu: View → Toggle Foveal Mode

### Related Files

- `main.js` - Creates new windows and sends init state
- `renderer/app.js` - Receives init state and applies settings
- `ROADMAP.md` - Popup Handling section
- `docs/webcontentsview-migration.md` - v2.0 architecture plan

---

## Other Known Issues

### Browser Features
- **Find in Page**: `Cmd+F` / `Ctrl+F` is currently not implemented. Users cannot search for text within the webview. (Note: Foveal toggle moved to `Cmd+Shift+F` to reserve `Cmd+F` for future find functionality.)
- **Downloads**: File downloads happen silently in the background (to the default OS downloads folder) with no UI feedback or progress indicators.
- **Complex Popups & Authentication**: OAuth flows (e.g., "Sign in with Google") that rely on specific window relationships or popup behavior may be broken, as `target="_blank"` links currently open in a new, detached Scrutinizer window.

### Visual Artifacts
- **Scroll Lag**: Rapid scrolling may cause a momentary desynchronization between the overlay canvas (visuals) and the underlying webview (interaction targets).
- **Cursor State**: The mouse cursor may not always correctly reflect the hover state (e.g., changing to a hand pointer) due to the overlay window intercepting events.

---

## 4. Resolved Issues (v1.2+)

### Fixed in v1.2
- **Native Select Dropdown Tracking**: Resolved misalignment issues with native HTML `<select>` dropdowns. The polling fallback system now correctly accounts for window offsets and zoom levels, ensuring the foveal bubble tracks the mouse accurately even when the OS intercepts events.
- **Peripheral Movie Artifacts**: ADDRESSED via **Pixel Saliency Map**. The new high-performance saliency system (running in a background Web Worker) now detects high-saliency content (like moving faces in video) and modulates the peripheral distortion to prevent distracting "breathing" artifacts.
- **Saliency Map Oscillation**: Fixed a conflict where the legacy structure-based saliency generation was fighting with the new pixel-based system. The application now uses the Saliency Worker exclusively.

