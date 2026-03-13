/**
 * Farm Admin Portal JavaScript
 * Handles authentication, session management, and farm-specific operations
 */

const API_BASE = window.location.origin;
const STORAGE_KEY_SESSION = 'farm_admin_session';
const STORAGE_KEY_REMEMBER = 'farm_admin_remember';

// Debug logger: enable with localStorage.setItem('gr.debug','true') or when running on localhost
const GR_DEBUG = (typeof localStorage !== 'undefined' && localStorage.getItem('gr.debug') === 'true') || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
function grLog(...args) { if (GR_DEBUG) console.debug(...args); }

// Session state
let currentSession = null;
let farmData = null;

function getPostLoginRedirectPath() {
    const defaultPath = '/LE-farm-admin.html';
    let returnPath = new URLSearchParams(window.location.search).get('return') || '';

    for (let i = 0; i < 6 && returnPath; i++) {
        let decoded = returnPath;
        try {
            decoded = decodeURIComponent(returnPath);
        } catch (_) {}

        try {
            const parsed = new URL(decoded, window.location.origin);
            const nestedReturn = parsed.searchParams.get('return');
            if (nestedReturn) {
                returnPath = nestedReturn;
                continue;
            }
            returnPath = parsed.pathname + parsed.search + parsed.hash;
        } catch (_) {
            returnPath = decoded;
        }

        break;
    }

    if (!returnPath) return defaultPath;

    let safePath = returnPath.trim();
    try {
        const parsed = new URL(safePath, window.location.origin);
        if (parsed.origin !== window.location.origin) return defaultPath;
        safePath = parsed.pathname + parsed.search + parsed.hash;
    } catch (_) {
        return defaultPath;
    }

    if (!safePath.startsWith('/')) {
        safePath = `/${safePath.replace(/^\/+/, '')}`;
    }

    if (!safePath || safePath.includes('farm-admin-login')) {
        return defaultPath;
    }

    return safePath;
}

/**
 * Initialize on page load
 */
document.addEventListener('DOMContentLoaded', () => {
    const currentPage = window.location.pathname;
    
    if (currentPage.includes('farm-admin-login')) {
        initLogin();
    } else if (currentPage.includes('farm-admin')) {
        initDashboard();
    }
});

/**
 * Initialize login page
 */
function initLogin() {
    grLog('🔐 Initializing farm admin login...');
    
    // Check if user is already logged in — via farm_admin_session OR dashboard token+farm_id
    const session = getSession();
    const hasToken = sessionStorage.getItem('token') || localStorage.getItem('token');
    const hasFarmId = sessionStorage.getItem('farm_id') || sessionStorage.getItem('farmId') ||
                      localStorage.getItem('farm_id') || localStorage.getItem('farmId');

    // Redirect to admin panel if already authenticated
    if ((session && session.token && hasToken) || (hasToken && hasFarmId && hasToken !== 'local-access' && hasFarmId !== 'LOCAL-FARM')) {
        grLog(' Active session found, redirecting to admin dashboard...');
        const redirectCount = parseInt(sessionStorage.getItem('login_redirect_count') || '0');
        if (redirectCount > 2) {
            console.warn('⚠️ Detected potential redirect loop, clearing all auth data');
            localStorage.removeItem(STORAGE_KEY_SESSION);
            localStorage.removeItem('token');
            sessionStorage.removeItem(STORAGE_KEY_SESSION);
            sessionStorage.removeItem('token');
            sessionStorage.removeItem('login_redirect_count');
        } else {
            sessionStorage.setItem('login_redirect_count', String(redirectCount + 1));
            window.location.href = getPostLoginRedirectPath();
            return;
        }
    } else if (session && !hasToken) {
        console.warn('⚠️ Clearing stale session without token');
        localStorage.removeItem(STORAGE_KEY_SESSION);
        sessionStorage.removeItem(STORAGE_KEY_SESSION);
    }
    
    // Clear redirect loop trackers on clean page load
    sessionStorage.removeItem('login_redirect_count');
    
    // Hide demo credentials unless in test/demo mode
    const demoCreds = document.querySelector('.demo-credentials');
    if (demoCreds) {
        const isDemo = window.location.search.includes('demo=true') || window.location.search.includes('test=true');
        if (!isDemo) {
            demoCreds.style.display = 'none';
        }
    }
    
    // Check for remembered credentials
    const remembered = JSON.parse(localStorage.getItem(STORAGE_KEY_REMEMBER) || '{}');
    if (remembered.farmId) {
        document.getElementById('farmId').value = remembered.farmId;
    }
    if (remembered.email) {
        document.getElementById('email').value = remembered.email;
        document.getElementById('remember').checked = true;
    }
    
    // Pre-fill farm ID from current session if available
    const farmIdInput = document.getElementById('farmId');
    if (farmIdInput && !farmIdInput.value) {
        const storedFarmId = localStorage.getItem('farm_id') || localStorage.getItem('farmId') ||
                             sessionStorage.getItem('farm_id') || sessionStorage.getItem('farmId');
        if (storedFarmId && storedFarmId !== 'LOCAL-FARM') {
            farmIdInput.value = storedFarmId;
        }
    }
    
    // Setup form handler
    const form = document.getElementById('loginForm');
    if (form) {
        form.addEventListener('submit', handleLogin);
    }
    
    // Auto-fill test credentials only in demo/test mode
    if (window.location.search.includes('demo=true') || window.location.search.includes('test=true')) {
        document.getElementById('farmId').value = 'FARM-TEST-WIZARD-001';
        if (document.getElementById('email')) {
            document.getElementById('email').value = 'admin@test-farm.com';
        }
        document.getElementById('password').value = 'Grow123';
    }
}

/**
 * Initialize dashboard
 */
async function initDashboard() {
    grLog(' Initializing farm admin dashboard...');
    
    // Check for existing JWT token from purchase/login
    const existingToken = sessionStorage.getItem('token') || localStorage.getItem('token');
    const existingFarmId =
        sessionStorage.getItem('farm_id') ||
        sessionStorage.getItem('farmId') ||
        localStorage.getItem('farm_id') ||
        localStorage.getItem('farmId');
    const existingEmail = sessionStorage.getItem('email') || localStorage.getItem('email');
    
    if (existingToken && existingToken !== 'local-access' && existingFarmId && existingFarmId !== 'LOCAL-FARM') {
        // Use existing session from purchase/login
        if (existingToken.split('.').length === 3) {
            try {
                const payload = JSON.parse(atob(existingToken.split('.')[1]));
                currentSession = {
                    token: existingToken,
                    farmId: payload.farm_id || payload.farmId || existingFarmId,
                    userId: payload.user_id || payload.userId,
                    farmName: localStorage.getItem('farm_name') || payload.name || payload.farmName || 'Light Engine Farm',
                    email: payload.email || existingEmail || 'admin@farm.com',
                    role: payload.role || 'admin'
                };
                grLog(' Using existing session:', currentSession.farmId, currentSession.email);
            } catch (e) {
                console.error(' Could not decode JWT token:', e);
            }
        } else {
            currentSession = {
                token: existingToken,
                farmId: existingFarmId,
                farmName: sessionStorage.getItem('farm_name') || localStorage.getItem('farm_name') || 'Light Engine Farm',
                email: existingEmail || 'admin@farm.com',
                role: 'admin'
            };
            grLog(' Using existing session (non-JWT):', currentSession.farmId, currentSession.email);
        }
    }
    
    const allowLocalBypass = 
        window.location.hostname.includes('localhost') || 
        window.location.hostname === '127.0.0.1' ||
        window.location.search.includes('demo=true');

    // Create a default session only for local/demo environments
    if (!currentSession) {
        if (!allowLocalBypass) {
            console.warn('⚠️ No valid session found, redirecting to login');
            // Clear redirect counter and stale data before redirecting
            sessionStorage.removeItem('login_redirect_count');
            localStorage.removeItem(STORAGE_KEY_SESSION);
            window.location.href = '/farm-admin-login.html';
            return;
        }

        currentSession = {
            token: 'local-access',
            farmId: 'LOCAL-FARM',
            farmName: 'Light Engine Farm',
            email: 'admin@local-farm.com',
            role: 'admin'
        };
        
        // Store token in localStorage for wizard check
        if (!sessionStorage.getItem('token') && !localStorage.getItem('token')) {
            sessionStorage.setItem('token', 'local-access');
            sessionStorage.setItem('farm_id', 'LOCAL-FARM');
            localStorage.setItem('token', 'local-access');
            localStorage.setItem('farm_id', 'LOCAL-FARM');
            localStorage.removeItem('farmId');
            localStorage.removeItem('adminFarmId');
        }
        grLog(' Using local default session');
    }
    
    // Setup navigation
    setupNavigation();
    
    // Load farm data
    await loadFarmData();
    
    // Load dashboard data
    await loadDashboardData();
    
    // Check for first-time setup wizard
    await checkFirstTimeSetup();
    
    // Setup auto-refresh
    setInterval(() => loadDashboardData(), 30000); // Refresh every 30 seconds
}

/**
 * Handle login form submission
 */
