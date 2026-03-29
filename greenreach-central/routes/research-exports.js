/**
 * Research Exports & Data Quality Routes
 * Research Platform Phase 3 -- Export packages, QC flags, alerts
 *
 * Endpoints:
 *   POST   /research/exports                    -- Generate export package
 *   GET    /research/exports                    -- List export packages
 *   GET    /research/exports/:id                -- Get export details
 *   GET    /research/datasets/:id/quality-flags -- List quality flags
 *   POST   /research/datasets/:id/quality-flags -- Create quality flag
 *   PATCH  /research/quality-flags/:id          -- Review quality flag
 *   GET    /research/datasets/:id/qc-reviews    -- List QC reviews
 *   POST   /research/datasets/:id/qc-reviews    -- Create QC review
 *   GET    /research/studies/:id/alerts          -- Study alerts
 *   POST   /research/studies/:id/alerts          -- Create alert
 *   PATCH  /research/alerts/:id/acknowledge      -- Acknowledge alert
 */
import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import crypto from 'crypto';
import { verifyAlertOwnership, verifyDatasetOwnership, verifyExportOwnership, verifyQualityFlagOwnership, verifyStudyOwnership } from '../middleware/research-tenant.js';

const router = Router();

const checkDb = async (req, res, next) => {
  if (!(await isDatabaseAvailable())) {
    return res.status(503).json({ ok: false, error: 'Database not available' });
  }
  next();
};

router.use(checkDb);

// ─── POST /research/exports ───────────────────────────────────────────
router.post('/research/exports', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { study_id, dataset_id, format, includes_metadata, includes_provenance, includes_data_dictionary, generated_by } = req.body;
    if (!format) {
      return res.status(400).json({ ok: false, error: 'format required (csv, parquet, json, notebook)' });
    }

    // Build the export data based on dataset_id
    let exportData = null;
    let fileSize = 0;
    let checksum = null;

    if (dataset_id) {
      // Fetch observations for assembly
      const obs = await query(
        'SELECT * FROM research_observations WHERE dataset_id = $1 ORDER BY observed_at',
        [dataset_id]
      );

      const ds = await query('SELECT * FROM research_datasets WHERE id = $1', [dataset_id]);

      exportData = {
        dataset: ds.rows[0] || {},
        observations: obs.rows,
        observation_count: obs.rows.length,
        exported_at: new Date().toISOString()
      };

      if (includes_provenance) {
        const prov = await query(`
          SELECT pr.* FROM provenance_records pr
          WHERE (pr.entity_type = 'dataset' AND pr.entity_id = $1)
             OR (pr.entity_type = 'observation' AND pr.entity_id IN (
                  SELECT id FROM research_observations WHERE dataset_id = $1
                ))
        `, [dataset_id]);
        exportData.provenance = prov.rows;
      }

      const dataStr = JSON.stringify(exportData);
      fileSize = Buffer.byteLength(dataStr, 'utf8');
      checksum = crypto.createHash('sha256').update(dataStr).digest('hex');
    }

    const result = await query(`
      INSERT INTO export_packages (farm_id, study_id, dataset_id, format, includes_metadata, includes_provenance, includes_data_dictionary, generated_by, file_size, checksum)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [farmId, study_id || null, dataset_id || null, format,
        includes_metadata !== false, includes_provenance || false,
        includes_data_dictionary !== false, generated_by || null,
        fileSize, checksum]);

    // Record provenance for the export
    if (dataset_id) {
      await query(`
        INSERT INTO provenance_records (entity_type, entity_id, source_type, source_id, source_metadata)
        VALUES ('export', $1, 'transformation', $2, $3)
      `, [result.rows[0].id, dataset_id, JSON.stringify({ format, checksum })]);
    }

    res.status(201).json({ ok: true, export_package: result.rows[0], data: exportData });
  } catch (err) {
    console.error('[ResearchExports] Export create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create export' });
  }
});

// ─── GET /research/exports ────────────────────────────────────────────
router.get('/research/exports', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { study_id, dataset_id } = req.query;
    const params = [farmId];
    let where = 'WHERE ep.farm_id = $1';
    if (study_id) { params.push(study_id); where += ` AND ep.study_id = $${params.length}`; }
    if (dataset_id) { params.push(dataset_id); where += ` AND ep.dataset_id = $${params.length}`; }

    const result = await query(`
      SELECT ep.*, u.email as generated_by_email
      FROM export_packages ep
      LEFT JOIN farm_users u ON ep.generated_by = u.id
      ${where}
      ORDER BY ep.generated_at DESC
    `, params);

    res.json({ ok: true, exports: result.rows });
  } catch (err) {
    console.error('[ResearchExports] Export list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list exports' });
  }
});

// ─── GET /research/exports/:id ────────────────────────────────────────
router.get('/research/exports/:id', verifyExportOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT * FROM export_packages WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Export not found' });
    }
    res.json({ ok: true, export_package: result.rows[0] });
  } catch (err) {
    console.error('[ResearchExports] Export get error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get export' });
  }
});

// ─── GET /research/datasets/:id/quality-flags ─────────────────────────
router.get('/research/datasets/:id/quality-flags', verifyDatasetOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { review_status, flag_type, severity } = req.query;

    const params = [id];
    let where = 'WHERE ro.dataset_id = $1';
    if (review_status) { params.push(review_status); where += ` AND dqf.review_status = $${params.length}`; }
    if (flag_type) { params.push(flag_type); where += ` AND dqf.flag_type = $${params.length}`; }
    if (severity) { params.push(severity); where += ` AND dqf.severity = $${params.length}`; }

    const result = await query(`
      SELECT dqf.*, ro.variable_name, ro.observed_at, ro.raw_value
      FROM data_quality_flags dqf
      JOIN research_observations ro ON dqf.observation_id = ro.id
      ${where}
      ORDER BY dqf.created_at DESC
    `, params);

    res.json({ ok: true, quality_flags: result.rows });
  } catch (err) {
    console.error('[ResearchExports] Quality flags list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list quality flags' });
  }
});

// ─── POST /research/datasets/:id/quality-flags ────────────────────────
router.post('/research/datasets/:id/quality-flags', verifyDatasetOwnership, async (req, res) => {
  try {
    const { observation_id, flag_type, severity, description, flagged_by } = req.body;
    if (!observation_id || !flag_type) {
      return res.status(400).json({ ok: false, error: 'observation_id and flag_type required' });
    }

    const result = await query(`
      INSERT INTO data_quality_flags (observation_id, flag_type, severity, description, flagged_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [observation_id, flag_type, severity || 'warning', description || null, flagged_by || 'system']);

    res.status(201).json({ ok: true, flag: result.rows[0] });
  } catch (err) {
    console.error('[ResearchExports] Quality flag create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create quality flag' });
  }
});

