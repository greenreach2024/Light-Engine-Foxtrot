/**
 * Light Engine - Farm Fulfillment Status Webhooks
 * 
 * Handles farm-side fulfillment workflow status updates:
 * 1. Order received (from GreenReach checkout)
 * 2. Order picked (farm harvests/collects items)
 * 3. Order packed (farm packages for delivery)
 * 4. Order shipped (farm hands off to carrier/buyer pickup)
 * 5. Order delivered (confirmed received by buyer)
 * 
 * Status Transitions:
 * pending → picked → packed → shipped → delivered
 * 
 * Sends webhook notifications to GreenReach for each status change
 * to keep centralized order tracking synchronized.
 */

import express from 'express';

const router = express.Router();

// In-memory storage for fulfillment status (TODO: migrate to database)
const fulfillmentRecords = new Map(); // sub_order_id -> { status, history, current_location, tracking_info }

// Valid status transitions
const VALID_TRANSITIONS = {
  'pending': ['picked', 'cancelled'],
  'picked': ['packed', 'cancelled'],
  'packed': ['shipped', 'cancelled'],
  'shipped': ['delivered', 'returned'],
  'delivered': [],
  'cancelled': [],
  'returned': ['pending'] // Can be reprocessed
};

// GreenReach webhook endpoint (configured per environment)
const GREENREACH_WEBHOOK_URL = process.env.GREENREACH_WEBHOOK_URL || 'http://localhost:3100/api/wholesale/webhooks/fulfillment';

/**
 * POST /api/wholesale/fulfillment/status
 * 
 * Update fulfillment status for a farm sub-order
 * 
 * Body:
 * {
 *   sub_order_id: 'sub_order_123',
 *   farm_id: 'farm_123',
 *   status: 'picked',
 *   notes: 'All items harvested, quality checked',
 *   location: 'Pack House Station 3',
 *   updated_by: 'john@farm.com',
 *   tracking_number: 'USPS-1234567890' (optional, for shipped status),
 *   carrier: 'USPS' (optional),
 *   estimated_delivery: '2025-12-20' (optional)
 * }
 * 
 * Response:
 * {
 *   status: 'ok',
 *   data: {
 *     sub_order_id: 'sub_order_123',
 *     old_status: 'pending',
 *     new_status: 'picked',
 *     updated_at: '2025-12-15T10:00:00Z',
 *     webhook_sent: true
 *   }
 * }
 */
router.post('/status', async (req, res) => {
  try {
    const {
      sub_order_id,
      farm_id,
      status,
      notes,
      location,
      updated_by,
      tracking_number,
      carrier,
      estimated_delivery
    } = req.body;
    
    // Validate required fields
    if (!sub_order_id || !farm_id || !status) {
      return res.status(400).json({
        status: 'error',
        message: 'sub_order_id, farm_id, and status are required'
      });
    }
    
    // Validate status value
    const validStatuses = ['pending', 'picked', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        status: 'error',
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }
    
    // Get existing record or create new one
    let record = fulfillmentRecords.get(sub_order_id);
    const oldStatus = record?.status || 'pending';
    
    if (!record) {
      record = {
        sub_order_id,
        farm_id,
        status: 'pending',
        history: [],
        created_at: new Date().toISOString()
      };
    }
    
    // Validate status transition
    const allowedTransitions = VALID_TRANSITIONS[oldStatus] || [];
    if (oldStatus !== status && !allowedTransitions.includes(status)) {
      return res.status(400).json({
        status: 'error',
        message: `Invalid transition from ${oldStatus} to ${status}. Allowed: ${allowedTransitions.join(', ')}`
      });
    }
    
    // Update record
    const timestamp = new Date().toISOString();
    record.status = status;
    record.updated_at = timestamp;
    record.current_location = location;
    record.updated_by = updated_by;
    
    if (tracking_number) {
      record.tracking_number = tracking_number;
    }
    if (carrier) {
      record.carrier = carrier;
    }
    if (estimated_delivery) {
      record.estimated_delivery = estimated_delivery;
    }
    
    // Add to history
    record.history.push({
      status,
      timestamp,
      notes,
      location,
      updated_by,
      tracking_number,
      carrier
    });
    
    fulfillmentRecords.set(sub_order_id, record);
    
    // Send webhook to GreenReach
    let webhookSent = false;
    try {
      const webhookPayload = {
        event_type: 'fulfillment.status_updated',
        sub_order_id,
        farm_id,
        old_status: oldStatus,
        new_status: status,
        notes,
        location,
        tracking_number,
        carrier,
        estimated_delivery,
        updated_by,
        updated_at: timestamp
      };
      
      const webhookResponse = await fetch(GREENREACH_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookPayload)
      });
      
      webhookSent = webhookResponse.ok;
      
      if (!webhookResponse.ok) {
        console.warn(`Failed to send webhook to GreenReach: ${webhookResponse.status}`);
      } else {
        console.log(` Sent fulfillment webhook for ${sub_order_id}: ${oldStatus} → ${status}`);
      }
    } catch (webhookError) {
      console.error('Webhook send error:', webhookError.message);
    }
    
    res.json({
      status: 'ok',
      data: {
        sub_order_id,
        old_status: oldStatus,
        new_status: status,
        updated_at: timestamp,
        webhook_sent: webhookSent
      },
      message: `Fulfillment status updated: ${oldStatus} → ${status}`
    });
    
  } catch (error) {
    console.error('Fulfillment status update error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update fulfillment status',
      error: error.message
    });
  }
});

