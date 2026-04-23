import express from 'express';
import crypto from 'crypto';
import { query, isDatabaseAvailable, getDatabase, getAccountingReadiness } from '../config/database.js';
import { syncAwsCostExplorer } from '../services/awsCostExplorerSync.js';
import { syncGitHubBilling } from '../services/githubBillingSync.js';
import { ingestFarmPayout } from '../services/revenue-accounting-connector.js';

const router = express.Router();

/**
 * Escape a value for CSV output
 */
function csvEscape(value) {
  const str = String(value ?? '');
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const DEFAULT_CLASSIFICATION_THRESHOLD = 0.85;

// One-time startup cleanup: remove duplicate accounting transactions
// caused by multiple ingestion paths (checkout + webhook + reconcile)
// generating different idempotency keys for the same logical event
(async function cleanupDuplicateTransactionsOnStartup() {
  try {
    // Wait for DB to be ready
    await new Promise(r => setTimeout(r, 8000));
    if (!await isDatabaseAvailable()) return;

    const dupes = await query(
      `SELECT source_txn_id, COUNT(*) as cnt, MIN(id) as keep_id
       FROM accounting_transactions
       WHERE source_txn_id IS NOT NULL
       GROUP BY source_txn_id
       HAVING COUNT(*) > 1`
    );

    if (dupes.rows.length === 0) {
      console.log('[Accounting Startup] No duplicate transactions found');
      return;
    }

    let removedTxns = 0, removedEntries = 0;
    for (const row of dupes.rows) {
      const er = await query(
        `DELETE FROM accounting_entries WHERE transaction_id IN (
           SELECT id FROM accounting_transactions WHERE source_txn_id = $1 AND id != $2
         )`, [row.source_txn_id, row.keep_id]
      );
      removedEntries += er.rowCount || 0;
      const tr = await query(
        `DELETE FROM accounting_transactions WHERE source_txn_id = $1 AND id != $2`,
        [row.source_txn_id, row.keep_id]
      );
      removedTxns += tr.rowCount || 0;
    }
    console.log(`[Accounting Startup] Cleaned up ${removedTxns} duplicate transactions, ${removedEntries} entries across ${dupes.rows.length} groups`);
  } catch (err) {
    console.warn('[Accounting Startup] Duplicate cleanup skipped:', err.message);
  }
})();

function inferCategoryFromText({ sourceKey, description, memo, accountCode }) {
  const haystack = `${sourceKey || ''} ${description || ''} ${memo || ''} ${accountCode || ''}`.toLowerCase();

  const rules = [
    {
      id: 'source_aws_cost_explorer',
      test: () => (sourceKey || '').toLowerCase() === 'aws_cost_explorer',
      category: 'cloud_infrastructure',
      confidence: 0.98
    },
    {
      id: 'source_github_billing',
      test: () => (sourceKey || '').toLowerCase() === 'github_billing',
      category: 'dev_tools_saas',
      confidence: 0.98
    },
    {
      id: 'keyword_payment_processor',
      test: () => /(stripe|square|paypal|processing fee|transaction fee)/.test(haystack),
      category: 'payment_processing_fees',
      confidence: 0.92
    },
    {
      id: 'keyword_cloud_vendor',
      test: () => /(aws|amazon web services|ec2|s3|rds|cloudwatch)/.test(haystack),
      category: 'cloud_infrastructure',
      confidence: 0.9
    },
    {
      id: 'keyword_dev_tools',
      test: () => /(github|gitlab|vercel|linear|jira|notion|openai|anthropic|cursor|copilot|slack)/.test(haystack),
      category: 'dev_tools_saas',
      confidence: 0.88
    },
    {
      id: 'account_cloud_infra_610000',
      test: () => String(accountCode || '') === '610000',
      category: 'cloud_infrastructure',
      confidence: 0.96
    },
    {
      id: 'account_dev_tools_620000',
      test: () => String(accountCode || '') === '620000',
      category: 'dev_tools_saas',
      confidence: 0.96
    },
    {
      id: 'account_payment_fees_630000',
      test: () => String(accountCode || '') === '630000',
      category: 'payment_processing_fees',
      confidence: 0.96
    }
  ];

  const matched = rules.find(rule => rule.test());
  if (!matched) {
    return {
      category: 'uncategorized',
      confidence: 0.4,
      ruleApplied: 'fallback_uncategorized'
    };
  }

  return {
    category: matched.category,
    confidence: matched.confidence,
    ruleApplied: matched.id
  };
}

function buildIdempotencyKey({ sourceKey, sourceTxnId, txnDate, amount }) {
  const raw = `${sourceKey || 'unknown'}|${sourceTxnId || 'none'}|${txnDate || 'none'}|${Number(amount || 0).toFixed(2)}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function ensureSource({ sourceKey, sourceName, sourceType = 'api', dbClient = null }) {
  const runner = dbClient || { query };
  const upsert = await runner.query(
    `INSERT INTO accounting_sources (source_key, source_name, source_type, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (source_key) DO UPDATE SET
       source_name = EXCLUDED.source_name,
       source_type = EXCLUDED.source_type,
       updated_at = NOW()
     RETURNING id`,
    [sourceKey, sourceName || sourceKey, sourceType]
  );
  return upsert.rows[0]?.id;
}

router.get('/health', async (_req, res) => {
  const dbReady = await isDatabaseAvailable();
  if (!dbReady) return res.status(503).json({ ok: false, error: 'database_unavailable' });

  try {
    const readiness = await getAccountingReadiness();
    if (!readiness.ready) {
      return res.status(503).json({
        ok: false,
        service: 'accounting',
        db: 'available',
        error: 'accounting_schema_incomplete',
        missing_tables: readiness.missing_tables,
        chart_of_accounts_seeded: readiness.chart_of_accounts_seeded,
        account_count: readiness.account_count
      });
    }

    return res.json({
      ok: true,
      service: 'accounting',
      db: 'available',
      required_tables: readiness.required_tables,
      missing_tables: readiness.missing_tables,
      chart_of_accounts_seeded: readiness.chart_of_accounts_seeded,
      account_count: readiness.account_count
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'health_check_failed', message: error.message });
  }
});

router.get('/accounts', async (_req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  const result = await query(
    `SELECT account_code, account_name, account_class, account_type, is_active
     FROM accounting_accounts
     ORDER BY account_code ASC`
  );

  return res.json({ ok: true, accounts: result.rows });
});

router.post('/transactions/ingest', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  const {
    source_key,
    source_name,
    source_type,
    source_txn_id,
    txn_date,
    description,
    currency,
    total_amount,
    idempotency_key,
    raw_payload,
    lines
  } = req.body || {};

  if (!source_key) return res.status(400).json({ ok: false, error: 'source_key_required' });
  if (!txn_date) return res.status(400).json({ ok: false, error: 'txn_date_required' });
  if (!Array.isArray(lines) || lines.length < 2) {
    return res.status(400).json({ ok: false, error: 'lines_min_two_required' });
  }

  const key = idempotency_key || buildIdempotencyKey({
    sourceKey: source_key,
    sourceTxnId: source_txn_id,
    txnDate: txn_date,
    amount: total_amount
  });

  const totalDebit = lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const totalCredit = lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
  if (Number(totalDebit.toFixed(2)) !== Number(totalCredit.toFixed(2))) {
    return res.status(400).json({ ok: false, error: 'unbalanced_entry', total_debit: totalDebit, total_credit: totalCredit });
  }

  const client = await getDatabase().connect();
  try {
    await client.query('BEGIN');

    const sourceId = await ensureSource({
      sourceKey: source_key,
      sourceName: source_name,
      sourceType: source_type || 'api',
      dbClient: client
    });

    const txnInsert = await client.query(
      `INSERT INTO accounting_transactions
        (source_id, source_txn_id, idempotency_key, txn_date, description, currency, total_amount, raw_payload, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        sourceId,
        source_txn_id || null,
        key,
        txn_date,
        description || null,
        (currency || 'CAD').toUpperCase(),
        Number(total_amount || totalDebit || 0),
        JSON.stringify(raw_payload || {})
      ]
    );

    let transactionId = txnInsert.rows[0]?.id;
    let deduped = false;

    if (!transactionId) {
      const existing = await client.query(
        `SELECT id FROM accounting_transactions WHERE idempotency_key = $1 LIMIT 1`,
        [key]
      );
      transactionId = existing.rows[0]?.id;
      deduped = true;
    }

    if (!deduped) {
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index] || {};
        await client.query(
          `INSERT INTO accounting_entries
            (transaction_id, line_number, account_code, debit, credit, memo, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [
            transactionId,
            index + 1,
            line.account_code,
            Number(line.debit || 0),
            Number(line.credit || 0),
            line.memo || null,
            JSON.stringify(line.metadata || {})
          ]
        );
      }
    }

    await client.query('COMMIT');

    return res.json({
      ok: true,
      transaction_id: transactionId,
      idempotency_key: key,
      deduped
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ ok: false, error: 'ingest_failed', message: error.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/accounting/expense-summary
 * Sum only actual expense accounts (COGS 500000 + Processing Fees 630000).
 * Deduplicates by source_txn_id to prevent double-counting from multiple
 * ingestion paths (checkout, webhooks, reconcile) that may create duplicate entries.
 * Query: from, to (ISO dates)
 */
router.get('/expense-summary', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  try {
    const from = req.query.from;
    const to = req.query.to;

    const dateConditions = [];
    const params = [];

    if (from) {
      params.push(from);
      dateConditions.push(`t.txn_date >= $${params.length}::date`);
    }
    if (to) {
      params.push(to);
      dateConditions.push(`t.txn_date <= $${params.length}::date`);
    }

    const dateWhere = dateConditions.length ? `AND ${dateConditions.join(' AND ')}` : '';

    // Use DISTINCT ON (source_txn_id, account_code) to deduplicate entries from
    // multiple ingestion paths (checkout vs webhook vs reconcile) that create
    // duplicate transactions for the same logical event.
    // For COGS (500000): source_txn_id = 'order_id:farm_id'
    // For Processing Fees (630000): source_txn_id = payment_id (may differ,
    //   so we also group by raw_payload->>'order_id' as fallback)
    const result = await query(
      `SELECT
         account_code,
         SUM(debit) AS total_debit,
         SUM(credit) AS total_credit
       FROM (
         SELECT DISTINCT ON (
           COALESCE(t.source_txn_id, t.id::text),
           e.account_code
         )
           e.account_code,
           e.debit,
           e.credit
         FROM accounting_entries e
         JOIN accounting_transactions t ON t.id = e.transaction_id
         WHERE e.account_code IN ('500000', '630000')
           ${dateWhere}
         ORDER BY COALESCE(t.source_txn_id, t.id::text), e.account_code, t.id ASC
       ) deduped
       GROUP BY account_code`,
      params
    );

    let totalExpenses = 0;
    const breakdown = {};
    for (const row of result.rows) {
      const net = Number(row.total_debit || 0) - Number(row.total_credit || 0);
      totalExpenses += net;
      breakdown[row.account_code] = net;
    }

    return res.json({
      ok: true,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      breakdown,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'expense_summary_failed', message: error.message });
  }
});

/**
 * POST /api/accounting/cleanup-duplicates
 * One-time cleanup to remove duplicate accounting transactions that were created
 * by multiple ingestion paths (checkout + webhook + reconcile) with different
 * idempotency keys but the same source_txn_id.
 * Keeps the FIRST transaction (lowest id) for each source_txn_id and deletes the rest.
 */
router.post('/cleanup-duplicates', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  try {
    // Find duplicate transactions (same source_txn_id, multiple rows)
    const dupes = await query(
      `SELECT source_txn_id, COUNT(*) as cnt, MIN(id) as keep_id
       FROM accounting_transactions
       WHERE source_txn_id IS NOT NULL
       GROUP BY source_txn_id
       HAVING COUNT(*) > 1`
    );

    if (dupes.rows.length === 0) {
      return res.json({ ok: true, message: 'No duplicates found', removed_transactions: 0, removed_entries: 0 });
    }

    let removedTransactions = 0;
    let removedEntries = 0;

    for (const row of dupes.rows) {
      // Delete entries for duplicate transactions (keep the first one)
      const entryResult = await query(
        `DELETE FROM accounting_entries
         WHERE transaction_id IN (
           SELECT id FROM accounting_transactions
           WHERE source_txn_id = $1 AND id != $2
         )`,
        [row.source_txn_id, row.keep_id]
      );
      removedEntries += entryResult.rowCount || 0;

      // Delete the duplicate transactions themselves
      const txnResult = await query(
        `DELETE FROM accounting_transactions
         WHERE source_txn_id = $1 AND id != $2`,
        [row.source_txn_id, row.keep_id]
      );
      removedTransactions += txnResult.rowCount || 0;
    }

    console.log(`[Accounting Cleanup] Removed ${removedTransactions} duplicate transactions, ${removedEntries} entries`);
    return res.json({
      ok: true,
      duplicate_groups: dupes.rows.length,
      removed_transactions: removedTransactions,
      removed_entries: removedEntries,
    });
  } catch (error) {
    console.error('[Accounting Cleanup] Error:', error);
    return res.status(500).json({ ok: false, error: 'cleanup_failed', message: error.message });
  }
});

router.get('/transactions', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const from = req.query.from;
  const to = req.query.to;
  const source = req.query.source;

  const conditions = [];
  const params = [];

  if (from) {
    params.push(from);
    conditions.push(`t.txn_date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    conditions.push(`t.txn_date <= $${params.length}::date`);
  }
  if (source) {
    params.push(source);
    conditions.push(`s.source_key = $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  const rows = await query(
    `SELECT
       t.id,
       t.txn_date,
       t.description,
       t.currency,
       t.total_amount,
       t.idempotency_key,
       t.source_txn_id,
       t.created_at,
       s.source_key,
       s.source_name,
       COALESCE(SUM(e.debit), 0) AS debit_total,
       COALESCE(SUM(e.credit), 0) AS credit_total,
       COUNT(e.id) AS line_count
     FROM accounting_transactions t
     LEFT JOIN accounting_sources s ON s.id = t.source_id
     LEFT JOIN accounting_entries e ON e.transaction_id = t.id
     ${whereClause}
     GROUP BY t.id, s.source_key, s.source_name
     ORDER BY t.txn_date DESC, t.id DESC
     LIMIT $${params.length}`,
    params
  );

  return res.json({ ok: true, transactions: rows.rows });
});

router.post('/classifications/:transactionId(\\d+)', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  const { transactionId } = req.params;
  const {
    entry_id,
    suggested_category,
    confidence,
    rule_applied,
    status,
    reviewer,
    review_note
  } = req.body || {};

  if (!suggested_category) {
    return res.status(400).json({ ok: false, error: 'suggested_category_required' });
  }

  const result = await query(
    `INSERT INTO accounting_classifications
      (transaction_id, entry_id, suggested_category, confidence, rule_applied, status, reviewer, review_note, approved_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::varchar, $7, $8, CASE WHEN $6::varchar = 'approved' THEN NOW() ELSE NULL END, NOW())
     RETURNING id, transaction_id, entry_id, suggested_category, confidence, status, reviewer, approved_at, created_at`,
    [
      Number(transactionId),
      entry_id ? Number(entry_id) : null,
      suggested_category,
      Number(confidence || 0),
      rule_applied || null,
      status || 'pending',
      reviewer || null,
      review_note || null
    ]
  );

  return res.json({ ok: true, classification: result.rows[0] });
});

router.post('/classifications/apply-rules', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  const {
    from,
    to,
    source,
    threshold = DEFAULT_CLASSIFICATION_THRESHOLD,
    limit = 250
  } = req.body || {};

  const conditions = ['c.id IS NULL'];
  const params = [];

  if (from) {
    params.push(from);
    conditions.push(`t.txn_date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    conditions.push(`t.txn_date <= $${params.length}::date`);
  }
  if (source) {
    params.push(source);
    conditions.push(`s.source_key = $${params.length}`);
  }

  params.push(Math.min(Number(limit) || 250, 1000));

  const candidates = await query(
    `SELECT
       t.id AS transaction_id,
       t.txn_date,
       t.description,
       s.source_key,
       e.id AS entry_id,
       e.account_code,
       e.memo
     FROM accounting_transactions t
     JOIN accounting_entries e ON e.transaction_id = t.id
     LEFT JOIN accounting_sources s ON s.id = t.source_id
     LEFT JOIN accounting_classifications c ON c.entry_id = e.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY t.txn_date DESC, t.id DESC, e.line_number ASC
     LIMIT $${params.length}`,
    params
  );

  let autoApproved = 0;
  let queued = 0;
  let inserted = 0;
  const created = [];

  for (const row of candidates.rows) {
    const inferred = inferCategoryFromText({
      sourceKey: row.source_key,
      description: row.description,
      memo: row.memo,
      accountCode: row.account_code
    });

    const status = Number(inferred.confidence) >= Number(threshold) ? 'approved' : 'pending';

    const result = await query(
      `INSERT INTO accounting_classifications
        (transaction_id, entry_id, suggested_category, confidence, rule_applied, status, reviewer, review_note, approved_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::varchar, NULL, NULL, CASE WHEN $6::varchar = 'approved' THEN NOW() ELSE NULL END, NOW())
       RETURNING id, transaction_id, entry_id, suggested_category, confidence, rule_applied, status, approved_at, created_at`,
      [
        Number(row.transaction_id),
        Number(row.entry_id),
        inferred.category,
        Number(inferred.confidence),
        inferred.ruleApplied,
        status
      ]
    );

    inserted += 1;
    if (status === 'approved') autoApproved += 1;
    else queued += 1;
    created.push(result.rows[0]);
  }

  return res.json({
    ok: true,
    summary: {
      scanned: candidates.rows.length,
      inserted,
      threshold: Number(threshold),
      auto_approved: autoApproved,
      queued
    },
    classifications: created
  });
});

router.get('/classifications/queue', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  const status = req.query.status || 'pending';
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

  const rows = await query(
    `SELECT
       c.id,
       c.transaction_id,
       c.entry_id,
       c.suggested_category,
       c.confidence,
       c.rule_applied,
       c.status,
       c.reviewer,
       c.review_note,
       c.approved_at,
       c.created_at,
       t.txn_date,
       t.description,
       t.source_txn_id,
       s.source_key,
       e.account_code,
       e.debit,
       e.credit,
       e.memo
     FROM accounting_classifications c
     LEFT JOIN accounting_transactions t ON t.id = c.transaction_id
     LEFT JOIN accounting_sources s ON s.id = t.source_id
     LEFT JOIN accounting_entries e ON e.id = c.entry_id
     WHERE c.status = $1
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT $2`,
    [status, limit]
  );

  return res.json({ ok: true, status, count: rows.rows.length, queue: rows.rows });
});

