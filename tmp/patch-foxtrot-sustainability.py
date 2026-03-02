#!/usr/bin/env python3
"""Patch Foxtrot public/LE-farm-admin.html — Sustainability section (HTML + JS)."""
import re, sys

FILE = '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot/public/LE-farm-admin.html'

with open(FILE, 'r', encoding='utf-8') as f:
    src = f.read()

# ── Patch 1: HTML section ──────────────────────────────────────────────────
# Old block runs from:  <!-- Sustainability & ESG Section -->
#   through the closing </div> just before  <!-- Traceability Section
OLD_HTML_START = '<!-- Sustainability & ESG Section -->'
OLD_HTML_END   = '<!-- Traceability Section'   # first occurrence AFTER section-sustainability

idx_start = src.index(OLD_HTML_START)
idx_end   = src.index(OLD_HTML_END, idx_start)

# Walk backward from idx_end to find the line that contains only </div> which closes section-sustainability
# We want to replace everything from idx_start up to (but not including) idx_end
# But we also need the blank line before the Traceability comment.
# Let's just replace everything from the line containing "<!-- Sustainability" to the line before "<!-- Traceability"
lines = src.split('\n')

# Find line numbers (0-based)
sust_line = None
trace_line = None
for i, line in enumerate(lines):
    if OLD_HTML_START in line and sust_line is None:
        sust_line = i
    if OLD_HTML_END in line and sust_line is not None and trace_line is None:
        trace_line = i

if sust_line is None or trace_line is None:
    print("ERROR: could not find sustainability HTML section markers", file=sys.stderr)
    sys.exit(1)

print(f"HTML section: lines {sust_line+1}–{trace_line} (0-based {sust_line}–{trace_line-1})")

