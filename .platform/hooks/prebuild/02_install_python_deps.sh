#!/bin/bash
# Install Python ML dependencies for anomaly detection and forecasting
# Required by: scripts/simple-anomaly-detector.py

set -ex

echo "=== Installing Python ML dependencies ==="

# Check Python3 availability
if ! command -v python3 &> /dev/null; then
    echo "WARNING: python3 not found, installing..."
    yum install -y python3 python3-pip 2>/dev/null || dnf install -y python3 python3-pip 2>/dev/null || true
fi

python3 --version || { echo "ERROR: python3 not available"; exit 0; }

# Install from requirements.txt (only ML deps to keep it fast)
# Full requirements.txt has FastAPI etc. which aren't needed for Node.js server
pip3 install --user \
    "scikit-learn>=1.4.0" \
    "numpy>=1.26.0" \
    "pandas>=2.2.0" \
    "statsmodels>=0.14.0" \
    "requests>=2.31.0" \
    2>&1 || {
    echo "WARNING: Failed to install Python ML deps (non-fatal)"
    echo "ML endpoints will return graceful 503 errors"
    exit 0
}

echo "=== Python ML dependencies installed ==="
python3 -c "import sklearn; print(f'scikit-learn {sklearn.__version__}')" 2>&1 || true
python3 -c "import numpy; print(f'numpy {numpy.__version__}')" 2>&1 || true
