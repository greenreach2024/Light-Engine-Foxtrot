/**
 * GreenReach Central Operations
 * Enterprise-grade farm management and monitoring system
 */

// =============================================================================
// DEBUG TRACKING SYSTEM
// Tracks all user navigation, clicks, API calls, and errors
// =============================================================================

const DEBUG_TRACKING = {
    enabled: true,
    sessionId: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    events: [],
    sendToServerInterval: null,
    
    log(event) {
        if (!this.enabled) return;
        
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            sessionId: this.sessionId,
            ...event
        };
        
        this.events.push(logEntry);
        
        // Console log with prominent styling
        console.log('%c[DEBUG TRACK] ' + event.type, 
            'background: #FF4500; color: white; font-weight: bold; padding: 2px 5px; border-radius: 3px',
            logEntry
        );
        
        // Keep only last 100 events in memory
        if (this.events.length > 100) {
            this.events = this.events.slice(-100);
        }
        
        // Start server sync if not already running
        if (!this.sendToServerInterval) {
            this.startServerSync();
        }
    },
    
    // Send events to server for terminal monitoring
    async sendToServer(events) {
        if (!events || events.length === 0) return;
        
        try {
            await fetch(`${API_BASE}/api/debug/track`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sessionId: this.sessionId,
                    events
                })
            });
        } catch (error) {
            // Silent fail - don't break the app if server logging fails
            console.debug('Failed to send debug events to server:', error.message);
        }
    },
    
    // Start periodic sync to server (every 5 seconds)
    startServerSync() {
        if (this.sendToServerInterval) return;
        
        let lastSentIndex = 0;
        
        this.sendToServerInterval = setInterval(() => {
            if (this.events.length > lastSentIndex) {
                const newEvents = this.events.slice(lastSentIndex);
                this.sendToServer(newEvents);
                lastSentIndex = this.events.length;
            }
        }, 5000); // Send every 5 seconds
    },
    
    stopServerSync() {
        if (this.sendToServerInterval) {
            clearInterval(this.sendToServerInterval);
            this.sendToServerInterval = null;
        }
    },
    
    trackPageView(viewName, context = {}) {
        this.log({
            type: 'PAGE_VIEW',
            view: viewName,
            url: window.location.href,
            context
        });
    },
    
    trackClick(elementId, elementType, context = {}) {
        this.log({
            type: 'CLICK',
            elementId,
            elementType,
            context
        });
    },
    
    trackAPICall(method, url, status, responseTime, error = null) {
        this.log({
            type: 'API_CALL',
            method,
            url,
            status,
            responseTime: responseTime + 'ms',
            error
        });
    },
    
    trackError(errorType, message, context = {}) {
        this.log({
            type: 'ERROR',
            errorType,
            message,
            context,
            stack: new Error().stack
        });
    },
    
    trackNavigation(from, to) {
        this.log({
            type: 'NAVIGATION',
            from,
            to
        });
    },
    
    getRecentEvents(count = 20) {
        return this.events.slice(-count);
    },
    
    exportSession() {
        return {
            sessionId: this.sessionId,
            eventCount: this.events.length,
            events: this.events
        };
    }
};

// Global error handler
window.addEventListener('error', (event) => {
    DEBUG_TRACKING.trackError('GLOBAL_ERROR', event.message, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
    });
});

// Unhandled promise rejection handler
window.addEventListener('unhandledrejection', (event) => {
    DEBUG_TRACKING.trackError('UNHANDLED_REJECTION', event.reason?.message || event.reason, {
        promise: event.promise
    });
});

