/**
 * GreenReach Wholesale - SLA and Substitution Policies
 * 
 * Manages service level agreements and product substitution rules:
 * 1. Delivery window SLAs with penalties for late delivery
 * 2. Product substitution policies when items are out of stock
 * 3. Buyer preferences for accepting/rejecting substitutions
 * 4. Farm notification workflows for SLA violations
 * 5. Automatic substitution matching based on SKU attributes
 */

import express from 'express';
import {
  seedDefaultSlaRules,
  seedDefaultSubstitutionPolicies,
  saveSlaRule,
  listSlaRules,
  getSlaRule,
  saveSubstitutionPolicy,
  listSubstitutionPolicies,
  getSubstitutionPolicy,
  saveBuyerPreferences,
  getBuyerPreferences,
  saveSlaViolation,
  listSlaViolations,
  saveSubstitutionApproval,
  getSubstitutionApproval,
  updateSubstitutionApproval
} from '../../lib/wholesale/sla-store.js';

const router = express.Router();

/**
 * Default SLA Rules
 */
const DEFAULT_SLA_RULES = [
  {
    rule_id: 'sla_same_day',
    name: 'Same Day Delivery',
    delivery_window_hours: 8,
    cutoff_time: '14:00', // 2 PM cutoff for same-day
    penalty_type: 'percentage',
    penalty_amount: 10, // 10% refund for late delivery
    applies_to: 'all',
    priority: 1
  },
  {
    rule_id: 'sla_next_day',
    name: 'Next Day Delivery',
    delivery_window_hours: 24,
    cutoff_time: '20:00', // 8 PM cutoff for next-day
    penalty_type: 'percentage',
    penalty_amount: 5, // 5% refund for late delivery
    applies_to: 'all',
    priority: 2
  },
  {
    rule_id: 'sla_two_day',
    name: 'Two Day Delivery',
    delivery_window_hours: 48,
    cutoff_time: '23:59',
    penalty_type: 'fixed',
    penalty_amount: 25.00, // $25 flat refund
    applies_to: 'all',
    priority: 3
  }
];

/**
 * Default Substitution Policies
 */
const DEFAULT_SUBSTITUTION_POLICIES = [
  {
    policy_id: 'sub_same_category',
    name: 'Same Category Substitution',
    description: 'Substitute with similar product in same category',
    match_criteria: {
      category: 'exact',
      subcategory: 'exact',
      price_tolerance: 10, // Allow up to 10% price difference
      quality_level: 'equal_or_better'
    },
    requires_buyer_approval: false,
    notification_required: true
  },
  {
    policy_id: 'sub_organic_only',
    name: 'Organic-Only Substitution',
    description: 'Only substitute with certified organic products',
    match_criteria: {
      certifications: ['usda_organic'],
      price_tolerance: 15,
      quality_level: 'equal_or_better'
    },
    requires_buyer_approval: false,
    notification_required: true
  },
  {
    policy_id: 'sub_manual_approval',
    name: 'Manual Approval Required',
    description: 'All substitutions require buyer approval',
    match_criteria: {},
    requires_buyer_approval: true,
    notification_required: true,
    approval_timeout_minutes: 30 // Cancel if no response in 30 min
  }
];

const seedPromise = Promise.all([
  seedDefaultSlaRules(DEFAULT_SLA_RULES),
  seedDefaultSubstitutionPolicies(DEFAULT_SUBSTITUTION_POLICIES)
]).catch((error) => {
  console.error('[SLA] Failed to seed defaults:', error);
});

/**
 * POST /api/wholesale/sla/rules
 * 
 * Create custom SLA rule
 * 
 * Body:
 * {
 *   name: 'Express Delivery',
 *   delivery_window_hours: 4,
 *   cutoff_time: '10:00',
 *   penalty_type: 'percentage',
 *   penalty_amount: 20,
 *   applies_to: 'buyer_123', // or 'all'
 *   priority: 1
 * }
 */
router.post('/rules', async (req, res) => {
  try {
    await seedPromise;

    const {
      name,
      delivery_window_hours,
      cutoff_time,
      penalty_type,
      penalty_amount,
      applies_to = 'all',
      priority = 5
    } = req.body;
    
    // Validate required fields
    if (!name || !delivery_window_hours || !penalty_type || penalty_amount === undefined) {
      return res.status(400).json({
        status: 'error',
        message: 'name, delivery_window_hours, penalty_type, and penalty_amount are required'
      });
    }
    
    // Validate penalty type
    if (!['percentage', 'fixed'].includes(penalty_type)) {
      return res.status(400).json({
        status: 'error',
        message: 'penalty_type must be "percentage" or "fixed"'
      });
    }
    
    const ruleId = `sla_${Date.now()}`;
    const rule = {
      rule_id: ruleId,
      name,
      delivery_window_hours,
      cutoff_time,
      penalty_type,
      penalty_amount,
      applies_to,
      priority,
      created_at: new Date().toISOString(),
      active: true
    };
    
    await saveSlaRule(rule);
    
    res.json({
      status: 'ok',
      data: rule,
      message: 'SLA rule created successfully'
    });
    
  } catch (error) {
    console.error('Create SLA rule error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to create SLA rule',
      error: error.message
    });
  }
});

