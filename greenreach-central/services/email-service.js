/**
 * Email Service
 * Handles sending transactional emails
 */

class EmailService {
  async sendEmail(options) {
    console.log('Email service stub - would send:', options.subject);
    return { success: true, messageId: `stub-${Date.now()}` };
  }

  async sendOrderConfirmation(order, buyer) {
    return this.sendEmail({
      to: buyer.email,
      subject: `Order Confirmation #${order.orderId}`,
      body: 'Thank you for your order'
    });
  }
}

export default new EmailService();
