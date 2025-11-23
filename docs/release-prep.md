# Scrutinizer Release Preparation Guide

## Security Status ✅

**Completed (Nov 23, 2025):**
- Webview explicitly disables node integration in embedded content
- Preload script uses safe `ipcRenderer.sendToHost()` API only
- Host window maintains necessary node access for app functionality

**Architecture:**
- Host window (index.html + app.js): Trusted code with node access
- Webview content: Untrusted web pages, isolated via preload script
- Communication: IPC messages only (mousemove, scroll, mutation)

## Release Checklist

### 1. Apple Developer Certificate ($99/year)

**Required for macOS distribution:**
- [ ] Enroll in Apple Developer Program: https://developer.apple.com/programs/
- [ ] Generate Developer ID Application certificate
- [ ] Download and install certificate in Keychain
- [ ] Note certificate name (e.g., "Developer ID Application: Your Name (TEAM_ID)")

**Why needed:**
- macOS Gatekeeper blocks unsigned apps by default
- Users would need to right-click > Open to bypass (bad UX)
- Notarization requires valid certificate

### 2. Code Signing Configuration

Add to `package.json`:
```json
{
  "build": {
    "appId": "com.scrutinizer.app",
    "productName": "Scrutinizer",
    "mac": {
      "category": "public.app-category.utilities",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist",
      "identity": "Developer ID Application: YOUR NAME (TEAM_ID)"
    },
    "dmg": {
      "sign": false
    },
    "afterSign": "scripts/notarize.js"
  }
}
```

### 3. Entitlements File

Create `build/entitlements.mac.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
</dict>
</plist>
```

**Why these entitlements:**
- JIT compilation for V8 JavaScript engine
- Unsigned executable memory for Electron's rendering

### 4. Notarization Setup

**Requirements:**
- Apple Developer account
- App-specific password for notarization
- Xcode command line tools

**Generate app-specific password:**
1. Go to https://appleid.apple.com/account/manage
2. Sign in with Apple ID
3. Generate app-specific password
4. Save securely (needed for notarization script)

**Create `scripts/notarize.js`:**
```javascript
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  return await notarize({
    appBundleId: 'com.scrutinizer.app',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID
  });
};
```

**Install notarization dependency:**
```bash
npm install --save-dev @electron/notarize
```

### 5. S3 Distribution Setup

**Create S3 bucket:**
- [ ] AWS account setup
- [ ] Create bucket: `scrutinizer-releases` (or your preferred name)
- [ ] Enable static website hosting
- [ ] Configure CORS for downloads
- [ ] Set bucket policy for public read access

**Bucket policy example:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::scrutinizer-releases/*"
    }
  ]
}
```

**Upload structure:**
```
s3://scrutinizer-releases/
  ├── latest-mac.yml          (auto-update metadata)
  ├── Scrutinizer-1.0.0.dmg   (installer)
  ├── Scrutinizer-1.0.0-mac.zip (auto-update package)
  └── versions/
      └── 1.0.0/
          └── release-notes.md
```

### 6. Auto-Update Configuration

Add to `package.json` build config:
```json
{
  "build": {
    "publish": {
      "provider": "s3",
      "bucket": "scrutinizer-releases",
      "region": "us-east-1"
    }
  }
}
```

**Add update checking to main.js:**
```javascript
const { autoUpdater } = require('electron-updater');

app.on('ready', () => {
  createWindow();
  
  // Check for updates (macOS only for now)
  if (process.platform === 'darwin') {
    autoUpdater.checkForUpdatesAndNotify();
  }
});
```

**Install updater:**
```bash
npm install --save electron-updater
```

### 7. Build Scripts

Add to `package.json`:
```json
{
  "scripts": {
    "start": "electron .",
    "dev": "electron . --enable-logging",
    "build": "electron-builder --mac",
    "build:unsigned": "electron-builder --mac --config.mac.identity=null",
    "release": "electron-builder --mac --publish always"
  }
}
```

### 8. Environment Variables

Create `.env.local` (add to `.gitignore`):
```bash
APPLE_ID=your-apple-id@email.com
APPLE_ID_PASSWORD=xxxx-xxxx-xxxx-xxxx  # App-specific password
APPLE_TEAM_ID=XXXXXXXXXX
AWS_ACCESS_KEY_ID=your-aws-key
AWS_SECRET_ACCESS_KEY=your-aws-secret
```

### 9. Release Process

**First-time setup:**
```bash
# 1. Install dependencies
npm install --save-dev electron-builder @electron/notarize

# 2. Test unsigned build locally
npm run build:unsigned

# 3. Test the .dmg installer
open dist/Scrutinizer-1.0.0.dmg
```

**Production release:**
```bash
# 1. Set environment variables
export APPLE_ID="your-apple-id@email.com"
export APPLE_ID_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"

# 2. Build, sign, and notarize
npm run build

# 3. Upload to S3
npm run release
```

**Notarization takes 5-15 minutes.** You'll receive email confirmation from Apple.

### 10. Testing Checklist

Before public release:
- [ ] Test unsigned build on your machine
- [ ] Test signed build on your machine
- [ ] Test on fresh Mac (no dev tools) - ask friend/colleague
- [ ] Verify Gatekeeper doesn't block app
- [ ] Test auto-update mechanism
- [ ] Test all foveal mode features
- [ ] Test menu shortcuts
- [ ] Test popup window handling
- [ ] Verify no console errors in production build

## Cost Breakdown

- **Apple Developer Program:** $99/year (required)
- **AWS S3:** ~$0.50-2/month for hosting (depends on downloads)
- **AWS data transfer:** ~$0.09/GB (first 10GB/month free)
- **Domain (optional):** $12-15/year for custom download page

**Estimated first year:** ~$112-130

## Timeline Estimate

- Certificate setup: 1-2 hours (waiting for Apple approval)
- S3 configuration: 30 minutes
- Build configuration: 1-2 hours
- Testing: 2-4 hours
- First notarization: 15 minutes (automated)

**Total: 1-2 days** (mostly waiting for Apple)

## Post-Release: WebContentsView Migration

See `webcontentsview-migration.md` for v2.0 performance improvements.
