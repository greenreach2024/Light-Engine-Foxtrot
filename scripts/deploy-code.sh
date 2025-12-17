#!/bin/bash

################################################################################
# Light Engine - Deploy Application Code to AWS EC2
# 
# Deploys application code to running EC2 instance
# 
# Usage:
#   ./scripts/deploy-code.sh --ip PUBLIC_IP
#
# Requirements:
#   - EC2 instance running
#   - SSH key at ~/.ssh/light-engine-key.pem
################################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Parse arguments
PUBLIC_IP=""
SSH_KEY="$HOME/.ssh/light-engine-key.pem"

while [[ $# -gt 0 ]]; do
  case $1 in
    --ip)
      PUBLIC_IP="$2"
      shift 2
      ;;
    --key)
      SSH_KEY="$2"
      shift 2
      ;;
    --help)
      echo "Usage: $0 --ip PUBLIC_IP [--key SSH_KEY_PATH]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

if [ -z "$PUBLIC_IP" ]; then
  echo -e "${RED}Error: --ip PUBLIC_IP is required${NC}"
  exit 1
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deploying Light Engine to EC2${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Target IP: $PUBLIC_IP"
echo "SSH Key: $SSH_KEY"
echo ""

# Verify SSH key exists
if [ ! -f "$SSH_KEY" ]; then
  echo -e "${RED}Error: SSH key not found: $SSH_KEY${NC}"
  exit 1
fi

################################################################################
# Phase 1: Create Deployment Package
################################################################################
echo -e "${YELLOW}Phase 1: Creating deployment package...${NC}"

cd "$(dirname "$0")/.."

# Create temporary directory
DEPLOY_DIR=$(mktemp -d)
echo "  Using temp dir: $DEPLOY_DIR"

# Copy files
cp -r backend public server-charlie.js package.json requirements.txt scripts "$DEPLOY_DIR/"

# Create tarball
tar -czf light-engine-deploy.tar.gz -C "$DEPLOY_DIR" .

# Cleanup temp dir
rm -rf "$DEPLOY_DIR"

echo -e "${GREEN}  ✅ Created deployment package${NC}"
echo ""

################################################################################
# Phase 2: Upload to EC2
################################################################################
echo -e "${YELLOW}Phase 2: Uploading to EC2...${NC}"

# Test SSH connection
if ! ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ubuntu@$PUBLIC_IP "echo 'SSH OK'" > /dev/null 2>&1; then
  echo -e "${RED}Error: Cannot connect to EC2 instance${NC}"
  echo "Verify:"
  echo "  - Instance is running"
  echo "  - Security group allows SSH from your IP"
  echo "  - SSH key is correct"
  exit 1
fi

# Upload package
scp -i "$SSH_KEY" light-engine-deploy.tar.gz ubuntu@$PUBLIC_IP:/tmp/
echo -e "${GREEN}  ✅ Uploaded package${NC}"

# Cleanup local tarball
rm light-engine-deploy.tar.gz

echo ""

################################################################################
# Phase 3: Extract and Install on EC2
################################################################################
echo -e "${YELLOW}Phase 3: Installing on EC2...${NC}"

ssh -i "$SSH_KEY" ubuntu@$PUBLIC_IP << 'ENDSSH'
set -e

# Stop running services (if any)
pm2 stop all 2>/dev/null || true

# Extract package
cd /opt/light-engine
sudo tar -xzf /tmp/light-engine-deploy.tar.gz
sudo chown -R ubuntu:ubuntu /opt/light-engine

# Install Node.js dependencies
echo "  Installing Node.js dependencies..."
npm install --production --silent

# Set up Python virtual environment
echo "  Setting up Python environment..."
python3.11 -m venv venv
source venv/bin/activate

# Install Python dependencies
pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet

# Install additional dependencies
pip install boto3 awscli --quiet

echo "✅ Installation complete"
ENDSSH

echo -e "${GREEN}  ✅ Installed application${NC}"
echo ""

################################################################################
# Phase 4: Configure Environment
################################################################################
echo -e "${YELLOW}Phase 4: Configuring environment...${NC}"

# Check if .env.rds exists locally
if [ -f ".env.rds" ]; then
  source .env.rds
  echo "  Found local database credentials"
else
  echo "  ⚠️  No .env.rds found locally"
  echo "  You'll need to configure database manually"
  RDS_ENDPOINT="your-rds-endpoint.rds.amazonaws.com"
  RDS_PASSWORD="your-password"
fi

# Create environment file on EC2
ssh -i "$SSH_KEY" ubuntu@$PUBLIC_IP "cat > /opt/light-engine/.env.python" << EOF
ENVIRONMENT=production
HOST=0.0.0.0
PORT=8000

# Database
DATABASE_URL=postgresql://lightengine:${RDS_PASSWORD}@${RDS_ENDPOINT}:5432/lightengine

# AWS
AWS_REGION=us-east-1
AWS_S3_BUCKET=light-engine-prod-data
AWS_S3_ENABLED=true
AWS_CLOUDWATCH_ENABLED=true
AWS_CLOUDWATCH_LOG_GROUP=/light-engine/python

# Authentication
AUTH_ENABLED=true
JWT_SECRET=$(openssl rand -base64 32)

# Logging
LOG_LEVEL=INFO
STRUCTURED_LOGGING=true
EOF

ssh -i "$SSH_KEY" ubuntu@$PUBLIC_IP "cat > /opt/light-engine/.env" << EOF
PORT=8091
NODE_ENV=production
AWS_REGION=us-east-1
EOF

echo -e "${GREEN}  ✅ Created environment files${NC}"
echo ""

################################################################################
# Phase 5: Initialize Database
################################################################################
echo -e "${YELLOW}Phase 5: Initializing database...${NC}"

ssh -i "$SSH_KEY" ubuntu@$PUBLIC_IP << 'ENDSSH'
set -e

cd /opt/light-engine
source venv/bin/activate

# Run Alembic migrations
if [ -f "alembic.ini" ]; then
  echo "  Running database migrations..."
  alembic upgrade head 2>/dev/null || echo "  ⚠️  Migrations failed (database may not be ready)"
else
  echo "  ⚠️  No alembic.ini found, skipping migrations"
fi
ENDSSH

echo -e "${GREEN}  ✅ Database initialization complete${NC}"
echo ""

################################################################################
# Phase 6: Configure PM2
################################################################################
echo -e "${YELLOW}Phase 6: Configuring PM2...${NC}"

# Create PM2 ecosystem file on EC2
ssh -i "$SSH_KEY" ubuntu@$PUBLIC_IP << 'ENDSSH'
cat > /opt/light-engine/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'light-engine-nodejs',
      script: 'server-charlie.js',
      cwd: '/opt/light-engine',
      instances: 1,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 8091
      },
      error_file: '/var/log/light-engine/nodejs-error.log',
      out_file: '/var/log/light-engine/nodejs-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'light-engine-python',
      script: 'venv/bin/uvicorn',
      args: 'backend.server:app --host 0.0.0.0 --port 8000 --workers 4',
      cwd: '/opt/light-engine',
      instances: 1,
      exec_mode: 'fork',
      interpreter: 'none',
      error_file: '/var/log/light-engine/python-error.log',
      out_file: '/var/log/light-engine/python-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
