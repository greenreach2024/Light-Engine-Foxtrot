/**
 * GreenReach Central Operations
 * Enterprise-grade farm management and monitoring system
 */

// Production hardening: suppress browser console telemetry unless explicitly enabled.
(function() {
    try {
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const debugEnabled = isLocal || localStorage.getItem('gr.debug') === 'true';
        if (!debugEnabled && typeof console !== 'undefined') {
            const noop = function() {};
            const originalError = typeof console.error === 'function' ? console.error.bind(console) : noop;
            console.log = noop;
            console.debug = noop;
            console.info = noop;
            console.warn = noop;
            console.error = function() {
                originalError('[client] error');
            };
        }
    } catch (_) {}
})();

// =============================================================================
// DEBUG TRACKING SYSTEM
// Tracks all user navigation, clicks, API calls, and errors
// =============================================================================

const DEBUG_TRACKING = {
    enabled: false, // Disabled to reduce API load
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
        
        // Handle 401 Unauthorized - session expired.
        // Only force logout for admin API endpoints (/api/admin/).
        // Non-admin endpoints (sync, ai-insights, market-intelligence, etc.)
        // may legitimately return 401 for admin JWT and should not kill the session.
        if (response.status === 401) {
            const isAdminEndpoint = typeof url === 'string' && url.includes('/api/admin/');
            if (!isAdminEndpoint) {
                DEBUG_TRACKING.trackError('NON_ADMIN_AUTH_MISMATCH', `401 from non-admin endpoint (non-fatal)`, {
                    url,
                    status: response.status
                });
                return response;
            }
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

/**
 * Show a reusable detail modal (overlay + card) with key/value rows.
 * Uses the same visual pattern as the info-card system.
 *
 * @param {string} title - Modal title
 * @param {Array<{label: string, value: any}>} fields - Key/value pairs to display
 */
function showDetailModal(title, fields) {
    // Remove any existing detail modal
    const prev = document.getElementById('detailModal');
    const prevOv = document.getElementById('detailModalOverlay');
    if (prev) prev.remove();
    if (prevOv) prevOv.remove();

    const rows = fields.map(f =>
        `<tr><td style="padding:6px 12px 6px 0;font-weight:600;white-space:nowrap;color:#a0aec0;">${f.label}</td>` +
        `<td style="padding:6px 0;color:#e2e8f0;">${f.value ?? '-'}</td></tr>`
    ).join('');

    const html = `
        <div id="detailModalOverlay" onclick="closeDetailModal()" style="position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9998;"></div>
        <div id="detailModal" style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a202c;border:1px solid #2d3748;border-radius:12px;padding:24px 28px;z-index:9999;min-width:340px;max-width:520px;box-shadow:0 20px 40px rgba(0,0,0,0.4);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <h3 style="margin:0;color:#63b3ed;font-size:1.1rem;">${title}</h3>
                <button onclick="closeDetailModal()" style="background:none;border:none;color:#a0aec0;font-size:1.3rem;cursor:pointer;padding:0 4px;">&times;</button>
            </div>
            <table style="width:100%;border-collapse:collapse;">${rows}</table>
        </div>`;

    document.body.insertAdjacentHTML('beforeend', html);
}

function closeDetailModal() {
    const m = document.getElementById('detailModal');
    const o = document.getElementById('detailModalOverlay');
    if (m) m.remove();
    if (o) o.remove();
}

window.showDetailModal = showDetailModal;
window.closeDetailModal = closeDetailModal;

function showConfirmModal(options = {}) {
    const {
        title = 'Confirm Action',
        message = 'Are you sure you want to continue?',
        submessage = '',
        confirmText = 'Confirm',
        tone = 'danger'
    } = options;

    const modal = document.getElementById('confirm-action-modal');
    const titleEl = document.getElementById('confirm-action-title');
    const messageEl = document.getElementById('confirm-action-message');
    const submessageEl = document.getElementById('confirm-action-submessage');
    const confirmBtn = document.getElementById('confirm-action-confirm-btn');

    if (!modal || !titleEl || !messageEl || !submessageEl || !confirmBtn) {
        return Promise.resolve(window.confirm(message));
    }

    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmBtn.textContent = confirmText;

    if (submessage) {
        submessageEl.textContent = submessage;
        submessageEl.style.display = 'block';
    } else {
        submessageEl.textContent = '';
        submessageEl.style.display = 'none';
    }

    confirmBtn.classList.remove('btn-danger', 'btn-primary');
    confirmBtn.classList.add(tone === 'primary' ? 'btn-primary' : 'btn-danger');

    modal.style.display = 'flex';

    return new Promise((resolve) => {
        confirmModalResolver = resolve;
    });
}

function closeConfirmActionModal() {
    const modal = document.getElementById('confirm-action-modal');
    if (modal) {
        modal.style.display = 'none';
    }

    if (confirmModalResolver) {
        const resolve = confirmModalResolver;
        confirmModalResolver = null;
        resolve(false);
    }
}

function confirmActionModalApproved() {
    const modal = document.getElementById('confirm-action-modal');
    if (modal) {
        modal.style.display = 'none';
    }

    if (confirmModalResolver) {
        const resolve = confirmModalResolver;
        confirmModalResolver = null;
        resolve(true);
    }
}

window.showConfirmModal = showConfirmModal;
window.closeConfirmActionModal = closeConfirmActionModal;
window.confirmActionModalApproved = confirmActionModalApproved;

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const modal = document.getElementById('confirm-action-modal');
    if (modal && modal.style.display === 'flex') {
        closeConfirmActionModal();
    }
});

/**
 * Data Normalization Functions
 * 
 * These functions handle field variations in zone and group data to ensure
 * consistent access across different data formats.
 * 
 * NOTE: This is duplicated from lib/data-adapters.js due to HTML <script> tag
 * limitations (cannot import ES6 modules without bundler).
 * 
 * TODO: When build system is implemented, import from lib/data-adapters.js instead
 * 
 * Pattern from: farm-summary.html (existing precedent)
 * See: DATA_FORMAT_STANDARDS.md
 * 
 * @see lib/data-adapters.js - Canonical implementation
 */

/**
 * Normalize zone data to handle field variations
 * @param {Object} zone - Raw zone object
 * @returns {Object|null} Normalized zone object with consistent field names
 */
function normalizeZone(zone) {
    if (!zone) return null;
    return {
        id: zone.id || zone.zone_id || zone.zoneId || 'unknown',
        name: zone.name || zone.zone_name || zone.id || 'Unnamed Zone',
        ...zone
    };
}

/**
 * Normalize group data to handle field variations
 * @param {Object} group - Raw group object
 * @returns {Object|null} Normalized group object with consistent field names
 */
