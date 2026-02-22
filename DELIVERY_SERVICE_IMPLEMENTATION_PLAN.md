# Delivery Service Implementation Plan

**Version**: 1.0.0  
**Date**: February 22, 2026  
**Review Agent**: Implementation Proposal  
**Status**: Pending Architecture Agent Approval

---

## Executive Summary

This plan introduces a **Delivery Service Introduction Banner** and **delivery management capabilities** across four system touchpoints:
1. **Wholesale Portal** (buyer-facing) — GreenReach Central
2. **Light Engine** (farm-side) — Foxtrot
3. **GreenReach Central Admin** — Network coordination
4. **Marketing Pages** — Service announcement

### Current State Analysis

| Component | Existing Code | Status |
|-----------|--------------|--------|
| Backend delivery routes | `routes/farm-sales/delivery.js` (480 lines) | ✅ Complete |
| Delivery windows/zones | TIME_WINDOWS, DELIVERY_ZONES objects | ✅ Complete |
| Wholesale checkout form | `GR-wholesale.html` delivery address fields | ✅ Partial |
| Farm Sales D2C delivery | `farm-sales-shop.html` delivery fields | ✅ Complete |
| Farm POS deliveries tab | `farm-sales-pos.html` delivery tab | ✅ Stub only |
| Marketing announcement | None | ❌ Missing |
| Central delivery coordination | None | ❌ Missing |
| Delivery driver/tracking UI | None | ❌ Missing |
| Network-wide delivery zones | None | ❌ Missing |

---

## Scope Definition

### In Scope (Phase 1 — Announcement + Foundation)

1. **Service Introduction Banner** — Dismissible banner on key pages
2. **Delivery Zone Configuration** — Farm-level zone/fee setup
3. **Buyer delivery method selection** — Enhanced wholesale checkout
4. **Delivery schedule visibility** — Farm admin calendar view
5. **Marketing page updates** — Announce delivery service

### Out of Scope (Phase 2+)

- Real-time driver tracking
- Route optimization algorithms
- Third-party logistics integration (Uber Eats, DoorDash)
- Autonomous delivery scheduling

---

## Implementation Plan

### Phase 1: Service Introduction Banner (Effort: S) — 2 days

**Objective**: Add dismissible announcement banner across all delivery-enabled pages.

#### 1.1 Create Reusable Banner Component

**File**: `greenreach-central/public/js/components/service-intro-banner.js`

```javascript
// Service Introduction Banner Component
class ServiceIntroBanner {
  constructor(options) {
    this.serviceId = options.serviceId;
    this.title = options.title;
    this.description = options.description;
    this.ctaText = options.ctaText || 'Learn More';
    this.ctaUrl = options.ctaUrl;
    this.dismissKey = `dismissed_banner_${this.serviceId}`;
  }

  render() {
    if (localStorage.getItem(this.dismissKey)) return '';
    return `
      <div class="service-intro-banner" id="banner-${this.serviceId}">
        <div class="banner-content">
          <div class="banner-icon">🚚</div>
          <div class="banner-text">
            <h3>${this.title}</h3>
            <p>${this.description}</p>
          </div>
          <a href="${this.ctaUrl}" class="banner-cta">${this.ctaText}</a>
          <button class="banner-dismiss" onclick="ServiceIntroBanner.dismiss('${this.serviceId}')">&times;</button>
        </div>
      </div>
    `;
  }

  static dismiss(serviceId) {
    localStorage.setItem(`dismissed_banner_${serviceId}`, Date.now());
    document.getElementById(`banner-${serviceId}`)?.remove();
  }
}
```

#### 1.2 Banner CSS (shared stylesheet)

**File**: `greenreach-central/public/css/service-intro-banner.css`

