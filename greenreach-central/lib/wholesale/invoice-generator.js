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

/**
 * Get next sequential invoice number from DB.
 * Falls back to order-based ID if DB unavailable.
 */
let _invoiceQuery = null;
export async function getNextInvoiceNumber(orderId, farmId) {
  try {
    if (!_invoiceQuery) {
      const db = await import('../../config/database.js');
      _invoiceQuery = db.query;
    }
    const result = await _invoiceQuery(
      `INSERT INTO invoice_numbers (invoice_number, order_id, farm_id)
       VALUES ('INV-' || LPAD(nextval('invoice_number_seq')::text, 6, '0'), $1, $2)
       ON CONFLICT (order_id) DO UPDATE SET order_id = EXCLUDED.order_id
       RETURNING invoice_number`,
      [orderId, farmId || null]
    );
    return result.rows[0]?.invoice_number || `INV-${orderId}`;
  } catch {
    return `INV-${orderId}`;
  }
}

// Weight units that qualify for per-100g / per-oz breakdowns
const WEIGHT_UNITS = new Set(['oz', 'lb', 'g', 'kg', 'lb_case', 'pint', 'quart', 'unit', 'bunch', 'clamshell']);

/**
 * Convert a price+unit to per_oz and per_100g pricing
 * @param {number} pricePerUnit - Price for one unit
 * @param {string} unit - Unit of measure (oz, lb, g, kg)
 * @returns {{ per_oz: number, per_100g: number } | null}
 */
function weightBreakdown(pricePerUnit, unit) {
  if (!WEIGHT_UNITS.has(unit) || !pricePerUnit) return null;
  let per100g = null;
  let perPint = null;

  switch (unit) {
    case 'oz':
      per100g = pricePerUnit * (100 / 28.3495);
      break;
    case 'lb':
    case 'lb_case':
      per100g = pricePerUnit / 4.53592;
      break;
    case 'g':
      per100g = pricePerUnit * 100;
      break;
    case 'kg':
      per100g = pricePerUnit * 0.1;
      break;
    case 'pint':
      perPint = pricePerUnit;
      break;
    case 'quart':
      perPint = pricePerUnit / 2;
      break;
    case 'unit':
    case 'bunch':
    case 'clamshell':
      // Non-weight, non-volume items: show per-unit price only
      perPint = null;
      per100g = null;
      break;
    default:
      return null;
  }

  const result = {};
  if (per100g !== null) result.per_100g = Math.round(per100g * 100) / 100;
  if (perPint !== null) result.per_pint = Math.round(perPint * 100) / 100;
  return Object.keys(result).length > 0 ? result : null;
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

function normalizeText(value) {
  if (value == null) return '';
  return String(value).trim();
}

function firstDefinedValue(values = []) {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) return normalized;
  }
  return '';
}

function buildFarmAddress(profile = {}) {
  const location = profile.location || {};
  const contact = profile.contact || {};

  const line1 = firstDefinedValue([
    profile.address,
    profile.address1,
    profile.street,
    location.address,
    location.address1,
    location.street,
    location.street1,
    location.line1,
    contact.address,
    contact.address1
  ]);
  const line2 = firstDefinedValue([
    profile.address2,
    location.address2,
    location.street2,
    location.line2,
    contact.address2
  ]);
  const city = firstDefinedValue([profile.city, location.city, location.town]);
  const region = firstDefinedValue([
    profile.state,
    profile.province,
    location.state,
    location.province,
    location.region
  ]);
  const postalCode = firstDefinedValue([
    profile.postal_code,
    profile.postalCode,
    profile.zip,
    location.postal_code,
    location.postalCode,
    location.zip
  ]);
  const country = firstDefinedValue([profile.country, location.country]);

  const cityRegion = [city, region].filter(Boolean).join(', ');
  const locality = [cityRegion, postalCode].filter(Boolean).join(' ');
  return [line1, line2, locality, country].filter(Boolean).join(', ');
}

function resolveFarmPhone(profile = {}) {
  const contact = profile.contact || {};
  return firstDefinedValue([
    profile.phone,
    profile.contact_phone,
    profile.phone_number,
    contact.phone,
    contact.phone_number,
    contact.primary_phone,
    contact.mobile,
    contact.tel
  ]);
}

