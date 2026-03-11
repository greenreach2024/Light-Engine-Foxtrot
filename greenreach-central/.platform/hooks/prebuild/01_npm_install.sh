#!/bin/bash
set -xe

echo "Running npm install for GreenReach Central..."
cd /var/app/staging

# Force clean install to avoid stale/corrupted node_modules cache
rm -rf node_modules
npm install --production

echo "npm install completed — $(ls node_modules | wc -l) packages installed"