/**
 * GET /api/wholesale/fulfillment/status/:sub_order_id
 * 
 * Get fulfillment status and history for a sub-order
 * 
 * Response:
 * {
 *   status: 'ok',
 *   data: {
 *     sub_order_id: 'sub_order_123',
 *     farm_id: 'farm_123',
 *     status: 'shipped',
 *     current_location: 'In Transit',
 *     tracking_number: 'USPS-1234567890',
 *     carrier: 'USPS',
 *     estimated_delivery: '2025-12-20',
 *     history: [...]
 *   }
 * }
 */
router.get('/status/:sub_order_id', (req, res) => {
  try {
    const { sub_order_id } = req.params;
    
    const record = fulfillmentRecords.get(sub_order_id);
    if (!record) {
      return res.status(404).json({
        status: 'error',
        message: 'Fulfillment record not found'
      });
    }
    
    res.json({
      status: 'ok',
      data: record
    });
    
  } catch (error) {
    console.error('Get fulfillment status error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get fulfillment status',
      error: error.message
    });
  }
});

/**
 * GET /api/wholesale/fulfillment/orders
 * 
 * List all fulfillment records for this farm
 * 
 * Query params:
 * - farm_id: Filter by farm
 * - status: Filter by status
 * - from_date: Filter by date range
 * - to_date: Filter by date range
 * 
 * Response:
 * {
 *   status: 'ok',
 *   data: {
 *     records: [...],
 *     total: 10,
 *     by_status: { pending: 2, picked: 3, ... }
 *   }
 * }
 */
router.get('/orders', (req, res) => {
  try {
    const { farm_id, status, from_date, to_date } = req.query;
    
    let records = Array.from(fulfillmentRecords.values());
    
    // Apply filters
    if (farm_id) {
      records = records.filter(r => r.farm_id === farm_id);
    }
    if (status) {
      records = records.filter(r => r.status === status);
    }
    if (from_date) {
      const fromTime = new Date(from_date).getTime();
      records = records.filter(r => new Date(r.created_at).getTime() >= fromTime);
    }
    if (to_date) {
      const toTime = new Date(to_date).getTime();
      records = records.filter(r => new Date(r.created_at).getTime() <= toTime);
    }
    
    // Calculate statistics
    const byStatus = {};
    records.forEach(r => {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    });
    
    res.json({
      status: 'ok',
      data: {
        records,
        total: records.length,
        by_status: byStatus
      }
    });
    
  } catch (error) {
    console.error('List fulfillment orders error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to list fulfillment orders',
      error: error.message
    });
  }
});

