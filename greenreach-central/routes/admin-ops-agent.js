/**
 * F.A.Y.E. Admin Operations Agent — Tool Catalog & Gateway
 * Farm Autonomy & Yield Engine
 *
 * Phase 1: READ tools across all GreenReach domains.
 * Mirrors E.V.I.E.'s farm-ops-agent.js pattern for the admin/management side.
 */
import express from 'express';
import { query as dbQuery, isDatabaseAvailable } from '../config/database.js';
import { listAllOrders, listPayments, listRefunds, listAllBuyers } from '../services/wholesaleMemoryStore.js';
import { listNetworkFarms } from '../services/networkFarmsStore.js';

const router = express.Router();

// ── Tool Catalog ──────────────────────────────────────────────

export const ADMIN_TOOL_CATALOG = {

  // ── System Health & Monitoring ──

  'get_system_health': {
    description: 'Get the latest nightly system audit results including DB health, service connectivity, and subsystem checks.',
    category: 'read',
    required: [],
    optional: ['run_fresh'],
    handler: async (params) => {
      try {
        const { getLatestAudit, runNightlyAudit } = await import('../services/nightly-audit.js');
        const result = params.run_fresh === true ? await runNightlyAudit() : await getLatestAudit();
        return { ok: true, ...result };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_farm_heartbeats': {
    description: 'Get heartbeat status for all farms in the network. Shows CPU, memory, disk, last seen time, and stale detection.',
    category: 'read',
    required: [],
    optional: ['stale_only'],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const result = await dbQuery(`
          SELECT farm_id, cpu_percent, memory_percent, disk_percent, uptime_seconds,
                 node_version, last_seen_at,
                 EXTRACT(EPOCH FROM (NOW() - last_seen_at)) AS seconds_since_heartbeat
          FROM farm_heartbeats ORDER BY last_seen_at DESC
        `);
        let farms = result.rows.map(r => ({
          ...r,
          stale: r.seconds_since_heartbeat > 900,
          critical: r.seconds_since_heartbeat > 1800
        }));
        if (params.stale_only) farms = farms.filter(f => f.stale);
        return { ok: true, farm_count: farms.length, stale_count: farms.filter(f => f.stale).length, farms };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_sync_status': {
    description: 'Get data sync freshness for all farms — last sync time, error count, whether SLO is met.',
    category: 'read',
    required: [],
    optional: [],
    handler: async () => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const result = await dbQuery(`
          SELECT farm_id, sync_type, last_success_at, last_failure_at, error_count,
                 EXTRACT(EPOCH FROM (NOW() - last_success_at)) AS seconds_since_sync
          FROM farm_data
          WHERE sync_type IS NOT NULL
          ORDER BY last_success_at DESC NULLS LAST
        `);
        // Fallback: if farm_data doesn't have sync_type, use last_updated
        if (result.rows.length === 0) {
          const fallback = await dbQuery(`
            SELECT farm_id, data_type, updated_at,
                   EXTRACT(EPOCH FROM (NOW() - updated_at)) AS seconds_since_update
            FROM farm_data ORDER BY updated_at DESC
          `);
          return { ok: true, syncs: fallback.rows, note: 'Using farm_data updated_at as proxy' };
        }
        return { ok: true, syncs: result.rows };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_admin_alerts': {
    description: 'Get open admin alerts — unresolved issues requiring attention. Filter by domain or severity.',
    category: 'read',
    required: [],
    optional: ['domain', 'severity', 'limit'],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        let sql = 'SELECT * FROM admin_alerts WHERE resolved = FALSE';
        const values = [];
        let idx = 1;
        if (params.domain) { sql += ` AND domain = $${idx++}`; values.push(params.domain); }
        if (params.severity) { sql += ` AND severity = $${idx++}`; values.push(params.severity); }
        sql += ' ORDER BY created_at DESC';
        if (params.limit) { sql += ` LIMIT $${idx++}`; values.push(parseInt(params.limit, 10)); }
        const result = await dbQuery(sql, values);
        return { ok: true, count: result.rows.length, alerts: result.rows };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── Accounting & Finance ──

  'get_trial_balance': {
    description: 'Get the current trial balance — total debits and credits per account from the double-entry ledger.',
    category: 'read',
    required: [],
    optional: ['as_of_date'],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        let dateFilter = '';
        const values = [];
        if (params.as_of_date) {
          dateFilter = 'WHERE t.txn_date <= $1';
          values.push(params.as_of_date);
        }
        const result = await dbQuery(`
          SELECT a.account_code, a.account_name, a.account_class, a.account_type,
                 COALESCE(SUM(e.debit), 0) AS total_debit,
                 COALESCE(SUM(e.credit), 0) AS total_credit,
                 COALESCE(SUM(e.debit), 0) - COALESCE(SUM(e.credit), 0) AS balance
          FROM accounting_accounts a
          LEFT JOIN accounting_entries e ON e.account_code = a.account_code
          LEFT JOIN accounting_transactions t ON e.transaction_id = t.id ${dateFilter}
          GROUP BY a.account_code, a.account_name, a.account_class, a.account_type
          ORDER BY a.account_code
        `, values);
        const totalDebit = result.rows.reduce((s, r) => s + Number(r.total_debit), 0);
        const totalCredit = result.rows.reduce((s, r) => s + Number(r.total_credit), 0);
        return {
          ok: true, as_of: params.as_of_date || 'current',
          accounts: result.rows,
          total_debit: totalDebit.toFixed(2),
          total_credit: totalCredit.toFixed(2),
          balanced: Math.abs(totalDebit - totalCredit) < 0.01
        };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_unclassified_transactions': {
    description: 'Get accounting transactions pending classification review.',
    category: 'read',
    required: [],
    optional: ['limit'],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const limit = parseInt(params.limit, 10) || 20;
        const result = await dbQuery(`
          SELECT t.id, t.txn_date, t.description, t.total_amount, t.currency,
                 c.suggested_category, c.confidence, c.status AS classification_status
          FROM accounting_transactions t
          LEFT JOIN accounting_classifications c ON c.transaction_id = t.id
          WHERE c.status IS NULL OR c.status = 'pending'
          ORDER BY t.txn_date DESC LIMIT $1
        `, [limit]);
        return { ok: true, count: result.rows.length, transactions: result.rows };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_revenue_summary': {
    description: 'Get wholesale revenue summary for a time period. Shows total revenue, order count, average order value.',
    category: 'read',
    required: [],
    optional: ['days', 'farm_id'],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const days = parseInt(params.days, 10) || 30;
        let sql = `
          SELECT COUNT(*) AS order_count,
                 COALESCE(SUM(t.total_amount), 0) AS total_revenue,
                 COALESCE(AVG(t.total_amount), 0) AS avg_order_value
          FROM accounting_transactions t
          JOIN accounting_sources s ON t.source_id = s.id
          WHERE s.source_key LIKE 'wholesale_%'
            AND t.txn_date >= CURRENT_DATE - $1::int
        `;
        const values = [days];
        if (params.farm_id) {
          sql += ` AND t.raw_payload->>'farm_id' = $2`;
          values.push(params.farm_id);
        }
        const result = await dbQuery(sql, values);
        const row = result.rows[0] || {};
        return {
          ok: true, period_days: days,
          order_count: Number(row.order_count || 0),
          total_revenue: Number(Number(row.total_revenue || 0).toFixed(2)),
          avg_order_value: Number(Number(row.avg_order_value || 0).toFixed(2))
        };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_accounts_payable': {
    description: 'Get outstanding accounts payable to farms — amounts owed for wholesale orders not yet settled.',
    category: 'read',
    required: [],
    optional: [],
    handler: async () => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        // AP-Farms balance = credits on 250000 minus debits on 250000
        const result = await dbQuery(`
          SELECT COALESCE(SUM(e.credit), 0) - COALESCE(SUM(e.debit), 0) AS ap_balance
          FROM accounting_entries e
          WHERE e.account_code = '250000'
        `);
        const apBalance = Number(result.rows[0]?.ap_balance || 0);

        // Per-farm breakdown from transaction payloads
        const detail = await dbQuery(`
          SELECT t.raw_payload->>'farm_id' AS farm_id,
                 t.raw_payload->>'farm_name' AS farm_name,
                 SUM(e.credit) - SUM(e.debit) AS farm_payable
          FROM accounting_entries e
          JOIN accounting_transactions t ON e.transaction_id = t.id
          WHERE e.account_code = '250000'
          GROUP BY t.raw_payload->>'farm_id', t.raw_payload->>'farm_name'
          HAVING SUM(e.credit) - SUM(e.debit) > 0.01
          ORDER BY farm_payable DESC
        `);
        return {
          ok: true,
          total_payable: apBalance.toFixed(2),
          farm_breakdown: detail.rows.map(r => ({
            farm_id: r.farm_id, farm_name: r.farm_name,
            amount: Number(Number(r.farm_payable).toFixed(2))
          }))
        };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_recent_transactions': {
    description: 'Get the most recent accounting journal entries with full debit/credit detail.',
    category: 'read',
    required: [],
    optional: ['limit', 'account_code'],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const limit = parseInt(params.limit, 10) || 15;
        let sql = `
          SELECT t.id, t.txn_date, t.description, t.total_amount, t.currency, t.status,
                 json_agg(json_build_object(
                   'account_code', e.account_code, 'debit', e.debit, 'credit', e.credit, 'memo', e.memo
                 ) ORDER BY e.line_number) AS entries
          FROM accounting_transactions t
          JOIN accounting_entries e ON e.transaction_id = t.id
        `;
        const values = [];
        let idx = 1;
        if (params.account_code) {
          sql += ` WHERE e.account_code = $${idx++}`;
          values.push(params.account_code);
        }
        sql += ` GROUP BY t.id ORDER BY t.txn_date DESC, t.id DESC LIMIT $${idx++}`;
        values.push(limit);
        const result = await dbQuery(sql, values);
        return { ok: true, count: result.rows.length, transactions: result.rows };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── Orders & Commerce ──

  'get_order_dashboard': {
    description: 'Get overview of wholesale orders — counts by status, recent orders, fulfillment pipeline.',
    category: 'read',
    required: [],
    optional: ['limit'],
    handler: async (params) => {
      try {
        const allOrders = await listAllOrders({ limit: 200 });
        const orders = allOrders.orders || allOrders;
        const byStatus = {};
        for (const o of orders) {
          const s = o.status || 'unknown';
          byStatus[s] = (byStatus[s] || 0) + 1;
        }
        const limit = parseInt(params.limit, 10) || 10;
        const recent = orders.slice(0, limit).map(o => ({
          order_id: o.master_order_id, status: o.status, total: o.grand_total,
          buyer: o.buyer_account?.email || o.buyer_id,
          created: o.created_at, farm_count: o.farm_sub_orders?.length || 0
        }));
        return { ok: true, total_orders: orders.length, by_status: byStatus, recent };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_order_detail': {
    description: 'Get full details for a specific wholesale order including payment, farm sub-orders, and delivery.',
    category: 'read',
    required: ['order_id'],
    optional: [],
    handler: async ({ order_id }) => {
      try {
        const { getOrderById } = await import('../services/wholesaleMemoryStore.js');
        const order = await getOrderById(order_id);
        if (!order) return { ok: false, error: 'Order not found' };
        return { ok: true, order };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_payment_status': {
    description: 'Get payment records — recent payments, failed payments, or filter by status.',
    category: 'read',
    required: [],
    optional: ['status', 'limit'],
    handler: async (params) => {
      try {
        let payments = listPayments();
        if (params.status) payments = payments.filter(p => p.status === params.status);
        const limit = parseInt(params.limit, 10) || 20;
        return {
          ok: true, total: payments.length,
          payments: payments.slice(0, limit).map(p => ({
            payment_id: p.payment_id, order_id: p.order_id, amount: p.amount,
            status: p.status, provider: p.provider, created: p.created_at
          }))
        };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_refund_history': {
    description: 'List all refunds with amounts, reasons, and status.',
    category: 'read',
    required: [],
    optional: ['limit'],
    handler: async (params) => {
      try {
        const refunds = listRefunds();
        const limit = parseInt(params.limit, 10) || 20;
        return { ok: true, total: refunds.length, refunds: refunds.slice(0, limit) };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_buyer_analytics': {
    description: 'Get wholesale buyer analytics — active buyers, registration trends, order frequency.',
    category: 'read',
    required: [],
    optional: [],
    handler: async () => {
      try {
        const buyers = listAllBuyers();
        const active = buyers.filter(b => b.status === 'active' || !b.deactivated_at);
        const inactive = buyers.filter(b => b.status === 'inactive' || b.deactivated_at);
        return {
          ok: true, total_buyers: buyers.length,
          active: active.length, inactive: inactive.length,
          recent_registrations: buyers
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 5)
            .map(b => ({ email: b.email, business: b.business_name, registered: b.created_at }))
        };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── Farm Network ──

  'get_network_overview': {
    description: 'Get a summary of all farms in the GreenReach network — count, status, connectivity, revenue contribution.',
    category: 'read',
    required: [],
    optional: [],
    handler: async () => {
      try {
        const farms = await listNetworkFarms();
        return {
          ok: true, total_farms: farms.length,
          farms: farms.map(f => ({
            farm_id: f.farm_id, name: f.farm_name || f.name,
            status: f.status || 'active',
            api_url: f.api_url || f.url,
            last_sync: f.last_sync_at || f.updated_at,
            location: f.location
          }))
        };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_farm_detail': {
    description: 'Get detailed information about a specific farm — config, devices, rooms, sync status.',
    category: 'read',
    required: ['farm_id'],
    optional: [],
    handler: async ({ farm_id }) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const farmResult = await dbQuery('SELECT * FROM farms WHERE farm_id = $1 LIMIT 1', [farm_id]);
        if (farmResult.rows.length === 0) return { ok: false, error: 'Farm not found' };
        const farm = farmResult.rows[0];

        const heartbeat = await dbQuery(
          'SELECT * FROM farm_heartbeats WHERE farm_id = $1 ORDER BY last_seen_at DESC LIMIT 1', [farm_id]
        ).catch(() => ({ rows: [] }));

        return { ok: true, farm, heartbeat: heartbeat.rows[0] || null };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── Market Intelligence ──

  'get_market_overview': {
    description: 'Get current market prices, trends, and AI-generated outlook for tracked crops.',
    category: 'read',
    required: [],
    optional: ['product'],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        let sql = `
          SELECT product, price, unit, source, observed_at,
                 trend_7d, trend_30d
          FROM market_price_observations o
          LEFT JOIN market_price_trends t ON o.product = t.product_name
          ORDER BY o.observed_at DESC
        `;
        const values = [];
        if (params.product) {
          sql = `
            SELECT o.product, o.price, o.unit, o.source, o.observed_at,
                   t.trend_7d, t.trend_30d
            FROM market_price_observations o
            LEFT JOIN market_price_trends t ON o.product = t.product_name
            WHERE o.product ILIKE $1
            ORDER BY o.observed_at DESC LIMIT 20
          `;
          values.push(`%${params.product}%`);
        } else {
          sql += ' LIMIT 30';
        }
        const result = await dbQuery(sql, values);
        // Also get AI analysis
        const analysis = await dbQuery(
          'SELECT * FROM market_ai_analysis ORDER BY analyzed_at DESC LIMIT 10'
        ).catch(() => ({ rows: [] }));
        return { ok: true, prices: result.rows, ai_analysis: analysis.rows };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── AI & Cost Management ──

  'get_ai_usage_costs': {
    description: 'Get AI service usage and costs — broken down by endpoint, model, and farm.',
    category: 'read',
    required: [],
    optional: ['days', 'farm_id'],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const days = parseInt(params.days, 10) || 7;
        let sql = `
          SELECT endpoint, model,
                 COUNT(*) AS call_count,
                 SUM(total_tokens) AS total_tokens,
                 SUM(estimated_cost) AS total_cost
          FROM ai_usage
          WHERE created_at >= NOW() - ($1 || ' days')::interval
        `;
        const values = [days];
        if (params.farm_id) {
          sql += ' AND farm_id = $2';
          values.push(params.farm_id);
        }
        sql += ' GROUP BY endpoint, model ORDER BY total_cost DESC';
        const result = await dbQuery(sql, values);
        const totalCost = result.rows.reduce((s, r) => s + Number(r.total_cost || 0), 0);
        return {
          ok: true, period_days: days,
          total_cost: totalCost.toFixed(4),
          breakdown: result.rows
        };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_aws_costs': {
    description: 'Get AWS infrastructure costs from the accounting ledger (synced via Cost Explorer connector).',
    category: 'read',
    required: [],
    optional: ['days'],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const days = parseInt(params.days, 10) || 30;
        const result = await dbQuery(`
          SELECT t.txn_date, t.description, t.total_amount, t.currency
          FROM accounting_transactions t
          JOIN accounting_sources s ON t.source_id = s.id
          WHERE s.source_key = 'aws_cost_explorer'
            AND t.txn_date >= CURRENT_DATE - $1::int
          ORDER BY t.txn_date DESC
        `, [days]);
        const total = result.rows.reduce((s, r) => s + Number(r.total_amount), 0);
        return { ok: true, period_days: days, total: total.toFixed(2), entries: result.rows };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── Delivery & Logistics ──

  'get_delivery_pipeline': {
    description: 'Get upcoming deliveries, driver assignments, and fulfillment status.',
    category: 'read',
    required: [],
    optional: ['date'],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const targetDate = params.date || new Date().toISOString().split('T')[0];
        const result = await dbQuery(`
          SELECT do_.id, do_.order_id, do_.status, do_.scheduled_date, do_.driver_id,
                 dd.name AS driver_name, do_.zone_id
          FROM delivery_orders do_
          LEFT JOIN delivery_drivers dd ON do_.driver_id = dd.id
          WHERE do_.scheduled_date >= $1::date
          ORDER BY do_.scheduled_date ASC LIMIT 50
        `, [targetDate]).catch(() => ({ rows: [] }));
        return { ok: true, date: targetDate, deliveries: result.rows };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── Subscriptions & Billing ──

  'get_subscription_overview': {
    description: 'Get farm subscription and billing summary — active subscriptions, revenue, usage.',
    category: 'read',
    required: [],
    optional: [],
    handler: async () => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const farms = await dbQuery('SELECT COUNT(*) AS total FROM farms').catch(() => ({ rows: [{ total: 0 }] }));
        const sessions = await dbQuery(
          `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'completed') AS completed
           FROM checkout_sessions`
        ).catch(() => ({ rows: [{ total: 0, completed: 0 }] }));
        return {
          ok: true,
          total_farms: Number(farms.rows[0]?.total || 0),
          checkout_sessions: Number(sessions.rows[0]?.total || 0),
          completed_purchases: Number(sessions.rows[0]?.completed || 0)
        };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── E.V.I.E. Health ──

  'get_evie_engagement': {
    description: 'Get E.V.I.E. AI assistant usage metrics — sessions, messages, feedback, cost.',
    category: 'read',
    required: [],
    optional: ['days'],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const days = parseInt(params.days, 10) || 7;
        const usage = await dbQuery(`
          SELECT COUNT(*) AS total_calls,
                 SUM(total_tokens) AS total_tokens,
                 SUM(estimated_cost) AS total_cost
          FROM ai_usage
          WHERE endpoint = 'assistant-chat'
            AND created_at >= NOW() - ($1 || ' days')::interval
        `, [days]);
        const feedback = await dbQuery(`
          SELECT rating, COUNT(*) AS count
          FROM assistant_feedback
          WHERE created_at >= NOW() - ($1 || ' days')::interval
          GROUP BY rating
        `, [days]).catch(() => ({ rows: [] }));
        return {
          ok: true, period_days: days,
          calls: Number(usage.rows[0]?.total_calls || 0),
          tokens: Number(usage.rows[0]?.total_tokens || 0),
          cost: Number(Number(usage.rows[0]?.total_cost || 0).toFixed(4)),
          feedback: feedback.rows
        };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── Email & Communications ──

  'get_email_status': {
    description: 'Check email service (AWS SES) connectivity and recent send status.',
    category: 'read',
    required: [],
    optional: [],
    handler: async () => {
      try {
        const emailService = (await import('../services/email-service.js')).default;
        const testResult = await emailService.sendEmail({
          to: 'health-check@internal.test',
          subject: 'F.A.Y.E. SES health check',
          text: 'Connectivity test'
        });
        return {
          ok: true,
          ses_configured: !testResult.stub,
          stub_mode: !!testResult.stub,
          from_email: process.env.FROM_EMAIL || process.env.EMAIL_FROM || 'noreply@greenreachgreens.com'
        };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── ESG & Sustainability ──

  'get_esg_summary': {
    description: 'Get ESG (Environmental, Social, Governance) scoring summary across the network.',
    category: 'read',
    required: [],
    optional: [],
    handler: async () => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const result = await dbQuery(`
          SELECT farm_id, overall_score, environmental_score, social_score, governance_score,
                 grade, assessed_at
          FROM esg_assessments
          ORDER BY assessed_at DESC
        `).catch(() => ({ rows: [] }));
        return { ok: true, assessments: result.rows };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  }
};

// ── Build Anthropic tool definitions from catalog ──

export function buildToolDefinitions() {
  return Object.entries(ADMIN_TOOL_CATALOG).map(([name, tool]) => ({
    name,
    description: tool.description,
    input_schema: {
      type: 'object',
      properties: Object.fromEntries(
        [...tool.required, ...tool.optional].map(p => [p, { type: 'string', description: p }])
      ),
      required: tool.required
    }
  }));
}

// ── Execute a tool by name ──

export async function executeAdminTool(toolName, params = {}) {
  const tool = ADMIN_TOOL_CATALOG[toolName];
  if (!tool) return { ok: false, error: `Unknown tool: ${toolName}` };

  const missing = tool.required.filter(r => params[r] == null);
  if (missing.length) return { ok: false, error: `Missing required parameters: ${missing.join(', ')}` };

  const startTime = Date.now();
  const result = await tool.handler(params);
  result._duration_ms = Date.now() - startTime;
  return result;
}

// ── Tool Gateway Endpoint ──

router.post('/tool-gateway', async (req, res) => {
  const { tool, params = {} } = req.body;
  if (!tool) return res.status(400).json({ ok: false, error: 'Missing required field: tool' });

  const toolDef = ADMIN_TOOL_CATALOG[tool];
  if (!toolDef) {
    return res.status(404).json({
      ok: false, error: `Unknown tool: ${tool}`,
      available_tools: Object.keys(ADMIN_TOOL_CATALOG)
    });
  }

  const missing = toolDef.required.filter(r => params[r] == null);
  if (missing.length) {
    return res.status(400).json({ ok: false, error: `Missing required parameters: ${missing.join(', ')}` });
  }

  const result = await executeAdminTool(tool, params);
  return res.json({ ok: true, tool, result });
});

router.get('/tool-catalog', (_req, res) => {
  const catalog = Object.entries(ADMIN_TOOL_CATALOG).map(([name, t]) => ({
    name, description: t.description, category: t.category,
    required: t.required, optional: t.optional
  }));
  return res.json({ ok: true, tool_count: catalog.length, tools: catalog });
});

export default router;
