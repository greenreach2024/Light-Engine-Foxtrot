/**
 * Research Partners Routes
 * Research Platform Phase 2 -- Partner institutions, data sharing agreements
 *
 * Endpoints:
 *   GET/POST   /research/partners                       -- List/create partner institutions
 *   GET/PATCH  /research/partners/:id                   -- Get/update partner
 *   GET/POST   /research/partners/:id/agreements        -- Data sharing agreements
 *   PATCH      /research/partner-agreements/:id          -- Update agreement
 *   PATCH      /research/partner-agreements/:id/status   -- Agreement workflow
 *   GET/POST   /research/partners/:id/contacts          -- Partner contacts
 *   PATCH      /research/partner-contacts/:id            -- Update contact
 *   GET        /research/partners/dashboard              -- Partner network summary
 */
import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = Router();

const checkDb = (req, res, next) => {
  if (!isDatabaseAvailable()) return res.status(503).json({ ok: false, error: 'Database unavailable' });
  next();
};

router.use(checkDb);

// ── Partner Institutions ──

router.get('/research/partners', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { partner_type, status } = req.query;
    const params = [farmId];
    let where = 'WHERE p.farm_id = $1';
    if (partner_type) { params.push(partner_type); where += ` AND p.partner_type = $${params.length}`; }
    if (status) { params.push(status); where += ` AND p.status = $${params.length}`; }

    const result = await query(`
      SELECT p.*,
        (SELECT COUNT(*) FROM data_sharing_agreements dsa WHERE dsa.partner_id = p.id) as agreement_count,
        (SELECT COUNT(*) FROM partner_contacts pc WHERE pc.partner_id = p.id) as contact_count
      FROM partner_institutions p ${where} ORDER BY p.name ASC
    `, params);

    res.json({ ok: true, partners: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchPartners] List error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list partners' });
  }
});

router.post('/research/partners', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { name, partner_type, country, province_state, address, website, notes } = req.body;
    if (!name || !partner_type) return res.status(400).json({ ok: false, error: 'name and partner_type required' });

    const validTypes = ['university', 'college', 'research_institute', 'government',
                        'industry', 'hospital', 'ngo', 'international'];
    if (!validTypes.includes(partner_type)) {
      return res.status(400).json({ ok: false, error: `partner_type must be one of: ${validTypes.join(', ')}` });
    }

    const result = await query(`
      INSERT INTO partner_institutions (farm_id, name, partner_type, country, province_state,
        address, website, notes, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
      RETURNING *
    `, [farmId, name, partner_type, country || 'Canada', province_state || null,
        address || null, website || null, notes || null]);

    res.status(201).json({ ok: true, partner: result.rows[0] });
  } catch (err) {
    console.error('[ResearchPartners] Create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create partner' });
  }
});

router.get('/research/partners/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM partner_institutions WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Partner not found' });
    res.json({ ok: true, partner: result.rows[0] });
  } catch (err) {
    console.error('[ResearchPartners] Get error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get partner' });
  }
});

