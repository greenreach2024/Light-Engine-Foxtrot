/**
 * Wholesale Product Requests
 * Allows buyers to request products not in catalog - notifies all local farms
 */

import express from 'express';
import pg from 'pg';
import { sendEmail } from '../lib/email-service.js';

const router = express.Router();

// Create database pool
const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'lightengine',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'lightengine',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Authenticate wholesale buyer using JWT
async function requireBuyerAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ status: 'error', message: 'No token provided' });
    }

    // Simplified auth check - in production, verify JWT properly
    req.buyerId = 1; // TODO: Decode from JWT
    return next();
  } catch (error) {
    console.error('Wholesale auth error:', error.message);
    return res.status(401).json({ status: 'error', message: 'Invalid or expired token' });
  }
}

/**
 * POST /api/wholesale/product-requests/create
 * Buyer creates a product request, notifies all active local farms
 */
router.post('/create', requireBuyerAuth, async (req, res) => {
  try {
    const {
      buyer_id,
      product_name,
      quantity,
      unit,
      needed_by_date,
      description,
      max_price_per_unit,
      certifications_required
    } = req.body;

    if (!product_name || !quantity || !unit || !needed_by_date) {
      return res.status(400).json({
        ok: false,
        message: 'Product name, quantity, unit, and needed by date are required'
      });
    }

    // Get buyer information
    const buyerResult = await pool.query(
      'SELECT id, business_name, contact_name, email, buyer_type, location FROM wholesale_buyers WHERE id = $1',
      [buyer_id]
    );

    if (buyerResult.rows.length === 0) {
      return res.status(404).json({ ok: false, message: 'Buyer not found' });
    }

    const buyer = buyerResult.rows[0];

    // Insert product request into database
    const requestResult = await pool.query(`
      INSERT INTO wholesale_product_requests 
      (buyer_id, product_name, quantity, unit, needed_by_date, description, max_price_per_unit, certifications_required, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING id
    `, [
      buyer_id,
      product_name,
      quantity,
      unit,
      needed_by_date,
      description,
      max_price_per_unit,
      JSON.stringify(certifications_required || []),
      'open'
    ]);

    const requestId = requestResult.rows[0].id;

    // Get all active farms with email addresses
    const farmsResult = await pool.query(`
      SELECT f.farm_id, f.name, u.email, f.address
      FROM farms f
      LEFT JOIN users u ON u.farm_id = f.farm_id AND u.role = 'admin' AND u.is_active = true
      WHERE f.is_active = true
      ORDER BY f.name
    `);

    const farms = farmsResult.rows;
    let notifiedCount = 0;

    // Notify each farm via email
    for (const farm of farms) {
      if (!farm.email) continue;

      try {
        const certText = certifications_required && certifications_required.length > 0
          ? certifications_required.join(', ')
          : 'None specified';

        const priceText = max_price_per_unit
          ? `Maximum price: $${max_price_per_unit} per ${unit}`
          : 'No price limit specified';

        const subject = `Product Request: ${product_name} - ${buyer.business_name}`;

        const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #2d5016 0%, #3d6b1f 100%); color: white; padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: white; padding: 30px; border: 1px solid #e0e0e0; }
    .highlight { background: #f0f7ed; padding: 20px; margin: 20px 0; border-left: 4px solid #2d5016; border-radius: 4px; }
    .detail-row { display: flex; padding: 10px 0; border-bottom: 1px solid #eee; }
    .detail-label { font-weight: 600; width: 160px; color: #666; }
    .detail-value { flex: 1; color: #333; }
    .cta-button { display: inline-block; background: #2d5016; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🌱 New Product Request</h1>
    </div>
    
    <div class="content">
      <p>Hello ${farm.name},</p>
      
      <p><strong>${buyer.business_name}</strong> is looking for a product that they couldn't find in the current catalog. Can you help?</p>
      
      <div class="highlight">
        <h2 style="margin-top: 0; color: #2d5016;">Product Request Details</h2>
        
        <div class="detail-row">
          <span class="detail-label">Product:</span>
          <span class="detail-value"><strong>${product_name}</strong></span>
        </div>
        
        <div class="detail-row">
          <span class="detail-label">Quantity:</span>
          <span class="detail-value">${quantity} ${unit}</span>
        </div>
        
        <div class="detail-row">
          <span class="detail-label">Needed By:</span>
          <span class="detail-value">${new Date(needed_by_date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
        </div>
        
        <div class="detail-row">
          <span class="detail-label">Price:</span>
          <span class="detail-value">${priceText}</span>
        </div>
        
        <div class="detail-row">
          <span class="detail-label">Certifications:</span>
          <span class="detail-value">${certText}</span>
        </div>
        
        ${description ? `
        <div class="detail-row">
          <span class="detail-label">Notes:</span>
          <span class="detail-value">${description}</span>
        </div>
        ` : ''}
      </div>
      
      <h3>Buyer Information</h3>
      <div class="detail-row">
        <span class="detail-label">Business:</span>
        <span class="detail-value">${buyer.business_name}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Contact:</span>
        <span class="detail-value">${buyer.contact_name}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Email:</span>
        <span class="detail-value"><a href="mailto:${buyer.email}">${buyer.email}</a></span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Type:</span>
        <span class="detail-value">${buyer.buyer_type}</span>
      </div>
      
      <p style="margin-top: 30px;">
        <strong>Next Steps:</strong><br/>
        If you can fulfill this request, please respond directly to the buyer at <a href="mailto:${buyer.email}">${buyer.email}</a> with:
      </p>
      
      <ul>
        <li>Availability and quantity you can provide</li>
        <li>Your pricing per ${unit}</li>
        <li>Earliest delivery date</li>
        <li>Any relevant certifications</li>
      </ul>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="mailto:${buyer.email}?subject=Re: Product Request - ${encodeURIComponent(product_name)}&body=Hi ${buyer.contact_name},%0D%0A%0D%0AI can help with your request for ${product_name}!%0D%0A%0D%0AAvailable Quantity: %0D%0APrice per ${unit}: $%0D%0AEarliest Delivery Date: %0D%0A%0D%0ABest regards,%0D%0A${farm.name}" class="cta-button">
          Reply to Buyer
        </a>
      </div>
    </div>
    
    <div class="footer">
      <p>This request was sent through GreenReach Wholesale Network</p>
      <p style="font-size: 0.85rem; color: #999;">Request ID: #${requestId}</p>
    </div>
  </div>
</body>
</html>
        `;

        const textBody = `
New Product Request from ${buyer.business_name}

Product: ${product_name}
Quantity: ${quantity} ${unit}
Needed By: ${new Date(needed_by_date).toLocaleDateString()}
${priceText}
Certifications: ${certText}
${description ? `Notes: ${description}` : ''}

Buyer Contact:
${buyer.contact_name}
${buyer.email}
${buyer.buyer_type}

If you can fulfill this request, please reply directly to ${buyer.email} with your availability, pricing, and delivery timeline.

Request ID: #${requestId}
GreenReach Wholesale Network
        `;

        await sendEmail({
          to: farm.email,
          subject,
          html: htmlBody,
          text: textBody
        });

        notifiedCount++;
        console.log(`[Product Request] Notified ${farm.name} (${farm.email}) about request #${requestId}`);

      } catch (emailError) {
        console.error(`[Product Request] Failed to notify ${farm.name}:`, emailError.message);
        // Continue to next farm
      }
    }

    console.log(`[Product Request] Created request #${requestId}, notified ${notifiedCount} of ${farms.length} farms`);

    return res.json({
      ok: true,
      request_id: requestId,
      matched_farms: notifiedCount,
      message: `Request submitted! ${notifiedCount} farms have been notified.`
    });

  } catch (error) {
    console.error('[Product Request] Create error:', error);
    return res.status(500).json({
      ok: false,
      message: 'Failed to create product request',
      error: error.message
    });
  }
});

/**
 * GET /api/wholesale/product-requests/buyer/:buyerId
 * Get all product requests for a specific buyer
 */
router.get('/buyer/:buyerId', requireBuyerAuth, async (req, res) => {
  try {
    const { buyerId } = req.params;

    const result = await pool.query(`
      SELECT 
        id,
        product_name,
        quantity,
        unit,
        needed_by_date,
        description,
        max_price_per_unit,
        certifications_required,
        status,
        created_at
      FROM wholesale_product_requests
      WHERE buyer_id = $1
      ORDER BY created_at DESC
    `, [buyerId]);

    return res.json({
      ok: true,
      requests: result.rows
    });

  } catch (error) {
    console.error('[Product Request] List error:', error);
    return res.status(500).json({
      ok: false,
      message: 'Failed to fetch product requests'
    });
  }
});

export default router;
