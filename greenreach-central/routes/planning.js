import express from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import { getMarketDataAsync } from './market-intelligence.js';
import { getCropPricing } from './crop-pricing.js';
import { getLatestAnalyses } from '../services/market-analysis-agent.js';
import { analyzeDemandPatterns } from '../services/wholesaleMemoryStore.js';
import farmStore from '../lib/farm-data-store.js';
import logger from '../utils/logger.js';

const router = express.Router();

// ============================================================================
// Production Planning Endpoints (Real Implementation - Integrates Market Intelligence)
// ============================================================================

// Get capacity utilization metrics based on actual planting assignments
router.get('/capacity', async (req, res) => {
  try {
    // Get farm_id from query, session, or use 'demo-farm' as fallback
    const farm_id = req.query.farm_id || req.session?.farm_id || 'demo-farm';
    
    // Get current planting assignments
    let assignments = [];
    if (isDatabaseAvailable()) {
      try {
        const result = await query(
          'SELECT * FROM planting_assignments WHERE farm_id = $1',
          [farm_id]
        );
        assignments = result.rows || [];
      } catch (dbError) {
        logger.warn('[Planning] Database query failed, using empty assignments:', dbError.message);
      }
    }
    
    // Calculate capacity from actual farm groups
    const groups = await farmStore.get(farm_id, 'groups') || [];
    const totalCapacity = groups.reduce((sum, g) => {
      const trays = Number(g.trays) || (Array.isArray(g.trays) ? g.trays.length : 0) || Number(g.trayCount) || 0;
      return sum + trays;
    }, 0) || 0;
    const usedCapacity = assignments.length;
    const availableCapacity = Math.max(0, totalCapacity - usedCapacity);
    const utilizationPercent = totalCapacity > 0 ? (usedCapacity / totalCapacity) * 100 : 0;
    
    return res.json({
      success: true,
      data: {
        farmId: farm_id,
        totalCapacity,
        usedCapacity,
        availableCapacity,
        utilizationPercent: Math.round(utilizationPercent * 100) / 100,
        assignments: assignments.length
      }
    });
  } catch (error) {
    logger.error('[Planning] Capacity calculation error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to calculate capacity'
    });
  }
});

