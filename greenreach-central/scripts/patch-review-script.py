#!/usr/bin/env python3
"""Add the 3 new notification review functions (6-8) to send-all-notifications-review.js"""
import os

path = os.path.join(os.path.dirname(__file__), 'send-all-notifications-review.js')
with open(path, 'r') as f:
    content = f.read()

# Update subject prefixes from /5 to /8
content = content.replace("[REVIEW 1/5]", "[REVIEW 1/8]")
content = content.replace("[REVIEW 2/5]", "[REVIEW 2/8]")
content = content.replace("[REVIEW 3/5]", "[REVIEW 3/8]")
content = content.replace("[REVIEW 4/5]", "[REVIEW 4/8]")
content = content.replace("[REVIEW 5/5]", "[REVIEW 5/8]")

# Find the marker for the "Run All" section and insert the 3 new functions before it
new_functions = r'''
// ── 6. Buyer Welcome Email (new wholesale buyer) ────────────────────
async function sendBuyerWelcome() {
  // Intercept the sendEmail call to capture HTML, then re-send with REVIEW prefix
  const captured = {};
  const mockSendEmail = async ({ to, subject, html, text }) => {
    captured.subject = subject;
    captured.html = html;
    captured.text = text;
    return { MessageId: 'mock' };
  };

  await sendBuyerWelcomeEmail(mockSendEmail, {
    email: REVIEW_EMAIL,
    businessName: 'Fresh Market Co-op',
    contactName: 'Jordan Adler',
    buyerType: 'grocery',
  });

  await send({
    subject: '[REVIEW 6/8] ' + captured.subject,
    html: captured.html,
    text: captured.text,
  });
}

// ── 7. Buyer Monthly Statement ──────────────────────────────────────
async function sendBuyerStatement() {
  const captured = {};
  const mockSendEmail = async ({ to, subject, html, text }) => {
    captured.subject = subject;
    captured.html = html;
    captured.text = text;
    return { MessageId: 'mock' };
  };

  await sendBuyerMonthlyStatement(mockSendEmail, {
    email: REVIEW_EMAIL,
    businessName: 'Fresh Market Co-op',
    contactName: 'Jordan Adler',
    statementMonth: 'March 2026',
    statementPeriod: 'Mar 1 - Mar 31, 2026',
    lineItems: [
      {
        orderDate: 'Mar 4',
        orderId: 'ORD-2026-0304-B2C1',
        productName: 'Organic Basil (1 lb)',
        farmName: 'The Notable Sprout',
        lotCode: 'TNS-20260302-001',
        harvestDate: 'Mar 2',
        quantity: 12,
        unit: 'lb',
        weightGrams: 5443,
        unitPrice: 8.50,
        lineTotal: 102.00,
        esgScore: 88,
        esgGrade: 'A',
      },
      {
        orderDate: 'Mar 4',
        orderId: 'ORD-2026-0304-B2C1',
        productName: 'Mixed Microgreens Tray',
        farmName: 'The Notable Sprout',
        lotCode: 'TNS-20260303-002',
        harvestDate: 'Mar 3',
        quantity: 8,
        unit: 'tray',
        weightGrams: 1360,
        unitPrice: 14.00,
        lineTotal: 112.00,
        esgScore: 92,
        esgGrade: 'A',
      },
      {
        orderDate: 'Mar 11',
        orderId: 'ORD-2026-0311-D4F8',
        productName: 'Lettuce Blend (2 lb)',
        farmName: 'Riverside Greens',
        lotCode: 'RSG-20260309-004',
        harvestDate: 'Mar 9',
        quantity: 20,
        unit: 'bag',
        weightGrams: 18144,
        unitPrice: 6.75,
        lineTotal: 135.00,
        esgScore: 74,
        esgGrade: 'B',
      },
      {
        orderDate: 'Mar 18',
        orderId: 'ORD-2026-0318-A1E2',
        productName: 'Organic Basil (1 lb)',
        farmName: 'The Notable Sprout',
        lotCode: 'TNS-20260316-008',
        harvestDate: 'Mar 16',
        quantity: 10,
        unit: 'lb',
        weightGrams: 4536,
        unitPrice: 8.50,
        lineTotal: 85.00,
        esgScore: 88,
        esgGrade: 'A',
      },
      {
        orderDate: 'Mar 25',
        orderId: 'ORD-2026-0325-C3G9',
        productName: 'Cilantro Bunch',
        farmName: 'Valley Herb Farm',
        lotCode: 'VHF-20260323-003',
        harvestDate: 'Mar 23',
        quantity: 15,
        unit: 'bunch',
        weightGrams: 2268,
        unitPrice: 3.50,
        lineTotal: 52.50,
        esgScore: 62,
        esgGrade: 'C',
      },
    ],
    totals: {
      subtotal: 486.50,
      discountPercent: 4,
      discountAmount: 19.46,
      total: 467.04,
    },
    environmentalSummary: {
      avgFoodMiles: 42,
      avgCarbonKg: 0.8,
      totalOrders: 4,
      topGrade: 'A',
    },
    discountTier: {
      label: '$250 - $499',
      percent: 4,
      nextTier: '$500 - $999',
      nextPercent: 6,
      amountToNext: 32.96,
    },
  });

  await send({
    subject: '[REVIEW 7/8] ' + captured.subject,
    html: captured.html,
    text: captured.text,
  });
}

// ── 8. Producer Monthly Statement ───────────────────────────────────
async function sendProducerStatement() {
  const captured = {};
  const mockSendEmail = async ({ to, subject, html, text }) => {
    captured.subject = subject;
    captured.html = html;
    captured.text = text;
    return { MessageId: 'mock' };
  };

  await sendProducerMonthlyStatement(mockSendEmail, {
    email: REVIEW_EMAIL,
    farmName: 'The Notable Sprout',
    contactName: 'Peter Gilbert',
    farmId: 'FARM-MLTP9LVH-B0B85039',
    statementMonth: 'March 2026',
    statementPeriod: 'Mar 1 - Mar 31, 2026',
    lineItems: [
      {
        orderDate: 'Mar 4',
        orderId: 'ORD-2026-0304-B2C1',
        productName: 'Organic Basil (1 lb)',
        buyerName: 'Fresh Market Co-op',
        lotCode: 'TNS-20260302-001',
        harvestDate: 'Mar 2',
        quantity: 12,
        unit: 'lb',
        weightGrams: 5443,
        unitPrice: 8.50,
        lineTotal: 102.00,
      },
      {
        orderDate: 'Mar 4',
        orderId: 'ORD-2026-0304-B2C1',
        productName: 'Mixed Microgreens Tray',
        buyerName: 'Fresh Market Co-op',
        lotCode: 'TNS-20260303-002',
        harvestDate: 'Mar 3',
        quantity: 8,
        unit: 'tray',
        weightGrams: 1360,
        unitPrice: 14.00,
        lineTotal: 112.00,
      },
      {
        orderDate: 'Mar 11',
        orderId: 'ORD-2026-0311-D4F8',
        productName: 'Organic Basil (1 lb)',
        buyerName: 'Urban Bites Bistro',
        lotCode: 'TNS-20260309-005',
        harvestDate: 'Mar 9',
        quantity: 6,
        unit: 'lb',
        weightGrams: 2722,
        unitPrice: 8.50,
        lineTotal: 51.00,
      },
      {
        orderDate: 'Mar 18',
        orderId: 'ORD-2026-0318-A1E2',
        productName: 'Organic Basil (1 lb)',
        buyerName: 'Fresh Market Co-op',
        lotCode: 'TNS-20260316-008',
        harvestDate: 'Mar 16',
        quantity: 10,
        unit: 'lb',
        weightGrams: 4536,
        unitPrice: 8.50,
        lineTotal: 85.00,
      },
    ],
    totals: {
      grossRevenue: 350.00,
      brokerFee: 42.00,
      brokerFeePercent: 12,
      netRevenue: 308.00,
      totalUnits: 36,
    },
    esgAssessment: {
      totalScore: 88,
      grade: 'A',
      environmental: { score: 92, breakdown: { energy: 'A', water: 'A', carbon: 'A', food_miles: 'A' } },
      social: { score: 78, breakdown: { fair_wages: 'B', community: 'B', training: 'A' } },
      governance: { score: 85, breakdown: { certifications: 'A', traceability: 'A', data_quality: 'B' } },
    },
    environmentalComparison: {
      avgFoodMiles: 38,
      avgCarbonKg: 0.6,
    },
  });

  await send({
    subject: '[REVIEW 8/8] ' + captured.subject,
    html: captured.html,
    text: captured.text,
  });
}

'''

# Insert before the "// ── Run All" section
marker = '// ── Run All'
if marker in content:
    content = content.replace(marker, new_functions + marker)
    print('[OK] Inserted 3 new review functions before Run All section')
else:
    print('[WARN] Could not find Run All marker')

with open(path, 'w') as f:
    f.write(content)

print('Done. Review script updated.')