router.get('/classifications/metrics', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  const from = req.query.from;
  const to = req.query.to;
  const source = req.query.source;

  const conditions = [];
  const params = [];

  if (from) {
    params.push(from);
    conditions.push(`t.txn_date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    conditions.push(`t.txn_date <= $${params.length}::date`);
  }
  if (source) {
    params.push(source);
    conditions.push(`s.source_key = $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const metrics = await query(
    `WITH filtered AS (
       SELECT
         c.id,
         c.status,
         c.confidence
       FROM accounting_classifications c
       LEFT JOIN accounting_transactions t ON t.id = c.transaction_id
       LEFT JOIN accounting_sources s ON s.id = t.source_id
       ${whereClause}
     )
     SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
       COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_count,
       COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected_count,
       ROUND(COALESCE(AVG(confidence), 0)::numeric, 4) AS avg_confidence,
       ROUND(COALESCE(AVG(confidence) FILTER (WHERE status = 'pending'), 0)::numeric, 4) AS pending_avg_confidence,
       ROUND(COALESCE(AVG(confidence) FILTER (WHERE status = 'approved'), 0)::numeric, 4) AS approved_avg_confidence,
       ROUND(COALESCE(AVG(confidence) FILTER (WHERE status = 'rejected'), 0)::numeric, 4) AS rejected_avg_confidence
     FROM filtered`,
    params
  );

  const row = metrics.rows[0] || {};

  return res.json({
    ok: true,
    filters: {
      from: from || null,
      to: to || null,
      source: source || null
    },
    metrics: {
      total: Number(row.total || 0),
      by_status: {
        pending: Number(row.pending_count || 0),
        approved: Number(row.approved_count || 0),
        rejected: Number(row.rejected_count || 0)
      },
      avg_confidence: Number(row.avg_confidence || 0),
      avg_confidence_by_status: {
        pending: Number(row.pending_avg_confidence || 0),
        approved: Number(row.approved_avg_confidence || 0),
        rejected: Number(row.rejected_avg_confidence || 0)
      }
    }
  });
});

router.get('/classifications/trends', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  const from = req.query.from;
  const to = req.query.to;
  const source = req.query.source;
  const daysParam = req.query.days;

  let days = 14;
  if (daysParam != null) {
    const parsed = Number(daysParam);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 90) {
      return res.status(400).json({ ok: false, error: 'invalid_days', expected: 'integer between 1 and 90' });
    }
    days = parsed;
  }

  const trendRows = await query(
    `WITH bounds AS (
       SELECT
         COALESCE($1::date, CURRENT_DATE - ($2::int - 1)) AS from_date,
         COALESCE($3::date, CURRENT_DATE) AS to_date
     ),
     series AS (
       SELECT generate_series(b.from_date, b.to_date, INTERVAL '1 day')::date AS day
       FROM bounds b
     ),
     filtered AS (
       SELECT
         DATE(c.created_at) AS day,
         c.status,
         c.confidence
       FROM accounting_classifications c
       LEFT JOIN accounting_transactions t ON t.id = c.transaction_id
       LEFT JOIN accounting_sources s ON s.id = t.source_id
       CROSS JOIN bounds b
       WHERE DATE(c.created_at) >= b.from_date
         AND DATE(c.created_at) <= b.to_date
         AND ($4::text IS NULL OR s.source_key = $4)
     ),
     aggregates AS (
       SELECT
         day,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
         COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_count,
         COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected_count,
         ROUND(COALESCE(AVG(confidence), 0)::numeric, 4) AS avg_confidence
       FROM filtered
       GROUP BY day
     )
     SELECT
       s.day,
       COALESCE(a.total, 0)::int AS total,
       COALESCE(a.pending_count, 0)::int AS pending_count,
       COALESCE(a.approved_count, 0)::int AS approved_count,
       COALESCE(a.rejected_count, 0)::int AS rejected_count,
       COALESCE(a.avg_confidence, 0)::numeric AS avg_confidence
     FROM series s
     LEFT JOIN aggregates a ON a.day = s.day
     ORDER BY s.day ASC`,
    [from || null, days, to || null, source || null]
  );

  const trend = trendRows.rows.map(row => ({
    date: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10),
    total: Number(row.total || 0),
    by_status: {
      pending: Number(row.pending_count || 0),
      approved: Number(row.approved_count || 0),
      rejected: Number(row.rejected_count || 0)
    },
    avg_confidence: Number(row.avg_confidence || 0)
  }));

  const summary = trend.reduce((acc, point) => {
    acc.total += point.total;
    acc.by_status.pending += point.by_status.pending;
    acc.by_status.approved += point.by_status.approved;
    acc.by_status.rejected += point.by_status.rejected;
    return acc;
  }, {
    total: 0,
    by_status: {
      pending: 0,
      approved: 0,
      rejected: 0
    }
  });

  return res.json({
    ok: true,
    filters: {
      from: from || null,
      to: to || null,
      source: source || null,
      days
    },
    summary,
    trend
  });
});

