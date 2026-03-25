/**
 * GreenReach Wholesale - Invoice Generator
 *
 * Assembles enriched invoice data from order, farm practices, and buyer location,
 * then renders a downloadable HTML invoice.
 *
 * Key features:
 * - Per-farm produce breakdown with unit of measure
 * - Weight items show cost per 100g and per oz
 * - Environmental score comparing local sourcing vs California imports
 * - Farm practices display (pesticide, herbicide, GMO, organic)
 */

// Weight units that qualify for per-100g / per-oz breakdowns
const WEIGHT_UNITS = new Set(['oz', 'lb', 'g', 'kg', 'lb_case']);

/**
 * Convert a price+unit to per_oz and per_100g pricing
 * @param {number} pricePerUnit - Price for one unit
 * @param {string} unit - Unit of measure (oz, lb, g, kg)
 * @returns {{ per_oz: number, per_100g: number } | null}
 */
function weightBreakdown(pricePerUnit, unit) {
  if (!WEIGHT_UNITS.has(unit) || !pricePerUnit) return null;
  let perOz, per100g;
  switch (unit) {
    case 'oz':
      perOz = pricePerUnit;
      per100g = pricePerUnit * (100 / 28.3495);
      break;
    case 'lb':
    case 'lb_case':
      perOz = pricePerUnit / 16;
      per100g = pricePerUnit / 4.53592;
      break;
    case 'g':
      perOz = pricePerUnit * 28.3495;
      per100g = pricePerUnit * 100;
      break;
    case 'kg':
      perOz = pricePerUnit * 0.0283495;
      per100g = pricePerUnit * 0.1;
      break;
    default:
      return null;
  }
  return {
    per_oz: Math.round(perOz * 100) / 100,
    per_100g: Math.round(per100g * 100) / 100
  };
}

/**
 * Haversine distance in km
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// California Central Valley baseline (same as wholesale.js frontend)
const CA_LAT = 36.7783;
const CA_LNG = -119.4179;
const CARBON_PER_KM = 0.161; // kg CO2 per km (refrigerated truck)

/**
 * Compute environmental score for a single farm relative to a buyer
 */
function computeFarmEnvScore(buyerLat, buyerLng, farmLat, farmLng) {
  const localKm = haversineKm(buyerLat, buyerLng, farmLat, farmLng);
  const caKm = haversineKm(buyerLat, buyerLng, CA_LAT, CA_LNG);
  const localCarbon = localKm * CARBON_PER_KM;
  const caCarbon = caKm * CARBON_PER_KM;
  const carbonSaved = caCarbon - localCarbon;
  const savingsPercent = caCarbon > 0 ? Math.round((carbonSaved / caCarbon) * 100) : 0;

  let grade = 'D';
  if (localKm < 100) grade = 'A+';
  else if (localKm < 250) grade = 'B';
  else if (localKm < 500) grade = 'C';

  return {
    local_km: Math.round(localKm),
    ca_km: Math.round(caKm),
    local_carbon_kg: Math.round(localCarbon * 10) / 10,
    ca_carbon_kg: Math.round(caCarbon * 10) / 10,
    carbon_saved_kg: Math.round(carbonSaved * 10) / 10,
    savings_percent: savingsPercent,
    grade
  };
}

/**
 * Map practice codes to human-readable labels
 */
const PRACTICE_LABELS = {
  pesticide_free: 'Pesticide-Free',
  non_gmo: 'Non-GMO',
  herbicide_free: 'Herbicide-Free',
  organic: 'Organic',
  hydroponic: 'Hydroponic',
  local: 'Local',
  year_round: 'Year-Round Production'
};
const CERT_LABELS = {
  GAP: 'GAP Certified',
  organic: 'USDA Organic',
  food_safety: 'Food Safety Certified',
  greenhouse: 'Greenhouse Certified'
};

/**
 * Determine pesticide / herbicide / GMO status from farm practices array
 */
