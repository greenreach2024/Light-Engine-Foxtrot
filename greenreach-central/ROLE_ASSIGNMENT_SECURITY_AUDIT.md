# GreenReach Central - Role Assignment Security Audit

**Date**: January 30, 2026  
**Status**: ⚠️ **CRITICAL SECURITY GAPS FOUND**

## Executive Summary

Role-based access control (RBAC) is **partially implemented but NOT enforced**. The system has authentication but lacks meaningful authorization. Any authenticated user has full administrative privileges regardless of their assigned role.

---

## Findings

### 1. ✅ Authentication Middleware
**Location**: `middleware/adminAuth.js`  
**Status**: Properly Implemented

- JWT token validation working correctly
- Session management with database validation
- Token expiration (12 hours)
- Fallback mode for non-database environments
- Account lockout after failed attempts

### 2. ⚠️ Role Authorization Middleware  
**Location**: `middleware/adminAuth.js:199-220`  
**Status**: DEFINED BUT NEVER USED

**Critical Issue**: The `requireAdminRole()` function exists but is **never applied** to any routes.

```javascript
export function requireAdminRole(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.admin.role)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        message: `This action requires one of: ${allowedRoles.join(', ')}`
      });
    }
    next();
  };
}
```

### 3. ❌ Admin Routes - NO ROLE RESTRICTIONS
**Location**: `routes/admin.js`  
**Status**: VULNERABLE

All authenticated admins have full access to ALL endpoints:

- ✅ Authentication required via `adminAuthMiddleware` (line 112)
- ❌ **NO role-based restrictions applied**

**Affected Endpoints** (20+ total):
- `DELETE /api/admin/farms/:farmId` - Delete farms (password check only, no role check)
- `PATCH /api/admin/farms/:farmId/config` - Modify farm configurations
- `POST /api/admin/farms/sync-all-stats` - Trigger system operations
- `GET /api/admin/users` - View all admin users and roles
- `GET /api/admin/farms` - List all farms
- `GET /api/admin/kpis` - Access analytics
- `GET /api/admin/alerts` - View system alerts
- `GET /api/admin/energy/dashboard` - View energy data
- `GET /api/admin/fleet/monitoring` - Access fleet monitoring
- All other admin endpoints

### 4. ❌ User Management - NO CRUD ENDPOINTS
**Status**: INCOMPLETE IMPLEMENTATION

- **GET** `/api/admin/users` exists (lists users and roles)
- **POST/PUT/DELETE** user endpoints are **missing**
- Frontend has user creation/edit forms but no backend to support them
- No role validation on any user operations
- Users cannot be created, updated, or deleted via API

### 5. ⚠️ Frontend Role Display Only
**Location**: `public/central-admin.js` and `GR-central-admin.html`  
**Status**: UI-Only Restrictions (Easily Bypassed)

- Viewer role shows educational info cards
- Role badges display correctly in user management table
- **No actual permission enforcement in API calls**
- Frontend restrictions can be bypassed with direct API requests using curl/Postman

---

## Risk Assessment

### 🔴 High Risk Issues

1. **Any authenticated admin can delete farms**
   - Only requires admin password, not specific role
   - No logging of who performed the deletion
   - Irreversible without backups

2. **No viewer/read-only enforcement**
   - Users assigned "viewer" role can modify data via API
   - No prevention of destructive actions

3. **No operations vs admin separation**
   - All authenticated users have identical permissions
   - Cannot delegate farm management without full access

4. **Frontend security theater**
   - Role restrictions only exist in UI, not backend
   - Direct API calls bypass all role checks

### 🟡 Medium Risk Issues

1. **No audit trail for role-based actions**
   - Cannot track who did what based on their role
   - Compliance and accountability issues

2. **User CRUD operations missing**
   - Cannot manage user accounts via API
   - User management is incomplete

3. **No role hierarchy**
   - Cannot implement least-privilege principle
   - All-or-nothing access model

---

## Current Role Definitions

From frontend (`GR-central-admin.html:4553`):

| Role | Description | Intended Permissions |
|------|-------------|---------------------|
| **admin** | Full system access | All operations |
| **operations** | Farm & order management | Farm configs, orders, inventory |
| **support** | Customer assistance | View data, manage orders |
| **viewer** | Read-only access | View only, no modifications |

**⚠️ NONE OF THESE ARE ENFORCED IN THE BACKEND**

---

## Recommended Fixes

