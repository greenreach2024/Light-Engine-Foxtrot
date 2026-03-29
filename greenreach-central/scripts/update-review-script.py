#!/usr/bin/env python3
"""Append 3 new email templates to the review script."""
import os

path = os.path.join(os.path.dirname(__file__), 'send-all-notifications-review.js')
with open(path, 'r') as f:
    content = f.read()

# 1. Add import for the 3 new template functions at the top (after SES import)
import_anchor = "import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';"
new_import = import_anchor + "\nimport { sendBuyerWelcomeEmail, sendBuyerMonthlyStatement, sendProducerMonthlyStatement } from '../services/email-new-templates.js';"
if 'email-new-templates' not in content:
    content = content.replace(import_anchor, new_import, 1)
    print('[1] Added import for new templates')
else:
    print('[1] Import already present')

# 2. Find the "Run All" section and insert 3 new template functions before it
run_all_marker = "// ── Run All ─────────────────────────────────────────────────────────"

new_templates = '''
// ── 6. Buyer Welcome Email ──────────────────────────────────────────
async function sendBuyerWelcome() {
  const mockSendEmail = async ({ to, subject, html, text }) => {
    await send({ subject: '[REVIEW 6/8] ' + subject, html, text });
    return { sent: true };
  };
  await sendBuyerWelcomeEmail(mockSendEmail, {
    email: REVIEW_EMAIL,
    businessName: 'Riverside Market Co.',
    contactName: 'Dana Mitchell',
    buyerType: 'restaurant',
  });
}

// ── 7. Buyer Monthly Statement ──────────────────────────────────────
async function sendBuyerStatement() {
  const mockSendEmail = async ({ to, subject, html, text }) => {
    await send({ subject: '[REVIEW 7/8] ' + subject, html, text });
    return { sent: true };
  };
  await sendBuyerMonthlyStatement(mockSendEmail, {
    email: REVIEW_EMAIL,
    businessName: 'Riverside Market Co.',
    contactName: 'Dana Mitchell',
    statementMonth: 'March 2026',
    statementPeriod: 'Mar 1 - Mar 31, 2026',
    lineItems: [
      {
        orderDate: '2026-03-04',
        orderId: 'WO-20260304-001',
        productName: 'Butterhead Lettuce',
        farmName: 'The Notable Sprout',
        lotCode: 'TNS-20260302-001',
        harvestDate: '2026-03-02',
        quantity: '5 lb',
        weightGrams: 2268,
        unitPrice: 4.25,
        lineTotal: 21.25,
        esgScore: 88,
        esgGrade: 'A',
      },
      {
        orderDate: '2026-03-04',
        orderId: 'WO-20260304-001',
        productName: 'Red Leaf Lettuce',
        farmName: 'The Notable Sprout',
        lotCode: 'TNS-20260303-002',
        harvestDate: '2026-03-03',
        quantity: '3 lb',
        weightGrams: 1361,
        unitPrice: 4.50,
        lineTotal: 13.50,
        esgScore: 88,
        esgGrade: 'A',
      },
      {
        orderDate: '2026-03-11',
        orderId: 'WO-20260311-003',
        productName: 'Baby Spinach',
        farmName: 'Sunrise Valley Farm',
        lotCode: 'SVF-20260309-004',
        harvestDate: '2026-03-09',
        quantity: '4 lb',
        weightGrams: 1814,
        unitPrice: 5.75,
        lineTotal: 23.00,
        esgScore: 72,
        esgGrade: 'B',
      },
      {
        orderDate: '2026-03-18',
        orderId: 'WO-20260318-007',
        productName: 'Microgreens Mix',
        farmName: 'Urban Leaf Co.',
        lotCode: 'ULC-20260317-001',
        harvestDate: '2026-03-17',
        quantity: '2 lb',
        weightGrams: 907,
        unitPrice: 12.00,
        lineTotal: 24.00,
        esgScore: 65,
        esgGrade: 'C',
      },
      {
        orderDate: '2026-03-25',
        orderId: 'WO-20260325-012',
        productName: 'Butterhead Lettuce',
        farmName: 'The Notable Sprout',
        lotCode: 'TNS-20260323-005',
        harvestDate: '2026-03-23',
        quantity: '5 lb',
        weightGrams: 2268,
        unitPrice: 4.25,
        lineTotal: 21.25,
        esgScore: 88,
        esgGrade: 'A',
      },
    ],
    totals: {
      subtotal: 103.00,
      discountAmount: 0,
      discountPercent: 0,
      brokerFee: 12.36,
      grandTotal: 103.00,
    },
    environmentalSummary: {
      avgScore: 80,
      avgGrade: 'B',
      avgFoodMiles: 12,
      avgCarbonPerKg: 1.4,
      totalOrders: 5,
    },
    discountTier: {
      currentSpend: 103.00,
      tierName: '$0 - $249',
      discountPercent: 0,
      nextTierAt: 250,
      nextTierDiscount: 4,
    },
  });
}

// ── 8. Producer Monthly Statement ───────────────────────────────────
async function sendProducerStatement() {
  const mockSendEmail = async ({ to, subject, html, text }) => {
    await send({ subject: '[REVIEW 8/8] ' + subject, html, text });
    return { sent: true };
  };
  await sendProducerMonthlyStatement(mockSendEmail, {
    email: REVIEW_EMAIL,
    farmName: 'The Notable Sprout',
    contactName: 'Peter',
    farmId: 'FARM-MLTP9LVH-B0B85039',
    statementMonth: 'March 2026',
    statementPeriod: 'Mar 1 - Mar 31, 2026',
    lineItems: [
      {
        orderDate: '2026-03-04',
        orderId: 'WO-20260304-001',
        productName: 'Butterhead Lettuce',
        buyerName: 'Riverside Market Co.',
        lotCode: 'TNS-20260302-001',
        harvestDate: '2026-03-02',
        quantity: '5 lb',
        weightGrams: 2268,
        unitPrice: 4.25,
        lineTotal: 21.25,
      },
      {
        orderDate: '2026-03-04',
        orderId: 'WO-20260304-001',
        productName: 'Red Leaf Lettuce',
        buyerName: 'Riverside Market Co.',
        lotCode: 'TNS-20260303-002',
        harvestDate: '2026-03-03',
        quantity: '3 lb',
        weightGrams: 1361,
        unitPrice: 4.50,
        lineTotal: 13.50,
      },
      {
        orderDate: '2026-03-11',
        orderId: 'WO-20260311-003',
        productName: 'Baby Spinach',
        buyerName: 'Green Table Bistro',
        lotCode: 'TNS-20260309-007',
        harvestDate: '2026-03-09',
        quantity: '8 lb',
        weightGrams: 3629,
        unitPrice: 5.75,
        lineTotal: 46.00,
      },
      {
        orderDate: '2026-03-25',
        orderId: 'WO-20260325-012',
        productName: 'Butterhead Lettuce',
        buyerName: 'Riverside Market Co.',
        lotCode: 'TNS-20260323-005',
        harvestDate: '2026-03-23',
        quantity: '5 lb',
        weightGrams: 2268,
        unitPrice: 4.25,
        lineTotal: 21.25,
      },
    ],
    totals: {
      grossRevenue: 102.00,
      brokerFee: 12.24,
      netRevenue: 89.76,
      totalOrders: 4,
    },
    esgAssessment: {
      totalScore: 88,
      grade: 'A',
      environmental: { score: 92, breakdown: { energy_efficiency: 90, water_usage: 95, carbon_footprint: 91, food_miles: 94 } },
      social: { score: 82, breakdown: { labor_practices: 80, community: 85, certifications: 80 } },
      governance: { score: 85, breakdown: { transparency: 88, compliance: 82, traceability: 86 } },
    },
    environmentalComparison: {
      farmFoodMiles: 8,
      farmCarbonPerKg: 1.1,
    },
  });
}

'''

