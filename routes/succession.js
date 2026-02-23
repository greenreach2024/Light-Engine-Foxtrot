// routes/succession.js (ESM)
// P4: Succession Planner API routes
// Wraps lib/succession-planner.js methods as REST endpoints

import { Router } from 'express';

/**
 * Mount succession planner routes on an Express app/router.
 * @param {import('express').Express} app
 * @param {import('../lib/succession-planner.js').SuccessionPlanner} planner
 */
export function mountSuccessionRoutes(app, planner) {
  const router = Router();

  // POST /api/succession/schedule — Generate a succession planting schedule
  router.post('/schedule', async (req, res) => {
    try {
      const { crop, weeklyDemand, startDate, weeks, successionGap, facility } = req.body;
      if (!crop || !weeklyDemand || !startDate) {
        return res.status(400).json({ ok: false, error: 'Missing required fields: crop, weeklyDemand, startDate' });
      }
      const result = await planner.generateSchedule({ crop, weeklyDemand, startDate, weeks, successionGap, facility });
      res.json(result);
    } catch (error) {
      console.error('[succession/schedule] Error:', error.message);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // GET /api/succession/duration/:crop — Get growth duration for a crop
  router.get('/duration/:crop', async (req, res) => {
    try {
      const duration = await planner.getGrowthDuration(req.params.crop);
      res.json({ ok: true, crop: req.params.crop, growthDays: duration });
    } catch (error) {
      console.error('[succession/duration] Error:', error.message);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // POST /api/succession/suggest — Suggest plantings from demand forecast
  router.post('/suggest', async (req, res) => {
    try {
      const { demandForecast, farmId, facility, requestAI } = req.body;
      if (!demandForecast || !Array.isArray(demandForecast)) {
        return res.status(400).json({ ok: false, error: 'Missing or invalid demandForecast array' });
      }
      const result = await planner.suggestFromDemand({ demandForecast, farmId, facility, requestAI });
      res.json(result);
    } catch (error) {
      console.error('[succession/suggest] Error:', error.message);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // POST /api/succession/optimize — Request AI optimization from Central
  router.post('/optimize', async (req, res) => {
    try {
      const { farmId, suggestions } = req.body;
      if (!farmId) {
        return res.status(400).json({ ok: false, error: 'Missing required field: farmId' });
      }
      const result = await planner.requestAIOptimization(farmId, suggestions || []);
      res.json({ ok: true, ...result });
    } catch (error) {
      console.error('[succession/optimize] Error:', error.message);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // GET /api/succession/forecast/:crop — Get harvest forecast for a crop
  router.get('/forecast/:crop', async (req, res) => {
    try {
      const weeks = parseInt(req.query.weeks) || 12;
      const forecast = await planner.getHarvestForecast(req.params.crop, weeks);
      res.json({ ok: true, crop: req.params.crop, weeks, forecast });
    } catch (error) {
      console.error('[succession/forecast] Error:', error.message);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // GET /api/succession/gaps/:crop — Detect inventory gaps for a crop
  router.get('/gaps/:crop', async (req, res) => {
    try {
      const targetRate = parseFloat(req.query.targetRate) || 0.99;
      const gaps = await planner.detectInventoryGaps(req.params.crop, targetRate);
      res.json({ ok: true, ...gaps });
    } catch (error) {
      console.error('[succession/gaps] Error:', error.message);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // GET /api/succession/strategy/:crop — Get harvest strategy (CCA info) for a crop
  router.get('/strategy/:crop', (req, res) => {
    try {
      const strategy = planner.getHarvestStrategy(req.params.crop);
      res.json({ ok: true, crop: req.params.crop, strategy: strategy || { strategy: 'single_harvest', maxHarvests: 1 } });
    } catch (error) {
      console.error('[succession/strategy] Error:', error.message);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.use('/api/succession', router);
  console.log('[P4] Succession planner routes mounted at /api/succession');
}
