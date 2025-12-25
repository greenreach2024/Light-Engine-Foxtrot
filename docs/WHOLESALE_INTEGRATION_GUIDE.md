# Wholesale Marketplace Integration Guide

Complete guide for integrating with the Light Engine wholesale marketplace as a buyer or seller.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Seller Setup](#seller-setup)
4. [Buyer Setup](#buyer-setup)
5. [Product Catalog](#product-catalog)
6. [Order Fulfillment](#order-fulfillment)
7. [Payments & Invoicing](#payments--invoicing)
8. [API Integration](#api-integration)
9. [Webhooks](#webhooks)
10. [Troubleshooting](#troubleshooting)

## Overview

The Light Engine wholesale marketplace connects farms (sellers) with buyers (restaurants, retailers, distributors) for direct B2B transactions.

**Key Features:**
- **Real-time inventory**: Sellers list available inventory with live updates
- **Automated pricing**: Dynamic pricing based on crop, quality, and market rates
- **Order management**: Complete order lifecycle from quote to delivery
- **Multi-farm network**: Buyers source from multiple farms in one transaction
- **SLA guarantees**: Service level agreements for quality and delivery
- **Payment integration**: Square, Stripe, or invoice-based payments
- **Fulfillment tracking**: Real-time order status from preparation to delivery

**Access Tiers:**
- **Inventory-only**: Full marketplace access without automation hardware
- **Full**: Marketplace + automation and environmental control
- **Enterprise**: Marketplace + API access + priority support

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    GreenReach Network                     │
│                    (Marketplace Hub)                      │
└────┬─────────────────────────────────────────────┬───────┘
     │                                             │
     ▼                                             ▼
┌─────────────────────┐                  ┌─────────────────┐
│   Seller Farms      │                  │     Buyers      │
│   - Farm A (cloud)  │                  │   - Restaurant  │
│   - Farm B (edge)   │◄────orders──────►│   - Retailer    │
│   - Farm C (edge)   │                  │   - Distributor │
└─────────────────────┘                  └─────────────────┘
     │                                             │
     ▼                                             ▼
┌─────────────────────┐                  ┌─────────────────┐
│  Farm Dashboard     │                  │  Buyer Portal   │
│  - Inventory mgmt   │                  │  - Browse farms │
│  - Order prep       │                  │  - Place orders │
│  - Analytics        │                  │  - Track status │
└─────────────────────┘                  └─────────────────┘
```

### Data Flow

1. **Inventory Publishing**: Farms push real-time inventory to marketplace
2. **Discovery**: Buyers browse available products by location, crop, price
3. **Ordering**: Buyers place orders, farms receive notifications
4. **Confirmation**: Farms accept/reject orders, set pickup/delivery time
5. **Fulfillment**: Farms prepare orders, buyers receive status updates
6. **Delivery**: Buyers pick up or receive delivery, confirm receipt
7. **Payment**: Automatic charge/invoice generation
8. **Review**: Buyers rate quality, farms build reputation

## Seller Setup

### Enable Wholesale (Existing Farms)

Wholesale is enabled for all license tiers. No additional activation required.

**Verify wholesale access:**

```bash
curl https://my-farm.greenreach.io/api/features
```

Response should include:
```json
{
  "features": {
    "wholesale": true,
    "wholesaleSelling": true,
    "wholesaleBuying": true
  }
}
```

### Configure Seller Profile

1. **Navigate to Wholesale Settings**:
   - Dashboard → Settings → Wholesale → Seller Profile

2. **Complete Profile**:
   ```json
   {
     "businessName": "Green Valley Farm",
     "businessType": "organic_farm",
     "address": {
       "street": "123 Farm Road",
       "city": "Boulder",
       "state": "CO",
       "zip": "80301"
     },
     "contact": {
       "name": "John Farmer",
       "email": "orders@greenvalley.com",
       "phone": "+1-303-555-0100"
     },
     "certifications": ["usda_organic", "gap_certified"],
     "deliveryOptions": {
       "pickup": true,
       "localDelivery": true,
       "deliveryRadius": 50,
       "shipping": false
     },
     "paymentMethods": ["credit_card", "invoice_net30"],
     "minimumOrder": 50.00,
     "orderLeadTime": 24
   }
   ```

3. **Upload Certifications**:
   - USDA Organic certificate
   - GAP certification
   - Liability insurance
   - Business license

4. **Set Business Hours**:
   ```json
   {
     "pickupHours": {
       "monday": {"open": "08:00", "close": "17:00"},
       "tuesday": {"open": "08:00", "close": "17:00"},
       "wednesday": {"open": "08:00", "close": "17:00"},
       "thursday": {"open": "08:00", "close": "17:00"},
       "friday": {"open": "08:00", "close": "17:00"},
       "saturday": {"open": "09:00", "close": "14:00"},
       "sunday": {"closed": true}
     }
   }
   ```

### Payment Processing Setup

**Option 1: Square Integration (Recommended)**

1. Dashboard → Settings → Payments → Connect Square
2. Click "Connect Square Account"
3. Login to Square (or create account)
4. Authorize Light Engine access
5. Select location for orders
6. Confirm connection

**Automatic features:**
- Credit card processing (2.9% + $0.30)
- Invoice generation
- Payment tracking
- Automatic reconciliation

**Option 2: Stripe Integration**

1. Dashboard → Settings → Payments → Connect Stripe
2. Login to Stripe account
3. Authorize connection
4. Configure webhook endpoint

**Option 3: Manual Invoicing**

1. Dashboard → Settings → Payments → Invoice Settings
2. Upload invoice template (PDF with {variables})
3. Set payment terms (Net 30, Net 60, Due on Receipt)
4. Configure invoice delivery (email, manual)

## Buyer Setup

### Create Buyer Account

**Method 1: Self-Registration**

1. Visit any farm's wholesale portal (e.g., https://greenvalley.greenreach.io/wholesale.html)
2. Click "New Buyer? Register"
3. Complete registration:
   - Business name and type
   - Contact information
   - Delivery address
   - Tax ID/resale certificate (optional)
4. Verify email address
5. Complete profile

**Method 2: Invitation from Farm**

Farms can invite buyers directly:

```bash
curl -X POST https://my-farm.greenreach.io/api/wholesale/buyers/invite \
  -H "Authorization: Bearer $FARM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "businessName": "Boulder Bistro",
    "email": "chef@boulderbistro.com",
    "phone": "+1-303-555-0200",
    "message": "Welcome to our wholesale program!"
  }'
```

### Configure Buyer Profile

1. **Business Information**:
   ```json
   {
     "businessName": "Boulder Bistro",
     "businessType": "restaurant",
     "taxId": "12-3456789",
     "resaleCertificate": true,
     "certifications": ["restaurant_license", "food_handlers"]
   }
   ```

2. **Delivery Preferences**:
   ```json
   {
     "deliveryAddress": {
       "street": "456 Main St",
       "city": "Boulder",
       "state": "CO",
       "zip": "80302"
     },
     "deliveryInstructions": "Loading dock in rear, ring bell",
     "deliveryWindow": {
       "start": "06:00",
       "end": "10:00"
     }
   }
   ```

3. **Payment Setup**:
   - Add credit card for instant payments
   - Or request Net 30 terms (requires approval)

4. **Notification Preferences**:
   - Email notifications for order updates
   - SMS for urgent alerts
   - Webhook URL for system integration

## Product Catalog

### List Products (Sellers)

**Automatic Inventory Sync:**

Light Engine automatically publishes available inventory to the marketplace based on:
- Current inventory levels
- Reserved quantities (for CSA, farmers markets, etc.)
- Wholesale allocation percentage

**Configure allocation:**

```bash
curl -X PUT https://my-farm.greenreach.io/api/wholesale/settings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "defaultAllocation": 50,
    "cropAllocations": {
      "lettuce": 75,
      "tomatoes": 60,
      "basil": 100
    }
  }'
```

**Manual Product Listing:**

1. Dashboard → Wholesale → Product Catalog
2. Click "Add Product"
3. Fill in details:
   - Product name and variety
   - Category (leafy greens, herbs, tomatoes, etc.)
   - Unit (lb, oz, bunch, head, case)
   - Price per unit
   - Minimum order quantity
   - Available quantity
   - Photos (up to 5)
   - Description
   - Growing practices (organic, hydroponic, etc.)

**Bulk Import:**

```bash
curl -X POST https://my-farm.greenreach.io/api/wholesale/products/import \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "products": [
      {
        "name": "Butterhead Lettuce",
        "variety": "Boston Bibb",
        "category": "leafy_greens",
        "unit": "head",
        "price": 3.50,
        "quantity": 200,
        "minOrder": 10
      }
    ]
  }'
```

### Browse Products (Buyers)

**Web Portal:**

1. Visit farm's wholesale portal
2. Browse by category or search
3. Filter by:
   - Price range
   - Availability date
   - Certifications (organic, GAP)
   - Delivery options
4. Add to cart

**API:**

```bash
# Search products
curl "https://greenvalley.greenreach.io/api/wholesale/catalog?category=leafy_greens&organic=true" \
  -H "Authorization: Bearer $BUYER_TOKEN"

# Get product details
curl "https://greenvalley.greenreach.io/api/wholesale/products/lettuce-butterhead-123" \
  -H "Authorization: Bearer $BUYER_TOKEN"
```

### Dynamic Pricing

**Volume Discounts:**

Configure tiered pricing:

```json
{
  "productId": "lettuce-butterhead-123",
  "basePrice": 3.50,
  "tiers": [
    {"min": 50, "discount": 5},
    {"min": 100, "discount": 10},
    {"min": 250, "discount": 15}
  ]
}
```

**Standing Orders:**

Buyers can set up recurring orders with special pricing:

```json
{
  "frequency": "weekly",
  "dayOfWeek": "monday",
  "products": [
    {
      "productId": "lettuce-butterhead-123",
      "quantity": 50,
      "customPrice": 3.15
    }
  ],
  "duration": 12
}
```

## Order Fulfillment

### Order Workflow

```
Buyer Places Order
       ↓
Farm Receives Notification
       ↓
Farm Accepts/Rejects (4 hour SLA)
       ↓
    Accepted?
      / \
    Yes  No → Buyer Notified → End
     ↓
Farm Prepares Order
     ↓
Mark Ready for Pickup/Delivery
     ↓
Buyer Picks Up / Farm Delivers
     ↓
Buyer Confirms Receipt
     ↓
Payment Processed
     ↓
Buyer Leaves Review
```

### Place Order (Buyer)

**Via Web Portal:**

1. Add products to cart
2. Review cart and quantities
3. Select delivery method:
   - Pickup (choose date/time)
   - Local delivery (choose window)
4. Add order notes
5. Review total with fees
6. Confirm order

**Via API:**

```bash
curl -X POST https://greenvalley.greenreach.io/api/wholesale/orders \
  -H "Authorization: Bearer $BUYER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "productId": "lettuce-butterhead-123",
        "quantity": 50,
        "unit": "head"
      },
      {
        "productId": "basil-italian-456",
        "quantity": 20,
        "unit": "bunch"
      }
    ],
    "deliveryMethod": "pickup",
    "pickupDate": "2025-12-26",
    "pickupTime": "10:00",
    "notes": "Please pack in our reusable containers"
  }'
```

### Accept Order (Seller)

**Auto-Accept:**

Configure automatic acceptance for trusted buyers:

```json
{
  "autoAccept": {
    "enabled": true,
    "trustedBuyersOnly": true,
    "maxOrderValue": 500.00,
    "availabilityCheck": true
  }
}
```

**Manual Acceptance:**

1. Dashboard → Wholesale → Orders → Pending
2. Review order details
3. Click "Accept" or "Reject"
4. If rejecting, provide reason

**API:**

```bash
# Accept order
curl -X POST https://my-farm.greenreach.io/api/wholesale/orders/ORD-123/accept \
  -H "Authorization: Bearer $FARM_TOKEN" \
  -d '{"estimatedReady": "2025-12-26T09:00:00Z"}'

# Reject order
curl -X POST https://my-farm.greenreach.io/api/wholesale/orders/ORD-123/reject \
  -H "Authorization: Bearer $FARM_TOKEN" \
  -d '{"reason": "Insufficient inventory due to weather"}'
```

### Prepare Order (Seller)

1. Dashboard → Wholesale → Orders → Accepted
2. Click order to view details
3. Print pick list or packing slip
4. Harvest/gather products
5. Pack according to buyer specifications
6. Update order status:
   - "Preparing" → "Packed" → "Ready"
7. Notify buyer when ready

**Mark order ready:**

```bash
curl -X POST https://my-farm.greenreach.io/api/wholesale/orders/ORD-123/ready \
  -H "Authorization: Bearer $FARM_TOKEN" \
  -d '{
    "actualItems": [
      {"productId": "lettuce-butterhead-123", "quantity": 50, "weight": 52.3},
      {"productId": "basil-italian-456", "quantity": 20}
    ],
    "substitutions": [],
    "notes": "Packed in your containers as requested"
  }'
