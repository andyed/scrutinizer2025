# Control Panel Overlay

> Status: Proposed
> Priority: v2.5
> Dependencies: Pipeline Preset menu restructure

## Problem

Pipeline controls are scattered across three levels of Electron menu hierarchy (Simulation > Behavior, Simulation > Peripheral, Simulation > Utility). To toggle chromatic pooling, change intensity, and switch modes requires navigating three separate submenus that close after each selection. There is no way to see which effects are active at a glance, no way to compare two parameter states, and no way to make rapid adjustments during a usability evaluation session.

The ComplexityHUD proves the architectural pattern works: a fixed-position overlay panel with interactivity toggling via `setIgnoreMouseEvents`, tabbed views, drag support. The control panel follows the same pattern, extended with two-way IPC sync.

## Audiences & Use Cases

### Designers (3-5 controls visible)

1. **Quick assessment** — Load a page, enable the simulation, adjust intensity between Reduced/Reference/Amplified, take a screenshot. Panel should not require learning what "DoG e2" or "cmf_a" means.
2. **Structure check** — Switch between Legacy and Wireframe (ARIA) to see if information hierarchy survives peripheral degradation.
3. **Mobile preview** — Select a device profile and immediately see how the simulation changes at phone-distance foveal radius.

### UX Researchers (10-15 controls visible)

1. **Selective effect isolation** — Disable chromatic pooling to test whether a color-dependent notification is still detectable. Toggle saccadic blindness to evaluate animation-based alerts.
2. **Preset comparison** — Switch between Legacy and FOVI Blur Only to compare how a UI performs under two different degradation models. The panel shows which preset is active and which parameters have been overridden.
3. **Capture workflow** — Collapse panel to zero visual footprint, take golden capture, restore panel. Keyboard shortcut for collapse/expand.

### Vision/HCI Researchers (30+ controls visible)

1. **Parameter tuning** — Type exact values for `rg_decay` (0.085), `cmf_a` (2.78), `dog_e2` (0.15) to match psychophysics data from a specific paper.
2. **Model comparison** — Switch between aesthetic modes (Legacy, FOVI Isotropic, Log-Polar MIP, Texture Synthesis) while keeping other parameters fixed. Diff view showing which parameters changed.
3. **Export/import** — Save current parameter set as JSON, share with collaborator, load their parameter set to reproduce their viewing conditions.

## Architecture

### Panel-Menu Sync

Bidirectional sync uses the existing IPC channels. No new channels are created — the panel emits the same messages the menus do.

**Menu -> Panel (main -> renderer):**
The panel listens to the same `sendToOverlays` IPC events that `overlay.js` already handles. When a menu item fires `sendToOverlays('menu:set-intensity', 0.6)`, the panel's intensity slider updates to 0.6. The panel registers listeners alongside the existing ones in overlay.js — not instead of them.

```
main process                    overlay.js                  control-panel.js
    |                               |                            |
    |--sendToOverlays('menu:set-intensity', 0.6)---------------->|
    |                               |--- scrutinizer.setIntensity(0.6)
    |                               |                            |--- slider.value = 0.6
```

**Panel -> Menu (renderer -> main):**
When the user drags a slider or clicks a toggle in the panel, it calls `ipcRenderer.send('panel:set-intensity', 0.6)`. Main process handles this identically to a menu click: updates the menu checkmark state and calls `sendToOverlays('menu:set-intensity', 0.6)`, which flows back to both overlay.js (to update the shader) and the panel (to confirm the value). This round-trip ensures menu and panel never disagree.

```
control-panel.js                main process                overlay.js
    |                               |                            |
    |---ipcRenderer.send('panel:set-intensity', 0.6)------------>|
    |                               |--- updateMenuCheckmarks()
    |                               |--- sendToOverlays('menu:set-intensity', 0.6)-->|
    |<--'menu:set-intensity'--------|                            |
    |   (confirmation)              |                            |
```

New IPC channels needed in `main.js`:
- `panel:set-intensity` — forwards to `sendToOverlays('menu:set-intensity', value)`
- `panel:set-radius` — forwards to `sendToOverlays('menu:set-radius', value)`
- `panel:set-aesthetic-mode` — forwards to `sendToOverlays('menu:set-aesthetic-mode', value)` + `app.emit('aesthetic-mode-changed', value)`
- `panel:toggle-*` — one per toggle, each forwards to corresponding `sendToOverlays('menu:toggle-*', value)`
- `panel:set-*` — one per numeric param, same pattern

