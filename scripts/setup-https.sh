#!/bin/bash
#
# Light Engine - HTTPS Setup Script
# Version: 1.0
# Date: 2025-12-07
#
# This script automates the HTTPS setup process with Let's Encrypt
# 
# Usage:
#   ./setup-https.sh yourdomain.com your-email@example.com
#
# Requirements:
#   - Ubuntu/Debian Linux
#   - sudo privileges
#   - Domain pointing to this server's IP
#   - Ports 80 and 443 accessible

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_root() {
    if [[ $EUID -eq 0 ]]; then
        log_error "This script should not be run as root. Please run as regular user with sudo privileges."
        exit 1
    fi
}

check_args() {
    if [ $# -lt 2 ]; then
        log_error "Usage: $0 <domain> <email>"
        echo "Example: $0 lightengine.example.com admin@example.com"
        exit 1
    fi
}

check_domain_dns() {
    local domain=$1
    log_info "Checking DNS resolution for $domain..."
    
    if ! host "$domain" > /dev/null 2>&1; then
        log_error "Domain $domain does not resolve. Please configure DNS first."
        exit 1
    fi
    
    local server_ip=$(curl -s ifconfig.me)
    local domain_ip=$(dig +short "$domain" | tail -n1)
    
    if [ "$server_ip" != "$domain_ip" ]; then
        log_warn "Domain $domain resolves to $domain_ip, but server IP is $server_ip"
        read -p "Continue anyway? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    else
        log_info "DNS correctly configured: $domain → $server_ip"
    fi
}

check_ports() {
    log_info "Checking port availability..."
    
    if sudo lsof -i :80 > /dev/null 2>&1; then
        log_warn "Port 80 is already in use. nginx may already be running."
    fi
    
    if sudo lsof -i :443 > /dev/null 2>&1; then
        log_warn "Port 443 is already in use."
    fi
}

install_dependencies() {
    log_info "Installing nginx and certbot..."
    
    sudo apt update -qq
    sudo apt install -y nginx certbot python3-certbot-nginx
    
    log_info "Dependencies installed successfully"
}

backup_existing_config() {
    if [ -f /etc/nginx/sites-enabled/default ]; then
        log_info "Backing up existing nginx config..."
        sudo cp /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/default.backup
    fi
}

configure_nginx() {
    local domain=$1
    log_info "Configuring nginx for $domain..."
    
    # Copy nginx config from project
    local config_source="$(dirname "$0")/../config/nginx/lightengine.conf"
    local config_dest="/etc/nginx/sites-available/lightengine"
    
    if [ -f "$config_source" ]; then
        sudo cp "$config_source" "$config_dest"
        # Replace domain placeholder
        sudo sed -i "s/lightengine.example.com/$domain/g" "$config_dest"
        log_info "nginx config copied and updated"
    else
        log_error "nginx config not found at $config_source"
        exit 1
    fi
    
    # Enable site
    if [ ! -L /etc/nginx/sites-enabled/lightengine ]; then
        sudo ln -s /etc/nginx/sites-available/lightengine /etc/nginx/sites-enabled/
        log_info "Site enabled"
    fi
    
    # Disable default site
    if [ -L /etc/nginx/sites-enabled/default ]; then
        sudo rm /etc/nginx/sites-enabled/default
        log_info "Default site disabled"
    fi
    
    # Test nginx config
    if sudo nginx -t; then
        log_info "nginx configuration valid"
    else
        log_error "nginx configuration test failed"
        exit 1
    fi
    
    # Restart nginx
    sudo systemctl restart nginx
    log_info "nginx restarted"
}

obtain_ssl_certificate() {
    local domain=$1
    local email=$2
    
    log_info "Obtaining SSL certificate from Let's Encrypt..."
    log_warn "This will modify your nginx configuration"
    
    # Run certbot
    sudo certbot --nginx \
        -d "$domain" \
        -d "www.$domain" \
        --non-interactive \
        --agree-tos \
        --email "$email" \
        --redirect
    
    if [ $? -eq 0 ]; then
        log_info "SSL certificate obtained successfully"
    else
        log_error "Failed to obtain SSL certificate"
        exit 1
    fi
}

verify_ssl() {
    local domain=$1
    log_info "Verifying SSL configuration..."
    
    # Test HTTPS
    if curl -sS "https://$domain" > /dev/null; then
        log_info "HTTPS is working correctly"
    else
        log_warn "HTTPS test failed, but certificate may still be valid"
    fi
    
    # Show certificate info
    log_info "Certificate information:"
    sudo certbot certificates | grep -A 10 "$domain"
}

setup_auto_renewal() {
    log_info "Configuring automatic certificate renewal..."
    
    # Certbot installs systemd timer by default
    if sudo systemctl is-enabled certbot.timer > /dev/null 2>&1; then
        log_info "Certbot auto-renewal timer is already enabled"
    else
        sudo systemctl enable certbot.timer
        sudo systemctl start certbot.timer
        log_info "Certbot auto-renewal timer enabled"
    fi
    
    # Test renewal (dry-run)
    log_info "Testing certificate renewal..."
    if sudo certbot renew --dry-run; then
        log_info "Certificate renewal test passed"
    else
        log_warn "Certificate renewal test failed - check logs"
    fi
}

update_env_files() {
    local domain=$1
    log_info "Updating environment files..."
    
    local project_root="$(dirname "$0")/.."
    
    # Update backend .env
    if [ -f "$project_root/.env" ]; then
        if ! grep -q "APP_URL=https://$domain" "$project_root/.env"; then
            echo "" >> "$project_root/.env"
            echo "# HTTPS Configuration (added by setup-https.sh)" >> "$project_root/.env"
            echo "APP_URL=https://$domain" >> "$project_root/.env"
            echo "ALLOWED_ORIGINS=https://$domain,https://www.$domain" >> "$project_root/.env"
            echo "USE_FORWARDED_HEADERS=true" >> "$project_root/.env"
            log_info "Backend .env updated"
        else
            log_warn "Backend .env already contains HTTPS configuration"
        fi
    else
        log_warn "Backend .env not found at $project_root/.env"
    fi
}

firewall_config() {
    log_info "Checking firewall configuration..."
    
    if command -v ufw > /dev/null 2>&1; then
        if sudo ufw status | grep -q "Status: active"; then
            log_info "UFW firewall is active, configuring..."
            sudo ufw allow 'Nginx Full'
            sudo ufw delete allow 'Nginx HTTP' 2>/dev/null || true
            log_info "Firewall rules updated"
        fi
    else
        log_warn "UFW firewall not detected, skipping firewall configuration"
    fi
}

print_summary() {
    local domain=$1
    echo ""
    echo "=========================================="
    log_info "HTTPS Setup Complete!"
    echo "=========================================="
    echo ""
    echo "Your site is now accessible at:"
    echo "  https://$domain"
    echo "  https://www.$domain"
    echo ""
    echo "Certificate details:"
    sudo certbot certificates | grep -A 5 "$domain" || true
    echo ""
    echo "Next steps:"
    echo "  1. Update your application to use HTTPS URLs"
    echo "  2. Test all endpoints with HTTPS"
    echo "  3. Run SSL Labs test: https://www.ssllabs.com/ssltest/analyze.html?d=$domain"
    echo "  4. Monitor certificate expiration (auto-renewal enabled)"
    echo ""
    echo "Useful commands:"
    echo "  sudo systemctl status nginx        # Check nginx status"
    echo "  sudo certbot certificates          # View certificates"
    echo "  sudo certbot renew                 # Manual renewal"
    echo "  sudo nginx -t                      # Test config"
    echo ""
}

# Main execution
main() {
    local domain=$1
    local email=$2
    
    echo "=========================================="
    echo "Light Engine - HTTPS Setup"
    echo "=========================================="
    echo ""
    echo "Domain: $domain"
    echo "Email: $email"
    echo ""
    
    check_root
    check_args "$@"
    check_domain_dns "$domain"
    check_ports
    
    read -p "Continue with HTTPS setup? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Setup cancelled"
        exit 0
    fi
    
    install_dependencies
    backup_existing_config
    configure_nginx "$domain"
    obtain_ssl_certificate "$domain" "$email"
    verify_ssl "$domain"
    setup_auto_renewal
    update_env_files "$domain"
    firewall_config
    
    print_summary "$domain"
}

# Run main function with all arguments
main "$@"
