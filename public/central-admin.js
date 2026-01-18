/**
 * GreenReach Central Operations
 * Enterprise-grade farm management and monitoring system
 */

const API_BASE = window.location.origin;

// Authentication check - redirect to login if not authenticated
function checkAuth() {
    const token = localStorage.getItem('admin_token');
    if (!token) {
        window.location.href = '/GR-central-admin-login.html';
        return null;
    }
    return token;
}

// Verify token is still valid on page load
async function verifySession() {
    const token = checkAuth();
    if (!token) return false;
    
    console.log('[verifySession] Verifying token...', token.substring(0, 20) + '...');
    
    try {
        const response = await fetch(`${API_BASE}/api/admin/auth/verify`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        console.log('[verifySession] Response status:', response.status);
        const responseData = await response.json().catch(() => ({}));
        console.log('[verifySession] Response data:', responseData);
        
        if (!response.ok) {
            console.error('[verifySession] Verification failed:', response.status, responseData);
            alert(`Session verification failed!\nStatus: ${response.status}\nError: ${JSON.stringify(responseData)}\n\nCheck console for details. Click OK to continue debugging.`);
            // Comment out redirect temporarily for debugging
            // localStorage.removeItem('admin_token');
            // localStorage.removeItem('admin_email');
            // localStorage.removeItem('admin_name');
            // window.location.href = '/GR-central-admin-login.html?error=session_expired';
            return false;
        }
        
        console.log('[verifySession] Verification successful');
        alert('Session verification PASSED! Token is valid.');
        return true;
    } catch (error) {
        console.error('[verifySession] Verification error:', error);
        alert(`Session verification EXCEPTION!\nError: ${error.message}\n\nCheck console for details. Click OK to continue debugging.`);
        // Comment out redirect temporarily for debugging
        // localStorage.removeItem('admin_token');
        // localStorage.removeItem('admin_email');
        // localStorage.removeItem('admin_name');
        // window.location.href = '/GR-central-admin-login.html?error=verification_failed';
        return false;
    }
}

// Logout function
async function logout() {
    const token = localStorage.getItem('admin_token');
    if (token) {
        try {
            await fetch(`${API_BASE}/api/admin/auth/logout`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
        } catch (error) {
            console.error('Logout error:', error);
        }
    }
    
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_email');
    localStorage.removeItem('admin_name');
    window.location.href = '/GR-central-admin-login.html';
}

// Make authenticated API request
async function authenticatedFetch(url, options = {}) {
    const token = checkAuth();
    if (!token) return null;
    
    const headers = {
        ...options.headers,
        'Authorization': `Bearer ${token}`
    };
    
    try {
        const response = await fetch(url, { ...options, headers });
        
        // Handle 401 Unauthorized - session expired
        if (response.status === 401) {
            console.warn('Authentication failed, redirecting to login');
            localStorage.removeItem('admin_token');
            localStorage.removeItem('admin_email');
            localStorage.removeItem('admin_name');
            window.location.href = '/GR-central-admin-login.html';
            return null;
        }
        
        return response;
    } catch (error) {
        console.error('Authenticated fetch error:', error);
        throw error;
    }
}

// Global variables
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
    
    // Verify authentication first
    const isAuthenticated = await verifySession();
    if (!isAuthenticated) {
        return; // Will redirect to login
    }
    
    // Display logged-in user info in sidebar
    const adminName = localStorage.getItem('admin_name');
    const adminEmail = localStorage.getItem('admin_email');
    const userInfoEl = document.getElementById('admin-user-info');
    if (userInfoEl && (adminName || adminEmail)) {
        userInfoEl.innerHTML = `
            <div style="font-weight: 500; color: #e5e7eb;">${adminName || 'Admin'}</div>
            <div style="font-size: 0.75rem; color: #9ca3af;">${adminEmail || ''}</div>
        `;
        console.log(`Logged in as: ${adminName || adminEmail}`);
    }
    
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
                        { label: 'Buyers', view: 'wholesale-buyers', external: '/GR-wholesale-admin.html' },
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
                        { label: 'Users', view: 'users' },
                        { label: 'Recipes', view: 'recipes' }
                    ]
                },
                {
                    title: 'Platform',
                    items: [
                        { label: 'LE Fleet Monitoring', view: 'platform-monitoring' }
                    ]
                },
                {
                    title: 'Field Tools',
                    items: [
                        { label: 'Edge Setup Guide', view: 'edge-setup', external: '/landing-downloads.html' }
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
            const response = await authenticatedFetch(`${API_BASE}/api/admin/anomalies/${anomalyId}/context`);
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
        // Reset display for platform-wide view
        const header = document.querySelector('#overview-view .header h1');
        const farmsTable = document.querySelector('#farms-table')?.closest('.card');
        
        if (header) {
            header.textContent = 'Operations Overview';
        }
        if (farmsTable) {
            farmsTable.style.display = 'block';
        }
        
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
        const response = await authenticatedFetch(`${API_BASE}/api/admin/analytics/aggregate`);
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
        
        const response = await authenticatedFetch(`${API_BASE}/api/admin/farms?${params}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        farmsData = data.farms || [];
        renderFarmsTable(farmsData);
        
        // Update pagination if available
        if (data.pagination && typeof renderPagination === 'function') {
            renderPagination(data.pagination);
        }
    } catch (error) {
        console.error('Error loading farms:', error);
        // Show error message instead of mock data
        const tbody = document.querySelector('#farmsTable tbody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: var(--accent-red);">Failed to load farms. Please check your connection and try refreshing the page.</td></tr>';
        }
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
        // Format last login/update from database
        const lastUpdate = farm.last_login || farm.updated_at
            ? new Date(farm.last_login || farm.updated_at).toLocaleString()
            : 'Never';
        
        // Use database fields: farm_id, name, email, status, tier, user_count
        const email = farm.email || '';
        const farmId = farm.farm_id || farm.farmId || 'unknown';
        const status = farm.status || 'unknown';
        const tier = farm.tier || farm.plan_type || 'standard';
        
        return `
        <tr>
            <td><code>${farmId}</code></td>
            <td>
                <strong>${farm.name}</strong>
                ${email ? `<br><small style="color: var(--text-muted)">${email}</small>` : ''}
            </td>
            <td><span class="badge badge-${getStatusBadgeClass(status)}">${status}</span></td>
            <td><span class="badge badge-${tier === 'enterprise' ? 'success' : 'info'}">${tier}</span></td>
            <td>${farm.user_count || 0}</td>
            <td>${lastUpdate}</td>
            <td>
                <button class="btn" onclick="drillToFarm('${farmId}')">View</button>
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
        const response = await authenticatedFetch(`${API_BASE}/api/admin/farms/${encodeURIComponent(email)}`, {
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
        const response = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}`);
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
    try {
        const response = await authenticatedFetch(`/api/admin/farms/${farmId}/devices`);
        const data = await response.json();
        
        if (data.success && data.devices) {
            devicesData = data.devices.map(device => ({
                deviceId: device.device_code,
                name: device.device_name || 'Unnamed Device',
                type: device.device_type,
                location: device.location || 'Unknown',
                status: device.status || 'offline',
                lastSeen: device.last_seen ? new Date(device.last_seen).toLocaleString() : 'Never',
                firmware: device.firmware_version || 'Unknown'
            }));
        } else {
            devicesData = [];
        }
    } catch (error) {
        console.error('Error loading farm devices:', error);
        devicesData = [];
    }
    
    renderDevicesTable(devicesData);
}

/**
 * Render devices table
 */
function renderDevicesTable(devices) {
    const tbody = document.getElementById('devices-tbody');
    
    if (devices.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem; color: #a0aec0;">No devices found for this farm. Add devices to monitor equipment.</td></tr>';
        return;
    }
    
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
    try {
        const response = await authenticatedFetch(`/api/admin/farms/${farmId}/inventory`);
        const data = await response.json();
        
        if (data.success && data.trays) {
            inventoryData = data.trays.map(tray => ({
                trayId: tray.tray_code,
                recipe: tray.recipe_name || 'Unknown',
                location: tray.location || 'Unassigned',
                plantCount: tray.plant_count || 0,
                age: tray.age_days || 0,
                harvestEst: tray.days_to_harvest !== null ? 
                    (tray.days_to_harvest <= 0 ? 'Today' : `${Math.max(0, Math.floor(tray.days_to_harvest))}d`) : 
                    'Unknown',
                status: tray.status || 'unknown'
            }));
        } else {
            inventoryData = [];
        }
    } catch (error) {
        console.error('Error loading farm inventory:', error);
        inventoryData = [];
    }
    
    renderInventoryTable();
}

/**
 * Render inventory table
 */
function renderInventoryTable() {
    const tbody = document.getElementById('inventory-tbody');
    
    if (inventoryData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem; color: #a0aec0;">No trays found for this farm. Add trays to see inventory.</td></tr>';
        return;
    }
    
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
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/recipes`);
        
        if (!response.ok) {
            console.error('Failed to load recipes:', response.status);
            recipesData = [];
            renderRecipesTable();
            return;
        }
        
        const data = await response.json();
        recipesData = (data.recipes || []).map(recipe => ({
            recipe_id: recipe.recipe_id,
            name: recipe.name,
            cropType: recipe.crop_type,
            activeTrays: recipe.active_trays || 0,
            cycleDuration: `${recipe.cycle_duration_days} days`,
            avgHarvestTime: `${recipe.cycle_duration_days} days`,
            variance: '0d',
            successRate: '100%',
            description: recipe.description,
            lightSchedule: recipe.light_schedule,
            harvestCriteria: recipe.harvest_criteria
        }));
        
        renderRecipesTable();
    } catch (error) {
        console.error('Error loading recipes:', error);
        recipesData = [];
        renderRecipesTable();
    }
}

/**
 * Render recipes table
 */
function renderRecipesTable() {
    const tbody = document.getElementById('recipes-tbody');
    
    if (recipesData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: var(--text-secondary);">No recipes found for this farm. Create a recipe to get started.</td></tr>';
        return;
    }
    
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
                <button class="btn" onclick="editRecipe(${recipe.recipe_id})">Edit</button>
                <button class="btn" onclick="viewRecipeDetails(${recipe.recipe_id})">View</button>
            </td>
        </tr>
    `).join('');
}

/**
 * Edit recipe
 */
function editRecipe(recipeId) {
    const recipe = recipesData.find(r => r.recipe_id === recipeId);
    if (!recipe) {
        alert('Recipe not found');
        return;
    }
    
    alert(`Edit Recipe: ${recipe.name}\n\nRecipe editing UI will be implemented in the next phase.`);
}

/**
 * View recipe details
 */
function viewRecipeDetails(recipeId) {
    const recipe = recipesData.find(r => r.recipe_id === recipeId);
    if (!recipe) {
        alert('Recipe not found');
        return;
    }
    
    const details = `
Recipe: ${recipe.name}
Crop Type: ${recipe.cropType}
Cycle Duration: ${recipe.cycleDuration}
Active Trays: ${recipe.activeTrays}
Description: ${recipe.description || 'No description'}
Light Schedule: ${recipe.lightSchedule ? JSON.stringify(recipe.lightSchedule) : 'Not configured'}
Harvest Criteria: ${recipe.harvestCriteria || 'Not specified'}
    `.trim();
    
    alert(details);
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
        
        // Load data for specific views
        if (viewId === 'recipes-view' && typeof loadRecipes === 'function') {
            loadRecipes();
        }
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
            // If farmId is present, filter dashboard for that farm
            if (navigationContext.farmId) {
                await loadFarmSpecificDashboard(navigationContext.farmId);
            } else {
                await loadDashboardData();
            }
            break;
            
        // Farm-specific views
        case 'farm-overview':
            document.getElementById('overview-view').style.display = 'block';
            if (navigationContext.farmId) {
                await loadFarmSpecificDashboard(navigationContext.farmId);
            }
            break;
            
        case 'farm-rooms':
            document.getElementById('rooms-view').style.display = 'block';
            if (navigationContext.farmId) {
                await loadFarmRoomsView(navigationContext.farmId);
            }
            break;
            
        case 'farm-devices':
            document.getElementById('devices-view').style.display = 'block';
            if (navigationContext.farmId) {
                await loadFarmDevicesView(navigationContext.farmId);
            }
            break;
            
        case 'farm-inventory':
            document.getElementById('inventory-view').style.display = 'block';
            if (navigationContext.farmId) {
                await loadFarmInventoryView(navigationContext.farmId);
            }
            break;
            
        case 'farm-recipes':
            document.getElementById('recipes-view').style.display = 'block';
            if (navigationContext.farmId) {
                await loadFarmRecipesView(navigationContext.farmId);
            }
            break;
            
        case 'farm-environmental':
            document.getElementById('environmental-view').style.display = 'block';
            if (navigationContext.farmId) {
                await loadFarmEnvironmentalView(navigationContext.farmId);
            }
            break;
            
        case 'farm-energy':
            document.getElementById('energy-view').style.display = 'block';
            if (navigationContext.farmId) {
                await loadFarmEnergyDashboard(navigationContext.farmId);
            }
            break;
            
        case 'farm-alerts':
            document.getElementById('alerts-view').style.display = 'block';
            if (navigationContext.farmId) {
                await loadFarmAlertsView(navigationContext.farmId);
            }
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
            await loadRecipes();
            break;
            
        case 'users':
            document.getElementById('users-view').style.display = 'block';
            await loadUsersView();
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
            
        case 'platform-monitoring':
            document.getElementById('platform-monitoring-view').style.display = 'block';
            await loadPlatformMonitoring();
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
    console.log('[Analytics] Loading farm analytics data...');
    
    // Load farm metrics data
    await loadFarmMetrics(currentAnalyticsFarmId, 7);
    
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
        const farmsRes = await authenticatedFetch(`${API_BASE}/api/admin/farms`);
        if (!farmsRes || !farmsRes.ok) throw new Error('Failed to load farms');
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
        const farmsRes = await authenticatedFetch(`${API_BASE}/api/admin/farms`);
        if (!farmsRes || !farmsRes.ok) throw new Error('Failed to load farms');
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
        const farmsRes = await authenticatedFetch(`${API_BASE}/api/admin/farms`);
        if (!farmsRes || !farmsRes.ok) throw new Error('Failed to load farms');
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
 * Load All Recipes view - redirects to main recipes loader
 */
async function loadAllRecipesView() {
    console.log('[Recipes] Redirecting to loadRecipes()...');
    await loadRecipes();
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

/**
 * ===================================
 * ANALYTICS FUNCTIONS
 * ===================================
 */

let currentAnalyticsFarmId = 'greenreach-greens';
let analyticsData = {
    metrics: [],
    summary: {}
};

/**
 * Load analytics for a specific farm
 */
async function loadAnalyticsForFarm(farmId) {
    currentAnalyticsFarmId = farmId;
    await loadFarmMetrics(farmId);
}

/**
 * Refresh analytics data
 */
async function refreshAnalytics() {
    await loadFarmMetrics(currentAnalyticsFarmId);
}

/**
 * Load farm metrics from API
 */
async function loadFarmMetrics(farmId, days = 7) {
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/analytics/farms/${farmId}/metrics?days=${days}`);
        
        if (!response.ok) {
            console.error('Failed to load farm metrics:', response.status);
            showToast('Failed to load analytics data', 'error');
            return;
        }
        
        const data = await response.json();
        analyticsData = data;
        
        renderAnalyticsSummary(data.summary);
        renderAnalyticsMetricsTable(data.metrics);
        
    } catch (error) {
        console.error('Error loading farm metrics:', error);
        showToast('Error loading analytics data', 'error');
    }
}

