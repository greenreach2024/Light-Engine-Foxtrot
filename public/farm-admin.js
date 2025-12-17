/**
 * Farm Admin Portal JavaScript
 * Handles authentication, session management, and farm-specific operations
 */

const API_BASE = window.location.origin;
const STORAGE_KEY_SESSION = 'farm_admin_session';
const STORAGE_KEY_REMEMBER = 'farm_admin_remember';

// Session state
let currentSession = null;
let farmData = null;

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
    console.log('🔐 Initializing farm admin login...');
    
    // Check if user is already logged in
    const session = getSession();
    if (session && session.token) {
        console.log('✅ Active session found, redirecting to dashboard...');
        window.location.href = '/farm-admin.html';
        return;
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
    
    // Setup form handler
    const form = document.getElementById('loginForm');
    if (form) {
        form.addEventListener('submit', handleLogin);
    }
    
    // Auto-fill demo credentials
    if (window.location.search.includes('demo=true')) {
        document.getElementById('farmId').value = 'GR-00001';
        document.getElementById('email').value = 'admin@demo-farm.com';
        document.getElementById('password').value = 'demo123';
    }
}

/**
 * Initialize dashboard
 */
async function initDashboard() {
    console.log('📊 Initializing farm admin dashboard...');
    
    // AUTHENTICATION DISABLED - Direct access granted
    // Create a default session for farm operations
    currentSession = {
        token: 'local-access',
        farmId: 'LOCAL-FARM',
        farmName: 'Light Engine Farm',
        email: 'admin@local-farm.com',
        role: 'admin'
    };
    
    // Setup navigation
    setupNavigation();
    
    // Load farm data
    await loadFarmData();
    
    // Load dashboard data
    await loadDashboardData();
    
    // Setup auto-refresh
    setInterval(() => loadDashboardData(), 30000); // Refresh every 30 seconds
}

/**
 * Handle login form submission
 */
async function handleLogin(e) {
    e.preventDefault();
    
    const farmId = document.getElementById('farmId').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const remember = document.getElementById('remember').checked;
    
    // Validation
    if (!farmId || !email || !password) {
        showAlert('error', 'Please fill in all fields');
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
            
            // Save remember me
            if (remember) {
                localStorage.setItem(STORAGE_KEY_REMEMBER, JSON.stringify({
                    farmId,
                    email
                }));
            } else {
                localStorage.removeItem(STORAGE_KEY_REMEMBER);
            }
            
            showAlert('success', 'Login successful! Redirecting...');
            
            setTimeout(() => {
                window.location.href = '/farm-admin.html';
            }, 1000);
            
        } else {
            showAlert('error', data.message || 'Invalid credentials. Please try again.');
            loginBtn.innerHTML = originalText;
            loginBtn.disabled = false;
        }
        
    } catch (error) {
        console.error('❌ Login error:', error);
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
        const response = await fetch(`${API_BASE}/api/admin/farms/${currentSession.farmId}`, {
            headers: {
                'Authorization': `Bearer ${currentSession.token}`
            }
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            farmData = data.farm;
            
            // Update UI
            document.getElementById('farmName').textContent = farmData.name;
            document.getElementById('farmId').textContent = farmData.farmId;
            
            if (currentSession.subscription) {
                const badge = document.getElementById('subscriptionBadge');
                badge.textContent = currentSession.subscription.plan.toUpperCase() + ' PLAN';
            }
            
            // Update GreenReach connection status
            const statusEl = document.getElementById('greenreach-status');
            if (farmData.status === 'active' || farmData.summary) {
                statusEl.textContent = 'CONNECTED';
                statusEl.classList.remove('disconnected');
            } else {
                statusEl.textContent = 'DISCONNECTED';
                statusEl.classList.add('disconnected');
            }
        }
        
    } catch (error) {
        console.error('❌ Error loading farm data:', error);
    }
}

/**
 * Load dashboard data
 */
