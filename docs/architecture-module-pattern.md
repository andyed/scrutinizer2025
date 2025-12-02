# Architecture: Module Loading & Scope

This document defines the module loading strategy for the Scrutinizer renderer process. **Strict adherence to this pattern is required** to avoid `ReferenceError` and scope issues.

## The Hybrid Pattern

Scrutinizer uses a hybrid approach because it runs in an Electron `BrowserWindow` with `nodeIntegration: true` but also relies on browser-style global access for some components.

### 1. CommonJS for Dependencies
We use standard CommonJS `require()` to load dependencies. This ensures synchronous loading and proper order execution.

**Correct:**
```javascript
const { ipcRenderer } = require('electron');
const Logger = require('./logger');
const WebGLRenderer = require('./webgl-renderer'); // Must be required!
```

**Incorrect:**
```javascript
// Do not assume global existence without require
// const renderer = new WebGLRenderer(); // Error!
```

### 2. Class Exposure (The "Dual Export")
Classes defined in separate files (like `WebGLRenderer.js`) must be exposed in **two ways** to satisfy both `require()` consumers and `<script>` tag consumers (like `overlay.html`).

**Pattern for Class Files:**
```javascript
class MyClass { ... }

// Export for CommonJS require()
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MyClass;
}
// ALWAYS expose to window for script tag loading
// This is NOT an else - both must happen in Electron!
window.MyClass = MyClass;
```

**Why not `else`?** In Electron with `nodeIntegration: true`, the `module` object exists even in renderer processes. If you use `else`, the class exports to `module.exports` but never to `window`. Files loaded via `<script src="...">` (like in `overlay.html`) check `window.MyClass`, not `module.exports`.

### 3. The Entry Point (`overlay.js`)
The main entry point (`overlay.js`) is loaded via `<script src="overlay.js">`. It does **not** export anything. Instead, it:
1. `require`s necessary classes (`Scrutinizer`, `CONFIG`).
2. Instantiates the main app logic.
3. Attaches the instance to `window` for debugging if needed.

### 4. Self-Executing Enclosures
To prevent polluting the global scope with internal variables, wrap file contents in an IIFE (Immediately Invoked Function Expression), but **keep the exports outside or explicitly attached**.

```javascript
(() => {
    const internalHelper = () => {};

    class PublicClass { ... }

    // EXPORT LOGIC MUST BE REACHABLE
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PublicClass;
    }
    // Always expose to window (no else!)
    window.PublicClass = PublicClass;
})();
```

## Critical Rules for AI
1. **ALWAYS check for `require`**: If you see a `ReferenceError: X is not defined`, 99% of the time it's because `const X = require('./X')` is missing at the top of the file.
2. **DO NOT remove `module.exports`**: Even if the file looks like a browser script, it is likely being `require`d by another file (e.g., `scrutinizer.js` requires `webgl-renderer.js`).
3. **DO NOT rely on `<script>` tag order**: We prefer explicit `require` dependencies over implicit global ordering.
