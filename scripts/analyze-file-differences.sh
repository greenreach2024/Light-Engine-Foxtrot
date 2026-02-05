#!/bin/bash
set -e

echo "=== Light Engine File Consolidation Analysis ==="
echo ""

REPORT="consolidation-analysis-$(date +%Y%m%d_%H%M%S).md"

cat > "$REPORT" << 'HEADER'
# Light Engine File Consolidation Analysis

**Generated**: $(date)

## Strategy
- **Edge (public/)** = Source of truth (more complete, tested in production)
- **Cloud (greenreach-central/public/)** = Check for unique improvements before archiving

---

HEADER

echo "## 1. Schema Validation (Pre-Analysis)" >> "$REPORT"
echo "" >> "$REPORT"

# Check if schema validation exists
if command -v npm &> /dev/null && [ -f "package.json" ]; then
  echo "Running schema validation..." >> "$REPORT"
  echo '```' >> "$REPORT"
  npm run validate-schemas >> "$REPORT" 2>&1 || echo "Schema validation not configured" >> "$REPORT"
  echo '```' >> "$REPORT"
else
  echo "⚠️ Schema validation not available (npm not found or no package.json)" >> "$REPORT"
fi

echo "" >> "$REPORT"
echo "---" >> "$REPORT"
echo "" >> "$REPORT"

echo "## 2. Identical Files (Safe to Use Edge Version)" >> "$REPORT"
echo "" >> "$REPORT"

IDENTICAL_COUNT=0

