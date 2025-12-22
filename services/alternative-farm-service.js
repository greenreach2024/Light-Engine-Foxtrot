/**
 * Alternative Farm Matching Service
 * Finds replacement farms when original farm declines or times out
 */

import notificationService from './wholesale-notification-service.js';

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
    // TODO: Query database for farms with matching inventory
    // For now, return mock data
    console.log('[Alternative Farms] Searching database for matching farms...');
    
    // Mock query:
    // SELECT DISTINCT f.* FROM farms f
    // JOIN farm_inventory fi ON f.id = fi.farm_id
    // WHERE fi.sku_id IN (requiredItems.map(i => i.sku_id))
    // AND fi.available_quantity >= required_quantity
    // AND f.status = 'active'
    // AND f.verified = true
    // ORDER BY f.quality_score DESC, f.proximity_to(deliveryLocation) ASC
    
    return [
      // Mock results - replace with real DB query
      { farm_id: 'GR-00002', farm_name: 'Green Valley Farm', quality_score: 95, distance_km: 15 },
      { farm_id: 'GR-00003', farm_name: 'Sunny Acres', quality_score: 88, distance_km: 22 },
      { farm_id: 'GR-00004', farm_name: 'Fresh Fields', quality_score: 92, distance_km: 18 }
    ];
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
      const priceScore = 20; // TODO: Calculate based on pricing
      const responseScore = 10; // TODO: Get from farm performance data
      
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
      const newSubOrder = {
        id: Date.now() + Math.random(), // Use proper ID generation
        wholesale_order_id: mainOrder.id,
        farm_id: farm.farm_id,
        status: 'pending_verification',
        sub_total: originalSubOrder.sub_total,
        items: originalSubOrder.items.map(item => ({...item})), // Clone items
        verification_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        is_alternative: true,
        replaces_sub_order_id: originalSubOrder.id,
        created_at: new Date().toISOString()
      };
      
      // TODO: INSERT INTO farm_sub_orders
      newSubOrders.push(newSubOrder);
    }
    
    return newSubOrders;
  }

  /**
   * Get farm contact information
   */
  async getFarmContact(farm_id) {
    // TODO: SELECT from farms table
    return {
      farm_id,
      farm_name: `Farm ${farm_id}`,
      email: `farm${farm_id}@example.com`,
      phone: null
    };
  }

  /**
   * Process refund for partial order cancellation
   */
  async processPartialRefund(order, subOrder) {
    console.log(`[Refund] Processing refund for sub-order #${subOrder.id}`);
    
    try {
      const refundAmount = subOrder.sub_total;
      
      // TODO: Use Square refund API
      // const paymentProvider = PaymentProviderFactory.create('square', config);
      // const refundResult = await paymentProvider.refundPayment({
      //   paymentId: order.payment_id,
      //   amountMoney: { amount: Math.round(refundAmount * 100), currency: 'CAD' },
      //   reason: 'Farm unavailable - no alternatives found'
      // });
      
      console.log(`[Refund] Would refund $${refundAmount.toFixed(2)} to buyer`);
      
      // Notify buyer
      await notificationService.notifyBuyerRefund(order, subOrder, refundAmount);
      
      // TODO: Update order status
      // UPDATE wholesale_orders SET status = 'partial_refund' WHERE id = order.id
      
      return {
        success: true,
        refund_amount: refundAmount,
        refund_id: `REFUND-${Date.now()}` // Mock refund ID
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
      
      // TODO: Square refund
      console.log(`[Refund] Would refund full amount $${refundAmount.toFixed(2)}`);
      
      // Notify buyer
      await notificationService.notifyBuyerOrderCancelled(order, refundAmount);
      
      // TODO: Update order status to 'cancelled'
      
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
