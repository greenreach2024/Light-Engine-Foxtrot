/**
 * GreenReach Admin Dashboard
 * Central management for Light Engine platform
 */

// Suppress noisy console.log messages in production by default.
// Enable via localStorage.setItem('gr.debug','true') or when running on localhost.
(function () {
  try {
    const _origConsoleLog = console.log.bind(console);
    console.log = function(...args) {
      const enabled = localStorage.getItem('gr.debug') === 'true' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (enabled) {
        _origConsoleLog(...args);
      }
    };
  } catch (e) {
    // ignore
  }
})();

const API_BASE = window.location.origin.replace(':8091', ':8000');

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Initializing admin dashboard...');
    
    // Check authentication - redirect if not authenticated
    if (!isAuthenticated()) {
        console.warn('⚠️ Not authenticated, redirecting to login...');
        window.location.href = '/login.html?redirect=' + encodeURIComponent(window.location.pathname);
        return;
    }
    
    // Only auto-authenticate in localhost development
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        await autoAuthenticateLocal();
    }
    
    await loadDashboardData();
});

/**
 * Check if user is authenticated
 */
function isAuthenticated() {
    const token = localStorage.getItem('adminAuthToken');
    return token && token.length > 0;
}

/**
 * Auto-authenticate for LOCAL DEVELOPMENT ONLY
 * Automatically logs in with demo credentials on localhost
 */
async function autoAuthenticateLocal() {
    // Check if already authenticated
    const existingToken = localStorage.getItem('adminAuthToken');
    if (existingToken) {
        console.log('✅ Already authenticated');
        return;
    }
    
    // Auto-login with demo credentials (localhost only)
    console.log('🔐 Auto-authenticating in local development mode...');
    
    const credentials = {
        farm_id: 'GR-00001',
        email: 'admin@demo-farm.com',
        password: 'demo123'
    };
    
    try {
        const response = await fetch(`${window.location.origin}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(credentials)
        });
        
        if (response.ok) {
            const data = await response.json();
            localStorage.setItem('adminAuthToken', data.token);
            localStorage.setItem('farm_id', data.farmId);
            localStorage.setItem('adminEmail', data.email);
            // Clean up legacy keys
            localStorage.removeItem('adminFarmId');
            localStorage.removeItem('farmId');
            console.log('✅ Auto-authentication successful');
        } else {
            console.warn('⚠️ Auto-authentication failed');
            // Redirect to login if auto-auth fails
            window.location.href = '/login.html';
        }
    } catch (error) {
        console.warn('⚠️ Auto-authentication error:', error.message);
        window.location.href = '/login.html';
    }
}

/**
 * Switch between tabs
 */
function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.classList.add('active');

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}-content`).classList.add('active');

    console.log(`📑 Switched to ${tabName} tab`);
}

/**
 * Load dashboard data
 */
async function loadDashboardData() {
    try {
        // In production, these would be real API calls
        console.log(' Loading dashboard data...');
        
        // Simulate API calls
        updateMetrics();
        loadTenants();
        
        // Load fleet health monitoring
        await loadFleetHealth();
        
    } catch (error) {
        console.error(' Error loading dashboard data:', error);
    }
}

/**
 * Update key metrics
 */
function updateMetrics() {
    // These would come from backend aggregation
    const metrics = {
        totalTenants: 24,
        totalRevenue: '$4,847',
        activeSubscriptions: 21,
        totalDevices: 312,
        totalApiCalls: '1.2M',
        totalStorage: '186 GB'
    };

    document.getElementById('totalTenants').textContent = metrics.totalTenants;
    document.getElementById('totalRevenue').textContent = metrics.totalRevenue;
    document.getElementById('activeSubscriptions').textContent = metrics.activeSubscriptions;
    document.getElementById('totalDevices').textContent = metrics.totalDevices;
    document.getElementById('totalApiCalls').textContent = metrics.totalApiCalls;
    document.getElementById('totalStorage').textContent = metrics.totalStorage;
}

/**
 * Load tenants list
 */
async function loadTenants() {
    // In production, this would fetch from /api/admin/tenants
    console.log('👥 Loading tenants...');
    
    // Sample data is already in HTML
    // In production, we'd populate tenantsTableBody dynamically
}

/**
 * Filter tenants by search query
 */
function filterTenants() {
    const query = document.getElementById('tenantSearch').value.toLowerCase();
    const rows = document.querySelectorAll('#tenantsTableBody tr');
    
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(query) ? '' : 'none';
    });
}

