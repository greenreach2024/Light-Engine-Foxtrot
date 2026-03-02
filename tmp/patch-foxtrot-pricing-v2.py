#!/usr/bin/env python3
"""Patch Foxtrot public/farm-admin.js — replace loadCropsFromDatabase with API-first version + add exportPricingCSV."""
import re, sys

filepath = '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot/public/farm-admin.js'
with open(filepath, 'r') as f:
    content = f.read()

# Find and replace the entire loadCropsFromDatabase function
# It starts with "async function loadCropsFromDatabase()" and ends before "function convertPrice"
pattern = r'(\/\*\*\n \* Load unique crops from groups data\n \*\/\n)?async function loadCropsFromDatabase\(\) \{.*?\n\}\n\n(\/\*\*\n \* Convert price between oz and 25g)'

replacement = '''/**
 * Load crops and pricing — API first, localStorage fallback
 */
async function loadCropsFromDatabase() {
    try {
        // Try loading from server-side pricing API first
        let loadedFromAPI = false;
        try {
            const pricingRes = await fetch(`${API_BASE}/crop-pricing`);
            if (pricingRes.ok) {
                const pricingResult = await pricingRes.json();
                if (pricingResult.ok && pricingResult.pricing?.crops?.length) {
                    // Map API fields to frontend field names
                    pricingData = pricingResult.pricing.crops.map(c => ({
                        crop: c.crop,
                        retail: c.retailPrice || 0,
                        ws1Discount: c.ws1Discount ?? 15,
                        ws2Discount: c.ws2Discount ?? 25,
                        ws3Discount: c.ws3Discount ?? 35,
                        isTaxable: c.isTaxable || false
                    }));
                    // Cache to localStorage
                    pricingData.forEach(item => {
                        localStorage.setItem(`pricing_${item.crop}`, JSON.stringify(item));
                    });
                    loadedFromAPI = true;
                    console.log(`Pricing loaded from API: ${pricingData.length} crops`);
                }
            }
        } catch (apiErr) {
            console.warn('Pricing API unavailable, falling back to localStorage:', apiErr.message);
        }

        // Fallback: load from groups.json + localStorage defaults
        if (!loadedFromAPI) {
            const savedVersion = localStorage.getItem('pricing_version');
            if (savedVersion !== PRICING_VERSION) {
                console.log(` Pricing version mismatch (${savedVersion} → ${PRICING_VERSION}). Clearing old prices...`);
                Object.keys(localStorage).forEach(key => {
                    if (key.startsWith('pricing_')) localStorage.removeItem(key);
                });
                localStorage.setItem('pricing_version', PRICING_VERSION);
            }

            const response = await fetch(`${API_BASE}/data/groups.json`);
            const data = await response.json();
            const crops = [...new Set(data.groups.map(g => g.crop).filter(c => c && c.trim()))].sort();

            pricingData = crops.map(crop => {
                const saved = localStorage.getItem(`pricing_${crop}`);
                if (saved) return JSON.parse(saved);
                const defaults = defaultPricing[crop] || { retail: 10.00, ws1: 15, ws2: 25, ws3: 35 };
                return { crop, retail: defaults.retail, ws1Discount: defaults.ws1, ws2Discount: defaults.ws2, ws3Discount: defaults.ws3, isTaxable: false };
            });
        }

        renderPricingTable();
    } catch (error) {
        console.error(' Error loading crops:', error);
        pricingData = [];
        console.warn('Pricing: no crops loaded — farm may not have crops assigned yet.');
        renderPricingTable();
    }
}

/**
 * Export pricing data as CSV download
 */
function exportPricingCSV() {
    if (!pricingData.length) { alert('No pricing data to export.'); return; }
    const unitLabel = isPerGram ? '/25g' : '/oz';
    const rows = [['Crop', `Retail (${unitLabel})`, 'WS1 Discount %', `WS1 Price (${unitLabel})`, 'WS2 Discount %', `WS2 Price (${unitLabel})`, 'WS3 Discount %', `WS3 Price (${unitLabel})`, 'Taxable']];
    pricingData.forEach(item => {
        const r = isPerGram ? convertPrice(item.retail, true) : item.retail;
        rows.push([
            item.crop, r.toFixed(2),
            item.ws1Discount, calculateWholesalePrice(r, item.ws1Discount).toFixed(2),
            item.ws2Discount, calculateWholesalePrice(r, item.ws2Discount).toFixed(2),
            item.ws3Discount, calculateWholesalePrice(r, item.ws3Discount).toFixed(2),
            item.isTaxable ? 'Yes' : 'No'
        ]);
    });
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `crop-pricing-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

\\2'''

result, count = re.subn(pattern, replacement, content, count=1, flags=re.DOTALL)

