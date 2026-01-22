/**
 * Square Credentials Service
 * Manages Square payment credentials for farms
 */

export async function getBatchFarmSquareCredentials(farmIds) {
  return farmIds.map(farmId => ({
    farm_id: farmId,
    has_credentials: false,
    square_app_id: null,
    square_location_id: null
  }));
}