router.patch('/classifications/:classificationId(\\d+)/review', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  const classificationId = Number(req.params.classificationId);
  const {
    action,
    reviewer,
    review_note,
    suggested_category,
    confidence
  } = req.body || {};

  if (!classificationId) {
    return res.status(400).json({ ok: false, error: 'classification_id_required' });
  }

  if (!action || !['approve', 'reject'].includes(String(action))) {
    return res.status(400).json({ ok: false, error: 'invalid_action', allowed: ['approve', 'reject'] });
  }

  const reviewerIdentity = reviewer || req.user?.email || req.user?.id || null;
  if (!reviewerIdentity) {
    return res.status(400).json({ ok: false, error: 'reviewer_required' });
  }

  const status = action === 'approve' ? 'approved' : 'rejected';

  const result = await query(
    `UPDATE accounting_classifications
     SET
       status = $1::varchar,
       reviewer = $2,
       review_note = $3,
       suggested_category = COALESCE($4, suggested_category),
       confidence = COALESCE($5, confidence),
       approved_at = CASE WHEN $1::varchar = 'approved' THEN NOW() ELSE NULL END,
       updated_at = NOW()
     WHERE id = $6
     RETURNING id, transaction_id, entry_id, suggested_category, confidence, rule_applied, status, reviewer, review_note, approved_at, updated_at, created_at`,
    [
      status,
      reviewerIdentity,
      review_note || null,
      suggested_category || null,
      confidence != null ? Number(confidence) : null,
      classificationId
    ]
  );

  if (!result.rows.length) {
    return res.status(404).json({ ok: false, error: 'classification_not_found' });
  }

  return res.json({ ok: true, classification: result.rows[0] });
});

