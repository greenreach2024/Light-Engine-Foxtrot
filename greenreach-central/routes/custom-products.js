import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { uploadFile, USE_GCS, getSignedUrl } from '../services/gcs-storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// ── Multer config: memory storage, 2MB limit, image MIME filter ──
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

const PRODUCT_IMAGES_DIR = path.join(__dirname, '..', 'public', 'product-images');

// ── Helper: resolve farm ID from request ──
function getFarmId(req) {
  return req.farmId || req.headers['x-farm-id'] || process.env.FARM_ID || null;
}

// ── Helper: generate unique SKU ──
function generateCustomSku(farmId) {
  const farmShort = (farmId || 'FARM').replace(/^FARM-/, '').substring(0, 8);
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  const hex = Date.now().toString(16).toUpperCase();
  return `CUSTOM-${farmShort}-${rand}-${hex}`;
}

// ── Helper: validate required fields ──
function validateProductFields(body) {
  const errors = [];
  if (!body.product_name || typeof body.product_name !== 'string' || body.product_name.trim().length === 0) {
    errors.push('product_name is required');
  }
  if (body.product_name && body.product_name.trim().length > 255) {
    errors.push('product_name must be 255 characters or fewer');
  }
  if (body.wholesale_price != null && (isNaN(Number(body.wholesale_price)) || Number(body.wholesale_price) < 0)) {
    errors.push('wholesale_price must be a non-negative number');
  }
  if (body.retail_price != null && (isNaN(Number(body.retail_price)) || Number(body.retail_price) < 0)) {
    errors.push('retail_price must be a non-negative number');
  }
  if (body.quantity_available != null && (isNaN(Number(body.quantity_available)) || Number(body.quantity_available) < 0)) {
    errors.push('quantity_available must be a non-negative number');
  }
  if (body.description && body.description.length > 2000) {
    errors.push('description must be 2000 characters or fewer');
  }
  if (body.category && body.category.length > 120) {
    errors.push('category must be 120 characters or fewer');
  }
  return errors;
}

// ─────────────────────────────────────────────────────────
// GET /api/farm/products -- List custom products for farm
// ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const farmId = getFarmId(req);
    if (!farmId) return res.status(400).json({ success: false, error: 'Farm ID required' });
    if (!isDatabaseAvailable()) return res.status(503).json({ success: false, error: 'Database unavailable' });

    const { rows } = await query(
      `SELECT id, farm_id, product_id, product_name, sku, category, variety,
              description, thumbnail_url, is_taxable, is_custom,
              wholesale_price, retail_price, price, quantity_available, unit,
              available_for_wholesale, inventory_source, status,
              lot_code, created_at, updated_at
       FROM farm_inventory
       WHERE farm_id = $1 AND is_custom = TRUE AND status != 'inactive'
       ORDER BY product_name`,
      [farmId]
    );

    return res.json({
      success: true,
      products: rows,
      count: rows.length,
    });
  } catch (err) {
    console.error('[custom-products] GET list error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load custom products' });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/farm/products/:productId -- Get single product
