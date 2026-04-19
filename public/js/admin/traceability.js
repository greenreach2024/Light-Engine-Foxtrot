// Unified Traceability – auto-populated at harvest, SFCR / CanadaGAP compliant.
// Extracted from public/LE-farm-admin.html. Mirrored to greenreach-central.
// Globals: TRACE_API, _traceRecordsCache, loadTraceRecords(), filterTraceRecords(),
// renderTraceRecords(), viewTraceDetail(), exportSFCR().
// Unified Traceability – auto-populated at harvest, SFCR / CanadaGAP compliant
const TRACE_API = window.location.origin;
let _traceRecordsCache = [];

async function loadTraceRecords() {
    try {
        // Build query params for date range filter
        const params = new URLSearchParams();
        const fromDate = document.getElementById('traceFromDate')?.value;
        const toDate = document.getElementById('traceToDate')?.value;
        if (fromDate) params.set('from_date', fromDate);
        if (toDate) params.set('to_date', toDate);
        const qs = params.toString() ? '?' + params.toString() : '';

        const [listRes, statsRes] = await Promise.all([
            fetch(`${TRACE_API}/api/traceability${qs}`),
            fetch(`${TRACE_API}/api/traceability/stats`)
        ]);
        const listData = await listRes.json();
        const statsData = await statsRes.json();

        if (statsData.ok || statsData.success) {
            const s = statsData.stats || {};
            document.getElementById('totalTraceRecords').textContent = s.total_records ?? s.total ?? 0;
            document.getElementById('activeTraceRecords').textContent = s.active_records ?? s.active ?? 0;
            document.getElementById('traceCrops').textContent = s.crops_tracked ?? s.crops ?? 0;
            document.getElementById('traceEvents').textContent = s.total_events ?? s.events ?? 0;
        }

        if (listData.ok || listData.success) {
            _traceRecordsCache = listData.records || [];
            renderTraceRecords(_traceRecordsCache);
        }
    } catch (err) {
        console.error('Failed to load trace records:', err);
        document.getElementById('traceRecordsList').innerHTML =
            '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-secondary);">Error loading records</td></tr>';
    }
}

function filterTraceRecords() {
    const search = (document.getElementById('traceabilitySearch')?.value || '').toLowerCase();
    const status = document.getElementById('traceStatusFilter')?.value || '';
    let filtered = _traceRecordsCache;
    if (status) filtered = filtered.filter(r => r.status === status);
    if (search) filtered = filtered.filter(r =>
        (r.lot_code || '').toLowerCase().includes(search) ||
        (r.common_name || '').toLowerCase().includes(search) ||
        (r.variety || '').toLowerCase().includes(search) ||
        (r.seed_source || '').toLowerCase().includes(search)
    );
    renderTraceRecords(filtered);
}

function renderTraceRecords(records) {
    const tbody = document.getElementById('traceRecordsList');
    if (!records || records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-secondary);">No trace records yet — records are created automatically when you harvest a tray.</td></tr>';
        return;
    }
    tbody.innerHTML = records.map(r => {
        const statusColors = {
            active: '#10b981', harvested: '#eab308', packed: '#3b82f6',
            shipped: '#8b5cf6', delivered: '#059669', recalled: '#ef4444'
        };
        const color = statusColors[r.status] || '#6b7280';
        const harvestDate = r.harvest_date ? new Date(r.harvest_date).toLocaleDateString() : '-';
        const rawWeight = r.actual_weight ?? r.harvest_weight_g;
        const weightUnit = r.weight_unit || (r.harvest_weight_g ? 'g' : '');
        const weight = rawWeight ? `${rawWeight} ${weightUnit}` : '-';
        const customers = (r.customers || []).map(c => c.name).join(', ') || '-';
        return `
            <tr style="cursor:pointer;" onclick="viewTraceDetail('${r.lot_code}')">
                <td><strong style="font-family:monospace;">${r.lot_code}</strong></td>
                <td>${r.common_name || '-'}</td>
                <td>${r.variety || '-'}</td>
                <td>${harvestDate}</td>
                <td>${weight}</td>
                <td>${r.seed_source || '-'}</td>
                <td><span style="padding:3px 8px;border-radius:4px;background:${color};color:white;font-size:12px;">${(r.status||'active').toUpperCase()}</span></td>
                <td style="font-size:12px;">${customers}</td>
                <td>
                    <button onclick="event.stopPropagation();viewTraceDetail('${r.lot_code}')" style="padding:4px 8px;background:var(--accent-primary);color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px;">Detail</button>
                </td>
            </tr>`;
    }).join('');
}

