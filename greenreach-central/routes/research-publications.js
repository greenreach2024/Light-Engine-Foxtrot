/**
 * Research Publications Routes
 * Research Platform Phase 3 -- Publication lifecycle, grant attribution, dataset linking, metadata export
 *
 * Endpoints:
 *   GET/POST   /research/publications                     -- List/create publications (cross-grant)
 *   GET/PATCH  /research/publications/:id                 -- Get/update publication
 *   PATCH      /research/publications/:id/status          -- Advance publication status
 *   GET/POST   /research/publications/:id/datasets        -- Link datasets to publication
 *   DELETE     /research/publications/:id/datasets/:did   -- Unlink dataset from publication
 *   GET/POST   /research/publications/:id/authors         -- Author list with ordering
 *   PATCH      /research/publication-authors/:id          -- Update author position/role
 *   GET        /research/publications/:id/export          -- Export metadata (BibTeX, RIS, JSON)
 *   GET        /research/publications/pipeline            -- Publication pipeline status counts
 *   GET        /research/publications/grant-compliance    -- Validate grant attribution requirements
 *
 * New tables: publication_datasets (link table), publication_authors
 */
import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = Router();

async function safeQueryRows(sql, params, label) {
  try {
    return await query(sql, params);
  } catch (err) {
    console.warn(`[ResearchPublications] ${label} unavailable:`, err.message);
    return { rows: [] };
  }
}

const checkDb = (req, res, next) => {
  if (!isDatabaseAvailable()) return res.status(503).json({ ok: false, error: 'Database unavailable' });
  next();
};

router.use(checkDb);

// ── List/Create Publications (cross-grant) ──

router.get('/research/publications', async (req, res) => {
  try {
    const farmId = req.farmId || req.user?.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { status, grant_id } = req.query;
    const params = [farmId];
    let where = 'WHERE p.farm_id = $1';
    if (status) { params.push(status); where += ` AND p.status = $${params.length}`; }
    if (grant_id) { params.push(grant_id); where += ` AND p.grant_id = $${params.length}`; }

    const result = await safeQueryRows(`
      SELECT p.*, ga.title as grant_title,
        (SELECT COUNT(*) FROM publication_datasets pd WHERE pd.publication_id = p.id) as linked_datasets,
        (SELECT COUNT(*) FROM publication_authors pa WHERE pa.publication_id = p.id) as author_count
      FROM publications p
      LEFT JOIN grant_applications ga ON p.grant_id = ga.id
      ${where} ORDER BY p.created_at DESC
    `, params, 'publication list');

    res.json({ ok: true, publications: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchPublications] List error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list publications' });
  }
});

router.post('/research/publications', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { title, grant_id, journal, publication_type, doi, abstract,
            submission_date, code_url, data_url } = req.body;
    if (!title) return res.status(400).json({ ok: false, error: 'title required' });

    const validTypes = ['journal_article', 'conference_paper', 'book_chapter', 'thesis', 'technical_report', 'preprint', 'poster', 'presentation'];
    if (publication_type && !validTypes.includes(publication_type)) {
      return res.status(400).json({ ok: false, error: `publication_type must be one of: ${validTypes.join(', ')}` });
    }

    const result = await query(`
      INSERT INTO publications (farm_id, grant_id, title, journal, publication_type, doi, abstract,
        submission_date, code_url, data_url, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', NOW(), NOW())
      RETURNING *
    `, [farmId, grant_id || null, title, journal || null, publication_type || 'journal_article',
        doi || null, abstract || null, submission_date || null, code_url || null, data_url || null]);

    res.status(201).json({ ok: true, publication: result.rows[0] });
  } catch (err) {
    console.error('[ResearchPublications] Create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create publication' });
  }
});

// ── Get/Update Single Publication ──

router.get('/research/publications/:id', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const result = await query(`
      SELECT p.*, ga.title as grant_title
      FROM publications p LEFT JOIN grant_applications ga ON p.grant_id = ga.id
      WHERE p.id = $1 AND p.farm_id = $2
    `, [req.params.id, farmId]);

    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Publication not found' });

    const [datasets, authors] = await Promise.all([
      query(`SELECT pd.id as link_id, rd.id as dataset_id, rd.dataset_name, rd.status
        FROM publication_datasets pd JOIN research_datasets rd ON pd.dataset_id = rd.id
        WHERE pd.publication_id = $1`, [req.params.id]),
      query(`SELECT * FROM publication_authors WHERE publication_id = $1 ORDER BY author_position ASC`, [req.params.id])
    ]);

    res.json({
      ok: true,
      publication: result.rows[0],
      datasets: datasets.rows,
      authors: authors.rows
    });
  } catch (err) {
    console.error('[ResearchPublications] Get error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get publication' });
  }
});

