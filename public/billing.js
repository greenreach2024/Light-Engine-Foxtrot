/**
 * Billing & Subscription Management
 * Light Engine Charlie
 */

const API_BASE = window.location.origin.replace(':8091', ':8000');
const TENANT_ID = 'sandbox-test-tenant';

let selectedPlan = null;
let currentSubscription = null;
let usageData = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Initializing billing page...');
    await loadPlans();
    await loadUsage();
    await loadSubscription();
});

/**
 * Load available subscription plans
 */
async function loadPlans() {
    try {
        const response = await fetch(`${API_BASE}/api/billing/plans`);
        const data = await response.json();
        
        if (data.status === 'success') {
            console.log('✅ Loaded plans:', data.plans);
            renderPlans(data.plans);
        }
    } catch (error) {
        console.error('❌ Error loading plans:', error);
    }
}

/**
 * Render subscription plans in grid
 */
function renderPlans(plans) {
    const grid = document.getElementById('plans-grid');
    grid.innerHTML = '';

    plans.forEach(plan => {
        const card = document.createElement('div');
        card.className = 'card plan-card';
        card.onclick = () => selectPlan(plan);
        
        card.innerHTML = `
            <div class="plan-header">
                <div class="plan-name">${plan.name}</div>
                ${plan.plan_id === 'pro' ? '<span class="status-badge active">POPULAR</span>' : ''}
            </div>
            <div class="plan-price">
                $${(plan.price / 100).toFixed(0)}<small>/month</small>
            </div>
            <ul class="plan-features">
                <li>
                    <span class="feature-label">Devices</span>
                    <span class="feature-value">${plan.limits.devices}</span>
                </li>
                <li>
                    <span class="feature-label">API Calls/Day</span>
                    <span class="feature-value">${plan.limits.api_calls_per_day.toLocaleString()}</span>
                </li>
                <li>
                    <span class="feature-label">Storage</span>
                    <span class="feature-value">${plan.limits.storage_gb} GB</span>
                </li>
            </ul>
            <div style="font-size: 12px; color: #9ca3af; margin-top: 15px;">
                <strong>Overage rates:</strong><br>
                • Device: $${(plan.overage_rates.device / 100).toFixed(2)}/mo<br>
                • API calls: $${(plan.overage_rates.api_calls_1000 / 100).toFixed(2)}/1K<br>
                • Storage: $${(plan.overage_rates.storage_gb / 100).toFixed(2)}/GB
            </div>
        `;
        
        grid.appendChild(card);
    });
}

/**
 * Select a plan
 */
function selectPlan(plan) {
    selectedPlan = plan;
    
    // Update UI
    document.querySelectorAll('.plan-card').forEach(card => {
        card.classList.remove('selected');
    });
    event.currentTarget.classList.add('selected');
    
    document.getElementById('select-plan-btn').disabled = false;
    
    console.log('✅ Selected plan:', plan.name);
}

/**
 * Show plan selection modal
 */
function showPlanSelection() {
    document.getElementById('plan-modal').classList.add('active');
}

/**
 * Close plan modal
 */
function closePlanModal() {
    document.getElementById('plan-modal').classList.remove('active');
    selectedPlan = null;
    document.querySelectorAll('.plan-card').forEach(card => {
        card.classList.remove('selected');
    });
    document.getElementById('select-plan-btn').disabled = true;
}

/**
 * Proceed to payment
 */
