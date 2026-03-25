/**
 * GreenReach: Buyer Volume Discount Service
 * Computes volume-based discounts from 30-day trailing wholesale purchase history.
 * Base wholesale = max(floor, retail * SKU factor)
 * Then this discount ladder is applied on top of the base wholesale price.
 */

import { query } from '../database.js';

// Discount tiers: 30-day trailing spend thresholds
// Applied AFTER base wholesale price (retail * sku_factor)
const DISCOUNT_TIERS = [
  { min: 2000, rate: 0.10, tier: 'tier-5' },
  { min: 1000, rate: 0.08, tier: 'tier-4' },
  { min: 500,  rate: 0.06, tier: 'tier-3' },
  { min: 250,  rate: 0.04, tier: 'tier-2' },
  { min: 0,    rate: 0.00, tier: 'tier-1' }
];

/**
 * Get the buyer's volume discount based on 30-day trailing order spend.
 * @param {string} buyerId - The wholesale buyer ID
 * @returns {Promise<{rate: number, tier: string, trailing_spend: number}>}
 */
export async function getBuyerDiscount(buyerId) {
  if (!buyerId) {
    return { rate: 0, tier: 'tier-1', trailing_spend: 0 };
  }

  try {
    const result = await query(
      `SELECT COALESCE(SUM(total_amount), 0) AS trailing_spend
       FROM wholesale_orders
       WHERE buyer_id = $1
         AND status IN ('completed', 'delivered')
         AND created_at >= NOW() - INTERVAL '30 days'`,
      [buyerId]
    );

    const trailingSpend = Number(result.rows[0]?.trailing_spend || 0);
    const matched = DISCOUNT_TIERS.find(t => trailingSpend >= t.min) || DISCOUNT_TIERS[DISCOUNT_TIERS.length - 1];

    return {
      rate: matched.rate,
      tier: matched.tier,
      trailing_spend: trailingSpend
    };
  } catch (err) {
    console.warn('[BuyerDiscount] Failed to compute discount, defaulting to 0%:', err.message);
    return { rate: 0, tier: 'tier-1', trailing_spend: 0 };
  }
}

/** Export tiers for documentation/admin endpoints */
export { DISCOUNT_TIERS };
