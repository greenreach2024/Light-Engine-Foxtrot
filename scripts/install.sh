#!/bin/bash
# Light Engine Foxtrot - Edge Device One-Line Installer
# Usage: curl -sSL https://install.greenreach.io | bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="/opt/lightengine"
SERVICE_NAME="lightengine"
INSTALL_SERVER="https://install.greenreach.io"
PUBLIC_KEY_URL="${INSTALL_SERVER}/greenreach-public.pem"
MIN_DISK_GB=50
MIN_RAM_GB=4

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "This installer must be run as root. Try: sudo bash"
    fi
    log_info "Root privileges confirmed"
}

# Detect platform and architecture
detect_platform() {
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)
    
    case "$ARCH" in
        x86_64)
            ARCH="x64"
            ;;
        aarch64|arm64)
            ARCH="arm64"
            ;;
        *)
            log_error "Unsupported architecture: $ARCH. Supported: x86_64, arm64"
            ;;
    esac
    
    case "$OS" in
        linux)
            log_info "Detected: Linux $ARCH"
            ;;
        *)
            log_error "Unsupported OS: $OS. Only Linux is supported for edge devices."
            ;;
    esac
    
    PLATFORM="${OS}-${ARCH}"
    BINARY_URL="${INSTALL_SERVER}/lightengine-${PLATFORM}"
    CHECKSUM_URL="${BINARY_URL}.sha256"
}

# Check system requirements
check_requirements() {
    log_info "Checking system requirements..."
    
    # Check disk space
    DISK_GB=$(df -BG / | awk 'NR==2 {print $4}' | sed 's/G//')
    if [ "$DISK_GB" -lt "$MIN_DISK_GB" ]; then
        log_error "Insufficient disk space: ${DISK_GB}GB available, ${MIN_DISK_GB}GB required"
    fi
    log_info "Disk space: ${DISK_GB}GB available"
    
    # Check RAM
    RAM_GB=$(free -g | awk 'NR==2 {print $2}')
    if [ "$RAM_GB" -lt "$MIN_RAM_GB" ]; then
        log_warn "Low RAM: ${RAM_GB}GB available, ${MIN_RAM_GB}GB recommended"
    else
        log_info "RAM: ${RAM_GB}GB available"
    fi
    
    # Check required commands
    for cmd in curl systemctl; do
        if ! command -v $cmd &> /dev/null; then
            log_error "Required command not found: $cmd"
        fi
    done
    log_info "System requirements met"
}

# Download and verify binary
download_binary() {
    log_info "Downloading Light Engine binary..."
    
    # Create temporary directory
    TMP_DIR=$(mktemp -d)
    cd "$TMP_DIR"
    
    # Download binary
    if ! curl -sSLf -o lightengine "$BINARY_URL"; then
        log_error "Failed to download binary from $BINARY_URL"
    fi
    log_info "Binary downloaded"
    
    # Download checksum
    if ! curl -sSLf -o lightengine.sha256 "$CHECKSUM_URL"; then
        log_error "Failed to download checksum from $CHECKSUM_URL"
    fi
    
    # Verify checksum
    log_info "Verifying binary integrity..."
    EXPECTED_CHECKSUM=$(cat lightengine.sha256 | awk '{print $1}')
    ACTUAL_CHECKSUM=$(sha256sum lightengine | awk '{print $1}')
    
    if [ "$EXPECTED_CHECKSUM" != "$ACTUAL_CHECKSUM" ]; then
        log_error "Checksum verification failed! Binary may be corrupted or tampered."
    fi
    log_info "Binary integrity verified"
    
    # Download public key for license validation
    if ! curl -sSLf -o greenreach-public.pem "$PUBLIC_KEY_URL"; then
        log_warn "Failed to download public key - license validation may not work"
    fi
}

