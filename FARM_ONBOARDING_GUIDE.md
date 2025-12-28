# GreenReach Wholesale Portal - Farm Onboarding Guide

**Pilot Program Launch - December 2025**

This guide walks you through joining the GreenReach Wholesale network as a verified farm supplier.

---

## 📋 Prerequisites

Before starting, ensure you have:
- [ ] Business license or farm registration documents
- [ ] Farm contact information (owner name, email, phone)
- [ ] Current inventory list with SKUs and quantities
- [ ] Pickup/delivery logistics details
- [ ] Bank account information (for payment settlement)

---

## Step 1: Farm Registration

### 1.1 Access Registration Portal

Visit: `http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/farm-registration.html`

### 1.2 Complete Farm Profile

Required information:
- **Farm Name**: Your business name as it will appear to buyers
- **Farm ID**: Assigned format `GR-XXXXX` (assigned by system)
- **Location**: Address, city, province, postal code
- **Contact Person**: Primary contact for orders
- **Email**: For order notifications and updates
- **Phone**: For SMS alerts and urgent communications
- **Business Type**: Certified Organic, Conventional, Hydroponic, etc.

### 1.3 Upload Certifications

If applicable, upload:
- Organic certification documents
- Food safety certifications (CanadaGAP, etc.)
- Business insurance proof
- Liability insurance

---

## Step 2: Notification Setup

### 2.1 Configure Notification Preferences

Access notification settings: `http://localhost:8091/notification-settings.html` (on your farm device)

Configure which alerts you want to receive:

```
✅ New Order Received (SMS + Push + Email)
✅ Order Verification Deadline (6hr reminder)
✅ Payment Confirmed
⚠️  Order Modification
⚠️  Order Cancellation
ℹ️  Weekly Performance Report
```

### 2.2 Register Mobile Device for Push Notifications

1. Download the GreenReach Farm App (iOS/Android)
2. Log in with your farm credentials
3. Allow push notifications when prompted
4. Device token will be automatically registered

**Test Push Notifications:**
```bash
# Run from farm server/computer
npm run test:notifications
```

You should receive:
- ✅ Test SMS to your phone
- ✅ Test push notification to app
- ✅ Test email

### 2.3 Verify Phone Number

Confirm your phone number can receive SMS:
- You'll receive a verification code via SMS
- Enter code in the portal to activate notifications

---

## Step 3: Inventory Integration

### 3.1 Catalog Setup

Upload your current product catalog:

**Via Web Interface:**
1. Navigate to: `http://localhost:8091/wholesale-catalog.html`
2. Click "Add Products"
3. Fill in for each product:
   - SKU (unique identifier)
   - Product name
   - Description
   - Unit size (e.g., "5lb case", "1 dozen")
   - Price per unit
   - Available quantity
   - Harvest date / Best before date

**Via API Integration:**

If you have an existing inventory system:
```bash
curl -X POST http://localhost:8091/api/wholesale/inventory \
  -H "Content-Type: application/json" \
  -H "X-Farm-ID: GR-00001" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "products": [
      {
        "sku_id": "SKU-LETTUCE-ROMAINE-5LB",
        "name": "Romaine Lettuce, 5lb case",
        "price": 12.50,
        "quantity": 50,
        "unit": "case",
        "category": "leafy_greens"
      }
    ]
  }'
```

### 3.2 Set Inventory Update Schedule

Configure automatic inventory sync:
- Frequency: Daily, Weekly, or Real-time
- Update method: Manual upload, API sync, or automated

**Recommended**: Daily sync at end of harvest day

---

## Step 4: Order Verification Training

### 4.1 Understanding Order Workflow

When a buyer places an order:

1. **📬 Notification Received** (within 5 minutes)
   - SMS alert with order summary
   - Push notification to farm app
   - Email with full order details

2. **⏰ Verification Deadline** (24 hours default)
   - You have 24 hours to verify you can fulfill
   - 6-hour reminder notification sent automatically
   - **CRITICAL**: Must respond before deadline

3. **✅ Verification Actions**
   - **ACCEPT**: Confirm you can fulfill the order as-is
   - **MODIFY**: Propose quantity adjustments
   - **DECLINE**: Cannot fulfill (triggers alternative farm search)

4. **📦 Fulfillment**
   - Pack order according to specifications
   - Print packing slip from portal
   - Coordinate pickup/delivery with buyer

5. **💰 Payment**
   - Payment held in escrow during fulfillment
   - Released to your account after confirmed delivery
   - Typical settlement: 2-3 business days

### 4.2 Practice Order Verification

**Test Order Flow:**

Run a test order from the admin panel:
```bash
# From farm computer
cd /path/to/Light-Engine-Foxtrot
node scripts/test-wholesale-order.js --farm=GR-00001
```

This creates a mock order. Practice:
1. Receiving the notification
2. Accessing order details via link
3. Accepting/modifying/declining the order
4. Understanding deadline countdown

### 4.3 Verification Best Practices

**DO:**
- ✅ Check notifications within 1 hour of receipt
- ✅ Verify you have sufficient inventory before accepting
- ✅ Respond at least 6 hours before deadline
- ✅ Communicate proactively if issues arise
- ✅ Update inventory immediately after harvest

**DON'T:**
- ❌ Miss verification deadlines (impacts your reliability score)
- ❌ Accept orders you can't fulfill
- ❌ Over-promise quantity
- ❌ Ignore modification requests from buyers