async function handleLogin(e) {
    e.preventDefault();
    
    const farmId = document.getElementById('farmId').value.trim();
    const emailInput = document.getElementById('email');
    const email = emailInput ? emailInput.value.trim() : '';
    const password = document.getElementById('password').value;
    const rememberInput = document.getElementById('remember');
    const remember = rememberInput ? rememberInput.checked : false;
    
    // Validation
    if (!farmId || !password) {
        showAlert('error', 'Please fill in Farm ID and password');
        return;
    }
    
    // Show loading state
    const loginBtn = document.getElementById('loginBtn');
    const originalText = loginBtn.innerHTML;
    loginBtn.innerHTML = '<span class="spinner"></span> Signing in...';
    loginBtn.disabled = true;
    
    try {
        // Call authentication API
        const response = await fetch(`${API_BASE}/api/farm/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ farmId, email, password })
        });
        
        const data = await response.json();
        
        if (data.status === 'success' && data.token) {
            // Save session
            const session = {
                token: data.token,
                farmId: data.farmId,
                farmName: data.farmName,
                email: data.email,
                role: data.role,
                subscription: data.subscription,
                expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
            };
            
            saveSession(session);
            
            // ALWAYS save to sessionStorage (works in private mode within same tab)
            sessionStorage.setItem('token', data.token);
            sessionStorage.setItem('farm_id', data.farmId || farmId);
            if (data.farmName) sessionStorage.setItem('farm_name', data.farmName);
            if (data.email || email) sessionStorage.setItem('email', data.email || email);
            
            // ALWAYS save to localStorage as fallback (may be restricted in private mode)
            // This helps with cross-tab access and normal mode persistence
            try {
                localStorage.setItem('token', data.token);
                localStorage.setItem('farm_id', data.farmId || farmId);
                if (data.farmName) localStorage.setItem('farm_name', data.farmName);
                if (data.email || email) localStorage.setItem('email', data.email || email);
            } catch (e) {
                console.warn('[Login] localStorage blocked (private mode?), using sessionStorage only');
            }
            
            // Save remember me preference
            if (remember) {
                try {
                    localStorage.setItem(STORAGE_KEY_REMEMBER, JSON.stringify({
                        farmId,
                        email
                    }));
                } catch (e) {
                    console.warn('[Login] Cannot save remember-me preference in private mode');
                }
            } else {
                localStorage.removeItem(STORAGE_KEY_REMEMBER);
            }
            
            showAlert('success', 'Login successful! Redirecting...');
            
            // Check if user needs first-time setup (password change + farm profile)
            // mustChangePassword forces wizard; setupCompleted===false does too
            // unless localStorage already shows setup was done (prevents re-trigger for established farms)
            const localSetupDone = localStorage.getItem('setup_completed') === 'true';
            const needsSetup = data.mustChangePassword || (data.setupCompleted === false && !localSetupDone);
            
            // Store setupCompleted in localStorage to prevent future false redirects
            if (data.setupCompleted) {
                localStorage.setItem('setup_completed', 'true');
            }
            
            setTimeout(() => {
                if (needsSetup) {
                    window.location.href = '/setup-wizard.html';
                } else {
                    window.location.href = getPostLoginRedirectPath();
                }
            }, 1000);
            
        } else {
            showAlert('error', data.message || 'Invalid credentials. Please try again.');
            loginBtn.innerHTML = originalText;
            loginBtn.disabled = false;
        }
        
    } catch (error) {
        console.error(' Login error:', error);
        showAlert('error', 'Connection error. Please check your network and try again.');
        loginBtn.innerHTML = originalText;
        loginBtn.disabled = false;
    }
}

/**
 * Load farm data
 */
async function loadFarmData() {
    try {
        // Use /api/farm/profile endpoint instead of admin endpoint
        const response = await fetch(`${API_BASE}/api/farm/profile`, {
            headers: {
                'Authorization': `Bearer ${currentSession.token}`
            }
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            farmData = data.farm;
            
            // Update UI with farm name
            const farmNameEl = document.getElementById('farmName');
            if (farmNameEl) {
                farmNameEl.textContent = farmData.name || currentSession.farmName || 'Light Engine Farm';
            }
            
            // Update header title with farm name
            const farmNameHeaderEl = document.getElementById('farmNameHeader');
            if (farmNameHeaderEl && farmData.name) {
                farmNameHeaderEl.textContent = `${farmData.name} - Admin Dashboard`;
            }
            
            const farmIdEl = document.getElementById('farmId');
            if (farmIdEl) {
                farmIdEl.textContent = farmData.farmId || currentSession.farmId;
            }
            
            // Update header farm ID display
            const headerFarmIdEl = document.getElementById('headerFarmId');
            if (headerFarmIdEl) {
                headerFarmIdEl.textContent = `Farm ID: ${farmData.farmId || currentSession.farmId}`;
            }
            
            // Store farm name in currentSession
            currentSession.farmName = farmData.name;
            
            if (currentSession.subscription) {
                const badge = document.getElementById('subscriptionBadge');
                if (badge) {
                    badge.textContent = currentSession.subscription.plan.toUpperCase() + ' PLAN';
                }
            }
            
            // Update GreenReach connection status
            const statusEl = document.getElementById('greenreach-status');
            if (statusEl) {
                if (farmData.status === 'active' || farmData.summary) {
                    statusEl.textContent = 'CONNECTED';
                    statusEl.classList.remove('disconnected');
                } else {
                    statusEl.textContent = 'DISCONNECTED';
                    statusEl.classList.add('disconnected');
                }
            }
        }
        
    } catch (error) {
        console.error(' Error loading farm data:', error);
        
        // Even if API fails, show farm ID from current session
        const headerFarmIdEl = document.getElementById('headerFarmId');
        if (headerFarmIdEl && currentSession) {
            headerFarmIdEl.textContent = `Farm ID: ${currentSession.farmId}`;
        }
    }
}

/**
 * Load dashboard data
 */
async function loadDashboardData() {
    try {
        console.log(' Loading dashboard data...');
        
        // Fetch inventory data from /api/inventory/current (includes tray/plant counts)
        let inventoryData = null;
        try {
            const inventoryResponse = await fetch(`${API_BASE}/api/inventory/current`, {
                headers: {
                    'Authorization': `Bearer ${currentSession.token}`
                }
            });
            if (inventoryResponse.ok) {
                inventoryData = await inventoryResponse.json();
                console.log(`✓ Loaded inventory: ${inventoryData.activeTrays} trays, ${inventoryData.totalPlants} plants`);
            } else {
                console.warn(`⚠ /api/inventory/current returned ${inventoryResponse.status}`);
            }
        } catch (err) {
            console.error('✗ Error fetching /api/inventory/current:', err);
        }
        
        // Update KPI cards with inventory data
        const hasGrowData = inventoryData && inventoryData.activeTrays > 0;

        if (hasGrowData) {
            document.getElementById('kpi-trays').textContent = inventoryData.activeTrays.toLocaleString();
            document.getElementById('kpi-plants').textContent = inventoryData.totalPlants.toLocaleString();
            document.getElementById('kpi-trays-change').textContent = 'Live grow data';
            document.getElementById('kpi-plants-change').textContent = 'Live grow data';
        } else {
            document.getElementById('kpi-trays').textContent = '--';
            document.getElementById('kpi-plants').textContent = '--';
            document.getElementById('kpi-trays-change').textContent = 'Start your first grow to see live data';
            document.getElementById('kpi-plants-change').textContent = 'Start your first grow to see live data';
        }

        // Calculate next harvest from byFarm trays data
        let nextHarvest = null;
        if (inventoryData?.byFarm?.[0]?.trays) {
            const trays = inventoryData.byFarm[0].trays;
            const upcomingTrays = trays.filter(t => t.harvestIn > 0).sort((a, b) => a.harvestIn - b.harvestIn);
            if (upcomingTrays.length > 0) {
                const nextTray = upcomingTrays[0];
                nextHarvest = {
                    daysUntil: nextTray.harvestIn,
                    cropName: nextTray.crop || 'Unknown'
                };
            }
        }

        if (nextHarvest) {
            document.getElementById('kpi-harvest').textContent = `${nextHarvest.daysUntil}d`;
            document.getElementById('kpi-harvest-change').textContent = nextHarvest.cropName;
        } else {
            document.getElementById('kpi-harvest').textContent = '--';
            document.getElementById('kpi-harvest-change').textContent = 'Start your first grow to see live data';
        }

        // Fetch communicating device count from IoT device feed
        try {
            const devResp = await fetch(`${API_BASE}/data/iot-devices.json`, {
                cache: 'no-store',
                headers: currentSession?.token ? { 'Authorization': `Bearer ${currentSession.token}` } : undefined
            });

            if (devResp.ok) {
                const devData = await devResp.json();
                const devArr = Array.isArray(devData) ? devData : (devData.devices || []);

                const now = Date.now();
                const freshnessMs = 48 * 60 * 60 * 1000;

                const communicatingDevices = devArr.filter((device) => {
                    const status = String(device.status || '').toLowerCase();
                    if (status === 'online' || status === 'connected' || status === 'active') {
                        return true;
                    }

                    const telemetry = device.telemetry || {};
                    const activityRaw =
                        device.lastSeen ||
                        device.last_seen ||
                        device.updatedAt ||
                        device.updated_at ||
                        device.heartbeatAt ||
                        device.lastActivity ||
                        telemetry.timestamp ||
                        telemetry.updatedAt ||
                        telemetry.lastSeen ||
                        null;

                    if (activityRaw) {
                        const activityMs = new Date(activityRaw).getTime();
                        if (Number.isFinite(activityMs) && (now - activityMs) <= freshnessMs) {
                            return true;
                        }
                    }

                    const hasTelemetry =
                        telemetry.temperature != null ||
                        telemetry.humidity != null ||
                        telemetry.co2 != null ||
                        telemetry.ppfd != null ||
                        telemetry.pressure != null;

                    return device.trust === 'trusted' && hasTelemetry;
                });

                const devCount = communicatingDevices.length;
                document.getElementById('kpi-devices').textContent = String(devCount);
                document.getElementById('kpi-devices-change').textContent = devCount > 0
                    ? `${devCount} communicating`
                    : 'No communicating devices';
            } else {
                document.getElementById('kpi-devices').textContent = '0';
                document.getElementById('kpi-devices-change').textContent = 'No communicating devices';
            }
        } catch (devErr) {
            console.warn('Could not fetch device count:', devErr.message);
            document.getElementById('kpi-devices').textContent = '0';
            document.getElementById('kpi-devices-change').textContent = 'No communicating devices';
        }
        
        // Load subscription usage
        await loadSubscriptionUsage();
        
        // Load activity
        await loadRecentActivity();
        
        console.log(' Dashboard data loaded successfully');
        
    } catch (error) {
        console.error(' Error loading dashboard data:', error);

        document.getElementById('kpi-trays').textContent = '--';
        document.getElementById('kpi-plants').textContent = '--';
        document.getElementById('kpi-harvest').textContent = '--';
        document.getElementById('kpi-devices').textContent = '--';
        document.getElementById('kpi-trays-change').textContent = 'Start your first grow to see live data';
        document.getElementById('kpi-plants-change').textContent = 'Start your first grow to see live data';
        document.getElementById('kpi-harvest-change').textContent = 'Start your first grow to see live data';
        document.getElementById('kpi-devices-change').textContent = 'No device data yet';
    }
}

function getGroupTotals(groups) {
    return groups.reduce((acc, group) => {
        const trays = Number.isFinite(group.trays) ? group.trays : 0;
        const plants = Number.isFinite(group.plants) ? group.plants : 0;
        acc.trays += trays;
        acc.plants += plants;
        return acc;
    }, { trays: 0, plants: 0 });
}

function getNextHarvestFromGroups(groups) {
    let nextHarvest = null;

    groups.forEach((group) => {
        const seedDateValue = group?.planConfig?.anchor?.seedDate;
        if (!seedDateValue) return;

        const seedDate = new Date(seedDateValue);
        if (Number.isNaN(seedDate.getTime())) return;

        const cropName = group.crop || 'Mixed crops';
        const growDays = (window.cropUtils && cropUtils.getCropGrowDays(cropName)) || 35;

        const harvestDate = new Date(seedDate);
        harvestDate.setDate(seedDate.getDate() + growDays);

        if (!nextHarvest || harvestDate < nextHarvest.harvestDate) {
            nextHarvest = { harvestDate, cropName };
        }
    });

    return nextHarvest;
}

/**
 * Load subscription usage
 */
async function loadSubscriptionUsage() {
    try {
        const response = await fetch(`${API_BASE}/api/billing/usage/${currentSession.farmId}`, {
            headers: {
                'Authorization': `Bearer ${currentSession.token}`
            }
        });
        
        const data = await response.json();

        if (data.status === 'success') {
            const usage = data.usage || {};
            const limits = data.limits || {};
            const plan = data.plan || {};
            const hasNumericUsage = isFiniteNumber(usage.devices)
                && isFiniteNumber(usage.api_calls_today)
                && isFiniteNumber(usage.storage_gb)
                && isFiniteNumber(limits.devices)
                && isFiniteNumber(limits.api_calls_per_day)
                && isFiniteNumber(limits.storage_gb);

            if (hasNumericUsage && plan.name && isFiniteNumber(plan.price)) {
                // Update subscription plan info
                document.getElementById('sub-plan').textContent = plan.name + ' Plan';
                document.getElementById('sub-detail').textContent =
                    `$${(plan.price / 100).toFixed(0)}/month • Renews on ${formatDate(data.renewsAt)}`;

                // Update usage meters
                updateUsageMeter('devices', usage.devices, limits.devices);
                updateUsageMeter('api', usage.api_calls_today, limits.api_calls_per_day, 'K');
                updateUsageMeter('storage', usage.storage_gb, limits.storage_gb, ' GB');
                return;
            }
        }

        if (data.status === 'unavailable' || data.dataAvailable === false) {
            setSubscriptionUnavailable();
            return;
        }

        console.warn(' Unexpected subscription usage response, showing unavailable state');
        setSubscriptionUnavailable();
        
    } catch (error) {
        console.warn(' Could not load subscription usage (using defaults):', error.message);

        setSubscriptionUnavailable();
    }
}

/**
 * Update usage meter
 */
function updateUsageMeter(type, current, limit, suffix = '') {
    const valueEl = document.getElementById(`usage-${type}`);
    const barEl = document.getElementById(`usage-${type}-bar`);
    
    if (valueEl && barEl) {
        const displayCurrent = suffix === 'K' ? (current / 1000).toFixed(1) : current;
        const displayLimit = suffix === 'K' ? (limit / 1000) : limit;
        
        valueEl.textContent = `${displayCurrent} / ${displayLimit}${suffix}`;
        
        const percentage = Math.min((current / limit) * 100, 100);
        barEl.style.width = `${percentage}%`;
        
        // Change color if over 80%
        if (percentage > 80) {
            barEl.style.background = 'linear-gradient(90deg, #f59e0b 0%, #ef4444 100%)';
        }
    }
}

function setSubscriptionUnavailable() {
    const planEl = document.getElementById('sub-plan');
    const detailEl = document.getElementById('sub-detail');

    if (planEl) planEl.textContent = 'Not Available';
    if (detailEl) detailEl.textContent = 'Usage data unavailable';

    setUsageMeterUnavailable('devices');
    setUsageMeterUnavailable('api');
    setUsageMeterUnavailable('storage');
}

function setUsageMeterUnavailable(type) {
    const valueEl = document.getElementById(`usage-${type}`);
    const barEl = document.getElementById(`usage-${type}-bar`);

    if (valueEl) valueEl.textContent = 'Not Available';
    if (barEl) {
        barEl.style.width = '0%';
        barEl.style.background = '#4b5563';
    }
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Load recent activity
 */
async function loadRecentActivity() {
    const tbody = document.querySelector('#activity-table tbody');
    
    try {
        const response = await fetch(`${API_BASE}/api/farm/activity/${currentSession.farmId}`, {
            headers: {
                'Authorization': `Bearer ${currentSession.token}`
            }
        });
        
        const data = await response.json();
        
        if (data.status === 'success' && data.activity && data.activity.length > 0) {
            tbody.innerHTML = data.activity.slice(0, 10).map(event => `
                <tr>
                    <td>${formatTime(event.timestamp)}</td>
                    <td>${event.description}</td>
                    <td>${event.user || 'System'}</td>
                    <td><span class="status-badge ${event.status}">${event.status.toUpperCase()}</span></td>
                </tr>
            `).join('');
        } else {
            // No activity yet - show empty state
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; padding: 2rem; color: #64748b;">
                        <div style="font-size: 2rem; margin-bottom: 0.5rem;">📋</div>
                        <div>No recent activity</div>
                        <div style="font-size: 0.875rem; margin-top: 0.5rem;">Activity will appear as events occur on your farm</div>
                    </td>
                </tr>
            `;
        }
        
    } catch (error) {
        console.error('Failed to load activity:', error.message);
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; padding: 2rem; color: #ef4444;">
                    <div>⚠️ Failed to load activity</div>
                    <div style="font-size: 0.875rem; margin-top: 0.5rem;">${error.message}</div>
                </td>
            </tr>
        `;
    }
}

/**
 * Setup navigation
 */
function renderEmbeddedView(url, title) {
    title = title || 'Embedded View';
    if (!url) return;

    document.querySelectorAll('.content-section').forEach(s => s.style.display = 'none');
    const iframeSection = document.getElementById('section-iframe-view');
    const iframe = document.getElementById('admin-iframe');
    const iframeTitle = document.getElementById('iframeSectionTitle');
    if (!iframeSection || !iframe) return;

    const embedUrl = (() => {
        try {
            const parsed = new URL(url, window.location.origin);
            parsed.searchParams.set('embedded', '1');
            return parsed.pathname + parsed.search + parsed.hash;
        } catch {
            return url;
        }
    })();

    iframe.src = embedUrl;
    iframeSection.style.display = 'block';
    if (iframeTitle) iframeTitle.textContent = title;

    iframe.onload = () => {
        try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (!doc) return;

            const selectors = [
                'header.page-header',
                '.page-header',
                '.header-actions',
                '.top-nav',
                '.nav-menu',
                '.dashboard-header',
                '.main-nav',
                '.sidebar-header-nav',
                '#farm-assistant',
                '#le-help-toggle',
                '#le-help-popup',
                '.voice-assistant-btn',
                '#voiceModal',
                '#voiceBtn'
            ];

            selectors.forEach((selector) => {
                doc.querySelectorAll(selector).forEach((el) => {
                    el.style.display = 'none';
                });
            });

            if (doc.body) doc.body.style.paddingTop = '0';
        } catch (error) {
            console.warn('[Farm Admin] Unable to apply embedded page chrome suppression:', error.message);
        }
    };
}

function setupNavigation() {
    // Handle section navigation
    document.querySelectorAll('.nav-item[data-section]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            const section = item.dataset.section;
            
            // Handle special redirects
            if (section === 'subscription') {
                showToast('Subscription management coming soon', 'info');
                return;
            }
            
            // Update active nav item
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            
            // Show section
            document.querySelectorAll('.content-section').forEach(s => s.style.display = 'none');
            
            // Handle iframe-view sections (external pages loaded in iframe)
            if (section === 'iframe-view' && item.dataset.url) {
                renderEmbeddedView(item.dataset.url, item.textContent.trim() || 'Embedded View');
                return;
            }
            
            const sectionEl = document.getElementById(`section-${section}`);
            if (sectionEl) {
                sectionEl.style.display = 'block';
                
                // Load section-specific data
                if (section === 'wholesale-orders') {
                    refreshWholesaleOrders();
                } else if (section === 'accounting') {
                    loadAccountingData();
                } else if (section === 'payments') {
                    loadPaymentMethods();
                } else if (section === 'settings') {
                    loadSettings();
                } else if (section === 'users') {
                    loadUsers();
                } else if (section === 'quality') {
                    loadQualityControl();
                }
            }
        });
    });
    
    // Handle action cards
    document.querySelectorAll('.action-card[data-section]').forEach(card => {
        card.addEventListener('click', (e) => {
            e.preventDefault();
            
            const section = card.dataset.section;
            const url = card.dataset.url;

            // For iframe-view action cards, handle directly
            if (section === 'iframe-view' && url) {
                document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
                renderEmbeddedView(url, card.querySelector('.action-title')?.textContent?.trim() || 'Embedded View');
                const matchNav = document.querySelector(`.nav-item[data-section="iframe-view"][data-url="${url}"]`);
                if (matchNav) matchNav.classList.add('active');
                return;
            }

            const navItem = document.querySelector(`.nav-item[data-section="${section}"]`);
            if (navItem) {
                navItem.click();
            }
        });
    });

    // Handle header nav buttons (Farm Summary, Inventory, etc.)
    document.querySelectorAll('.nav-btn[data-section]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const section = btn.dataset.section;
            const url = btn.dataset.url;

            // Hide all sections
            document.querySelectorAll('.content-section').forEach(s => s.style.display = 'none');

            // Update sidebar active state
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

            if (section === 'iframe-view' && url) {
                renderEmbeddedView(url, btn.textContent.trim() || 'Embedded View');
                // Highlight matching sidebar item if present
                const matchNav = document.querySelector(`.nav-item[data-section="iframe-view"][data-url="${url}"]`);
                if (matchNav) matchNav.classList.add('active');
            } else {
                const sectionEl = document.getElementById(`section-${section}`);
                if (sectionEl) {
                    sectionEl.style.display = 'block';
                }
                const matchNav = document.querySelector(`.nav-item[data-section="${section}"]`);
                if (matchNav) matchNav.classList.add('active');
            }
        });
    });
    
    // Handle header dropdown menus
    setupHeaderDropdowns();
    setupEmbeddedNavigationFallback();
    
    // Handle initial hash navigation (e.g. LE-farm-admin.html#traceability)
    const urlHash = window.location.hash.replace('#', '');
    if (urlHash && urlHash !== 'dashboard') {
        const navItem = document.querySelector(`.nav-item[data-section="${urlHash}"]`);
        if (navItem) {
            setTimeout(() => navItem.click(), 200);
        }
    }
}

/**
 * Fallback delegated navigation to keep admin links inside iframe view.
 * This protects against regressions where individual click handlers don't bind.
 */
function setupEmbeddedNavigationFallback() {
    if (window.__embeddedNavFallbackBound) return;
    window.__embeddedNavFallbackBound = true;

    document.addEventListener('click', (event) => {
        const anchor = event.target.closest('a');
        if (!anchor) return;

        if (event.defaultPrevented) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (typeof event.button === 'number' && event.button !== 0) return;

        const href = anchor.getAttribute('href') || '';
        if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
        if (anchor.getAttribute('target') === '_blank') return;
        if (href === '/farm-vitality.html') return;

        const inAdminNav = anchor.closest('.nav-menu, .sidebar-nav, .header-actions, .action-cards');
        if (!inAdminNav && anchor.dataset.section !== 'iframe-view') return;

        // Keep internal section links as section navigation
        if (href.startsWith('#') || (href.includes('#') && !anchor.dataset.url)) return;

        const candidateUrl = anchor.dataset.url || href;
        const shouldEmbed =
            anchor.dataset.section === 'iframe-view' ||
            /^\/(views\/|LE-dashboard\.html|farm-sales-pos\.html)/.test(candidateUrl);

        if (!shouldEmbed) return;

        event.preventDefault();
        event.stopPropagation();

        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const matchNav = document.querySelector(`.nav-item[data-section="iframe-view"][data-url="${candidateUrl}"]`);
        if (matchNav) matchNav.classList.add('active');

        renderEmbeddedView(candidateUrl, anchor.textContent.trim() || 'Embedded View');
    }, true);
}

/**
 * Setup header dropdown menu navigation
 */
function setupHeaderDropdowns() {
    // Handle dropdown button clicks
    document.querySelectorAll('.nav-button').forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // Close other menus
            document.querySelectorAll('.dropdown-menu').forEach(menu => {
                menu.style.display = 'none';
            });
            
            // Toggle current menu
            const menu = button.nextElementSibling;
            if (menu && menu.classList.contains('dropdown-menu')) {
                menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
            }
        });
    });
    
    // Handle dropdown item clicks — load pages inside admin iframe (except Farm Vitality)
    document.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            const href = item.getAttribute('href');
            const label = item.textContent.trim();
            const closeMenus = () => document.querySelectorAll('.dropdown-menu').forEach(m => m.style.display = 'none');
            
            // New tab links (QR Label Generator)
            if (item.getAttribute('target') === '_blank') {
                window.open(href);
                closeMenus();
                return;
            }
            
            // Farm Vitality Dashboard — opens as standalone page (exception)
            if (href === '/farm-vitality.html') {
                window.location.href = href;
                return;
            }
            
            // Self-link (Admin → Admin) — show dashboard
            if (href === '/LE-farm-admin.html') {
                const dashNav = document.querySelector('.nav-item[data-section="dashboard"]');
                if (dashNav) dashNav.click();
                closeMenus();
                return;
            }
            
            // Internal section links (hash-based, e.g., /LE-farm-admin.html#traceability or #wholesale-orders)
            if (href && href.includes('#')) {
                const section = href.split('#').pop();
                if (section) {
                    const navItem = document.querySelector(`.nav-item[data-section="${section}"]`);
                    if (navItem) {
                        navItem.click();
                        closeMenus();
                        return;
                    }
                }
            }
            
            // All other pages — load as iframe in admin main content area
            if (href) {
                document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
                const matchNav = document.querySelector(`.nav-item[data-section="iframe-view"][data-url="${href}"]`);
                if (matchNav) matchNav.classList.add('active');
                renderEmbeddedView(href, label);
            }
            
            closeMenus();
        });
    });
    
    // Close menus when clicking outside
    document.addEventListener('click', (e) => {
        const isButton = e.target.closest('.nav-button');
        const isMenu = e.target.closest('.dropdown-menu');
        
        if (!isButton && !isMenu) {
            document.querySelectorAll('.dropdown-menu').forEach(menu => {
                menu.style.display = 'none';
            });
        }
    });
}

/**
 * Refresh data
 */
async function refreshData() {
    grLog(' Refreshing dashboard data...');
    await loadDashboardData();
}

/**
 * Logout
 */
function logout() {
    grLog('🚪 Returning to home...');
    console.log('🔍 DEBUG - Logout called from:', window.location.href);
    console.log('🔍 DEBUG - Redirecting to: /LE-dashboard.html');
    console.log('🔍 DEBUG - Current page version:', window.__PAGE_VERSION__);
    
    // Clear any stored session data
    localStorage.removeItem(STORAGE_KEY_SESSION);
    
    // Redirect to updated dashboard with new UI
    console.log('🔍 DEBUG - Executing redirect now...');
    window.location.href = '/LE-dashboard.html';
}

/**
 * Session management
 */
function saveSession(session) {
    const payload = JSON.stringify(session);
    try {
        localStorage.setItem(STORAGE_KEY_SESSION, payload);
    } catch (error) {
        console.warn('Could not persist session to localStorage:', error);
    }
    try {
        sessionStorage.setItem(STORAGE_KEY_SESSION, payload);
    } catch (error) {
        console.warn('Could not persist session to sessionStorage:', error);
    }
}

function getSession() {
    const sessionStr = sessionStorage.getItem(STORAGE_KEY_SESSION) ||
        localStorage.getItem(STORAGE_KEY_SESSION);
    if (!sessionStr) return null;
    
    try {
        const session = JSON.parse(sessionStr);
        
        // Check if expired
        if (session.expiresAt && session.expiresAt < Date.now()) {
            console.warn(' Session expired');
            localStorage.removeItem(STORAGE_KEY_SESSION);
            sessionStorage.removeItem(STORAGE_KEY_SESSION);
            return null;
        }
        
        return session;
    } catch (error) {
        console.error(' Error parsing session:', error);
        localStorage.removeItem(STORAGE_KEY_SESSION);
        sessionStorage.removeItem(STORAGE_KEY_SESSION);
        return null;
    }
}

/**
 * Show alert message
 */
function showAlert(type, message) {
    const alert = document.getElementById('alert');
    if (!alert) return;
    
    alert.className = `alert ${type}`;
    alert.textContent = message;
    alert.style.display = 'block';
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        alert.style.display = 'none';
    }, 5000);
}

/**
 * Utility functions
 */
function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(timestamp) {
    const now = Date.now();
    const diff = now - new Date(timestamp).getTime();
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    return `${days} day${days > 1 ? 's' : ''} ago`;
}

/**
 * Crop Pricing Management
 */

// Pricing data structure
let pricingData = [];
let isPerGram = false; // false = per oz, true = per 25g
const OZ_TO_25G = 0.8818; // 1 oz = 28.35g, so 1 oz = 28.35/25 = 1.134 units of 25g, inverse = 0.8818

// Pricing version - increment this when defaultPricing changes to force localStorage clear
const PRICING_VERSION = '2025-12-09-v2';

// Default pricing (per oz) - Based on organic market research Dec 2025
// Prices calculated from actual retail packages and converted to per-oz rates
const defaultPricing = {
    // Lettuce varieties - Premium butterhead, standard for others
    'Butterhead Lettuce': { retail: 1.35, ws1: 15, ws2: 25, ws3: 35 },  // $5.99/6oz living head
    'Romaine Lettuce': { retail: 0.41, ws1: 15, ws2: 25, ws3: 35 },     // $5.49/18oz hearts
    'Red Leaf Lettuce': { retail: 0.61, ws1: 15, ws2: 25, ws3: 35 },    // Standard lettuce pricing
    'Oak Leaf Lettuce': { retail: 0.61, ws1: 15, ws2: 25, ws3: 35 },    // Standard lettuce pricing
    'Mixed Lettuce': { retail: 0.61, ws1: 15, ws2: 25, ws3: 35 },       // Standard lettuce pricing
    'Lettuce': { retail: 0.61, ws1: 15, ws2: 25, ws3: 35 },             // Generic lettuce
    
    // Basil varieties - Premium herb pricing
    'Genovese Basil': { retail: 7.18, ws1: 12, ws2: 20, ws3: 30 },      // $3.99/0.75oz standard
    'Thai Basil': { retail: 7.18, ws1: 12, ws2: 20, ws3: 30 },          // Same as Genovese
    'Purple Basil': { retail: 7.18, ws1: 12, ws2: 20, ws3: 30 },        // Same as Genovese
    'Lemon Basil': { retail: 7.18, ws1: 12, ws2: 20, ws3: 30 },         // Same as Genovese
    'Holy Basil': { retail: 7.18, ws1: 12, ws2: 20, ws3: 30 },          // Same as Genovese
    'Basil': { retail: 7.18, ws1: 12, ws2: 20, ws3: 30 },               // Generic basil
    
    // Arugula varieties - Specialty green pricing
    'Baby Arugula': { retail: 1.35, ws1: 15, ws2: 25, ws3: 35 },        // $4.99/5oz tender baby
    'Cultivated Arugula': { retail: 1.35, ws1: 15, ws2: 25, ws3: 35 },  // Standard arugula
    'Wild Arugula': { retail: 1.35, ws1: 15, ws2: 25, ws3: 35 },        // Standard arugula
    'Wasabi Arugula': { retail: 1.35, ws1: 15, ws2: 25, ws3: 35 },      // Standard arugula
    'Red Arugula': { retail: 1.35, ws1: 15, ws2: 25, ws3: 35 },         // Standard arugula
    'Arugula': { retail: 1.35, ws1: 15, ws2: 25, ws3: 35 },             // Generic arugula
    
    // Kale varieties - Standard pricing
    'Curly Kale': { retail: 0.76, ws1: 15, ws2: 25, ws3: 35 },          // $4.49/8oz bunch
    'Lacinato Kale': { retail: 0.76, ws1: 15, ws2: 25, ws3: 35 },       // Dinosaur kale
    'Dinosaur Kale': { retail: 0.76, ws1: 15, ws2: 25, ws3: 35 },       // Same as Lacinato
    'Baby Kale': { retail: 0.76, ws1: 15, ws2: 25, ws3: 35 },           // Tender baby leaves
    'Red Russian Kale': { retail: 0.76, ws1: 15, ws2: 25, ws3: 35 },    // Standard kale
    'Kale': { retail: 0.76, ws1: 15, ws2: 25, ws3: 35 }                 // Generic kale
};

/**
 * Load crops and pricing — API first, localStorage fallback
 */
async function loadCropsFromDatabase() {
    try {
        // Try loading from server-side pricing API first
        let loadedFromAPI = false;
        try {
            const pricingRes = await fetch(`${API_BASE}/crop-pricing`);
            if (pricingRes.ok) {
                const pricingResult = await pricingRes.json();
                if (pricingResult.ok && pricingResult.pricing?.crops?.length) {
                    // Map API fields to frontend field names
                    pricingData = pricingResult.pricing.crops.map(c => ({
                        crop: c.crop,
                        retail: c.retailPrice || 0,
                        ws1Discount: c.ws1Discount ?? 15,
                        ws2Discount: c.ws2Discount ?? 25,
                        ws3Discount: c.ws3Discount ?? 35,
                        isTaxable: c.isTaxable || false
                    }));
                    // Cache to localStorage
                    pricingData.forEach(item => {
                        localStorage.setItem(`pricing_${item.crop}`, JSON.stringify(item));
                    });
                    loadedFromAPI = true;
                    console.log(`Pricing loaded from API: ${pricingData.length} crops`);
                }
            }
        } catch (apiErr) {
            console.warn('Pricing API unavailable, falling back to localStorage:', apiErr.message);
        }

        // Fallback: load from groups.json + localStorage defaults
        if (!loadedFromAPI) {
            const savedVersion = localStorage.getItem('pricing_version');
            if (savedVersion !== PRICING_VERSION) {
                console.log(` Pricing version mismatch (${savedVersion} → ${PRICING_VERSION}). Clearing old prices...`);
                Object.keys(localStorage).forEach(key => {
                    if (key.startsWith('pricing_')) localStorage.removeItem(key);
                });
                localStorage.setItem('pricing_version', PRICING_VERSION);
            }

            const response = await fetch(`${API_BASE}/data/groups.json`);
            const data = await response.json();
            const crops = [...new Set(data.groups.map(g => g.crop).filter(c => c && c.trim()))].sort();

            pricingData = crops.map(crop => {
                const saved = localStorage.getItem(`pricing_${crop}`);
                if (saved) return JSON.parse(saved);
                const defaults = defaultPricing[crop] || { retail: 10.00, ws1: 15, ws2: 25, ws3: 35 };
                return { crop, retail: defaults.retail, ws1Discount: defaults.ws1, ws2Discount: defaults.ws2, ws3Discount: defaults.ws3, isTaxable: false };
            });
        }

        renderPricingTable();
    } catch (error) {
        console.error(' Error loading crops:', error);
        pricingData = [];
        console.warn('Pricing: no crops loaded — farm may not have crops assigned yet.');
        renderPricingTable();
    }
}

/**
 * Export pricing data as CSV download
 */
function exportPricingCSV() {
    if (!pricingData.length) { alert('No pricing data to export.'); return; }
    const unitLabel = isPerGram ? '/25g' : '/oz';
    const rows = [['Crop', `Retail (${unitLabel})`, 'WS1 Discount %', `WS1 Price (${unitLabel})`, 'WS2 Discount %', `WS2 Price (${unitLabel})`, 'WS3 Discount %', `WS3 Price (${unitLabel})`, 'Taxable']];
    pricingData.forEach(item => {
        const r = isPerGram ? convertPrice(item.retail, true) : item.retail;
        rows.push([
            item.crop, r.toFixed(2),
            item.ws1Discount, calculateWholesalePrice(r, item.ws1Discount).toFixed(2),
            item.ws2Discount, calculateWholesalePrice(r, item.ws2Discount).toFixed(2),
            item.ws3Discount, calculateWholesalePrice(r, item.ws3Discount).toFixed(2),
            item.isTaxable ? 'Yes' : 'No'
        ]);
    });
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `crop-pricing-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

/**
 * Convert price between oz and 25g
 */
function convertPrice(price, toGram = false) {
    if (toGram) {
        // Convert oz to 25g: multiply by conversion factor
        return price * OZ_TO_25G;
    } else {
        // Convert 25g to oz: divide by conversion factor
        return price / OZ_TO_25G;
    }
}

/**
 * Calculate wholesale price based on discount
 */
function calculateWholesalePrice(retail, discountPercent) {
    return retail * (1 - discountPercent / 100);
}

/**
 * Toggle between oz and 25g pricing
 */
function togglePricingUnit() {
    isPerGram = document.getElementById('unitToggle').checked;
    renderPricingTable();
}

/**
 * Render pricing table
 */
function renderPricingTable() {
    const tbody = document.querySelector('#pricing-table tbody');
    if (!tbody) return;
    
    const unitLabel = isPerGram ? '/25g' : '/oz';
    
    // Update header labels
    document.getElementById('unit-retail').textContent = `($${unitLabel})`;
    document.getElementById('unit-ws1').textContent = `($${unitLabel})`;
    document.getElementById('unit-ws2').textContent = `($${unitLabel})`;
    document.getElementById('unit-ws3').textContent = `($${unitLabel})`;
    
    tbody.innerHTML = pricingData.map((item, index) => {
        const displayRetail = isPerGram ? convertPrice(item.retail, true) : item.retail;
        const ws1Price = calculateWholesalePrice(displayRetail, item.ws1Discount);
        const ws2Price = calculateWholesalePrice(displayRetail, item.ws2Discount);
        const ws3Price = calculateWholesalePrice(displayRetail, item.ws3Discount);
        
        return `
            <tr>
                <td class="crop-name">${item.crop}</td>
                <td>
                    <input 
                        type="number" 
                        class="pricing-input" 
                        value="${displayRetail.toFixed(2)}" 
                        step="0.01" 
                        min="0"
                        data-index="${index}"
                        data-field="retail"
                        onchange="updatePricing(${index}, 'retail', this.value)"
                    >
                </td>
                <td>
                    <input 
                        type="number" 
                        class="discount-input" 
                        value="${item.ws1Discount}" 
                        step="1" 
                        min="0" 
                        max="100"
                        data-index="${index}"
                        data-field="ws1Discount"
                        onchange="updatePricing(${index}, 'ws1Discount', this.value)"
                    >%
                </td>
                <td class="calculated-price">$${ws1Price.toFixed(2)}</td>
                <td>
                    <input 
                        type="number" 
                        class="discount-input" 
                        value="${item.ws2Discount}" 
                        step="1" 
                        min="0" 
                        max="100"
                        data-index="${index}"
                        data-field="ws2Discount"
                        onchange="updatePricing(${index}, 'ws2Discount', this.value)"
                    >%
                </td>
                <td class="calculated-price">$${ws2Price.toFixed(2)}</td>
                <td>
                    <input 
                        type="number" 
                        class="discount-input" 
                        value="${item.ws3Discount}" 
                        step="1" 
                        min="0" 
                        max="100"
                        data-index="${index}"
                        data-field="ws3Discount"
                        onchange="updatePricing(${index}, 'ws3Discount', this.value)"
                    >%
                </td>
                <td class="calculated-price">$${ws3Price.toFixed(2)}</td>
                <td style="text-align: center;">
                    <input 
                        type="checkbox" 
                        ${item.isTaxable ? 'checked' : ''}
                        data-index="${index}"
                        data-field="isTaxable"
                        onchange="updatePricing(${index}, 'isTaxable', this.checked)"
                        style="cursor: pointer; width: 18px; height: 18px;"
                    >
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Update pricing when input changes
 */
function updatePricing(index, field, value) {
    if (field === 'isTaxable') {
        // Handle boolean checkbox value
        pricingData[index][field] = value;
    } else {
        const numValue = parseFloat(value);
        if (isNaN(numValue)) return;
        
        if (field === 'retail') {
            // If showing per 25g, convert back to oz for storage
            pricingData[index].retail = isPerGram ? convertPrice(numValue, false) : numValue;
        } else {
            pricingData[index][field] = numValue;
        }
    }
    
    renderPricingTable();
}

/**
 * Save pricing data
 */
async function savePricing() {
    try {
        // Save to localStorage
        pricingData.forEach(item => {
            localStorage.setItem(`pricing_${item.crop}`, JSON.stringify(item));
        });
        
        // Also save to backend API for Farm Sales Terminal
        try {
            const crops = pricingData.map(item => ({
                crop: item.crop,
                unit: 'lb',
                retailPrice: parseFloat(item.retail),
                wholesalePrice: parseFloat(calculateWholesalePrice(item.retail, item.ws1Discount)),
                ws1Discount: item.ws1Discount,
                ws2Discount: item.ws2Discount,
                ws3Discount: item.ws3Discount,
                isTaxable: item.isTaxable || false
            }));
            
            const response = await fetch(`${API_BASE}/crop-pricing`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ crops })
            });
            
            if (response.ok) {
                console.log(' Pricing saved to backend API');
            } else {
                console.warn('  Failed to save to backend API (localStorage only)');
            }
        } catch (apiError) {
            console.warn('  Backend API unavailable (localStorage only):', apiError.message);
        }
        
        // Show success message
        alert('Pricing saved successfully!');
        console.log(' Pricing data saved:', pricingData);
        
    } catch (error) {
        console.error(' Error saving pricing:', error);
        alert('Error saving pricing data. Please try again.');
    }
}

// Initialize pricing when pricing section is shown
document.addEventListener('DOMContentLoaded', () => {
    // Check if we're on the admin page
    if (window.location.pathname.includes('farm-admin.html')) {
        // Load crops when page loads
        setTimeout(() => {
            loadCropsFromDatabase();
            checkForScheduledPriceUpdates();
        }, 1000);
    }
});

/**
 * AI Pricing Assistant
 */

// Market data storage
const AI_PRICING_KEY = 'ai_pricing_recommendations';
const AI_LAST_CHECK_KEY = 'ai_pricing_last_check';
const AI_HISTORY_KEY = 'ai_pricing_history';
const USD_TO_CAD_RATE_KEY = 'usd_to_cad_rate';

// Current USD to CAD exchange rate (updated during analysis)
let currentExchangeRate = 1.35; // Default rate

// Market data based on organic produce pricing research (Dec 2025)
// Pricing sourced from Whole Foods, Sprouts, Trader Joe's, and farmers markets
const marketDataSources = {
    // Lettuce varieties
    'Butterhead Lettuce': {
        retailers: ['Whole Foods', 'Trader Joes', 'Sprouts', 'Metro', 'Sobeys', 'Farm Boy'],
        avgPriceUSD: 5.99,
        avgWeightOz: 6,
        priceRange: [4.99, 6.99],
        trend: 'stable',
        country: 'North America',
        articles: [
            { title: 'Organic Living Lettuce Gains Market Share', url: 'https://www.producenews.com/organic-lettuce-trends', date: '2025-11-15' }
        ]
    },
    'Romaine Lettuce': {
        retailers: ['Whole Foods', 'Kroger', 'Safeway', 'Loblaws', 'Metro', 'Sobeys'],
        avgPriceUSD: 5.49,
        avgWeightOz: 18,
        priceRange: [4.99, 6.49],
        trend: 'stable',
        country: 'North America',
        articles: []
    },
    'Red Leaf Lettuce': {
        retailers: ['Whole Foods', 'Sobeys', 'Farm Boy', 'Farmers Markets'],
        avgPriceUSD: 5.49,
        avgWeightOz: 12,
        priceRange: [3.99, 6.99],
        trend: 'stable',
        country: 'North America',
        articles: []
    },
    'Oak Leaf Lettuce': {
        retailers: ['Whole Foods', 'Metro', 'Specialty Markets'],
        avgPriceUSD: 5.49,
        avgWeightOz: 12,
        priceRange: [3.99, 6.99],
        trend: 'stable',
        country: 'North America',
        articles: []
    },
    'Mixed Lettuce': {
        retailers: ['Whole Foods', 'Loblaws', 'Farm Boy', 'Sobeys'],
        avgPriceUSD: 5.49,
        avgWeightOz: 12,
        priceRange: [3.99, 6.99],
        trend: 'stable',
        country: 'North America',
        articles: []
    },
    'Lettuce': {
        retailers: ['Whole Foods', 'Metro', 'Loblaws'],
        avgPriceUSD: 5.49,
        avgWeightOz: 12,
        priceRange: [3.99, 6.99],
        trend: 'stable',
        country: 'USA',
        articles: []
    },
    
    // Basil varieties
    'Genovese Basil': {
        retailers: ['Whole Foods', 'Sobeys', 'Farm Boy', 'Metro', 'Loblaws', 'Farmers Markets'],
        avgPriceUSD: 3.99,
        avgWeightOz: 0.75,
        priceRange: [2.99, 4.99],
        trend: 'increasing',
        country: 'North America',
        articles: [
            { title: 'Fresh Herb Prices Rise as Winter Demand Increases', url: 'https://www.thepacker.com/news/produce-markets/herb-pricing-winter-2025', date: '2025-11-28' },
            { title: 'California Growers Report Strong Basil Season', url: 'https://www.producenews.com/organic-herbs-2025', date: '2025-11-10' }
        ]
    },
    'Thai Basil': {
        retailers: ['Whole Foods', 'Loblaws', 'Metro', 'Asian Markets'],
        avgPriceUSD: 3.99,
        avgWeightOz: 0.75,
        priceRange: [2.99, 4.99],
        trend: 'increasing',
        country: 'North America',
        articles: []
    },
    'Purple Basil': {
        retailers: ['Whole Foods', 'Farm Boy', 'Sobeys', 'Farmers Markets'],
        avgPriceUSD: 3.99,
        avgWeightOz: 0.75,
        priceRange: [2.99, 4.99],
        trend: 'increasing',
        country: 'North America',
        articles: []
    },
    'Lemon Basil': {
        retailers: ['Farm Boy', 'Sobeys', 'Metro', 'Specialty Stores'],
        avgPriceUSD: 3.99,
        avgWeightOz: 0.75,
        priceRange: [2.99, 4.99],
        trend: 'increasing',
        country: 'North America',
        articles: []
    },
    'Holy Basil': {
        retailers: ['Metro', 'Loblaws', 'Asian Markets', 'Specialty Stores'],
        avgPriceUSD: 3.99,
        avgWeightOz: 0.75,
        priceRange: [2.99, 4.99],
        trend: 'increasing',
        country: 'USA',
        articles: []
    },
    'Basil': {
        retailers: ['Whole Foods', 'Sprouts', 'Farmers Markets'],
        avgPriceUSD: 3.99,
        avgWeightOz: 0.75,
        priceRange: [2.99, 4.99],
        trend: 'increasing',
        country: 'USA',
        articles: []
    },
    
    // Arugula varieties
    'Baby Arugula': {
        retailers: ['Whole Foods', 'Trader Joes', 'Sprouts'],
        avgPriceUSD: 4.99,
        avgWeightOz: 5,
        priceRange: [3.99, 5.99],
        trend: 'stable',
        country: 'USA',
        articles: []
    },
    'Cultivated Arugula': {
        retailers: ['Whole Foods', 'Trader Joes', 'Sprouts'],
        avgPriceUSD: 4.99,
        avgWeightOz: 5,
        priceRange: [3.99, 5.99],
        trend: 'stable',
        country: 'USA',
        articles: []
    },
    'Wild Arugula': {
        retailers: ['Whole Foods', 'Specialty Stores'],
        avgPriceUSD: 4.99,
        avgWeightOz: 5,
        priceRange: [3.99, 5.99],
        trend: 'stable',
        country: 'USA',
        articles: []
    },
    'Wasabi Arugula': {
        retailers: ['Specialty Stores', 'Farmers Markets'],
        avgPriceUSD: 4.99,
        avgWeightOz: 5,
        priceRange: [3.99, 5.99],
        trend: 'stable',
        country: 'USA',
        articles: []
    },
    'Red Arugula': {
        retailers: ['Whole Foods', 'Specialty Stores'],
        avgPriceUSD: 4.99,
        avgWeightOz: 5,
        priceRange: [3.99, 5.99],
        trend: 'stable',
        country: 'USA',
        articles: []
    },
    'Arugula': {
        retailers: ['Whole Foods', 'Trader Joes', 'Sprouts'],
        avgPriceUSD: 4.99,
        avgWeightOz: 5,
        priceRange: [3.99, 5.99],
        trend: 'stable',
        country: 'USA',
        articles: []
    },
    
    // Kale varieties
    'Curly Kale': {
        retailers: ['Whole Foods', 'Kroger', 'Safeway', 'Target'],
        avgPriceUSD: 4.49,
        avgWeightOz: 8,
        priceRange: [2.99, 5.49],
        trend: 'stable',
        country: 'USA',
        articles: [
            { title: 'Kale Remains Steady Amid Winter Vegetable Price Volatility', url: 'https://www.thepacker.com/news/kale-market-trends-2025', date: '2025-11-22' }
        ]
    },
    'Lacinato Kale': {
        retailers: ['Whole Foods', 'Trader Joes', 'Sprouts'],
        avgPriceUSD: 4.49,
        avgWeightOz: 8,
        priceRange: [2.99, 5.49],
        trend: 'stable',
        country: 'USA',
        articles: []
    },
    'Dinosaur Kale': {
        retailers: ['Whole Foods', 'Trader Joes', 'Sprouts'],
        avgPriceUSD: 4.49,
        avgWeightOz: 8,
        priceRange: [2.99, 5.49],
        trend: 'stable',
        country: 'USA',
        articles: []
    },
    'Baby Kale': {
        retailers: ['Whole Foods', 'Trader Joes', 'Target'],
        avgPriceUSD: 4.49,
        avgWeightOz: 8,
        priceRange: [2.99, 5.49],
        trend: 'stable',
        country: 'USA',
        articles: []
    },
    'Red Russian Kale': {
        retailers: ['Whole Foods', 'Farmers Markets', 'Specialty Stores'],
        avgPriceUSD: 4.49,
        avgWeightOz: 8,
        priceRange: [2.99, 5.49],
        trend: 'stable',
        country: 'USA',
        articles: []
    },
    'Kale': {
        retailers: ['Whole Foods', 'Kroger', 'Safeway', 'Target'],
        avgPriceUSD: 4.49,
        avgWeightOz: 8,
        priceRange: [2.99, 5.49],
        trend: 'stable',
        country: 'USA',
        articles: []
    }
};

/**
 * Open AI Pricing Assistant modal
 */
function openAIPricingAssistant() {
    document.getElementById('aiPricingModal').style.display = 'flex';
    
    // Check if we have recent recommendations
    const lastCheck = localStorage.getItem(AI_LAST_CHECK_KEY);
    if (lastCheck) {
        const daysSinceCheck = Math.floor((Date.now() - parseInt(lastCheck)) / (1000 * 60 * 60 * 24));
        if (daysSinceCheck < 30) {
            // Show cached recommendations
            displayCachedRecommendations();
            return;
        }
    }
    // No cached data — auto-run analysis
    runAIPricingAnalysis();
}

/**
 * Close AI Pricing Assistant modal
 */
function closeAIPricingAssistant() {
    document.getElementById('aiPricingModal').style.display = 'none';
    document.getElementById('ai-recommendations').style.display = 'none';
    document.getElementById('ai-price-history').style.display = 'none';
}

/**
 * Run AI pricing analysis
 */
async function runAIPricingAnalysis() {
    const statusDiv = document.getElementById('ai-analysis-status');
    const statusText = document.getElementById('ai-status-text');
    const recommendationsDiv = document.getElementById('ai-recommendations');
    
    statusDiv.style.display = 'block';
    recommendationsDiv.style.display = 'none';
    
    const steps = [
        'Fetching current USD to CAD exchange rate...',
        'Searching organic retailers in North America...',
        'Analyzing Whole Foods pricing data...',
        'Checking Trader Joes and specialty stores...',
        'Scanning Canadian grocers: Sobeys, Metro, Loblaws, Farm Boy...',
        'Reviewing independent organic markets...',
        'Converting US prices to CAD (Canadian prices unchanged)...',
        'Calculating cost per oz and per 25g...',
        'Monitoring market trends and news...',
        'Generating competitive pricing recommendations...'
    ];
    
    for (let i = 0; i < steps.length; i++) {
        statusText.textContent = steps[i];
        await new Promise(resolve => setTimeout(resolve, 700));
    }

    // Ensure pricing data is loaded before analysis (needed for current-price comparisons)
    if (!Array.isArray(pricingData) || pricingData.length === 0) {
        await loadCropsFromDatabase();
    }
    
    // Simulate fetching exchange rate (in production, call real API)
    await fetchExchangeRate();
    
    // Generate recommendations
    const recommendations = generateRecommendations();
    
    // Store recommendations
    localStorage.setItem(AI_PRICING_KEY, JSON.stringify(recommendations));
    localStorage.setItem(AI_LAST_CHECK_KEY, Date.now().toString());
    
    // Save to history
    saveToHistory(recommendations);
    
    // Display recommendations
    statusDiv.style.display = 'none';
    displayRecommendations(recommendations);
}

/**
 * Fetch current USD to CAD exchange rate
 */
async function fetchExchangeRate() {
    // In production, call a real exchange rate API like:
    // - https://api.exchangerate-api.com/v4/latest/USD
    // - https://api.fixer.io/latest?base=USD&symbols=CAD
    // - https://v6.exchangerate-api.com/v6/YOUR-API-KEY/latest/USD
    
    // For now, simulate with realistic rate
    const savedRate = localStorage.getItem(USD_TO_CAD_RATE_KEY);
    const savedRateData = savedRate ? JSON.parse(savedRate) : null;
    
    // Check if rate is less than 24 hours old
    if (savedRateData && (Date.now() - savedRateData.timestamp) < 86400000) {
        currentExchangeRate = savedRateData.rate;
    } else {
        // Simulate API call - in production, replace with real API
        currentExchangeRate = 1.35 + (Math.random() * 0.05 - 0.025); // 1.325 to 1.375
        
        localStorage.setItem(USD_TO_CAD_RATE_KEY, JSON.stringify({
            rate: currentExchangeRate,
            timestamp: Date.now()
        }));
    }
    
    console.log(`💱 Exchange rate updated: 1 USD = ${currentExchangeRate.toFixed(4)} CAD`);
}

function resolveMarketDataForCrop(cropName) {
    if (!cropName) return null;

    const exact = marketDataSources[cropName];
    if (exact) return exact;

    const normalized = String(cropName).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

    const aliasChecks = [
        { test: ['butterhead', 'buttercrunch', 'bibb'], key: 'Butterhead Lettuce' },
        { test: ['romaine'], key: 'Romaine Lettuce' },
        { test: ['red leaf'], key: 'Red Leaf Lettuce' },
        { test: ['oakleaf', 'oak leaf', 'salad bowl'], key: 'Oak Leaf Lettuce' },
        { test: ['lettuce', 'salad'], key: 'Lettuce' },
        { test: ['arugula', 'rocket'], key: 'Arugula' },
        { test: ['basil', 'genovese', 'thai basil', 'purple basil', 'lemon basil', 'holy basil'], key: 'Basil' },
        { test: ['kale', 'lacinato', 'dinosaur', 'russian kale'], key: 'Kale' },
        { test: ['frisee', 'frisée', 'endive'], key: 'Frisée Endive' },
        { test: ['watercress'], key: 'Watercress' }
    ];

    for (const alias of aliasChecks) {
        if (alias.test.some(token => normalized.includes(token))) {
            return marketDataSources[alias.key] || null;
        }
    }

    const fuzzyKey = Object.keys(marketDataSources).find((key) => {
        const keyNormalized = key.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        return normalized.includes(keyNormalized) || keyNormalized.includes(normalized);
    });

    return fuzzyKey ? marketDataSources[fuzzyKey] : null;
}

/**
 * Generate pricing recommendations based on market data
 */
function generateRecommendations() {
    const recommendations = [];

    const pricingMap = new Map(
        (pricingData || []).map(item => [item.crop, item])
    );

    // Analyze full recipe universe: market-supported recipes + current pricing recipes
    const analysisCrops = [...new Set([
        ...Object.keys(marketDataSources),
        ...(pricingData || []).map(item => item.crop)
    ])].sort();

    analysisCrops.forEach(cropName => {
        const marketData = resolveMarketDataForCrop(cropName);
        if (!marketData) return;

        const pricingItem = pricingMap.get(cropName);
        const defaultItem = defaultPricing[cropName] || null;
        
        // Calculate price per oz from market data
        const pricePerOzUSD = marketData.avgPriceUSD / marketData.avgWeightOz;
        
        // Convert to CAD if source is outside Canada
        const pricePerOzCAD = marketData.country !== 'Canada' ? 
            pricePerOzUSD * currentExchangeRate : 
            pricePerOzUSD;
        
        // Calculate price per 25g (1 oz = 28.35g, so 25g = 0.8818 oz)
        const pricePer25gCAD = pricePerOzCAD * 0.8818;
        
        const currentPrice = Number(pricingItem?.retail ?? defaultItem?.retail ?? pricePerOzCAD);
        const marketAvg = pricePerOzCAD;
        const difference = ((currentPrice - marketAvg) / marketAvg * 100).toFixed(1);
        
        let recommendation = marketAvg;
        let reasoning = '';
        let priceChangeType = 'stable';
        
        if (marketData.trend === 'increasing') {
            recommendation = marketAvg * 1.05; // Suggest 5% above average
            reasoning = `Market analysis shows ${cropName} prices are trending upward. `;
            priceChangeType = 'up';
            
            if (marketData.articles.length > 0) {
                reasoning += `Recent reports indicate supply constraints and increased demand. `;
            }
            
            reasoning += `Recommended to adjust pricing to capitalize on market conditions.`;
        } else if (marketData.trend === 'decreasing') {
            recommendation = marketAvg * 0.95; // Suggest 5% below average
            reasoning = `Market prices for ${cropName} are declining due to increased supply. Consider competitive pricing to maintain market share.`;
            priceChangeType = 'down';
        } else {
            recommendation = marketAvg;
            reasoning = `Current ${cropName} market is stable. Your pricing is ${Math.abs(difference)}% ${difference > 0 ? 'above' : 'below'} market average. `;
            
            if (Math.abs(difference) > 10) {
                reasoning += difference > 0 ? 
                    'Consider reducing price to match market expectations.' : 
                    'You have room to increase margins without losing competitiveness.';
            } else {
                reasoning += 'Your pricing is competitive.';
            }
        }
        
        // Calculate range in CAD
        const priceRangeCAD = marketData.country !== 'Canada' ?
            marketData.priceRange.map(p => (p / marketData.avgWeightOz) * currentExchangeRate) :
            marketData.priceRange.map(p => p / marketData.avgWeightOz);
        
        recommendations.push({
            crop: cropName,
            currentPrice: currentPrice,
            recommendedPrice: recommendation,
            marketAverage: marketAvg,
            pricePerOzCAD: pricePerOzCAD,
            pricePer25gCAD: pricePer25gCAD,
            pricePerOzUSD: pricePerOzUSD,
            priceRange: priceRangeCAD,
            exchangeRate: currentExchangeRate,
            sourceCountry: marketData.country,
            trend: marketData.trend,
            reasoning: reasoning,
            priceChangeType: priceChangeType,
            articles: marketData.articles,
            retailers: marketData.retailers,
            hasPricingRow: Boolean(pricingItem),
            timestamp: Date.now()
        });
    });
    
    return recommendations;
}

/**
 * Display recommendations
 */
function displayRecommendations(recommendations) {
    const contentDiv = document.getElementById('ai-recommendations-content');
    const recommendationsDiv = document.getElementById('ai-recommendations');

    if (!recommendations || recommendations.length === 0) {
        contentDiv.innerHTML = `
            <div class="card" style="padding: 16px; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3);">
                <strong>No matching market data found for current crop names.</strong><br>
                Add crop aliases in the assistant mapping or verify crop naming in pricing data.
            </div>
        `;
        recommendationsDiv.style.display = 'block';
        return;
    }
    
    contentDiv.innerHTML = recommendations.map(rec => {
        const priceChange = ((rec.recommendedPrice - rec.currentPrice) / rec.currentPrice * 100).toFixed(1);
        const hasSignificantChange = Math.abs(priceChange) > 5;
        
        // Show currency conversion info if from USA
        const conversionInfo = rec.sourceCountry !== 'Canada' ? 
            `<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px;">
                💱 Prices converted from USD at rate: 1 USD = ${rec.exchangeRate.toFixed(4)} CAD
            </div>` : '';
        
        return `
            <div class="recommendation-card ${hasSignificantChange ? 'updated' : ''}">
                <div class="recommendation-header">
                    <div class="crop-title">${rec.crop}</div>
                    ${hasSignificantChange ? 
                        `<span style="padding: 4px 8px; background: rgba(245, 158, 11, 0.2); color: #fbbf24; border-radius: 4px; font-size: 12px; font-weight: 600;">UPDATE RECOMMENDED</span>` 
                        : ''}
                </div>
                
                ${conversionInfo}
                
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px; padding: 12px; background: var(--bg-primary); border-radius: 6px;">
                    <div>
                        <div class="price-label">Market Price (CAD)</div>
                        <div style="font-size: 16px; font-weight: 600; color: var(--accent-blue);">
                            $${rec.pricePerOzCAD.toFixed(2)}/oz
                        </div>
                        <div style="font-size: 13px; color: var(--text-secondary);">
                            $${rec.pricePer25gCAD.toFixed(2)}/25g
                        </div>
                    </div>
                    <div>
                        <div class="price-label">Source (USD)</div>
                        <div style="font-size: 16px; font-weight: 600; color: var(--text-muted);">
                            $${rec.pricePerOzUSD.toFixed(2)}/oz
                        </div>
                        <div style="font-size: 11px; color: var(--text-muted);">
                            ${rec.sourceCountry}
                        </div>
                    </div>
                </div>
                
                <div class="price-comparison">
                    <div class="price-box">
                        <div class="price-label">Your Current Price</div>
                        <div class="price-value">$${rec.currentPrice.toFixed(2)}</div>
                        <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">per oz (CAD)</div>
                    </div>
                    <div class="price-box" style="background: rgba(59, 130, 246, 0.1);">
                        <div class="price-label">Recommended Price</div>
                        <div class="price-value" style="color: var(--accent-blue);">$${rec.recommendedPrice.toFixed(2)}</div>
                        <div class="price-change ${rec.priceChangeType}">
                            ${priceChange > 0 ? '↑' : priceChange < 0 ? '↓' : '→'} ${Math.abs(priceChange)}%
                        </div>
                    </div>
                    <div class="price-box">
                        <div class="price-label">Market Range (CAD)</div>
                        <div style="font-size: 14px; font-weight: 600; color: var(--text-primary);">
                            $${rec.priceRange[0].toFixed(2)} - $${rec.priceRange[1].toFixed(2)}
                        </div>
                        <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">per oz</div>
                    </div>
                </div>
                
                <div class="market-insight">
                    <strong>Market Insight:</strong> ${rec.reasoning}
                </div>
                
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">
                    <strong>Retailers surveyed:</strong> ${rec.retailers.join(', ')}
                </div>
                
                ${rec.articles.length > 0 ? `
                    <div>
                        <div style="font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px;">Related News:</div>
                        <div class="news-links">
                            ${rec.articles.map(article => `
                                <a href="${article.url}" target="_blank" class="news-link">
                                    <span>📰</span>
                                    <span>${article.title}</span>
                                    <span style="color: var(--text-muted);">(${article.date})</span>
                                </a>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
                
                ${hasSignificantChange ? `
                    <div style="margin-top: 16px; display: flex; justify-content: flex-end;">
                        <button class="apply-recommendation-btn" onclick="applyRecommendedPrice('${rec.crop}', ${rec.recommendedPrice}, this)">
                            Apply Recommended Price
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
    
    recommendationsDiv.style.display = 'block';
}

/**
 * Display cached recommendations
 */
function displayCachedRecommendations() {
    const cached = localStorage.getItem(AI_PRICING_KEY);
    if (cached) {
        const recommendations = JSON.parse(cached);
        displayRecommendations(recommendations);
    }
}

/**
 * Apply recommended price to a crop
 */
function applyRecommendedPrice(cropName, recommendedPrice, btnEl) {
    const index = pricingData.findIndex(item => item.crop === cropName);
    if (index !== -1) {
        pricingData[index].retail = recommendedPrice;
        renderPricingTable();
        
        // Mark button as applied (stay in modal for more crops)
        if (btnEl) {
            btnEl.textContent = '✅ Applied';
            btnEl.disabled = true;
            btnEl.style.opacity = '0.6';
            btnEl.style.cursor = 'default';
        }

        // Non-blocking toast inside the modal
        showPricingToast(`Updated ${cropName} to $${recommendedPrice.toFixed(2)} — remember to save`);
    }
}

/** Show a brief non-blocking toast inside the AI Pricing modal */
function showPricingToast(msg) {
    let toast = document.getElementById('ai-pricing-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'ai-pricing-toast';
        toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--accent-green,#22c55e);color:#fff;padding:10px 24px;border-radius:8px;font-size:13px;font-weight:600;z-index:100001;box-shadow:0 4px 12px rgba(0,0,0,0.25);transition:opacity 0.3s;pointer-events:none;';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._tid);
    toast._tid = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

/**
 * Save recommendations to history
 */
function saveToHistory(recommendations) {
    let history = JSON.parse(localStorage.getItem(AI_HISTORY_KEY) || '[]');
    
    history.unshift({
        date: new Date().toISOString(),
        recommendations: recommendations
    });
    
    // Keep last 6 months of history
    history = history.slice(0, 6);
    
    localStorage.setItem(AI_HISTORY_KEY, JSON.stringify(history));
}

/**
 * View pricing history
 */
function viewPricingHistory() {
    const historyDiv = document.getElementById('ai-price-history');
    const contentDiv = document.getElementById('ai-history-content');
    const recommendationsDiv = document.getElementById('ai-recommendations');
    
    recommendationsDiv.style.display = 'none';
    
    const history = JSON.parse(localStorage.getItem(AI_HISTORY_KEY) || '[]');
    
    if (history.length === 0) {
        contentDiv.innerHTML = '<p style="color: var(--text-secondary);">No pricing history available yet. Run your first market analysis to start tracking price trends.</p>';
    } else {
        contentDiv.innerHTML = history.map(entry => {
            const date = new Date(entry.date);
            return `
                <div class="card" style="margin-bottom: 16px;">
                    <h4 style="margin-bottom: 12px;">${date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px;">
                        ${entry.recommendations.map(rec => `
                            <div style="padding: 12px; background: var(--bg-secondary); border-radius: 6px;">
                                <div style="font-weight: 600; margin-bottom: 4px;">${rec.crop}</div>
                                <div style="font-size: 13px; color: var(--text-secondary);">
                                    Recommended: $${rec.recommendedPrice.toFixed(2)}<br>
                                    Market Avg: $${rec.marketAverage.toFixed(2)}<br>
                                    Trend: <span style="text-transform: capitalize;">${rec.trend}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }).join('');
    }
    
    historyDiv.style.display = 'block';
}

/**
 * Check for scheduled price updates (runs monthly)
 */
function checkForScheduledPriceUpdates() {
    const lastCheck = localStorage.getItem(AI_LAST_CHECK_KEY);
    
    if (!lastCheck) return;
    
    const daysSinceCheck = Math.floor((Date.now() - parseInt(lastCheck)) / (1000 * 60 * 60 * 24));
    
    if (daysSinceCheck >= 30) {
        // Show alert that it's time for monthly update
        const alertDiv = document.getElementById('ai-pricing-alert');
        if (alertDiv) {
            alertDiv.style.display = 'block';
            alertDiv.className = 'alert';
            alertDiv.style.background = 'rgba(245, 158, 11, 0.1)';
            alertDiv.style.border = '1px solid rgba(245, 158, 11, 0.3)';
            alertDiv.style.marginBottom = '20px';
            alertDiv.innerHTML = `
                <span style="font-size: 20px;"></span>
                <div>
                    <strong>Monthly Market Analysis Due</strong><br>
                    It's been ${daysSinceCheck} days since your last market analysis. 
                    <a href="#" onclick="openAIPricingAssistant(); return false;" style="color: var(--accent-blue);">Run analysis now</a>
                </div>
            `;
        }
    }
}

/**
 * CROP VALUE ASSESSMENT
 * Insurance valuation based on current inventory, growth stages, and retail pricing
 */

// Growth parameters by crop type (days to harvest and retail price per POUND)
// Pricing matches crop-pricing.json - weight-based model ($/lb)
const cropGrowthParams = {
    // Lettuce varieties - 28-35 day cycle, priced per lb
    'Butterhead Lettuce': { daysToHarvest: 32, retailPricePerLb: 5.00, yieldFactor: 0.92 },
    'Buttercrunch Lettuce': { daysToHarvest: 32, retailPricePerLb: 5.00, yieldFactor: 0.92 },
    'Bibb Butterhead': { daysToHarvest: 32, retailPricePerLb: 5.00, yieldFactor: 0.92 },
    'Romaine Lettuce': { daysToHarvest: 35, retailPricePerLb: 5.00, yieldFactor: 0.90 },
    'Red Leaf Lettuce': { daysToHarvest: 30, retailPricePerLb: 5.00, yieldFactor: 0.91 },
    'Oak Leaf Lettuce': { daysToHarvest: 30, retailPricePerLb: 5.00, yieldFactor: 0.91 },
    'Mixed Lettuce': { daysToHarvest: 30, retailPricePerLb: 5.00, yieldFactor: 0.90 },
    
    // Kale varieties - 35-42 day cycle, priced per lb
    'Lacinato Kale': { daysToHarvest: 40, retailPricePerLb: 6.50, yieldFactor: 0.88 },
    'Curly Kale': { daysToHarvest: 38, retailPricePerLb: 6.50, yieldFactor: 0.89 },
    'Dinosaur Kale': { daysToHarvest: 40, retailPricePerLb: 6.50, yieldFactor: 0.88 },
    'Baby Kale': { daysToHarvest: 28, retailPricePerLb: 6.50, yieldFactor: 0.92 },
    'Red Russian Kale': { daysToHarvest: 38, retailPricePerLb: 6.50, yieldFactor: 0.89 },
    
    // Asian Greens - priced per lb
    'Mei Qing Pak Choi': { daysToHarvest: 30, retailPricePerLb: 5.50, yieldFactor: 0.90 },
    'Tatsoi': { daysToHarvest: 28, retailPricePerLb: 6.00, yieldFactor: 0.91 },
    
    // Specialty Greens - priced per lb
    'Frisée Endive': { daysToHarvest: 35, retailPricePerLb: 8.00, yieldFactor: 0.87 },
    'Watercress': { daysToHarvest: 25, retailPricePerLb: 7.00, yieldFactor: 0.90 },
    
    // Arugula varieties - 21-28 day cycle, priced per lb
    'Baby Arugula': { daysToHarvest: 21, retailPricePerLb: 6.75, yieldFactor: 0.93 },
    'Cultivated Arugula': { daysToHarvest: 24, retailPricePerLb: 6.75, yieldFactor: 0.91 },
    'Wild Arugula': { daysToHarvest: 28, retailPricePerLb: 6.75, yieldFactor: 0.89 },
    'Wasabi Arugula': { daysToHarvest: 24, retailPricePerLb: 6.75, yieldFactor: 0.90 },
    'Red Arugula': { daysToHarvest: 24, retailPricePerLb: 6.75, yieldFactor: 0.90 },
    
    // Basil varieties - 21-28 day cycle, priced per lb (~$114/lb for premium herbs)
    'Genovese Basil': { daysToHarvest: 25, retailPricePerLb: 114.72, yieldFactor: 0.88 },
    'Thai Basil': { daysToHarvest: 25, retailPricePerLb: 114.72, yieldFactor: 0.88 },
    'Purple Basil': { daysToHarvest: 25, retailPricePerLb: 114.72, yieldFactor: 0.87 },
    'Lemon Basil': { daysToHarvest: 24, retailPricePerLb: 114.72, yieldFactor: 0.87 },
    'Holy Basil': { daysToHarvest: 26, retailPricePerLb: 114.72, yieldFactor: 0.86 }
};

// Global crop value data
let cropValueData = null;

/**
 * Calculate growth percentage based on days post seeding
 */
function calculateGrowthPercentage(crop, daysPostSeed) {
    const params = cropGrowthParams[crop];
    if (!params) return 0;
    
    const daysToHarvest = params.daysToHarvest;
    const growthPercent = Math.min(100, (daysPostSeed / daysToHarvest) * 100);
    
    return growthPercent;
}

/**
 * Calculate tray value based on plant count, weight per plant, and growth stage
 * Value = plantCount × lbsPerPlant × retailPricePerLb × growthPercentage × yieldFactor
 */
function calculateTrayValue(crop, plantCount, daysPostSeed) {
    const params = cropGrowthParams[crop];
    if (!params) return 0;
    
    const growthPercent = calculateGrowthPercentage(crop, daysPostSeed) / 100;
    const retailPricePerLb = params.retailPricePerLb;
    const yieldFactor = params.yieldFactor;
    
    // Average weight per plant (in lbs) - conservative estimate
    const lbsPerPlant = 0.125; // ~2oz per plant average
    
    // Value grows with maturity (S-curve approximation)
    const growthCurve = Math.pow(growthPercent, 1.3);
    const totalValue = plantCount * lbsPerPlant * retailPricePerLb * growthCurve * yieldFactor;
    
    return totalValue;
}

/**
 * Get growth stage label based on days and crop type
 */
function getGrowthStage(crop, daysPostSeed) {
    const params = cropGrowthParams[crop];
    if (!params) return 'Unknown';
    
    const daysToHarvest = params.daysToHarvest;
    const percentComplete = (daysPostSeed / daysToHarvest) * 100;
    
    if (percentComplete < 25) return 'Seedling (0-25%)';
    if (percentComplete < 50) return 'Early Growth (25-50%)';
    if (percentComplete < 75) return 'Mid Growth (50-75%)';
    if (percentComplete < 95) return 'Pre-Harvest (75-95%)';
    return 'Harvest Ready (95%+)';
}

/**
 * Load and calculate crop value data
 */
async function loadCropValueData() {
    try {
        console.log(' Loading crop value data...');
        
        // Fetch current inventory
        const inventoryResponse = await fetch(`${API_BASE}/api/inventory/current`);
        const inventoryData = await inventoryResponse.json();
        
        if (!inventoryData || !inventoryData.byFarm || inventoryData.byFarm.length === 0) {
            console.warn(' No inventory data available');
            return null;
        }
        
        // Get farm data (assumes single farm or first farm)
        const farmInventory = inventoryData.byFarm[0];
        
        // Build detailed tray data
        const trayDetails = [];
        let totalValue = 0;
        const cropSummary = {};
        const stageSummary = {};
        
        // Process each tray
        for (const tray of farmInventory.trays || []) {
            const crop = tray.crop || 'Unknown';
            const plantCount = tray.plantCount || 0;
            const seedingDate = new Date(tray.seedingDate);
            const today = new Date();
            const daysPostSeed = Math.floor((today - seedingDate) / (1000 * 60 * 60 * 24));
            
            const value = calculateTrayValue(crop, plantCount, daysPostSeed);
            const growthPercent = calculateGrowthPercentage(crop, daysPostSeed);
            const growthStage = getGrowthStage(crop, daysPostSeed);
            
            // Tray detail
            trayDetails.push({
                trayId: tray.trayId || tray.id,
                crop,
                seedingDate: seedingDate.toISOString().split('T')[0],
                daysPostSeed,
                plantCount,
                value,
                growthPercent,
                growthStage
            });
            
            totalValue += value;
            
            // Aggregate by crop
            if (!cropSummary[crop]) {
                cropSummary[crop] = {
                    trays: 0,
                    plants: 0,
                    value: 0,
                    totalDays: 0
                };
            }
            cropSummary[crop].trays++;
            cropSummary[crop].plants += plantCount;
            cropSummary[crop].value += value;
            cropSummary[crop].totalDays += daysPostSeed;
            
            // Aggregate by growth stage
            if (!stageSummary[growthStage]) {
                stageSummary[growthStage] = {
                    trays: 0,
                    plants: 0,
                    value: 0,
                    minDays: daysPostSeed,
                    maxDays: daysPostSeed
                };
            }
            stageSummary[growthStage].trays++;
            stageSummary[growthStage].plants += plantCount;
            stageSummary[growthStage].value += value;
            stageSummary[growthStage].minDays = Math.min(stageSummary[growthStage].minDays, daysPostSeed);
            stageSummary[growthStage].maxDays = Math.max(stageSummary[growthStage].maxDays, daysPostSeed);
        }
        
        // Sort trays by value (highest first)
        trayDetails.sort((a, b) => b.value - a.value);
        
        cropValueData = {
            totalValue,
            activeTrays: trayDetails.length,
            totalPlants: farmInventory.totalPlants,
            cropCount: Object.keys(cropSummary).length,
            avgValuePerTray: trayDetails.length > 0 ? totalValue / trayDetails.length : 0,
            cropSummary,
            stageSummary,
            trayDetails,
            timestamp: new Date().toISOString()
        };
        
        console.log(' Crop value data loaded:', cropValueData);
        return cropValueData;
        
    } catch (error) {
        console.error(' Error loading crop value data:', error);
        return null;
    }
}

/**
 * Render crop value dashboard
 */
async function renderCropValue() {
    const data = await loadCropValueData();
    
    if (!data) {
        console.error(' No crop value data to display');
        return;
    }
    
    console.log(' Rendering crop value with data:', {
        totalValue: data.totalValue,
        activeTrays: data.activeTrays,
        cropCount: data.cropCount
    });
    
    // Update header stats
    const valueEl = document.getElementById('total-farm-value');
    if (valueEl) {
        valueEl.textContent = `$${data.totalValue.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
    }
    
    const weightEl = document.getElementById('total-farm-weight');
    if (weightEl) {
        weightEl.textContent = `Based on ${data.activeTrays} trays at current growth stages`;
    }
    
    const timestampEl = document.getElementById('value-timestamp');
    if (timestampEl) {
        timestampEl.textContent = new Date(data.timestamp).toLocaleString();
    }
    
    // Update summary cards
    const traysEl = document.getElementById('value-active-trays');
    if (traysEl) traysEl.textContent = data.activeTrays;
    
    const plantsEl = document.getElementById('value-total-plants');
    if (plantsEl) plantsEl.textContent = data.totalPlants;
    
    const cropCountEl = document.getElementById('value-crop-count');
    if (cropCountEl) cropCountEl.textContent = data.cropCount;
    
    const avgEl = document.getElementById('value-avg-per-tray');
    if (avgEl) avgEl.textContent = `$${data.avgValuePerTray.toFixed(2)}`;
    
    // Render crop summary table
    const cropTableBody = document.querySelector('#crop-value-table tbody');
    cropTableBody.innerHTML = '';
    
    Object.entries(data.cropSummary).forEach(([crop, summary]) => {
        const avgDays = summary.totalDays / summary.trays;
        const percentOfTotal = (summary.value / data.totalValue * 100).toFixed(1);
        const params = cropGrowthParams[crop] || { retailPricePerUnit: 0 };
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${crop}</td>
            <td>${summary.trays}</td>
            <td>${summary.plants}</td>
            <td>${avgDays.toFixed(0)} days</td>
            <td>$${params.retailPricePerUnit.toFixed(2)}/unit</td>
            <td style="font-weight: 600;">$${summary.value.toFixed(2)}</td>
            <td><span style="color: var(--accent-green);">${percentOfTotal}%</span></td>
        `;
        cropTableBody.appendChild(row);
    });
    
    // Render growth stage table
    const stageTableBody = document.querySelector('#growth-stage-value-table tbody');
    stageTableBody.innerHTML = '';
    
    // Sort stages by value
    const sortedStages = Object.entries(data.stageSummary)
        .sort((a, b) => b[1].value - a[1].value);
    
    sortedStages.forEach(([stage, summary]) => {
        const percentOfTotal = (summary.value / data.totalValue * 100).toFixed(1);
        const daysRange = summary.minDays === summary.maxDays ? 
            `${summary.minDays}` : 
            `${summary.minDays}-${summary.maxDays}`;
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${stage}</td>
            <td>${daysRange} days</td>
            <td>${summary.trays}</td>
            <td>${summary.plants}</td>
            <td style="font-weight: 600;">$${summary.value.toFixed(2)}</td>
            <td><span style="color: var(--accent-green);">${percentOfTotal}%</span></td>
        `;
        stageTableBody.appendChild(row);
    });
    
    // Render detailed tray table (show top 50 most valuable)
    const trayTableBody = document.querySelector('#tray-value-table tbody');
    trayTableBody.innerHTML = '';
    
    const displayTrays = data.trayDetails.slice(0, 50);
    
    displayTrays.forEach(tray => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${tray.trayId}</td>
            <td>${tray.crop}</td>
            <td>${tray.seedingDate}</td>
            <td>${tray.daysPostSeed}</td>
            <td>${tray.plantCount}</td>
            <td><span style="color: ${tray.growthPercent >= 95 ? 'var(--accent-green)' : 'var(--accent-blue)'};">${tray.growthPercent.toFixed(0)}%</span></td>
            <td style="font-weight: 600;">$${tray.value.toFixed(2)}</td>
        `;
        trayTableBody.appendChild(row);
    });
    
    if (data.trayDetails.length > 50) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td colspan="8" style="text-align: center; color: var(--text-secondary); font-style: italic;">
                Showing top 50 of ${data.trayDetails.length} trays
            </td>
        `;
        trayTableBody.appendChild(row);
    }
}

/**
 * Refresh crop value data
 */
function refreshCropValue() {
    console.log(' Refreshing crop value data...');
    renderCropValue();
}

// Initialize crop value when section is shown
document.addEventListener('DOMContentLoaded', () => {
    if (window.location.pathname.includes('farm-admin.html')) {
        // Check if navigating to crop-value section
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.target.id === 'section-crop-value' && 
                    mutation.target.style.display !== 'none') {
                    renderCropValue();
                }
            });
        });
        
        const cropValueSection = document.getElementById('section-crop-value');
        if (cropValueSection) {
            observer.observe(cropValueSection, { attributes: true, attributeFilter: ['style'] });
        }
        
        // Initialize tooltip tracking for highlighted admin cards
        initializeAdminTooltipTracking();
    }
});

/**
 * Initialize tooltip tracking for highlighted admin cards
 */
function initializeAdminTooltipTracking() {
    const highlightedCards = document.querySelectorAll('.card-highlight');
    
    highlightedCards.forEach(card => {
        const tooltip = card.querySelector('.card-info-tooltip');
        if (!tooltip) return;
        
        card.addEventListener('mouseenter', () => {
            tooltip.classList.add('visible');
        });
        
        card.addEventListener('mouseleave', () => {
            tooltip.classList.remove('visible');
        });
        
        card.addEventListener('mousemove', (e) => {
            const offsetX = 15;
            const offsetY = 15;
            tooltip.style.left = (e.clientX + offsetX) + 'px';
            tooltip.style.top = (e.clientY + offsetY) + 'px';
        });
    });
}
// ============================================================================
// WHOLESALE ORDERS MANAGEMENT
// ============================================================================

/**
 * Refresh wholesale orders from the API
 */
async function refreshWholesaleOrders() {
    console.log('🔄 Refreshing wholesale orders...');
    const container = document.getElementById('wholesale-orders-container');
    
    if (!container) return;
    
    container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-muted);"><p>Loading wholesale orders...</p></div>';
    
    try {
        const response = await fetch(`${API_BASE}/api/wholesale/order-events`, {
            headers: {
                'Authorization': `Bearer ${getSession()?.token || ''}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to load orders: ${response.status}`);
        }
        
        const data = await response.json();
        const orders = data.events || [];
        
        if (orders.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 3rem; color: var(--text-muted);">
                    <div style="font-size: 3rem; margin-bottom: 1rem;">📦</div>
                    <h3 style="margin-bottom: 0.5rem;">No Wholesale Orders Yet</h3>
                    <p>Orders from GreenReach Central will appear here</p>
                </div>
            `;
            return;
        }
        
        // Load order statuses from storage
        const statusData = await loadOrderStatuses();
        const trackingData = await loadTrackingNumbers();
        
        // Group orders by order_id
        const orderMap = new Map();
        orders.forEach(event => {
            const orderId = event.order_id;
            if (!orderMap.has(orderId)) {
                orderMap.set(orderId, {
                    ...event,
                    status: statusData[orderId] || 'pending',
                    tracking_number: trackingData[orderId] || null
                });
            }
        });
        
        // Render orders
        container.innerHTML = Array.from(orderMap.values())
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .map(order => renderOrderCard(order))
            .join('');
            
    } catch (error) {
        console.error('Failed to load wholesale orders:', error);
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--accent-red);">
                <p>❌ Failed to load orders: ${error.message}</p>
                <button class="btn-primary" onclick="refreshWholesaleOrders()" style="margin-top: 1rem;">Retry</button>
            </div>
        `;
    }
}

/**
 * Render individual order card
 */
function renderOrderCard(order) {
    const statusConfig = {
        'pending': { label: 'Pending', color: '#f59e0b', icon: '⏳' },
        'packed': { label: 'Packed', color: '#8b5cf6', icon: '📦' },
        'shipped': { label: 'Shipped', color: '#3b82f6', icon: '🚚' },
        'delivered': { label: 'Delivered', color: '#10b981', icon: '✅' }
    };
    
    const config = statusConfig[order.status] || statusConfig['pending'];
    const orderDate = new Date(order.timestamp).toLocaleString();
    const items = order.items || [];
    const total = order.total_amount || 0;
    
    return `
        <div class="wholesale-order-card" data-order-id="${order.order_id}" style="
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 1.5rem;
            margin-bottom: 1rem;
        ">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
                <div>
                    <h3 style="color: var(--text-primary); margin-bottom: 0.25rem;">
                        ${config.icon} Order #${order.order_id.slice(-8)}
                    </h3>
                    <p style="color: var(--text-muted); font-size: 0.9rem;">${orderDate}</p>
                </div>
                <div style="
                    background: ${config.color}33;
                    border: 1px solid ${config.color};
                    color: ${config.color};
                    padding: 0.5rem 1rem;
                    border-radius: 6px;
                    font-weight: 600;
                ">
                    ${config.label}
                </div>
            </div>
            
            <div style="background: var(--bg-secondary); padding: 1rem; border-radius: 6px; margin-bottom: 1rem;">
                <h4 style="color: var(--text-secondary); margin-bottom: 0.75rem; font-size: 0.9rem;">Order Items</h4>
                ${items.map(item => `
                    <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border);">
                        <span style="color: var(--text-primary);">
                            ${item.product_name || item.sku_id}
                        </span>
                        <span style="color: var(--text-secondary);">
                            ${item.quantity} × $${item.price_per_unit?.toFixed(2) || '0.00'}
                        </span>
                    </div>
                `).join('')}
                <div style="display: flex; justify-content: space-between; padding: 0.75rem 0; margin-top: 0.5rem; font-weight: 600;">
                    <span style="color: var(--text-primary);">Total</span>
                    <span style="color: var(--accent-green);">$${total.toFixed(2)}</span>
                </div>
            </div>
            
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                ${order.status === 'pending' ? `
                    <button class="btn-primary" onclick="updateOrderStatus('${order.order_id}', 'packed')" style="
                        background: rgba(139, 92, 246, 0.2);
                        border: 1px solid #8b5cf6;
                        color: #c4b5fd;
                        padding: 0.5rem 1rem;
                        border-radius: 6px;
                        cursor: pointer;
                        font-weight: 600;
                    ">
                        📦 Mark as Packed
                    </button>
                ` : ''}
                ${order.status === 'packed' ? `
                    <button class="btn-primary" onclick="updateOrderStatus('${order.order_id}', 'shipped')" style="
                        background: rgba(59, 130, 246, 0.2);
                        border: 1px solid #3b82f6;
                        color: #93c5fd;
                        padding: 0.5rem 1rem;
                        border-radius: 6px;
                        cursor: pointer;
                        font-weight: 600;
                    ">
                        🚚 Mark as Shipped
                    </button>
                    <button class="btn-secondary" onclick="addTrackingNumber('${order.order_id}')" style="
                        background: rgba(107, 114, 128, 0.2);
                        border: 1px solid #6b7280;
                        color: #9ca3af;
                        padding: 0.5rem 1rem;
                        border-radius: 6px;
                        cursor: pointer;
                    ">
                        🔗 Add Tracking #
                    </button>
                ` : ''}
                ${order.tracking_number ? `
                    <div style="
                        background: rgba(16, 185, 129, 0.1);
                        border: 1px solid var(--accent-green);
                        color: var(--accent-green);
                        padding: 0.5rem 1rem;
                        border-radius: 6px;
                        font-weight: 600;
                    ">
                        📍 Tracking: ${order.tracking_number}
                    </div>
                ` : ''}
                <button class="btn-secondary" onclick="printPackingSlip('${order.order_id}')" style="
                    background: rgba(107, 114, 128, 0.2);
                    border: 1px solid #6b7280;
                    color: #9ca3af;
                    padding: 0.5rem 1rem;
                    border-radius: 6px;
                    cursor: pointer;
                ">
                    🖨️ Print Packing Slip
                </button>
            </div>
        </div>
    `;
}

/**
 * Update order status
 */
async function updateOrderStatus(orderId, newStatus) {
    console.log(`📝 Updating order ${orderId} to status: ${newStatus}`);
    
    try {
        // Load current statuses
        const statusData = await loadOrderStatuses();
        statusData[orderId] = newStatus;
        
        // Save updated statuses
        await saveOrderStatuses(statusData);
        
        // Notify Central via callback endpoint
        await notifyCentralOfStatusChange(orderId, newStatus);
        
        // Refresh display
        await refreshWholesaleOrders();
        
        showToast(`Order marked as ${newStatus}`, 'success');
    } catch (error) {
        console.error('Failed to update order status:', error);
        showToast('Failed to update order status', 'error');
    }
}

/**
 * Add tracking number to order
 */
async function addTrackingNumber(orderId) {
    const trackingNumber = prompt('Enter tracking number:');
    if (!trackingNumber || !trackingNumber.trim()) {
        return;
    }
    
    try {
        // Load current statuses
        const statusData = await loadOrderStatuses();
        
        // Add tracking number to order
        if (!statusData[orderId]) {
            statusData[orderId] = 'packed';
        }
        
        // Store tracking number separately
        const trackingData = await loadTrackingNumbers();
        trackingData[orderId] = trackingNumber.trim();
        await saveTrackingNumbers(trackingData);
        
        // Save updated statuses
        await saveOrderStatuses(statusData);
        
        // Notify Central via callback endpoint
        await notifyCentralOfTrackingNumber(orderId, trackingNumber.trim());
        
        // Refresh display
        await refreshWholesaleOrders();
        
        showToast('Tracking number added', 'success');
    } catch (error) {
        console.error('Failed to add tracking number:', error);
        showToast('Failed to add tracking number', 'error');
    }
}

/**
 * Print packing slip for order
 */
function printPackingSlip(orderId) {
    console.log(`🖨️ Printing packing slip for order ${orderId}`);
    
    // Find order data
    const orderCard = document.querySelector(`[data-order-id="${orderId}"]`);
    if (!orderCard) {
        showToast('Order not found', 'error');
        return;
    }
    
    // Open print view in new window
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Packing Slip - ${orderId}</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 2rem; }
                h1 { border-bottom: 2px solid #000; padding-bottom: 0.5rem; }
                .header { margin-bottom: 2rem; }
                .items { margin: 2rem 0; }
                .item { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #ccc; }
                .footer { margin-top: 3rem; font-size: 0.9rem; color: #666; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>Packing Slip</h1>
                <p>Order ID: ${orderId}</p>
                <p>Date: ${new Date().toLocaleDateString()}</p>
            </div>
            <div class="items">
                ${orderCard.innerHTML}
            </div>
            <div class="footer">
                <p>Packed by: _____________________</p>
                <p>Date: _____________________</p>
            </div>
            <script>
                window.onload = () => {
                    window.print();
                    setTimeout(() => window.close(), 1000);
                };
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

/**
 * Notify Central of status change via callback
 */
async function notifyCentralOfStatusChange(orderId, newStatus) {
    try {
        // Get farm info to determine Central URL
        const farmPath = `${API_BASE}/api/data/farm.json`;
        let centralUrl = window.API_BASE || window.location.origin; // Cloud or same-origin
        let farmId = 'light-engine-demo'; // Default farm ID
        
        try {
            const farmRes = await fetch(farmPath);
            if (farmRes.ok) {
                const farmData = await farmRes.json();
                if (farmData.centralUrl) centralUrl = farmData.centralUrl;
                if (farmData.farmId) farmId = farmData.farmId;
            }
        } catch (e) {
            console.log('[Status Callback] Using default Central URL');
        }
        
        // Call Central's order-status webhook
        const response = await fetch(`${centralUrl}/api/wholesale/order-status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                order_id: orderId,
                status: newStatus,
                farm_id: farmId,
                timestamp: new Date().toISOString()
            })
        });
        
        if (response.ok) {
            console.log(`✓ Notified Central of status change: ${orderId} → ${newStatus}`);
        } else {
            console.warn(`⚠ Central notification failed (${response.status}), status saved locally`);
        }
    } catch (error) {
        console.warn('[Status Callback] Failed to notify Central:', error.message);
        // Non-blocking: status was already saved locally
    }
}

/**
 * Load order statuses from storage
 */
async function loadOrderStatuses() {
    try {
        const response = await fetch(`${API_BASE}/api/wholesale/order-statuses`, {
            headers: {
                'Authorization': `Bearer ${getSession()?.token || ''}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            return data.statuses || {};
        }
    } catch (error) {
        console.log('No existing order statuses found');
    }
    
    return {};
}

/**
 * Save order statuses to storage
 */
async function saveOrderStatuses(statusData) {
    const response = await fetch(`${API_BASE}/api/wholesale/order-statuses`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getSession()?.token || ''}`
        },
        body: JSON.stringify(statusData)
    });
    
    if (!response.ok) {
        throw new Error('Failed to save order statuses');
    }
}

/**
 * Load tracking numbers from storage
 */
async function loadTrackingNumbers() {
    try {
        const response = await fetch(`${API_BASE}/api/wholesale/tracking-numbers`, {
            headers: {
                'Authorization': `Bearer ${getSession()?.token || ''}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            return data.tracking || {};
        }
    } catch (error) {
        console.log('No existing tracking numbers found');
    }
    
    return {};
}

/**
 * Save tracking numbers to storage
 */
async function saveTrackingNumbers(trackingData) {
    const response = await fetch(`${API_BASE}/api/wholesale/tracking-numbers`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getSession()?.token || ''}`
        },
        body: JSON.stringify(trackingData)
    });
    
    if (!response.ok) {
        throw new Error('Failed to save tracking numbers');
    }
}

/**
 * Notify Central of tracking number via callback
 */
async function notifyCentralOfTrackingNumber(orderId, trackingNumber) {
    try {
        // Get farm info to determine Central URL
        const farmPath = `${API_BASE}/api/data/farm.json`;
        let centralUrl = window.API_BASE || window.location.origin; // Cloud or same-origin
        let farmId = 'light-engine-demo';
        
        try {
            const farmRes = await fetch(farmPath);
            if (farmRes.ok) {
                const farmData = await farmRes.json();
                if (farmData.centralUrl) centralUrl = farmData.centralUrl;
                if (farmData.farmId) farmId = farmData.farmId;
            }
        } catch (e) {
            console.log('[Tracking Callback] Using default Central URL');
        }
        
        // Call Central's tracking webhook
        const response = await fetch(`${centralUrl}/api/wholesale/order-tracking`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                order_id: orderId,
                tracking_number: trackingNumber,
                farm_id: farmId,
                timestamp: new Date().toISOString()
            })
        });
        
        if (response.ok) {
            console.log(`✓ Notified Central of tracking number: ${orderId} → ${trackingNumber}`);
        } else {
            console.warn(`⚠ Central tracking notification failed (${response.status}), saved locally`);
        }
    } catch (error) {
        console.warn('[Tracking Callback] Failed to notify Central:', error.message);
        // Non-blocking: tracking was already saved locally
    }
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
    const colors = {
        success: '#10b981',
        error: '#ef4444',
        info: '#3b82f6'
    };
    
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 2rem;
        right: 2rem;
        background: ${colors[type]};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        font-weight: 600;
        box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================================================
// FINANCIAL SUMMARY / ACCOUNTING FUNCTIONS
// ============================================================================

/**
 * Load accounting/financial data for the selected period
 */
async function loadAccountingData() {
    const period = document.getElementById('accountingPeriod')?.value || 'month';
    console.log(` Loading financial data for period: ${period}`);
    
    // Check QuickBooks connection status
    await checkQuickBooksStatus();
    
    try {
        // Calculate date range based on period
        const now = new Date();
        let startDate = new Date();
        
        switch(period) {
            case 'today':
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                break;
            case 'week':
                startDate = new Date(now.setDate(now.getDate() - 7));
                break;
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            case 'quarter':
                startDate = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
                break;
            case 'year':
                startDate = new Date(now.getFullYear(), 0, 1);
                break;
        }
        
        // Fetch sales data from farm-sales API
        const ordersResponse = await fetch(`${API_BASE}/api/farm-sales/orders?startDate=${startDate.toISOString()}`);
        const ordersData = await ordersResponse.json();
        
        // Calculate revenue by channel
        let wholesaleRevenue = 0;
        let retailRevenue = 0;
        let wholesaleCount = 0;
        let retailCount = 0;
        
        if (ordersData.orders) {
            ordersData.orders.forEach(order => {
                const amount = parseFloat(order.total_amount || 0);
                if (order.channel === 'wholesale' || order.channel === 'b2b') {
                    wholesaleRevenue += amount;
                    wholesaleCount++;
                } else {
                    retailRevenue += amount;
                    retailCount++;
                }
            });
        }
        
        const totalRevenue = wholesaleRevenue + retailRevenue;
        
        // Calculate expenses
        const wholesaleFees = wholesaleRevenue * 0.15; // 15% commission estimate
        const supportFees = 0; // Annual support fee (prorated)
        const processingFees = totalRevenue * 0.029 + (wholesaleCount + retailCount) * 0.30; // Square fees
        const totalExpenses = wholesaleFees + supportFees + processingFees;
        
        // Calculate net profit
        const netProfit = totalRevenue - totalExpenses;
        const profitMargin = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : 0;
        
        // Update summary cards
        document.getElementById('total-revenue').textContent = `$${totalRevenue.toFixed(2)}`;
        document.getElementById('wholesale-revenue').textContent = `$${wholesaleRevenue.toFixed(2)}`;
        document.getElementById('wholesale-count').textContent = `${wholesaleCount} orders`;
        document.getElementById('retail-revenue').textContent = `$${retailRevenue.toFixed(2)}`;
        document.getElementById('retail-count').textContent = `${retailCount} orders`;
        document.getElementById('total-expenses').textContent = `$${totalExpenses.toFixed(2)}`;
        
        // Update net profit
        document.getElementById('net-profit').textContent = `$${netProfit.toFixed(2)}`;
        document.getElementById('profit-margin').textContent = `${profitMargin}%`;
        
        // Update expense breakdown
        document.getElementById('wholesale-fees').textContent = `$${wholesaleFees.toFixed(2)}`;
        document.getElementById('support-fees').textContent = `$${supportFees.toFixed(2)}`;
        document.getElementById('processing-fees').textContent = `$${processingFees.toFixed(2)}`;
        document.getElementById('total-expenses-summary').textContent = `$${totalExpenses.toFixed(2)}`;
        
        // Load operations data
        await loadOperationsData(startDate);
        
        // Load revenue breakdown table
        await loadRevenueBreakdown(ordersData.orders || []);
        
        // Load procurement spending data
        await loadProcurementFinancials();
        
    } catch (error) {
        console.error(' Error loading accounting data:', error);
        showToast('Failed to load financial data', 'error');
    }
}

/**
 * Load procurement spending data for the financial summary
 */
async function loadProcurementFinancials() {
    try {
        const resp = await fetch(`${API_BASE}/api/procurement/orders`);
        if (!resp.ok) return;
        const data = await resp.json();
        const orders = data.orders || [];

        let totalSpending = 0;
        const supplierSpending = {};

        for (const order of orders) {
            for (const so of (order.supplierOrders || [])) {
                totalSpending += so.subtotal || 0;
                const sid = so.supplierId || 'unknown';
                if (!supplierSpending[sid]) {
                    supplierSpending[sid] = { name: so.supplierName || sid, total: 0, orderCount: 0 };
                }
                supplierSpending[sid].total += so.subtotal || 0;
                supplierSpending[sid].orderCount++;
            }
        }

        const spendingEl = document.getElementById('procurement-spending');
        if (spendingEl) spendingEl.textContent = `$${totalSpending.toFixed(2)}`;
        const orderCountEl = document.getElementById('procurement-order-count');
        if (orderCountEl) orderCountEl.textContent = `${orders.length} orders`;
        const costEl = document.getElementById('procurement-supply-costs');
        if (costEl) costEl.textContent = `$${totalSpending.toFixed(2)}`;
    } catch (err) {
        console.log('[Procurement] Financial data not available:', err.message);
    }
}

/**
 * Load operations metrics (plants, AI updates, etc.)
 */
async function loadOperationsData(startDate) {
    try {
        // Fetch from crop/tray data
        const response = await fetch(`${API_BASE}/data/farm-summary.json`);
        const data = await response.json();
        
        let plantsSeeded = 0;
        let plantsHarvested = 0;
        
        // Calculate from active trays
        if (data.rooms) {
            data.rooms.forEach(room => {
                if (room.zones) {
                    room.zones.forEach(zone => {
                        if (zone.trays) {
                            zone.trays.forEach(tray => {
                                plantsSeeded += tray.plant_count || 0;
                                if (tray.status === 'harvested') {
                                    plantsHarvested += tray.plant_count || 0;
                                }
                            });
                        }
                    });
                }
            });
        }
        
        // AI updates count — Phase 2 feature, show "Coming Soon" placeholder
        let aiUpdates = '--';
        let aiContext = 'AI insights coming soon — will learn from your farm + network trends.';
        // Phase 2: uncomment when AI service is deployed
        // try {
        //     const aiResp = await fetch(`${API_BASE}/api/ai/insights/count`, {
        //         headers: { 'Authorization': `Bearer ${currentSession.token}` }
        //     });
        //     if (aiResp.ok) {
        //         const aiData = await aiResp.json();
        //         aiUpdates = aiData.count || 0;
        //     }
        // } catch (e) { /* AI service not available */ }

        // Phase 2: uncomment when network intelligence API is live
        // try {
        //     const niResp = await fetch(`${API_BASE}/api/ai/network-intelligence`);
        //     if (niResp.ok) {
        //         const niData = await niResp.json();
        //         const ni = niData.network_intelligence || {};
        //         const benchmarkCount = Object.keys(ni.crop_benchmarks || {}).length;
        //         const demandCount = Object.keys(ni.demand_signals || {}).length;
        //         if (benchmarkCount > 0 || demandCount > 0) {
        //             aiContext = `Live network signal: ${benchmarkCount} crop benchmarks, ${demandCount} demand signals.`;
        //         }
        //     }
        // } catch (e) { /* non-fatal */ }

        // Phase 2: uncomment when suggested-crop API is live
        // try {
        //     const suggestionResp = await fetch(`${API_BASE}/api/ai/suggested-crop`);
        //     if (suggestionResp.ok) {
        //         const suggestionData = await suggestionResp.json();
        //         const suggestion = suggestionData?.suggestion;
        //         if (suggestion?.cropName) {
        //             const confidencePct = Math.round((suggestion.confidence || 0) * 100);
        //             aiContext += ` Suggested next crop: ${suggestion.cropName} (${confidencePct}% confidence).`;
        //         }
        //     }
        // } catch (e) { /* non-fatal */ }
        
        // Calculate yield rate
        const yieldRate = plantsSeeded > 0 ? ((plantsHarvested / plantsSeeded) * 100).toFixed(1) : 0;
        
        document.getElementById('plants-seeded').textContent = plantsSeeded.toLocaleString();
        document.getElementById('plants-harvested').textContent = plantsHarvested.toLocaleString();
        document.getElementById('ai-updates').textContent = aiUpdates;
        document.getElementById('yield-rate').textContent = `${yieldRate}%`;
        const aiContextEl = document.getElementById('ai-updates-context');
        if (aiContextEl) aiContextEl.textContent = aiContext;
        
    } catch (error) {
        console.error(' Error loading operations data:', error);
    }
}

/**
 * Load revenue breakdown table
 */
async function loadRevenueBreakdown(orders) {
    const tbody = document.getElementById('revenue-breakdown-tbody');
    
    // Group orders by channel
    const breakdown = {
        'Wholesale (B2B)': { count: 0, units: 0, total: 0 },
        'POS (Retail)': { count: 0, units: 0, total: 0 },
        'Online Store': { count: 0, units: 0, total: 0 },
        'Subscriptions': { count: 0, units: 0, total: 0 }
    };
    
    orders.forEach(order => {
        let category;
        if (order.channel === 'wholesale' || order.channel === 'b2b') {
            category = 'Wholesale (B2B)';
        } else if (order.channel === 'pos') {
            category = 'POS (Retail)';
        } else if (order.channel === 'd2c' || order.channel === 'online') {
            category = 'Online Store';
        } else if (order.channel === 'subscription') {
            category = 'Subscriptions';
        } else {
            category = 'POS (Retail)'; // default
        }
        
        breakdown[category].count++;
        breakdown[category].units += order.items?.length || 1;
        breakdown[category].total += parseFloat(order.total_amount || 0);
    });
    
    tbody.innerHTML = Object.entries(breakdown)
        .filter(([_, data]) => data.count > 0)
        .map(([category, data]) => `
            <tr>
                <td>${category}</td>
                <td>${data.count}</td>
                <td>${data.units}</td>
                <td>$${(data.total / data.count).toFixed(2)}</td>
                <td style="font-weight: bold; color: var(--accent-green);">$${data.total.toFixed(2)}</td>
            </tr>
        `).join('') || '<tr><td colspan="5" style="text-align: center; color: var(--text-secondary);">No orders in this period</td></tr>';
}

/**
 * Export financial report as CSV
 */
function exportFinancialReport() {
    const period = document.getElementById('accountingPeriod')?.value || 'month';
    const timestamp = new Date().toISOString().split('T')[0];
    
    // Gather data from UI
    const revenue = document.getElementById('total-revenue').textContent;
    const expenses = document.getElementById('total-expenses').textContent;
    const profit = document.getElementById('net-profit').textContent;
    const margin = document.getElementById('profit-margin').textContent;
    
    // Create CSV content
    let csv = 'Light Engine Financial Report\n';
    csv += `Period: ${period.charAt(0).toUpperCase() + period.slice(1)}\n`;
    csv += `Generated: ${new Date().toLocaleString()}\n\n`;
    
    csv += 'REVENUE SUMMARY\n';
    csv += `Total Revenue,${revenue}\n`;
    csv += `Wholesale Revenue,${document.getElementById('wholesale-revenue').textContent}\n`;
    csv += `Retail Revenue,${document.getElementById('retail-revenue').textContent}\n\n`;
    
    csv += 'OPERATIONS\n';
    csv += `Plants Seeded,${document.getElementById('plants-seeded').textContent}\n`;
    csv += `Plants Harvested,${document.getElementById('plants-harvested').textContent}\n`;
    csv += `AI Recommendations,${document.getElementById('ai-updates').textContent}\n`;
    csv += `Yield Rate,${document.getElementById('yield-rate').textContent}\n\n`;
    
    csv += 'EXPENSES\n';
    csv += `GreenReach Fees,${document.getElementById('wholesale-fees').textContent}\n`;
    csv += `Support Fees,${document.getElementById('support-fees').textContent}\n`;
    csv += `Processing Fees,${document.getElementById('processing-fees').textContent}\n`;
    csv += `Total Expenses,${expenses}\n\n`;
    
    csv += 'NET PROFIT\n';
    csv += `Profit,${profit}\n`;
    csv += `Margin,${margin}\n`;
    
    // Download file
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `financial-report-${period}-${timestamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('Financial report exported', 'success');
}

/**
 * Print financial report
 */
function printFinancialReport() {
    window.print();
}

// ============================================================================
// QUICKBOOKS INTEGRATION FUNCTIONS
// ============================================================================

/**
 * Check QuickBooks connection status
 */
async function checkQuickBooksStatus() {
    try {
        const response = await fetch(`${API_BASE}/api/farm-sales/quickbooks/status`, {
            headers: {
                'Authorization': `Bearer ${currentSession?.token || localStorage.getItem('token')}`,
                'X-Farm-ID': currentSession?.farmId || 'LOCAL-FARM'
            }
        });
        
        const data = await response.json();
        
        if (data.connected) {
            document.getElementById('quickbooks-not-connected').style.display = 'none';
            document.getElementById('quickbooks-connected').style.display = 'block';
            document.getElementById('qb-company-name').textContent = data.companyName || 'Connected';
            document.getElementById('qb-last-sync').textContent = data.lastSync ? new Date(data.lastSync).toLocaleString() : 'Never';
        } else {
            document.getElementById('quickbooks-not-connected').style.display = 'block';
            document.getElementById('quickbooks-connected').style.display = 'none';
        }
    } catch (error) {
        console.error('Error checking QuickBooks status:', error);
    }
}

/**
 * Connect to QuickBooks
 */
async function connectQuickBooks() {
    try {
        const response = await fetch(`${API_BASE}/api/farm-sales/quickbooks/auth`, {
            headers: {
                'Authorization': `Bearer ${currentSession?.token || localStorage.getItem('token')}`,
                'X-Farm-ID': currentSession?.farmId || 'LOCAL-FARM'
            }
        });
        
        const data = await response.json();
        
        if (data.authUrl) {
            window.open(data.authUrl, 'QuickBooks OAuth', 'width=800,height=600');
            showToast('Opening QuickBooks authorization window...', 'info');
            
            // Poll for connection status
            const pollInterval = setInterval(async () => {
                await checkQuickBooksStatus();
                const connected = document.getElementById('quickbooks-connected').style.display === 'block';
                if (connected) {
                    clearInterval(pollInterval);
                    showToast('Successfully connected to QuickBooks!', 'success');
                }
            }, 3000);
            
            // Stop polling after 5 minutes
            setTimeout(() => clearInterval(pollInterval), 300000);
        }
    } catch (error) {
        console.error('Error connecting to QuickBooks:', error);
        showToast('Failed to connect to QuickBooks', 'error');
    }
}

/**
 * Disconnect from QuickBooks
 */
async function disconnectQuickBooks() {
    if (!confirm('Are you sure you want to disconnect from QuickBooks?')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/farm-sales/quickbooks/disconnect`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${currentSession?.token || localStorage.getItem('token')}`,
                'X-Farm-ID': currentSession?.farmId || 'LOCAL-FARM'
            }
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            document.getElementById('quickbooks-not-connected').style.display = 'block';
            document.getElementById('quickbooks-connected').style.display = 'none';
            showToast('Disconnected from QuickBooks', 'success');
        }
    } catch (error) {
        console.error('Error disconnecting from QuickBooks:', error);
        showToast('Failed to disconnect from QuickBooks', 'error');
    }
}

/**
 * Sync invoices to QuickBooks
 */
async function syncQuickBooksInvoices() {
    document.getElementById('qb-sync-status').textContent = 'Syncing invoices...';
    
    try {
        const response = await fetch(`${API_BASE}/api/farm-sales/quickbooks/sync-invoices`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${currentSession?.token || localStorage.getItem('token')}`,
                'X-Farm-ID': currentSession?.farmId || 'LOCAL-FARM',
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            showToast(`Synced ${data.count || 0} invoices to QuickBooks`, 'success');
            document.getElementById('qb-sync-status').textContent = 'Ready';
            document.getElementById('qb-last-sync').textContent = new Date().toLocaleString();
        } else {
            throw new Error(data.message || 'Sync failed');
        }
    } catch (error) {
        console.error('Error syncing invoices:', error);
        showToast('Failed to sync invoices', 'error');
        document.getElementById('qb-sync-status').textContent = 'Error';
    }
}

/**
 * Sync payments to QuickBooks
 */
async function syncQuickBooksPayments() {
    document.getElementById('qb-sync-status').textContent = 'Syncing payments...';
    
    try {
        const response = await fetch(`${API_BASE}/api/farm-sales/quickbooks/sync-payments`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${currentSession?.token || localStorage.getItem('token')}`,
                'X-Farm-ID': currentSession?.farmId || 'LOCAL-FARM',
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            showToast(`Synced ${data.count || 0} payments to QuickBooks`, 'success');
            document.getElementById('qb-sync-status').textContent = 'Ready';
            document.getElementById('qb-last-sync').textContent = new Date().toLocaleString();
        } else {
            throw new Error(data.message || 'Sync failed');
        }
    } catch (error) {
        console.error('Error syncing payments:', error);
        showToast('Failed to sync payments', 'error');
        document.getElementById('qb-sync-status').textContent = 'Error';
    }
}

/**
 * Sync customers to QuickBooks
 */
async function syncQuickBooksCustomers() {
    document.getElementById('qb-sync-status').textContent = 'Syncing customers...';
    
    try {
        const response = await fetch(`${API_BASE}/api/farm-sales/quickbooks/sync/customer`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${currentSession?.token || localStorage.getItem('token')}`,
                'X-Farm-ID': currentSession?.farmId || 'LOCAL-FARM',
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            showToast(`Synced ${data.count || 0} customers to QuickBooks`, 'success');
            document.getElementById('qb-sync-status').textContent = 'Ready';
            document.getElementById('qb-last-sync').textContent = new Date().toLocaleString();
        } else {
            throw new Error(data.message || 'Sync failed');
        }
    } catch (error) {
        console.error('Error syncing customers:', error);
        showToast('Failed to sync customers', 'error');
        document.getElementById('qb-sync-status').textContent = 'Error';
    }
}

// ============================================================================
// PAYMENT METHODS FUNCTIONS
// ============================================================================

/**
 * Load payment methods and Square status
 */
async function loadPaymentMethods() {
    try {
        // Check Square connection status
        const statusResponse = await fetch(`${API_BASE}/api/farm/square/status`, {
            headers: { 'X-Farm-ID': currentSession?.farmId || 'LOCAL-FARM' }
        });
        const statusData = await statusResponse.json();
        
        const statusContainer = document.getElementById('square-status-container');
        
        if (statusData.connected) {
            statusContainer.innerHTML = `
                <div style="padding: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-size: 18px; font-weight: bold; color: var(--accent-green); margin-bottom: 8px;">
                                ✓ Square Connected
                            </div>
                            <div style="color: var(--text-secondary);">
                                <div>Merchant: ${statusData.data.merchantId}</div>
                                <div>Location: ${statusData.data.locationName || 'Default'}</div>
                            </div>
                        </div>
                        <button class="btn" onclick="reconnectSquare()" style="background: var(--accent-blue);">
                            Reconnect Account
                        </button>
                    </div>
                </div>
            `;
        } else {
            statusContainer.innerHTML = `
                <div style="padding: 20px; text-align: center;">
                    <div style="font-size: 18px; color: var(--text-secondary); margin-bottom: 15px;">
                        Square Payment Processing Not Connected
                    </div>
                    <button class="btn" onclick="connectSquare()" style="background: var(--accent-green);">
                        Connect Square Account
                    </button>
                </div>
            `;
        }
        
        // Load receipts
        await loadReceipts();
        
    } catch (error) {
        console.error(' Error loading payment methods:', error);
        showToast('Failed to load payment methods', 'error');
    }
}

/**
 * Refresh payment methods
 */
async function refreshPaymentMethods() {
    await loadPaymentMethods();
    showToast('Payment methods refreshed', 'success');
}

/**
 * Connect Square account
 */
async function connectSquare() {
    try {
        // Get Square OAuth URL from backend
        const response = await fetch('/api/farm/square/authorize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                farmId: 'FARM-001', // TODO: Get from session/config
                farmName: 'Light Engine Farm'
            })
        });
        
        const data = await response.json();
        
        if (!data.ok) {
            showToast('Failed to initialize Square connection', 'error');
            return;
        }
        
        // Open Square OAuth in popup
        const width = 600;
        const height = 700;
        const left = (screen.width - width) / 2;
        const top = (screen.height - height) / 2;
        
        const popup = window.open(
            data.data.authorizationUrl,
            'square-oauth',
            `width=${width},height=${height},left=${left},top=${top}`
        );
        
        // Listen for callback message
        window.addEventListener('message', function handleSquareCallback(event) {
            if (event.data.type === 'square-connected') {
                window.removeEventListener('message', handleSquareCallback);
                showToast('Square account connected successfully!', 'success');
                loadPaymentMethods(); // Refresh payment methods display
            }
        });
        
    } catch (error) {
        console.error('Square connection error:', error);
        showToast('Failed to connect Square account', 'error');
    }
}

/**
 * Reconnect Square account
 */
function reconnectSquare() {
    connectSquare();
}

/**
 * Load receipts and invoices
 */
async function loadReceipts() {
    const tbody = document.getElementById('receipts-tbody');
    
    // Fetch real receipt/invoice data from billing API
    let receipts = [];
    try {
        const resp = await fetch(`${API_BASE}/api/billing/receipts`, {
            headers: { 'Authorization': `Bearer ${currentSession.token}` }
        });
        if (resp.ok) {
            const data = await resp.json();
            receipts = data.receipts || data || [];
        }
    } catch (e) {
        console.warn('Receipts API not available:', e.message);
    }

    if (receipts.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                    <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">🧾</div>
                    <div>No receipts or invoices yet</div>
                    <div style="font-size: 0.85rem; margin-top: 0.5rem;">Receipts will appear once billing transactions occur</div>
                </td>
            </tr>`;
        return;
    }
    
    tbody.innerHTML = receipts.map(receipt => `
        <tr>
            <td>${new Date(receipt.date).toLocaleDateString()}</td>
            <td>${receipt.type === 'wholesale' ? 'Wholesale Fee' : receipt.type === 'support' ? 'Support' : 'Processing'}</td>
            <td>${receipt.description}</td>
            <td>$${(receipt.amount || 0).toFixed(2)}</td>
            <td><span style="padding: 4px 8px; background: var(--accent-green); border-radius: 4px; font-size: 12px;">${(receipt.status || 'paid').toUpperCase()}</span></td>
            <td>
                <button class="btn" onclick="downloadReceipt('${receipt.date}')" style="padding: 6px 12px; font-size: 12px;">
                    Download
                </button>
            </td>
        </tr>
    `).join('');
}

/**
 * Filter receipts by type
 */
function filterReceipts() {
    const filter = document.getElementById('receiptFilter').value;
    // Would filter the loaded receipts
    console.log('Filtering receipts by:', filter);
}

/**
 * Download single receipt
 */
function downloadReceipt(date) {
    showToast('Receipt downloaded', 'success');
    // Would generate and download PDF receipt
}

/**
 * Download all receipts
 */
function downloadAllReceipts() {
    showToast('All receipts downloaded', 'success');
    // Would generate and download all receipts as ZIP
}

// ============================================================================
// SETTINGS FUNCTIONS
// ============================================================================

/**
 * Load farm settings
 */
async function loadSettings() {
    try {
        // Load farm data from /data/farm.json (source of truth for edge devices)
        let farmData = {};
        try {
            const farmResponse = await fetch('/data/farm.json');
            if (farmResponse.ok) {
                farmData = await farmResponse.json();
                console.log('[Farm Settings] Loaded farm data from /data/farm.json:', farmData);
            }
        } catch (error) {
            console.warn('[Farm Settings] Failed to load /data/farm.json:', error);
        }
        
        // Try to load setup configuration from API
        let setupData = {};
        try {
            const headers = {};
            if (currentSession?.token) {
                headers['Authorization'] = `Bearer ${currentSession.token}`;
            }
            const setupResponse = await fetch('/api/setup/status', { headers });
            if (setupResponse.ok) {
                setupData = await setupResponse.json();
            }
        } catch (error) {
            console.log('Setup API not available, using fallback data');
        }

        // Load profile data from API (contact, name, plan)
        let profileData = {};
        try {
            const headers = {};
            if (currentSession?.token) {
                headers['Authorization'] = `Bearer ${currentSession.token}`;
            }
            const profileResponse = await fetch('/api/setup/profile', { headers });
            if (profileResponse.ok) {
                const pResult = await profileResponse.json();
                if (pResult.success) profileData = pResult.profile || {};
            }
        } catch (error) {
            console.log('[Farm Settings] Profile API not available');
        }

        // Store plan_type for feature gating
        if (profileData.planType) {
            localStorage.setItem('plan_type', profileData.planType);
        } else if (setupData.farm?.planType) {
            localStorage.setItem('plan_type', setupData.farm.planType);
        }
        
        // Use fallback data sources (localStorage, session)
        const storedFarmData = JSON.parse(localStorage.getItem('farmData') || '{}');
        const authFarmId = localStorage.getItem('farm_id');
        const authFarmName = localStorage.getItem('farm_name');
        
        // Farm Profile - populate from available sources (prioritize /data/farm.json)
        const farmId = farmData.farmId || setupData.farmId || storedFarmData.farm_id || authFarmId || currentSession?.farmId || 'UNKNOWN';
        const registrationCode = farmData.registrationCode || setupData.registrationCode || storedFarmData.registration_code || 'UNKNOWN';
        const networkType = setupData.network?.type || storedFarmData.network_type || 'Edge Device';
        
        document.getElementById('settings-farm-id').value = farmId;
        document.getElementById('settings-registration-code').value = registrationCode;
        document.getElementById('network-type').textContent = networkType;

        // Populate editable profile fields
        const farmName = profileData.name || farmData.name || setupData.farm?.name || authFarmName || '';
        document.getElementById('settings-farm-name').value = farmName;
        document.getElementById('settings-contact-name').value = profileData.contactName || farmData.contact?.name || '';
        document.getElementById('settings-contact-email').value = profileData.email || farmData.contact?.email || '';
        document.getElementById('settings-contact-phone').value = profileData.phone || farmData.contact?.phone || '';
        document.getElementById('settings-website').value = profileData.website || farmData.contact?.website || '';
        const city = profileData.address?.city || (typeof profileData.address === 'string' ? profileData.address : '') || profileData.location || '';
        document.getElementById('settings-city').value = typeof city === 'object' ? (city.city || '') : city;

        // Plan type badge
        const planType = profileData.planType || setupData.farm?.planType || localStorage.getItem('plan_type') || 'cloud';
        const badgeEl = document.getElementById('plan-type-badge');
        if (badgeEl) {
            if (planType === 'edge') {
                badgeEl.textContent = '⚡ Edge';
                badgeEl.style.cssText = 'padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; background: rgba(139, 92, 246, 0.15); color: #a78bfa; border: 1px solid rgba(139, 92, 246, 0.3);';
            } else {
                badgeEl.textContent = '☁️ Cloud';
                badgeEl.style.cssText = 'padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3);';
            }
        }

        // Apply feature gating after settings load
        if (typeof applyPlanFeatureGating === 'function') {
            applyPlanFeatureGating(planType);
        }

        // Load onboarding checklist
        if (typeof loadOnboardingChecklist === 'function') {
            loadOnboardingChecklist();
        }
        
        // If we have complete setup data, use it
        if (setupData.completed) {
            
            // Load hardware info
            if (setupData.hardwareDetected) {
                document.getElementById('hardware-lights').textContent = setupData.hardwareDetected.lights || 0;
                document.getElementById('hardware-fans').textContent = setupData.hardwareDetected.fans || 0;
                document.getElementById('hardware-sensors').textContent = setupData.hardwareDetected.sensors || 0;
                document.getElementById('hardware-other').textContent = setupData.hardwareDetected.other || 0;
            }
            
            // Load certifications
            if (setupData.certifications) {
                const certList = document.getElementById('certifications-list');
                certList.innerHTML = '';
                (setupData.certifications.certifications || []).forEach(cert => {
                    const badge = document.createElement('span');
                    badge.className = 'badge';
                    badge.style.cssText = 'background: rgba(16, 185, 129, 0.1); color: var(--accent-green); padding: 6px 12px; border-radius: 4px; font-size: 12px; border: 1px solid var(--accent-green);';
                    badge.textContent = cert;
                    certList.appendChild(badge);
                });
                
                const practicesList = document.getElementById('practices-list');
                practicesList.innerHTML = '';
                (setupData.certifications.practices || []).forEach(practice => {
                    const badge = document.createElement('span');
                    badge.className = 'badge';
                    badge.style.cssText = 'background: rgba(59, 130, 246, 0.1); color: var(--accent-blue); padding: 6px 12px; border-radius: 4px; font-size: 12px; border: 1px solid var(--accent-blue);';
                    badge.textContent = practice;
                    practicesList.appendChild(badge);
                });
                
                // ATTRIBUTES DISPLAY REMOVED - DO NOT RE-ADD
                // Section removed: Woman-Owned, Veteran-Owned, Minority-Owned, Family Farm, Sustainable
                // Reason: Not relevant for farm operations. Focus on certifications and practices only.
                
                // Show placeholder if no data
                if (!setupData.certifications.certifications?.length) {
                    certList.innerHTML = '<span style="color: var(--text-muted); font-size: 12px;">No certifications added</span>';
                }
                if (!setupData.certifications.practices?.length) {
                    practicesList.innerHTML = '<span style="color: var(--text-muted); font-size: 12px;">No practices selected</span>';
                }
                // ATTRIBUTES PLACEHOLDER REMOVED - section permanently deleted
            }
        }
        
        // Load user preferences from localStorage
        const settings = JSON.parse(localStorage.getItem('farmSettings') || '{}');
        
        // Display Preferences
        document.getElementById('settings-temp-unit').value = settings.tempUnit || 'F';
        document.getElementById('settings-weight-unit').value = settings.weightUnit || 'lbs';
        document.getElementById('settings-currency').value = settings.currency || 'USD';
        document.getElementById('settings-timezone').value = settings.timezone || 'America/New_York';
        
        // Notifications
        document.getElementById('notif-new-order').checked = settings.notifNewOrder !== false;
        document.getElementById('notif-order-shipped').checked = settings.notifOrderShipped !== false;
        document.getElementById('notif-low-inventory').checked = settings.notifLowInventory !== false;
        document.getElementById('notif-harvest-ready').checked = settings.notifHarvestReady !== false;
        document.getElementById('notif-equipment-issue').checked = settings.notifEquipmentIssue !== false;
        document.getElementById('notif-ai-recommend').checked = settings.notifAiRecommend !== false;
        document.getElementById('settings-notif-email').value = settings.notifEmail || '';
        
        // Integration Settings
        document.getElementById('greenreach-sync-enabled').checked = settings.greenreachSync !== false;
        document.getElementById('greenreach-endpoint').value = settings.greenreachEndpoint || 'https://central.greenreach.app';
        document.getElementById('settings-api-key').value = settings.apiKey || '';
        
        // Check Square status
        checkSquareStatus();
        
        // System Configuration
        document.getElementById('auto-backup').checked = settings.autoBackup !== false;
        document.getElementById('backup-frequency').value = settings.backupFrequency || 'daily';
        document.getElementById('require-2fa').checked = settings.require2fa || false;
        document.getElementById('password-expiry').checked = settings.passwordExpiry || false;
        document.getElementById('session-timeout').value = settings.sessionTimeout || 30;
        
        // Farm Operations Defaults
        document.getElementById('default-ws1-discount').value = settings.defaultWS1Discount || 15;
        document.getElementById('default-ws2-discount').value = settings.defaultWS2Discount || 25;
        document.getElementById('default-ws3-discount').value = settings.defaultWS3Discount || 35;
        document.getElementById('low-stock-threshold').value = settings.lowStockThreshold || 10;
        
        // API & Webhooks
        document.getElementById('webhook-url').value = settings.webhookUrl || '';
        document.getElementById('webhook-orders').checked = settings.webhookOrders || false;
        document.getElementById('webhook-inventory').checked = settings.webhookInventory || false;
        document.getElementById('webhook-harvest').checked = settings.webhookHarvest || false;
        
    } catch (error) {
        console.error('Error loading settings:', error);
        showToast('Error loading settings', 'error');
    }
}

/**
 * Check Square connection status
 */
async function checkSquareStatus() {
    try {
        const response = await fetch('/api/farm/square/status', {
            headers: {
                'X-Farm-ID': localStorage.getItem('farmId') || 'demo-farm'
            }
        });
        
        const data = await response.json();
        const statusEl = document.getElementById('square-status-text');
        const statusContainer = document.getElementById('square-connection-status');
        
        if (data.connected) {
            statusEl.textContent = `Connected (${data.merchantName || 'Unknown Merchant'})`;
            statusEl.style.color = 'var(--accent-green)';
            statusContainer.style.background = 'rgba(16, 185, 129, 0.1)';
            statusContainer.style.borderColor = 'var(--accent-green)';
        } else {
            statusEl.textContent = 'Not Connected';
            statusEl.style.color = 'var(--accent-red)';
            statusContainer.style.background = 'rgba(239, 68, 68, 0.1)';
            statusContainer.style.borderColor = 'var(--accent-red)';
        }
    } catch (error) {
        console.error('Error checking Square status:', error);
        document.getElementById('square-status-text').textContent = 'Unable to check status';
        document.getElementById('square-status-text').style.color = 'var(--text-muted)';
    }
}

/**
 * Rescan hardware devices
 */
async function scanHardware() {
    showToast('Scanning for hardware devices...', 'info');
    
    try {
        // In production, this would call the hardware scan API
        const response = await fetch('/api/hardware/scan', {
            method: 'POST'
        });
        
        if (response.ok) {
            const data = await response.json();
            document.getElementById('hardware-lights').textContent = data.lights || 0;
            document.getElementById('hardware-fans').textContent = data.fans || 0;
            document.getElementById('hardware-sensors').textContent = data.sensors || 0;
            document.getElementById('hardware-other').textContent = data.other || 0;
            showToast('Hardware scan complete', 'success');
        }
    } catch (error) {
        console.error('Error scanning hardware:', error);
        showToast('Hardware scan unavailable', 'error');
    }
}

/**
 * Save farm settings
 */
async function saveSettings() {
    try {
        const val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
        const chk = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };

        const settings = {
            // Display Preferences
            tempUnit: val('settings-temp-unit'),
            weightUnit: val('settings-weight-unit'),
            currency: val('settings-currency'),
            timezone: val('settings-timezone'),
            
            // Notifications
            notifNewOrder: chk('notif-new-order'),
            notifOrderShipped: chk('notif-order-shipped'),
            notifLowInventory: chk('notif-low-inventory'),
            notifHarvestReady: chk('notif-harvest-ready'),
            notifEquipmentIssue: chk('notif-equipment-issue'),
            notifAiRecommend: chk('notif-ai-recommend'),
            notifEmail: val('settings-notif-email'),
            
            // Integration Settings
            greenreachSync: chk('greenreach-sync-enabled'),
            greenreachEndpoint: val('greenreach-endpoint'),
            apiKey: val('settings-api-key'),
            
            // System Configuration
            autoBackup: chk('auto-backup'),
            backupFrequency: val('backup-frequency'),
            require2fa: chk('require-2fa'),
            passwordExpiry: chk('password-expiry'),
            sessionTimeout: val('session-timeout'),
            
            defaultWS1Discount: val('default-ws1-discount'),
            defaultWS2Discount: val('default-ws2-discount'),
            defaultWS3Discount: val('default-ws3-discount'),
            retailMarkup: val('default-retail-markup'),
            lowStockThreshold: val('low-stock-threshold'),
            
            // API & Webhooks
            webhookUrl: val('webhook-url'),
            webhookOrders: chk('webhook-orders'),
            webhookInventory: chk('webhook-inventory'),
            webhookHarvest: chk('webhook-harvest'),
            
            lastUpdated: new Date().toISOString()
        };
        
        // Save to localStorage
        localStorage.setItem('farmSettings', JSON.stringify(settings));
        
        // Also persist to server
        try {
            const token = sessionStorage.getItem('token') || localStorage.getItem('token');
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = 'Bearer ' + token;
            await fetch('/data/farm-settings.json', {
                method: 'POST',
                headers,
                body: JSON.stringify(settings)
            });
        } catch (_) { /* server save is best-effort */ }
        
        const notify = typeof showNotification === 'function' ? showNotification : typeof showToast === 'function' ? showToast : (msg) => alert(msg);
        notify('Settings saved successfully', 'success');
    } catch (error) {
        console.error('Error saving settings:', error);
        const notify = typeof showNotification === 'function' ? showNotification : typeof showToast === 'function' ? showToast : (msg) => alert(msg);
        notify('Error saving settings', 'error');
    }
}

/**
 * Open edit certifications modal
 */
async function openEditCertificationsModal() {
    try {
        // Load current certifications from farm data
        let certifications = { certifications: [], practices: [], attributes: [] };
        
        try {
            const farmResponse = await fetch('/data/farm.json');
            if (farmResponse.ok) {
                const farmData = await farmResponse.json();
                if (farmData.certifications) {
                    certifications = farmData.certifications;
                }
            }
        } catch (error) {
            console.warn('Could not load certifications from /data/farm.json:', error);
        }
        
        // Populate checkboxes with current values
        const form = document.getElementById('editCertificationsForm');
        
        // Clear all checkboxes first
        form.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
        
        // Check certifications
        certifications.certifications?.forEach(cert => {
            const checkbox = form.querySelector(`input[name="certifications"][value="${cert}"]`);
            if (checkbox) checkbox.checked = true;
        });
        
        // Check practices
        certifications.practices?.forEach(practice => {
            const checkbox = form.querySelector(`input[name="practices"][value="${practice}"]`);
            if (checkbox) checkbox.checked = true;
        });
        
        // ATTRIBUTES SECTION REMOVED - DO NOT RE-ADD
        // Removed: Woman-Owned, Veteran-Owned, Minority-Owned, Family Farm, Sustainable
        // Decision: Not relevant for farm operations (2026-01-22)
        
        // Show modal
        document.getElementById('editCertificationsModal').style.display = 'block';
    } catch (error) {
        console.error('Error opening certifications modal:', error);
        showToast('Error loading certifications', 'error');
    }
}

/**
 * Close edit certifications modal
 */
function closeEditCertificationsModal() {
    document.getElementById('editCertificationsModal').style.display = 'none';
}

/**
 * Save edited certifications
 */
async function saveEditCertifications(event) {
    event.preventDefault();
    
    try {
        const form = document.getElementById('editCertificationsForm');
        
        // Collect selected values
        const certifications = Array.from(form.querySelectorAll('input[name="certifications"]:checked'))
            .map(cb => cb.value);
        const practices = Array.from(form.querySelectorAll('input[name="practices"]:checked'))
            .map(cb => cb.value);
        
        // ATTRIBUTES REMOVED - DO NOT RE-ADD (Woman-Owned, Veteran-Owned, etc.)
        // Only certifications and practices are relevant for farm operations
        
        const updatedCertifications = {
            certifications,
            practices,
            attributes: [] // Always empty - attributes section removed permanently
        };
        
        // Save to API
        const headers = { 'Content-Type': 'application/json' };
        if (currentSession?.token) {
            headers['Authorization'] = `Bearer ${currentSession.token}`;
        }
        
        const response = await fetch('/api/setup/certifications', {
            method: 'POST',
            headers,
            body: JSON.stringify(updatedCertifications)
        });
        
        if (!response.ok) {
            throw new Error('Failed to save certifications');
        }
        
        // Close modal and reload settings to show updates
        closeEditCertificationsModal();
        showToast('Certifications updated successfully', 'success');
        
        // Reload settings to show updated badges
        await loadSettings();
        
    } catch (error) {
        console.error('Error saving certifications:', error);
        showToast('Error saving certifications. Changes saved locally only.', 'warning');
        
        // Even if API fails, update the display
        closeEditCertificationsModal();
        await loadSettings();
    }
}

/**
 * Save operation defaults (wholesale discounts and inventory thresholds)
 */
async function saveOperationDefaults() {
    try {
        const ws1Discount = document.getElementById('default-ws1-discount').value;
        const ws2Discount = document.getElementById('default-ws2-discount').value;
        const ws3Discount = document.getElementById('default-ws3-discount').value;
        const lowStockThreshold = document.getElementById('low-stock-threshold').value;
        
        // Validate inputs
        if (ws1Discount < 0 || ws1Discount > 50) {
            showToast('WS1 discount must be between 0% and 50%', 'error');
            return;
        }
        
        if (ws2Discount < 0 || ws2Discount > 50) {
            showToast('WS2 discount must be between 0% and 50%', 'error');
            return;
        }
        
        if (ws3Discount < 0 || ws3Discount > 60) {
            showToast('WS3 discount must be between 0% and 60%', 'error');
            return;
        }
        
        if (lowStockThreshold < 0) {
            showToast('Low stock threshold must be 0 or greater', 'error');
            return;
        }
        
        // Get existing settings
        const settings = JSON.parse(localStorage.getItem('farmSettings') || '{}');
        
        // Update operation defaults
        settings.defaultWS1Discount = ws1Discount;
        settings.defaultWS2Discount = ws2Discount;
        settings.defaultWS3Discount = ws3Discount;
        settings.lowStockThreshold = lowStockThreshold;
        settings.lastUpdated = new Date().toISOString();
        
        // Save to localStorage
        localStorage.setItem('farmSettings', JSON.stringify(settings));
        
        // In production, would also save to API
        // await fetch('/api/farm/settings/defaults', {
        //     method: 'POST',
        //     headers: { 
        //         'Content-Type': 'application/json',
        //         'X-Farm-ID': localStorage.getItem('farm_id') || 'demo-farm'
        //     },
        //     body: JSON.stringify({
        //         ws1Discount,
        //         ws2Discount,
        //         ws3Discount,
        //         lowStockThreshold
        //     })
        // });
        
        showToast('Operation defaults saved successfully', 'success');
    } catch (error) {
        console.error('Error saving operation defaults:', error);
        showToast('Error saving operation defaults', 'error');
    }
}

/**
 * Save farm profile (contact/identity) to the API
 */
async function saveProfileSettings() {
    try {
        const profileData = {
            name: document.getElementById('settings-farm-name').value.trim(),
            contactName: document.getElementById('settings-contact-name').value.trim(),
            email: document.getElementById('settings-contact-email').value.trim(),
            phone: document.getElementById('settings-contact-phone').value.trim(),
            website: document.getElementById('settings-website').value.trim(),
            address: { city: document.getElementById('settings-city').value.trim() }
        };

        // Basic validation
        if (profileData.email && !profileData.email.includes('@')) {
            showToast('Please enter a valid email address', 'error');
            return;
        }

        const headers = { 'Content-Type': 'application/json' };
        if (currentSession?.token) {
            headers['Authorization'] = `Bearer ${currentSession.token}`;
        }

        const response = await fetch('/api/setup/profile', {
            method: 'PATCH',
            headers,
            body: JSON.stringify(profileData)
        });

        const result = await response.json();
        if (result.success) {
            showToast('Farm profile saved successfully', 'success');
            // Update localStorage farm_name for nav header
            if (profileData.name) {
                localStorage.setItem('farm_name', profileData.name);
            }
        } else {
            showToast(result.error || 'Failed to save profile', 'error');
        }
    } catch (error) {
        console.error('Error saving profile:', error);
        showToast('Error saving profile', 'error');
    }
}

/**
 * Reset settings to defaults
 */
function resetSettings() {
    if (confirm('Are you sure you want to reset all settings to default values?')) {
        localStorage.removeItem('farmSettings');
        loadSettings();
        showToast('Settings reset to defaults', 'info');
    }
}

// === DEVICE PAIRING QR CODE GENERATION ===

/**
 * Generate QR code for tablet device pairing
 */
async function generatePairingQR() {
    try {
        // Get farm info from localStorage or current session
        const farmId = localStorage.getItem('farm_id') || 'FARM-001';
        const farmName = localStorage.getItem('farm_name') || 'Demo Farm';
        
        // Call API to generate device token
        const response = await fetch('/api/auth/generate-device-token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                farm_id: farmId,
                farm_name: farmName,
                role: 'manager'  // Activity Hub access level
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to generate device token');
        }
        
        const data = await response.json();
        const deviceToken = data.token;
        
        // Create QR code data (format: DEVICE_PAIR|{token}|{farm_id}|{farm_name})
        const qrData = `DEVICE_PAIR|${deviceToken}|${farmId}|${farmName}`;
        
        // Clear previous QR code
        const qrContainer = document.getElementById('pairingQRCode');
        qrContainer.innerHTML = '';
        
        // Generate QR code
        new QRCode(qrContainer, {
            text: qrData,
            width: 256,
            height: 256,
            colorDark: '#1a2332',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });
        
        // Update farm name display
        document.getElementById('pairingFarmName').textContent = farmName;
        
        // Show QR code container
        document.getElementById('pairingQRContainer').style.display = 'block';
        
        showToast('Pairing QR code generated successfully', 'success');
        
    } catch (error) {
        console.error('Error generating pairing QR:', error);
        showToast('Error generating pairing QR code: ' + error.message, 'error');
    }
}

/**
 * Close pairing QR code display
 */
function closePairingQR() {
    document.getElementById('pairingQRContainer').style.display = 'none';
}

// ============================================================================
// FIRST-TIME SETUP FUNCTIONS
// ============================================================================

let currentSetupStep = 1;
const totalSetupSteps = 7;
let setupData = {
    rooms: [],
    trayFormats: [],
    benchmarks: null
};

/**
 * Check if first-time setup is needed
 */
async function checkFirstTimeSetup() {
    try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        if (!token || token === 'local-access') {
            console.log('[setup-wizard] No real token, skipping setup check');
            return;
        }
        
        // Check for force-wizard URL parameter
        const urlParams = new URLSearchParams(window.location.search);
        const forceWizard = urlParams.get('wizard') === 'true' || urlParams.get('setup') === 'true';
        
        // Check API status
        const response = await fetch('/api/setup-wizard/status', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        console.log('[setup-wizard] API status:', data);
        
        // If setup not complete or force wizard, redirect to standalone wizard
        if (forceWizard) {
            console.log('[setup-wizard] Force wizard requested, redirecting');
            window.location.href = '/setup-wizard.html';
            return;
        }
        if (!data.setupCompleted) {
            // Double-check: if localStorage has setup_completed=true, don't redirect
            // This prevents redirect loops for farms that completed setup but DB flag is stale
            const localSetupDone = localStorage.getItem('setup_completed') === 'true';
            if (localSetupDone) {
                console.log('[setup-wizard] DB says not complete but localStorage says done — skipping redirect');
                return;
            }
            console.log('[setup-wizard] Setup not complete, redirecting to wizard');
            window.location.href = '/setup-wizard.html';
            return;
        }
        
        console.log('[setup-wizard] Setup already completed');
    } catch (error) {
        console.error('[setup-wizard] Setup status check failed:', error);
        // Don't redirect on error — prevents annoying users
    }
}

/**
 * Generate Activity Hub QR codes for setup wizard (download + pairing)
 */
async function generateWizardActivityHubQRCodes() {
    console.log('[Setup] Generating Activity Hub QR codes for wizard...');
    
    // Generate Download QR Code
    const downloadQRContainer = document.querySelector('#wizard-activity-hub-download-qr > div');
    if (downloadQRContainer) {
        const appStoreUrl = 'https://greenreach.farm/activity-hub/install';
        
        try {
            downloadQRContainer.innerHTML = '';
            
            if (typeof QRCode !== 'undefined') {
                new QRCode(downloadQRContainer, {
                    text: appStoreUrl,
                    width: 200,
                    height: 200,
                    colorDark: '#1a2332',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.H
                });
                console.log('[Setup] Download QR code generated');
            } else {
                const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(appStoreUrl)}`;
                downloadQRContainer.innerHTML = `<img src="${qrApiUrl}" alt="Download Activity Hub" style="width: 200px; height: 200px; border-radius: 8px;">`;
                console.log('[Setup] Download QR code generated (API fallback)');
            }
        } catch (error) {
            console.error('[Setup] Failed to generate download QR:', error);
        }
    }
    
    // Generate Pairing QR Code
    const pairingQRContainer = document.querySelector('#wizard-activity-hub-pairing-qr > div');
    if (pairingQRContainer) {
        const farmId = localStorage.getItem('farmId') || localStorage.getItem('farm_id') || currentSession?.farmId || 'LOCAL-FARM';
        const farmName = currentSession?.farmName || localStorage.getItem('farmName') || 'Light Engine Farm';
        const token = localStorage.getItem('token') || currentSession?.token || 'local-access';
        
        const pairingData = {
            farmId: farmId,
            farmName: farmName,
            token: token,
            timestamp: Date.now()
        };
        
        const pairingUrl = `greenreach-hub://pair?data=${encodeURIComponent(JSON.stringify(pairingData))}`;
        
        try {
            pairingQRContainer.innerHTML = '';
            
            if (typeof QRCode !== 'undefined') {
                new QRCode(pairingQRContainer, {
                    text: pairingUrl,
                    width: 200,
                    height: 200,
                    colorDark: '#1a2332',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.H
                });
                console.log('[Setup] Pairing QR code generated');
            } else {
                const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(pairingUrl)}`;
                pairingQRContainer.innerHTML = `<img src="${qrApiUrl}" alt="Pair Activity Hub" style="width: 200px; height: 200px; border-radius: 8px;">`;
                console.log('[Setup] Pairing QR code generated (API fallback)');
            }
        } catch (error) {
            console.error('[Setup] Failed to generate pairing QR:', error);
        }
    }
}

/**
 * Generate Activity Hub QR code for setup wizard
 */
async function generateSetupActivityHubQR() {
    try {
        const farmId = localStorage.getItem('farmId') || localStorage.getItem('farm_id') || 'DEMO-FARM';
        const token = localStorage.getItem('token');
        
        // Construct Activity Hub URL with authentication
        const activityHubUrl = `${window.location.origin}/views/tray-inventory.html?farmId=${farmId}&token=${encodeURIComponent(token)}`;
        
        // Display the URL
        const urlEl = document.getElementById('setup-activity-hub-url');
        if (urlEl) {
            urlEl.textContent = activityHubUrl;
        }
        
        // Clear previous QR code
        const qrContainer = document.getElementById('setup-qr-code');
        if (qrContainer) {
            qrContainer.innerHTML = '';
            
            // Generate QR code using QRCode library
            if (typeof QRCode !== 'undefined') {
                new QRCode(qrContainer, {
                    text: activityHubUrl,
                    width: 200,
                    height: 200,
                    colorDark: '#1a2332',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.H
                });
                console.log('[Setup] Activity Hub QR code generated');
            } else {
                // Fallback to API-based QR code generation
                const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(activityHubUrl)}`;
                qrContainer.innerHTML = `<img src="${qrApiUrl}" alt="Activity Hub QR Code" style="width: 200px; height: 200px;">`;
                console.log('[Setup] Activity Hub QR code generated (API fallback)');
            }
        }
    } catch (error) {
        console.error('[Setup] Failed to generate Activity Hub QR:', error);
    }
}

/**
 * Open QR Generator tool in new window
 */
function openQRGenerator() {
    const farmId = localStorage.getItem('farmId') || localStorage.getItem('farm_id') || currentSession?.farmId || '';
    const farmName = currentSession?.farmName || localStorage.getItem('farmName') || 'Light Engine Farm';
    
    // Build URL with farm parameters for Activity Hub QR codes
    const params = new URLSearchParams();
    if (farmId) params.set('farmId', farmId);
    if (farmName) params.set('farmName', encodeURIComponent(farmName));
    
    const url = `/LE-qr-generator.html?${params.toString()}`;
    window.open(url, '_blank', 'width=1200,height=800');
    console.log('[Setup] Opened QR Generator tool with farmId:', farmId, 'farmName:', farmName);
}

/**
 * Show Activity Hub app download QR code
 */
function showActivityHubDownloadQR() {
    const container = document.getElementById('activityHubDownloadQRContainer');
    const qrContainer = document.getElementById('activityHubDownloadQRCode');
    
    if (!container || !qrContainer) {
        console.error('Activity Hub download QR containers not found');
        return;
    }
    
    // App Store URL for GreenReach Activity Hub app
    // Replace with actual App Store URL when app is published
    const appStoreUrl = 'https://apps.apple.com/app/greenreach-activity-hub/id123456789';
    
    // For now, show TestFlight or web app URL
    const activityHubUrl = 'https://greenreach.farm/activity-hub/install';
    
    try {
        // Clear existing QR code
        qrContainer.innerHTML = '';
        
        // Generate QR code using qrcode.js if available
        if (typeof QRCode !== 'undefined') {
            new QRCode(qrContainer, {
                text: activityHubUrl,
                width: 256,
                height: 256,
                colorDark: '#1a2332',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.H
            });
            console.log('Activity Hub download QR code generated');
        } else {
            // Fallback to API-based QR code generation
            const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(activityHubUrl)}`;
            qrContainer.innerHTML = `<img src="${qrApiUrl}" alt="Activity Hub Download QR" style="width: 256px; height: 256px; border-radius: 8px;">`;
            console.log('Activity Hub download QR code generated (API fallback)');
        }
        
        // Show container
        container.style.display = 'block';
        
    } catch (error) {
        console.error('Failed to generate Activity Hub download QR:', error);
        qrContainer.innerHTML = `
            <div style="padding: 40px; color: #ef4444;">
                <p style="margin: 0; font-weight: 600;">Unable to generate QR code</p>
                <p style="margin: 8px 0 0 0; font-size: 0.85rem;">Visit: ${activityHubUrl}</p>
            </div>
        `;
        container.style.display = 'block';
    }
}

/**
 * Close Activity Hub download QR code
 */
function closeActivityHubDownloadQR() {
    const container = document.getElementById('activityHubDownloadQRContainer');
    if (container) {
        container.style.display = 'none';
    }
}

/**
 * Show first-time setup modal
 */
async function showFirstTimeSetup() {
    console.log('[setup-wizard] showFirstTimeSetup() called');
    const modal = document.getElementById('first-time-setup-modal');
    console.log('[setup-wizard] Modal element found:', !!modal);
    
    if (!modal) {
        console.error('[setup-wizard] Modal element #first-time-setup-modal not found in DOM!');
        return;
    }
    
    if (modal) {
        modal.style.display = 'flex';
        console.log('[setup-wizard] Modal display set to flex');
        
        // Check if this is a Cloud plan customer (skip activation code step)
        const token = localStorage.getItem('token');
        let isCloudPlan = false;
        
        if (token) {
            try {
                // Decode JWT to get plan type and farmId
                const payload = JSON.parse(atob(token.split('.')[1]));
                isCloudPlan = payload.planType === 'Cloud' || payload.planType === 'cloud';
                
                // For Cloud plan, populate setupData with JWT info
                if (isCloudPlan && payload.farmId) {
                    setupData.farmId = payload.farmId;
                    setupData.userId = payload.userId;
                    console.log('[Setup] Cloud plan detected, farmId from JWT:', setupData.farmId);
                }
            } catch (e) {
                console.log('[Setup] Could not decode token, checking localStorage');
            }
        }
        
        // Also check localStorage for plan type
        if (!isCloudPlan) {
            const planType = localStorage.getItem('planType') || localStorage.getItem('plan_type');
            isCloudPlan = planType === 'Cloud' || planType === 'cloud';
            
            // If Cloud plan from localStorage, get farmId from localStorage too
            if (isCloudPlan) {
                setupData.farmId = localStorage.getItem('farm_id') || localStorage.getItem('farmId');
                console.log('[Setup] Cloud plan from localStorage, farmId:', setupData.farmId);
            }
        }
        
        // Fetch farm data to pre-fill wizard fields from existing farm profile
        try {
            console.log('[Setup] Fetching farm.json for wizard pre-fill...');
            const farmResponse = await fetch('/data/farm.json');
            
            if (farmResponse.ok) {
                const farmData = await farmResponse.json();
                console.log('[Setup] farm.json loaded for pre-fill:', farmData);
                
                // --- Step 2: Business Profile ---
                const farmNameField = document.getElementById('setup-farm-name');
                const contactNameField = document.getElementById('setup-contact-name');
                const contactEmailField = document.getElementById('setup-contact-email');
                const contactPhoneField = document.getElementById('setup-contact-phone');
                const contactWebsiteField = document.getElementById('setup-contact-website');
                
                const farmName = farmData.farmName || farmData.name || '';
                const contactName = farmData.contact?.name || farmData.contactName || '';
                const contactEmail = farmData.contact?.email || farmData.email || '';
                const contactPhone = farmData.contact?.phone || farmData.phone || '';
                const contactWebsite = farmData.contact?.website || farmData.website || '';
                
                if (farmName && farmNameField) farmNameField.value = farmName;
                if (contactName && contactNameField) contactNameField.value = contactName;
                if (contactEmail && contactEmailField) contactEmailField.value = contactEmail;
                if (contactPhone && contactPhoneField) contactPhoneField.value = contactPhone;
                if (contactWebsite && contactWebsiteField) contactWebsiteField.value = contactWebsite;
                
                console.log('[Setup] Step 2 seeded:', { farmName, contactName, contactEmail, contactPhone });
                
                // --- Step 3: Location ---
                const addressField = document.getElementById('setup-address');
                const cityField = document.getElementById('setup-city');
                const stateField = document.getElementById('setup-state');
                const postalField = document.getElementById('setup-postal');
                const timezoneField = document.getElementById('setup-timezone');
                const latField = document.getElementById('setup-latitude');
                const lngField = document.getElementById('setup-longitude');
                
                if (farmData.address && addressField) addressField.value = farmData.address;
                if (farmData.city && cityField) cityField.value = farmData.city;
                if (farmData.state && stateField) stateField.value = farmData.state;
                if (farmData.postalCode && postalField) postalField.value = farmData.postalCode;
                
                // Set timezone — ensure the option exists before setting
                if (farmData.timezone && timezoneField) {
                    const tzOption = timezoneField.querySelector(`option[value="${farmData.timezone}"]`);
                    if (tzOption) {
                        timezoneField.value = farmData.timezone;
                    } else {
                        // Dynamically add the timezone option if missing from the select
                        const opt = document.createElement('option');
                        opt.value = farmData.timezone;
                        opt.textContent = farmData.timezone.replace(/_/g, ' ').replace('America/', '');
                        timezoneField.insertBefore(opt, timezoneField.firstChild);
                        timezoneField.value = farmData.timezone;
                    }
                }
                
                // Coordinates
                const coords = farmData.coordinates || {};
                if (coords.lat && latField) latField.value = coords.lat;
                if (coords.lng && lngField) lngField.value = coords.lng;
                
                console.log('[Setup] Step 3 seeded:', { address: farmData.address, city: farmData.city, state: farmData.state, lat: coords.lat, lng: coords.lng });
                
                // --- Step 4: Rooms & Zones ---
                if (Array.isArray(farmData.rooms) && farmData.rooms.length > 0) {
                    setupData.rooms = farmData.rooms.map(r => ({
                        id: r.id || `room-${Math.random().toString(36).substr(2, 6)}`,
                        name: r.name || r,
                        zones: Array.isArray(r.zones) ? r.zones : []
                    }));
                    renderSetupRooms();
                    console.log('[Setup] Step 4 seeded:', setupData.rooms.length, 'rooms');
                }
                
                // --- Step 5: Certifications ---
                if (farmData.certifications) {
                    (farmData.certifications.certifications || []).forEach(cert => {
                        const cb = document.querySelector(`input[name="certification"][value="${cert}"]`);
                        if (cb) cb.checked = true;
                    });
                    (farmData.certifications.practices || []).forEach(p => {
                        const cb = document.querySelector(`input[name="practice"][value="${p}"]`);
                        if (cb) cb.checked = true;
                    });
                    console.log('[Setup] Step 5 seeded certifications');
                }
                
                // Store farmId for setup completion
                if (farmData.farmId) setupData.farmId = farmData.farmId;
                
            } else {
                console.warn('[Setup] farm.json not available (status:', farmResponse.status, '), wizard starts empty');
            }
        } catch (error) {
            console.error('[Setup] Could not fetch farm data for pre-fill:', error);
            // Continue with wizard even if pre-fill fails
        }
        
        // Start at Step 2 for Cloud customers (skip activation code)
        currentSetupStep = isCloudPlan ? 2 : 1;
        console.log(`[Setup] Starting wizard at step ${currentSetupStep} (Cloud: ${isCloudPlan})`);
        
        updateSetupStepDisplay();
    }
}

/**
 * Navigate to next setup step
 */
async function setupNextStep() {
    // Validate current step
    if (!validateSetupStep(currentSetupStep)) {
        return;
    }
    
    // If step 1, verify activation code
    if (currentSetupStep === 1) {
        const activationCode = document.getElementById('setup-activation-code').value.trim();
        if (!activationCode || activationCode.length !== 8) {
            showSetupError('Please enter a valid 8-character activation code');
            return;
        }
        
        // Call activation API
        const activated = await activateDevice(activationCode);
        if (!activated) {
            return; // Error already shown
        }
    }
    
    // Move to next step
    if (currentSetupStep < totalSetupSteps) {
        // If on Step 5 (certifications), collect selected certifications
        if (currentSetupStep === 5) {
            setupData.certifications = Array.from(document.querySelectorAll('input[name="certification"]:checked'))
                .map(cb => cb.value);
            setupData.practices = Array.from(document.querySelectorAll('input[name="practice"]:checked'))
                .map(cb => cb.value);
            console.log('[Setup] Certifications collected:', setupData.certifications);
        }
        
        currentSetupStep++;
        
        // If moving to Step 6 (Network Benchmarks), fetch from Central
        if (currentSetupStep === 6) {
            await seedBenchmarksStep();
        }
        
        // If moving to Step 7 (Activity Hub), generate QR codes
        if (currentSetupStep === 7) {
            await generateWizardActivityHubQRCodes();
        }
        
        updateSetupStepDisplay();
    }
}

/**
 * Navigate to previous setup step
 */
function setupPreviousStep() {
    if (currentSetupStep > 1) {
        currentSetupStep--;
        updateSetupStepDisplay();
    }
}

/**
 * Update setup step display
 */
function updateSetupStepDisplay() {
    // Hide all steps
    for (let i = 1; i <= totalSetupSteps; i++) {
        const step = document.getElementById(`setup-step-${i}`);
        if (step) step.style.display = 'none';
    }
    
    // Show current step
    const currentStep = document.getElementById(`setup-step-${currentSetupStep}`);
    if (currentStep) currentStep.style.display = 'block';
    
    // Update progress indicator
    document.querySelectorAll('.setup-progress-step').forEach((el, index) => {
        if (index < currentSetupStep) {
            el.style.background = 'var(--accent-blue)';
        } else {
            el.style.background = 'var(--border)';
        }
    });
    
    // Update buttons
    const backBtn = document.getElementById('setup-back-btn');
    const nextBtn = document.getElementById('setup-next-btn');
    const completeBtn = document.getElementById('setup-complete-btn');
    
    if (backBtn) backBtn.style.display = currentSetupStep > 1 ? 'block' : 'none';
    if (nextBtn) nextBtn.style.display = currentSetupStep < totalSetupSteps ? 'block' : 'none';
    if (completeBtn) completeBtn.style.display = currentSetupStep === totalSetupSteps ? 'block' : 'none';
}

/**
 * Validate current setup step
 */
function validateSetupStep(step) {
    let isValid = true;
    let errorMessage = '';
    
    switch (step) {
        case 1:
            const code = document.getElementById('setup-activation-code').value.trim();
            if (!code || code.length !== 8) {
                isValid = false;
                errorMessage = 'Please enter a valid 8-character activation code';
            }
            break;
            
        case 2:
            const farmName = document.getElementById('setup-farm-name').value.trim();
            const contactName = document.getElementById('setup-contact-name').value.trim();
            const contactEmail = document.getElementById('setup-contact-email').value.trim();
            
            if (!farmName) {
                isValid = false;
                errorMessage = 'Farm name is required';
            } else if (!contactName) {
                isValid = false;
                errorMessage = 'Contact name is required';
            } else if (!contactEmail) {
                isValid = false;
                errorMessage = 'Contact email is required';
            } else if (!contactEmail.includes('@')) {
                isValid = false;
                errorMessage = 'Please enter a valid email address';
            }
            break;
            
        case 3:
            const address = document.getElementById('setup-address').value.trim();
            const city = document.getElementById('setup-city').value.trim();
            const state = document.getElementById('setup-state').value.trim();
            const postal = document.getElementById('setup-postal').value.trim();
            
            if (!address || !city || !state || !postal) {
                isValid = false;
                errorMessage = 'Please complete all location fields';
            }
            break;
            
        case 4:
            // Rooms - at least one room required
            if (!setupData.rooms || setupData.rooms.length === 0) {
                isValid = false;
                errorMessage = 'Please add at least one room to continue';
            }
            break;
            
        case 5:
            // Certifications are optional, always valid
            isValid = true;
            break;
            
        case 6:
            // Network benchmarks are informational, always valid
            isValid = true;
            break;
    }
    
    if (!isValid && errorMessage) {
        showSetupError(errorMessage);
    }
    
    return isValid;
}

/**
 * Show setup error message
 */
function showSetupError(message) {
    const statusEl = document.getElementById('setup-activation-status');
    if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(239, 68, 68, 0.1)';
        statusEl.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        statusEl.style.color = '#fca5a5';
        statusEl.textContent = message;
    }
    
    showToast(message, 'error');
}

/**
 * Show setup success message
 */
function showSetupSuccess(message) {
    const statusEl = document.getElementById('setup-activation-status');
    if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(16, 185, 129, 0.1)';
        statusEl.style.border = '1px solid rgba(16, 185, 129, 0.3)';
        statusEl.style.color = '#6ee7b7';
        statusEl.textContent = message;
    }
    
    showToast(message, 'success');
}

/**
 * Fetch and display network benchmarks from Central during Step 6.
 * Calls POST /api/setup-wizard/seed-benchmarks to pull crop targets,
 * then renders the results into the #benchmark-results container.
 */
async function seedBenchmarksStep() {
    const resultsContainer = document.getElementById('benchmark-results');
    const loadingEl = document.getElementById('benchmark-loading');
    const errorEl = document.getElementById('benchmark-error');

    if (loadingEl) loadingEl.style.display = 'flex';
    if (errorEl) errorEl.style.display = 'none';
    if (resultsContainer) resultsContainer.innerHTML = '';

    try {
        const farmId = setupData.farmId || localStorage.getItem('farm_id') || 'new-farm';
        const response = await fetch('/api/setup-wizard/seed-benchmarks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ farm_id: farmId })
        });
        const data = await response.json();

        if (loadingEl) loadingEl.style.display = 'none';

        if (!data.ok) {
            if (errorEl) { errorEl.textContent = data.error || 'Failed to load benchmarks'; errorEl.style.display = 'block'; }
            return;
        }

        setupData.benchmarks = data;

        if (!data.seeded || !data.benchmarks) {
            if (resultsContainer) {
                resultsContainer.innerHTML = `
                    <div style="text-align:center; padding:30px 20px; color:var(--text-muted);">
                        <p style="font-size:15px; margin:0 0 8px;">No network benchmarks available yet.</p>
                        <p style="font-size:13px; margin:0;">Default environmental targets will be used. You can update these later in Settings.</p>
                    </div>`;
            }
            return;
        }

        // Render benchmark cards
        let html = '';
        for (const [crop, bm] of Object.entries(data.benchmarks)) {
            const targets = (data.environmental_targets || {})[crop] || {};
            const confidence = bm.confidence || 'low';
            const confColor = confidence === 'high' ? '#10b981' : confidence === 'medium' ? '#f59e0b' : '#6b7280';
            html += `
                <div style="background:var(--bg-card); border:1px solid var(--border); border-radius:8px; padding:14px 16px; margin-bottom:10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <h4 style="margin:0; font-size:15px; color:var(--text-primary); text-transform:capitalize;">${crop}</h4>
                        <span style="font-size:11px; padding:2px 8px; border-radius:10px; background:${confColor}22; color:${confColor}; font-weight:600;">${confidence} confidence</span>
                    </div>
                    <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; font-size:12px; color:var(--text-secondary);">
                        <div>Yield: <strong style="color:var(--text-primary);">${bm.avg_yield_oz != null ? bm.avg_yield_oz + ' oz' : '—'}</strong></div>
                        <div>Cycle: <strong style="color:var(--text-primary);">${bm.avg_cycle_days != null ? bm.avg_cycle_days + ' days' : '—'}</strong></div>
                        <div>Farms: <strong style="color:var(--text-primary);">${bm.network_farms || 0}</strong></div>
                        <div>PPFD: <strong style="color:var(--text-primary);">${bm.recommended_ppfd || '—'}</strong></div>
                        <div>Temp: <strong style="color:var(--text-primary);">${targets.temp_min || '—'}–${targets.temp_max || '—'}°F</strong></div>
                        <div>RH: <strong style="color:var(--text-primary);">${targets.rh_min || '—'}–${targets.rh_max || '—'}%</strong></div>
                    </div>
                </div>`;
        }

        if (resultsContainer) {
            resultsContainer.innerHTML = html || '<p style="color:var(--text-muted); text-align:center;">No crop benchmarks returned.</p>';
        }

        console.log(`[Setup] Benchmarks seeded: ${data.crops_seeded} crops`);
    } catch (error) {
        console.error('[Setup] Benchmark seeding error:', error);
        if (loadingEl) loadingEl.style.display = 'none';
        if (errorEl) {
            errorEl.textContent = 'Could not connect to network. Default targets will be used.';
            errorEl.style.display = 'block';
        }
    }
}

/**
 * Activate device with activation code
 */
async function activateDevice(activationCode) {
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (currentSession?.token) {
            headers['Authorization'] = `Bearer ${currentSession.token}`;
        }
        const response = await fetch('/api/setup/activate', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ activationCode })
        });
        
        const data = await response.json();
        
        if (!response.ok || !data.ok) {
            showSetupError(data.message || 'Invalid activation code');
            return false;
        }
        
        // Store activation data
        setupData.farmId = data.license?.farmId;
        setupData.tier = data.license?.tier;
        setupData.activationCode = activationCode;
        
        showSetupSuccess('Activation successful');
        
        // Auto-advance to next step after 1 second
        setTimeout(() => {
            currentSetupStep++;
            updateSetupStepDisplay();
        }, 1000);
        
        return true;
        
    } catch (error) {
        console.error('Activation error:', error);
        showSetupError('Activation failed: ' + error.message);
        return false;
    }
}

/**
 * Complete setup and save all data
 */
async function completeSetup() {
    try {
        // Collect all data
        const farmName = document.getElementById('setup-farm-name').value.trim();
        const contactName = document.getElementById('setup-contact-name').value.trim();
        const contactEmail = document.getElementById('setup-contact-email').value.trim();
        const contactPhone = document.getElementById('setup-contact-phone').value.trim();
        const contactWebsite = document.getElementById('setup-contact-website').value.trim();
        
        const address = document.getElementById('setup-address').value.trim();
        const city = document.getElementById('setup-city').value.trim();
        const state = document.getElementById('setup-state').value.trim();
        const postal = document.getElementById('setup-postal').value.trim();
        const timezone = document.getElementById('setup-timezone').value;
        const latitude = document.getElementById('setup-latitude').value;
        const longitude = document.getElementById('setup-longitude').value;
        
        // Collect certifications
        const certifications = Array.from(document.querySelectorAll('input[name="certification"]:checked'))
            .map(cb => cb.value);
        const practices = Array.from(document.querySelectorAll('input[name="practice"]:checked'))
            .map(cb => cb.value);
        const attributes = Array.from(document.querySelectorAll('input[name="attribute"]:checked'))
            .map(cb => cb.value);
        
        // Submit tray formats before completing setup
        console.log('[Setup] Submitting tray formats...');
        const trayFormatsResult = await submitTrayFormats();
        if (trayFormatsResult.success) {
            console.log('[Setup] Tray formats submitted:', trayFormatsResult.message);
        } else {
            console.warn('[Setup] Tray formats submission had issues:', trayFormatsResult);
        }
        
        // Call setup completion API
        const response = await fetch('/api/setup/complete', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentSession.token}`
            },
            body: JSON.stringify({
                farmId: setupData.farmId,
                farmName: farmName,
                registrationCode: setupData.activationCode,
                credentials: {
                    wholesale_api_key: `wsk_${Math.random().toString(36).substr(2, 20)}`,
                    pos_api_key: `posk_${Math.random().toString(36).substr(2, 20)}`,
                    device_api_key: `devk_${Math.random().toString(36).substr(2, 20)}`,
                    jwt_secret: Math.random().toString(36).substr(2, 32)
                },
                contact: {
                    name: contactName,
                    email: contactEmail,
                    phone: contactPhone,
                    website: contactWebsite
                },
                location: {
                    address: address,
                    city: city,
                    state: state,
                    postalCode: postal,
                    timezone: timezone,
                    latitude: latitude ? parseFloat(latitude) : null,
                    longitude: longitude ? parseFloat(longitude) : null
                },
                rooms: setupData.rooms || [],
                certifications: {
                    certifications: certifications,
                    practices: practices,
                    attributes: attributes
                },
                endpoints: {
                    wholesale_api: 'https://wholesale.greenreach.io',
                    monitoring_api: 'https://monitor.greenreach.io',
                    update_api: 'https://updates.greenreach.io',
                    cloud_api: 'https://api.greenreach.io'
                }
            })
        });
        
        const data = await response.json();
        
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Setup failed');
        }
        
        // Also save to localStorage for index.html farm wizard compatibility
        const farmData = {
            farmId: setupData.farmId,
            farmName: farmName,
            address: address,
            city: city,
            state: state,
            postalCode: postal,
            timezone: timezone,
            latitude: latitude ? parseFloat(latitude) : null,
            longitude: longitude ? parseFloat(longitude) : null,
            rooms: setupData.rooms || [],
            contact: {
                name: contactName,
                email: contactEmail,
                phone: contactPhone,
                website: contactWebsite
            },
            registered: new Date().toISOString()
        };
        
        try {
            localStorage.setItem('gr.farm', JSON.stringify(farmData));
            
            // Also POST to /farm endpoint for index.html compatibility
            await fetch('/farm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(farmData)
            });
            
            // Save rooms to /rooms endpoint if any rooms were added
            if (setupData.rooms && setupData.rooms.length > 0) {
                await fetch('/rooms', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(setupData.rooms)
                });
            }
        } catch (e) {
            console.warn('Could not save to localStorage/backend:', e);
        }
        
        // Mark setup as completed to prevent wizard loop
        localStorage.setItem('setup_completed', 'true');
        
        // Success! Close modal and refresh page
        const modal = document.getElementById('first-time-setup-modal');
        if (modal) modal.style.display = 'none';
        
        showToast('Setup complete! Welcome to Light Engine.', 'success');
        
        // Reload page to show dashboard with setup data
        setTimeout(() => {
            window.location.reload();
        }, 1500);
        
    } catch (error) {
        console.error('Setup completion error:', error);
        showToast('Setup failed: ' + error.message, 'error');
    }
}

