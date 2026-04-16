import { query, isDatabaseAvailable } from '../config/database.js';
import logger from '../utils/logger.js';
import emailService from './email-service.js';
import { sendAgentMessage } from './faye-learning.js';

const TAG = '[SupportBridge]';
const DEFAULT_SUPPORT_EMAIL = 'admin@greenreachgreens.com';

let supportRequestsTableEnsured = false;

async function ensureSupportRequestsTable() {
  if (supportRequestsTableEnsured || !isDatabaseAvailable()) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS support_requests (
        id SERIAL PRIMARY KEY,
        farm_id VARCHAR(64),
        source_agent VARCHAR(20) NOT NULL DEFAULT 'evie',
        source_channel VARCHAR(30) NOT NULL DEFAULT 'assistant-chat',
        subject VARCHAR(200) NOT NULL,
        body TEXT NOT NULL,
        priority VARCHAR(10) NOT NULL DEFAULT 'normal',
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        requested_by_name VARCHAR(200),
        requested_by_email VARCHAR(255),
        requested_by_phone VARCHAR(50),
        conversation_id VARCHAR(128),
        context JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    supportRequestsTableEnsured = true;
  } catch (err) {
    logger.warn(`${TAG} Failed to ensure support_requests table: ${err.message}`);
  }
}

export async function listSupportRequests({ status = 'open', farmId = null, priority = null, limit = 25 } = {}) {
  if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
  await ensureSupportRequestsTable();

  try {
    const values = [];
    let idx = 1;
    let sql = `
      SELECT id, farm_id, source_agent, source_channel, subject, body, priority, status,
             requested_by_name, requested_by_email, requested_by_phone, conversation_id,
             context, created_at, updated_at
      FROM support_requests
      WHERE 1=1
    `;

    if (status && status !== 'all') {
      sql += ` AND status = $${idx++}`;
      values.push(status);
    }
    if (farmId) {
      sql += ` AND farm_id = $${idx++}`;
      values.push(farmId);
    }
    if (priority) {
      sql += ` AND priority = $${idx++}`;
      values.push(priority);
    }

    sql += ` ORDER BY
      CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      created_at DESC
      LIMIT $${idx++}`;
    values.push(Math.max(1, Math.min(parseInt(limit, 10) || 25, 100)));

    const result = await query(sql, values);
    return { ok: true, count: result.rows.length, requests: result.rows };
  } catch (err) {
    logger.error(`${TAG} Failed to list support requests: ${err.message}`);
    return { ok: false, error: 'Failed to list support requests' };
  }
}

export async function resolveSupportRequest(requestId, resolutionNotes = '') {
  if (!isDatabaseAvailable()) return { ok: false, error: 'Database unavailable' };
  await ensureSupportRequestsTable();

  try {
    const noteText = String(resolutionNotes || '').trim();
    const contextPatch = noteText ? { resolution_notes: noteText, resolved_at: new Date().toISOString() } : { resolved_at: new Date().toISOString() };
    const result = await query(
      `UPDATE support_requests
       SET status = 'resolved',
           updated_at = NOW(),
           context = COALESCE(context, '{}'::jsonb) || $2::jsonb
       WHERE id = $1 AND status <> 'resolved'
       RETURNING id, farm_id, subject, status, updated_at`,
      [parseInt(requestId, 10), JSON.stringify(contextPatch)]
    );

    if (result.rows.length === 0) {
      return { ok: false, error: 'Support request not found or already resolved' };
    }

    return { ok: true, request: result.rows[0] };
  } catch (err) {
    logger.error(`${TAG} Failed to resolve support request: ${err.message}`);
    return { ok: false, error: 'Failed to resolve support request' };
  }
}

function getSupportInbox() {
  return process.env.SUPPORT_EMAIL
    || process.env.ADMIN_EMAIL
    || DEFAULT_SUPPORT_EMAIL
    || process.env.ADMIN_ALERT_EMAIL
}

async function getFarmContactDetails(farmId) {
  if (!farmId || !isDatabaseAvailable()) {
    return { name: '', contact_name: '', email: '', contact_phone: '' };
  }

  try {
    const result = await query(
      `SELECT name, contact_name, email, contact_phone
       FROM farms WHERE farm_id = $1`,
      [farmId]
    );
    return result.rows[0] || { name: '', contact_name: '', email: '', contact_phone: '' };
  } catch (err) {
    logger.warn(`${TAG} Failed to load farm contact details: ${err.message}`);
    return { name: '', contact_name: '', email: '', contact_phone: '' };
  }
}

function buildEmailText({ requestId, farmId, farm, subject, body, priority, sourceChannel, conversationId, context }) {
  return [
    `GreenReach support request${requestId ? ` #${requestId}` : ''}`,
    '',
    `Subject: ${subject}`,
    `Priority: ${priority}`,
    `Source: ${sourceChannel}`,
    `Farm ID: ${farmId || 'unknown'}`,
    `Farm Name: ${farm.name || 'unknown'}`,
    `Contact Name: ${farm.contact_name || 'unknown'}`,
    `Contact Email: ${farm.email || 'unknown'}`,
    `Contact Phone: ${farm.contact_phone || 'unknown'}`,
    conversationId ? `Conversation ID: ${conversationId}` : null,
    '',
    'Grower request:',
    body,
    '',
    context && Object.keys(context).length > 0 ? `Context: ${JSON.stringify(context, null, 2)}` : null
  ].filter(Boolean).join('\n');
}

