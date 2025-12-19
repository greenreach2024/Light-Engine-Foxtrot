# Foxtrot Deployment - Complete Guide

**Status**: ✅ All deployment files now present  
**Date**: December 19, 2025  
**Commit**: f92fae6

## Recent Fixes Applied

### Issue: Incomplete Docker Files
**Problem**: People trying to deploy Foxtrot ran into missing files:
- Missing `Dockerfile`
- `docker-compose.yml` referenced `server-charlie.js` (wrong)
- Missing `docker-compose.edge.yml` for production Edge deployments
- Missing `docker/supervisord.conf` for multi-process containers
- `.env.example` had Delta paths instead of Foxtrot

**Fixed commits**:
- `5674e77` - Commented out missing edge-wholesale-service.js
- `7192016` - Re-enabled after file was added
- `db36077` - Added Edge wholesale integration files
- `f92fae6` - **Added complete Docker deployment stack**

### What Was Added

**1. Dockerfile** (from Delta)
```dockerfile
FROM node:20-bullseye
# Includes Python 3.9, supervisor for multi-process
# Exposes ports 8091 (Node.js) and 8000 (Python)
```

**2. docker-compose.yml** (fixed)
- Now uses `server-foxtrot.js` (was charlie)
- Correct port configuration
- PostgreSQL + Redis + Python + Node

**3. docker-compose.edge.yml** (new)
- Production Edge deployment
- Single container with both Node + Python
- Volume mounts for data persistence
- Health checks configured

**4. docker/supervisord.conf** (new)
- Manages both Node.js and Python processes
- Uses `server-foxtrot.js` (fixed from charlie)
- Proper logging to /app/logs/

**5. .env.example** (fixed)
- Changed "Charlie" → "Foxtrot"
- Fixed paths from Delta to Foxtrot
- Complete variable documentation

## Deployment Options

### Option 1: Local Development (No Docker)

**Prerequisites**:
```bash
node --version  # 20.x
python3 --version  # 3.9+
```

**Setup**:
```bash
# Clone
git clone https://github.com/greenreach2024/Light-Engine-Foxtrot.git
cd Light-Engine-Foxtrot

# Install Node dependencies
npm install

# Install Python dependencies (optional for ML)
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Start Node.js only (basic features)
npm start
# Access: http://localhost:8091

# OR start both Node + Python (full ML/automation)
npm run start:pm2
pm2 logs
```

### Option 2: Docker Compose (Local with Services)

**Prerequisites**:
```bash
docker --version
docker compose version
```

**Start services**:
```bash
cd Light-Engine-Foxtrot

# Start PostgreSQL + Redis + Python + Node
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

**Access**:
- Node.js: http://localhost:8091
- Python API: http://localhost:8000
- PostgreSQL: localhost:5432
- Redis: localhost:6379

### Option 3: Edge Deployment (Production Single Container)

**Use case**: Deploy on Edge device (Symcod W101M, Intel NUC, etc.)

```bash
cd Light-Engine-Foxtrot

# Build Edge image
docker build -t greenreach/lightengine:foxtrot-edge .

# Run with Edge compose
docker compose -f docker-compose.edge.yml up -d

# Check status
docker compose -f docker-compose.edge.yml ps
docker compose -f docker-compose.edge.yml logs -f

# Access Edge status
curl http://localhost:8091/api/edge/status
```

**Environment variables** (create `.env` file):
```bash
FARM_ID=FARM-001
FARM_NAME="Demo Farm"
CENTRAL_API_URL=https://api.greenreach.com
EDGE_API_KEY=your-edge-api-key
SYNC_ENABLED=true
HEARTBEAT_INTERVAL=30000
SYNC_INTERVAL=300000
```

### Option 4: AWS Elastic Beanstalk (Current Production)

**Current deployment**: Node.js only, no Python/ML

**Status check**:
```bash
cd Light-Engine-Foxtrot
eb status

