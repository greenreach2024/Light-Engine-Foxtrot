# Order Status Callbacks Documentation

## Overview
Farm-to-Central order status notification system implemented for real-time wholesale order tracking.

## Architecture

### Farm Side (`farm-admin.js`)
- **Function**: `notifyCentralOfStatusChange(orderId, newStatus)`
- **Trigger**: Called after `updateOrderStatus()` saves status locally
- **Endpoint**: `POST {centralUrl}/api/wholesale/order-status`
- **Behavior**: Non-blocking (logs warning if Central unavailable)

### Central Side (`greenreach-central/routes/wholesale.js`)
- **Endpoint**: `POST /api/wholesale/order-status`
- **Authentication**: None (farm-authenticated via order ownership)
- **Updates**: Memory store `fulfillment_status` field
- **Response**: JSON confirmation or 404 if order not found

## Request Format
```json
{
  "order_id": "WS-1234567890",
  "status": "packed",
  "farm_id": "demo-farm-001",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## Response Format
```json
{
  "status": "ok",
  "message": "Order status updated",
  "order_id": "WS-1234567890",
  "new_status": "packed"
}
```

## Status Flow
1. **pending** → Initial state when order created
2. **packed** → Farm marks order ready to ship
3. **shipped** → Farm adds tracking info and ships

## Error Handling
- **Farm**: Logs warning, continues (status saved locally)
- **Central**: Returns 404 if order not found
- **Network**: Gracefully degrades (local status preserved)

## Configuration
```javascript
// Farm determines Central URL from data/farm.json:
{
  "centralUrl": "https://greenreach-central.com",
  "farmId": "farm-001"
}
```

Default: `http://localhost:3000` (dev mode)

## Testing
```bash
# Test callback endpoint
curl -X POST http://localhost:3000/api/wholesale/order-status \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "WS-1234567890",
    "status": "packed",
    "farm_id": "demo-farm",
    "timestamp": "2024-01-15T10:00:00Z"
  }'
```

## Future Enhancements
- [ ] Email notifications to buyers on status change
- [ ] Audit trail logging
- [ ] Analytics events (order lifecycle tracking)
- [ ] Webhook authentication (HMAC signatures)
- [ ] Retry logic for failed callbacks
