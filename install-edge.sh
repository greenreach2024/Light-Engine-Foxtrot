#!/bin/bash
set -e

# Light Engine Edge Installation Script
# Usage: curl -sSL https://raw.githubusercontent.com/greenreach2024/Light-Engine-Foxtrot/main/install-edge.sh | bash
# Or: ./install-edge.sh

echo "🌱 Light Engine Edge Installer"
echo "=============================="
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
   echo "❌ Please run as normal user, not root"
   exit 1
fi

# Prompt for configuration
read -p "Enter Farm ID [default: EDGE-$(hostname)]: " FARM_ID
FARM_ID=${FARM_ID:-"EDGE-$(hostname)"}

read -p "Enter Farm Name [default: $(hostname) Farm]: " FARM_NAME
FARM_NAME=${FARM_NAME:-"$(hostname) Farm"}

read -p "Enter Central Server URL [default: https://light-engine-foxtrot-prod-v2.us-east-1.elasticbeanstalk.com]: " CENTRAL_URL
CENTRAL_URL=${CENTRAL_URL:-"https://light-engine-foxtrot-prod-v2.us-east-1.elasticbeanstalk.com"}

read -p "Port [default: 8091]: " PORT
PORT=${PORT:-8091}

echo ""
echo "Configuration:"
echo "  Farm ID: $FARM_ID"
echo "  Farm Name: $FARM_NAME"
echo "  Central Server: $CENTRAL_URL"
echo "  Port: $PORT"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Installation cancelled"
    exit 1
fi

# Install system dependencies
echo ""
echo "📦 Installing system dependencies..."
sudo apt-get update -qq
sudo apt-get install -y git curl build-essential python3-pip python3-venv

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo "✓ Node.js $(node --version)"
echo "✓ npm $(npm --version)"

# Install PM2 globally if not present
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    sudo npm install -g pm2
fi

echo "✓ PM2 $(pm2 --version)"

# Clone or update repository
INSTALL_DIR="$HOME/Light-Engine-Foxtrot"
if [ -d "$INSTALL_DIR" ]; then
    echo ""
    echo "📂 Repository exists, updating..."
    cd "$INSTALL_DIR"
    git fetch origin main
    git reset --hard origin/main
else
    echo ""
    echo "📂 Cloning Light Engine repository..."
    cd "$HOME"
    git clone https://github.com/greenreach2024/Light-Engine-Foxtrot.git
    cd "$INSTALL_DIR"
fi

# Install Node.js dependencies
echo ""
echo "📦 Installing Node.js dependencies (this may take a few minutes)..."
npm install --production

# Set up Python virtual environment
echo ""
echo "🐍 Setting up Python virtual environment..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# Create .env file
echo ""
echo "⚙️  Creating configuration..."
cat > .env << EOF
PORT=$PORT
CENTRAL_SERVER_URL=$CENTRAL_URL
NODE_ENV=production
FARM_ID=$FARM_ID
FARM_NAME=$FARM_NAME
EDGE_MODE=true
HOST=0.0.0.0
EOF

echo "✓ Created .env"

# Create necessary directories
mkdir -p logs data public/data

# Create start-edge.js wrapper
cat > start-edge.js << 'EOF'
import('./server-foxtrot.js');
EOF

# Patch server-foxtrot.js to force startup
if ! grep -q "Force start server for edge deployments" server-foxtrot.js; then
    echo ""
    echo "🔧 Patching server startup..."
    cat >> server-foxtrot.js << 'PATCH'

// Force start server for edge deployments
startServer().catch((error) => {
  console.error('[charlie] Unexpected startup failure:', error?.message || error);
  process.exit(1);
});
PATCH
    echo "✓ Applied startup patch"
fi

# Stop any existing PM2 processes
echo ""
echo "🔄 Configuring PM2..."
pm2 delete lightengine-node 2>/dev/null || true
pm2 delete lightengine-fastapi 2>/dev/null || true

# Start services with PM2
pm2 start start-edge.js --name lightengine-node --interpreter node
pm2 save

# Set up PM2 startup script
echo ""
echo "🚀 Enabling auto-start on boot..."
STARTUP_CMD=$(pm2 startup systemd -u $(whoami) --hp $HOME 2>&1 | grep "sudo env" || true)
if [ -n "$STARTUP_CMD" ]; then
    eval "$STARTUP_CMD"
    echo "✓ PM2 startup configured"
else
    echo "⚠️  Could not configure PM2 startup automatically"
    echo "   Run: pm2 startup"
fi

# Wait for server to start
echo ""
echo "⏳ Waiting for server to start..."
sleep 5

# Health check
echo ""
echo "🏥 Running health check..."
if curl -sf http://localhost:$PORT/health > /dev/null; then
    echo "✅ Health check passed!"
else
    echo "⚠️  Health check failed. Check logs with: pm2 logs lightengine-node"
fi

# Display status
echo ""
echo "=============================="
echo "✅ Installation Complete!"
echo "=============================="
echo ""
echo "Light Engine Edge is now running:"
echo "  Local URL:    http://localhost:$PORT"
echo "  Network URL:  http://$(hostname -I | awk '{print $1}'):$PORT"
echo ""
echo "Useful commands:"
echo "  pm2 status              - View service status"
echo "  pm2 logs lightengine-node - View logs"
echo "  pm2 restart all         - Restart services"
echo "  pm2 stop all            - Stop services"
echo ""
echo "Configuration file: $INSTALL_DIR/.env"
echo ""
