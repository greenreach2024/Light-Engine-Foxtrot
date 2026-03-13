/**
 * Plan Feature Registry & Cloud/Edge Feature Gating
 * Controls which features are accessible based on plan_type (cloud vs edge).
 * Adds visual badges and upgrade CTAs for edge-only features.
 */

const PLAN_FEATURES = {
  cloud: {
    monitoring: true,
    inventory: true,
    pos: true,
    onlineSales: true,
    wholesale: true,
    aiAgent: true,
    grantWizard: true,
    sustainability: true,
    activityHub: true,
    traceability: true,
    qualityControl: true,
    procurement: true,
    accounting: true,
    exports: true,
    payments: true,
    pricing: true,
    cropValue: true,
    users: true,
    settings: true,
    plantingScheduler: true,
    traySetup: true,
    cropWeightAnalytics: true,

    lightControl: false,
    envControl: false,
    nutrientControl: false,
    deviceScanner: false,
    busMapping: false,
    hardwareControl: false,
    heatMap: false,
    lightSetup: false,
    pairDevices: false,
    iotDevices: false,
    equipmentOverview: false
  },
  edge: {
    monitoring: true,
    inventory: true,
    pos: true,
    onlineSales: true,
    wholesale: true,
    aiAgent: true,
    grantWizard: true,
    sustainability: true,
    activityHub: true,
    traceability: true,
    qualityControl: true,
    procurement: true,
    accounting: true,
    exports: true,
    payments: true,
    pricing: true,
    cropValue: true,
    users: true,
    settings: true,
    plantingScheduler: true,
    traySetup: true,
    cropWeightAnalytics: true,

    lightControl: true,
    envControl: true,
    nutrientControl: true,
    deviceScanner: true,
    busMapping: true,
    hardwareControl: true,
    heatMap: true,
    lightSetup: true,
    pairDevices: true,
    iotDevices: true,
    equipmentOverview: true
  }
};

/**
 * Map nav item data-help-title or data-section to feature key
 */
const NAV_FEATURE_MAP = {
  'nutrient-management': 'nutrientControl',
  'room-heatmap': 'heatMap'
};

/**
 * Map LE-dashboard sidebar targets to feature keys
 */
const DASHBOARD_FEATURE_MAP = {
  'light-setup': 'lightSetup',
  'bus-mapping': 'busMapping',
  'pair-devices': 'pairDevices',
  'iot-devices': 'iotDevices',
  'equipment-overview': 'equipmentOverview'
};

/**
 * Apply plan-based feature gating to nav items and UI.
 * Called from loadSettings() after plan_type is determined.
 */
function applyPlanFeatureGating(planType) {
  if (!planType) planType = localStorage.getItem('plan_type') || 'cloud';
  const features = PLAN_FEATURES[planType] || PLAN_FEATURES.cloud;

  console.log('[Plan Features] Applying gating for plan:', planType);

  // Gate LE-farm-admin.html sidebar nav items
  gateNavItems(features, planType);

  // Gate LE-dashboard.html sidebar items (inside iframe — deferred)
  gateDashboardItems(features, planType);
}

function gateNavItems(features, planType) {
  // Nutrient Management
  gateNavByUrl('/views/nutrient-management.html', features.nutrientControl, planType);
  // Heat Map
  gateNavByUrl('/views/room-heatmap.html', features.heatMap, planType);
}

function gateNavByUrl(url, isAllowed, planType) {
  const navItem = document.querySelector(`.nav-item[data-url="${url}"]`);
  if (!navItem) return;

  if (!isAllowed) {
    // Add edge badge
    if (!navItem.querySelector('.edge-badge')) {
      const badge = document.createElement('span');
      badge.className = 'edge-badge';
      badge.textContent = '🔒 Edge';
      badge.style.cssText = 'font-size: 9px; background: rgba(139,92,246,0.15); color: #a78bfa; padding: 2px 6px; border-radius: 4px; margin-left: auto; white-space: nowrap;';
      navItem.style.display = 'flex';
      navItem.style.alignItems = 'center';
      navItem.appendChild(badge);
    }

    // Override click to show upgrade message
    navItem.addEventListener('click', function edgeGate(e) {
      e.preventDefault();
      e.stopPropagation();
      showUpgradeModal('This feature requires Light Engine Edge.');
    }, { once: false, capture: true });

    navItem.style.opacity = '0.6';
  }
}