function normalizeGroup(group) {
    if (!group) return null;
    return {
        id: group.id,
        name: group.name,
        zone: group.zone || group.zone_id || group.zoneId || group.location,
        ...group
    };
}

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
    'ai-rules': {
        title: 'AI Rules & Safety Policy',
        subtitle: 'Guardrails that keep recommendations safe, practical, and adaptive',
        sections: [
            {
                title: 'What This Page Shows',
                content: '<ul><li>Authoritative policy rules for AI recommendations</li><li>Priority, status, and review requirements for each rule</li><li>Operational guardrails for high-humidity and limited-control rooms</li><li>Recommendation format requirements for consistent outputs</li></ul>'
            },
            {
                title: 'Why This Matters',
                content: 'This rulebook ensures AI recommendations remain safe and useful in non-ideal rooms. It prevents unsafe automation, enforces sensor sanity checks, and documents tradeoffs so staff can trust and audit AI guidance.'
            },
            {
                title: 'Common Actions',
                content: 'Review rules after incidents, add new guardrails when edge cases are discovered, and flag high-risk actions for human approval. Keep the rulebook current as equipment capabilities change.'
            }
        ]
    },
    'ai-reference': {
        title: 'AI Reference Sites',
        subtitle: 'Curated policy, regulatory, and safety references',
        sections: [
            {
                title: 'What This Page Shows',
                content: '<ul><li>Links to AI governance references and policy sources</li><li>Regulatory guidance for compliance and audit trails</li><li>Safety and risk management frameworks</li></ul>'
            },
            {
                title: 'Why This Matters',
                content: 'A shared reference library keeps GreenReach aligned with evolving AI regulations and best practices. It supports consistent policy updates and faster audits.'
            },
            {
                title: 'Common Actions',
                content: 'Add new regulations as they emerge and remove outdated sources. Use this list when updating AI rules and staff training.'
            }
        ]
    },
    'grant-summary': {
        title: 'Grant Summary',
        subtitle: 'Portfolio-level analytics for the grant wizard program',
        sections: [
            {
                title: 'What This Page Shows',
                content: '<ul><li>Total grant users and new users per month</li><li>Total grants supported and new grants this month</li><li>Average wizard completion and completion counts</li><li>Wizard pages ranked by time spent and view frequency</li></ul>'
            },
            {
                title: 'Why We Monitor This',
                content: 'These metrics help prioritize improvements in the grant wizard, identify drop-off points, and prove program impact to partners and funders.'
            },
            {
                title: 'Common Actions',
                content: 'Refine steps with high drop-off, optimize guidance where time spent is highest, and report monthly adoption trends.'
            }
        ]
    },
    'grant-users': {
        title: 'Grant Users',
        subtitle: 'Manage profiles and support grant applicants',
        sections: [
            {
                title: 'What This Page Shows',
                content: '<ul><li>Grant user profiles and business details</li><li>Last login and last active wizard tab</li><li>Email updates and account actions</li></ul>'
            },
            {
                title: 'Why We Monitor This',
                content: 'Grant applicants often need support. This view helps staff resolve login issues, update contact info, and track where users are in the process.'
            },
            {
                title: 'Common Actions',
                content: 'Update email addresses, check last active tab for support calls, and soft-delete users upon request.'
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
let confirmModalResolver = null;

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
            <div class="admin-user-name">${adminName || 'Admin'}</div>
            <div class="admin-user-email">${adminEmail || ''}</div>
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
                        { label: 'Pricing & Products', view: 'pricing-management' },
                        { label: 'Delivery Services', view: 'delivery-management' }
                    ]
                },
                {
                    title: 'Procurement',
                    items: [
                        { label: 'Catalog Management', view: 'procurement-catalog' },
                        { label: 'Supplier Management', view: 'procurement-suppliers' },
                        { label: 'Revenue', view: 'procurement-revenue' }
                    ]
                },
                {
                    title: 'Analytics',
                    items: [
                        { label: 'AI Insights', view: 'analytics' },
                        { label: 'Market Intelligence', view: 'market-intelligence' },
                        { label: 'Energy', view: 'energy' },
                        { label: 'Harvest Forecast', view: 'harvest' }
                    ]
                },
                {
                    title: 'Grant Intelligence',
                    items: [
                        { label: 'Grant Summary', view: 'grant-summary' },
                        { label: 'Grant Users', view: 'grant-users' }
                    ]
                },
                {
                    title: 'Finance',
                    items: [
                        { label: 'Network Accounting', view: 'accounting' }
                    ]
                },
                {
                    title: 'Marketing',
                    items: [
                        { label: 'Marketing Dashboard', view: 'marketing-ai' },
                        { label: 'S.C.O.T.T.', view: 'scott-core' }
                    ]
                },
                {
                    title: 'Network',
                    items: [
                        { label: 'Network Dashboard', view: 'network' },
                        { label: 'Grower Network', view: 'grower-mgmt' }
                    ]
                },
                {
                    title: 'AI Governance',
                    items: [
                        { label: 'F.A.Y.E. Core', view: 'faye-core', iframe: '/faye-core.html' },
                        { label: 'AI Rules', view: 'ai-rules' },
                        { label: 'AI Reference Sites', view: 'ai-reference' },
                        { label: 'AI Agent Monitor', view: 'ai-monitoring' }
                    ]
                },
                {
                    title: 'Admin Tools',
                    items: [
                        { label: 'Calendar', view: 'calendar' },
                        { label: 'Tasks', view: 'tasks' }
                    ]
                },
                {
                    title: 'Management',
                    items: [
                        { label: 'All Farms', view: 'farms' },
                        { label: 'Farm Management', view: 'farm-management' },
                        { label: 'Users', view: 'users' },
                        { label: 'Recipes', view: 'recipes' },
                        { label: 'Salad Mixes', view: 'salad-mixes' }
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
                if (item.iframe) {
                    return `
                        <div class="nav-item" onclick="navigateIframe('${item.view}', '${item.iframe}', this)" style="cursor: pointer;">
                            <span>${item.label}</span>
                        </div>
                    `;
                } else if (item.external) {
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
            checkAlerts(),
            loadDeliveryReadiness()
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
        
        // Add data freshness indicator
        if (data.dataFreshness) {
            const staleMins = data.dataFreshness.staleFarms;
            if (staleMins !== null && staleMins !== undefined) {
                let freshnessText = '';
                let freshnessColor = '';
                
                if (staleMins < 10) {
                    freshnessText = 'Fresh';
                    freshnessColor = 'var(--accent-green)';
                } else if (staleMins < 60) {
                    const minsAgo = Math.floor(staleMins);
                    freshnessText = `${minsAgo}m ago`;
                    freshnessColor = 'var(--accent-yellow)';
                } else if (staleMins < 1440) {  // < 24 hours
                    const hoursAgo = Math.floor(staleMins / 60);
                    freshnessText = `${hoursAgo}h ago`;
                    freshnessColor = 'var(--accent-red)';
                } else {
                    const daysAgo = Math.floor(staleMins / 1440);
                    freshnessText = `${daysAgo}d ago`;
                    freshnessColor = 'var(--accent-red)';
                }
                
                // Update the mode indicator to show freshness
                const farmsChangeEl = document.getElementById('kpi-farms-change');
                if (farmsChangeEl) {
                    farmsChangeEl.innerHTML = `<span style="color: ${freshnessColor}">● ${freshnessText}</span>`;
                    farmsChangeEl.title = `Last sync: ${new Date(data.dataFreshness.newestSync).toLocaleString()}`;
                }
            }
        }
        
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
 * Load delivery readiness data for the overview dashboard card
 */
async function loadDeliveryReadiness() {
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/delivery/readiness`);
        if (!response.ok) {
            console.warn('[Delivery Readiness] API returned', response.status);
            return;
        }
        const data = await response.json();
        if (!data.success) return;

        const { farms, summary } = data;

        // Update summary counts
        const readyEl = document.getElementById('dr-ready-count');
        const enabledEl = document.getElementById('dr-enabled-count');
        const totalEl = document.getElementById('dr-total-count');
        if (readyEl) readyEl.textContent = summary.ready || 0;
        if (enabledEl) enabledEl.textContent = summary.enabled || 0;
        if (totalEl) totalEl.textContent = summary.total || 0;

        // Render farm rows
        const tbody = document.getElementById('dr-farm-rows');
        if (!tbody) return;

        if (farms.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No farms have configured delivery yet</td></tr>';
            return;
        }

        tbody.innerHTML = farms.map(f => {
            const statusBadge = f.ready
                ? '<span style="background: rgba(16,185,129,0.15); color: var(--accent-green); padding: 2px 8px; border-radius: 4px; font-size: 11px;">Ready</span>'
                : f.enabled
                    ? '<span style="background: rgba(245,158,11,0.15); color: var(--accent-yellow); padding: 2px 8px; border-radius: 4px; font-size: 11px;">Partial</span>'
                    : '<span style="background: rgba(107,114,128,0.15); color: var(--text-muted); padding: 2px 8px; border-radius: 4px; font-size: 11px;">Off</span>';
            return `<tr>
                <td style="font-weight: 500;">${f.farm_id}</td>
                <td>${statusBadge}</td>
                <td>${f.active_windows}</td>
                <td>${f.active_zones}</td>
                <td>$${f.base_fee.toFixed(2)}</td>
            </tr>`;
        }).join('');
    } catch (error) {
        console.warn('[Delivery Readiness] Error loading:', error);
        // Non-critical — leave card in loading state, don't block dashboard
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
            <td>
                <button class="btn" onclick="drillToFarm('${farmId}')">View</button>
            </td>
            <td>
                <button class="btn btn-danger" onclick="deleteFarm('${farmId}', '${farm.name}')">Delete</button>
            </td>
        </tr>
        `;
    }).join('');
}

/**
 * Delete a farm by farm ID (requires admin password)
 */
async function deleteFarm(farmId, farmName) {
    const confirmed = await showConfirmModal({
        title: 'Delete Farm',
        message: `Delete farm ${farmId}?`,
        submessage: `Farm: ${farmName}\n\nThis action cannot be undone.`,
        confirmText: 'Delete Farm'
    });
    if (!confirmed) {
        return;
    }

    const password = prompt('Enter your GreenReach admin password to confirm deletion:');
    if (!password) {
        return;
    }
    
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/farms/${encodeURIComponent(farmId)}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password })
        });
        
        const data = await response.json();
        
        if (response.ok && data.status === 'success') {
            alert(`✅ Successfully deleted:\n\n${data.deleted.farms} farm(s)\n\nFarm IDs: ${data.farmIds.join(', ')}`);
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
async function buildFarmEquipmentSummary(farmId, farm) {
    const roomsList = Array.isArray(farm.rooms) ? farm.rooms : [];
    const zonesList = Array.isArray(farm.zones) ? farm.zones : (Array.isArray(farm.environmental?.zones) ? farm.environmental.zones : []);
    const roomsCount = Number.isFinite(farm.rooms) ? farm.rooms : roomsList.length;
    const zonesCount = Number.isFinite(farm.zones) ? farm.zones : zonesList.length;

    const devices = await resolveFarmDevices(farmId, farm);
    const groups = await resolveFarmGroups(farmId, farm);

    const deviceSummary = summarizeDevices(devices);
    const lightSummary = summarizeLights(groups, devices);

    return {
        rooms: roomsCount,
        zones: zonesCount,
        devicesTotal: devices.length,
        lightsAssigned: lightSummary.assigned,
        lightsTotal: lightSummary.total,
        sensorsAssigned: deviceSummary.sensors.assigned,
        sensorsTotal: deviceSummary.sensors.total,
        hvacAssigned: deviceSummary.hvac.assigned,
        hvacTotal: deviceSummary.hvac.total,
        irrigationAssigned: deviceSummary.irrigation.assigned,
        irrigationTotal: deviceSummary.irrigation.total
    };
}

async function resolveFarmDevices(farmId, farm) {
    if (Array.isArray(farm.devices)) return farm.devices;
    if (Array.isArray(farm.devices?.devices)) return farm.devices.devices;
    try {
        let response;
        try {
            response = await authenticatedFetch(`/api/admin/farms/${farmId}/devices`);
            if (!response || !response.ok) throw new Error('No admin devices endpoint');
        } catch (err) {
            response = await authenticatedFetch(`${API_BASE}/api/sync/${farmId}/devices`);
        }
        if (!response || !response.ok) return [];
        const data = await response.json();
        const normalized = normalizeDeviceList(data);
        if (normalized.length > 0) return normalized;

        // Fallback: derive sensor devices from telemetry when devices are not synced
        try {
            let telemetryRes;
            try {
                telemetryRes = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/zones`);
                if (!telemetryRes || !telemetryRes.ok) throw new Error('No admin zones endpoint');
            } catch (zoneErr) {
                telemetryRes = await authenticatedFetch(`${API_BASE}/api/sync/${farmId}/telemetry`);
            }
            if (telemetryRes.ok) {
                const telemetry = await telemetryRes.json();
                const zones = telemetry?.zones || telemetry?.telemetry?.zones || [];
                const derived = zones.map((zone, index) => ({
                    id: zone.id || `zone-${index + 1}`,
                    device_id: zone.id || `zone-${index + 1}`,
                    name: zone.name || zone.id || `Zone ${index + 1}`,
                    device_type: 'sensor',
                    type: 'sensor',
                    category: 'sensor',
                    room: zone.room || zone.roomName || null,
                    zone: zone.id || null
                }));
                return derived;
            }
        } catch (fallbackError) {
            console.warn('[equipment-summary] Telemetry fallback failed:', fallbackError);
        }

        return [];
    } catch (error) {
        console.warn('[equipment-summary] Failed to load devices:', error);
        return [];
    }
}

function normalizeDeviceList(payload) {
    if (!payload) return [];
    if (Array.isArray(payload.devices)) return payload.devices;
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.devices?.devices)) return payload.devices.devices;
    return [];
}

async function resolveFarmGroups(farmId, farm) {
    if (Array.isArray(farm.groups)) return farm.groups;
    // Use groupsData array from enriched farm detail response
    if (Array.isArray(farm.groupsData) && farm.groupsData.length > 0) return farm.groupsData;
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/groups`);
        if (!response || !response.ok) return [];
        const data = await response.json();
        return Array.isArray(data.groups) ? data.groups : [];
    } catch (error) {
        console.warn('[equipment-summary] Failed to load groups:', error);
        return [];
    }
}

function summarizeLights(groups, devices) {
    const assignedLightIds = new Set();
    let assignedCount = 0;

    (groups || []).forEach((group) => {
        if (Array.isArray(group.lights)) {
            group.lights.forEach((lightId) => {
                if (lightId) assignedLightIds.add(lightId);
            });
        } else if (Number.isFinite(group.light_count)) {
            assignedCount += group.light_count;
        }
    });

    const assigned = assignedLightIds.size > 0 ? assignedLightIds.size : assignedCount;
    const total = devices.filter((device) => isLightDevice(device)).length || assigned;

    return { assigned, total };
}

function summarizeDevices(devices) {
    const sensors = summarizeDevicesByType(devices, isSensorDevice);
    const hvac = summarizeDevicesByType(devices, isHvacDevice);
    const irrigation = summarizeDevicesByType(devices, isIrrigationDevice);

    return { sensors, hvac, irrigation };
}

function summarizeDevicesByType(devices, predicate) {
    const matches = devices.filter((device) => predicate(device));
    const assigned = matches.filter((device) => hasAssignment(device)).length;
    return { total: matches.length, assigned };
}

function hasAssignment(device) {
    const candidate = device?.location || device?.room || device?.room_id || device?.roomId || device?.zone || device?.zone_id || device?.zoneId;
    if (!candidate) return false;
    const normalized = String(candidate).trim().toLowerCase();
    return normalized !== '' && normalized !== 'unknown' && normalized !== 'unassigned';
}

function normalizeDeviceType(device) {
    return String(device?.device_type || device?.type || device?.category || '').toLowerCase();
}

function isSensorDevice(device) {
    const type = normalizeDeviceType(device);
    return /(sensor|probe|monitor|env|environment|bme|co2|temp|humidity|pressure)/.test(type);
}

function isLightDevice(device) {
    const type = normalizeDeviceType(device);
    return /(light|led|fixture|lamp|grow)/.test(type);
}

function isHvacDevice(device) {
    const type = normalizeDeviceType(device);
    return /(hvac|fan|vent|ac|air|heater|cooler|mini\s*-?split|dehumidifier|humidifier)/.test(type);
}

function isIrrigationDevice(device) {
    const type = normalizeDeviceType(device);
    return /(irrigation|pump|valve|water|fertigation|mist|sprinkler)/.test(type);
}

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
        
        // Resolve live equipment counts from group assignments + room mapping + equipment overview
        const equipmentSummary = await buildFarmEquipmentSummary(farmId, farm);
        console.log('[loadFarmDetails] Equipment summary:', equipmentSummary);

        const rooms = equipmentSummary.rooms;
        const devices = equipmentSummary.devicesTotal;
        const zones = equipmentSummary.zones;
        console.log('[loadFarmDetails] Extracted counts:', { rooms, zones, devices });

        const setCount = (elementId, assigned, total, fallbackLabel) => {
            const el = document.getElementById(elementId);
            if (!el) return;
            const display = `${assigned}/${total}`;
            el.textContent = display;
            if (total === 0) {
                el.title = fallbackLabel || 'Not configured';
            } else {
                el.title = `${assigned} assigned of ${total} total`;
            }
        };

        // Update equipment status with live counts
        setCount('detail-lights', equipmentSummary.lightsAssigned, equipmentSummary.lightsTotal, 'Lights not configured');
        setCount('detail-sensors', equipmentSummary.sensorsAssigned, equipmentSummary.sensorsTotal, 'Sensors not configured');
        setCount('detail-hvac', equipmentSummary.hvacAssigned, equipmentSummary.hvacTotal, 'HVAC not configured');
        setCount('detail-irrigation', equipmentSummary.irrigationAssigned, equipmentSummary.irrigationTotal, 'Irrigation not configured');
        
        // Load farm summary information
        console.log('[loadFarmDetails] Calling loadFarmSummary...');
        await loadFarmSummary(farmId, farm);
        console.log('[loadFarmDetails] loadFarmSummary complete');
        
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
        
        // Load full recipe library for this farm's recipes tab (read-only)
        console.log('[loadFarmDetails] Calling loadFarmRecipeLibrary...');
        await loadFarmRecipeLibrary();
        console.log('[loadFarmDetails] loadFarmRecipeLibrary complete');
        
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
        // Fetch telemetry data with history (admin endpoint first)
        let response;
        try {
            response = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/zones`);
            if (!response || !response.ok) throw new Error('No admin zones endpoint');
        } catch (zoneErr) {
            response = await authenticatedFetch(`${API_BASE}/api/sync/${farmId}/telemetry`);
        }
        if (!response.ok) {
            console.warn('[Farm Trends] No telemetry data available');
            return;
        }
        
        const data = await response.json();
        const zones = data.zones || data.telemetry?.zones || [];
        
        if (zones.length === 0) {
            console.warn('[Farm Trends] No zones in telemetry');
            return;
        }
        
        const zone = zones[0];
        console.log('[Farm Trends] Using zone data:', zone);
        
        // Extract sensor history
        const tempHistory = zone.sensors?.tempC?.history || [];
        const humidityHistory = zone.sensors?.rh?.history || [];
        const pressureHistory = zone.sensors?.pressureHpa?.history || zone.sensors?.pressure_hpa?.history || [];
        const gasHistory = zone.sensors?.gasKohm?.history || zone.sensors?.gas_kohm?.history || [];
        const co2History = zone.sensors?.co2?.history || [];
        
        const trendPoints = 96; // 24h at 15-minute intervals
        // Use most recent data points (history is newest-first)
        const last24Temp = getLatestHistory(tempHistory, trendPoints);
        const last24Humidity = getLatestHistory(humidityHistory, trendPoints);
        const last24Pressure = getLatestHistory(pressureHistory, trendPoints);
        const last24Gas = getLatestHistory(gasHistory, trendPoints);
        const last24Co2 = getLatestHistory(co2History, trendPoints);
        
        // Calculate VPD at ~15-minute intervals from temp/humidity history
        const last24Vpd = buildVpdSeries(tempHistory, humidityHistory, trendPoints);
        
        // Create combined trends chart
        const chartEl = document.getElementById('env-chart');
        if (chartEl && last24Temp.length > 0) {
            chartEl.innerHTML = `
                <canvas id="farm-combined-trends-chart"></canvas>
            `;
            
            // Build datasets, filtering out those with no data
            const datasets = [
                { label: 'Temperature °C', data: last24Temp, color: '#3b82f6' },
                { label: 'Humidity %', data: last24Humidity, color: '#10b981' },
                { label: 'VPD kPa', data: last24Vpd.length > 0 ? last24Vpd : [], color: '#8b5cf6' }
            ].filter(dataset => dataset.data.length > 0);
            
            // Add pressure if data available
            if (last24Pressure.length > 0 && last24Pressure.some(v => v > 0)) {
                datasets.push({ label: 'Pressure hPa', data: last24Pressure, color: '#f97316' });
            }
            
            // Add gas if data available
            if (last24Gas.length > 0 && last24Gas.some(v => v > 0)) {
                datasets.push({ label: 'Gas kΩ', data: last24Gas, color: '#ec4899' });
            }
            
            const co2HasData = last24Co2.length > 0 && last24Co2.some(v => v > 0);
            // CO2 disabled - no sensor available
            // if (co2HasData) {
            //     datasets.splice(2, 0, { label: 'CO₂ ppm', data: last24Co2, color: '#f59e0b' });
            // }
            
            // Draw combined horizontal trend lines
            drawCombinedTrendsChart('farm-combined-trends-chart', {
                datasets,
                noDataLabels: co2HasData ? [] : ['CO₂']
            });
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
        pressure: null,
        gas: null,
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
    let roomMetadataZones = []; // string array like ["Zone 1", "Zone 2"]
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
                roomMetadataZones = Array.isArray(room.zones) ? room.zones : [];
                // Don't use environmental data from room - it's not there
            }
        }
    } catch (error) {
        console.error('[room-detail] Failed to load room metadata:', error);
    }
    
    // Step 2: ALWAYS fetch zone telemetry for environmental data
    try {
        let zonesRes;
        try {
            zonesRes = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/zones`);
            if (!zonesRes || !zonesRes.ok) throw new Error('No admin zones endpoint');
        } catch (zoneErr) {
            zonesRes = await authenticatedFetch(`${API_BASE}/api/sync/${farmId}/telemetry`);
        }
        if (zonesRes.ok) {
            const zonesData = await zonesRes.json();
            console.log('[room-detail] Zones telemetry data:', zonesData);
            const zones = zonesData.zones || zonesData.telemetry?.zones || [];
            console.log('[room-detail] Environmental zones:', zones);
            
            // Use telemetry data for environmental readings
            if (zones.length > 0) {
                const zone = zones[0];
                console.log('[room-detail] Using first zone for room metrics:', zone);
                
                // Extract sensor data - support both direct properties and sensors object
                const tempC = zone.temperature_c ?? zone.temp ?? zone.tempC ?? zone.sensors?.tempC?.current;
                const rh = zone.humidity ?? zone.rh ?? zone.sensors?.rh?.current;
                const pressure = zone.pressure_hpa ?? zone.pressure ?? zone.sensors?.pressureHpa?.current ?? zone.sensors?.pressure_hpa?.current;
                const gas = zone.gas_kohm ?? zone.gas ?? zone.sensors?.gasKohm?.current ?? zone.sensors?.gas_kohm?.current;
                const co2 = zone.co2 ?? zone.sensors?.co2?.current;
                const vpd = zone.vpd ?? zone.sensors?.vpd?.current;
                
                roomData.temperature = tempC;
                roomData.humidity = rh;
                roomData.pressure = pressure;
                roomData.gas = gas;
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
    
    // Step 2b: Merge room metadata zones with telemetry zones
    // Room metadata has zone names (e.g. ["Zone 1", "Zone 2"])
    // Telemetry may only have zones with sensors — add missing ones as stubs
    if (roomMetadataZones.length > 0) {
        const telemetryZoneNames = new Set(roomData.zones.map(z => 
            (z.name || z.zone_name || '').toLowerCase()
        ));
        roomMetadataZones.forEach((zoneName, idx) => {
            if (!telemetryZoneNames.has(String(zoneName).toLowerCase())) {
                const zoneNum = idx + 1;
                roomData.zones.push({
                    id: `zone-${zoneNum}`,
                    name: String(zoneName),
                    location: String(zoneName),
                    sensors: {}
                });
                console.log(`[room-detail] Added room metadata zone without sensor: ${zoneName}`);
            }
        });
    }
    
    // Step 3: Fetch devices for this farm/room
    try {
        let devResponse;
        try {
            devResponse = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/devices`);
            if (!devResponse || !devResponse.ok) throw new Error('No admin devices endpoint');
        } catch (e) {
            devResponse = await authenticatedFetch(`${API_BASE}/api/sync/${farmId}/devices`);
        }
        if (devResponse && devResponse.ok) {
            const devData = await devResponse.json();
            const allDevices = devData.devices || [];
            // Filter to this room if devices have a room/location field, else show all
            roomData.devices = allDevices.filter(d => {
                const loc = d.room || d.room_id || d.roomId || d.location || '';
                return !loc || loc === roomId || loc === roomData.name;
            }).map(d => ({
                deviceId: d.device_code || d.deviceId || d.device_id || d.id,
                type: d.device_type || d.type || 'sensor',
                zone: d.zone || d.zone_id || d.location || 'Unassigned',
                status: deriveDeviceStatus(d),
                lastSeen: formatDeviceLastSeen(d)
            }));
            console.log('[room-detail] Loaded devices:', roomData.devices.length);
        }
    } catch (err) {
        console.warn('[room-detail] Failed to fetch devices:', err);
    }
    
    // Step 4: Fetch groups to count trays
    try {
        const grpRes = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/groups`);
        if (grpRes && grpRes.ok) {
            const grpData = await grpRes.json();
            const groups = grpData.groups || [];
            // Sum trays from groups that belong to this room (or all if no room filter)
            let totalTrays = 0;
            groups.forEach(g => {
                const grpRoom = g.room || g.room_id || g.roomId || '';
                if (!grpRoom || grpRoom === roomId || grpRoom === roomData.name) {
                    totalTrays += (g.trays || g.tray_count || g.trayCount || 0);
                }
            });
            roomData.trays = totalTrays;
            console.log('[room-detail] Counted trays from groups:', totalTrays);
        }
    } catch (err) {
        console.warn('[room-detail] Failed to fetch groups for tray count:', err);
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
    const pressure = roomData.pressure != null ? `${roomData.pressure.toFixed(1)} hPa` : 'N/A';
    const gas = roomData.gas != null ? `${roomData.gas.toFixed(1)} kΩ` : 'N/A';
    const co2 = roomData.co2 != null ? `${Math.round(roomData.co2)} ppm` : 'No data';
    const vpd = roomData.vpd != null ? `${roomData.vpd.toFixed(2)} kPa` : 'No data';
    
    document.getElementById('room-temp').textContent = temp;
    document.getElementById('room-temp-change').textContent = roomData.temperature != null ? 'Live reading' : 'No sensor';
    document.getElementById('room-humidity').textContent = humidity;
    document.getElementById('room-humidity-change').textContent = roomData.humidity != null ? 'Live reading' : 'No sensor';
    document.getElementById('room-pressure').textContent = pressure;
    document.getElementById('room-pressure-change').textContent = roomData.pressure != null ? 'Live reading' : 'No sensor';
    document.getElementById('room-gas').textContent = gas;
    document.getElementById('room-gas-change').textContent = roomData.gas != null ? 'Live reading' : 'No sensor';
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
        const groupsRes = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/groups`);
        if (groupsRes && groupsRes.ok) {
            const groupsData = await groupsRes.json();
            const groups = groupsData.groups || [];
            console.log('[loadRoomZones] Groups data:', groups);
            
            // Count groups per zone - store under multiple keys for flexible matching
            groups.forEach(group => {
                const zoneId = group.zone || group.zone_id || group.zoneId;
                if (zoneId) {
                    // Store under the original key
                    groupsByZone[zoneId] = (groupsByZone[zoneId] || 0) + 1;
                    
                    // Also store under normalized variations for matching
                    // "1" → also key as "zone-1", "room-xxx:zone-1", "room-xxx-z1"
                    const zoneNum = String(zoneId).replace(/[^0-9]/g, ''); // Extract just the number
                    if (zoneNum && !isNaN(zoneNum)) {
                        const altKeys = [
                            `zone-${zoneNum}`,
                            `${roomId}:zone-${zoneNum}`,
                            `${roomId}-z${zoneNum}`
                        ];
                        altKeys.forEach(key => {
                            groupsByZone[key] = (groupsByZone[key] || 0) + 1;
                        });
                    }
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
            // Construct compound zone ID to match groups format: "room-xxx:1"
            const rawZoneId = zone.zone_id || zone.zoneId || zone.id || zone.name || `${idx + 1}`;
            const zoneId = String(rawZoneId).includes(':') ? String(rawZoneId) : `${roomId}:${rawZoneId}`;
            const name = zone.zone_name || zone.name || `Zone ${rawZoneId}`;
            
            // Extract sensor data - support both direct properties and sensors object
            const tempC = zone.temperature_c ?? zone.temp ?? zone.tempC ?? zone.sensors?.tempC?.current;
            const rh = zone.humidity ?? zone.rh ?? zone.sensors?.rh?.current;
            
            // Count groups assigned to this zone - normalize zone ID matching
            // Handle variations: "room-3xxjln:zone-1" vs "room-3xxjln-z1" vs "1"
            const zoneNum = String(rawZoneId).replace(/^zone-/, ''); // Extract "1" from "zone-1"
            const normalizedZoneId = zoneId.replace(':zone-', '-z'); // Convert "room:zone-1" to "room-z1"
            const groupsCount = groupsByZone[zoneId] || groupsByZone[normalizedZoneId] || groupsByZone[String(rawZoneId)] || groupsByZone[zoneNum] || 0;
            
            console.log(`[loadRoomZones] Zone ${zoneId}:`, { name, tempC, rh, groupsCount, normalizedZoneId, rawZone: zone });
            
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
    
    // Use passed data if available
    if (Array.isArray(devicesData) && devicesData.length > 0 && devicesData[0].deviceId) {
        devices = devicesData.map(device => ({
            deviceId: device.deviceId,
            type: device.type,
            zone: device.zone,
            status: device.status || deriveDeviceStatus(device),
            lastSeen: device.lastSeen || formatDeviceLastSeen(device)
        }));
    } else {
        // Fallback: fetch devices from API
        try {
            let response;
            try {
                response = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/devices`);
                if (!response || !response.ok) throw new Error('No admin devices endpoint');
            } catch (e) {
                response = await authenticatedFetch(`${API_BASE}/api/sync/${farmId}/devices`);
            }
            if (response && response.ok) {
                const data = await response.json();
                const allDevices = data.devices || [];
                devices = allDevices.filter(d => {
                    const loc = d.room || d.room_id || d.roomId || d.location || '';
                    return !loc || loc === roomId;
                }).map(d => ({
                    deviceId: d.device_code || d.deviceId || d.device_id || d.id,
                    type: d.device_type || d.type || 'sensor',
                    zone: d.zone || d.zone_id || d.location || 'Unassigned',
                    status: deriveDeviceStatus(d),
                    lastSeen: formatDeviceLastSeen(d)
                }));
            }
        } catch (err) {
            console.warn('[loadRoomDevices] Failed to fetch devices from API:', err);
        }
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
    
    let trays = [];
    
    // Derive tray data from groups (each group may have trays)
    try {
        const grpRes = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/groups`);
        if (grpRes && grpRes.ok) {
            const grpData = await grpRes.json();
            const groups = grpData.groups || [];
            groups.forEach(g => {
                const grpRoom = g.room || g.room_id || g.roomId || '';
                if (!grpRoom || grpRoom === roomId) {
                    const trayCount = g.trays || g.tray_count || g.trayCount || 0;
                    const crop = g.crop || g.recipe || g.name || 'Unknown';
                    const zone = g.zone || g.zone_id || g.zoneId || 'Unassigned';
                    const groupId = g.id || g.group_id || g.groupId || 'unknown';
                    for (let i = 1; i <= trayCount; i++) {
                        trays.push({
                            trayId: `${groupId}-T${i}`,
                            group: g.name || groupId,
                            zone: zone,
                            crop: crop,
                            stage: g.stage || g.growth_stage || 'Active',
                            planted: g.planted_date || g.startDate || '-',
                            status: g.status || 'active'
                        });
                    }
                }
            });
        }
    } catch (err) {
        console.warn('[loadRoomTrays] Failed to fetch groups for tray data:', err);
    }
    
    countEl.textContent = `${trays.length} ${trays.length === 1 ? 'tray' : 'trays'}`;
    
    if (trays.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty">No tray data available. Add groups with trays to see tray information.</td></tr>';
    } else {
        tbody.innerHTML = trays.map(tray => `
            <tr>
                <td><code>${tray.trayId}</code></td>
                <td>${tray.group}</td>
                <td>${tray.zone}</td>
                <td>${tray.crop}</td>
                <td>${tray.stage}</td>
                <td>${tray.planted}</td>
                <td><span class="badge badge-${tray.status === 'active' ? 'success' : 'warning'}">${tray.status}</span></td>
            </tr>
        `).join('');
    }
}

/**
 * Load energy consumption data for a room
 */
async function loadRoomEnergy(farmId, roomId, today, week) {
    // Handle null/undefined energy values gracefully
    if (today == null && week == null) {
        document.getElementById('room-energy-today').textContent = 'No data';
        document.getElementById('room-energy-week').textContent = 'No data';
        document.getElementById('room-energy-avg').textContent = 'No data';
        const trendEl = document.getElementById('room-energy-trend');
        trendEl.textContent = 'N/A';
        trendEl.style.color = '#94a3b8';
        
        const chartEl = document.getElementById('room-energy-chart');
        if (chartEl) {
            chartEl.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:2rem;">No energy data available</div>';
        }
        return;
    }
    
    const todayVal = today || 0;
    const weekVal = week || 0;
    const avgPerDay = weekVal > 0 ? (weekVal / 7).toFixed(1) : '0.0';
    const trend = Math.random() > 0.5 ? 'down' : 'up';
    const trendPercent = (Math.random() * 10 + 3).toFixed(1);
    
    document.getElementById('room-energy-today').textContent = `${todayVal} kWh`;
    document.getElementById('room-energy-week').textContent = `${weekVal} kWh`;
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
    const pressureHistory = zone.sensors?.pressureHpa?.history || zone.sensors?.pressure_hpa?.history || [];
    const gasHistory = zone.sensors?.gasKohm?.history || zone.sensors?.gas_kohm?.history || [];
    const co2History = zone.sensors?.co2?.history || [];
    
    // Get current values as fallback
    const tempCurrent = zone.sensors?.tempC?.current ?? zone.temperature_c ?? zone.temp ?? 20;
    const rhCurrent = zone.sensors?.rh?.current ?? zone.humidity ?? zone.rh ?? 50;
    const pressureCurrent = zone.sensors?.pressureHpa?.current ?? zone.sensors?.pressure_hpa?.current ?? zone.pressure_hpa ?? zone.pressure ?? null;
    const gasCurrent = zone.sensors?.gasKohm?.current ?? zone.sensors?.gas_kohm?.current ?? zone.gas_kohm ?? zone.gas ?? null;
    const co2Current = zone.sensors?.co2?.current ?? zone.co2 ?? null;
    
    const trendPoints = 96; // 24h at 15-minute intervals
    // Use most recent data points from history, or create flat line from current value
    const last24Temp = tempHistory.length > 0 ? getLatestHistory(tempHistory, trendPoints) : Array(trendPoints).fill(tempCurrent);
    const last24Humidity = humidityHistory.length > 0 ? getLatestHistory(humidityHistory, trendPoints) : Array(trendPoints).fill(rhCurrent);
    const last24Pressure = pressureHistory.length > 0 ? getLatestHistory(pressureHistory, trendPoints) : (pressureCurrent != null ? Array(trendPoints).fill(pressureCurrent) : []);
    const last24Gas = gasHistory.length > 0 ? getLatestHistory(gasHistory, trendPoints) : (gasCurrent != null ? Array(trendPoints).fill(gasCurrent) : []);
    const last24Co2 = co2History.length > 0
        ? getLatestHistory(co2History, trendPoints)
        : (co2Current != null ? Array(trendPoints).fill(co2Current) : []);
    
    // Calculate VPD at ~15-minute intervals from temp/humidity history
    const last24Vpd = buildVpdSeries(tempHistory, humidityHistory, trendPoints);
    
    console.log('[room-trends] Drawing charts with data:', {
        temp: last24Temp.length,
        humidity: last24Humidity.length,
        pressure: last24Pressure.length,
        gas: last24Gas.length,
        co2: last24Co2.length,
        vpd: last24Vpd.length
    });
    
    // Build datasets, filtering out those with no data
    const datasets = [
        { label: 'Temp °C', data: last24Temp, color: '#3b82f6' },
        { label: 'Humidity %', data: last24Humidity, color: '#10b981' },
        { label: 'VPD kPa', data: last24Vpd, color: '#8b5cf6' }
    ];
    
    // Add pressure if data available
    if (last24Pressure.length > 0 && last24Pressure.some(v => v > 0)) {
        datasets.push({ label: 'Pressure hPa', data: last24Pressure, color: '#f97316' });
    }
    
    // Add gas if data available
    if (last24Gas.length > 0 && last24Gas.some(v => v > 0)) {
        datasets.push({ label: 'Gas kΩ', data: last24Gas, color: '#ec4899' });
    }
    
    // Only add CO2 if we have actual data
    const co2HasData = last24Co2.length > 0 && last24Co2.some(v => v > 0);
    if (co2HasData) {
        datasets.splice(2, 0, { label: 'CO₂ ppm', data: last24Co2, color: '#f59e0b' });
    }
    
    // Draw combined chart with all available metrics
    drawCombinedTrendsChart('room-combined-trends-chart', {
        datasets,
        noDataLabels: co2HasData ? [] : ['CO₂']
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
 * Draw combined environmental trends chart with horizontal trend lines
 */
function drawCombinedTrendsChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
        console.warn(`[drawCombinedTrendsChart] Canvas not found: ${canvasId}`);
        return;
    }
    
    // Make canvas responsive to container
    const container = canvas.parentElement;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight || 380;
    
    // Set canvas size to match container (accounting for device pixel ratio)
    const dpr = window.devicePixelRatio || 1;
    canvas.width = containerWidth * dpr;
    canvas.height = containerHeight * dpr;
    canvas.style.width = containerWidth + 'px';
    canvas.style.height = containerHeight + 'px';
    
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    
    const width = containerWidth;
    const height = containerHeight;
    const padding = { top: 50, right: 110, bottom: 50, left: 110 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Draw chart area background (match card background)
    ctx.fillStyle = '#1a202c';
    ctx.fillRect(padding.left, padding.top, chartWidth, chartHeight);
    
    // Draw grid lines (horizontal)
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    const numDatasets = config.datasets.length;
    for (let i = 0; i <= numDatasets; i++) {
        const y = padding.top + (chartHeight * i / numDatasets);
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + chartWidth, y);
        ctx.stroke();
    }
    
    // Draw vertical grid lines (time markers)
    ctx.strokeStyle = '#222';
    for (let i = 0; i <= 4; i++) {
        const x = padding.left + (chartWidth * i / 4);
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + chartHeight);
        ctx.stroke();
    }
    
    // Draw each dataset as horizontal trend line
    config.datasets.forEach((dataset, datasetIndex) => {
        if (!dataset.data || dataset.data.length === 0) return;
        
        const min = Math.min(...dataset.data);
        const max = Math.max(...dataset.data);
        const range = max - min || 1;
        
        // Each metric gets its own horizontal band
        const bandTop = padding.top + (chartHeight / numDatasets) * datasetIndex;
        const bandHeight = chartHeight / numDatasets * 0.7; // Use 70% of band for the line
        const bandCenter = bandTop + (chartHeight / numDatasets) * 0.5;
        
        // Draw horizontal center line for reference
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(padding.left, bandCenter);
        ctx.lineTo(padding.left + chartWidth, bandCenter);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Draw trend line
        ctx.strokeStyle = dataset.color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        
        dataset.data.forEach((value, index) => {
            // Prevent division by zero for single-point data
            const xProgress = dataset.data.length > 1 ? (index / (dataset.data.length - 1)) : 0.5;
            const x = padding.left + xProgress * chartWidth;
            // Map value to position within the band (inverted so high values are at top)
            const normalizedValue = range > 0 ? (value - min) / range : 0.5;
            const y = bandCenter - (normalizedValue - 0.5) * bandHeight;
            
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        
        ctx.stroke();
        
        // Draw current value point at end
        const lastValue = dataset.data[dataset.data.length - 1];
        const lastX = padding.left + chartWidth;
        const lastY = bandCenter - ((lastValue - min) / range - 0.5) * bandHeight;
        
        ctx.fillStyle = dataset.color;
        ctx.beginPath();
        ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw label on the left
        ctx.fillStyle = dataset.color;
        ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(dataset.label, padding.left - 12, bandCenter + 5);
        
        // Draw current value on the right
        ctx.font = 'bold 14px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(lastValue.toFixed(1), padding.left + chartWidth + 10, bandCenter + 5);
        
        // Draw min/max range next to current value
        ctx.fillStyle = '#888';
        ctx.font = '10px system-ui, -apple-system, sans-serif';
        ctx.fillText(`(${min.toFixed(0)}-${max.toFixed(0)})`, padding.left + chartWidth + 10, bandCenter + 18);
    });
    
    // Draw time axis labels at bottom
    ctx.fillStyle = '#718096';
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    
    const timeLabels = ['24h ago', '18h', '12h', '6h', 'Now'];
    timeLabels.forEach((label, index) => {
        const x = padding.left + (chartWidth * index / (timeLabels.length - 1));
        ctx.fillText(label, x, height - 20);
    });

    if (config.noDataLabels && config.noDataLabels.length > 0) {
        ctx.fillStyle = '#a0aec0';
        ctx.font = '12px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`${config.noDataLabels.join(', ')}: No data`, padding.left, height - 5);
    }
}

function getLatestHistory(history, count) {
    if (!Array.isArray(history) || history.length === 0) return [];
    const slice = history.slice(0, count);
    return slice.slice().reverse();
}

function coerceNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function downsampleHistory(history, targetPoints) {
    if (!Array.isArray(history) || history.length === 0) return [];
    if (!targetPoints || targetPoints <= 0) return history.slice();
    if (history.length <= targetPoints) return history.slice();
    const step = Math.max(1, Math.floor(history.length / targetPoints));
    const sampled = [];
    for (let i = 0; i < history.length && sampled.length < targetPoints; i += step) {
        sampled.push(history[i]);
    }
    return sampled;
}

function buildVpdSeries(tempHistory, humidityHistory, targetPoints = 96) {
    const tempSeries = downsampleHistory(getLatestHistory(tempHistory, targetPoints * 3), targetPoints)
        .map(coerceNumber);
    const humiditySeries = downsampleHistory(getLatestHistory(humidityHistory, targetPoints * 3), targetPoints)
        .map(coerceNumber);
    const length = Math.min(tempSeries.length, humiditySeries.length);
    const vpdSeries = [];
    for (let i = 0; i < length; i++) {
        const T = tempSeries[i];
        const RH = humiditySeries[i];
        if (T == null || RH == null) {
            vpdSeries.push(null);
            continue;
        }
        const SVP = 0.6108 * Math.exp((17.27 * T) / (T + 237.3));
        const vpd = SVP * (1 - RH / 100);
        vpdSeries.push(Math.round(vpd * 1000) / 1000);
    }
    return vpdSeries;
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
            console.log('[zone-detail] Farm data received');
            const environmental = farmData.farm?.environmental || farmData.environmental;
            const zones = environmental?.zones || [];
            console.log('[zone-detail] Environmental zones count:', zones.length);
            
            // Extract zone number and room from zoneId
            // Handles formats: "room-knukf2:zone-1", "room-knukf2:1", "zone-1", "1"
            const zoneNumber = zoneId.match(/\d+$/)?.[0]; // Extract trailing number
            const roomPart = zoneId.includes(':') ? zoneId.split(':')[0] : roomId;
            
            console.log('[zone-detail] Looking for zone with:', {
                zoneId,
                zoneNumber,
                roomId,
                roomPart,
                availableZones: zones.map(z => {
                    const normalized = normalizeZone(z);
                    return { id: normalized.id, name: normalized.name };
                })
            });
            
            // Try multiple matching strategies
            const zone = zones.find(z => {
                const normalized = normalizeZone(z);
                const zId = normalized.id || '';
                const zName = normalized.name || '';
                
                // Strategy 1: Exact match on any ID field
                if (zId === zoneId || zName === zoneId) return true;
                
                // Strategy 2: Match compound format "room:zone-1" with "room:1"
                if (zoneNumber) {
                    // Check if zone ID matches room:number format
                    if (zId === `${roomPart}:${zoneNumber}`) return true;
                    if (zId === `${roomId}:${zoneNumber}`) return true;
                    
                    // Check if zone ID ends with :number or -number
                    if (zId.endsWith(`:${zoneNumber}`) || zId.endsWith(`-${zoneNumber}`)) return true;
                    
                    // Check if zone ID is just the number
                    if (zId === zoneNumber) return true;
                    
                    // Check zone name for number
                    if (zName.includes(`Zone ${zoneNumber}`) || zName === zoneNumber) return true;
                }
                
                return false;
            });
            
            if (zone) {
                console.log('[zone-detail] ✅ Found matching zone:', {
                    id: zone.id || zone.zone_id || zone.zoneId,
                    name: zone.name || zone.zone_name,
                    hasSensors: !!zone.sensors,
                    hasTemp: !!(zone.sensors?.tempC?.current ?? zone.temperature_c ?? zone.temp ?? zone.tempC),
                    hasHumidity: !!(zone.sensors?.rh?.current ?? zone.humidity ?? zone.rh)
                });
                zoneData = {
                    zoneId: zone.id || zone.zone_id || zone.zoneId || zoneId,
                    name: zone.name || zone.zone_name || zoneId,
                    temperature: zone.sensors?.tempC?.current ?? zone.temperature_c ?? zone.temp ?? zone.tempC,
                    humidity: zone.sensors?.rh?.current ?? zone.humidity ?? zone.rh,
                    co2: zone.sensors?.co2?.current ?? zone.co2,
                    vpd: zone.sensors?.vpd?.current ?? zone.vpd,
                    ppfd: (zone.sensors?.ppfd?.current ?? zone.ppfd) || zone.light,
                    pressure: (zone.sensors?.pressureHpa?.current ?? zone.sensors?.pressure_hpa?.current ?? zone.pressure_hpa) || zone.pressure,
                    gas: (zone.sensors?.gasKohm?.current ?? zone.sensors?.gas_kohm?.current ?? zone.gas_kohm) || zone.gas,
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
                console.error('[zone-detail] ❌ Zone not found!', {
                    requestedZoneId: zoneId,
                    requestedRoomId: roomId,
                    zoneNumber,
                    availableZones: zones.map(z => {
                        const normalized = normalizeZone(z);
                        return { id: normalized.id, name: normalized.name };
                    }),
                    totalZones: zones.length
                });
                // Show error message on page
                const errorMsg = zones.length === 0 
                    ? `No telemetry data available for farm ${farmId}. Edge device may not be syncing.`
                    : `Zone "${zoneId}" not found. Available zones: ${zones.map(z => z.id || z.name).join(', ')}`;
                console.warn('[zone-detail]', errorMsg);
            }
        }
        
        // Fetch groups data from farm_data table via admin API
        const groupsRes = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/groups`);
        if (groupsRes && groupsRes.ok) {
            const groupsData = await groupsRes.json();
            const groups = groupsData.groups || [];
            console.log('[zone-detail] Groups data received:', groups.length, 'total groups');
            
            // Count groups assigned to this zone
            // Zone format variations: "room-knukf2:1", "room-knukf2:zone-1", "zone-1", "1"
            const zoneNumber = zoneId.match(/\d+$/)?.[0];
            const roomPart = zoneId.includes(':') ? zoneId.split(':')[0] : roomId;
            
            const zoneGroups = groups.filter(g => {
                const normalized = normalizeGroup(g);
                const groupZone = normalized.zone;
                if (!groupZone) return false;
                
                // Strategy 1: Exact match
                if (groupZone === zoneId) return true;
                
                // Strategy 2: Match by zone number
                if (zoneNumber) {
                    // Match compound formats
                    if (groupZone === `${roomPart}:${zoneNumber}`) return true;
                    if (groupZone === `${roomId}:${zoneNumber}`) return true;
                    if (groupZone === `${roomPart}:zone-${zoneNumber}`) return true;
                    if (groupZone === `${roomId}:zone-${zoneNumber}`) return true;
                    
                    // Match endings
                    if (groupZone.endsWith(`:${zoneNumber}`) || groupZone.endsWith(`-${zoneNumber}`)) return true;
                    
                    // Match plain number or zone-N format
                    if (groupZone === `zone-${zoneNumber}` || groupZone === zoneNumber) return true;
                }
                
                return false;
            });
            
            zoneData.groups = zoneGroups.length;
            console.log('[zone-detail] Found', zoneData.groups, 'groups for zone:', {
                zoneId,
                roomId,
                zoneNumber,
                matchingGroups: zoneGroups.map(g => {
                    const normalized = normalizeGroup(g);
                    return { 
                        id: normalized.id, 
                        name: normalized.name,
                        zone: normalized.zone
                    };
                })
            });
        }
    } catch (error) {
        console.error('[zone-detail] Failed to fetch zone data:', error);
        // Show error notification on page
        const title = document.getElementById('zone-detail-title');
        if (title) {
            title.innerHTML = `
                <span style="color: var(--accent-red);">⚠️ Error Loading Zone Data</span>
                <div style="font-size: 14px; font-weight: normal; color: var(--text-secondary); margin-top: 8px;">
                    ${error.message || 'Failed to load zone information. Check console for details.'}
                </div>
            `;
        }
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
        
        // Filter groups for this zone with improved matching
        // Zone ID formats: "room-knukf2:zone-1" (compound), "room-knukf2:1", "zone-1" (legacy), or just "1" (number)
        const zoneNumber = zoneId.match(/\d+$/)?.[0];
        const roomPart = zoneId.includes(':') ? zoneId.split(':')[0] : roomId;
        
        const zoneGroups = allGroups.filter(g => {
            const normalized = normalizeGroup(g);
            const groupZone = normalized.zone;
            if (!groupZone) return false;
            
            // Strategy 1: Exact match
            if (groupZone === zoneId) return true;
            
            // Strategy 2: Match by zone number
            if (zoneNumber) {
                // Match compound formats
                if (groupZone === `${roomPart}:${zoneNumber}`) return true;
                if (groupZone === `${roomId}:${zoneNumber}`) return true;
                if (groupZone === `${roomPart}:zone-${zoneNumber}`) return true;
                if (groupZone === `${roomId}:zone-${zoneNumber}`) return true;
                
                // Match endings
                if (groupZone.endsWith(`:${zoneNumber}`) || groupZone.endsWith(`-${zoneNumber}`)) return true;
                
                // Match plain number or zone-N format
                if (groupZone === `zone-${zoneNumber}` || groupZone === zoneNumber) return true;
            }
            
            return false;
        });
        
        console.log('[loadZoneGroupsAndPPFD] Filtered to zone:', zoneGroups.length, 'groups for', zoneId, {
            matchingGroups: zoneGroups.map(g => {
                const normalized = normalizeGroup(g);
                return { id: normalized.id, name: normalized.name, zone: normalized.zone };
            })
        });
        
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
            const recipeName = group.recipe || group.plan || 'No recipe';
            return `
            <tr onclick="viewGroupDetail('${farmId}', '${roomId}', '${zoneId}', '${escapeHtml(group.id || group.group_id || '')}')">
                <td>${escapeHtml(group.id || group.group_id || 'N/A')}</td>
                <td>${escapeHtml(group.name || 'Unnamed')}</td>
                <td>${group.lights?.length || group.light_count || 0}</td>
                <td>${group.trays || group.tray_count || 0}</td>
                <td title="Current PPFD: ${ppfdDisplay}">${escapeHtml(recipeName)}</td>
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
    tbody.innerHTML = '<tr><td colspan="5" class="loading">Loading sensors...</td></tr>';
    
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
            tbody.innerHTML = '<tr><td colspan="5" class="empty">No sensors configured for this zone</td></tr>';
            return;
        }
        
        // Build sensor rows — one row per physical device per metric
        // This shows each individual sensor instead of a single aggregated row
        const sensors = [];
        const sensorMap = zone.sensors;
        const sensorDevices = zone.sensorDevices || [];

        // Derive device type label from sensorDevices or zone source
        function getDeviceTypeLabel(deviceId) {
            const sd = sensorDevices.find(d => d.id === deviceId);
            if (sd) {
                const t = (sd.type || '').toLowerCase();
                if (t.includes('woio') || t.includes('switchbot')) return 'SwitchBot';
                if (t.includes('hub')) return 'Hub';
                if (t) return t;
            }
            const src = (zone.meta?.source || '').toLowerCase();
            if (src.includes('switchbot') || src === 'live-sync') return 'SwitchBot';
            return 'Sensor';
        }

        // Format a timestamp into a relative or absolute label
        function formatLastSeen(isoStr) {
            if (!isoStr) return 'Active';
            const ms = Date.now() - new Date(isoStr).getTime();
            if (ms < 0 || isNaN(ms)) return 'Active';
            if (ms < 60000) return 'Just now';
            if (ms < 3600000) return `${Math.floor(ms/60000)}m ago`;
            if (ms < 86400000) return `${Math.floor(ms/3600000)}h ago`;
            return `${Math.floor(ms/86400000)}d ago`;
        }

        // Metric definitions: key, display name, unit, formatter
        const metricDefs = [
            { key: 'tempC', label: 'Temperature', unit: '°C', fmt: v => v.toFixed(1) },
            { key: 'rh',    label: 'Humidity',    unit: '%',  fmt: v => v.toFixed(0) },
            { key: 'co2',   label: 'CO2',         unit: ' ppm', fmt: v => v.toFixed(0) },
            { key: 'ppfd',  label: 'PPFD',        unit: ' μmol/m²/s', fmt: v => v.toFixed(0) },
            { key: 'pressure', label: 'Pressure', unit: ' hPa', fmt: v => v.toFixed(1) },
        ];

        // Iterate each metric and emit one row per source device
        for (const { key, label, unit, fmt } of metricDefs) {
            const bucket = sensorMap[key];
            if (!bucket) continue;
            const sources = bucket.sources || {};
            const sourceEntries = Object.entries(sources);
            if (sourceEntries.length > 0) {
                // Per-device rows
                for (const [srcId, src] of sourceEntries) {
                    if (src.current == null || !Number.isFinite(src.current)) continue;
                    const devName = src.name || sensorDevices.find(d => d.id === srcId)?.name || srcId;
                    const typeLabel = getDeviceTypeLabel(srcId);
                    sensors.push({
                        type: label,
                        device: `${devName} (${typeLabel})`,
                        value: `${fmt(src.current)}${unit}`,
                        status: 'active',
                        lastSeen: formatLastSeen(src.updatedAt)
                    });
                }
            } else if (bucket.current != null && Number.isFinite(bucket.current)) {
                // No per-source breakdown — fall back to zone aggregate
                sensors.push({
                    type: label,
                    device: sensorDevices.length ? sensorDevices.map(d => d.name || d.id).join(', ') : 'Sensor',
                    value: `${fmt(bucket.current)}${unit}`,
                    status: 'active',
                    lastSeen: formatLastSeen(zone.meta?.lastSampleAt || zone.meta?.lastSync)
                });
            }
        }

        // VPD — always a calculated metric, show as a single row
        if (sensorMap.vpd && sensorMap.vpd.current != null) {
            sensors.push({
                type: 'VPD',
                device: 'Calculated',
                value: `${sensorMap.vpd.current.toFixed(2)} kPa`,
                status: 'active',
                lastSeen: 'Real-time'
            });
        }
        
        if (sensors.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty">No active sensor readings</td></tr>';
            return;
        }
        
        // Render sensors table
        tbody.innerHTML = sensors.map(sensor => `
            <tr>
                <td>${escapeHtml(sensor.device)}</td>
                <td>${escapeHtml(sensor.type)}</td>
                <td><strong>${escapeHtml(sensor.value)}</strong></td>
                <td><span class="status-badge status-${sensor.status}">${sensor.status}</span></td>
                <td>${escapeHtml(sensor.lastSeen)}</td>
            </tr>
        `).join('');
        
    } catch (error) {
        console.error('[loadZoneSensors] Failed to load sensors:', error);
        tbody.innerHTML = '<tr><td colspan="5" class="empty error">Failed to load sensors - ' + escapeHtml(error.message) + '</td></tr>';
    }
}

/**
 * View Group Detail (Drill-down to specific group)
 */
async function viewGroupDetail(farmId, roomId, zoneId, groupId) {
    console.log(`[group-detail] Loading group detail: ${groupId} in zone ${zoneId}, room ${roomId}, farm ${farmId}`);
    currentFarmId = farmId;
    
    showView('group-detail-view');
    
    try {
        // Fetch groups data from admin API
        const groupsRes = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/groups`);
        if (!groupsRes || !groupsRes.ok) {
            throw new Error(`Failed to fetch groups data: ${groupsRes?.status || 'network error'}`);
        }
        
        const groupsData = await groupsRes.json();
        const groups = groupsData.groups || [];
        console.log('[group-detail] Groups data received:', groups.length, 'total groups');
        
        // Find matching group with enhanced ID matching
        const group = groups.find(g => {
            const normalized = normalizeGroup(g);
            // Match on normalized ID or any ID variation
            return normalized.id === groupId || 
                   g.id === groupId || 
                   g.group_id === groupId || 
                   g.groupId === groupId;
        });
        
        if (!group) {
            console.error('[group-detail] ❌ Group not found:', groupId);
            console.error('[group-detail] Available groups:', groups.map(g => g.id || g.group_id));
            
            // Show error state in UI
            document.getElementById('group-detail-title').textContent = `Group Not Found: ${groupId}`;
            document.getElementById('group-devices').textContent = '0';
            document.getElementById('group-devices-change').textContent = 'Group not found in sync data';
            document.getElementById('group-trays').textContent = '0';
            document.getElementById('group-trays-change').textContent = 'Group not found in sync data';
            document.getElementById('group-days-since-seed').textContent = 'No data';
            document.getElementById('group-days-since-seed-change').textContent = 'Group not found';
            document.getElementById('group-target-ppfd').textContent = 'No data';
            document.getElementById('group-target-ppfd-change').textContent = 'Group not found';
            document.getElementById('group-recipe').textContent = 'Not found';
            document.getElementById('group-recipe-change').textContent = 'Group not found';
            document.getElementById('group-schedule').textContent = 'Not found';
            document.getElementById('group-schedule-change').textContent = 'Group not found';
            
            const devicesBody = document.getElementById('group-devices-tbody');
            devicesBody.innerHTML = '<tr><td colspan="6" class="empty error">Group not found in database</td></tr>';
            const traysBody = document.getElementById('group-trays-tbody');
            traysBody.innerHTML = '<tr><td colspan="5" class="empty error">Group not found in database</td></tr>';
            return;
        }
        
        console.log('[group-detail] ✅ Found matching group:', {
            id: group.id,
            name: group.name,
            crop: group.crop,
            lights: group.lights?.length || 0,
            trays: group.trays,
            hasSeedDate: !!group.planConfig?.anchor?.seedDate
        });
        
        // Extract canonical fields (DATA_FORMAT_STANDARDS.md compliant)
        const cropName = group.crop || 'Not configured';  // Use canonical 'crop' field
        const devices = group.lights?.length || 0;         // Count light devices assigned
        const trays = group.trays || 0;                    // Canonical 'trays' field (number)
        const groupName = group.name || group.id;
        const photoperiod = group.planConfig?.schedule?.photoperiodHours;
        
        // Calculate days since seed date
        let daysSinceSeed = null;
        if (group.planConfig?.anchor?.seedDate) {
            try {
                const seedDate = new Date(group.planConfig.anchor.seedDate);
                const now = new Date();
                seedDate.setHours(0, 0, 0, 0);
                now.setHours(0, 0, 0, 0);
                daysSinceSeed = Math.floor((now - seedDate) / (1000 * 60 * 60 * 24)) + 1;
                console.log('[group-detail] Calculated days since seed:', daysSinceSeed);
            } catch (err) {
                console.warn('[group-detail] Failed to calculate days since seed:', err);
            }
        }
        
        // Update title and KPIs with real data
        document.getElementById('group-detail-title').textContent = `${groupName} - ${cropName}`;
        
        // Devices KPI
        document.getElementById('group-devices').textContent = devices.toString();
        document.getElementById('group-devices-change').textContent = 
            devices > 0 ? `${devices} light ${devices === 1 ? 'device' : 'devices'} assigned` : 'No devices assigned';
        
        // Trays KPI
        document.getElementById('group-trays').textContent = trays.toString();
        document.getElementById('group-trays-change').textContent = 
            trays > 0 ? `${trays} ${trays === 1 ? 'tray' : 'trays'} in group` : 'No trays assigned';
        
        // Days Since Seed KPI
        document.getElementById('group-days-since-seed').textContent = 
            daysSinceSeed !== null ? daysSinceSeed.toString() : 'No data';
        document.getElementById('group-days-since-seed-change').textContent = 
            daysSinceSeed !== null ? `Seeded ${daysSinceSeed} days ago` : 'Seed date not configured';
        
        // Recipe KPI
        document.getElementById('group-recipe').textContent = cropName;
        document.getElementById('group-recipe-change').textContent = 
            group.planConfig ? 'Active grow plan' : 'No active plan';
        
        // Schedule Status KPI
        const scheduleStatus = photoperiod ? `${photoperiod}h photoperiod` : 'Not configured';
        document.getElementById('group-schedule').textContent = scheduleStatus;
        document.getElementById('group-schedule-change').textContent = 
            photoperiod ? 'From grow plan' : 'Schedule not configured';
        
        // Target PPFD KPI - will be calculated from recipe if available
        document.getElementById('group-target-ppfd').textContent = 'Calculating...';
        document.getElementById('group-target-ppfd-change').textContent = 'From recipe schedule';
        
        // Calculate current PPFD from recipe DLI and actual photoperiod
        // Formula: PPFD (μmol/m²/s) = DLI (mol/m²/d) × 1,000,000 / (photoperiod_hours × 3600)
        if (daysSinceSeed !== null && group.crop) {
            try {
                const recipesRes = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/recipes`);
                if (recipesRes && recipesRes.ok) {
                    const recipesData = await recipesRes.json();
                    const recipes = recipesData.crops?.[group.crop];
                    if (recipes && Array.isArray(recipes)) {
                        // Find closest recipe day
                        let closestDay = recipes[0];
                        recipes.forEach(recipeDay => {
                            if (Math.abs(recipeDay.day - daysSinceSeed) < Math.abs(closestDay.day - daysSinceSeed)) {
                                closestDay = recipeDay;
                            }
                        });
                        
                        if (closestDay && closestDay.dli) {
                            // Get actual photoperiod from group config (not assumed value)
                            const photoperiodHours = group.planConfig?.schedule?.photoperiodHours 
                                                  || group.photoperiodHours 
                                                  || 16;  // Fallback to 16h default
                            
                            // Calculate PPFD from target DLI and actual photoperiod
                            // This ensures PPFD reflects actual "lights on" schedule, not pre-calculated recipe value
                            const targetPPFD = Math.round((closestDay.dli * 1_000_000) / (photoperiodHours * 3600));
                            
                            document.getElementById('group-target-ppfd').textContent = `${targetPPFD} μmol/m²/s`;
                            document.getElementById('group-target-ppfd-change').textContent = 
                                `Day ${closestDay.day}: ${closestDay.dli} DLI ÷ ${photoperiodHours}h`;
                            
                            console.log('[group-detail] Calculated PPFD from DLI:', {
                                crop: group.crop,
                                daysSinceSeed,
                                recipeDay: closestDay.day,
                                targetDLI: closestDay.dli,
                                photoperiodHours,
                                calculatedPPFD: targetPPFD,
                                recipePPFD: closestDay.ppfd  // For comparison (may differ if recipe assumes different photoperiod)
                            });
                        } else {
                            console.warn('[group-detail] No DLI data in recipe for', group.crop, 'day', closestDay?.day);
                            document.getElementById('group-target-ppfd').textContent = 'No DLI data';
                            document.getElementById('group-target-ppfd-change').textContent = 'Recipe missing DLI target';
                        }
                    } else {
                        console.warn('[group-detail] No recipe found for crop:', group.crop);
                        document.getElementById('group-target-ppfd').textContent = 'No recipe';
                        document.getElementById('group-target-ppfd-change').textContent = 'Recipe not loaded';
                    }
                }
            } catch (err) {
                console.warn('[group-detail] Failed to calculate PPFD:', err);
                document.getElementById('group-target-ppfd').textContent = 'Error';
                document.getElementById('group-target-ppfd-change').textContent = err.message;
            }
        } else {
            document.getElementById('group-target-ppfd').textContent = 'No data';
            document.getElementById('group-target-ppfd-change').textContent = 'Missing seed date or crop';
        }
        
        // Load devices for this group
        await loadGroupDevices(farmId, roomId, zoneId, groupId, group);
        
        // Load trays for this group
        await loadGroupTrays(farmId, roomId, zoneId, groupId, group);
        
    } catch (error) {
        console.error('[group-detail] ❌ Failed to load group detail:', error);
        
        // Show error state in UI
        document.getElementById('group-detail-title').textContent = `Error Loading Group: ${groupId}`;
        document.getElementById('group-devices').textContent = '0';
        document.getElementById('group-devices-change').textContent = 'Failed to load data';
        document.getElementById('group-trays').textContent = '0';
        document.getElementById('group-trays-change').textContent = 'Failed to load data';
        document.getElementById('group-days-since-seed').textContent = 'Error';
        document.getElementById('group-days-since-seed-change').textContent = error.message;
        document.getElementById('group-target-ppfd').textContent = 'Error';
        document.getElementById('group-target-ppfd-change').textContent = 'Failed to load';
        document.getElementById('group-recipe').textContent = 'Error';
        document.getElementById('group-recipe-change').textContent = error.message;
        document.getElementById('group-schedule').textContent = 'Error';
        document.getElementById('group-schedule-change').textContent = 'Failed to load';
        
        const devicesBody = document.getElementById('group-devices-tbody');
        devicesBody.innerHTML = `<tr><td colspan="6" class="empty error">Error: ${escapeHtml(error.message)}</td></tr>`;
        const traysBody = document.getElementById('group-trays-tbody');
        traysBody.innerHTML = `<tr><td colspan="5" class="empty error">Error: ${escapeHtml(error.message)}</td></tr>`;
    }
}

/**
 * Load devices for a specific group
 */
async function loadGroupDevices(farmId, roomId, zoneId, groupId, group) {
    const tbody = document.getElementById('group-devices-tbody');
    
    if (!group || !group.lights || group.lights.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty">No devices assigned to this group. Device assignments are managed on the edge device.</td></tr>';
        return;
    }
    
    console.log('[group-detail] Rendering devices:', group.lights.length);
    
    // Display assigned light devices
    tbody.innerHTML = group.lights.map((light, index) => {
        const deviceId = light.deviceId || light.device_id || light.id || `device-${index + 1}`;
        const status = light.status || 'unknown';
        const currentState = light.on ? 'ON' : light.on === false ? 'OFF' : 'Unknown';
        const lastSeen = light.lastSeen || light.last_seen || 'Never';
        
        return `
            <tr>
                <td>${escapeHtml(deviceId)}</td>
                <td>Light</td>
                <td><span class="badge badge-${status === 'online' ? 'success' : 'neutral'}">${status}</span></td>
                <td>${currentState}</td>
                <td>${lastSeen !== 'Never' ? new Date(lastSeen).toLocaleString() : 'Never'}</td>
                <td><button class="btn-secondary btn-sm" onclick="viewDeviceDetail('${escapeHtml(deviceId)}')">View</button></td>
            </tr>
        `;
    }).join('');
}

/**
 * Load trays for a specific group
 */
async function loadGroupTrays(farmId, roomId, zoneId, groupId, group) {
    const tbody = document.getElementById('group-trays-tbody');
    
    if (!group || !group.trays || group.trays === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty">No trays assigned to this group. Tray assignments are managed on the edge device.</td></tr>';
        return;
    }
    
    console.log('[group-detail] Group has', group.trays, 'trays (count only, detailed tray data managed on edge)');
    
    // Show tray count info (detailed tray data is managed on edge device)
    tbody.innerHTML = `
        <tr>
            <td colspan="5" class="empty">
                <div style="text-align: center; padding: 20px;">
                    <div style="font-size: 2rem; font-weight: 600; color: var(--accent-blue); margin-bottom: 8px;">${group.trays}</div>
                    <div style="color: var(--text-secondary);">Total ${group.trays === 1 ? 'Tray' : 'Trays'} in Group</div>
                    <div style="margin-top: 12px; font-size: 0.85rem; color: var(--text-muted);">Detailed tray data is managed on the edge device</div>
                </div>
            </td>
        </tr>
    `;
}

/**
 * Load farm summary information
 */
async function loadFarmSummary(farmId, farm) {
    try {
        console.log('[FarmSummary] Loading summary for farm:', farmId);
        console.log('[FarmSummary] Farm object received:', farm);
        
        // Fetch farm config to get contact info and notes (requires auth)
        const configResponse = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/config`);
        let config = {};
        let settings = {};
        
        if (configResponse && configResponse.ok) {
            const configData = await configResponse.json();
            config = configData.config || {};
            settings = config.settings || {};
            console.log('[FarmSummary] Config loaded:', config);
        } else {
            console.warn('[FarmSummary] Config request failed (likely not logged in), using farm object data only');
        }
        
        // Extract metadata from farm object (this comes from database farms.metadata)
        let metadata = farm.metadata || {};
        if (typeof metadata === 'string') {
            try {
                metadata = JSON.parse(metadata);
            } catch (parseError) {
                console.warn('[FarmSummary] Failed to parse farm metadata string:', parseError);
                metadata = {};
            }
        }

        // Merge config metadata as fallback if farm metadata is incomplete
        let configMetadata = config?.metadata || {};
        if (typeof configMetadata === 'string') {
            try {
                configMetadata = JSON.parse(configMetadata);
            } catch (parseError) {
                console.warn('[FarmSummary] Failed to parse config metadata string:', parseError);
                configMetadata = {};
            }
        }

        const mergedMetadata = { ...configMetadata, ...metadata };
        const contact = { ...(configMetadata.contact || {}), ...(metadata.contact || {}) };
        const location = { ...(configMetadata.location || {}), ...(metadata.location || {}) };
        
        // Determine deployment type based on API URL pattern
        let deploymentType = 'Unknown';
        let apiUrl = farm.apiUrl || config.api_url || metadata.url || farm.url;
        
        if (apiUrl) {
            // Check if it's a local/edge deployment
            if (apiUrl.includes('localhost') || 
                apiUrl.includes('127.0.0.1') || 
                apiUrl.match(/192\.168\.\d+\.\d+/) || 
                apiUrl.match(/10\.\d+\.\d+\.\d+/) || 
                apiUrl.match(/172\.(1[6-9]|2[0-9]|3[01])\.\d+\.\d+/)) {
                deploymentType = 'Edge (Local Network)';
            } else if (apiUrl.includes('elasticbeanstalk.com') || 
                       apiUrl.includes('amazonaws.com') || 
                       apiUrl.includes('azure') || 
                       apiUrl.includes('greenreach')) {
                deploymentType = 'Cloud';
            }
        }
        
        // Update Farm Summary card fields
        const ownerEl = document.getElementById('detail-owner');
        const contactEl = document.getElementById('detail-contact');
        const phoneEl = document.getElementById('detail-phone');
        const emailEl = document.getElementById('detail-email');
        const websiteEl = document.getElementById('detail-website');
        const addressEl = document.getElementById('detail-address');
        const deploymentTypeEl = document.getElementById('detail-deployment-type');
        const notesEl = document.getElementById('detail-notes');
        
        // Pull from metadata.contact first (from edge farm.json), then farm level
        if (ownerEl) ownerEl.textContent = contact.owner || mergedMetadata.owner || farm.owner || configMetadata.owner || '--';
        if (contactEl) contactEl.textContent = contact.name || contact.contactName || mergedMetadata.contactName || configMetadata.contactName || farm.contactName || '--';
        if (phoneEl) phoneEl.textContent = contact.phone || mergedMetadata.phone || configMetadata.phone || farm.phone || '--';
        if (emailEl) emailEl.textContent = contact.email || mergedMetadata.email || farm.email || config.email || '--';
        
        // Website field (from farm.json url or metadata)
        if (websiteEl) {
            const website = mergedMetadata.website || contact.website || mergedMetadata.url || farm.url || apiUrl;
            if (website && website !== '--') {
                websiteEl.innerHTML = `<a href="${website}" target="_blank" style="color: var(--accent-blue); text-decoration: none;">${website}</a>`;
            } else {
                websiteEl.textContent = '--';
            }
        }
        
        // Format address from location object or contact
        let addressText = '--';
        if (location.street || location.city || location.state || location.zip) {
            const parts = [];
            if (location.street) parts.push(location.street);
            if (location.city) parts.push(location.city);
            if (location.state) parts.push(location.state);
            if (location.zip) parts.push(location.zip);
            addressText = parts.join(', ');
        } else if (contact.address) {
            addressText = contact.address;
        }
        if (addressEl) addressEl.textContent = addressText;
        
        if (deploymentTypeEl) deploymentTypeEl.textContent = deploymentType;
        
        // Load notes from settings
        if (notesEl) {
            notesEl.value = settings.notes || '';
            // Store farmId in a data attribute for saving
            notesEl.dataset.farmId = farmId;
        }
        
        console.log('[FarmSummary] Summary loaded successfully');
        
    } catch (error) {
        console.error('[FarmSummary] Error loading farm summary:', error);
    }
}

