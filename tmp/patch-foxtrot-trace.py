#!/usr/bin/env python3
"""Patch public/LE-farm-admin.html with traceability fixes (Page 4)."""
import os, sys

filepath = '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot/public/LE-farm-admin.html'
with open(filepath, 'r') as f:
    content = f.read()

changes = 0

# 1. Fix loadTraceRecords — ok vs success, stats field names, date range params
old1 = """        async function loadTraceRecords() {
            try {
                const [listRes, statsRes] = await Promise.all([
                    fetch(`${TRACE_API}/api/traceability`),
                    fetch(`${TRACE_API}/api/traceability/stats`)
                ]);
                const listData = await listRes.json();
                const statsData = await statsRes.json();

                if (statsData.ok) {
                    document.getElementById('totalTraceRecords').textContent = statsData.stats.total_records ?? 0;
                    document.getElementById('activeTraceRecords').textContent = statsData.stats.active_records ?? 0;
                    document.getElementById('traceCrops').textContent = statsData.stats.crops_tracked ?? 0;
                    document.getElementById('traceEvents').textContent = statsData.stats.total_events ?? 0;
                }

                if (listData.ok) {
                    _traceRecordsCache = listData.records || [];
                    renderTraceRecords(_traceRecordsCache);
                }
            } catch (err) {
                console.error('Failed to load trace records:', err);
                document.getElementById('traceRecordsList').innerHTML =
                    '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-secondary);">Error loading records</td></tr>';
            }
        }"""

new1 = """        async function loadTraceRecords() {
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
        }"""

if old1 in content:
    content = content.replace(old1, new1, 1)
    changes += 1
    print('1. loadTraceRecords: REPLACED')
else:
    print('1. loadTraceRecords: NOT FOUND')

# 2. Fix weight field in renderTraceRecords
old2 = """                const weight = r.harvest_weight_g ? (r.harvest_weight_g >= 1000 ? (r.harvest_weight_g / 1000).toFixed(2) + ' kg' : r.harvest_weight_g + ' g') : '-';
                const customers = (r.customers || []).map(c => c.name).join(', ') || '-';
                return `
                    <tr style="cursor:pointer;" onclick="viewTraceDetail('${r.lot_code}')">"""

new2 = """                const rawWeight = r.actual_weight ?? r.harvest_weight_g;
                const weightUnit = r.weight_unit || (r.harvest_weight_g ? 'g' : '');
                const weight = rawWeight ? `${rawWeight} ${weightUnit}` : '-';
                const customers = (r.customers || []).map(c => c.name).join(', ') || '-';
                return `
                    <tr style="cursor:pointer;" onclick="viewTraceDetail('${r.lot_code}')">"""

if old2 in content:
    content = content.replace(old2, new2, 1)
    changes += 1
    print('2. renderTraceRecords weight: REPLACED')
else:
    print('2. renderTraceRecords weight: NOT FOUND')

# 3. Fix viewTraceDetail — ok/success + weight
old3 = """                const data = await res.json();
                if (!data.ok) { alert('Record not found'); return; }
                const r = data.record;
                const events = data.events || [];

                const weight = r.harvest_weight_g ? (r.harvest_weight_g >= 1000 ? (r.harvest_weight_g / 1000).toFixed(2) + ' kg' : r.harvest_weight_g + ' g') : '-';"""

new3 = """                const data = await res.json();
                if (!data.ok && !data.success) { alert('Record not found'); return; }
                const r = data.record;
                const events = data.events || [];

                const rawWeight = r.actual_weight ?? r.harvest_weight_g;
                const weightUnit = r.weight_unit || (r.harvest_weight_g ? 'g' : '');
                const weight = rawWeight ? `${rawWeight} ${weightUnit}` : '-';"""

if old3 in content:
    content = content.replace(old3, new3, 1)
    changes += 1
    print('3. viewTraceDetail ok+weight: REPLACED')
else:
    print('3. viewTraceDetail ok+weight: NOT FOUND')

# 4. Add QR code display to detail modal
old4 = """                    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;padding-top:12px;border-top:1px solid var(--border);">
                        <button onclick="exportSFCR('json')" style="padding:8px 14px;background:var(--accent-primary);color:white;border:none;border-radius:6px;cursor:pointer;">SFCR JSON</button>
                        <button onclick="exportSFCR('csv')" style="padding:8px 14px;background:linear-gradient(135deg,#4CAF50,#45a049);color:white;border:none;border-radius:6px;cursor:pointer;">SFCR CSV</button>
                    </div>`;
                document.getElementById('traceDetailModal').style.display = 'flex';"""

new4 = """                    <h4 style="margin:16px 0 8px;">QR Code</h4>
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
                }"""

if old4 in content:
    content = content.replace(old4, new4, 1)
    changes += 1
    print('4. QR code in detail: REPLACED')
else:
    print('4. QR code in detail: NOT FOUND')

# 5. Add date range filter inputs to header
old5 = """                        <select id="traceStatusFilter" onchange="filterTraceRecords()" style="padding: 8px 12px; border-radius: 6px; background: var(--bg-card); border: 1px solid var(--border); color: var(--text-primary);">
                            <option value="">All Status</option>
                            <option value="harvested">Harvested</option>
                            <option value="packed">Packed</option>
                            <option value="shipped">Shipped</option>
                            <option value="delivered">Delivered</option>
                        </select>
                        <button onclick="exportSFCR('csv')\""""

new5 = """                        <select id="traceStatusFilter" onchange="filterTraceRecords()" style="padding: 8px 12px; border-radius: 6px; background: var(--bg-card); border: 1px solid var(--border); color: var(--text-primary);">
                            <option value="">All Status</option>
                            <option value="harvested">Harvested</option>
                            <option value="packed">Packed</option>
                            <option value="shipped">Shipped</option>
                            <option value="delivered">Delivered</option>
                        </select>
                        <input type="date" id="traceFromDate" onchange="loadTraceRecords()" title="From date" style="padding: 8px 10px; border-radius: 6px; background: var(--bg-card); border: 1px solid var(--border); color: var(--text-primary);">
                        <input type="date" id="traceToDate" onchange="loadTraceRecords()" title="To date" style="padding: 8px 10px; border-radius: 6px; background: var(--bg-card); border: 1px solid var(--border); color: var(--text-primary);">
                        <button onclick="exportSFCR('csv')\""""

if old5 in content:
    content = content.replace(old5, new5, 1)
    changes += 1
    print('5. Date range filter: REPLACED')
else:
    print('5. Date range filter: NOT FOUND')

if changes > 0:
    with open(filepath, 'w') as f:
        f.write(content)
    print(f'\nDone: {changes}/5 changes applied')
else:
    print('\nERROR: No changes applied')
    sys.exit(1)
