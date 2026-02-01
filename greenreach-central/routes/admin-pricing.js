/**
 * P5 Wholesale Pricing Authority - Admin Routes
 * GreenReach Central Admin API for managing wholesale marketplace pricing
 * 
 * Architecture: Central sets prices → Farms accept/reject
 * Created: January 31, 2026
 */

import express from 'express';
import { query } from '../config/database.js';

const router = express.Router();

/**
 * Generate unique offer ID
 * Format: OFFER-YYYYMMDD-CROP-RAND
 */
function generateOfferId(crop) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const cropCode = crop.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `OFFER-${date}-${cropCode}-${random}`;
}

/**
 * Calculate acceptance rate for an offer
 */
async function getOfferAcceptanceStats(offerId) {
  const result = await query(`
    SELECT
      COUNT(*) as total_responses,
      COUNT(*) FILTER (WHERE response = 'accept') as accepted,
      COUNT(*) FILTER (WHERE response = 'reject') as rejected,
      COUNT(*) FILTER (WHERE response = 'counter') as countered,
      AVG(counter_price) FILTER (WHERE response = 'counter') as avg_counter_price,
      CASE
        WHEN COUNT(*) = 0 THEN NULL
        ELSE COUNT(*) FILTER (WHERE response = 'accept')::DECIMAL / COUNT(*)
      END as acceptance_rate
    FROM pricing_responses
    WHERE offer_id = $1
  `, [offerId]);
  
  return result.rows[0];
}

/**
 * Get maximum farm cost for a crop (for cost-basis protection)
 */
async function getMaxFarmCost(crop) {
  const result = await query(`
    SELECT MAX(cost_per_unit) as max_cost, unit
    FROM farm_cost_surveys
    WHERE crop = $1
      AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
    GROUP BY unit
    ORDER BY max_cost DESC
    LIMIT 1
  `, [crop]);
  
  if (result.rows.length === 0) {
    console.warn(`[Pricing Authority] No cost survey data for ${crop} - cannot enforce cost-basis protection`);
    return null;
  }
  
  return result.rows[0];
}

// ==============================================================================
// Farm Cost Surveys Endpoints (BLOCKING CONDITION #1)
// ==============================================================================

/**
 * GET /api/admin/pricing/cost-surveys
 * Get all farm cost surveys (for cost-basis pricing protection)
 */