router.patch('/research/publications/:id', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const fields = ['title', 'journal', 'publication_type', 'doi', 'abstract',
                    'submission_date', 'published_date', 'code_url', 'data_url', 'grant_id'];
    const sets = [];
    const params = [req.params.id, farmId];

    for (const f of fields) {
      if (req.body[f] !== undefined) {
        params.push(req.body[f]);
        sets.push(`${f} = $${params.length}`);
      }
    }

    if (!sets.length) return res.status(400).json({ ok: false, error: 'No fields to update' });
    sets.push('updated_at = NOW()');

    const result = await query(
      `UPDATE publications SET ${sets.join(', ')} WHERE id = $1 AND farm_id = $2 RETURNING *`, params
    );

    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Publication not found' });
    res.json({ ok: true, publication: result.rows[0] });
  } catch (err) {
    console.error('[ResearchPublications] Update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update publication' });
  }
});

// ── Status Advancement ──

router.patch('/research/publications/:id/status', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { status } = req.body;
    const validStatuses = ['draft', 'in_preparation', 'submitted', 'in_review', 'revision_requested',
                           'revised', 'accepted', 'published', 'rejected', 'withdrawn'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ ok: false, error: `status must be one of: ${validStatuses.join(', ')}` });
    }

    const result = await query(
      `UPDATE publications SET status = $3, updated_at = NOW() WHERE id = $1 AND farm_id = $2 RETURNING *`,
      [req.params.id, farmId, status]
    );

    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Publication not found' });
    res.json({ ok: true, publication: result.rows[0] });
  } catch (err) {
    console.error('[ResearchPublications] Status update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update publication status' });
  }
});

// ── Dataset Linking ──

router.get('/research/publications/:id/datasets', async (req, res) => {
  try {
    const result = await query(`
      SELECT pd.id as link_id, pd.role, rd.id as dataset_id, rd.dataset_name, rd.status,
        s.title as study_title
      FROM publication_datasets pd
      JOIN research_datasets rd ON pd.dataset_id = rd.id
      JOIN studies s ON rd.study_id = s.id
      WHERE pd.publication_id = $1
    `, [req.params.id]);

    res.json({ ok: true, datasets: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchPublications] List datasets error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list linked datasets' });
  }
});

router.post('/research/publications/:id/datasets', async (req, res) => {
  try {
    const { dataset_id, role } = req.body;
    if (!dataset_id) return res.status(400).json({ ok: false, error: 'dataset_id required' });

    const validRoles = ['primary', 'supporting', 'supplementary', 'validation'];
    const datasetRole = (role && validRoles.includes(role)) ? role : 'primary';

    const result = await query(`
      INSERT INTO publication_datasets (publication_id, dataset_id, role, created_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (publication_id, dataset_id) DO UPDATE SET role = $3
      RETURNING *
    `, [req.params.id, dataset_id, datasetRole]);

    res.status(201).json({ ok: true, link: result.rows[0] });
  } catch (err) {
    console.error('[ResearchPublications] Link dataset error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to link dataset' });
  }
});

router.delete('/research/publications/:id/datasets/:did', async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM publication_datasets WHERE publication_id = $1 AND dataset_id = $2 RETURNING id',
      [req.params.id, req.params.did]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Link not found' });
    res.json({ ok: true, deleted: true });
  } catch (err) {
    console.error('[ResearchPublications] Unlink dataset error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to unlink dataset' });
  }
});

// ── Author Management ──

router.get('/research/publications/:id/authors', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM publication_authors WHERE publication_id = $1 ORDER BY author_position ASC',
      [req.params.id]
    );
    res.json({ ok: true, authors: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchPublications] List authors error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list authors' });
  }
});

router.post('/research/publications/:id/authors', async (req, res) => {
  try {
    const { name, email, institution, orcid, author_position, role } = req.body;
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });

    const validRoles = ['first_author', 'co_author', 'corresponding', 'senior_author'];
    const authorRole = (role && validRoles.includes(role)) ? role : 'co_author';

    // Auto-increment position if not specified
    let position = author_position;
    if (position === undefined || position === null) {
      const maxPos = await query(
        'SELECT COALESCE(MAX(author_position), 0) + 1 as next_pos FROM publication_authors WHERE publication_id = $1',
        [req.params.id]
      );
      position = maxPos.rows[0].next_pos;
    }

    const result = await query(`
      INSERT INTO publication_authors (publication_id, name, email, institution, orcid, author_position, role, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING *
    `, [req.params.id, name, email || null, institution || null, orcid || null, position, authorRole]);

    res.status(201).json({ ok: true, author: result.rows[0] });
  } catch (err) {
    console.error('[ResearchPublications] Add author error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to add author' });
  }
});