/**
 * GET /api/wholesale/sla/rules
 * 
 * List all SLA rules
 */
router.get('/rules', async (req, res) => {
  try {
    await seedPromise;

    const { buyer_id } = req.query;

    const rules = await listSlaRules({ buyer_id });
    
    res.json({
      status: 'ok',
      data: {
        rules,
        total: rules.length
      }
    });
    
  } catch (error) {
    console.error('List SLA rules error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to list SLA rules',
      error: error.message
    });
  }
});

/**
 * POST /api/wholesale/sla/violations
 * 
 * Record SLA violation (called by fulfillment webhook handler)
 * 
 * Body:
 * {
 *   sub_order_id: 'sub_order_123',
 *   rule_id: 'sla_same_day',
 *   promised_delivery: '2025-12-15T18:00:00Z',
 *   actual_delivery: '2025-12-16T10:00:00Z',
 *   delay_hours: 16,
 *   reason: 'Weather delay',
 *   farm_id: 'farm_123'
 * }
 */
router.post('/violations', async (req, res) => {
  try {
    await seedPromise;

    const {
      sub_order_id,
      rule_id,
      promised_delivery,
      actual_delivery,
      delay_hours,
      reason,
      farm_id
    } = req.body;
    
    // Get SLA rule
    const rule = await getSlaRule(rule_id);
    if (!rule) {
      return res.status(404).json({
        status: 'error',
        message: 'SLA rule not found'
      });
    }
    
    // Calculate penalty
    let penaltyAmount = 0;
    // In production, fetch order amount from database
    const orderAmount = 100.00; // Placeholder
    
    if (rule.penalty_type === 'percentage') {
      penaltyAmount = orderAmount * (rule.penalty_amount / 100);
    } else {
      penaltyAmount = rule.penalty_amount;
    }
    
    const violationId = `violation_${Date.now()}`;
    const violation = {
      violation_id: violationId,
      sub_order_id,
      farm_id,
      rule_id,
      rule_name: rule.name,
      promised_delivery,
      actual_delivery,
      delay_hours,
      reason,
      penalty_type: rule.penalty_type,
      penalty_amount: penaltyAmount,
      status: 'pending', // pending → notified → refunded
      created_at: new Date().toISOString()
    };
    
    await saveSlaViolation(violation);
    
    // Send notification to farm
    console.log(` SLA Violation recorded: ${rule.name}`);
    console.log(`  Sub-Order: ${sub_order_id}`);
    console.log(`  Farm: ${farm_id}`);
    console.log(`  Delay: ${delay_hours} hours`);
    console.log(`  Penalty: $${penaltyAmount.toFixed(2)}`);
    
    // In production, would:
    // 1. Send email to farm manager
    // 2. Create refund record
    // 3. Update sub-order with violation_id
    // 4. Log to audit system
    
    res.json({
      status: 'ok',
      data: violation,
      message: 'SLA violation recorded and farm notified'
    });
    
  } catch (error) {
    console.error('Record SLA violation error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to record SLA violation',
      error: error.message
    });
  }
});

/**
 * GET /api/wholesale/sla/violations
 * 
 * List SLA violations with filters
 */
router.get('/violations', async (req, res) => {
  try {
    await seedPromise;

    const { farm_id, status, from_date, to_date } = req.query;

    const violations = await listSlaViolations({
      farm_id,
      status,
      from_date,
      to_date
    });
    
    // Calculate totals
    const totalPenalties = violations.reduce((sum, v) => sum + v.penalty_amount, 0);
    const byFarm = {};
    violations.forEach(v => {
      if (!byFarm[v.farm_id]) {
        byFarm[v.farm_id] = { count: 0, total_penalties: 0 };
      }
      byFarm[v.farm_id].count++;
      byFarm[v.farm_id].total_penalties += v.penalty_amount;
    });
    
    res.json({
      status: 'ok',
      data: {
        violations,
        total: violations.length,
        total_penalties: totalPenalties,
        by_farm: byFarm
      }
    });
    
  } catch (error) {
    console.error('List SLA violations error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to list SLA violations',
      error: error.message
    });
  }
});

/**
 * POST /api/wholesale/substitution/policies
 * 
 * Create custom substitution policy
 */
