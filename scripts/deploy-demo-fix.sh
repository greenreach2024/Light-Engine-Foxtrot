#!/bin/bash

################################################################################
# Deploy Demo Mode Fix to AWS
#
# This script deploys the demo mode fix to your AWS EC2 instance
#
# Usage:
#   ./scripts/deploy-demo-fix.sh [EC2_HOST]
#
# Example:
#   ./scripts/deploy-demo-fix.sh ec2-user@your-instance.amazonaws.com
################################################################################

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Get EC2 host from argument or prompt
if [ -z "$1" ]; then
  echo -e "${YELLOW}Enter your EC2 instance address (e.g., ec2-user@12.34.56.78):${NC}"
  read -r EC2_HOST
else
  EC2_HOST="$1"
fi

if [ -z "$EC2_HOST" ]; then
  echo -e "${RED}Error: No EC2 host provided${NC}"
  exit 1
fi

echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Deploying Demo Mode Fix to AWS           ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "Target: $EC2_HOST"
echo ""

# Check if we can connect
echo -e "${YELLOW}→ Testing SSH connection...${NC}"
if ! ssh -o ConnectTimeout=10 "$EC2_HOST" "echo 'Connected'" 2>/dev/null; then
  echo -e "${RED}✗ Cannot connect to EC2 instance${NC}"
  echo "Please check:"
  echo "  1. Instance is running"
  echo "  2. Security group allows SSH from your IP"
  echo "  3. SSH key is correct"
  exit 1
fi
echo -e "${GREEN}✓ SSH connection successful${NC}"

# Pull latest code
echo ""
echo -e "${YELLOW}→ Pulling latest code from GitHub...${NC}"
ssh "$EC2_HOST" << 'ENDSSH'
  cd ~/Light-Engine-Delta || exit 1
  git fetch origin
  git checkout feature/inventory-and-forecasting-system
  git pull origin feature/inventory-and-forecasting-system
ENDSSH
echo -e "${GREEN}✓ Code updated${NC}"

# Install any new dependencies
echo ""
echo -e "${YELLOW}→ Installing dependencies...${NC}"
ssh "$EC2_HOST" << 'ENDSSH'
  cd ~/Light-Engine-Delta
  npm install --production
ENDSSH
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Set demo mode environment variables
echo ""
echo -e "${YELLOW}→ Configuring demo mode...${NC}"
ssh "$EC2_HOST" << 'ENDSSH'
  cd ~/Light-Engine-Delta
  
  # Create or update .env file
  if ! grep -q "DEMO_MODE" .env 2>/dev/null; then
    echo "" >> .env
    echo "# Demo Mode Configuration" >> .env
    echo "DEMO_MODE=true" >> .env
    echo "DEMO_FARM_ID=DEMO-FARM-001" >> .env
    echo "DEMO_REALTIME=true" >> .env
  else
    sed -i 's/DEMO_MODE=.*/DEMO_MODE=true/' .env
    sed -i 's/DEMO_FARM_ID=.*/DEMO_FARM_ID=DEMO-FARM-001/' .env
  fi
ENDSSH
echo -e "${GREEN}✓ Demo mode enabled${NC}"

# Restart the application
echo ""
echo -e "${YELLOW}→ Restarting application...${NC}"
ssh "$EC2_HOST" << 'ENDSSH'
  # Stop existing process
  pm2 stop light-engine || pkill -f server-foxtrot.js || true
  
  # Start with demo mode
  cd ~/Light-Engine-Delta
  pm2 start ecosystem.config.js --env production --update-env
  
  # Save PM2 config
  pm2 save
ENDSSH
echo -e "${GREEN}✓ Application restarted${NC}"

# Check status
echo ""
echo -e "${YELLOW}→ Checking application status...${NC}"
sleep 3
ssh "$EC2_HOST" << 'ENDSSH'
  pm2 status
  echo ""
  echo "Checking demo mode..."
  curl -s http://localhost:8091/data/farm.json | python3 -c "import sys, json; d=json.load(sys.stdin); print(f'✓ Farm: {d.get(\"name\", \"N/A\")}')" 2>/dev/null || echo "✗ Demo endpoint not responding"
ENDSSH

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✓ Deployment Complete!                   ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "Demo mode is now active on your AWS instance."
echo ""
echo "To view the demo site, open:"
echo "  http://<your-ec2-public-ip>:8091"
echo ""
echo "To check logs:"
echo "  ssh $EC2_HOST 'pm2 logs light-engine'"
echo ""
