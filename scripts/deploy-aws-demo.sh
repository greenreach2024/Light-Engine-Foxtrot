#!/bin/bash
# AWS Demo Mode Deployment Script
# Deploys Light Engine Delta to AWS Elastic Beanstalk with demo mode enabled

set -e

echo "🚀 Light Engine AWS Demo Mode Deployment"
echo "========================================"
echo ""

# Check if eb CLI is installed
if ! command -v eb &> /dev/null; then
    echo "❌ Error: Elastic Beanstalk CLI (eb) is not installed"
    echo "Install with: pip install awsebcli"
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "server-charlie.js" ]; then
    echo "❌ Error: Must run from project root directory"
    exit 1
fi

# Check if demo data exists
if [ ! -f "data/demo/demo-farm-complete.json" ]; then
    echo "❌ Error: Demo data file not found at data/demo/demo-farm-complete.json"
    exit 1
fi

echo "✅ Pre-deployment checks passed"
echo ""

# Show current configuration
echo "📋 Configuration:"
echo "  Demo Mode: Enabled (via .ebextensions/nodejs.config)"
echo "  Demo Farm ID: DEMO-FARM-001"
echo "  Demo Data: data/demo/demo-farm-complete.json ($(wc -c < data/demo/demo-farm-complete.json) bytes)"
echo ""

# Check if EB is initialized
if [ ! -d ".elasticbeanstalk" ]; then
    echo "⚠️  Elastic Beanstalk not initialized in this directory"
    echo ""
    echo "Run the following commands to initialize:"
    echo "  eb init --platform node.js --region us-east-1"
    echo "  eb create light-engine-demo-env"
    echo ""
    exit 1
fi

# Confirm deployment
read -p "Deploy to AWS? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled"
    exit 0
fi

echo ""
echo "📦 Deploying to AWS Elastic Beanstalk..."
echo ""

# Deploy
eb deploy

echo ""
echo "⏳ Waiting for deployment to complete..."
echo ""

# Wait a moment for deployment to register
sleep 5

# Get environment status
echo "📊 Environment Status:"
eb status

echo ""
echo "✅ Deployment initiated!"
echo ""
echo "Next steps:"
echo "  1. Wait 2-3 minutes for deployment to complete"
echo "  2. Check status: eb status"
echo "  3. View logs: eb logs"
echo "  4. Open app: eb open"
echo ""
echo "Verify demo mode is working:"
echo "  eb ssh"
echo "  env | grep DEMO"
echo ""
echo "Test endpoints:"
echo "  curl https://\$(eb status | grep 'CNAME' | awk '{print \$2}')/data/groups.json"
echo "  curl https://\$(eb status | grep 'CNAME' | awk '{print \$2}')/api/inventory/current"
echo ""
