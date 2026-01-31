#!/bin/bash
# Agent Skills Framework - Weekly Review Script
# Run: Every Friday at 5pm
# Purpose: Auto-analyze violations and propose improvements

set -euo pipefail

REPORT_DATE=$(date +%Y-%m-%d)
REPORT_FILE=".github/framework-reviews/review-$REPORT_DATE.md"

mkdir -p .github/framework-reviews

echo "=== Generating Framework Review for Week of $REPORT_DATE ==="

cat > "$REPORT_FILE" << EOF
# Agent Skills Framework - Weekly Review
**Week of:** $REPORT_DATE  
**Generated:** $(date)

---

## 📊 Metrics

### Violations
EOF

# Count violations
BYPASSES=$(git log --since="1 week ago" --grep="--no-verify" --oneline 2>/dev/null | wc -l || echo "0")
SCOPE_CREEP=$(git log --since="1 week ago" --grep="while we're at it\|also add\|bonus" --oneline 2>/dev/null | wc -l || echo "0")
EMERGENCY=$(git log --since="1 week ago" --grep="EMERGENCY" --oneline 2>/dev/null | wc -l || echo "0")
CRITICAL_CHANGES=$(git log --since="1 week ago" -- data/*.json greenreach-central/routes/sync.js greenreach-central/config/database.js 2>/dev/null | wc -l || echo "0")

cat >> "$REPORT_FILE" << EOF
- **Emergency Bypasses:** $BYPASSES
- **Scope Creep Commits:** $SCOPE_CREEP
- **Emergency Fixes:** $EMERGENCY
- **Critical File Changes:** $CRITICAL_CHANGES

### Success
EOF

APPROVED=$(git log --since="1 week ago" --grep="\[APPROVED:REVIEW\].*\[APPROVED:ARCH\]" --oneline 2>/dev/null | wc -l || echo "0")
SCHEMA_VALID=$(git log --since="1 week ago" --grep="validate-schemas" --oneline 2>/dev/null | wc -l || echo "0")

cat >> "$REPORT_FILE" << EOF
- **Properly Approved Changes:** $APPROVED
- **Schema Validations Run:** $SCHEMA_VALID

---

## 🔍 Pattern Analysis

### Top Issues This Week
EOF

git log --since="1 week ago" --grep="Fix:\|EMERGENCY\|Revert" --oneline 2>/dev/null | \
  sed 's/^[a-f0-9]* //' | sed 's/\[.*\] //' | sort | uniq -c | sort -rn | head -5 >> "$REPORT_FILE" || echo "No issues" >> "$REPORT_FILE"

cat >> "$REPORT_FILE" << EOF

### Bypass Log (Last 10 entries)
\`\`\`
EOF

tail -10 .github/bypass-log.md 2>/dev/null >> "$REPORT_FILE" || echo "No bypasses logged" >> "$REPORT_FILE"

cat >> "$REPORT_FILE" << EOF
\`\`\`

---

## 💡 Recommendations

EOF

# Generate recommendations based on patterns
if [ "$EMERGENCY" -gt 3 ]; then
  cat >> "$REPORT_FILE" << EOF
### 🚨 HIGH: Too Many Emergency Fixes ($EMERGENCY this week)

**Problem:** Frequent production issues requiring bypass.

**Root Causes to Investigate:**
- Schema mismatches between dev and production?
- Insufficient testing before deploy?
- Missing validation steps?

**Proposed Solutions:**
1. Add pre-deploy schema check script
2. Require staging environment test before production
3. Add rollback automation for failed deploys

**Action:** Architecture Agent review needed
EOF
fi

if [ "$BYPASSES" -gt 5 ]; then
  cat >> "$REPORT_FILE" << EOF
### ⚠️ MEDIUM: High Bypass Rate ($BYPASSES bypasses)

**Problem:** Framework being bypassed frequently.

**Possible Causes:**
- Rules too strict for real-world use?
- Emergency situations not well-defined?
- Bypass process too easy?

**Proposed Solutions:**
1. Review bypass reasons in log
2. Add "fast-track approval" for time-sensitive changes
3. Tighten bypass logging (require ticket number)

**Action:** Review Agent to analyze bypass patterns
EOF
fi

if [ "$APPROVED" -eq 0 ] && [ "$CRITICAL_CHANGES" -gt 0 ]; then
  cat >> "$REPORT_FILE" << EOF
### 🔴 CRITICAL: Critical Changes Without Approval

**Problem:** Critical files changed but no approved commits detected.

**Action Required:**
1. Audit all critical file changes this week
2. Retroactively document approvals
3. Verify pre-commit hook is active

**Files to Audit:**
\`\`\`
EOF
  git log --since="1 week ago" --name-only -- data/*.json greenreach-central/routes/sync.js greenreach-central/config/database.js 2>/dev/null | grep -E '\.(json|js)$' | sort | uniq >> "$REPORT_FILE" || echo "None" >> "$REPORT_FILE"
  cat >> "$REPORT_FILE" << EOF
\`\`\`
EOF
fi

if [ "$BYPASSES" -eq 0 ] && [ "$APPROVED" -gt 0 ]; then
  cat >> "$REPORT_FILE" << EOF
### ✅ SUCCESS: Clean Week!

**Achievement:** No bypasses, all changes properly approved.

**What Worked:**
- Pre-commit hook functioning correctly
- Review process being followed
- Team following framework guidelines

**Keep Doing:**
- Maintain current approval workflow
- Continue schema validations
- Document all architectural decisions
EOF
fi

cat >> "$REPORT_FILE" << EOF

---

## 📈 Trend Analysis

### Week-over-Week Comparison
EOF

# Compare to last week
LAST_WEEK=$(date -v-7d +%Y-%m-%d 2>/dev/null || date -d "7 days ago" +%Y-%m-%d)
LAST_REPORT=".github/framework-reviews/review-$LAST_WEEK.md"

if [ -f "$LAST_REPORT" ]; then
  cat >> "$REPORT_FILE" << EOF
- Bypasses: $BYPASSES (last week: $(grep "Emergency Bypasses:" "$LAST_REPORT" | grep -oE '[0-9]+'))
- Approved: $APPROVED (last week: $(grep "Properly Approved:" "$LAST_REPORT" | grep -oE '[0-9]+'))

**Trend:** $([ "$BYPASSES" -lt $(grep "Emergency Bypasses:" "$LAST_REPORT" | grep -oE '[0-9]+') ] && echo "✅ Improving" || echo "⚠️ Needs attention")
EOF
else
  echo "First weekly review - no trend data yet" >> "$REPORT_FILE"
fi

cat >> "$REPORT_FILE" << EOF

---

## 🎯 Action Items for Next Week

EOF

# Generate action items based on metrics
if [ "$BYPASSES" -gt 0 ]; then
  echo "- [ ] Review and resolve bypass reasons" >> "$REPORT_FILE"
fi

if [ "$EMERGENCY" -gt 2 ]; then
  echo "- [ ] Investigate root cause of emergency fixes" >> "$REPORT_FILE"
  echo "- [ ] Implement preventive measures" >> "$REPORT_FILE"
fi

if [ "$CRITICAL_CHANGES" -gt "$APPROVED" ]; then
  echo "- [ ] Audit unapproved critical changes" >> "$REPORT_FILE"
fi

cat >> "$REPORT_FILE" << EOF
- [ ] Update framework based on this week's learnings
- [ ] Share report with team
- [ ] Schedule Architecture Agent review if needed

---

**Next Review:** $(date -v+7d +%Y-%m-%d 2>/dev/null || date -d "7 days" +%Y-%m-%d)
EOF

echo "✅ Report generated: $REPORT_FILE"
cat "$REPORT_FILE"
