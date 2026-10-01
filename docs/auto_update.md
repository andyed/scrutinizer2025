# Auto-Update Mechanism

## Overview
Scrutinizer uses **`electron-updater`** to check for new versions on GitHub Releases.

In packaged builds, updates download in the background and install when the app quits, or at once if the user picks **Restart Now**. Development (unpackaged) builds do not auto-update.

## How it Works

1.  **Check**: 10 seconds after launch, and from **Help > Check for Updates...**, the app queries [GitHub Releases](https://github.com/andyed/scrutinizer2025/releases).
2.  **Verify**: It looks for the `latest-mac.yml` file in the latest release assets to determine the version number.
3.  **Comparison**: It compares `latest` version vs. `current` version (from `package.json`).
4.  **Download and install**:
    *   If an update is found, `electron-updater` downloads it in the background.
    *   When the download finishes, a dialog appears: **"Scrutinizer X.Y.Z has been downloaded and is ready to install."**
    *   Clicking **"Restart Now"** quits and installs the update.
    *   Clicking **"Later"** dismisses the dialog. The update installs the next time the app quits.
    *   A manual check that finds nothing shows **"Scrutinizer vX.Y.Z is up to date."** In a development build, the manual check offers a link to the GitHub Releases page instead.

## Implementation Details

### Signing requirements
Background install on macOS needs a signed, notarized app:
*   **Code Signing**: The app must be signed with a valid Apple Developer ID Certificate ($99/yr).
*   **Notarization**: The app must be sent to Apple for notarization to be trusted by Gatekeeper.

Without these, a background update would likely result in a "Damaged" app error or be blocked by macOS security. `npm run build` produces a signed, notarized build (see `docs/release-process.md` §8). The mac build targets include the `.zip` that electron-updater's macOS installer (Squirrel.Mac) requires alongside the `.dmg`.

### Configuration (`main.js`)
```javascript
// Optional dependency: the app still runs if electron-updater is not bundled
let autoUpdater = null;
try {
    ({ autoUpdater } = require('electron-updater'));
} catch (err) { /* log and continue */ }

function setupAutoUpdater() {
    if (!autoUpdater || !app.isPackaged) return;
    autoUpdater.autoDownload = true;          // download in the background
    autoUpdater.autoInstallOnAppQuit = true;  // install on next quit
    autoUpdater.logger = require('electron-log');
    // 'update-downloaded' -> "Restart Now" / "Later" dialog -> quitAndInstall()
}

// In app.whenReady():
setupAutoUpdater();
setTimeout(() => checkForAppUpdates({ manual: false }), 10000);
```

### Build Config (`package.json`)
`electron-builder` uploads `latest-mac.yml` to the target set in the `publish` configuration, and `electron-updater` in the installed app reads it from there.
```json
"publish": {
  "provider": "github",
  "owner": "andyed",
  "repo": "scrutinizer2025"
}
```

## Troubleshooting

### "I didn't get an update prompt"
1.  **Are you on the latest version?**
    *   Check `Help > check for updates` to verify.
    *   If the version check finds no newer release, no prompt appears.
2.  **Is the GitHub Release valid?**
    *   Go to the GitHub Releases page.
    *   Ensure the latest release is marked "Latest" (not "Prerelease" or "Draft" unless configured otherwise).
    *   **CRITICAL**: Ensure the release contains `latest-mac.yml`. If this file is missing, the updater cannot detect the version.
3.  **Logs**:
    *   Check the log file: `~/Library/Logs/Scrutinizer/main.log`. `electron-updater` writes its own messages there through `electron-log`.
    *   The app's own lines go to stdout (launch the packaged app's binary from a terminal). Look for `[Updater] Update available:`, `[Updater] Error:` or `[Updater] checkForUpdates failed:`.

### Generating a Release with Update Support
To ensure the `latest-mac.yml` is generated:
1.  Run the release script:
    ```bash
    npm run release
    ```
    *(This runs `electron-builder --mac --publish always`)*
2.  This will compile the app, create the `.dmg` and `.zip`, generate the `.yml` files, and upload them to a draft release on GitHub.
3.  **Publish** the draft on GitHub to make it live.
