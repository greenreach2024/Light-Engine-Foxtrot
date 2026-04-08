
// =====================================================================
// Buyer Welcome Email -- sent when a new buyer joins wholesale
// =====================================================================

// Business address for CAN-SPAM / CASL compliance (included in all email footers)
const BUSINESS_ADDRESS = 'GreenReach Greens -- Ottawa, ON, Canada';

/**
 * California benchmark constants for environmental comparison.
 * Source: USDA Economic Research Service, average transport distances.
 * California field greens travel ~2,500 miles to Ontario markets.
 * Average carbon intensity: ~8.2 kg CO2/kg (transport + field production).
 */
const CALIFORNIA_BENCHMARK = {
  avg_food_miles: 2500,
  carbon_kg_per_kg: 8.2,
  label: 'California Import Avg'
};

// -- Helper: ESG grade color --
function gradeColor(grade) {
  switch (grade) {
    case 'A': return '#059669';
    case 'B': return '#2563eb';
    case 'C': return '#d97706';
    case 'D': return '#dc2626';
    case 'F': return '#7f1d1d';
    default:  return '#6b7280';
  }
}

/**
 * Send polished welcome email to a new wholesale buyer.
 * @param {Function} sendEmail - The sendEmail function from email.js
 * @param {Object} params
 * @param {string} params.email - Buyer email
 * @param {string} params.businessName - Business name
 * @param {string} params.contactName - Buyer contact name
 * @param {string} params.buyerType - grocery / restaurant / distributor
 */
export async function sendBuyerWelcomeEmail(sendEmail, { email, businessName, contactName, buyerType }) {
  const portalUrl = 'https://greenreachgreens.com/wholesale-portal.html';
  const catalogUrl = 'https://greenreachgreens.com/wholesale-catalog.html';
  const firstName = (contactName || '').split(/\s+/)[0] || 'there';
  const typeLabel = (buyerType || 'business').charAt(0).toUpperCase() + (buyerType || 'business').slice(1);

  const subject = 'Welcome to GreenReach Wholesale -- ' + businessName;

  const html = '<!DOCTYPE html>\n<html>\n<head><meta charset="UTF-8"></head>\n'
    + '<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Oxygen,Ubuntu,sans-serif;">\n'
    + '  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;">\n'
    + '    <tr><td align="center">\n'
    + '      <table width="600" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">\n'
    + '        <tr>\n'
    + '          <td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:32px 40px;text-align:center;">\n'
    + '            <h1 style="color:white;margin:0;font-size:24px;font-weight:700;">Welcome to GreenReach Wholesale</h1>\n'
    + '            <p style="color:#94a3b8;margin:8px 0 0;font-size:14px;">Local produce, harvested today, delivered to you</p>\n'
    + '          </td>\n'
    + '        </tr>\n'
    + '        <tr>\n'
    + '          <td style="padding:32px 40px;">\n'
    + '            <p style="color:#1a202c;font-size:16px;line-height:1.6;margin:0 0 20px;">Hi ' + firstName + ',</p>\n'
    + '            <p style="color:#4a5568;font-size:15px;line-height:1.6;margin:0 0 24px;">\n'
    + '              Your wholesale buyer account for <strong>' + businessName + '</strong> is now active. You can start browsing the catalog and placing orders from local partner farms.\n'
    + '            </p>\n'

    + '            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:2px solid #86efac;border-radius:10px;margin:0 0 24px;">\n'
    + '              <tr><td style="padding:20px 24px;">\n'
    + '                <p style="color:#166534;font-weight:700;font-size:15px;margin:0 0 16px;">What You Get</p>\n'
    + '                <table width="100%" cellspacing="0" cellpadding="0">\n'
    + '                  <tr><td style="padding:8px 0;color:#4a5568;font-size:14px;line-height:1.6;"><strong>Same-day harvest.</strong> Produce travels less than 50 miles, not 1,500+.</td></tr>\n'
    + '                  <tr><td style="padding:8px 0;border-top:1px solid #d1fae5;color:#4a5568;font-size:14px;line-height:1.6;"><strong>Full traceability.</strong> Every item has a lot code -- farm name, harvest date, seed source.</td></tr>\n'
    + '                  <tr><td style="padding:8px 0;border-top:1px solid #d1fae5;color:#4a5568;font-size:14px;line-height:1.6;"><strong>Year-round supply.</strong> Multiple indoor farms means consistent availability, even in winter.</td></tr>\n'
    + '                  <tr><td style="padding:8px 0;border-top:1px solid #d1fae5;color:#4a5568;font-size:14px;line-height:1.6;"><strong>Volume discounts.</strong> Spend $250+/month and your discount unlocks automatically.</td></tr>\n'
    + '                </table>\n'
    + '              </td></tr>\n'
    + '            </table>\n'

    + '            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin:0 0 24px;">\n'
    + '              <tr><td style="padding:20px 24px;">\n'
    + '                <p style="color:#2d3748;font-weight:700;font-size:15px;margin:0 0 14px;">Getting Started</p>\n'
    + '                <p style="color:#4a5568;font-size:14px;line-height:1.7;margin:0 0 8px;"><strong>1.</strong> Browse the catalog to see what is available now</p>\n'
    + '                <p style="color:#4a5568;font-size:14px;line-height:1.7;margin:0 0 8px;"><strong>2.</strong> Add items to your cart and select a delivery date</p>\n'
    + '                <p style="color:#4a5568;font-size:14px;line-height:1.7;margin:0 0 8px;"><strong>3.</strong> Checkout securely via Square -- invoicing also available</p>\n'
    + '                <p style="color:#4a5568;font-size:14px;line-height:1.7;margin:0;"><strong>4.</strong> Receive your produce, harvested the same day you ordered</p>\n'
    + '              </td></tr>\n'
    + '            </table>\n'

    + '            <table width="100%" cellpadding="0" cellspacing="0">\n'
    + '              <tr><td align="center" style="padding:8px 0 24px;">\n'
    + '                <a href="' + catalogUrl + '" style="display:inline-block;background:#10b981;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">Browse the Catalog</a>\n'
    + '              </td></tr>\n'
    + '            </table>\n'

    + '            <p style="color:#64748b;font-size:13px;text-align:center;margin:0 0 8px;">Portal login:</p>\n'
    + '            <p style="text-align:center;margin:0 0 16px;"><a href="' + portalUrl + '" style="color:#3b82f6;font-size:14px;text-decoration:none;font-weight:600;">' + portalUrl + '</a></p>\n'
    + '          </td>\n'
    + '        </tr>\n'
    + '        <tr>\n'
    + '          <td style="background:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;text-align:center;">\n'
    + '            <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;">GreenReach -- The foundation for smarter farms</p>\n'
    + '            <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;">\n'
    + '              <a href="https://greenreachgreens.com" style="color:#64748b;text-decoration:none;">greenreachgreens.com</a> &nbsp;|&nbsp;\n'
    + '              <a href="mailto:info@greenreachgreens.com" style="color:#64748b;text-decoration:none;">info@greenreachgreens.com</a>\n'
    + '            </p>\n'
    + '            <p style="color:#94a3b8;font-size:11px;margin:0;">' + BUSINESS_ADDRESS + '</p>\n'
    + '          </td>\n'
    + '        </tr>\n'
    + '      </table>\n'
    + '    </td></tr>\n'
    + '  </table>\n'
    + '</body>\n</html>';

  const text = 'Welcome to GreenReach Wholesale!\n\n'
    + 'Hi ' + firstName + ',\n\n'
    + 'Your wholesale buyer account for "' + businessName + '" (' + typeLabel + ') is now active.\n\n'
    + 'WHAT YOU GET\n----------------------------------------------\n'
    + '- Same-day harvest. Produce travels <50 miles, not 1,500+.\n'
    + '- Full traceability. Every item has a lot code.\n'
    + '- Year-round supply from multiple indoor farms.\n'
    + '- Volume discounts starting at $250/month.\n\n'
    + 'GETTING STARTED\n----------------------------------------------\n'
    + '1. Browse the catalog: ' + catalogUrl + '\n'
    + '2. Add items and select a delivery date\n'
    + '3. Checkout securely via Square\n'
    + '4. Receive produce harvested the same day\n\n'
    + 'Portal login: ' + portalUrl + '\n\n'
    + '-- GreenReach -- The foundation for smarter farms\ngreenreachgreens.com | info@greenreachgreens.com\n' + BUSINESS_ADDRESS;

  return sendEmail({ to: email, subject, html, text });
}


