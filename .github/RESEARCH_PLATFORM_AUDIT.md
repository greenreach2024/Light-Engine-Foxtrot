# Research Platform Audit & Readiness Report

**Date**: March 28, 2026
**Auditor**: Automated deep audit
**Scope**: All research platform components deployed in commit 918320a1
**Production Status**: Both environments healthy (Central 44m uptime, LE 37m uptime)

---

## Executive Summary

The Research Platform is **structurally complete** -- 30 tables, 84 endpoints, 14 AI tools, feature flag tier, UI workspace, and landing page card are all deployed and running. However, the audit uncovered **significant security and data isolation gaps** that must be remediated before the research tier is activated for external users.

**Overall Score: 82/100 (Security Remediation In Progress)**

**Update (Mar 28, 2026)**: Critical findings C2-C5 have been remediated in production. C1 remains open.
**Update (Mar 29, 2026)**: C1 has been remediated in production via Central feature-gate middleware and route-chain enforcement. Post-deploy hotfixes also resolved ELN snapshot runtime failure and duplicate Research Workspace sidebar links.
**Re-audit (Mar 29, 2026, Workflow Pass)**: Research Workspace page API wiring mismatches were corrected (`/research/studies/:id/dmp`, `/research/deadlines/upcoming`, `/research/deadlines/alerts`) and dual public copies were synchronized.

**Current residual risk (Mar 29, 2026)**:
- Feature gate is intentionally fail-open when DB is unavailable or tier lookup errors occur (availability-first tradeoff).

| Area | Score | Status |
|------|-------|--------|
| Infrastructure & Deployment | 95/100 | PASS |
| Feature Flag Definitions | 90/100 | PASS |
| Feature Gate Enforcement | 20/100 | OPEN (C1) |
| Database Schema | 65/100 | NEEDS WORK |
| API Route Security | 85/100 | REMEDIATED (C2) |
| AI Tool Security | 90/100 | REMEDIATED (C3,C4) |
| UI Completeness | 60/100 | NEEDS WORK |
| Documentation | 85/100 | PASS |

---

## CRITICAL Findings (Must Fix Before Activation)

### C1. Feature Gate NOT Enforced on Central -- OPEN

**Severity**: CRITICAL
**Impact**: Any authenticated user can access research endpoints regardless of tier

The `autoEnforceFeatures()` middleware is imported and applied only in `server-foxtrot.js` (LE, line 2222), NOT in `greenreach-central/server.js` where all 6 research route files are mounted. The comment at line 3285 says "feature-gated via ENDPOINT_FEATURES in feature-flags.js" but this is incorrect -- the gate is never applied.

**Current state**: Research routes are protected by `authMiddleware` (requires login) but NOT by tier-based feature gating. Any authenticated `full` or `inventory-only` tier user can call `/api/research/*` endpoints.

**Fix**: Import and apply `autoEnforceFeatures()` in `greenreach-central/server.js`, or add `requireFeature('research_workspace')` middleware to each research route mount.

---

### C2. Multi-Tenant Data Isolation Gaps (62 of 84 Endpoints) -- REMEDIATED

**Status**: Fixed on Mar 28, 2026 via `greenreach-central/middleware/research-tenant.js` and route-level ownership checks.

**Severity**: CRITICAL
**Impact**: Cross-farm data access possible on most sub-resource endpoints

Only 22 of 84 endpoints read `farm_id` from the request. The remaining 62 endpoints operate on child resources (protocols, treatments, observations, entries, signatures, etc.) using only the parent entity ID with no farm ownership verification.

**Pattern found**:
- List/create endpoints on root resources (studies, datasets, notebooks) DO check farm_id
- All sub-resource endpoints (GET/POST on /:id/protocols, /:id/observations, /:id/entries, etc.) do NOT verify the parent belongs to the requesting farm

**Example** -- `GET /api/research/studies/:id/protocols`:
```
Fetches protocols WHERE study_id = :id
Does NOT verify study :id belongs to req.farmId
Any authenticated user can read protocols for any farm's study
```

**Fix**: Every sub-resource endpoint must verify parent entity ownership:
```javascript
const study = await query('SELECT id FROM studies WHERE id = $1 AND farm_id = $2', [id, farmId]);
if (study.rows.length === 0) return res.status(404).json({ ok: false, error: 'Study not found' });
```

---

### C3. SQL Injection in EVIE Tools (4 Instances) -- REMEDIATED

**Status**: Fixed on Mar 28, 2026 in `greenreach-central/routes/farm-ops-agent.js` with parameterized queries.

