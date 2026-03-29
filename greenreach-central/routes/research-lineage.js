/**
 * Research Data Lineage Routes
 * Research Platform Phase 3 -- Data provenance, derivation, annotations, governance
 *
 * Endpoints:
 *   GET/POST   /research/lineage                          -- Query/record lineage events
 *   GET        /research/lineage/chain/:dataset_id        -- Full provenance chain for a dataset
 *   POST       /research/lineage/derivation               -- Record dataset derivation (parent -> child)
 *   GET        /research/lineage/derivation/:dataset_id   -- Get derivation tree
 *   GET/POST   /research/annotations                      -- List/create data annotations
 *   PATCH      /research/annotations/:id                  -- Update annotation
 *   DELETE     /research/annotations/:id                  -- Remove annotation
 *   GET        /research/lineage/governance                -- Data governance dashboard (DMP, retention)
 *   GET        /research/lineage/impact/:dataset_id       -- Downstream impact analysis
 *   GET        /research/lineage/export/:dataset_id       -- Export lineage as JSON-LD (W3C PROV)
 *
 * New tables: dataset_lineage, data_annotations
 */
import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = Router();

const checkDb = (req, res, next) => {
  if (!isDatabaseAvailable()) return res.status(503).json({ ok: false, error: 'Database unavailable' });
  next();
};

router.use(checkDb);

// ── Lineage Events ──

router.get('/research/lineage', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { dataset_id, event_type, limit: lim } = req.query;
    const params = [farmId];
    let where = 'WHERE dl.farm_id = $1';

    if (dataset_id) { params.push(dataset_id); where += ` AND dl.dataset_id = $${params.length}`; }
    if (event_type) { params.push(event_type); where += ` AND dl.event_type = $${params.length}`; }

    const safeLimit = Math.min(Math.max(parseInt(lim, 10) || 20, 1), 100);
    params.push(safeLimit);

    const result = await query(`
      SELECT dl.*, rd.name as dataset_name
      FROM dataset_lineage dl
      LEFT JOIN research_datasets rd ON rd.id = dl.dataset_id
      ${where} ORDER BY dl.created_at DESC LIMIT $${params.length}
    `, params);

    res.json({ ok: true, events: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchLineage] List events error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list lineage events' });
  }
});

router.post('/research/lineage', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { dataset_id, event_type, description, actor, source_entity_type, source_entity_id, metadata } = req.body;
    if (!dataset_id || !event_type) return res.status(400).json({ ok: false, error: 'dataset_id and event_type required' });

    const validTypes = ['created', 'imported', 'transformed', 'derived', 'exported', 'published',
                        'flagged', 'validated', 'archived', 'deleted', 'shared', 'versioned'];
    if (!validTypes.includes(event_type)) {
      return res.status(400).json({ ok: false, error: `event_type must be one of: ${validTypes.join(', ')}` });
    }

    const result = await query(`
      INSERT INTO dataset_lineage (farm_id, dataset_id, event_type, description, actor,
        source_entity_type, source_entity_id, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *
    `, [farmId, dataset_id, event_type, description || null, actor || null,
        source_entity_type || null, source_entity_id || null,
        metadata ? JSON.stringify(metadata) : null]);

    res.status(201).json({ ok: true, event: result.rows[0] });
  } catch (err) {
    console.error('[ResearchLineage] Create event error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to record lineage event' });
  }
});

// ── Provenance Chain ──

router.get('/research/lineage/chain/:dataset_id', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    // Get all lineage events for this dataset ordered chronologically
    const events = await query(`
      SELECT dl.* FROM dataset_lineage dl
      WHERE dl.dataset_id = $1 AND dl.farm_id = $2
      ORDER BY dl.created_at ASC
    `, [req.params.dataset_id, farmId]);

    // Get parent derivations (datasets this was derived from)
    const parents = await query(`
      SELECT dl.*, rd.name as parent_name FROM dataset_lineage dl
      LEFT JOIN research_datasets rd ON rd.id = dl.source_entity_id
      WHERE dl.dataset_id = $1 AND dl.farm_id = $2
        AND dl.event_type = 'derived' AND dl.source_entity_type = 'dataset'
      ORDER BY dl.created_at ASC
    `, [req.params.dataset_id, farmId]);

    // Get child derivations (datasets derived from this one)
    const children = await query(`
      SELECT dl.dataset_id as child_id, rd.name as child_name, dl.created_at as derived_at
      FROM dataset_lineage dl
      LEFT JOIN research_datasets rd ON rd.id = dl.dataset_id
      WHERE dl.source_entity_id = $1 AND dl.source_entity_type = 'dataset'
        AND dl.event_type = 'derived' AND dl.farm_id = $2
      ORDER BY dl.created_at ASC
    `, [req.params.dataset_id, farmId]);

    res.json({
      ok: true,
      dataset_id: req.params.dataset_id,
      chain: events.rows,
      parents: parents.rows,
      children: children.rows,
      event_count: events.rows.length
    });
  } catch (err) {
    console.error('[ResearchLineage] Chain error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load provenance chain' });
  }
});

