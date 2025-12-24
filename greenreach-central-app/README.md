# GreenReach Central Dashboard

**Farm Monitoring & Provisioning System**

GreenReach Central is the administrative dashboard for monitoring and managing all deployed Light Engine instances across cloud, edge, and desktop deployments.

## Features

### 📊 Real-Time Monitoring
- **Live Status Dashboard**: Monitor all farms with real-time WebSocket updates
- **Health Metrics**: Track online/offline/degraded status
- **Inventory Tracking**: View inventory levels across all farms
- **Order Monitoring**: Track wholesale orders and revenue
- **License Management**: Monitor license expiration and grace periods
- **Update Status**: Track which farms are on which versions

### 🏢 Multi-Tier Management
- **Tier Control**: Manage inventory-only, full, and enterprise tiers
- **Deployment Modes**: Support cloud, edge, and desktop deployments
- **Feature Flags**: Automatic tier-based feature access control
- **License Validation**: RSA-signed licenses with hardware fingerprinting

### 🔧 Admin Controls
- **Farm Provisioning**: Automated registration and activation
- **Activate/Deactivate Farms**: Control farm access
- **Tier Upgrades**: Change subscription tiers
- **License Management**: Issue and revoke licenses
- **Update Rollouts**: Staged rollout control with rollback
- **Transfer Ownership**: Move farms between owners

### 📈 Analytics
- **Revenue Tracking**: 7d, 30d, 90d revenue reports
- **Farm Analytics**: Inventory, orders, and activity metrics
- **Aggregate Statistics**: Network-wide insights
- **Audit Logs**: Track all administrative actions

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Admin token (set in environment)

### Installation

```bash
cd greenreach-central-app
npm install
```

### Database Setup

```bash
# Create database
createdb greenreach_central

# Run schema
psql greenreach_central < schema.sql
```

### Configuration

Create `.env` file:

```bash
# Server
PORT=3100
NODE_ENV=production

# Database
DATABASE_URL=postgresql://localhost:5432/greenreach_central

# Authentication
ADMIN_TOKEN=your-secure-admin-token-here

# Optional: CORS
ALLOWED_ORIGINS=https://central.greenreach.io,https://admin.greenreach.io
```

### Run

```bash
# Development
npm run dev

# Production
npm start
```

### Access Dashboard

Open browser to:
```
http://localhost:3100/?token=your-admin-token
```

## API EnProvisioning

**POST /api/provisioning/register**
- Register new farm and generate activation code
- Body: `{ farmName, contactEmail, tier, deploymentMode, licenseDuration }`
- Returns: Farm details, activation code, license, URLs

**POST /api/provisioning/activate**
- Activate farm using activation code
- Body: `{ activationCode, hardwareFingerprint? }`
- Returns: Farm details, license info, access URLs

**POST /api/provisioning/deactivate**
- Deactivate farm (admin only)
- Body: `{ farmId, reason }`

**POST /api/provisioning/transfer**
- Transfer farm to new owner (admin only)
- Body: `{ farmId, newEmail, newFingerprint? }`

**POST /api/provisioning/renew**
- Renew license for existing farm
- Body: `{ farmId, duration }`

**POST /api/provisioning/upgrade**
- Upgrade farm tier
- Body: `{ farmId, newTier }`

**GET /api/provisioning/status/:farmId**
- Get provisioning status and license info

### Farm dpoints

### Farm Management

**GET /api/farms/status**
- Returns all farms with real-time status
- Query params: `tier`, `deployment_mode`, `active`
- Headers: `Authorization: Bearer <admin_token>`

**GET /api/farms/:farmId/details**
- Get detailed farm information
- activation_codes**
- Activation codes for new farm setup
- SHA-256 hashed for security
- 7-day expiration, single-use

**api_keys**
- Enterprise API keys for programmatic access
- SHA-256 hashed, tracked usage

**Includes license, inventory, orders, activity

**GET /api/farms/:farmId/logs**
- Retrieve farm error logs
- Query params: `limit`, `level` (error/warn/info)

**POST /api/farms/:farmId/activate**
- Activate or deactivate farm
- Body: `{ "active": true }`

**POST /api/farms/:farmId/tier**
- Update farm subscription tier
- Body: `{ "tier": "enterprise" }`

### Analytics

**GET /api/analytics/summary**
- Overall system analytics
- Query params: `timeframe` (7d, 30d, 90d, 365d)

### WebSocket

**WS /ws/farms**
- Real-time farm status updates
- Sends updates every 10 seconds
- Auto-reconnects on disconnect

## Database Schema

### Tables

**farms**
- Central registry of all deployed farms
- Tracks subdomain, tier, deployment mode
- Last seen timestamp for health monitoring

**licenses**
- License information per farm
- RSA signatures with hardware fingerprinting
- Expiration and grace period tracking
- Update channel assignment

**farm_activity**
- Audit log of farm events
- Tracks activation, tier changes, provisioning

**farm_logs**
- Error and warning logs from farms
- Aggregated for centralized monitoring

**update_rollouts**
- Control staged update rollouts
- Percentage-based rollout to farms
- Emergency rollback support

## Architecture

### Components

```
greenreach-central-app/
├── server.js              # Express server with WebSocket
├── public/
│   └── index.html        # Dashboard UI
├── schema.sql            # PostgreSQL schema
├── package.json          # Dependencies
└── README.md             # This file
```

### Technology Stack
- **Backend**: Node.js + Express + express-ws
- **Database**: PostgreSQL with JSONB
- **Frontend**: Vanilla JS + WebSocket
- **Security**: Helmet + token-based auth
- **Monitoring**: Real-time WebSocket updates

### Integration Points