function resolveFarmEmail(profile = {}) {
  const contact = profile.contact || {};
  return firstDefinedValue([
    profile.email,
    profile.contact_email,
    contact.email,
    contact.contact_email,
    contact.primary_email
  ]);
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
    const farmAddress = buildFarmAddress(profile);
    const farmPhone = resolveFarmPhone(profile);
    const farmEmail = resolveFarmEmail(profile);

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
      const resolvedUnitPrice = item.unit_price != null ? item.unit_price : (item.price_per_unit != null ? item.price_per_unit : (item.price || 0));
      const wb = weightBreakdown(resolvedUnitPrice, unit);
      return {
        sku_id: item.sku_id,
        sku_name: item.sku_name || item.product_name || item.sku_id,
        qty: item.qty || item.quantity || 0,
        unit,
        unit_price: resolvedUnitPrice,
        list_price: item.list_price,
        discount_rate: item.discount_rate || 0,
        line_total: item.line_total || ((item.qty || item.quantity || 0) * resolvedUnitPrice),
        weight_breakdown: wb,
        traceability: {
          lot_id: item.lot_id || item.traceability?.lot_id || null,
          harvest_date: item.harvest_date_start || item.traceability?.harvest_date || null,
          best_by_date: item.best_by_date || item.traceability?.best_by_date || null,
          quality_flags: item.quality_flags || item.traceability?.quality_flags || []
        }
      };
    });

    return {
      farm_id: farmId,
      farm_name: sub.farm_name || profile.name || farmId,
      city: profile.city || profile.location?.city || profile.location?.town || '',
      state: profile.state || profile.province || profile.location?.state || profile.location?.province || profile.location?.region || '',
      address: farmAddress,
      phone: farmPhone,
      email: farmEmail,
      practices: practices.map(p => PRACTICE_LABELS[p] || p),
      certifications: certifications.map(c => CERT_LABELS[c] || c),
      safety,
      env_score: envScore,
      items,
      subtotal: sub.subtotal || 0,
      broker_fee_amount: sub.broker_fee_amount || sub.broker_fee || Math.round((sub.subtotal || 0) * 0.12 * 100) / 100,
      tax_rate: sub.tax_rate || 0,
      tax_label: sub.tax_label || 'TAX',
      tax_amount: sub.tax_amount || 0,
      total: sub.total || ((sub.subtotal || 0) + (sub.broker_fee_amount || sub.broker_fee || Math.round((sub.subtotal || 0) * 0.12 * 100) / 100) + (sub.tax_amount || 0)),
      tax_registration_number: profile.tax_registration_number || profile.gst_number || profile.hst_number || null
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

  // Totals from order.totals, order root fields, or summed from farm sections
  const summedSubtotal = farmSections.reduce((s, f) => s + f.subtotal, 0);
  const summedBroker = farmSections.reduce((s, f) => s + f.broker_fee_amount, 0);
  const summedTax = farmSections.reduce((s, f) => s + f.tax_amount, 0);
  const summedTotal = farmSections.reduce((s, f) => s + f.total, 0);
  const rawTotals = order.totals || {};
  const totals = {
    subtotal: rawTotals.subtotal || order.subtotal || summedSubtotal,
    broker_fee_total: rawTotals.broker_fee_total || order.broker_fee_total || summedBroker,
    tax_total: rawTotals.tax_total || order.tax_total || summedTax,
    total: rawTotals.total || rawTotals.grand_total || order.grand_total || summedTotal
  };

  // Discount info from order
  const discount = order.buyer_discount || order.allocation?.buyer_discount_rate
    ? { rate: order.buyer_discount?.rate || order.allocation?.buyer_discount_rate || 0,
        tier: order.buyer_discount?.tier || '',
        trailing_spend: order.buyer_discount?.trailing_spend || 0 }
    : null;

  const fulfillmentMethod = String(
    order.fulfillment_method
    || order.fulfillmentMethod
    || order.cart?.fulfillment_method
    || order.cart?.fulfillmentMethod
    || order.delivery?.method
    || ''
  ).toLowerCase() === 'pickup' ? 'pickup' : 'delivery';

  const deliveryAddress = order.delivery_address || order.cart?.delivery_address || {};
  const deliveryAddressText = firstDefinedValue([
    order.delivery?.address,
    [
      deliveryAddress.street || deliveryAddress.address1,
      deliveryAddress.city,
      deliveryAddress.province || deliveryAddress.state,
      deliveryAddress.postalCode || deliveryAddress.postal_code || deliveryAddress.zip
    ].filter(Boolean).join(', ')
  ]);
  const deliveryZip = firstDefinedValue([
    order.delivery?.zip,
    deliveryAddress.postalCode,
    deliveryAddress.postal_code,
    deliveryAddress.zip
  ]);
  const deliveryDate = firstDefinedValue([
    order.delivery_date,
    order.deliveryDate,
    order.delivery?.delivery_date,
    order.delivery?.date
  ]);
  const pickupSchedule = firstDefinedValue([
    order.pickup_schedule,
    order.pickupSchedule,
    order.cart?.pickup_schedule,
    order.cart?.pickupSchedule
  ]);
  const deliverySchedule = firstDefinedValue([
    order.delivery_schedule,
    order.deliverySchedule,
    order.cart?.delivery_schedule,
    order.cart?.deliverySchedule
  ]);
  const preferredWindow = firstDefinedValue([
    order.preferred_delivery_window,
    order.preferredDeliveryWindow,
    order.time_slot,
    order.cart?.preferred_delivery_window,
    order.cart?.time_slot
  ]);

  const delivery = {
    method: fulfillmentMethod,
    address: deliveryAddressText,
    zip: deliveryZip,
    delivery_date: deliveryDate,
    preferred_window: preferredWindow,
    pickup_schedule: pickupSchedule,
    delivery_schedule: deliverySchedule
  };

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
    delivery
  };
}