// =====================================================================
// Monthly Buyer Statement -- itemized with GAP traceability, ESG
// =====================================================================

/**
 * Send monthly statement to a wholesale buyer.
 * GAP-compliant traceability: every line item includes lot code, farm, harvest date.
 * @param {Function} sendEmail - The sendEmail function from email.js
 * @param {Object} params
 * @param {string} params.email - Buyer email
 * @param {string} params.businessName - Buyer business name
 * @param {string} params.contactName - Buyer contact name
 * @param {string} params.statementMonth - e.g. "March 2026"
 * @param {string} params.statementPeriod - e.g. "Mar 1 - Mar 31, 2026"
 * @param {Array} params.lineItems - Order line items with traceability
 * @param {Object} params.totals - { subtotal, discountPercent, discountAmount, brokerFee, grandTotal, itemCount, orderCount }
 * @param {Object} params.environmentalSummary - { avgFoodMiles, carbonKgPerKg, esgScore, esgGrade, totalWeightKg }
 * @param {Object} params.discountTier - { currentSpend, tierName, discountPercent, nextTier, amountToNextTier }
 */
export async function sendBuyerMonthlyStatement(sendEmail, {
  email, businessName, contactName, statementMonth, statementPeriod,
  lineItems, totals, environmentalSummary, discountTier
}) {
  const firstName = (contactName || '').split(/\s+/)[0] || 'there';
  const portalUrl = 'https://greenreachgreens.com/wholesale-portal.html';

  // -- Build itemized line rows --
  const itemRows = (lineItems || []).map(function(item) {
    const costPer100g = item.weightGrams > 0
      ? ((item.lineTotal / item.weightGrams) * 100).toFixed(2)
      : '--';
    return '<tr style="border-bottom:1px solid #e2e8f0;">'
      + '<td style="padding:8px 6px;font-size:12px;color:#6b7280;">' + (item.orderDate || '') + '</td>'
      + '<td style="padding:8px 6px;font-size:13px;color:#1a202c;font-weight:500;">' + (item.productName || '') + '</td>'
      + '<td style="padding:8px 6px;font-size:12px;color:#4a5568;">' + (item.farmName || '') + '</td>'
      + '<td style="padding:8px 6px;font-size:11px;color:#6b7280;font-family:\'SF Mono\',\'Fira Code\',Consolas,monospace;">' + (item.lotCode || 'N/A') + '</td>'
      + '<td style="padding:8px 6px;font-size:12px;color:#6b7280;">' + (item.harvestDate || '') + '</td>'
      + '<td style="padding:8px 6px;font-size:13px;color:#1a202c;text-align:right;">' + item.quantity + ' ' + (item.unit || '') + '</td>'
      + '<td style="padding:8px 6px;font-size:13px;color:#1a202c;text-align:right;">$' + Number(item.unitPrice || 0).toFixed(2) + '</td>'
      + '<td style="padding:8px 6px;font-size:13px;color:#1a202c;text-align:right;font-weight:600;">$' + Number(item.lineTotal || 0).toFixed(2) + '</td>'
      + '<td style="padding:8px 6px;font-size:12px;color:#6b7280;text-align:right;">$' + costPer100g + '</td>'
      + '<td style="padding:8px 6px;font-size:12px;text-align:center;"><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-weight:600;font-size:11px;background:' + gradeColor(item.esgGrade) + ';color:white;">' + (item.esgGrade || '--') + '</span></td>'
      + '</tr>';
  }).join('\n');

  // -- Build text-only item list --
  const itemText = (lineItems || []).map(function(item) {
    const costPer100g = item.weightGrams > 0
      ? ((item.lineTotal / item.weightGrams) * 100).toFixed(2)
      : '--';
    return '  ' + item.orderDate + ' | ' + item.productName + ' | Farm: ' + item.farmName + ' | Lot: ' + (item.lotCode || 'N/A') + ' | Harvested: ' + (item.harvestDate || 'N/A')
      + '\n    ' + item.quantity + ' ' + item.unit + ' @ $' + Number(item.unitPrice||0).toFixed(2) + ' = $' + Number(item.lineTotal||0).toFixed(2) + ' | Cost/100g: $' + costPer100g + ' | ESG: ' + (item.esgGrade || '--');
  }).join('\n');

  // -- ESG comparison --
  const env = environmentalSummary || {};
  const milesSaved = Math.max(0, CALIFORNIA_BENCHMARK.avg_food_miles - (env.avgFoodMiles || 0));
  const carbonSaved = env.totalWeightKg > 0
    ? ((CALIFORNIA_BENCHMARK.carbon_kg_per_kg - (env.carbonKgPerKg || 0)) * env.totalWeightKg).toFixed(1)
    : '0';
  const carbonReduction = CALIFORNIA_BENCHMARK.carbon_kg_per_kg > 0 && env.carbonKgPerKg !== undefined
    ? (((CALIFORNIA_BENCHMARK.carbon_kg_per_kg - env.carbonKgPerKg) / CALIFORNIA_BENCHMARK.carbon_kg_per_kg) * 100).toFixed(0)
    : '--';

  // -- Discount tier block --
  const disc = discountTier || {};
  const tierHtml = disc.nextTier
    ? '<p style="color:#4a5568;font-size:13px;margin:8px 0 0;">Spend $' + Number(disc.amountToNextTier || 0).toFixed(2) + ' more this month to unlock <strong>' + disc.nextTier + '</strong>.</p>'
    : '';

  const subject = 'GreenReach Wholesale Statement -- ' + statementMonth + ' -- ' + businessName;

  // -- Discount row in totals --
  const discountRow = totals.discountAmount > 0
    ? '<tr><td style="padding:4px 0;color:#059669;font-size:13px;">Volume Discount (' + totals.discountPercent + '%)</td>'
      + '<td style="padding:4px 0;text-align:right;color:#059669;font-size:13px;">-$' + Number(totals.discountAmount || 0).toFixed(2) + '</td></tr>'
    : '';

  // -- Discount tier section --
  const tierSection = disc.tierName
    ? '<tr><td style="padding:16px 40px 0;">'
      + '<table width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;">'
      + '<tr><td style="padding:14px 20px;">'
      + '<p style="color:#1e40af;font-weight:600;font-size:14px;margin:0;">Current Tier: ' + disc.tierName + ' (' + disc.discountPercent + '% off)</p>'
      + tierHtml
      + '</td></tr></table></td></tr>'
    : '';

  const html = '<!DOCTYPE html>\n<html>\n<head><meta charset="UTF-8"></head>\n'
    + '<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Oxygen,Ubuntu,sans-serif;">\n'
    + '  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;">\n'
    + '    <tr><td align="center">\n'
    + '      <table width="720" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">\n'

    // Header
    + '        <tr><td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:32px 40px;">\n'
    + '          <table width="100%"><tr>\n'
    + '            <td><h1 style="color:white;margin:0;font-size:22px;font-weight:700;">Monthly Statement</h1>\n'
    + '              <p style="color:#94a3b8;margin:6px 0 0;font-size:14px;">' + statementPeriod + '</p></td>\n'
    + '            <td style="text-align:right;"><p style="color:#94a3b8;font-size:12px;margin:0;">Prepared for</p>\n'
    + '              <p style="color:white;font-size:16px;font-weight:600;margin:4px 0 0;">' + businessName + '</p></td>\n'
    + '          </tr></table>\n'
    + '        </td></tr>\n'

    // Summary cards
    + '        <tr><td style="padding:24px 40px 0;">\n'
    + '          <table width="100%" cellpadding="0" cellspacing="0"><tr>\n'
    + '            <td width="25%" style="padding:0 6px 0 0;"><div style="background:#f0fdf4;border-radius:8px;padding:16px;text-align:center;">\n'
    + '              <p style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin:0;">Orders</p>\n'
    + '              <p style="color:#166534;font-size:24px;font-weight:700;margin:4px 0 0;">' + (totals.orderCount || 0) + '</p></div></td>\n'
    + '            <td width="25%" style="padding:0 6px;"><div style="background:#f0fdf4;border-radius:8px;padding:16px;text-align:center;">\n'
    + '              <p style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin:0;">Items</p>\n'
    + '              <p style="color:#166534;font-size:24px;font-weight:700;margin:4px 0 0;">' + (totals.itemCount || 0) + '</p></div></td>\n'
    + '            <td width="25%" style="padding:0 6px;"><div style="background:#eff6ff;border-radius:8px;padding:16px;text-align:center;">\n'
    + '              <p style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin:0;">Discount</p>\n'
    + '              <p style="color:#1e40af;font-size:24px;font-weight:700;margin:4px 0 0;">' + (totals.discountPercent || 0) + '%</p></div></td>\n'
    + '            <td width="25%" style="padding:0 0 0 6px;"><div style="background:#f0fdf4;border-radius:8px;padding:16px;text-align:center;">\n'
    + '              <p style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin:0;">Total</p>\n'
    + '              <p style="color:#166534;font-size:24px;font-weight:700;margin:4px 0 0;">$' + Number(totals.grandTotal || 0).toFixed(2) + '</p></div></td>\n'
    + '          </tr></table>\n'
    + '        </td></tr>\n'

    // Itemized breakdown
    + '        <tr><td style="padding:24px 40px 0;">\n'
    + '          <p style="color:#1a202c;font-weight:700;font-size:15px;margin:0 0 4px;">Itemized Purchases</p>\n'
    + '          <p style="color:#6b7280;font-size:12px;margin:0 0 12px;">GAP-compliant traceability: lot code, farm source, and harvest date on every line item.</p>\n'
    + '          <div style="overflow-x:auto;">\n'
    + '            <table width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-size:13px;">\n'
    + '              <thead><tr style="background:#f8fafc;">\n'
    + '                <th style="padding:8px 6px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Date</th>\n'
    + '                <th style="padding:8px 6px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Product</th>\n'
    + '                <th style="padding:8px 6px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Farm</th>\n'
    + '                <th style="padding:8px 6px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Lot Code</th>\n'
    + '                <th style="padding:8px 6px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Harvested</th>\n'
    + '                <th style="padding:8px 6px;text-align:right;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Qty</th>\n'
    + '                <th style="padding:8px 6px;text-align:right;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Unit $</th>\n'
    + '                <th style="padding:8px 6px;text-align:right;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Total</th>\n'
    + '                <th style="padding:8px 6px;text-align:right;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">$/100g</th>\n'
    + '                <th style="padding:8px 6px;text-align:center;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">ESG</th>\n'
    + '              </tr></thead>\n'
    + '              <tbody>' + itemRows + '</tbody>\n'
    + '            </table>\n'
    + '          </div>\n'
    + '        </td></tr>\n'

    // Totals box
    + '        <tr><td style="padding:16px 40px 0;">\n'
    + '          <table width="50%" align="right" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">\n'
    + '            <tr><td style="padding:12px 16px;"><table width="100%" cellspacing="0" cellpadding="0">\n'
    + '              <tr><td style="padding:4px 0;color:#4a5568;font-size:13px;">Subtotal</td><td style="padding:4px 0;text-align:right;color:#1a202c;font-size:13px;">$' + Number(totals.subtotal || 0).toFixed(2) + '</td></tr>\n'
    + discountRow
    + '              <tr style="border-top:2px solid #e2e8f0;"><td style="padding:8px 0 4px;color:#1a202c;font-size:15px;font-weight:700;">Total</td>'
    + '<td style="padding:8px 0 4px;text-align:right;color:#1a202c;font-size:15px;font-weight:700;">$' + Number(totals.grandTotal || 0).toFixed(2) + ' CAD</td></tr>\n'
    + '            </table></td></tr>\n'
    + '          </table>\n'
    + '        </td></tr>\n'

    // Discount tier
    + tierSection

    // Environmental score card
    + '        <tr><td style="padding:24px 40px 0;">\n'
    + '          <p style="color:#1a202c;font-weight:700;font-size:15px;margin:0 0 12px;">Monthly Environmental Score</p>\n'
    + '          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">\n'
    + '            <tr>\n'
    + '              <td width="50%" style="padding:20px;background:#f0fdf4;border-right:1px solid #e2e8f0;">\n'
    + '                <p style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 4px;">Your Average ESG Score</p>\n'
    + '                <p style="color:#166534;font-size:36px;font-weight:800;margin:0;">' + (env.esgScore || '--')
    + '                  <span style="font-size:16px;font-weight:600;padding:4px 10px;border-radius:4px;background:' + gradeColor(env.esgGrade) + ';color:white;margin-left:8px;">' + (env.esgGrade || '--') + '</span></p>\n'
    + '                <p style="color:#4a5568;font-size:12px;margin:8px 0 0;">Weighted across all supplying farms for ' + statementMonth + '.</p>\n'
    + '              </td>\n'
    + '              <td width="50%" style="padding:20px;background:#fefce8;">\n'
    + '                <p style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 4px;">vs California Import Avg</p>\n'
    + '                <table width="100%" cellspacing="0" cellpadding="0">\n'
    + '                  <tr><td style="color:#4a5568;font-size:13px;padding:4px 0;">Food Miles Saved</td><td style="color:#166534;font-size:13px;font-weight:700;text-align:right;padding:4px 0;">' + milesSaved.toLocaleString() + ' mi</td></tr>\n'
    + '                  <tr><td style="color:#4a5568;font-size:13px;padding:4px 0;">CO2 Reduction</td><td style="color:#166534;font-size:13px;font-weight:700;text-align:right;padding:4px 0;">' + carbonReduction + '%</td></tr>\n'
    + '                  <tr><td style="color:#4a5568;font-size:13px;padding:4px 0;">Carbon Saved</td><td style="color:#166534;font-size:13px;font-weight:700;text-align:right;padding:4px 0;">' + carbonSaved + ' kg CO2</td></tr>\n'
    + '                  <tr><td style="color:#4a5568;font-size:13px;padding:4px 0;">Your Avg Food Miles</td><td style="color:#1a202c;font-size:13px;font-weight:600;text-align:right;padding:4px 0;">' + (env.avgFoodMiles || '--') + ' mi</td></tr>\n'
    + '                </table>\n'
    + '              </td>\n'
    + '            </tr>\n'
    + '          </table>\n'
    + '        </td></tr>\n'

    // GAP traceability note
    + '        <tr><td style="padding:16px 40px 0;">\n'
    + '          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">\n'
    + '            <tr><td style="padding:14px 20px;">\n'
    + '              <p style="color:#2d3748;font-weight:600;font-size:13px;margin:0 0 6px;">Traceability Disclosure (GAP Standard)</p>\n'
    + '              <p style="color:#6b7280;font-size:12px;line-height:1.6;margin:0;">'
    + 'This statement includes lot-code-level traceability for all purchased items in accordance with Good Agricultural Practices (GAP) standards. '
    + 'Each line item is traceable to the supplying farm, harvest date, and lot number. Lot codes are generated at harvest and linked through the supply chain. '
    + 'For food safety inquiries or recalls, contact info@greenreachgreens.com with the relevant lot code.</p>\n'
    + '            </td></tr>\n'
    + '          </table>\n'
    + '        </td></tr>\n'

    // Footer
    + '        <tr><td style="background:#f8fafc;padding:24px 40px;margin-top:24px;border-top:1px solid #e2e8f0;text-align:center;">\n'
    + '          <p style="color:#64748b;font-size:12px;margin:0 0 4px;"><a href="' + portalUrl + '" style="color:#3b82f6;text-decoration:none;font-weight:500;">View in Wholesale Portal</a></p>\n'
    + '          <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;">GreenReach -- The foundation for smarter farms</p>\n'
    + '          <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;">\n'
    + '            <a href="https://greenreachgreens.com" style="color:#64748b;text-decoration:none;">greenreachgreens.com</a> &nbsp;|&nbsp;\n'
    + '            <a href="mailto:info@greenreachgreens.com" style="color:#64748b;text-decoration:none;">info@greenreachgreens.com</a></p>\n'
    + '          <p style="color:#94a3b8;font-size:11px;margin:0;">' + BUSINESS_ADDRESS + '</p>\n'
    + '        </td></tr>\n'

    + '      </table>\n'
    + '    </td></tr>\n'
    + '  </table>\n'
    + '</body>\n</html>';

  // -- Plain text version --
  const discountText = totals.discountAmount > 0
    ? 'Volume Discount (' + totals.discountPercent + '%): -$' + Number(totals.discountAmount).toFixed(2) + '\n'
    : '';

  const tierText = disc.tierName
    ? 'DISCOUNT TIER: ' + disc.tierName + ' (' + disc.discountPercent + '% off)\n'
      + (disc.nextTier ? 'Spend $' + Number(disc.amountToNextTier || 0).toFixed(2) + ' more to unlock ' + disc.nextTier + '.\n' : '')
    : '';

  const text = 'GREENREACH WHOLESALE -- MONTHLY STATEMENT\n'
    + statementMonth + ' | ' + statementPeriod + '\n'
    + 'Prepared for: ' + businessName + '\n\n'
    + 'Hi ' + firstName + ',\n\n'
    + 'SUMMARY\n----------------------------------------------\n'
    + 'Orders: ' + (totals.orderCount || 0) + '  |  Items: ' + (totals.itemCount || 0)
    + '  |  Discount: ' + (totals.discountPercent || 0) + '%  |  Total: $' + Number(totals.grandTotal || 0).toFixed(2) + ' CAD\n\n'
    + 'ITEMIZED PURCHASES (GAP Traceability)\n----------------------------------------------\n'
    + (itemText || '  No items this period.') + '\n\n'
    + '----------------------------------------------\n'
    + 'Subtotal:            $' + Number(totals.subtotal || 0).toFixed(2) + '\n'
    + discountText
    + 'Total:               $' + Number(totals.grandTotal || 0).toFixed(2) + ' CAD\n\n'
    + tierText + '\n'
    + 'ENVIRONMENTAL SCORE -- ' + statementMonth + '\n----------------------------------------------\n'
    + 'Your Average ESG Score: ' + (env.esgScore || '--') + ' (' + (env.esgGrade || '--') + ')\n'
    + 'Your Avg Food Miles: ' + (env.avgFoodMiles || '--') + ' mi\n\n'
    + 'vs California Import Average:\n'
    + '  Food Miles Saved:    ' + milesSaved.toLocaleString() + ' mi\n'
    + '  CO2 Reduction:       ' + carbonReduction + '%\n'
    + '  Carbon Saved:        ' + carbonSaved + ' kg CO2\n\n'
    + 'TRACEABILITY DISCLOSURE (GAP Standard)\n----------------------------------------------\n'
    + 'This statement includes lot-code-level traceability for all items.\n'
    + 'Each line item is traceable to the supplying farm, harvest date, and lot number.\n'
    + 'For food safety inquiries: info@greenreachgreens.com\n\n'
    + '-- GreenReach -- The foundation for smarter farms\ngreenreachgreens.com | info@greenreachgreens.com\n' + BUSINESS_ADDRESS;

  return sendEmail({ to: email, subject, html, text });
}


