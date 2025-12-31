# Admin Authentication - Quick Deployment Guide

## Prerequisites
- PostgreSQL database running (Supabase or self-hosted)
- Node.js 20+ installed
- Database connection string available

## Step 1: Run Database Migration (2 minutes)

```bash
# Set your database URL
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"

# Run migration
psql $DATABASE_URL -f migrations/003_create_admin_tables.sql

# Verify tables created
psql $DATABASE_URL -c "\dt admin_*"
```

Expected output:
```
         List of relations
 Schema |      Name       | Type  | Owner
--------+-----------------+-------+-------
 public | admin_audit_log | table | ...
 public | admin_sessions  | table | ...
 public | admin_users     | table | ...
(3 rows)
```

## Step 2: Set Admin JWT Secret (1 minute)

```bash
# Generate secure random secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Add to .env file
echo "ADMIN_JWT_SECRET=<generated-secret>" >> .env

# Or set in production environment variables
export ADMIN_JWT_SECRET=<generated-secret>
```

## Step 3: Install Dependencies (if needed) (1 minute)

```bash
npm install bcrypt jsonwebtoken uuid
```

## Step 4: Create First Admin User (1 minute)

```bash
node scripts/create-admin-user.js
```

Interactive prompts:
```
Email address: admin@yourcompany.com
Full name: System Administrator
Password: <strong-password>
Confirm password: <strong-password>
```

Success message:
```
✅ Admin user created successfully!

Details:
  User ID:   abc123...
  Email:     admin@yourcompany.com
  Name:      System Administrator
  Role:      super_admin

You can now login at:
  http://localhost:8091/GR-central-admin-login.html
```

## Step 5: Start Server (1 minute)

```bash
# Development
npm start

# Or production
NODE_ENV=production PORT=8091 node server-foxtrot.js
```

## Step 6: Test Authentication (2 minutes)

### Test 1: Redirect to Login
1. Open browser: `http://localhost:8091/GR-central-admin.html`
2. Should automatically redirect to: `http://localhost:8091/GR-central-admin-login.html`
3. ✅ PASS if redirected

### Test 2: Invalid Login
1. Enter wrong email or password
2. Should show error: "Invalid email or password"
3. ✅ PASS if error shown

### Test 3: Valid Login
1. Enter correct email and password from Step 4
2. Should show: "Login successful! Redirecting..."
3. Should redirect to dashboard with data
4. ✅ PASS if dashboard loads

### Test 4: Session Persistence
1. Refresh page (F5 or Cmd+R)
2. Should stay logged in (not redirect to login)
3. ✅ PASS if dashboard remains

### Test 5: Logout
1. Find and click logout button (may need to add to UI)
2. Should redirect to login page
3. Try accessing dashboard again - should redirect to login
4. ✅ PASS if logout works

### Test 6: API Protection
```bash
# Test without token (should fail)
curl http://localhost:8091/api/admin/farms
# Expected: {"success":false,"error":"Authentication required"}

# Test with valid token (get from localStorage after login)
TOKEN="<your-jwt-token>"
curl -H "Authorization: Bearer $TOKEN" http://localhost:8091/api/admin/farms
# Expected: {"farms":[...]} (actual data)
```

## Step 7: Deploy to Production (5 minutes)

### Option A: Manual Deployment

```bash
# 1. Commit changes
git add -A
git commit -m "feat: add admin authentication system"

# 2. Push to production branch
git push production main

# 3. SSH to production server
ssh user@your-server.com

# 4. Pull changes
cd /var/www/light-engine-foxtrot
git pull

# 5. Set environment variables (if not already set)
export ADMIN_JWT_SECRET=<production-secret>
export DATABASE_URL=<production-db-url>

# 6. Run migration on production database
psql $DATABASE_URL -f migrations/003_create_admin_tables.sql

# 7. Create production admin user
node scripts/create-admin-user.js

# 8. Restart server
pm2 restart light-engine-foxtrot
# or
systemctl restart light-engine-foxtrot

# 9. Verify
curl https://your-domain.com/api/admin/farms
# Should return authentication error
```