// ─────────────────────────────────────────────────────────
router.get('/:productId', async (req, res) => {
  try {
    const farmId = getFarmId(req);
    if (!farmId) return res.status(400).json({ success: false, error: 'Farm ID required' });
    if (!isDatabaseAvailable()) return res.status(503).json({ success: false, error: 'Database unavailable' });

    const { rows } = await query(
      `SELECT id, farm_id, product_id, product_name, sku, category, variety,
              description, thumbnail_url, is_taxable, is_custom,
              wholesale_price, retail_price, price, quantity_available, unit,
              available_for_wholesale, inventory_source, status,
              lot_code, created_at, updated_at
       FROM farm_inventory
       WHERE farm_id = $1 AND id = $2 AND is_custom = TRUE AND status != 'inactive'`,
      [farmId, req.params.productId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    return res.json({ success: true, product: rows[0] });
  } catch (err) {
    console.error('[custom-products] GET single error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load product' });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/farm/products -- Create custom product
// ─────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const farmId = getFarmId(req);
    if (!farmId) return res.status(400).json({ success: false, error: 'Farm ID required' });
    if (!isDatabaseAvailable()) return res.status(503).json({ success: false, error: 'Database unavailable' });

    const errors = validateProductFields(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const sku = generateCustomSku(farmId);
    const productId = sku;
    const {
      product_name,
      category = 'Custom',
      variety = null,
      description = null,
      wholesale_price = null,
      retail_price = null,
      quantity_available = 0,
      unit = 'unit',
      is_taxable = true,
      available_for_wholesale = true,
    } = req.body;

    const { rows } = await query(
      `INSERT INTO farm_inventory (
        farm_id, product_id, product_name, sku, sku_id, sku_name, category, variety,
        description, is_taxable, is_custom,
        wholesale_price, retail_price, price,
        quantity_available, quantity, unit,
        available_for_wholesale, inventory_source, status,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $16, $17, $5, $6,
        $7, $8, TRUE,
        $9, $10, $14,
        $11, $15, $12,
        $13, 'custom', 'active',
        NOW(), NOW()
      ) RETURNING *`,
      [
        farmId, productId, product_name.trim(), sku, category, variety,
        description,
        is_taxable === false ? false : true,
        wholesale_price != null ? Number(wholesale_price) : null,
        retail_price != null ? Number(retail_price) : null,
        Number(quantity_available) || 0,
        unit,
        available_for_wholesale === false ? false : true,
        wholesale_price != null ? Number(wholesale_price) : (retail_price != null ? Number(retail_price) : null),
        Number(quantity_available) || 0,
        sku,
        product_name.trim(),
      ]
    );

    console.log(`[custom-products] Created: ${sku} "${product_name}" for farm ${farmId}`);
    return res.status(201).json({ success: true, product: rows[0] });
  } catch (err) {
    console.error('[custom-products] POST create error:', err.message);
    if (err.code === '23505') {
      return res.status(409).json({ success: false, error: 'A product with this SKU already exists' });
    }
    return res.status(500).json({ success: false, error: 'Failed to create product' });
  }
});

// ─────────────────────────────────────────────────────────
// PUT /api/farm/products/:productId -- Update custom product
// ─────────────────────────────────────────────────────────
router.put('/:productId', async (req, res) => {
  try {
    const farmId = getFarmId(req);
    if (!farmId) return res.status(400).json({ success: false, error: 'Farm ID required' });
    if (!isDatabaseAvailable()) return res.status(503).json({ success: false, error: 'Database unavailable' });

    // Verify product exists and is custom
    const { rows: existing } = await query(
      `SELECT id FROM farm_inventory WHERE farm_id = $1 AND id = $2 AND is_custom = TRUE AND status != 'inactive'`,
      [farmId, req.params.productId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Custom product not found' });
    }

    const errors = validateProductFields(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const {
      product_name,
      category,
      variety,
      description,
      wholesale_price,
      retail_price,
      quantity_available,
      unit,
      is_taxable,
      available_for_wholesale,
    } = req.body;

    const setClauses = [];
    const params = [farmId, req.params.productId];
    let paramIdx = 3;

    if (product_name !== undefined) { setClauses.push(`product_name = $${paramIdx++}`); params.push(product_name.trim()); }
    if (category !== undefined) { setClauses.push(`category = $${paramIdx++}`); params.push(category); }
    if (variety !== undefined) { setClauses.push(`variety = $${paramIdx++}`); params.push(variety); }
    if (description !== undefined) { setClauses.push(`description = $${paramIdx++}`); params.push(description); }
    if (wholesale_price !== undefined) { setClauses.push(`wholesale_price = $${paramIdx++}`); params.push(wholesale_price != null ? Number(wholesale_price) : null); }
    if (retail_price !== undefined) { setClauses.push(`retail_price = $${paramIdx++}`); params.push(retail_price != null ? Number(retail_price) : null); }
    if (quantity_available !== undefined) {
      setClauses.push(`quantity_available = $${paramIdx}`);
      setClauses.push(`quantity = $${paramIdx++}`);
      params.push(Number(quantity_available) || 0);
    }
    if (unit !== undefined) { setClauses.push(`unit = $${paramIdx++}`); params.push(unit); }
    if (is_taxable !== undefined) { setClauses.push(`is_taxable = $${paramIdx++}`); params.push(is_taxable === false ? false : true); }
    if (available_for_wholesale !== undefined) { setClauses.push(`available_for_wholesale = $${paramIdx++}`); params.push(available_for_wholesale === false ? false : true); }

    if (setClauses.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    setClauses.push('updated_at = NOW()');
    // Also update price to match primary pricing
    setClauses.push(`price = COALESCE(wholesale_price, retail_price)`);

    const { rows } = await query(
      `UPDATE farm_inventory SET ${setClauses.join(', ')}
       WHERE farm_id = $1 AND id = $2 AND is_custom = TRUE
       RETURNING *`,
      params
    );

    console.log(`[custom-products] Updated product id=${req.params.productId} for farm ${farmId}`);
    return res.json({ success: true, product: rows[0] });
  } catch (err) {
    console.error('[custom-products] PUT update error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to update product' });
  }
});

// ─────────────────────────────────────────────────────────
// DELETE /api/farm/products/:productId -- Soft-delete
// ─────────────────────────────────────────────────────────
router.delete('/:productId', async (req, res) => {
  try {
    const farmId = getFarmId(req);
    if (!farmId) return res.status(400).json({ success: false, error: 'Farm ID required' });
    if (!isDatabaseAvailable()) return res.status(503).json({ success: false, error: 'Database unavailable' });

    const { rowCount } = await query(
      `UPDATE farm_inventory SET status = 'inactive', updated_at = NOW()
       WHERE farm_id = $1 AND id = $2 AND is_custom = TRUE AND status != 'inactive'`,
      [farmId, req.params.productId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Custom product not found' });
    }

    console.log(`[custom-products] Soft-deleted product id=${req.params.productId} for farm ${farmId}`);
    return res.json({ success: true, message: 'Product deactivated' });
  } catch (err) {
    console.error('[custom-products] DELETE error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to delete product' });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/farm/products/:productId/image -- Upload thumbnail
// ─────────────────────────────────────────────────────────
router.post('/:productId/image', upload.single('image'), async (req, res) => {
  try {
    const farmId = getFarmId(req);
    if (!farmId) return res.status(400).json({ success: false, error: 'Farm ID required' });
    if (!isDatabaseAvailable()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    if (!req.file) return res.status(400).json({ success: false, error: 'No image file provided' });

    // Verify product exists and is custom
    const { rows: existing } = await query(
      'SELECT id, sku FROM farm_inventory WHERE farm_id = $1 AND id = $2 AND is_custom = TRUE',
      [farmId, req.params.productId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Custom product not found' });
    }

    const sku = existing[0].sku;
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const allowedExts = ['.jpg', '.jpeg', '.png', '.webp'];
    if (!allowedExts.includes(ext)) {
      return res.status(400).json({ success: false, error: 'Allowed formats: jpg, jpeg, png, webp' });
    }

    // Write file to GCS (Cloud Run) or local filesystem (dev)
    const filename = `${sku}${ext}`;
    const relativePath = `product-images/${farmId}/${filename}`;
    await uploadFile(relativePath, req.file.buffer, req.file.mimetype);

    // Update thumbnail_url in DB
    // On GCS, we store the relative path; the serving layer handles signed URLs or proxying
    const thumbnailUrl = `/product-images/${farmId}/${filename}`;
    await query(
      `UPDATE farm_inventory SET thumbnail_url = $3, updated_at = NOW()
       WHERE farm_id = $1 AND id = $2`,
      [farmId, req.params.productId, thumbnailUrl]
    );

    console.log(`[custom-products] Image uploaded: ${thumbnailUrl} for product id=${req.params.productId}`);
    return res.json({ success: true, thumbnail_url: thumbnailUrl });
  } catch (err) {
    console.error('[custom-products] Image upload error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to upload image' });
  }
});

// Multer error handler
router.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: 'Image must be 2MB or smaller' });
    }
    return res.status(400).json({ success: false, error: err.message });
  }
  if (err.message === 'Only image files are allowed') {
    return res.status(400).json({ success: false, error: err.message });
  }
  next(err);
});

export default router;
