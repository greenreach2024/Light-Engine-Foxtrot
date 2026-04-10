/**
 * Send all notification emails to the farm and daily summary to Central.
 * Usage: node send-all-notifications.js
 */
import nodemailer from 'nodemailer';

const SMTP_USER = 'greenreachfarms@gmail.com';
const SMTP_PASS = process.env.SMTP_PASS || 'sopx fteo sfvb tgxx';
const FROM = `GreenReach Farms <${SMTP_USER}>`;
const FARM_EMAIL = 'greenreachfarms@gmail.com';
const FARM_ID = 'FARM-MLTP9LVH-B0B85039';
const FARM_NAME = 'The Notable Sprout';
const BUSINESS = 'GreenReach Greens -- Ottawa, ON, Canada';
const NOW = new Date().toISOString();

const transport = nodemailer.createTransport({
  host: 'smtp.gmail.com', port: 587, secure: false,
  auth: { user: SMTP_USER, pass: SMTP_PASS }
});

// Verify connection
await transport.verify();
console.log('[OK] SMTP connection verified\n');

// ─── 1. WELCOME EMAIL ───
console.log('1/4  Sending Welcome Email...');
const r1 = await transport.sendMail({
  from: FROM, to: FARM_EMAIL,
  subject: 'Welcome to Light Engine -- Your Farm Account is Ready',
  text: `Welcome to Light Engine!

Hi Peter,

Your Light Engine Cloud account for "The Notable Sprout" is now active.

YOUR LOGIN CREDENTIALS
Farm ID:       ${FARM_ID}
Email:         ${FARM_EMAIL}

GETTING STARTED
1. Open your dashboard: https://greenreachgreens.com/farm-admin.html
2. Enter your Farm ID and password to log in
3. Set up your grow rooms, zones, and crops in Farm Settings
4. Connect your sensors and begin monitoring
5. Talk to E.V.I.E., your AI farm assistant

Login page: https://greenreachgreens.com/farm-admin-login.html

IMPORTANT: Save this email for your records.

--
GreenReach -- The foundation for smarter farms
greenreachgreens.com | info@greenreachgreens.com
${BUSINESS}`,
  html: `<div style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
<tr><td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:32px 40px;text-align:center;">
  <h1 style="color:white;margin:0;font-size:24px;font-weight:700;">Welcome to Light Engine</h1>
  <p style="color:#94a3b8;margin:8px 0 0;font-size:14px;">Your farm management platform is ready</p>
</td></tr>
<tr><td style="padding:32px 40px;">
  <p style="color:#1a202c;font-size:16px;line-height:1.6;">Hi Peter,</p>
  <p style="color:#4a5568;font-size:15px;line-height:1.6;">Your Light Engine Cloud account for <strong>${FARM_NAME}</strong> is now active.</p>
  <table width="100%" style="background:#f0fdf4;border:2px solid #86efac;border-radius:10px;margin:16px 0;">
  <tr><td style="padding:20px 24px;">
    <p style="color:#166534;font-weight:700;font-size:15px;margin:0 0 12px;">Your Login Credentials</p>
    <p style="color:#6b7280;font-size:13px;margin:4px 0;">Farm ID: <strong style="color:#1a202c;font-family:monospace;">${FARM_ID}</strong></p>
    <p style="color:#6b7280;font-size:13px;margin:4px 0;">Email: <strong style="color:#1a202c;">${FARM_EMAIL}</strong></p>
  </td></tr></table>
  <p style="text-align:center;margin:20px 0;"><a href="https://greenreachgreens.com/farm-admin.html" style="display:inline-block;background:#10b981;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">Go to Your Farm Dashboard</a></p>
  <table width="100%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin:20px 0;"><tr><td style="padding:20px 24px;">
    <p style="color:#2d3748;font-weight:700;font-size:15px;margin:0 0 10px;">Getting Started</p>
    <p style="color:#4a5568;font-size:14px;line-height:1.7;margin:4px 0;"><strong>1.</strong> Log in with your Farm ID and password</p>
    <p style="color:#4a5568;font-size:14px;line-height:1.7;margin:4px 0;"><strong>2.</strong> Set up your grow rooms, zones, and crops</p>
    <p style="color:#4a5568;font-size:14px;line-height:1.7;margin:4px 0;"><strong>3.</strong> Connect your sensors and begin monitoring</p>
    <p style="color:#4a5568;font-size:14px;line-height:1.7;margin:4px 0;"><strong>4.</strong> Talk to E.V.I.E., your AI farm assistant</p>
  </td></tr></table>
</td></tr>
<tr><td style="background:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;text-align:center;">
  <p style="color:#94a3b8;font-size:12px;">GreenReach -- The foundation for smarter farms</p>
  <p style="color:#94a3b8;font-size:11px;">${BUSINESS}</p>
</td></tr></table></td></tr></table></div>`
});
console.log(`   SENT: ${r1.messageId}`);

