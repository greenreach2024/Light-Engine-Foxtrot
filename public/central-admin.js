/**
 * GreenReach Central Operations
 * Enterprise-grade farm management and monitoring system
 */

// Use window.location.origin for admin API (port 8091)
const API_BASE = window.location.origin;
let currentFarmId = null;
let farmsData = [];
let roomsData = [];
let devicesData = [];
let inventoryData = [];
let recipesData = [];

// Navigation context state
let navigationContext = {
    level: 'platform', // platform | farm | room | zone | group
    orgId: null,
    farmId: null,
    roomId: null,
    zoneId: null,
    groupId: null,
    deviceId: null
};

// Initialize application
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Initializing Central Operations...');
    
    // Parse URL parameters to restore navigation context
    parseNavigationFromURL();
    
    // Load data based on context
    await loadContextualView();
    
    // Auto-refresh every 30 seconds
    setInterval(refreshData, 30000);
    
    // Handle browser back/forward
    window.addEventListener('popstate', () => {
        parseNavigationFromURL();
        loadContextualView();
    });
});

/**
 * Parse URL query parameters to determine navigation context
 */
function parseNavigationFromURL() {
    const params = new URLSearchParams(window.location.search);
    
    const view = params.get('view') || 'platform';
    const farmId = params.get('farmId');
    const roomId = params.get('roomId');
    const zoneId = params.get('zoneId');
    const groupId = params.get('groupId');
    const deviceId = params.get('deviceId');
    
    // Determine navigation level based on deepest parameter
    if (groupId) {
        navigationContext = { level: 'group', farmId, roomId, zoneId, groupId, deviceId };
    } else if (zoneId) {
        navigationContext = { level: 'zone', farmId, roomId, zoneId, groupId: null, deviceId: null };
    } else if (roomId) {
        navigationContext = { level: 'room', farmId, roomId, zoneId: null, groupId: null, deviceId: null };
    } else if (farmId) {
        navigationContext = { level: 'farm', farmId, roomId: null, zoneId: null, groupId: null, deviceId: null };
    } else {
        navigationContext = { level: 'platform', farmId: null, roomId: null, zoneId: null, groupId: null, deviceId: null };
    }
    
    console.log('Navigation context:', navigationContext);
}

/**
 * Update URL with current navigation context
 */
function updateURLWithContext(pushState = true) {
    const params = new URLSearchParams();
    
    if (navigationContext.farmId) params.set('farmId', navigationContext.farmId);
    if (navigationContext.roomId) params.set('roomId', navigationContext.roomId);
    if (navigationContext.zoneId) params.set('zoneId', navigationContext.zoneId);
    if (navigationContext.groupId) params.set('groupId', navigationContext.groupId);
    if (navigationContext.deviceId) params.set('deviceId', navigationContext.deviceId);
    
    const url = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
    
    if (pushState) {
        history.pushState(navigationContext, '', url);
    } else {
        history.replaceState(navigationContext, '', url);
    }
}

/**
 * Load view based on current navigation context
 */
async function loadContextualView() {
    // Update breadcrumb
    updateBreadcrumb();
    
    // Update sidebar based on context
    renderContextualSidebar();
    
    // Load appropriate view
    switch (navigationContext.level) {
        case 'platform':
            await loadDashboardData();
            showView('overview-view');
            break;
        case 'farm':
            await viewFarmDetail(navigationContext.farmId);
            break;
        case 'room':
            await viewRoomDetail(navigationContext.farmId, navigationContext.roomId);
            break;
        case 'zone':
            await viewZoneDetail(navigationContext.farmId, navigationContext.roomId, navigationContext.zoneId);
            break;
        case 'group':
            await viewGroupDetail(navigationContext.farmId, navigationContext.roomId, navigationContext.zoneId, navigationContext.groupId);
            break;
    }
}

/**
 * Update breadcrumb navigation based on context
 */
function updateBreadcrumb() {
    const breadcrumb = document.getElementById('breadcrumb-content');
    const parts = ['<a href="?" style="color: #63b3ed; cursor: pointer;">Platform</a>'];
    
    if (navigationContext.farmId) {
        const farmName = getFarmName(navigationContext.farmId) || navigationContext.farmId;
        if (navigationContext.level === 'farm') {
            parts.push(`<strong>${farmName}</strong>`);
        } else {
            parts.push(`<a href="?farmId=${navigationContext.farmId}" style="color: #63b3ed; cursor: pointer;">${farmName}</a>`);
        }
    }
    
    if (navigationContext.roomId) {
        const roomName = getRoomName(navigationContext.roomId) || navigationContext.roomId;
        if (navigationContext.level === 'room') {
            parts.push(`<strong>${roomName}</strong>`);
        } else {
            parts.push(`<a href="?farmId=${navigationContext.farmId}&roomId=${navigationContext.roomId}" style="color: #63b3ed; cursor: pointer;">${roomName}</a>`);
        }
    }
    
    if (navigationContext.zoneId) {
        const zoneName = getZoneName(navigationContext.zoneId) || navigationContext.zoneId;
        if (navigationContext.level === 'zone') {
            parts.push(`<strong>${zoneName}</strong>`);
        } else {
            parts.push(`<a href="?farmId=${navigationContext.farmId}&roomId=${navigationContext.roomId}&zoneId=${navigationContext.zoneId}" style="color: #63b3ed; cursor: pointer;">${zoneName}</a>`);
        }
    }
    
    if (navigationContext.groupId) {
        const groupName = getGroupName(navigationContext.groupId) || navigationContext.groupId;
        parts.push(`<strong>${groupName}</strong>`);
    }
    
    breadcrumb.innerHTML = parts.join(' <span style="color: #4a5568;">></span> ');
}

/**
 * Render context-aware sidebar navigation
 */
function renderContextualSidebar() {
    const nav = document.getElementById('sidebar-nav');
    let sections = [];
    
    switch (navigationContext.level) {
        case 'platform':
            sections = [
                {
                    title: 'Overview',
                    items: [
                        { label: 'Dashboard', view: 'overview', active: true },
                        { label: 'Anomalies', view: 'anomalies' },
                        { label: 'Alerts', view: 'alerts' }
                    ]
                },
                {
                    title: 'Wholesale',
                    items: [
                        { label: 'Admin Dashboard', view: 'wholesale-admin', external: '/GR-admin.html' },
                        { label: 'Buyer Portal', view: 'wholesale-buyer', external: '/GR-wholesale.html' }
                    ]
                },
                {
                    title: 'Analytics',
                    items: [
                        { label: 'AI Insights', view: 'analytics' },
                        { label: 'Energy', view: 'energy' },
                        { label: 'Harvest Forecast', view: 'harvest' }
                    ]
                },
                {
                    title: 'Management',
                    items: [
                        { label: 'All Farms', view: 'farms' },
                        { label: 'Users', view: 'users' }
                    ]
                }
            ];
            break;
            
        case 'farm':
            sections = [
                {
                    title: 'Farm Overview',
                    items: [
                        { label: 'Summary', view: 'farm-overview', active: true },
                        { label: 'Rooms', view: 'farm-rooms' },
                        { label: 'Devices', view: 'farm-devices' }
                    ]
                },
                {
                    title: 'Operations',
                    items: [
                        { label: 'Inventory', view: 'farm-inventory' },
                        { label: 'Recipes', view: 'farm-recipes' },
                        { label: 'Environmental', view: 'farm-environmental' }
                    ]
                },
                {
                    title: 'Performance',
                    items: [
                        { label: 'Energy', view: 'farm-energy' },
                        { label: 'Alerts', view: 'farm-alerts' }
                    ]
                }
            ];
            break;
            
        case 'room':
            sections = [
                {
                    title: 'Room Overview',
                    items: [
                        { label: 'Summary', view: 'room-overview', active: true },
                        { label: 'Zones', view: 'room-zones' },
                        { label: 'Devices', view: 'room-devices' }
                    ]
                },
                {
                    title: 'Environmental',
                    items: [
                        { label: 'Conditions', view: 'room-environmental' },
                        { label: 'Sensors', view: 'room-sensors' }
                    ]
                }
            ];
            break;
            
        case 'zone':
            sections = [
                {
                    title: 'Zone Overview',
                    items: [
                        { label: 'Summary', view: 'zone-overview', active: true },
                        { label: 'Groups', view: 'zone-groups' },
                        { label: 'Devices', view: 'zone-devices' }
                    ]
                },
                {
                    title: 'Environmental',
                    items: [
                        { label: 'Conditions', view: 'zone-environmental' },
                        { label: 'Sensors', view: 'zone-sensors' }
                    ]
                }
            ];
            break;
            
        case 'group':
            sections = [
                {
                    title: 'Group Overview',
                    items: [
                        { label: 'Summary', view: 'group-overview', active: true },
                        { label: 'Devices', view: 'group-devices' },
                        { label: 'Trays', view: 'group-trays' }
                    ]
                },
                {
                    title: 'Configuration',
                    items: [
                        { label: 'Recipe', view: 'group-recipe' },
                        { label: 'Spectrum', view: 'group-spectrum' },
                        { label: 'Schedule', view: 'group-schedule' }
                    ]
                }
            ];
            break;
    }
    
    nav.innerHTML = sections.map(section => `
        <div class="nav-section">
            <div class="nav-section-title">${section.title}</div>
            ${section.items.map(item => {
                if (item.external) {
                    return `
                        <a href="${item.external}" class="nav-item" style="text-decoration: none; color: inherit; display: block;">
                            <span>${item.label}</span>
                        </a>
                    `;
                } else {
                    return `
                        <div class="nav-item ${item.active ? 'active' : ''}" onclick="navigate('${item.view}', this)">
                            <span>${item.label}</span>
                        </div>
                    `;
                }
            }).join('')}
        </div>
    `).join('');
}

/**
 * Helper functions to get names from IDs
 */
function getFarmName(farmId) {
    const farm = farmsData.find(f => f.farmId === farmId);
    return farm ? farm.name : farmId.replace('GR-', 'Farm ');
}

function getRoomName(roomId) {
    const room = roomsData.find(r => r.roomId === roomId);
    return room ? room.name : null;
}

function getZoneName(zoneId) {
    // TODO: Fetch from zones data
    return `Zone ${zoneId.split('-').pop()}`;
}

