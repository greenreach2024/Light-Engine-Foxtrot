#!/bin/bash
set -e

cd /Users/petergilbert/Light-Engine-Foxtrot

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
TEMP_DIR="/tmp/foxtrot-build-${TIMESTAMP}"

echo "Creating bundle directory..."
mkdir -p "$TEMP_DIR"

echo "Copying directories..."
cp -r lib scripts backend src public automation routes controller config services aws-testing "$TEMP_DIR/"

echo "Copying root files..."
cp server-foxtrot.js package.json package-lock.json "$TEMP_DIR/"
[ -f requirements.txt ] && cp requirements.txt "$TEMP_DIR/" || echo "No requirements.txt found"

echo ""
echo "=== Verifying Critical Files ==="
[ -f "$TEMP_DIR/server-foxtrot.js" ] && echo "✓ server-foxtrot.js present" || echo "✗ server-foxtrot.js MISSING"
grep -q "DB_ENABLED=false" "$TEMP_DIR/aws-testing/Dockerfile.testing" && echo "✓ Dockerfile has DB_ENABLED=false" || echo "✗ Dockerfile missing edge mode"
grep -q "FARM_ID=FARM-TEST-WIZARD-001" "$TEMP_DIR/aws-testing/Dockerfile.testing" && echo "✓ Dockerfile has FARM_ID" || echo "✗ Dockerfile missing FARM_ID"
grep -q "ADMIN_PASSWORD=Grow123" "$TEMP_DIR/aws-testing/Dockerfile.testing" && echo "✓ Dockerfile has ADMIN_PASSWORD" || echo "✗ Dockerfile missing password"
grep -q "Invalid farm ID or password" "$TEMP_DIR/server-foxtrot.js" && echo "✓ server-foxtrot.js has unified auth" || echo "✗ server-foxtrot.js missing auth fix"
grep -q "Query by email if provided" "$TEMP_DIR/server-foxtrot.js" && echo "✓ server-foxtrot.js has optional email logic" || echo "✗ server-foxtrot.js missing optional email"

echo ""
echo "Creating zip bundle..."
cd "$TEMP_DIR"
zip -qr "/tmp/foxtrot-source-$TIMESTAMP.zip" .
cd -

echo ""
ls -lh "/tmp/foxtrot-source-$TIMESTAMP.zip"
echo ""
echo "TIMESTAMP=$TIMESTAMP"
echo ""
echo "To upload: aws s3 cp /tmp/foxtrot-source-$TIMESTAMP.zip s3://foxtrot-test-builds-634419072974/ --region us-east-1"
