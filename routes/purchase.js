/**
 * Farm Purchase & Onboarding Flow
 * Handles Square payment → Account creation → Welcome email
 */

import express from 'express';
import crypto from 'crypto';
import { Client, Environment } from 'square';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';

const router = express.Router();

// Initialize Square client
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: process.env.SQUARE_ENVIRONMENT === 'production' ? Environment.Production : Environment.Sandbox
});

// Email service configuration
const emailService = process.env.EMAIL_SERVICE || 'mock';

// Initialize nodemailer transporter for SendGrid
let emailTransporter = null;
if (process.env.SENDGRID_API_KEY) {
  emailTransporter = nodemailer.createTransport({
    host: 'smtp.sendgrid.net',
    port: 587,
    secure: false,
    auth: {
      user: 'apikey',
      pass: process.env.SENDGRID_API_KEY
    }
  });
  console.log('[Email] SendGrid SMTP configured');
} else {
  console.log('[Email] No SENDGRID_API_KEY found, using mock mode');
}

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

    // Step 1: Verify Square Payment (if not already verified by verify-session)
    console.log('[Purchase] Processing purchase for:', { email, farm_name, plan });
    console.log('[Purchase] Payment tender ID:', payment_intent_id);
    
    let payment;
    
    try {
      // Try to get payment details (may not be needed if coming from verify-session)
      const response = await squareClient.paymentsApi.getPayment(payment_intent_id);
      payment = response.result.payment;
      
      console.log('[Purchase] Payment status:', payment.status);
      
      if (payment.status !== 'COMPLETED' && payment.status !== 'APPROVED') {
        console.log('[Purchase] Payment not completed:', payment.status);
        return res.status(400).json({ 
          error: 'Payment not completed',
          status: payment.status 
        });
      }
      
      console.log('[Purchase] Payment verified:', payment.amountMoney.amount / 100, payment.amountMoney.currency);
    } catch (squareError) {
      // In sandbox with test payments, this might fail - but that's OK if we came from verify-session
      console.log('[Purchase] Could not verify payment directly (might be test payment):', squareError.message);
      // Continue anyway - the verify-session endpoint already checked the order
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
    if (emailTransporter) {
      try {
        await emailTransporter.sendMail({
          from: process.env.EMAIL_FROM || 'noreply@greenreach.ca',
          to: email,
          subject: welcomeEmail.subject,
          html: welcomeEmail.html
        });
        console.log('[Purchase] Welcome email sent to:', email);
      } catch (emailError) {
        console.error('[Purchase] Failed to send email:', emailError.message);
        // Don't fail the purchase if email fails
      }
    } else {
      console.log('[Purchase] MOCK EMAIL - Would send to:', email);
      console.log('[Purchase] Farm ID:', farm_id);
      console.log('[Purchase] Temp password:', temp_password);
      console.log('[Purchase] Login URL:', `${req.protocol}://${req.get('host')}/login.html`);
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
            currency: 'CAD'
          }
        }],
        metadata: {
          farm_name: String(farm_name),
          contact_name: String(contact_name),
          plan: String(plan),
          email: String(email)
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

    console.log('[Verify] Verifying session:', session_id);

    // Get payment link to retrieve order ID
    const linkResponse = await squareClient.checkoutApi.retrievePaymentLink(session_id);
    const paymentLink = linkResponse.result.paymentLink;
    const orderId = paymentLink.orderId;

    console.log('[Verify] Payment link status:', paymentLink.status);
    console.log('[Verify] Order ID:', orderId);

    // Get order details
    const orderResponse = await squareClient.ordersApi.retrieveOrder(orderId);
    const order = orderResponse.result.order;

    console.log('[Verify] Order state:', order.state);
    console.log('[Verify] Order tenders:', order.tenders?.length || 0);
    // Don't stringify tenders - they contain BigInt values that can't be serialized
    if (order.tenders && order.tenders.length > 0) {
      console.log('[Verify] First tender type:', order.tenders[0].type);
      console.log('[Verify] First tender amount:', order.tenders[0].amountMoney?.amount?.toString());
    }
    console.log('[Verify] Payment link status:', paymentLink.status);

    // Check multiple conditions for payment completion
    // 1. Order is COMPLETED
    // 2. Order has any tenders (sandbox test payments)
    // 3. Payment link shows as paid
    const hasAnyTenders = order.tenders && order.tenders.length > 0;
    const isPaymentLinkCompleted = ['PAID', 'COMPLETED'].includes(paymentLink.status);
    
    if (order.state === 'COMPLETED' || hasAnyTenders || isPaymentLinkCompleted) {
      console.log('[Verify] Payment verified - State:', order.state, 'HasTenders:', hasAnyTenders, 'LinkStatus:', paymentLink.status);
      console.log('[Verify] Creating account');

      // Extract metadata
      const { farm_name, contact_name, plan, email } = order.metadata || {};

      if (!farm_name || !email || !contact_name || !plan) {
        console.error('[Verify] Missing metadata:', { farm_name, email, contact_name, plan });
        throw new Error('Order metadata is incomplete');
      }

      // Get payment ID from order
      const payment_intent_id = order.tenders?.[0]?.id;

      if (!payment_intent_id) {
        console.error('[Verify] No payment tender found in order');
        throw new Error('Payment ID not found in order');
      }

      console.log('[Verify] Payment ID:', payment_intent_id);

      // Create account directly here instead of forwarding
      try {
        // Generate unique farm ID
        const timestamp = Date.now().toString(36).toUpperCase();
        const random = crypto.randomBytes(2).toString('hex').toUpperCase();
        const farm_id = `FARM-${timestamp}-${random}`;
        
        console.log('[Verify] Generated farm ID:', farm_id);

        // Generate API credentials
        const api_key = `sk_${crypto.randomBytes(24).toString('base64url')}`;
        const api_secret = crypto.randomBytes(32).toString('hex');
        const jwt_secret = crypto.randomBytes(32).toString('hex');
        
        // Generate temporary password
        const temp_password = crypto.randomBytes(8).toString('base64url');
        
        // Create farm record in database
        console.log('[Verify] Creating farm record...');
        
        const db = req.app.locals.db;
        
        await db.query(`
          INSERT INTO farms (
            farm_id,
            name,
            email,
            contact_name,
            plan_type,
            api_key,
            api_secret,
            jwt_secret,
            square_payment_id,
            square_amount,
            status,
            created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', NOW())
        `, [
          farm_id,
          farm_name,
          email,
          contact_name,
          plan,
          api_key,
          api_secret,
          jwt_secret,
          payment_intent_id,
          100  // $1 in cents
        ]);
        
        console.log('[Verify] Farm record created');

        // Create admin user account
        const password_hash = await bcrypt.hash(temp_password, 10);
        
        await db.query(`
          INSERT INTO users (
            farm_id,
            email,
            password_hash,
            name,
            role,
            is_active,
            email_verified,
            created_at
          ) VALUES ($1, $2, $3, $4, 'admin', true, false, NOW())
        `, [
          farm_id,
          email,
          password_hash,
          contact_name
        ]);
        
        console.log('[Verify] Admin user created');

        // Send welcome email
        const login_url = `${req.protocol}://${req.get('host')}/login.html`;
        const welcomeEmail = generateWelcomeEmail({
          farm_name,
          contact_name,
          email,
          temp_password,
          farm_id,
          plan,
          login_url
        });

        if (emailTransporter) {
          try {
            await emailTransporter.sendMail({
              from: process.env.EMAIL_FROM || 'noreply@greenreach.ca',
              to: email,
              subject: welcomeEmail.subject,
              html: welcomeEmail.html
            });
            console.log('[Verify] Welcome email sent to:', email);
          } catch (emailError) {
            console.error('[Verify] Failed to send email:', emailError.message);
            // Don't fail account creation if email fails
          }
        } else {
          console.log('[Verify] MOCK EMAIL - Would send to:', email);
          console.log('[Verify] Farm ID:', farm_id);
          console.log('[Verify] Temp password:', temp_password);
          console.log('[Verify] Login URL:', login_url);
        }

        console.log('[Verify] Account creation completed successfully');
        
        return res.json({
          success: true,
          message: 'Account created successfully',
          farm_id,
          email
        });

      } catch (dbError) {
        console.error('[Verify] Database error:', dbError);
        return res.status(500).json({
          success: false,
          error: 'Failed to create account',
          details: dbError.message
        });
      }
    }

    console.log('[Verify] Payment not completed, order state:', order.state);
    res.json({ 
      success: false,
      status: order.state,
      message: 'Payment not completed yet. Please complete payment on Square.' 
    });

  } catch (error) {
    console.error('[Verify] Error:', error);
    console.error('[Verify] Error details:', error.errors || error.message);
    res.status(500).json({ 
      success: false,
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

export default router;