# Install binary and files
install_binary() {
    log_info "Installing Light Engine to $INSTALL_DIR..."
    
    # Create installation directory
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR/config"
    mkdir -p "$INSTALL_DIR/data"
    mkdir -p "$INSTALL_DIR/logs"
    
    # Move binary
    mv lightengine "$INSTALL_DIR/"
    chmod +x "$INSTALL_DIR/lightengine"
    
    # Move public key
    if [ -f greenreach-public.pem ]; then
        mv greenreach-public.pem "$INSTALL_DIR/config/"
    fi
    
    # Set ownership
    chown -R root:root "$INSTALL_DIR"
    chmod 755 "$INSTALL_DIR"
    
    log_info "Binary installed"
}

# Create systemd service
create_service() {
    log_info "Creating systemd service..."
    
    cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Light Engine Foxtrot - Vertical Farm Control System
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
ExecStart=${INSTALL_DIR}/lightengine
Restart=always
RestartSec=10
StandardOutput=append:${INSTALL_DIR}/logs/lightengine.log
StandardError=append:${INSTALL_DIR}/logs/lightengine-error.log

# Environment
Environment="NODE_ENV=production"
Environment="PORT=8091"
Environment="DEPLOYMENT_MODE=edge"
Environment="LICENSE_PATH=/etc/lightengine/license.json"
Environment="PUBLIC_KEY_PATH=${INSTALL_DIR}/config/greenreach-public.pem"

# Security
NoNewPrivileges=true
PrivateTmp=true

# Resource limits
LimitNOFILE=65536
MemoryMax=2G

[Install]
WantedBy=multi-user.target
EOF
    
    # Create license directory
    mkdir -p /etc/lightengine
    chmod 700 /etc/lightengine
    
    # Reload systemd
    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"
    
    log_info "Systemd service created and enabled"
}

# Configure static IP (optional)
configure_network() {
    log_info "Network configuration..."
    
    # Get primary interface
    PRIMARY_IFACE=$(ip route | grep default | awk '{print $5}' | head -n1)
    CURRENT_IP=$(ip addr show "$PRIMARY_IFACE" | grep "inet " | awk '{print $2}' | cut -d/ -f1)
    
    log_info "Primary interface: $PRIMARY_IFACE"
    log_info "Current IP: $CURRENT_IP"
    
    # Save network info for setup wizard
    cat > "$INSTALL_DIR/config/network-detected.json" <<EOF
{
  "interface": "$PRIMARY_IFACE",
  "currentIP": "$CURRENT_IP",
  "configured": false
}
EOF
    
    log_warn "Static IP configuration will be completed in the setup wizard"
}

# Cleanup
cleanup() {
    if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
        rm -rf "$TMP_DIR"
    fi
}

# Main installation flow
main() {
    log_info "Light Engine Foxtrot - Edge Device Installer"
    log_info "============================================="
    echo ""
    
    # Trap cleanup on exit
    trap cleanup EXIT
    
    # Run installation steps
    check_root
    detect_platform
    check_requirements
    download_binary
    install_binary
    create_service
    configure_network
    
    # Start service
    log_info "Starting Light Engine service..."
    systemctl start "$SERVICE_NAME"
    
    # Wait a moment for service to start
    sleep 3
    
    # Check service status
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        log_info "Service started successfully"
    else
        log_error "Service failed to start. Check logs: journalctl -u $SERVICE_NAME -n 50"
    fi
    
    echo ""
    log_info "============================================="
    log_info "Installation complete!"
    log_info "============================================="
    echo ""
    log_info "Next steps:"
    echo "  1. Open browser to http://${CURRENT_IP}:8091/setup-wizard.html"
    echo "  2. Enter activation code from GreenReach"
    echo "  3. Configure farm details and network"
    echo "  4. Complete setup wizard"
    echo ""
    log_info "Service management:"
    echo "  Status:  systemctl status $SERVICE_NAME"
    echo "  Logs:    journalctl -u $SERVICE_NAME -f"
    echo "  Restart: systemctl restart $SERVICE_NAME"
    echo "  Stop:    systemctl stop $SERVICE_NAME"
    echo ""
    log_info "Installation directory: $INSTALL_DIR"
    log_info "License location: /etc/lightengine/license.json"
    echo ""
}

# Run main installation
main
