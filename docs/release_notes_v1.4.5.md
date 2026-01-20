# Release Notes v1.4.5

**Release Date:** 2026-01-19

## Overview
This release focuses on **academic extensibility**, making Scrutinizer a better platform for researchers and PhD students to hack on. It introduces a declarative mode registry and citation-ready image exports.

## Key Changes

### 🖥️ User Interface
*   **Version in Help Menu:** The current version is now displayed in the Help menu's "Check for Updates" item (e.g., `Check for Updates... (v1.4.5)`).

### 🎓 Academic Hackability

#### Declarative Mode Registry (`shared/modes.json`)
Aesthetic modes are now defined in a centralized JSON registry instead of scattered across multiple files. Each mode entry includes:
- **Pipeline configuration** (LGN, V1, V4 parameters)
- **Architectural purpose** (what capability the mode stress-tests)
- **Citation metadata** (academic references and biological basis)
- **Test cases** (what the mode validates)

**Before:** Adding a mode required editing 3 files with magic numbers.
**After:** Define the mode in `modes.json`, add a menu item, implement V4 style.

See: `shared/modes.json` and the updated [Developer's Guide](developers_guide.md#adding-a-new-aesthetic-mode)

#### Citation-Ready Image Exports
All golden capture screenshots now include embedded PNG metadata for academic reproducibility:
- **Scrutinizer version**
- **Mode name and configuration**
- **Foveal radius and intensity**
- **Source URL**
- **Timestamp**
- **Citation string** (e.g., `Scrutinizer v1.4.5, Blueprint Mode (Captured 2026-01-19)`)

Metadata is embedded in PNG tEXt chunks and can be extracted with standard tools:
```bash
# View metadata (macOS/Linux)
exiftool screenshot.png | grep Scrutinizer

# Or use the built-in extractor
node -e "require('./renderer/citation-export').extractMetadata('screenshot.png').then(console.log)"
```

### 📁 New Files

| File | Purpose |
|------|---------|
| `shared/modes.json` | Declarative mode registry with pipeline configs |
| `renderer/citation-export.js` | PNG metadata embedding utility |
| `docs/tutorials/blueprint_case_study.md` | Comprehensive walkthrough of Blueprint mode |

### 📝 Documentation Updates

- **Developer's Guide:** Updated "Adding a New Aesthetic Mode" section with the new `modes.json` workflow
- **Blueprint Case Study:** New tutorial showing how modes work, with modification examples
- Added documentation for citation metadata in image exports

### ⚠️ Known Limitations (Documented)

**Shader Monolith:** The main shader (`peripheral.frag`) is ~1160 lines in a single file. This creates:
- Merge conflicts when multiple researchers experiment
- Cognitive overload finding the right function
- No hot-reloading (must restart app for GLSL changes)

Future work may split this into modular includes. See the [Blueprint Case Study](tutorials/blueprint_case_study.md#known-limitations) for details.

## Implementation Details

- `webgl-renderer.js` now loads mode configurations from `modes.json` with fallback to hardcoded defaults
- Golden capture tests automatically embed citation metadata via `citation-export.js`
- Uses `pngjs` (already a dependency) for PNG tEXt chunk manipulation

## Breaking Changes
None. The mode registry is backward-compatible with existing code.

## Migration Notes
No action required. Existing modes continue to work. New modes should be added via `modes.json` for better maintainability.