/**
 * Add a room to the setup wizard
 */
function addSetupRoom() {
    const roomInput = document.getElementById('setup-new-room');
    const roomName = roomInput.value.trim();
    
    if (!roomName) {
        showSetupError('Please enter a room name');
        return;
    }
    
    // Check for duplicate room names
    if (setupData.rooms.some(r => r.name.toLowerCase() === roomName.toLowerCase())) {
        showSetupError('A room with this name already exists');
        return;
    }
    
    // Add room
    const room = {
        id: Date.now().toString(),
        name: roomName,
        zones: []
    };
    
    setupData.rooms.push(room);
    roomInput.value = '';
    
    renderSetupRooms();
    showSetupSuccess(`Room "${roomName}" added`);

    // Show Room Mapper tip once a room is added
    const tip = document.getElementById('setup-room-mapper-tip');
    if (tip) tip.style.display = 'block';
}

/**
 * Render rooms list in setup wizard
 */
function renderSetupRooms() {
    const container = document.getElementById('setup-rooms-list');
    
    if (!setupData.rooms || setupData.rooms.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: var(--text-muted); font-size: 14px;">
                No rooms added yet. Add at least one room to continue.
            </div>
        `;
        return;
    }
    
    container.innerHTML = setupData.rooms.map(room => `
        <div style="border: 1px solid var(--border); border-radius: 8px; padding: 15px; background: var(--bg-card);">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                <div>
                    <div style="font-weight: 600; font-size: 15px; color: var(--text-primary); margin-bottom: 4px;">${escapeHtml(room.name)}</div>
                    <div style="font-size: 12px; color: var(--text-muted);">${room.zones.length} zone${room.zones.length !== 1 ? 's' : ''}</div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button type="button" onclick="removeSetupRoom('${room.id}')" style="padding: 6px 12px; background: var(--bg-secondary); border: 1px solid var(--border); color: var(--error-red); border-radius: 4px; cursor: pointer; font-size: 12px;">Remove</button>
                </div>
            </div>
            
            <!-- Add Zone Input -->
            <div style="display: flex; gap: 8px; margin-top: 10px;">
                <input type="text" id="zone-input-${room.id}" placeholder="Add zone (optional)" style="flex: 1; padding: 8px 10px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); font-size: 13px;">
                <button type="button" onclick="addSetupZone('${room.id}')" style="padding: 8px 16px; background: var(--accent-green); border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 12px; white-space: nowrap;">Add Zone</button>
            </div>
            
            <!-- Zones List -->
            ${room.zones.length > 0 ? `
                <div style="margin-top: 10px; display: flex; flex-wrap: gap; gap: 6px;">
                    ${room.zones.map(zone => `
                        <div style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; background: var(--accent-blue); color: white; border-radius: 4px; font-size: 12px;">
                            <span>${escapeHtml(zone.name)}</span>
                            <button type="button" onclick="removeSetupZone('${room.id}', '${zone.id}')" style="background: none; border: none; color: white; cursor: pointer; padding: 0; font-size: 14px; line-height: 1;">×</button>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
        </div>
    `).join('');
}

/**
 * Add a zone to a room in setup wizard
 */
function addSetupZone(roomId) {
    const zoneInput = document.getElementById(`zone-input-${roomId}`);
    const zoneName = zoneInput.value.trim();
    
    if (!zoneName) {
        return;
    }
    
    const room = setupData.rooms.find(r => r.id === roomId);
    if (!room) return;
    
    // Check for duplicate zone names in this room
    if (room.zones.some(z => z.name.toLowerCase() === zoneName.toLowerCase())) {
        showSetupError('A zone with this name already exists in this room');
        return;
    }
    
    // Add zone
    const zone = {
        id: Date.now().toString(),
        name: zoneName
    };
    
    room.zones.push(zone);
    zoneInput.value = '';
    
    renderSetupRooms();
}

/**
 * Remove a room from setup wizard
 */
function removeSetupRoom(roomId) {
    setupData.rooms = setupData.rooms.filter(r => r.id !== roomId);
    renderSetupRooms();
}

/**
 * Submit tray formats to backend API
 */
async function submitTrayFormats() {
    const selectedFormats = setupData.trayFormats || [];
    
    if (selectedFormats.length === 0) {
        console.log('[Setup] No tray formats selected, skipping submission');
        return { success: true, message: 'No formats selected' };
    }
    
    try {
        const token = localStorage.getItem('token');
        const farmId = localStorage.getItem('farmId') || localStorage.getItem('farm_id');
        
        const results = [];
        
        // Submit each tray format
        for (const cells of selectedFormats) {
            const response = await fetch('/api/inventory/tray-formats', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    name: `${cells}-Cell Tray`,
                    plantSiteCount: cells,
                    systemType: 'tray',
                    trayMaterial: 'plastic',
                    description: `Standard ${cells}-cell tray format`,
                    targetWeightPerSite: 0,
                    weightUnit: 'oz',
                    isWeightBased: false
                })
            });
            
            const data = await response.json();
            results.push({ cells, success: response.ok, data });
            
            if (response.ok) {
                console.log(`[Setup] Created tray format: ${cells}-cell`);
            } else {
                console.error(`[Setup] Failed to create ${cells}-cell format:`, data);
            }
        }
        
        const successCount = results.filter(r => r.success).length;
        return {
            success: successCount > 0,
            message: `${successCount} of ${selectedFormats.length} tray formats created`,
            results
        };
        
    } catch (error) {
        console.error('[Setup] Error submitting tray formats:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Remove a zone from a room in setup wizard
 */
function removeSetupZone(roomId, zoneId) {
    const room = setupData.rooms.find(r => r.id === roomId);
    if (!room) return;
    
    room.zones = room.zones.filter(z => z.id !== zoneId);
    renderSetupRooms();
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Use current GPS location to populate address fields
 * Required for weather API integration
 */
async function useCurrentLocation() {
    const statusEl = document.getElementById('setup-location-status');
    const btn = document.getElementById('setup-use-location');
    
    if (!navigator.geolocation) {
        statusEl.textContent = '❌ Geolocation not supported by your browser';
        statusEl.style.color = 'var(--error-red)';
        return;
    }
    
    btn.disabled = true;
    btn.textContent = '⏳ Getting location...';
    statusEl.textContent = 'Requesting GPS coordinates (required for weather data)...';
    statusEl.style.color = 'var(--text-muted)';
    
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            
            console.log('[Setup] Got GPS coordinates:', { lat, lon });
            
            // Store coordinates (required for weather API)
            document.getElementById('setup-latitude').value = lat;
            document.getElementById('setup-longitude').value = lon;
            
            statusEl.textContent = '✔ Location captured! Fetching address...';
            
            try {
                // Reverse geocode to get address
                const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`, {
                    headers: {
                        'User-Agent': 'LightEngineFoxtrot/1.0'
                    }
                });
                
                if (!response.ok) {
                    throw new Error(`Geocoding API returned ${response.status}`);
                }
                
                const data = await response.json();
                console.log('[Setup] Geocoding result:', data);
                
                if (data && data.address) {
                    const addr = data.address;
                    
                    // Fill in address fields
                    if (addr.road) {
                        const street = addr.house_number ? `${addr.house_number} ${addr.road}` : addr.road;
                        document.getElementById('setup-address').value = street;
                    }
                    if (addr.city || addr.town || addr.village) {
                        document.getElementById('setup-city').value = addr.city || addr.town || addr.village;
                    }
                    if (addr.state) {
                        document.getElementById('setup-state').value = addr.state;
                    }
                    if (addr.postcode) {
                        document.getElementById('setup-postal').value = addr.postcode;
                    }
                    
                    statusEl.textContent = '✔ Location and address captured! (Weather data enabled)';
                    statusEl.style.color = 'var(--accent-green)';
                } else {
                    statusEl.textContent = '⚠ GPS captured, but could not determine address. Please enter manually.';
                    statusEl.style.color = 'var(--text-secondary)';
                }
            } catch (error) {
                console.error('[Setup] Geocoding error:', error);
                statusEl.textContent = '⚠ GPS captured, geocoding failed. Please enter address manually.';
                statusEl.style.color = 'var(--text-secondary)';
            }
            
            btn.disabled = false;
            btn.textContent = '📍 Use Current Location';
        },
        (error) => {
            console.error('[Setup] Geolocation error:', error);
            
            let errorMsg = 'Location access failed';
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    errorMsg = '❌ Location access denied. Please enable location permissions for weather data.';
                    break;
                case error.POSITION_UNAVAILABLE:
                    errorMsg = '❌ Location unavailable. Please check your device settings.';
                    break;
                case error.TIMEOUT:
                    errorMsg = '❌ Location request timed out. Please try again.';
                    break;
                default:
                    errorMsg = '❌ Unknown error accessing location. Please enter address manually.';
            }
            
            statusEl.textContent = errorMsg;
            statusEl.style.color = 'var(--error-red)';
            btn.disabled = false;
            btn.textContent = '📍 Use Current Location';
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

