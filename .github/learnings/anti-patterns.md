# Anti-Patterns

> Approaches that consistently fail or cause problems. Avoid these.  
> Updated: 2026-02-11

---

## 1. Frontend/Backend Field Name Mismatch

**What happened:** AI Draft feature — frontend sent `{ currentDraft }` but backend expected `{ userInput }`. Frontend read `data.data?.draft` but backend returned `data.data?.draftText`. Feature silently failed with no visible error.  
**Root cause:** Backend and frontend written in separate passes without an interface contract.  
**Fix:** Always define the request/response shape once and reference it from both sides. At minimum, test the round-trip with `curl` before marking done.  
**Detection:** Would have been caught by a single `curl -X POST` test during development.

---

## 2. PDF Referencing Non-Existent Field Names

**What happened:** PDF export referenced `proj.projectTitle`, `proj.crops`, `org.organizationType` — none of which exist in the wizard's actual data model (which uses `proj.title`, `proj.description`, `org.type`).  
**Root cause:** PDF endpoint was written based on assumed field names, not the actual schema the wizard frontend produces.  
**Fix:** Read the autosave payload structure (`wizSave()`) before writing consumers that read the same JSONB.  
**Rule:** Any code that reads `organization_profile`, `project_profile`, or `budget` from `grant_applications` must use the field names defined in the wizard's `wizSave()` function.

---

## 3. Deploying from Repo Root Instead of Subdirectory

**What happened:** `eb deploy` from project root included Foxtrot server files + Python files + hundreds of docs, exceeding zip size and including wrong `package.json`.  
**Root cause:** Elastic Beanstalk zips the current directory. The EB app only needs `greenreach-central/`.  
**Fix:** Always `cd greenreach-central` before `eb deploy`.  
**Rule:** EB deploy commands must start with `cd /path/to/greenreach-central &&`.

---

## 4. Modifying Source Data Formats to Fix One Consumer

**What happened (historical):** Agents renamed fields in `groups.json` to fix a single card view, breaking 56+ other consumers.  
**Root cause:** Agent didn't check `SCHEMA_CONSUMERS.md` or run `npm run validate-schemas`.  
**Fix:** Use adapters from `lib/data-adapters.js` or add fallback patterns (`group.crop || group.recipe`).  
**Rule:** NEVER rename fields in canonical data files. Fix the consumer, not the source.

---

## 5. Adding UI Buttons Without Backend Integration

**What happened:** "Check My Eligibility" button was specified in the report but never wired. Eligibility endpoint existed, export/PDF endpoints existed, but no frontend buttons called them. Feature was invisible to users.  
**Root cause:** Backend built first, frontend built second, with no checklist mapping endpoints to UI triggers.  
**Fix:** For every API endpoint, there must be a corresponding UI element that invokes it, or a clear reason it's API-only.

---

## 6. Hardcoded Secrets or Keys in Code

**What happened:** Not in this project (avoided), but a common failure mode.  
**Pattern to avoid:** Embedding API keys, database passwords, or JWT secrets directly in source files.  
**Correct pattern:** `process.env.GRANT_OPENAI_API_KEY` with EB environment variables. `JWT_SECRET` from env with a fallback that logs a warning.

---

## 7. Writing Features Without Reading copilot-instructions.md

**What happened (historical):** Agents made production deployments without user approval, violating the mandatory deployment gate.  
**Rule:** Every agent session must read `.github/copilot-instructions.md` first. The deployment approval gate is non-negotiable: propose → validate → **STOP** → wait for "APPROVED FOR DEPLOYMENT" → deploy.

---

## 8. Over-Broad SQL Queries Without Index Coverage

**What happened:** Not yet a problem in grant wizard (indexes exist), but a known risk as tables grow.  
**Anti-pattern:** `SELECT * FROM grant_applications` without `WHERE user_id = $1` — scans all users' data.  
**Rule:** Every query on `grant_applications` must include `user_id` in the WHERE clause. The `idx_grant_applications_user` index exists for this reason.

---

## 9. Async Feature Creep Without Tracking

**What happened:** During grant wizard build, scope grew from "6-step wizard" to include AI drafting, PDF export, eligibility triage, consistency checker, cash-flow warnings, equity display, enriched export pack — all in one conversation.  
**Risk:** Half-implemented features, bugs from context loss between turns.  
**Fix:** Use `manage_todo_list` to track every feature. Mark in-progress/complete as you go. Never start a new feature until the current one is verified working.
