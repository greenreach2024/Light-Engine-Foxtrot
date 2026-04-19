// Wholesale orders management + Today's Harvest Plan.
// Extracted from public/LE-farm-admin.html. Mirrored to greenreach-central.
// Globals: _woAllOrders, _woCurrentTab, WO_STATUS_MAP, refreshWholesaleOrders(),
// filterWholesaleTab(), woAcceptOrder(), woDeclineOrder(), loadTodaysHarvestPlan(), _woHeaders().
// ===================================================================
// WHOLESALE ORDERS MANAGEMENT
// ===================================================================

let _woAllOrders = [];
let _woCurrentTab = 'all';

const WO_STATUS_MAP = {
  'pending_verification': 'new',
  'pending_farm_verification': 'new',
  'pending': 'new',
  'farm_accepted': 'accepted',
  'accepted': 'accepted',
  'confirmed': 'accepted',
  'shipped': 'accepted',
  'picked_up': 'accepted',
  'fulfilled': 'accepted',
  'farm_declined': 'declined',
  'declined': 'declined',
  'cancelled': 'declined',
  'expired': 'declined'
};

function getWoTabCategory(status) {
  return WO_STATUS_MAP[status] || 'new';
}

function getWoStatusBadge(status) {
  const cat = getWoTabCategory(status);
  const colors = {
    new: { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa' },
    accepted: { bg: 'rgba(52,211,153,0.15)', text: '#34d399' },
    declined: { bg: 'rgba(248,113,113,0.15)', text: '#f87171' }
  };
  const c = colors[cat] || colors.new;
  const label = (status || 'pending').replace(/_/g, ' ');
  return `<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;background:${c.bg};color:${c.text};text-transform:capitalize;">${label}</span>`;
}

function escapeHtmlWo(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _woHeaders() {
  const headers = {};
  const token = window.currentSession?.token || localStorage.getItem('auth_token');
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const farmId = window.currentSession?.farm_id || localStorage.getItem('farm_id') || '';
  if (farmId) headers['x-farm-id'] = farmId;
  return { headers, farmId };
}

async function refreshWholesaleOrders() {
  const container = document.getElementById('wholesale-orders-container');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">Loading...</div>';

  try {
    const { headers, farmId } = _woHeaders();
    const url = '/api/wholesale/order-events' + (farmId ? '?farm_id=' + encodeURIComponent(farmId) : '');
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    _woAllOrders = data.events || data.orders || [];
    renderWholesaleOrders();
    loadTodaysHarvestPlan();
  } catch (err) {
    console.error('[Wholesale] Load error:', err);
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);"><p>No wholesale orders found. Orders from GreenReach buyers will appear here.</p></div>';
    loadTodaysHarvestPlan();
  }
}

function filterWholesaleTab(tab) {
  _woCurrentTab = tab;
  document.querySelectorAll('.wo-tab').forEach(btn => {
    const t = btn.getAttribute('data-wo-tab');
    if (t === tab) {
      btn.style.borderBottomColor = 'var(--accent-green)';
      btn.style.color = 'var(--accent-green)';
    } else {
      btn.style.borderBottomColor = 'transparent';
      btn.style.color = 'var(--text-muted)';
    }
  });
  renderWholesaleOrders();
}

function renderWholesaleOrders() {
  const container = document.getElementById('wholesale-orders-container');
  const titleEl = document.getElementById('wo-tab-title');
  if (!container) return;

  let filtered = _woAllOrders;
  if (_woCurrentTab !== 'all') {
    filtered = _woAllOrders.filter(o => getWoTabCategory(o.status) === _woCurrentTab);
  }

  const tabTitles = { all: 'All Orders', new: 'New Orders', accepted: 'Accepted Orders', declined: 'Declined Orders' };
  if (titleEl) titleEl.textContent = (tabTitles[_woCurrentTab] || 'Order Queue') + ' (' + filtered.length + ')';

  if (filtered.length === 0) {
    const msgs = {
      all: 'No wholesale orders yet. Orders from GreenReach buyers will appear here.',
      new: 'No new orders awaiting your response.',
      accepted: 'No accepted orders.',
      declined: 'No declined orders.'
    };
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);"><p>' + (msgs[_woCurrentTab] || msgs.all) + '</p></div>';
    return;
  }

  container.innerHTML = filtered.map(order => {
    const items = (order.items || []).map(it =>
      `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);">
        <span>${escapeHtmlWo(it.product_name || it.sku_id || 'Item')}</span>
        <span>${it.quantity || 0} ${it.unit || 'lb'} @ $${(Number(it.price_per_unit) || 0).toFixed(2)}</span>
      </div>`
    ).join('');

    const deadline = order.verification_deadline
      ? new Date(order.verification_deadline).toLocaleString()
      : '--';

    const isNew = getWoTabCategory(order.status) === 'new';
    const oid = escapeHtmlWo(order.order_id || '');
    const actionBtns = isNew
      ? `<div style="display:flex;gap:8px;margin-top:12px;">
          <button onclick="woAcceptOrder('${oid}')" style="padding:8px 20px;background:var(--accent-green);color:#0f1923;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Accept</button>
          <button onclick="woDeclineOrder('${oid}')" style="padding:8px 20px;background:rgba(248,113,113,0.2);color:#f87171;border:1px solid rgba(248,113,113,0.3);border-radius:6px;cursor:pointer;font-weight:600;">Decline</button>
        </div>`
      : '';

    return `<div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div>
          <div style="font-weight:600;font-size:15px;color:var(--text-primary);">${escapeHtmlWo(order.buyer_name || order.buyer_business_name || 'Buyer')}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">Order: ${oid}</div>
        </div>
        <div style="text-align:right;">
          ${getWoStatusBadge(order.status)}
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">$${(Number(order.total_amount) || 0).toFixed(2)}</div>
        </div>
      </div>
      <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">
        <span>Delivery: ${order.delivery_date ? new Date(order.delivery_date).toLocaleDateString() : 'TBD'}</span>
        <span style="margin-left:16px;">Method: ${escapeHtmlWo(order.fulfillment_method || 'delivery')}</span>
        ${order.delivery_address ? '<span style="margin-left:16px;">' + escapeHtmlWo(order.delivery_address) + '</span>' : ''}
      </div>
      ${isNew ? '<div style="font-size:12px;color:#f59e0b;margin-bottom:8px;">Respond by: ' + deadline + '</div>' : ''}
      <div style="margin-top:8px;">${items}</div>
      ${actionBtns}
    </div>`;
  }).join('');
}

