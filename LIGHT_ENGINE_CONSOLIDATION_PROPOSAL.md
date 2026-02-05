# Light Engine Code Consolidation Proposal

**Date**: February 3, 2026  
**Problem**: Light Engine files duplicated across `public/` and `greenreach-central/public/` with 32 files drifted  
**Goal**: Single Light Engine codebase with two deployment modes (Edge vs Cloud)

---

## Current State (Broken)

```
/
├── public/                           # Edge: 570 files
│   ├── LE-*.html (17 files)         # Light Engine admin
│   ├── views/*.html (12 files)      # Operations (inventory, planning, etc.)
│   ├── data/*.json                  # Farm data
│   └── ... (edge-specific files)
│
├── greenreach-central/
│   ├── public/                      # Cloud: 215 files
│   │   ├── LE-*.html (17 files)    # DUPLICATE - 32 files drifted
│   │   ├── views/*.html (12 files) # DUPLICATE
│   │   └── GR-*.html (10 files)    # GreenReach monitoring (separate)
│   └── server.js (392 lines)
│
└── server-foxtrot.js (24,065 lines)
```

**Issues**:
- 29+ Light Engine files duplicated
- 32 files have drifted between copies
- Manual sync required for every UI change
- No single source of truth

---

## Proposed Solution

### Phase 1: Consolidate Light Engine UI (Week 1)

**Create single source of truth:**

```
/
├── light-engine/                    # NEW: Single LE codebase
│   ├── public/
│   │   ├── LE-*.html               # Farm admin, dashboard, billing
│   │   ├── views/
│   │   │   ├── farm-summary.html
│   │   │   ├── tray-inventory.html
│   │   │   ├── planting-scheduler.html
│   │   │   └── ... (all 12 views)
│   │   ├── styles/
│   │   ├── scripts/
│   │   └── config.js               # NEW: Feature detection
│   │
│   └── server.js                   # Consolidated server
│       └── (merged from server-foxtrot.js logic)
│
├── greenreach-central/             # SEPARATE: Monitoring platform
│   ├── public/
│   │   ├── GR-*.html              # ONLY GR monitoring/wholesale
│   │   └── (symlink → ../light-engine/public for LE access)
│   └── server.js                   # GR-specific routes only
│
└── deployments/
    ├── edge/
    │   ├── .env.edge              # SENSORS=true
    │   └── deploy-edge.sh
    └── cloud/
        ├── .env.cloud             # SENSORS=false
        └── deploy-cloud.sh
```

---

## Implementation Steps

### Step 1: Create Feature Detection System

**File**: `light-engine/public/config.js`

```javascript
// Auto-detect or load from server
// Feature restrictions based on RELIABILITY requirements, not technical capability
window.LE_CONFIG = {
  deployment: 'edge', // or 'cloud'
  features: {
    // Available in both (safe operations, no 24/7 uptime required)
    monitoring: true,           // View sensors, inventory, plans
    inventory: true,
    planning: true,
    forecasting: true,
    activityHub: true,          // Order management, picking, packing
    qualityControl: true,       // QA checkpoints
    trayOperations: true,       // Record harvest, moves, planting
    tabletPairing: true,        // QR code generation
    
    // Edge-only (critical systems requiring 24/7 reliable connection)
    deviceControl: true,        // Lights, pumps, HVAC control
    nutrientControl: true,      // pH/EC dosing, nutrient management
    criticalAlerts: true        // System health monitoring
  }
};

// Server endpoint to provide config
// GET /api/config/features
```

### Step 2: Add Feature Guards to UI

**Example**: `farm-summary.html`

```javascript
async function loadEnvironmentalData() {
  // Sensor monitoring available in both deployments
  const response = await fetch('/env?hours=24');
  if (!response.ok) {
    document.getElementById('envGrid').innerHTML = 
      '<div class="info-notice">Environmental data currently unavailable</div>';
    return;
  }
  // ... render data
}

async function controlDevice(deviceId, action) {
  // Check if device control available (edge only - reliability requirement)
  if (!LE_CONFIG.features.deviceControl) {
    showAlert(
      'Critical controls require dedicated edge device (24/7 uptime)',
      'warning'
   Show all menu items, but indicate restricted features
const menuItems = [
  { id: 'inventory', label: 'Inventory', available: true },
  { id: 'activity-hub', label: 'Activity Hub', available: true },
  { id: 'quality', label: 'Quality Control', available: true },
  { id: 'device-control', label: 'Device Control', 
    available: LE_CONFIG.features.deviceControl,
    restriction: 'Requires 24/7 edge device' },
  { id: 'nutrients', label: 'Nutrient Management', 
    available: LE_CONFIG.features.nutrientControl,
    restriction: 'Requires 24/7 edge device' }
];

menuItems.forEach(item => {
  if (item.available) {
    showMenuItem(item);
  } else {
    showMenuItem(item, { disabled: true, tooltip: item.restriction });
  }
}); 
  // Edge device: execute control
  const response = await fetch(`/api/devices/${deviceId}/control`, {
    method: 'POST',
    body: JSON.stringify({ action })
  });
  // ... handle response
}
```

**Example**: Navigation menu

```javascript
// Only show nutrient management on edge deployments
if (LE_CONFIG.features.nutrientControl) {
  showMenuItem('nutrient-management.html');
}
```

### Step 3: Consolidate Server Logic

**Create**: `light-engine/server.js`

