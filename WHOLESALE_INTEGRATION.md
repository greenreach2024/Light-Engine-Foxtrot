# Wholesale Integration Guide

## Overview

GreenReach's Wholesale Integration connects edge device farms to the GreenReach Central wholesale marketplace, enabling automated catalog synchronization, order fulfillment, and multi-farm inventory management.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Edge Device (Farm)                        │
│                                                              │
│  ┌────────────┐      ┌──────────────┐     ┌──────────────┐ │
│  │  Inventory │─────►│  Wholesale   │────►│   Catalog    │ │
│  │  Database  │      │ Integration  │     │     Sync     │ │
│  └────────────┘      │   Service    │     └──────┬───────┘ │
│                      └───────┬──────┘            │         │
│                              │                    │         │
│                              │ Orders             │ mTLS    │
│                              │ Webhooks           │         │
│                              ▼                    │         │
│                      ┌──────────────┐            │         │
│                      │    Order     │            │         │
│                      │  Management  │            │         │
│                      └──────────────┘            │         │
└──────────────────────────────────────────────────┼─────────┘
                                                    │
                              ┌─────────────────────▼─────────┐
                              │ GreenReach Central Wholesale  │
                              │                               │
                              │ • Catalog API                 │
                              │ • Order Management            │
                              │ • Multi-Farm Coordination     │
                              │ • Payment Processing          │
                              └───────────────────────────────┘
```

## Features

### 1. Automatic Catalog Synchronization

**What it does:**
- Syncs farm inventory to GreenReach wholesale catalog
- Updates product availability in real-time
- Manages pricing (wholesale vs retail)
- Tracks reserved inventory

**Sync intervals:**
- Catalog: Every 5 minutes
- Pricing: Every 15 minutes
- Availability: Real-time on order placement

**Data synchronized:**
```json
{
  "productId": "lettuce-romaine-001",
  "farmId": "GR-17350001001",
  "name": "Organic Romaine Lettuce",
  "category": "leafy-greens",
  "sku": "RL-ORG-001",
  "quantity": 500,
  "unit": "lb",
  "wholesalePrice": 2.10,
  "retailPrice": 3.00,
  "organic": true,
  "harvestDate": "2024-12-19T00:00:00Z",
  "shelfLife": 7,
  "certifications": ["USDA Organic", "GAP Certified"],
  "available": true
}
```

### 2. Order Webhook Handling

**Flow:**
1. GreenReach Central receives wholesale order
2. Webhook sent to edge device(s) with order details
3. Edge device validates webhook signature
4. Order created in local database
5. Inventory reserved automatically
6. Confirmation sent to Central

**Webhook payload:**
```json
{
  "orderId": "WO-20241219-0001",
  "buyerId": "buyer-restaurant-123",
  "farmId": "GR-17350001001",
  "items": [
    {
      "productId": "lettuce-romaine-001",
      "farmId": "GR-17350001001",
      "quantity": 50,
      "unit": "lb",
      "wholesalePrice": 2.10,
      "total": 105.00
    }
  ],
  "total": 105.00,
  "deliveryDate": "2024-12-20T00:00:00Z",
  "timestamp": "2024-12-19T10:30:00Z",
  "signature": "a1b2c3d4e5f6..."
}
```

**Signature verification:**
```javascript
// HMAC-SHA256 signature verification
const payload = JSON.stringify({
  orderId: data.orderId,
  timestamp: data.timestamp
});

const hmac = crypto.createHmac('sha256', apiSecret);
hmac.update(payload);
const expectedSignature = hmac.digest('hex');

// Constant-time comparison
const valid = crypto.timingSafeEqual(
  Buffer.from(data.signature),
  Buffer.from(expectedSignature)
);
```

### 3. Inventory Reservation

**Purpose:**
- Prevent overselling
- Track committed inventory
- Support multi-farm orders

**Reservation lifecycle:**
```
Order Received → Reserve Inventory → Order Fulfilled → Release & Deduct
                                  → Order Canceled → Release Only
