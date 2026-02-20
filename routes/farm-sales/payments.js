/**
 * Farm Sales - Payment Processing
 * Multi-method payment processing for all sales channels (MULTI-TENANT)
 * Supports Square and Stripe via PaymentProviderFactory
 */

import express from 'express';
import { farmAuthMiddleware } from '../../lib/farm-auth.js';
import { farmStores } from '../../lib/farm-store.js';
import { PaymentProviderFactory } from '../../lib/payment-providers/base.js';
import '../../lib/payment-providers/square.js';
import '../../lib/payment-providers/stripe.js';

// In-memory farm payment config cache (populated from setup routes)
// Keys: farm_id → { provider: 'square'|'stripe', config: {...} }
import { getFarmPaymentConfig } from '../../lib/farm-payment-config.js';

const router = express.Router();

// Apply authentication to all routes
router.use(farmAuthMiddleware);

/**
 * Payment method configuration
 */
const PAYMENT_METHODS = {
  CASH: { id: 'cash', name: 'Cash', requires_auth: false, immediate: true },
  CARD: { id: 'card', name: 'Credit/Debit Card', requires_auth: true, immediate: true },
  INVOICE: { id: 'invoice', name: 'Net-30 Invoice', requires_auth: true, immediate: false },
  GRANT: { id: 'grant', name: 'Food Security Grant', requires_auth: true, immediate: true },
  CHECK: { id: 'check', name: 'Check', requires_auth: false, immediate: false }
};

/**
 * POST /api/farm-sales/payments
 * Process payment for order
 * 
 * Body:
 * {
 *   order_id: string,
 *   method: 'cash'|'card'|'invoice'|'grant'|'check',
 *   amount: number,
 *   card?: { last4, brand, auth_code }, // For card payments
 *   check?: { check_number, bank_routing }, // For check payments
 *   grant?: { program_name, grant_id }, // For grant payments
 *   invoice?: { terms, due_date }, // For invoice payments
 *   reference?: string
 * }
 */
