# GreenReach Wholesale Notification & Logistics Flow

## Overview

This document explains how farms are notified about new orders and how they receive logistics details.

---

## 1. Order Creation Flow

### When Buyer Places Order

**Buyer provides:**
- Delivery address (street, city, province, postal code)
- Delivery schedule (one-time, weekly, biweekly, monthly)
- Preferred pickup time
- Special delivery instructions
- Phone number (optional)

**System processes:**
1. ✅ Square payment authorized immediately
2. ✅ Order split into sub-orders per farm
3. ✅ 24-hour verification deadline set
4. **✅ Email sent to buyer (order confirmation)**
5. **✅ Email sent to each farm (with full logistics)**
6. **✅ SMS sent to each farm (if phone on file)**

---

## 2. Farm Notification Details

### Email Notification Contents

Farms receive a comprehensive email containing:

#### 📋 Order Information
- Order ID and sub-order ID
- Buyer name, email, phone
- Order total for this farm
- Verification deadline (countdown in hours)

#### 📍 Delivery Logistics
- **Full delivery address** (street, city, province, postal code)
- **Fulfillment schedule** (one-time, weekly, biweekly, monthly)
- **Preferred pickup time** (if specified)
- **Special delivery instructions** (if any)

#### 📦 Items List
- Product name, quantity, unit
- Price per unit
- Line total
- Sub-order total

#### ⚡ Action Buttons
- **Direct link to farm dashboard:** `/wholesale-farm-orders.html?order={order_id}`
- One-click access to verify the order

#### ℹ️ Options Explained
- **Accept:** Confirm you can fulfill as-is
- **Modify:** Adjust quantities (buyer will review)
- **Decline:** Cannot fulfill (system seeks alternatives)

### SMS Notification

Short notification with:
- Order ID
- Hours remaining to respond
- Order total
- Link to dashboard

Example:
```
GreenReach Order #12345
24hrs to respond
$250.00 total
View: https://farm.greenreach.ca/wholesale-farm-orders.html
```

---

## 3. Farm Verification Dashboard

### Accessing Orders

**Direct link from email:**
`https://your-farm-domain.com/wholesale-farm-orders.html?order={order_id}`

**Dashboard shows:**
- All pending orders requiring verification
- Countdown timer (hours remaining)
- Full logistics details inline:
  - Delivery address
  - Fulfillment schedule
  - Special instructions
  - Buyer contact info
- Items list with quantities and prices

### Farm Actions

#### ✅ Accept Order
- Confirms farm can fulfill exactly as ordered
- Buyer receives notification "Order confirmed"
- Farm begins preparation

#### ✏️ Modify Order
- Adjust quantities up or down
- Provide reason for modification
- Buyer receives email to review modifications
- Buyer can accept or reject changes

#### ❌ Decline Order
- Cannot fulfill any part of order
- Provide reason for decline
- System seeks alternative farms (future feature)
- Buyer notified if no alternatives available

---

## 4. Buyer Modification Review

### When Farm Modifies Order

**Buyer receives email:**
- Subject: "Order #12345 Modified - Review Required"
- Lists farms that modified quantities
- Shows modification reasons
- Direct link to review page

**Review page shows:**
- Side-by-side comparison (original vs modified)
- Per-farm modifications
- Updated total price
- Accept or reject buttons

**Buyer options:**
- **Accept:** Proceed with modified order
- **Reject:** Cancel order, full refund issued

---

## 5. Pickup Coordination

### After Order Verified

**Farm receives:**
- QR code for pickup verification
- Buyer contact information
- Delivery address and schedule
- Preferred pickup time

**Buyer receives:**
- Confirmation that order is ready
- Pickup location (farm address)
- QR code to show farm
- Contact info for coordination

### At Pickup

1. Farm scans buyer's QR code OR buyer scans farm's QR code
2. System confirms identity
3. Items transferred
4. Payment captured from hold
5. Farm receives payout (minus platform fee)

---

## 6. Notification Triggers

### Automated Email Notifications

| Event | Recipient | Subject | Timing |
|-------|-----------|---------|--------|
| Order placed | Buyer | "Order Confirmation #XXX" | Immediate |
| Order placed | Farms | "New Order - Response Required" | Immediate |
| 6 hours before deadline | Farms | "⏰ Urgent: Deadline in 6h" | 18hrs after order |
| Farm modifies | Buyer | "Order Modified - Review Required" | Immediate |
| Buyer approves mods | Farms | "Modifications Approved" | Immediate |
| Buyer rejects mods | Farms | "Order Cancelled - Refund Issued" | Immediate |
| Order ready | Buyer | "Order Ready for Pickup" | When all verified |
| Pickup complete | Both | "Order Complete - Receipt" | At QR scan |

### SMS Notifications (Optional)

Sent to farms with phone numbers on file:
- New order alert
- Deadline reminders (6hrs, 2hrs, 30min)

---

## 7. Logistics Information Storage

### Order Table Fields

