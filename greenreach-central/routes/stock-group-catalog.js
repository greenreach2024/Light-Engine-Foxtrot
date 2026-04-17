import express from 'express';
import { query } from '../config/database.js';
import { authOrAdminMiddleware } from '../middleware/auth.js';
import { adminAuthMiddleware, requireAdminRole } from '../middleware/adminAuth.js';

const router = express.Router();

let ensureCatalogTablePromise = null;

async function ensureStockGroupCatalogTable() {
  if (ensureCatalogTablePromise) {
    return ensureCatalogTablePromise;
  }

  ensureCatalogTablePromise = query(
    `CREATE TABLE IF NOT EXISTS stock_group_catalog (
       id SERIAL PRIMARY KEY,
       catalog_key TEXT NOT NULL UNIQUE,
       name TEXT NOT NULL,
       description TEXT,
       category TEXT NOT NULL DEFAULT 'vertical-rack',
       system_type TEXT NOT NULL DEFAULT 'rack',
       dimension_policy TEXT NOT NULL DEFAULT 'fixed',
       resize_axes JSONB NOT NULL DEFAULT '[]'::jsonb,
       default_dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
       min_dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
       max_dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
       default_trays INTEGER NOT NULL DEFAULT 0,
       default_lights INTEGER NOT NULL DEFAULT 0,
       default_light_orientation TEXT NOT NULL DEFAULT 'out-of-canopy',
       default_prefix TEXT,
       template_defaults JSONB NOT NULL DEFAULT '{}'::jsonb,
       active BOOLEAN NOT NULL DEFAULT TRUE,
       sort_order INTEGER NOT NULL DEFAULT 100,
       created_by TEXT,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  )
    .then(() => query('CREATE INDEX IF NOT EXISTS idx_stock_group_catalog_active_sort ON stock_group_catalog(active, sort_order, name)'))
    .then(() => seedStandardTemplates())
    .then(() => undefined)
    .catch((error) => {
      ensureCatalogTablePromise = null;
      throw error;
    });

  return ensureCatalogTablePromise;
}

async function seedStandardTemplates() {
  const templates = [
    {
      catalog_key: 'zipgrow-ziprack-8ft',
      name: 'ZipGrow ZipRack',
      description: 'Double-sided vertical tower rack. 30 x 8-foot ZipGrow towers arranged in 3 sections of 10. Target 540 plant sites per rack.',
      category: 'vertical-rack',
      system_type: 'ziprack',
      dimension_policy: 'fixed',
      resize_axes: [],
      default_dimensions: { length: 2.44, width: 1.37, height: 2.44 },
      min_dimensions: {},
      max_dimensions: {},
      default_trays: 30,
      default_lights: 8,
      default_light_orientation: 'intercanopy',
      default_prefix: 'ZipRack',
      template_defaults: {
        sections: 3,
        towersPerSection: 10,
        plantSiteCount: 540,
        plantsPerTower: 18,
        doubleSided: true,
        towerHeightFt: 8,
        towerSpacingIn: 8,
        lightsPerRack: 8,
        lightType: 'vertical-bar-8ft',
        minCeilingHeightM: 3.66,
        preferredCeilingHeightM: 4.27,
        workingAreaMinM: { length: 2.44, width: 3.20 },
        workingAreaPreferredM: { length: 3.05, width: 3.66 }
      },
      sort_order: 10
    },
    {
      catalog_key: 'dwc-rolling-rack-4x8',
      name: 'DWC Multi-Tier Rack',
      description: 'Commercial multi-tier deep water culture rolling rack. 4 ft x 8 ft grow tray modules, standard 2-tier layout with 128 plant sites per tier.',
      category: 'dwc-rack',
      system_type: 'dwc-rack',
      dimension_policy: 'resizable',
      resize_axes: ['height'],
      default_dimensions: { length: 2.44, width: 1.22, height: 1.83 },
      min_dimensions: { height: 1.63 },
      max_dimensions: { height: 2.95 },
      default_trays: 2,
      default_lights: 4,
      default_light_orientation: 'out-of-canopy',
      default_prefix: 'DWC Rack',
      template_defaults: {
        levels: 2,
        minLevels: 2,
        maxLevels: 3,
        plantSiteCount: 256,
        plantsPerTier: 128,
        clearVerticalSpacingMinIn: 16,
        clearVerticalSpacingTargetIn: 18,
        clearVerticalSpacingMaxIn: 22,
        bottomClearanceIn: 12,
        topServiceClearanceIn: 15,
        lightsPerTier: 2,
        lightType: 'overhead-fixture',
        workingAreaMinM: { length: 1.83, width: 3.05 },
        workingAreaPreferredM: { length: 2.44, width: 3.66 }
      },
      sort_order: 20
    },
    {
      catalog_key: 'agrotonomy-aero-tower-44',
      name: 'Commercial Aeroponic Tower',
      description: 'Vertical aeroponic tower with stacked sections. 44 plant sites across 11 sections with 73 cm base reservoir. Agrotonomy-style commercial tower.',
      category: 'aeroponic-tower',
      system_type: 'aero-tower',
      dimension_policy: 'resizable',
      resize_axes: ['height'],
      default_dimensions: { length: 0.76, width: 0.76, height: 2.50 },
      min_dimensions: { height: 1.80 },
      max_dimensions: { height: 2.90 },
      default_trays: 11,
      default_lights: 4,
      default_light_orientation: 'intercanopy',
      default_prefix: 'Aero Tower',
      template_defaults: {
        plantSiteCount: 40,
        sectionCount: 11,
        sectionHeightIn: 9.75,
        reservoirDiameterCm: 73,
        reservoirHeightCm: 36,
        pumpWatts: 45,
        towerVariants: [
          { plants: 28, heightM: 1.80, sections: 7 },
          { plants: 36, heightM: 2.10, sections: 9 },
          { plants: 44, heightM: 2.50, sections: 11 },
          { plants: 52, heightM: 2.90, sections: 13 }
        ],
        lightsPerTower: 4,
        lightType: 'vertical-bar',
        topServiceClearanceIn: 15,
        workingAreaMinM: { length: 1.22, width: 1.22 },
        workingAreaPreferredM: { length: 1.52, width: 1.52 }
      },
      sort_order: 30
    },
    {
      catalog_key: 'amhydro-nft-rack-4x12',
      name: 'Vertical NFT Rack',
      description: 'Multi-level NFT rack with shallow finishing channels. 4 ft x 12 ft repeated planner module, 3 tiers, 216 target plant sites per module.',
      category: 'nft-rack',
      system_type: 'nft-rack',
      dimension_policy: 'resizable',
      resize_axes: ['height'],
      default_dimensions: { length: 3.66, width: 1.22, height: 1.68 },
      min_dimensions: { height: 1.42 },
      max_dimensions: { height: 2.13 },
      default_trays: 3,
      default_lights: 3,
      default_light_orientation: 'out-of-canopy',
      default_prefix: 'NFT Rack',
      template_defaults: {
        levels: 3,
        minLevels: 2,
        maxLevels: 4,
        plantSiteCount: 216,
        plantsPerTier: 72,
        channelLengthIn: 144,
        holesPerFinishingChannel: 18,
        holesPerNurseryChannel: 72,
        clearVerticalSpacingMinIn: 14,
        clearVerticalSpacingTargetIn: 16,
        clearVerticalSpacingMaxIn: 18,
        bottomClearanceIn: 12,
        topServiceClearanceIn: 15,
        lightsPerTier: 1,
        lightType: 'horizontal-led-fixture',
        workingAreaMinM: { length: 1.83, width: 4.27 },
        workingAreaPreferredM: { length: 2.44, width: 4.88 }
      },
      sort_order: 40
    },
    {
      catalog_key: 'justvertical-grow-rack-6x2',
      name: 'Just Vertical Grow Rack',
      description: 'Double-sided vertical grow wall. 6 ft wide x 2 ft deep x 6 ft high, 210 plant ports per face, 360 total double-sided. 5 overhead LED fixtures.',
      category: 'grow-wall',
      system_type: 'jv-rack',
      dimension_policy: 'fixed',
      resize_axes: [],
      default_dimensions: { length: 1.83, width: 0.61, height: 1.83 },
      min_dimensions: {},
      max_dimensions: {},
      default_trays: 4,
      default_lights: 5,
      default_light_orientation: 'out-of-canopy',
      default_prefix: 'JV Rack',
      template_defaults: {
        levels: 4,
        doubleSided: true,
        plantPortsPerFace: 210,
        plantSiteCount: 360,
        plantsPerFacePlanning: 180,
        lightsPerRack: 5,
        lightWattsEach: 100,
        lightType: 'overhead-led',
        clearVerticalSpacingMinIn: 12,
        clearVerticalSpacingTargetIn: 14,
        clearVerticalSpacingMaxIn: 16,
        bottomClearanceIn: 10,
        topServiceClearanceIn: 12,
        workingAreaMinM: { length: 2.44, width: 1.52 },
        workingAreaPreferredM: { length: 3.05, width: 1.83 }
      },
      sort_order: 50
    }
  ];

  for (const t of templates) {
    try {
      await query(
        `INSERT INTO stock_group_catalog
           (catalog_key, name, description, category, system_type, dimension_policy,
            resize_axes, default_dimensions, min_dimensions, max_dimensions,
            default_trays, default_lights, default_light_orientation, default_prefix,
            template_defaults, active, sort_order, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb,
                 $11, $12, $13, $14, $15::jsonb, TRUE, $16, 'system-seed')
         ON CONFLICT (catalog_key) DO NOTHING`,
        [
          t.catalog_key, t.name, t.description, t.category, t.system_type, t.dimension_policy,
          JSON.stringify(t.resize_axes), JSON.stringify(t.default_dimensions),
          JSON.stringify(t.min_dimensions), JSON.stringify(t.max_dimensions),
          t.default_trays, t.default_lights, t.default_light_orientation, t.default_prefix,
          JSON.stringify(t.template_defaults), t.sort_order
        ]
      );
    } catch (err) {
      console.error('[Stock Group Catalog] Seed error for', t.catalog_key, ':', err.message);
    }
  }
}

function normalizeAxes(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((axis) => String(axis || '').trim().toLowerCase())
    .map((axis) => {
      if (axis === 'x') return 'length';
      if (axis === 'y') return 'width';
      if (axis === 'z') return 'height';
      return axis;
    })
    .filter((axis, index, all) => ['length', 'width', 'height'].includes(axis) && all.indexOf(axis) === index);
}

function coerceDimensionObject(value) {
  const source = value && typeof value === 'object' ? value : {};
  const output = {};
  ['length', 'width', 'height'].forEach((axis) => {
    const raw = Number(source[axis]);
    if (Number.isFinite(raw) && raw > 0) {
      output[axis] = Number(raw.toFixed(2));
    }
  });
  return output;
}

function shapeTemplate(row) {
  return {
    id: row.id,
    catalogKey: row.catalog_key,
    name: row.name,
    description: row.description || '',
    category: row.category,
    systemType: row.system_type,
    dimensionPolicy: row.dimension_policy,
    resizeAxes: normalizeAxes(row.resize_axes),
    defaultDimensions: coerceDimensionObject(row.default_dimensions),
    minDimensions: coerceDimensionObject(row.min_dimensions),
    maxDimensions: coerceDimensionObject(row.max_dimensions),
    defaultTrays: Number(row.default_trays) || 0,
    defaultLights: Number(row.default_lights) || 0,
    defaultLightOrientation: row.default_light_orientation || 'out-of-canopy',
    defaultPrefix: row.default_prefix || '',
    defaults: row.template_defaults && typeof row.template_defaults === 'object' ? row.template_defaults : {},
    active: row.active !== false,
    sortOrder: Number(row.sort_order) || 100,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizePayload(body = {}) {
  const defaultDimensions = coerceDimensionObject(body.defaultDimensions || body.default_dimensions);
  const minDimensions = coerceDimensionObject(body.minDimensions || body.min_dimensions);
  const maxDimensions = coerceDimensionObject(body.maxDimensions || body.max_dimensions);
  const dimensionPolicy = String(body.dimensionPolicy || body.dimension_policy || 'fixed').trim().toLowerCase() === 'resizable'
    ? 'resizable'
    : 'fixed';
  const resizeAxes = dimensionPolicy === 'resizable'
    ? normalizeAxes(body.resizeAxes || body.resize_axes)
    : [];

  return {
    catalogKey: String(body.catalogKey || body.catalog_key || '').trim().toLowerCase(),
    name: String(body.name || '').trim(),
    description: String(body.description || '').trim(),
    category: String(body.category || 'vertical-rack').trim() || 'vertical-rack',
    systemType: String(body.systemType || body.system_type || 'rack').trim() || 'rack',
    dimensionPolicy,
    resizeAxes,
    defaultDimensions,
    minDimensions,
    maxDimensions,
    defaultTrays: Math.max(0, parseInt(body.defaultTrays ?? body.default_trays ?? 0, 10) || 0),
    defaultLights: Math.max(0, parseInt(body.defaultLights ?? body.default_lights ?? 0, 10) || 0),
    defaultLightOrientation: String(body.defaultLightOrientation || body.default_light_orientation || 'out-of-canopy').trim() || 'out-of-canopy',
    defaultPrefix: String(body.defaultPrefix || body.default_prefix || '').trim(),
    defaults: body.defaults && typeof body.defaults === 'object'
      ? body.defaults
      : (body.template_defaults && typeof body.template_defaults === 'object' ? body.template_defaults : {}),
    active: body.active !== false,
    sortOrder: parseInt(body.sortOrder ?? body.sort_order ?? 100, 10) || 100
  };
}

function validateTemplatePayload(payload) {
  if (!payload.catalogKey) return 'catalogKey is required';
  if (!payload.name) return 'name is required';
  if (!payload.defaultDimensions.length || !payload.defaultDimensions.width || !payload.defaultDimensions.height) {
    return 'defaultDimensions.length, width, and height are required';
  }
  if (payload.dimensionPolicy === 'resizable' && payload.resizeAxes.length === 0) {
    return 'resizeAxes must include at least one axis for resizable templates';
  }
  return null;
}

router.get('/farm/stock-group-catalog', authOrAdminMiddleware, async (req, res) => {
  try {
    await ensureStockGroupCatalogTable();
    const { rows } = await query(
      `SELECT id, catalog_key, name, description, category, system_type, dimension_policy,
              resize_axes, default_dimensions, min_dimensions, max_dimensions,
              default_trays, default_lights, default_light_orientation, default_prefix,
              template_defaults, active, sort_order, created_by, created_at, updated_at
         FROM stock_group_catalog
        WHERE active = TRUE
        ORDER BY sort_order ASC, name ASC`
    );

    res.json({ success: true, templates: rows.map(shapeTemplate) });
  } catch (error) {
    console.error('[Stock Group Catalog] Farm GET error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load stock group catalog' });
  }
});

router.get('/admin/stock-group-catalog', adminAuthMiddleware, requireAdminRole('admin', 'editor', 'viewer'), async (req, res) => {
  try {
    await ensureStockGroupCatalogTable();
    const { rows } = await query(
      `SELECT id, catalog_key, name, description, category, system_type, dimension_policy,
              resize_axes, default_dimensions, min_dimensions, max_dimensions,
              default_trays, default_lights, default_light_orientation, default_prefix,
              template_defaults, active, sort_order, created_by, created_at, updated_at
         FROM stock_group_catalog
        ORDER BY sort_order ASC, name ASC`
    );

    res.json({ success: true, templates: rows.map(shapeTemplate) });
  } catch (error) {
    console.error('[Stock Group Catalog] Admin GET error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load stock group catalog' });
  }
});

router.post('/admin/stock-group-catalog', adminAuthMiddleware, requireAdminRole('admin', 'editor'), async (req, res) => {
  try {
    await ensureStockGroupCatalogTable();
    const payload = normalizePayload(req.body);
    const validationError = validateTemplatePayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    const { rows } = await query(
      `INSERT INTO stock_group_catalog (
         catalog_key, name, description, category, system_type, dimension_policy,
         resize_axes, default_dimensions, min_dimensions, max_dimensions,
         default_trays, default_lights, default_light_orientation, default_prefix,
         template_defaults, active, sort_order, created_by
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10,
         $11, $12, $13, $14,
         $15, $16, $17, $18
       )
       RETURNING id, catalog_key, name, description, category, system_type, dimension_policy,
                 resize_axes, default_dimensions, min_dimensions, max_dimensions,
                 default_trays, default_lights, default_light_orientation, default_prefix,
                 template_defaults, active, sort_order, created_by, created_at, updated_at`,
      [
        payload.catalogKey,
        payload.name,
        payload.description || null,
        payload.category,
        payload.systemType,
        payload.dimensionPolicy,
        JSON.stringify(payload.resizeAxes),
        JSON.stringify(payload.defaultDimensions),
        JSON.stringify(payload.minDimensions),
        JSON.stringify(payload.maxDimensions),
        payload.defaultTrays,
        payload.defaultLights,
        payload.defaultLightOrientation,
        payload.defaultPrefix || null,
        JSON.stringify(payload.defaults),
        payload.active,
        payload.sortOrder,
        req.admin?.email || 'unknown'
      ]
    );

    res.status(201).json({ success: true, template: shapeTemplate(rows[0]) });
  } catch (error) {
    const duplicate = String(error.message || '').includes('stock_group_catalog_catalog_key_key');
    console.error('[Stock Group Catalog] Admin POST error:', error.message);
    res.status(duplicate ? 409 : 500).json({
      success: false,
      error: duplicate ? 'catalogKey already exists' : 'Failed to create stock group template'
    });
  }
});

router.put('/admin/stock-group-catalog/:id', adminAuthMiddleware, requireAdminRole('admin', 'editor'), async (req, res) => {
  try {
    await ensureStockGroupCatalogTable();
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid template ID' });
    }

    const payload = normalizePayload(req.body);
    const validationError = validateTemplatePayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    const { rows } = await query(
      `UPDATE stock_group_catalog
          SET catalog_key = $1,
              name = $2,
              description = $3,
              category = $4,
              system_type = $5,
              dimension_policy = $6,
              resize_axes = $7,
              default_dimensions = $8,
              min_dimensions = $9,
              max_dimensions = $10,
              default_trays = $11,
              default_lights = $12,
              default_light_orientation = $13,
              default_prefix = $14,
              template_defaults = $15,
              active = $16,
              sort_order = $17,
              updated_at = NOW()
        WHERE id = $18
        RETURNING id, catalog_key, name, description, category, system_type, dimension_policy,
                  resize_axes, default_dimensions, min_dimensions, max_dimensions,
                  default_trays, default_lights, default_light_orientation, default_prefix,
                  template_defaults, active, sort_order, created_by, created_at, updated_at`,
      [
        payload.catalogKey,
        payload.name,
        payload.description || null,
        payload.category,
        payload.systemType,
        payload.dimensionPolicy,
        JSON.stringify(payload.resizeAxes),
        JSON.stringify(payload.defaultDimensions),
        JSON.stringify(payload.minDimensions),
        JSON.stringify(payload.maxDimensions),
        payload.defaultTrays,
        payload.defaultLights,
        payload.defaultLightOrientation,
        payload.defaultPrefix || null,
        JSON.stringify(payload.defaults),
        payload.active,
        payload.sortOrder,
        id
      ]
    );

    if (!rows[0]) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    res.json({ success: true, template: shapeTemplate(rows[0]) });
  } catch (error) {
    const duplicate = String(error.message || '').includes('stock_group_catalog_catalog_key_key');
    console.error('[Stock Group Catalog] Admin PUT error:', error.message);
    res.status(duplicate ? 409 : 500).json({
      success: false,
      error: duplicate ? 'catalogKey already exists' : 'Failed to update stock group template'
    });
  }
});

router.delete('/admin/stock-group-catalog/:id', adminAuthMiddleware, requireAdminRole('admin'), async (req, res) => {
  try {
    await ensureStockGroupCatalogTable();
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid template ID' });
    }

    const { rowCount } = await query('DELETE FROM stock_group_catalog WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    res.json({ success: true, message: 'Template deleted' });
  } catch (error) {
    console.error('[Stock Group Catalog] Admin DELETE error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete stock group template' });
  }
});

export default router;