// ── Derivation ──

router.post('/research/lineage/derivation', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { parent_dataset_id, child_dataset_id, transformation, actor } = req.body;
    if (!parent_dataset_id || !child_dataset_id) {
      return res.status(400).json({ ok: false, error: 'parent_dataset_id and child_dataset_id required' });
    }

    const result = await query(`
      INSERT INTO dataset_lineage (farm_id, dataset_id, event_type, description, actor,
        source_entity_type, source_entity_id, metadata, created_at)
      VALUES ($1, $2, 'derived', $3, $4, 'dataset', $5, $6, NOW())
      RETURNING *
    `, [farmId, child_dataset_id, transformation || 'Derived from parent dataset', actor || null,
        parent_dataset_id, JSON.stringify({ parent_dataset_id, child_dataset_id })]);

    res.status(201).json({ ok: true, derivation: result.rows[0] });
  } catch (err) {
    console.error('[ResearchLineage] Derivation error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to record derivation' });
  }
});

router.get('/research/lineage/derivation/:dataset_id', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    // Recursive CTE to walk full derivation tree upward
    const ancestors = await query(`
      WITH RECURSIVE tree AS (
        SELECT dl.source_entity_id as dataset_id, dl.description, dl.created_at, 1 as depth
        FROM dataset_lineage dl
        WHERE dl.dataset_id = $1 AND dl.event_type = 'derived' AND dl.source_entity_type = 'dataset' AND dl.farm_id = $2
        UNION ALL
        SELECT dl2.source_entity_id, dl2.description, dl2.created_at, t.depth + 1
        FROM dataset_lineage dl2
        JOIN tree t ON dl2.dataset_id = t.dataset_id
        WHERE dl2.event_type = 'derived' AND dl2.source_entity_type = 'dataset' AND dl2.farm_id = $2
          AND t.depth < 10
      )
      SELECT DISTINCT t.*, rd.name as dataset_name FROM tree t
      LEFT JOIN research_datasets rd ON rd.id = t.dataset_id
      ORDER BY t.depth ASC
    `, [req.params.dataset_id, farmId]);

    // Walk full derivation tree downward
    const descendants = await query(`
      WITH RECURSIVE tree AS (
        SELECT dl.dataset_id, dl.description, dl.created_at, 1 as depth
        FROM dataset_lineage dl
        WHERE dl.source_entity_id = $1 AND dl.event_type = 'derived' AND dl.source_entity_type = 'dataset' AND dl.farm_id = $2
        UNION ALL
        SELECT dl2.dataset_id, dl2.description, dl2.created_at, t.depth + 1
        FROM dataset_lineage dl2
        JOIN tree t ON dl2.source_entity_id = t.dataset_id
        WHERE dl2.event_type = 'derived' AND dl2.source_entity_type = 'dataset' AND dl2.farm_id = $2
          AND t.depth < 10
      )
      SELECT DISTINCT t.*, rd.name as dataset_name FROM tree t
      LEFT JOIN research_datasets rd ON rd.id = t.dataset_id
      ORDER BY t.depth ASC
    `, [req.params.dataset_id, farmId]);

    res.json({ ok: true, dataset_id: req.params.dataset_id, ancestors: ancestors.rows, descendants: descendants.rows });
  } catch (err) {
    console.error('[ResearchLineage] Derivation tree error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load derivation tree' });
  }
});

// ── Annotations ──

router.get('/research/annotations', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { dataset_id, annotation_type } = req.query;
    const params = [farmId];
    let where = 'WHERE da.farm_id = $1';

    if (dataset_id) { params.push(dataset_id); where += ` AND da.dataset_id = $${params.length}`; }
    if (annotation_type) { params.push(annotation_type); where += ` AND da.annotation_type = $${params.length}`; }

    const result = await query(`
      SELECT da.*, rd.name as dataset_name
      FROM data_annotations da
      LEFT JOIN research_datasets rd ON rd.id = da.dataset_id
      ${where} ORDER BY da.created_at DESC
    `, params);

    res.json({ ok: true, annotations: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchLineage] Annotations list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list annotations' });
  }
});

