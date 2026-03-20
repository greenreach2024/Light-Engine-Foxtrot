/**
 * Revenue Accounting Connector
 * Automatically ingests payment and refund events into the double-entry accounting ledger.
 * 
 * Account codes follow the chart of accounts:
 *   110000 - Accounts Receivable (Asset)
 *   200000 - Revenue - Wholesale
 *   210000 - Revenue - Subscriptions
 *   300000 - Sales Tax Payable (Liability)
 *   630000 - Payment Processing Fees (Expense)
 *   640000 - Broker Fee Revenue (Revenue)
 *
 * Usage:
 *   import { ingestPaymentRevenue, ingestRefundReversal } from '../services/revenue-accounting-connector.js';
 *   await ingestPaymentRevenue({ payment_id, order_id, amount, currency, provider, broker_fee, tax_amount });
 */

let _query = null;
let _isDatabaseAvailable = null;
let _getDatabase = null;

async function ensureDb() {
  if (!_query) {
    const db = await import('../config/database.js');
    _query = db.query;
    _isDatabaseAvailable = db.isDatabaseAvailable;
    _getDatabase = db.getDatabase;
  }
}

/**
 * Ingest a completed payment into the accounting ledger as a double-entry journal
 */
export async function ingestPaymentRevenue({
  payment_id,
  order_id,
  amount,
  currency = 'CAD',
  provider = 'square',
  broker_fee = 0,
  tax_amount = 0,
  source_type = 'wholesale',
  description,
}) {
  try {
    await ensureDb();
    if (!_isDatabaseAvailable || !(await _isDatabaseAvailable())) return { ok: false, reason: 'db_unavailable' };

    const net_revenue = Number(amount) - Number(broker_fee) - Number(tax_amount);
    const processingFeeRate = provider === 'stripe' ? 0.029 : 0.026; // Stripe 2.9%, Square 2.6%
    const processingFee = Math.round(Number(amount) * processingFeeRate * 100) / 100;

    // Revenue account depends on source type
    const revenueAccountCode = source_type === 'subscription' ? '210000' : '200000';

    // Build balanced double-entry lines
    const lines = [
      { account_code: '110000', debit: Number(amount), credit: 0, memo: `${provider} payment received` },
      { account_code: revenueAccountCode, debit: 0, credit: net_revenue, memo: `Revenue from order ${order_id}` },
    ];

    if (Number(tax_amount) > 0) {
      lines.push({ account_code: '300000', debit: 0, credit: Number(tax_amount), memo: 'Sales tax collected' });
    }

    if (Number(broker_fee) > 0) {
      lines.push({ account_code: '640000', debit: 0, credit: Number(broker_fee), memo: 'Platform broker fee' });
    }

    // Processing fee: debit expense, credit AR (reduces net receivable)
    if (processingFee > 0) {
      lines.push({ account_code: '630000', debit: processingFee, credit: 0, memo: `${provider} processing fee` });
      lines.push({ account_code: '110000', debit: 0, credit: processingFee, memo: `${provider} fee deduction` });
    }

    // Verify balance
    const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      console.warn('[RevenueConnector] Unbalanced entry — skipping', { totalDebit, totalCredit });
      return { ok: false, reason: 'unbalanced_entry' };
    }

    // Build idempotency key to prevent duplicates
    const crypto = await import('crypto');
    const idempotencyKey = crypto.createHash('sha256')
      .update(`revenue|${payment_id}|${order_id}|${amount}`)
      .digest('hex');

    // Call the accounting ingest endpoint logic directly (same DB)
    const sourceKey = `payment_${provider}`;
    
    // Ensure source exists
    await _query(
      `INSERT INTO accounting_sources (source_key, source_name, source_type, updated_at)
       VALUES ($1, $2, 'connector', NOW())
       ON CONFLICT (source_key) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [sourceKey, `${provider} Payments`]
    ).catch(() => null);

    const sourceResult = await _query(
      'SELECT id FROM accounting_sources WHERE source_key = $1 LIMIT 1',
      [sourceKey]
    );
    const sourceId = sourceResult.rows[0]?.id;

    // Insert transaction
    const txnResult = await _query(
      `INSERT INTO accounting_transactions
        (source_id, source_txn_id, idempotency_key, txn_date, description, currency, total_amount, raw_payload, updated_at)
       VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, $6, $7::jsonb, NOW())
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [sourceId, payment_id, idempotencyKey,
       description || `${source_type} payment via ${provider} — order ${order_id}`,
       currency.toUpperCase(), Number(amount),
       JSON.stringify({ payment_id, order_id, provider, broker_fee, tax_amount, source_type })]
    );

    const transactionId = txnResult.rows[0]?.id;
    if (!transactionId) {
      return { ok: true, deduped: true, idempotency_key: idempotencyKey };
    }

    // Insert entries
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      await _query(
        `INSERT INTO accounting_entries
          (transaction_id, line_number, account_code, debit, credit, memo)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [transactionId, i + 1, line.account_code, line.debit, line.credit, line.memo]
      );
    }

    console.log(`[RevenueConnector] Ingested payment ${payment_id}: $${amount} ${currency} → txn #${transactionId}`);
    return { ok: true, transaction_id: transactionId, idempotency_key: idempotencyKey };
  } catch (err) {
    console.warn('[RevenueConnector] Ingest failed:', err.message);
    return { ok: false, reason: err.message };
  }
}

