#!/bin/bash
# Build macOS Desktop Installer for Light Engine
# Inventory and Sales Management Only

set -e

echo "🏗️  Building Light Engine Desktop (macOS)..."
cd "$(dirname "$0")/.."

# Check if in desktop-app directory
if [ ! -f "desktop-app/package.json" ]; then
  echo "❌ Error: Run this from project root"
  exit 1
fi

cd desktop-app

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build macOS installer
echo "🔨 Building macOS .dmg installer..."
npm run build:mac

# Check if build succeeded
if [ -f "dist/Light-Engine-1.0.0.dmg" ]; then
  echo "✅ Build complete!"
  echo "📦 Installer: desktop-app/dist/Light-Engine-1.0.0.dmg"
  
  # Generate SHA256 checksum
  cd dist
  shasum -a 256 Light-Engine-1.0.0.dmg > Light-Engine-1.0.0.dmg.sha256
  echo "✅ Checksum: desktop-app/dist/Light-Engine-1.0.0.dmg.sha256"
  
  # Copy to install-server binaries directory
  mkdir -p ../../install-server/binaries
  cp Light-Engine-1.0.0.dmg ../../install-server/binaries/
  cp Light-Engine-1.0.0.dmg.sha256 ../../install-server/binaries/
  
  echo "✅ Copied to install-server/binaries/"
  ls -lh ../../install-server/binaries/Light-Engine-1.0.0.dmg
else
  echo "❌ Build failed - installer not found"
  exit 1
fi
