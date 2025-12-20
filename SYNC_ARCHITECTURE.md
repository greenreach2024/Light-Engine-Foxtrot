# Data Synchronization Architecture

## Overview

GreenReach's data synchronization system ensures reliable, efficient data flow between edge devices and GreenReach Central. The system handles inventory updates, health metrics, alerts, and configuration changes with offline support and conflict resolution.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Edge Device (Farm)                       │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐   ┌──────────────┐  │
│  │   Local DB   │    │ Sync Service │   │  Sync Queue  │  │
│  │   (SQLite)   │◄──►│  (Service)   │◄─►│  (Offline)   │  │
│  └──────────────┘    └──────┬───────┘   └──────────────┘  │
│                             │                               │
└─────────────────────────────┼───────────────────────────────┘
                              │
                              │ WebSocket (real-time)
                              │ + REST API (fallback)
                              │
┌─────────────────────────────▼───────────────────────────────┐
│              GreenReach Central API                         │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐   ┌──────────────┐  │
│  │ PostgreSQL   │◄──►│  API Server  │◄─►│  WebSocket   │  │
│  │  (Primary)   │    │  (Express)   │   │   Server     │  │
│  └──────────────┘    └──────────────┘   └──────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Sync Types and Intervals

### 1. Inventory Sync
**Interval:** Every 5 minutes  
**Direction:** Edge → Central (upload)  
**Data:** Product inventory, stock levels, harvest records

**Payload Example:**
```json
{
  "farmId": "GR-17350001001",
  "timestamp": "2024-01-15T10:30:00Z",
  "inventory": {
    "products": [
      {
        "sku": "LETTUCE-BUTTERHEAD-001",
        "name": "Butterhead Lettuce",
        "quantity": 144,
        "unit": "heads",
        "location": "Room 1 - Zone A",
        "harvestDate": "2024-01-10",
        "status": "ready"
      }
    ],
    "lastUpdated": "2024-01-15T10:25:00Z"
  }
}
```

### 2. Health Heartbeat
**Interval:** Every 30 seconds  
**Direction:** Edge → Central (upload)  
**Data:** System health, device status, environmental metrics

**Payload Example:**
```json
{
  "farmId": "GR-17350001001",
  "timestamp": "2024-01-15T10:30:00Z",
  "health": {
    "system": {
      "cpu": 25.5,
      "memory": 45.2,
      "disk": 30.1,
      "temperature": 55.0,
      "uptime": 345600
    },
    "devices": {
      "total": 48,
      "active": 48,
      "errors": 0,
      "offline": 0
    },
    "environment": {
      "temperature": 72.5,
      "humidity": 65.0,
      "co2": 800,
      "vpd": 1.2
    }
  }
}
```

### 3. Alerts
**Interval:** Immediate (real-time)  
**Direction:** Edge → Central (upload)  
**Transport:** WebSocket (primary), REST API (fallback)

**Alert Types:**
- **Critical:** Temperature/humidity out of range, device failure
- **Warning:** Low inventory, sensor drift, network issues
- **Info:** Harvest ready, maintenance due, firmware update available

**Payload Example:**
```json
{
  "farmId": "GR-17350001001",
  "timestamp": "2024-01-15T10:30:15Z",
  "alert": {
    "id": "alert-001",
    "type": "temperature_high",
    "severity": "critical",
    "zone": "Room 1 - Zone A",
    "message": "Temperature exceeded 80°F",
    "value": 82.5,
    "threshold": 80.0,
    "device": "sensor-temp-001"
  }
}
```

### 4. Configuration Sync
**Interval:** On change + daily check  
**Direction:** Central → Edge (download)  
**Data:** Automation rules, zone settings, device configurations

**Payload Example:**
```json
{
  "farmId": "GR-17350001001",
  "timestamp": "2024-01-15T10:30:00Z",
  "config": {
    "zones": [
      {
        "id": "zone-001",
        "name": "Room 1 - Zone A",
        "temperature": { "min": 65, "max": 75 },
        "humidity": { "min": 60, "max": 70 },
        "lightSchedule": {
          "on": "06:00",
          "off": "22:00",
          "spectrum": "vegetative"
        }
      }
    ],
    "automationRules": [...],
    "version": "1.2.3"
  }
}
```

## Connection Management

### WebSocket Connection

Primary transport for real-time data synchronization.

