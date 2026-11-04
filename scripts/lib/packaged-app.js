/**
 * Packaged app — find what an end-to-end gate needs inside a built
 * Scrutinizer.app, so the gate can run the signed package instead of the
 * source tree (`npm run check:study -- --app=<bundle>`).
 *
 * Inside the package the app's pages load from Contents/Resources/app.asar,
 * so the file:// URLs a gate waits for are rooted there, not at the
 * checkout. Info.plist is read as XML, which is what electron-builder
 * writes; that keeps this module free of plutil and testable on any OS.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

function plistString(xml, key) {
    const m = String(xml).match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
    return m ? m[1] : null;
}

/**
 * Resolve a .app bundle to its executable, its app.asar and its version.
 * Throws with the missing piece named, so a gate can report it as a harness
 * error instead of timing out on an app that never started.
 */
function packagedApp(bundlePath) {
    if (typeof bundlePath !== 'string' || !bundlePath) {
        throw new Error('--app needs the path to a built Scrutinizer.app');
    }
    const bundle = path.resolve(bundlePath);
    const plist = path.join(bundle, 'Contents', 'Info.plist');
    if (!fs.existsSync(plist)) throw new Error(`not an app bundle (no Contents/Info.plist): ${bundle}`);
    const xml = fs.readFileSync(plist, 'utf8');
    const executable = plistString(xml, 'CFBundleExecutable');
    if (!executable) throw new Error(`Info.plist names no CFBundleExecutable (expected an XML plist): ${plist}`);
    const binary = path.join(bundle, 'Contents', 'MacOS', executable);
    if (!fs.existsSync(binary)) throw new Error(`app executable missing: ${binary}`);
    const appRoot = path.join(bundle, 'Contents', 'Resources', 'app.asar');
    if (!fs.existsSync(appRoot)) throw new Error(`app.asar missing: ${appRoot}`);
    return { bundle, binary, appRoot, version: plistString(xml, 'CFBundleShortVersionString') };
}

module.exports = { packagedApp, plistString };
