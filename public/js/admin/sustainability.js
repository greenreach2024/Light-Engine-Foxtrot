// Sustainability Dashboard (ESG reporting, utility bills, food miles, charts).
// Extracted from public/LE-farm-admin.html. Mirrored to greenreach-central.
// Globals: loadSustainabilityDashboard(), openUtilityBillModal(), exportESGReport(), etc.
// ===================================================================
// ===================================================================
// SUSTAINABILITY DASHBOARD FUNCTIONS
// ===================================================================

const SUSTAINABILITY_API = (window.API_BASE || window.location.origin) + '/api/sustainability';
let energyChart, waterChart, carbonChart;
let utilityBills = [];
let sustainabilityMetrics = null;

function fetchWithFarmAuth(url, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    const token = sessionStorage.getItem('token') || localStorage.getItem('token');
    const farmId =
        sessionStorage.getItem('farm_id') ||
        sessionStorage.getItem('farmId') ||
        localStorage.getItem('farm_id') ||
        localStorage.getItem('farmId');

    if (token && !headers['Authorization']) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    if (farmId && !headers['x-farm-id']) {
        headers['x-farm-id'] = farmId;
    }

    return fetch(url, Object.assign({}, opts, { headers }));
}

async function safeJson(response) {
    try {
        return await response.json();
    } catch (_) {
        return { ok: false, error: `HTTP ${response.status}` };
    }
}

async function loadSustainabilityDashboard() {
    try {
        const [metricsRes, billsRes, foodRes, trendsRes] = await Promise.all([
            fetchWithFarmAuth(`${SUSTAINABILITY_API}/metrics?days=30`),
            fetchWithFarmAuth(`${SUSTAINABILITY_API}/utility-bills`),
            fetchWithFarmAuth(`${SUSTAINABILITY_API}/food-miles`),
            fetchWithFarmAuth(`${SUSTAINABILITY_API}/trends?days=30`)
        ]);
        
        const metrics = await safeJson(metricsRes);
        const billsData = await safeJson(billsRes);
        const food = await safeJson(foodRes);
        const trends = await safeJson(trendsRes);
        
        if (metrics.ok) {
            sustainabilityMetrics = metrics;
            displaySustMetrics(metrics);
        } else {
            console.warn('[Sustainability] Metrics unavailable:', metricsRes.status, metrics.error || 'Unknown error');
        }
        if (billsData.ok) {
            utilityBills = billsData.bills || [];
            renderUtilityBills();
        } else {
            console.warn('[Sustainability] Utility bills unavailable:', billsRes.status, billsData.error || 'Unknown error');
        }
        if (food.ok) displayFoodMiles(food);
        else console.warn('[Sustainability] Food miles unavailable:', foodRes.status, food.error || 'Unknown error');
        if (trends.ok) createSustainabilityCharts(trends.trends);
        else console.warn('[Sustainability] Trends unavailable:', trendsRes.status, trends.error || 'Unknown error');
    } catch (error) {
        console.error('Error loading sustainability dashboard:', error);
    }
}