# Should show:
# Environment: light-engine-foxtrot-prod
# Status: Ready
# Health: Green
# CNAME: light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com
```

**Deploy updates**:
```bash
git add .
git commit -m "your changes"
git push

eb deploy light-engine-foxtrot-prod

# Check logs
eb logs --stream
```

**To add Python/ML to AWS EB**:

Option A: Switch to Docker platform
```bash
# Update .elasticbeanstalk/config.yml
default_platform: Docker running on 64bit Amazon Linux 2023

# Create Dockerrun.aws.json
{
  "AWSEBDockerrunVersion": "1",
  "Image": {
    "Name": "greenreach/lightengine:foxtrot-edge",
    "Update": "true"
  },
  "Ports": [
    {
      "ContainerPort": 8091
    }
  ]
}

# Deploy
eb deploy
```

Option B: Multi-container Docker (recommended for production)
- See AWS Multi-Container Docker documentation
- Requires Elastic Container Service (ECS)
- Higher cost but better scalability

Option C: Separate Lambda functions (best for ML)
- Keep Node.js on EB
- Deploy Python ML as Lambda functions
- Serverless = lower cost
- See AWS Lambda deployment guide

## Testing Deployments

### Health Checks

**Node.js**:
```bash
curl http://localhost:8091/api/health
# Expected: {"status":"ok"}

curl http://localhost:8091/api/admin/health
# Expected: detailed system status
```

**Python backend**:
```bash
curl http://localhost:8000/healthz
# Expected: {"status":"healthy"}

curl http://localhost:8000/docs
# Opens FastAPI docs
```

**Edge status**:
```bash
curl http://localhost:8091/api/edge/status
# Expected: edge mode configuration and sync status
```

### Verify All Services

```bash
# Using Docker Compose
docker compose ps

# Should show all running:
# postgres       Up (healthy)
# redis          Up (healthy)  
# python-backend Up (healthy)
# node-server    Up (healthy)
```

### Test Key Features

**1. Dashboard**:
```bash
open http://localhost:8091
# Should load farm dashboard
```

**2. Inventory**:
```bash
curl http://localhost:8091/api/inventory/current
# Should return inventory data
```

**3. Farm Sales**:
```bash
open http://localhost:8091/farm-sales.html
# Should load POS interface
```

**4. ML Forecast** (if Python running):
```bash
curl http://localhost:8091/api/ml/forecast/main
# Should return 24-hour forecast
```

## Environment Variables Reference

### Required (Node.js only)
```bash
NODE_ENV=production
PORT=8091
```

### Optional but Recommended
```bash
# Demo mode
DEMO_MODE=false
DEMO_FARM_ID=DEMO-FARM-001
DEMO_REALTIME=false

# Square payments
SQUARE_ENVIRONMENT=sandbox
SQUARE_APPLICATION_ID=your-app-id
SQUARE_ACCESS_TOKEN=your-token
SQUARE_LOCATION_ID=your-location

# SwitchBot
SWITCHBOT_TOKEN=your-token
SWITCHBOT_SECRET=your-secret

# MQTT (optional)
MQTT_HOST=localhost
MQTT_PORT=1883
```

### For Python Backend
```bash
# Python binary path (if not using Docker)
PYTHON_BIN=/path/to/venv/bin/python3

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/lightengine

# Redis (for rate limiting)
REDIS_HOST=localhost
REDIS_PORT=6379
```

### For Edge Mode
```bash
EDGE_MODE=true
FARM_ID=FARM-001
FARM_NAME="Your Farm"
CENTRAL_API_URL=https://api.greenreach.com
EDGE_API_KEY=your-key
SYNC_ENABLED=true
```

## Architecture Summary

### Current Production (AWS EB)
```
┌─────────────────────┐
│   AWS Elastic       │
│   Beanstalk         │
│                     │
│  Node.js 20 Server  │ port 8091
│  server-foxtrot.js  │
│                     │
│  NeDB (embedded)    │
└─────────────────────┘
```

### Full Stack (Docker Compose)
```
┌─────────────────────┐
│  PostgreSQL 16      │ port 5432
└─────────────────────┘
           ↑