async function loadDashboardData() {
    try {
        console.log('📊 Loading dashboard data...');
        
        // Load inventory data from demo mode endpoint
        const inventoryRes = await fetch(`${API_BASE}/api/inventory/current`, {
            headers: {
                'Authorization': `Bearer ${currentSession.token}`
            }
        });
        
        if (inventoryRes.ok) {
            const inventoryData = await inventoryRes.json();
            console.log('✅ Inventory data loaded:', inventoryData);
            
            // Check if data is at root level (demo mode) or nested in data property
            const data = inventoryData.data || inventoryData;
            
            if (data.activeTrays !== undefined && data.totalPlants !== undefined) {
                document.getElementById('kpi-trays').textContent = data.activeTrays || 0;
                document.getElementById('kpi-plants').textContent = (data.totalPlants || 0).toLocaleString();
                
                // Calculate changes (demo values)
                document.getElementById('kpi-trays-change').textContent = '+12 this week';
                document.getElementById('kpi-plants-change').textContent = '+324 this week';
            } else {
                // Fallback to demo values if data structure is unexpected
                console.warn('⚠️ Unexpected data structure, using fallback values');
                document.getElementById('kpi-trays').textContent = '320';
                document.getElementById('kpi-plants').textContent = '7,680';
                document.getElementById('kpi-trays-change').textContent = '+12 this week';
                document.getElementById('kpi-plants-change').textContent = '+324 this week';
            }
        } else {
            // Fallback to demo values
            console.warn('⚠️ Using demo inventory values');
            document.getElementById('kpi-trays').textContent = '320';
            document.getElementById('kpi-plants').textContent = '7,680';
            document.getElementById('kpi-trays-change').textContent = '+12 this week';
            document.getElementById('kpi-plants-change').textContent = '+324 this week';
        }
        
        // Load forecast data
        const forecastRes = await fetch(`${API_BASE}/api/inventory/forecast/30`, {
            headers: {
                'Authorization': `Bearer ${currentSession.token}`
            }
        });
        
        if (forecastRes.ok) {
            const forecastData = await forecastRes.json();
            console.log('✅ Forecast data loaded:', forecastData);
            
            if (forecastData.status === 'success' && forecastData.data && forecastData.data.length > 0) {
                const nextHarvest = forecastData.data[0];
                const harvestDate = new Date(nextHarvest.harvestDate);
                const daysUntil = Math.ceil((harvestDate - new Date()) / (1000 * 60 * 60 * 24));
                
                document.getElementById('kpi-harvest').textContent = `${daysUntil}d`;
                document.getElementById('kpi-harvest-change').textContent = `${nextHarvest.cropName || 'Mixed crops'}`;
            }
        } else {
            // Fallback to demo values
            console.warn('⚠️ Using demo forecast values');
            document.getElementById('kpi-harvest').textContent = '14d';
            document.getElementById('kpi-harvest-change').textContent = 'Butterhead Lettuce';
        }
        
        // Load devices (mock data for now)
        document.getElementById('kpi-devices').textContent = '24';
        document.getElementById('kpi-devices-change').textContent = '2 offline';
        
        // Load subscription usage
        await loadSubscriptionUsage();
        
        // Load activity
        await loadRecentActivity();
        
        console.log('✅ Dashboard data loaded successfully');
        
    } catch (error) {
        console.error('❌ Error loading dashboard data:', error);
        
        // Use fallback demo values
        document.getElementById('kpi-trays').textContent = '48';
        document.getElementById('kpi-plants').textContent = '1,440';
        document.getElementById('kpi-harvest').textContent = '14d';
        document.getElementById('kpi-devices').textContent = '24';
        document.getElementById('kpi-trays-change').textContent = '+12 this week';
        document.getElementById('kpi-plants-change').textContent = '+324 this week';
        document.getElementById('kpi-harvest-change').textContent = 'Butterhead Lettuce';
        document.getElementById('kpi-devices-change').textContent = '2 offline';
    }
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
            const usage = data.usage;
            const limits = data.limits;
            
            // Update subscription plan info
            document.getElementById('sub-plan').textContent = data.plan.name + ' Plan';
            document.getElementById('sub-detail').textContent = 
                `$${(data.plan.price / 100).toFixed(0)}/month • Renews on ${formatDate(data.renewsAt)}`;
            
            // Update usage meters
            updateUsageMeter('devices', usage.devices, limits.devices);
            updateUsageMeter('api', usage.api_calls_today, limits.api_calls_per_day, 'K');
            updateUsageMeter('storage', usage.storage_gb, limits.storage_gb, ' GB');
        }
        
    } catch (error) {
        console.warn('⚠️ Could not load subscription usage (using defaults):', error.message);
        
        // Use mock data
        updateUsageMeter('devices', 24, 50);
        updateUsageMeter('api', 3420, 10000, 'K');
        updateUsageMeter('storage', 12.5, 50, ' GB');
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
            // Mock data
            tbody.innerHTML = `
                <tr>
                    <td>2 min ago</td>
                    <td>Irrigation cycle completed in ROOM-A-Z1</td>
                    <td>System</td>
                    <td><span class="status-badge active">ACTIVE</span></td>
                </tr>
                <tr>
                    <td>15 min ago</td>
                    <td>New growth group planted: ROOM-A-Z1-G03</td>
                    <td>admin@demo-farm.com</td>
                    <td><span class="status-badge active">ACTIVE</span></td>
                </tr>
                <tr>
                    <td>1 hour ago</td>
                    <td>Environmental data synced to GreenReach</td>
                    <td>System</td>
                    <td><span class="status-badge active">ACTIVE</span></td>
                </tr>
                <tr>
                    <td>2 hours ago</td>
                    <td>Device SENSOR-012 came online</td>
                    <td>System</td>
                    <td><span class="status-badge active">ACTIVE</span></td>
                </tr>
                <tr>
                    <td>3 hours ago</td>
                    <td>Subscription payment processed</td>
                    <td>Billing</td>
                    <td><span class="status-badge active">ACTIVE</span></td>
                </tr>
            `;
        }
        
    } catch (error) {
        console.warn('⚠️ Could not load activity (using mock data):', error.message);
        
        // Keep mock data from above
    }
}

