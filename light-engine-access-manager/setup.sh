#!/bin/bash
# ============================================================================
# LEAM Setup — Install as macOS Launch Agent (auto-start on login)
# ============================================================================
# This script:
#   1. Installs npm dependencies
#   2. Creates a .env file (if missing) for farm credentials
#   3. Installs a macOS Launch Agent so LEAM starts automatically on login
#   4. Starts LEAM immediately
#
# Usage:
#   chmod +x setup.sh && ./setup.sh
#
# To uninstall:
#   ./setup.sh --uninstall
# ============================================================================

set -e

LEAM_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_NAME="com.greenreach.leam"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
LOG_DIR="$HOME/Library/Logs/LEAM"
NODE_PATH="$(which node)"
ENV_FILE="$LEAM_DIR/.env"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[LEAM]${NC} $1"; }
warn()  { echo -e "${YELLOW}[LEAM]${NC} $1"; }
error() { echo -e "${RED}[LEAM]${NC} $1"; }

# ── Uninstall ──────────────────────────────────────────────────────────
if [ "$1" = "--uninstall" ]; then
  info "Uninstalling LEAM Launch Agent..."
  if launchctl list | grep -q "$PLIST_NAME" 2>/dev/null; then
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    launchctl bootout "gui/$(id -u)/$PLIST_NAME" 2>/dev/null || true
  fi
  rm -f "$PLIST_PATH"
  info "Launch Agent removed. LEAM will no longer auto-start."
  info "To fully remove, delete: $LEAM_DIR"
  exit 0
fi

echo ""
echo "  Light Engine Access Manager (LEAM) Setup"
echo "  ========================================="
echo ""

# ── Step 1: Check prerequisites ───────────────────────────────────────
if ! command -v node &>/dev/null; then
  error "Node.js not found. Install from https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  error "Node.js 18+ required (found: $(node -v))"
  exit 1
fi

info "Node.js: $(node -v) at $NODE_PATH"

# ── Step 2: Install dependencies ──────────────────────────────────────
info "Installing dependencies..."
cd "$LEAM_DIR"
npm install --production 2>&1 | tail -3

# ── Step 3: Create .env if needed ─────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  cp "$LEAM_DIR/.env.example" "$ENV_FILE"
  warn ".env file created at: $ENV_FILE"
  warn "You MUST edit .env and add your FARM_TOKEN before LEAM can connect."
  echo ""
  echo "  To get your farm token:"
  echo "    1. Log into greenreachgreens.com"
  echo "    2. Open browser dev tools (F12) -> Application -> Cookies"
  echo "    3. Copy the 'token' value"
  echo "    4. Paste into $ENV_FILE as FARM_TOKEN=<token>"
  echo ""
  read -p "  Press Enter after editing .env (or Ctrl+C to set up later)... "
fi

# ── Step 4: Create log directory ──────────────────────────────────────
mkdir -p "$LOG_DIR"

# ── Step 5: Install Launch Agent ──────────────────────────────────────
info "Installing macOS Launch Agent..."

mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${LEAM_DIR}/index.js</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${LEAM_DIR}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>${LOG_DIR}/leam.log</string>

    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/leam-error.log</string>

    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
PLIST

info "Launch Agent installed at: $PLIST_PATH"

# ── Step 6: Load and start ────────────────────────────────────────────
# Unload first if already loaded
if launchctl list | grep -q "$PLIST_NAME" 2>/dev/null; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

launchctl load "$PLIST_PATH"
info "LEAM started via Launch Agent"

# Verify
sleep 2
if launchctl list | grep -q "$PLIST_NAME"; then
  info "LEAM is running. It will auto-start on every login."
else
  warn "LEAM may not have started correctly. Check logs:"
  warn "  tail -f $LOG_DIR/leam.log"
fi

echo ""
info "Setup complete."
echo ""
echo "  Useful commands:"
echo "    View logs:     tail -f ~/Library/Logs/LEAM/leam.log"
echo "    Stop LEAM:     launchctl unload $PLIST_PATH"
echo "    Start LEAM:    launchctl load $PLIST_PATH"
echo "    Uninstall:     ./setup.sh --uninstall"
echo ""
