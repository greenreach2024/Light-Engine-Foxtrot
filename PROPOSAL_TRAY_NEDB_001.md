# FORMAL IMPLEMENTATION PROPOSAL: Option B - NeDB Tray Management

**Proposal ID**: TRAY-NEDB-001  
**Date**: 2026-02-04  
**Submitted By**: Implementation Agent  
**Requires Approval From**: Review Agent  
**Status**: 🟡 AWAITING REVIEW

---

## Executive Summary

**Goal**: Eliminate Charlie backend (Python/FastAPI) dependency by implementing complete tray format CRUD operations in server-foxtrot.js using NeDB.

**Current State**: POST/PUT/DELETE operations proxy to `http://localhost:8000` and fail when Charlie backend is not running.

**Proposed State**: All operations handled by Foxtrot server using existing NeDB infrastructure.

**Impact**:
- ✅ Simplified deployment (single Node.js service)
- ✅ Eliminates Python dependency
- ✅ Uses existing NeDB infrastructure
- ✅ Maintains data persistence
- ⚠️ Requires testing and validation

---

## 1. EXACT CODE IMPLEMENTATION

### 1.1 POST /api/tray-formats (Create Format)

**File**: server-foxtrot.js  
**Line**: 16767  
**Action**: Replace Charlie proxy with NeDB implementation

#### BEFORE (Current Code):
```javascript
/**
 * POST /api/tray-formats
 * Create a new custom tray format - proxied to backend
 */
app.post('/api/tray-formats', async (req, res) => {
  try {
    const backendUrl = 'http://localhost:8000/api/tray-formats';
    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(errorData.detail || `Backend returned ${response.status}`);
    }
    
    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('[tray-formats] Failed to create format:', error);
    res.status(500).json({ error: error.message || 'Failed to create format' });
  }
});
```

#### AFTER (Proposed Replacement):
```javascript
/**
 * POST /api/tray-formats
 * Create a new custom tray format
 */
app.post('/api/tray-formats', async (req, res) => {
  try {
    const { name, plantSiteCount, systemType, trayMaterial, description, 
            isWeightBased, targetWeightPerSite, weightUnit } = req.body;
    
    // Validate required fields
    if (!name || !plantSiteCount) {
      return res.status(400).json({ 
        error: 'Missing required fields', 
        required: ['name', 'plantSiteCount'] 
      });
    }
    
    // Validate plant site count range
    const count = parseInt(plantSiteCount);
    if (isNaN(count) || count < 1 || count > 1000) {
      return res.status(400).json({ 
        error: 'plantSiteCount must be a number between 1 and 1000' 
      });
    }
    
    // Check for duplicate name
    const existing = await new Promise((resolve, reject) => {
      trayFormatsDB.findOne({ name }, (err, doc) => {
        if (err) reject(err);
        else resolve(doc);
      });
    });
    
    if (existing) {
      return res.status(409).json({ 
        error: 'Format with this name already exists',
        existingId: existing.trayFormatId
      });
    }
    
    // Generate unique ID
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const timestamp = Date.now();
    const trayFormatId = `custom-${slug}-${timestamp}`;
    
    // Create format document
    const format = {
      trayFormatId,
      name,
      plantSiteCount: count,
      systemType: systemType || null,
      trayMaterial: trayMaterial || null,
      description: description || null,
      isWeightBased: isWeightBased === true,
      targetWeightPerSite: isWeightBased ? (parseFloat(targetWeightPerSite) || null) : null,
      weightUnit: isWeightBased ? (weightUnit || 'oz') : 'heads',
      isCustom: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    // Insert into NeDB
    const inserted = await new Promise((resolve, reject) => {
      trayFormatsDB.insert(format, (err, doc) => {
        if (err) reject(err);
        else resolve(doc);
      });
    });
    
    console.log(`[tray-formats] Created: ${inserted.trayFormatId}`);
    res.status(201).json(inserted);
    
  } catch (error) {
    console.error('[tray-formats] Create failed:', error);
    res.status(500).json({ 
      error: 'Failed to create format',
      message: error.message 
    });
  }
});
```

**Lines Changed**: 16767-16789 (23 lines → 65 lines)

