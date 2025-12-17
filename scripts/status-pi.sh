#!/bin/bash

# Light Engine Charlie - Status Check Script
# Quick health check for services and system

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Light Engine Charlie - Status Check                   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Function to print status with color
print_status() {
    if [ "$1" = "active" ]; then
        echo -e "${GREEN}✅ Running${NC}"
    elif [ "$1" = "inactive" ]; then
        echo -e "${YELLOW}⚠️  Stopped${NC}"
    elif [ "$1" = "failed" ]; then
        echo -e "${RED}❌ Failed${NC}"
    else
        echo -e "${YELLOW}⚠️  Unknown${NC}"
    fi
}

# System Information
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  System Information${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

if [ -f /proc/device-tree/model ]; then
    MODEL=$(cat /proc/device-tree/model)
    echo -e "Device: ${GREEN}$MODEL${NC}"
fi

echo -e "Hostname: ${GREEN}$(hostname)${NC}"
echo -e "IP Address: ${GREEN}$(hostname -I | awk '{print $1}')${NC}"
echo -e "Uptime: ${GREEN}$(uptime -p)${NC}"

# CPU and Memory
CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)
MEM_USAGE=$(free | grep Mem | awk '{printf "%.1f", $3/$2 * 100.0}')
DISK_USAGE=$(df -h / | tail -1 | awk '{print $5}')

echo -e "CPU Usage: ${GREEN}${CPU_USAGE}%${NC}"
echo -e "Memory Usage: ${GREEN}${MEM_USAGE}%${NC}"
echo -e "Disk Usage: ${GREEN}${DISK_USAGE}${NC}"

# Temperature (if available)
if [ -f /sys/class/thermal/thermal_zone0/temp ]; then
    TEMP=$(cat /sys/class/thermal/thermal_zone0/temp)
    TEMP_C=$(echo "scale=1; $TEMP/1000" | bc)
    echo -e "Temperature: ${GREEN}${TEMP_C}°C${NC}"
fi

echo ""

# Service Status
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Service Status${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Check Node.js service
NODE_STATUS=$(systemctl is-active light-engine-charlie.service 2>/dev/null || echo "not-found")
echo -n "Node.js Server (port 8091): "
print_status "$NODE_STATUS"

if [ "$NODE_STATUS" = "active" ]; then
    NODE_PID=$(systemctl show -p MainPID light-engine-charlie.service | cut -d= -f2)
    if [ "$NODE_PID" != "0" ]; then
        NODE_MEM=$(ps -p $NODE_PID -o rss= | awk '{printf "%.1f MB", $1/1024}')
        echo -e "  PID: ${BLUE}$NODE_PID${NC}  Memory: ${BLUE}$NODE_MEM${NC}"
    fi
fi

# Check Python service
PYTHON_STATUS=$(systemctl is-active light-engine-python.service 2>/dev/null || echo "not-found")
echo -n "Python Backend (port 8000): "
print_status "$PYTHON_STATUS"

if [ "$PYTHON_STATUS" = "active" ]; then
    PYTHON_PID=$(systemctl show -p MainPID light-engine-python.service | cut -d= -f2)
    if [ "$PYTHON_PID" != "0" ]; then
        PYTHON_MEM=$(ps -p $PYTHON_PID -o rss= | awk '{printf "%.1f MB", $1/1024}')
        echo -e "  PID: ${BLUE}$PYTHON_PID${NC}  Memory: ${BLUE}$PYTHON_MEM${NC}"
    fi
fi

echo ""

# Port Status
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Port Status${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

PORT_8091=$(ss -tuln | grep -c ":8091 " || echo "0")
PORT_8000=$(ss -tuln | grep -c ":8000 " || echo "0")

if [ "$PORT_8091" -gt 0 ]; then
    echo -e "Port 8091 (Node.js): ${GREEN}✅ Open${NC}"
else
    echo -e "Port 8091 (Node.js): ${RED}❌ Closed${NC}"
fi

if [ "$PORT_8000" -gt 0 ]; then
    echo -e "Port 8000 (Python): ${GREEN}✅ Open${NC}"
else
    echo -e "Port 8000 (Python): ${RED}❌ Closed${NC}"
fi

echo ""

# Network Connectivity
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Network Connectivity${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Check internet
if ping -c 1 8.8.8.8 &> /dev/null; then
    echo -e "Internet: ${GREEN}✅ Connected${NC}"
else
    echo -e "Internet: ${RED}❌ Disconnected${NC}"
fi

# Check local API
IP=$(hostname -I | awk '{print $1}')
if curl -s -o /dev/null -w "%{http_code}" http://localhost:8091 | grep -q "200\|301\|302"; then
    echo -e "Local API (8091): ${GREEN}✅ Responding${NC}"
    echo -e "Dashboard: ${BLUE}http://$(hostname).local:8091${NC}"
    echo -e "           ${BLUE}http://$IP:8091${NC}"
else
    echo -e "Local API (8091): ${RED}❌ Not responding${NC}"
fi

echo ""

# Recent Errors
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Recent Errors (last 10)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Check Node.js errors
NODE_ERRORS=$(journalctl -u light-engine-charlie.service --since "1 hour ago" --priority=err --no-pager -n 5 2>/dev/null | grep -v "^--" | wc -l)
if [ "$NODE_ERRORS" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Node.js service has $NODE_ERRORS error(s) in the last hour${NC}"
    journalctl -u light-engine-charlie.service --since "1 hour ago" --priority=err --no-pager -n 5 2>/dev/null | grep -v "^--" | tail -3
else
    echo -e "${GREEN}✅ No Node.js errors in the last hour${NC}"
fi

# Check Python errors
PYTHON_ERRORS=$(journalctl -u light-engine-python.service --since "1 hour ago" --priority=err --no-pager -n 5 2>/dev/null | grep -v "^--" | wc -l)
if [ "$PYTHON_ERRORS" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Python service has $PYTHON_ERRORS error(s) in the last hour${NC}"
    journalctl -u light-engine-python.service --since "1 hour ago" --priority=err --no-pager -n 5 2>/dev/null | grep -v "^--" | tail -3
else
    echo -e "${GREEN}✅ No Python errors in the last hour${NC}"
fi

echo ""

# Disk Space Warning
DISK_PERCENT=$(df -h / | tail -1 | awk '{print $5}' | sed 's/%//')
if [ "$DISK_PERCENT" -gt 90 ]; then
    echo -e "${RED}⚠️  WARNING: Disk usage is above 90%!${NC}"
    echo ""
fi

# Quick Actions
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Quick Actions${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "View logs:"
echo "  ${YELLOW}journalctl -u light-engine-charlie.service -f${NC}"
echo "  ${YELLOW}journalctl -u light-engine-python.service -f${NC}"
echo ""
echo "Restart services:"
echo "  ${YELLOW}sudo systemctl restart light-engine-charlie.service${NC}"
echo "  ${YELLOW}sudo systemctl restart light-engine-python.service${NC}"
echo ""
echo "Update code:"
echo "  ${YELLOW}$SCRIPT_DIR/update-pi.sh${NC}"
echo ""