router.post('/research/annotations', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { dataset_id, annotation_type, content, author, target_field, target_row_id } = req.body;
    if (!dataset_id || !annotation_type || !content) {
      return res.status(400).json({ ok: false, error: 'dataset_id, annotation_type, and content required' });
    }

    const validTypes = ['quality_flag', 'correction', 'note', 'classification', 'sensitivity',
                        'retention', 'access_control', 'provenance_note', 'review', 'approval'];
    if (!validTypes.includes(annotation_type)) {
      return res.status(400).json({ ok: false, error: `annotation_type must be one of: ${validTypes.join(', ')}` });
    }

    const result = await query(`
      INSERT INTO data_annotations (farm_id, dataset_id, annotation_type, content, author,
        target_field, target_row_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *
    `, [farmId, dataset_id, annotation_type, content, author || null,
        target_field || null, target_row_id || null]);

    res.status(201).json({ ok: true, annotation: result.rows[0] });
  } catch (err) {
    console.error('[ResearchLineage] Annotation create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create annotation' });
  }
});

router.patch('/research/annotations/:id', async (req, res) => {
  try {
    const fields = ['content', 'annotation_type', 'target_field', 'target_row_id'];
    const sets = [];
    const params = [req.params.id];

    for (const f of fields) {
      if (req.body[f] !== undefined) {
        params.push(req.body[f]);
        sets.push(`${f} = $${params.length}`);
      }
    }

    if (!sets.length) return res.status(400).json({ ok: false, error: 'No fields to update' });
    sets.push('updated_at = NOW()');

    const result = await query(
      `UPDATE data_annotations SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params
    );

    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Annotation not found' });
    res.json({ ok: true, annotation: result.rows[0] });
  } catch (err) {
    console.error('[ResearchLineage] Annotation update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update annotation' });
  }
});

router.delete('/research/annotations/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM data_annotations WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Annotation not found' });
    res.json({ ok: true, deleted: true });
  } catch (err) {
    console.error('[ResearchLineage] Annotation delete error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to delete annotation' });
  }
});

// ── Governance Dashboard ──

router.get('/research/lineage/governance', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const [datasets, annotations, lineageEvents, classifications, retentions] = await Promise.all([
      query(`SELECT COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) as archived
        FROM research_datasets WHERE farm_id = $1`, [farmId]),

      query(`SELECT annotation_type, COUNT(*) as count
        FROM data_annotations WHERE farm_id = $1
        GROUP BY annotation_type ORDER BY count DESC`, [farmId]),

      query(`SELECT event_type, COUNT(*) as count
        FROM dataset_lineage WHERE farm_id = $1
        GROUP BY event_type ORDER BY count DESC`, [farmId]),

      query(`SELECT da.content as classification, COUNT(DISTINCT da.dataset_id) as dataset_count
        FROM data_annotations da WHERE da.farm_id = $1 AND da.annotation_type = 'classification'
        GROUP BY da.content ORDER BY dataset_count DESC`, [farmId]),

      query(`SELECT da.content as retention_policy, COUNT(DISTINCT da.dataset_id) as dataset_count
        FROM data_annotations da WHERE da.farm_id = $1 AND da.annotation_type = 'retention'
        GROUP BY da.content ORDER BY dataset_count DESC`, [farmId])
    ]);

    // Datasets without lineage events
    const untracked = await query(`
      SELECT rd.id, rd.name FROM research_datasets rd
      LEFT JOIN dataset_lineage dl ON dl.dataset_id = rd.id
      WHERE rd.farm_id = $1 AND dl.id IS NULL
    `, [farmId]);

    // Datasets without classification annotations
    const unclassified = await query(`
      SELECT rd.id, rd.name FROM research_datasets rd
      LEFT JOIN data_annotations da ON da.dataset_id = rd.id AND da.annotation_type = 'classification'
      WHERE rd.farm_id = $1 AND da.id IS NULL AND rd.status = 'active'
    `, [farmId]);

    res.json({
      ok: true,
      governance: {
        dataset_summary: datasets.rows[0],
        annotation_types: annotations.rows,
        lineage_event_types: lineageEvents.rows,
        classifications: classifications.rows,
        retention_policies: retentions.rows,
        untracked_datasets: untracked.rows,
        untracked_count: untracked.rows.length,
        unclassified_datasets: unclassified.rows,
        unclassified_count: unclassified.rows.length
      }
    });
  } catch (err) {
    console.error('[ResearchLineage] Governance error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load governance dashboard' });
  }
});

// ── Impact Analysis ──

router.get('/research/lineage/impact/:dataset_id', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    // Downstream datasets (descendants via derivation)
    const descendants = await query(`
      WITH RECURSIVE tree AS (
        SELECT dl.dataset_id, 1 as depth
        FROM dataset_lineage dl
        WHERE dl.source_entity_id = $1 AND dl.event_type = 'derived' AND dl.source_entity_type = 'dataset' AND dl.farm_id = $2
        UNION ALL
        SELECT dl2.dataset_id, t.depth + 1
        FROM dataset_lineage dl2
        JOIN tree t ON dl2.source_entity_id = t.dataset_id
        WHERE dl2.event_type = 'derived' AND dl2.source_entity_type = 'dataset' AND dl2.farm_id = $2
          AND t.depth < 10
      )
      SELECT DISTINCT t.dataset_id, t.depth, rd.name as dataset_name
      FROM tree t LEFT JOIN research_datasets rd ON rd.id = t.dataset_id
      ORDER BY t.depth ASC
    `, [req.params.dataset_id, farmId]);

    // Publications linked to this dataset
    const publications = await query(`
      SELECT p.id, p.title, p.status, pd.role
      FROM publication_datasets pd
      JOIN publications p ON p.id = pd.publication_id
      WHERE pd.dataset_id = $1
    `, [req.params.dataset_id]);

    // Exports involving this dataset
    const exports = await query(`
      SELECT dl.id, dl.description, dl.actor, dl.created_at
      FROM dataset_lineage dl
      WHERE dl.dataset_id = $1 AND dl.event_type IN ('exported', 'published', 'shared') AND dl.farm_id = $2
      ORDER BY dl.created_at DESC
    `, [req.params.dataset_id, farmId]);

    res.json({
      ok: true,
      dataset_id: req.params.dataset_id,
      impact: {
        downstream_datasets: descendants.rows,
        downstream_count: descendants.rows.length,
        publications: publications.rows,
        publication_count: publications.rows.length,
        exports: exports.rows,
        export_count: exports.rows.length
      }
    });
  } catch (err) {
    console.error('[ResearchLineage] Impact error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to analyze impact' });
  }
});

// ── Export Lineage as JSON-LD (W3C PROV compatible) ──

router.get('/research/lineage/export/:dataset_id', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const [dataset, events, annotations] = await Promise.all([
      query('SELECT * FROM research_datasets WHERE id = $1 AND farm_id = $2', [req.params.dataset_id, farmId]),
      query('SELECT * FROM dataset_lineage WHERE dataset_id = $1 AND farm_id = $2 ORDER BY created_at ASC', [req.params.dataset_id, farmId]),
      query('SELECT * FROM data_annotations WHERE dataset_id = $1 AND farm_id = $2 ORDER BY created_at ASC', [req.params.dataset_id, farmId])
    ]);

    if (!dataset.rows.length) return res.status(404).json({ ok: false, error: 'Dataset not found' });

    const ds = dataset.rows[0];
    const provDoc = {
      '@context': {
        'prov': 'http://www.w3.org/ns/prov#',
        'gr': 'https://greenreachgreens.com/ns/research#'
      },
      '@type': 'prov:Bundle',
      'gr:dataset': {
        '@id': `gr:dataset/${ds.id}`,
        '@type': 'prov:Entity',
        'gr:name': ds.name,
        'gr:status': ds.status,
        'prov:generatedAtTime': ds.created_at
      },
      'prov:activity': events.rows.map(e => ({
        '@id': `gr:lineage/${e.id}`,
        '@type': 'prov:Activity',
        'prov:type': e.event_type,
        'prov:startedAtTime': e.created_at,
        'gr:actor': e.actor,
        'gr:description': e.description,
        'prov:used': e.source_entity_id ? `gr:${e.source_entity_type}/${e.source_entity_id}` : undefined
      })),
      'gr:annotations': annotations.rows.map(a => ({
        '@id': `gr:annotation/${a.id}`,
        'gr:type': a.annotation_type,
        'gr:content': a.content,
        'gr:author': a.author,
        'prov:generatedAtTime': a.created_at
      }))
    };

    const format = req.query.format || 'json';
    if (format === 'json') {
      res.json({ ok: true, provenance: provDoc });
    } else {
      res.setHeader('Content-Type', 'application/ld+json');
      res.setHeader('Content-Disposition', `attachment; filename="lineage-${req.params.dataset_id}.jsonld"`);
      res.send(JSON.stringify(provDoc, null, 2));
    }
  } catch (err) {
    console.error('[ResearchLineage] Export error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to export lineage' });
  }
});

export default router;