async function viewTraceDetail(lotCode) {
    try {
        const res = await fetch(`${TRACE_API}/api/traceability/lot/${lotCode}`);
        const data = await res.json();
        if (!data.ok && !data.success) { alert('Record not found'); return; }
        const r = data.record;
        const events = data.events || [];

        const rawWeight = r.actual_weight ?? r.harvest_weight_g;
        const weightUnit = r.weight_unit || (r.harvest_weight_g ? 'g' : '');
        const weight = rawWeight ? `${rawWeight} ${weightUnit}` : '-';
        const customers = (r.customers || []).map(c => `
            <div style="padding:8px;background:var(--bg-card);border-left:3px solid #10b981;margin-bottom:6px;border-radius:4px;">
                <strong>${c.name}</strong> — ${c.quantity || ''} — Order ${c.order_id || ''}
                <div style="font-size:12px;color:var(--text-secondary);">${c.date ? new Date(c.date).toLocaleDateString() : ''}</div>
            </div>`).join('') || '<div style="color:var(--text-secondary);font-size:13px;">No customers linked yet</div>';

        const timeline = events.map(e => `
            <div style="padding:10px;background:var(--bg-card);border-left:3px solid var(--accent-primary);margin-bottom:6px;border-radius:4px;">
                <div style="display:flex;justify-content:space-between;">
                    <strong>${(e.event_type||'').toUpperCase()}</strong>
                    <span style="font-size:12px;color:var(--text-secondary);">${new Date(e.timestamp).toLocaleString()}</span>
                </div>
                ${e.operator ? `<div style="font-size:12px;color:var(--text-secondary);">Operator: ${e.operator}</div>` : ''}
                ${e.detail ? `<div style="font-size:13px;margin-top:4px;">${e.detail}</div>` : ''}
            </div>`).join('') || '<div style="color:var(--text-secondary);">No lifecycle events</div>';

        document.getElementById('traceDetailContent').innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-bottom:20px;">
                <div><div style="font-size:12px;color:var(--text-secondary);">Lot Code</div><div style="font-weight:600;font-family:monospace;">${r.lot_code}</div></div>
                <div><div style="font-size:12px;color:var(--text-secondary);">Status</div><div style="font-weight:600;">${(r.status||'').toUpperCase()}</div></div>
                <div><div style="font-size:12px;color:var(--text-secondary);">Crop</div><div>${r.common_name || '-'} ${r.variety ? '(' + r.variety + ')' : ''}</div></div>
                <div><div style="font-size:12px;color:var(--text-secondary);">Harvest Weight</div><div>${weight}</div></div>
                <div><div style="font-size:12px;color:var(--text-secondary);">Seed Source</div><div>${r.seed_source || '-'}</div></div>
                <div><div style="font-size:12px;color:var(--text-secondary);">Seed Date</div><div>${r.seed_date ? new Date(r.seed_date).toLocaleDateString() : '-'}</div></div>
                <div><div style="font-size:12px;color:var(--text-secondary);">Zone / Room</div><div>${r.zone || '-'} / ${r.room || '-'}</div></div>
                <div><div style="font-size:12px;color:var(--text-secondary);">Grow Days</div><div>${r.grow_days ?? '-'}</div></div>
                <div><div style="font-size:12px;color:var(--text-secondary);">Producer</div><div>${r.producer_name || '-'}</div></div>
                <div><div style="font-size:12px;color:var(--text-secondary);">Retention Until</div><div>${r.retention_until ? new Date(r.retention_until).toLocaleDateString() : '-'}</div></div>
            </div>
            <h4 style="margin-bottom:8px;">Lifecycle Timeline (${events.length})</h4>
            ${timeline}
            <h4 style="margin:16px 0 8px;">Customers (One Step Forward)</h4>
            ${customers}
            <h4 style="margin:16px 0 8px;">QR Code</h4>
            <div id="traceQRCode" style="display:flex;justify-content:center;padding:16px;"></div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;padding-top:12px;border-top:1px solid var(--border);">
                <button onclick="exportSFCR('json')" style="padding:8px 14px;background:var(--accent-primary);color:white;border:none;border-radius:6px;cursor:pointer;">SFCR JSON</button>
                <button onclick="exportSFCR('csv')" style="padding:8px 14px;background:linear-gradient(135deg,#4CAF50,#45a049);color:white;border:none;border-radius:6px;cursor:pointer;">SFCR CSV</button>
            </div>`;
        document.getElementById('traceDetailModal').style.display = 'flex';

        // Render QR code from label-data endpoint
        try {
            const qrDiv = document.getElementById('traceQRCode');
            qrDiv.innerHTML = '';
            const labelRes = await fetch(`${TRACE_API}/api/traceability/label-data/${lotCode}`);
            const labelData = await labelRes.json();
            if ((labelData.ok || labelData.success) && labelData.label?.qr_payload) {
                new QRCode(qrDiv, { text: labelData.label.qr_payload, width: 160, height: 160 });
            } else {
                qrDiv.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">QR code not available</div>';
            }
        } catch (qrErr) {
            console.log('QR code not available:', qrErr.message);
            const qrDiv = document.getElementById('traceQRCode');
            if (qrDiv) qrDiv.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">QR code not available</div>';
        }
    } catch (err) {
        console.error('Failed to load trace detail:', err);
        alert('Failed to load trace details');
    }
}

function exportSFCR(format) {
    const url = `${TRACE_API}/api/traceability/sfcr-export?format=${format}`;
    window.open(url, '_blank');
}

// Initialize traceability + other sections when they become active
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-section="traceability"]').forEach(link => {
        link.addEventListener('click', () => { loadTraceRecords(); });
    });

    document.querySelectorAll('[data-section="inventory-mgmt"]').forEach(link => {
        link.addEventListener('click', () => {
            loadInventoryDashboard();
            loadSeeds();
        });
    });

    document.querySelectorAll('[data-section="sustainability"]').forEach(link => {
        link.addEventListener('click', () => { loadSustainabilityDashboard(); });
    });

    const searchInput = document.getElementById('traceabilitySearch');
    if (searchInput) {
        let t;
        searchInput.addEventListener('input', () => { clearTimeout(t); t = setTimeout(filterTraceRecords, 300); });
    }
});
