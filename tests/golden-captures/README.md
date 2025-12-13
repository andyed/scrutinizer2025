# Golden Captures

Release-based screenshots for visual regression testing and documentation.

## Directory Structure

```
golden-captures/
├── v1.4.1/
│   ├── dashboard_mode0.png
│   ├── article_mode0.png
│   └── ecommerce_mode0.png
├── v1.5.0/
│   └── ...
└── latest -> v1.5.0/
```

## Capture Workflow

### Manual Capture

1. **Start app with reference page:**
   ```bash
   npm start -- "file://$(pwd)/tests/reference-pages/dashboard.html"
   ```

2. **Configure simulation:**
   - Enable foveal mode (Cmd+Shift+F)
   - Set to Mode 0 (High-Key Ghosting) via Simulation > Behavior > Aesthetic Mode

3. **Capture screenshot:**
   - Use Cmd+Shift+4 (macOS) or the system screenshot tool
   - Save to `tests/golden-captures/v{VERSION}/`

### Automated Capture

```bash
# Capture all reference pages for current version
npm run capture-golden
```

## Naming Convention

| Pattern | Description |
|---------|-------------|
| `{page}_mode0.png` | Default High-Key mode |
| `{page}_mode3.png` | Wireframe mode |
| `{page}_mode4.png` | Cyberpunk mode |
| `{page}_memory.png` | Visual Memory enabled |

## When to Update

| Release | Update? |
|---------|---------|
| Major (1.x.0) | ✅ Always - full capture |
| Minor (1.x.y) | ⚡ If shader/rendering changed |
| Patch | ❌ Rarely - only critical visual fixes |

## Reference Pages

Located in `tests/reference-pages/`:

- **dashboard.html** - Sidebar, toolbar, stats cards, data table
- **article.html** - Blog layout, hero image, comments
- **ecommerce.html** - Product grid, filters, cart

## Comparison

To compare releases, view images side-by-side or use an image diff tool:

```bash
# Quick visual diff (macOS)
open tests/golden-captures/v1.4.1/dashboard_mode0.png tests/golden-captures/v1.5.0/dashboard_mode0.png
```
