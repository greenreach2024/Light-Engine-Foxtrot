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
    
    // Generate smart recommendations: market signal + margin + diversity + timing
    let aiAnalyses = [];
    try { aiAnalyses = pool ? await getLatestAnalyses(pool) : []; } catch { /* ok */ }
    const aiMap = {};
    for (const a of aiAnalyses) aiMap[a.product] = a;

    const totalAssigned = currentAssignments.reduce((sum, a) => sum + parseInt(a.count, 10), 0) || 1;
    const recommendations = [];
    
    for (const [product, data] of Object.entries(marketData)) {
      const ai = aiMap[product] || null;
      
      const pricingMatch = cropPricing.find(c => 
        c.crop.toLowerCase().includes(product.toLowerCase()) ||
        product.toLowerCase().includes(c.crop.toLowerCase().split(' ')[0])
      );
      
      if (!pricingMatch) continue;
      
      const currentCount = parseInt(currentAssignments.find(a => a.crop_sku === pricingMatch.crop)?.count || 0, 10);

      // --- Signal scores (0-100 each) ---

      // 1. Market trend signal
      let trendScore = 50; // neutral baseline
      if (data.trend === 'increasing') trendScore = 50 + Math.min(data.trendPercent, 50);
      else if (data.trend === 'decreasing') trendScore = Math.max(50 - Math.abs(data.trendPercent), 0);

      // 2. AI outlook signal
      let aiScore = 50;
      if (ai?.outlook === 'bullish') aiScore = 80;
      else if (ai?.outlook === 'bearish') aiScore = 20;
      if (ai?.action === 'increase_production') aiScore = Math.min(aiScore + 15, 100);
      else if (ai?.action === 'reduce_production') aiScore = Math.max(aiScore - 15, 0);

      // 3. Margin signal (wholesale price as proxy — higher is better)
      const marginScore = Math.min((pricingMatch.wholesalePrice || 0) / 15 * 100, 100);

      // 4. Diversity signal — favor under-represented or absent crops
      const cropShare = currentCount / totalAssigned;
      let diversityScore = 100; // not growing = maximum diversity value
      if (currentCount > 0) diversityScore = Math.max(100 - cropShare * 200, 10);

      // Composite score (weighted)
      const composite = Math.round(
        trendScore * 0.30 +
        aiScore * 0.25 +
        marginScore * 0.20 +
        diversityScore * 0.25
      );

      // Build reasoning
      const reasons = [];
      if (data.trend === 'increasing' && data.trendPercent >= 5)
        reasons.push(`prices up ${data.trendPercent}%`);
      if (ai?.outlook === 'bullish')
        reasons.push('AI outlook bullish');
      if (ai?.action === 'increase_production')
        reasons.push('AI recommends increasing production');
      if (currentCount === 0)
        reasons.push('not currently growing — diversification opportunity');
      else if (cropShare > 0.3)
        reasons.push(`${Math.round(cropShare * 100)}% of capacity — over-concentrated`);
      if (pricingMatch.wholesalePrice >= 10)
        reasons.push(`strong margin ($${pricingMatch.wholesalePrice}/unit)`);
      
      const reasoning = ai?.reasoning || reasons.join('; ') || `Composite score ${composite}`;

      const priority = composite >= 70 ? 'high' : composite >= 45 ? 'medium' : 'low';
      
      recommendations.push({
        crop: pricingMatch.crop,
        priority,
        score: composite,
        reasoning,
        marketTrend: data.trend,
        trendPercent: data.trendPercent,
        currentlyGrowing: currentCount,
        diversityShare: Math.round(cropShare * 100),
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
        recommendations: recommendations.sort((a, b) => b.score - a.score),
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