NEW_HTML = r"""            <!-- Sustainability & ESG Section -->
            <div id="section-sustainability" class="content-section" style="display: none;">
                <div class="header">
                    <h1>Sustainability & ESG Dashboard</h1>
                    <div class="header-actions">
                        <button onclick="exportESGReport()" style="padding: 8px 16px; background: linear-gradient(135deg, #2196F3 0%, #1976d2 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">Export ESG Report</button>
                    </div>
                </div>

                <!-- Info Banner -->
                <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 1.2rem;">🌱</span>
                    <div style="flex: 1;">
                        <strong style="color: #10b981;">Data-Driven Sustainability</strong>
                        <span style="color: var(--text-secondary); font-size: 0.9rem;"> — Upload your utility bills to track energy, water, and carbon metrics. All values shown per kg harvested when harvest data is available.</span>
                    </div>
                </div>

                <!-- Summary Stats Cards -->
                <div class="stats-grid" style="margin-bottom: 24px;">
                    <div class="stat-card">
                        <div class="stat-value" id="sustEnergyKwh">--</div>
                        <div class="stat-label">Energy (kWh)</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value" id="sustWaterL">--</div>
                        <div class="stat-label">Water (L)</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value" id="sustCarbonKg">--</div>
                        <div class="stat-label">Carbon (kg CO₂)</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value" id="sustFoodMiles">--</div>
                        <div class="stat-label">Avg Food Miles</div>
                    </div>
                </div>

                <!-- Tab bar -->
                <div style="display: flex; gap: 0; margin-bottom: 20px; border-bottom: 2px solid var(--border);">
                    <button id="sust-tab-metrics" onclick="switchSustainabilityTab('metrics')" style="padding: 10px 20px; background: none; border: none; border-bottom: 2px solid var(--accent-blue); margin-bottom: -2px; color: var(--accent-blue); font-weight: 600; cursor: pointer;">Environmental Metrics</button>
                    <button id="sust-tab-bills" onclick="switchSustainabilityTab('bills')" style="padding: 10px 20px; background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -2px; color: var(--text-secondary); cursor: pointer;">Utility Bills</button>
                    <button id="sust-tab-foodmiles" onclick="switchSustainabilityTab('foodmiles')" style="padding: 10px 20px; background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -2px; color: var(--text-secondary); cursor: pointer;">Food Miles</button>
                </div>

                <!-- Tab 1: Environmental Metrics -->
                <div id="sust-panel-metrics">
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; margin-bottom: 24px;">
                        <!-- Energy Card -->
                        <div class="card">
                            <div class="card-header"><h3>Energy (30 days)</h3></div>
                            <div style="padding: 16px;">
                                <div style="font-size: 32px; font-weight: bold; margin-bottom: 4px;" id="totalEnergy">--</div>
                                <div style="color: var(--text-secondary); margin-bottom: 12px;">Total kWh</div>
                                <div style="display: flex; gap: 16px;">
                                    <div>
                                        <div style="font-size: 13px; color: var(--text-secondary);">Carbon</div>
                                        <div style="font-size: 18px; font-weight: bold;" id="energyCarbon">--</div>
                                    </div>
                                    <div>
                                        <div style="font-size: 13px; color: var(--text-secondary);">Cost</div>
                                        <div style="font-size: 18px; font-weight: bold;" id="energyCost">--</div>
                                    </div>
                                    <div>
                                        <div style="font-size: 13px; color: var(--text-secondary);">Per kg</div>
                                        <div style="font-size: 18px; font-weight: bold; color: #4caf50;" id="energyPerKg">--</div>
                                    </div>
                                </div>
                                <canvas id="energyChart" style="margin-top: 16px; max-height: 200px;"></canvas>
                            </div>
                        </div>

                        <!-- Water Card -->
                        <div class="card">
                            <div class="card-header"><h3>Water (30 days)</h3></div>
                            <div style="padding: 16px;">
                                <div style="font-size: 32px; font-weight: bold; margin-bottom: 4px;" id="totalWater">--</div>
                                <div style="color: var(--text-secondary); margin-bottom: 12px;">Total Liters</div>
                                <div style="display: flex; gap: 16px;">
                                    <div>
                                        <div style="font-size: 13px; color: var(--text-secondary);">Carbon</div>
                                        <div style="font-size: 18px; font-weight: bold;" id="waterCarbon">--</div>
                                    </div>
                                    <div>
                                        <div style="font-size: 13px; color: var(--text-secondary);">Cost</div>
                                        <div style="font-size: 18px; font-weight: bold;" id="waterCost">--</div>
                                    </div>
                                    <div>
                                        <div style="font-size: 13px; color: var(--text-secondary);">Per kg</div>
                                        <div style="font-size: 18px; font-weight: bold; color: #2196f3;" id="waterPerKg">--</div>
                                    </div>
                                </div>
                                <canvas id="waterChart" style="margin-top: 16px; max-height: 200px;"></canvas>
                            </div>
                        </div>

                        <!-- Carbon Card -->
                        <div class="card">
                            <div class="card-header"><h3>Carbon Footprint (30 days)</h3></div>
                            <div style="padding: 16px;">
                                <div style="font-size: 32px; font-weight: bold; margin-bottom: 4px;" id="totalCarbon">--</div>
                                <div style="color: var(--text-secondary); margin-bottom: 12px;">Total kg CO₂</div>
                                <div style="display: flex; gap: 16px;">
                                    <div>
                                        <div style="font-size: 13px; color: var(--text-secondary);">Daily Avg</div>
                                        <div style="font-size: 18px; font-weight: bold;" id="dailyCarbon">--</div>
                                    </div>
                                    <div>
                                        <div style="font-size: 13px; color: var(--text-secondary);">Annual Est</div>
                                        <div style="font-size: 18px; font-weight: bold;" id="annualCarbon">--</div>
                                    </div>
                                    <div>
                                        <div style="font-size: 13px; color: var(--text-secondary);">Per kg</div>
                                        <div style="font-size: 18px; font-weight: bold; color: #ff9800;" id="carbonPerKg">--</div>
                                    </div>
                                </div>
                                <canvas id="carbonChart" style="margin-top: 16px; max-height: 200px;"></canvas>
                            </div>
                        </div>

                        <!-- Per-kg Summary Card -->
                        <div class="card">
                            <div class="card-header"><h3>Production Efficiency</h3></div>
                            <div style="padding: 16px;">
                                <div id="perKgSummary" style="text-align: center; padding: 20px;">
                                    <div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 12px;">Metrics per kg harvested</div>
                                    <div id="perKgContent" style="color: var(--text-secondary);">Upload utility bills to see per-kg metrics</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Tab 2: Utility Bills -->
                <div id="sust-panel-bills" style="display: none;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <h3 style="margin: 0;">Utility Bills</h3>
                        <button onclick="openUtilityBillModal()" style="padding: 8px 16px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">+ Record Bill</button>
                    </div>
                    <div class="card">
                        <div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Type</th>
                                        <th>Period</th>
                                        <th>Usage</th>
                                        <th>Cost</th>
                                        <th>Carbon (kg CO₂)</th>
                                        <th>Recorded</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="utilityBillsList">
                                    <tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-secondary);">No utility bills recorded yet. Click "Record Bill" to add your first.</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <!-- Tab 3: Food Miles -->
                <div id="sust-panel-foodmiles" style="display: none;">
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px;">
                        <div class="card">
                            <div class="card-header"><h3>Your Food Miles</h3></div>
                            <div style="padding: 24px; text-align: center;">
                                <div style="font-size: 48px; font-weight: bold; color: #10b981;" id="foodMilesValue">--</div>
                                <div style="color: var(--text-secondary); margin-bottom: 16px;">Average miles to buyers</div>
                                <div style="font-size: 14px; color: var(--text-secondary);">Based on <span id="foodMilesBuyerCount">0</span> buyer locations</div>
                            </div>
                        </div>
                        <div class="card">
                            <div class="card-header"><h3>vs. Conventional Supply Chain</h3></div>
                            <div style="padding: 24px; text-align: center;">
                                <div style="font-size: 48px; font-weight: bold; color: var(--text-secondary);">1,500</div>
                                <div style="color: var(--text-secondary); margin-bottom: 16px;">Average conventional food miles (USDA)</div>
                                <div style="font-size: 20px; font-weight: bold; color: #10b981;" id="foodMilesReduction">--</div>
                                <div style="font-size: 14px; color: var(--text-secondary);">reduction vs conventional</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Utility Bill Modal -->
            <div id="utilityBillModal" class="modal" style="display: none;">
                <div class="modal-content" style="max-width: 550px;">
                    <div class="modal-header">
                        <h2>Record Utility Bill</h2>
                        <button onclick="closeUtilityBillModal()" class="modal-close">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div style="display: grid; gap: 16px;">
                            <div>
                                <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px;">Bill Type *</label>
                                <select id="billType" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text-primary);">
                                    <option value="electricity">Electricity</option>
                                    <option value="natural_gas">Natural Gas</option>
                                    <option value="propane">Propane</option>
                                    <option value="water">Water</option>
                                    <option value="other">Other</option>
                                </select>
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                                <div>
                                    <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px;">Period Start</label>
                                    <input type="date" id="billPeriodStart" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text-primary);">
                                </div>
                                <div>
                                    <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px;">Period End</label>
                                    <input type="date" id="billPeriodEnd" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text-primary);">
                                </div>
                            </div>
                            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 12px;">
                                <div>
                                    <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px;">Usage Amount *</label>
                                    <input type="number" id="billUsageAmount" step="0.01" min="0" placeholder="e.g. 450" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text-primary);">
                                </div>
                                <div>
                                    <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px;">Unit</label>
                                    <select id="billUsageUnit" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text-primary);">
                                        <option value="kWh">kWh</option>
                                        <option value="m³">m³</option>
                                        <option value="L">L</option>
                                        <option value="gal">gal</option>
                                    </select>
                                </div>
                            </div>
                            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 12px;">
                                <div>
                                    <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px;">Cost</label>
                                    <input type="number" id="billCost" step="0.01" min="0" placeholder="e.g. 85.50" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text-primary);">
                                </div>
                                <div>
                                    <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px;">Currency</label>
                                    <select id="billCurrency" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text-primary);">
                                        <option value="CAD">CAD</option>
                                        <option value="USD">USD</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px;">Notes</label>
                                <textarea id="billNotes" rows="2" placeholder="Optional notes..." style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text-primary); resize: vertical;"></textarea>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer" style="padding: 16px 24px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px;">
                        <button onclick="closeUtilityBillModal()" style="padding: 8px 16px; background: var(--bg-elevated); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px; cursor: pointer;">Cancel</button>
                        <button onclick="submitUtilityBill()" style="padding: 8px 16px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">Save Bill</button>
                    </div>
                </div>
            </div>
"""

