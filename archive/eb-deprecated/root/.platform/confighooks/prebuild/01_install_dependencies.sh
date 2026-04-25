#!/bin/bash
# Ensure dependencies are installed during config-only deployments (EB config-deploy)

set -ex
cd /var/app/staging

if [ -f "Procfile" ] && grep -q "cd greenreach-central" "Procfile"; then
  echo "Procfile uses greenreach-central; skipping root dependency install"
  exit 0
fi

if [ -f "package-lock.json" ]; then
  npm ci --only=production
else
  npm install --production
fi
