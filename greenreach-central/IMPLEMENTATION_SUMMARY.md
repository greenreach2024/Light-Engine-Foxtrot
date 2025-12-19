# GreenReach Central API - Implementation Summary

**Created:** 2024 Q1  
**Status:** Phase 2 - Foundation Complete ✅  
**Architecture:** Separate Central API (Option B)

---

## 🎯 What We Built

A complete **multi-tenant central coordination API** for managing multiple autonomous farm edge devices. This server handles farm registration, provisioning, real-time monitoring, inventory aggregation, and wholesale order coordination.

---

## 📁 Project Structure

```
greenreach-central/
├── server.js                    # Main Express.js application
├── package.json                 # Dependencies and scripts
├── schema.sql                   # PostgreSQL database schema
├── .env                         # Environment configuration
├── .env.example                 # Configuration template
├── .gitignore                   # Git ignore rules
├── README.md                    # Complete documentation
├── setup.sh                     # Automated setup script
├── test-api.sh                  # API testing script
│
├── config/
│   └── database.js              # PostgreSQL connection pool
│
├── middleware/
│   ├── auth.js                  # JWT & API key authentication
│   ├── errorHandler.js          # Centralized error handling
│   └── logger.js                # Request logging
│
├── routes/
│   ├── farms.js                 # Farm registration & management
│   ├── monitoring.js            # Dashboard & health monitoring
│   ├── inventory.js             # Product inventory aggregation
│   ├── alerts.js                # Alert management
│   ├── sync.js                  # Edge-to-central sync
│   └── orders.js                # Wholesale order coordination
│
├── services/
│   ├── healthCheck.js           # Background farm health monitoring
│   └── syncMonitor.js           # Sync status monitoring
│
└── utils/
    └── logger.js                # Winston logging configuration
```

---

## 🗄️ Database Schema (9 Tables)

### Core Tables
1. **farms** - Farm registration, contact info, API keys, edge device tracking
2. **farm_users** - Multi-user access per farm with role-based permissions
3. **farm_config** - Production setup, crop types, business hours

### Data Aggregation
4. **farm_inventory** - Product catalog synced from edge devices
5. **farm_health** - Real-time system metrics and environmental data
6. **farm_alerts** - System/environmental/device/security alerts

### Multi-Farm Operations
7. **wholesale_orders** - Orders spanning multiple farms
8. **order_fulfillments** - Per-farm fulfillment tracking
9. **sync_logs** - Edge-to-central sync status and history

**Key Features:**
- UUID primary keys for distributed systems
- JSONB columns for flexible metadata
- Comprehensive indexes for performance
- Automatic timestamp triggers
- Foreign key constraints with CASCADE

---

## 🔌 API Endpoints

### Farm Management
```
POST   /api/farms/register              # Register new farm
POST   /api/farms/:id/provision         # Provision edge device
GET    /api/farms/:id                   # Get farm details (auth)
GET    /api/farms                       # List all farms (admin)
POST   /api/farms/:id/heartbeat         # Update heartbeat
```

### Monitoring
```
GET    /api/monitoring/dashboard        # Dashboard overview (auth)
GET    /api/monitoring/farms/:id/health # Farm health details (auth)
GET    /api/monitoring/map              # All farms for map (auth)
```

### Inventory
```
POST   /api/inventory/sync              # Sync from edge (API key)
GET    /api/inventory/farms/:id         # Get farm inventory (auth)
GET    /api/inventory/available         # Available across farms (auth)
```

### Alerts
```
GET    /api/alerts                      # Get alerts with filters (auth)
POST   /api/alerts/:id/acknowledge      # Acknowledge alert (auth)
POST   /api/alerts/:id/resolve          # Resolve alert (auth)
```

### Sync
```
POST   /api/sync/health                 # Sync health data (API key)
POST   /api/sync/alerts                 # Sync alerts (API key)
```

### Orders
```
GET    /api/orders                      # Get all orders (auth)
GET    /api/orders/:id                  # Get order details (auth)
```

---

## 🔐 Authentication

### Two Authentication Methods

**1. JWT Bearer Token** (Dashboard/Admin)
```bash
Authorization: Bearer <jwt_token>
```

**2. API Key** (Edge Devices)
```bash
X-API-Key: <farm_api_key>
X-Farm-ID: <farm_id>
```

---

## 🔄 Farm Registration Flow

### Step 1: Register Farm
```bash
POST /api/farms/register
{
  "name": "Green Valley Farm",
  "email": "contact@greenvalley.com",
  "phone": "+1-555-0100",
  "address_line1": "123 Farm Road",
  "city": "Portland",
  "state": "OR",
  "postal_code": "97201",
  "latitude": 45.5231,
  "longitude": -122.6765
}
```

**Returns:**
- `farmId`: GR-12345678
- `registrationCode`: ABC12345 (one-time use)
- `apiKey`: For edge device authentication
- `apiSecret`: **Only shown once!** Store securely

### Step 2: Provision Edge Device
```bash
POST /api/farms/GR-12345678/provision
{
  "registration_code": "ABC12345",
  "edge_device_id": "raspberry-pi-001",
  "edge_device_type": "raspberry-pi-5",
  "software_version": "1.0.0"
}
```

Farm status changes from `pending` → `active`

### Step 3: Regular Heartbeats
```bash
POST /api/farms/GR-12345678/heartbeat
Headers: X-API-Key: <api_key>
```

Sent every 5 minutes to show farm is online

---

## 🌐 WebSocket Real-time Updates

Connect to `ws://localhost:3001`:

```javascript
const ws = new WebSocket('ws://localhost:3001');

// Subscribe to specific farm
ws.send(JSON.stringify({
  type: 'subscribe',
  farmId: 'GR-12345678'
}));

// Receive real-time updates
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // data.type: 'farms_offline', 'health_update', 'alert', etc.
};
```

---

## 🤖 Background Services

### Health Check Service
- Runs every 30 seconds
- Detects offline farms (no heartbeat for 10+ minutes)
- Updates farm_health status to 'offline'
- Broadcasts via WebSocket to dashboard

### Sync Monitor Service
- Runs every 5 minutes
- Detects stale syncs (no sync for 15+ minutes)
- Creates alerts in farm_alerts table
- Tracks sync patterns for anomaly detection

---

## 🛠️ Technology Stack

### Core
- **Node.js 18+** - Runtime
- **Express.js 4.18** - Web framework
- **PostgreSQL 14+** - Database
- **WebSocket (ws)** - Real-time communication

### Security
- **jsonwebtoken** - JWT authentication
- **bcryptjs** - Password hashing
- **helmet** - Security headers
- **cors** - CORS protection
- **express-rate-limit** - Rate limiting (100 req/15min)

### Utilities
- **winston** - Structured logging
- **axios** - HTTP client
- **dotenv** - Environment configuration
- **uuid** - UUID generation

---

## 📊 Logging

### Three Log Destinations
1. **Console** - Real-time output with colors
2. **logs/combined.log** - All logs (max 5MB × 5 files)
3. **logs/error.log** - Errors only (max 5MB × 5 files)

### Log Levels
- `error` - Critical errors
- `warn` - Warning conditions
- `info` - General information
- `debug` - Detailed debugging (dev only)

---

## 🚀 Quick Start

### 1. Run Setup Script
```bash
cd greenreach-central
./setup.sh
```

This will:
- Check Node.js and PostgreSQL versions
- Install dependencies
- Generate JWT secret
- Create `.env` file
- Create database and run schema
- Create logs directory

### 2. Configure Environment
Edit `.env`:
```bash
DB_PASSWORD=your_postgres_password
# JWT_SECRET already generated by setup.sh
```

### 3. Start Server
```bash
# Development mode (auto-reload)
npm run dev

# Production mode
npm start
```

### 4. Test API
```bash
# Health check
curl http://localhost:3000/health

# Run test script
./test-api.sh
```

---

## 🧪 Testing

### Manual Testing
```bash
# Test health endpoint
curl http://localhost:3000/health

# Register a farm
curl -X POST http://localhost:3000/api/farms/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Farm","email":"test@farm.com",...}'
```

### Automated Testing
```bash
# Run test suite
npm test

# Test API endpoints
./test-api.sh
```

---

## 📈 Production Deployment

### Recommended Setup
1. **Reverse Proxy**: nginx with SSL/TLS
2. **Process Manager**: PM2 or systemd
3. **Database**: PostgreSQL with connection pooling
4. **Monitoring**: CloudWatch, DataDog, or New Relic
5. **Secrets**: AWS Secrets Manager
6. **Log Rotation**: logrotate
7. **Backups**: Automated PostgreSQL backups

### PM2 Example
```bash
npm install -g pm2
pm2 start server.js --name greenreach-central
pm2 startup
pm2 save
```

---

## 🔒 Security Features

- ✅ Rate limiting (100 requests per 15 minutes)
- ✅ CORS whitelist configuration
- ✅ Helmet.js security headers
- ✅ JWT token expiry (24 hours)
- ✅ API secrets hashed with bcrypt (10 rounds)
- ✅ Input validation on all endpoints
- ✅ SQL injection protection (parameterized queries)
- ✅ Error messages don't leak sensitive info

---

## 🎯 Phase 2 Status: COMPLETE ✅

### Completed Features
✅ Express.js server with WebSocket support  
✅ PostgreSQL database schema (9 tables)  
✅ Farm registration & provisioning endpoints  
✅ Real-time monitoring dashboard API  
✅ Inventory aggregation & sync  
✅ Alert management system  
✅ Order coordination endpoints  
✅ JWT & API key authentication  
✅ Background health check service  
✅ Background sync monitor service  
✅ Winston structured logging  
✅ Rate limiting & security middleware  
✅ Comprehensive documentation  
✅ Setup and test scripts  

### Ready for Next Phase
The central API is now ready to coordinate multiple farms. Next steps:

**Phase 3**: First-Run Setup Wizard (edge devices)
- Touchscreen-optimized UI for Symcod W101M
- Network configuration
- Central API connection setup
- Farm provisioning flow

---

## 📚 Documentation Files

- **README.md** - Complete API documentation
- **PRODUCTION_DEPLOYMENT_SUMMARY.md** - Phase 1 deployment
- **EDGE_DEPLOYMENT_ARCHITECTURE.md** - 7-phase roadmap
- **schema.sql** - Database design with comments

---

## 🎉 Key Achievements

1. **Separation of Concerns**: Clean architecture with central coordination separate from edge devices
2. **Multi-Tenancy**: Designed from ground-up for multiple farms
3. **Real-time Updates**: WebSocket for instant dashboard updates
4. **Scalability**: PostgreSQL + connection pooling for growth
5. **Security**: Multiple authentication methods, rate limiting, input validation
6. **Monitoring**: Built-in health checks and sync monitoring
7. **Developer Experience**: Automated setup, comprehensive docs, test scripts

---

## 📞 Support

**Operations**: ops@greenreachfarms.com  
**Technical**: development@greenreachfarms.com

---

**Built with ❤️ for sustainable agriculture**