┌─────────────────────┐
│  Redis 7            │ port 6379
└─────────────────────┘
           ↑
┌─────────────────────┐
│  Python Backend     │ port 8000
│  FastAPI + uvicorn  │
│  - ML forecasting   │
│  - Automation       │
│  - Device discovery │
└─────────────────────┘
           ↑
┌─────────────────────┐
│  Node.js Server     │ port 8091
│  server-foxtrot.js  │
│  - Express API      │
│  - Dashboard        │
│  - Farm management  │
└─────────────────────┘
```

### Edge Deployment (Single Container)
```
┌─────────────────────────────────┐
│  Docker Container               │
│                                 │
│  ┌───────────┐  ┌────────────┐ │
│  │ Node.js   │  │  Python    │ │
│  │  :8091    │  │   :8000    │ │
│  └───────────┘  └────────────┘ │
│         ↓              ↓        │
│  ┌─────────────────────────┐   │
│  │   SQLite Database       │   │
│  │   /app/data/*.db        │   │
│  └─────────────────────────┘   │
│                                 │
│  Managed by Supervisor          │
└─────────────────────────────────┘
```

## Troubleshooting

### "Cannot find module './lib/edge-wholesale-service.js'"
**Fixed in commit 7192016**. If you see this:
```bash
git pull origin main
# File should now exist
```

### "docker-compose.yml: server-charlie.js not found"
**Fixed in commit f92fae6**. Update docker-compose:
```bash
git pull origin main
# Now uses server-foxtrot.js
```

### Port 8091 already in use
```bash
# Find process
lsof -ti:8091

# Kill it
kill -9 $(lsof -ti:8091)

# Or use different port
PORT=8095 npm start
```

### Python backend won't start
```bash
# Check Python version
python3 --version  # Need 3.9+

# Install dependencies
pip install -r backend/requirements.txt

# Check for errors
python3 -m backend
```

### Docker build fails
```bash
# Clear Docker cache
docker system prune -a

# Rebuild
docker build --no-cache -t greenreach/lightengine:foxtrot-edge .
```

### AWS EB deployment stuck
```bash
# Check logs
eb logs --stream

# Common issues:
# 1. npm install failure - check package-lock.json committed
# 2. Node version mismatch - check .elasticbeanstalk/config.yml
# 3. Missing environment variables - eb setenv VAR=value
```

## Files Checklist

After recent fixes, you should have:

```bash
✅ Dockerfile
✅ docker-compose.yml (fixed)
✅ docker-compose.edge.yml (new)
✅ docker/supervisord.conf (new)
✅ .env.example (fixed)
✅ ecosystem.config.js (PM2 for both Node + Python)
✅ ecosystem.edge.config.js (PM2 for Edge mode)
✅ lib/edge-wholesale-service.js (added db36077)
✅ routes/edge-wholesale-webhook.js (added db36077)
✅ server-foxtrot.js (correct main file)
✅ backend/requirements.txt (Python deps)
✅ .platform/hooks/prebuild/01_install_dependencies.sh (AWS EB)
✅ .elasticbeanstalk/config.yml (AWS EB config)
```

## Next Steps

1. **Test locally**:
   ```bash
   npm install
   npm start
   ```

2. **Test with Docker**:
   ```bash
   docker compose up
   ```

3. **Deploy to production**:
   ```bash
   eb deploy light-engine-foxtrot-prod
   ```

4. **Enable ML features** (optional):
   - Follow "Option 4" above to add Python backend to AWS
   - Or deploy ML as Lambda functions

## Support

- **Production URL**: http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com
- **GitHub**: https://github.com/greenreach2024/Light-Engine-Foxtrot
- **Status**: ✅ Green (Healthy)

**All deployment files are now complete and tested.**
