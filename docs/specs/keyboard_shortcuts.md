# Keyboard Shortcuts for Scrutinizer

> **Last updated:** 2026-03-09

## Motivation

Scrutinizer's Simulation menu has 30+ toggles and mode switches, but only 2 keyboard shortcuts (`Cmd+E` toggle effects, `Cmd+Shift+F` toggle foveal). The most-used visualization controls — congestion report, saliency map, structure map, eccentricity overlay — require 3-level menu navigation.

This matters for two reasons:

1. **Workflow speed.** Comparing congestion heatmap vs saliency map vs default requires six menu clicks per switch. During analysis you do this dozens of times per page.
2. **Automation.** The desktop-control MCP server can send `key_combo` but can't click Electron menus (the overlay is click-through). Keyboard shortcuts make every visualization mode scriptable — screenshot workflows, blog captures, batch comparisons.

## Design Constraints

- **Cmd+number** is taken by macOS (Spaces/Mission Control) on many setups
- **Cmd+Shift+number** conflicts with some apps but is generally safe in Electron
- **Ctrl+number** is available on macOS (not used by system)
- Keep mnemonics where possible (C for congestion, S for saliency, etc.)
- Group related shortcuts by modifier pattern

## Existing Shortcuts

| Shortcut | Action | Menu Location |
|----------|--------|---------------|
| `Cmd+E` | Toggle Effects On/Off | Simulation → Behavior |
| `Cmd+Shift+F` | Toggle Foveal Mode | Simulation → Foveal |
| `Cmd+R` | Refresh | Go |
| `Cmd+L` | Open URL | File |
| `Cmd+N` | New Window | File |
| `Cmd+Shift+H` | Home | Go |
| `Cmd+←/→` | Back/Forward | Go |

## Proposed Shortcuts

### Tier 1 — High-frequency visualization toggles

These are the controls you reach for constantly during analysis.

| Shortcut | Action | IPC Message |
|----------|--------|-------------|
| `Ctrl+Shift+S` | Toggle Saliency Map | `menu:toggle-saliency-map` |
| `Ctrl+Shift+D` | Toggle Structure Map (DOM) | `menu:toggle-structure-map` |
| `Ctrl+Shift+C` | Cycle Congestion Report (Off → Stats → Heatmap → Saliency vs Congestion → Off) | `menu:set-show-congestion` 0/1/2/3 |
| `Ctrl+Shift+B` | Cycle Eccentricity Overlay (Off → Fovea → +Para → +Periphery → Off) | `menu:set-debug-boundary` 0/1/2/3 |

Cycling (not toggling) keeps the shortcut count low. A single key walks through the modes. The ComplexityHUD or a brief toast should confirm the current state.

### Tier 2 — Behavior toggles

| Shortcut | Action | IPC Message |
|----------|--------|-------------|
| `Ctrl+K` | Toggle Chromatic Pooling | `menu:toggle-chromatic-pooling` |
| `Ctrl+M` | Toggle Saliency Modulation | `menu:toggle-saliency-modulation` |
| `Ctrl+A` | Toggle Saccadic Blindness | `menu:toggle-saccadic-blindness` |

### Tier 3 — Aesthetic mode quick-select

| Shortcut | Action | IPC Message |
|----------|--------|-------------|
| `Ctrl+0` | Control (Default Pipeline) | `menu:set-aesthetic-mode` 0 |
| `Ctrl+6` | Log-Polar MIP (Blauch 2026) | `menu:set-aesthetic-mode` 6 |
| `Ctrl+7` | Legacy v1.6 (Comparison) | `menu:set-aesthetic-mode` 7 |
| `Ctrl+9` | Congestion-Gated Pooling | `menu:set-aesthetic-mode` 9 |

Numbers match the internal mode IDs. Only the primary models get shortcuts — test modes (Purkinje, Frosted, Wireframe, Minecraft, Double Vision) stay menu-only.

