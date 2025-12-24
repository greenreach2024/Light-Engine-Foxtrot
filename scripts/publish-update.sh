#!/bin/bash
# Publish Update Script
# Builds binaries and publishes to update server

set -e

VERSION=${1:-$(node -p "require('./package.json').version")}
CHANNEL=${2:-stable}
PLATFORMS=("linux-x64" "linux-arm64" "darwin-x64" "win32-x64")

echo "=========================================="
echo "Publishing Light Engine Update"
echo "=========================================="
echo "Version: $VERSION"
echo "Channel: $CHANNEL"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check prerequisites
if [ ! -f "config/greenreach-private.pem" ]; then
  echo -e "${RED}Error: Private key not found${NC}"
  echo "Generate key pair first: npm run generate-keys"
  exit 1
fi

# Build binaries
echo "Building binaries..."
npm run build:binaries

# Process each platform
for PLATFORM in "${PLATFORMS[@]}"; do
  echo ""
  echo -e "${YELLOW}Processing $PLATFORM...${NC}"
  
  # Determine binary name
  BINARY_NAME="lightengine"
  if [[ $PLATFORM == win32* ]]; then
    BINARY_NAME="lightengine.exe"
  fi
  
  SOURCE_BINARY="dist/lightengine-$PLATFORM"
  if [[ $PLATFORM == win32* ]]; then
    SOURCE_BINARY="$SOURCE_BINARY.exe"
  fi
  
  if [ ! -f "$SOURCE_BINARY" ]; then
    echo -e "${RED}✗ Binary not found: $SOURCE_BINARY${NC}"
    continue
  fi
  
  # Create release directory
  RELEASE_DIR="update-server/releases/$CHANNEL/$PLATFORM/$VERSION"
  mkdir -p "$RELEASE_DIR"
  
  # Copy binary
  cp "$SOURCE_BINARY" "$RELEASE_DIR/$BINARY_NAME"
  echo -e "${GREEN}✓ Binary copied${NC}"
  
  # Generate checksum
  if [[ "$OSTYPE" == "darwin"* ]]; then
    shasum -a 256 "$RELEASE_DIR/$BINARY_NAME" | awk '{print $1}' > "$RELEASE_DIR/$BINARY_NAME.sha256"
  else
    sha256sum "$RELEASE_DIR/$BINARY_NAME" | awk '{print $1}' > "$RELEASE_DIR/$BINARY_NAME.sha256"
  fi
  echo -e "${GREEN}✓ Checksum generated${NC}"
  
  # Sign binary
  openssl dgst -sha256 \
    -sign config/greenreach-private.pem \
    -out "$RELEASE_DIR/$BINARY_NAME.sig" \
    "$RELEASE_DIR/$BINARY_NAME"
  echo -e "${GREEN}✓ Binary signed${NC}"
  
  # Get file size
  SIZE=$(stat -f%z "$RELEASE_DIR/$BINARY_NAME" 2>/dev/null || stat -c%s "$RELEASE_DIR/$BINARY_NAME")
  
  # Create manifest
  MANIFEST_FILE="update-server/releases/$CHANNEL/$PLATFORM/manifest.json"
  
  cat > "$MANIFEST_FILE" <<EOF
{
  "version": "$VERSION",
  "releaseDate": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "url": "https://updates.greenreach.com/download/$CHANNEL/$PLATFORM/$VERSION/$BINARY_NAME",
  "checksumUrl": "https://updates.greenreach.com/download/$CHANNEL/$PLATFORM/$VERSION/$BINARY_NAME.sha256",
  "signatureUrl": "https://updates.greenreach.com/download/$CHANNEL/$PLATFORM/$VERSION/$BINARY_NAME.sig",
  "size": $SIZE,
  "changelog": "See release notes",
  "minimumVersion": "1.0.0",
  "releaseNotes": "https://docs.greenreach.com/releases/$VERSION"
}
EOF
  
  echo -e "${GREEN}✓ Manifest created${NC}"
  
  # Verify signature
  openssl dgst -sha256 \
    -verify config/greenreach-public.pem \
    -signature "$RELEASE_DIR/$BINARY_NAME.sig" \
    "$RELEASE_DIR/$BINARY_NAME" > /dev/null 2>&1
  
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Signature verified${NC}"
  else
    echo -e "${RED}✗ Signature verification failed${NC}"
    exit 1
  fi
  
  echo -e "${GREEN}✓ $PLATFORM complete${NC}"
done

echo ""
echo "=========================================="
echo -e "${GREEN}✨ Update published successfully!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Upload releases to update server:"
echo "   rsync -avz update-server/releases/ user@updates.greenreach.com:/opt/update-server/releases/"
echo ""
echo "2. Configure staged rollout:"
echo "   curl -X POST https://updates.greenreach.com/rollout/$VERSION \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"percentage\": 5, \"enabled\": true}'"
echo ""
echo "3. Monitor update checks:"
echo "   curl https://updates.greenreach.com/stats"
echo ""
echo "4. Gradually increase rollout:"
echo "   5% (24h) → 25% (48h) → 100%"
echo ""