---

### 1.2 PUT /api/tray-formats/:id (Update Format)

**File**: server-foxtrot.js  
**Line**: After 16789 (NEW ENDPOINT)  
**Action**: Add new endpoint

```javascript
/**
 * PUT /api/tray-formats/:id
 * Update an existing tray format
 */
app.put('/api/tray-formats/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, plantSiteCount, systemType, trayMaterial, description,
            isWeightBased, targetWeightPerSite, weightUnit } = req.body;
    
    // Find existing format
    const existing = await new Promise((resolve, reject) => {
      trayFormatsDB.findOne({ trayFormatId: id }, (err, doc) => {
        if (err) reject(err);
        else resolve(doc);
      });
    });
    
    if (!existing) {
      return res.status(404).json({ error: 'Format not found' });
    }
    
    // Prevent editing default formats
    if (!existing.isCustom) {
      return res.status(403).json({ 
        error: 'Cannot edit default formats',
        hint: 'Create a custom format instead'
      });
    }
    
    // Build update object (only include provided fields)
    const updates = {
      updatedAt: new Date().toISOString()
    };
    
    if (name !== undefined) {
      // Check for duplicate name (excluding current format)
      const duplicate = await new Promise((resolve, reject) => {
        trayFormatsDB.findOne({ 
          name, 
          trayFormatId: { $ne: id } 
        }, (err, doc) => {
          if (err) reject(err);
          else resolve(doc);
        });
      });
      
      if (duplicate) {
        return res.status(409).json({ 
          error: 'Another format with this name already exists' 
        });
      }
      updates.name = name;
    }
    
    if (plantSiteCount !== undefined) {
      const count = parseInt(plantSiteCount);
      if (isNaN(count) || count < 1 || count > 1000) {
        return res.status(400).json({ 
          error: 'plantSiteCount must be a number between 1 and 1000' 
        });
      }
      updates.plantSiteCount = count;
    }
    
    if (systemType !== undefined) updates.systemType = systemType || null;
    if (trayMaterial !== undefined) updates.trayMaterial = trayMaterial || null;
    if (description !== undefined) updates.description = description || null;
    
    if (isWeightBased !== undefined) {
      updates.isWeightBased = isWeightBased === true;
      updates.targetWeightPerSite = isWeightBased 
        ? (parseFloat(targetWeightPerSite) || null) 
        : null;
      updates.weightUnit = isWeightBased ? (weightUnit || 'oz') : 'heads';
    }
    
    // Update in NeDB
    const numUpdated = await new Promise((resolve, reject) => {
      trayFormatsDB.update(
        { trayFormatId: id },
        { $set: updates },
        {},
        (err, n) => {
          if (err) reject(err);
          else resolve(n);
        }
      );
    });
    
    if (numUpdated === 0) {
      return res.status(500).json({ error: 'Update operation failed' });
    }
    
    // Fetch updated document
    const updated = await new Promise((resolve, reject) => {
      trayFormatsDB.findOne({ trayFormatId: id }, (err, doc) => {
        if (err) reject(err);
        else resolve(doc);
      });
    });
    
    console.log(`[tray-formats] Updated: ${id}`);
    res.json(updated);
    
  } catch (error) {
    console.error('[tray-formats] Update failed:', error);
    res.status(500).json({ 
      error: 'Failed to update format',
      message: error.message 
    });
  }
});
```

**Lines Added**: ~102 lines after line 16789

---

### 1.3 DELETE /api/tray-formats/:id (Delete Format)

**File**: server-foxtrot.js  
**Line**: After PUT endpoint (NEW ENDPOINT)  
**Action**: Add new endpoint

