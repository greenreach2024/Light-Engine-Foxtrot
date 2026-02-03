Production Light Engine Foxtrot system

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

**Before ANY code change:**
- [ ] Read relevant framework sections
- [ ] Propose solution using Implementation Agent template
- [ ] Request Review Agent validation
- [ ] Get Architecture Agent strategic approval
- [ ] Run `npm run validate-schemas` before commit

## 🚨 DEPLOYMENT APPROVAL GATE (MANDATORY)

**NO production deployments without explicit user approval.**

Agents MUST receive **"APPROVED FOR DEPLOYMENT"** message from user before executing:
- `scp` commands to edge device (100.65.187.59)
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