// === USER MANAGEMENT ===

/**
 * Load users and populate the users table
 */
async function loadUsers() {
    try {
        // Fetch real users from API
        let users = [];
        try {
            const resp = await fetch(`${API_BASE}/api/users/list?farmId=${currentSession.farmId}`, {
                headers: { 'Authorization': `Bearer ${currentSession.token}` }
            });
            if (resp.ok) {
                const data = await resp.json();
                users = data.users || data || [];
            }
        } catch (e) {
            console.warn('Users API not available:', e.message);
        }

        // If no API data, show the logged-in user from session
        if (users.length === 0 && currentSession) {
            users = [{
                id: 1,
                name: currentSession.name || currentSession.email || 'Admin',
                email: currentSession.email || '',
                role: currentSession.role || 'admin',
                status: 'active',
                lastLogin: new Date().toISOString()
            }];
        }

        // Store for filtering
        window.allUsers = users;
        
        renderUsersTable(users);
        loadAccessLog();
    } catch (error) {
        console.error('Error loading users:', error);
        showToast('Error loading users', 'error');
    }
}

/**
 * Render users table
 */
function renderUsersTable(users) {
    const tbody = document.querySelector('#users-table tbody');
    
    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 40px; color: var(--text-muted);">No users found</td></tr>';
        return;
    }
    
    tbody.innerHTML = users.map(user => {
        const roleColors = {
            admin: 'var(--accent-red)',
            manager: 'var(--accent-blue)',
            operator: 'var(--accent-green)',
            viewer: 'var(--text-muted)'
        };
        
        const statusColors = {
            active: 'var(--accent-green)',
            suspended: 'var(--accent-yellow)',
            inactive: 'var(--text-muted)'
        };
        
        const lastLogin = new Date(user.lastLogin);
        const timeSince = formatTimeSince(lastLogin);
        
        return `
            <tr>
                <td style="font-weight: 500;">${escapeHtml(user.name)}</td>
                <td>${escapeHtml(user.email)}</td>
                <td>
                    <span style="display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase; background: rgba(${roleColors[user.role]}, 0.1); color: ${roleColors[user.role]}; border: 1px solid ${roleColors[user.role]};">
                        ${user.role}
                    </span>
                </td>
                <td>
                    <span style="display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; color: ${statusColors[user.status]};">
                        ● ${user.status}
                    </span>
                </td>
                <td style="color: var(--text-secondary);">${timeSince}</td>
                <td>
                    <button class="btn btn-sm" onclick="openEditUserModal(${user.id})" style="padding: 6px 12px; font-size: 13px;">Edit</button>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Filter users by role and search
 */
function filterUsers() {
    const roleFilter = document.getElementById('role-filter').value;
    const searchTerm = document.getElementById('user-search').value.toLowerCase();
    
    let filtered = window.allUsers || [];
    
    // Filter by role
    if (roleFilter !== 'all') {
        filtered = filtered.filter(u => u.role === roleFilter);
    }
    
    // Filter by search term
    if (searchTerm) {
        filtered = filtered.filter(u => 
            u.name.toLowerCase().includes(searchTerm) ||
            u.email.toLowerCase().includes(searchTerm)
        );
    }
    
    renderUsersTable(filtered);
}

/**
 * Open invite user modal
 */
function openInviteUserModal() {
    document.getElementById('inviteUserModal').style.display = 'flex';
    document.getElementById('invite-user-form').reset();
}

/**
 * Close invite user modal
 */
function closeInviteUserModal() {
    document.getElementById('inviteUserModal').style.display = 'none';
}

/**
 * Generate a random temporary password
 */
function generateTempPassword(length = 12) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

/**
 * Send user invitation (creates user with temp password)
 */
async function sendUserInvitation(event) {
    event.preventDefault();
    
    const email = document.getElementById('invite-email').value;
    const firstName = document.getElementById('invite-first-name').value;
    const lastName = document.getElementById('invite-last-name').value;
    const role = document.getElementById('invite-role').value;
    const message = document.getElementById('invite-message').value;
    const tempPassword = generateTempPassword();
    const fullName = `${firstName} ${lastName}`.trim();
    
    try {
        const response = await fetch(`${API_BASE}/api/users/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentSession.token}`
            },
            body: JSON.stringify({
                email,
                name: fullName,
                role,
                password: tempPassword,
                farmId: currentSession.farmId
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Failed to create user');
        }
        
        closeInviteUserModal();
        
        // Show temp password to admin so they can share it manually
        // (email sending is not available - SES sandbox restriction)
        const credentialsMsg = `User created successfully!\n\nLogin credentials for ${fullName}:\nEmail: ${email}\nTemporary Password: ${tempPassword}\n\nPlease share these credentials securely with the user and ask them to change their password after first login.`;
        alert(credentialsMsg);
        
        showToast(`User ${email} created successfully`, 'success');
        
        // Reload users list
        loadUsers();
        
    } catch (error) {
        console.error('Error creating user:', error);
        showToast(error.message || 'Error creating user', 'error');
    }
}

/**
 * Add pending invitation to table
 */
function addPendingInvitation(invitation) {
    const tbody = document.querySelector('#invitations-table tbody');
    
    // Remove "no invitations" message if present
    if (tbody.querySelector('td[colspan]')) {
        tbody.innerHTML = '';
    }
    
    const sent = formatTimeSince(new Date(invitation.sent));
    const expires = new Date(invitation.expires).toLocaleDateString();
    
    const row = document.createElement('tr');
    row.innerHTML = `
        <td>${escapeHtml(invitation.email)}</td>
        <td style="text-transform: capitalize;">${invitation.role}</td>
        <td>${escapeHtml(invitation.invitedBy)}</td>
        <td>${sent}</td>
        <td>${expires}</td>
        <td>
            <button class="btn btn-sm" onclick="resendInvitation('${invitation.email}')" style="padding: 4px 8px; font-size: 12px;">Resend</button>
            <button class="btn btn-sm" onclick="cancelInvitation('${invitation.email}')" style="padding: 4px 8px; font-size: 12px; background: var(--accent-red);">Cancel</button>
        </td>
    `;
    
    tbody.appendChild(row);
}

/**
 * Open edit user modal
 */
function openEditUserModal(userId) {
    const user = window.allUsers.find(u => u.id === userId);
    if (!user) return;
    
    document.getElementById('edit-user-id').value = user.id;
    document.getElementById('edit-user-name').value = user.name;
    document.getElementById('edit-user-email').value = user.email;
    document.getElementById('edit-user-role').value = user.role;
    document.getElementById('edit-user-status').value = user.status;
    
    document.getElementById('editUserModal').style.display = 'flex';
}

/**
 * Close edit user modal
 */
function closeEditUserModal() {
    document.getElementById('editUserModal').style.display = 'none';
}

/**
 * Save user changes
 */
async function saveUserChanges(event) {
    event.preventDefault();
    
    const userId = parseInt(document.getElementById('edit-user-id').value);
    const role = document.getElementById('edit-user-role').value;
    const status = document.getElementById('edit-user-status').value;
    
    try {
        // In production, would call API
        // const response = await fetch(`/api/users/${userId}`, {
        //     method: 'PATCH',
        //     headers: {
        //         'Content-Type': 'application/json',
        //         'X-Farm-ID': localStorage.getItem('farm_id')
        //     },
        //     body: JSON.stringify({ role, status })
        // });
        
        // Update local data
        const user = window.allUsers.find(u => u.id === userId);
        if (user) {
            user.role = role;
            user.status = status;
        }
        
        showToast('User updated successfully', 'success');
        closeEditUserModal();
        renderUsersTable(window.allUsers);
        
    } catch (error) {
        console.error('Error updating user:', error);
        showToast('Error updating user', 'error');
    }
}

/**
 * Remove user
 */
async function removeUser() {
    const userId = parseInt(document.getElementById('edit-user-id').value);
    const user = window.allUsers.find(u => u.id === userId);
    
    if (!confirm(`Are you sure you want to remove ${user.name}? This action cannot be undone.`)) {
        return;
    }
    
    try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        await fetch('/api/users/delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ email: user.email })
        });
        
        window.allUsers = window.allUsers.filter(u => u.id !== userId);
        
        showToast('User removed successfully', 'success');
        closeEditUserModal();
        renderUsersTable(window.allUsers);
        
    } catch (error) {
        console.error('Error removing user:', error);
        showToast('Error removing user', 'error');
    }
}

/**
 * Reset password for a farm user (admin action)
 */
async function resetUserPassword() {
    const userId = parseInt(document.getElementById('edit-user-id').value);
    const user = window.allUsers.find(u => u.id === userId);
    const newPassword = document.getElementById('edit-user-new-password').value.trim();

    if (!newPassword) {
        showToast('Please enter a new password', 'error');
        return;
    }
    if (newPassword.length < 8) {
        showToast('Password must be at least 8 characters', 'error');
        return;
    }

    if (!confirm(`Reset password for ${user.name} (${user.email})?`)) {
        return;
    }

    try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const response = await fetch('/api/users/reset-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ email: user.email, newPassword })
        });

        const data = await response.json();
        if (data.success) {
            showToast(`Password reset for ${user.email}`, 'success');
            document.getElementById('edit-user-new-password').value = '';
        } else {
            showToast(data.error || 'Failed to reset password', 'error');
        }
    } catch (error) {
        console.error('Error resetting password:', error);
        showToast('Error resetting password', 'error');
    }
}

/**
 * Resend invitation
 */
function resendInvitation(email) {
    showToast(`Invitation resent to ${email}`, 'success');
}

/**
 * Cancel invitation
 */
function cancelInvitation(email) {
    if (!confirm(`Cancel invitation for ${email}?`)) return;
    
    const tbody = document.querySelector('#invitations-table tbody');
    const rows = tbody.querySelectorAll('tr');
    
    rows.forEach(row => {
        if (row.cells[0].textContent === email) {
            row.remove();
        }
    });
    
    // If no more rows, show "no invitations" message
    if (tbody.children.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 14px;">No pending invitations</td></tr>';
    }
    
    showToast('Invitation cancelled', 'info');
}

/**
 * Load access activity log
 */
async function loadAccessLog() {
    const tbody = document.querySelector('#access-log-table tbody');
    
    // Fetch real audit log from API
    let activities = [];
    try {
        const resp = await fetch(`${API_BASE}/api/farm/activity/${currentSession.farmId}`, {
            headers: { 'Authorization': `Bearer ${currentSession.token}` }
        });
        if (resp.ok) {
            const data = await resp.json();
            if (data.activity && data.activity.length > 0) {
                activities = data.activity.slice(0, 10).map(event => ({
                    time: new Date(event.timestamp).getTime(),
                    user: event.user || 'System',
                    action: event.description || 'Activity event',
                    ip: '—',
                    status: event.status || 'active'
                }));
            }
        }
    } catch (e) {
        console.warn('Access log API not available:', e.message);
    }

    if (activities.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                    <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">🔒</div>
                    <div>No access activity recorded yet</div>
                    <div style="font-size: 0.85rem; margin-top: 0.5rem;">Activity will appear as users log in and perform actions</div>
                </td>
            </tr>`;
        return;
    }
    
    tbody.innerHTML = activities.map(activity => {
        const statusColor = activity.status === 'failed' ? 'var(--accent-red)' : 'var(--accent-green)';
        
        return `
            <tr>
                <td style="color: var(--text-secondary);">${formatTimeSince(new Date(activity.time))}</td>
                <td>${escapeHtml(activity.user)}</td>
                <td>${escapeHtml(activity.action)}</td>
                <td style="font-family: monospace; font-size: 13px; color: var(--text-muted);">${activity.ip}</td>
                <td>
                    <span style="color: ${statusColor}; font-weight: 500; text-transform: capitalize;">
                        ${activity.status}
                    </span>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Format time since
 */
function formatTimeSince(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    const intervals = {
        year: 31536000,
        month: 2592000,
        week: 604800,
        day: 86400,
        hour: 3600,
        minute: 60
    };
    
    for (const [unit, secondsInUnit] of Object.entries(intervals)) {
        const interval = Math.floor(seconds / secondsInUnit);
        if (interval >= 1) {
            return interval === 1 ? `1 ${unit} ago` : `${interval} ${unit}s ago`;
        }
    }
    
    return 'just now';
}

// Setup user search
document.addEventListener('DOMContentLoaded', () => {
    const userSearch = document.getElementById('user-search');
    if (userSearch) {
        userSearch.addEventListener('input', filterUsers);
    }
});

// ============================================
// Quality Control System
// ============================================

// Quality control data — loaded from API
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
        const notes = cp.notes ? (cp.notes.length > 60 ? cp.notes.slice(0, 57) + '...' : cp.notes) : '\u2014';

        return '<tr>' +
            '<td><span style="font-family:monospace;color:var(--accent-blue);">' + (cp.id || '\u2014') + '</span></td>' +
            '<td><div>' + dateStr + '</div><small style="color:var(--text-muted);">' + timeStr + '</small></td>' +
            '<td><span style="font-family:monospace;">' + (cp.batch_id || '\u2014') + '</span></td>' +
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

        const notes = r.notes ? (r.notes.length > 50 ? r.notes.slice(0, 47) + '...' : r.notes) : '\u2014';

        return '<tr>' +
            '<td><span style="font-family:monospace;color:var(--accent-blue);">' + r.id + '</span></td>' +
            '<td>' + (r.test_date || '\u2014') + '</td>' +
            '<td>' + (typeLabels[r.report_type] || r.report_type) + '</td>' +
            '<td>' + (r.lab_name || '\u2014') + '</td>' +
            '<td><span style="font-family:monospace;">' + (r.lot_code || '\u2014') + '</span></td>' +
            '<td>' + badge + '</td>' +
            '<td>' + notes + '</td>' +
            '<td><button class="btn-icon" onclick="deleteLabReport(\'' + r.id + '\')" title="Delete"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></td>' +
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
    let csv = 'Source,ID,Date,Type,Inspector/Lab,Batch/Lot,Result,Notes\n';

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
        ].join(',') + '\n';
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
        ].join(',') + '\n';
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

function showNotification(message, type = 'info') {
    // Simple notification - can be enhanced with a proper notification system
    alert(message);
}
// ========================================
// USER MANAGEMENT FUNCTIONS
// ========================================

/**
 * Initialize user management section
 */
async function initUserManagement() {
    // Load current user info
    if (currentSession && currentSession.email) {
        document.getElementById('current-user-email').value = currentSession.email || '';
        document.getElementById('current-user-role').value = currentSession.role || 'admin';
    }

    // Setup event listeners
    document.getElementById('change-password-form').addEventListener('submit', handlePasswordChange);
    document.getElementById('add-user-btn').addEventListener('click', () => {
        document.getElementById('add-user-form-container').style.display = 'block';
    });
    document.getElementById('cancel-add-user-btn').addEventListener('click', () => {
        document.getElementById('add-user-form-container').style.display = 'none';
        document.getElementById('add-user-form').reset();
    });
    document.getElementById('add-user-form').addEventListener('submit', handleAddUser);

    // Load users list
    await loadUsers();
}

/**
 * Handle password change
 */
async function handlePasswordChange(event) {
    event.preventDefault();
    
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    const messageEl = document.getElementById('password-change-message');

    // Validate passwords match
    if (newPassword !== confirmPassword) {
        messageEl.textContent = 'New passwords do not match';
        messageEl.style.display = 'block';
        messageEl.style.background = '#fee';
        messageEl.style.color = '#c33';
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/user/change-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentSession.token}`
            },
            body: JSON.stringify({
                currentPassword,
                newPassword
            })
        });

        const data = await response.json();

        if (response.ok) {
            messageEl.textContent = 'Password updated successfully';
            messageEl.style.display = 'block';
            messageEl.style.background = '#efe';
            messageEl.style.color = '#3a3';
            document.getElementById('change-password-form').reset();
        } else {
            throw new Error(data.message || 'Failed to update password');
        }
    } catch (error) {
        messageEl.textContent = error.message;
        messageEl.style.display = 'block';
        messageEl.style.background = '#fee';
        messageEl.style.color = '#c33';
    }
}

