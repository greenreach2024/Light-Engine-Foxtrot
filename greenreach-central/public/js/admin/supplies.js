// Farm Supplies & Operations (seeds, packaging, nutrients, equipment, maintenance).
// Extracted from public/LE-farm-admin.html. Mirrored to greenreach-central.
// Globals: INVENTORY_API, showSuppliesTab(), loadInventoryDashboard(), loadSeeds(),
// loadPackaging(), loadNutrients(), loadEquipment(), loadSupplies(), plus modal helpers.
// ===================================================================
// FARM SUPPLIES & OPERATIONS FUNCTIONS
// ===================================================================

const INVENTORY_API = `${window.location.origin}/api/inventory`;

function showSuppliesTab(tab) {
    // Update tab buttons
    document.querySelectorAll('.supplies-tab').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`suppliesTab-${tab}`).classList.add('active');
    
    // Update tab content
    document.querySelectorAll('.supplies-tab-content').forEach(content => content.style.display = 'none');
    document.getElementById(`suppliesContent-${tab}`).style.display = 'block';
    
    // Load data for active tab
    switch(tab) {
        case 'planting': loadSeeds(); break;
        case 'nutrients': loadNutrients(); break;
        case 'packaging': loadPackaging(); break;
        case 'equipment': loadEquipment(); break;
        case 'lab': loadSupplies(); break;
    }
}

async function loadInventoryDashboard() {
    try {
        const [dashboardRes, alertsRes] = await Promise.all([
            fetch(`${INVENTORY_API}/dashboard`),
            fetch(`${INVENTORY_API}/reorder-alerts`)
        ]);
        
        const dashboard = await dashboardRes.json();
        const alerts = await alertsRes.json();
        
        if (dashboard.ok) {
            document.getElementById('totalInventoryValue').textContent = 
                `$${dashboard.total_value.toLocaleString()}`;
            
            // Show crop inventory count
            const cropCountEl = document.getElementById('cropInventoryCount');
            if (cropCountEl) cropCountEl.textContent = dashboard.crop_inventory_count || 0;
            
            // Count alerts by severity
            let critical = 0, warning = 0;
            Object.values(dashboard.alerts_by_category).forEach(items => {
                items.forEach(item => {
                    if (item.alert_level === 'critical') critical++;
                    else if (item.alert_level === 'warning') warning++;
                });
            });
            
            document.getElementById('criticalAlerts').textContent = critical;
            document.getElementById('warningAlerts').textContent = warning;
            
            // Count equipment needing maintenance
            const maintenanceDue = Object.values(dashboard.alerts_by_category.equipment || [])
                .filter(eq => eq.status === 'maintenance_due' || eq.status === 'maintenance_overdue').length;
            document.getElementById('maintenanceDue').textContent = maintenanceDue;
        }
        
        if (alerts.ok) {
            displayReorderAlerts(alerts.alerts);
        }
    } catch (error) {
        console.error('Error loading inventory dashboard:', error);
    }
}

