/**
 * Billing Routes (Cloud)
 * Provides usage/limits endpoints, subscription management, and AI cost billing for farm admin UI
 */
import express from 'express';
import crypto from 'crypto';
import { query, isDatabaseAvailable } from '../config/database.js';
import { listPayments, listAllOrders } from '../services/wholesaleMemoryStore.js';

const router = express.Router();

// ─── Subscription Plans ────────────────────────────────────
const SUBSCRIPTION_PLANS = {
  base: { name: 'Light Engine Base', amount_cents: 2900, currency: 'CAD', interval: 'monthly', ai_included_calls: 500 },
  pro:  { name: 'Light Engine Pro',  amount_cents: 7900, currency: 'CAD', interval: 'monthly', ai_included_calls: 5000 },
};

// Usage-billing policy (requested): charge AI + data in $15 tranches.
const USAGE_TRANCHE_CAD = Number(process.env.USAGE_TRANCHE_CAD || 15);
const DATA_MARGIN_TARGET = Number(process.env.DATA_MARGIN_TARGET || 0.85);
const DATA_COST_PER_GB_CAD = Number(process.env.DATA_COST_PER_GB_CAD || 1.5);
const USD_TO_CAD = Number(process.env.USD_TO_CAD || 1.36);
const INCLUDED_DATA_GB = Number(process.env.INCLUDED_DATA_GB || 0.05); // 50 MB
const INCLUDED_AI_ACTIONS = Number(process.env.INCLUDED_AI_ACTIONS || 25);

function ceilTranches(amountCad) {
  if (!Number.isFinite(amountCad) || amountCad <= 0) return 0;
  return Math.ceil(amountCad / USAGE_TRANCHE_CAD);
}

function computeDataTrancheBilling(storageGb) {
  const chargeableGb = Math.max(0, (storageGb || 0) - INCLUDED_DATA_GB);
  const costBasisCad = chargeableGb * DATA_COST_PER_GB_CAD;
  const revenueRequired = DATA_MARGIN_TARGET >= 1
    ? costBasisCad
    : (costBasisCad / Math.max(0.0001, 1 - DATA_MARGIN_TARGET));
  const tranches = ceilTranches(revenueRequired);
  return {
    included_gb: INCLUDED_DATA_GB,
    chargeable_gb: Math.round(chargeableGb * 1000) / 1000,
    cost_basis_cad: Math.round(costBasisCad * 100) / 100,
    target_margin: DATA_MARGIN_TARGET,
    revenue_required_cad: Math.round(revenueRequired * 100) / 100,
    tranches,
    charge_cad: tranches * USAGE_TRANCHE_CAD,
  };
}

function computeAiTrancheBilling(aiCalls, aiCostUsd, includedCalls = INCLUDED_AI_ACTIONS) {
  const chargeableCalls = Math.max(0, (aiCalls || 0) - includedCalls);
  const aiCostCad = Math.max(0, aiCostUsd || 0) * USD_TO_CAD;
  const tranches = chargeableCalls > 0 ? ceilTranches(aiCostCad) : 0;
  return {
    included_actions: includedCalls,
    chargeable_actions: chargeableCalls,
    cost_basis_usd: Math.round((aiCostUsd || 0) * 100) / 100,
    cost_basis_cad: Math.round(aiCostCad * 100) / 100,
    tranches,
    charge_cad: tranches * USAGE_TRANCHE_CAD,
  };
}

/**
 * Ensure subscription tables exist
 */
