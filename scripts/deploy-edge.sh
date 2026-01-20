#!/bin/bash

# Light Engine Foxtrot - Edge Device Deployment Script
# Automated deployment with validation, rollback, and verification
# Usage: ./scripts/deploy-edge.sh <edge-host> [options]
#
# Examples:
#   ./scripts/deploy-edge.sh greenreach@192.168.2.222
#   ./scripts/deploy-edge.sh greenreach@192.168.2.222 --skip-tests
#   ./scripts/deploy-edge.sh greenreach@192.168.2.222 --rollback

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DEPLOYMENT_LOG="/tmp/edge-deploy-${TIMESTAMP}.log"

# Options
SKIP_TESTS=false
ROLLBACK=false
EDGE_HOST=""
REMOTE_DIR="Light-Engine-Foxtrot"

# ==============================================================================
# Functions
# ==============================================================================

log() {
    echo -e "${GREEN}[$(date +'%H:%M:%S')]${NC} $1" | tee -a "$DEPLOYMENT_LOG"
}

log_warn() {
    echo -e "${YELLOW}[$(date +'%H:%M:%S')] ⚠️  $1${NC}" | tee -a "$DEPLOYMENT_LOG"
}

log_error() {
    echo -e "${RED}[$(date +'%H:%M:%S')] ❌ $1${NC}" | tee -a "$DEPLOYMENT_LOG"
}

log_step() {
    echo -e "\n${BLUE}[$(date +'%H:%M:%S')] ═══ $1 ═══${NC}" | tee -a "$DEPLOYMENT_LOG"
}

show_banner() {
    echo -e "${BLUE}"
    cat << "EOF"
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   Light Engine Foxtrot - Edge Device Deployment          ║
║   Automated deployment with validation & rollback        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
}

show_usage() {
    cat << EOF
Usage: $0 <edge-host> [options]

Arguments:
  edge-host         SSH connection string (e.g., greenreach@192.168.2.222)

Options:
  --skip-tests      Skip pre-flight validation tests
  --rollback        Rollback to previous deployment
  -h, --help        Show this help message

Examples:
  $0 greenreach@192.168.2.222
  $0 greenreach@192.168.2.222 --skip-tests
  $0 greenreach@192.168.2.222 --rollback

EOF
    exit 0
}

# Parse command line arguments
parse_args() {
    if [ $# -eq 0 ]; then
        show_usage
    fi

    EDGE_HOST="$1"
    shift

    while [ $# -gt 0 ]; do
        case "$1" in
            --skip-tests)
                SKIP_TESTS=true
                ;;
            --rollback)
                ROLLBACK=true
                ;;
            -h|--help)
                show_usage
                ;;
            *)
                log_error "Unknown option: $1"
                show_usage
                ;;
        esac
        shift
    done
}

# Check SSH connectivity
check_ssh_connection() {
    log_step "Checking SSH Connection"
    
    if ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no "$EDGE_HOST" "echo 'Connection OK'" > /dev/null 2>&1; then
        log "✅ SSH connection successful"
        return 0
    else
        log_error "Cannot connect to $EDGE_HOST"
        log_error "Please check:"
        log_error "  1. Device is powered on and connected to network"
        log_error "  2. SSH access is configured"
        log_error "  3. Hostname/IP is correct"
        exit 1
    fi
}

# Get current deployment version on edge
get_edge_version() {
    log_step "Getting Edge Device Version"
    
    EDGE_VERSION=$(ssh -o StrictHostKeyChecking=no "$EDGE_HOST" \
        "cd ~/$REMOTE_DIR && git rev-parse --short HEAD 2>/dev/null || echo 'unknown'")
    
    log "Current edge version: $EDGE_VERSION"
    echo "$EDGE_VERSION"
}

# Get local version
get_local_version() {
    LOCAL_VERSION=$(cd "$PROJECT_DIR" && git rev-parse --short HEAD)
    log "Local version: $LOCAL_VERSION"
    echo "$LOCAL_VERSION"
}