/**
 * Render analytics summary KPIs
 */
function renderAnalyticsSummary(summary) {
    // Production
    document.getElementById('analytics-production').textContent = `${summary.totalProduction.toFixed(1)} kg`;
    document.getElementById('analytics-production-avg').textContent = `${(summary.totalProduction / summary.daysReported).toFixed(1)} kg/day avg`;
    
    // Revenue
    document.getElementById('analytics-revenue').textContent = `$${summary.totalRevenue.toFixed(2)}`;

/**
 * ===================================
 * FARM-SPECIFIC VIEW LOADING FUNCTIONS
 * ===================================
 */

/**
 * Load dashboard filtered for a specific farm
 */
async function loadFarmSpecificDashboard(farmId) {
    console.log(`Loading dashboard for farm: ${farmId}`);
    currentFarmId = farmId;
    
    try {
        // Fetch farm-specific data from backend
        const response = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}`);
        const farm = await response.json();
        
        console.log('Farm data:', farm);
        
        // Update page title
        const header = document.querySelector('#overview-view .header h1');
        if (header) {
            header.textContent = `${farm.name} - Farm Summary`;
        }
        
        // Hide the farms table when viewing a specific farm
        const farmsTable = document.querySelector('#farms-table')?.closest('.card');
        if (farmsTable) {
            farmsTable.style.display = 'none';
        }
        
        // Update KPIs with farm-specific metrics
        const metrics = farm.metrics || {};
        
        // Update room count
        const kpiRooms = document.getElementById('kpi-rooms');
        if (kpiRooms) {
            kpiRooms.textContent = metrics.room_count || '0';
        }
        
        // Update zone count (reuse farms KPI for zones)
        const kpiFarms = document.getElementById('kpi-farms');
        const kpiFarmsChange = document.getElementById('kpi-farms-change');
        if (kpiFarms) {
            kpiFarms.textContent = metrics.zone_count || '0';
        }
        if (kpiFarmsChange) {
            kpiFarmsChange.textContent = 'Zones';
        }
        
        // Update device count (reuse users KPI for devices)
        const kpiUsers = document.getElementById('kpi-users');
        const kpiUsersChange = document.getElementById('kpi-users-change');
        if (kpiUsers) {
            kpiUsers.textContent = metrics.device_count || '0';
        }
        if (kpiUsersChange) {
            kpiUsersChange.textContent = 'Devices';
        }
        
        // Update alerts (reuse alerts KPI)
        const kpiAlerts = document.getElementById('kpi-alerts');
        if (kpiAlerts) {
            kpiAlerts.textContent = metrics.active_alerts || '0';
        }
        
        // Update farm status card
        const statusCard = document.querySelector('#farm-status-card .card-content');
        if (statusCard) {
            statusCard.innerHTML = `
                <div class="stat-item">
                    <div class="stat-label">Trays</div>
                    <div class="stat-value">${metrics.tray_count || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Plants (est.)</div>
                    <div class="stat-value">${metrics.plant_count || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Users</div>
                    <div class="stat-value">${metrics.user_count || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Status</div>
                    <div class="stat-value"><span class="badge badge-${farm.status === 'active' ? 'success' : 'warning'}">${farm.status || 'unknown'}</span></div>
                </div>
            `;
        }
        
    } catch (error) {
        console.error('Error loading farm dashboard:', error);
        showToast('Failed to load farm data', 'error');
    }
}

/**
 * Load rooms view filtered for a specific farm
 */
async function loadFarmRoomsView(farmId) {
    console.log(`Loading rooms for farm: ${farmId}`);
    currentFarmId = farmId;
    
    try {
        // Fetch farm-specific rooms from backend
        const response = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/rooms`);
        const data = await response.json();
        
        console.log('Farm rooms:', data);
        
        const rooms = data.rooms || [];
        
        // Update page header
        const header = document.querySelector('#rooms-view .header h1');
        if (header) {
            header.textContent = 'Farm Rooms';
        }
        
        // Render rooms table
        const tableBody = document.querySelector('#rooms-table');
        if (!tableBody) {
            console.error('Rooms table not found');
            return;
        }
        
        if (rooms.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="8" class="text-center">No rooms found for this farm</td></tr>';
            return;
        }
        
        tableBody.innerHTML = rooms.map(room => `
            <tr>
                <td>${room.farm_id || farmId}</td>
                <td><a href="#" onclick="navigateToRoom('${farmId}', '${room.room_id}'); return false;" class="link">${room.name}</a></td>
                <td>${room.type || 'grow'}</td>
                <td>${room.temperature ? room.temperature + '°F' : 'N/A'}</td>
                <td>${room.humidity ? room.humidity + '%' : 'N/A'}</td>
                <td>${room.co2 ? room.co2 + ' ppm' : 'N/A'}</td>
                <td>${room.vpd ? room.vpd : 'N/A'}</td>
                <td><span class="badge badge-${room.status === 'optimal' ? 'success' : (room.status === 'warning' ? 'warning' : 'secondary')}">${room.status || 'active'}</span></td>
            </tr>
        `).join('');
        
    } catch (error) {
        console.error('Error loading farm rooms:', error);
        showToast('Failed to load rooms', 'error');
    }
}

/**
 * Load devices view filtered for a specific farm
 */
async function loadFarmDevicesView(farmId) {
    console.log(`Loading devices for farm: ${farmId}`);
    currentFarmId = farmId;
    
    try {
        // Fetch farm-specific devices from backend
        const response = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/devices`);
        const data = await response.json();
        
        console.log('Farm devices:', data);
        
        const devices = data.devices || [];
        
        // Update page header
        const header = document.querySelector('#devices-view .header h1');
        if (header) {
            header.textContent = 'Farm Devices';
        }
        
        // Render devices table
        const tableBody = document.querySelector('#devices-table');
        if (!tableBody) {
            console.error('Devices table not found');
            return;
        }
        
        if (devices.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="8" class="text-center">No devices found for this farm</td></tr>';
            return;
        }
        
        tableBody.innerHTML = devices.map(device => `
            <tr>
                <td>${device.farm_id || farmId}</td>
                <td>${device.device_code || device.device_id}</td>
                <td>${device.device_name || 'Unnamed Device'}</td>
                <td>${device.device_type || 'Unknown'}</td>
                <td>${device.vendor || 'N/A'}</td>
                <td>${device.model || 'N/A'}</td>
                <td>${device.firmware_version || 'N/A'}</td>
                <td><span class="badge badge-${device.status === 'online' ? 'success' : (device.status === 'offline' ? 'danger' : 'secondary')}">${device.status || 'unknown'}</span></td>
            </tr>
        `).join('');
        
    } catch (error) {
        console.error('Error loading farm devices:', error);
        showToast('Failed to load devices', 'error');
    }
}

/**
 * Load inventory view filtered for a specific farm
 */
async function loadFarmInventoryView(farmId) {
    console.log(`Loading inventory for farm: ${farmId}`);
    currentFarmId = farmId;
    
    try {
        // Load inventory data
        const response = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/inventory`);
        if (response && response.ok) {
            const data = await response.json();
            // Render farm-specific inventory
            console.log('Farm inventory:', data);
        }
    } catch (error) {
        console.error('Error loading farm inventory:', error);
    }
}

/**
 * Load recipes view filtered for a specific farm
 */
async function loadFarmRecipesView(farmId) {
    console.log(`Loading recipes for farm: ${farmId}`);
    currentFarmId = farmId;
    
    try {
        await loadAllRecipesView();
        
        // Filter recipes for this farm
        const recipeCards = document.querySelectorAll('.recipe-card');
        recipeCards.forEach(card => {
            const farmIdAttr = card.getAttribute('data-farm-id');
            if (farmIdAttr && farmIdAttr !== farmId) {
                card.style.display = 'none';
            }
        });
    } catch (error) {
        console.error('Error loading farm recipes:', error);
    }
}

/**
 * Load environmental view filtered for a specific farm
 */
async function loadFarmEnvironmentalView(farmId) {
    console.log(`Loading environmental data for farm: ${farmId}`);
    currentFarmId = farmId;
    
    try {
        await loadEnvironmentalView();
        // Additional farm-specific filtering if needed
    } catch (error) {
        console.error('Error loading farm environmental data:', error);
    }
}

/**
 * Load energy dashboard filtered for a specific farm
 */
async function loadFarmEnergyDashboard(farmId) {
    console.log(`Loading energy dashboard for farm: ${farmId}`);
    currentFarmId = farmId;
    
    try {
        await loadEnergyDashboard();
        // Filter energy data for this farm
    } catch (error) {
        console.error('Error loading farm energy dashboard:', error);
    }
}

/**
 * Load alerts view filtered for a specific farm
 */
async function loadFarmAlertsView(farmId) {
    console.log(`Loading alerts for farm: ${farmId}`);
    currentFarmId = farmId;
    
    try {
        await loadAlertsView();
        
        // Filter alerts table
        const alertRows = document.querySelectorAll('#alerts-table tr');
        alertRows.forEach(row => {
            const farmIdCell = row.cells[0];
            if (farmIdCell && farmIdCell.textContent !== farmId) {
                row.style.display = 'none';
            }
        });
    } catch (error) {
        console.error('Error loading farm alerts:', error);
    }
}
    document.getElementById('analytics-revenue-avg').textContent = `$${(summary.totalRevenue / summary.daysReported).toFixed(2)}/day avg`;
    
    // Profit
    const profitMargin = summary.totalRevenue > 0 ? ((summary.netProfit / summary.totalRevenue) * 100).toFixed(1) : 0;
    document.getElementById('analytics-profit').textContent = `$${summary.netProfit.toFixed(2)}`;
    document.getElementById('analytics-profit-margin').textContent = `${profitMargin}% margin`;
    
    // Efficiency
    document.getElementById('analytics-efficiency').textContent = `${summary.avgEfficiency.toFixed(1)}%`;
    document.getElementById('analytics-efficiency-trend').textContent = 'Optimal range';
    
    // Trays
    const traysHarvested = analyticsData.metrics.reduce((sum, m) => sum + (m.trays_harvested || 0), 0);
    const traysSeeded = analyticsData.metrics.reduce((sum, m) => sum + (m.trays_seeded || 0), 0);
    document.getElementById('analytics-trays-harvested').textContent = traysHarvested;
    document.getElementById('analytics-trays-seeded').textContent = `${traysSeeded} seeded`;
    
    // Orders
    document.getElementById('analytics-orders').textContent = summary.totalOrders;
    document.getElementById('analytics-orders-avg').textContent = `${(summary.totalOrders / summary.daysReported).toFixed(1)}/day avg`;
    
    // Update days count
    document.getElementById('analytics-days-count').textContent = `Last ${summary.daysReported} days`;
}