function extractSafetyFlags(practices = [], certifications = []) {
  const pArr = Array.isArray(practices) ? practices : [];
  const cArr = Array.isArray(certifications) ? certifications : [];
  const all = [...pArr, ...cArr];

  return {
    pesticide_free: pArr.includes('pesticide_free') || cArr.includes('organic'),
    herbicide_free: pArr.includes('herbicide_free') || cArr.includes('organic'),
    non_gmo: pArr.includes('non_gmo'),
    organic: cArr.includes('organic') || pArr.includes('organic')
  };
}

/**
 * Assemble full invoice data object.
 *
 * @param {Object} params
 * @param {Object} params.order - Master order from NeDB
 * @param {Array}  params.subOrders - Sub-orders from NeDB
 * @param {Object} params.farmProfiles - Map<farm_id, {name, city, state, practices, certifications, attributes, location}>
 * @param {Object} params.buyerProfile - {business_name, contact_name, email, location}
 * @returns {Object} enriched invoice data
 */
export function assembleInvoice({ order, subOrders, farmProfiles, buyerProfile }) {
  const masterOrderId = order.master_order_id || order.id;
  const orderDate = order.created_at || new Date().toISOString();
  const currency = order.currency || process.env.PAYMENT_CURRENCY || 'CAD';

  // Use order.allocation sub_orders if standalone subOrders list is empty
  const subs = subOrders.length > 0
    ? subOrders
    : (order.allocation?.sub_orders || []);

  // Resolve buyer location for env score
  const buyerLoc = buyerProfile?.location || {};
  const buyerLat = parseFloat(buyerLoc.latitude || buyerLoc.lat);
  const buyerLng = parseFloat(buyerLoc.longitude || buyerLoc.lng);
  const hasBuyerCoords = !isNaN(buyerLat) && !isNaN(buyerLng);

  // Build per-farm sections
  const farmSections = subs.map(sub => {
    const farmId = sub.farm_id;
    const profile = farmProfiles[farmId] || {};
    const practices = profile.practices || [];
    const certifications = profile.certifications || [];
    const safety = extractSafetyFlags(practices, certifications);

    // Farm coordinates
    const farmLat = parseFloat(profile.location?.lat || profile.location?.latitude);
    const farmLng = parseFloat(profile.location?.lng || profile.location?.longitude);
    const hasFarmCoords = !isNaN(farmLat) && !isNaN(farmLng);

    // Environmental score for this farm
    let envScore = null;
    if (hasBuyerCoords && hasFarmCoords) {
      envScore = computeFarmEnvScore(buyerLat, buyerLng, farmLat, farmLng);
    }

    // Build line items with weight breakdowns
    const items = (sub.line_items || sub.items || []).map(item => {
      const unit = item.unit || 'unit';
      const wb = weightBreakdown(item.unit_price, unit);
      return {
        sku_id: item.sku_id,
        sku_name: item.sku_name || item.product_name || item.sku_id,
        qty: item.qty || item.quantity || 0,
        unit,
        unit_price: item.unit_price != null ? item.unit_price : item.price,
        list_price: item.list_price,
        discount_rate: item.discount_rate || 0,
        line_total: item.line_total || (item.qty * item.unit_price),
        weight_breakdown: wb,
        traceability: item.traceability || {}
      };
    });

    return {
      farm_id: farmId,
      farm_name: sub.farm_name || profile.name || farmId,
      city: profile.city || '',
      state: profile.state || '',
      practices: practices.map(p => PRACTICE_LABELS[p] || p),
      certifications: certifications.map(c => CERT_LABELS[c] || c),
      safety,
      env_score: envScore,
      items,
      subtotal: sub.subtotal || 0,
      broker_fee_amount: sub.broker_fee_amount || 0,
      tax_rate: sub.tax_rate || 0,
      tax_label: sub.tax_label || 'TAX',
      tax_amount: sub.tax_amount || 0,
      total: sub.total || 0
    };
  });

  // Order-level environmental composite
  let orderEnvScore = null;
  const scoredFarms = farmSections.filter(f => f.env_score);
  if (scoredFarms.length > 0) {
    const avgLocalKm = scoredFarms.reduce((s, f) => s + f.env_score.local_km, 0) / scoredFarms.length;
    const avgCaKm = scoredFarms.reduce((s, f) => s + f.env_score.ca_km, 0) / scoredFarms.length;
    const totalSaved = scoredFarms.reduce((s, f) => s + f.env_score.carbon_saved_kg, 0);
    const totalCaCarbon = scoredFarms.reduce((s, f) => s + f.env_score.ca_carbon_kg, 0);
    const overallPct = totalCaCarbon > 0 ? Math.round((totalSaved / totalCaCarbon) * 100) : 0;

    let grade = 'D';
    if (avgLocalKm < 100) grade = 'A+';
    else if (avgLocalKm < 250) grade = 'B';
    else if (avgLocalKm < 500) grade = 'C';

    orderEnvScore = {
      grade,
      avg_local_km: Math.round(avgLocalKm),
      avg_ca_km: Math.round(avgCaKm),
      total_carbon_saved_kg: Math.round(totalSaved * 10) / 10,
      savings_percent: overallPct,
      farm_count: scoredFarms.length
    };
  }

  // Totals from order or summed
  const totals = order.totals || {
    subtotal: farmSections.reduce((s, f) => s + f.subtotal, 0),
    broker_fee_total: farmSections.reduce((s, f) => s + f.broker_fee_amount, 0),
    tax_total: farmSections.reduce((s, f) => s + f.tax_amount, 0),
    total: farmSections.reduce((s, f) => s + f.total, 0)
  };

  // Discount info from order
  const discount = order.buyer_discount || order.allocation?.buyer_discount_rate
    ? { rate: order.buyer_discount?.rate || order.allocation?.buyer_discount_rate || 0,
        tier: order.buyer_discount?.tier || '',
        trailing_spend: order.buyer_discount?.trailing_spend || 0 }
    : null;

  return {
    invoice_id: `INV-${masterOrderId}`,
    master_order_id: masterOrderId,
    generated_at: new Date().toISOString(),
    order_date: orderDate,
    currency,
    buyer: {
      business_name: buyerProfile?.business_name || '',
      contact_name: buyerProfile?.contact_name || '',
      email: buyerProfile?.email || '',
      city: buyerLoc.city || '',
      state: buyerLoc.state || ''
    },
    discount,
    farms: farmSections,
    env_score: orderEnvScore,
    totals,
    status: order.status || 'confirmed',
    delivery: order.cart?.delivery || order.delivery || null
  };
}

