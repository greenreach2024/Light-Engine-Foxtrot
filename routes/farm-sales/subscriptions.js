/**
 * Farm Sales - Subscription Management
 * Recurring orders and CSA (Community Supported Agriculture) boxes (MULTI-TENANT)
 */

import express from 'express';
import { farmAuthMiddleware } from '../../lib/farm-auth.js';
import { farmStores } from '../../lib/farm-store.js';

const router = express.Router();

// Apply authentication to all routes
router.use(farmAuthMiddleware);

/**
 * Subscription plan templates
 */
const SUBSCRIPTION_PLANS = {
  WEEKLY_SMALL: {
    id: 'weekly_small',
    name: 'Weekly Box - Small',
    description: '4-6 lbs of seasonal produce',
    frequency: 'weekly',
    price: 25.00,
    delivery_day: 'wednesday'
  },
  WEEKLY_MEDIUM: {
    id: 'weekly_medium',
    name: 'Weekly Box - Medium',
    description: '8-10 lbs of seasonal produce',
    frequency: 'weekly',
    price: 40.00,
    delivery_day: 'wednesday'
  },
  WEEKLY_LARGE: {
    id: 'weekly_large',
    name: 'Weekly Box - Large',
    description: '12-15 lbs of seasonal produce',
    frequency: 'weekly',
    price: 55.00,
    delivery_day: 'wednesday'
  },
  BIWEEKLY_MEDIUM: {
    id: 'biweekly_medium',
    name: 'Bi-Weekly Box - Medium',
    description: '8-10 lbs of seasonal produce every other week',
    frequency: 'biweekly',
    price: 40.00,
    delivery_day: 'saturday'
  },
  MONTHLY_HERB: {
    id: 'monthly_herb',
    name: 'Monthly Herb Box',
    description: 'Assorted fresh herbs',
    frequency: 'monthly',
    price: 15.00,
    delivery_day: 'first_wednesday'
  }
};

/**
 * GET /api/farm-sales/subscriptions/plans
 * List available subscription plans
 */
router.get('/plans', (req, res) => {
  res.json({
    ok: true,
    plans: Object.values(SUBSCRIPTION_PLANS)
  });
});

/**
 * POST /api/farm-sales/subscriptions
 * Create new subscription
 * 
 * Body:
 * {
 *   plan_id: string,
 *   customer: { name, email, phone, address },
 *   payment: { method: 'card'|'invoice', card?: { last4, brand }, billing_day?: number },
 *   start_date: 'YYYY-MM-DD',
 *   delivery: { time_slot: 'morning'|'afternoon'|'evening', instructions? },
 *   preferences?: { allergies?, substitutions?, skip_items? }
 * }
 */