All `panel:*` handlers follow the same template: validate value, update menu state, forward via `sendToOverlays`.

### Preset System

Presets are the modes defined in `shared/modes.json`. Selecting a preset applies all `pipeline` values from that mode's definition. The panel tracks overrides:

```javascript
{
    activePreset: 'highkey',           // Currently loaded preset key
    overrides: {                       // Parameters changed since preset load
        'rg_decay': 0.09,             // User increased from 0.085
        'chromatic_pooling': false     // User disabled
    }
}
```

**Override behavior:**
- Selecting a preset clears all overrides and applies the full `pipeline` object from modes.json.
- Changing any individual parameter after preset selection adds it to overrides.
- The panel shows a small indicator (dot or asterisk) next to overridden parameters.
- A "Reset to Preset" button clears overrides and re-applies the active preset.
- Overrides persist across panel collapse/expand but not across app restart (no serialization in Phase 1).

**Custom presets (Phase 2):**
- "Save as Preset" exports current state (preset + overrides merged) as a JSON file.
- "Load Preset" reads a JSON file and applies it. Custom presets are stored in `~/.scrutinizer/presets/`.

## Layout

### Collapsed State

A single pill-shaped element, 36x36px, positioned bottom-right (offset from ComplexityHUD which is bottom-left). Shows a gear icon. Click or `Cmd+K` to expand.

```
                                              [⚙]   <- 36x36, bottom-right, z-index 104
```

When collapsed, the panel consumes zero visual area beyond the pill. Golden captures and screenshots are unobstructed.

### Expanded State — Designer View

Default view when panel first opens. Three controls, compact layout.

```
┌─────────────────────────────────────┐
│ ⚙ Control Panel            [▾][✕] │  <- Title bar (drag handle), view toggle, close
├─────────────────────────────────────┤
│                                     │
│  Preset   [Legacy      ▾]   │  <- Dropdown: non-archived modes from modes.json
│                                     │
│  Intensity ○───────●────────○       │  <- 5-stop slider: Off/Reduced/Reference/Amplified/Max
│              0   0.3  0.6  0.8  1   │
│                                     │
│  Fovea Radius ○──●──────────○       │  <- Continuous slider: 20-450px, snaps to RADIUS_OPTIONS
│                20  45    180   450   │
│                                     │
│  [Show all controls]                │  <- Expands to Researcher View
└─────────────────────────────────────┘
```

Width: 260px. Position: fixed, bottom-right, 12px inset. Same visual style as ComplexityHUD (dark translucent background, monospace, 1px border).

### Expanded State — Researcher View

Scrollable panel, organized by pipeline stage. Parameters that don't exist in the active mode's `pipeline` definition are dimmed (present but non-functional).

