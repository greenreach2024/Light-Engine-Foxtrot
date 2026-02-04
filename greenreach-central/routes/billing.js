/**
 * Billing Routes (Cloud)
 * Provides usage/limits endpoints for farm admin UI
 */
import express from 'express';

const router = express.Router();

/**
 * GET /api/billing/usage/:farmId
 * Return usage and limits (cloud)
 */
router.get('/usage/:farmId', async (req, res) => {
  const { farmId } = req.params;

  if (!farmId) {
    return res.status(400).json({
      status: 'error',
      message: 'Farm ID required'
    });
  }

  return res.json({
    status: 'unavailable',
    dataAvailable: false,
    plan: null,
    limits: {
      devices: null,
      api_calls_per_day: null,
      storage_gb: null
    },
    usage: {
      devices: null,
      api_calls_today: null,
      storage_gb: null
    },
    renewsAt: null,
    overages: {
      devices: null,
      api_calls: null,
      storage: null
    }
  });
});

export default router;
