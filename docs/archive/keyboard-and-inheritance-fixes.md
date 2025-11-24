# Keyboard Shortcuts and Window Inheritance Fixes

## Issues Fixed

### 1. Keyboard Shortcuts Not Working ✅

**Problem:** ESC and arrow keys weren't responding when the webview had focus.

**Root Cause:** Keyboard events in the webview don't bubble up to the parent document. When users click inside the webview (which is almost always), keyboard events are captured by the webview's isolated process.

**Solution:**
- Added keyboard event forwarding in `preload.js` to send ESC, ArrowLeft, and ArrowRight events from webview to host
- Added `ipc-message` listener in `app.js` to handle forwarded keyboard events
- Extracted keyboard shortcut logic into `handleKeyboardShortcut()` function that works for both document and webview events
- Removed conditional guard for ESC key so it always calls `toggleFoveal()` (which has its own safety check)

**Files Changed:**
- `renderer/preload.js` - Added keydown event forwarding
- `renderer/app.js` - Added webview keyboard event listener and refactored keyboard handling

### 1b. ESC Key Not Working at Launch ✅

**Problem:** ESC key couldn't toggle foveal mode when app first starts (status: "Ready - Press ESC or click Enable to start").

**Root Cause:** Double-guarded condition - `handleKeyboardShortcut` checked `if (scrutinizer)` before calling `toggleFoveal()`, and `toggleFoveal()` also had its own guard. This prevented ESC from even attempting to toggle when scrutinizer was undefined.

**Solution:**
- Removed the `if (scrutinizer)` guard from ESC handler in `handleKeyboardShortcut()`
- Now ESC always calls `toggleFoveal()`, which gracefully handles the case when scrutinizer isn't ready yet
- This allows the call to go through and properly log warnings if scrutinizer isn't initialized

**Files Changed:**
- `renderer/app.js` - Removed conditional guard for ESC key

### 2. Popup Windows Not Inheriting Foveal State ✅

**Problem:** New popup windows weren't showing the blur effect even when the parent window had foveal mode enabled.

**Root Cause:** Temporal Dead Zone issue - `toggleFoveal` was defined with `const` after the webview `dom-ready` event handler that tried to call it. This caused a ReferenceError when trying to enable foveal mode on new windows.

**Solution:**
- Moved `toggleFoveal` function definition to BEFORE the webview event handlers
- Added safety check in `toggleFoveal` to ensure scrutinizer is initialized before toggling
- Moved `ipcRenderer` require to top of DOMContentLoaded handler for proper scoping
- Ensured `currentEnabled` has a default value of `false` in main.js

**Files Changed:**
- `renderer/app.js` - Reordered function definitions to fix temporal dead zone
- `main.js` - Added default value for currentEnabled setting

## New Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `ESC` | Toggle foveal mode on/off (or close welcome popup if visible) |
| `Right Arrow` (>) | Increase foveal radius (when foveal mode is active) |
| `Left Arrow` (<) | Decrease foveal radius (when foveal mode is active) |

**Note:** Up/Down arrows are left free for normal page scrolling.

## Technical Details

### Keyboard Event Flow

```
User presses ESC in webview
    ↓
preload.js captures keydown event (capture phase)
    ↓
preload.js sends ipc-message to host
    ↓
app.js receives via webview.addEventListener('ipc-message')
    ↓
handleKeyboardShortcut() processes the event
    ↓
toggleFoveal() or radius adjustment executed
```

### Window Inheritance Flow

```
User clicks link in webview with target="_blank"
    ↓
main.js createScrutinizerWindow(url) called
    ↓
main.js sends 'settings:init-state' with currentEnabled
    ↓
app.js receives init-state
    ↓
State stored in pendingInitState (if scrutinizer not ready)
    ↓
webview fires 'dom-ready'
    ↓
scrutinizer initialized
    ↓
toggleFoveal(true) called with pending state
    ↓
New window shows foveal effect ✅
```

## Testing Checklist

- [x] ESC key toggles foveal mode when focus is in webview
- [x] ESC key toggles foveal mode when focus is in toolbar
- [x] ESC key works at launch (before any page loads)
- [x] Left/Right arrows (<>) adjust foveal radius when mode is active
- [x] Left/Right arrow keys don't interfere with URL input field
- [x] Up/Down arrows are free for normal page scrolling
- [x] New popup windows inherit foveal enabled state
- [x] New popup windows inherit radius and blur settings
- [x] Welcome popup closes with ESC
- [x] No console errors on startup or window creation

## Benefits

1. **No browser conflicts** - Removed Space (scroll) and Wheel (zoom) handlers; Up/Down arrows free for scrolling
2. **Intuitive controls** - ESC for toggle, Left/Right (<>) arrows for size adjustment
3. **Works everywhere** - Keyboard shortcuts function regardless of focus location, even at launch
4. **Proper inheritance** - New windows accurately reflect parent window state
5. **Better UX** - Status text updated to reflect new shortcuts