```css
.service-intro-banner {
  background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%);
  color: white;
  padding: 16px 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.banner-content {
  display: flex;
  align-items: center;
  gap: 16px;
  max-width: 1200px;
}

.banner-icon { font-size: 2rem; }
.banner-text h3 { font-size: 1.1rem; margin: 0; }
.banner-text p { font-size: 0.9rem; margin: 0; opacity: 0.9; }

.banner-cta {
  background: white;
  color: #16a34a;
  padding: 8px 20px;
  border-radius: 6px;
  text-decoration: none;
  font-weight: 600;
  white-space: nowrap;
}

.banner-dismiss {
  background: none;
  border: none;
  color: white;
  font-size: 1.5rem;
  cursor: pointer;
  opacity: 0.7;
  position: absolute;
  right: 16px;
}
```

#### 1.3 Banner Placement (7 pages)

| Page | Path | Banner Priority |
|------|------|-----------------|
| Wholesale Portal | `GR-wholesale.html` | HIGH |
| Light Engine Admin | `LE-farm-admin.html` | HIGH |
| Farm Sales Landing | `farm-sales-landing.html` | HIGH |
| Farm Sales Shop | `farm-sales-shop.html` | MEDIUM |
| Wholesale About | `wholesale-about.html` | MEDIUM |
| Wholesale Learn More | `wholesale-learn-more.html` | MEDIUM |
| GR Central Admin | `GR-central-admin.html` | LOW |

**Insert location**: After `<body>` tag, before main content.

```html
<!-- Service Introduction Banner -->
<script src="/js/components/service-intro-banner.js"></script>
<link rel="stylesheet" href="/css/service-intro-banner.css">
<script>
  const deliveryBanner = new ServiceIntroBanner({
    serviceId: 'delivery-service-2026',
    title: 'New: Farm-to-Door Delivery',
    description: 'Fresh, locally-grown produce delivered directly to your business or home.',
    ctaText: 'Set Up Delivery →',
    ctaUrl: '/views/delivery-setup.html'
  });
  document.body.insertAdjacentHTML('afterbegin', deliveryBanner.render());
</script>
```

---

### Phase 2: Delivery Zone Configuration (Effort: M) — 3-5 days

**Objective**: Allow farms to configure their delivery zones, fees, and service areas.

#### 2.1 Farm-Side: Delivery Settings Page

**File**: `greenreach-central/public/views/delivery-setup.html`

UI Components:
- Zone polygon drawing (Google Maps/Leaflet)
- Zone fee configuration
- Minimum order per zone
- Time window configuration
- Delivery days selection (Mon-Sat)
- Blackout dates calendar

#### 2.2 Database Schema Extension

**File**: `greenreach-central/config/database.js` — Add to `ensureTablesExist()`

```sql
CREATE TABLE IF NOT EXISTS farm_delivery_zones (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255) NOT NULL REFERENCES farms(farm_id),
  zone_name VARCHAR(100) NOT NULL,
  zone_polygon JSONB,               -- GeoJSON polygon
  delivery_fee DECIMAL(10,2) DEFAULT 0,
  min_order DECIMAL(10,2) DEFAULT 0,
  max_daily_deliveries INT DEFAULT 20,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS farm_delivery_windows (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255) NOT NULL REFERENCES farms(farm_id),
  window_name VARCHAR(100) NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  days_of_week INT[] DEFAULT '{1,2,3,4,5}',  -- 1=Mon, 7=Sun
  active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS farm_delivery_blackouts (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255) NOT NULL REFERENCES farms(farm_id),
  blackout_date DATE NOT NULL,
  reason VARCHAR(255)
);
```

#### 2.3 API Endpoints

