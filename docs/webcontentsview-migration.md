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
const { BrowserWindow, WebContentsView } = require('electron');

function createScrutinizerWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'renderer', 'host-preload.js')
    }
  });

  // Create web view
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'webview-preload.js'),
      offscreen: true // Enable offscreen rendering
    }
  });

  win.contentView.addChildView(view);
  
  // Position view (account for toolbar)
  view.setBounds({ x: 0, y: 60, width: 1200, height: 840 });
  
  // Load UI chrome
  win.loadFile('renderer/index.html');
  
  // Load web content
  view.webContents.loadURL('https://example.com');
  
  return { win, view };
}
```

3. **Offscreen rendering setup:**
```javascript
// In main.js
view.webContents.on('paint', (event, dirty, image) => {
  // image is NativeImage - can convert to buffer
  const buffer = image.toBitmap();
  
  // Send to renderer for processing
  win.webContents.send('frame-captured', {
    buffer: buffer,
    size: image.getSize()
  });
});

// Start rendering
view.webContents.setFrameRate(60);
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

### Phase 3: Testing & Optimization (1-2 weeks)

**Test matrix:**
- [ ] Basic navigation works
- [ ] Mouse tracking accurate
- [ ] Scroll detection works
- [ ] Popup windows work
- [ ] Performance benchmarks
- [ ] Memory usage comparison
- [ ] Multi-window support
- [ ] DevTools integration

**Performance targets:**
- Frame capture: < 10ms (vs current ~30ms)
- Mouse latency: < 16ms (60fps)
- Memory usage: Similar or better

### Phase 4: Migration & Release (1 week)

1. Merge feature branch
2. Update documentation
3. Beta test with users
4. Release as v2.0

## Risks & Mitigations

### Risk 1: Breaking Changes
**Mitigation:** Keep v1.x branch maintained for 6 months

### Risk 2: Performance Regression
**Mitigation:** Benchmark before/after, rollback if worse

### Risk 3: Platform Differences
**Mitigation:** Test on multiple macOS versions (10.15+)

### Risk 4: User Disruption
**Mitigation:** Auto-update with rollback capability

## Timeline

**Total: 6-8 weeks**

- Week 1-2: Research & prototyping
- Week 3-5: Implementation
- Week 6-7: Testing & optimization
- Week 8: Release prep & deployment

**Recommended start:** After v1.0 stable release + 1 month of user feedback

## Alternative: Hybrid Approach

Keep `<webview>` but optimize capture:

1. Reduce capture frequency (30fps instead of 60fps)
2. Use smaller capture regions
3. Implement frame skipping during rapid movement

**Pros:** Less risky, faster to implement
**Cons:** Still limited by webview architecture

## Decision Point

**Recommend:** Ship v1.0 with current architecture, plan v2.0 migration after:
- User feedback on v1.0
- Performance profiling on real-world usage
- Electron API stability assessment

## References

- [WebContentsView API](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [Offscreen Rendering](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering)
- [Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