router.patch('/research/partners/:id', async (req, res) => {
  try {
    const { name, partner_type, country, province_state, address, website, notes, status } = req.body;
    const fields = [];
    const params = [];
    let idx = 1;
    if (name !== undefined) { fields.push(`name = $${idx}`); params.push(name); idx++; }
    if (partner_type !== undefined) { fields.push(`partner_type = $${idx}`); params.push(partner_type); idx++; }
    if (country !== undefined) { fields.push(`country = $${idx}`); params.push(country); idx++; }
    if (province_state !== undefined) { fields.push(`province_state = $${idx}`); params.push(province_state); idx++; }
    if (address !== undefined) { fields.push(`address = $${idx}`); params.push(address); idx++; }
    if (website !== undefined) { fields.push(`website = $${idx}`); params.push(website); idx++; }
    if (notes !== undefined) { fields.push(`notes = $${idx}`); params.push(notes); idx++; }
    if (status !== undefined) { fields.push(`status = $${idx}`); params.push(status); idx++; }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No fields to update' });

    fields.push('updated_at = NOW()');
    params.push(req.params.id);
    const result = await query(`UPDATE partner_institutions SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Partner not found' });
    res.json({ ok: true, partner: result.rows[0] });
  } catch (err) {
    console.error('[ResearchPartners] Update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update partner' });
  }
});

// ── Data Sharing Agreements ──

router.get('/research/partners/:id/agreements', async (req, res) => {
  try {
    const result = await query('SELECT * FROM data_sharing_agreements WHERE partner_id = $1 ORDER BY created_at DESC', [req.params.id]);
    res.json({ ok: true, agreements: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchPartners] Agreements list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list agreements' });
  }
});

router.post('/research/partners/:id/agreements', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { agreement_type, title, description, data_types, access_level,
            start_date, end_date, terms } = req.body;
    if (!agreement_type || !title) return res.status(400).json({ ok: false, error: 'agreement_type and title required' });

    const validTypes = ['data_sharing', 'material_transfer', 'collaboration',
                        'non_disclosure', 'intellectual_property', 'service'];
    if (!validTypes.includes(agreement_type)) {
      return res.status(400).json({ ok: false, error: `agreement_type must be one of: ${validTypes.join(', ')}` });
    }

    const result = await query(`
      INSERT INTO data_sharing_agreements (partner_id, farm_id, agreement_type, title,
        description, data_types, access_level, start_date, end_date, terms, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft')
      RETURNING *
    `, [req.params.id, farmId, agreement_type, title, description || null,
        JSON.stringify(data_types || []), access_level || 'read_only',
        start_date || null, end_date || null, JSON.stringify(terms || {})]);

    res.status(201).json({ ok: true, agreement: result.rows[0] });
  } catch (err) {
    console.error('[ResearchPartners] Agreement create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create agreement' });
  }
});

router.patch('/research/partner-agreements/:id', async (req, res) => {
  try {
    const { title, description, data_types, access_level, start_date, end_date, terms } = req.body;
    const fields = [];
    const params = [];
    let idx = 1;
    if (title !== undefined) { fields.push(`title = $${idx}`); params.push(title); idx++; }
    if (description !== undefined) { fields.push(`description = $${idx}`); params.push(description); idx++; }
    if (data_types !== undefined) { fields.push(`data_types = $${idx}`); params.push(JSON.stringify(data_types)); idx++; }
    if (access_level !== undefined) { fields.push(`access_level = $${idx}`); params.push(access_level); idx++; }
    if (start_date !== undefined) { fields.push(`start_date = $${idx}`); params.push(start_date); idx++; }
    if (end_date !== undefined) { fields.push(`end_date = $${idx}`); params.push(end_date); idx++; }
    if (terms !== undefined) { fields.push(`terms = $${idx}`); params.push(JSON.stringify(terms)); idx++; }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No fields to update' });

    fields.push('updated_at = NOW()');
    params.push(req.params.id);
    const result = await query(`UPDATE data_sharing_agreements SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Agreement not found' });
    res.json({ ok: true, agreement: result.rows[0] });
  } catch (err) {
    console.error('[ResearchPartners] Agreement update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update agreement' });
  }
});

router.patch('/research/partner-agreements/:id/status', async (req, res) => {
  try {
    const { status, signed_date, signed_by } = req.body;
    if (!status) return res.status(400).json({ ok: false, error: 'status required' });

    const validTransitions = {
      draft: ['submitted', 'cancelled'],
      submitted: ['under_review', 'withdrawn'],
      under_review: ['approved', 'revisions_required', 'rejected'],
      revisions_required: ['submitted'],
      approved: ['active', 'cancelled'],
      active: ['expired', 'terminated', 'renewed'],
      renewed: ['active'],
      expired: ['renewed']
    };

    const current = await query('SELECT status FROM data_sharing_agreements WHERE id = $1', [req.params.id]);
    if (!current.rows.length) return res.status(404).json({ ok: false, error: 'Agreement not found' });

    const allowed = validTransitions[current.rows[0].status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({ ok: false, error: `Cannot transition from ${current.rows[0].status} to ${status}` });
    }

    const fields = ['status = $1', 'updated_at = NOW()'];
    const params = [status];
    let idx = 2;
    if (signed_date) { fields.push(`signed_date = $${idx}`); params.push(signed_date); idx++; }
    if (signed_by) { fields.push(`signed_by = $${idx}`); params.push(signed_by); idx++; }

    params.push(req.params.id);
    const result = await query(`UPDATE data_sharing_agreements SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    res.json({ ok: true, agreement: result.rows[0] });
  } catch (err) {
    console.error('[ResearchPartners] Agreement status error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update agreement status' });
  }
});

// ── Partner Contacts ──

router.get('/research/partners/:id/contacts', async (req, res) => {
  try {
    const result = await query('SELECT * FROM partner_contacts WHERE partner_id = $1 ORDER BY name ASC', [req.params.id]);
    res.json({ ok: true, contacts: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchPartners] Contacts list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list contacts' });
  }
});

router.post('/research/partners/:id/contacts', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { name, email, role, department, phone } = req.body;
    if (!name || !email) return res.status(400).json({ ok: false, error: 'name and email required' });

    const result = await query(`
      INSERT INTO partner_contacts (partner_id, farm_id, name, email, role, department, phone)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [req.params.id, farmId, name, email, role || null, department || null, phone || null]);

    res.status(201).json({ ok: true, contact: result.rows[0] });
  } catch (err) {
    console.error('[ResearchPartners] Contact create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create contact' });
  }
});

