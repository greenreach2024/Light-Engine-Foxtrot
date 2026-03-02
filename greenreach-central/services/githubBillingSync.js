import crypto from 'crypto';
import axios from 'axios';
import { query, isDatabaseAvailable } from '../config/database.js';
import logger from '../utils/logger.js';

const GITHUB_API_BASE = 'https://api.github.com';

function normalizeDate(dateValue) {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().split('T')[0];
}

function defaultAsOfDate() {
  return normalizeDate(new Date());
}

function toUsdAmount(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Number(numeric.toFixed(2));
}

function buildIdempotencyKey({ org, category, date }) {
  const raw = `github_billing|${org}|${category}|${date}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function ensureGithubSource() {
  const result = await query(
    `INSERT INTO accounting_sources (source_key, source_name, source_type, active, updated_at)
     VALUES ('github_billing', 'GitHub Billing', 'api', TRUE, NOW())
     ON CONFLICT (source_key) DO UPDATE SET
       source_name = EXCLUDED.source_name,
       source_type = EXCLUDED.source_type,
       active = TRUE,
       updated_at = NOW()
     RETURNING id`,
    []
  );
  return result.rows[0]?.id;
}

async function isPeriodLocked(periodKey) {
  const result = await query(
    `SELECT status FROM accounting_period_closes WHERE period_key = $1 LIMIT 1`,
    [periodKey]
  );
  return result.rows[0]?.status === 'locked';
}

async function fetchGitHubBillingRows({ org, token }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  const endpointSpecs = [
    {
      category: 'actions',
      endpoint: `/orgs/${encodeURIComponent(org)}/settings/billing/actions`,
      amountResolver: (data) => toUsdAmount(data?.total_paid_amount)
    },
    {
      category: 'packages',
      endpoint: `/orgs/${encodeURIComponent(org)}/settings/billing/packages`,
      amountResolver: (data) => toUsdAmount(data?.total_paid_amount)
    },
    {
      category: 'shared_storage',
      endpoint: `/orgs/${encodeURIComponent(org)}/settings/billing/shared-storage`,
      amountResolver: (data) => {
        const storage = Number(data?.estimated_paid_storage_for_month || 0);
        const bandwidth = Number(data?.estimated_paid_bandwidth_for_month || 0);
        return toUsdAmount(storage + bandwidth);
      }
    }
  ];

  const rows = [];
  const errors = [];

  for (const spec of endpointSpecs) {
    const url = `${GITHUB_API_BASE}${spec.endpoint}`;
    try {
      const response = await axios.get(url, {
        headers,
        timeout: 15000
      });

      const payload = response.data || {};
      rows.push({
        category: spec.category,
        amount_usd: spec.amountResolver(payload),
        endpoint: spec.endpoint,
        payload
      });
    } catch (error) {
      const status = error?.response?.status;
      const responseBody = error?.response?.data;
      errors.push({
        category: spec.category,
        endpoint: spec.endpoint,
        status: status || null,
        message: error.message,
        response: typeof responseBody === 'object' ? responseBody : undefined
      });
    }
  }

  if (rows.length === 0) {
    const firstError = errors[0];
    const detail = firstError
      ? `${firstError.category} (${firstError.status || 'n/a'}): ${firstError.message}`
      : 'no_response';
    throw new Error(`GitHub billing fetch failed for org ${org} - ${detail}`);
  }

  return { rows, errors };
}

async function upsertGitHubLedgerTransaction({ sourceId, org, category, date, amount, rawPayload }) {
  const idempotencyKey = buildIdempotencyKey({ org, category, date });

  const txnResult = await query(
    `INSERT INTO accounting_transactions
      (source_id, source_txn_id, idempotency_key, txn_date, description, currency, total_amount, status, raw_payload, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'USD', $6, 'posted', $7::jsonb, NOW())
     ON CONFLICT (idempotency_key) DO UPDATE SET
       source_id = EXCLUDED.source_id,
       source_txn_id = EXCLUDED.source_txn_id,
       txn_date = EXCLUDED.txn_date,
       description = EXCLUDED.description,
       total_amount = EXCLUDED.total_amount,
       raw_payload = EXCLUDED.raw_payload,
       updated_at = NOW()
     RETURNING id`,
    [
      sourceId,
      `${org}:${category}:${date}`,
      idempotencyKey,
      date,
      `GitHub ${category} billing (${org})`,
      amount,
      JSON.stringify(rawPayload)
    ]
  );

  const transactionId = txnResult.rows[0]?.id;
  if (!transactionId) throw new Error('Failed to resolve transaction ID for GitHub billing row');

  await query('DELETE FROM accounting_entries WHERE transaction_id = $1', [transactionId]);

  await query(
    `INSERT INTO accounting_entries
      (transaction_id, line_number, account_code, debit, credit, memo, metadata)
     VALUES
      ($1, 1, '620000', $2, 0, $3, $4::jsonb),
      ($1, 2, '200000', 0, $2, $5, $6::jsonb)`,
    [
      transactionId,
      amount,
      `GitHub ${category} billed expense`,
      JSON.stringify({ source: 'github_billing', org, category }),
      'Accrued GitHub payable',
      JSON.stringify({ source: 'github_billing', org, category })
    ]
  );

  return { transactionId, idempotencyKey };
}

export async function syncGitHubBilling({ org, token, from, to, asOfDate, dryRun = false } = {}) {
  if (!await isDatabaseAvailable()) {
    throw new Error('Database unavailable');
  }

  const organization = org || process.env.GITHUB_BILLING_ORG;
  const authToken = token || process.env.GITHUB_BILLING_TOKEN;

  if (!organization) {
    throw new Error('Missing GitHub org. Set GITHUB_BILLING_ORG or provide org in request body');
  }
  if (!authToken) {
    throw new Error('Missing GitHub token. Set GITHUB_BILLING_TOKEN or provide token in request body');
  }

  const asOf = normalizeDate(asOfDate) || normalizeDate(to) || defaultAsOfDate();
  const startDate = normalizeDate(from) || asOf;
  const endDate = normalizeDate(to) || asOf;
  const periodKey = asOf.slice(0, 7);

  const sourceId = await ensureGithubSource();
  const fetched = await fetchGitHubBillingRows({ org: organization, token: authToken });

  const summary = {
    source: 'github_billing',
    org: organization,
    from_date: startDate,
    to_date: endDate,
    as_of_date: asOf,
    dry_run: Boolean(dryRun),
    fetched_rows: fetched.rows.length,
    inserted_or_updated: 0,
    skipped_locked_periods: 0,
    total_amount_usd: 0,
    by_category: {},
    parsed_rows: fetched.rows.map((row) => ({
      category: row.category,
      amount_usd: row.amount_usd,
      endpoint: row.endpoint
    })),
    endpoint_errors: fetched.errors
  };

  for (const row of fetched.rows) {
    summary.total_amount_usd += row.amount_usd;
    summary.by_category[row.category] = toUsdAmount((summary.by_category[row.category] || 0) + row.amount_usd);

    if (dryRun || row.amount_usd <= 0) continue;

    if (periodKey && await isPeriodLocked(periodKey)) {
      summary.skipped_locked_periods += 1;
      continue;
    }

    await upsertGitHubLedgerTransaction({
      sourceId,
      org: organization,
      category: row.category,
      date: asOf,
      amount: row.amount_usd,
      rawPayload: {
        org: organization,
        category: row.category,
        endpoint: row.endpoint,
        fetched_at: new Date().toISOString(),
        payload: row.payload
      }
    });

    summary.inserted_or_updated += 1;
  }

  summary.total_amount_usd = toUsdAmount(summary.total_amount_usd);

  logger.info('[Accounting][GitHub Billing] Sync complete', {
    org: organization,
    asOf,
    dryRun: Boolean(dryRun),
    fetchedRows: summary.fetched_rows,
    upserted: summary.inserted_or_updated,
    skippedLocked: summary.skipped_locked_periods,
    totalAmountUsd: summary.total_amount_usd,
    endpointErrors: summary.endpoint_errors.length
  });

  return summary;
}

export function startGitHubBillingScheduler() {
  const enabled = process.env.GITHUB_BILLING_SYNC_ENABLED === 'true';
  if (!enabled) {
    logger.info('[Accounting][GitHub Billing] Scheduler disabled (GITHUB_BILLING_SYNC_ENABLED != true)');
    return;
  }

  const intervalHours = Number(process.env.GITHUB_BILLING_SYNC_INTERVAL_HOURS || 24);
  const initialDelayMinutes = Number(process.env.GITHUB_BILLING_SYNC_INITIAL_DELAY_MINUTES || 20);
  const intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1000;

  const run = async () => {
    try {
      await syncGitHubBilling({ dryRun: false });
    } catch (error) {
      logger.warn('[Accounting][GitHub Billing] Scheduled sync failed', { error: error.message });
    }
  };

  setTimeout(run, Math.max(1, initialDelayMinutes) * 60 * 1000);
  setInterval(run, intervalMs);

  logger.info('[Accounting][GitHub Billing] Scheduler enabled', {
    intervalHours,
    initialDelayMinutes
  });
}