async function ensureSubscriptionTables() {
  if (!isDatabaseAvailable()) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS farm_subscriptions (
        id SERIAL PRIMARY KEY,
        farm_id VARCHAR(255) NOT NULL,
        plan_key VARCHAR(50) NOT NULL DEFAULT 'base',
        status VARCHAR(50) NOT NULL DEFAULT 'active',
        current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        current_period_end TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 month'),
        square_subscription_id VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(farm_id)
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS billing_invoices (
        id SERIAL PRIMARY KEY,
        farm_id VARCHAR(255) NOT NULL,
        invoice_id VARCHAR(255) UNIQUE NOT NULL,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        base_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
        ai_usage_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
        total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
        ai_calls_count INTEGER DEFAULT 0,
        ai_calls_included INTEGER DEFAULT 0,
        ai_calls_overage INTEGER DEFAULT 0,
        status VARCHAR(50) DEFAULT 'pending',
        paid_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } catch (err) {
    console.warn('[Billing] Subscription table setup:', err.message);
  }
}

let _subTablesReady = false;
async function ensureSubTables() {
  if (_subTablesReady) return;
  await ensureSubscriptionTables();
  _subTablesReady = true;
}

/**
 * GET /api/billing/receipts
 * Return billing receipts derived from payment records + orders.
 * Query params: ?page=1&limit=20&status=created
 */
router.get('/receipts', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const statusFilter = req.query.status || null;

    const farmId = req.farmId || null;
    const payments = listPayments() || [];
    const orders = await listAllOrders({ page: 1, limit: 50000 });
    const orderMap = new Map((orders || []).map(o => [o.master_order_id, o]));

    // Build receipt objects from payments, filtered to logged-in farm
    let receipts = payments
      .filter(p => {
        if (!farmId) return true;
        // Purchase payments store farm_id in metadata
        if (p.farm_id) return p.farm_id === farmId;
        // Wholesale payments: check if order has a sub-order for this farm
        const order = orderMap.get(p.order_id);
        if (order && order.farm_sub_orders) {
          return order.farm_sub_orders.some(sub => sub.farm_id === farmId);
        }
        return false;
      })
      .map(p => {
        const order = orderMap.get(p.order_id) || {};
        return {
          receipt_id: p.payment_id,
          order_id: p.order_id,
          date: p.created_at,
          amount: p.amount,
          currency: p.currency || 'CAD',
          status: p.status,
          provider: p.provider,
          broker_fee: p.broker_fee_amount || 0,
          net_to_farms: p.net_to_farms_total || 0,
          buyer_id: order.buyer_id || null,
          order_status: order.status || null,
          items_count: (order.farm_sub_orders || []).reduce(
            (sum, sub) => sum + (sub.items || []).length, 0
          ),
        };
      });

    if (statusFilter) {
      receipts = receipts.filter(r => r.status === statusFilter);
    }

    const total = receipts.length;
    const start = (page - 1) * limit;
    const pageReceipts = receipts.slice(start, start + limit);

    res.json({
      status: 'ok',
      receipts: pageReceipts,
      total,
      pagination: { page, pageSize: limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('[Billing] Receipts error:', err.message);
    res.status(500).json({ status: 'error', message: 'Failed to load receipts' });
  }
});

/**
 * GET /api/billing/usage/:farmId
 * Return usage and limits (cloud)
 * Queries actual farm data to report real usage metrics.
 */
router.get('/usage/:farmId', async (req, res) => {
  const { farmId } = req.params;

  if (!farmId) {
    return res.status(400).json({ status: 'error', message: 'Farm ID required' });
  }

  // Scope check: authenticated farm can only query its own usage (admins bypass)
  if (req.farmId && req.farmId !== farmId && req.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Access denied' });
  }

  try {
    let deviceCount = 0;
    let dataTypes = 0;
    let apiCallsToday = 0;
    let storageBytes = 0;
    let aiCallsMonth = 0;
    let aiCostUsdMonth = 0;

    // Count devices and data types from farmStore
    if (req.farmStore) {
      const devices = await req.farmStore.get(farmId, 'devices');
      deviceCount = Array.isArray(devices) ? devices.length : 0;
    }

    // Count data types stored in DB
    if (isDatabaseAvailable()) {
      try {
        const dtResult = await query(
          'SELECT COUNT(DISTINCT data_type) AS count FROM farm_data WHERE farm_id = $1',
          [farmId]
        );
        dataTypes = parseInt(dtResult.rows[0]?.count || 0);
      } catch { /* table may not exist */ }

      // API call count for today
      try {
        const callResult = await query(
          'SELECT api_calls FROM api_usage_daily WHERE farm_id = $1 AND usage_date = CURRENT_DATE',
          [farmId]
        );
        apiCallsToday = parseInt(callResult.rows[0]?.api_calls || 0);
      } catch { /* table may not exist yet */ }

      // Storage: sum JSONB data size for this farm
      try {
        const storageResult = await query(
          'SELECT COALESCE(SUM(pg_column_size(data)), 0)::bigint AS total_bytes FROM farm_data WHERE farm_id = $1',
          [farmId]
        );
        storageBytes = parseInt(storageResult.rows[0]?.total_bytes || 0);
      } catch { /* table may not exist */ }

      // AI usage for current billing month (per-farm)
      try {
        const aiResult = await query(
          `SELECT COUNT(*) AS call_count, COALESCE(SUM(estimated_cost), 0) AS total_cost
           FROM ai_usage
           WHERE farm_id = $1
             AND created_at >= date_trunc('month', NOW())
             AND created_at < (date_trunc('month', NOW()) + INTERVAL '1 month')`,
          [farmId]
        );
        aiCallsMonth = parseInt(aiResult.rows[0]?.call_count || 0);
        aiCostUsdMonth = parseFloat(aiResult.rows[0]?.total_cost || 0);
      } catch { /* table may not exist */ }
    }

    const storageGb = Math.round((storageBytes / (1024 * 1024 * 1024)) * 1000) / 1000;
    const dataBilling = computeDataTrancheBilling(storageGb);
    const aiBilling = computeAiTrancheBilling(aiCallsMonth, aiCostUsdMonth, INCLUDED_AI_ACTIONS);

    return res.json({
      status: 'ok',
      dataAvailable: true,
      plan: 'pilot',
      limits: {
        devices: 50,
        api_calls_per_day: 10000,
        storage_gb: 5,
      },
      usage: {
        devices: deviceCount,
        data_types: dataTypes,
        api_calls_today: apiCallsToday,
        storage_gb: storageGb,
        ai_actions_month: aiCallsMonth,
        ai_cost_usd_month: Math.round(aiCostUsdMonth * 100) / 100,
      },
      metering_available: true,
      overages: {
        devices: Math.max(0, deviceCount - 50),
        api_calls: Math.max(0, apiCallsToday - 10000),
        storage_gb: Math.max(0, storageGb - 5),
      },
      billing_policy: {
        subscription_plus_usage: true,
        usage_tranche_cad: USAGE_TRANCHE_CAD,
        data_margin_target: DATA_MARGIN_TARGET,
        included_data_gb: INCLUDED_DATA_GB,
        included_ai_actions: INCLUDED_AI_ACTIONS,
      },
      usage_billing_estimate: {
        data: dataBilling,
        ai: aiBilling,
        total_tranches: dataBilling.tranches + aiBilling.tranches,
        total_usage_charge_cad: dataBilling.charge_cad + aiBilling.charge_cad,
      },
    });
  } catch (err) {
    console.error('[Billing] Usage error:', err.message);
    return res.json({
      status: 'error',
      dataAvailable: false,
      message: 'Failed to compute usage',
    });
  }
});

// ─── Subscription Management ──────────────────────────────

/**
 * GET /api/billing/subscription
 * Get current farm subscription status
 */
router.get('/subscription', async (req, res) => {
  try {
    await ensureSubTables();
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ status: 'error', message: 'Farm ID required' });

    if (!isDatabaseAvailable()) {
      return res.status(503).json({ status: 'error', message: 'Database unavailable' });
    }

    const result = await query('SELECT * FROM farm_subscriptions WHERE farm_id = $1', [farmId]);
    if (result.rows.length === 0) {
      return res.json({
        status: 'ok',
        subscription: null,
        plans: SUBSCRIPTION_PLANS,
        message: 'No active subscription. Use POST /api/billing/subscription to create one.',
      });
    }

    const sub = result.rows[0];
    const plan = SUBSCRIPTION_PLANS[sub.plan_key] || SUBSCRIPTION_PLANS.base;

    return res.json({
      status: 'ok',
      subscription: {
        farm_id: sub.farm_id,
        plan_key: sub.plan_key,
        plan_name: plan.name,
        amount: (plan.amount_cents / 100).toFixed(2),
        currency: plan.currency,
        interval: plan.interval,
        ai_included_calls: plan.ai_included_calls,
        status: sub.status,
        current_period_start: sub.current_period_start,
        current_period_end: sub.current_period_end,
      },
    });
  } catch (err) {
    console.error('[Billing] Subscription get error:', err.message);
    res.status(500).json({ status: 'error', message: 'Failed to get subscription' });
  }
});

