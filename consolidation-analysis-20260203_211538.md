# Light Engine File Consolidation Analysis

**Generated**: $(date)

## Strategy
- **Edge (public/)** = Source of truth (more complete, tested in production)
- **Cloud (greenreach-central/public/)** = Check for unique improvements before archiving

---

## 1. Schema Validation (Pre-Analysis)

Running schema validation...
```

> light-engine-foxtrot@1.0.0 validate-schemas
> node scripts/validate-all-schemas.js

[34m
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[0m
[1m  Data Format Schema Validation[0m
[34m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[0m

[34m●[0m Validating [1m/Users/petergilbert/Light-Engine-Foxtrot/public/data/groups.json[0m...
  [31m✗[0m Validation failed:
    [31m→[0m /groups/0/id: must match pattern "^[^:]+:[^:]+:.+$"
    [31m→[0m /groups/1/id: must match pattern "^[^:]+:[^:]+:.+$"
    [31m→[0m /groups/2/id: must match pattern "^[^:]+:[^:]+:.+$"
    [31m→[0m /groups/3/id: must match pattern "^[^:]+:[^:]+:.+$"
    [31m→[0m /groups/4/id: must match pattern "^[^:]+:[^:]+:.+$"
    [31m→[0m /groups/5/id: must match pattern "^[^:]+:[^:]+:.+$"
    [31m→[0m /groups/6/id: must match pattern "^[^:]+:[^:]+:.+$"
    [31m→[0m /groups/7/id: must match pattern "^[^:]+:[^:]+:.+$"

[34m●[0m Validating [1m/Users/petergilbert/Light-Engine-Foxtrot/public/data/farm.json[0m...
  [32m✓[0m Valid farm format

[34m●[0m Validating [1m/Users/petergilbert/Light-Engine-Foxtrot/public/data/rooms.json[0m...
  [32m✓[0m Valid rooms format
  [33m⚠[0m Warning: No schemaVersion field
[34m
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[0m
[1m  Validation Summary[0m
[34m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[0m
  [32m✓[0m Valid:   2
  [31m✗[0m Invalid: 1
  [31m✗[0m Errors:  0
  [33m⚠[0m Skipped: 0
[31m
✗ Schema validation failed
[0m
See DATA_FORMAT_STANDARDS.md for canonical formats
Schema validation not configured
```

---

## 2. Identical Files (Safe to Use Edge Version)

