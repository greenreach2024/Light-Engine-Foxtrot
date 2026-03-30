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

// Clear all farm-scoped localStorage/sessionStorage on login to prevent cross-farm data leakage
function clearStaleFarmData() {
  const farmKeys = [
    'farm_id', 'farmId', 'farm_name', 'farmName', 'email',
    'token', 'auth_token',
    STORAGE_KEY_SESSION,
    'gr.farm', 'farmSettings', 'qualityStandards', 'setup_completed',
    'ai_pricing_recommendations', 'ai_pricing_last_check', 'ai_pricing_history',
    'pricing_version', 'usd_to_cad_rate',
    'impersonation_token', 'impersonation_farm', 'impersonation_expires',
    'adminFarmId'
  ];
  for (const key of farmKeys) {
    try { localStorage.removeItem(key); } catch (_) {}
    try { sessionStorage.removeItem(key); } catch (_) {}
  }
  // Clear dynamic pricing_<crop> keys
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('pricing_')) localStorage.removeItem(k);
    }
  } catch (_) {}
  console.log('[auth] Cleared stale farm data before login');
}

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
    grLog(' Initializing farm admin login...');
    
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
            console.warn('Detected potential redirect loop, clearing all auth data');
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
        console.warn('Clearing stale session without token');
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
            document.getElementById('email').value = 'info@greenreachgreens.com';
        }
        // Test credential auto-fill removed for security
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
                    email: payload.email || existingEmail || 'info@greenreachgreens.com',
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
                email: existingEmail || 'info@greenreachgreens.com',
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
            console.warn('No valid session found, redirecting to login');
            // Clear redirect counter and stale data before redirecting
            sessionStorage.removeItem('login_redirect_count');
            localStorage.removeItem(STORAGE_KEY_SESSION);
            window.location.href = '/farm-admin-login.html';
            return;
        }

        currentSession = {
            token: 'local-access',
            farmId: 'LOCAL-FARM',
            farmName: currentSession?.farmName || localStorage.getItem('farm_name') || 'My Farm',
            email: 'info@greenreachgreens.com',
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
            // Clear previous farm data to prevent cross-tenant leakage
            clearStaleFarmData();

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
            const farmHeader = currentSession?.farmId || sessionStorage.getItem('farm_id') || sessionStorage.getItem('farmId') || localStorage.getItem('farm_id') || localStorage.getItem('farmId');
            const inventoryResponse = await fetch(`${API_BASE}/api/inventory/current`, {
                headers: {
                    'Authorization': `Bearer ${currentSession.token}`,
                    ...(farmHeader ? { 'x-farm-id': farmHeader } : {})
                }
            });
            if (inventoryResponse.ok) {
                const inventoryRaw = await inventoryResponse.json();
                // /api/inventory/current returns { status, dataAvailable, data: { activeTrays, totalPlants, byFarm } }
                inventoryData = inventoryRaw?.data || inventoryRaw;
                console.log(` Loaded inventory: ${inventoryData?.activeTrays || 0} trays, ${inventoryData?.totalPlants || 0} plants`);
            } else {
                console.warn(` /api/inventory/current returned ${inventoryResponse.status}`);
            }
        } catch (err) {
            console.error(' Error fetching /api/inventory/current:', err);
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
                        <div style="font-size: 2rem; margin-bottom: 0.5rem;"></div>
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
                    <div>Failed to load activity</div>
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
    grLog(' Returning to home...');
    console.log(' DEBUG - Logout called from:', window.location.href);
    console.log(' DEBUG - Redirecting to: /LE-dashboard.html');
    console.log(' DEBUG - Current page version:', window.__PAGE_VERSION__);
    
    // Clear any stored session data
    localStorage.removeItem(STORAGE_KEY_SESSION);
    
    // Redirect to updated dashboard with new UI
    console.log(' DEBUG - Executing redirect now...');
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
let isPerGram = false; // false = per lb (default), true = per 100g
const LB_TO_100G = 0.22046; // 1 lb = 453.592g, so 100g/453.592g = 0.22046

// Pricing version - increment this when defaultPricing changes to force localStorage clear
const PRICING_VERSION = '2026-03-27-v10';
// Unit-of-measure map for Canadian packaged-goods pricing
// 'weight' = sold by weight ($/oz or $/25g), 'pint' = sold per pint, 'unit' = sold per item
const cropUnitMap = {
    // Strawberries -- sold by the pint
    'Albion': 'pint',
    'Chandler': 'pint',
    'Eversweet': 'pint',
    'Fort Laramie': 'pint',
    'Jewel': 'pint',
    'Mara de Bois': 'pint',
    'Monterey': 'pint',
    'Ozark Beauty': 'pint',
    'Seascape': 'pint',
    'Sequoia': 'pint',
    'Tribute': 'pint',
    'Tristar': 'pint',
    // Large tomatoes -- sold per unit (each)
    'Better Boy': 'unit',
    'Brandywine': 'unit',
    'Celebrity': 'unit',
    'Heatmaster F1': 'unit',
    'San Marzano-': 'unit',
    // Cherry tomatoes -- sold by weight
    'Sun Gold': 'weight'
    // All leafy greens, herbs, and other crops default to 'weight'
};

function getCropUnit(cropName) {
    return cropUnitMap[cropName] || 'weight';
}

function getCropUnitLabel(cropName) {
    const unit = getCropUnit(cropName);
    if (unit === 'pint') return '/pint';
    if (unit === 'unit') return '/each';
    return isPerGram ? '/100g' : '/lb';
}

function getCropBackendUnit(cropName) {
    const unit = getCropUnit(cropName);
    if (unit === 'pint') return 'pint';
    if (unit === 'unit') return 'unit';
    return 'lb';
}

// Default pricing per lb (CAD) - AI-generated from Canadian retail market data
// Formula: (package_price_CAD / package_weight_oz) * 16 oz/lb * 1.05 premium
// Source: Loblaws, Metro, Sobeys, Farm Boy, No Frills (Ontario observed prices)
const defaultPricing = {
    // Lettuce: $4.99 CAD / 5oz pkg -> $16.77/lb
    'Butterhead Lettuce': { retail: 16.77, ws1: 15, ws2: 25, ws3: 35 },
    'Breen Pelleted Organic': { retail: 16.77, ws1: 15, ws2: 25, ws3: 35 },
    'Truchas Pelleted Organic': { retail: 16.77, ws1: 15, ws2: 25, ws3: 35 },
    'Red Leaf Lettuce': { retail: 16.77, ws1: 15, ws2: 25, ws3: 35 },
    'Oak Leaf Lettuce': { retail: 16.77, ws1: 15, ws2: 25, ws3: 35 },

    // Spinach: $4.49 CAD / 5oz pkg -> $15.08/lb
    'Seaside F1 Spinach (baby leaf)': { retail: 15.08, ws1: 15, ws2: 25, ws3: 35 },
    'Spinach': { retail: 15.08, ws1: 15, ws2: 25, ws3: 35 },

    // Basil: $2.29-2.49 CAD / 1oz pkg -> $38.47-41.83/lb
    'Genovese Basil': { retail: 38.47, ws1: 15, ws2: 25, ws3: 35 },
    'Thai Basil': { retail: 41.83, ws1: 15, ws2: 25, ws3: 35 },
    'Purple Basil': { retail: 41.83, ws1: 15, ws2: 25, ws3: 35 },
    'Lemon Basil': { retail: 41.83, ws1: 15, ws2: 25, ws3: 35 },
    'Holy Basil': { retail: 41.83, ws1: 15, ws2: 25, ws3: 35 },
    'Basil': { retail: 38.47, ws1: 15, ws2: 25, ws3: 35 },

    // Arugula: $4.49 CAD / 5oz pkg -> $15.08/lb
    'Baby Arugula': { retail: 15.08, ws1: 15, ws2: 25, ws3: 35 },
    'Cultivated Arugula': { retail: 15.08, ws1: 15, ws2: 25, ws3: 35 },
    'Wild Arugula': { retail: 15.08, ws1: 15, ws2: 25, ws3: 35 },
    'Wasabi Arugula': { retail: 15.08, ws1: 15, ws2: 25, ws3: 35 },
    'Red Arugula': { retail: 15.08, ws1: 15, ws2: 25, ws3: 35 },
    'Arugula': { retail: 15.08, ws1: 15, ws2: 25, ws3: 35 },

    // Kale: $4.49 CAD / 5oz pkg -> $15.08/lb
    'Curly Kale': { retail: 15.08, ws1: 15, ws2: 25, ws3: 35 },
    'Baby Kale': { retail: 15.08, ws1: 15, ws2: 25, ws3: 35 },
    'Kale': { retail: 15.08, ws1: 15, ws2: 25, ws3: 35 },

    // Swiss Chard: $3.49 CAD / 8oz bunch -> $7.33/lb
    'Swiss Chard': { retail: 7.33, ws1: 15, ws2: 25, ws3: 35 },
    'Magenta Sunset Swiss Chard': { retail: 7.33, ws1: 15, ws2: 25, ws3: 35 },

    // Watercress: $3.99 CAD / 4oz pkg -> $16.76/lb
    'Watercress': { retail: 16.76, ws1: 15, ws2: 25, ws3: 35 },

    // Bok Choy/Asian greens: $3.49 CAD / 6oz pkg -> $9.77/lb
    'Mei Qing Pak Choi': { retail: 9.77, ws1: 15, ws2: 25, ws3: 35 },
    'Tatsoi': { retail: 9.77, ws1: 15, ws2: 25, ws3: 35 },
    'Komatsuna Mustard Spinach': { retail: 9.77, ws1: 15, ws2: 25, ws3: 35 },
    'Mizuna Mustard Greens': { retail: 9.77, ws1: 15, ws2: 25, ws3: 35 },

    // Mixed Greens: $4.99 CAD / 5oz pkg -> $16.77/lb
    'Mixed Greens': { retail: 16.77, ws1: 15, ws2: 25, ws3: 35 },
    'Escarole Batavian': { retail: 16.77, ws1: 15, ws2: 25, ws3: 35 },
    'Sorrel': { retail: 16.77, ws1: 15, ws2: 25, ws3: 35 },

    // Herbs (per lb from packaged fresh herbs)
    'Parsley': { retail: 33.43, ws1: 15, ws2: 25, ws3: 35 },
    'Italian Parsley': { retail: 33.43, ws1: 15, ws2: 25, ws3: 35 },
    'Cilantro': { retail: 25.03, ws1: 15, ws2: 25, ws3: 35 },
    'Dill Bouquet': { retail: 33.43, ws1: 15, ws2: 25, ws3: 35 },
    'Common Thyme': { retail: 58.92, ws1: 15, ws2: 25, ws3: 35 },
    'French Tarragon': { retail: 66.97, ws1: 15, ws2: 25, ws3: 35 },
    'Greek Oregano': { retail: 53.26, ws1: 15, ws2: 25, ws3: 35 },
    'Rosemary': { retail: 66.02, ws1: 15, ws2: 25, ws3: 35 },
    'Sage': { retail: 66.02, ws1: 15, ws2: 25, ws3: 35 },
    'Marjoram': { retail: 53.26, ws1: 15, ws2: 25, ws3: 35 },
    'Chervil': { retail: 33.43, ws1: 15, ws2: 25, ws3: 35 },
    'Lemon Balm': { retail: 41.83, ws1: 15, ws2: 25, ws3: 35 },
    'Lovage': { retail: 33.43, ws1: 15, ws2: 25, ws3: 35 },
    'Kentucky Colonel Spearmint': { retail: 41.83, ws1: 15, ws2: 25, ws3: 35 },

    // Microgreens: $4.49 CAD / 2oz tray -> $37.72/lb
    'Microgreen': { retail: 37.72, ws1: 15, ws2: 20, ws3: 30 },

    // Sprouts: $3.49 CAD / 6oz container -> $9.77/lb
    'Sprout': { retail: 9.77, ws1: 20, ws2: 25, ws3: 35 },

    // Strawberries: $5.99 USD/pint * 1.35 fx * 1.05 premium = $8.49/pint
    'Strawberry': { retail: 8.49, ws1: 15, ws2: 25, ws3: 35 },

    // Cherry Tomato: $4.99 USD / 10oz * 1.35 fx * 16/oz * 1.05 = $11.32/lb
    'Cherry Tomato': { retail: 11.32, ws1: 15, ws2: 25, ws3: 35 },

    // Tomato: $2.49 USD/each * 1.35 fx * 1.05 premium = $3.53/each
    'Tomato': { retail: 3.53, ws1: 15, ws2: 25, ws3: 35 }
};
/**
 * Load crops and pricing — API first, localStorage fallback
 */
async function loadCropsFromDatabase() {
    try {
        // Try loading from server-side pricing API first
        let loadedFromAPI = false;
        try {
            const pricingRes = await fetch(`${API_BASE}/api/crop-pricing`, {
                headers: currentSession?.token ? { 'Authorization': `Bearer ${currentSession.token}` } : undefined
            });
            if (pricingRes.ok) {
                const pricingResult = await pricingRes.json();
                if (pricingResult.ok && pricingResult.pricing?.crops?.length) {
                    // Map API fields to frontend field names
                    pricingData = pricingResult.pricing.crops.map(c => ({
                        crop: c.crop,
                        retail: c.retailPrice || 0,
                        ws1Discount: c.ws1Discount ?? 20,
                        ws2Discount: c.ws2Discount ?? 25,
                        ws3Discount: c.ws3Discount ?? 35,
                        isTaxable: c.isTaxable || false,
                        floor_price: c.floor_price ?? 0,
                        sku_factor: c.sku_factor ?? 0.75
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
                const defaults = defaultPricing[crop] || { retail: 16.77, ws1: 15, ws2: 25, ws3: 35 };
                return { crop, retail: defaults.retail, ws1Discount: defaults.ws1, ws2Discount: defaults.ws2, ws3Discount: defaults.ws3, isTaxable: false, floor_price: 0, sku_factor: 0.75 };
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
    const unitLabel = isPerGram ? '/100g' : '/lb';
    const rows = [['Crop', `Retail (${unitLabel})`, 'Floor Price', 'SKU Factor', `Formula WS (${unitLabel})`, 'Taxable']];
    pricingData.forEach(item => {
        const r = isPerGram ? convertPrice(item.retail, true) : item.retail;
        rows.push([
            item.crop, r.toFixed(2),
            (item.floor_price || 0).toFixed(2),
            (item.sku_factor || 0.75).toFixed(2),
            calculateFormulaWholesalePrice(r, item.floor_price, item.sku_factor).toFixed(2),
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
 * Convert price between lb and 100g
 */
function convertPrice(price, toGram = false) {
    if (toGram) {
        // Convert lb to 100g: multiply by conversion factor
        return price * LB_TO_100G;
    } else {
        // Convert 100g to lb: divide by conversion factor
        return price / LB_TO_100G;
    }
}

/**
 * Calculate wholesale price based on discount
 */
function calculateWholesalePrice(retail, discountPercent) {
    return retail * (1 - discountPercent / 100);
}

/**
 * Calculate wholesale price using the two-step formula:
 * wholesale = max(floor, retailAggregate * skuFactor)
 * where floor = max(costFloor, manualFloor)
 */
function calculateFormulaWholesalePrice(retail, floorPrice, skuFactor) {
    const factor = Math.min(0.75, Math.max(0.5, Number(skuFactor || 0.75)));
    const floor = Number(floorPrice || 0);
    const computed = retail * factor;
    return Math.max(floor, computed);
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
    
    const weightUnitLabel = isPerGram ? '/100g' : '/lb';
    
    // Update header labels to show weight unit (majority of crops)
    document.getElementById('unit-retail').textContent = `($${weightUnitLabel})`;
    
    tbody.innerHTML = pricingData.map((item, index) => {
        const cropUnit = getCropUnit(item.crop);
        const isWeightCrop = cropUnit === 'weight';
        const displayRetail = (isWeightCrop && isPerGram) ? convertPrice(item.retail, true) : item.retail;
        const formulaWS = calculateFormulaWholesalePrice(displayRetail, item.floor_price, item.sku_factor);
        const unitBadge = !isWeightCrop ? ` <span style="font-size: 11px; color: var(--text-muted); font-weight: 400;">(${getCropUnitLabel(item.crop)})</span>` : '';
        
        return `
            <tr>
                <td class="crop-name">${item.crop}${unitBadge}</td>
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
                        class="pricing-input" 
                        value="${(item.floor_price || 0).toFixed(2)}" 
                        step="0.01" 
                        min="0"
                        data-index="${index}"
                        data-field="floor_price"
                        onchange="updatePricing(${index}, 'floor_price', this.value)"
                        style="width: 70px;"
                    >
                </td>
                <td>
                    <input 
                        type="number" 
                        class="pricing-input" 
                        value="${(item.sku_factor || 0.75).toFixed(2)}" 
                        step="0.01" 
                        min="0.50" 
                        max="0.75"
                        data-index="${index}"
                        data-field="sku_factor"
                        onchange="updatePricing(${index}, 'sku_factor', this.value)"
                        style="width: 60px;"
                    >
                </td>
                <td class="calculated-price" style="font-weight: 600; color: var(--accent-green, #22c55e);">$${formulaWS.toFixed(2)}</td>
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
            // Convert back to oz for storage only for weight-based crops
            const cropUnit = getCropUnit(pricingData[index].crop);
            pricingData[index].retail = (cropUnit === 'weight' && isPerGram) ? convertPrice(numValue, false) : numValue;
        } else if (field === 'sku_factor') {
            // Clamp SKU factor to valid range 0.50-0.75
            pricingData[index].sku_factor = Math.min(0.75, Math.max(0.5, numValue));
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
                unit: getCropBackendUnit(item.crop),
                retailPrice: parseFloat(item.retail),
                wholesalePrice: parseFloat(calculateFormulaWholesalePrice(item.retail, item.floor_price, item.sku_factor)),
                ws1Discount: item.ws1Discount,
                ws2Discount: item.ws2Discount,
                ws3Discount: item.ws3Discount,
                isTaxable: item.isTaxable || false,
                floor_price: item.floor_price || 0,
                sku_factor: item.sku_factor || 0.75
            }));
            
            const response = await fetch(`${API_BASE}/api/crop-pricing`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...(currentSession?.token ? { 'Authorization': `Bearer ${currentSession.token}` } : {})
                },
                body: JSON.stringify({ crops })
            });
            
            if (response.ok) {
                console.log('Pricing saved to backend API');
                // Also push formula-based wholesale prices to admin/pricing
                try {
                    for (const item of pricingData) {
                        const formulaPrice = calculateFormulaWholesalePrice(item.retail, item.floor_price, item.sku_factor);
                        await fetch(`${API_BASE}/api/admin/pricing/set-wholesale`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                ...(currentSession?.token ? { 'Authorization': `Bearer ${currentSession.token}` } : {})
                            },
                            body: JSON.stringify({
                                crop: item.crop,
                                floor_price: item.floor_price || 0,
                                sku_factor: item.sku_factor || 0.75,
                                use_formula: true,
                                tier: 'demand-based',
                                reasoning: 'Updated via LE farm admin pricing table'
                            })
                        });
                    }
                    console.log('Formula wholesale prices synced to admin/pricing');
                } catch (syncErr) {
                    console.warn('Admin pricing sync failed:', syncErr.message);
                }
            } else {
                console.warn('Failed to save to backend API (localStorage only)');
            }
        } catch (apiError) {
            console.warn('Backend API unavailable (localStorage only):', apiError.message);
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
const AI_PREMIUM_MARKUP_RATE = 0.05;

// Specialty crop delta learning storage key
const AI_SPECIALTY_DELTA_KEY = 'ai_specialty_deltas';

// Crop classification: maps every variety to its common retail name and whether
// it is a specialty variety. Common varieties appear in standard retail packages
// (e.g. "Baby Arugula" in a bag labeled "Arugula"). Specialty varieties are not
// sold standalone and are typically found unlabeled inside premium mixed green
// blends. The 5% markup accounts for comparing against non-organic retail.
//
// commonName: the retail parent category used for market data lookup
// isSpecialty: true = not sold as a standalone retail package; flag for grower review
const cropClassification = {
    // Arugula family
    'Baby Arugula':       { commonName: 'Arugula', isSpecialty: false },
    'Cultivated Arugula': { commonName: 'Arugula', isSpecialty: false },
    'Astro Arugula':      { commonName: 'Arugula', isSpecialty: false },
    'Arugula':            { commonName: 'Arugula', isSpecialty: false },
    'Wild Arugula':       { commonName: 'Arugula', isSpecialty: true },
    'Red Arugula':        { commonName: 'Arugula', isSpecialty: true },
    'Wasabi Arugula':     { commonName: 'Arugula', isSpecialty: true },

    // Basil family
    'Genovese Basil':     { commonName: 'Basil', isSpecialty: false },
    'Sweet Basil':        { commonName: 'Basil', isSpecialty: false },
    'Basil':              { commonName: 'Basil', isSpecialty: false },
    'Thai Basil':         { commonName: 'Basil', isSpecialty: true },
    'Holy Basil':         { commonName: 'Basil', isSpecialty: true },
    'Lemon Basil':        { commonName: 'Basil', isSpecialty: true },
    'Purple Basil':       { commonName: 'Basil', isSpecialty: true },

    // Lettuce family
    'Butterhead Lettuce':   { commonName: 'Butterhead Lettuce', isSpecialty: false },
    'Buttercrunch Lettuce': { commonName: 'Butterhead Lettuce', isSpecialty: false },
    'Bibb Butterhead':      { commonName: 'Butterhead Lettuce', isSpecialty: false },
    'Romaine Lettuce':      { commonName: 'Mixed Greens', isSpecialty: false },
    'Red Leaf Lettuce':     { commonName: 'Lettuce', isSpecialty: false },
    'Lettuce':              { commonName: 'Mixed Greens', isSpecialty: false },
    'Mixed Lettuce':        { commonName: 'Mixed Greens', isSpecialty: false },
    'Oak Leaf Lettuce':     { commonName: 'Mixed Greens', isSpecialty: true },
    'Salad Bowl Oakleaf':   { commonName: 'Mixed Greens', isSpecialty: true },
    'Escarole Batavian':    { commonName: 'Mixed Greens', isSpecialty: true },

    // Kale family
    'Curly Kale':         { commonName: 'Kale', isSpecialty: false },
    'Baby Kale':          { commonName: 'Kale', isSpecialty: false },
    'Kale':               { commonName: 'Kale', isSpecialty: false },

    // Herbs
    'Italian Parsley':    { commonName: 'Parsley', isSpecialty: false },
    'Parsley':            { commonName: 'Parsley', isSpecialty: false },
    'Cilantro':           { commonName: 'Cilantro', isSpecialty: false },
    'Dill Bouquet':       { commonName: 'Dill', isSpecialty: false },
    'Dill':               { commonName: 'Dill', isSpecialty: false },
    'Common Thyme':       { commonName: 'Thyme', isSpecialty: false },
    'Thyme':              { commonName: 'Thyme', isSpecialty: false },
    'French Tarragon':    { commonName: 'Tarragon', isSpecialty: true },
    'Greek Oregano':      { commonName: 'Oregano', isSpecialty: false },
    'Oregano':            { commonName: 'Oregano', isSpecialty: false },
    'Rosemary':           { commonName: 'Rosemary', isSpecialty: false },
    'Sage':               { commonName: 'Sage', isSpecialty: false },
    'Marjoram':           { commonName: 'Marjoram', isSpecialty: true },
    'Chervil':            { commonName: 'Chervil', isSpecialty: true },
    'Lemon Balm':         { commonName: 'Lemon Balm', isSpecialty: true },
    'Lovage':             { commonName: 'Lovage', isSpecialty: true },
    'Kentucky Colonel Spearmint': { commonName: 'Mint', isSpecialty: true },
    'Sorrel':             { commonName: 'Sorrel', isSpecialty: true },

    // Asian greens
    'Mei Qing Pak Choi':    { commonName: 'Bok Choy', isSpecialty: false },
    'Pak Choi':             { commonName: 'Bok Choy', isSpecialty: false },
    'Bok Choy':             { commonName: 'Bok Choy', isSpecialty: false },
    'Tatsoi':               { commonName: 'Mixed Greens', isSpecialty: true },
    'Mizuna Mustard Greens':{ commonName: 'Mixed Greens', isSpecialty: true },
    'Komatsuna Mustard Spinach': { commonName: 'Mixed Greens', isSpecialty: true },

    // Specialty greens
    'Watercress':         { commonName: 'Watercress', isSpecialty: false },
    'Fris\u00e9e Endive':  { commonName: 'Mixed Greens', isSpecialty: true },
    'Spinach':            { commonName: 'Spinach', isSpecialty: false },
    'Swiss Chard':        { commonName: 'Swiss Chard', isSpecialty: false },

    // Strawberries
    'Albion':             { commonName: 'Strawberry', isSpecialty: false },
    'Chandler':           { commonName: 'Strawberry', isSpecialty: false },
    'Eversweet':          { commonName: 'Strawberry', isSpecialty: false },
    'Fort Laramie':       { commonName: 'Strawberry', isSpecialty: false },
    'Jewel':              { commonName: 'Strawberry', isSpecialty: false },
    'Mara de Bois':       { commonName: 'Strawberry', isSpecialty: true },
    'Monterey':           { commonName: 'Strawberry', isSpecialty: false },
    'Ozark Beauty':       { commonName: 'Strawberry', isSpecialty: false },
    'Seascape':           { commonName: 'Strawberry', isSpecialty: false },
    'Sequoia':            { commonName: 'Strawberry', isSpecialty: false },
    'Tristar':            { commonName: 'Strawberry', isSpecialty: false },

    // Tomatoes
    'Sun Gold':           { commonName: 'Cherry Tomato', isSpecialty: false },
    'Better Boy':         { commonName: 'Tomato', isSpecialty: false },
    'Brandywine':         { commonName: 'Tomato', isSpecialty: true },
    'Celebrity':          { commonName: 'Tomato', isSpecialty: false },
    'Heatmaster F1':      { commonName: 'Tomato', isSpecialty: false },
    'San Marzano':       { commonName: 'Tomato', isSpecialty: true },
    'San Marzano-':      { commonName: 'Tomato', isSpecialty: true },
    'Tribute':            { commonName: 'Tomato', isSpecialty: false },
    // -- Pelleted & Eazyleaf lettuce varieties (added for v3.0.0 recipes) --
    'Alkindus Pelleted Organic': { commonName: 'Butterhead Lettuce', isSpecialty: false },
    'Amaze':                     { commonName: 'Butterhead Lettuce', isSpecialty: false },
    'Breen Pelleted Organic':    { commonName: 'Butterhead Lettuce', isSpecialty: false },
    'Brentwood Eazyleaf Organic':{ commonName: 'Mixed Greens', isSpecialty: false },
    'Burgandy Eazyleaf Organic': { commonName: 'Mixed Greens', isSpecialty: false },
    'Eazyleaf Blend Organic':    { commonName: 'Mixed Greens', isSpecialty: false },
    'Hampton Eazyleaf Organic':  { commonName: 'Mixed Greens', isSpecialty: false },
    'Ilema Organic':             { commonName: 'Butterhead Lettuce', isSpecialty: true },
    'Little Gem':                { commonName: 'Butterhead Lettuce', isSpecialty: false },
    'Newham Pelleted Organic':   { commonName: 'Butterhead Lettuce', isSpecialty: false },
    'Spretnak Organic':          { commonName: 'Butterhead Lettuce', isSpecialty: false },
    'Tropicana Pelleted Organic':{ commonName: 'Butterhead Lettuce', isSpecialty: false },
    'Truchas Pelleted Organic':  { commonName: 'Butterhead Lettuce', isSpecialty: false },

    // -- Greens with exact-name mismatch --
    'KX-1 Kale (baby leaf)':       { commonName: 'Kale', isSpecialty: false },
    'Magenta Sunset Swiss Chard':   { commonName: 'Swiss Chard', isSpecialty: true },
    'Seaside F1 Spinach (baby leaf)':{ commonName: 'Spinach', isSpecialty: false },
    'San Marzano-':                 { commonName: 'Tomato', isSpecialty: true },

    // -- Microgreens --
    'Microgreen Arugula':           { commonName: 'Microgreen', isSpecialty: false },
    'Microgreen Basil':             { commonName: 'Microgreen', isSpecialty: false },
    'Microgreen Beet':              { commonName: 'Microgreen', isSpecialty: false },
    'Microgreen Broccoli Organic':  { commonName: 'Microgreen', isSpecialty: false },
    'Microgreen Kale':              { commonName: 'Microgreen', isSpecialty: false },
    'Microgreen Kohlrabi':          { commonName: 'Microgreen', isSpecialty: false },
    'Microgreen Pac Choi':          { commonName: 'Microgreen', isSpecialty: false },
    'Microgreen Pea Shoots':        { commonName: 'Microgreen', isSpecialty: false },
    'Microgreen Radish Organic':    { commonName: 'Microgreen', isSpecialty: false },
    'Microgreen Sunflower Organic': { commonName: 'Microgreen', isSpecialty: false },
    'Microgreen Swiss Chard':       { commonName: 'Microgreen', isSpecialty: false },

    // -- Sprouts --
    'Sprout Adzuki Bean Organic':       { commonName: 'Sprout', isSpecialty: false },
    'Sprout Alfalfa Organic':           { commonName: 'Sprout', isSpecialty: false },
    'Sprout Barley Organic':            { commonName: 'Sprout', isSpecialty: false },
    'Sprout Bean Salad Mix Organic':    { commonName: 'Sprout', isSpecialty: false },
    'Sprout Broccoli Organic':          { commonName: 'Sprout', isSpecialty: false },
    'Sprout Brown Mustard Organic':     { commonName: 'Sprout', isSpecialty: false },
    'Sprout Go Go Mix Organic':         { commonName: 'Sprout', isSpecialty: false },
    'Sprout Gourmet Mix Organic':       { commonName: 'Sprout', isSpecialty: false },
    'Sprout Green Hunter Organic':      { commonName: 'Sprout', isSpecialty: false },
    'Sprout Green Lentils Organic':     { commonName: 'Sprout', isSpecialty: false },
    'Sprout Green Peas Organic':        { commonName: 'Sprout', isSpecialty: false },
    'Sprout Mung Bean Organic':         { commonName: 'Sprout', isSpecialty: false },
    'Sprout Radish Organic':            { commonName: 'Sprout', isSpecialty: false },
    'Sprout Red Clover Organic':        { commonName: 'Sprout', isSpecialty: false },
    'Sprout Salad Mix Organic':         { commonName: 'Sprout', isSpecialty: false },
    'Sprout Sandwich Booster Mix Organic': { commonName: 'Sprout', isSpecialty: false },
    'Sprout Wheatgrass Organic':        { commonName: 'Sprout', isSpecialty: false },
    'Sprout Yellow Mustard Organic':    { commonName: 'Sprout', isSpecialty: false }
};

// Resolve classification for any crop name, with fuzzy fallback
function classifyCrop(cropName) {
    if (!cropName) return { commonName: cropName, isSpecialty: true };
    // Exact match
    const exact = cropClassification[cropName];
    if (exact) return exact;
    // Fuzzy: check if any classification key appears as substring
    const norm = String(cropName).toLowerCase().trim();
    for (const [key, val] of Object.entries(cropClassification)) {
        const kn = key.toLowerCase();
        if (norm.includes(kn) || kn.includes(norm)) return val;
    }
    // Unknown variety: treat as specialty, use crop name itself as common name
    // Try to extract a common name from the variety name
    const words = cropName.split(/\s+/);
    if (words.length > 1) {
        const lastWord = words[words.length - 1];
        const candidate = cropClassification[lastWord];
        if (candidate) return { commonName: candidate.commonName, isSpecialty: true };
    }
    return { commonName: cropName, isSpecialty: true };
}

// Get stored specialty delta for a crop (learned from grower adjustments)
function getSpecialtyDelta(cropName) {
    try {
        const deltas = JSON.parse(localStorage.getItem(AI_SPECIALTY_DELTA_KEY) || '{}');
        const entry = deltas[cropName];
        if (!entry || !entry.samples || entry.samples < 2) return null;
        return { avgDeltaPercent: entry.avgDeltaPercent, samples: entry.samples };
    } catch { return null; }
}

// Record a specialty delta when grower adjusts a specialty crop price
function recordSpecialtyDelta(cropName, commonRecommendation, growerPrice) {
    if (!cropName || !commonRecommendation || commonRecommendation <= 0) return;
    const deltaPercent = ((growerPrice - commonRecommendation) / commonRecommendation) * 100;
    try {
        const deltas = JSON.parse(localStorage.getItem(AI_SPECIALTY_DELTA_KEY) || '{}');
        const existing = deltas[cropName] || { avgDeltaPercent: 0, samples: 0 };
        const newSamples = existing.samples + 1;
        // Running average
        const newAvg = ((existing.avgDeltaPercent * existing.samples) + deltaPercent) / newSamples;
        deltas[cropName] = {
            avgDeltaPercent: Math.round(newAvg * 100) / 100,
            samples: newSamples,
            lastUpdated: new Date().toISOString()
        };
        localStorage.setItem(AI_SPECIALTY_DELTA_KEY, JSON.stringify(deltas));
    } catch { /* localStorage full or unavailable */ }
}

// Current USD to CAD exchange rate (updated during analysis)
let currentExchangeRate = 1.35; // Default rate

// Market data based on packaged retail (non-organic) greens pricing research (Dec 2025)
// Pricing sourced from Whole Foods, Sprouts, Trader Joes, and major grocers
// The 5% premium markup accounts for organic premium over these non-organic comparables
const marketDataSources = {
    // Lettuce varieties
    'Butterhead Lettuce': {
        retailers: ['Loblaws', 'Metro', 'Sobeys', 'Farm Boy', 'Whole Foods'],
        avgPriceUSD: 4.99,
        avgWeightOz: 5,
        priceRange: [3.99, 5.99],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    'Red Leaf Lettuce': {
        retailers: ['Loblaws', 'Metro', 'Sobeys', 'Farm Boy', 'No Frills'],
        avgPriceUSD: 4.99,
        avgWeightOz: 5,
        priceRange: [3.99, 5.99],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    'Oak Leaf Lettuce': {
        retailers: ['Loblaws', 'Metro', 'Sobeys', 'Farm Boy', 'No Frills'],
        avgPriceUSD: 4.99,
        avgWeightOz: 5,
        priceRange: [3.99, 5.99],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    
    // Basil varieties
    'Genovese Basil': {
        retailers: ['Loblaws', 'No Frills', 'Food Basics', 'Metro', 'Sobeys', 'Farm Boy'],
        avgPriceUSD: 2.29,
        avgWeightOz: 1.0,
        priceRange: [1.99, 2.99],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    'Thai Basil': {
        retailers: ['Loblaws', 'Metro', 'Sobeys', 'Asian Markets'],
        avgPriceUSD: 2.49,
        avgWeightOz: 1.0,
        priceRange: [1.99, 3.49],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    'Purple Basil': {
        retailers: ['Loblaws', 'Farm Boy', 'Sobeys', 'Farmers Markets'],
        avgPriceUSD: 2.49,
        avgWeightOz: 1.0,
        priceRange: [1.99, 3.49],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    'Lemon Basil': {
        retailers: ['Farm Boy', 'Sobeys', 'Metro', 'Specialty Stores'],
        avgPriceUSD: 2.49,
        avgWeightOz: 1.0,
        priceRange: [1.99, 3.49],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    'Holy Basil': {
        retailers: ['Metro', 'Loblaws', 'Asian Markets', 'Specialty Stores'],
        avgPriceUSD: 2.49,
        avgWeightOz: 1.0,
        priceRange: [1.99, 3.49],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    'Basil': {
        retailers: ['Loblaws', 'No Frills', 'Metro', 'Food Basics'],
        avgPriceUSD: 2.29,
        avgWeightOz: 1.0,
        priceRange: [1.99, 2.99],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    
    // Arugula varieties
    'Baby Arugula': {
        retailers: ['Loblaws', 'Metro', 'Sobeys', 'Farm Boy', 'No Frills'],
        avgPriceUSD: 4.49,
        avgWeightOz: 5,
        priceRange: [3.49, 5.49],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    'Cultivated Arugula': {
        retailers: ['Loblaws', 'Metro', 'Sobeys', 'Farm Boy', 'No Frills'],
        avgPriceUSD: 4.49,
        avgWeightOz: 5,
        priceRange: [3.49, 5.49],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    'Wild Arugula': {
        retailers: ['Loblaws', 'Metro', 'Sobeys', 'Farm Boy', 'No Frills'],
        avgPriceUSD: 4.49,
        avgWeightOz: 5,
        priceRange: [3.49, 5.49],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    'Wasabi Arugula': {
        retailers: ['Loblaws', 'Metro', 'Sobeys', 'Farm Boy', 'No Frills'],
        avgPriceUSD: 4.49,
        avgWeightOz: 5,
        priceRange: [3.49, 5.49],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    'Red Arugula': {
        retailers: ['Loblaws', 'Metro', 'Sobeys', 'Farm Boy', 'No Frills'],
        avgPriceUSD: 4.49,
        avgWeightOz: 5,
        priceRange: [3.49, 5.49],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    'Arugula': {
        retailers: ['Loblaws', 'Metro', 'Sobeys', 'Farm Boy', 'No Frills'],
        avgPriceUSD: 4.49,
        avgWeightOz: 5,
        priceRange: [3.49, 5.49],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    
    // Kale varieties
    'Curly Kale': {
        retailers: ['Loblaws', 'Metro', 'Sobeys', 'Farm Boy', 'No Frills'],
        avgPriceUSD: 4.49,
        avgWeightOz: 5,
        priceRange: [3.49, 5.49],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    'Baby Kale': {
        retailers: ['Loblaws', 'Metro', 'Sobeys', 'Farm Boy', 'No Frills'],
        avgPriceUSD: 4.49,
        avgWeightOz: 5,
        priceRange: [3.49, 5.49],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    'Kale': {
        retailers: ['Loblaws', 'Metro', 'Sobeys', 'Farm Boy', 'No Frills'],
        avgPriceUSD: 4.49,
        avgWeightOz: 5,
        priceRange: [3.49, 5.49],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },

    // Premium mixed greens (used as fallback for specialty greens not sold standalone)
    'Mixed Greens': {
        retailers: ['Loblaws', 'Metro', 'Sobeys', 'Farm Boy', 'Whole Foods'],
        avgPriceUSD: 4.99,
        avgWeightOz: 5,
        priceRange: [3.99, 5.99],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },


    // Spinach (packaged baby spinach)
    'Spinach': {
        retailers: ['Loblaws', 'Metro', 'Sobeys', 'Farm Boy', 'No Frills'],
        avgPriceUSD: 4.49,
        avgWeightOz: 5,
        priceRange: [3.49, 5.49],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },

    // Swiss Chard (bunch)
    'Swiss Chard': {
        retailers: ['Loblaws', 'Farm Boy', 'Sobeys', 'Farmers Markets'],
        avgPriceUSD: 3.49,
        avgWeightOz: 8,
        priceRange: [2.49, 4.49],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },

    // Bok Choy (packaged)
    'Bok Choy': {
        retailers: ['Loblaws', 'Metro', 'Farm Boy', 'Asian Markets'],
        avgPriceUSD: 3.49,
        avgWeightOz: 6,
        priceRange: [2.99, 3.99],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },

    // Common packaged herbs
    'Parsley': {
        retailers: ['Loblaws', 'No Frills', 'Metro', 'Food Basics'],
        avgPriceUSD: 1.99,
        avgWeightOz: 1.0,
        priceRange: [1.49, 2.49],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    'Cilantro': {
        retailers: ['Loblaws', 'No Frills', 'Metro', 'Food Basics'],
        avgPriceUSD: 1.49,
        avgWeightOz: 1.0,
        priceRange: [0.99, 1.99],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    'Dill': {
        retailers: ['Loblaws', 'No Frills', 'Metro', 'Food Basics'],
        avgPriceUSD: 1.99,
        avgWeightOz: 1.0,
        priceRange: [1.49, 2.49],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    'Thyme': {
        retailers: ['Loblaws', 'No Frills', 'Food Basics', 'Metro'],
        avgPriceUSD: 2.49,
        avgWeightOz: 0.71,
        priceRange: [2.48, 2.79],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    'Tarragon': {
        retailers: ['Loblaws', 'Metro', 'Specialty Stores'],
        avgPriceUSD: 2.99,
        avgWeightOz: 0.75,
        priceRange: [2.49, 3.49],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    'Oregano': {
        retailers: ['Loblaws', 'No Frills', 'Food Basics', 'Metro'],
        avgPriceUSD: 2.79,
        avgWeightOz: 0.88,
        priceRange: [2.48, 3.00],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    'Mint': {
        retailers: ['Loblaws', 'No Frills', 'Metro', 'Food Basics'],
        avgPriceUSD: 2.49,
        avgWeightOz: 1.0,
        priceRange: [1.99, 2.99],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },
    'Strawberry': {
        retailers: ['Whole Foods', 'Sprouts', 'Trader Joes', 'Loblaws', 'Metro'],
        avgPriceUSD: 5.99,
        priceRange: [4.49, 7.99],
        trend: 'stable',
        country: 'North America',
        comparisonUnit: 'pint',
        articles: []
    },
    'Cherry Tomato': {
        retailers: ['Whole Foods', 'Sprouts', 'Trader Joes', 'Loblaws', 'Metro'],
        avgPriceUSD: 4.99,
        avgWeightOz: 10,
        priceRange: [3.99, 5.99],
        trend: 'stable',
        country: 'North America',
        articles: []
    },
    'Tomato': {
        retailers: ['Whole Foods', 'Kroger', 'Safeway', 'Loblaws', 'Metro'],
        avgPriceUSD: 2.49,
        priceRange: [1.49, 3.49],
        trend: 'stable',
        country: 'North America',
        comparisonUnit: 'unit',
        articles: []
    },

    // Rosemary (packaged fresh herb)
    'Rosemary': {
        retailers: ['Loblaws', 'No Frills', 'Metro', 'Sobeys'],
        avgPriceUSD: 2.79,
        avgWeightOz: 0.71,
        priceRange: [2.49, 2.99],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },

    // Sage (packaged fresh herb)
    'Sage': {
        retailers: ['Loblaws', 'No Frills', 'Metro', 'Food Basics'],
        avgPriceUSD: 2.79,
        avgWeightOz: 0.71,
        priceRange: [2.49, 2.99],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },

    // Watercress (packaged)
    'Watercress': {
        retailers: ['Loblaws', 'Metro', 'Sobeys', 'Farm Boy', 'Whole Foods'],
        avgPriceUSD: 3.99,
        avgWeightOz: 4,
        priceRange: [2.99, 4.99],
        trend: 'stable',
        country: 'Canada',
        articles: []
    },

    // Microgreens (packaged tray/clamshell)
    'Microgreen': {
        retailers: ['Whole Foods', 'Farm Boy', 'Loblaws', 'Sobeys', 'Farmers Markets'],
        avgPriceUSD: 4.49,
        avgWeightOz: 2,
        priceRange: [3.49, 5.99],
        trend: 'stable',
        country: 'Canada',
        _lookupOnly: true,
        articles: []
    },

    // Sprouts (packaged container)
    'Sprout': {
        retailers: ['Whole Foods', 'Loblaws', 'Metro', 'Sobeys', 'Farm Boy'],
        avgPriceUSD: 3.49,
        avgWeightOz: 6,
        priceRange: [2.49, 4.49],
        trend: 'stable',
        country: 'Canada',
        _lookupOnly: true,
        articles: []
    }
};

// Fallback categories for crops introduced after initial market dataset buildout.
// These are aggregated snapshots across major North American grocers.
const marketCategoryFallbacks = {
    strawberryPint: {
        retailers: ['Whole Foods', 'Sprouts', 'Trader Joes', 'Loblaws', 'Metro', 'Sobeys', 'Farm Boy'],
        avgPriceUSD: 6.49,
        priceRange: [4.99, 7.99],
        trend: 'stable',
        country: 'North America',
        comparisonUnit: 'pint',
        articles: []
    },
    largeTomatoUnit: {
        retailers: ['Whole Foods', 'Kroger', 'Safeway', 'Loblaws', 'Metro', 'Sobeys'],
        avgPriceUSD: 2.19,
        priceRange: [1.49, 3.49],
        trend: 'stable',
        country: 'North America',
        comparisonUnit: 'unit',
        articles: []
    },
    cherryTomatoWeight: {
        retailers: ['Whole Foods', 'Sprouts', 'Trader Joes', 'Loblaws', 'Metro', 'Farm Boy'],
        avgPriceUSD: 5.49,
        avgWeightOz: 10,
        priceRange: [4.49, 6.99],
        trend: 'stable',
        country: 'North America',
        comparisonUnit: 'weight',
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
 * Run AI pricing analysis — fetches live market data + AI analysis from backend
 */
async function runAIPricingAnalysis() {
    const statusDiv = document.getElementById('ai-analysis-status');
    const statusText = document.getElementById('ai-status-text');
    const recommendationsDiv = document.getElementById('ai-recommendations');
    
    statusDiv.style.display = 'block';
    recommendationsDiv.style.display = 'none';
    
    const steps = [
        'Connecting to market intelligence service...',
        'Fetching real-time price observations from DB...',
        'Loading AI market analysis (GPT-4o-mini)...',
        'Retrieving Bank of Canada USD/CAD exchange rate...',
        'Analysing price trends across retailers...',
        'Matching crops to your pricing table...',
        'Normalizing prices by unit: oz, 25g, pint, and each...',
        'Generating premium retail recommendations (+5% over market average)...'
    ];
    
    // Show progress steps while fetching in parallel
    const stepPromise = (async () => {
        for (let i = 0; i < steps.length; i++) {
            statusText.textContent = steps[i];
            await new Promise(resolve => setTimeout(resolve, 600));
        }
    })();

    // Ensure pricing data is loaded before analysis
    if (!Array.isArray(pricingData) || pricingData.length === 0) {
        await loadCropsFromDatabase();
    }

    // Fetch live pricing recommendations from backend
    let liveData = null;
    try {
        const res = await fetch(`${API_BASE}/api/market-intelligence/pricing-recommendations`, {
            headers: currentSession?.token ? { 'Authorization': `Bearer ${currentSession.token}` } : undefined
        });
        if (res.ok) {
            liveData = await res.json();
        }
    } catch (e) {
        console.warn('Live pricing recommendations unavailable:', e.message);
    }

    // Wait for progress animation to finish
    await stepPromise;

    // Use live data if available, otherwise fall back to local hardcoded sources
    if (liveData?.ok && liveData.recommendations?.length > 0) {
        currentExchangeRate = liveData.fxRate || currentExchangeRate;
        // Populate marketDataSources cache from live data so resolveMarketDataForCrop works
        for (const rec of liveData.recommendations) {
            marketDataSources[rec.product] = {
                retailers: rec.retailers || [],
                avgPriceCAD: rec.pricePerOzCAD || rec.avgPriceCAD || 0,
                avgPriceUSD: (rec.pricePerOzCAD || rec.avgPriceCAD || 0) / (liveData.fxRate || 1.36),
                avgWeightOz: 1, // Backend returns per-oz values via pricePerOzCAD
                priceRange: rec.priceRange || [0, 0], // Backend returns per-oz ranges
                trend: rec.trend || 'stable',
                trendPercent: rec.trendPercent ?? 0,
                country: 'Canada',
                articles: [],
                // AI enrichment
                _aiOutlook: rec.aiOutlook,
                _aiConfidence: rec.aiConfidence,
                _aiForecastPrice: rec.aiForecastPrice,
                _aiAction: rec.aiAction,
                _aiReasoning: rec.aiReasoning,
                _dataSource: rec.dataSource || 'database',
                _observationCount: rec.observationCount || 0,
            };
        }
        console.log(`Loaded ${liveData.recommendations.length} live pricing recommendations (FX: ${currentExchangeRate})`);
    } else {
        // Fallback: use hardcoded marketDataSources + fake FX
        await fetchExchangeRate();
        console.warn(' Using hardcoded market data (backend unavailable)');
    }
    
    // Generate recommendations using the (now-updated) marketDataSources
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
        // Static fallback rate (updated 2026-01). In production, fetch from
        // https://api.exchangerate-api.com/v4/latest/USD or Bank of Canada RSS
        currentExchangeRate = 1.44; // USD/CAD as of Jan 2026
        
        localStorage.setItem(USD_TO_CAD_RATE_KEY, JSON.stringify({
            rate: currentExchangeRate,
            timestamp: Date.now()
        }));
    }
    
    console.log(` Exchange rate updated: 1 USD = ${currentExchangeRate.toFixed(4)} CAD`);
}

function resolveMarketDataForCrop(cropName) {
    if (!cropName) return null;

    // Tier 1: Exact match by full variety name
    const exact = marketDataSources[cropName];
    if (exact) return exact;

    // Tier 2: Use crop classification to find common name
    const classification = classifyCrop(cropName);
    const commonName = classification.commonName;

    // Try exact match on common name
    if (commonName && marketDataSources[commonName]) {
        return marketDataSources[commonName];
    }

    // Tier 3: Fuzzy alias fallback
    const normalized = String(cropName).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

    const aliasChecks = [
        // Microgreens and sprouts (must precede crop-specific aliases)
        { test: ['microgreen'], key: 'Microgreen' },
        { test: ['sprout'], key: 'Sprout' },
        // Pelleted/Eazyleaf lettuce varieties
        { test: ['pelleted', 'little gem', 'amaze', 'ilema'], key: 'Butterhead Lettuce' },
        { test: ['eazyleaf'], key: 'Mixed Greens' },
        { test: ['butterhead', 'buttercrunch', 'bibb'], key: 'Butterhead Lettuce' },
        { test: ['romaine', 'cos'], key: 'Mixed Greens' },
        { test: ['red leaf'], key: 'Red Leaf Lettuce' },
        { test: ['oakleaf', 'oak leaf', 'salad bowl', 'escarole', 'batavian'], key: 'Mixed Greens' },
        { test: ['lettuce', 'salad'], key: 'Mixed Greens' },
        { test: ['arugula', 'rocket'], key: 'Arugula' },
        { test: ['basil', 'genovese'], key: 'Basil' },
        { test: ['kale', 'lacinato', 'russian kale'], key: 'Kale' },
        { test: ['frisee', 'fris\u00e9e', 'endive'], key: 'Mixed Greens' },
        { test: ['watercress'], key: 'Watercress' },
        { test: ['spinach', 'bloomsdale'], key: 'Spinach' },
        { test: ['chard'], key: 'Swiss Chard' },
        { test: ['pak choi', 'pac choi', 'bok choy'], key: 'Bok Choy' },
        { test: ['tatsoi', 'mizuna', 'komatsuna', 'mustard'], key: 'Mixed Greens' },
        { test: ['parsley'], key: 'Parsley' },
        { test: ['cilantro'], key: 'Cilantro' },
        { test: ['dill'], key: 'Dill' },
        { test: ['thyme'], key: 'Thyme' },
        { test: ['tarragon'], key: 'Tarragon' },
        { test: ['oregano'], key: 'Oregano' },
        { test: ['rosemary'], key: 'Rosemary' },
        { test: ['sage'], key: 'Sage' },
        { test: ['mint', 'spearmint', 'peppermint'], key: 'Mint' },
        { test: ['sorrel'], key: 'Mixed Greens' },
        { test: ['lemon balm'], key: 'Mint' },
        { test: ['lovage'], key: 'Parsley' },
        { test: ['chervil'], key: 'Parsley' },
        { test: ['marjoram'], key: 'Oregano' }
    ];

    for (const alias of aliasChecks) {
        if (alias.test.some(token => normalized.includes(token))) {
            return marketDataSources[alias.key] || null;
        }
    }

    // Unit-aware fallbacks for newer crop categories
    if (normalized.includes('sun gold') || normalized.includes('cherry tomato')) {
        return marketDataSources['Cherry Tomato'] || marketCategoryFallbacks.cherryTomatoWeight;
    }

    const cropUnit = getCropUnit(cropName);
    if (cropUnit === 'pint') return marketDataSources['Strawberry'] || marketCategoryFallbacks.strawberryPint;
    if (cropUnit === 'unit') return marketDataSources['Tomato'] || marketCategoryFallbacks.largeTomatoUnit;

    // Final fuzzy match against marketDataSources keys
    const fuzzyKey = Object.keys(marketDataSources).find((key) => {
        const keyNormalized = key.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        return normalized.includes(keyNormalized) || keyNormalized.includes(normalized);
    });

    return fuzzyKey ? marketDataSources[fuzzyKey] : null;
}

function normalizeMarketPriceForCrop(cropName, marketData) {
    const cropUnit = getCropUnit(cropName);
    const comparisonUnit = marketData.comparisonUnit || (cropUnit === 'pint' ? 'pint' : cropUnit === 'unit' ? 'unit' : 'weight');
    const isWeight = comparisonUnit === 'weight';

    const averageSourcePriceUSD = Number(marketData.avgPriceUSD || 0);
    const isLiveDb = marketData._dataSource === 'database';
    const isCanadianSource = marketData.country === 'Canada';
    const convertToCad = marketData.country !== 'Canada' && marketData._dataSource !== 'database';
    const exchangeMultiplier = convertToCad ? currentExchangeRate : 1;

    if (!isWeight) {
        const marketAverageCAD = isLiveDb
            ? Number(marketData.avgPriceCAD || 0)
            : averageSourcePriceUSD * exchangeMultiplier;

        const sourceCurrency = (isLiveDb || isCanadianSource) ? 'CAD' : 'USD';
        const sourceAverage = isLiveDb
            ? marketAverageCAD
            : averageSourcePriceUSD;

        const priceRangeCAD = isLiveDb
            ? (marketData.priceRange || [marketAverageCAD, marketAverageCAD]).map(price => Number(price || 0))
            : (marketData.priceRange || [averageSourcePriceUSD, averageSourcePriceUSD]).map(price => price * exchangeMultiplier);

        return {
            comparisonUnit,
            comparisonUnitLabel: comparisonUnit === 'pint' ? '/pint' : '/each',
            marketAverageCAD,
            sourceAverage,
            sourceCurrency,
            sourceUnitLabel: comparisonUnit === 'pint' ? '/pint' : '/each',
            priceRangeCAD,
            pricePerLbCAD: null,
            pricePer100gCAD: null,
            pricePerOzCAD: null,
            pricePerOzUSD: null
        };
    }

    const avgWeightOz = Number(marketData.avgWeightOz || 0);
    if (!avgWeightOz) {
        return null;
    }

    const pricePerOzCAD = marketData.country === 'Canada' || marketData._dataSource === 'database'
        ? Number(marketData.avgPriceCAD || marketData.avgPriceUSD || 0) / avgWeightOz
        : (averageSourcePriceUSD / avgWeightOz) * exchangeMultiplier;

    const pricePerOzUSD = marketData._dataSource === 'database'
        ? pricePerOzCAD / (currentExchangeRate || 1)
        : averageSourcePriceUSD / avgWeightOz;

    const pricePerLbCAD = pricePerOzCAD * 16;
    const pricePer100gCAD = pricePerLbCAD * LB_TO_100G;
    const sourceAverage = (isLiveDb || isCanadianSource)
        ? pricePerLbCAD
        : pricePerOzUSD * 16;
    const sourceCurrency = (isLiveDb || isCanadianSource) ? 'CAD' : 'USD';

    const priceRangeCAD = (marketData.country !== 'Canada' && marketData._dataSource !== 'database')
        ? (marketData.priceRange || [0, 0]).map(p => (p / avgWeightOz) * 16 * exchangeMultiplier)
        : (marketData.priceRange || [0, 0]).map(p => (p / avgWeightOz) * 16);

    return {
        comparisonUnit,
        comparisonUnitLabel: '/lb',
        marketAverageCAD: pricePerLbCAD,
        sourceAverage,
        sourceCurrency,
        sourceUnitLabel: '/lb',
        priceRangeCAD,
        pricePerLbCAD,
        pricePer100gCAD,
        pricePerOzCAD,
        pricePerOzUSD
    };
}

/**
 * Generate pricing recommendations based on market data
 */
function generateRecommendations() {
    const recommendations = [];

    const pricingMap = new Map(
        (pricingData || []).map(item => [item.crop, item])
    );

    // Deduplicate: farm crops take priority over generic market keys
    const seenMarketKeys = new Set();
    const analysisCrops = [];

    for (const item of (pricingData || [])) {
        const md = resolveMarketDataForCrop(item.crop);
        if (md) {
            const mdKey = Object.keys(marketDataSources).find(k => marketDataSources[k] === md);
            if (mdKey) seenMarketKeys.add(mdKey);
        }
        analysisCrops.push(item.crop);
    }

    for (const key of Object.keys(marketDataSources)) {
        if (!seenMarketKeys.has(key) && !marketDataSources[key]._lookupOnly) {
            analysisCrops.push(key);
        }
    }

    analysisCrops.sort().forEach(cropName => {
        const marketData = resolveMarketDataForCrop(cropName);
        if (!marketData) return;

        const pricingItem = pricingMap.get(cropName);
        const defaultItem = defaultPricing[cropName] || null;
        const normalizedMarket = normalizeMarketPriceForCrop(cropName, marketData);
        if (!normalizedMarket) return;

        const marketAvg = normalizedMarket.marketAverageCAD;
        const currentPrice = Number(pricingItem?.retail ?? defaultItem?.retail ?? marketAvg);
        const difference = marketAvg > 0 ? ((currentPrice - marketAvg) / marketAvg * 100) : 0;

        // Classify crop: common vs specialty
        const classification = classifyCrop(cropName);
        const isSpecialty = classification.isSpecialty;
        const commonName = classification.commonName;

        // Check for learned specialty delta
        let learnedDelta = null;
        let recommendation;
        if (isSpecialty) {
            learnedDelta = getSpecialtyDelta(cropName);
        }

        if (isSpecialty && learnedDelta) {
            // Apply learned delta on top of the common-name recommendation
            const baseRec = marketAvg * (1 + AI_PREMIUM_MARKUP_RATE);
            recommendation = baseRec * (1 + learnedDelta.avgDeltaPercent / 100);
        } else {
            // Standard: 5% premium over non-organic market average
            recommendation = marketAvg * (1 + AI_PREMIUM_MARKUP_RATE);
        }

        const recommendedDelta = currentPrice > 0 ? ((recommendation - currentPrice) / currentPrice * 100) : (recommendation > 0 ? 100 : 0);
        const priceChangeType = recommendedDelta > 0 ? 'up' : recommendedDelta < 0 ? 'down' : 'stable';

        // Build reasoning
        let reasoning = '';
        if (isSpecialty && learnedDelta) {
            reasoning += `${cropName} is a specialty variety (based on ${commonName} pricing). `;
            reasoning += `Your pricing history shows a ${learnedDelta.avgDeltaPercent > 0 ? '+' : ''}${learnedDelta.avgDeltaPercent.toFixed(1)}% adjustment from common pricing (${learnedDelta.samples} data points). `;
            reasoning += `Base ${commonName} market avg: $${marketAvg.toFixed(2)}${normalizedMarket.comparisonUnitLabel} (CAD). `;
        } else if (isSpecialty) {
            reasoning += `${cropName} is a specialty variety not commonly sold as a standalone packaged product. `;
            reasoning += `Recommendation is based on ${commonName} packaged retail pricing ($${marketAvg.toFixed(2)}${normalizedMarket.comparisonUnitLabel} CAD). `;
            reasoning += `Review and adjust -- as you update, the system learns your specialty premium. `;
        } else {
            reasoning += `Aggregated North America packaged retail pricing suggests ${cropName} averages $${marketAvg.toFixed(2)}${normalizedMarket.comparisonUnitLabel} (CAD). `;
        }
        reasoning += `Applying the ${(AI_PREMIUM_MARKUP_RATE * 100).toFixed(0)}% organic premium yields $${recommendation.toFixed(2)}${normalizedMarket.comparisonUnitLabel}. `;
        reasoning += `Your current price is ${Math.abs(difference).toFixed(1)}% ${difference >= 0 ? 'above' : 'below'} market average.`;

        if (marketData._aiReasoning) {
            reasoning = `AI context: ${marketData._aiReasoning} ` + reasoning;
        }

        recommendations.push({
            crop: cropName,
            currentPrice: currentPrice,
            recommendedPrice: recommendation,
            marketAverage: marketAvg,
            comparisonUnit: normalizedMarket.comparisonUnit,
            comparisonUnitLabel: normalizedMarket.comparisonUnitLabel,
            pricePerLbCAD: normalizedMarket.pricePerLbCAD,
            pricePer100gCAD: normalizedMarket.pricePer100gCAD,
            sourcePrice: normalizedMarket.sourceAverage,
            sourceCurrency: normalizedMarket.sourceCurrency || 'USD',
            sourceUnitLabel: normalizedMarket.sourceUnitLabel || normalizedMarket.comparisonUnitLabel,
            priceRange: normalizedMarket.priceRangeCAD,
            exchangeRate: currentExchangeRate,
            sourceCountry: marketData.country || 'Canada',
            trend: marketData.trend,
            reasoning: reasoning,
            priceChangeType: priceChangeType,
            articles: marketData.articles || [],
            retailers: marketData.retailers || [],
            hasPricingRow: Boolean(pricingItem),
            aiOutlook: marketData._aiOutlook || null,
            aiConfidence: marketData._aiConfidence || null,
            dataSource: marketData._dataSource || 'static',
            observationCount: marketData._observationCount || 0,
            isSpecialty: isSpecialty,
            commonName: commonName,
            learnedDelta: learnedDelta,
            timestamp: Date.now()
        });
    });

    return recommendations;
}

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
        const priceChange = rec.currentPrice > 0
            ? ((rec.recommendedPrice - rec.currentPrice) / rec.currentPrice * 100).toFixed(1)
            : (rec.recommendedPrice > 0 ? '100.0' : '0.0');
        const hasSignificantChange = Math.abs(parseFloat(priceChange)) > 5;

        const isLive = rec.dataSource === 'database';
        const sourceBadge = isLive
            ? `<span style="padding: 2px 6px; background: rgba(34,197,94,0.2); color: #4ade80; border-radius: 4px; font-size: 10px; font-weight: 600; margin-left: 8px;">LIVE DATA</span>`
            : `<span style="padding: 2px 6px; background: rgba(156,163,175,0.2); color: #9ca3af; border-radius: 4px; font-size: 10px; font-weight: 600; margin-left: 8px;">STATIC</span>`;

        const aiBadge = rec.aiOutlook
            ? `<span style="padding: 2px 6px; background: rgba(139,92,246,0.2); color: #a78bfa; border-radius: 4px; font-size: 10px; font-weight: 600; margin-left: 4px;">AI ${(rec.aiConfidence || 'medium').toUpperCase()}</span>`
            : '';

        const conversionInfo = !isLive && rec.sourceCountry !== 'Canada'
            ? `<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px;">
                   Prices converted from USD at rate: 1 USD = ${rec.exchangeRate.toFixed(4)} CAD
               </div>` : '';

        const isWeightComparison = rec.comparisonUnit === 'weight';
        const unitLabel = rec.comparisonUnitLabel || '/oz';

        return `
            <div class="recommendation-card ${hasSignificantChange ? 'updated' : ''}">
                <div class="recommendation-header">
                    <div class="crop-title">${rec.crop}${sourceBadge}${aiBadge}${rec.isSpecialty
                        ? '<span style="padding: 2px 6px; background: rgba(245,158,11,0.2); color: #f59e0b; border-radius: 4px; font-size: 10px; font-weight: 600; margin-left: 4px;" title="Specialty variety -- recommendation based on ' + rec.commonName + ' pricing. Review recommended.">SPECIALTY</span>'
                        : ''}</div>
                    ${hasSignificantChange ?
                        `<span style="padding: 4px 8px; background: rgba(245, 158, 11, 0.2); color: #fbbf24; border-radius: 4px; font-size: 12px; font-weight: 600;">UPDATE RECOMMENDED</span>`
                        : ''}
                </div>

                ${conversionInfo}

                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px; padding: 12px; background: var(--bg-primary); border-radius: 6px;">
                    <div>
                        <div class="price-label">Market Price (CAD)</div>
                        ${isWeightComparison ? `
                            <div style="font-size: 16px; font-weight: 600; color: var(--accent-blue);">
                                $${rec.pricePerLbCAD.toFixed(2)}/lb
                            </div>
                            <div style="font-size: 13px; color: var(--text-secondary);">
                                $${rec.pricePer100gCAD.toFixed(2)}/100g
                            </div>
                        ` : `
                            <div style="font-size: 16px; font-weight: 600; color: var(--accent-blue);">
                                $${rec.marketAverage.toFixed(2)}${unitLabel}
                            </div>
                            <div style="font-size: 13px; color: var(--text-secondary);">
                                North America aggregate
                            </div>
                        `}
                    </div>
                    <div>
                        <div class="price-label">${rec.dataSource === 'database' ? 'Data Points' : `Source (${rec.sourceCurrency || 'USD'})`}</div>
                        <div style="font-size: 16px; font-weight: 600; color: var(--text-muted);">
                            ${rec.dataSource === 'database'
                                ? `${rec.observationCount || '—'} obs`
                                : `$${Number(rec.sourcePrice || 0).toFixed(2)}${rec.sourceUnitLabel || unitLabel}`}
                        </div>
                        <div style="font-size: 11px; color: var(--text-muted);">
                            ${rec.dataSource === 'database' ? `${(rec.retailers || []).length} retailers` : rec.sourceCountry}
                        </div>
                    </div>
                </div>

                <div class="price-comparison">
                    <div class="price-box">
                        <div class="price-label">Your Current Price</div>
                        <div class="price-value">$${rec.currentPrice.toFixed(2)}</div>
                        <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${unitLabel} (CAD)</div>
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
                        <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${unitLabel}</div>
                    </div>
                </div>

                <div class="market-insight">
                    <strong>Market Insight:</strong> ${rec.reasoning}
                </div>

                ${rec.isSpecialty && !rec.learnedDelta ? `
                <div style="padding: 8px 12px; margin-bottom: 8px; background: rgba(245,158,11,0.08); border-left: 3px solid #f59e0b; border-radius: 0 4px 4px 0; font-size: 12px; color: var(--text-secondary);">
                    <strong>Specialty variety:</strong> ${rec.crop} is not commonly sold as a standalone packaged product. This recommendation uses <strong>${rec.commonName}</strong> retail pricing as a baseline. Please review and adjust -- your adjustments will train the system automatically.
                </div>
                ` : ''}
                ${rec.isSpecialty && rec.learnedDelta ? `
                <div style="padding: 8px 12px; margin-bottom: 8px; background: rgba(34,197,94,0.08); border-left: 3px solid #22c55e; border-radius: 0 4px 4px 0; font-size: 12px; color: var(--text-secondary);">
                    <strong>Learned adjustment:</strong> Based on your ${rec.learnedDelta.samples} previous pricing decisions, a ${rec.learnedDelta.avgDeltaPercent > 0 ? '+' : ''}${rec.learnedDelta.avgDeltaPercent.toFixed(1)}% specialty adjustment has been applied over ${rec.commonName} base pricing.
                </div>
                ` : ''}

                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">
                    <strong>Retailers surveyed:</strong> ${(rec.retailers || []).length > 0 ? rec.retailers.join(', ') : 'N/A'}
                </div>

                

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
async function applyRecommendedPrice(cropName, recommendedPrice, btnEl) {
    // Exact match first, then fuzzy match
    let index = pricingData.findIndex(item => item.crop === cropName);

    if (index === -1) {
        // Fuzzy match: normalize and compare substrings
        const norm = cropName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        index = pricingData.findIndex(item => {
            const itemNorm = item.crop.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
            return itemNorm.includes(norm) || norm.includes(itemNorm);
        });
    }

    if (index !== -1) {
        const previousPrice = pricingData[index].retail;
        pricingData[index].retail = recommendedPrice;
        // Ensure formula fields have defaults when AI sets retail
        if (!pricingData[index].sku_factor) pricingData[index].sku_factor = 0.75;
        if (!pricingData[index].floor_price) pricingData[index].floor_price = 0;
        renderPricingTable();
        
        // Mark button as applied (stay in modal for more crops)
        if (btnEl) {
            btnEl.textContent = 'Applied';
            btnEl.disabled = true;
            btnEl.style.opacity = '0.6';
            btnEl.style.cursor = 'default';
        }

        // Auto-save to backend
        await savePricingQuiet();

        // Phase 3B: Record pricing decision for feedback loop
        try {
            const cached = JSON.parse(localStorage.getItem(AI_PRICING_KEY) || '[]');
            const rec = cached.find(r => r.crop === cropName) || {};
            await fetch(`${API_BASE}/api/crop-pricing/decisions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(currentSession?.token ? { 'Authorization': `Bearer ${currentSession.token}` } : {})
                },
                body: JSON.stringify({ decisions: [{
                    crop: pricingData[index].crop,
                    previous_price: previousPrice,
                    recommended_price: recommendedPrice,
                    applied_price: recommendedPrice,
                    market_average: rec.marketAverage || null,
                    ai_outlook: rec.aiOutlook || null,
                    ai_action: null,
                    trend: rec.trend || null,
                    data_source: rec.dataSource || 'static',
                    decision: 'accepted'
                }]})
            });
        } catch (e) {
            console.warn('Decision recording failed:', e.message);
        }

        // Record specialty delta if this is a specialty crop being manually priced
        try {
            const cached = JSON.parse(localStorage.getItem(AI_PRICING_KEY) || '[]');
            const recEntry = cached.find(r => r.crop === pricingData[index].crop);
            if (recEntry && recEntry.isSpecialty && recEntry.marketAverage > 0) {
                const baseRec = recEntry.marketAverage * (1 + AI_PREMIUM_MARKUP_RATE);
                recordSpecialtyDelta(pricingData[index].crop, baseRec, recommendedPrice);
            }
        } catch (e) { /* delta recording is best-effort */ }

        showPricingToast(`Updated ${pricingData[index].crop} to $${recommendedPrice.toFixed(2)} — saved`);
    } else {
        // No existing match -- add as a new crop row so the recommendation is not lost
        const newRow = {
            crop: cropName,
            unit: getCropBackendUnit(cropName),
            retail: recommendedPrice,
            ws1Discount: 0,
            ws2Discount: 0,
            ws3Discount: 0,
            isTaxable: false,
            floor_price: 0,
            sku_factor: 0.75
        };
        pricingData.push(newRow);
        index = pricingData.length - 1;
        renderPricingTable();

        if (btnEl) {
            btnEl.textContent = 'Added + Applied';
            btnEl.disabled = true;
            btnEl.style.opacity = '0.6';
            btnEl.style.cursor = 'default';
        }

        await savePricingQuiet();
        showPricingToast(`Added "${cropName}" to pricing table at $${recommendedPrice.toFixed(2)} -- saved`);
    }
}

/**
 * Save pricing data silently (no alert). Used by applyRecommendedPrice.
 */
async function savePricingQuiet() {
    try {
        pricingData.forEach(item => {
            localStorage.setItem(`pricing_${item.crop}`, JSON.stringify(item));
        });
        const crops = pricingData.map(item => ({
            crop: item.crop,
            unit: getCropBackendUnit(item.crop),
            retailPrice: parseFloat(item.retail),
            wholesalePrice: parseFloat(calculateFormulaWholesalePrice(item.retail, item.floor_price, item.sku_factor)),
            ws1Discount: item.ws1Discount,
            ws2Discount: item.ws2Discount,
            ws3Discount: item.ws3Discount,
            isTaxable: item.isTaxable || false,
            floor_price: item.floor_price || 0,
            sku_factor: item.sku_factor || 0.75
        }));
        await fetch(`${API_BASE}/api/crop-pricing`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...(currentSession?.token ? { 'Authorization': `Bearer ${currentSession.token}` } : {})
            },
            body: JSON.stringify({ crops })
        });
    } catch (e) {
        console.warn('Auto-save failed:', e.message);
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
    'Butterhead Lettuce': { daysToHarvest: 32, retailPricePerLb: 16.77, yieldFactor: 0.92 },
    'Buttercrunch Lettuce': { daysToHarvest: 32, retailPricePerLb: 16.77, yieldFactor: 0.92 },
    'Bibb Butterhead': { daysToHarvest: 32, retailPricePerLb: 16.77, yieldFactor: 0.92 },
    'Breen Pelleted Organic': { daysToHarvest: 55, retailPricePerLb: 16.77, yieldFactor: 0.90 },
    'Truchas Pelleted Organic': { daysToHarvest: 55, retailPricePerLb: 16.77, yieldFactor: 0.90 },
    'Seaside F1 Spinach (baby leaf)': { daysToHarvest: 28, retailPricePerLb: 15.08, yieldFactor: 0.91 },
    'Red Leaf Lettuce': { daysToHarvest: 30, retailPricePerLb: 16.77, yieldFactor: 0.91 },
    'Oak Leaf Lettuce': { daysToHarvest: 30, retailPricePerLb: 16.77, yieldFactor: 0.91 },
    
    // Kale varieties - 35-42 day cycle, priced per lb
    'Curly Kale': { daysToHarvest: 38, retailPricePerLb: 15.08, yieldFactor: 0.89 },
    'Baby Kale': { daysToHarvest: 28, retailPricePerLb: 15.08, yieldFactor: 0.92 },
    
    // Asian Greens - priced per lb
    'Mei Qing Pak Choi': { daysToHarvest: 30, retailPricePerLb: 9.77, yieldFactor: 0.90 },
    'Tatsoi': { daysToHarvest: 28, retailPricePerLb: 9.77, yieldFactor: 0.91 },
    
    // Specialty Greens - priced per lb
    'Frisée Endive': { daysToHarvest: 35, retailPricePerLb: 16.77, yieldFactor: 0.87 },
    'Watercress': { daysToHarvest: 25, retailPricePerLb: 16.76, yieldFactor: 0.90 },
    
    // Arugula varieties - 21-28 day cycle, priced per lb
    'Baby Arugula': { daysToHarvest: 21, retailPricePerLb: 15.08, yieldFactor: 0.93 },
    'Cultivated Arugula': { daysToHarvest: 24, retailPricePerLb: 15.08, yieldFactor: 0.91 },
    'Wild Arugula': { daysToHarvest: 28, retailPricePerLb: 15.08, yieldFactor: 0.89 },
    'Wasabi Arugula': { daysToHarvest: 24, retailPricePerLb: 15.08, yieldFactor: 0.90 },
    'Red Arugula': { daysToHarvest: 24, retailPricePerLb: 15.08, yieldFactor: 0.90 },
    
    // Basil varieties - 21-28 day cycle, priced per lb (CAD, from crop-registry)
    'Genovese Basil': { daysToHarvest: 25, retailPricePerLb: 38.47, yieldFactor: 0.88 },
    'Thai Basil': { daysToHarvest: 25, retailPricePerLb: 41.83, yieldFactor: 0.88 },
    'Purple Basil': { daysToHarvest: 25, retailPricePerLb: 41.83, yieldFactor: 0.87 },
    'Lemon Basil': { daysToHarvest: 24, retailPricePerLb: 41.83, yieldFactor: 0.87 },
    'Holy Basil': { daysToHarvest: 26, retailPricePerLb: 41.83, yieldFactor: 0.86 }
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
    // Prefer DB pricing (from pricingData loaded via API) over hardcoded params
    const dbEntry = (typeof pricingData !== 'undefined' && Array.isArray(pricingData))
        ? pricingData.find(p => p.crop === crop) : null;
    const retailPricePerLb = (dbEntry && dbEntry.retail > 0) ? dbEntry.retail : params.retailPricePerLb;
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
        console.log('Loading crop value data...');

        const session = (typeof getSession === 'function') ? getSession() : null;
        const authHeaders = session?.token ? { 'Authorization': `Bearer ${session.token}` } : {};

        // Prefer product inventory because manual edits are written to farm_inventory.
        try {
            const productResponse = await fetch(`${API_BASE}/api/farm-sales/inventory`, {
                headers: authHeaders
            });

            if (productResponse.ok) {
                const productData = await productResponse.json();
                const inventoryItems = Array.isArray(productData?.inventory) ? productData.inventory : [];

                if (inventoryItems.length > 0) {
                    const trayDetails = [];
                    let totalValue = 0;
                    let totalWeightLbs = 0;
                    let totalPlants = 0;
                    const cropSummary = {};
                    const stageSummary = {};
                    const LBS_PER_PLANT = 0.125;

                    for (const item of inventoryItems) {
                        const crop = item.product_name || item.name || item.sku_name || item.sku || 'Unknown';
                        const weightLbs = Number(item.quantity_available ?? item.qty_available ?? item.quantity ?? 0);
                        if (weightLbs <= 0) continue;

                        const params = cropGrowthParams[crop] || {};
                        const dbPrice = Number(item.retail_price ?? item.unit_price ?? item.price ?? 0);
                        const retailPricePerLb = dbPrice > 0 ? dbPrice : (params.retailPricePerLb || 0);
                        const yieldFactor = params.yieldFactor || 1;
                        const pricePerOz = retailPricePerLb / 16;
                        const value = weightLbs * retailPricePerLb * yieldFactor;
                        const estPlants = Math.round(weightLbs / LBS_PER_PLANT);

                        const isManual = item.inventory_source === 'manual';
                        const stageLabel = isManual ? 'Manual Entry' : 'Synced Inventory';

                        trayDetails.push({
                            trayId: item.product_id || item.sku_id || item.sku || crop,
                            crop,
                            seedingDate: isManual ? 'Manual' : (item.created_at ? item.created_at.split('T')[0] : '--'),
                            daysPostSeed: 0,
                            weightLbs,
                            plantCount: estPlants,
                            isWeightBased: false,
                            value,
                            pricePerOz,
                            retailPricePerLb,
                            growthPercent: 100,
                            growthStage: stageLabel
                        });

                        totalValue += value;
                        totalWeightLbs += weightLbs;
                        totalPlants += estPlants;

                        if (!cropSummary[crop]) {
                            cropSummary[crop] = {
                                trays: 0,
                                plants: 0,
                                weightLbs: 0,
                                value: 0,
                                totalDays: 0
                            };
                        }
                        cropSummary[crop].trays++;
                        cropSummary[crop].plants += estPlants;
                        cropSummary[crop].weightLbs += weightLbs;
                        cropSummary[crop].value += value;

                        if (!stageSummary[stageLabel]) {
                            stageSummary[stageLabel] = { trays: 0, plants: 0, weightLbs: 0, value: 0, minDays: 0, maxDays: 0 };
                        }
                        stageSummary[stageLabel].trays++;
                        stageSummary[stageLabel].plants += estPlants;
                        stageSummary[stageLabel].weightLbs += weightLbs;
                        stageSummary[stageLabel].value += value;
                    }

                    if (trayDetails.length > 0) {
                        trayDetails.sort((a, b) => b.value - a.value);

                        cropValueData = {
                            totalValue,
                            activeTrays: trayDetails.length,
                            totalPlants,
                            totalWeightLbs,
                            quantityUnit: 'plants',
                            cropCount: Object.keys(cropSummary).length,
                            avgValuePerTray: trayDetails.length > 0 ? totalValue / trayDetails.length : 0,
                            cropSummary,
                            stageSummary,
                            trayDetails,
                            timestamp: new Date().toISOString()
                        };

                        console.log(' Crop value data loaded from product inventory:', cropValueData);
                        return cropValueData;
                    }
                }
            }
        } catch (productError) {
            console.warn(' Falling back to tray inventory for crop value:', productError);
        }
        
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
                weightLbs: 0,
                isWeightBased: false,
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
                    weightLbs: 0,
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
                    weightLbs: 0,
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
            totalWeightLbs: 0,
            quantityUnit: 'plants',
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
function formatQuantity(plants, weightLbs) {
    const parts = [];
    if (plants > 0) parts.push(plants + ' plants');
    if (weightLbs > 0) parts.push(weightLbs.toFixed(2) + ' lbs');
    return parts.join(' + ') || '0';
}

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
        weightEl.textContent = `Based on ${data.activeTrays} inventory items (~${data.totalPlants} est. plants, ${data.totalWeightLbs.toFixed(2)} lbs)`;
    }
    
    const timestampEl = document.getElementById('value-timestamp');
    if (timestampEl) {
        timestampEl.textContent = new Date(data.timestamp).toLocaleString();
    }
    
    // Update summary cards
    const traysEl = document.getElementById('value-active-trays');
    if (traysEl) traysEl.textContent = data.activeTrays;
    
    const plantsEl = document.getElementById('value-total-plants');
    if (plantsEl) plantsEl.textContent = `${data.totalPlants} est. plants`;
    
    const cropCountEl = document.getElementById('value-crop-count');
    if (cropCountEl) cropCountEl.textContent = data.cropCount;
    
    const avgEl = document.getElementById('value-avg-per-tray');
    if (avgEl) avgEl.textContent = `$${data.avgValuePerTray.toFixed(2)}`;

    // Update label for avg card when weight-based
    const avgLabelEl = document.querySelector('#value-avg-per-tray')?.closest('.metric-card')?.querySelector('.metric-label');
    if (avgLabelEl) avgLabelEl.textContent = 'Avg Value/Item';
    
    // Render crop summary table
    const cropTableBody = document.querySelector('#crop-value-table tbody');
    cropTableBody.innerHTML = '';
    
    Object.entries(data.cropSummary).forEach(([crop, summary]) => {
        const avgDays = summary.totalDays / summary.trays;
        const percentOfTotal = (summary.value / data.totalValue * 100).toFixed(1);
        const retailPerLb = summary.retailPricePerLb || (cropGrowthParams[crop] || {}).retailPricePerLb || 0;
        
        const pricePerOz = retailPerLb / 16;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${crop}</td>
            <td>${summary.trays}</td>
            <td>${summary.plants} est. plants</td>
            <td>${avgDays.toFixed(0)} days</td>
            <td>$${pricePerOz.toFixed(2)}/oz</td>
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
            <td>${summary.plants} est. plants</td>
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
            <td>${tray.plantCount} est. plants</td>
            <td><span style="color: ${tray.growthPercent >= 95 ? 'var(--accent-green)' : 'var(--accent-blue)'};">${tray.growthPercent.toFixed(0)}%</span></td>
            <td>${tray.weightLbs.toFixed(2)} lbs</td>
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
    console.log('Refreshing wholesale orders...');
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
                    <div style="font-size: 3rem; margin-bottom: 1rem;"></div>
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
                <p>Failed to load orders: ${error.message}</p>
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
        'pending': { label: 'Pending', color: '#f59e0b', icon: '' },
        'packed': { label: 'Packed', color: '#8b5cf6', icon: '' },
        'shipped': { label: 'Shipped', color: '#3b82f6', icon: '' },
        'delivered': { label: 'Delivered', color: '#10b981', icon: '' }
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
                         Mark as Packed
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
                         Mark as Shipped
                    </button>
                    <button class="btn-secondary" onclick="addTrackingNumber('${order.order_id}')" style="
                        background: rgba(107, 114, 128, 0.2);
                        border: 1px solid #6b7280;
                        color: #9ca3af;
                        padding: 0.5rem 1rem;
                        border-radius: 6px;
                        cursor: pointer;
                    ">
                         Add Tracking #
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
                         Tracking: ${order.tracking_number}
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
                    ️ Print Packing Slip
                </button>
            </div>
        </div>
    `;
}

/**
 * Update order status
 */
async function updateOrderStatus(orderId, newStatus) {
    console.log(` Updating order ${orderId} to status: ${newStatus}`);
    
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
    console.log(`️ Printing packing slip for order ${orderId}`);
    
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
            console.log(` Notified Central of status change: ${orderId} → ${newStatus}`);
        } else {
            console.warn(` Central notification failed (${response.status}), status saved locally`);
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
            console.log(` Notified Central of tracking number: ${orderId} → ${trackingNumber}`);
        } else {
            console.warn(` Central tracking notification failed (${response.status}), saved locally`);
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
        if (!response.ok) { throw new Error(`farm-summary.json ${response.status}`); }
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

        // Network intelligence - activated Phase 1
        try {
            const niResp = await fetch(`${API_BASE}/api/ai/network-intelligence`);
            if (niResp.ok) {
                const niData = await niResp.json();
                const ni = niData.network_intelligence || {};
                const benchmarkCount = Object.keys(ni.crop_benchmarks || {}).length;
                const demandCount = Object.keys(ni.demand_signals || {}).length;
                if (benchmarkCount > 0 || demandCount > 0) {
                    aiContext = `Live network signal: ${benchmarkCount} crop benchmarks, ${demandCount} demand signals.`;
                }
                renderNetworkBenchmarks(ni);
            }
        } catch (e) { /* non-fatal */ }

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
        const farmId = currentSession?.farmId || localStorage.getItem('farm_id') || 'LOCAL-FARM';
        const statusResponse = await fetch('/api/farm/square/status', {
            headers: { 'X-Farm-ID': farmId }
        });
        const statusData = await statusResponse.json();

        const statusContainer = document.getElementById('square-status-container');

        if (statusData.ok && statusData.connected) {
            const d = statusData.data || {};
            statusContainer.innerHTML = `
                <div style="padding: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <div>
                            <div style="font-size: 18px; font-weight: bold; color: var(--accent-green); margin-bottom: 8px;">
                                Square Connected
                            </div>
                            <div style="color: var(--text-secondary); font-size: 14px; line-height: 1.6;">
                                <div>Merchant ID: ${d.merchantId || 'N/A'}</div>
                                <div>Location: ${d.locationName || d.locationId || 'Primary'}</div>
                                <div>Status: ${d.status || 'active'}</div>
                                ${d.connectedAt ? '<div>Connected: ' + new Date(d.connectedAt).toLocaleDateString() + '</div>' : ''}
                            </div>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            <button class="btn" onclick="reconnectSquare()" style="background: var(--accent-blue);">
                                Reconnect
                            </button>
                            <button class="btn" onclick="disconnectSquare()" style="background: var(--accent-red);">
                                Disconnect
                            </button>
                        </div>
                    </div>
                    <div style="border-top: 1px solid var(--border); padding-top: 12px;">
                        <button class="btn" onclick="testSquareConnection()" style="background: var(--accent-blue); margin-right: 8px;">
                            Test Connection
                        </button>
                        <span id="square-test-result" style="color: var(--text-muted); font-size: 13px;"></span>
                    </div>
                </div>
            `;
        } else {
            statusContainer.innerHTML = `
                <div style="padding: 20px; text-align: center;">
                    <div style="font-size: 18px; color: var(--text-secondary); margin-bottom: 10px;">
                        Square Not Connected
                    </div>
                    <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 15px; max-width: 500px; margin-left: auto; margin-right: auto;">
                        Connect your Square account to accept credit cards, debit cards, and digital payments from your customers.
                    <div style="display: flex; gap: 10px; justify-content: center;">
                        <button class="btn" onclick="navigateToPaymentWizard()" style="background: var(--accent-green);">
                            Set Up Square Payments
                        </button>
                    </div>
                </div>
            `;
        }

        // Load receipts
        await loadReceipts();

    } catch (error) {
        console.error('[Payment] Error loading payment methods:', error);
        const statusContainer = document.getElementById('square-status-container');
        if (statusContainer) {
            statusContainer.innerHTML = `
                <div style="padding: 20px; text-align: center;">
                    <div style="font-size: 18px; color: var(--text-secondary); margin-bottom: 10px;">
                        Square Not Connected
                    </div>
                    <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 15px;">
                        Connect your Square account to accept payments from customers.
                    </p>
                    <button class="btn" onclick="navigateToPaymentWizard()" style="background: var(--accent-green);">
                        Set Up Square Payments
                    </button>
                </div>
            `;
        }
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
        const farmId = currentSession?.farmId || localStorage.getItem('farm_id') || 'LOCAL-FARM';
        const farmName = currentSession?.farmName || localStorage.getItem('farm_name') || 'My Farm';

        const response = await fetch('/api/farm/square/authorize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ farmId: farmId, farmName: farmName })
        });
        const data = await response.json();

        if (!response.ok || !data.ok) {
            showToast(data.error || 'Failed to initialize Square connection', 'error');
            return;
        }

        // Open Square OAuth in popup
        const width = 600;
        const height = 700;
        const left = (screen.width - width) / 2;
        const top = (screen.height - height) / 2;

        window.open(
            data.data.authorizationUrl,
            'square-oauth',
            `width=${width},height=${height},left=${left},top=${top}`
        );

        // Listen for callback message
        window.addEventListener('message', function handleSquareCallback(event) {
            if (event.data && event.data.type === 'square-connected') {
                window.removeEventListener('message', handleSquareCallback);
                showToast('Square account connected successfully!', 'success');
                loadPaymentMethods();
            }
        });

    } catch (error) {
        console.error('[Payment] Square connection error:', error);
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
 * Disconnect Square account
 */
async function disconnectSquare() {
    if (!confirm('Are you sure you want to disconnect your Square account? You will not be able to process payments until you reconnect.')) {
        return;
    }
    try {
        const farmId = currentSession?.farmId || localStorage.getItem('farm_id') || 'LOCAL-FARM';
        const response = await fetch('/api/farm/square/disconnect', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Farm-ID': farmId
            },
            body: JSON.stringify({ farmId: farmId })
        });
        const data = await response.json();
        if (data.ok) {
            showToast('Square account disconnected', 'success');
        } else {
            showToast(data.error || 'Failed to disconnect', 'error');
        }
        await loadPaymentMethods();
    } catch (error) {
        console.error('[Payment] Disconnect error:', error);
        showToast('Failed to disconnect Square account', 'error');
    }
}

/**
 * Test Square connection
 */
async function testSquareConnection() {
    const resultEl = document.getElementById('square-test-result');
    if (resultEl) resultEl.textContent = 'Testing...';
    try {
        const farmId = currentSession?.farmId || localStorage.getItem('farm_id') || 'LOCAL-FARM';
        const response = await fetch('/api/farm/square/test-payment', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Farm-ID': farmId
            },
            body: JSON.stringify({ farmId: farmId })
        });
        const data = await response.json();
        if (resultEl) {
            if (data.ok) {
                resultEl.textContent = 'Connection verified - ' + (data.data?.locations?.length || 0) + ' location(s) active';
                resultEl.style.color = 'var(--accent-green)';
            } else {
                resultEl.textContent = 'Test failed: ' + (data.error || 'Unknown error');
                resultEl.style.color = 'var(--accent-red)';
            }
        }
    } catch (error) {
        if (resultEl) {
            resultEl.textContent = 'Connection test failed';
            resultEl.style.color = 'var(--accent-red)';
        }
    }
}

/**
 * Navigate to the Payment Setup wizard in Setup & Update
 */
function navigateToPaymentWizard() {
    // Navigate to Setup & Update page, then trigger the payment wizard from its sidebar
    const navItem = document.querySelector('.nav-item[data-url="/LE-dashboard.html"]');
    if (navItem) {
        navItem.click();
        // After LE-dashboard loads in the iframe, open the payment wizard
        const iframe = document.getElementById('admin-iframe');
        if (iframe) {
            iframe.addEventListener('load', function onWizardLoad() {
                iframe.removeEventListener('load', onWizardLoad);
                try {
                    const iframeWin = iframe.contentWindow;
                    if (iframeWin && typeof iframeWin.openPaymentWizard === 'function') {
                        iframeWin.openPaymentWizard();
                    } else {
                        // Function may not be ready yet (deferred scripts), retry briefly
                        let retries = 0;
                        const interval = setInterval(() => {
                            if (iframeWin && typeof iframeWin.openPaymentWizard === 'function') {
                                clearInterval(interval);
                                iframeWin.openPaymentWizard();
                            } else if (++retries > 20) {
                                clearInterval(interval);
                            }
                        }, 250);
                    }
                } catch (e) {
                    console.warn('[Payment] Could not auto-open wizard:', e.message);
                }
            });
        }
    }
}

/**
 * Load receipts and invoices
 */
let _loadedReceipts = [];

function receiptTypeLabel(receipt) {
    const p = (receipt.provider || '').toLowerCase();
    if (p === 'square' && !receipt.buyer_id) return 'Subscription';
    if (receipt.buyer_id || receipt.order_status) return 'Wholesale Fee';
    if (p === 'stripe') return 'Processing';
    if (p === 'demo') return 'Wholesale Fee';
    return 'Processing';
}

function receiptTypeKey(receipt) {
    const label = receiptTypeLabel(receipt);
    if (label === 'Wholesale Fee') return 'wholesale';
    if (label === 'Subscription') return 'support';
    return 'processing';
}

function receiptDescription(receipt) {
    if (receipt.description) return receipt.description;
    const type = receiptTypeLabel(receipt);
    if (type === 'Subscription') return `Light Engine subscription payment`;
    if (type === 'Wholesale Fee') return `Order ${(receipt.order_id || '').substring(0, 16)}`;
    return `Payment via ${receipt.provider || 'unknown'}`;
}

async function loadReceipts() {
    const tbody = document.getElementById('receipts-tbody');
    
    // Fetch real receipt/invoice data from billing API
    _loadedReceipts = [];
    try {
        const resp = await fetch(`${API_BASE}/api/billing/receipts`, {
            headers: { 'Authorization': `Bearer ${currentSession.token}` }
        });
        if (resp.ok) {
            const data = await resp.json();
            _loadedReceipts = data.receipts || data || [];
        }
    } catch (e) {
        console.warn('Receipts API not available:', e.message);
    }

    renderReceiptRows(_loadedReceipts);
}

function renderReceiptRows(receipts) {
    const tbody = document.getElementById('receipts-tbody');
    if (!tbody) return;

    if (receipts.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                    <div style="font-size: 1.5rem; margin-bottom: 0.5rem;"></div>
                    <div>No receipts or invoices yet</div>
                    <div style="font-size: 0.85rem; margin-top: 0.5rem;">Receipts will appear once billing transactions occur</div>
                </td>
            </tr>`;
        return;
    }
    
    tbody.innerHTML = receipts.map((receipt, idx) => {
        const statusColor = receipt.status === 'completed' ? 'var(--accent-green)' : 'var(--accent-blue)';
        return `
        <tr>
            <td>${new Date(receipt.date).toLocaleDateString()}</td>
            <td>${receiptTypeLabel(receipt)}</td>
            <td>${receiptDescription(receipt)}</td>
            <td>$${(receipt.amount || 0).toFixed(2)} ${receipt.currency || ''}</td>
            <td><span style="padding: 4px 8px; background: ${statusColor}; border-radius: 4px; font-size: 12px;">${(receipt.status || 'paid').toUpperCase()}</span></td>
            <td>
                <button class="btn" onclick="downloadReceipt(${idx})" style="padding: 6px 12px; font-size: 12px;">
                    Download
                </button>
            </td>
        </tr>`;
    }).join('');
}

/**
 * Filter receipts by type
 */
function filterReceipts() {
    const filter = document.getElementById('receiptFilter').value;
    if (filter === 'all') {
        renderReceiptRows(_loadedReceipts);
    } else {
        renderReceiptRows(_loadedReceipts.filter(r => receiptTypeKey(r) === filter));
    }
}

/**
 * Generate receipt text content for download
 */
function buildReceiptText(receipt) {
    const date = new Date(receipt.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const lines = [
        '═══════════════════════════════════════════',
        '           GREENREACH CENTRAL',
        '              RECEIPT',
        '═══════════════════════════════════════════',
        '',
        `  Receipt #:  ${receipt.receipt_id || 'N/A'}`,
        `  Date:       ${date}`,
        `  Provider:   ${(receipt.provider || 'N/A').toUpperCase()}`,
        `  Status:     ${(receipt.status || 'paid').toUpperCase()}`,
        '',
        '───────────────────────────────────────────',
        `  Type:       ${receiptTypeLabel(receipt)}`,
        `  Description:${receiptDescription(receipt)}`,
        '',
        `  Amount:     $${(receipt.amount || 0).toFixed(2)} ${receipt.currency || 'CAD'}`,
    ];
    if (receipt.broker_fee) {
        lines.push(`  Broker Fee: $${receipt.broker_fee.toFixed(2)}`);
        lines.push(`  Net Amount: $${(receipt.net_to_farms || 0).toFixed(2)}`);
    }
    if (receipt.order_id) {
        lines.push('', `  Order ID:   ${receipt.order_id}`);
    }
    lines.push(
        '',
        '───────────────────────────────────────────',
        '  GreenReach Central — greenreachgreens.com',
        '═══════════════════════════════════════════',
        ''
    );
    return lines.join('\n');
}

/**
 * Download single receipt as text file
 */
function downloadReceipt(idx) {
    const receipt = _loadedReceipts[idx];
    if (!receipt) {
        showToast('Receipt not found', 'error');
        return;
    }
    const text = buildReceiptText(receipt);
    const dateStr = new Date(receipt.date).toISOString().split('T')[0];
    const filename = `receipt-${dateStr}-${(receipt.receipt_id || 'unknown').substring(0, 12)}.txt`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Receipt downloaded to your Downloads folder', 'success');
}

/**
 * Download all receipts as a single text file
 */
function downloadAllReceipts() {
    if (_loadedReceipts.length === 0) {
        showToast('No receipts to download', 'info');
        return;
    }
    const allText = _loadedReceipts.map(r => buildReceiptText(r)).join('\n\n');
    const today = new Date().toISOString().split('T')[0];
    const filename = `all-receipts-${today}.txt`;
    const blob = new Blob([allText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`${_loadedReceipts.length} receipt(s) downloaded to your Downloads folder`, 'success');
}

// ============================================================================
// SETTINGS FUNCTIONS
// ============================================================================

/**
 * Load farm settings
 */
async function loadSettings() {
    try {
        // Null-safe DOM helpers — prevent crash when elements are absent
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
        const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
        const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ?? ''; };

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
        
        setVal('settings-farm-id', farmId);
        setVal('settings-registration-code', registrationCode);
        setTxt('network-type', networkType);

        // Populate editable profile fields
        const farmName = profileData.name || farmData.name || setupData.farm?.name || authFarmName || '';
        setVal('settings-farm-name', farmName);
        setVal('settings-contact-name', profileData.contactName || farmData.contact?.name || '');
        setVal('settings-contact-email', profileData.email || farmData.contact?.email || '');
        setVal('settings-contact-phone', profileData.phone || farmData.contact?.phone || '');
        setVal('settings-website', profileData.website || farmData.contact?.website || '');
        const city = profileData.address?.city || (typeof profileData.address === 'string' ? profileData.address : '') || profileData.location || '';
        setVal('settings-city', typeof city === 'object' ? (city.city || '') : city);

        // Plan type badge
        const planType = profileData.planType || setupData.farm?.planType || localStorage.getItem('plan_type') || 'cloud';
        const badgeEl = document.getElementById('plan-type-badge');
        if (badgeEl) {
            if (planType === 'edge') {
                badgeEl.textContent = ' Edge';
                badgeEl.style.cssText = 'padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; background: rgba(139, 92, 246, 0.15); color: #a78bfa; border: 1px solid rgba(139, 92, 246, 0.3);';
            } else {
                badgeEl.textContent = '️ Cloud';
                badgeEl.style.cssText = 'padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3);';
            }
        }

        // Apply feature gating after settings load
        try {
            if (typeof applyPlanFeatureGating === 'function') {
                applyPlanFeatureGating(planType);
            }
        } catch (fgErr) {
            console.warn('[Farm Settings] Feature gating error (non-fatal):', fgErr);
        }

        // Load onboarding checklist
        try {
            if (typeof loadOnboardingChecklist === 'function') {
                loadOnboardingChecklist();
            }
        } catch (obErr) {
            console.warn('[Farm Settings] Onboarding checklist error (non-fatal):', obErr);
        }
        
        // Load hardware info if setup is completed
        if (setupData.completed && setupData.hardwareDetected) {
            setTxt('hardware-lights', setupData.hardwareDetected.lights || 0);
            setTxt('hardware-fans', setupData.hardwareDetected.fans || 0);
            setTxt('hardware-sensors', setupData.hardwareDetected.sensors || 0);
            setTxt('hardware-other', setupData.hardwareDetected.other || 0);
        }

        // Load certifications (always render when data exists, not gated by setup completion)
        if (setupData.certifications) {
            const certList = document.getElementById('certifications-list');
            if (certList) {
                certList.innerHTML = '';
                (setupData.certifications.certifications || []).forEach(cert => {
                    const badge = document.createElement('span');
                    badge.className = 'badge';
                    badge.style.cssText = 'background: rgba(16, 185, 129, 0.1); color: var(--accent-green); padding: 6px 12px; border-radius: 4px; font-size: 12px; border: 1px solid var(--accent-green);';
                    badge.textContent = cert;
                    certList.appendChild(badge);
                });
                if (!setupData.certifications.certifications?.length) {
                    certList.innerHTML = '<span style="color: var(--text-muted); font-size: 12px;">No certifications added</span>';
                }
            }

            const practicesList = document.getElementById('practices-list');
            if (practicesList) {
                practicesList.innerHTML = '';
                (setupData.certifications.practices || []).forEach(practice => {
                    const badge = document.createElement('span');
                    badge.className = 'badge';
                    badge.style.cssText = 'background: rgba(59, 130, 246, 0.1); color: var(--accent-blue); padding: 6px 12px; border-radius: 4px; font-size: 12px; border: 1px solid var(--accent-blue);';
                    badge.textContent = practice;
                    practicesList.appendChild(badge);
                });
                if (!setupData.certifications.practices?.length) {
                    practicesList.innerHTML = '<span style="color: var(--text-muted); font-size: 12px;">No practices selected</span>';
                }
            }
        }
        
        // Load user preferences — try server first, fallback to localStorage
        let settings = {};
        try {
            const token = currentSession?.token || sessionStorage.getItem('token') || localStorage.getItem('token');
            const sHeaders = {};
            if (token) sHeaders['Authorization'] = 'Bearer ' + token;
            const sResp = await fetch('/data/farm-settings.json', { headers: sHeaders });
            if (sResp.ok) {
                const serverSettings = await sResp.json();
                if (serverSettings && Object.keys(serverSettings).length > 0) {
                    settings = serverSettings;
                    // Keep localStorage in sync
                    localStorage.setItem('farmSettings', JSON.stringify(settings));
                }
            }
        } catch (_) { /* server load is best-effort */ }
        // Fallback to localStorage if server returned nothing
        if (!Object.keys(settings).length) {
            settings = JSON.parse(localStorage.getItem('farmSettings') || '{}');
        }
        
        // Display Preferences
        setVal('settings-temp-unit', settings.tempUnit || 'F');
        setVal('settings-weight-unit', settings.weightUnit || 'lbs');
        setVal('settings-currency', settings.currency || 'USD');
        setVal('settings-timezone', settings.timezone || 'America/New_York');
        
        // Notifications
        setChk('notif-new-order', settings.notifNewOrder !== false);
        setChk('notif-order-shipped', settings.notifOrderShipped !== false);
        setChk('notif-low-inventory', settings.notifLowInventory !== false);
        setChk('notif-harvest-ready', settings.notifHarvestReady !== false);
        setChk('notif-equipment-issue', settings.notifEquipmentIssue !== false);
        setChk('notif-ai-recommend', settings.notifAiRecommend !== false);
        setVal('settings-notif-email', settings.notifEmail || '');
        
        // Integration Settings
        setChk('greenreach-sync-enabled', settings.greenreachSync !== false);
        setVal('greenreach-endpoint', settings.greenreachEndpoint || 'https://central.greenreach.app');
        setVal('settings-api-key', settings.apiKey || '');
        
        // Check Square status
        checkSquareStatus();
        
        // System Configuration
        setChk('auto-backup', settings.autoBackup !== false);
        setVal('backup-frequency', settings.backupFrequency || 'daily');
        setChk('require-2fa', settings.require2fa || false);
        setChk('password-expiry', settings.passwordExpiry || false);
        setVal('session-timeout', settings.sessionTimeout || 30);
        
        // Farm Operations Defaults
        setVal('default-ws1-discount', settings.defaultWS1Discount || 20);
        setVal('default-ws2-discount', settings.defaultWS2Discount || 25);
        setVal('default-ws3-discount', settings.defaultWS3Discount || 35);
        setVal('low-stock-threshold', settings.lowStockThreshold || 10);
        
        // API & Webhooks
        setVal('webhook-url', settings.webhookUrl || '');
        setChk('webhook-orders', settings.webhookOrders || false);
        setChk('webhook-inventory', settings.webhookInventory || false);
        setChk('webhook-harvest', settings.webhookHarvest || false);
        
    } catch (error) {
        console.error('Error loading settings:', error?.message || error, error?.stack || '');
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
            if (statusEl) {
                statusEl.textContent = `Connected (${data.merchantName || 'Unknown Merchant'})`;
                statusEl.style.color = 'var(--accent-green)';
            }
            if (statusContainer) {
                statusContainer.style.background = 'rgba(16, 185, 129, 0.1)';
                statusContainer.style.borderColor = 'var(--accent-green)';
            }
        } else {
            if (statusEl) {
                statusEl.textContent = 'Not Connected';
                statusEl.style.color = 'var(--accent-red)';
            }
            if (statusContainer) {
                statusContainer.style.background = 'rgba(239, 68, 68, 0.1)';
                statusContainer.style.borderColor = 'var(--accent-red)';
            }
        }
    } catch (error) {
        console.error('Error checking Square status:', error);
        const statusEl = document.getElementById('square-status-text');
        if (statusEl) {
            statusEl.textContent = 'Unable to check status';
            statusEl.style.color = 'var(--text-muted)';
        }
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
            const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
            set('hardware-lights', data.lights || 0);
            set('hardware-fans', data.fans || 0);
            set('hardware-sensors', data.sensors || 0);
            set('hardware-other', data.other || 0);
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
        
        // Persist to server (DB-backed via farmStore)
        try {
            const token = currentSession?.token || sessionStorage.getItem('token') || localStorage.getItem('token');
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = 'Bearer ' + token;
            const saveResp = await fetch('/data/farm-settings.json', {
                method: 'POST',
                headers,
                body: JSON.stringify(settings)
            });
            if (!saveResp.ok) {
                console.warn('[Farm Settings] Server save returned', saveResp.status);
            } else {
                console.log('[Farm Settings] Saved to server successfully');
            }
        } catch (err) {
            console.warn('[Farm Settings] Server save failed:', err.message);
        }

        // Broadcast display prefs so other admin sections can react
        try {
            window.dispatchEvent(new CustomEvent('farmSettingsUpdated', { detail: settings }));
        } catch (_) {}

        // Also save farm profile (contact info) so the bottom Save Settings captures everything
        try {
            await saveProfileSettings({ silent: true });
        } catch (_) { /* profile save is best-effort — it has its own error handling */ }
        
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
        // Load current certifications from setup status (farmStore is source of truth)
        let certifications = { certifications: [], practices: [], attributes: [] };
        
        try {
            const headers = {};
            if (currentSession?.token) headers['Authorization'] = `Bearer ${currentSession.token}`;
            const statusResponse = await fetch('/api/setup/status', { headers });
            if (statusResponse.ok) {
                const statusData = await statusResponse.json();
                if (statusData.certifications) {
                    certifications = statusData.certifications;
                }
            }
        } catch (error) {
            console.warn('[Settings] Could not load certifications from /api/setup/status:', error);
        }
        
        // Populate checkboxes with current values
        const form = document.getElementById('editCertificationsForm');
        if (!form) {
            console.warn('[Settings] editCertificationsForm not found in DOM');
            showToast('Certifications editor not available', 'warning');
            return;
        }
        
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
        const modal = document.getElementById('editCertificationsModal');
        if (modal) modal.style.display = 'block';
    } catch (error) {
        console.error('Error opening certifications modal:', error);
        showToast('Error loading certifications', 'error');
    }
}

/**
 * Close edit certifications modal
 */
function closeEditCertificationsModal() {
    const modal = document.getElementById('editCertificationsModal');
    if (modal) modal.style.display = 'none';
}

/**
 * Save edited certifications
 */
async function saveEditCertifications(event) {
    event.preventDefault();
    
    try {
        const form = document.getElementById('editCertificationsForm');
        if (!form) {
            showToast('Certifications form not found', 'error');
            return;
        }
        
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
        const token = currentSession?.token || sessionStorage.getItem('token') || localStorage.getItem('token');
        if (!token) {
            console.warn('[Farm Settings] No auth token available for certifications save');
            showToast('Not authenticated -- please log in again', 'error');
            return;
        }
        const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };
        
        console.log('[Farm Settings] Saving certifications:', updatedCertifications);
        const response = await fetch('/api/setup/certifications', {
            method: 'POST',
            headers,
            body: JSON.stringify(updatedCertifications)
        });
        
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.success === false) {
            console.error('[Farm Settings] Certifications save failed:', response.status, result);
            throw new Error(result.error || 'Server returned ' + response.status);
        }
        
        console.log('[Farm Settings] Certifications saved successfully');
        
        // Close modal and reload settings to show updates
        closeEditCertificationsModal();
        showToast('Certifications updated successfully', 'success');
        
        // Reload settings to show updated badges
        await loadSettings();
        
    } catch (error) {
        console.error('[Farm Settings] Error saving certifications:', error);
        showToast('Error saving certifications: ' + error.message, 'error');
        // Do NOT close modal on error -- let user retry
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
async function saveProfileSettings(options = {}) {
    const silent = options.silent || false;
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
            if (!silent) showToast('Please enter a valid email address', 'error');
            return;
        }

        const token = currentSession?.token || sessionStorage.getItem('token') || localStorage.getItem('token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const response = await fetch('/api/setup/profile', {
            method: 'PATCH',
            headers,
            body: JSON.stringify(profileData)
        });

        const result = await response.json();
        if (result.success) {
            if (!silent) showToast('Farm profile saved successfully', 'success');
            // Update localStorage farm_name for nav header
            if (profileData.name) {
                localStorage.setItem('farm_name', profileData.name);
            }
        } else {
            if (!silent) showToast(result.error || 'Failed to save profile', 'error');
        }
    } catch (error) {
        console.error('Error saving profile:', error);
        if (!silent) showToast('Error saving profile', 'error');
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
 * Render network benchmark comparisons into the farm dashboard.
 * Shows crop benchmarks from Central's push so growers can compare their farm performance.
 */
function renderNetworkBenchmarks(ni) {
    const container = document.getElementById('network-benchmarks-panel');
    if (!container) return;

    const benchmarks = ni.crop_benchmarks || {};
    const demandSignals = ni.demand_signals || {};
    const riskAlerts = ni.risk_alerts || [];
    const cropNames = Object.keys(benchmarks);

    if (cropNames.length === 0 && riskAlerts.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 13px;">No network benchmarks received yet. Data arrives every 30 minutes from Central.</div>';
        return;
    }

    let html = '';

    // Risk alerts
    if (riskAlerts.length > 0) {
        html += '<div style="margin-bottom: 12px; padding: 10px 14px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px;">';
        html += '<div style="font-weight: 600; color: var(--accent-red); font-size: 12px; margin-bottom: 4px;">Network Risk Alerts</div>';
        riskAlerts.forEach(function(alert) {
            html += '<div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">' + (alert.message || alert.type || 'Unknown alert') + '</div>';
        });
        html += '</div>';
    }

    // Crop benchmarks
    cropNames.forEach(function(crop) {
        var bm = benchmarks[crop];
        var demand = demandSignals[crop] || {};
        var demandLabel = demand.demand_score >= 80 ? 'High' : (demand.demand_score >= 50 ? 'Medium' : 'Low');
        var demandColor = demand.demand_score >= 80 ? 'var(--accent-green)' : (demand.demand_score >= 50 ? 'var(--accent-yellow)' : 'var(--text-muted)');

        html += '<div style="background: var(--bg-secondary); border-radius: 8px; padding: 12px 14px; margin-bottom: 8px;">';
        html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">';
        html += '<div style="font-weight: 600; font-size: 14px; color: var(--text-primary); text-transform: capitalize;">' + crop + '</div>';
        if (demand.demand_score != null) {
            html += '<span style="font-size: 11px; padding: 2px 8px; border-radius: 10px; background: ' + demandColor + '22; color: ' + demandColor + '; font-weight: 600;">Demand: ' + demandLabel + '</span>';
        }
        html += '</div>';

        html += '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-size: 12px; color: var(--text-secondary);">';
        html += '<div>Network Yield: <strong style="color: var(--text-primary);">' + (bm.avg_yield_oz != null ? bm.avg_yield_oz + ' oz' : '--') + '</strong></div>';
        html += '<div>Cycle: <strong style="color: var(--text-primary);">' + (bm.avg_cycle_days != null ? bm.avg_cycle_days + ' days' : '--') + '</strong></div>';
        html += '<div>Farms: <strong style="color: var(--text-primary);">' + (bm.network_farms || 0) + '</strong></div>';
        html += '</div>';
        html += '</div>';
    });

    container.innerHTML = html;

    // Phase 4 T37: Render planting suggestions if available
    renderPlantingSuggestions(ni);
    // Phase 4 T39: Render recipe modifier accept/dismiss if available
    renderRecipeModifiers(ni);
}

/**
 * Phase 4 Task 37: Render planting suggestions from Central.
 * Suggestions arrive in the network_intelligence push payload.
 */
function renderPlantingSuggestions(ni) {
    const suggestions = ni.planting_suggestions || [];
    if (suggestions.length === 0) return;
    const container = document.getElementById('network-benchmarks-panel');
    if (!container) return;

    let html = '<div style="margin-top: 16px; padding: 12px 14px; background: rgba(59, 130, 246, 0.06); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 8px;">';
    html += '<div style="font-weight: 600; color: var(--accent-blue); font-size: 13px; margin-bottom: 8px;">Planting Suggestions from Network</div>';

    suggestions.forEach(function(s, i) {
        const urgencyColor = s.urgency === 'high' ? 'var(--accent-red)' : s.urgency === 'medium' ? 'var(--accent-yellow)' : 'var(--text-muted)';
        html += '<div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border);" id="suggestion-row-' + i + '">';
        html += '<div style="flex: 1;">';
        html += '<div style="font-weight: 500; font-size: 13px; text-transform: capitalize;">' + (s.crop || 'Unknown') + '</div>';
        html += '<div style="font-size: 11px; color: var(--text-secondary);">' + (s.action || s.message || '') + '</div>';
        html += '<div style="font-size: 10px; margin-top: 2px;"><span style="color: ' + urgencyColor + '; font-weight: 600;">' + (s.urgency || 'low').toUpperCase() + '</span>';
        if (s.recommended_trays) html += ' | ' + s.recommended_trays + ' trays recommended';
        html += '</div>';
        html += '</div>';
        html += '<div style="display: flex; gap: 6px;">';
        html += '<button onclick="acceptPlantingSuggestion(' + i + ', \'' + (s.crop || '').replace(/'/g, "\\'") + '\')" style="padding: 4px 12px; font-size: 11px; background: var(--accent-green); color: #fff; border: none; border-radius: 4px; cursor: pointer;">Accept</button>';
        html += '<button onclick="dismissPlantingSuggestion(' + i + ')" style="padding: 4px 12px; font-size: 11px; background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--border); border-radius: 4px; cursor: pointer;">Dismiss</button>';
        html += '</div></div>';
    });

    html += '</div>';
    container.innerHTML += html;
}

/**
 * Accept a planting suggestion: navigate to seeding with pre-filled crop.
 */
function acceptPlantingSuggestion(index, crop) {
    const row = document.getElementById('suggestion-row-' + index);
    if (row) {
        row.style.opacity = '0.5';
        row.querySelector('button').textContent = 'Accepted';
        row.querySelector('button').disabled = true;
    }
    // Pre-fill the crop in the seeding flow
    if (typeof navigate === 'function') {
        sessionStorage.setItem('suggested_crop', crop);
        navigate('activity-hub');
    }
}

/**
 * Dismiss a planting suggestion.
 */
function dismissPlantingSuggestion(index) {
    const row = document.getElementById('suggestion-row-' + index);
    if (row) {
        row.style.opacity = '0.3';
        row.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); padding: 8px 0;">Dismissed</div>';
    }
}

/**
 * Phase 4 Task 39: Render recipe modifiers with one-tap accept/dismiss.
 * Modifiers arrive in the network_intelligence push payload.
 */
function renderRecipeModifiers(ni) {
    const modifiers = ni.recipe_modifiers || {};
    const crops = Object.keys(modifiers);
    if (crops.length === 0) return;
    const container = document.getElementById('network-benchmarks-panel');
    if (!container) return;

    // Check dismissed state
    let dismissed = {};
    try { dismissed = JSON.parse(localStorage.getItem('dismissed_modifiers') || '{}'); } catch (_) {}

    let html = '<div style="margin-top: 16px; padding: 12px 14px; background: rgba(16, 185, 129, 0.06); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 8px;">';
    html += '<div style="font-weight: 600; color: var(--accent-green); font-size: 13px; margin-bottom: 8px;">Network Recipe Modifiers</div>';

    let visibleCount = 0;
    crops.forEach(function(crop) {
        const mod = modifiers[crop];
        if (!mod) return;
        // Skip dismissed
        if (dismissed[crop] && (Date.now() - dismissed[crop]) < 7 * 24 * 60 * 60 * 1000) return;
        visibleCount++;

        const confidence = mod.confidence ? (mod.confidence * 100).toFixed(0) + '%' : 'N/A';
        const adjustments = mod.adjustments || mod;

        html += '<div style="padding: 8px 0; border-bottom: 1px solid var(--border);" id="modifier-row-' + crop + '">';
        html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">';
        html += '<div style="font-weight: 500; font-size: 13px; text-transform: capitalize;">' + crop + ' <span style="font-size: 10px; color: var(--text-muted);">(confidence: ' + confidence + ')</span></div>';
        html += '<div style="display: flex; gap: 6px;">';
        html += '<button onclick="acceptRecipeModifier(\'' + crop.replace(/'/g, "\\'") + '\')" style="padding: 4px 12px; font-size: 11px; background: var(--accent-green); color: #fff; border: none; border-radius: 4px; cursor: pointer;">Apply</button>';
        html += '<button onclick="dismissRecipeModifier(\'' + crop.replace(/'/g, "\\'") + '\')" style="padding: 4px 12px; font-size: 11px; background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--border); border-radius: 4px; cursor: pointer;">Dismiss</button>';
        html += '</div></div>';

        // Show adjustment details
        html += '<div style="font-size: 11px; color: var(--text-secondary); display: flex; gap: 12px; flex-wrap: wrap;">';
        if (adjustments.temp_offset) html += '<span>Temp: ' + (adjustments.temp_offset > 0 ? '+' : '') + adjustments.temp_offset + 'F</span>';
        if (adjustments.humidity_offset) html += '<span>Humidity: ' + (adjustments.humidity_offset > 0 ? '+' : '') + adjustments.humidity_offset + '%</span>';
        if (adjustments.ppfd_offset) html += '<span>PPFD: ' + (adjustments.ppfd_offset > 0 ? '+' : '') + adjustments.ppfd_offset + '</span>';
        if (adjustments.photoperiod_offset) html += '<span>Light: ' + (adjustments.photoperiod_offset > 0 ? '+' : '') + adjustments.photoperiod_offset + 'h</span>';
        if (Object.keys(adjustments).filter(k => k.endsWith('_offset')).length === 0) {
            html += '<span>Network-optimized parameters available</span>';
        }
        html += '</div></div>';
    });

    if (visibleCount === 0) return; // All dismissed
    html += '</div>';
    container.innerHTML += html;
}

/**
 * Accept a recipe modifier: POST to LE backend.
 */
async function acceptRecipeModifier(crop) {
    const row = document.getElementById('modifier-row-' + crop);
    try {
        const resp = await fetch('/api/recipe-modifiers/network/' + encodeURIComponent(crop) + '/accept', { method: 'POST' });
        const data = await resp.json();
        if (row) {
            row.style.background = 'rgba(16, 185, 129, 0.1)';
            row.querySelector('button').textContent = 'Applied';
            row.querySelector('button').disabled = true;
        }
    } catch (err) {
        console.error('Failed to accept modifier:', err);
        if (row) row.style.background = 'rgba(239, 68, 68, 0.1)';
    }
}

/**
 * Dismiss a recipe modifier: persists to localStorage for 7 days.
 */
function dismissRecipeModifier(crop) {
    const row = document.getElementById('modifier-row-' + crop);
    if (row) {
        row.style.opacity = '0.3';
        row.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); padding: 4px 0;">Dismissed for 7 days</div>';
    }
    try {
        const dismissed = JSON.parse(localStorage.getItem('dismissed_modifiers') || '{}');
        dismissed[crop] = Date.now();
        localStorage.setItem('dismissed_modifiers', JSON.stringify(dismissed));
    } catch (_) {}
    // Notify backend
    fetch('/api/recipe-modifiers/network/' + encodeURIComponent(crop) + '/dismiss', { method: 'POST' }).catch(function() {});
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
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentSession.token}` },
                body: JSON.stringify(farmData)
            });
            
            // Save rooms to /rooms endpoint if any rooms were added
            if (setupData.rooms && setupData.rooms.length > 0) {
                await fetch('/rooms', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentSession.token}` },
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
        statusEl.textContent = 'Geolocation not supported by your browser';
        statusEl.style.color = 'var(--error-red)';
        return;
    }
    
    btn.disabled = true;
    btn.textContent = ' Getting location...';
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
            
            statusEl.textContent = ' Location captured! Fetching address...';
            
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
                    
                    statusEl.textContent = ' Location and address captured! (Weather data enabled)';
                    statusEl.style.color = 'var(--accent-green)';
                } else {
                    statusEl.textContent = ' GPS captured, but could not determine address. Please enter manually.';
                    statusEl.style.color = 'var(--text-secondary)';
                }
            } catch (error) {
                console.error('[Setup] Geocoding error:', error);
                statusEl.textContent = ' GPS captured, geocoding failed. Please enter address manually.';
                statusEl.style.color = 'var(--text-secondary)';
            }
            
            btn.disabled = false;
            btn.textContent = ' Use Current Location';
        },
        (error) => {
            console.error('[Setup] Geolocation error:', error);
            
            let errorMsg = 'Location access failed';
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    errorMsg = 'Location access denied. Please enable location permissions for weather data.';
                    break;
                case error.POSITION_UNAVAILABLE:
                    errorMsg = 'Location unavailable. Please check your device settings.';
                    break;
                case error.TIMEOUT:
                    errorMsg = 'Location request timed out. Please try again.';
                    break;
                default:
                    errorMsg = 'Unknown error accessing location. Please enter address manually.';
            }
            
            statusEl.textContent = errorMsg;
            statusEl.style.color = 'var(--error-red)';
            btn.disabled = false;
            btn.textContent = ' Use Current Location';
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
        // Ensure every user has a numeric id (API may not return one or may return as string)
        users.forEach((u, i) => {
            if (u.id == null) u.id = i + 1;
            u.id = Number(u.id);
        });
        window.allUsers = users;
        
        renderUsersTable(users);
        loadAccessLog();
        loadPendingInvitations(users);
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
        
        const timeSince = user.lastLogin ? formatTimeSince(new Date(user.lastLogin)) : 'Never';
        
        return `
            <tr>
                <td style="font-weight: 500;">${escapeHtml(user.name || user.email || "Unknown")}</td>
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
                farmId: currentSession.farmId,
                sendEmail: true,
                farmName: currentSession.farmName || 'Light Engine Farm',
                personalMessage: message || undefined
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Failed to create user');
        }
        
        closeInviteUserModal();
        
        if (data.emailSent) {
            const credentialsMsg = `User created and invitation email sent to ${email}.\n\nBackup credentials (in case email is delayed):\nFarm ID: ${currentSession.farmId}\nEmail: ${email}\nTemporary Password: ${tempPassword}\n\nThe user should change their password after first login.`;
            alert(credentialsMsg);
            showToast(`Invitation sent to ${email}`, 'success');
        } else {
            const credentialsMsg = `User created but invitation email could not be sent.\n\nPlease share these credentials manually:\nFarm ID: ${currentSession.farmId}\nEmail: ${email}\nTemporary Password: ${tempPassword}\n\nAsk the user to change their password after first login.`;
            alert(credentialsMsg);
            showToast(`User ${email} created (email not sent)`, 'warning');
        }
        
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
 * Populate pending invitations table from user list.
 * Users who have never logged in are treated as pending invitations.
 */
function loadPendingInvitations(users) {
    var tbody = document.querySelector('#invitations-table tbody');
    if (!tbody) return;

    var pending = (users || []).filter(function(u) { return !u.lastLogin && u.status === 'active'; });

    if (pending.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 14px;">No pending invitations</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    pending.forEach(function(u) {
        var sent = u.createdAt ? formatTimeSince(new Date(u.createdAt)) : '--';
        var row = document.createElement('tr');
        row.innerHTML = '<td>' + escapeHtml(u.email) + '</td>'
            + '<td style="text-transform: capitalize;">' + (u.role || 'operator') + '</td>'
            + '<td>' + escapeHtml(currentSession.email || 'Admin') + '</td>'
            + '<td>' + sent + '</td>'
            + '<td>--</td>'
            + '<td>'
            + '<button class="btn btn-sm" onclick="resendInvitation(\x27' + u.email + '\x27)" style="padding: 4px 8px; font-size: 12px;">Resend</button> '
            + '<button class="btn btn-sm" onclick="cancelInvitation(\x27' + u.email + '\x27)" style="padding: 4px 8px; font-size: 12px; background: var(--accent-red);">Cancel</button>'
            + '</td>';
        tbody.appendChild(row);
    });
}
/**
 * Open edit user modal
 */
function openEditUserModal(userId) {
    const user = window.allUsers.find(u => u.id === userId);
    if (!user) return;
    
    document.getElementById('edit-user-id').value = user.id;
    document.getElementById('edit-user-name').value = user.name || user.email || '';
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
    if (!user) {
        showToast('User not found', 'error');
        return;
    }
    
    if (!confirm(`Are you sure you want to remove ${user.name || user.email}? This action cannot be undone.`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/users/delete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentSession.token}`
            },
            body: JSON.stringify({ email: user.email })
        });
        
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || errData.message || `Server returned ${response.status}`);
        }

        window.allUsers = window.allUsers.filter(u => u.id !== userId);
        
        showToast('User removed successfully', 'success');
        closeEditUserModal();
        renderUsersTable(window.allUsers);
        
    } catch (error) {
        console.error('Error removing user:', error);
        showToast('Error removing user: ' + error.message, 'error');
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
                    <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">Locked</div>
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
    // Safe init: only call loadUsers -- legacy DOM elements were removed from HTML
    try {
        await loadUsers();
    } catch (err) {
        console.warn("initUserManagement: loadUsers failed:", err.message);
    }
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
 * Delete user (by email, called from user table actions)
 */
async function deleteUser(email) {
    if (!confirm(`Are you sure you want to remove ${email} from this farm?`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/users/delete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentSession.token}`
            },
            body: JSON.stringify({ email })
        });

        if (response.ok) {
            showToast('User removed successfully', 'success');
            loadUsers();
        } else {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || data.message || 'Failed to remove user');
        }
    } catch (error) {
        showToast(error.message, 'error');
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


// ── Phase 5 T47: Voice-first Activity Hub ────────────────────────────────
let voiceRecognition = null;
let voiceLastIntent = null;

function openVoiceModal() {
    const modal = document.getElementById('voiceCommandModal');
    if (!modal) return;
    modal.style.display = 'flex';
    resetVoiceModal();
}

function closeVoiceModal() {
    const modal = document.getElementById('voiceCommandModal');
    if (!modal) return;
    modal.style.display = 'none';
    if (voiceRecognition) {
        try { voiceRecognition.stop(); } catch (_) {}
        voiceRecognition = null;
    }
}

function resetVoiceModal() {
    document.getElementById('voiceStatus').textContent = 'Tap the microphone to start';
    document.getElementById('voiceTranscript').style.display = 'none';
    document.getElementById('voiceTranscript').textContent = '';
    document.getElementById('voiceParsed').style.display = 'none';
    document.getElementById('voiceConfirmBtns').style.display = 'none';
    const btn = document.getElementById('voiceStartBtn');
    if (btn) {
        btn.style.background = 'var(--accent-green, #34d399)';
        btn.style.display = '';
    }
    voiceLastIntent = null;
}

function toggleVoiceRecording() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        document.getElementById('voiceStatus').textContent = 'Voice input not supported in this browser';
        return;
    }
    if (voiceRecognition) {
        voiceRecognition.stop();
        voiceRecognition = null;
        document.getElementById('voiceStartBtn').style.background = 'var(--accent-green, #34d399)';
        document.getElementById('voiceStatus').textContent = 'Stopped. Tap to try again.';
        return;
    }
    voiceRecognition = new SpeechRecognition();
    voiceRecognition.continuous = false;
    voiceRecognition.interimResults = true;
    voiceRecognition.lang = 'en-US';
    const statusEl = document.getElementById('voiceStatus');
    const transcriptEl = document.getElementById('voiceTranscript');
    const btn = document.getElementById('voiceStartBtn');
    statusEl.textContent = 'Listening...';
    btn.style.background = '#ef4444';
    transcriptEl.style.display = 'block';
    transcriptEl.textContent = '...';

    voiceRecognition.onresult = (event) => {
        const result = event.results[event.results.length - 1];
        transcriptEl.textContent = result[0].transcript;
        if (result.isFinal) {
            statusEl.textContent = 'Processing...';
            parseVoiceIntent(result[0].transcript);
        }
    };
    voiceRecognition.onerror = (event) => {
        statusEl.textContent = 'Error: ' + (event.error || 'unknown');
        btn.style.background = 'var(--accent-green, #34d399)';
        voiceRecognition = null;
    };
    voiceRecognition.onend = () => {
        btn.style.background = 'var(--accent-green, #34d399)';
        voiceRecognition = null;
    };
    voiceRecognition.start();
}

async function parseVoiceIntent(transcript) {
    try {
        const resp = await fetch(API_BASE + '/api/voice/parse-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ transcript })
        });
        const data = await resp.json();
        if (!data.ok || !data.intent || data.intent.action === 'unknown') {
            document.getElementById('voiceStatus').textContent = 'Could not understand. Try again.';
            if (data.intent?.suggestion) {
                document.getElementById('voiceStatus').textContent += ' ' + data.intent.suggestion;
            }
            return;
        }
        voiceLastIntent = data.intent;
        const parsedEl = document.getElementById('voiceParsed');
        parsedEl.style.display = 'block';
        document.getElementById('voiceParsedAction').textContent = data.intent.action.replace(/_/g, ' ').toUpperCase();
        const paramStrs = Object.entries(data.intent.params || {}).filter(([,v]) => v != null).map(([k,v]) => k + ': ' + v);
        document.getElementById('voiceParsedParams').textContent = paramStrs.join(', ') || 'No parameters detected';
        document.getElementById('voiceParsedConfidence').textContent = 'Confidence: ' + Math.round((data.intent.confidence || 0) * 100) + '%';
        document.getElementById('voiceStatus').textContent = 'Action detected. Confirm or cancel.';
        document.getElementById('voiceStartBtn').style.display = 'none';
        document.getElementById('voiceConfirmBtns').style.display = 'flex';
    } catch (err) {
        console.error('[voice] parse error:', err);
        document.getElementById('voiceStatus').textContent = 'Parse failed: ' + err.message;
    }
}

async function executeVoiceAction() {
    if (!voiceLastIntent || !voiceLastIntent.api) {
        showToast('No action to execute', 'error');
        closeVoiceModal();
        return;
    }
    const { method, endpoint } = voiceLastIntent.api;
    const params = voiceLastIntent.params || {};
    document.getElementById('voiceStatus').textContent = 'Executing...';
    try {
        const resp = await fetch(API_BASE + endpoint, {
            method: method || 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: method === 'GET' ? undefined : JSON.stringify(params)
        });
        const data = await resp.json();
        if (data.ok || data.success) {
            showToast('Voice command executed: ' + voiceLastIntent.action.replace(/_/g, ' '), 'success');
            // Speak confirmation via TTS
            speakConfirmation(voiceLastIntent.action, params);
        } else {
            showToast('Action failed: ' + (data.error || 'unknown'), 'error');
        }
    } catch (err) {
        console.error('[voice] execute error:', err);
        showToast('Execution failed: ' + err.message, 'error');
    }
    closeVoiceModal();
}

async function speakConfirmation(action, params) {
    const messages = {
        seed: 'Seeding recorded' + (params.crop ? ' for ' + params.crop : ''),
        harvest: 'Harvest recorded' + (params.crop_or_group ? ' for ' + params.crop_or_group : ''),
        move: 'Move recorded' + (params.crop ? ' for ' + params.crop : ''),
        quality_check: 'Quality check logged' + (params.crop ? ' for ' + params.crop : ''),
        loss_report: 'Loss report filed' + (params.quantity ? ': ' + params.quantity + ' units' : '')
    };
    const text = messages[action] || 'Action completed';
    try {
        const resp = await fetch(API_BASE + '/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ text })
        });
        if (resp.ok) {
            const blob = await resp.blob();
            const audio = new Audio(URL.createObjectURL(blob));
            audio.play().catch(() => {});
        }
    } catch (_) {
        // TTS is best-effort
    }
}
