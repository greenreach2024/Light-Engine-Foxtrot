/**
 * Device Integration Routes
 * 
 * Ticket I-1.9: Extend farm-data sync with integration records
 * Ticket I-2.10: Add Device Wizard MVP
 * 
 * Manages device integration records for network learning.
 * Records are synced to Central (anonymized) for driver recommendations.
 */

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { createHash, createHmac, randomBytes } from 'crypto';
import Datastore from '@seald-io/nedb';
import axios from 'axios';

const router = Router();

// Integration DB will be passed in during initialization
let integrationDB = null;
let farmHashPepperCache = null;

const FARM_HASH_PEPPER_PATH = path.join(process.cwd(), 'data', '.farm-id-hash-pepper');

function getFarmHashPepper() {
  if (farmHashPepperCache) return farmHashPepperCache;

  const envPepper = process.env.FARM_ID_HASH_PEPPER || process.env.FARM_HASH_PEPPER;
  if (envPepper && typeof envPepper === 'string' && envPepper.trim()) {
    farmHashPepperCache = envPepper.trim();
    return farmHashPepperCache;
  }

  try {
    if (fs.existsSync(FARM_HASH_PEPPER_PATH)) {
      const existing = fs.readFileSync(FARM_HASH_PEPPER_PATH, 'utf8').trim();
      if (existing) {
        farmHashPepperCache = existing;
        return farmHashPepperCache;
      }
    }

    const generated = randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(FARM_HASH_PEPPER_PATH), { recursive: true });
    fs.writeFileSync(FARM_HASH_PEPPER_PATH, generated, { mode: 0o600 });
    farmHashPepperCache = generated;
    console.log('[integrations] Generated local farm hash pepper for HMAC pseudonymization');
    return farmHashPepperCache;
  } catch (error) {
    console.warn('[integrations] Failed to load/create farm hash pepper; using SHA-256 fallback:', error?.message);
    return null;
  }
}

/**
 * Initialize integration routes with database store
 * @param {Datastore} db - NeDB datastore for integrations
 */
export function initIntegrationRoutes(db) {
  integrationDB = db;
  console.log('[integrations] Routes initialized with database');
}

/**
 * Generate a unique record ID
 */
function generateRecordId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `INT-${date}-${random}`;
}

function hashFarmIdLegacy(farmId) {
  return createHash('sha256').update(String(farmId)).digest('hex');
}

/**
 * Hash farm_id for privacy-safe Central sync
 * @param {string} farmId - Plain farm_id
 * @returns {string} SHA256 hash
 */
export function hashFarmId(farmId) {
  const normalizedFarmId = String(farmId || '').trim();
  if (!normalizedFarmId) return null;

  const pepper = getFarmHashPepper();
  if (pepper) {
    return createHmac('sha256', pepper).update(normalizedFarmId).digest('hex');
  }

  return hashFarmIdLegacy(normalizedFarmId);
}

/**
 * GET /api/integrations
 * List all device integrations
 */
