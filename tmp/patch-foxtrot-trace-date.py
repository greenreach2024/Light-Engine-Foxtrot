#!/usr/bin/env python3
"""Add date range filter inputs to Foxtrot traceability filter bar."""
filepath = '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot/public/LE-farm-admin.html'
with open(filepath, 'r') as f:
    content = f.read()

old = """                        </select>
                        <button onclick="exportSFCR('csv')" style="padding: 8px 16px; background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">SFCR Export</button>"""

new = """                        </select>
                        <input type="date" id="traceFromDate" onchange="loadTraceRecords()" title="From date" style="padding: 8px 10px; border-radius: 6px; background: var(--bg-card); border: 1px solid var(--border); color: var(--text-primary);">
                        <input type="date" id="traceToDate" onchange="loadTraceRecords()" title="To date" style="padding: 8px 10px; border-radius: 6px; background: var(--bg-card); border: 1px solid var(--border); color: var(--text-primary);">
                        <button onclick="exportSFCR('csv')" style="padding: 8px 16px; background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">SFCR Export</button>"""

if old in content:
    content = content.replace(old, new, 1)
    with open(filepath, 'w') as f:
        f.write(content)
    print('5. Date range filter: REPLACED')
else:
    print('5. Date range filter: NOT FOUND')