---

## Step 5: Logistics Configuration

### 5.1 Set Pickup/Delivery Options

Configure in farm settings:

**Pickup Options:**
- Pickup location: Your farm address or distribution center
- Available days: Select days of week
- Time windows: e.g., "8am-12pm, 1pm-5pm"
- Advance notice required: e.g., "24 hours"

**Delivery Options (if offered):**
- Delivery radius: Maximum distance in km
- Delivery fee structure: Flat rate or per km
- Minimum order for delivery: e.g., "$100 minimum"
- Delivery schedule: Days and times available

### 5.2 Set Order Minimums

Configure minimum order requirements:
- **Minimum order value**: e.g., $50
- **Minimum quantity per SKU**: e.g., "5 cases minimum"
- **Lead time required**: e.g., "48 hours notice"

---

## Step 6: Payment Setup

### 6.1 Bank Account Verification

Provide bank details for payment settlement:
- Bank name
- Account number
- Routing/Transit number
- Account holder name (must match business registration)

**Verification Process:**
- Small test deposit (e.g., $0.25) sent to your account
- Confirm amount in portal to verify account

### 6.2 Payment Terms

Standard pilot program terms:
- **Payment method**: Direct deposit
- **Settlement schedule**: Net 7 days after delivery confirmation
- **Transaction fee**: 3.5% of order value (covers payment processing + platform)
- **Minimum payout**: $25 (orders below this accumulate)

### 6.3 Review Financial Dashboard

Access: `http://localhost:8091/farm-financials.html`

View:
- Pending orders (awaiting fulfillment)
- In-progress orders (awaiting payment release)
- Completed transactions
- Settlement history
- Revenue reports (daily, weekly, monthly)

---

## Step 7: Pilot Program Agreement

### 7.1 Review Terms

Key pilot program terms:
- **Duration**: 3-month pilot (Jan-Mar 2026)
- **Exclusivity**: None - you can continue other sales channels
- **Minimum commitment**: None - participate as much as you want
- **Performance expectations**:
  - 90%+ verification response rate
  - 95%+ order fulfillment rate
  - <5% order modifications/cancellations

### 7.2 Sign Agreement

- Review full terms and conditions
- E-sign via portal
- Receive confirmation email

---

## Step 8: Go Live!

### 8.1 Pre-Launch Checklist

Before going live, confirm:
- [ ] Farm profile complete and approved
- [ ] Notifications tested and working (SMS, Push, Email)
- [ ] At least 5 products listed with current inventory
- [ ] Bank account verified
- [ ] Pickup/delivery logistics configured
- [ ] Pilot agreement signed
- [ ] Test order successfully processed

### 8.2 Soft Launch

Your first week:
- Start with limited inventory (test volumes)
- Monitor notifications closely
- Respond to orders quickly
- Gather feedback on process
- Ask questions in pilot program Slack channel

### 8.3 Training Call

Schedule 30-minute onboarding call with GreenReach team:
- Walk through your first real order
- Answer any questions
- Discuss optimization strategies
- Connect with other pilot farms

**Schedule:** Email ops@urbanyeild.ca

---

## 📱 Quick Reference

### Important URLs

- **Farm Dashboard**: http://localhost:8091/farm-dashboard.html
- **Inventory Management**: http://localhost:8091/wholesale-catalog.html
- **Order Verification**: http://localhost:8091/verify-order.html?id=ORDER_ID
- **Notification Settings**: http://localhost:8091/notification-settings.html
- **Financial Dashboard**: http://localhost:8091/farm-financials.html

### Support Contacts

- **Email**: ops@urbanyeild.ca
- **SMS**: +1-709-398-3166
- **Slack**: #greenreach-pilot (invitation sent after approval)
- **Emergency**: +1-709-398-3166 (SMS only, urgent issues)

### Key Deadlines

- **Order Verification**: 24 hours from notification
- **Inventory Updates**: Daily (recommended)
- **Payment Disputes**: Within 7 days of transaction
- **Pilot Feedback**: End of each month

---

## 🚀 Success Tips

1. **Be Responsive**: Check notifications multiple times per day
2. **Keep Inventory Current**: Update quantities after each harvest
3. **Communicate Proactively**: Contact buyers if issues arise
4. **Track Performance**: Review your stats weekly
5. **Learn from Data**: Use reports to optimize product mix
6. **Build Relationships**: Repeat buyers are your best customers
7. **Ask Questions**: We're all learning together in the pilot

---

## Troubleshooting

### Not Receiving Notifications?

1. Check notification settings: http://localhost:8091/notification-settings.html
2. Verify phone number is correct and can receive SMS
3. Check spam folder for emails
4. Reinstall farm app and re-register for push notifications
5. Contact ops@urbanyeild.ca if issues persist

### Inventory Not Syncing?

1. Verify farm API key is active
2. Check API request logs for errors
3. Try manual upload via web interface
4. Contact support with API key and error messages

### Payment Issues?

1. Verify bank account details are correct
2. Check that order was marked as "delivered" and confirmed by buyer
3. Review 7-day settlement schedule (payments not instant)
4. Contact ops@urbanyeild.ca with transaction ID

---

**Welcome to GreenReach Wholesale! 🌱**

We're excited to have you as a pilot farm. Your feedback will shape the future of local food distribution.
