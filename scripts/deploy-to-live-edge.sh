#!/bin/bash
# Deploy latest code to live Edge device (Big Green Farm)
# Usage: ./scripts/deploy-to-live-edge.sh

set -e

EDGE_HOST="100.65.187.59"
EDGE_USER="greenreach"
EDGE_PATH="~/Light-Engine-Foxtrot"

echo "🚀 Deploying to Live Edge Device: Big Green Farm"
echo "   Host: $EDGE_HOST"
echo ""

# Step 1: Sync code files to Edge device (excluding data files)
echo "📥 Step 1: Syncing latest code files..."
echo "   Copying public/*.js files..."
rsync -avz --progress \
  --exclude='public/data/' \
  --exclude='node_modules/' \
  --exclude='.git/' \
  --exclude='.env*' \
  ~/Light-Engine-Foxtrot/public/*.js \
  ${EDGE_USER}@${EDGE_HOST}:${EDGE_PATH}/public/

echo "   Copying server files..."
rsync -avz --progress \
  ~/Light-Engine-Foxtrot/server-foxtrot.js \
  ~/Light-Engine-Foxtrot/lib/ \
  ~/Light-Engine-Foxtrot/routes/ \
  ${EDGE_USER}@${EDGE_HOST}:${EDGE_PATH}/

# Step 2: Check for PM2 process
echo ""
echo "🔄 Step 2: Checking PM2 status..."
PM2_STATUS=$(ssh ${EDGE_USER}@${EDGE_HOST} "pm2 list | grep -E 'online|stopped|errored' || echo 'no-pm2'")
echo "$PM2_STATUS"

# Step 3: Restart Edge device server
echo ""
echo "🔄 Step 3: Restarting Edge device server..."
if echo "$PM2_STATUS" | grep -q "light-engine-foxtrot"; then
    echo "   Found PM2 process, restarting..."
    ssh ${EDGE_USER}@${EDGE_HOST} "cd ${EDGE_PATH} && pm2 restart light-engine-foxtrot || pm2 restart all"
else
    echo "   No PM2 process found, manual restart may be required"
    echo "   SSH to device and run: pm2 restart all"
fi

# Step 4: Verify deployment
echo ""
echo "✅ Step 4: Verifying deployment..."
sleep 3
HEALTH=$(curl -sS "http://${EDGE_HOST}:8091/health" 2>&1 | grep -o '"status":"[^"]*"' | head -1)
echo "   Health check: $HEALTH"

JS_MODIFIED=$(curl -sI "http://${EDGE_HOST}:8091/groups-v2.js" 2>&1 | grep "Last-Modified" || echo "Unknown")
echo "   groups-v2.js: $JS_MODIFIED"

echo ""
echo "🎉 Deployment complete!"
echo ""
echo "📋 Next steps:"
echo "   1. Open http://${EDGE_HOST}:8091 in browser"
echo "   2. Hard refresh (Cmd+Shift+R) to clear browser cache"
echo "   3. Verify pages show latest data"
echo "   4. Check Operations Overview for correct plant count"