```javascript
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const DEPLOYMENT_MODE = process.env.DEPLOYMENT_MODE || 'edge';
const ENABLE_DEVICE_CONTROL = process.env.ENABLE_DEVICE_CONTROL === 'true';
const ENABLE_NUTRIENT_CONTROL = process.env.ENABLE_NUTRIENT_CONTROL === 'true';

// Feature config endpoint - restrictions based on reliability requirements
app.get('/api/config/features', (req, res) => {
  res.json({
    deployment: DEPLOYMENT_MODE,
    features: {
      // Safe operations - available in both deployments
      monitoring: true,
      inventory: true,
      planning: true,
      forecasting: true,
      activityHub: true,
      qualityControl: true,
      trayOperations: true,
      tabletPairing: true,
      
      // Critical systems - edge only (requires 24/7 reliable connection)
      deviceControl: ENABLE_DEVICE_CONTROL,
      nutrientControl: ENABLE_NUTRIENT_CONTROL,
      criticalAlerts: DEPLOYMENT_MODE === 'edge'
    },
    restrictions: {
      reason: DEPLOYMENT_MODE === 'cloud' 
        ? 'Critical controls require 24/7 reliable connection (use edge device)' 
        : null
    }
  });
});

// Conditional route loading - critical systems only on edge
if (ENABLE_DEVICE_CONTROL) {
  app.post('/api/devices/:id/control', requireEdgeDevice, (req, res) => {
    // Device control endpoint (lights, pumps, HVAC)
  });
}

if (ENABLE_NUTRIENT_CONTROL) {
  app.post('/api/nutrients/dose', requireEdgeDevice, (req, res) => {
    // Nutrient dosing endpoint
  });
}

// Always available routes (safe operations)
app.use('/api/inventory', inventoryRoutes);
app.use('/api/farm', farmRoutes);
app.use('/api/recipes', recipesRoutes);
app.use('/api/activity-hub', activityHubRoutes);  // Order management
app.use('/api/qa', qualityControlRoutes);         // QA checkpoints
app.use('/api/tray-runs', trayOperationsRoutes);  // Harvest, moves
// ... etc

app.listen(PORT);
```

### Step 4: Pre-Migration Analysis

**Create**: `scripts/analyze-file-differences.sh`

```bash
#!/bin/bash
set -e

echo "=== Analyzing Light Engine File Differences ==="
echo ""

REPORT="consolidation-analysis-$(date +%Y%m%d_%H%M%S).md"

cat > "$REPORT" << 'EOF'
# Light Engine File Consolidation Analysis

**Generated**: $(date)

## Files to Merge

### Strategy
- **Edge (public/)** = Source of truth (more complete)
- **Cloud (greenreach-central/public/)** = Check for unique changes before discarding

---

EOF

echo "## 1. Identical Files (Safe to Use Edge Version)" >> "$REPORT"
echo "" >> "$REPORT"

# Compare all LE files
for edge_file in public/LE-*.html public/views/*.html; do
  filename=$(basename "$edge_file")
  cloud_file="greenreach-central/public/$filename"
  
  if [ -f "$cloud_file" ]; then
    if diff -q "$edge_file" "$cloud_file" > /dev/null 2>&1; then
      echo "✓ $filename - identical" >> "$REPORT"
    fi
  fi
done

echo "" >> "$REPORT"
echo "## 2. Files That Differ (NEED REVIEW)" >> "$REPORT"
echo "" >> "$REPORT"

# Find differing files
for edge_file in public/LE-*.html public/views/*.html; do
  filename=$(basename "$edge_file")
  cloud_file="greenreach-central/public/$filename"
  
  if [ -f "$cloud_file" ]; then
    if ! diff -q "$edge_file" "$cloud_file" > /dev/null 2>&1; then
      echo "### $filename" >> "$REPORT"
      echo "" >> "$REPORT"
      echo "**Edge size**: $(wc -l < "$edge_file") lines" >> "$REPORT"
      echo "**Cloud size**: $(wc -l < "$cloud_file") lines" >> "$REPORT"
      echo "" >> "$REPORT"
      
      # Show key differences
      echo "**Key differences**:" >> "$REPORT"
      echo '```diff' >> "$REPORT"
      diff -u "$cloud_file" "$edge_file" | head -50 >> "$REPORT" || true
      echo '```' >> "$REPORT"
      echo "" >> "$REPORT"
    fi
  fi
done

echo "## 3. Edge-Only Files (Will Be Copied)" >> "$REPORT"
echo "" >> "$REPORT"

