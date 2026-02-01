#!/bin/bash
# Setup Python ML Environment for Light Engine Foxtrot
# Creates virtual environment and installs ML dependencies

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo "=== Setting up ML Environment ==="
echo "Project root: $PROJECT_ROOT"

# Check if pyenv is available
if command -v pyenv &> /dev/null; then
    echo "✓ pyenv detected"
    PYTHON_BIN="$HOME/.pyenv/versions/3.12.6/bin/python"
    
    if [ ! -f "$PYTHON_BIN" ]; then
        echo "⚠️  Python 3.12.6 not found in pyenv"
        echo "Installing Python 3.12.6..."
        pyenv install 3.12.6
    fi
else
    echo "⚠️  pyenv not found, using system python3"
    PYTHON_BIN="python3"
fi

# Check Python version
echo "Using Python: $PYTHON_BIN"
$PYTHON_BIN --version

# Create virtual environment
if [ -d "venv" ]; then
    echo "⚠️  venv directory already exists"
    read -p "Remove and recreate? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf venv
    else
        echo "Keeping existing venv"
        exit 0
    fi
fi

echo "Creating virtual environment..."
$PYTHON_BIN -m venv venv

# Activate and install dependencies
echo "Installing ML dependencies..."
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# Test ML script
echo ""
echo "=== Testing ML Script ==="
if python scripts/simple-anomaly-detector.py --help &> /dev/null; then
    echo "✓ ML anomaly detector script works"
else
    echo "✗ ML script failed"
    exit 1
fi

echo ""
echo "=== Setup Complete ==="
echo "Virtual environment created at: $PROJECT_ROOT/venv"
echo ""
echo "To activate manually:"
echo "  source venv/bin/activate"
echo ""
echo "ML jobs will automatically use venv/bin/python"
echo "Start ML jobs with:"
echo "  pm2 start ecosystem.ml-jobs.config.cjs"