router.patch('/classifications/review/bulk', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  const {
    action,
    reviewer,
    review_note,
    classification_ids,
    suggested_category,
    confidence
  } = req.body || {};

  if (!action || !['approve', 'reject'].includes(String(action))) {
    return res.status(400).json({ ok: false, error: 'invalid_action', allowed: ['approve', 'reject'] });
  }

  if (!Array.isArray(classification_ids) || classification_ids.length === 0) {
    return res.status(400).json({ ok: false, error: 'classification_ids_required' });
  }

  const ids = [...new Set(classification_ids.map(id => Number(id)).filter(Boolean))];
  if (!ids.length) {
    return res.status(400).json({ ok: false, error: 'classification_ids_invalid' });
  }

  const reviewerIdentity = reviewer || req.user?.email || req.user?.id || null;
  if (!reviewerIdentity) {
    return res.status(400).json({ ok: false, error: 'reviewer_required' });
  }

  const status = action === 'approve' ? 'approved' : 'rejected';

  const result = await query(
    `UPDATE accounting_classifications
     SET
       status = $1::varchar,
       reviewer = $2,
       review_note = $3,
       suggested_category = COALESCE($4, suggested_category),
       confidence = COALESCE($5, confidence),
       approved_at = CASE WHEN $1::varchar = 'approved' THEN NOW() ELSE NULL END,
       updated_at = NOW()
     WHERE id = ANY($6::int[])
     RETURNING id, transaction_id, entry_id, suggested_category, confidence, rule_applied, status, reviewer, review_note, approved_at, updated_at, created_at`,
    [
      status,
      reviewerIdentity,
      review_note || null,
      suggested_category || null,
      confidence != null ? Number(confidence) : null,
      ids
    ]
  );

  return res.json({
    ok: true,
    summary: {
      requested: ids.length,
      updated: result.rows.length,
      action,
      status,
      reviewer: reviewerIdentity
    },
    classifications: result.rows
  });
});

router.post('/periods/:periodKey/lock', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  const { periodKey } = req.params;
  const lockedBy = req.body?.locked_by || req.user?.email || req.user?.id || 'system';

  if (!/^\d{4}-\d{2}$/.test(periodKey)) {
    return res.status(400).json({ ok: false, error: 'invalid_period_key', expected: 'YYYY-MM' });
  }

  const imbalanceCheck = await query(
    `SELECT COUNT(*)::int AS unbalanced_count
     FROM (
       SELECT t.id,
              ROUND(COALESCE(SUM(e.debit), 0)::numeric, 2) AS debit_total,
              ROUND(COALESCE(SUM(e.credit), 0)::numeric, 2) AS credit_total
       FROM accounting_transactions t
       LEFT JOIN accounting_entries e ON e.transaction_id = t.id
       WHERE to_char(t.txn_date, 'YYYY-MM') = $1
       GROUP BY t.id
       HAVING ROUND(COALESCE(SUM(e.debit), 0)::numeric, 2) <> ROUND(COALESCE(SUM(e.credit), 0)::numeric, 2)
     ) x`,
    [periodKey]
  );

  if ((imbalanceCheck.rows[0]?.unbalanced_count || 0) > 0) {
    return res.status(409).json({ ok: false, error: 'period_has_unbalanced_transactions', period_key: periodKey });
  }

  const summary = await query(
    `SELECT
       a.account_class,
       a.account_code,
       a.account_name,
       ROUND(COALESCE(SUM(e.debit), 0)::numeric, 2) AS debit_total,
       ROUND(COALESCE(SUM(e.credit), 0)::numeric, 2) AS credit_total
     FROM accounting_transactions t
     JOIN accounting_entries e ON e.transaction_id = t.id
     JOIN accounting_accounts a ON a.account_code = e.account_code
     WHERE to_char(t.txn_date, 'YYYY-MM') = $1
     GROUP BY a.account_class, a.account_code, a.account_name
     ORDER BY a.account_code ASC`,
    [periodKey]
  );

  const snapshot = {
    period_key: periodKey,
    generated_at: new Date().toISOString(),
    accounts: summary.rows
  };

  const locked = await query(
    `INSERT INTO accounting_period_closes (period_key, status, locked_at, locked_by, snapshot, updated_at)
     VALUES ($1, 'locked', NOW(), $2, $3::jsonb, NOW())
     ON CONFLICT (period_key) DO UPDATE SET
       status = 'locked',
       locked_at = NOW(),
       locked_by = EXCLUDED.locked_by,
       snapshot = EXCLUDED.snapshot,
       updated_at = NOW()
     RETURNING id, period_key, status, locked_at, locked_by`,
    [periodKey, lockedBy, JSON.stringify(snapshot)]
  );

  return res.json({ ok: true, period_close: locked.rows[0], snapshot });
});

router.post('/connectors/aws-cost-explorer/sync', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  try {
    const {
      from,
      to,
      granularity = 'DAILY',
      dry_run = false
    } = req.body || {};

    const summary = await syncAwsCostExplorer({
      from,
      to,
      granularity,
      dryRun: Boolean(dry_run)
    });

    return res.json({ ok: true, connector: 'aws_cost_explorer', summary });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'aws_cost_sync_failed', message: error.message });
  }
});

// ─── Valuation Snapshots ────────────────────────────────────

router.post('/valuations', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  const {
    snapshot_date,
    method,
    valuation_low,
    valuation_base,
    valuation_high,
    confidence_score,
    assumptions,
    notes,
    created_by
  } = req.body || {};

  if (!method) return res.status(400).json({ ok: false, error: 'method_required' });

  try {
    const result = await query(
      `INSERT INTO valuation_snapshots
        (snapshot_date, method, valuation_low, valuation_base, valuation_high, confidence_score, assumptions, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       RETURNING *`,
      [
        snapshot_date || new Date().toISOString().slice(0, 10),
        method,
        valuation_low != null ? Number(valuation_low) : null,
        valuation_base != null ? Number(valuation_base) : null,
        valuation_high != null ? Number(valuation_high) : null,
        confidence_score != null ? Number(confidence_score) : null,
        JSON.stringify(assumptions || {}),
        notes || null,
        created_by || 'system'
      ]
    );

    return res.json({ ok: true, snapshot: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'valuation_insert_failed', message: error.message });
  }
});

router.get('/valuations', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const from = req.query.from;
  const to = req.query.to;
  const method = req.query.method;

  const conditions = [];
  const params = [];

  if (from) {
    params.push(from);
    conditions.push(`snapshot_date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    conditions.push(`snapshot_date <= $${params.length}::date`);
  }
  if (method) {
    params.push(method);
    conditions.push(`method = $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  try {
    const result = await query(
      `SELECT * FROM valuation_snapshots
       ${whereClause}
       ORDER BY snapshot_date DESC, id DESC
       LIMIT $${params.length}`,
      params
    );

    return res.json({ ok: true, snapshots: result.rows });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'valuation_query_failed', message: error.message });
  }
});

router.get('/valuations/:id', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  try {
    const result = await query(
      `SELECT * FROM valuation_snapshots WHERE id = $1`,
      [Number(req.params.id)]
    );

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: 'snapshot_not_found' });
    }

    return res.json({ ok: true, snapshot: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'valuation_get_failed', message: error.message });
  }
});

// ─── QuickBooks Export Adapter ──────────────────────────────

router.post('/export/quickbooks', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  const {
    from,
    to,
    source,
    format = 'journal_entries'
  } = req.body || {};

  if (!from || !to) {
    return res.status(400).json({ ok: false, error: 'from_and_to_required' });
  }

  try {
    const conditions = [`t.txn_date >= $1::date`, `t.txn_date <= $2::date`];
    const params = [from, to];

    if (source) {
      params.push(source);
      conditions.push(`s.source_key = $${params.length}`);
    }

    const rows = await query(
      `SELECT
         t.id AS txn_id,
         t.txn_date,
         t.description,
         t.currency,
         t.total_amount,
         t.source_txn_id,
         t.idempotency_key,
         s.source_key,
         e.line_number,
         e.account_code,
         a.account_name,
         a.account_class,
         a.account_type,
         e.debit,
         e.credit,
         e.memo
       FROM accounting_transactions t
       LEFT JOIN accounting_sources s ON s.id = t.source_id
       JOIN accounting_entries e ON e.transaction_id = t.id
       LEFT JOIN accounting_accounts a ON a.account_code = e.account_code
       WHERE ${conditions.join(' AND ')}
       ORDER BY t.txn_date ASC, t.id ASC, e.line_number ASC`,
      params
    );

    // Group entries by transaction → QuickBooks JournalEntry format
    const txnMap = new Map();
    for (const row of rows.rows) {
      if (!txnMap.has(row.txn_id)) {
        txnMap.set(row.txn_id, {
          TxnDate: row.txn_date instanceof Date ? row.txn_date.toISOString().slice(0, 10) : String(row.txn_date).slice(0, 10),
          DocNumber: `GRC-${row.txn_id}`,
          PrivateNote: row.description || `${row.source_key || 'manual'} transaction`,
          CurrencyRef: { value: row.currency || 'CAD' },
          Line: []
        });
      }

      const je = txnMap.get(row.txn_id);
      const isDebit = Number(row.debit || 0) > 0;
      const amount = isDebit ? Number(row.debit) : Number(row.credit);

      je.Line.push({
        DetailType: 'JournalEntryLineDetail',
        Amount: amount,
        Description: row.memo || row.description || '',
        JournalEntryLineDetail: {
          PostingType: isDebit ? 'Debit' : 'Credit',
          AccountRef: {
            name: row.account_name || row.account_code,
            value: row.account_code
          }
        }
      });
    }

    const journalEntries = Array.from(txnMap.values());

    const syncResult = {
      run_id: `qb-export-${Date.now()}`,
      period: { from, to },
      source_filter: source || 'all',
      format,
      generated_at: new Date().toISOString(),
      transaction_count: journalEntries.length,
      total_lines: rows.rows.length,
      journal_entries: journalEntries
    };

    return res.json({ ok: true, export: syncResult });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'quickbooks_export_failed', message: error.message });
  }
});