**File**: `routes/farm-sales/delivery.js` — Extend existing

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/farm-sales/delivery/zones` | List farm's delivery zones |
| POST | `/api/farm-sales/delivery/zones` | Create delivery zone |
| PATCH | `/api/farm-sales/delivery/zones/:id` | Update zone |
| DELETE | `/api/farm-sales/delivery/zones/:id` | Deactivate zone |
| GET | `/api/farm-sales/delivery/settings` | Get farm delivery config |
| POST | `/api/farm-sales/delivery/settings` | Update farm delivery config |

---

### Phase 3: Buyer Delivery Experience (Effort: M) — 3-5 days

**Objective**: Enhanced delivery selection in wholesale checkout.

#### 3.1 Wholesale Checkout Enhancement

**File**: `greenreach-central/public/GR-wholesale.html`

Replace static delivery fields with dynamic zone-based UI:

```html
<div class="delivery-method-selector">
  <h3>Fulfillment Method</h3>
  <div class="method-options">
    <label class="method-option" data-method="pickup">
      <input type="radio" name="fulfillment" value="pickup">
      <div class="option-content">
        <div class="option-icon">🏪</div>
        <div class="option-text">
          <strong>Farm Pickup</strong>
          <span>Pick up at farm location</span>
        </div>
        <div class="option-price">Free</div>
      </div>
    </label>
    
    <label class="method-option" data-method="delivery">
      <input type="radio" name="fulfillment" value="delivery">
      <div class="option-content">
        <div class="option-icon">🚚</div>
        <div class="option-text">
          <strong>Farm Delivery</strong>
          <span>Delivered to your location</span>
        </div>
        <div class="option-price" id="delivery-fee">$5.00</div>
      </div>
    </label>
  </div>
</div>

<div id="delivery-details" class="hidden">
  <div class="address-autocomplete">
    <input type="text" id="delivery-address-search" 
           placeholder="Start typing your address...">
    <div id="address-suggestions"></div>
  </div>
  
  <div id="zone-result">
    <!-- Dynamically populated based on address -->
  </div>
  
  <div class="time-slot-picker">
    <label>Preferred Delivery Window</label>
    <div id="time-slots" class="time-slot-grid">
      <!-- Populated via API -->
    </div>
  </div>
</div>
```

#### 3.2 Address-to-Zone API

**File**: `routes/farm-sales/delivery.js`

```javascript
/**
 * POST /api/farm-sales/delivery/check-zone
 * Check if address is in delivery zone and return fee
 */
router.post('/check-zone', async (req, res) => {
  const { farm_id, latitude, longitude } = req.body;
  
  // Query farm's delivery zones
  const zones = await pool.query(`
    SELECT zone_name, delivery_fee, min_order, max_daily_deliveries
    FROM farm_delivery_zones
    WHERE farm_id = $1 AND active = true
      AND ST_Contains(zone_polygon::geometry, ST_Point($2, $3))
    ORDER BY delivery_fee ASC
    LIMIT 1
  `, [farm_id, longitude, latitude]);
  
  if (zones.rows.length === 0) {
    return res.json({ 
      ok: false, 
      in_zone: false,
      message: 'This address is outside our delivery area'
    });
  }
  
  res.json({
    ok: true,
    in_zone: true,
    zone: zones.rows[0]
  });
});
```

---

### Phase 4: Farm Admin Delivery Dashboard (Effort: L) — 5-7 days

**Objective**: Delivery schedule management for farm operators.

#### 4.1 Delivery Calendar View

**File**: `greenreach-central/public/views/delivery-calendar.html`

Features:
- Weekly/monthly view of scheduled deliveries
- Delivery status tracking (scheduled → en route → delivered)
- Route planning integration (Google Maps directions)
- Driver assignment (if multiple drivers)
- Delivery manifest generation
- Print delivery labels

#### 4.2 Delivery Management API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/farm-sales/delivery/schedule` | Get deliveries for date range |
| GET | `/api/farm-sales/delivery/manifest/:date` | Generate printable manifest |
| PATCH | `/api/farm-sales/delivery/:id/status` | Update delivery status |
| POST | `/api/farm-sales/delivery/:id/assign-driver` | Assign driver |

#### 4.3 Light Engine Admin Integration

**File**: `greenreach-central/public/LE-farm-admin.html`