/**
 * Render analytics metrics table
 */
function renderAnalyticsMetricsTable(metrics) {
    const tbody = document.getElementById('analytics-metrics-tbody');
    
    if (metrics.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 40px; color: var(--text-secondary);">No metrics data available.</td></tr>';
        return;
    }
    
    tbody.innerHTML = metrics.map(m => {
        const date = new Date(m.date);
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const profit = parseFloat(m.revenue) - parseFloat(m.costs);
        const profitClass = profit >= 0 ? 'positive' : 'negative';
        
        return `
            <tr>
                <td><strong>${dateStr}</strong></td>
                <td>${parseFloat(m.production_kg).toFixed(1)} kg</td>
                <td>$${parseFloat(m.revenue).toFixed(2)}</td>
                <td>$${parseFloat(m.costs).toFixed(2)}</td>
                <td class="${profitClass}">$${profit.toFixed(2)}</td>
                <td><span class="badge badge-success">${parseFloat(m.efficiency_score).toFixed(1)}%</span></td>
                <td>${m.trays_seeded}</td>
                <td>${m.trays_harvested}</td>
                <td>${m.orders_fulfilled}</td>
            </tr>
        `;
    }).join('');
}

// ============================================================================
// RECIPES MANAGEMENT FUNCTIONS
// ============================================================================

