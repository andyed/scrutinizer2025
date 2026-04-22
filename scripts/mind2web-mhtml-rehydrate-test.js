#!/usr/bin/env node
/**
 * MHTML rehydration smoke test — Option 4 probe.
 *
 * Loads a Mind2Web raw-dump MHTML snapshot in a headless Electron window
 * sized to 1280x768 (matching Arm-0 viewport), waits for the page to settle,
 * captures a raw screenshot, and writes it to disk for visual comparison
 * against the Multimodal-Mind2Web authoritative screenshot.
 *
 * If the two visually match, MHTML is the rehydratable source we need for
 * live-DOM primitive classification (unblocks Arm-1 validation on Mind2Web).
 *
 * If they don't match, fall back to Option 1: Mind2Web = Arm-0 only.
 *
 * Usage:
 *   node scripts/mind2web-mhtml-rehydrate-test.js \\
 *     --mhtml tmp/mhtml-test/united-action1.mhtml \\
 *     --out tmp/mhtml-test/rehydrated.png \\
 *     [--reference tmp/action-v2-screenshot.png]
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function getArg(name, def = null) {
    const prefix = `--${name}=`;
    const hit = process.argv.find(a => a.startsWith(prefix));
    if (hit) return hit.slice(prefix.length);
    const idx = process.argv.indexOf(`--${name}`);
    if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
    return def;
}

const mhtmlPath = getArg('mhtml');
const outPath = getArg('out');
const referencePath = getArg('reference');

if (!mhtmlPath || !outPath) {
    console.error('--mhtml <file> --out <png> required');
    process.exit(2);
}

const absMhtml = path.resolve(mhtmlPath);
const absOut = path.resolve(outPath);
if (!fs.existsSync(absMhtml)) {
    console.error(`MHTML not found: ${absMhtml}`);
    process.exit(1);
}

const probeScript = `
const { app, BrowserWindow } = require('electron');
const fs = require('fs');

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 768,
    useContentSize: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, offscreen: false }
  });

  win.webContents.on('did-finish-load', () => console.log('[probe] did-finish-load'));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[probe] did-fail-load code=' + code + ' desc=' + desc + ' url=' + url);
  });

  try {
    await win.loadURL('file://' + ${JSON.stringify(absMhtml)});
  } catch (e) {
    console.error('[probe] loadURL error:', e.message);
    app.quit();
    return;
  }

  // Give the page ~5s to settle any CSS that depends on full doc load.
  await new Promise(r => setTimeout(r, 5000));

  const dims = win.getContentBounds();
  console.log('[probe] window content dims:', dims.width + 'x' + dims.height);

  const image = await win.webContents.capturePage();
  const buf = image.toPNG();
  fs.writeFileSync(${JSON.stringify(absOut)}, buf);
  const size = image.getSize();
  console.log('[probe] captured ' + size.width + 'x' + size.height + ' -> ${path.basename(absOut)}');

  app.quit();
}).catch(e => {
  console.error('[probe] fatal:', e);
  app.quit();
});
`;

const repoRoot = path.resolve(__dirname, '..');
const tmpProbe = path.join(repoRoot, 'tmp/mhtml-test/probe.js');
fs.mkdirSync(path.dirname(tmpProbe), { recursive: true });
fs.writeFileSync(tmpProbe, probeScript);

const electronBin = require('electron');
const child = spawn(electronBin, [tmpProbe], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    stdio: 'inherit',
});

child.on('exit', (code) => {
    try { fs.unlinkSync(tmpProbe); } catch {}
    if (code !== 0) {
        console.error(`\n[probe] Electron exited with code ${code}`);
        process.exit(code);
    }
    if (!fs.existsSync(absOut)) {
        console.error(`\n[probe] capture never wrote ${absOut}`);
        process.exit(1);
    }
    const sz = fs.statSync(absOut).size;
    console.log(`\n✓ rehydrated screenshot: ${outPath} (${(sz / 1024).toFixed(0)} KB)`);
    if (referencePath) {
        console.log(`  reference:              ${referencePath}`);
        console.log(`\nNext: open both in Preview side-by-side. You want:`);
        console.log(`  - matching layout (columns, widget positions, fonts)`);
        console.log(`  - matching colors (backgrounds, brand accents)`);
        console.log(`  - matching imagery (product photos, logos)`);
        console.log(`\nIf they match: MHTML is viable, Arm-1 validation unblocked.`);
        console.log(`If not:        Scope Mind2Web to Arm-0 only, move Arm-1 to another corpus.`);
    }
});
