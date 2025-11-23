# WebContentsView Migration Plan (v2.0)

## Why Migrate?

**Current (`<webview>` tag):**
- ❌ Separate process - IPC overhead for mouse tracking
- ❌ `capturePage()` is slow (~16-50ms per capture)
- ❌ Limited control over rendering pipeline
- ❌ **Multi-window state inheritance broken** - popup windows don't apply foveal effect despite receiving state
- ⚠️ Deprecated API (still works but not recommended)

**Future (WebContentsView):**
- ✅ Same process - direct memory access
- ✅ Offscreen rendering - faster pixel access
- ✅ Better integration with Electron's compositor
- ✅ **Cleaner multi-window state management** - all views controlled by main process
- ✅ Modern, actively maintained API

**Performance gain estimate:** 2-3x faster frame capture, smoother foveal tracking

**Multi-window fix:** Popup windows will correctly inherit and apply foveal state

## Migration Strategy

### Phase 1: Research & Prototyping (1-2 weeks)

**Goals:**
- Understand WebContentsView API
- Prototype offscreen rendering
- Benchmark capture performance

**Tasks:**
1. Create separate branch: `feature/webcontentsview`
2. Build minimal proof-of-concept
3. Test pixel capture methods:
   - `webContents.capturePage()` (baseline)
   - Offscreen rendering with `paint` event
   - Shared texture approach (if available)

**Success criteria:**
- Capture latency < 10ms
- No visual glitches
- Mouse tracking works smoothly

### Phase 2: Architecture Changes (2-3 weeks)

**Current architecture:**
```
BrowserWindow (main.js)
  └── index.html
      └── <webview> tag (isolated process)
          └── preload.js (IPC bridge)
```

**New architecture:**
```
BrowserWindow (main.js)
  └── index.html (UI chrome only)
  └── WebContentsView (embedded, same process)
      └── preload.js (context bridge)
```

**Key changes:**

1. **Remove webview tag from HTML:**
```html
<!-- OLD -->
<webview id="webview" src="..." preload="./preload.js"></webview>

<!-- NEW -->
<div id="webview-container"></div>
<!-- WebContentsView managed by main process -->
```

2. **Create WebContentsView in main.js:**
```javascript
const { app, BrowserWindow, WebContentsView } = require('electron');
const path = require('path');

// Disable hardware acceleration for CPU-based offscreen rendering (optional)
// This is faster for frame generation but slower than GPU shared texture mode
// app.disableHardwareAcceleration();

function createScrutinizerWindow(startUrl) {
  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'renderer', 'host-preload.js')
    }
  });

  // Create WebContentsView with offscreen rendering
  // Note: WebContentsView inherits from View, has view.webContents property
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'webview-preload.js'),
      // Offscreen rendering options:
      offscreen: true, // Enable offscreen rendering
      // useSharedTexture: false (default) - CPU bitmap, slower but easier to use
      // useSharedTexture: true - GPU texture, faster but requires native module
    }
  });

  // Add view as child of window's contentView
  win.contentView.addChildView(view);
  
  // Position view (account for toolbar height)
  // setBounds uses Rectangle {x, y, width, height}
  view.setBounds({ x: 0, y: 60, width: 1200, height: 840 });
  
  // Handle window resize to update view bounds
  win.on('resize', () => {
    const [width, height] = win.getSize();
    view.setBounds({ x: 0, y: 60, width: width, height: height - 60 });
  });
  
  // Load UI chrome in main window
  win.loadFile('renderer/index.html');
  
  // Load web content in view
  view.webContents.loadURL(startUrl || 'https://example.com');
  
  return { win, view };
}
```

3. **Offscreen rendering setup:**
```javascript
// In main.js
// Listen for 'paint' events from offscreen rendering
view.webContents.on('paint', (event, dirty, image) => {
  // 'dirty' is Rectangle: the area that changed
  // 'image' is NativeImage: the rendered frame
  
  // Option 1: Get raw bitmap buffer (BGRA format)
  const buffer = image.toBitmap(); // Returns Buffer
  const size = image.getSize(); // Returns {width, height}
  
  // Option 2: Get PNG for debugging
  // const png = image.toPNG();
  // fs.writeFileSync('debug.png', png);
  
  // Send to renderer for foveal processing
  win.webContents.send('frame-captured', {
    buffer: buffer,
    width: size.width,
    height: size.height,
    dirty: dirty // Optional: process only changed region
  });
});

// Set frame rate (1-240 fps, default: 60)
// Higher frame rates = smoother but more CPU/GPU usage
view.webContents.setFrameRate(60);

// Note: paint events only fire when content changes
// Static pages won't generate frames unnecessarily
```

