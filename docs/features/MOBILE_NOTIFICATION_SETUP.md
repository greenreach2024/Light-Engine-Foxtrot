# Mobile Notification Setup Guide

## Overview

Three types of notifications available:
1. ✅ **Email** - Already configured (nodemailer)
2. 🟡 **SMS** - Requires Twilio setup (15 min)
3. 🟡 **Push** - Requires Firebase setup (60 min)

---

## 1. SMS Notifications (Twilio)

### Why SMS?
- Instant delivery (< 5 seconds)
- 98% open rate within 3 minutes
- Works on any phone
- Perfect for urgent deadlines

### Setup Steps

**Step 1: Create Twilio Account**
```bash
# Sign up at twilio.com
# Free trial: $15 credit, 500+ messages
```

**Step 2: Get Phone Number**
- Dashboard → Phone Numbers → Buy a Number
- Choose local number ($1/month)
- Enable SMS capability

**Step 3: Get Credentials**
```bash
# From Twilio Console:
Account SID: ACxxxxxxxxxxxxxxxxxxxx
Auth Token: xxxxxxxxxxxxxxxxxxxx
Phone Number: +16135551234
```

**Step 4: Configure Environment**
```bash
# Add to .env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+16135551234
```

**Step 5: Install Package**
```bash
npm install twilio
```

**Step 6: Test**
```bash
# Send test SMS
curl -X POST http://localhost:8091/api/test/sms \
  -H "Content-Type: application/json" \
  -d '{"phone":"+16135551234","message":"Test from GreenReach"}'
```

### SMS Notifications Sent

| Event | Recipient | Message |
|-------|-----------|---------|
| New order | Farm | "GreenReach Order #123, 24hrs to respond, $150 total, View: [link]" |
| 6hr deadline | Farm | "URGENT: Order #123 expires in 6hrs! Respond now: [link]" |
| 2hr deadline | Farm | "⏰ CRITICAL: Order #123 expires in 2hrs! Respond NOW" |
| Order modified | Buyer | "[Farm] modified Order #123. Review: [link]" |
| Ready for pickup | Buyer | "Order #123 ready for pickup! [link]" |

### Cost
- $0.0079 per SMS (< 1¢)
- 100 orders/month = ~$0.80
- 1000 orders/month = ~$8.00

---

## 2. Push Notifications (Firebase)

### Why Push?
- Rich notifications (images, buttons)
- Works when app closed
- Free (unlimited)
- iOS and Android support

### Setup Steps

**Step 1: Create Firebase Project**
```bash
# Go to console.firebase.google.com
# Create new project: "GreenReach-Prod"
# Enable Cloud Messaging
```

**Step 2: Get Service Account**
```bash
# Cloud Run/GCP recommended: use keyless ADC via service account IAM
# Firebase Console → Project Settings → Service Accounts
# Only for local fallback, generate JSON and store OUTSIDE this repo
```

**Step 3: Configure Environment**
```bash
# Add to .env
FIREBASE_ENABLED=true
# Optional local fallback only:
# GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/outside/repo/firebase-service-account.json
# FIREBASE_SERVICE_ACCOUNT_PATH=/absolute/path/outside/repo/firebase-service-account.json
```

**Step 4: Install Packages**
```bash
npm install firebase-admin
```

**Step 5: Add Service Worker to Farm Dashboard**

Create `public/firebase-messaging-sw.js`:
```javascript
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "YOUR_API_KEY",
  authDomain: "greenreach-prod.firebaseapp.com",
  projectId: "greenreach-prod",
  storageBucket: "greenreach-prod.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('[Firebase SW] Received background message:', payload);
  
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/images/greenreach-icon.png',
    badge: '/images/badge.png',
    data: payload.data
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});
```

**Step 6: Request Permission in Farm Dashboard**