function proceedToPayment() {
    if (!selectedPlan) return;
    
    closePlanModal();
    
    // Show plan summary
    document.getElementById('selected-plan-summary').innerHTML = `
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid var(--primary-color); border-radius: 6px; padding: 15px; margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="font-size: 18px; font-weight: bold;">${selectedPlan.name} Plan</div>
                    <div style="font-size: 12px; color: #9ca3af; margin-top: 5px;">
                        ${selectedPlan.limits.devices} devices • ${selectedPlan.limits.api_calls_per_day.toLocaleString()} API calls/day • ${selectedPlan.limits.storage_gb} GB storage
                    </div>
                </div>
                <div style="font-size: 24px; font-weight: bold; color: var(--primary-color);">
                    $${(selectedPlan.price / 100).toFixed(2)}/mo
                </div>
            </div>
        </div>
    `;
    
    // Pre-fill test data
    document.getElementById('customer-email').value = 'sandbox@lightengine.io';
    document.getElementById('customer-firstname').value = 'Sandbox';
    document.getElementById('customer-lastname').value = 'Test';
    document.getElementById('card-number').value = '4111 1111 1111 1111';
    document.getElementById('card-expiry').value = '12/26';
    document.getElementById('card-cvv').value = '111';
    document.getElementById('card-postal').value = '94103';
    
    document.getElementById('payment-modal').classList.add('active');
}

/**
 * Close payment modal
 */
function closePaymentModal() {
    document.getElementById('payment-modal').classList.remove('active');
    document.getElementById('payment-status').style.display = 'none';
}

/**
 * Process payment
 */
async function processPayment() {
    const payBtn = document.getElementById('pay-btn');
    const statusDiv = document.getElementById('payment-status');
    
    // Get form data
    const email = document.getElementById('customer-email').value;
    const firstName = document.getElementById('customer-firstname').value;
    const lastName = document.getElementById('customer-lastname').value;
    
    // Validate
    if (!email || !firstName || !lastName) {
        showPaymentStatus('error', 'Please fill in all fields');
        return;
    }
    
    if (!selectedPlan) {
        showPaymentStatus('error', 'No plan selected');
        return;
    }
    
    payBtn.disabled = true;
    payBtn.textContent = 'Processing...';
    statusDiv.style.display = 'none';
    
    try {
        // Step 1: Create customer
        console.log('📝 Creating customer...');
        const customerResponse = await fetch(`${API_BASE}/api/billing/customers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email,
                first_name: firstName,
                last_name: lastName,
                tenant_id: TENANT_ID
            })
        });
        
        const customerData = await customerResponse.json();
        
        if (customerData.status !== 'success') {
            throw new Error('Failed to create customer');
        }
        
        console.log('✅ Customer created:', customerData.customer.customer_id);
        
        // Step 2: Create subscription
        console.log('📝 Creating subscription...');
        const subscriptionResponse = await fetch(`${API_BASE}/api/billing/subscriptions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customer_id: customerData.customer.customer_id,
                plan_id: selectedPlan.plan_id,
                card_id: 'sandbox-card-token'  // Sandbox mode
            })
        });
        
        const subscriptionData = await subscriptionResponse.json();
        
        if (subscriptionData.status !== 'success') {
            throw new Error('Failed to create subscription');
        }
        
        console.log('✅ Subscription created:', subscriptionData.subscription.subscription_id);
        
        // Success!
        showPaymentStatus('success', `🎉 Successfully subscribed to ${selectedPlan.name} plan!`);
        
        setTimeout(() => {
            closePaymentModal();
            loadSubscription();
            loadUsage();
        }, 2000);
        
    } catch (error) {
        console.error('❌ Payment error:', error);
        showPaymentStatus('error', error.message || 'Payment failed. Please try again.');
        payBtn.disabled = false;
        payBtn.textContent = 'Subscribe Now';
    }
}

/**
 * Show payment status message
 */
function showPaymentStatus(type, message) {
    const statusDiv = document.getElementById('payment-status');
    statusDiv.className = `payment-status ${type}`;
    statusDiv.textContent = message;
    statusDiv.style.display = 'block';
}

/**
 * Load current subscription
 */
async function loadSubscription() {
    // Simulate subscription data (would come from backend)
    const hasSubscription = localStorage.getItem('sandbox_subscription');
    
    if (hasSubscription) {
        const subscription = JSON.parse(hasSubscription);
        currentSubscription = subscription;
        renderSubscription(subscription);
    }
}

