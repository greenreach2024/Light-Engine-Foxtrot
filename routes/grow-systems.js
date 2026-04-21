/**
 * Grow Systems Route -- /api/grow-systems
 *
 * First runtime consumer of public/data/grow-systems.json.
 * Serves the template registry and exposes the room build-plan
 * computation (farm-load-calculator) as an API endpoint.
 *
 * Endpoints:
 *   GET  /api/grow-systems              -- list all templates
 *   GET  /api/grow-systems/:templateId  -- single template by id
 *   POST /api/grow-systems/compute-room-load -- run load math for a room
 */

import { Router } from 'express';
import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  computeRoomLoad,
  resolveInstalledSystems,
  DEFAULT_ENVELOPE_ACH
} from '../lib/farm-load-calculator.js';
import { scoreTemplate } from '../lib/grow-system-scoring.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = resolve(__dirname, '..', 'public', 'data', 'grow-systems.json');

const router = Router();

// -- Cache the registry in memory (reload on first request + expose reload) --
let registryCache = null;

async function loadRegistry() {
  const raw = await readFile(REGISTRY_PATH, 'utf-8');
  registryCache = JSON.parse(raw);
  return registryCache;
}

async function getRegistry() {
  if (!registryCache) await loadRegistry();
  return registryCache;
}

// ---- GET /api/grow-systems -------------------------------------------------
// Returns all templates with metadata.
router.get('/', async (_req, res) => {
  try {
    const registry = await getRegistry();
    // grow-systems.json uses camelCase keys; read them directly and expose
    // both shapes in the response so existing snake_case consumers and newer
    // camelCase consumers both work.
    res.json({
      ok: true,
      schemaVersion: registry.schemaVersion,
      version: registry.version,
      cropClasses: registry.cropClasses,
      schema_version: registry.schemaVersion,
      data_version: registry.version,
      crop_classes: registry.cropClasses,
      templates: registry.templates
    });
  } catch (err) {
    console.error('[GrowSystems] Failed to load registry:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load grow-systems registry' });
  }
});

// ---- GET /api/grow-systems/:templateId -------------------------------------
// Returns a single template by id.
router.get('/:templateId', async (req, res) => {
  try {
    const registry = await getRegistry();
    const template = (registry.templates || []).find(t => t.id === req.params.templateId);
    if (!template) {
      return res.status(404).json({ ok: false, error: `Template not found: ${req.params.templateId}` });
    }
    res.json({ ok: true, template });
  } catch (err) {
    console.error('[GrowSystems] Template lookup failed:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load template' });
  }
});

