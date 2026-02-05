/**
 * Light Engine Feature Detection
 * Feature restrictions based on RELIABILITY requirements, not technical capability
 * 
 * Both deployments support:
 * - Monitoring (sensors, inventory, plans)
 * - Activity Hub (orders, picking, packing)
 * - Quality Control (checkpoints)
 * - Tray Operations (harvest, moves, planting)
 * 
 * Edge-only features (require 24/7 reliable connection):
 * - Device Control (lights, pumps, HVAC)
 * - Nutrient Management (pH/EC dosing)
 */
(async function() {
  try {
    const response = await fetch('/api/config/features');
    if (!response.ok) {
      console.warn('[LE Config] Feature config unavailable, using edge defaults');
      window.LE_CONFIG = {
        deployment: 'edge',
        features: {
          monitoring: true,
          inventory: true,
          planning: true,
          forecasting: true,
          activityHub: true,
          qualityControl: true,
          trayOperations: true,
          tabletPairing: true,
          deviceControl: true,
          nutrientControl: true,
          criticalAlerts: true
        }
      };
      return;
    }
    
    window.LE_CONFIG = await response.json();
    document.dispatchEvent(new CustomEvent('le:config:ready'));
    console.log('[LE Config] Loaded:', window.LE_CONFIG.deployment, 'mode');
    
    if (!window.LE_CONFIG.features.deviceControl) {
      console.info('[LE Config] Critical controls restricted:', window.LE_CONFIG.restrictions.reason);
    }
  } catch (err) {
    console.error('[LE Config] Failed to load:', err);
    // Default to edge mode on error
    window.LE_CONFIG = {
      deployment: 'edge',
      features: {
        monitoring: true,
        inventory: true,
        planning: true,
        forecasting: true,
        activityHub: true,
        qualityControl: true,
        trayOperations: true,
        tabletPairing: true,
        deviceControl: true,
        nutrientControl: true,
        criticalAlerts: true
      }
    };
  }
})();
