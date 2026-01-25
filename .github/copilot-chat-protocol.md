# GitHub Copilot Chat Protocol

**Last Updated:** January 25, 2026  
**Purpose:** Prevent code regression, file overwrites, and scope creep during AI-assisted development

---

## 🔴 CRITICAL RULES - MUST FOLLOW BEFORE ANY CODE CHANGE

### 1. **SEARCH BEFORE WRITING**
Before modifying ANY file, you MUST:
```bash
# Search for existing implementations
grep_search: Find current code patterns
semantic_search: Understand existing architecture
read_file: Read complete context of files you plan to modify
```

**❌ NEVER:**
- Write code from scratch without checking what exists
- Assume you know the file structure
- Guess at variable names or function signatures

**✅ ALWAYS:**
- Search for the specific function/feature first
- Read the entire file you're about to modify
- Verify the current state matches your understanding

---

### 2. **READ STATUS DOCUMENTS FIRST**
Before starting ANY task, check these documents in order:

```bash
# 1. Check for completion/implementation docs
grep_search: "COMPLETE|IMPLEMENTATION|READINESS" in *.md files

# 2. Read relevant status files
- *_COMPLETE.md - Feature is DONE, do NOT touch
- *_IMPLEMENTATION*.md - Current implementation state
- *_READINESS.md - Gap analysis, tells you what's MISSING
- *_STATUS.md - Current deployment/operational status
```

**Key Indicator Files:**
- `ACTIVITY_HUB_PHASE1_COMPLETE.md` - Activity Hub is DONE
- `RECIPES_V2_MIGRATION_COMPLETE.md` - Recipes v2 is DONE
- `LOGIN_LOOP_FINAL_FIX.md` - Login is FIXED
- `*_IMPLEMENTATION_READINESS.md` - Shows what NEEDS work

**❌ If you see "COMPLETE" in the filename:**
- Do NOT modify that feature unless EXPLICITLY requested
- Do NOT "improve" or "refactor" working code
- Do NOT add features to completed systems

---

### 3. **SCOPE DISCIPLINE - ONLY DO WHAT'S ASKED**

**Before any change, ask yourself:**
1. Did the user explicitly request this file change?
2. Is this file directly related to the stated problem?
3. Am I fixing something that isn't broken?

**❌ NEVER:**
- Update files "while you're at it"
- Refactor code that's working
- Add improvements not requested
- Fix "potential issues" you notice
- Update multiple systems for one request

**✅ ONLY:**
- Modify files explicitly mentioned by user
- Change code directly related to the stated problem
- Ask user before expanding scope

**Example:**
```
USER: "Fix the Calendly link on purchase.html"
❌ DO NOT: Update all pages with Calendly links
✅ DO: Fix only purchase.html, then ASK if they want others updated
```

---

### 4. **VERSION CONTROL - CHECK GIT HISTORY**

Before modifying a file that you think might be wrong:

```bash
# Check recent changes to the file
git log --oneline -n 10 -- path/to/file.js

# See what changed recently
git diff HEAD~5 -- path/to/file.js

# Check if file was recently deployed
grep_search: "deployed|deployment" in *.md
```

**Red Flags:**
- File was modified in last 24 hours → Likely intentional
- Filename appears in *_COMPLETE.md → Do NOT touch
- File has extensive history → Don't assume it's wrong

---

### 5. **DEPLOYMENT AWARENESS**

Before ANY backend change, check deployment status:

```bash
# Check if code is in production
grep_search: "DEPLOYED|PRODUCTION" in *.md

# Find deployment scripts
file_search: "**/deploy*.sh"

# Read deployment docs
read_file: DEPLOYMENT_*.md files
```

**Production Safety:**
- ✅ Local files → Safe to modify
- ⚠️ Deployed to edge device → Requires redeployment
- 🔴 In AWS/Production → EXTRA caution, read deployment docs first

---

### 6. **READ BEFORE REPLACE**

When using `replace_string_in_file`:

```javascript
// ❌ WRONG - Guessing at context
oldString: "function loadData() {"

// ✅ RIGHT - Using actual file context with 5+ lines before/after
oldString: `
  // Previous function
  console.log('Loading...');
  
  function loadData() {
    const data = fetchAPI();
    return data;
  }
  
  // Next function
  function saveData() {
`
```

**Must include:**
- 5+ lines BEFORE target
- 5+ lines AFTER target
- Exact whitespace/indentation
- Complete context to ensure unique match

---

### 7. **DOCUMENT REVIEW CHECKLIST**

**Before starting any task:**

- [ ] Read user request 3 times
- [ ] Search for *_COMPLETE.md files related to topic
- [ ] Search for existing code implementations
- [ ] Read files I plan to modify (complete file, not just function)
- [ ] Check git history for recent changes
- [ ] Verify scope is ONLY what user requested
- [ ] Check if feature already exists/works
- [ ] Ask user if unclear about scope

**During implementation:**

- [ ] Only modify files explicitly needed
- [ ] Use exact context for replacements (5+ lines)
- [ ] Test understanding by reading back changes
- [ ] Verify no scope creep

**After changes:**

- [ ] Review what was changed
- [ ] Confirm nothing extra was modified
- [ ] Check if deployment needed
- [ ] Update user with what was done (NOT what else could be done)

---

## 📋 COMMON MISTAKES TO AVOID

### Mistake #1: "Improving" Complete Features
```
❌ BAD:
User: "Fix room mapper data loading"
AI: *Also updates groups.json structure, refactors room setup, improves error handling*

✅ GOOD:
User: "Fix room mapper data loading"
AI: *Fixes ONLY the room mapper data loading endpoint*
AI: "Room mapper fixed. Want me to look at anything else?"
```

### Mistake #2: Not Reading Status Docs
```
❌ BAD:
AI: *Sees 'Room Setup' mentioned, rewrites entire setup wizard*
*Overwrites ACTIVITY_HUB_PHASE1_COMPLETE work*

✅ GOOD:
AI: *Reads ACTIVITY_HUB_PHASE1_COMPLETE.md first*
AI: "I see Activity Hub setup is complete. Should I only modify Room Setup page?"
```

### Mistake #3: Guessing at Code
```
❌ BAD:
AI: *Writes replace_string_in_file with made-up function name*
Result: "String not found in file" error

✅ GOOD:
AI: *First runs grep_search to find actual function*
AI: *Reads complete file to get exact context*
AI: *Uses actual code with 5+ lines context*
```

### Mistake #4: Expanding Scope
```
❌ BAD:
User: "Update Calendly URL in header"
AI: *Updates header, footer, all pages, creates new schedule page*

✅ GOOD:
User: "Update Calendly URL in header"
AI: "Updated header. Should I also update footer and other pages?"
```

---

## 🎯 CONVERSATION STARTER TEMPLATE

**Use this template at START of EVERY chat about code changes:**

```markdown
Before I make any changes, let me verify:

1. **Scope Check:**
   - You want me to: [restate user's exact request]
   - Files to modify: [list specific files mentioned]
   - Anything else? [ask for confirmation]

2. **Status Check:**
   - Searching for existing implementations...
   - Checking for *_COMPLETE.md documents...
   - Reading relevant files...

3. **History Check:**
   - Reviewing recent changes to these files...
   - Checking deployment status...

[After checks complete]

**Found:**
- [List what exists]
- [Note what's working]
- [Identify actual issue]

**Plan:**
- [Minimal change needed]
- [Files to modify]
- [No extra changes]

Proceed? Or need different approach?
```

---

## 🚨 RED FLAGS - STOP AND ASK

Stop immediately and ask user if you notice:

1. **Feature already works** - "This seems to work already. Still want me to change it?"
2. **File marked COMPLETE** - "I see this feature is marked complete. Confirm you want modifications?"
3. **Recent deployment** - "This was deployed recently. Are you seeing an issue in production?"
4. **Scope expansion** - "This would require changes to X, Y, Z. Is that intended?"
5. **Multiple systems affected** - "Fixing this touches A, B, C systems. Should I proceed?"
6. **Working backup exists** - "There's a .backup file. Should I restore that instead?"

---

## ✅ SUCCESS CRITERIA

**You're doing it right when:**

- ✅ You search before writing ANY code
- ✅ You read complete files before modifying
- ✅ You only change what was requested
- ✅ You use exact code context (5+ lines)
- ✅ You check if feature is already complete
- ✅ You ask before expanding scope
- ✅ You verify understanding before acting
- ✅ You provide minimal, targeted fixes

**You're doing it wrong when:**

- ❌ You write code from memory/assumptions
- ❌ You modify files not explicitly requested
- ❌ You "improve" working code
- ❌ You overwrite recent deployments
- ❌ String replacements fail (wrong context)
- ❌ You touch *_COMPLETE features
- ❌ You expand scope without asking

---

## 📖 REQUIRED READING FOR EACH TOPIC

### Room Setup / Room Mapper:
1. Read: `DATA_RECOVERY_FINAL.md`
2. Check: Recent changes to `server-foxtrot.js` room endpoints
3. Verify: `/data/room-map.json` endpoint implementation

### Activity Hub:
1. Read: `ACTIVITY_HUB_PHASE1_COMPLETE.md`
2. Do NOT modify unless explicitly broken
3. Check: `ACTIVITY_HUB_IMPLEMENTATION_READINESS.md` for gaps

### Authentication/Login:
1. Read: `LOGIN_LOOP_FINAL_FIX.md`
2. Check: `/api/setup-wizard/status` endpoint exists
3. Verify: Authentication flow already working

### Deployment:
1. Read: `scripts/deploy-production-s3.sh`
2. Check: Last deployment date
3. Verify: What files are in production

---

## 🎓 TRAINING SCENARIOS

**Scenario 1: User says "Room Mapper not syncing"**

❌ BAD Response:
*Immediately rewrites room mapper, updates room setup, changes data flow*

✅ GOOD Response:
```
Let me check current state:
1. Reading room-map endpoint in server-foxtrot.js...
2. Checking recent changes to this endpoint...
3. Verifying data flow: Room Setup → rooms.json → Room Mapper → room-map.json

Found: Endpoint was recently fixed to read from room-map files.
Question: Are you seeing a specific error? Or testing if it works?
```

**Scenario 2: User says "Update the website"**

❌ BAD Response:
*Updates all HTML files, rewrites navigation, adds new features*

✅ GOOD Response:
```
Can you clarify:
1. Which pages need updating?
2. What specifically needs to change?
3. Is this for content, links, or functionality?

I want to avoid changing more than needed.
```

---

## 💾 SAVE THIS PROTOCOL

**This document should be referenced:**
- At start of every coding session
- Before any file modification
- When user reports a "bug" in working code
- When tempted to "improve" something
- When scope seems unclear

**Update this document when:**
- New mistakes are identified
- Better practices are discovered
- Specific project patterns emerge

---

**Remember: Your job is to help, not to rewrite working code.**

**When in doubt: SEARCH, READ, ASK - Never assume.**
