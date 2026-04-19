// Harvest & Donations section.
// Extracted from public/LE-farm-admin.html. Mirrored to greenreach-central.
// Loads after wholesale-orders.js — depends on _woHeaders() from that module.
// Globals: loadHarvestDonationData(), toggleDonationProductField(),
// populateDonationDatalist(), showAddDonationModal(), saveDonation().
// ===================================================================
// HARVEST & DONATIONS SECTION
// ===================================================================

async function loadHarvestDonationData() {
  try {
    const { headers } = _woHeaders();

    const [harvestRes, donationRes] = await Promise.all([
      fetch('/api/harvest', { headers }).catch(() => null),
      fetch('/api/farm-sales/donations', { headers }).catch(() => null)
    ]);

    const harvestData = harvestRes && harvestRes.ok ? await harvestRes.json() : { ok: false };
    const donationData = donationRes && donationRes.ok ? await donationRes.json() : { ok: false };

    // Harvest summary cards
    const harvests = harvestData.ok ? (harvestData.harvests || []) : [];
    let totalWeight = 0;
    const cropSet = new Set();
    let lastHarvestDate = null;
    let lastCrop = '';

    harvests.forEach(h => {
      totalWeight += Number(h.weight || h.weight_oz || 0);
      cropSet.add(h.crop || h.common_name || 'Unknown');
      const d = h.recordedAt || h.recorded_at || h.date;
      if (d && (!lastHarvestDate || new Date(d) > new Date(lastHarvestDate))) {
        lastHarvestDate = d;
        lastCrop = h.crop || h.common_name || '';
      }
    });

    const el = (id) => document.getElementById(id);
    if (el('hd-total-weight')) el('hd-total-weight').textContent = totalWeight >= 16 ? (Math.round(totalWeight / 16 * 10) / 10) + ' lbs' : totalWeight + ' oz';
    if (el('hd-total-events')) el('hd-total-events').textContent = harvests.length + ' harvest events';
    if (el('hd-crop-count')) el('hd-crop-count').textContent = cropSet.size;
    if (el('hd-crop-list')) el('hd-crop-list').textContent = Array.from(cropSet).slice(0, 5).join(', ');
    if (el('hd-last-harvest')) el('hd-last-harvest').textContent = lastHarvestDate ? new Date(lastHarvestDate).toLocaleDateString() : '--';
    if (el('hd-last-crop')) el('hd-last-crop').textContent = lastCrop;

    // Harvest table (recent 50)
    const sorted = [...harvests].sort((a, b) => {
      const da = a.recordedAt || a.recorded_at || a.date || '';
      const db = b.recordedAt || b.recorded_at || b.date || '';
      return new Date(db) - new Date(da);
    }).slice(0, 50);

    const harvestTbody = el('hd-harvest-list');
    if (harvestTbody) {
      if (sorted.length === 0) {
        harvestTbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-secondary);">No harvests recorded yet. Record harvests from the Activity Hub or via EVIE.</td></tr>';
      } else {
        harvestTbody.innerHTML = sorted.map(h => {
          const date = h.recordedAt || h.recorded_at || h.date;
          const w = Number(h.weight || h.weight_oz || 0);
          const wLabel = w >= 16 ? (Math.round(w / 16 * 10) / 10) + ' lbs' : w + ' oz';
          const q = h.quality || h.quality_score;
          const qLabel = q ? (Math.round(q * 100)) + '%' : '--';
          return `<tr>
            <td>${date ? new Date(date).toLocaleDateString() : '--'}</td>
            <td>${escapeHtmlWo(h.crop || h.common_name || '--')}</td>
            <td>${escapeHtmlWo(h.variety || '--')}</td>
            <td>${wLabel}</td>
            <td style="font-family:monospace;font-size:12px;">${escapeHtmlWo(h.lot_code || h.lot || '--')}</td>
            <td>${q ? '<span style="color:' + (q >= 0.8 ? '#34d399' : q >= 0.6 ? '#f59e0b' : '#f87171') + ';font-weight:600;">' + qLabel + '</span>' : '--'}</td>
          </tr>`;
        }).join('');
      }
    }

    // Donations
    const donations = donationData.ok ? (donationData.donations || []) : [];
    let totalDonated = 0;
    donations.forEach(d => { totalDonated += Number(d.weight_kg || d.weight || 0); });
    if (el('hd-total-donated')) el('hd-total-donated').textContent = totalDonated > 0 ? totalDonated + ' kg' : '0 kg';
    if (el('hd-donation-count')) el('hd-donation-count').textContent = donations.length + ' donations';

    const donationTbody = el('hd-donation-list');
    if (donationTbody) {
      if (donations.length === 0) {
        donationTbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-secondary);">No donations recorded yet. Click "+ Record Donation" to add one.</td></tr>';
      } else {
        donationTbody.innerHTML = donations.map(d => {
          const date = d.date || d.created_at;
          const pType = d.product_type || 'harvest';
          const typeLabel = pType === 'custom' ? 'Custom' : pType === 'value_added' ? 'Value-Added' : 'Crop';
          const unit = d.unit || 'kg';
          const qty = d.weight_kg || d.weight || d.quantity || 0;
          return `<tr>
            <td>${date ? new Date(date).toLocaleDateString() : '--'}</td>
            <td>${escapeHtmlWo(d.recipient || d.recipient_name || '--')}</td>
            <td>${escapeHtmlWo(d.crop || d.product_name || '--')}</td>
            <td><span style="font-size:11px;padding:2px 6px;border-radius:4px;background:${pType === 'custom' ? 'rgba(249,115,22,0.15);color:#f97316' : pType === 'value_added' ? 'rgba(59,130,246,0.15);color:#3b82f6' : 'rgba(52,211,153,0.15);color:#34d399'};">${typeLabel}</span></td>
            <td>${qty} ${unit}</td>
            <td>${escapeHtmlWo(d.notes || '')}</td>
          </tr>`;
        }).join('');
      }
    }

    // Populate product datalist from harvest data for the donation modal
    _hdHarvestProducts = [];
    const productSet = new Set();
    harvests.forEach(h => {
      const name = h.crop || h.common_name;
      if (name && !productSet.has(name.toLowerCase())) {
        productSet.add(name.toLowerCase());
        _hdHarvestProducts.push(name);
      }
    });

    // Also pull from inventory if available
    try {
      const { headers: invHeaders } = _woHeaders();
      const invRes = await fetch('/api/farm-sales/inventory', { headers: invHeaders }).catch(() => null);
      if (invRes && invRes.ok) {
        const invData = await invRes.json();
        (invData.inventory || []).forEach(item => {
          const name = item.product_name || item.sku_id;
          if (name && !productSet.has(name.toLowerCase())) {
            productSet.add(name.toLowerCase());
            _hdHarvestProducts.push(name);
          }
        });
      }
    } catch (e) { /* inventory is optional */ }

  } catch (err) {
    console.error('[Harvest & Donations] Error:', err);
  }
}

