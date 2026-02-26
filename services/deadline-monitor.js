/**
 * Cron Job: Check for Expired Order Verification Deadlines
 * Runs every 5 minutes to find sub-orders that haven't been verified in time
 */

import alternativeFarmService from '../services/alternative-farm-service.js';
import notificationService from '../services/wholesale-notification-service.js';
import * as orderStore from '../lib/wholesale/order-store.js';

class DeadlineMonitor {
  /**
   * Check all pending sub-orders for expired deadlines
   */
  async checkExpiredDeadlines() {
    console.log('[Deadline Monitor] Checking for expired verification deadlines...');
    
    try {
      // TODO: Query database for expired sub-orders
      // SELECT * FROM farm_sub_orders
      // WHERE status = 'pending_verification'
      // AND verification_deadline < NOW()
      // AND is_expired = false
      
      const expiredSubOrders = await this.getExpiredSubOrders();
      
      if (expiredSubOrders.length === 0) {
        console.log('[Deadline Monitor] No expired deadlines found');
        return;
      }
      
      console.log(`[Deadline Monitor] Found ${expiredSubOrders.length} expired sub-order(s)`);
      
      for (const subOrder of expiredSubOrders) {
        await this.handleExpiredSubOrder(subOrder);
      }
      
      console.log('[Deadline Monitor] Finished processing expired deadlines');
      
    } catch (error) {
      console.error('[Deadline Monitor] Error checking deadlines:', error);
    }
  }

  /**
   * Handle a single expired sub-order
   */
  async handleExpiredSubOrder(subOrder) {
    console.log(`[Deadline Monitor] Processing expired sub-order #${subOrder.id}`);
    
    try {
      // Mark as expired
      await orderStore.updateSubOrderStatus(subOrder.sub_order_id, 'expired', { is_expired: true });
      
      // Get main order details
      const mainOrder = await orderStore.getOrder(subOrder.master_order_id);
      if (!mainOrder) {
        console.error(`[Deadline Monitor] Main order ${subOrder.master_order_id} not found for sub-order #${subOrder.id}`);
        return;
      }
      
      // CRITICAL: Release inventory reservation when order expires
      console.log(`[Deadline Monitor] Releasing inventory reservation for expired sub-order #${subOrder.id}`);
      try {
        const farmApiUrl = process.env[`FARM_${subOrder.farm_id}_API_URL`] || `http://localhost:8091`;
        const farmApiKey = process.env[`FARM_${subOrder.farm_id}_API_KEY`] || 'demo-key';
        
        const releaseResponse = await fetch(`${farmApiUrl}/api/wholesale/inventory/release`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Farm-ID': subOrder.farm_id,
            'X-API-Key': farmApiKey
          },
          body: JSON.stringify({
            order_id: mainOrder.id,
            reason: 'Farm verification deadline expired'
          })
        });
        
        const releaseData = await releaseResponse.json();
        if (releaseData.ok) {
          console.log(`[Deadline Monitor] ✅ Released ${releaseData.released} reservations at farm ${subOrder.farm_id}`);
        } else {
          console.error(`[Deadline Monitor] ❌ Failed to release reservation: ${releaseData.error}`);
        }
      } catch (releaseError) {
        console.error(`[Deadline Monitor] Error releasing inventory reservation:`, releaseError);
      }
      
      // Notify buyer about expiration
      await notificationService.notifyBuyerDeadlineExpired(mainOrder, subOrder);
      
      // Track performance event (farm missed deadline)
      console.log(`[Performance] Farm ${subOrder.farm_id} missed deadline for sub-order #${subOrder.id}`);
      await orderStore.recordPerfEvent({ farm_id: subOrder.farm_id, event_type: 'missed_deadline', sub_order_id: subOrder.sub_order_id, master_order_id: subOrder.master_order_id });
      
      // Trigger alternative farm search
      const result = await alternativeFarmService.findAlternatives(subOrder, mainOrder);
      
      if (result.success) {
        console.log(`[Deadline Monitor] ${result.alternatives_notified} alternatives notified`);
        await orderStore.updateOrderStatus(mainOrder.master_order_id, 'seeking_alternatives');
      } else if (result.refund_required) {
        console.log(`[Deadline Monitor] No alternatives found - processing refund`);
        await alternativeFarmService.processPartialRefund(mainOrder, subOrder);
        await orderStore.updateOrderStatus(mainOrder.master_order_id, 'partial_refund');
      }
      
    } catch (error) {
      console.error(`[Deadline Monitor] Error handling expired sub-order #${subOrder.id}:`, error);
    }
  }

  /**
   * Get sub-orders that have expired
   */
  async getExpiredSubOrders() {
    return await orderStore.getExpiredSubOrders();
  }

  /**
   * Send reminder emails 6 hours before deadline
   */
  async sendDeadlineReminders() {
    console.log('[Deadline Monitor] Checking for upcoming deadlines (6hr reminder)...');
    
    try {
      // TODO: Query for sub-orders with deadline in next 6-7 hours
      // SELECT * FROM farm_sub_orders
      // WHERE status = 'pending_verification'
      // AND verification_deadline BETWEEN NOW() + INTERVAL 6 HOUR AND NOW() + INTERVAL 7 HOUR
      // AND reminder_sent = false
      
      const upcomingDeadlines = await this.getUpcomingDeadlines();
      
      if (upcomingDeadlines.length === 0) {
        console.log('[Deadline Monitor] No upcoming deadlines for reminders');
        return;
      }
      
      console.log(`[Deadline Monitor] Sending ${upcomingDeadlines.length} deadline reminder(s)`);
      
      for (const subOrder of upcomingDeadlines) {
        const hoursLeft = Math.floor(
          (new Date(subOrder.verification_deadline) - new Date()) / (1000 * 60 * 60)
        );
        
        const farmContact = {
          farm_id: subOrder.farm_id,
          farm_name: subOrder.farm_name,
          email: subOrder.farm_email
        };
        
        await notificationService.sendDeadlineReminder(farmContact, subOrder, hoursLeft);
        
        await orderStore.updateSubOrderStatus(subOrder.sub_order_id, subOrder.status, { reminder_sent: true });
      }
      
      console.log('[Deadline Monitor] Finished sending reminders');
      
    } catch (error) {
      console.error('[Deadline Monitor] Error sending reminders:', error);
    }
  }

  /**
   * Get sub-orders with upcoming deadlines (6-7 hours away)
   */
  async getUpcomingDeadlines() {
    return await orderStore.getUpcomingDeadlineSubOrders();
  }

  /**
   * Start the cron job (run every 5 minutes)
   */
  start() {
    console.log('[Deadline Monitor] Starting deadline monitoring service...');
    
    // Check immediately on startup
    this.checkExpiredDeadlines();
    this.sendDeadlineReminders();
    
    // Then check every 5 minutes
    setInterval(() => {
      this.checkExpiredDeadlines();
    }, 5 * 60 * 1000); // 5 minutes
    
    // Check for reminders every hour
    setInterval(() => {
      this.sendDeadlineReminders();
    }, 60 * 60 * 1000); // 1 hour
    
    console.log('[Deadline Monitor] Monitoring active - checking every 5 minutes');
  }
}

export default new DeadlineMonitor();