Add to `public/wholesale-farm-orders.html`:
```javascript
<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "greenreach-prod.firebaseapp.com",
  projectId: "greenreach-prod",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};

const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);

// Request permission on page load
async function requestPermission() {
  try {
    const permission = await Notification.requestPermission();
    
    if (permission === 'granted') {
      console.log('Notification permission granted');
      
      // Get FCM token
      const token = await getToken(messaging, {
        vapidKey: 'YOUR_VAPID_KEY' // From Firebase Console
      });
      
      console.log('FCM Token:', token);
      
      // Save token to server
      await fetch('/api/farm/register-device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farm_id: localStorage.getItem('farm_id'),
          device_token: token,
          platform: 'web'
        })
      });
      
    } else {
      console.log('Notification permission denied');
    }
  } catch (error) {
    console.error('Error getting permission:', error);
  }
}

// Call on page load
if ('Notification' in window && Notification.permission !== 'granted') {
  requestPermission();
}

// Handle foreground messages
onMessage(messaging, (payload) => {
  console.log('Foreground message:', payload);
  
  // Show notification
  new Notification(payload.notification.title, {
    body: payload.notification.body,
    icon: '/images/greenreach-icon.png',
    data: payload.data
  });
});
</script>
```

**Step 7: Store Device Tokens**

Add table for device tokens:
```sql
CREATE TABLE device_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id VARCHAR(50),
  buyer_id VARCHAR(50),
  device_token TEXT NOT NULL UNIQUE,
  platform VARCHAR(20), -- 'web', 'ios', 'android'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT true
);

CREATE INDEX idx_device_farm ON device_tokens(farm_id);
CREATE INDEX idx_device_buyer ON device_tokens(buyer_id);
```

Add API endpoint in `server-foxtrot.js`:
```javascript
app.post('/api/farm/register-device', async (req, res) => {
  const { farm_id, device_token, platform } = req.body;
  
  // INSERT OR REPLACE INTO device_tokens
  // (farm_id, device_token, platform, last_used)
  // VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  
  res.json({ success: true, message: 'Device registered' });
});
```

### Push Notifications Sent

| Event | Recipient | Title | Body |
|-------|-----------|-------|------|
| New order | Farm | "New Wholesale Order" | "[Buyer] placed order #123 ($150) - 24hrs to respond" |
| 6hr deadline | Farm | "⏰ Order Deadline" | "Order #123 expires in 6 hours!" |
| Modified | Buyer | "Order Modified" | "[Farm] adjusted order #123" |
| Pickup ready | Buyer | "Order Ready!" | "Order #123 from [Farm] ready" |

### Cost
- **FREE** - Unlimited messages

---

## 3. Database Schema Updates

### Add columns to `farms` table:
```sql
ALTER TABLE farms ADD COLUMN phone VARCHAR(20);
ALTER TABLE farms ADD COLUMN sms_enabled BOOLEAN DEFAULT true;
ALTER TABLE farms ADD COLUMN push_enabled BOOLEAN DEFAULT true;
```

### Add columns to `buyers` table:
```sql
ALTER TABLE buyers ADD COLUMN phone VARCHAR(20);
ALTER TABLE buyers ADD COLUMN sms_enabled BOOLEAN DEFAULT false;
ALTER TABLE buyers ADD COLUMN push_enabled BOOLEAN DEFAULT true;
```

### Create `notification_preferences` table:
```sql
CREATE TABLE notification_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id VARCHAR(50) NOT NULL,
  user_type VARCHAR(20) NOT NULL, -- 'farm' or 'buyer'
  
  -- Email preferences
  email_new_order BOOLEAN DEFAULT true,
  email_deadline BOOLEAN DEFAULT true,
  email_modification BOOLEAN DEFAULT true,
  email_pickup BOOLEAN DEFAULT true,
  
  -- SMS preferences
  sms_new_order BOOLEAN DEFAULT true,
  sms_deadline BOOLEAN DEFAULT true,
  sms_modification BOOLEAN DEFAULT false,
  sms_pickup BOOLEAN DEFAULT false,
  
  -- Push preferences
  push_new_order BOOLEAN DEFAULT true,
  push_deadline BOOLEAN DEFAULT true,
  push_modification BOOLEAN DEFAULT true,
  push_pickup BOOLEAN DEFAULT true,
  
  -- Timing preferences
  quiet_hours_start TIME, -- e.g., '22:00:00'
  quiet_hours_end TIME,   -- e.g., '07:00:00'
  
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 4. Notification Settings UI

### Farm Settings Page

Add to farm dashboard:
```html
<div class="notification-settings">
  <h3>Notification Preferences</h3>
  
  <div class="setting-group">
    <label>
      <input type="checkbox" id="email-enabled" checked>
      Email Notifications
    </label>
  </div>
  
  <div class="setting-group">
    <label>
      <input type="checkbox" id="sms-enabled" checked>
      SMS Notifications
    </label>
    <input type="tel" id="phone-number" placeholder="+1 (613) 555-1234">
  </div>
  
  <div class="setting-group">
    <label>
      <input type="checkbox" id="push-enabled" checked>
      Push Notifications (Mobile)
    </label>
    <button id="enable-push">Enable Push Notifications</button>
  </div>
  
  <h4>Which events?</h4>
  <label><input type="checkbox" checked> New orders (urgent)</label>
  <label><input type="checkbox" checked> Deadline reminders</label>
  <label><input type="checkbox"> Order modifications</label>
  
  <h4>Quiet Hours</h4>
  <input type="time" value="22:00"> to <input type="time" value="07:00">
  <small>No notifications during these hours (except critical)</small>
  
  <button class="save-btn">Save Preferences</button>
