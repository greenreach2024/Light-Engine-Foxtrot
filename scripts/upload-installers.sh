#!/bin/bash
# Upload Desktop Installers to AWS S3 + CloudFront
set -e

BUCKET="light-engine-installers"
DIST_ID="E1J9T3MG6QCY2O"
SOURCE_DIR="/Users/petergilbert/Light-Engine-Foxtrot/desktop-app/dist"

echo "🚀 Uploading Light Engine installers to AWS"
echo "📦 Bucket: $BUCKET"
echo "☁️  CloudFront: $DIST_ID"
echo ""

cd "$SOURCE_DIR"

# Rename files (remove spaces)
if [ -f "Light Engine-1.0.0.dmg" ]; then
    echo "📝 Renaming files..."
    mv "Light Engine-1.0.0.dmg" "Light-Engine-1.0.0.dmg" 2>/dev/null || true
    mv "Light Engine-1.0.0-arm64.dmg" "Light-Engine-1.0.0-arm64.dmg" 2>/dev/null || true
    mv "Light Engine-1.0.0.dmg.sha256" "Light-Engine-1.0.0.dmg.sha256" 2>/dev/null || true
    mv "Light Engine-1.0.0-arm64.dmg.sha256" "Light-Engine-1.0.0-arm64.dmg.sha256" 2>/dev/null || true
    echo "   ✅ Files renamed (spaces removed)"
fi

# Upload Intel macOS installer
if [ -f "Light-Engine-1.0.0.dmg" ]; then
    echo "📤 Uploading macOS Intel installer..."
    aws s3 cp "Light-Engine-1.0.0.dmg" "s3://$BUCKET/downloads/" \
        --content-type "application/x-apple-diskimage" \
        --metadata version=1.0.0,arch=x64,platform=macos
    
    aws s3 cp "Light-Engine-1.0.0.dmg.sha256" "s3://$BUCKET/downloads/" \
        --content-type "text/plain"
    
    echo "   ✅ Intel macOS uploaded"
fi

# Upload ARM macOS installer
if [ -f "Light-Engine-1.0.0-arm64.dmg" ]; then
    echo "📤 Uploading macOS Apple Silicon installer..."
    aws s3 cp "Light-Engine-1.0.0-arm64.dmg" "s3://$BUCKET/downloads/" \
        --content-type "application/x-apple-diskimage" \
        --metadata version=1.0.0,arch=arm64,platform=macos
    
    aws s3 cp "Light-Engine-1.0.0-arm64.dmg.sha256" "s3://$BUCKET/downloads/" \
        --content-type "text/plain"
    
    echo "   ✅ Apple Silicon macOS uploaded"
fi

# Upload Windows installer (if exists)
if [ -f "Light-Engine-Setup-1.0.0.exe" ]; then
    echo "📤 Uploading Windows installer..."
    aws s3 cp "Light-Engine-Setup-1.0.0.exe" "s3://$BUCKET/downloads/" \
        --content-type "application/x-msdownload" \
        --metadata version=1.0.0,arch=x64,platform=windows
    
    if [ -f "Light-Engine-Setup-1.0.0.exe.sha256" ]; then
        aws s3 cp "Light-Engine-Setup-1.0.0.exe.sha256" "s3://$BUCKET/downloads/" \
            --content-type "text/plain"
    fi
    
    echo "   ✅ Windows installer uploaded"
fi

# Invalidate CloudFront cache
echo "🔄 Invalidating CloudFront cache..."
aws cloudfront create-invalidation \
    --distribution-id "$DIST_ID" \
    --paths "/downloads/*" > /dev/null

echo "   ✅ Cache invalidated"
echo ""

# List uploaded files
echo "📋 Files now available on CloudFront:"
echo ""

if [ -f "Light-Engine-1.0.0.dmg" ]; then
    SIZE=$(ls -lh "Light-Engine-1.0.0.dmg" | awk '{print $5}')
    echo "   🍎 macOS Intel (x64):      https://d2snu3hwbju8pt.cloudfront.net/downloads/Light-Engine-1.0.0.dmg ($SIZE)"
fi

if [ -f "Light-Engine-1.0.0-arm64.dmg" ]; then
    SIZE=$(ls -lh "Light-Engine-1.0.0-arm64.dmg" | awk '{print $5}')
    echo "   🍎 macOS Apple Silicon:    https://d2snu3hwbju8pt.cloudfront.net/downloads/Light-Engine-1.0.0-arm64.dmg ($SIZE)"
fi

if [ -f "Light-Engine-Setup-1.0.0.exe" ]; then
    SIZE=$(ls -lh "Light-Engine-Setup-1.0.0.exe" | awk '{print $5}')
    echo "   🪟 Windows (x64):          https://d2snu3hwbju8pt.cloudfront.net/downloads/Light-Engine-Setup-1.0.0.exe ($SIZE)"
fi

echo ""
echo "🎉 Upload complete!"
echo ""
echo "⏳ CloudFront cache invalidation takes 1-2 minutes to propagate"
echo "🌐 Test downloads at: https://d2snu3hwbju8pt.cloudfront.net/downloads/"
