#!/usr/bin/env python3
"""Wire SCOTT social push into wholesale.js and purchase.js."""
import os

BASE = os.path.join(os.path.dirname(__file__), '..')

# --- wholesale.js: add SCOTT push after buyer welcome email ---
ws_path = os.path.join(BASE, 'routes', 'wholesale.js')
with open(ws_path, 'r') as f:
    ws = f.read()

# Add import
scott_import = "import { pushSocialNotification } from '../services/scott-social-push.js';"
if scott_import not in ws:
    anchor = "import { sendBuyerWelcomeEmail } from '../services/email.js';"
    ws = ws.replace(anchor, anchor + '\n' + scott_import, 1)
    print('[wholesale.js] Added SCOTT import')
else:
    print('[wholesale.js] SCOTT import already present')

# Add SCOTT push after the buyer welcome email block
scott_call = """
    // Push social notification via SCOTT (non-blocking)
    pushSocialNotification({
      platform: 'linkedin',
      sourceType: 'wholesale',
      sourceContext: {
        event: 'new_buyer',
        businessName: buyer.businessName || buyer.business_name,
        buyerType: buyer.buyerType || buyer.buyer_type,
      },
      customInstructions: 'Announce a new wholesale buyer joining the GreenReach marketplace. Keep it professional and welcoming. Do not reveal the buyer name — just celebrate growth.',
    }).catch(err => console.warn('[SCOTT] New buyer social push failed:', err.message));"""

marker = "    }).catch(err => console.warn('[Email] Buyer welcome email failed:', err.message));"
if 'SCOTT' not in ws[ws.find(marker):ws.find(marker)+500] if marker in ws else '':
    ws = ws.replace(marker, marker + scott_call, 1)
    print('[wholesale.js] Added SCOTT push after buyer welcome email')
else:
    print('[wholesale.js] SCOTT push already present')

with open(ws_path, 'w') as f:
    f.write(ws)

# --- purchase.js: add SCOTT push after producer welcome email ---
pu_path = os.path.join(BASE, 'routes', 'purchase.js')
with open(pu_path, 'r') as f:
    pu = f.read()

# Add import
if scott_import not in pu:
    # Find a good anchor for the import — after the last import line
    import_anchor = "import { query, isDatabaseAvailable } from '../config/database.js';"
    pu = pu.replace(import_anchor, import_anchor + '\n' + scott_import, 1)
    print('[purchase.js] Added SCOTT import')
else:
    print('[purchase.js] SCOTT import already present')

with open(pu_path, 'w') as f:
    f.write(pu)

print('Done. Next: manually add SCOTT call at the right place in purchase.js.')