```
┌─────────────────────────────────────┐
│ ⚙ Control Panel            [▴][✕] │
├─────────────────────────────────────┤
│                                     │
│  Preset  [Legacy      ▾]    │
│          [Reset] [Export] [Import]  │
│                                     │
│ ─── Foveal ──────────────────────  │
│  Radius      ○──●──────────○  45   │  <- Slider + editable number field
│  Shape       [●1:1 ○4:3 ○16:9]    │  <- Radio group
│  Intensity   ○───────●──────○ 0.6  │
│                                     │
│ ─── LGN ────────────────────────   │
│  Structure Map       [✓]          │  <- Toggle
│  Saliency Modulation [✓]          │
│  Ramp End Mult    [2.0    ]        │  <- Number input, step 0.1
│                                     │
│ ─── V1 (Spatial) ───────────────   │
│  DoG Bands           [✓]          │
│    e2             [0.15   ]        │  <- Number input, step 0.01
│    Sharpness      [0.0    ]        │
│    Oriented       [✓]             │
│    Orient Bias    [1.0    ]        │
│    Radial Bias    [0.0    ]        │
│  CMF                 [✓]          │
│    a              [2.78   ]        │  <- The Blauch parameter
│    Color Sigma    [0.0    ]        │
│    Ecc Scaling    [0.75   ]        │
│  Distortion Type  [Mongrel    ▾]  │  <- Dropdown: from v1_distortion_types
│                                     │
│ ─── V4 (Chromatic) ─────────────   │
│  Chromatic Pooling   [✓]          │
│    RG Decay       [0.085  ]        │
│    RG Freq Decay  [0.003  ]        │
│    YV Decay       [0.014  ]        │
│    YV Freq Decay  [0.008  ]        │
│  Chromatic Aberration [✓]         │
│  Supra Exponent   [0.5    ]        │
│                                     │
│ ─── Crowding ───────────────────   │
│  Congestion Pooling  [✓]          │
│    Density Thresh [0.3    ]        │
│    Steepness      [20.0   ]        │
│  Crowding Rings   [50     ]        │  <- num_cortical_rings, visible in FOVI mode
│                                     │
│ ─── Behavior ───────────────────   │
│  Visual Memory    [Off        ▾]   │  <- Dropdown: Off/5/10/Infinite/IoR
│  Saccadic Blindness  [✓]          │
│  Reading Span        [✓]          │
│    Strength       [1.0    ]        │
│                                     │
│ ─── Debug ──────────────────────   │
│  Eccentricity     [Off        ▾]   │
│  Congestion View  [Off        ▾]   │
│  Structure Map Viz   [ ]           │
│  Saliency Map Viz    [ ]           │
│  Sector Grid         [ ]           │
│  Orientation Diag [Off        ▾]   │
│                                     │
│ ─── Resolution ─────────────────   │
│  Saliency         [256 ▾]         │
│  Congestion       [512 ▾]         │
│                                     │
└─────────────────────────────────────┘
```

Max height: 70vh, scrollable. Panel sections are collapsible (click section header to collapse/expand). All sections start expanded on first open; collapsed state is remembered in-session.

## Controls Inventory

Each control maps to exactly one IPC channel. Type indicates the DOM control rendered.