/**
 * Render current subscription
 */
function renderSubscription(subscription) {
    const detailsDiv = document.getElementById('subscription-details');
    
    detailsDiv.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <div>
                <div style="font-size: 24px; font-weight: bold; margin-bottom: 5px;">
                    ${subscription.plan.name} Plan
                </div>
                <span class="status-badge ${subscription.status}">${subscription.status.toUpperCase()}</span>
            </div>
            <div style="text-align: right;">
                <div style="font-size: 32px; font-weight: bold; color: var(--primary-color);">
                    $${(subscription.plan.price / 100).toFixed(2)}
                </div>
                <div style="font-size: 12px; color: #9ca3af;">per month</div>
            </div>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 20px;">
            <div>
                <div style="font-size: 12px; color: #9ca3af;">Devices</div>
                <div style="font-size: 18px; font-weight: bold;">${subscription.plan.limits.devices}</div>
            </div>
            <div>
                <div style="font-size: 12px; color: #9ca3af;">API Calls/Day</div>
                <div style="font-size: 18px; font-weight: bold;">${subscription.plan.limits.api_calls_per_day.toLocaleString()}</div>
            </div>
            <div>
                <div style="font-size: 12px; color: #9ca3af;">Storage</div>
                <div style="font-size: 18px; font-weight: bold;">${subscription.plan.limits.storage_gb} GB</div>
            </div>
        </div>
        
        <div style="display: flex; gap: 10px;">
            <button class="btn btn-secondary" onclick="upgradePlan()">Upgrade Plan</button>
            <button class="btn btn-danger" onclick="cancelSubscription()">Cancel Subscription</button>
        </div>
    `;
    
    document.getElementById('usage-section').style.display = 'grid';
    document.getElementById('usage-details').style.display = 'block';
}

/**
 * Load usage metrics
 */
async function loadUsage() {
    try {
        const response = await fetch(`${API_BASE}/api/billing/usage/${TENANT_ID}?days=1`);
        const data = await response.json();
        
        if (data.status === 'success' || data.status === 'partial') {
            usageData = data.usage;
            renderUsage(data.usage);
            
            // Load overage if subscription exists
            if (currentSubscription) {
                await loadOverage();
            }
        }
    } catch (error) {
        console.error('❌ Error loading usage:', error);
        // Use mock data
        usageData = {
            devices: 12,
            api_calls_total: 1600,
            storage_gb: 6.5
        };
        renderUsage(usageData);
    }
}

/**
 * Render usage metrics
 */
function renderUsage(usage) {
    const plan = currentSubscription ? currentSubscription.plan : {
        limits: {
            devices: 10,
            api_calls_per_day: 1000,
            storage_gb: 5
        }
    };
    
    // Update stat cards
    document.getElementById('stat-devices').textContent = usage.devices || 0;
    document.getElementById('stat-devices-limit').textContent = `of ${plan.limits.devices}`;
    
    document.getElementById('stat-api-calls').textContent = (usage.api_calls_total || 0).toLocaleString();
    document.getElementById('stat-api-calls-limit').textContent = `of ${plan.limits.api_calls_per_day.toLocaleString()}`;
    
    document.getElementById('stat-storage').textContent = `${(usage.storage_gb || 0).toFixed(1)} GB`;
    document.getElementById('stat-storage-limit').textContent = `of ${plan.limits.storage_gb} GB`;
    
    // Update usage bars
    updateUsageBar('devices', usage.devices || 0, plan.limits.devices);
    updateUsageBar('api-calls', usage.api_calls_total || 0, plan.limits.api_calls_per_day);
    updateUsageBar('storage', usage.storage_gb || 0, plan.limits.storage_gb);
}

/**
 * Update usage bar
 */
function updateUsageBar(type, current, limit) {
    const percentage = Math.min((current / limit) * 100, 100);
    const bar = document.getElementById(`${type}-bar`);
    const label = document.getElementById(`${type}-usage`);
    
    bar.style.width = `${percentage}%`;
    
    // Color coding
    bar.className = 'usage-fill';
    if (percentage >= 100) {
        bar.classList.add('danger');
    } else if (percentage >= 80) {
        bar.classList.add('warning');
    }
    
    // Update label
    if (type === 'storage') {
        label.textContent = `${current.toFixed(1)} / ${limit} GB`;
    } else {
        label.textContent = `${current.toLocaleString()} / ${limit.toLocaleString()}`;
    }
}

/**
 * Load overage calculation
 */
async function loadOverage() {
    try {
        const response = await fetch(`${API_BASE}/api/billing/overage/${TENANT_ID}?plan_id=${currentSubscription.plan_id}`);
        const data = await response.json();
        
        if (data.status === 'success' && data.overage.total_overage_charge > 0) {
            showOverageWarning(data.overage);
        }
    } catch (error) {
        console.error('❌ Error loading overage:', error);
    }
}

/**
 * Show overage warning
 */
function showOverageWarning(overage) {
    const warningDiv = document.getElementById('overage-warning');
    const messageSpan = document.getElementById('overage-message');
    
    const overages = [];
    if (overage.overages.devices > 0) {
        overages.push(`${overage.overages.devices} extra devices ($${(overage.charges.devices / 100).toFixed(2)})`);
    }
    if (overage.overages.api_calls > 0) {
        overages.push(`${overage.overages.api_calls} extra API calls ($${(overage.charges.api_calls / 100).toFixed(2)})`);
    }
    if (overage.overages.storage_gb > 0) {
        overages.push(`${overage.overages.storage_gb.toFixed(1)} GB extra storage ($${(overage.charges.storage / 100).toFixed(2)})`);
    }
    
    messageSpan.textContent = `You're over your plan limits: ${overages.join(', ')}. Additional charge: ${overage.total_overage_charge_usd}`;
    warningDiv.style.display = 'flex';
}