```javascript
/**
 * DELETE /api/tray-formats/:id
 * Delete a custom tray format
 */
app.delete('/api/tray-formats/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Find existing format
    const existing = await new Promise((resolve, reject) => {
      trayFormatsDB.findOne({ trayFormatId: id }, (err, doc) => {
        if (err) reject(err);
        else resolve(doc);
      });
    });
    
    if (!existing) {
      return res.status(404).json({ error: 'Format not found' });
    }
    
    // Prevent deleting default formats
    if (!existing.isCustom) {
      return res.status(403).json({ 
        error: 'Cannot delete default formats' 
      });
    }
    
    // Check if format is in use by any trays
    const traysUsingFormat = await new Promise((resolve, reject) => {
      traysDB.count({ trayFormatId: id }, (err, count) => {
        if (err) reject(err);
        else resolve(count);
      });
    });
    
    if (traysUsingFormat > 0) {
      return res.status(409).json({ 
        error: 'Cannot delete format in use',
        traysAffected: traysUsingFormat,
        hint: 'Reassign or delete trays using this format first'
      });
    }
    
    // Delete from NeDB
    const numRemoved = await new Promise((resolve, reject) => {
      trayFormatsDB.remove(
        { trayFormatId: id }, 
        {},
        (err, n) => {
          if (err) reject(err);
          else resolve(n);
        }
      );
    });
    
    if (numRemoved === 0) {
      return res.status(500).json({ error: 'Delete operation failed' });
    }
    
    console.log(`[tray-formats] Deleted: ${id}`);
    res.json({ 
      success: true, 
      deleted: id,
      message: 'Format deleted successfully'
    });
    
  } catch (error) {
    console.error('[tray-formats] Delete failed:', error);
    res.status(500).json({ 
      error: 'Failed to delete format',
      message: error.message 
    });
  }
});
```

**Lines Added**: ~67 lines after PUT endpoint

---

### 1.4 POST /api/trays/register Status

**File**: server-foxtrot.js  
**Line**: 16974  
**Status**: ✅ ALREADY IMPLEMENTED with NeDB logic (no changes needed)

```javascript
// Current implementation is already local (not proxying)
app.post('/api/trays/register', (req, res) => {
  const { trayId, format, plantCount } = req.body;
  
  if (!trayId) {
    return res.status(400).json({ error: 'trayId required' });
  }
  
  // In demo mode, just acknowledge registration
  if (isDemoMode()) {
    console.log('[inventory] Demo mode: Tray registered:', trayId);
    return res.json({ success: true, trayId, message: 'Tray registered (demo mode)' });
  }
  
  // TODO: Implement production tray registration
  res.json({ success: true, trayId });
});
```

**No changes required** - already using local logic.

---

## 2. DATABASE SCHEMA

### 2.1 Tray Formats Collection

**Collection**: `trayFormatsDB` (already initialized)  
**File**: NeDB file at `./data/tray-formats.db`

**Schema**:
```javascript
{
  trayFormatId: String,      // Primary key, format: "custom-{slug}-{timestamp}"
  name: String,              // Display name (unique)
  plantSiteCount: Number,    // 1-1000 sites per tray
  systemType: String | null, // "NFT", "DWC", "Ebb & Flow", etc.
  trayMaterial: String | null, // "Plastic", "Ceramic", etc.
  description: String | null,
  isWeightBased: Boolean,    // true = weight forecast, false = head count
  targetWeightPerSite: Number | null, // grams/oz per site (if weight-based)
  weightUnit: String,        // "oz", "lbs", "g", "kg", or "heads"
  isCustom: Boolean,         // true = user-created, false = system default
  createdAt: String,         // ISO 8601 timestamp
  updatedAt: String,         // ISO 8601 timestamp
  _id: String                // NeDB internal ID
}
```

**Indexes**:
- `trayFormatId` (unique)
- `name` (unique)
- `isCustom` (for filtering)

**Constraints**:
- `name` must be unique across all formats
- `plantSiteCount` must be 1-1000
- Default formats (`isCustom: false`) cannot be edited or deleted
- Formats in use by trays cannot be deleted

### 2.2 Default Formats (Seed Data)

Already exist in NeDB from GET endpoint (line 16602):

```javascript
[
  {
    trayFormatId: "microgreens-10x20",
    name: "10x20 Microgreens Tray",
    plantSiteCount: 200,
    systemType: "NFT",
    isWeightBased: false,
    isCustom: false
  },
  {
    trayFormatId: "lettuce-5x10",
    name: "5x10 Lettuce Tray",
    plantSiteCount: 24,
    systemType: "DWC",
    isWeightBased: false,
    isCustom: false
  }
]
```

