const { notarize } = require('@electron/notarize');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  // Only notarize for macOS
  if (electronPlatformName !== 'darwin') {
    return;
  }

  // Skip if no credentials provided (local unsigned builds)
  if (!process.env.APPLE_ID || !process.env.APPLE_ID_PASSWORD) {
    console.error('Skipping notarization: APPLE_ID or APPLE_ID_PASSWORD not set');
    return;
  }

  // Ensure APPLE_APP_SPECIFIC_PASSWORD is set for notarytool
  process.env.APPLE_APP_SPECIFIC_PASSWORD = process.env.APPLE_ID_PASSWORD;

  const appName = context.packager.appInfo.productFilename;

  console.error(`Notarizing ${appName}.app...`);
  console.error('Team ID:', process.env.APPLE_TEAM_ID);
  console.error('Apple ID:', process.env.APPLE_ID);

  try {
    await notarize({
      appBundleId: 'com.scrutinizer.app',
      appPath: `${appOutDir}/${appName}.app`,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_ID_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
      tool: 'notarytool'
    });

    console.error('Notarization complete!');
  } catch (error) {
    console.error('Notarization failed:', error);
    throw error;
  }
};