/**
 * Enable edit mode for farm info
 */
function enableFarmInfoEdit() {
    console.log('[FarmInfo] Enabling edit mode');
    
    // Hide display values, show input fields
    const fields = ['owner', 'contact', 'phone', 'email', 'website', 'address'];
    fields.forEach(field => {
        const displayEl = document.getElementById(`detail-${field}`);
        const inputEl = document.getElementById(`detail-${field}-input`);
        
        if (displayEl && inputEl) {
            // Copy current value to input
            let value = displayEl.textContent.trim();
            // Handle website links
            if (field === 'website' && displayEl.querySelector('a')) {
                value = displayEl.querySelector('a').href;
            }
            inputEl.value = value === '--' ? '' : value;
            
            // Toggle visibility
            displayEl.style.display = 'none';
            inputEl.style.display = 'block';
        }
    });
    
    // Toggle buttons
    document.getElementById('edit-farm-info-btn').style.display = 'none';
    document.getElementById('save-farm-info-btn').style.display = 'inline-block';
    document.getElementById('cancel-farm-info-btn').style.display = 'inline-block';
}

/**
 * Cancel edit mode and revert changes
 */
function cancelFarmInfoEdit() {
    console.log('[FarmInfo] Cancelling edit mode');
    
    // Hide input fields, show display values
    const fields = ['owner', 'contact', 'phone', 'email', 'website', 'address'];
    fields.forEach(field => {
        const displayEl = document.getElementById(`detail-${field}`);
        const inputEl = document.getElementById(`detail-${field}-input`);
        
        if (displayEl && inputEl) {
            displayEl.style.display = 'block';
            inputEl.style.display = 'none';
        }
    });
    
    // Toggle buttons
    document.getElementById('edit-farm-info-btn').style.display = 'inline-block';
    document.getElementById('save-farm-info-btn').style.display = 'none';
    document.getElementById('cancel-farm-info-btn').style.display = 'none';
}

/**
 * Save farm info and sync to edge device
 */
async function saveFarmInfo() {
    const farmId = currentFarmId;
    if (!farmId) {
        alert('No farm selected');
        return;
    }
    
    console.log('[FarmInfo] Saving farm info for:', farmId);
    
    // Collect values from input fields
    const farmInfo = {
        owner: document.getElementById('detail-owner-input').value.trim(),
        contactName: document.getElementById('detail-contact-input').value.trim(),
        phone: document.getElementById('detail-phone-input').value.trim(),
        email: document.getElementById('detail-email-input').value.trim(),
        website: document.getElementById('detail-website-input').value.trim(),
        address: document.getElementById('detail-address-input').value.trim()
    };
    
    console.log('[FarmInfo] Collected data:', farmInfo);
    
    try {
        // Save to GreenReach Central
        const response = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/metadata`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contact: farmInfo })
        });
        
        // Handle null response (authentication failed)
        if (!response) {
            throw new Error('Authentication failed. Please log in again.');
        }
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
            throw new Error(errorData.message || `HTTP ${response.status}`);
        }
        
        const result = await response.json();
        console.log('[FarmInfo] Save response:', result);
        
        // Update display values (database was updated successfully)
        document.getElementById('detail-owner').textContent = farmInfo.owner || '--';
        document.getElementById('detail-contact').textContent = farmInfo.contactName || '--';
        document.getElementById('detail-phone').textContent = farmInfo.phone || '--';
        document.getElementById('detail-email').textContent = farmInfo.email || '--';
        
        // Handle website display
        const websiteEl = document.getElementById('detail-website');
        if (farmInfo.website) {
            websiteEl.innerHTML = `<a href="${farmInfo.website}" target="_blank" style="color: var(--accent-blue); text-decoration: none;">${farmInfo.website}</a>`;
        } else {
            websiteEl.textContent = '--';
        }
        
        document.getElementById('detail-address').textContent = farmInfo.address || '--';
        
        // Exit edit mode
        cancelFarmInfoEdit();
        
        // Show status-specific notification based on sync result
        const syncStatus = result.syncStatus || 'not_attempted';
        const statusMessages = {
            'synced': {
                type: 'success',
                text: '✓ Changes saved and synced to farm device'
            },
            'sync_error': {
                type: 'warning',
                text: '⚠ Changes saved to Central. Could not reach farm device - will sync on next heartbeat'
            },
            'sync_failed': {
                type: 'warning',
                text: '⚠ Changes saved to Central. Farm device returned error - check device status'
            },
            'no_api_url': {
                type: 'warning',
                text: '⚠ Changes saved to Central. No device URL configured - manual sync required'
            },
            'not_attempted': {
                type: 'info',
                text: 'ℹ Changes saved to Central. Sync not attempted'
            }
        };
        
        const statusInfo = statusMessages[syncStatus] || statusMessages['not_attempted'];
        showNotification(statusInfo.text, statusInfo.type);
        
    } catch (error) {
        console.error('[FarmInfo] Error saving:', error);
        alert(`Failed to save farm info: ${error.message}`);
    }
}

function showNotification(message, type = 'info') {
    // Simple notification system with status-specific styling
    const colors = {
        'success': '#10b981',
        'error': '#ef4444',
        'warning': '#f59e0b',
        'info': '#3b82f6'
    };
    
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 16px 24px;
        background: ${colors[type] || colors['info']};
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        font-size: 14px;
        max-width: 400px;
        line-height: 1.5;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    // Show warnings longer (5s vs 3s)
    const duration = type === 'warning' ? 5000 : 3000;
    
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s';
        setTimeout(() => notification.remove(), 300);
    }, duration);
}

/**
 * Toggle farm notes section visibility
 */
function toggleFarmNotes() {
    const notesSection = document.getElementById('farm-notes-section');
    const toggle = document.querySelector('.notes-toggle');
    
    if (notesSection && toggle) {
        notesSection.classList.toggle('active');
        toggle.classList.toggle('active');
    }
}

/**
 * Save farm notes
 */
async function saveFarmNotes() {
    try {
        const notesEl = document.getElementById('detail-notes');
        if (!notesEl) {
            alert('Notes field not found');
            return;
        }
        
        const farmId = notesEl.dataset.farmId;
        const notes = notesEl.value;
        
        if (!farmId) {
            alert('Farm ID not found. Please reload the page.');
            return;
        }
        
        console.log('[SaveNotes] Saving notes for farm:', farmId);
        
        const response = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/notes`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ notes })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to save notes');
        }
        
        const result = await response.json();
        console.log('[SaveNotes] Notes saved successfully:', result);
        
        // Show success message
        alert('Farm notes saved successfully!');
        
    } catch (error) {
        console.error('[SaveNotes] Error saving notes:', error);
        alert(`Failed to save notes: ${error.message}`);
    }
}

/**
 * Load farm rooms
 */
