/**
 * Email API Routes
 * Endpoints for sending emails and testing email configuration
 */

import express from 'express';
import emailService from '../services/email-service.js';

const router = express.Router();

/**
 * POST /api/email/test
 * Test email configuration by sending a test email
 */
router.post('/test', async (req, res) => {
  try {
    const { to } = req.body;
    
    if (!to) {
      return res.status(400).json({ error: 'Recipient email (to) is required' });
    }
    
    const result = await emailService.sendEmail({
      to,
      subject: 'Test Email - Light Engine Foxtrot',
      html: `
        <h1>Email Configuration Test</h1>
        <p>This is a test email from Light Engine Foxtrot.</p>
        <p>If you received this email, your email service is configured correctly!</p>
        <p><strong>Provider:</strong> ${emailService.provider}</p>
        <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
      `
    });
    
    res.json({
      success: true,
      message: 'Test email sent successfully',
      provider: result.provider,
      messageId: result.messageId
    });
  } catch (error) {
    console.error('[email-api] Test email failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/email/order-confirmation
 * Send order confirmation email
 */
router.post('/order-confirmation', async (req, res) => {
  try {
    const { to, orderId, customerName, items, total, farmName } = req.body;
    
    if (!to || !orderId || !customerName || !items || !total) {
      return res.status(400).json({
        error: 'Missing required fields: to, orderId, customerName, items, total'
      });
    }
    
    const result = await emailService.sendOrderConfirmation({
      to,
      orderId,
      customerName,
      items,
      total,
      farmName: farmName || 'Light Engine Farm'
    });
    
    res.json({
      success: true,
      message: 'Order confirmation sent',
      messageId: result.messageId
    });
  } catch (error) {
    console.error('[email-api] Order confirmation failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/email/recall-notification
 * Send product recall notification
 */
router.post('/recall-notification', async (req, res) => {
  try {
    const { to, lotCode, productName, reason, customerName } = req.body;
    
    if (!to || !lotCode || !productName || !reason || !customerName) {
      return res.status(400).json({
        error: 'Missing required fields: to, lotCode, productName, reason, customerName'
      });
    }
    
    const result = await emailService.sendRecallNotification({
      to,
      lotCode,
      productName,
      reason,
      customerName
    });
    
    res.json({
      success: true,
      message: 'Recall notification sent',
      messageId: result.messageId
    });
  } catch (error) {
    console.error('[email-api] Recall notification failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/email/config
 * Get current email service configuration (without sensitive data)
 */
router.get('/config', (req, res) => {
  res.json({
    provider: emailService.provider,
    fromEmail: emailService.fromEmail,
    fromName: emailService.fromName,
    initialized: emailService.initialized
  });
});

/**
 * POST /api/email/verify-connection
 * Verify email service connection
 */
router.post('/verify-connection', async (req, res) => {
  try {
    const isConnected = await emailService.testConnection();
    
    res.json({
      success: true,
      connected: isConnected,
      provider: emailService.provider
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      connected: false,
      error: error.message
    });
  }
});

export default router;