4. **Update preload scripts:**

**host-preload.js** (for main window):
```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scrutinizer', {
  onFrameCaptured: (callback) => {
    ipcRenderer.on('frame-captured', (event, data) => callback(data));
  },
  sendMousePosition: (x, y) => {
    ipcRenderer.send('mouse-position', x, y);
  },
  navigate: (url) => {
    ipcRenderer.send('navigate', url);
  }
});
```

**webview-preload.js** (for embedded content):
```javascript
const { ipcRenderer } = require('electron');

// Track mouse in embedded content
window.addEventListener('mousemove', (e) => {
  ipcRenderer.send('webview-mouse', e.clientX, e.clientY);
});
```

5. **Update Scrutinizer class:**
```javascript
class Scrutinizer {
  constructor(config) {
    this.config = config;
    
    // Listen for frame captures
    window.scrutinizer.onFrameCaptured((data) => {
      this.processFrame(data);
    });
    
    // Send mouse position to main process
    window.addEventListener('mousemove', (e) => {
      window.scrutinizer.sendMousePosition(e.clientX, e.clientY);
    });
  }
  
  processFrame(data) {
    // Convert buffer to ImageData
    const imageData = new ImageData(
      new Uint8ClampedArray(data.buffer),
      data.size.width,
      data.size.height
    );
    
    // Process as before
    this.applyFovealEffect(imageData);
  }
}
```

### Phase 3: Offscreen Rendering Modes

**Three rendering modes available:**

#### Mode 1: CPU Shared Memory Bitmap (Default) ✅ RECOMMENDED

**Setup:**
```javascript
const view = new WebContentsView({
  webPreferences: {
    offscreen: true,
    // useSharedTexture: false (default)
  }
});
```

**Characteristics:**
- ✅ Easy to use - works with NativeImage API (`image.toBitmap()`, `image.toPNG()`)
- ✅ Supports GPU features (WebGL, 3D CSS)
- ✅ Max frame rate: 240 fps
- ⚠️ Moderate performance - GPU → CPU copy overhead
- ✅ **Best for Scrutinizer**: Simple integration with existing canvas pipeline

**Performance estimate:** ~10-15ms per frame capture

#### Mode 2: GPU Shared Texture (Advanced) 🚀

**Setup:**
```javascript
// Requires native node module for texture handling
const view = new WebContentsView({
  webPreferences: {
    offscreen: true,
    useSharedTexture: true
  }
});
```

**Characteristics:**
- 🚀 Fastest - direct GPU texture access
- ✅ No CPU-GPU copy overhead
- ⚠️ Requires native module to import shared texture
- ⚠️ More complex integration
- 🔵 **Future consideration**: If Mode 1 performance insufficient

**Performance estimate:** ~5-8ms per frame capture

