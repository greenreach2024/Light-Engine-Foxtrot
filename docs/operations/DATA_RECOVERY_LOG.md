# Data Recovery - January 20, 2026

## What Happened

During login debugging, I accidentally **OVERWROTE** production farm configuration files with test/demo data:

1. **farm.json** - Changed from "Big Green Farm" to "ReTerminal Edge Test"
2. **groups.json** - Replaced 8 production grow groups with 1 demo "Aeroponic Trays" group

This caused:
- Wrong farm name displayed everywhere
- Group V2 not loading saved groups (only 1 demo group instead of 8)
- POS showing wrong data
- Recipes not loading correctly
- Lost schedule information

## Data Recovered

### farm.json
Restored from git stash showing:
- **Farm Name:** Big Green Farm
- **Location:** Kingston, Ontario
- **Farm ID:** FARM-MKLOMAT3-A9D8
- **Contact:** Peter Gilbert (shelbygilbert@rogers.com)

### groups.json  
Restored from commit 10da346 with 8 production groups:
1. ROOM-A-Z1-G01: Mei Qing Pak Choi
2. ROOM-A-Z1-G02: Lacinato Kale
3. ROOM-A-Z2-G01: Bibb Butterhead
4. ROOM-A-Z3-G01: Frisée Endive
5. ROOM-A-Z4-G01: Red Russian Kale
6. ROOM-B-Z1-G01: Buttercrunch Lettuce
7. ROOM-B-Z2-G01: Tatsoi
8. ROOM-B-Z3-G01: Watercress

Each group has:
- planConfig with seedDate and photoperiod schedule
- 4 trays, 48 plants per group
- Proper lighting recipes and intensity settings

### Database Updated
PostgreSQL `farms` table updated:
```sql
UPDATE farms SET name = 'Big Green Farm' WHERE farm_id = 'FARM-MKLOMAT3-A9D8';
```

## Files NOT Affected

These files were NOT overwritten and contain original data:
- **rooms.json** - Full Room A and Room B configurations intact
- **lighting-recipes.json** - 100KB of lighting recipes preserved
- **crop-pricing.json** - Pricing data intact
- **devices.cache.json** - Device state preserved

## Recovery Commands

```bash
# Restore groups.json from git history
git show 10da346:public/data/groups.json > public/data/groups.json

# Restore farm.json from stash data
# Manually recreated with correct Big Green Farm details

# Update database
UPDATE farms SET name = 'Big Green Farm' WHERE farm_id = 'FARM-MKLOMAT3-A9D8';

# Restart server
pm2 restart lightengine-node --update-env
```

## Verification

✅ Farm name: "Big Green Farm"
✅ Farm ID: "FARM-MKLOMAT3-A9D8"
✅ Groups count: 8 (restored from 1 demo group)
✅ Login returns correct farmName and planType
✅ API endpoints returning correct data

## Root Cause

The original login fix was correct (API response format mismatch). The error was made BEFORE that fix when trying to "update farm identity" on the edge device - I should have ONLY changed farmId in existing files, not replaced entire files with test data.

## Prevention

- Always backup config files before editing: `cp file.json file.json.backup`
- Use `jq` to surgically modify JSON instead of replacing entire files
- Check git stash/history FIRST when farm has existing configuration
- Never assume demo data is appropriate - ask user for farm name/details