router.post('/', async (req, res) => {
  try {
    const { order_id, method, amount, card, check, grant, invoice, reference } = req.body;
    const farmId = req.farm_id;

    // Validate method
    if (!PAYMENT_METHODS[method.toUpperCase()]) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_payment_method',
        message: `Method must be one of: ${Object.keys(PAYMENT_METHODS).join(', ')}`
      });
    }

    // Validate amount
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_amount',
        message: 'Amount must be a positive number'
      });
    }

    const paymentMethod = PAYMENT_METHODS[method.toUpperCase()];
    const paymentId = farmStores.payments.generateId(farmId, 'PAY', 6);
    const timestamp = new Date().toISOString();

    // Initialize payment record
    const payment = {
      payment_id: paymentId,
      order_id,
      method: paymentMethod.id,
      amount,
      status: 'pending',
      reference,
      card,
      check,
      grant,
      invoice,
      timestamps: {
        created_at: timestamp,
        updated_at: timestamp,
        completed_at: null
      }
    };

    // Process based on method
    switch (paymentMethod.id) {
      case 'cash':
        payment.status = 'completed';
        payment.timestamps.completed_at = timestamp;
        payment.processor = 'local';
        break;

      case 'card':
        // TODO: Integrate with Square/Stripe for real processing
        // For now, simulate success
        payment.status = 'completed';
        payment.timestamps.completed_at = timestamp;
        payment.processor = 'square';
        payment.transaction_id = `sq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        if (card) {
          payment.card = {
            last4: card.last4,
            brand: card.brand || 'Unknown',
            auth_code: card.auth_code || `AUTH${Date.now()}`
          };
        }
        break;

      case 'invoice':
        payment.status = 'authorized';
        payment.processor = 'local';
        if (invoice) {
          payment.invoice = {
            terms: invoice.terms || 'Net 30',
            due_date: invoice.due_date || getDueDateFromTerms('Net 30'),
            issued_at: timestamp
          };
        }
        break;

      case 'grant':
        // Grant payments require pre-approval
        if (!grant?.grant_id) {
          return res.status(400).json({
            ok: false,
            error: 'grant_id_required',
            message: 'Grant ID required for grant payments'
          });
        }
        payment.status = 'completed';
        payment.timestamps.completed_at = timestamp;
        payment.processor = 'grant';
        break;

      case 'check':
        // Check payments are authorized but not completed until cleared
        if (!check?.check_number) {
          return res.status(400).json({
            ok: false,
            error: 'check_number_required',
            message: 'Check number required for check payments'
          });
        }
        payment.status = 'authorized';
        payment.processor = 'local';
        payment.check = {
          check_number: check.check_number,
          bank_routing: check.bank_routing || null,
          received_at: timestamp
        };
        break;
    }

    // Store payment in farm-scoped store
    farmStores.payments.set(farmId, paymentId, payment);

    res.status(201).json({
      ok: true,
      payment_id: paymentId,
      payment,
      next_steps: getPaymentNextSteps(payment)
    });

  } catch (error) {
    console.error('[farm-sales] Payment processing failed:', error);
    res.status(500).json({
      ok: false,
      error: 'payment_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/payments/:paymentId
 * Get payment status
 */
router.get('/:paymentId', (req, res) => {
  const { paymentId } = req.params;
  const farmId = req.farm_id;
  const payment = farmStores.payments.get(farmId, paymentId);

  if (!payment) {
    return res.status(404).json({
      ok: false,
      error: 'payment_not_found',
      payment_id: paymentId
    });
  }

  res.json({
    ok: true,
    payment
  });
});

/**
 * GET /api/farm-sales/payments
 * List payments with filtering
 * 
 * Query params:
 * - order_id: Filter by order
 * - method: Filter by payment method
 * - status: Filter by status
 * - date_from: ISO date
 * - date_to: ISO date
 */
router.get('/', (req, res) => {
  try {
    const { order_id, method, status, date_from, date_to } = req.query;
    const farmId = req.farm_id;
    
    let filtered = farmStores.payments.getAllForFarm(farmId);

    // Apply filters
    if (order_id) {
      filtered = filtered.filter(p => p.order_id === order_id);
    }
    if (method) {
      filtered = filtered.filter(p => p.method === method);
    }
    if (status) {
      filtered = filtered.filter(p => p.status === status);
    }
    if (date_from) {
      const fromDate = new Date(date_from);
      filtered = filtered.filter(p => new Date(p.timestamps.created_at) >= fromDate);
    }
    if (date_to) {
      const toDate = new Date(date_to);
      filtered = filtered.filter(p => new Date(p.timestamps.created_at) <= toDate);
    }

    // Sort by created_at descending
    filtered.sort((a, b) => 
      new Date(b.timestamps.created_at) - new Date(a.timestamps.created_at)
    );

    // Calculate totals
    const totals = {
      total_payments: filtered.length,
      total_amount: filtered.reduce((sum, p) => sum + p.amount, 0),
      completed_amount: filtered
        .filter(p => p.status === 'completed')
        .reduce((sum, p) => sum + p.amount, 0),
      by_method: {}
    };

    filtered.forEach(payment => {
      if (!totals.by_method[payment.method]) {
        totals.by_method[payment.method] = { count: 0, amount: 0 };
      }
      totals.by_method[payment.method].count++;
      totals.by_method[payment.method].amount += payment.amount;
    });

    res.json({
      ok: true,
      payments: filtered,
      totals,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[farm-sales] Payment list failed:', error);
    res.status(500).json({
      ok: false,
      error: 'list_failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farm-sales/payments/:paymentId/refund
 * Issue refund for completed payment
 * 
 * Body:
 * {
 *   amount?: number, // Partial refund amount (defaults to full)
 *   reason: string
 * }
 */
router.post('/:paymentId/refund', async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { amount: refundAmount, reason } = req.body;
    const farmId = req.farm_id;
    const payment = farmStores.payments.get(farmId, paymentId);

    if (!payment) {
      return res.status(404).json({
        ok: false,
        error: 'payment_not_found',
        payment_id: paymentId
      });
    }

    if (payment.status !== 'completed') {
      return res.status(400).json({
        ok: false,
        error: 'payment_not_completed',
        message: 'Can only refund completed payments'
      });
    }

    if (payment.refunded) {
      return res.status(400).json({
        ok: false,
        error: 'already_refunded',
        message: 'Payment already refunded'
      });
    }

    const finalRefundAmount = refundAmount || payment.amount;
    if (finalRefundAmount > payment.amount) {
      return res.status(400).json({
        ok: false,
        error: 'refund_exceeds_payment',
        message: `Refund amount $${finalRefundAmount} exceeds payment amount $${payment.amount}`
      });
    }

    const timestamp = new Date().toISOString();
    const refundId = farmStores.payments.generateId(farmId, 'REF', 6);

    // Create refund record
    const refund = {
      refund_id: refundId,
      payment_id: paymentId,
      order_id: payment.order_id,
      amount: finalRefundAmount,
      reason,
      method: payment.method,
      status: 'completed',
      processor: payment.processor,
      processed_at: timestamp
    };

    // Update payment record
    payment.refunded = true;
    payment.refund = refund;
    payment.timestamps.refunded_at = timestamp;
    farmStores.payments.set(farmId, paymentId, payment);

    res.status(201).json({
      ok: true,
      refund_id: refundId,
      refund,
      payment
    });

  } catch (error) {
    console.error('[farm-sales] Refund failed:', error);
    res.status(500).json({
      ok: false,
      error: 'refund_failed',
      message: error.message
    });
  }
});

/**
 * PATCH /api/farm-sales/payments/:paymentId
 * Update payment status (for invoice/check payments)
 * 
 * Body:
 * {
 *   status: 'completed'|'failed'|'cancelled',
 *   notes?: string
 * }
 */
router.patch('/:paymentId', (req, res) => {
  try {
    const { paymentId } = req.params;
    const { status, notes } = req.body;
    const farmId = req.farm_id;
    const payment = farmStores.payments.get(farmId, paymentId);

    if (!payment) {
      return res.status(404).json({
        ok: false,
        error: 'payment_not_found',
        payment_id: paymentId
      });
    }

    const timestamp = new Date().toISOString();
    payment.status = status;
    payment.timestamps.updated_at = timestamp;

    if (status === 'completed') {
      payment.timestamps.completed_at = timestamp;
    }

    if (notes) {
      if (!payment.notes) payment.notes = [];
      payment.notes.push({
        text: notes,
        created_at: timestamp
      });
    }

    farmStores.payments.set(farmId, paymentId, payment);

    res.json({
      ok: true,
      payment
    });

  } catch (error) {
    console.error('[farm-sales] Payment update failed:', error);
    res.status(500).json({
      ok: false,
      error: 'update_failed',
      message: error.message
    });
  }
});

/**
 * Helper: Calculate due date from invoice terms
 */
function getDueDateFromTerms(terms) {
  const match = terms.match(/Net (\d+)/);
  const days = match ? parseInt(match[1]) : 30;
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + days);
  return dueDate.toISOString().split('T')[0]; // Return YYYY-MM-DD
}

/**
 * Helper: Determine next steps for payment
 */
function getPaymentNextSteps(payment) {
  const steps = [];

  if (payment.status === 'authorized' && payment.method === 'invoice') {
    steps.push({
      action: 'send_invoice',
      description: 'Email invoice to customer',
      due_date: payment.invoice?.due_date
    });
  }

  if (payment.status === 'authorized' && payment.method === 'check') {
    steps.push({
      action: 'deposit_check',
      description: 'Deposit check and mark as completed when cleared',
      endpoint: `PATCH /api/farm-sales/payments/${payment.payment_id}`,
      payload: { status: 'completed' }
    });
  }

  if (payment.status === 'completed' && !payment.refunded) {
    steps.push({
      action: 'issue_refund',
      description: 'Issue refund if order cancelled',
      endpoint: `POST /api/farm-sales/payments/${payment.payment_id}/refund`,
      payload: { amount: payment.amount, reason: 'order_cancelled' }
    });
  }

  return steps;
}

export default router;
