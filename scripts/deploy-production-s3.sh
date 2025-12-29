#!/bin/bash
# Production S3 Deployment - Clean Install
# No demo data, wizard enabled, AI assistant ready

set -e

BUCKET="light-engine-demo-1765326376"
SOURCE="public"

echo "🚀 Deploying Clean Production Build to S3"
echo "=========================================="
echo ""
echo "Bucket: $BUCKET"
echo "Source: $SOURCE"
echo ""

# Remove demo data files before deployment
echo "📝 Preparing production build (removing demo artifacts)..."

# Create temp build directory
rm -rf /tmp/light-engine-prod-build
mkdir -p /tmp/light-engine-prod-build
cp -R $SOURCE/* /tmp/light-engine-prod-build/

# Check if console-wrapper exists and confirm removal
if [ -f "/tmp/light-engine-prod-build/js/console-wrapper.js" ]; then
    echo "  ⚠️  Removing console-wrapper.js (demo mode suppressor)"
    rm -f /tmp/light-engine-prod-build/js/console-wrapper.js
fi

# Check demo data directory
if [ -d "/tmp/light-engine-prod-build/data/demo" ]; then
    echo "  ⚠️  Removing demo data"
    rm -rf /tmp/light-engine-prod-build/data/demo
fi

echo "  ✅ Build prepared"
echo ""

# Upload to S3
echo "📤 Uploading to S3..."
aws s3 sync /tmp/light-engine-prod-build/ s3://$BUCKET/ \
  --delete \
  --exclude ".DS_Store" \
  --exclude "*.md" \
  --cache-control "public, max-age=3600"

echo ""
echo "✅ Deployment Complete!"
echo ""
echo "🌐 Production URL:"
echo "   http://$BUCKET.s3-website-us-east-1.amazonaws.com"
echo ""
echo "📋 Next steps:"
echo "   1. Test startup wizard appears for new users"
echo "   2. Verify AI assistant is available" 
echo "   3. Confirm no demo data is pre-loaded"
echo ""

# Cleanup
rm -rf /tmp/light-engine-prod-build