```

**Example:**
```
Initial Inventory: 500 lb
Order 1: Reserve 50 lb    → Available: 450 lb
Order 2: Reserve 100 lb   → Available: 350 lb
Order 1: Fulfill          → Reserved: 100 lb, Inventory: 450 lb
Order 2: Cancel           → Reserved: 0 lb, Inventory: 450 lb
```

### 4. Order Fulfillment

**Process:**
1. Farmer prepares order
2. Generate shipping label
3. Update order status to "fulfilled"
4. Deduct from actual inventory
5. Release reservation
6. Send fulfillment notification to Central

**Fulfillment data:**
```json
{
  "orderId": "WO-20241219-0001",
  "status": "fulfilled",
  "fulfilledAt": "2024-12-19T14:00:00Z",
  "trackingNumber": "1Z999AA10123456784",
  "carrier": "UPS",
  "items": [
    {
      "productId": "lettuce-romaine-001",
      "quantity": 50,
      "unit": "lb"
    }
  ]
}
```

### 5. Multi-Farm Orders

**Scenario:**
Buyer orders 200 lb lettuce, but single farm only has 150 lb.

**Solution:**
1. Central splits order across multiple farms
2. Farm A receives webhook: 150 lb
3. Farm B receives webhook: 50 lb
4. Each farm fulfills independently
5. Central coordinates delivery

**Order structure:**
```json
{
  "orderId": "WO-20241219-0001",
  "multiPart": true,
  "parts": [
    {
      "partId": "WO-20241219-0001-A",
      "farmId": "GR-17350001001",
      "quantity": 150
    },
    {
      "partId": "WO-20241219-0001-B",
      "farmId": "GR-17350001002",
      "quantity": 50
    }
  ]
}
```

## API Reference

### Status & Control

#### Get Wholesale Status
```
GET /api/wholesale/status
```

**Response:**
```json
{
  "enabled": true,
  "lastCatalogSync": 1734612000000,
  "lastPriceSync": 1734611500000,
  "pendingOrders": 3,
  "reservedItems": 5,
  "catalogSyncInterval": 300000,
  "priceSyncInterval": 900000,
  "farmId": "GR-17350001001"
}
```

#### Enable Wholesale Integration
```
POST /api/wholesale/enable
```

**Response:**
```json
{
  "success": true,
  "enabled": true
}
```

#### Disable Wholesale Integration
```
POST /api/wholesale/disable
```

**Response:**
```json
{
  "success": true,
  "enabled": false
}
```

### Catalog & Pricing

#### Trigger Catalog Sync
```
POST /api/wholesale/sync/catalog
```

**Response:**
```json
{
  "success": true,
  "result": {
    "itemsSynced": 25,
    "timestamp": "2024-12-19T10:00:00Z"
  }
}
```

#### Trigger Price Sync
```
POST /api/wholesale/sync/pricing
```

**Response:**
```json
{
  "success": true,
  "result": {
    "itemsUpdated": 25,
    "timestamp": "2024-12-19T10:00:00Z"
  }
}
```

### Order Management

#### Receive Order Webhook
```
POST /api/wholesale/webhook/order
```

**Request:**
```json
{
  "orderId": "WO-20241219-0001",
  "buyerId": "buyer-123",
  "farmId": "GR-17350001001",
  "items": [...],
  "total": 105.00,
  "timestamp": "2024-12-19T10:30:00Z",
  "signature": "a1b2c3d4..."
}
```

**Response:**
```json
{
  "success": true,
  "order": {
    "id": "WO-20241219-0001",
    "status": "pending",
    "createdAt": "2024-12-19T10:30:00Z"
  }
}
```

#### Get Pending Orders
```
GET /api/wholesale/orders/pending
```

**Response:**
```json
{
  "count": 3,
  "orders": [
    {
      "id": "WO-20241219-0001",
      "buyerId": "buyer-123",
      "items": [...],
      "total": 105.00,
      "status": "pending",
      "createdAt": "2024-12-19T10:30:00Z"
    }
  ]
}
```

#### Get Order Details
```
GET /api/wholesale/orders/:orderId
```

**Response:**
```json
{
  "order": {
    "id": "WO-20241219-0001",
    "farmId": "GR-17350001001",
    "buyerId": "buyer-123",
    "items": [...],
    "total": 105.00,
    "status": "pending",
    "createdAt": "2024-12-19T10:30:00Z"
  }
}
```

#### Fulfill Order
```
POST /api/wholesale/orders/:orderId/fulfill
```

**Request:**
```json
{
  "trackingNumber": "1Z999AA10123456784",
  "carrier": "UPS",
  "shippingLabel": "https://..."
}
```

**Response:**
```json
{
  "success": true,
  "order": {
    "id": "WO-20241219-0001",
    "status": "fulfilled",
    "fulfilledAt": "2024-12-19T14:00:00Z",
    "trackingNumber": "1Z999AA10123456784"
  }
}
```

#### Cancel Order
```
POST /api/wholesale/orders/:orderId/cancel
```

**Request:**
```json
{
  "reason": "Insufficient inventory"
}
```

**Response:**
```json
{
  "success": true,
  "order": {
    "id": "WO-20241219-0001",
    "status": "canceled",
    "canceledAt": "2024-12-19T11:00:00Z",
    "cancelReason": "Insufficient inventory"
  }
}
```

### Inventory

#### Get Reserved Inventory
```
GET /api/wholesale/inventory/reserved
```

**Response:**
```json
{
  "count": 5,
  "reserved": [
    {
      "productId": "lettuce-romaine-001",
      "name": "Organic Romaine Lettuce",
      "reserved": 150,
      "available": 350
    }
  ]
}
```

## Event System

The wholesale integration service emits events for monitoring and integration:

### Events

```javascript
// Service initialization
wholesaleService.on('initialized', () => {
  console.log('Wholesale integration initialized');
});