EOF
ENDSSH

# Create log directory
ssh -i "$SSH_KEY" ubuntu@$PUBLIC_IP "sudo mkdir -p /var/log/light-engine && sudo chown ubuntu:ubuntu /var/log/light-engine"

echo -e "${GREEN}  ✅ PM2 configured${NC}"
echo ""

################################################################################
# Phase 7: Start Services
################################################################################
echo -e "${YELLOW}Phase 7: Starting services...${NC}"

ssh -i "$SSH_KEY" ubuntu@$PUBLIC_IP << 'ENDSSH'
cd /opt/light-engine

# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Set up PM2 startup (if not already configured)
pm2 startup systemd -u ubuntu --hp /home/ubuntu 2>/dev/null || true

# Show status
pm2 status
ENDSSH

echo -e "${GREEN}  ✅ Services started${NC}"
echo ""

################################################################################
# Phase 8: Verify Deployment
################################################################################
echo -e "${YELLOW}Phase 8: Verifying deployment...${NC}"

sleep 5  # Wait for services to start

# Test endpoints
echo "  Testing Node.js backend..."
if curl -s -f "http://$PUBLIC_IP:8091/api/admin/farms" > /dev/null; then
  echo -e "${GREEN}    ✅ Node.js backend responding${NC}"
else
  echo -e "${RED}    ❌ Node.js backend not responding${NC}"
fi

echo "  Testing Python backend..."
if curl -s -f "http://$PUBLIC_IP:8000/health" > /dev/null; then
  echo -e "${GREEN}    ✅ Python backend responding${NC}"
else
  echo -e "${RED}    ❌ Python backend not responding${NC}"
fi

echo ""

################################################################################
# Summary
################################################################################
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "🌐 Application URLs:"
echo "  - Dashboard: http://$PUBLIC_IP/"
echo "  - Central Admin: http://$PUBLIC_IP/central-admin.html"
echo "  - Tray Inventory: http://$PUBLIC_IP/views/tray-inventory.html"
echo "  - Farm Inventory: http://$PUBLIC_IP/views/farm-inventory.html"
echo "  - API Docs: http://$PUBLIC_IP/docs"
echo ""
echo "🔍 Backend Endpoints:"
echo "  - Node.js: http://$PUBLIC_IP:8091/api/admin/farms"
echo "  - Python: http://$PUBLIC_IP:8000/health"
echo ""
echo "📊 Monitoring:"
echo "  - PM2 Status: ssh -i $SSH_KEY ubuntu@$PUBLIC_IP 'pm2 status'"
echo "  - Logs: ssh -i $SSH_KEY ubuntu@$PUBLIC_IP 'pm2 logs'"
echo ""
echo "🔧 Next Steps:"
echo "  1. Configure nginx reverse proxy (see AWS_DEPLOYMENT_COMPLETE.md)"
echo "  2. Set up SSL with certbot (optional)"
echo "  3. Configure CloudWatch agent"
echo "  4. Test all application features"
echo ""