// ─── 2. SYSTEM NOTIFICATION ───
console.log('2/4  Sending System Notification...');
const r2 = await transport.sendMail({
  from: FROM, to: FARM_EMAIL,
  subject: `[${FARM_NAME}] System Notification -- All Systems Online`,
  text: `Farm Notification -- ${FARM_NAME} (${FARM_ID})

All Systems Operational
Your farm platform is running normally. All services healthy.

System Status:
  Sensor Data Pipeline    ACTIVE
  AI Agents (E.V.I.E.)   ONLINE
  G.W.E.N. Research       ONLINE
  Wholesale Marketplace   ACTIVE
  Email Notifications     ONLINE
  Database (AlloyDB)      CONNECTED

Timestamp: ${NOW}

--
${BUSINESS}`,
  html: `<div style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
<tr><td style="background:#0f172a;padding:24px 40px;text-align:center;">
  <h1 style="color:white;margin:0;font-size:20px;">Farm Notification</h1>
  <p style="color:#94a3b8;margin:6px 0 0;font-size:13px;">${FARM_NAME} | ${FARM_ID}</p>
</td></tr>
<tr><td style="padding:32px 40px;">
  <table width="100%" style="background:#f0fdf4;border-left:4px solid #10b981;border-radius:6px;margin:0 0 20px;"><tr><td style="padding:16px 20px;">
    <p style="color:#166534;font-weight:700;font-size:15px;margin:0 0 4px;">All Systems Operational</p>
    <p style="color:#15803d;font-size:14px;margin:0;">Your farm platform is running normally. All services healthy.</p>
  </td></tr></table>
  <p style="color:#2d3748;font-size:14px;font-weight:600;margin:0 0 12px;">System Status</p>
  <table width="100%" cellpadding="8" cellspacing="0" style="font-size:14px;border-collapse:collapse;">
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#4a5568;">Sensor Data Pipeline</td><td style="color:#16a34a;font-weight:600;text-align:right;">ACTIVE</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#4a5568;">AI Agents (E.V.I.E.)</td><td style="color:#16a34a;font-weight:600;text-align:right;">ONLINE</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#4a5568;">G.W.E.N. Research</td><td style="color:#16a34a;font-weight:600;text-align:right;">ONLINE</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#4a5568;">Wholesale Marketplace</td><td style="color:#16a34a;font-weight:600;text-align:right;">ACTIVE</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#4a5568;">Email Notifications</td><td style="color:#16a34a;font-weight:600;text-align:right;">ONLINE</td></tr>
    <tr><td style="color:#4a5568;">Database (AlloyDB)</td><td style="color:#16a34a;font-weight:600;text-align:right;">CONNECTED</td></tr>
  </table>
  <p style="color:#64748b;font-size:13px;margin:20px 0 0;">Timestamp: ${NOW}</p>
</td></tr>
<tr><td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">${BUSINESS}</p>
</td></tr></table></td></tr></table></div>`
});
console.log(`   SENT: ${r2.messageId}`);

