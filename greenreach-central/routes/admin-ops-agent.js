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
import smsService from '../services/sms-service.js';

const router = express.Router();

// ── External Market Data: Approved Sources ────────────────────
// Only these domains may be contacted for market intelligence.
// Adding a source requires a code change + deploy (intentional safety gate).
const APPROVED_MARKET_SOURCES = [
  {
    id: 'usda_mars',
    name: 'USDA Market News',
    baseUrl: 'https://marketnews.usda.gov/mnp/api',
    description: 'USDA Agricultural Marketing Service -- fruit, vegetable, and specialty crop prices'
  },
  {
    id: 'usda_nass',
    name: 'USDA NASS QuickStats',
    baseUrl: 'https://quickstats.nass.usda.gov/api',
    description: 'USDA National Agricultural Statistics Service -- crop production and pricing'
  },
  {
    id: 'statcan_aafc',
    name: 'StatCan / AAFC',
    baseUrl: 'https://www150.statcan.gc.ca/t1/tbl1/en',
    description: 'Statistics Canada Agriculture and Agri-Food -- Canadian farm product pricing'
  }
];

// Rate limit: max external market fetches per hour
const MARKET_FETCH_LIMIT = 10;
let marketFetchCount = 0;
let marketFetchWindowStart = Date.now();