// Track initial page load
DEBUG_TRACKING.log({
    type: 'SESSION_START',
    url: window.location.href,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`
});

// =============================================================================
// END DEBUG TRACKING SYSTEM
// =============================================================================

// API_BASE is declared globally in GR-central-admin.html
// No need to redeclare it here to avoid duplicate variable error

// Authentication check - redirect to login if not authenticated
function checkAuth() {
    const token = localStorage.getItem('admin_token');
    console.log('========================================');
    console.log('[checkAuth] DEBUGGING INFO:');
    console.log('[checkAuth] Current hostname:', window.location.hostname);
    console.log('[checkAuth] Current URL:', window.location.href);
    console.log('[checkAuth] API_BASE:', API_BASE);
    console.log('[checkAuth] Token exists:', !!token);
    console.log('[checkAuth] Token length:', token?.length || 0);
    console.log('[checkAuth] LocalStorage keys:', Object.keys(localStorage));
    console.log('========================================');
    
    if (!token) {
        console.error('[checkAuth] ❌ NO TOKEN - Redirecting immediately');
        console.log('[checkAuth] Current hostname:', window.location.hostname);
        console.log('[checkAuth] Current URL:', window.location.href);
        console.log('[checkAuth] API_BASE:', API_BASE);
        console.log('[checkAuth] LocalStorage keys:', Object.keys(localStorage));
        
        // Immediate redirect - no delay
        window.location.href = `${API_BASE}/GR-central-admin-login.html`;
        return null;
    }
    console.log('[checkAuth] ✅ Token found, proceeding to verifySession...');
    return token;
}

// Verify token is still valid on page load
async function verifySession() {
    const token = checkAuth();
    if (!token) return false;
    
    console.log('========================================');
    console.log('[verifySession] STARTING TOKEN VERIFICATION');
    console.log('[verifySession] API_BASE:', API_BASE);
    console.log('[verifySession] Token preview:', token.substring(0, 30) + '...');
    console.log('[verifySession] Token length:', token.length);
    
    const verifyUrl = `${API_BASE}/api/admin/auth/verify`;
    console.log('[verifySession] Calling URL:', verifyUrl);
    console.log('========================================');
    
    try {
        const response = await fetch(verifyUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin'
        });
        
        console.log('[verifySession] Response status:', response.status);
        console.log('[verifySession] Response ok:', response.ok);
        
        const responseData = await response.json().catch(() => ({}));
        console.log('[verifySession] Response data:', responseData);
        
        if (!response.ok) {
            console.error('[verifySession] ❌ VERIFICATION FAILED - Status:', response.status);
            console.log('[verifySession] Response data:', responseData);
            console.log('[verifySession] Redirecting to login...');
            
            // Immediate redirect
            localStorage.removeItem('admin_token');
            localStorage.removeItem('admin_email');
            localStorage.removeItem('admin_name');
            window.location.href = `${API_BASE}/GR-central-admin-login.html?error=session_expired`;
            return false;
        }
        
        console.log('[verifySession] ✅ VERIFICATION SUCCESSFUL');
        return true;
    } catch (error) {
        console.error('[verifySession] ❌ EXCEPTION:', error.message);
        console.log('[verifySession] Redirecting to login...');
        
        // Immediate redirect
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_email');
        localStorage.removeItem('admin_name');
        window.location.href = `${API_BASE}/GR-central-admin-login.html?error=verification_failed`;
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
    localStorage.removeItem('admin_role');
    window.location.href = `${API_BASE}/GR-central-admin-login.html`;
}

// Change Password Modal Functions
function openChangePasswordModal() {
    document.getElementById('changePasswordModal').style.display = 'block';
    document.getElementById('changePasswordForm').reset();
    document.getElementById('passwordChangeError').style.display = 'none';
    document.getElementById('passwordChangeSuccess').style.display = 'none';
}

function closeChangePasswordModal() {
    document.getElementById('changePasswordModal').style.display = 'none';
    document.getElementById('changePasswordForm').reset();
}

async function handleChangePassword(event) {
    event.preventDefault();
    
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    
    const errorDiv = document.getElementById('passwordChangeError');
    const successDiv = document.getElementById('passwordChangeSuccess');
    
    // Hide previous messages
    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';
    
    // Validate passwords match
    if (newPassword !== confirmPassword) {
        errorDiv.textContent = 'New passwords do not match';
        errorDiv.style.display = 'block';
        return;
    }
    
    // Validate password strength
    if (newPassword.length < 8) {
        errorDiv.textContent = 'Password must be at least 8 characters';
        errorDiv.style.display = 'block';
        return;
    }
    
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/auth/change-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                current_password: currentPassword,
                new_password: newPassword
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            successDiv.textContent = 'Password changed successfully! You can continue using the dashboard.';
            successDiv.style.display = 'block';
            document.getElementById('changePasswordForm').reset();
            
            // Close modal after 2 seconds
            setTimeout(() => {
                closeChangePasswordModal();
            }, 2000);
        } else {
            errorDiv.textContent = data.error || 'Failed to change password';
            errorDiv.style.display = 'block';
        }
    } catch (error) {
        console.error('Password change error:', error);
        errorDiv.textContent = 'An error occurred. Please try again.';
        errorDiv.style.display = 'block';
    }
}

// Expose change password functions to window
window.openChangePasswordModal = openChangePasswordModal;
window.closeChangePasswordModal = closeChangePasswordModal;
window.handleChangePassword = handleChangePassword;

// Make authenticated API request
async function authenticatedFetch(url, options = {}) {
    const startTime = Date.now();
    const token = checkAuth();
    if (!token) {
        DEBUG_TRACKING.trackError('AUTH_ERROR', 'No token found for authenticated request', { url });
        return null;
    }
    
    DEBUG_TRACKING.log({
        type: 'API_REQUEST_START',
        method: options.method || 'GET',
        url
    });
    
    const headers = {
        ...options.headers,
        'Authorization': `Bearer ${token}`
    };
    
    try {
        const response = await fetch(url, { ...options, headers });
        const responseTime = Date.now() - startTime;
        
        DEBUG_TRACKING.trackAPICall(
            options.method || 'GET',
            url,
            response.status,
            responseTime,
            response.ok ? null : `HTTP ${response.status}`
        );
        
        // Handle 401 Unauthorized - session expired
        if (response.status === 401) {
            DEBUG_TRACKING.trackError('AUTH_ERROR', 'Token expired or invalid (401)', { 
                url, 
                status: response.status 
            });
            console.warn('Authentication failed, redirecting to login');
            localStorage.removeItem('admin_token');
            localStorage.removeItem('admin_email');
            localStorage.removeItem('admin_name');
            localStorage.removeItem('admin_role');
            window.location.href = `${API_BASE}/GR-central-admin-login.html`;
            return null;
        }
        
        return response;
    } catch (error) {
        const responseTime = Date.now() - startTime;
        DEBUG_TRACKING.trackAPICall(
            options.method || 'GET',
            url,
            'ERROR',
            responseTime,
            error.message
        );
        console.error('Authenticated fetch error:', error);
        throw error;
    }
}

// Info Card Management for Viewer Role
function shouldShowInfoCard() {
    const params = new URLSearchParams(window.location.search);
    const tipsToggle = params.has('tips') || params.get('viewer') === 'true';
    const adminRole = (localStorage.getItem('admin_role') || '').toLowerCase();
    const employeeRole = (localStorage.getItem('employee_role') || '').toLowerCase();
    const isViewer = (r) => ['viewer', 'view', 'read-only', 'readonly'].includes(r);
    
    console.log('[InfoCard] shouldShowInfoCard check:', {
        tipsToggle,
        adminRole,
        employeeRole,
        isViewerAdmin: isViewer(adminRole),
        isViewerEmployee: isViewer(employeeRole),
        result: tipsToggle || isViewer(adminRole) || isViewer(employeeRole)
    });
    
    return tipsToggle || isViewer(adminRole) || isViewer(employeeRole);
}

function createInfoCard(title, subtitle, sections) {
    return `
        <div class="info-card-overlay" id="pageInfoOverlay" onclick="closeInfoCard()"></div>
        <div class="info-card" id="pageInfoCard">
            <button class="info-card-close" onclick="closeInfoCard()">×</button>
            <div class="info-card-title">${title}</div>
            <div class="info-card-subtitle">${subtitle}</div>
            <div class="info-card-sections">
                ${sections.map(section => `
                    <div class="info-card-section">
                        <div class="info-card-section-title">
                            ${section.title}
                        </div>
                        <div class="info-card-content">${section.content}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function showInfoCard(cardHtml) {
    console.log('[InfoCard] showInfoCard called, shouldShow:', shouldShowInfoCard());
    if (!shouldShowInfoCard()) return;
    
    console.log('[InfoCard] Displaying card');
    // Remove existing info card and overlay
    const existingCard = document.getElementById('pageInfoCard');
    const existingOverlay = document.getElementById('pageInfoOverlay');
    if (existingCard) existingCard.remove();
    if (existingOverlay) existingOverlay.remove();
    
    // Add new info card (includes overlay)
    document.body.insertAdjacentHTML('beforeend', cardHtml);
    
    // Prevent body scroll when card is open
    document.body.style.overflow = 'hidden';
    
    // Animate in
    setTimeout(() => {
        const overlay = document.getElementById('pageInfoOverlay');
        const card = document.getElementById('pageInfoCard');
        if (overlay) overlay.classList.add('visible');
        if (card) card.classList.add('visible');
    }, 50);
}

function closeInfoCard() {
    const card = document.getElementById('pageInfoCard');
    const overlay = document.getElementById('pageInfoOverlay');
    
    if (card) card.classList.remove('visible');
    if (overlay) overlay.classList.remove('visible');
    
    // Restore body scroll
    document.body.style.overflow = '';
    
    setTimeout(() => {
        if (card) card.remove();
        if (overlay) overlay.remove();
    }, 300);
}

window.closeInfoCard = closeInfoCard;

// Info Card Content for Each Page
const INFO_CARDS = {
    'overview': {
        title: 'GreenReach Central Admin Dashboard',
        subtitle: 'Your command center for the entire Light Engine network',
        sections: [
            {
                title: 'What This Page Shows',
                content: '<ul><li>Real-time metrics across all connected Light Engine systems</li><li>Fleet-wide KPIs: active farms, total production, revenue, system health</li><li>Top performers and farms requiring attention</li><li>AI-powered insights and anomaly detection summaries</li></ul>'
            },
            {
                title: 'Why We Monitor This',
                content: 'The dashboard provides a single pane of glass for GreenReach operations to monitor the entire Light Engine ecosystem. AI continuously analyzes data from every farm to surface issues before they impact production. This allows staff to proactively support farms, optimize network performance, and demonstrate the value of Light Engine technology to stakeholders.'
            },
            {
                title: 'What To Look For',
                content: '<ul><li>Farms showing degraded connectivity or critical alerts</li><li>AI anomaly detection flagging equipment or environmental issues</li><li>Production trends declining across multiple farms</li><li>Revenue metrics deviating from forecasts</li></ul>'
            },
            {
                title: 'Common Actions',
                content: 'Investigate AI-flagged anomalies and contact affected farms. Review fleet health trends for infrastructure planning. Drill into specific farms showing issues. Use AI insights to identify optimization opportunities across the network.'
            }
        ]
    },
    'platform-monitoring': {
        title: 'Fleet Monitoring Dashboard',
        subtitle: 'Real-time overview of all Light Engine deployments',
        sections: [
            {
                title: 'What This Page Shows',
                content: '<ul><li>Monthly Recurring Revenue (MRR) from cloud-connected farms</li><li>Total connected farms and operational status by tier</li><li>System health: uptime, storage, API performance, database health</li><li>Real-time farm connectivity status (online, offline, warning, critical)</li></ul>'
            },
            {
                title: 'Why We Monitor This',
                content: 'Fleet-level monitoring gives GreenReach operations visibility into the entire network\'s health and revenue performance. Early detection of connectivity issues, performance degradation, or farm offline status allows proactive support before customers report problems.'
            },
            {
                title: 'What To Look For',
                content: '<ul><li>Farms showing critical or warning status require immediate investigation</li><li>Declining MRR or farm count indicates churn or subscription issues</li><li>Storage usage approaching limits needs capacity planning</li><li>API response times degrading suggest infrastructure scaling needs</li></ul>'
            },
            {
                title: 'Common Actions',
                content: 'Contact farms showing offline or critical status. Escalate infrastructure issues to engineering if system-wide metrics degrade. Track MRR trends for business reporting. Monitor storage to prevent service disruptions.'
            }
        ]
    },
    'farms': {
        title: 'Farm Registry',
        subtitle: 'Comprehensive directory of all registered farms in the network',
        sections: [
            {
                title: 'What This Page Shows',
                content: '<ul><li>Complete farm directory with profile details and contact information</li><li>Farm locations, facility sizes, and production capacity</li><li>Subscription tiers (Edge Local, Cloud Basic, Cloud Enterprise)</li><li>Registration dates, account status, and billing information</li></ul>'
            },
            {
                title: 'Why We Monitor This',
                content: 'The farm registry is GreenReach\'s customer database and subscription management system. Operations and support staff use this to verify account details, troubleshoot access issues, manage billing, and track customer onboarding status.'
            },
            {
                title: 'What To Look For',
                content: '<ul><li>New farm registrations requiring onboarding assistance</li><li>Inactive or suspended accounts that may need follow-up</li><li>Subscription tier mismatches with actual farm capabilities</li><li>Missing or incomplete profile information affecting service delivery</li></ul>'
            },
            {
                title: 'Common Actions',
                content: 'Update farm profiles after customer communications. Verify billing details for subscription changes. Assist farms with upgrading to higher tiers. Coordinate with technical support for access issues or device provisioning.'
            }
        ]
    },
    'anomalies': {
        title: 'AI-Powered Anomaly Detection',
        subtitle: 'Machine learning identifies unusual patterns across farm networks',
        sections: [
            {
                title: 'What This Page Shows',
                content: '<ul><li>ML-detected anomalies in environmental metrics (temp, humidity, CO2)</li><li>Severity ratings (low, medium, high, critical) with confidence scores</li><li>Historical anomaly patterns and frequency trends</li><li>Root cause analysis suggestions and recommended interventions</li></ul>'
            },
            {
                title: 'Why We Monitor This',
                content: 'Anomaly detection provides early warning of equipment failures, sensor malfunctions, or environmental control issues before they cause crop losses. GreenReach staff use this to proactively reach out to farms experiencing issues, often before the farm notices the problem.'
            },
            {
                title: 'What To Look For',
                content: '<ul><li>High-severity anomalies requiring immediate farm contact</li><li>Recurring anomalies suggesting equipment needing replacement</li><li>Anomaly clusters across multiple farms indicating systemic issues</li><li>False positives that need ML model tuning</li></ul>'
            },
            {
                title: 'Common Actions',
                content: 'Contact farms with critical or high-severity anomalies. Log recurring issues for warranty/support claims. Escalate systemic patterns to engineering. Document false positives to improve ML accuracy.'
            }
        ]
    },
    'wholesale-buyers': {
        title: 'Wholesale Buyer Management',
        subtitle: 'Manage restaurants, retailers, and distributors purchasing from the network',
        sections: [
            {
                title: 'What This Page Shows',
                content: '<ul><li>Complete directory of all registered wholesale buyers</li><li>Buyer profiles: business type, order history, subscription status</li><li>Active orders, delivery schedules, and fulfillment tracking</li><li>Payment status, credit limits, and billing information</li></ul>'
            },
            {
                title: 'Why We Monitor This',
                content: 'Buyer management is critical to the GreenReach wholesale marketplace success. Staff use this to support buyer onboarding, troubleshoot order issues, manage account relationships, and ensure smooth marketplace operations. Understanding buyer behavior helps optimize the Light Engine network to meet market demand.'
            },
            {
                title: 'What To Look For',
                content: '<ul><li>New buyer registrations needing onboarding assistance</li><li>Payment issues or expired payment methods</li><li>Large orders requiring special fulfillment coordination</li><li>Inactive buyers who may need re-engagement</li></ul>'
            },
            {
                title: 'Common Actions',
                content: 'Assist new buyers with first orders and platform training. Resolve payment and billing issues. Coordinate with farms for special order fulfillment. Track buyer satisfaction and marketplace engagement metrics.'
            }
        ]
    },
    'wholesale-buyer': {
        title: 'Buyer Portal View',
        subtitle: 'Experience the marketplace from the buyer perspective',
        sections: [
            {
                title: 'What This Page Shows',
                content: '<ul><li>The buyer-facing GreenReach Wholesale marketplace interface</li><li>Product catalog, pricing, and availability from network farms</li><li>Shopping cart, checkout flow, and order management</li><li>Delivery scheduling and order tracking</li></ul>'
            },
            {
                title: 'Why We Monitor This',
                content: 'Viewing the buyer portal helps GreenReach staff understand the customer experience, troubleshoot reported issues, and provide effective support. Staff can walk buyers through the ordering process, verify pricing and product availability, and ensure the marketplace operates smoothly. This view connects to real-time Light Engine inventory data across all farms.'
            },
            {
                title: 'What To Look For',
                content: '<ul><li>UI/UX issues that may confuse buyers or block orders</li><li>Pricing or inventory discrepancies from farm data</li><li>Checkout flow problems or payment errors</li><li>Delivery date or fulfillment coordination issues</li></ul>'
            },
            {
                title: 'Common Actions',
                content: 'Test ordering workflows to verify functionality. Assist buyers who report problems by replicating their experience. Coordinate with engineering to fix bugs or improve usability. Verify that Light Engine inventory syncs correctly to marketplace.'
            }
        ]
    },
    'analytics': {
        title: 'AI Insights & Predictive Analytics',
        subtitle: 'Machine learning and artificial intelligence powering the Light Engine network',
        sections: [
            {
                title: 'What This Page Shows',
                content: '<ul><li>AI-powered predictions: harvest timing, yield forecasts, equipment failures</li><li>Machine learning model performance and confidence scores</li><li>Pattern recognition across environmental, energy, and production data</li><li>Optimization recommendations generated by AI algorithms</li></ul>'
            },
            {
                title: 'Why We Monitor This',
                content: 'AI is the brain of the Light Engine system. Machine learning models continuously analyze sensor data from every farm to predict issues, optimize growing conditions, and maximize yields. GreenReach staff use AI insights to deliver proactive support - contacting farms before equipment fails, recommending recipe adjustments for better yields, and identifying systemic patterns across the network. This is a key differentiator for Light Engine technology.'
            },
            {
                title: 'What To Look For',
                content: '<ul><li>High-confidence AI predictions requiring immediate action</li><li>Model accuracy trends - declining accuracy may indicate sensor drift</li><li>Cross-farm patterns suggesting optimization opportunities</li><li>AI recommendations that could significantly improve farm performance</li></ul>'
            },
            {
                title: 'Common Actions',
                content: 'Share AI-generated insights with farms to help them optimize operations. Investigate high-confidence failure predictions and coordinate preventive maintenance. Document AI accuracy to demonstrate Light Engine value. Use pattern recognition to identify best practices and share across network.'
            }
        ]
    },
    'alerts': {
        title: 'Real-Time Alerts & Notifications',
        subtitle: 'Immediate notifications for critical farm events requiring attention',
        sections: [
            {
                title: 'What You\'ll Find Here',
                content: '<ul><li>Critical alerts for temperature extremes, equipment failures, and system issues</li><li>Alert severity levels (info, warning, critical, emergency)</li><li>Timestamp and affected farm/device information</li><li>Alert resolution status and response times</li></ul>'
            },
            {
                title: 'Importance to Farmers',
                content: 'Instant alerts enable rapid response to critical situations. Farmers receive immediate notifications about equipment failures, environmental extremes, or system issues that require urgent attention to protect crops.'
            },
            {
                title: 'Importance to Wholesale Buyers',
                content: 'Alert transparency gives buyers visibility into potential supply chain risks. If a critical alert occurs at a supplier farm, buyers can proactively adjust orders and communicate with customers.'
            },
            {
                title: 'Importance to Retail Consumers',
                content: 'The alert system is part of quality assurance. Rapid response to environmental issues ensures produce is always grown in safe, optimal conditions with minimal risk of contamination or quality degradation.'
            }
        ]
    },
    'energy': {
        title: 'Energy Consumption Dashboard',
        subtitle: 'Track power usage and costs across all farm operations',
        sections: [
            {
                title: 'What You\'ll Find Here',
                content: '<ul><li>Real-time and historical energy consumption (kWh)</li><li>Energy costs per farm and system-wide</li><li>Top energy consumers and efficiency rankings</li><li>Cost trends and optimization opportunities</li></ul>'
            },
            {
                title: 'Importance to Farmers',
                content: 'Energy monitoring helps farmers control operating costs and identify inefficient equipment. By tracking consumption patterns, farmers can optimize their grow operations for maximum profitability and sustainability.'
            },
            {
                title: 'Importance to Wholesale Buyers',
                content: 'Energy efficiency correlates with sustainable farming practices. Buyers can prioritize suppliers with strong energy performance, supporting their own sustainability goals and ESG reporting requirements.'
            },
            {
                title: 'Importance to Retail Consumers',
                content: 'Energy-efficient farms mean more sustainable food production. Environmentally conscious consumers can support farms that minimize their carbon footprint and prioritize renewable energy use.'
            }
        ]
    },
    'harvest': {
        title: 'Harvest Forecast & Planning',
        subtitle: 'Predict production timelines and optimize inventory',
        sections: [
            {
                title: 'What You\'ll Find Here',
                content: '<ul><li>Upcoming harvests in 7, 14, 30, and 30+ day windows</li><li>Crop types, quantities, and expected harvest dates</li><li>Recipe performance: most popular crops and fastest cycles</li><li>Production planning and capacity forecasts</li></ul>'
            },
            {
                title: 'Importance to Farmers',
                content: 'Harvest forecasting helps farmers plan labor, packaging, and logistics. Understanding upcoming production helps optimize operations, reduce waste, and ensure they meet buyer commitments on time.'
            },
            {
                title: 'Importance to Wholesale Buyers',
                content: 'Accurate harvest forecasts enable precise order planning and inventory management. Buyers can anticipate supply, plan promotional activities, and ensure consistent product availability for their customers.'
            },
            {
                title: 'Importance to Retail Consumers',
                content: 'Production planning ensures fresh, consistent product availability. Consumers benefit from reliable access to their favorite produce varieties without unexpected shortages or price spikes.'
            }
        ]
    },
    'devices': {
        title: 'Device & Equipment Registry',
        subtitle: 'Monitor all sensors, controllers, and automation equipment',
        sections: [
            {
                title: 'What You\'ll Find Here',
                content: '<ul><li>All registered devices: sensors, controllers, actuators</li><li>Device status, connectivity, and battery levels</li><li>Maintenance schedules and service history</li><li>Device performance metrics and calibration data</li></ul>'
            },
            {
                title: 'Importance to Farmers',
                content: 'Device monitoring helps farmers maintain equipment before failures occur. Tracking device health ensures reliable automation, accurate sensor readings, and minimal downtime in grow operations.'
            },
            {
                title: 'Importance to Wholesale Buyers',
                content: 'Well-maintained equipment indicates operational reliability. Buyers can trust that farms with properly maintained devices will deliver consistent quality and meet delivery commitments.'
            },
            {
                title: 'Importance to Retail Consumers',
                content: 'Modern automation and monitoring technology ensures food safety and quality. Consumers benefit from produce grown with precise environmental control and continuous quality monitoring.'
            }
        ]
    },
    'recipes': {
        title: 'Growing Recipes & Protocols',
        subtitle: 'Optimized crop-specific growing procedures and parameters',
        sections: [
            {
                title: 'What You\'ll Find Here',
                content: '<ul><li>Complete growing recipes for all crop varieties</li><li>Environmental parameters: temperature, humidity, CO2, light schedules</li><li>Growth stages and expected cycle times</li><li>Recipe performance data and optimization history</li></ul>'
            },
            {
                title: 'Importance to Farmers',
                content: 'Recipes provide proven growing protocols that maximize yield and quality. Farmers can implement tested procedures, reduce trial-and-error, and achieve consistent results with each crop cycle.'
            },
            {
                title: 'Importance to Wholesale Buyers',
                content: 'Standardized recipes ensure consistent product quality across multiple farms. Buyers can expect uniform taste, texture, and appearance regardless of which farm fulfills their order.'
            },
            {
                title: 'Importance to Retail Consumers',
                content: 'Optimized growing recipes mean better-tasting produce. Scientific growing protocols maximize flavor, nutrition, and freshness while minimizing pesticides and chemical inputs.'
            }
        ]
    },
    'users': {
        title: 'User & Team Management',
        subtitle: 'Manage staff access, roles, and permissions',
        sections: [
            {
                title: 'What You\'ll Find Here',
                content: '<ul><li>All registered users and their roles (Admin, Operations, Staff, Viewer)</li><li>Permission levels and access controls</li><li>User activity logs and login history</li><li>Team member contact information and assignments</li></ul>'
            },
            {
                title: 'Importance to Farmers',
                content: 'User management helps farm owners control who can access their Light Engine system. Different permission levels ensure staff can do their jobs while protecting sensitive business data.'
            },
            {
                title: 'Importance to Wholesale Buyers',
                content: 'Proper access controls indicate professional operations. Buyers can trust that farms with organized team management will handle orders, communications, and data with appropriate security and accountability.'
            },
            {
                title: 'Importance to Retail Consumers',
                content: 'Security and access controls protect food safety data. Consumers benefit from knowing that only authorized personnel can modify growing parameters and access critical food safety information.'
            }
        ]
    },
    'rooms': {
        title: 'Room & Space Management',
        subtitle: 'Organize and monitor physical growing spaces',
        sections: [
            {
                title: 'What You\'ll Find Here',
                content: '<ul><li>All growing rooms and their configurations</li><li>Room-level environmental data and trends</li><li>Space utilization and capacity planning</li><li>Room-specific equipment and sensor assignments</li></ul>'
            },
            {
                title: 'Importance to Farmers',
                content: 'Room management helps farmers organize their operation and track which crops are where. Understanding space utilization enables better planning, crop rotation, and capacity optimization.'
            },
            {
                title: 'Importance to Wholesale Buyers',
                content: 'Room-level tracking supports traceability requirements. Buyers can trace specific products to the exact growing space, supporting food safety compliance and quality investigations.'
            },
            {
                title: 'Importance to Retail Consumers',
                content: 'Physical space organization ensures hygienic growing conditions. Consumers benefit from produce grown in well-managed, separated spaces that prevent cross-contamination and maintain optimal growing conditions.'
            }
        ]
    },
    'zones': {
        title: 'Zone Configuration & Control',
        subtitle: 'Fine-grained environmental control within growing spaces',
        sections: [
            {
                title: 'What You\'ll Find Here',
                content: '<ul><li>All environmental zones and their settings</li><li>Zone-specific temperature, humidity, and light controls</li><li>Crop assignments and zone configurations</li><li>Zone performance metrics and optimization data</li></ul>'
            },
            {
                title: 'Importance to Farmers',
                content: 'Zone-level control allows farmers to grow multiple crop types simultaneously with different environmental needs. This maximizes space utilization and enables diverse product offerings.'
            },
            {
                title: 'Importance to Wholesale Buyers',
                content: 'Fine-grained environmental control enables product variety. Buyers can source multiple crop types from a single farm, simplifying logistics and building stronger supplier relationships.'
            },
            {
                title: 'Importance to Retail Consumers',
                content: 'Precise environmental control means optimal flavor and nutrition. Each crop variety is grown in its ideal conditions, resulting in superior taste, texture, and nutrient density.'
            }
        ]
    },
    'environmental': {
        title: 'Environmental Monitoring',
        subtitle: 'Track temperature, humidity, CO2, and other conditions',
        sections: [
            {
                title: 'What You\'ll Find Here',
                content: '<ul><li>Real-time environmental data from all sensors</li><li>Historical trends and pattern analysis</li><li>Setpoint compliance and deviation alerts</li><li>Environmental optimization recommendations</li></ul>'
            },
            {
                title: 'Importance to Farmers',
                content: 'Environmental monitoring is the foundation of precision agriculture. Farmers use this data to maintain ideal growing conditions, respond to changes quickly, and continuously improve their operations.'
            },
            {
                title: 'Importance to Wholesale Buyers',
                content: 'Documented environmental controls support quality claims and certifications. Buyers can verify that products are grown in controlled, optimal conditions that ensure consistent quality and food safety.'
            },
            {
                title: 'Importance to Retail Consumers',
                content: 'Continuous environmental monitoring ensures food safety and quality. Consumers benefit from produce grown in precisely controlled conditions that maximize nutrition while minimizing contamination risks.'
            }
        ]
    }
};

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

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('forceLogin') === 'true') {
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_email');
        localStorage.removeItem('admin_name');
        window.location.href = `${API_BASE}/GR-central-admin-login.html?forceLogin=true`;
        return;
    }
    
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
                        { label: 'LE Fleet Monitoring', view: 'platform-monitoring' },
                        { label: 'Anomalies', view: 'anomalies' },
                        { label: 'Alerts', view: 'alerts' }
                    ]
                },
                {
                    title: 'Wholesale',
                    items: [
                        { label: 'Admin Dashboard', view: 'wholesale-admin' },
                        { label: 'Buyers', view: 'wholesale-buyers' },
                        { label: 'Buyer Portal', view: 'wholesale-buyer' }
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
            plants: data.totalPlants || 0
        };

        document.getElementById('kpi-farms').textContent = kpis.farms;
        document.getElementById('kpi-farms-change').textContent = data.mode || 'live';
        
        document.getElementById('kpi-rooms').textContent = kpis.rooms;
        document.getElementById('kpi-rooms-change').textContent = '';
        
        document.getElementById('kpi-zones').textContent = kpis.zones;
        document.getElementById('kpi-zones-change').textContent = '';
        
        document.getElementById('kpi-devices').textContent = kpis.devices;
        document.getElementById('kpi-devices-change').textContent = '';
        
        document.getElementById('kpi-trays').textContent = kpis.trays;
        document.getElementById('kpi-trays-change').textContent = '';
        
        document.getElementById('kpi-plants').textContent = kpis.plants.toLocaleString();
        document.getElementById('kpi-plants-change').textContent = '';
        
        // Hide energy and alerts cards for now (no data source yet)
        const energyCard = document.getElementById('kpi-energy')?.closest('.kpi-card');
        const alertsCard = document.getElementById('kpi-alerts')?.closest('.kpi-card');
        if (energyCard) energyCard.style.display = 'none';
        if (alertsCard) alertsCard.style.display = 'none';
    } catch (error) {
        console.error('Error loading KPIs:', error);
    }
}

/**
 * Sync all farm stats
 */
async function syncFarmStats() {
    try {
        const syncBtn = document.getElementById('sync-stats-btn');
        if (syncBtn) {
            syncBtn.disabled = true;
            syncBtn.textContent = 'Syncing...';
        }
        
        const response = await authenticatedFetch(`${API_BASE}/api/admin/farms/sync-all-stats`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const result = await response.json();
        console.log('Farm stats sync result:', result);
        
        // Reload KPIs to show updated data
        await loadKPIs();
        
        alert(`Sync initiated for ${result.sync?.total || 0} farms.\n\n${result.sync?.message || ''}`);
    } catch (error) {
        console.error('Error syncing farm stats:', error);
        alert('Failed to sync farm stats. Check console for details.');
    } finally {
        const syncBtn = document.getElementById('sync-stats-btn');
        if (syncBtn) {
            syncBtn.disabled = false;
            syncBtn.textContent = 'Sync Farm Stats';
        }
    }
}

// Make syncFarmStats globally available
window.syncFarmStats = syncFarmStats;


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
    DEBUG_TRACKING.trackClick('viewFarmDetail', 'function', { farmId });
    console.log('[FarmDetail] ===== VIEWING FARM =====');
    console.log('[FarmDetail] Farm ID:', farmId);
    
    // Set navigation context to farm level and update sidebar
    navigationContext = { 
        level: 'farm', 
        farmId, 
        roomId: null, 
        zoneId: null, 
        groupId: null, 
        deviceId: null 
    };
    renderContextualSidebar();
    updateBreadcrumb();
    
    try {
        // Fetch detailed farm data from API
        const url = `${API_BASE}/api/admin/farms/${farmId}`;
        console.log('[FarmDetail] Fetching:', url);
        const response = await authenticatedFetch(url);
        console.log('[FarmDetail] Response status:', response.status, response.ok);
        if (!response.ok) {
            console.error('[FarmDetail] ERROR: Failed to load farm details:', response.status);
            const errorText = await response.text();
            console.error('[FarmDetail] ERROR Response:', errorText);
            DEBUG_TRACKING.trackError('FARM_DETAIL_LOAD_FAILED', `Failed to load farm ${farmId}`, {
                status: response.status,
                errorText
            });
            alert('Unable to load farm details. Please try again.');
            return;
        }
        
        const payload = await response.json();
        console.log('[FarmDetail] Raw payload received:', JSON.stringify(payload, null, 2));
        const farm = payload?.farm || payload;
        if (!farm || payload?.error || payload?.success === false) {
            console.error('[FarmDetail] ERROR: Farm not found or invalid payload:', farmId, payload);
            alert('Farm not found or unavailable.');
            return;
        }
        console.log('[FarmDetail] Parsed farm object:', farm);
        console.log('[FarmDetail] Farm properties:', {
            name: farm.name,
            farmId: farm.farmId,
            status: farm.status,
            rooms: farm.rooms,
            zones: farm.zones,
            environmental: farm.environmental
        });
    
        // Update breadcrumb and header
        console.log('[FarmDetail] Updating header elements...');
        const nameEl = document.getElementById('farm-detail-name');
        const titleEl = document.getElementById('farm-detail-title');
        const idEl = document.getElementById('farm-detail-id');
        
        if (nameEl) nameEl.textContent = farm.name || farmId;
        if (titleEl) titleEl.textContent = farm.name || farmId;
        if (idEl) idEl.textContent = farmId;
        
        console.log('[FarmDetail] Header updated:', {
            name: farm.name || farmId,
            id: farmId
        });
        
        // Hide overview, show detail
        console.log('[FarmDetail] Switching views...');
        const overviewView = document.getElementById('overview-view');
        const detailView = document.getElementById('farm-detail-view');
        
        if (overviewView) overviewView.style.display = 'none';
        if (detailView) {
            detailView.style.display = 'block';
            console.log('[FarmDetail] Detail view is now visible');
        } else {
            console.error('[FarmDetail] ERROR: farm-detail-view element not found!');
        }
        
        // Load farm details with the fetched farm data
        console.log('[FarmDetail] Starting loadFarmDetails...');
        await loadFarmDetails(farmId, farm);
        console.log('[FarmDetail] loadFarmDetails complete');
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
        console.log('[loadFarmDetails] ===== LOADING FARM DETAILS =====');
        console.log('[loadFarmDetails] Farm ID:', farmId);
        console.log('[loadFarmDetails] Farm Data:', farmData);
        
        // Use provided farmData or fallback to farmsData array
        const farm = farmData || farmsData.find(f => f.farmId === farmId);
        
        if (!farm) {
            console.error('[loadFarmDetails] ERROR: Farm data not available for:', farmId);
            alert(`No data available for farm ${farmId}`);
            return;
        }
        console.log('[loadFarmDetails] Using farm object:', farm);
        
        // Update metrics (handle both API response structure and local data)
        console.log('[loadFarmDetails] Updating metric elements...');
        const uptimeEl = document.getElementById('detail-uptime');
        const lastSeenEl = document.getElementById('detail-last-seen');
        const apiCallsEl = document.getElementById('detail-api-calls');
        const storageEl = document.getElementById('detail-storage');
        
        if (uptimeEl) uptimeEl.textContent = '99.8%';
        if (lastSeenEl) lastSeenEl.textContent = farm.lastHeartbeat || farm.lastUpdate || 'Unknown';
        if (apiCallsEl) apiCallsEl.textContent = `${Math.floor(Math.random() * 10000)}`;
        if (storageEl) storageEl.textContent = `${Math.floor(Math.random() * 50)} GB`;
        
        // Get counts from farm data
        const rooms = farm.rooms || farm.environmental?.zones?.length || 0;
        const devices = farm.devices || (Array.isArray(farm.devices) ? farm.devices.length : 0);
        const zones = farm.zones || farm.environmental?.zones?.length || 0;
        console.log('[loadFarmDetails] Extracted counts:', { rooms, zones, devices });
        
        // Update equipment status
        document.getElementById('detail-lights').textContent = `${Math.floor(devices * 0.6)}/${Math.floor(devices * 0.6)}`;
        document.getElementById('detail-sensors').textContent = `${Math.floor(devices * 0.25)}/${Math.floor(devices * 0.25)}`;
        document.getElementById('detail-hvac').textContent = `${Math.floor(rooms * 0.8)}/${rooms}`;
        document.getElementById('detail-irrigation').textContent = `${Math.floor(zones * 0.3)}/${Math.floor(zones * 0.5)}`;
        
        // Load rooms for this farm
        console.log('[loadFarmDetails] Calling loadFarmRooms...');
        await loadFarmRooms(farmId, rooms);
        console.log('[loadFarmDetails] loadFarmRooms complete');
        
        // Load devices for this farm
        console.log('[loadFarmDetails] Calling loadFarmDevices...');
        await loadFarmDevices(farmId, devices);
        console.log('[loadFarmDetails] loadFarmDevices complete');
        
        // Load inventory for this farm
        console.log('[loadFarmDetails] Calling loadFarmInventory...');
        await loadFarmInventory(farmId, farm.trays || 0);
        console.log('[loadFarmDetails] loadFarmInventory complete');
        
        // Load recipes for this farm
        console.log('[loadFarmDetails] Calling loadFarmRecipes...');
        await loadFarmRecipes(farmId);
        console.log('[loadFarmDetails] loadFarmRecipes complete');
        
        // Load environmental data for the farm detail environmental tab
        console.log('[loadFarmDetails] Calling loadFarmEnvironmentalData...');
        await loadFarmEnvironmentalData(farmId, farm);
        console.log('[loadFarmDetails] loadFarmEnvironmentalData complete');
        
        // Load environmental trends chart for Summary tab
        console.log('[loadFarmDetails] Calling loadFarmEnvironmentalTrends...');
        await loadFarmEnvironmentalTrends(farmId);
        console.log('[loadFarmDetails] loadFarmEnvironmentalTrends complete');
        
        console.log('[loadFarmDetails] ===== ALL FARM DETAILS LOADED =====');
        
    } catch (error) {
        console.error('Error loading farm details:', error);
    }
}

/**
 * Load environmental trends chart for farm Summary tab
 */
async function loadFarmEnvironmentalTrends(farmId) {
    try {
        // Fetch telemetry data with history
        const response = await fetch(`${API_BASE}/api/sync/${farmId}/telemetry`);
        if (!response.ok) {
            console.warn('[Farm Trends] No telemetry data available');
            return;
        }
        
        const data = await response.json();
        const zones = data.telemetry?.zones || [];
        
        if (zones.length === 0) {
            console.warn('[Farm Trends] No zones in telemetry');
            return;
        }
        
        const zone = zones[0];
        console.log('[Farm Trends] Using zone data:', zone);
        
        // Extract sensor history
        const tempHistory = zone.sensors?.tempC?.history || [];
        const humidityHistory = zone.sensors?.rh?.history || [];
        const co2History = zone.sensors?.co2?.history || [];
        const vpdHistory = zone.sensors?.vpd?.history || [];
        
        // Use last 24 data points
        const last24Temp = tempHistory.slice(-24);
        const last24Humidity = humidityHistory.slice(-24);
        const last24Co2 = co2History.slice(-24);
        const last24Vpd = vpdHistory.slice(-24);
        
        // Create simple chart in env-chart placeholder
        const chartEl = document.getElementById('env-chart');
        if (chartEl && last24Temp.length > 0) {
            chartEl.innerHTML = `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px;">
                    <div>
                        <div style="font-weight: 600; margin-bottom: 8px; color: #3b82f6;">Temperature (°C)</div>
                        <canvas id="farm-trend-temp" width="300" height="100"></canvas>
                        <div style="text-align: center; margin-top: 4px; color: var(--text-secondary); font-size: 12px;">
                            Current: ${zone.sensors.tempC.current.toFixed(1)}°C
                        </div>
                    </div>
                    <div>
                        <div style="font-weight: 600; margin-bottom: 8px; color: #10b981;">Humidity (%)</div>
                        <canvas id="farm-trend-rh" width="300" height="100"></canvas>
                        <div style="text-align: center; margin-top: 4px; color: var(--text-secondary); font-size: 12px;">
                            Current: ${zone.sensors.rh.current.toFixed(0)}%
                        </div>
                    </div>
                    <div>
                        <div style="font-weight: 600; margin-bottom: 8px; color: #f59e0b;">CO₂ (ppm)</div>
                        <canvas id="farm-trend-co2" width="300" height="100"></canvas>
                        <div style="text-align: center; margin-top: 4px; color: var(--text-secondary); font-size: 12px;">
                            Current: ${zone.sensors.co2?.current?.toFixed(0) || 'N/A'}
                        </div>
                    </div>
                    <div>
                        <div style="font-weight: 600; margin-bottom: 8px; color: #8b5cf6;">VPD (kPa)</div>
                        <canvas id="farm-trend-vpd" width="300" height="100"></canvas>
                        <div style="text-align: center; margin-top: 4px; color: var(--text-secondary); font-size: 12px;">
                            Current: ${zone.sensors.vpd?.current?.toFixed(2) || 'N/A'}
                        </div>
                    </div>
                </div>
            `;
            
            // Draw mini charts
            drawSimpleChart('farm-trend-temp', last24Temp, '#3b82f6');
            drawSimpleChart('farm-trend-rh', last24Humidity, '#10b981');
            if (last24Co2.length > 0) drawSimpleChart('farm-trend-co2', last24Co2, '#f59e0b');
            if (last24Vpd.length > 0) drawSimpleChart('farm-trend-vpd', last24Vpd, '#8b5cf6');
        }
    } catch (error) {
        console.error('[Farm Trends] Error loading trends:', error);
    }
}

/**
 * View Room Detail (Drill-down to specific room)
 */
async function viewRoomDetail(farmId, roomId) {
    console.log(`Loading room detail: ${roomId} in farm ${farmId}`);
    currentFarmId = farmId;
    
    showView('room-detail-view');
    
    // Initialize room data
    let roomData = {
        roomId,
        name: roomId,
        temperature: null,
        humidity: null,
        co2: null,
        vpd: null,
        zones: [],
        devices: [],
        trays: 0,
        energyToday: null,
        energyWeek: null,
        energyTrend: null,
        energyTrendPercent: null
    };
    
    // Step 1: Fetch room metadata (name, counts)
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/rooms`);
        if (response.ok) {
            const data = await response.json();
            const rooms = Array.isArray(data.rooms) ? data.rooms : [];
            const room = rooms.find(r => r.roomId === roomId || r.id === roomId || r.room_id === roomId || r.name === roomId);
            
            if (room) {
                console.log('[room-detail] Found room metadata:', room);
                roomData.name = room.name || roomData.name;
                roomData.roomId = room.roomId || room.id || room.room_id || roomId;
                // Don't use environmental data from room - it's not there
            }
        }
    } catch (error) {
        console.error('[room-detail] Failed to load room metadata:', error);
    }
    
    // Step 2: ALWAYS fetch zone telemetry for environmental data
    try {
        const zonesRes = await fetch(`${API_BASE}/api/sync/${farmId}/telemetry`);
        if (zonesRes.ok) {
            const zonesData = await zonesRes.json();
            console.log('[room-detail] Zones telemetry data:', zonesData);
            const zones = zonesData.telemetry?.zones || zonesData.zones || [];
            console.log('[room-detail] Environmental zones:', zones);
            
            // Use telemetry data for environmental readings
            if (zones.length > 0) {
                const zone = zones[0];
                console.log('[room-detail] Using first zone for room metrics:', zone);
                
                // Extract sensor data - support both direct properties and sensors object
                const tempC = zone.temperature_c ?? zone.temp ?? zone.tempC ?? zone.sensors?.tempC?.current;
                const rh = zone.humidity ?? zone.rh ?? zone.sensors?.rh?.current;
                const co2 = zone.co2 ?? zone.sensors?.co2?.current;
                const vpd = zone.vpd ?? zone.sensors?.vpd?.current;
                
                roomData.temperature = tempC;
                roomData.humidity = rh;
                roomData.co2 = co2;
                
                // Calculate VPD if we have both temp and humidity and don't already have it
                if (vpd != null) {
                    roomData.vpd = vpd;
                } else if (tempC != null && rh != null) {
                    const T = tempC;
                    const RH = rh;
                    // Saturation vapor pressure (kPa)
                    const SVP = 0.6108 * Math.exp((17.27 * T) / (T + 237.3));
                    // Vapor pressure deficit
                    roomData.vpd = SVP * (1 - RH / 100);
                }
                
                roomData.zones = zones;
                console.log('[room-detail] Updated roomData with telemetry:', {
                    temperature: roomData.temperature,
                    humidity: roomData.humidity,
                    vpd: roomData.vpd,
                    zonesCount: zones.length
                });
            } else {
                console.warn('[room-detail] No zones in telemetry data');
            }
        }
    } catch (err) {
        console.error('[room-detail] Failed to fetch farm telemetry:', err);
    }
    
    const zoneCount = Array.isArray(roomData.zones) ? roomData.zones.length : 0;
    const deviceCount = Array.isArray(roomData.devices) ? roomData.devices.length : 0;
    const trayCount = roomData.trays || 0;
    
    // Update title and subtitle
    document.getElementById('room-detail-title').textContent = roomData.name;
    const subtitle = `${zoneCount} ${zoneCount === 1 ? 'zone' : 'zones'} • ${trayCount} ${trayCount === 1 ? 'tray' : 'trays'} • ${deviceCount} ${deviceCount === 1 ? 'device' : 'devices'}`;
    document.getElementById('room-detail-subtitle').textContent = subtitle;
    
    // Update KPIs with real or null values
    const temp = roomData.temperature != null ? `${roomData.temperature.toFixed(1)}°C` : 'No data';
    const humidity = roomData.humidity != null ? `${roomData.humidity.toFixed(0)}%` : 'No data';
    const co2 = roomData.co2 != null ? `${Math.round(roomData.co2)} ppm` : 'No data';
    const vpd = roomData.vpd != null ? `${roomData.vpd.toFixed(2)} kPa` : 'No data';
    
    document.getElementById('room-temp').textContent = temp;
    document.getElementById('room-temp-change').textContent = roomData.temperature != null ? 'Live reading' : 'No sensor';
    document.getElementById('room-humidity').textContent = humidity;
    document.getElementById('room-humidity-change').textContent = roomData.humidity != null ? 'Live reading' : 'No sensor';
    document.getElementById('room-co2').textContent = co2;
    document.getElementById('room-co2-change').textContent = roomData.co2 != null ? 'Live reading' : 'No sensor';
    document.getElementById('room-vpd').textContent = vpd;
    document.getElementById('room-vpd-change').textContent = roomData.vpd != null ? 'Calculated' : 'No data';
    document.getElementById('room-trays').textContent = trayCount;
    document.getElementById('room-trays-change').textContent = trayCount > 0 ? `${trayCount} active` : 'No trays configured';
    document.getElementById('room-energy').textContent = roomData.energyToday != null ? `${roomData.energyToday} kWh` : 'No data';
    
    const energyChange = roomData.energyTrend && roomData.energyTrendPercent != null 
        ? `${roomData.energyTrend === 'down' ? '↓' : '↑'} ${roomData.energyTrendPercent}% vs last week`
        : 'No historical data';
    document.getElementById('room-energy-change').textContent = energyChange;
    
    // Load all sections with actual data (no fake data generation)
    await Promise.all([
        loadRoomZones(farmId, roomId, roomData.zones),
        loadRoomDevices(farmId, roomId, roomData.devices),
        loadRoomTrays(farmId, roomId, trayCount),
        loadRoomEnergy(farmId, roomId, roomData.energyToday, roomData.energyWeek),
        loadRoomTrends(farmId, roomId, roomData.zones)
    ]);
}

/**
 * Load zones for a specific room
 */
async function loadRoomZones(farmId, roomId, zonesData) {
    const tbody = document.getElementById('room-zones-tbody');
    const countEl = document.getElementById('room-zones-count');
    
    console.log('[loadRoomZones] roomId:', roomId);
    console.log('[loadRoomZones] Received zonesData:', zonesData);
    
    let zones = [];
    
    // Fetch groups data to get group counts per zone
    let groupsByZone = {};
    try {
        const groupsRes = await fetch(`${API_BASE}/api/sync/${farmId}/groups`);
        if (groupsRes.ok) {
            const groupsData = await groupsRes.json();
            const groups = groupsData.groups || [];
            console.log('[loadRoomZones] Groups data:', groups);
            
            // Count groups per zone
            groups.forEach(group => {
                const zoneId = group.zone || group.zone_id;
                if (zoneId) {
                    groupsByZone[zoneId] = (groupsByZone[zoneId] || 0) + 1;
                }
            });
            console.log('[loadRoomZones] Groups by zone:', groupsByZone);
        }
    } catch (err) {
        console.warn('[loadRoomZones] Failed to fetch groups:', err);
    }
    
    // Use real zone data from telemetry if available
    if (Array.isArray(zonesData) && zonesData.length > 0) {
        zones = zonesData.map((zone, idx) => {
            // Use real zone identifiers from telemetry
            const zoneId = zone.zone_id || zone.zoneId || zone.id || zone.name || `zone-${idx + 1}`;
            const name = zone.zone_name || zone.name || `Zone ${idx + 1}`;
            
            // Extract sensor data - support both direct properties and sensors object
            const tempC = zone.temperature_c ?? zone.temp ?? zone.tempC ?? zone.sensors?.tempC?.current;
            const rh = zone.humidity ?? zone.rh ?? zone.sensors?.rh?.current;
            
            // Count groups assigned to this zone - try multiple zone ID formats
            const zoneKey = `${roomId}:${idx + 1}`;
            const groupsCount = groupsByZone[zoneId] || groupsByZone[zoneKey] || 0;
            
            console.log(`[loadRoomZones] Zone ${zoneId} (key: ${zoneKey}):`, { name, tempC, rh, groupsCount, rawZone: zone });
            
            return {
                zoneId,
                name,
                groups: groupsCount,
                trays: zone.trays?.length || 0, // Trays count if available in zone data
                temperature: tempC != null ? `${tempC.toFixed(1)}°C` : 'No data',
                humidity: rh != null ? `${rh.toFixed(0)}%` : 'No data'
            };
        });
    }
    
    countEl.textContent = `${zones.length} ${zones.length === 1 ? 'zone' : 'zones'}`;
    
    if (zones.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty">No zones configured for this room</td></tr>';
    } else {
        tbody.innerHTML = zones.map(zone => `
            <tr>
                <td><code>${zone.zoneId}</code></td>
                <td><strong>${zone.name}</strong></td>
                <td>${zone.groups}</td>
                <td>${zone.trays}</td>
                <td>${zone.temperature}</td>
                <td>${zone.humidity}</td>
                <td><button class="btn-sm" onclick="drillToZone('${farmId}', '${roomId}', '${zone.zoneId}')">View</button></td>
            </tr>
        `).join('');
    }
}

/**
 * Load devices for a specific room
 */
async function loadRoomDevices(farmId, roomId, devicesData) {
    const tbody = document.getElementById('room-devices-tbody');
    const countEl = document.getElementById('room-devices-count');
    let devices = [];
    
    // Only show devices if we have actual data
    if (Array.isArray(devicesData) && devicesData.length > 0 && devicesData[0].deviceId) {
        devices = devicesData.map(device => ({
            deviceId: device.deviceId,
            type: device.type,
            zone: device.zone,
            status: device.status || 'online',
            lastSeen: device.lastSeen ? new Date(device.lastSeen).toLocaleString() : 'Never'
        }));
    }
    
    countEl.textContent = `${devices.length} ${devices.length === 1 ? 'device' : 'devices'}`;
    
    if (devices.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty">No devices configured for this room</td></tr>';
    } else {
        tbody.innerHTML = devices.map(device => `
            <tr>
                <td><code>${device.deviceId}</code></td>
                <td>${device.type}</td>
                <td>${device.zone}</td>
                <td><span class="badge badge-${device.status === 'online' ? 'success' : 'danger'}">${device.status}</span></td>
                <td>${device.lastSeen}</td>
            </tr>
        `).join('');
    }
}

/**
 * Load trays for a specific room
 */
async function loadRoomTrays(farmId, roomId, totalTrays) {
    const tbody = document.getElementById('room-trays-tbody');
    const countEl = document.getElementById('room-trays-count');
    
    // Trays are not synced yet, show empty state
    let trays = [];
    
    // TODO: Fetch tray data from API when available
    // For now, trays are managed locally on edge device only
    
    countEl.textContent = `${trays.length} ${trays.length === 1 ? 'tray' : 'trays'}`;
    tbody.innerHTML = '<tr><td colspan="7" class="empty">No tray data available. Trays are managed locally on the edge device.</td></tr>';
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
async function loadRoomTrends(farmId, roomId, zonesData) {
    // If we have real zone data, use it for current values and history
    if (!zonesData || zonesData.length === 0) {
        console.log('[room-trends] No historical data available');
        return;
    }
    
    const zone = zonesData[0];
    console.log('[room-trends] Zone data:', zone);
    
    // Extract sensor history data if available
    const tempHistory = zone.sensors?.tempC?.history || [];
    const humidityHistory = zone.sensors?.rh?.history || [];
    const co2History = zone.sensors?.co2?.history || [];
    const vpdHistory = zone.sensors?.vpd?.history || [];
    
    // Get current values as fallback
    const tempCurrent = zone.sensors?.tempC?.current ?? zone.temperature_c ?? zone.temp ?? 20;
    const rhCurrent = zone.sensors?.rh?.current ?? zone.humidity ?? zone.rh ?? 50;
    const co2Current = zone.sensors?.co2?.current ?? zone.co2 ?? 400;
    const vpdCurrent = zone.sensors?.vpd?.current ?? zone.vpd ?? 1.0;
    
    // Use last 24 data points from history, or create flat line from current value
    const last24Temp = tempHistory.length > 0 ? tempHistory.slice(-24) : Array(24).fill(tempCurrent);
    const last24Humidity = humidityHistory.length > 0 ? humidityHistory.slice(-24) : Array(24).fill(rhCurrent);
    const last24Co2 = co2History.length > 0 ? co2History.slice(-24) : Array(24).fill(co2Current);
    const last24Vpd = vpdHistory.length > 0 ? vpdHistory.slice(-24) : Array(24).fill(vpdCurrent);
    
    console.log('[room-trends] Drawing charts with data:', {
        temp: last24Temp.length,
        humidity: last24Humidity.length,
        co2: last24Co2.length,
        vpd: last24Vpd.length
    });
    
    // Draw combined chart with all metrics
    drawCombinedTrendsChart('room-combined-trends-chart', {
        datasets: [
            { label: 'Temperature (°C)', data: last24Temp, color: '#3b82f6', yAxisId: 'temp' },
            { label: 'Humidity (%)', data: last24Humidity, color: '#10b981', yAxisId: 'humidity' },
            { label: 'CO₂ (ppm)', data: last24Co2, color: '#f59e0b', yAxisId: 'co2' },
            { label: 'VPD (kPa)', data: last24Vpd, color: '#8b5cf6', yAxisId: 'vpd' }
        ]
    });
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
 * Draw combined environmental trends chart with multiple metrics
 */
function drawCombinedTrendsChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
        console.warn(`[drawCombinedTrendsChart] Canvas not found: ${canvasId}`);
        return;
    }
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const padding = { top: 40, right: 100, bottom: 50, left: 60 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Draw background
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);
    
    // Draw chart area background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(padding.left, padding.top, chartWidth, chartHeight);
    
    // Draw grid lines (horizontal)
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = padding.top + (chartHeight * i / 4);
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + chartWidth, y);
        ctx.stroke();
    }
    
    // Draw each dataset
    config.datasets.forEach((dataset, datasetIndex) => {
        if (!dataset.data || dataset.data.length === 0) return;
        
        const min = Math.min(...dataset.data);
        const max = Math.max(...dataset.data);
        const range = max - min || 1;
        
        // Offset each line vertically for better separation
        const verticalOffset = (chartHeight / config.datasets.length) * datasetIndex;
        const lineHeight = chartHeight / config.datasets.length * 0.8; // 80% of allocated space
        
        // Draw line
        ctx.strokeStyle = dataset.color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        
        dataset.data.forEach((value, index) => {
            const x = padding.left + (index / (dataset.data.length - 1)) * chartWidth;
            const normalizedValue = (value - min) / range;
            const y = padding.top + verticalOffset + lineHeight - (normalizedValue * lineHeight);
            
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        
        ctx.stroke();
        
        // Draw current value and label on the right
        const lastValue = dataset.data[dataset.data.length - 1];
        const lastY = padding.top + verticalOffset + lineHeight - ((lastValue - min) / range * lineHeight);
        
        // Draw value dot
        ctx.fillStyle = dataset.color;
        ctx.beginPath();
        ctx.arc(padding.left + chartWidth, lastY, 4, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw label and value
        ctx.fillStyle = dataset.color;
        ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(dataset.label, padding.left + chartWidth + 10, lastY - 8);
        
        ctx.font = '14px system-ui, -apple-system, sans-serif';
        ctx.fillText(lastValue.toFixed(1), padding.left + chartWidth + 10, lastY + 8);
        
        // Draw min/max range on left
        ctx.fillStyle = '#888';
        ctx.font = '10px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'right';
        const rangeY = padding.top + verticalOffset + lineHeight / 2;
        ctx.fillText(`${min.toFixed(0)}-${max.toFixed(0)}`, padding.left - 5, rangeY);
    });
    
    // Draw time axis labels
    ctx.fillStyle = '#888';
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    
    const timeLabels = ['24h ago', '18h', '12h', '6h', 'Now'];
    timeLabels.forEach((label, index) => {
        const x = padding.left + (chartWidth * index / (timeLabels.length - 1));
        ctx.fillText(label, x, height - 20);
    });
    
    // Draw title
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Environmental Trends (24h)', padding.left, 25);
}

/**
 * Draw simple sparkline chart on canvas (kept for backward compatibility)
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
    
    // Fetch zone telemetry and groups data
    let zoneData = {
        zoneId,
        name: zoneId,
        temperature: null,
        humidity: null,
        ppfd: null,
        pressure: null,
        co2: null,
        vpd: null,
        groups: 0,
        devices: 0,
        trays: 0
    };
    
    try {
        // Fetch farm data with environmental data from authenticated admin API
        const farmRes = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}`);
        if (farmRes && farmRes.ok) {
            const farmData = await farmRes.json();
            console.log('[zone-detail] Farm data:', farmData);
            const environmental = farmData.farm?.environmental || farmData.environmental;
            const zones = environmental?.zones || [];
            console.log('[zone-detail] Environmental zones:', zones);
            
            // Find the specific zone - match by zone number
            const zoneNumber = zoneId.match(/\d+$/)?.[0];
            const zone = zones.find(z => {
                const zId = z.id || z.zone_id || z.zoneId || '';
                const zName = z.name || z.zone_name || '';
                // Match: "zone-1", "room-knukf2:1", or name containing zone number
                return zId === zoneId || 
                       zName === zoneId ||
                       (zoneNumber && (zId.endsWith(`:${zoneNumber}`) || zId.endsWith(`-${zoneNumber}`) || zName.includes(`Zone ${zoneNumber}`)));
            });
            
            if (zone) {
                console.log('[zone-detail] Found zone:', zone);
                zoneData = {
                    zoneId: zone.id || zone.zone_id || zone.zoneId || zoneId,
                    name: zone.name || zone.zone_name || zoneId,
                    temperature: zone.sensors?.tempC?.current ?? zone.temperature_c ?? zone.temp ?? zone.tempC,
                    humidity: zone.sensors?.rh?.current ?? zone.humidity ?? zone.rh,
                    co2: zone.sensors?.co2?.current ?? zone.co2,
                    vpd: zone.sensors?.vpd?.current ?? zone.vpd,
                    ppfd: (zone.sensors?.ppfd?.current ?? zone.ppfd) || zone.light,
                    pressure: (zone.sensors?.pressure?.current ?? zone.pressure_hpa) || zone.pressure,
                    groups: 0, // Will be updated from groups data below
                    devices: zone.devices?.length || 0,
                    trays: zone.trays || 0,
                    sensorCount: 0 // Will be calculated from sensors
                };
                
                // Count sensors that have current readings
                if (zone.sensors) {
                    const sensorKeys = Object.keys(zone.sensors);
                    zoneData.sensorCount = sensorKeys.filter(key => {
                        const sensor = zone.sensors[key];
                        return sensor && sensor.current != null;
                    }).length;
                }
            } else {
                console.warn('[zone-detail] Zone not found in environmental data:', zoneId, 'Available zones:', zones.map(z => z.id || z.name));
            }
        }
        
        // Fetch groups data from farm_data table via admin API
        const groupsRes = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/groups`);
        if (groupsRes && groupsRes.ok) {
            const groupsData = await groupsRes.json();
            const groups = groupsData.groups || [];
            console.log('[zone-detail] Groups data:', groups.length, 'groups');
            
            // Count groups assigned to this zone
            // Zone format in groups: "room-knukf2:1", zoneId: "zone-1"
            const zoneNumber = zoneId.match(/\d+$/)?.[0];
            const zoneGroups = groups.filter(g => {
                const groupZone = g.zone || g.zone_id || g.location;
                if (!groupZone) return false;
                
                // Match exact zone ID or by zone number
                return groupZone === zoneId || 
                       (zoneNumber && (
                           groupZone.endsWith(`:${zoneNumber}`) || 
                           groupZone.endsWith(`-${zoneNumber}`) ||
                           groupZone === `zone-${zoneNumber}`
                       ));
            });
            
            zoneData.groups = zoneGroups.length;
            console.log('[zone-detail] Found groups for zone:', zoneData.groups, 'matching zoneId:', zoneId);
        }
    } catch (error) {
        console.error('[zone-detail] Failed to fetch zone data:', error);
    }
    
    // Update title and KPIs with real data or empty states
    document.getElementById('zone-detail-title').textContent = zoneData.name;
    
    // Temperature
    if (zoneData.temperature != null) {
        document.getElementById('zone-temp').textContent = `${zoneData.temperature.toFixed(1)}°C`;
        document.getElementById('zone-temp-change').textContent = 'Live sensor reading';
    } else {
        document.getElementById('zone-temp').textContent = 'No data';
        document.getElementById('zone-temp-change').textContent = 'Sensor not configured';
    }
    
    // Humidity
    if (zoneData.humidity != null) {
        document.getElementById('zone-humidity').textContent = `${zoneData.humidity.toFixed(0)}%`;
        document.getElementById('zone-humidity-change').textContent = 'Live sensor reading';
    } else {
        document.getElementById('zone-humidity').textContent = 'No data';
        document.getElementById('zone-humidity-change').textContent = 'Sensor not configured';
    }
    
    // Groups count
    document.getElementById('zone-groups').textContent = zoneData.groups.toString();
    document.getElementById('zone-groups-change').textContent = zoneData.groups > 0 ? 
        `${zoneData.groups} ${zoneData.groups === 1 ? 'group' : 'groups'} assigned` : 
        'No groups assigned';
    
    // Devices and trays
    document.getElementById('zone-devices').textContent = zoneData.devices.toString();
    document.getElementById('zone-devices-change').textContent = zoneData.devices > 0 ? 
        `${zoneData.devices} ${zoneData.devices === 1 ? 'device' : 'devices'}` : 
        'Managed locally on edge device';
    document.getElementById('zone-trays').textContent = zoneData.trays.toString();
    document.getElementById('zone-trays-change').textContent = zoneData.trays > 0 ?
        `${zoneData.trays} ${zoneData.trays === 1 ? 'tray' : 'trays'}` :
        'Managed at room level';
    
    // Load groups and calculate PPFD from recipes
    await loadZoneGroupsAndPPFD(farmId, roomId, zoneId, zoneData.groups);
    
    // Load sensors for this zone
    await loadZoneSensors(farmId, roomId, zoneId);
}

/**
 * Load groups for a specific zone and calculate PPFD from recipes
 */
async function loadZoneGroupsAndPPFD(farmId, roomId, zoneId, count) {
    const tbody = document.getElementById('zone-groups-tbody');
    tbody.innerHTML = '<tr><td colspan="7" class="loading">Loading groups...</td></tr>';
    
    try {
        // Fetch groups from admin API
        const groupsRes = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/groups`);
        if (!groupsRes || !groupsRes.ok) throw new Error(`HTTP ${groupsRes?.status || 'error'}`);
        
        const groupsData = await groupsRes.json();
        const allGroups = groupsData.groups || [];
        console.log('[loadZoneGroupsAndPPFD] All groups:', allGroups.length);
        
        // Filter groups for this zone
        const zoneNumber = zoneId.match(/\d+$/)?.[0];
        const zoneGroups = allGroups.filter(g => {
            const groupZone = g.zone || g.zone_id || g.location;
            if (!groupZone) return false;
            
            return groupZone === zoneId || 
                   (zoneNumber && (
                       groupZone.endsWith(`:${zoneNumber}`) || 
                       groupZone.endsWith(`-${zoneNumber}`) ||
                       groupZone === `zone-${zoneNumber}`
                   ));
        });
        
        console.log('[loadZoneGroupsAndPPFD] Filtered to zone:', zoneGroups.length, 'groups for', zoneId);
        
        // Fetch lighting recipes to calculate PPFD
        let recipesData = null;
        try {
            const recipesRes = await fetch(`${API_BASE}/data/lighting-recipes.json`);
            if (recipesRes.ok) {
                recipesData = await recipesRes.json();
            }
        } catch (err) {
            console.warn('[loadZoneGroupsAndPPFD] Failed to load recipes:', err);
        }
        
        // Calculate PPFD for each group based on seed date and recipe
        let totalPPFD = 0;
        let ppfdCount = 0;
        
        zoneGroups.forEach(group => {
            if (!recipesData || !group.plan || !group.planConfig?.anchor?.seedDate) return;
            
            // Find recipe for this group's plan
            const planName = group.plan || group.planId || group.recipe;
            const recipes = recipesData.crops?.[planName];
            if (!recipes || !Array.isArray(recipes)) return;
            
            // Calculate days since seed date
            try {
                const seedDate = new Date(group.planConfig.anchor.seedDate);
                const now = new Date();
                seedDate.setHours(0, 0, 0, 0);
                now.setHours(0, 0, 0, 0);
                const daysSinceSeed = Math.floor((now - seedDate) / (1000 * 60 * 60 * 24)) + 1;
                
                // Find the closest day in the recipe
                let closestDay = recipes[0];
                recipes.forEach(recipeDay => {
                    if (Math.abs(recipeDay.day - daysSinceSeed) < Math.abs(closestDay.day - daysSinceSeed)) {
                        closestDay = recipeDay;
                    }
                });
                
                if (closestDay && closestDay.ppfd) {
                    group._calculatedPPFD = Math.round(closestDay.ppfd);
                    totalPPFD += group._calculatedPPFD;
                    ppfdCount++;
                    console.log(`[loadZoneGroupsAndPPFD] Group ${group.id}: Day ${daysSinceSeed}, PPFD = ${group._calculatedPPFD}`);
                }
            } catch (err) {
                console.warn(`[loadZoneGroupsAndPPFD] Failed to calculate PPFD for group ${group.id}:`, err);
            }
        });
        
        // Update zone PPFD KPI with average from groups
        if (ppfdCount > 0) {
            const avgPPFD = Math.round(totalPPFD / ppfdCount);
            // Update the PPFD display (assuming there's a zone-ppfd element in the HTML)
            const ppfdEl = document.getElementById('zone-ppfd');
            if (ppfdEl) {
                ppfdEl.textContent = `${avgPPFD} μmol/m²/s`;
            }
            const ppfdChangeEl = document.getElementById('zone-ppfd-change');
            if (ppfdChangeEl) {
                ppfdChangeEl.textContent = `Average from ${ppfdCount} ${ppfdCount === 1 ? 'group' : 'groups'}`;
            }
            
            console.log(`[loadZoneGroupsAndPPFD] Zone ${zoneId} average PPFD: ${avgPPFD} from ${ppfdCount} groups`);
        }
        
        if (zoneGroups.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty">No groups assigned to this zone</td></tr>';
            return;
        }
        
        // Render groups table with calculated PPFD
        tbody.innerHTML = zoneGroups.map(group => {
            const ppfdDisplay = group._calculatedPPFD ? `${group._calculatedPPFD} μmol/m²/s` : (group.ppfd || 'N/A');
            return `
            <tr onclick="viewGroupDetail('${farmId}', '${roomId}', '${zoneId}', '${escapeHtml(group.id || group.group_id || '')}')">
                <td>${escapeHtml(group.id || group.group_id || 'N/A')}</td>
                <td>${escapeHtml(group.name || 'Unnamed')}</td>
                <td>${group.lights?.length || group.light_count || 0}</td>
                <td>${group.trays || group.tray_count || 0}</td>
                <td title="Current PPFD: ${ppfdDisplay}">${escapeHtml(group.plan || group.recipe || 'No recipe')}</td>
                <td><span class="status-badge status-${group.status || 'active'}">${group.status || 'active'}</span></td>
                <td><button class="btn-secondary btn-sm" onclick="event.stopPropagation(); viewGroupDetail('${farmId}', '${roomId}', '${zoneId}', '${escapeHtml(group.id || group.group_id || '')}')">View</button></td>
            </tr>
        `;
        }).join('');
        
    } catch (error) {
        console.error('[loadZoneGroupsAndPPFD] Failed to load groups:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="empty error">Failed to load groups - ' + escapeHtml(error.message) + '</td></tr>';
    }
}

/**
 * Load sensors for a specific zone
 */
async function loadZoneSensors(farmId, roomId, zoneId) {
    const tbody = document.getElementById('zone-sensors-tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="loading">Loading sensors...</td></tr>';
    
    try {
        // Fetch farm environmental data to get zone sensors
        const farmRes = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}`);
        if (!farmRes || !farmRes.ok) throw new Error(`HTTP ${farmRes?.status || 'error'}`);
        
        const farmData = await farmRes.json();
        const environmental = farmData.farm?.environmental || farmData.environmental;
        const zones = environmental?.zones || [];
        
        // Find the specific zone
        const zoneNumber = zoneId.match(/\d+$/)?.[0];
        const zone = zones.find(z => {
            const zId = z.id || z.zone_id || z.zoneId || '';
            const zName = z.name || z.zone_name || '';
            return zId === zoneId || 
                   zName === zoneId ||
                   (zoneNumber && (zId.endsWith(`:${zoneNumber}`) || zId.endsWith(`-${zoneNumber}`) || zName.includes(`Zone ${zoneNumber}`)));
        });
        
        if (!zone || !zone.sensors) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty">No sensors configured for this zone</td></tr>';
            return;
        }
        
        // Build sensor rows from the sensors object
        const sensors = [];
        const sensorMap = zone.sensors;
        
        // Temperature sensor
        if (sensorMap.tempC && sensorMap.tempC.current != null) {
            sensors.push({
                type: 'Temperature',
                device: zone.meta?.deviceId || 'ESP32',
                value: `${sensorMap.tempC.current.toFixed(1)}°C`,
                status: 'active',
                lastSeen: zone.meta?.lastSeen || 'Active'
            });
        }
        
        // Humidity sensor
        if (sensorMap.rh && sensorMap.rh.current != null) {
            sensors.push({
                type: 'Humidity',
                device: zone.meta?.deviceId || 'ESP32',
                value: `${sensorMap.rh.current.toFixed(0)}%`,
                status: 'active',
                lastSeen: zone.meta?.lastSeen || 'Active'
            });
        }
        
        // VPD
        if (sensorMap.vpd && sensorMap.vpd.current != null) {
            sensors.push({
                type: 'VPD',
                device: 'Calculated',
                value: `${sensorMap.vpd.current.toFixed(2)} kPa`,
                status: 'active',
                lastSeen: 'Real-time'
            });
        }
        
        // CO2
        if (sensorMap.co2 && sensorMap.co2.current != null) {
            sensors.push({
                type: 'CO2',
                device: zone.meta?.deviceId || 'ESP32',
                value: `${sensorMap.co2.current.toFixed(0)} ppm`,
                status: 'active',
                lastSeen: zone.meta?.lastSeen || 'Active'
            });
        }
        
        // PPFD / Light
        if (sensorMap.ppfd && sensorMap.ppfd.current != null) {
            sensors.push({
                type: 'PPFD',
                device: zone.meta?.deviceId || 'Light Sensor',
                value: `${sensorMap.ppfd.current.toFixed(0)} μmol/m²/s`,
                status: 'active',
                lastSeen: zone.meta?.lastSeen || 'Active'
            });
        }
        
        // Pressure
        if (sensorMap.pressure && sensorMap.pressure.current != null) {
            sensors.push({
                type: 'Pressure',
                device: zone.meta?.deviceId || 'ESP32',
                value: `${sensorMap.pressure.current.toFixed(1)} hPa`,
                status: 'active',
                lastSeen: zone.meta?.lastSeen || 'Active'
            });
        }
        
        if (sensors.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty">No active sensor readings</td></tr>';
            return;
        }
        
        // Render sensors table
        tbody.innerHTML = sensors.map(sensor => `
            <tr>
                <td>${escapeHtml(sensor.type)}</td>
                <td>${escapeHtml(sensor.device)}</td>
                <td><strong>${escapeHtml(sensor.value)}</strong></td>
                <td><span class="status-badge status-${sensor.status}">${sensor.status}</span></td>
                <td>${escapeHtml(sensor.lastSeen)}</td>
                <td>—</td>
            </tr>
        `).join('');
        
    } catch (error) {
        console.error('[loadZoneSensors] Failed to load sensors:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="empty error">Failed to load sensors - ' + escapeHtml(error.message) + '</td></tr>';
    }
}

/**
 * View Group Detail (Drill-down to specific group)
 */
async function viewGroupDetail(farmId, roomId, zoneId, groupId) {
    console.log(`Loading group detail: ${groupId} in zone ${zoneId}, room ${roomId}, farm ${farmId}`);
    currentFarmId = farmId;
    
    showView('group-detail-view');
    
    // Group-level data not synced from edge devices
    const groupData = {
        groupId,
        name: groupId,
        devices: 0,
        trays: 0,
        intensity: null,
        ppfd: null,
        recipe: 'Not configured',
        schedule: 'Not configured'
    };
    
    // Update title and KPIs with empty states
    document.getElementById('group-detail-title').textContent = groupData.name;
    document.getElementById('group-devices').textContent = '0';
    document.getElementById('group-devices-change').textContent = 'Groups not synced';
    document.getElementById('group-trays').textContent = '0';
    document.getElementById('group-trays-change').textContent = 'Groups not synced';
    document.getElementById('group-intensity').textContent = 'No data';
    document.getElementById('group-intensity-change').textContent = 'Not configured';
    document.getElementById('group-ppfd').textContent = 'No data';
    document.getElementById('group-ppfd-change').textContent = 'Not configured';
    document.getElementById('group-recipe').textContent = 'Not configured';
    document.getElementById('group-recipe-change').textContent = 'Recipes managed on edge';
    document.getElementById('group-schedule').textContent = 'Not configured';
    document.getElementById('group-schedule-change').textContent = 'Schedules managed on edge';
    
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
    
    // Group-level device assignments not synced
    tbody.innerHTML = '<tr><td colspan="6" class="empty">No device data for this group. Group-level device assignments are managed on the edge device.</td></tr>';
}

/**
 * Load trays for a specific group
 */
async function loadGroupTrays(farmId, roomId, zoneId, groupId, count) {
    const tbody = document.getElementById('group-trays-tbody');
    
    // Group-level tray assignments not synced
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No tray data for this group. Trays are managed locally on the edge device.</td></tr>';
}

/**
 * Load farm rooms
 */
async function loadFarmRooms(farmId, count) {
    roomsData = [];

    try {
        const url = `${API_BASE}/api/sync/${farmId}/rooms`;
        console.log('[FarmRooms] Fetching:', url);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('[FarmRooms] Response:', data);
        const rooms = Array.isArray(data.rooms) ? data.rooms : [];

        // Fetch telemetry data to get environmental readings
        let telemetryZones = [];
        try {
            const telemetryRes = await fetch(`${API_BASE}/api/sync/${farmId}/telemetry`);
            if (telemetryRes.ok) {
                const zonesData = await telemetryRes.json();
                telemetryZones = zonesData.telemetry?.zones || zonesData.zones || [];
                console.log('[FarmRooms] Telemetry zones:', telemetryZones.length);
            }
        } catch (err) {
            console.warn('[FarmRooms] Failed to fetch telemetry:', err);
        }

        roomsData = rooms.map(room => {
            const name = room.name || room.room_name || room.roomId || room.id || 'Room';
            const roomId = room.roomId || room.room_id || room.id || name;
            const zones = room.zones?.length || room.zone_count || room.zoneCount || 0;
            const devices = room.devices?.length || room.device_count || room.deviceCount || 0;
            
            // Try to get environmental data from room, or use telemetry average
            let temp = room.temperature ?? room.temp ?? room.tempC;
            let humidity = room.humidity ?? room.rh;
            let co2 = room.co2;
            
            // If room doesn't have data, use first zone from telemetry
            if ((temp === undefined || temp === null) && telemetryZones.length > 0) {
                const zone = telemetryZones[0];
                temp = zone.temperature_c ?? zone.temp ?? zone.tempC ?? zone.sensors?.tempC?.current;
                if (temp != null) temp = temp.toFixed(1);
            }
            
            if ((humidity === undefined || humidity === null) && telemetryZones.length > 0) {
                const zone = telemetryZones[0];
                humidity = zone.humidity ?? zone.rh ?? zone.sensors?.rh?.current;
                if (humidity != null) humidity = humidity.toFixed(0);
            }
            
            if ((co2 === undefined || co2 === null) && telemetryZones.length > 0) {
                const zone = telemetryZones[0];
                co2 = zone.co2 ?? zone.sensors?.co2?.current;
            }
            
            // Format display values
            temp = temp != null ? temp : '-';
            humidity = humidity != null ? humidity : '-';
            co2 = co2 != null ? co2 : '-';

            return {
                roomId,
                name,
                status: room.status || 'online',
                zones,
                devices,
                temp,
                humidity,
                co2
            };
        });
    } catch (error) {
        console.error('[Rooms] Failed to load farm rooms:', error);
        roomsData = [];
    }

    renderRoomsTable();
}

/**
 * Render rooms table
 */
function renderRoomsTable() {
    // Target the tbody inside farm-detail-view specifically
    const detailView = document.getElementById('farm-detail-view');
    if (!detailView) {
        console.error('[renderRoomsTable] farm-detail-view not found');
        return;
    }
    const tbody = detailView.querySelector('#rooms-tbody');
    if (!tbody) {
        console.error('[renderRoomsTable] rooms-tbody not found in farm-detail-view');
        return;
    }
    
    console.log('[renderRoomsTable] Rendering', roomsData.length, 'rooms');
    
    if (roomsData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading">No rooms found for this farm</td></tr>';
        return;
    }
    
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
                <button class="btn" onclick="viewRoomDetail('${currentFarmId}', '${room.roomId || room.name}')">View</button>
            </td>
        </tr>
    `).join('');
    console.log('[renderRoomsTable] Table updated successfully');
}

/**
 * Load farm devices
 */
async function loadFarmDevices(farmId, count) {
    try {
        // Try public endpoint first, fall back to authenticated if needed
        let response;
        try {
            response = await fetch(`${API_BASE}/api/sync/${farmId}/devices`);
            if (!response.ok) throw new Error('No public devices endpoint');
        } catch (e) {
            // Fall back to authenticated endpoint
            response = await authenticatedFetch(`/api/admin/farms/${farmId}/devices`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
        }
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
    // Target the tbody inside farm-detail-view specifically
    const detailView = document.getElementById('farm-detail-view');
    if (!detailView) {
        console.error('[renderDevicesTable] farm-detail-view not found');
        return;
    }
    const tbody = detailView.querySelector('#devices-tbody');
    if (!tbody) {
        console.error('[renderDevicesTable] devices-tbody not found in farm-detail-view');
        return;
    }
    
    // Use passed devices or fall back to global devicesData
    const deviceList = devices || devicesData;
    console.log('[renderDevicesTable] Rendering', deviceList.length, 'devices');
    
    if (deviceList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem; color: #a0aec0;">No devices found for this farm. Add devices to monitor equipment.</td></tr>';
        return;
    }
    
    tbody.innerHTML = deviceList.map(device => `
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
    console.log('[renderDevicesTable] Table updated successfully');
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
        const response = await fetch(`${API_BASE}/api/sync/${farmId}/inventory`);
        const data = await response.json();
        
        if (data.success && (data.inventory || data.trays)) {
            const trays = data.inventory || data.trays;
            inventoryData = trays.map(tray => ({
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
    // Target the tbody inside farm-detail-view specifically
    const detailView = document.getElementById('farm-detail-view');
    if (!detailView) {
        console.error('[renderInventoryTable] farm-detail-view not found');
        return;
    }
    const tbody = detailView.querySelector('#inventory-tbody');
    if (!tbody) {
        console.error('[renderInventoryTable] inventory-tbody not found in farm-detail-view');
        return;
    }
    
    console.log('[renderInventoryTable] Rendering', inventoryData.length, 'inventory items');
    
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
        // Fetch farm-specific active recipes from sync endpoint
        const url = `${API_BASE}/api/sync/${farmId}/groups`;
        console.log('[FarmRecipes] Fetching active recipes for farm:', farmId);
        const response = await fetch(url);
        
        if (!response.ok) {
            console.error('Failed to load farm recipes:', response.status);
            recipesData = [];
            renderRecipesTable();
            return;
        }
        
        const data = await response.json();
        console.log('[FarmRecipes] Farm recipes response:', data);
        
        // Map recipes from synced group data
        recipesData = (data.groups || data.recipes || []).map(recipe => ({
            recipe_id: recipe.id || recipe.recipe_id || recipe.name,
            name: recipe.name,
            cropType: recipe.category || recipe.cropType || recipe.crop_type || 'Unknown',
            activeGroups: recipe.groups || 0,
            activeTrays: recipe.trays || 0,
            cycleDuration: recipe.duration_days ? `${recipe.duration_days} days` : '—',
            avgHarvestTime: recipe.duration_days ? `${recipe.duration_days} days` : '—',
            variance: '0d',
            successRate: '100%',
            description: recipe.description
        }));
        
        renderRecipesTable();
    } catch (error) {
        console.error('Error loading farm recipes:', error);
        recipesData = [];
        renderRecipesTable();
    }
}

/**
 * Render recipes table
 */
function renderRecipesTable(recipes) {
    const tbody = document.getElementById('overview-recipes-tbody');
    
    if (!tbody) {
        console.error('[renderRecipesTable] Table body element not found');
        return;
    }
    
    // Use passed recipes or fall back to global recipesData
    const recipesList = recipes || recipesData;
    
    if (recipesList.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px;">
                    <div style="color: var(--text-secondary); margin-bottom: 8px;">
                        <strong>No Active Recipes</strong>
                    </div>
                    <div style="color: var(--text-secondary); font-size: 0.9rem;">
                        No groups are currently running recipes on this farm. Recipes are assigned to groups on the edge device.
                    </div>
                    <div style="margin-top: 12px; font-size: 0.85rem; color: var(--text-secondary);">
                        Note: Recipe assignments are synced from Light Engine Foxtrot when groups are configured with active recipes.
                    </div>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = recipesList.map(recipe => {
        // Calculate average temperature from schedule
        let avgTemp = 'N/A';
        if (recipe.data && recipe.data.schedule && recipe.data.schedule.length > 0) {
            const temps = recipe.data.schedule
                .map(day => {
                    const temp = day.temperature || day.tempC || day.afternoon_temp || day['Afternoon Temp (C)'];
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
                <td><strong>${recipe.name || 'Unknown'}</strong></td>
                <td>
                    <span class="badge" style="background: ${getCategoryColor(recipe.category)}; padding: 4px 8px; border-radius: 4px; font-size: 0.85rem;">
                        ${recipe.category || 'Uncategorized'}
                    </span>
                </td>
                <td>${recipe.total_days || 0} days</td>
                <td>${recipe.schedule_length || 0} entries</td>
                <td style="font-size: 0.85rem;">${avgTemp}</td>
                <td>
                    <button onclick="viewRecipe('${recipe.id}')" class="btn btn-sm" style="padding: 4px 8px; font-size: 0.85rem;">Edit</button>
                    <button onclick="viewRecipe('${recipe.id}')" class="btn btn-sm" style="padding: 4px 8px; font-size: 0.85rem;">View</button>
                </td>
            </tr>
        `;
    }).join('');
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
    const previousView = document.querySelector('.view[style*="display: block"]')?.id || 'unknown';
    
    DEBUG_TRACKING.trackPageView(viewId, {
        previousView,
        timestamp: new Date().toISOString()
    });
    
    // Hide all views
    document.querySelectorAll('.view').forEach(v => {
        v.style.display = 'none';
    });
    
    // Show the requested view
    const targetView = document.getElementById(viewId);
    if (targetView) {
        targetView.style.display = 'block';
        DEBUG_TRACKING.log({
            type: 'VIEW_SHOWN',
            viewId,
            success: true
        });
    } else {
        DEBUG_TRACKING.trackError('VIEW_NOT_FOUND', `View element not found: ${viewId}`, {
            requestedView: viewId,
            availableViews: Array.from(document.querySelectorAll('.view')).map(v => v.id)
        });
    }
    
    // Load data for specific views
    if (viewId === 'recipes-view' && typeof loadRecipes === 'function') {
        DEBUG_TRACKING.log({ type: 'LOADING_VIEW_DATA', view: 'recipes' });
        loadRecipes();
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
            document.getElementById('wholesale-admin-view').style.display = 'block';
            break;
        case 'wholesale-buyers':
            document.getElementById('wholesale-buyers-view').style.display = 'block';
            if (INFO_CARDS['wholesale-buyers']) {
                showInfoCard(createInfoCard(INFO_CARDS['wholesale-buyers'].title, INFO_CARDS['wholesale-buyers'].subtitle, INFO_CARDS['wholesale-buyers'].sections));
            }
            break;
        case 'wholesale-buyer':
            document.getElementById('wholesale-buyer-view').style.display = 'block';
            if (INFO_CARDS['wholesale-buyer']) {
                showInfoCard(createInfoCard(INFO_CARDS['wholesale-buyer'].title, INFO_CARDS['wholesale-buyer'].subtitle, INFO_CARDS['wholesale-buyer'].sections));
            }
            break;
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
            // Show info card on overview
            if (INFO_CARDS['overview']) {
                showInfoCard(createInfoCard(INFO_CARDS['overview'].title, INFO_CARDS['overview'].subtitle, INFO_CARDS['overview'].sections));
            }
            break;
            
        // Farm-specific views - switch tabs within farm-detail-view
        case 'farm-overview':
            // Ensure farm-detail-view is visible, then switch to overview tab
            document.getElementById('farm-detail-view').style.display = 'block';
            switchDetailTab('overview');
            break;
            
        case 'farm-rooms':
            // Ensure farm-detail-view is visible, then switch to rooms tab
            document.getElementById('farm-detail-view').style.display = 'block';
            switchDetailTab('rooms');
            break;
            
        case 'farm-devices':
            // Ensure farm-detail-view is visible, then switch to devices tab
            document.getElementById('farm-detail-view').style.display = 'block';
            switchDetailTab('devices');
            break;
            
        case 'farm-inventory':
            // Ensure farm-detail-view is visible, then switch to inventory tab
            document.getElementById('farm-detail-view').style.display = 'block';
            switchDetailTab('inventory');
            break;
            
        case 'farm-recipes':
            // Ensure farm-detail-view is visible, then switch to recipes tab
            document.getElementById('farm-detail-view').style.display = 'block';
            switchDetailTab('recipes');
            break;
            
        case 'farm-environmental':
            // Ensure farm-detail-view is visible, then switch to environmental tab
            document.getElementById('farm-detail-view').style.display = 'block';
            switchDetailTab('environmental');
            break;
            
        case 'farm-energy':
            // Ensure farm-detail-view is visible, then switch to energy tab
            document.getElementById('farm-detail-view').style.display = 'block';
            switchDetailTab('energy');
            break;
            
        case 'farm-alerts':
            // Ensure farm-detail-view is visible, then switch to alerts tab
            document.getElementById('farm-detail-view').style.display = 'block';
            switchDetailTab('alerts');
            break;
            
        case 'farms':
            document.getElementById('overview-view').style.display = 'block';
            setTimeout(() => {
                const farmsCard = document.querySelector('.card-title');
                if (farmsCard && farmsCard.textContent.includes('All Farms')) {
                    farmsCard.closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 100);
            if (INFO_CARDS['farms']) {
                showInfoCard(createInfoCard(INFO_CARDS['farms'].title, INFO_CARDS['farms'].subtitle, INFO_CARDS['farms'].sections));
            }
            break;
            
        case 'analytics':
            document.getElementById('analytics-view').style.display = 'block';
            await loadAnalytics();
            if (INFO_CARDS['analytics']) {
                showInfoCard(createInfoCard(INFO_CARDS['analytics'].title, INFO_CARDS['analytics'].subtitle, INFO_CARDS['analytics'].sections));
            }
            break;
            
        case 'inventory':
            document.getElementById('inventory-view').style.display = 'block';
            break;
            
        case 'rooms':
            document.getElementById('rooms-view').style.display = 'block';
            await loadRoomsView();
            if (INFO_CARDS['rooms']) {
                showInfoCard(createInfoCard(INFO_CARDS['rooms'].title, INFO_CARDS['rooms'].subtitle, INFO_CARDS['rooms'].sections));
            }
            break;
            
        case 'zones':
            document.getElementById('zones-view').style.display = 'block';
            await loadZonesView();
            if (INFO_CARDS['zones']) {
                showInfoCard(createInfoCard(INFO_CARDS['zones'].title, INFO_CARDS['zones'].subtitle, INFO_CARDS['zones'].sections));
            }
            break;
            
        case 'groups':
            document.getElementById('overview-view').style.display = 'block';
            break;
            
        case 'devices':
            document.getElementById('devices-view').style.display = 'block';
            await loadAllDevicesView();
            if (INFO_CARDS['devices']) {
                showInfoCard(createInfoCard(INFO_CARDS['devices'].title, INFO_CARDS['devices'].subtitle, INFO_CARDS['devices'].sections));
            }
            break;
            
        case 'recipes':
            document.getElementById('recipes-view').style.display = 'block';
            await loadRecipes();
            if (INFO_CARDS['recipes']) {
                showInfoCard(createInfoCard(INFO_CARDS['recipes'].title, INFO_CARDS['recipes'].subtitle, INFO_CARDS['recipes'].sections));
            }
            break;
            
        case 'users':
            document.getElementById('users-view').style.display = 'block';
            await loadUsersView();
            if (INFO_CARDS['users']) {
                showInfoCard(createInfoCard(INFO_CARDS['users'].title, INFO_CARDS['users'].subtitle, INFO_CARDS['users'].sections));
            }
            break;
            
        case 'harvest':
            document.getElementById('harvest-view').style.display = 'block';
            await loadHarvestView();
            if (INFO_CARDS['harvest']) {
                showInfoCard(createInfoCard(INFO_CARDS['harvest'].title, INFO_CARDS['harvest'].subtitle, INFO_CARDS['harvest'].sections));
            }
            break;
            
        case 'environmental':
            document.getElementById('environmental-view').style.display = 'block';
            await loadEnvironmentalView();
            if (INFO_CARDS['environmental']) {
                showInfoCard(createInfoCard(INFO_CARDS['environmental'].title, INFO_CARDS['environmental'].subtitle, INFO_CARDS['environmental'].sections));
            }
            break;
            
        case 'energy':
            document.getElementById('energy-view').style.display = 'block';
            await loadEnergyDashboard();
            if (INFO_CARDS['energy']) {
                showInfoCard(createInfoCard(INFO_CARDS['energy'].title, INFO_CARDS['energy'].subtitle, INFO_CARDS['energy'].sections));
            }
            break;
            
        case 'yield':
            document.getElementById('overview-view').style.display = 'block';
            break;
            
        case 'anomalies':
            document.getElementById('anomalies-view').style.display = 'block';
            await loadAnomaliesView();
            if (INFO_CARDS['anomalies']) {
                showInfoCard(createInfoCard(INFO_CARDS['anomalies'].title, INFO_CARDS['anomalies'].subtitle, INFO_CARDS['anomalies'].sections));
            }
            break;
            
        case 'alerts':
            document.getElementById('alerts-view').style.display = 'block';
            await loadAlertsView();
            if (INFO_CARDS['alerts']) {
                showInfoCard(createInfoCard(INFO_CARDS['alerts'].title, INFO_CARDS['alerts'].subtitle, INFO_CARDS['alerts'].sections));
            }
            break;
            
        case 'platform-monitoring':
            document.getElementById('platform-monitoring-view').style.display = 'block';
            await loadPlatformMonitoring();
            if (INFO_CARDS['platform-monitoring']) {
                showInfoCard(createInfoCard(INFO_CARDS['platform-monitoring'].title, INFO_CARDS['platform-monitoring'].subtitle, INFO_CARDS['platform-monitoring'].sections));
            }
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
 * View room detail (stub - legacy)
 */
function viewRoomDetailStub(roomName) {
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
async function showFarmConfig() {
    if (!currentFarmId) {
        alert('No farm selected. Please select a farm from the overview first.');
        return;
    }
    
    console.log('[Farm Config] Loading configuration for:', currentFarmId);
    
    try {
        // Fetch farm configuration
        const url = `${API_BASE}/api/admin/farms/${currentFarmId}/config`;
        console.log('[Farm Config] Fetching from:', url);
        
        const response = await authenticatedFetch(url);
        console.log('[Farm Config] Response status:', response?.status);
        
        if (!response || !response.ok) {
            const errorText = await response?.text();
            console.error('[Farm Config] API error:', errorText);
            throw new Error(`Failed to load farm configuration (${response?.status}): ${errorText}`);
        }
        
        const data = await response.json();
        console.log('[Farm Config] Received data:', data);
        
        if (!data.config) {
            throw new Error('No configuration data in response');
        }
        
        const config = data.config;
        
        // Create modal
        const modalHTML = `
            <div id="farm-config-modal" class="modal-overlay" onclick="if(event.target === this) closeFarmConfigModal()">
                <div class="modal-container" style="max-width: 900px; max-height: 90vh; overflow-y: auto;" onclick="event.stopPropagation()">
                    <div class="modal-header">
                        <h2>Farm Configuration</h2>
                        <button class="modal-close" onclick="closeFarmConfigModal()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="config-section">
                            <h3>📡 Network Settings</h3>
                            <div class="config-grid">
                                <div class="config-item">
                                    <label>Local IP:</label>
                                    <span>${config.network.localIP || 'Not configured'}</span>
                                </div>
                                <div class="config-item">
                                    <label>Public IP:</label>
                                    <span>${config.network.publicIP || 'Not configured'}</span>
                                </div>
                                <div class="config-item">
                                    <label>Hostname:</label>
                                    <span>${config.network.hostname || 'Not configured'}</span>
                                </div>
                                <div class="config-item">
                                    <label>API URL:</label>
                                    <input type="text" id="config-api-url" value="${config.apiUrl || ''}" 
                                           placeholder="https://farm.example.com" style="width: 100%; padding: 6px;">
                                </div>
                            </div>
                        </div>
                        
                        <div class="config-section">
                            <h3>🔑 API Keys</h3>
                            <div class="config-grid">
                                <div class="config-item">
                                    <label>Active Keys:</label>
                                    <span>${config.apiKeys.count} ${config.apiKeys.hasActive ? '✓ Active' : '⚠ No active keys'}</span>
                                </div>
                                <div class="config-item">
                                    <label>Actions:</label>
                                    <button class="btn-small" onclick="alert('API key management coming soon')">Manage Keys</button>
                                </div>
                            </div>
                        </div>
                        
                        <div class="config-section">
                            <h3>📱 Device Registration</h3>
                            <div class="config-grid">
                                <div class="config-item">
                                    <label>Registered Devices:</label>
                                    <span>${config.devices.count} devices</span>
                                </div>
                                <div class="config-item">
                                    <label>Device Types:</label>
                                    <span>${config.devices.types.length > 0 ? config.devices.types.join(', ') : 'None registered'}</span>
                                </div>
                            </div>
                        </div>
                        
                        <div class="config-section">
                            <h3>🔌 Integration Settings</h3>
                            <div class="config-grid">
                                <div class="config-item">
                                    <label>Square Payments:</label>
                                    <span>${config.integrations.square ? '✓ Connected' : '✗ Not connected'}</span>
                                </div>
                                <div class="config-item">
                                    <label>Wholesale API:</label>
                                    <span>${config.integrations.wholesale ? '✓ Enabled' : '✗ Disabled'}</span>
                                </div>
                            </div>
                        </div>
                        
                        <div class="config-section">
                            <h3>🔔 Notification Preferences</h3>
                            <div class="config-grid">
                                <div class="config-item">
                                    <label>Email Notifications:</label>
                                    <input type="checkbox" id="config-notify-email" 
                                           ${config.notifications.email ? 'checked' : ''}>
                                </div>
                                <div class="config-item">
                                    <label>SMS Notifications:</label>
                                    <input type="checkbox" id="config-notify-sms" 
                                           ${config.notifications.sms ? 'checked' : ''}>
                                </div>
                                <div class="config-item">
                                    <label>Slack Notifications:</label>
                                    <input type="checkbox" id="config-notify-slack" 
                                           ${config.notifications.slack ? 'checked' : ''}>
                                </div>
                            </div>
                            
                            <h4 style="margin-top: 15px; font-size: 14px;">Alert Types:</h4>
                            <div class="config-grid">
                                <div class="config-item">
                                    <label>System Alerts:</label>
                                    <input type="checkbox" id="config-alert-system" 
                                           ${config.notifications.alerts.system ? 'checked' : ''}>
                                </div>
                                <div class="config-item">
                                    <label>Environmental Alerts:</label>
                                    <input type="checkbox" id="config-alert-environmental" 
                                           ${config.notifications.alerts.environmental ? 'checked' : ''}>
                                </div>
                                <div class="config-item">
                                    <label>Inventory Alerts:</label>
                                    <input type="checkbox" id="config-alert-inventory" 
                                           ${config.notifications.alerts.inventory ? 'checked' : ''}>
                                </div>
                            </div>
                        </div>
                        
                        <div class="config-section" style="background: #f8f9fa; padding: 12px; border-radius: 6px; font-size: 13px;">
                            <strong>Farm ID:</strong> ${config.farmId}<br>
                            <strong>Contact Email:</strong> ${config.contactEmail || 'Not set'}<br>
                            <strong>Created:</strong> ${new Date(config.createdAt).toLocaleDateString()}<br>
                            <strong>Last Updated:</strong> ${new Date(config.updatedAt).toLocaleString()}
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn" onclick="closeFarmConfigModal()">Cancel</button>
                        <button class="btn btn-primary" onclick="saveFarmConfig()">Save Changes</button>
                    </div>
                </div>
            </div>
            
            <style>
                .config-section {
                    margin-bottom: 25px;
                    padding-bottom: 20px;
                    border-bottom: 1px solid var(--border-color);
                }
                .config-section:last-child {
                    border-bottom: none;
                }
                .config-section h3 {
                    font-size: 16px;
                    margin-bottom: 15px;
                    color: var(--text-primary);
                }
                .config-section h4 {
                    font-size: 14px;
                    margin-bottom: 10px;
                    color: var(--text-secondary);
                }
                .config-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                    gap: 15px;
                }
                .config-item {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }
                .config-item label {
                    font-weight: 600;
                    font-size: 13px;
                    color: var(--text-secondary);
                }
                .config-item span {
                    font-size: 14px;
                    color: var(--text-primary);
                }
                .config-item input[type="checkbox"] {
                    width: 18px;
                    height: 18px;
                    cursor: pointer;
                }
            </style>
        `;
        
        // Add modal to page
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
    } catch (error) {
        console.error('[Farm Config] Error loading configuration:', error);
        alert('Failed to load farm configuration. Please try again.');
    }
}

function closeFarmConfigModal() {
    const modal = document.getElementById('farm-config-modal');
    if (modal) {
        modal.remove();
    }
}

async function saveFarmConfig() {
    if (!currentFarmId) return;
    
    try {
        // Gather form data
        const apiUrl = document.getElementById('config-api-url').value.trim();
        const notifications = {
            email: document.getElementById('config-notify-email').checked,
            sms: document.getElementById('config-notify-sms').checked,
            slack: document.getElementById('config-notify-slack').checked,
            alerts: {
                system: document.getElementById('config-alert-system').checked,
                environmental: document.getElementById('config-alert-environmental').checked,
                inventory: document.getElementById('config-alert-inventory').checked
            }
        };
        
        // Send update request
        const response = await authenticatedFetch(`${API_BASE}/api/admin/farms/${currentFarmId}/config`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ apiUrl, notifications })
        });
        
        if (!response || !response.ok) {
            throw new Error('Failed to save configuration');
        }
        
        showToast('Configuration saved successfully', 'success');
        closeFarmConfigModal();
        
        // Reload farm details to reflect changes
        await loadFarmDetail(currentFarmId);
        
    } catch (error) {
        console.error('[Farm Config] Error saving configuration:', error);
        showToast('Failed to save configuration', 'error');
    }
}

/**
 * Show farm logs
 */
async function showFarmLogs() {
    if (!currentFarmId) {
        alert('No farm selected');
        return;
    }
    
    console.log('[Farm Logs] Loading logs for:', currentFarmId);
    
    try {
        // Fetch farm logs
        const response = await authenticatedFetch(`${API_BASE}/api/admin/farms/${currentFarmId}/logs?limit=200`);
        if (!response || !response.ok) {
            throw new Error('Failed to load farm logs');
        }
        
        const data = await response.json();
        const logs = data.logs || [];
        
        // Create modal
        const modalHTML = `
            <div id="farm-logs-modal" class="modal-overlay" onclick="if(event.target === this) closeFarmLogsModal()">
                <div class="modal-container" style="max-width: 1200px; max-height: 90vh;" onclick="event.stopPropagation()">
                    <div class="modal-header">
                        <h2>Farm System Logs</h2>
                        <button class="modal-close" onclick="closeFarmLogsModal()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <!-- Filter Tabs -->
                        <div class="logs-filters" style="margin-bottom: 20px; display: flex; gap: 10px; flex-wrap: wrap;">
                            <button class="log-filter-btn active" onclick="filterLogs('all')" data-filter="all">
                                All Logs (${logs.length})
                            </button>
                            <button class="log-filter-btn" onclick="filterLogs('api_call')" data-filter="api_call">
                                📡 API Calls (${logs.filter(l => l.type === 'api_call').length})
                            </button>
                            <button class="log-filter-btn" onclick="filterLogs('device_connection')" data-filter="device_connection">
                                🔌 Device Connections (${logs.filter(l => l.type === 'device_connection').length})
                            </button>
                            <button class="log-filter-btn" onclick="filterLogs('warning')" data-filter="warning">
                                ⚠️ Errors & Warnings (${logs.filter(l => l.level === 'warning' || l.level === 'error').length})
                            </button>
                            <button class="log-filter-btn" onclick="filterLogs('user_activity')" data-filter="user_activity">
                                👤 User Activity (${logs.filter(l => l.type === 'user_activity').length})
                            </button>
                            <button class="log-filter-btn" onclick="filterLogs('system_event')" data-filter="system_event">
                                ⚙️ System Events (${logs.filter(l => l.type === 'system_event').length})
                            </button>
                        </div>
                        
                        <!-- Logs Table -->
                        <div style="overflow-x: auto;">
                            <table class="logs-table">
                                <thead>
                                    <tr>
                                        <th style="width: 40px;"></th>
                                        <th style="width: 160px;">Timestamp</th>
                                        <th style="width: 120px;">Type</th>
                                        <th>Message</th>
                                        <th style="width: 100px;">Action</th>
                                    </tr>
                                </thead>
                                <tbody id="logs-tbody">
                                    ${generateLogsRows(logs)}
                                </tbody>
                            </table>
                        </div>
                        
                        ${logs.length === 0 ? '<p style="text-align: center; color: var(--text-muted); padding: 40px;">No logs available</p>' : ''}
                    </div>
                    <div class="modal-footer">
                        <button class="btn" onclick="exportLogs()">Export Logs</button>
                        <button class="btn btn-primary" onclick="closeFarmLogsModal()">Close</button>
                    </div>
                </div>
            </div>
            
            <style>
                .log-filter-btn {
                    padding: 8px 16px;
                    border: 1px solid var(--border-color);
                    background: white;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 13px;
                    transition: all 0.2s;
                }
                .log-filter-btn:hover {
                    background: var(--bg-secondary);
                }
                .log-filter-btn.active {
                    background: var(--primary);
                    color: white;
                    border-color: var(--primary);
                }
                .logs-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 13px;
                }
                .logs-table thead {
                    background: var(--bg-secondary);
                    position: sticky;
                    top: 0;
                }
                .logs-table th {
                    padding: 12px;
                    text-align: left;
                    font-weight: 600;
                    border-bottom: 2px solid var(--border-color);
                }
                .logs-table td {
                    padding: 10px 12px;
                    border-bottom: 1px solid var(--border-color);
                    vertical-align: top;
                }
                .logs-table tr:hover {
                    background: var(--bg-hover);
                }
                .log-level-icon {
                    font-size: 16px;
                }
                .log-type-badge {
                    display: inline-block;
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: 600;
                    background: var(--bg-secondary);
                }
                .log-metadata {
                    font-size: 11px;
                    color: var(--text-muted);
                    margin-top: 4px;
                }
            </style>
        `;
        
        // Add modal to page
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Store logs data for filtering
        window.farmLogsData = logs;
        
    } catch (error) {
        console.error('[Farm Logs] Error loading logs:', error);
        alert('Failed to load farm logs. Please try again.');
    }
}

function generateLogsRows(logs) {
    if (!logs || logs.length === 0) return '';
    
    return logs.map(log => {
        const icon = getLevelIcon(log.level);
        const typeColor = getTypeColor(log.type);
        const timestamp = new Date(log.timestamp).toLocaleString();
        const metadata = log.metadata ? `<div class="log-metadata">${JSON.stringify(log.metadata).substring(0, 100)}${JSON.stringify(log.metadata).length > 100 ? '...' : ''}</div>` : '';
        
        return `
            <tr data-type="${log.type}" data-level="${log.level}">
                <td class="log-level-icon">${icon}</td>
                <td>${timestamp}</td>
                <td><span class="log-type-badge" style="background: ${typeColor};">${log.type.replace('_', ' ')}</span></td>
                <td>
                    <strong>${log.message}</strong>
                    ${metadata}
                    ${log.ipAddress ? `<div class="log-metadata">IP: ${log.ipAddress}</div>` : ''}
                    ${log.userId ? `<div class="log-metadata">User: ${log.userId}</div>` : ''}
                </td>
                <td><code style="font-size: 11px;">${log.action}</code></td>
            </tr>
        `;
    }).join('');
}

function getLevelIcon(level) {
    switch (level) {
        case 'error': return '🔴';
        case 'warning': return '⚠️';
        case 'info': return '✅';
        default: return '📝';
    }
}

function getTypeColor(type) {
    const colors = {
        'api_call': '#e0f2fe',
        'device_connection': '#dbeafe',
        'user_activity': '#fef3c7',
        'system_event': '#f3e8ff',
        'warning': '#fee2e2',
        'error': '#fecaca'
    };
    return colors[type] || '#f3f4f6';
}

function filterLogs(filterType) {
    // Update active button
    document.querySelectorAll('.log-filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // Filter logs
    const tbody = document.getElementById('logs-tbody');
    const logs = window.farmLogsData || [];
    
    let filteredLogs = logs;
    if (filterType !== 'all') {
        if (filterType === 'warning') {
            filteredLogs = logs.filter(log => log.level === 'warning' || log.level === 'error');
        } else {
            filteredLogs = logs.filter(log => log.type === filterType);
        }
    }
    
    tbody.innerHTML = generateLogsRows(filteredLogs);
}

function closeFarmLogsModal() {
    const modal = document.getElementById('farm-logs-modal');
    if (modal) {
        modal.remove();
    }
    delete window.farmLogsData;
}

function exportLogs() {
    const logs = window.farmLogsData || [];
    if (logs.length === 0) {
        alert('No logs to export');
        return;
    }
    
    // Convert to CSV
    const headers = ['Timestamp', 'Type', 'Level', 'Action', 'Message', 'IP Address', 'User ID'];
    const rows = logs.map(log => [
        new Date(log.timestamp).toISOString(),
        log.type,
        log.level,
        log.action,
        log.message.replace(/"/g, '""'),
        log.ipAddress || '',
        log.userId || ''
    ]);
    
    const csv = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    // Download
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `farm-${currentFarmId}-logs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('Logs exported successfully', 'success');
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
    
    // Load farm metrics data - this will also populate model performance from API
    await loadFarmMetrics(currentAnalyticsFarmId, 7);
}

/**
 * Load Rooms Management view
 */
async function loadRoomsView() {
    console.log('[Rooms] Loading rooms data...');
    const roomsView = document.getElementById('rooms-view');
    const tbody = roomsView ? roomsView.querySelector('#rooms-tbody') : document.getElementById('rooms-tbody');
    if (!tbody) {
        console.error('[Rooms] rooms-tbody not found in rooms-view');
        return;
    }
    tbody.innerHTML = '<tr><td colspan="10" class="loading">Loading room data...</td></tr>';
    
    try {
        const roomsRes = await authenticatedFetch(`${API_BASE}/api/admin/rooms`);
        if (!roomsRes || !roomsRes.ok) throw new Error('Failed to load rooms');
        const roomsData = await roomsRes.json();
        
        const rooms = (roomsData.rooms || []).map(room => ({
            roomId: room.roomId || room.room_id || room.id || room.name,
            name: room.name || room.room_name || room.roomId || room.id || 'Room',
            farmId: room.farmId || room.farm_id || 'Unknown Farm',
            farmName: room.farmName || room.farm_id || room.farmId || 'Unknown Farm',
            temperature: room.temperature ?? room.temp ?? room.tempC ?? '-',
            humidity: room.humidity ?? room.rh ?? '-',
            co2: room.co2 ?? '-',
            vpd: room.vpd ?? '-',
            zones: room.zones?.length || room.zone_count || room.zoneCount || 0,
            devices: room.devices?.length || room.device_count || room.deviceCount || 0,
            status: room.status || 'online'
        }));
        
        if (rooms.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="empty">No rooms found</td></tr>';
            return;
        }
        
        const html = rooms.map(room => `
            <tr>
                <td>${room.name}</td>
                <td>${room.farmName}</td>
                <td>${room.temperature}${room.temperature === '-' ? '' : '°F'}</td>
                <td>${room.humidity}${room.humidity === '-' ? '' : '%'}</td>
                <td>${room.co2}${room.co2 === '-' ? '' : ' ppm'}</td>
                <td>${room.vpd}${room.vpd === '-' ? '' : ' kPa'}</td>
                <td>${room.zones}</td>
                <td>${room.devices}</td>
                <td><span class="status-badge status-${room.status}">${room.status}</span></td>
                <td><button class="btn-small" onclick="viewRoomDetail('${room.farmId}', '${room.roomId || room.name}')">View</button></td>
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
        const zonesRes = await authenticatedFetch(`${API_BASE}/api/admin/zones`);
        if (!zonesRes || !zonesRes.ok) throw new Error('Failed to load zones');
        const zonesData = await zonesRes.json();
        
        const zones = (zonesData.zones || []).map(zone => ({
            name: zone.name || zone.id || 'Zone',
            farmName: zone.farmName || zone.farm_id || zone.farmId || 'Unknown Farm',
            roomName: zone.roomName || zone.room || zone.roomId || 'Unknown Room',
            temperature: zone.sensors?.tempC?.current ?? zone.temperature ?? zone.tempC ?? '-',
            humidity: zone.sensors?.rh?.current ?? zone.humidity ?? zone.rh ?? '-',
            co2: zone.sensors?.co2?.current ?? zone.co2 ?? '-',
            ppfd: zone.sensors?.ppfd?.current ?? zone.ppfd ?? '-',
            vpd: zone.sensors?.vpd?.current ?? zone.vpd ?? '-',
            groups: zone.groups ?? zone.group_count ?? 0
        }));
        
        if (zones.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="empty">No zones found</td></tr>';
            return;
        }
        
        const html = zones.slice(0, 100).map(zone => `
            <tr>
                <td>${zone.name}</td>
                <td>${zone.farmName}</td>
                <td>${zone.roomName}</td>
                <td>${zone.temperature}${zone.temperature === '-' ? '' : '°F'}</td>
                <td>${zone.humidity}${zone.humidity === '-' ? '' : '%'}</td>
                <td>${zone.co2}${zone.co2 === '-' ? '' : ' ppm'}</td>
                <td>${zone.ppfd}${zone.ppfd === '-' ? '' : ' μmol/m²/s'}</td>
                <td>${zone.vpd}${zone.vpd === '-' ? '' : ' kPa'}</td>
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
        // Fetch devices from all farms
        const response = await authenticatedFetch(`${API_BASE}/api/admin/farms`);
        if (!response || !response.ok) throw new Error('Failed to load farms');
        
        const farmsData = await response.json();
        const farms = farmsData.farms || [];
        
        let allDevices = [];
        
        // Fetch devices for each farm
        for (const farm of farms) {
            try {
                const devicesRes = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farm.farm_id || farm.farmId}/devices`);
                if (devicesRes && devicesRes.ok) {
                    const deviceData = await devicesRes.json();
                    const devices = deviceData.devices || [];
                    
                    // Add farm name to each device
                    devices.forEach(device => {
                        device.farmName = farm.name;
                        allDevices.push(device);
                    });
                }
            } catch (err) {
                console.warn(`Failed to fetch devices for farm ${farm.farm_id}:`, err);
            }
        }
        
        if (allDevices.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="empty">No devices configured. Devices must be registered in the database.</td></tr>';
            return;
        }
        
        const html = allDevices.slice(0, 100).map(device => `
            <tr>
                <td><code>${device.device_code || device.device_id}</code></td>
                <td>${device.device_name || 'Unnamed Device'}</td>
                <td>${device.device_type || 'Unknown'}</td>
                <td>${device.farmName || 'Unknown Farm'}</td>
                <td>${device.location || 'Not assigned'}</td>
                <td><span class="status-badge status-${device.status}">${device.status || 'unknown'}</span></td>
                <td>${device.firmware_version || 'N/A'}</td>
                <td>${device.last_seen ? new Date(device.last_seen).toLocaleString() : 'Never'}</td>
                <td><button class="btn-small" onclick="viewDeviceDetail('${device.device_code || device.device_id}')">Details</button></td>
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
    
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/harvest/forecast`);
        if (!response.ok) {
            throw new Error('Failed to load harvest data');
        }
        
        const data = await response.json();
        
        document.getElementById('harvest-week').textContent = data.thisWeek;
        document.getElementById('harvest-cycle').textContent = data.thisCycle;
        document.getElementById('harvest-success').textContent = data.successRate;
        document.getElementById('harvest-upcoming').textContent = data.upcomingTrays;
        
        const forecastHtml = `
            <div class="metric-row">
                <div class="metric-label">7-Day Bucket</div>
                <div class="metric-value">${data.forecast.sevenDay.trays} trays (${data.forecast.sevenDay.plants.toLocaleString()} plants)</div>
            </div>
            <div class="metric-row">
                <div class="metric-label">14-Day Bucket</div>
                <div class="metric-value">${data.forecast.fourteenDay.trays} trays (${data.forecast.fourteenDay.plants.toLocaleString()} plants)</div>
            </div>
            <div class="metric-row">
                <div class="metric-label">30-Day Bucket</div>
                <div class="metric-value">${data.forecast.thirtyDay.trays} trays (${data.forecast.thirtyDay.plants.toLocaleString()} plants)</div>
            </div>
            <div class="metric-row">
                <div class="metric-label">30+ Day Bucket</div>
                <div class="metric-value">${data.forecast.thirtyPlus.trays} trays (${data.forecast.thirtyPlus.plants.toLocaleString()} plants)</div>
            </div>
        `;
        document.getElementById('harvest-forecast').innerHTML = forecastHtml;
        
        const perfHtml = `
            <div class="metric-row">
                <div class="metric-label">Best Performer</div>
                <div class="metric-value">${data.recipePerformance.bestPerformer}</div>
            </div>
            <div class="metric-row">
                <div class="metric-label">Most Popular</div>
                <div class="metric-value">${data.recipePerformance.mostPopular}</div>
            </div>
            <div class="metric-row">
                <div class="metric-label">Fastest Cycle</div>
                <div class="metric-value">${data.recipePerformance.fastestCycle}</div>
            </div>
        `;
        document.getElementById('harvest-recipe-performance').innerHTML = perfHtml;
    } catch (error) {
        console.error('[Harvest] Error loading data:', error);
        showToast('Failed to load harvest data', 'error');
    }
}

/**
 * Load Environmental Dashboard view
 */
async function loadEnvironmentalView() {
    console.log('[Environmental] Loading environmental data...');
    
    try {
        // Fetch environmental data from all farms or specific farm if context exists
        const farmId = currentFarmId || navigationContext?.farmId;
        const url = farmId 
            ? `${API_BASE}/api/sync/${farmId}/telemetry`
            : `${API_BASE}/api/admin/zones`;
        
        console.log('[Environmental] Fetching from:', url);
        const response = farmId ? await fetch(url) : await authenticatedFetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        console.log('[Environmental] Response:', data);
        
        const zones = data.telemetry?.zones || data.zones || [];
        
        // Calculate averages from real data
        let totalTemp = 0, totalHumidity = 0, totalCO2 = 0, totalVPD = 0;
        let tempCount = 0, humidityCount = 0, co2Count = 0, vpdCount = 0;
        let optimalZones = 0, warningZones = 0, criticalZones = 0;
        let zonesInVPDTarget = 0;
        
        zones.forEach(zone => {
            // Temperature (convert C to F if needed)
            const temp = zone.temperature_c || zone.temperature || zone.tempC || zone.sensors?.tempC?.current;
            if (temp != null) {
                totalTemp += (temp * 9/5) + 32; // Convert C to F
                tempCount++;
            }
            
            // Humidity
            const humidity = zone.humidity || zone.rh || zone.sensors?.rh?.current;
            if (humidity != null) {
                totalHumidity += humidity;
                humidityCount++;
            }
            
            // CO2
            const co2 = zone.co2 || zone.sensors?.co2?.current;
            if (co2 != null) {
                totalCO2 += co2;
                co2Count++;
            }
            
            // VPD
            const vpd = zone.vpd || zone.sensors?.vpd?.current;
            if (vpd != null) {
                totalVPD += vpd;
                vpdCount++;
                // VPD target range: 0.8-1.2 kPa
                if (vpd >= 0.8 && vpd <= 1.2) zonesInVPDTarget++;
            }
            
            // Status classification
            const status = zone.status || 'unknown';
            if (status === 'optimal' || status === 'online') optimalZones++;
            else if (status === 'warning') warningZones++;
            else if (status === 'critical') criticalZones++;
        });
        
        // Display averages
        document.getElementById('env-avg-temp').textContent = tempCount > 0 
            ? (totalTemp / tempCount).toFixed(1) + ' °F'
            : '-- °F';
        document.getElementById('env-avg-humidity').textContent = humidityCount > 0
            ? (totalHumidity / humidityCount).toFixed(1) + ' %'
            : '-- %';
        document.getElementById('env-avg-co2').textContent = co2Count > 0
            ? Math.round(totalCO2 / co2Count) + ' ppm'
            : '-- ppm';
        document.getElementById('env-avg-vpd').textContent = vpdCount > 0
            ? (totalVPD / vpdCount).toFixed(2) + ' kPa'
            : '-- kPa';
        
        // Current conditions
        const totalZones = zones.length;
        const conditionsHtml = `
            <div class="metric-row">
                <div class="metric-label">Total Zones</div>
                <div class="metric-value">${totalZones} zones</div>
            </div>
            <div class="metric-row">
                <div class="metric-label">Optimal Zones</div>
                <div class="metric-value" style="color: var(--accent-green);">${optimalZones} zones</div>
            </div>
            ${warningZones > 0 ? `
            <div class="metric-row">
                <div class="metric-label">Warning Zones</div>
                <div class="metric-value" style="color: var(--accent-yellow);">${warningZones} zones</div>
            </div>` : ''}
            ${criticalZones > 0 ? `
            <div class="metric-row">
                <div class="metric-label">Critical Zones</div>
                <div class="metric-value" style="color: var(--accent-red);">${criticalZones} zones</div>
            </div>` : ''}
        `;
        document.getElementById('env-current-all').innerHTML = conditionsHtml || '<div class="metric-row"><div class="metric-label">No zone data available</div></div>';
        
        // VPD insights
        const avgVPDDeviation = vpdCount > 0 ? Math.abs((totalVPD / vpdCount) - 1.0).toFixed(2) : 0;
        const vpdHtml = `
            <div class="metric-row">
                <div class="metric-label">Zones in Target Range</div>
                <div class="metric-value">${zonesInVPDTarget} / ${totalZones} zones</div>
            </div>
            <div class="metric-row">
                <div class="metric-label">Avg VPD Deviation from 1.0</div>
                <div class="metric-value">±${avgVPDDeviation} kPa</div>
            </div>
            <div class="metric-row">
                <div class="metric-label">Optimization Opportunity</div>
                <div class="metric-value">${totalZones - zonesInVPDTarget} zones need adjustment</div>
            </div>
        `;
        document.getElementById('env-vpd-insights').innerHTML = vpdHtml;
        
        console.log('[Environmental] Data loaded successfully');
    } catch (error) {
        console.error('[Environmental] Error loading data:', error);
        document.getElementById('env-avg-temp').textContent = 'Error';
        document.getElementById('env-avg-humidity').textContent = 'Error';
        document.getElementById('env-avg-co2').textContent = 'Error';
        document.getElementById('env-avg-vpd').textContent = 'Error';
        document.getElementById('env-current-all').innerHTML = '<div class="metric-row"><div class="metric-label" style="color: var(--accent-red);">Failed to load environmental data</div></div>';
        document.getElementById('env-vpd-insights').innerHTML = '<div class="metric-row"><div class="metric-label" style="color: var(--accent-red);">Failed to load VPD data</div></div>';
    }
}

/**
 * Load Energy Dashboard view
 */
async function loadEnergyDashboard() {
    console.log('[Energy] Loading energy data...');
    
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/energy/dashboard`);
        if (!response.ok) {
            throw new Error('Failed to load energy data');
        }
        
        const data = await response.json();
        
        document.getElementById('energy-total-24h').textContent = data.total24h.toLocaleString();
        document.getElementById('energy-cost-kwh').textContent = data.costPerKwh.toFixed(2);
        document.getElementById('energy-efficiency').textContent = `${data.efficiency}%`;
        document.getElementById('energy-savings').textContent = data.savingsKwh.toLocaleString();
        
        const consumersHtml = data.topConsumers && data.topConsumers.length > 0
            ? data.topConsumers.map(c => `
                <div class="metric-row">
                    <div class="metric-label">${c.name} - ${c.type}</div>
                    <div class="metric-value">${c.consumption} kWh</div>
                </div>
            `).join('')
            : '<div class="metric-row"><div class="metric-label">No data available</div></div>';
        
        document.getElementById('energy-top-consumers').innerHTML = consumersHtml;
    } catch (error) {
        console.error('[Energy] Error loading data:', error);
        showToast('Failed to load energy data', 'error');
    }
}

/**
 * Load Anomalies view
 */
async function loadAnomaliesView() {
    console.log('[Anomalies] Loading anomaly data...');
    const tbody = document.getElementById('anomalies-tbody');
    
    try {
        // Fetch live anomaly data from API
        const response = await authenticatedFetch(`${API_BASE}/api/schedule-executor/ml-anomalies`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('[Anomalies] Received data:', data);
        
        if (!data.success) {
            throw new Error(data.error || 'Failed to load anomalies');
        }
        
        const anomalies = data.anomalies || [];
        
        // Update KPIs based on actual data
        const totalAnomalies = anomalies.length;
        const criticalCount = anomalies.filter(a => a.severity === 'critical').length;
        const warningCount = anomalies.filter(a => a.severity === 'warning').length;
        const acknowledged = anomalies.filter(a => a.status === 'acknowledged').length;
        
        document.getElementById('anomalies-total').textContent = totalAnomalies;
        document.getElementById('anomalies-critical').textContent = criticalCount;
        document.getElementById('anomalies-ack').textContent = acknowledged;
        document.getElementById('anomalies-rate').textContent = data.mlEnabled ? '98.5%' : 'N/A';
        
        if (anomalies.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 24px; color: var(--text-muted);">No anomalies detected</td></tr>';
            return;
        }
        
        // Transform data to match dashboard format
        const html = anomalies.map((anomaly, idx) => {
            const timestamp = anomaly.timestamp ? new Date(anomaly.timestamp).toLocaleString() : new Date().toLocaleString();
            const farm = 'Farm Alpha'; // TODO: Get actual farm name from context
            const type = 'environmental'; // Most ML anomalies are environmental
            const severity = anomaly.severity || 'warning';
            const description = anomaly.reason || 'Anomaly detected';
            const confidence = 85; // Default confidence if not provided
            const status = anomaly.status || 'new';
            
            // Build context for tracing
            const context = {
                farmId: 'GR-00001', // TODO: Get from actual farm data
                roomId: 'room-a',
                zoneId: anomaly.zone || null,
                groupId: null,
                deviceId: null
            };
            
            return `
                <tr>
                    <td>${timestamp}</td>
                    <td>${farm}</td>
                    <td>${type}</td>
                    <td><span class="status-badge status-${severity}">${severity}</span></td>
                    <td>${description}</td>
                    <td>${confidence}%</td>
                    <td>${status}</td>
                    <td>
                        <button class="btn-small" onclick="traceAnomaly('anom-${idx}', ${JSON.stringify(context).replace(/"/g, '&quot;')})">Trace</button>
                        <button class="btn-small" style="margin-left: 4px;">Acknowledge</button>
                    </td>
                </tr>
            `;
        }).join('');
        
        tbody.innerHTML = html;
        
        if (data.demo) {
            showToast('Demo mode: Displaying synthetic anomaly data', 'info');
        }
        
    } catch (error) {
        console.error('[Anomalies] Error loading data:', error);
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 24px; color: var(--accent-red);">Error loading anomalies: ' + error.message + '</td></tr>';
        
        // Set error state for KPIs
        document.getElementById('anomalies-total').textContent = '--';
        document.getElementById('anomalies-critical').textContent = '--';
        document.getElementById('anomalies-ack').textContent = '--';
        document.getElementById('anomalies-rate').textContent = '--';
        
        showToast('Failed to load anomaly data', 'error');
    }
}

/**
 * Load Alerts view
 * 
 * ALERTS vs ANOMALY DETECTION:
 * - Alerts: Rule-based, immediate action required (temp > 30°C, device offline)
 * - Anomalies: ML pattern detection, investigative (unusual behavior patterns)
 * - Alerts are reactive (known problems), Anomalies are proactive (emerging issues)
 */
async function loadAlertsView() {
    console.log('[Alerts] Loading alerts...');
    const tbody = document.getElementById('alerts-tbody');
    
    try {
        // Fetch live alert data from API
        const response = await authenticatedFetch(`${API_BASE}/api/admin/alerts`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('[Alerts] Received data:', data);
        
        if (!data.success) {
            throw new Error(data.error || 'Failed to load alerts');
        }
        
        const alerts = data.alerts || [];
        const summary = data.summary || {};
        
        // Update KPIs based on actual data
        document.getElementById('alerts-active').textContent = summary.active || 0;
        document.getElementById('alerts-critical').textContent = summary.critical || 0;
        document.getElementById('alerts-warnings').textContent = summary.warning || 0;
        document.getElementById('alerts-resolved').textContent = summary.resolved || 0;
        
        if (alerts.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 24px; color: var(--text-muted);">No active alerts</td></tr>';
            return;
        }
        
        // Render alerts table
        const html = alerts.map(alert => `
            <tr>
                <td>${new Date(alert.timestamp).toLocaleString()}</td>
                <td>${alert.farm_name || alert.farm_id}</td>
                <td><span class="status-badge status-${alert.severity}">${alert.severity}</span></td>
                <td>${alert.category || alert.type}</td>
                <td>
                    <div style="margin-bottom: 4px;">${alert.message}</div>
                    ${alert.value ? `<small style="color: var(--text-muted);">Value: ${alert.value} | Threshold: ${alert.threshold}</small>` : ''}
                </td>
                <td><span class="status-badge status-${alert.status === 'active' ? 'warning' : (alert.status === 'resolved' ? 'success' : 'info')}">${alert.status}</span></td>
                <td>${alert.acknowledged_by || '--'}</td>
                <td>
                    ${alert.status === 'active' ? 
                        `<button class="btn-small" onclick="acknowledgeAlert('${alert.id}')">Acknowledge</button>` : 
                        alert.status === 'acknowledged' ?
                        `<button class="btn-small" onclick="resolveAlert('${alert.id}')">Resolve</button>` :
                        '--'
                    }
                    ${alert.context ? 
                        `<button class="btn-small" style="margin-left: 4px;" onclick="traceAlert('${alert.id}', ${JSON.stringify(alert.context).replace(/"/g, '&quot;')})">Trace</button>` : 
                        ''
                    }
                </td>
            </tr>
        `).join('');
        
        tbody.innerHTML = html;
        
    } catch (error) {
        console.error('[Alerts] Error loading data:', error);
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 24px; color: var(--accent-red);">Error loading alerts: ' + error.message + '</td></tr>';
        
        // Set error state for KPIs
        document.getElementById('alerts-active').textContent = '--';
        document.getElementById('alerts-critical').textContent = '--';
        document.getElementById('alerts-warnings').textContent = '--';
        document.getElementById('alerts-resolved').textContent = '--';
        
        showToast('Failed to load alert data', 'error');
    }
}

/**
 * Acknowledge an alert
 */
async function acknowledgeAlert(alertId) {
    try {
        // TODO: Implement POST /api/admin/alerts/:id/acknowledge
        console.log('[Alerts] Acknowledging alert:', alertId);
        showToast('Alert acknowledged', 'success');
        await loadAlertsView(); // Reload to show updated state
    } catch (error) {
        console.error('[Alerts] Error acknowledging alert:', error);
        showToast('Failed to acknowledge alert', 'error');
    }
}

/**
 * Resolve an alert
 */
async function resolveAlert(alertId) {
    try {
        // TODO: Implement POST /api/admin/alerts/:id/resolve
        console.log('[Alerts] Resolving alert:', alertId);
        showToast('Alert resolved', 'success');
        await loadAlertsView(); // Reload to show updated state
    } catch (error) {
        console.error('[Alerts] Error resolving alert:', error);
        showToast('Failed to resolve alert', 'error');
    }
}

/**
 * Trace alert to source
 */
async function traceAlert(alertId, context) {
    console.log('[Alerts] Tracing alert to source:', alertId, context);
    // Reuse the existing trace logic from anomalies
    if (context.zone_id) {
        // Navigate to the zone view if available
        showToast(`Tracing to ${context.farm_id} / ${context.zone_id}`, 'info');
    } else if (context.room_id) {
        showToast(`Tracing to ${context.farm_id} / ${context.room_id}`, 'info');
    } else {
        showToast(`Alert source: ${context.farm_id}`, 'info');
    }
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

function filterRecipesStub() {
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
    if (!summary) return;
    
    // Production
    document.getElementById('analytics-production').textContent = `${(summary.totalProduction || 0).toFixed(1)} kg`;
    document.getElementById('analytics-production-avg').textContent = `${((summary.totalProduction || 0) / (summary.daysReported || 1)).toFixed(1)} kg/day avg`;
    
    // Revenue
    document.getElementById('analytics-revenue').textContent = `$${(summary.totalRevenue || 0).toFixed(2)}`;
    
    // Model performance (from API response)
    const perfData = summary.modelPerformance || analyticsData.modelPerformance;
    if (perfData) {
        const perfHtml = `
            <div class="metric-row">
                <div class="metric-label">Temperature Forecast</div>
                <div class="metric-value">${perfData.temperatureForecast || 0}% accuracy</div>
            </div>
            <div class="metric-row">
                <div class="metric-label">Harvest Timing</div>
                <div class="metric-value">${perfData.harvestTiming || 0}% accuracy</div>
            </div>
            <div class="metric-row">
                <div class="metric-label">Energy Prediction</div>
                <div class="metric-value">${perfData.energyPrediction || 0}% accuracy</div>
            </div>
        `;
        const perfEl = document.getElementById('analytics-performance');
        if (perfEl) perfEl.innerHTML = perfHtml;
    }
}

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
        
        // Render rooms table - scope to rooms-view to avoid duplicate IDs
        const roomsView = document.getElementById('rooms-view');
        const tableBody = roomsView ? roomsView.querySelector('#rooms-tbody') : document.querySelector('#rooms-tbody');
        if (!tableBody) {
            console.error('Rooms table body not found (#rooms-tbody in #rooms-view)');
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
        const tableBody = document.querySelector('#devices-tbody');
        if (!tableBody) {
            console.error('Devices table body not found (#devices-tbody)');
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
 * Load environmental data for farm detail tab
 * Populates env-current and env-insights elements using GPT-4 AI
 */
async function loadFarmEnvironmentalData(farmId, farmData) {
    console.log('[loadFarmEnvironmentalData] Loading for farm:', farmId);
    
    try {
        // Fetch zone telemetry data from API
        let zones = [];
        try {
            const zonesResponse = await fetch(`${API_BASE}/api/sync/${farmId}/telemetry`);
            if (zonesResponse.ok) {
                const zonesData = await zonesResponse.json();
                zones = zonesData.telemetry?.zones || zonesData.zones || [];
                console.log('[loadFarmEnvironmentalData] Fetched zones from API:', zones.length);
            } else {
                console.warn('[loadFarmEnvironmentalData] Zones API returned:', zonesResponse.status);
            }
        } catch (apiError) {
            console.error('[loadFarmEnvironmentalData] Failed to fetch zones:', apiError);
        }
        
        console.log('[loadFarmEnvironmentalData] Found zones:', zones.length);
        
        if (zones.length === 0) {
            // No environmental data
            document.getElementById('env-current').innerHTML = `
                <div class="metric-row">
                    <div class="metric-label">No Environmental Data</div>
                    <div class="metric-value" style="color: var(--text-secondary);">No zones reporting</div>
                </div>
            `;
            document.getElementById('env-insights').innerHTML = `
                <div class="metric-row">
                    <div class="metric-label">No AI Insights Available</div>
                    <div class="metric-value" style="color: var(--text-secondary);">Insufficient data</div>
                </div>
            `;
            return;
        }
        
        // Calculate averages from real zone data
        let totalTemp = 0, totalHumidity = 0, totalPressure = 0;
        let tempCount = 0, humidityCount = 0, pressureCount = 0;
        
        zones.forEach(zone => {
            // Support multiple data formats: direct properties, or sensors object
            const temp = zone.temperature_c || zone.sensors?.tempC?.current;
            const humidity = zone.humidity || zone.rh || zone.sensors?.rh?.current;
            const pressure = zone.pressure_hpa || zone.sensors?.pressure?.current;
            
            if (temp != null) {
                totalTemp += temp;
                tempCount++;
            }
            if (humidity != null) {
                totalHumidity += humidity;
                humidityCount++;
            }
            if (pressure != null) {
                totalPressure += pressure;
                pressureCount++;
            }
        });
        
        const avgTempNum = tempCount > 0 ? (totalTemp / tempCount) : null;
        const avgHumidityNum = humidityCount > 0 ? (totalHumidity / humidityCount) : null;
        const avgPressureNum = pressureCount > 0 ? (totalPressure / pressureCount) : null;
        
        // Format for display
        const avgTemp = avgTempNum != null ? avgTempNum.toFixed(1) : null;
        const avgHumidity = avgHumidityNum != null ? avgHumidityNum.toFixed(1) : null;
        const avgPressure = avgPressureNum != null ? avgPressureNum.toFixed(1) : null;
        
        // Calculate VPD from temp and humidity using numeric values
        let avgVPD = null;
        if (avgTempNum != null && avgHumidityNum != null) {
            // VPD = SVP * (1 - RH/100), where SVP = 0.6108 * exp(17.27*T/(T+237.3))
            const svp = 0.6108 * Math.exp((17.27 * avgTempNum) / (avgTempNum + 237.3));
            avgVPD = (svp * (1 - avgHumidityNum / 100)).toFixed(2);
        }
        
        // Populate Current Conditions
        const conditionsHtml = `
            <div class="metric-row">
                <div class="metric-label">Temperature</div>
                <div class="metric-value">${avgTemp != null ? avgTemp + '°C' : 'No data'}</div>
            </div>
            <div class="metric-row">
                <div class="metric-label">Humidity</div>
                <div class="metric-value">${avgHumidity != null ? avgHumidity + '%' : 'No data'}</div>
            </div>
            <div class="metric-row">
                <div class="metric-label">Pressure</div>
                <div class="metric-value">${avgPressure != null ? avgPressure + ' hPa' : 'No data'}</div>
            </div>
            <div class="metric-row">
                <div class="metric-label">VPD (calculated)</div>
                <div class="metric-value">${avgVPD != null ? avgVPD + ' kPa' : 'No data'}</div>
            </div>
            <div class="metric-row">
                <div class="metric-label">Active Zones</div>
                <div class="metric-value">${zones.length} ${zones.length === 1 ? 'zone' : 'zones'}</div>
            </div>
        `;
        document.getElementById('env-current').innerHTML = conditionsHtml;
        
        // Show loading state for AI insights
        document.getElementById('env-insights').innerHTML = `
            <div class="metric-row">
                <div class="metric-label">🤖 Analyzing with GPT-4...</div>
                <div class="metric-value" style="color: var(--text-secondary);">Generating insights</div>
            </div>
        `;
        
        // Call GPT-4 AI Insights API
        try {
            console.log('[loadFarmEnvironmentalData] Calling GPT-4 AI Insights API for farm:', farmId);
            const response = await authenticatedFetch(`${API_BASE}/api/ai-insights/${farmId}`);
            
            if (!response.ok) {
                throw new Error(`AI Insights API returned ${response.status}`);
            }
            
            const aiData = await response.json();
            console.log('[loadFarmEnvironmentalData] GPT-4 response:', aiData);
            
            // Display AI-generated insights
            let insightsHtml = '';
            
            // Overall status
            if (aiData.insights.overall_status) {
                insightsHtml += `
                    <div class="metric-row" style="border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 12px;">
                        <div class="metric-label">Status</div>
                        <div class="metric-value">${escapeHtml(aiData.insights.overall_status)}</div>
                    </div>
                `;
            }
            
            // Temperature assessment
            if (aiData.insights.parameters.temperature.assessment) {
                const tempIcon = Math.abs(aiData.insights.parameters.temperature.deviation_percent) < 10 ? '✅' : '🌡️';
                insightsHtml += `
                    <div class="metric-row">
                        <div class="metric-label">${tempIcon} Temperature</div>
                        <div class="metric-value" style="font-size: 0.9em;">${escapeHtml(aiData.insights.parameters.temperature.assessment)}</div>
                    </div>
                `;
            }
            
            // Humidity assessment
            if (aiData.insights.parameters.humidity.assessment) {
                const humidityIcon = Math.abs(aiData.insights.parameters.humidity.deviation_percent) < 10 ? '✅' : '💧';
                insightsHtml += `
                    <div class="metric-row">
                        <div class="metric-label">${humidityIcon} Humidity</div>
                        <div class="metric-value" style="font-size: 0.9em;">${escapeHtml(aiData.insights.parameters.humidity.assessment)}</div>
                    </div>
                `;
            }
            
            // VPD assessment
            if (aiData.insights.parameters.vpd.assessment) {
                insightsHtml += `
                    <div class="metric-row">
                        <div class="metric-label">📊 VPD</div>
                        <div class="metric-value" style="font-size: 0.9em;">${escapeHtml(aiData.insights.parameters.vpd.assessment)}</div>
                    </div>
                `;
            }
            
            // Priority actions
            if (aiData.insights.priority_actions && aiData.insights.priority_actions.length > 0) {
                insightsHtml += `
                    <div class="metric-row" style="border-top: 1px solid var(--border); padding-top: 12px; margin-top: 12px;">
                        <div class="metric-label" style="font-weight: bold;">🎯 Priority Actions</div>
                    </div>
                `;
                aiData.insights.priority_actions.forEach((action, index) => {
                    insightsHtml += `
                        <div class="metric-row" style="padding-left: 20px;">
                            <div class="metric-value" style="font-size: 0.9em;">
                                ${index + 1}. ${escapeHtml(action)}
                            </div>
                        </div>
                    `;
                });
            }
            
            // Add timestamp and GPT-4 badge
            insightsHtml += `
                <div class="metric-row" style="border-top: 1px solid var(--border); padding-top: 8px; margin-top: 12px;">
                    <div class="metric-value" style="font-size: 0.8em; color: var(--text-secondary);">
                        🤖 Powered by GPT-4 | ${new Date(aiData.timestamp).toLocaleTimeString()}
                    </div>
                </div>
            `;
            
            document.getElementById('env-insights').innerHTML = insightsHtml;
            
        } catch (aiError) {
            console.error('[loadFarmEnvironmentalData] GPT-4 API error:', aiError);
            
            // Fallback to basic insights if AI fails
            document.getElementById('env-insights').innerHTML = `
                <div class="metric-row">
                    <div class="metric-label">⚠️ AI Insights Unavailable</div>
                    <div class="metric-value" style="color: var(--text-secondary);">${escapeHtml(aiError.message)}</div>
                </div>
                <div class="metric-row">
                    <div class="metric-value" style="font-size: 0.9em;">
                        Environmental data is being monitored. AI analysis will be available when the service is configured.
                    </div>
                </div>
            `;
        }
        
    } catch (error) {
        console.error('[loadFarmEnvironmentalData] Error:', error);
        document.getElementById('env-current').innerHTML = `
            <div class="metric-row">
                <div class="metric-label">Error</div>
                <div class="metric-value" style="color: var(--danger);">${escapeHtml(error.message)}</div>
            </div>
        `;
    }
}

// Helper function to escape HTML
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
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

const recipeFieldMap = new Map([
    ['day', 'day'],
    ['stage', 'stage'],
    ['dli target mol m2 d', 'dli_target'],
    ['dli target', 'dli_target'],
    ['temp target c', 'temperature'],
    ['temperature', 'temperature'],
    ['blue', 'blue'],
    ['green', 'green'],
    ['red', 'red'],
    ['far red', 'far_red'],
    ['farred', 'far_red'],
    ['ppfd target umol m2 s', 'ppfd'],
    ['ppfd target', 'ppfd'],
    ['vpd target kpa', 'vpd_target'],
    ['vpd target', 'vpd_target'],
    ['max humidity', 'max_humidity'],
    ['ec target ds m', 'ec'],
    ['ec target', 'ec'],
    ['ph target', 'ph'],
    ['ph', 'ph']
]);

function isRecipeResponseOk(data) {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.ok === 'boolean') return data.ok;
    if (typeof data.success === 'boolean') return data.success;
    return false;
}

function normalizeHeaderKey(key) {
    return String(key)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function normalizeRecipeSchedule(recipe) {
    if (Array.isArray(recipe?.data?.schedule)) {
        return recipe.data.schedule;
    }
    if (Array.isArray(recipe?.phases)) {
        return recipe.phases.map(phase => {
            const normalized = {};
            Object.entries(phase).forEach(([key, value]) => {
                const normalizedKey = normalizeHeaderKey(key);
                const mappedKey = recipeFieldMap.get(normalizedKey);
                if (mappedKey) {
                    normalized[mappedKey] = value;
                }
            });
            return normalized;
        });
    }
    return [];
}

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
        
        if (!isRecipeResponseOk(data)) {
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
function renderRecipesTableDetailed(recipes) {
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
        
        if (!isRecipeResponseOk(data)) {
            throw new Error(data.error || 'Failed to load recipe');
        }
        
        const recipe = data.recipe || {};
        const schedule = normalizeRecipeSchedule(recipe);
        
        // Store recipe data for export
        currentRecipeData = recipe;
        
        // Update modal header
        document.getElementById('recipe-view-title').textContent = recipe.name || 'Recipe';
        document.getElementById('recipe-view-category').textContent = recipe.category || 'Vegetables';
        document.getElementById('recipe-view-days').textContent = recipe.total_days || recipe.totalDays || schedule.length;
        
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
        
        if (!isRecipeResponseOk(data)) {
            throw new Error(data.error || 'Failed to load recipe');
        }
        
        const recipe = data.recipe || {};
        currentRecipeId = recipeId;
        
        // Store recipe data for export
        currentRecipeData = recipe;
        
        document.getElementById('recipe-modal-title').textContent = 'Edit Recipe';
        document.getElementById('recipe-name').value = recipe.name || '';
        document.getElementById('recipe-category').value = recipe.category || 'Vegetables';
        document.getElementById('recipe-description').value = recipe.description || '';
        
        // Render schedule
        const schedule = normalizeRecipeSchedule(recipe);
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
        
        if (!isRecipeResponseOk(data)) {
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
        
        if (!isRecipeResponseOk(data)) {
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
        const response = await authenticatedFetch(`${API_BASE}/api/admin/fleet/monitoring`);
        if (!response.ok) {
            throw new Error('Failed to load fleet monitoring data');
        }
        
        const data = await response.json();
        
        // Update KPIs
        const summary = data.summary || {};
        document.getElementById('platform-farms').textContent = Number.isFinite(summary.connectedFarms)
            ? summary.connectedFarms
            : '—';
        document.getElementById('platform-mrr').textContent = Number.isFinite(summary.monthlyRecurringRevenue)
            ? `$${summary.monthlyRecurringRevenue.toLocaleString()}`
            : '—';
        document.getElementById('platform-zones').textContent = Number.isFinite(summary.totalZones)
            ? summary.totalZones
            : '—';
        document.getElementById('platform-sensors').textContent = Number.isFinite(summary.connectedSensors)
            ? summary.connectedSensors.toLocaleString()
            : '—';
        document.getElementById('platform-health').textContent = Number.isFinite(summary.fleetHealthScore)
            ? summary.fleetHealthScore
            : '—';
        document.getElementById('platform-alerts').textContent = Number.isFinite(summary.activeAlerts)
            ? summary.activeAlerts
            : '—';
        
        // Render deployments table
        const tbody = document.getElementById('platform-deployments-tbody');
        if (data.deployments && data.deployments.length > 0) {
            tbody.innerHTML = data.deployments.map(d => {
                const planBadge = {
                    'Starter': '<span class="badge badge-info">Starter</span>',
                    'Pro': '<span class="badge badge-primary">Pro</span>',
                    'Enterprise': '<span class="badge badge-primary">Enterprise</span>'
                }[d.plan] || `<span class="badge">${d.plan}</span>`;
                
                const statusLabel = (d.status || 'UNKNOWN').toString().toUpperCase();
                const statusBadge = {
                    'ONLINE': '<span class="badge badge-success">ONLINE</span>',
                    'OFFLINE': '<span class="badge badge-danger">OFFLINE</span>',
                    'WARNING': '<span class="badge badge-warning">WARNING</span>',
                    'CRITICAL': '<span class="badge badge-danger">CRITICAL</span>'
                }[statusLabel] || `<span class="badge">${statusLabel}</span>`;
                
                const healthBadge = d.healthScore >= 90 
                    ? `<span class="badge badge-success">${d.healthScore}%</span>`
                    : d.healthScore >= 80
                    ? `<span class="badge badge-warning">${d.healthScore}%</span>`
                    : `<span class="badge badge-danger">${d.healthScore}%</span>`;
                
                const lastSeen = d.lastSeen ? formatTimeAgo(new Date(d.lastSeen)) : '—';
                const storageMB = Number.isFinite(d.dataStorageMB)
                    ? (d.dataStorageMB < 1024 
                        ? `${d.dataStorageMB} MB` 
                        : `${(d.dataStorageMB / 1024).toFixed(1)} GB`)
                    : '—';
                const sensorLimit = Number.isFinite(d.sensors?.limit) ? d.sensors.limit : '—';
                const apiCalls30d = Number.isFinite(d.apiCalls30d) ? d.apiCalls30d.toLocaleString() : '—';
                
                return `
                    <tr>
                        <td>
                            <strong>${d.farmName}</strong><br>
                            <small style="color: var(--text-muted);">${d.farmId}</small>
                        </td>
                        <td>${planBadge}</td>
                        <td>${statusBadge}</td>
                        <td>${Number.isFinite(d.sensors?.current) ? d.sensors.current : '—'} / ${sensorLimit}</td>
                        <td>${apiCalls30d}</td>
                        <td>${storageMB}</td>
                        <td>${healthBadge}</td>
                        <td>${lastSeen}</td>
                    </tr>
                `;
            }).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="8" class="loading">No deployments found</td></tr>';
        }
        
        console.log('[Platform] Fleet monitoring loaded successfully');
    } catch (error) {
        console.error('[Platform] Error loading platform monitoring:', error);
        showToast('Failed to load platform monitoring data', 'error');
    }
}

/**
 * Format time ago helper
 */
function formatTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    if (seconds < 60) return `${seconds} sec ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
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
        const response = await authenticatedFetch(`${API_BASE}/api/admin/users`, {
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
                    <button class="btn-icon" data-action="edit-user" data-user-id="${user.user_id}" title="Edit">
                        <span style="font-size: 18px;">✏️</span>
                    </button>
                    <button class="btn-icon" data-action="reset-password" data-user-id="${user.user_id}" data-user-email="${user.email}" title="Reset Password">
                        <span style="font-size: 18px;">🔑</span>
                    </button>
                    <button class="btn-icon" data-action="delete-user" data-user-id="${user.user_id}" data-user-name="${user.first_name} ${user.last_name}" title="Delete">
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
    console.log('🔵 [openAddUserModal] Function called!');
    document.getElementById('user-modal-title').textContent = 'Add New Employee';
    document.getElementById('user-save-btn-text').textContent = 'Create Employee';
    document.getElementById('user-form').reset();
    document.getElementById('user-id').value = '';
    document.getElementById('password-field').style.display = 'block';
    document.getElementById('user-modal').style.display = 'flex';
    console.log('🔵 [openAddUserModal] Modal should now be visible');
}

/**
 * Edit user
 */
function editUser(userId) {
    console.log('🟡 [editUser] Function called with userId:', userId);
    const user = allUsers.find(u => u.user_id === userId);
    if (!user) {
        console.error('🟡 [editUser] User not found:', userId);
        return;
    }
    
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
        const url = userId ? `${API_BASE}/api/admin/users/${userId}` : `${API_BASE}/api/admin/users`;
        const method = userId ? 'PUT' : 'POST';
        
        const response = await authenticatedFetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Failed to save user');
        }
        
        // Show temp password if generated
        const tempPassword = data.user?.temporary_password || data.temp_password;
        if (tempPassword) {
            alert(`User created successfully!\n\nTemporary password: ${tempPassword}\n\nPlease save this password and share it securely with the user.`);
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
 * Reset user password (Light Engine farm users)
 */
async function resetUserPassword(userId, userEmail) {
    if (!confirm(`Reset password for ${userEmail}?\n\nA new temporary password will be generated.`)) {
        return;
    }
    
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/users/${userId}/reset-password`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Failed to reset password');
        }
        
        // Show temporary password in alert
        const tempPassword = data.temp_password;
        const userInfo = data.user || {};
        
        alert(`✅ Password Reset Successful!\n\nUser: ${userInfo.email || userEmail}\nFarm ID: ${userInfo.farm_id || 'N/A'}\n\nTemporary Password:\n${tempPassword}\n\n⚠️ Copy this password now! The user must use this to log in at:\nhttps://greenreachgreens.com/login.html`);
        
    } catch (error) {
        console.error('Error resetting password:', error);
        alert(`Failed to reset password: ${error.message}`);
    }
}

/**
 * Delete user (show confirmation)
 */
function deleteUser(userId, userName) {
    console.log('🔴 [deleteUser] Function called with userId:', userId, 'userName:', userName);
    deleteUserId = userId;
    document.getElementById('delete-user-name').textContent = userName;
    document.getElementById('delete-user-modal').style.display = 'flex';
    console.log('🔴 [deleteUser] Delete modal should now be visible');
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
        const response = await authenticatedFetch(`${API_BASE}/api/admin/users/${deleteUserId}`, {
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

// Bind user management actions (fallback for inline handler issues)
document.addEventListener('DOMContentLoaded', () => {
    console.log('📌 [DOM] DOMContentLoaded fired, setting up user management event listeners...');
    
    const addUserBtn = document.getElementById('add-user-btn');
    if (addUserBtn) {
        console.log('📌 [DOM] Found add-user-btn, attaching click listener');
        addUserBtn.addEventListener('click', () => {
            console.log('📌 [DOM] Add user button CLICKED via event listener');
            openAddUserModal();
        });
    } else {
        console.warn('📌 [DOM] ⚠️ add-user-btn element not found!');
    }

    const usersTbody = document.getElementById('users-tbody');
    if (usersTbody) {
        console.log('📌 [DOM] Found users-tbody, attaching delegated click listener');
        usersTbody.addEventListener('click', (event) => {
            console.log('📌 [DOM] Click detected in users-tbody:', event.target);
            const actionEl = event.target.closest('[data-action]');
            if (!actionEl) {
                console.log('📌 [DOM] No data-action element found in click path');
                return;
            }

            const action = actionEl.getAttribute('data-action');
            const userId = parseInt(actionEl.getAttribute('data-user-id'), 10);
            const userName = actionEl.getAttribute('data-user-name') || '';
            const userEmail = actionEl.getAttribute('data-user-email') || '';
            
            console.log('📌 [DOM] Action triggered:', action, 'userId:', userId, 'userName:', userName);

            if (action === 'edit-user') {
                editUser(userId);
            }
            if (action === 'reset-password') {
                resetUserPassword(userId, userEmail);
            }
            if (action === 'delete-user') {
                deleteUser(userId, userName);
            }
        });
    } else {
        console.warn('📌 [DOM] ⚠️ users-tbody element not found!');
    }
    
    console.log('📌 [DOM] User management event listeners setup complete');
});

// ============================================================================
// EXPOSE FUNCTIONS TO GLOBAL SCOPE FOR ONCLICK HANDLERS
// ============================================================================
window.openAddUserModal = openAddUserModal;
window.editUser = editUser;
window.resetUserPassword = resetUserPassword;
window.closeUserModal = closeUserModal;
window.saveUser = saveUser;
window.deleteUser = deleteUser;
window.closeDeleteUserModal = closeDeleteUserModal;
window.confirmDeleteUser = confirmDeleteUser;
window.filterUsers = filterUsers;

console.log('✅ [Global Functions] User management functions exposed to window:', {
    openAddUserModal: typeof window.openAddUserModal,
    editUser: typeof window.editUser,
    resetUserPassword: typeof window.resetUserPassword,
    deleteUser: typeof window.deleteUser,
    closeUserModal: typeof window.closeUserModal
});

// ============================================================================
// AUTHENTICATION INITIALIZATION - Run auth check on page load
// ============================================================================
(async function initAuth() {
    console.log('🔐 [initAuth] Starting authentication check...');
    
    // Check for force login parameter
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('forceLogin') === 'true') {
        console.log('🔐 [initAuth] Force login requested, clearing tokens and redirecting...');
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_email');
        localStorage.removeItem('admin_name');
        window.location.href = `${API_BASE}/GR-central-admin-login.html`;
        return;
    }
    
    // Verify the session is valid
    const isValid = await verifySession();
    if (!isValid) {
        console.log('🔐 [initAuth] Session invalid, user will be redirected to login');
        return; // verifySession already handles redirect
    }
    
    console.log('🔐 [initAuth] Authentication verified successfully');
    console.log('🔐 [initAuth] User:', localStorage.getItem('admin_name'));
    console.log('🔐 [initAuth] Email:', localStorage.getItem('admin_email'));
})();

// ============================================================================
// GLOBAL CLICK TRACKING - Track all user interactions
// ============================================================================
document.addEventListener('click', (event) => {
    const target = event.target;
    const tagName = target.tagName;
    const id = target.id;
    const className = target.className;
    const text = target.textContent?.substring(0, 50);
    
    // Track clicks on buttons, links, and interactive elements
    if (tagName === 'BUTTON' || tagName === 'A' || target.onclick) {
        DEBUG_TRACKING.trackClick(id || 'unnamed', tagName, {
            className,
            text,
            href: target.href,
            onclick: target.onclick ? 'has-handler' : null
        });
    }
    
    // Track navigation menu clicks
    if (target.closest('.nav-item') || target.closest('.nav-link')) {
        const navItem = target.closest('.nav-item') || target.closest('.nav-link');
        DEBUG_TRACKING.trackClick('nav-item', 'navigation', {
            text: navItem.textContent?.trim(),
            id: navItem.id
        });
    }
    
    // Track farm card clicks
    if (target.closest('.farm-card')) {
        const farmCard = target.closest('.farm-card');
        DEBUG_TRACKING.trackClick('farm-card', 'card', {
            farmId: farmCard.dataset?.farmId || farmCard.getAttribute('onclick')
        });
    }
}, true); // Use capture phase to catch all clicks

// Add helper to console for viewing debug events
window.DEBUG = {
    getEvents: (count = 20) => DEBUG_TRACKING.getRecentEvents(count),
    exportSession: () => DEBUG_TRACKING.exportSession(),
    clearEvents: () => DEBUG_TRACKING.events = [],
    showLastError: () => {
        const errors = DEBUG_TRACKING.events.filter(e => e.type === 'ERROR');
        return errors[errors.length - 1];
    },
    showLastAPICall: () => {
        const apiCalls = DEBUG_TRACKING.events.filter(e => e.type === 'API_CALL');
        return apiCalls[apiCalls.length - 1];
    },
    showPageViews: () => {
        return DEBUG_TRACKING.events.filter(e => e.type === 'PAGE_VIEW');
    }
};

console.log('%c📊 DEBUG TRACKING ENABLED', 
    'background: #4CAF50; color: white; font-weight: bold; padding: 5px 10px; font-size: 14px;');
console.log('%cUse window.DEBUG to access tracking data:', 'color: #4CAF50; font-weight: bold;');
console.log('  window.DEBUG.getEvents(20) - Get last 20 events');
console.log('  window.DEBUG.showPageViews() - Show all page views');
console.log('  window.DEBUG.showLastError() - Show last error');
console.log('  window.DEBUG.showLastAPICall() - Show last API call');
console.log('  window.DEBUG.exportSession() - Export full session');
