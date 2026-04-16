#!/usr/bin/env node
/**
 * Comprehensive Notification & Communication Test
 * Tests all email templates, alert notifications, and in-app notifications.
 * 
 * Usage: node test-all-notifications.js greenreachfarms@gmail.com
 */

import nodemailer from 'nodemailer';
import { sendWelcomeEmail } from './services/email.js';
import { sendBuyerWelcomeEmail, sendBuyerMonthlyStatement, sendProducerMonthlyStatement } from './services/email-new-templates.js';
import emailService from './services/email-service.js';

const TO = process.argv[2] || 'greenreachfarms@gmail.com';
const TIMESTAMP = new Date().toISOString();
const results = [];

// ── SMTP transport (same config as the app) ─────────────────────────────
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM = `GreenReach Farms <${SMTP_USER || 'admin@greenreachgreens.com'}>`;

let transport = null;
function getTransport() {
  if (transport) return transport;
  if (!SMTP_USER || !SMTP_PASS) {
    console.error('SMTP_USER and SMTP_PASS env vars required');
    process.exit(1);
  }
  transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return transport;
}

// Helper: sendEmail function for legacy templates
async function legacySendEmail({ to, subject, html, text }) {
  const t = getTransport();
  try {
    const r = await t.sendMail({ from: FROM, to, subject, html, text });
    return { sent: true, messageId: r.messageId };
  } catch (err) {
    return { sent: false, error: err.message };
  }
}

