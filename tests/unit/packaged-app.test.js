const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { packagedApp, plistString } = require('../../scripts/lib/packaged-app');

// A bundle laid out the way electron-builder writes Scrutinizer.app, with
// empty files where the real binary and archive would be.
function fakeBundle({ executable = 'Scrutinizer', version = '9.8.7', binary = true, asar = true } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-app-test-'));
    const bundle = path.join(root, 'Scrutinizer.app');
    fs.mkdirSync(path.join(bundle, 'Contents', 'MacOS'), { recursive: true });
    fs.mkdirSync(path.join(bundle, 'Contents', 'Resources'), { recursive: true });
    const keys = [
        '<key>CFBundleDisplayName</key>\n    <string>Scrutinizer</string>',
        executable === null ? '' : `<key>CFBundleExecutable</key>\n    <string>${executable}</string>`,
        `<key>CFBundleShortVersionString</key>\n    <string>${version}</string>`
    ].join('\n    ');
    fs.writeFileSync(path.join(bundle, 'Contents', 'Info.plist'),
        `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n  <dict>\n    ${keys}\n  </dict>\n</plist>\n`);
    if (binary && executable) fs.writeFileSync(path.join(bundle, 'Contents', 'MacOS', executable), '');
    if (asar) fs.writeFileSync(path.join(bundle, 'Contents', 'Resources', 'app.asar'), '');
    return { root, bundle };
}

describe('packagedApp', () => {
    const made = [];
    const make = (opts) => { const b = fakeBundle(opts); made.push(b.root); return b.bundle; };
    afterAll(() => made.forEach(r => fs.rmSync(r, { recursive: true, force: true })));

    test('finds the executable named in Info.plist, the app.asar and the version', () => {
        const bundle = make({ executable: 'Scrutinizer', version: '2.9.0' });
        const app = packagedApp(bundle);
        expect(app.bundle).toBe(path.resolve(bundle));
        expect(app.binary).toBe(path.join(bundle, 'Contents', 'MacOS', 'Scrutinizer'));
        expect(app.appRoot).toBe(path.join(bundle, 'Contents', 'Resources', 'app.asar'));
        expect(app.version).toBe('2.9.0');
    });

    test('page URLs under the package are rooted at app.asar', () => {
        const app = packagedApp(make());
        const url = pathToFileURL(path.join(app.appRoot, 'renderer', 'study-interstitial.html')).href;
        expect(url.startsWith(pathToFileURL(app.appRoot).href)).toBe(true);
        expect(url).toMatch(/\/Contents\/Resources\/app\.asar\/renderer\/study-interstitial\.html$/);
    });

    test('a relative bundle path resolves against the working directory', () => {
        const bundle = make();
        const rel = path.relative(process.cwd(), bundle);
        expect(packagedApp(rel).bundle).toBe(path.resolve(bundle));
    });

    test('names the missing piece instead of returning a partial result', () => {
        expect(() => packagedApp(path.join(os.tmpdir(), 'no-such-dir', 'Scrutinizer.app'))).toThrow(/no Contents\/Info\.plist/);
        expect(() => packagedApp(make({ executable: null }))).toThrow(/CFBundleExecutable/);
        expect(() => packagedApp(make({ binary: false }))).toThrow(/app executable missing/);
        expect(() => packagedApp(make({ asar: false }))).toThrow(/app\.asar missing/);
    });

    test('a bare --app flag (no path) is rejected', () => {
        expect(() => packagedApp(true)).toThrow(/needs the path/);
        expect(() => packagedApp('')).toThrow(/needs the path/);
    });
});

describe('plistString', () => {
    test('reads a string value by key and returns null for a missing key', () => {
        const xml = '<dict><key>A</key>\n\t<string>one</string><key>B</key><string></string></dict>';
        expect(plistString(xml, 'A')).toBe('one');
        expect(plistString(xml, 'B')).toBe('');
        expect(plistString(xml, 'C')).toBeNull();
    });
});
