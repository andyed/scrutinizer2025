# Architecture Analysis & Implementation Plan
**Date:** Nov 23, 2025  
**Status:** Fresh Analysis - Clean Slate Approach

## Executive Summary

You've successfully implemented GPU-accelerated peripheral vision simulation via WebGL. The remaining challenge is **event propagation** - allowing users to interact naturally with the browser content while the overlay canvas processes the visual effect.

The current approach uses 3-layer WebContentsView architecture that's causing event handling confusion. This document provides a fresh analysis and clear path forward.

---

## Current Architecture Assessment

### What's Working ✅

1. **WebGL Rendering Pipeline** (`webgl-renderer.js`)
   - GPU-accelerated fragment shader with domain warping
   - Simplex noise for peripheral texture simulation
   - Rod vision desaturation with proper luminance weights
   - Smooth 60fps rendering
   - **This is solid. Don't touch it.**

2. **Frame Capture** (via `capturePage()`)
   - Successfully captures content view bitmap
   - Sends via IPC to overlay view
   - 30fps capture rate (33ms interval)

### What's Broken ❌

1. **Event Propagation**
   - Overlay view (Layer 3) positioned at `y=50` (below toolbar)
   - Canvas uses CSS `top: -50px` to extend upward and cover toolbar
   - **Problem**: CSS positioning doesn't affect native event capture regions
   - Result: Clicks below toolbar hit overlay view first, even with `pointer-events: none`

2. **Architectural Confusion**
   - Three separate WebContentsView layers with complex z-ordering
   - CSS tricks (`pointer-events: none`, `background: transparent`) don't reliably control native Chromium event handling
   - View bounds vs CSS positioning mismatch

3. **Mouse Tracking**
   - Overlay view gets mouse events but they're in wrong coordinate space
   - Content view doesn't see mouse events when overlay is present
   - Toolbar can't reliably forward events to content

---

## Root Cause Analysis

### The Core Issue: Native vs DOM Event Handling

**WebContentsView operates at TWO levels:**

1. **Native Level (Chromium)**: View bounds, z-order, event capture regions
2. **DOM Level (inside each view)**: CSS, pointer-events, HTML

**CSS `pointer-events: none` only affects DOM events WITHIN that view.** It does NOT tell Electron's native layer to "pass events through to the view underneath."

### Current Layer Stack

```
┌─────────────────────────────────┐
│ Layer 3: Overlay View           │ ← Native bounds: y=50, h=850
│ (canvas with CSS top:-50px)     │ ← Event region: y=50 to y=900
│ pointer-events:none (CSS only!) │ ← Still captures at native level
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ Layer 2: Toolbar View           │ ← Native bounds: y=0, h=50
│ (navigation UI)                 │ ← Event region: y=0 to y=50
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ Layer 1: Content View           │ ← Native bounds: y=50, h=850
│ (actual browser)                │ ← UNREACHABLE - overlay blocks it
└─────────────────────────────────┘
```

**The problem:** Native event handling checks views from top to bottom. Overlay view is Layer 3 and covers y=50 to y=900, so it captures ALL mouse events in that region, regardless of CSS.

---

## Solution Options Analysis

### Option A: Remove Overlay View Entirely ⚠️

**Approach:** Put canvas in toolbar view, use CSS to extend it down.

```
┌─────────────────────────────────┐
│ Toolbar View (y=0, h=50)        │
│ - Navigation UI                 │
│ - Canvas with CSS height:100vh  │ ← Will be CLIPPED at h=50
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ Content View (y=50, h=850)      │ ← Events flow naturally
└─────────────────────────────────┘
```

**Why it won't work:** WebContentsView clips children to view bounds at the native rendering level. Canvas can't escape the 50px toolbar area.

### Option B: Overlay at y=0 with Native Input Passthrough ⭐ RECOMMENDED

**Approach:** Position overlay at y=0 (full window), make it truly transparent to input at the NATIVE level.

**Key insight:** Electron's BrowserWindow has `setIgnoreMouseEvents(true, {forward: true})`. But WebContentsView does NOT have this API.

**Workaround:** Use overlay.webContents methods to forward events manually.

```
┌─────────────────────────────────┐
│ Overlay View (y=0, h=900)       │ ← Full window coverage
│ - Canvas (renders effect)       │ ← CSS pointer-events:none
│ - Listens to mouse              │ ← For cursor position only
│ - Forwards clicks to content    │ ← Via IPC to main → content
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ Toolbar View (y=0, h=50)        │ ← z-order: Below overlay
│ (navigation UI)                 │ ← Events forwarded from overlay
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ Content View (y=50, h=850)      │ ← z-order: Below overlay
│ (actual browser)                │ ← Events forwarded from overlay
└─────────────────────────────────┘
```

