# GreenReach Wholesale - Multi-Farm Order Verification System

## Current Status & Immediate Fixes Needed

### ✅ **Cart System EXISTS** - Needs Enhancement
The cart panel slides in from right side when clicking cart badge (bottom-right floating button).

**Improvements Needed:**
1. **Make cart more visible** - Add persistent mini cart view in header
2. **Live cart updates** - Real-time item count and subtotal visible
3. **Replace "Proceed to Checkout"** button with **"Place Order"** button

---

## Proposed Workflow Architecture
*Similar to SkipTheDishes/DoorDash multi-restaurant model*

### Phase 1: Order Placement (Buyer Side)

```
1. Buyer browses products from multiple farms
2. Adds items to cart (✅ already working)
3. Views cart with live totals (needs enhancement)
4. Enters delivery details:
   - Pickup location (buyer's address or central hub)
   - Preferred pickup date/time
   - Special instructions
5. Enters payment method (credit card)
6. Clicks "Place Order" → **AUTHORIZATION HOLD** (not charge)
```

**Payment Flow:**
- Stripe/Payment Gateway creates **authorization hold** on card
- Funds are reserved but NOT captured yet
- Hold expires in 7 days if order not completed

---

### Phase 2: Order Splitting & Farm Notification

```
Order Received → GreenReach System Splits by Farm

Order #12345 ($243.50 total)
├─ Farm A (SkyHigh Farms)
│  ├─ Lettuce, Green Leaf (5 lbs) @ $3.50/lb
│  ├─ Arugula (3 lbs) @ $6.00/lb
│  └─ Subtotal: $35.50
│
├─ Farm B (Fresh Valley)
│  ├─ Tomatoes, Heirloom (10 lbs) @ $5.00/lb
│  ├─ Cucumbers (8 lbs) @ $2.50/lb
│  └─ Subtotal: $70.00
│
└─ Farm C (GreenLeaf Co-op)
   ├─ Kale (6 lbs) @ $4.00/lb
   ├─ Spinach (12 lbs) @ $4.50/lb
   └─ Subtotal: $78.00
```

**Farm Notification:**
- Each farm receives notification (email, SMS, dashboard alert)
- Farmview displays pending order requiring verification
- Timer starts: 24 hours to respond

---

### Phase 3: Farm Verification Process

**Farm Dashboard View:**
```
NEW ORDER PENDING VERIFICATION
Order #12345-A from "Fresh & Co Restaurant"
Pickup Date: Dec 25, 2025 @ 8:00 AM

Items Requested:
✓ Lettuce, Green Leaf - 5 lbs @ $3.50/lb = $17.50
✓ Arugula - 3 lbs @ $6.00/lb = $18.00

[ ] I can fulfill this order exactly as requested
[ ] I can partially fulfill (modify quantities below)
[ ] I cannot fulfill this order

[Verify & Commit] [Request Changes] [Decline]
```

**Farm Options:**
1. **✅ Verify Full Order** - Commits to providing all items
2. **⚠️ Partial Fulfillment** - Can only provide some items/quantities
3. **❌ Decline** - Cannot fulfill

---

### Phase 4: Alternative Farm Matching (If Needed)

**Scenario:** Farm B declines tomato order

```
GreenReach Algorithm:
1. Find alternative farms with Tomatoes, Heirloom in stock
2. Filter by:
   - Location (within delivery radius)
   - Availability on requested date
   - Price range (±15% of original)
   - Quality ratings (4+ stars)
3. Sort by distance from buyer
4. Send verification request to next best farm
```

**Cascading Requests:**
- Try Farm D (closest match)
- If declined → Try Farm E
- If declined → Try Farm F
- If all decline → Modify buyer order

---

### Phase 5: Order Reconciliation

**All Farms Verified ✅**
```
Buyer Notification:
"Great news! Your order #12345 has been confirmed by all farms.
Total: $243.50
Pickup: Dec 25, 2025 @ 8:00 AM at 123 Princess Street

Your card will be charged when farms confirm pickup readiness."
```

**Partial Fulfillment ⚠️**
```
Buyer Notification:
"Your order #12345 requires adjustment:

ORIGINAL ORDER:
- Lettuce (5 lbs) @ $17.50 ✅ Confirmed
- Arugula (3 lbs) @ $18.00 ✅ Confirmed
- Tomatoes (10 lbs) @ $50.00 ❌ Unavailable
- Cucumbers (8 lbs) @ $20.00 ✅ Confirmed
- Kale (6 lbs) @ $24.00 ✅ Confirmed
- Spinach (12 lbs) @ $54.00 ✅ Confirmed

ALTERNATIVE FOUND:
- Tomatoes, Heirloom from "Valley Fresh Farm"
  7 lbs available @ $5.50/lb = $38.50

REVISED TOTAL: $172.00 (was $243.50)

[Accept Modified Order] [Cancel Entire Order]
```

