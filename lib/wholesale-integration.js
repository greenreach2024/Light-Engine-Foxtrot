/**
 * GreenReach Wholesale Integration
 * Handles B2B order routing and inventory syncing for farm sales
 */

const GREENREACH_BASE_URL = process.env.GREENREACH_URL || 'http://localhost:8091';

/**
 * Check if order should be routed to wholesale marketplace
 * Returns true if any items exceed farm inventory
 * 
 * @param {Array} items - Order items [{sku_id, quantity}]
 * @param {Array} farmInventory - Farm inventory products
 * @returns {Object} { shouldRoute: boolean, insufficientItems: Array }
 */
export function shouldRouteToWholesale(items, farmInventory) {
  const insufficientItems = [];
  
  for (const item of items) {
    const product = farmInventory.find(p => p.sku_id === item.sku_id);
    
    if (!product) {
      // Product not found in farm inventory
      insufficientItems.push({
        sku_id: item.sku_id,
        requested: item.quantity,
        available: 0,
        reason: 'not_found'
      });
      continue;
    }
    
    if (product.available < item.quantity) {
      // Insufficient quantity
      insufficientItems.push({
        sku_id: item.sku_id,
        name: product.name,
        requested: item.quantity,
        available: product.available,
        shortage: item.quantity - product.available,
        reason: 'insufficient_quantity'
      });
    }
  }
  
  return {
    shouldRoute: insufficientItems.length > 0,
    insufficientItems,
    canFulfillLocally: insufficientItems.length === 0
  };
}

/**
 * Route B2B order to GreenReach wholesale marketplace
 * 
 * @param {Object} orderData - Order details
 * @param {string} farmId - Farm identifier
 * @param {string} authToken - Farm authentication token
 * @returns {Promise<Object>} Wholesale order result
 */
export async function routeToWholesale(orderData, farmId, authToken) {
  try {
    console.log('[Wholesale Integration] Routing B2B order to marketplace');
    console.log(`  Farm: ${farmId}`);
    console.log(`  Items: ${orderData.items.length}`);
    
    // Step 1: Preview allocation
    const previewResponse = await fetch(`${GREENREACH_BASE_URL}/api/wholesale/checkout/preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Farm-Id': farmId,
        'Authorization': authToken
      },
      body: JSON.stringify({
        cart: {
          items: orderData.items.map(item => ({
            sku_id: item.sku_id,
            qty: item.quantity,
            unit: item.unit || 'unit'
          })),
          delivery: {
            address: orderData.customer?.address || 'Farm pickup',
            delivery_date: orderData.delivery?.date || getDefaultDeliveryDate(),
            zip: orderData.customer?.zip || '00000'
          }
        },
        allocation_strategy: 'closest' // Prioritize nearby farms
      })
    });
    
    const previewData = await previewResponse.json();
    
    if (!previewData.ok) {
      throw new Error(`Wholesale preview failed: ${previewData.error}`);
    }
    
    console.log('[Wholesale Integration] Allocation preview:');
    console.log(`  Allocated: ${previewData.preview.allocated_items_count} items`);
    console.log(`  Total: $${previewData.preview.master_order.total}`);
    console.log(`  Farms involved: ${previewData.preview.sub_orders.length}`);
    
    // Check if order can be fulfilled
    if (previewData.preview.unallocated_items_count > 0) {
      return {
        ok: false,
        routed: true,
        error: 'partial_fulfillment',
        message: 'Some items unavailable in wholesale marketplace',
        allocated_items: previewData.preview.allocated_items_count,
        unallocated_items: previewData.preview.unallocated_items_count,
        preview: previewData.preview
      };
    }
    
    // Step 2: Execute checkout (if payment source provided)
    if (orderData.payment_source) {
      const checkoutResponse = await fetch(`${GREENREACH_BASE_URL}/api/wholesale/checkout/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Farm-Id': farmId,
          'Authorization': authToken
        },
        body: JSON.stringify({
          cart: {
            items: orderData.items.map(item => ({
              sku_id: item.sku_id,
              qty: item.quantity,
              unit: item.unit || 'unit'
            })),
            delivery: {
              address: orderData.customer?.address || 'Farm pickup',
              delivery_date: orderData.delivery?.date || getDefaultDeliveryDate(),
              zip: orderData.customer?.zip || '00000'
            }
          },
          buyer_id: orderData.buyer_id || farmId,
          payment_source: orderData.payment_source,
          allocation_strategy: 'closest'
        })
      });
      
      const checkoutData = await checkoutResponse.json();
      
      if (!checkoutData.ok) {
        throw new Error(`Wholesale checkout failed: ${checkoutData.error}`);
      }
      
      console.log('[Wholesale Integration] Checkout complete!');
      console.log(`  Master Order: ${checkoutData.master_order_id}`);
      console.log(`  Sub-orders: ${checkoutData.sub_orders.length}`);
      
      return {
        ok: true,
        routed: true,
        status: 'confirmed',
        master_order_id: checkoutData.master_order_id,
        sub_orders: checkoutData.sub_orders,
        totals: checkoutData.totals,
        receipt_url: checkoutData.receipt_url
      };
    }
    
    // Return preview only (no payment)
    return {
      ok: true,
      routed: true,
      status: 'preview',
      preview: previewData.preview,
      message: 'Provide payment_source to complete checkout'
    };
    
  } catch (error) {
    console.error('[Wholesale Integration] Routing failed:', error);
    return {
      ok: false,
      routed: true,
      error: 'routing_failed',
      message: error.message
    };
  }
}

