/**
 * Farm Payment Config
 * In-memory cache of per-farm payment provider configuration.
 * Populated by farm setup routes, consumed by payment processing.
 */

const farmPaymentConfigs = new Map();

/**
 * Get payment provider configuration for a farm
 * @param {string} farmId
 * @returns {{ provider: string, config: object } | null}
 */
export function getFarmPaymentConfig(farmId) {
  return farmPaymentConfigs.get(farmId) || null;
}

/**
 * Set payment provider configuration for a farm
 * @param {string} farmId
 * @param {{ provider: string, config: object }} config
 */
export function setFarmPaymentConfig(farmId, config) {
  farmPaymentConfigs.set(farmId, config);
}