function getGroupName(groupId) {
    // TODO: Fetch from groups data
    return groupId.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Navigation functions for each level
 */
async function drillToFarm(farmId) {
    navigationContext = { level: 'farm', farmId, roomId: null, zoneId: null, groupId: null };
    updateURLWithContext();
    await loadContextualView();
}

function drillToRoom(farmId, roomId) {
    navigationContext = { level: 'room', farmId, roomId, zoneId: null, groupId: null };
    updateURLWithContext();
    loadContextualView();
}

function drillToZone(farmId, roomId, zoneId) {
    navigationContext = { level: 'zone', farmId, roomId, zoneId, groupId: null };
    updateURLWithContext();
    loadContextualView();
}

function drillToGroup(farmId, roomId, zoneId, groupId) {
    navigationContext = { level: 'group', farmId, roomId, zoneId, groupId };
    updateURLWithContext();
    loadContextualView();
}

/**
 * Trace anomaly to source equipment
 * Automatically navigates from alert to the specific farm/room/zone/group/device
 */
async function traceAnomaly(anomalyId, context) {
    console.log(`Tracing anomaly ${anomalyId} to source...`);
    
    // If context is provided directly (from inline data), use it
    // Otherwise, fetch from API
    let anomalyContext = context;
    
    if (!anomalyContext) {
        try {
            const response = await fetch(`${API_BASE}/api/admin/anomalies/${anomalyId}/context`);
            if (response.ok) {
                anomalyContext = await response.json();
            } else {
                console.error('Failed to fetch anomaly context');
                showToast('Unable to trace anomaly - context not found', 'error');
                return;
            }
        } catch (error) {
            console.error('Error fetching anomaly context:', error);
            showToast('Error tracing anomaly', 'error');
            return;
        }
    }
    
    // Navigate to the deepest available level in the context
    if (anomalyContext.groupId) {
        drillToGroup(anomalyContext.farmId, anomalyContext.roomId, anomalyContext.zoneId, anomalyContext.groupId);
    } else if (anomalyContext.zoneId) {
        drillToZone(anomalyContext.farmId, anomalyContext.roomId, anomalyContext.zoneId);
    } else if (anomalyContext.roomId) {
        drillToRoom(anomalyContext.farmId, anomalyContext.roomId);
    } else if (anomalyContext.farmId) {
        drillToFarm(anomalyContext.farmId);
    } else {
        showToast('Anomaly has no location context', 'warning');
        return;
    }
    
    // If a specific device is identified, highlight it after a short delay
    if (anomalyContext.deviceId) {
        setTimeout(() => {
            highlightDevice(anomalyContext.deviceId);
        }, 500);
    }
    
    showToast(`Navigated to anomaly source: ${anomalyContext.farmId}`, 'success');
}

/**
 * Highlight a specific device in the current view
 */
function highlightDevice(deviceId) {
    // Find all table rows and check for the device
    const allRows = document.querySelectorAll('tbody tr');
    
    allRows.forEach(row => {
        const cells = row.querySelectorAll('td');
        cells.forEach(cell => {
            if (cell.textContent.includes(deviceId)) {
                row.style.backgroundColor = '#fef3c7'; // Yellow highlight
                row.style.border = '2px solid #f59e0b';
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                
                // Remove highlight after 5 seconds
                setTimeout(() => {
                    row.style.backgroundColor = '';
                    row.style.border = '';
                }, 5000);
            }
        });
    });
}

/**
 * Load all dashboard data
 */
async function loadDashboardData() {
    try {
        await Promise.all([
            loadKPIs(),
            loadFarms(),
            checkAlerts()
        ]);
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

/**
 * Load Key Performance Indicators
 */
async function loadKPIs() {
    try {
        // Fetch from aggregation API endpoint
        const response = await fetch(`${API_BASE}/api/admin/analytics/aggregate`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        
        const kpis = {
            farms: data.totalFarms || 0,
            rooms: data.totalRooms || 0,
            zones: data.totalZones || 0,
            devices: data.totalDevices || 0,
            trays: data.totalTrays || 0,
            plants: 128492,
            energy: 4821,
            alerts: 12
        };

        document.getElementById('kpi-farms').textContent = kpis.farms;
        document.getElementById('kpi-farms-change').textContent = '+3 this week';
        
        document.getElementById('kpi-rooms').textContent = kpis.rooms;
        document.getElementById('kpi-rooms-change').textContent = '+8 this month';
        
        document.getElementById('kpi-zones').textContent = kpis.zones;
        document.getElementById('kpi-zones-change').textContent = '+15 this month';
        
        document.getElementById('kpi-devices').textContent = kpis.devices;
        document.getElementById('kpi-devices-change').textContent = '+42 this week';
        
        document.getElementById('kpi-trays').textContent = kpis.trays;
        document.getElementById('kpi-trays-change').textContent = '+156 this week';
        
        document.getElementById('kpi-plants').textContent = kpis.plants.toLocaleString();
        document.getElementById('kpi-plants-change').textContent = '+8,234 this week';
        
        document.getElementById('kpi-energy').textContent = `${kpis.energy.toLocaleString()} kWh`;
        document.getElementById('kpi-energy-change').textContent = '8.2% vs last week';
        
        document.getElementById('kpi-alerts').textContent = kpis.alerts;
        document.getElementById('kpi-alerts-change').textContent = '3 critical';
        
        if (kpis.alerts > 0) {
            document.getElementById('alerts-section').style.display = 'block';
            document.getElementById('critical-count').textContent = 3;
        }
    } catch (error) {
        console.error('Error loading KPIs:', error);
    }
}

/**
 * Load farms data
 */
async function loadFarms(page = 1) {
    try {
        const status = document.getElementById('filter-status')?.value || '';
        const region = document.getElementById('filter-region')?.value || '';
        const search = document.getElementById('globalSearch')?.value || '';
        
        const params = new URLSearchParams({
            page: page.toString(),
            limit: '50',
            ...(status && { status }),
            ...(region && { region }),
            ...(search && { search })
        });
        
        const response = await fetch(`${API_BASE}/api/admin/farms?${params}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        farmsData = data.farms;
        renderFarmsTable(farmsData);
        
        // Update pagination if available
        if (data.pagination && typeof renderPagination === 'function') {
            renderPagination(data.pagination);
        }
    } catch (error) {
        console.error('Error loading farms:', error);
        // Fallback to simulated data if API fails
        console.warn('Falling back to simulated data');
        farmsData = generateSampleFarms(12);
        renderFarmsTable(farmsData);
    }
}

/**
 * Generate sample farm data
 */
function generateSampleFarms(count) {
    const statuses = ['online', 'online', 'online', 'warning', 'offline'];
    const regions = ['west', 'east', 'central'];
    const farms = [];
    
    for (let i = 1; i <= count; i++) {
        const farmId = `GR-${String(i).padStart(5, '0')}`;
        const status = statuses[Math.floor(Math.random() * statuses.length)];
        const rooms = Math.floor(Math.random() * 8) + 2;
        const zones = rooms * (Math.floor(Math.random() * 3) + 2);
        const devices = zones * (Math.floor(Math.random() * 5) + 3);
        const trays = zones * (Math.floor(Math.random() * 12) + 5);
        const energy = Math.floor(Math.random() * 200) + 50;
        const alerts = status === 'critical' ? Math.floor(Math.random() * 5) + 1 : 
                      status === 'warning' ? Math.floor(Math.random() * 3) : 0;
        
        farms.push({
            farmId,
            name: `Farm Site ${i}`,
            status,
            region: regions[Math.floor(Math.random() * regions.length)],
            rooms,
            zones,
            devices,
            trays,
            energy,
            alerts,
            lastUpdate: generateRandomTime()
        });
    }
    
    return farms;
}

/**
 * Render farms table
 */
function renderFarmsTable(farms) {
    const tbody = document.getElementById('farms-tbody');
    
    if (farms.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" class="loading">No farms found</td></tr>';
        return;
    }
    
    tbody.innerHTML = farms.map(farm => {
        // Format last heartbeat/update
        const lastUpdate = farm.lastHeartbeat 
            ? new Date(farm.lastHeartbeat).toLocaleString()
            : 'Never';
        
        // Show email if available
        const email = farm.email || '';
        
        return `
        <tr>
            <td><code>${farm.farmId}</code></td>
            <td>
                <strong>${farm.name}</strong>
                ${email ? `<br><small style="color: var(--text-muted)">${email}</small>` : ''}
            </td>
            <td><span class="badge badge-${getStatusBadgeClass(farm.status)}">${farm.status}</span></td>
            <td>${farm.rooms || 0}</td>
            <td>${farm.zones || 0}</td>
            <td>${farm.devices || 0}</td>
            <td>${farm.trays || 0}</td>
            <td>${farm.energy || 0} kWh</td>
            <td>${farm.alerts > 0 ? `<span class="badge badge-danger">${farm.alerts}</span>` : '-'}</td>
            <td>${lastUpdate}</td>
            <td>
                <button class="btn" onclick="drillToFarm('${farm.farmId}')">View</button>
                ${email ? `<button class="btn" style="background: var(--accent-red); margin-left: 5px;" onclick="deleteFarm('${email}', '${farm.name}')">Delete</button>` : ''}
            </td>
        </tr>
        `;
    }).join('');
}

/**
 * Delete all farms and users for an email address
 */
async function deleteFarm(email, farmName) {
    if (!confirm(`⚠️ Delete ALL farms and users for ${email}?\n\nFarm: ${farmName}\n\nThis action cannot be undone!`)) {
        return;
    }
    
    if (!confirm(`Are you absolutely sure? Type the email to confirm deletion:\n\n${email}`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/admin/farms/${encodeURIComponent(email)}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (response.ok && data.status === 'success') {
            alert(`✅ Successfully deleted:\n\n${data.deleted.farms} farm(s)\n${data.deleted.users} user(s)\n\nFarm IDs: ${data.farmIds.join(', ')}`);
            // Reload farms list
            await loadFarms();
        } else {
            alert(`❌ Error: ${data.message || 'Failed to delete farms'}`);
        }
    } catch (error) {
        console.error('Delete farm error:', error);
        alert(`❌ Network error: ${error.message}`);
    }
}

/**
 * Filter farms by status and region
 */
function filterFarms() {
    const status = document.getElementById('filter-status').value;
    const region = document.getElementById('filter-region').value;
    
    let filtered = farmsData;
    
    if (status) {
        filtered = filtered.filter(f => f.status === status);
    }
    
    if (region) {
        filtered = filtered.filter(f => f.region === region);
    }
    
    renderFarmsTable(filtered);
}

/**
 * Global search handler
 */
function handleGlobalSearch() {
    const query = document.getElementById('globalSearch').value.toLowerCase();
    
    if (query.length < 2) {
        renderFarmsTable(farmsData);
        return;
    }
    
    const filtered = farmsData.filter(farm => 
        farm.farmId.toLowerCase().includes(query) ||
        farm.name.toLowerCase().includes(query)
    );
    
    renderFarmsTable(filtered);
}

/**
 * Check for active alerts
 */
async function checkAlerts() {
    try {
        // In production: fetch from API
        // Check for critical conditions across all farms
        const criticalFarms = farmsData.filter(f => f.status === 'critical' || f.alerts > 0);
        
        if (criticalFarms.length > 0) {
            console.log(`${criticalFarms.length} farms with alerts`);
        }
    } catch (error) {
        console.error('Error checking alerts:', error);
    }
}

/**
 * View farm detail
 */
async function viewFarmDetail(farmId) {
    currentFarmId = farmId;
    
    try {
        // Fetch detailed farm data from API
        const response = await fetch(`${API_BASE}/api/admin/farms/${farmId}`);
        if (!response.ok) {
            console.error('Failed to load farm details:', response.status);
            alert('Unable to load farm details. Please try again.');
            return;
        }
        
        const farm = await response.json();
        if (!farm || farm.error) {
            console.error('Farm not found:', farmId, farm);
            alert('Farm not found or unavailable.');
            return;
        }
    
        // Update breadcrumb and header
        document.getElementById('farm-detail-name').textContent = farm.name || farmId;
        document.getElementById('farm-detail-title').textContent = farm.name || farmId;
        document.getElementById('farm-detail-id').textContent = farmId;
        
        // Hide overview, show detail
        document.getElementById('overview-view').style.display = 'none';
        document.getElementById('farm-detail-view').style.display = 'block';
        
        // Load farm details with the fetched farm data
        await loadFarmDetails(farmId, farm);
    } catch (error) {
        console.error('Error loading farm detail:', error);
        alert('Error loading farm details. Please check the console.');
    }
}

/**
 * Load farm details
 */
async function loadFarmDetails(farmId, farmData) {
    try {
        // Use provided farmData or fallback to farmsData array
        const farm = farmData || farmsData.find(f => f.farmId === farmId);
        
        if (!farm) {
            console.error('Farm data not available for:', farmId);
            return;
        }
        
        // Update metrics (handle both API response structure and local data)
        document.getElementById('detail-uptime').textContent = '99.8%';
        document.getElementById('detail-last-seen').textContent = farm.lastUpdate || 'Unknown';
        document.getElementById('detail-api-calls').textContent = `${Math.floor(Math.random() * 10000)}`;
        document.getElementById('detail-storage').textContent = `${Math.floor(Math.random() * 50)} GB`;
        
        // Get counts from farm data
        const rooms = farm.rooms || farm.environmental?.zones?.length || 0;
        const devices = farm.devices || (Array.isArray(farm.devices) ? farm.devices.length : 0);
        const zones = farm.zones || farm.environmental?.zones?.length || 0;
        
        // Update equipment status
        document.getElementById('detail-lights').textContent = `${Math.floor(devices * 0.6)}/${Math.floor(devices * 0.6)}`;
        document.getElementById('detail-sensors').textContent = `${Math.floor(devices * 0.25)}/${Math.floor(devices * 0.25)}`;
        document.getElementById('detail-hvac').textContent = `${Math.floor(rooms * 0.8)}/${rooms}`;
        document.getElementById('detail-irrigation').textContent = `${Math.floor(zones * 0.3)}/${Math.floor(zones * 0.5)}`;
        
        // Load rooms for this farm
        await loadFarmRooms(farmId, rooms);
        
        // Load devices for this farm
        await loadFarmDevices(farmId, devices);
        
        // Load inventory for this farm
        await loadFarmInventory(farmId, farm.trays || 0);
        
        // Load recipes for this farm
        await loadFarmRecipes(farmId);
        
    } catch (error) {
        console.error('Error loading farm details:', error);
    }
}

/**
 * View Room Detail (Drill-down to specific room)
 */
async function viewRoomDetail(farmId, roomId) {
    console.log(`Loading room detail: ${roomId} in farm ${farmId}`);
    currentFarmId = farmId;
    
    showView('room-detail-view');
    
    // Fetch farm data to get detailed room information
    let roomData = null;
    
    try {
        const response = await fetch(`/api/admin/farms/${farmId}`);
        if (response.ok) {
            const farmData = await response.json();
            // Find the specific room in the farm data
            const room = farmData.rooms?.find(r => r.roomId === roomId);
            
            if (room) {
                roomData = {
                    roomId: room.roomId,
                    name: room.name,
                    temperature: room.temperature,
                    humidity: room.humidity,
                    co2: room.co2,
                    vpd: room.vpd,
                    zones: room.zones,
                    devices: room.devices,
                    trays: room.trays,
                    totalPlants: room.totalPlants,
                    energyToday: room.energyToday,
                    energyWeek: room.energyWeek,
                    energyTrend: room.energyTrend,
                    energyTrendPercent: room.energyTrendPercent
                };
                console.log(`[room-detail] Loaded detailed data for ${room.name}`);
            }
        }
    } catch (error) {
        console.error('[room-detail] Failed to load room data:', error);
    }
    
    // Fallback to mock data if API call failed
    if (!roomData) {
        roomData = {
            roomId,
            name: `Room ${roomId}`,
            temperature: (Math.random() * 4 + 22).toFixed(1),
            humidity: (Math.random() * 20 + 60).toFixed(0),
            co2: Math.floor(Math.random() * 400 + 800),
            vpd: (Math.random() * 0.5 + 0.8).toFixed(2),
            zones: [{ zoneId: 'zone-1' }, { zoneId: 'zone-2' }],
            devices: [],
            trays: Math.floor(Math.random() * 30) + 15,
            energyToday: Math.floor(Math.random() * 50) + 40,
            energyWeek: Math.floor(Math.random() * 300) + 250,
            energyTrend: 'down',
            energyTrendPercent: 4.2
        };
    }
    
    const zoneCount = Array.isArray(roomData.zones) ? roomData.zones.length : 2;
    const deviceCount = Array.isArray(roomData.devices) ? roomData.devices.length : 20;
    const trayCount = roomData.trays || 140;
    
    // Update title and subtitle
    document.getElementById('room-detail-title').textContent = roomData.name;
    const subtitle = `${zoneCount} zones • ${trayCount} active trays • ${deviceCount} devices`;
    document.getElementById('room-detail-subtitle').textContent = subtitle;
    
    // Update KPIs
    document.getElementById('room-temp').textContent = `${roomData.temperature}°F`;
    document.getElementById('room-temp-change').textContent = 'Optimal range';
    document.getElementById('room-humidity').textContent = `${roomData.humidity}%`;
    document.getElementById('room-humidity-change').textContent = 'Stable';
    document.getElementById('room-co2').textContent = `${roomData.co2} ppm`;
    document.getElementById('room-co2-change').textContent = 'Within limits';
    document.getElementById('room-vpd').textContent = `${roomData.vpd} kPa`;
    document.getElementById('room-vpd-change').textContent = 'Optimal';
    document.getElementById('room-trays').textContent = trayCount;
    document.getElementById('room-trays-change').textContent = `${Math.floor(trayCount * 0.85)} healthy`;
    document.getElementById('room-energy').textContent = `${roomData.energyToday} kWh`;
    
    const arrow = roomData.energyTrend === 'down' ? '↓' : '↑';
    document.getElementById('room-energy-change').textContent = `${arrow} ${roomData.energyTrendPercent}% vs last week`;
    
    // Load all sections with actual data
    await Promise.all([
        loadRoomZones(farmId, roomId, roomData.zones, trayCount),
        loadRoomDevices(farmId, roomId, roomData.devices),
        loadRoomTrays(farmId, roomId, roomData.zones, trayCount),
        loadRoomEnergy(farmId, roomId, roomData.energyToday, roomData.energyWeek),
        loadRoomTrends(farmId, roomId)
    ]);
}

/**
 * Load zones for a specific room
 */
async function loadRoomZones(farmId, roomId, zonesData, totalTrays) {
    const tbody = document.getElementById('room-zones-tbody');
    const countEl = document.getElementById('room-zones-count');
    
    // Check if zonesData is actual zone objects or just a count
    let zones = [];
    
    if (Array.isArray(zonesData) && zonesData.length > 0 && zonesData[0].zoneId) {
        // We have actual zone data from API
        zones = zonesData.map(zone => ({
            zoneId: zone.zoneId,
            name: zone.name,
            crop: zone.crop,
            groups: Array.isArray(zone.groups) ? zone.groups.length : 5,
            trays: zone.groups?.reduce((sum, g) => sum + (g.trays || 0), 0) || 0,
            temperature: `${zone.temperature}°F`,
            humidity: `${zone.humidity}%`,
            status: zone.status || 'online'
        }));
    } else {
        // Generate mock data
        const count = Array.isArray(zonesData) ? zonesData.length : 2;
        for (let i = 1; i <= count; i++) {
            const zoneId = `zone-${i}`;
            const temp = (Math.random() * 4 + 22).toFixed(1);
            const humidity = (Math.random() * 20 + 60).toFixed(0);
            const status = Math.random() > 0.9 ? 'warning' : 'online';
            const groups = Math.floor(Math.random() * 3) + 2;
            const trays = Math.floor(totalTrays / count) + Math.floor(Math.random() * 3);
            
            zones.push({
                zoneId,
                name: `Zone ${i}`,
                groups,
                trays,
                temperature: `${temp}°F`,
                humidity: `${humidity}%`,
                status
            });
        }
    }
    
    countEl.textContent = `${zones.length} zones`;
    tbody.innerHTML = zones.map(zone => `
        <tr>
            <td><code>${zone.zoneId}</code></td>
            <td><strong>${zone.name}</strong></td>
            <td>${zone.groups}</td>
            <td>${zone.trays}</td>
            <td>${zone.temperature}</td>
            <td>${zone.humidity}</td>
            <td><span class="status-badge status-${zone.status}">${zone.status}</span></td>
            <td><button class="btn-sm" onclick="drillToZone('${farmId}', '${roomId}', '${zone.zoneId}')">View</button></td>
        </tr>
    `).join('');
}

/**
 * Load devices for a specific room
 */
async function loadRoomDevices(farmId, roomId, devicesData) {
    const tbody = document.getElementById('room-devices-tbody');
    const countEl = document.getElementById('room-devices-count');
    const deviceTypes = ['light', 'sensor', 'HVAC', 'irrigation'];
    let devices = [];
    
    // Check if we have actual device data from API
    if (Array.isArray(devicesData) && devicesData.length > 0 && devicesData[0].deviceId) {
        devices = devicesData.map(device => ({
            deviceId: device.deviceId,
            type: device.type,
            zone: device.zone,
            status: device.status || 'online',
            lastSeen: device.lastSeen ? new Date(device.lastSeen).toLocaleString() : generateRandomTime()
        }));
    } else {
        // Generate mock data
        const count = Array.isArray(devicesData) ? devicesData.length : 20;
        for (let i = 1; i <= count; i++) {
            const type = deviceTypes[Math.floor(Math.random() * deviceTypes.length)];
            const status = Math.random() > 0.9 ? 'offline' : 'online';
            const zoneNum = Math.floor(Math.random() * 4) + 1;
            
            devices.push({
                deviceId: `DEV-${String(i).padStart(4, '0')}`,
                type,
                zone: `Zone ${zoneNum}`,
                status,
                lastSeen: generateRandomTime()
            });
        }
    }
    
    tbody.innerHTML = devices.map(device => `
        <tr>
            <td><code>${device.deviceId}</code></td>
            <td>${device.type}</td>
            <td>${device.zone}</td>
            <td><span class="badge badge-${device.status === 'online' ? 'success' : 'danger'}">${device.status}</span></td>
            <td>${device.lastSeen}</td>
        </tr>
    `).join('');
    
    countEl.textContent = `${devices.length} devices`;
}

/**
 * Load trays for a specific room
 */
async function loadRoomTrays(farmId, roomId, zonesData, totalTrays) {
    const tbody = document.getElementById('room-trays-tbody');
    const countEl = document.getElementById('room-trays-count');
    const crops = ['Lettuce', 'Basil', 'Kale', 'Spinach', 'Arugula', 'Chard', 'Microgreens', 'Strawberries'];
    let trays = [];
    
    // Check if we have actual zone data with groups
    if (Array.isArray(zonesData) && zonesData.length > 0 && zonesData[0].groups) {
        // Extract tray data from groups
        zonesData.forEach(zone => {
            zone.groups.forEach((group, idx) => {
                const trayCount = group.trays || 8;
                for (let i = 1; i <= trayCount; i++) {
                    trays.push({
                        trayId: `${group.groupId}-T${String(i).padStart(2, '0')}`,
                        crop: group.crop,
                        zone: zone.name,
                        plants: Math.floor((group.plants || 192) / trayCount),
                        daysOld: group.daysOld,
                        harvestIn: group.harvestIn,
                        health: group.health
                    });
                }
            });
        });
    } else {
        // Generate mock data
        const count = totalTrays || 140;
        const zoneCount = Array.isArray(zonesData) ? zonesData.length : 2;
        
        for (let i = 1; i <= count; i++) {
            const crop = crops[Math.floor(Math.random() * crops.length)];
            const zoneNum = Math.floor(Math.random() * zoneCount) + 1;
            const daysOld = Math.floor(Math.random() * 20) + 5;
            const harvestIn = Math.floor(Math.random() * 15) + 3;
            const health = Math.random() > 0.15 ? 'healthy' : (Math.random() > 0.5 ? 'warning' : 'attention');
            const plants = Math.floor(Math.random() * 50) + 150;
            
            trays.push({
                trayId: `T-${String(i).padStart(3, '0')}`,
                crop,
                zone: `Zone ${zoneNum}`,
                plants,
                daysOld,
                harvestIn,
                health
            });
        }
    }
    
    countEl.textContent = `${trays.length} trays`;
    tbody.innerHTML = trays.slice(0, 50).map(tray => `
        <tr>
            <td><code>${tray.trayId}</code></td>
            <td><strong>${tray.crop}</strong></td>
            <td>${tray.zone}</td>
            <td>${tray.plants}</td>
            <td>${tray.daysOld}d</td>
            <td>${tray.harvestIn}d</td>
            <td><span class="status-badge status-${tray.health === 'healthy' ? 'online' : (tray.health === 'warning' ? 'warning' : 'offline')}">${tray.health}</span></td>
        </tr>
    `).join('');
    
    if (trays.length > 50) {
        tbody.innerHTML += `<tr><td colspan="7" style="text-align: center; padding: 12px; color: #a0aec0;">Showing first 50 of ${trays.length} trays</td></tr>`;
    }
}

/**
 * Load energy consumption data for a room
 */
async function loadRoomEnergy(farmId, roomId, today, week) {
    const avgPerDay = (week / 7).toFixed(1);
    const trend = Math.random() > 0.5 ? 'down' : 'up';
    const trendPercent = (Math.random() * 10 + 3).toFixed(1);
    
    document.getElementById('room-energy-today').textContent = `${today} kWh`;
    document.getElementById('room-energy-week').textContent = `${week} kWh`;
    document.getElementById('room-energy-avg').textContent = `${avgPerDay} kWh`;
    
    const trendEl = document.getElementById('room-energy-trend');
    const arrow = trend === 'down' ? '↓' : '↑';
    const color = trend === 'down' ? '#10b981' : '#ef4444';
    trendEl.textContent = `${arrow} ${trendPercent}%`;
    trendEl.style.color = color;
    
    // Draw simple energy chart
    drawSimpleChart('room-energy-chart', generateEnergyData(7), color);
}

/**
 * Load environmental trends for a room
 */
async function loadRoomTrends(farmId, roomId) {
    // Generate 24-hour data (every 2 hours = 12 points)
    const tempData = generateTrendData(24, 72, 78);
    const humidityData = generateTrendData(55, 65, 75);
    const co2Data = generateTrendData(800, 1000, 1200);
    const vpdData = generateTrendData(0.8, 1.0, 1.2);
    
    drawSimpleChart('room-temp-chart', tempData, '#3b82f6');
    drawSimpleChart('room-humidity-chart', humidityData, '#10b981');
    drawSimpleChart('room-co2-chart', co2Data, '#f59e0b');
    drawSimpleChart('room-vpd-chart', vpdData, '#8b5cf6');
}

/**
 * Generate trend data with realistic variation
 */
function generateTrendData(min, target, max) {
    const data = [];
    let current = target;
    
    for (let i = 0; i < 12; i++) {
        const variation = (Math.random() - 0.5) * (max - min) * 0.3;
        current = Math.max(min, Math.min(max, current + variation));
        data.push(current);
    }
    
    return data;
}

/**
 * Generate energy consumption data
 */
function generateEnergyData(days) {
    const data = [];
    let base = 50;
    
    for (let i = 0; i < days; i++) {
        const variation = (Math.random() - 0.5) * 20;
        data.push(Math.max(30, base + variation));
    }
    
    return data;
}

/**
 * Draw simple sparkline chart on canvas
 */
function drawSimpleChart(canvasId, data, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Find min/max for scaling
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    
    // Draw line
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    data.forEach((value, index) => {
        const x = (index / (data.length - 1)) * width;
        const y = height - ((value - min) / range) * height;
        
        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    
    ctx.stroke();
    
    // Draw area fill
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = color + '20'; // 20% opacity
    ctx.fill();
}

/**
 * View Zone Detail (Drill-down to specific zone)
 */
async function viewZoneDetail(farmId, roomId, zoneId) {
    console.log(`Loading zone detail: ${zoneId} in room ${roomId}, farm ${farmId}`);
    currentFarmId = farmId;
    
    showView('zone-detail-view');
    
    // Mock zone data - TODO: Replace with actual API call
    const zoneData = {
        zoneId,
        name: `Zone ${zoneId.split('-').pop()}`,
        temperature: (Math.random() * 4 + 22).toFixed(1),
        humidity: (Math.random() * 20 + 60).toFixed(0),
        ppfd: Math.floor(Math.random() * 200) + 400,
        groups: Math.floor(Math.random() * 3) + 2,
        devices: Math.floor(Math.random() * 8) + 5,
        trays: Math.floor(Math.random() * 15) + 10
    };
    
    // Update title and KPIs
    document.getElementById('zone-detail-title').textContent = zoneData.name;
    document.getElementById('zone-temp').textContent = `${zoneData.temperature}°F`;
    document.getElementById('zone-temp-change').textContent = 'Optimal';
    document.getElementById('zone-humidity').textContent = `${zoneData.humidity}%`;
    document.getElementById('zone-humidity-change').textContent = 'Stable';
    document.getElementById('zone-ppfd').textContent = `${zoneData.ppfd} μmol/m²/s`;
    document.getElementById('zone-ppfd-change').textContent = 'Target: 600';
    document.getElementById('zone-groups').textContent = zoneData.groups;
    document.getElementById('zone-groups-change').textContent = 'All active';
    document.getElementById('zone-devices').textContent = zoneData.devices;
    document.getElementById('zone-devices-change').textContent = 'All online';
    document.getElementById('zone-trays').textContent = zoneData.trays;
    document.getElementById('zone-trays-change').textContent = 'At capacity';
    
    // Load groups for this zone
    await loadZoneGroups(farmId, roomId, zoneId, zoneData.groups);
    
    // Load sensors for this zone
    await loadZoneSensors(farmId, roomId, zoneId);
}

/**
 * Load groups for a specific zone
 */
async function loadZoneGroups(farmId, roomId, zoneId, count) {
    const tbody = document.getElementById('zone-groups-tbody');
    const cropTypes = ['Lettuce', 'Basil', 'Arugula', 'Kale', 'Spinach'];
    const groups = [];
    
    for (let i = 1; i <= count; i++) {
        const groupId = `group-${i}`;
        const cropType = cropTypes[Math.floor(Math.random() * cropTypes.length)];
        const devices = Math.floor(Math.random() * 4) + 2;
        const trays = Math.floor(Math.random() * 8) + 4;
        const status = Math.random() > 0.95 ? 'warning' : 'active';
        
        groups.push({
            groupId,
            name: `${cropType} Batch ${i}`,
            devices,
            trays,
            recipe: `${cropType} Standard`,
            status
        });
    }
    
    tbody.innerHTML = groups.map(group => `
        <tr>
            <td><code>${group.groupId}</code></td>
            <td><strong>${group.name}</strong></td>
            <td>${group.devices}</td>
            <td>${group.trays}</td>
            <td>${group.recipe}</td>
            <td><span class="badge badge-${getStatusBadgeClass(group.status)}">${group.status}</span></td>
            <td>
                <button class="btn" onclick="drillToGroup('${farmId}', '${roomId}', '${zoneId}', '${group.groupId}')">View</button>
            </td>
        </tr>
    `).join('');
}

/**
 * Load sensors for a specific zone
 */
async function loadZoneSensors(farmId, roomId, zoneId) {
    const tbody = document.getElementById('zone-sensors-tbody');
    const sensorTypes = ['Temperature', 'Humidity', 'CO2', 'Light', 'Soil Moisture'];
    const sensors = [];
    
    for (const type of sensorTypes) {
        const sensorId = `${type.toLowerCase().replace(' ', '-')}-sensor-${zoneId}`;
        let reading = '';
        
        switch(type) {
            case 'Temperature':
                reading = `${(Math.random() * 4 + 22).toFixed(1)}°F`;
                break;
            case 'Humidity':
                reading = `${(Math.random() * 20 + 60).toFixed(0)}%`;
                break;
            case 'CO2':
                reading = `${Math.floor(Math.random() * 400 + 800)} ppm`;
                break;
            case 'Light':
                reading = `${Math.floor(Math.random() * 200) + 400} PPFD`;
                break;
            case 'Soil Moisture':
                reading = `${(Math.random() * 20 + 40).toFixed(0)}%`;
                break;
        }
        
        sensors.push({
            sensorId,
            type,
            reading,
            status: Math.random() > 0.95 ? 'offline' : 'online',
            lastUpdate: generateRandomTime()
        });
    }
    
    tbody.innerHTML = sensors.map(sensor => `
        <tr>
            <td><code>${sensor.sensorId}</code></td>
            <td>${sensor.type}</td>
            <td>${sensor.reading}</td>
            <td><span class="badge badge-${sensor.status === 'online' ? 'success' : 'danger'}">${sensor.status}</span></td>
            <td>${sensor.lastUpdate}</td>
        </tr>
    `).join('');
}

/**
 * View Group Detail (Drill-down to specific group)
 */
async function viewGroupDetail(farmId, roomId, zoneId, groupId) {
    console.log(`Loading group detail: ${groupId} in zone ${zoneId}, room ${roomId}, farm ${farmId}`);
    currentFarmId = farmId;
    
    showView('group-detail-view');
    
    // Mock group data - TODO: Replace with actual API call
    const groupData = {
        groupId,
        name: groupId.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        devices: Math.floor(Math.random() * 4) + 2,
        trays: Math.floor(Math.random() * 8) + 4,
        intensity: Math.floor(Math.random() * 30) + 70,
        ppfd: Math.floor(Math.random() * 200) + 400,
        recipe: 'Lettuce Standard',
        schedule: 'Day 12 / Photoperiod 18:6'
    };
    
    // Update title and KPIs
    document.getElementById('group-detail-title').textContent = groupData.name;
    document.getElementById('group-devices').textContent = groupData.devices;
    document.getElementById('group-devices-change').textContent = 'All online';
    document.getElementById('group-trays').textContent = groupData.trays;
    document.getElementById('group-trays-change').textContent = 'At capacity';
    document.getElementById('group-intensity').textContent = `${groupData.intensity}%`;
    document.getElementById('group-intensity-change').textContent = 'Scheduled';
    document.getElementById('group-ppfd').textContent = `${groupData.ppfd} μmol/m²/s`;
    document.getElementById('group-ppfd-change').textContent = 'Target: 600';
    document.getElementById('group-recipe').textContent = groupData.recipe;
    document.getElementById('group-recipe-change').textContent = 'On schedule';
    document.getElementById('group-schedule').textContent = groupData.schedule;
    document.getElementById('group-schedule-change').textContent = 'Active';
    
    // Load devices for this group
    await loadGroupDevices(farmId, roomId, zoneId, groupId, groupData.devices);
    
    // Load trays for this group
    await loadGroupTrays(farmId, roomId, zoneId, groupId, groupData.trays);
}

/**
 * Load devices for a specific group
 */
async function loadGroupDevices(farmId, roomId, zoneId, groupId, count) {
    const tbody = document.getElementById('group-devices-tbody');
    const devices = [];
    
    for (let i = 1; i <= count; i++) {
        const deviceId = `light-${groupId}-${i}`;
        const status = Math.random() > 0.95 ? 'offline' : 'online';
        const state = status === 'online' ? `${Math.floor(Math.random() * 30) + 70}%` : 'Off';
        
        devices.push({
            deviceId,
            type: 'LED Grow Light',
            status,
            state,
            lastSeen: generateRandomTime()
        });
    }
    
    tbody.innerHTML = devices.map(device => `
        <tr>
            <td><code>${device.deviceId}</code></td>
            <td>${device.type}</td>
            <td><span class="badge badge-${device.status === 'online' ? 'success' : 'danger'}">${device.status}</span></td>
            <td>${device.state}</td>
            <td>${device.lastSeen}</td>
            <td>
                <button class="btn" style="font-size: 0.85rem; padding: 4px 12px;">Control</button>
            </td>
        </tr>
    `).join('');
}

/**
 * Load trays for a specific group
 */
async function loadGroupTrays(farmId, roomId, zoneId, groupId, count) {
    const tbody = document.getElementById('group-trays-tbody');
    const cropTypes = ['Lettuce', 'Basil', 'Arugula', 'Kale'];
    const trays = [];
    
    for (let i = 1; i <= count; i++) {
        const trayId = `tray-${groupId}-${String(i).padStart(3, '0')}`;
        const cropType = cropTypes[Math.floor(Math.random() * cropTypes.length)];
        const plantCount = Math.floor(Math.random() * 20) + 40;
        const daysToHarvest = Math.floor(Math.random() * 15) + 5;
        const health = Math.random() > 0.9 ? 'Fair' : 'Good';
        
        trays.push({
            trayId,
            cropType,
            plantCount,
            daysToHarvest,
            health
        });
    }
    
    tbody.innerHTML = trays.map(tray => `
        <tr>
            <td><code>${tray.trayId}</code></td>
            <td>${tray.cropType}</td>
            <td>${tray.plantCount}</td>
            <td>${tray.daysToHarvest} days</td>
            <td><span class="badge badge-${tray.health === 'Good' ? 'success' : 'warning'}">${tray.health}</span></td>
        </tr>
    `).join('');
}

/**
 * Load farm rooms
 */
async function loadFarmRooms(farmId, count) {
    roomsData = [];
    
    for (let i = 1; i <= count; i++) {
        const temp = (Math.random() * 4 + 22).toFixed(1);
        const humidity = (Math.random() * 20 + 60).toFixed(0);
        const co2 = Math.floor(Math.random() * 400 + 800);
        const zones = Math.floor(Math.random() * 4) + 2;
        const devices = zones * (Math.floor(Math.random() * 4) + 3);
        
        roomsData.push({
            name: `Room ${String.fromCharCode(64 + i)}`,
            status: Math.random() > 0.9 ? 'warning' : 'online',
            zones,
            devices,
            temp,
            humidity,
            co2
        });
    }
    
    renderRoomsTable();
}

/**
 * Render rooms table
 */
function renderRoomsTable() {
    const tbody = document.getElementById('rooms-tbody');
    
    tbody.innerHTML = roomsData.map(room => `
        <tr>
            <td><strong>${room.name}</strong></td>
            <td><span class="badge badge-${getStatusBadgeClass(room.status)}">${room.status}</span></td>
            <td>${room.zones}</td>
            <td>${room.devices}</td>
            <td>${room.temp}</td>
            <td>${room.humidity}</td>
            <td>${room.co2}</td>
            <td>
                <button class="btn" onclick="viewRoomDetail('${room.name}')">View</button>
            </td>
        </tr>
    `).join('');
}

/**
 * Load farm devices
 */
async function loadFarmDevices(farmId, count) {
    const deviceTypes = ['light', 'sensor', 'hvac', 'irrigation'];
    const statuses = ['online', 'online', 'online', 'offline'];
    devicesData = [];
    
    for (let i = 1; i <= Math.min(count, 50); i++) {
        const type = deviceTypes[Math.floor(Math.random() * deviceTypes.length)];
        const status = statuses[Math.floor(Math.random() * statuses.length)];
        
        devicesData.push({
            deviceId: `DEV-${String(i).padStart(4, '0')}`,
            name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${i}`,
            type,
            location: `Room ${String.fromCharCode(65 + Math.floor(Math.random() * 5))} / Zone ${Math.floor(Math.random() * 5) + 1}`,
            status,
            lastSeen: generateRandomTime(),
            firmware: `v${Math.floor(Math.random() * 3) + 1}.${Math.floor(Math.random() * 10)}.${Math.floor(Math.random() * 20)}`
        });
    }
    
    renderDevicesTable(devicesData);
}

/**
 * Render devices table
 */
function renderDevicesTable(devices) {
    const tbody = document.getElementById('devices-tbody');
    
    tbody.innerHTML = devices.map(device => `
        <tr>
            <td><code>${device.deviceId}</code></td>
            <td>${device.name}</td>
            <td><span class="badge badge-info">${device.type}</span></td>
            <td>${device.location}</td>
            <td><span class="badge badge-${device.status === 'online' ? 'success' : 'danger'}">${device.status}</span></td>
            <td>${device.lastSeen}</td>
            <td>${device.firmware}</td>
            <td>
                <button class="btn" onclick="viewDeviceDetail('${device.deviceId}')">View</button>
            </td>
        </tr>
    `).join('');
}

/**
 * Filter devices by type
 */
function filterDevices() {
    const type = document.getElementById('filter-device-type').value;
    
    const filtered = type ? devicesData.filter(d => d.type === type) : devicesData;
    renderDevicesTable(filtered);
}

/**
 * Load farm inventory
 */
async function loadFarmInventory(farmId, trayCount) {
    const recipes = ['Lettuce - Buttercrunch', 'Basil - Genovese', 'Kale - Lacinato', 'Arugula', 'Spinach'];
    const statuses = ['growing', 'growing', 'ready', 'harvested'];
    inventoryData = [];
    
    for (let i = 1; i <= Math.min(trayCount, 50); i++) {
        const recipe = recipes[Math.floor(Math.random() * recipes.length)];
        const plantCount = Math.floor(Math.random() * 50) + 20;
        const age = Math.floor(Math.random() * 40) + 5;
        const harvestDays = Math.max(0, Math.floor(Math.random() * 30) - age + 30);
        const status = harvestDays < 5 ? 'ready' : 'growing';
        
        inventoryData.push({
            trayId: `TRY-${String(i).padStart(5, '0')}`,
            recipe,
            location: `Room ${String.fromCharCode(65 + Math.floor(Math.random() * 5))} / Zone ${Math.floor(Math.random() * 5) + 1}`,
            plantCount,
            age,
            harvestEst: harvestDays === 0 ? 'Today' : `${harvestDays}d`,
            status
        });
    }
    
    renderInventoryTable();
}

/**
 * Render inventory table
 */
function renderInventoryTable() {
    const tbody = document.getElementById('inventory-tbody');
    
    tbody.innerHTML = inventoryData.map(item => `
        <tr>
            <td><code>${item.trayId}</code></td>
            <td>${item.recipe}</td>
            <td>${item.location}</td>
            <td>${item.plantCount}</td>
            <td>${item.age}</td>
            <td>${item.harvestEst}</td>
            <td><span class="badge badge-${item.status === 'ready' ? 'success' : 'info'}">${item.status}</span></td>
            <td>
                <button class="btn" onclick="viewTrayDetail('${item.trayId}')">View</button>
            </td>
        </tr>
    `).join('');
}

/**
 * Load farm recipes
 */
async function loadFarmRecipes(farmId) {
    recipesData = [
        {
            name: 'Lettuce - Buttercrunch',
            cropType: 'Lettuce',
            activeTrays: 42,
            cycleDuration: '35 days',
            avgHarvestTime: '33.2 days',
            variance: '-1.8d',
            successRate: '94.2%'
        },
        {
            name: 'Basil - Genovese',
            cropType: 'Basil',
            activeTrays: 28,
            cycleDuration: '28 days',
            avgHarvestTime: '29.5 days',
            variance: '+1.5d',
            successRate: '91.7%'
        },
        {
            name: 'Kale - Lacinato',
            cropType: 'Kale',
            activeTrays: 18,
            cycleDuration: '45 days',
            avgHarvestTime: '43.8 days',
            variance: '-1.2d',
            successRate: '96.1%'
        }
    ];
    
    renderRecipesTable();
}

/**
 * Render recipes table
 */
function renderRecipesTable() {
    const tbody = document.getElementById('recipes-tbody');
    
    tbody.innerHTML = recipesData.map(recipe => `
        <tr>
            <td><strong>${recipe.name}</strong></td>
            <td>${recipe.cropType}</td>
            <td>${recipe.activeTrays}</td>
            <td>${recipe.cycleDuration}</td>
            <td>${recipe.avgHarvestTime}</td>
            <td>${recipe.variance}</td>
            <td><span class="badge badge-success">${recipe.successRate}</span></td>
            <td>
                <button class="btn" onclick="analyzeRecipe('${recipe.name}')">Analyze</button>
            </td>
        </tr>
    `).join('');
}

/**
 * Helper function to show a specific view and hide all others
 */
function showView(viewId) {
    // Hide all views
    document.querySelectorAll('.view').forEach(v => {
        v.style.display = 'none';
    });
    
    // Show the requested view
    const targetView = document.getElementById(viewId);
    if (targetView) {
        targetView.style.display = 'block';
    } else {
        console.error(`View not found: ${viewId}`);
    }
}

/**
 * Navigate between views
 */
async function navigate(view, element) {
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Add active class to clicked element if it's a nav item
    const targetElement = element || event?.target;
    if (targetElement && targetElement.classList.contains('nav-item')) {
        targetElement.classList.add('active');
    }
    
    // Hide all views
    document.querySelectorAll('.view').forEach(v => {
        v.style.display = 'none';
    });
    
    // Navigate to view and load data
    switch(view) {
        case 'wholesale-admin':
            window.location.href = '/GR-admin.html';
            return;
        case 'wholesale-buyer':
            window.location.href = '/GR-wholesale.html';
            return;
        case 'overview':
            document.getElementById('overview-view').style.display = 'block';
            const dashboardNav = document.querySelector('.nav-item[onclick*="overview"]');
            if (dashboardNav) {
                dashboardNav.classList.add('active');
            }
            loadDashboard();
            break;
            
        case 'farms':
            document.getElementById('overview-view').style.display = 'block';
            setTimeout(() => {
                const farmsCard = document.querySelector('.card-title');
                if (farmsCard && farmsCard.textContent.includes('All Farms')) {
                    farmsCard.closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 100);
            break;
            
        case 'analytics':
            document.getElementById('analytics-view').style.display = 'block';
            await loadAnalytics();
            break;
            
        case 'inventory':
            document.getElementById('inventory-view').style.display = 'block';
            break;
            
        case 'rooms':
            document.getElementById('rooms-view').style.display = 'block';
            await loadRoomsView();
            break;
            
        case 'zones':
            document.getElementById('zones-view').style.display = 'block';
            await loadZonesView();
            break;
            
        case 'groups':
            document.getElementById('overview-view').style.display = 'block';
            break;
            
        case 'devices':
            document.getElementById('devices-view').style.display = 'block';
            await loadAllDevicesView();
            break;
            
        case 'recipes':
            document.getElementById('recipes-view').style.display = 'block';
            await loadAllRecipesView();
            break;
            
        case 'harvest':
            document.getElementById('harvest-view').style.display = 'block';
            await loadHarvestView();
            break;
            
        case 'environmental':
            document.getElementById('environmental-view').style.display = 'block';
            await loadEnvironmentalView();
            break;
            
        case 'energy':
            document.getElementById('energy-view').style.display = 'block';
            await loadEnergyDashboard();
            break;
            
        case 'yield':
            document.getElementById('overview-view').style.display = 'block';
            break;
            
        case 'anomalies':
            document.getElementById('anomalies-view').style.display = 'block';
            await loadAnomaliesView();
            break;
            
        case 'alerts':
            document.getElementById('alerts-view').style.display = 'block';
            await loadAlertsView();
            break;
            
        case 'tenants':
        case 'billing':
        case 'support':
            document.getElementById('overview-view').style.display = 'block';
            break;
            
        default:
            console.log(`Navigate to: ${view} (not implemented)`);
            document.getElementById('overview-view').style.display = 'block';
    }
}

/**
 * Switch detail tabs
 */
function switchDetailTab(tab, element) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Add active class to clicked element
    const targetElement = element || event?.target;
    if (targetElement) {
        targetElement.classList.add('active');
    }
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`detail-${tab}`).classList.add('active');
}

/**
 * Export report
 */
function exportReport() {
    console.log('Exporting farm report...');
    
    // In production, generate CSV/Excel/PDF
    const csv = generateFarmsCSV();
    downloadCSV(csv, 'greenreach-farms-report.csv');
}

/**
 * Export farm data
 */
function exportFarmData() {
    if (!currentFarmId) return;
    
    console.log(`Exporting data for ${currentFarmId}...`);
    
    // In production, fetch all farm data and export
    const farm = farmsData.find(f => f.farmId === currentFarmId);
    alert(`Export data for ${farm.name}\n\nIn production, this would generate a comprehensive report including:\n- Environmental history\n- Energy consumption\n- Harvest data\n- Device logs\n- Anomaly reports`);
}

/**
 * Generate farms CSV
 */
function generateFarmsCSV() {
    const headers = ['Farm ID', 'Name', 'Status', 'Rooms', 'Zones', 'Devices', 'Trays', 'Energy (kWh)', 'Alerts', 'Last Update'];
    const rows = farmsData.map(f => [
        f.farmId, f.name, f.status, f.rooms, f.zones, f.devices, f.trays, f.energy, f.alerts, f.lastUpdate
    ]);
    
    return [headers, ...rows].map(row => row.join(',')).join('\n');
}

/**
 * Download CSV file
 */
function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
}

/**
 * Utility: Get status badge class
 */
function getStatusBadgeClass(status) {
    const map = {
        'online': 'success',
        'offline': 'danger',
        'warning': 'warning',
        'critical': 'danger'
    };
    return map[status] || 'neutral';
}

/**
 * Utility: Generate random time
 */
function generateRandomTime() {
    const minutes = Math.floor(Math.random() * 60);
    return minutes === 0 ? 'Just now' : 
           minutes === 1 ? '1 min ago' : 
           minutes < 60 ? `${minutes} min ago` : 
           `${Math.floor(minutes / 60)}h ago`;
}

/**
 * Refresh data periodically
 */
async function refreshData() {
    console.log('Refreshing data...');
    await loadKPIs();
    // Don't refresh full farm list to avoid losing filter state
}

/**
 * View room detail
 */
function viewRoomDetail(roomName) {
    console.log(`View room: ${roomName}`);
    alert(`Room Detail: ${roomName}\n\nIn production, this would drill down to:\n- Zone-level environmental data\n- Device status per zone\n- Active trays in this room\n- Energy consumption\n- Historical trends`);
}

/**
 * View device detail
 */
function viewDeviceDetail(deviceId) {
    console.log(`View device: ${deviceId}`);
    alert(`Device Detail: ${deviceId}\n\nIn production, this would show:\n- Real-time status\n- Configuration\n- Firmware version\n- Performance metrics\n- Error logs\n- Control interface`);
}

/**
 * View tray detail
 */
function viewTrayDetail(trayId) {
    console.log(`View tray: ${trayId}`);
    alert(`Tray Detail: ${trayId}\n\nIn production, this would show:\n- Recipe details\n- Growth timeline\n- Environmental exposure\n- Plant health metrics\n- Expected vs actual harvest\n- Photos/imaging data`);
}

/**
 * Analyze recipe
 */
function analyzeRecipe(recipeName) {
    console.log(`Analyze recipe: ${recipeName}`);
    alert(`Recipe Analysis: ${recipeName}\n\nAI-Powered Insights:\n- Growth rate optimization opportunities\n- Environmental condition recommendations\n- Energy efficiency improvements\n- Yield prediction models\n- Comparison with industry benchmarks\n- Historical performance trends`);
}

/**
 * Show farm configuration
 */
function showFarmConfig() {
    console.log('Show farm configuration');
    alert('Farm Configuration\n\nWould display:\n- Network settings\n- API keys\n- Device registration\n- Integration settings\n- Notification preferences');
}

/**
 * Show farm logs
 */
function showFarmLogs() {
    console.log('Show farm logs');
    alert('Farm System Logs\n\nWould display:\n- API calls\n- Device connections\n- Errors and warnings\n- User activity\n- System events');
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    // Add styles inline if toast container doesn't exist
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
        color: white;
        border-radius: 6px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        font-size: 14px;
        max-width: 400px;
        animation: slideIn 0.3s ease-out;
    `;
    
    // Add to body
    document.body.appendChild(toast);
    
    // Remove after 3 seconds
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 300);
    }, 3000);
}

// ============================================================================
// VIEW DATA LOADING FUNCTIONS
// ============================================================================

/**
 * Load AI Analytics view
 */
async function loadAnalytics() {
    console.log('[Analytics] Loading ML analytics data...');
    
    // Update KPIs with mock data
    document.getElementById('analytics-models').textContent = '3';
    document.getElementById('analytics-predictions').textContent = '127';
    document.getElementById('analytics-accuracy').textContent = '92%';
    document.getElementById('analytics-anomalies').textContent = '5';
    
    // Load recent insights
    const insightsHtml = `
        <div class="metric-row">
            <div class="metric-label">Last Updated</div>
            <div class="metric-value">${new Date().toLocaleString()}</div>
        </div>
        <div class="metric-row">
            <div class="metric-label">Forecast Status</div>
            <div class="metric-value">Active</div>
        </div>
        <div class="metric-row">
            <div class="metric-label">Next Update</div>
            <div class="metric-value">In 6 hours</div>
        </div>
    `;
    document.getElementById('analytics-insights').innerHTML = insightsHtml;
    
    // Load model performance
    const perfHtml = `
        <div class="metric-row">
            <div class="metric-label">Temperature Forecast</div>
            <div class="metric-value">92% accuracy</div>
        </div>
        <div class="metric-row">
            <div class="metric-label">Harvest Timing</div>
            <div class="metric-value">88% accuracy</div>
        </div>
        <div class="metric-row">
            <div class="metric-label">Energy Prediction</div>
            <div class="metric-value">95% accuracy</div>
        </div>
    `;
    document.getElementById('analytics-performance').innerHTML = perfHtml;
}

/**
 * Load Rooms Management view
 */
async function loadRoomsView() {
    console.log('[Rooms] Loading rooms data...');
    const tbody = document.getElementById('rooms-tbody');
    tbody.innerHTML = '<tr><td colspan="10" class="loading">Loading room data...</td></tr>';
    
    try {
        const farmsRes = await fetch(`${API_BASE}/api/admin/farms`);
        if (!farmsRes.ok) throw new Error('Failed to load farms');
        const farmsData = await farmsRes.json();
        
        let rooms = [];
        for (const farm of farmsData.farms || []) {
            // Mock room data - in production, fetch from farm details
            const roomCount = farm.rooms || Math.floor(Math.random() * 5) + 1;
            for (let i = 1; i <= roomCount; i++) {
                rooms.push({
                    name: `Room ${String.fromCharCode(64 + i)}`,
                    farmName: farm.name,
                    temperature: (70 + Math.random() * 10).toFixed(1),
                    humidity: (55 + Math.random() * 15).toFixed(0),
                    co2: (800 + Math.random() * 400).toFixed(0),
                    vpd: (0.7 + Math.random() * 0.4).toFixed(2),
                    zones: Math.floor(Math.random() * 4) + 2,
                    devices: Math.floor(Math.random() * 20) + 10,
                    status: Math.random() > 0.8 ? 'warning' : 'optimal'
                });
            }
        }
        
        if (rooms.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="empty">No rooms found</td></tr>';
            return;
        }
        
        const html = rooms.map(room => `
            <tr>
                <td>${room.name}</td>
                <td>${room.farmName}</td>
                <td>${room.temperature}°F</td>
                <td>${room.humidity}%</td>
                <td>${room.co2} ppm</td>
                <td>${room.vpd} kPa</td>
                <td>${room.zones}</td>
                <td>${room.devices}</td>
                <td><span class="status-badge status-${room.status}">${room.status}</span></td>
                <td><button class="btn-small" onclick="viewRoomDetail('${room.name}')">View</button></td>
            </tr>
        `).join('');
        
        tbody.innerHTML = html;
    } catch (error) {
        console.error('[Rooms] Failed to load rooms:', error);
        tbody.innerHTML = '<tr><td colspan="10" class="error">Failed to load room data</td></tr>';
    }
}

/**
 * Load Zones Management view
 */
async function loadZonesView() {
    console.log('[Zones] Loading zones data...');
    const tbody = document.getElementById('zones-tbody');
    tbody.innerHTML = '<tr><td colspan="10" class="loading">Loading zone data...</td></tr>';
    
    try {
        const farmsRes = await fetch(`${API_BASE}/api/admin/farms`);
        if (!farmsRes.ok) throw new Error('Failed to load farms');
        const farmsData = await farmsRes.json();
        
        let zones = [];
        for (const farm of farmsData.farms || []) {
            const roomCount = farm.rooms || 2;
            for (let r = 1; r <= roomCount; r++) {
                const zoneCount = Math.floor(Math.random() * 3) + 2;
                for (let z = 1; z <= zoneCount; z++) {
                    zones.push({
                        name: `Zone ${z}`,
                        farmName: farm.name,
                        roomName: `Room ${String.fromCharCode(64 + r)}`,
                        temperature: (70 + Math.random() * 10).toFixed(1),
                        humidity: (55 + Math.random() * 15).toFixed(0),
                        co2: (800 + Math.random() * 400).toFixed(0),
                        ppfd: (400 + Math.random() * 200).toFixed(0),
                        vpd: (0.7 + Math.random() * 0.4).toFixed(2),
                        groups: Math.floor(Math.random() * 3) + 1
                    });
                }
            }
        }
        
        if (zones.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="empty">No zones found</td></tr>';
            return;
        }
        
        const html = zones.slice(0, 100).map(zone => `
            <tr>
                <td>${zone.name}</td>
                <td>${zone.farmName}</td>
                <td>${zone.roomName}</td>
                <td>${zone.temperature}°F</td>
                <td>${zone.humidity}%</td>
                <td>${zone.co2} ppm</td>
                <td>${zone.ppfd} μmol/m²/s</td>
                <td>${zone.vpd} kPa</td>
                <td>${zone.groups}</td>
                <td><button class="btn-small">Configure</button></td>
            </tr>
        `).join('');
        
        tbody.innerHTML = html;
    } catch (error) {
        console.error('[Zones] Failed to load zones:', error);
        tbody.innerHTML = '<tr><td colspan="10" class="error">Failed to load zone data</td></tr>';
    }
}

/**
 * Load All Devices view
 */
async function loadAllDevicesView() {
    console.log('[Devices] Loading all devices...');
    const tbody = document.getElementById('all-devices-tbody');
    tbody.innerHTML = '<tr><td colspan="9" class="loading">Loading device inventory...</td></tr>';
    
    try {
        const farmsRes = await fetch(`${API_BASE}/api/admin/farms`);
        if (!farmsRes.ok) throw new Error('Failed to load farms');
        const farmsData = await farmsRes.json();
        
        let allDevices = [];
        for (const farm of farmsData.farms || []) {
            const deviceCount = farm.devices || Math.floor(Math.random() * 30) + 20;
            const types = ['light', 'sensor', 'hvac', 'irrigation'];
            for (let i = 1; i <= deviceCount; i++) {
                const type = types[Math.floor(Math.random() * types.length)];
                allDevices.push({
                    deviceId: `${type.toUpperCase()}-${String(i).padStart(4, '0')}`,
                    name: `${type.charAt(0).toUpperCase() + type.slice(1)} Device ${i}`,
                    type,
                    farmName: farm.name,
                    location: `Room ${String.fromCharCode(65 + Math.floor(i / 10))} / Zone ${(i % 5) + 1}`,
                    status: Math.random() > 0.9 ? 'offline' : 'online',
                    firmware: `v${Math.floor(Math.random() * 3) + 1}.${Math.floor(Math.random() * 10)}.${Math.floor(Math.random() * 20)}`,
                    lastSeen: new Date(Date.now() - Math.random() * 3600000).toISOString()
                });
            }
        }
        
        if (allDevices.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="empty">No devices found</td></tr>';
            return;
        }
        
        const html = allDevices.slice(0, 100).map(device => `
            <tr>
                <td>${device.deviceId}</td>
                <td>${device.name}</td>
                <td>${device.type}</td>
                <td>${device.farmName}</td>
                <td>${device.location}</td>
                <td><span class="status-badge status-${device.status}">${device.status}</span></td>
                <td>${device.firmware}</td>
                <td>${new Date(device.lastSeen).toLocaleString()}</td>
                <td><button class="btn-small" onclick="viewDeviceDetail('${device.deviceId}')">Details</button></td>
            </tr>
        `).join('');
        
        tbody.innerHTML = html;
    } catch (error) {
        console.error('[Devices] Failed to load devices:', error);
        tbody.innerHTML = '<tr><td colspan="9" class="error">Failed to load device inventory</td></tr>';
    }
}

/**
 * Load All Recipes view
 */
async function loadAllRecipesView() {
    console.log('[Recipes] Loading all recipes...');
    const tbody = document.getElementById('all-recipes-tbody');
    
    const recipes = [
        { name: 'Buttercrunch Lettuce - 28 Day', crop: 'Lettuce', trays: 45, duration: 28, avgHarvest: 29, expectedVsActual: '+1d', success: '94%' },
        { name: 'Genovese Basil - 35 Day', crop: 'Basil', trays: 32, duration: 35, avgHarvest: 34, expectedVsActual: '-1d', success: '97%' },
        { name: 'Lacinato Kale - 42 Day', crop: 'Kale', trays: 28, duration: 42, avgHarvest: 44, expectedVsActual: '+2d', success: '91%' },
        { name: 'Arugula - 21 Day', crop: 'Arugula', trays: 18, duration: 21, avgHarvest: 20, expectedVsActual: '-1d', success: '98%' },
    ];
    
    const html = recipes.map(recipe => `
        <tr>
            <td>${recipe.name}</td>
            <td>${recipe.crop}</td>
            <td>${recipe.trays}</td>
            <td>${recipe.duration} days</td>
            <td>${recipe.avgHarvest} days</td>
            <td>${recipe.expectedVsActual}</td>
            <td>${recipe.success}</td>
            <td><button class="btn-small" onclick="analyzeRecipe('${recipe.name}')">Analyze</button></td>
        </tr>
    `).join('');
    
    tbody.innerHTML = html;
}

/**
 * Load Harvest Analysis view
 */
async function loadHarvestView() {
    console.log('[Harvest] Loading harvest analysis...');
    
    document.getElementById('harvest-week').textContent = '12';
    document.getElementById('harvest-cycle').textContent = '32';
    document.getElementById('harvest-success').textContent = '94.2';
    document.getElementById('harvest-upcoming').textContent = '8';
    
    const forecastHtml = `
        <div class="metric-row">
            <div class="metric-label">7-Day Bucket</div>
            <div class="metric-value">8 trays (1,024 plants)</div>
        </div>
        <div class="metric-row">
            <div class="metric-label">14-Day Bucket</div>
            <div class="metric-value">15 trays (1,920 plants)</div>
        </div>
        <div class="metric-row">
            <div class="metric-label">30-Day Bucket</div>
            <div class="metric-value">42 trays (5,376 plants)</div>
        </div>
        <div class="metric-row">
            <div class="metric-label">30+ Day Bucket</div>
            <div class="metric-value">68 trays (8,704 plants)</div>
        </div>
    `;
    document.getElementById('harvest-forecast').innerHTML = forecastHtml;
    
    const perfHtml = `
        <div class="metric-row">
            <div class="metric-label">Best Performer</div>
            <div class="metric-value">Genovese Basil (97% success)</div>
        </div>
        <div class="metric-row">
            <div class="metric-label">Most Popular</div>
            <div class="metric-value">Buttercrunch Lettuce (45 trays)</div>
        </div>
        <div class="metric-row">
            <div class="metric-label">Fastest Cycle</div>
            <div class="metric-value">Arugula (20 days avg)</div>
        </div>
    `;
    document.getElementById('harvest-recipe-performance').innerHTML = perfHtml;
}

/**
 * Load Environmental Dashboard view
 */
async function loadEnvironmentalView() {
    console.log('[Environmental] Loading environmental data...');
    
    document.getElementById('env-avg-temp').textContent = '72.4';
    document.getElementById('env-avg-humidity').textContent = '62';
    document.getElementById('env-avg-co2').textContent = '875';
    document.getElementById('env-avg-vpd').textContent = '0.85';
    
    const conditionsHtml = `
        <div class="metric-row">
            <div class="metric-label">Optimal Zones</div>
            <div class="metric-value">18 / 24 zones</div>
        </div>
        <div class="metric-row">
            <div class="metric-label">Warning Zones</div>
            <div class="metric-value" style="color: var(--accent-yellow);">4 zones</div>
        </div>
        <div class="metric-row">
            <div class="metric-label">Critical Zones</div>
            <div class="metric-value" style="color: var(--accent-red);">2 zones</div>
        </div>
    `;
    document.getElementById('env-current-all').innerHTML = conditionsHtml;
    
    const vpdHtml = `
        <div class="metric-row">
            <div class="metric-label">Zones in Target Range</div>
            <div class="metric-value">21 / 24 zones</div>
        </div>
        <div class="metric-row">
            <div class="metric-label">Avg VPD Deviation</div>
            <div class="metric-value">±0.12 kPa</div>
        </div>
        <div class="metric-row">
            <div class="metric-label">Optimization Opportunity</div>
            <div class="metric-value">3 zones need adjustment</div>
        </div>
    `;
    document.getElementById('env-vpd-insights').innerHTML = vpdHtml;
}

/**
 * Load Energy Dashboard view
 */
async function loadEnergyDashboard() {
    console.log('[Energy] Loading energy data...');
    
    document.getElementById('energy-total-24h').textContent = '1,234';
    document.getElementById('energy-cost-kwh').textContent = '0.12';
    document.getElementById('energy-efficiency').textContent = '87%';
    document.getElementById('energy-savings').textContent = '285';
    
    const consumersHtml = `
        <div class="metric-row">
            <div class="metric-label">Farm Alpha - Lighting</div>
            <div class="metric-value">456 kWh</div>
        </div>
        <div class="metric-row">
            <div class="metric-label">Farm Beta - HVAC</div>
            <div class="metric-value">324 kWh</div>
        </div>
        <div class="metric-row">
            <div class="metric-label">Farm Gamma - Lighting</div>
            <div class="metric-value">298 kWh</div>
        </div>
    `;
    document.getElementById('energy-top-consumers').innerHTML = consumersHtml;
}

/**
 * Load Anomalies view
 */
async function loadAnomaliesView() {
    console.log('[Anomalies] Loading anomaly data...');
    const tbody = document.getElementById('anomalies-tbody');
    
    document.getElementById('anomalies-total').textContent = '12';
    document.getElementById('anomalies-critical').textContent = '2';
    document.getElementById('anomalies-ack').textContent = '7';
    document.getElementById('anomalies-rate').textContent = '98.5%';
    
    const anomalies = [
        { 
            id: 'anom-001',
            timestamp: new Date().toISOString(), 
            farm: 'Farm Alpha', 
            type: 'environmental', 
            severity: 'critical', 
            description: 'Temperature spike detected', 
            confidence: 0.95, 
            status: 'new',
            context: { farmId: 'GR-00001', roomId: 'room-a', zoneId: 'zone-2', groupId: null, deviceId: 'temp-sensor-zone-2' }
        },
        { 
            id: 'anom-002',
            timestamp: new Date(Date.now() - 3600000).toISOString(), 
            farm: 'Farm Beta', 
            type: 'device', 
            severity: 'warning', 
            description: 'Sensor reading anomaly', 
            confidence: 0.87, 
            status: 'acknowledged',
            context: { farmId: 'GR-00002', roomId: 'room-b', zoneId: 'zone-1', groupId: 'group-1', deviceId: 'light-group-1-2' }
        },
        { 
            id: 'anom-003',
            timestamp: new Date(Date.now() - 7200000).toISOString(), 
            farm: 'Farm Gamma', 
            type: 'energy', 
            severity: 'info', 
            description: 'Unusual energy consumption pattern', 
            confidence: 0.76, 
            status: 'resolved',
            context: { farmId: 'GR-00003', roomId: 'room-c', zoneId: null, groupId: null, deviceId: null }
        }
    ];
    
    const html = anomalies.map(anomaly => `
        <tr>
            <td>${new Date(anomaly.timestamp).toLocaleString()}</td>
            <td>${anomaly.farm}</td>
            <td>${anomaly.type}</td>
            <td><span class="status-badge status-${anomaly.severity}">${anomaly.severity}</span></td>
            <td>${anomaly.description}</td>
            <td>${(anomaly.confidence * 100).toFixed(0)}%</td>
            <td>${anomaly.status}</td>
            <td>
                <button class="btn-small" onclick="traceAnomaly('${anomaly.id}', ${JSON.stringify(anomaly.context).replace(/"/g, '&quot;')})">Trace</button>
                <button class="btn-small" style="margin-left: 4px;">Acknowledge</button>
            </td>
        </tr>
    `).join('');
    
    tbody.innerHTML = html;
}

/**
 * Load Alerts view
 */
async function loadAlertsView() {
    console.log('[Alerts] Loading alerts...');
    const tbody = document.getElementById('alerts-tbody');
    
    document.getElementById('alerts-active').textContent = '5';
    document.getElementById('alerts-critical').textContent = '1';
    document.getElementById('alerts-warnings').textContent = '3';
    document.getElementById('alerts-resolved').textContent = '8';
    
    const alerts = [
        { time: new Date().toISOString(), farm: 'Farm Alpha', severity: 'critical', type: 'Temperature', message: 'High temperature detected in Room A', status: 'active', acked: null },
        { time: new Date(Date.now() - 3600000).toISOString(), farm: 'Farm Beta', severity: 'warning', type: 'Humidity', message: 'Low humidity in Zone 2', status: 'acknowledged', acked: 'admin' },
        { time: new Date(Date.now() - 7200000).toISOString(), farm: 'Farm Gamma', severity: 'info', type: 'Device', message: 'Sensor offline', status: 'resolved', acked: 'system' }
    ];
    
    const html = alerts.map(alert => `
        <tr>
            <td>${new Date(alert.time).toLocaleString()}</td>
            <td>${alert.farm}</td>
            <td><span class="status-badge status-${alert.severity}">${alert.severity}</span></td>
            <td>${alert.type}</td>
            <td>${alert.message}</td>
            <td>${alert.status}</td>
            <td>${alert.acked || '--'}</td>
            <td>
                ${alert.status === 'active' ? '<button class="btn-small">Acknowledge</button>' : '--'}
            </td>
        </tr>
    `).join('');
    
    tbody.innerHTML = html;
}

/**
 * Filter functions for each view
 */
function filterRooms() {
    console.log('[Rooms] Filter triggered');
}

function filterZones() {
    console.log('[Zones] Filter triggered');
}

function filterDevicesByType() {
    console.log('[Devices] Filter triggered');
}

function filterRecipes() {
    console.log('[Recipes] Filter triggered');
}

function filterAnomalies() {
    console.log('[Anomalies] Filter triggered');
}

function filterAlerts() {
    console.log('[Alerts] Filter triggered');
}

// Initialize on load
console.log('Central Admin loaded');