async function loadFarmRooms(farmId, count) {
    roomsData = [];

    try {
        const adminUrl = `${API_BASE}/api/admin/farms/${farmId}/rooms`;
        const syncUrl = `${API_BASE}/api/sync/${farmId}/rooms`;
        console.log('[FarmRooms] Fetching (admin first):', adminUrl);
        let response;
        try {
            response = await authenticatedFetch(adminUrl);
            if (!response || !response.ok) throw new Error(`HTTP ${response ? response.status : 'no-response'}`);
        } catch (adminErr) {
            console.warn('[FarmRooms] Admin rooms failed, trying sync fallback:', adminErr.message || adminErr);
            response = await authenticatedFetch(syncUrl);
        }
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('[FarmRooms] Response:', data);
        const rooms = Array.isArray(data.rooms) ? data.rooms : [];

        // Fetch telemetry data to get environmental readings
        let telemetryZones = [];
        try {
            let telemetryRes;
            try {
                telemetryRes = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/zones`);
                if (!telemetryRes || !telemetryRes.ok) throw new Error('No admin zones endpoint');
            } catch (zoneErr) {
                telemetryRes = await authenticatedFetch(`${API_BASE}/api/sync/${farmId}/telemetry`);
            }
            if (telemetryRes.ok) {
                const zonesData = await telemetryRes.json();
                telemetryZones = zonesData.zones || zonesData.telemetry?.zones || [];
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
        // Try admin endpoint first; sync endpoint requires farm API-key auth.
        let response;
        try {
            response = await authenticatedFetch(`/api/admin/farms/${farmId}/devices`);
            if (!response || !response.ok) throw new Error('No admin devices endpoint');
        } catch (e) {
            response = await authenticatedFetch(`${API_BASE}/api/sync/${farmId}/devices`);
            if (!response || !response.ok) throw new Error(`HTTP ${response ? response.status : 'no-response'}`);
        }
        const data = await response.json();
        
        if (data.success && data.devices) {
            devicesData = data.devices.map(device => ({
                deviceId: device.device_code || device.deviceId || device.device_id || device.id,
                name: device.device_name || device.deviceName || device.name || 'Unnamed Device',
                type: device.device_type || device.type || 'unknown',
                location: device.location || 'Unknown',
                status: deriveDeviceStatus(device),
                lastSeen: formatDeviceLastSeen(device),
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
        let response;
        try {
            response = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/inventory`);
            if (!response || !response.ok) throw new Error('No admin inventory endpoint');
        } catch (adminErr) {
            response = await authenticatedFetch(`${API_BASE}/api/sync/${farmId}/inventory`);
        }
        const data = await response.json();
        
        if (data.success && (data.inventory || data.trays)) {
            // Prefer synthetic trays over product-oriented inventory rows
            const trays = (data.trays && data.trays.length > 0) ? data.trays
                : (data.inventory && data.inventory.length > 0) ? data.inventory
                : [];
            inventoryData = trays.map(tray => {
                const dth = tray.days_to_harvest ?? tray.daysToHarvest ?? null;
                const unit = tray.unit || tray.quantity_unit || '';
                const isWeightBased = ['lb', 'lbs', 'oz', 'kg'].includes(unit.toLowerCase());
                const qty = tray.plant_count || tray.plantCount || tray.quantity || 0;
                return {
                    trayId: tray.tray_code || tray.trayId || tray.id || tray.productId || tray.product_id || tray.sku || '--',
                    recipe: tray.recipe_name || tray.recipe || tray.productName || tray.product_name || tray.crop || 'Unknown',
                    location: tray.location || 'Unassigned',
                    plantCount: qty,
                    unit: isWeightBased ? unit : 'plants',
                    quantityDisplay: isWeightBased ? `${Number(qty).toFixed(1)} ${unit}` : `${qty} plants`,
                    age: tray.age_days || tray.daysOld || 0,
                    harvestEst: dth !== null ?
                        (dth <= 0 ? 'Today' : `${Math.max(0, Math.floor(dth))}d`) :
                        'Unknown',
                    status: tray.status || 'unknown'
                };
            });
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
            <td>${item.quantityDisplay || item.plantCount}</td>
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
        
        if (!response || !response.ok) {
            console.error('Failed to load recipes:', response?.status || 'error');
            recipesData = [];
            renderRecipesTable();
            return;
        }
        
        const data = await response.json();
        recipesData = (data.recipes || []).map(recipe => ({
            recipe_id: recipe.recipe_id || recipe.id,
            id: recipe.id || recipe.recipe_id,
            name: recipe.name,
            cropType: recipe.crop_type || recipe.category,
            category: recipe.category || recipe.crop_type || 'Uncategorized',
            activeTrays: recipe.active_trays || recipe.trays_running || 0,
            activeGroups: recipe.groups_running || 0,
            totalDays: recipe.total_days,
            scheduleLength: recipe.schedule_length,
            avgTempC: recipe.avg_temp_c,
            currentDayMin: recipe.current_day_min,
            currentDayMax: recipe.current_day_max,
            daysRemainingMin: recipe.days_remaining_min,
            daysRemainingMax: recipe.days_remaining_max,
            seedDateMin: recipe.seed_date_min,
            seedDateMax: recipe.seed_date_max,
            description: recipe.description,
            data: recipe.data
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
        const schedule = recipe.data?.schedule || [];
        let avgTemp = recipe.avgTempC != null ? `${recipe.avgTempC.toFixed(1)}°C` : 'N/A';
        if (avgTemp === 'N/A' && schedule.length > 0) {
            const temps = schedule
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

        const totalDays = recipe.totalDays ?? recipe.total_days ?? 0;
        const stages = recipe.scheduleLength ?? recipe.schedule_length ?? schedule.length ?? 0;
        const dayRange = recipe.currentDayMin != null
            ? `Day ${recipe.currentDayMin}${recipe.currentDayMax && recipe.currentDayMax !== recipe.currentDayMin ? `-${recipe.currentDayMax}` : ''}`
            : 'Day —';
        const remainingRange = recipe.daysRemainingMin != null
            ? `Harvest ${recipe.daysRemainingMin}${recipe.daysRemainingMax && recipe.daysRemainingMax !== recipe.daysRemainingMin ? `-${recipe.daysRemainingMax}` : ''}d`
            : 'Harvest —';
        const groupsTrays = `Groups: ${recipe.activeGroups || 0} · Trays: ${recipe.activeTrays || 0}`;

        return `
            <tr>
                <td>
                    <strong class="recipe-name-hover" data-desc="${(recipe.description || '').replace(/"/g, '&quot;')}">${recipe.name || 'Unknown'}</strong>
                    ${recipe.description ? `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;max-width:320px;line-height:1.3;">${recipe.description}</div>` : ''}
                    <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 4px;">${groupsTrays} · ${dayRange} · ${remainingRange}</div>
                </td>
                <td>
                    <span class="badge" style="background: ${getCategoryColor(recipe.category)}; padding: 4px 8px; border-radius: 4px; font-size: 0.85rem;">
                        ${recipe.category || 'Uncategorized'}
                    </span>
                </td>
                <td>${totalDays} days</td>
                <td>${stages} entries</td>
                <td style="font-size: 0.85rem;">${avgTemp}</td>
                <td>
                    <button onclick="viewRecipeDetails('${recipe.recipe_id || recipe.id}')" class="btn btn-sm" style="padding: 4px 8px; font-size: 0.85rem;">View</button>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * View recipe details
 */
function viewRecipeDetails(recipeId) {
    const recipe = recipesData.find(r => r.recipe_id === recipeId || r.id === recipeId);
    if (!recipe) {
        showRecipeModal('Recipe Not Found', '<p>Could not find this recipe.</p>');
        return;
    }

    const dayRange = recipe.currentDayMin != null
        ? `${recipe.currentDayMin}${recipe.currentDayMax && recipe.currentDayMax !== recipe.currentDayMin ? `-${recipe.currentDayMax}` : ''}`
        : '---';
    const remainingRange = recipe.daysRemainingMin != null
        ? `${recipe.daysRemainingMin}${recipe.daysRemainingMax && recipe.daysRemainingMax !== recipe.daysRemainingMin ? `-${recipe.daysRemainingMax}` : ''}`
        : '---';
    const seedRange = recipe.seedDateMin
        ? `${recipe.seedDateMin}${recipe.seedDateMax && recipe.seedDateMax !== recipe.seedDateMin ? ` to ${recipe.seedDateMax}` : ''}`
        : '---';

    const catColor = getCategoryColor(recipe.category);
    let html = `
        <div style="margin-bottom:16px;">
            <span style="background:${catColor};color:#fff;padding:4px 10px;border-radius:4px;font-size:0.85rem;">${recipe.category || 'Uncategorized'}</span>
        </div>
        ${recipe.description ? `<p style="color:var(--text-secondary);margin-bottom:16px;line-height:1.5;">${recipe.description}</p>` : ''}
        <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
            <tr><td style="padding:6px 0;color:var(--text-secondary);">Cycle Duration</td><td style="padding:6px 0;font-weight:500;">${recipe.totalDays ?? recipe.total_days ?? '---'} days</td></tr>
            <tr><td style="padding:6px 0;color:var(--text-secondary);">Stages</td><td style="padding:6px 0;font-weight:500;">${recipe.scheduleLength ?? recipe.schedule_length ?? '---'}</td></tr>
            <tr><td style="padding:6px 0;color:var(--text-secondary);">Active Groups</td><td style="padding:6px 0;font-weight:500;">${recipe.activeGroups || 0}</td></tr>
            <tr><td style="padding:6px 0;color:var(--text-secondary);">Active Trays</td><td style="padding:6px 0;font-weight:500;">${recipe.activeTrays || 0}</td></tr>
            <tr><td style="padding:6px 0;color:var(--text-secondary);">Seed Date Range</td><td style="padding:6px 0;font-weight:500;">${seedRange}</td></tr>
            <tr><td style="padding:6px 0;color:var(--text-secondary);">Current Day</td><td style="padding:6px 0;font-weight:500;">${dayRange}</td></tr>
            <tr><td style="padding:6px 0;color:var(--text-secondary);">Days to Harvest</td><td style="padding:6px 0;font-weight:500;">${remainingRange}</td></tr>
        </table>
    `;

    showRecipeModal(recipe.name, html);
}

// ── Farm-level Recipe Library (read-only) + Recipe Requests ──

/** Cache of full recipe library loaded for farm recipes tab */
let _farmRecipeLibrary = [];

/**
 * Load the full GreenReach recipe library into the farm recipes tab
 * Called after loadFarmRecipes() finishes populating the active recipes table.
 */
async function loadFarmRecipeLibrary() {
    const tbody = document.getElementById('farm-recipe-library-tbody');
    if (!tbody) return;
    try {
        const response = await authenticatedFetch(`/api/admin/recipes?limit=200`);
        if (!response || !response.ok) throw new Error('Failed to load recipe library');
        const data = await response.json();
        _farmRecipeLibrary = data.recipes || [];

        // Build set of recipe names currently active on this farm
        const activeNames = new Set(
            (recipesData || []).map(r => (r.name || '').toLowerCase().trim())
        );

        renderFarmRecipeLibrary(_farmRecipeLibrary, activeNames);
        // Also load any previous recipe requests
        await loadRecipeRequests();
    } catch (err) {
        console.error('[FarmRecipeLibrary]', err);
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--accent-red);">Error loading recipe library: ${err.message}</td></tr>`;
    }
}

function renderFarmRecipeLibrary(recipes, activeNames) {
    const tbody = document.getElementById('farm-recipe-library-tbody');
    const countEl = document.getElementById('farm-recipe-library-count');
    if (!tbody) return;

    // Apply category and search filters
    const categoryFilter = document.getElementById('farm-recipe-category-filter')?.value || '';
    const searchFilter = (document.getElementById('farm-recipe-library-search')?.value || '').toLowerCase();

    let filtered = recipes;
    if (categoryFilter) filtered = filtered.filter(r => r.category === categoryFilter);
    if (searchFilter) filtered = filtered.filter(r =>
        (r.name || '').toLowerCase().includes(searchFilter) ||
        (r.category || '').toLowerCase().includes(searchFilter) ||
        (r.description || '').toLowerCase().includes(searchFilter)
    );

    if (countEl) countEl.textContent = `${filtered.length} of ${recipes.length} recipes`;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-secondary);">No recipes match your search</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(recipe => {
        const isActive = activeNames && activeNames.has((recipe.name || '').toLowerCase().trim());
        const schedule = normalizeRecipeSchedule(recipe);
        const stages = recipe.schedule_length || schedule.length || 0;

        let avgTemp = 'N/A';
        if (schedule.length > 0) {
            const temps = schedule
                .map(d => { const t = d.temperature || d.tempC || d.afternoon_temp; return typeof t === 'string' ? parseFloat(t) : t; })
                .filter(t => !isNaN(t) && t > 0);
            if (temps.length) avgTemp = `${(temps.reduce((a,b) => a+b, 0) / temps.length).toFixed(1)}°C`;
        }

        const statusBadge = isActive
            ? '<span style="background:#10b981;color:#fff;padding:3px 8px;border-radius:4px;font-size:0.8rem;font-weight:500;">In Use</span>'
            : '<span style="background:var(--bg-secondary);color:var(--text-secondary);padding:3px 8px;border-radius:4px;font-size:0.8rem;">Available</span>';

        return `
            <tr>
                <td>
                    <div style="font-weight:500;" class="recipe-name-hover" data-desc="${(recipe.description || '').replace(/"/g, '&quot;')}">${recipe.name}</div>
                    ${recipe.description ? `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;max-width:360px;line-height:1.3;">${recipe.description}</div>` : ''}
                </td>
                <td><span style="background:${getCategoryColor(recipe.category)};color:#fff;padding:3px 8px;border-radius:4px;font-size:0.8rem;">${recipe.category || 'Other'}</span></td>
                <td>${stages}</td>
                <td>${countStages(schedule)}</td>
                <td>${avgTemp}</td>
                <td>${statusBadge}</td>
                <td><button onclick="showRecipeLibraryDetail('${(recipe.id || recipe.name || '').replace(/'/g, "\\'")}')" class="btn" style="padding:4px 10px;font-size:0.8rem;">View Schedule</button></td>
            </tr>`;
    }).join('');
}

/** Count unique growth stages in a recipe schedule */
function countStages(schedule) {
    if (!schedule || !schedule.length) return '—';
    const stages = new Set(schedule.map(d => d.stage || d.growth_stage || 'Unknown'));
    return stages.size;
}

function filterFarmRecipeLibrary() {
    const activeNames = new Set(
        (recipesData || []).map(r => (r.name || '').toLowerCase().trim())
    );
    renderFarmRecipeLibrary(_farmRecipeLibrary, activeNames);
}

/**
 * Show recipe schedule detail in a read-only modal/alert
 */
async function showRecipeLibraryDetail(recipeId) {
    try {
        const response = await authenticatedFetch(`/api/admin/recipes/${encodeURIComponent(recipeId)}`);
        if (!response || !response.ok) throw new Error('Failed to load recipe');
        const data = await response.json();
        const recipe = data.recipe || {};
        const schedule = normalizeRecipeSchedule(recipe);

        // Also get description from the library cache
        const libEntry = _farmRecipeLibrary.find(r => r.id === recipeId || r.name === recipeId);
        const description = libEntry?.description || recipe.description || '';

        const catColor = getCategoryColor(recipe.category || libEntry?.category || 'Other');
        let html = `
            <div style="margin-bottom:12px;">
                <span style="background:${catColor};color:#fff;padding:4px 10px;border-radius:4px;font-size:0.85rem;">${recipe.category || libEntry?.category || 'Unknown'}</span>
                <span style="margin-left:12px;color:var(--text-secondary);font-size:0.9rem;">${schedule.length} days total</span>
            </div>
            ${description ? `<p style="color:var(--text-secondary);margin-bottom:16px;line-height:1.5;">${description}</p>` : ''}
        `;

        if (schedule.length > 0) {
            html += `<div style="max-height:400px;overflow-y:auto;margin-top:8px;">
                <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
                    <thead>
                        <tr style="border-bottom:2px solid var(--border);position:sticky;top:0;background:var(--bg);">
                            <th style="padding:6px 4px;text-align:left;">Day</th>
                            <th style="padding:6px 4px;text-align:left;">Stage</th>
                            <th style="padding:6px 4px;text-align:right;">Temp (C)</th>
                            <th style="padding:6px 4px;text-align:right;">PPFD</th>
                            <th style="padding:6px 4px;text-align:right;">DLI</th>
                            <th style="padding:6px 4px;text-align:right;">VPD</th>
                        </tr>
                    </thead>
                    <tbody>`;
            const step = Math.max(1, Math.floor(schedule.length / 20));
            for (let i = 0; i < schedule.length; i += step) {
                const d = schedule[i];
                const day = d.day || i + 1;
                const stage = (d.stage || d.growth_stage || '').substring(0, 16);
                const temp = d.temperature || d.tempC || d.afternoon_temp || '---';
                const ppfd = d.ppfd || d.ppfd_target || '---';
                const dli = d.dli || d.dli_target || '---';
                const vpd = d.vpd || d.vpd_target || '---';
                html += `<tr style="border-bottom:1px solid var(--border);">
                    <td style="padding:5px 4px;">${day}</td>
                    <td style="padding:5px 4px;">${stage}</td>
                    <td style="padding:5px 4px;text-align:right;">${temp}</td>
                    <td style="padding:5px 4px;text-align:right;">${ppfd}</td>
                    <td style="padding:5px 4px;text-align:right;">${dli}</td>
                    <td style="padding:5px 4px;text-align:right;">${vpd}</td>
                </tr>`;
            }
            html += `</tbody></table></div>`;
            if (step > 1) html += `<p style="color:var(--text-secondary);font-size:0.8rem;margin-top:8px;">Showing every ${step} days of ${schedule.length} total</p>`;
        }
        showRecipeModal(recipe.name || recipeId, html);
    } catch (err) {
        showRecipeModal('Error', `<p style="color:var(--accent-red);">Error loading recipe: ${err.message}</p>`);
    }
}

/**
 * Submit a recipe request from the farm grower
 */
async function submitRecipeRequest() {
    const crop = document.getElementById('recipe-request-crop')?.value?.trim();
    const category = document.getElementById('recipe-request-category')?.value || 'Other';
    const notes = document.getElementById('recipe-request-notes')?.value?.trim() || '';
    const statusEl = document.getElementById('recipe-request-status');

    if (!crop) {
        if (statusEl) statusEl.textContent = 'Please enter a crop/variety name.';
        return;
    }

    try {
        if (statusEl) statusEl.textContent = 'Submitting...';
        const response = await authenticatedFetch(`${API_BASE}/api/admin/recipe-requests`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                farmId: currentFarmId,
                crop,
                category,
                notes
            })
        });
        if (!response || !response.ok) {
            const errData = await response?.json().catch(() => ({}));
            throw new Error(errData.error || 'Request failed');
        }
        const result = await response.json();
        if (statusEl) {
            statusEl.style.color = '#10b981';
            statusEl.textContent = '✓ Request submitted! GreenReach Central will review it.';
        }
        // Clear form
        document.getElementById('recipe-request-crop').value = '';
        document.getElementById('recipe-request-notes').value = '';
        // Refresh requests list
        await loadRecipeRequests();
    } catch (err) {
        console.error('[RecipeRequest]', err);
        if (statusEl) {
            statusEl.style.color = 'var(--accent-red)';
            statusEl.textContent = 'Error: ' + err.message;
        }
    }
}

/**
 * Load previous recipe requests for this farm
 */
async function loadRecipeRequests() {
    const listContainer = document.getElementById('recipe-requests-list');
    const listBody = document.getElementById('recipe-requests-tbody');
    if (!listContainer || !listBody || !currentFarmId) return;

    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/recipe-requests?farmId=${currentFarmId}`);
        if (!response || !response.ok) return;
        const data = await response.json();
        const requests = data.requests || [];

        if (requests.length === 0) {
            listContainer.style.display = 'none';
            return;
        }

        listContainer.style.display = 'block';
        listBody.innerHTML = requests.map(req => {
            const statusColor = req.status === 'approved' ? '#10b981' : req.status === 'declined' ? '#ef4444' : '#f59e0b';
            const statusLabel = req.status || 'pending';
            const date = req.createdAt ? new Date(req.createdAt).toLocaleDateString() : '';
            return `
                <div style="display:flex;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
                    <span style="font-weight:500;min-width:140px;">${req.crop}</span>
                    <span style="background:${getCategoryColor(req.category)};color:#fff;padding:2px 6px;border-radius:4px;font-size:0.8rem;">${req.category}</span>
                    <span style="color:${statusColor};font-weight:500;font-size:0.85rem;text-transform:capitalize;">${statusLabel}</span>
                    <span style="color:var(--text-secondary);font-size:0.8rem;">${date}</span>
                    ${req.notes ? `<span style="color:var(--text-secondary);font-size:0.8rem;flex:1;">— ${req.notes}</span>` : ''}
                </div>`;
        }).join('');
    } catch (err) {
        console.error('[RecipeRequests]', err);
    }
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
            
        case 'farm-alerts': {
            // Ensure farm-detail-view is visible, then switch to alerts tab if available
            document.getElementById('farm-detail-view').style.display = 'block';
            const detailAlerts = document.getElementById('detail-alerts');
            if (detailAlerts) {
                switchDetailTab('alerts');
            } else {
                document.getElementById('alerts-view').style.display = 'block';
                await loadAlertsView({ farmId: currentFarmId });
            }
            break;
        }
            
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

        case 'ai-rules':
            document.getElementById('ai-rules-view').style.display = 'block';
            await loadAiRules();
            if (INFO_CARDS['ai-rules']) {
                showInfoCard(createInfoCard(INFO_CARDS['ai-rules'].title, INFO_CARDS['ai-rules'].subtitle, INFO_CARDS['ai-rules'].sections));
            }
            break;

        case 'ai-reference':
            document.getElementById('ai-reference-view').style.display = 'block';
            await loadAiReferenceSites();
            if (INFO_CARDS['ai-reference']) {
                showInfoCard(createInfoCard(INFO_CARDS['ai-reference'].title, INFO_CARDS['ai-reference'].subtitle, INFO_CARDS['ai-reference'].sections));
            }
            break;

        case 'grant-summary':
            document.getElementById('grant-summary-view').style.display = 'block';
            await loadGrantSummary();
            if (INFO_CARDS['grant-summary']) {
                showInfoCard(createInfoCard(INFO_CARDS['grant-summary'].title, INFO_CARDS['grant-summary'].subtitle, INFO_CARDS['grant-summary'].sections));
            }
            break;

        case 'grant-users':
            document.getElementById('grant-users-view').style.display = 'block';
            await loadGrantUsers();
            if (INFO_CARDS['grant-users']) {
                showInfoCard(createInfoCard(INFO_CARDS['grant-users'].title, INFO_CARDS['grant-users'].subtitle, INFO_CARDS['grant-users'].sections));
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
            
        case 'network':
            document.getElementById('network-view').style.display = 'block';
            await loadNetworkDashboard();
            break;
            
        case 'grower-mgmt':
            document.getElementById('grower-mgmt-view').style.display = 'block';
            await loadGrowerManagement();
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

        case 'procurement-catalog':
            document.getElementById('procurement-catalog-view').style.display = 'block';
            await loadProcurementCatalog();
            break;
        case 'procurement-suppliers':
            document.getElementById('procurement-suppliers-view').style.display = 'block';
            await loadProcurementSuppliers();
            break;
        case 'procurement-revenue':
            document.getElementById('procurement-revenue-view').style.display = 'block';
            await loadProcurementRevenue();
            break;

        case 'pricing-management':
            document.getElementById('pricing-management-view').style.display = 'block';
            await loadPricingManagement();
            await loadCurrentPricesIntoScanner();
            break;

        case 'delivery-management':
            document.getElementById('delivery-management-view').style.display = 'block';
            await loadDeliveryManagement();
            break;

        case 'ai-monitoring':
            document.getElementById('ai-monitoring-view').style.display = 'block';
            await loadAiMonitoring();
            break;

        case 'marketing-ai':
            document.getElementById('marketing-ai-view').style.display = 'block';
            await loadMarketingDashboard();
            break;

        case 'scott-core':
            document.getElementById('scott-core-view').style.display = 'block';
            await initScottChat();
            break;

        case 'market-intelligence':
            document.getElementById('market-intelligence-view').style.display = 'block';
            await loadMarketIntelligenceView();
            break;

        case 'accounting':
            document.getElementById('accounting-view').style.display = 'block';
            await loadCentralAccounting();
            break;

        case 'faye-core':
            loadIframeView('/faye-core.html');
            break;

        case 'calendar':
            document.getElementById('calendar-view').style.display = 'block';
            if (typeof loadCalendarEvents === 'function') { loadCalendarEvents(); loadCalendarDashboard(); }
            break;

        case 'tasks':
            document.getElementById('tasks-view').style.display = 'block';
            if (typeof loadTasks === 'function') { loadTasks(); loadCalendarDashboard(); }
            break;

        case 'farm-management':
            document.getElementById('farm-management-view').style.display = 'block';
            if (typeof loadFarmManagement === 'function') { loadFarmManagement(); }
            break;

        case 'salad-mixes':
            document.getElementById('salad-mixes-view').style.display = 'block';
            await loadSaladMixes();
            break;
            
        default:
            console.log(`Navigate to: ${view} (not implemented)`);
            document.getElementById('overview-view').style.display = 'block';
    }
}

/**
 * Load a page into the central admin iframe panel
 */
function loadIframeView(url) {
    document.querySelectorAll('.view').forEach(v => { v.style.display = 'none'; });
    const container = document.getElementById('iframe-view');
    const iframe = document.getElementById('central-admin-iframe');
    if (!container || !iframe) return;
    try {
        const parsed = new URL(url, window.location.origin);
        parsed.searchParams.set('embedded', '1');
        iframe.src = parsed.pathname + parsed.search;
    } catch {
        iframe.src = url;
    }
    container.style.display = 'block';
    iframe.onload = () => {
        try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (!doc) return;
            // Hide topbar nav inside iframe -- the parent sidebar provides navigation
            const topbar = doc.querySelector('.faye-topbar, .evie-topbar, .page-topbar, header.topbar');
            if (topbar) topbar.style.display = 'none';
            // Hide any "back to admin" links
            doc.querySelectorAll('a[href*="GR-central-admin"], a[href*="LE-farm-admin"]').forEach(a => { a.style.display = 'none'; });
        } catch { /* cross-origin or security restriction -- ignore */ }
    };
}

/**
 * Navigate to an iframe view from sidebar nav click
 */
function navigateIframe(view, url, element) {
    document.querySelectorAll('.nav-item').forEach(item => { item.classList.remove('active'); });
    if (element) element.classList.add('active');
    loadIframeView(url);
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
    const target = document.getElementById(`detail-${tab}`);
    if (!target) {
        console.warn(`[switchDetailTab] Tab not found: detail-${tab}`);
        return;
    }
    target.classList.add('active');
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
 * Export farm data — generates and downloads a CSV of all farm KPIs
 */
function exportFarmData() {
    if (!currentFarmId) return;
    
    console.log(`Exporting data for ${currentFarmId}...`);
    
    const farm = farmsData.find(f => f.farmId === currentFarmId);
    if (!farm) {
        console.warn('[Export] No farm data found for', currentFarmId);
        return;
    }

    // Build CSV with all available data sections
    const lines = [];
    lines.push('Section,Field,Value');

    // Farm overview
    lines.push(`Farm,Name,"${farm.name || ''}"`);
    lines.push(`Farm,ID,${farm.farmId || ''}`);
    lines.push(`Farm,Status,${farm.status || ''}`);
    lines.push(`Farm,Rooms,${farm.rooms ?? ''}`);
    lines.push(`Farm,Zones,${farm.zones ?? ''}`);
    lines.push(`Farm,Devices,${farm.devices ?? ''}`);
    lines.push(`Farm,Trays,${farm.trays ?? ''}`);
    lines.push(`Farm,Energy (kWh),${farm.energy ?? ''}`);
    lines.push(`Farm,Alerts,${farm.alerts ?? ''}`);
    lines.push(`Farm,Last Update,${farm.lastUpdate || ''}`);

    // Rooms
    roomsData.forEach(r => {
        lines.push(`Room,"${r.name}",Status: ${r.status} | Zones: ${r.zones} | Devices: ${r.devices} | Temp: ${r.temp} | RH: ${r.humidity} | CO2: ${r.co2}`);
    });

    // Devices
    devicesData.forEach(d => {
        lines.push(`Device,"${d.name} (${d.deviceId})",Type: ${d.type} | Status: ${d.status} | Location: ${d.location} | Firmware: ${d.firmware}`);
    });

    // Inventory / Trays
    inventoryData.forEach(t => {
        lines.push(`Tray,"${t.trayId}",Recipe: ${t.recipe} | Location: ${t.location} | Age: ${t.age}d | Harvest: ${t.harvestEst} | Status: ${t.status}`);
    });

    const csv = lines.join('\n');
    const ts = new Date().toISOString().slice(0, 10);
    downloadCSV(csv, `${farm.name || currentFarmId}-export-${ts}.csv`);
    console.log(`[Export] Downloaded ${lines.length} rows for ${farm.name}`);
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
 * Utility: Parse the most relevant device timestamp for online/offline inference.
 */
function getDeviceSeenAt(device) {
    const ts = device?.last_seen
        || device?.lastSeen
        || device?.updatedAt
        || device?.telemetry?.lastUpdate
        || device?.telemetry?.timestamp
        || device?.deviceData?.status?.lastUpdate
        || null;
    const ms = ts ? Date.parse(ts) : NaN;
    return Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * Utility: Infer device status from explicit fields, telemetry.online, and recency.
 * Field mapping doc defines online when lastSeen < 5 minutes.
 */
function deriveDeviceStatus(device) {
    const explicitStatus = String(device?.status || '').toLowerCase();
    if (explicitStatus === 'online' || explicitStatus === 'offline' || explicitStatus === 'warning' || explicitStatus === 'critical') {
        return explicitStatus;
    }

    const telemetryOnline = device?.telemetry?.online;
    if (typeof telemetryOnline === 'boolean') {
        return telemetryOnline ? 'online' : 'offline';
    }

    const embeddedOnline = device?.deviceData?.online;
    if (typeof embeddedOnline === 'boolean') {
        return embeddedOnline ? 'online' : 'offline';
    }

    const seenAt = getDeviceSeenAt(device);
    if (seenAt) {
        const ageMs = Date.now() - seenAt.getTime();
        return ageMs <= (5 * 60 * 1000) ? 'online' : 'offline';
    }

    return 'offline';
}

/**
 * Utility: Format device last-seen timestamp for table display.
 */
function formatDeviceLastSeen(device) {
    const seenAt = getDeviceSeenAt(device);
    return seenAt ? seenAt.toLocaleString() : 'Never';
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
 * View room detail (legacy entry point — delegates to real drill-down)
 */
function viewRoomDetailStub(roomName) {
    console.log(`[viewRoomDetailStub] Delegating to viewRoomDetail for: ${roomName}`);
    const room = roomsData.find(r => r.name === roomName || r.roomId === roomName);
    if (room && currentFarmId) {
        viewRoomDetail(currentFarmId, room.roomId || room.name);
    } else {
        // Fallback: show available room data in a detail panel
        const r = room || { name: roomName, status: '-', zones: '-', devices: '-', temp: '-', humidity: '-', co2: '-' };
        showDetailModal('Room Detail', [
            { label: 'Room', value: r.name },
            { label: 'Status', value: r.status },
            { label: 'Zones', value: r.zones },
            { label: 'Devices', value: r.devices },
            { label: 'Temperature', value: r.temp !== '-' ? `${r.temp} °C` : 'No data' },
            { label: 'Humidity', value: r.humidity !== '-' ? `${r.humidity}%` : 'No data' },
            { label: 'CO₂', value: r.co2 !== '-' ? `${r.co2} ppm` : 'No data' }
        ]);
    }
}

/**
 * View device detail — shows available device metadata in a modal
 */
function viewDeviceDetail(deviceId) {
    console.log(`[viewDeviceDetail] ${deviceId}`);
    const device = devicesData.find(d => d.deviceId === deviceId);
    if (!device) {
        showDetailModal('Device Detail', [
            { label: 'Device ID', value: deviceId },
            { label: 'Status', value: 'Device data not loaded. Navigate to the farm detail view to see full device information.' }
        ]);
        return;
    }
    showDetailModal('Device Detail', [
        { label: 'Device ID', value: device.deviceId },
        { label: 'Name', value: device.name },
        { label: 'Type', value: device.type },
        { label: 'Location', value: device.location },
        { label: 'Status', value: device.status },
        { label: 'Last Seen', value: device.lastSeen },
        { label: 'Firmware', value: device.firmware }
    ]);
}

/**
 * View tray detail — shows available tray/inventory data in a modal
 */
function viewTrayDetail(trayId) {
    console.log(`[viewTrayDetail] ${trayId}`);
    const tray = inventoryData.find(t => t.trayId === trayId);
    if (!tray) {
        showDetailModal('Tray Detail', [
            { label: 'Tray ID', value: trayId },
            { label: 'Status', value: 'Tray data not loaded. Navigate to the farm detail view to see full inventory.' }
        ]);
        return;
    }
    showDetailModal('Tray Detail', [
        { label: 'Tray ID', value: tray.trayId },
        { label: 'Recipe', value: tray.recipe },
        { label: 'Location', value: tray.location },
        { label: 'Plant Count', value: tray.plantCount },
        { label: 'Age', value: `${tray.age} days` },
        { label: 'Harvest Estimate', value: tray.harvestEst },
        { label: 'Status', value: tray.status }
    ]);
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
// ============================================================================
// PROCUREMENT MANAGEMENT FUNCTIONS
// ============================================================================

/**
 * Load Procurement Catalog view
 */
async function loadProcurementCatalog() {
    console.log('[Procurement] Loading catalog...');
    try {
        const resp = await authenticatedFetch(`${API_BASE}/api/procurement/catalog`);
        if (!resp) return;
        const data = await resp.json();
        if (!data.ok) throw new Error(data.error);

        // Update KPIs
        document.getElementById('catalog-total-products').textContent = data.total || 0;
        document.getElementById('catalog-in-stock').textContent = data.inStock || 0;
        document.getElementById('catalog-out-of-stock').textContent = data.outOfStock || 0;
        document.getElementById('catalog-categories').textContent = (data.categories || []).length;

        // Populate category filter
        const filter = document.getElementById('catalog-category-filter');
        const currentVal = filter.value;
        filter.innerHTML = '<option value="">All Categories</option>';
        (data.categories || []).forEach(c => {
            filter.innerHTML += `<option value="${c}">${c}</option>`;
        });
        filter.value = currentVal;

        // Filter products
        let products = data.products || [];
        const searchTerm = (document.getElementById('catalog-search')?.value || '').toLowerCase();
        const catFilter = filter.value;
        if (catFilter) products = products.filter(p => p.category === catFilter);
        if (searchTerm) products = products.filter(p =>
            (p.name || '').toLowerCase().includes(searchTerm) ||
            (p.sku || '').toLowerCase().includes(searchTerm)
        );

        // Render table
        const tbody = document.getElementById('catalog-products-tbody');
        if (products.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px;">No products found</td></tr>';
            return;
        }
        tbody.innerHTML = products.map(p => `
            <tr>
                <td><code style="font-size: 0.85em;">${p.sku || '--'}</code></td>
                <td>${p.name || '--'}</td>
                <td>${p.category || '--'}</td>
                <td>${p.supplierName || p.supplierId || '--'}</td>
                <td>$${(p.unitPrice || 0).toFixed(2)}</td>
                <td>${p.unit || '--'}</td>
                <td><span class="status-badge ${p.inStock ? 'status-active' : 'status-inactive'}">${p.inStock ? 'In Stock' : 'Out of Stock'}</span></td>
                <td>
                    <button class="btn-sm" onclick="editCatalogProduct('${p.sku}')">Edit</button>
                    <button class="btn-sm btn-danger" onclick="deleteCatalogProduct('${p.sku}')">Delete</button>
                </td>
            </tr>
        `).join('');

    } catch (err) {
        console.error('[Procurement] Catalog load error:', err);
        showToast('Failed to load catalog', 'error');
    }
}

/**
 * Load Procurement Suppliers view
 */
async function loadProcurementSuppliers() {
    console.log('[Procurement] Loading suppliers...');
    try {
        const resp = await authenticatedFetch(`${API_BASE}/api/procurement/suppliers`);
        if (!resp) return;
        const data = await resp.json();
        if (!data.ok) throw new Error(data.error);

        const suppliers = data.suppliers || [];
        const active = suppliers.filter(s => s.status === 'active').length;
        const totalProducts = suppliers.reduce((sum, s) => sum + (s.productCount || 0), 0);
        const avgCommission = suppliers.length > 0
            ? suppliers.reduce((sum, s) => sum + (s.commissionRate || 0), 0) / suppliers.length
            : 0;

        document.getElementById('suppliers-total').textContent = suppliers.length;
        document.getElementById('suppliers-active').textContent = active;
        document.getElementById('suppliers-product-count').textContent = totalProducts;
        document.getElementById('suppliers-avg-commission').textContent = (avgCommission * 100).toFixed(1) + '%';

        const tbody = document.getElementById('suppliers-list-tbody');
        if (suppliers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">No suppliers found</td></tr>';
            return;
        }
        tbody.innerHTML = suppliers.map(s => `
            <tr>
                <td><code style="font-size: 0.85em;">${s.id || '--'}</code></td>
                <td>${s.name || '--'}</td>
                <td>${s.contactEmail || s.contact || '--'}</td>
                <td>${s.productCount || 0}</td>
                <td>${((s.commissionRate || 0) * 100).toFixed(1)}%</td>
                <td><span class="status-badge ${s.status === 'active' ? 'status-active' : 'status-inactive'}">${s.status || 'unknown'}</span></td>
                <td>
                    <button class="btn-sm" onclick="editSupplier('${s.id}')">Edit</button>
                </td>
            </tr>
        `).join('');

    } catch (err) {
        console.error('[Procurement] Suppliers load error:', err);
        showToast('Failed to load suppliers', 'error');
    }
}

/**
 * Load Procurement Revenue view
 */
async function loadProcurementRevenue() {
    console.log('[Procurement] Loading revenue...');
    try {
        const fromDate = document.getElementById('revenue-from')?.value || '';
        const toDate = document.getElementById('revenue-to')?.value || '';
        let url = `${API_BASE}/api/procurement/revenue`;
        const params = [];
        if (fromDate) params.push(`from=${fromDate}`);
        if (toDate) params.push(`to=${toDate}`);
        if (params.length) url += '?' + params.join('&');

        const resp = await authenticatedFetch(url);
        if (!resp) return;
        const data = await resp.json();
        if (!data.ok) throw new Error(data.error);

        const summary = data.summary || {};
        document.getElementById('revenue-total').textContent = '$' + (summary.totalRevenue || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
        document.getElementById('revenue-commission').textContent = '$' + (summary.totalCommission || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
        document.getElementById('revenue-orders').textContent = summary.totalOrders || 0;
        document.getElementById('revenue-avg-order').textContent = '$' + (summary.avgOrderValue || 0).toFixed(2);

        // Revenue by supplier
        const suppTbody = document.getElementById('revenue-by-supplier-tbody');
        const bySupplier = data.bySupplier || [];
        if (bySupplier.length === 0) {
            suppTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">No revenue data</td></tr>';
        } else {
            suppTbody.innerHTML = bySupplier.map(s => `
                <tr>
                    <td>${s.name || s.supplierId}</td>
                    <td>${s.orderCount}</td>
                    <td>$${s.revenue.toFixed(2)}</td>
                    <td>$${s.commission.toFixed(2)}</td>
                </tr>
            `).join('');
        }

        // Revenue by month
        const monthTbody = document.getElementById('revenue-by-month-tbody');
        const byMonth = data.byMonth || [];
        if (byMonth.length === 0) {
            monthTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">No monthly data</td></tr>';
        } else {
            monthTbody.innerHTML = byMonth.map(m => `
                <tr>
                    <td>${m.month}</td>
                    <td>${m.orderCount}</td>
                    <td>$${m.revenue.toFixed(2)}</td>
                    <td>$${m.commission.toFixed(2)}</td>
                </tr>
            `).join('');
        }

    } catch (err) {
        console.error('[Procurement] Revenue load error:', err);
        showToast('Failed to load revenue data', 'error');
    }
}

/**
 * Open modal to add a new product to the catalog
 */
function openAddProductModal() {
    const html = `
        <div style="display: grid; gap: 12px;">
            <input type="text" id="new-product-sku" placeholder="SKU (e.g. PROC-NUT-FLORA-GROW)" style="padding: 10px; border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color);">
            <input type="text" id="new-product-name" placeholder="Product Name" style="padding: 10px; border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color);">
            <select id="new-product-category" style="padding: 10px; border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color);">
                <option value="">Select Category</option>
                <option value="Seeds & Growing Media">Seeds & Growing Media</option>
                <option value="Nutrients & Supplements">Nutrients & Supplements</option>
                <option value="Packaging & Labels">Packaging & Labels</option>
                <option value="Equipment & Parts">Equipment & Parts</option>
                <option value="Lab & Testing">Lab & Testing</option>
            </select>
            <input type="number" id="new-product-price" placeholder="Unit Price" step="0.01" style="padding: 10px; border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color);">
            <input type="text" id="new-product-unit" placeholder="Unit (e.g. gallon, case, bag)" style="padding: 10px; border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color);">
            <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 8px;">
                <button class="btn-secondary" onclick="closeModal()">Cancel</button>
                <button class="btn-primary" onclick="saveCatalogProduct()">Save Product</button>
            </div>
        </div>
    `;
    openModal('Add Product to Catalog', html);
}

/**
 * Save a new catalog product
 */
async function saveCatalogProduct() {
    const product = {
        sku: document.getElementById('new-product-sku').value.trim(),
        name: document.getElementById('new-product-name').value.trim(),
        category: document.getElementById('new-product-category').value,
        unitPrice: parseFloat(document.getElementById('new-product-price').value) || 0,
        unit: document.getElementById('new-product-unit').value.trim(),
        inStock: true
    };
    if (!product.sku || !product.name) {
        showToast('SKU and Name are required', 'warning');
        return;
    }
    try {
        const resp = await authenticatedFetch(`${API_BASE}/api/procurement/catalog/product`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product })
        });
        if (!resp) return;
        const data = await resp.json();
        if (!data.ok) throw new Error(data.error);
        closeModal();
        showToast(`Product ${data.action}: ${product.name}`, 'success');
        await loadProcurementCatalog();
    } catch (err) {
        showToast('Failed to save product: ' + err.message, 'error');
    }
}

/**
 * Edit an existing catalog product
 */
async function editCatalogProduct(sku) {
    try {
        const resp = await authenticatedFetch(`${API_BASE}/api/procurement/catalog`);
        if (!resp) return;
        const data = await resp.json();
        const product = (data.products || []).find(p => p.sku === sku);
        if (!product) { showToast('Product not found', 'error'); return; }

        const html = `
            <div style="display: grid; gap: 12px;">
                <input type="text" id="new-product-sku" value="${product.sku}" disabled style="padding: 10px; border-radius: 4px; background: var(--bg-secondary); color: var(--text-secondary); border: 1px solid var(--border-color);">
                <input type="text" id="new-product-name" value="${product.name || ''}" style="padding: 10px; border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color);">
                <select id="new-product-category" style="padding: 10px; border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color);">
                    <option value="">Select Category</option>
                    <option value="Seeds & Growing Media" ${product.category === 'Seeds & Growing Media' ? 'selected' : ''}>Seeds & Growing Media</option>
                    <option value="Nutrients & Supplements" ${product.category === 'Nutrients & Supplements' ? 'selected' : ''}>Nutrients & Supplements</option>
                    <option value="Packaging & Labels" ${product.category === 'Packaging & Labels' ? 'selected' : ''}>Packaging & Labels</option>
                    <option value="Equipment & Parts" ${product.category === 'Equipment & Parts' ? 'selected' : ''}>Equipment & Parts</option>
                    <option value="Lab & Testing" ${product.category === 'Lab & Testing' ? 'selected' : ''}>Lab & Testing</option>
                </select>
                <input type="number" id="new-product-price" value="${product.unitPrice || ''}" step="0.01" style="padding: 10px; border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color);">
                <input type="text" id="new-product-unit" value="${product.unit || ''}" style="padding: 10px; border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color);">
                <label style="display: flex; align-items: center; gap: 8px; color: var(--text-primary);">
                    <input type="checkbox" id="new-product-instock" ${product.inStock ? 'checked' : ''}> In Stock
                </label>
                <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 8px;">
                    <button class="btn-secondary" onclick="closeModal()">Cancel</button>
                    <button class="btn-primary" onclick="saveCatalogProduct()">Update Product</button>
                </div>
            </div>
        `;
        openModal('Edit Product', html);
    } catch (err) {
        showToast('Failed to load product', 'error');
    }
}

/**
 * Delete a catalog product
 */
async function deleteCatalogProduct(sku) {
    const confirmed = await showConfirmModal({
        title: 'Delete Product',
        message: `Delete product ${sku}?`,
        submessage: 'This action cannot be undone.',
        confirmText: 'Delete Product'
    });
    if (!confirmed) return;
    try {
        const resp = await authenticatedFetch(`${API_BASE}/api/procurement/catalog/product/${sku}`, { method: 'DELETE' });
        if (!resp) return;
        const data = await resp.json();
        if (!data.ok) throw new Error(data.error);
        showToast(`Product ${sku} deleted`, 'success');
        await loadProcurementCatalog();
    } catch (err) {
        showToast('Failed to delete product: ' + err.message, 'error');
    }
}

/**
 * Open modal to add a new supplier
 */
function openAddSupplierModal() {
    const html = `
        <div style="display: grid; gap: 12px;">
            <input type="text" id="new-supplier-name" placeholder="Supplier Name" style="padding: 10px; border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color);">
            <input type="email" id="new-supplier-email" placeholder="Contact Email" style="padding: 10px; border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color);">
            <input type="text" id="new-supplier-phone" placeholder="Phone" style="padding: 10px; border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color);">
            <input type="number" id="new-supplier-commission" placeholder="Commission Rate (e.g. 0.12)" step="0.01" min="0" max="1" style="padding: 10px; border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color);">
            <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 8px;">
                <button class="btn-secondary" onclick="closeModal()">Cancel</button>
                <button class="btn-primary" onclick="saveNewSupplier()">Add Supplier</button>
            </div>
        </div>
    `;
    openModal('Add Supplier', html);
}

/**
 * Save a new supplier
 */
async function saveNewSupplier() {
    const supplier = {
        name: document.getElementById('new-supplier-name').value.trim(),
        contactEmail: document.getElementById('new-supplier-email').value.trim(),
        phone: document.getElementById('new-supplier-phone').value.trim(),
        commissionRate: parseFloat(document.getElementById('new-supplier-commission').value) || 0
    };
    if (!supplier.name) { showToast('Supplier name is required', 'warning'); return; }
    try {
        const resp = await authenticatedFetch(`${API_BASE}/api/procurement/suppliers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(supplier)
        });
        if (!resp) return;
        const data = await resp.json();
        if (!data.ok) throw new Error(data.error);
        closeModal();
        showToast(`Supplier added: ${supplier.name}`, 'success');
        await loadProcurementSuppliers();
    } catch (err) {
        showToast('Failed to add supplier: ' + err.message, 'error');
    }
}

/**
 * Edit an existing supplier
 */
async function editSupplier(supplierId) {
    try {
        const resp = await authenticatedFetch(`${API_BASE}/api/procurement/suppliers`);
        if (!resp) return;
        const data = await resp.json();
        const supplier = (data.suppliers || []).find(s => s.id === supplierId);
        if (!supplier) { showToast('Supplier not found', 'error'); return; }

        const html = `
            <div style="display: grid; gap: 12px;">
                <input type="text" value="${supplier.id}" disabled style="padding: 10px; border-radius: 4px; background: var(--bg-secondary); color: var(--text-secondary); border: 1px solid var(--border-color);">
                <input type="text" id="edit-supplier-name" value="${supplier.name || ''}" placeholder="Supplier Name" style="padding: 10px; border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color);">
                <input type="email" id="edit-supplier-email" value="${supplier.contactEmail || ''}" placeholder="Contact Email" style="padding: 10px; border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color);">
                <input type="text" id="edit-supplier-phone" value="${supplier.phone || ''}" placeholder="Phone" style="padding: 10px; border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color);">
                <input type="number" id="edit-supplier-commission" value="${supplier.commissionRate || ''}" placeholder="Commission Rate" step="0.01" min="0" max="1" style="padding: 10px; border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color);">
                <select id="edit-supplier-status" style="padding: 10px; border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color);">
                    <option value="active" ${supplier.status === 'active' ? 'selected' : ''}>Active</option>
                    <option value="inactive" ${supplier.status === 'inactive' ? 'selected' : ''}>Inactive</option>
                    <option value="pending" ${supplier.status === 'pending' ? 'selected' : ''}>Pending</option>
                </select>
                <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 8px;">
                    <button class="btn-secondary" onclick="closeModal()">Cancel</button>
                    <button class="btn-primary" onclick="updateSupplier('${supplierId}')">Update</button>
                </div>
            </div>
        `;
        openModal('Edit Supplier', html);
    } catch (err) {
        showToast('Failed to load supplier', 'error');
    }
}

/**
 * Update an existing supplier
 */
async function updateSupplier(supplierId) {
    const updates = {
        name: document.getElementById('edit-supplier-name').value.trim(),
        contactEmail: document.getElementById('edit-supplier-email').value.trim(),
        phone: document.getElementById('edit-supplier-phone').value.trim(),
        commissionRate: parseFloat(document.getElementById('edit-supplier-commission').value) || 0,
        status: document.getElementById('edit-supplier-status').value
    };
    try {
        const resp = await authenticatedFetch(`${API_BASE}/api/procurement/suppliers/${supplierId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        if (!resp) return;
        const data = await resp.json();
        if (!data.ok) throw new Error(data.error);
        closeModal();
        showToast('Supplier updated', 'success');
        await loadProcurementSuppliers();
    } catch (err) {
        showToast('Failed to update supplier: ' + err.message, 'error');
    }
}

// VIEW DATA LOADING FUNCTIONS
// ============================================================================

/**
 * Load AI Analytics view
 */
async function loadAnalytics() {
    console.log('[Analytics] Loading farm analytics data...');
    
    // Load farm metrics data - this will also populate model performance from API
    const farmId = resolveAnalyticsFarmId();
    if (!farmId) {
        showToast('No farms available for analytics', 'warning');
        return;
    }
    currentAnalyticsFarmId = farmId;
    await loadFarmMetrics(farmId, 7);
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
            ? `${API_BASE}/api/admin/farms/${farmId}/zones`
            : `${API_BASE}/api/admin/zones`;
        
        console.log('[Environmental] Fetching from:', url);
        const response = await authenticatedFetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        console.log('[Environmental] Response:', data);
        
        const zones = data.zones || data.telemetry?.zones || [];
        
        // Calculate averages from real data
        let totalTemp = 0, totalHumidity = 0, totalCO2 = 0, totalVPD = 0, totalPressure = 0, totalGas = 0;
        let tempCount = 0, humidityCount = 0, co2Count = 0, vpdCount = 0, pressureCount = 0, gasCount = 0;
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
            
            // Pressure
            const pressure = zone.pressure_hpa || zone.pressure || zone.pressureHpa || zone.sensors?.pressureHpa?.current || zone.sensors?.pressure_hpa?.current;
            if (pressure != null) {
                totalPressure += pressure;
                pressureCount++;
            }
            
            // Gas
            const gas = zone.gas_kohm || zone.gas || zone.gasKohm || zone.sensors?.gasKohm?.current || zone.sensors?.gas_kohm?.current;
            if (gas != null) {
                totalGas += gas;
                gasCount++;
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
        document.getElementById('env-avg-pressure').textContent = pressureCount > 0
            ? (totalPressure / pressureCount).toFixed(1) + ' hPa'
            : 'N/A';
        document.getElementById('env-avg-gas').textContent = gasCount > 0
            ? (totalGas / gasCount).toFixed(1) + ' kΩ'
            : 'N/A';
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
        document.getElementById('env-avg-pressure').textContent = 'N/A';
        document.getElementById('env-avg-gas').textContent = 'N/A';
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
            throw new Error(`Failed to load energy data (${response.status})`);
        }
        
        const apiData = await response.json();
        const energyData = apiData?.data || apiData || {};

        const total24h = Number(energyData.total24h ?? energyData.summary?.totalConsumption ?? 0);
        const totalCost = Number(energyData.summary?.cost ?? 0);
        const costPerKwh = Number(energyData.costPerKwh ?? (total24h > 0 ? totalCost / total24h : 0));
        const efficiency = Number(energyData.efficiency ?? 0);
        const savingsKwh = Number(energyData.savingsKwh ?? 0);

        document.getElementById('energy-total-24h').textContent = Number.isFinite(total24h) ? total24h.toLocaleString() : '0';
        document.getElementById('energy-cost-kwh').textContent = Number.isFinite(costPerKwh) ? costPerKwh.toFixed(2) : '0.00';
        document.getElementById('energy-efficiency').textContent = Number.isFinite(efficiency) ? `${efficiency}%` : '0%';
        document.getElementById('energy-savings').textContent = Number.isFinite(savingsKwh) ? savingsKwh.toLocaleString() : '0';

        const topConsumers = Array.isArray(energyData.topConsumers)
            ? energyData.topConsumers
            : (Array.isArray(energyData.byFarm)
                ? energyData.byFarm.slice(0, 5).map(farm => ({
                    name: farm.farmName || farm.farmId || 'Farm',
                    type: 'Farm',
                    consumption: Number(farm.consumption || 0)
                }))
                : []);

        const consumersHtml = topConsumers.length > 0
            ? topConsumers.map(c => `
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
        const response = await authenticatedFetch(`${API_BASE}/api/admin/anomalies`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('[Anomalies] Received data:', data);
        
        if (!data.success) {
            throw new Error(data.error || 'Failed to load anomalies');
        }
        
        const anomalies = data.anomalies || [];
        const mlEnabled = data.mlEnabled;
        
        // Update KPIs based on actual data
        const totalAnomalies = anomalies.length;
        const criticalCount = anomalies.filter(a => a.severity === 'critical').length;
        const warningCount = anomalies.filter(a => a.severity === 'warning').length;
        const acknowledged = anomalies.filter(a => a.status === 'acknowledged').length;
        
        document.getElementById('anomalies-total').textContent = totalAnomalies;
        document.getElementById('anomalies-critical').textContent = criticalCount;
        document.getElementById('anomalies-ack').textContent = acknowledged;
        document.getElementById('anomalies-rate').textContent = mlEnabled ? '98.5%' : 'N/A';
        
        if (anomalies.length === 0) {
            const message = mlEnabled 
                ? 'No anomalies detected - all systems operating normally'
                : 'ML anomaly detection not available. Check that ML jobs are running on edge devices.';
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 24px; color: var(--text-muted);">${message}</td></tr>`;
            return;
        }
        
        // Transform data to match dashboard format
        const html = anomalies.map((anomaly, idx) => {
            const timestamp = anomaly.timestamp || anomaly.created_at || anomaly.lastUpdated;
            const timestampLabel = timestamp ? new Date(timestamp).toLocaleString() : '—';
            const farm = anomaly.farmName || anomaly.farmId || 'Unknown Farm';
            const type = (anomaly.type || anomaly.category || 'environmental').toString().toLowerCase();
            const severity = (anomaly.severity || 'warning').toString().toLowerCase();
            const description = anomaly.reason || anomaly.description || 'Anomaly detected';
            const confidence = Number.isFinite(anomaly.confidence)
                ? Math.round(anomaly.confidence * (anomaly.confidence <= 1 ? 100 : 1))
                : '—';
            const status = anomaly.status || 'new';
            
            // Build context for tracing
            const context = {
                farmId: anomaly.farmId || null,
                roomId: anomaly.roomId || anomaly.room || null,
                zoneId: anomaly.zone || anomaly.zoneId || null,
                groupId: anomaly.groupId || null,
                deviceId: anomaly.deviceId || null
            };
            
            return `
                <tr>
                    <td>${timestampLabel}</td>
                    <td>${farm}</td>
                    <td>${type}</td>
                    <td><span class="status-badge status-${severity}">${severity}</span></td>
                    <td>${description}</td>
                    <td>${confidence === '—' ? '—' : `${confidence}%`}</td>
                    <td>${status}</td>
                    <td>
                        <button class="btn-small" onclick="traceAnomaly('anom-${idx}', ${JSON.stringify(context).replace(/"/g, '&quot;')})">Trace</button>
                        <button class="btn-small" style="margin-left: 4px;">Acknowledge</button>
                    </td>
                </tr>
            `;
        }).join('');
        
        tbody.innerHTML = html;
        
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
async function loadAlertsView(options = {}) {
    const { farmId = null, severity = null, status = null } = options;
    console.log('[Alerts] Loading alerts...', { farmId, severity, status });
    const container = document.getElementById('alerts-grouped-container');
    if (!container) {
        console.warn('[Alerts] Grouped container not found');
        return;
    }

    try {
        // Populate farm filter dropdown (once)
        populateAlertFarmFilter();

        // Fetch live alert data from API
        const params = new URLSearchParams();
        if (farmId) params.append('farm_id', farmId);
        if (severity) params.append('severity', severity);
        if (status) params.append('status', status);
        params.append('limit', '200');
        const query = params.toString();
        const response = await authenticatedFetch(`${API_BASE}/api/admin/alerts${query ? `?${query}` : ''}`);

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

        // Update KPIs
        document.getElementById('alerts-active').textContent = summary.active || 0;
        document.getElementById('alerts-critical').textContent = summary.critical || 0;
        document.getElementById('alerts-warnings').textContent = summary.warning || 0;
        document.getElementById('alerts-resolved').textContent = summary.resolved || 0;

        if (alerts.length === 0) {
            container.innerHTML = '<p style="padding:24px;text-align:center;color:var(--text-muted);">No alerts match your filters.</p>';
            return;
        }

        const groupByFarm = document.getElementById('alerts-group-by-farm')?.checked;

        if (groupByFarm) {
            renderAlertsGrouped(container, alerts);
        } else {
            renderAlertsFlat(container, alerts);
        }

    } catch (error) {
        console.error('[Alerts] Error loading data:', error);
        container.innerHTML = '<p style="padding:24px;text-align:center;color:var(--accent-red);">Error loading alerts: ' + error.message + '</p>';
        document.getElementById('alerts-active').textContent = '--';
        document.getElementById('alerts-critical').textContent = '--';
        document.getElementById('alerts-warnings').textContent = '--';
        document.getElementById('alerts-resolved').textContent = '--';
        showToast('Failed to load alert data', 'error');
    }
}

/**
 * Populate the farm filter dropdown from the alerts/farms endpoint
 */
let _alertFarmsLoaded = false;
async function populateAlertFarmFilter() {
    if (_alertFarmsLoaded) return;
    const select = document.getElementById('filter-alert-farm');
    if (!select) return;
    try {
        const resp = await authenticatedFetch(`${API_BASE}/api/admin/alerts/farms`);
        const data = await resp.json();
        if (data.success && data.farms) {
            data.farms.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f.farm_id;
                opt.textContent = f.farm_name || f.farm_id;
                select.appendChild(opt);
            });
            _alertFarmsLoaded = true;
        }
    } catch (e) {
        console.warn('[Alerts] Could not load farm list for filter');
    }
}

/**
 * Render alerts grouped by farm in collapsible accordion sections
 */
function renderAlertsGrouped(container, alerts) {
    // Group by farm
    const groups = {};
    const platformAlerts = [];
    alerts.forEach(a => {
        const key = a.farm_id || null;
        if (key) {
            if (!groups[key]) groups[key] = { name: a.farm_name || a.farm_id || key, alerts: [] };
            groups[key].alerts.push(a);
        } else {
            platformAlerts.push(a);
        }
    });

    let html = '';

    // Farm groups
    Object.keys(groups).sort().forEach(farmId => {
        const group = groups[farmId];
        const activeCount = group.alerts.filter(a => a.status === 'active').length;
        const critCount = group.alerts.filter(a => a.severity === 'critical' || a.severity === 'high').length;
        const sectionId = 'alert-farm-' + farmId.replace(/[^a-zA-Z0-9]/g, '_');

        html += '<div class="alert-farm-group" data-farm-id="' + farmId + '">';
        html += '<div class="alert-farm-header" onclick="toggleAlertFarmGroup(\'' + sectionId + '\')">';
        html += '  <div class="alert-farm-header-left">';
        html += '    <span class="alert-farm-chevron" id="chevron-' + sectionId + '">&#9654;</span>';
        html += '    <strong>' + (group.name) + '</strong>';
        html += '    <span class="alert-farm-count">' + group.alerts.length + ' alert' + (group.alerts.length !== 1 ? 's' : '') + '</span>';
        if (activeCount > 0) html += '    <span class="alert-farm-active">' + activeCount + ' active</span>';
        if (critCount > 0) html += '    <span class="alert-farm-critical">' + critCount + ' critical</span>';
        html += '  </div>';
        html += '  <div class="alert-farm-header-actions">';
        html += '    <button class="btn-small" onclick="event.stopPropagation(); bulkResolveFarm(\'' + farmId + '\')">Resolve All</button>';
        html += '  </div>';
        html += '</div>';
        html += '<div class="alert-farm-body" id="' + sectionId + '" style="display:none;">';
        html += buildAlertTable(group.alerts);
        html += '</div>';
        html += '</div>';
    });

    // Platform/admin alerts (no farm_id)
    if (platformAlerts.length > 0) {
        const sectionId = 'alert-farm-platform';
        html += '<div class="alert-farm-group">';
        html += '<div class="alert-farm-header" onclick="toggleAlertFarmGroup(\'' + sectionId + '\')">';
        html += '  <div class="alert-farm-header-left">';
        html += '    <span class="alert-farm-chevron" id="chevron-' + sectionId + '">&#9654;</span>';
        html += '    <strong>Platform / F.A.Y.E.</strong>';
        html += '    <span class="alert-farm-count">' + platformAlerts.length + ' alert' + (platformAlerts.length !== 1 ? 's' : '') + '</span>';
        html += '  </div>';
        html += '</div>';
        html += '<div class="alert-farm-body" id="' + sectionId + '" style="display:none;">';
        html += buildAlertTable(platformAlerts);
        html += '</div>';
        html += '</div>';
    }

    container.innerHTML = html;
}

/**
 * Render flat (non-grouped) alert table
 */
function renderAlertsFlat(container, alerts) {
    container.innerHTML = '<div class="table-container">' + buildAlertTable(alerts) + '</div>';
}

/**
 * Build an alert table from an array of alerts
 */
function buildAlertTable(alerts) {
    let html = '<table class="alert-table"><thead><tr>';
    html += '<th>Time</th><th>Source</th><th>Severity</th><th>Type</th><th>Message</th><th>Status</th><th>Actions</th>';
    html += '</tr></thead><tbody>';

    alerts.forEach(function (alert) {
        const sourceLabel = alert.source_table === 'admin' ? 'F.A.Y.E.' : 'E.V.I.E.';
        const sourceColor = alert.source_table === 'admin' ? 'var(--accent-blue)' : 'var(--accent-green, #22c55e)';
        const hasDetail = alert.detail || alert.tool || alert.recovery_strategy;
        const detailId = 'alert-detail-' + alert.source_table + '-' + alert.id;

        let detailParts = [];
        if (alert.detail) detailParts.push('<strong>Detail:</strong> ' + alert.detail);
        if (alert.tool) detailParts.push('<strong>Source/Tool:</strong> ' + alert.tool);
        if (alert.recovery_attempted) {
            detailParts.push('<strong>Recovery attempted:</strong> ' + (alert.recovery_strategy || 'yes'));
        }
        if (alert.acknowledged_at) {
            detailParts.push('<strong>Acknowledged:</strong> ' + new Date(alert.acknowledged_at).toLocaleString() + ' by ' + (alert.acknowledged_by || 'system'));
        }
        if (alert.resolved_at) {
            detailParts.push('<strong>Resolved:</strong> ' + new Date(alert.resolved_at).toLocaleString());
        }

        html += '<tr class="alert-row" style="cursor:' + (hasDetail ? 'pointer' : 'default') + ';" onclick="' + (hasDetail ? "toggleAlertDetail('" + detailId + "')" : '') + '">';
        html += '<td>' + new Date(alert.timestamp).toLocaleString() + '</td>';
        html += '<td><small style="color:' + sourceColor + ';">' + sourceLabel + '</small></td>';
        html += '<td><span class="status-badge status-' + (alert.severity === 'high' ? 'critical' : alert.severity) + '">' + alert.severity + '</span></td>';
        html += '<td>' + (alert.category || alert.type || '--') + '</td>';
        html += '<td><div style="margin-bottom:2px;">' + (alert.message || '--') + '</div>';
        if (hasDetail) html += '<small style="color:var(--text-muted);text-decoration:underline;">Click to expand</small>';
        html += '</td>';
        html += '<td><span class="status-badge status-' + (alert.status === 'active' ? 'warning' : alert.status === 'resolved' ? 'success' : 'info') + '">' + alert.status + '</span></td>';
        html += '<td>';
        if (alert.status === 'active') {
            html += '<button class="btn-small" onclick="event.stopPropagation(); acknowledgeAlert(\'' + alert.id + '\', \'' + alert.source_table + '\')">Ack</button>';
        } else if (alert.status === 'acknowledged') {
            html += '<button class="btn-small" onclick="event.stopPropagation(); resolveAlert(\'' + alert.id + '\', \'' + alert.source_table + '\')">Resolve</button>';
        } else {
            html += '--';
        }
        html += '</td></tr>';

        if (hasDetail) {
            html += '<tr id="' + detailId + '" class="alert-detail-row" style="display:none;">';
            html += '<td colspan="7" style="padding:12px 20px;background:var(--bg-secondary, rgba(0,0,0,0.15));border-left:3px solid ' + sourceColor + ';">';
            html += detailParts.join('<br style="margin-bottom:6px;">');
            html += '</td></tr>';
        }
    });

    html += '</tbody></table>';
    return html;
}

/**
 * Toggle a farm group accordion
 */
function toggleAlertFarmGroup(sectionId) {
    const body = document.getElementById(sectionId);
    const chevron = document.getElementById('chevron-' + sectionId);
    if (!body) return;
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : '';
    if (chevron) chevron.innerHTML = isOpen ? '&#9654;' : '&#9660;';
}

/**
 * Toggle expandable detail row for an alert
 */
function toggleAlertDetail(detailId) {
    const row = document.getElementById(detailId);
    if (row) {
        row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
    }
}

function filterAlerts() {
    const severity = document.getElementById('filter-alert-severity')?.value || null;
    const status = document.getElementById('filter-alert-status')?.value || null;
    const farmId = document.getElementById('filter-alert-farm')?.value || null;
    loadAlertsView({ farmId, severity, status });
}

/**
 * Acknowledge an alert
 */
async function acknowledgeAlert(alertId, sourceTable) {
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/alerts/${alertId}/acknowledge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_table: sourceTable || 'farm' })
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to acknowledge alert');
        showToast('Alert acknowledged', 'success');
        await loadAlertsView();
    } catch (error) {
        console.error('[Alerts] Error acknowledging alert:', error);
        showToast('Failed to acknowledge alert', 'error');
    }
}

/**
 * Resolve an alert
 */
async function resolveAlert(alertId, sourceTable) {
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/alerts/${alertId}/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_table: sourceTable || 'farm' })
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to resolve alert');
        showToast('Alert resolved', 'success');
        await loadAlertsView();
    } catch (error) {
        console.error('[Alerts] Error resolving alert:', error);
        showToast('Failed to resolve alert', 'error');
    }
}