// Catalog synced
wholesaleService.on('catalog_synced', (data) => {
  console.log(`Synced ${data.count} catalog items`);
});

// Pricing synced
wholesaleService.on('pricing_synced', (data) => {
  console.log(`Updated ${data.count} prices`);
});

// Order received
wholesaleService.on('order_received', (order) => {
  console.log(`New order: ${order.id}`);
  // Send notification to farmer
});

// Inventory reserved
wholesaleService.on('inventory_reserved', (data) => {
  console.log(`Reserved inventory for order ${data.orderId}`);
});

// Order fulfilled
wholesaleService.on('order_fulfilled', (order) => {
  console.log(`Order fulfilled: ${order.id}`);
});

// Order canceled
wholesaleService.on('order_canceled', (order) => {
  console.log(`Order canceled: ${order.id}`);
});

// Errors
wholesaleService.on('sync_error', (error) => {
  console.error('Sync error:', error);
});

wholesaleService.on('order_error', (error) => {
  console.error('Order error:', error);
});
```

## Configuration

### Environment Variables

```bash
# GreenReach Central URL
GREENREACH_CENTRAL_URL=https://api.greenreach.com

# Farm credentials
FARM_ID=GR-17350001001
GREENREACH_API_KEY=a1b2c3d4e5f6...
GREENREACH_API_SECRET=z9y8x7w6v5u4...

# Sync intervals (milliseconds)
CATALOG_SYNC_INTERVAL=300000  # 5 minutes
PRICE_SYNC_INTERVAL=900000    # 15 minutes

# Certificate paths (for mTLS)
CERT_DIR=/etc/greenreach/certs
```

### Service Configuration

```javascript
const wholesaleService = new WholesaleIntegrationService({
  centralUrl: 'https://api.greenreach.com',
  farmId: 'GR-17350001001',
  apiKey: 'a1b2c3d4e5f6...',
  apiSecret: 'z9y8x7w6v5u4...',
  certificateManager: certManager,
  inventoryDB: inventoryDatabase,
  ordersDB: ordersDatabase,
  catalogSyncInterval: 5 * 60 * 1000,    // 5 minutes
  priceSyncInterval: 15 * 60 * 1000      // 15 minutes
});