```

### Delivery/Pickup

**Pickup:**

1. Buyer arrives at farm during specified window
2. Farm hands over order
3. Buyer inspects order
4. Buyer confirms receipt in app
5. Payment processed

**Delivery:**

1. Farm dispatcher assigns delivery
2. Driver loaded with order
3. GPS tracking shared with buyer
4. Driver delivers to buyer location
5. Buyer confirms receipt
6. Driver collects signature (if required)
7. Payment processed

**Track delivery:**

```bash
curl https://greenvalley.greenreach.io/api/wholesale/orders/ORD-123/tracking \
  -H "Authorization: Bearer $BUYER_TOKEN"
```

Response:
```json
{
  "orderId": "ORD-123",
  "status": "out_for_delivery",
  "driver": "John Doe",
  "vehicle": "Van #2",
  "estimatedArrival": "2025-12-26T10:30:00Z",
  "location": {
    "lat": 40.0150,
    "lng": -105.2705
  },
  "route": [
    {"lat": 40.0175, "lng": -105.2800, "timestamp": "2025-12-26T10:00:00Z"},
    {"lat": 40.0160, "lng": -105.2750, "timestamp": "2025-12-26T10:15:00Z"}
  ]
}
```

## Payments & Invoicing

### Payment Flow

**Credit Card (Immediate):**
1. Buyer places order with card on file
2. Authorization hold placed at order creation
3. Charge processed at delivery confirmation
4. Funds settle in 1-2 business days

**Invoice (Net 30):**
1. Buyer places order with invoice terms
2. Invoice generated and emailed
3. Due date set based on terms (30 days)
4. Reminders sent at 7, 3, 1 days before due
5. Late fees applied if not paid by due date

### Invoice Management

**View invoices (Buyer):**

```bash
curl https://greenvalley.greenreach.io/api/wholesale/invoices \
  -H "Authorization: Bearer $BUYER_TOKEN"