// Product list from harvest/inventory data, populated by loadHarvestDonationData
var _hdHarvestProducts = [];

function toggleDonationProductField() {
  const typeEl = document.getElementById('donation-product-type');
  const hintEl = document.getElementById('donation-product-hint');
  const cropEl = document.getElementById('donation-crop');
  if (!typeEl || !hintEl || !cropEl) return;

  const t = typeEl.value;
  if (t === 'harvest') {
    hintEl.textContent = 'Choose from harvested crops or type a crop name';
    cropEl.placeholder = 'Select or type a crop name';
    populateDonationDatalist(_hdHarvestProducts);
  } else if (t === 'value_added') {
    hintEl.textContent = 'Enter any value-added product (salad mix, herb bundle, etc.)';
    cropEl.placeholder = 'e.g. Spring Mix, Herb Bundle, Microgreen Box';
    populateDonationDatalist([]);
  } else {
    hintEl.textContent = 'Type any product or item name';
    cropEl.placeholder = 'e.g. Compost, Seedlings, Gift Basket';
    populateDonationDatalist([]);
  }
}

function populateDonationDatalist(products) {
  const dl = document.getElementById('donation-product-list');
  if (!dl) return;
  dl.innerHTML = products.map(p => `<option value="${escapeHtmlWo(p)}">`).join('');
}

function showAddDonationModal() {
  const modal = document.getElementById('addDonationModal');
  if (modal) {
    modal.style.display = 'flex';
    const dateInput = document.getElementById('donation-date');
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().slice(0, 10);
    }
    // Reset fields
    const typeEl = document.getElementById('donation-product-type');
    if (typeEl) typeEl.value = 'harvest';
    const unitEl = document.getElementById('donation-unit');
    if (unitEl) unitEl.value = 'kg';
    const reasonEl = document.getElementById('donation-reason');
    if (reasonEl) reasonEl.value = 'surplus';
    // Populate datalist with known products
    populateDonationDatalist(_hdHarvestProducts);
    toggleDonationProductField();
  }
}

async function saveDonation() {
  const date = document.getElementById('donation-date')?.value;
  const recipient = document.getElementById('donation-recipient')?.value?.trim();
  const crop = document.getElementById('donation-crop')?.value?.trim();
  const weight = document.getElementById('donation-weight')?.value;
  const unit = document.getElementById('donation-unit')?.value || 'kg';
  const productType = document.getElementById('donation-product-type')?.value || 'harvest';
  const reason = document.getElementById('donation-reason')?.value || 'surplus';
  const notes = document.getElementById('donation-notes')?.value?.trim();

  if (!recipient || !crop || !weight) {
    alert('Please fill in recipient, product name, and quantity.');
    return;
  }

  try {
    const { headers, farmId } = _woHeaders();
    headers['Content-Type'] = 'application/json';

    const res = await fetch('/api/farm-sales/donations', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        date: date || new Date().toISOString().slice(0, 10),
        recipient_name: recipient,
        product_name: crop,
        product_type: productType,
        weight_kg: Number(weight),
        unit: unit,
        reason: reason,
        notes: notes || '',
        farm_id: farmId
      })
    });

    if (res.ok) {
      document.getElementById('addDonationModal').style.display = 'none';
      ['donation-recipient', 'donation-crop', 'donation-weight', 'donation-notes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      loadHarvestDonationData();
    } else {
      const data = await res.json().catch(() => ({}));
      alert('Failed to save: ' + (data.error || data.message || 'Unknown error'));
    }
  } catch (err) {
    console.error('[Donations] Save error:', err);
    alert('Error saving donation: ' + err.message);
  }
}

// Wire up lazy loading for wholesale-orders and harvest-donations
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-section="wholesale-orders"]').forEach(link => {
    link.addEventListener('click', () => { refreshWholesaleOrders(); });
  });
  document.querySelectorAll('[data-section="harvest-donations"]').forEach(link => {
    link.addEventListener('click', () => { loadHarvestDonationData(); });
  });
});
