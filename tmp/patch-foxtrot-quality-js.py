#!/usr/bin/env python3
"""Patch Foxtrot public/farm-admin.js — replace quality control JS with new API-connected version."""
import re, sys

TARGET = '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot/public/farm-admin.js'

with open(TARGET, 'r') as f:
    content = f.read()

# Find the old quality block boundaries
# Start: "// Quality test data - loaded from API\nlet qualityTests = [];"
# End: right before "function showNotification"
old_start_marker = '// Quality test data - loaded from API\nlet qualityTests = [];'
old_end_marker = "function showNotification(message, type = 'info')"

start_idx = content.find(old_start_marker)
if start_idx == -1:
    # Try alternate marker
    old_start_marker = 'let qualityTests = [];'
    start_idx = content.find(old_start_marker)
    if start_idx == -1:
        print('ERROR: Could not find quality JS start marker')
        sys.exit(1)

end_idx = content.find(old_end_marker)
if end_idx == -1:
    print('ERROR: Could not find showNotification marker')
    sys.exit(1)

NEW_CODE = '''// Quality control data — loaded from API
let qualityCheckpoints = [];
let labReports = [];

async function loadQualityControl() {
    console.log('Loading Quality Control section...');

    // Fetch QA stats from proxy → Foxtrot
    try {
        const statsResp = await fetch(`${API_BASE}/api/quality/stats`, {
            headers: { 'Authorization': `Bearer ${currentSession.token}` }
        });
        if (statsResp.ok) {
            const statsData = await statsResp.json();
            const stats = statsData.stats || {};
            const passRateEl = document.getElementById('quality-pass-rate');
            if (passRateEl) passRateEl.textContent = stats.total_checkpoints > 0 ? `${stats.pass_rate}%` : '--';
            const totalEl = document.getElementById('tests-completed');
            if (totalEl) totalEl.textContent = stats.total_checkpoints || 0;
            const pendingEl = document.getElementById('pending-review');
            if (pendingEl) pendingEl.textContent = stats.pending_count || 0;
            const failedEl = document.getElementById('failed-tests');
            if (failedEl) failedEl.textContent = stats.fail_count || 0;
        }
    } catch (e) {
        console.warn('Quality stats API not available:', e.message);
    }

    // Fetch QA checkpoints from proxy → Foxtrot
    try {
        const cpResp = await fetch(`${API_BASE}/api/quality/checkpoints`, {
            headers: { 'Authorization': `Bearer ${currentSession.token}` }
        });
        if (cpResp.ok) {
            const cpData = await cpResp.json();
            qualityCheckpoints = (cpData.data && cpData.data.checkpoints) || [];
        }
    } catch (e) {
        console.warn('Quality checkpoints API not available:', e.message);
    }

    renderQualityCheckpoints();

    // Fetch lab reports from GRC
    try {
        const lrResp = await fetch(`${API_BASE}/api/quality/reports?farmId=${currentSession.farmId}`, {
            headers: { 'Authorization': `Bearer ${currentSession.token}` }
        });
        if (lrResp.ok) {
            const lrData = await lrResp.json();
            labReports = lrData.reports || [];
        }
    } catch (e) {
        console.warn('Lab reports API not available:', e.message);
    }

    renderLabReports();
}

// --- Tab switching ---
function switchQualityTab(tab) {
    const inspPanel = document.getElementById('qa-panel-inspections');
    const labPanel = document.getElementById('qa-panel-labreports');
    const inspTab = document.getElementById('qa-tab-inspections');
    const labTab = document.getElementById('qa-tab-labreports');

    if (tab === 'inspections') {
        if (inspPanel) inspPanel.style.display = '';
        if (labPanel) labPanel.style.display = 'none';
        if (inspTab) { inspTab.style.background = 'var(--accent-green)'; inspTab.style.color = 'white'; inspTab.style.borderColor = 'var(--accent-green)'; }
        if (labTab) { labTab.style.background = 'var(--bg-card)'; labTab.style.color = 'var(--text-secondary)'; labTab.style.borderColor = 'var(--border)'; }
    } else {
        if (inspPanel) inspPanel.style.display = 'none';
        if (labPanel) labPanel.style.display = '';
        if (labTab) { labTab.style.background = 'var(--accent-blue)'; labTab.style.color = 'white'; labTab.style.borderColor = 'var(--accent-blue)'; }
        if (inspTab) { inspTab.style.background = 'var(--bg-card)'; inspTab.style.color = 'var(--text-secondary)'; inspTab.style.borderColor = 'var(--border)'; }
    }
}

// --- QA Checkpoints rendering ---
function renderQualityCheckpoints(filtered) {
    const tbody = document.querySelector('#quality-tests-table tbody');
    if (!tbody) return;

    const items = filtered || qualityCheckpoints;

    if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted);">No QA inspections found. Inspections are recorded from the Activity Hub.</td></tr>';
        return;
    }

    const typeLabels = {
        pre_harvest: 'Pre-Harvest',
        post_harvest: 'Post-Harvest',
        packaging: 'Packaging',
        storage: 'Storage',
        visual: 'Visual',
        incoming: 'Incoming'
    };

    tbody.innerHTML = items.map(cp => {
        const d = new Date(cp.created_at);
        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

        let badge = '';
        if (cp.result === 'pass' || cp.result === 'pass_with_notes') {
            badge = '<span style="padding:4px 12px;background:var(--accent-green);color:white;border-radius:12px;font-size:12px;font-weight:500;">PASS</span>';
        } else if (cp.result === 'fail') {
            badge = '<span style="padding:4px 12px;background:var(--accent-red);color:white;border-radius:12px;font-size:12px;font-weight:500;">FAIL</span>';
        } else {
            badge = '<span style="padding:4px 12px;background:var(--accent-yellow);color:white;border-radius:12px;font-size:12px;font-weight:500;">PENDING</span>';
        }

        const typeLabel = typeLabels[cp.checkpoint_type] || cp.checkpoint_type || 'Unknown';
        const notes = cp.notes ? (cp.notes.length > 60 ? cp.notes.slice(0, 57) + '...' : cp.notes) : '\\u2014';

        return '<tr>' +
            '<td><span style="font-family:monospace;color:var(--accent-blue);">' + (cp.id || '\\u2014') + '</span></td>' +
            '<td><div>' + dateStr + '</div><small style="color:var(--text-muted);">' + timeStr + '</small></td>' +
            '<td><span style="font-family:monospace;">' + (cp.batch_id || '\\u2014') + '</span></td>' +
            '<td>' + typeLabel + '</td>' +
            '<td>' + (cp.inspector || 'Unknown') + '</td>' +
            '<td>' + badge + '</td>' +
            '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + notes + '</td>' +
        '</tr>';
    }).join('');
}

function filterQualityCheckpoints() {
    const typeFilter = document.getElementById('quality-type-filter')?.value || 'all';
    const resultFilter = document.getElementById('quality-result-filter')?.value || 'all';

    let filtered = qualityCheckpoints;
    if (typeFilter !== 'all') filtered = filtered.filter(c => c.checkpoint_type === typeFilter);
    if (resultFilter !== 'all') filtered = filtered.filter(c => c.result === resultFilter || (resultFilter === 'pass' && c.result === 'pass_with_notes'));

    renderQualityCheckpoints(filtered);
}

// --- Lab Reports rendering ---
function renderLabReports() {
    const tbody = document.getElementById('lab-reports-tbody');
    if (!tbody) return;

    if (!labReports.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted);">No lab reports recorded yet. Click "+ Record Lab Report" to add one.</td></tr>';
        return;
    }

    const typeLabels = {
        microbial: 'Microbial',
        gap_audit: 'GAP Audit',
        nutrient: 'Nutrient Analysis',
        pesticide: 'Pesticide Residue',
        water: 'Water Quality',
        other: 'Other'
    };

    tbody.innerHTML = labReports.map(r => {
        let badge = '';
        if (r.result === 'pass') {
            badge = '<span style="padding:4px 10px;background:var(--accent-green);color:white;border-radius:12px;font-size:12px;">PASS</span>';
        } else if (r.result === 'fail') {
            badge = '<span style="padding:4px 10px;background:var(--accent-red);color:white;border-radius:12px;font-size:12px;">FAIL</span>';
        } else {
            badge = '<span style="padding:4px 10px;background:var(--accent-yellow);color:white;border-radius:12px;font-size:12px;">PENDING</span>';
        }

        const notes = r.notes ? (r.notes.length > 50 ? r.notes.slice(0, 47) + '...' : r.notes) : '\\u2014';

        return '<tr>' +
            '<td><span style="font-family:monospace;color:var(--accent-blue);">' + r.id + '</span></td>' +
            '<td>' + (r.test_date || '\\u2014') + '</td>' +
            '<td>' + (typeLabels[r.report_type] || r.report_type) + '</td>' +
            '<td>' + (r.lab_name || '\\u2014') + '</td>' +
            '<td><span style="font-family:monospace;">' + (r.lot_code || '\\u2014') + '</span></td>' +
            '<td>' + badge + '</td>' +
            '<td>' + notes + '</td>' +
            '<td><button class="btn-icon" onclick="deleteLabReport(\\'' + r.id + '\\')" title="Delete"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></td>' +
        '</tr>';
    }).join('');
}

// --- Lab Report modal ---
function openLabReportModal() {
    const modal = document.getElementById('labReportModal');
    if (modal) {
        modal.style.display = 'flex';
        document.getElementById('lab-report-form')?.reset();
        const dateInput = document.getElementById('lr-test-date');
        if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    }
}

function closeLabReportModal() {
    const modal = document.getElementById('labReportModal');
    if (modal) modal.style.display = 'none';
}

async function submitLabReport(event) {
    event.preventDefault();

    const body = {
        report_type: document.getElementById('lr-report-type')?.value,
        test_date: document.getElementById('lr-test-date')?.value,
        lab_name: document.getElementById('lr-lab-name')?.value || '',
        lot_code: document.getElementById('lr-lot-code')?.value || '',
        result: document.getElementById('lr-result')?.value || 'pending',
        notes: document.getElementById('lr-notes')?.value || ''
    };

    try {
        const resp = await fetch(`${API_BASE}/api/quality/reports`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentSession.token}`,
                'X-Farm-ID': currentSession.farmId
            },
            body: JSON.stringify(body)
        });
        const data = await resp.json();
        if (data.ok && data.report) {
            labReports.unshift(data.report);
            renderLabReports();
            closeLabReportModal();
            showNotification('Lab report recorded successfully', 'success');
        } else {
            showNotification(data.error || 'Failed to save lab report', 'error');
        }
    } catch (e) {
        console.error('submitLabReport error:', e);
        showNotification('Network error saving lab report', 'error');
    }
}

async function deleteLabReport(id) {
    if (!confirm('Delete this lab report record?')) return;

    try {
        const resp = await fetch(`${API_BASE}/api/quality/reports/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${currentSession.token}`,
                'X-Farm-ID': currentSession.farmId
            }
        });
        const data = await resp.json();
        if (data.ok) {
            labReports = labReports.filter(r => r.id !== id);
            renderLabReports();
            showNotification('Lab report deleted', 'success');
        }
    } catch (e) {
        console.error('deleteLabReport error:', e);
    }
}

function exportQualityReport() {
    let csv = 'Source,ID,Date,Type,Inspector/Lab,Batch/Lot,Result,Notes\\n';

    qualityCheckpoints.forEach(cp => {
        csv += [
            'Inspection',
            cp.id || '',
            cp.created_at ? new Date(cp.created_at).toLocaleDateString() : '',
            cp.checkpoint_type || '',
            cp.inspector || '',
            cp.batch_id || '',
            cp.result || '',
            '"' + (cp.notes || '').replace(/"/g, '""') + '"'
        ].join(',') + '\\n';
    });

    labReports.forEach(r => {
        csv += [
            'Lab Report',
            r.id || '',
            r.test_date || '',
            r.report_type || '',
            r.lab_name || '',
            r.lot_code || '',
            r.result || '',
            '"' + (r.notes || '').replace(/"/g, '""') + '"'
        ].join(',') + '\\n';
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'quality-report-' + new Date().toISOString().split('T')[0] + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    showNotification('Quality report exported', 'success');
}

'''

content = content[:start_idx] + NEW_CODE + content[end_idx:]

with open(TARGET, 'w') as f:
    f.write(content)

print(f'OK — patched Foxtrot farm-admin.js quality JS ({len(NEW_CODE)} chars inserted)')