```

**Pay invoice:**

```bash
curl -X POST https://greenvalley.greenreach.io/api/wholesale/invoices/INV-456/pay \
  -H "Authorization: Bearer $BUYER_TOKEN" \
  -d '{
    "paymentMethod": "card_on_file",
    "amount": 175.50
  }'
```

**Manage receivables (Seller):**

1. Dashboard → Wholesale → Financials → Receivables
2. View outstanding invoices by buyer
3. Send payment reminders
4. Apply late fees
5. Write off bad debt (if necessary)

### Refunds

**Issue refund:**

```bash
curl -X POST https://my-farm.greenreach.io/api/wholesale/orders/ORD-123/refund \
  -H "Authorization: Bearer $FARM_TOKEN" \
  -d '{
    "amount": 52.50,
    "reason": "Product quality issue",
    "method": "original_payment"
  }'
```

## API Integration

### Authentication

**Get API Key (Enterprise tier only):**

1. Dashboard → Settings → API → Generate Key
2. Save API key securely
3. Use in Authorization header

```bash
curl https://my-farm.greenreach.io/api/wholesale/orders \
  -H "Authorization: Bearer sk_live_abc123..."
```

### Common Endpoints

**Inventory Management:**

```bash
# Get current inventory
GET /api/inventory

# Update product quantity
PUT /api/inventory/products/{productId}
{
  "quantity": 150,
  "reservedQuantity": 30,
  "wholesaleAllocation": 75
}

