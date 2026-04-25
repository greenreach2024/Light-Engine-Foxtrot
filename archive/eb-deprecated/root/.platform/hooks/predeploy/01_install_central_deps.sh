#!/bin/bash
set -x

# Navigate to greenreach-central and install dependencies
cd /var/app/staging/greenreach-central || exit 1
echo "Installing greenreach-central dependencies..."
npm install --production
echo "greenreach-central dependencies installed successfully"