router.patch('/research/publication-authors/:id', async (req, res) => {
  try {
    const fields = ['name', 'email', 'institution', 'orcid', 'author_position', 'role'];
    const sets = [];
    const params = [req.params.id];

    for (const f of fields) {
      if (req.body[f] !== undefined) {
        params.push(req.body[f]);
        sets.push(`${f} = $${params.length}`);
      }
    }

    if (!sets.length) return res.status(400).json({ ok: false, error: 'No fields to update' });

    const result = await query(
      `UPDATE publication_authors SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params
    );

    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Author not found' });
    res.json({ ok: true, author: result.rows[0] });
  } catch (err) {
    console.error('[ResearchPublications] Update author error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update author' });
  }
});

// ── Metadata Export ──

router.get('/research/publications/:id/export', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const format = req.query.format || 'json';
    const validFormats = ['json', 'bibtex', 'ris'];
    if (!validFormats.includes(format)) {
      return res.status(400).json({ ok: false, error: `format must be one of: ${validFormats.join(', ')}` });
    }

    const pub = await query('SELECT * FROM publications WHERE id = $1 AND farm_id = $2', [req.params.id, farmId]);
    if (!pub.rows.length) return res.status(404).json({ ok: false, error: 'Publication not found' });

    const authors = await query(
      'SELECT name, institution, orcid FROM publication_authors WHERE publication_id = $1 ORDER BY author_position ASC',
      [req.params.id]
    );

    const p = pub.rows[0];
    const authorNames = authors.rows.map(a => a.name);

    if (format === 'bibtex') {
      const key = `pub${p.id}_${(p.published_date || p.created_at).substring(0, 4)}`;
      const bibtex = `@article{${key},
  title = {${p.title}},
  author = {${authorNames.join(' and ')}},
  journal = {${p.journal || 'Unpublished'}},
  year = {${(p.published_date || p.created_at).substring(0, 4)}},
  doi = {${p.doi || ''}},
  abstract = {${(p.abstract || '').replace(/[{}]/g, '')}}
}`;
      res.set('Content-Type', 'text/plain');
      return res.send(bibtex);
    }

    if (format === 'ris') {
      const year = (p.published_date || p.created_at).substring(0, 4);
      let ris = `TY  - JOUR\nTI  - ${p.title}\n`;
      for (const a of authorNames) { ris += `AU  - ${a}\n`; }
      ris += `JO  - ${p.journal || ''}\nPY  - ${year}\nDO  - ${p.doi || ''}\nAB  - ${p.abstract || ''}\nER  -\n`;
      res.set('Content-Type', 'text/plain');
      return res.send(ris);
    }

    res.json({
      ok: true,
      metadata: {
        ...p,
        authors: authors.rows,
        export_format: format,
        exported_at: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('[ResearchPublications] Export error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to export publication' });
  }
});

// ── Publication Pipeline ──

router.get('/research/publications/pipeline', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const result = await query(`
      SELECT status, publication_type, COUNT(*) as count
      FROM publications WHERE farm_id = $1
      GROUP BY status, publication_type ORDER BY count DESC
    `, [farmId]);

    const totals = await query(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published,
        SUM(CASE WHEN status IN ('submitted', 'in_review', 'revised') THEN 1 ELSE 0 END) as in_pipeline,
        SUM(CASE WHEN status IN ('draft', 'in_preparation') THEN 1 ELSE 0 END) as in_progress
      FROM publications WHERE farm_id = $1
    `, [farmId]);

    res.json({ ok: true, pipeline: result.rows, totals: totals.rows[0] });
  } catch (err) {
    console.error('[ResearchPublications] Pipeline error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load publication pipeline' });
  }
});

// ── Grant Compliance Check ──

router.get('/research/publications/grant-compliance', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    // Find grants with no publications
    const grantsNoPubs = await query(`
      SELECT ga.id, ga.title, ga.funding_agency, ga.status
      FROM grant_applications ga
      WHERE ga.farm_id = $1 AND ga.status IN ('active', 'awarded')
        AND ga.id NOT IN (SELECT DISTINCT grant_id FROM publications WHERE grant_id IS NOT NULL)
    `, [farmId]);

    // Publications missing DOI
    const noDoi = await query(`
      SELECT id, title, status FROM publications
      WHERE farm_id = $1 AND status = 'published' AND (doi IS NULL OR doi = '')
    `, [farmId]);

    // Publications missing data/code links
    const noDataLinks = await query(`
      SELECT id, title, status FROM publications
      WHERE farm_id = $1 AND status = 'published'
        AND (data_url IS NULL OR data_url = '') AND (code_url IS NULL OR code_url = '')
    `, [farmId]);

    // Publications with no linked datasets
    const noDatasets = await query(`
      SELECT p.id, p.title, p.status FROM publications p
      WHERE p.farm_id = $1 AND p.status IN ('published', 'accepted')
        AND p.id NOT IN (SELECT DISTINCT publication_id FROM publication_datasets)
    `, [farmId]);

    res.json({
      ok: true,
      compliance: {
        grants_without_publications: { items: grantsNoPubs.rows, count: grantsNoPubs.rows.length },
        publications_without_doi: { items: noDoi.rows, count: noDoi.rows.length },
        publications_without_data_links: { items: noDataLinks.rows, count: noDataLinks.rows.length },
        publications_without_datasets: { items: noDatasets.rows, count: noDatasets.rows.length }
      }
    });
  } catch (err) {
    console.error('[ResearchPublications] Compliance check error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to check grant compliance' });
  }
});

export default router;
