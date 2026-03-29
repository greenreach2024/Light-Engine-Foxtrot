#!/usr/bin/env python3
"""Wire sendBuyerWelcomeEmail into wholesale.js buyer registration."""
import os

path = os.path.join(os.path.dirname(__file__), '..', 'routes', 'wholesale.js')
with open(path, 'r') as f:
    content = f.read()

# 1. Add import for sendBuyerWelcomeEmail after the email-service import
old_import = "import emailService from '../services/email-service.js';"
new_import = old_import + "\nimport { sendBuyerWelcomeEmail } from '../services/email.js';"
if 'sendBuyerWelcomeEmail' not in content:
    content = content.replace(old_import, new_import, 1)
    print('[1] Added sendBuyerWelcomeEmail import')
else:
    print('[1] Import already present, skipping')

# 2. Replace plain-text welcome email with polished HTML version
old_email = """    // Send welcome email (non-blocking)
    emailService.sendEmail({
      to: buyer.email,
      subject: 'Welcome to GreenReach Wholesale',
      text: `Hi ${buyer.contactName || buyer.businessName},\\n\\nYour wholesale buyer account has been created.\\n\\nYou can now browse the catalog and place orders.\\n\\n\u2014 GreenReach Farms`
    }).catch(err => console.warn('[Email] Welcome email failed:', err.message));"""

new_email = """    // Send polished welcome email (non-blocking)
    sendBuyerWelcomeEmail({
      email: buyer.email,
      businessName: buyer.businessName || buyer.business_name,
      contactName: buyer.contactName || buyer.contact_name,
      buyerType: buyer.buyerType || buyer.buyer_type
    }).catch(err => console.warn('[Email] Buyer welcome email failed:', err.message));"""

if old_email in content:
    content = content.replace(old_email, new_email, 1)
    print('[2] Replaced plain-text welcome email with sendBuyerWelcomeEmail')
else:
    print('[2] WARNING: Could not find old email block to replace')

with open(path, 'w') as f:
    f.write(content)

print('Done.')
