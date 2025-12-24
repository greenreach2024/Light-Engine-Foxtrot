/**
 * License validation routes
 * GET /api/license - Get license info (sanitized)
 * POST /api/license/validate - Force license validation
 */

import express from 'express';
import { validateLicense, getLicenseInfo, hasFeature, getLicenseTier } from '../lib/license-manager.js';
import { getAvailableFeatures } from '../server/middleware/feature-flags.js';

const router = express.Router();

/**
 * GET /api/license
 * Get current license information (safe for display)
 */
router.get('/license', async (req, res) => {
  try {
    const info = await getLicenseInfo();
    
    if (!info) {
      return res.json({
        ok: false,
        licensed: false,
        message: 'No license installed',
      });
    }

    res.json({
      ok: true,
      licensed: true,
      license: info,
    });
  } catch (err) {
    console.error('[License API] Error:', err);
    res.status(500).json({
      ok: false,
      error: 'Failed to retrieve license information',
    });
  }
});

/**
 * POST /api/license/validate
 * Force license validation (admin only)
 */
router.post('/license/validate', async (req, res) => {
  try {
    const result = await validateLicense();
    
    res.json({
      ok: result.valid,
      valid: result.valid,
      reason: result.reason,
      license: result.license ? {
        farmId: result.license.farmId,
        tier: result.license.tier,
        expiresAt: result.license.expiresAt,
      } : null,
    });
  } catch (err) {
    console.error('[License API] Validation error:', err);
    res.status(500).json({
      ok: false,
      error: 'License validation failed',
    });
  }
});

/**
 * GET /api/license/features
 * Get available features for current license
 */
router.get('/license/features', async (req, res) => {
  try {
    const features = await getAvailableFeatures();
    const info = await getLicenseInfo();
    
    res.json({
      ok: true,
      tier: info?.tier || 'inventory-only',
      features,
    });
  } catch (err) {
    console.error('[License API] Error:', err);
    res.status(500).json({
      ok: false,
      error: 'Failed to retrieve features',
    });
  }
});

/**
 * GET /api/license/check/:feature
 * Check if a specific feature is enabled
 */
router.get('/license/check/:feature', async (req, res) => {
  try {
    const { feature } = req.params;
    const enabled = await hasFeature(feature);
    
    res.json({
      ok: true,
      feature,
      enabled,
    });
  } catch (err) {
    console.error('[License API] Error:', err);
    res.status(500).json({
      ok: false,
      error: 'Failed to check feature',
    });
  }
});

export default router;
