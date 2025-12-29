#!/bin/bash
# Upload Light Engine installers to AWS S3 + CloudFront
# Auto-generated script for CI/CD pipeline

set -e

# Configuration
BUCKET_NAME="${AWS_S3_BUCKET:-light-engine-installers}"
VERSION="1.0.0"
REGION="${AWS_REGION:-us-east-1}"

echo "🚀 Uploading Light Engine v${VERSION} to AWS S3..."
echo "📦 Bucket: ${BUCKET_NAME}"
echo "🌎 Region: ${REGION}"
echo ""

# Check AWS credentials
if ! aws sts get-caller-identity &>/dev/null; then
  echo "❌ AWS credentials not configured. Run 'aws configure' first."
  exit 1
fi

# Check if bucket exists
if ! aws s3 ls "s3://${BUCKET_NAME}" &>/dev/null; then
  echo "❌ Bucket ${BUCKET_NAME} does not exist."
  echo "   Create it with: aws s3 mb s3://${BUCKET_NAME} --region ${REGION}"
  exit 1
fi

# Windows installer
WINDOWS_FILE="desktop-app/dist/Light-Engine-Setup-${VERSION}.exe"
if [ -f "$WINDOWS_FILE" ]; then
  echo "📤 Uploading Windows installer..."
  aws s3 cp "$WINDOWS_FILE" \
    "s3://${BUCKET_NAME}/downloads/" \
    --content-type "application/x-msdownload" \
    --metadata "version=${VERSION},platform=windows,build-date=$(date -u +%Y-%m-%d)" \
    --region "${REGION}"
  
  # Upload checksum
  if [ -f "${WINDOWS_FILE}.sha256" ]; then
    aws s3 cp "${WINDOWS_FILE}.sha256" \
      "s3://${BUCKET_NAME}/downloads/" \
      --content-type "text/plain" \
      --region "${REGION}"
  fi
  
  echo "   ✅ Windows installer uploaded"
else
  echo "   ⚠️  Windows installer not found at ${WINDOWS_FILE}"
  echo "   Run: bash scripts/build-desktop-windows.sh"
fi

echo ""

# macOS installer
MACOS_FILE="desktop-app/dist/Light-Engine-${VERSION}.dmg"
if [ -f "$MACOS_FILE" ]; then
  echo "📤 Uploading macOS installer..."
  aws s3 cp "$MACOS_FILE" \
    "s3://${BUCKET_NAME}/downloads/" \
    --content-type "application/x-apple-diskimage" \
    --metadata "version=${VERSION},platform=macos,build-date=$(date -u +%Y-%m-%d)" \
    --region "${REGION}"
  
  # Upload checksum
  if [ -f "${MACOS_FILE}.sha256" ]; then
    aws s3 cp "${MACOS_FILE}.sha256" \
      "s3://${BUCKET_NAME}/downloads/" \
      --content-type "text/plain" \
      --region "${REGION}"
  fi
  
  echo "   ✅ macOS installer uploaded"
else
  echo "   ⚠️  macOS installer not found at ${MACOS_FILE}"
  echo "   Run: bash scripts/build-desktop-mac.sh"
fi

echo ""

# iOS app
IOS_FILE="mobile-app/Light-Engine-${VERSION}.ipa"
if [ -f "$IOS_FILE" ]; then
  echo "📤 Uploading iOS app..."
  aws s3 cp "$IOS_FILE" \
    "s3://${BUCKET_NAME}/downloads/" \
    --content-type "application/octet-stream" \
    --metadata "version=${VERSION},platform=ios,build-date=$(date -u +%Y-%m-%d)" \
    --region "${REGION}"
  
  echo "   ✅ iOS app uploaded"
else
  echo "   ⚠️  iOS app not found at ${IOS_FILE}"
  echo "   Run: cd mobile-app && eas build --platform ios"
fi

echo ""
echo "📋 Listing uploaded files..."
aws s3 ls "s3://${BUCKET_NAME}/downloads/" --recursive --human-readable

echo ""
echo "🔄 Invalidating CloudFront cache..."

# Get CloudFront distribution ID
DISTRIBUTION_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='Light Engine Installers CDN'].Id" \
  --output text 2>/dev/null)

if [ -n "$DISTRIBUTION_ID" ] && [ "$DISTRIBUTION_ID" != "None" ]; then
  aws cloudfront create-invalidation \
    --distribution-id "${DISTRIBUTION_ID}" \
    --paths "/downloads/*" &>/dev/null
  
  echo "   ✅ CloudFront cache invalidated (Distribution: ${DISTRIBUTION_ID})"
else
  echo "   ⚠️  CloudFront distribution not found (skipping cache invalidation)"
  echo "   Create distribution with: AWS_INSTALLER_HOSTING_SETUP.md"
fi

echo ""
echo "🎉 Upload complete!"
echo ""
echo "📥 Download URLs (replace with your CloudFront domain):"
echo "   Windows: https://YOUR_CLOUDFRONT_DOMAIN/downloads/Light-Engine-Setup-${VERSION}.exe"
echo "   macOS:   https://YOUR_CLOUDFRONT_DOMAIN/downloads/Light-Engine-${VERSION}.dmg"
echo "   iOS:     https://YOUR_CLOUDFRONT_DOMAIN/downloads/Light-Engine-${VERSION}.ipa"
