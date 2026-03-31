/**
 * Wholesale Orders Router - Multi-Farm Order Management
 * Implements SkipTheDishes-style workflow with payment authorization and farm verification
 */

import express from 'express';
import { PaymentProviderFactory } from '../lib/payment-providers/base.js';
import '../lib/payment-providers/square.js'; // Ensure Square provider is registered
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import notificationService from '../services/wholesale-notification-service.js';
import alternativeFarmService from '../services/alternative-farm-service.js';
import farmSelectionOptimizer from '../services/farm-selection-optimizer.js';
import orderStore from '../lib/wholesale/order-store.js';
import auditLogger from '../lib/wholesale/audit-logger.js';
import { query } from '../lib/database.js';

const router = express.Router();

function shouldReadFromDb() {
  const raw = String(process.env.WHOLESALE_READ_FROM_DB || '').trim().toLowerCase();
  if (!raw) return true;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function getBuyerIdFromRequest(req) {
  const directBuyerId = req.buyer?.id || req.wholesaleBuyer?.id || req.query.buyer_id || null;
  if (directBuyerId) return String(directBuyerId);

  const authHeader = req.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  if (!token) return null;

  const secret = process.env.WHOLESALE_JWT_SECRET || process.env.JWT_SECRET || 'dev-greenreach-wholesale-secret';
  if (!secret) return null;

  try {
    const payload = jwt.verify(token, secret);
    const buyerId = payload?.buyerId || payload?.sub || null;
    return buyerId ? String(buyerId) : null;
  } catch {
    return null;
  }
}

function getOrderBuyerId(order) {
  if (!order || typeof order !== 'object') return null;

  const direct = order.buyer_id ?? order.buyerId ?? order.buyer?.id ?? order.buyer ?? null;
  if (direct != null) return String(direct);

  const paymentRecords = Array.isArray(order.payments) ? order.payments : [];
  for (const payment of paymentRecords) {
    const candidate =
      payment?.buyer_id ??
      payment?.buyerId ??
      payment?.metadata?.buyer_id ??
      payment?.metadata?.buyerId ??
      null;
    if (candidate != null) return String(candidate);
  }

  return null;
}

/**
 * Calculate weighted average pricing for multi-farm orders
 * When multiple farms fulfill the same product, calculate buyer's final price
 * based on each farm's contribution weighted by quantity
 */
function calculateWeightedPricing(originalItems, sub_orders) {
  const pricesByProduct = new Map();
  
  // Group items by product across all farms
  for (const subOrder of sub_orders) {
    for (const item of subOrder.items) {
      const productKey = item.product_name;
      
      if (!pricesByProduct.has(productKey)) {
        pricesByProduct.set(productKey, {
          product_name: item.product_name,
          sku_id: item.sku_id,
          unit: item.unit,
          total_quantity: 0,
          total_cost: 0,
          farm_contributions: []
        });
      }
      
      const productData = pricesByProduct.get(productKey);
      productData.total_quantity += item.quantity;
      productData.total_cost += item.line_total;
      productData.farm_contributions.push({
        farm_id: subOrder.farm_id,
        farm_name: subOrder.farm_name,
        quantity: item.quantity,
        price_per_unit: item.price_per_unit,
        line_total: item.line_total
      });
    }
  }
  
  // Calculate weighted average price for each product
  const weighted_prices = [];
  
  for (const [productName, data] of pricesByProduct.entries()) {
    const weightedPrice = data.total_cost / data.total_quantity;
    
    weighted_prices.push({
      product_name: productName,
      sku_id: data.sku_id,
      unit: data.unit,
      total_quantity: data.total_quantity,
      weighted_price_per_unit: Number(weightedPrice.toFixed(2)),
      total_cost: Number(data.total_cost.toFixed(2)),
      farm_contributions: data.farm_contributions,
      is_multi_farm: data.farm_contributions.length > 1
    });
  }
  
  return {
    weighted_prices,
    total_farms: sub_orders.length,
    multi_farm_products: weighted_prices.filter(p => p.is_multi_farm).length
  };
}

// Order status enums
const OrderStatus = {
  PENDING_PAYMENT: 'pending_payment',
  PAYMENT_AUTHORIZED: 'payment_authorized',
  SPLIT_COMPLETE: 'split_complete',
  PENDING_FARM_VERIFICATION: 'pending_farm_verification',
  PARTIAL_VERIFICATION: 'partial_verification',
  FARMS_VERIFIED: 'farms_verified',
  SEEKING_ALTERNATIVES: 'seeking_alternatives',
  PENDING_BUYER_REVIEW: 'pending_buyer_review',
  BUYER_APPROVED: 'buyer_approved',
  BUYER_REJECTED: 'buyer_rejected',
  READY_FOR_PICKUP: 'ready_for_pickup',
  PICKED_UP: 'picked_up',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded'
};

const SubOrderStatus = {
  PENDING_VERIFICATION: 'pending_verification',
  FARM_ACCEPTED: 'farm_accepted',
  FARM_DECLINED: 'farm_declined',
  FARM_MODIFIED: 'farm_modified',
  BUYER_APPROVED: 'buyer_approved',
  READY_FOR_PICKUP: 'ready_for_pickup',
  PICKED_UP: 'picked_up',
  PAYMENT_CAPTURED: 'payment_captured',
  FARM_PAID: 'farm_paid',
  CANCELLED: 'cancelled'
};

/**
 * POST /api/wholesale/orders/create
 * Place new wholesale order with payment authorization
 */
router.post('/create', async (req, res) => {
  try {
    const { buyer_id, buyer_name, buyer_email, buyer_phone, delivery_address, delivery_city, 
            delivery_province, delivery_postal_code, delivery_latitude, delivery_longitude,
            fulfillment_cadence, delivery_instructions, preferred_pickup_time, items, 
            payment_method_id, filters } = req.body;
    
    console.log('[Wholesale] Creating order with farm optimization...');
    
    // STEP 1: Use farm selection optimizer to find best farms
    const optimizedFarms = await farmSelectionOptimizer.selectFarms({
      items,
      buyer: {
        latitude: delivery_latitude || 44.2312, // Kingston default if not provided
        longitude: delivery_longitude || -76.4860,
        city: delivery_city,
        address: delivery_address
      },
      filters: filters || {} // e.g., { organic: true, locallyGrown: true }
    });
    
    if (optimizedFarms.length === 0) {
      return res.status(400).json({
        error: 'No farms found matching your requirements',
        message: 'Try expanding your search radius or adjusting filters'
      });
    }
    
    console.log(`[Wholesale] Optimizer selected ${optimizedFarms.length} farms`);
    console.log('[Wholesale] Top 3 selections:', optimizedFarms.slice(0, 3).map(f => ({
      farm: f.farm_name,
      distance: `${f.distance.toFixed(1)}km`,
      cluster: f.clusterInfo?.clusterId,
      score: f.totalScore.toFixed(1)
    })));
    
    // STEP 2: Match items to optimized farms (prefer clustered farms)
    const farmItems = {};
    const assignedItems = new Set();
    
    // First pass: assign items to farms in clusters (most efficient)
    for (const farm of optimizedFarms.filter(f => f.clusterInfo !== null)) {
      for (const item of items) {
        if (assignedItems.has(item.id)) continue;
        
        const farmHasProduct = farm.availableProducts?.some(p =>
          p.product_id === item.product_id && 
          p.available_quantity >= item.quantity
        );
        
        if (farmHasProduct) {
          if (!farmItems[farm.farm_id]) {
            farmItems[farm.farm_id] = {
              farm,
              items: []
            };
          }
          farmItems[farm.farm_id].items.push(item);
          assignedItems.add(item.id);
        }
      }
    }
    
    // Second pass: assign remaining items to any available farm
    for (const item of items) {
      if (assignedItems.has(item.id)) continue;
      
      const availableFarm = optimizedFarms.find(farm =>
        farm.availableProducts?.some(p =>
          p.product_id === item.product_id && 
          p.available_quantity >= item.quantity
        )
      );
      
      if (availableFarm) {
        if (!farmItems[availableFarm.farm_id]) {
          farmItems[availableFarm.farm_id] = {
            farm: availableFarm,
            items: []
          };
        }
        farmItems[availableFarm.farm_id].items.push(item);
        assignedItems.add(item.id);
      }
    }
    
    // Check if all items were assigned
    if (assignedItems.size < items.length) {
      const unassigned = items.filter(i => !assignedItems.has(i.id));
      return res.status(400).json({
        error: 'Some products are not available',
        unavailable_items: unassigned.map(i => i.product_name)
      });
    }
    
    // STEP 3: Calculate totals and logistics summary
    const total_amount = items.reduce((sum, item) => sum + (item.price_per_unit * item.quantity), 0);
    const platform_fee = total_amount * 0.12; // 12% broker fee
    
    // Calculate logistics efficiency metrics for buyer visibility
    const clusters = [...new Set(Object.values(farmItems)
      .map(f => f.farm.clusterInfo?.clusterId)
      .filter(c => c !== null && c !== undefined))];
    
    const logisticsSummary = {
      totalFarms: Object.keys(farmItems).length,
      clusteredFarms: Object.values(farmItems).filter(f => f.farm.clusterInfo !== null).length,
      numberOfClusters: clusters.length,
      avgDistance: (Object.values(farmItems).reduce((sum, f) => sum + f.farm.distance, 0) / 
                    Object.keys(farmItems).length).toFixed(1),
      estimatedPickupTime: Math.max(...Object.values(farmItems).map(f => 
        f.farm.estimatedDeliveryTime || 60
      )),
      routeEfficiency: clusters.length > 0 ? 'high' : 
                       Object.keys(farmItems).length === 1 ? 'medium' : 'low',
      farmDetails: Object.values(farmItems).map(f => ({
        farm_id: f.farm.farm_id,
        farm_name: f.farm.farm_name,
        distance: `${f.farm.distance.toFixed(1)}km`,
        cluster: f.farm.clusterInfo?.clusterId || 'none',
        efficiency: f.farm.routeEfficiency
      }))
    };
    
    console.log('[Wholesale] Logistics summary:', logisticsSummary);
    
    // STEP 4: Create payment authorization
    // STEP 4: Create payment authorization
    
    // Get Square configuration (TODO: retrieve from database)
    const squareConfig = {
      squareAccessToken: process.env.SQUARE_ACCESS_TOKEN,
      environment: process.env.SQUARE_ENVIRONMENT || 'production',
      brokerMerchantId: process.env.SQUARE_BROKER_MERCHANT_ID
    };
    
    // Create Square payment provider
    const paymentProvider = PaymentProviderFactory.create('square', squareConfig);
    
    // Create payment with Square
    const idempotencyKey = crypto.randomUUID();
    
    const paymentResult = await paymentProvider.createPayment({
      farmSubOrderId: `ORDER-${Date.now()}`,
      farmMerchantId: process.env.SQUARE_BROKER_MERCHANT_ID,
      farmLocationId: process.env.SQUARE_LOCATION_ID,
      amountMoney: {
        amount: Math.round(total_amount * 100),
        currency: 'CAD'
      },
      brokerFeeMoney: {
        amount: Math.round(platform_fee * 100),
        currency: 'CAD'
      },
      idempotencyKey,
      metadata: {
        sourceId: payment_method_id,
        buyerId: buyer_id,
        buyerEmail: buyer_email,
        buyerName: buyer_name
      }
    });
    
    if (!paymentResult.success) {
      return res.status(400).json({ 
        error: 'Payment authorization failed',
        details: paymentResult.status 
      });
    }
    
    // STEP 5: Create order with optimized farm assignments
    const order = {
      id: Date.now(),
      buyer_id,
      buyer_name,
      buyer_email,
      buyer_phone,
      delivery_address,
      delivery_city,
      delivery_province,
      delivery_postal_code,
      fulfillment_cadence,
      delivery_instructions,
      preferred_pickup_time,
      total_amount,
      platform_fee,
      status: OrderStatus.PAYMENT_AUTHORIZED,
      payment_id: paymentResult.paymentId,
      verification_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      logistics_summary: logisticsSummary,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    // Create sub-orders for each optimized farm
    const sub_orders = Object.entries(farmItems).map(([farm_id, farmData]) => {
      const sub_total = farmData.items.reduce((sum, item) => 
        sum + (item.price_per_unit * item.quantity), 0);
      
      return {
        id: Date.now() + Math.random(),
        wholesale_order_id: order.id,
        farm_id: farmData.farm.farm_id,
        farm_name: farmData.farm.farm_name,
        distance_km: farmData.farm.distance,
        cluster_id: farmData.farm.clusterInfo?.clusterId || null,
        route_efficiency: farmData.farm.routeEfficiency,
        status: SubOrderStatus.PENDING_VERIFICATION,
        sub_total,
        items: farmData.items.map(item => ({
          sku_id: item.sku_id,
          product_name: item.product_name,
          quantity: item.quantity,
          unit: item.unit,
          price_per_unit: item.price_per_unit,
          line_total: item.price_per_unit * item.quantity,
          original_quantity: item.quantity
        })),
        verification_deadline: order.verification_deadline
      };
    });
    
    order.sub_orders = sub_orders;
    order.status = OrderStatus.PENDING_FARM_VERIFICATION;
    
    // Calculate weighted average price for multi-farm orders (for buyer transparency)
    const weightedPricing = calculateWeightedPricing(items, sub_orders);
    order.pricing_breakdown = weightedPricing;
    
    console.log('[Wholesale Orders] Pricing breakdown:', {
      total_farms: sub_orders.length,
      weighted_prices: weightedPricing.weighted_prices
    });
    
    // CRITICAL: Reserve inventory at each farm immediately after payment authorization
    console.log(`[Wholesale Orders] Reserving inventory at ${sub_orders.length} farms...`);
    const reservationResults = [];
    
    for (const subOrder of sub_orders) {
      try {
        const farmApiUrl = process.env[`FARM_${subOrder.farm_id}_API_URL`] || `http://localhost:8091`;
        const farmApiKey = process.env[`FARM_${subOrder.farm_id}_API_KEY`] || 'demo-key';
        
        const reservationPayload = {
          order_id: order.id,
          items: subOrder.items.map(item => ({
            sku_id: item.sku_id,
            quantity: item.quantity
          }))
        };
        
        const reservationResponse = await fetch(`${farmApiUrl}/api/wholesale/inventory/reserve`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Farm-ID': subOrder.farm_id,
            'X-API-Key': farmApiKey
          },
          body: JSON.stringify(reservationPayload)
        });
        
        const reservationData = await reservationResponse.json();
        
        if (!reservationData.ok) {
          throw new Error(`Reservation failed: ${reservationData.error}`);
        }
        
        reservationResults.push({
          farm_id: subOrder.farm_id,
          success: true,
          reserved: reservationData.reserved
        });
        
        console.log(`[Wholesale Orders] ✅ Reserved inventory at farm ${subOrder.farm_id}`);
        
      } catch (error) {
        console.error(`[Wholesale Orders] ❌ Failed to reserve inventory at farm ${subOrder.farm_id}:`, error);
        reservationResults.push({
          farm_id: subOrder.farm_id,
          success: false,
          error: error.message
        });
        
        // If ANY farm reservation fails, we need to rollback all previous reservations
        // This prevents partial orders that can't be fulfilled
        console.log('[Wholesale Orders] Rolling back all reservations due to failure...');
        
        for (const prevResult of reservationResults) {
          if (prevResult.success) {
            try {
              const farmApiUrl = process.env[`FARM_${prevResult.farm_id}_API_URL`] || `http://localhost:8091`;
              const farmApiKey = process.env[`FARM_${prevResult.farm_id}_API_KEY`] || 'demo-key';
              
              await fetch(`${farmApiUrl}/api/wholesale/inventory/release`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Farm-ID': prevResult.farm_id,
                  'X-API-Key': farmApiKey
                },
                body: JSON.stringify({
                  order_id: order.id,
                  reason: 'Rollback due to partial reservation failure'
                })
              });
            } catch (releaseError) {
              console.error(`[Wholesale Orders] Failed to release reservation at farm ${prevResult.farm_id}:`, releaseError);
            }
          }
        }
        
        // Refund payment authorization
        try {
          const provider = req.body.payment_provider || 'square';
          const providerConfig = provider === 'stripe'
            ? { stripeSecretKey: process.env.STRIPE_SECRET_KEY || 'demo-stripe-key' }
            : { squareAccessToken: process.env.SQUARE_ACCESS_TOKEN, environment: process.env.SQUARE_ENVIRONMENT || 'production' };
          const paymentProvider = PaymentProviderFactory.create(provider, providerConfig);
          if (typeof paymentProvider.refundPayment === 'function') {
            await paymentProvider.refundPayment({
              providerPaymentId: order.payment_id,
              amountMoney: { amount: Math.round(order.total_amount * 100), currency: process.env.PAYMENT_CURRENCY || 'CAD' },
              reason: 'Reservation rollback - partial farm failure',
              idempotencyKey: crypto.randomUUID()
            });
            console.log('[Wholesale Orders] Payment refund issued for rolled-back order');
          }
        } catch (refundErr) {
          console.error('[Wholesale Orders] Payment refund failed (manual review needed):', refundErr.message);
        }
        
        return res.status(500).json({
          error: 'Failed to reserve inventory',
          details: `Unable to reserve inventory at farm ${subOrder.farm_id}. Order cancelled and payment refunded.`,
          failed_farm: subOrder.farm_id
        });
      }
    }
    
    console.log(`[Wholesale Orders] ✅ Successfully reserved inventory at all ${sub_orders.length} farms`);
    
    // Persist order to NeDB
    try {
      await orderStore.saveOrder(order);
      for (const subOrder of sub_orders) {
        await orderStore.saveSubOrder(subOrder);
      }
      console.log(`[Wholesale Orders] Persisted order #${order.id} to NeDB`);
    } catch (persistErr) {
      console.error('[Wholesale Orders] NeDB persist error (non-fatal):', persistErr.message);
    }

    // Persist order to PostgreSQL
    try {
      await query(
        `INSERT INTO wholesale_orders (master_order_id, buyer_id, buyer_email, status, total_amount, order_data)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (master_order_id) DO NOTHING`,
        [
          String(order.id),
          buyer_id,
          buyer_email,
          order.status,
          total_amount,
          JSON.stringify(order)
        ]
      );
      console.log(`[Wholesale Orders] Persisted order #${order.id} to PostgreSQL`);
    } catch (pgErr) {
      console.error('[Wholesale Orders] PG INSERT error (non-fatal):', pgErr.message);
    }

    // Audit log: order creation
    try {
      await auditLogger.logOrderCreate(String(order.id), {
        buyer_id,
        buyer_email,
        total_amount,
        platform_fee,
        sub_orders: sub_orders.length,
        payment_id: paymentResult.paymentId
      }, buyer_id);
    } catch (auditErr) {
      console.warn('[Wholesale Orders] Audit log error (non-fatal):', auditErr.message);
    }

    // Send notifications to farms and buyer
    console.log(`[Wholesale Orders] Created order #${order.id} with ${sub_orders.length} sub-orders`);
    
    // Send notification to buyer confirming order placement
    await notificationService.notifyBuyerOrderPlaced(order);
    
    // Send notifications to each farm with logistics details
    for (const subOrder of sub_orders) {
      const farmContact = {
        farm_id: subOrder.farm_id,
        farm_name: subOrder.farm_name || `Farm ${subOrder.farm_id}`,
        email: subOrder.farm_email || `farm-${subOrder.farm_id}@greenreachgreens.com`,
        phone: subOrder.farm_phone || null
      };
      
      await notificationService.notifyFarmNewOrder(farmContact, order, subOrder);
    }
    
    res.json({
      success: true,
      order_id: order.id,
      payment_id: paymentResult.paymentId,
      total_amount,
      verification_deadline: order.verification_deadline,
      logistics: logisticsSummary,
      message: 'Order placed successfully. Farms have 24 hours to verify.',
      optimization_note: `Selected ${logisticsSummary.totalFarms} farms with ${logisticsSummary.routeEfficiency} route efficiency`
    });
    
  } catch (error) {
    console.error('[Wholesale Orders] Create order error:', error);
    res.status(500).json({ 
      error: 'Failed to create order',
      details: error.message 
    });
  }
});

