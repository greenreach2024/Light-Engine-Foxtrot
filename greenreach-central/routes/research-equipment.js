/**
 * Research Equipment Routes
 * Research Platform Phase 3 -- Lab equipment registry, booking, maintenance, utilization
 *
 * Endpoints:
 *   GET/POST   /research/equipment                        -- List/register lab equipment
 *   GET/PATCH  /research/equipment/:id                    -- Get/update equipment
 *   PATCH      /research/equipment/:id/status             -- Update equipment status
 *   GET/POST   /research/equipment/:id/bookings           -- List/create equipment bookings
 *   PATCH      /research/equipment-bookings/:id           -- Update booking
 *   DELETE     /research/equipment-bookings/:id           -- Cancel booking
 *   GET/POST   /research/equipment/:id/maintenance        -- Maintenance log entries
 *   GET        /research/equipment/utilization             -- Equipment utilization metrics
 *   GET        /research/equipment/availability            -- Availability calendar
 *   GET        /research/equipment/maintenance-due         -- Equipment with overdue maintenance
 *
 * New tables: lab_equipment, equipment_bookings, equipment_maintenance
 */
import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = Router();

const checkDb = (req, res, next) => {
  if (!isDatabaseAvailable()) return res.status(503).json({ ok: false, error: 'Database unavailable' });
  next();
};

router.use(checkDb);

// ── List/Register Equipment ──

router.get('/research/equipment', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { status, category } = req.query;
    const params = [farmId];
    let where = 'WHERE le.farm_id = $1';
    if (status) { params.push(status); where += ` AND le.status = $${params.length}`; }
    if (category) { params.push(category); where += ` AND le.category = $${params.length}`; }

    const result = await query(`
      SELECT le.*,
        (SELECT COUNT(*) FROM equipment_bookings eb WHERE eb.equipment_id = le.id AND eb.status = 'confirmed' AND eb.end_time > NOW()) as active_bookings,
        (SELECT MAX(em.performed_at) FROM equipment_maintenance em WHERE em.equipment_id = le.id) as last_maintenance
      FROM lab_equipment le ${where} ORDER BY le.name ASC
    `, params);

    res.json({ ok: true, equipment: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchEquipment] List error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list equipment' });
  }
});

router.post('/research/equipment', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { name, category, manufacturer, model, serial_number, location, purchase_date,
            maintenance_interval_days, calibration_interval_days, notes } = req.body;
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });

    const validCategories = ['sensor', 'analyzer', 'microscope', 'balance', 'incubator', 'centrifuge',
                             'spectrophotometer', 'ph_meter', 'growth_chamber', 'harvester', 'packaging',
                             'irrigation', 'lighting', 'climate_control', 'other'];
    if (category && !validCategories.includes(category)) {
      return res.status(400).json({ ok: false, error: `category must be one of: ${validCategories.join(', ')}` });
    }

    const result = await query(`
      INSERT INTO lab_equipment (farm_id, name, category, manufacturer, model, serial_number,
        location, purchase_date, maintenance_interval_days, calibration_interval_days, notes, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'available', NOW(), NOW())
      RETURNING *
    `, [farmId, name, category || 'other', manufacturer || null, model || null,
        serial_number || null, location || null, purchase_date || null,
        maintenance_interval_days || null, calibration_interval_days || null, notes || null]);

    res.status(201).json({ ok: true, equipment: result.rows[0] });
  } catch (err) {
    console.error('[ResearchEquipment] Create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to register equipment' });
  }
});

// ── Get/Update Equipment ──

router.get('/research/equipment/:id', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const result = await query('SELECT * FROM lab_equipment WHERE id = $1 AND farm_id = $2', [req.params.id, farmId]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Equipment not found' });

    const [bookings, maintenance] = await Promise.all([
      query('SELECT * FROM equipment_bookings WHERE equipment_id = $1 ORDER BY start_time DESC LIMIT 20', [req.params.id]),
      query('SELECT * FROM equipment_maintenance WHERE equipment_id = $1 ORDER BY performed_at DESC LIMIT 10', [req.params.id])
    ]);

    res.json({ ok: true, equipment: result.rows[0], bookings: bookings.rows, maintenance: maintenance.rows });
  } catch (err) {
    console.error('[ResearchEquipment] Get error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get equipment' });
  }
});

