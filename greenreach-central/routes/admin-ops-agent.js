/**
 * F.A.Y.E. Admin Operations Agent — Tool Catalog & Gateway
 * Farm Autonomy & Yield Engine
 *
 * Phase 1: READ tools across all GreenReach domains.
 * Phase 2: WRITE tools with trust-tier safety gates.
 * Phase 4: Analytics & trend tools.
 * Mirrors E.V.I.E.'s farm-ops-agent.js pattern for the admin/management side.
 */
import express from 'express';
import { query as dbQuery, isDatabaseAvailable } from '../config/database.js';
import { listAllOrders, listPayments, listRefunds, listAllBuyers, createRefund, getOrderById } from '../services/wholesaleMemoryStore.js';
import { listNetworkFarms } from '../services/networkFarmsStore.js';
import emailService from '../services/email-service.js';

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
  },

  // ══════════════════════════════════════════════════════════════
  // Phase 2: WRITE Tools (trust-tier gated)
  // ══════════════════════════════════════════════════════════════

  // ── Alerts Management ──

  'create_alert': {
    description: 'Create a new admin alert for an operational issue. Use when anomalies or problems are detected.',
    category: 'write',
    trust_tier: 'auto',
    required: ['domain', 'severity', 'title'],
    optional: ['detail', 'source', 'metadata'],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const result = await dbQuery(
          `INSERT INTO admin_alerts (domain, severity, title, detail, source, metadata)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
          [params.domain, params.severity, params.title, params.detail || null,
           params.source || 'faye', JSON.stringify(params.metadata || {})]
        );
        return { ok: true, alert_id: result.rows[0].id, created_at: result.rows[0].created_at };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'acknowledge_alert': {
    description: 'Mark an admin alert as acknowledged. Requires the alert ID.',
    category: 'write',
    trust_tier: 'auto',
    required: ['alert_id'],
    optional: ['admin_id'],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const result = await dbQuery(
          `UPDATE admin_alerts SET acknowledged = TRUE, acknowledged_by = $2, acknowledged_at = NOW()
           WHERE id = $1 AND acknowledged = FALSE RETURNING id`,
          [parseInt(params.alert_id, 10), params.admin_id ? parseInt(params.admin_id, 10) : null]
        );
        if (result.rows.length === 0) return { ok: false, error: 'Alert not found or already acknowledged' };
        return { ok: true, alert_id: result.rows[0].id };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'resolve_alert': {
    description: 'Mark an admin alert as resolved. Requires the alert ID.',
    category: 'write',
    trust_tier: 'quick_confirm',
    required: ['alert_id'],
    optional: [],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const result = await dbQuery(
          `UPDATE admin_alerts SET resolved = TRUE, resolved_at = NOW()
           WHERE id = $1 AND resolved = FALSE RETURNING id`,
          [parseInt(params.alert_id, 10)]
        );
        if (result.rows.length === 0) return { ok: false, error: 'Alert not found or already resolved' };
        return { ok: true, alert_id: result.rows[0].id };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── Accounting Write Tools ──

  'classify_transaction': {
    description: 'Classify an unclassified accounting transaction. Assigns a category and updates the classification status.',
    category: 'write',
    trust_tier: 'confirm',
    required: ['transaction_id', 'category'],
    optional: ['confidence', 'notes'],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const txnCheck = await dbQuery('SELECT id, description, total_amount FROM accounting_transactions WHERE id = $1', [parseInt(params.transaction_id, 10)]);
        if (txnCheck.rows.length === 0) return { ok: false, error: 'Transaction not found' };

        await dbQuery(
          `INSERT INTO accounting_classifications (transaction_id, suggested_category, confidence, status, reviewer, approved_at)
           VALUES ($1, $2, $3, 'classified', 'faye', NOW())
           ON CONFLICT (transaction_id)
           DO UPDATE SET suggested_category = $2, confidence = $3, status = 'classified', reviewer = 'faye', approved_at = NOW()`,
          [parseInt(params.transaction_id, 10), params.category, parseFloat(params.confidence) || 0.9]
        );
        return { ok: true, transaction_id: params.transaction_id, category: params.category, txn: txnCheck.rows[0] };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── Order & Refund Write Tools ──

  'process_refund': {
    description: 'Process a refund for a wholesale order. CRITICAL: Verify order exists and payment is refundable before calling. Requires explicit admin confirmation.',
    category: 'write',
    trust_tier: 'admin',
    required: ['order_id', 'amount', 'reason'],
    optional: ['admin_id'],
    handler: async (params) => {
      try {
        const order = await getOrderById(params.order_id);
        if (!order) return { ok: false, error: `Order ${params.order_id} not found` };

        const amount = parseFloat(params.amount);
        if (isNaN(amount) || amount <= 0) return { ok: false, error: 'Invalid refund amount' };
        if (amount > parseFloat(order.grand_total || order.total || 0)) {
          return { ok: false, error: `Refund amount $${amount} exceeds order total $${order.grand_total || order.total}` };
        }

        const refund = await createRefund({
          orderId: params.order_id,
          amount,
          reason: params.reason,
          adminId: params.admin_id || 'faye'
        });
        return { ok: true, refund };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── Communication Tools ──

  'send_admin_email': {
    description: 'Send an email to a GreenReach admin or operations team member. Use for escalations, reports, or critical alerts.',
    category: 'write',
    trust_tier: 'confirm',
    required: ['to', 'subject', 'body'],
    optional: [],
    handler: async (params) => {
      try {
        const result = await emailService.sendEmail({
          to: params.to,
          subject: `[F.A.Y.E.] ${params.subject}`,
          text: params.body,
          html: `<div style="font-family:sans-serif;max-width:600px"><h3 style="color:#10b981">F.A.Y.E. — Operations Alert</h3><div style="white-space:pre-wrap">${params.body.replace(/</g, '&lt;')}</div><hr style="border:none;border-top:1px solid #ddd;margin:20px 0"><p style="font-size:12px;color:#888">Sent by F.A.Y.E. (Farm Autonomy & Yield Engine)</p></div>`
        });
        return { ok: true, messageId: result.messageId, stub: result.stub || false };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── Farm Management Write Tools ──

  'update_farm_notes': {
    description: 'Update internal notes for a farm in the network. Used for tracking issues, observations, and admin annotations.',
    category: 'write',
    trust_tier: 'auto',
    required: ['farm_id', 'notes'],
    optional: [],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const result = await dbQuery(
          `UPDATE farms SET admin_notes = COALESCE(admin_notes, '') || E'\\n' || $2, updated_at = NOW()
           WHERE farm_id = $1 RETURNING farm_id, farm_name`,
          [params.farm_id, `[${new Date().toISOString()}] ${params.notes}`]
        );
        if (result.rows.length === 0) return { ok: false, error: 'Farm not found' };
        return { ok: true, farm: result.rows[0] };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── Memory / Learning Tools ──

  'save_admin_memory': {
    description: 'Save a persistent note or preference for the current admin. Used to remember instructions, preferences, or operational context.',
    category: 'write',
    trust_tier: 'auto',
    required: ['key', 'value'],
    optional: ['admin_id'],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        await dbQuery(
          `INSERT INTO admin_assistant_memory (admin_id, key, value, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (admin_id, key)
           DO UPDATE SET value = $3, updated_at = NOW()`,
          [parseInt(params.admin_id, 10) || 0, params.key.slice(0, 100), String(params.value).slice(0, 2000)]
        );
        return { ok: true, key: params.key };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ══════════════════════════════════════════════════════════════
  // Phase 4: Analytics & Trend Tools
  // ══════════════════════════════════════════════════════════════

  'analyze_revenue_trend': {
    description: 'Analyze revenue trends over time — daily/weekly/monthly breakdown with growth rates and forecasting.',
    category: 'read',
    required: [],
    optional: ['days', 'granularity'],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const days = parseInt(params.days, 10) || 90;
        const gran = params.granularity === 'weekly' ? 'week' : params.granularity === 'monthly' ? 'month' : 'day';
        const result = await dbQuery(`
          SELECT date_trunc($2, t.txn_date)::date AS period,
                 COUNT(*) AS order_count,
                 SUM(t.total_amount) AS revenue
          FROM accounting_transactions t
          JOIN accounting_sources s ON t.source_id = s.id
          WHERE s.source_key LIKE 'wholesale_%'
            AND t.txn_date >= CURRENT_DATE - $1::int
          GROUP BY period ORDER BY period ASC
        `, [days, gran]);

        const periods = result.rows;
        // Calculate growth rates
        for (let i = 1; i < periods.length; i++) {
          const prev = Number(periods[i - 1].revenue) || 1;
          periods[i].growth_pct = (((Number(periods[i].revenue) - prev) / prev) * 100).toFixed(1);
        }
        const totalRevenue = periods.reduce((s, p) => s + Number(p.revenue || 0), 0);
        const avgPeriod = periods.length > 0 ? totalRevenue / periods.length : 0;

        return {
          ok: true, days, granularity: gran,
          periods, total_revenue: totalRevenue.toFixed(2),
          avg_per_period: avgPeriod.toFixed(2),
          period_count: periods.length
        };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'analyze_order_patterns': {
    description: 'Analyze order patterns — peak days, buyer concentration, average basket size, repeat rate.',
    category: 'read',
    required: [],
    optional: ['days'],
    handler: async (params) => {
      try {
        const allOrders = await listAllOrders({ limit: 500 });
        const orders = allOrders.orders || allOrders;
        const days = parseInt(params.days, 10) || 30;
        const cutoff = new Date(Date.now() - days * 86400000);
        const recent = orders.filter(o => new Date(o.created_at) > cutoff);

        // Day-of-week distribution
        const dayDist = [0, 0, 0, 0, 0, 0, 0];
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        recent.forEach(o => dayDist[new Date(o.created_at).getDay()]++);

        // Buyer concentration
        const buyerCounts = {};
        recent.forEach(o => {
          const buyer = o.buyer_account?.email || o.buyer_id || 'unknown';
          buyerCounts[buyer] = (buyerCounts[buyer] || 0) + 1;
        });
        const topBuyers = Object.entries(buyerCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([buyer, count]) => ({ buyer, orders: count, pct: ((count / recent.length) * 100).toFixed(1) }));

        // Basket size
        const totals = recent.map(o => parseFloat(o.grand_total || o.total || 0)).filter(t => t > 0);
        const avgBasket = totals.length > 0 ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;

        return {
          ok: true, period_days: days, total_orders: recent.length,
          day_of_week: dayNames.map((d, i) => ({ day: d, orders: dayDist[i] })),
          peak_day: dayNames[dayDist.indexOf(Math.max(...dayDist))],
          top_buyers: topBuyers,
          avg_basket_size: avgBasket.toFixed(2),
          unique_buyers: Object.keys(buyerCounts).length
        };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'analyze_farm_performance': {
    description: 'Compare farm performance across the network — fulfillment rates, revenue contribution, reliability scores.',
    category: 'read',
    required: [],
    optional: ['days'],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const days = parseInt(params.days, 10) || 30;
        // Revenue per farm from accounting ledger
        const revenue = await dbQuery(`
          SELECT t.raw_payload->>'farm_id' AS farm_id,
                 t.raw_payload->>'farm_name' AS farm_name,
                 COUNT(*) AS order_count,
                 SUM(t.total_amount) AS total_revenue
          FROM accounting_transactions t
          JOIN accounting_sources s ON t.source_id = s.id
          WHERE s.source_key LIKE 'wholesale_%'
            AND t.txn_date >= CURRENT_DATE - $1::int
            AND t.raw_payload->>'farm_id' IS NOT NULL
          GROUP BY t.raw_payload->>'farm_id', t.raw_payload->>'farm_name'
          ORDER BY total_revenue DESC
        `, [days]);

        // Heartbeat reliability
        const heartbeats = await dbQuery(`
          SELECT farm_id,
                 EXTRACT(EPOCH FROM (NOW() - last_seen_at)) AS seconds_since,
                 cpu_percent, memory_percent
          FROM farm_heartbeats
        `).catch(() => ({ rows: [] }));
        const hbMap = Object.fromEntries(heartbeats.rows.map(h => [h.farm_id, h]));

        const farms = revenue.rows.map(r => ({
          farm_id: r.farm_id, farm_name: r.farm_name,
          order_count: Number(r.order_count),
          revenue: Number(Number(r.total_revenue).toFixed(2)),
          online: hbMap[r.farm_id] ? hbMap[r.farm_id].seconds_since < 900 : null,
          cpu: hbMap[r.farm_id]?.cpu_percent, memory: hbMap[r.farm_id]?.memory_percent
        }));

        return { ok: true, period_days: days, farms };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_anomaly_report': {
    description: 'Get the latest anomaly detection report — payment failures, stale farms, order volume spikes, accounting imbalances.',
    category: 'read',
    required: [],
    optional: [],
    handler: async () => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const result = await dbQuery(`
          SELECT * FROM admin_alerts
          WHERE created_at > NOW() - INTERVAL '24 hours'
          ORDER BY created_at DESC LIMIT 20
        `);
        return { ok: true, anomalies: result.rows, count: result.rows.length };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_decision_log': {
    description: 'Get the F.A.Y.E. decision log — actions taken, confirmations given, patterns recognized.',
    category: 'read',
    required: [],
    optional: ['days', 'limit'],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const days = parseInt(params.days, 10) || 7;
        const limit = parseInt(params.limit, 10) || 20;
        const result = await dbQuery(`
          SELECT * FROM faye_decision_log
          WHERE created_at > NOW() - ($1 || ' days')::interval
          ORDER BY created_at DESC LIMIT $2
        `, [days, limit]);
        return { ok: true, decisions: result.rows, count: result.rows.length };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── Learning & Knowledge ──

  'store_insight': {
    description: 'Store a learned insight into F.A.Y.E.\'s knowledge base. Use this when you discover something worth remembering for future operations — patterns, admin preferences, operational facts, or lessons learned.',
    category: 'write',
    required: ['domain', 'topic', 'insight'],
    optional: ['confidence'],
    handler: async (params) => {
      try {
        const { storeInsight } = await import('../services/faye-learning.js');
        const confidence = parseFloat(params.confidence) || 0.7;
        const id = await storeInsight(params.domain, params.topic, params.insight, 'conversation', confidence);
        return id ? { ok: true, id, message: `Insight stored: ${params.domain}/${params.topic}` } : { ok: false, error: 'Failed to store insight' };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_knowledge': {
    description: 'Retrieve learned insights from F.A.Y.E.\'s knowledge base. Filter by domain (accounting, farm_network, orders, operations, commerce, delivery) or get all.',
    category: 'read',
    required: [],
    optional: ['domain', 'limit'],
    handler: async (params) => {
      try {
        if (params.domain) {
          const { getInsights } = await import('../services/faye-learning.js');
          const insights = await getInsights(params.domain, parseInt(params.limit, 10) || 10);
          return { ok: true, insights, count: insights.length };
        }
        const { getTopInsights } = await import('../services/faye-learning.js');
        const insights = await getTopInsights(parseInt(params.limit, 10) || 15);
        return { ok: true, insights, count: insights.length };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'search_knowledge': {
    description: 'Search F.A.Y.E.\'s knowledge base by keyword. Finds relevant insights across all domains.',
    category: 'read',
    required: ['keyword'],
    optional: ['limit'],
    handler: async (params) => {
      try {
        const { searchInsights } = await import('../services/faye-learning.js');
        const results = await searchInsights(params.keyword, parseInt(params.limit, 10) || 10);
        return { ok: true, results, count: results.length };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'archive_insight': {
    description: 'Archive (soft-delete) a learned insight that is no longer valid or accurate.',
    category: 'write',
    required: ['domain', 'topic'],
    optional: [],
    handler: async (params) => {
      try {
        const { archiveInsight } = await import('../services/faye-learning.js');
        const ok = await archiveInsight(params.domain, params.topic);
        return { ok, message: ok ? `Archived: ${params.domain}/${params.topic}` : 'Insight not found' };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'record_outcome': {
    description: 'Record the outcome of a previous recommendation or action. Links to a decision_log entry if available. Outcome should be: positive, negative, neutral, or false_positive.',
    category: 'write',
    required: ['outcome', 'feedback'],
    optional: ['decision_id'],
    handler: async (params) => {
      try {
        const { recordOutcome } = await import('../services/faye-learning.js');
        const adminId = params.admin_id || 0;
        const id = await recordOutcome(
          params.decision_id ? parseInt(params.decision_id, 10) : null,
          params.outcome,
          params.feedback,
          adminId
        );
        return id ? { ok: true, id, message: `Outcome recorded: ${params.outcome}` } : { ok: false, error: 'Failed to record outcome' };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'rate_alert': {
    description: 'Rate the accuracy of an alert. Was it a true alert or a false positive? Helps F.A.Y.E. learn to reduce noise.',
    category: 'write',
    required: ['alert_id', 'accurate'],
    optional: ['notes'],
    handler: async (params) => {
      try {
        const { trackAlertAccuracy } = await import('../services/faye-learning.js');
        const wasAccurate = params.accurate === 'true' || params.accurate === true;
        const ok = await trackAlertAccuracy(parseInt(params.alert_id, 10), wasAccurate, params.notes);
        return { ok, message: ok ? `Alert ${params.alert_id} rated: ${wasAccurate ? 'accurate' : 'false positive'}` : 'Failed to rate alert' };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_patterns': {
    description: 'Get recognized recurring patterns across operations. Shows patterns like repeated farm outages, recurring order anomalies, etc.',
    category: 'read',
    required: [],
    optional: ['domain', 'limit'],
    handler: async (params) => {
      try {
        const { getPatterns } = await import('../services/faye-learning.js');
        const patterns = await getPatterns(params.domain || null, parseInt(params.limit, 10) || 10);
        return { ok: true, patterns, count: patterns.length };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_outcome_stats': {
    description: 'Get outcome statistics for F.A.Y.E.\'s recommendations. Shows success/failure rates by tool or overall.',
    category: 'read',
    required: [],
    optional: ['tool_name', 'days'],
    handler: async (params) => {
      try {
        const { getOutcomeStats } = await import('../services/faye-learning.js');
        const stats = await getOutcomeStats(params.tool_name || null, parseInt(params.days, 10) || 30);
        return stats ? { ok: true, ...stats } : { ok: false, error: 'Failed to get outcome stats' };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  }
};

// ── Trust Tier Definitions ────────────────────────────────────────
// AUTO: Execute immediately (low-risk reads & safe writes)
// QUICK_CONFIRM: Execute with brief undo window
// CONFIRM: Describe impact, require admin to say "yes"
// ADMIN: Critical action — require admin to type the action name

export const TRUST_TIERS = {
  auto: new Set(['create_alert', 'acknowledge_alert', 'save_admin_memory', 'update_farm_notes', 'store_insight', 'record_outcome', 'rate_alert']),
  quick_confirm: new Set(['resolve_alert', 'classify_transaction', 'archive_insight']),
  confirm: new Set(['send_admin_email']),
  admin: new Set(['process_refund'])
};

export function getTrustTier(toolName) {
  const tool = ADMIN_TOOL_CATALOG[toolName];
  if (!tool || tool.category === 'read') return 'auto';
  if (TRUST_TIERS.auto.has(toolName)) return 'auto';
  if (TRUST_TIERS.quick_confirm.has(toolName)) return 'quick_confirm';
  if (TRUST_TIERS.admin.has(toolName)) return 'admin';
  if (TRUST_TIERS.confirm.has(toolName)) return 'confirm';
  return 'confirm'; // Default for unknown writes
}

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
