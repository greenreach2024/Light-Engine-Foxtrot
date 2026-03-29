#!/usr/bin/env python3
"""Add SCOTT social push to purchase.js after producer welcome emails."""
import os

path = os.path.join(os.path.dirname(__file__), '..', 'routes', 'purchase.js')
with open(path, 'r') as f:
    content = f.read()

scott_block = """
    // Push social notification via SCOTT for new producer (non-blocking)
    if (!result.existing_account) {
      pushSocialNotification({
        platform: 'linkedin',
        sourceType: 'milestone',
        sourceContext: {
          event: 'new_producer',
          farmName: result.farm_name,
          planType: result.plan_type,
        },
        customInstructions: 'Announce a new farm joining the GreenReach platform. Celebrate the growth of local agriculture. Do not reveal the farm name unless it is clearly a business entity.',
      }).catch(err => console.warn('[SCOTT] New producer social push failed:', err.message));
    }
"""

# There are two spots: demo path (around L376) and production path (around L459)
# Both have the same pattern: after the email try/catch block, before `return res.json(result)` or `res.json(result)`

# Demo path marker: ends with `result.email_sent = false;\n    }\n\n      return res.json(result);`
demo_marker = '      result.email_sent = false;\n    }\n\n      return res.json(result);'
if demo_marker in content and 'SCOTT' not in content[content.find(demo_marker):content.find(demo_marker)+300]:
    content = content.replace(demo_marker, '      result.email_sent = false;\n    }\n' + scott_block + '\n      return res.json(result);', 1)
    print('[purchase.js] Added SCOTT push to demo path')
else:
    print('[purchase.js] Demo path: marker not found or SCOTT already present')

# Production path marker: ends with `result.email_sent = false;\n    }\n\n    res.json(result);`
prod_marker = '      result.email_sent = false;\n    }\n\n    res.json(result);'
if prod_marker in content and 'SCOTT' not in content[content.find(prod_marker):content.find(prod_marker)+300]:
    content = content.replace(prod_marker, '      result.email_sent = false;\n    }\n' + scott_block + '\n    res.json(result);', 1)
    print('[purchase.js] Added SCOTT push to production path')
else:
    print('[purchase.js] Production path: marker not found or SCOTT already present')

with open(path, 'w') as f:
    f.write(content)

print('Done.')
