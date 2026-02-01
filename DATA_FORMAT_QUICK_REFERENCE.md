# Data Format Quick Reference

**For: Developers, AI Agents, Code Reviewers**

---

## ⚠️ Before Touching Data Files

```bash
# 1. Check format
cat DATA_FORMAT_STANDARDS.md

# 2. Check consumers (56+)
cat SCHEMA_CONSUMERS.md

# 3. Validate current
npm run validate-schemas

# 4. Use adapters
import { normalizeGroup } from './lib/data-adapters.js'
```

---

## 🚫 DO NOT

- ❌ Modify `groups.json`/`farm.json`/`rooms.json` to fix one page
- ❌ Rename fields without migration plan
- ❌ Change types (number → array)
- ❌ Add required fields without approval
- ❌ Bypass validation

---

## ✅ DO

- ✅ Fix consumers, not source data
- ✅ Use adapters from `lib/data-adapters.js`
- ✅ Add fallback: `group.crop || group.recipe`
- ✅ Validate: `npm run validate-schemas`
- ✅ Document new consumers in `SCHEMA_CONSUMERS.md`

---

## 📖 Field Reference

### groups.json (CANONICAL)

```javascript
{
  "groups": [{
    "id": "string",           // Required: "RoomId:ZoneId:Name"
    "name": "string",         // Required: Display name
    "roomId": "string",       // Required: NOT "room"
    "zone": "string",         // Required: Zone identifier
    "crop": "string",         // Required: NOT "recipe"
    "status": "string",       // "active|deployed|planned|completed"
    "trays": number,          // Required: Number, NOT array
    "plants": number,         // Required: Total count
    "planConfig": {           // Optional: Growth plan
      "anchor": {
        "seedDate": "ISO8601"
      },
      "schedule": {
        "photoperiodHours": number
      }
    }
  }]
}
```

### Common Fallbacks

```javascript
// Use these patterns for backward compatibility
const crop = group.crop || group.recipe;
const roomId = group.roomId || group.room;
const trayCount = typeof group.trays === 'number' 
  ? group.trays 
  : (Array.isArray(group.trays) ? group.trays.length : 4);
```

---

## 🔧 Using Adapters

```javascript
import { 
  normalizeGroup,      // Handle format variations
  getActiveGroups,     // Filter + normalize
  toDisplayFormat,     // UI-friendly format
  toWholesaleFormat,   // Inventory format
  toEnergyFormat       // Energy calc format
} from './lib/data-adapters.js';

// Example: Get active groups
const groupsData = JSON.parse(fs.readFileSync('groups.json'));
const active = getActiveGroups(groupsData); // Auto-normalized

// Example: Convert to display format
const display = active.map(toDisplayFormat);
console.log(display[0]);
// {
//   id: "...",
//   crop: "Astro Arugula",
//   location: "GreenReach/1",
//   plantsPerTray: 24,
//   photoperiod: "12h",
//   age: "16 days",
//   isActive: true
// }
```

---

## 🛡️ Validation

```javascript
// In API endpoints
import { validateGroups, validateWithErrors } from './lib/schema-validator.js';

app.post('/api/groups', (req, res) => {
  const result = validateWithErrors(validateGroups, req.body, 'groups');
  
  if (!result.valid) {
    return res.status(400).json({
      error: 'Invalid format',
      details: result.errors
    });
  }
  
  // Save data
});
```

---

## 📊 Consumer Count

| File           | Consumers | Critical |
|----------------|-----------|----------|
| groups.json    | 56+       | Yes      |
| farm.json      | 8         | Yes      |
| rooms.json     | 15        | Yes      |

**Impact**: Changing formats breaks multiple systems

---

## 🔄 Change Process

**For schema changes** (rare):

1. Open GitHub issue with `schema-change` label
2. Document in `MIGRATIONS.md`
3. Update schema version: `1.0.0` → `1.1.0`
4. Update ALL consumers
5. Test with `npm run validate-schemas`
6. Deploy with migration guide

**For consumer updates** (common):

1. Use adapters or fallbacks
2. Test locally
3. Deploy consumer only

---

## 💬 Agent Response Templates

**When asked to modify format**:
```
❌ Cannot modify groups.json to add [FIELD].

REASON: 56+ consumers depend on this format.

SOLUTION:
1. Fix consumer to use existing field
2. Use adapter: normalizeGroup(group)
3. Add fallback: group.crop || group.recipe

Which approach?
```

**When format looks wrong**:
```
⚠️ This deviates from DATA_FORMAT_STANDARDS.md

Expected: { crop: "string", trays: number }
Current: { recipe: "string", trays: [1,2,3] }

OPTIONS:
1. Fix consumer (recommended)
2. Add adapter
3. File schema change request
```

---

## 📚 Documentation

1. **DATA_FORMAT_STANDARDS.md** - Master standards (650 lines)
2. **SCHEMA_CONSUMERS.md** - Consumer registry (340 lines)
3. **.github/copilot-instructions-schema.md** - Agent guide (450 lines)
4. **lib/data-adapters.js** - Adapter API (280 lines)
5. **lib/schema-validator.js** - Validation API (245 lines)

---

## ⚡ Quick Commands

```bash
# Validate all data files
npm run validate-schemas

# Find consumers of a field
grep -r "group\.crop" . --include="*.js" --include="*.html"

# Check adapter usage
grep -r "normalizeGroup\|toDisplayFormat" .

# Run pre-commit check
npm run precommit
```

---

## 🎯 Key Principle

> **Data formats are infrastructure, not implementation details.**
> 
> Treat them like database schemas - changes require migration plans.

---

**Last Updated**: 2026-01-31  
**Status**: ✅ Production Ready  
**Validation**: ✅ 3/3 files valid
