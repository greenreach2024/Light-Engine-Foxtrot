# Auto-Login Flow Issues and Fixes - January 4, 2026

## User's Concerns (100% Valid)

You identified critical flaws in the automatic login implementation:

1. **Users never see/use the temporary password** - They're auto-logged in with JWT token before receiving email
2. **No password change prompt** - Users bypass the temporary password entirely  
3. **Setup wizard doesn't run** - Redirected directly to dashboard instead of setup flow

## Root Cause Analysis

### What I Initially Implemented (FLAWED):
```
Purchase → Payment → JWT Token Generated → Auto-redirect to /dashboard.html
```

**Problems:**
- Temporary password generated but never used
- No opportunity to change password from temporary
- No first-time setup flow
- Dashboard expects configured farm (rooms, zones, etc.)
- Security concern: User never sets their own password

### What SHOULD Happen:
```
Purchase → Payment → JWT Token → Auto-redirect to /setup-wizard.html
  → Step 1: Change Password
  → Step 2: Farm Profile  
  → Step 3: Create Rooms
  → Step 4: Configure Zones
  → Complete → Redirect to /dashboard.html
```

---

## Current Status

### ✅ Fixed (Commit 7115db2):
1. **Purchase-success.html** now redirects to `/setup-wizard.html` instead of `/dashboard.html`
2. Added `isNewUser` flag to localStorage for first-time detection
3. Updated UI messaging to indicate setup wizard flow
4. Email still sent with backup credentials

### ❌ Still Needs Work:

#### 1. Password Change Endpoint Missing
**File:** `routes/setup-wizard.js`
**Need to Add:**
```javascript
POST /api/setup-wizard/change-password
Body: { newPassword: string }
- Validates password strength (min 8 chars)
- Hashes with bcrypt  
- Updates users.password_hash
- Marks email_verified = true
```

#### 2. Setup Wizard Missing Password Step
**File:** `public/setup-wizard.html`
**Current Flow:**
- Step 0: Welcome
- Step 1: Network Configuration (Edge only)
- Step 2: Register Farm
- Step 3: Desktop App Download (conditional)
- Step 4: Farm Certifications
- Step 5: Cloud Welcome / Hardware Detection
- Step 6: Complete

**Need to Add as Step 0:**
```html
<div class="wizard-step" id="step-0" data-step="password">
    <h1>Create Your Password</h1>
    <p>Your temporary password was sent via email. Please create a new secure password.</p>
    
    <form id="password-form">
        <div class="input-group">
            <label>New Password (min 8 characters)</label>
            <input type="password" id="new-password" minlength="8" required>
        </div>
        
        <div class="input-group">
            <label>Confirm Password</label>
            <input type="password" id="confirm-password" minlength="8" required>
        </div>
        
        <button type="submit">Continue</button>
    </form>
</div>
```

#### 3. JWT Token Missing userId
**File:** `routes/purchase.js` (Line ~570)
**Current:**
```javascript
const token = jwt.sign(
  { 
    farmId: farm_id, 
    userId: user_id,  // ✅ Already added
    email: email,
    role: 'admin'
  },
  jwtSecret,
  { expiresIn: '7d' }
);
```
**Status:** Actually already fixed in commit a95905c - token includes userId

#### 4. Setup Completion Check Missing
**Files:** `public/LE-dashboard.html`, `public/login.html`
**Need to Add:** On page load, check if setup is complete:
```javascript
// Check if user needs to complete setup
const response = await fetch('/api/setup-wizard/status', {
    headers: { 'Authorization': `Bearer ${token}` }
});
const data = await response.json();

if (!data.setupCompleted && !window.location.pathname.includes('setup-wizard')) {
    window.location.href = '/setup-wizard.html';
}
```

---

## Implementation Plan

### Phase 1: Backend API (30 mins)
**File:** `routes/setup-wizard.js`

1. Add bcrypt import:
```javascript
import bcrypt from 'bcrypt';
```

2. Capture userId in authenticateToken middleware:
```javascript
req.userId = decoded.userId;
```

3. Add password change endpoint:
```javascript
router.post('/change-password', authenticateToken, async (req, res) => {
  const { newPassword } = req.body;
  const userId = req.userId;
  
  // Validate
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  
  // Hash and update
  const password_hash = await bcrypt.hash(newPassword, 10);
  await pool.query(
    'UPDATE users SET password_hash = $1, email_verified = true WHERE id = $2',
    [password_hash, userId]
  );
  
  res.json({ success: true });
});
```

### Phase 2: Frontend Setup Wizard (60 mins)
**File:** `public/setup-wizard.html`

1. Inject password change step as new Step 0
2. Shift all existing steps +1  
3. Add form validation and submission:
```javascript
async function submitPasswordChange() {
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    
    if (newPassword !== confirmPassword) {
        alert('Passwords do not match');
        return;
    }
    
    const token = localStorage.getItem('token');
    const response = await fetch('/api/setup-wizard/change-password', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ newPassword })
    });
    
    if (response.ok) {
        nextStep(); // Proceed to farm profile
    } else {
        const error = await response.json();
        alert(error.error);
    }
}
```

