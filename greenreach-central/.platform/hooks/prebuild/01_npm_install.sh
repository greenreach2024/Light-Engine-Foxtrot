#!/bin/bash
set -x

echo "Running npm install for GreenReach Central..."
cd /var/app/staging
npm install --production

echo "npm install completed"