/**
 * View tenant details
 */
function viewTenant(tenantId) {
    console.log(` Viewing tenant: ${tenantId}`);
    
    // In production, redirect to tenant detail page or open modal
    alert(`View details for tenant: ${tenantId}\n\nIn production, this would show:\n- Subscription history\n- Usage analytics\n- Device list\n- Payment history\n- Support tickets`);
}

/**
 * Create new tenant
 */
function createTenant() {
    console.log('➕ Creating new tenant...');
    
    const name = prompt('Enter tenant name:');
    if (!name) return;
    
    const email = prompt('Enter admin email:');
    if (!email) return;
    
    // In production, POST to /api/admin/tenants
    console.log(' Creating tenant:', { name, email });
    
    alert(` Tenant created successfully!\n\nName: ${name}\nEmail: ${email}\n\nIn production, this would:\n1. Create tenant record\n2. Send welcome email\n3. Generate API keys\n4. Start trial period`);
}

/**
 * Export data to CSV
 */
function exportToCSV(tabName) {
    console.log(`📥 Exporting ${tabName} to CSV...`);
    
    // In production, generate CSV from table data
    alert(`CSV export for ${tabName}\n\nIn production, this would download a CSV file with all data from the current view.`);
}

/**
 * Manage billing for admin view
 */
function manageBilling() {
    window.location.href = '/LE-billing.html';
}

/**
 * Load fleet health from all registered farms
 */
