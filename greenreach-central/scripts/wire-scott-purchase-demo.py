#!/usr/bin/env python3
"""Add SCOTT social push to purchase.js demo path."""
import os

path = os.path.join(os.path.dirname(__file__), '..', 'routes', 'purchase.js')
with open(path, 'r') as f:
    lines = f.readlines()

# Find the demo path return: the first `return res.json(result);` after "Demo mode"
demo_mode_line = None
for i, line in enumerate(lines):
    if 'Demo mode' in line or 'Demo session' in line:
        demo_mode_line = i
        break

if demo_mode_line:
    # Find the first `return res.json(result)` after demo_mode_line
    for i in range(demo_mode_line, min(demo_mode_line + 50, len(lines))):
        if 'return res.json(result)' in lines[i]:
            # Check if SCOTT push already exists before this line
            preceding = ''.join(lines[max(0, i-10):i])
            if 'SCOTT' in preceding:
                print('[purchase.js] SCOTT push already present in demo path')
                break
            
            # Insert SCOTT block before the return
            scott_lines = [
                '\n',
                '      // Push social notification via SCOTT for new producer (non-blocking)\n',
                '      if (!result.existing_account) {\n',
                '        pushSocialNotification({\n',
                "          platform: 'linkedin',\n",
                "          sourceType: 'milestone',\n",
                '          sourceContext: {\n',
                "            event: 'new_producer',\n",
                '            farmName: result.farm_name,\n',
                '            planType: result.plan_type,\n',
                '          },\n',
                "          customInstructions: 'Announce a new farm joining the GreenReach platform. Celebrate the growth of local agriculture. Do not reveal the farm name unless it is clearly a business entity.',\n",
                "        }).catch(err => console.warn('[SCOTT] New producer social push failed:', err.message));\n",
                '      }\n',
            ]
            for j, sl in enumerate(scott_lines):
                lines.insert(i + j, sl)
            print(f'[purchase.js] Added SCOTT push to demo path at line {i+1}')
            break
    else:
        print('[purchase.js] Could not find return res.json in demo path')
else:
    print('[purchase.js] Could not find Demo mode marker')

with open(path, 'w') as f:
    f.writelines(lines)

print('Done.')
