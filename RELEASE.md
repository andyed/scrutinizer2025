# Scrutinizer Release Quick Start

## Security Status ✅
- Webview content isolated (no node integration)
- Safe IPC communication via preload script
- Ready for production release

## Next Steps

### 1. Test Current Build (5 minutes)
```bash
npm start
```
Verify all features work with security changes.

### 2. Test Unsigned Build (10 minutes)
```bash
npm run build:unsigned
```
This creates a local .dmg without signing. Test the installer.

### 3. Get Apple Developer Certificate ($99)
1. Enroll: https://developer.apple.com/programs/
2. Wait for approval (usually same day)
3. Generate "Developer ID Application" certificate
4. Install in Keychain

### 4. Setup Environment Variables
```bash
cp .env.example .env.local
# Edit .env.local with your credentials
```

### 5. Setup S3 Bucket
- Create bucket: `scrutinizer-releases`
- Enable public read access
- Configure CORS

### 6. First Signed Build
```bash
# Load environment variables
source .env.local

# Build, sign, and notarize (takes 5-15 min)
npm run build
```

### 7. Release to S3
```bash
npm run release
```

## Cost Summary
- **Apple Developer:** $99/year
- **AWS S3:** ~$1-2/month
- **Total first year:** ~$112

## Documentation
- **Full guide:** `docs/release-prep.md`
- **Migration plan:** `docs/webcontentsview-migration.md`

## Timeline
- Certificate setup: 1-2 hours
- First build: 30 minutes
- Testing: 2-4 hours
- **Total: ~1 day**

## Support
Issues? Check `docs/release-prep.md` for troubleshooting.