### Priority 1 - Critical (Implement Immediately)

1. **Apply role restrictions to destructive operations**:

```javascript
// Import the middleware
import { requireAdminRole } from '../middleware/adminAuth.js';

// Apply to routes
router.delete('/farms/:farmId', 
  requireAdminRole('admin', 'super_admin'), 
  async (req, res) => { /* ... */ }
);

router.patch('/farms/:farmId/config',
  requireAdminRole('admin', 'super_admin', 'operations'),
  async (req, res) => { /* ... */ }
);
```

2. **Restrict write operations**:
   - POST/PUT/PATCH/DELETE: require 'admin' or 'operations'
   - GET endpoints: allow 'viewer', 'support', 'operations', 'admin'

3. **Add user CRUD endpoints with role validation**:
```javascript
router.post('/users', 
  requireAdminRole('admin', 'super_admin'),
  async (req, res) => { /* Create user */ }
);

router.put('/users/:id',
  requireAdminRole('admin', 'super_admin'),
  async (req, res) => { /* Update user */ }
);

router.delete('/users/:id',
  requireAdminRole('admin', 'super_admin'),
  async (req, res) => { /* Delete user */ }
);
```

### Priority 2 - High (This Week)

1. **Implement role hierarchy**:
   ```javascript
   const ROLE_HIERARCHY = {
     'super_admin': 4,
     'admin': 3,
     'operations': 2,
     'support': 1,
     'viewer': 0
   };
   ```

2. **Add permission-based access for wholesale routes**
3. **Implement comprehensive audit logging** for all role-based actions

### Priority 3 - Medium (This Month)

1. **Enhanced security**:
   - MFA requirement for admin/super_admin roles
   - IP whitelist for destructive operations
   - Rate limiting per role

2. **Session management**:
   - Stricter timeout for viewer roles (2 hours vs 12 hours)
   - Force re-authentication for sensitive operations

3. **Admin dashboard improvements**:
   - Show current user's role and permissions
   - Disable UI elements based on role
   - Display permission errors clearly

---

## Testing Recommendations

Before deploying to production:

1. **Create test accounts with each role**:
   - admin@test.com (admin)
   - ops@test.com (operations)
   - support@test.com (support)
   - viewer@test.com (viewer)

2. **Test access controls**:
   ```bash
   # As viewer, attempt to delete a farm (should fail)
   curl -X DELETE https://greenreachgreens.com/api/admin/farms/FARM-TEST \
     -H "Authorization: Bearer <viewer-token>" \
     -H "Content-Type: application/json" \
     -d '{"password":"test"}'
   
   # Should return 403 Forbidden after fixes
   ```

3. **Verify all scenarios**:
   - ❌ Delete farm as viewer → Expect 403
   - ❌ Modify config as support → Expect 403
   - ✅ View farms as operations → Expect 200
   - ✅ Create user as admin → Expect 200
   - ❌ Create user as viewer → Expect 403

---

## Database Schema Notes

The database correctly stores role information:

```sql
-- admin_users table
CREATE TABLE admin_users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'admin',  -- Role is stored
  active BOOLEAN DEFAULT true,
  -- ...
);
```

The role is also correctly included in JWT tokens and request objects (`req.admin.role`). **The infrastructure exists; it's just not being used for authorization.**

---

## Compliance Considerations

**SOC 2 / GDPR / HIPAA Implications**:
- ❌ Principle of least privilege: Not enforced
- ❌ Separation of duties: Not possible
- ❌ Access control audit trail: Incomplete
- ❌ User permission management: Missing

**Current state is NOT production-ready for compliance-sensitive deployments.**

---

## Conclusion

✅ **Authentication**: Working correctly  
❌ **Authorization**: Not implemented  
⚠️ **Result**: Security vulnerability

**Any user who successfully logs in has full admin privileges regardless of their assigned role.**

### Immediate Action Required

1. **Do NOT use role assignments in production** until backend enforcement is implemented
2. Treat all authenticated users as having full admin access
3. Implement Priority 1 fixes before allowing external users
4. Consider temporarily disabling user registration until RBAC is complete

---

## Resources

- Middleware: `greenreach-central/middleware/adminAuth.js`
- Admin Routes: `greenreach-central/routes/admin.js`
- Frontend: `greenreach-central/public/central-admin.js`
- HTML: `greenreach-central/public/GR-central-admin.html`

---

**Report prepared by**: GitHub Copilot  
**Review requested**: Immediate management review required