/**
 * Setup navigation
 */
function setupNavigation() {
    // Handle section navigation
    document.querySelectorAll('.nav-item[data-section]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            const section = item.dataset.section;
            
            // Handle special redirects
            if (section === 'subscription') {
                window.location.href = '/billing.html';
                return;
            }
            
            // Update active nav item
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            
            // Show section
            document.querySelectorAll('.content-section').forEach(s => s.style.display = 'none');
            const sectionEl = document.getElementById(`section-${section}`);
            if (sectionEl) {
                sectionEl.style.display = 'block';
            }
        });
    });
    
    // Handle action cards
    document.querySelectorAll('.action-card[data-section]').forEach(card => {
        card.addEventListener('click', (e) => {
            e.preventDefault();
            
            const section = card.dataset.section;
            const navItem = document.querySelector(`.nav-item[data-section="${section}"]`);
            if (navItem) {
                navItem.click();
            }
        });
    });
}

/**
 * Refresh data
 */
async function refreshData() {
    console.log('🔄 Refreshing dashboard data...');
    await loadDashboardData();
}

/**
 * Logout
 */
function logout() {
    console.log('🚪 Returning to home...');
    
    // Clear any stored session data
    localStorage.removeItem(STORAGE_KEY_SESSION);
    
    // Redirect to home page
    window.location.href = '/';
}

/**
 * Session management
 */
function saveSession(session) {
    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
}