router.get('/', async (req, res) => {
  try {
    if (!integrationDB) {
      return res.status(500).json({ ok: false, error: 'Integration database not initialized' });
    }
    
    const integrations = await integrationDB.find({});
    res.json({
      ok: true,
      count: integrations.length,
      integrations: integrations.sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
      )
    });
  } catch (error) {
    console.error('[integrations] List error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/integrations/:id
 * Get a specific integration record
 */
router.get('/:id', async (req, res) => {
  try {
    if (!integrationDB) {
      return res.status(500).json({ ok: false, error: 'Integration database not initialized' });
    }
    
    const record = await integrationDB.findOne({ _id: req.params.id });
    if (!record) {
      return res.status(404).json({ ok: false, error: 'Integration not found' });
    }
    
    res.json({ ok: true, integration: record });
  } catch (error) {
    console.error('[integrations] Get error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/integrations
 * Create a new device integration record
 */
router.post('/', async (req, res) => {
  try {
    if (!integrationDB) {
      return res.status(500).json({ ok: false, error: 'Integration database not initialized' });
    }
    
    const {
      device_type,
      device_make_model,
      protocol,
      driver_id,
      driver_version,
      config,
      room_id,
      zone_id,
      group_id,
      function: deviceFunction,
      capabilities,
      install_context,
      validation,
      feedback
    } = req.body;
    
    // Validate required fields
    if (!device_type || !protocol) {
      return res.status(400).json({
        ok: false,
        error: 'device_type and protocol are required'
      });
    }
    
    const record = {
      _id: generateRecordId(),
      device_type,
      device_make_model: device_make_model || null,
      protocol,
      driver_id: driver_id || `${protocol}.generic.v1`,
      driver_version: driver_version || '1.0.0',
      config: config || {},
      room_id: room_id || null,
      zone_id: zone_id || null,
      group_id: group_id || null,
      function: deviceFunction || null,
      capabilities: capabilities || { telemetry: [], commands: [] },
      install_context: install_context || {},
      validation: validation || { passed: false },
      feedback: feedback || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      synced_at: null
    };
    
    await integrationDB.insert(record);
    
    console.log(`[integrations] Created integration record: ${record._id}`);
    res.status(201).json({ ok: true, integration: record });
  } catch (error) {
    console.error('[integrations] Create error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * PATCH /api/integrations/:id
 * Update an integration record (e.g., after validation or feedback)
 */
router.patch('/:id', async (req, res) => {
  try {
    if (!integrationDB) {
      return res.status(500).json({ ok: false, error: 'Integration database not initialized' });
    }
    
    const existing = await integrationDB.findOne({ _id: req.params.id });
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Integration not found' });
    }
    
    const allowedFields = [
      'validation', 'feedback', 'room_id', 'zone_id', 'group_id',
      'function', 'capabilities', 'install_context', 'config'
    ];
    
    const updates = { updated_at: new Date().toISOString() };
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }
    
    await integrationDB.update({ _id: req.params.id }, { $set: updates });
    
    const updated = await integrationDB.findOne({ _id: req.params.id });
    res.json({ ok: true, integration: updated });
  } catch (error) {
    console.error('[integrations] Update error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * DELETE /api/integrations/:id
 * Remove an integration record
 */
router.delete('/:id', async (req, res) => {
  try {
    if (!integrationDB) {
      return res.status(500).json({ ok: false, error: 'Integration database not initialized' });
    }
    
    const numRemoved = await integrationDB.remove({ _id: req.params.id });
    if (numRemoved === 0) {
      return res.status(404).json({ ok: false, error: 'Integration not found' });
    }
    
    res.json({ ok: true, message: 'Integration removed' });
  } catch (error) {
    console.error('[integrations] Delete error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/integrations/pending-sync
 * Get integration records that need to be synced to Central
 * Returns records from last 24 hours that haven't been synced
 */
router.get('/pending-sync', async (req, res) => {
  try {
    if (!integrationDB) {
      return res.status(500).json({ ok: false, error: 'Integration database not initialized' });
    }
    
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const pending = await integrationDB.find({
      $or: [
        { synced_at: null },
        { synced_at: { $exists: false } }
      ],
      created_at: { $gte: oneDayAgo }
    });
    
    res.json({
      ok: true,
      count: pending.length,
      records: pending
    });
  } catch (error) {
    console.error('[integrations] Pending sync error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * Sync integration records to Central (called from sync job)
 * Anonymizes farm_id before sending
 * 
 * @param {string} farmId - The farm's ID
 * @param {string} centralUrl - Central server URL
 * @param {string} apiKey - API key for Central
 * @returns {Promise<{synced: number, errors: number}>}
 */
export async function syncIntegrationsToCentral(farmId, centralUrl, apiKey) {
  if (!integrationDB) {
    console.warn('[integrations] Cannot sync - database not initialized');
    return { synced: 0, errors: 0 };
  }
  
  if (!centralUrl) {
    return { synced: 0, errors: 0 }; // No Central configured
  }
  
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    // Get records from last 24h that haven't been synced, max 50
    const pending = await integrationDB.find({
      $or: [
        { synced_at: null },
        { synced_at: { $exists: false } }
      ],
      created_at: { $gte: oneDayAgo }
    });
    
    if (pending.length === 0) {
      return { synced: 0, errors: 0 };
    }
    
    // Limit to 50 records per sync
    const toSync = pending.slice(0, 50);
    
    // Anonymize records for Central (remove config, hash farm_id)
    const anonymizedRecords = toSync.map(r => ({
      record_id: r._id,
      device_type: r.device_type,
      device_make_model: r.device_make_model,
      driver_id: r.driver_id,
      driver_version: r.driver_version,
      protocol: r.protocol,
      capabilities: r.capabilities,
      install_context: r.install_context,
      validation: {
        passed: r.validation?.passed,
        signal_quality: r.validation?.signal_quality,
        dropout_rate: r.validation?.dropout_rate,
        latency_ms: r.validation?.latency_ms
      },
      feedback: r.feedback ? {
        rating: r.feedback.rating,
        // Don't sync comment - may contain identifying info
      } : null,
      created_at: r.created_at
    }));
    
    const farmIdHash = hashFarmId(farmId);
    const farmIdHashLegacy = hashFarmIdLegacy(farmId);

    const payload = {
      farm_id_hash: farmIdHash,
      farm_id_hash_legacy: farmIdHashLegacy,
      farm_hash_version: farmIdHash === farmIdHashLegacy ? 'sha256:v1-fallback' : 'hmac-sha256:v2',
      records: anonymizedRecords
    };
    
    const response = await axios.post(`${centralUrl}/api/sync/device-integrations`, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      timeout: 15000
    });
    
    if (response.status === 200 || response.status === 201) {
      // Mark records as synced
      const syncedAt = new Date().toISOString();
      for (const record of toSync) {
        await integrationDB.update({ _id: record._id }, { $set: { synced_at: syncedAt } });
      }
      
      console.log(`[integrations] ✓ Synced ${toSync.length} integration record(s) to Central`);
      return { synced: toSync.length, errors: 0 };
    }
    
    return { synced: 0, errors: toSync.length };
  } catch (error) {
    console.warn(`[integrations] Central sync failed:`, error?.message);
    return { synced: 0, errors: 1 };
  }
}

/**
 * Get integration records for inclusion in farm data sync payload
 * Returns last 24h of records (max 50), ready for sync
 * 
 * @param {string} farmId - The farm's ID (will be hashed)
 * @returns {Promise<Array>} Anonymized integration records
 */
export async function getIntegrationRecordsForSync(farmId) {
  if (!integrationDB) return [];
  
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const records = await integrationDB.find({
      created_at: { $gte: oneDayAgo }
    });
    
    // Return max 50 records, anonymized
    return records.slice(0, 50).map(r => ({
      record_id: r._id,
      device_make_model: r.device_make_model,
      driver_id: r.driver_id,
      driver_version: r.driver_version,
      protocol: r.protocol,
      capabilities: r.capabilities,
      install_context: r.install_context,
      validation: {
        passed: r.validation?.passed,
        signal_quality: r.validation?.signal_quality,
        dropout_rate: r.validation?.dropout_rate
      },
      feedback: r.feedback ? { rating: r.feedback.rating } : null,
      created_at: r.created_at
    }));
  } catch (error) {
    console.warn('[integrations] Failed to get records for sync:', error?.message);
    return [];
  }
}

export default router;
