/**
 * Farm Purchase & Onboarding Flow
 * Handles Square payment → Account creation → Welcome email
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { Client, Environment } = require('square');

// Initialize Square client
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: process.env.SQUARE_ENVIRONMENT === 'production' ? Environment.Production : Environment.Sandbox
});

// Email service (uses existing email infrastructure)
const emailService = process.env.EMAIL_SERVICE || 'mock';

/**
 * POST /api/farms/purchase
 * 
 * Complete purchase flow:
 * 1. Verify Stripe payment
 * 2. Create farm record with unique ID
 * 3. Create admin user account
 * 4. Generate API keys
 * 5. Send welcome email
 * 
 * Body: {
 *   payment_intent_id: string (Stripe payment intent)
 *   email: string
 *   farm_name: string
 *   contact_name: string
 *   phone: string (optional)
 *   plan: 'cloud' | 'edge'
 * }
 */
router.post('/purchase', async (req, res) => {
  try {
    const { payment_intent_id, email, farm_name, contact_name, phone, plan } = req.body;

    console.log('[Purchase] New purchase request:', { email, farm_name, plan });

    // Validate required fields
    if (!payment_intent_id || !email || !farm_name || !contact_name || !plan) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['payment_intent_id', 'email', 'farm_name', 'contact_name', 'plan']
      });
    }

    // Step 1: Verify Square Payment
    console.log('[Purchase] Verifying payment:', payment_intent_id);
    let payment;
    
    try {
      const response = await squareClient.paymentsApi.getPayment(payment_intent_id);
      payment = response.result.payment;
      
      if (payment.status !== 'COMPLETED') {
        console.log('[Purchase] Payment not completed:', payment.status);
        return res.status(400).json({ 
          error: 'Payment not completed',
          status: payment.status 
        });
      }
      
      console.log('[Purchase] Payment verified:', payment.amountMoney.amount / 100, payment.amountMoney.currency);
    } catch (squareError) {
      console.error('[Purchase] Square verification failed:', squareError.message);
      return res.status(400).json({ 
        error: 'Invalid payment',
        details: squareError.message 
      });
    }

    // Step 2: Generate unique farm ID
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = crypto.randomBytes(2).toString('hex').toUpperCase();
    const farm_id = `FARM-${timestamp}-${random}`;
    
    console.log('[Purchase] Generated farm ID:', farm_id);

    // Step 3: Generate API credentials
    const api_key = `sk_${crypto.randomBytes(24).toString('base64url')}`;
    const api_secret = crypto.randomBytes(32).toString('hex');
    const jwt_secret = crypto.randomBytes(32).toString('hex');
    
    // Step 4: Generate temporary password
    const temp_password = crypto.randomBytes(8).toString('base64url');
    
    // Step 5: Create farm record in database
    console.log('[Purchase] Creating farm record...');
    
    const db = req.app.locals.db;
    
    await db.query(`
      INSERT INTO farms (
        farm_id,
        name,
        email,
        phone,
        contact_name,
        plan_type,
        api_key,
        api_secret,
        jwt_secret,
        square_payment_id,
        square_amount,
        status,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active', NOW())
    `, [
      farm_id,
      farm_name,
      email,
      phone || null,
      contact_name,
      plan,
      api_key,
      api_secret,
      jwt_secret,
      payment_intent_id,
      payment.amountMoney.amount
    ]);

    // Step 6: Create admin user account
    console.log('[Purchase] Creating admin user...');
    
    const bcrypt = require('bcryptjs');
    const password_hash = await bcrypt.hash(temp_password, 10);
    
    await db.query(`
      INSERT INTO users (
        farm_id,
        email,
        password_hash,
        name,
        role,
        is_active,
        created_at
      ) VALUES ($1, $2, $3, $4, 'admin', true, NOW())
    `, [farm_id, email, password_hash, contact_name]);

    // Step 7: Send welcome email
    console.log('[Purchase] Sending welcome email...');
    
    const welcomeEmail = generateWelcomeEmail({
      farm_name,
      contact_name,
      email,
      temp_password,
      farm_id,
      plan,
      login_url: `${req.protocol}://${req.get('host')}/LE-login.html`
    });

    // Use existing email service or mock
    if (emailService === 'mock') {
      console.log('[Purchase] MOCK EMAIL - Would send to:', email);
      console.log('[Purchase] Login URL:', welcomeEmail.login_url);
      console.log('[Purchase] Temp password:', temp_password);
    } else {
      // TODO: Integrate with actual email service (SendGrid, AWS SES, etc.)
      console.log('[Purchase] Email sent to:', email);
    }

    // Step 8: Return success response
    console.log('[Purchase] Purchase completed successfully:', farm_id);
    
    res.json({
      success: true,
      message: 'Account created successfully',
      farm_id,
      email,
      login_url: `${req.protocol}://${req.get('host')}/LE-login.html`,
      setup_url: `${req.protocol}://${req.get('host')}/LE-setup-wizard.html`,
      // Don't send API keys in response - only via email
      instructions: 'Check your email for login credentials and setup instructions'
    });

  } catch (error) {
    console.error('[Purchase] Error:', error);
    res.status(500).json({ 
      error: 'Purchase processing failed',
      details: error.message 
    });
  }
});