**Connection Lifecycle:**
1. **Connect:** Establish WebSocket connection to `wss://api.greenreach.com/ws`
2. **Authenticate:** Send auth message with API credentials
3. **Heartbeat:** Ping every 15 seconds to keep connection alive
4. **Reconnect:** Auto-reconnect on disconnect with 3-second delay

**Authentication:**
```javascript
ws.send(JSON.stringify({
  type: 'auth',
  farmId: 'GR-17350001001',
  apiKey: 'your-api-key',
  apiSecret: 'your-api-secret'
}));
```

**Heartbeat:**
```javascript
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.ping();
  }
}, 15000);
```

### REST API Fallback

Used when WebSocket is unavailable or for bulk operations.

**Endpoints:**
- `POST /api/sync/inventory` - Upload inventory
- `POST /api/sync/health` - Upload health metrics
- `POST /api/alerts` - Send alert
- `GET /api/farms/{farmId}/config` - Download configuration

**Authentication:**
```http
Authorization: Bearer {apiKey}
X-Farm-ID: {farmId}
X-API-Secret: {apiSecret}
```

## Offline Queue

### Queue Behavior

When the edge device loses connectivity, all sync operations are queued locally.

**Queue Storage:**
- Persistent SQLite database
- Survives device restarts
- FIFO processing order
- Automatic deduplication

**Queue Item Structure:**
```javascript
{
  type: 'inventory',        // inventory, health, alert
  data: {...},             // Original payload
  timestamp: '2024-01-15T10:30:00Z',
  retries: 0,              // Retry counter
  maxRetries: 5,           // Max retry attempts
  nextRetry: '2024-01-15T10:35:00Z'
}
```

### Retry Strategy

**Exponential Backoff:**
- Initial delay: 5 seconds
- Backoff multiplier: 2x
- Max retries: 5
- Total retry time: ~2.5 minutes

**Retry Schedule:**
1. Immediate (queue add)
2. 5 seconds
3. 10 seconds
4. 20 seconds
5. 40 seconds
6. 80 seconds
7. **Drop** (max retries exceeded)

### Queue Processing

```javascript
async function processQueue() {
  while (queue.length > 0) {
    const item = queue[0];
    
    try {
      // Attempt to sync
      const success = await syncItem(item);
      
      if (success) {
        queue.shift(); // Remove from queue
      } else {
        item.retries++;
        
        if (item.retries >= item.maxRetries) {
          queue.shift(); // Drop after max retries
          logError('Max retries exceeded', item);
        } else {
          // Exponential backoff
          const delay = 5000 * Math.pow(2, item.retries - 1);
          await sleep(delay);
        }
      }
    } catch (error) {
      handleQueueError(error, item);
    }
  }
}
```

## Conflict Resolution

### Conflict Types

1. **Timestamp Conflicts:** Local and central have different timestamps
2. **Data Conflicts:** Same resource modified on both sides
3. **Deletion Conflicts:** Resource deleted on one side, modified on other

### Resolution Strategies

#### Last Write Wins (LWW)
Default strategy for most data types.

```javascript
if (local.timestamp > central.timestamp) {
  // Local version is newer, upload to central
  await uploadTocentral(local);
} else {
  // Central version is newer, update local
  await updateLocal(central);
}
```

#### Central Authority
Central API is always authoritative for:
- Configuration settings
- User permissions
- API credentials
- Wholesale orders

#### Merge Strategy
For inventory and health data:
- Combine non-conflicting changes
- Use LWW for conflicting fields
- Log merge operations for audit

**Example:**
```javascript
const merged = {
  ...central,
  ...local,
  // Central wins for these fields
  config: central.config,
  permissions: central.permissions,
  // Local wins for these fields
  inventory: local.inventory,
  health: local.health,
  // Merge timestamp
  lastModified: Math.max(
    new Date(local.lastModified),
    new Date(central.lastModified)
  ).toISOString()
};
```

## Monitoring

### Sync Status Metrics

**Key Metrics:**
- Connection status (connected/disconnected)
- Last successful sync time (per type)
- Sync error count (per type)
- Queue size
- Queue processing status
- Network latency

**Dashboard Widgets:**
- Real-time connection indicator
- Sync history timeline
- Queue depth chart
- Error log

### Alerts

**Sync-Related Alerts:**
- **Connection Lost:** WebSocket disconnected for >5 minutes
- **Sync Failed:** 3+ consecutive sync failures
- **Queue Overflow:** Queue size exceeds 100 items
- **Stale Data:** No successful sync in >1 hour

### Logging