// ---- POST /api/grow-systems/compute-room-load ------------------------------
// Accepts a room envelope + installed systems and returns the build plan
// (computed load + reserved controller slots + per-system breakdown).
//
// Body:
//   {
//     room: { length_m, width_m, ceiling_height_m, envelope? },
//     installedSystems: [
//       { templateId: "nft-rack-3tier", quantity: 4, cropClass: "leafy_greens", zoneId? }
//     ]
//   }
//
// Returns the full computeRoomLoad() output.
router.post('/compute-room-load', async (req, res) => {
  try {
    const { room, installedSystems } = req.body || {};

    if (!room || typeof room.length_m !== 'number' || typeof room.width_m !== 'number') {
      return res.status(400).json({
        ok: false,
        error: 'room.length_m and room.width_m are required (numbers in meters)'
      });
    }
    if (typeof room.ceiling_height_m !== 'number') {
      return res.status(400).json({
        ok: false,
        error: 'room.ceiling_height_m is required (number in meters)'
      });
    }
    if (!Array.isArray(installedSystems) || installedSystems.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'installedSystems[] is required (at least one system entry)'
      });
    }

    // Validate each system entry
    for (let i = 0; i < installedSystems.length; i++) {
      const s = installedSystems[i];
      if (!s.templateId || typeof s.templateId !== 'string') {
        return res.status(400).json({
          ok: false,
          error: `installedSystems[${i}].templateId is required`
        });
      }
      if (typeof s.quantity !== 'number' || s.quantity <= 0) {
        return res.status(400).json({
          ok: false,
          error: `installedSystems[${i}].quantity must be a positive number`
        });
      }
      if (!s.cropClass || typeof s.cropClass !== 'string') {
        return res.status(400).json({
          ok: false,
          error: `installedSystems[${i}].cropClass is required`
        });
      }
    }

    const registry = await getRegistry();

    // Resolve templates. farm-load-calculator expects camelCase
    // `dimensions: { lengthM, widthM, ceilingHeightM }` and an envelope object
    // with a `class` field; translate the route's snake_case body into that
    // shape so computeSupplyFanCFM can actually read the room geometry.
    const roomSpec = {
      dimensions: {
        lengthM: room.length_m,
        widthM: room.width_m,
        ceilingHeightM: room.ceiling_height_m
      },
      envelope:
        room.envelope && typeof room.envelope === 'object'
          ? room.envelope
          : { class: room.envelope || 'typical' },
      installedSystems
    };

    const systems = resolveInstalledSystems(
      roomSpec,
      registry,
      (entry) => entry.cropClass
    );

    const result = computeRoomLoad({
      room: roomSpec,
      systems,
      achMap: DEFAULT_ENVELOPE_ACH
    });

    res.json({
      ok: true,
      buildPlan: result
    });
  } catch (err) {
    console.error('[GrowSystems] compute-room-load failed:', err.message);
    const status = err.message.includes('not found in registry') ? 400 : 500;
    res.status(status).json({ ok: false, error: err.message });
  }
});

// ---- POST /api/grow-systems/:templateId/score ------------------------------
// Compute the transpiration, heat-management, and environmental-benchmark
// scores for a template deployed at a given quantity + crop class inside an
// optional room envelope + recipe context. Consumed by the Grow Management
// template-gallery cards.
//
// Body:
//   {
//     cropClass: "leafy_greens",
//     quantity: 1,
//     room?: { dimensions: { lengthM, widthM, ceilingHeightM }, envelope?: { class }, supplyCFM? },
//     recipe?: { max_humidity, vpd, ... }        // a recipe.schedule[] stage, optional
//   }
router.post('/:templateId/score', async (req, res) => {
  try {
    const registry = await getRegistry();
    const template = (registry.templates || []).find(t => t.id === req.params.templateId);
    if (!template) {
      return res.status(404).json({ ok: false, error: `Template not found: ${req.params.templateId}` });
    }

    const { cropClass, quantity = 1, room = null, recipe = null } = req.body || {};
    if (!cropClass || typeof cropClass !== 'string') {
      return res.status(400).json({ ok: false, error: 'cropClass is required (string)' });
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ ok: false, error: 'quantity must be a positive finite number' });
    }
    if (template.plantsPerTrayByClass?.[cropClass] == null) {
      // Use `== null` (not a falsy check) so a legitimate zero-plant class —
      // allowed by the schema's `integerNonNegative` — is not rejected as
      // "no sizing". Downstream scoring/count functions handle 0 correctly.
      return res.status(400).json({
        ok: false,
        error: `template "${template.id}" has no sizing for cropClass "${cropClass}"`
      });
    }

    const scores = scoreTemplate({ template, cropClass, quantity, room, recipe });
    res.json({ ok: true, scores });
  } catch (err) {
    console.error('[GrowSystems] score failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---- POST /api/grow-systems/reload -----------------------------------------
// Force-reload the registry from disk (admin use).
router.post('/reload', async (_req, res) => {
  try {
    await loadRegistry();
    res.json({ ok: true, templates: registryCache.templates.length });
  } catch (err) {
    console.error('[GrowSystems] Registry reload failed:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to reload registry' });
  }
});

export default router;