/**
 * Acknowledge all active alerts (batch operation)
 */
async function acknowledgeAllAlerts() {
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/alerts/acknowledge-all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to acknowledge alerts');
        showToast(`${data.count} alert(s) acknowledged`, 'success');
        await loadAlertsView();
    } catch (error) {
        console.error('[Alerts] Error acknowledging all alerts:', error);
        showToast('Failed to acknowledge alerts', 'error');
    }
}

/**
 * Resolve all unresolved alerts (batch operation)
 */
async function resolveAllAlerts() {
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/alerts/resolve-all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to resolve alerts');
        showToast(`${data.count} alert(s) resolved`, 'success');
        await loadAlertsView();
    } catch (error) {
        console.error('[Alerts] Error resolving all alerts:', error);
        showToast('Failed to resolve alerts', 'error');
    }
}

/**
 * Resolve all alerts for a specific farm
 */
async function bulkResolveFarm(farmId) {
    if (!confirm('Resolve all alerts for this farm?')) return;
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/alerts/bulk-resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ farm_id: farmId })
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error);
        showToast(`${data.count} alert(s) resolved for farm`, 'success');
        await loadAlertsView();
    } catch (error) {
        console.error('[Alerts] Bulk resolve farm error:', error);
        showToast('Failed to resolve farm alerts', 'error');
    }
}

/**
 * Resolve alerts older than N hours (prompted)
 */
async function bulkResolveOlder() {
    const hours = prompt('Resolve alerts older than how many hours?\n(e.g. 24 for 1 day, 168 for 1 week)', '24');
    if (!hours || isNaN(hours)) return;
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/alerts/bulk-resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ older_than_hours: parseInt(hours) })
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error);
        showToast(`${data.count} older alert(s) resolved`, 'success');
        await loadAlertsView();
    } catch (error) {
        console.error('[Alerts] Bulk resolve older error:', error);
        showToast('Failed to resolve older alerts', 'error');
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

// filterAlerts() defined above at the alerts view section

/**
 * ===================================
 * ANALYTICS FUNCTIONS
 * ===================================
 */

let currentAnalyticsFarmId = null;
let analyticsData = {
    metrics: [],
    summary: {}
};

function normalizeFarmIdValue(farmLike) {
    if (!farmLike) return null;
    if (typeof farmLike === 'string') {
        const id = farmLike.trim();
        return id || null;
    }
    const id = farmLike.farmId || farmLike.farm_id || null;
    if (!id) return null;
    return String(id).trim() || null;
}

function normalizeAnalyticsMetrics(metrics) {
    if (!Array.isArray(metrics)) return [];
    return metrics.map((m) => ({
        date: m.date || m.recorded_at || m.timestamp || new Date().toISOString(),
        production_kg: Number(m.production_kg ?? m.plant_count ?? 0),
        revenue: Number(m.revenue ?? 0),
        costs: Number(m.costs ?? m.energy_24h ?? 0),
        efficiency_score: Number(m.efficiency_score ?? 0),
        trays_seeded: Number(m.trays_seeded ?? m.tray_count ?? 0),
        trays_harvested: Number(m.trays_harvested ?? 0),
        orders_fulfilled: Number(m.orders_fulfilled ?? 0)
    }));
}

function renderAnalyticsEmptyState(message = 'No metrics data available.') {
    analyticsData = {
        metrics: [],
        summary: {
            totalProduction: 0,
            totalRevenue: 0,
            daysReported: 0,
            avgYield: 0,
            topCrop: null
        }
    };
    renderAnalyticsSummary(analyticsData.summary);
    renderAnalyticsMetricsTable([]);
    console.warn('[Analytics]', message);
}

function resolveAnalyticsFarmId() {
    if (currentAnalyticsFarmId) return currentAnalyticsFarmId;
    if (currentFarmId) return currentFarmId;
    const fallbackFarm = farmsData.find(f => normalizeFarmIdValue(f)) || farmsData[0];
    return normalizeFarmIdValue(fallbackFarm);
}

/**
 * Load analytics for a specific farm
 */
async function loadAnalyticsForFarm(farmId) {
    const resolvedFarmId = normalizeFarmIdValue(farmId);
    currentAnalyticsFarmId = resolvedFarmId;
    await loadFarmMetrics(resolvedFarmId);
}

/**
 * Refresh analytics data
 */
async function refreshAnalytics() {
    const farmId = currentAnalyticsFarmId || resolveAnalyticsFarmId();
    if (!farmId) {
        console.warn('[Analytics] No farm available for analytics');
        return;
    }
    currentAnalyticsFarmId = farmId;
    await loadFarmMetrics(farmId);
}

/**
 * Load farm metrics from API
 */
async function loadFarmMetrics(farmId, days = 7, isFallback = false) {
    const resolvedFarmId = normalizeFarmIdValue(farmId);
    if (!resolvedFarmId) {
        console.warn('[Analytics] No farmId provided — skipping metrics load');
        renderAnalyticsEmptyState('No farm selected for analytics.');
        return;
    }

    currentAnalyticsFarmId = resolvedFarmId;

    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/analytics/farms/${resolvedFarmId}/metrics?days=${days}`);
        
        if (!response.ok) {
            console.error('Failed to load farm metrics:', response.status);
            if ((response.status === 404 || response.status === 400) && !isFallback) {
                const fallbackFarm = farmsData.find(f => {
                    const fid = normalizeFarmIdValue(f);
                    return fid && fid !== resolvedFarmId;
                });
                if (fallbackFarm) {
                    const fallbackId = normalizeFarmIdValue(fallbackFarm);
                    currentAnalyticsFarmId = fallbackId;
                    await loadFarmMetrics(fallbackId, days, true);
                    return;
                }
            }
            renderAnalyticsEmptyState(`Analytics endpoint returned HTTP ${response.status}.`);
            return;
        }
        
        const data = await response.json();
        analyticsData = {
            ...data,
            summary: data?.summary || {},
            metrics: normalizeAnalyticsMetrics(data?.metrics)
        };
        
        renderAnalyticsSummary(analyticsData.summary);
        renderAnalyticsMetricsTable(analyticsData.metrics);
        
    } catch (error) {
        console.error('Error loading farm metrics:', error);
        renderAnalyticsEmptyState(error.message || 'Error loading analytics data.');
    }
}

/**
 * Render analytics summary KPIs
 */
function renderAnalyticsSummary(summary) {
    if (!summary) return;

    const productionEl = document.getElementById('analytics-production');
    const productionAvgEl = document.getElementById('analytics-production-avg');
    const revenueEl = document.getElementById('analytics-revenue');
    if (!productionEl || !productionAvgEl || !revenueEl) {
        console.warn('[Analytics] Summary elements not found in DOM');
        return;
    }
    
    // Production
    productionEl.textContent = `${(summary.totalProduction || 0).toFixed(1)} kg`;
    productionAvgEl.textContent = `${((summary.totalProduction || 0) / (summary.daysReported || 1)).toFixed(1)} kg/day avg`;
    
    // Revenue
    revenueEl.textContent = `$${(summary.totalRevenue || 0).toFixed(2)}`;
    
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
            let zonesResponse;
            try {
                zonesResponse = await authenticatedFetch(`${API_BASE}/api/admin/farms/${farmId}/zones`);
                if (!zonesResponse || !zonesResponse.ok) throw new Error('No admin zones endpoint');
            } catch (zoneErr) {
                zonesResponse = await authenticatedFetch(`${API_BASE}/api/sync/${farmId}/telemetry`);
            }
            if (zonesResponse.ok) {
                const zonesData = await zonesResponse.json();
                zones = zonesData.zones || zonesData.telemetry?.zones || [];
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
    if (!tbody) {
        console.warn('[Analytics] Metrics table body not found in DOM');
        return;
    }
    const rows = Array.isArray(metrics) ? metrics : [];
    
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 40px; color: var(--text-secondary);">No metrics data available.</td></tr>';
        return;
    }
    
    tbody.innerHTML = rows.map(m => {
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
let recipeSortState = { key: 'name', direction: 'asc' };

const recipeFieldMap = new Map([
    ['day', 'day'],
    ['stage', 'stage'],
    ['dli target mol m2 d', 'dli_target'],
    ['dli target mol m d', 'dli_target'],
    ['dli target', 'dli_target'],
    ['dli target mol m2 day', 'dli_target'],
    ['dli target mol m 2 day', 'dli_target'],
    ['dli target mol m2 day ', 'dli_target'],
    ['dli target mol m 2 d', 'dli_target'],
    ['temp target c', 'temperature'],
    ['temperature c', 'temperature'],
    ['temperature (c)', 'temperature'],
    ['temp c', 'temperature'],
    ['afternoon temp c', 'afternoon_temp'],
    ['temperature', 'temperature'],
    ['blue', 'blue'],
    ['green', 'green'],
    ['red', 'red'],
    ['far red', 'far_red'],
    ['farred', 'far_red'],
    ['ppfd target umol m2 s', 'ppfd'],
    ['ppfd target mol m s', 'ppfd'],
    ['ppfd target umol m 2 s', 'ppfd'],
    ['ppfd target umol m2 s ', 'ppfd'],
    ['ppfd target umol m 2 s ', 'ppfd'],
    ['ppfd target (umol m2 s)', 'ppfd'],
    ['ppfd target (umol m 2 s)', 'ppfd'],
    ['ppfd target', 'ppfd'],
    ['ppfd umol m2 s', 'ppfd'],
    ['ppfd', 'ppfd'],
    ['vpd target kpa', 'vpd_target'],
    ['vpd target', 'vpd_target'],
    ['vpd kpa', 'vpd_target'],
    ['vpd', 'vpd_target'],
    ['max humidity', 'max_humidity'],
    ['ec target ds m', 'ec'],
    ['ec target', 'ec'],
    ['ec ms cm', 'ec'],
    ['ph target', 'ph'],
    ['ph', 'ph'],
    ['veg', 'veg'],
    ['fruit', 'fruit']
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
        return recipe.data.schedule.map(row => {
            const normalized = {};
            Object.entries(row).forEach(([key, value]) => {
                if (key in normalized) return;
                const normalizedKey = normalizeHeaderKey(key);
                const mappedKey = recipeFieldMap.get(normalizedKey) || key;
                normalized[mappedKey] = value;
            });
            return normalized;
        });
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
        const sorted = getSortedRecipes(recipesData);
        renderRecipesTableDetailed(sorted);
        updateRecipeSortIndicators();
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
        const normalizedSchedule = normalizeRecipeSchedule(recipe);
        if (normalizedSchedule.length > 0) {
            const temps = normalizedSchedule
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
                    <div style="font-weight: 500;" class="recipe-name-hover" data-desc="${(recipe.description || '').replace(/"/g, '&quot;')}">${recipe.name}</div>
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
                        <button onclick="viewRecipe('${recipe.id}')" class="btn btn-sm" style="padding: 4px 8px; font-size: 0.85rem;">View</button>
                        <button onclick="editRecipe('${recipe.id}')" class="btn btn-sm" style="padding: 4px 8px; font-size: 0.85rem;">Edit</button>
                        <button onclick="deleteRecipe('${recipe.id}', '${recipe.name}')" class="btn btn-sm" style="padding: 4px 8px; font-size: 0.85rem; background: var(--accent-red);">Delete</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    document.getElementById('recipes-count').textContent = `${recipes.length} recipe${recipes.length !== 1 ? 's' : ''}`;
}

function setRecipeSort(key) {
    if (recipeSortState.key === key) {
        recipeSortState.direction = recipeSortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
        recipeSortState.key = key;
        recipeSortState.direction = 'asc';
    }
    const sorted = getSortedRecipes(recipesData || []);
    renderRecipesTableDetailed(sorted);
    updateRecipeSortIndicators();
}

function getSortedRecipes(recipes) {
    if (!Array.isArray(recipes)) return [];
    const sorted = [...recipes];
    const dir = recipeSortState.direction === 'desc' ? -1 : 1;

    sorted.sort((a, b) => {
        const nameA = String(a?.name || '').toLowerCase();
        const nameB = String(b?.name || '').toLowerCase();
        const catA = String(a?.category || '').toLowerCase();
        const catB = String(b?.category || '').toLowerCase();

        if (recipeSortState.key === 'category') {
            if (catA !== catB) return catA.localeCompare(catB) * dir;
            return nameA.localeCompare(nameB) * dir;
        }
        return nameA.localeCompare(nameB) * dir;
    });

    return sorted;
}

function updateRecipeSortIndicators() {
    const nameIndicator = document.getElementById('recipe-sort-name');
    const categoryIndicator = document.getElementById('recipe-sort-category');
    if (nameIndicator) nameIndicator.textContent = recipeSortState.key === 'name' ? (recipeSortState.direction === 'asc' ? '▲' : '▼') : '';
    if (categoryIndicator) categoryIndicator.textContent = recipeSortState.key === 'category' ? (recipeSortState.direction === 'asc' ? '▲' : '▼') : '';
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
// -- Recipe Modal + Hover Tooltip --

/**
 * Show a styled modal popup for recipe details (replaces alert())
 */
function showRecipeModal(title, contentHtml) {
    // Remove existing modal if any
    const existing = document.getElementById('recipe-detail-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'recipe-detail-modal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);';
    overlay.innerHTML = `
        <div style="background:var(--bg, #fff);border:1px solid var(--border, #e5e7eb);border-radius:12px;max-width:640px;width:90%;max-height:80vh;overflow-y:auto;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,0.3);position:relative;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <h3 style="margin:0;font-size:1.2rem;">${title}</h3>
                <button onclick="document.getElementById('recipe-detail-modal').remove()" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-secondary);padding:4px 8px;line-height:1;">&times;</button>
            </div>
            <div>${contentHtml}</div>
        </div>
    `;
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
}

/**
 * Initialize recipe name hover tooltips
 */
(function initRecipeTooltips() {
    // Inject tooltip CSS once
    if (!document.getElementById('recipe-tooltip-style')) {
        const style = document.createElement('style');
        style.id = 'recipe-tooltip-style';
        style.textContent = `
            .recipe-name-hover {
                position: relative;
                cursor: default;
            }
            .recipe-name-hover[data-desc]:not([data-desc=""]):hover::after {
                content: attr(data-desc);
                position: absolute;
                left: 0;
                top: 100%;
                z-index: 9999;
                background: var(--bg, #1f2937);
                color: var(--text, #f3f4f6);
                border: 1px solid var(--border, #374151);
                border-radius: 8px;
                padding: 10px 14px;
                font-size: 0.82rem;
                font-weight: 400;
                line-height: 1.45;
                max-width: 340px;
                white-space: normal;
                box-shadow: 0 4px 16px rgba(0,0,0,0.25);
                pointer-events: none;
            }
        `;
        document.head.appendChild(style);
    }
})();


function getCategoryColor(category) {
    const colors = {
        'Leafy Greens': '#10b981',
        'Herbs': '#8b5cf6',
        'Microgreens': '#06b6d4',
        'Sprouts': '#14b8a6',
        'Tomatoes': '#ef4444',
        'Berries': '#ec4899',
        'Fruiting Crops': '#f59e0b',
        'Vegetables': '#f97316',
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
        
        const formatNumber = (value, decimals) => {
            const num = Number(value);
            return Number.isFinite(num) ? num.toFixed(decimals) : '';
        };
        const formatInteger = (value) => {
            const num = Number(value);
            return Number.isFinite(num) ? Math.round(num) : '';
        };

        // Render schedule table
        const tbody = document.getElementById('recipe-view-schedule');
        tbody.innerHTML = schedule.map(day => `
            <tr>
                <td>${day.day.toFixed(1) || ''}</td>
                <td>${day.stage || ''}</td>
                <td>${formatNumber(day.dli_target, 2)}</td>
                <td>${formatNumber(day.temperature || day.tempC || day.afternoon_temp, 1)}</td>
                <td>${formatNumber(day.vpd_target, 2)}</td>
                <td>${day.max_humidity || ''}</td>
                <td>${day.blue || 0}</td>
                <td>${day.green || 0}</td>
                <td>${day.red || 0}</td>
                <td>${day.far_red || 0}</td>
                <td>${formatInteger(day.ppfd)}</td>
                <td>${formatNumber(day.ec, 2)}</td>
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
        if (!response) {
            throw new Error('Authentication required. Please log in again.');
        }
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
        
        if (!response) {
            throw new Error('Authentication required. Please log in again.');
        }
        
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
    const confirmed = await showConfirmModal({
        title: 'Delete Recipe',
        message: `Delete recipe "${recipeName}"?`,
        submessage: 'This action cannot be undone.',
        confirmText: 'Delete Recipe'
    });
    if (!confirmed) {
        return;
    }
    
    try {
        const response = await authenticatedFetch(`/api/admin/recipes/${recipeId}`, {
            method: 'DELETE'
        });
        
        if (!response) {
            throw new Error('Authentication required. Please log in again.');
        }
        
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
    const confirmed = await showConfirmModal({
        title: 'Reset Password',
        message: `Reset password for ${userEmail}?`,
        submessage: 'A new temporary password will be generated.',
        confirmText: 'Reset Password',
        tone: 'primary'
    });
    if (!confirmed) {
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

// ============================================================================
// AI RULES MANAGEMENT
// ============================================================================
let aiRules = [];
let activeAiRuleId = null;

function setAiRulesStatus(message, isError = false) {
    const statusEl = document.getElementById('ai-rules-status');
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.style.color = isError ? 'var(--accent-red)' : 'var(--text-muted)';
}

function getAiRulesSearchTerm() {
    const input = document.getElementById('ai-rules-search');
    return input ? input.value.trim().toLowerCase() : '';
}

function filterAiRules() {
    renderAiRulesList();
}

function renderAiRulesList() {
    const tbody = document.getElementById('ai-rules-tbody');
    const count = document.getElementById('ai-rules-count');
    if (!tbody) return;

    const filter = getAiRulesSearchTerm();
    const filtered = aiRules.filter(rule => {
        const haystack = `${rule.title} ${rule.category} ${rule.content}`.toLowerCase();
        return !filter || haystack.includes(filter);
    });

    if (count) {
        count.textContent = `${aiRules.length}`;
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 40px; color: var(--text-secondary);">No rules found.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(rule => {
        const status = `${rule.enabled ? 'Enabled' : 'Disabled'}${rule.requiresReview ? ' • Review' : ''}`;
        const activeClass = rule.id === activeAiRuleId ? 'active' : '';
        
        // Priority colors
        const priorityColors = {
            'critical': '#ef4444',
            'high': '#f59e0b',
            'medium': '#3b82f6',
            'low': '#6b7280'
        };
        const priorityColor = priorityColors[rule.priority] || '#6b7280';
        const priorityBadge = `<span style="display: inline-block; padding: 3px 10px; border-radius: 12px; background: ${priorityColor}20; color: ${priorityColor}; font-weight: 600; font-size: 12px; text-transform: uppercase;">${escapeHtml(rule.priority)}</span>`;
        
        // Status colors
        const statusColor = rule.enabled ? '#10b981' : '#6b7280';
        const reviewBadge = rule.requiresReview ? `<span style="display: inline-block; margin-left: 8px; padding: 3px 10px; border-radius: 12px; background: #f59e0b20; color: #f59e0b; font-weight: 600; font-size: 11px;">REVIEW</span>` : '';
        const statusBadge = `<span style="color: ${statusColor}; font-weight: 500;">${rule.enabled ? '✓ Enabled' : 'Disabled'}</span>${reviewBadge}`;
        
        return `
            <tr class="ai-rules-row ${activeClass}" onclick="selectAiRule('${escapeHtml(rule.id)}')">
                <td><strong>${escapeHtml(rule.title)}</strong></td>
                <td>${escapeHtml(rule.category)}</td>
                <td>${priorityBadge}</td>
                <td>${statusBadge}</td>
            </tr>
        `;
    }).join('');
}

function setAiRuleForm(rule) {
    document.getElementById('ai-rule-title').value = rule?.title || '';
    document.getElementById('ai-rule-category').value = rule?.category || '';
    document.getElementById('ai-rule-priority').value = rule?.priority || 'medium';
    document.getElementById('ai-rule-content').value = rule?.content || '';
    document.getElementById('ai-rule-enabled').checked = rule?.enabled !== false;
    document.getElementById('ai-rule-review').checked = Boolean(rule?.requiresReview);

    const meta = document.getElementById('ai-rule-meta');
    if (meta) {
        if (rule?.updatedAt) {
            meta.textContent = `Last updated ${new Date(rule.updatedAt).toLocaleString()}`;
        } else {
            meta.textContent = activeAiRuleId ? 'Editing rule' : 'New rule';
        }
    }
}

function selectAiRule(ruleId) {
    const rule = aiRules.find(r => r.id === ruleId);
    if (!rule) return;
    activeAiRuleId = ruleId;
    setAiRuleForm(rule);
    renderAiRulesList();
    setAiRulesStatus('');
}

function openNewAiRule() {
    activeAiRuleId = null;
    setAiRuleForm({ priority: 'medium', enabled: true, requiresReview: false });
    renderAiRulesList();
    setAiRulesStatus('Creating a new rule. Fill in details and save.');
}

function generateAiRuleId(title) {
    const slug = String(title || 'rule')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-');
    return `ai-rule-${slug}-${Date.now().toString(36)}`;
}

function getAiRuleFormValues() {
    return {
        id: activeAiRuleId,
        title: document.getElementById('ai-rule-title').value.trim(),
        category: document.getElementById('ai-rule-category').value.trim() || 'General',
        priority: document.getElementById('ai-rule-priority').value,
        content: document.getElementById('ai-rule-content').value.trim(),
        enabled: document.getElementById('ai-rule-enabled').checked,
        requiresReview: document.getElementById('ai-rule-review').checked
    };
}

async function saveAiRule() {
    const formValues = getAiRuleFormValues();
    if (!formValues.title || !formValues.content) {
        setAiRulesStatus('Title and rule details are required.', true);
        return;
    }

    const now = new Date().toISOString();
    let updatedRules = [...aiRules];
    const existingIndex = updatedRules.findIndex(rule => rule.id === formValues.id);

    if (existingIndex >= 0) {
        const existing = updatedRules[existingIndex];
        updatedRules[existingIndex] = {
            ...existing,
            ...formValues,
            createdAt: existing.createdAt || now,
            updatedAt: now
        };
    } else {
        const newRule = {
            ...formValues,
            id: formValues.id || generateAiRuleId(formValues.title),
            createdAt: now,
            updatedAt: now
        };
        updatedRules = [newRule, ...updatedRules];
        activeAiRuleId = newRule.id;
    }

    setAiRulesStatus('Saving...');
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/ai-rules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rules: updatedRules })
        });

        if (!response) return;
        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to save rules');
        }

        aiRules = Array.isArray(data.rules) ? data.rules : updatedRules;
        renderAiRulesList();
        if (activeAiRuleId) {
            selectAiRule(activeAiRuleId);
        }
        setAiRulesStatus('Rule saved successfully.');
    } catch (error) {
        console.error('Error saving AI rules:', error);
        setAiRulesStatus(`Failed to save rules: ${error.message}`, true);
    }
}

async function deleteAiRule() {
    if (!activeAiRuleId) {
        setAiRulesStatus('Select a rule to delete.', true);
        return;
    }

    const targetRule = aiRules.find(rule => rule.id === activeAiRuleId);
    if (!targetRule) return;

    const confirmed = await showConfirmModal({
        title: 'Delete AI Rule',
        message: `Delete rule "${targetRule.title}"?`,
        submessage: 'This action cannot be undone.',
        confirmText: 'Delete Rule'
    });
    if (!confirmed) {
        return;
    }

    const updatedRules = aiRules.filter(rule => rule.id !== activeAiRuleId);
    setAiRulesStatus('Deleting...');
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/ai-rules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rules: updatedRules })
        });

        if (!response) return;
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Failed to delete rule');
        }

        aiRules = Array.isArray(data.rules) ? data.rules : updatedRules;
        activeAiRuleId = aiRules[0]?.id || null;
        if (activeAiRuleId) {
            selectAiRule(activeAiRuleId);
        } else {
            openNewAiRule();
        }
        renderAiRulesList();
        setAiRulesStatus('Rule deleted.');
    } catch (error) {
        console.error('Error deleting AI rule:', error);
        setAiRulesStatus(`Failed to delete rule: ${error.message}`, true);
    }
}

async function loadAiRules() {
    setAiRulesStatus('Loading...');
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/ai-rules`);
        if (!response) return;
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Failed to load AI rules');
        }

        aiRules = Array.isArray(data.rules) ? data.rules : [];
        renderAiRulesList();

        if (aiRules.length && !activeAiRuleId) {
            selectAiRule(aiRules[0].id);
        } else if (!aiRules.length) {
            openNewAiRule();
        }

        setAiRulesStatus('');
    } catch (error) {
        console.error('Error loading AI rules:', error);
        setAiRulesStatus(`Failed to load AI rules: ${error.message}`, true);
    }
}

function refreshAiRules() {
    loadAiRules();
}

/**
 * ============================================
 * GRANT INTELLIGENCE FUNCTIONS
 * ============================================
 */

let grantUsers = [];
let pendingGrantDeleteId = null;

const WIZARD_PAGE_LABELS = {
    organization: 'Organization',
    project: 'Project',
    budget: 'Budget',
    narrative: 'Need & Impact',
    documents: 'Documents',
    review: 'Review & Export'
};

function formatWizardPageLabel(pageId) {
    return WIZARD_PAGE_LABELS[pageId] || pageId || '—';
}

function formatDateShort(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

function formatDuration(ms) {
    const total = Number(ms) || 0;
    if (total <= 0) return '—';
    const seconds = Math.floor(total / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    const remSeconds = seconds % 60;
    if (hours > 0) return `${hours}h ${remMinutes}m`;
    if (minutes > 0) return `${minutes}m ${remSeconds}s`;
    return `${remSeconds}s`;
}

async function loadGrantUsers() {
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/grants/users`);
        if (!response) return;
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to load grant users');

        grantUsers = data.users || [];
        renderGrantUsers(grantUsers);
    } catch (error) {
        console.error('Error loading grant users:', error);
        const tbody = document.getElementById('grant-users-tbody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="9" class="loading">Failed to load users: ${error.message}</td></tr>`;
        }
    }
}

function renderGrantUsers(users) {
    const tbody = document.getElementById('grant-users-tbody');
    if (!tbody) return;

    if (!users.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="loading">No grant users found.</td></tr>`;
        return;
    }

    tbody.innerHTML = users.map(user => {
        const name = user.contact_name || '—';
        const emailId = `grant-email-${user.id}`;
        return `
            <tr>
                <td>${user.id}</td>
                <td>${name}</td>
                <td>
                    <input id="${emailId}" class="btn" value="${user.email || ''}" style="text-align:left; min-width: 220px;">
                </td>
                <td>${user.business_name || '—'}</td>
                <td>${user.province || '—'}</td>
                <td>${formatDateShort(user.last_login_at)}</td>
                <td>${formatWizardPageLabel(user.last_active_tab)}</td>
                <td>${formatDateShort(user.created_at)}</td>
                <td style="white-space:nowrap;">
                    <button class="btn btn-primary" onclick="updateGrantUserEmail(${user.id})" style="padding: 6px 10px;">Save</button>
                    <button class="btn" onclick="openGrantUserDeleteModal(${user.id}, '${(name || '').replace(/'/g, "&#39;")}', '${(user.email || '').replace(/'/g, "&#39;")}')" style="padding: 6px 10px; background:#ef4444; border-color:#ef4444; color:white;">Delete</button>
                </td>
            </tr>
        `;
    }).join('');
}

function filterGrantUsers() {
    const term = (document.getElementById('grant-user-search')?.value || '').toLowerCase();
    const filtered = grantUsers.filter(user => {
        return (user.contact_name || '').toLowerCase().includes(term) ||
               (user.email || '').toLowerCase().includes(term) ||
               (user.business_name || '').toLowerCase().includes(term) ||
               (user.province || '').toLowerCase().includes(term);
    });
    renderGrantUsers(filtered);
}

async function updateGrantUserEmail(userId) {
    const input = document.getElementById(`grant-email-${userId}`);
    if (!input) return;
    const email = input.value.trim();
    if (!email || !email.includes('@')) {
        showToast('Enter a valid email address.', 'error');
        return;
    }

    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/grants/users/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        if (!response) return;
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Update failed');
        showToast('Grant user email updated.', 'success');
    } catch (error) {
        console.error('Grant user update error:', error);
        showToast('Failed to update grant user.', 'error');
    }
}

function openGrantUserDeleteModal(userId, name, email) {
    pendingGrantDeleteId = userId;
    const modal = document.getElementById('grantUserDeleteModal');
    const text = document.getElementById('grantUserDeleteText');
    if (text) {
        text.textContent = `Delete grant user ${name || ''} (${email || ''})? This is reversible only by database restore.`;
    }
    if (modal) modal.style.display = 'flex';
}

function closeGrantUserDeleteModal() {
    const modal = document.getElementById('grantUserDeleteModal');
    if (modal) modal.style.display = 'none';
    pendingGrantDeleteId = null;
}

async function confirmDeleteGrantUser() {
    if (!pendingGrantDeleteId) return;
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/grants/users/${pendingGrantDeleteId}`, {
            method: 'DELETE'
        });
        if (!response) return;
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Delete failed');
        closeGrantUserDeleteModal();
        await loadGrantUsers();
        showToast('Grant user deleted.', 'success');
    } catch (error) {
        console.error('Grant user delete error:', error);
        showToast('Failed to delete grant user.', 'error');
    }
}

async function loadGrantSummary() {
    try {
        const summaryRes = await authenticatedFetch(`${API_BASE}/api/admin/grants/summary`);
        const analyticsRes = await authenticatedFetch(`${API_BASE}/api/admin/grants/wizard-analytics`);
        if (!summaryRes || !analyticsRes) return;

        const summaryData = await summaryRes.json();
        const analyticsData = await analyticsRes.json();
        if (!summaryData.success) throw new Error(summaryData.error || 'Summary failed');

        const summary = summaryData.data || {};
        document.getElementById('grant-kpi-users').textContent = summary.totalUsers || 0;
        document.getElementById('grant-kpi-users-month').textContent = `${(summary.newUsersMonthly || []).slice(-1)[0]?.count || 0} new this month`;
        document.getElementById('grant-kpi-total-grants').textContent = summary.totalGrants || 0;
        document.getElementById('grant-kpi-new-grants').textContent = `${summary.newGrantsThisMonth || 0} new this month`;
        document.getElementById('grant-kpi-avg-complete').textContent = `${Math.round(summary.avgWizardCompletePercent || 0)}%`;
        document.getElementById('grant-kpi-completed-users').textContent = `${summary.completedUsers || 0} users completed`;

        const monthlyTbody = document.getElementById('grant-users-month-tbody');
        if (monthlyTbody) {
            const rows = (summary.newUsersMonthly || []).map(r => {
                const monthLabel = r.month ? new Date(r.month).toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) : '—';
                return `<tr><td>${monthLabel}</td><td>${r.count || 0}</td></tr>`;
            });
            monthlyTbody.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="2" class="loading">No data</td></tr>';
        }

        const byTime = analyticsData?.data?.byTime || [];
        const byViews = analyticsData?.data?.byViews || [];

        const timeTbody = document.getElementById('grant-pages-time-tbody');
        if (timeTbody) {
            timeTbody.innerHTML = byTime.length ? byTime.map(row => `
                <tr>
                    <td>${formatWizardPageLabel(row.page_id)}</td>
                    <td>${formatDuration(row.total_duration_ms)}</td>
                    <td>${formatDuration(row.avg_duration_ms)}</td>
                </tr>
            `).join('') : '<tr><td colspan="3" class="loading">No data</td></tr>';
        }

        const viewsTbody = document.getElementById('grant-pages-views-tbody');
        if (viewsTbody) {
            viewsTbody.innerHTML = byViews.length ? byViews.map(row => `
                <tr>
                    <td>${formatWizardPageLabel(row.page_id)}</td>
                    <td>${row.views || 0}</td>
                    <td>${formatDuration(row.total_duration_ms)}</td>
                </tr>
            `).join('') : '<tr><td colspan="3" class="loading">No data</td></tr>';
        }

        await loadGrantProgramAlerts();
    } catch (error) {
        console.error('Grant summary load error:', error);
        showToast('Failed to load grant summary.', 'error');
    }
}

async function loadGrantProgramAlerts() {
    const tbody = document.getElementById('grant-program-alerts-tbody');
    if (!tbody) return;

    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/grants/program-alerts?limit=50`);
        if (!response) return;
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to load grant program alerts');

        const alerts = Array.isArray(data.alerts) ? data.alerts : [];
        tbody.innerHTML = alerts.length ? alerts.map((alert) => {
            const programLabel = alert.program_code || alert.program_name || `Program #${alert.program_id || 'unknown'}`;
            const created = formatDateShort(alert.created_at);
            return `
                <tr>
                    <td>
                        <div style="font-weight:600;">${programLabel}</div>
                        <div style="font-size:12px; color: var(--text-secondary);">${alert.program_name || '—'}</div>
                    </td>
                    <td>${alert.change_type || 'unknown'}</td>
                    <td>${created}</td>
                    <td>
                        <button class="btn btn-primary" style="padding: 6px 10px;" onclick="ackGrantProgramAlert(${alert.id})">Acknowledge</button>
                    </td>
                </tr>
            `;
        }).join('') : '<tr><td colspan="4" class="loading">No unacknowledged alerts.</td></tr>';
    } catch (error) {
        console.error('Grant alerts load error:', error);
        tbody.innerHTML = `<tr><td colspan="4" class="loading">Failed to load alerts: ${error.message}</td></tr>`;
    }
}

async function ackGrantProgramAlert(alertId) {
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/grants/program-alerts/${alertId}/acknowledge`, {
            method: 'POST'
        });
        if (!response) return;
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to acknowledge alert');

        showToast('Grant program alert acknowledged.', 'success');
        await loadGrantProgramAlerts();
    } catch (error) {
        console.error('Grant alert acknowledge error:', error);
        showToast('Failed to acknowledge alert.', 'error');
    }
}

/**
 * ============================================
 * AI REFERENCE SITE FUNCTIONS
 * ============================================
 */

async function loadAiReferenceSites() {
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/ai-reference-sites`);
        if (!response) return;
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to load reference sites');

        const tbody = document.getElementById('ai-reference-tbody');
        if (!tbody) return;
        const sites = data.sites || [];

        tbody.innerHTML = sites.length ? sites.map(site => `
            <tr>
                <td>${site.title}</td>
                <td>${site.category || '—'}</td>
                <td><a href="${site.url}" target="_blank" rel="noopener" style="color: var(--accent-blue);">${site.url}</a></td>
                <td>
                    <button class="btn" onclick="deleteAiReferenceSite(${site.id})" style="padding: 6px 10px; background:#ef4444; border-color:#ef4444; color:white;">Delete</button>
                </td>
            </tr>
        `).join('') : '<tr><td colspan="4" class="loading">No reference sites yet.</td></tr>';
    } catch (error) {
        console.error('AI reference load error:', error);
        showToast('Failed to load AI reference sites.', 'error');
    }
}