for edge_file in public/LE-*.html public/views/*.html; do
  filename=$(basename "$edge_file")
  cloud_file="greenreach-central/public/$filename"
  
  if [ ! -f "$cloud_file" ]; then
    echo "- $filename" >> "$REPORT"
  fi
done

echo "" >> "$REPORT"
echo "## 4. Cloud-Only Files (CHECK: Should These Exist?)" >> "$REPORT"
echo "" >> "$REPORT"

for cloud_file in greenreach-central/public/LE-*.html greenreach-central/public/views/*.html; do
  if [ -f "$cloud_file" ]; then
    filename=$(basename "$cloud_file")
    edge_file="public/$filename"
    
    if [ ! -f "$edge_file" ]; then
      echo "- $filename (exists in cloud but not edge)" >> "$REPORT"
    fi
  fi
done

echo "" >> "$REPORT"
echo "## 5. Recommendation" >> "$REPORT"
echo "" >> "$REPORT"
echo "1. **Review all files in section 2** - manually merge any cloud improvements" >> "$REPORT"
echo "2. Use edge version as base for all files" >> "$REPORT"
echo "3. Archive cloud-only files if they contain unique features" >> "$REPORT"

echo "✓ Analysis complete: $REPORT"
echo ""
echo "Review this report before running consolidation script."
```

### Step 5: Migration Script (Uses Edge as Source of Truth)

**Create**: `scripts/consolidate-light-engine.sh`

```bash
#!/bin/bash
set -e

echo "=== Light Engine Consolidation ==="
echo ""
echo "⚠️  This script uses EDGE files as source of truth"
echo ""

# Safety check
if [ ! -f "consolidation-analysis-*.md" ]; then
  echo "ERROR: Run analyze-file-differences.sh first!"
  echo "You must review file differences before consolidating."
  exit 1
fi

read -p "Have you reviewed the analysis report? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
  echo "Aborted. Review the report first."
  exit 1
fi

# Create backup
echo "Creating backup of current state..."
BACKUP_DIR="backups/pre-consolidation-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -r public "$BACKUP_DIR/"
cp -r greenreach-central/public "$BACKUP_DIR/greenreach-central-public"
echo "✓ Backup saved to $BACKUP_DIR"

# 1. Create new structure
echo "Creating light-engine structure..."
mkdir -p light-engine/public
mkdir -p deployments/edge
mkdir -p deployments/cloud

# 2. Copy Light Engine files from EDGE (source of truth)
echo "Copying Light Engine UI from edge (public/)..."

# Copy all LE files
cp public/LE-*.html light-engine/public/ 2>/dev/null || true

# Copy views folder
cp -r public/views light-engine/public/

# Copy shared assets
cp -r public/styles light-engine/public/
cp -r public/scripts light-engine/public/
cp public/auth-guard.js light-engine/public/ 2>/dev/null || true
cp public/farm-admin.js light-engine/public/ 2>/dev/null || true

# Copy data structure (excluding runtime data)
mkdir -p light-engine/public/data
cp public/data/demo-farm-complete.json light-engine/public/data/ 2>/dev/null || true
cp public/data/recipes-*.csv light-engine/public/data/ 2>/dev/null || true

echo "✓ Copied $(find light-engine/public -name '*.html' | wc -l) HTML files"

# 3. Create feature config
echo "Creating feature detection system..."
cat > light-engine/public/config.js << 'EOF'
// Feature detection - loaded from server
(async function() {
  try {
    const response = await fetch('/api/config/features');
    if (!response.ok) {
      console.warn('Feature config unavailable, using defaults');
      window.LE_CONFIG = { deployment: 'edge', features: { sensors: true }};
      return;
    }
    window.LE_CONFIG = await response.json();
    document.dispatchEvent(new CustomEvent('le:config:ready'));
    console.log('[LE Config] Loaded:', window.LE_CONFIG);
  } catch (err) {
    console.error('[LE Config] Failed to load:', err);
    window.LE_CONFIG = { deployment: 'edge', features: { sensors: true }};
  }
})();
EOF

# 4. Create deployment configs
echo "Creating deployment configurations..."
mkdir -p deployments/edge
cat > deployments/edge/.env.edge << 'EOF'
DEPLOYMENT_MODE=edge
HAS_SENSORS=true
HAS_NUTRIENT_CONTROL=true
HAS_DEVICE_CONTROL=true
DATABASE_TYPE=sqlite
PORT=8091
EOF

mkdir -p deployments/cloud
cat > deployments/cloud/.env.cloud << 'EOF'
DEPLOYMENT_MODE=cloud
HAS_SENSORS=false
HAS_NUTRIENT_CONTROL=false
HAS_DEVICE_CONTROL=false
DATABASE_TYPE=postgresql
PORT=3000
EOF

# 5. Archive cloud-specific LE files (for review)
echo "Archiving cloud versions for review..."
ARCHIVE_DIR="backups/cloud-versions-archive-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$ARCHIVE_DIR"
cp greenreach-central/public/LE-*.html "$ARCHIVE_DIR/" 2>/dev/null || true
mkdir -p "$ARCHIVE_DIR/views"
cp greenreach-central/public/views/*.html "$ARCHIVE_DIR/views/" 2>/dev/null || true
echo "✓ Cloud versions archived to $ARCHIVE_DIR"

# 6. Update greenreach-central to only have GR files
echo "Cleaning greenreach-central/public/..."
cd greenreach-central/public
rm -f LE-*.html 2>/dev/null || true
rm -rf views/ 2>/dev/null || true
rm -f farm-admin.js auth-guard.js 2>/dev/null || true
cd ../..

# Keep only GR-*.html files
echo "✓ GreenReach Central now contains only GR-*.html files"
ls -1 greenreach-central/public/GR-*.html | wc -l | xargs echo "  Files remaining:"

# 7. Create symlink for EB deployment access
echo "Creating symlink for deployment..."
cd greenreach-central/public
ln -s ../../light-engine/public light-engine-ui
cd ../..

echo ""
echo "✓ Consolidation complete!"
echo ""
echo "Summary:"
echo "  - Light Engine UI: light-engine/public/"
echo "  - Source: Edge (public/) - more complete version"
echo "  - Backup: $BACKUP_DIR"
echo "  - Cloud archive: $ARCHIVE_DIR"
echo ""
echo "Next steps:"
echo "  1. Review archived cloud files for unique changes"
echo "  2. Test locally: cd light-engine && DEPLOYMENT_MODE=edge npm start"
echo "  3. Deploy to edge: cd deployments/edge && ./deploy-edge.sh"
echo "  4. Deploy to cloud: cd deployments/cloud && ./deploy-cloud.sh"
```

### Step 5: Update Deployment Scripts

**Edge Deployment**: `deployments/edge/deploy-edge.sh`

```bash
#!/bin/bash
set -e

echo "=== Deploying Light Engine (Edge Mode) ==="

# Load edge config
cp .env.edge ../../light-engine/.env

# Deploy to edge device
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  ../../light-engine/ \
  greenreach@100.65.187.59:~/light-engine/

# Restart edge server
ssh greenreach@100.65.187.59 'cd ~/light-engine && pm2 restart light-engine'

echo "✓ Edge deployment complete"
```

**Cloud Deployment**: `deployments/cloud/deploy-cloud.sh`

```bash
#!/bin/bash
set -e

echo "=== Deploying Light Engine (Cloud Mode) ==="

# Load cloud config
cp .env.cloud ../../light-engine/.env

# Deploy to AWS EB
cd ../../light-engine
eb deploy greenreach-central-prod-v4

echo "✓ Cloud deployment complete"
```

---

## Testing Plan

### Phase 1: Analyze & Review Differences (Day 1)

```bash
# 1. Analyze file differences
./scripts/analyze-file-differences.sh

# 2. Review the generated report
cat consolidation-analysis-*.md

# 3. For each differing file, decide:
#    - Keep edge version (most likely)
#    - Manually merge cloud improvements
#    - Archive for reference

# 4. Document any cloud-specific features to preserve
```

### Phase 2: Run Consolidation (Day 2)

```bash
# 1. After reviewing analysis, run consolidation
./scripts/consolidate-light-engine.sh
# Will prompt for confirmation that analysis was reviewed

# 2. Verify structure
ls -la light-engine/public/
# Should have: LE-*.html, views/, styles/, config.js

# 3. Check backup was created
ls -la backups/pre-consolidation-*/