async function loadSeeds() {
    try {
        // Load both seed inventory and usage data
        const [seedsRes, usageRes] = await Promise.all([
            fetch(`${INVENTORY_API}/seeds/list`),
            fetch(`${INVENTORY_API}/usage/weekly-summary?days=7`)
        ]);
        
        const data = await seedsRes.json();
        const usage = await usageRes.json();
        
        if (!data.ok) {
            document.getElementById('seedsList').innerHTML = 
                '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-secondary);">Error loading seeds</td></tr>';
            return;
        }
        
        const tbody = document.getElementById('seedsList');
        if (data.seeds.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-secondary);">No seeds in inventory</td></tr>';
            return;
        }
        
        // Create usage lookup
        const seedsUsedThisWeek = usage.ok ? usage.summary.seeds_used : {};
        
        tbody.innerHTML = data.seeds.map(seed => {
            const usedThisWeek = seedsUsedThisWeek[seed.variety] || 0;
            const mediaUsed = usage.ok ? Math.round(usage.summary.grow_media_kg * 10) / 10 : 0;
            
            return `
                <tr>
                    <td>${seed.variety}</td>
                    <td>${seed.quantity_grams}g</td>
                    <td style="color: var(--accent-orange);">${usedThisWeek > 0 ? usedThisWeek + ' seeds' : '-'}</td>
                    <td style="color: var(--accent-blue);">${mediaUsed > 0 ? mediaUsed + ' kg' : '-'}</td>
                    <td>${new Date(seed.expiration_date).toLocaleDateString()}</td>
                    <td>${getAlertBadge(seed.alert_level, seed.days_until_expiration)}</td>
                    <td>
                        <button onclick="editSeed('${seed.seed_id}')" style="padding:4px 8px;background:var(--accent-blue);color:white;border:none;border-radius:4px;cursor:pointer;">Edit</button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading seeds:', error);
    }
}

async function loadPackaging() {
    try {
        const response = await fetch(`${INVENTORY_API}/packaging/list`);
        const data = await response.json();
        
        if (!data.ok) {
            document.getElementById('packagingList').innerHTML = 
                '<tr><td colspan=\"6\" style=\"text-align:center;padding:40px;color:var(--text-secondary);\">Error loading packaging</td></tr>';
            return;
        }
        
        const tbody = document.getElementById('packagingList');
        tbody.innerHTML = data.packaging.map(pkg => `
            <tr>
                <td>${pkg.name} (${pkg.type})</td>
                <td>${pkg.quantity} ${pkg.unit}</td>
                <td>${pkg.reorder_point}</td>
                <td>${getAlertBadge(pkg.alert_level, pkg.quantity)}</td>
                <td>$${pkg.cost_per_unit.toFixed(2)}</td>
                <td>
                    <button onclick="restockPackaging('${pkg.packaging_id}')" style="padding:4px 8px;background:var(--accent-green);color:white;border:none;border-radius:4px;cursor:pointer;">Restock</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading packaging:', error);
    }
}

async function loadNutrients() {
    try {
        // Load both nutrient inventory and usage data
        const [nutrientsRes, usageRes] = await Promise.all([
            fetch(`${INVENTORY_API}/nutrients/list`),
            fetch(`${INVENTORY_API}/usage/weekly-summary?days=7`)
        ]);
        
        const data = await nutrientsRes.json();
        const usage = await usageRes.json();
        
        if (!data.ok) {
            document.getElementById('nutrientsList').innerHTML = 
                '<tr><td colspan=\"8\" style=\"text-align:center;padding:40px;color:var(--text-secondary);\">Error loading nutrients</td></tr>';
            return;
        }
        
        const tbody = document.getElementById('nutrientsList');
        
        // Create usage lookup by nutrient type
        const nutrientsUsedThisWeek = usage.ok ? usage.summary.nutrients_used_ml : {};
        
        tbody.innerHTML = data.nutrients.map(nut => {
            const percent = (nut.volume_remaining_ml / nut.volume_ml * 100).toFixed(1);
            const usedThisWeek = nutrientsUsedThisWeek[nut.type] || 0;
            
            // Calculate days until empty based on weekly usage
            let daysUntilEmpty = '-';
            if (usedThisWeek > 0) {
                const dailyUsage = usedThisWeek / 7;
                const daysLeft = Math.round(nut.volume_remaining_ml / dailyUsage);
                daysUntilEmpty = daysLeft + ' days';
            }
            
            return `
            <tr>
                <td>${nut.name} (${nut.type})</td>
                <td>${nut.volume_remaining_ml}ml</td>
                <td style="color: var(--accent-orange);">${usedThisWeek > 0 ? usedThisWeek + ' ml' : '-'}</td>
                <td style="color: var(--text-secondary);">${daysUntilEmpty}</td>
                <td>
                    <div style="width:100px;height:20px;background:var(--bg-elevated);border-radius:4px;overflow:hidden;">
                        <div style="width:${percent}%;height:100%;background:linear-gradient(90deg,#4caf50,#45a049);"></div>
                    </div>
                    ${percent}%
                </td>
                <td>${nut.concentration}</td>
                <td>${new Date(nut.expiration_date).toLocaleDateString()}</td>
                <td>
                    <button onclick="showRecordNutrientUsage('${nut.nutrient_id}')" style="padding:4px 8px;background:var(--accent-blue);color:white;border:none;border-radius:4px;cursor:pointer;">Record</button>
                </td>
            </tr>
        `}).join('');
    } catch (error) {
        console.error('Error loading nutrients:', error);
    }
}

async function loadEquipment() {
    try {
        const response = await fetch(`${INVENTORY_API}/equipment/list`);
        const data = await response.json();
        
        if (!data.ok) {
            document.getElementById('equipmentList').innerHTML = 
                '<tr><td colspan=\"7\" style=\"text-align:center;padding:40px;color:var(--text-secondary);\">Error loading equipment</td></tr>';
            return;
        }
        
        const tbody = document.getElementById('equipmentList');
        tbody.innerHTML = data.equipment.map(eq => `
            <tr>
                <td>${eq.name}</td>
                <td>${eq.category}</td>
                <td>${getStatusBadge(eq.status)}</td>
                <td>${new Date(eq.last_maintenance).toLocaleDateString()}</td>
                <td>${new Date(eq.next_maintenance).toLocaleDateString()}</td>
                <td>${eq.days_until_maintenance > 0 ? eq.days_until_maintenance : 'OVERDUE'}</td>
                <td>
                    <button onclick="showLogMaintenance('${eq.equipment_id}')" style="padding:4px 8px;background:var(--accent-yellow);color:white;border:none;border-radius:4px;cursor:pointer;">Log</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading equipment:', error);
    }
}

async function loadSupplies() {
    try {
        const response = await fetch(`${INVENTORY_API}/supplies/list`);
        const data = await response.json();
        
        if (!data.ok) {
            document.getElementById('suppliesList').innerHTML = 
                '<tr><td colspan=\"7\" style=\"text-align:center;padding:40px;color:var(--text-secondary);\">Error loading supplies</td></tr>';
            return;
        }
        
        const tbody = document.getElementById('suppliesList');
        tbody.innerHTML = data.supplies.map(sup => `
            <tr>
                <td>${sup.name}</td>
                <td>${sup.quantity}</td>
                <td>${sup.unit}</td>
                <td>${sup.reorder_threshold}</td>
                <td>${getAlertBadge(sup.alert_level, sup.quantity)}</td>
                <td>${sup.last_used ? new Date(sup.last_used).toLocaleDateString() : 'Never'}</td>
                <td>
                    <button onclick="showRecordSupplyUsage('${sup.supply_id}')" style=\"padding:4px 8px;background:var(--accent-purple);color:white;border:none;border-radius:4px;cursor:pointer;\">Use</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading supplies:', error);
    }
}

function displayReorderAlerts(alerts) {
    const container = document.getElementById('reorderAlertsList');
    if (alerts.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary);text-align:center;">No reorder alerts</p>';
        return;
    }
    
    container.innerHTML = alerts.map(alert => `
        <div style="padding:12px;margin-bottom:8px;background:var(--bg-secondary);border-left:4px solid ${
            alert.alert_level === 'critical' ? '#ef4444' : 
            alert.alert_level === 'warning' ? '#f59e0b' : '#3b82f6'
        };border-radius:4px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <strong>${alert.item_name}</strong> - ${alert.category}
                    <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">${alert.message}</div>
                </div>
                <span class="alert-${alert.alert_level}">${alert.alert_level.toUpperCase()}</span>
            </div>
        </div>
    `).join('');
}

function getAlertBadge(level, value) {
    const badges = {
        'critical': `<span class="alert-badge alert-critical">CRITICAL ${value >= 0 ? '(' + value + ')' : ''}</span>`,
        'warning': `<span class="alert-badge alert-warning">WARNING ${value >= 0 ? '(' + value + ')' : ''}</span>`,
        'low': `<span class="alert-badge alert-low">LOW</span>`,
        'normal': `<span class="alert-badge alert-normal">OK</span>`
    };
    return badges[level] || badges.normal;
}

function getStatusBadge(status) {
    const badges = {
        'operational': '<span class="alert-badge alert-normal">Operational</span>',
        'maintenance_due': '<span class="alert-badge alert-warning">Due Soon</span>',
        'maintenance_overdue': '<span class="alert-badge alert-critical">OVERDUE</span>',
        'out_of_service': '<span class="alert-badge alert-critical">Out of Service</span>'
    };
    return badges[status] || status;
}

// ===================================================================
// INVENTORY MANAGEMENT MODAL FUNCTIONS
// ===================================================================

// Add Seed Modal Functions
function showAddSeedModal() {
    document.getElementById('addSeedModal').style.display = 'flex';
    document.getElementById('addSeedForm').reset();
    // Set today's date + 2 years as default expiration
    const defaultExpiration = new Date();
    defaultExpiration.setFullYear(defaultExpiration.getFullYear() + 2);
    document.getElementById('seedExpiration').valueAsDate = defaultExpiration;
}

function closeAddSeedModal() {
    document.getElementById('addSeedModal').style.display = 'none';
}

async function submitAddSeed(event) {
    event.preventDefault();
    const formData = {
        variety: document.getElementById('seedName').value,
        quantity: parseInt(document.getElementById('seedQuantity').value),
        grow_media_kg: parseFloat(document.getElementById('seedGrowerMedia').value),
        supplier: document.getElementById('seedSupplier').value,
        expiration: document.getElementById('seedExpiration').value,
        notes: document.getElementById('seedNotes').value,
        added_date: new Date().toISOString().split('T')[0]
    };

    try {
        const response = await fetch('/api/inventory/seeds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        if (response.ok) {
            showNotification('Seed added successfully', 'success');
            closeAddSeedModal();
            loadInventoryDashboard(); // Refresh inventory data
        } else {
            const error = await response.json();
            showNotification('Failed to add seed: ' + (error.message || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error adding seed:', error);
        showNotification('Failed to add seed: ' + error.message, 'error');
    }
}

// Edit Seed Modal Functions
async function editSeed(id) {
    try {
        const response = await fetch(`/api/inventory/seeds/${id}`);
        if (!response.ok) throw new Error('Failed to fetch seed details');
        
        const seed = await response.json();
        document.getElementById('editSeedId').value = seed.seed_id;
        document.getElementById('editSeedName').value = seed.variety;
        document.getElementById('editSeedQuantity').value = seed.quantity;
        document.getElementById('editSeedGrowerMedia').value = seed.grow_media_kg || 0;
        document.getElementById('editSeedExpiration').value = seed.expiration || '';
        
        document.getElementById('editSeedModal').style.display = 'flex';
    } catch (error) {
        console.error('Error loading seed:', error);
        showNotification('Failed to load seed details', 'error');
    }
}

function closeEditSeedModal() {
    document.getElementById('editSeedModal').style.display = 'none';
}

async function submitEditSeed(event) {
    event.preventDefault();
    const id = document.getElementById('editSeedId').value;
    const formData = {
        variety: document.getElementById('editSeedName').value,
        quantity: parseInt(document.getElementById('editSeedQuantity').value),
        grow_media_kg: parseFloat(document.getElementById('editSeedGrowerMedia').value),
        expiration: document.getElementById('editSeedExpiration').value
    };

    try {
        const response = await fetch(`/api/inventory/seeds/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        if (response.ok) {
            showNotification('Seed updated successfully', 'success');
            closeEditSeedModal();
            loadInventoryDashboard(); // Refresh inventory data
        } else {
            const error = await response.json();
            showNotification('Failed to update seed: ' + (error.message || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error updating seed:', error);
        showNotification('Failed to update seed: ' + error.message, 'error');
    }
}

// Add Packaging Modal Functions
function showAddPackagingModal() {
    document.getElementById('addPackagingModal').style.display = 'flex';
    document.getElementById('addPackagingForm').reset();
}

function closeAddPackagingModal() {
    document.getElementById('addPackagingModal').style.display = 'none';
}

async function submitAddPackaging(event) {
    event.preventDefault();
    const formData = {
        type: document.getElementById('packagingType').value,
        stock_level: parseInt(document.getElementById('packagingStock').value),
        reorder_point: parseInt(document.getElementById('packagingReorderPoint').value),
        cost_per_unit: parseFloat(document.getElementById('packagingCost').value) || 0,
        supplier: document.getElementById('packagingSupplier').value,
        added_date: new Date().toISOString().split('T')[0]
    };

    try {
        const response = await fetch('/api/inventory/packaging', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        if (response.ok) {
            showNotification('Packaging added successfully', 'success');
            closeAddPackagingModal();
            loadInventoryDashboard(); // Refresh inventory data
        } else {
            const error = await response.json();
            showNotification('Failed to add packaging: ' + (error.message || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error adding packaging:', error);
        showNotification('Failed to add packaging: ' + error.message, 'error');
    }
}

// Restock Packaging Modal Functions
async function restockPackaging(id) {
    try {
        const response = await fetch(`/api/inventory/packaging/${id}`);
        if (!response.ok) throw new Error('Failed to fetch packaging details');
        
        const pkg = await response.json();
        document.getElementById('restockPackagingId').value = pkg.packaging_id;
        document.getElementById('restockPackagingName').value = pkg.type;
        document.getElementById('restockPackagingCurrent').value = pkg.stock_level;
        document.getElementById('restockQuantity').value = '';
        document.getElementById('restockNotes').value = '';
        
        document.getElementById('restockPackagingModal').style.display = 'flex';
    } catch (error) {
        console.error('Error loading packaging:', error);
        showNotification('Failed to load packaging details', 'error');
    }
}

function closeRestockPackagingModal() {
    document.getElementById('restockPackagingModal').style.display = 'none';
}

async function submitRestockPackaging(event) {
    event.preventDefault();
    const id = document.getElementById('restockPackagingId').value;
    const addQuantity = parseInt(document.getElementById('restockQuantity').value);
    const notes = document.getElementById('restockNotes').value;

    try {
        const response = await fetch(`/api/inventory/packaging/${id}/restock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ add_quantity: addQuantity, notes: notes, date: new Date().toISOString().split('T')[0] })
        });

        if (response.ok) {
            showNotification('Packaging restocked successfully', 'success');
            closeRestockPackagingModal();
            loadInventoryDashboard(); // Refresh inventory data
        } else {
            const error = await response.json();
            showNotification('Failed to restock packaging: ' + (error.message || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error restocking packaging:', error);
        showNotification('Failed to restock packaging: ' + error.message, 'error');
    }
}

// Record Nutrient Usage Modal Functions
async function showRecordNutrientUsage(id) {
    try {
        const response = await fetch(`/api/inventory/nutrients/${id}`);
        if (!response.ok) throw new Error('Failed to fetch nutrient details');
        
        const nutrient = await response.json();
        document.getElementById('nutrientId').value = nutrient.nutrient_id;
        document.getElementById('nutrientName').value = nutrient.type;
        document.getElementById('nutrientVolumeUsed').value = '';
        document.getElementById('nutrientUsageDate').valueAsDate = new Date();
        document.getElementById('nutrientAppliedTo').value = '';
        
        document.getElementById('recordNutrientModal').style.display = 'flex';
    } catch (error) {
        console.error('Error loading nutrient:', error);
        showNotification('Failed to load nutrient details', 'error');
    }
}

function recordNutrientUsage() {
    // Show modal with generic form (no pre-selected nutrient)
    document.getElementById('nutrientId').value = '';
    document.getElementById('nutrientName').value = 'All Nutrients';
    document.getElementById('nutrientVolumeUsed').value = '';
    document.getElementById('nutrientUsageDate').valueAsDate = new Date();
    document.getElementById('nutrientAppliedTo').value = '';
    document.getElementById('recordNutrientModal').style.display = 'flex';
}

function closeRecordNutrientModal() {
    document.getElementById('recordNutrientModal').style.display = 'none';
}

async function submitNutrientUsage(event) {
    event.preventDefault();
    const id = document.getElementById('nutrientId').value;
    const formData = {
        volume_used: parseFloat(document.getElementById('nutrientVolumeUsed').value),
        date: document.getElementById('nutrientUsageDate').value,
        applied_to: document.getElementById('nutrientAppliedTo').value
    };

    try {
        const url = id ? `/api/inventory/nutrients/${id}/usage` : '/api/inventory/nutrients/usage';
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        if (response.ok) {
            showNotification('Nutrient usage recorded successfully', 'success');
            closeRecordNutrientModal();
            loadInventoryDashboard(); // Refresh inventory data
        } else {
            const error = await response.json();
            showNotification('Failed to record usage: ' + (error.message || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error recording nutrient usage:', error);
        showNotification('Failed to record usage: ' + error.message, 'error');
    }
}

// Log Maintenance Modal Functions
async function showLogMaintenance(id) {
    try {
        const response = await fetch(`/api/inventory/equipment/${id}`);
        if (!response.ok) throw new Error('Failed to fetch equipment details');
        
        const equipment = await response.json();
        document.getElementById('maintenanceEquipmentId').value = equipment.equipment_id;
        document.getElementById('maintenanceEquipmentName').value = equipment.name;
        document.getElementById('maintenanceType').value = '';
        document.getElementById('maintenanceDate').valueAsDate = new Date();
        document.getElementById('maintenancePerformedBy').value = '';
        document.getElementById('maintenanceDescription').value = '';
        document.getElementById('maintenanceCost').value = '';
        
        document.getElementById('logMaintenanceModal').style.display = 'flex';
    } catch (error) {
        console.error('Error loading equipment:', error);
        showNotification('Failed to load equipment details', 'error');
    }
}

function logMaintenance() {
    // Show modal with generic form (no pre-selected equipment)
    document.getElementById('maintenanceEquipmentId').value = '';
    document.getElementById('maintenanceEquipmentName').value = 'All Equipment';
    document.getElementById('maintenanceType').value = '';
    document.getElementById('maintenanceDate').valueAsDate = new Date();
    document.getElementById('maintenancePerformedBy').value = '';
    document.getElementById('maintenanceDescription').value = '';
    document.getElementById('maintenanceCost').value = '';
    document.getElementById('logMaintenanceModal').style.display = 'flex';
}

function closeLogMaintenanceModal() {
    document.getElementById('logMaintenanceModal').style.display = 'none';
}

async function submitLogMaintenance(event) {
    event.preventDefault();
    const id = document.getElementById('maintenanceEquipmentId').value;
    const formData = {
        maintenance_type: document.getElementById('maintenanceType').value,
        date_performed: document.getElementById('maintenanceDate').value,
        performed_by: document.getElementById('maintenancePerformedBy').value,
        description: document.getElementById('maintenanceDescription').value,
        cost: parseFloat(document.getElementById('maintenanceCost').value) || 0
    };

    try {
        const url = id ? `/api/inventory/equipment/${id}/maintenance` : '/api/inventory/equipment/maintenance';
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        if (response.ok) {
            showNotification('Maintenance logged successfully', 'success');
            closeLogMaintenanceModal();
            loadInventoryDashboard(); // Refresh inventory data
        } else {
            const error = await response.json();
            showNotification('Failed to log maintenance: ' + (error.message || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error logging maintenance:', error);
        showNotification('Failed to log maintenance: ' + error.message, 'error');
    }
}

// Record Supply Usage Modal Functions
async function showRecordSupplyUsage(id) {
    try {
        const response = await fetch(`/api/inventory/supplies/${id}`);
        if (!response.ok) throw new Error('Failed to fetch supply details');
        
        const supply = await response.json();
        document.getElementById('supplyId').value = supply.supply_id;
        document.getElementById('supplyName').value = supply.name;
        document.getElementById('supplyUnit').value = supply.unit;
        document.getElementById('supplyQuantityUsed').value = '';
        document.getElementById('supplyUsageDate').valueAsDate = new Date();
        document.getElementById('supplyPurpose').value = '';
        
        document.getElementById('recordSupplyModal').style.display = 'flex';
    } catch (error) {
        console.error('Error loading supply:', error);
        showNotification('Failed to load supply details', 'error');
    }
}

function recordSupplyUsage() {
    // Show modal with generic form (no pre-selected supply)
    document.getElementById('supplyId').value = '';
    document.getElementById('supplyName').value = 'All Supplies';
    document.getElementById('supplyUnit').value = 'units';
    document.getElementById('supplyQuantityUsed').value = '';
    document.getElementById('supplyUsageDate').valueAsDate = new Date();
    document.getElementById('supplyPurpose').value = '';
    document.getElementById('recordSupplyModal').style.display = 'flex';
}

function closeRecordSupplyModal() {
    document.getElementById('recordSupplyModal').style.display = 'none';
}

async function submitSupplyUsage(event) {
    event.preventDefault();
    const id = document.getElementById('supplyId').value;
    const formData = {
        quantity_used: parseFloat(document.getElementById('supplyQuantityUsed').value),
        date: document.getElementById('supplyUsageDate').value,
        purpose: document.getElementById('supplyPurpose').value
    };

    try {
        const url = id ? `/api/inventory/supplies/${id}/usage` : '/api/inventory/supplies/usage';
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        if (response.ok) {
            showNotification('Supply usage recorded successfully', 'success');
            closeRecordSupplyModal();
            loadInventoryDashboard(); // Refresh inventory data
        } else {
            const error = await response.json();
            showNotification('Failed to record usage: ' + (error.message || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error recording supply usage:', error);
        showNotification('Failed to record usage: ' + error.message, 'error');
    }
}

// Helper function for notifications
function showNotification(message, type = 'info') {
    if (typeof window.leToast === 'function') {
        window.leToast(message, type);
    } else {
        console.warn('[Toast] le-toast.js not loaded, message:', message);
    }
}

