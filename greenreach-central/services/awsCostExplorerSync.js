import crypto from 'crypto';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { query, isDatabaseAvailable } from '../config/database.js';
import logger from '../utils/logger.js';
import { mapAwsCostToAccountCode, mapAccountCodeReason } from './accountingMappingRules.js';

function normalizeDate(dateValue) {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().split('T')[0];
}

function defaultDateRange() {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + 1); // AWS Cost Explorer End is exclusive

  const start = new Date(today);
  start.setDate(start.getDate() - 7);

  return {
    start: normalizeDate(start),
    end: normalizeDate(end)
  };
}

function buildIdempotencyKey({ date, serviceName, granularity }) {
  const raw = `aws_cost_explorer|${date}|${serviceName}|${granularity}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function ensureAwsSource() {
  const result = await query(
    `INSERT INTO accounting_sources (source_key, source_name, source_type, active, updated_at)
     VALUES ('aws_cost_explorer', 'AWS Cost Explorer', 'api', TRUE, NOW())
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

async function upsertAwsLedgerTransaction({ sourceId, date, granularity, serviceName, amount, accountCode, rawPayload }) {
  const idempotencyKey = buildIdempotencyKey({ date, serviceName, granularity });

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
      `${date}:${serviceName}`,
      idempotencyKey,
      date,
      `AWS ${serviceName} cost (${granularity.toLowerCase()})`,
      amount,
      JSON.stringify(rawPayload)
    ]
  );

  const transactionId = txnResult.rows[0]?.id;
  if (!transactionId) throw new Error('Failed to resolve transaction ID for AWS cost row');

  await query('DELETE FROM accounting_entries WHERE transaction_id = $1', [transactionId]);

  await query(
    `INSERT INTO accounting_entries
      (transaction_id, line_number, account_code, debit, credit, memo, metadata)
     VALUES
      ($1, 1, $2, $3, 0, $4, $5::jsonb),
      ($1, 2, '200000', 0, $3, $6, $7::jsonb)`,
    [
      transactionId,
      accountCode,
      amount,
      `AWS spend mapped to ${accountCode}`,
      JSON.stringify({ mapping_reason: mapAccountCodeReason(accountCode), source: 'aws_cost_explorer' }),
      'Accrued AWS payable',
      JSON.stringify({ source: 'aws_cost_explorer' })
    ]
  );

  return { transactionId, idempotencyKey };
}

export async function syncAwsCostExplorer({ from, to, granularity = 'DAILY', dryRun = false } = {}) {
  if (!await isDatabaseAvailable()) {
    throw new Error('Database unavailable');
  }

  const range = defaultDateRange();
  const startDate = normalizeDate(from) || range.start;
  const endDate = normalizeDate(to) || range.end;

  if (!startDate || !endDate || startDate >= endDate) {
    throw new Error('Invalid date range; expected from < to with YYYY-MM-DD dates');
  }

  const client = new CostExplorerClient({
    region: process.env.AWS_REGION || 'us-east-1'
  });

  const sourceId = await ensureAwsSource();

  const rows = [];
  let nextPageToken;

  do {
    const command = new GetCostAndUsageCommand({
      TimePeriod: { Start: startDate, End: endDate },
      Granularity: granularity,
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      NextPageToken: nextPageToken
    });

    const response = await client.send(command);
    const byTime = response.ResultsByTime || [];

    for (const bucket of byTime) {
      const date = bucket.TimePeriod?.Start;
      const groups = bucket.Groups || [];

      for (const group of groups) {
        const serviceName = group.Keys?.[0] || 'Unknown AWS Service';
        const amount = Number(group.Metrics?.UnblendedCost?.Amount || 0);
        const unit = group.Metrics?.UnblendedCost?.Unit || 'USD';

        if (!Number.isFinite(amount) || amount <= 0) continue;

        const accountCode = mapAwsCostToAccountCode({ serviceName });
        const periodKey = String(date || '').slice(0, 7);

        rows.push({
          date,
          serviceName,
          amount: Number(amount.toFixed(2)),
          unit,
          granularity,
          accountCode,
          periodKey,
          rawPayload: {
            service_name: serviceName,
            amount,
            unit,
            bucket
          }
        });
      }
    }

    nextPageToken = response.NextPageToken;
  } while (nextPageToken);

  const summary = {
    source: 'aws_cost_explorer',
    start_date: startDate,
    end_date_exclusive: endDate,
    granularity,
    dry_run: Boolean(dryRun),
    fetched_rows: rows.length,
    inserted_or_updated: 0,
    skipped_locked_periods: 0,
    total_amount_usd: 0,
    by_account: {
      '610000': 0,
      '620000': 0,
      '630000': 0
    },
    sample: rows.slice(0, 10)
  };

  for (const row of rows) {
    summary.total_amount_usd += row.amount;
    if (summary.by_account[row.accountCode] == null) {
      summary.by_account[row.accountCode] = 0;
    }
    summary.by_account[row.accountCode] += row.amount;

    if (dryRun) continue;

    if (row.periodKey && await isPeriodLocked(row.periodKey)) {
      summary.skipped_locked_periods += 1;
      continue;
    }

    await upsertAwsLedgerTransaction({
      sourceId,
      date: row.date,
      granularity: row.granularity,
      serviceName: row.serviceName,
      amount: row.amount,
      accountCode: row.accountCode,
      rawPayload: row.rawPayload
    });

    summary.inserted_or_updated += 1;
  }

  summary.total_amount_usd = Number(summary.total_amount_usd.toFixed(2));
  Object.keys(summary.by_account).forEach((key) => {
    summary.by_account[key] = Number(summary.by_account[key].toFixed(2));
  });

  logger.info('[Accounting][AWS CE] Sync complete', {
    startDate,
    endDate,
    granularity,
    fetchedRows: summary.fetched_rows,
    upserted: summary.inserted_or_updated,
    skippedLocked: summary.skipped_locked_periods,
    totalAmountUsd: summary.total_amount_usd
  });

  return summary;
}

export function startAwsCostExplorerScheduler() {
  const enabled = process.env.AWS_COST_SYNC_ENABLED === 'true';
  if (!enabled) {
    logger.info('[Accounting][AWS CE] Scheduler disabled (AWS_COST_SYNC_ENABLED != true)');
    return;
  }

  const intervalHours = Number(process.env.AWS_COST_SYNC_INTERVAL_HOURS || 24);
  const initialDelayMinutes = Number(process.env.AWS_COST_SYNC_INITIAL_DELAY_MINUTES || 15);
  const intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1000;

  const run = async () => {
    try {
      await syncAwsCostExplorer({ granularity: 'DAILY', dryRun: false });
    } catch (error) {
      logger.warn('[Accounting][AWS CE] Scheduled sync failed', { error: error.message });
    }
  };

  setTimeout(run, Math.max(1, initialDelayMinutes) * 60 * 1000);
  setInterval(run, intervalMs);

  logger.info('[Accounting][AWS CE] Scheduler enabled', {
    intervalHours,
    initialDelayMinutes
  });
}
