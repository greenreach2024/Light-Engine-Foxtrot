/**
 * Lot Code Traceability System
 * 
 * FDA-compliant lot tracking for food safety and recall management
 * 
 * Features:
 * - Auto-generate lot codes: ZONE-CROP-YYMMDD-BATCH format
 * - Track lot → customer for recalls
 * - Barcode generation (Code 128, Code 93, GS1)
 * - FIFO/FEFO/LIFO inventory management
 * - Recall readiness and reporting
 */

import express from 'express';
import JsBarcode from 'jsbarcode';
import { createCanvas } from 'canvas';
import farmStores from '../../lib/farm-store.js';

const router = express.Router();

/**
 * Generate lot code in format: ZONE-CROP-YYMMDD-BATCH
 * Example: A1-LETTUCE-251216-001
 */
function generateLotCode(zoneId, cropType, harvestDate) {
  const date = new Date(harvestDate);
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const dateStr = `${yy}${mm}${dd}`;
  
  // Sanitize zone and crop for lot code
  const zonePart = zoneId.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 10);
  const cropPart = cropType.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 15);
  
  return {
    zoneId: zonePart,
    cropType: cropPart,
    dateStr,
    baseCode: `${zonePart}-${cropPart}-${dateStr}`
  };
}

/**
 * Find next available batch number for a lot code base
 */
function getNextBatchNumber(farmId, baseCode) {
  const lots = farmStores.lotTracking.getAllForFarm(farmId);
  const sameDayLots = lots.filter(lot => lot.lot_code.startsWith(baseCode));
  
  if (sameDayLots.length === 0) {
    return 1;
  }
  
  // Find max batch number
  const batchNumbers = sameDayLots.map(lot => {
    const parts = lot.lot_code.split('-');
    return parseInt(parts[parts.length - 1]) || 0;
  });
  
  return Math.max(...batchNumbers) + 1;
}

/**
 * POST /api/farm-sales/lots/generate
 * Generate new lot code
 * 
 * Body:
 * {
 *   "zone_id": "ROOM-A-Z1",
 *   "crop_type": "Lettuce",
 *   "variety": "Butterhead",
 *   "harvest_date": "2025-12-16T10:00:00Z",
 *   "quantity": 500,
 *   "unit": "heads"
 * }
 */
