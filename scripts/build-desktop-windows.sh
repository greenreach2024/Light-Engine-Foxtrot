#!/bin/bash
# Build Windows Desktop Installer for Light Engine
# Inventory and Sales Management Only

set -e

echo "🏗️  Building Light Engine Desktop (Windows)..."
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

# Build Windows installer
echo "🔨 Building Windows .exe installer..."
npm run build:win

# Check if build succeeded
if [ -f "dist/Light-Engine-Setup-1.0.0.exe" ]; then
  echo "✅ Build complete!"
  echo "📦 Installer: desktop-app/dist/Light-Engine-Setup-1.0.0.exe"
  
  # Generate SHA256 checksum
  cd dist
  if command -v sha256sum &> /dev/null; then
    sha256sum Light-Engine-Setup-1.0.0.exe > Light-Engine-Setup-1.0.0.exe.sha256
    echo "✅ Checksum: desktop-app/dist/Light-Engine-Setup-1.0.0.exe.sha256"
  elif command -v shasum &> /dev/null; then
    shasum -a 256 Light-Engine-Setup-1.0.0.exe > Light-Engine-Setup-1.0.0.exe.sha256
    echo "✅ Checksum: desktop-app/dist/Light-Engine-Setup-1.0.0.exe.sha256"
  fi
  
  # Copy to install-server binaries directory
  mkdir -p ../../install-server/binaries
  cp Light-Engine-Setup-1.0.0.exe ../../install-server/binaries/
  cp Light-Engine-Setup-1.0.0.exe.sha256 ../../install-server/binaries/ 2>/dev/null || true
  
  echo "✅ Copied to install-server/binaries/"
  ls -lh ../../install-server/binaries/Light-Engine-Setup-1.0.0.exe
else
  echo "❌ Build failed - installer not found"
  exit 1
fi
