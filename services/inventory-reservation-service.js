#!/usr/bin/env node
/**
 * Wholesale Inventory Reservation Helper Service
 * Centralized functions for reservation, confirmation, and release
 */

export class InventoryReservationService {
  /**
   * Reserve inventory at a farm
   */
  static async reserveInventory(farmId, orderId, items) {
    try {
      const farmApiUrl = process.env[`FARM_${farmId}_API_URL`] || process.env.FARM_API_URL || `http://localhost:8091`;
      const farmApiKey = process.env[`FARM_${farmId}_API_KEY`] || process.env.FARM_API_KEY || 'demo-key';
      
      const payload = {
        order_id: orderId,
        items: items.map(item => ({
          sku_id: item.sku_id,
          quantity: item.quantity
        }))
      };
      
      const response = await fetch(`${farmApiUrl}/api/wholesale/inventory/reserve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Farm-ID': farmId,
          'X-API-Key': farmApiKey
        },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      if (!data.ok) {
        throw new Error(data.error || 'Reservation failed');
      }
      
      return {
        success: true,
        reserved: data.reserved,
        order_id: orderId
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Confirm reservation and permanently deduct inventory (after payment)
   */
  static async confirmReservation(farmId, orderId, paymentId = null) {
    try {
      const farmApiUrl = process.env[`FARM_${farmId}_API_URL`] || process.env.FARM_API_URL || `http://localhost:8091`;
      const farmApiKey = process.env[`FARM_${farmId}_API_KEY`] || process.env.FARM_API_KEY || 'demo-key';
      
      const payload = {
        order_id: orderId,
        payment_id: paymentId
      };
      
      const response = await fetch(`${farmApiUrl}/api/wholesale/inventory/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Farm-ID': farmId,
          'X-API-Key': farmApiKey
        },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      if (!data.ok) {
        throw new Error(data.error || 'Confirmation failed');
      }
      
      return {
        success: true,
        deducted: data.deducted,
        items: data.items
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Release reservation (cancel order, payment failed, etc.)
   */
  static async releaseReservation(farmId, orderId, reason = null) {
    try {
      const farmApiUrl = process.env[`FARM_${farmId}_API_URL`] || process.env.FARM_API_URL || `http://localhost:8091`;
      const farmApiKey = process.env[`FARM_${farmId}_API_KEY`] || process.env.FARM_API_KEY || 'demo-key';
      
      const payload = {
        order_id: orderId,
        reason: reason
      };
      
      const response = await fetch(`${farmApiUrl}/api/wholesale/inventory/release`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Farm-ID': farmId,
          'X-API-Key': farmApiKey
        },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      if (!data.ok) {
        throw new Error(data.error || 'Release failed');
      }
      
      return {
        success: true,
        released: data.released,
        reason: data.reason
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Rollback confirmed deduction (refund scenario)
   */
  static async rollbackDeduction(farmId, orderId, reason) {
    try {
      const farmApiUrl = process.env[`FARM_${farmId}_API_URL`] || process.env.FARM_API_URL || `http://localhost:8091`;
      const farmApiKey = process.env[`FARM_${farmId}_API_KEY`] || process.env.FARM_API_KEY || 'demo-key';
      
      const payload = {
        order_id: orderId,
        reason: reason
      };
      
      const response = await fetch(`${farmApiUrl}/api/wholesale/inventory/rollback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Farm-ID': farmId,
          'X-API-Key': farmApiKey
        },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      if (!data.ok) {
        throw new Error(data.error || 'Rollback failed');
      }
      
      return {
        success: true,
        rolled_back: data.rolled_back,
        items: data.items
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Reserve inventory at multiple farms (atomic operation)
   * If ANY farm fails, rollback all previous reservations
   */
  static async reserveAtMultipleFarms(farmReservations) {
    const results = [];
    
    for (const { farmId, orderId, items } of farmReservations) {
      const result = await this.reserveInventory(farmId, orderId, items);
      
      if (!result.success) {
        // Rollback all previous successful reservations
        console.error(`[Reservation] Failed at farm ${farmId}, rolling back...`);
        
        for (const prevResult of results) {
          if (prevResult.success) {
            await this.releaseReservation(
              prevResult.farmId,
              prevResult.orderId,
              'Rollback due to partial reservation failure'
            );
          }
        }
        
        return {
          success: false,
          failedFarm: farmId,
          error: result.error,
          rolledBack: results.filter(r => r.success).length
        };
      }
      
      results.push({ ...result, farmId, orderId });
    }
    
    return {
      success: true,
      reservations: results
    };
  }

  /**
   * Confirm reservations at multiple farms
   */
  static async confirmAtMultipleFarms(farmConfirmations) {
    const results = [];
    
    for (const { farmId, orderId, paymentId } of farmConfirmations) {
      const result = await this.confirmReservation(farmId, orderId, paymentId);
      results.push({ ...result, farmId, orderId });
    }
    
    return {
      success: results.every(r => r.success),
      confirmations: results
    };
  }
}

export default InventoryReservationService;
