#!/bin/bash
# Install Node.js dependencies for Elastic Beanstalk AL2023

set -ex

echo "=== Installing dependencies ==="
echo "Current directory: $(pwd)"
echo "Listing files:"
ls -la

if [ -f "Procfile" ] && grep -q "cd greenreach-central" "Procfile"; then
    echo "Procfile uses greenreach-central; skipping root dependency install"
    exit 0
fi

# Install dependencies
if [ -f "package-lock.json" ]; then
    echo "Using npm ci..."
    npm ci --only=production
elif [ -f "package.json" ]; then
    echo "Using npm install..."
    npm install --production
else
    echo "ERROR: No package.json found!"
    exit 1
fi

echo "=== Dependencies installed successfully ==="
echo "node_modules contents:"
ls -la node_modules/ | head -20
