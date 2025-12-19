# GreenReach Central API

Central coordination server for the GreenReach multi-farm management system. This API provides farm registration, provisioning, real-time monitoring, inventory aggregation, and wholesale order coordination across multiple edge-deployed farm systems.

## Architecture

The GreenReach Central API serves as the coordination layer for multiple autonomous farm edge devices:

- **Farm Registration & Provisioning**: Onboard new farms and provision their edge devices
- **Real-time Monitoring**: WebSocket-based live health monitoring and alerts
- **Inventory Aggregation**: Collect and aggregate product inventory across all farms
- **Order Routing**: Coordinate wholesale orders across multiple farms
- **Sync Management**: Track and monitor edge-to-central data synchronization

## Tech Stack

- **Node.js 18+** with Express.js
- **PostgreSQL 14+** with UUID and pgcrypto extensions
- **WebSocket** (ws) for real-time updates
- **JWT** authentication with bcrypt password hashing
- **Winston** for structured logging
- **Helmet** & CORS for security

## Prerequisites

- Node.js >= 18.0.0
- PostgreSQL >= 14.0
- npm >= 9.0.0

## Installation

1. **Clone and navigate to the directory:**
   ```bash
   cd greenreach-central
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up PostgreSQL database:**
   ```bash
   # Create database
   createdb greenreach_central
   
   # Run schema
   psql -d greenreach_central -f schema.sql
   ```

4. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

5. **Generate JWT secret:**
   ```bash
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```

## Configuration

Key environment variables in `.env`:

- `PORT`: API server port (default: 3000)
- `DB_*`: PostgreSQL connection settings
- `JWT_SECRET`: Secret for JWT signing (generate a secure random string)
- `WS_PORT`: WebSocket server port (default: 3001)
- `ALLOWED_ORIGINS`: CORS allowed origins (comma-separated)

## Running the Server

### Development mode (with auto-reload):
```bash
npm run dev
```

### Production mode:
```bash
npm start
```

### Health check:
```bash
curl http://localhost:3000/health
```

## API Endpoints

### Farm Management
- `POST /api/farms/register` - Register a new farm
- `POST /api/farms/:id/provision` - Provision a farm with edge device
- `GET /api/farms/:id` - Get farm details (auth required)
- `GET /api/farms` - List all farms (admin only)
- `POST /api/farms/:id/heartbeat` - Update farm heartbeat

### Monitoring
- `GET /api/monitoring/dashboard` - Get dashboard overview (auth)
- `GET /api/monitoring/farms/:id/health` - Get farm health details (auth)
- `GET /api/monitoring/map` - Get all farms for map view (auth)

### Inventory
- `POST /api/inventory/sync` - Sync inventory from edge (API key auth)
- `GET /api/inventory/farms/:id` - Get farm inventory (auth)
- `GET /api/inventory/available` - Get available inventory across farms (auth)

### Alerts
- `GET /api/alerts` - Get alerts with filters (auth)
- `POST /api/alerts/:id/acknowledge` - Acknowledge alert (auth)
- `POST /api/alerts/:id/resolve` - Resolve alert (auth)

### Sync
- `POST /api/sync/health` - Sync health data from edge (API key auth)
- `POST /api/sync/alerts` - Sync alerts from edge (API key auth)

### Orders
- `GET /api/orders` - Get all orders (auth)
- `GET /api/orders/:id` - Get order details (auth)

## Authentication

### For Dashboard/Admin Users
Use JWT Bearer token in Authorization header:
```bash
Authorization: Bearer <jwt_token>
```

### For Edge Devices
Use API Key in headers:
```bash
X-API-Key: <farm_api_key>
X-Farm-ID: <farm_id>
```

## WebSocket Real-time Updates

Connect to `ws://localhost:3001`:

```javascript
const ws = new WebSocket('ws://localhost:3001');

// Subscribe to farm updates
ws.send(JSON.stringify({
  type: 'subscribe',
  farmId: 'GR-12345678'
}));

// Receive updates
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Update:', data);
};
```

## Farm Registration Flow

1. **Register Farm:**
   ```bash
   POST /api/farms/register
   {
     "name": "Green Valley Farm",
     "email": "contact@greenvalley.com",
     "phone": "+1-555-0100",
     "address_line1": "123 Farm Road",
     "city": "Portland",
     "state": "OR",
     "postal_code": "97201"
   }
   ```
   
   Response includes:
   - `farmId`: Unique farm identifier
   - `registrationCode`: One-time provisioning code
   - `apiKey`: API key for edge device
   - `apiSecret`: API secret (only shown once!)

2. **Provision Edge Device:**
   ```bash
   POST /api/farms/GR-12345678/provision
   {
     "registration_code": "ABC12345",
     "edge_device_id": "raspberry-pi-001",
     "edge_device_type": "raspberry-pi-5",
     "software_version": "1.0.0"
   }
   ```
   
   This activates the farm and links the edge device.

3. **Edge Device Heartbeat:**
   ```bash
   POST /api/farms/GR-12345678/heartbeat
   Headers: X-API-Key: <api_key>
   ```

## Background Services

- **Health Check Service**: Monitors farm heartbeats, marks offline farms
- **Sync Monitor**: Tracks data sync status, creates alerts for stale syncs

## Logging

Logs are written to:
- `logs/combined.log` - All logs
- `logs/error.log` - Error logs only
- Console - Real-time output

## Database Schema

9 main tables:
- `farms` - Farm registration and configuration
- `farm_users` - Multi-user access per farm
- `farm_config` - Production setup and preferences
- `farm_inventory` - Aggregated product inventory
- `farm_health` - Real-time health metrics
- `farm_alerts` - System and environmental alerts
- `wholesale_orders` - Multi-farm order management
- `order_fulfillments` - Per-farm fulfillment tracking
- `sync_logs` - Edge-to-central sync tracking

## Development

### Run tests:
```bash
npm test
```

### Database migrations:
```bash
npm run db:migrate
```

### Seed test data:
```bash
npm run db:seed
```

## Production Deployment

Recommended setup:
- Deploy behind nginx reverse proxy with SSL/TLS
- Use PM2 or similar for process management
- Enable PostgreSQL connection pooling
- Set up CloudWatch or similar for monitoring
- Configure log rotation
- Use AWS Secrets Manager for sensitive credentials

## Security

- Rate limiting: 100 requests per 15 minutes
- CORS protection with whitelist
- Helmet.js security headers
- JWT token expiry: 24 hours
- API secrets hashed with bcrypt
- All sensitive operations require authentication

## License

Proprietary - GreenReach Farms

## Support

For support, contact: ops@greenreachfarms.com