# ── Patch 2: Inline JS ────────────────────────────────────────────────────
# Old JS block starts with "// SUSTAINABILITY DASHBOARD FUNCTIONS"
# and goes through the exportESGReport closing brace + "    </script>"
# followed by "<!-- Chart.js for sustainability charts -->"

NEW_JS = r"""        // ===================================================================
        // SUSTAINABILITY DASHBOARD FUNCTIONS
        // ===================================================================
        
        const SUSTAINABILITY_API = (window.API_BASE || window.location.origin) + '/api/sustainability';
        let energyChart, waterChart, carbonChart;
        let utilityBills = [];
        let sustainabilityMetrics = null;

        async function loadSustainabilityDashboard() {
            try {
                const [metricsRes, billsRes, foodRes, trendsRes] = await Promise.all([
                    fetch(`${SUSTAINABILITY_API}/metrics?days=30`),
                    fetch(`${SUSTAINABILITY_API}/utility-bills`),
                    fetch(`${SUSTAINABILITY_API}/food-miles`),
                    fetch(`${SUSTAINABILITY_API}/trends?days=30`)
                ]);
                
                const metrics = await metricsRes.json();
                const billsData = await billsRes.json();
                const food = await foodRes.json();
                const trends = await trendsRes.json();
                
                if (metrics.ok) {
                    sustainabilityMetrics = metrics;
                    displaySustMetrics(metrics);
                }
                if (billsData.ok) {
                    utilityBills = billsData.bills || [];
                    renderUtilityBills();
                }
                if (food.ok) displayFoodMiles(food);
                if (trends.ok) createSustainabilityCharts(trends.trends);
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
                const res = await fetch(`${SUSTAINABILITY_API}/utility-bills`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bill)
                });
                const data = await res.json();
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
                const res = await fetch(`${SUSTAINABILITY_API}/utility-bills/${id}`, { method: 'DELETE' });
                const data = await res.json();
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
                    fetch(`${SUSTAINABILITY_API}/metrics?days=30`),
                    fetch(`${SUSTAINABILITY_API}/utility-bills`),
                    fetch(`${SUSTAINABILITY_API}/food-miles`)
                ]);
                const metrics = await metricsRes.json();
                const billsData = await billsRes.json();
                const food = await foodRes.json();

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
    </script>"""

