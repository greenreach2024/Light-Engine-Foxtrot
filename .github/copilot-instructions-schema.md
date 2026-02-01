# Schema Governance Instructions for GitHub Copilot Agents

## Critical Rules for Data Format Modifications

### ❌ NEVER DO THESE:

1. **Do NOT modify canonical data files to fix a single page/card**
   - ❌ Changing `groups.json` to add fields for one UI component
   - ❌ Renaming fields in `farm.json` to match a specific API response
   - ❌ Converting `trays` from number to array because one function expects array

2. **Do NOT create format variations without schema approval**
   - ❌ Adding new top-level keys to JSON files
   - ❌ Changing field types (string → number, number → array)
   - ❌ Removing required fields

3. **Do NOT bypass validation**
   - ❌ Modifying schemas to match bad data
   - ❌ Disabling `npm run validate-schemas`
   - ❌ Using `any` types to skip validation

### ✅ ALWAYS DO THESE:

1. **Check canonical format BEFORE making changes**
   ```bash
   # Read the standards document
   cat DATA_FORMAT_STANDARDS.md
   
   # Validate current data
   npm run validate-schemas
   ```

2. **Update consumers, not source data**
   ```javascript
   // WRONG - Modifying source data
   group.recipeName = group.crop; // Changes groups.json
   
   // CORRECT - Adapting in consumer
   const displayName = group.crop || group.recipe; // ✅
   ```

3. **Use adapter functions for format variations**
   ```javascript
   import { normalizeGroup, toDisplayFormat } from '../lib/data-adapters.js';
   
   const normalized = normalizeGroup(rawGroup);
   const display = toDisplayFormat(normalized);
   ```

4. **Validate after any data file changes**
   ```bash
   npm run validate-schemas
   ```

---

## Response Templates

### When asked to modify groups.json format:

```
❌ I cannot modify groups.json format to add the [FIELD] field.

REASON: groups.json is a canonical data source used by 56+ consumers across:
- Wholesale inventory sync
- Energy forecasting
- Automation scheduling
- All farm management pages

Modifying the format would break these consumers.

SOLUTION OPTIONS:
1. Update the consumer code to use existing field: [EXISTING_FIELD]
2. Add adapter in consumer layer using lib/data-adapters.js
3. If truly needed, propose schema change via DATA_FORMAT_STANDARDS.md process

Which approach would you prefer?
```

### When asked to rename a field:

```
❌ I cannot rename the [OLD_FIELD] field to [NEW_FIELD] in [FILE].

REASON: This field is used by [COUNT] consumers. See SCHEMA_CONSUMERS.md.

SOLUTION: Add fallback pattern in consumers:
```javascript
const value = object.[NEW_FIELD] || object.[OLD_FIELD];
```

This provides backward compatibility during migration period.
Would you like me to implement this fallback pattern?
```

### When format looks wrong:

```
⚠️ Warning: The data in [FILE] appears to deviate from canonical format.

Expected format (from DATA_FORMAT_STANDARDS.md):
[SHOW CANONICAL FORMAT]

Current format:
[SHOW CURRENT FORMAT]

This may have been changed by a previous agent to fix a specific issue.

OPTIONS:
1. Fix the consumer to handle canonical format (recommended)
2. Add adapter to normalize data (see lib/data-adapters.js)
3. File schema change request (if format truly needs to change)

Shall I proceed with option 1?
```

---

## Before Modifying Any Data File

**CHECKLIST**:

- [ ] Read `DATA_FORMAT_STANDARDS.md` for canonical format
- [ ] Check `SCHEMA_CONSUMERS.md` for consumer count
- [ ] Run `npm run validate-schemas` to see current state
- [ ] Consider: Can I fix the consumer instead of the data?
- [ ] Consider: Can I use an adapter from `lib/data-adapters.js`?
- [ ] If changing schema: Document in issue, get approval
- [ ] After change: Run `npm run validate-schemas` again

---

## Common Scenarios

### Scenario 1: Card needs new field

**BAD Response**:
```javascript
// Add new field to groups.json
group.myNewField = "value";
```

**GOOD Response**:
```javascript
// Compute in consumer from existing fields
const myNewField = computeFromExisting(group.crop, group.trays);

// OR use planConfig if it's configuration
const myNewField = group.planConfig?.myConfig?.value || defaultValue;
```

### Scenario 2: Field name doesn't match expectation

**BAD Response**:
```javascript
// Rename in source data
group.recipeName = group.crop;
delete group.crop;
```

**GOOD Response**:
```javascript
// Use adapter or fallback
import { normalizeGroup } from '../lib/data-adapters.js';
const normalized = normalizeGroup(group);
// Now use normalized.crop (which handles recipe fallback)
```

### Scenario 3: Type doesn't match expectation

**BAD Response**:
```javascript
// Change type in groups.json
group.trays = [1, 2, 3, 4]; // Convert number → array
```

**GOOD Response**:
```javascript
// Handle both types in consumer
const trayCount = Array.isArray(group.trays) 
  ? group.trays.length 
  : group.trays;
```

---

## Integration Examples

### Example 1: Using adapters in new feature

```javascript
// New feature: harvest-ready-report.js
import { getActiveGroups, toDisplayFormat } from '../lib/data-adapters.js';

// Load groups
const groupsData = JSON.parse(fs.readFileSync('public/data/groups.json'));

// Get active groups (normalized automatically)
const activeGroups = getActiveGroups(groupsData);

// Convert to display format
const displayGroups = activeGroups.map(toDisplayFormat);

// Now work with clean, standardized data
displayGroups.forEach(group => {
  console.log(`${group.name}: ${group.crop} (${group.age})`);
});
```

### Example 2: Adding validation to API endpoint

```javascript
// server-foxtrot.js
import { validateGroups, validateWithErrors } from './lib/schema-validator.js';

app.post('/api/groups', async (req, res) => {
  // Validate before saving
  const validation = validateWithErrors(validateGroups, req.body, 'groups');
  
  if (!validation.valid) {
    return res.status(400).json({
      error: 'Schema validation failed',
      details: validation.errors
    });
  }
  
  // Save groups.json
  fs.writeFileSync('public/data/groups.json', JSON.stringify(req.body, null, 2));
  res.json({ success: true });
});
```

---

## Emergency Overrides

**If you MUST modify schema format** (rare):

1. Document why in commit message
2. Open GitHub issue immediately with label `schema-change`
3. Run full impact analysis: `grep -r "groups\.json" .`
4. Update ALL consumers before deploying
5. Add migration guide to `MIGRATIONS.md`
6. Bump schema version in files and validator

**Example Emergency**:
```json
{
  "schemaVersion": "1.1.0",  // Bumped from 1.0.0
  "groups": [ /* ... */ ]
}
```

---

## Summary

**Core Principle**: 
> Data formats are infrastructure, not implementation details. 
> Treat them like database schemas - changes require migration plans.

**When in doubt**:
1. Check `DATA_FORMAT_STANDARDS.md`
2. Use adapters from `lib/data-adapters.js`
3. Validate with `npm run validate-schemas`
4. Fix consumers, not source data

**Remember**:
- 56+ consumers depend on groups.json format
- Format drift causes cascading bugs
- Validation catches problems before production
- Adapters provide flexibility without breaking changes
