import express from 'express';
import crypto from 'crypto';
import { query, isDatabaseAvailable, getDatabase, getAccountingReadiness } from '../config/database.js';
import { syncAwsCostExplorer } from '../services/awsCostExplorerSync.js';
import { syncGitHubBilling } from '../services/githubBillingSync.js';

const router = express.Router();

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

export default router;