### 2.3 Trays Collection (Reference)

**Collection**: `traysDB` (already exists)  
**Relationship**: `tray.trayFormatId` → `trayFormat.trayFormatId`

Used for referential integrity check during DELETE operations.

---

## 3. NeDB INITIALIZATION

### 3.1 Current Initialization

**File**: server-foxtrot.js  
**Lines**: 4650-4680 (approximately)

**Current Code**:
```javascript
// Existing NeDB databases
const Datastore = require('@seald-io/nedb');

// Database instances
const farmConfigDB = new Datastore({ 
  filename: path.join(DATA_DIR, 'farm-config.db'), 
  autoload: true 
});

const trayFormatsDB = new Datastore({ 
  filename: path.join(DATA_DIR, 'tray-formats.db'), 
  autoload: true 
});

const traysDB = new Datastore({ 
  filename: path.join(DATA_DIR, 'trays.db'), 
  autoload: true 
});

const trayRunsDB = new Datastore({ 
  filename: path.join(DATA_DIR, 'tray-runs.db'), 
  autoload: true 
});

const trayPlacementsDB = new Datastore({ 
  filename: path.join(DATA_DIR, 'tray-placements.db'), 
  autoload: true 
});
```

### 3.2 Required Changes

**Status**: ✅ NO CHANGES NEEDED

The NeDB instances `trayFormatsDB` and `traysDB` are already initialized and ready to use. The proposed implementation uses these existing instances.

---

## 4. PROXY CONFIGURATION TO REMOVE

### 4.1 Current Proxy Endpoints

**Endpoints proxying to Charlie backend (port 8000)**:

#### Line 16767: POST /api/tray-formats

**BEFORE**:
```javascript
app.post('/api/tray-formats', async (req, res) => {
  try {
    const backendUrl = 'http://localhost:8000/api/tray-formats';
    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(req.body)
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(errorData.detail || `Backend returned ${response.status}`);
    }
    
    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('[tray-formats] Failed to create format:', error);
    res.status(500).json({ error: error.message || 'Failed to create format' });
  }
});
```

**AFTER**:
```javascript
// See Section 1.1 - Complete NeDB implementation (no fetch to port 8000)
```

**Removed**:
- ✅ `fetch()` call to `http://localhost:8000`
- ✅ Proxy error handling
- ✅ Backend response translation

#### Other Proxy Endpoints

**GET /api/tray-formats** (line 16602): ✅ Already using NeDB (no changes)  
**GET /api/trays** (line 16818): ✅ Already using NeDB (no changes)  
**POST /api/trays/register** (line 16974): ✅ Already local (no changes)

### 4.2 Charlie Backend References

**Search Results for port 8000**:
```bash
$ grep -n "8000\|charlie\|backend" server-foxtrot.js | grep -i "tray\|format"
16769:    const backendUrl = 'http://localhost:8000/api/tray-formats';
```

**Only 1 reference to remove** - the POST endpoint proxy.

PUT and DELETE endpoints don't exist yet (will be created, not proxied).

---

## 5. TESTING PLAN

### 5.1 Pre-Implementation Verification

**Verify Current State**:

```bash
# 1. Check NeDB files exist
ls -lh data/tray-formats.db data/trays.db

# 2. Verify GET works (baseline)
curl -s http://localhost:8091/api/tray-formats | jq '.'

# Expected: [
#   {"trayFormatId":"microgreens-10x20","name":"10x20 Microgreens Tray",...},
#   {"trayFormatId":"lettuce-5x10","name":"5x10 Lettuce Tray",...}
# ]

# 3. Verify POST fails (current state)
curl -X POST http://localhost:8091/api/tray-formats \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","plantSiteCount":50}' \
  -w "\nHTTP:%{http_code}\n"

# Expected: {"error":"fetch failed"}
# HTTP:500
```

### 5.2 Post-Implementation Testing

**Test Suite** (run in order):