router.get('/cost-surveys', async (req, res) => {
  try {
    const { farm_id, crop, valid_only = 'true' } = req.query;
    
    let sqlQuery = 'SELECT * FROM farm_cost_surveys WHERE 1=1';
    const params = [];
    let paramCount = 0;
    
    if (farm_id) {
      paramCount++;
      sqlQuery += ` AND farm_id = $${paramCount}`;
      params.push(farm_id);
    }
    
    if (crop) {
      paramCount++;
      sqlQuery += ` AND crop = $${paramCount}`;
      params.push(crop);
    }
    
    if (valid_only === 'true') {
      sqlQuery += ` AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)`;
    }
    
    sqlQuery += ` ORDER BY farm_id, crop, survey_date DESC`;
    
    const result = await query(sqlQuery, params);
    
    res.json({
      success: true,
      cost_surveys: result.rows
    });
  } catch (error) {
    console.error('[Admin Pricing API] Error fetching cost surveys:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cost surveys',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/pricing/cost-surveys/farm/:farmId
 * Get cost survey data for a specific farm
 */
router.get('/cost-surveys/farm/:farmId', async (req, res) => {
  try {
    const { farmId } = req.params;
    
    const result = await query(`
      SELECT * FROM farm_cost_surveys
      WHERE farm_id = $1
        AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
      ORDER BY crop, survey_date DESC
    `, [farmId]);
    
    res.json({
      success: true,
      farm_id: farmId,
      cost_surveys: result.rows
    });
  } catch (error) {
    console.error('[Admin Pricing API] Error fetching farm cost surveys:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch farm cost surveys',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/pricing/cost-surveys
 * Create or update farm cost survey
 */
router.post('/cost-surveys', async (req, res) => {
  try {
    const { farm_id, crop, cost_per_unit, unit = 'lb', cost_breakdown, valid_until, notes } = req.body;
    
    if (!farm_id || !crop || !cost_per_unit) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: farm_id, crop, cost_per_unit'
      });
    }
    
    const survey_date = new Date().toISOString().split('T')[0];
    
    const result = await query(`
      INSERT INTO farm_cost_surveys (
        farm_id, crop, cost_per_unit, unit, cost_breakdown, survey_date, valid_until, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (farm_id, crop, survey_date)
      DO UPDATE SET
        cost_per_unit = EXCLUDED.cost_per_unit,
        unit = EXCLUDED.unit,
        cost_breakdown = EXCLUDED.cost_breakdown,
        valid_until = EXCLUDED.valid_until,
        notes = EXCLUDED.notes,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [farm_id, crop, cost_per_unit, unit, cost_breakdown, survey_date, valid_until, notes]);
    
    res.json({
      success: true,
      cost_survey: result.rows[0]
    });
  } catch (error) {
    console.error('[Admin Pricing API] Error creating cost survey:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create cost survey',
      message: error.message
    });
  }
});

// ==============================================================================
// Pricing Offers Endpoints
// ==============================================================================

/**
 * POST /api/admin/pricing/set-wholesale
 * Set wholesale price for a crop (Central authority)
 * BLOCKING CONDITION #1: Enforces cost-basis protection (price >= max_cost * 1.20)
 */
router.post('/set-wholesale', async (req, res) => {
  try {
    const {
      crop,
      wholesale_price,
      unit = 'lb',
      reasoning,
      confidence,
      predicted_acceptance,
      effective_date,
      expires_in_days = 14,
      tier = 'demand-based'
    } = req.body;
    
    if (!crop || !wholesale_price) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: crop, wholesale_price'
      });
    }
    
    // BLOCKING CONDITION #1: Cost-basis protection
    const costData = await getMaxFarmCost(crop);
    if (costData) {
      const minPrice = costData.max_cost * 1.20; // Cost + 20% margin
      if (wholesale_price < minPrice) {
        return res.status(400).json({
          success: false,
          error: 'Price below cost basis',
          message: `Wholesale price $${wholesale_price} is below minimum $${minPrice.toFixed(2)} (highest farm cost $${costData.max_cost} + 20% margin)`,
          min_price: minPrice,
          max_farm_cost: costData.max_cost
        });
      }
    } else {
      console.warn(`[Pricing Authority] No cost data for ${crop} - proceeding without cost protection`);
    }
    
    const offer_id = generateOfferId(crop);
    const expires_at = new Date();
    expires_at.setDate(expires_at.getDate() + expires_in_days);
    
    const created_by = req.admin?.email || 'admin';
    
    const result = await query(`
      INSERT INTO pricing_offers (
        offer_id, crop, wholesale_price, unit, reasoning, confidence,
        predicted_acceptance, effective_date, expires_at, status,
        created_by, tier
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10, $11)
      RETURNING *
    `, [
      offer_id, crop, wholesale_price, unit, reasoning, confidence,
      predicted_acceptance, effective_date, expires_at, created_by, tier
    ]);
    
    // Get list of farms that grow this crop (to send offers to)
    const farmsResult = await query(`
      SELECT DISTINCT farm_id
      FROM farm_inventory
      WHERE product_name ILIKE $1 OR sku ILIKE $1
        AND available_for_wholesale = true
    `, [`%${crop}%`]);
    
    const farms_count = farmsResult.rows.length;
    
    res.json({
      success: true,
      offer: result.rows[0],
      farms_notified: farms_count,
      message: `Price offer sent to ${farms_count} farms growing ${crop}`
    });
  } catch (error) {
    console.error('[Admin Pricing API] Error setting wholesale price:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to set wholesale price',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/pricing/offers
 * Get all pricing offers
 */
router.get('/offers', async (req, res) => {
  try {
    const { status, crop, page = 1, limit = 50 } = req.query;
    
    let sqlQuery = 'SELECT * FROM pricing_offers WHERE 1=1';
    const params = [];
    let paramCount = 0;
    
    if (status) {
      paramCount++;
      sqlQuery += ` AND status = $${paramCount}`;
      params.push(status);
    }
    
    if (crop) {
      paramCount++;
      sqlQuery += ` AND crop ILIKE $${paramCount}`;
      params.push(`%${crop}%`);
    }
    
    sqlQuery += ` ORDER BY offer_date DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(parseInt(limit));
    params.push((parseInt(page) - 1) * parseInt(limit));
    
    const result = await query(sqlQuery, params);
    
    // Get acceptance stats for each offer
    const offersWithStats = await Promise.all(
      result.rows.map(async (offer) => {
        const stats = await getOfferAcceptanceStats(offer.offer_id);
        return {
          ...offer,
          response_stats: stats
        };
      })
    );
    
    res.json({
      success: true,
      offers: offersWithStats
    });
  } catch (error) {
    console.error('[Admin Pricing API] Error fetching offers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch offers',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/pricing/offers/:offerId
 * Get specific offer with detailed response data
 */
router.get('/offers/:offerId', async (req, res) => {
  try {
    const { offerId } = req.params;
    
    const offerResult = await query(`
      SELECT * FROM pricing_offers WHERE offer_id = $1
    `, [offerId]);
    
    if (offerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Offer not found'
      });
    }
    
    const offer = offerResult.rows[0];
    const stats = await getOfferAcceptanceStats(offerId);
    
    res.json({
      success: true,
      offer: {
        ...offer,
        response_stats: stats
      }
    });
  } catch (error) {
    console.error('[Admin Pricing API] Error fetching offer:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch offer',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/pricing/offers/:offerId/responses
 * Get all farm responses for an offer (BLOCKING CONDITION #2: includes counter-offers)
 */
router.get('/offers/:offerId/responses', async (req, res) => {
  try {
    const { offerId } = req.params;
    
    const result = await query(`
      SELECT
        pr.*,
        f.name as farm_name,
        fcs.cost_per_unit as farm_cost
      FROM pricing_responses pr
      LEFT JOIN farms f ON pr.farm_id = f.farm_id
      LEFT JOIN farm_cost_surveys fcs ON pr.farm_id = fcs.farm_id
        AND fcs.crop = (SELECT crop FROM pricing_offers WHERE offer_id = $1)
        AND (fcs.valid_until IS NULL OR fcs.valid_until >= CURRENT_DATE)
      WHERE pr.offer_id = $1
      ORDER BY pr.responded_at DESC
    `, [offerId]);
    
    const stats = await getOfferAcceptanceStats(offerId);
    
    // Generate recommendation if counter-offers exist
    let recommendation = null;
    const counterOffers = result.rows.filter(r => r.response === 'counter');
    if (counterOffers.length > 0) {
      const avgCounter = counterOffers.reduce((sum, r) => sum + parseFloat(r.counter_price), 0) / counterOffers.length;
      const offerResult = await query('SELECT wholesale_price FROM pricing_offers WHERE offer_id = $1', [offerId]);
      const currentPrice = offerResult.rows[0].wholesale_price;
      
      recommendation = {
        suggested_price: Math.round(avgCounter * 100) / 100,
        reason: `Average of ${counterOffers.length} counter-offers`,
        price_increase: Math.round((avgCounter - currentPrice) * 100) / 100,
        predicted_acceptance: Math.min(0.95, stats.acceptance_rate + 0.15)  // Estimate improvement
      };
    }
    
    res.json({
      success: true,
      offer_id: offerId,
      responses: result.rows,
      stats: stats,
      recommendation: recommendation
    });
  } catch (error) {
    console.error('[Admin Pricing API] Error fetching offer responses:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch offer responses',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/pricing/offers/:offerId/counter-offers
 * Get counter-offers for review (BLOCKING CONDITION #2)
 */
router.get('/offers/:offerId/counter-offers', async (req, res) => {
  try {
    const { offerId } = req.params;
    
    const result = await query(`
      SELECT
        pr.*,
        f.name as farm_name,
        fcs.cost_per_unit as farm_cost
      FROM pricing_responses pr
      LEFT JOIN farms f ON pr.farm_id = f.farm_id
      LEFT JOIN farm_cost_surveys fcs ON pr.farm_id = fcs.farm_id
        AND fcs.crop = (SELECT crop FROM pricing_offers WHERE offer_id = $1)
        AND (fcs.valid_until IS NULL OR fcs.valid_until >= CURRENT_DATE)
      WHERE pr.offer_id = $1
        AND pr.response = 'counter'
      ORDER BY pr.counter_price DESC
    `, [offerId]);
    
    if (result.rows.length === 0) {
      return res.json({
        success: true,
        offer_id: offerId,
        counter_offers: [],
        message: 'No counter-offers received'
      });
    }
    
    // Calculate recommendation
    const avgCounter = result.rows.reduce((sum, r) => sum + parseFloat(r.counter_price), 0) / result.rows.length;
    const offerResult = await query('SELECT wholesale_price, crop FROM pricing_offers WHERE offer_id = $1', [offerId]);
    const currentPrice = parseFloat(offerResult.rows[0].wholesale_price);
    const crop = offerResult.rows[0].crop;
    
    const stats = await getOfferAcceptanceStats(offerId);
    
    res.json({
      success: true,
      offer_id: offerId,
      current_price: currentPrice,
      crop: crop,
      counter_offers: result.rows,
      analysis: {
        total_counter_offers: result.rows.length,
        avg_counter_price: Math.round(avgCounter * 100) / 100,
        min_counter_price: Math.min(...result.rows.map(r => parseFloat(r.counter_price))),
        max_counter_price: Math.max(...result.rows.map(r => parseFloat(r.counter_price))),
        current_acceptance_rate: stats.acceptance_rate
      },
      recommendation: {
        suggested_price: Math.round(avgCounter * 100) / 100,
        reason: `Average of ${result.rows.length} counter-offers`,
        price_increase_pct: Math.round(((avgCounter - currentPrice) / currentPrice) * 100),
        predicted_acceptance: Math.min(0.85, (stats.acceptance_rate || 0) + 0.20)
      }
    });
  } catch (error) {
    console.error('[Admin Pricing API] Error fetching counter-offers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch counter-offers',
      message: error.message
    });
  }
});

/**
 * PUT /api/admin/pricing/offers/:offerId/cancel
 * Cancel a pricing offer
 */
router.put('/offers/:offerId/cancel', async (req, res) => {
  try {
    const { offerId } = req.params;
    const { reason } = req.body;
    
    const result = await query(`
      UPDATE pricing_offers
      SET status = 'cancelled',
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('cancel_reason', $2)
      WHERE offer_id = $1
      RETURNING *
    `, [offerId, reason || 'Admin cancellation']);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Offer not found'
      });
    }
    
    res.json({
      success: true,
      offer: result.rows[0]
    });
  } catch (error) {
    console.error('[Admin Pricing API] Error cancelling offer:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel offer',
      message: error.message
    });
  }
});

// ==============================================================================
// Pricing History & Analytics
// ==============================================================================

/**
 * GET /api/admin/pricing/history
 * Get pricing history (for AI learning and admin review)
 */
router.get('/history', async (req, res) => {
  try {
    const { crop, start_date, end_date, limit = 100 } = req.query;
    
    let sqlQuery = 'SELECT * FROM pricing_history WHERE 1=1';
    const params = [];
    let paramCount = 0;
    
    if (crop) {
      paramCount++;
      sqlQuery += ` AND crop ILIKE $${paramCount}`;
      params.push(`%${crop}%`);
    }
    
    if (start_date) {
      paramCount++;
      sqlQuery += ` AND offer_date >= $${paramCount}`;
      params.push(start_date);
    }
    
    if (end_date) {
      paramCount++;
      sqlQuery += ` AND offer_date <= $${paramCount}`;
      params.push(end_date);
    }
    
    sqlQuery += ` ORDER BY offer_date DESC LIMIT $${paramCount + 1}`;
    params.push(parseInt(limit));
    
    const result = await query(sqlQuery, params);
    
    res.json({
      success: true,
      history: result.rows
    });
  } catch (error) {
    console.error('[Admin Pricing API] Error fetching pricing history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch pricing history',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/pricing/analytics/acceptance-trends
 * Get acceptance rate trends (for monitoring BLOCKING CONDITION #3)
 */
router.get('/analytics/acceptance-trends', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    
    const result = await query(`
      SELECT
        DATE(offer_date) as date,
        COUNT(*) as total_offers,
        AVG(acceptance_rate) as avg_acceptance_rate,
        MIN(acceptance_rate) as min_acceptance_rate,
        MAX(acceptance_rate) as max_acceptance_rate,
        COUNT(*) FILTER (WHERE acceptance_rate < 0.50) as critical_offers,
        COUNT(*) FILTER (WHERE acceptance_rate < 0.60) as warning_offers
      FROM pricing_history
      WHERE offer_date >= CURRENT_DATE - $1::integer
      GROUP BY DATE(offer_date)
      ORDER BY date DESC
    `, [days]);
    
    // Check for rollback triggers (BLOCKING CONDITION #3)
    const recentOffers = await query(`
      SELECT
        po.offer_id,
        po.crop,
        po.wholesale_price,
        po.offer_date,
        COUNT(pr.response_id) as total_responses,
        COUNT(pr.response_id) FILTER (WHERE pr.response = 'accept') as accepted,
        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - po.offer_date))/3600 as hours_elapsed
      FROM pricing_offers po
      LEFT JOIN pricing_responses pr ON po.offer_id = pr.offer_id
      WHERE po.status = 'active'
        AND po.offer_date >= CURRENT_TIMESTAMP - INTERVAL '7 days'
      GROUP BY po.offer_id
      HAVING COUNT(pr.response_id) > 0
    `);
    
    const alerts = [];
    recentOffers.rows.forEach(offer => {
      const acceptanceRate = offer.accepted / offer.total_responses;
      
      // RED ALERT: <40% acceptance
      if (acceptanceRate < 0.40) {
        alerts.push({
          severity: 'CRITICAL',
          offer_id: offer.offer_id,
          crop: offer.crop,
          acceptance_rate: acceptanceRate,
          message: `EMERGENCY: ${offer.crop} acceptance ${Math.round(acceptanceRate * 100)}% - Consider rollback`
        });
      }
      // ORANGE ALERT: <50% acceptance for 48+ hours
      else if (acceptanceRate < 0.50 && offer.hours_elapsed > 48) {
        alerts.push({
          severity: 'HIGH',
          offer_id: offer.offer_id,
          crop: offer.crop,
          acceptance_rate: acceptanceRate,
          hours_elapsed: Math.round(offer.hours_elapsed),
          message: `URGENT: ${offer.crop} acceptance ${Math.round(acceptanceRate * 100)}% for ${Math.round(offer.hours_elapsed)} hours - Price adjustment needed`
        });
      }
      // YELLOW ALERT: <60% acceptance
      else if (acceptanceRate < 0.60) {
        alerts.push({
          severity: 'MEDIUM',
          offer_id: offer.offer_id,
          crop: offer.crop,
          acceptance_rate: acceptanceRate,
          message: `WARNING: ${offer.crop} acceptance ${Math.round(acceptanceRate * 100)}% - Monitor closely`
        });
      }
    });
    
    res.json({
      success: true,
      trends: result.rows,
      alerts: alerts,
      rollback_recommended: alerts.some(a => a.severity === 'CRITICAL')
    });
  } catch (error) {
    console.error('[Admin Pricing API] Error fetching acceptance trends:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch acceptance trends',
      message: error.message
    });
  }
});

export default router;