**Log Levels:**
- `INFO`: Successful syncs, reconnections
- `WARN`: Retry attempts, minor errors
- `ERROR`: Sync failures, queue drops
- `DEBUG`: WebSocket messages, detailed timing

**Log Format:**
```
[2024-01-15 10:30:00] [sync-service] INFO Inventory synced successfully
[2024-01-15 10:30:15] [sync-service] WARN Retry 2/5 in 10s
[2024-01-15 10:30:30] [sync-service] ERROR Health sync failed: timeout
```

## Error Handling

### Common Errors

#### Network Errors
- **Timeout:** Request took >30 seconds
- **Connection Refused:** Central API unreachable
- **DNS Failure:** Cannot resolve api.greenreach.com

**Handling:**
```javascript
try {
  await syncInventory();
} catch (error) {
  if (error.code === 'ETIMEDOUT') {
    // Queue for retry
    queueSync('inventory', data);
  } else if (error.code === 'ECONNREFUSED') {
    // Central API down, queue all syncs
    pauseSyncService();
  }
}
```

#### Authentication Errors
- **401 Unauthorized:** Invalid API key
- **403 Forbidden:** API key lacks permissions
- **429 Too Many Requests:** Rate limit exceeded

**Handling:**
```javascript
if (response.status === 401) {
  // API key invalid, stop sync service
  stopSyncService();
  alertAdmin('Invalid API credentials');
} else if (response.status === 429) {
  // Rate limited, increase interval
  increaseSyncInterval();
}
```

#### Data Errors
- **400 Bad Request:** Invalid payload format
- **422 Unprocessable Entity:** Data validation failed
- **409 Conflict:** Resource conflict

**Handling:**
```javascript
if (response.status === 400) {
  // Invalid data, log and skip
  logError('Invalid payload', data);
  skipQueueItem();
} else if (response.status === 409) {
  // Conflict, resolve and retry
  await resolveConflict(data);
  retrySync();
}
```

## Performance Optimization

### Batching

Group multiple items into single requests:

```javascript
// Instead of 5 separate requests
await syncInventoryItem(item1);
await syncInventoryItem(item2);
await syncInventoryItem(item3);
await syncInventoryItem(item4);
await syncInventoryItem(item5);

// Batch into single request
await syncInventoryBatch([item1, item2, item3, item4, item5]);
```

**Benefits:**
- Reduced network overhead
- Lower API request count
- Improved throughput

### Compression

Enable gzip compression for large payloads:

```javascript
const response = await fetch('/api/sync/inventory', {
  method: 'POST',
  headers: {
    'Content-Encoding': 'gzip',
    'Content-Type': 'application/json'
  },
  body: gzipSync(JSON.stringify(data))
});
```

**Compression Ratios:**
- Inventory: ~70% reduction
- Health: ~60% reduction
- Config: ~80% reduction

### Delta Sync

Only sync changed data:

```javascript
// Instead of full inventory
const inventory = await getFullInventory(); // 2MB

// Send only changes since last sync
const changes = await getInventoryChanges(lastSyncTime); // 50KB
```

**Implementation:**
1. Track last sync timestamp per type
2. Query only records modified since last sync
3. Include timestamp in sync request
4. Central API returns only newer records

## Security

### Authentication

**API Key + Secret:**
- API Key: Public identifier (64 hex chars)
- API Secret: Private credential (64 hex chars, bcrypt hashed)
- Both required for authentication

**Storage:**
- API Key: Environment variable
- API Secret: Encrypted keystore
- Never log or expose secrets

### Transport Security

**TLS 1.3:**
- All connections use TLS 1.3
- Certificate pinning for production
- Perfect forward secrecy (PFS)

**WebSocket Security:**
```javascript
const ws = new WebSocket('wss://api.greenreach.com/ws', {
  ca: [cert],           // Certificate Authority
  rejectUnauthorized: true,
  headers: {
    'Authorization': `Bearer ${apiKey}`
  }
});
```

### Data Encryption

**At Rest:**
- Local database encrypted (SQLCipher)
- API credentials encrypted (AES-256)
- Logs encrypted (AES-256)

**In Transit:**
- TLS 1.3 encryption
- Perfect forward secrecy
- HSTS enabled

## Testing

### Unit Tests

Test individual sync functions:

```javascript
describe('SyncService', () => {
  it('should sync inventory successfully', async () => {
    const service = new SyncService(config);
    await service.syncInventory();
    expect(service.state.lastSync.inventory).toBeDefined();
  });
  
  it('should queue failed syncs', async () => {
    const service = new SyncService(config);
    // Mock network failure
    service.apiRequest = jest.fn().mockRejectedValue(new Error('timeout'));
    await service.syncInventory();
    expect(service.state.queue.length).toBe(1);
  });
});
```

