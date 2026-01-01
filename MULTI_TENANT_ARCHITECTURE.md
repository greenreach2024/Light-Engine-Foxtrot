# Multi-Tenant Farm Store Architecture

**Status:** Designed and Ready for Implementation  
**Date:** January 1, 2026

---

## Problem Statement

Currently, all farms access the same URL:
- `greenreachgreens.com/farm-sales-shop.html`
- No way for customers to distinguish which farm they're buying from
- Risk of purchases going to wrong farm
- Poor branding for individual farms

---

## Solution: Subdomain-Based Multi-Tenancy

Each farm gets a unique subdomain based on their farm name:

| Farm Name | Farm Slug | Store URL |
|-----------|-----------|-----------|
| Sunrise Acres | `sunrise-acres` | `sunrise-acres.greenreachgreens.com` |
| Green Valley Farm | `green-valley-farm` | `green-valley-farm.greenreachgreens.com` |
| Urban Harvest Co | `urban-harvest-co` | `urban-harvest-co.greenreachgreens.com` |

---

## Architecture Components

### 1. Database Schema

**farms table** includes:
```sql
CREATE TABLE farms (
  farm_id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  farm_slug VARCHAR(100) UNIQUE,  -- NEW: URL-safe slug
  email VARCHAR(255) NOT NULL,
  ...
);
```

**Slug Generation:**
- Auto-generated from farm name during setup
- URL-safe: lowercase, alphanumeric, hyphens
- Unique: adds numbers if needed (e.g., `farm-name-2`)

### 2. DNS Configuration

**Wildcard Subdomain** in Route 53:
```
*.greenreachgreens.com → Elastic Beanstalk environment
```

This allows ANY subdomain to reach your application:
- `sunrise-acres.greenreachgreens.com` ✅
- `green-valley.greenreachgreens.com` ✅
- `any-farm-name.greenreachgreens.com` ✅

### 3. Server-Side Routing

**Middleware** (already exists in `server/middleware/multi-tenant.js`):

```javascript
// Extract farm slug from subdomain
function extractTenantId(req) {
  const host = req.hostname; // e.g., "sunrise-acres.greenreachgreens.com"
  const subdomain = host.split('.')[0]; // "sunrise-acres"
  return subdomain;
}

// Attach to every request
app.use(tenantMiddleware);

// All API calls automatically scoped to farm
req.tenant = { slug: 'sunrise-acres', farmId: 'FARM-001' };
```

### 4. Frontend Detection

**Update farm-sales-shop.html:**

```javascript
// Automatically detect farm from URL
async function initializeFarm() {
  // Server will detect subdomain and return correct farm
  const response = await fetch('/api/config/app');
  const config = await response.json();
  
  // config.farmSlug = "sunrise-acres" (from subdomain)
  // config.farmName = "Sunrise Acres"
  // config.farmId = "FARM-001"
  
  selectedFarm = config.farmId;
  document.getElementById('farm-name').textContent = config.farmName;
  loadInventory(); // Loads ONLY this farm's products
}
```

---

## Implementation Steps

### Step 1: Database Migration ✅

```bash
# Apply migration to add farm_slug column
psql -h <host> -U <user> -d light_engine_db -f migrations/add_farm_slug.sql
```

### Step 2: Configure Wildcard DNS

**In AWS Route 53:**

1. Go to Hosted Zone: `greenreachgreens.com`
2. Create A Record:
   - **Name:** `*.greenreachgreens.com`
   - **Type:** A - IPv4 address
   - **Alias:** Yes
   - **Target:** Elastic Beanstalk environment
   - **ARN:** (select your environment)

3. Create AAAA Record (IPv6):
   - Same as above but type AAAA

### Step 3: Update SSL Certificate

**In AWS Certificate Manager:**

1. Request new certificate or modify existing
2. Add domain: `*.greenreachgreens.com` (wildcard)
3. Validation: Add CNAME records to Route 53
4. Wait for validation (5-30 minutes)
5. Attach certificate to Elastic Beanstalk load balancer

### Step 4: Enable Multi-Tenant Middleware

**In server-foxtrot.js:**

```javascript
import { tenantMiddleware, validateTenant } from './server/middleware/multi-tenant.js';

// Add before routes
app.use(tenantMiddleware);

// Protected routes require valid tenant
app.use('/api/farm-sales/*', validateTenant);
```

### Step 5: Update Farm Registration

**When creating new farm:**