# Pre-flight checks
preflight_checks() {
    log_step "Pre-flight Checks"
    
    # Check git status
    cd "$PROJECT_DIR"
    if [ -n "$(git status --porcelain)" ]; then
        log_warn "Working directory has uncommitted changes"
        git status --short
        read -p "Continue anyway? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    else
        log "✅ Git working directory is clean"
    fi
    
    # Check Node.js syntax
    if [ "$SKIP_TESTS" = false ]; then
        log "Checking JavaScript syntax..."
        
        if command -v node >/dev/null 2>&1; then
            # Check main server file
            if node --check server-foxtrot.js 2>/dev/null; then
                log "✅ server-foxtrot.js syntax OK"
            else
                log_error "Syntax error in server-foxtrot.js"
                exit 1
            fi
        else
            log_warn "Node.js not found, skipping syntax check"
        fi
    else
        log "⏭️  Skipping tests (--skip-tests)"
    fi
    
    # Check critical files exist
    log "Checking critical files..."
    local missing_files=()
    
    for file in "server-foxtrot.js" "package.json" "public/LE-dashboard.html"; do
        if [ ! -f "$file" ]; then
            missing_files+=("$file")
        fi
    done
    
    if [ ${#missing_files[@]} -gt 0 ]; then
        log_error "Missing critical files:"
        for file in "${missing_files[@]}"; do
            log_error "  - $file"
        done
        exit 1
    fi
    
    log "✅ All critical files present"
}

# Create backup on edge device
create_backup() {
    log_step "Creating Backup on Edge Device"
    
    BACKUP_DIR="Light-Engine-Foxtrot-backup-${TIMESTAMP}"
    
    ssh -o StrictHostKeyChecking=no "$EDGE_HOST" bash << EOF
        cd ~
        if [ -d "$REMOTE_DIR" ]; then
            echo "Creating backup: $BACKUP_DIR (excluding node_modules)"
            # Use rsync to exclude large directories
            rsync -a --exclude 'node_modules' --exclude 'venv' --exclude '__pycache__' \
                "$REMOTE_DIR/" "$BACKUP_DIR/"
            echo "✅ Backup created successfully"
        else
            echo "⚠️  No existing installation to backup"
        fi
EOF
    
    log "✅ Backup created: ~/$BACKUP_DIR"
}

# Deploy code to edge device
deploy_code() {
    log_step "Deploying Code to Edge Device"
    
    # Files/directories to exclude
    RSYNC_EXCLUDES=(
        --exclude 'node_modules'
        --exclude 'venv'
        --exclude '.venv'
        --exclude '__pycache__'
        --exclude '.git'
        --exclude '.env'
        --exclude '.env.local'
        --exclude '*.log'
        --exclude 'nohup.out'
        --exclude 'backups/'
        --exclude '.DS_Store'
        --exclude 'greenreach-central/'
        --exclude '*.db'
        --exclude 'public/data/env.json'
        --exclude 'public/data/farm.json'
        --exclude 'public/data/rooms.json'
        --exclude 'public/data/schedules.json'
        --exclude 'public/data/groups.json'
        --exclude 'public/data/room-map*.json'
        --exclude 'public/data/env-cache.json'
        --exclude 'public/data/*backup*'
    )
    
    log "Syncing files to edge device..."
    
    if rsync -avz --delete \
        "${RSYNC_EXCLUDES[@]}" \
        "$PROJECT_DIR/" \
        "$EDGE_HOST:~/$REMOTE_DIR/" 2>&1 | tee -a "$DEPLOYMENT_LOG"; then
        log "✅ Code sync completed"
    else
        log_error "rsync failed"
        exit 1
    fi
}

# Install dependencies on edge device
install_dependencies() {
    log_step "Installing Dependencies"
    
    ssh -o StrictHostKeyChecking=no "$EDGE_HOST" bash << 'EOF'
        cd ~/Light-Engine-Foxtrot
        
        # Check if package.json changed
        if [ -f "package.json" ]; then
            echo "📦 Installing Node.js dependencies..."
            npm install --production 2>&1 | tail -20
            echo "✅ Dependencies installed"
        fi
EOF
}

# Restart services
restart_services() {
    log_step "Restarting Services"
    
    ssh -o StrictHostKeyChecking=no "$EDGE_HOST" bash << 'EOF'
        cd ~/Light-Engine-Foxtrot
        
        # Check if PM2 is installed
        if command -v pm2 >/dev/null 2>&1; then
            echo "🔄 Restarting PM2 services..."
            pm2 restart all
            echo "✅ Services restarted"
            
            # Save PM2 configuration
            pm2 save
        else
            echo "⚠️  PM2 not found, skipping service restart"
        fi
EOF
    
    log "✅ Services restarted"
}

# Verify deployment
verify_deployment() {
    log_step "Verifying Deployment"
    
    log "Waiting 5 seconds for services to start..."
    sleep 5
    
    # Check health endpoint
    log "Checking health endpoint..."
    
    HEALTH_CHECK=$(ssh -o StrictHostKeyChecking=no "$EDGE_HOST" \
        "curl -sf http://localhost:8091/health 2>/dev/null || echo 'FAILED'")
    
    if [ "$HEALTH_CHECK" = "FAILED" ]; then
        log_error "Health check failed"
        return 1
    fi
    
    # Parse health status
    HEALTH_STATUS=$(echo "$HEALTH_CHECK" | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
    
    if [ "$HEALTH_STATUS" = "healthy" ]; then
        log "✅ Health check passed: $HEALTH_STATUS"
    else
        log_error "Health check returned: $HEALTH_STATUS"
        return 1
    fi
    
    # Check PM2 status
    log "Checking PM2 services..."
    
    PM2_STATUS=$(ssh -o StrictHostKeyChecking=no "$EDGE_HOST" \
        "pm2 jlist 2>/dev/null | grep -c '\"status\":\"online\"' || echo '0'")
    
    if [ "$PM2_STATUS" -gt 0 ]; then
        log "✅ PM2 services online: $PM2_STATUS"
    else
        log_error "No PM2 services online"
        return 1
    fi
    
    return 0
}

# Rollback deployment
rollback_deployment() {
    log_step "Rolling Back to Previous Version"
    
    # Find most recent backup
    LATEST_BACKUP=$(ssh -o StrictHostKeyChecking=no "$EDGE_HOST" \
        "ls -t ~/Light-Engine-Foxtrot-backup-* 2>/dev/null | head -1 || echo ''")
    
    if [ -z "$LATEST_BACKUP" ]; then
        log_error "No backup found to rollback to"
        exit 1
    fi
    
    log "Found backup: $LATEST_BACKUP"
    
    ssh -o StrictHostKeyChecking=no "$EDGE_HOST" bash << EOF
        cd ~
        
        # Remove current deployment
        rm -rf "$REMOTE_DIR"
        
        # Restore backup
        cp -a "$LATEST_BACKUP" "$REMOTE_DIR"
        
        echo "✅ Backup restored"
EOF
    
    # Restart services
    restart_services
    
    # Verify
    if verify_deployment; then
        log "✅ Rollback successful"
    else
        log_error "Rollback verification failed"
        exit 1
    fi
}

# Log deployment metadata
log_deployment() {
    log_step "Logging Deployment"
    
    LOCAL_VERSION=$(get_local_version)
    
    ssh -o StrictHostKeyChecking=no "$EDGE_HOST" bash << EOF
        cd ~/$REMOTE_DIR
        
        # Create deployment log file if it doesn't exist
        mkdir -p logs
        
        # Append deployment record
        cat >> logs/deployments.log << DEPLOY_EOF
========================================
Deployment: ${TIMESTAMP}
Version: ${LOCAL_VERSION}
Deployed by: $(whoami)@$(hostname)
Status: SUCCESS
========================================
DEPLOY_EOF

        echo "✅ Deployment logged"
EOF
}

# Show deployment summary
show_summary() {
    log_step "Deployment Summary"
    
    EDGE_VERSION=$(get_edge_version)
    
    echo -e "${GREEN}"
    cat << EOF

╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║                  ✅ DEPLOYMENT SUCCESSFUL                 ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝

  Edge Device: $EDGE_HOST
  Version: $EDGE_VERSION
  Timestamp: $TIMESTAMP
  
  Deployment log: $DEPLOYMENT_LOG

Next steps:
  1. Monitor logs: ssh $EDGE_HOST "pm2 logs"
  2. Check dashboard: http://<edge-ip>:8091
  3. Review health: ssh $EDGE_HOST "curl localhost:8091/health"

EOF
    echo -e "${NC}"
}

# ==============================================================================
# Main Execution
# ==============================================================================

main() {
    show_banner
    parse_args "$@"
    
    log "Deployment log: $DEPLOYMENT_LOG"
    log "Target: $EDGE_HOST"
    
    # Handle rollback
    if [ "$ROLLBACK" = true ]; then
        check_ssh_connection
        rollback_deployment
        show_summary
        exit 0
    fi
    
    # Normal deployment flow
    check_ssh_connection
    
    EDGE_VERSION_BEFORE=$(get_edge_version)
    LOCAL_VERSION=$(get_local_version)
    
    if [ "$EDGE_VERSION_BEFORE" = "$LOCAL_VERSION" ]; then
        log_warn "Edge device already at version $LOCAL_VERSION"
        read -p "Redeploy anyway? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 0
        fi
    fi
    
    preflight_checks
    create_backup
    deploy_code
    install_dependencies
    restart_services
    
    # Verify deployment
    if verify_deployment; then
        log_deployment
        show_summary
        exit 0
    else
        log_error "Deployment verification failed"
        log_warn "Initiating automatic rollback..."
        rollback_deployment
        exit 1
    fi
}

# Run main function
main "$@"
