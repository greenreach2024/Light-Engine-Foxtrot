/**
 * GreenReach Wholesale Notification Service
 * Email and SMS notifications for farms and buyers
 */

import nodemailer from 'nodemailer';

class WholesaleNotificationService {
  constructor() {
    // Configure email transporter (AWS SES or SMTP)
    this.emailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    
    this.fromEmail = process.env.NOTIFICATIONS_FROM_EMAIL || 'orders@greenreach.ca';
    this.appUrl = process.env.APP_URL || 'http://localhost:8091';
  }

  /**
   * Notify farm about new order requiring verification
   */
  async notifyFarmNewOrder(farmContact, order, subOrder) {
    const { email, phone, farm_name } = farmContact;
    const hoursLeft = Math.floor((new Date(order.verification_deadline) - new Date()) / (1000 * 60 * 60));
    
    const subject = `New Wholesale Order #${order.id} - Response Required`;
    
    const htmlBody = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #2d5016 0%, #3d6b1f 100%); color: white; padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .alert { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px; }
          .deadline { color: #c53030; font-weight: bold; font-size: 1.2rem; }
          .order-details { background: #f5f7f3; padding: 20px; margin: 20px 0; border-radius: 4px; }
          .items-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          .items-table th, .items-table td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
          .items-table th { background: #e8f4e8; font-weight: 600; }
          .button { display: inline-block; background: #82c341; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
          .logistics { background: #e7f3ff; padding: 15px; margin: 20px 0; border-radius: 4px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>New Wholesale Order</h1>
            <p style="margin: 0;">Order #${order.id}</p>
          </div>
          
          <div class="alert">
            <strong>⏰ Action Required!</strong><br/>
            You have <span class="deadline">${hoursLeft} hours</span> to verify this order.<br/>
            Deadline: ${new Date(order.verification_deadline).toLocaleString()}
          </div>
          
          <div class="order-details">
            <h3>Order Information</h3>
            <p><strong>Buyer:</strong> ${order.buyer_name}</p>
            <p><strong>Email:</strong> ${order.buyer_email}</p>
            <p><strong>Phone:</strong> ${order.buyer_phone || 'Not provided'}</p>
            <p><strong>Total Value:</strong> $${subOrder.sub_total.toFixed(2)} CAD</p>
          </div>
          
          <div class="logistics">
            <h3>📍 Delivery Logistics</h3>
            <p><strong>Delivery Address:</strong><br/>
               ${order.delivery_address}<br/>
               ${order.delivery_city}, ${order.delivery_province} ${order.delivery_postal_code}</p>
            <p><strong>Fulfillment Schedule:</strong> ${this.formatCadence(order.fulfillment_cadence)}</p>
            ${order.delivery_instructions ? `<p><strong>Special Instructions:</strong><br/>${order.delivery_instructions}</p>` : ''}
            ${order.preferred_pickup_time ? `<p><strong>Preferred Pickup Time:</strong> ${order.preferred_pickup_time}</p>` : ''}
          </div>
          
          <h3>Items Ordered</h3>
          <table class="items-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Quantity</th>
                <th>Price</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${subOrder.items.map(item => `
                <tr>
                  <td>${item.product_name}</td>
                  <td>${item.quantity} ${item.unit}</td>
                  <td>$${item.price_per_unit.toFixed(2)}</td>
                  <td>$${(item.price_per_unit * item.quantity).toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3"><strong>Total</strong></td>
                <td><strong>$${subOrder.sub_total.toFixed(2)}</strong></td>
              </tr>
            </tfoot>
          </table>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${this.appUrl}/wholesale-farm-orders.html?order=${order.id}" class="button">
              View & Respond to Order →
            </a>
          </div>
          
          <div style="background: #f8f9f8; padding: 15px; border-radius: 4px; margin-top: 20px;">
            <h4>What You Can Do:</h4>
            <ul>
              <li><strong>Accept:</strong> Confirm you can fulfill as-is</li>
              <li><strong>Modify:</strong> Adjust quantities if needed (buyer will review)</li>
              <li><strong>Decline:</strong> Unable to fulfill (system will seek alternatives)</li>
            </ul>
          </div>
          
          <div style="color: #666; font-size: 0.9rem; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
            <p>This is an automated notification from GreenReach Wholesale Network.</p>
            <p>Questions? Contact: support@greenreach.ca</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    const textBody = `
NEW WHOLESALE ORDER - ACTION REQUIRED

Order #${order.id} from ${order.buyer_name}

⏰ You have ${hoursLeft} HOURS to verify this order
Deadline: ${new Date(order.verification_deadline).toLocaleString()}

ORDER TOTAL: $${subOrder.sub_total.toFixed(2)} CAD

DELIVERY LOGISTICS:
- Address: ${order.delivery_address}, ${order.delivery_city}, ${order.delivery_province}
- Schedule: ${this.formatCadence(order.fulfillment_cadence)}
${order.delivery_instructions ? `- Instructions: ${order.delivery_instructions}` : ''}

ITEMS:
${subOrder.items.map(item => 
  `- ${item.product_name}: ${item.quantity} ${item.unit} @ $${item.price_per_unit.toFixed(2)}`
).join('\n')}

RESPOND NOW: ${this.appUrl}/wholesale-farm-orders.html?order=${order.id}

You can:
- Accept (confirm fulfillment)
- Modify (adjust quantities - buyer reviews)
- Decline (system seeks alternatives)

---
GreenReach Wholesale Network
support@greenreach.ca
    `;
    
    // Send email
    try {
      await this.emailTransporter.sendMail({
        from: this.fromEmail,
        to: email,
        subject,
        html: htmlBody,
        text: textBody
      });
      console.log(`[Notifications] Email sent to ${farm_name} (${email})`);
    } catch (error) {
      console.error(`[Notifications] Email failed for ${farm_name}:`, error.message);
    }
    
    // Send SMS if phone provided
    if (phone) {
      await this.sendSMS(phone, `
GreenReach Order #${order.id}
${hoursLeft}hrs to respond
$${subOrder.sub_total.toFixed(2)} total
View: ${this.appUrl}/wholesale-farm-orders.html
      `.trim());
    }
  }

  /**
   * Notify buyer that order was placed successfully
   */
  async notifyBuyerOrderPlaced(order) {
    const subject = `Order Confirmation #${order.id} - GreenReach Wholesale`;
    
    const htmlBody = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #2d5016 0%, #3d6b1f 100%); color: white; padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1>Order Confirmation</h1>
            <p style="margin: 0; font-size: 1.2rem;">Order #${order.id}</p>
          </div>
          
          <div style="background: #d4edda; border-left: 4px solid #38a169; padding: 15px; margin: 20px 0; border-radius: 4px;">
            <strong>✓ Order Placed Successfully!</strong><br/>
            Thank you for your wholesale order.
          </div>
          
          <div style="background: #e7f3ff; border-left: 4px solid #3182ce; padding: 15px; margin: 20px 0; border-radius: 4px;">
            <strong>Payment Status:</strong><br/>
            Payment of <strong>$${order.total_amount.toFixed(2)} CAD</strong> has been processed.<br/><br/>
            <small style="color: #666;">Square Payment ID: ${order.payment_id}</small>
          </div>
          
          <h3>What Happens Next?</h3>
          <ol style="line-height: 1.8;">
            <li>Farms have 24 hours to verify your order</li>
            <li>You'll receive email if any farms modify quantities</li>
            <li>Once verified, farms will prepare your items</li>
            <li>You'll be notified when ready for pickup</li>
          </ol>
          
          <div style="background: #f5f7f3; padding: 15px; margin: 20px 0; border-radius: 4px;">
            <h4>Delivery Details</h4>
            <p><strong>Address:</strong><br/>
               ${order.delivery_address}<br/>
               ${order.delivery_city}, ${order.delivery_province}</p>
            <p><strong>Schedule:</strong> ${this.formatCadence(order.fulfillment_cadence)}</p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${this.appUrl}/wholesale.html?view=orders" 
               style="display: inline-block; background: #82c341; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
              Track Your Order →
            </a>
          </div>
        </div>
      </body>
      </html>
    `;
    
    try {
      await this.emailTransporter.sendMail({
        from: this.fromEmail,
        to: order.buyer_email,
        subject,
        html: htmlBody
      });
      console.log(`[Notifications] Order confirmation sent to ${order.buyer_email}`);
    } catch (error) {
      console.error('[Notifications] Buyer email failed:', error.message);
    }
  }

  /**
   * Notify buyer that farm modified their order
   */
  async notifyBuyerModifications(order, modifiedSubOrders) {
    const subject = `Order #${order.id} Modified - Review Required`;
    
    const htmlBody = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #2d5016 0%, #3d6b1f 100%); color: white; padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1>Order Modification</h1>
          </div>
          
          <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
            <strong>⚠️ Action Required!</strong><br/>
            ${modifiedSubOrders.length} farm(s) have modified your order quantities.<br/>
            Please review and approve the changes.
          </div>
          
          <h3>Modified By:</h3>
          <ul>
            ${modifiedSubOrders.map(sub => `
              <li><strong>${sub.farm_name}</strong> - ${sub.modification_reason || 'Quantity adjustment'}</li>
            `).join('')}
          </ul>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${this.appUrl}/wholesale-order-review.html?order_id=${order.id}" 
               style="display: inline-block; background: #ffc107; color: #333; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
              Review Modifications →
            </a>
          </div>
          
          <p style="color: #666;">You can accept the modified order or reject it for a full refund.</p>
        </div>
      </body>
      </html>
    `;
    
    try {
      await this.emailTransporter.sendMail({
        from: this.fromEmail,
        to: order.buyer_email,
        subject,
        html: htmlBody
      });
      console.log(`[Notifications] Modification notice sent to ${order.buyer_email}`);
    } catch (error) {
      console.error('[Notifications] Modification email failed:', error.message);
    }
  }

  /**
   * Reminder email sent 6 hours before deadline
   */
  async sendDeadlineReminder(farmContact, subOrder, hoursLeft) {
    const subject = `⏰ Urgent: Order Verification Deadline in ${hoursLeft}h`;
    
    try {
      await this.emailTransporter.sendMail({
        from: this.fromEmail,
        to: farmContact.email,
        subject,
        html: `
          <div style="background: #fff3cd; padding: 20px; border-left: 5px solid #ffc107;">
            <h2 style="color: #856404;">⏰ Verification Deadline Approaching</h2>
            <p>Sub-Order #${subOrder.id} requires your response in <strong>${hoursLeft} hours</strong>.</p>
            <a href="${this.appUrl}/wholesale-farm-orders.html" 
               style="display: inline-block; background: #c53030; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin-top: 10px;">
              Respond Now
            </a>
          </div>
        `
      });
      console.log(`[Notifications] Deadline reminder sent to ${farmContact.farm_name}`);
    } catch (error) {
      console.error('[Notifications] Reminder email failed:', error.message);
    }
  }

  /**
   * Send SMS notification
   */
  async sendSMS(phone, message) {
    // TODO: Integrate with Twilio or AWS SNS
    console.log(`[Notifications] SMS to ${phone}: ${message}`);
    // For now, just log. In production, use Twilio:
    // await twilioClient.messages.create({ body: message, to: phone, from: TWILIO_NUMBER });
  }

  /**
   * Format fulfillment cadence for display
   */
  formatCadence(cadence) {
    const formats = {
      'one_time': 'One-time delivery',
      'weekly': 'Weekly recurring',
      'biweekly': 'Every 2 weeks',
      'monthly': 'Monthly recurring'
    };
    return formats[cadence] || cadence;
  }
}

export default new WholesaleNotificationService();