async function woAcceptOrder(subOrderId) {
  if (!confirm('Accept this order?')) return;
  try {
    const { headers, farmId } = _woHeaders();
    headers['Content-Type'] = 'application/json';
    const res = await fetch('/api/wholesale/orders/farm-verify', {
      method: 'POST',
      headers,
      body: JSON.stringify({ farm_id: farmId, sub_order_id: subOrderId, action: 'accept' })
    });
    const data = await res.json();
    if (data.success || data.ok) {
      const order = _woAllOrders.find(o => o.order_id === subOrderId);
      if (order) order.status = 'farm_accepted';
      renderWholesaleOrders();
    } else {
      alert('Failed to accept: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('[Wholesale] Accept error:', err);
    alert('Error accepting order: ' + err.message);
  }
}

async function woDeclineOrder(subOrderId) {
  const reason = prompt('Reason for declining (optional):');
  if (reason === null) return;
  try {
    const { headers, farmId } = _woHeaders();
    headers['Content-Type'] = 'application/json';
    const res = await fetch('/api/wholesale/orders/farm-verify', {
      method: 'POST',
      headers,
      body: JSON.stringify({ farm_id: farmId, sub_order_id: subOrderId, action: 'decline', reason: reason || '' })
    });
    const data = await res.json();
    if (data.success || data.ok) {
      const order = _woAllOrders.find(o => o.order_id === subOrderId);
      if (order) order.status = 'farm_declined';
      renderWholesaleOrders();
    } else {
      alert('Failed to decline: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('[Wholesale] Decline error:', err);
    alert('Error declining order: ' + err.message);
  }
}

// ===================================================================
// TODAY'S HARVEST PLAN
// Combines: wholesale order demand + typical retail + mature crop turnover
// ===================================================================

async function loadTodaysHarvestPlan() {
  const tbody = document.getElementById('wo-harvest-plan-body');
  const donationContainer = document.getElementById('wo-donation-recommendations');
  if (!tbody) return;

  try {
    const { headers } = _woHeaders();

    const [readinessRes, inventoryRes] = await Promise.all([
      fetch('/api/harvest/readiness', { headers }).catch(() => null),
      fetch('/api/farm-sales/inventory', { headers }).catch(() => null)
    ]);

    const readiness = readinessRes && readinessRes.ok ? await readinessRes.json() : { ok: false };
    const inventory = inventoryRes && inventoryRes.ok ? await inventoryRes.json() : { ok: false };

    // Build demand from wholesale orders (non-declined)
    const demandMap = {};
    _woAllOrders.forEach(order => {
      if (getWoTabCategory(order.status) === 'declined') return;
      (order.items || []).forEach(item => {
        const key = (item.product_name || item.sku_id || 'Unknown').toLowerCase();
        if (!demandMap[key]) demandMap[key] = { crop: item.product_name || item.sku_id || 'Unknown', variety: '', wholesaleQty: 0, unit: item.unit || 'lb' };
        demandMap[key].wholesaleQty += Number(item.quantity) || 0;
      });
    });

    // Build readiness data
    const readyMap = {};
    const notifications = readiness.ok ? (readiness.notifications || []) : [];
    notifications.forEach(n => {
      const cropName = (n.crop || n.common_name || 'Unknown').toLowerCase();
      if (!readyMap[cropName]) {
        readyMap[cropName] = {
          crop: n.crop || n.common_name || 'Unknown',
          variety: n.variety || '',
          daysToHarvest: n.daysToHarvest ?? n.days_to_harvest ?? null,
          ready: n.ready || ((n.daysToHarvest ?? n.days_to_harvest ?? 99) <= 0),
          items: []
        };
      }
      readyMap[cropName].items.push(n);
    });

    // Build retail estimates from inventory
    const invItems = inventory.ok ? (inventory.inventory || []) : [];
    const retailMap = {};
    invItems.forEach(item => {
      const key = (item.product_name || item.sku_id || 'Unknown').toLowerCase();
      retailMap[key] = {
        qtyAvailable: Number(item.qty_available || item.auto_quantity_lbs || 0),
        retailPrice: Number(item.retail_price || 0)
      };
    });

    // Merge all crops into harvest plan
    const allCrops = new Set([...Object.keys(demandMap), ...Object.keys(readyMap)]);
    const harvestPlan = [];

    allCrops.forEach(key => {
      const demand = demandMap[key] || { crop: key, variety: '', wholesaleQty: 0, unit: 'lb' };
      const ready = readyMap[key] || null;
      const retail = retailMap[key] || null;

      // Retail estimate: ~20% of available as daily turnover
      const retailEstimate = retail ? Math.round(retail.qtyAvailable * 0.2 * 10) / 10 : 0;

      // Mature turnover: crops past harvest date (daysToHarvest <= -3)
      let matureWeight = 0;
      if (ready && ready.items) {
        ready.items.forEach(item => {
          const dth = item.daysToHarvest ?? item.days_to_harvest ?? 99;
          if (dth <= -3) {
            matureWeight += Number(item.estimatedWeightOz || item.estimated_weight_oz || 0) / 16;
          }
        });
      }
      matureWeight = Math.round(matureWeight * 10) / 10;

      const totalTarget = Math.round((demand.wholesaleQty + retailEstimate + matureWeight) * 10) / 10;

      let readinessLabel = '<span style="color:var(--text-muted);">No data</span>';
      if (ready) {
        const dth = ready.daysToHarvest;
        if (ready.ready || (dth !== null && dth <= 0)) {
          readinessLabel = '<span style="color:#34d399;font-weight:600;">Ready</span>';
        } else if (dth !== null && dth <= 2) {
          readinessLabel = `<span style="color:#f59e0b;font-weight:600;">${dth}d remaining</span>`;
        } else if (dth !== null) {
          readinessLabel = `<span style="color:var(--text-muted);">${dth} days</span>`;
        }
      }

      harvestPlan.push({
        crop: demand.crop !== key ? demand.crop : (ready ? ready.crop : key),
        variety: (ready ? ready.variety : '') || '--',
        wholesaleQty: demand.wholesaleQty,
        retailEstimate,
        matureWeight,
        totalTarget,
        readinessLabel,
        unit: demand.unit || 'lb',
        isMature: matureWeight > 0
      });
    });

    harvestPlan.sort((a, b) => b.totalTarget - a.totalTarget);

    if (harvestPlan.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-secondary);">No harvest data available. Crops nearing maturity and pending orders will appear here.</td></tr>';
    } else {
      tbody.innerHTML = harvestPlan.map(row =>
        `<tr${row.isMature ? ' style="background:rgba(139,92,246,0.05);"' : ''}>
          <td style="font-weight:600;">${escapeHtmlWo(row.crop)}</td>
          <td>${escapeHtmlWo(row.variety)}</td>
          <td>${row.wholesaleQty > 0 ? row.wholesaleQty + ' ' + row.unit : '--'}</td>
          <td>${row.retailEstimate > 0 ? '~' + row.retailEstimate + ' ' + row.unit : '--'}</td>
          <td>${row.matureWeight > 0 ? '<span style="color:#8b5cf6;">' + row.matureWeight + ' ' + row.unit + '</span>' : '--'}</td>
          <td style="font-weight:700;color:var(--accent-green);">${row.totalTarget > 0 ? row.totalTarget + ' ' + row.unit : '--'}</td>
          <td>${row.readinessLabel}</td>
        </tr>`
      ).join('');
    }

    // Donation recommendations: mature crops with surplus beyond demand
    if (donationContainer) {
      const donationCandidates = harvestPlan.filter(row => row.isMature && row.matureWeight > row.wholesaleQty);
      if (donationCandidates.length === 0) {
        donationContainer.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:14px;">No surplus crops identified for donation at this time. Mature crops exceeding order and retail demand will appear here as donation candidates.</div>';
      } else {
        donationContainer.innerHTML = '<div style="display:grid;gap:12px;padding:8px 0;">' +
          donationCandidates.map(row => {
            const surplusAmt = Math.round((row.matureWeight - row.wholesaleQty) * 10) / 10;
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.2);border-radius:8px;">
              <div>
                <div style="font-weight:600;color:var(--text-primary);">${escapeHtmlWo(row.crop)}${row.variety !== '--' ? ' (' + escapeHtmlWo(row.variety) + ')' : ''}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">Mature crop exceeding current demand -- harvest and donate to reduce waste and free growing space for new plantings</div>
              </div>
              <div style="text-align:right;min-width:120px;">
                <div style="font-size:20px;font-weight:700;color:#8b5cf6;">~${surplusAmt} ${row.unit}</div>
                <div style="font-size:11px;color:var(--text-muted);">available surplus</div>
              </div>
            </div>`;
          }).join('') +
        '</div>';
      }
    }

  } catch (err) {
    console.error('[Harvest Plan] Error:', err);
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-secondary);">Error loading harvest plan</td></tr>';
    if (donationContainer) {
      donationContainer.innerHTML = '<div style="padding:16px;color:var(--text-muted);">Unable to load donation recommendations</div>';
    }
  }
}