// recipesData already declared as global variable at top of file
let currentRecipeId = null;
let recipeSpectrumChart = null;

/**
 * Load and display recipes
 */
async function loadRecipes() {
    console.log('[Recipes] loadRecipes() called');
    try {
        const category = document.getElementById('recipe-category-filter')?.value || '';
        const search = document.getElementById('recipe-search')?.value || '';
        
        const params = new URLSearchParams();
        if (category) params.append('category', category);
        if (search) params.append('search', search);
        params.append('limit', '100');
        
        console.log('[Recipes] Fetching:', `/api/admin/recipes?${params.toString()}`);
        const response = await authenticatedFetch(`/api/admin/recipes?${params.toString()}`);
        
        // Check if authentication failed
        if (!response) {
            console.error('[Recipes] No response - authentication failed');
            throw new Error('Authentication required. Please log in again.');
        }
        
        console.log('[Recipes] Response status:', response.status);
        const data = await response.json();
        console.log('[Recipes] Data received:', data);
        
        if (!data.ok) {
            throw new Error(data.error || 'Failed to load recipes');
        }
        
        recipesData = data.recipes || [];
        console.log('[Recipes] Loaded', recipesData.length, 'recipes');
        renderRecipesTable(recipesData);
        updateRecipeStats(recipesData);
        
    } catch (error) {
        console.error('[Recipes] Error loading recipes:', error);
        const tbody = document.getElementById('recipes-tbody');
        if (tbody) {
            tbody.innerHTML = `
                <tr><td colspan="8" style="text-align: center; padding: 40px; color: var(--accent-red);">
                    Error loading recipes: ${error.message}
                </td></tr>
            `;
        }
    }
}