if 'sendBuyerWelcome' not in content:
    content = content.replace(run_all_marker, new_templates + run_all_marker)
    print('[2] Added 3 new template functions')
else:
    print('[2] Template functions already present')

# 3. Update the main() function to include the 3 new sends
old_main = """async function main() {
  console.log(`\\nSending all 5 notification templates to ${REVIEW_EMAIL}...\\n`);

  try {
    console.log('[1/5] Welcome Email (new subscriber onboarding)');
    await sendWelcome();
    await pause(1000);

    console.log('[2/5] Team Invite Email (admin invites team member)');
    await sendInvite();
    await pause(1000);

    console.log('[3/5] Order Confirmation (wholesale buyer)');
    await sendOrderConfirmation();
    await pause(1000);

    console.log('[4/5] Payment Confirmed (Square webhook)');
    await sendPaymentConfirmed();
    await pause(1000);

    console.log('[5/5] Nightly Audit Alert (system health)');
    await sendAuditAlert();

    console.log(`\\nAll 5 notifications sent to ${REVIEW_EMAIL}. Check inbox.\\n`);
  } catch (err) {
    console.error('Failed:', err.message);
    process.exit(1);
  }
}"""

new_main = """async function main() {
  console.log(`\\nSending all 8 notification templates to ${REVIEW_EMAIL}...\\n`);

  try {
    console.log('[1/8] Welcome Email (new subscriber onboarding)');
    await sendWelcome();
    await pause(1000);

    console.log('[2/8] Team Invite Email (admin invites team member)');
    await sendInvite();
    await pause(1000);

    console.log('[3/8] Order Confirmation (wholesale buyer)');
    await sendOrderConfirmation();
    await pause(1000);

    console.log('[4/8] Payment Confirmed (Square webhook)');
    await sendPaymentConfirmed();
    await pause(1000);

    console.log('[5/8] Nightly Audit Alert (system health)');
    await sendAuditAlert();
    await pause(1000);

    console.log('[6/8] Buyer Welcome Email (new wholesale buyer)');
    await sendBuyerWelcome();
    await pause(1000);

    console.log('[7/8] Buyer Monthly Statement (itemized + ESG + GAP)');
    await sendBuyerStatement();
    await pause(1000);

    console.log('[8/8] Producer Monthly Statement (revenue + ESG breakdown)');
    await sendProducerStatement();

    console.log(`\\nAll 8 notifications sent to ${REVIEW_EMAIL}. Check inbox.\\n`);
  } catch (err) {
    console.error('Failed:', err.message);
    process.exit(1);
  }
}"""

if old_main in content:
    content = content.replace(old_main, new_main, 1)
    print('[3] Updated main() to include 8 templates')
else:
    print('[3] WARNING: Could not find old main() to replace')

with open(path, 'w') as f:
    f.write(content)

print('Done.')