# 4. Review archived cloud files
ls -la backups/cloud-versions-archive-*/

# 5. Check greenreach-central cleanup
ls -la greenreach-central/public/
# Should have: GR-*.html only (no LE files)
```

### Phase 3: Test Edge Mode (Day 3-4)

```bash
# Start local edge server
cd light-engine
DEPLOYMENT_MODE=edge HAS_SENSORS=true npm start

# Test sensor endpoints
curl http://localhost:8091/api/config/features
# Expected: {"deployment":"edge","features":{"sensors":true,...}}

curl http://localhost:8091/env?hours=1
# Expected: Sensor data

# Open UI and verify:
# ✓ Nutrient management accessible
# ✓ Device control works
# ✓ Environmental data loads
```

### Phase 4: Test Cloud Mode (Day 5)

```bash
# Start local cloud server
cd light-engine
DEPLOYMENT_MODE=cloud HAS_SENSORS=false npm start

# Test feature config
curl http://localhost:3000/api/config/features
# Expected: {"deployment":"cloud","features":{"sensors":false,...}}

curl http://localhost:3000/env
# Expected: 404 or feature disabled message

# Open UI and verify:
# ✓ Nutrient management hidden
# ✓ Sensor data shows "Not available in cloud mode"
# ✓ Inventory/planning still works
# ✓ Farm summary gracefully degrades
```

### Phase 5: Deploy to Production (Week 2)

1. **Edge device first** (lower risk):
   ```bash
   cd deployments/edge
   ./deploy-edge.sh
   # Test at http://100.65.187.59:8091
   ```

2. **Cloud deployment**:
   ```bash
   cd deployments/cloud
   ./deploy-cloud.sh
   # Test at greenreach-central-prod-v4
   ```

3. **Verify GreenReach Central**:
   - GR-*.html pages still work
   - Can monitor both edge and cloud LE farms
   - Wholesale portal functional

---

## Rollback Plan

If issues arise:

```bash
# Restore original structure
git checkout HEAD -- public/ greenreach-central/public/

# Redeploy edge
ssh greenreach@100.65.187.59 'cd ~/Light-Engine-Foxtrot && pm2 restart server-foxtrot'

