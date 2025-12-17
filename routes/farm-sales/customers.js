/**
 * Farm Sales - Customer Management
 * Handle customer accounts, store credits, and preferences (MULTI-TENANT)
 */

import express from 'express';
import { farmAuthMiddleware } from '../../lib/farm-auth.js';
import { farmStores } from '../../lib/farm-store.js';

const router = express.Router();

// Apply authentication to all routes
router.use(farmAuthMiddleware);

/**
 * GET /api/farm-sales/customers
 * List customers for farm
 * 
 * Query params:
 * - email: Filter by email
 * - phone: Filter by phone
 * - has_credits: Filter customers with store credit balance > 0
 */
router.get('/', (req, res) => {
  try {
    const { email, phone, has_credits } = req.query;
    const farmId = req.farm_id;
    
    let filtered = farmStores.customers.getAllForFarm(farmId);

    if (email) {
      filtered = filtered.filter(c => c.email?.toLowerCase().includes(email.toLowerCase()));
    }
    if (phone) {
      filtered = filtered.filter(c => c.phone?.includes(phone));
    }
    if (has_credits === 'true') {
      filtered = filtered.filter(c => (c.credit_balance || 0) > 0);
    }

    // Sort by created_at descending
    filtered.sort((a, b) => 
      new Date(b.timestamps.created_at) - new Date(a.timestamps.created_at)
    );

    // Calculate stats
    const totalCredits = filtered.reduce((sum, c) => sum + (c.credit_balance || 0), 0);

    res.json({
      ok: true,
      farm_id: farmId,
      customers: filtered,
      totals: {
        count: filtered.length,
        total_credits: totalCredits
      }
    });

  } catch (error) {
    console.error('[farm-sales] Customer list failed:', error);
    res.status(500).json({
      ok: false,
      error: 'list_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/customers/:customerId
 * Get customer details
 */
router.get('/:customerId', (req, res) => {
  try {
    const { customerId } = req.params;
    const farmId = req.farm_id;

    const customer = farmStores.customers.get(farmId, customerId);
    
    if (!customer) {
      return res.status(404).json({
        ok: false,
        error: 'customer_not_found'
      });
    }

    res.json({
      ok: true,
      customer
    });

  } catch (error) {
    console.error('[farm-sales] Customer fetch failed:', error);
    res.status(500).json({
      ok: false,
      error: 'fetch_failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farm-sales/customers
 * Create new customer
 * 
 * Body:
 * {
 *   name: string,
 *   email: string,
 *   phone?: string,
 *   address?: { street, city, state, zip },
 *   preferences?: { allergies?, dietary_restrictions?, delivery_instructions? }
 * }
 */
router.post('/', async (req, res) => {
  try {
    const { name, email, phone, address, preferences } = req.body;
    const farmId = req.farm_id;

    // Validate required fields
    if (!name || !email) {
      return res.status(400).json({
        ok: false,
        error: 'missing_required_fields',
        message: 'name and email are required'
      });
    }

    // Check for duplicate email
    const existing = farmStores.customers.getAllForFarm(farmId)
      .find(c => c.email === email);
    
    if (existing) {
      return res.status(409).json({
        ok: false,
        error: 'customer_exists',
        customer_id: existing.customer_id,
        message: 'Customer with this email already exists'
      });
    }

    const customerId = farmStores.customers.generateId(farmId, 'CUST', 6);
    const timestamp = new Date().toISOString();

    const customer = {
      customer_id: customerId,
      name,
      email,
      phone: phone || null,
      address: address || null,
      preferences: preferences || {},
      credit_balance: 0,
      credit_history: [],
      order_count: 0,
      lifetime_value: 0,
      timestamps: {
        created_at: timestamp,
        updated_at: timestamp,
        last_order_at: null
      }
    };

    farmStores.customers.set(farmId, customerId, customer);

    res.status(201).json({
      ok: true,
      customer_id: customerId,
      customer
    });

  } catch (error) {
    console.error('[farm-sales] Customer creation failed:', error);
    res.status(500).json({
      ok: false,
      error: 'creation_failed',
      message: error.message
    });
  }
});

/**
 * PATCH /api/farm-sales/customers/:customerId
 * Update customer details
 * 
 * Body: Partial customer data to update
 */
router.patch('/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const farmId = req.farm_id;
    const updates = req.body;

    const customer = farmStores.customers.get(farmId, customerId);
    
    if (!customer) {
      return res.status(404).json({
        ok: false,
        error: 'customer_not_found'
      });
    }

    // Merge updates (don't allow changing credit_balance directly - use add-credits endpoint)
    const { credit_balance, credit_history, ...allowedUpdates } = updates;
    
    const updatedCustomer = {
      ...customer,
      ...allowedUpdates,
      timestamps: {
        ...customer.timestamps,
        updated_at: new Date().toISOString()
      }
    };

    farmStores.customers.set(farmId, customerId, updatedCustomer);

    res.json({
      ok: true,
      customer: updatedCustomer
    });

  } catch (error) {
    console.error('[farm-sales] Customer update failed:', error);
    res.status(500).json({
      ok: false,
      error: 'update_failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farm-sales/customers/:customerId/add-credits
 * Add store credits to customer account (for CSA pre-payment)
 * 
 * Body:
 * {
 *   amount: number,
 *   payment_method: 'cash'|'card'|'check',
 *   card?: { last4, brand },
 *   notes?: string
 * }
 */
router.post('/:customerId/add-credits', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { amount, payment_method, card, notes } = req.body;
    const farmId = req.farm_id;

    // Validate amount
    if (!amount || amount <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_amount',
        message: 'Amount must be greater than 0'
      });
    }

    // Validate payment method
    if (!payment_method || !['cash', 'card', 'check'].includes(payment_method)) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_payment_method',
        message: 'Payment method must be cash, card, or check'
      });
    }

    const customer = farmStores.customers.get(farmId, customerId);
    
    if (!customer) {
      return res.status(404).json({
        ok: false,
        error: 'customer_not_found'
      });
    }

    const timestamp = new Date().toISOString();
    const transactionId = farmStores.customers.generateId(farmId, 'CR', 8);

    // Add credit transaction to history
    const creditTransaction = {
      transaction_id: transactionId,
      type: 'add',
      amount,
      payment_method,
      card,
      balance_before: customer.credit_balance || 0,
      balance_after: (customer.credit_balance || 0) + amount,
      notes,
      timestamp
    };

    const updatedCustomer = {
      ...customer,
      credit_balance: (customer.credit_balance || 0) + amount,
      credit_history: [...(customer.credit_history || []), creditTransaction],
      timestamps: {
        ...customer.timestamps,
        updated_at: timestamp
      }
    };

    farmStores.customers.set(farmId, customerId, updatedCustomer);

    res.json({
      ok: true,
      transaction_id: transactionId,
      customer_id: customerId,
      amount_added: amount,
      new_balance: updatedCustomer.credit_balance,
      transaction: creditTransaction
    });

  } catch (error) {
    console.error('[farm-sales] Add credits failed:', error);
    res.status(500).json({
      ok: false,
      error: 'add_credits_failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farm-sales/customers/:customerId/use-credits
 * Use store credits for order payment (internal - called by POS/checkout)
 * 
 * Body:
 * {
 *   amount: number,
 *   order_id: string,
 *   notes?: string
 * }
 */
router.post('/:customerId/use-credits', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { amount, order_id, notes } = req.body;
    const farmId = req.farm_id;

    // Validate amount
    if (!amount || amount <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_amount',
        message: 'Amount must be greater than 0'
      });
    }

    const customer = farmStores.customers.get(farmId, customerId);
    
    if (!customer) {
      return res.status(404).json({
        ok: false,
        error: 'customer_not_found'
      });
    }

    const currentBalance = customer.credit_balance || 0;
    
    if (currentBalance < amount) {
      return res.status(400).json({
        ok: false,
        error: 'insufficient_credits',
        requested: amount,
        available: currentBalance
      });
    }

    const timestamp = new Date().toISOString();
    const transactionId = farmStores.customers.generateId(farmId, 'CR', 8);

    // Deduct credit transaction to history
    const creditTransaction = {
      transaction_id: transactionId,
      type: 'use',
      amount: -amount,
      order_id,
      balance_before: currentBalance,
      balance_after: currentBalance - amount,
      notes: notes || `Applied to order ${order_id}`,
      timestamp
    };

    const updatedCustomer = {
      ...customer,
      credit_balance: currentBalance - amount,
      credit_history: [...(customer.credit_history || []), creditTransaction],
      timestamps: {
        ...customer.timestamps,
        updated_at: timestamp
      }
    };

    farmStores.customers.set(farmId, customerId, updatedCustomer);

    res.json({
      ok: true,
      transaction_id: transactionId,
      customer_id: customerId,
      amount_used: amount,
      new_balance: updatedCustomer.credit_balance,
      transaction: creditTransaction
    });

  } catch (error) {
    console.error('[farm-sales] Use credits failed:', error);
    res.status(500).json({
      ok: false,
      error: 'use_credits_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/customers/:customerId/credit-history
 * Get credit transaction history
 */
router.get('/:customerId/credit-history', (req, res) => {
  try {
    const { customerId } = req.params;
    const farmId = req.farm_id;

    const customer = farmStores.customers.get(farmId, customerId);
    
    if (!customer) {
      return res.status(404).json({
        ok: false,
        error: 'customer_not_found'
      });
    }

    const history = customer.credit_history || [];
    
    // Calculate summary stats
    const totalAdded = history
      .filter(t => t.type === 'add')
      .reduce((sum, t) => sum + t.amount, 0);
    
    const totalUsed = history
      .filter(t => t.type === 'use')
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    res.json({
      ok: true,
      customer_id: customerId,
      current_balance: customer.credit_balance || 0,
      history,
      summary: {
        total_added: totalAdded,
        total_used: totalUsed,
        transaction_count: history.length
      }
    });

  } catch (error) {
    console.error('[farm-sales] Credit history fetch failed:', error);
    res.status(500).json({
      ok: false,
      error: 'fetch_failed',
      message: error.message
    });
  }
});

export default router;
