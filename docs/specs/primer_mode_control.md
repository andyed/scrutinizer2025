# Spec: Primer ↔ Scrutinizer Live Mode Control

## Problem

The primer explains peripheral vision by showing static screenshots of each pipeline stage. But the reader might be browsing the primer *through Scrutinizer itself*. The page should detect this and offer live mode switching — "see crowding applied to this page right now" instead of "here's a screenshot of crowding."

## Concept

1. **Detection:** The primer page detects it's running inside Scrutinizer's Electron shell (check for `window.scrutinizer` or a custom user-agent header or `navigator.userAgent` containing "Scrutinizer").

2. **Control API:** Scrutinizer exposes a lightweight page-level API via `window.scrutinizer` (injected by preload):
   ```js
   window.scrutinizer.setMode('highkey')       // by shortLabel
   window.scrutinizer.setRadius(90)
   window.scrutinizer.setIntensity(0.6)
   window.scrutinizer.getMode()                 // returns current shortLabel
   window.scrutinizer.isActive()                // true if enabled
   ```

3. **Primer integration:** Each section gets a "See it live" button that switches the active mode:
   - Biology section → High-Key (default research mode)
   - LGN section → shows saliency overlay
   - V1 Crowding → shows Crowding mode with displacement
   - V1 Minecraft → switches to Block Pooling (Minecraft) — pooling regions visible as blocks
   - DoG section → Log-Polar MIP (pure spatial frequency attenuation)
   - V4 section → switches between High-Key and Purkinje to show color processing difference
   - Full Mapping → Pyramid Mongrel (the default Tier 2.75)

4. **Graceful degradation:** When not in Scrutinizer, buttons don't appear. The static screenshots remain. No broken experience for web visitors.

## Implementation

### Scrutinizer side (preload.js)

Expose `window.scrutinizer` API that sends IPC messages to the renderer:

```js
// In preload.js or injected via webContents
contextBridge.exposeInMainWorld('scrutinizer', {
  setMode: (shortLabel) => ipcRenderer.send('page:set-mode', shortLabel),
  setRadius: (r) => ipcRenderer.send('page:set-radius', r),
  getMode: () => ipcRenderer.sendSync('page:get-mode'),
  isActive: () => true,
});
```

### Renderer side (scrutinizer.js)

Handle `page:set-mode` by looking up the mode by shortLabel in modes.json and calling `setAestheticMode()`.

### Primer side (index.html)

```js
// Detection
const inScrutinizer = typeof window.scrutinizer !== 'undefined';

// Show/hide "See it live" buttons
if (inScrutinizer) {
  document.querySelectorAll('.live-mode-btn').forEach(btn => {
    btn.style.display = 'inline-flex';
    btn.addEventListener('click', () => {
      window.scrutinizer.setMode(btn.dataset.mode);
    });
  });
}
```

Each section gets:
```html
<button class="live-mode-btn" data-mode="Minecraft" style="display:none;">
  See it live: Block Pooling →
</button>
```

## Security

- API is read/write for mode and radius only — no access to DOM, file system, or other Scrutinizer internals.
- Only works from pages loaded in the Scrutinizer content view (not arbitrary web pages injecting script).
- Mode names are validated against modes.json before applying.

## Open questions

- Should the mode auto-revert when scrolling past a section? (IntersectionObserver-triggered mode switching as you scroll through the primer)
- Should there be a "restore my settings" button that returns to the user's previous mode?
- Could this extend to the blog posts too? "See this effect live" buttons in each blog post.

## Files to modify

| File | Change |
|------|--------|
| `renderer/preload.js` | Expose `window.scrutinizer` API |
| `renderer/scrutinizer.js` | Handle `page:set-mode` IPC |
| `shared/modes.json` | Already has shortLabels — used for lookup |
| `scrutinizer-www/src/primer/index.html` | Add "See it live" buttons + detection script |