/**
 * POST /api/farms/create-checkout-session
 * 
 * Create Square payment link for farm purchase
 * 
 * Body: {
 *   plan: 'cloud' | 'edge',
 *   email: string,
 *   farm_name: string,
 *   contact_name: string
 * }
 */
router.post('/create-checkout-session', async (req, res) => {
  try {
    const { plan, email, farm_name, contact_name } = req.body;

    console.log('[Checkout] Creating session for:', { plan, email, farm_name });

    // Validate required fields
    if (!email || !farm_name || !contact_name || !plan) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Check Square location ID
    if (!process.env.SQUARE_LOCATION_ID) {
      console.error('[Checkout] SQUARE_LOCATION_ID not configured');
      return res.status(500).json({ error: 'Payment system not configured. Please contact support.' });
    }

    // Define pricing (TEST MODE: $1/month)
    const prices = {
      cloud: {
        amount: 100, // $1/month in cents (TEST MODE)
        name: 'Light Engine Cloud',
        description: 'Cloud-based farm management system'
      },
      edge: {
        amount: 100, // $1/month in cents (TEST MODE)
        name: 'Light Engine Edge Device',
        description: 'Complete hardware + software system'
      }
    };

    const selectedPrice = prices[plan];
    if (!selectedPrice) {
      return res.status(400).json({ error: 'Invalid plan selected' });
    }

    // Create Square payment link
    const idempotencyKey = crypto.randomUUID();
    
    console.log('[Checkout] Creating payment link with:', {
      locationId: process.env.SQUARE_LOCATION_ID,
      amount: selectedPrice.amount,
      email: email
    });

    const response = await squareClient.checkoutApi.createPaymentLink({
      idempotencyKey,
      order: {
        locationId: process.env.SQUARE_LOCATION_ID,
        lineItems: [{
          name: selectedPrice.name,
          quantity: '1',
          basePriceMoney: {
            amount: BigInt(selectedPrice.amount),
            currency: 'USD'
          },
          note: selectedPrice.description
        }],
        metadata: {
          farm_name,
          contact_name,
          plan,
          email
        }
      },
      checkoutOptions: {
        redirectUrl: `${req.protocol}://${req.get('host')}/purchase-success.html`,
        askForShippingAddress: false
      },
      prePopulatedData: {
        buyerEmail: email
      }
    });

    const paymentLink = response.result.paymentLink;

    console.log('[Checkout] Payment link created successfully:', paymentLink.id);

    res.json({ 
      sessionId: paymentLink.id,
      url: paymentLink.url,
      orderId: paymentLink.orderId
    });

  } catch (error) {
    console.error('[Checkout] Error:', error);
    console.error('[Checkout] Error details:', error.errors || error.message);
    
    // Extract meaningful error message from Square API
    let errorMessage = 'Checkout session creation failed';
    if (error.errors && error.errors.length > 0) {
      const squareError = error.errors[0];
      errorMessage = squareError.detail || squareError.code || errorMessage;
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    res.status(500).json({ 
      error: errorMessage,
      details: error.errors || error.message 
    });
  }
});

/**
 * GET /api/farms/verify-session/:session_id
 * 
 * Verify checkout session and create account
 */
router.get('/verify-session/:session_id', async (req, res) => {
  try {
    const { session_id } = req.params;

    // Get payment link to retrieve order ID
    const linkResponse = await squareClient.checkoutApi.retrievePaymentLink(session_id);
    const orderId = linkResponse.result.paymentLink.orderId;

    // Get order details
    const orderResponse = await squareClient.ordersApi.retrieveOrder(orderId);
    const order = orderResponse.result.order;

    if (order.state === 'COMPLETED') {
      // Extract metadata
      const { farm_name, contact_name, plan, email } = order.metadata || {};

      // Get payment ID from order
      const payment_intent_id = order.tenders?.[0]?.id;

      if (!payment_intent_id) {
        throw new Error('Payment ID not found in order');
      }

      // Trigger account creation
      req.body = {
        payment_intent_id,
        email,
        farm_name,
        contact_name,
        plan
      };

      // Forward to purchase endpoint (internal call)
      return router.handle(req, res, '/purchase');
    }

    res.json({ 
      status: order.state,
      message: 'Payment not completed' 
    });

  } catch (error) {
    console.error('[Verify] Error:', error);
    res.status(500).json({ 
      error: 'Session verification failed',
      details: error.message 
    });
  }
});

/**
 * Generate welcome email content
 */
function generateWelcomeEmail({ farm_name, contact_name, email, temp_password, farm_id, plan, login_url }) {
  return {
    to: email,
    subject: `Welcome to Light Engine - Your ${plan === 'cloud' ? 'Cloud' : 'Edge'} Account is Ready`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #10b981;">Welcome to Light Engine!</h1>
        
        <p>Hi ${contact_name},</p>
        
        <p>Your Light Engine account for <strong>${farm_name}</strong> has been created successfully!</p>
        
        <h2 style="color: #059669;">Your Login Credentials</h2>
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Farm ID:</strong> ${farm_id}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Temporary Password:</strong> <code style="background: #fff; padding: 4px 8px; border-radius: 4px;">${temp_password}</code></p>
          <p><strong>Login URL:</strong> <a href="${login_url}">${login_url}</a></p>
        </div>
        
        <p style="background: #fef3c7; padding: 12px; border-left: 4px solid #f59e0b; margin: 20px 0;">
          <strong>⚠️ Important:</strong> Please change your password immediately after first login.
        </p>
        
        <h2 style="color: #059669;">Next Steps</h2>
        <ol>
          <li>Click the login link above</li>
          <li>Sign in with your credentials</li>
          <li>Complete the setup wizard</li>
          <li>Start managing your farm!</li>
        </ol>
        
        <h2 style="color: #059669;">What's Included</h2>
        <ul>
          <li>✅ Full dashboard access</li>
          <li>✅ Inventory management</li>
          <li>✅ POS & online sales</li>
          <li>✅ Wholesale integration</li>
          <li>✅ Farm analytics</li>
          ${plan === 'edge' ? '<li>✅ Edge device configuration</li>' : ''}
        </ul>
        
        <h2 style="color: #059669;">Need Help?</h2>
        <p>Contact our support team:</p>
        <ul>
          <li>Email: <a href="mailto:support@greenreach.io">support@greenreach.io</a></li>
          <li>Documentation: <a href="${login_url.replace('LE-login.html', 'docs/index.html')}">Quick Start Guide</a></li>
        </ul>
        
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
        
        <p style="color: #6b7280; font-size: 14px;">
          &copy; 2025 Light Engine. All rights reserved.<br>
          This email contains sensitive information. Please keep it secure.
        </p>
      </div>
    `,
    text: `
Welcome to Light Engine!

Hi ${contact_name},

Your Light Engine account for ${farm_name} has been created successfully!

Your Login Credentials:
- Farm ID: ${farm_id}
- Email: ${email}
- Temporary Password: ${temp_password}
- Login URL: ${login_url}

⚠️ Important: Please change your password immediately after first login.

Next Steps:
1. Visit the login URL
2. Sign in with your credentials
3. Complete the setup wizard
4. Start managing your farm!

Need Help?
Email: support@greenreach.io
Documentation: ${login_url.replace('LE-login.html', 'docs/index.html')}

© 2025 Light Engine. All rights reserved.
    `,
    login_url,
    temp_password
  };
}

module.exports = router;