**Implementation:**
1. Overlay captures ALL mouse events
2. Detects if mouse is over toolbar (y < 50) or content (y >= 50)
3. Uses `webContents.sendInputEvent()` to forward to appropriate view
4. Overlay tracks mouse position for shader uniforms
5. Overlay forwards keyboard events via same mechanism

**Pros:**
- Single source of truth for mouse position
- Clean event forwarding pipeline
- Overlay canvas covers full window naturally
- No CSS tricks or coordinate translation

**Cons:**
- Manual event forwarding adds complexity
- Slight latency on input (likely <1ms)
- Need to handle all input event types (click, scroll, drag, etc.)

### Option C: Revert to Hidden BrowserWindow (Offscreen Rendering) ⚠️

**Approach:** Go back to the architecture described in `pursuit-of-webgl.md` before WebContentsView.

```
┌─────────────────────────────────┐
│ Main BrowserWindow              │
│ - Toolbar (HTML)                │
│ - Canvas (HTML)                 │
│ - WebGL renderer                │
└─────────────────────────────────┘
          ↑ IPC
┌─────────────────────────────────┐
│ Hidden BrowserWindow            │
│ (offscreen: true)               │
│ - Emits paint events            │
│ - Receives forwarded input      │
└─────────────────────────────────┘
```

**Why NOT recommended NOW:**
- You already have WebContentsView working
- Frame capture via `capturePage()` works
- WebGL is rendering correctly
- Main issue is just event forwarding, which is solvable
- Reverting throws away current working parts

**When to consider:**
- If manual event forwarding proves too complex
- If you want better IPC performance (paint events are faster than capturePage)
- If you need the browser to be truly hidden (current content view is visible but blocked)

### Option D: Hybrid Approach - Transparent Main Window

**Approach:** Use Electron's transparent window feature with frameless window.

```
Main BrowserWindow (transparent: true, frame: false):
  - Custom toolbar (HTML)
  - Canvas overlay (HTML with pointer-events:none)
  - Embedded WebContentsView for content
```

**Pros:**
- Single window with full control
- Canvas is in main HTML, no clipping issues
- pointer-events:none works naturally in same document

**Cons:**
- Frameless window loses OS window controls
- Transparent window has rendering quirks on some platforms
- Would require significant restructuring

---

## Recommended Implementation Plan

### Phase 1: Fix Event Propagation (Option B)

**Goal:** Make overlay transparent to input while capturing mouse position.

#### Step 1.1: Modify Overlay View Setup

**File:** `main.js`

**Changes:**
1. Position overlay at `y=0` (full window) instead of `y=50`
2. Keep z-order as Layer 3 (on top)
3. Remove attempt to disable mouse via CSS (won't work)
4. Add event forwarding IPC handlers

```javascript
// Position overlay to cover ENTIRE window (including toolbar)
overlayView.setBounds({ x: 0, y: 0, width: width, height: height });
```

#### Step 1.2: Implement Event Capture in Overlay

**File:** `renderer/overlay.js`

**Changes:**
1. Listen to ALL mouse events (move, click, wheel, etc.)
2. Determine target (toolbar or content) based on coordinates
3. Forward events via IPC to main process
4. Use mouse position for shader uniforms

```javascript
// Capture mouse for shader
document.addEventListener('mousemove', (e) => {
  // Update shader uniform
  if (scrutinizer) {
    scrutinizer.handleMouseMove(e);
  }
  
  // Forward to appropriate view
  const targetView = e.clientY < 50 ? 'toolbar' : 'content';
  ipcRenderer.send('overlay:mouse-event', {
    type: 'mousemove',
    target: targetView,
    x: e.clientX,
    y: e.clientY - (targetView === 'content' ? 50 : 0) // Adjust for content offset
  });
});

// Same for click, wheel, etc.
```

#### Step 1.3: Implement Event Injection in Main Process

**File:** `main.js`

**Changes:**
1. Add IPC handler for overlay events
2. Use `webContents.sendInputEvent()` to inject into target view
3. Handle coordinate translation

```javascript
ipcMain.on('overlay:mouse-event', (event, data) => {
  const win = BrowserWindow.getAllWindows().find(w => 
    w.scrutinizerOverlay && w.scrutinizerOverlay.webContents === event.sender
  );
  
  if (!win) return;
  
  const targetView = data.target === 'toolbar' ? win.scrutinizerToolbar : win.scrutinizerView;
  
  if (targetView && targetView.webContents) {
    targetView.webContents.sendInputEvent({
      type: data.type,
      x: data.x,
      y: data.y
    });
  }
});
```

#### Step 1.4: Update Canvas Positioning

**File:** `renderer/overlay.html`

**Changes:**
1. Remove CSS hack `top: -50px`
2. Canvas now naturally covers full window

```css
#overlay-canvas {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none; /* For DOM events within this view */
  display: none;
}
```

### Phase 2: Test & Iterate

**Test cases:**
1. Can you click links in the content area?
2. Can you click toolbar buttons?
3. Does mouse position update smoothly in shader?
4. Can you scroll the page?
5. Can you drag text selections?
6. Do keyboard inputs work?

### Phase 3: Optimize (If Needed)

**Potential optimizations:**
1. Batch input events to reduce IPC overhead
2. Use `requestIdleCallback` for non-critical events
3. Consider selective event forwarding (only when needed)
4. Profile input latency with Chrome DevTools

---

## Alternative: Simpler Architecture (If Event Forwarding Fails)

If manual event forwarding proves too complex or has too much latency, fall back to:

### "Conditional Overlay" Pattern

**Concept:** Only show overlay when effect is enabled. When disabled, completely remove overlay view.

```javascript
// When enabling effect
win.contentView.addChildView(overlayView);
overlayView.setBounds({...});

// When disabling effect
win.contentView.removeChildView(overlayView);
```

**Pros:**
- Zero event interference when disabled
- Simpler mental model

**Cons:**
- Can't capture frames when disabled (but you don't need to)
- View add/remove might cause flicker
- Need to handle state carefully