# Bulk update
POST /api/inventory/bulk-update
{
  "products": [
    {"sku": "LET-BUT-001", "quantity": 200},
    {"sku": "BAS-ITA-001", "quantity": 50}
  ]
}
```

**Order Management:**

```bash
# List orders
GET /api/wholesale/orders?status=pending&fromDate=2025-12-01

# Get order details
GET /api/wholesale/orders/{orderId}

# Update order status
POST /api/wholesale/orders/{orderId}/status
{
  "status": "ready",
  "notes": "Ready for pickup at loading dock"
}

# Add tracking info
POST /api/wholesale/orders/{orderId}/tracking
{
  "carrier": "own_fleet",
  "trackingNumber": "DEL-123",
  "estimatedDelivery": "2025-12-26T10:30:00Z"
}
```

**Analytics:**

```bash
# Sales summary
GET /api/wholesale/analytics/sales?period=month

# Top products
GET /api/wholesale/analytics/products/top?limit=10

# Buyer analysis
GET /api/wholesale/analytics/buyers/{buyerId}
```

## Webhooks

### Configure Webhooks

1. Dashboard → Settings → Webhooks
2. Add endpoint URL (must be HTTPS)
3. Select events to subscribe:
   - order.created
   - order.accepted
   - order.rejected
   - order.ready
   - order.completed
   - order.cancelled
   - payment.succeeded
   - payment.failed

**Webhook payload:**

```json
{
  "id": "evt_abc123",
  "type": "order.created",
  "createdAt": "2025-12-25T15:30:00Z",
  "data": {
    "orderId": "ORD-123",
    "buyerId": "BUY-456",
    "farmId": "my-farm",
    "total": 175.50,
    "items": [
      {
        "productId": "lettuce-butterhead-123",
        "quantity": 50,
        "price": 3.50
      }
    ]
  }
}
```

### Verify Webhook Signature

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
}

// In webhook handler
app.post('/webhooks/light-engine', (req, res) => {
  const signature = req.headers['x-light-engine-signature'];
  const isValid = verifyWebhookSignature(
    JSON.stringify(req.body),
    signature,
    process.env.WEBHOOK_SECRET
  );
  
  if (!isValid) {
    return res.status(401).send('Invalid signature');
  }
  
  // Process webhook
  handleWebhook(req.body);
  res.status(200).send('OK');
});
```

