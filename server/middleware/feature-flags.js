/**
 * Feature Flag Middleware
 * 
 * Enforces license-based feature access control
 * Blocks restricted endpoints based on deployment tier
 * Audit logs feature access attempts
 */

import { hasFeature, getLicenseTier, getLicenseInfo } from '../../lib/license-manager.js';

/**
 * Feature definitions by tier
 * inventory-only: Basic features only
 * full: All automation features
 * enterprise: All features + advanced capabilities
 */
const FEATURE_DEFINITIONS = {
  // Core features (all tiers)
  'inventory': { tiers: ['inventory-only', 'full', 'enterprise'], name: 'Inventory Management' },
  'scheduling': { tiers: ['inventory-only', 'full', 'enterprise'], name: 'Scheduling' },
  'wholesale': { tiers: ['inventory-only', 'full', 'enterprise'], name: 'Wholesale Marketplace' },
  'reporting': { tiers: ['inventory-only', 'full', 'enterprise'], name: 'Reporting' },
  
  // Automation features (full tier and above)
  'automation': { tiers: ['full', 'enterprise'], name: 'Automation Control' },
  'climate_control': { tiers: ['full', 'enterprise'], name: 'Climate Control' },
  'sensors': { tiers: ['full', 'enterprise'], name: 'Sensor Monitoring' },
  
  // Advanced features (enterprise only)
  'analytics': { tiers: ['enterprise'], name: 'Advanced Analytics' },
  'ml': { tiers: ['enterprise'], name: 'Machine Learning' },
  'api_access': { tiers: ['enterprise'], name: 'API Access' },
};

/**
 * Endpoint to feature mapping
 * Maps API routes to required features
 */
const ENDPOINT_FEATURES = {
  // Automation endpoints (require 'automation' feature)
  '/api/env': 'automation',
  '/api/devices': 'automation',
  '/api/automation': 'automation',
  '/api/control': 'automation',
  '/api/zones': 'automation',
  
  // Climate control endpoints (require 'climate_control' feature)
  '/api/climate': 'climate_control',
  '/api/setpoints': 'climate_control',
  '/api/psychrometrics': 'climate_control',
  
  // Sensor endpoints (require 'sensors' feature)
  '/api/sensors': 'sensors',
  
  // ML endpoints (require 'ml' feature)
  '/api/ml': 'ml',
  
  // Analytics endpoints (require 'analytics' feature)
  '/api/analytics': 'analytics',
  
  // Wholesale - ALWAYS ALLOWED (all tiers)
  '/api/wholesale': null, // null = no restriction
  '/wholesale.html': null,
  '/wholesale-admin.html': null,
};

/**
 * Get deployment mode from environment or license
 * Priority: DEPLOYMENT_MODE env var > License tier
 */
async function getDeploymentMode() {
  // Check environment variable first
  const envMode = process.env.DEPLOYMENT_MODE;
  if (envMode && ['inventory-only', 'full', 'edge', 'enterprise'].includes(envMode)) {
    return envMode;
  }
  
  // Fall back to license tier
  try {
    const tier = await getLicenseTier();
    return tier || 'inventory-only'; // Default to most restrictive
  } catch (err) {
    console.warn('[FeatureFlags] Failed to get license tier:', err.message);
    return 'inventory-only'; // Fail closed
  }
}

/**
 * Check if a feature is enabled
 * @param {string} feature - Feature name
 * @returns {Promise<boolean>}
 */
export async function isFeatureEnabled(feature) {
  // Development mode - all features enabled
  if (process.env.NODE_ENV === 'development' || process.env.DEMO_MODE === 'true') {
    return true;
  }
  
  // Check license
  try {
    return await hasFeature(feature);
  } catch (err) {
    console.error('[FeatureFlags] Feature check failed:', err.message);
    return false; // Fail closed
  }
}

/**
 * Middleware: Require specific feature
 * Blocks request if feature is not enabled in license
 * 
 * Usage: app.get('/api/automation', requireFeature('automation'), handler)
 */
export function requireFeature(feature) {
  return async (req, res, next) => {
    // Development/demo mode - bypass
    if (process.env.NODE_ENV === 'development' || process.env.DEMO_MODE === 'true') {
      return next();
    }
    
    try {
      const enabled = await hasFeature(feature);
      
      if (!enabled) {
        const licenseInfo = await getLicenseInfo();
        
        // Audit log blocked access
        console.warn('[FeatureFlags] Feature access denied:', {
          feature,
          path: req.path,
          method: req.method,
          tier: licenseInfo?.tier || 'unknown',
          farmId: licenseInfo?.farmId || 'unknown',
          ip: req.ip,
        });
        
        return res.status(403).json({
          ok: false,
          error: 'Feature not available',
          message: `The '${FEATURE_DEFINITIONS[feature]?.name || feature}' feature is not available in your current tier.`,
          feature,
          tier: licenseInfo?.tier,
          upgrade: 'Contact sales@greenreach.io to upgrade your license',
        });
      }
      
      next();
    } catch (err) {
      console.error('[FeatureFlags] Feature check error:', err.message);
      return res.status(500).json({
        ok: false,
        error: 'License validation failed',
      });
    }
  };
}

/**
 * Middleware: Auto-detect and enforce feature requirements
 * Automatically blocks endpoints based on path matching
 * 
 * Usage: app.use(autoEnforceFeatures())
 */
