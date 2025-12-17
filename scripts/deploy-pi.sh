#!/bin/bash

# Light Engine Charlie - Raspberry Pi Deployment Script
# Automates the entire deployment process on a fresh or existing Pi

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
cat << "EOF"
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║        Light Engine Charlie - Pi Deployment Script         ║
║        Indoor Farm Automation Platform                     ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "${BLUE}📁 Project directory: $PROJECT_DIR${NC}"

# Check if running on Raspberry Pi
if [ -f /proc/device-tree/model ]; then
    MODEL=$(cat /proc/device-tree/model)
    echo -e "${GREEN}✅ Detected: $MODEL${NC}"
else
    echo -e "${YELLOW}⚠️  Warning: This doesn't appear to be a Raspberry Pi${NC}"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to get Node.js major version
get_node_version() {
    if command_exists node; then
        node --version | cut -d'v' -f2 | cut -d'.' -f1
    else
        echo "0"
    fi
}

# Function to get Python major.minor version
get_python_version() {
    if command_exists python3; then
        python3 --version | awk '{print $2}' | cut -d'.' -f1,2
    else
        echo "0.0"
    fi
}

echo ""
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Step 1: System Update${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"

read -p "Update system packages? (recommended) (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}📦 Updating system packages...${NC}"
    sudo apt update
    sudo apt upgrade -y
    echo -e "${GREEN}✅ System updated${NC}"
else
    echo -e "${YELLOW}⚠️  Skipping system update${NC}"
fi

echo ""
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Step 2: Install Node.js${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"

NODE_VERSION=$(get_node_version)
if [ "$NODE_VERSION" -ge 18 ]; then
    echo -e "${GREEN}✅ Node.js v$NODE_VERSION is already installed${NC}"
else
    echo -e "${YELLOW}⚠️  Node.js 18+ required (found: v$NODE_VERSION)${NC}"
    read -p "Install Node.js 18? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${BLUE}📥 Installing Node.js 18...${NC}"
        
        # Remove old Node.js
        sudo apt remove nodejs -y 2>/dev/null || true
        
        # Install Node.js 18 from NodeSource
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt install -y nodejs
        
        # Verify installation
        NODE_VERSION=$(get_node_version)
        if [ "$NODE_VERSION" -ge 18 ]; then
            echo -e "${GREEN}✅ Node.js v$NODE_VERSION installed successfully${NC}"
        else
            echo -e "${RED}❌ Node.js installation failed${NC}"
            exit 1
        fi
    else
        echo -e "${RED}❌ Node.js 18+ is required. Exiting.${NC}"
        exit 1
    fi
fi

echo ""
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Step 3: Install Python${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"

PYTHON_VERSION=$(get_python_version)
REQUIRED_PYTHON="3.8"

if awk "BEGIN {exit !($PYTHON_VERSION >= $REQUIRED_PYTHON)}"; then
    echo -e "${GREEN}✅ Python $PYTHON_VERSION is already installed${NC}"
else
    echo -e "${YELLOW}⚠️  Python $REQUIRED_PYTHON+ required (found: $PYTHON_VERSION)${NC}"
    sudo apt install -y python3 python3-pip python3-venv
    PYTHON_VERSION=$(get_python_version)
    echo -e "${GREEN}✅ Python $PYTHON_VERSION installed${NC}"
fi

# Ensure pip is installed
if ! command_exists pip3; then
    echo -e "${BLUE}📦 Installing pip...${NC}"
    sudo apt install -y python3-pip
fi

echo ""
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Step 4: Install Project Dependencies${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"

cd "$PROJECT_DIR"

# Install Node.js dependencies
echo -e "${BLUE}📦 Installing Node.js dependencies...${NC}"
npm install
echo -e "${GREEN}✅ Node.js dependencies installed${NC}"

# Install Python dependencies
echo -e "${BLUE}📦 Installing Python dependencies...${NC}"
pip3 install -r requirements.txt
echo -e "${GREEN}✅ Python dependencies installed${NC}"

echo ""
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Step 5: Configure Environment${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"

if [ -f "$PROJECT_DIR/.env" ]; then
    echo -e "${GREEN}✅ .env file already exists${NC}"
    read -p "Do you want to reconfigure it? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}⚠️  Keeping existing .env file${NC}"
    else
        CONFIGURE_ENV=true
    fi
else
    CONFIGURE_ENV=true
fi

if [ "$CONFIGURE_ENV" = true ]; then
    echo -e "${BLUE}📝 Creating .env file...${NC}"
    
    cat > "$PROJECT_DIR/.env" << 'EOF'
# Server Configuration
PORT=8091
HOST=0.0.0.0

# SwitchBot Integration
SWITCHBOT_TOKEN=
SWITCHBOT_SECRET=

# Environment Source
ENV_SOURCE=local

# Azure Configuration (optional)
# AZURE_LATEST_URL=

# MQTT Configuration (optional)
MQTT_HOST=192.168.2.38
MQTT_PORT=1883
MQTT_USERNAME=
MQTT_PASSWORD=

# Automation Settings
TARGET_LUX=800
OCCUPIED_BRIGHTNESS=100
VACANT_BRIGHTNESS=30

# Disable mocks for production
ALLOW_MOCKS=false
EOF

    echo -e "${GREEN}✅ .env file created${NC}"
    echo -e "${YELLOW}⚠️  Please edit .env to add your credentials:${NC}"
    echo -e "${YELLOW}    nano $PROJECT_DIR/.env${NC}"
fi

echo ""
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Step 6: Create Log Directory${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"

mkdir -p "$PROJECT_DIR/logs"
echo -e "${GREEN}✅ Log directory created${NC}"

echo ""
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Step 7: Set Up systemd Services${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"

read -p "Set up auto-start services? (recommended) (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    
    # Node.js service
    echo -e "${BLUE}📝 Creating Node.js service...${NC}"
    sudo tee /etc/systemd/system/light-engine-charlie.service > /dev/null << EOF
[Unit]
Description=Light Engine Charlie - Node.js Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PROJECT_DIR
Environment="PORT=8091"
Environment="HOST=0.0.0.0"
EnvironmentFile=$PROJECT_DIR/.env
ExecStart=$(which node) server-charlie.js
Restart=always
RestartSec=10
StandardOutput=append:$PROJECT_DIR/logs/node-server.log
StandardError=append:$PROJECT_DIR/logs/node-server-error.log

[Install]
WantedBy=multi-user.target
EOF

    # Python service
    echo -e "${BLUE}📝 Creating Python service...${NC}"
    sudo tee /etc/systemd/system/light-engine-python.service > /dev/null << EOF
[Unit]
Description=Light Engine Charlie - Python Backend
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PROJECT_DIR
EnvironmentFile=$PROJECT_DIR/.env
ExecStart=$(which python3) -m backend
Restart=always
RestartSec=10
StandardOutput=append:$PROJECT_DIR/logs/python-backend.log
StandardError=append:$PROJECT_DIR/logs/python-backend-error.log

[Install]
WantedBy=multi-user.target
EOF

    # Reload systemd
    echo -e "${BLUE}🔄 Reloading systemd...${NC}"
    sudo systemctl daemon-reload
    
    # Enable services
    echo -e "${BLUE}✅ Enabling services...${NC}"
    sudo systemctl enable light-engine-charlie.service
    sudo systemctl enable light-engine-python.service
    
    echo -e "${GREEN}✅ Services created and enabled${NC}"
    
    # Ask to start services now
    read -p "Start services now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${BLUE}🚀 Starting services...${NC}"
        sudo systemctl start light-engine-charlie.service
        sudo systemctl start light-engine-python.service
        sleep 2
        
        # Check status
        echo ""
        echo -e "${BLUE}📊 Service Status:${NC}"
        echo ""
        sudo systemctl status light-engine-charlie.service --no-pager -l
        echo ""
        sudo systemctl status light-engine-python.service --no-pager -l
    fi
else
    echo -e "${YELLOW}⚠️  Skipping service setup${NC}"
    echo -e "${YELLOW}    You can start servers manually with:${NC}"
    echo -e "${YELLOW}    cd $PROJECT_DIR && ./start-servers.sh${NC}"
fi

echo ""
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Step 8: Network Configuration${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"

# Get IP address
IP_ADDRESS=$(hostname -I | awk '{print $1}')
HOSTNAME=$(hostname)

echo -e "${GREEN}✅ Network Information:${NC}"
echo -e "   Hostname: ${BLUE}$HOSTNAME${NC}"
echo -e "   IP Address: ${BLUE}$IP_ADDRESS${NC}"
echo ""
echo -e "${GREEN}Access the dashboard at:${NC}"
echo -e "   ${BLUE}http://$HOSTNAME.local:8091${NC}"
echo -e "   ${BLUE}http://$IP_ADDRESS:8091${NC}"

echo ""
read -p "Configure static IP address? (optional) (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}⚠️  Please configure static IP manually:${NC}"
    echo -e "${YELLOW}    sudo nano /etc/dhcpcd.conf${NC}"
    echo -e "${YELLOW}    See docs/PI_DEPLOYMENT_GUIDE.md for details${NC}"
fi

echo ""
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Step 9: Firewall Configuration${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"

if command_exists ufw; then
    UFW_STATUS=$(sudo ufw status | grep -i status | awk '{print $2}')
    if [ "$UFW_STATUS" = "active" ]; then
        echo -e "${BLUE}🔥 UFW firewall is active${NC}"
        read -p "Open ports 8091 and 8000? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            sudo ufw allow 8091/tcp
            sudo ufw allow 8000/tcp
            sudo ufw reload
            echo -e "${GREEN}✅ Firewall rules added${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  UFW firewall is not active${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  UFW firewall not installed${NC}"
fi

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  🎉 Deployment Complete!${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo ""

echo -e "${BLUE}Next Steps:${NC}"
echo ""
echo "1. Edit your .env file with credentials:"
echo "   ${YELLOW}nano $PROJECT_DIR/.env${NC}"
echo ""
echo "2. Restart services after editing .env:"
echo "   ${YELLOW}sudo systemctl restart light-engine-charlie.service${NC}"
echo "   ${YELLOW}sudo systemctl restart light-engine-python.service${NC}"
echo ""
echo "3. Access the dashboard:"
echo "   ${BLUE}http://$HOSTNAME.local:8091${NC}"
echo "   ${BLUE}http://$IP_ADDRESS:8091${NC}"
echo ""
echo "4. Check service status:"
echo "   ${YELLOW}sudo systemctl status light-engine-charlie.service${NC}"
echo ""
echo "5. View logs:"
echo "   ${YELLOW}journalctl -u light-engine-charlie.service -f${NC}"
echo ""
echo "6. Update deployment:"
echo "   ${YELLOW}cd $PROJECT_DIR && git pull && npm install && pip3 install -r requirements.txt${NC}"
echo "   ${YELLOW}sudo systemctl restart light-engine-charlie.service light-engine-python.service${NC}"
echo ""
echo -e "${GREEN}For detailed documentation, see:${NC}"
echo "   ${BLUE}$PROJECT_DIR/docs/PI_DEPLOYMENT_GUIDE.md${NC}"
echo ""
echo -e "${GREEN}Happy farming! 🌱${NC}"
echo ""