router.patch('/research/equipment/:id', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const fields = ['name', 'category', 'manufacturer', 'model', 'serial_number', 'location',
                    'purchase_date', 'maintenance_interval_days', 'calibration_interval_days', 'notes'];
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
      `UPDATE lab_equipment SET ${sets.join(', ')} WHERE id = $1 AND farm_id = $2 RETURNING *`, params
    );

    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Equipment not found' });
    res.json({ ok: true, equipment: result.rows[0] });
  } catch (err) {
    console.error('[ResearchEquipment] Update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update equipment' });
  }
});

// ── Status Update ──

router.patch('/research/equipment/:id/status', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { status } = req.body;
    const validStatuses = ['available', 'in_use', 'maintenance', 'calibration', 'out_of_service', 'retired'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ ok: false, error: `status must be one of: ${validStatuses.join(', ')}` });
    }

    const result = await query(
      `UPDATE lab_equipment SET status = $3, updated_at = NOW() WHERE id = $1 AND farm_id = $2 RETURNING *`,
      [req.params.id, farmId, status]
    );

    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Equipment not found' });
    res.json({ ok: true, equipment: result.rows[0] });
  } catch (err) {
    console.error('[ResearchEquipment] Status error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update equipment status' });
  }
});

// ── Bookings ──

router.get('/research/equipment/:id/bookings', async (req, res) => {
  try {
    const { status } = req.query;
    const params = [req.params.id];
    let where = 'WHERE eb.equipment_id = $1';
    if (status) { params.push(status); where += ` AND eb.status = $${params.length}`; }

    const result = await query(
      `SELECT eb.* FROM equipment_bookings eb ${where} ORDER BY eb.start_time ASC`, params
    );

    res.json({ ok: true, bookings: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchEquipment] List bookings error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list bookings' });
  }
});

router.post('/research/equipment/:id/bookings', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { study_id, booked_by, start_time, end_time, purpose } = req.body;
    if (!start_time || !end_time) return res.status(400).json({ ok: false, error: 'start_time and end_time required' });

    // Check for conflicts
    const conflicts = await query(`
      SELECT id FROM equipment_bookings
      WHERE equipment_id = $1 AND status = 'confirmed'
        AND start_time < $3 AND end_time > $2
    `, [req.params.id, start_time, end_time]);

    if (conflicts.rows.length) {
      return res.status(409).json({ ok: false, error: 'Time slot conflicts with existing booking' });
    }

    const result = await query(`
      INSERT INTO equipment_bookings (equipment_id, farm_id, study_id, booked_by, start_time, end_time,
        purpose, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', NOW())
      RETURNING *
    `, [req.params.id, farmId, study_id || null, booked_by || null, start_time, end_time, purpose || null]);

    res.status(201).json({ ok: true, booking: result.rows[0] });
  } catch (err) {
    console.error('[ResearchEquipment] Create booking error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create booking' });
  }
});