Add "Deliveries" card to Quick Actions section:

```html
<a href="#iframe-view" class="action-card" 
   data-section="iframe-view" 
   data-url="/views/delivery-calendar.html"
   data-help-title="Delivery Schedule"
   data-help="View and manage scheduled deliveries. Print manifests, update status, and plan routes.">
  <div class="action-icon">🚚</div>
  <div class="action-title">Deliveries</div>
  <div class="action-subtitle" id="delivery-count-badge">12 today</div>
</a>
```

---

### Phase 5: Central Network Coordination (Effort: L) — 5-7 days

**Objective**: GreenReach Central visibility into network-wide delivery operations.

#### 5.1 Central Admin Delivery View

**File**: `greenreach-central/public/GR-central-admin.html`

Add "Network Deliveries" section:
- Cross-farm delivery heatmap
- Network-wide delivery statistics
- Zone coverage gaps analysis
- Delivery SLA monitoring

#### 5.2 Network Delivery API

**File**: `greenreach-central/routes/network-delivery.js`

```javascript
/**
 * GET /api/network/delivery/coverage
 * Returns network-wide delivery zone coverage
 */
router.get('/delivery/coverage', async (req, res) => {
  const coverage = await pool.query(`
    SELECT 
      f.name as farm_name,
      f.farm_id,
      COUNT(dz.id) as zone_count,
      SUM(CASE WHEN dz.active THEN 1 ELSE 0 END) as active_zones
    FROM farms f
    LEFT JOIN farm_delivery_zones dz ON f.farm_id = dz.farm_id
    WHERE f.status = 'active'
    GROUP BY f.farm_id, f.name
  `);
  
  res.json({ success: true, coverage: coverage.rows });
});

/**
 * GET /api/network/delivery/stats
 * Network delivery statistics
 */
router.get('/delivery/stats', async (req, res) => {
  const stats = await pool.query(`
    SELECT 
      COUNT(*) as total_deliveries,
      COUNT(*) FILTER (WHERE status = 'delivered') as completed,
      AVG(EXTRACT(EPOCH FROM (delivered_at - scheduled_at))/3600) as avg_hours
    FROM farm_deliveries
    WHERE created_at > NOW() - INTERVAL '30 days'
  `);
  
  res.json({ success: true, stats: stats.rows[0] });
});
```

---

### Phase 6: Marketing Pages Update (Effort: S) — 1-2 days

**Objective**: Announce delivery service on marketing/landing pages.

#### 6.1 Pages to Update

| Page | Update Type |
|------|-------------|
| `wholesale-about.html` | Add "Delivery Service" section |
| `wholesale-learn-more.html` | Add delivery benefits |
| `farm-sales-landing.html` | Enhance delivery messaging |
| `about.html` | Add delivery mention |
| `landing-main.html` | Add delivery CTA |

#### 6.2 Content Template

```html
<!-- Delivery Service Section -->
<section class="delivery-service" id="delivery">
  <div class="container">
    <h2>Farm-to-Door Delivery</h2>
    <p class="subtitle">Fresh produce delivered directly to your business or home</p>
    
    <div class="features">
      <div class="feature">
        <div class="icon">🌱</div>
        <h3>Same-Day Harvest</h3>
        <p>Harvested the morning of your delivery for maximum freshness</p>
      </div>
      
      <div class="feature">
        <div class="icon">📍</div>
        <h3>Local Coverage</h3>
        <p>Serving Kingston and surrounding areas within 50km</p>
      </div>
      
      <div class="feature">
        <div class="icon">📅</div>
        <h3>Flexible Scheduling</h3>
        <p>Choose your preferred delivery window, Monday through Saturday</p>
      </div>
      
      <div class="feature">
        <div class="icon">♻️</div>
        <h3>Sustainable</h3>
        <p>Reduced food miles and returnable packaging options</p>
      </div>
    </div>
    
    <a href="/GR-wholesale.html?tab=delivery" class="cta-button">
      Set Up Delivery &rarr;
    </a>
  </div>
</section>
```

