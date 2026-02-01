# Data Schema Consumers Registry

This document tracks all consumers of canonical data formats to enable impact analysis for schema changes.

**Last Updated**: 2026-01-31 (Updated: central-admin.js normalization)

---

## groups.json Consumers

### Backend Services

**File**: `/routes/wholesale-sync.js`  
**Fields Used**: `crop`, `trays`, `plants`, `planConfig.anchor.seedDate`, `zone`, `roomId`  
**Purpose**: Generate wholesale inventory lots and availability data  
**Owner**: @wholesale-team  
**Critical**: Yes - Revenue impacting

**File**: `/analytics/energy-forecaster/calculators/energy-calculator.js`  
**Fields Used**: `lights`, `planRecipe`, `photoperiodHours`, `planConfig.schedule.photoperiodHours`  
**Purpose**: Calculate daily energy consumption forecasts  
**Owner**: @analytics-team  
**Critical**: No - Forecasting only

**File**: `/lib/schedule-executor.js`  
**Fields Used**: `plan`, `schedule`, `id`, `name`  
**Purpose**: Execute automated light schedules  
**Owner**: @automation-team  
**Critical**: Yes - Controls grow lights

**File**: `/farm-admin.js`  
**Fields Used**: `crop` (for unique crop list)  
**Purpose**: Populate crop dropdown in admin interface  
**Owner**: @frontend-team  
**Critical**: No - UI only

### Frontend Pages

**File**: `/public/views/farm-summary.html`  
**Fields Used**: All fields (multiple cards)  
**Purpose**: Display farm overview dashboard  
**Owner**: @frontend-team  
**Critical**: Yes - Primary user interface

**File**: `/public/views/farm-inventory.html`  
**Fields Used**: `crop`, `trays`, `plants`, `status`, `roomId`  
**Purpose**: Display current inventory  
**Owner**: @frontend-team  
**Critical**: Yes - Inventory management

**File**: `/public/views/planting-scheduler.html`  
**Fields Used**: All fields  
**Purpose**: Plan and schedule new plantings  
**Owner**: @frontend-team  
**Critical**: Yes - Planning interface

### GreenReach Central

**File**: `/greenreach-central/routes/admin.js`  
**Fields Used**: `trays`, `zone`, `plants`  
**Purpose**: Aggregate metrics across all farms  
**Owner**: @central-team  
**Critical**: Yes - Multi-farm management

**File**: `/greenreach-central/routes/sync.js`  
**Fields Used**: All fields (full group objects)  
**Purpose**: Sync farm data from edge to cloud  
**Owner**: @sync-team  
**Critical**: Yes - Data synchronization

**File**: `/greenreach-central/public/central-admin.js`  
**Fields Used**: `zone`, `zone_id`, `zoneId`, `location` (groups); `id`, `zone_id`, `zoneId`, `name`, `zone_name` (zones)  
**Purpose**: Zone detail monitoring display for GreenReach operations  
**Owner**: @greenreach-operations  
**Critical**: Yes - Operations monitoring  
**Normalization**: Inline functions `normalizeZone()`, `normalizeGroup()` (lines 518-558)  
**Note**: Duplicated from lib/data-adapters.js due to HTML <script> tag limitations. See TODO for future build system migration.

---

## farm.json Consumers

**File**: `/public/views/farm-summary.html`  
**Fields Used**: All fields  
**Purpose**: Display farm header and contact info  
**Owner**: @frontend-team  
**Critical**: Yes

**File**: `/greenreach-central/routes/admin.js`  
**Fields Used**: `farmId`, `name`, `status`, `lastHeartbeat`  
**Purpose**: Farm list and monitoring  
**Owner**: @central-team  
**Critical**: Yes

**File**: `/server-foxtrot.js`  
**Fields Used**: All fields (pass-through)  
**Purpose**: Serve farm configuration to clients  
**Owner**: @backend-team  
**Critical**: Yes

---

## rooms.json Consumers

**File**: `/public/LE-switchbot.html`  
**Fields Used**: `rooms[]`, `zones[]`  
**Purpose**: Device assignment dropdowns  
**Owner**: @frontend-team  
**Critical**: Yes - Device configuration

**File**: `/greenreach-central/routes/sync.js`  
**Fields Used**: All fields  
**Purpose**: Sync room structure from edge to cloud  
**Owner**: @sync-team  
**Critical**: Yes

**File**: `/routes/setup-wizard.js`  
**Fields Used**: `rooms[]`, `zones[]`  
**Purpose**: Initial farm setup interface  
**Owner**: @onboarding-team  
**Critical**: Yes - Setup flow

**File**: `/lib/demo-data-generator.js`  
**Fields Used**: All fields (generates structure)  
**Purpose**: Generate demo farm data  
**Owner**: @testing-team  
**Critical**: No - Demo only

---

## Field Usage Patterns

### crop vs recipe

**Current Usage**:
- 42 files use `group.crop || group.recipe` fallback pattern ✅
- 8 files use only `group.crop` ✅
- 6 files use only `group.recipe` ⚠️ (needs migration)

**Recommendation**: Migrate remaining `recipe` consumers to use `crop` with fallback

### trays (number vs array)

**Current Usage**:
- All files treat `trays` as number ✅
- 0 files expect array format ✅

**Status**: Standard enforced

### roomId vs room

**Current Usage**:
- 28 files use `group.roomId || group.room` fallback pattern ✅
- 12 files use only `group.roomId` ✅
- 4 files use only `group.room` ⚠️ (needs migration)

**Recommendation**: Migrate remaining `room` consumers to use `roomId` with fallback

---

## Change Impact Matrix

| Field Change         | Critical Consumers | Non-Critical | Migration Time |
|----------------------|-------------------|--------------|----------------|
| `groups[].crop`      | 8                 | 4            | 2 weeks        |
| `groups[].trays`     | 6                 | 2            | 1 week         |
| `groups[].roomId`    | 5                 | 3            | 1 week         |
| `groups[].planConfig`| 3                 | 2            | 2 weeks        |
| `farm.farmId`        | 3                 | 0            | 1 week         |
| `rooms[].zones`      | 4                 | 1            | 2 weeks        |

---

## Adding New Consumers

When creating a new consumer of canonical data:

1. Add entry to this document with:
   - File path
   - Fields used
   - Purpose
   - Owner
   - Criticality

2. Use adapter functions from `/lib/data-adapters.js`

3. Add fallback patterns for deprecated fields:
   ```javascript
   const crop = group.crop || group.recipe;
   const roomId = group.roomId || group.room;
   ```

4. Test with schema validation:
   ```bash
   npm run validate-schemas
   ```

---

## Deprecation Tracking

### Active Deprecations

**Field**: `group.recipe`  
**Replacement**: `group.crop`  
**Deprecated**: 2026-01-31  
**Removal Target**: 2026-02-14  
**Status**: Fallback in place

**Field**: `group.room`  
**Replacement**: `group.roomId`  
**Deprecated**: 2026-01-31  
**Removal Target**: 2026-02-14  
**Status**: Fallback in place

### Completed Deprecations

None yet.

---

## Contact

**Questions about adding a new consumer?**  
- Check this document first
- Use adapter functions in `/lib/data-adapters.js`
- Open issue with label `schema-consumer`

**Need to change a field used by consumers?**  
- Review this document for impact
- Follow process in `DATA_FORMAT_STANDARDS.md`
- Get approval from consumer owners
