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
- **Native Select Dropdown Tracking**: Native HTML `<select>` dropdowns (e.g., Amazon's department menu) may show peripheral distortion when open. This occurs because the OS renders these controls outside the browser's context and blocks mouse event reporting. The polling fallback system attempts to compensate using screen coordinates, but coordinate space misalignment causes inaccurate foveal positioning.