async function addAiReferenceSite() {
    const title = document.getElementById('ai-ref-title')?.value.trim();
    const url = document.getElementById('ai-ref-url')?.value.trim();
    const category = document.getElementById('ai-ref-category')?.value.trim();

    if (!title || !url) {
        showToast('Title and URL are required.', 'error');
        return;
    }

    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/ai-reference-sites`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, url, category })
        });
        if (!response) return;
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to add reference site');

        document.getElementById('ai-ref-title').value = '';
        document.getElementById('ai-ref-url').value = '';
        document.getElementById('ai-ref-category').value = '';
        await loadAiReferenceSites();
        showToast('Reference site added.', 'success');
    } catch (error) {
        console.error('AI reference add error:', error);
        showToast('Failed to add reference site.', 'error');
    }
}

async function deleteAiReferenceSite(siteId) {
    const confirmed = await showConfirmModal({
        title: 'Delete Reference Site',
        message: 'Delete this reference site?',
        submessage: 'This action cannot be undone.',
        confirmText: 'Delete Site'
    });
    if (!confirmed) return;
    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/ai-reference-sites/${siteId}`, {
            method: 'DELETE'
        });
        if (!response) return;
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to delete reference site');
        await loadAiReferenceSites();
        showToast('Reference site deleted.', 'success');
    } catch (error) {
        console.error('AI reference delete error:', error);
        showToast('Failed to delete reference site.', 'error');
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
window.loadAiRules = loadAiRules;
window.refreshAiRules = refreshAiRules;
window.filterAiRules = filterAiRules;
window.selectAiRule = selectAiRule;
window.openNewAiRule = openNewAiRule;
window.saveAiRule = saveAiRule;
window.deleteAiRule = deleteAiRule;

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

// ==============================================================================
// Wholesale Pricing Management
// ==============================================================================

async function loadPricingManagement() {
    try {
        // Load active offers
        const offersRes = await authenticatedFetch(`${API_BASE}/api/admin/pricing/offers?status=active`);
        const offersData = offersRes && offersRes.ok ? await offersRes.json() : { offers: [] };
        const offers = offersData.offers || [];

        // Load all offers for stats
        const allOffersRes = await authenticatedFetch(`${API_BASE}/api/admin/pricing/offers`);
        const allOffersData = allOffersRes && allOffersRes.ok ? await allOffersRes.json() : { offers: [] };
        const allOffers = allOffersData.offers || [];

        // Load cost surveys
        const costRes = await authenticatedFetch(`${API_BASE}/api/admin/pricing/cost-surveys`);
        const costData = costRes && costRes.ok ? await costRes.json() : { cost_surveys: [] };
        const surveys = costData.cost_surveys || [];

        // Load product catalog from network inventory
        const catalogRes = await authenticatedFetch(`${API_BASE}/api/admin/wholesale/dashboard`);
        const catalogData = catalogRes && catalogRes.ok ? await catalogRes.json() : {};

        // Update KPIs
        document.getElementById('pricing-active-offers').textContent = offers.length;

        const avgAcceptance = allOffers.length > 0
            ? allOffers.reduce((sum, o) => sum + (o.response_stats?.acceptance_rate || 0), 0) / allOffers.length
            : 0;
        document.getElementById('pricing-acceptance-rate').textContent = 
            allOffers.length > 0 ? Math.round(avgAcceptance * 100) + '%' : 'N/A';

        const pendingCounters = allOffers.reduce((sum, o) => sum + (o.response_stats?.countered || 0), 0);
        document.getElementById('pricing-counter-offers').textContent = pendingCounters;

        // Load product catalog from wholesale catalog
        try {
            const invRes = await authenticatedFetch(`${API_BASE}/api/wholesale/catalog`);
            const invData = invRes && invRes.ok ? await invRes.json() : { items: [], data: {} };
            const products = invData.data?.skus || invData.items || [];
            document.getElementById('pricing-product-count').textContent = products.length;
            renderProductCatalog(products);
        } catch {
            document.getElementById('pricing-product-count').textContent = '0';
            renderProductCatalog([]);
        }

        // Render offers table
        renderPricingOffers(offers);

        // Render cost surveys
        renderCostSurveys(surveys);

    } catch (error) {
        console.error('[Pricing Management] Load error:', error);
    }
}

function renderPricingOffers(offers) {
    const tbody = document.getElementById('pricing-offers-tbody');
    if (!offers || offers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 40px; color: var(--text-secondary);">No active price offers. Use the form above to create one.</td></tr>';
        return;
    }
    tbody.innerHTML = offers.map(offer => {
        const rate = offer.response_stats?.acceptance_rate;
        const rateStr = rate != null ? Math.round(rate * 100) + '%' : '—';
        const rateColor = rate == null ? '' : rate >= 0.6 ? 'color: var(--accent-green)' : rate >= 0.4 ? 'color: #f59e0b' : 'color: #ef4444';
        const total = offer.response_stats?.total_responses || 0;
        const date = offer.offer_date ? new Date(offer.offer_date).toLocaleDateString() : '—';
        return `<tr>
            <td style="font-family: monospace; font-size: 12px;">${offer.offer_id || '—'}</td>
            <td><strong>${offer.crop || '—'}</strong></td>
            <td>$${parseFloat(offer.wholesale_price || 0).toFixed(2)}/${offer.unit || 'lb'}</td>
            <td><span style="padding: 2px 8px; border-radius: 4px; background: var(--bg-secondary); font-size: 12px;">${offer.tier || '—'}</span></td>
            <td style="${rateColor}; font-weight: 600;">${rateStr}</td>
            <td>${total}</td>
            <td><span style="padding: 2px 8px; border-radius: 4px; background: ${offer.status === 'active' ? 'rgba(34,197,94,0.15)' : 'var(--bg-secondary)'}; color: ${offer.status === 'active' ? 'var(--accent-green)' : 'var(--text-secondary)'}; font-size: 12px;">${offer.status || '—'}</span></td>
            <td>${date}</td>
            <td>
                <button class="btn" onclick="cancelPriceOffer('${offer.offer_id}')" style="padding: 4px 10px; font-size: 12px; color: #ef4444; border-color: #ef4444;">Cancel</button>
            </td>
        </tr>`;
    }).join('');
}

let _catalogProductsCache = [];

function renderProductCatalog(products) {
    _catalogProductsCache = products || [];
    const tbody = document.getElementById('product-catalog-tbody');
    if (!products || products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 40px; color: var(--text-secondary);">No products in catalog. Products are populated from farm inventories across the network.</td></tr>';
        return;
    }
    tbody.innerHTML = products.map(p => {
        const sku = p.sku_id || p.sku || p.product_id || '—';
        const name = p.product_name || p.name || p.crop || '—';
        const category = p.category || p.type || '—';
        const isCustom = p.is_custom === true;
        const type = isCustom ? 'Custom' : p.is_mix ? 'Mix' : p.is_bundle ? 'Bundle' : 'Single';
        const typeBadge = isCustom
          ? '<span style="padding:2px 6px;border-radius:4px;background:rgba(34,197,94,0.15);color:var(--accent-green);font-size:11px;font-weight:600;">Custom</span>'
          : `<span style="font-size:12px;">${type}</span>`;
        const unit = p.unit || p.price_unit || 'oz';
        const finalPrice = p.final_wholesale_price ?? p.wholesale_price ?? p.price_per_unit ?? p.price;
        const basePrice = p.base_wholesale_price;
        const discountRate = Number(p.buyer_discount_rate || 0);
        const priceStr = Number.isFinite(Number(finalPrice)) ? `$${Number(finalPrice).toFixed(2)}/${unit}` : '—';
        const baseStr = Number.isFinite(Number(basePrice)) ? `Base: $${Number(basePrice).toFixed(2)}` : '';
        const discountStr = discountRate > 0 ? ` | Buyer discount: ${(discountRate * 100).toFixed(1)}%` : '';
        const qty = p.qty_available || p.available || p.quantity_available || p.total_available || 0;
        const status = qty > 0 ? 'In Stock' : 'Out of Stock';
        const statusColor = status === 'In Stock' ? 'var(--accent-green)' : '#ef4444';
        const desc = p.description ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(p.description)}</div>` : '';
        const deleteBtn = isCustom
          ? `<button class="btn" onclick="deleteProduct('${p.id || ''}')" style="padding: 4px 10px; font-size: 12px; color: #ef4444; border-color: #ef4444; margin-left: 4px;">Delete</button>`
          : '';
        const editArg = isCustom ? p.id : sku;
        return `<tr>
            <td style="font-family: monospace; font-size: 12px;">${escapeHtml(sku)}</td>
            <td><strong>${escapeHtml(name)}</strong>${desc}</td>
            <td>${escapeHtml(category)}</td>
            <td>${typeBadge}</td>
            <td>${unit}</td>
            <td>${priceStr}${baseStr || discountStr ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${baseStr}${discountStr}</div>` : ''}</td>
            <td style="color: ${statusColor};">${status}</td>
            <td>
                <button class="btn" onclick="editProduct('${editArg}', ${isCustom})" style="padding: 4px 10px; font-size: 12px;">Edit</button>
                ${deleteBtn}
            </td>
        </tr>`;
    }).join('');
}



function renderCostSurveys(surveys) {
    const tbody = document.getElementById('cost-surveys-tbody');
    if (!surveys || surveys.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-secondary);">No cost surveys submitted by farms yet.</td></tr>';
        return;
    }
    tbody.innerHTML = surveys.map(s => `<tr>
        <td>${s.farm_id || '—'}</td>
        <td><strong>${s.crop || '—'}</strong></td>
        <td>$${parseFloat(s.cost_per_unit || 0).toFixed(2)}</td>
        <td>${s.unit || 'lb'}</td>
        <td>${s.survey_date ? new Date(s.survey_date).toLocaleDateString() : '—'}</td>
        <td>${s.valid_until ? new Date(s.valid_until).toLocaleDateString() : 'Ongoing'}</td>
        <td style="font-size: 12px; color: var(--text-secondary);">${s.notes || '—'}</td>
    </tr>`).join('');
}

async function submitWholesalePrice(event) {
    event.preventDefault();
    const crop = document.getElementById('price-crop').value;
    const floor_price = parseFloat(document.getElementById('price-amount').value) || 0;
    const sku_factor = parseFloat(document.getElementById('price-sku-factor')?.value) || 0.75;
    const tier = document.getElementById('price-tier').value;
    const reasoning = document.getElementById('price-reasoning').value;
    
    try {
        const res = await authenticatedFetch(`${API_BASE}/api/admin/pricing/set-wholesale`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ crop, floor_price, sku_factor, tier, reasoning, use_formula: true })
        });
        if (!res) return;
        const data = await res.json();
        
        if (data.success) {
            alert(`Price offer sent! ${data.message || ''}`);
            document.getElementById('set-price-form').reset();
            await loadPricingManagement();
        } else {
            alert(`Error: ${data.error || data.message || 'Failed to set price'}`);
        }
    } catch (error) {
        console.error('[Pricing] Submit error:', error);
        alert('Failed to submit price offer');
    }
}

// ── AI Pricing Assistant — Multi-Crop Scanner ──────────────────
let pricingScannerCrops = []; // cached from /current-prices

async function loadCurrentPricesIntoScanner() {
    try {
        const res = await authenticatedFetch(`${API_BASE}/api/admin/pricing/current-prices`);
        const data = res && res.ok ? await res.json() : { prices: [] };
        pricingScannerCrops = data.prices || [];
        // Add every crop as a row, pre-filled with current prices
        const tbody = document.getElementById('pricing-scanner-tbody');
        tbody.innerHTML = '';
        pricingScannerCrops.forEach(c => {
            addPricingRow({
                crop: c.crop,
                retailPerOz: c.retailPerOz,
                retailPerLb: c.retailPerLb,
                wholesalePerLb: c.wholesalePerLb,
                tier: c.tier || 'demand-based'
            });
        });
        updateScannerRowCount();
    } catch (err) {
        console.error('[PricingScanner] Load error:', err);
        alert('Failed to load current prices');
    }
}

function addPricingRow(prefill = {}) {
    const tbody = document.getElementById('pricing-scanner-tbody');
    const idx = tbody.children.length;
    const tr = document.createElement('tr');
    tr.setAttribute('data-scanner-idx', idx);

    // Build a datalist for autocomplete — allows both recipe crops and manual entry
    const listId = `crop-list-${idx}`;
    const cropOptionTags = pricingScannerCrops.length
        ? pricingScannerCrops.map(c => `<option value="${c.crop}">`).join('')
        : '';

    tr.innerHTML = `
        <td>
            <input class="sc-crop" type="text" list="${listId}" value="${prefill.crop || ''}" placeholder="Type or select crop" style="width:100%;padding:6px;border-radius:4px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary);font-size:12px;" onchange="onScannerCropSelect(this)">
            <datalist id="${listId}">${cropOptionTags}</datalist>
        </td>
        <td><input class="sc-roz" type="number" step="0.01" min="0" value="${prefill.retailPerOz || ''}" placeholder="0.00" style="width:100%;padding:6px;border-radius:4px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary);font-size:12px;text-align:right;" oninput="syncPricingRow(this,'oz')"></td>
        <td><input class="sc-rlb" type="number" step="0.01" min="0" value="${prefill.retailPerLb || ''}" placeholder="0.00" style="width:100%;padding:6px;border-radius:4px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary);font-size:12px;text-align:right;" oninput="syncPricingRow(this,'lb')"></td>
        <td><input class="sc-wlb" type="number" step="0.01" min="0" value="${prefill.wholesalePerLb || ''}" placeholder="0.00" style="width:100%;padding:6px;border-radius:4px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary);font-size:12px;text-align:right;"></td>
        <td>
            <select class="sc-tier" style="width:100%;padding:6px;border-radius:4px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary);font-size:12px;">
                <option value="cost-plus" ${prefill.tier === 'cost-plus' ? 'selected' : ''}>Cost-Plus</option>
                <option value="demand-based" ${(!prefill.tier || prefill.tier === 'demand-based') ? 'selected' : ''}>Demand</option>
                <option value="premium" ${prefill.tier === 'premium' ? 'selected' : ''}>Premium</option>
                <option value="promotional" ${prefill.tier === 'promotional' ? 'selected' : ''}>Promo</option>
            </select>
        </td>
        <td><input class="sc-reason" type="text" value="" placeholder="reason" style="width:100%;padding:6px;border-radius:4px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary);font-size:12px;"></td>
        <td class="sc-status" style="text-align:center;">—</td>
        <td style="text-align:center;">
            <button onclick="this.closest('tr').remove(); updateScannerRowCount();" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:16px;" title="Remove row">&times;</button>
        </td>
    `;
    tbody.appendChild(tr);
    updateScannerRowCount();
}

function onScannerCropSelect(sel) {
    const crop = sel.value;
    const tr = sel.closest('tr');
    const match = pricingScannerCrops.find(c => c.crop === crop);
    if (match) {
        tr.querySelector('.sc-roz').value = match.retailPerOz || '';
        tr.querySelector('.sc-rlb').value = match.retailPerLb || '';
        tr.querySelector('.sc-wlb').value = match.wholesalePerLb || '';
    }
}

function syncPricingRow(input, from) {
    const tr = input.closest('tr');
    let retailPerLb;
    if (from === 'oz') {
        const oz = parseFloat(input.value);
        if (!isNaN(oz)) {
            retailPerLb = oz * 16;
            tr.querySelector('.sc-rlb').value = retailPerLb.toFixed(2);
        }
    } else {
        const lb = parseFloat(input.value);
        if (!isNaN(lb)) {
            retailPerLb = lb;
            tr.querySelector('.sc-roz').value = (lb / 16).toFixed(2);
        }
    }
    // Auto-compute wholesale using the formula: wholesale = retail * sku_factor
    if (retailPerLb > 0) {
        const skuFactor = 0.75;
        const wholesale = Math.round(retailPerLb * skuFactor * 100) / 100;
        const wField = tr.querySelector('.sc-wlb');
        if (wField) wField.value = wholesale.toFixed(2);
    }
}

function updateScannerRowCount() {
    const n = document.getElementById('pricing-scanner-tbody').children.length;
    const el = document.getElementById('scanner-row-count');
    if (el) el.textContent = `${n} crop${n !== 1 ? 's' : ''}`;
}

function clearPricingScanner() {
    document.getElementById('pricing-scanner-tbody').innerHTML = '';
    document.getElementById('batch-update-result').style.display = 'none';
    updateScannerRowCount();
}

