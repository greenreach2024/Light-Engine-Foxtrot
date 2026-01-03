/**
 * Farm Provisioning Service
 * Handles automatic resource allocation after purchase
 */

import crypto from 'crypto';

/**
 * Provision a new farm with all required resources
 * @param {Object} params Provisioning parameters
 * @param {string} params.farmId Farm ID
 * @param {string} params.farmName Farm name
 * @param {string} params.planType 'cloud' or 'edge'
 * @param {Object} params.db Database pool
 * @returns {Object} Provisioning results
 */
export async function provisionFarm(params) {
  const { farmId, farmName, planType, db } = params;
  
  console.log(`[Provisioning] Starting provisioning for ${farmId}...`);
  
  const results = {
    farmId,
    posInstanceId: null,
    storeSubdomain: null,
    centralLinked: false,
    errors: []
  };
  
  try {
    // 1. Generate POS instance ID
    results.posInstanceId = generatePOSInstanceId(farmId);
    console.log(`[Provisioning] POS Instance: ${results.posInstanceId}`);
    
    // 2. Generate unique store subdomain
    results.storeSubdomain = await generateStoreSubdomain(farmName, db);
    console.log(`[Provisioning] Store Subdomain: ${results.storeSubdomain}`);
    
    // 3. Update farm record with provisioning data
    await db.query(`
      UPDATE farms 
      SET 
        pos_instance_id = $1,
        store_subdomain = $2,
        central_linked = true,
        central_linked_at = NOW(),
        updated_at = NOW()
      WHERE farm_id = $3
    `, [results.posInstanceId, results.storeSubdomain, farmId]);
    
    results.centralLinked = true;
    console.log(`[Provisioning] Farm ${farmId} provisioned successfully`);
    
    // 4. Register farm with GreenReach Central (async, non-blocking)
    registerWithCentral(farmId, farmName, planType).catch(err => {
      console.error(`[Provisioning] Central registration failed (non-fatal):`, err);
      results.errors.push(`Central registration: ${err.message}`);
    });
    
    return results;
    
  } catch (error) {
    console.error(`[Provisioning] Error provisioning ${farmId}:`, error);
    results.errors.push(error.message);
    throw error;
  }
}

/**
 * Generate POS instance ID
 * Format: POS-{FARM_SHORT_ID}-{RANDOM}
 */
function generatePOSInstanceId(farmId) {
  // Extract timestamp portion from farm ID for consistency
  const farmShortId = farmId.replace('FARM-', '').split('-')[0];
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `POS-${farmShortId}-${random}`;
}

/**
 * Generate unique store subdomain
 * Format: {farm-name-slug} with collision handling
 */
async function generateStoreSubdomain(farmName, db) {
  // Create slug from farm name
  let slug = farmName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with dash
    .replace(/^-+|-+$/g, '')      // Remove leading/trailing dashes
    .substring(0, 50);             // Limit length
  
  // Check for uniqueness, append number if needed
  let attempt = 0;
  let subdomain = slug;
  let isUnique = false;
  
  while (!isUnique && attempt < 100) {
    const result = await db.query(
      'SELECT farm_id FROM farms WHERE store_subdomain = $1',
      [subdomain]
    );
    
    if (result.rows.length === 0) {
      isUnique = true;
    } else {
      attempt++;
      subdomain = `${slug}-${attempt}`;
    }
  }
  
  if (!isUnique) {
    // Fallback to random subdomain if all attempts failed
    subdomain = `farm-${crypto.randomBytes(4).toString('hex')}`;
  }
  
  return subdomain;
}

/**
 * Register farm with GreenReach Central
 * This is async and non-blocking - failure is logged but doesn't stop provisioning
 */
async function registerWithCentral(farmId, farmName, planType) {
  console.log(`[Provisioning] Registering ${farmId} with GreenReach Central...`);
  
  // TODO: Implement actual Central API call
  // For now, this is a placeholder
  // In production, this would:
  // 1. POST to Central API: /api/central/farms/register
  // 2. Include farm metadata (ID, name, plan, created timestamp)
  // 3. Receive Central confirmation and any additional config
  
  // Simulated delay
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log(`[Provisioning] ${farmId} registered with Central (simulated)`);
  
  return {
    success: true,
    centralFarmId: farmId,
    dashboardUrl: `${process.env.CENTRAL_URL || 'http://localhost:8091/central'}/farms/${farmId}`
  };
}

/**
 * Check if farm is fully provisioned
 */
export async function checkProvisioningStatus(farmId, db) {
  const result = await db.query(`
    SELECT 
      pos_instance_id,
      store_subdomain,
      central_linked,
      central_linked_at,
      setup_completed
    FROM farms
    WHERE farm_id = $1
  `, [farmId]);
  
  if (result.rows.length === 0) {
    return { provisioned: false, error: 'Farm not found' };
  }
  
  const farm = result.rows[0];
  
  return {
    provisioned: !!(farm.pos_instance_id && farm.store_subdomain),
    posInstanceId: farm.pos_instance_id,
    storeSubdomain: farm.store_subdomain,
    storeUrl: farm.store_subdomain ? `https://${farm.store_subdomain}.greenreach.store` : null,
    centralLinked: farm.central_linked,
    centralLinkedAt: farm.central_linked_at,
    setupCompleted: farm.setup_completed
  };
}