router.post('/', async (req, res) => {
  try {
    const { plan_id, customer, payment, start_date, delivery, preferences } = req.body;
    const farmId = req.farm_id;

    // Validate plan
    const plan = SUBSCRIPTION_PLANS[plan_id?.toUpperCase()];
    if (!plan) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_plan',
        message: `Plan must be one of: ${Object.keys(SUBSCRIPTION_PLANS).join(', ')}`
      });
    }

    // Validate required fields
    if (!customer?.email || !start_date || !payment?.method) {
      return res.status(400).json({
        ok: false,
        error: 'missing_required_fields',
        message: 'customer.email, start_date, and payment.method are required'
      });
    }

    const subscriptionId = farmStores.subscriptions.generateId(farmId, 'SUB', 5);
    const timestamp = new Date().toISOString();

    // Calculate next delivery date based on plan frequency
    const nextDelivery = calculateNextDelivery(start_date, plan.frequency, plan.delivery_day);

    const subscription = {
      subscription_id: subscriptionId,
      plan,
      status: 'active',
      customer,
      payment: {
        method: payment.method,
        card: payment.card,
        billing_day: payment.billing_day || 1,
        status: 'current'
      },
      delivery: {
        address: customer.address,
        time_slot: delivery?.time_slot || 'afternoon',
        instructions: delivery?.instructions
      },
      preferences: preferences || {},
      schedule: {
        start_date,
        next_delivery: nextDelivery,
        last_delivery: null,
        total_deliveries: 0
      },
      history: [],
      timestamps: {
        created_at: timestamp,
        updated_at: timestamp,
        cancelled_at: null
      }
    };

    farmStores.subscriptions.set(farmId, subscriptionId, subscription);

    res.status(201).json({
      ok: true,
      subscription_id: subscriptionId,
      subscription,
      next_order_date: nextDelivery
    });

  } catch (error) {
    console.error('[farm-sales] Subscription creation failed:', error);
    res.status(500).json({
      ok: false,
      error: 'subscription_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/subscriptions
 * List subscriptions
 * 
 * Query params:
 * - customer_email: Filter by customer
 * - status: Filter by status (active, paused, cancelled)
 * - plan_id: Filter by plan
 */
router.get('/', (req, res) => {
  try {
    const { customer_email, status, plan_id } = req.query;
    const farmId = req.farm_id;
    
    let filtered = farmStores.subscriptions.getAllForFarm(farmId);

    if (customer_email) {
      filtered = filtered.filter(s => s.customer.email === customer_email);
    }
    if (status) {
      filtered = filtered.filter(s => s.status === status);
    }
    if (plan_id) {
      filtered = filtered.filter(s => s.plan.id === plan_id);
    }

    // Sort by created_at descending
    filtered.sort((a, b) => 
      new Date(b.timestamps.created_at) - new Date(a.timestamps.created_at)
    );

    // Calculate stats
    const stats = {
      total: filtered.length,
      by_status: {},
      by_plan: {},
      monthly_recurring_revenue: 0
    };

    filtered.forEach(sub => {
      // Count by status
      if (!stats.by_status[sub.status]) {
        stats.by_status[sub.status] = 0;
      }
      stats.by_status[sub.status]++;

      // Count by plan
      if (!stats.by_plan[sub.plan.id]) {
        stats.by_plan[sub.plan.id] = 0;
      }
      stats.by_plan[sub.plan.id]++;

      // Calculate MRR
      if (sub.status === 'active') {
        const monthlyValue = sub.plan.frequency === 'weekly' ? sub.plan.price * 4 :
                           sub.plan.frequency === 'biweekly' ? sub.plan.price * 2 :
                           sub.plan.price;
        stats.monthly_recurring_revenue += monthlyValue;
      }
    });

    res.json({
      ok: true,
      subscriptions: filtered,
      stats
    });

  } catch (error) {
    console.error('[farm-sales] Subscription list failed:', error);
    res.status(500).json({
      ok: false,
      error: 'list_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/subscriptions/:subscriptionId
 * Get single subscription details
 */
router.get('/:subscriptionId', (req, res) => {
  const { subscriptionId } = req.params;
  const farmId = req.farm_id;
  const subscription = farmStores.subscriptions.get(farmId, subscriptionId);

  if (!subscription) {
    return res.status(404).json({
      ok: false,
      error: 'subscription_not_found',
      subscription_id: subscriptionId
    });
  }

  res.json({
    ok: true,
    subscription
  });
});

/**
 * PATCH /api/farm-sales/subscriptions/:subscriptionId
 * Update subscription
 * 
 * Body:
 * {
 *   status?: 'active'|'paused'|'cancelled',
 *   delivery?: { address?, time_slot?, instructions? },
 *   preferences?: { allergies?, substitutions?, skip_items? },
 *   plan_id?: string (change plan)
 * }
 */
router.patch('/:subscriptionId', (req, res) => {
  try {
    const { subscriptionId } = req.params;
    const updates = req.body;
    const farmId = req.farm_id;
    const subscription = farmStores.subscriptions.get(farmId, subscriptionId);

    if (!subscription) {
      return res.status(404).json({
        ok: false,
        error: 'subscription_not_found',
        subscription_id: subscriptionId
      });
    }

    const timestamp = new Date().toISOString();

    // Update status
    if (updates.status) {
      subscription.status = updates.status;
      if (updates.status === 'cancelled') {
        subscription.timestamps.cancelled_at = timestamp;
      }
    }

    // Update delivery settings
    if (updates.delivery) {
      subscription.delivery = {
        ...subscription.delivery,
        ...updates.delivery
      };
    }

    // Update preferences
    if (updates.preferences) {
      subscription.preferences = {
        ...subscription.preferences,
        ...updates.preferences
      };
    }

    // Change plan
    if (updates.plan_id) {
      const newPlan = SUBSCRIPTION_PLANS[updates.plan_id.toUpperCase()];
      if (!newPlan) {
        return res.status(400).json({
          ok: false,
          error: 'invalid_plan',
          message: 'Invalid plan_id'
        });
      }
      subscription.plan = newPlan;
      subscription.schedule.next_delivery = calculateNextDelivery(
        new Date().toISOString().split('T')[0],
        newPlan.frequency,
        newPlan.delivery_day
      );
    }

    subscription.timestamps.updated_at = timestamp;
    subscriptions.set(subscriptionId, subscription);

    res.json({
      ok: true,
      subscription
    });

  } catch (error) {
    console.error('[farm-sales] Subscription update failed:', error);
    res.status(500).json({
      ok: false,
      error: 'update_failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farm-sales/subscriptions/:subscriptionId/skip
 * Skip upcoming delivery
 * 
 * Body:
 * {
 *   delivery_date: 'YYYY-MM-DD',
 *   reason?: string
 * }
 */
router.post('/:subscriptionId/skip', (req, res) => {
  try {
    const { subscriptionId } = req.params;
    const { delivery_date, reason } = req.body;
    const farmId = req.farm_id;
    const subscription = farmStores.subscriptions.get(farmId, subscriptionId);

    if (!subscription) {
      return res.status(404).json({
        ok: false,
        error: 'subscription_not_found',
        subscription_id: subscriptionId
      });
    }

    if (!delivery_date) {
      return res.status(400).json({
        ok: false,
        error: 'delivery_date_required'
      });
    }

    const timestamp = new Date().toISOString();

    // Add skip to history
    const skip = {
      type: 'skip',
      delivery_date,
      reason: reason || 'Customer requested',
      skipped_at: timestamp
    };

    if (!subscription.history) {
      subscription.history = [];
    }
    subscription.history.push(skip);

    // Calculate next delivery after skip
    subscription.schedule.next_delivery = calculateNextDelivery(
      delivery_date,
      subscription.plan.frequency,
      subscription.plan.delivery_day
    );

    subscription.timestamps.updated_at = timestamp;
    subscriptions.set(subscriptionId, subscription);

    res.json({
      ok: true,
      message: `Delivery on ${delivery_date} skipped`,
      next_delivery: subscription.schedule.next_delivery,
      subscription
    });

  } catch (error) {
    console.error('[farm-sales] Skip delivery failed:', error);
    res.status(500).json({
      ok: false,
      error: 'skip_failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farm-sales/subscriptions/generate-orders
 * Generate orders for upcoming subscriptions (run daily via cron)
 * 
 * Query params:
 * - date: Generate orders for this date (defaults to tomorrow)
 */
router.post('/generate-orders', async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || getTomorrowDate();
    const farmId = req.farm_id;

    // Find subscriptions with next_delivery matching target date (farm-scoped)
    const dueSubscriptions = farmStores.subscriptions.getAllForFarm(farmId)
      .filter(sub => 
        sub.status === 'active' &&
        sub.schedule.next_delivery === targetDate
      );

    if (dueSubscriptions.length === 0) {
      return res.json({
        ok: true,
        message: `No subscriptions due for ${targetDate}`,
        orders_created: 0
      });
    }

    const createdOrders = [];

    for (const sub of dueSubscriptions) {
      // TODO: Generate box contents based on seasonal availability
      const boxItems = [
        { sku_id: 'LG-001', name: 'Baby Leaf Lettuce Mix', quantity: 1, unit_price: 4.50, category: 'leafy_greens' },
        { sku_id: 'HB-001', name: 'Basil (Sweet)', quantity: 2, unit_price: 1.50, category: 'herbs' },
        { sku_id: 'PR-001', name: 'Cherry Tomatoes', quantity: 1, unit_price: 3.50, category: 'produce' }
      ];

      // Create order via orders endpoint
      const orderResponse = await fetch('http://localhost:8091/api/farm-sales/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'delivery',
          customer: sub.customer,
          items: boxItems,
          payment: {
            method: sub.payment.method,
            amount: sub.plan.price
          },
          delivery: {
            date: targetDate,
            time_slot: sub.delivery.time_slot,
            instructions: sub.delivery.instructions
          },
          notes: `Subscription ${sub.subscription_id} - ${sub.plan.name}`,
          subscription_id: sub.subscription_id
        })
      });

      const orderData = await orderResponse.json();
      if (orderData.ok) {
        createdOrders.push(orderData.order_id);

        // Update subscription
        sub.schedule.last_delivery = targetDate;
        sub.schedule.total_deliveries++;
        sub.schedule.next_delivery = calculateNextDelivery(
          targetDate,
          sub.plan.frequency,
          sub.plan.delivery_day
        );
        sub.history.push({
          type: 'order_created',
          order_id: orderData.order_id,
          delivery_date: targetDate,
          created_at: new Date().toISOString()
        });
        farmStores.subscriptions.set(farmId, sub.subscription_id, sub);
      }
    }

    res.json({
      ok: true,
      message: `Generated ${createdOrders.length} orders for ${targetDate}`,
      orders_created: createdOrders.length,
      order_ids: createdOrders
    });

  } catch (error) {
    console.error('[farm-sales] Order generation failed:', error);
    res.status(500).json({
      ok: false,
      error: 'generation_failed',
      message: error.message
    });
  }
});

/**
 * Helper: Calculate next delivery date based on frequency
 */
function calculateNextDelivery(fromDate, frequency, deliveryDay) {
  const date = new Date(fromDate);
  
  switch (frequency) {
    case 'weekly':
      date.setDate(date.getDate() + 7);
      break;
    case 'biweekly':
      date.setDate(date.getDate() + 14);
      break;
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      break;
  }

  return date.toISOString().split('T')[0];
}

/**
 * Helper: Get tomorrow's date
 */
function getTomorrowDate() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

export default router;