---

## Implementation Timeline

| Phase | Description | Effort | Dependencies | Sprint |
|-------|-------------|--------|--------------|--------|
| 1 | Service Introduction Banner | S (2d) | None | 1 |
| 2 | Delivery Zone Configuration | M (5d) | Phase 1 | 1-2 |
| 3 | Buyer Delivery Experience | M (5d) | Phase 2 | 2 |
| 4 | Farm Admin Delivery Dashboard | L (7d) | Phase 2 | 2-3 |
| 5 | Central Network Coordination | L (7d) | Phase 4 | 3 |
| 6 | Marketing Pages Update | S (2d) | Phase 1 | 1 |

**Total Estimated Effort**: ~28 days (4 weeks)

---

## Files to Create/Modify

### New Files (Create)

| File | Purpose |
|------|---------|
| `greenreach-central/public/js/components/service-intro-banner.js` | Reusable banner component |
| `greenreach-central/public/css/service-intro-banner.css` | Banner styles |
| `greenreach-central/public/views/delivery-setup.html` | Farm delivery config UI |
| `greenreach-central/public/views/delivery-calendar.html` | Farm delivery schedule |
| `greenreach-central/routes/network-delivery.js` | Central delivery APIs |

### Existing Files to Modify

| File | Changes |
|------|---------|
| `GR-wholesale.html` | Add banner, enhance delivery checkout |
| `LE-farm-admin.html` | Add banner, add Deliveries card |
| `farm-sales-landing.html` | Add banner, expand delivery content |
| `farm-sales-shop.html` | Add banner |
| `wholesale-about.html` | Add delivery section |
| `wholesale-learn-more.html` | Add delivery benefits |
| `GR-central-admin.html` | Add banner, add Network Deliveries section |
| `routes/farm-sales/delivery.js` | Add zone management endpoints |
| `greenreach-central/config/database.js` | Add delivery tables |
| `greenreach-central/server.js` | Mount network-delivery router |

---

## Review Agent Assessment

### Compliance with Agent Skills Framework

| Rule | Status | Notes |
|------|--------|-------|
| Rule 1.5: Central Is Mother Ship | ✅ | Phase 5 includes Central coordination |
| Rule 2.1: Dual-Track Implementation | ✅ | Farm + Central tasks in parallel |
| Rule 2.2: Use Existing Pipes | ✅ | Uses existing sync infrastructure |
| Rule 5.1: Reduce Grower Steps | ✅ | Zone auto-detection reduces buyer input |
| Rule 9.2: Persist, Don't Discard | ✅ | PostgreSQL tables for delivery data |

### Compliance with AI Vision Rules

This feature does NOT touch AI/ML systems directly. However:

- **Feedback Loop 5 (Demand → Production)**: Delivery data can inform demand signals
- **Future Phase**: Delivery patterns can feed into crop timing recommendations

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Google Maps API costs | Medium | Use free tier initially, budget for scale |
| Zone polygon complexity | Low | Start with simple radius-based zones |
| Multi-farm route overlap | Low | Phase 2 — network coordination |
| Driver no-show | Medium | SMS/push notification system |

### Deployment Strategy

1. **Phase 1 (Banner)**: Deploy immediately — no database changes
2. **Phase 2-4**: Staged rollout to Notable Sprout first
3. **Phase 5-6**: Full network rollout after validation

---

## Approval Request

**Review Agent Assessment**: ✅ APPROVED for Architecture Agent Review

**Conditions for Implementation Agent**:
1. Phase 1 (Banner) may proceed immediately
2. Phase 2+ requires database migration plan
3. All new routes must include farm authentication middleware
4. Zone polygon data must use PostGIS for efficient geo queries
5. Test with 3 delivery zones before production

---

**Next Step**: Request Architecture Agent strategic review before implementation begins.