await wholesaleService.initialize();
```

## Security

### Webhook Signature Verification

**Required for all webhooks:**
- HMAC-SHA256 signature
- Timestamp validation (prevent replay attacks)
- Constant-time comparison

**Example:**
```javascript
function verifyWebhook(data, secret) {
  // Check timestamp (reject if >5 minutes old)
  const age = Date.now() - new Date(data.timestamp).getTime();
  if (age > 5 * 60 * 1000) {
    return false; // Too old
  }
  
  // Verify signature
  const payload = JSON.stringify({
    orderId: data.orderId,
    timestamp: data.timestamp
  });
  
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const expectedSig = hmac.digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(data.signature),
    Buffer.from(expectedSig)
  );
}
```

### Mutual TLS (mTLS)

All communication with GreenReach Central uses mutual TLS authentication:

```javascript
const tlsOptions = certificateManager.getTLSOptions();

const requestOptions = {
  hostname: 'api.greenreach.com',
  port: 443,
  path: '/api/wholesale/catalog/sync',
  method: 'POST',
  cert: tlsOptions.cert,
  key: tlsOptions.key,
  ca: tlsOptions.ca,
  rejectUnauthorized: true
};
```

## Testing

### Manual Testing

#### 1. Test Catalog Sync
```bash
curl -X POST http://localhost:3000/api/wholesale/sync/catalog \
  -H "Authorization: Bearer $API_KEY"
```

#### 2. Test Order Webhook
```bash
curl -X POST http://localhost:3000/api/wholesale/webhook/order \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "WO-TEST-001",
    "buyerId": "buyer-test",
    "farmId": "GR-17350001001",
    "items": [
      {
        "productId": "lettuce-romaine-001",
        "quantity": 10,
        "wholesalePrice": 2.10
      }
    ],
    "total": 21.00,
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "signature": "test-signature"
  }'
```

#### 3. Test Order Fulfillment
```bash
curl -X POST http://localhost:3000/api/wholesale/orders/WO-TEST-001/fulfill \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "trackingNumber": "1Z999AA10123456784",
    "carrier": "UPS"
  }'
