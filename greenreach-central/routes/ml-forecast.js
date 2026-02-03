/**
 * ML Temperature Forecast Proxy Route
 * 
 * Temperature forecasting runs on edge devices (server-foxtrot.js).
 * This route either:
 * 1. Returns "feature not available" for cloud-only deployments
 * 2. Proxies requests to the appropriate edge farm device
 * 
 * Endpoint: GET /api/ml/insights/forecast/:zone
 */

import express from 'express';
const router = express.Router();

// Check if edge forecast endpoint is configured
const EDGE_FORECAST_ENABLED = process.env.ML_FORECAST_ENABLED === 'true' || false;
const EDGE_DEVICE_URL = process.env.FOXTROT_ENDPOINT_URL || process.env.EDGE_DEVICE_URL || null;

/**
 * GET /api/ml/insights/forecast/:zone
 * 
 * Returns 4-hour temperature predictions for a specific zone
 * 
 * Cloud-only mode: Returns 403 feature not available
 * Edge-connected mode: Proxies to edge device
 */
router.get('/forecast/:zone', async (req, res) => {
  const { zone } = req.params;
  
  // Feature not available in cloud-only deployments
  if (!EDGE_FORECAST_ENABLED || !EDGE_DEVICE_URL) {
    return res.status(403).json({
      ok: false,
      error: 'ML temperature forecasting is only available on edge devices with direct sensor access',
      message: 'This feature requires Light Engine edge device with environmental sensors',
      feature: 'ml_forecast',
      available: false
    });
  }
  
  try {
    // Proxy request to edge device
    const edgeUrl = `${EDGE_DEVICE_URL}/api/ml/insights/forecast/${encodeURIComponent(zone)}`;
    
    const response = await fetch(edgeUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'GreenReach-Central/1.0'
      },
      timeout: 10000 // 10 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`Edge device returned ${response.status}`);
    }
    
    const data = await response.json();
    
    // Forward edge response
    res.json(data);
    
  } catch (error) {
    console.error('[ML Forecast] Proxy error:', error.message);
    
    res.status(502).json({
      ok: false,
      error: 'Failed to reach edge device for temperature forecast',
      message: error.message,
      edge_url: EDGE_DEVICE_URL
    });
  }
});

export default router;
