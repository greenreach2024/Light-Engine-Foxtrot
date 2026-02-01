# Data Format Standards & Governance

## Problem Statement

The Light Engine application has experienced **data format drift** where:
- Original source formats have been modified by agents to fix specific pages/cards
- These changes break other pages/features that depend on the original format
- No validation or schema enforcement exists at the data layer
- Multiple inconsistent field names exist across the codebase

**Example**: `group.crop` vs `group.recipe`, `group.trays` vs `Array.isArray(group.trays)`

---

## Core Data Standards

### 1. Groups Format (groups.json)

**CANONICAL FORMAT** - DO NOT MODIFY WITHOUT SCHEMA VERSION UPDATE:

```json
{
  "groups": [
    {
      "id": "string (required)",           // Format: "RoomId:ZoneId:GroupName"
      "name": "string (required)",
      "roomId": "string (required)",       // NOT "room"
      "zone": "string (required)",         // Zone identifier
      "crop": "string (required)",         // Primary field, NOT "recipe"
      "status": "string",                  // "active" | "planned" | "completed"
      "trays": "number (required)",        // NOT array, simple count
      "plants": "number (required)",       // Total plant count
      "planConfig": {                      // Optional growth plan
        "anchor": {
          "seedDate": "ISO8601 string"
        },
        "schedule": {
          "photoperiodHours": "number"
        }
      },
      "lights": [                          // Optional array of light assignments
        {
          "deviceId": "string",
          "recipe": "object"
        }
      ]
    }
  ]
}
```

**FIELD RULES**:
- ✅ `crop`: Primary crop identifier (use this)
- ❌ `recipe`: DEPRECATED - Only use within `lights[]` array for light recipes
- ✅ `trays`: Simple number (4, 8, 12)
- ❌ `trays[]`: NEVER use array format
- ✅ `roomId`: Room identifier
- ❌ `room`: DEPRECATED alias

**CONSUMERS** (56 locations found):
- `/routes/wholesale-sync.js` - Inventory calculations
- `/analytics/energy-forecaster/calculators/energy-calculator.js` - Energy forecasting
- `/lib/schedule-executor.js` - Automation scheduling
- `/farm-admin.js` - Admin dashboard
- `/public/views/farm-summary.html` - Summary cards
- `/public/views/farm-inventory.html` - Inventory displays
- `/public/views/planting-scheduler.html` - Planning interface
- `/greenreach-central/routes/admin.js` - Central aggregation
- `/greenreach-central/routes/sync.js` - Farm sync operations

---

### 2. Farm Format (farm.json)

**CANONICAL FORMAT**:

```json
{
  "farmId": "string (required)",         // Format: "FARM-XXXXX-XXXX"
  "name": "string (required)",
  "status": "string",                    // "online" | "offline" | "maintenance"
  "region": "string",
  "location": "string",
  "contact": {
    "name": "string",
    "email": "string",
    "phone": "string"
  },
  "coordinates": {
    "lat": "number",
    "lng": "number"
  }
}
```

**CONSUMERS** (8 locations):
- `/public/views/farm-summary.html` (farm header)
- `/greenreach-central/routes/admin.js` (farm list)
- `/server-foxtrot.js` (API endpoint `/data/farm.json`)

---

### 3. Rooms Format (rooms.json)

**CANONICAL FORMAT**:

```json
{
  "rooms": [
    {
      "id": "string (required)",         // Room identifier
      "name": "string (required)",
      "zones": [
        {
          "id": "string (required)",     // Zone identifier
          "name": "string (required)"
        }
      ]
    }
  ]
}
```

**CONSUMERS** (15 locations):
- `/public/LE-switchbot.html` - Device assignment
- `/greenreach-central/routes/sync.js` - Sync operations
- `/routes/setup-wizard.js` - Initial setup
- `/lib/demo-data-generator.js` - Demo generation

---

## Schema Validation

### Implementation Plan

**Phase 1: Add JSON Schema Validation** (Week 1)

