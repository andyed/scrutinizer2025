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

_(None currently - this is the only blocking issue for v1.0)_