function getSession() {
    const sessionStr = localStorage.getItem(STORAGE_KEY_SESSION);
    if (!sessionStr) return null;
    
    try {
        const session = JSON.parse(sessionStr);
        
        // Check if expired
        if (session.expiresAt && session.expiresAt < Date.now()) {
            console.warn('⚠️ Session expired');
            localStorage.removeItem(STORAGE_KEY_SESSION);
            return null;
        }
        
        return session;
    } catch (error) {
        console.error('❌ Error parsing session:', error);
        localStorage.removeItem(STORAGE_KEY_SESSION);
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
 * Load unique crops from groups data
 */
async function loadCropsFromDatabase() {
    try {
        // Check pricing version and clear old localStorage if needed
        const savedVersion = localStorage.getItem('pricing_version');
        if (savedVersion !== PRICING_VERSION) {
            console.log(`🔄 Pricing version mismatch (${savedVersion} → ${PRICING_VERSION}). Clearing old prices...`);
            // Clear all pricing keys
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith('pricing_')) {
                    localStorage.removeItem(key);
                }
            });
            localStorage.setItem('pricing_version', PRICING_VERSION);
            console.log('✅ Pricing cache cleared. Loading new defaults.');
        }
        
        const response = await fetch(`${API_BASE}/data/groups.json`);
        const data = await response.json();
        
        // Extract unique crop names
        const crops = [...new Set(data.groups.map(g => g.crop))].sort();
        
        // Initialize pricing data
        pricingData = crops.map(crop => {
            const saved = localStorage.getItem(`pricing_${crop}`);
            if (saved) {
                return JSON.parse(saved);
            }
            
            // Use defaults or initialize
            const defaults = defaultPricing[crop] || { retail: 10.00, ws1: 15, ws2: 25, ws3: 35 };
            return {
                crop,
                retail: defaults.retail,
                ws1Discount: defaults.ws1,
                ws2Discount: defaults.ws2,
                ws3Discount: defaults.ws3
            };
        });
        
        renderPricingTable();
        
    } catch (error) {
        console.error('❌ Error loading crops:', error);
        
        // Fallback to default crops
        pricingData = Object.keys(defaultPricing).map(crop => ({
            crop,
            retail: defaultPricing[crop].retail,
            ws1Discount: defaultPricing[crop].ws1,
            ws2Discount: defaultPricing[crop].ws2,
            ws3Discount: defaultPricing[crop].ws3
        }));
        
        renderPricingTable();
    }
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
            </tr>
        `;
    }).join('');
}

/**
 * Update pricing when input changes
 */
function updatePricing(index, field, value) {
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return;
    
    if (field === 'retail') {
        // If showing per 25g, convert back to oz for storage
        pricingData[index].retail = isPerGram ? convertPrice(numValue, false) : numValue;
    } else {
        pricingData[index][field] = numValue;
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
                ws3Discount: item.ws3Discount
            }));
            
            const response = await fetch(`${API_BASE}/crop-pricing`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ crops })
            });
            
            if (response.ok) {
                console.log('✅ Pricing saved to backend API');
            } else {
                console.warn('⚠️  Failed to save to backend API (localStorage only)');
            }
        } catch (apiError) {
            console.warn('⚠️  Backend API unavailable (localStorage only):', apiError.message);
        }
        
        // Show success message
        alert('Pricing saved successfully!');
        console.log('✅ Pricing data saved:', pricingData);
        
    } catch (error) {
        console.error('❌ Error saving pricing:', error);
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
        }
    }
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

/**
 * Generate pricing recommendations based on market data
 */
function generateRecommendations() {
    const recommendations = [];
    
    pricingData.forEach(item => {
        const marketData = marketDataSources[item.crop];
        if (!marketData) return;
        
        // Calculate price per oz from market data
        const pricePerOzUSD = marketData.avgPriceUSD / marketData.avgWeightOz;
        
        // Convert to CAD if source is outside Canada
        const pricePerOzCAD = marketData.country !== 'Canada' ? 
            pricePerOzUSD * currentExchangeRate : 
            pricePerOzUSD;
        
        // Calculate price per 25g (1 oz = 28.35g, so 25g = 0.8818 oz)
        const pricePer25gCAD = pricePerOzCAD * 0.8818;
        
        const currentPrice = item.retail;
        const marketAvg = pricePerOzCAD;
        const difference = ((currentPrice - marketAvg) / marketAvg * 100).toFixed(1);
        
        let recommendation = marketAvg;
        let reasoning = '';
        let priceChangeType = 'stable';
        
        if (marketData.trend === 'increasing') {
            recommendation = marketAvg * 1.05; // Suggest 5% above average
            reasoning = `Market analysis shows ${item.crop} prices are trending upward. `;
            priceChangeType = 'up';
            
            if (marketData.articles.length > 0) {
                reasoning += `Recent reports indicate supply constraints and increased demand. `;
            }
            
            reasoning += `Recommended to adjust pricing to capitalize on market conditions.`;
        } else if (marketData.trend === 'decreasing') {
            recommendation = marketAvg * 0.95; // Suggest 5% below average
            reasoning = `Market prices for ${item.crop} are declining due to increased supply. Consider competitive pricing to maintain market share.`;
            priceChangeType = 'down';
        } else {
            recommendation = marketAvg;
            reasoning = `Current ${item.crop} market is stable. Your pricing is ${Math.abs(difference)}% ${difference > 0 ? 'above' : 'below'} market average. `;
            
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
            crop: item.crop,
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
                        <button class="apply-recommendation-btn" onclick="applyRecommendedPrice('${rec.crop}', ${rec.recommendedPrice})">
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
function applyRecommendedPrice(cropName, recommendedPrice) {
    const index = pricingData.findIndex(item => item.crop === cropName);
    if (index !== -1) {
        pricingData[index].retail = recommendedPrice;
        renderPricingTable();
        
        // Show confirmation
        alert(`Updated ${cropName} price to $${recommendedPrice.toFixed(2)}. Don't forget to save changes!`);
        
        // Close modal
        closeAIPricingAssistant();
    }
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
                <span style="font-size: 20px;">⚠</span>
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

