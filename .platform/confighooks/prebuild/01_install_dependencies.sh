#!/bin/bash
# Ensure dependencies are installed during config-only deployments (EB config-deploy)

set -ex
cd /var/app/staging

if [ -f "package-lock.json" ]; then
  npm ci --only=production
else
  npm install --production
fi
