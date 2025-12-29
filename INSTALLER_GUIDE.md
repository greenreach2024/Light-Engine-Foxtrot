# Light Engine Desktop Installers - Build & Distribution Guide

## ✅ Successfully Built

### macOS Installers
✓ **Intel (x64)**: `Light Engine-1.0.0.dmg` (95 MB)
✓ **Apple Silicon (ARM64)**: `Light Engine-1.0.0-arm64.dmg` (90 MB)

**Location**: `desktop-app/dist/`

**Checksums**:
- Intel: `8f1d6fd39d02961eaf78cb64558f7fc9717013f62217747f90f6333a9431bcbe`
- ARM64: `d9d080925a323ea86f65a55ff0abae202c0eabb938c35e5e9ab03bff4ebb2f96`

## 📦 What Was Fixed

### 1. **Removed SQLite Dependencies**
The desktop app doesn't need a local database since it connects to your Symcod device over the network. Removed:
- `sqlite3` - was causing native module compilation issues
- `better-sqlite3` - was causing native module compilation issues

### 2. **Simplified Build Assets**
Removed references to missing icon files and background images:
- DMG background image (optional)
- Windows installer images (optional)
- App icons (electron-builder uses defaults)

### 3. **Updated Server Configuration**
Changed `desktop-app/server.js` to reflect network-based architecture instead of local SQLite.

## 🚀 How to Build

### Build macOS Installers
```bash
cd desktop-app
npm run build:mac
```

Outputs:
- `dist/Light Engine-1.0.0.dmg` (Intel x64)
- `dist/Light Engine-1.0.0-arm64.dmg` (Apple Silicon)

### Build Windows Installer (requires Windows or CI)
```bash
cd desktop-app
npm run build:win
```

Output:
- `dist/Light Engine-Setup-1.0.0.exe`

**Note**: Windows builds require a Windows machine or CI/CD (GitHub Actions, AppVeyor, etc.)

### Build Both Platforms
```bash
cd desktop-app
npm run build:all
```

## 📤 Upload to AWS

### 1. Rename Files (Recommended)
```bash
cd desktop-app/dist
mv "Light Engine-1.0.0.dmg" "Light-Engine-1.0.0.dmg"
mv "Light Engine-1.0.0-arm64.dmg" "Light-Engine-1.0.0-arm64.dmg"
```

### 2. Upload Using Existing Script
```bash
# From project root
bash scripts/upload-to-aws.sh
```

Or manually:
```bash
aws s3 cp "Light-Engine-1.0.0.dmg" s3://light-engine-installers/downloads/ \
  --content-type "application/x-apple-diskimage" \
  --metadata version=1.0.0,arch=x64

aws s3 cp "Light-Engine-1.0.0-arm64.dmg" s3://light-engine-installers/downloads/ \
  --content-type "application/x-apple-diskimage" \
  --metadata version=1.0.0,arch=arm64

# Upload checksums
aws s3 cp "Light-Engine-1.0.0.dmg.sha256" s3://light-engine-installers/downloads/
aws s3 cp "Light-Engine-1.0.0-arm64.dmg.sha256" s3://light-engine-installers/downloads/

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id E1J9T3MG6QCY2O \
  --paths "/downloads/*"
```

## 🌐 Download URLs

Once uploaded, files will be available at:

### Intel Macs
```
https://d2snu3hwbju8pt.cloudfront.net/downloads/Light-Engine-1.0.0.dmg
```

### Apple Silicon Macs
```
https://d2snu3hwbju8pt.cloudfront.net/downloads/Light-Engine-1.0.0-arm64.dmg
```

### Windows (when built)
```
https://d2snu3hwbju8pt.cloudfront.net/downloads/Light-Engine-Setup-1.0.0.exe
```

## 🔧 Windows Build Options

Since you're on macOS, here are options for building Windows installers:

### Option 1: GitHub Actions (Recommended)
Create `.github/workflows/build-installers.yml`:

```yaml
name: Build Installers

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: cd desktop-app && npm install
      - run: cd desktop-app && npm run build:win
      - uses: actions/upload-artifact@v3
        with:
          name: windows-installer
          path: desktop-app/dist/*.exe

  build-mac:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: cd desktop-app && npm install
      - run: cd desktop-app && npm run build:mac
      - uses: actions/upload-artifact@v3
        with:
          name: mac-installers
          path: desktop-app/dist/*.dmg
```