async function loadFleetHealth() {
    const container = document.getElementById('fleetHealthContent');
    const refreshBtn = document.getElementById('fleetRefreshBtn');
    
    if (!container) return;
    
    try {
        // Disable refresh button
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.textContent = '↻ Loading...';
        }
        
        container.innerHTML = '<div style="text-align: center; padding: 2rem; color: #9ca3af;"><div style="font-size: 1rem; font-weight: 600; margin-bottom: 1rem;">Loading fleet health data...</div></div>';
        
        const response = await fetch('/api/admin/health/fleet');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        
        if (!data.ok) {
            throw new Error(data.message || 'Failed to load fleet health');
        }
        
        const fleet = data.fleet;
        
        // Determine grade class
        let gradeClass = 'poor';
        if (fleet.fleet_score >= 90) gradeClass = 'excellent';
        else if (fleet.fleet_score >= 80) gradeClass = 'good';
        else if (fleet.fleet_score >= 70) gradeClass = 'fair';
        
        // Determine score color
        let scoreColor = '#fca5a5'; // poor
        if (fleet.fleet_score >= 90) scoreColor = '#86efac'; // excellent
        else if (fleet.fleet_score >= 80) scoreColor = '#93c5fd'; // good
        else if (fleet.fleet_score >= 70) scoreColor = '#fdba74'; // fair
        
        // Build farms grid
        let farmsHTML = '';
        if (data.farms && data.farms.length > 0) {
            farmsHTML = '<div class="farm-health-grid">';
            data.farms.forEach(farm => {
                let farmScoreColor = '#fca5a5';
                let farmGradeClass = 'poor';
                
                if (farm.online) {
                    if (farm.health.score >= 90) {
                        farmScoreColor = '#86efac';
                        farmGradeClass = 'excellent';
                    } else if (farm.health.score >= 80) {
                        farmScoreColor = '#93c5fd';
                        farmGradeClass = 'good';
                    } else if (farm.health.score >= 70) {
                        farmScoreColor = '#fdba74';
                        farmGradeClass = 'fair';
                    }
                }
                
                const statusBadge = farm.online 
                    ? '<span class="farm-status-badge online">● Online</span>'
                    : '<span class="farm-status-badge offline">● Offline</span>';
                
                const cardClass = farm.online ? '' : ' offline';
                
                farmsHTML += `
                    <div class="farm-health-card${cardClass}">
                        <div class="farm-health-header">
                            <div>
                                <div class="farm-health-name">${farm.name}</div>
                                <div class="farm-health-meta">${farm.location} • ${farm.size}</div>
                                <div style="margin-top: 0.5rem;">${statusBadge}</div>
                            </div>
                            <div class="farm-health-score">
                                <div class="farm-score-value" style="color: ${farmScoreColor};">
                                    ${farm.health.score}<span style="font-size: 1rem; color: #64748b;">/100</span>
                                </div>
                                <span class="farm-grade-small ${farmGradeClass}" style="
                                    color: ${farmScoreColor};
                                    border-color: ${farmScoreColor};
                                    background: ${farmGradeClass === 'excellent' ? 'rgba(34, 197, 94, 0.1)' : 
                                                   farmGradeClass === 'good' ? 'rgba(59, 130, 246, 0.1)' : 
                                                   farmGradeClass === 'fair' ? 'rgba(251, 146, 60, 0.1)' : 
                                                   'rgba(239, 68, 68, 0.1)'};
                                ">${farm.health.grade}</span>
                            </div>
                        </div>
                        ${farm.online ? `
                        <div class="farm-health-zones">
                            <span><strong>${farm.health.total_zones}</strong> zones</span>
                            <span>•</span>
                            <span style="color: #86efac;">${farm.health.excellent} excellent</span>
                            <span style="color: #93c5fd;">${farm.health.good} good</span>
                            <span style="color: #fdba74;">${farm.health.fair} fair</span>
                            <span style="color: #fca5a5;">${farm.health.poor} poor</span>
                        </div>
                        ` : `
                        <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid rgba(148, 163, 184, 0.2); font-size: 0.75rem; color: #9ca3af;">
                            ${farm.health.message || 'Farm offline or unreachable'}
                        </div>
                        `}
                    </div>
                `;
            });
            farmsHTML += '</div>';
        }
        
        // Build insights
        let insightsHTML = '';
        if (fleet.insights && fleet.insights.length > 0) {
            insightsHTML = `
                <div class="fleet-insights">
                    <h3>Fleet Insights</h3>
                    ${fleet.insights.map(insight => `<div class="fleet-insight-item">${insight}</div>`).join('')}
                </div>
            `;
        }
        
        container.innerHTML = `
            <div class="fleet-score-display">
                <div class="fleet-score-main">
                    <div class="fleet-score-number" style="color: ${scoreColor};">
                        ${fleet.fleet_score}<span style="font-size: 2rem; color: #64748b;">/100</span>
                    </div>
                    <div>
                        <div class="fleet-grade-badge ${gradeClass}">${fleet.fleet_grade}</div>
                        <div style="margin-top: 0.5rem; font-size: 0.875rem; color: #94a3b8;">Fleet Health Score</div>
                    </div>
                </div>
                <div style="text-align: right; color: #94a3b8; font-size: 0.875rem;">
                    <div style="margin-bottom: 0.5rem;">
                        <strong>${fleet.online_farms}/${fleet.total_farms}</strong> farms online
                    </div>
                    <div style="margin-bottom: 0.5rem;">
                        <strong>${fleet.total_zones}</strong> zones monitored
                    </div>
                    ${fleet.farms_needing_attention > 0 ? `
                        <div style="color: #fca5a5; font-weight: 600;">
                            Alert: ${fleet.farms_needing_attention} farm${fleet.farms_needing_attention > 1 ? 's' : ''} need attention
                        </div>
                    ` : ''}
                </div>
            </div>
            
            ${farmsHTML}
            ${insightsHTML}
        `;
        
        console.log(` Fleet health loaded: ${fleet.fleet_score}/100 (${fleet.fleet_grade})`);
        
    } catch (error) {
        console.error('Failed to load fleet health:', error);
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: #9ca3af;">
                <div style="font-size: 1rem; font-weight: 600; margin-bottom: 0.5rem; color: #fca5a5;">Failed to Load Fleet Health</div>
                <div style="font-size: 0.875rem;">${error.message}</div>
            </div>
        `;
    } finally {
        // Re-enable refresh button
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.textContent = '↻ Refresh';
        }
    }
}

// Auto-refresh metrics every 30 seconds
setInterval(() => {
    console.log(' Auto-refreshing metrics...');
    updateMetrics();
}, 30000);
