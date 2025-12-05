const { execSync } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const submissionId = process.argv[2];
if (!submissionId) {
    console.error("Usage: node check-notarization-status.js <submission-id>");
    process.exit(1);
}

const appleId = process.env.APPLE_ID;
const password = process.env.APPLE_ID_PASSWORD;
const teamId = process.env.APPLE_TEAM_ID;

if (!appleId || !password || !teamId) {
    console.error("Missing credentials in .env (APPLE_ID, APPLE_ID_PASSWORD, APPLE_TEAM_ID)");
    process.exit(1);
}

console.log(`Checking status for submission: ${submissionId}...`);
// Use 'info' command
const command = `xcrun notarytool info "${submissionId}" --apple-id "${appleId}" --password "${password}" --team-id "${teamId}"`;

try {
    const output = execSync(command, { encoding: 'utf-8', stdio: 'pipe' });
    console.log(output);
} catch (e) {
    console.error("Error checking status:");
    console.error(e.stderr ? e.stderr.toString() : e.message);
    process.exit(1);
}