**If Buyer Accepts Modified Order:**
- Authorization adjusted to new amount
- Order proceeds to fulfillment

**If Buyer Declines:**
- Full authorization hold released
- Order cancelled, no charge

---

### Phase 6: Payment Capture

**Pickup Confirmation Process:**

```
Day Before Pickup:
├─ System reminder to all farms
└─ Buyer reminder with pickup instructions

Pickup Day:
├─ Farms mark items ready (mobile app or dashboard)
└─ QR code generated for buyer pickup

Buyer Arrives at Farm/Hub:
├─ Scans QR code (confirms pickup from Farm A)
├─ Receives items
└─ Repeats for each farm

All Pickups Complete:
├─ GreenReach captures payment from buyer card
├─ Splits payment to farms (minus platform fee)
└─ Payment hits farm accounts in 2-3 business days
```

---

## Technical Implementation

### Database Schema

```sql
-- Main order table
CREATE TABLE wholesale_orders (
    order_id SERIAL PRIMARY KEY,
    buyer_id INTEGER REFERENCES users(id),
    total_amount DECIMAL(10,2),
    status VARCHAR(50), -- pending_verification, confirmed, partially_confirmed, cancelled, completed
    stripe_payment_intent_id VARCHAR(255),
    authorization_amount DECIMAL(10,2),
    pickup_date TIMESTAMP,
    pickup_location TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Sub-orders for each farm
CREATE TABLE farm_sub_orders (
    sub_order_id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES wholesale_orders(order_id),
    farm_id INTEGER REFERENCES users(id),
    sub_total DECIMAL(10,2),
    status VARCHAR(50), -- pending, verified, declined, modified, fulfilled
    verification_deadline TIMESTAMP,
    verified_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Line items for each sub-order
CREATE TABLE order_line_items (
    line_item_id SERIAL PRIMARY KEY,
    sub_order_id INTEGER REFERENCES farm_sub_orders(sub_order_id),
    sku_id INTEGER REFERENCES inventory_skus(sku_id),
    quantity DECIMAL(10,2),
    unit_price DECIMAL(10,2),
    line_total DECIMAL(10,2),
    status VARCHAR(50) -- requested, confirmed, modified, declined
);

-- Alternative farm matching attempts
CREATE TABLE farm_substitutions (
    substitution_id SERIAL PRIMARY KEY,
    original_sub_order_id INTEGER REFERENCES farm_sub_orders(sub_order_id),
    alternative_farm_id INTEGER REFERENCES users(id),
    status VARCHAR(50), -- pending, accepted, declined
    sent_at TIMESTAMP,
    responded_at TIMESTAMP
);

-- Pickup confirmations
CREATE TABLE pickup_confirmations (
    confirmation_id SERIAL PRIMARY KEY,
    sub_order_id INTEGER REFERENCES farm_sub_orders(sub_order_id),
    confirmed_by INTEGER REFERENCES users(id),
    confirmation_code VARCHAR(50),
    confirmed_at TIMESTAMP,
    location_verified BOOLEAN
);
```

### API Endpoints Needed

```javascript
// Order Creation
POST /api/wholesale/orders/create
POST /api/wholesale/orders/:orderId/authorize-payment

// Farm Verification
GET /api/wholesale/orders/farm-pending  // Farm dashboard
POST /api/wholesale/orders/:subOrderId/verify
POST /api/wholesale/orders/:subOrderId/modify
POST /api/wholesale/orders/:subOrderId/decline

// Alternative Matching
POST /api/wholesale/orders/:subOrderId/find-alternatives
POST /api/wholesale/orders/:substitutionId/send-to-alternative

// Buyer Order Management
GET /api/wholesale/orders/:orderId/status
POST /api/wholesale/orders/:orderId/accept-modified
POST /api/wholesale/orders/:orderId/cancel

// Pickup & Payment
POST /api/wholesale/orders/:subOrderId/mark-ready
POST /api/wholesale/orders/:subOrderId/confirm-pickup
POST /api/wholesale/orders/:orderId/capture-payment
POST /api/wholesale/orders/:orderId/distribute-payments
```

### State Machine

```
Order States:
pending_authorization → authorization_hold → farms_notified → 
farms_verifying → [verified_full | verified_partial | verification_failed] →
buyer_reviewing_changes → buyer_accepted → farms_preparing →
pickup_ready → pickups_in_progress → all_pickups_confirmed →
payment_captured → payments_distributed → order_complete

Cancellation can occur at any state before payment_captured
```

---

## Notification System

### Email/SMS Templates

**To Farms:**
- New order pending verification
- Verification deadline approaching (6 hours left)
- Verification expired (order reassigned)
- Pickup reminder (day before)
- Payment processed notification