if count > 0:
    with open(filepath, 'w') as f:
        f.write(result)
    print(f'loadCropsFromDatabase + exportPricingCSV: REPLACED ({count} match)')
else:
    print('NOT FOUND — trying alternative pattern')
    # Try simpler marker approach
    start_marker = 'async function loadCropsFromDatabase() {'
    end_marker = '\n/**\n * Convert price between oz and 25g'
    
    start_idx = content.find(start_marker)
    end_idx = content.find(end_marker, start_idx)
    
    if start_idx == -1:
        print(f'ERROR: Could not find start marker')
        sys.exit(1)
    if end_idx == -1:
        print(f'ERROR: Could not find end marker')
        sys.exit(1)
    
    # Also include the doc comment before the function if present
    doc_start = content.rfind('/**\n * Load', max(0, start_idx - 200), start_idx)
    if doc_start != -1:
        start_idx = doc_start
    
    new_fn = '''/**
 * Load crops and pricing — API first, localStorage fallback
 */
async function loadCropsFromDatabase() {
    try {
        // Try loading from server-side pricing API first
        let loadedFromAPI = false;
        try {
            const pricingRes = await fetch(`${API_BASE}/crop-pricing`);
            if (pricingRes.ok) {
                const pricingResult = await pricingRes.json();
                if (pricingResult.ok && pricingResult.pricing?.crops?.length) {
                    pricingData = pricingResult.pricing.crops.map(c => ({
                        crop: c.crop,
                        retail: c.retailPrice || 0,
                        ws1Discount: c.ws1Discount ?? 15,
                        ws2Discount: c.ws2Discount ?? 25,
                        ws3Discount: c.ws3Discount ?? 35,
                        isTaxable: c.isTaxable || false
                    }));
                    pricingData.forEach(item => {
                        localStorage.setItem(`pricing_${item.crop}`, JSON.stringify(item));
                    });
                    loadedFromAPI = true;
                    console.log(`Pricing loaded from API: ${pricingData.length} crops`);
                }
            }
        } catch (apiErr) {
            console.warn('Pricing API unavailable, falling back to localStorage:', apiErr.message);
        }

        if (!loadedFromAPI) {
            const savedVersion = localStorage.getItem('pricing_version');
            if (savedVersion !== PRICING_VERSION) {
                Object.keys(localStorage).forEach(key => {
                    if (key.startsWith('pricing_')) localStorage.removeItem(key);
                });
                localStorage.setItem('pricing_version', PRICING_VERSION);
            }

            const response = await fetch(`${API_BASE}/data/groups.json`);
            const data = await response.json();
            const crops = [...new Set(data.groups.map(g => g.crop).filter(c => c && c.trim()))].sort();

            pricingData = crops.map(crop => {
                const saved = localStorage.getItem(`pricing_${crop}`);
                if (saved) return JSON.parse(saved);
                const defaults = defaultPricing[crop] || { retail: 10.00, ws1: 15, ws2: 25, ws3: 35 };
                return { crop, retail: defaults.retail, ws1Discount: defaults.ws1, ws2Discount: defaults.ws2, ws3Discount: defaults.ws3, isTaxable: false };
            });
        }

        renderPricingTable();
    } catch (error) {
        console.error(' Error loading crops:', error);
        pricingData = [];
        console.warn('Pricing: no crops loaded — farm may not have crops assigned yet.');
        renderPricingTable();
    }
}

/**
 * Export pricing data as CSV download
 */
function exportPricingCSV() {
    if (!pricingData.length) { alert('No pricing data to export.'); return; }
    const unitLabel = isPerGram ? '/25g' : '/oz';
    const rows = [['Crop', `Retail (${unitLabel})`, 'WS1 Discount %', `WS1 Price (${unitLabel})`, 'WS2 Discount %', `WS2 Price (${unitLabel})`, 'WS3 Discount %', `WS3 Price (${unitLabel})`, 'Taxable']];
    pricingData.forEach(item => {
        const r = isPerGram ? convertPrice(item.retail, true) : item.retail;
        rows.push([
            item.crop, r.toFixed(2),
            item.ws1Discount, calculateWholesalePrice(r, item.ws1Discount).toFixed(2),
            item.ws2Discount, calculateWholesalePrice(r, item.ws2Discount).toFixed(2),
            item.ws3Discount, calculateWholesalePrice(r, item.ws3Discount).toFixed(2),
            item.isTaxable ? 'Yes' : 'No'
        ]);
    });
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `crop-pricing-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}
'''
    
    content = content[:start_idx] + new_fn + content[end_idx:]
    with open(filepath, 'w') as f:
        f.write(content)
    print('loadCropsFromDatabase + exportPricingCSV: REPLACED (via marker method)')
