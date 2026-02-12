# Schema Evolution

> How to change data formats safely in GreenReach Central.  
> Updated: 2026-02-11

---

## Core Rule

**56+ consumers depend on canonical data formats.** Any schema change requires:
1. Impact analysis (`SCHEMA_CONSUMERS.md`)
2. Adapter or fallback — never rename source fields
3. `npm run validate-schemas` before commit

---

## PostgreSQL Schema Changes

### Safe Operations (no downtime)

| Operation | Pattern | Example |
|-----------|---------|---------|
| Add column | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` | `ALTER TABLE grant_users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);` |
| Add index | `CREATE INDEX IF NOT EXISTS ... CONCURRENTLY` | Avoids locking the table |
| Add table | `CREATE TABLE IF NOT EXISTS` | All 011_grant_wizard.sql uses this |
| Add default | `ALTER TABLE ... ALTER COLUMN ... SET DEFAULT` | Non-locking |

### Dangerous Operations (require migration plan)

| Operation | Risk | Mitigation |
|-----------|------|-----------|
| Drop column | Consumers still reading it crash | Add deprecation period: stop writing → stop reading → drop |
| Rename column | All queries referencing old name break | Use `ALTER TABLE ... RENAME` + update all consumers in same commit |
| Change type | Implicit casts may fail | Add new column → migrate data → swap consumers → drop old |
| Drop table | Data loss | Requires explicit user approval + backup verification |

---

## JSONB Column Evolution (grant_applications)

The grant wizard stores structured data in JSONB columns:
- `organization_profile` — `{ legalName, type, craBusinessNumber, province, employeeCount }`
- `project_profile` — `{ title, description, needStatement, startDate, endDate }`
- `budget` — `{ items: [{description, amount, category}], totalAmount, otherFunding }`
- `answers` — `{ outcomes, risks, alignment }`
- `facts_ledger` — mirrors organization_profile for consistency checking

### Adding a JSONB field

Safe — consumers use `obj.newField || defaultValue` pattern:
```javascript
// Consumer reads with fallback
const sector = org.sector || 'agriculture';
```

### Renaming a JSONB field

**Never rename in-place.** Use adapter pattern:
```javascript
// Adapter: support both old and new field names
const name = org.legalName || org.businessName || org.legal_name;
```

### The Grant Wizard Field Name Contract

These field names are shared between:
1. Frontend `wizSave()` function (writes to API)
2. Backend PUT `/applications/:id` (stores to DB)
3. Backend export/PDF endpoints (reads from DB)
4. AI draft endpoint (reads org/project context)

**Changing any field name requires updating all 4 locations.**

| JSONB Column | Field Names (canonical) | Written By | Read By |
|-------------|------------------------|------------|---------|
| organization_profile | legalName, type, craBusinessNumber, province, postalCode, employeeCount | wizard step 1 | export, PDF, AI draft, eligibility |
| project_profile | title, description, needStatement, startDate, endDate | wizard step 2 | export, PDF, AI draft |
| budget | items[].description, items[].amount, items[].category, totalAmount, otherFunding | wizard step 3 | export, PDF |
| answers | outcomes, risks, alignment | wizard step 4 | export, PDF, AI draft |

---

## Elastic Beanstalk Environment Variables

Adding or changing env vars triggers an environment update (~2 min restart).

### Current Production Env Vars

| Variable | Purpose | Change Impact |
|----------|---------|---------------|
| `RDS_HOSTNAME` | Database host | Breaks everything |
| `RDS_USERNAME` / `RDS_PASSWORD` | DB credentials | Breaks everything |
| `RDS_DB_NAME` / `RDS_PORT` | DB connection | Breaks everything |
| `OPENAI_API_KEY` | AI recommendations | Disables AI pusher |
| `GRANT_OPENAI_API_KEY` | Grant AI drafting | Disables grant AI only |
| `ENABLE_GRANT_WIZARD` | Feature flag | Disables entire grant subsystem |
| `NODE_ENV` | Environment mode | Affects logging, error detail |
| `PORT` / `WS_PORT` | Server ports | Must match EB config |
| `FARM_EDGE_URL` | Foxtrot connection | Breaks farm data sync |
| `DB_ENABLED` / `DB_SSL` | DB connection flags | Breaks DB if wrong |

---

## Migration File Naming

Pattern: `migrations/NNN_description.sql`

| Number | File | Status |
|--------|------|--------|
| 001–010 | Core schema (farms, rooms, groups, etc.) | Production |
| 011 | Grant wizard (6 tables, 8 indexes) | Pending production |
| 012+ | Reserved for future features | — |

**Rule:** Never modify an existing migration file that has been run in production. Create a new numbered file instead.
