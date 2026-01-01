/**
 * Generate URL-safe slug from farm name
 * Examples:
 *   "Sunrise Acres Farm" → "sunrise-acres-farm"
 *   "Green Valley Co." → "green-valley-co"
 *   "Urban Harvest #1" → "urban-harvest-1"
 */
export function generateFarmSlug(farmName) {
  return farmName
    .toLowerCase()
    .trim()
    // Replace spaces and special chars with hyphens
    .replace(/[^a-z0-9]+/g, '-')
    // Remove leading/trailing hyphens
    .replace(/^-+|-+$/g, '')
    // Collapse multiple hyphens
    .replace(/-+/g, '-')
    // Limit length
    .substring(0, 50);
}

/**
 * Check if slug is available
 * @param {Pool} pool - PostgreSQL pool
 * @param {string} slug - Proposed slug
 * @returns {boolean} true if available
 */
export async function isSlugAvailable(pool, slug) {
  try {
    const result = await pool.query(
      'SELECT farm_id FROM farms WHERE farm_slug = $1',
      [slug]
    );
    return result.rows.length === 0;
  } catch (error) {
    console.error('[SlugGenerator] Error checking slug availability:', error);
    return false;
  }
}

/**
 * Generate unique slug (adds number if needed)
 * @param {Pool} pool - PostgreSQL pool
 * @param {string} farmName - Farm name
 * @returns {string} Unique slug
 */
export async function generateUniqueSlug(pool, farmName) {
  const baseSlug = generateFarmSlug(farmName);
  
  // Check if base slug is available
  if (await isSlugAvailable(pool, baseSlug)) {
    return baseSlug;
  }
  
  // Try with numbers: farm-name-2, farm-name-3, etc.
  for (let i = 2; i <= 100; i++) {
    const numberedSlug = `${baseSlug}-${i}`;
    if (await isSlugAvailable(pool, numberedSlug)) {
      return numberedSlug;
    }
  }
  
  // Fallback: use timestamp
  return `${baseSlug}-${Date.now()}`;
}