#### Test 1: Create Format (Valid)
```bash
curl -X POST http://localhost:8091/api/tray-formats \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Lettuce Format",
    "plantSiteCount": 36,
    "systemType": "DWC",
    "trayMaterial": "Plastic",
    "description": "Test format for validation",
    "isWeightBased": false
  }' | jq '.'

# Expected:
# {
#   "trayFormatId": "custom-test-lettuce-format-1738675200000",
#   "name": "Test Lettuce Format",
#   "plantSiteCount": 36,
#   "systemType": "DWC",
#   "trayMaterial": "Plastic",
#   "description": "Test format for validation",
#   "isWeightBased": false,
#   "targetWeightPerSite": null,
#   "weightUnit": "heads",
#   "isCustom": true,
#   "createdAt": "2026-02-04T...",
#   "updatedAt": "2026-02-04T...",
#   "_id": "..."
# }
# HTTP: 201
```

#### Test 2: Create Format (Validation Errors)
```bash
# Missing required field
curl -X POST http://localhost:8091/api/tray-formats \
  -H "Content-Type: application/json" \
  -d '{"plantSiteCount":50}' -w "\nHTTP:%{http_code}\n"

# Expected: {"error":"Missing required fields","required":["name","plantSiteCount"]}
# HTTP: 400

# Invalid plant site count
curl -X POST http://localhost:8091/api/tray-formats \
  -H "Content-Type: application/json" \
  -d '{"name":"Bad Count","plantSiteCount":9999}' -w "\nHTTP:%{http_code}\n"

# Expected: {"error":"plantSiteCount must be a number between 1 and 1000"}
# HTTP: 400
```

#### Test 3: Create Format (Duplicate Name)
```bash
curl -X POST http://localhost:8091/api/tray-formats \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Lettuce Format","plantSiteCount":50}' \
  -w "\nHTTP:%{http_code}\n"

# Expected: {"error":"Format with this name already exists","existingId":"custom-test-lettuce-format-..."}
# HTTP: 409
```

#### Test 4: Update Format (Valid)
```bash
# Get format ID from Test 1
FORMAT_ID="custom-test-lettuce-format-1738675200000"

curl -X PUT http://localhost:8091/api/tray-formats/$FORMAT_ID \
  -H "Content-Type: application/json" \
  -d '{
    "plantSiteCount": 48,
    "description": "Updated description"
  }' | jq '.'

# Expected: Format with plantSiteCount=48, description updated, updatedAt changed
# HTTP: 200
```

#### Test 5: Update Format (Prevent Default Edit)
```bash
curl -X PUT http://localhost:8091/api/tray-formats/microgreens-10x20 \
  -H "Content-Type: application/json" \
  -d '{"plantSiteCount":999}' -w "\nHTTP:%{http_code}\n"

# Expected: {"error":"Cannot edit default formats","hint":"Create a custom format instead"}
# HTTP: 403
```

#### Test 6: Delete Format (Valid)
```bash
curl -X DELETE http://localhost:8091/api/tray-formats/$FORMAT_ID \
  -w "\nHTTP:%{http_code}\n"

# Expected: {"success":true,"deleted":"custom-test-lettuce-format-...","message":"Format deleted successfully"}
# HTTP: 200

# Verify deleted
curl -s http://localhost:8091/api/tray-formats | jq '.[] | select(.trayFormatId == "'$FORMAT_ID'")'
# Expected: (empty)
```

#### Test 7: Delete Format (Prevent Default Delete)
```bash
curl -X DELETE http://localhost:8091/api/tray-formats/lettuce-5x10 \
  -w "\nHTTP:%{http_code}\n"

# Expected: {"error":"Cannot delete default formats"}
# HTTP: 403
```

#### Test 8: Delete Format (In Use)
```bash
# Create a tray using the format first (manual setup required)
# Then attempt delete

curl -X DELETE http://localhost:8091/api/tray-formats/lettuce-5x10 \
  -w "\nHTTP:%{http_code}\n"

# Expected (if trays exist): {"error":"Cannot delete format in use","traysAffected":5,"hint":"..."}
# HTTP: 409
```

#### Test 9: Weight-Based Format
```bash
curl -X POST http://localhost:8091/api/tray-formats \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Microgreens Weight Format",
    "plantSiteCount": 200,
    "isWeightBased": true,
    "targetWeightPerSite": 0.5,
    "weightUnit": "oz"
  }' | jq '.'

# Expected: Format with isWeightBased=true, targetWeightPerSite=0.5, weightUnit="oz"
# HTTP: 201
```