### Tier 4 — Foveal radius presets

| Shortcut | Action | IPC Message |
|----------|--------|-------------|
| `Ctrl+[` | Decrease radius (step down) | `menu:set-radius` (next smaller) |
| `Ctrl+]` | Increase radius (step up) | `menu:set-radius` (next larger) |

Steps through: 20 → 45 → 90 → 180 → 300 → 450. Wraps at ends.

## Implementation

### 1. Add `accelerator` to existing menu items

For simple toggles (Tier 1–2), add `accelerator` property directly to the menu item in `menu-template.js`. Electron handles the global shortcut registration.

```javascript
{
    label: 'Show Saliency Map',
    type: 'checkbox',
    checked: false,
    accelerator: 'Ctrl+S',
    click: (menuItem) => sendToOverlays('menu:toggle-saliency-map', menuItem.checked)
}
```

### 2. Cycling shortcuts need state tracking

Congestion Report and Eccentricity Overlay are radio groups — no single menu item to attach a cycling accelerator to. Options:

**Option A: globalShortcut in main.js** (recommended)
```javascript
const { globalShortcut } = require('electron');

let congestionMode = 0;
globalShortcut.register('Ctrl+C', () => {
    congestionMode = (congestionMode + 1) % 4;
    sendToOverlays('menu:set-show-congestion', congestionMode);
    // Rebuild menu to sync radio state
    rebuildMenu();
});
```

**Option B: Hidden menu item with accelerator**
Add a non-visible menu item that cycles through states. Simpler but hackier.

Recommend Option A — it keeps the cycling logic explicit and the menu radio buttons stay in sync via rebuild.

### 3. Radius stepping

Track current radius index in main.js state (already tracks `radius`). Map to the preset array and step up/down.

```javascript
const RADIUS_PRESETS = [20, 45, 90, 180, 300, 450];
let radiusIndex = RADIUS_PRESETS.indexOf(radius) || 2; // default medium

globalShortcut.register('Ctrl+]', () => {
    radiusIndex = Math.min(radiusIndex + 1, RADIUS_PRESETS.length - 1);
    const r = RADIUS_PRESETS[radiusIndex];
    sendToOverlays('menu:set-radius', r);
    rebuildMenu();
});
```

### 4. Toast feedback

For cycling shortcuts, show a brief label in the overlay so the user knows the current state without checking the menu:

```
[Ctrl+C] Congestion: Heatmap
[Ctrl+B] Eccentricity: Fovea + Parafovea
```

Display for 1.5s, bottom-right of overlay, same style as existing ComplexityHUD.

## MCP Automation Example

With these shortcuts, a desktop-control session can drive Scrutinizer without menu access:

```javascript
// Navigate to target
await key_combo({ key: 'l', modifiers: ['cmd'] });  // Open URL bar
await type_text({ text: 'https://techmeme.com' });
await key_combo({ key: 'return' });

// Wait for page load, then:
await key_combo({ key: 's', modifiers: ['ctrl', 'shift'] });  // Show saliency map
await screenshot_window({ app_name: 'Scrutinizer', title_pattern: 'Overlay' });

await key_combo({ key: 'c', modifiers: ['ctrl', 'shift'] });  // Congestion: Stats
await key_combo({ key: 'c', modifiers: ['ctrl', 'shift'] });  // Congestion: Heatmap
await screenshot_window({ app_name: 'Scrutinizer', title_pattern: 'Overlay' });

await key_combo({ key: 'c', modifiers: ['ctrl', 'shift'] });  // Congestion: Saliency vs Congestion
await screenshot_window({ app_name: 'Scrutinizer', title_pattern: 'Overlay' });
```

## Rollout

1. Implement Tier 1 first (4 shortcuts) — covers the blog screenshot workflow
2. Add Tier 2–3 in the same PR
3. Tier 4 (radius stepping) can wait — less urgent
4. Toast feedback as a follow-up if the HUD doesn't already confirm state changes