/**
 * Render recipes table
 */
function renderRecipesTable(recipes) {
    const tbody = document.getElementById('recipes-tbody');
    
    if (recipes.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="6" style="text-align: center; padding: 40px; color: var(--text-secondary);">
                No recipes found
            </td></tr>
        `;
        return;
    }
    
    tbody.innerHTML = recipes.map(recipe => {
        const stages = recipe.schedule_length || 0;
        
        // Get average temperature from schedule
        let avgTemp = 'N/A';
        if (recipe.data && recipe.data.schedule && recipe.data.schedule.length > 0) {
            const temps = recipe.data.schedule
                .map(day => {
                    const temp = day.temperature || day.tempC || day.afternoon_temp;
                    return typeof temp === 'string' ? parseFloat(temp) : temp;
                })
                .filter(t => !isNaN(t) && t > 0);
            
            if (temps.length > 0) {
                const sum = temps.reduce((a, b) => a + b, 0);
                avgTemp = `${(sum / temps.length).toFixed(1)}°C`;
            }
        }
        
        return `
            <tr>
                <td>
                    <div style="font-weight: 500;">${recipe.name}</div>
                    <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 4px;">${recipe.description || ''}</div>
                </td>
                <td>
                    <span class="badge" style="background: ${getCategoryColor(recipe.category)}; padding: 4px 8px; border-radius: 4px; font-size: 0.85rem;">
                        ${recipe.category}
                    </span>
                </td>
                <td>${recipe.total_days || 0} days</td>
                <td>${stages} entries</td>
                <td style="font-size: 0.85rem;">${avgTemp}</td>
                <td>
                    <div style="display: flex; gap: 8px;">
                        <button onclick="viewRecipe(${recipe.id})" class="btn btn-sm" style="padding: 4px 8px; font-size: 0.85rem;">View</button>
                        <button onclick="editRecipe(${recipe.id})" class="btn btn-sm" style="padding: 4px 8px; font-size: 0.85rem;">Edit</button>
                        <button onclick="deleteRecipe(${recipe.id}, '${recipe.name}')" class="btn btn-sm" style="padding: 4px 8px; font-size: 0.85rem; background: var(--accent-red);">Delete</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    document.getElementById('recipes-count').textContent = `${recipes.length} recipe${recipes.length !== 1 ? 's' : ''}`;
}

/**
 * Update recipe statistics
 */
function updateRecipeStats(recipes) {
    const stats = {
        total: recipes.length,
        leafy: recipes.filter(r => r.category === 'Leafy Greens').length,
        herbs: recipes.filter(r => r.category === 'Herbs').length,
        fruiting: recipes.filter(r => r.category === 'Fruiting Crops').length
    };
    
    document.getElementById('recipe-total').textContent = stats.total;
    document.getElementById('recipe-leafy').textContent = stats.leafy;
    document.getElementById('recipe-herbs').textContent = stats.herbs;
    document.getElementById('recipe-fruiting').textContent = stats.fruiting;
}

/**
 * Get category color
 */
function getCategoryColor(category) {
    const colors = {
        'Leafy Greens': '#10b981',
        'Herbs': '#8b5cf6',
        'Fruiting Crops': '#f59e0b',
        'Other': '#6b7280'
    };
    return colors[category] || colors['Other'];
}

/**
 * Filter recipes
 */
function filterRecipes() {
    loadRecipes();
}

// Store current recipe being viewed/edited for export
let currentRecipeData = null;

/**
 * Export current recipe to CSV/Excel format
 */
function exportCurrentRecipe() {
    if (!currentRecipeData) {
        alert('No recipe data available. Please try opening the recipe again.');
        return;
    }
    
    const recipe = currentRecipeData;
    console.log('[Export] Exporting recipe:', recipe.name);
    
    // Create CSV header with all v2 format columns
    let csv = 'Day,Stage,DLI Target (mol/m²/d),Temp Target (°C),Blue (%),Green (%),Red (%),Far-Red (%),';
    csv += 'PPFD Target (µmol/m²/s),VPD Target (kPa),Max Humidity (%),EC Target (dS/m),pH Target,';
    csv += 'Light Hours,Veg,Fruit\n';
    
    const schedule = recipe.data?.schedule || [];
    
    if (schedule.length === 0) {
        alert('This recipe has no schedule data to export.');
        return;
    }
    
    // Add each day's detailed data
    schedule.forEach((day, index) => {
        const dayNum = day.day || (index + 1);
        const stage = escapeCsv(day.stage_name || day.stage || '');
        const dli = day.dli_target || '';
        const temp = day.temperature || day.tempC || day.afternoon_temp || '';
        const blue = day.blue || '';
        const green = day.green || '';
        const red = day.red || '';
        const farRed = day.far_red || '';
        const ppfd = day.ppfd || '';
        const vpd = day.vpd_target || '';
        const maxHumidity = day.max_humidity || '';
        const ec = day.ec || '';
        const ph = day.ph || '';
        const light = day.light_hours || day.daylength || '';
        const veg = day.veg !== undefined ? day.veg : '';
        const fruit = day.fruit !== undefined ? day.fruit : '';
        
        csv += `${dayNum},${stage},${dli},${temp},${blue},${green},${red},${farRed},`;
        csv += `${ppfd},${vpd},${maxHumidity},${ec},${ph},${light},${veg},${fruit}\n`;
    });
    
    // Create blob and download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    const timestamp = new Date().toISOString().split('T')[0];
    const safeName = recipe.name.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${safeName}_Recipe_${timestamp}.csv`;
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    console.log('[Export] Download initiated:', filename);
}

/**
 * Escape CSV field values
 */
function escapeCsv(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    // If contains comma, quote, or newline, wrap in quotes and escape quotes
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

/**
 * View recipe details (read-only modal)
 */
async function viewRecipe(recipeId) {
    try {
        const response = await authenticatedFetch(`/api/admin/recipes/${recipeId}`);
        const data = await response.json();
        
        if (!data.ok) {
            throw new Error(data.error || 'Failed to load recipe');
        }
        
        const recipe = data.recipe;
        const schedule = recipe.data?.schedule || [];
        
        // Store recipe data for export
        currentRecipeData = recipe;
        
        // Update modal header
        document.getElementById('recipe-view-title').textContent = recipe.name;
        document.getElementById('recipe-view-category').textContent = recipe.category;
        document.getElementById('recipe-view-days').textContent = recipe.total_days || schedule.length;
        
        // Render schedule table
        const tbody = document.getElementById('recipe-view-schedule');
        tbody.innerHTML = schedule.map(day => `
            <tr>
                <td>${day.day.toFixed(1) || ''}</td>
                <td>${day.stage || ''}</td>
                <td>${day.dli_target ? day.dli_target.toFixed(2) : ''}</td>
                <td>${day.temperature || day.tempC || day.afternoon_temp || ''}</td>
                <td>${day.vpd_target ? day.vpd_target.toFixed(2) : ''}</td>
                <td>${day.max_humidity || ''}</td>
                <td>${day.blue || 0}</td>
                <td>${day.green || 0}</td>
                <td>${day.red || 0}</td>
                <td>${day.far_red || 0}</td>
                <td>${day.ppfd ? Math.round(day.ppfd) : 0}</td>
                <td>${day.ec ? day.ec.toFixed(2) : ''}</td>
                <td>${day.ph || ''}</td>
            </tr>
        `).join('');
        
        // Draw spectrum chart
        drawSpectrumChart(schedule);
        
        // Show modal
        document.getElementById('recipe-view-modal').style.display = 'block';
        
    } catch (error) {
        console.error('Error viewing recipe:', error);
        alert('Failed to load recipe details: ' + error.message);
    }
}

/**
 * Draw spectrum visualization chart
 */
function drawSpectrumChart(schedule) {
    const ctx = document.getElementById('recipe-spectrum-chart');
    
    if (recipeSpectrumChart) {
        recipeSpectrumChart.destroy();
    }
    
    // Sample every 5th day for visualization
    const sampleRate = Math.max(1, Math.floor(schedule.length / 50));
    const sampledSchedule = schedule.filter((_, i) => i % sampleRate === 0);
    
    recipeSpectrumChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: sampledSchedule.map(d => `Day ${d.day}`),
            datasets: [
                {
                    label: 'Blue %',
                    data: sampledSchedule.map(d => d.blue || 0),
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    tension: 0.4
                },
                {
                    label: 'Green %',
                    data: sampledSchedule.map(d => d.green || 0),
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    tension: 0.4
                },
                {
                    label: 'Red %',
                    data: sampledSchedule.map(d => d.red || 0),
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    tension: 0.4
                },
                {
                    label: 'Far-Red %',
                    data: sampledSchedule.map(d => d.far_red || 0),
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: '#e5e7eb' }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: { color: '#9ca3af' },
                    grid: { color: '#2d3748' }
                },
                x: {
                    ticks: { color: '#9ca3af' },
                    grid: { color: '#2d3748' }
                }
            }
        }
    });
}

/**
 * Close recipe view modal
 */
function closeRecipeViewModal() {
    document.getElementById('recipe-view-modal').style.display = 'none';
    if (recipeSpectrumChart) {
        recipeSpectrumChart.destroy();
        recipeSpectrumChart = null;
    }
}

/**
 * Open add recipe modal
 */
function openAddRecipeModal() {
    currentRecipeId = null;
    document.getElementById('recipe-modal-title').textContent = 'Add New Recipe';
    document.getElementById('recipe-form').reset();
    document.getElementById('schedule-container').innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">No schedule days added yet</p>';
    document.getElementById('recipe-modal').style.display = 'block';
}

/**
 * Edit recipe
 */
async function editRecipe(recipeId) {
    try {
        const response = await authenticatedFetch(`/api/admin/recipes/${recipeId}`);
        const data = await response.json();
        
        if (!data.ok) {
            throw new Error(data.error || 'Failed to load recipe');
        }
        
        const recipe = data.recipe;
        currentRecipeId = recipeId;
        
        // Store recipe data for export
        currentRecipeData = recipe;
        
        document.getElementById('recipe-modal-title').textContent = 'Edit Recipe';
        document.getElementById('recipe-name').value = recipe.name;
        document.getElementById('recipe-category').value = recipe.category;
        document.getElementById('recipe-description').value = recipe.description || '';
        
        // Render schedule
        const schedule = recipe.data?.schedule || [];
        scheduleData = JSON.parse(JSON.stringify(schedule)); // Deep copy
        renderScheduleEditor(scheduleData);
        
        document.getElementById('recipe-modal').style.display = 'block';
        
    } catch (error) {
        console.error('Error loading recipe:', error);
        alert('Failed to load recipe: ' + error.message);
    }
}

/**
 * Render schedule editor
 */
function renderScheduleEditor(schedule) {
    const container = document.getElementById('schedule-container');
    
    if (schedule.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">No schedule days added yet</p>';
        return;
    }
    
    container.innerHTML = schedule.map((day, index) => `
        <div class="schedule-day" style="background: var(--bg-card); padding: 16px; border-radius: 6px; margin-bottom: 12px; border: 1px solid var(--border);">
            <div style="display: flex; justify-content: between; margin-bottom: 12px;">
                <h4 style="margin: 0; font-size: 14px;">Day ${day.day} - ${day.stage || 'Unnamed'}</h4>
                <button type="button" onclick="removeScheduleDay(${index})" style="background: var(--accent-red); color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;">Remove</button>
            </div>
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; font-size: 13px;">
                <div>
                    <label style="display: block; margin-bottom: 4px; color: var(--text-secondary);">Day</label>
                    <input type="number" value="${day.day}" data-index="${index}" data-field="day" onchange="updateScheduleDay(this)" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-primary);">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 4px; color: var(--text-secondary);">Stage</label>
                    <input type="text" value="${day.stage || ''}" data-index="${index}" data-field="stage" onchange="updateScheduleDay(this)" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-primary);">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 4px; color: var(--text-secondary);">Temp (°C)</label>
                    <input type="text" value="${day.temperature || ''}" data-index="${index}" data-field="temperature" onchange="updateScheduleDay(this)" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-primary);">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 4px; color: var(--text-secondary);">PPFD</label>
                    <input type="number" value="${day.ppfd || 0}" data-index="${index}" data-field="ppfd" onchange="updateScheduleDay(this)" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-primary);">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 4px; color: var(--text-secondary);">Blue %</label>
                    <input type="number" value="${day.blue || 0}" data-index="${index}" data-field="blue" onchange="updateScheduleDay(this)" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-primary);">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 4px; color: var(--text-secondary);">Green %</label>
                    <input type="number" value="${day.green || 0}" data-index="${index}" data-field="green" onchange="updateScheduleDay(this)" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-primary);">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 4px; color: var(--text-secondary);">Red %</label>
                    <input type="number" value="${day.red || 0}" data-index="${index}" data-field="red" onchange="updateScheduleDay(this)" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-primary);">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 4px; color: var(--text-secondary);">Far-Red %</label>
                    <input type="number" value="${day.far_red || 0}" data-index="${index}" data-field="far_red" onchange="updateScheduleDay(this)" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-primary);">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 4px; color: var(--text-secondary);">VPD (kPa)</label>
                    <input type="number" step="0.1" value="${day.vpd || 0}" data-index="${index}" data-field="vpd" onchange="updateScheduleDay(this)" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-primary);">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 4px; color: var(--text-secondary);">Humidity %</label>
                    <input type="number" value="${day.max_humidity || 0}" data-index="${index}" data-field="max_humidity" onchange="updateScheduleDay(this)" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-primary);">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 4px; color: var(--text-secondary);">EC</label>
                    <input type="number" step="0.01" value="${day.ec || 0}" data-index="${index}" data-field="ec" onchange="updateScheduleDay(this)" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-primary);">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 4px; color: var(--text-secondary);">pH</label>
                    <input type="number" step="0.1" value="${day.ph || 0}" data-index="${index}" data-field="ph" onchange="updateScheduleDay(this)" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-primary);">
                </div>
            </div>
        </div>
    `).join('');
}

let scheduleData = [];

/**
 * Update schedule day
 */
function updateScheduleDay(input) {
    const index = parseInt(input.dataset.index);
    const field = input.dataset.field;
    const value = input.type === 'number' ? parseFloat(input.value) || 0 : input.value;
    
    if (!scheduleData[index]) {
        scheduleData[index] = {};
    }
    
    scheduleData[index][field] = value;
}

/**
 * Add schedule day
 */
function addScheduleDay() {
    const newDay = {
        day: scheduleData.length + 1,
        stage: 'New Stage',
        temperature: '20',
        blue: 30,
        green: 5,
        red: 50,
        far_red: 5,
        ppfd: 200,
        vpd: 0.8,
        max_humidity: 70,
        ec: 1.5,
        ph: 6.0
    };
    
    scheduleData.push(newDay);
    renderScheduleEditor(scheduleData);
}

/**
 * Remove schedule day
 */
function removeScheduleDay(index) {
    scheduleData.splice(index, 1);
    renderScheduleEditor(scheduleData);
}

/**
 * Save recipe
 */
async function saveRecipe(event) {
    event.preventDefault();
    
    try {
        const name = document.getElementById('recipe-name').value.trim();
        const category = document.getElementById('recipe-category').value;
        const description = document.getElementById('recipe-description').value.trim();
        
        if (!name || !category) {
            alert('Please fill in all required fields');
            return;
        }
        
        if (scheduleData.length === 0) {
            alert('Please add at least one schedule day');
            return;
        }
        
        const totalDays = Math.max(...scheduleData.map(d => d.day));
        
        const payload = {
            name,
            category,
            description,
            total_days: totalDays,
            data: {
                schedule: scheduleData,
                version: '1.0'
            }
        };
        
        const url = currentRecipeId 
            ? `/api/admin/recipes/${currentRecipeId}`
            : '/api/admin/recipes';
        
        const method = currentRecipeId ? 'PUT' : 'POST';
        
        const response = await authenticatedFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (!data.ok) {
            throw new Error(data.error || 'Failed to save recipe');
        }
        
        alert(`Recipe ${currentRecipeId ? 'updated' : 'created'} successfully!`);
        closeRecipeModal();
        loadRecipes();
        
    } catch (error) {
        console.error('Error saving recipe:', error);
        alert('Failed to save recipe: ' + error.message);
    }
}

/**
 * Delete recipe
 */
async function deleteRecipe(recipeId, recipeName) {
    if (!confirm(`Are you sure you want to delete the recipe "${recipeName}"? This action cannot be undone.`)) {
        return;
    }
    
    try {
        const response = await authenticatedFetch(`/api/admin/recipes/${recipeId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (!data.ok) {
            throw new Error(data.error || 'Failed to delete recipe');
        }
        
        alert('Recipe deleted successfully');
        loadRecipes();
        
    } catch (error) {
        console.error('Error deleting recipe:', error);
        alert('Failed to delete recipe: ' + error.message);
    }
}