function displaySustMetrics(m) {
    // Stats cards
    document.getElementById('sustEnergyKwh').textContent = m.energy.total_kwh ? m.energy.total_kwh.toLocaleString() : '0';
    document.getElementById('sustWaterL').textContent = m.water.total_liters ? m.water.total_liters.toLocaleString() : '0';
    document.getElementById('sustCarbonKg').textContent = m.carbon.total_kg ? m.carbon.total_kg.toFixed(1) : '0';
    
    // Energy card
    document.getElementById('totalEnergy').textContent = m.energy.total_kwh ? `${m.energy.total_kwh.toLocaleString()}` : '0';
    document.getElementById('energyCarbon').textContent = `${(m.energy.carbon_kg || 0).toFixed(1)} kg`;
    document.getElementById('energyCost').textContent = `$${(m.energy.total_cost || 0).toFixed(2)}`;
    document.getElementById('energyPerKg').textContent = m.per_kg_harvested ? `${m.per_kg_harvested.energy_kwh.toFixed(2)}` : 'N/A';
    
    // Water card
    document.getElementById('totalWater').textContent = m.water.total_liters ? `${m.water.total_liters.toLocaleString()}` : '0';
    document.getElementById('waterCarbon').textContent = `${(m.water.carbon_kg || 0).toFixed(3)} kg`;
    document.getElementById('waterCost').textContent = `$${(m.water.total_cost || 0).toFixed(2)}`;
    document.getElementById('waterPerKg').textContent = m.per_kg_harvested ? `${m.per_kg_harvested.water_l.toFixed(1)}` : 'N/A';
    
    // Carbon card
    document.getElementById('totalCarbon').textContent = m.carbon.total_kg ? `${m.carbon.total_kg.toFixed(1)}` : '0';
    document.getElementById('dailyCarbon').textContent = `${(m.carbon.daily_average_kg || 0).toFixed(2)} kg/day`;
    document.getElementById('annualCarbon').textContent = `${((m.carbon.daily_average_kg || 0) * 365).toFixed(0)} kg/yr`;
    document.getElementById('carbonPerKg').textContent = m.per_kg_harvested ? `${m.per_kg_harvested.carbon_kg.toFixed(3)}` : 'N/A';
    
    // Per-kg summary card
    const perKgEl = document.getElementById('perKgContent');
    if (m.per_kg_harvested) {
        perKgEl.innerHTML = `
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; text-align: center;">
                <div>
                    <div style="font-size: 24px; font-weight: bold; color: #4caf50;">${m.per_kg_harvested.energy_kwh.toFixed(2)}</div>
                    <div style="font-size: 12px; color: var(--text-secondary);">kWh / kg</div>
                </div>
                <div>
                    <div style="font-size: 24px; font-weight: bold; color: #2196f3;">${m.per_kg_harvested.water_l.toFixed(1)}</div>
                    <div style="font-size: 12px; color: var(--text-secondary);">L / kg</div>
                </div>
                <div>
                    <div style="font-size: 24px; font-weight: bold; color: #ff9800;">${m.per_kg_harvested.carbon_kg.toFixed(3)}</div>
                    <div style="font-size: 12px; color: var(--text-secondary);">kg CO₂ / kg</div>
                </div>
            </div>
            <div style="margin-top: 12px; font-size: 13px; color: var(--text-secondary);">Based on ${m.per_kg_harvested.harvest_kg.toFixed(1)} kg harvested</div>`;
    } else {
        perKgEl.textContent = 'No harvest data available for per-kg calculations';
    }
}

function displayFoodMiles(data) {
    document.getElementById('sustFoodMiles').textContent = data.avg_food_miles ? data.avg_food_miles.toFixed(0) : '--';
    document.getElementById('foodMilesValue').textContent = data.avg_food_miles ? data.avg_food_miles.toFixed(1) : '--';
    document.getElementById('foodMilesBuyerCount').textContent = data.buyer_count || 0;
    document.getElementById('foodMilesReduction').textContent = data.reduction_percent ? `${data.reduction_percent}% less` : '--';
}

function switchSustainabilityTab(tab) {
    ['metrics', 'bills', 'foodmiles'].forEach(t => {
        const panel = document.getElementById(`sust-panel-${t}`);
        const btn = document.getElementById(`sust-tab-${t}`);
        if (panel) panel.style.display = t === tab ? '' : 'none';
        if (btn) {
            btn.style.borderBottomColor = t === tab ? 'var(--accent-blue)' : 'transparent';
            btn.style.color = t === tab ? 'var(--accent-blue)' : 'var(--text-secondary)';
            btn.style.fontWeight = t === tab ? '600' : '400';
        }
    });
}

// Carbon emission factors for bill display
const CARBON_FACTORS = { electricity: 0.42, natural_gas: 1.89, propane: 1.51, water: 0.000298 };

