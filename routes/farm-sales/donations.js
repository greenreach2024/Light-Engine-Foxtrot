/**
 * Farm Sales - Donations & Food Security Programs
 * Manage food bank donations, SNAP/EBT, and grant-funded programs (MULTI-TENANT)
 */

import express from 'express';
import { farmAuthMiddleware } from '../../lib/farm-auth.js';
import { farmStores } from '../../lib/farm-store.js';

const router = express.Router();

// Apply authentication to all routes
router.use(farmAuthMiddleware);

/**
 * GET /api/farm-sales/donations/programs
 * List food security programs
 * 
 * Query params:
 * - status: Filter by status (active, paused, completed)
 * - type: Filter by program type
 */
router.get('/programs', (req, res) => {
  try {
    const { status, type } = req.query;
    const farmId = req.farm_id;
    
    let filtered = farmStores.programs.getAllForFarm(farmId);

    if (status) {
      filtered = filtered.filter(p => p.status === status);
    }
    if (type) {
      filtered = filtered.filter(p => p.type === type);
    }

    // Calculate totals
    const stats = {
      total_programs: filtered.length,
      total_budget: filtered.reduce((sum, p) => sum + p.grant.total_budget, 0),
      total_spent: filtered.reduce((sum, p) => sum + p.grant.spent_to_date, 0),
      by_type: {}
    };

    filtered.forEach(program => {
      if (!stats.by_type[program.type]) {
        stats.by_type[program.type] = {
          count: 0,
          budget: 0,
          spent: 0
        };
      }
      stats.by_type[program.type].count++;
      stats.by_type[program.type].budget += program.grant.total_budget;
      stats.by_type[program.type].spent += program.grant.spent_to_date;
    });

    res.json({
      ok: true,
      programs: filtered,
      stats
    });

  } catch (error) {
    console.error('[farm-sales] Programs list failed:', error);
    res.status(500).json({
      ok: false,
      error: 'programs_list_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/donations/programs/:programId
 * Get single program details
 */
router.get('/programs/:programId', (req, res) => {
  const { programId } = req.params;
  const farmId = req.farm_id;
  const program = farmStores.programs.get(farmId, programId);

  if (!program) {
    return res.status(404).json({
      ok: false,
      error: 'program_not_found',
      program_id: programId
    });
  }

  res.json({
    ok: true,
    program
  });
});

/**
 * POST /api/farm-sales/donations
 * Record donation or subsidized order
 * 
 * Body:
 * {
 *   program_id: string,
 *   order_id?: string, // If associated with specific order
 *   recipient: { name?, organization?, contact },
 *   items: [{ sku_id, quantity, unit_price }],
 *   donation_type: 'direct'|'order_subsidy'|'snap_match',
 *   amount: number, // Grant funds used
 *   delivery?: { date, time_slot, address }
 * }
 */
router.post('/', async (req, res) => {
  try {
    const { program_id, order_id, recipient, items, donation_type, amount, delivery } = req.body;
    const farmId = req.farm_id;

    // Validate program
    const program = farmStores.programs.get(farmId, program_id);
    if (!program) {
      return res.status(404).json({
        ok: false,
        error: 'program_not_found',
        program_id
      });
    }

    if (program.status !== 'active') {
      return res.status(400).json({
        ok: false,
        error: 'program_inactive',
        message: `Program ${program.name} is not active`
      });
    }

    // Check grant budget
    const remaining = program.grant.total_budget - program.grant.spent_to_date;
    if (amount > remaining) {
      return res.status(400).json({
        ok: false,
        error: 'insufficient_grant_funds',
        message: `Grant has $${remaining.toFixed(2)} remaining, requested $${amount.toFixed(2)}`,
        remaining_budget: remaining
      });
    }

    // Validate items
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'items_required'
      });
    }

    const donationId = farmStores.donations.generateId(farmId, 'DON', 6);
    const timestamp = new Date().toISOString();

    // Calculate totals
    const retail_value = items.reduce((sum, item) => 
      sum + (item.quantity * item.unit_price), 0
    );

    const donation = {
      donation_id: donationId,
      program_id,
      program_name: program.name,
      order_id,
      donation_type,
      status: 'completed',
      recipient,
      items,
      financial: {
        retail_value,
        subsidy_amount: amount,
        subsidy_percent: program.subsidy_percent,
        recipient_paid: retail_value - amount
      },
      delivery,
      timestamps: {
        created_at: timestamp,
        delivered_at: delivery ? null : timestamp // If delivery, mark delivered later
      }
    };

    // Update program budget
    program.grant.spent_to_date += amount;
    farmStores.programs.set(farmId, program_id, program);

    // Store donation
    farmStores.donations.set(farmId, donationId, donation);

    res.status(201).json({
      ok: true,
      donation_id: donationId,
      donation,
      grant_remaining: program.grant.total_budget - program.grant.spent_to_date
    });

  } catch (error) {
    console.error('[farm-sales] Donation creation failed:', error);
    res.status(500).json({
      ok: false,
      error: 'donation_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/donations
 * List donations
 * 
 * Query params:
 * - program_id: Filter by program
 * - donation_type: Filter by type
 * - date_from: ISO date
 * - date_to: ISO date
 */
router.get('/', (req, res) => {
  try {
    const { program_id, donation_type, date_from, date_to } = req.query;
    const farmId = req.farm_id;
    
    let filtered = farmStores.donations.getAllForFarm(farmId);

    if (program_id) {
      filtered = filtered.filter(d => d.program_id === program_id);
    }
    if (donation_type) {
      filtered = filtered.filter(d => d.donation_type === donation_type);
    }
    if (date_from) {
      const fromDate = new Date(date_from);
      filtered = filtered.filter(d => new Date(d.timestamps.created_at) >= fromDate);
    }
    if (date_to) {
      const toDate = new Date(date_to);
      filtered = filtered.filter(d => new Date(d.timestamps.created_at) <= toDate);
    }

    // Sort by created_at descending
    filtered.sort((a, b) => 
      new Date(b.timestamps.created_at) - new Date(a.timestamps.created_at)
    );

    // Calculate totals
    const totals = {
      total_donations: filtered.length,
      total_retail_value: filtered.reduce((sum, d) => sum + d.financial.retail_value, 0),
      total_subsidy: filtered.reduce((sum, d) => sum + d.financial.subsidy_amount, 0),
      total_items: filtered.reduce((sum, d) => 
        sum + d.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0
      ),
      by_program: {}
    };

    filtered.forEach(donation => {
      if (!totals.by_program[donation.program_id]) {
        totals.by_program[donation.program_id] = {
          program_name: donation.program_name,
          count: 0,
          retail_value: 0,
          subsidy: 0
        };
      }
      totals.by_program[donation.program_id].count++;
      totals.by_program[donation.program_id].retail_value += donation.financial.retail_value;
      totals.by_program[donation.program_id].subsidy += donation.financial.subsidy_amount;
    });

    res.json({
      ok: true,
      donations: filtered,
      totals
    });

  } catch (error) {
    console.error('[farm-sales] Donations list failed:', error);
    res.status(500).json({
      ok: false,
      error: 'list_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/donations/:donationId
 * Get single donation details
 */
router.get('/:donationId', (req, res) => {
  const { donationId } = req.params;
  const farmId = req.farm_id;
  const donation = farmStores.donations.get(farmId, donationId);

  if (!donation) {
    return res.status(404).json({
      ok: false,
      error: 'donation_not_found',
      donation_id: donationId
    });
  }

  res.json({
    ok: true,
    donation
  });
});

/**
 * POST /api/farm-sales/donations/:donationId/deliver
 * Mark donation as delivered
 * 
 * Body:
 * {
 *   delivered_by?: string,
 *   notes?: string
 * }
 */
router.post('/:donationId/deliver', (req, res) => {
  try {
    const { donationId } = req.params;
    const { delivered_by, notes } = req.body;
    const farmId = req.farm_id;
    const donation = farmStores.donations.get(farmId, donationId);

    if (!donation) {
      return res.status(404).json({
        ok: false,
        error: 'donation_not_found',
        donation_id: donationId
      });
    }

    if (donation.timestamps.delivered_at) {
      return res.status(400).json({
        ok: false,
        error: 'already_delivered',
        delivered_at: donation.timestamps.delivered_at
      });
    }

    const timestamp = new Date().toISOString();
    donation.timestamps.delivered_at = timestamp;
    donation.delivered_by = delivered_by;
    donation.delivery_notes = notes;

    farmStores.donations.set(farmId, donationId, donation);

    res.json({
      ok: true,
      donation
    });

  } catch (error) {
    console.error('[farm-sales] Delivery confirmation failed:', error);
    res.status(500).json({
      ok: false,
      error: 'delivery_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/donations/reports/impact
 * Generate impact report for food security programs
 * 
 * Query params:
 * - date_from: ISO date
 * - date_to: ISO date
 * - program_id: Filter by program
 */
router.get('/reports/impact', (req, res) => {
  try {
    const { date_from, date_to, program_id } = req.query;
    const farmId = req.farm_id;
    
    let filtered = farmStores.donations.getAllForFarm(farmId);

    // Apply filters
    if (program_id) {
      filtered = filtered.filter(d => d.program_id === program_id);
    }
    if (date_from) {
      const fromDate = new Date(date_from);
      filtered = filtered.filter(d => new Date(d.timestamps.created_at) >= fromDate);
    }
    if (date_to) {
      const toDate = new Date(date_to);
      filtered = filtered.filter(d => new Date(d.timestamps.created_at) <= toDate);
    }

    // Calculate impact metrics
    const report = {
      period: {
        from: date_from || 'all time',
        to: date_to || 'present'
      },
      totals: {
        total_donations: filtered.length,
        total_recipients: new Set(filtered.map(d => d.recipient.name || d.recipient.organization)).size,
        total_pounds: filtered.reduce((sum, d) => 
          sum + d.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0
        ),
        retail_value: filtered.reduce((sum, d) => sum + d.financial.retail_value, 0),
        subsidy_provided: filtered.reduce((sum, d) => sum + d.financial.subsidy_amount, 0),
        cost_to_recipients: filtered.reduce((sum, d) => sum + d.financial.recipient_paid, 0)
      },
      by_program: {},
      by_month: {}
    };

    // Break down by program
    filtered.forEach(donation => {
      if (!report.by_program[donation.program_id]) {
        report.by_program[donation.program_id] = {
          program_name: donation.program_name,
          donations: 0,
          pounds: 0,
          retail_value: 0,
          subsidy: 0
        };
      }
      report.by_program[donation.program_id].donations++;
      report.by_program[donation.program_id].pounds += donation.items.reduce((sum, item) => sum + item.quantity, 0);
      report.by_program[donation.program_id].retail_value += donation.financial.retail_value;
      report.by_program[donation.program_id].subsidy += donation.financial.subsidy_amount;

      // Break down by month
      const month = donation.timestamps.created_at.substring(0, 7); // YYYY-MM
      if (!report.by_month[month]) {
        report.by_month[month] = {
          donations: 0,
          pounds: 0,
          subsidy: 0
        };
      }
      report.by_month[month].donations++;
      report.by_month[month].pounds += donation.items.reduce((sum, item) => sum + item.quantity, 0);
      report.by_month[month].subsidy += donation.financial.subsidy_amount;
    });

    res.json({
      ok: true,
      report
    });

  } catch (error) {
    console.error('[farm-sales] Impact report failed:', error);
    res.status(500).json({
      ok: false,
      error: 'report_failed',
      message: error.message
    });
  }
});

/**
 * PATCH /api/farm-sales/donations/programs/:programId
 * Update program (adjust budget, change status)
 * 
 * Body:
 * {
 *   status?: 'active'|'paused'|'completed',
 *   grant?: { total_budget? }
 * }
 */
router.patch('/programs/:programId', (req, res) => {
  try {
    const { programId } = req.params;
    const updates = req.body;
    const farmId = req.farm_id;
    const program = farmStores.programs.get(farmId, programId);

    if (!program) {
      return res.status(404).json({
        ok: false,
        error: 'program_not_found',
        program_id: programId
      });
    }

    // Update status
    if (updates.status) {
      program.status = updates.status;
    }

    // Update budget
    if (updates.grant?.total_budget) {
      program.grant.total_budget = updates.grant.total_budget;
    }

    farmStores.programs.set(farmId, programId, program);

    res.json({
      ok: true,
      program
    });

  } catch (error) {
    console.error('[farm-sales] Program update failed:', error);
    res.status(500).json({
      ok: false,
      error: 'update_failed',
      message: error.message
    });
  }
});

export default router;