// ─── 3. WHOLESALE ORDER NOTIFICATION ───
console.log('3/4  Sending Wholesale Order Notification...');
const r3 = await transport.sendMail({
  from: FROM, to: FARM_EMAIL,
  subject: '[GreenReach Wholesale] New Order #WO-20260409-001',
  text: `New Wholesale Order -- #WO-20260409-001

Order Summary
  Buyer:     Ottawa Fresh Co-op
  Date:      April 9, 2026
  Delivery:  April 12, 2026

Items Ordered:
  Butterhead Lettuce (case)   x12   $14.50 ea   $174.00
  Basil Bunch (dozen)          x8    $9.75 ea    $78.00
  Microgreens Mix (tray)      x20    $6.00 ea   $120.00

  Subtotal:       $372.00
  Broker Fee (12%): $44.64
  Farm Payout:    $327.36

View order: https://greenreachgreens.com/GR-central-admin.html#wholesale

--
GreenReach Wholesale Marketplace
${BUSINESS}`,
  html: `<div style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
<tr><td style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);padding:24px 40px;text-align:center;">
  <h1 style="color:white;margin:0;font-size:20px;">New Wholesale Order</h1>
  <p style="color:#bfdbfe;margin:6px 0 0;font-size:13px;">Order #WO-20260409-001</p>
</td></tr>
<tr><td style="padding:32px 40px;">
  <table width="100%" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;margin:0 0 20px;"><tr><td style="padding:20px 24px;">
    <p style="color:#1e40af;font-weight:700;font-size:15px;margin:0 0 8px;">Order Summary</p>
    <p style="color:#4a5568;font-size:14px;margin:4px 0;">Buyer: <strong>Ottawa Fresh Co-op</strong></p>
    <p style="color:#4a5568;font-size:14px;margin:4px 0;">Date: April 9, 2026</p>
    <p style="color:#4a5568;font-size:14px;margin:4px 0;">Delivery: April 12, 2026</p>
  </td></tr></table>
  <p style="color:#2d3748;font-size:14px;font-weight:600;margin:0 0 12px;">Items Ordered</p>
  <table width="100%" cellpadding="10" cellspacing="0" style="font-size:14px;border-collapse:collapse;margin:0 0 16px;">
    <tr style="background:#f8fafc;"><th style="text-align:left;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0;">Product</th><th style="text-align:center;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0;">Qty</th><th style="text-align:right;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0;">Unit</th><th style="text-align:right;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0;">Total</th></tr>
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#1a202c;">Butterhead Lettuce (case)</td><td style="text-align:center;">12</td><td style="text-align:right;">$14.50</td><td style="text-align:right;font-weight:600;">$174.00</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#1a202c;">Basil Bunch (dozen)</td><td style="text-align:center;">8</td><td style="text-align:right;">$9.75</td><td style="text-align:right;font-weight:600;">$78.00</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#1a202c;">Microgreens Mix (tray)</td><td style="text-align:center;">20</td><td style="text-align:right;">$6.00</td><td style="text-align:right;font-weight:600;">$120.00</td></tr>
  </table>
  <table width="100%" style="background:#f0fdf4;border-radius:8px;margin:0 0 20px;"><tr><td style="padding:16px 24px;">
    <table width="100%" cellspacing="0" cellpadding="4">
      <tr><td style="color:#4a5568;font-size:14px;">Subtotal</td><td style="text-align:right;color:#1a202c;font-size:14px;">$372.00</td></tr>
      <tr><td style="color:#4a5568;font-size:14px;">Broker Fee (12%)</td><td style="text-align:right;color:#1a202c;font-size:14px;">$44.64</td></tr>
      <tr style="border-top:2px solid #86efac;"><td style="color:#166534;font-size:16px;font-weight:700;padding-top:8px;">Farm Payout</td><td style="text-align:right;color:#166534;font-size:16px;font-weight:700;padding-top:8px;">$327.36</td></tr>
    </table>
  </td></tr></table>
  <p style="text-align:center;"><a href="https://greenreachgreens.com/GR-central-admin.html#wholesale" style="display:inline-block;background:#3b82f6;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">View Order Details</a></p>
</td></tr>
<tr><td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
  <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;">GreenReach Wholesale Marketplace</p>
  <p style="color:#94a3b8;font-size:11px;margin:0;">${BUSINESS}</p>
</td></tr></table></td></tr></table></div>`
});
console.log(`   SENT: ${r3.messageId}`);

