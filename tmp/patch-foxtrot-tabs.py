#!/usr/bin/env python3
"""Fix the nutrients/packaging tab swap in Foxtrot public/LE-farm-admin.html."""
filepath = '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot/public/LE-farm-admin.html'
with open(filepath, 'r') as f:
    content = f.read()

changes = 0

# 1. Rename suppliesContent-nutrients (which has Packaging content) → suppliesContent-packaging
old1 = '                    <!-- Nutrients Tab -->\n                    <div id="suppliesContent-nutrients" class="supplies-tab-content" style="display: none;">\n                        <div style="padding: 16px; display: flex; justify-content: space-between; align-items: center;">\n                            <h3>Packaging Materials</h3>\n                            <button onclick="showAddPackagingModal()"'
new1 = '                    <!-- Packaging Tab -->\n                    <div id="suppliesContent-packaging" class="supplies-tab-content" style="display: none;">\n                        <div style="padding: 16px; display: flex; justify-content: space-between; align-items: center;">\n                            <h3>Packaging Materials</h3>\n                            <button onclick="showAddPackagingModal()"'

if old1 in content:
    content = content.replace(old1, new1, 1)
    changes += 1
    print('1. suppliesContent-nutrients → suppliesContent-packaging: REPLACED')
else:
    print('1. suppliesContent-nutrients → suppliesContent-packaging: NOT FOUND')

# 2. Rename invContent-nutrients (orphaned real nutrients div) → suppliesContent-nutrients with correct class
old2 = '                    <!-- Nutrients Tab -->\n                    <div id="invContent-nutrients" class="inv-tab-content" style="display: none;">'
new2 = '                    <!-- Nutrients Tab -->\n                    <div id="suppliesContent-nutrients" class="supplies-tab-content" style="display: none;">'

if old2 in content:
    content = content.replace(old2, new2, 1)
    changes += 1
    print('2. invContent-nutrients → suppliesContent-nutrients: REPLACED')
else:
    print('2. invContent-nutrients → suppliesContent-nutrients: NOT FOUND')

if changes > 0:
    with open(filepath, 'w') as f:
        f.write(content)
    print(f'\nDone: {changes}/2 changes applied')
else:
    print('\nERROR: No changes applied')
    import sys; sys.exit(1)