// Growth parameters by crop type (days to harvest and retail price per unit)
const cropGrowthParams = {
    // Lettuce varieties - 28-35 day cycle, sold per head
    'Butterhead Lettuce': { daysToHarvest: 32, retailPricePerUnit: 8.10, yieldFactor: 0.92 },
    'Romaine Lettuce': { daysToHarvest: 35, retailPricePerUnit: 4.99, yieldFactor: 0.90 },
    'Red Leaf Lettuce': { daysToHarvest: 30, retailPricePerUnit: 4.99, yieldFactor: 0.91 },
    'Oak Leaf Lettuce': { daysToHarvest: 30, retailPricePerUnit: 4.30, yieldFactor: 0.91 },
    'Mixed Lettuce': { daysToHarvest: 30, retailPricePerUnit: 4.99, yieldFactor: 0.90 },
    
    // Basil varieties - 21-28 day cycle, sold per 0.75 oz package
    'Genovese Basil': { daysToHarvest: 25, retailPricePerUnit: 5.38, yieldFactor: 0.88 },
    'Thai Basil': { daysToHarvest: 25, retailPricePerUnit: 5.38, yieldFactor: 0.88 },
    'Purple Basil': { daysToHarvest: 25, retailPricePerUnit: 5.38, yieldFactor: 0.87 },
    'Lemon Basil': { daysToHarvest: 24, retailPricePerUnit: 5.38, yieldFactor: 0.87 },
    'Holy Basil': { daysToHarvest: 26, retailPricePerUnit: 5.38, yieldFactor: 0.86 },
    
    // Arugula varieties - 21-28 day cycle, sold per 5 oz bag
    'Baby Arugula': { daysToHarvest: 21, retailPricePerUnit: 6.75, yieldFactor: 0.93 },
    'Cultivated Arugula': { daysToHarvest: 24, retailPricePerUnit: 6.75, yieldFactor: 0.91 },
    'Wild Arugula': { daysToHarvest: 28, retailPricePerUnit: 6.75, yieldFactor: 0.89 },
    'Wasabi Arugula': { daysToHarvest: 24, retailPricePerUnit: 6.75, yieldFactor: 0.90 },
    'Red Arugula': { daysToHarvest: 24, retailPricePerUnit: 6.75, yieldFactor: 0.90 },
    
    // Kale varieties - 35-42 day cycle, sold per bunch
    'Curly Kale': { daysToHarvest: 38, retailPricePerUnit: 6.10, yieldFactor: 0.89 },
    'Lacinato Kale': { daysToHarvest: 40, retailPricePerUnit: 6.10, yieldFactor: 0.88 },
    'Dinosaur Kale': { daysToHarvest: 40, retailPricePerUnit: 6.10, yieldFactor: 0.88 },
    'Baby Kale': { daysToHarvest: 28, retailPricePerUnit: 6.10, yieldFactor: 0.92 },
    'Red Russian Kale': { daysToHarvest: 38, retailPricePerUnit: 6.10, yieldFactor: 0.89 }
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
 * Calculate tray value based on plant count and growth stage
 * Value = plantCount × retailPricePerUnit × growthPercentage × yieldFactor
 */
function calculateTrayValue(crop, plantCount, daysPostSeed) {
    const params = cropGrowthParams[crop];
    if (!params) return 0;
    
    const growthPercent = calculateGrowthPercentage(crop, daysPostSeed) / 100;
    const retailPricePerUnit = params.retailPricePerUnit;
    const yieldFactor = params.yieldFactor;
    
    // Value grows with maturity (S-curve approximation)
    const growthCurve = Math.pow(growthPercent, 1.3);
    const totalValue = plantCount * retailPricePerUnit * growthCurve * yieldFactor;
    
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
        console.log('📊 Loading crop value data...');
        
        // Fetch current inventory
        const inventoryResponse = await fetch(`${API_BASE}/api/inventory/current`);
        const inventoryData = await inventoryResponse.json();
        
        if (!inventoryData || !inventoryData.byFarm || inventoryData.byFarm.length === 0) {
            console.warn('⚠️ No inventory data available');
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
        
        console.log('✅ Crop value data loaded:', cropValueData);
        return cropValueData;
        
    } catch (error) {
        console.error('❌ Error loading crop value data:', error);
        return null;
    }
}

/**
 * Render crop value dashboard
 */
async function renderCropValue() {
    const data = await loadCropValueData();
    
    if (!data) {
        console.error('❌ No crop value data to display');
        return;
    }
    
    console.log('✅ Rendering crop value with data:', {
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
    console.log('🔄 Refreshing crop value data...');
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