router.patch('/research/partner-contacts/:id', async (req, res) => {
  try {
    const { name, email, role, department, phone } = req.body;
    const fields = [];
    const params = [];
    let idx = 1;
    if (name !== undefined) { fields.push(`name = $${idx}`); params.push(name); idx++; }
    if (email !== undefined) { fields.push(`email = $${idx}`); params.push(email); idx++; }
    if (role !== undefined) { fields.push(`role = $${idx}`); params.push(role); idx++; }
    if (department !== undefined) { fields.push(`department = $${idx}`); params.push(department); idx++; }
    if (phone !== undefined) { fields.push(`phone = $${idx}`); params.push(phone); idx++; }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No fields to update' });

    fields.push('updated_at = NOW()');
    params.push(req.params.id);
    const result = await query(`UPDATE partner_contacts SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Contact not found' });
    res.json({ ok: true, contact: result.rows[0] });
  } catch (err) {
    console.error('[ResearchPartners] Contact update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update contact' });
  }
});

// ── Partner Network Dashboard ──

router.get('/research/partners/dashboard', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const [byType, byCountry, agreementStats, recentAgreements] = await Promise.all([
      query(`SELECT partner_type, status, COUNT(*) as count FROM partner_institutions WHERE farm_id = $1 GROUP BY partner_type, status ORDER BY count DESC`, [farmId]),
      query(`SELECT country, COUNT(*) as count FROM partner_institutions WHERE farm_id = $1 GROUP BY country ORDER BY count DESC`, [farmId]),
      query(`SELECT dsa.status, COUNT(*) as count FROM data_sharing_agreements dsa JOIN partner_institutions p ON dsa.partner_id = p.id WHERE p.farm_id = $1 GROUP BY dsa.status ORDER BY count DESC`, [farmId]),
      query(`SELECT dsa.title, dsa.agreement_type, dsa.status, dsa.end_date, p.name as partner_name FROM data_sharing_agreements dsa JOIN partner_institutions p ON dsa.partner_id = p.id WHERE p.farm_id = $1 ORDER BY dsa.updated_at DESC LIMIT 10`, [farmId])
    ]);

    // Agreements expiring within 90 days
    const expiring = await query(`
      SELECT dsa.title, dsa.end_date, p.name as partner_name
      FROM data_sharing_agreements dsa
      JOIN partner_institutions p ON dsa.partner_id = p.id
      WHERE p.farm_id = $1 AND dsa.status = 'active' AND dsa.end_date <= NOW() + INTERVAL '90 days'
      ORDER BY dsa.end_date ASC
    `, [farmId]);

    res.json({
      ok: true,
      by_type: byType.rows,
      by_country: byCountry.rows,
      agreement_stats: agreementStats.rows,
      recent_agreements: recentAgreements.rows,
      expiring_agreements: expiring.rows
    });
  } catch (err) {
    console.error('[ResearchPartners] Dashboard error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get partner dashboard' });
  }
});

export default router;