export async function createSupportRequest({
  farmId,
  subject,
  body,
  priority = 'normal',
  conversationId = null,
  sourceAgent = 'evie',
  sourceChannel = 'assistant-chat',
  context = {}
}) {
  const cleanSubject = String(subject || '').trim().slice(0, 200);
  const cleanBody = String(body || '').trim().slice(0, 4000);
  const cleanPriority = ['low', 'normal', 'high', 'critical'].includes(priority) ? priority : 'normal';

  if (!cleanSubject || !cleanBody) {
    return { ok: false, error: 'subject and body are required' };
  }

  if (!isDatabaseAvailable()) {
    return { ok: false, error: 'Database unavailable' };
  }

  await ensureSupportRequestsTable();
  const farm = await getFarmContactDetails(farmId);

  let requestRow;
  try {
    const result = await query(
      `INSERT INTO support_requests (
         farm_id, source_agent, source_channel, subject, body, priority, status,
         requested_by_name, requested_by_email, requested_by_phone, conversation_id, context,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10, $11, NOW(), NOW())
       RETURNING id, status, created_at`,
      [
        farmId || null,
        sourceAgent,
        sourceChannel,
        cleanSubject,
        cleanBody,
        cleanPriority,
        farm.contact_name || null,
        farm.email || null,
        farm.contact_phone || null,
        conversationId || null,
        JSON.stringify(context || {})
      ]
    );
    requestRow = result.rows[0];
  } catch (err) {
    logger.error(`${TAG} Failed to persist support request: ${err.message}`);
    return { ok: false, error: 'Failed to persist support request' };
  }

  const supportInbox = getSupportInbox();
  const emailText = buildEmailText({
    requestId: requestRow.id,
    farmId,
    farm,
    subject: cleanSubject,
    body: cleanBody,
    priority: cleanPriority,
    sourceChannel,
    conversationId,
    context
  });

  const emailResult = await emailService.sendEmail({
    to: supportInbox,
    subject: `[Support Request #${requestRow.id}] ${cleanSubject}`,
    text: emailText,
    html: `<div style="font-family:sans-serif;max-width:700px">
      <h3 style="color:#0f766e">GreenReach Support Request #${requestRow.id}</h3>
      <p><strong>Subject:</strong> ${cleanSubject.replace(/</g, '&lt;')}</p>
      <p><strong>Priority:</strong> ${cleanPriority}</p>
      <p><strong>Farm:</strong> ${(farm.name || 'unknown').replace(/</g, '&lt;')} (${String(farmId || 'unknown').replace(/</g, '&lt;')})</p>
      <p><strong>Contact:</strong> ${(farm.contact_name || 'unknown').replace(/</g, '&lt;')} | ${(farm.email || 'unknown').replace(/</g, '&lt;')} | ${(farm.contact_phone || 'unknown').replace(/</g, '&lt;')}</p>
      ${conversationId ? `<p><strong>Conversation:</strong> ${String(conversationId).replace(/</g, '&lt;')}</p>` : ''}
      <hr style="border:none;border-top:1px solid #ddd;margin:20px 0">
      <div style="white-space:pre-wrap">${cleanBody.replace(/</g, '&lt;')}</div>
    </div>`
  });

  let fayeMessageId = null;
  try {
    const fayeMessage = await sendAgentMessage(
      'evie',
      'faye',
      'escalation',
      `Support Request #${requestRow.id}: ${cleanSubject}`.slice(0, 200),
      [
        'A grower explicitly asked GreenReach staff for help.',
        `Support request ID: ${requestRow.id}`,
        `Priority: ${cleanPriority}`,
        `Farm ID: ${farmId || 'unknown'}`,
        `Farm Name: ${farm.name || 'unknown'}`,
        `Contact: ${farm.contact_name || 'unknown'} | ${farm.email || 'unknown'} | ${farm.contact_phone || 'unknown'}`,
        '',
        cleanBody
      ].join('\n'),
      {
        ...(context || {}),
        farm_id: farmId || null,
        support_request_id: requestRow.id,
        support_email: supportInbox
      },
      cleanPriority
    );
    fayeMessageId = fayeMessage?.id || null;
  } catch (err) {
    logger.warn(`${TAG} Failed to notify F.A.Y.E.: ${err.message}`);
  }

  return {
    ok: true,
    request_id: requestRow.id,
    status: requestRow.status,
    support_email: supportInbox,
    staff_notified: !!emailResult?.success,
    email_message_id: emailResult?.messageId || null,
    faye_message_id: fayeMessageId
  };
}