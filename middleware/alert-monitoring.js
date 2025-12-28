/**
 * Alert Integration Middleware
 * Automatically records alerts for critical failures
 */

import alertService from '../services/alert-service.js';

/**
 * Monitor farm API health
 */
export async function monitorFarmHealth(farmId, farmUrl) {
  try {
    const response = await fetch(`${farmUrl}/health`, {
      method: 'GET',
      timeout: 5000
    });
    
    if (!response.ok) {
      await alertService.recordAlert('farm_offline', {
        farm_id: farmId,
        farm_url: farmUrl,
        status_code: response.status,
        message: 'Farm API returned error status'
      });
      return false;
    }
    
    return true;
    
  } catch (error) {
    await alertService.recordAlert('farm_offline', {
      farm_id: farmId,
      farm_url: farmUrl,
      error: error.message,
      message: 'Farm API unreachable'
    });
    return false;
  }
}

/**
 * Monitor payment processing
 */
export async function monitorPayment(orderId, paymentDetails, error) {
  if (error) {
    await alertService.recordAlert('payment_failure', {
      order_id: orderId,
      payment_method: paymentDetails.method,
      amount: paymentDetails.amount,
      error: error.message,
      buyer_email: paymentDetails.buyer_email
    });
  }
}

/**
 * Monitor notification delivery
 */
export async function monitorNotification(type, recipient, error) {
  if (error) {
    await alertService.recordAlert('notification_failure', {
      notification_type: type, // 'sms', 'push', 'email'
      recipient,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Monitor inventory reservation conflicts
 */
export async function monitorReservation(skuId, requestedQty, availableQty, error) {
  if (error || requestedQty > availableQty) {
    await alertService.recordAlert('reservation_conflict', {
      sku_id: skuId,
      requested: requestedQty,
      available: availableQty,
      error: error?.message || 'Insufficient inventory',
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Monitor deadline misses
 */
export async function monitorDeadlineMiss(subOrderId, farmId, deadline) {
  await alertService.recordAlert('deadline_missed', {
    sub_order_id: subOrderId,
    farm_id: farmId,
    deadline: deadline,
    time_exceeded: new Date() - new Date(deadline),
    message: 'Farm failed to verify order within deadline'
  });
}

/**
 * CRITICAL: Monitor overselling
 */
export async function monitorOverselling(skuId, totalInventory, totalReserved, totalDeducted) {
  const totalAllocated = totalReserved + totalDeducted;
  
  if (totalAllocated > totalInventory) {
    await alertService.recordAlert('overselling_detected', {
      sku_id: skuId,
      total_inventory: totalInventory,
      total_reserved: totalReserved,
      total_deducted: totalDeducted,
      oversold_by: totalAllocated - totalInventory,
      severity: 'CRITICAL',
      message: '🚨 OVERSELLING DETECTED - IMMEDIATE ACTION REQUIRED'
    });
  }
}

export default {
  monitorFarmHealth,
  monitorPayment,
  monitorNotification,
  monitorReservation,
  monitorDeadlineMiss,
  monitorOverselling
};
