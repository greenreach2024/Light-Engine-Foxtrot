/**
 * GreenReach: Buyer Volume Discount Service
 * Computes volume-based discounts from cumulative wholesale purchase history.
 * Purchase volume impacts dynamic pricing -- higher spend = better discount tier.
 */

import { query } from '../database.js';

// Discount tiers: cumulative spend thresholds and corresponding discount rates
const DISCOUNT_TIERS = [
  { min: 10000, rate: 0.10, tier: 'platinum' },
  { min: 5000,  rate: 0.08, tier: 'gold' },
  { min: 2000,  rate: 0.06, tier: 'silver' },
  { min: 500,   rate: 0.03, tier: 'bronze' },
  { min: 0,     rate: 0.00, tier: 'none' }
];

/**
 * Get the buyer's volume discount based on cumulative order spend.
 * @param {string} buyerId - The wholesale buyer ID
 * @returns {Promise<{rate: number, tier: string, total_spend: number}>}
 */
export async function getBuyerDiscount(buyerId) {
  if (!buyerId) {
    return { rate: 0, tier: 'none', total_spend: 0 };
  }

  try {
    const result = await query(
      `SELECT COALESCE(SUM(total_amount), 0) AS total_spend
       FROM wholesale_orders
       WHERE buyer_id = $1 AND status IN ('completed', 'delivered')`,
      [buyerId]
    );

    const totalSpend = Number(result.rows[0]?.total_spend || 0);
    const matched = DISCOUNT_TIERS.find(t => totalSpend >= t.min) || DISCOUNT_TIERS[DISCOUNT_TIERS.length - 1];

    return {
      rate: matched.rate,
      tier: matched.tier,
      total_spend: totalSpend
    };
  } catch (err) {
    console.warn('[BuyerDiscount] Failed to compute discount, defaulting to 0%:', err.message);
    return { rate: 0, tier: 'none', total_spend: 0 };
  }
}