```

### Multi-Farm Order Testing

**Scenario:** Order spans 2 farms

1. **Setup:** Create inventory on both farms
   ```bash
   # Farm A: 150 lb available
   # Farm B: 100 lb available
   ```

2. **Place order:** 200 lb total
   ```bash
   # Central splits order:
   # Farm A: 150 lb
   # Farm B: 50 lb
   ```

3. **Verify reservations:**
   ```bash
   curl http://localhost:3000/api/wholesale/inventory/reserved
   ```

4. **Fulfill from each farm:**
   ```bash
   # Farm A fulfills 150 lb
   # Farm B fulfills 50 lb
   ```

5. **Verify completion:**
   ```bash
   # Both parts marked fulfilled
   # Central marks master order fulfilled
   ```

## Troubleshooting

### Catalog Not Syncing

**Symptoms:**
- `lastCatalogSync` is null or old
- Products not appearing in wholesale catalog

**Solutions:**
1. Check service enabled:
   ```bash
   curl http://localhost:3000/api/wholesale/status
   ```

2. Verify credentials:
   ```bash
   echo $GREENREACH_API_KEY
   echo $GREENREACH_API_SECRET
   ```

3. Check network connectivity:
   ```bash
   curl https://api.greenreach.com/health
   ```

4. Review logs:
   ```bash
   tail -f logs/wholesale.log
   ```

5. Trigger manual sync:
   ```bash
   curl -X POST http://localhost:3000/api/wholesale/sync/catalog
   ```

### Order Webhook Failed

**Symptoms:**
- Order not created locally
- Webhook returns 500 error
- "Invalid webhook signature" error

**Solutions:**
1. Verify webhook signature:
   - Check API secret matches Central
   - Verify timestamp is recent (<5 minutes)
   - Test with known-good signature

2. Check inventory availability:
   ```bash
   curl http://localhost:3000/api/wholesale/inventory/reserved
   ```

3. Verify order doesn't already exist:
   ```bash
   curl http://localhost:3000/api/wholesale/orders/WO-xxxxx
   ```

4. Check database:
   ```bash
   # Ensure orders database is writable
   ls -la data/orders.db
   ```

### Inventory Reservation Issues

**Symptoms:**
- "Insufficient inventory" errors
- Reserved quantity incorrect
- Can't fulfill order

**Solutions:**
1. Check reserved inventory:
   ```bash
   curl http://localhost:3000/api/wholesale/inventory/reserved
   ```

2. Verify actual inventory:
   ```bash
   curl http://localhost:3000/api/inventory
   ```

3. Release stuck reservations:
   ```javascript
   // Cancel order to release reservation
   await wholesaleService.cancelOrder('WO-xxxxx', 'Manual release');
   ```

4. Reset reservations (emergency):
   ```javascript
   wholesaleService.state.reservedInventory.clear();
   await wholesaleService.saveState();
   ```

### Fulfillment Notification Failed

**Symptoms:**
- Order fulfilled locally but not in Central
- "Failed to send fulfillment notification" error

**Solutions:**
1. Check mTLS certificates:
   ```bash
   curl http://localhost:3000/api/certs/status
   ```

2. Verify network connectivity:
   ```bash
   curl -v https://api.greenreach.com/health
   ```

3. Retry manually:
   ```bash
   curl -X POST http://localhost:3000/api/wholesale/orders/WO-xxxxx/fulfill \
     -H "Authorization: Bearer $API_KEY" \
     -d '{"trackingNumber": "...", "carrier": "UPS"}'
   ```

4. Check Central API status:
   - Visit GreenReach Central status page
   - Contact support if API is down

## Best Practices

### 1. Inventory Management

✅ **DO:**
- Sync catalog every 5 minutes (default)
- Monitor reserved inventory regularly
- Set buffer stock for popular items
- Update harvest dates promptly
- Include accurate shelf life

❌ **DON'T:**
- Manually adjust reserved quantities
- Override inventory without syncing
- Forget to release canceled reservations
- List expired products

### 2. Order Fulfillment

✅ **DO:**
- Fulfill orders within SLA timeframe
- Include accurate tracking numbers
- Notify Central immediately on fulfillment
- Package carefully to maintain quality
- Communicate delays proactively

❌ **DON'T:**
- Mark as fulfilled before shipping
- Use fake tracking numbers
- Skip fulfillment notifications
- Ship damaged products

### 3. Pricing

✅ **DO:**
- Review wholesale prices weekly
- Offer volume discounts
- Update pricing during sync
- Communicate price changes in advance
- Consider seasonal adjustments

❌ **DON'T:**
- Change prices mid-order
- Undercut retail pricing excessively
- Ignore market rates
- Hard-code prices

### 4. Multi-Farm Coordination

✅ **DO:**
- Maintain accurate availability
- Communicate with other farms
- Coordinate delivery times
- Share best practices
- Report issues promptly

❌ **DON'T:**
- Compete on same-day orders
- Over-promise availability
- Delay fulfillment for partial orders
- Ignore Central coordination

## Performance Optimization

### Reduce Sync Frequency

For farms with stable inventory:
```javascript
catalogSyncInterval: 15 * 60 * 1000  // 15 minutes instead of 5
```

### Batch Operations

Sync multiple items in single request:
```javascript
// Good: Single request with 25 items
await wholesaleService.syncCatalog();

// Bad: 25 separate requests
for (const item of inventory) {
  await syncSingleItem(item);
}
```

### Cache Inventory Queries

```javascript
// Cache inventory for 1 minute
const cache = new Map();
const CACHE_TTL = 60 * 1000;

async function getCachedInventory() {
  const now = Date.now();
  if (cache.has('inventory') && cache.get('timestamp') > now - CACHE_TTL) {
    return cache.get('inventory');
  }
  
  const inventory = await getInventory();
  cache.set('inventory', inventory);
  cache.set('timestamp', now);
  return inventory;
}
```

## Support

**Technical Issues:**
- Email: support@greenreach.com
- Phone: 1-800-473-3673
- Hours: 8am-8pm EST, 7 days/week

**Integration Help:**
- Documentation: https://docs.greenreach.com/wholesale
- API Reference: https://api.greenreach.com/docs
- Developer Portal: https://developers.greenreach.com

**Emergency (Production Down):**
- Pager: +1-800-EMERGENCY
- 24/7 on-call support

---

**Document Version:** 1.0.0  
**Last Updated:** 2024-12-19  
**Maintained By:** GreenReach Integration Team  
**License:** Proprietary - GreenReach Systems, Inc.