router.patch('/research/equipment-bookings/:id', async (req, res) => {
  try {
    const fields = ['start_time', 'end_time', 'purpose', 'status'];
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
      `UPDATE equipment_bookings SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params
    );

    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Booking not found' });
    res.json({ ok: true, booking: result.rows[0] });
  } catch (err) {
    console.error('[ResearchEquipment] Update booking error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update booking' });
  }
});

router.delete('/research/equipment-bookings/:id', async (req, res) => {
  try {
    const result = await query(
      `UPDATE equipment_bookings SET status = 'cancelled' WHERE id = $1 AND status = 'confirmed' RETURNING id`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Booking not found or already cancelled' });
    res.json({ ok: true, cancelled: true });
  } catch (err) {
    console.error('[ResearchEquipment] Cancel booking error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to cancel booking' });
  }
});

// ── Maintenance Log ──

router.get('/research/equipment/:id/maintenance', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM equipment_maintenance WHERE equipment_id = $1 ORDER BY performed_at DESC',
      [req.params.id]
    );
    res.json({ ok: true, maintenance: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchEquipment] Maintenance list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list maintenance records' });
  }
});

router.post('/research/equipment/:id/maintenance', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { maintenance_type, description, performed_by, performed_at, next_due, cost } = req.body;
    if (!maintenance_type) return res.status(400).json({ ok: false, error: 'maintenance_type required' });

    const validTypes = ['preventive', 'corrective', 'calibration', 'cleaning', 'inspection', 'repair', 'upgrade'];
    if (!validTypes.includes(maintenance_type)) {
      return res.status(400).json({ ok: false, error: `maintenance_type must be one of: ${validTypes.join(', ')}` });
    }

    const result = await query(`
      INSERT INTO equipment_maintenance (equipment_id, farm_id, maintenance_type, description,
        performed_by, performed_at, next_due, cost, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *
    `, [req.params.id, farmId, maintenance_type, description || null,
        performed_by || null, performed_at || new Date().toISOString(), next_due || null, cost || null]);

    res.status(201).json({ ok: true, maintenance: result.rows[0] });
  } catch (err) {
    console.error('[ResearchEquipment] Maintenance create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to log maintenance' });
  }
});

// ── Utilization Metrics ──

router.get('/research/equipment/utilization', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const days = Math.min(parseInt(req.query.days, 10) || 30, 365);

    const result = await query(`
      SELECT le.id, le.name, le.category, le.status,
        COUNT(eb.id) as total_bookings,
        COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(eb.end_time, NOW()) - GREATEST(eb.start_time, NOW() - make_interval(days => $2)))) / 3600), 0) as booked_hours
      FROM lab_equipment le
      LEFT JOIN equipment_bookings eb ON eb.equipment_id = le.id
        AND eb.status = 'confirmed'
        AND eb.start_time <= NOW()
        AND eb.end_time >= NOW() - make_interval(days => $2)
      WHERE le.farm_id = $1
      GROUP BY le.id ORDER BY booked_hours DESC
    `, [farmId, days]);

    const totalHoursPeriod = days * 24;
    const utilization = result.rows.map(r => ({
      ...r,
      booked_hours: parseFloat(parseFloat(r.booked_hours).toFixed(1)),
      utilization_pct: parseFloat(((parseFloat(r.booked_hours) / totalHoursPeriod) * 100).toFixed(1))
    }));

    res.json({ ok: true, utilization, period_days: days });
  } catch (err) {
    console.error('[ResearchEquipment] Utilization error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load utilization metrics' });
  }
});

// ── Availability ──

router.get('/research/equipment/availability', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const daysAhead = Math.min(parseInt(req.query.days_ahead, 10) || 7, 30);

    const result = await query(`
      SELECT le.id, le.name, le.category, le.status,
        COALESCE(json_agg(json_build_object(
          'booking_id', eb.id, 'start_time', eb.start_time, 'end_time', eb.end_time,
          'booked_by', eb.booked_by, 'purpose', eb.purpose
        ) ORDER BY eb.start_time) FILTER (WHERE eb.id IS NOT NULL), '[]') as bookings
      FROM lab_equipment le
      LEFT JOIN equipment_bookings eb ON eb.equipment_id = le.id
        AND eb.status = 'confirmed'
        AND eb.end_time > NOW()
        AND eb.start_time <= NOW() + make_interval(days => $2)
      WHERE le.farm_id = $1 AND le.status NOT IN ('retired', 'out_of_service')
      GROUP BY le.id ORDER BY le.name ASC
    `, [farmId, daysAhead]);

    res.json({ ok: true, equipment: result.rows, count: result.rows.length, days_ahead: daysAhead });
  } catch (err) {
    console.error('[ResearchEquipment] Availability error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load availability' });
  }
});

// ── Maintenance Due ──

router.get('/research/equipment/maintenance-due', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const result = await query(`
      SELECT le.id, le.name, le.category, le.maintenance_interval_days, le.calibration_interval_days,
        (SELECT MAX(em.performed_at) FROM equipment_maintenance em WHERE em.equipment_id = le.id AND em.maintenance_type != 'calibration') as last_maintenance,
        (SELECT MAX(em.performed_at) FROM equipment_maintenance em WHERE em.equipment_id = le.id AND em.maintenance_type = 'calibration') as last_calibration,
        (SELECT em.next_due FROM equipment_maintenance em WHERE em.equipment_id = le.id ORDER BY em.performed_at DESC LIMIT 1) as next_due
      FROM lab_equipment le
      WHERE le.farm_id = $1 AND le.status NOT IN ('retired')
      ORDER BY le.name ASC
    `, [farmId]);

    const now = new Date();
    const items = result.rows.map(r => {
      const maintenanceOverdue = r.maintenance_interval_days && r.last_maintenance
        ? (now - new Date(r.last_maintenance)) / 86400000 > r.maintenance_interval_days
        : false;
      const calibrationOverdue = r.calibration_interval_days && r.last_calibration
        ? (now - new Date(r.last_calibration)) / 86400000 > r.calibration_interval_days
        : false;
      return { ...r, maintenance_overdue: maintenanceOverdue, calibration_overdue: calibrationOverdue };
    });

    const overdue = items.filter(i => i.maintenance_overdue || i.calibration_overdue);

    res.json({ ok: true, equipment: items, overdue_count: overdue.length, overdue });
  } catch (err) {
    console.error('[ResearchEquipment] Maintenance due error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to check maintenance schedule' });
  }
});

export default router;
