/**
 * Mobile Push Notification Service
 * Firebase Cloud Messaging (FCM) for iOS and Android
 */

import admin from 'firebase-admin';
import { readFileSync } from 'fs';

class PushNotificationService {
  constructor() {
    this.enabled = false;
    
    try {
      // Initialize Firebase Admin SDK
      const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
      
      if (serviceAccountPath) {
        const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
        
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
        
        this.messaging = admin.messaging();
        this.enabled = true;
        console.log('[Push] Firebase Cloud Messaging initialized');
      } else {
        console.log('[Push] Firebase not configured - push notifications disabled');
      }
    } catch (error) {
      console.error('[Push] Initialization failed:', error.message);
    }
  }

  /**
   * Send push notification to single device
   */
  async sendToDevice(deviceToken, notification, data = {}) {
    if (!this.enabled) {
      console.log(`[Push] Would send to ${deviceToken}:`, notification.title);
      return { success: false, reason: 'Push notifications not configured' };
    }

    try {
      const message = {
        notification: {
          title: notification.title,
          body: notification.body,
          icon: notification.icon || '/images/greenreach-icon.png',
          badge: notification.badge || '/images/badge.png',
          click_action: notification.url || process.env.APP_URL
        },
        data: {
          ...data,
          click_action: notification.url || process.env.APP_URL
        },
        token: deviceToken,
        android: {
          priority: notification.priority || 'high',
          notification: {
            sound: 'default',
            color: '#82c341' // GreenReach green
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: data.badge_count || 1
            }
          }
        }
      };

      const response = await this.messaging.send(message);
      console.log(`[Push] Sent to device, message ID: ${response}`);
      
      return {
        success: true,
        messageId: response
      };

    } catch (error) {
      console.error('[Push] Send failed:', error.message);
      
      // Handle invalid tokens
      if (error.code === 'messaging/invalid-registration-token' ||
          error.code === 'messaging/registration-token-not-registered') {
        console.log(`[Push] Invalid token, should remove: ${deviceToken}`);
        return {
          success: false,
          error: 'invalid_token',
          should_remove: true
        };
      }
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send to multiple devices (up to 500 at once)
   */
  async sendToDevices(deviceTokens, notification, data = {}) {
    if (!this.enabled) {
      console.log(`[Push] Would send to ${deviceTokens.length} devices:`, notification.title);
      return { success: false, reason: 'Push notifications not configured' };
    }

    if (deviceTokens.length === 0) {
      return { success: false, reason: 'No device tokens provided' };
    }

    try {
      const message = {
        notification: {
          title: notification.title,
          body: notification.body
        },
        data,
        tokens: deviceTokens.slice(0, 500) // FCM limit
      };

      const response = await this.messaging.sendMulticast(message);
      
      console.log(`[Push] Sent to ${response.successCount}/${deviceTokens.length} devices`);
      
      // Handle failed tokens
      if (response.failureCount > 0) {
        const failedTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            failedTokens.push(deviceTokens[idx]);
            console.log(`[Push] Failed token ${idx}:`, resp.error.code);
          }
        });
      }

      return {
        success: true,
        successCount: response.successCount,
        failureCount: response.failureCount
      };

    } catch (error) {
      console.error('[Push] Multicast send failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send topic message (subscribe users to topics like "farm-orders")
   */
  async sendToTopic(topic, notification, data = {}) {
    if (!this.enabled) {
      console.log(`[Push] Would send to topic ${topic}:`, notification.title);
      return { success: false };
    }

    try {
      const message = {
        notification: {
          title: notification.title,
          body: notification.body
        },
        data,
        topic
      };

      const response = await this.messaging.send(message);
      console.log(`[Push] Sent to topic ${topic}, message ID: ${response}`);
      
      return {
        success: true,
        messageId: response
      };

    } catch (error) {
      console.error(`[Push] Topic send failed:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Notify farm about new wholesale order
   */
  async notifyFarmNewOrder(farmDeviceTokens, orderId, buyerName, amount, hoursLeft) {
    return await this.sendToDevices(farmDeviceTokens, {
      title: 'New Wholesale Order',
      body: `${buyerName} placed order #${orderId} ($${amount}) - ${hoursLeft}hrs to respond`,
      icon: '/images/order-icon.png',
      url: `${process.env.APP_URL}/LE-wholesale-orders.html?order=${orderId}`,
      priority: 'high'
    }, {
      type: 'new_order',
      order_id: orderId.toString(),
      amount: amount.toString(),
      deadline_hours: hoursLeft.toString()
    });
  }

  /**
   * Notify farm about approaching deadline
   */
  async notifyFarmDeadline(farmDeviceTokens, orderId, hoursLeft) {
    return await this.sendToDevices(farmDeviceTokens, {
      title: '⏰ Order Deadline Approaching',
      body: `Order #${orderId} expires in ${hoursLeft} hours! Respond now.`,
      url: `${process.env.APP_URL}/LE-wholesale-orders.html`,
      priority: 'high'
    }, {
      type: 'deadline_reminder',
      order_id: orderId.toString(),
      hours_left: hoursLeft.toString(),
      urgent: 'true'
    });
  }

  /**
   * Notify buyer about order modification
   */
  async notifyBuyerModification(buyerDeviceTokens, orderId, farmName) {
    return await this.sendToDevices(buyerDeviceTokens, {
      title: 'Order Modified',
      body: `${farmName} adjusted quantities for order #${orderId}. Review changes.`,
      url: `${process.env.APP_URL}/LE-wholesale-review.html?order_id=${orderId}`
    }, {
      type: 'order_modification',
      order_id: orderId.toString(),
      farm_name: farmName
    });
  }

  /**
   * Notify buyer order is ready for pickup
   */
  async notifyBuyerPickupReady(buyerDeviceTokens, orderId, farmName) {
    return await this.sendToDevices(buyerDeviceTokens, {
      title: 'Order Ready!',
      body: `Your order #${orderId} from ${farmName} is ready for pickup.`,
      url: `${process.env.APP_URL}/GR-wholesale.html?view=orders`
    }, {
      type: 'pickup_ready',
      order_id: orderId.toString()
    });
  }
}

export default new PushNotificationService();