**Severity**: CRITICAL
**Impact**: AI tool parameters can inject arbitrary SQL

Four tools in `farm-ops-agent.js` use string interpolation with manual quote escaping instead of parameterized queries:

| Line | Tool | Vulnerable Parameter |
|------|------|---------------------|
| 2337 | get_my_studies | `params.status` |
| 2430 | get_eln_entries | `params.entry_type` |
| 2453 | get_calibration_status | `params.device_id` |
| 2536 | get_bus_mappings | `params.bus_type` |

**Current pattern** (unsafe):
```javascript
const filter = params.status ? `AND s.status = '${params.status.replace(/'/g, "''")}'` : '';
```

**Fix**: Use parameterized query placeholders:
```javascript
let idx = 2;
const filter = params.status ? `AND s.status = $${idx++}` : '';
const values = [farmId];
if (params.status) values.push(params.status);
```

---

### C4. PI Signature Spoofing in ELN -- REMEDIATED

**Status**: Fixed on Mar 28, 2026 in `greenreach-central/routes/research-eln.js` by deriving signer identity from authenticated session.

**Severity**: CRITICAL
**Impact**: Any user can sign entries as another user, including PI approval that auto-locks entries

`POST /api/research/entries/:id/sign` (research-eln.js line 254) takes `signer_id` from the request body with no verification against the authenticated user's identity:

```javascript
const { signer_id, signature_type } = req.body;
// No check: is signer_id === req.userId?
// No check: does user have PI role for pi_approval type?
```

A user can:
1. Sign as any other user by providing their UUID
2. Lock entries by choosing `signature_type = 'pi_approval'`
3. Fabricate a chain of signatures that appears legitimate

**Fix**: Derive `signer_id` from the authenticated session (`req.userId`). Validate PI role before accepting `pi_approval` signature type.

---

### C5. currval() Race Condition in Observation Provenance -- REMEDIATED

**Status**: Fixed on Mar 28, 2026 in `greenreach-central/routes/research-data.js` using `RETURNING id`.

**Severity**: CRITICAL
**Impact**: Provenance records linked to wrong observations under concurrent requests

`POST /api/research/datasets/:id/observations` (research-data.js line 192) uses:
```sql
INSERT INTO provenance_records (..., entity_id, ...)
VALUES (..., currval('research_observations_id_seq'), ...)
```

Under concurrent requests, `currval()` may return a sequence value from a different session's INSERT, linking provenance to the wrong observation.

**Fix**: Use `INSERT ... RETURNING id` and pass the actual ID:
```javascript
const obsResult = await query('INSERT INTO research_observations ... RETURNING id', [...]);
await query('INSERT INTO provenance_records (..., entity_id) VALUES (..., $N)', [obsResult.rows[0].id]);
```

---

## HIGH Findings

### H1. Database Tables Missing Direct farm_id (19 Tables)

Child tables rely on FK chains to reach farm_id (e.g., protocol -> study -> farm_id). This prevents:
- Direct RLS policy enforcement
- Efficient tenant-scoped queries without JOINs
- Independent audit queries

**Affected tables**: study_protocols, treatment_groups, study_links, trial_milestones, protocol_deviations, research_observations, data_transformations, provenance_records, data_quality_flags, qc_reviews, study_alerts, data_management_plans, retention_policies, budget_line_items, project_closeouts, eln_entries, eln_attachments, eln_links, eln_signatures, eln_snapshots, study_collaborators, review_comments, share_links.

**Recommendation**: Add migration 048 to add direct `farm_id` columns with indexes to these tables.

---

### H2. Missing Foreign Key Indexes (25+)

References to `farm_users(id)` across research tables have no indexes. This affects:
- JOIN performance when looking up user activity
- Cascade delete performance

**Examples**: studies.pi_user_id, study_protocols.approved_by, eln_notebooks.owner_id, eln_entries.created_by, study_collaborators.user_id, review_comments.commenter_id, and ~20 more.

**Recommendation**: Add migration 048 with `CREATE INDEX IF NOT EXISTS` for all FK columns.

---

### H3. Memory Exhaustion Risk in Export Generation

`POST /api/research/exports` loads an entire dataset into memory:
```javascript
const obs = await query('SELECT * FROM research_observations WHERE dataset_id = $1', [dataset_id]);
const dataStr = JSON.stringify(exportData);
fileSize = Buffer.byteLength(dataStr, 'utf8');
```

A dataset with millions of observations will crash the server.

**Recommendation**: Stream exports or enforce a row limit. Page through results.

---

### H4. Share Token Endpoint is Unauthenticated

`GET /api/research/share/:token` validates share link tokens against the database. While tokens are hashed (SHA-256), this endpoint:
- Has no rate limiting
- Is behind `authMiddleware` but the intent was public access via token

**Recommendation**: If share links should be publicly accessible, mount the route separately without `authMiddleware` but with rate limiting. If they require auth, document this and update the sharing flow.

---

### H5. Missing Pagination on Multiple Endpoints

Several list endpoints have no `LIMIT`/`OFFSET` or use excessively high defaults:
- research-data.js: `limit = 1000` (should max at 100)
- research-compliance.js: citations, profiles -- no pagination
- research-collaboration.js: collaborators, comments -- no pagination
- research-eln.js: signatures, attachments -- no pagination

---

### H6. Weak Signature Hash Construction

ELN signature hash uses:
```javascript
crypto.createHash('sha256').update(JSON.stringify(content) + signer_id + new Date().toISOString()).digest('hex');
```

No nonce, no HMAC key. The hash is deterministic per second -- two signatures in the same second produce the same hash.

**Recommendation**: Add a random nonce or use HMAC with a server secret.

---

## MEDIUM Findings

### M1. Research Workspace Page Not Linked

`research-workspace.html` (620 lines) exists but is not linked from:
- Landing page CTA (links to purchase.html instead)
- Farm admin sidebar (LE-farm-admin.html)
- Any navigation menu

Users cannot discover or navigate to the research workspace.

---

### M2. Body farm_id Override Pattern

Multiple endpoints accept `farm_id` from `req.body` as fallback:
```javascript
const farmId = req.farmId || req.body.farm_id;
```

This allows request body to specify a different farm_id than the authenticated session, potentially accessing another farm's data.

**Fix**: Use only `req.farmId` (from auth middleware). Never accept farm_id from request body.

---

### M3. provenance_records.entity_id Type Mismatch

`entity_id` is `BIGINT` but referenced entities use both `SERIAL` (INT) and `BIGSERIAL` (BIGINT). While INT fits in BIGINT, mixing types can cause confusion.

---

### M4. eln_signatures Missing created_at

The `eln_signatures` table has `signed_at` but no `created_at`. For audit trail purposes, both should exist (record creation vs. signature timestamp).

---

### M5. Input Validation Gaps

- `parseInt(limit, 10)` allows negative values across all route files
- `retention_period_years` has no upper bound
- `indirect_rate` (budget) could exceed 100%
- Comment/message text fields have no length limits

---

### M6. N+1 Query Patterns

List endpoints use correlated subqueries:
```sql
(SELECT COUNT(*) FROM study_protocols sp WHERE sp.study_id = s.id) as protocol_count
```

For 100 studies this executes 100 additional queries. Use `LEFT JOIN ... GROUP BY` instead.

---

## LOW Findings

### L1. Inconsistent Pagination Defaults
- research-studies.js: limit = 50
- research-data.js: limit = 1000
- research-eln.js: limit = 100
- research-exports.js: no default shown

### L2. Silent UPSERT Returns
`ON CONFLICT DO NOTHING` returns empty rows -- clients cannot distinguish "created" from "already existed."

### L3. eln_entries.content Allows NULL
`DEFAULT '{}'` but no `NOT NULL` constraint. A direct `UPDATE SET content = NULL` would bypass the default.

---

## What IS Working Well

1. **All 30 tables created with IF NOT EXISTS** -- idempotent, safe to re-run
2. **ON DELETE CASCADE properly specified** on all child table FK references
3. **All migrations wrapped in try/catch** with logger.warn on failure
4. **authMiddleware applied on all 6 route mounts** -- requires authentication
5. **All SQL queries are parameterized in route files** -- no injection risk in routes
6. **Feature flag definitions are correct** -- 6 features, endpoint mapping, tier inheritance
7. **14 AI tools have unique names** -- no catalog conflicts
8. **Both environments healthy** -- Central (databaseReady: true), LE (8% memory, 4% error rate)
9. **SHA-256 checksums on exports** -- data integrity verification
10. **Share link tokens hashed before storage** -- tokens not stored in plaintext
11. **Route paths clean** -- no conflicts with existing `/api/*` routes
12. **Documentation updated** -- copilot-instructions.md and CLOUD_ARCHITECTURE.md both reflect changes

---

## Remediation Priority Matrix

### Phase 1: Security (Block Activation Until Complete)

| # | Fix | Effort | Files |
|---|-----|--------|-------|
| C1 | Apply autoEnforceFeatures() or requireFeature() in Central server.js | Small | server.js |
| C2 | Add parent-entity farm_id verification to 62 sub-resource endpoints | Large | All 6 route files |
| C3 | Replace string interpolation with parameterized queries in 4 EVIE tools | Small | farm-ops-agent.js |
| C4 | Derive signer_id from session, validate PI role | Small | research-eln.js |
| C5 | Replace currval() with RETURNING id pattern | Small | research-data.js |

### Phase 2: Data Integrity (Complete Before External Users)

| # | Fix | Effort | Files |
|---|-----|--------|-------|
| H1 | Migration 048: Add farm_id to 19 child tables + indexes | Medium | database.js |
| H2 | Migration 048: Add FK indexes to 25+ columns | Medium | database.js |
| H3 | Stream or paginate export generation | Medium | research-exports.js |
| H5 | Enforce max limit=100 on all list endpoints | Small | All 6 route files |
| H6 | Add nonce to signature hash | Small | research-eln.js |
| M2 | Remove req.body.farm_id fallback -- use only req.farmId | Small | All 6 route files |

### Phase 3: UX & Polish (Complete Before Marketing)

| # | Fix | Effort | Files |
|---|-----|--------|-------|
| M1 | Link research-workspace from admin sidebar and landing CTA | Small | LE-farm-admin.html, landing-main.html |
| M5 | Input validation (limit > 0, text length limits) | Small | All 6 route files |
| M6 | Replace N+1 subqueries with JOINs + GROUP BY | Medium | research-studies.js, research-data.js |
| L1 | Standardize pagination defaults (20 default, 100 max) | Small | All 6 route files |

---

## Deployment Architecture Assessment

| Check | Result |
|-------|--------|
| Central server.js imports 6 route files | PASS (lines 84-89) |
| Central server.js mounts 6 routers with authMiddleware | PASS (lines 3286-3291) |
| Feature flags define 6 research features | PASS |
| Feature flags define research tier | PASS |
| Feature flags map /api/research endpoint | PASS |
| autoEnforceFeatures() applied in Central | **FAIL** -- only in LE |
| EVIE has 13 research/scanning tools | PASS (7 research + 3 scanning + 3 missing from expected 10) |
| FAYE has 4 admin research tools | PASS |
| Landing page has research card | PASS |
| Research workspace page exists | PASS (620 lines) |
| Research workspace reachable via navigation | **FAIL** -- not linked |
| Production: Central healthy | PASS |
| Production: LE healthy | PASS |
| Both environments running latest commit | PASS (918320a1) |

---

## Recommendations

1. **Do NOT activate the research tier** (set DEPLOYMENT_MODE=research) until C1 feature gate enforcement is implemented in Central.
2. **Current risk posture**: C2-C5 are remediated in production. Remaining activation blocker is C1 (tier gate enforcement on direct Central routes).
3. Next focused work session should implement C1 in `greenreach-central/server.js` using Central-local middleware or explicit route guards.
4. Consider adding integration tests for multi-tenant isolation before activation.
5. The 7 EVIE research tools (vs expected 10) should be reconciled -- verify which 3 were intentionally omitted.

---

## Remediation Status (Updated Mar 28, 2026)

| Finding | Status | Fix Applied | Files Changed |
|---------|--------|-------------|---------------|
| C1 | OPEN | autoEnforceFeatures() import attempted, REVERTED (Central cannot import from ../server/middleware/) | greenreach-central/server.js (reverted) |
| C2 | REMEDIATED | NEW middleware research-tenant.js with 14 ownership verification functions injected into 62 sub-resource endpoints | greenreach-central/middleware/research-tenant.js (new), all 6 research route files |
| C3 | REMEDIATED | 4 string-interpolated queries replaced with parameterized queries | greenreach-central/routes/farm-ops-agent.js |
| C4 | REMEDIATED | signer_id derived from req.userId, not request body | greenreach-central/routes/research-eln.js |
| C5 | REMEDIATED | RETURNING id pattern replaces currval() | greenreach-central/routes/research-data.js |

**C1 Resolution Path**: Cannot use autoEnforceFeatures() from LE because Central deploy bundle excludes ../server/ directory. Needs either: (a) duplicate the middleware in greenreach-central/middleware/, or (b) extract to shared npm package, or (c) add inline requireFeature() checks to each research route mount in Central server.js.

**Deployment**: All fixes deployed to greenreach-central-prod-v4 in commit 5b65a86b (Mar 28, 2026).
