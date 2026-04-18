# 06 — Research Platform Playbook

**Owner:** Research-tier farms + PIs; agent-supported by G.W.E.N.
**Canonical reference:** `.github/RESEARCH_PLATFORM_AUDIT.md` (March 28, 2026 audit — 82/100)
**Related docs:** `greenreach-central/routes/gwen-research-agent.js`, `greenreach-central/routes/research-*.js`, Playbook 01 (security), Playbook 02 (agents)

---

## 1. Purpose & scope

The research platform turns every participating Light Engine into a real-world controlled experiment, while keeping each farm's business data private. It supports studies, electronic lab notebooks (ELN), grants, HQP (Highly Qualified Personnel) management, equity, diversity, and inclusion tracking (EDI), and strict governance of who can see what. This playbook is mandatory reading before adding research tables, endpoints, G.W.E.N. tools, or governance primitives.

## 2. The four phases

| Phase | Scope | Status |
|---|---|---|
| **Phase 1** — Foundation | Studies, datasets, recipes, ELN, metadata registry, data dictionary | Live |
| **Phase 2** — Grants | Grant applications, budgets, milestones, reports, publications, HQP, EDI | Live |
| **Phase 3** — Recipe Version Control & Comparison | Recipe DAG, A/B comparisons, environmental diff, outcome diff | Live (instrumented, awaiting broader adoption) |
| **Phase 4** — G.W.E.N. research assistant | Gemini 2.5 Pro in research bubble | Live (research-scope-locked) |

## 3. Audience roles (ORCID-linked)

| Role | Description |
|---|---|
| PI | Principal Investigator — approves studies, grants, publications |
| Co-PI | Shared investigator authority |
| Postdoc | Senior research contributor |
| Grad Student | Research contributor; often HQP |
| Technician | Operator-level research access |
| Collaborator | External partner under a data-sharing agreement |
| Viewer | Read-only research access |

All roles stored in `research_roles` table, ORCID link in `research_users.orcid_id` for authorship + audit.

## 4. Data model (top-level tables)

### 4.1 Phase 1 (Foundation)
- `studies` — hypotheses, protocols, IRB/ethics notes
- `datasets` — manifests for raw + derived data
- `recipe_versions` — versioned light/nutrient/environment recipes
- `eln_entries` — lab notebook entries (immutable after signoff)
- `metadata_registry` — schema definitions for datasets
- `data_dictionary_entries` — field-level semantics

### 4.2 Phase 2 (Grants / HQP / EDI)
- `grant_applications` — applications, timelines, budgets
- `grant_budgets`, `grant_milestones`, `grant_reports`
- `grant_publications` — tied to ORCID authorship
- `grant_hqp` — trainees and funded HQP records
- `grant_hqp_funding`, `grant_hqp_training`
- `research_edi` — demographics, accessibility, reporting

### 4.3 Phase 3 (Recipe VCS)
- `recipe_version_parents` — DAG of versions
- `recipe_comparisons` — stored A/B comparisons
- `recipe_outcomes` — outcome metrics tied to studies

### 4.4 Governance layer
- `research_partners` — institutions, agreements, consortia
- `research_sharing_agreements` — who can see what, under what terms
- `research_audit_events` — immutable audit trail
- `research_coi_declarations` — Conflict Of Interest disclosures
- `research_signoffs` — stage gates (study → data collection → analysis → publication)
- `research_approval_chains` — approval workflows per artifact class
- `research_contributions` — contribution metadata for authorship/credit

All research tables are **tenant-scoped by `farm_id`** and RLS-protected by `gr_tenant_isolation`.

## 5. G.W.E.N. (research agent)

**File:** `greenreach-central/routes/gwen-research-agent.js` (~6,352 lines)
**LLM:** Gemini 2.5 Pro (Vertex AI)
**Scope:** Research bubble only. Refuses out-of-bubble actions; escalates to F.A.Y.E.

### 5.1 Capabilities
- Recipe comparison + recommendation
- Study design assistance
- Grant proposal drafting
- Literature summarization
- Statistical summary (via `execute_code` when enabled)
- ELN entry drafting (always requires human signoff)

### 5.2 Tool loop
- `MAX_TOOL_LOOPS = 12` (higher than most agents due to multi-step research workflows)
- Tools imported from Farm-Ops `executeTool` for audit + farm isolation
- `execute_code` is **feature-flagged** (`GWEN_EXECUTE_CODE_ENABLED`); default off in production