### Phase 3: Dashboard Setup Guard (20 mins)
**Files:** `public/LE-dashboard.html`, `public/login.html`

Add to page initialization:
```javascript
async function checkSetupStatus() {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }
    
    try {
        const response = await fetch('/api/setup-wizard/status', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        if (!data.setupCompleted) {
            window.location.href = '/setup-wizard.html';
        }
    } catch (error) {
        console.error('Setup check failed:', error);
    }
}

// Run on page load
checkSetupStatus();
```

### Phase 4: Testing (30 mins)
1. Create new purchase
2. Verify redirect to setup wizard (not dashboard)
3. Complete password change step
4. Complete farm profile, rooms, zones
5. Mark setup complete
6. Verify redirect to dashboard
7. Test logout and login with new password
8. Verify dashboard accessible after setup complete

---

## Correct User Flow (After Implementation)

### New User Purchase:
```
1. Visit /purchase.html
2. Fill form → Square payment
3. Redirected to /purchase-success.html
4. JWT token generated & stored (includes userId)
5. Auto-redirect to /setup-wizard.html (3 seconds)
```

### Setup Wizard Steps:
```
Step 0: CREATE PASSWORD
  - Enter new password (min 8 chars)
  - Confirm password
  - POST /api/setup-wizard/change-password
  - Password hashed and updated in users table
  
Step 1: FARM PROFILE
  - Farm name, location, timezone
  - Crop types, business hours
  - POST /api/setup-wizard/farm-profile
  
Step 2: CREATE ROOMS
  - Room name, dimensions, type
  - POST /api/setup-wizard/rooms
  
Step 3: CONFIGURE ZONES
  - Zone assignments, growing params
  - POST /api/setup-wizard/zones
  
Step 4: COMPLETE
  - POST /api/setup-wizard/complete
  - Marks setup as complete in database
  - Redirect to /LE-dashboard.html
```

### Accessing Dashboard:
```
- On load, check /api/setup-wizard/status
- If setupCompleted = false → redirect to /setup-wizard.html
- If setupCompleted = true → show dashboard
```

### Future Logins:
```
1. Visit /login.html
2. Enter Farm ID, email, NEW password (not temporary)
3. JWT token generated
4. Dashboard checks setup status
5. If complete → show dashboard
6. If incomplete → redirect to setup wizard
```

---

## Files Requiring Changes

### Backend:
- [x] `routes/purchase.js` - JWT token includes userId (done in commit a95905c)
- [ ] `routes/setup-wizard.js` - Add POST /api/setup-wizard/change-password
- [ ] `routes/setup-wizard.js` - Add userId to authenticateToken middleware

### Frontend:
- [x] `public/purchase-success.html` - Redirect to setup-wizard.html (done in commit 7115db2)
- [ ] `public/setup-wizard.html` - Add Step 0: Password Change
- [ ] `public/setup-wizard.html` - Add password change form submission logic
- [ ] `public/LE-dashboard.html` - Add setup completion guard on page load
- [ ] `public/login.html` - Add setup completion check after successful login

---

## Security Considerations

### Current Approach (Fixed):
- Temporary password generated and emailed
- User MUST change password during setup (Step 0)
- Temporary password becomes invalid once changed
- New password is user-chosen and secure

### Email Still Useful For:
- Backup reference of Farm ID
- Multi-device login (after password change)
- Account recovery context
- Proof of purchase record

### Password Security:
- Minimum 8 characters enforced
- bcrypt hashing (cost factor 10)
- No password stored in JWT token
- Email verification marked true after password change

---

## Testing Checklist

### Before Deployment:
- [ ] Add password change endpoint to routes/setup-wizard.js
- [ ] Add bcrypt import to routes/setup-wizard.js
- [ ] Add password step to setup-wizard.html
- [ ] Add password form validation
- [ ] Add password submission logic
- [ ] Add dashboard setup guard
- [ ] Add login setup check

### After Deployment:
- [ ] Purchase test subscription
- [ ] Verify redirect to setup wizard (not dashboard)
- [ ] Complete password change
- [ ] Verify password updated in database
- [ ] Complete farm profile
- [ ] Complete room creation
- [ ] Complete zone configuration
- [ ] Verify redirect to dashboard
- [ ] Log out
- [ ] Log in with NEW password (not temporary)
- [ ] Verify dashboard loads without redirect
- [ ] Test multi-device login with new password

---

## Summary

**Your concerns were 100% valid.** The initial auto-login implementation had a critical flaw: users never set their own password and the setup wizard was bypassed entirely.

**Fix Status:**
- ✅ Partial fix deployed (redirect to setup wizard)
- ❌ Password change endpoint still needed
- ❌ Setup wizard password step still needed  
- ❌ Dashboard setup guard still needed

**Estimated Time to Complete:** 2-3 hours

**Priority:** HIGH - This is a security and UX issue that blocks proper onboarding.

---

**Next Action:** Implement the remaining pieces (password change endpoint, setup wizard step, dashboard guard) before testing the purchase flow again.