// ─── Connectors ─────────────────────────────────────────────

router.post('/connectors/github-billing/sync', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  try {
    const {
      org,
      token,
      from,
      to,
      as_of_date,
      dry_run = false
    } = req.body || {};

    const summary = await syncGitHubBilling({
      org,
      token,
      from,
      to,
      asOfDate: as_of_date,
      dryRun: Boolean(dry_run)
    });

    return res.json({ ok: true, connector: 'github_billing', summary });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'github_billing_sync_failed', message: error.message });
  }
});

// ─── Financial Reports ──────────────────────────────────────

/**
 * GET /api/accounting/reports/income-statement
 * Revenue - COGS - Expenses grouped by account
 * Query: from, to (ISO dates), farm_id (optional)
 */
router.get('/reports/income-statement', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  try {
    const farmId = req.query.farm_id || null;
    const from = req.query.from || new Date(new Date().getFullYear(), 0, 1).toISOString();
    const to = req.query.to || new Date().toISOString();

    let baseSql = `
      SELECT
        account_type,
        account_name,
        SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END) as total_credits,
        SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) as total_debits,
        COUNT(*) as entry_count
      FROM ledger_entries
      WHERE created_at >= $1 AND created_at <= $2
    `;
    const params = [from, to];
    let idx = 3;

    if (farmId) {
      baseSql += ` AND farm_id = $${idx++}`;
      params.push(farmId);
    }

    baseSql += ` GROUP BY account_type, account_name ORDER BY account_type, account_name`;

    const result = await query(baseSql, params);

    // Categorize into Revenue, COGS, Expenses
    const revenue = [];
    const cogs = [];
    const expenses = [];
    let totalRevenue = 0;
    let totalCOGS = 0;
    let totalExpenses = 0;

    for (const row of result.rows) {
      const net = Number(row.total_credits) - Number(row.total_debits);
      const entry = {
        account: row.account_name,
        credits: Number(row.total_credits),
        debits: Number(row.total_debits),
        net: Math.abs(net),
        entries: Number(row.entry_count)
      };

      const type = (row.account_type || '').toLowerCase();
      if (type === 'revenue' || type === 'income' || type === 'sales' || type === 'operating_income') {
        revenue.push(entry);
        totalRevenue += Math.abs(net);
      } else if (type === 'cogs' || type === 'cost_of_goods_sold') {
        cogs.push(entry);
        totalCOGS += Math.abs(net);
      } else if (type === 'expense' || type === 'operating_expense' || type === 'research_development') {
        expenses.push(entry);
        totalExpenses += Math.abs(net);
      }
    }

    const grossProfit = totalRevenue - totalCOGS;
    const netIncome = grossProfit - totalExpenses;

    return res.json({
      ok: true,
      report: 'income_statement',
      period: { from, to },
      farm_id: farmId,
      revenue: { items: revenue, total: totalRevenue },
      cost_of_goods_sold: { items: cogs, total: totalCOGS },
      gross_profit: grossProfit,
      expenses: { items: expenses, total: totalExpenses },
      net_income: netIncome,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'income_statement_failed', message: error.message });
  }
});

/**
 * GET /api/accounting/reports/balance-sheet
 * Assets, Liabilities, Equity snapshot
 * Query: as_of (ISO date), farm_id (optional)
 */
router.get('/reports/balance-sheet', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  try {
    const farmId = req.query.farm_id || null;
    const asOf = req.query.as_of || new Date().toISOString();

    let baseSql = `
      SELECT
        account_type,
        account_name,
        SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) as total_debits,
        SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END) as total_credits,
        COUNT(*) as entry_count
      FROM ledger_entries
      WHERE created_at <= $1
    `;
    const params = [asOf];
    let idx = 2;

    if (farmId) {
      baseSql += ` AND farm_id = $${idx++}`;
      params.push(farmId);
    }

    baseSql += ` GROUP BY account_type, account_name ORDER BY account_type, account_name`;

    const result = await query(baseSql, params);

    const assets = [];
    const liabilities = [];
    const equity = [];
    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;

    for (const row of result.rows) {
      // Normal balance: assets are debit-normal, liabilities/equity are credit-normal
      const entry = {
        account: row.account_name,
        debits: Number(row.total_debits),
        credits: Number(row.total_credits),
        entries: Number(row.entry_count)
      };

      const type = (row.account_type || '').toLowerCase();
      if (type === 'asset' || type === 'cash' || type === 'receivable' || type === 'accounts_receivable' || type === 'current_asset') {
        entry.balance = Number(row.total_debits) - Number(row.total_credits);
        assets.push(entry);
        totalAssets += entry.balance;
      } else if (type === 'liability' || type === 'payable' || type === 'accounts_payable' || type === 'current_liability') {
        entry.balance = Number(row.total_credits) - Number(row.total_debits);
        liabilities.push(entry);
        totalLiabilities += entry.balance;
      } else if (type === 'equity' || type === 'retained_earnings' || type === 'owners_equity') {
        entry.balance = Number(row.total_credits) - Number(row.total_debits);
        equity.push(entry);
        totalEquity += entry.balance;
      }
    }

    return res.json({
      ok: true,
      report: 'balance_sheet',
      as_of: asOf,
      farm_id: farmId,
      assets: { items: assets, total: totalAssets },
      liabilities: { items: liabilities, total: totalLiabilities },
      equity: { items: equity, total: totalEquity },
      balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'balance_sheet_failed', message: error.message });
  }
});

// ─── Cash Flow Statement ────────────────────────────────────

/**
 * GET /api/accounting/reports/cash-flow
 * Operating, Investing, Financing activities
 * Query: from, to (ISO dates), farm_id (optional)
 */
router.get('/reports/cash-flow', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  try {
    const farmId = req.query.farm_id || null;
    const from = req.query.from || new Date(new Date().getFullYear(), 0, 1).toISOString();
    const to = req.query.to || new Date().toISOString();

    // Get cash movements from double-entry ledger
    let cashSql = `
      SELECT
        a.account_type,
        a.account_class,
        a.account_name,
        a.account_code,
        COALESCE(SUM(e.debit), 0) AS total_debits,
        COALESCE(SUM(e.credit), 0) AS total_credits
      FROM accounting_transactions t
      JOIN accounting_entries e ON e.transaction_id = t.id
      JOIN accounting_accounts a ON a.account_code = e.account_code
      WHERE t.txn_date >= $1::date AND t.txn_date <= $2::date
    `;
    const params = [from, to];
    let idx = 3;

    if (farmId) {
      cashSql += ` AND t.farm_id = $${idx++}`;
      params.push(farmId);
    }

    cashSql += ` GROUP BY a.account_type, a.account_class, a.account_name, a.account_code ORDER BY a.account_code`;

    const result = await query(cashSql, params);

    const operating = [];
    const investing = [];
    const financing = [];
    let totalOperating = 0;
    let totalInvesting = 0;
    let totalFinancing = 0;

    for (const row of result.rows) {
      const debits = Number(row.total_debits);
      const credits = Number(row.total_credits);
      const type = (row.account_type || '').toLowerCase();
      const code = row.account_code;
      const entry = {
        account: row.account_name,
        account_code: code,
        inflow: debits,
        outflow: credits,
        net: debits - credits
      };

      // Classify by account type
      if (type === 'equity' || type === 'retained_earnings' || type === 'owners_equity') {
        // Equity changes = financing
        entry.net = credits - debits; // credit-normal
        financing.push(entry);
        totalFinancing += entry.net;
      } else if (code === '100000' || type === 'cash' || type === 'current_asset') {
        // Cash and receivables = operating
        entry.net = debits - credits; // debit-normal for assets
        operating.push(entry);
        totalOperating += entry.net;
      } else if (type === 'operating_income' || type === 'revenue' || type === 'income' || type === 'sales') {
        // Revenue inflows = operating
        entry.net = credits - debits; // credit-normal for income
        operating.push(entry);
        totalOperating += entry.net;
      } else if (type === 'cogs' || type === 'operating_expense' || type === 'research_development' || type === 'expense') {
        // Expenses = operating outflows
        entry.net = -(debits - credits); // show as negative outflow
        operating.push(entry);
        totalOperating += entry.net;
      } else if (type === 'current_liability' || type === 'liability' || type === 'payable' || type === 'accounts_payable') {
        // Liability changes = operating (short-term) or financing (long-term)
        entry.net = credits - debits;
        operating.push(entry);
        totalOperating += entry.net;
      } else {
        // Default to operating
        operating.push(entry);
        totalOperating += entry.net;
      }
    }

    const netCashChange = totalOperating + totalInvesting + totalFinancing;

    return res.json({
      ok: true,
      report: 'cash_flow_statement',
      period: { from, to },
      farm_id: farmId,
      operating_activities: { items: operating, total: totalOperating },
      investing_activities: { items: investing, total: totalInvesting },
      financing_activities: { items: financing, total: totalFinancing },
      net_cash_change: netCashChange,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'cash_flow_failed', message: error.message });
  }
});

