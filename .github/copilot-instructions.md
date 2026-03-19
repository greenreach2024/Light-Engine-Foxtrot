Production Light Engine Foxtrot system

## ARCHITECTURE: THE FARM IS 100% CLOUD (REQUIRED READING)

**There is NO physical farm device. No Raspberry Pi. No edge hardware. No on-premise server.**

The farm runs entirely on AWS Elastic Beanstalk. The Light Engine EB instance IS the farm. "Edge" and "cloud" are MERGED into a single cloud deployment. Any references to "edge mode" or "hardware" in the code are legacy artifacts.

**Read `.github/CLOUD_ARCHITECTURE.md` for the full architecture reference.**
**Read `.github/SENSOR_DATA_PIPELINE.md` for the complete sensor data flow.**
**Read `.github/CRITICAL_CONFIGURATION.md` for all credentials, env vars, and config files.**
**Read `.github/TROUBLESHOOTING_ENV_DATA.md` before debugging any sensor data issues.**

### Critical Facts Every Agent Must Know

1. **LE-EB IS the farm.** `light-engine-foxtrot-prod-v3` runs on the v2 CNAME (CNAME swap). URL contains "v2" but environment is v3. This is correct.
2. **v2 is DEAD.** `light-engine-foxtrot-prod-v2` is terminated. DO NOT deploy to it. DO NOT reference it as a target.
3. **Central is the hub.** `greenreach-central-prod-v4` at `greenreachgreens.com`. Separate EB application, separate deploy.
4. **Two data directories exist.** `public/data/` (LE) and `greenreach-central/public/data/` (Central). NOT synced.
5. **SwitchBot credentials are required for sensor data.** Set as EB env vars (`SWITCHBOT_TOKEN`, `SWITCHBOT_SECRET`) on `light-engine-foxtrot-prod-v3`. Also in `public/data/farm.json` under `integrations.switchbot`. If these are missing, sensors silently stop updating.
6. **Farm ID**: `FARM-MLTP9LVH-B0B85039` ("The Notable Sprout")

### DO NOT (Architecture Rules)

- DO NOT assume any physical device exists (no Pi, no edge box, no local server)
- DO NOT deploy to `light-engine-foxtrot-prod-v2` (dead environment)
- DO NOT "fix" the CNAME swap (v3 on v2 domain is intentional)
- DO NOT "fix" edge mode settings (LE-EB running as "edge" in cloud is intentional)
- DO NOT remove or modify SwitchBot credentials from EB env vars or farm.json
- DO NOT change the Central `/env` endpoint to proxy-first (DB-first is correct)
- DO NOT modify `setupLiveSensorSync()`, `ensureSwitchBotConfigured()`, or `getFarmIntegrations()` without reading SENSOR_DATA_PIPELINE.md
- DO NOT modify sync-service.js authentication without verifying both auth systems (Farm API key vs GREENREACH_API_KEY)
- DO NOT assume `foxtrot.greenreachgreens.com` resolves (it does not)

## 💾 Workspace Location (REQUIRED)

**All coding projects live on the external CodeVault drive:**

| Item | Path |
|------|------|
| **Canonical workspace** | `/Volumes/CodeVault/Projects/Light-Engine-Foxtrot` |
| **Symlink (backward compat)** | `~/Light-Engine-Foxtrot` → CodeVault |
| **All active projects** | `/Volumes/CodeVault/Projects/` |
| **Archived/reference repos** | `/Volumes/CodeVault/Archive/` |

**Rules:**
- New projects MUST be created under `/Volumes/CodeVault/Projects/`
- Use relative paths in code; use CodeVault absolute paths in scripts
- The `~/Light-Engine-Foxtrot` symlink is for backward compatibility only
- If CodeVault is not mounted, do NOT create projects on the internal drive — alert the user
- The drive is APFS-formatted (supports Unix permissions, symlinks, case-sensitive operations)

## 🎯 Agent Skills Framework (REQUIRED READING)

**ALL agents MUST read `.github/AGENT_SKILLS_FRAMEWORK.md` before any work.**

This framework defines:
- Project mission & core philosophy
- Programming themes (simplicity, database-driven, workflow-centric)
- Multi-agent collaboration model (Implementation → Review → Architecture)
- Technical standards & validation requirements
- Agent performance tracking & selection criteria

**Key Principles:**
1. **Simplicity Over Features** - Reduce grower workload, don't add steps
2. **Database-Driven** - Configuration is data, not code
3. **Workflow-Centric UI** - Design by task, not entity
4. **Multi-Agent Review** - Propose → Validate → Strategic Review before implementing
5. **Zero Data Format Violations** - Use adapters, never modify source formats
6. **Central-First Intelligence** - GreenReach Central is the mother ship, active from Phase 1