| Parameter | IPC Channel | Type | Range/Options | Default | Designer View? |
|---|---|---|---|---|---|
| Preset | `menu:set-aesthetic-mode` | dropdown | modes.json keys (non-archived) | highkey | Yes |
| Intensity | `menu:set-intensity` | slider | 0.0, 0.3, 0.6, 0.8, 1.0 | 0.6 | Yes |
| Foveal Radius | `menu:set-radius` | slider | 20-450 (snaps to RADIUS_OPTIONS) | 45 | Yes |
| Foveal Shape | `menu:set-aspect` | radio | 1.0, 1.33, 1.78, 2.33 | 1.0 | No |
| Structure Map (enable) | `menu:toggle-enable-structure-map` | toggle | on/off | on | No |
| Saliency Modulation | `menu:toggle-saliency-modulation` | toggle | on/off | on | No |
| Chromatic Pooling | `menu:toggle-chromatic-pooling` | toggle | on/off | on | No |
| RG Decay | `menu:set-chromatic-pool-scale` | number | 0.01-0.2, step 0.001 | 0.085 | No |
| RG Freq Decay | (new) `menu:set-rg-freq-decay` | number | 0.001-0.05, step 0.001 | 0.003 | No |
| YV Decay | (new) `menu:set-yv-decay` | number | 0.005-0.1, step 0.001 | 0.014 | No |
| YV Freq Decay | (new) `menu:set-yv-freq-decay` | number | 0.001-0.05, step 0.001 | 0.008 | No |
| Supra Exponent | (new) `menu:set-supra-exponent` | number | 0.1-2.0, step 0.1 | 0.5 | No |
| Chromatic Aberration | `menu:toggle-ca` | toggle | on/off | on | No |
| DoG Bands (enable) | (new) `menu:toggle-dog-enabled` | toggle | on/off | on | No |
| DoG e2 | `menu:set-dog-e2` | number | 0.05-0.5, step 0.01 | 0.15 | No |
| DoG Oriented | `menu:toggle-dog-oriented` | toggle | on/off | on | No |
| DoG Orient Bias | `menu:set-dog-orient-bias` | number | 0.0-2.0, step 0.1 | 1.0 | No |
| DoG Radial Bias | (new) `menu:set-dog-radial-bias` | number | 0.0-1.0, step 0.1 | 0.0 | No |
| CMF (enable) | (new) `menu:toggle-cmf-enabled` | toggle | on/off | on | No |
| CMF a | (new) `menu:set-cmf-a` | number | 0.5-10.0, step 0.1 | 2.78 | No |
| CMF Color Sigma | (new) `menu:set-cmf-color-sigma` | number | 0.0-10.0, step 0.5 | 0.0 | No |
| Ecc Scaling | (new) `menu:set-ecc-scaling` | number | 0.1-2.0, step 0.05 | 0.75 | No |
| Distortion Type | (new) `menu:set-v1-distortion-type` | dropdown | v1_distortion_types from modes.json | 1 | No |
| LGN Ramp End Mult | (new) `menu:set-lgn-ramp-end` | number | 1.0-5.0, step 0.1 | 2.0 | No |
| Congestion Pooling | `menu:toggle-congestion-pooling` | toggle | on/off | on | No |
| Crowding Density Threshold | (new) `menu:set-crowding-threshold` | number | 0.0-1.0, step 0.05 | 0.3 | No |
| Crowding Density Steepness | (new) `menu:set-crowding-steepness` | number | 1.0-50.0, step 1.0 | 20.0 | No |
| Cortical Rings | (new) `menu:set-cortical-rings` | number | 10-100, step 5 | 50 | No |
| Visual Memory | `menu:set-visual-memory` | dropdown | Off(0)/5/10/Infinite(-1)/IoR(20) | 0 | No |
| Saccadic Blindness | `menu:toggle-saccadic-blindness` | toggle | on/off | on | No |
| Reading Span | `menu:toggle-reading-span` | toggle | on/off | off | No |
| Reading Span Strength | (new) `menu:set-reading-span-strength` | number | 0.0-2.0, step 0.1 | 1.0 | No |
| Sector Grid | `menu:toggle-sector-grid` | toggle | on/off | off | No |
| Eccentricity Overlay | `menu:set-debug-boundary` | dropdown | Off(0)/Fovea(1)/+Para(2)/+Periph(3) | 0 | No |
| Congestion View | `menu:set-show-congestion` | dropdown | Off(0)/Stats(1)/Heatmap(2)/SvC(3) | 0 | No |
| Structure Map Viz | `menu:toggle-structure-map` | toggle | on/off | off | No |
| Saliency Map Viz | `menu:toggle-saliency-map` | toggle | on/off | off | No |
| Orientation Diag | `menu:set-debug-level` | dropdown | Off(0)/Energy(4)/Weights(5) | 0 | No |
| Saliency Resolution | `menu:set-saliency-resolution` | dropdown | 256/512/1024 | 256 | No |
| Congestion Resolution | `menu:set-congestion-resolution` | dropdown | 256/512/1024/2048 | 512 | No |

Channels marked `(new)` do not exist yet — they need corresponding `ipcRenderer.on` handlers in overlay.js and `scrutinizer.set*()` methods.

## Interaction Patterns

**Keyboard:**
- `Cmd+K` — Toggle panel expand/collapse
- `Escape` — Collapse panel (when focused)
- `Tab` / `Shift+Tab` — Navigate between controls within the panel
- Number inputs accept typed values and commit on Enter or blur

**Mouse passthrough:**
Same pattern as ComplexityHUD. When cursor is outside the panel, `setIgnoreMouseEvents(true)` allows clicks to pass through to the browser content below. When cursor enters the panel, `setIgnoreMouseEvents(false)` enables interaction. The panel sends `ipcRenderer.send('hud:set-interactive', true/false)` on enter/leave, and main.js calls `win.scrutinizerHud.setIgnoreMouseEvents()` accordingly.

**Drag:**
Title bar is the drag handle, using the same 3px click-vs-drag disambiguation as ComplexityHUD. Position persists within session.

**Slider behavior:**
- Sliders with discrete stops (intensity, radius) snap to defined values on release but allow smooth dragging for preview.
- Slider changes emit IPC on release (mouseup), not on every mousemove, to avoid flooding the shader pipeline.
- Number inputs next to sliders are editable — typing a value and pressing Enter updates the slider position and emits IPC.

**Toggle behavior:**
- Toggles emit IPC immediately on click (no debounce needed — these are uniform updates, not shader recompilations).
- When a toggle is part of a group that a preset controls, overriding it shows the override indicator.