/**
 * POST /api/billing/subscription
 * Create or update a farm subscription
 */
router.post('/subscription', async (req, res) => {
  try {
    await ensureSubTables();
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ status: 'error', message: 'Farm ID required' });

    const { plan_key } = req.body || {};
    const plan = SUBSCRIPTION_PLANS[plan_key || 'base'];
    if (!plan) {
      return res.status(400).json({ status: 'error', message: 'Invalid plan', available_plans: Object.keys(SUBSCRIPTION_PLANS) });
    }

    if (!isDatabaseAvailable()) {
      return res.status(503).json({ status: 'error', message: 'Database unavailable' });
    }

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await query(
      `INSERT INTO farm_subscriptions (farm_id, plan_key, status, current_period_start, current_period_end, updated_at)
       VALUES ($1, $2, 'active', $3, $4, NOW())
       ON CONFLICT (farm_id) DO UPDATE SET
         plan_key = EXCLUDED.plan_key,
         status = 'active',
         current_period_start = EXCLUDED.current_period_start,
         current_period_end = EXCLUDED.current_period_end,
         updated_at = NOW()`,
      [farmId, plan_key || 'base', now.toISOString(), periodEnd.toISOString()]
    );

    return res.json({
      status: 'ok',
      subscription: {
        farm_id: farmId,
        plan_key: plan_key || 'base',
        plan_name: plan.name,
        amount: (plan.amount_cents / 100).toFixed(2),
        currency: plan.currency,
        interval: plan.interval,
        ai_included_calls: plan.ai_included_calls,
        status: 'active',
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
      },
    });
  } catch (err) {
    console.error('[Billing] Subscription create error:', err.message);
    res.status(500).json({ status: 'error', message: 'Failed to create subscription' });
  }
});