async function applyBatchPriceUpdate() {
    const rows = document.querySelectorAll('#pricing-scanner-tbody tr');
    if (!rows.length) { alert('Add at least one crop row.'); return; }

    const updates = [];
    rows.forEach(tr => {
        const cropEl = tr.querySelector('.sc-crop');
        const crop = cropEl ? (cropEl.value || cropEl.textContent || '').trim() : '';
        const retailPerOz = parseFloat(tr.querySelector('.sc-roz')?.value) || 0;
        const retailPerLb = parseFloat(tr.querySelector('.sc-rlb')?.value) || 0;
        const wholesalePerLb = parseFloat(tr.querySelector('.sc-wlb')?.value) || 0;
        const tier = tr.querySelector('.sc-tier')?.value || 'demand-based';
        const reasoning = tr.querySelector('.sc-reason')?.value || '';

        if (crop && (retailPerOz > 0 || retailPerLb > 0)) {
            updates.push({ crop, retailPerOz, retailPerLb, wholesalePerLb, tier, reasoning });
        }
    });

    if (!updates.length) { alert('No valid price entries found. Fill in at least one crop with a price.'); return; }

    const pushToFarms = document.getElementById('push-to-farms-checkbox')?.checked ?? true;

    const btn = document.getElementById('apply-batch-btn');
    btn.disabled = true;
    btn.textContent = 'Applying…';

    // Mark all rows as pending
    rows.forEach(tr => {
        const st = tr.querySelector('.sc-status');
        if (st) { st.textContent = '⏳'; st.style.color = 'var(--text-secondary)'; }
    });

    try {
        const res = await authenticatedFetch(`${API_BASE}/api/admin/pricing/batch-update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updates, pushToFarms, reasoning: 'AI Pricing Assistant batch scan' })
        });
        if (!res) return;
        const data = await res.json();

        // Mark row statuses
        rows.forEach(tr => {
            const cropEl = tr.querySelector('.sc-crop');
            const crop = cropEl ? (cropEl.value || cropEl.textContent || '').trim() : '';
            const st = tr.querySelector('.sc-status');
            if (!st) return;
            const result = (data.results || []).find(r => r.crop === crop);
            if (result && result.status === 'updated') {
                st.textContent = '✅'; st.style.color = 'var(--accent-green)';
            } else if (result && result.status === 'error') {
                st.textContent = '❌'; st.style.color = '#ef4444'; st.title = result.error || '';
            } else {
                st.textContent = '—'; st.style.color = 'var(--text-secondary)';
            }
        });

        // Show summary
        const resultDiv = document.getElementById('batch-update-result');
        if (data.success) {
            const n = (data.results || []).filter(r => r.status === 'updated').length;
            const farms = data.farmsPushed || 0;
            resultDiv.style.display = 'block';
            resultDiv.style.background = 'rgba(34,197,94,0.1)';
            resultDiv.style.border = '1px solid rgba(34,197,94,0.3)';
            resultDiv.style.color = 'var(--accent-green)';
            resultDiv.innerHTML = `<strong>${n} crop${n !== 1 ? 's' : ''} updated.</strong> Persisted to pricing files.${farms ? ` Pushed to ${farms} farm${farms !== 1 ? 's' : ''} (POS &amp; online store).` : ''}`;
        } else {
            resultDiv.style.display = 'block';
            resultDiv.style.background = 'rgba(239,68,68,0.1)';
            resultDiv.style.border = '1px solid rgba(239,68,68,0.3)';
            resultDiv.style.color = '#ef4444';
            resultDiv.innerHTML = `<strong>Error:</strong> ${data.error || 'Batch update failed'}`;
        }

        // Refresh pricing management view
        await loadPricingManagement();
    } catch (err) {
        console.error('[PricingScanner] Batch update error:', err);
        alert('Failed to apply batch price update');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Apply All Price Changes';
    }
}

async function cancelPriceOffer(offerId) {
    const confirmed = await showConfirmModal({
        title: 'Cancel Price Offer',
        message: `Cancel price offer ${offerId}?`,
        submessage: 'The offer will no longer be available to farms.',
        confirmText: 'Cancel Offer'
    });
    if (!confirmed) return;
    try {
        const res = await authenticatedFetch(`${API_BASE}/api/admin/pricing/offers/${offerId}/cancel`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'Admin cancelled' })
        });
        if (!res) return;
        const data = await res.json();
        if (data.success) {
            await loadPricingManagement();
        } else {
            alert(`Error: ${data.error || 'Failed to cancel offer'}`);
        }
    } catch (error) {
        console.error('[Pricing] Cancel error:', error);
    }
}

function showAddProductModal(editData) {
    const isEdit = !!editData;
    let modal = document.getElementById('product-add-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'product-add-modal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }

    const categories = ['Vegetables', 'Greens', 'Herbs', 'Fruits', 'Microgreens', 'Value-Added', 'Bundle', 'Custom'];
    const units = ['lb', 'head', 'pint', 'bunch', 'jar', 'unit', 'bag', 'oz'];
    const catOptions = categories.map(c =>
        `<option value="${c}" ${editData && editData.category === c ? 'selected' : ''}>${c}</option>`
    ).join('');
    const unitOptions = units.map(u =>
        `<option value="${u}" ${editData && editData.unit === u ? 'selected' : ''}>${u}</option>`
    ).join('');

    const isTaxable = editData ? (editData.is_taxable !== false) : true;
    const isWholesale = editData ? (editData.available_for_wholesale !== false) : true;

    modal.innerHTML = `
        <div class="modal-content" style="max-width: 560px;">
            <div class="modal-header">
                <h2>${isEdit ? 'Edit Product' : 'Add Custom Product'}</h2>
                <button class="modal-close" onclick="closeAddProductModal()">&times;</button>
            </div>
            <div class="modal-body">
                ${isEdit ? '<p style="color: var(--text-secondary); margin-bottom: 12px; font-family: monospace; font-size: 12px;">SKU: ' + (editData.sku_id || '') + '</p>' : ''}
                <div style="display: grid; gap: 12px;">
                    <label style="color: var(--text-secondary); font-size: 13px;">Product Name *
                        <input type="text" id="cpf-name" value="${editData ? (editData.product_name || editData.name || '') : ''}" placeholder="e.g. Heirloom Tomato Mix"
                            style="width: 100%; padding: 8px; margin-top: 4px; background: var(--bg-main); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px;">
                    </label>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <label style="color: var(--text-secondary); font-size: 13px;">Category
                            <select id="cpf-category"
                                style="width: 100%; padding: 8px; margin-top: 4px; background: var(--bg-main); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px;">
                                ${catOptions}
                            </select>
                        </label>
                        <label style="color: var(--text-secondary); font-size: 13px;">Unit
                            <select id="cpf-unit"
                                style="width: 100%; padding: 8px; margin-top: 4px; background: var(--bg-main); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px;">
                                ${unitOptions}
                            </select>
                        </label>
                    </div>
                    <label style="color: var(--text-secondary); font-size: 13px;">Description
                        <textarea id="cpf-description" rows="3" placeholder="Brief product description for wholesale catalog"
                            style="width: 100%; padding: 8px; margin-top: 4px; background: var(--bg-main); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px; resize: vertical;">${editData ? (editData.description || '') : ''}</textarea>
                    </label>
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;">
                        <label style="color: var(--text-secondary); font-size: 13px;">Retail Price ($)
                            <input type="number" id="cpf-retail-price" step="0.01" min="0" value="${editData ? (editData.retail_price || '') : ''}"
                                style="width: 100%; padding: 8px; margin-top: 4px; background: var(--bg-main); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px;">
                        </label>
                        <label style="color: var(--text-secondary); font-size: 13px;">Wholesale Price ($)
                            <input type="number" id="cpf-wholesale-price" step="0.01" min="0" value="${editData ? (editData.wholesale_price || editData.price_per_unit || '') : ''}"
                                style="width: 100%; padding: 8px; margin-top: 4px; background: var(--bg-main); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px;">
                        </label>
                        <label style="color: var(--text-secondary); font-size: 13px;">Quantity
                            <input type="number" id="cpf-quantity" step="0.01" min="0" value="${editData ? (editData.quantity_available || editData.available || '') : ''}"
                                style="width: 100%; padding: 8px; margin-top: 4px; background: var(--bg-main); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px;">
                        </label>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <label style="display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 13px; cursor: pointer;">
                            <input type="checkbox" id="cpf-taxable" ${isTaxable ? 'checked' : ''} style="width: 16px; height: 16px;">
                            Taxable
                        </label>
                        <label style="display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 13px; cursor: pointer;">
                            <input type="checkbox" id="cpf-wholesale" ${isWholesale ? 'checked' : ''} style="width: 16px; height: 16px;">
                            Available for Wholesale
                        </label>
                    </div>
                    <label style="color: var(--text-secondary); font-size: 13px;">Thumbnail Image
                        <input type="file" id="cpf-thumbnail" accept="image/jpeg,image/png,image/webp"
                            style="width: 100%; padding: 8px; margin-top: 4px; background: var(--bg-main); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px;">
                        <div style="margin-top: 6px; font-size: 11px; color: #64748b; line-height: 1.5;">
                            Max 2 MB. Formats: JPG, PNG, or WebP. Recommended: 800x800 px square.<br>
                            To reduce size: use WebP format, resize to 800x800, or compress at 80% quality.<br>
                            Free tools: <span style="color:#94a3b8;">squoosh.app</span> (browser) or Preview > Export (macOS).
                        </div>
                        ${editData && editData.thumbnail_url ? '<div style="margin-top: 6px;"><img src="' + editData.thumbnail_url + '" style="max-height: 60px; border-radius: 4px;" alt="Current thumbnail"></div>' : ''}
                    </label>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
                    <button class="btn" onclick="closeAddProductModal()" style="padding: 8px 16px;">Cancel</button>
                    <button class="btn" id="cpf-save-btn" onclick="saveCustomProduct(${isEdit ? "'" + (editData.id || '') + "'" : 'null'})"
                        style="padding: 8px 16px; background: var(--accent-green); color: white;">${isEdit ? 'Save Changes' : 'Add Product'}</button>
                </div>
            </div>
        </div>`;
    modal.style.display = 'flex';
}

function closeAddProductModal() {
    const modal = document.getElementById('product-add-modal');
    if (modal) modal.style.display = 'none';
}

async function saveCustomProduct(productId) {
    const name = document.getElementById('cpf-name').value.trim();
    const category = document.getElementById('cpf-category').value;
    const description = document.getElementById('cpf-description').value.trim();
    const retailPrice = parseFloat(document.getElementById('cpf-retail-price').value) || 0;
    const wholesalePrice = parseFloat(document.getElementById('cpf-wholesale-price').value) || 0;
    const quantity = parseFloat(document.getElementById('cpf-quantity').value) || 0;
    const unit = document.getElementById('cpf-unit').value;
    const isTaxable = document.getElementById('cpf-taxable').checked;
    const isWholesale = document.getElementById('cpf-wholesale').checked;
    const thumbnailFile = document.getElementById('cpf-thumbnail').files[0] || null;

    if (!name) {
        showToast('Product name is required.', 'warning');
        return;
    }
    if (retailPrice <= 0 && wholesalePrice <= 0) {
        showToast('At least one price (retail or wholesale) is required.', 'warning');
        return;
    }

    const saveBtn = document.getElementById('cpf-save-btn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

    try {
        const farmId = currentFarmId || farmsData.find(f => f.farmId)?.farmId || farmsData.find(f => f.farm_id)?.farm_id;
        const payload = {
            product_name: name,
            category,
            description,
            retail_price: retailPrice,
            wholesale_price: wholesalePrice,
            quantity_available: quantity,
            unit,
            is_taxable: isTaxable,
            available_for_wholesale: isWholesale
        };

        const isEdit = !!productId;
        const url = isEdit
            ? `${API_BASE}/api/farm/products/${productId}`
            : `${API_BASE}/api/farm/products`;
        const method = isEdit ? 'PUT' : 'POST';

        const res = await authenticatedFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'x-farm-id': farmId },
            body: JSON.stringify(payload)
        });
        const data = res && res.ok ? await res.json() : null;

        if (!data || !data.success) {
            throw new Error(data?.error || 'Failed to save product');
        }

        const savedProduct = data.product || data.data || {};
        const savedId = savedProduct.id || productId;

        // Upload thumbnail if selected
        if (thumbnailFile && savedId) {
            const formData = new FormData();
            formData.append('image', thumbnailFile);
            try {
                await authenticatedFetch(`${API_BASE}/api/farm/products/${savedId}/image`, {
                    method: 'POST',
                    headers: { 'x-farm-id': farmId },
                    body: formData
                });
            } catch (imgErr) {
                console.error('[Custom Product] Image upload error:', imgErr);
                showToast('Product saved but image upload failed.', 'warning');
            }
        }

        closeAddProductModal();
        showToast(isEdit ? 'Product updated.' : 'Product added.', 'success');
        await loadPricingManagement();
    } catch (err) {
        console.error('[Custom Product] Save error:', err);
        showToast('Failed to save product: ' + err.message, 'error');
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = productId ? 'Save Changes' : 'Add Product'; }
    }
}

function editProduct(sku) {
    const product = _catalogProductsCache.find(p =>
        (p.sku_id || p.sku || p.product_id) === sku || (p.id && String(p.id) === String(sku))
    );
    if (!product) {
        showToast('Product not found in catalog.', 'warning');
        return;
    }

    // For custom products, open the full custom product form
    if (product.is_custom) {
        showAddProductModal({
            id: product.id,
            sku_id: product.sku_id || product.sku || sku,
            product_name: product.product_name || product.name || product.crop,
            category: product.category,
            description: product.description || '',
            retail_price: product.retail_price,
            wholesale_price: product.final_wholesale_price || product.wholesale_price || product.price_per_unit,
            quantity_available: product.qty_available || product.available || product.quantity_available,
            unit: product.unit || 'lb',
            is_taxable: product.is_taxable !== false,
            available_for_wholesale: product.available_for_wholesale !== false,
            thumbnail_url: product.thumbnail_url || ''
        });
        return;
    }

    // For auto/hybrid products, open the pricing-only edit modal
    const name = product.product_name || product.name || product.crop || sku;
    const unit = product.unit || 'lb';
    const currentPrice = product.final_wholesale_price || product.wholesale_price || product.price_per_unit || product.price || '';

    let currentRetailOz = '';
    let currentRetailLb = '';
    let currentWholesaleLb = currentPrice ? Number(currentPrice).toFixed(2) : '';
    const scannerRows = document.querySelectorAll('#pricing-scanner-tbody tr');
    scannerRows.forEach(row => {
        const cropInput = row.querySelector('input[name="crop"]');
        if (cropInput && cropInput.value.toLowerCase() === name.toLowerCase()) {
            const retailOzInput = row.querySelector('input[name="retailPerOz"]');
            const retailLbInput = row.querySelector('input[name="retailPerLb"]');
            const wholesaleLbInput = row.querySelector('input[name="wholesalePerLb"]');
            if (retailOzInput) currentRetailOz = retailOzInput.value;
            if (retailLbInput) currentRetailLb = retailLbInput.value;
            if (wholesaleLbInput) currentWholesaleLb = wholesaleLbInput.value;
        }
    });

    let modal = document.getElementById('product-edit-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'product-edit-modal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 520px;">
            <div class="modal-header">
                <h2>Edit Product: ${name}</h2>
                <button class="modal-close" onclick="closeProductEditModal()">&times;</button>
            </div>
            <div class="modal-body">
                <p style="color: var(--text-secondary); margin-bottom: 16px;">SKU: <code>${sku}</code></p>
                <div style="display: grid; gap: 12px;">
                    <label style="color: var(--text-secondary); font-size: 13px;">Retail Price per Oz ($)
                        <input type="number" id="edit-retail-oz" step="0.01" min="0" value="${currentRetailOz}"
                            style="width: 100%; padding: 8px; margin-top: 4px; background: var(--bg-main); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px;"
                            oninput="syncEditPrices('oz')">
                    </label>
                    <label style="color: var(--text-secondary); font-size: 13px;">Retail Price per Lb ($)
                        <input type="number" id="edit-retail-lb" step="0.01" min="0" value="${currentRetailLb}"
                            style="width: 100%; padding: 8px; margin-top: 4px; background: var(--bg-main); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px;"
                            oninput="syncEditPrices('lb')">
                    </label>
                    <label style="color: var(--text-secondary); font-size: 13px;">Wholesale Price per Lb ($)
                        <input type="number" id="edit-wholesale-lb" step="0.01" min="0" value="${currentWholesaleLb}"
                            style="width: 100%; padding: 8px; margin-top: 4px; background: var(--bg-main); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px;">
                    </label>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
                    <button class="btn" onclick="closeProductEditModal()" style="padding: 8px 16px;">Cancel</button>
                    <button class="btn" onclick="saveProductEdit('${sku}', '${name}')"
                        style="padding: 8px 16px; background: var(--accent-green); color: white;">Save</button>
                </div>
            </div>
        </div>`;
    modal.style.display = 'flex';
}

function syncEditPrices(source) {
    const ozInput = document.getElementById('edit-retail-oz');
    const lbInput = document.getElementById('edit-retail-lb');
    const wsInput = document.getElementById('edit-wholesale-lb');
    const defaultSkuFactor = 0.75;
    if (source === 'oz' && ozInput.value) {
        const ozVal = parseFloat(ozInput.value);
        lbInput.value = (ozVal * 16).toFixed(2);
        wsInput.value = (ozVal * 16 * defaultSkuFactor).toFixed(2);
    } else if (source === 'lb' && lbInput.value) {
        const lbVal = parseFloat(lbInput.value);
        ozInput.value = (lbVal / 16).toFixed(2);
        wsInput.value = (lbVal * defaultSkuFactor).toFixed(2);
    }
}

function closeProductEditModal() {
    const modal = document.getElementById('product-edit-modal');
    if (modal) modal.style.display = 'none';
}

async function saveProductEdit(sku, cropName) {
    const retailOz = parseFloat(document.getElementById('edit-retail-oz').value);
    const retailLb = parseFloat(document.getElementById('edit-retail-lb').value);
    const wholesaleLb = parseFloat(document.getElementById('edit-wholesale-lb').value);

    if (!retailLb || retailLb <= 0) {
        showToast('Retail price per lb is required and must be greater than zero.', 'warning');
        return;
    }

    try {
        const res = await authenticatedFetch(`${API_BASE}/api/admin/pricing/batch-update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                updates: [{
                    crop: cropName,
                    retailPerOz: retailOz || retailLb / 16,
                    retailPerLb: retailLb,
                    wholesalePerLb: wholesaleLb || retailLb * 0.75,
                    tier: 'manual',
                    reasoning: 'Manual edit from product catalog'
                }],
                pushToFarms: true,
                reasoning: 'Product catalog edit: ' + cropName
            })
        });

        const data = res.ok ? await res.json() : null;
        if (data && data.success) {
            closeProductEditModal();
            showToast('Product pricing updated.', 'success');
            await loadPricingManagement();
            await loadCurrentPricesIntoScanner();
        } else {
            showToast('Failed to save: ' + (data?.error || 'Unknown error'), 'error');
        }
    } catch (err) {
        console.error('[Product Edit] Save error:', err);
        showToast('Failed to save product price. Check console for details.', 'error');
    }
}

async function deleteProduct(sku) {
    const product = _catalogProductsCache.find(p =>
        (p.sku_id || p.sku || p.product_id) === sku || (p.id && String(p.id) === String(sku))
    );
    if (!product || !product.is_custom) {
        showToast('Only custom products can be deleted from the catalog.', 'warning');
        return;
    }
    const name = product.product_name || product.name || product.crop || sku;
    if (!confirm('Delete product "' + name + '"?\n\nThis will mark the product as inactive and remove it from the catalog.')) {
        return;
    }

    try {
        const res = await authenticatedFetch(`${API_BASE}/api/farm/products/${product.id}`, {
            method: 'DELETE',
            headers: { 'x-farm-id': currentFarmId }
        });
        const data = res && res.ok ? await res.json() : null;
        if (!data || !data.success) {
            throw new Error(data?.error || 'Failed to delete product');
        }
        showToast('Product "' + name + '" removed from catalog.', 'success');
        await loadPricingManagement();
    } catch (err) {
        console.error('[Custom Product] Delete error:', err);
        showToast('Failed to delete product: ' + err.message, 'error');
    }
}


async function loadDeliveryManagement() {
    try {
        const farmId = currentFarmId || farmsData.find(f => f.farmId)?.farmId || farmsData.find(f => f.farm_id)?.farm_id;
        if (!farmId) {
            renderDeliveryZones([]);
            renderDrivers([]);
            return;
        }

        const res = await authenticatedFetch(`${API_BASE}/api/admin/delivery/config?farm_id=${encodeURIComponent(farmId)}`);
        const data = res.ok ? await res.json() : null;
        
        if (data && data.success) {
            const config = data.config || {};
            const zones = config.zones || [];
            const drivers = config.drivers || [];
            const stats = config.stats || {};
            
            // Update KPIs
            document.getElementById('delivery-zone-count').textContent = zones.length;
            document.getElementById('delivery-driver-count').textContent = drivers.filter(d => d.status === 'active').length;
            document.getElementById('delivery-count-30d').textContent = stats.deliveries_30d || 0;
            document.getElementById('delivery-revenue-30d').textContent = '$' + (stats.revenue_30d || 0).toFixed(2);
            
            // Update settings form
            document.getElementById('delivery-base-fee').value = config.base_fee || 0;
            document.getElementById('delivery-min-order').value = config.min_order || 25;
            document.getElementById('delivery-enabled').value = config.enabled !== false ? 'true' : 'false';
            
            // Render tables
            renderDeliveryZones(zones);
            renderDrivers(drivers);
            renderFeeDistribution(config.recent_fees || []);
            
            // Fee summary
            document.getElementById('fees-collected').textContent = '$' + (stats.fees_collected || 0).toFixed(2);
            document.getElementById('driver-payouts').textContent = '$' + (stats.driver_payouts || 0).toFixed(2);
            document.getElementById('platform-delivery-revenue').textContent = '$' + (stats.platform_revenue || 0).toFixed(2);
        } else {
            // Load defaults from delivery quote endpoint
            renderDeliveryZones([
                { id: 'ZONE_A', name: 'Zone A — Local', description: '0-10 km from farm', fee: 0, min_order: 25, windows: ['morning', 'afternoon', 'evening'], status: 'active' },
                { id: 'ZONE_B', name: 'Zone B — Regional', description: '10-25 km from farm', fee: 5, min_order: 35, windows: ['morning', 'afternoon'], status: 'active' },
                { id: 'ZONE_C', name: 'Zone C — Extended', description: '25-50 km from farm', fee: 10, min_order: 50, windows: ['morning'], status: 'active' }
            ]);
            renderDrivers([]);
            renderFeeDistribution([]);
            
            document.getElementById('delivery-zone-count').textContent = '3';
            document.getElementById('delivery-driver-count').textContent = '0';
            document.getElementById('delivery-count-30d').textContent = '0';
            document.getElementById('delivery-revenue-30d').textContent = '$0.00';
        }
    } catch (error) {
        console.error('[Delivery Management] Load error:', error);
        // Show defaults
        renderDeliveryZones([
            { id: 'ZONE_A', name: 'Zone A — Local', description: '0-10 km from farm', fee: 0, min_order: 25, windows: ['morning', 'afternoon', 'evening'], status: 'active' },
            { id: 'ZONE_B', name: 'Zone B — Regional', description: '10-25 km from farm', fee: 5, min_order: 35, windows: ['morning', 'afternoon'], status: 'active' },
            { id: 'ZONE_C', name: 'Zone C — Extended', description: '25-50 km from farm', fee: 10, min_order: 50, windows: ['morning'], status: 'active' }
        ]);
        renderDrivers([]);
        renderFeeDistribution([]);
        
        document.getElementById('delivery-zone-count').textContent = '3';
        document.getElementById('delivery-driver-count').textContent = '0';
        document.getElementById('delivery-count-30d').textContent = '0';
        document.getElementById('delivery-revenue-30d').textContent = '$0.00';
    }
}

// Cache zone data for inline editing
let _deliveryZonesCache = [];

function renderDeliveryZones(zones) {
    _deliveryZonesCache = zones || [];
    const tbody = document.getElementById('delivery-zones-tbody');
    if (!zones || zones.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-secondary);">No delivery zones configured.</td></tr>';
        return;
    }
    tbody.innerHTML = zones.map(z => renderZoneRowDisplay(z)).join('');
}

function renderZoneRowDisplay(z) {
    const windows = Array.isArray(z.windows) ? z.windows.join(', ') : z.windows || 'All';
    const statusColor = z.status === 'active' ? 'var(--accent-green)' : 'var(--text-secondary)';
    return `<tr data-zone-id="${escapeHtml(String(z.id || ''))}">
        <td><strong>${escapeHtml(z.name || z.id)}</strong></td>
        <td>${escapeHtml(z.description || '—')}</td>
        <td>$${parseFloat(z.fee || 0).toFixed(2)}</td>
        <td>$${parseFloat(z.min_order || 0).toFixed(2)}</td>
        <td style="font-size: 12px;">${escapeHtml(windows)}</td>
        <td style="color: ${statusColor};">${z.status || 'active'}</td>
        <td>
            <button class="btn" onclick="editDeliveryZone('${escapeHtml(String(z.id))}')" style="padding: 4px 10px; font-size: 12px;">Edit</button>
        </td>
    </tr>`;
}

function renderDrivers(drivers) {
    const tbody = document.getElementById('drivers-tbody');
    if (!drivers || drivers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: var(--text-secondary);">No drivers registered. Click "+ Add Driver" to hire a driver.</td></tr>';
        return;
    }
    tbody.innerHTML = drivers.map(d => {
        const zonesStr = Array.isArray(d.zones) ? d.zones.join(', ') : d.zones || '—';
        const statusColor = d.status === 'active' ? 'var(--accent-green)' : 'var(--text-secondary)';
        return `<tr data-driver-id="${escapeHtml(String(d.id || ''))}">
            <td><strong>${d.name || '—'}</strong></td>
            <td>${d.phone || '—'}</td>
            <td>${d.vehicle || '—'}</td>
            <td style="font-size: 12px;">${zonesStr}</td>
            <td>${d.deliveries_30d || 0}</td>
            <td>${d.rating ? d.rating.toFixed(1) + '/5' : '—'}</td>
            <td style="color: ${statusColor};">${d.status || '—'}</td>
            <td>
                <button class="btn" onclick="editDriver('${d.id}')" style="padding: 4px 10px; font-size: 12px;">Edit</button>
                <button class="btn" onclick="toggleDriverStatus('${d.id}')" style="padding: 4px 10px; font-size: 12px; margin-left: 4px;">${d.status === 'active' ? 'Deactivate' : 'Activate'}</button>
            </td>
        </tr>`;
    }).join('');
}

function renderFeeDistribution(fees) {
    const tbody = document.getElementById('fee-distribution-tbody');
    if (!fees || fees.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: var(--text-secondary);">No delivery fee data yet. Fees will appear after orders with delivery are processed.</td></tr>';
        return;
    }
    tbody.innerHTML = fees.map(f => `<tr>
        <td>${f.date ? new Date(f.date).toLocaleDateString() : '—'}</td>
        <td style="font-family: monospace; font-size: 12px;">${f.order_id || '—'}</td>
        <td>${f.zone || '—'}</td>
        <td>${f.driver_name || '—'}</td>
        <td>$${parseFloat(f.fee_charged || 0).toFixed(2)}</td>
        <td>$${parseFloat(f.driver_share || 0).toFixed(2)}</td>
        <td>$${parseFloat(f.platform_share || 0).toFixed(2)}</td>
        <td style="color: ${f.status === 'paid' ? 'var(--accent-green)' : 'var(--text-secondary)'};">${f.status || '—'}</td>
    </tr>`).join('');
}

async function saveDeliverySettings(event) {
    event.preventDefault();
    const farmId = currentFarmId || farmsData.find(f => f.farmId)?.farmId || farmsData.find(f => f.farm_id)?.farm_id;
    if (!farmId) {
        alert('Select a farm first to update delivery settings.');
        return;
    }

    const config = {
        farm_id: farmId,
        base_fee: parseFloat(document.getElementById('delivery-base-fee').value),
        min_order: parseFloat(document.getElementById('delivery-min-order').value),
        enabled: document.getElementById('delivery-enabled').value === 'true'
    };
    
    try {
        const res = await authenticatedFetch(`${API_BASE}/api/admin/delivery/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        if (!res) {
            alert('Session expired. Please log in again.');
            return;
        }
        const data = await res.json();
        if (data.success) {
            alert('Delivery settings saved!');
            await loadDeliveryManagement();
        } else {
            alert(`Error: ${data.error || 'Failed to save settings'}`);
        }
    } catch (error) {
        console.error('[Delivery] Save error:', error);
        alert('Failed to save delivery settings. Check console for details.');
    }
}

function showAddZoneModal() {
    const farmId = currentFarmId || farmsData.find(f => f.farmId)?.farmId || farmsData.find(f => f.farm_id)?.farm_id;
    if (!farmId) {
        alert('Select a farm first to create a zone.');
        return;
    }

    const id = prompt('Zone ID (e.g. ZONE_D):');
    if (!id) return;
    const name = prompt('Zone name (e.g. Zone D — Remote):');
    if (!name) return;
    const fee = prompt('Delivery fee ($):');
    if (!fee) return;
    const minOrder = prompt('Minimum order amount ($):') || '25';
    const description = prompt('Description (optional):') || '';
    const postalPrefix = prompt('Postal prefix (optional, e.g. K7):') || '';
    
    (async () => {
        try {
            const response = await authenticatedFetch(`${API_BASE}/api/admin/delivery/zones`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    farm_id: farmId,
                    id: id.trim(),
                    name: name.trim(),
                    description: description.trim(),
                    fee: parseFloat(fee),
                    min_order: parseFloat(minOrder),
                    postal_prefix: postalPrefix.trim() || null
                })
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            alert(`Zone ${id.trim()} created successfully.`);
            await loadDeliveryManagement();
        } catch (error) {
            console.error('[Delivery] Add zone failed:', error);
            alert(`Failed to create zone: ${error.message}`);
        }
    })();
}

function showAddDriverModal() {
    const farmId = currentFarmId || farmsData.find(f => f.farmId)?.farmId || farmsData.find(f => f.farm_id)?.farm_id;
    if (!farmId) {
        alert('Select a farm first to add a driver.');
        return;
    }

    const name = prompt('Driver name:');
    if (!name) return;
    const phone = prompt('Phone number:');
    if (!phone) return;
    const vehicle = prompt('Vehicle description (e.g. Sprinter Van):');
    const email = prompt('Email (optional):') || '';
    const zones = prompt('Assigned zones (comma-separated, e.g. ZONE_A, ZONE_B):') || 'ZONE_A';

    (async () => {
        try {
            const response = await authenticatedFetch(`${API_BASE}/api/admin/delivery/drivers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    farm_id: farmId,
                    name: name.trim(),
                    phone: phone.trim(),
                    email: email.trim(),
                    vehicle: (vehicle || '').trim(),
                    zones: zones.split(',').map(z => z.trim()).filter(Boolean)
                })
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            alert(`Driver ${name.trim()} added successfully.`);
            await loadDeliveryManagement();
        } catch (error) {
            console.error('[Delivery] Add driver failed:', error);
            alert(`Failed to add driver: ${error.message}`);
        }
    })();
}

function editDeliveryZone(zoneId) {
    const farmId = currentFarmId || farmsData.find(f => f.farmId)?.farmId || farmsData.find(f => f.farm_id)?.farm_id;
    if (!farmId) {
        alert('Select a farm first to edit a zone.');
        return;
    }

    // Find zone data from cache
    const zone = _deliveryZonesCache.find(z => z.id === zoneId);
    if (!zone) {
        alert('Zone data not found. Please refresh.');
        return;
    }

    const row = document.querySelector(`#delivery-zones-tbody tr[data-zone-id="${CSS.escape(zoneId)}"]`);
    if (!row) return;

    const windowsArr = Array.isArray(zone.windows) ? zone.windows : (zone.windows || 'morning,afternoon').split(',').map(w => w.trim());
    const inputStyle = 'width:100%;padding:6px 8px;border-radius:4px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary);font-size:12px;';

    row.innerHTML = `
        <td><input type="text" id="ez-name-${zoneId}" value="${escapeHtml(zone.name || zone.id)}" style="${inputStyle}font-weight:600;"></td>
        <td><input type="text" id="ez-desc-${zoneId}" value="${escapeHtml(zone.description || '')}" placeholder="Description" style="${inputStyle}"></td>
        <td><input type="number" id="ez-fee-${zoneId}" value="${parseFloat(zone.fee || 0).toFixed(2)}" step="0.50" min="0" style="${inputStyle}width:80px;"></td>
        <td><input type="number" id="ez-min-${zoneId}" value="${parseFloat(zone.min_order || 0).toFixed(2)}" step="1" min="0" style="${inputStyle}width:80px;"></td>
        <td>
            <div style="display:flex;flex-direction:column;gap:3px;font-size:11px;">
                <label style="color:var(--text-secondary);cursor:pointer;"><input type="checkbox" id="ez-win-morning-${zoneId}" ${windowsArr.includes('morning') ? 'checked' : ''} style="margin-right:3px;">Morning</label>
                <label style="color:var(--text-secondary);cursor:pointer;"><input type="checkbox" id="ez-win-afternoon-${zoneId}" ${windowsArr.includes('afternoon') ? 'checked' : ''} style="margin-right:3px;">Afternoon</label>
                <label style="color:var(--text-secondary);cursor:pointer;"><input type="checkbox" id="ez-win-evening-${zoneId}" ${windowsArr.includes('evening') ? 'checked' : ''} style="margin-right:3px;">Evening</label>
            </div>
        </td>
        <td>
            <select id="ez-status-${zoneId}" style="${inputStyle}width:90px;">
                <option value="active" ${zone.status === 'active' ? 'selected' : ''}>Active</option>
                <option value="inactive" ${zone.status === 'inactive' ? 'selected' : ''}>Inactive</option>
                <option value="paused" ${zone.status === 'paused' ? 'selected' : ''}>Paused</option>
            </select>
        </td>
        <td style="white-space:nowrap;">
            <button class="btn" onclick="saveDeliveryZoneInline('${escapeHtml(zoneId)}')" style="padding:4px 10px;font-size:12px;background:var(--accent-green);color:white;">Save</button>
            <button class="btn" onclick="cancelDeliveryZoneEdit('${escapeHtml(zoneId)}')" style="padding:4px 10px;font-size:12px;margin-left:4px;">Cancel</button>
            <button class="btn" onclick="deleteDeliveryZone('${escapeHtml(zoneId)}')" style="padding:4px 10px;font-size:12px;margin-left:4px;background:var(--accent-red);color:white;">Delete</button>
        </td>
    `;
    // Focus the name field
    document.getElementById(`ez-name-${zoneId}`)?.focus();
}

async function saveDeliveryZoneInline(zoneId) {
    const farmId = currentFarmId || farmsData.find(f => f.farmId)?.farmId || farmsData.find(f => f.farm_id)?.farm_id;
    if (!farmId) return;

    const name = document.getElementById(`ez-name-${zoneId}`)?.value?.trim();
    const description = document.getElementById(`ez-desc-${zoneId}`)?.value?.trim();
    const fee = parseFloat(document.getElementById(`ez-fee-${zoneId}`)?.value || 0);
    const min_order = parseFloat(document.getElementById(`ez-min-${zoneId}`)?.value || 0);
    const status = document.getElementById(`ez-status-${zoneId}`)?.value || 'active';

    const windows = [];
    if (document.getElementById(`ez-win-morning-${zoneId}`)?.checked) windows.push('morning');
    if (document.getElementById(`ez-win-afternoon-${zoneId}`)?.checked) windows.push('afternoon');
    if (document.getElementById(`ez-win-evening-${zoneId}`)?.checked) windows.push('evening');

    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/delivery/zones/${encodeURIComponent(zoneId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ farm_id: farmId, name, description, fee, min_order, status, windows })
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }
        showToast(`Zone ${name || zoneId} updated`, 'success');
        await loadDeliveryManagement();
    } catch (error) {
        console.error('[Delivery] Inline save failed:', error);
        showToast(`Failed to save zone: ${error.message}`, 'error');
    }
}

function cancelDeliveryZoneEdit(zoneId) {
    const zone = _deliveryZonesCache.find(z => z.id === zoneId);
    if (!zone) { loadDeliveryManagement(); return; }
    const row = document.querySelector(`#delivery-zones-tbody tr[data-zone-id="${CSS.escape(zoneId)}"]`);
    if (row) row.outerHTML = renderZoneRowDisplay(zone);
}

async function deleteDeliveryZone(zoneId) {
    if (!confirm(`Are you sure you want to delete zone "${zoneId}"? This cannot be undone.`)) return;
    const farmId = currentFarmId || farmsData.find(f => f.farmId)?.farmId || farmsData.find(f => f.farm_id)?.farm_id;
    if (!farmId) return;

    try {
        const response = await authenticatedFetch(`${API_BASE}/api/admin/delivery/zones/${encodeURIComponent(zoneId)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ farm_id: farmId })
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }
        showToast(`Zone ${zoneId} deleted`, 'success');
        await loadDeliveryManagement();
    } catch (error) {
        console.error('[Delivery] Delete zone failed:', error);
        showToast(`Failed to delete zone: ${error.message}`, 'error');
    }
}

function editDriver(driverId) {
    const farmId = currentFarmId || farmsData.find(f => f.farmId)?.farmId || farmsData.find(f => f.farm_id)?.farm_id;
    if (!farmId) {
        alert('Select a farm first to edit a driver.');
        return;
    }

    const row = document.querySelector(`#drivers-tbody tr[data-driver-id="${CSS.escape(driverId)}"]`);
    const nameDefault = row?.children?.[0]?.innerText || '';
    const phoneDefault = row?.children?.[1]?.innerText || '';
    const vehicleDefault = row?.children?.[2]?.innerText === '—' ? '' : (row?.children?.[2]?.innerText || '');
    const zonesDefault = row?.children?.[3]?.innerText === '—' ? '' : (row?.children?.[3]?.innerText || '');

    const name = prompt('Driver name:', nameDefault);
    if (name == null) return;
    const phone = prompt('Phone number:', phoneDefault);
    if (phone == null) return;
    const vehicle = prompt('Vehicle:', vehicleDefault);
    if (vehicle == null) return;
    const zones = prompt('Assigned zones (comma-separated):', zonesDefault);
    if (zones == null) return;

    (async () => {
        try {
            const response = await authenticatedFetch(`${API_BASE}/api/admin/delivery/drivers/${encodeURIComponent(driverId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    farm_id: farmId,
                    name: name.trim(),
                    phone: phone.trim(),
                    vehicle: vehicle.trim(),
                    zones: zones.split(',').map(z => z.trim()).filter(Boolean)
                })
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            alert(`Driver ${driverId} updated successfully.`);
            await loadDeliveryManagement();
        } catch (error) {
            console.error('[Delivery] Edit driver failed:', error);
            alert(`Failed to update driver: ${error.message}`);
        }
    })();
}

function toggleDriverStatus(driverId) {
    const farmId = currentFarmId || farmsData.find(f => f.farmId)?.farmId || farmsData.find(f => f.farm_id)?.farm_id;
    if (!farmId) {
        alert('Select a farm first to update driver status.');
        return;
    }

    const row = document.querySelector(`#drivers-tbody tr[data-driver-id="${CSS.escape(driverId)}"]`);
    const statusCell = row?.children?.[6]?.innerText?.trim()?.toLowerCase();
    const nextStatus = statusCell === 'active' ? 'inactive' : 'active';

    (async () => {
        try {
            const response = await authenticatedFetch(`${API_BASE}/api/admin/delivery/drivers/${encodeURIComponent(driverId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    farm_id: farmId,
                    status: nextStatus
                })
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            await loadDeliveryManagement();
        } catch (error) {
            console.error('[Delivery] Toggle driver status failed:', error);
            alert(`Failed to update driver status: ${error.message}`);
        }
    })();
}

// ==============================================================================
// AI Agent Monitoring
// ==============================================================================

async function loadAiMonitoring() {
    try {
        // Load AI agent status
        // AI agent status defaults (farm-sales endpoint not accessible from admin context)
        const statusData = {};
        
        // Load AI monitoring data
        const monitorRes = await authenticatedFetch(`${API_BASE}/api/admin/ai/monitoring`);
        const monitorData = monitorRes.ok ? await monitorRes.json() : null;
        
        // Load AI rules count
        const rulesRes = await authenticatedFetch(`${API_BASE}/api/admin/ai-rules`);
        const rulesData = rulesRes.ok ? await rulesRes.json() : { rules: [] };
        
        if (monitorData && monitorData.success) {
            const m = monitorData;
            const aiConfigured = !!m.openai_configured;
            const disabledReason = m.disabled_reason || 'OPENAI_API_KEY missing';
            
            // Update KPIs
            document.getElementById('ai-pusher-status').textContent = m.pusher_status || 'Unknown';
            document.getElementById('ai-pusher-status').style.color = 
                m.pusher_status === 'active' ? 'var(--accent-green)' : 'var(--text-secondary)';
            document.getElementById('ai-recs-24h').textContent = m.recommendations_24h || 0;
            document.getElementById('ai-chat-sessions').textContent = m.chat_sessions_total || 0;
            document.getElementById('ai-api-cost').textContent = m.api_cost_30d ? '$' + m.api_cost_30d.toFixed(2) : '$0.00';
            document.getElementById('ai-farms-covered').textContent = m.farms_covered || 0;
            document.getElementById('ai-active-rules').textContent = (rulesData.rules || []).length;
            
            // Config details
            document.getElementById('ai-model-name').textContent = m.model || 'GPT-4';
            document.getElementById('ai-push-interval').textContent = m.push_interval || '30 minutes';
            document.getElementById('ai-key-status').textContent = aiConfigured ? 'Configured' : `Not Set (${disabledReason})`;
            document.getElementById('ai-key-status').style.color = aiConfigured ? 'var(--accent-green)' : '#ef4444';
            document.getElementById('ai-last-run').textContent = m.last_run ? new Date(m.last_run).toLocaleString() : (aiConfigured ? 'Never' : 'Disabled by config');
            document.getElementById('ai-next-run').textContent = m.next_run ? new Date(m.next_run).toLocaleString() : '—';
            
            // Push stats
            document.getElementById('ai-total-pushes').textContent = m.total_pushes || 0;
            document.getElementById('ai-success-pushes').textContent = m.success_pushes || 0;
            document.getElementById('ai-failed-pushes').textContent = m.failed_pushes || 0;
            document.getElementById('ai-avg-recs').textContent = m.avg_recs_per_farm ? m.avg_recs_per_farm.toFixed(1) : '—';
            
            // Activity log
            renderAiActivity(m.activity || [], {
                openai_configured: aiConfigured,
                disabled_reason: disabledReason,
                message: m.message || null
            });
        } else {
            // Populate with status from agent endpoint
            const hasKey = !!statusData.enabled;
            const disabledReason = statusData.disabled_reason || 'OPENAI_API_KEY missing';
            document.getElementById('ai-pusher-status').textContent = hasKey ? 'Active' : 'Inactive';
            document.getElementById('ai-pusher-status').style.color = hasKey ? 'var(--accent-green)' : 'var(--text-secondary)';
            document.getElementById('ai-recs-24h').textContent = '0';
            document.getElementById('ai-chat-sessions').textContent = '0';
            document.getElementById('ai-api-cost').textContent = '$0.00';
            document.getElementById('ai-farms-covered').textContent = '0';
            document.getElementById('ai-active-rules').textContent = (rulesData.rules || []).length;
            
            document.getElementById('ai-model-name').textContent = statusData.model || 'GPT-4';
            document.getElementById('ai-push-interval').textContent = '30 minutes';
            document.getElementById('ai-key-status').textContent = hasKey ? 'Configured' : `Not Set (${disabledReason})`;
            document.getElementById('ai-key-status').style.color = hasKey ? 'var(--accent-green)' : '#ef4444';
            document.getElementById('ai-last-run').textContent = hasKey ? 'Service starting...' : 'Disabled by config';
            document.getElementById('ai-next-run').textContent = '—';
            
            document.getElementById('ai-total-pushes').textContent = '0';
            document.getElementById('ai-success-pushes').textContent = '0';
            document.getElementById('ai-failed-pushes').textContent = '0';
            document.getElementById('ai-avg-recs').textContent = '—';
            
            renderAiActivity([], {
                openai_configured: hasKey,
                disabled_reason: disabledReason
            });
        }
    } catch (error) {
        console.error('[AI Monitoring] Load error:', error);
        document.getElementById('ai-pusher-status').textContent = 'Error';
        document.getElementById('ai-pusher-status').style.color = '#ef4444';
    }
}

function renderAiActivity(activities, context = {}) {
    const tbody = document.getElementById('ai-activity-tbody');
    if (!activities || activities.length === 0) {
        if (context && context.openai_configured === false) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 40px; color: var(--text-secondary);">
                AI recommendations are currently disabled (${context.disabled_reason || 'OPENAI_API_KEY missing'}). 
                You can continue using manual dashboard workflows while AI is offline.
            </td></tr>`;
            return;
        }
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 40px; color: var(--text-secondary);">
            No AI activity recorded yet. Activity will appear once the AI Recommendations Pusher runs its first cycle 
            (every 30 minutes when OPENAI_API_KEY is configured).
        </td></tr>`;
        return;
    }
    tbody.innerHTML = activities.map(a => {
        const typeColor = a.type === 'recommendation' ? 'var(--accent-green)' : a.type === 'chat' ? 'var(--accent-blue)' : '#ef4444';
        const statusColor = a.status === 'success' ? 'var(--accent-green)' : a.status === 'error' ? '#ef4444' : 'var(--text-secondary)';
        return `<tr>
            <td style="font-size: 12px;">${a.timestamp ? new Date(a.timestamp).toLocaleString() : '—'}</td>
            <td style="color: ${typeColor}; font-weight: 600;">${a.type || '—'}</td>
            <td>${a.farm_id || a.farm || '—'}</td>
            <td style="font-size: 12px;">${a.details || a.message || '—'}</td>
            <td style="color: ${statusColor};">${a.status || '—'}</td>
            <td>${a.tokens_used || '—'}</td>
        </tr>`;
    }).join('');
}

function filterAiActivity(filter) {
    // Simple client-side filter
    const rows = document.querySelectorAll('#ai-activity-tbody tr');
    rows.forEach(row => {
        if (filter === 'all') {
            row.style.display = '';
        } else {
            const typeCell = row.querySelector('td:nth-child(2)');
            const statusCell = row.querySelector('td:nth-child(5)');
            const type = typeCell?.textContent?.toLowerCase() || '';
            const status = statusCell?.textContent?.toLowerCase() || '';
            
            if (filter === 'errors') {
                row.style.display = status === 'error' ? '' : 'none';
            } else {
                row.style.display = type.includes(filter.replace('s', '')) ? '' : 'none';
            }
        }
    });
}

// ==================== MARKETING AI ====================

// ======================================================================
// S.C.O.T.T. Marketing Agent -- Chat Functions
// ======================================================================

let scottConversationId = localStorage.getItem('scott_conversation_id') || null;
let scottLoading = false;

/**
 * Initialize Scott chat -- check agent status and load any directives.
 */
async function initScottChat() {
    const badge = document.getElementById('scott-status-badge');
    try {
        const res = await authenticatedFetch(`${API_BASE}/api/admin/scott/status`);
        if (res.ok) {
            const data = await res.json();
            if (data.ok) {
                badge.textContent = 'Online';
                badge.style.background = 'rgba(16,185,129,0.15)';
                badge.style.color = '#10b981';
            } else {
                badge.textContent = 'Degraded';
                badge.style.background = 'rgba(245,158,11,0.15)';
                badge.style.color = '#f59e0b';
            }
        } else {
            badge.textContent = 'Offline';
            badge.style.background = 'rgba(239,68,68,0.15)';
            badge.style.color = '#ef4444';
        }
    } catch {
        badge.textContent = 'Offline';
        badge.style.background = 'rgba(239,68,68,0.15)';
        badge.style.color = '#ef4444';
    }

    // Restore previous conversation if one exists in localStorage
    if (scottConversationId) {
        try {
            const histRes = await authenticatedFetch(`${API_BASE}/api/admin/scott/history/${encodeURIComponent(scottConversationId)}`);
            if (histRes.ok) {
                const histData = await histRes.json();
                if (histData.ok && histData.messages && histData.messages.length > 0) {
                    const welcome = document.getElementById('scott-welcome');
                    if (welcome) welcome.style.display = 'none';
                    for (const msg of histData.messages) {
                        if (msg.role === 'user' || msg.role === 'assistant') {
                            appendScottMessage(msg.role, msg.content);
                        }
                    }
                }
            }
        } catch { /* history restore is non-fatal */ }
    }
}

/**
 * Send a message to Scott.
 */
async function sendScottMessage() {
    const input = document.getElementById('scott-input');
    const message = input.value.trim();
    if (!message || scottLoading) return;

    // Hide welcome
    const welcome = document.getElementById('scott-welcome');
    if (welcome) welcome.style.display = 'none';

    // Add user message to chat
    appendScottMessage('user', message);
    input.value = '';
    input.style.height = 'auto';

    // Show loading
    scottLoading = true;
    const sendBtn = document.getElementById('scott-send-btn');
    sendBtn.disabled = true;
    sendBtn.textContent = '...';

    const loadingId = appendScottMessage('assistant', 'Thinking...');

    try {
        const res = await authenticatedFetch(`${API_BASE}/api/admin/scott/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                conversation_id: scottConversationId
            })
        });

        const data = await res.json();

        // Remove loading message
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.remove();

        if (data.ok) {
            scottConversationId = data.conversation_id;
            localStorage.setItem('scott_conversation_id', scottConversationId);
            appendScottMessage('assistant', data.reply, data.tool_calls);
        } else {
            appendScottMessage('assistant', `Error: ${data.error || 'Unknown error'}`);
        }
    } catch (err) {
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.remove();
        appendScottMessage('assistant', `Connection error: ${err.message}`);
    } finally {
        scottLoading = false;
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send';
    }
}

/**
 * Append a message to the Scott chat display.
 */
function appendScottMessage(role, content, toolCalls) {
    const container = document.getElementById('scott-messages');
    const id = 'scott-msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const div = document.createElement('div');
    div.id = id;
    div.style.cssText = role === 'user'
        ? 'align-self:flex-end;max-width:75%;padding:12px 16px;border-radius:12px 12px 4px 12px;background:var(--accent-blue);color:#fff;font-size:14px;line-height:1.6;'
        : 'align-self:flex-start;max-width:85%;padding:12px 16px;border-radius:12px 12px 12px 4px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text-primary);font-size:14px;line-height:1.6;';

    if (role === 'assistant' && content !== 'Thinking...') {
        div.innerHTML = formatScottResponse(content);
    } else {
        div.textContent = content;
        if (content === 'Thinking...') {
            div.style.opacity = '0.6';
            div.style.fontStyle = 'italic';
        }
    }

    // Show tool calls as a subtle indicator
    if (toolCalls && toolCalls.length > 0) {
        const toolDiv = document.createElement('div');
        toolDiv.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:12px;color:var(--text-muted);';
        const toolNames = toolCalls.map(t => t.tool.replace(/_/g, ' ')).join(', ');
        toolDiv.textContent = `Tools used: ${toolNames}`;
        div.appendChild(toolDiv);
    }

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return id;
}

/**
 * Format Scott's response with basic markdown-like rendering.
 */
function formatScottResponse(text) {
    if (!text) return '';
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code style="background:var(--bg-secondary);padding:2px 6px;border-radius:4px;font-size:13px;">$1</code>')
        .replace(/\n\n/g, '</p><p style="margin:8px 0;">')
        .replace(/\n- /g, '<br>&#x2022; ')
        .replace(/\n(\d+)\. /g, '<br>$1. ')
        .replace(/\n/g, '<br>');
    return '<p style="margin:0;">' + html + '</p>';
}

/**
 * Start a new Scott conversation -- clears history and resets state.
 */
function scottNewChat() {
    scottConversationId = null;
    localStorage.removeItem('scott_conversation_id');
    const container = document.getElementById('scott-messages');
    const welcome = document.getElementById('scott-welcome');
    // Remove all messages but keep the welcome panel
    while (container.firstChild) container.removeChild(container.firstChild);
    if (welcome) {
        welcome.style.display = '';
        container.appendChild(welcome);
    }
}

/**
 * Quick action button handler for Scott.
 */
function scottQuickAction(message) {
    const input = document.getElementById('scott-input');
    input.value = message;
    sendScottMessage();
}

/**
 * Marketing AI Dashboard - state
 */
let mktCurrentTab = 'queue';
let mktQueueFilter = 'all';

/**
 * Load Marketing AI Dashboard - KPIs + default tab
 */
async function loadMarketingDashboard() {
    console.log('[Marketing AI] Loading dashboard');
    try {
        const [metricsRes, settingsRes] = await Promise.all([
            authenticatedFetch(`${API_BASE}/api/admin/marketing/metrics`),
            authenticatedFetch(`${API_BASE}/api/admin/marketing/settings`)
        ]);
        const metrics = metricsRes?.ok ? await metricsRes.json() : {};
        const settings = settingsRes?.ok ? await settingsRes.json() : {};

        // KPI cards
        document.getElementById('mkt-kpi-drafts').textContent = metrics.summary?.total_drafts || 0;
        document.getElementById('mkt-kpi-approved').textContent = metrics.summary?.total_approved || 0;
        document.getElementById('mkt-kpi-published').textContent = metrics.summary?.total_published || 0;
        document.getElementById('mkt-kpi-scheduled').textContent = metrics.summary?.total_scheduled || 0;
        document.getElementById('mkt-kpi-cost').textContent = '$' + Number(metrics.summary?.total_cost || 0).toFixed(2);
    } catch (err) {
        console.error('[Marketing AI] Dashboard load error:', err);
    }

    // Load current tab (or default to 'queue' on first load)
    const activeTab = mktCurrentTab || 'queue';
    switchMarketingTab(activeTab);
}

/**
 * Switch between marketing tabs
 */
function switchMarketingTab(tabName, el) {
    mktCurrentTab = tabName;

    // Update tab button active states
    document.querySelectorAll('#marketing-ai-view .mkt-tab').forEach(btn => btn.classList.remove('active'));
    if (el) {
        el.classList.add('active');
    } else {
        document.querySelectorAll('#marketing-ai-view .mkt-tab').forEach(btn => {
            if (btn.textContent.toLowerCase().includes(tabName.replace('-', ' ').split(' ')[0])) btn.classList.add('active');
        });
    }

    // Show/hide tab content
    document.querySelectorAll('#marketing-ai-view .mkt-tab-content').forEach(c => c.style.display = 'none');
    const target = document.getElementById(`mkt-tab-${tabName}`);
    if (target) target.style.display = 'block';

    // Load tab data
    switch (tabName) {
        case 'queue': loadMarketingQueue(); break;
        case 'published': loadMarketingPublished(); break;
        case 'rules': loadMarketingRules(); loadMarketingSkills(); break;
        case 'settings': loadMarketingSettings(); break;
    }
}

/**
 * Generate a single-platform marketing post
 */
async function generateMarketingPost() {
    const platform = document.getElementById('mkt-platform').value;
    const sourceType = document.getElementById('mkt-source-type').value;
    const instructions = document.getElementById('mkt-custom-instructions').value;
    const preview = document.getElementById('mkt-preview-area');
    const btn = document.querySelector('#mkt-tab-generate .btn-primary');

    if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
    preview.style.display = 'block';
    const previewContent = document.getElementById('mkt-preview-content') || preview;
    previewContent.innerHTML = '<div class="loading">Generating content with AI...</div>';

    try {
        const res = await authenticatedFetch(`${API_BASE}/api/admin/marketing/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform, sourceType, customInstructions: instructions })
        });
        const data = res?.ok ? await res.json() : null;
        const previewContent = document.getElementById('mkt-preview-content') || preview;
        if (data && data.posts && data.posts.length > 0) {
            const post = data.posts[0];
            previewContent.innerHTML = renderMarketingPostPreview(post);
            loadMarketingDashboard();
        } else {
            const errMsg = data?.error || 'Failed to generate content';
            previewContent.innerHTML = `<div class="loading" style="color:#ef4444;">${errMsg}</div>`;
        }
    } catch (err) {
        console.error('[Marketing AI] Generate error:', err);
        const previewContent = document.getElementById('mkt-preview-content') || preview;
        previewContent.innerHTML = '<div class="loading" style="color:#ef4444;">Generation failed. Check console for details.</div>';
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Generate Draft'; }
    }
}

/**
 * Generate posts for all platforms
 */
async function generateMarketingPostAllPlatforms() {
    const sourceType = document.getElementById('mkt-source-type').value;
    const instructions = document.getElementById('mkt-custom-instructions').value;
    const preview = document.getElementById('mkt-preview-area');
    const btn = document.querySelectorAll('#mkt-tab-generate .btn-secondary');

    btn.forEach(b => { b.disabled = true; b.textContent = 'Generating...'; });
    preview.style.display = 'block';
    const previewContent = document.getElementById('mkt-preview-content') || preview;
    previewContent.innerHTML = '<div class="loading">Generating content for all platforms...</div>';

    try {
        const res = await authenticatedFetch(`${API_BASE}/api/admin/marketing/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                platforms: ['twitter', 'linkedin', 'instagram', 'facebook'],
                sourceType,
                customInstructions: instructions
            })
        });
        const data = res?.ok ? await res.json() : null;
        const previewContent = document.getElementById('mkt-preview-content') || preview;
        if (data && data.posts && data.posts.length > 0) {
            previewContent.innerHTML = data.posts.map(p => renderMarketingPostPreview(p)).join('');
            loadMarketingDashboard();
        } else {
            const errMsg = data?.error || 'Failed to generate content';
            previewContent.innerHTML = `<div class="loading" style="color:#ef4444;">${errMsg}</div>`;
        }
    } catch (err) {
        console.error('[Marketing AI] Multi-generate error:', err);
        const previewContent = document.getElementById('mkt-preview-content') || preview;
        previewContent.innerHTML = '<div class="loading" style="color:#ef4444;">Generation failed.</div>';
    } finally {
        btn.forEach(b => { b.disabled = false; b.textContent = 'Generate All Platforms'; });
    }
}

/**
 * Render a preview card for a generated post
 */
function renderMarketingPostPreview(post) {
    const statusBadge = post.status === 'approved'
        ? '<span class="badge badge-success">Auto-Approved</span>'
        : '<span class="badge badge-warning">Draft</span>';
    const violations = post.complianceViolations || post.compliance_issues || [];
    const complianceHtml = violations.length > 0
        ? `<div style="color:#ef4444;margin-top:8px;font-size:12px;">⚠ Compliance: ${violations.join(', ')}</div>`
        : '<div style="color:var(--accent-green);margin-top:8px;font-size:12px;">✓ Compliance clear</div>';

    return `<div class="stat-card" style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <strong style="text-transform:capitalize;">${post.platform}</strong>
            ${statusBadge}
        </div>
        <div style="white-space:pre-wrap;font-size:14px;line-height:1.5;background:var(--bg-primary);padding:12px;border-radius:6px;border:1px solid var(--border-color);">${post.content}</div>
        ${complianceHtml}
        <div style="margin-top:8px;font-size:11px;color:var(--text-secondary);">
            ${post.content?.length || 0} chars | Model: ${post.model_used || post.model || 'unknown'} | Cost: $${Number(post.generation_cost_usd || post.cost || 0).toFixed(4)}
        </div>
        <div style="margin-top:8px;display:flex;gap:8px;">
            ${post.status === 'draft' ? `<button class="btn btn-sm btn-primary" onclick="marketingPostAction('${post.id}', 'approve')">Approve</button>
            <button class="btn btn-sm btn-secondary" onclick="marketingPostAction('${post.id}', 'reject')">Reject</button>` : ''}
            ${post.status === 'approved' ? `<button class="btn btn-sm btn-primary" onclick="marketingPublishPost('${post.id}')">Publish Now</button>
            <button class="btn btn-sm btn-secondary" onclick="marketingSchedulePost('${post.id}')">Schedule</button>` : ''}
            <button class="btn btn-sm" onclick="marketingDeletePost('${post.id}')">Delete</button>
        </div>
    </div>`;
}

/**
 * Load the marketing queue
 */
async function loadMarketingQueue() {
    const container = document.getElementById('mkt-queue-list');
    if (!container) return;
    container.innerHTML = '<div class="loading">Loading queue...</div>';

    try {
        const params = new URLSearchParams({ limit: '50' });
        if (mktQueueFilter !== 'all') params.set('status', mktQueueFilter);

        const res = await authenticatedFetch(`${API_BASE}/api/admin/marketing/queue?${params}`);
        const data = res?.ok ? await res.json() : { posts: [] };
        const posts = data.posts || [];

        if (posts.length === 0) {
            container.innerHTML = '<div class="loading">No posts in queue</div>';
            return;
        }

        container.innerHTML = posts.map(post => {
            const statusColors = { draft: 'warning', approved: 'success', rejected: 'danger', scheduled: 'info', published: 'success', failed: 'danger' };
            const badge = `<span class="badge badge-${statusColors[post.status] || 'neutral'}">${post.status}</span>`;
            const date = new Date(post.created_at).toLocaleDateString();
            const scheduledInfo = post.scheduled_for ? `<br><small>Scheduled: ${new Date(post.scheduled_for).toLocaleString()}</small>` : '';

            return `<div class="stat-card" style="margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <strong style="text-transform:capitalize;">${post.platform}</strong>
                    <div>${badge} <small style="color:var(--text-secondary);">${date}</small></div>
                </div>
                <div style="font-size:13px;line-height:1.4;max-height:80px;overflow:hidden;">${post.content}</div>
                ${scheduledInfo}
                <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
                    ${post.status === 'draft' ? `
                        <button class="btn btn-sm btn-primary" onclick="marketingPostAction('${post.id}', 'approve')">Approve</button>
                        <button class="btn btn-sm btn-secondary" onclick="marketingPostAction('${post.id}', 'reject')">Reject</button>` : ''}
                    ${post.status === 'approved' ? `
                        <button class="btn btn-sm btn-primary" onclick="marketingPublishPost('${post.id}')">Publish</button>
                        <button class="btn btn-sm btn-secondary" onclick="marketingSchedulePost('${post.id}')">Schedule</button>` : ''}
                    ${['draft', 'rejected'].includes(post.status) ? `
                        <button class="btn btn-sm" onclick="marketingDeletePost('${post.id}')">Delete</button>` : ''}
                </div>
            </div>`;
        }).join('');

        // Update status filter counts
        if (data.counts) {
            document.querySelectorAll('#mkt-tab-queue .mkt-status-filter').forEach(btn => {
                const text = btn.textContent.toLowerCase().trim();
                if (text === 'all') btn.textContent = `All (${Object.values(data.counts).reduce((a, b) => a + b, 0)})`;
            });
        }
    } catch (err) {
        console.error('[Marketing AI] Queue load error:', err);
        container.innerHTML = '<div class="loading" style="color:#ef4444;">Failed to load queue</div>';
    }
}

/**
 * Filter marketing queue by status
 */
function filterMarketingQueue(status, el) {
    mktQueueFilter = status;
    document.querySelectorAll('#mkt-tab-queue .mkt-status-filter').forEach(btn => btn.classList.remove('active'));
    if (el) el.classList.add('active');
    loadMarketingQueue();
}

/**
 * Load published marketing posts
 */
async function loadMarketingPublished() {
    const container = document.getElementById('mkt-published-list');
    if (!container) return;
    container.innerHTML = '<div class="loading">Loading published posts...</div>';

    try {
        const res = await authenticatedFetch(`${API_BASE}/api/admin/marketing/queue?status=published&limit=50`);
        const data = res?.ok ? await res.json() : { posts: [] };
        const posts = data.posts || [];

        if (posts.length === 0) {
            container.innerHTML = '<div class="loading">No published posts yet</div>';
            return;
        }

        container.innerHTML = posts.map(post => {
            const publishDate = post.published_at ? new Date(post.published_at).toLocaleString() : 'Unknown';
            return `<div class="stat-card" style="margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <strong style="text-transform:capitalize;">${post.platform}</strong>
                    <small style="color:var(--text-secondary);">Published ${publishDate}</small>
                </div>
                <div style="font-size:13px;line-height:1.4;">${post.content}</div>
                <div style="margin-top:8px;font-size:11px;color:var(--text-secondary);">
                    ${post.platform_post_id ? `ID: ${post.platform_post_id}` : ''} | Model: ${post.model_used || 'unknown'} | Cost: $${Number(post.generation_cost_usd || 0).toFixed(4)}
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        console.error('[Marketing AI] Published load error:', err);
        container.innerHTML = '<div class="loading" style="color:#ef4444;">Failed to load published posts</div>';
    }
}

/**
 * Perform action on a marketing post (approve/reject)
 */
async function marketingPostAction(postId, action) {
    try {
        const res = await authenticatedFetch(`${API_BASE}/api/admin/marketing/queue`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postId, action })
        });
        if (!res) { alert('Authentication error - please log in again'); return; }
        const data = await res.json().catch(() => null);
        if (data?.success) {
            loadMarketingDashboard();
        } else {
            alert(data?.error || `Failed to ${action} post (HTTP ${res.status})`);
        }
    } catch (err) {
        console.error(`[Marketing AI] ${action} error:`, err);
        alert(`Failed to ${action} post: ${err.message}`);
    }
}

/**
 * Publish a marketing post to its platform
 */
async function marketingPublishPost(postId) {
    if (!confirm('Publish this post now?')) return;
    try {
        const res = await authenticatedFetch(`${API_BASE}/api/admin/marketing/publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postId })
        });
        const data = res?.ok ? await res.json() : null;
        if (data?.success) {
            if (data.stubbed) {
                alert('Post published in STUB mode (no real API keys configured). Post marked as published.');
            }
            loadMarketingDashboard();
        } else {
            alert(data?.error || 'Failed to publish post');
        }
    } catch (err) {
        console.error('[Marketing AI] Publish error:', err);
        alert('Failed to publish post');
    }
}

/**
 * Schedule a marketing post
 */
async function marketingSchedulePost(postId) {
    const scheduledFor = prompt('Schedule for (YYYY-MM-DD HH:MM):');
    if (!scheduledFor) return;
    try {
        const res = await authenticatedFetch(`${API_BASE}/api/admin/marketing/queue`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postId, action: 'schedule', scheduled_for: scheduledFor })
        });
        const data = res?.ok ? await res.json() : null;
        if (data?.success) {
            loadMarketingDashboard();
        } else {
            alert(data?.error || 'Failed to schedule post');
        }
    } catch (err) {
        console.error('[Marketing AI] Schedule error:', err);
    }
}