**Dropdown behavior:**
- Preset dropdown shows mode `label` from modes.json. Archived modes are excluded.
- If current aesthetic mode matches no non-archived preset, dropdown shows "Custom".

**Override indicator:**
A 4px colored dot (amber) appears to the left of any parameter that differs from the active preset's value. Clicking the dot resets that single parameter to the preset value.

## Implementation Plan

### Phase 1 (v2.5)

**Goal:** Designer View functional, synced with menu, collapsible.

1. **`renderer/control-panel.js`** — New module, same IIFE pattern as `complexity-hud.js`. Builds DOM programmatically (no external HTML template). Registers `ipcRenderer.on` listeners for all existing `menu:*` channels to read state. Emits `ipcRenderer.send('panel:*')` for writes.

2. **`main.js` additions** — Add `ipcMain.on('panel:*')` handlers that forward to `sendToOverlays('menu:*')`. Approximately 5 handlers for Phase 1 (intensity, radius, aspect, aesthetic-mode, toggle-foveal).

3. **`renderer/overlay.html`** — Add `<script src="control-panel.js"></script>` and a container div `<div id="control-panel"></div>`.

4. **`renderer/overlay.js`** — After `Scrutinizer` init, instantiate `ControlPanel('control-panel', { ipcRenderer })`. Pass current state so panel renders with correct initial values.

5. **Controls in Phase 1:** Preset dropdown, Intensity slider, Foveal Radius slider, collapse/expand, drag.

6. **Keyboard shortcut:** Register `Cmd+K` accelerator in menu-template.js, wire to `sendToOverlays('menu:toggle-control-panel')`.

**Estimated scope:** ~400 lines JS (panel), ~30 lines main.js IPC handlers.

### Phase 2 (v2.6)

**Goal:** Full Researcher View, preset export/import, new IPC channels for all parameters.

1. **New IPC channels** — Add the ~15 `(new)` channels from the Controls Inventory. Each requires:
   - `ipcMain.on('panel:set-*')` in main.js
   - `ipcRenderer.on('menu:set-*')` in overlay.js (calling the corresponding `scrutinizer.set*()`)
   - The `scrutinizer.set*()` method itself if it doesn't exist

2. **Section collapsibility** — Each pipeline section (LGN, V1, V4, Crowding, Behavior, Debug) collapses independently. State stored in a simple object, not persisted to disk.

3. **Override tracking** — Compare current values against `modes.json[activePreset].pipeline`. Render amber dots. "Reset to Preset" button.

4. **Export/Import** — "Export" serializes `{ preset: string, overrides: object, allValues: object }` as JSON. "Import" reads JSON file via Electron dialog, validates against known parameter names, applies.

5. **Parameter availability** — Dim controls for parameters not in the active mode's pipeline definition. E.g., `num_cortical_rings` only appears in FOVI Isotropic — it's dimmed (but still adjustable) in other modes.

**Estimated scope:** ~600 additional lines JS, ~60 lines main.js IPC handlers.

## Open Questions

1. **Panel position vs. ComplexityHUD** — Both are fixed-position overlays. ComplexityHUD is bottom-left. Control Panel is bottom-right. Should they be aware of each other's bounds to avoid overlap, or is independent positioning sufficient?

2. **State persistence across sessions** — Phase 1 does not persist panel state (position, collapsed sections, overrides) to disk. Should Phase 2 add a `~/.scrutinizer/panel-state.json`, or is session-only state acceptable for a research tool?

3. **URL-specific presets** — UX researchers may want different settings for different test pages. Should the preset system support URL pattern matching (e.g., "use Wireframe mode on *.gov sites"), or is manual switching sufficient?

4. **Multiple windows** — Scrutinizer supports multiple windows. Should each window have its own control panel with independent state, or should one panel control all windows? Currently the menu applies globally via `sendToOverlays` (which broadcasts to all overlay webContents).

5. **Performance budget** — The panel itself is pure DOM, no canvas. But rapid slider dragging could generate many IPC messages. Is throttling slider IPC to 60fps sufficient, or should we batch uniform updates within a single `requestAnimationFrame`?

6. **`Cmd+K` conflict** — This shortcut is used by VS Code and other tools. Acceptable for an Electron app that is not a text editor, but worth noting. Alternatives: `Cmd+Shift+K`, `Cmd+\`.