/**
 * Close recipe modal
 */
function closeRecipeModal() {
    document.getElementById('recipe-modal').style.display = 'none';
    currentRecipeId = null;
    scheduleData = [];
}

// ============================================================================
// PLATFORM MONITORING (LIGHT ENGINE FLEET) FUNCTIONS
// ============================================================================

/**
 * Load Platform Monitoring dashboard (Light Engine fleet)
 */
async function loadPlatformMonitoring() {
    console.log('[Platform] Loading Light Engine fleet monitoring...');
    
    try {
        // In production, fetch from Light Engine fleet API
        // For now, show static data matching LE-admin.html
        
        // Update KPIs
        document.getElementById('platform-farms').textContent = '24';
        document.getElementById('platform-mrr').textContent = '$4,847';
        document.getElementById('platform-zones').textContent = '312';
        document.getElementById('platform-sensors').textContent = '1,247';
        document.getElementById('platform-health').textContent = '87';
        document.getElementById('platform-alerts').textContent = '12';
        
        // Deployments table already has static data in HTML
        // In production, fetch and render from API
        
        console.log('[Platform] Platform monitoring loaded');
    } catch (error) {
        console.error('[Platform] Error loading platform monitoring:', error);
        showToast('Failed to load platform monitoring data', 'error');
    }
}

