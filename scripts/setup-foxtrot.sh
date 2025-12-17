#!/bin/bash
# Script to copy essential files to Light-Engine-Foxtrot repository
# Preserves AWS setup for easy reinstall

set -e

DELTA_DIR="/Users/petergilbert/Light-Engine-Delta"
FOXTROT_DIR="/Users/petergilbert/Light-Engine-Foxtrot"

echo "🦊 Light Engine Foxtrot - Clean Repository Setup"
echo "================================================"
echo ""

# Check if Foxtrot repo exists
if [ ! -d "$FOXTROT_DIR" ]; then
    echo "❌ Error: $FOXTROT_DIR does not exist"
    echo "   Please create the repository first:"
    echo "   cd ~/; git clone git@github.com:greenreach2024/Light-Engine-Foxtrot.git"
    exit 1
fi

cd "$FOXTROT_DIR"

echo "📦 Copying core server files..."
cp "$DELTA_DIR/server-charlie.js" .
cp "$DELTA_DIR/package.json" .
cp "$DELTA_DIR/package-lock.json" .
cp "$DELTA_DIR/ecosystem.config.cjs" .
cp "$DELTA_DIR/ecosystem.ml-jobs.config.cjs" .
cp "$DELTA_DIR/Procfile" .

echo "🐍 Copying backend (Python/FastAPI)..."
mkdir -p backend
cp "$DELTA_DIR/backend/__init__.py" backend/
cp "$DELTA_DIR/backend/main.py" backend/
cp "$DELTA_DIR/backend/inventory_routes.py" backend/
cp "$DELTA_DIR/backend/auth.py" backend/
cp "$DELTA_DIR/backend/auth_routes.py" backend/ 2>/dev/null || true
cp "$DELTA_DIR/backend/config.py" backend/ 2>/dev/null || true
cp "$DELTA_DIR/backend/state.py" backend/ 2>/dev/null || true
cp "$DELTA_DIR/requirements.txt" backend/

echo "🌐 Copying frontend files..."
mkdir -p public/data
cp "$DELTA_DIR/public/index.html" public/ 2>/dev/null || true
cp "$DELTA_DIR/public/app.charlie.js" public/
cp "$DELTA_DIR/public/styles.charlie.css" public/
cp "$DELTA_DIR/public/tray-inventory.html" public/ 2>/dev/null || true
cp "$DELTA_DIR/public/tray-setup.html" public/ 2>/dev/null || true
cp "$DELTA_DIR/public/farm-admin.html" public/ 2>/dev/null || true
cp "$DELTA_DIR/public/central-admin.html" public/ 2>/dev/null || true
cp "$DELTA_DIR/public/dashboard.html" public/ 2>/dev/null || true
cp "$DELTA_DIR/public/mobile-dashboard.html" public/ 2>/dev/null || true
cp "$DELTA_DIR/public/nutrient-dashboard.html" public/ 2>/dev/null || true
cp "$DELTA_DIR/public/billing-preview.html" public/ 2>/dev/null || true

echo "📊 Copying essential data files..."
cp "$DELTA_DIR/public/data/lighting-recipes.json" public/data/
cp "$DELTA_DIR/public/data/demo-farm-data.json" public/data/
cp "$DELTA_DIR/public/data/env.json" public/data/
cp "$DELTA_DIR/public/data/farm.json" public/data/
cp "$DELTA_DIR/public/data/rooms.json" public/data/
cp "$DELTA_DIR/public/data/groups.json" public/data/
cp "$DELTA_DIR/public/data/schedules.json" public/data/
cp "$DELTA_DIR/public/data/target-ranges.json" public/data/
cp "$DELTA_DIR/public/data/controller.json" public/data/
cp "$DELTA_DIR/public/data/nutrient-dashboard.json" public/data/