// ── HTML Invoice Renderer ───────────────────────────────────────────────

function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function money(val, currency = 'CAD') {
  const n = Number(val) || 0;
  return `$${n.toFixed(2)} ${currency}`;
}

function pct(val) {
  return `${(Number(val) * 100).toFixed(0)}%`;
}

/**
 * Render invoice data as standalone HTML document
 */
export function renderInvoiceHTML(invoice) {
  const { buyer, farms, env_score, totals, discount, delivery, currency } = invoice;

  // Build farm sections
  const farmHTML = farms.map(farm => {
    // Safety badges row
    const badges = [];
    if (farm.safety.organic) badges.push('<span class="badge badge-organic">Organic</span>');
    if (farm.safety.pesticide_free) badges.push('<span class="badge badge-safe">Pesticide-Free</span>');
    if (farm.safety.herbicide_free) badges.push('<span class="badge badge-safe">Herbicide-Free</span>');
    if (farm.safety.non_gmo) badges.push('<span class="badge badge-safe">Non-GMO</span>');
    // Additional certifications
    farm.certifications.forEach(c => {
      if (!badges.some(b => b.includes(esc(c)))) {
        badges.push(`<span class="badge badge-cert">${esc(c)}</span>`);
      }
    });
    // Additional practices beyond the safety four
    farm.practices.forEach(p => {
      if (!badges.some(b => b.includes(esc(p)))) {
        badges.push(`<span class="badge badge-practice">${esc(p)}</span>`);
      }
    });

    const badgesHTML = badges.length > 0
      ? `<div class="farm-badges">${badges.join(' ')}</div>`
      : '';

    // Environmental score for this farm
    let farmEnvHTML = '';
    if (farm.env_score) {
      const e = farm.env_score;
      farmEnvHTML = `
        <div class="farm-env">
          <span class="env-grade grade-${e.grade.replace('+', 'plus').toLowerCase()}">${esc(e.grade)}</span>
          <span class="env-detail">${e.local_km} km away &middot; ${e.local_carbon_kg} kg CO&#x2082; per delivery</span>
          <span class="env-savings">${e.carbon_saved_kg > 0 ? `Saves ${e.carbon_saved_kg} kg CO&#x2082; (${e.savings_percent}%) vs California` : ''}</span>
        </div>`;
    }

    // Line items table
    const itemRows = farm.items.map(item => {
      const wb = item.weight_breakdown;
      const unitCell = esc(item.unit);
      const priceRef = wb
        ? `<div class="price-ref">${money(wb.per_oz, currency)}/oz &middot; ${money(wb.per_100g, currency)}/100g</div>`
        : '';
      const discountNote = item.discount_rate > 0
        ? `<div class="discount-note">List ${money(item.list_price, currency)} &minus; ${pct(item.discount_rate)} discount</div>`
        : '';
      return `
        <tr>
          <td>${esc(item.sku_name)}</td>
          <td class="center">${item.qty}</td>
          <td class="center">${unitCell}</td>
          <td class="right">${money(item.unit_price, currency)}/${unitCell}${priceRef}</td>
          <td class="right">${money(item.line_total, currency)}${discountNote}</td>
        </tr>`;
    }).join('');

    return `
      <div class="farm-section">
        <div class="farm-header">
          <div class="farm-name">${esc(farm.farm_name)}</div>
          ${farm.city || farm.state ? `<div class="farm-location">${esc(farm.city)}${farm.city && farm.state ? ', ' : ''}${esc(farm.state)}</div>` : ''}
          ${badgesHTML}
          ${farmEnvHTML}
        </div>
        <table class="line-items">
          <thead>
            <tr>
              <th>Product</th>
              <th class="center">Qty</th>
              <th class="center">Unit</th>
              <th class="right">Unit Price</th>
              <th class="right">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
          </tbody>
          <tfoot>
            <tr><td colspan="4" class="right">Subtotal</td><td class="right">${money(farm.subtotal, currency)}</td></tr>
            <tr><td colspan="4" class="right">Broker Fee (12%)</td><td class="right">${money(farm.broker_fee_amount, currency)}</td></tr>
            ${farm.tax_rate > 0 ? `<tr><td colspan="4" class="right">${esc(farm.tax_label)} (${(farm.tax_rate * 100).toFixed(1)}%)</td><td class="right">${money(farm.tax_amount, currency)}</td></tr>` : ''}
            <tr class="total-row"><td colspan="4" class="right"><strong>Farm Total</strong></td><td class="right"><strong>${money(farm.total, currency)}</strong></td></tr>
          </tfoot>
        </table>
      </div>`;
  }).join('');

  // Order-level environmental summary
  let envSummaryHTML = '';
  if (env_score) {
    const e = env_score;
    envSummaryHTML = `
      <div class="env-summary">
        <div class="env-summary-header">
          <span class="env-grade-lg grade-${e.grade.replace('+', 'plus').toLowerCase()}">${esc(e.grade)}</span>
          <div class="env-summary-title">Environmental Impact Score</div>
        </div>
        <div class="env-metrics">
          <div class="env-metric">
            <div class="metric-value">${e.avg_local_km} km</div>
            <div class="metric-label">Avg Farm Distance</div>
          </div>
          <div class="env-metric">
            <div class="metric-value">${e.total_carbon_saved_kg} kg</div>
            <div class="metric-label">CO&#x2082; Saved vs California</div>
          </div>
          <div class="env-metric">
            <div class="metric-value">${e.savings_percent}%</div>
            <div class="metric-label">Carbon Reduction</div>
          </div>
          <div class="env-metric">
            <div class="metric-value">${e.farm_count}</div>
            <div class="metric-label">Local Farms</div>
          </div>
        </div>
        <div class="env-baseline">Baseline: California Central Valley import at ${e.avg_ca_km} km avg distance</div>
      </div>`;
  }

  // Discount summary
  let discountHTML = '';
  if (discount && discount.rate > 0) {
    discountHTML = `
      <div class="discount-summary">
        Volume Discount Applied: ${pct(discount.rate)} (${esc(discount.tier)}) &middot; 30-day trailing spend: ${money(discount.trailing_spend, currency)}
      </div>`;
  }

  // Delivery info
  let deliveryHTML = '';
  if (delivery) {
    deliveryHTML = `
      <div class="delivery-info">
        <strong>Delivery:</strong> ${esc(delivery.address || '')}
        ${delivery.delivery_date ? ` &middot; Date: ${esc(delivery.delivery_date)}` : ''}
        ${delivery.zip ? ` &middot; ZIP: ${esc(delivery.zip)}` : ''}
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Invoice ${esc(invoice.invoice_id)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; background: #fff; padding: 2rem; max-width: 900px; margin: 0 auto; font-size: 14px; line-height: 1.5; }
  .invoice-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #2d6a4f; padding-bottom: 1.5rem; margin-bottom: 1.5rem; }
  .brand { font-size: 1.6rem; font-weight: 700; color: #2d6a4f; }
  .brand-sub { font-size: 0.85rem; color: #555; margin-top: 0.25rem; }
  .invoice-meta { text-align: right; font-size: 0.85rem; color: #444; }
  .invoice-meta strong { display: block; font-size: 1.1rem; color: #1a1a1a; }
  .parties { display: flex; justify-content: space-between; margin-bottom: 1.5rem; gap: 2rem; }
  .party { flex: 1; }
  .party-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #777; margin-bottom: 0.5rem; }
  .party-name { font-weight: 600; font-size: 1rem; }
  .party-detail { font-size: 0.85rem; color: #555; }
  .farm-section { border: 1px solid #e0e0e0; border-radius: 8px; margin-bottom: 1.5rem; overflow: hidden; }
  .farm-header { background: #f7faf8; padding: 1rem 1.25rem; border-bottom: 1px solid #e0e0e0; }
  .farm-name { font-weight: 700; font-size: 1.05rem; color: #2d6a4f; }
  .farm-location { font-size: 0.85rem; color: #555; margin-top: 0.15rem; }
  .farm-badges { margin-top: 0.5rem; display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
  .badge-organic { background: #d4edda; color: #155724; }
  .badge-safe { background: #e8f5e9; color: #2e7d32; }
  .badge-cert { background: #fff3cd; color: #856404; }
  .badge-practice { background: #e3f2fd; color: #1565c0; }
  .farm-env { margin-top: 0.6rem; display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; font-size: 0.85rem; }
  .env-grade { display: inline-flex; align-items: center; justify-content: center; width: 2rem; height: 2rem; border-radius: 50%; font-weight: 700; font-size: 0.8rem; color: #fff; }
  .grade-aplus, .grade-a\\+ { background: #2d6a4f; }
  .grade-b { background: #52b788; }
  .grade-c { background: #f9a825; }
  .grade-d { background: #c62828; }
  .env-detail { color: #555; }
  .env-savings { color: #2d6a4f; font-weight: 600; }
  table.line-items { width: 100%; border-collapse: collapse; }
  table.line-items th { background: #fafafa; text-align: left; padding: 0.6rem 1rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; color: #555; border-bottom: 1px solid #e0e0e0; }
  table.line-items td { padding: 0.6rem 1rem; border-bottom: 1px solid #f0f0f0; }
  table.line-items tfoot td { border-top: 1px solid #e0e0e0; padding: 0.5rem 1rem; font-size: 0.9rem; }
  table.line-items .total-row td { border-top: 2px solid #2d6a4f; }
  .center { text-align: center; }
  .right { text-align: right; }
  .price-ref { font-size: 0.75rem; color: #777; margin-top: 0.15rem; }
  .discount-note { font-size: 0.75rem; color: #52b788; margin-top: 0.1rem; }
  .env-summary { border: 2px solid #2d6a4f; border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem; }
  .env-summary-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
  .env-grade-lg { display: inline-flex; align-items: center; justify-content: center; width: 3.5rem; height: 3.5rem; border-radius: 50%; font-weight: 700; font-size: 1.4rem; color: #fff; }
  .env-summary-title { font-size: 1.1rem; font-weight: 700; color: #2d6a4f; }
  .env-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 0.75rem; }
  .env-metric { text-align: center; }
  .metric-value { font-size: 1.3rem; font-weight: 700; color: #1a1a1a; }
  .metric-label { font-size: 0.75rem; color: #777; margin-top: 0.2rem; }
  .env-baseline { font-size: 0.8rem; color: #777; text-align: center; border-top: 1px solid #e0e0e0; padding-top: 0.75rem; }
  .discount-summary { background: #e8f5e9; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 1rem; font-size: 0.9rem; color: #2e7d32; }
  .order-totals { margin-left: auto; width: 320px; }
  .order-totals table { width: 100%; border-collapse: collapse; }
  .order-totals td { padding: 0.4rem 0.75rem; font-size: 0.95rem; }
  .order-totals .grand-total td { border-top: 3px solid #2d6a4f; font-size: 1.15rem; font-weight: 700; padding-top: 0.6rem; }
  .delivery-info { background: #f5f5f5; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 1.5rem; font-size: 0.9rem; color: #444; }
  .footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e0e0e0; font-size: 0.8rem; color: #999; text-align: center; }
  @media print { body { padding: 0; } .farm-section { break-inside: avoid; } }
</style>
</head>
<body>
  <div class="invoice-header">
    <div>
      <div class="brand">GreenReach Wholesale</div>
      <div class="brand-sub">Local Produce Network</div>
    </div>
    <div class="invoice-meta">
      <strong>${esc(invoice.invoice_id)}</strong>
      Order: ${esc(invoice.master_order_id)}<br/>
      Date: ${new Date(invoice.order_date).toLocaleDateString('en-CA')}<br/>
      Status: ${esc(invoice.status)}
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <div class="party-label">Bill To</div>
      <div class="party-name">${esc(buyer.business_name)}</div>
      ${buyer.contact_name ? `<div class="party-detail">${esc(buyer.contact_name)}</div>` : ''}
      ${buyer.email ? `<div class="party-detail">${esc(buyer.email)}</div>` : ''}
      ${buyer.city || buyer.state ? `<div class="party-detail">${esc(buyer.city)}${buyer.city && buyer.state ? ', ' : ''}${esc(buyer.state)}</div>` : ''}
    </div>
    <div class="party">
      <div class="party-label">From</div>
      <div class="party-name">GreenReach Greens</div>
      <div class="party-detail">greenreachgreens.com</div>
    </div>
  </div>

  ${deliveryHTML}
  ${discountHTML}
  ${envSummaryHTML}

  ${farmHTML}

  <div class="order-totals">
    <table>
      <tr><td>Subtotal</td><td class="right">${money(totals.subtotal, currency)}</td></tr>
      <tr><td>Broker Fee</td><td class="right">${money(totals.broker_fee_total, currency)}</td></tr>
      ${totals.tax_total > 0 ? `<tr><td>Tax</td><td class="right">${money(totals.tax_total, currency)}</td></tr>` : ''}
      <tr class="grand-total"><td>Total</td><td class="right">${money(totals.total, currency)}</td></tr>
    </table>
  </div>

  <div class="footer">
    Generated ${new Date().toLocaleDateString('en-CA')} &middot; GreenReach Wholesale &middot; greenreachgreens.com
  </div>
</body>
</html>`;
}