router.post('/generate', (req, res) => {
  try {
    const farmId = req.farmId || 'FARM-001'; // From auth middleware
    const { zone_id, crop_type, variety, harvest_date, quantity, unit } = req.body;
    
    // Validation
    if (!zone_id || !crop_type || !harvest_date || !quantity) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: zone_id, crop_type, harvest_date, quantity'
      });
    }
    
    // Generate lot code
    const lotParts = generateLotCode(zone_id, crop_type, harvest_date);
    const batchNumber = getNextBatchNumber(farmId, lotParts.baseCode);
    const batchStr = String(batchNumber).padStart(3, '0');
    const lotCode = `${lotParts.baseCode}-${batchStr}`;
    
    // Create lot tracking record
    const lotRecord = {
      lot_code: lotCode,
      farm_id: farmId,
      zone_id,
      crop_type,
      variety: variety || null,
      harvest_date,
      batch_number: batchNumber,
      quantity,
      unit: unit || 'units',
      status: 'active', // active, consumed, expired, recalled
      customers: [],
      orders: [],
      created_at: new Date().toISOString(),
      created_by: req.user?.user_id || 'system'
    };
    
    // Store lot record
    farmStores.lotTracking.set(farmId, lotCode, lotRecord);
    
    console.log(`[lot-tracking] Generated lot code: ${lotCode} for farm ${farmId}`);
    
    res.json({
      success: true,
      lot: lotRecord
    });
    
  } catch (error) {
    console.error('[lot-tracking] Error generating lot:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/farm-sales/lots
 * List all lots with optional filters
 * 
 * Query params:
 * - status: active, consumed, expired, recalled
 * - zone_id: filter by zone
 * - crop_type: filter by crop
 * - from_date: harvest date range start
 * - to_date: harvest date range end
 */
router.get('/', (req, res) => {
  try {
    const farmId = req.farmId || 'FARM-001';
    const { status, zone_id, crop_type, from_date, to_date } = req.query;
    
    let lots = farmStores.lotTracking.getAllForFarm(farmId);
    
    // Apply filters
    if (status) {
      lots = lots.filter(lot => lot.status === status);
    }
    
    if (zone_id) {
      lots = lots.filter(lot => lot.zone_id === zone_id);
    }
    
    if (crop_type) {
      lots = lots.filter(lot => 
        lot.crop_type.toLowerCase().includes(crop_type.toLowerCase())
      );
    }
    
    if (from_date) {
      lots = lots.filter(lot => new Date(lot.harvest_date) >= new Date(from_date));
    }
    
    if (to_date) {
      lots = lots.filter(lot => new Date(lot.harvest_date) <= new Date(to_date));
    }
    
    // Sort by harvest date (newest first)
    lots.sort((a, b) => new Date(b.harvest_date) - new Date(a.harvest_date));
    
    res.json({
      success: true,
      lots,
      count: lots.length
    });
    
  } catch (error) {
    console.error('[lot-tracking] Error listing lots:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/farm-sales/lots/:lotCode
 * Get details for a specific lot
 */
router.get('/:lotCode', (req, res) => {
  try {
    const farmId = req.farmId || 'FARM-001';
    const { lotCode } = req.params;
    
    const lot = farmStores.lotTracking.get(farmId, lotCode);
    
    if (!lot) {
      return res.status(404).json({
        success: false,
        error: 'Lot not found'
      });
    }
    
    res.json({
      success: true,
      lot
    });
    
  } catch (error) {
    console.error('[lot-tracking] Error getting lot:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/farm-sales/lots/:lotCode/assign
 * Assign lot to an order/customer for traceability
 * 
 * Body:
 * {
 *   "order_id": "ORD-001234",
 *   "customer_id": "CUST-001",
 *   "quantity": 50
 * }
 */
router.post('/:lotCode/assign', (req, res) => {
  try {
    const farmId = req.farmId || 'FARM-001';
    const { lotCode } = req.params;
    const { order_id, customer_id, quantity } = req.body;
    
    if (!order_id || !customer_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: order_id, customer_id'
      });
    }
    
    const lot = farmStores.lotTracking.get(farmId, lotCode);
    
    if (!lot) {
      return res.status(404).json({
        success: false,
        error: 'Lot not found'
      });
    }
    
    // Track customer and order for recall capability
    if (!lot.customers.includes(customer_id)) {
      lot.customers.push(customer_id);
    }
    
    if (!lot.orders.includes(order_id)) {
      lot.orders.push(order_id);
    }
    
    // Update assignment history
    if (!lot.assignments) {
      lot.assignments = [];
    }
    
    lot.assignments.push({
      order_id,
      customer_id,
      quantity: quantity || 0,
      assigned_at: new Date().toISOString(),
      assigned_by: req.user?.user_id || 'system'
    });
    
    // Update lot record
    farmStores.lotTracking.set(farmId, lotCode, lot);
    
    console.log(`[lot-tracking] Assigned lot ${lotCode} to order ${order_id} / customer ${customer_id}`);
    
    res.json({
      success: true,
      lot
    });
    
  } catch (error) {
    console.error('[lot-tracking] Error assigning lot:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/farm-sales/lots/:lotCode/recall
 * Get recall report: all customers who received this lot
 * 
 * Critical for FDA compliance and food safety
 */
router.get('/:lotCode/recall', (req, res) => {
  try {
    const farmId = req.farmId || 'FARM-001';
    const { lotCode } = req.params;
    
    const lot = farmStores.lotTracking.get(farmId, lotCode);
    
    if (!lot) {
      return res.status(404).json({
        success: false,
        error: 'Lot not found'
      });
    }
    
    // Get customer details
    const customers = lot.customers.map(customerId => {
      const customer = farmStores.customers.get(farmId, customerId);
      return customer || { customer_id: customerId, name: 'Unknown' };
    });
    
    // Get order details
    const orders = lot.orders.map(orderId => {
      const order = farmStores.orders.get(farmId, orderId);
      return order || { order_id: orderId };
    });
    
    // Compile recall report
    const recallReport = {
      lot_code: lotCode,
      crop_type: lot.crop_type,
      variety: lot.variety,
      harvest_date: lot.harvest_date,
      zone_id: lot.zone_id,
      status: lot.status,
      total_quantity: lot.quantity,
      unit: lot.unit,
      customers_affected: customers.length,
      orders_affected: orders.length,
      customers,
      orders,
      assignments: lot.assignments || [],
      report_generated_at: new Date().toISOString()
    };
    
    console.log(`[lot-tracking] Generated recall report for lot ${lotCode}: ${customers.length} customers affected`);
    
    res.json({
      success: true,
      recall_report: recallReport
    });
    
  } catch (error) {
    console.error('[lot-tracking] Error generating recall report:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/farm-sales/lots/:lotCode/barcode
 * Generate barcode image for lot code
 * 
 * Query params:
 * - format: CODE128 (default), CODE93, EAN13, UPC
 * - width: 2 (default)
 * - height: 100 (default)
 * - displayValue: true (default)
 */
router.get('/:lotCode/barcode', (req, res) => {
  try {
    const farmId = req.farmId || 'FARM-001';
    const { lotCode } = req.params;
    const { 
      format = 'CODE128', 
      width = 2, 
      height = 100,
      displayValue = 'true'
    } = req.query;
    
    const lot = farmStores.lotTracking.get(farmId, lotCode);
    
    if (!lot) {
      return res.status(404).json({
        success: false,
        error: 'Lot not found'
      });
    }
    
    // Create canvas for barcode
    const canvas = createCanvas(400, 150);
    
    // Generate barcode
    JsBarcode(canvas, lotCode, {
      format: format.toUpperCase(),
      width: parseInt(width),
      height: parseInt(height),
      displayValue: displayValue === 'true',
      fontSize: 14,
      margin: 10
    });
    
    // Return as PNG image
    res.setHeader('Content-Type', 'image/png');
    res.send(canvas.toBuffer('image/png'));
    
    console.log(`[lot-tracking] Generated ${format} barcode for lot ${lotCode}`);
    
  } catch (error) {
    console.error('[lot-tracking] Error generating barcode:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PATCH /api/farm-sales/lots/:lotCode
 * Update lot status (consumed, expired, recalled)
 * 
 * Body:
 * {
 *   "status": "recalled",
 *   "reason": "Quality issue detected"
 * }
 */
router.patch('/:lotCode', (req, res) => {
  try {
    const farmId = req.farmId || 'FARM-001';
    const { lotCode } = req.params;
    const { status, reason } = req.body;
    
    const lot = farmStores.lotTracking.get(farmId, lotCode);
    
    if (!lot) {
      return res.status(404).json({
        success: false,
        error: 'Lot not found'
      });
    }
    
    // Validate status
    const validStatuses = ['active', 'consumed', 'expired', 'recalled'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }
    
    // Update lot
    if (status) {
      lot.status = status;
      lot.status_updated_at = new Date().toISOString();
      lot.status_updated_by = req.user?.user_id || 'system';
    }
    
    if (reason) {
      lot.status_reason = reason;
    }
    
    // Track recall events
    if (status === 'recalled') {
      if (!lot.recall_events) {
        lot.recall_events = [];
      }
      lot.recall_events.push({
        recalled_at: new Date().toISOString(),
        recalled_by: req.user?.user_id || 'system',
        reason: reason || 'Not specified'
      });
      
      console.log(`[lot-tracking] [WARNING]  RECALL INITIATED for lot ${lotCode}: ${reason}`);
    }
    
    farmStores.lotTracking.set(farmId, lotCode, lot);
    
    res.json({
      success: true,
      lot
    });
    
  } catch (error) {
    console.error('[lot-tracking] Error updating lot:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/farm-sales/lots/:lotCode
 * Delete lot (use with caution - for corrections only)
 */
router.delete('/:lotCode', (req, res) => {
  try {
    const farmId = req.farmId || 'FARM-001';
    const { lotCode } = req.params;
    
    const lot = farmStores.lotTracking.get(farmId, lotCode);
    
    if (!lot) {
      return res.status(404).json({
        success: false,
        error: 'Lot not found'
      });
    }
    
    // Prevent deletion if lot has been assigned
    if (lot.customers.length > 0 || lot.orders.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete lot with customer/order assignments. Mark as expired instead.'
      });
    }
    
    farmStores.lotTracking.delete(farmId, lotCode);
    
    console.log(`[lot-tracking] Deleted lot ${lotCode}`);
    
    res.json({
      success: true,
      message: 'Lot deleted'
    });
    
  } catch (error) {
    console.error('[lot-tracking] Error deleting lot:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
