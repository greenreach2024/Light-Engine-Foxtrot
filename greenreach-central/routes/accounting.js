import express from 'express';
import crypto from 'crypto';
import { query, isDatabaseAvailable, getDatabase, getAccountingReadiness } from '../config/database.js';
import { syncAwsCostExplorer } from '../services/awsCostExplorerSync.js';
import { syncGitHubBilling } from '../services/githubBillingSync.js';

const router = express.Router();

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

router.post('/classifications/:transactionId', async (req, res) => {
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
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $6 = 'approved' THEN NOW() ELSE NULL END, NOW())
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

export default router;