// Get demand forecast based on market intelligence + historical trends
router.get('/demand-forecast', async (req, res) => {
  try {
    const horizon = req.query.horizon || 'MONTHLY';
    const farm_id = req.query.farm_id || req.session?.farm_id || 'demo-farm';
    const pool = req.app?.locals?.dbPool || null;
    const marketData = await getMarketDataAsync(pool);
    const cropPricing = await getCropPricing();

    // Fetch AI analysis + wholesale demand signals (non-blocking)
    let aiAnalyses = [];
    let demandSignals = {};
    try { aiAnalyses = pool ? await getLatestAnalyses(pool) : []; } catch { /* ok */ }
    try { demandSignals = await analyzeDemandPatterns() || {}; } catch { /* ok */ }

    const aiMap = {};
    for (const a of aiAnalyses) aiMap[a.product] = a;

    // Generate forecast based on market trends — expressed as percentage signals
    const forecast = [];
    
    for (const [product, data] of Object.entries(marketData)) {
      const pricingMatch = cropPricing.find(c => 
        c.crop.toLowerCase().includes(product.toLowerCase()) ||
        product.toLowerCase().includes(c.crop.toLowerCase().split(' ')[0])
      );

      const ai = aiMap[product] || null;
      const demand = demandSignals[product] || null;

      // Confidence: prefer AI confidence, fall back to observation count
      let confidence = 'medium';
      if (ai?.confidence) {
        confidence = ai.confidence;
      } else if (data.observationCount >= 20) {
        confidence = 'high';
      } else if ((data.observationCount || 0) < 5) {
        confidence = 'low';
      }

      forecast.push({
        product,
        trendPercent: data.trendPercent,
        trend: data.trend,
        confidence,
        reasoning: ai?.reasoning || `Market trend: ${data.trend}`,
        pricePerUnit: pricingMatch?.wholesalePrice || null,
        priceCAD: data.avgPriceCAD || null,
        // AI enrichment
        aiOutlook: ai?.outlook || null,
        aiAction: ai?.action || null,
        aiForecastPrice: ai?.price_forecast ? parseFloat(ai.price_forecast) : null,
        // Wholesale demand
        wholesaleDemand: demand ? {
          totalQty: demand.network_total_qty,
          orderCount: demand.network_order_count,
          trend: demand.network_trend,
        } : null,
        dataSource: data.dataSource || 'hardcoded',
        dataFreshness: data.lastUpdated || null,
      });
    }
    
    // Average trend across all tracked crops (percentage)
    const averageTrend = forecast.length > 0
      ? Math.round((forecast.reduce((s, f) => s + f.trendPercent, 0) / forecast.length) * 10) / 10
      : 0;
    
    return res.json({
      success: true,
      data: {
        horizon,
        farmId: farm_id,
        forecast: forecast.sort((a, b) => Math.abs(b.trendPercent) - Math.abs(a.trendPercent)),
        averageTrend,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('[Planning] Demand forecast error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate demand forecast'
    });
  }
});

// Get production planning recommendations (integrates market + capacity + assignments)
router.get('/recommendations', async (req, res) => {
  try {
    const farm_id = req.query.farm_id || req.session?.farm_id || 'demo-farm';
    
    // Get market data and current assignments
    const pool = req.app?.locals?.dbPool || null;
    const marketData = await getMarketDataAsync(pool);
    const cropPricing = await getCropPricing();
    
    let currentAssignments = [];
    if (isDatabaseAvailable()) {
      try {
        const result = await query(
          'SELECT crop_sku, COUNT(*) as count FROM planting_assignments WHERE farm_id = $1 GROUP BY crop_sku',
          [farm_id]
        );
        currentAssignments = result.rows || [];
      } catch (dbError) {
        logger.warn('[Planning] Database query failed, using empty assignments:', dbError.message);
      }
    }
    
    // Generate recommendations based on market opportunities + farm diversity + AI signals
    let aiAnalyses = [];
    try { aiAnalyses = pool ? await getLatestAnalyses(pool) : []; } catch { /* ok */ }
    const aiMap = {};
    for (const a of aiAnalyses) aiMap[a.product] = a;

    const recommendations = [];
    
    for (const [product, data] of Object.entries(marketData)) {
      const ai = aiMap[product] || null;
      // Include crops with strong upward trend OR AI says "increase_production" / "bullish"
      const strongTrend = data.trend === 'increasing' && Math.abs(data.trendPercent) >= 10;
      const aiBullish = ai?.outlook === 'bullish' || ai?.action === 'increase_production';
      if (!strongTrend && !aiBullish) continue;
      
      const pricingMatch = cropPricing.find(c => 
        c.crop.toLowerCase().includes(product.toLowerCase()) ||
        product.toLowerCase().includes(c.crop.toLowerCase().split(' ')[0])
      );
      
      if (!pricingMatch) continue;
      
      const currentCount = currentAssignments.find(a => a.crop_sku === pricingMatch.crop)?.count || 0;
      const isPriority = currentCount === 0; // Prioritize crops not currently growing
      
      recommendations.push({
        crop: pricingMatch.crop,
        priority: isPriority ? 'high' : 'medium',
        reasoning: ai?.reasoning || `Market prices ${data.trendPercent > 0 ? 'up' : 'down'} ${Math.abs(data.trendPercent)}% — ${data.trend} trend`,
        marketTrend: data.trend,
        trendPercent: data.trendPercent,
        currentlyGrowing: currentCount,
        projectedRevenue: pricingMatch.wholesalePrice * 100,
        confidence: ai?.confidence || (data.observationCount >= 10 ? 'high' : 'medium'),
        aiOutlook: ai?.outlook || null,
        aiAction: ai?.action || null,
      });
    }
    
    return res.json({
      success: true,
      data: {
        farmId: farm_id,
        recommendations: recommendations.sort((a, b) => {
          if (a.priority !== b.priority) return a.priority === 'high' ? -1 : 1;
          return b.trendPercent - a.trendPercent;
        }),
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('[Planning] Recommendations error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate recommendations'
    });
  }
});

// Production plan CRUD stubs removed — Production Planning UI consolidated into Planting Scheduler.
// Useful routes kept: /capacity, /demand-forecast, /recommendations

export default router;