See [Electron OSR README](https://github.com/electron/electron/blob/main/shell/browser/osr/README.md) for implementation details.

#### Mode 3: Software Output Device (CPU-only) 🐌

**Setup:**
```javascript
// Disable GPU acceleration at app startup
app.disableHardwareAcceleration();

const view = new WebContentsView({
  webPreferences: {
    offscreen: true
  }
});
```

**Characteristics:**
- ✅ Fast frame generation (no GPU involvement)
- ❌ No WebGL or 3D CSS support
- ⚠️ Lower visual quality
- ❌ **Not recommended for Scrutinizer**: Many modern websites use GPU features

**Performance estimate:** ~8-12ms per frame capture

### Phase 4: Multi-Window Support

**Benefits of WebContentsView for popups:**

```javascript
// Store all views in main process
const viewsMap = new Map(); // windowId -> view

function createScrutinizerWindow(startUrl, parentState = null) {
  const { win, view } = createScrutinizerWindow(startUrl);
  
  // Store reference
  viewsMap.set(win.id, view);
  
  // If parent state exists, apply immediately
  if (parentState) {
    // All views are in same process - no IPC timing issues!
    applyFovealState(view, parentState);
  }
  
  // Intercept new-window events
  view.webContents.setWindowOpenHandler(({ url }) => {
    // Create new window with inherited state
    const currentState = getFovealState(view);
    createScrutinizerWindow(url, currentState);
    return { action: 'deny' };
  });
  
  return { win, view };
}

function applyFovealState(view, state) {
  // Direct control - no race conditions!
  // Send state to renderer via view.webContents
  view.webContents.send('apply-foveal-state', state);
}
```

**Key advantages:**
- ✅ All WebContentsViews managed by main process
- ✅ No IPC timing issues between windows
- ✅ Direct state control and synchronization
- ✅ Popup windows inherit state reliably
- ✅ Can share processing resources between views

### Phase 6: Verify & Ship

1. Final integration test
2. Update documentation
3. Commit & tag as v2.0

## Implementation Sequence

**Approach:** Deep dive with strategic test points

### 1. Minimal Proof of Concept 🔬

**Goal:** Single window with offscreen rendering, no foveal effect yet

**Tasks:**
- Create branch `feature/webcontentsview`
- Strip down `main.js` - remove old `<webview>` code
- Implement `createScrutinizerWindow()` with WebContentsView
- Set up `paint` event handler → log frame data
- Load a simple page, verify frames captured

**Test Checkpoint:** ✋ Can you see frame capture logs? Does navigation work?

### 2. Frame Pipeline Integration 🎨

**Goal:** Get captured frames onto canvas overlay

**Tasks:**
- Modify `app.js` - remove webview DOM references
- Set up IPC receiver for `frame-captured` events
- Convert Buffer → ImageData
- Draw to overlay canvas (no processing yet)
- Verify mouse coordinates still work

**Test Checkpoint:** ✋ Can you see the raw page content on overlay canvas?

### 3. Foveal Effect Restoration 👁️

**Goal:** Apply blur and foveal mask to captured frames

**Tasks:**
- Wire up ImageProcessor to new frame pipeline
- Connect blur worker
- Implement foveal masking on offscreen-rendered frames
- Test toggle on/off

**Test Checkpoint:** ✋ Does foveal mode work? Can you toggle with ESC?

### 4. Multi-Window State Inheritance ⚡

**Goal:** Popup windows inherit and apply foveal state

**Tasks:**
- Implement `viewsMap` to track all views
- Add `setWindowOpenHandler` for popups
- Pass state to new windows
- Apply state immediately (no race condition!)

**Test Checkpoint:** ✋ Open popup - does it have foveal effect if parent did?

### 5. Performance & Polish 🚀

**Goal:** Optimize frame capture and rendering

**Tasks:**
- Adjust frame rate (start at 60fps, tune down if needed)
- Implement dirty region optimization (optional)
- Add window resize handler
- Verify keyboard shortcuts still work
- Test scroll tracking

**Test Checkpoint:** ✋ Smooth at 60fps? Memory usage reasonable?

### 6. Final Verification 🎯

**Smoke test checklist:**
- [ ] Single window: navigate, toggle foveal mode, adjust radius
- [ ] Popup windows: inherit foveal state correctly
- [ ] Keyboard shortcuts: ESC, Left/Right arrows
- [ ] Performance: < 100ms lag when toggling
- [ ] No console errors

## Testing Strategy

**Philosophy:** Go deep, test at logical breakpoints

**When to come up for air:**
1. After step 1 - verify capture pipeline works
2. After step 3 - verify foveal effect works
3. After step 4 - verify multi-window inheritance (the whole point!)
4. After step 5 - verify performance acceptable

**When to commit:**
- After step 1 (minimal POC)
- After step 3 (feature parity with v1.0)
- After step 4 (multi-window fixed!)
- After step 6 (v2.0 release)

**Fallback:** If stuck for >30 min on a step, commit what works and document the blocker

## Implementation Considerations

**Key Decision:** We're doing the full migration (clean break from `<webview>`)

**Why now:**
- Popup inheritance is broken in v1.0
- Performance gains are significant (2-3x)
- API is straightforward once you understand it
- Multi-window architecture much cleaner

**Implementation Notes:**

### API Changes Summary

**From `<webview>` tag to WebContentsView:**

| Feature | `<webview>` (v1.x) | WebContentsView (v2.0) |
|---------|-------------------|------------------------|
| **Creation** | HTML tag in renderer | JS object in main process |
| **Process** | Separate | Same as parent |
| **Frame capture** | `capturePage()` (~30ms) | `paint` event (~10ms) |
| **Mouse tracking** | IPC from preload | Direct event access |
| **Multi-window** | Complex IPC timing | Direct state control |
| **Memory** | Higher (separate process) | Lower (shared memory) |
| **API status** | ⚠️ Deprecated | ✅ Modern, maintained |

### Key Differences to Handle

1. **No HTML element**: WebContentsView is managed entirely in main process
   - Renderer receives frame data via IPC instead of manipulating DOM
   - Overlay canvas still lives in renderer

2. **Event model changes**:
   ```javascript
   // OLD (<webview> tag)
   webview.addEventListener('dom-ready', () => {...});
   webview.addEventListener('ipc-message', (e) => {...});
   
   // NEW (WebContentsView)
   view.webContents.on('dom-ready', () => {...});
   view.webContents.on('ipc-message', (e) => {...});
   ```

3. **Frame capture pipeline**:
   ```
   OLD: webview → capturePage() → NativeImage → toBitmap() → Canvas
   NEW: view → paint event → Buffer → IPC → Canvas
   ```

4. **Preload script injection**:
   ```javascript
   // OLD
   <webview preload="./preload.js"></webview>
   
   // NEW
   new WebContentsView({
     webPreferences: {
       preload: path.join(__dirname, 'renderer', 'preload.js')
     }
   })
   ```

### Performance Optimization Strategies

1. **Dirty region optimization**: Only process changed areas
   ```javascript
   view.webContents.on('paint', (event, dirty, image) => {
     // dirty is Rectangle {x, y, width, height}
     // Only update overlay for changed region
     if (scrutinizer.enabled) {
       scrutinizer.updateRegion(dirty, image);
     }
   });
   ```

2. **Adaptive frame rate**: Adjust based on activity
   ```javascript
   // High activity (scrolling, animations)
   view.webContents.setFrameRate(60);
   
   // Low activity (static page)
   view.webContents.setFrameRate(30);
   
   // Idle (no foveal mode)
   view.webContents.setFrameRate(10);
   ```

3. **Shared blur worker pool**: Reuse workers across windows
   ```javascript
   // Single worker pool for all views
   const blurWorkerPool = new WorkerPool(navigator.hardwareConcurrency);
   
   // All views share workers
   viewsMap.forEach(view => {
     view.assignWorkerPool(blurWorkerPool);
   });
   ```

## Potential Blockers & Quick Fixes

**Blocker 1: Paint events not firing**
- Check `offscreen: true` is set
- Verify content is actually changing (static pages don't paint)
- Try loading a simple animated page for testing

**Blocker 2: Buffer → ImageData conversion issues**
- BGRA format: might need to swap R/B channels
- Size mismatch: ensure width matches buffer stride
- Use `new ImageData(new Uint8ClampedArray(buffer), width, height)`

**Blocker 3: Mouse coordinates off**
- Account for toolbar height (60px)
- View bounds must match actual content area
- Mouse events from preload need offset adjustment

**Blocker 4: Performance worse than v1.0**
- Start with 30fps, not 60fps
- Check if blur worker is bottleneck
- Profile paint event frequency
- Consider dirty region optimization

## References

### Official Electron Documentation

- [WebContentsView API](https://www.electronjs.org/docs/latest/api/web-contents-view) - Main API reference
- [View API](https://www.electronjs.org/docs/latest/api/view) - Parent class for WebContentsView
- [WebContents API](https://www.electronjs.org/docs/latest/api/web-contents) - Accessed via `view.webContents`
- [Offscreen Rendering](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering) - Tutorial and modes
- [Offscreen Rendering README](https://github.com/electron/electron/blob/main/shell/browser/osr/README.md) - GPU shared texture details
- [Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation) - Security best practices

### Key APIs Used

- `new WebContentsView(options)` - Create view with offscreen rendering
- `view.webContents.on('paint', handler)` - Listen for rendered frames
- `view.setBounds(bounds)` - Position and size the view
- `view.webContents.setFrameRate(fps)` - Control rendering frequency
- `image.toBitmap()` - Convert NativeImage to Buffer (BGRA format)
- `image.getSize()` - Get frame dimensions {width, height}

### Performance Considerations

- Paint events only fire when content changes (efficient!)
- Max frame rate: 240 fps for CPU bitmap mode
- Offscreen windows are always frameless (no visible window chrome)
- Dirty region provided to optimize processing
