#!/usr/bin/env python3
"""Patch Foxtrot public/farm-admin.js with Page 7 crop pricing API-first loading + CSV export."""
import sys

filepath = '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot/public/farm-admin.js'
with open(filepath, 'r') as f:
    content = f.read()

changes = 0

# 1. Replace loadCropsFromDatabase to load from API first
old1 = """/**
 * Load unique crops from groups data
 */
async function loadCropsFromDatabase() {
    try {
        // Check pricing version and clear old localStorage if needed
        const savedVersion = localStorage.getItem('pricing_version');
        if (savedVersion !== PRICING_VERSION) {
            console.log(` Pricing version mismatch (${savedVersion} \u2192 ${PRICING_VERSION}). Clearing old prices...`);
            // Clear all pricing keys
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith('pricing_')) {
                    localStorage.removeItem(key);
                }
            });
            localStorage.setItem('pricing_version', PRICING_VERSION);
            console.log(' Pricing cache cleared. Loading new defaults.');
        }
        
        const response = await fetch(`${API_BASE}/data/groups.json`);
        const data = await response.json();
        
        // Extract unique crop names (filter empty strings for farms with no crops yet)
        const crops = [...new Set(data.groups.map(g => g.crop).filter(c => c && c.trim()))].sort();
        
        // Initialize pricing data
        pricingData = crops.map(crop => {
            const saved = localStorage.getItem(`pricing_${crop}`);
            if (saved) {
                return JSON.parse(saved);
            }
            
            // Use defaults or initialize
            const defaults = defaultPricing[crop] || { retail: 10.00, ws1: 15, ws2: 25, ws3: 35 };
            return {
                crop,
                retail: defaults.retail,
                ws1Discount: defaults.ws1,
                ws2Discount: defaults.ws2,
                ws3Discount: defaults.ws3,
                isTaxable: false
            };
        });
        
        renderPricingTable();
        
    } catch (error) {
        console.error(' Error loading crops:', error);
        
        // Fallback: show empty pricing table (no phantom crops for new farms)
        pricingData = [];
        console.warn('Pricing: no crops loaded \u2014 farm may not have crops assigned yet.');
        
        renderPricingTable();
    }
}"""

new1 = """/**
 * Load crops and pricing \u2014 API first, localStorage fallback
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
                console.log(` Pricing version mismatch (${savedVersion} \u2192 ${PRICING_VERSION}). Clearing old prices...`);
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
        console.warn('Pricing: no crops loaded \u2014 farm may not have crops assigned yet.');
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
}"""

if old1 in content:
    content = content.replace(old1, new1, 1)
    changes += 1
    print('1. loadCropsFromDatabase + exportPricingCSV: REPLACED')
else:
    print('1. loadCropsFromDatabase: NOT FOUND')

if changes > 0:
    with open(filepath, 'w') as f:
        f.write(content)
    print(f'\nDone: {changes}/1 changes applied')
else:
    print('\nERROR: No changes applied')
    sys.exit(1)