## Troubleshooting

### Order Not Appearing

**For Sellers:**
1. Check wholesale is enabled: Dashboard → Settings → Wholesale
2. Verify inventory allocation: Dashboard → Wholesale → Settings
3. Check product visibility: Dashboard → Wholesale → Catalog
4. Ensure products have quantity > 0

**For Buyers:**
1. Check account is approved: Dashboard → Account → Status
2. Verify you're browsing correct farm
3. Check filters (may be hiding products)
4. Try refreshing browser cache

### Payment Failures

**Credit Card Declined:**
1. Verify card details are correct
2. Check card has sufficient funds
3. Contact bank if card is being flagged
4. Try different payment method

**Square Connection Issues:**
1. Dashboard → Settings → Payments → Reconnect Square
2. Verify Square account is in good standing
3. Check webhook endpoint is responding
4. Review Square dashboard for errors

### Inventory Sync Issues

**Inventory not updating:**
1. Check API connection: Dashboard → Settings → API → Test Connection
2. Verify webhook is configured correctly
3. Check webhook delivery logs for errors
4. Manually trigger sync: Dashboard → Wholesale → Sync Now

**Overselling prevention:**
1. Enable real-time inventory checks
2. Set safety stock levels
3. Configure reservation buffer
4. Use automatic allocation adjustments

### SLA Violations

**Farm missed 4-hour acceptance window:**
1. Order auto-rejects after 4 hours
2. Buyer is notified
3. Buyer can reorder from another farm
4. Farm receives penalty in reputation score

**Quality issues:**
1. Buyer reports issue within 24 hours
2. Farm offers refund, replacement, or credit
3. Resolution tracked for reputation
4. Multiple issues trigger review

## Support

- **Seller Support**: seller-support@greenreach.io
- **Buyer Support**: buyer-support@greenreach.io
- **API Documentation**: https://docs.greenreach.io/api
- **Wholesale FAQ**: https://docs.greenreach.io/wholesale
- **Community Forum**: https://community.greenreach.io/wholesale

## Next Steps

- [Edge Deployment Guide](EDGE_DEPLOYMENT_GUIDE.md)
- [Cloud Deployment Guide](CLOUD_DEPLOYMENT_GUIDE.md)
- [Desktop App Guide](DESKTOP_APP_GUIDE.md)
- [Security Hardening](SECURITY_HARDENING_GUIDE.md)
