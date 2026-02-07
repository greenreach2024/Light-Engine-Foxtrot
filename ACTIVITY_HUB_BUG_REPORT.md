# ACTIVITY HUB PAIRING BUG REPORT
**Date:** February 6, 2026  
**Status:** 🔴 CRITICAL BUG FOUND (exists in BOTH AWS and LOCAL)

---

## EXECUTIVE SUMMARY

**The Activity Hub QR pairing page is IDENTICAL between AWS and LOCAL** (MD5: 9879f07459865e0f82c22bd6c4ad4ba8), but **BOTH have a critical bug** that prevents pairing from working after login.

**Root Cause:** localStorage key mismatch between login handler and Activity Hub page.

---

## THE BUG

### What Activity Hub QR Page Expects:
```javascript
// activity-hub-qr.html lines 271-273
const farmId = localStorage.getItem('farmId') || localStorage.getItem('farm_id');
const farmName = localStorage.getItem('farmName') || localStorage.getItem('farm_name');
const token = localStorage.getItem('deviceToken') || localStorage.getItem('token') || localStorage.getItem('auth_token');
```

### What Login Handler Actually Saves:
```javascript
// farm-admin.js lines 207-217
const session = {
    token: data.token,
    farmId: data.farmId,
    farmName: data.farmName,
    email: data.email,
    role: data.role,
    subscription: data.subscription,
    expiresAt: Date.now() + (24 * 60 * 60 * 1000)
};

saveSession(session);  // Saves to localStorage['farm_admin_session'] as JSON string
```

### The Problem:
The login handler saves everything nested inside `farm_admin_session` object, but the Activity Hub page looks for flat keys:
- ❌ `localStorage.getItem('farmId')` → **null** (doesn't exist)
- ❌ `localStorage.getItem('token')` → **null** (doesn't exist)
- ✓ `localStorage.getItem('farm_admin_session')` → **exists** (but contains JSON string)

---

## SYMPTOMS

When you log in and go to Activity Hub QR page:
1. Farm Name displays: "Unknown Farm" (should show actual farm name)
2. Farm ID displays: "Unknown" (should show FARM-TEST-WIZARD-001)
3. QR code shows error: "Error: Not logged in" (because token is null)
4. Console logs: `farmId: 'null', farmName: 'null', hasToken: false`

---

## VERIFICATION

**File Comparison:**
```bash
MD5 LOCAL:  9879f07459865e0f82c22bd6c4ad4ba8
MD5 AWS:    9879f07459865e0f82c22bd6c4ad4ba8
Diff result: FILES ARE IDENTICAL
```

**This confirms:**
- ✓ Activity Hub HTML is identical
- ✓ Bug exists in BOTH environments
- ✓ Not a deployment issue
- ❌ Bug was in your local code before deployment

---

## THE FIX

Two options:

### Option A: Fix Activity Hub to Read from farm_admin_session (Recommended)
**File:** `public/activity-hub-qr.html` lines 271-273

```javascript
// BEFORE (broken):
const farmId = localStorage.getItem('farmId') || localStorage.getItem('farm_id');
const farmName = localStorage.getItem('farmName') || localStorage.getItem('farm_name');
const token = localStorage.getItem('deviceToken') || localStorage.getItem('token') || localStorage.getItem('auth_token');

// AFTER (fixed):
function getSessionData() {
  const sessionStr = localStorage.getItem('farm_admin_session');
  if (!sessionStr) return { farmId: null, farmName: null, token: null };
  try {
    const session = JSON.parse(sessionStr);
    return {
      farmId: session.farmId,
      farmName: session.farmName,
      token: session.token
    };
  } catch (e) {
    return { farmId: null, farmName: null, token: null };
  }
}

const { farmId, farmName, token } = getSessionData();
```

### Option B: Fix Login Handler to Save Individual Keys
**File:** `public/farm-admin.js` lines 218-220 (after saveSession())

```javascript
saveSession(session);

// ALSO save individual keys for compatibility with Activity Hub
localStorage.setItem('farmId', data.farmId);
localStorage.setItem('farm_id', data.farmId);  // Fallback
localStorage.setItem('farmName', data.farmName);
localStorage.setItem('farm_name', data.farmName);  // Fallback
localStorage.setItem('token', data.token);
localStorage.setItem('auth_token', data.token);  // Fallback
```

**Recommendation:** Option A is cleaner - fix Activity Hub to use the session object.

---

## IMPACT ASSESSMENT

**Current State:**
- 🔴 Activity Hub pairing: **BROKEN** on AWS
- 🔴 Activity Hub pairing: **BROKEN** on LOCAL
- 🟢 Activity Hub HTML: **IDENTICAL** (not a deployment issue)
- 🔴 User Experience: iPad scanning QR sees "Not logged in" error

**After Fix:**
- 🟢 QR code will contain proper token and farm credentials
- 🟢 iPads will successfully pair via QR scan
- 🟢 Farm name and ID will display correctly

---

## WHY THIS MATTERS

This explains what you saw:
1. "Activity hub pairing is wrong" → YES, it's broken
2. "I see pages that I don't recognize" → You saw "Unknown Farm" instead of your farm name
3. Not a deployment issue → Bug exists in both LOCAL and AWS

The authentication unification work I did does affect this (AWS required email before, so people couldn't even log in to see this bug), but the Activity Hub bug itself is independent.

---

## NEXT STEPS

1. **Choose fix strategy** (Option A or B)
2. **Apply fix locally**
3. **Test locally** - log in, go to Activity Hub QR, verify farm name shows
4. **Include in next AWS deployment bundle**
5. **Test on AWS after deployment**

---

## DEPLOYMENT STATUS

**Current AWS Bundle:** foxtrot-source-20260206-205004.zip  
**Contains Activity Hub bug:** YES (identical to local)  
**Authentication fixes deployed:** NO (bundle predates auth work)  

**Recommended:** Fix Activity Hub locally, bundle with auth fixes, deploy together.

---

**Report Generated:** February 6, 2026, 21:47 EST  
**Bug Severity:** HIGH (blocks iPad pairing workflow)  
**Fix Complexity:** LOW (5-10 lines of code)