</div>
```

---

## 5. Testing Notifications

### Test SMS
```bash
curl -X POST http://localhost:8091/api/test/notifications \
  -H "Content-Type: application/json" \
  -d '{
    "type": "sms",
    "phone": "+16135551234",
    "message": "Test SMS from GreenReach"
  }'
```

### Test Push
```bash
curl -X POST http://localhost:8091/api/test/notifications \
  -H "Content-Type: application/json" \
  -d '{
    "type": "push",
    "device_token": "fcm_token_here",
    "title": "Test Push",
    "body": "This is a test notification"
  }'
```

### Test Full Flow
```bash
# 1. Create test order
curl -X POST http://localhost:8091/api/wholesale/orders/create \
  -H "Content-Type: application/json" \
  -d '{ ... order data ... }'

# Should send: Email, SMS, Push to farm
# Check logs for delivery status
```

---

## 6. Monitoring & Analytics

### Track Notification Delivery

Create `notification_logs` table:
```sql
CREATE TABLE notification_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_type VARCHAR(20), -- 'email', 'sms', 'push'
  recipient_id VARCHAR(50),
  recipient_type VARCHAR(20), -- 'farm', 'buyer'
  event_type VARCHAR(50), -- 'new_order', 'deadline', etc.
  status VARCHAR(20), -- 'sent', 'delivered', 'failed', 'bounced'
  delivery_time_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Dashboard Metrics
- SMS delivery rate
- Push notification open rate
- Email open rate
- Average response time by notification type

---

## 7. Current Status

### ✅ Implemented
- Email notification service (nodemailer)
- SMS service (Twilio integration)
- Push service (Firebase FCM)
- All templates ready
- Integrated into order workflow

### ⏳ TODO
1. Configure Twilio account
2. Configure Firebase project
3. Add device token storage
4. Add notification preferences UI
5. Add service worker for web push
6. Test end-to-end flow

### 📊 Expected Notification Flow

**When order placed:**
```
Buyer places order
  ↓
Email → Farm (immediately)
SMS → Farm (if phone on file, <5 sec)
Push → Farm (if app installed, <2 sec)
```

**When deadline approaches:**
```
18hrs: Email reminder
6hrs:  Email + SMS reminder
2hrs:  SMS + Push (urgent)
30min: SMS + Push (critical)
```

---

## 8. Cost Estimate

### Monthly costs for 1000 orders:

| Service | Volume | Cost |
|---------|--------|------|
| Email (AWS SES) | 3000 emails | ~$0.30 |
| SMS (Twilio) | 1000 texts | ~$8.00 |
| Push (Firebase) | 5000 notifications | $0.00 |
| **Total** | | **~$8.30/month** |

---

## Quick Start

**Fastest path to production:**

1. **Email only** (Already working)
   - Configure SMTP credentials
   - Deploy

2. **Add SMS** (15 minutes)
   ```bash
   npm install twilio
   # Add Twilio credentials to .env
   # Deploy
   ```

3. **Add Push** (Later phase)
   - Set up Firebase project
   - Add service worker
   - Update farm/buyer apps

**Recommendation:** Start with Email + SMS, add Push in Phase 2 when mobile apps are built.