### Integration Tests

Test end-to-end sync flow:

```javascript
describe('Sync Integration', () => {
  it('should sync data from edge to central', async () => {
    // Start edge sync service
    const edgeService = new SyncService(edgeConfig);
    await edgeService.start();
    
    // Update local inventory
    await updateLocalInventory(testData);
    
    // Wait for sync
    await sleep(5 * 60 * 1000);
    
    // Verify data in central
    const centralData = await fetchFromCentral('/api/sync/inventory');
    expect(centralData).toMatchObject(testData);
  });
});
```

### Load Tests

Test performance under load:

```bash
# 100 concurrent edge devices
artillery run --count 100 sync-load-test.yml

# Metrics:
# - Requests per second: 500
# - Average latency: 50ms
# - 99th percentile: 200ms
# - Error rate: <0.1%
```

## Deployment

### Environment Variables

```bash
# GreenReach Central
GREENREACH_CENTRAL_URL=https://api.greenreach.com
GREENREACH_WS_URL=wss://api.greenreach.com/ws

# Farm Credentials
FARM_ID=GR-17350001001
GREENREACH_API_KEY=your-api-key
GREENREACH_API_SECRET=your-api-secret

# Sync Configuration
SYNC_INVENTORY_INTERVAL=300000  # 5 minutes
SYNC_HEALTH_INTERVAL=30000      # 30 seconds
SYNC_CONFIG_INTERVAL=86400000   # 24 hours

# Retry Configuration
SYNC_MAX_RETRIES=5
SYNC_RETRY_DELAY=5000           # 5 seconds
SYNC_RETRY_BACKOFF=2            # Exponential multiplier
```

### Service Management

**Start Sync Service:**
```bash
# Via systemd
sudo systemctl start greenreach-sync

# Via PM2
pm2 start ecosystem.config.cjs --only greenreach-sync
```

**Monitor Sync Service:**
```bash
# Service status
sudo systemctl status greenreach-sync

# Live logs
journalctl -u greenreach-sync -f

# PM2 monitoring
pm2 monit greenreach-sync
```

**Restart on Failure:**
```ini
# /etc/systemd/system/greenreach-sync.service
[Service]
Restart=on-failure
RestartSec=5s
StartLimitInterval=60s
StartLimitBurst=3
```

## Troubleshooting

### Sync Not Working

**Symptoms:** No data syncing to Central

**Diagnosis:**
1. Check connection status:
   ```bash
   curl http://localhost:3000/api/sync/status
   ```
2. Verify credentials:
   ```bash
   echo $GREENREACH_API_KEY
   echo $GREENREACH_API_SECRET
   ```
3. Test Central API:
   ```bash
   curl -H "Authorization: Bearer $GREENREACH_API_KEY" \
        https://api.greenreach.com/health
   ```

**Solutions:**
- Restart sync service
- Verify network connectivity
- Check Central API status
- Regenerate API credentials

### Queue Building Up

**Symptoms:** Queue size increasing, not processing

**Diagnosis:**
1. Check queue status:
   ```bash
   curl http://localhost:3000/api/sync/status | jq .queueSize
   ```
2. View queue items:
   ```bash
   sqlite3 /var/lib/greenreach/sync.db "SELECT * FROM sync_queue;"
   ```

**Solutions:**
- Manually process queue:
  ```bash
  curl -X POST http://localhost:3000/api/sync/process-queue
  ```
- Clear old items:
  ```bash
  sqlite3 /var/lib/greenreach/sync.db "DELETE FROM sync_queue WHERE timestamp < datetime('now', '-24 hours');"
  ```

### High Sync Errors

**Symptoms:** Many sync failures in logs

**Diagnosis:**
1. Check error counts:
   ```bash
   grep "sync error" /var/log/greenreach/sync.log | wc -l
   ```
2. View recent errors:
   ```bash
   tail -100 /var/log/greenreach/sync.log | grep ERROR
   ```

**Solutions:**
- Increase retry delay
- Check network stability
- Verify Central API health
- Contact support if persistent

---

**Document Version:** 1.0.0  
**Last Updated:** 2024-01-15  
**Maintained By:** GreenReach Engineering Team  
**License:** Proprietary - GreenReach Systems, Inc.
