#!/usr/bin/env python3
"""Patch public/farm-admin.js to replace AI endpoint calls with Phase 2 placeholders."""
import os

base = '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot'
filepath = os.path.join(base, 'public', 'farm-admin.js')

with open(filepath, 'r') as f:
    content = f.read()

old_block = """        // AI updates count - check for actual AI service data
        let aiUpdates = 0;
        let aiContext = 'AI is active and learning from your farm + network trends.';
        try {
            const aiResp = await fetch(`${API_BASE}/api/ai/insights/count`, {
                headers: { 'Authorization': `Bearer ${currentSession.token}` }
            });
            if (aiResp.ok) {
                const aiData = await aiResp.json();
                aiUpdates = aiData.count || 0;
            }
        } catch (e) {
            // AI service not available, show 0
        }

        // Enrich AI context with network intelligence + suggested crop (Phase 2 UX)
        try {
            const niResp = await fetch(`${API_BASE}/api/ai/network-intelligence`);
            if (niResp.ok) {
                const niData = await niResp.json();
                const ni = niData.network_intelligence || {};
                const benchmarkCount = Object.keys(ni.crop_benchmarks || {}).length;
                const demandCount = Object.keys(ni.demand_signals || {}).length;
                if (benchmarkCount > 0 || demandCount > 0) {
                    aiContext = `Live network signal: ${benchmarkCount} crop benchmarks, ${demandCount} demand signals.`;
                }
            }
        } catch (e) {
            // non-fatal
        }

        try {
            const suggestionResp = await fetch(`${API_BASE}/api/ai/suggested-crop`);
            if (suggestionResp.ok) {
                const suggestionData = await suggestionResp.json();
                const suggestion = suggestionData?.suggestion;
                if (suggestion?.cropName) {
                    const confidencePct = Math.round((suggestion.confidence || 0) * 100);
                    aiContext += ` Suggested next crop: ${suggestion.cropName} (${confidencePct}% confidence).`;
                }
            }
        } catch (e) {
            // non-fatal
        }"""

new_block = """        // AI updates count \u2014 Phase 2 feature, show "Coming Soon" placeholder
        let aiUpdates = '--';
        let aiContext = 'AI insights coming soon \u2014 will learn from your farm + network trends.';
        // Phase 2: uncomment when AI service is deployed
        // try {
        //     const aiResp = await fetch(`${API_BASE}/api/ai/insights/count`, {
        //         headers: { 'Authorization': `Bearer ${currentSession.token}` }
        //     });
        //     if (aiResp.ok) {
        //         const aiData = await aiResp.json();
        //         aiUpdates = aiData.count || 0;
        //     }
        // } catch (e) { /* AI service not available */ }

        // Phase 2: uncomment when network intelligence API is live
        // try {
        //     const niResp = await fetch(`${API_BASE}/api/ai/network-intelligence`);
        //     if (niResp.ok) {
        //         const niData = await niResp.json();
        //         const ni = niData.network_intelligence || {};
        //         const benchmarkCount = Object.keys(ni.crop_benchmarks || {}).length;
        //         const demandCount = Object.keys(ni.demand_signals || {}).length;
        //         if (benchmarkCount > 0 || demandCount > 0) {
        //             aiContext = `Live network signal: ${benchmarkCount} crop benchmarks, ${demandCount} demand signals.`;
        //         }
        //     }
        // } catch (e) { /* non-fatal */ }

        // Phase 2: uncomment when suggested-crop API is live
        // try {
        //     const suggestionResp = await fetch(`${API_BASE}/api/ai/suggested-crop`);
        //     if (suggestionResp.ok) {
        //         const suggestionData = await suggestionResp.json();
        //         const suggestion = suggestionData?.suggestion;
        //         if (suggestion?.cropName) {
        //             const confidencePct = Math.round((suggestion.confidence || 0) * 100);
        //             aiContext += ` Suggested next crop: ${suggestion.cropName} (${confidencePct}% confidence).`;
        //         }
        //     }
        // } catch (e) { /* non-fatal */ }"""

if old_block in content:
    content = content.replace(old_block, new_block, 1)
    with open(filepath, 'w') as f:
        f.write(content)
    print('OK: replaced 1 occurrence')
else:
    print('ERROR: old block not found in file')
    # Try to find partial match
    first_line = old_block.split('\n')[0]
    if first_line in content:
        idx = content.index(first_line)
        print(f'First line found at char {idx}')
        # Show 200 chars of context
        print(repr(content[idx:idx+200]))
    else:
        print('First line not found either')