## 🧠 AI Vision Rules & Skills (REQUIRED for AI/ML work)

**ALL agents working on AI/ML features, feedback loops, network intelligence, or workflow automation MUST read `.github/AI_VISION_RULES_AND_SKILLS.md` before any work.**

This document codifies the `AI_VISION_REPORT.md` into enforceable rules:
- Central-First Architecture (dual-track Farm + Central implementation)
- Experiment Record Standard (canonical schema for harvest outcomes)
- 5 Feedback Loops (Recipe→Yield, Environment→Loss, Spectrum→Quality, Timing→Efficiency, Demand→Production)
- Recipe Modifier bounds and revert-on-regression safety
- Phase Gate rules (Phase 1 before Phase 2, etc.)
- 52 prioritized AI opportunities across 5 phases
- Automatic rejection criteria for non-compliant AI proposals

**Before ANY code change:**
- [ ] Read relevant framework sections
- [ ] Propose solution using Implementation Agent template
- [ ] Request Review Agent validation
- [ ] Get Architecture Agent strategic approval
- [ ] Run `npm run validate-schemas` before commit

## 🚨 DEPLOYMENT APPROVAL GATE (MANDATORY)

**NO production deployments without explicit user approval.**

Agents MUST receive **"APPROVED FOR DEPLOYMENT"** message from user before executing:
- `scp` commands to production server
- `ssh` commands that modify production files
- `pm2 restart` or server restart commands
- AWS deployment commands (Elastic Beanstalk, S3, etc.)

**Deployment Workflow:**
1. Investigate and propose solution (with line-by-line changes)
2. Get Review Agent validation
3. **STOP and wait for user approval**
4. User responds: "APPROVED FOR DEPLOYMENT"
5. Only then execute deployment commands

**NEVER:**
- Deploy and test iteratively in production
- Make "one more quick fix" without re-approval
- Assume user wants deployment because proposal was approved
- Deploy to production while debugging

**Violation = Immediate termination of agent session.**

## Data Format Standards (CRITICAL)

**Before modifying any data files** (groups.json, farm.json, rooms.json):
1. Read `DATA_FORMAT_STANDARDS.md` for canonical formats
2. Check `SCHEMA_CONSUMERS.md` for consumer count and impact
3. Run `npm run validate-schemas` to verify current state
4. **NEVER** modify source data format to fix a single page/card
5. **ALWAYS** fix consumers or use adapters from `lib/data-adapters.js`

**Key Rules**:
- ❌ DO NOT rename fields in canonical data files
- ❌ DO NOT change field types (number → array, string → object)
- ❌ DO NOT add required fields without migration plan
- ✅ DO use `normalizeGroup()` and other adapters for format variations
- ✅ DO add fallback patterns: `group.crop || group.recipe`
- ✅ DO validate changes: `npm run validate-schemas`

**56+ consumers** depend on these formats. Changes require full impact analysis.

See `.github/copilot-instructions-schema.md` for detailed guidance.

## 🗺️ Data Mapping Reference (REQUIRED)

**Before debugging ANY data loading, authentication, or sync issue**, agents MUST:

1. Read `DATA_MAPPING_DOCUMENT.md` — the canonical reference for all data storage locations, API endpoint-to-storage mappings, and data flow paths
2. Identify the **exact data resolution chain** for the affected feature (Section 10)
3. Verify data exists at **each layer** of the chain before proposing code fixes
4. Check the **Issue Log** (Section 12) for previously solved similar issues

**Key Data Mapping Rules:**
- ❌ DO NOT guess where data comes from — trace the documented path
- ❌ DO NOT modify auth code without checking `farm_users`, `admin_users`, and `admin_sessions` tables first
- ❌ DO NOT assume static JSON files are the source of truth — farmStore (farm_data table) overrides them
- ✅ DO trace: API endpoint → handler code → storage layer → actual data
- ✅ DO check all layers: PostgreSQL → In-Memory Map → JSON fallback → Default value
- ✅ DO document new issues and resolutions in `DATA_MAPPING_DOCUMENT.md` Section 12

**Resolution chains to check (from DATA_MAPPING_DOCUMENT.md):**
- Farm login: `login.html` → `/api/farm/auth/login` → `farm_users` JOIN `farms` → bcrypt → JWT
- Farm data: API → farmStore → `farm_data` table → in-memory Map → JSON file → default
- Admin auth: `/api/admin/auth/login` → `admin_users` → `admin_sessions` → JWT
- Sync: Edge → `POST /api/sync/*` → `farm_data` UPSERT → in-memory Map → file backup
