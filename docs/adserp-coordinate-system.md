# AdSERP Coordinate System Reference

Source: AdSERP README, convergence.py, find_interesting_trials.py, evtrack docs.

## Fixation Data (FPOGX, FPOGY)

- **Coordinate space**: Page-space pixels, relative to the top-left corner of the full-page screenshot
- **Screenshot viewport width**: 1280px (matches screen width)
- **Screenshot height**: Varies per SERP (document height)
- **X range**: 0-1280 (within screen width)
- **Y range**: 0 to document height (can greatly exceed screen height 1024)
- **Source**: Gazepoint GP3 HD eye tracker at 150Hz, fixation detection in firmware
- **Scroll relationship**: Y includes scroll offset (page-space). To get screen-space: `screen_y = FPOGY - scroll_offset`

## Mouse Data (xpos, ypos)

- **Coordinate space**: Page-space, window-sized (pageX/pageY from evtrack)
- **Window viewport**: 1422x1137 CSS pixels (larger than 1280x1024 screen due to ~111% Windows DPI scaling)
- **Source**: [evtrack](https://github.com/luileito/evtrack) library, captures `event.pageX/pageY`
- **Events**: mousemove, click, mousedown, mouseup, scroll, load, etc.
- **Scroll events**: `ypos` contains `window.scrollY` (cumulative offset, not delta)

## Converting Between Coordinate Systems

### Fixation page-space → screen-space
```
screen_x = FPOGX                    // X unaffected by vertical scroll
screen_y = FPOGY - scroll_offset    // subtract interpolated scroll
```

### Mouse window-space → screen-space (matching fixation coords)
```
rx = screen_width / window_width     // 1280/1422 ≈ 0.9
ry = screen_height / window_height   // 1024/1137 ≈ 0.9
screen_x = xpos * rx
screen_y = (ypos - scroll_offset) * ry   // page→viewport, then scale
```

### Comparing gaze vs mouse (as in convergence.py)
The paper's `convergence.py` applies rx/ry scaling to mouse coordinates.
The paper's `find_interesting_trials.py` compares raw (unscaled) coordinates.
Both subtract scroll from fixation Y.

## Trial Metadata

- `<screen>`: Physical display resolution (1280x1024)
- `<window>`: Browser window inner dimensions (1422x1137 CSS pixels)
- `<document>`: Full page document dimensions (varies, e.g. 1403x2642)

## Key Gotchas

1. Window > screen because of Windows DPI scaling (~111%)
2. Fixation coords are in 1280-wide space; mouse coords are in 1422-wide space
3. Both Y axes are page-space (include scroll offset)
4. Scroll events give cumulative position, not deltas
5. Mean gaze-mouse divergence ~500px mid-trial is NORMAL (not a bug)

## References

- AdSERP paper: https://doi.org/10.1145/3726302.3730325
- Zenodo dataset: https://zenodo.org/records/15236546
- evtrack: https://github.com/luileito/evtrack