# Compare all LE files
for edge_file in public/LE-*.html public/views/*.html; do
  if [ ! -f "$edge_file" ]; then continue; fi
  
  filename=$(basename "$edge_file")
  cloud_file="greenreach-central/public/$filename"
  
  if [ ! -f "$cloud_file" ]; then
    # Check in views subfolder
    if [[ "$edge_file" == *"/views/"* ]]; then
      cloud_file="greenreach-central/public/views/$filename"
    fi
  fi
  
  if [ -f "$cloud_file" ]; then
    if diff -q "$edge_file" "$cloud_file" > /dev/null 2>&1; then
      echo "✓ \`$filename\` - identical" >> "$REPORT"
      ((IDENTICAL_COUNT++))
    fi
  fi
done

echo "" >> "$REPORT"
echo "**Total identical files**: $IDENTICAL_COUNT" >> "$REPORT"
echo "" >> "$REPORT"

echo "## 3. Files That Differ (⚠️ NEED MANUAL REVIEW)" >> "$REPORT"
echo "" >> "$REPORT"

DIFF_COUNT=0

# Find differing files
for edge_file in public/LE-*.html public/views/*.html; do
  if [ ! -f "$edge_file" ]; then continue; fi
  
  filename=$(basename "$edge_file")
  cloud_file="greenreach-central/public/$filename"
  
  if [ ! -f "$cloud_file" ]; then
    if [[ "$edge_file" == *"/views/"* ]]; then
      cloud_file="greenreach-central/public/views/$filename"
    fi
  fi
  
  if [ -f "$cloud_file" ]; then
    if ! diff -q "$edge_file" "$cloud_file" > /dev/null 2>&1; then
      echo "### 📝 \`$filename\`" >> "$REPORT"
      echo "" >> "$REPORT"
      echo "**Edge size**: $(wc -l < "$edge_file") lines" >> "$REPORT"
      echo "**Cloud size**: $(wc -l < "$cloud_file") lines" >> "$REPORT"
      echo "" >> "$REPORT"
      
      # Show key differences
      echo "**Key differences**:" >> "$REPORT"
      echo '```diff' >> "$REPORT"
      diff -u "$cloud_file" "$edge_file" | head -100 >> "$REPORT" 2>&1 || true
      echo '```' >> "$REPORT"
      echo "" >> "$REPORT"
      echo "---" >> "$REPORT"
      echo "" >> "$REPORT"
      ((DIFF_COUNT++))
    fi
  fi
done

echo "**Total differing files**: $DIFF_COUNT" >> "$REPORT"
echo "" >> "$REPORT"

echo "## 4. Edge-Only Files (Will Be Copied)" >> "$REPORT"
echo "" >> "$REPORT"

EDGE_ONLY_COUNT=0

for edge_file in public/LE-*.html public/views/*.html; do
  if [ ! -f "$edge_file" ]; then continue; fi
  
  filename=$(basename "$edge_file")
  cloud_file="greenreach-central/public/$filename"
  
  if [ ! -f "$cloud_file" ]; then
    if [[ "$edge_file" == *"/views/"* ]]; then
      cloud_file="greenreach-central/public/views/$filename"
    fi
  fi
  
  if [ ! -f "$cloud_file" ]; then
    echo "- \`$filename\` (edge production feature)" >> "$REPORT"
    ((EDGE_ONLY_COUNT++))
  fi
done

echo "" >> "$REPORT"
echo "**Total edge-only files**: $EDGE_ONLY_COUNT" >> "$REPORT"
echo "" >> "$REPORT"

echo "## 5. Cloud-Only Files (⚠️ CHECK: Unique Features?)" >> "$REPORT"
echo "" >> "$REPORT"

CLOUD_ONLY_COUNT=0

for cloud_file in greenreach-central/public/LE-*.html greenreach-central/public/views/*.html; do
  if [ ! -f "$cloud_file" ]; then continue; fi
  
  filename=$(basename "$cloud_file")
  edge_file="public/$filename"
  
  if [ ! -f "$edge_file" ]; then
    if [[ "$cloud_file" == *"/views/"* ]]; then
      edge_file="public/views/$filename"
    fi
  fi
  
  if [ ! -f "$edge_file" ]; then
    echo "- \`$filename\` (exists in cloud but not edge)" >> "$REPORT"
    ((CLOUD_ONLY_COUNT++))
  fi
done

echo "" >> "$REPORT"
echo "**Total cloud-only files**: $CLOUD_ONLY_COUNT" >> "$REPORT"
echo "" >> "$REPORT"

echo "## 6. Path Reference Audit" >> "$REPORT"
echo "" >> "$REPORT"
echo "Checking for hardcoded paths that might break after consolidation..." >> "$REPORT"
echo "" >> "$REPORT"
echo '```' >> "$REPORT"
grep -r "public/LE-" greenreach-central/ 2>/dev/null | head -10 >> "$REPORT" || echo "No hardcoded public/LE- paths found" >> "$REPORT"
grep -r "\.\./LE-" greenreach-central/ 2>/dev/null | head -10 >> "$REPORT" || echo "No hardcoded ../LE- paths found" >> "$REPORT"
echo '```' >> "$REPORT"
echo "" >> "$REPORT"

echo "## 7. Summary & Recommendations" >> "$REPORT"
echo "" >> "$REPORT"
echo "| Category | Count | Action |" >> "$REPORT"
echo "|----------|-------|--------|" >> "$REPORT"
echo "| Identical files | $IDENTICAL_COUNT | ✅ Use edge version |" >> "$REPORT"
echo "| Differing files | $DIFF_COUNT | ⚠️ **Manual review required** |" >> "$REPORT"
echo "| Edge-only files | $EDGE_ONLY_COUNT | ✅ Copy to consolidated |" >> "$REPORT"
echo "| Cloud-only files | $CLOUD_ONLY_COUNT | ⚠️ Check for unique features |" >> "$REPORT"
echo "" >> "$REPORT"
echo "### Next Steps" >> "$REPORT"
echo "" >> "$REPORT"
echo "1. **⚠️ CRITICAL**: Review all $DIFF_COUNT differing files above" >> "$REPORT"
echo "2. Document any cloud improvements that should be preserved" >> "$REPORT"
echo "3. Manually merge cloud improvements into edge files if needed" >> "$REPORT"
echo "4. Review $CLOUD_ONLY_COUNT cloud-only files for unique features" >> "$REPORT"
echo "5. After review complete, run \`./scripts/consolidate-light-engine.sh\`" >> "$REPORT"
echo "" >> "$REPORT"
echo "### Approval Checklist" >> "$REPORT"
echo "" >> "$REPORT"
echo "- [ ] All $DIFF_COUNT differing files reviewed" >> "$REPORT"
echo "- [ ] Cloud improvements documented or merged" >> "$REPORT"
echo "- [ ] Schema validation passed" >> "$REPORT"
echo "- [ ] No critical features will be lost" >> "$REPORT"
echo "- [ ] Ready to proceed with consolidation" >> "$REPORT"

echo ""
echo "✅ Analysis complete: $REPORT"
echo ""
echo "📊 Summary:"
echo "   - Identical files: $IDENTICAL_COUNT"
echo "   - Differing files: $DIFF_COUNT (⚠️ NEED REVIEW)"
echo "   - Edge-only files: $EDGE_ONLY_COUNT"
echo "   - Cloud-only files: $CLOUD_ONLY_COUNT"
echo ""
echo "⚠️  IMPORTANT: Review this report before running consolidation script."
echo "   Focus on the $DIFF_COUNT differing files to identify any cloud improvements."
