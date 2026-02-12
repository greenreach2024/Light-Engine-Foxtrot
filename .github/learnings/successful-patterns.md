# Successful Patterns

> Approaches that consistently work well across project work.  
> Updated: 2026-02-11

---

## 1. Feature-Flag-Then-Enable (Grant Wizard Pattern)

**Context:** New subsystem (grant wizard) with migration, routes, service, and frontend.  
**Pattern:** Mount behind `process.env.ENABLE_GRANT_WIZARD !== 'false'` so it's enabled by default but can be disabled without a deploy.  
**Why it works:** Allows deploying code to production before the migration runs. If something breaks, set `ENABLE_GRANT_WIZARD=false` in EB env vars — instant rollback without redeploying.  
**Used in:** `server.js` lines 35–46 (dynamic import + conditional mount).

---

## 2. Dedicated API Keys per Subsystem

**Context:** Grant wizard needed OpenAI for AI drafting; existing AI pusher already uses a shared key.  
**Pattern:** `const key = process.env.GRANT_OPENAI_API_KEY || process.env.OPENAI_API_KEY` — dedicated key with fallback.  
**Why it works:** Billing isolation, independent rate limits, easy revocation without breaking the other service.  
**Used in:** `routes/grant-wizard.js` lines 27–36.

---

## 3. Facts Ledger + Consistency Checker

**Context:** Grant applications reuse the same facts (business name, province, CRA BN) across multiple steps.  
**Pattern:** Store a canonical `facts_ledger` JSONB alongside per-step data. On autosave, compare incoming facts against stored facts and surface change warnings.  
**Why it works:** Prevents inconsistencies across a long multi-step form. User explicitly confirms when cascading changes happen.  
**Used in:** `routes/grant-wizard.js` PUT `/applications/:id`, `grant-wizard.html` `wizSave()`.

---

## 4. Idempotent Migrations with IF NOT EXISTS

**Context:** Schema migrations that may run multiple times (EB redeploy, manual re-run).  
**Pattern:** `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` everywhere.  
**Why it works:** Safe to re-run on production. No "already exists" errors. No migration state tracking needed for simple schemas.  
**Used in:** `migrations/011_grant_wizard.sql`.

---

## 5. Export Pack Model (Not Direct Submission)

**Context:** Government grant portals have session timeouts, unique field formats, and mandatory portal-only submission.  
**Pattern:** Generate a structured "draft pack" (answers document, budget cross-check, checklist, citations, disclosure) that the user copy/pastes into the official portal.  
**Why it works:** Avoids trying to automate unreliable government portals. Reduces "lost work" risk. Pack doubles as a review artifact.  
**Used in:** `routes/grant-wizard.js` POST `/applications/:id/export`, GET `/applications/:id/export/pdf`.

---

## 6. Seed Data as Code (Program Registry)

**Context:** 10 AAFC programs with structured eligibility rules, priority lexicons, and evidence snippets.  
**Pattern:** `SEED_PROGRAMS` array in service file → `seedGrantPrograms(pool)` with `ON CONFLICT DO UPDATE` upserts.  
**Why it works:** Programs are version-controlled, reviewable in PRs, automatically refreshed on deploy. Weekly change detection catches intake status changes from live pages.  
**Used in:** `services/grantProgramRegistry.js`.

---

## 7. Node Module Syntax-Check Before Deploy

**Context:** Large route files (1200+ lines) where typos can crash production.  
**Pattern:** `node -e "import('./routes/grant-wizard.js').then(() => console.log('OK'))"` before committing.  
**Why it works:** Catches import errors, missing dependencies, and syntax issues in seconds. Much faster than starting the full server.  
**Used in:** Pre-deploy validation workflow.

---

## 8. Autosave with Debounced Timer + Visual Indicator

**Context:** Grant wizard has 6 steps with many text fields; users may lose work.  
**Pattern:** `onchange="wizAutoSave()"` → 1500ms debounce → PUT to `/applications/:id` → "Saved ✓" indicator.  
**Why it works:** Users never lose more than a few seconds of work. Reduces anxiety in a high-stakes form. Saves bandwidth vs. keystroke-level saving.  
**Used in:** `grant-wizard.html` `wizAutoSave()` / `wizSave()`.

---

## 9. Separate Consent Checkboxes (CASL Compliance)

**Context:** Canadian Anti-Spam Law requires explicit, separate consent for different types of communication.  
**Pattern:** Three distinct checkboxes at registration: service emails (required), marketing (optional), data improvement (optional). Each stored as a separate boolean with `consent_obtained_at` timestamp and `consent_method`.  
**Why it works:** Audit-friendly. Unsubscribe affects only marketing, not service communications. De-identified analytics only happen when user explicitly consented.  
**Used in:** `grant_users` table, `routes/grant-wizard.js` POST `/register`.

---

## 10. Retention Tied to Activity, Not Creation

**Context:** Original spec said 60-day retention from creation, which penalizes slow workers.  
**Pattern:** Retention = 6 months from `last_login_at`, not `created_at`. Every login extends all active application expiry dates.  
**Why it works:** Active users never lose data. Abandoned accounts auto-expire. Aligns with PIPEDA "only as long as necessary" principle.  
**Used in:** `routes/grant-wizard.js` POST `/login`, `cleanupExpiredApplications()`.
