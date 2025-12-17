#!/bin/bash
# ============================================================================
# Python Backend Startup Script
# ============================================================================
# Starts the FastAPI backend server with proper environment configuration
#
# Usage:
#   ./scripts/start-python-backend.sh [OPTIONS]
#
# Options:
#   --dev          Start in development mode with auto-reload
#   --port PORT    Override port (default: 8000)
#   --workers N    Number of worker processes (default: 4)
#
# Environment:
#   Loads from .env.python if present
# ============================================================================

set -e  # Exit on error

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default configuration
PORT=8000
HOST="0.0.0.0"
WORKERS=4
DEV_MODE=false
LOG_LEVEL="info"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dev)
            DEV_MODE=true
            LOG_LEVEL="debug"
            shift
            ;;
        --port)
            PORT="$2"
            shift 2
            ;;
        --workers)
            WORKERS="$2"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --dev          Start in development mode with auto-reload"
            echo "  --port PORT    Override port (default: 8000)"
            echo "  --workers N    Number of worker processes (default: 4)"
            echo "  --help         Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Banner
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Light Engine Python Backend${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Load environment variables from .env.python if present
if [ -f "$PROJECT_ROOT/.env.python" ]; then
    echo -e "${GREEN}✓${NC} Loading environment from .env.python"
    export $(grep -v '^#' "$PROJECT_ROOT/.env.python" | xargs)
else
    echo -e "${YELLOW}⚠${NC}  No .env.python file found (using environment defaults)"
    echo -e "   Create from template: cp .env.python.example .env.python"
fi

# Check Python installation
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}✗${NC} Python 3 not found. Please install Python 3.8+"
    exit 1
fi

PYTHON_VERSION=$(python3 --version | awk '{print $2}')
echo -e "${GREEN}✓${NC} Python version: $PYTHON_VERSION"

# Check if virtual environment exists
if [ -d "$PROJECT_ROOT/venv" ]; then
    echo -e "${GREEN}✓${NC} Virtual environment found"
    source "$PROJECT_ROOT/venv/bin/activate"
else
    echo -e "${YELLOW}⚠${NC}  No virtual environment found"
    echo -e "   Recommended: python3 -m venv venv && source venv/bin/activate"
fi

# Check required dependencies
echo -e "${BLUE}Checking dependencies...${NC}"

REQUIRED_PACKAGES=("fastapi" "uvicorn" "sqlalchemy" "squareup" "boto3")
MISSING_PACKAGES=()

for package in "${REQUIRED_PACKAGES[@]}"; do
    if python3 -c "import $package" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} $package installed"
    else
        echo -e "${RED}✗${NC} $package not found"
        MISSING_PACKAGES+=("$package")
    fi
done

if [ ${#MISSING_PACKAGES[@]} -ne 0 ]; then
    echo -e "${RED}Missing packages: ${MISSING_PACKAGES[*]}${NC}"
    echo -e "${YELLOW}Install with: pip install -r requirements.txt${NC}"
    exit 1
fi

# Check if port is already in use
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo -e "${RED}✗${NC} Port $PORT is already in use"
    echo -e "   Kill existing process: kill \$(lsof -ti:$PORT)"
    exit 1
fi

echo -e "${GREEN}✓${NC} Port $PORT is available"

# Database migration check
if [ -f "$PROJECT_ROOT/alembic.ini" ]; then
    echo -e "${BLUE}Checking database migrations...${NC}"
    if command -v alembic &> /dev/null; then
        echo -e "${YELLOW}→${NC} Running database migrations"
        alembic upgrade head
        echo -e "${GREEN}✓${NC} Database migrations complete"
    else
        echo -e "${YELLOW}⚠${NC}  Alembic not installed (skipping migrations)"
    fi
fi

# Health check function
health_check() {
    local max_attempts=30
    local attempt=1
    
    echo -e "${YELLOW}→${NC} Waiting for server to start..."
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s "http://localhost:$PORT/health" > /dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} Server is healthy!"
            return 0
        fi
        
        echo -n "."
        sleep 1
        attempt=$((attempt + 1))
    done
    
    echo -e "\n${RED}✗${NC} Server health check failed after 30 seconds"
    return 1
}

# Graceful shutdown handler
cleanup() {
    echo -e "\n${YELLOW}→${NC} Shutting down server..."
    kill $SERVER_PID 2>/dev/null
    wait $SERVER_PID 2>/dev/null
    echo -e "${GREEN}✓${NC} Server stopped"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Start server
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Starting Server${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "  Host:     ${HOST}"
echo -e "  Port:     ${PORT}"
echo -e "  Workers:  ${WORKERS}"
echo -e "  Dev Mode: ${DEV_MODE}"
echo -e "  Log Level: ${LOG_LEVEL}"
echo -e "${BLUE}========================================${NC}"
echo ""

if [ "$DEV_MODE" = true ]; then
    echo -e "${YELLOW}Starting in DEVELOPMENT mode (auto-reload enabled)${NC}"
    echo ""
    
    # Development mode with auto-reload
    uvicorn backend.server:app \
        --host "$HOST" \
        --port "$PORT" \
        --log-level "$LOG_LEVEL" \
        --reload \
        --reload-dir backend \
        --reload-dir public &
    
    SERVER_PID=$!
    
else
    echo -e "${GREEN}Starting in PRODUCTION mode${NC}"
    echo ""
    
    # Production mode with workers
    uvicorn backend.server:app \
        --host "$HOST" \
        --port "$PORT" \
        --workers "$WORKERS" \
        --log-level "$LOG_LEVEL" \
        --no-access-log \
        --proxy-headers \
        --forwarded-allow-ips='*' &
    
    SERVER_PID=$!
fi

# Wait for server to be ready
sleep 3

# Run health check
if health_check; then
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  Server Ready!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo -e "  API:  http://localhost:$PORT/"
    echo -e "  Docs: http://localhost:$PORT/docs"
    echo -e "  Health: http://localhost:$PORT/health"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "Press ${YELLOW}Ctrl+C${NC} to stop the server"
    echo ""
    
    # Wait for server process
    wait $SERVER_PID
else
    echo -e "${RED}Failed to start server${NC}"
    kill $SERVER_PID 2>/dev/null
    exit 1
fi
