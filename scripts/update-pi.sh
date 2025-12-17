#!/bin/bash

# Light Engine Charlie - Quick Update Script for Raspberry Pi
# Pulls latest code and restarts services

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Light Engine Charlie - Quick Update                   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

cd "$PROJECT_DIR"

# Check git status
echo -e "${BLUE}📊 Current branch:${NC}"
git branch --show-current

echo ""
echo -e "${BLUE}📊 Current commit:${NC}"
git log -1 --oneline

echo ""
read -p "Continue with update? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}⚠️  Update cancelled${NC}"
    exit 0
fi

# Stash any local changes
echo -e "${BLUE}💾 Checking for local changes...${NC}"
if ! git diff-index --quiet HEAD --; then
    echo -e "${YELLOW}⚠️  Local changes detected, stashing...${NC}"
    git stash
    STASHED=true
else
    echo -e "${GREEN}✅ No local changes${NC}"
    STASHED=false
fi

# Pull latest changes
echo -e "${BLUE}📥 Pulling latest changes...${NC}"
git pull

# Check if there were updates
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Code updated successfully${NC}"
else
    echo -e "${RED}❌ Git pull failed${NC}"
    if [ "$STASHED" = true ]; then
        echo -e "${YELLOW}⚠️  Restoring stashed changes...${NC}"
        git stash pop
    fi
    exit 1
fi

# Install/update dependencies
echo ""
echo -e "${BLUE}📦 Updating Node.js dependencies...${NC}"
npm install

echo ""
echo -e "${BLUE}📦 Updating Python dependencies...${NC}"
pip3 install -r requirements.txt

# Check if services are running
NODE_SERVICE_RUNNING=$(systemctl is-active light-engine-charlie.service 2>/dev/null || echo "inactive")
PYTHON_SERVICE_RUNNING=$(systemctl is-active light-engine-python.service 2>/dev/null || echo "inactive")

if [ "$NODE_SERVICE_RUNNING" = "active" ] || [ "$PYTHON_SERVICE_RUNNING" = "active" ]; then
    echo ""
    echo -e "${BLUE}🔄 Restarting services...${NC}"
    
    if [ "$NODE_SERVICE_RUNNING" = "active" ]; then
        sudo systemctl restart light-engine-charlie.service
        echo -e "${GREEN}✅ Node.js service restarted${NC}"
    fi
    
    if [ "$PYTHON_SERVICE_RUNNING" = "active" ]; then
        sudo systemctl restart light-engine-python.service
        echo -e "${GREEN}✅ Python service restarted${NC}"
    fi
    
    # Wait for services to start
    sleep 3
    
    # Check service status
    echo ""
    echo -e "${BLUE}📊 Service Status:${NC}"
    echo ""
    
    if [ "$NODE_SERVICE_RUNNING" = "active" ]; then
        sudo systemctl status light-engine-charlie.service --no-pager -l | head -20
    fi
    
    echo ""
    
    if [ "$PYTHON_SERVICE_RUNNING" = "active" ]; then
        sudo systemctl status light-engine-python.service --no-pager -l | head -20
    fi
else
    echo ""
    echo -e "${YELLOW}⚠️  No services running. Start them with:${NC}"
    echo -e "${YELLOW}    sudo systemctl start light-engine-charlie.service${NC}"
    echo -e "${YELLOW}    sudo systemctl start light-engine-python.service${NC}"
fi

# Restore stashed changes if any
if [ "$STASHED" = true ]; then
    echo ""
    echo -e "${YELLOW}⚠️  Restoring your local changes...${NC}"
    git stash pop
fi

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     ✅ Update Complete!                                     ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Show current commit
echo -e "${BLUE}📊 Updated to:${NC}"
git log -1 --oneline

echo ""
echo -e "${BLUE}📍 Access dashboard:${NC}"
IP_ADDRESS=$(hostname -I | awk '{print $1}')
HOSTNAME=$(hostname)
echo "   ${GREEN}http://$HOSTNAME.local:8091${NC}"
echo "   ${GREEN}http://$IP_ADDRESS:8091${NC}"

echo ""
echo -e "${BLUE}📋 View logs:${NC}"
echo "   ${YELLOW}journalctl -u light-engine-charlie.service -f${NC}"
echo "   ${YELLOW}tail -f $PROJECT_DIR/logs/node-server.log${NC}"

echo ""
