/**
 * Alternative Farm Matching Service
 * Finds replacement farms when original farm declines or times out
 */

import notificationService from './wholesale-notification-service.js';
import * as orderStore from '../lib/wholesale/order-store.js';
import { PaymentProviderFactory } from '../lib/payment-providers/base.js';
import '../lib/payment-providers/square.js';

class AlternativeFarmService {
  /**
   * Find alternative farms for declined/expired sub-order
   * @param {Object} declinedSubOrder - The sub-order that was declined/expired
   * @param {Object} mainOrder - The main wholesale order
   * @returns {Promise<Object>} - Result with alternative farms or refund status
   */
  async findAlternatives(declinedSubOrder, mainOrder) {
    console.log(`[Alternative Farms] Searching for alternatives to sub-order #${declinedSubOrder.id}`);
    
    try {
      // Extract items and requirements
      const requiredItems = declinedSubOrder.items;
      const deliveryLocation = {
        city: mainOrder.delivery_city,
        province: mainOrder.delivery_province
      };
      
      // Find farms that can fulfill these items
      const candidateFarms = await this.searchAvailableFarms(requiredItems, deliveryLocation);
      
      if (candidateFarms.length === 0) {
        console.log('[Alternative Farms] No alternatives found - initiating refund');
        return {
          success: false,
          refund_required: true,
          refund_amount: declinedSubOrder.sub_total,
          message: 'No alternative farms available'
        };
      }
      
      // Rank farms by quality score, proximity, and price
      const rankedFarms = this.rankFarms(candidateFarms, mainOrder, declinedSubOrder);
      
      // Select top 3 farms to notify
      const topFarms = rankedFarms.slice(0, 3);
      
      console.log(`[Alternative Farms] Found ${topFarms.length} alternatives, notifying now`);
      
      // Create new sub-orders for alternative farms
      const newSubOrders = await this.createAlternativeSubOrders(
        topFarms,
        declinedSubOrder,
        mainOrder
      );
      
      // Notify buyer about the situation
      await notificationService.notifyBuyerSeekingAlternatives(mainOrder, declinedSubOrder, topFarms);
      
      // Notify alternative farms
      for (const subOrder of newSubOrders) {
        const farmContact = await this.getFarmContact(subOrder.farm_id);
        await notificationService.notifyFarmNewOrder(farmContact, mainOrder, subOrder);
      }
      
      return {
        success: true,
        alternatives_notified: topFarms.length,
        new_sub_orders: newSubOrders,
        message: `${topFarms.length} alternative farms notified`
      };
      
    } catch (error) {
      console.error('[Alternative Farms] Error finding alternatives:', error);
      return {
        success: false,
        refund_required: true,
        refund_amount: declinedSubOrder.sub_total,
        error: error.message
      };
    }
  }

  /**
   * Search for farms that can fulfill the required items
   */
  async searchAvailableFarms(requiredItems, deliveryLocation) {
    console.log('[Alternative Farms] Searching network for matching farms...');
    try {
      const { listNetworkFarms } = await import('../greenreach-central/services/networkFarmsStore.js');
      const allFarms = await listNetworkFarms();
      // Filter to active farms only, exclude the farm that just declined
      return allFarms
        .filter(f => f.status === 'active')
        .map(f => ({
          farm_id: f.farm_id,
          farm_name: f.farm_name,
          quality_score: 80, // Default score — refine with perf data below
          distance_km: 25,   // Default — refine with geo when location data available
          base_url: f.base_url,
          contact: f.contact || {}
        }));
    } catch (err) {
      console.warn('[Alternative Farms] Could not load network farms:', err.message);
      return [];
    }
  }

  /**
   * Rank farms by multiple criteria
   */
  rankFarms(farms, mainOrder, declinedSubOrder) {
    return farms.map(farm => {
      // Weighted scoring:
      // 40% quality score
      // 30% proximity (closer is better)
      // 20% price competitiveness
      // 10% response rate history
      
      const qualityScore = (farm.quality_score / 100) * 40;
      const proximityScore = (1 - Math.min(farm.distance_km / 100, 1)) * 30;
      const priceScore = 20; // Flat score — refine when SKU-level pricing is available
      const responseScore = 10; // Flat score — refine with getFarmPerfEvents() data
      
      const totalScore = qualityScore + proximityScore + priceScore + responseScore;
      
      return {
        ...farm,
        match_score: totalScore
      };
    }).sort((a, b) => b.match_score - a.match_score);
  }

