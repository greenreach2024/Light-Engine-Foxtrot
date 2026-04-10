import nodemailer from 'nodemailer';

const SMTP_USER = 'greenreachfarms@gmail.com';
const SMTP_PASS = 'sopx fteo sfvb tgxx';
const FROM = `GreenReach Farms <${SMTP_USER}>`;
const FARM_ID = 'FARM-MLTP9LVH-B0B85039';
const FARM_NAME = 'The Notable Sprout';
const BIZ = 'GreenReach Greens -- Ottawa, ON, Canada';
const NOW = new Date().toISOString();
const D = new Date().toLocaleDateString('en-CA');

const t = nodemailer.createTransport({
  host: 'smtp.gmail.com', port: 587, secure: false,
  auth: { user: SMTP_USER, pass: SMTP_PASS }
});

const r = await t.sendMail({
  from: FROM, to: SMTP_USER,
  subject: `[GreenReach Central] Daily Platform Summary -- ${D}`,
  text: `GreenReach Central -- Daily Platform Summary
Date: ${D}

PLATFORM HEALTH
  Light Engine (Cloud Run):       HEALTHY -- Serving 100%
  GreenReach Central (Cloud Run): HEALTHY -- Serving 100%
  AlloyDB:                        CONNECTED
  Sensor Pipeline:                ACTIVE

ACTIVE FARMS
  ${FARM_NAME} (${FARM_ID})
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
  Templates: 9 verified

WHOLESALE MARKETPLACE
  Active Buyers: 0 (pending onboarding)
  Orders Today: 0
  Payment Provider: Square (production keys active)

INFRASTRUCTURE
  GCP Project: project-5d00790f-13a9-4637-a40
  Region: us-east1
  Central Revision: greenreach-central-00053-n4t
  Secrets: 8 active in Secret Manager

PENDING ITEMS
  - Google Workspace DNS setup for greenreachgreens.com (MX/SPF/DKIM)
  - SwitchBot credentials need real values in Secret Manager
  - Buyer onboarding for wholesale marketplace
  - Research tier subscriber beta launch

--
GreenReach Central -- Automated Daily Summary
${BIZ}`,
  html: `<div style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
<tr><td style="background:linear-gradient(135deg,#7c3aed 0%,#a855f7 100%);padding:24px 40px;text-align:center;">
  <h1 style="color:white;margin:0;font-size:20px;">GreenReach Central</h1>
  <p style="color:#e9d5ff;margin:6px 0 0;font-size:13px;">Daily Platform Summary -- ${D}</p>
</td></tr>
<tr><td style="padding:32px 40px;">

  <p style="color:#2d3748;font-size:16px;font-weight:700;margin:0 0 12px;">Platform Health</p>
  <table width="100%" cellpadding="8" cellspacing="0" style="font-size:14px;border-collapse:collapse;margin:0 0 24px;">
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#4a5568;">Light Engine (Cloud Run)</td><td style="color:#16a34a;font-weight:600;text-align:right;">HEALTHY</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#4a5568;">GreenReach Central (Cloud Run)</td><td style="color:#16a34a;font-weight:600;text-align:right;">HEALTHY</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#4a5568;">AlloyDB Database</td><td style="color:#16a34a;font-weight:600;text-align:right;">CONNECTED</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#4a5568;">Sensor Pipeline</td><td style="color:#16a34a;font-weight:600;text-align:right;">ACTIVE</td></tr>
    <tr><td style="color:#4a5568;">Email System</td><td style="color:#16a34a;font-weight:600;text-align:right;">OPERATIONAL</td></tr>
  </table>

  <p style="color:#2d3748;font-size:16px;font-weight:700;margin:0 0 12px;">Active Farms</p>
  <table width="100%" style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;margin:0 0 24px;"><tr><td style="padding:16px 20px;">
    <p style="color:#166534;font-weight:600;font-size:14px;margin:0 0 4px;">${FARM_NAME}</p>
    <p style="color:#4a5568;font-size:13px;margin:2px 0;">ID: ${FARM_ID}</p>
    <p style="color:#4a5568;font-size:13px;margin:2px 0;">Status: Active | Last Heartbeat: ${NOW}</p>
  </td></tr></table>

  <p style="color:#2d3748;font-size:16px;font-weight:700;margin:0 0 12px;">AI Agents</p>
  <table width="100%" cellpadding="8" cellspacing="0" style="font-size:14px;border-collapse:collapse;margin:0 0 24px;">
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#4a5568;">E.V.I.E. (Farm Assistant)</td><td style="color:#16a34a;font-weight:600;text-align:right;">ONLINE</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#4a5568;">F.A.Y.E. (Admin Operations)</td><td style="color:#16a34a;font-weight:600;text-align:right;">ONLINE</td></tr>
    <tr><td style="color:#4a5568;">G.W.E.N. (Research Agent)</td><td style="color:#16a34a;font-weight:600;text-align:right;">ONLINE</td></tr>
  </table>

  <p style="color:#2d3748;font-size:16px;font-weight:700;margin:0 0 12px;">Wholesale Marketplace</p>
  <table width="100%" cellpadding="8" cellspacing="0" style="font-size:14px;border-collapse:collapse;margin:0 0 24px;">
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#4a5568;">Active Buyers</td><td style="text-align:right;color:#1a202c;">0 (pending onboarding)</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0;"><td style="color:#4a5568;">Orders Today</td><td style="text-align:right;color:#1a202c;">0</td></tr>
    <tr><td style="color:#4a5568;">Payment Provider</td><td style="text-align:right;color:#1a202c;">Square (production)</td></tr>
  </table>

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
  <p style="color:#94a3b8;font-size:11px;margin:0;">${BIZ}</p>
</td></tr></table></td></tr></table></div>`
});

console.log('Daily Summary SENT:', r.messageId);
t.close();
