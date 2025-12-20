# GreenReach Admin Navigation Guide

## Cross-Dashboard Navigation Complete ✅

The GreenReach platform now features seamless cross-navigation between administrative dashboards, allowing administrators to easily switch between operational contexts.

---

## Navigation Flow

### From Central Operations Admin → Wholesale Admin

**Location:** [http://localhost:3000/central-admin.html](http://localhost:3000/central-admin.html)

**Navigation Path:**
1. Open Central Admin dashboard
2. Look at the left sidebar
3. Under the **"Wholesale"** section, you'll find:
   - **Admin Dashboard** → Opens Wholesale Admin
   - **Buyer Portal** → Opens Buyer-facing portal

**Visual Design:**
- Dark-themed sidebar navigation
- Links styled as native nav items
- Maintains consistent dark UI theme

---

### From Wholesale Admin → Central Operations Admin

**Location:** [http://localhost:3000/wholesale-admin.html](http://localhost:3000/wholesale-admin.html)

**Navigation Path:**
1. Open Wholesale Admin dashboard
2. Look at the top-right header navigation
3. Click **🏢 Central Operations**
4. Returns you to Central Operations dashboard

**Visual Design:**
- Light green-themed header
- Building emoji (🏢) for visual recognition
- Positioned prominently in header navigation area
- Sits next to "Buyer Portal" link

---

## Dashboard Purposes

### Central Operations Admin
**Focus:** Farm management, monitoring, system operations

**Key Features:**
- Farm status monitoring (online/offline/warning/critical)
- Room and zone environmental controls
- Device management and diagnostics
- Energy consumption tracking
- Alert management
- Anomaly detection
- AI insights and analytics
- Harvest forecasting

**Access:** `http://localhost:3000/central-admin.html`

---

### Wholesale Admin
**Focus:** Commerce operations, order management, compliance

**Key Features:**
- **Overview:** Revenue, order metrics, farm enrollment
- **Farm Management:** Network participation, product catalog
- **Hyperlocal Network:** Geographic distribution, farm status
- **Payment Setup:** Stripe integration, payment methods
- **Payments & Fees:** Transaction history, platform fees
- **Orders:** Order management, tracking, fulfillment
- **Reconciliation:** Payment matching, disputes
- **Compliance Export:** Regulatory audit trails (CSV/JSON)

**Access:** `http://localhost:3000/wholesale-admin.html`

---

### Buyer Portal (Wholesale)
**Focus:** Customer-facing wholesale ordering

**Features:**
- Product browsing with farm details
- Shopping cart with farm grouping
- Order placement and tracking
- Delivery address management (Canadian format)
- Order history with reorder capability
- Invoice downloads
- Shipment tracking with carrier links
- Demo profile auto-login (GreenLeaf Restaurant Group)

**Access:** `http://localhost:3000/wholesale.html`

---

## Complete Browser Address Map

### GreenReach Central (Port 3000)
```
Main Application:
http://localhost:3000/                    → Central hub/homepage
http://localhost:3000/central-admin.html  → Operations admin dashboard

Wholesale Platform:
http://localhost:3000/wholesale-admin.html → Wholesale operations admin
http://localhost:3000/wholesale.html       → Buyer portal (customer-facing)

Farm Management:
http://localhost:3000/farm-admin.html      → Farm dashboard
http://localhost:3000/farm-sales.html      → Farm direct sales

Setup & Tools:
http://localhost:3000/setup-wizard.html    → System setup wizard
http://localhost:3000/sync-monitor.html    → Real-time sync monitoring
```

### Light Engine Foxtrot (Port 8091)
```
Farm Operations:
http://localhost:8091/                     → Farm control interface
http://localhost:8091/setup-wizard.html    → Farm setup wizard
http://localhost:8091/sync-monitor.html    → Sync status monitoring
```

---

## Navigation Implementation Details

### Technical Approach

**Central Admin (central-admin.js):**
- Dynamic sidebar rendering with context awareness
- Support for external links via `external` property
- Links render as `<a>` tags with proper href attributes
- Maintains dark theme styling

```javascript
{
    title: 'Wholesale',
    items: [
        { 
            label: 'Admin Dashboard', 
            view: 'wholesale-admin', 
            external: '/wholesale-admin.html' 
        },
        { 
            label: 'Buyer Portal', 
            view: 'wholesale-buyer', 
            external: '/wholesale.html' 
        }
    ]
}
```

**Wholesale Admin (wholesale-admin.html):**
- Static header navigation with direct links
- Building emoji for visual recognition
- Light green theme consistency
- Positioned in header-nav flex container

```html
<div class="header-nav">
  <a href="/central-admin.html" title="Central Operations Dashboard">
    🏢 Central Operations
  </a>
  <a href="/wholesale.html">Buyer Portal</a>
</div>
```

---

## User Experience Benefits

1. **Context Switching:** Move seamlessly between operational and commercial contexts
2. **Workflow Integration:** No need to bookmark multiple URLs
3. **Unified Admin Experience:** All administrative functions accessible from any dashboard
4. **Visual Clarity:** Different styling indicates dashboard context (dark vs light theme)
5. **Quick Access:** One-click navigation between related functions

---

## Testing Cross-Navigation

### Test 1: Central → Wholesale
1. Navigate to `http://localhost:3000/central-admin.html`
2. Check left sidebar for "Wholesale" section
3. Click "Admin Dashboard"
4. Verify you land on `http://localhost:3000/wholesale-admin.html`

### Test 2: Wholesale → Central
1. Navigate to `http://localhost:3000/wholesale-admin.html`
2. Check top-right header for navigation links
3. Click "🏢 Central Operations"
4. Verify you land on `http://localhost:3000/central-admin.html`

### Test 3: Full Navigation Loop
1. Start at Central Admin
2. Navigate to Wholesale Admin (sidebar link)
3. Navigate to Buyer Portal (header link)
4. Return to Wholesale Admin (browser back)
5. Return to Central Admin (header link)
6. Verify all transitions work smoothly

---

## Deployment Considerations

### Production URLs
When deploying to production, update the following:

**Central Admin Links:**
```javascript
external: 'https://yourdomain.com/wholesale-admin.html'
external: 'https://yourdomain.com/wholesale.html'
```

**Wholesale Admin Links:**
```html
<a href="https://yourdomain.com/central-admin.html">
```

### Security
- Ensure proper authentication on all admin dashboards
- Consider role-based access (some users may only need wholesale access)
- Add session persistence across dashboard transitions
- Implement audit logging for dashboard access

### Performance
- All dashboards load independently (no shared state issues)
- Each dashboard maintains its own data loading
- Cross-navigation triggers full page reload (intentional for clean state)

---

## Related Documentation

- [WHOLESALE_COMPLETE.md](./WHOLESALE_COMPLETE.md) - Wholesale platform feature documentation
- [WHOLESALE_INTEGRATION.md](./WHOLESALE_INTEGRATION.md) - Integration architecture
- [DEPLOYMENT_COMPLETE.md](./DEPLOYMENT_COMPLETE.md) - Deployment instructions

---

**Status:** ✅ Complete and Committed (Commit: ae002c1)
**Last Updated:** 2024 (Cross-Navigation Implementation)
**Platform Version:** Light Engine Foxtrot with GreenReach Central