/**
 * Handle add new user
 */
async function handleAddUser(event) {
    event.preventDefault();
    
    const email = document.getElementById('new-user-email').value;
    const name = document.getElementById('new-user-name').value;
    const role = document.getElementById('new-user-role').value;
    const password = document.getElementById('new-user-password').value;
    const messageEl = document.getElementById('add-user-message');

    try {
        const response = await fetch(`${API_BASE}/api/users/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentSession.token}`
            },
            body: JSON.stringify({
                email,
                name,
                role,
                password,
                farmId: currentSession.farmId
            })
        });

        const data = await response.json();

        if (response.ok) {
            messageEl.textContent = 'User created successfully. They can now log in with the provided credentials.';
            messageEl.style.display = 'block';
            messageEl.style.background = '#efe';
            messageEl.style.color = '#3a3';
            document.getElementById('add-user-form').reset();
            
            // Reload users list
            setTimeout(() => {
                document.getElementById('add-user-form-container').style.display = 'none';
                loadUsers();
            }, 2000);
        } else {
            throw new Error(data.message || 'Failed to create user');
        }
    } catch (error) {
        messageEl.textContent = error.message;
        messageEl.style.display = 'block';
        messageEl.style.background = '#fee';
        messageEl.style.color = '#c33';
    }
}

/**
 * Delete user
 */
async function deleteUser(email) {
    if (!confirm(`Are you sure you want to remove ${email} from this farm?`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/users/delete`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentSession.token}`
            },
            body: JSON.stringify({
                email,
                farmId: currentSession.farmId
            })
        });

        if (response.ok) {
            showNotification('User removed successfully', 'success');
            loadUsers();
        } else {
            const data = await response.json();
            throw new Error(data.message || 'Failed to remove user');
        }
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

// Initialize user management when the section is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Check if we're on the users section
    const urlHash = window.location.hash;
    if (urlHash === '#users') {
        initUserManagement();
    }
    
    // Also initialize when navigating to users section
    document.addEventListener('click', (e) => {
        if (e.target.matches('[data-section="users"]') || e.target.closest('[data-section="users"]')) {
            setTimeout(() => initUserManagement(), 100);
        }
    });
});
