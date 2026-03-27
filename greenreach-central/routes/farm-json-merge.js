/**
 * GET /data/farm.json -- Merge DB data on top of static farm.json
 *
 * After a deploy, the flat file reverts to the repo version. This route
 * ensures the browser always gets the latest profile from the DB.
 *
 * Auto-seed: If the DB has no farm_profile but the flat file contains
 * meaningful data (contact info, rooms, coordinates), it writes the flat
 * file content into the DB so the profile persists across future deploys.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FLAT_FILE = path.join(__dirname, '..', 'public', 'data', 'farm.json');

// Track whether we already seeded this process lifetime (avoid repeated writes)
let _seeded = false;

export default function mountFarmJsonRoute(app, { farmStore, logger }) {
  app.get('/data/farm.json', async (req, res) => {
    try {
      // 1. Load the static flat file as the base
      let base = {};
      try { base = JSON.parse(fs.readFileSync(FLAT_FILE, 'utf8')); } catch (_) {}

      // 2. Resolve farm ID -- unauthenticated requests use flat file farmId
      const fid = farmStore.farmIdFromReq(req) || base.farmId || process.env.FARM_ID;
      if (!fid || fid === 'default') {
        return res.json(base);
      }

      // 3. Try loading farm_profile from DB
      const profile = await farmStore.get(fid, 'farm_profile');
      const hasDbProfile = profile && typeof profile === 'object'
        && Object.keys(profile).length > 0
        && profile.contact && profile.contact.name && profile.setup_completed;

      // 4. Auto-seed: flat file has meaningful data but DB does not
      if (!hasDbProfile && !_seeded && base.farmId) {
        const hasMeaningfulBase = base.contact?.name || base.rooms?.length || base.coordinates?.lat;
        if (hasMeaningfulBase) {
          _seeded = true;
          logger.info('[Farm JSON] Auto-seeding DB farm_profile for ' + fid + ' from flat file');
          try {
            // Build a clean profile from the flat file data
            const seedProfile = {
              farmId: base.farmId,
              name: base.farmName || base.name,
              farmName: base.farmName || base.name,
              contact: base.contact || {},
              location: {
                address: base.address || '',
                city: base.city || '',
                state: base.state || '',
                postalCode: base.postalCode || '',
                timezone: base.timezone || 'America/New_York',
                latitude: base.coordinates?.lat || null,
                longitude: base.coordinates?.lng || null
              },
              coordinates: base.coordinates || {},
              certifications: base.certifications || {},
              tax: base.tax || {},
              dedicated_crops: base.dedicated_crops || [],
              status: 'active',
              setup_completed: true,
              setup_completed_at: base.setup_completed_at || new Date().toISOString()
            };
            await farmStore.set(fid, 'farm_profile', seedProfile);
            logger.info('[Farm JSON] Auto-seed complete for ' + fid);

            // Also seed rooms if present
            if (base.rooms && Array.isArray(base.rooms) && base.rooms.length > 0) {
              await farmStore.set(fid, 'rooms', base.rooms);
              logger.info('[Farm JSON] Auto-seeded ' + base.rooms.length + ' room(s) for ' + fid);
            }

            // Return the seeded data merged with the base
            const merged = { ...base, ...seedProfile };
            if (base.contact) merged.contact = { ...(base.contact || {}), ...(seedProfile.contact || {}) };
            if (base.coordinates) merged.coordinates = { ...(base.coordinates || {}), ...(seedProfile.coordinates || {}) };
            if (base.integrations) merged.integrations = base.integrations;
            merged.rooms = base.rooms || [];
            return res.json(merged);
          } catch (seedErr) {
            logger.warn('[Farm JSON] Auto-seed failed (non-fatal):', seedErr.message);
            // Fall through to serve flat file
          }
        }
      }

      // 5. Normal merge: DB profile on top of flat file base
      if (hasDbProfile) {
        const merged = { ...base, ...profile };
        // Ensure nested objects merge correctly
        if (profile.contact || base.contact) {
          merged.contact = { ...(base.contact || {}), ...(profile.contact || {}) };
        }
        if (profile.coordinates || base.coordinates) {
          merged.coordinates = { ...(base.coordinates || {}), ...(profile.coordinates || {}) };
        }
        // Preserve integrations from flat file (SwitchBot creds etc.)
        if (base.integrations) {
          merged.integrations = { ...(base.integrations || {}), ...(profile.integrations || {}) };
        }
        // Always include rooms (may be in DB as separate data type)
        if (!merged.rooms || !merged.rooms.length) {
          try {
            const dbRooms = await farmStore.get(fid, 'rooms');
            if (Array.isArray(dbRooms) && dbRooms.length > 0) {
              merged.rooms = dbRooms;
            } else {
              merged.rooms = base.rooms || [];
            }
          } catch (_) {
            merged.rooms = base.rooms || [];
          }
        }
        return res.json(merged);
      }

      return res.json(base);
    } catch (err) {
      logger.warn('[Farm JSON] Merge failed, serving flat file:', err.message);
      try {
        return res.json(JSON.parse(fs.readFileSync(FLAT_FILE, 'utf8')));
      } catch (_) {
        return res.status(500).json({ error: 'Farm data unavailable' });
      }
    }
  });
}
