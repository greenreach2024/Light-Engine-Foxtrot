# Cloud vs Edge Customer Flow - Complete Trace

## Overview
This document traces how the system identifies Cloud vs Edge customers throughout the purchase and login flow, and how the setup wizard uses this information to skip the activation code step for Cloud customers.

## 1. Purchase Flow - Plan Selection

### Frontend: `/public/purchase.html`
```javascript
// Lines 751 & 798: User clicks purchase button
<button onclick="purchaseProduct('edge')">Purchase Edge Device</button>
<button onclick="purchaseProduct('cloud')">Start Cloud Plan</button>

// Line 1104: Plan passed to checkout API
body: JSON.stringify({
    plan: currentPlan,  // 'cloud' or 'edge'
    farm_name: farmName,
    contact_name: contactName,
    email: email
})
```

**Key Point:** Plan type ('cloud' or 'edge') is explicitly selected by user and sent to backend.

---

## 2. Database Storage - Creating Farm Record

### Backend: `/routes/purchase.js` - `verify-session` endpoint

```javascript
// Line 464-489: Insert farm with plan_type
await db.query(`
  INSERT INTO farms (
    farm_id,
    name,
    email,
    contact_name,
    plan_type,      // ← Stored here as 'Cloud' or 'Edge'
    api_key,
    api_secret,
    jwt_secret,
    square_payment_id,
    square_amount,
    status,
    created_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', NOW())
`, [
  farm_id,
  farm_name,
  email,
  contact_name,
  plan,             // ← 'cloud' or 'edge' from request
  api_key,
  api_secret,
  jwt_secret,
  payment_intent_id,
  100
]);
```

**Key Point:** Plan type is persisted in `farms.plan_type` column in PostgreSQL database.

---

## 3. JWT Token Generation - Including Plan Type

### After Purchase: `/routes/purchase.js`

```javascript
// Lines 579-591: Generate JWT with planType
const token = jwt.sign(
  { 
    farmId: farm_id, 
    userId: user_id,
    email: email,
    role: 'admin',
    planType: plan  // ← 'cloud' or 'edge' in JWT payload
  },
  jwtSecret,
  { expiresIn: '7d' }
);

return res.json({
  success: true,
  farm_id,
  email,
  plan_type: plan,  // ← Also returned in response
  token
});
```

### After Login: `/server-foxtrot.js`

```javascript
// Lines 13857-13868: Login JWT includes planType
const jwtToken = jwt.sign(
  {
    farmId: farm.farm_id,
    email: user.email,
    role: user.role || 'admin',
    userId: user.user_id,
    planType: farm.plan_type || 'cloud'  // ← From database
  },
  jwtSecret,
  { expiresIn: '24h' }
);

// Lines 13903-13914: Response includes planType
return res.json({
  status: 'success',
  token: jwtToken,
  farmId: farm.farm_id,
  farmName: farm.name,
  email: user.email,
  role: user.role || 'admin',
  planType: farm.plan_type || 'cloud',  // ← Returned to frontend
  subscription,
  expiresAt: sessionExpiry.toISOString(),
  firstLogin: Boolean(firstLogin)
});
```

**Key Point:** JWT payload includes `planType` so it can be decoded client-side. Also returned in response for immediate use.

---

## 4. LocalStorage - Storing Plan Type

### Purchase Success: `/public/purchase-success.html`

```javascript
// Lines 276-281: Store plan type after purchase
if (data.token) {
    localStorage.setItem('token', data.token);
    localStorage.setItem('farmId', data.farm_id);
    localStorage.setItem('email', data.email);
    localStorage.setItem('planType', data.plan_type || 'Cloud');
    localStorage.setItem('isNewUser', 'true');
}
```

### Login: `/public/login.html`

```javascript
// Lines 311-317: Store plan type after login
localStorage.setItem('token', data.token);
localStorage.setItem('farmId', data.farmId);
localStorage.setItem('farmName', data.farmName || '');
localStorage.setItem('email', email);
localStorage.setItem('role', data.role || 'admin');
localStorage.setItem('planType', data.planType || 'cloud');
```

**Key Point:** Plan type stored in localStorage in two places:
1. Inside JWT token (encoded)
2. As separate `planType` key (for quick access)

---

## 5. Setup Wizard Detection - Skipping Activation Code

### Frontend: `/public/farm-admin.js`

```javascript
// Lines 3384-3415: showFirstTimeSetup() function
function showFirstTimeSetup() {
    const modal = document.getElementById('first-time-setup-modal');
    if (modal) {
        modal.style.display = 'flex';
        
        // Check if this is a Cloud plan customer (skip activation code step)
        const token = localStorage.getItem('token');
        let isCloudPlan = false;
        
        if (token) {
            try {
                // Decode JWT to get plan type
                const payload = JSON.parse(atob(token.split('.')[1]));
                isCloudPlan = payload.planType === 'Cloud' || payload.planType === 'cloud';
            } catch (e) {
                console.log('[Setup] Could not decode token, checking localStorage');
            }
        }
        
        // Also check localStorage for plan type
        if (!isCloudPlan) {
            const planType = localStorage.getItem('planType') || localStorage.getItem('plan_type');
            isCloudPlan = planType === 'Cloud' || planType === 'cloud';
        }
        
        // Start at Step 2 for Cloud customers (skip activation code)
        currentSetupStep = isCloudPlan ? 2 : 1;
        console.log(`[Setup] Starting wizard at step ${currentSetupStep} (Cloud: ${isCloudPlan})`);
        
        updateSetupStepDisplay();
    }
}
```

**Detection Logic:**
1. **Primary:** Decode JWT token and check `payload.planType`
2. **Fallback:** Check `localStorage.planType` or `localStorage.plan_type`
3. **Result:** 
   - Cloud customers → Start at Step 2 (Business Profile)
   - Edge customers → Start at Step 1 (Activation Code)

---

## 6. Setup Wizard Steps

### Step Structure: `/public/farm-admin.html`

```html
<!-- Step 1: Activation (Edge Only) -->
<div id="setup-step-1" class="setup-step">
    <h3>Activate Your Light Engine</h3>
    <input id="setup-activation-code" maxlength="8" placeholder="XXXXXXXX">
</div>

<!-- Step 2: Business Profile (All Users) -->
<div id="setup-step-2" class="setup-step">
    <h3>Business Profile</h3>
    <input id="setup-farm-name" placeholder="Farm Name">
    <input id="setup-contact-name" placeholder="Contact Name">
    <input id="setup-contact-email" type="email">
</div>

<!-- Step 3: Location -->
<!-- Step 4: Rooms & Zones -->
<!-- Step 5: Certifications -->
```

**Wizard Behavior:**
- **Cloud customers:** See Steps 2, 3, 4, 5 (4 steps total)
- **Edge customers:** See Steps 1, 2, 3, 4, 5 (5 steps total)

---

## Complete Flow Summary

### Cloud Customer Journey:
```
1. Visit /purchase.html
2. Click "Start Cloud Plan" → plan='cloud'
3. Fill form → Create checkout session
4. Square payment → Redirect to purchase-success.html
5. Backend creates farm with plan_type='Cloud' in database
6. Generate JWT with planType='Cloud'
7. Store: localStorage.planType='Cloud' + token with planType in payload
8. Redirect to /farm-admin.html
9. showFirstTimeSetup() detects planType='Cloud'
10. Start wizard at Step 2 (SKIP activation code)
```

### Edge Customer Journey:
```
1. Visit /purchase.html
2. Click "Purchase Edge Device" → plan='edge'
3. Fill form → Create checkout session
4. Square payment → Redirect to purchase-success.html
5. Backend creates farm with plan_type='Edge' in database
6. Generate JWT with planType='Edge'
7. Store: localStorage.planType='Edge' + token with planType in payload
8. Redirect to /farm-admin.html
9. showFirstTimeSetup() detects planType='Edge'
10. Start wizard at Step 1 (SHOW activation code)
```

### Login Flow (Existing Users):
```
1. Visit /login.html
2. Enter Farm ID, Email, Password
3. Backend queries database for farm.plan_type
4. Generate JWT with planType from database
5. Return planType in response
6. Store: localStorage.planType + token with planType
7. Check setup status
8. If incomplete → Redirect to /farm-admin.html → Wizard starts at correct step
9. If complete → Redirect to /LE-dashboard.html
```

---

## Database Schema

```sql
-- farms table includes plan_type column
CREATE TABLE farms (
    farm_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    contact_name VARCHAR(255),
    plan_type VARCHAR(50),  -- 'Cloud' or 'Edge'
    api_key VARCHAR(255),
    api_secret VARCHAR(255),
    jwt_secret VARCHAR(255),
    square_payment_id VARCHAR(255),
    square_amount INTEGER,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## API Endpoints Summary

| Endpoint | Method | Returns planType? | Source |
|----------|--------|------------------|--------|
| `/api/farms/create-checkout-session` | POST | No | Input: plan param |
| `/api/farms/verify-session/:id` | GET | Yes | JWT payload + response |
| `/api/farm/auth/login` | POST | Yes | JWT payload + response |
| `/api/setup-wizard/status` | GET | No | Setup completion check |

---

## Key Files Modified

1. **routes/purchase.js** - Added `planType` to JWT payload, return `plan_type` in response
2. **server-foxtrot.js** - Added `planType` to login JWT payload, return in response
3. **public/purchase-success.html** - Store `planType` in localStorage
4. **public/login.html** - Store `planType` in localStorage from login response
5. **public/farm-admin.js** - Detect plan type and skip activation step for Cloud

---

## Testing Checklist

- [ ] Cloud purchase → JWT contains `planType: 'Cloud'`
- [ ] Cloud purchase → localStorage has `planType: 'Cloud'`
- [ ] Cloud purchase → Wizard starts at Step 2 (Business Profile)
- [ ] Edge purchase → JWT contains `planType: 'Edge'`
- [ ] Edge purchase → localStorage has `planType: 'Edge'`
- [ ] Edge purchase → Wizard starts at Step 1 (Activation Code)
- [ ] Cloud login → planType retrieved from database
- [ ] Edge login → planType retrieved from database
- [ ] JWT decode works in browser console: `JSON.parse(atob(token.split('.')[1]))`
- [ ] Console log shows: `[Setup] Starting wizard at step 2 (Cloud: true)` for Cloud
- [ ] Console log shows: `[Setup] Starting wizard at step 1 (Cloud: false)` for Edge