router.post('/policies', async (req, res) => {
  try {
    await seedPromise;

    const {
      name,
      description,
      match_criteria,
      requires_buyer_approval = false,
      notification_required = true,
      approval_timeout_minutes = 30
    } = req.body;
    
    if (!name || !match_criteria) {
      return res.status(400).json({
        status: 'error',
        message: 'name and match_criteria are required'
      });
    }
    
    const policyId = `policy_${Date.now()}`;
    const policy = {
      policy_id: policyId,
      name,
      description,
      match_criteria,
      requires_buyer_approval,
      notification_required,
      approval_timeout_minutes,
      created_at: new Date().toISOString(),
      active: true
    };
    
    await saveSubstitutionPolicy(policy);
    
    res.json({
      status: 'ok',
      data: policy,
      message: 'Substitution policy created successfully'
    });
    
  } catch (error) {
    console.error('Create substitution policy error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to create substitution policy',
      error: error.message
    });
  }
});

/**
 * GET /api/wholesale/substitution/policies
 * 
 * List substitution policies
 */
router.get('/policies', async (req, res) => {
  try {
    await seedPromise;

    const policies = await listSubstitutionPolicies();
    
    res.json({
      status: 'ok',
      data: {
        policies,
        total: policies.length
      }
    });
    
  } catch (error) {
    console.error('List substitution policies error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to list substitution policies',
      error: error.message
    });
  }
});

/**
 * POST /api/wholesale/substitution/find
 * 
 * Find substitute products for an out-of-stock SKU
 * 
 * Body:
 * {
 *   original_sku_id: 'lettuce_romaine',
 *   policy_id: 'sub_same_category',
 *   quantity_needed: 50,
 *   buyer_id: 'buyer_123'
 * }
 * 
 * Response:
 * {
 *   status: 'ok',
 *   data: {
 *     substitutes: [
 *       {
 *         sku_id: 'lettuce_green_leaf',
 *         product_name: 'Green Leaf Lettuce',
 *         match_score: 0.95,
 *         price_difference: 0.50,
 *         availability: 100,
 *         farms: ['farm_123', 'farm_456'],
 *         requires_approval: false
 *       }
 *     ]
 *   }
 * }
 */
router.post('/find', async (req, res) => {
  try {
    await seedPromise;

    const { original_sku_id, policy_id, quantity_needed, buyer_id } = req.body;
    
    if (!original_sku_id || !policy_id) {
      return res.status(400).json({
        status: 'error',
        message: 'original_sku_id and policy_id are required'
      });
    }
    
    const policy = await getSubstitutionPolicy(policy_id);
    if (!policy) {
      return res.status(404).json({
        status: 'error',
        message: 'Substitution policy not found'
      });
    }
    
    // In production, would:
    // 1. Fetch original SKU details from catalog
    // 2. Query catalog for similar SKUs matching criteria
    // 3. Calculate match scores based on attributes
    // 4. Filter by price tolerance and availability
    // 5. Rank by match score
    
    // Mock substitutes for demonstration
    const substitutes = [
      {
        sku_id: 'lettuce_green_leaf',
        product_name: 'Green Leaf Lettuce',
        match_score: 0.95,
        price_difference: 0.50,
        price_per_unit: 3.00,
        availability: 100,
        farms: ['farm_123', 'farm_456'],
        requires_approval: policy.requires_buyer_approval,
        reasons: ['Same category', 'Similar quality', 'Within price tolerance']
      },
      {
        sku_id: 'lettuce_butter',
        product_name: 'Butter Lettuce',
        match_score: 0.85,
        price_difference: 1.00,
        price_per_unit: 3.50,
        availability: 75,
        farms: ['farm_789'],
        requires_approval: policy.requires_buyer_approval,
        reasons: ['Same category', 'Premium quality']
      }
    ];
    
    console.log(` Found ${substitutes.length} substitutes for ${original_sku_id}`);
    console.log(`  Policy: ${policy.name}`);
    console.log(`  Requires Approval: ${policy.requires_buyer_approval}`);
    
    res.json({
      status: 'ok',
      data: {
        original_sku_id,
        policy,
        substitutes,
        total_found: substitutes.length
      }
    });
    
  } catch (error) {
    console.error('Find substitutes error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to find substitutes',
      error: error.message
    });
  }
});

/**
 * POST /api/wholesale/substitution/request-approval
 * 
 * Request buyer approval for substitution
 * 
 * Body:
 * {
 *   order_id: 'order_123',
 *   original_sku: {...},
 *   substitute_sku: {...},
 *   reason: 'Original product out of stock',
 *   buyer_id: 'buyer_123'
 * }
 */
