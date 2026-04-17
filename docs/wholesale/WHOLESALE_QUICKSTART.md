# GreenReach Wholesale System - Quick Start Guide

**Last Updated:** December 22, 2025  
**Status:** Production-Ready (pending configuration)

---

## Overview

Complete wholesale ordering system connecting farms with buyers through an automated verification and logistics optimization platform.

**Production Readiness: 92/100** ✅

---

## Installation

### Prerequisites

- Node.js 18+
- PostgreSQL 15+
- Python 3.9+ (for farm-side inventory)

### Setup

```bash
# Clone repository
git clone https://github.com/greenreach2024/Light-Engine-Foxtrot.git
cd Light-Engine-Foxtrot

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Run database migrations
alembic upgrade head

# Start server
npm start
```

---

## Configuration (Required - 2-4 hours)

### Step 1: Run Setup Wizard

```bash
npm run setup:notifications
```

This interactive wizard will guide you through:
1. Twilio setup (SMS notifications)
2. Firebase setup (Push notifications)
3. SMTP setup (Email notifications)

### Step 2: Manual Configuration

If you prefer manual setup:

#### Twilio (SMS)
1. Create account: https://www.twilio.com/try-twilio
2. Get trial credits ($20 free)
3. Copy credentials to .env:
   ```bash
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxx
   TWILIO_AUTH_TOKEN=xxxxxxxxxx
   TWILIO_PHONE_NUMBER=+16135551234
   ```

#### Firebase (Push)
1. Create project: https://console.firebase.google.com
2. Enable Cloud Messaging
3. Use keyless auth on GCP/Cloud Run (recommended)
4. For local-only fallback, store service account JSON outside this repo
5. Add to .env:
   ```bash
   FIREBASE_ENABLED=true
   # Optional local fallback only:
   # GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/outside/repo/firebase-service-account.json
   # FIREBASE_SERVICE_ACCOUNT_PATH=/absolute/path/outside/repo/firebase-service-account.json
   ```

#### Square (Payments)
```bash
SQUARE_ACCESS_TOKEN=xxxxxxxxxx
SQUARE_LOCATION_ID=xxxxxxxxxx
SQUARE_BROKER_MERCHANT_ID=xxxxxxxxxx
```

---

## Testing

### Test Overselling Prevention

```bash
npm run test:overselling
```

Expected output:
```
✅ ALL TESTS PASSED
  ✅ Reservation system prevents overselling
  ✅ Concurrent orders correctly rejected
  ✅ Inventory released successfully
  ✅ Can reserve after release
```

### Test Notifications

```bash
TEST_EMAIL=your@email.com npm run test:notifications
```

Optional with SMS:
```bash
TEST_EMAIL=your@email.com TEST_PHONE=+16135551234 npm run test:notifications
```

Expected output:
```
✅ Core notification system working!
  ✅ Email
  ✅ SMS (or ⚠️ not configured)
  ⚠️ Push (requires device)
```

---

## Usage

### For Buyers

1. **Browse Catalog**
   - Visit: http://localhost:8091/wholesale.html
   - Register as buyer
   - View available products from network farms

2. **Place Order**
   - Add products to cart
   - System automatically selects optimal farms (logistics optimization)
   - Enter delivery details
   - Complete payment authorization

3. **Track Order**
   - Farms have 24 hours to verify
   - Receive notifications on status changes
   - View logistics summary (farms, distances, clusters)

### For Farms

1. **Receive Order Notification**
   - Email + SMS + Push notification
   - View order details
   - See verification deadline