# Redeploy cloud
cd greenreach-central && eb deploy greenreach-central-prod-v4
```

---

## Benefits

### Immediate
- ✅ Single source of truth for Light Engine UI
- ✅ No more manual file syncing
- ✅ No drift between edge/cloud versions

### Long-term
- ✅ Feature parity guaranteed between deployments
- ✅ Easier to add new features (write once, deploy twice)
- ✅ Clear separation: Light Engine vs GreenReach Central
- ✅ Testable deployment modes

---

## Timeline

**Week 1**:
- Day 1-2: Create structure, run consolidation script
- Day 3-4: Add feature guards to critical pages
- Day 5: Local testing (edge + cloud modes)

**Week 2**:
- Day 1: Deploy to edge device (Big Green Farm)
- Day 2: Monitor edge deployment
- Day 3: Deploy to cloud (AWS EB)
- Day 4-5: Monitor both, fix any issues

**Week 3**:
- Full testing with real usage
- Document new deployment process
- Train on maintaining single codebase

---

## Success Criteria

- ✅ Light Engine files exist in only ONE location
- ✅ Edge deployment works with sensors/device control
- ✅ Cloud deployment works without sensors (graceful degradation)
- ✅ GreenReach Central monitoring unaffected
- ✅ No manual file syncing required
- ✅ Feature flag system working
- ✅ Both deployments tested in production

---

## Security: Separating GreenReach from Light Engine

### Current Security Risk

**Problem**: GreenReach Central and Light Engine Cloud are currently deployed together on same server:
- Same AWS Elastic Beanstalk instance
- Shared database access
- Mixed authentication contexts
- Potential for unauthorized access to customer farm data

### When to Separate: **Before Production Deployment**

**Timeline**: After consolidation testing (Week 2), before deploying to production

### Separation Strategy

#### Architecture After Consolidation:

```
┌─────────────────────────────────────────────────────────────┐
│              Light Engine (Unified Product)                 │
│  ┌──────────────────────┐    ┌──────────────────────────┐  │
│  │  Edge Deployments    │    │  Cloud Deployment        │  │
│  │  (On-Premise)        │    │  (AWS EB)                │  │
│  │                      │    │                          │  │
│  │  Big Green Farm      │    │  Multi-tenant SaaS       │  │
│  │  100.65.187.59       │    │  lightengine.aws.com     │  │
│  │  SENSORS=true        │    │  SENSORS=false           │  │
│  │  SQLite (isolated)   │    │  PostgreSQL (per-tenant) │  │
│  └──────────────────────┘    └──────────────────────────┘  │
│                                                             │
│  Same Codebase - Different Config                          │
└─────────────────────────────────────────────────────────────┘
           │ API Sync Only
           │ (authenticated, rate-limited)
           ↓
┌─────────────────────────────────────────┐
│  GreenReach Central (Separate System)  │
│  - greenreach.elasticbeanstalk.com      │
│  - PostgreSQL (aggregated data only)    │
│  - Wholesale marketplace                 │
│  - Farm monitoring dashboard             │
│  - API-only access to farms              │
└─────────────────────────────────────────┘
```

**Key Principle**: 
- Light Engine (edge + cloud) = ONE unified codebase, different deployments
- GreenReach Central = Separate system, API-only access to farms
- Security boundary = Light Engine (customer) vs GreenReach (company)

### Implementation: Phase 2A (Week 3)

**Step 1: Deploy Unified Light Engine to Cloud**

```bash
cd light-engine

# Create EB application for Light Engine
eb init light-engine --region us-east-1

# Create production environment
eb create light-engine-prod \
  --database.engine postgres \
  --database.username lightengine \
  --envvars DEPLOYMENT_MODE=cloud,HAS_SENSORS=false

# Deploy unified codebase
eb deploy light-engine-prod
```

**Step 2: Edge Deployments Use Same Codebase**

```bash
# Big Green Farm edge device
cd light-engine
rsync -avz --delete \
  --exclude 'node_modules' \
  ./ greenreach@100.65.187.59:~/light-engine/

# Edge device runs with SENSORS=true
ssh greenreach@100.65.187.59 '
  cd ~/light-engine
  echo "DEPLOYMENT_MODE=edge" > .env
  echo "HAS_SENSORS=true" >> .env
  pm2 restart light-engine
'
```

**Step 3: GreenReach Central Stays Separate**

```bash
cd greenreach-central

# Verify only GR files remain
ls public/
# Should show: GR-*.html ONLY (no LE files)

# Deploy GreenReach Central standalone
eb deploy greenreach-central-prod

# GreenReach accesses farms via API only
```

**Step 4: Configure API Security Between Systems**

**File**: `greenreach-central/middleware/farm-sync-auth.js`

```javascript
// GreenReach Central can ONLY access farm data via API
// Whether farm is edge or cloud - same API contract

export function authenticateFarmSync(req, res, next) {
  const farmApiKey = req.headers['x-farm-api-key'];
  const farmId = req.headers['x-farm-id'];
  
  // Verify farm is authorized to sync with GreenReach
  if (!isValidFarmApiKey(farmApiKey, farmId)) {
    return res.status(403).json({ error: 'Unauthorized farm sync' });
  }
  
  // Rate limit per farm (edge or cloud - same rules)
  req.authorizedFarm = farmId;
  next();
}

// GreenReach Central routes
app.post('/api/sync/inventory', 
  authenticateFarmSync,
  rateLimit({ max: 100, windowMs: 60000 }), // 100/min per farm
  syncInventoryFromFarm
);
```

**File**: `light-engine/routes/sync.js`

```javascript
// Light Engine exposes sync endpoints
// Same endpoints for edge AND cloud deployments