### Option B: AWS Elastic Beanstalk

```bash
# 1. Set environment variables in EB console
# AWS Console > Elastic Beanstalk > Environment > Configuration > Software
# Add: ADMIN_JWT_SECRET=<secret>

# 2. Commit and deploy
git add -A
git commit -m "feat: add admin authentication"
eb deploy

# 3. Run migration (one-time)
# Connect to RDS instance and run:
psql <rds-connection-string> -f migrations/003_create_admin_tables.sql

# 4. Create admin user via SSH
eb ssh
cd /var/app/current
node scripts/create-admin-user.js
exit

# 5. Verify
curl https://your-eb-url.com/api/admin/farms
```

## Troubleshooting

### Problem: "admin_users table does not exist"
**Solution:** Run database migration (Step 1)

### Problem: "Invalid token" on all requests
**Solution:** Check ADMIN_JWT_SECRET is set correctly in environment

### Problem: "Database connection failed"
**Solution:** Verify DATABASE_URL is correct and database is accessible

### Problem: Login succeeds but redirects back to login
**Solution:** Check browser console for errors. Token may not be stored properly.

### Problem: All requests return 401 after some time
**Solution:** Session expired (12 hours). Login again. Consider extending session duration.

### Problem: Cannot create admin user - "bcrypt not found"
**Solution:** Install dependencies: `npm install bcrypt`

## Quick Reference

### Admin Login URL
```
http://localhost:8091/GR-central-admin-login.html
https://your-domain.com/GR-central-admin-login.html
```

### Admin Dashboard URL (Protected)
```
http://localhost:8091/GR-central-admin.html
https://your-domain.com/GR-central-admin.html
```

### Authentication Endpoints
```
POST /api/admin/auth/login     - Login with email/password
GET  /api/admin/auth/verify    - Verify current session
POST /api/admin/auth/logout    - Logout and revoke session
```

### Protected Admin Endpoints (Require Auth)
```
GET    /api/admin/farms               - List all farms
GET    /api/admin/farms/:farmId       - Farm details
GET    /api/admin/farms/db            - Database farm list
DELETE /api/admin/farms/:email        - Delete farm
GET    /api/admin/analytics/aggregate - Platform metrics
```

### Database Tables
```
admin_users      - Admin user accounts
admin_sessions   - Active sessions
admin_audit_log  - Audit trail of admin actions
```

### Environment Variables
```
ADMIN_JWT_SECRET  - JWT signing secret (REQUIRED)
DATABASE_URL      - PostgreSQL connection string
NODE_ENV          - production/development
PORT              - Server port (default: 8091)
```

## Security Checklist

- [ ] Database migration run successfully
- [ ] ADMIN_JWT_SECRET set to secure random string (32+ bytes)
- [ ] First admin user created with strong password
- [ ] Cannot access admin dashboard without login
- [ ] All /api/admin/* endpoints return 401 without token
- [ ] Login with invalid credentials fails
- [ ] Account locks after 5 failed attempts
- [ ] Logout revokes session
- [ ] Session persists across page refreshes
- [ ] Expired sessions redirect to login
- [ ] Audit log records all authentication events

## Next Steps

1. **Add 2FA** - Implement TOTP with speakeasy library
2. **Add Cloudflare Access** - IP-based protection layer
3. **Add password reset** - Email-based password reset flow
4. **Add admin user management** - UI to create/edit/delete admins
5. **Add session management UI** - View and revoke active sessions
6. **Security penetration testing** - Hire security audit or use automated tools

## Support

For issues or questions:
1. Check logs: `tail -f logs/server.log`
2. Check audit log: `psql $DATABASE_URL -c "SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT 10;"`
3. Review implementation: See ADMIN_AUTH_IMPLEMENTATION.md
4. Review readiness report: See CENTRAL_ADMIN_READINESS_REPORT.md

---

**Total deployment time:** ~10 minutes
**Difficulty:** Easy
**Prerequisites:** Database access, Node.js installed