function renderUtilityBills() {
    const tbody = document.getElementById('utilityBillsList');
    if (!tbody) return;
    if (!utilityBills.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-secondary);">No utility bills recorded yet. Click "Record Bill" to add your first.</td></tr>';
        return;
    }
    tbody.innerHTML = utilityBills.map(b => {
        const carbonKg = (b.usage_amount || 0) * (CARBON_FACTORS[b.bill_type] || 0);
        const period = b.billing_period_start && b.billing_period_end
            ? `${new Date(b.billing_period_start).toLocaleDateString()} – ${new Date(b.billing_period_end).toLocaleDateString()}`
            : '—';
        const typeLabel = { electricity: 'Electricity', natural_gas: 'Natural Gas', propane: 'Propane', water: 'Water', other: 'Other' }[b.bill_type] || b.bill_type;
        return `<tr>
            <td><span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; background: rgba(33,150,243,0.1); color: #2196f3;">${typeLabel}</span></td>
            <td>${period}</td>
            <td>${b.usage_amount?.toLocaleString() || 0} ${b.usage_unit || ''}</td>
            <td>${b.cost != null ? `$${b.cost.toFixed(2)} ${b.currency || ''}` : '—'}</td>
            <td>${carbonKg.toFixed(2)}</td>
            <td>${new Date(b.created_at).toLocaleDateString()}</td>
            <td><button onclick="deleteUtilityBill('${b.id}')" style="padding: 4px 8px; background: rgba(239,68,68,0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.2); border-radius: 4px; cursor: pointer; font-size: 12px;">Delete</button></td>
        </tr>`;
    }).join('');
}

function openUtilityBillModal() {
    document.getElementById('utilityBillModal').style.display = 'flex';
    // Reset form
    document.getElementById('billType').value = 'electricity';
    document.getElementById('billPeriodStart').value = '';
    document.getElementById('billPeriodEnd').value = '';
    document.getElementById('billUsageAmount').value = '';
    document.getElementById('billUsageUnit').value = 'kWh';
    document.getElementById('billCost').value = '';
    document.getElementById('billCurrency').value = 'CAD';
    document.getElementById('billNotes').value = '';
}

function closeUtilityBillModal() {
    document.getElementById('utilityBillModal').style.display = 'none';
}

async function submitUtilityBill() {
    const bill = {
        bill_type: document.getElementById('billType').value,
        billing_period_start: document.getElementById('billPeriodStart').value || null,
        billing_period_end: document.getElementById('billPeriodEnd').value || null,
        usage_amount: parseFloat(document.getElementById('billUsageAmount').value),
        usage_unit: document.getElementById('billUsageUnit').value,
        cost: document.getElementById('billCost').value ? parseFloat(document.getElementById('billCost').value) : null,
        currency: document.getElementById('billCurrency').value,
        notes: document.getElementById('billNotes').value
    };
    if (!bill.bill_type || isNaN(bill.usage_amount)) {
        alert('Bill type and usage amount are required.');
        return;
    }
    try {
        const res = await fetchWithFarmAuth(`${SUSTAINABILITY_API}/utility-bills`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bill)
        });
        const data = await safeJson(res);
        if (data.ok) {
            closeUtilityBillModal();
            loadSustainabilityDashboard();
            if (typeof showNotification === 'function') showNotification('Utility bill saved', 'success');
        } else {
            alert(data.error || 'Failed to save bill');
        }
    } catch (e) {
        console.error('Submit bill error:', e);
        alert('Error saving bill');
    }
}

async function deleteUtilityBill(id) {
    if (!confirm('Delete this utility bill?')) return;
    try {
        const res = await fetchWithFarmAuth(`${SUSTAINABILITY_API}/utility-bills/${id}`, { method: 'DELETE' });
        const data = await safeJson(res);
        if (data.ok) {
            loadSustainabilityDashboard();
            if (typeof showNotification === 'function') showNotification('Bill deleted', 'success');
        }
    } catch (e) {
        console.error('Delete bill error:', e);
    }
}