/**
 * Upgrade plan
 */
function upgradePlan() {
    showPlanSelection();
}

/**
 * Cancel subscription
 */
async function cancelSubscription() {
    if (!confirm('Are you sure you want to cancel your subscription? Your access will continue until the end of the current billing period.')) {
        return;
    }
    
    console.log('🚫 Canceling subscription...');
    
    // Simulate cancellation
    localStorage.removeItem('sandbox_subscription');
    currentSubscription = null;
    
    document.getElementById('current-subscription').innerHTML = `
        <h2>📊 Current Subscription</h2>
        <div class="empty-state">
            <div class="empty-state-icon">📭</div>
            <p>No active subscription</p>
            <button class="btn btn-primary" onclick="showPlanSelection()">Subscribe Now</button>
        </div>
    `;
    
    document.getElementById('usage-section').style.display = 'none';
    document.getElementById('usage-details').style.display = 'none';
    
    alert('✅ Subscription canceled successfully.');
}

/**
 * Format card number as user types
 */
document.addEventListener('DOMContentLoaded', () => {
    const cardInput = document.getElementById('card-number');
    if (cardInput) {
        cardInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\s/g, '');
            let formattedValue = value.match(/.{1,4}/g)?.join(' ') || value;
            e.target.value = formattedValue;
        });
    }
    
    const expiryInput = document.getElementById('card-expiry');
    if (expiryInput) {
        expiryInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length >= 2) {
                value = value.slice(0, 2) + '/' + value.slice(2, 4);
            }
            e.target.value = value;
        });
    }
});

// Simulate successful subscription on payment
function simulateSubscriptionSuccess(plan) {
    const subscription = {
        subscription_id: 'sub_' + Date.now(),
        plan_id: plan.plan_id,
        plan: plan,
        status: 'active',
        created_at: new Date().toISOString()
    };
    
    localStorage.setItem('sandbox_subscription', JSON.stringify(subscription));
}
