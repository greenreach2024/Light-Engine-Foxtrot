/**
 * SMS Notification Service via Twilio
 * Send text messages to farms and buyers for urgent alerts
 */

import twilio from 'twilio';

class SMSService {
  constructor() {
    this.enabled = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN;
    
    if (this.enabled) {
      this.client = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );
      this.fromNumber = process.env.TWILIO_PHONE_NUMBER;
      console.log('[SMS] Twilio SMS service initialized');
    } else {
      console.log('[SMS] Twilio not configured - SMS disabled');
    }
  }

  /**
   * Send SMS message
   */
  async send(toNumber, message) {
    if (!this.enabled) {
      console.log(`[SMS] Would send to ${toNumber}: ${message}`);
      return { success: false, reason: 'SMS not configured' };
    }

    try {
      // Format phone number (ensure +1 prefix for North America)
      const formattedNumber = this.formatPhoneNumber(toNumber);
      
      // Twilio has 160 character limit per segment
      // Truncate if too long
      const truncatedMessage = message.length > 480 
        ? message.substring(0, 477) + '...'
        : message;

      const result = await this.client.messages.create({
        body: truncatedMessage,
        from: this.fromNumber,
        to: formattedNumber
      });

      console.log(`[SMS] Sent to ${formattedNumber}, SID: ${result.sid}`);
      
      return {
        success: true,
        messageId: result.sid,
        status: result.status
      };

    } catch (error) {
      console.error('[SMS] Send failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Format phone number to E.164 format
   */
  formatPhoneNumber(phone) {
    // Remove all non-digits
    let cleaned = phone.replace(/\D/g, '');
    
    // If it's 10 digits, assume North America and add +1
    if (cleaned.length === 10) {
      cleaned = '1' + cleaned;
    }
    
    // Add + prefix
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    }
    
    return cleaned;
  }

  /**
   * Send urgent order notification to farm
   */
  async notifyFarmNewOrder(phone, orderId, amount, hoursLeft) {
    const message = `GreenReach Order #${orderId}\n${hoursLeft}hrs to respond\n$${amount} total\nView: ${process.env.APP_URL}/wholesale-farm-orders.html`;
    return await this.send(phone, message);
  }

  /**
   * Send deadline reminder to farm
   */
  async notifyFarmDeadline(phone, orderId, hoursLeft) {
    const message = `URGENT: Order #${orderId} expires in ${hoursLeft}hrs!\nRespond now: ${process.env.APP_URL}/wholesale-farm-orders.html`;
    return await this.send(phone, message);
  }

  /**
   * Send modification notification to buyer
   */
  async notifyBuyerModification(phone, orderId, farmName) {
    const message = `${farmName} modified Order #${orderId}. Review changes: ${process.env.APP_URL}/wholesale-order-review.html?order_id=${orderId}`;
    return await this.send(phone, message);
  }

  /**
   * Send pickup ready notification
   */
  async notifyPickupReady(phone, orderId, farmName) {
    const message = `Order #${orderId} from ${farmName} is ready for pickup! View details: ${process.env.APP_URL}/wholesale.html?view=orders`;
    return await this.send(phone, message);
  }
}

export default new SMSService();