// ─── Manual Expense Entry ───────────────────────────────────

/**
 * POST /api/accounting/expenses
 * Record a manual expense as a balanced journal entry
 * Body: { account_code, amount, memo, txn_date, vendor, category, receipt_url }
 */
router.post('/expenses', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  const {
    account_code,
    amount,
    memo,
    txn_date,
    vendor,
    category,
    receipt_url
  } = req.body || {};

  if (!account_code || !amount || amount <= 0) {
    return res.status(400).json({ ok: false, error: 'account_code_and_positive_amount_required' });
  }

  // Validate account exists
  const acctCheck = await query('SELECT account_code, account_name FROM accounting_accounts WHERE account_code = $1', [account_code]);
  if (acctCheck.rows.length === 0) {
    return res.status(400).json({ ok: false, error: 'invalid_account_code', message: `Account ${account_code} not found in chart of accounts` });
  }

  const dateStr = txn_date || new Date().toISOString().slice(0, 10);
  const idempotencyKey = crypto.createHash('sha256')
    .update(`manual-expense:${account_code}:${amount}:${dateStr}:${memo || ''}:${Date.now()}`)
    .digest('hex');

  try {
    // Create the source record
    const srcResult = await query(
      `INSERT INTO accounting_sources (source_key, description) VALUES ('manual_expense', 'Manual expense entry')
       ON CONFLICT (source_key) DO UPDATE SET description = EXCLUDED.description RETURNING id`
    );
    const sourceId = srcResult.rows[0]?.id;

    // Insert the transaction
    const txnDescription = vendor ? `${vendor} - ${memo || category || 'Manual expense'}` : (memo || category || 'Manual expense');
    const txnResult = await query(
      `INSERT INTO accounting_transactions (source_id, source_txn_id, txn_date, description, currency, total_amount, idempotency_key, metadata)
       VALUES ($1, $2, $3::date, $4, 'CAD', $5, $6, $7::jsonb)
       RETURNING id`,
      [
        sourceId,
        `manual-${idempotencyKey.slice(0, 16)}`,
        dateStr,
        txnDescription,
        Number(amount),
        idempotencyKey,
        JSON.stringify({ vendor: vendor || null, category: category || null, receipt_url: receipt_url || null, entry_type: 'manual_expense' })
      ]
    );

    const txnId = txnResult.rows[0].id;

    // Debit the expense account, Credit Cash (100000) — balanced entry
    await query(
      `INSERT INTO accounting_entries (transaction_id, line_number, account_code, debit, credit, memo)
       VALUES ($1, 1, $2, $3, 0, $4), ($1, 2, '100000', 0, $3, $4)`,
      [txnId, account_code, Number(amount), memo || txnDescription]
    );

    return res.json({
      ok: true,
      transaction_id: txnId,
      idempotency_key: idempotencyKey,
      entry: {
        txn_date: dateStr,
        account_code,
        account_name: acctCheck.rows[0].account_name,
        amount: Number(amount),
        memo: memo || txnDescription,
        vendor,
        category
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'expense_entry_failed', message: error.message });
  }
});

/**
 * GET /api/accounting/expenses
 * List manual expense entries
 * Query: from, to, account_code, limit
 */
router.get('/expenses', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const conditions = [`t.metadata->>'entry_type' = 'manual_expense'`];
  const params = [];

  if (req.query.from) {
    params.push(req.query.from);
    conditions.push(`t.txn_date >= $${params.length}::date`);
  }
  if (req.query.to) {
    params.push(req.query.to);
    conditions.push(`t.txn_date <= $${params.length}::date`);
  }
  if (req.query.account_code) {
    params.push(req.query.account_code);
    conditions.push(`e.account_code = $${params.length}`);
  }

  params.push(limit);

  try {
    const result = await query(
      `SELECT t.id, t.txn_date, t.description, t.total_amount, t.metadata, t.created_at,
              e.account_code, a.account_name
       FROM accounting_transactions t
       JOIN accounting_entries e ON e.transaction_id = t.id AND e.debit > 0
       LEFT JOIN accounting_accounts a ON a.account_code = e.account_code
       WHERE ${conditions.join(' AND ')}
       ORDER BY t.txn_date DESC, t.id DESC
       LIMIT $${params.length}`,
      params
    );

    return res.json({ ok: true, expenses: result.rows });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'expense_list_failed', message: error.message });
  }
});

// ─── QB CSV Exports ─────────────────────────────────────────

/**
 * GET /api/accounting/export/chart-of-accounts.csv
 * Export Chart of Accounts in QB-compatible CSV format
 */
router.get('/export/chart-of-accounts.csv', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  try {
    const result = await query(
      `SELECT account_code, account_name, account_class, account_type, parent_account_code
       FROM accounting_accounts ORDER BY account_code ASC`
    );

    // QB Online import format: Account Name, Type, Detail Type, Description
    const qbTypeMap = {
      'current_asset': 'Other Current Asset',
      'cash': 'Bank',
      'current_liability': 'Other Current Liability',
      'operating_income': 'Income',
      'equity': 'Equity',
      'cogs': 'Cost of Goods Sold',
      'operating_expense': 'Expense',
      'research_development': 'Expense'
    };

    const header = 'Account Name,Account Code,Type,Detail Type,Description\n';
    const rows = result.rows.map(r =>
      [r.account_name, r.account_code, qbTypeMap[r.account_type] || 'Other Expense', r.account_type, `${r.account_class} - ${r.account_name}`]
        .map(csvEscape).join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="greenreach-chart-of-accounts-${new Date().toISOString().slice(0,10)}.csv"`);
    return res.send(header + rows);
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'coa_export_failed', message: error.message });
  }
});

/**
 * GET /api/accounting/export/journal-entries.csv
 * Export journal entries in QB-compatible CSV
 * Query: from, to, source
 */
router.get('/export/journal-entries.csv', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  const { from, to, source } = req.query;
  if (!from || !to) {
    return res.status(400).json({ ok: false, error: 'from_and_to_query_params_required' });
  }

  try {
    const conditions = [`t.txn_date >= $1::date`, `t.txn_date <= $2::date`];
    const params = [from, to];

    if (source) {
      params.push(source);
      conditions.push(`s.source_key = $${params.length}`);
    }

    const result = await query(
      `SELECT
         t.id AS txn_id, t.txn_date, t.description, t.currency, t.source_txn_id,
         e.line_number, e.account_code, a.account_name, e.debit, e.credit, e.memo
       FROM accounting_transactions t
       LEFT JOIN accounting_sources s ON s.id = t.source_id
       JOIN accounting_entries e ON e.transaction_id = t.id
       LEFT JOIN accounting_accounts a ON a.account_code = e.account_code
       WHERE ${conditions.join(' AND ')}
       ORDER BY t.txn_date ASC, t.id ASC, e.line_number ASC`,
      params
    );

    const header = 'Date,Transaction No,Account,Account Name,Debit,Credit,Memo,Description,Currency\n';
    const rows = result.rows.map(r =>
      [
        r.txn_date instanceof Date ? r.txn_date.toISOString().slice(0, 10) : String(r.txn_date).slice(0, 10),
        `GRC-${r.txn_id}`,
        r.account_code,
        r.account_name || '',
        Number(r.debit || 0).toFixed(2),
        Number(r.credit || 0).toFixed(2),
        r.memo || '',
        r.description || '',
        r.currency || 'CAD'
      ].map(csvEscape).join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="greenreach-journal-entries-${from}-to-${to}.csv"`);
    return res.send(header + rows);
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'journal_csv_export_failed', message: error.message });
  }
});

