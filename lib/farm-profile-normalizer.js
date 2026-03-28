/**
 * Farm Profile Normalizer
 *
 * Produces a unified profile shape from either the LE farm.json (minimal)
 * or the Central farm.json (full) schema.  Consumers should call
 * normalizeFarmProfile(raw) instead of assuming a key layout.
 */

export function normalizeFarmProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const coords = raw.coordinates
    || raw.metadata?.location?.coordinates
    || { lat: null, lng: null };

  return {
    farmId:       raw.farmId || raw.farm_id || null,
    name:         raw.name || raw.farmName || null,
    status:       raw.status || 'unknown',
    email:        raw.email || raw.contact?.email || null,
    timezone:     raw.timezone || null,

    // Location
    address:      raw.address || null,
    city:         raw.city || raw.metadata?.location?.city || null,
    state:        raw.state || raw.metadata?.location?.state || null,
    postalCode:   raw.postalCode || raw.metadata?.location?.zip || null,
    region:       raw.region || null,
    country:      raw.metadata?.location?.country || null,
    coordinates:  { lat: coords.lat ?? null, lng: coords.lng ?? null },

    // Contact
    contact: {
      name:    raw.contact?.name || raw.contactName || null,
      email:   raw.contact?.email || raw.email || null,
      phone:   raw.contact?.phone || raw.phone || null,
      website: raw.contact?.website || raw.website || null,
    },

    // Tax
    tax: {
      rate:            raw.tax?.rate ?? raw.taxRate ?? null,
      label:           raw.tax?.label || null,
      businessNumber:  raw.tax?.business_number || null,
    },

    currency:     raw.currency || 'CAD',

    // Rooms / locations
    rooms:        raw.rooms || [],
    locations:    raw.locations || (raw.rooms ? raw.rooms.map(r => r.name) : []),

    // Crops
    dedicatedCrops: raw.dedicated_crops || raw.dedicatedCrops || [],

    // Integrations (only present on LE copy)
    integrations: raw.integrations || {},

    // Metadata passthrough
    schemaVersion: raw.schemaVersion || null,
    setupCompleted: raw.setup_completed ?? null,
    created:        raw.created || raw.created_at || null,
    updated:        raw.updated_at || null,
  };
}
