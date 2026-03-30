# Light Engine - Edge Deployment Docker Image
# Target: Symcod W101M N97 (x86_64)
# OS: Ubuntu 22.04 LTS

FROM node:20-bullseye

# Install Python and system dependencies
RUN apt-get update && apt-get install -y \
    python3.9 \
    python3-pip \
    python3-venv \
    sqlite3 \
    nginx \
    supervisor \
    curl \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY requirements.txt ./

# Install Node.js dependencies
RUN npm ci --only=production

# Install Python dependencies
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p /app/data /app/logs /app/public/uploads

# Set up SQLite database directory with proper permissions
RUN chown -R node:node /app/data /app/logs /app/public/uploads

# Copy supervisor configuration
COPY docker/supervisord.conf /etc/supervisor/conf.d/lightengine.conf

# Expose ports
# 8091 - Node.js Express server
# 8000 - Python FastAPI backend
EXPOSE 8091 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8091/api/edge/status || exit 1

# Environment variables
ENV NODE_ENV=production \
    PORT=8091 \
    PYTHON_PORT=8000 \
    EDGE_MODE=true \
    DB_PATH=/app/data/lightengine.db

# Use supervisor to manage both Node and Python processes
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/lightengine.conf"]