/**
 * GET /api/accounting/export/customers.csv
 * Export wholesale buyers in QB Customer import format
 */
router.get('/export/customers.csv', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  try {
    // Pull distinct buyers from wholesale orders
    const result = await query(
      `SELECT DISTINCT ON (buyer_email)
         buyer_id, buyer_email,
         order_data->'buyer_account'->>'contactName' AS contact_name,
         order_data->'buyer_account'->>'businessName' AS business_name,
         order_data->'buyer_account'->>'phone' AS phone,
         order_data->'buyer_account'->>'address' AS address,
         MIN(created_at) AS first_order,
         MAX(created_at) AS last_order,
         COUNT(*) AS order_count
       FROM wholesale_orders
       WHERE buyer_email IS NOT NULL
       GROUP BY buyer_email, buyer_id, order_data->'buyer_account'
       ORDER BY buyer_email`
    );

    const header = 'Customer Name,Company,Email,Phone,Address,First Order,Last Order,Order Count\n';
    const rows = result.rows.map(r =>
      [
        r.contact_name || r.business_name || r.buyer_email,
        r.business_name || '',
        r.buyer_email,
        r.phone || '',
        r.address || '',
        r.first_order ? new Date(r.first_order).toISOString().slice(0, 10) : '',
        r.last_order ? new Date(r.last_order).toISOString().slice(0, 10) : '',
        r.order_count || 0
      ].map(csvEscape).join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="greenreach-customers-${new Date().toISOString().slice(0,10)}.csv"`);
    return res.send(header + rows);
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'customers_csv_export_failed', message: error.message });
  }
});

/**
 * GET /api/accounting/export/products.csv
 * Export farm inventory products in QB Products/Services import format
 */
router.get('/export/products.csv', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  try {
    const result = await query(
      `SELECT product_name, sku, sku_id, category, variety, unit,
              price, wholesale_price, retail_price, is_taxable, status,
              farm_id, description
       FROM farm_inventory
       WHERE status = 'active'
       ORDER BY product_name ASC`
    );

    const header = 'Product/Service Name,SKU,Category,Description,Unit,Sales Price,Wholesale Price,Retail Price,Taxable,Type,Farm ID\n';
    const rows = result.rows.map(r =>
      [
        r.product_name || r.sku_id || '',
        r.sku || r.sku_id || '',
        r.category || '',
        r.description || r.variety || '',
        r.unit || '',
        Number(r.price || 0).toFixed(2),
        Number(r.wholesale_price || 0).toFixed(2),
        Number(r.retail_price || 0).toFixed(2),
        r.is_taxable ? 'Tax' : 'Non-Taxable',
        'Inventory',
        r.farm_id || ''
      ].map(csvEscape).join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="greenreach-products-${new Date().toISOString().slice(0,10)}.csv"`);
    return res.send(header + rows);
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'products_csv_export_failed', message: error.message });
  }
});

/**
 * GET /api/accounting/export/invoices.csv
 * Export wholesale orders as QB-compatible invoice CSV
 * Query: from, to
 */
router.get('/export/invoices.csv', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  const { from, to } = req.query;

  try {
    let sql = `SELECT master_order_id, buyer_id, buyer_email, status, total_amount,
                      order_data, created_at FROM wholesale_orders`;
    const params = [];
    const conditions = [];

    if (from) {
      params.push(from);
      conditions.push(`created_at >= $${params.length}::date`);
    }
    if (to) {
      params.push(to + 'T23:59:59Z');
      conditions.push(`created_at <= $${params.length}::timestamp`);
    }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT 5000';

    const result = await query(sql, params);

    const header = 'Invoice No,Date,Customer Name,Customer Email,Item,Quantity,Unit Price,Line Total,Tax Amount,Broker Fee,Invoice Total,Status,Currency\n';
    const rows = [];

    for (const row of result.rows) {
      const order = row.order_data || {};
      const subOrders = order.farm_sub_orders || order.sub_orders || [];
      const buyerName = order.buyer_account?.contactName || order.buyer_account?.businessName || row.buyer_email || '';
      const invoiceDate = row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : '';

      for (const sub of subOrders) {
        const items = sub.line_items || sub.items || [];
        for (const item of items) {
          rows.push([
            row.master_order_id || '',
            invoiceDate,
            buyerName,
            row.buyer_email || '',
            item.product_name || item.sku_name || item.sku_id || '',
            item.qty || item.quantity || 0,
            Number(item.unit_price || 0).toFixed(2),
            Number(item.line_total || 0).toFixed(2),
            Number(sub.tax_amount || 0).toFixed(2),
            Number(sub.broker_fee_amount || 0).toFixed(2),
            Number(row.total_amount || order.grand_total || 0).toFixed(2),
            row.status || 'confirmed',
            'CAD'
          ].map(csvEscape).join(','));
        }
      }
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="greenreach-invoices-${from || 'all'}-to-${to || 'now'}.csv"`);
    return res.send(header + rows.join('\n'));
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'invoices_csv_export_failed', message: error.message });
  }
});

// ─── Bank Reconciliation ────────────────────────────────────

/**
 * POST /api/accounting/bank-reconciliation/import
 * Import bank statement CSV and match against payment records
 * Body: { entries: [{ date, description, amount, reference }] }
 */
router.post('/bank-reconciliation/import', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  const { entries, account_id } = req.body || {};
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ ok: false, error: 'entries_array_required', expected: '[{ date, description, amount, reference }]' });
  }

  try {
    // Ensure bank_reconciliation table exists
    await query(`CREATE TABLE IF NOT EXISTS bank_reconciliation (
      id SERIAL PRIMARY KEY,
      bank_date DATE NOT NULL,
      bank_description TEXT,
      bank_amount NUMERIC(12,2) NOT NULL,
      bank_reference VARCHAR(255),
      matched_payment_id VARCHAR(128),
      matched_transaction_id INTEGER,
      match_confidence NUMERIC(5,4) DEFAULT 0,
      status VARCHAR(30) DEFAULT 'unmatched',
      reconciled_by VARCHAR(255),
      reconciled_at TIMESTAMP,
      account_id VARCHAR(50) DEFAULT 'primary',
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    let imported = 0;
    let matched = 0;

    for (const entry of entries) {
      if (!entry.date || entry.amount == null) continue;

      const bankAmount = Math.abs(Number(entry.amount));
      const bankDate = entry.date;

      // Try to auto-match against payment_records by amount + date (within 3 days)
      const matchResult = await query(
        `SELECT payment_id, order_id, amount, status, created_at
         FROM payment_records
         WHERE ABS(amount - $1) < 0.02
           AND created_at >= ($2::date - INTERVAL '3 days')
           AND created_at <= ($2::date + INTERVAL '3 days')
           AND payment_id NOT IN (SELECT matched_payment_id FROM bank_reconciliation WHERE matched_payment_id IS NOT NULL)
         ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - $2::timestamp))) ASC
         LIMIT 1`,
        [bankAmount, bankDate]
      );

      const autoMatch = matchResult.rows[0] || null;
      const confidence = autoMatch ? 0.85 : 0;

      await query(
        `INSERT INTO bank_reconciliation (bank_date, bank_description, bank_amount, bank_reference, matched_payment_id, match_confidence, status, account_id)
         VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8)`,
        [
          bankDate,
          entry.description || '',
          Number(entry.amount),
          entry.reference || '',
          autoMatch ? autoMatch.payment_id : null,
          confidence,
          autoMatch ? 'auto_matched' : 'unmatched',
          account_id || 'primary'
        ]
      );

      imported++;
      if (autoMatch) matched++;
    }

    return res.json({
      ok: true,
      imported,
      auto_matched: matched,
      unmatched: imported - matched
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'bank_import_failed', message: error.message });
  }
});

/**
 * GET /api/accounting/bank-reconciliation/status
 * Reconciliation summary — matched, unmatched, cleared counts
 * Query: account_id
 */
router.get('/bank-reconciliation/status', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  try {
    const accountId = req.query.account_id || 'primary';

    // Check if table exists
    const tableCheck = await query(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'bank_reconciliation')`
    );
    if (!tableCheck.rows[0]?.exists) {
      return res.json({ ok: true, summary: { total: 0, matched: 0, unmatched: 0, cleared: 0, discrepancy: 0 }, items: [] });
    }

    const summary = await query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status = 'auto_matched' OR status = 'manual_matched') AS matched,
         COUNT(*) FILTER (WHERE status = 'unmatched') AS unmatched,
         COUNT(*) FILTER (WHERE status = 'cleared') AS cleared,
         COUNT(*) FILTER (WHERE status = 'discrepancy') AS discrepancy,
         COALESCE(SUM(bank_amount) FILTER (WHERE status = 'unmatched'), 0) AS unmatched_total,
         COALESCE(SUM(bank_amount) FILTER (WHERE status = 'cleared'), 0) AS cleared_total
       FROM bank_reconciliation
       WHERE account_id = $1`,
      [accountId]
    );

    const items = await query(
      `SELECT * FROM bank_reconciliation WHERE account_id = $1 ORDER BY bank_date DESC LIMIT 200`,
      [accountId]
    );

    return res.json({
      ok: true,
      summary: summary.rows[0],
      items: items.rows
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'reconciliation_status_failed', message: error.message });
  }
});

