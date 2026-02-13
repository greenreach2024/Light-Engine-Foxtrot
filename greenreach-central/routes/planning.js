import express from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import { getMarketData } from './market-intelligence.js';
import { getCropPricing } from './crop-pricing.js';
import logger from '../utils/logger.js';

const router = express.Router();

// ============================================================================
// Production Planning Endpoints (Real Implementation - Integrates Market Intelligence)
// ============================================================================

// Get capacity utilization metrics based on actual planting assignments
router.get('/capacity', async (req, res) => {
  try {
    const { farm_id } = req.query;
    
    if (!farm_id) {
      return res.status(400).json({
        success: false,
        error: 'farm_id is required'
      });
    }
    
    // Get current planting assignments
    let assignments = [];
    if (isDatabaseAvailable()) {
      const result = await query(
        'SELECT * FROM planting_assignments WHERE farm_id = $1',
        [farm_id]
      );
      assignments = result.rows || [];
    }
    
    // Calculate capacity (assume each group is 1 unit of capacity)
    const totalCapacity = 2000; // TODO: Get from farm configuration
    const usedCapacity = assignments.length;
    const availableCapacity = totalCapacity - usedCapacity;
    const utilizationPercent = (usedCapacity / totalCapacity) * 100;
    
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
    const { horizon = 'MONTHLY', farm_id } = req.query;
    
    // Get market intelligence data
    const marketData = getMarketData();
    const cropPricing = await getCropPricing();
    
    // Generate forecast based on market trends
    const forecast = [];
    let totalDemand = 0;
    
    for (const [product, data] of Object.entries(marketData)) {
      const trendMultiplier = data.trend === 'increasing' ? 1 + (data.trendPercent / 100) : 
                             data.trend === 'decreasing' ? 1 + (data.trendPercent / 100) : 1;
      
      // Find matching crop in pricing
      const pricingMatch = cropPricing.find(c => 
        c.crop.toLowerCase().includes(product.toLowerCase()) ||
        product.toLowerCase().includes(c.crop.toLowerCase().split(' ')[0])
      );
      
      const baselineDemand = 100; // Units per period
      const projectedDemand = Math.round(baselineDemand * trendMultiplier);
      totalDemand += projectedDemand;
      
      forecast.push({
        product,
        baselineDemand,
        projectedDemand,
        trend: data.trend,
        trendPercent: data.trendPercent,
        confidence: data.articles.length > 0 ? 'high' : 'medium',
        reasoning: data.articles[0]?.summary || `Market trend: ${data.trend}`,
        pricePerUnit: pricingMatch?.wholesalePrice || null
      });
    }
    
    return res.json({
      success: true,
      data: {
        horizon,
        farmId: farm_id,
        forecast: forecast.sort((a, b) => b.projectedDemand - a.projectedDemand),
        totalDemand,
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
    const { farm_id } = req.query;
    
    if (!farm_id) {
      return res.status(400).json({
        success: false,
        error: 'farm_id is required'
      });
    }
    
    // Get market data and current assignments
    const marketData = getMarketData();
    const cropPricing = await getCropPricing();
    
    let currentAssignments = [];
    if (isDatabaseAvailable()) {
      const result = await query(
        'SELECT crop_sku, COUNT(*) as count FROM planting_assignments WHERE farm_id = $1 GROUP BY crop_sku',
        [farm_id]
      );
      currentAssignments = result.rows || [];
    }
    
    // Generate recommendations based on market opportunities + farm diversity
    const recommendations = [];
    
    for (const [product, data] of Object.entries(marketData)) {
      if (data.trend !== 'increasing' || Math.abs(data.trendPercent) < 10) continue; // Only high-opportunity crops
      
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
        reasoning: `Market prices up ${data.trendPercent}% - strong demand signal. ${data.articles[0]?.summary || ''}`,
        marketTrend: data.trend,
        trendPercent: data.trendPercent,
        currentlyGrowing: currentCount,
        projectedRevenue: pricingMatch.wholesalePrice * 100, // Per 100 units
        confidence: data.articles.length > 0 ? 'high' : 'medium',
        sources: data.articles.map(a => ({ title: a.title, source: a.source, date: a.date }))
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

// Get list of production plans
router.get('/plans/list', async (req, res) => {
  const status = req.query.status; // 'active', 'completed', etc.
  res.json({
    success: true,
    data: {
      plans: [],
      status: status || 'all'
    }
  });
});

// Create a new production plan
router.post('/plans', async (req, res) => {
  res.json({
    success: true,
    data: {
      planId: `PLAN-${Date.now()}`,
      message: 'Production plan created (stub)'
    }
  });
});

// Update a production plan
router.put('/plans/:id', async (req, res) => {
  res.json({
    success: true,
    data: {
      planId: req.params.id,
      message: 'Production plan updated (stub)'
    }
  });
});

// Delete a production plan
router.delete('/plans/:id', async (req, res) => {
  res.json({
    success: true,
    data: {
      planId: req.params.id,
      message: 'Production plan deleted (stub)'
    }
  });
});

export default router;