export function syncWithGreenReach(req, res) {
  const farmSettings = getFarmSettings();
  
  // Check if farm has opted into GreenReach network
  if (!farmSettings.greenreach_sync_enabled) {
    return res.status(403).json({ 
      error: 'GreenReach sync not enabled for this farm' 
    });
  }
  
  // Only sync approved data types
  const approvedData = {
    inventory: farmSettings.sync_inventory ? getInventory() : null,
    wholesale_orders: farmSettings.sync_orders ? getOrders() : null
    // NO access to: customer data, financials, internal operations
  };
  
  res.json(approvedData);
}
```

### Security Checklist

**Before deploying separated systems:**

- [ ] **Separate AWS Applications**
  - GreenReach Central: `greenreach-central-prod`
  - Light Engine (cloud): `light-engine-prod`
  - Light Engine (edge): On-premise deployments

- [ ] **Database Isolation**
  - Light Engine Cloud: Multi-tenant PostgreSQL (schema-per-farm)
  - Light Engine Edge: Local SQLite per device
  - GreenReach Central: Separate PostgreSQL (aggregated data only)
  - NO direct database access between systems

- [ ] **API-Only Communication**
  - GreenReach → Light Engine: Authenticated API calls only
  - Rate limiting on all sync endpoints
  - Audit logging of all cross-system access

- [ ] **Authentication Separation**
  - GreenReach admin accounts ≠ farm customer accounts
  - Different JWT secrets for GreenReach vs Light Engine
  - No shared session stores

- [ ] **Network Security**
  - Different domain names:
    - `greenreach.elasticbeanstalk.com` (company monitoring)
    - `lightengine.aws.com` or similar (customer product)
  - Separate SSL certificates
  - VPC isolation in AWS (if needed)

- [ ] **Data Governance**
  - Farms opt-in to GreenReach sync (default: OFF)
  - Clear data sharing agreements
  - GDPR/compliance for customer data

- [ ] **Unified Light Engine Security**
  - Edge and cloud use same authentication system
  - Same API endpoints regardless of deployment
  - Feature flags control sensor availability

### Migration Path (Week 3)

**Day 1**: Deploy Light Engine to cloud (new EB application)
**Day 2**: Update edge devices to use consolidated codebase
**Day 3**: Deploy GreenReach Central standalone (API-only farm access)
**Day 4**: Test sync between separated systems
**Day 5**: Verify all farms (edge + cloud) sync correctly with GreenReach

### Cost Impact

**Current**: 1 AWS EB environment (~$50/month)
- greenreach-central-prod-v4 (has both GR + LE mixed)

**After Separation**: 
- GreenReach Central EB (~$50/month) - Company monitoring
- Light Engine Cloud EB (~$50/month) - Customer SaaS
- Edge devices: Customer-owned hardware (no AWS cost)
- **Total AWS**: ~$100/month

**Security benefit**: Worth 2x cost for proper isolation

---

## Remote Management & Deployment Improvements

### Current Issues

**Edge Devices**:
- ❌ Manual SSH deployment to each device
- ❌ No centralized update system
- ❌ Hard to troubleshoot customer sites remotely
- ❌ No rollback mechanism if update fails
- ❌ Version drift across farms

**Cloud**:
- ✅ EB deployment works
- ❌ No automatic rollback on failure
- ❌ Limited visibility into deployment status

### Proposed Solution: Unified Update System

#### Architecture

```
┌──────────────────────────────────────────┐
│  GreenReach Update Server (New Service) │
│  - update.greenreach.com                  │
│  - Version registry                       │
│  - Signed update packages                 │
│  - Health monitoring                      │
└──────────────────────────────────────────┘
           │
           │ Secure Updates (HTTPS + signed)
           ↓
┌────────────────────────────┬────────────────────────┐
│   Edge Devices             │  Cloud Deployment      │
│   - Auto-update agent      │  - EB auto-deploy      │
│   - Version check (1h)     │  - Health checks       │
│   - Rollback on failure    │  - Auto-rollback       │
│   - Remote diagnostics     │  - Monitoring          │
└────────────────────────────┴────────────────────────┘
```

### Implementation

#### 1. Update Server

**Create**: `update-server/` (new service)

```javascript
// update-server/server.js
import express from 'express';
import crypto from 'crypto';
import { getDatabase } from './db.js';

const app = express();

// Version registry
app.get('/api/updates/latest', authenticateDevice, async (req, res) => {
  const { deployment_mode, current_version, farm_id } = req.query;
  
  const db = getDatabase();
  
  // Get latest version for deployment mode
  const latest = await db.query(`
    SELECT version, package_url, checksum, release_notes
    FROM light_engine_releases
    WHERE deployment_mode = $1
      AND status = 'stable'
      AND released_at < NOW()
    ORDER BY released_at DESC
    LIMIT 1
  `, [deployment_mode]);
  
  if (!latest.rows[0]) {
    return res.json({ update_available: false });
  }
  
  const latestVersion = latest.rows[0];
  
  // Check if update needed
  if (latestVersion.version === current_version) {
    return res.json({ update_available: false, current_version });
  }
  
  // Log update check
  await db.query(`
    INSERT INTO update_checks (farm_id, current_version, available_version, checked_at)
    VALUES ($1, $2, $3, NOW())
  `, [farm_id, current_version, latestVersion.version]);
  
  res.json({
    update_available: true,
    version: latestVersion.version,
    package_url: latestVersion.package_url,
    checksum: latestVersion.checksum,
    release_notes: latestVersion.release_notes,
    signature: signPackage(latestVersion.package_url) // Verify authenticity
  });
});

// Health endpoint for remote diagnostics
app.post('/api/devices/health', authenticateDevice, async (req, res) => {
  const { farm_id, health_data } = req.body;
  
  // Store device health metrics
  await storeHealthMetrics(farm_id, health_data);
  
  res.json({ status: 'ok' });
});
```

#### 2. Edge Update Agent

**Create**: `light-engine/services/update-agent.js`

```javascript
// Runs on edge devices
import fs from 'fs';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const UPDATE_CHECK_INTERVAL = 3600000; // 1 hour
const UPDATE_SERVER = process.env.UPDATE_SERVER || 'https://update.greenreach.com';
const FARM_ID = process.env.FARM_ID;
const API_KEY = process.env.API_KEY;