/**
 * POST /api/accounting/bank-reconciliation/match
 * Manually match a bank entry to a payment record
 * Body: { reconciliation_id, payment_id }
 */
router.post('/bank-reconciliation/match', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  const { reconciliation_id, payment_id } = req.body || {};
  if (!reconciliation_id || !payment_id) {
    return res.status(400).json({ ok: false, error: 'reconciliation_id_and_payment_id_required' });
  }

  try {
    const result = await query(
      `UPDATE bank_reconciliation SET matched_payment_id = $1, status = 'manual_matched', match_confidence = 1.0,
              reconciled_by = 'admin', reconciled_at = NOW()
       WHERE id = $2 RETURNING *`,
      [payment_id, reconciliation_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'reconciliation_entry_not_found' });
    }

    return res.json({ ok: true, entry: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'reconciliation_match_failed', message: error.message });
  }
});

/**
 * POST /api/accounting/bank-reconciliation/clear
 * Mark matched entries as cleared (verified against bank statement)
 * Body: { ids: [1, 2, 3] }
 */
router.post('/bank-reconciliation/clear', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ ok: false, error: 'ids_array_required' });
  }

  try {
    const result = await query(
      `UPDATE bank_reconciliation SET status = 'cleared', reconciled_at = NOW()
       WHERE id = ANY($1::int[]) AND (status = 'auto_matched' OR status = 'manual_matched')
       RETURNING id`,
      [ids]
    );

    return res.json({ ok: true, cleared: result.rows.length });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'reconciliation_clear_failed', message: error.message });
  }
});

/**
 * GET /api/accounting/farm-payouts/outstanding
 *
 * Reports outstanding AP-Farms (account 250000) — how much GreenReach
 * still owes each farm after ingested payables have been netted against
 * recorded payouts. Operators use this list to decide who to settle and
 * for how much before calling POST /farm-payouts.
 *
 * Scope: the wholesale write path records payables (DR 500000 / CR 250000)
 * for every wholesale order, and records payouts (DR 250000 / CR 100000)
 * only when Square paid the farm directly (app_fee_money split). When
 * GreenReach holds the money and later settles with the farm, nothing
 * posts a drain entry — so account 250000 grows unbounded. This endpoint
 * + POST /farm-payouts fix that.
 */
router.get('/farm-payouts/outstanding', async (_req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }
  try {
    // Sum AP-Farms activity grouped by the farm_id embedded in the
    // transaction's raw_payload (the wholesale payable connector writes
    // farm_id into every txn's metadata).
    // Group on farm_id only — grouping on farm_name too would split a
    // farm's payables and payouts into separate rows whenever the name
    // differs across writers (wholesale ingest uses farmSub.farm_name;
    // POST /farm-payouts uses req.body.farm_name || farm_id), causing a
    // phantom outstanding balance on one row and a negative balance
    // silently dropped by the HAVING clause on the other. MAX(farm_name)
    // is a display-only choice for the UI.
    const result = await query(
      `SELECT farm_id,
              MAX(farm_name) AS farm_name,
              SUM(credit - debit)::float AS outstanding,
              COUNT(DISTINCT txn_id)::int AS txn_count,
              MAX(txn_date) AS last_activity
       FROM (
         SELECT COALESCE(t.raw_payload->>'farm_id', t.metadata->>'farm_id') AS farm_id,
                COALESCE(t.raw_payload->>'farm_name', t.metadata->>'farm_name') AS farm_name,
                e.credit,
                e.debit,
                t.id AS txn_id,
                t.txn_date
         FROM accounting_entries e
         JOIN accounting_transactions t ON t.id = e.transaction_id
         WHERE e.account_code = '250000'
       ) sub
       WHERE farm_id IS NOT NULL
       GROUP BY farm_id
       HAVING SUM(credit - debit) > 0.005
       ORDER BY outstanding DESC`
    );
    const rows = (result.rows || []).map(r => ({
      farm_id: r.farm_id || null,
      farm_name: r.farm_name || r.farm_id || 'Unknown',
      outstanding: Math.round(Number(r.outstanding || 0) * 100) / 100,
      txn_count: Number(r.txn_count || 0),
      last_activity: r.last_activity,
    }));
    const total = rows.reduce((s, r) => s + r.outstanding, 0);
    return res.json({
      ok: true,
      total: Math.round(total * 100) / 100,
      farms: rows,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'outstanding_query_failed', message: err.message });
  }
});

/**
 * POST /api/accounting/farm-payouts
 *
 * Record a farm payout settlement: DR AP-Farms (250000) / CR Cash
 * (100000). Use this when GreenReach actually pays a farm after holding
 * the buyer's money (greenreach_held=true in the wholesale flow), or for
 * any manual settlement outside the automated Square-split path.
 *
 * Body: { farm_id, farm_name?, amount, order_id?, payout_id?, currency?, provider?, memo? }
 *
 * Idempotency: the downstream connector hashes on
 * (order_id, farm_id, amount). To let callers record multiple distinct
 * settlements for the same logical order (split deliveries, reissue
 * after cancel, multiple manual adjustments), this route COMPOSES the
 * downstream order_id from `order_id` + `payout_id` when both are
 * supplied. When only one of the two is supplied it's used directly;
 * when neither is supplied a deterministic `manual-<farm_id>-<amount>`
 * default is used so naive retries and double-clicks still dedupe.
 *
 * To settle the same (order_id, farm_id, amount) tuple twice, supply a
 * stable, unique `payout_id` on each call (e.g. the Square payout id,
 * an internal settlement UUID, or a `YYYYMMDD-farm_id-N` string).
 */
router.post('/farm-payouts', async (req, res) => {
  if (!await isDatabaseAvailable()) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }
  const { farm_id, farm_name, amount, order_id, payout_id, currency, provider, memo } = req.body || {};
  if (!farm_id || typeof farm_id !== 'string') {
    return res.status(400).json({ ok: false, error: 'farm_id_required' });
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ ok: false, error: 'amount_must_be_positive_number' });
  }
  try {
    // Compose a disambiguated effectiveOrderId so the connector's
    // (order_id, farm_id, amount) idempotency key can distinguish
    // multiple settlements for the same logical order. The connector
    // itself preserves backward compat with existing wholesale rows by
    // keying on order_id alone — so the per-settlement distinction
    // happens HERE in the route, not in the connector. Defaults are
    // deterministic (derived from farm_id + amount) so retries and
    // double-clicks still dedupe when the caller provides no identifiers.
    const amountKey = amt.toFixed(2);
    let effectiveOrderId;
    if (order_id && payout_id) {
      effectiveOrderId = `${order_id}#${payout_id}`;
    } else if (order_id) {
      effectiveOrderId = order_id;
    } else if (payout_id) {
      effectiveOrderId = payout_id;
    } else {
      effectiveOrderId = `manual-${farm_id}-${amountKey}`;
    }
    // payout_id is still passed to the connector for metadata/audit even
    // though it no longer drives the idempotency key.
    const effectivePayoutId = payout_id || order_id || effectiveOrderId;
    const result = await ingestFarmPayout({
      payout_id: effectivePayoutId,
      order_id: effectiveOrderId,
      farm_id,
      farm_name: farm_name || farm_id,
      amount: amt,
      currency: (currency || 'CAD').toUpperCase(),
      provider: provider || 'manual',
    });
    if (!result.ok) {
      return res.status(500).json({ ok: false, error: 'payout_ingest_failed', reason: result.reason });
    }
    if (memo && result.transaction_id) {
      // Append the caller's memo to the per-line descriptions the
      // connector already wrote ("Payout to {farm}" on the debit line,
      // "Farm payout — {provider}" on the credit line) instead of
      // clobbering them — preserves the double-entry distinction that
      // matters for audit. COALESCE guards against NULL rows returning
      // NULL from string concatenation.
      await query(
        `UPDATE accounting_entries
            SET memo = COALESCE(memo || ' | ', '') || $1
          WHERE transaction_id = $2`,
        [String(memo).slice(0, 500), result.transaction_id]
      ).catch(() => null);
    }
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'farm_payout_failed', message: err.message });
  }
});

export default router;
