#!/usr/bin/env python3
"""Patch public/farm-admin.js to replace AI endpoint calls with Phase 2 placeholders."""
import os

base = '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot'
filepath = os.path.join(base, 'public', 'farm-admin.js')

with open(filepath, 'r') as f:
    lines = f.readlines()

# Find the AI section start and end
start_idx = None
end_idx = None
for i, line in enumerate(lines):
    if '// AI updates count - check for actual AI service data' in line:
        start_idx = i
    if start_idx is not None and i > start_idx and '// non-fatal' in line:
        # Find the closing } after "// non-fatal"
        for j in range(i + 1, min(i + 5, len(lines))):
            if lines[j].strip() == '}':
                end_idx = j + 1
                break
        if end_idx:
            break

if start_idx is None:
    print('ERROR: start marker not found')
    exit(1)
if end_idx is None:
    print('ERROR: end marker not found')
    exit(1)

print(f'Replacing lines {start_idx + 1} to {end_idx} ({end_idx - start_idx} lines)')

new_lines = [
    "        // AI updates count \u2014 Phase 2 feature, show \"Coming Soon\" placeholder\n",
    "        let aiUpdates = '--';\n",
    "        let aiContext = 'AI insights coming soon \u2014 will learn from your farm + network trends.';\n",
    "        // Phase 2: uncomment when AI service is deployed\n",
    "        // try {\n",
    "        //     const aiResp = await fetch(`${API_BASE}/api/ai/insights/count`, {\n",
    "        //         headers: { 'Authorization': `Bearer ${currentSession.token}` }\n",
    "        //     });\n",
    "        //     if (aiResp.ok) {\n",
    "        //         const aiData = await aiResp.json();\n",
    "        //         aiUpdates = aiData.count || 0;\n",
    "        //     }\n",
    "        // } catch (e) { /* AI service not available */ }\n",
    "\n",
    "        // Phase 2: uncomment when network intelligence API is live\n",
    "        // try {\n",
    "        //     const niResp = await fetch(`${API_BASE}/api/ai/network-intelligence`);\n",
    "        //     if (niResp.ok) {\n",
    "        //         const niData = await niResp.json();\n",
    "        //         const ni = niData.network_intelligence || {};\n",
    "        //         const benchmarkCount = Object.keys(ni.crop_benchmarks || {}).length;\n",
    "        //         const demandCount = Object.keys(ni.demand_signals || {}).length;\n",
    "        //         if (benchmarkCount > 0 || demandCount > 0) {\n",
    "        //             aiContext = `Live network signal: ${benchmarkCount} crop benchmarks, ${demandCount} demand signals.`;\n",
    "        //         }\n",
    "        //     }\n",
    "        // } catch (e) { /* non-fatal */ }\n",
    "\n",
    "        // Phase 2: uncomment when suggested-crop API is live\n",
    "        // try {\n",
    "        //     const suggestionResp = await fetch(`${API_BASE}/api/ai/suggested-crop`);\n",
    "        //     if (suggestionResp.ok) {\n",
    "        //         const suggestionData = await suggestionResp.json();\n",
    "        //         const suggestion = suggestionData?.suggestion;\n",
    "        //         if (suggestion?.cropName) {\n",
    "        //             const confidencePct = Math.round((suggestion.confidence || 0) * 100);\n",
    "        //             aiContext += ` Suggested next crop: ${suggestion.cropName} (${confidencePct}% confidence).`;\n",
    "        //         }\n",
    "        //     }\n",
    "        // } catch (e) { /* non-fatal */ }\n",
]

lines[start_idx:end_idx] = new_lines

with open(filepath, 'w') as f:
    f.writelines(lines)

print('OK: replacement done')
