#!/bin/bash
# Build and sign macOS installers properly
set -e

echo "🔨 Building macOS installers with ad-hoc signing..."
cd /Users/petergilbert/Light-Engine-Foxtrot/desktop-app

# Build the apps
echo "📦 Building apps..."
npm run build:mac

echo ""
echo "✍️  Ad-hoc signing apps..."
# Sign the apps
codesign --force --deep --sign - "dist/mac-arm64/Light Engine.app"
codesign --force --deep --sign - "dist/mac/Light Engine.app"

echo ""
echo "📦 Creating signed DMG files..."
# Recreate DMG with signed apps
cd dist

# Clean old DMGs
rm -f "Light Engine-1.0.0.dmg" "Light Engine-1.0.0-arm64.dmg" "Light-Engine-1.0.0.dmg" "Light-Engine-1.0.0-arm64.dmg"

# Create new DMGs
hdiutil create -volname "Light Engine" -srcfolder "mac/Light Engine.app" -ov -format UDZO "Light-Engine-1.0.0.dmg"
hdiutil create -volname "Light Engine" -srcfolder "mac-arm64/Light Engine.app" -ov -format UDZO "Light-Engine-1.0.0-arm64.dmg"

echo ""
echo "🔐 Creating checksums..."
shasum -a 256 "Light-Engine-1.0.0.dmg" > "Light-Engine-1.0.0.dmg.sha256"
shasum -a 256 "Light-Engine-1.0.0-arm64.dmg" > "Light-Engine-1.0.0-arm64.dmg.sha256"

echo ""
echo "✅ Signed installers ready:"
ls -lh Light-Engine-*.dmg

echo ""
echo "📤 Ready to upload with: bash ../scripts/upload-installers.sh"