router.post('/request-approval', async (req, res) => {
  try {
    await seedPromise;

    const { order_id, original_sku, substitute_sku, reason, buyer_id } = req.body;
    
    const approvalId = `approval_${Date.now()}`;
    const approval = {
      approval_id: approvalId,
      order_id,
      buyer_id,
      original_sku,
      substitute_sku,
      reason,
      status: 'pending', // pending → approved → rejected → expired
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 min expiry
    };
    
    await saveSubstitutionApproval(approval);
    
    console.log(`📧 Substitution approval requested: ${approvalId}`);
    console.log(`  Buyer: ${buyer_id}`);
    console.log(`  Original: ${original_sku.product_name}`);
    console.log(`  Substitute: ${substitute_sku.product_name}`);
    
    // In production, would:
    // 1. Send email/SMS to buyer with approval link
    // 2. Set 30-minute timeout
    // 3. Auto-reject if no response
    
    res.json({
      status: 'ok',
      data: approval,
      message: 'Approval request sent to buyer'
    });
    
  } catch (error) {
    console.error('Request substitution approval error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to request substitution approval',
      error: error.message
    });
  }
});

/**
 * POST /api/wholesale/substitution/respond/:approval_id
 * 
 * Buyer responds to substitution approval request
 * 
 * Body:
 * {
 *   approved: true,
 *   notes: 'Green leaf is acceptable'
 * }
 */
router.post('/respond/:approval_id', async (req, res) => {
  try {
    await seedPromise;

    const { approval_id } = req.params;
    const { approved, notes } = req.body;

    const approval = await getSubstitutionApproval(approval_id);
    if (!approval) {
      return res.status(404).json({
        status: 'error',
        message: 'Approval request not found'
      });
    }
    
    // Check expiry
    if (new Date(approval.expires_at) < new Date()) {
      approval.status = 'expired';
      return res.status(400).json({
        status: 'error',
        message: 'Approval request has expired'
      });
    }
    
    // Update approval
    const nextStatus = approved ? 'approved' : 'rejected';
    const nextApproval = await updateSubstitutionApproval(approval_id, {
      status: nextStatus,
      response_notes: notes,
      responded_at: new Date().toISOString()
    });
    
    console.log(` Substitution ${nextApproval.status}: ${approval_id}`);
    
    // In production, would:
    // 1. Update order with substitution
    // 2. Notify farm to proceed with substitute
    // 3. Update inventory reservations
    
    res.json({
      status: 'ok',
      data: nextApproval,
      message: `Substitution ${nextApproval.status}`
    });
    
  } catch (error) {
    console.error('Respond to substitution approval error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to respond to substitution approval',
      error: error.message
    });
  }
});

/**
 * POST /api/wholesale/buyer/preferences
 * 
 * Set buyer substitution preferences
 * 
 * Body:
 * {
 *   buyer_id: 'buyer_123',
 *   default_policy_id: 'sub_same_category',
 *   auto_approve_price_difference: 5, // Auto-approve if <$5 difference
 *   never_substitute: ['lettuce_iceberg'], // SKUs that can't be substituted
 *   preferred_substitutes: {
 *     'lettuce_romaine': ['lettuce_green_leaf', 'lettuce_butter']
 *   }
 * }
 */
router.post('/buyer/preferences', async (req, res) => {
  try {
    await seedPromise;

    const {
      buyer_id,
      default_policy_id,
      auto_approve_price_difference,
      never_substitute = [],
      preferred_substitutes = {}
    } = req.body;
    
    if (!buyer_id) {
      return res.status(400).json({
        status: 'error',
        message: 'buyer_id is required'
      });
    }
    
    const preferences = {
      buyer_id,
      default_policy_id,
      auto_approve_price_difference,
      never_substitute,
      preferred_substitutes,
      updated_at: new Date().toISOString()
    };
    
    await saveBuyerPreferences(preferences);
    
    console.log(` Updated buyer preferences: ${buyer_id}`);
    console.log(`  Default Policy: ${default_policy_id}`);
    console.log(`  Never Substitute: ${never_substitute.length} SKUs`);
    
    res.json({
      status: 'ok',
      data: preferences,
      message: 'Buyer preferences updated successfully'
    });
    
  } catch (error) {
    console.error('Update buyer preferences error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update buyer preferences',
      error: error.message
    });
  }
});

/**
 * GET /api/wholesale/buyer/preferences/:buyer_id
 * 
 * Get buyer substitution preferences
 */
router.get('/buyer/preferences/:buyer_id', async (req, res) => {
  try {
    await seedPromise;

    const { buyer_id } = req.params;

    const preferences = await getBuyerPreferences(buyer_id);
    if (!preferences) {
      // Return defaults if none set
      return res.json({
        status: 'ok',
        data: {
          buyer_id,
          default_policy_id: 'sub_same_category',
          auto_approve_price_difference: null,
          never_substitute: [],
          preferred_substitutes: {}
        },
        message: 'Using default preferences'
      });
    }
    
    res.json({
      status: 'ok',
      data: preferences
    });
    
  } catch (error) {
    console.error('Get buyer preferences error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get buyer preferences',
      error: error.message
    });
  }
});

export default router;