/**
 * POST /api/wholesale/fulfillment/invoice-required
 * 
 * Webhook from GreenReach requesting farm to issue invoice
 * (Farms are Merchant of Record)
 * 
 * Body:
 * {
 *   sub_order_id: 'sub_order_123',
 *   master_order_id: 'order_456',
 *   buyer: {
 *     name: 'Restaurant ABC',
 *     email: 'accounting@restaurant.com',
 *     address: {...}
 *   },
 *   items: [
 *     {
 *       sku_id: 'lettuce_romaine',
 *       product_name: 'Romaine Lettuce',
 *       quantity: 50,
 *       unit: 'lb',
 *       price_per_unit: 3.50,
 *       subtotal: 175.00
 *     }
 *   ],
 *   subtotal: 175.00,
 *   tax: 14.00,
 *   total: 189.00,
 *   broker_fee_amount: 17.50,
 *   broker_fee_disclosure: 'A 10% broker fee ($17.50) was collected by GreenReach Wholesale'
 * }
 * 
 * Response:
 * {
 *   status: 'ok',
 *   data: {
 *     invoice_id: 'INV-2025-001',
 *     invoice_url: 'https://farm.com/invoices/INV-2025-001.pdf',
 *     issued_at: '2025-12-15T10:00:00Z'
 *   }
 * }
 */
router.post('/invoice-required', async (req, res) => {
  try {
    const {
      sub_order_id,
      master_order_id,
      buyer,
      items,
      subtotal,
      tax,
      total,
      broker_fee_amount,
      broker_fee_disclosure
    } = req.body;
    
    // Generate invoice ID
    const invoiceId = `INV-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
    const issuedAt = new Date().toISOString();
    
    // In production, this would:
    // 1. Generate PDF invoice using template
    // 2. Store invoice in farm's accounting system
    // 3. Email invoice to buyer
    // 4. Update order record with invoice_id
    
    console.log(` Invoice request received for sub-order ${sub_order_id}`);
    console.log(`  Buyer: ${buyer.name} (${buyer.email})`);
    console.log(`  Items: ${items.length}`);
    console.log(`  Total: $${total.toFixed(2)}`);
    console.log(`  Broker Fee: $${broker_fee_amount.toFixed(2)}`);
    console.log(`  Generated Invoice ID: ${invoiceId}`);
    
    // Store invoice record
    const invoiceRecord = {
      invoice_id: invoiceId,
      sub_order_id,
      master_order_id,
      buyer,
      items,
      subtotal,
      tax,
      total,
      broker_fee_amount,
      broker_fee_disclosure,
      issued_at: issuedAt,
      status: 'issued'
    };
    
    // In-memory storage (TODO: database)
    if (!global.invoiceRecords) {
      global.invoiceRecords = new Map();
    }
    global.invoiceRecords.set(invoiceId, invoiceRecord);
    
    res.json({
      status: 'ok',
      data: {
        invoice_id: invoiceId,
        invoice_url: `${req.protocol}://${req.get('host')}/api/wholesale/fulfillment/invoice/${invoiceId}`,
        issued_at: issuedAt
      },
      message: 'Invoice generated successfully'
    });
    
  } catch (error) {
    console.error('Invoice generation error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to generate invoice',
      error: error.message
    });
  }
});

/**
 * GET /api/wholesale/fulfillment/invoice/:invoice_id
 * 
 * Get invoice details (in production, would return PDF)
 */
router.get('/invoice/:invoice_id', (req, res) => {
  try {
    const { invoice_id } = req.params;
    
    if (!global.invoiceRecords) {
      return res.status(404).json({
        status: 'error',
        message: 'Invoice not found'
      });
    }
    
    const invoice = global.invoiceRecords.get(invoice_id);
    if (!invoice) {
      return res.status(404).json({
        status: 'error',
        message: 'Invoice not found'
      });
    }
    
    // In production, would generate/serve PDF
    // For now, return JSON invoice data
    res.json({
      status: 'ok',
      data: invoice
    });
    
  } catch (error) {
    console.error('Get invoice error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get invoice',
      error: error.message
    });
  }
});

export default router;