# ── Apply patches ──────────────────────────────────────────────────────────

# First, JS patch (search from the end so line numbers don't shift for HTML patch)
JS_MARKER_START = '// SUSTAINABILITY DASHBOARD FUNCTIONS'
JS_MARKER_END   = '    </script>\n\n    <!-- Chart.js for sustainability charts -->'

# Find the JS block
js_start_idx = src.index(JS_MARKER_START)
# Walk backward to include the leading "        // ==="
line_prefix = src.rfind('\n', 0, js_start_idx) + 1
js_end_idx = src.index(JS_MARKER_END, js_start_idx) + len('    </script>')

old_js = src[line_prefix:js_end_idx]
print(f"JS block: chars {line_prefix}–{js_end_idx} ({old_js.count(chr(10))+1} lines)")

# Check old JS has expected content
assert 'esg-report' in old_js or 'metrics?days' in old_js, "JS block content mismatch"

src = src[:line_prefix] + NEW_JS + src[js_end_idx:]
print("JS patch applied")

# Now HTML patch (on the already-JS-patched string)
lines = src.split('\n')
sust_line = None
trace_line = None
for i, line in enumerate(lines):
    if OLD_HTML_START in line and sust_line is None:
        sust_line = i
    if OLD_HTML_END in line and sust_line is not None and trace_line is None:
        trace_line = i

if sust_line is None or trace_line is None:
    print("ERROR: could not find sustainability HTML markers after JS patch", file=sys.stderr)
    sys.exit(1)

# Replace lines sust_line .. trace_line-1 (inclusive)
# Keep a blank line before trace_line
new_lines = lines[:sust_line] + NEW_HTML.rstrip('\n').split('\n') + [''] + lines[trace_line:]

src = '\n'.join(new_lines)
print(f"HTML patch applied (replaced lines {sust_line+1}–{trace_line})")

with open(FILE, 'w', encoding='utf-8') as f:
    f.write(src)

# Verify
with open(FILE, 'r', encoding='utf-8') as f:
    final = f.read()

checks = [
    ('sust-tab-metrics', 'sust-tab-metrics' in final),
    ('utilityBillModal', 'utilityBillModal' in final),
    ('switchSustainabilityTab', 'switchSustainabilityTab' in final),
    ('deleteUtilityBill', 'deleteUtilityBill' in final),
    ('sustFoodMiles', 'sustFoodMiles' in final),
    ('NO wasteScore', 'wasteScore' not in final),
    ('NO diversionRate', 'diversionRate' not in final),
    ('NO landfillWaste', 'landfillWaste' not in final),
    ('NO esg-report fetch', 'fetch(`${SUSTAINABILITY_API}/esg-report`)' not in final),
]

all_ok = True
for label, ok in checks:
    status = 'OK' if ok else 'FAIL'
    if not ok:
        all_ok = False
    print(f"  {status}: {label}")

if all_ok:
    print(f"\nDone — {FILE} patched successfully ({final.count(chr(10))+1} lines)")
else:
    print("\nWARNING: some checks failed!", file=sys.stderr)
    sys.exit(1)