/**
 * GET /api/billing/ai-costs/:farmId
 * Get AI usage costs for a farm's current billing period
 * Shows included allowance, overage, and total charges to pass along
 */
router.get('/ai-costs/:farmId', async (req, res) => {
  const { farmId } = req.params;
  if (!farmId) return res.status(400).json({ status: 'error', message: 'Farm ID required' });

  // Scope check: authenticated farm can only query its own usage (admins bypass)
  if (req.farmId && req.farmId !== farmId && req.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Access denied' });
  }

  try {
    if (!isDatabaseAvailable()) {
      return res.status(503).json({ status: 'error', message: 'Database unavailable' });
    }

    await ensureSubTables();

    // Get subscription plan
    const subResult = await query('SELECT plan_key, current_period_start, current_period_end FROM farm_subscriptions WHERE farm_id = $1', [farmId]);
    const planKey = subResult.rows[0]?.plan_key || 'base';
    const plan = SUBSCRIPTION_PLANS[planKey] || SUBSCRIPTION_PLANS.base;
    const periodStart = subResult.rows[0]?.current_period_start || new Date(new Date().setDate(1)).toISOString();
    const periodEnd = subResult.rows[0]?.current_period_end || new Date().toISOString();

    // Count AI calls and sum costs for current period
    let aiCalls = 0;
    let aiCostUsd = 0;
    try {
      const aiResult = await query(
        `SELECT COUNT(*) AS call_count, COALESCE(SUM(estimated_cost), 0) AS total_cost
         FROM ai_usage
         WHERE farm_id = $1 AND created_at >= $2 AND created_at <= $3`,
        [farmId, periodStart, periodEnd]
      );
      aiCalls = parseInt(aiResult.rows[0]?.call_count || 0);
      aiCostUsd = parseFloat(aiResult.rows[0]?.total_cost || 0);
    } catch { /* ai_usage table may not exist */ }

    const includedCalls = Math.max(plan.ai_included_calls || 0, INCLUDED_AI_ACTIONS);
    const aiTranche = computeAiTrancheBilling(aiCalls, aiCostUsd, includedCalls);
    const overageCalls = aiTranche.chargeable_actions;
    const overageCharge = aiTranche.charge_cad;
    const baseFee = plan.amount_cents / 100;

    return res.json({
      status: 'ok',
      farm_id: farmId,
      plan: planKey,
      period: { start: periodStart, end: periodEnd },
      ai_usage: {
        total_calls: aiCalls,
        included_calls: includedCalls,
        overage_calls: overageCalls,
        actual_ai_cost_usd: Math.round(aiCostUsd * 100) / 100,
        overage_charge_cad: overageCharge,
        tranches: aiTranche.tranches,
      },
      billing_summary: {
        base_subscription: baseFee,
        ai_overage: overageCharge,
        total_due: Math.round((baseFee + overageCharge) * 100) / 100,
        currency: 'CAD',
      },
      billing_policy: {
        usage_tranche_cad: USAGE_TRANCHE_CAD,
        model: 'subscription_plus_usage_tranches'
      }
    });
  } catch (err) {
    console.error('[Billing] AI costs error:', err.message);
    res.status(500).json({ status: 'error', message: 'Failed to compute AI costs' });
  }
});