function createSustainabilityCharts(trends) {
    const labels = trends.map(t => new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    const chartOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } };
    
    const energyCtx = document.getElementById('energyChart');
    if (energyChart) energyChart.destroy();
    energyChart = new Chart(energyCtx, {
        type: 'line',
        data: { labels, datasets: [{ label: 'Energy (kWh)', data: trends.map(t => t.energy_kwh), borderColor: '#4caf50', backgroundColor: 'rgba(76,175,80,0.1)', tension: 0.4 }] },
        options: chartOpts
    });
    
    const waterCtx = document.getElementById('waterChart');
    if (waterChart) waterChart.destroy();
    waterChart = new Chart(waterCtx, {
        type: 'line',
        data: { labels, datasets: [{ label: 'Water (L)', data: trends.map(t => t.water_liters), borderColor: '#2196f3', backgroundColor: 'rgba(33,150,243,0.1)', tension: 0.4 }] },
        options: chartOpts
    });
    
    const carbonCtx = document.getElementById('carbonChart');
    if (carbonChart) carbonChart.destroy();
    carbonChart = new Chart(carbonCtx, {
        type: 'line',
        data: { labels, datasets: [{ label: 'Carbon (kg)', data: trends.map(t => t.carbon_kg), borderColor: '#ff9800', backgroundColor: 'rgba(255,152,0,0.1)', tension: 0.4 }] },
        options: chartOpts
    });
}

async function exportESGReport() {
    try {
        const [metricsRes, billsRes, foodRes] = await Promise.all([
            fetchWithFarmAuth(`${SUSTAINABILITY_API}/metrics?days=30`),
            fetchWithFarmAuth(`${SUSTAINABILITY_API}/utility-bills`),
            fetchWithFarmAuth(`${SUSTAINABILITY_API}/food-miles`)
        ]);
        const metrics = await safeJson(metricsRes);
        const billsData = await safeJson(billsRes);
        const food = await safeJson(foodRes);

        // Build CSV
        const rows = [['Sustainability & ESG Report', new Date().toISOString().split('T')[0]]];
        rows.push([]);
        rows.push(['ENVIRONMENTAL METRICS (30 days)']);
        rows.push(['Metric', 'Value', 'Unit', 'Per kg Harvested']);
        if (metrics.ok) {
            const pk = metrics.per_kg_harvested;
            rows.push(['Energy', metrics.energy.total_kwh, 'kWh', pk ? pk.energy_kwh.toFixed(2) : 'N/A']);
            rows.push(['Water', metrics.water.total_liters, 'L', pk ? pk.water_l.toFixed(1) : 'N/A']);
            rows.push(['Carbon', metrics.carbon.total_kg.toFixed(2), 'kg CO₂', pk ? pk.carbon_kg.toFixed(3) : 'N/A']);
            rows.push(['Energy Cost', metrics.energy.total_cost.toFixed(2), metrics.currency || 'CAD', '']);
            rows.push(['Water Cost', metrics.water.total_cost.toFixed(2), metrics.currency || 'CAD', '']);
        }
        rows.push([]);
        rows.push(['FOOD MILES']);
        if (food.ok) {
            rows.push(['Average Food Miles', food.avg_food_miles?.toFixed(1) || 0, 'miles', '']);
            rows.push(['Conventional Average', 1500, 'miles', '']);
            rows.push(['Reduction', food.reduction_percent || 'N/A', '%', '']);
        }
        rows.push([]);
        rows.push(['UTILITY BILLS']);
        rows.push(['Type', 'Period', 'Usage', 'Unit', 'Cost', 'Currency', 'Date']);
        if (billsData.ok) {
            for (const b of (billsData.bills || [])) {
                rows.push([b.bill_type, `${b.billing_period_start || ''} to ${b.billing_period_end || ''}`, b.usage_amount, b.usage_unit, b.cost || '', b.currency || '', b.created_at?.split('T')[0] || '']);
            }
        }

        const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `esg-report-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Error exporting ESG report:', error);
        alert('Error exporting ESG report');
    }
}
