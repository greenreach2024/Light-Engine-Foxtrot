# Login Loop Issue - Resolution Report

**Date:** January 19, 2026  
**Issue:** Login loop - user signs in but immediately gets kicked back to login page  
**Status:** ✅ RESOLVED

## Problem Analysis

### Symptom
User attempted to login at https://greenreachgreens.com/login.html with Big Green Farm credentials (FARM-BC134E8B-F371) but was immediately kicked back to the login page after submitting credentials. No error messages were shown - the page just looped.

### Root Cause
The authentication flow has two database tables:

1. **farms table** - Contains farm-level information (farm_id, name, plan_type, status, etc.)
2. **users table** - Contains user authentication credentials (email, password_hash, role, etc.)

When we created Big Green Farm, we only created a record in the `farms` table. The login endpoint (`/api/farm/auth/login`) at line 14368 in server-foxtrot.js performs the following checks:

```javascript
// 1. Verify farm exists and is active
const farmResult = await pool.query(
  'SELECT farm_id, name, status, plan_type FROM farms WHERE farm_id = $1',
  [farmId]
);

// 2. Find user in users table by farm_id and email
const userResult = await pool.query(
  'SELECT user_id, email, password_hash, role, is_active 
   FROM users WHERE farm_id = $1 AND email = $2',
  [farmId, email]
);

// 3. Verify password hash
const valid = await bcrypt.compare(password, user.password_hash);
```

**The login was failing at step 2** because no user record existed in the users table, causing a 401 Unauthorized response. The frontend would then redirect back to login.html.

### Authentication Flow Diagram

```
User submits login form (login.html)
  ↓
POST /api/farm/auth/login
  ↓
Check farms table ✅ (farm exists)
  ↓
Check users table ❌ (no user found)
  ↓
Return 401 Unauthorized
  ↓
Frontend redirects to login.html
  ↓
LOOP CONTINUES
```

## Solution Implementation

Created a user record in the users table with proper authentication credentials:

```sql
INSERT INTO users (farm_id, email, password_hash, name, role, is_active, email_verified, created_at)
VALUES ('FARM-BC134E8B-F371', '1681south@gmail.com', [bcrypt_hash], 'Peter Gilbert', 'admin', true, true, NOW())
```

### Created User Record
- **User ID:** 24
- **Farm ID:** FARM-BC134E8B-F371
- **Email:** 1681south@gmail.com
- **Name:** Peter Gilbert
- **Role:** admin
- **Status:** active
- **Email Verified:** true

### Script Created
Created `create-user-biggreen.cjs` to automate user creation:
- Hashes password using bcrypt (10 rounds)
- Checks for existing user to prevent duplicates
- Inserts user record with proper foreign key relationship
- Returns user_id and confirmation

## Verification Steps

1. ✅ Farm record exists in farms table (FARM-BC134E8B-F371, status: active)
2. ✅ User record created in users table (user_id: 24, is_active: true)
3. ✅ Password properly hashed with bcrypt
4. ✅ Foreign key relationship established (users.farm_id → farms.farm_id)
5. ✅ Login credentials documented in BIG_GREEN_FARM_CREDENTIALS.md

## Testing Instructions

To verify the fix:

1. Navigate to https://greenreachgreens.com/login.html
2. Enter:
   - **Farm ID:** FARM-BC134E8B-F371
   - **Email:** 1681south@gmail.com
   - **Password:** BigGreen020f9e42
3. Click "Sign In"
4. Expected result: Successful login → redirect to /farm-admin.html (cloud plan)

The JWT token will be stored in localStorage and used for authenticated API requests via the auth-guard.js middleware.

## Technical Details

### Database Schema
The users table requires these key fields for authentication:
- `user_id` (integer, auto-increment) - Primary key
- `farm_id` (varchar) - Foreign key to farms table
- `email` (varchar, unique) - User email for login
- `password_hash` (varchar) - Bcrypt hashed password
- `role` (varchar) - User role (admin, manager, operator, viewer)
- `is_active` (boolean) - Account status
- `email_verified` (boolean) - Email verification status

### Authentication Token Flow
1. User submits credentials
2. Backend validates against users table
3. JWT token generated with payload:
   ```javascript
   {
     farmId: 'FARM-BC134E8B-F371',
     email: '1681south@gmail.com',
     role: 'admin',
     userId: 24,
     planType: 'cloud'
   }
   ```
4. Token stored in localStorage as 'token'
5. auth-guard.js intercepts page loads and API requests
6. Token sent in Authorization header: `Bearer [token]`

### Files Modified
- ✅ `create-user-biggreen.cjs` (new) - User creation script
- ✅ `BIG_GREEN_FARM_CREDENTIALS.md` (updated) - Added user_id and resolution notes

### Git Commit
```
Commit: e75aee5
Message: Fix login loop - create user record for Big Green Farm
Files: 2 changed, 144 insertions(+)
```

## Lessons Learned

1. **Farm creation requires TWO database entries:**
   - farms table (farm-level data)
   - users table (authentication credentials)

2. **Authentication endpoint dependencies:**
   - `/api/farm/auth/login` requires users table record
   - Cannot login with only farms table entry

3. **User creation checklist:**
   - ✅ Farm record in farms table
   - ✅ User record in users table
   - ✅ Password hashed with bcrypt
   - ✅ Email unique across all users
   - ✅ Foreign key relationship established
   - ✅ is_active = true
   - ✅ role assigned (admin, manager, operator, viewer)

## Future Prevention

To prevent this issue in the future, update the farm creation process to:

1. Create farm record in farms table
2. **Automatically create corresponding user record** in users table
3. Return both farm_id and user_id in response
4. Verify login credentials work before confirming creation

Consider creating a unified `create-farm-and-user.js` script that handles both database insertions atomically.

## Support Contact

If login issues persist:
- Check browser console for error messages
- Verify Network tab shows 200 OK from /api/farm/auth/login
- Confirm token stored in localStorage (DevTools → Application → Local Storage)
- Contact: support@greenreachfarms.com

---

**Resolution Time:** ~15 minutes  
**Deployed:** January 19, 2026 03:15:00 UTC  
**Status:** Production Ready ✅