---

## Testing Strategy

### Smoke Tests
1. ✅ WebGL renders correctly (already working)
2. ✅ Frame capture works (already working)
3. ⚠️ Can click content links
4. ⚠️ Can click toolbar buttons
5. ⚠️ Mouse position tracks correctly in shader
6. ⚠️ Scrolling works
7. ⚠️ Text selection works
8. ⚠️ Keyboard shortcuts work

### Edge Cases
- What happens when overlay is disabled? (canvas hides, events should flow naturally)
- What happens during window resize?
- What happens when switching between windows?
- What about drag-and-drop?
- What about context menus (right-click)?

---

## Key Technical Constraints

### Must Preserve
1. **WebGL shader** - This is your core innovation, don't change it
2. **Frame capture mechanism** - `capturePage()` is working, keep it
3. **Settings persistence** - Radius, blur, enabled state

### Can Change
1. **View layout** - Reposition overlay to y=0
2. **Event handling** - Add manual forwarding
3. **IPC structure** - Add new channels for events

### Should Avoid
1. **Offscreen rendering rewrite** - You have a working capture pipeline
2. **Complete architecture rewrite** - Fix the specific event issue, don't rebuild everything
3. **CSS hacks** - They don't work at native level

---

## Decision Matrix

| Approach | Complexity | Performance | Maintainability | Recommended |
|----------|-----------|-------------|----------------|-------------|
| Event Forwarding (Option B) | Medium | High | Medium | ⭐ **YES** |
| Remove Overlay (Option A) | Low | High | High | ❌ Won't work (clipping) |
| Hidden BrowserWindow (Option C) | High | Medium | Medium | ⚠️ Fallback only |
| Transparent Window (Option D) | High | Medium | Low | ❌ Over-engineered |
| Conditional Overlay | Low | High | Medium | ✅ Backup plan |

---

## Next Steps

1. **Implement Option B (Event Forwarding)**
   - Start with mouse events only
   - Test with simple clicks
   - Expand to scroll, keyboard, etc.

2. **If Option B works:**
   - Polish event handling
   - Add comprehensive input support
   - Optimize for latency

3. **If Option B fails:**
   - Try Conditional Overlay pattern
   - Or consider Hidden BrowserWindow revert

4. **Document learnings:**
   - Update architecture docs
   - Note what worked and what didn't

---

## Questions to Answer During Implementation

1. **Does `webContents.sendInputEvent()` work on WebContentsView?**
   - Test with simple click injection
   - Check Electron docs for WebContentsView specifics

2. **What's the input latency?**
   - Measure with `console.time()` between capture and injection
   - Is <1ms achievable?

3. **What input events need forwarding?**
   - mousemove, click, mousedown, mouseup
   - wheel (for scrolling)
   - keydown, keyup, keypress
   - drag events?
   - touch events (for trackpad gestures)?

4. **How to handle focus?**
   - When overlay captures events, which view has focus?
   - Can content view maintain focus?

---

## Conclusion

The peripheral vision simulation is **working beautifully**. The only remaining issue is **event propagation**, which is a known challenge with layered WebContentsView architecture.

**Recommended path forward:**
1. Implement manual event forwarding (Option B)
2. Position overlay at y=0 (full window)
3. Forward events based on hit testing
4. Test thoroughly

This is a **well-scoped problem** with a **clear solution path**. The architecture doesn't need to be scrapped - it just needs proper event plumbing.

**Estimated implementation time:** 2-4 hours for basic event forwarding, 4-8 hours for comprehensive input handling.

Let's build it. 🚀