#### Test 10: UI Integration Test
```bash
# Open tray-setup.html in browser
open http://localhost:8091/views/tray-setup.html

# Manual Steps:
# 1. Click "Tray Formats" tab - should see 2 default formats
# 2. Create new format using form
# 3. Verify format appears in list
# 4. Click "Edit" on custom format
# 5. Update fields, save
# 6. Verify changes reflected
# 7. Click "Delete" on custom format
# 8. Confirm deletion
# 9. Verify format removed from list
# 10. Try editing/deleting default format - should show error
```

### 5.3 Performance Testing

```bash
# Create 50 formats (stress test)
for i in {1..50}; do
  curl -X POST http://localhost:8091/api/tray-formats \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"Test Format $i\",\"plantSiteCount\":$((20 + i))}" \
    -s -o /dev/null -w "Create $i: %{http_code} in %{time_total}s\n"
done

# Measure GET performance
time curl -s http://localhost:8091/api/tray-formats | jq 'length'
# Expected: <100ms for 52 formats

# Cleanup
for i in {1..50}; do
  ID=$(curl -s http://localhost:8091/api/tray-formats | jq -r ".[] | select(.name == \"Test Format $i\") | .trayFormatId")
  curl -X DELETE http://localhost:8091/api/tray-formats/$ID -s -o /dev/null
done
```

### 5.4 Rollback Procedure

**If implementation fails**:

```bash
# 1. Stop Foxtrot server
lsof -ti tcp:8091 -sTCP:LISTEN | xargs kill -TERM

# 2. Revert code changes
cd /Users/petergilbert/Light-Engine-Foxtrot
git diff server-foxtrot.js  # Review changes
git checkout server-foxtrot.js  # Revert if needed

# 3. Restore NeDB data (if corrupted)
cp data/tray-formats.db.backup data/tray-formats.db  # If backup exists

# 4. Start Charlie backend (original architecture)
cd charlie
python -m uvicorn main:app --port 8000 &

# 5. Restart Foxtrot
PORT=8091 node server-foxtrot.js > /tmp/foxtrot-rollback.log 2>&1 &

# 6. Verify GET still works
curl http://localhost:8091/api/tray-formats

# 7. Verify POST works with Charlie backend
curl -X POST http://localhost:8091/api/tray-formats \
  -H "Content-Type: application/json" \
  -d '{"name":"Rollback Test","plantSiteCount":30}'
```

---

## 6. MIGRATION STRATEGY

### 6.1 Data Assessment

**Current Data in Charlie Backend**:

```bash
# Check if Charlie backend has data
curl -s http://localhost:8000/api/tray-formats 2>/dev/null | jq '.' || echo "Charlie not running"

# Check NeDB data
echo "NeDB tray-formats.db:"
cat data/tray-formats.db | wc -l

# If Charlie had data, it would need migration
```

**Expected State**: Charlie backend is **NOT** running and has **NO** production data. All existing formats are served from NeDB (confirmed by GET endpoint working).

### 6.2 Migration Required?

**Analysis**:
- GET /api/tray-formats already uses NeDB ✅
- Charlie backend only handles POST/PUT/DELETE (write operations)
- Charlie has likely never been running in this environment
- No user-created formats exist (only 2 default formats in NeDB)

**Conclusion**: ⚠️ **NO MIGRATION NEEDED**

### 6.3 Migration Script (If Needed)

**Scenario**: If Charlie backend was running and has custom formats