export class UpdateAgent {
  constructor() {
    this.currentVersion = this.getCurrentVersion();
    this.isUpdating = false;
  }
  
  async start() {
    console.log('[Update Agent] Starting version', this.currentVersion);
    
    // Check for updates every hour
    setInterval(() => this.checkForUpdates(), UPDATE_CHECK_INTERVAL);
    
    // Check immediately on startup (after 5 min delay)
    setTimeout(() => this.checkForUpdates(), 300000);
    
    // Send health metrics every 15 minutes
    setInterval(() => this.sendHealthMetrics(), 900000);
  }
  
  getCurrentVersion() {
    try {
      const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
      return pkg.version;
    } catch (err) {
      return 'unknown';
    }
  }
  
  async checkForUpdates() {
    if (this.isUpdating) {
      console.log('[Update Agent] Update in progress, skipping check');
      return;
    }
    
    try {
      const response = await fetch(`${UPDATE_SERVER}/api/updates/latest?deployment_mode=edge&current_version=${this.currentVersion}&farm_id=${FARM_ID}`, {
        headers: {
          'X-API-Key': API_KEY
        }
      });
      
      const data = await response.json();
      
      if (data.update_available) {
        console.log('[Update Agent] Update available:', data.version);
        console.log('[Update Agent] Release notes:', data.release_notes);
        
        // Check if outside business hours (2am-6am)
        const hour = new Date().getHours();
        if (hour >= 2 && hour < 6) {
          await this.performUpdate(data);
        } else {
          console.log('[Update Agent] Update scheduled for maintenance window (2am-6am)');
        }
      }
    } catch (err) {
      console.error('[Update Agent] Failed to check for updates:', err.message);
    }
  }
  
  async performUpdate(updateData) {
    this.isUpdating = true;
    console.log('[Update Agent] Starting update to', updateData.version);
    
    try {
      // 1. Create backup
      console.log('[Update Agent] Creating backup...');
      await execAsync(`cp -r ~/light-engine ~/light-engine.backup-${Date.now()}`);
      
      // 2. Download update package
      console.log('[Update Agent] Downloading update package...');
      const packagePath = `/tmp/light-engine-${updateData.version}.tar.gz`;
      await this.downloadPackage(updateData.package_url, packagePath);
      
      // 3. Verify checksum
      console.log('[Update Agent] Verifying package integrity...');
      const checksum = await this.calculateChecksum(packagePath);
      if (checksum !== updateData.checksum) {
        throw new Error('Package checksum mismatch - update aborted');
      }
      
      // 4. Extract and install
      console.log('[Update Agent] Extracting update...');
      await execAsync(`tar -xzf ${packagePath} -C ~/light-engine`);
      
      // 5. Run migrations if needed
      console.log('[Update Agent] Running migrations...');
      await execAsync('cd ~/light-engine && npm run migrate');
      
      // 6. Restart service
      console.log('[Update Agent] Restarting service...');
      await execAsync('pm2 restart light-engine');
      
      // 7. Wait and verify health
      await new Promise(resolve => setTimeout(resolve, 10000));
      const healthy = await this.checkHealth();
      
      if (!healthy) {
        throw new Error('Health check failed after update');
      }
      
      console.log('[Update Agent] ✓ Update successful:', updateData.version);
      
      // Report success
      await this.reportUpdateSuccess(updateData.version);
      
    } catch (err) {
      console.error('[Update Agent] Update failed:', err.message);
      
      // Rollback
      console.log('[Update Agent] Rolling back...');
      await execAsync('pm2 stop light-engine');
      await execAsync('rm -rf ~/light-engine');
      await execAsync(`cp -r ~/light-engine.backup-* ~/light-engine`);
      await execAsync('pm2 restart light-engine');
      
      console.log('[Update Agent] ✓ Rollback complete');
      
      await this.reportUpdateFailure(updateData.version, err.message);
    } finally {
      this.isUpdating = false;
    }
  }
  
  async downloadPackage(url, dest) {
    const response = await fetch(url, {
      headers: { 'X-API-Key': API_KEY }
    });
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(dest, Buffer.from(buffer));
  }
  
  async calculateChecksum(filePath) {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }
  
  async checkHealth() {
    try {
      const response = await fetch('http://localhost:8091/health');
      return response.ok;
    } catch (err) {
      return false;
    }
  }
  
  async sendHealthMetrics() {
    try {
      const health = {
        version: this.currentVersion,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        timestamp: new Date().toISOString()
      };
      
      await fetch(`${UPDATE_SERVER}/api/devices/health`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY
        },
        body: JSON.stringify({ farm_id: FARM_ID, health_data: health })
      });
    } catch (err) {
      console.error('[Update Agent] Failed to send health metrics:', err.message);
    }
  }
  
  async reportUpdateSuccess(version) {
    await fetch(`${UPDATE_SERVER}/api/updates/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify({
        farm_id: FARM_ID,
        version,
        status: 'success',
        timestamp: new Date().toISOString()
      })
    });
  }
  
  async reportUpdateFailure(version, error) {
    await fetch(`${UPDATE_SERVER}/api/updates/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify({
        farm_id: FARM_ID,
        version,
        status: 'failed',
        error,
        timestamp: new Date().toISOString()
      })
    });
  }
}