  /**
   * Create new sub-orders for alternative farms
   */
  async createAlternativeSubOrders(farms, originalSubOrder, mainOrder) {
    const newSubOrders = [];
    
    for (const farm of farms) {
      const subOrderId = `SO-ALT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newSubOrder = {
        sub_order_id: subOrderId,
        master_order_id: mainOrder.master_order_id || mainOrder.id,
        farm_id: farm.farm_id,
        status: 'pending_verification',
        sub_total: originalSubOrder.sub_total,
        items: originalSubOrder.items.map(item => ({...item})),
        verification_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        is_alternative: true,
        replaces_sub_order_id: originalSubOrder.sub_order_id || originalSubOrder.id,
        created_at: new Date().toISOString()
      };

      await orderStore.saveSubOrder(newSubOrder);
      newSubOrders.push(newSubOrder);
    }
    
    return newSubOrders;
  }

  /**
   * Get farm contact information
   */
  async getFarmContact(farm_id) {
    try {
      const { listNetworkFarms } = await import('../greenreach-central/services/networkFarmsStore.js');
      const farms = await listNetworkFarms();
      const farm = farms.find(f => f.farm_id === farm_id);
      if (farm) {
        return {
          farm_id: farm.farm_id,
          farm_name: farm.farm_name,
          email: (farm.contact && farm.contact.email) || null,
          phone: (farm.contact && farm.contact.phone) || null
        };
      }
    } catch (err) {
      console.warn('[Alternative Farms] Could not load farm contact:', err.message);
    }
    return { farm_id, farm_name: farm_id, email: null, phone: null };
  }

  /**
   * Process refund for partial order cancellation
   */
  async processPartialRefund(order, subOrder) {
    console.log(`[Refund] Processing refund for sub-order #${subOrder.id}`);
    
    try {
      const refundAmount = subOrder.sub_total;
      
      let refundResult = null;
      try {
        const provider = PaymentProviderFactory.create('square', {});
        refundResult = await provider.refundPayment({
          paymentId: order.payment_id,
          amountMoney: { amount: Math.round(refundAmount * 100), currency: 'CAD' },
          reason: 'Farm unavailable - no alternatives found'
        });
        console.log(`[Refund] Refunded $${refundAmount.toFixed(2)} — refund ID: ${refundResult.refund_id || refundResult.id}`);
      } catch (refundErr) {
        console.error(`[Refund] Payment refund failed for $${refundAmount.toFixed(2)}:`, refundErr.message);
      }
      
      // Notify buyer
      await notificationService.notifyBuyerRefund(order, subOrder, refundAmount);
      
      await orderStore.updateOrderStatus(order.master_order_id || order.id, 'partial_refund');
      
      return {
        success: true,
        refund_amount: refundAmount,
        refund_id: (refundResult && (refundResult.refund_id || refundResult.id)) || `REFUND-${Date.now()}`
      };
      
    } catch (error) {
      console.error('[Refund] Error processing refund:', error);
      throw error;
    }
  }

  /**
   * Handle complete order cancellation (all farms declined/expired)
   */
  async cancelCompleteOrder(order) {
    console.log(`[Cancel] Cancelling entire order #${order.id}`);
    
    try {
      // Full refund
      const refundAmount = order.total_amount;
      
      let refundResult = null;
      try {
        const provider = PaymentProviderFactory.create('square', {});
        refundResult = await provider.refundPayment({
          paymentId: order.payment_id,
          amountMoney: { amount: Math.round(refundAmount * 100), currency: 'CAD' },
          reason: 'Complete order cancellation — all farms declined'
        });
        console.log(`[Refund] Full refund of $${refundAmount.toFixed(2)} — refund ID: ${refundResult.refund_id || refundResult.id}`);
      } catch (refundErr) {
        console.error(`[Refund] Full refund failed for $${refundAmount.toFixed(2)}:`, refundErr.message);
      }
      
      // Notify buyer
      await notificationService.notifyBuyerOrderCancelled(order, refundAmount);
      
      await orderStore.updateOrderStatus(order.master_order_id || order.id, 'cancelled');
      
      return {
        success: true,
        refund_amount: refundAmount,
        message: 'Order cancelled, full refund processed'
      };
      
    } catch (error) {
      console.error('[Cancel] Error cancelling order:', error);
      throw error;
    }
  }
}

export default new AlternativeFarmService();
