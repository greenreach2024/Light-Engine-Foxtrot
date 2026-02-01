# Multi-Agent Review Script

## Quick Start

```bash
# Run multi-agent review for any high-risk change
./scripts/multi-agent-review.sh "Your task description here"
```

## When to Use

**REQUIRED for High-Risk Changes:**
- ✅ Modifying data formats (groups.json, farm.json, rooms.json, recipes)
- ✅ Changing authentication/authorization
- ✅ Updating database schemas
- ✅ Adding new API endpoints
- ✅ Modifying network learning queries
- ✅ Changing IoT device protocols

**OPTIONAL for Medium-Risk Changes:**
- Fixing bugs in existing features
- UI-only changes (no data structure changes)
- Documentation updates
- Adding tests

**SKIP for Low-Risk Changes:**
- Typo fixes
- CSS adjustments
- Log message updates
- Comment improvements

## How It Works

The script orchestrates three independent agents in separate VS Code chat windows:

### Phase 1: Implementation Agent 🛠️
- **Role:** Propose solution with verification
- **Output:** Detailed proposal with scope, approach, files, verification
- **Gate:** User reviews proposal before proceeding

### Phase 2: Review Agent 🔍
- **Role:** Skeptic - catch mistakes and scope creep
- **Checks:** Scope adherence, hallucination detection, framework compliance
- **Power:** Can REJECT and send back to Implementation Agent

### Phase 3: Architecture Agent 🏛️
- **Role:** Pragmatist - protect mission and prevent complexity
- **Checks:** Mission alignment, complexity, scale, cost/benefit
- **Power:** Can APPROVE, DEFER (to backlog), or REJECT

### Phase 4: Implementation ✅
- **Trigger:** All three agents approved
- **Action:** Implementation Agent receives approval and codes
- **Audit:** All decisions logged in /tmp/light-engine-review-*/

## Example Usage

```bash
# High-risk: Data format change
./scripts/multi-agent-review.sh "Add harvest_date field to groups.json"

# High-risk: Schema change
./scripts/multi-agent-review.sh "Create reservations table for inventory"

# High-risk: Auth change
./scripts/multi-agent-review.sh "Add multi-tenant farm access control"

# Medium-risk: Feature addition
./scripts/multi-agent-review.sh "Add harvest forecast widget to dashboard"
```

## Workflow Walkthrough

1. **Run Script**
   ```bash
   ./scripts/multi-agent-review.sh "Add harvest forecast widget"
   ```

2. **Implementation Phase**
   - Script displays a prompt to copy
   - Open NEW VS Code chat window
   - Paste prompt: "@ImplementationAgent [task details]"
   - Wait for proposal
   - Copy proposal to `/tmp/light-engine-review-*/1-proposal.md`
   - Press ENTER in script

3. **Review Phase**
   - Script displays review prompt to copy
   - Open NEW VS Code chat window
   - Paste prompt: "@ReviewAgent [proposal]"
   - Wait for validation
   - Copy review to `/tmp/light-engine-review-*/2-review.md`
   - Press ENTER in script

4. **Architecture Phase**
   - Script displays architecture prompt to copy
   - Open NEW VS Code chat window
   - Paste prompt: "@ArchitectureAgent [proposal + review]"
   - Wait for assessment
   - Copy assessment to `/tmp/light-engine-review-*/3-architecture.md`
   - Press ENTER in script

5. **Implementation Approval**
   - If all agents approve, script generates approval message
   - Return to Implementation Agent chat (Phase 1 window)
   - Paste approval message
   - Agent implements solution

## Audit Trail

Every review is logged:

**Temporary Files** (preserved until reboot):
```
/tmp/light-engine-review-<PID>/
  ├── 1-proposal.md              # Implementation Agent's proposal
  ├── 2-review.md                # Review Agent's validation
  ├── 3-architecture.md          # Architecture Agent's assessment
  ├── implementation-prompt.txt  # Prompts used (for reference)
  ├── review-prompt.txt
  ├── architecture-prompt.txt
  └── implementation-approval.txt
```

**Permanent Log:**
```
.multi-agent-audit.log           # All review decisions with timestamps
```

## Success Metrics

After 30 days, measure:
- **Scope adherence:** % of approvals without scope creep (target >95%)
- **Hallucination rate:** % of rejections due to unverified APIs (target <2%)
- **Mission alignment:** % of approvals that reduce grower workload (target >90%)
- **Time savings:** Hours prevented in rework (target 20+ hours/month)

## Troubleshooting

### "Proposal file not found"
- Make sure you created `/tmp/light-engine-review-<PID>/1-proposal.md`
- Paste the ENTIRE proposal from Implementation Agent
- File must not be empty

### "Review Agent rejected"
- This is working as intended!
- Address the concerns raised
- Return to Implementation Agent with feedback
- Generate revised proposal
- Re-run the script

### "Architecture Agent deferred"
- Good idea, wrong timing
- Add to backlog for future consideration
- Task will be preserved in audit log

### Script shows different temp directory
- Each run gets unique PID: `/tmp/light-engine-review-12345/`
- Script displays the correct path at the start
- Copy the path shown by the script

## Tips

1. **Keep Chat Windows Organized**
   - Label windows: "Impl", "Review", "Arch"
   - Use CMD+K (Mac) to switch between chats
   - Don't close windows until review complete

2. **Copy Full Context**
   - Select ALL text in agent response
   - Include verification results (grep output, file reads)
   - Don't truncate or summarize

3. **Iterate When Rejected**
   - Review Agent rejections are common (and good!)
   - Address specific concerns raised
   - Return to Implementation Agent
   - Reference rejection: "Review Agent rejected because [reason]. Revised proposal:"

4. **Save Audit Trail to PR**
   - Attach `/tmp/light-engine-review-*/` contents to PR description
   - Helps reviewers understand decision process
   - Creates permanent record

## Future Enhancements

Planned improvements:
- [ ] VS Code extension for inline workflow (no copy-paste)
- [ ] GitHub Actions integration for automated PR review
- [ ] Template library for common tasks
- [ ] Slack notifications when approval needed
- [ ] Dashboard showing review metrics

## Related Documentation

- `.github/AGENT_SKILLS_FRAMEWORK.md` - Full framework (24,000 words)
- `.github/MULTI_AGENT_VSCODE_IMPLEMENTATION.md` - Implementation options
- `.github/DATA_FORMAT_STANDARDS.md` - Data format rules
- `.github/SCHEMA_CONSUMERS.md` - Schema consumer impact analysis

---

**Questions?** File an issue or check the framework documentation.