// =====================================================================
// Monthly Producer Statement -- Light Engine farm users
// =====================================================================

/**
 * Send monthly producer statement to a Light Engine farm.
 * Includes sales breakdown, fulfillment summary, ESG performance.
 * @param {Function} sendEmail - The sendEmail function from email.js
 * @param {Object} params
 */
export async function sendProducerMonthlyStatement(sendEmail, {
  email, farmName, contactName, farmId, statementMonth, statementPeriod,
  lineItems, totals, esgAssessment, environmentalComparison
}) {
  const firstName = (contactName || '').split(/\s+/)[0] || 'there';
  const dashboardUrl = 'https://greenreachgreens.com/farm-admin.html';

  // -- Build line item rows --
  const itemRows = (lineItems || []).map(function(item) {
    const costPer100g = item.weightGrams > 0
      ? ((item.lineTotal / item.weightGrams) * 100).toFixed(2)
      : '--';
    return '<tr style="border-bottom:1px solid #e2e8f0;">'
      + '<td style="padding:8px 6px;font-size:12px;color:#6b7280;">' + (item.orderDate || '') + '</td>'
      + '<td style="padding:8px 6px;font-size:13px;color:#1a202c;font-weight:500;">' + (item.productName || '') + '</td>'
      + '<td style="padding:8px 6px;font-size:12px;color:#4a5568;">' + (item.buyerName || '') + '</td>'
      + '<td style="padding:8px 6px;font-size:11px;color:#6b7280;font-family:\'SF Mono\',\'Fira Code\',Consolas,monospace;">' + (item.lotCode || 'N/A') + '</td>'
      + '<td style="padding:8px 6px;font-size:12px;color:#6b7280;">' + (item.harvestDate || '') + '</td>'
      + '<td style="padding:8px 6px;font-size:13px;color:#1a202c;text-align:right;">' + item.quantity + ' ' + (item.unit || '') + '</td>'
      + '<td style="padding:8px 6px;font-size:13px;color:#1a202c;text-align:right;">$' + Number(item.unitPrice || 0).toFixed(2) + '</td>'
      + '<td style="padding:8px 6px;font-size:13px;color:#1a202c;text-align:right;font-weight:600;">$' + Number(item.lineTotal || 0).toFixed(2) + '</td>'
      + '<td style="padding:8px 6px;font-size:12px;color:#6b7280;text-align:right;">$' + costPer100g + '</td>'
      + '</tr>';
  }).join('\n');

  const itemText = (lineItems || []).map(function(item) {
    const costPer100g = item.weightGrams > 0
      ? ((item.lineTotal / item.weightGrams) * 100).toFixed(2)
      : '--';
    return '  ' + item.orderDate + ' | ' + item.productName + ' | Buyer: ' + item.buyerName + ' | Lot: ' + (item.lotCode || 'N/A') + ' | Harvested: ' + (item.harvestDate || 'N/A')
      + '\n    ' + item.quantity + ' ' + item.unit + ' @ $' + Number(item.unitPrice||0).toFixed(2) + ' = $' + Number(item.lineTotal||0).toFixed(2) + ' | $/100g: $' + costPer100g;
  }).join('\n');

  // -- ESG section --
  const esg = esgAssessment || {};
  const envComp = environmentalComparison || {};
  const milesSaved = Math.max(0, CALIFORNIA_BENCHMARK.avg_food_miles - (envComp.avgFoodMiles || 0));
  const carbonSaved = envComp.totalWeightKg > 0
    ? ((CALIFORNIA_BENCHMARK.carbon_kg_per_kg - (envComp.carbonKgPerKg || 0)) * envComp.totalWeightKg).toFixed(1)
    : '0';
  const carbonReduction = CALIFORNIA_BENCHMARK.carbon_kg_per_kg > 0 && envComp.carbonKgPerKg !== undefined
    ? (((CALIFORNIA_BENCHMARK.carbon_kg_per_kg - envComp.carbonKgPerKg) / CALIFORNIA_BENCHMARK.carbon_kg_per_kg) * 100).toFixed(0)
    : '--';

  const envScore = esg.environmental ? esg.environmental.score : '--';
  const socScore = esg.social ? esg.social.score : '--';
  const govScore = esg.governance ? esg.governance.score : '--';

  const subject = 'GreenReach Producer Statement -- ' + statementMonth + ' -- ' + farmName;

  const html = '<!DOCTYPE html>\n<html>\n<head><meta charset="UTF-8"></head>\n'
    + '<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Oxygen,Ubuntu,sans-serif;">\n'
    + '  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;">\n'
    + '    <tr><td align="center">\n'
    + '      <table width="720" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">\n'

    // Header
    + '        <tr><td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:32px 40px;">\n'
    + '          <table width="100%"><tr>\n'
    + '            <td><h1 style="color:white;margin:0;font-size:22px;font-weight:700;">Producer Statement</h1>\n'
    + '              <p style="color:#94a3b8;margin:6px 0 0;font-size:14px;">' + statementPeriod + '</p></td>\n'
    + '            <td style="text-align:right;">\n'
    + '              <p style="color:#94a3b8;font-size:12px;margin:0;">Farm</p>\n'
    + '              <p style="color:white;font-size:16px;font-weight:600;margin:4px 0 0;">' + farmName + '</p>\n'
    + '              <p style="color:#94a3b8;font-size:12px;margin:4px 0 0;font-family:\'SF Mono\',Consolas,monospace;">' + farmId + '</p></td>\n'
    + '          </tr></table>\n'
    + '        </td></tr>\n'

    // Revenue summary cards
    + '        <tr><td style="padding:24px 40px 0;">\n'
    + '          <table width="100%" cellpadding="0" cellspacing="0"><tr>\n'
    + '            <td width="25%" style="padding:0 6px 0 0;"><div style="background:#f0fdf4;border-radius:8px;padding:16px;text-align:center;">\n'
    + '              <p style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin:0;">Gross Revenue</p>\n'
    + '              <p style="color:#166534;font-size:22px;font-weight:700;margin:4px 0 0;">$' + Number(totals.grossRevenue || 0).toFixed(2) + '</p></div></td>\n'
    + '            <td width="25%" style="padding:0 6px;"><div style="background:#fef3c7;border-radius:8px;padding:16px;text-align:center;">\n'
    + '              <p style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin:0;">Platform Fee (12%)</p>\n'
    + '              <p style="color:#92400e;font-size:22px;font-weight:700;margin:4px 0 0;">$' + Number(totals.brokerFee || 0).toFixed(2) + '</p></div></td>\n'
    + '            <td width="25%" style="padding:0 6px;"><div style="background:#f0fdf4;border-radius:8px;padding:16px;text-align:center;">\n'
    + '              <p style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin:0;">Net Revenue</p>\n'
    + '              <p style="color:#166534;font-size:22px;font-weight:700;margin:4px 0 0;">$' + Number(totals.netRevenue || 0).toFixed(2) + '</p></div></td>\n'
    + '            <td width="25%" style="padding:0 0 0 6px;"><div style="background:#eff6ff;border-radius:8px;padding:16px;text-align:center;">\n'
    + '              <p style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin:0;">Fulfillment</p>\n'
    + '              <p style="color:#1e40af;font-size:22px;font-weight:700;margin:4px 0 0;">' + (totals.fulfillmentRate || '--') + '%</p></div></td>\n'
    + '          </tr></table>\n'
    + '        </td></tr>\n'

    // Itemized sales
    + '        <tr><td style="padding:24px 40px 0;">\n'
    + '          <p style="color:#1a202c;font-weight:700;font-size:15px;margin:0 0 4px;">Itemized Sales</p>\n'
    + '          <p style="color:#6b7280;font-size:12px;margin:0 0 12px;">GAP-compliant traceability: lot code, buyer, and harvest date on every line.</p>\n'
    + '          <div style="overflow-x:auto;">\n'
    + '            <table width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-size:13px;">\n'
    + '              <thead><tr style="background:#f8fafc;">\n'
    + '                <th style="padding:8px 6px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Date</th>\n'
    + '                <th style="padding:8px 6px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Product</th>\n'
    + '                <th style="padding:8px 6px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Buyer</th>\n'
    + '                <th style="padding:8px 6px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Lot Code</th>\n'
    + '                <th style="padding:8px 6px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Harvested</th>\n'
    + '                <th style="padding:8px 6px;text-align:right;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Qty</th>\n'
    + '                <th style="padding:8px 6px;text-align:right;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Unit $</th>\n'
    + '                <th style="padding:8px 6px;text-align:right;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Total</th>\n'
    + '                <th style="padding:8px 6px;text-align:right;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">$/100g</th>\n'
    + '              </tr></thead>\n'
    + '              <tbody>' + itemRows + '</tbody>\n'
    + '            </table>\n'
    + '          </div>\n'
    + '        </td></tr>\n'

    // Revenue totals
    + '        <tr><td style="padding:16px 40px 0;">\n'
    + '          <table width="50%" align="right" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">\n'
    + '            <tr><td style="padding:12px 16px;"><table width="100%" cellspacing="0" cellpadding="0">\n'
    + '              <tr><td style="padding:4px 0;color:#4a5568;font-size:13px;">Gross Revenue</td><td style="padding:4px 0;text-align:right;color:#1a202c;font-size:13px;">$' + Number(totals.grossRevenue || 0).toFixed(2) + '</td></tr>\n'
    + '              <tr><td style="padding:4px 0;color:#92400e;font-size:13px;">Platform Fee (12%)</td><td style="padding:4px 0;text-align:right;color:#92400e;font-size:13px;">-$' + Number(totals.brokerFee || 0).toFixed(2) + '</td></tr>\n'
    + '              <tr style="border-top:2px solid #e2e8f0;"><td style="padding:8px 0 4px;color:#1a202c;font-size:15px;font-weight:700;">Net Revenue</td>'
    + '<td style="padding:8px 0 4px;text-align:right;color:#166534;font-size:15px;font-weight:700;">$' + Number(totals.netRevenue || 0).toFixed(2) + ' CAD</td></tr>\n'
    + '            </table></td></tr>\n'
    + '          </table>\n'
    + '        </td></tr>\n'

    // ESG performance
    + '        <tr><td style="padding:24px 40px 0;">\n'
    + '          <p style="color:#1a202c;font-weight:700;font-size:15px;margin:0 0 12px;">Environmental Score -- ' + statementMonth + '</p>\n'
    + '          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">\n'
    + '            <tr>\n'
    + '              <td width="40%" style="padding:20px;background:#f0fdf4;border-right:1px solid #e2e8f0;text-align:center;">\n'
    + '                <p style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 4px;">Your ESG Score</p>\n'
    + '                <p style="color:#166534;font-size:42px;font-weight:800;margin:0;">' + (esg.totalScore || '--')
    + '                  <span style="font-size:18px;font-weight:600;padding:4px 12px;border-radius:4px;background:' + gradeColor(esg.grade) + ';color:white;margin-left:8px;">' + (esg.grade || '--') + '</span></p>\n'
    + '                <table width="100%" cellspacing="0" cellpadding="0" style="margin-top:12px;">\n'
    + '                  <tr><td style="color:#6b7280;font-size:12px;text-align:center;">Env: ' + envScore + '</td>'
    + '<td style="color:#6b7280;font-size:12px;text-align:center;">Social: ' + socScore + '</td>'
    + '<td style="color:#6b7280;font-size:12px;text-align:center;">Gov: ' + govScore + '</td></tr>\n'
    + '                </table>\n'
    + '              </td>\n'
    + '              <td width="60%" style="padding:20px;background:#fefce8;">\n'
    + '                <p style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 8px;">vs California Import Avg</p>\n'
    + '                <table width="100%" cellspacing="0" cellpadding="0">\n'
    + '                  <tr><td style="color:#4a5568;font-size:13px;padding:4px 0;">Food Miles Saved</td><td style="color:#166534;font-size:13px;font-weight:700;text-align:right;padding:4px 0;">' + milesSaved.toLocaleString() + ' mi</td></tr>\n'
    + '                  <tr><td style="color:#4a5568;font-size:13px;padding:4px 0;">CO2 Reduction</td><td style="color:#166534;font-size:13px;font-weight:700;text-align:right;padding:4px 0;">' + carbonReduction + '%</td></tr>\n'
    + '                  <tr><td style="color:#4a5568;font-size:13px;padding:4px 0;">Carbon Saved</td><td style="color:#166534;font-size:13px;font-weight:700;text-align:right;padding:4px 0;">' + carbonSaved + ' kg CO2</td></tr>\n'
    + '                  <tr><td style="color:#4a5568;font-size:13px;padding:4px 0;">Your Avg Food Miles</td><td style="color:#1a202c;font-size:13px;font-weight:600;text-align:right;padding:4px 0;">' + (envComp.avgFoodMiles || '--') + ' mi</td></tr>\n'
    + '                </table>\n'
    + '              </td>\n'
    + '            </tr>\n'
    + '          </table>\n'
    + '        </td></tr>\n'

    // GAP traceability note
    + '        <tr><td style="padding:16px 40px 0;">\n'
    + '          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">\n'
    + '            <tr><td style="padding:14px 20px;">\n'
    + '              <p style="color:#2d3748;font-weight:600;font-size:13px;margin:0 0 6px;">Traceability Disclosure (GAP Standard)</p>\n'
    + '              <p style="color:#6b7280;font-size:12px;line-height:1.6;margin:0;">'
    + 'This statement includes lot-code-level traceability for all sold items in accordance with Good Agricultural Practices (GAP) standards. '
    + 'Each line item is traceable from harvest to buyer via lot number. For food safety inquiries or recalls, contact info@greenreachgreens.com.</p>\n'
    + '            </td></tr>\n'
    + '          </table>\n'
    + '        </td></tr>\n'

    // Footer
    + '        <tr><td style="background:#f8fafc;padding:24px 40px;margin-top:24px;border-top:1px solid #e2e8f0;text-align:center;">\n'
    + '          <p style="color:#64748b;font-size:12px;margin:0 0 4px;"><a href="' + dashboardUrl + '" style="color:#3b82f6;text-decoration:none;font-weight:500;">View in Farm Dashboard</a></p>\n'
    + '          <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;">GreenReach -- The foundation for smarter farms</p>\n'
    + '          <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;">\n'
    + '            <a href="https://greenreachgreens.com" style="color:#64748b;text-decoration:none;">greenreachgreens.com</a> &nbsp;|&nbsp;\n'
    + '            <a href="mailto:info@greenreachgreens.com" style="color:#64748b;text-decoration:none;">info@greenreachgreens.com</a></p>\n'
    + '          <p style="color:#94a3b8;font-size:11px;margin:0;">' + BUSINESS_ADDRESS + '</p>\n'
    + '        </td></tr>\n'

    + '      </table>\n'
    + '    </td></tr>\n'
    + '  </table>\n'
    + '</body>\n</html>';

  const text = 'GREENREACH -- PRODUCER STATEMENT\n'
    + statementMonth + ' | ' + statementPeriod + '\n'
    + 'Farm: ' + farmName + ' (' + farmId + ')\n\n'
    + 'Hi ' + firstName + ',\n\n'
    + 'REVENUE SUMMARY\n----------------------------------------------\n'
    + 'Gross Revenue:     $' + Number(totals.grossRevenue || 0).toFixed(2) + '\n'
    + 'Platform Fee (12%): -$' + Number(totals.brokerFee || 0).toFixed(2) + '\n'
    + 'Net Revenue:       $' + Number(totals.netRevenue || 0).toFixed(2) + ' CAD\n'
    + 'Orders: ' + (totals.orderCount || 0) + '  |  Items: ' + (totals.itemCount || 0) + '  |  Fulfillment: ' + (totals.fulfillmentRate || '--') + '%\n\n'
    + 'ITEMIZED SALES (GAP Traceability)\n----------------------------------------------\n'
    + (itemText || '  No sales this period.') + '\n\n'
    + '----------------------------------------------\n'
    + 'Gross Revenue:       $' + Number(totals.grossRevenue || 0).toFixed(2) + '\n'
    + 'Platform Fee (12%):  -$' + Number(totals.brokerFee || 0).toFixed(2) + '\n'
    + 'Net Revenue:         $' + Number(totals.netRevenue || 0).toFixed(2) + ' CAD\n\n'
    + 'ENVIRONMENTAL SCORE -- ' + statementMonth + '\n----------------------------------------------\n'
    + 'Your ESG Score: ' + (esg.totalScore || '--') + ' (' + (esg.grade || '--') + ')\n'
    + '  Environmental: ' + envScore + '  |  Social: ' + socScore + '  |  Governance: ' + govScore + '\n\n'
    + 'vs California Import Average:\n'
    + '  Food Miles Saved:    ' + milesSaved.toLocaleString() + ' mi\n'
    + '  CO2 Reduction:       ' + carbonReduction + '%\n'
    + '  Carbon Saved:        ' + carbonSaved + ' kg CO2\n\n'
    + 'TRACEABILITY DISCLOSURE (GAP Standard)\n----------------------------------------------\n'
    + 'This statement includes lot-code-level traceability for all items.\n'
    + 'For food safety inquiries: info@greenreachgreens.com\n\n'
    + '-- GreenReach -- The foundation for smarter farms\ngreenreachgreens.com | info@greenreachgreens.com\n' + BUSINESS_ADDRESS;

  return sendEmail({ to: email, subject, html, text });
}
