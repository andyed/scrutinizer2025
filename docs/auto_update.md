# Auto-Update Mechanism

## Overview
Scrutinizer uses **`electron-updater`** to check for new versions on GitHub Releases.

Currently, the system is configured for **Notification Only**. It does not automatically download and install updates in the background.

## How it Works

1.  **Check**: On application launch (and via the Help menu), the app queries the [GitHub Releases API](https://github.com/andyed/scrutinizer2025/releases).
2.  **Verify**: It looks for the `latest-mac.yml` file in the latest release assets to determine the version number.
3.  **Comparision**: It compares `latest` version vs. `current` version (from `package.json`).
4.  **Notification**:
    *   If an update is found, a dialog appears: **"Scrutinizer vX.X.X is available!"**.
    *   Clicking **"Download"** opens the GitHub Releases page in your default browser.
    *   Clicking **"Later"** dismisses the dialog.

## Implementation Details

### Why "Notification Only"?
Full background auto-updates (checking, downloading, replacing the app, and restarting) on macOS strict requirements:
*   **Code Signing**: The app must be signed with a valid Apple Developer ID Certificate ($99/yr).
*   **Notarization**: The app must be sent to Apple for notarization to be trusted by Gatekeeper.

Without these, a background update would likely result in a "Damaged" app error or be blocked by macOS security. By redirecting the user to download the new `.dmg` manually, we bypass this complexity while still keeping users informed.

### Configuration (`main.js`)
```javascript
const { autoUpdater } = require('electron-updater');

// Disable background download
autoUpdater.autoDownload = false;

// Check on launch (Production only)
if (process.env.NODE_ENV === 'production') {
    autoUpdater.checkForUpdates();
}

// Dialog Logic
autoUpdater.on('update-available', (info) => {
    // Show Dialog -> Open External URL
});
```

### Build Config (`package.json`)
The `publish` configuration tells `electron-builder` where to look for the `latest-mac.yml` file.
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
    *   If the app thinks it is up-to-date, it won't prompt.
2.  **Is the GitHub Release valid?**
    *   Go to the GitHub Releases page.
    *   Ensure the latest release is marked "Latest" (not "Prerelease" or "Draft" unless configured otherwise).
    *   **CRITICAL**: Ensure the release contains `latest-mac.yml`. If this file is missing, the updater cannot detect the version.
3.  **Logs**:
    *   Check the log file: `~/Library/Logs/Scrutinizer/main.log` (or `console.log` in dev mode).
    *   Look for `[Main] Update check failed` or `[Main] Update available`.

### Generating a Release with Update Support
To ensure the `latest-mac.yml` is generated:
1.  Run the release script:
    ```bash
    npm run release
    ```
    *(This runs `electron-builder --mac --publish always`)*
2.  This will compile the app, create the `.dmg` and `.zip`, generate the `.yml` files, and upload them a draft release on GitHub.
3.  **Publish** the draft on GitHub to make it live.