### 5.3 Guardrails
- System prompt pins G.W.E.N. to research scope
- Requests to publish content to public channels → refused (S.C.O.T.T.'s domain)
- Requests to change farm inventory / prices → refused (Farm-Ops domain)
- Low-confidence answers must surface uncertainty, not fabricate

## 6. Key API routes

| Mount | File | Purpose |
|---|---|---|
| `/api/research/studies` | `research-studies.js` | Study CRUD |
| `/api/research/eln` | `research-eln.js` | ELN entries |
| `/api/research/datasets` | `research-datasets.js` | Dataset manifests |
| `/api/research/recipes` | `research-recipes-v2.js` | Recipe versions + comparisons |
| `/api/research/grants` | `research-grants.js` | Grant applications + budgets + milestones + reports + publications + HQP |
| `/api/research/metadata` | `research-metadata.js` | Metadata registry + data dictionary |
| `/api/research/partners` | `research-partners.js` | Partner institutions |
| `/api/research/security` | `research-security.js` | Access policies, incident log |
| `/api/research/audit` | `research-audit.js` | Audit events, COI, signoffs, approval chains, contributions |
| `/api/gwen` | `gwen-research-agent.js` | G.W.E.N. chat, status, workspace |

## 7. Security & tenancy rules

### 7.1 Critical fail-closed rule (post C2 remediation)
Every research sub-resource endpoint MUST verify parent ownership:

```js
// Example for a budget scoped to a grant
const grant = await query(
  'SELECT farm_id FROM grant_applications WHERE id = $1',
  [grantId],
  { farmId: req.farmId }
);
if (!grant.rows.length) return res.status(404).json({ error: 'not found' });
// Proceed with budget query
```

Before remediation, **62 of 84** research endpoints skipped this check. All are now patched via `middleware/research-tenant.js` (`requireResearchOwnership`).

### 7.2 Cross-institution sharing
- Sharing requires a row in `research_sharing_agreements`
- Agreement scope is machine-readable (datasets, fields, aggregation level, expiry)
- Export endpoints enforce agreement terms at query time

### 7.3 Role gating
- Writes to signed-off ELN entries: forbidden (immutable)
- Grant application submission: PI or Co-PI only
- Publications: require ORCID-authenticated contribution records
- Dataset exports: require matching sharing agreement

### 7.4 Feature gating
Research features are tier-locked (`research` tier). Farms without the tier should see the Research page disabled.

**Known gap:** feature gate is fail-open on DB outage (see Playbook 01 §8). Close before activating paid research tier externally.

## 8. Data classification (recap)

- **Farm-private** (never shared, even within research): financials, customers, wholesale orders
- **Operational** (sharable under agreement): schedules, recipes, tray outcomes
- **Research-shared** (governed): environmental telemetry, anonymized outcomes, published datasets
- **Open** (fully public): grant publications, open-dataset manifests, methodology summaries

## 9. Workflows

### 9.1 Start a study
```
PI opens Research Workspace → POST /api/research/studies
  ↓ creates study row, writes audit event
  ↓ assigns roles (research_roles), COI declarations (research_coi_declarations)
  ↓ defines datasets (research_datasets) + metadata (metadata_registry)
  ↓ defines recipe version to test
  ↓ approval chain starts (research_approval_chains)
G.W.E.N. can assist drafting protocol / literature sections
```

### 9.2 Run experiment
```
Farm operates as usual → Farm-Ops + automation records outcomes
  ↓ tray_runs, harvest_events, environmental telemetry accumulate
  ↓ ELN entries created per ops shift (POST /api/research/eln)
  ↓ Outcomes attached to study via recipe_outcomes
```

### 9.3 Publish
```
PI finalizes results → POST /api/research/grants/publications
  ↓ authorship via research_contributions (ORCID-linked)
  ↓ dataset export via signed sharing agreement
  ↓ signoffs recorded in research_signoffs
  ↓ immutable audit in research_audit_events
```

## 10. Configuration

| Env var | Purpose |
|---|---|
| Vertex AI via ADC | Gemini 2.5 Pro for G.W.E.N. |
| `GWEN_EXECUTE_CODE_ENABLED` | Enables G.W.E.N. Python/R sandbox |
| `RESEARCH_TIER_FEATURE_FLAG` | Global kill switch for research surface |

## 11. Never do

- Skip `requireResearchOwnership` on sub-resource endpoints (regression would reopen C2)
- Allow G.W.E.N. to publish to public marketing channels
- Export datasets without a matching `research_sharing_agreements` row
- Mutate signed-off ELN entries
- Bypass RLS "just for reporting"
- Mix farm financial data into research exports
- Mark a study complete without signoffs

## 12. Known gaps / open items (from March 2026 audit)

- RLS Phase B (FORCE) not yet applied to research tables
- Feature gate fail-open on DB outage
- G.W.E.N. `execute_code` sandbox requires per-farm opt-in
- Partner data-sharing agreements need UI parity (DB schema is complete; admin UI sparse)
- Publication metrics (citations, impact) fetched manually; no automated service yet
- Research audit events lack retention policy; will grow unbounded without archival

## 13. References

- `.github/RESEARCH_PLATFORM_AUDIT.md` (March 28, 2026)
- `.github/COMPLETE_SYSTEM_MAP.md` §5.6 Research Platform; §6.8 Research workflow
- `greenreach-central/routes/gwen-research-agent.js`
- `greenreach-central/routes/research-*.js` (all)
- `greenreach-central/middleware/research-tenant.js`
- Playbook 01 (security & tenancy), Playbook 02 (agents)
