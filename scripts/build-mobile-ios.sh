#!/bin/bash
# Build iOS App for Light Engine
# Inventory and Sales Management Only - QR Scanning, Harvest Recording

set -e

echo "🏗️  Building Light Engine Mobile (iOS)..."
cd "$(dirname "$0")/.."

# Check if in mobile-app directory
if [ ! -f "mobile-app/package.json" ]; then
  echo "❌ Error: Run this from project root"
  exit 1
fi

cd mobile-app

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Check for EAS CLI
if ! command -v eas &> /dev/null; then
  echo "📦 Installing EAS CLI..."
  npm install -g eas-cli
fi

# Login to Expo (if not already logged in)
echo "🔐 Checking Expo authentication..."
if ! eas whoami &> /dev/null; then
  echo "Please login to Expo:"
  eas login
fi

# Configure EAS build if not already configured
if [ ! -f "eas.json" ]; then
  echo "⚙️  Configuring EAS Build..."
  cat > eas.json <<EOF
{
  "cli": {
    "version": ">= 5.9.0"
  },
  "build": {
    "production": {
      "ios": {
        "buildType": "release",
        "distribution": "store"
      }
    },
    "preview": {
      "ios": {
        "buildType": "release",
        "distribution": "internal"
      }
    },
    "development": {
      "ios": {
        "buildType": "development",
        "distribution": "internal"
      }
    }
  }
}
EOF
fi

# Build for iOS
echo "🔨 Building iOS app (this may take 10-15 minutes)..."
echo "💡 Building for preview/internal distribution..."
eas build --platform ios --profile preview --non-interactive

echo ""
echo "✅ Build queued!"
echo "📱 Check build status: eas build:list"
echo "📥 Download when complete: eas build:download --platform ios"
echo ""
echo "To build for App Store:"
echo "  eas build --platform ios --profile production"
echo ""
echo "To submit to App Store:"
echo "  eas submit --platform ios"