export function autoEnforceFeatures() {
  return async (req, res, next) => {
    // Development/demo mode - bypass
    if (process.env.NODE_ENV === 'development' || process.env.DEMO_MODE === 'true') {
      return next();
    }
    
    // Skip non-API requests
    if (!req.path.startsWith('/api/')) {
      return next();
    }
    
    // Check if this endpoint requires a feature
    let requiredFeature = null;
    
    for (const [endpoint, feature] of Object.entries(ENDPOINT_FEATURES)) {
      if (req.path.startsWith(endpoint)) {
        requiredFeature = feature;
        break;
      }
    }
    
    // No feature required - allow access
    if (!requiredFeature) {
      return next();
    }
    
    // Check feature access
    try {
      const enabled = await hasFeature(requiredFeature);
      
      if (!enabled) {
        const licenseInfo = await getLicenseInfo();
        
        // Audit log
        console.warn('[FeatureFlags] Auto-blocked access:', {
          feature: requiredFeature,
          path: req.path,
          method: req.method,
          tier: licenseInfo?.tier || 'unknown',
          farmId: licenseInfo?.farmId || 'unknown',
        });
        
        return res.status(403).json({
          ok: false,
          error: 'Feature not available',
          message: `This endpoint requires the '${FEATURE_DEFINITIONS[requiredFeature]?.name || requiredFeature}' feature.`,
          feature: requiredFeature,
          tier: licenseInfo?.tier,
        });
      }
      
      next();
    } catch (err) {
      console.error('[FeatureFlags] Auto-enforce error:', err.message);
      next(); // Fail open for now to avoid breaking during errors
    }
  };
}

/**
 * Get available features for current license
 * @returns {Promise<object>} Feature availability map
 */
export async function getAvailableFeatures() {
  const licenseInfo = await getLicenseInfo();
  const tier = licenseInfo?.tier || 'inventory-only';
  
  const available = {};
  
  for (const [feature, definition] of Object.entries(FEATURE_DEFINITIONS)) {
    available[feature] = {
      enabled: definition.tiers.includes(tier),
      name: definition.name,
      tier: tier,
    };
  }
  
  return available;
}

/**
 * Audit log for feature access
 * @param {string} feature - Feature name
 * @param {object} req - Express request object
 * @param {boolean} granted - Whether access was granted
 */
export async function auditFeatureAccess(feature, req, granted) {
  try {
    const licenseInfo = await getLicenseInfo();
    
    const auditEntry = {
      timestamp: new Date().toISOString(),
      feature,
      granted,
      path: req.path,
      method: req.method,
      tier: licenseInfo?.tier || 'unknown',
      farmId: licenseInfo?.farmId || 'unknown',
      ip: req.ip,
      userAgent: req.get('user-agent'),
    };
    
    // Log to console (could be sent to audit service)
    if (!granted) {
      console.warn('[FeatureAudit] DENIED:', JSON.stringify(auditEntry));
    } else {
      console.log('[FeatureAudit] GRANTED:', JSON.stringify(auditEntry));
    }
    
    // TODO: Send to audit logging service or database
  } catch (err) {
    console.error('[FeatureAudit] Failed to log:', err.message);
  }
}

/**
 * Middleware: Block HTML pages based on feature
 * For protecting web pages (not API endpoints)
 */
export function requireFeatureForPage(feature) {
  return async (req, res, next) => {
    // Development/demo mode - bypass
    if (process.env.NODE_ENV === 'development' || process.env.DEMO_MODE === 'true') {
      return next();
    }
    
    try {
      const enabled = await hasFeature(feature);
      
      if (!enabled) {
        const licenseInfo = await getLicenseInfo();
        
        // Audit log
        await auditFeatureAccess(feature, req, false);
        
        // Redirect to upgrade page or show error
        return res.status(403).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Feature Not Available</title>
            <style>
              body { font-family: system-ui; max-width: 600px; margin: 100px auto; padding: 20px; }
              .error { background: #fee; border: 2px solid #c33; padding: 20px; border-radius: 8px; }
              h1 { color: #c33; }
              .tier { background: #f8f8f8; padding: 10px; border-radius: 4px; margin: 10px 0; }
            </style>
          </head>
          <body>
            <div class="error">
              <h1>⚠️ Feature Not Available</h1>
              <p>The <strong>${FEATURE_DEFINITIONS[feature]?.name || feature}</strong> feature is not available in your current license tier.</p>
              <div class="tier">
                <strong>Current Tier:</strong> ${licenseInfo?.tier || 'Unknown'}<br>
                <strong>Farm ID:</strong> ${licenseInfo?.farmId || 'Unknown'}
              </div>
              <p>Contact <a href="mailto:sales@greenreach.io">sales@greenreach.io</a> to upgrade your license.</p>
            </div>
          </body>
          </html>
        `);
      }
      
      // Audit log granted access
      await auditFeatureAccess(feature, req, true);
      next();
    } catch (err) {
      console.error('[FeatureFlags] Page protection error:', err.message);
      return res.status(500).send('License validation failed');
    }
  };
}

export default {
  requireFeature,
  autoEnforceFeatures,
  isFeatureEnabled,
  getAvailableFeatures,
  getDeploymentMode,
  auditFeatureAccess,
  requireFeatureForPage,
  FEATURE_DEFINITIONS,
  ENDPOINT_FEATURES,
};