/**
 * Map order status codes to human-readable labels for the invoice.
 */
const STATUS_LABELS = {
  confirmed: 'Confirmed',
  pending: 'Pending Acceptance',
  pending_payment: 'Pending Acceptance',
  payment_failed: 'Payment Failed',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  completed: 'Completed'
};

function humanStatus(status) {
  return STATUS_LABELS[status] || status;
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
        ? `<div class="price-ref">${wb.per_100g != null ? `${money(wb.per_100g, currency)}/100g` : ''}${wb.per_100g != null && wb.per_pint != null ? ' &middot; ' : ''}${wb.per_pint != null ? `${money(wb.per_pint, currency)}/pint` : ''}</div>`
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
          ${farm.address ? `<div class="farm-trace"><strong>Address:</strong> ${esc(farm.address)}</div>` : '<div class="farm-trace missing">Address: Missing in farm profile</div>'}
          ${farm.phone ? `<div class="farm-trace"><strong>Phone:</strong> ${esc(farm.phone)}</div>` : '<div class="farm-trace missing">Phone: Missing in farm profile</div>'}
            ${farm.email ? `<div class="farm-trace"><strong>Email:</strong> ${esc(farm.email)}</div>` : ''}
          ${farm.tax_registration_number ? `<div class="farm-trace"><strong>GST/HST Reg:</strong> ${esc(farm.tax_registration_number)}</div>` : ''}
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
    const method = String(delivery.method || 'delivery').toLowerCase();
    if (method === 'pickup') {
      const pickupWindow = delivery.pickup_schedule || delivery.preferred_window || '';
      deliveryHTML = `
      <div class="delivery-info">
        <strong>Pickup:</strong> At Farm
        ${delivery.delivery_date ? ` &middot; Date: ${esc(delivery.delivery_date)}` : ''}
        ${pickupWindow ? ` &middot; Window: ${esc(pickupWindow)}` : ''}
      </div>`;
    } else {
      const deliveryWindow = delivery.delivery_schedule || delivery.preferred_window || '';
      deliveryHTML = `
      <div class="delivery-info">
        <strong>Delivery:</strong> ${esc(delivery.address || '')}
        ${delivery.delivery_date ? ` &middot; Date: ${esc(delivery.delivery_date)}` : ''}
        ${deliveryWindow ? ` &middot; Window: ${esc(deliveryWindow)}` : ''}
        ${delivery.zip ? ` &middot; ZIP: ${esc(delivery.zip)}` : ''}
      </div>`;
    }
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
  .farm-trace { font-size: 0.82rem; color: #444; margin-top: 0.15rem; }
  .farm-trace.missing { color: #8a4f4f; font-style: italic; }
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
      Status: ${esc(humanStatus(invoice.status))}
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
