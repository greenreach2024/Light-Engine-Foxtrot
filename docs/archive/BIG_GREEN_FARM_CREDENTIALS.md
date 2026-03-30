# Big Green Farm - Light Engine Credentials

**Created:** January 18, 2026  
**Status:** Active

## Farm Information
- **Farm Name:** Big Green Farm
- **Contact Person:** Peter Gilbert
- **Email:** 1681south@gmail.com
- **Plan Type:** Cloud
- **Location:** United States
- **Farm Size:** Medium

## Login Credentials

### Farm ID (Username)
```
FARM-BC134E8B-F371
```

### Password
```
BigGreen020f9e42
```

## API Access Credentials

### API Key
```
BGF_82b0953de29371ef6e4e44a10fb55a68
```

### API Secret
```
89acc729ba8bfef852f9f68ab311352f2f502ba83eea17394dbc9660c9a73403
```

### JWT Secret
```
070d6af770b80685b695d9c7aaaadc160591795019f0edf0de0b769a4d8f92d8
```

## Access URLs

- **Farm Dashboard:** https://greenreachgreens.com/login.html
- **GreenReach Central Admin:** https://greenreachgreens.com/GR-central-admin-login.html
- **API Endpoint:** https://greenreachgreens.com/api

## How to Login

1. Go to https://greenreachgreens.com/login.html
2. Enter Farm ID: `FARM-BC134E8B-F371`
3. Enter Email: `1681south@gmail.com`
4. Enter Password: `BigGreen020f9e42`
5. Click "Sign In"

## Database Record

- **User ID:** 24
- **Farm ID:** FARM-BC134E8B-F371
- **Status:** active
- **Email Verified:** true
- **Role:** admin

## Login Issue Resolution

✅ **FIXED:** The login loop issue has been resolved!

**Problem:** The farm record existed, but there was no corresponding user record in the users table.

**Solution:** Created user record (user_id: 24) with proper password hash. You can now login successfully.

## Important Notes

- Keep these credentials secure and do not share them
- The password is case-sensitive
- API credentials are used for programmatic access to the Light Engine API
- Contact support@greenreachfarms.com for assistance

---

**Generated:** 2026-01-19 02:28:16 UTC
**User Created:** 2026-01-19 03:15:00 UTC
