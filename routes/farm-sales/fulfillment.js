/**
 * Farm Sales - Pick & Pack Lists
 * Generate fulfillment lists for warehouse/field operations (MULTI-TENANT)
 */

import express from 'express';
import { farmAuthMiddleware } from '../../lib/farm-auth.js';
import { farmStores } from '../../lib/farm-store.js';

const router = express.Router();

// Apply authentication to all routes
router.use(farmAuthMiddleware);

/**
 * GET /api/farm-sales/fulfillment/pick-list
 * Generate pick list (grouped by product for field/warehouse picking)
 * 
 * Query params:
 * - date: Delivery date filter (YYYY-MM-DD)
 * - format: 'json' | 'csv' (default: json)
 * - status: Order status filter (default: 'pending,confirmed')
 */
router.get('/pick-list', (req, res) => {
  try {
    const { date, format = 'json', status = 'pending,confirmed' } = req.query;
    const farmId = req.farm_id;

    // Get orders for pick list
    let orders = farmStores.orders.getAllForFarm(farmId);

    // Filter by status
    const statusFilters = status.split(',');
    orders = orders.filter(o => statusFilters.includes(o.status));

    // Filter by delivery date if specified
    if (date) {
      orders = orders.filter(o => o.delivery?.date === date);
    }

    // Aggregate items across all orders (group by SKU)
    const pickItems = {};
    const orderReferences = {};

    orders.forEach(order => {
      order.items.forEach(item => {
        if (!pickItems[item.sku_id]) {
          pickItems[item.sku_id] = {
            sku_id: item.sku_id,
            name: item.name,
            category: item.category,
            unit: item.unit,
            total_quantity: 0,
            orders: []
          };
        }
        
        pickItems[item.sku_id].total_quantity += item.quantity;
        pickItems[item.sku_id].orders.push({
          order_id: order.order_id,
          customer: order.customer?.name || 'Walk-up',
          quantity: item.quantity
        });

        if (!orderReferences[order.order_id]) {
          orderReferences[order.order_id] = {
            order_id: order.order_id,
            customer: order.customer?.name || 'Walk-up',
            channel: order.channel
          };
        }
      });
    });

    // Convert to array and sort by category, then name
    const pickList = Object.values(pickItems).sort((a, b) => {
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category);
      }
      return a.name.localeCompare(b.name);
    });

    // Calculate summary stats
    const summary = {
      total_orders: orders.length,
      total_items: pickList.length,
      total_units: pickList.reduce((sum, item) => sum + item.total_quantity, 0),
      by_category: {}
    };

    pickList.forEach(item => {
      if (!summary.by_category[item.category]) {
        summary.by_category[item.category] = { items: 0, units: 0 };
      }
      summary.by_category[item.category].items++;
      summary.by_category[item.category].units += item.total_quantity;
    });

    // Return JSON or CSV
    if (format === 'csv') {
      const csv = generatePickListCSV(pickList, summary);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="pick-list-${date || 'all'}-${Date.now()}.csv"`);
      return res.send(csv);
    }

    res.json({
      ok: true,
      farm_id: farmId,
      date: date || 'all',
      pick_list: pickList,
      order_references: Object.values(orderReferences),
      summary
    });

  } catch (error) {
    console.error('[farm-sales] Pick list generation failed:', error);
    res.status(500).json({
      ok: false,
      error: 'generation_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/fulfillment/pack-list
 * Generate pack list (grouped by customer for order packing)
 * 
 * Query params:
 * - date: Delivery date filter (YYYY-MM-DD)
 * - format: 'json' | 'csv' (default: json)
 * - status: Order status filter (default: 'pending,confirmed')
 */
router.get('/pack-list', (req, res) => {
  try {
    const { date, format = 'json', status = 'pending,confirmed' } = req.query;
    const farmId = req.farm_id;

    // Get orders for pack list
    let orders = farmStores.orders.getAllForFarm(farmId);

    // Filter by status
    const statusFilters = status.split(',');
    orders = orders.filter(o => statusFilters.includes(o.status));

    // Filter by delivery date if specified
    if (date) {
      orders = orders.filter(o => o.delivery?.date === date);
    }

    // Sort by customer name
    orders.sort((a, b) => {
      const nameA = a.customer?.name || 'Walk-up';
      const nameB = b.customer?.name || 'Walk-up';
      return nameA.localeCompare(nameB);
    });

    // Format pack list (one entry per order with items)
    const packList = orders.map(order => ({
      order_id: order.order_id,
      customer: {
        name: order.customer?.name || 'Walk-up',
        email: order.customer?.email,
        phone: order.customer?.phone
      },
      channel: order.channel,
      items: order.items.map(item => ({
        sku_id: item.sku_id,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit
      })),
      total_items: order.items.reduce((sum, item) => sum + item.quantity, 0),
      delivery: order.delivery,
      notes: order.notes,
      status: order.status
    }));

    // Calculate summary
    const summary = {
      total_orders: packList.length,
      total_line_items: packList.reduce((sum, order) => sum + order.items.length, 0),
      total_units: packList.reduce((sum, order) => sum + order.total_items, 0),
      by_channel: {}
    };

    packList.forEach(order => {
      if (!summary.by_channel[order.channel]) {
        summary.by_channel[order.channel] = 0;
      }
      summary.by_channel[order.channel]++;
    });

    // Return JSON or CSV
    if (format === 'csv') {
      const csv = generatePackListCSV(packList, summary);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="pack-list-${date || 'all'}-${Date.now()}.csv"`);
      return res.send(csv);
    }

    res.json({
      ok: true,
      farm_id: farmId,
      date: date || 'all',
      pack_list: packList,
      summary
    });

  } catch (error) {
    console.error('[farm-sales] Pack list generation failed:', error);
    res.status(500).json({
      ok: false,
      error: 'generation_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/fulfillment/delivery-manifest
 * Generate delivery manifest (route planning for deliveries)
 * 
 * Query params:
 * - date: Delivery date (YYYY-MM-DD, required)
 * - time_slot: Filter by time slot (morning, afternoon, evening)
 * - format: 'json' | 'csv' (default: json)
 */
router.get('/delivery-manifest', (req, res) => {
  try {
    const { date, time_slot, format = 'json' } = req.query;
    const farmId = req.farm_id;

    if (!date) {
      return res.status(400).json({
        ok: false,
        error: 'date_required',
        message: 'Delivery date (YYYY-MM-DD) is required'
      });
    }

    // Get orders for delivery
    let orders = farmStores.orders.getAllForFarm(farmId)
      .filter(o => o.channel === 'delivery' || o.channel === 'd2c');

    // Filter by date
    orders = orders.filter(o => o.delivery?.date === date);

    // Filter by time slot if specified
    if (time_slot) {
      orders = orders.filter(o => o.delivery?.time_slot === time_slot);
    }

    // Group by time slot and sort by address
    const manifest = {
      morning: [],
      afternoon: [],
      evening: []
    };

    orders.forEach(order => {
      const slot = order.delivery?.time_slot || 'afternoon';
      manifest[slot].push({
        order_id: order.order_id,
        customer: {
          name: order.customer?.name || 'Customer',
          phone: order.customer?.phone,
          email: order.customer?.email
        },
        address: order.delivery?.address || order.customer?.address,
        instructions: order.delivery?.instructions,
        items_count: order.items.length,
        total_units: order.items.reduce((sum, item) => sum + item.quantity, 0),
        delivery_fee: order.pricing?.delivery_fee ?? order.delivery?.delivery_fee ?? 0,
        tip_amount: order.pricing?.tip ?? order.delivery?.tip_amount ?? 0,
        status: order.status
      });
    });

    // Sort each slot by zip code (for route optimization)
    Object.keys(manifest).forEach(slot => {
      manifest[slot].sort((a, b) => {
        const zipA = a.address?.zip || '';
        const zipB = b.address?.zip || '';
        return zipA.localeCompare(zipB);
      });
    });

    const summary = {
      date,
      total_deliveries: orders.length,
      by_time_slot: {
        morning: manifest.morning.length,
        afternoon: manifest.afternoon.length,
        evening: manifest.evening.length
      }
    };

    // Return JSON or CSV
    if (format === 'csv') {
      const csv = generateManifestCSV(manifest, summary);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="delivery-manifest-${date}-${Date.now()}.csv"`);
      return res.send(csv);
    }

    res.json({
      ok: true,
      farm_id: farmId,
      manifest,
      summary
    });

  } catch (error) {
    console.error('[farm-sales] Delivery manifest generation failed:', error);
    res.status(500).json({
      ok: false,
      error: 'generation_failed',
      message: error.message
    });
  }
});

/**
 * Escape a CSV field value (wrap in quotes if it contains commas, quotes, or newlines)
 */
function csvEscape(val) {
  const s = String(val == null ? '' : val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Helper: Generate pick list CSV
 */
function generatePickListCSV(pickList, summary) {
  const rows = [
    ['PICK LIST'],
    [`Generated: ${new Date().toISOString()}`],
    [`Total Orders: ${summary.total_orders}, Total Items: ${summary.total_items}, Total Units: ${summary.total_units}`],
    [],
    ['Category', 'SKU', 'Product Name', 'Unit', 'Total Qty', 'Orders']
  ];

  pickList.forEach(item => {
    rows.push([
      item.category,
      item.sku_id,
      item.name,
      item.unit,
      item.total_quantity,
      item.orders.map(o => `${o.order_id} (${o.quantity})`).join('; ')
    ]);
  });

  return rows.map(row => row.map(csvEscape).join(',')).join('\n');
}

/**
 * Helper: Generate pack list CSV
 */
function generatePackListCSV(packList, summary) {
  const rows = [
    ['PACK LIST'],
    [`Generated: ${new Date().toISOString()}`],
    [`Total Orders: ${summary.total_orders}, Total Units: ${summary.total_units}`],
    [],
    ['Order ID', 'Customer', 'Email', 'Phone', 'Channel', 'SKU', 'Product', 'Qty', 'Unit', 'Notes']
  ];

  packList.forEach(order => {
    order.items.forEach((item, idx) => {
      rows.push([
        idx === 0 ? order.order_id : '',
        idx === 0 ? order.customer.name : '',
        idx === 0 ? order.customer.email || '' : '',
        idx === 0 ? order.customer.phone || '' : '',
        idx === 0 ? order.channel : '',
        item.sku_id,
        item.name,
        item.quantity,
        item.unit,
        idx === 0 ? order.notes || '' : ''
      ]);
    });
    rows.push([]); // Blank line between orders
  });

  return rows.map(row => row.map(csvEscape).join(',')).join('\n');
}

/**
 * Helper: Generate delivery manifest CSV
 */
function generateManifestCSV(manifest, summary) {
  const rows = [
    ['DELIVERY MANIFEST'],
    [`Date: ${summary.date}`],
    [`Total Deliveries: ${summary.total_deliveries}`],
    [],
    ['Time Slot', 'Order ID', 'Customer', 'Phone', 'Street', 'City', 'State', 'Zip', 'Items', 'Delivery Fee', 'Tip', 'Instructions']
  ];

  ['morning', 'afternoon', 'evening'].forEach(slot => {
    if (manifest[slot].length > 0) {
      manifest[slot].forEach(delivery => {
        rows.push([
          slot.toUpperCase(),
          delivery.order_id,
          delivery.customer.name,
          delivery.customer.phone || '',
          delivery.address?.street || '',
          delivery.address?.city || '',
          delivery.address?.state || '',
          delivery.address?.zip || '',
          delivery.items_count,
          delivery.delivery_fee != null ? `$${Number(delivery.delivery_fee).toFixed(2)}` : '$0.00',
          delivery.tip_amount != null ? `$${Number(delivery.tip_amount).toFixed(2)}` : '$0.00',
          delivery.instructions || ''
        ]);
      });
    }
  });

  return rows.map(row => row.map(csvEscape).join(',')).join('\n');
}

export default router;