function gateDashboardItems(features, planType) {
  // The LE-dashboard is in an iframe; we'll inject gating when the iframe loads
  const iframe = document.getElementById('admin-iframe');
  if (!iframe) return;

  // Listen for iframe load to inject gating
  iframe.addEventListener('load', function() {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) return;
      const iframePath = iframe.contentWindow?.location?.pathname || '';

      // Only gate the LE-dashboard
      if (!iframePath.includes('LE-dashboard')) return;

      // Gate sidebar links inside the dashboard
      Object.entries(DASHBOARD_FEATURE_MAP).forEach(([target, featureKey]) => {
        if (!features[featureKey]) {
          const link = iframeDoc.querySelector(`[data-target="${target}"]`);
          if (link && !link.querySelector('.edge-badge')) {
            const badge = iframeDoc.createElement('span');
            badge.className = 'edge-badge';
            badge.textContent = '🔒 Edge';
            badge.style.cssText = 'font-size: 9px; background: rgba(139,92,246,0.15); color: #a78bfa; padding: 2px 6px; border-radius: 4px; margin-left: auto; white-space: nowrap;';
            link.style.display = 'flex';
            link.style.alignItems = 'center';
            link.appendChild(badge);
            link.style.opacity = '0.6';

            link.addEventListener('click', function(e) {
              e.preventDefault();
              e.stopPropagation();
              // Show message in iframe context
              const panel = iframeDoc.getElementById(target) || iframeDoc.querySelector(`[data-panel="${target}"]`);
              if (panel) {
                panel.innerHTML = `
                  <div style="text-align: center; padding: 60px 20px; color: #94a3b8;">
                    <div style="font-size: 48px; margin-bottom: 16px;">🔒</div>
                    <h2 style="color: #e2e8f0; margin-bottom: 8px;">Edge Light Engine Required</h2>
                    <p style="max-width: 400px; margin: 0 auto 24px; line-height: 1.6;">
                      This feature requires the Light Engine Edge hardware for direct device control.
                      Your Cloud plan includes monitoring, inventory, POS, and online sales.
                    </p>
                    <a href="/purchase.html?upgrade=edge" target="_top"
                       style="display: inline-block; padding: 10px 24px; background: #8b5cf6; color: white; border-radius: 6px; text-decoration: none; font-weight: 500;">
                      Upgrade to Edge
                    </a>
                  </div>`;
              }
            }, { capture: true });
          }
        }
      });
    } catch (e) {
      // Cross-origin or other error — silently ignore
      console.warn('[Plan Features] Could not gate iframe:', e.message);
    }
  });
}

function showUpgradeModal(message) {
  // Remove any existing modal
  const existing = document.getElementById('upgrade-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'upgrade-modal-overlay';
  overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); z-index: 10000; display: flex; align-items: center; justify-content: center;';
  overlay.innerHTML = `
    <div style="background: var(--bg-card, #1e293b); border-radius: 12px; padding: 32px; max-width: 420px; text-align: center; border: 1px solid var(--border, #334155);">
      <div style="font-size: 48px; margin-bottom: 12px;">🔒</div>
      <h2 style="color: var(--text-primary, #f1f5f9); margin: 0 0 8px;">Edge Light Engine Required</h2>
      <p style="color: var(--text-secondary, #94a3b8); margin: 0 0 24px; line-height: 1.6;">${message}<br>Your Cloud plan includes monitoring, inventory, POS, and online sales.</p>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button onclick="document.getElementById('upgrade-modal-overlay').remove()" style="padding: 10px 20px; background: var(--bg-secondary, #334155); color: var(--text-primary, #f1f5f9); border: none; border-radius: 6px; cursor: pointer;">Close</button>
        <a href="/purchase.html?upgrade=edge" style="padding: 10px 20px; background: #8b5cf6; color: white; border-radius: 6px; text-decoration: none; font-weight: 500;">Upgrade to Edge</a>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) overlay.remove();
  });
}

// Export for use
window.PLAN_FEATURES = PLAN_FEATURES;
window.applyPlanFeatureGating = applyPlanFeatureGating;
window.showUpgradeModal = showUpgradeModal;