**To Buyers:**
- Order received and being processed
- All farms verified - order confirmed
- Modification needed - review required
- Pickup reminders (day before + 2 hours before)
- Payment receipt

### Real-Time Updates
- WebSocket connections for live order status
- Dashboard notifications
- Mobile push notifications (if mobile app)

---

## UI Components Needed

### 1. Enhanced Cart (Immediate)
- Mini cart in header showing item count + total
- Slide-out panel with full cart details
- "Place Order" button with payment info entry

### 2. Order Submission Form
- Pickup date/time selector
- Location selector (or enter custom)
- Special instructions
- Payment method entry (Stripe Elements)
- Order summary with breakdown by farm

### 3. Farm Verification Dashboard
- Pending orders list
- Order detail view with verification options
- Quantity adjustment interface
- Decline with reason selector

### 4. Buyer Order Tracking
- Real-time status updates
- Farm-by-farm verification progress
- Modified order review interface
- Pickup QR code display
- Receipt download

### 5. Alternative Farm Matching UI
- Admin/system view showing matching process
- Alternative farm suggestions with scoring
- Manual override for farm selection

---

## Questions & Decisions Needed

### 1. **Payment Platform**
- Stripe? (recommended - supports auth holds, split payments)
- PayPal? (more complex for holds)
- Other?

### 2. **Platform Fee Structure**
```
Option A: Percentage of order (e.g., 8-12%)
Option B: Fixed fee per order ($2-5)
Option C: Tiered: 
  - Orders under $100: 10%
  - Orders $100-500: 8%
  - Orders $500+: 6%
```

### 3. **Verification Timeline**
- Current proposal: 24 hours
- Alternative: 12 hours (faster) or 48 hours (more flexible)
- What happens if no response? Auto-decline or send reminder?

### 4. **Alternative Farm Matching**
- Automatic or require admin approval?
- Price variance tolerance: ±10%? ±15%? ±20%?
- Can buyer see which farm was substituted?

### 5. **Pickup Logistics**
- Individual farm pickups or central aggregation hub?
- Who coordinates multi-farm pickups?
- Delivery option or pickup only?

### 6. **Minimum Order Values**
- Per-farm minimum? (e.g., $25 minimum per farm)
- Total order minimum? (e.g., $100 minimum)
- Helps offset verification overhead

### 7. **Payment Timing**
- Current proposal: Capture after ALL pickups confirmed
- Alternative: Capture per-farm as each pickup confirmed
- How to handle partial pickup failures?

---

## Implementation Priority

### 🔥 **Phase 1 - Cart Enhancements** (Immediate - 2-3 days)
1. Add persistent cart counter in header
2. Improve cart panel visibility
3. Add "Place Order" button
4. Create order submission form with basic payment

### 🟡 **Phase 2 - Order Splitting** (Week 1-2)
1. Backend order splitting logic
2. Database schema implementation
3. Farm notification system
4. Basic farm verification dashboard

### 🟠 **Phase 3 - Verification Workflow** (Week 2-3)
1. Farm verification UI
2. Order modification handling
3. Buyer review & acceptance flow
4. Stripe payment authorization holds

### 🔵 **Phase 4 - Alternative Matching** (Week 3-4)
1. Farm matching algorithm
2. Substitution request system
3. Cascading verification logic
4. Admin oversight dashboard

### 🟢 **Phase 5 - Pickup & Payment** (Week 4-5)
1. QR code generation & scanning
2. Pickup confirmation workflow
3. Payment capture automation
4. Farm payment distribution

---

## Success Metrics

- **Order Verification Rate**: % of orders fully verified by farms
- **Average Verification Time**: Hours from order to full verification
- **Substitution Success Rate**: % of declined items successfully matched
- **Buyer Acceptance Rate**: % of modified orders accepted by buyers
- **Payment Success Rate**: % of authorized payments successfully captured
- **Platform Revenue**: Total fees collected
- **Farm Satisfaction**: Rating of verification process by farms
- **Buyer Satisfaction**: Rating of order process by buyers

---

## Risk Mitigation

### Risk: Multiple farms decline → order fails
**Mitigation:**
- Expand search radius automatically
- Contact farms manually for high-value orders
- Offer premium to farms for rush verification

### Risk: Buyer card authorization fails
**Mitigation:**
- Verify card before notifying farms
- Alternative payment methods (bank transfer for large orders)
- Credit system for verified buyers

### Risk: Farm doesn't fulfill after verification
**Mitigation:**
- Performance tracking and penalties
- Security deposit for farms
- Insurance/guarantee fund

---

## Next Steps

1. **Review this document** - Confirm workflow matches vision
2. **Answer decision questions** - Platform fee, timelines, etc.
3. **Prioritize features** - What's essential for MVP?
4. **Begin Phase 1** - Cart enhancements (I can start immediately)

Let me know what adjustments you'd like to this plan!
