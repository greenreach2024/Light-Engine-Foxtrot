# Testing the VS Code Extension

## Quick Start

### 1. Open Extension in VS Code

```bash
cd /Users/petergilbert/Light-Engine-Foxtrot/.vscode-extension/light-engine-agents
code .
```

### 2. Launch Extension Development Host

**In VS Code:**
- Press `F5` (or Run → Start Debugging)
- This opens a new VS Code window with the extension loaded
- Look for "Light Engine Multi-Agent extension activated" in Debug Console

### 3. Test Chat Participants

**In the Extension Development Host window:**

Open GitHub Copilot Chat panel (Cmd+Shift+I or View → Copilot Chat)

#### Test 1: Start Workflow
```
Light Engine: Start Workflow
(Enter task when prompted, e.g., "Fix group detail page")
```

#### Test 2: Implementation Agent
```
@le-implementation Propose a solution to fix the group detail page showing "Groups not synced" message
```

**Expected Output:**
- Shows "Implementation Agent" header
- Framework rules reminder
- Investigation phase (searches codebase)
- Generates proposal with:
  - Files to modify
  - Changes description
  - Verification steps
  - Scope limits
  - Framework compliance
- Status transitions: `proposing` → `reviewing`
- Message: "Ready for Review Agent"

#### Test 3: Review Agent
```
@le-review Validate the proposal
```

**Expected Output:**
- Shows "Review Agent (Skeptic Role)" header
- Validation checklist (7 checks):
  - ✅ Investigation-First
  - ✅ Scope Defined
  - ✅ Verification Steps
  - ✅ No Scope Creep
  - ✅ Data Format Standards (if applicable)
  - ✅ No Hallucinations
  - ✅ Framework Awareness
- Decision: APPROVED or REJECTED
- If approved and critical: "Architecture Agent review required"
- If approved and not critical: "Ready to implement"
- Status transitions: `reviewing` → `strategic` or `approved`

#### Test 4: Architecture Agent (if critical)
```
@le-architecture Assess the strategic impact
```

**Expected Output:**
- Shows "Architecture Agent (Strategic Assessment)" header
- 4 assessments:
  - Mission Alignment
  - Data Integrity
  - System Impact
  - Technical Debt
- Decision: APPROVED, CONDITIONAL, or REJECTED
- Commit tag: `[APPROVED:REVIEW] [APPROVED:ARCH]`
- Status transitions: `strategic` → `approved` or `rejected`

### 4. Check Visual Progress

#### Tree View
**View → Open View → Light Engine Workflow**

Should show:
- Task: [your task description]
- ① Implementation Agent (✓ if done, ⟳ if active)
- ② Review Agent (✓ if done, ⟳ if active)
- ③ Architecture Agent (Optional) (✓ if done, ⟳ if active)
- ④ Ready to Commit (✓ if all approved)

#### Status Bar
Bottom of VS Code window shows workflow state:
- `idle`, `proposing`, `reviewing`, `strategic`, `approved`, or `rejected`

#### Progress Panel
```
Cmd+Shift+P → Light Engine: Show Progress
```

Opens webview with:
- Current state (color-coded)
- Task description
- Progress steps with status
- Full workflow log with timestamps

### 5. Test State Machine Enforcement

#### Test Invalid Transitions

**Try reviewing before proposing:**
```
@le-review Validate this proposal
```
Expected: ❌ "Cannot review. No proposal in review state."

**Try architecture review before review approval:**
```
@le-architecture Assess this
```
Expected: ❌ "Cannot perform strategic review. Current state: [state]"

**Try committing without approvals:**
Check tree view - ④ Ready to Commit should not have ✓

### 6. Test Workflow Reset

```
Cmd+Shift+P → Light Engine: Reset Workflow
```

Expected:
- Tree view clears
- Status bar shows `idle`
- Can start new workflow

### 7. Check Logs

```bash
cat .vscode-extension/light-engine-agents/logs/workflow.log
```

Should show JSON log entries with:
- Timestamps
- State transitions
- Agent outputs
- Approval decisions

## Common Issues

### Extension Not Loading

**Symptom:** No chat participants available

**Fix:**
1. Check VS Code version: `code --version` (must be 1.85+)
2. Check Debug Console for errors
3. Rebuild extension: `npm run compile`

### Chat Participants Not Showing

**Symptom:** Cannot find `@le-implementation`

**Fix:**
1. Enable Chat API in settings:
   ```json
   {
     "chat.experimental.enable": true
   }
   ```
2. Restart Extension Development Host (Cmd+Shift+F5)

### TypeScript Errors

**Symptom:** Extension won't compile

**Fix:**
```bash
cd .vscode-extension/light-engine-agents
npm install
npm run compile
```

### Workflow Stuck

**Symptom:** Cannot progress through states

**Fix:**
1. Check current state: Look at status bar
2. Reset workflow: `Cmd+Shift+P → Light Engine: Reset Workflow`
3. Check logs: `.vscode-extension/light-engine-agents/logs/workflow.log`

## Success Criteria

✅ Extension loads without errors  
✅ All 3 chat participants work (`@le-implementation`, `@le-review`, `@le-architecture`)  
✅ State machine enforces transitions (cannot skip gates)  
✅ Tree view shows workflow progress  
✅ Status bar updates on state changes  
✅ Progress panel shows detailed log  
✅ Review Agent validates proposals (7 checks)  
✅ Architecture Agent assesses strategic impact  
✅ Workflow logs persist to JSON  
✅ Reset workflow clears state  

## Next Steps After Testing

1. **Document Issues:** Note any bugs or unexpected behavior
2. **Test with Real Tasks:** Try actual Light Engine Foxtrot tasks
3. **Validate Context Isolation:** Check that Review Agent cannot access full codebase
4. **Measure Performance:** Track time per agent, approval rates
5. **Package Extension:** `npm run package` to create .vsix for team distribution

## Framework Compliance Check

After testing, verify:

- [ ] Investigation-First: Does Implementation Agent search codebase?
- [ ] Multi-Agent Review: Can you skip Review Agent? (Should be NO)
- [ ] Scope-Limited: Does Review Agent reject scope creep?
- [ ] Data Format Standards: Does Architecture Agent check canonical formats?
- [ ] Context Isolation: Does Review Agent have limited file access? (Check proposal-mentioned files only)
- [ ] Visual Progress: Can you see workflow state at all times?
- [ ] Persistent Logging: Are workflow logs saved?

---

**Last Updated:** January 19, 2026  
**Extension Version:** 1.0.0  
**Framework Version:** 1.2.0
