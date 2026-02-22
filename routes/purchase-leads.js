/**
 * Purchase Leads CRM Endpoint
 * Handles pre-order/interest submissions from purchase.html page
 * Persisted to NeDB (Phase 0, Ticket 0.3)
 */

import express from 'express';
import crypto from 'crypto';
import Datastore from '@seald-io/nedb';
import eventBus from '../lib/event-bus.js';

const router = express.Router();

// Persistent storage — NeDB backed (replaces volatile in-memory Map)
const leadsDB = new Datastore({
  filename: './data/purchase-leads.db',
  autoload: true,
  timestampData: true
});

/**
 * Generate unique lead ID
 */
function generateLeadId() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `LEAD-${timestamp}-${random}`;
}

/**
 * POST /api/purchase/leads
 * Record a new purchase interest/lead
 * 
 * Body: {
 *   farmName: string (required)
 *   contactName: string (required)
 *   email: string (required)
 *   farmId: string (optional - for existing customers)
 *   plan: string (edge|cloud)
 * }
 */
router.post('/leads', async (req, res) => {
  try {
    const { farmName, contactName, email, farmId, plan } = req.body;

    // Validate required fields
    if (!farmName || !contactName || !email) {
      return res.status(400).json({
        ok: false,
        error: 'missing_required_fields',
        message: 'Farm Name, Contact Name, and Email are required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_email',
        message: 'Please provide a valid email address'
      });
    }

    // Generate unique lead ID
    const leadId = generateLeadId();
    const timestamp = new Date().toISOString();

    const lead = {
      lead_id: leadId,
      farm_name: farmName,
      contact_name: contactName,
      email: email.toLowerCase(),
      farm_id: farmId || null,
      plan: plan || 'not_specified',
      status: 'new',
      source: 'purchase_page',
      created_at: timestamp,
      updated_at: timestamp
    };

    // Save lead to persistent DB
    await leadsDB.insert(lead);

    console.log(`[Purchase CRM] New lead created: ${leadId} - ${farmName} (${email})`);

    // Ticket 2.8: Emit lead_created funnel event
    eventBus.emitEvent('lead_created', {
      lead_id: leadId,
      farm_name: farmName,
      email: email.toLowerCase(),
      plan: plan || 'not_specified',
      source: 'purchase_page'
    });

    // Return success with lead details
    return res.status(201).json({
      ok: true,
      lead_id: leadId,
      message: 'Thank you for your interest! We will contact you shortly to schedule a call.',
      lead: {
        lead_id: leadId,
        farm_name: farmName,
        created_at: timestamp
      }
    });

  } catch (error) {
    console.error('[Purchase CRM] Lead creation failed:', error);
    return res.status(500).json({
      ok: false,
      error: 'creation_failed',
      message: 'Failed to save your information. Please try again.'
    });
  }
});

/**
 * GET /api/purchase/leads
 * Retrieve all leads (admin/internal use)
 */
router.get('/leads', async (req, res) => {
  try {
    const allLeads = await leadsDB.find({}).sort({ created_at: -1 });
    
    return res.json({
      ok: true,
      count: allLeads.length,
      leads: allLeads
    });
  } catch (error) {
    console.error('[Purchase CRM] Failed to retrieve leads:', error);
    return res.status(500).json({
      ok: false,
      error: 'retrieval_failed'
    });
  }
});

/**
 * GET /api/purchase/leads/:leadId
 * Retrieve specific lead
 */
router.get('/leads/:leadId', async (req, res) => {
  try {
    const { leadId } = req.params;
    const lead = await leadsDB.findOne({ lead_id: leadId });

    if (!lead) {
      return res.status(404).json({
        ok: false,
        error: 'lead_not_found'
      });
    }

    return res.json({
      ok: true,
      lead
    });
  } catch (error) {
    console.error('[Purchase CRM] Failed to retrieve lead:', error);
    return res.status(500).json({
      ok: false,
      error: 'retrieval_failed'
    });
  }
});

/**
 * PUT /api/purchase/leads/:leadId/status
 * Update lead status (contacted, scheduled, converted, declined)
 */
router.put('/leads/:leadId/status', async (req, res) => {
  try {
    const { leadId } = req.params;
    const { status, notes } = req.body;

    const lead = await leadsDB.findOne({ lead_id: leadId });
    if (!lead) {
      return res.status(404).json({
        ok: false,
        error: 'lead_not_found'
      });
    }

    const updateFields = {
      status,
      updated_at: new Date().toISOString()
    };
    if (notes) updateFields.notes = notes;

    await leadsDB.update({ lead_id: leadId }, { $set: updateFields });
    const updated = await leadsDB.findOne({ lead_id: leadId });

    // Ticket 2.8: Emit lead_status_changed funnel event
    eventBus.emitEvent('lead_status_changed', {
      lead_id: leadId,
      previous_status: lead.status,
      new_status: status,
      farm_name: lead.farm_name || null
    });

    return res.json({
      ok: true,
      lead: updated
    });
  } catch (error) {
    console.error('[Purchase CRM] Failed to update lead:', error);
    return res.status(500).json({
      ok: false,
      error: 'update_failed'
    });
  }
});

export default router;