/**
 * Sync farm inventory to wholesale catalog
 * Converts farm-sales inventory to wholesale lot format
 * 
 * @param {string} farmId - Farm identifier
 * @param {Array} inventory - Farm inventory products
 * @returns {Object} Wholesale inventory format
 */
export function convertToWholesaleLots(farmId, inventory) {
  const lots = [];
  const timestamp = new Date().toISOString();
  
  for (const product of inventory) {
    if (product.available <= 0) continue; // Skip out-of-stock items
    
    lots.push({
      lot_id: `LOT-${farmId}-${product.sku_id}`,
      sku_id: product.sku_id,
      sku_name: product.name,
      qty_available: product.available,
      qty_reserved: 0, // Managed by wholesale reservation system
      unit: product.unit,
      pack_size: product.pack_size || 1,
      price_per_unit: product.wholesale_price || product.retail_price * 0.70, // 30% discount
      harvest_date_start: new Date().toISOString(), // Available now
      harvest_date_end: new Date(Date.now() + 48*60*60*1000).toISOString(), // 48hr window
      quality_flags: product.certifications || [],
      location: product.location || 'Farm Storage',
      category: product.category,
      description: product.description
    });
  }
  
  return {
    farm_id: farmId,
    farm_name: getFarmName(farmId),
    inventory_timestamp: timestamp,
    lots
  };
}

/**
 * Get farm name from farm_id
 * @param {string} farmId - Farm identifier
 * @returns {string} Farm name
 */
function getFarmName(farmId) {
  const farmNames = {
    'FARM-001': 'Sunrise Acres',
    'FARM-002': 'Green Valley Farm',
    'FARM-003': 'Urban Harvest Co-op'
  };
  return farmNames[farmId] || `Farm ${farmId}`;
}

/**
 * Get default delivery date (2 days from now)
 * @returns {string} ISO date string
 */
function getDefaultDeliveryDate() {
  const date = new Date();
  date.setDate(date.getDate() + 2);
  return date.toISOString().split('T')[0];
}

/**
 * Get sub-order status from GreenReach
 * 
 * @param {string} masterOrderId - Master order identifier
 * @param {string} authToken - Farm authentication token
 * @returns {Promise<Array>} Sub-order details
 */
export async function getSubOrders(masterOrderId, authToken) {
  try {
    const response = await fetch(`${GREENREACH_BASE_URL}/api/wholesale/orders/${masterOrderId}`, {
      headers: {
        'Authorization': authToken
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch order: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.ok || !data.order) {
      throw new Error('Invalid order response');
    }
    
    return data.order.allocation.sub_orders.map((subOrder, idx) => ({
      sub_order_id: `SO-${masterOrderId}-${subOrder.farm_id}`,
      farm_id: subOrder.farm_id,
      farm_name: subOrder.farm_name,
      status: 'pending', // TODO: Fetch from fulfillment API
      line_items: subOrder.line_items,
      subtotal: subOrder.subtotal,
      broker_fee: subOrder.broker_fee_amount,
      total: subOrder.total,
      payment_id: data.order.payments[idx]?.payment_id
    }));
    
  } catch (error) {
    console.error('[Wholesale Integration] Failed to fetch sub-orders:', error);
    return [];
  }
}