// Start update agent if in edge mode
if (process.env.DEPLOYMENT_MODE === 'edge') {
  const agent = new UpdateAgent();
  agent.start();
}
```

#### 3. Remote Access via Tailscale

**Setup secure remote access without exposing SSH to internet**

```bash
# Install Tailscale on edge devices
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --authkey=<greenreach-org-key>

# Now GreenReach team can SSH via Tailscale
# No port forwarding, no exposed SSH
ssh greenreach@100.100.100.X  # Tailscale internal IP
```

**Create**: `light-engine/scripts/setup-remote-access.sh`

```bash
#!/bin/bash
set -e

echo "=== Setting up secure remote access ==="

# 1. Install Tailscale
if ! command -v tailscale &> /dev/null; then
  echo "Installing Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | sh
fi

# 2. Configure Tailscale
echo "Connecting to GreenReach network..."
tailscale up --authkey=${TAILSCALE_AUTH_KEY} \
  --hostname="le-${FARM_ID}" \
  --ssh

# 3. Configure firewall (only allow Tailscale)
echo "Configuring firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0  # Allow Tailscale network
ufw enable

# 4. Setup log forwarding
echo "Setting up remote logging..."
cat > /etc/rsyslog.d/50-greenreach.conf << EOF
# Forward logs to GreenReach monitoring
*.* @@logs.greenreach.com:514
EOF
systemctl restart rsyslog

echo "✓ Remote access configured"
echo "Device accessible via: ssh greenreach@le-${FARM_ID}"
```

#### 4. Deployment Scripts

**Update**: `scripts/release-edge-update.sh`

```bash
#!/bin/bash
set -e

VERSION=$1
if [ -z "$VERSION" ]; then
  echo "Usage: ./release-edge-update.sh <version>"
  exit 1
fi

echo "=== Releasing Light Engine Edge Update v$VERSION ==="

# 1. Build release package
echo "Building release package..."
cd light-engine
npm ci --production
npm run build  # If needed

# 2. Create tarball
echo "Creating package..."
tar -czf "../light-engine-${VERSION}.tar.gz" \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='*.log' \
  .

# 3. Calculate checksum
CHECKSUM=$(sha256sum "../light-engine-${VERSION}.tar.gz" | cut -d' ' -f1)
echo "Checksum: $CHECKSUM"

# 4. Upload to S3
echo "Uploading to update server..."
aws s3 cp "../light-engine-${VERSION}.tar.gz" \
  "s3://greenreach-updates/light-engine/edge/${VERSION}/" \
  --acl private

# 5. Register release in update server
echo "Registering release..."
curl -X POST https://update.greenreach.com/api/releases \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"version\": \"${VERSION}\",
    \"deployment_mode\": \"edge\",
    \"package_url\": \"https://greenreach-updates.s3.amazonaws.com/light-engine/edge/${VERSION}/light-engine-${VERSION}.tar.gz\",
    \"checksum\": \"${CHECKSUM}\",
    \"release_notes\": \"$(git log --oneline -5)\",
    \"status\": \"beta\"
  }"

echo ""
echo "✓ Release created as 'beta' status"
echo ""
echo "To promote to production (all devices will auto-update):"
echo "  curl -X PATCH https://update.greenreach.com/api/releases/${VERSION} \\"
echo "    -H 'Authorization: Bearer \$ADMIN_TOKEN' \\"
echo "    -d '{\"status\": \"stable\"}'"
```

### Monitoring Dashboard

**Create**: `greenreach-central/public/GR-device-monitoring.html`

Shows real-time status of all edge devices:
- Current version
- Last update check
- Health status
- Remote access status
- Update history

### Benefits

**Operational**:
- ✅ Push updates to all edge devices centrally
- ✅ Automatic rollback on failure
- ✅ Secure remote access (no exposed SSH)
- ✅ Health monitoring and diagnostics
- ✅ Version consistency across fleet

**Security**:
- ✅ Signed update packages (prevents tampering)
- ✅ Tailscale VPN (no open ports)
- ✅ Audit logging of all remote access
- ✅ Automated security patches

**Customer Experience**:
- ✅ Zero downtime updates (2am-6am window)
- ✅ No manual intervention needed
- ✅ Faster bug fixes and new features

### Timeline

**Week 4**: Build update infrastructure
- Day 1: Setup update server
- Day 2: Implement update agent
- Day 3: Setup Tailscale remote access
- Day 4-5: Test on Big Green Farm

**Week 5**: Rollout to production
- Gradual rollout to edge devices
- Monitor update success rate
- Document remote access procedures

---

## Questions for Approval

1. **Timing**: Is Week 1 feasible to start consolidation?
2. **Security**: Should we separate GreenReach/LE in Week 3 (recommended)?
3. **Testing**: Can we test on Big Green Farm edge device first?
4. **Backup**: Should we keep `public/` as backup for 1 month?
5. **Cost**: Approve 2x AWS cost for security isolation?

---

## Risk Assessment

**Low Risk**:
- Consolidation is mostly file moves
- Feature flags are additive (no breaking changes)
- Rollback is simple (git checkout)

**Medium Risk**:
- GreenReach Central symlink might need path updates
- Some hardcoded paths in HTML might break

**Mitigation**:
- Test locally first
- Deploy edge before cloud
- Keep original files for 1 month
- Have rollback script ready
