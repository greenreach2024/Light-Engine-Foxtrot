/**
 * Subscription Scheduler
 * Processes due wholesale standing orders (subscriptions).
 * Runs on a periodic interval, finds subscriptions where next_order_date <= today,
 * creates orders using the buyer's saved card on file, then advances next_order_date.
 */

import { isDatabaseAvailable, query } from '../config/database.js';
import { getBuyerById, createOrder } from './wholesaleMemoryStore.js';
import { processSquarePayments } from './squarePaymentService.js';

const INTERVAL_MS = 60 * 60 * 1000; // Check every hour
let schedulerTimer = null;

function advanceDate(currentDate, cadence) {
  const d = new Date(currentDate);
  if (cadence === 'weekly') d.setDate(d.getDate() + 7);
  else if (cadence === 'biweekly') d.setDate(d.getDate() + 14);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

async function processDueSubscriptions() {
  if (!isDatabaseAvailable()) return;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const result = await query(
      `SELECT * FROM wholesale_subscriptions WHERE status = 'active' AND next_order_date <= $1`,
      [today]
    );

    if (!result.rows.length) return;

    console.log(`[SubscriptionScheduler] Processing ${result.rows.length} due subscription(s)`);

    for (const sub of result.rows) {
      try {
        const buyer = await getBuyerById(sub.buyer_id);
        if (!buyer || !buyer.squareCardId) {
          console.warn(`[SubscriptionScheduler] Buyer ${sub.buyer_id} missing or no card on file, skipping sub ${sub.id}`);
          await query(
            `UPDATE wholesale_subscriptions SET status = 'paused', updated_at = NOW() WHERE id = $1`,
            [sub.id]
          );
          continue;
        }

        const cart = typeof sub.cart === 'string' ? JSON.parse(sub.cart) : (sub.cart || []);
        if (!cart.length) {
          console.warn(`[SubscriptionScheduler] Empty cart for sub ${sub.id}, skipping`);
          continue;
        }

        // Build farm sub-orders from cart
        const farmMap = new Map();
        for (const item of cart) {
          const farmId = item.farm_id || sub.farm_id;
          if (!farmId) continue;
          if (!farmMap.has(farmId)) farmMap.set(farmId, { items: [], subtotal: 0 });
          const entry = farmMap.get(farmId);
          const lineTotal = (item.price || 0) * (item.quantity || 1);
          entry.items.push(item);
          entry.subtotal += lineTotal;
        }

        const masterOrderId = `SUB-ORD-${sub.id}-${Date.now()}`;
        const farmSubOrders = [];
        for (const [farmId, data] of farmMap) {
          farmSubOrders.push({
            farm_id: farmId,
            sub_order_id: `${masterOrderId}-${farmId}`,
            total_amount_cents: Math.round(data.subtotal * 100),
            buyer_id: buyer.id,
            buyer_email: buyer.email,
            items: data.items
          });
        }

        // Charge the card on file
        const commissionRate = Number(process.env.WHOLESALE_COMMISSION_RATE || 0.12);
        const payResult = await processSquarePayments({
          masterOrderId,
          farmSubOrders,
          paymentSource: { sourceId: buyer.squareCardId },
          commissionRate
        });

        if (payResult.success) {
          // Create the order record
          const order = createOrder({
            buyerId: buyer.id,
            items: cart,
            fulfillmentMethod: sub.fulfillment_method || 'delivery',
            deliveryAddress: sub.delivery_address,
            paymentMethod: 'card_on_file',
            subscriptionId: sub.id
          });

          console.log(`[SubscriptionScheduler] Created order ${order?.master_order_id || masterOrderId} for sub ${sub.id}`);
        } else {
          console.error(`[SubscriptionScheduler] Payment failed for sub ${sub.id}:`, payResult.paymentResults?.map(r => r.error));
        }

        // Advance next_order_date regardless (avoid infinite retries on bad card)
        const nextDate = advanceDate(sub.next_order_date, sub.cadence);
        await query(
          `UPDATE wholesale_subscriptions SET next_order_date = $1, updated_at = NOW() WHERE id = $2`,
          [nextDate, sub.id]
        );

      } catch (subErr) {
        console.error(`[SubscriptionScheduler] Error processing sub ${sub.id}:`, subErr.message);
      }
    }
  } catch (error) {
    console.error('[SubscriptionScheduler] Error in scheduler run:', error.message);
  }
}

export function startSubscriptionScheduler() {
  if (schedulerTimer) return;
  console.log('[SubscriptionScheduler] Started (interval: 1h)');
  // Run once on startup after a short delay
  setTimeout(processDueSubscriptions, 30000);
  schedulerTimer = setInterval(processDueSubscriptions, INTERVAL_MS);
}

export function stopSubscriptionScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

export default { startSubscriptionScheduler, stopSubscriptionScheduler, processDueSubscriptions };