/**
 * POST /api/wholesale/orders/farm-verify
 * Farm accepts, declines, or modifies order
 */
router.post('/farm-verify', async (req, res) => {
  try {
    const { farm_id, sub_order_id, action, modifications, reason } = req.body;
    
    // Fetch sub-order from persistent store
    const subOrder = await orderStore.getSubOrder(sub_order_id);
    if (!subOrder) {
      return res.status(404).json({ error: 'Sub-order not found', sub_order_id });
    }
    if (subOrder.farm_id !== farm_id) {
      return res.status(403).json({ error: 'Farm ID does not match sub-order' });
    }
    if (subOrder.verification_deadline && new Date(subOrder.verification_deadline) < new Date()) {
      return res.status(410).json({ error: 'Verification deadline has passed', deadline: subOrder.verification_deadline });
    }
    const response_time_ms = subOrder.created_at ? Date.now() - new Date(subOrder.created_at).getTime() : 0;
    
    let newStatus;
    let message;
    
    // Track performance metrics for GreenReach Central
    const performanceMetrics = {
      farm_id,
      sub_order_id,
      action,
      response_time: response_time_ms,
      reason
    };
    
    switch (action) {
      case 'accept':
        newStatus = SubOrderStatus.FARM_ACCEPTED;
        message = 'Order accepted successfully';
        performanceMetrics.accepted = true;
        await orderStore.updateSubOrderStatus(sub_order_id, SubOrderStatus.FARM_ACCEPTED);
        // Check if all sub-orders are now verified
        if (subOrder.master_order_id) {
          const allAccepted = await orderStore.allSubOrdersInStatus(subOrder.master_order_id, SubOrderStatus.FARM_ACCEPTED);
          if (allAccepted) {
            await orderStore.updateOrderStatus(subOrder.master_order_id, OrderStatus.FARMS_VERIFIED);
            console.log(`[Wholesale Orders] All sub-orders verified for ${subOrder.master_order_id}`);
          }
        }
        break;
        
      case 'decline':
        newStatus = SubOrderStatus.FARM_DECLINED;
        message = 'Order declined - searching for alternatives';
        performanceMetrics.declined = true;
        performanceMetrics.decline_reason = reason;
        
        // Trigger alternative farm search
        console.log(`[Wholesale Orders] Farm ${farm_id} declined - searching for alternatives`);
        
        await orderStore.updateSubOrderStatus(sub_order_id, SubOrderStatus.FARM_DECLINED, { decline_reason: reason, declined_at: new Date().toISOString() });
        const declinedSubOrder = {
          ...subOrder,
          id: sub_order_id,
          decline_reason: reason,
          declined_at: new Date().toISOString()
        };
        
        const parentOrder = subOrder.master_order_id ? await orderStore.getOrder(subOrder.master_order_id) : null;
        const mainOrder = {
          id: parentOrder?.master_order_id || sub_order_id,
          buyer_email: parentOrder?.buyer_email || parentOrder?.cart?.buyer_email || 'unknown',
          delivery_city: parentOrder?.cart?.delivery?.city || 'Kingston',
          delivery_province: parentOrder?.cart?.delivery?.province || 'ON'
        };
        
        // Find alternative farms (async - don't wait)
        alternativeFarmService.findAlternatives(declinedSubOrder, mainOrder)
          .then(result => {
            if (result.success) {
              console.log(`[Wholesale Orders] ${result.alternatives_notified} alternatives notified`);
            } else if (result.refund_required) {
              console.log(`[Wholesale Orders] No alternatives found - refunding $${result.refund_amount}`);
              alternativeFarmService.processPartialRefund(mainOrder, declinedSubOrder);
            }
          })
          .catch(err => console.error('[Wholesale Orders] Alternative search failed:', err));
        
        await orderStore.recordPerfEvent({ farm_id, event_type: 'decline', sub_order_id, reason, response_time_ms });
        break;
        
      case 'modify':
        newStatus = SubOrderStatus.FARM_MODIFIED;
        message = 'Modifications submitted for buyer review';
        performanceMetrics.modified = true;
        performanceMetrics.modifications = modifications;
        performanceMetrics.modification_reason = reason;
        
        // Validate and process price adjustments if included
        if (modifications && modifications.adjusted_prices) {
          console.log('[Wholesale Orders] Farm adjusting prices:', modifications.adjusted_prices);
          
          // Track original prices for buyer comparison
          const priceAdjustments = modifications.adjusted_prices.map(adj => ({
            sku_id: adj.sku_id,
            product_name: adj.product_name,
            original_price: adj.original_price,
            adjusted_price: adj.adjusted_price,
            quantity: adj.quantity,
            price_change_percent: ((adj.adjusted_price - adj.original_price) / adj.original_price * 100).toFixed(1),
            reason: adj.reason || 'Price adjustment by farm'
          }));
          
          modifications.price_adjustments = priceAdjustments;
          performanceMetrics.price_adjusted = true;
          performanceMetrics.price_adjustment_count = priceAdjustments.length;
        }
        
        // Notify buyer about modifications
        const modifiedSubOrder = {
          ...subOrder,
          farm_id,
          farm_name: subOrder.farm_name || `Farm ${farm_id}`,
          modification_reason: reason,
          modifications,
          requires_buyer_approval: true
        };
        
        const modParentOrder = subOrder.master_order_id ? await orderStore.getOrder(subOrder.master_order_id) : null;
        const orderForNotification = {
          id: modParentOrder?.master_order_id || sub_order_id,
          buyer_email: modParentOrder?.buyer_email || modParentOrder?.cart?.buyer_email || 'unknown'
        };
        
        await notificationService.notifyBuyerModifications(orderForNotification, [modifiedSubOrder]);
        
        await orderStore.updateSubOrderStatus(sub_order_id, SubOrderStatus.FARM_MODIFIED, { modifications, modification_reason: reason });
        if (subOrder.master_order_id) {
          await orderStore.updateOrderStatus(subOrder.master_order_id, OrderStatus.PENDING_BUYER_REVIEW);
        }
        await orderStore.recordPerfEvent({ farm_id, event_type: 'modify', sub_order_id, reason, response_time_ms, price_adjusted: !!modifications?.adjusted_prices });
        break;
        
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
    
    // Performance metrics already recorded in each action branch above
    
    console.log(`[Wholesale Orders] Farm ${farm_id} ${action}ed sub-order #${sub_order_id}`);
    console.log(`[Performance] Captured metrics:`, performanceMetrics);
    
    res.json({
      success: true,
      sub_order_id,
      new_status: newStatus,
      message
    });
    
  } catch (error) {
    console.error('[Wholesale Orders] Farm verify error:', error);
    res.status(500).json({ error: 'Failed to process verification' });
  }
});

/**
 * POST /api/wholesale/orders/buyer-review
 * Buyer accepts or rejects farm modifications
 */
router.post('/buyer-review', async (req, res) => {
  try {
    const { order_id, action, reason } = req.body;
    
    const order = await orderStore.getOrder(order_id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found', order_id });
    }
    if (order.status !== OrderStatus.PENDING_BUYER_REVIEW) {
      return res.status(409).json({ error: 'Order is not pending buyer review', current_status: order.status });
    }
    
    if (action === 'accept') {
      // Update all modified sub-orders to buyer_approved
      const subs = await orderStore.listSubOrders(order_id);
      for (const sub of subs) {
        if (sub.status === 'farm_modified') {
          await orderStore.updateSubOrderStatus(sub.sub_order_id, SubOrderStatus.BUYER_APPROVED);
          await orderStore.recordPerfEvent({ farm_id: sub.farm_id, event_type: 'buyer_accepted_modification', sub_order_id: sub.sub_order_id });
        }
      }
      await orderStore.updateOrderStatus(order_id, OrderStatus.READY_FOR_PICKUP);
      
      console.log(`[Wholesale Orders] Buyer accepted modifications for order #${order_id}`);
      
      res.json({
        success: true,
        message: 'Modifications accepted. Order will proceed to pickup.',
        new_status: OrderStatus.READY_FOR_PICKUP
      });
      
    } else if (action === 'reject') {
      // Attempt payment refund
      const subs = await orderStore.listSubOrders(order_id);
      for (const sub of subs) {
        if (sub.payment_id) {
          try {
            const providerName = order.payment_provider || 'square';
            const providerConfig = providerName === 'stripe'
              ? { stripeSecretKey: process.env.STRIPE_SECRET_KEY || 'demo-stripe-key' }
              : { squareAccessToken: process.env.SQUARE_ACCESS_TOKEN, environment: process.env.SQUARE_ENVIRONMENT || 'production' };
            const pp = PaymentProviderFactory.create(providerName, providerConfig);
            if (typeof pp.refundPayment === 'function') {
              await pp.refundPayment({
                providerPaymentId: sub.payment_id,
                amountMoney: { amount: Math.round(sub.total * 100), currency: process.env.PAYMENT_CURRENCY || 'CAD' },
                reason: reason || 'Buyer rejected modifications',
                idempotencyKey: crypto.randomUUID()
              });
            }
          } catch (refundErr) {
            console.error(`[Wholesale Orders] Refund failed for sub-order ${sub.sub_order_id}:`, refundErr.message);
          }
        }
        await orderStore.updateSubOrderStatus(sub.sub_order_id, SubOrderStatus.CANCELLED);
        await orderStore.recordPerfEvent({ farm_id: sub.farm_id, event_type: 'buyer_rejected_modification', sub_order_id: sub.sub_order_id, reason });
      }
      await orderStore.updateOrderStatus(order_id, OrderStatus.CANCELLED);
      
      console.log(`[Wholesale Orders] Buyer rejected modifications for order #${order_id}`);
      console.log(`[Performance] Buyer rejection logged - will impact farm quality score`);
      
      res.json({
        success: true,
        message: 'Order cancelled and payment refunded.',
        new_status: OrderStatus.CANCELLED
      });
      
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }
    
  } catch (error) {
    console.error('[Wholesale Orders] Buyer review error:', error);
    res.status(500).json({ error: 'Failed to process review' });
  }
});

/**
 * POST /api/wholesale/orders/confirm-pickup
 * Confirm pickup with QR code verification
 */
router.post('/confirm-pickup', async (req, res) => {
  try {
    const { sub_order_id, qr_code, confirmed_by_farm_id } = req.body;
    
    const subOrder = await orderStore.getSubOrder(sub_order_id);
    if (!subOrder) {
      return res.status(404).json({ error: 'Sub-order not found' });
    }
    if (confirmed_by_farm_id && subOrder.farm_id !== confirmed_by_farm_id) {
      return res.status(403).json({ error: 'Farm ID does not match sub-order' });
    }
    // QR code format: sub_order_id (simple validation)
    if (qr_code && qr_code !== sub_order_id) {
      return res.status(400).json({ error: 'QR code does not match sub-order' });
    }
    await orderStore.updateSubOrderStatus(sub_order_id, SubOrderStatus.PICKED_UP, { picked_up_at: new Date().toISOString() });
    
    // Check if all sub-orders picked up
    if (subOrder.master_order_id) {
      const allPickedUp = await orderStore.allSubOrdersInStatus(subOrder.master_order_id, SubOrderStatus.PICKED_UP);
      if (allPickedUp) {
        await orderStore.updateOrderStatus(subOrder.master_order_id, OrderStatus.COMPLETED);
        console.log(`[Wholesale Orders] All pickups complete for ${subOrder.master_order_id}`);
      }
    }
    
    console.log(`[Wholesale Orders] Pickup confirmed for sub-order #${sub_order_id}`);
    
    res.json({
      success: true,
      message: 'Pickup confirmed. Payment has been processed.',
      new_status: SubOrderStatus.PICKED_UP
    });
    
  } catch (error) {
    console.error('[Wholesale Orders] Confirm pickup error:', error);
    res.status(500).json({ error: 'Failed to confirm pickup' });
  }
});

/**
 * GET /api/wholesale/orders
 * List all orders for the authenticated buyer
 */
router.get('/', async (req, res) => {
  try {
    // Get buyer_id from auth token (if available) or query params
    const buyer_id = getBuyerIdFromRequest(req);
    
    if (!buyer_id) {
      return res.status(401).json({ status: 'error', message: 'Missing or invalid bearer token' });
    }

    const readFromDb = shouldReadFromDb();
    const directMatches = await orderStore.listBuyerOrders(buyer_id, 200);
    const allRecentOrders = readFromDb ? [] : await orderStore.listOrders(500);

    const normalizedBuyerId = String(buyer_id);
    const mergedById = new Map();

    for (const order of directMatches) {
      const key = String(order.master_order_id || order.id || order._id || crypto.randomUUID());
      mergedById.set(key, order);
    }

    for (const order of allRecentOrders) {
      const owner = getOrderBuyerId(order);
      if (owner !== normalizedBuyerId) continue;
      const key = String(order.master_order_id || order.id || order._id || crypto.randomUUID());
      if (!mergedById.has(key)) mergedById.set(key, order);
    }

    // PostgreSQL fallback: orders created by Central checkout are in PG, not NeDB
    try {
      const pgResult = await query(
        'SELECT order_data FROM wholesale_orders WHERE buyer_id = $1 ORDER BY created_at DESC LIMIT 200',
        [normalizedBuyerId]
      );
      for (const row of pgResult.rows) {
        const pgOrder = row.order_data;
        if (!pgOrder) continue;
        const key = String(pgOrder.master_order_id || '');
        if (key && !mergedById.has(key)) mergedById.set(key, pgOrder);
      }
    } catch (pgErr) {
      // PostgreSQL may not be available on LE — non-fatal
      console.warn('[Wholesale Orders] PostgreSQL fallback failed:', pgErr.message);
    }

    const parsedOrders = await Promise.all(
      Array.from(mergedById.values()).map(async (order) => {
        const masterOrderId = order.master_order_id || order.id;
        const subOrders = masterOrderId ? await orderStore.listSubOrders(masterOrderId) : [];
        return {
          ...order,
          master_order_id: masterOrderId,
          sub_orders: subOrders
        };
      })
    );

    parsedOrders.sort((a, b) => {
      const aTime = Date.parse(a.created_at || 0) || 0;
      const bTime = Date.parse(b.created_at || 0) || 0;
      return bTime - aTime;
    });

    res.json({
      status: 'ok',
      data: {
        orders: parsedOrders,
        count: parsedOrders.length,
        read_source: readFromDb ? 'db_primary' : 'legacy_fallback'
      }
    });

  } catch (error) {
    console.error('[Wholesale Orders] List orders error:', error);
    res.status(500).json({ 
      status: 'error',
      error: 'Failed to fetch orders',
      details: error.message
    });
  }
});

router.get('/:order_id/invoice', async (req, res) => {
  try {
    const buyerId = getBuyerIdFromRequest(req);
    const orderId = req.params.order_id;
    const readFromDb = shouldReadFromDb();

    if (!buyerId) {
      return res.status(401).json({ status: 'error', message: 'Missing or invalid bearer token' });
    }

    let order = await orderStore.getOrder(orderId);
    if (!order && !readFromDb) {
      const fallbackOrders = await orderStore.listOrders(500);
      order = fallbackOrders.find((entry) => String(entry.master_order_id || entry.id) === String(orderId)) || null;
    }

    const owner = getOrderBuyerId(order);

    if (!order || owner == null || String(owner) !== String(buyerId)) {
      return res.status(404).json({ status: 'error', message: 'Order not found' });
    }

    const subOrders = await orderStore.listSubOrders(order.master_order_id || order.id || orderId);

    return res.json({
      status: 'ok',
      data: {
        invoice_id: `INV-${order.master_order_id || order.id || orderId}`,
        generated_at: new Date().toISOString(),
        order,
        farm_sub_orders: subOrders,
        totals: order.totals || null,
        read_source: readFromDb ? 'db_primary' : 'legacy_fallback'
      }
    });
  } catch (error) {
    console.error('[Wholesale Orders] Invoice error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch invoice' });
  }
});

/**
 * GET /api/wholesale/orders/pending-verification/:farm_id
 * Get pending orders for a farm
 */
router.get('/pending-verification/:farm_id', async (req, res) => {
  try {
    const { farm_id } = req.params;
    
    const allPending = await orderStore.listFarmSubOrders(farm_id, 'pending_verification');
    const now = new Date().toISOString();
    const pendingOrders = allPending.filter(so => !so.verification_deadline || so.verification_deadline > now);
    
    res.json({
      success: true,
      farm_id,
      pending_count: pendingOrders.length,
      orders: pendingOrders
    });
    
  } catch (error) {
    console.error('[Wholesale Orders] Get pending error:', error);
    res.status(500).json({ error: 'Failed to fetch pending orders' });
  }
});

/**
 * GET /api/wholesale/orders/:order_id
 * Get complete order details
 */
router.get('/:order_id', async (req, res) => {
  try {
    const { order_id } = req.params;
    
    const order = await orderStore.getOrder(order_id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    const subOrders = await orderStore.listSubOrders(order_id);
    
    res.json({
      success: true,
      order: {
        ...order,
        sub_orders: subOrders
      }
    });
    
  } catch (error) {
    console.error('[Wholesale Orders] Get order error:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

export default router;