echo "🗄️  Copying database migrations..."
cp "$DELTA_DIR/alembic.ini" .
mkdir -p alembic/versions
cp "$DELTA_DIR/alembic/env.py" alembic/
cp "$DELTA_DIR/alembic/script.py.mako" alembic/
cp "$DELTA_DIR"/alembic/versions/*.py alembic/versions/

echo "⚙️  Copying configuration..."
mkdir -p config
cp "$DELTA_DIR/config/growth-stages.json" config/
cp "$DELTA_DIR/config/bus-map.yml" config/ 2>/dev/null || echo "   (bus-map.yml not found, skipping)"

echo "🔧 Copying essential scripts..."
mkdir -p scripts
cp "$DELTA_DIR/scripts/convert-recipes-to-json.py" scripts/
cp "$DELTA_DIR/scripts/smoke.js" scripts/
cp "$DELTA_DIR/scripts/nutrient-push-setpoints.js" scripts/

echo "☁️  Copying AWS deployment config (for easy reinstall)..."
cp "$DELTA_DIR/.ebignore" .
mkdir -p .elasticbeanstalk
cp "$DELTA_DIR/.elasticbeanstalk/config.yml" .elasticbeanstalk/
cp "$DELTA_DIR/buildspec.yml" .
cp "$DELTA_DIR/deploy-aws-simple.sh" .

echo "📝 Copying essential documentation..."
mkdir -p .github
cp "$DELTA_DIR/README.md" .


echo "🔒 Creating .gitignore..."
cat > .gitignore << 'EOF'
# Python
venv/
__pycache__/
*.pyc
*.pyo
*.pyd
.Python
env/
build/
dist/
*.egg-info/

# Node
node_modules/
npm-debug.log*
yarn-error.log*

# Environment
.env
.env.local
.env.development

# Database (runtime only)
*.db
*.sqlite
lightengine.db

# Logs
logs/
*.log

# Runtime cache/data (don't commit)
public/data/env-cache.json
public/data/devices.cache.json
public/data/anomaly-history.json
public/data/harvest-log.json

# OS
.DS_Store
Thumbs.db
.AppleDouble
.LSOverride

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# AWS
.elasticbeanstalk/*
!.elasticbeanstalk/*.cfg.yml
!.elasticbeanstalk/*.global.yml

# Backups
backups/
*.backup
*.bak
EOF

echo "📄 Creating .env.example..."
cat > .env.example << 'EOF'
# Node.js Server
NODE_ENV=production
PORT=8091
HOST=0.0.0.0

# SwitchBot API
SWITCHBOT_TOKEN=your_switchbot_token_here
SWITCHBOT_SECRET=your_switchbot_secret_here

# Environmental Data Source
ENV_SOURCE=cloud
CLOUD_ENDPOINT_URL=https://your-lambda-url.amazonaws.com/api/env

# MQTT (if using local MQTT broker)
MQTT_HOST=192.168.2.38
MQTT_PORT=1883
MQTT_USERNAME=your_mqtt_username
MQTT_PASSWORD=your_mqtt_password

# Database
DATABASE_URL=sqlite:///lightengine.db

# JWT Secret
JWT_SECRET=your-secret-key-change-in-production

# Optional: Analytics
ENABLE_ANALYTICS=false
EOF

echo "📚 Creating QUICKSTART.md..."
cat > QUICKSTART.md << 'EOF'
# Light Engine Foxtrot - Quick Start Guide

## Prerequisites
- Node.js 18+
- Python 3.8+
- SQLite3
- AWS CLI (for deployment)

## Local Development

### 1. Install Dependencies
```bash
# Node.js dependencies
npm install

# Python dependencies
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r backend/requirements.txt
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your credentials
```

### 3. Initialize Database
```bash
# Run migrations
source venv/bin/activate
alembic upgrade head
```

### 4. Start Servers
```bash
# Terminal 1: Node.js server (port 8091)
npm run start

# Terminal 2: Python backend (port 8000)
source venv/bin/activate
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

### 5. Access Application
- Main Dashboard: http://localhost:8091
- Tray Inventory: http://localhost:8091/tray-inventory.html
- Farm Admin: http://localhost:8091/farm-admin.html
- API Docs: http://localhost:8000/docs

## AWS Deployment

### 1. Initialize Elastic Beanstalk
```bash
eb init light-engine-foxtrot --platform node.js --region us-east-1
```

### 2. Create Environment
```bash
eb create light-engine-foxtrot-prod --single
```

### 3. Set Environment Variables
```bash
eb setenv \
  NODE_ENV=production \
  PORT=8091 \
  SWITCHBOT_TOKEN=your_token \
  SWITCHBOT_SECRET=your_secret \
  ENV_SOURCE=cloud \
  CLOUD_ENDPOINT_URL=your_lambda_url
```

### 4. Deploy
```bash
eb deploy light-engine-foxtrot-prod
```

Or use the convenience script:
```bash
./deploy-aws-simple.sh
```

## Testing
```bash
# Smoke test
npm run smoke

# Against production
curl https://your-app.elasticbeanstalk.com/api/health
```

## Production Recipes
The system includes 11 production-ready crop lighting recipes in `public/data/lighting-recipes.json`. These are research-validated schedules with PPFD, spectrum, temperature, VPD, EC, and pH values.

## Support
See README.md for detailed documentation.
EOF

echo ""
echo "✅ Copy complete!"
echo ""
echo "📊 File count in Foxtrot:"
find "$FOXTROT_DIR" -type f | grep -v ".git" | wc -l | xargs echo "   Files:"
echo ""
echo "📦 Next steps:"
echo "   1. cd $FOXTROT_DIR"
echo "   2. git add -A"
echo "   3. git commit -m 'Initial commit: Clean production-ready Light Engine Foxtrot'"
echo "   4. git push origin main"
echo ""
echo "🚀 Then deploy to AWS:"
echo "   eb init light-engine-foxtrot --platform node.js --region us-east-1"
echo "   eb create light-engine-foxtrot-prod --single"
echo "   eb deploy"