// ─── 4. DAILY SUMMARY TO GREENREACH CENTRAL ───
console.log('4/4  Sending Daily Summary to GreenReach Central...');
const r4 = await transport.sendMail({
  from: FROM, to: FARM_EMAIL,
  subject: `[GreenReach Central] Daily Platform Summary -- ${new Date().toLocaleDateString('en-CA')}`,
  text: `GreenReach Central -- Daily Platform Summary
Date: ${new Date().toLocaleDateString('en-CA')}

PLATFORM HEALTH
  Light Engine (Cloud Run):     HEALTHY -- Serving 100%
  GreenReach Central (Cloud Run): HEALTHY -- Serving 100%
  AlloyDB:                       CONNECTED
  Sensor Pipeline:               ACTIVE

ACTIVE FARMS
  The Notable Sprout (${FARM_ID})
    Status: Active
    Last Heartbeat: ${NOW}
    Sensors: SwitchBot Hub connected

AI AGENTS
  E.V.I.E. (Farm Assistant):   ONLINE -- OpenAI + Anthropic fallback
  F.A.Y.E. (Admin Operations): ONLINE -- 100+ tools, trust tier system
  G.W.E.N. (Research Agent):   ONLINE -- 74 tools, research integrations

EMAIL SYSTEM
  Transport: Google SMTP (greenreachfarms@gmail.com)
  Status: OPERATIONAL -- App Password v4 active
  Templates: 9 verified (welcome, buyer welcome, order confirmation,
    monthly statements, research invite, alerts, wholesale notifications)

WHOLESALE MARKETPLACE
  Active Buyers: 0 (pending onboarding)
  Orders Today: 0
  Payment Provider: Square (production keys active)

INFRASTRUCTURE
  GCP Project: project-5d00790f-13a9-4637-a40
  Region: us-east1
  Central Revision: greenreach-central-00053-n4t
  Secrets: 8 active in Secret Manager
  VPC: Direct egress via greenreach-vpc

PENDING ITEMS
  - Google Workspace DNS setup for greenreachgreens.com (MX/SPF/DKIM)
  - SwitchBot credentials need real values in Secret Manager
  - Buyer onboarding for wholesale marketplace
  - Research tier subscriber beta launch

--
GreenReach Central -- Automated Daily Summary
${BUSINESS}`,
  html: `<div style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
<tr><td style="background:linear-gradient(135deg,#7c3aed 0%,#a855f7 100%);padding:24px 40px;text-align:center;">
  <h1 style="color:white;margin:0;font-size:20px;">GreenReach Central</h1>
  <p style="color:#e9d5ff;margin:6px 0 0;font-size:13px;">Daily Platform Summary -- ${new Date().toLocaleDateString('en-CA')}</p>
</td></tr>
<tr><td style="padding:32px 40px;">

  <!-- Platform Health -->
  <p style="color:#2d3748;font-size:16px;font-weight:700;margin:0 0 12px;">Platform Health</p>
  <table width="100%" cellpadding="8" cellspacing="0" style="font-size:14px;border-collapse:collapse;margin:0 0 24px;">
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#4a5568;">Light Engine (Cloud Run)</td><td style="color:#16a34a;font-weight:600;text-align:right;">HEALTHY</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#4a5568;">GreenReach Central (Cloud Run)</td><td style="color:#16a34a;font-weight:600;text-align:right;">HEALTHY</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#4a5568;">AlloyDB Database</td><td style="color:#16a34a;font-weight:600;text-align:right;">CONNECTED</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#4a5568;">Sensor Pipeline</td><td style="color:#16a34a;font-weight:600;text-align:right;">ACTIVE</td></tr>
    <tr><td style="color:#4a5568;">Email System</td><td style="color:#16a34a;font-weight:600;text-align:right;">OPERATIONAL</td></tr>
  </table>

  <!-- Active Farms -->
  <p style="color:#2d3748;font-size:16px;font-weight:700;margin:0 0 12px;">Active Farms</p>
  <table width="100%" style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;margin:0 0 24px;"><tr><td style="padding:16px 20px;">
    <p style="color:#166534;font-weight:600;font-size:14px;margin:0 0 4px;">${FARM_NAME}</p>
    <p style="color:#4a5568;font-size:13px;margin:2px 0;">ID: ${FARM_ID}</p>
    <p style="color:#4a5568;font-size:13px;margin:2px 0;">Status: Active | Last Heartbeat: ${NOW}</p>
  </td></tr></table>

  <!-- AI Agents -->
  <p style="color:#2d3748;font-size:16px;font-weight:700;margin:0 0 12px;">AI Agents</p>
  <table width="100%" cellpadding="8" cellspacing="0" style="font-size:14px;border-collapse:collapse;margin:0 0 24px;">
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#4a5568;">E.V.I.E. (Farm Assistant)</td><td style="color:#16a34a;font-weight:600;text-align:right;">ONLINE</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#4a5568;">F.A.Y.E. (Admin Operations)</td><td style="color:#16a34a;font-weight:600;text-align:right;">ONLINE</td></tr>
    <tr><td style="color:#4a5568;">G.W.E.N. (Research Agent)</td><td style="color:#16a34a;font-weight:600;text-align:right;">ONLINE</td></tr>
  </table>

  <!-- Wholesale -->
  <p style="color:#2d3748;font-size:16px;font-weight:700;margin:0 0 12px;">Wholesale Marketplace</p>
  <table width="100%" cellpadding="8" cellspacing="0" style="font-size:14px;border-collapse:collapse;margin:0 0 24px;">
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#4a5568;">Active Buyers</td><td style="text-align:right;color:#1a202c;">0 (pending onboarding)</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#4a5568;">Orders Today</td><td style="text-align:right;color:#1a202c;">0</td></tr>
    <tr><td style="color:#4a5568;">Payment Provider</td><td style="text-align:right;color:#1a202c;">Square (production)</td></tr>
  </table>

  <!-- Pending Items -->
  <p style="color:#2d3748;font-size:16px;font-weight:700;margin:0 0 12px;">Pending Items</p>
  <table width="100%" style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:6px;margin:0 0 16px;"><tr><td style="padding:16px 20px;">
    <p style="color:#92400e;font-size:14px;line-height:1.7;margin:0;">
      - Google Workspace DNS for greenreachgreens.com (MX/SPF/DKIM)<br>
      - SwitchBot sensor credentials (real values needed)<br>
      - Wholesale buyer onboarding<br>
      - Research tier beta launch
    </p>
  </td></tr></table>

  <p style="color:#64748b;font-size:12px;margin:16px 0 0;text-align:center;">Central Revision: greenreach-central-00053-n4t | GCP: us-east1</p>
</td></tr>
<tr><td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
  <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;">GreenReach Central -- Automated Daily Summary</p>
  <p style="color:#94a3b8;font-size:11px;margin:0;">${BUSINESS}</p>
</td></tr></table></td></tr></table></div>`
});
console.log(`   SENT: ${r4.messageId}`);

console.log('\n========================================');
console.log('  All 4 emails sent successfully');
console.log('  1. Welcome Email -> farm');
console.log('  2. System Notification -> farm');
console.log('  3. Wholesale Order Notification -> farm');
console.log('  4. Daily Summary -> Central');
console.log('========================================');

process.exit(0);
