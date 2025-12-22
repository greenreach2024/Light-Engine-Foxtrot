/**
 * Wholesale Orders Router - Multi-Farm Order Management
 * Implements SkipTheDishes-style workflow with payment authorization and farm verification
 */

import express from 'express';
import { PaymentProviderFactory } from '../lib/payment-providers/base.js';
import '../lib/payment-providers/square.js'; // Ensure Square provider is registered
import crypto from 'crypto';
import notificationService from '../services/wholesale-notification-service.js';
import alternativeFarmService from '../services/alternative-farm-service.js';

const router = express.Router();

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
            delivery_province, delivery_postal_code, fulfillment_cadence, delivery_instructions,
            preferred_pickup_time, items, payment_method_id } = req.body;
    
    // Calculate totals
    const total_amount = items.reduce((sum, item) => sum + (item.price_per_unit * item.quantity), 0);
    const platform_fee = total_amount * 0.10; // 10% platform fee
    
    // Get Square configuration (TODO: retrieve from database)
    const squareConfig = {
      squareAccessToken: process.env.SQUARE_ACCESS_TOKEN,
      environment: process.env.SQUARE_ENVIRONMENT || 'sandbox',
      brokerMerchantId: process.env.SQUARE_BROKER_MERCHANT_ID
    };
    
    // Create Square payment provider
    const paymentProvider = PaymentProviderFactory.create('square', squareConfig);
    
    // Create payment with Square
    // Note: Square doesn't support delayed capture like Stripe
    // Instead, we'll create the payment and track it for later fulfillment
    const idempotencyKey = crypto.randomUUID();
    
    const paymentResult = await paymentProvider.createPayment({
      farmSubOrderId: `ORDER-${Date.now()}`,
      farmMerchantId: process.env.SQUARE_BROKER_MERCHANT_ID, // Use broker for initial hold
      farmLocationId: process.env.SQUARE_LOCATION_ID,
      amountMoney: {
        amount: Math.round(total_amount * 100), // Convert to cents
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
    
    // Create order record (in production, use actual database)
    const order = {
      id: Date.now(), // Use proper ID generation in production
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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    // Split order by farm
    const farmItems = {};
    items.forEach(item => {
      if (!farmItems[item.farm_id]) {
        farmItems[item.farm_id] = [];
      }
      farmItems[item.farm_id].push(item);
    });
    
    // Create sub-orders for each farm
    const sub_orders = Object.entries(farmItems).map(([farm_id, farmItems]) => {
      const sub_total = farmItems.reduce((sum, item) => 
        sum + (item.price_per_unit * item.quantity), 0);
      
      return {
        id: Date.now() + Math.random(), // Use proper ID generation
        wholesale_order_id: order.id,
        farm_id,
        status: SubOrderStatus.PENDING_VERIFICATION,
        sub_total,
        items: farmItems.map(item => ({
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
    
    // Send notifications to farms and buyer
    console.log(`[Wholesale Orders] Created order #${order.id} with ${sub_orders.length} sub-orders`);
    
    // Send notification to buyer confirming order placement
    await notificationService.notifyBuyerOrderPlaced(order);
    
    // Send notifications to each farm with logistics details
    for (const subOrder of sub_orders) {
      // TODO: Fetch farm contact info from database
      const farmContact = {
        farm_id: subOrder.farm_id,
        farm_name: `Farm ${subOrder.farm_id}`, // Replace with actual lookup
        email: `farm${subOrder.farm_id}@example.com`, // Replace with actual lookup
        phone: null // Replace with actual lookup if available
      };
      
      await notificationService.notifyFarmNewOrder(farmContact, order, subOrder);
    }
    
    res.json({
      success: true,
      order_id: order.id,
      payment_id: paymentResult.paymentId,
      total_amount,
      verification_deadline: order.verification_deadline,
      message: 'Order placed successfully. Farms have 24 hours to verify.'
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
    
    const response_time = new Date(); // TODO: Calculate from order created_at
    
    // TODO: Fetch sub-order from database
    // TODO: Verify farm_id matches sub-order
    // TODO: Check deadline hasn't passed
    
    let newStatus;
    let message;
    
    // Track performance metrics for GreenReach Central
    const performanceMetrics = {
      farm_id,
      sub_order_id,
      action,
      response_time,
      reason
    };
    
    switch (action) {
      case 'accept':
        newStatus = SubOrderStatus.FARM_ACCEPTED;
        message = 'Order accepted successfully';
        performanceMetrics.accepted = true;
        // TODO: Check if all sub-orders verified -> update main order status
        break;
        
      case 'decline':
        newStatus = SubOrderStatus.FARM_DECLINED;
        message = 'Order declined - searching for alternatives';
        performanceMetrics.declined = true;
        performanceMetrics.decline_reason = reason;
        
        // Trigger alternative farm search
        console.log(`[Wholesale Orders] Farm ${farm_id} declined - searching for alternatives`);
        
        // TODO: Fetch full order and sub-order from database
        const declinedSubOrder = {
          id: sub_order_id,
          farm_id,
          farm_name: `Farm ${farm_id}`,
          sub_total: 0, // Get from database
          items: [],
          decline_reason: reason,
          declined_at: new Date().toISOString()
        };
        
        const mainOrder = {
          id: 1, // Get from database
          buyer_email: 'buyer@example.com', // Get from database
          delivery_city: 'Kingston',
          delivery_province: 'ON'
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
        
        // TODO: Track decline rate for farm performance
        break;
        
      case 'modify':
        newStatus = SubOrderStatus.FARM_MODIFIED;
        message = 'Modifications submitted for buyer review';
        performanceMetrics.modified = true;
        performanceMetrics.modifications = modifications;
        performanceMetrics.modification_reason = reason;
        
        // Notify buyer about modifications
        // TODO: Fetch full order details from database
        const modifiedSubOrder = {
          farm_id,
          farm_name: `Farm ${farm_id}`, // Replace with actual lookup
          modification_reason: reason,
          modifications
        };
        
        const orderForNotification = {
          id: sub_order_id, // Replace with actual order_id lookup
          buyer_email: 'buyer@example.com' // TODO: Get from order
        };
        
        await notificationService.notifyBuyerModifications(orderForNotification, [modifiedSubOrder]);
        
        // TODO: Save modifications
        // TODO: Update main order status to PENDING_BUYER_REVIEW
        // TODO: Track modification rate for farm performance
        break;
        
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
    
    // TODO: Save performance metrics to database for analytics
    // INSERT INTO farm_performance_events (farm_id, sub_order_id, action, response_time, ...)
    
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
    
    // TODO: Fetch order from database
    // TODO: Verify order has modifications pending review
    
    if (action === 'accept') {
      // TODO: Update sub-order quantities
      // TODO: Adjust payment if total changed (refund difference or charge additional)
      // TODO: Update order status to READY_FOR_PICKUP
      
      // Track buyer acceptance for farm performance
      // TODO: UPDATE farm_performance SET buyer_acceptance_count++
      
      console.log(`[Wholesale Orders] Buyer accepted modifications for order #${order_id}`);
      
      res.json({
        success: true,
        message: 'Modifications accepted. Order will proceed to pickup.',
        new_status: OrderStatus.READY_FOR_PICKUP
      });
      
    } else if (action === 'reject') {
      // Refund the Square payment
      // TODO: Get payment_id from order
      // const squareConfig = {...};
      // const paymentProvider = PaymentProviderFactory.create('square', squareConfig);
      // await paymentProvider.refundPayment({
      //   providerPaymentId: payment_id,
      //   amountMoney: { amount: total_amount * 100, currency: 'CAD' },
      //   reason: reason || 'Buyer rejected modifications',
      //   idempotencyKey: crypto.randomUUID()
      // });
      
      // Track buyer rejection for farm performance (negative metric)
      // TODO: UPDATE farm_performance SET buyer_rejection_count++, quality_score--
      // This is critical for GreenReach to track farms with high modification rejection rates
      
      // TODO: Update order status to CANCELLED
      // TODO: Notify farms
      
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
    
    // TODO: Verify QR code matches sub-order
    // TODO: Verify farm_id matches
    // TODO: Update sub-order status to PICKED_UP
    
    // TODO: Check if all sub-orders picked up -> payment already processed with Square
    // Square payments are captured immediately, unlike Stripe's delayed capture
    // Track payment status and process farm payouts after pickup
    
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
 * GET /api/wholesale/orders/pending-verification/:farm_id
 * Get pending orders for a farm
 */
router.get('/pending-verification/:farm_id', async (req, res) => {
  try {
    const { farm_id } = req.params;
    
    // TODO: Query database for sub-orders where:
    // - farm_id matches
    // - status = PENDING_VERIFICATION
    // - verification_deadline hasn't passed
    
    // Mock data for now
    const pendingOrders = [];
    
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
    
    // TODO: Fetch order with all sub-orders and line items
    
    res.json({
      success: true,
      order: {
        id: order_id,
        // ... order data
      }
    });
    
  } catch (error) {
    console.error('[Wholesale Orders] Get order error:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

export default router;