/**
 * Delete a marketing post
 */
async function marketingDeletePost(postId) {
    if (!confirm('Delete this post?')) return;
    try {
        // Use URL param — DELETE body is stripped by some proxies/ALBs
        const res = await authenticatedFetch(`${API_BASE}/api/admin/marketing/queue/${postId}`, {
            method: 'DELETE'
        });
        const data = res?.ok ? await res.json() : null;
        if (data?.success) {
            loadMarketingDashboard();
        } else {
            alert(data?.error || 'Failed to delete post');
        }
    } catch (err) {
        console.error('[Marketing AI] Delete error:', err);
        alert('Failed to delete post');
    }
}

/**
 * Load marketing rules
 */
async function loadMarketingRules() {
    const container = document.getElementById('mkt-rules-list');
    if (!container) return;
    container.innerHTML = '<div class="loading">Loading rules...</div>';

    try {
        const res = await authenticatedFetch(`${API_BASE}/api/admin/marketing/rules`);
        const data = res?.ok ? await res.json() : { rules: [] };
        const rules = data.rules || [];

        if (rules.length === 0) {
            container.innerHTML = '<div class="loading">No rules configured. Run migration 018.</div>';
            return;
        }

        container.innerHTML = rules.map(rule => {
            const enabledClass = rule.enabled ? 'badge-success' : 'badge-neutral';
            const enabledText = rule.enabled ? 'Enabled' : 'Disabled';
            const description = rule.conditions?.description || '';
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-color);">
                <div>
                    <strong>${rule.rule_name.replace(/_/g, ' ')}</strong>
                    <div style="font-size:12px;color:var(--text-secondary);">${description}</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                    <span class="badge ${enabledClass}">${enabledText}</span>
                    <button class="btn btn-sm" onclick="toggleMarketingRule('${rule.rule_name}', ${!rule.enabled})">${rule.enabled ? 'Disable' : 'Enable'}</button>
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        console.error('[Marketing AI] Rules load error:', err);
        container.innerHTML = '<div class="loading" style="color:#ef4444;">Failed to load rules</div>';
    }
}

/**
 * Toggle a marketing rule
 */
async function toggleMarketingRule(ruleName, enabled) {
    try {
        await authenticatedFetch(`${API_BASE}/api/admin/marketing/rules`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ruleId: ruleName, enabled })
        });
        loadMarketingRules();
    } catch (err) {
        console.error('[Marketing AI] Toggle rule error:', err);
    }
}

/**
 * Load marketing skills
 */
async function loadMarketingSkills() {
    const container = document.getElementById('mkt-skills-list');
    if (!container) return;
    container.innerHTML = '<div class="loading">Loading skills...</div>';

    try {
        const res = await authenticatedFetch(`${API_BASE}/api/admin/marketing/skills`);
        const data = res?.ok ? await res.json() : { skills: [] };
        const skills = data.skills || [];

        if (skills.length === 0) {
            container.innerHTML = '<div class="loading">No skills configured</div>';
            return;
        }

        const riskColors = { 0: '#22c55e', 1: '#3b82f6', 2: '#f59e0b', 3: '#ef4444' };
        const riskLabels = { 0: 'Observe', 1: 'Suggest', 2: 'Assist', 3: 'Guard' };

        container.innerHTML = skills.map(skill => {
            const enabledClass = skill.enabled ? 'badge-success' : 'badge-neutral';
            const riskColor = riskColors[skill.risk_tier] || '#888';
            const riskLabel = riskLabels[skill.risk_tier] || 'Unknown';
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-color);">
                <div>
                    <strong>${skill.skill_name.replace(/-/g, ' ')}</strong>
                    <div style="font-size:12px;color:var(--text-secondary);">${skill.description || ''}</div>
                    <div style="font-size:11px;margin-top:2px;">
                        <span style="color:${riskColor};">●</span> Tier ${skill.risk_tier} (${riskLabel})
                        ${skill.requires_approval ? ' | <span style="color:#f59e0b;">Requires Approval</span>' : ''}
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                    <span class="badge ${enabledClass}">${skill.enabled ? 'On' : 'Off'}</span>
                    <button class="btn btn-sm" onclick="toggleMarketingSkill('${skill.skill_name}', ${!skill.enabled})">${skill.enabled ? 'Disable' : 'Enable'}</button>
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        console.error('[Marketing AI] Skills load error:', err);
        container.innerHTML = '<div class="loading" style="color:#ef4444;">Failed to load skills</div>';
    }
}

/**
 * Toggle a marketing skill
 */
async function toggleMarketingSkill(skillName, enabled) {
    try {
        await authenticatedFetch(`${API_BASE}/api/admin/marketing/skills`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skillName, enabled })
        });
        loadMarketingSkills();
    } catch (err) {
        console.error('[Marketing AI] Toggle skill error:', err);
    }
}

/**
 * Load marketing settings (platform connections)
 */
async function loadMarketingSettings() {
    const container = document.getElementById('mkt-settings-platforms');
    if (!container) return;
    container.innerHTML = '<div class="loading">Loading settings...</div>';

    try {
        const res = await authenticatedFetch(`${API_BASE}/api/admin/marketing/settings`);
        const data = res?.ok ? await res.json() : {};

        const platforms = data.platforms || {};
        const ai = data.ai || {};

        let html = '<div style="margin-bottom:16px;">';
        html += '<h4 style="margin-bottom:8px;">AI Provider</h4>';
        html += `<div style="display:flex;gap:12px;">
            <div class="stat-card" style="flex:1;text-align:center;">
                <div style="font-size:12px;color:var(--text-secondary);">Claude (Anthropic)</div>
                <div style="font-size:18px;font-weight:600;color:${ai.anthropic?.configured ? 'var(--accent-green)' : '#ef4444'};">${ai.anthropic?.configured ? 'Configured' : 'Not Set'}</div>
            </div>
            <div class="stat-card" style="flex:1;text-align:center;">
                <div style="font-size:12px;color:var(--text-secondary);">OpenAI (Fallback)</div>
                <div style="font-size:18px;font-weight:600;color:${ai.openai?.configured ? 'var(--accent-green)' : '#ef4444'};">${ai.openai?.configured ? 'Configured' : 'Not Set'}</div>
            </div>
        </div></div>`;

        html += '<h4 style="margin-bottom:8px;">Social Platforms</h4>';
        const platformNames = ['twitter', 'linkedin', 'instagram', 'facebook'];
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
        platformNames.forEach(name => {
            const status = platforms[name];
            const connected = status?.connected;
            const icon = connected ? '✓' : '✗';
            const color = connected ? 'var(--accent-green)' : '#ef4444';
            const mode = status?.mode || 'stub';
            html += `<div class="stat-card" style="text-align:center;">
                <div style="font-size:14px;font-weight:600;text-transform:capitalize;">${name}</div>
                <div style="font-size:20px;color:${color};margin:4px 0;">${icon}</div>
                <div style="font-size:11px;color:var(--text-secondary);">${connected ? `Connected (${mode})` : 'Not Connected'}</div>
            </div>`;
        });
        html += '</div>';

        container.innerHTML = html;

        // Update credential section status badges
        platformNames.forEach(name => {
            const badge = document.getElementById(`mkt-cred-status-${name}`);
            if (badge) {
                const connected = platforms[name]?.connected;
                badge.textContent = connected ? 'Connected' : 'Not Connected';
                badge.style.background = connected ? 'rgba(72,187,120,0.15)' : 'rgba(239,68,68,0.15)';
                badge.style.color = connected ? 'var(--accent-green)' : '#ef4444';
            }
        });
    } catch (err) {
        console.error('[Marketing AI] Settings load error:', err);
        container.innerHTML = '<div class="loading" style="color:#ef4444;">Failed to load settings</div>';
    }
}

/** Toggle credential section visibility */
function toggleMktCredentialSection(platform) {
    const section = document.getElementById(`mkt-cred-section-${platform}`);
    if (section) {
        section.style.display = section.style.display === 'none' ? 'block' : 'none';
    }
}

/** Save credentials for a platform */
async function saveMktCredentials(platform) {
    const keyMap = {
        facebook:  ['facebook_page_id', 'facebook_page_access_token'],
        instagram: ['instagram_business_account', 'instagram_access_token'],
        linkedin:  ['linkedin_person_urn', 'linkedin_access_token'],
        twitter:   ['twitter_api_key', 'twitter_api_secret', 'twitter_access_token', 'twitter_access_secret'],
    };

    const keys = keyMap[platform];
    if (!keys) return;

    const settings = {};
    let hasEmpty = false;
    for (const key of keys) {
        const input = document.getElementById(`mkt-cred-${key}`);
        const val = input?.value?.trim();
        if (!val) { hasEmpty = true; }
        settings[key] = val || '';
    }

    if (hasEmpty) {
        showToast(`Please fill in all ${platform} credential fields`, 'warning');
        return;
    }

    try {
        const res = await authenticatedFetch(`${API_BASE}/api/admin/marketing/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings }),
        });
        const data = res?.ok ? await res.json() : null;
        if (data?.success) {
            showToast(`${platform.charAt(0).toUpperCase() + platform.slice(1)} connected successfully`, 'success');
            // Clear input fields for security
            keys.forEach(key => {
                const input = document.getElementById(`mkt-cred-${key}`);
                if (input) input.value = '';
            });
            // Refresh status display
            await loadMarketingSettings();
        } else {
            showToast(`Failed to save ${platform} credentials`, 'error');
        }
    } catch (err) {
        console.error(`[Marketing AI] Save ${platform} credentials error:`, err);
        showToast(`Error saving ${platform} credentials: ${err.message}`, 'error');
    }
}

/** Clear/disconnect credentials for a platform */
async function clearMktCredentials(platform) {
    if (!confirm(`Disconnect ${platform}? This will remove all stored credentials.`)) return;

    const keyMap = {
        facebook:  ['facebook_page_id', 'facebook_page_access_token'],
        instagram: ['instagram_business_account', 'instagram_access_token'],
        linkedin:  ['linkedin_person_urn', 'linkedin_access_token'],
        twitter:   ['twitter_api_key', 'twitter_api_secret', 'twitter_access_token', 'twitter_access_secret'],
    };

    const keys = keyMap[platform];
    if (!keys) return;

    // Send null values to delete
    const settings = {};
    keys.forEach(key => { settings[key] = null; });

    try {
        const res = await authenticatedFetch(`${API_BASE}/api/admin/marketing/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings }),
        });
        const data = res?.ok ? await res.json() : null;
        if (data?.success) {
            showToast(`${platform.charAt(0).toUpperCase() + platform.slice(1)} disconnected`, 'success');
            await loadMarketingSettings();
        } else {
            showToast(`Failed to disconnect ${platform}`, 'error');
        }
    } catch (err) {
        console.error(`[Marketing AI] Clear ${platform} credentials error:`, err);
        showToast(`Error disconnecting ${platform}: ${err.message}`, 'error');
    }
}

/** Test connection for a platform (calls saved credentials) */
async function testMktConnection(platform) {
    const badge = document.getElementById(`mkt-cred-status-${platform}`);
    if (badge) {
        badge.textContent = 'Testing...';
        badge.style.background = 'rgba(234,179,8,0.15)';
        badge.style.color = '#eab308';
    }

    try {
        const res = await authenticatedFetch(`${API_BASE}/api/admin/marketing/settings/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform }),
        });
        const data = res?.ok ? await res.json() : null;

        if (data?.connected) {
            const details = data.details || {};
            const info = details.pageName || details.username || details.name || details.id || '';
            showToast(`${platform} connection verified${info ? ': ' + info : ''}`, 'success');
            if (badge) {
                badge.textContent = 'Verified ✓';
                badge.style.background = 'rgba(72,187,120,0.15)';
                badge.style.color = 'var(--accent-green)';
            }
        } else {
            const errMsg = data?.details?.error || data?.error || 'Connection failed';
            showToast(`${platform} test failed: ${errMsg}`, 'error');
            if (badge) {
                badge.textContent = 'Test Failed';
                badge.style.background = 'rgba(239,68,68,0.15)';
                badge.style.color = '#ef4444';
            }
        }
    } catch (err) {
        console.error(`[Marketing AI] Test ${platform} connection error:`, err);
        showToast(`Error testing ${platform}: ${err.message}`, 'error');
        if (badge) {
            badge.textContent = 'Error';
            badge.style.background = 'rgba(239,68,68,0.15)';
            badge.style.color = '#ef4444';
        }
    }
}

// ==================== CENTRAL ACCOUNTING ====================

/**
 * Load Market Intelligence view
 * Read-only analytics from market-intelligence endpoints
 */
async function loadMarketIntelligenceView() {
    const threshold = document.getElementById('market-alert-threshold')?.value || '7';
    console.log('[Market Intelligence] Loading with threshold:', threshold);

    try {
        const [alertsRes, overviewRes] = await Promise.all([
            authenticatedFetch(`${API_BASE}/api/market-intelligence/price-alerts?threshold=${encodeURIComponent(threshold)}`),
            authenticatedFetch(`${API_BASE}/api/market-intelligence/market-overview`)
        ]);

        const alertsData = alertsRes?.ok ? await alertsRes.json() : { ok: false, alerts: [] };
        const overviewData = overviewRes?.ok ? await overviewRes.json() : { ok: false, products: [], summary: {} };

        const alerts = Array.isArray(alertsData.alerts) ? alertsData.alerts : [];
        const products = Array.isArray(overviewData.products) ? overviewData.products : [];
        const summary = overviewData.summary || {};

        document.getElementById('market-products-monitored').textContent = summary.totalProducts || products.length || 0;
        document.getElementById('market-alert-count').textContent = alertsData.alertsGenerated ?? alerts.length;
        document.getElementById('market-increasing-count').textContent = summary.increasing || 0;
        document.getElementById('market-decreasing-count').textContent = summary.decreasing || 0;
        document.getElementById('market-stable-count').textContent = summary.stable || 0;

        const updatedAt = alertsData.timestamp || overviewData.timestamp;
        document.getElementById('market-last-updated').textContent =
            updatedAt ? new Date(updatedAt).toLocaleString() : '—';

        const alertsTbody = document.getElementById('market-alerts-tbody');
        if (alerts.length === 0) {
            alertsTbody.innerHTML = '<tr><td colspan="6" class="loading">No active market alerts at this threshold</td></tr>';
        } else {
            alertsTbody.innerHTML = alerts.map(alert => {
                const type = (alert.type || '').toLowerCase();
                const badgeClass = type === 'increase' ? 'warning' : (type === 'decrease' ? 'success' : 'neutral');
                const confidence = (alert.confidence || 'medium').toString();
                const confidenceClass = confidence === 'high' ? 'success' : (confidence === 'medium' ? 'warning' : 'neutral');
                return `<tr>
                    <td><strong>${alert.product || 'Unknown'}</strong></td>
                    <td><span class="badge badge-${badgeClass}">${alert.change || '0%'}</span></td>
                    <td>$${Number(alert.currentPrice || 0).toFixed(2)}</td>
                    <td>$${Number(alert.previousPrice || 0).toFixed(2)}</td>
                    <td>${Array.isArray(alert.retailers) ? alert.retailers.length : 0}</td>
                    <td><span class="badge badge-${confidenceClass}">${confidence}</span></td>
                </tr>`;
            }).join('');
        }

        const overviewTbody = document.getElementById('market-overview-tbody');
        if (products.length === 0) {
            overviewTbody.innerHTML = '<tr><td colspan="6" class="loading">No market overview data available</td></tr>';
        } else {
            overviewTbody.innerHTML = products.map(item => {
                const trend = (item.trend || 'stable').toString().toLowerCase();
                const trendClass = trend === 'increasing' ? 'warning' : (trend === 'decreasing' ? 'success' : 'neutral');
                return `<tr>
                    <td><strong>${item.product || 'Unknown'}</strong></td>
                    <td>$${Number(item.currentPrice || 0).toFixed(2)}</td>
                    <td><span class="badge badge-${trendClass}">${trend}</span></td>
                    <td>${Number(item.trendPercent || 0).toFixed(1)}%</td>
                    <td>${Array.isArray(item.retailers) ? item.retailers.length : 0}</td>
                    <td>${Number(item.articlesCount || 0)}</td>
                </tr>`;
            }).join('');
        }
    } catch (error) {
        console.error('[Market Intelligence] Load error:', error);
        const alertsTbody = document.getElementById('market-alerts-tbody');
        const overviewTbody = document.getElementById('market-overview-tbody');
        if (alertsTbody) alertsTbody.innerHTML = '<tr><td colspan="6" class="loading">Failed to load market alerts</td></tr>';
        if (overviewTbody) overviewTbody.innerHTML = '<tr><td colspan="6" class="loading">Failed to load market overview</td></tr>';
    }
}

/**
 * Load Central Accounting Dashboard
 * Aggregates revenue and expenses from all network farms
 */
async function loadCentralAccounting() {
    const period = document.getElementById('central-accounting-period')?.value || 'month';
    console.log('[Central Accounting] Loading for period:', period);

    try {
        // Calculate date range
        const now = new Date();
        let startDate = new Date();
        switch (period) {
            case 'today': startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
            case 'week':  startDate = new Date(Date.now() - 7 * 86400000); break;
            case 'month': startDate = new Date(now.getFullYear(), now.getMonth(), 1); break;
            case 'quarter': startDate = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1); break;
            case 'year':  startDate = new Date(now.getFullYear(), 0, 1); break;
        }

        const fromDateStr = startDate.toISOString().split('T')[0];
        const toDateStr = now.toISOString().split('T')[0];
        const procurementFromEl = document.getElementById('central-procurement-from');
        const procurementToEl = document.getElementById('central-procurement-to');
        if (procurementFromEl && !procurementFromEl.value) procurementFromEl.value = fromDateStr;
        if (procurementToEl && !procurementToEl.value) procurementToEl.value = toDateStr;
        const procurementFrom = procurementFromEl?.value || fromDateStr;
        const procurementTo = procurementToEl?.value || toDateStr;

        // Fetch network-wide revenue summary
        const revenueRes = await authenticatedFetch(
            `${API_BASE}/api/reports/revenue-summary?period=all`
        );
        const revenueData = revenueRes?.ok ? await revenueRes.json() : null;

        // Fetch accounting transactions for expenses
        const txnRes = await authenticatedFetch(
            `${API_BASE}/api/accounting/transactions?from=${fromDateStr}&limit=500`
        );
        const txnData = txnRes?.ok ? await txnRes.json() : null;

        // Fetch actual expense totals from double-entry ledger (COGS + processing fees only)
        const expRes = await authenticatedFetch(
            `${API_BASE}/api/accounting/expense-summary?from=${fromDateStr}&to=${toDateStr}`
        );
        const expData = expRes?.ok ? await expRes.json() : null;

        // Fetch procurement revenue summary and breakdown
        let procurementData = null;
        try {
            const procurementRes = await authenticatedFetch(
                `${API_BASE}/api/procurement/revenue?from=${procurementFrom}&to=${procurementTo}`
            );
            procurementData = procurementRes?.ok ? await procurementRes.json() : null;
            if (procurementData?.ok === false || procurementData?.success === false) {
                procurementData = null;
            }
        } catch (procurementError) {
            console.warn('[Central Accounting] Procurement revenue unavailable:', procurementError);
        }

        // Fetch admin farms list
        const farmsRes = await authenticatedFetch(`${API_BASE}/api/admin/farms`);
        const farmsData = farmsRes?.ok ? await farmsRes.json() : { farms: [] };
        const farms = farmsData.farms || farmsData || [];

        // Revenue numbers
        const totalRevenue = revenueData?.data?.totalRevenue || 0;
        const orderCount = revenueData?.data?.orderCount || 0;
        const avgOrderValue = revenueData?.data?.avgOrderValue || 0;
        const outstanding = revenueData?.data?.outstanding || 0;
        const brokerFeeTotal = revenueData?.data?.brokerFeeTotal || 0;

        // Expense numbers: derive from revenue data for consistency
        // COGS = what farms are owed = total revenue minus broker commission
        // Processing fees = from accounting ledger (account 630000) or estimated at 2.6%
        const farmPayables = Math.max(0, totalRevenue - brokerFeeTotal);
        const processingFees = (expData?.ok && expData.breakdown?.['630000'])
            ? Number(expData.breakdown['630000'])
            : Math.round(totalRevenue * 0.026 * 100) / 100;
        let totalExpenses = farmPayables + processingFees;
        const expenseCategories = {};
        if (farmPayables > 0) expenseCategories['Farm Payables (COGS)'] = farmPayables;
        if (processingFees > 0) expenseCategories['Processing Fees'] = processingFees;

        // Update KPIs
        document.getElementById('central-total-revenue').textContent = `$${totalRevenue.toFixed(2)}`;
        document.getElementById('central-wholesale-revenue').textContent = `$${totalRevenue.toFixed(2)}`;
        document.getElementById('central-order-count').textContent = orderCount;
        document.getElementById('central-avg-order').textContent = `$${avgOrderValue.toFixed(2)}`;
        const brokerFeesEl = document.getElementById('central-broker-fees');
        if (brokerFeesEl) brokerFeesEl.textContent = `$${brokerFeeTotal.toFixed(2)}`;
        document.getElementById('central-total-expenses').textContent = `$${totalExpenses.toFixed(2)}`;

        const margin = totalRevenue > 0
            ? ((totalRevenue - totalExpenses) / totalRevenue * 100).toFixed(1)
            : '0.0';
        document.getElementById('central-net-margin').textContent = `${margin}%`;

        // Revenue by Farm table
        const farmTbody = document.getElementById('central-revenue-by-farm-tbody');
        if (Array.isArray(farms) && farms.length > 0) {
            farmTbody.innerHTML = farms.map(farm => {
                const name = farm.name || farm.farm_name || farm.farmId || farm.farm_id || 'Unknown';
                const status = farm.status || farm.sync_status || 'active';
                return `<tr>
                    <td><strong>${name}</strong></td>
                    <td><span class="badge badge-${status === 'active' || status === 'ONLINE' ? 'success' : 'neutral'}">${status}</span></td>
                    <td>${farm.rooms || farm.room_count || '—'}</td>
                    <td>${farm.capacity || '—'}</td>
                    <td style="font-size: 12px; color: var(--text-secondary);">${farm.farmId || farm.farm_id || '—'}</td>
                </tr>`;
            }).join('');
        } else {
            farmTbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: var(--text-secondary);">No farm data available</td></tr>';
        }

        // Expense categories table
        const expensesTbody = document.getElementById('central-expenses-tbody');
        const catEntries = Object.entries(expenseCategories);
        if (catEntries.length > 0) {
            expensesTbody.innerHTML = catEntries.map(([cat, amount]) => {
                const pct = totalExpenses > 0 ? ((amount / totalExpenses) * 100).toFixed(1) : '0.0';
                return `<tr>
                    <td>${cat.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</td>
                    <td>$${amount.toFixed(2)}</td>
                    <td>${pct}%</td>
                </tr>`;
            }).join('');
        } else {
            expensesTbody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: var(--text-secondary);">No expense data for this period</td></tr>';
        }

        // Outstanding balance
        document.getElementById('central-outstanding').textContent = `$${outstanding.toFixed(2)}`;

        // Procurement summary
        const procurementSummary = procurementData?.summary || procurementData?.data?.summary || {};
        const procurementTotalRevenue = Number(procurementSummary.totalRevenue || 0);
        const procurementTotalCommission = Number(procurementSummary.totalCommission || 0);
        const procurementTotalOrders = Number(procurementSummary.totalOrders || 0);
        const procurementAvgOrder = Number(procurementSummary.avgOrderValue || 0);

        const procurementTotalEl = document.getElementById('central-procurement-total');
        const procurementCommissionEl = document.getElementById('central-procurement-commission');
        const procurementOrdersEl = document.getElementById('central-procurement-orders');
        const procurementAvgEl = document.getElementById('central-procurement-avg-order');

        if (procurementTotalEl) procurementTotalEl.textContent = `$${procurementTotalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        if (procurementCommissionEl) procurementCommissionEl.textContent = `$${procurementTotalCommission.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        if (procurementOrdersEl) procurementOrdersEl.textContent = procurementTotalOrders.toLocaleString();
        if (procurementAvgEl) procurementAvgEl.textContent = `$${procurementAvgOrder.toFixed(2)}`;

        // Procurement by supplier table
        const supplierTbody = document.getElementById('central-procurement-by-supplier-tbody');
        const bySupplier = procurementData?.bySupplier || procurementData?.data?.bySupplier || [];
        if (supplierTbody) {
            if (Array.isArray(bySupplier) && bySupplier.length > 0) {
                supplierTbody.innerHTML = bySupplier.map(supplier => `
                    <tr>
                        <td>${supplier.name || supplier.supplierId || 'Unknown'}</td>
                        <td>${Number(supplier.orderCount || 0).toLocaleString()}</td>
                        <td>$${Number(supplier.revenue || 0).toFixed(2)}</td>
                        <td>$${Number(supplier.commission || 0).toFixed(2)}</td>
                    </tr>
                `).join('');
            } else {
                supplierTbody.innerHTML = '<tr><td colspan="4" class="loading">No procurement supplier revenue in selected range</td></tr>';
            }
        }

        // Procurement by month table
        const monthTbody = document.getElementById('central-procurement-by-month-tbody');
        const byMonth = procurementData?.byMonth || procurementData?.data?.byMonth || [];
        if (monthTbody) {
            if (Array.isArray(byMonth) && byMonth.length > 0) {
                monthTbody.innerHTML = byMonth.map(month => `
                    <tr>
                        <td>${month.month || '—'}</td>
                        <td>${Number(month.orderCount || 0).toLocaleString()}</td>
                        <td>$${Number(month.revenue || 0).toFixed(2)}</td>
                        <td>$${Number(month.commission || 0).toFixed(2)}</td>
                    </tr>
                `).join('');
            } else {
                monthTbody.innerHTML = '<tr><td colspan="4" class="loading">No procurement monthly revenue in selected range</td></tr>';
            }
        }

    } catch (error) {
        console.error('[Central Accounting] Load error:', error);
        document.getElementById('central-total-revenue').textContent = 'Error';
    }
}

/**
 * Export fleet financial report as CSV
 */
function exportFleetReport() {
    const period = document.getElementById('central-accounting-period')?.value || 'month';
    const timestamp = new Date().toISOString().split('T')[0];

    let csv = 'GreenReach Network Financial Report\n';
    csv += `Period,${period}\n`;
    csv += `Generated,${new Date().toLocaleString()}\n\n`;
    csv += `Metric,Value\n`;
    csv += `Total Revenue,${document.getElementById('central-total-revenue').textContent}\n`;
    csv += `Total Expenses,${document.getElementById('central-total-expenses').textContent}\n`;
    csv += `Net Margin,${document.getElementById('central-net-margin').textContent}\n`;
    csv += `Order Count,${document.getElementById('central-order-count').textContent}\n`;
    csv += `Avg Order Value,${document.getElementById('central-avg-order').textContent}\n`;
        const brokerFeesEl = document.getElementById('central-broker-fees');
        if (brokerFeesEl) brokerFeesEl.textContent = `$${brokerFeeTotal.toFixed(2)}`;
    csv += `Outstanding,${document.getElementById('central-outstanding').textContent}\n`;

    // Farm breakdown
    csv += '\nFarm,Status,Rooms,Capacity,Farm ID\n';
    const farmRows = document.querySelectorAll('#central-revenue-by-farm-tbody tr');
    farmRows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 5) {
            csv += Array.from(cells).map(c => c.textContent.trim()).join(',') + '\n';
        }
    });

    // Expense breakdown
    csv += '\nExpense Category,Amount,% of Total\n';
    const expRows = document.querySelectorAll('#central-expenses-tbody tr');
    expRows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 3) {
            csv += Array.from(cells).map(c => c.textContent.trim()).join(',') + '\n';
        }
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `greenreach-network-report-${timestamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════════════
// SALAD MIX MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

let saladMixesData = [];

async function loadSaladMixes() {
    try {
        const token = localStorage.getItem('adminToken');
        const resp = await fetch('/api/admin/salad-mixes', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await resp.json();
        if (data.success) {
            saladMixesData = data.mixes || [];
            renderSaladMixesTable();
        }
    } catch (err) {
        console.error('[SaladMixes] Load error:', err);
    }
}

function renderSaladMixesTable() {
    const tbody = document.getElementById('salad-mixes-tbody');
    if (!tbody) return;

    const countEl = document.getElementById('salad-mixes-count');
    if (countEl) countEl.textContent = saladMixesData.length;

    if (saladMixesData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--text-secondary);">No salad mixes defined yet. Click "Add New Mix" to create one.</td></tr>';
        return;
    }

    tbody.innerHTML = saladMixesData.map(mix => {
        const compList = (mix.components || []).map(c =>
            `${c.product_name} (${(parseFloat(c.ratio) * 100).toFixed(0)}%)`
        ).join(', ');
        return `<tr>
            <td><strong>${mix.name}</strong></td>
            <td>${mix.description || '-'}</td>
            <td>${compList}</td>
            <td><span class="status-badge ${mix.status === 'active' ? 'status-active' : 'status-inactive'}">${mix.status}</span></td>
            <td>
                <button class="btn btn-sm" onclick="openEditMixModal(${mix.id})" title="Edit">Edit</button>
                <button class="btn btn-sm btn-danger" onclick="deleteSaladMix(${mix.id})" title="Delete">Delete</button>
            </td>
        </tr>`;
    }).join('');
}

function openAddMixModal() {
    document.getElementById('mix-modal-title').textContent = 'Add New Salad Mix';
    document.getElementById('mix-modal-id').value = '';
    document.getElementById('mix-modal-name').value = '';
    document.getElementById('mix-modal-description').value = '';
    document.getElementById('mix-modal-status').value = 'active';
    const container = document.getElementById('mix-components-container');
    container.innerHTML = '';
    addMixComponentRow();
    addMixComponentRow();
    document.getElementById('mix-modal').style.display = 'flex';
}

function openEditMixModal(mixId) {
    const mix = saladMixesData.find(m => m.id === mixId);
    if (!mix) return;
    document.getElementById('mix-modal-title').textContent = 'Edit Salad Mix';
    document.getElementById('mix-modal-id').value = mix.id;
    document.getElementById('mix-modal-name').value = mix.name;
    document.getElementById('mix-modal-description').value = mix.description || '';
    document.getElementById('mix-modal-status').value = mix.status || 'active';
    const container = document.getElementById('mix-components-container');
    container.innerHTML = '';
    for (const c of mix.components) {
        addMixComponentRow(c.product_name, (parseFloat(c.ratio) * 100).toFixed(0), c.product_id);
    }
    document.getElementById('mix-modal').style.display = 'flex';
}

function closeMixModal() {
    document.getElementById('mix-modal').style.display = 'none';
}

function addMixComponentRow(name, pct, productId) {
    const container = document.getElementById('mix-components-container');
    const rows = container.querySelectorAll('.mix-comp-row');
    if (rows.length >= 4) return; // max 4 components
    const row = document.createElement('div');
    row.className = 'mix-comp-row';
    row.style.cssText = 'display:grid;grid-template-columns:1fr 80px 30px;gap:8px;margin-bottom:8px;align-items:center;';
    row.innerHTML = `
        <input type="text" class="mix-comp-name" placeholder="Product name (e.g. Romaine Lettuce)" value="${name || ''}" style="padding:8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);">
        <input type="number" class="mix-comp-pct" placeholder="%" min="1" max="100" value="${pct || ''}" style="padding:8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);text-align:center;">
        <button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--danger-color);cursor:pointer;font-size:18px;">X</button>
    `;
    if (productId) {
        const nameInput = row.querySelector('.mix-comp-name');
        nameInput.dataset.productId = productId;
    }
    container.appendChild(row);
}

async function saveSaladMix() {
    const id = document.getElementById('mix-modal-id').value;
    const name = document.getElementById('mix-modal-name').value.trim();
    const description = document.getElementById('mix-modal-description').value.trim();
    const status = document.getElementById('mix-modal-status').value;

    if (!name) { alert('Mix name is required'); return; }

    const rows = document.querySelectorAll('#mix-components-container .mix-comp-row');
    const components = [];
    for (const row of rows) {
        const pName = row.querySelector('.mix-comp-name').value.trim();
        const pct = parseFloat(row.querySelector('.mix-comp-pct').value);
        const pId = row.querySelector('.mix-comp-name').dataset.productId || pName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        if (pName && pct > 0) {
            components.push({ product_name: pName, product_id: pId, ratio: pct / 100 });
        }
    }

    if (components.length < 2 || components.length > 4) {
        alert('A mix must have 2-4 components'); return;
    }
    const sum = components.reduce((s, c) => s + c.ratio, 0);
    if (Math.abs(sum - 1.0) > 0.01) {
        alert(`Ratios must sum to 100%. Current: ${(sum * 100).toFixed(1)}%`); return;
    }

    try {
        const token = localStorage.getItem('adminToken');
        const method = id ? 'PUT' : 'POST';
        const url = id ? `/api/admin/salad-mixes/${id}` : '/api/admin/salad-mixes';
        const resp = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ name, description, status, components })
        });
        const data = await resp.json();
        if (data.success) {
            closeMixModal();
            await loadSaladMixes();
        } else {
            alert(data.error || 'Failed to save mix');
        }
    } catch (err) {
        console.error('[SaladMixes] Save error:', err);
        alert('Failed to save mix');
    }
}

async function deleteSaladMix(mixId) {
    if (!confirm('Delete this salad mix template?')) return;
    try {
        const token = localStorage.getItem('adminToken');
        const resp = await fetch(`/api/admin/salad-mixes/${mixId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await resp.json();
        if (data.success) {
            await loadSaladMixes();
        } else {
            alert(data.error || 'Failed to delete');
        }
    } catch (err) {
        console.error('[SaladMixes] Delete error:', err);
    }
}

console.log('  window.DEBUG.getEvents(20) - Get last 20 events');
console.log('  window.DEBUG.showPageViews() - Show all page views');
console.log('  window.DEBUG.showLastError() - Show last error');
console.log('  window.DEBUG.showLastAPICall() - Show last API call');
console.log('  window.DEBUG.exportSession() - Export full session');