```javascript
// /lib/schema-validator.js
import Ajv from 'ajv';

const groupsSchema = {
  type: 'object',
  required: ['groups'],
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'roomId', 'zone', 'crop', 'trays', 'plants'],
        properties: {
          id: { type: 'string', pattern: '^[^:]+:[^:]+:.+$' },
          name: { type: 'string', minLength: 1 },
          roomId: { type: 'string', minLength: 1 },
          zone: { type: 'string', minLength: 1 },
          crop: { type: 'string', minLength: 1 },
          status: { type: 'string', enum: ['active', 'planned', 'completed'] },
          trays: { type: 'number', minimum: 0 },
          plants: { type: 'number', minimum: 0 },
          planConfig: { type: 'object' },
          lights: { type: 'array' }
        },
        additionalProperties: false
      }
    }
  }
};

const ajv = new Ajv();
export const validateGroups = ajv.compile(groupsSchema);
```

**Phase 2: Server-Side Enforcement** (Week 1-2)

```javascript
// server-foxtrot.js - Add validation middleware
app.use('/data/groups.json', (req, res, next) => {
  if (req.method === 'POST' || req.method === 'PUT') {
    const valid = validateGroups(req.body);
    if (!valid) {
      return res.status(400).json({
        error: 'Schema validation failed',
        details: validateGroups.errors
      });
    }
  }
  next();
});
```

**Phase 3: Client-Side Warnings** (Week 2-3)

```javascript
// Add to farm-admin.js and other editors
async function saveGroups(groupsData) {
  // Pre-validate before save
  if (!validateGroups(groupsData)) {
    console.error('❌ Groups data violates schema:', validateGroups.errors);
    alert('Data format error - see console for details');
    return false;
  }
  // Proceed with save
}
```

---

## Migration Rules

### Rule 1: Field Deprecation Process

**NEVER** directly change field names in source data. Instead:

1. **Add new field** alongside deprecated field
2. **Update consumers** to use new field with fallback
3. **Deprecation period**: 2 weeks minimum
4. **Remove deprecated** field after verification

**Example Migration**:

```javascript
// WRONG - Breaks existing consumers
group.recipe = group.crop; // DON'T DO THIS

// CORRECT - Supports both during transition
const cropName = group.crop || group.recipe; // ✅ Fallback pattern
```

### Rule 2: Backward Compatibility Adapters

**For consumers that need flexible formats**:

```javascript
// /lib/data-adapters.js
export function normalizeGroup(group) {
  return {
    ...group,
    crop: group.crop || group.recipe,        // Normalize to standard
    trays: typeof group.trays === 'number' 
      ? group.trays 
      : (Array.isArray(group.trays) ? group.trays.length : 0)
  };
}

// Usage in consumers
const normalizedGroups = groups.map(normalizeGroup);
```

### Rule 3: Agent Modifications

**BEFORE** modifying source data formats:

1. ✅ Check `DATA_FORMAT_STANDARDS.md` for canonical format
2. ✅ Run `npm run validate-schemas` to verify changes
3. ✅ Update schema version if structure changes
4. ✅ Document changes in migration log
5. ❌ NEVER modify format to fix single page/card

**Agent Response Template**:

```
❌ Cannot modify groups.json format to add XYZ field.
   
   REASON: This is a canonical data source used by 56 consumers.
   
   SOLUTION: 
   1. Update consumer code to use existing field
   2. OR add adapter in consumer layer
   3. OR propose schema version update with full impact analysis
```

---

## Testing & Validation

### Pre-Deploy Checks

```bash
# Add to package.json scripts
"validate-schemas": "node scripts/validate-all-schemas.js",
"test:data-formats": "node scripts/test-data-format-compatibility.js"
```

### Validation Script

```javascript
// scripts/validate-all-schemas.js
import fs from 'fs';
import { validateGroups, validateFarm, validateRooms } from '../lib/schema-validator.js';

const files = [
  { path: './public/data/groups.json', validator: validateGroups },
  { path: './public/data/farm.json', validator: validateFarm },
  { path: './public/data/rooms.json', validator: validateRooms }
];

let errors = 0;
files.forEach(({ path, validator }) => {
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!validator(data)) {
    console.error(`❌ ${path} validation failed:`, validator.errors);
    errors++;
  } else {
    console.log(`✅ ${path} valid`);
  }
});

process.exit(errors);
```

---

## Schema Versioning

### Version Format

```json
{
  "schemaVersion": "1.0.0",
  "groups": [ /* data */ ]
}
```

### Breaking Changes

**Version bump rules**:
- **Major (1.x.x → 2.x.x)**: Remove required field, change field type
- **Minor (x.1.x → x.2.x)**: Add new required field, deprecate field
- **Patch (x.x.1 → x.x.2)**: Add optional field, documentation fix

### Compatibility Matrix