**Migration Script** (hypothetical):
```javascript
// migrate-tray-formats.js
const Datastore = require('@seald-io/nedb');
const path = require('path');

async function migrateTrayFormats() {
  console.log('Starting tray format migration from Charlie to NeDB...');
  
  // 1. Fetch formats from Charlie
  const charlieFormats = await fetch('http://localhost:8000/api/tray-formats')
    .then(r => r.json())
    .catch(() => {
      console.error('Charlie backend not reachable');
      return [];
    });
  
  console.log(`Found ${charlieFormats.length} formats in Charlie`);
  
  // 2. Load NeDB
  const trayFormatsDB = new Datastore({ 
    filename: path.join(__dirname, 'data/tray-formats.db'), 
    autoload: true 
  });
  
  // 3. Get existing NeDB formats
  const nedbFormats = await new Promise((resolve, reject) => {
    trayFormatsDB.find({}, (err, docs) => {
      if (err) reject(err);
      else resolve(docs);
    });
  });
  
  console.log(`Found ${nedbFormats.length} formats in NeDB`);
  
  // 4. Migrate formats not in NeDB
  let migrated = 0;
  let skipped = 0;
  
  for (const charlieFormat of charlieFormats) {
    const exists = nedbFormats.find(f => f.trayFormatId === charlieFormat.trayFormatId);
    
    if (exists) {
      console.log(`Skipping ${charlieFormat.trayFormatId} (already in NeDB)`);
      skipped++;
      continue;
    }
    
    // Insert into NeDB
    await new Promise((resolve, reject) => {
      trayFormatsDB.insert(charlieFormat, (err, doc) => {
        if (err) reject(err);
        else resolve(doc);
      });
    });
    
    console.log(`Migrated: ${charlieFormat.trayFormatId}`);
    migrated++;
  }
  
  console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped`);
}