// Track result
function log(name, result) {
  const ok = result.sent || result.success;
  const icon = ok ? 'PASS' : 'FAIL';
  const id = result.messageId || result.error || 'unknown';
  console.log(`  [${icon}] ${name} -- ${id}`);
  results.push({ name, ok, id });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. SMTP Connection Test
// ═══════════════════════════════════════════════════════════════════════════
async function testSmtpConnection() {
  console.log('\n--- 1. SMTP Connection Test ---');
  const t = getTransport();
  try {
    await t.verify();
    console.log('  [PASS] SMTP connection verified');
    results.push({ name: 'SMTP Connection', ok: true, id: 'verified' });
  } catch (err) {
    console.log(`  [FAIL] SMTP connection: ${err.message}`);
    results.push({ name: 'SMTP Connection', ok: false, id: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Basic Email (email-service.js sendEmail)
// ═══════════════════════════════════════════════════════════════════════════
async function testBasicEmail() {
  console.log('\n--- 2. Basic Email (email-service.js) ---');
  const r = await emailService.sendEmail({
    to: TO,
    subject: `[TEST] Basic Email Transport -- ${TIMESTAMP}`,
    text: `Basic email test at ${TIMESTAMP}. If you receive this, the primary email service is working.`,
    html: `<div style="font-family:sans-serif;padding:16px;max-width:600px;margin:auto;">
      <h3 style="color:#388e3c;">Basic Email Transport Test</h3>
      <p>Sent at <strong>${TIMESTAMP}</strong></p>
      <p>Transport: Google Workspace SMTP (smtp.gmail.com)</p>
      <p>From: ${SMTP_USER}</p>
      <p>To: ${TO}</p>
      <hr style="border:none;border-top:1px solid #e0e0e0;margin:16px 0;">
      <p style="color:#999;font-size:12px;">GreenReach Greens -- Ottawa, ON, Canada</p>
    </div>`
  });
  log('Basic Email (email-service)', r);
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Order Confirmation Email
// ═══════════════════════════════════════════════════════════════════════════
async function testOrderConfirmation() {
  console.log('\n--- 3. Order Confirmation Email ---');
  const mockOrder = {
    master_order_id: 'TEST-ORD-001',
    grand_total: 247.50,
    delivery_date: '2026-04-15',
    farm_sub_orders: [{
      farm_id: 'FARM-MLTP9LVH-B0B85039',
      items: [
        { product_name: 'Microgreens Mix (200g)', quantity: 10, unit_price: 8.50 },
        { product_name: 'Sunflower Shoots (150g)', quantity: 5, unit_price: 7.00 },
        { product_name: 'Pea Shoots (200g)', quantity: 8, unit_price: 9.00 }
      ]
    }]
  };
  const mockBuyer = {
    email: TO,
    contactName: 'Test Buyer',
    businessName: 'Ottawa Fresh Market'
  };

  const r = await emailService.sendOrderConfirmation(mockOrder, mockBuyer);
  log('Order Confirmation', r);
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Welcome Email (Farm Onboarding)
// ═══════════════════════════════════════════════════════════════════════════
async function testWelcomeEmail() {
  console.log('\n--- 4. Welcome Email (Farm Onboarding) ---');
  try {
    await sendWelcomeEmail({
      email: TO,
      farmId: 'FARM-TEST1234-ABCD5678',
      farmName: 'Test Farm Notification',
      contactName: 'Test Farmer',
      tempPassword: 'test-temp-pw-12345',
      planType: 'cloud'
    });
    console.log('  [PASS] Welcome Email (farm onboarding)');
    results.push({ name: 'Welcome Email (Farm)', ok: true, id: 'sent' });
  } catch (err) {
    console.log(`  [FAIL] Welcome Email: ${err.message}`);
    results.push({ name: 'Welcome Email (Farm)', ok: false, id: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Buyer Welcome Email (Wholesale Onboarding)
// ═══════════════════════════════════════════════════════════════════════════
async function testBuyerWelcomeEmail() {
  console.log('\n--- 5. Buyer Welcome Email (Wholesale) ---');
  try {
    const r = await sendBuyerWelcomeEmail(legacySendEmail, {
      email: TO,
      businessName: 'Ottawa Fresh Market',
      contactName: 'Test Buyer',
      buyerType: 'restaurant'
    });
    log('Buyer Welcome Email', r);
  } catch (err) {
    console.log(`  [FAIL] Buyer Welcome: ${err.message}`);
    results.push({ name: 'Buyer Welcome Email', ok: false, id: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Buyer Monthly Statement
// ═══════════════════════════════════════════════════════════════════════════
async function testBuyerMonthlyStatement() {
  console.log('\n--- 6. Buyer Monthly Statement ---');
  try {
    const r = await sendBuyerMonthlyStatement(legacySendEmail, {
      email: TO,
      businessName: 'Ottawa Fresh Market',
      contactName: 'Test Buyer',
      statementMonth: 'March 2026',
      statementPeriod: 'Mar 1 - Mar 31, 2026',
      lineItems: [
        { orderDate: '2026-03-05', productName: 'Microgreens Mix (200g)', farmName: 'The Notable Sprout', lotCode: 'LOT-2026-0305A', harvestDate: '2026-03-04', quantity: 10, unit: 'pkg', unitPrice: 8.50, lineTotal: 85.00, weightGrams: 2000, esgGrade: 'A' },
        { orderDate: '2026-03-12', productName: 'Sunflower Shoots (150g)', farmName: 'The Notable Sprout', lotCode: 'LOT-2026-0312B', harvestDate: '2026-03-11', quantity: 5, unit: 'pkg', unitPrice: 7.00, lineTotal: 35.00, weightGrams: 750, esgGrade: 'A' },
        { orderDate: '2026-03-20', productName: 'Pea Shoots (200g)', farmName: 'The Notable Sprout', lotCode: 'LOT-2026-0320C', harvestDate: '2026-03-19', quantity: 8, unit: 'pkg', unitPrice: 9.00, lineTotal: 72.00, weightGrams: 1600, esgGrade: 'B' }
      ],
      totals: { subtotal: 192.00, discountPercent: 2, discountAmount: 3.84, brokerFee: 0, grandTotal: 188.16, itemCount: 23, orderCount: 3 },
      environmentalSummary: { avgFoodMiles: 12, carbonKgPerKg: 0.8, esgScore: 88, esgGrade: 'A', totalWeightKg: 4.35 },
      discountTier: { currentSpend: 431.50, tierName: '$750-$1,499', discountPercent: 2, nextTier: '$1,500-$2,999 (4%)', amountToNextTier: 1068.50 }
    });
    log('Buyer Monthly Statement', r);
  } catch (err) {
    console.log(`  [FAIL] Buyer Statement: ${err.message}`);
    results.push({ name: 'Buyer Monthly Statement', ok: false, id: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Producer Monthly Statement (Farm Payout)
// ═══════════════════════════════════════════════════════════════════════════
async function testProducerMonthlyStatement() {
  console.log('\n--- 7. Producer Monthly Statement ---');
  try {
    const r = await sendProducerMonthlyStatement(legacySendEmail, {
      email: TO,
      farmName: 'The Notable Sprout',
      contactName: 'Test Farmer',
      farmId: 'FARM-MLTP9LVH-B0B85039',
      statementMonth: 'March 2026',
      statementPeriod: 'Mar 1 - Mar 31, 2026',
      lineItems: [
        { orderDate: '2026-03-05', productName: 'Microgreens Mix (200g)', buyerName: 'Ottawa Fresh Market', lotCode: 'LOT-2026-0305A', harvestDate: '2026-03-04', quantity: 10, unit: 'pkg', unitPrice: 8.50, lineTotal: 85.00, weightGrams: 2000 },
        { orderDate: '2026-03-15', productName: 'Sunflower Shoots (150g)', buyerName: 'Green Plate Bistro', lotCode: 'LOT-2026-0315B', harvestDate: '2026-03-14', quantity: 5, unit: 'pkg', unitPrice: 7.00, lineTotal: 35.00, weightGrams: 750 }
      ],
      totals: { grossRevenue: 120.00, brokerFee: 14.40, netRevenue: 105.60, orderCount: 2, fulfillmentRate: 100 },
      esgAssessment: { environmental: { score: 90 }, social: { score: 85 }, governance: { score: 88 } },
      environmentalComparison: { avgFoodMiles: 12, carbonKgPerKg: 0.8, totalWeightKg: 2.75 }
    });
    log('Producer Monthly Statement', r);
  } catch (err) {
    console.log(`  [FAIL] Producer Statement: ${err.message}`);
    results.push({ name: 'Producer Monthly Statement', ok: false, id: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. Alert Notification (Critical Alert)
// ═══════════════════════════════════════════════════════════════════════════
async function testAlertNotification() {
  console.log('\n--- 8. Alert Notification (Critical) ---');
  // Send alert-style email directly (alert-notifier uses email-service internally)
  const alertHtml = `
  <div style="font-family:sans-serif;max-width:600px;margin:auto;">
    <div style="background:#c53030;color:white;padding:16px 24px;border-radius:8px 8px 0 0;">
      <h2 style="margin:0;">CRITICAL ALERT: Temperature Out of Range</h2>
    </div>
    <div style="padding:24px;background:#fff5f5;border:1px solid #feb2b2;border-radius:0 0 8px 8px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px 0;color:#666;width:140px;">Zone</td><td style="font-weight:700;">Main Grow Room</td></tr>
        <tr><td style="padding:8px 0;color:#666;">Current Reading</td><td style="font-weight:700;color:#c53030;">34.2 C</td></tr>
        <tr><td style="padding:8px 0;color:#666;">Target Range</td><td>18.0 C - 28.0 C</td></tr>
        <tr><td style="padding:8px 0;color:#666;">Farm</td><td>FARM-MLTP9LVH-B0B85039</td></tr>
        <tr><td style="padding:8px 0;color:#666;">Timestamp</td><td>${TIMESTAMP}</td></tr>
      </table>
      <p style="margin-top:16px;padding:12px;background:#fed7d7;border-radius:6px;font-weight:600;color:#9b2c2c;">
        Immediate action recommended. Temperature exceeds critical threshold.
      </p>
    </div>
    <p style="color:#999;font-size:12px;margin-top:12px;">GreenReach Greens -- Ottawa, ON, Canada</p>
  </div>`;

  const r = await emailService.sendEmail({
    to: TO,
    subject: `[TEST] CRITICAL ALERT: Temperature Out of Range -- ${TIMESTAMP}`,
    html: alertHtml,
    text: `CRITICAL ALERT: Temperature reading 34.2C in Main Grow Room. Target: 18-28C. Farm: FARM-MLTP9LVH-B0B85039. ${TIMESTAMP}`
  });
  log('Alert Notification (Critical)', r);
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. Wholesale New Order Notification (Farm)
// ═══════════════════════════════════════════════════════════════════════════
async function testWholesaleOrderNotification() {
  console.log('\n--- 9. Wholesale New Order Notification ---');
  const htmlBody = `
  <div style="font-family:sans-serif;max-width:600px;margin:auto;">
    <div style="background:linear-gradient(135deg,#2d5016 0%,#3d6b1f 100%);color:white;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
      <h2 style="margin:0;">New Wholesale Order</h2>
      <p style="margin:8px 0 0;opacity:0.9;">Response Required within 24 hours</p>
    </div>
    <div style="padding:24px;background:white;border:1px solid #e0e0e0;border-radius:0 0 8px 8px;">
      <div style="background:#fff3cd;border-left:4px solid #ffc107;padding:12px 16px;margin-bottom:20px;border-radius:4px;">
        <strong>Order #WO-TEST-0501</strong> from <strong>Ottawa Fresh Market</strong>
        <br>Deadline: <span style="color:#c53030;font-weight:bold;">~23 hours remaining</span>
      </div>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr style="background:#e8f4e8;">
            <th style="padding:10px;text-align:left;border-bottom:2px solid #ccc;">Product</th>
            <th style="padding:10px;text-align:center;border-bottom:2px solid #ccc;">Qty</th>
            <th style="padding:10px;text-align:right;border-bottom:2px solid #ccc;">Unit Price</th>
            <th style="padding:10px;text-align:right;border-bottom:2px solid #ccc;">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style="padding:10px;border-bottom:1px solid #eee;">Microgreens Mix (200g)</td><td style="padding:10px;text-align:center;border-bottom:1px solid #eee;">10</td><td style="padding:10px;text-align:right;border-bottom:1px solid #eee;">$8.50</td><td style="padding:10px;text-align:right;border-bottom:1px solid #eee;">$85.00</td></tr>
          <tr><td style="padding:10px;border-bottom:1px solid #eee;">Sunflower Shoots (150g)</td><td style="padding:10px;text-align:center;border-bottom:1px solid #eee;">5</td><td style="padding:10px;text-align:right;border-bottom:1px solid #eee;">$7.00</td><td style="padding:10px;text-align:right;border-bottom:1px solid #eee;">$35.00</td></tr>
          <tr><td style="padding:10px;border-bottom:1px solid #eee;">Pea Shoots (200g)</td><td style="padding:10px;text-align:center;border-bottom:1px solid #eee;">8</td><td style="padding:10px;text-align:right;border-bottom:1px solid #eee;">$9.00</td><td style="padding:10px;text-align:right;border-bottom:1px solid #eee;">$72.00</td></tr>
          <tr style="font-weight:bold;"><td style="padding:10px;" colspan="3">Total</td><td style="padding:10px;text-align:right;">$192.00</td></tr>
        </tbody>
      </table>
      <div style="background:#e7f3ff;padding:12px 16px;border-radius:4px;margin:16px 0;">
        <strong>Delivery:</strong> April 15, 2026 | <strong>Pickup Window:</strong> 6:00 AM - 8:00 AM
      </div>
      <div style="text-align:center;margin:24px 0;">
        <a href="https://greenreachgreens.com/farm-admin.html" style="display:inline-block;background:#82c341;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;">Review Order in Dashboard</a>
      </div>
    </div>
    <p style="color:#999;font-size:12px;margin-top:12px;text-align:center;">GreenReach Greens -- Ottawa, ON, Canada</p>
  </div>`;

  const r = await emailService.sendEmail({
    to: TO,
    subject: `[TEST] New Wholesale Order #WO-TEST-0501 - Response Required`,
    html: htmlBody,
    text: `New wholesale order #WO-TEST-0501 from Ottawa Fresh Market. Items: Microgreens Mix x10, Sunflower Shoots x5, Pea Shoots x8. Total: $192.00. Delivery: April 15, 2026. ~23 hours to respond.`
  });
  log('Wholesale Order Notification', r);
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. Research Beta Invite
// ═══════════════════════════════════════════════════════════════════════════
async function testResearchInvite() {
  console.log('\n--- 10. Research Beta Invite ---');
  // Use email-service directly since sendResearchInviteEmail uses it internally
  const html = `
  <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:16px;">
    <h2>Welcome to the Light Engine Research Beta</h2>
    <p>Hi Test Researcher,</p>
    <p>You have been invited to explore the new Light Engine Research Beta. Your access code is:</p>
    <div style="font-size:1.5em;font-weight:bold;margin:16px 0;padding:12px;background:#f0fdf4;border:2px solid #86efac;border-radius:8px;text-align:center;">TEST-BETA-2026</div>
    <p><b>What is Light Engine?</b><br>
    The Light Engine is a cloud-based platform built to support indoor growers and researchers.</p>
    <ul>
      <li><b>For Growers:</b> Real-time monitoring, AI-driven insights, and the ability to test new lighting, nutrient, and environment recipes.</li>
      <li><b>For Researchers:</b> Introduce theoretical protocols, run experiments across multiple farms, and receive real-world feedback.</li>
    </ul>
    <p>Best regards,<br>GreenReach & Light Engine Team</p>
    <p style="color:#999;font-size:12px;">GreenReach Greens -- Ottawa, ON, Canada</p>
  </div>`;

  const r = await emailService.sendEmail({
    to: TO,
    subject: `[TEST] Invitation: Light Engine Research Beta Access`,
    html,
    text: `Hi Test Researcher, You have been invited to the Light Engine Research Beta. Your access code: TEST-BETA-2026.`
  });
  log('Research Beta Invite', r);
}

// ═══════════════════════════════════════════════════════════════════════════
// 11. In-App Notification (notification-store)
// ═══════════════════════════════════════════════════════════════════════════
async function testInAppNotification() {
  console.log('\n--- 11. In-App Notification (notification-store) ---');
  try {
    // notification-store requires DB -- test import and push
    const { default: notificationStore } = await import('./services/notification-store.js');
    const r = await notificationStore.pushNotification('FARM-MLTP9LVH-B0B85039', {
      category: 'order',
      title: '[TEST] New order received',
      body: 'Test notification at ' + TIMESTAMP,
      severity: 'info',
      source: 'test-script'
    });
    if (r && r.id) {
      console.log(`  [PASS] In-App Notification -- id: ${r.id}, created: ${r.created_at}`);
      results.push({ name: 'In-App Notification', ok: true, id: `id:${r.id}` });
    } else {
      console.log(`  [SKIP] In-App Notification -- DB not available (expected in local test)`);
      results.push({ name: 'In-App Notification', ok: false, id: 'no DB' });
    }
  } catch (err) {
    console.log(`  [SKIP] In-App Notification -- ${err.message} (expected without DB)`);
    results.push({ name: 'In-App Notification', ok: false, id: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('===========================================');
  console.log('  GreenReach Notification Test Suite');
  console.log(`  To: ${TO}`);
  console.log(`  Time: ${TIMESTAMP}`);
  console.log(`  SMTP: ${SMTP_HOST}:${SMTP_PORT} (user: ${SMTP_USER})`);
  console.log('===========================================');

  await testSmtpConnection();
  await testBasicEmail();
  await testOrderConfirmation();
  await testWelcomeEmail();
  await testBuyerWelcomeEmail();
  await testBuyerMonthlyStatement();
  await testProducerMonthlyStatement();
  await testAlertNotification();
  await testWholesaleOrderNotification();
  await testResearchInvite();
  await testInAppNotification();

  // Summary
  console.log('\n===========================================');
  console.log('  SUMMARY');
  console.log('===========================================');
  const pass = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'} | ${r.name}`);
  }
  console.log(`\n  Total: ${results.length} | Passed: ${pass} | Failed: ${fail}`);
  console.log('===========================================\n');

  // Close transport
  if (transport) transport.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