| Consumer               | Min Schema | Max Schema | Adapter Required |
|------------------------|------------|------------|------------------|
| wholesale-sync.js      | 1.0.0      | 1.9.x      | No               |
| energy-calculator.js   | 1.0.0      | 1.9.x      | No               |
| farm-summary.html      | 1.0.0      | 1.9.x      | No               |
| farm-inventory.html    | 1.0.0      | 1.9.x      | No               |

---

## Field Mapping Reference

### Groups Object

| Current Code Uses        | Standard Field | Action Required          |
|--------------------------|----------------|--------------------------|
| `group.recipe`           | `group.crop`   | Add fallback: `crop || recipe` |
| `group.room`             | `group.roomId` | Add fallback: `roomId || room` |
| `Array.isArray(trays)`   | `group.trays`  | Ensure always number     |
| `group.photoperiodHours` | `planConfig.schedule.photoperiodHours` | Add nested accessor |

### Common Fallback Patterns

```javascript
// Energy calculator pattern (CURRENT CORRECT)
const cropName = group.crop || group.recipe;
const photoperiodHours = group.photoperiodHours 
  || group.planConfig?.schedule?.photoperiodHours 
  || 12;

// Wholesale sync pattern (CURRENT CORRECT)
const trayCount = group.trays || 4;
const plantsPerTray = (group.plants || 48) / trayCount;
const location = group.zone || group.roomId || 'Unknown';
```

---

## Governance

### Change Request Process

**For any changes to canonical formats**:

1. **Open GitHub Issue** with label `schema-change`
2. **Impact Analysis**: Run `npm run find-consumers <field>`
3. **Review Required**: 2 approvals (1 tech lead + 1 consumer owner)
4. **Migration Plan**: Document in `MIGRATIONS.md`
5. **Deprecation Timeline**: Minimum 14 days
6. **Deploy**: Schema change → Consumer updates → Deprecation cleanup

### Consumer Registration

**All consumers must register** in `SCHEMA_CONSUMERS.md`:

```markdown
## groups.json Consumers

- File: `/routes/wholesale-sync.js`
  - Fields: `crop`, `trays`, `plants`, `planConfig.anchor.seedDate`
  - Purpose: Generate wholesale inventory lots
  - Owner: @wholesale-team
```

### Documentation

- **This file**: Master standards reference
- `SCHEMA_CONSUMERS.md`: Consumer registry
- `MIGRATIONS.md`: Historical changes
- `BREAKING_CHANGES.md`: Upgrade guides

---

## Implementation Checklist

### Immediate (Week 1)
- [ ] Create `/lib/schema-validator.js` with JSON schemas
- [ ] Add validation to `server-foxtrot.js` endpoints
- [ ] Document all current consumers in `SCHEMA_CONSUMERS.md`
- [ ] Add `npm run validate-schemas` script

### Short-term (Week 2-3)
- [ ] Add client-side validation warnings
- [ ] Create adapter functions in `/lib/data-adapters.js`
- [ ] Add pre-commit hook for schema validation
- [ ] Update all HTML forms to use canonical fields

### Long-term (Month 2+)
- [ ] Remove all `|| recipe` fallbacks (after migration)
- [ ] Remove all `|| room` fallbacks (after migration)
- [ ] Implement schema version negotiation
- [ ] Add runtime schema enforcement in edge devices

---

## Example: Fixing Format Drift

### WRONG Approach
```javascript
// Agent modifies groups.json to fix one card
{
  "groups": [{
    "recipeName": "Astro Arugula",  // ❌ New field breaks 56 consumers
    "trayList": [1, 2, 3, 4]         // ❌ Changes type breaks calculations
  }]
}
```

### CORRECT Approach
```javascript
// Agent updates ONLY the consumer
// File: /public/views/problem-card.html

const cropDisplay = group.crop || group.recipe;  // ✅ Use standard field
const trayCount = Array.isArray(group.trays) 
  ? group.trays.length 
  : (group.trays || 4);  // ✅ Handle both formats
```

---

## Contact

**Questions about data format changes?**
- Check this document first
- Review `SCHEMA_CONSUMERS.md` for impact
- Open issue with label `schema-question`

**Emergency format fix needed?**
- Use adapter pattern (see Rule 2)
- Do NOT modify source data
- Document in post-mortem

---

**Last Updated**: 2026-01-31  
**Schema Version**: 1.0.0  
**Document Owner**: @architecture-team
