#!/usr/bin/env python3
"""Add Export CSV button to Foxtrot LE-farm-admin.html pricing section."""
filepath = '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot/public/LE-farm-admin.html'
with open(filepath, 'r') as f:
    content = f.read()

old = """<button class="btn" onclick="savePricing()">Save Changes</button>
                    </div>
                </div>
                
                <!-- AI Assistant Alert -->
                <div id="ai-pricing-alert" style="display: none;"></div>
                
                <div class="card">
                    <h2>Crop Pricing</h2>"""

new = """<button class="btn" onclick="savePricing()">Save Changes</button>
                        <button class="btn" onclick="exportPricingCSV()" style="background: linear-gradient(135deg, #4CAF50, #45a049); color: white; border: none;">Export CSV</button>
                    </div>
                </div>
                
                <!-- AI Assistant Alert -->
                <div id="ai-pricing-alert" style="display: none;"></div>
                
                <div class="card">
                    <h2>Crop Pricing</h2>"""

if old in content:
    content = content.replace(old, new, 1)
    with open(filepath, 'w') as f:
        f.write(content)
    print('Export CSV button: ADDED')
else:
    print('Export CSV button: NOT FOUND')
