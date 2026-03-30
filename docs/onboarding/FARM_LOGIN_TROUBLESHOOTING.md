# Farm Login Troubleshooting Guide

## Error: "No farm Found" or "Farm not found" (404)

This error occurs when trying to log in with a Farm ID that doesn't exist in the production database.

## Solution Steps

### Step 1: Check if the farm and user exist

```bash
node scripts/check-farm-login.js <email>
```

Example:
```bash
node scripts/check-farm-login.js user@example.com
```

This will show:
- If the user exists
- What farm ID(s) they have access to
- The farm status
- Any issues with the account

### Step 2: Check a specific farm ID

```bash
node scripts/check-farm-login.js <email> <farm_id>
```

Example:
```bash
node scripts/check-farm-login.js user@example.com FARM-MK19HC48-2E56
```

This will check if:
- The farm ID exists
- The user has access to that specific farm

### Step 3: Create a new farm account (if needed)

If the user doesn't exist or needs a new farm:

```bash
node scripts/create-farm-account.js <email> <contact_name> <farm_name> [plan_type]
```

Example:
```bash
node scripts/create-farm-account.js user@example.com "John Doe" "John's Farm" cloud
```

This will:
- Create a new farm with a unique Farm ID
- Create an admin user account
- Generate a temporary password
- Display login credentials

## Common Issues

### 1. User exists but farm is missing
- The user record exists but the farm record was deleted
- Solution: Contact admin to restore farm or create a new one

### 2. Farm exists but user doesn't have access
- The farm exists but the email is not associated with it
- Solution: Add user to farm or use correct email

### 3. Farm is inactive
- The farm exists but status is not 'active'
- Solution: Update farm status in database

## Login Process

1. Go to: https://www.greenreachgreens.com/login.html
2. Enter:
   - **Farm ID**: The Farm ID from the scripts above (e.g., FARM-MK19HC48-2E56)
   - **Email**: Your registered email
   - **Password**: Your password (or temporary password from account creation)
3. Click "Sign In"

## For Demo/Testing

To create a demo farm for testing:

```bash
node scripts/create-farm-account.js demo@test.com "Demo User" "Demo Farm" cloud
```

## Database Query (Advanced)

To check directly in database:

```sql
-- Check farms
SELECT farm_id, name, email, status, created_at FROM farms ORDER BY created_at DESC LIMIT 10;

-- Check users
SELECT u.email, u.farm_id, u.role, f.name as farm_name 
FROM users u 
LEFT JOIN farms f ON u.farm_id = f.farm_id 
ORDER BY u.created_at DESC LIMIT 10;

-- Check specific farm
SELECT * FROM farms WHERE farm_id = 'FARM-XXX';

-- Check specific user
SELECT * FROM users WHERE email = 'user@example.com';
```

## Need Help?

Run the check script first to diagnose the issue:
```bash
node scripts/check-farm-login.js <your-email>
```

The output will tell you exactly what's wrong and how to fix it.