/**
 * POST /api/billing/generate-invoice/:farmId
 * Generate a billing invoice for the current period (base + AI overage)
 */
router.post('/generate-invoice/:farmId', async (req, res) => {
  const { farmId } = req.params;
  if (!farmId) return res.status(400).json({ status: 'error', message: 'Farm ID required' });

  try {
    if (!isDatabaseAvailable()) {
      return res.status(503).json({ status: 'error', message: 'Database unavailable' });
    }
    await ensureSubTables();

    // Get subscription
    const subResult = await query('SELECT * FROM farm_subscriptions WHERE farm_id = $1', [farmId]);
    const sub = subResult.rows[0];
    const planKey = sub?.plan_key || 'base';
    const plan = SUBSCRIPTION_PLANS[planKey] || SUBSCRIPTION_PLANS.base;
    const periodStart = sub?.current_period_start || new Date(new Date().setDate(1));
    const periodEnd = sub?.current_period_end || new Date();

    // Count AI usage
    let aiCalls = 0;
    try {
      const aiResult = await query(
        `SELECT COUNT(*) AS call_count FROM ai_usage WHERE farm_id = $1 AND created_at >= $2 AND created_at <= $3`,
        [farmId, periodStart, periodEnd]
      );
      aiCalls = parseInt(aiResult.rows[0]?.call_count || 0);
    } catch { /* ai_usage table may not exist */ }

    const includedCalls = Math.max(plan.ai_included_calls || 0, INCLUDED_AI_ACTIONS);
    const aiTranche = computeAiTrancheBilling(aiCalls, 0, includedCalls);
    const overageCalls = aiTranche.chargeable_actions;
    const overageCharge = aiTranche.charge_cad;
    const baseFee = plan.amount_cents / 100;
    const totalAmount = Math.round((baseFee + overageCharge) * 100) / 100;

    const invoiceId = `INV-${farmId}-${new Date().toISOString().slice(0, 7)}-${crypto.randomBytes(3).toString('hex')}`;

    const result = await query(
      `INSERT INTO billing_invoices
        (farm_id, invoice_id, period_start, period_end, base_amount, ai_usage_amount, total_amount, ai_calls_count, ai_calls_included, ai_calls_overage, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
       ON CONFLICT (invoice_id) DO NOTHING
       RETURNING *`,
      [farmId, invoiceId, periodStart, periodEnd, baseFee, overageCharge, totalAmount, aiCalls, includedCalls, overageCalls]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({ status: 'error', message: 'Invoice already exists for this period' });
    }

    return res.json({ status: 'ok', invoice: result.rows[0] });
  } catch (err) {
    console.error('[Billing] Invoice generation error:', err.message);
    res.status(500).json({ status: 'error', message: 'Failed to generate invoice' });
  }
});

/**
 * GET /api/billing/invoices/:farmId
 * List invoices for a farm
 */
router.get('/invoices/:farmId', async (req, res) => {
  const { farmId } = req.params;
  if (!farmId) return res.status(400).json({ status: 'error', message: 'Farm ID required' });

  try {
    if (!isDatabaseAvailable()) {
      return res.status(503).json({ status: 'error', message: 'Database unavailable' });
    }
    await ensureSubTables();

    const result = await query(
      'SELECT * FROM billing_invoices WHERE farm_id = $1 ORDER BY period_start DESC LIMIT 24',
      [farmId]
    );

    return res.json({ status: 'ok', invoices: result.rows });
  } catch (err) {
    console.error('[Billing] Invoices list error:', err.message);
    res.status(500).json({ status: 'error', message: 'Failed to list invoices' });
  }
});

export default router;