// ─── PATCH /research/quality-flags/:id ────────────────────────────────
router.patch('/research/quality-flags/:id', verifyQualityFlagOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { review_status, reviewed_by } = req.body;
    if (!review_status) {
      return res.status(400).json({ ok: false, error: 'review_status required' });
    }

    const result = await query(`
      UPDATE data_quality_flags SET review_status = $1, reviewed_by = $2, reviewed_at = NOW()
      WHERE id = $3 RETURNING *
    `, [review_status, reviewed_by || null, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Quality flag not found' });
    }
    res.json({ ok: true, flag: result.rows[0] });
  } catch (err) {
    console.error('[ResearchExports] Quality flag review error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to review flag' });
  }
});

// ─── GET /research/datasets/:id/qc-reviews ────────────────────────────
router.get('/research/datasets/:id/qc-reviews', verifyDatasetOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(`
      SELECT qr.*, u.email as reviewer_email
      FROM qc_reviews qr
      LEFT JOIN farm_users u ON qr.reviewer_id = u.id
      WHERE qr.dataset_id = $1
      ORDER BY qr.reviewed_at DESC
    `, [id]);

    res.json({ ok: true, reviews: result.rows });
  } catch (err) {
    console.error('[ResearchExports] QC reviews list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list QC reviews' });
  }
});

// ─── POST /research/datasets/:id/qc-reviews ───────────────────────────
router.post('/research/datasets/:id/qc-reviews', verifyDatasetOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewer_id, status, completeness_score, notes } = req.body;

    const result = await query(`
      INSERT INTO qc_reviews (dataset_id, reviewer_id, status, completeness_score, notes, reviewed_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *
    `, [id, reviewer_id || null, status || 'pending', completeness_score ?? null, notes || null]);

    res.status(201).json({ ok: true, review: result.rows[0] });
  } catch (err) {
    console.error('[ResearchExports] QC review create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create QC review' });
  }
});

// ─── GET /research/studies/:id/alerts ──────────────────────────────────
router.get('/research/studies/:id/alerts', verifyStudyOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { acknowledged } = req.query;
    const params = [id];
    let where = 'WHERE sa.study_id = $1';
    if (acknowledged === 'false') { where += ' AND sa.acknowledged_at IS NULL'; }
    if (acknowledged === 'true') { where += ' AND sa.acknowledged_at IS NOT NULL'; }

    const result = await query(`
      SELECT sa.* FROM study_alerts sa ${where}
      ORDER BY sa.created_at DESC
    `, params);

    res.json({ ok: true, alerts: result.rows });
  } catch (err) {
    console.error('[ResearchExports] Alert list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list alerts' });
  }
});

// ─── POST /research/studies/:id/alerts ─────────────────────────────────
router.post('/research/studies/:id/alerts', verifyStudyOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { device_id, alert_type, message, severity } = req.body;
    if (!alert_type || !message) {
      return res.status(400).json({ ok: false, error: 'alert_type and message required' });
    }

    const result = await query(`
      INSERT INTO study_alerts (study_id, device_id, alert_type, message, severity)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [id, device_id || null, alert_type, message, severity || 'warning']);

    res.status(201).json({ ok: true, alert: result.rows[0] });
  } catch (err) {
    console.error('[ResearchExports] Alert create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create alert' });
  }
});

// ─── PATCH /research/alerts/:id/acknowledge ────────────────────────────
router.patch('/research/alerts/:id/acknowledge', verifyAlertOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { acknowledged_by } = req.body;

    const result = await query(`
      UPDATE study_alerts SET acknowledged_by = $1, acknowledged_at = NOW()
      WHERE id = $2 RETURNING *
    `, [acknowledged_by || null, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Alert not found' });
    }
    res.json({ ok: true, alert: result.rows[0] });
  } catch (err) {
    console.error('[ResearchExports] Alert acknowledge error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to acknowledge alert' });
  }
});

export default router;