2. **Verify Order**
   - Accept (no changes)
   - Modify (adjust quantity/price)
   - Decline (if can't fulfill)

3. **Fulfill Order**
   - Prepare products
   - Mark as ready for pickup
   - Receive payment after fulfillment

### For Admins

1. **Monitor Network**
   - Dashboard: http://localhost:8091/wholesale-admin.html
   - View farm health (sync status)
   - Track orders and payments
   - Monitor performance metrics

2. **Manage Logistics**
   - Configure optimization presets
   - Adjust scoring weights
   - Set radius restrictions
   - View route efficiency

---

## Key Features

### 🔒 Overselling Prevention
- Atomic multi-farm reservations
- Real-time inventory sync (60s intervals)
- ATP calculation (Available-to-Promise)
- Automatic rollback on failures

### 📱 Multi-Channel Notifications
- **Email:** Detailed order information
- **SMS:** Urgent alerts (< 6 hours to deadline)
- **Push:** Real-time notifications with tap-to-open

### 🚚 Logistics Optimization
- 6-factor farm selection algorithm
- Geographic clustering (25km radius)
- Route efficiency scoring
- Smart trade-offs (clustered vs. isolated)

### ⏰ Verification Workflow
- 24-hour deadline with progressive reminders
- Alternative farm matching (3 rounds, expanding radius)
- Automatic refunds if no alternatives found
- Quality scoring based on response time

### 📊 Performance Analytics
- Farm quality scores (100-point scale)
- Acceptance rate tracking
- Response time monitoring
- Weekly performance reports

---

## API Endpoints

### Inventory Management

```bash
# Get farm inventory
GET /api/wholesale/inventory

# Reserve inventory
POST /api/wholesale/inventory/reserve
{
  "order_id": "wo-123",
  "items": [{"sku_id": "SKU-ARUGULA-5LB", "quantity": 10}]
}

# Confirm reservation (after payment)
POST /api/wholesale/inventory/confirm
{
  "order_id": "wo-123",
  "payment_id": "pay-456"
}

# Release reservation (cancel)
POST /api/wholesale/inventory/release
{
  "order_id": "wo-123",
  "reason": "Order cancelled by buyer"
}

# Rollback deduction (refund)
POST /api/wholesale/inventory/rollback
{
  "order_id": "wo-123",
  "reason": "Buyer refund - product quality issue"
}
```

### Order Management

```bash
# Create order
POST /api/wholesale/orders/create
{
  "buyer_id": "buyer-123",
  "items": [...],
  "delivery_address": "...",
  "filters": {"organic": true, "locallyGrown": true}
}

# Farm verification
POST /api/wholesale/orders/farm-verify
{
  "farm_id": "farm-123",
  "sub_order_id": "sub-456",
  "action": "accept|decline|modify",
  "modifications": {...}
}
```

### Logistics Configuration

```bash
# Get current config
GET /api/logistics/config

# Update config
POST /api/logistics/config
{
  "maxRadius": 150,
  "preferredRadius": 75,
  "weights": {
    "productMatch": 30,
    "certifications": 20,
    "distance": 20,
    "clustering": 15,
    "quality": 10,
    "price": 5
  }
}

# Apply preset
POST /api/logistics/config/apply-preset/balanced
```

---

## Cron Jobs

### Deadline Monitor (Every 5 minutes)
```bash
*/5 * * * * cd /path/to/app && node services/deadline-monitor.js
```

### Reservation Cleanup (Every hour)
```bash
0 * * * * cd /path/to/app && node scripts/cleanup-expired-reservations.js
```

### Weekly Reports (Monday 9am)
```bash
0 9 * * 1 cd /path/to/app && node scripts/send-weekly-reports.js
```

---

## Troubleshooting

### Overselling Still Occurring

1. Check reservation system is being called:
   ```bash
   npm run test:overselling
   ```

2. Verify inventory endpoint returns ATP:
   ```bash
   curl http://localhost:8091/api/wholesale/inventory
   # Check qty_available, qty_reserved, qty_deducted fields
   ```

3. Check reservation files exist:
   ```bash
   ls public/data/wholesale-*.json
   ```

### Notifications Not Sending

1. Test email configuration:
   ```bash
   TEST_EMAIL=your@email.com npm run test:notifications
   ```

2. Check credentials in .env:
   ```bash
   echo $SMTP_HOST $SMTP_USER
   echo $TWILIO_ACCOUNT_SID
   ```

3. Review logs for errors:
   ```bash
   grep -i "notification" logs/server.log
   ```

### Payment Failures

1. Verify Square credentials:
   ```bash
   echo $SQUARE_ACCESS_TOKEN $SQUARE_LOCATION_ID
   ```

2. Check environment (sandbox vs production):
   ```bash
   echo $SQUARE_ENVIRONMENT
   ```

3. Use manual invoicing for pilot:
   - Create order with `payment_method: 'manual'`
   - Admin marks paid after receiving payment

---

## Production Deployment

### Environment Variables

**Required:**
```bash
DATABASE_URL=postgresql://...
SQUARE_ACCESS_TOKEN=...
SQUARE_LOCATION_ID=...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...
FIREBASE_ENABLED=true
SMTP_HOST=...
SMTP_USER=...
SMTP_PASS=...
```

**Optional:**
```bash
WHOLESALE_COMMISSION_RATE=0.12
WHOLESALE_NETWORK_SYNC_MS=60000
APP_URL=https://central.greenreach.ca
```

### Deployment Checklist

- [ ] Run `npm run setup:notifications`
- [ ] Run `alembic upgrade head`
- [ ] Run `npm run test:overselling` (must pass)
- [ ] Run `npm run test:notifications` (email must pass)
- [ ] Configure cron jobs
- [ ] Set up monitoring (Sentry/Datadog)
- [ ] Configure backups
- [ ] Set up SSL certificate
- [ ] Test end-to-end order flow
- [ ] Pilot with 2-3 farms
- [ ] Launch publicly

---

## Support

**Documentation:**
- Implementation Guide: `WHOLESALE_IMPLEMENTATION_COMPLETE.md`
- Readiness Report: `WHOLESALE_READINESS_REPORT_UPDATED.md`
- Logistics Optimization: `FARM_SELECTION_LOGISTICS.md`
- Mobile Notifications: `MOBILE_NOTIFICATION_SETUP.md`

**Contact:**
- Technical Support: dev@greenreach.ca
- Farm Support: farms@greenreach.ca
- Buyer Support: orders@greenreach.ca

---

## License

Proprietary - GreenReach Farms Inc.

---

**System Status: PRODUCTION-READY ✅**  
**Configuration Time: 2-4 hours**  
**Launch Timeline: 2-3 days pilot testing**
