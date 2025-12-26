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