function checkMarketRateLimit() {
  const now = Date.now();
  if (now - marketFetchWindowStart > 3600000) {
    marketFetchCount = 0;
    marketFetchWindowStart = now;
  }
  if (marketFetchCount >= MARKET_FETCH_LIMIT) return false;
  marketFetchCount++;
  return true;
}

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

  'fetch_market_trends': {
    description: 'Fetch external market price data from approved government agricultural sources (USDA Market News, USDA NASS, StatCan AAFC). READ ONLY -- retrieves pricing trends for crops relevant to GreenReach operations. Results are stored in the internal market_price_observations table for audit. Rate limited to 10 fetches per hour. Use this to supplement internal market data with current external benchmarks.',
    category: 'read',
    required: ['source', 'crop'],
    optional: ['date_range'],
    handler: async (params) => {
      try {
        // Validate source is in allowlist
        const source = APPROVED_MARKET_SOURCES.find(s => s.id === params.source);
        if (!source) {
          return {
            ok: false,
            error: `Unknown source: ${params.source}. Approved sources: ${APPROVED_MARKET_SOURCES.map(s => s.id).join(', ')}`,
            approved_sources: APPROVED_MARKET_SOURCES.map(s => ({ id: s.id, name: s.name, description: s.description }))
          };
        }

        // Rate limit check
        if (!checkMarketRateLimit()) {
          return { ok: false, error: 'Market data rate limit exceeded (max 10 fetches per hour). Try again later or use get_market_overview for cached data.' };
        }

        const crop = (params.crop || '').trim();
        if (!crop) return { ok: false, error: 'Crop name is required' };

        // Build request URL based on source
        let url;
        const encodedCrop = encodeURIComponent(crop);
        if (source.id === 'usda_mars') {
          url = `${source.baseUrl}/search?commodity=${encodedCrop}&format=json`;
        } else if (source.id === 'usda_nass') {
          const apiKey = process.env.USDA_NASS_API_KEY;
          if (!apiKey) return { ok: false, error: 'USDA NASS API key not configured (USDA_NASS_API_KEY env var)' };
          url = `${source.baseUrl}/api_GET/?key=${apiKey}&commodity_desc=${encodedCrop}&format=json&year__GE=${new Date().getFullYear() - 1}`;
        } else if (source.id === 'statcan_aafc') {
          url = `${source.baseUrl}/dtl!downloadEntireTable.action?pid=3210000701&lang=en`;
        }

        console.log(`[market] Fetching from ${source.name}: ${crop}`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        let data;
        try {
          const resp = await fetch(url, {
            headers: { 'User-Agent': 'GreenReach-FAYE/1.0 (agricultural-market-research)' },
            signal: controller.signal
          });
          clearTimeout(timeout);
          if (!resp.ok) {
            return { ok: false, error: `${source.name} returned HTTP ${resp.status}`, source: source.id };
          }
          const contentType = resp.headers.get('content-type') || '';
          if (contentType.includes('json')) {
            data = await resp.json();
          } else {
            const text = await resp.text();
            data = { raw_text: text.substring(0, 5000), note: 'Non-JSON response truncated to 5000 chars' };
          }
        } catch (fetchErr) {
          clearTimeout(timeout);
          return { ok: false, error: `Failed to reach ${source.name}: ${fetchErr.message}`, source: source.id };
        }

        // Store observation in audit table
        if (isDatabaseAvailable()) {
          try {
            await dbQuery(
              `INSERT INTO market_price_observations (product, source, observed_at, raw_data)
               VALUES ($1, $2, NOW(), $3)
               ON CONFLICT DO NOTHING`,
              [crop, source.id, JSON.stringify(data).substring(0, 10000)]
            );
          } catch (_dbErr) { /* non-fatal audit logging */ }
        }

        return {
          ok: true,
          source: { id: source.id, name: source.name },
          crop,
          data,
          fetched_at: new Date().toISOString(),
          note: 'External market data -- review only. Cross-reference with internal get_market_overview for validated pricing.'
        };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_approved_market_sources': {
    description: 'List the approved external data sources for market trend research. F.A.Y.E. may only fetch data from these pre-approved government agricultural sources.',
    category: 'read',
    required: [],
    optional: [],
    handler: async () => {
      return {
        ok: true,
        sources: APPROVED_MARKET_SOURCES.map(s => ({ id: s.id, name: s.name, description: s.description })),
        rate_limit: `${MARKET_FETCH_LIMIT} fetches per hour`,
        remaining: Math.max(0, MARKET_FETCH_LIMIT - marketFetchCount)
      };
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

  'send_sms': {
    description: 'Send an SMS text message to the approved GreenReach operations phone number (613-888-1031). Use for urgent alerts, time-sensitive notifications, or operational updates that need immediate attention. Recipient is hardcoded -- you cannot choose who receives the text.',
    category: 'write',
    trust_tier: 'confirm',
    required: ['message'],
    optional: [],
    handler: async (params) => {
      try {
        const message = `[F.A.Y.E.] ${params.message}`;
        const result = await smsService.sendSms({
          to: '+16138881031',
          message
        });
        if (result.success) {
          return { ok: true, messageId: result.messageId, recipient: '613-888-1031', stub: result.stub || false };
        }
        return { ok: false, error: result.error };
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
  },

  // ── Autonomy & Domain Ownership Tools (Phase 6) ────────────────

  'evaluate_trust_promotion': {
    description: 'Evaluate whether a tool qualifies for trust tier promotion or demotion based on outcome history. Returns promotion recommendation if thresholds are met (95%+ success over 50 uses for CONFIRM->AUTO, 98%+ over 100 for ADMIN->CONFIRM). 3 consecutive failures trigger demotion.',
    category: 'read',
    required: ['tool_name', 'current_tier'],
    optional: ['days'],
    handler: async (params) => {
      try {
        const { evaluateTrustPromotion } = await import('../services/faye-learning.js');
        const result = await evaluateTrustPromotion(
          params.tool_name,
          params.current_tier,
          parseInt(params.days, 10) || 60
        );
        return result
          ? { ok: true, recommendation: result }
          : { ok: true, recommendation: null, message: 'No promotion or demotion warranted at this time' };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_domain_ownership': {
    description: 'Get F.A.Y.E.\'s current autonomy level for a specific operational domain or all domains. Levels: L0 (Reactive), L1 (Observant), L2 (Advisory), L3 (Proactive), L4 (Autonomous).',
    category: 'read',
    required: [],
    optional: ['domain'],
    handler: async (params) => {
      try {
        if (params.domain) {
          const { getDomainOwnership } = await import('../services/faye-learning.js');
          const result = await getDomainOwnership(params.domain);
          return { ok: true, ...result };
        }
        const { getAllDomainOwnership } = await import('../services/faye-learning.js');
        const results = await getAllDomainOwnership();
        return { ok: true, domains: results };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'set_domain_ownership': {
    description: 'Update F.A.Y.E.\'s autonomy level for an operational domain. Level tracks maturity (L0-L4). Confidence (0-1) tracks certainty of the assessment — these are independent. Domains: alert_triage, accounting, farm_health, orders, payments, network, evie_oversight, market_intel.',
    category: 'write',
    required: ['domain', 'level', 'detail'],
    optional: ['confidence'],
    handler: async (params) => {
      try {
        const { setDomainOwnership } = await import('../services/faye-learning.js');
        const conf = params.confidence !== undefined ? parseFloat(params.confidence) : 0.5;
        const id = await setDomainOwnership(params.domain, params.level, params.detail, conf);
        return id
          ? { ok: true, message: `Domain ${params.domain} set to ${params.level} (confidence: ${conf})`, id }
          : { ok: false, error: 'Failed to set domain ownership — check domain name, level, and confidence range' };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── Shadow Mode & Policy Tools (Phase 6.1) ─────────────────────

  'log_shadow_decision': {
    description: 'Log a shadow mode decision: what F.A.Y.E. would have done vs what the admin actually decided. Used to validate trust tier promotions before they become permanent.',
    category: 'write',
    required: ['tool_name', 'action_class', 'proposed_action', 'actual_outcome'],
    optional: ['proposed_params'],
    handler: async (params) => {
      try {
        const { logShadowDecision } = await import('../services/faye-policy.js');
        const id = await logShadowDecision(
          params.tool_name,
          params.action_class,
          params.proposed_action,
          params.proposed_params || '{}',
          params.actual_outcome
        );
        return id
          ? { ok: true, message: 'Shadow decision logged', id }
          : { ok: false, error: 'Failed to log shadow decision' };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_shadow_accuracy': {
    description: 'Get shadow mode accuracy for a tool: how often F.A.Y.E.\'s proposed action matched the admin\'s actual decision. Used to validate promotion readiness.',
    category: 'read',
    required: ['tool_name'],
    optional: ['days'],
    handler: async (params) => {
      try {
        const { getShadowAccuracy } = await import('../services/faye-policy.js');
        const result = await getShadowAccuracy(params.tool_name, parseInt(params.days, 10) || 30);
        return result
          ? { ok: true, ...result }
          : { ok: false, error: 'Failed to get shadow accuracy' };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_action_class': {
    description: 'Get the action class and effective trust tier for a tool. Action classes: recommend, classify, notify, modify, transact, override.',
    category: 'read',
    required: ['tool_name'],
    optional: [],
    handler: async (params) => {
      try {
        const { getActionClass, getActionClassTier, getHardBoundaryCap } = await import('../services/faye-policy.js');
        return {
          ok: true,
          tool: params.tool_name,
          action_class: getActionClass(params.tool_name),
          default_tier: getActionClassTier(params.tool_name),
          hard_boundary_cap: getHardBoundaryCap(params.tool_name)
        };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── Inter-Agent Communication (F.A.Y.E. <-> E.V.I.E.) ─────────

  'send_message_to_evie': {
    description: 'Send a message to E.V.I.E. — your subordinate agent. Use for directives (instructions), observations (shared intelligence), responses (replying to escalations), or status updates. Messages are persisted and E.V.I.E. will see them in her next interaction. Priority: low, normal, high, critical.',
    category: 'write',
    required: ['message_type', 'subject', 'body'],
    optional: ['priority', 'context', 'reply_to_id'],
    handler: async (params) => {
      try {
        const { sendAgentMessage } = await import('../services/faye-learning.js');
        const context = params.context ? JSON.parse(params.context) : {};
        const result = await sendAgentMessage(
          'faye', 'evie',
          params.message_type,
          params.subject,
          params.body,
          context,
          params.priority || 'normal',
          params.reply_to_id ? parseInt(params.reply_to_id, 10) : null
        );
        return result
          ? { ok: true, message: `Message sent to E.V.I.E.: "${params.subject}"`, message_id: result.id }
          : { ok: false, error: 'Failed to send message to E.V.I.E.' };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_evie_messages': {
    description: 'Get messages from E.V.I.E. — escalations, observations, and status updates she has sent you. Shows unread messages by default. Use this to check for escalated grower issues and cross-farm patterns.',
    category: 'read',
    required: [],
    optional: ['include_read', 'message_type', 'limit'],
    handler: async (params) => {
      try {
        const { getUnreadMessages, getAgentMessageHistory, markMessagesRead } = await import('../services/faye-learning.js');
        let messages;
        if (params.include_read === 'true') {
          messages = await getAgentMessageHistory(parseInt(params.limit, 10) || 30, params.message_type || null);
          messages = messages.filter(m => m.recipient === 'faye' || m.sender === 'faye');
        } else {
          messages = await getUnreadMessages('faye', parseInt(params.limit, 10) || 20);
        }
        // Auto-mark unread as read
        const unreadIds = messages.filter(m => m.status === 'unread' && m.recipient === 'faye').map(m => m.id);
        if (unreadIds.length > 0) {
          await markMessagesRead('faye', unreadIds);
        }
        return { ok: true, count: messages.length, messages };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_agent_conversation': {
    description: 'Get the full message thread between F.A.Y.E. and E.V.I.E. for a specific context — e.g. all messages about a farm, order, or alert. Pass context_key and context_value to filter.',
    category: 'read',
    required: ['context_key', 'context_value'],
    optional: ['limit'],
    handler: async (params) => {
      try {
        const { getMessagesByContext } = await import('../services/faye-learning.js');
        const messages = await getMessagesByContext(
          params.context_key, params.context_value,
          parseInt(params.limit, 10) || 20
        );
        return { ok: true, count: messages.length, messages };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── Conversation History Recall ────────────────────────────────

  'recall_conversations': {
    description: 'Recall past conversation summaries from previous sessions. Use this when you need context about what was discussed in earlier conversations with the admin — topics, decisions, action items, and key metrics. Defaults to the last 30 days.',
    category: 'read',
    required: [],
    optional: ['days', 'limit'],
    handler: async (params) => {
      try {
        const { getConversationRecap } = await import('../services/faye-learning.js');
        const adminId = params.admin_id || 'unknown';
        const recap = await getConversationRecap(
          adminId,
          parseInt(params.days, 10) || 30,
          parseInt(params.limit, 10) || 20
        );
        return {
          ok: true,
          count: recap.length,
          summaries: recap.map(r => ({
            summary: r.summary,
            message_count: r.message_count,
            date: new Date(r.created_at).toLocaleDateString('en-CA')
          }))
        };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'search_past_conversations': {
    description: 'Search past conversations and summaries by keyword. Use this when you need to find specific topics, decisions, or context from prior sessions. Returns matching conversation fragments and summaries.',
    category: 'read',
    required: ['keyword'],
    optional: ['limit'],
    handler: async (params) => {
      try {
        const { searchConversationHistory } = await import('../services/faye-learning.js');
        const adminId = params.admin_id || 'unknown';
        const results = await searchConversationHistory(
          adminId,
          params.keyword,
          parseInt(params.limit, 10) || 10
        );
        return { ok: true, count: results.length, results };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── Security Audit ────────────────────────────────────────────

  'run_security_audit': {
    description: 'Run a security audit across GreenReach systems. Checks for: auth failures in recent alerts, stale API sessions, hard boundary integrity, admin access patterns, and unresolved critical alerts. Returns a structured report with findings and risk score.',
    category: 'read',
    required: [],
    optional: ['days'],
    handler: async (params) => {
      try {
        const days = parseInt(params.days, 10) || 7;
        const findings = [];
        let riskScore = 0;

        if (await isDatabaseAvailable()) {
          // 1. Auth-related alerts (failed logins, access denials)
          const authAlerts = await dbQuery(
            `SELECT COUNT(*) AS cnt FROM admin_alerts
             WHERE (domain = 'auth' OR title ILIKE '%auth%' OR title ILIKE '%login%' OR title ILIKE '%denied%')
               AND created_at > NOW() - ($1 || ' days')::interval`,
            [days]
          );
          const authCount = Number(authAlerts.rows[0]?.cnt || 0);
          if (authCount > 0) {
            findings.push({ category: 'authentication', severity: authCount > 10 ? 'high' : 'medium', detail: `${authCount} auth-related alerts in the last ${days} days` });
            riskScore += authCount > 10 ? 3 : 1;
          }

          // 2. Unresolved critical alerts
          const critAlerts = await dbQuery(
            `SELECT COUNT(*) AS cnt FROM admin_alerts
             WHERE severity = 'critical' AND resolved = FALSE
               AND created_at > NOW() - ($1 || ' days')::interval`,
            [days]
          );
          const critCount = Number(critAlerts.rows[0]?.cnt || 0);
          if (critCount > 0) {
            findings.push({ category: 'unresolved_critical', severity: 'high', detail: `${critCount} unresolved critical alerts` });
            riskScore += critCount * 2;
          }

          // 3. Stale farm connections (potential security issue)
          const staleFarms = await dbQuery(
            `SELECT COUNT(*) AS cnt FROM farm_heartbeats
             WHERE last_seen_at < NOW() - INTERVAL '24 hours'`
          );
          const staleCount = Number(staleFarms.rows[0]?.cnt || 0);
          if (staleCount > 0) {
            findings.push({ category: 'stale_connections', severity: 'medium', detail: `${staleCount} farms with no heartbeat in 24+ hours` });
            riskScore += 1;
          }

          // 4. Admin activity audit (any admin actions in period)
          const adminActions = await dbQuery(
            `SELECT COUNT(*) AS cnt FROM faye_decision_log
             WHERE created_at > NOW() - ($1 || ' days')::interval`,
            [days]
          );
          const actionCount = Number(adminActions.rows[0]?.cnt || 0);
          findings.push({ category: 'admin_activity', severity: 'info', detail: `${actionCount} admin-system actions logged in the last ${days} days` });

          // 5. Hard boundary verification
          const { HARD_BOUNDARIES } = await import('../services/faye-policy.js');
          findings.push({ category: 'hard_boundaries', severity: 'info', detail: `${HARD_BOUNDARIES.length} hard boundaries active and enforced` });

          // 6. Shadow mode accuracy check
          const { getShadowAccuracy } = await import('../services/faye-policy.js');
          const shadowStats = await getShadowAccuracy(null, days);
          if (shadowStats && shadowStats.total > 0) {
            const acc = (shadowStats.accuracy * 100).toFixed(1);
            findings.push({ category: 'shadow_validation', severity: shadowStats.accuracy < 0.8 ? 'medium' : 'info', detail: `Shadow mode accuracy: ${acc}% over ${shadowStats.total} decisions (${days}d)` });
            if (shadowStats.accuracy < 0.8) riskScore += 2;
          }
        }

        const maxRisk = 20;
        const normalizedRisk = Math.min(riskScore / maxRisk, 1.0);
        const riskLevel = normalizedRisk > 0.6 ? 'high' : normalizedRisk > 0.3 ? 'moderate' : 'low';

        return {
          ok: true,
          period_days: days,
          risk_level: riskLevel,
          risk_score: riskScore,
          finding_count: findings.length,
          findings
        };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── Feedback Recording ────────────────────────────────────────

  'record_recommendation_feedback': {
    description: 'Record admin feedback (thumbs up/down) on a F.A.Y.E. recommendation or insight. Used by the dashboard feedback buttons. Feeds the learning loop to improve future recommendations.',
    category: 'write',
    required: ['recommendation_id', 'feedback'],
    optional: ['comment'],
    handler: async (params) => {
      try {
        const { recordOutcome } = await import('../services/faye-learning.js');
        const feedback = params.feedback === 'positive' || params.feedback === 'up' ? 'positive' : 'negative';
        const id = await recordOutcome(
          params.recommendation_id,
          feedback,
          params.comment || `Admin ${feedback} feedback via dashboard`,
          params.admin_id || 'dashboard'
        );
        return id
          ? { ok: true, id, message: `Feedback recorded: ${feedback}` }
          : { ok: false, error: 'Failed to record feedback' };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── Webhook Alert Dispatch ────────────────────────────────────

  'get_webhook_config': {
    description: 'Get the current webhook notification configuration. Shows the webhook URL and which alert severities trigger notifications.',
    category: 'read',
    required: [],
    optional: [],
    handler: async () => {
      const url = process.env.FAYE_WEBHOOK_URL || null;
      return {
        ok: true,
        configured: !!url,
        url: url ? url.replace(/\/[^/]{8,}$/, '/***') : null,
        triggers: ['critical', 'high'],
        note: url ? 'Webhook active for critical and high severity alerts' : 'No FAYE_WEBHOOK_URL configured. Set this environment variable to enable webhook alerting.'
      };
    }
  },

  // ── Error Telemetry (F.A.Y.E. Diagnostics) ──────────────────────

  'get_recent_errors': {
    description: 'Get recent application errors captured server-side. Shows route, error type, message, frequency, and when they started/last occurred. Use this to diagnose issues reported by users or detected by alerts.',
    category: 'read',
    required: [],
    optional: ['hours', 'route', 'limit'],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const hours = parseInt(params.hours, 10) || 24;
        let sql = `SELECT id, method, route, status_code, error_type, message, count,
                          first_seen, last_seen
                   FROM app_errors WHERE last_seen > NOW() - ($1 || ' hours')::interval`;
        const values = [hours];
        let idx = 2;
        if (params.route) { sql += ` AND route ILIKE $${idx++}`; values.push(`%${params.route}%`); }
        sql += ' ORDER BY last_seen DESC';
        const limit = Math.min(parseInt(params.limit, 10) || 25, 50);
        sql += ` LIMIT $${idx++}`;
        values.push(limit);
        const result = await dbQuery(sql, values);
        const totalHits = result.rows.reduce((s, r) => s + r.count, 0);
        return { ok: true, window_hours: hours, unique_errors: result.rows.length, total_occurrences: totalHits, errors: result.rows };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_error_summary': {
    description: 'Get an aggregated summary of application errors grouped by route and error type. Shows which routes are most problematic and error frequency trends.',
    category: 'read',
    required: [],
    optional: ['hours'],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const hours = parseInt(params.hours, 10) || 24;

        // Top routes by error volume
        const byRoute = await dbQuery(
          `SELECT route, SUM(count) AS total_errors, COUNT(*) AS unique_errors,
                  MAX(last_seen) AS most_recent, MIN(first_seen) AS earliest
           FROM app_errors WHERE last_seen > NOW() - ($1 || ' hours')::interval
           GROUP BY route ORDER BY total_errors DESC LIMIT 10`, [hours]);

        // By status code
        const byStatus = await dbQuery(
          `SELECT status_code, SUM(count) AS total
           FROM app_errors WHERE last_seen > NOW() - ($1 || ' hours')::interval
           GROUP BY status_code ORDER BY total DESC`, [hours]);

        // By error type
        const byType = await dbQuery(
          `SELECT error_type, SUM(count) AS total
           FROM app_errors WHERE last_seen > NOW() - ($1 || ' hours')::interval
           GROUP BY error_type ORDER BY total DESC LIMIT 10`, [hours]);

        const grandTotal = byRoute.rows.reduce((s, r) => s + Number(r.total_errors), 0);

        return {
          ok: true, window_hours: hours, total_error_occurrences: grandTotal,
          by_route: byRoute.rows, by_status_code: byStatus.rows, by_error_type: byType.rows
        };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'check_dependencies': {
    description: 'Check connectivity to external services: database, Square API, Stripe API, AWS SES, and SwitchBot. Use this to quickly diagnose if a failure is caused by an unreachable dependency.',
    category: 'read',
    required: [],
    optional: [],
    handler: async () => {
      const results = {};
      const check = async (name, fn) => {
        const start = Date.now();
        try { await fn(); results[name] = { status: 'ok', latency_ms: Date.now() - start }; }
        catch (err) { results[name] = { status: 'error', error: err.message, latency_ms: Date.now() - start }; }
      };

      // Database
      await check('database', async () => {
        if (!isDatabaseAvailable()) throw new Error('Pool not initialized');
        const r = await dbQuery('SELECT 1 AS alive');
        if (!r.rows.length) throw new Error('Empty response');
      });

      // Square API
      await check('square_api', async () => {
        const token = process.env.SQUARE_ACCESS_TOKEN;
        if (!token) throw new Error('SQUARE_ACCESS_TOKEN not configured');
        const r = await fetch('https://connect.squareup.com/v2/locations', {
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(8000)
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      });

      // AWS SES
      await check('aws_ses', async () => {
        const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
        if (!region) throw new Error('AWS_REGION not configured');
        // Light check: verify the SES endpoint resolves
        const r = await fetch(`https://email.${region}.amazonaws.com`, {
          method: 'GET', signal: AbortSignal.timeout(5000)
        });
        // SES returns 403 without auth, but that proves reachability
        if (r.status >= 500) throw new Error(`HTTP ${r.status}`);
      });

      // SwitchBot
      await check('switchbot_api', async () => {
        const token = process.env.SWITCHBOT_TOKEN;
        if (!token) throw new Error('SWITCHBOT_TOKEN not configured');
        const r = await fetch('https://api.switch-bot.com/v1.1/devices', {
          headers: { 'Authorization': token, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(8000)
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      });

      const healthy = Object.values(results).filter(r => r.status === 'ok').length;
      const total = Object.keys(results).length;
      return { ok: true, healthy: `${healthy}/${total}`, services: results };
    }
  },

  // ── Producer Portal Management ──

  'review_producer_applications': {
    description: 'List producer applications awaiting review. Shows business name, contact, certifications, product types, and submission date. Use status filter to see pending, approved, rejected, or all.',
    category: 'read',
    required: [],
    optional: ['status', 'limit'],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const status = params.status || 'pending';
        const limit = Math.min(Math.max(parseInt(params.limit) || 20, 1), 100);
        let where = '';
        const values = [limit];
        if (status !== 'all') {
          where = 'WHERE status = $2';
          values.push(status);
        }
        const result = await dbQuery(
          `SELECT id, business_name, contact_name, email, phone, website,
                  location, certifications, practices, product_types,
                  description, status, reviewed_by, review_notes,
                  created_at, reviewed_at
           FROM producer_applications ${where}
           ORDER BY created_at DESC LIMIT $1`,
          values
        );
        return {
          ok: true,
          count: result.rows.length,
          filter: status,
          applications: result.rows
        };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'approve_producer_application': {
    description: 'Approve a producer application. Creates a farm record and producer account so the producer can log in and manage products. Requires the application ID. Optionally set a tier (standard or premium).',
    category: 'write',
    required: ['application_id'],
    optional: ['tier', 'notes'],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const appId = parseInt(params.application_id);
        if (!Number.isFinite(appId)) return { ok: false, error: 'Invalid application_id' };

        // Load application
        const appResult = await dbQuery(
          'SELECT * FROM producer_applications WHERE id = $1', [appId]
        );
        if (!appResult.rows.length) return { ok: false, error: 'Application not found' };
        const app = appResult.rows[0];
        if (app.status !== 'pending') return { ok: false, error: `Application is already ${app.status}` };

        // Generate farm_id
        const { randomUUID } = await import('crypto');
        const farmId = `producer-${randomUUID().slice(0, 8)}`;
        const tier = params.tier === 'premium' ? 'premium' : 'standard';

        // Create farm record
        const metadata = {
          contact: {
            name: app.contact_name,
            email: app.email,
            phone: app.phone || null,
            website: app.website || null
          },
          location: app.location || {},
          certifications: app.certifications || [],
          practices: app.practices || [],
          attributes: [],
          tier,
          status: 'active',
          source: 'producer_portal'
        };

        await dbQuery(
          `INSERT INTO farms (farm_id, farm_name, metadata, status, created_at, updated_at)
           VALUES ($1, $2, $3, 'active', NOW(), NOW())
           ON CONFLICT (farm_id) DO NOTHING`,
          [farmId, app.business_name, JSON.stringify(metadata)]
        );

        // Create producer account (password carried from application)
        await dbQuery(
          `INSERT INTO producer_accounts (farm_id, email, password_hash, display_name, role, status)
           VALUES ($1, $2, $3, $4, 'owner', 'active')`,
          [farmId, app.email, app.password_hash, app.contact_name]
        );

        // Update application status
        await dbQuery(
          `UPDATE producer_applications
           SET status = 'approved', farm_id = $1, reviewed_by = 'faye',
               review_notes = $2, reviewed_at = NOW(), updated_at = NOW()
           WHERE id = $3`,
          [farmId, params.notes || 'Approved via FAYE', appId]
        );

        // Send approval email (non-blocking)
        try {
          const { default: emailSvc } = await import('../services/email-service.js');
          emailSvc.sendEmail({
            to: app.email,
            subject: 'GreenReach Producer Application Approved',
            text: `Hi ${app.contact_name},\n\nYour producer application for "${app.business_name}" has been approved.\n\nYou can now log in at the Producer Portal using the email and password you registered with.\n\nNext steps:\n1. Log in to your producer dashboard\n2. Add your products with wholesale pricing\n3. Products will appear in the wholesale catalog for buyers\n\n-- GreenReach Farms`
          }).catch(() => {});
        } catch (_) {}

        return {
          ok: true,
          message: `Application approved. Farm "${app.business_name}" created.`,
          farm_id: farmId,
          email: app.email,
          tier
        };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'reject_producer_application': {
    description: 'Reject a producer application with a reason. The applicant can see the rejection notes when checking their application status.',
    category: 'write',
    required: ['application_id', 'reason'],
    optional: [],
    handler: async (params) => {
      try {
        if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
        const appId = parseInt(params.application_id);
        if (!Number.isFinite(appId)) return { ok: false, error: 'Invalid application_id' };
        if (!params.reason || !params.reason.trim()) return { ok: false, error: 'A reason is required for rejection' };

        const appResult = await dbQuery(
          'SELECT id, business_name, email, contact_name, status FROM producer_applications WHERE id = $1', [appId]
        );
        if (!appResult.rows.length) return { ok: false, error: 'Application not found' };
        const app = appResult.rows[0];
        if (app.status !== 'pending') return { ok: false, error: `Application is already ${app.status}` };

        await dbQuery(
          `UPDATE producer_applications
           SET status = 'rejected', reviewed_by = 'faye',
               review_notes = $1, reviewed_at = NOW(), updated_at = NOW()
           WHERE id = $2`,
          [params.reason.trim(), appId]
        );

        // Send rejection email (non-blocking)
        try {
          const { default: emailSvc } = await import('../services/email-service.js');
          emailSvc.sendEmail({
            to: app.email,
            subject: 'GreenReach Producer Application Update',
            text: `Hi ${app.contact_name},\n\nThank you for your interest in joining GreenReach as a producer.\n\nAfter review, we are unable to approve your application at this time.\n\nReason: ${params.reason.trim()}\n\nYou are welcome to submit a new application if your circumstances change.\n\n-- GreenReach Farms`
          }).catch(() => {});
        } catch (_) {}

        return {
          ok: true,
          message: `Application for "${app.business_name}" rejected.`,
          reason: params.reason.trim()
        };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  // ── Light Engine Diagnostics (Read-Only) ──
  // Phase 5: Diagnostic tools for tracing, testing, and reviewing LE subsystems.
  // FAYE may view, test, and trace — never edit.

  'diagnose_le_health': {
    description: 'Fetch Light Engine health status, recent application errors, and subsystem checks. Calls the LE /health and /healthz endpoints and returns system vitals, DB connectivity, uptime, and any error indicators.',
    category: 'read',
    required: [],
    optional: ['include_vitality'],
    handler: async (params) => {
      try {
        const farmUrl = await _getLeUrl();
        if (!farmUrl) return { ok: false, error: 'No active Light Engine URL configured. Check FARM_EDGE_URL or farms table.' };

        const headers = _leHeaders();
        const timeout = AbortSignal.timeout(8000);

        // Fetch multiple health endpoints in parallel
        const [healthRes, vitalityRes, setupRes] = await Promise.all([
          fetch(`${farmUrl}/health`, { headers, signal: timeout }).then(r => r.json()).catch(e => ({ error: e.message })),
          params.include_vitality === 'true'
            ? fetch(`${farmUrl}/api/health/vitality`, { headers, signal: timeout }).then(r => r.json()).catch(e => ({ error: e.message }))
            : Promise.resolve(null),
          fetch(`${farmUrl}/api/setup/status`, { headers, signal: timeout }).then(r => r.json()).catch(e => ({ error: e.message }))
        ]);

        return {
          ok: true,
          farm_url: farmUrl,
          health: healthRes,
          setup: setupRes,
          vitality: vitalityRes,
          checked_at: new Date().toISOString()
        };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'check_service_connectivity': {
    description: 'Test connectivity from Central to the Light Engine server and its external service integrations (Square payment API, SwitchBot IoT). Returns response status and latency for each service.',
    category: 'read',
    required: [],
    optional: [],
    handler: async () => {
      try {
        const farmUrl = await _getLeUrl();
        const results = {};

        // 1. Light Engine connectivity
        if (farmUrl) {
          const leStart = Date.now();
          try {
            const r = await fetch(`${farmUrl}/health`, { headers: _leHeaders(), signal: AbortSignal.timeout(5000) });
            results.light_engine = { reachable: true, status: r.status, latency_ms: Date.now() - leStart, url: farmUrl };
          } catch (e) {
            results.light_engine = { reachable: false, error: e.message, latency_ms: Date.now() - leStart, url: farmUrl };
          }
        } else {
          results.light_engine = { reachable: false, error: 'No LE URL configured' };
        }

        // 2. Square API connectivity (read-only status check via LE)
        if (farmUrl) {
          const sqStart = Date.now();
          try {
            const r = await fetch(`${farmUrl}/api/farm/square/status`, { headers: _leHeaders(), signal: AbortSignal.timeout(5000) });
            const body = await r.json().catch(() => ({}));
            results.square = { reachable: true, status: r.status, latency_ms: Date.now() - sqStart, response: body };
          } catch (e) {
            results.square = { reachable: false, error: e.message, latency_ms: Date.now() - sqStart };
          }
        }

        // 3. LE config/app endpoint (checks farm config and feature flags)
        if (farmUrl) {
          const cfgStart = Date.now();
          try {
            const r = await fetch(`${farmUrl}/api/config/app`, { headers: _leHeaders(), signal: AbortSignal.timeout(5000) });
            const body = await r.json().catch(() => ({}));
            results.le_config = { reachable: true, status: r.status, latency_ms: Date.now() - cfgStart, config: body };
          } catch (e) {
            results.le_config = { reachable: false, error: e.message, latency_ms: Date.now() - cfgStart };
          }
        }

        // 4. LE sync status
        if (farmUrl) {
          const syncStart = Date.now();
          try {
            const r = await fetch(`${farmUrl}/api/sync/status`, { headers: _leHeaders(), signal: AbortSignal.timeout(5000) });
            const body = await r.json().catch(() => ({}));
            results.sync_service = { reachable: true, status: r.status, latency_ms: Date.now() - syncStart, response: body };
          } catch (e) {
            results.sync_service = { reachable: false, error: e.message, latency_ms: Date.now() - syncStart };
          }
        }

        // 5. Central DB health
        if (isDatabaseAvailable()) {
          const dbStart = Date.now();
          try {
            await dbQuery('SELECT 1');
            results.central_db = { reachable: true, latency_ms: Date.now() - dbStart };
          } catch (e) {
            results.central_db = { reachable: false, error: e.message, latency_ms: Date.now() - dbStart };
          }
        } else {
          results.central_db = { reachable: false, error: 'Database marked unavailable' };
        }

        return { ok: true, services: results, checked_at: new Date().toISOString() };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_le_inventory_status': {
    description: 'Fetch the Light Engine farm-sales inventory to verify if products are logged, their stock levels, categories, and pricing. Read-only inspection of the LE inventory system.',
    category: 'read',
    required: [],
    optional: ['sku_id', 'include_categories'],
    handler: async (params) => {
      try {
        const farmUrl = await _getLeUrl();
        if (!farmUrl) return { ok: false, error: 'No active Light Engine URL configured' };

        const headers = _leHeaders();
        const timeout = AbortSignal.timeout(8000);
        const results = {};

        // Fetch main inventory
        if (params.sku_id) {
          const r = await fetch(`${farmUrl}/api/farm-sales/inventory/${encodeURIComponent(params.sku_id)}`, { headers, signal: timeout });
          results.product = await r.json().catch(() => ({}));
        } else {
          const r = await fetch(`${farmUrl}/api/farm-sales/inventory`, { headers, signal: timeout });
          results.inventory = await r.json().catch(() => ({}));
        }

        // Also fetch legacy inventory endpoint for cross-reference
        const legacyRes = await fetch(`${farmUrl}/api/inventory/current`, { headers, signal: timeout }).then(r => r.json()).catch(() => null);
        if (legacyRes) results.legacy_inventory = legacyRes;

        // Categories
        if (params.include_categories === 'true') {
          const catRes = await fetch(`${farmUrl}/api/farm-sales/inventory/categories/list`, { headers, signal: timeout }).then(r => r.json()).catch(() => null);
          if (catRes) results.categories = catRes;
        }

        // Wholesale inventory reserved check
        const reservedRes = await fetch(`${farmUrl}/api/wholesale/inventory/reserved`, { headers, signal: timeout }).then(r => r.json()).catch(() => null);
        if (reservedRes) results.wholesale_reserved = reservedRes;

        return { ok: true, farm_url: farmUrl, ...results, checked_at: new Date().toISOString() };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'read_le_source_file': {
    description: 'Read a source file from the Light Engine codebase for tracing and debugging. Returns file contents (max 500 lines). Allowed paths: server-foxtrot.js, routes/*, public/*.js, public/*.html, services/*, config/*, package.json. FAYE may ONLY read, never edit.',
    category: 'read',
    required: ['file_path'],
    optional: ['start_line', 'end_line', 'search_pattern'],
    handler: async (params) => {
      try {
        const fs = await import('fs');
        const pathMod = await import('path');
        const { fileURLToPath } = await import('url');

        // Resolve LE root relative to Central
        const centralDir = pathMod.default.dirname(fileURLToPath(import.meta.url));
        const leRoot = pathMod.default.resolve(centralDir, '..', '..');

        // Sanitize: resolve and enforce path stays within LE root
        const requested = pathMod.default.resolve(leRoot, params.file_path);
        if (!requested.startsWith(leRoot)) {
          return { ok: false, error: 'Path traversal blocked. File must be within the Light Engine project.' };
        }

        // Allowlist: only code files, not secrets or env
        const rel = pathMod.default.relative(leRoot, requested);
        const ALLOWED_PATTERNS = [
          /^server-foxtrot\.js$/,
          /^routes\/.+\.js$/,
          /^public\/.+\.(js|html|css)$/,
          /^services\/.+\.js$/,
          /^config\/.+\.js$/,
          /^package\.json$/,
          /^greenreach-central\/routes\/.+\.js$/,
          /^greenreach-central\/services\/.+\.js$/,
          /^greenreach-central\/server\.js$/,
          /^greenreach-central\/config\/.+\.js$/,
          /^greenreach-central\/public\/.+\.(js|html|css)$/,
          /^greenreach-central\/package\.json$/
        ];
        const BLOCKED_PATTERNS = [
          /\.env/i, /secret/i, /credential/i, /\.pem$/i, /\.key$/i, /password/i, /token/i
        ];

        if (BLOCKED_PATTERNS.some(p => p.test(rel))) {
          return { ok: false, error: 'Access denied: credential and secret files are blocked.' };
        }
        if (!ALLOWED_PATTERNS.some(p => p.test(rel))) {
          return { ok: false, error: `Access denied: "${rel}" is not in the allowed file list. Allowed: server-foxtrot.js, routes/*.js, public/*.{js,html,css}, services/*.js, config/*.js, package.json (and greenreach-central/ equivalents).` };
        }

        if (!fs.default.existsSync(requested)) {
          return { ok: false, error: `File not found: ${rel}` };
        }

        const content = fs.default.readFileSync(requested, 'utf8');
        const lines = content.split('\n');
        const totalLines = lines.length;

        // If search_pattern is provided, return matching lines with context
        if (params.search_pattern) {
          const pattern = new RegExp(params.search_pattern, 'gi');
          const matches = [];
          for (let i = 0; i < lines.length; i++) {
            if (pattern.test(lines[i])) {
              const ctxStart = Math.max(0, i - 2);
              const ctxEnd = Math.min(lines.length - 1, i + 2);
              matches.push({
                line: i + 1,
                match: lines[i].trim(),
                context: lines.slice(ctxStart, ctxEnd + 1).map((l, idx) => `${ctxStart + idx + 1}: ${l}`).join('\n')
              });
            }
          }
          return {
            ok: true, file: rel, total_lines: totalLines,
            pattern: params.search_pattern,
            match_count: matches.length,
            matches: matches.slice(0, 50) // Cap at 50 matches
          };
        }

        // Line range reading
        const start = Math.max(1, parseInt(params.start_line, 10) || 1);
        const end = Math.min(totalLines, parseInt(params.end_line, 10) || Math.min(start + 499, totalLines));
        const slice = lines.slice(start - 1, end);

        return {
          ok: true, file: rel, total_lines: totalLines,
          range: { start, end },
          content: slice.join('\n')
        };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_le_config_and_permissions': {
    description: 'Inspect the Light Engine configuration, feature flags, authentication settings, and permission rules. Shows what services are enabled, auth requirements, and data sharing config.',
    category: 'read',
    required: [],
    optional: ['section'],
    handler: async (params) => {
      try {
        const farmUrl = await _getLeUrl();
        if (!farmUrl) return { ok: false, error: 'No active Light Engine URL configured' };

        const headers = _leHeaders();
        const timeout = AbortSignal.timeout(8000);
        const results = {};

        // App config and feature flags
        const configRes = await fetch(`${farmUrl}/api/config/app`, { headers, signal: timeout }).then(r => r.json()).catch(e => ({ error: e.message }));
        results.app_config = configRes;

        // Setup status (permissions/completion state)
        const setupRes = await fetch(`${farmUrl}/api/setup/status`, { headers, signal: timeout }).then(r => r.json()).catch(e => ({ error: e.message }));
        results.setup_status = setupRes;

        // Square payment integration status
        const squareRes = await fetch(`${farmUrl}/api/farm/square/status`, { headers, signal: timeout }).then(r => r.json()).catch(e => ({ error: e.message }));
        results.square_status = squareRes;

        // Credential vault summary (names only, no values)
        const credRes = await fetch(`${farmUrl}/api/credentials`, { headers, signal: timeout }).then(r => r.json()).catch(e => ({ error: e.message }));
        if (credRes && Array.isArray(credRes.credentials)) {
          results.credentials = credRes.credentials.map(c => ({
            key: c.key, group: c.group, has_value: !!c.value, rotated_at: c.rotated_at
          }));
        } else {
          results.credentials = credRes;
        }

        // Cert/TLS status
        const certRes = await fetch(`${farmUrl}/api/certs/status`, { headers, signal: timeout }).then(r => r.json()).catch(e => ({ error: e.message }));
        results.tls_certs = certRes;

        // Farm identity
        const farmJsonRes = await fetch(`${farmUrl}/data/farm.json`, { headers, signal: timeout }).then(r => r.json()).catch(e => ({ error: e.message }));
        results.farm_identity = farmJsonRes;

        return { ok: true, farm_url: farmUrl, ...results, checked_at: new Date().toISOString() };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  },

  'get_recent_changes_and_deploys': {
    description: 'Get recent git commits and deployment history for the Light Engine codebase. Shows what changed recently that might affect inventory, payments, or POS functionality.',
    category: 'read',
    required: [],
    optional: ['limit', 'path_filter'],
    handler: async (params) => {
      try {
        const { execSync } = await import('child_process');
        const pathMod = await import('path');
        const { fileURLToPath } = await import('url');

        const centralDir = pathMod.default.dirname(fileURLToPath(import.meta.url));
        const leRoot = pathMod.default.resolve(centralDir, '..', '..');

        const limit = Math.min(parseInt(params.limit, 10) || 20, 50);
        const results = {};

        // Recent git commits
        try {
          let gitCmd = `git -C "${leRoot}" log --oneline --no-decorate -n ${limit}`;
          if (params.path_filter) {
            // Sanitize path filter - only allow safe characters
            const safePath = params.path_filter.replace(/[^a-zA-Z0-9_.\/\-*]/g, '');
            gitCmd += ` -- "${safePath}"`;
          }
          const gitLog = execSync(gitCmd, { encoding: 'utf8', timeout: 5000 });
          results.recent_commits = gitLog.trim().split('\n').map(line => {
            const [hash, ...rest] = line.split(' ');
            return { hash, message: rest.join(' ') };
          });
        } catch (e) {
          results.recent_commits = { error: e.message };
        }

        // Files changed in last commit
        try {
          const diff = execSync(`git -C "${leRoot}" diff --name-only HEAD~1`, { encoding: 'utf8', timeout: 5000 });
          results.last_commit_files = diff.trim().split('\n');
        } catch (e) {
          results.last_commit_files = { error: e.message };
        }

        // Current branch and status
        try {
          const branch = execSync(`git -C "${leRoot}" branch --show-current`, { encoding: 'utf8', timeout: 3000 }).trim();
          const status = execSync(`git -C "${leRoot}" status --short`, { encoding: 'utf8', timeout: 3000 }).trim();
          results.git_state = { branch, uncommitted_changes: status || '(clean)' };
        } catch (e) {
          results.git_state = { error: e.message };
        }

        // EB environment status (if AWS CLI available)
        try {
          const ebStatus = execSync(
            'aws elasticbeanstalk describe-environments --environment-names light-engine-foxtrot-prod-v3 --region us-east-1 --query "Environments[0].{Status:Status,Health:Health,HealthStatus:HealthStatus,VersionLabel:VersionLabel}" --output json',
            { encoding: 'utf8', timeout: 10000 }
          );
          results.eb_environment = JSON.parse(ebStatus);
        } catch (e) {
          results.eb_environment = { error: e.message };
        }

        return { ok: true, ...results, checked_at: new Date().toISOString() };
      } catch (err) { return { ok: false, error: err.message }; }
    }
  }
};

// ── LE URL + Header Helpers (used by diagnostic tools) ────────────

async function _getLeUrl() {
  // Priority: env var > DB farms table
  if (process.env.FARM_EDGE_URL) return process.env.FARM_EDGE_URL;
  try {
    if (!isDatabaseAvailable()) return null;
    const result = await dbQuery("SELECT api_url FROM farms WHERE status = 'active' AND api_url IS NOT NULL LIMIT 1");
    return result.rows[0]?.api_url || null;
  } catch { return null; }
}

function _leHeaders(extra = {}) {
  const headers = { 'Accept': 'application/json', ...extra };
  const farmId = process.env.FARM_ID;
  if (farmId) headers['X-Farm-ID'] = farmId;
  const apiKey = process.env.GREENREACH_API_KEY;
  if (apiKey) headers['X-API-Key'] = apiKey;
  return headers;
}

// ── Trust Tier Definitions ────────────────────────────────────────
// AUTO: Execute immediately (low-risk reads & safe writes)
// QUICK_CONFIRM: Execute with brief undo window
// CONFIRM: Describe impact, require admin to say "yes"
// ADMIN: Critical action — require admin to type the action name

export const TRUST_TIERS = {
  auto: new Set(['create_alert', 'acknowledge_alert', 'save_admin_memory', 'update_farm_notes', 'store_insight', 'record_outcome', 'rate_alert', 'log_shadow_decision', 'send_message_to_evie', 'record_recommendation_feedback', 'review_producer_applications']),
  quick_confirm: new Set(['resolve_alert', 'classify_transaction', 'archive_insight', 'set_domain_ownership']),
  confirm: new Set(['send_admin_email', 'send_sms', 'approve_producer_application', 'reject_producer_application']),
  confirm: new Set(['send_admin_email', 'send_sms']),
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