### Option 2: Docker with Wine
```bash
docker run --rm -ti \
  -v ${PWD}:/project \
  electronuserland/builder:wine \
  /bin/bash -c "cd /project/desktop-app && npm install && npm run build:win"
```

### Option 3: VM or Remote Windows Machine
Set up a Windows VM and run:
```bash
cd desktop-app
npm install
npm run build:win
```

## 📱 iOS Mobile App

The mobile app requires Expo Application Services (EAS):

### Setup
```bash
npm install -g eas-cli
eas login
```

### Build
```bash
cd mobile-app
eas build --platform ios
```

This creates a `.ipa` file for TestFlight distribution.

## 🎯 Testing Installers

### macOS
1. Download the appropriate DMG for your Mac
2. Open the DMG file
3. Drag "Light Engine" to Applications folder
4. Launch from Applications
5. First run: Right-click → Open (to bypass Gatekeeper)

### Windows
1. Download the `.exe` installer
2. Run the installer
3. Follow the installation wizard
4. Launch from Start Menu or Desktop shortcut

### Expected Behavior
- App opens to login screen
- User can enter Symcod device IP address
- Connects to Symcod device for inventory/sales
- No automation features (inventory-only mode)

## 🔒 Code Signing (Optional but Recommended)

### macOS
```bash
# Get Apple Developer ID
# Sign the app
codesign --deep --force --verify --verbose \
  --sign "Developer ID Application: YourName (TEAMID)" \
  "dist/mac/Light Engine.app"

# Notarize for distribution
xcrun notarytool submit "dist/Light Engine-1.0.0.dmg" \
  --apple-id "your@email.com" \
  --team-id "TEAMID" \
  --password "app-specific-password"
```

### Windows
```powershell
# Get Code Signing Certificate
# Sign the executable
signtool sign /f certificate.pfx /p password /t http://timestamp.digicert.com "dist/Light Engine-Setup-1.0.0.exe"
```

## 📊 Build Statistics

| Platform | Size | Build Time | Dependencies |
|----------|------|------------|--------------|
| macOS Intel | 95 MB | ~2 min | Electron, Express |
| macOS ARM64 | 90 MB | ~2 min | Electron, Express |
| Windows | ~150 MB | ~3 min | Electron, Express |

## ✅ Next Steps

1. **Upload macOS installers to AWS**
   ```bash
   cd desktop-app/dist
   aws s3 cp "Light Engine-1.0.0.dmg" s3://light-engine-installers/downloads/ --content-type "application/x-apple-diskimage"
   aws s3 cp "Light Engine-1.0.0-arm64.dmg" s3://light-engine-installers/downloads/ --content-type "application/x-apple-diskimage"
   ```

2. **Update download page** (already done!)
   - URLs point to CloudFront distribution
   - Links will work once files are uploaded

3. **Build Windows installer**
   - Use GitHub Actions or Docker
   - Upload to S3 when complete

4. **Test downloads**
   - Visit download page
   - Click download links
   - Verify installers work

5. **Consider code signing**
   - For production distribution
   - Prevents security warnings
   - Better user experience

## 🐛 Troubleshooting

### Build Fails with "ENOENT: no such file or directory"
- Check that all referenced files in `package.json` exist
- Remove optional assets like icons and backgrounds
- Rebuild with simplified configuration

### "Cannot find module" Errors
- Run `npm install` in desktop-app directory
- Check that all imports use correct paths
- Verify parent directory files are accessible

### Native Module Compilation Errors
- Avoid native dependencies (sqlite3, better-sqlite3)
- Use pure JavaScript alternatives
- For network-based apps, don't need local database

### Code Signing Warnings
- These are warnings, not errors
- App will work without signing
- For distribution, get proper certificates
- Use `--no-code-signing` flag for development

## 📚 Resources

- [Electron Builder Docs](https://www.electron.build/)
- [Expo EAS Build](https://docs.expo.dev/build/introduction/)
- [AWS S3 CLI Reference](https://docs.aws.amazon.com/cli/latest/reference/s3/)
- [CloudFront Invalidation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Invalidation.html)

---

**Status**: macOS installers ready for distribution! 🎉
**Next**: Upload to AWS S3 and test download flow.