/**
 * ============================================
 * USER MANAGEMENT FUNCTIONS
 * ============================================
 */

let allUsers = [];
let deleteUserId = null;

/**
 * Load and display users
 */
async function loadUsersView() {
    try {
        const response = await apiRequest('/api/admin/users', {
            method: 'GET'
        });
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Failed to load users');
        }
        
        allUsers = data.users || [];
        renderUsers(allUsers);
        updateUserStats(allUsers);
        
    } catch (error) {
        console.error('Error loading users:', error);
        document.getElementById('users-tbody').innerHTML = `
            <tr><td colspan="6" style="text-align: center; padding: 40px; color: var(--accent-red);">
                Failed to load users: ${error.message}
            </td></tr>
        `;
    }
}

/**
 * Render users table
 */
function renderUsers(users) {
    const tbody = document.getElementById('users-tbody');
    const count = document.getElementById('users-count');
    
    count.textContent = `${users.length} ${users.length === 1 ? 'employee' : 'employees'}`;
    
    if (users.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="6" style="text-align: center; padding: 40px; color: var(--text-secondary);">
                No employees found. Click "Add Employee" to create your first user.
            </td></tr>
        `;
        return;
    }
    
    tbody.innerHTML = users.map(user => {
        const statusBadge = user.status === 'active' 
            ? '<span class="badge badge-success">Active</span>' 
            : '<span class="badge badge-default">Inactive</span>';
            
        const roleBadge = {
            'admin': '<span class="badge badge-danger">Admin</span>',
            'operations': '<span class="badge badge-primary">Operations</span>',
            'support': '<span class="badge badge-info">Support</span>',
            'viewer': '<span class="badge badge-default">Viewer</span>'
        }[user.role] || `<span class="badge">${user.role}</span>`;
        
        const lastLogin = user.last_login 
            ? new Date(user.last_login).toLocaleDateString() 
            : 'Never';
            
        return `
            <tr>
                <td><strong>${user.first_name} ${user.last_name}</strong></td>
                <td>${user.email}</td>
                <td>${roleBadge}</td>
                <td>${statusBadge}</td>
                <td>${lastLogin}</td>
                <td>
                    <button class="btn-icon" onclick="editUser(${user.user_id})" title="Edit">
                        <span style="font-size: 18px;">✏️</span>
                    </button>
                    <button class="btn-icon" onclick="deleteUser(${user.user_id}, '${user.first_name} ${user.last_name}')" title="Delete">
                        <span style="font-size: 18px;">🗑️</span>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Update user statistics
 */
function updateUserStats(users) {
    document.getElementById('users-total').textContent = users.length;
    document.getElementById('users-active').textContent = users.filter(u => u.status === 'active').length;
    document.getElementById('users-admins').textContent = users.filter(u => u.role === 'admin').length;
    document.getElementById('users-ops').textContent = users.filter(u => u.role === 'operations').length;
}

/**
 * Filter users by search
 */
function filterUsers() {
    const searchTerm = document.getElementById('user-search').value.toLowerCase();
    
    const filtered = allUsers.filter(user => {
        return user.first_name.toLowerCase().includes(searchTerm) ||
               user.last_name.toLowerCase().includes(searchTerm) ||
               user.email.toLowerCase().includes(searchTerm) ||
               user.role.toLowerCase().includes(searchTerm);
    });
    
    renderUsers(filtered);
}

/**
 * Open add user modal
 */
function openAddUserModal() {
    document.getElementById('user-modal-title').textContent = 'Add New Employee';
    document.getElementById('user-save-btn-text').textContent = 'Create Employee';
    document.getElementById('user-form').reset();
    document.getElementById('user-id').value = '';
    document.getElementById('password-field').style.display = 'block';
    document.getElementById('user-modal').style.display = 'flex';
}

/**
 * Edit user
 */
function editUser(userId) {
    const user = allUsers.find(u => u.user_id === userId);
    if (!user) return;
    
    document.getElementById('user-modal-title').textContent = 'Edit Employee';
    document.getElementById('user-save-btn-text').textContent = 'Save Changes';
    document.getElementById('user-id').value = user.user_id;
    document.getElementById('user-first-name').value = user.first_name;
    document.getElementById('user-last-name').value = user.last_name;
    document.getElementById('user-email').value = user.email;
    document.getElementById('user-role').value = user.role;
    document.getElementById('password-field').style.display = 'none';
    document.getElementById('user-modal').style.display = 'flex';
}

/**
 * Close user modal
 */
function closeUserModal() {
    document.getElementById('user-modal').style.display = 'none';
    document.getElementById('user-form').reset();
}

/**
 * Save user (create or update)
 */
async function saveUser(event) {
    event.preventDefault();
    
    const userId = document.getElementById('user-id').value;
    const formData = {
        first_name: document.getElementById('user-first-name').value.trim(),
        last_name: document.getElementById('user-last-name').value.trim(),
        email: document.getElementById('user-email').value.trim(),
        role: document.getElementById('user-role').value
    };
    
    // Add password for new users
    if (!userId) {
        const password = document.getElementById('user-password').value.trim();
        if (password) {
            formData.password = password;
        }
    }
    
    try {
        const url = userId ? `/api/admin/users/${userId}` : '/api/admin/users';
        const method = userId ? 'PUT' : 'POST';
        
        const response = await apiRequest(url, {
            method: method,
            body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Failed to save user');
        }
        
        // Show temp password if generated
        if (data.user?.temporary_password) {
            alert(`User created successfully!\n\nTemporary password: ${data.user.temporary_password}\n\nPlease save this password and share it securely with the user.`);
        } else {
            alert(userId ? 'User updated successfully!' : 'User created successfully!');
        }
        
        closeUserModal();
        await loadUsersView();
        
    } catch (error) {
        console.error('Error saving user:', error);
        alert(`Failed to save user: ${error.message}`);
    }
}

/**
 * Delete user (show confirmation)
 */
function deleteUser(userId, userName) {
    deleteUserId = userId;
    document.getElementById('delete-user-name').textContent = userName;
    document.getElementById('delete-user-modal').style.display = 'flex';
}

/**
 * Close delete modal
 */
function closeDeleteUserModal() {
    document.getElementById('delete-user-modal').style.display = 'none';
    deleteUserId = null;
}

/**
 * Confirm delete user
 */
async function confirmDeleteUser() {
    if (!deleteUserId) return;
    
    try {
        const response = await apiRequest(`/api/admin/users/${deleteUserId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Failed to delete user');
        }
        
        alert('User deleted successfully!');
        closeDeleteUserModal();
        await loadUsersView();
        
    } catch (error) {
        console.error('Error deleting user:', error);
        alert(`Failed to delete user: ${error.message}`);
    }
}


// Initialize on load
console.log('Central Admin loaded');