// Run if executed directly
if (require.main === module) {
  migrateTrayFormats()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { migrateTrayFormats };
```

**Usage** (if migration needed):
```bash
# 1. Ensure Charlie backend is running
curl http://localhost:8000/health

# 2. Run migration script
node migrate-tray-formats.js

# 3. Verify migration
curl http://localhost:8091/api/tray-formats | jq 'length'

# 4. Stop Charlie backend
# (No longer needed after migration)
```

### 6.4 Data Backup Strategy

**Before Implementation**:
```bash
# Create backup of NeDB files
cp data/tray-formats.db data/tray-formats.db.backup-$(date +%Y%m%d-%H%M%S)
cp data/trays.db data/trays.db.backup-$(date +%Y%m%d-%H%M%S)

echo "✅ Backups created"
ls -lh data/*.backup-*
```

**Restore if needed**:
```bash
# Find latest backup
LATEST_BACKUP=$(ls -t data/tray-formats.db.backup-* | head -1)

# Restore
cp $LATEST_BACKUP data/tray-formats.db
echo "✅ Restored from $LATEST_BACKUP"
```

---

## 7. IMPLEMENTATION CHECKLIST

### Pre-Implementation
- [ ] Review Agent approves proposal
- [ ] Create NeDB backups (tray-formats.db, trays.db)
- [ ] Verify Foxtrot server is running
- [ ] Run baseline tests (GET endpoints working)
- [ ] Document current server log location

### Implementation Steps
1. [ ] **Stop Foxtrot server**
   ```bash
   lsof -ti tcp:8091 -sTCP:LISTEN | xargs kill -TERM
   ```

2. [ ] **Replace POST endpoint** (Section 1.1)
   - File: server-foxtrot.js
   - Lines: 16767-16789
   - Replace proxy code with NeDB implementation

3. [ ] **Add PUT endpoint** (Section 1.2)
   - File: server-foxtrot.js
   - After line 16789
   - Insert complete PUT handler

4. [ ] **Add DELETE endpoint** (Section 1.3)
   - File: server-foxtrot.js
   - After PUT endpoint
   - Insert complete DELETE handler

5. [ ] **Verify syntax**
   ```bash
   node -c server-foxtrot.js
   ```

6. [ ] **Start Foxtrot server**
   ```bash
   PORT=8091 node server-foxtrot.js > /tmp/foxtrot-nedb-impl.log 2>&1 &
   ```

7. [ ] **Wait for startup** (5 seconds)

### Post-Implementation Validation
- [ ] Server started without errors
- [ ] GET /api/tray-formats returns 2 default formats
- [ ] POST /api/tray-formats creates format (Test 1)
- [ ] POST validation works (Test 2, 3)
- [ ] PUT /api/tray-formats updates format (Test 4)
- [ ] PUT prevents default edit (Test 5)
- [ ] DELETE /api/tray-formats removes format (Test 6)
- [ ] DELETE prevents default delete (Test 7)
- [ ] Weight-based format works (Test 9)
- [ ] UI loads without errors
- [ ] UI can create format
- [ ] UI can edit format
- [ ] UI can delete format
- [ ] No Charlie backend errors in logs

### Documentation Updates
- [ ] Update TRAY_SETUP_READINESS_REPORT.md (mark as resolved)
- [ ] Update README.md (remove Charlie backend requirement)
- [ ] Add comment in server-foxtrot.js noting NeDB is primary storage

### Deployment
- [ ] Commit changes to git
- [ ] Create PR for review
- [ ] Deploy to edge device (after approval)
- [ ] Verify production works
- [ ] Remove Charlie backend from deployment docs

---

## 8. RISK ASSESSMENT

### High Risk
**None identified** - NeDB already proven working for GET operations

### Medium Risk

**Risk**: NeDB file corruption during concurrent writes  
**Mitigation**: NeDB handles concurrency internally, uses file locking  
**Likelihood**: Low  
**Impact**: Medium (requires restore from backup)

**Risk**: Duplicate ID generation if concurrent requests  
**Mitigation**: Use timestamp + slug, NeDB insert is atomic  
**Likelihood**: Very Low  
**Impact**: Low (would get caught by duplicate name check)

### Low Risk

**Risk**: Performance degradation with 1000+ formats  
**Mitigation**: NeDB indexes on trayFormatId and name  
**Likelihood**: Low (typical farm has <20 formats)  
**Impact**: Low (still < 100ms query time)

---

## 9. SUCCESS CRITERIA

### Functional Requirements
✅ **MUST**: POST /api/tray-formats creates formats without Charlie backend  
✅ **MUST**: PUT /api/tray-formats updates custom formats  
✅ **MUST**: DELETE /api/tray-formats removes custom formats  
✅ **MUST**: Default formats cannot be edited or deleted  
✅ **MUST**: Duplicate names prevented  
✅ **MUST**: Formats in use cannot be deleted  

### Non-Functional Requirements
✅ **MUST**: No Charlie backend dependency  
✅ **MUST**: Data persists across server restarts  
✅ **MUST**: API responses <200ms  
✅ **MUST**: No data loss during operations  
✅ **SHOULD**: Clear error messages for validation failures  
✅ **SHOULD**: Comprehensive logging for debugging  

### UI Requirements
✅ **MUST**: Tray Setup page fully functional  
✅ **MUST**: Create format form works  
✅ **MUST**: Edit modal works  
✅ **MUST**: Delete confirmation works  
✅ **SHOULD**: Loading states during operations  
✅ **SHOULD**: Success/error feedback to user  

---

## 10. APPROVAL CHECKLIST

**Review Agent - Please verify:**

- [ ] **Code Quality**: Implementation follows Node.js best practices
- [ ] **Error Handling**: All edge cases covered (validation, not found, conflict)
- [ ] **Security**: No injection vulnerabilities, input validation comprehensive
- [ ] **Data Integrity**: Foreign key checks prevent orphaned data
- [ ] **Framework Compliance**: Follows simplicity principle, database-driven
- [ ] **Testing**: Test plan covers all scenarios, rollback procedure clear
- [ ] **Migration**: Strategy appropriate (no migration needed)
- [ ] **Documentation**: Proposal is complete and actionable
- [ ] **Schema Compliance**: No data format violations
- [ ] **Deployment**: Implementation can be deployed safely

**Questions for Review Agent:**
1. Any concerns about NeDB handling concurrent writes?
2. Should we add rate limiting to prevent abuse?
3. Approve to proceed with implementation?

---

## 11. NEXT STEPS

**Upon Approval**:
1. Implementation Agent executes code changes (30 minutes)
2. Run complete test suite (15 minutes)
3. Fix any issues found during testing (30 minutes)
4. Update documentation (15 minutes)
5. Create PR for Architecture Agent review
6. Deploy to edge device after final approval

**Timeline**: 1.5 hours from approval to completion

---

**Proposal Status**: 🟡 AWAITING REVIEW AGENT APPROVAL

**Submitted By**: Implementation Agent  
**Date**: 2026-02-04  
**Review Required From**: Review Agent
