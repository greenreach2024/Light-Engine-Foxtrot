/**
 * Cron Job: Check for Expired Order Verification Deadlines
 * Runs every 5 minutes to find sub-orders that haven't been verified in time
 */

import alternativeFarmService from '../services/alternative-farm-service.js';
import notificationService from '../services/wholesale-notification-service.js';

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
      // TODO: UPDATE farm_sub_orders SET status = 'expired', is_expired = true
      
      // Get main order details
      // TODO: SELECT from wholesale_orders WHERE id = subOrder.wholesale_order_id
      const mainOrder = {
        id: subOrder.wholesale_order_id,
        buyer_email: 'buyer@example.com', // Get from database
        buyer_name: 'Test Buyer',
        total_amount: 500,
        delivery_city: 'Kingston',
        delivery_province: 'ON'
      };
      
      // Notify buyer about expiration
      await notificationService.notifyBuyerDeadlineExpired(mainOrder, subOrder);
      
      // Track performance event (farm missed deadline)
      console.log(`[Performance] Farm ${subOrder.farm_id} missed deadline for sub-order #${subOrder.id}`);
      // TODO: INSERT INTO farm_performance_events (farm_id, event_type='missed_deadline', ...)
      
      // Trigger alternative farm search
      const result = await alternativeFarmService.findAlternatives(subOrder, mainOrder);
      
      if (result.success) {
        console.log(`[Deadline Monitor] ${result.alternatives_notified} alternatives notified`);
        // TODO: UPDATE wholesale_orders SET status = 'seeking_alternatives'
      } else if (result.refund_required) {
        console.log(`[Deadline Monitor] No alternatives found - processing refund`);
        await alternativeFarmService.processPartialRefund(mainOrder, subOrder);
        // TODO: UPDATE wholesale_orders SET status = 'partial_refund'
      }
      
    } catch (error) {
      console.error(`[Deadline Monitor] Error handling expired sub-order #${subOrder.id}:`, error);
    }
  }

  /**
   * Get sub-orders that have expired
   */
  async getExpiredSubOrders() {
    // TODO: Replace with actual database query
    // This is mock data for development
    
    const now = new Date();
    
    // In production, query database:
    // SELECT fso.*, f.farm_name, f.email
    // FROM farm_sub_orders fso
    // JOIN farms f ON fso.farm_id = f.id
    // WHERE fso.status = 'pending_verification'
    // AND fso.verification_deadline < NOW()
    // AND fso.is_expired = false
    
    return [
      // Mock expired sub-order
      // {
      //   id: 123,
      //   wholesale_order_id: 456,
      //   farm_id: 'GR-00001',
      //   farm_name: 'Test Farm',
      //   status: 'pending_verification',
      //   verification_deadline: new Date(now - 60 * 60 * 1000), // 1 hour ago
      //   sub_total: 150.00,
      //   items: [
      //     { product_name: 'Lettuce', quantity: 10, unit: 'heads' },
      //     { product_name: 'Tomatoes', quantity: 5, unit: 'lbs' }
      //   ]
      // }
    ];
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
        
        // TODO: UPDATE farm_sub_orders SET reminder_sent = true WHERE id = subOrder.id
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
    // TODO: Replace with actual database query
    return [];
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
