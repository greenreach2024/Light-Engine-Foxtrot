/**
 * GreenReach Admin Dashboard
 * Central management for Light Engine platform
 */

const API_BASE = window.location.origin.replace(':8091', ':8000');

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    console.log(' Initializing admin dashboard...');
    await loadDashboardData();
});

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

// Auto-refresh metrics every 30 seconds
setInterval(() => {
    console.log(' Auto-refreshing metrics...');
    updateMetrics();
}, 30000);