```javascript
import { generateUniqueSlug } from './lib/slug-generator.js';

// Generate slug from farm name
const farmSlug = await generateUniqueSlug(pool, farmName);

// Insert with slug
await pool.query(
  `INSERT INTO farms (farm_id, name, farm_slug, email, ...)
   VALUES ($1, $2, $3, $4, ...)`,
  [farmId, farmName, farmSlug, email, ...]
);

// Return store URL to user
return {
  farmId,
  farmName,
  farmSlug,
  storeUrl: `https://${farmSlug}.greenreachgreens.com`
};
```

### Step 6: Update API Config Endpoint

**routes/config.js:**

```javascript
app.get('/api/config/app', (req, res) => {
  const farmSlug = req.tenant.subdomain; // From middleware
  
  // Look up farm by slug
  const farm = await pool.query(
    'SELECT farm_id, name, farm_slug FROM farms WHERE farm_slug = $1',
    [farmSlug]
  );
  
  res.json({
    farmId: farm.rows[0].farm_id,
    farmName: farm.rows[0].name,
    farmSlug: farm.rows[0].farm_slug,
    storeUrl: `https://${farm.rows[0].farm_slug}.greenreachgreens.com`
  });
});
```

---

## Testing

### Local Development

Use `X-Tenant-Id` header:

```bash
# Test as "sunrise-acres" farm
curl -H "X-Tenant-Id: sunrise-acres" http://localhost:8080/api/config/app

# Test as "green-valley-farm"
curl -H "X-Tenant-Id: green-valley-farm" http://localhost:8080/api/farm-sales/inventory
```

### Production Testing

```bash
# Test different subdomains
curl https://sunrise-acres.greenreachgreens.com/api/config/app
curl https://green-valley-farm.greenreachgreens.com/api/config/app

# Should return different farm data
```

---

## Security Considerations

### 1. Tenant Isolation

✅ **Database Level:**
- All queries filtered by `farm_id` or `tenant_id`
- Middleware prevents cross-tenant data access

✅ **API Level:**
- Authentication tokens scoped to specific farm
- API keys unique per farm

### 2. Subdomain Hijacking Prevention

- Only registered slugs work (checked in `validateTenant`)
- Invalid subdomains return 404
- Suspended farms return 403

### 3. Slug Reservation

- Prevent common/reserved slugs: `www`, `api`, `admin`, `mail`, etc.
- Validate slug format: `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`

---

## User Experience

### Farm Owner:
1. Creates farm: "Sunrise Acres"
2. System generates slug: `sunrise-acres`
3. Receives unique store URL: `https://sunrise-acres.greenreachgreens.com`
4. Shares URL with customers
5. URL shows in all emails, receipts, marketing

### Customer:
1. Visits: `https://sunrise-acres.greenreachgreens.com`
2. Sees "Sunrise Acres" branding
3. Shops products from ONLY Sunrise Acres
4. No confusion about which farm

---

## Migration Path

### For Existing Farms:

```bash
# Generate slugs for all farms
UPDATE farms 
SET farm_slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))
WHERE farm_slug IS NULL;

# Check for duplicates
SELECT farm_slug, COUNT(*) 
FROM farms 
GROUP BY farm_slug 
HAVING COUNT(*) > 1;

# Manually resolve duplicates (add numbers)
```

### Communication to Farms:

> **Important Update: Your Farm Now Has a Dedicated URL!**
> 
> Your farm store is now accessible at:
> **https://sunrise-acres.greenreachgreens.com**
> 
> Share this URL with your customers for easy access to your products.
> The old URL will redirect automatically.

---

## Benefits

✅ **For Farms:**
- Professional, branded URL
- Easier marketing (memorable address)
- Clear identity separation
- SEO benefits (indexed separately)

✅ **For Customers:**
- Know exactly which farm they're buying from
- Bookmark their favorite farm
- Share specific farm links

✅ **For System:**
- Proper multi-tenancy
- Scalable to 1000s of farms
- No URL conflicts
- Better analytics per farm

---

## Alternative: Custom Domains (Phase 2)

Allow farms to use their own domains:

```
Farm brings: www.sunriseacresfarm.com
Points CNAME to: sunrise-acres.greenreachgreens.com
System detects custom domain and shows their branding
```

This requires:
- DNS verification
- SSL certificate per domain
- Domain ownership validation

---

## Files Modified

- ✅ `lib/database.js` - Added farm_slug to schema
- ✅ `lib/slug-generator.js` - Slug generation utilities
- ✅ `migrations/add_farm_slug.sql` - Database migration
- ⏳ `server-foxtrot.js` - Enable middleware (TODO)
- ⏳ `routes/config.js` - Slug-based farm lookup (TODO)
- ⏳ `public/farm-sales-shop.html` - Remove farm selector (DONE)

---

## Next Actions

1. **Configure DNS wildcard** in Route 53
2. **Update SSL certificate** for `*.greenreachgreens.com`
3. **Enable middleware** in server-foxtrot.js
4. **Update /api/config/app** to use subdomain
5. **Test with multiple subdomains**
6. **Generate slugs for existing farm** (FARM-MJUE2BUO-1CBE)

---

## Questions?

Contact: info@greenreachfarms.com
