#!/usr/bin/env python3
"""Patch greenreach-central/server.js — add quality-reports + sustainability imports/mounts, remove sustainability stubs."""
import sys

FILE = '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot/greenreach-central/server.js'

with open(FILE, 'r', encoding='utf-8') as f:
    src = f.read()

changes = 0

# ── 1. Add imports after cropPricingRoutes ────────────────────────────
old_import = "import cropPricingRoutes from './routes/crop-pricing.js';"
new_import = """import cropPricingRoutes from './routes/crop-pricing.js';
import qualityReportsRoutes from './routes/quality-reports.js';
import sustainabilityRoutes from './routes/sustainability.js';"""

if 'qualityReportsRoutes' not in src and 'sustainabilityRoutes' not in src:
    src = src.replace(old_import, new_import, 1)
    changes += 1
    print("Added qualityReportsRoutes + sustainabilityRoutes imports")
elif 'sustainabilityRoutes' not in src:
    old2 = "import qualityReportsRoutes from './routes/quality-reports.js';"
    src = src.replace(old2, old2 + "\nimport sustainabilityRoutes from './routes/sustainability.js';", 1)
    changes += 1
    print("Added sustainabilityRoutes import (quality already present)")
else:
    print("Imports already present")

# ── 2. Add route mounts after crop-pricing mount ─────────────────────
old_mount = "app.use('/api/crop-pricing', cropPricingRoutes); // Farm-specific crop pricing"
if "app.use('/api/quality'" not in src:
    new_mount = old_mount + """
app.use('/api/quality', qualityReportsRoutes);                 // Quality reports + QA checkpoint proxies
app.use('/api/sustainability', sustainabilityRoutes);          // Sustainability & ESG dashboard"""
    src = src.replace(old_mount, new_mount, 1)
    changes += 1
    print("Added quality + sustainability route mounts")
elif "app.use('/api/sustainability'" not in src:
    quality_mount = "app.use('/api/quality', qualityReportsRoutes);"
    idx = src.index(quality_mount)
    end_of_line = src.index('\n', idx)
    src = src[:end_of_line+1] + "app.use('/api/sustainability', sustainabilityRoutes);          // Sustainability & ESG dashboard\n" + src[end_of_line+1:]
    changes += 1
    print("Added sustainability route mount (quality already present)")
else:
    print("Route mounts already present")

# ── 3. Remove sustainability inline stubs ────────────────────────────
stub_marker = "app.get('/api/sustainability/esg-report'"
if stub_marker in src:
    # Find the block — starts with the esg-report handler, ends after trends handler
    lines = src.split('\n')
    start_line = None
    end_line = None
    for i, line in enumerate(lines):
        if stub_marker in line and start_line is None:
            start_line = i
        if start_line is not None and "app.get('/api/sustainability/trends'" in line:
            # Find the closing `});` for this handler
            for j in range(i, min(i + 5, len(lines))):
                if '});' in lines[j]:
                    end_line = j
                    break
            break
    
    if start_line is not None and end_line is not None:
        # Replace with comment
        lines[start_line:end_line+1] = ['// Sustainability stubs — MOVED to routes/sustainability.js']
        src = '\n'.join(lines)
        changes += 1
        print(f"Removed sustainability stubs (lines {start_line+1}–{end_line+1})")
    else:
        print(f"WARNING: Found stub marker but couldn't delimit block (start={start_line}, end={end_line})", file=sys.stderr)
else:
    print("Sustainability stubs already removed")

if changes == 0:
    print("No changes needed")
    sys.exit(0)

with open(FILE, 'w', encoding='utf-8') as f:
    f.write(src)

# Verify
with open(FILE, 'r', encoding='utf-8') as f:
    final = f.read()

checks = [
    ('qualityReportsRoutes import', "import qualityReportsRoutes from './routes/quality-reports.js'" in final),
    ('sustainabilityRoutes import', "import sustainabilityRoutes from './routes/sustainability.js'" in final),
    ('quality mount', "app.use('/api/quality', qualityReportsRoutes)" in final),
    ('sustainability mount', "app.use('/api/sustainability', sustainabilityRoutes)" in final),
    ('NO esg-report stub', "app.get('/api/sustainability/esg-report'" not in final),
    ('NO energy stub', "app.get('/api/sustainability/energy/usage'" not in final),
    ('MOVED comment', '// Sustainability stubs — MOVED to routes/sustainability.js' in final),
]

all_ok = True
for label, ok in checks:
    status = 'OK' if ok else 'FAIL'
    if not ok:
        all_ok = False
    print(f"  {status}: {label}")

lines_count = final.count('\n') + 1
print(f"\nDone — {changes} changes applied ({lines_count} lines)")
if not all_ok:
    sys.exit(1)