/**
 * Ingest a refund reversal into the accounting ledger
 */
export async function ingestRefundReversal({
  refund_id,
  order_id,
  amount,
  currency = 'CAD',
  provider = 'square',
}) {
  try {
    await ensureDb();
    if (!_isDatabaseAvailable || !(await _isDatabaseAvailable())) return { ok: false, reason: 'db_unavailable' };

    const crypto = await import('crypto');
    const idempotencyKey = crypto.createHash('sha256')
      .update(`refund|${refund_id}|${order_id}|${amount}`)
      .digest('hex');

    const sourceKey = `payment_${provider}`;
    const sourceResult = await _query(
      'SELECT id FROM accounting_sources WHERE source_key = $1 LIMIT 1',
      [sourceKey]
    );
    const sourceId = sourceResult.rows[0]?.id;

    // Refund reverses revenue: debit Revenue, credit AR
    const lines = [
      { account_code: '200000', debit: Number(amount), credit: 0, memo: `Refund reversal — ${refund_id}` },
      { account_code: '110000', debit: 0, credit: Number(amount), memo: `Refund issued — order ${order_id}` },
    ];

    const txnResult = await _query(
      `INSERT INTO accounting_transactions
        (source_id, source_txn_id, idempotency_key, txn_date, description, currency, total_amount, raw_payload, updated_at)
       VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, $6, $7::jsonb, NOW())
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [sourceId, refund_id, idempotencyKey,
       `Refund for order ${order_id} via ${provider}`,
       currency.toUpperCase(), Number(amount),
       JSON.stringify({ refund_id, order_id, provider })]
    );

    const transactionId = txnResult.rows[0]?.id;
    if (!transactionId) return { ok: true, deduped: true };

    for (let i = 0; i < lines.length; i++) {
      await _query(
        `INSERT INTO accounting_entries
          (transaction_id, line_number, account_code, debit, credit, memo)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [transactionId, i + 1, lines[i].account_code, lines[i].debit, lines[i].credit, lines[i].memo]
      );
    }

    console.log(`[RevenueConnector] Ingested refund ${refund_id}: $${amount} ${currency} → txn #${transactionId}`);
    return { ok: true, transaction_id: transactionId };
  } catch (err) {
    console.warn('[RevenueConnector] Refund ingest failed:', err.message);
    return { ok: false, reason: err.message };
  }
}