```javascript
{
  // Buyer contact
  buyer_name: "Restaurant ABC",
  buyer_email: "orders@restaurantabc.com",
  buyer_phone: "+1-613-555-0123",
  
  // Delivery logistics
  delivery_address: "123 Princess Street",
  delivery_city: "Kingston",
  delivery_province: "ON",
  delivery_postal_code: "K7L 1A1",
  
  // Schedule
  fulfillment_cadence: "weekly", // one_time, weekly, biweekly, monthly
  preferred_pickup_time: "8:00 AM - 10:00 AM",
  delivery_instructions: "Use loading dock entrance on east side. Call 30min before arrival.",
  
  // Timing
  verification_deadline: "2025-12-23T20:30:00Z",
  created_at: "2025-12-22T20:30:00Z"
}
```

---

## 8. Farm Contact Information

### Required Fields

To receive notifications, farms must have:
- ✅ Farm name
- ✅ Primary email address
- ⚠️ Phone number (optional, for SMS)
- ⚠️ Secondary email (optional, for backup)

### Farm Profile Setup

Farm profile page should collect:
```javascript
{
  farm_id: "GR-12345",
  farm_name: "Green Acres Farm",
  business_email: "orders@greenacres.com",
  notifications_email: "alerts@greenacres.com", // Optional
  phone: "+1-613-555-0199",
  sms_enabled: true, // Opt-in for SMS
  notification_preferences: {
    email_immediately: true,
    sms_immediately: false,
    sms_urgent_only: true, // Last 6 hours only
    deadline_reminders: true
  }
}
```

---

## 9. Email Templates

### Farm New Order Template

**Subject:** `New Wholesale Order #${order_id} - Response Required`

**Content:**
- Green gradient header with GreenReach branding
- Alert box: "⏰ You have X hours to verify"
- Order details card (buyer, total, items)
- Logistics card (address, schedule, instructions)
- Big green button: "View & Respond to Order →"
- Footer: What you can do (Accept/Modify/Decline)

**Design:**
- Professional, easy to scan
- Mobile-responsive
- High-contrast for accessibility
- Clear call-to-action

### Buyer Confirmation Template

**Subject:** `Order Confirmation #${order_id} - GreenReach Wholesale`

**Content:**
- Green header with order number
- Success message: "✓ Order Placed Successfully"
- Payment confirmation (amount, Square payment ID)
- What happens next (numbered steps)
- Delivery details
- Track order button

---

## 10. Configuration

### Environment Variables

```bash
# Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=noreply@greenreach.ca
SMTP_PASS=your_password_here
NOTIFICATIONS_FROM_EMAIL=orders@greenreach.ca

# SMS Configuration (Optional - Twilio)
TWILIO_ACCOUNT_SID=your_sid
TWILIO_AUTH_TOKEN=your_token
TWILIO_PHONE_NUMBER=+1234567890

# Application URL
APP_URL=https://your-farm-domain.com
```

### Setup Steps

1. **Install nodemailer:**
   ```bash
   npm install nodemailer
   ```

2. **Configure SMTP credentials:**
   - Gmail: Use App Passwords
   - AWS SES: Use SMTP credentials
   - SendGrid: Use API key as password

3. **Test notifications:**
   ```bash
   # Create test order to verify emails send
   curl -X POST http://localhost:8091/api/wholesale/orders/create \
     -H "Content-Type: application/json" \
     -d '{...order data...}'
   ```

4. **Monitor logs:**
   ```bash
   # Check for notification success/failure
   tail -f logs/notifications.log
   ```

---

## 11. Future Enhancements

### Phase 2 Features

1. **In-App Notifications**
   - Real-time push notifications
   - Bell icon with badge count
   - Notification center in dashboard

2. **SMS Reminders**
   - Twilio integration
   - Deadline countdown alerts
   - Delivery confirmations

3. **Notification Preferences**
   - Farm settings page
   - Choose email/SMS/push
   - Quiet hours configuration
   - Digest vs immediate

4. **Delivery Route Optimization**
   - Map view of pickup locations
   - Suggested pickup order
   - Distance calculations
   - Traffic-aware timing

5. **Auto-Reminder System**
   - Cron job checks deadlines
   - Sends reminders at 18h, 6h, 2h, 30min
   - Escalates to phone call if no response

---

## 12. Troubleshooting

### Farm Not Receiving Emails

**Check:**
1. Farm email address in database
2. SMTP credentials configured
3. Email not in spam folder
4. Check server logs for send errors
5. Verify firewall allows SMTP port

**Solution:**
```bash
# Test SMTP connection
node -e "
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({...});
transporter.verify((error, success) => {
  console.log(error ? 'SMTP Error' : 'SMTP Ready');
});
"
```

### Notifications Delayed

**Check:**
1. Email queue size
2. SMTP rate limits
3. Server load
4. Database query performance

**Solution:**
- Implement queue (Bull/Redis)
- Batch notifications
- Use async/await properly

---

## Summary

✅ **Farms are notified via:**
- Email with full logistics details
- SMS with order summary (optional)
- Direct link to dashboard

✅ **Farms receive:**
- Complete delivery address
- Fulfillment schedule
- Special instructions
- Buyer contact information
- Items list with pricing

✅ **Farms can:**
- Accept orders immediately
- Modify quantities with reason
- Decline with explanation
- Access anytime via dashboard

✅ **System handles:**
- Automated email sending
- SMS notifications (optional)
- Deadline reminders
- Status updates to all parties
- Payment coordination

**Next Steps:**
1. Add farm contact info to database schema
2. Configure SMTP credentials
3. Test end-to-end order flow
4. Add deadline reminder cron job
5. Implement SMS via Twilio (optional)
