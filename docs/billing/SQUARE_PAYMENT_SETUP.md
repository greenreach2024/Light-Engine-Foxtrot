# Square Payment Configuration Guide
## Production Payment Processing Setup

**Last Updated:** December 31, 2025  
**Status:** Ready for Production Configuration

---

## Overview

Light Engine Foxtrot uses Square for payment processing in:
- **Wholesale Portal** - B2B buyer payments (authorize → capture flow)
- **Farm Sales POS** - In-person card payments at farm stands
- **Online Shop** - E-commerce card payments

**Current Status:**
- ✅ Square integration code complete
- ✅ Test mode verified working
- ⚠️ Production credentials needed

---

## Square Account Setup

### 1. Create Square Account

**Sign up:** https://squareup.com/signup

**Account Type:** Choose based on business structure
- **Individual** - Sole proprietor
- **Business** - LLC, Corporation

**Business Information:**
- **Business Name:** GreenReach Farms (or individual farm name)
- **Business Type:** Agriculture / Food Production
- **Annual Revenue:** Estimate (e.g., $50,000-$100,000)
- **Website:** http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com

### 2. Verify Business

Square requires identity verification:
1. Upload government ID (driver's license, passport)
2. Provide business address
3. Link bank account (for payouts)
4. Complete tax information (SSN or EIN)

**Timeline:** Verification usually takes 1-2 business days

### 3. Get Production Credentials

Once verified, get your production credentials:

#### Access Token
1. Go to [Square Developer Dashboard](https://developer.squareup.com/apps)
2. Create new application:
   - **Name:** Light Engine Foxtrot Production
   - **Description:** Vertical farming management platform with integrated payments
3. Go to **Credentials** tab
4. Copy **Production Access Token** (starts with `EAA...`)
   - ⚠️ **KEEP SECRET** - Never commit to git or share publicly

#### Location ID
1. Go to **Locations** tab
2. Copy **Location ID** (format: `LOC...` or similar)
3. If multiple locations, choose primary farm location

#### Application ID
1. Still in **Credentials** tab
2. Copy **Application ID** (format: `sq0idp-...`)

---

## Environment Configuration

### Set Production Credentials

```bash
cd /Users/petergilbert/Light-Engine-Foxtrot

# Set Square production credentials
eb setenv \
  SQUARE_ACCESS_TOKEN="EAAAxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  SQUARE_LOCATION_ID="LOCxxxxxxxxxxxxxxxxx" \
  SQUARE_APPLICATION_ID="sq0idp-xxxxxxxxxxxxxxxxxxxxx" \
  SQUARE_ENVIRONMENT="production"
```

### Additional Square Settings

```bash
# Optional: Configure currency and tax
eb setenv \
  SQUARE_CURRENCY="CAD" \
  SQUARE_TAX_RATE="0.13" \
  SQUARE_AUTO_CAPTURE="false"
```

### Test Mode vs. Production Mode

**Test Mode (Current):**
```bash
SQUARE_ENVIRONMENT=sandbox
SQUARE_ACCESS_TOKEN=EAAAExxxxxxxxxx  # Sandbox token
```
- Uses test credit cards
- No real money charged
- Good for development

**Production Mode:**
```bash
SQUARE_ENVIRONMENT=production
SQUARE_ACCESS_TOKEN=EAAAxxxxxxxxxx  # Production token
```
- Real credit cards
- Real money charged
- Requires verified account

---

## Payment Flows

### 1. Wholesale Buyer Checkout

**Flow:** Authorize → Hold → Capture on Fulfillment

```javascript
// Step 1: Authorize payment (buyer checkout)
POST /api/wholesale/checkout/execute
{
  "payment_method": "square",
  "square_nonce": "cnon_xxxxxxxxxx",  // From Square Web SDK
  "amount": 125.00
}

// Step 2: Hold funds (no charge yet)
Square API: Payments.createPayment({
  autocomplete: false,  // Don't capture immediately
  amount_money: { amount: 12500, currency: 'CAD' }
})

// Step 3: Capture when order ships (charge customer)
POST /api/wholesale/fulfillment/orders/:id/ship
Square API: Payments.completePayment(payment_id)
```

**Why Authorize First?**
- Farms need time to verify inventory
- Buyer might modify order
- Charge only when fulfilled

**Timeline:**
- Authorization hold: 7 days maximum
- Capture before expiration
- Auto-void if not captured

### 2. Farm Sales POS

**Flow:** Immediate Charge

```javascript
// Single API call - charge immediately
POST /api/farm-sales/pos/checkout
{
  "payment_method": "card",
  "square_nonce": "cnon_xxxxxxxxxx",
  "amount": 45.00
}

Square API: Payments.createPayment({
  autocomplete: true,  // Charge immediately
  amount_money: { amount: 4500, currency: 'CAD' }
})
```

**Use Case:** Walk-up farm stand customers

### 3. Online Shop

**Flow:** Immediate Charge (like POS)

```javascript
POST /api/farm-sales/orders
{
  "payment": {
    "method": "card",
    "square_nonce": "cnon_xxxxxxxxxx",
    "amount": 75.00
  }
}
```

---

## Square Web SDK Integration

### Frontend Integration (Already Implemented)

**Files:**
- `/public/wholesale.html` - Line 15: `<script src="https://web.squarecdn.com/v1/square.js"></script>`
- `/public/farm-sales-pos.html` - Square SDK loaded
- `/public/farm-sales-shop.html` - Square SDK loaded

**Initialization:**
```javascript
// Initialize Square Payments
const payments = Square.payments(
  SQUARE_APPLICATION_ID,  // From environment
  SQUARE_LOCATION_ID      // From environment
);

// Create card payment form
const card = await payments.card();
await card.attach('#card-container');

// Tokenize card on submit
const result = await card.tokenize();
if (result.status === 'OK') {
  const nonce = result.token;  // Send to backend
}
```

**Test Cards (Sandbox Only):**
```
VISA:       4111 1111 1111 1111
Mastercard: 5105 1051 0510 5100
AMEX:       3782 822463 10005
CVV:        Any 3 digits
Expiry:     Any future date
ZIP:        Any 5 digits
```

**Production Cards:**
- Real credit/debit cards only
- All major brands supported (Visa, Mastercard, Amex, Discover)

---

## Testing Square Integration

### Test Script

```bash
cd /Users/petergilbert/Light-Engine-Foxtrot

# Test Square connection
node scripts/test-square-payments.js
```

### Manual Testing

**1. Test Card Payment (POS Terminal)**
```bash
# Open POS terminal
open http://localhost:8091/farm-sales-pos.html

# Login with farm credentials
# Add items to cart
# Select "Credit/Debit Card" payment
# Enter test card: 4111 1111 1111 1111
# CVV: 123, Expiry: 12/25, ZIP: 12345
# Complete payment
```

**2. Test Wholesale Checkout**
```bash
# Open wholesale portal
open http://localhost:8091/wholesale.html

# Browse products, add to cart
# Proceed to checkout
# Select "Credit Card" payment
# Enter test card details
# Confirm order
# Verify authorization (not charged)
```

**3. Verify in Square Dashboard**
```bash
# Go to Square Dashboard → Transactions
# Should see test payments
# Status: "Completed" (POS) or "Authorized" (Wholesale)
```

---

## Production Checklist

### Before Going Live

- [ ] **Square Account Verified** - Identity and business verification complete
- [ ] **Bank Account Linked** - For receiving payouts
- [ ] **Production Credentials Obtained** - Access token, location ID, app ID
- [ ] **Environment Variables Set** - All three credentials in EB
- [ ] **Test Payment in Production** - Use real credit card with $1 test
- [ ] **Refund Test** - Issue refund to verify refund flow works
- [ ] **Webhook Configured** - Payment notifications (optional but recommended)
- [ ] **PCI Compliance** - Review Square's PCI compliance documentation
- [ ] **Terms of Service** - Display Square's terms on checkout pages

### Square Dashboard Setup

**1. Enable Payment Methods**
- Go to Square Dashboard → Settings → Checkout
- Enable: Credit Cards, Debit Cards
- Optional: Apple Pay, Google Pay, ACH

**2. Configure Tax**
- Go to Settings → Taxes
- Add tax rate: 13% HST (Ontario) or applicable rate
- Assign to location

**3. Set Up Receipts**
- Go to Settings → Receipts
- Customize receipt header (farm logo)
- Add contact information
- Enable email receipts

**4. Configure Webhooks (Optional)**
```bash
# Webhook URL
https://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/api/webhooks/square

# Events to subscribe:
- payment.created
- payment.updated
- payment.completed (capture)
- payment.failed
- refund.created
```

---

## Cost & Fees

### Square Transaction Fees

**In-Person Payments (POS Terminal):**
- 2.65% + $0.10 per transaction
- Example: $45.00 sale = $1.29 fee, farm receives $43.71

**Online Payments (E-commerce):**
- 2.9% + $0.30 per transaction
- Example: $125.00 sale = $3.93 fee, farm receives $121.07

**Keyed-In Payments (Manual Entry):**
- 3.5% + $0.15 per transaction
- Higher rate due to fraud risk

**No Monthly Fees:**
- Free Square account
- No setup fees
- No hidden fees

### Payout Schedule

**Standard:**
- Funds deposited next business day
- Automatic daily transfers
- No payout fees

**Instant Deposit:**
- Available for additional 1.5% fee
- Funds in minutes (up to $10,000/day)

---

## Error Handling

### Common Errors

**1. Invalid Card**
```javascript
{
  "error": "INVALID_CARD",
  "message": "Card number is invalid"
}
```
**Solution:** Ask customer to re-enter card details

**2. Insufficient Funds**
```javascript
{
  "error": "CARD_DECLINED",
  "message": "Insufficient funds"
}
```
**Solution:** Request different payment method

**3. Authorization Expired**
```javascript
{
  "error": "PAYMENT_EXPIRED",
  "message": "Authorization hold expired after 7 days"
}
```
**Solution:** Request customer to re-authorize payment

**4. Network Error**
```javascript
{
  "error": "NETWORK_ERROR",
  "message": "Could not connect to Square"
}
```
**Solution:** Check internet connection, retry

### Retry Logic

Already implemented in codebase:
```javascript
async function processSquarePayment(nonce, amount, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const result = await square.payments.create({...});
      return result;
    } catch (error) {
      if (i === retries - 1) throw error;
      await sleep(1000 * (i + 1));  // Exponential backoff
    }
  }
}
```

---

## Security Best Practices

### ✅ Already Implemented

1. **Never Store Card Numbers** - Square handles tokenization
2. **HTTPS Only** - All payment requests over SSL
3. **Nonce-Based** - One-time tokens, can't be reused
4. **Environment Variables** - Credentials not in code
5. **Input Validation** - Amount validation, fraud checks

### Additional Recommendations

1. **Enable 3D Secure** (SCA - Strong Customer Authentication)
   - Go to Square Dashboard → Settings → Checkout
   - Enable "3D Secure" for international cards

2. **Monitor for Fraud**
   - Review Square Dashboard → Risk
   - Set up fraud alerts

3. **Regular Security Audits**
   - Review access logs
   - Rotate access tokens annually
   - Monitor failed payment attempts

4. **Dispute Management**
   - Respond to chargebacks within 7 days
   - Keep proof of delivery/receipt
   - Use lot codes for traceability

---

## Troubleshooting

### Payments Not Processing

**Check 1: Credentials**
```bash
eb printenv | grep SQUARE
# Should show:
# SQUARE_ACCESS_TOKEN=EAAAxxxxxxx
# SQUARE_LOCATION_ID=LOCxxxxxxx
# SQUARE_APPLICATION_ID=sq0idp-xxxxxxx
```

**Check 2: Square Account Status**
```bash
# Go to Square Dashboard
# Check for:
# - Verification status (should be "Verified")
# - Account status (should be "Active")
# - Any holds or restrictions
```

**Check 3: Application Logs**
```bash
eb logs | grep -i square
# Look for error messages
```

**Check 4: Test in Sandbox**
```bash
# Switch to sandbox temporarily
eb setenv SQUARE_ENVIRONMENT=sandbox SQUARE_ACCESS_TOKEN=<sandbox-token>

# Test payment
# If works in sandbox but not production → credentials issue
# If fails in both → code issue
```

### Card Declined

**Common Reasons:**
1. Insufficient funds
2. Card expired
3. Wrong CVV
4. Card blocked by issuer
5. International card without 3D Secure

**Solution:** Ask customer to:
- Check card balance
- Verify expiration date
- Try different card
- Contact their bank

---

## Production Deployment

### Step-by-Step

**1. Get Square Account Verified**
```bash
# Go to Square Dashboard
# Complete all verification steps
# Wait for approval (1-2 business days)
```

**2. Set Production Credentials**
```bash
eb setenv \
  SQUARE_ACCESS_TOKEN="EAAAxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  SQUARE_LOCATION_ID="LOCxxxxxxxxxxxxxxxxx" \
  SQUARE_APPLICATION_ID="sq0idp-xxxxxxxxxxxxxxxxxxxxx" \
  SQUARE_ENVIRONMENT="production" \
  SQUARE_CURRENCY="CAD"
```

**3. Test with Real Card (Small Amount)**
```bash
# Make $1.00 test purchase
# Verify in Square Dashboard
# Issue immediate refund
```

**4. Enable for Users**
```bash
# Payment processing now live!
# Monitor Square Dashboard for first transactions
```

**5. Train Staff**
```bash
# POS Terminal training
# Refund process
# Dispute handling
```

---

## Support & Documentation

**Square Developer Docs:** https://developer.squareup.com/docs  
**Square Dashboard:** https://squareup.com/dashboard  
**Square Support:** https://squareup.com/help  

**Internal Files:**
- Wholesale checkout: `/routes/wholesale/checkout.js`
- POS payments: `/routes/farm-sales/payments.js`
- Square integration: Search for `square.payments` in codebase

---

## Next Steps

### Immediate (Testing)
1. Create Square account (sandbox)
2. Get sandbox credentials
3. Run test script: `node scripts/test-square-payments.js`
4. Test POS payment flow
5. Test wholesale payment flow

### Before Production
1. Complete Square verification
2. Get production credentials
3. Set environment variables
4. Test with real $1 payment
5. Configure webhooks
6. Train staff

### Post-Launch
1. Monitor transaction success rate (target >95%)
2. Review decline reasons
3. Optimize checkout flow
4. Handle disputes promptly

---

**Status:** Ready for account setup and credential configuration.

**Estimated Time:** 2-3 business days (including Square verification)