**With Light Engine Instances:**
- Farms report heartbeat via `POST /api/heartbeat`
- License validation via `GET /api/licenses/validate`
- Update checks via `GET /api/updates/check`

**With Provisioning API:**
- New farm registration
- License generation and activation
- Tenant database provisioning

**With Update Server:**
- Rollout percentage control
- Version manifest generation
- Emergency rollback triggers

## Security

### Authentication
- **Admin Token**: Bearer token required for all endpoints
- **Token Storage**: Store in localStorage or URL param
- **Environment Variable**: Set `ADMIN_TOKEN` in production

### Database Security
- **Connection Pooling**: Max 20 connections
- **SQL Injection Prevention**: Parameterized queries only
- **Row-Level Security**: Consider RLS for multi-admin setups

### Network Security
- **Helmet**: Content Security Policy headers
- **CORS**: Configurable allowed origins
- **HTTPS**: Required in production
- **WebSocket Security**: Token validation on connect

## Deployment

### Production Checklist

1. **Database**
   - [ ] PostgreSQL 14+ installed
   - [ ] Database created and schema applied
   - [ ] Indexes created for performance
   - [ ] Backup strategy in place

2. **Environment**
   - [ ] `ADMIN_TOKEN` set to secure random value
   - [ ] `DATABASE_URL` points to production DB
   - [ ] `NODE_ENV=production`
   - [ ] `ALLOWED_ORIGINS` configured

3. **Security**
   - [ ] HTTPS enabled (via reverse proxy)
   - [ ] Admin token is strong and secret
   - [ ] Database credentials secured
   - [ ] Firewall rules configured

4. **Monitoring**
   - [ ] Health check endpoint monitored
   - [ ] Database connection alerts
   - [ ] Error logging to external service
   - [ ] Uptime monitoring configured

### Deployment Options

**Option 1: Standalone Server**
```bash
# Use PM2 for process management
npm install -g pm2
pm2 start server.js --name greenreach-central
pm2 save
pm2 startup
```

**Option 2: Docker**
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3100
CMD ["node", "server.js"]
```

**Option 3: Cloud Platform**
- Deploy to AWS ECS, Google Cloud Run, or Azure App Service
- Use managed PostgreSQL (RDS, Cloud SQL, Azure Database)
- Configure environment variables in platform console

### Reverse Proxy (Nginx)

```nginx
server {
  listen 443 ssl http2;
  server_name central.greenreach.io;
  
  ssl_certificate /etc/ssl/certs/greenreach.crt;
  ssl_certificate_key /etc/ssl/private/greenreach.key;
  
  location / {
    proxy_pass http://localhost:3100;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

## Monitoring & Observability

### Health Checks
```bash
curl http://localhost:3100/health
```

### Logs
- **stdout**: All access logs (Morgan)
- **stderr**: Error logs
- **Database**: Audit logs in farm_activity table

### Metrics to Monitor
- **Active Farms**: Should be > 0
- **Database Connections**: Should be < 20
- **Response Time**: Should be < 500ms
- **WebSocket Connections**: Track concurrent connections
- **License Expirations**: Alert 30 days before expiry

## Troubleshooting

### Database Connection Failed
```
ERROR: Unable to connect to database
```
**Solution**: Check DATABASE_URL environment variable and PostgreSQL service status

### Farms Not Showing Up
```
Empty farms list despite farms being deployed
```
**Solution**: Ensure farms are calling heartbeat API and last_seen_at is being updated

### WebSocket Not Connecting
```
WebSocket connection failed
```
**Solution**: Check reverse proxy WebSocket upgrade headers are configured correctly

### Authorization Failed
```
401 Unauthorized
```
**Solution**: Verify ADMIN_TOKEN is set correctly and matches between server and client

## Development

### Local Development

```bash
# Terminal 1: PostgreSQL
docker run -d \
  -p 5432:5432 \
  -e POSTGRES_DB=greenreach_central \
  -e POSTGRES_PASSWORD=dev \
  postgres:14

# Terminal 2: Run schema
psql postgresql://postgres:dev@localhost/greenreach_central < schema.sql

# Terminal 3: Start server
npm run dev
```

### Testing

```bash
# Test health check
curl http://localhost:3100/health

# Test farms status (requires token)
curl -H "Authorization: Bearer dev-admin-token-change-in-production" \
  http://localhost:3100/api/farms/status

# Test analytics
curl -H "Authorization: Bearer dev-admin-token-change-in-production" \
  "http://localhost:3100/api/analytics/summary?timeframe=30d"
```

## Roadmap

### Phase 1: Core Monitoring ✅
- [x] Real-time farm status dashboard
- [x] License tracking
- [x] Basic analytics
- [x] WebSocket updates

### Phase 2: Advanced Features
- [ ] Automated provisioning API
- [ ] License generation UI
- [ ] Advanced analytics graphs
- [ ] Email alerts for expiring licenses
- [ ] Batch operations (bulk activate/deactivate)
- [ ] CSV export for reports

### Phase 3: Multi-Admin
- [ ] Admin user accounts
- [ ] Role-based access control
- [ ] Activity audit trail per admin
- [ ] Team collaboration features

### Phase 4: Intelligence
- [ ] Anomaly detection (unusual farm behavior)
- [ ] Predictive analytics (revenue forecasting)
- [ ] Automated tier recommendations
- [ ] Health scoring algorithm

## Support

### Documentation
- API Reference: See API Endpoints section above
- Database Schema: See schema.sql file
- Architecture: See Architecture section above

### Contact
For support, contact the GreenReach development team.

---

**GreenReach Central** - Professional farm monitoring and management for Light Engine deployments.
