Scrutinizer HUD Refactor: Browser + Toolbar/Canvas Window
Goal
Refactor the current WebContentsView-based overlay/toolbar into a separate HUD BrowserWindow, so that:

The main window behaves like a normal browser:
Native click, scroll, typing all work directly.
A second window (HUD) contains:
Floating toolbar (back/forward, URL bar, foveal toggle).
WebGL foveal canvas.
ESC (and a menu item) show/hide the HUD.
Visual behavior stays as close as possible to current foveal experience.
No more WebContentsView stacking for UI/canvas on top of content.

Current State (what to assume is implemented today)
Repo: scrutinizer2025.
Main Electron entry: 
main.js
.
Renderer assets: 
renderer/overlay.html
, 
renderer/overlay.js
, 
renderer/webgl-renderer.js
, 
renderer/scrutinizer.js
, 
renderer/config.js
.
WebGL-based foveal/peripheral effect is working and should be preserved.
Current architecture (to be replaced):
Single BrowserWindow with two WebContentsViews:
scrutinizerView: content (browser).
scrutinizerOverlay: overlay (toolbar + canvas), full-window, stacked above content.
Typing and scroll now work via IPC and sendInputEvent.
Toolbar menu item / ESC toggle the overlay toolbar DOM.
But link clicks in content do not work reliably due to overlay intercepting mouse events.
Target Architecture
1. Main Browser Window
Single BrowserWindow:
Contains and displays only the browser content.
Implementation detail (you can choose one, but document it):
Either:
Use <webview> in the main window HTML (v1-style), or
Keep using WebContentsView for content inside the window, but no overlay WebContentsView for UI.
Responsibilities:
Load target URL(s).
Emit capturePage() bitmaps on demand for HUD.
Send navigation state (URL, loading events) to HUD.
2. HUD Window (Toolbar + Canvas)
A separate BrowserWindow, created alongside each main browser window.
Properties:
transparent: true
frame: false
alwaysOnTop: true
same size/position as main window
likely focusable: false (so clicks generally go to main window), but we can adjust if needed.
Loads existing 
renderer/overlay.html
 and 
overlay.js
, with minimal changes.
Responsibilities:
Render the toolbar UI.
Render the WebGL canvas.
Request frame captures from main window.
Send navigation commands (back, forward, URL change) to main window.
Show/hide via ESC and menu.
No WebContentsView stacking; the two BrowserWindows are simply layered by the OS.

Behavior Requirements
Toolbar + HUD
ESC behavior:
When HUD is hidden and ESC is pressed (with focus in main window):
HUD window should appear (show).
When HUD is visible and ESC is pressed (regardless of whether HUD or main has focus):
HUD window should hide.
Menu:
View → Show Toolbar:
Toggles HUD visibility (show/hide).
Default:
HUD starts hidden on app launch.
Foveal effect
Toggling foveal effect:
Controlled via toolbar eye button and View → Toggle Foveal Mode (menu).
When enabled:
HUD requests frames from main window on a loop or via events.
HUD runs WebGL shader, displays foveal effect in its canvas.
When disabled:
HUD hides or clears the foveal canvas, but HUD window can stay visible/invisible based on ESC/menu.
Input semantics
All page interaction (click, scroll, type, select, context menu, etc.) should be handled natively by the main browser window.
HUD window:
Only processes input inside its toolbar region.
Canvas is purely visual; no click-through requirements (for this phase).
There is no requirement in this spec for the HUD canvas to be perfectly aligned visually with the underlying page; alignment is nice but secondary to click correctness.
IPC / Control Flow (desired high-level contracts)
Define and implement clear IPC channels between:

Main <-> HUD per window pair.
Suggested channels (you can rename, but keep roles):

From HUD (renderer/overlay.js) → Main (main.js)
hud:navigate:back
hud:navigate:forward
hud:navigate:to (with URL)
hud:capture:request (ask main to capturePage and send bitmap back)
hud:foveal:enabled / hud:foveal:disabled (optional: for state persistence)
hud:request:window-bounds (if HUD needs exact size)
From Main → HUD
hud:frame-captured (BGRA buffer + width/height)
hud:browser:did-start-loading
hud:browser:did-finish-load
hud:browser:did-navigate (URL)
hud:settings:init-state (radius, blur, enabled, showWelcome)
hud:settings:radius-options (RADIUS_OPTIONS)
ESC/menu toggling:

From main, when ESC/menu pressed:
Directly show/hide HUD window (no need for IPC if main controls HUD lifetime).
Optionally notify HUD renderer via hud:visibility:changed if needed.
Implementation Tasks
You can use these as a checklist in the new context:

Create HUD BrowserWindow
In 
createScrutinizerWindow
:
Create hudWindow with transparent: true, frame: false, alwaysOnTop: true, etc.
Load 
renderer/overlay.html
 into hudWindow.
Store references: win.scrutinizerHud = hudWindow.
Sync HUD position & size
On main window move / resize:
Update hudWindow.setBounds(...) to match.
Ensure HUD closes when main closes.
Move overlay logic from WebContentsView to HUD window
Remove/ignore current scrutinizerOverlay WebContentsView.
Point all overlay-related IPC (frame-captured, settings:init-state, menu:toggle-foveal, etc.) to hudWindow.webContents.
Wire ESC + menu to show/hide HUD
In main:
Keyboard handling or globalShortcut (if you already have content key forwarding via preload, you can use that).
Menu item View → Show Toolbar toggles hudWindow.show()/hide().
Ensure ESC pressed while HUD is visible hides it.
Keep content interaction native
Confirm that:
Clicking links works.
Scroll works.
Typing works.
No mouse forwarding from HUD is required for this phase.
Preserve WebGL behavior
Ensure HUD still receives frame bitmaps from main and runs 
WebGLRenderer
 as before.
Update docs
Update 
docs/webcontentsview-architecture-learnings.md
 to reflect:
Abandonment of WebContentsView overlay for click reasons.
Adoption of a two-BrowserWindow + HUD architecture.
Non-goals (for this refactor)
We do not need:
Perfect pixel alignment between HUD canvas and main content (nice-to-have).
HUD click-through over page area (no need for setIgnoreMouseEvents in this pass).
Fancy window docking/undocking.
Focus is: restore normal browser interaction while keeping the foveal HUD.