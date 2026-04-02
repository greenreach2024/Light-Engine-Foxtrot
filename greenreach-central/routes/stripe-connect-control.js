/**
 * Central-owned Stripe Connect payment control plane.
 *
 * Mounted at /api/farm/stripe.
 * LE should call these endpoints as a thin client; Central remains authority.
 */
import express from 'express';
import crypto from 'crypto';

import logger from '../utils/logger.js';
import { authOrAdminMiddleware } from '../middleware/auth.js';
import { farmStore } from '../lib/farm-data-store.js';

const router = express.Router();

const STRIPE_CONNECT_CLIENT_ID =
  process.env.STRIPE_CONNECT_CLIENT_ID
  || process.env.STRIPE_CLIENT_ID
  || null;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || null;

const OAUTH_STATE_SECRET =
  process.env.PAYMENT_OAUTH_STATE_SECRET
  || process.env.JWT_SECRET
  || process.env.GREENREACH_API_KEY
  || 'stripe-oauth-dev-secret';

const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
const MAX_AUDIT_ENTRIES = 250;
const oauthStateStore = new Map();

function cleanString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function createHttpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isPrivilegedRequest(req) {
  return Boolean(
    req.admin
    || req.user?.authMethod === 'admin-jwt'
    || req.user?.role === 'superadmin'
    || req.user?.farmId === 'ADMIN'
  );
}

function resolveFarmId(req) {
  const requestedFarmId = cleanString(
    req.params?.farmId
    || req.body?.farmId
    || req.body?.farm_id
    || req.query?.farmId
    || req.query?.farm_id
    || req.headers['x-farm-id']
  );
  const callerFarmId = cleanString(req.user?.farmId);

  if (isPrivilegedRequest(req)) {
    const farmId = requestedFarmId || (callerFarmId && callerFarmId !== 'ADMIN' ? callerFarmId : '');
    if (!farmId) throw createHttpError(400, 'farmId is required for this action');
    return farmId;
  }

  if (!callerFarmId) throw createHttpError(401, 'Authentication required');
  if (requestedFarmId && requestedFarmId !== callerFarmId) {
    throw createHttpError(403, 'Cross-farm payment control is not allowed');
  }
  return callerFarmId;
}

function signState(encodedPayload) {
  return crypto
    .createHmac('sha256', OAUTH_STATE_SECRET)
    .update(encodedPayload)
    .digest('base64url');
}

function createSignedState(payload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = signState(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function parseAndVerifyState(stateToken) {
  const token = cleanString(stateToken);
  const parts = token.split('.');
  if (parts.length !== 2) throw createHttpError(400, 'Invalid OAuth state');

  const [encodedPayload, signature] = parts;
  const expectedSignature = signState(encodedPayload);
  const sigBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expectedSignature, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw createHttpError(400, 'OAuth state signature mismatch');
  }

  try {
    return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    throw createHttpError(400, 'Invalid OAuth state payload');
  }
}

function rememberOAuthState(payload) {
  oauthStateStore.set(payload.nonce, {
    ...payload,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
  });
}

function consumeOAuthState(nonce) {
  const key = cleanString(nonce);
  if (!key) return null;
  const entry = oauthStateStore.get(key) || null;
  oauthStateStore.delete(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) return null;
  return entry;
}

function getStripeRedirectUri(req) {
  const configured = cleanString(process.env.STRIPE_REDIRECT_URI);
  if (configured) return configured;

  const host = cleanString(req.get('host')) || 'greenreachgreens.com';
  const proto = cleanString(req.get('x-forwarded-proto')) || req.protocol || 'https';
  return `${proto}://${host}/api/farm/stripe/callback`;
}

async function appendPaymentAudit(farmId, event) {
  try {
    const existing = await farmStore.get(farmId, 'payment_control_audit');
    const history = Array.isArray(existing) ? existing : [];
    history.push({
      timestamp: new Date().toISOString(),
      provider: 'stripe',
      ...event,
    });
    if (history.length > MAX_AUDIT_ENTRIES) {
      history.splice(0, history.length - MAX_AUDIT_ENTRIES);
    }
    await farmStore.set(farmId, 'payment_control_audit', history);
  } catch (err) {
    logger.warn('[StripeControl] Failed to append payment audit:', err.message);
  }
}

async function loadStripeRecord(farmId) {
  const record = await farmStore.get(farmId, 'stripe_oauth');
  return (record && typeof record === 'object') ? record : null;
}

async function fetchStripeAccountDetails(accountId) {
  if (!STRIPE_SECRET_KEY || !accountId) return null;

  const response = await fetch(`https://api.stripe.com/v1/accounts/${encodeURIComponent(accountId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) return null;
  return response.json().catch(() => null);
}

function toFormBody(payload) {
  return new URLSearchParams(payload).toString();
}

function buildStripeStatusPayload(record, settings, accountDetails = null) {
  const connected = Boolean(record?.account_id);
  const businessName =
    accountDetails?.business_profile?.name
    || accountDetails?.company?.name
    || record?.business_name
    || null;

  return {
    ok: true,
    connected,
    status: connected ? 'connected' : 'not_connected',
    data: connected
      ? {
          accountId: record.account_id,
          account_id: record.account_id,
          businessName,
          connectedAt: record.connected_at || null,
          connected_at: record.connected_at || null,
          capabilities: {
            charges_enabled: Boolean(accountDetails?.charges_enabled),
            payouts_enabled: Boolean(accountDetails?.payouts_enabled),
            details_submitted: Boolean(accountDetails?.details_submitted),
          },
          fee_policy: settings || {},
        }
      : null,
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [nonce, entry] of oauthStateStore.entries()) {
    if (!entry || entry.expiresAt < now) {
      oauthStateStore.delete(nonce);
    }
  }
}, 5 * 60 * 1000).unref();

// Callback must remain public for OAuth redirect traffic.
router.use((req, res, next) => {
  if (req.path === '/callback') return next();
  return authOrAdminMiddleware(req, res, next);
});

router.get('/', (_req, res) => {
  res.json({
    ok: true,
    status: 'ok',
    configured: Boolean(STRIPE_CONNECT_CLIENT_ID && STRIPE_SECRET_KEY),
    authority: 'central',
    message: STRIPE_CONNECT_CLIENT_ID && STRIPE_SECRET_KEY
      ? 'Central Stripe control plane is ready'
      : 'Stripe Connect is not configured on Central',
  });
});

router.get('/status', async (req, res) => {
  try {
    const farmId = resolveFarmId(req);
    const [record, settings] = await Promise.all([
      loadStripeRecord(farmId),
      farmStore.get(farmId, 'stripe_payment_settings').catch(() => null),
    ]);
    const accountDetails = record?.account_id
      ? await fetchStripeAccountDetails(record.account_id).catch(() => null)
      : null;

    return res.json(buildStripeStatusPayload(record, settings, accountDetails));
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

async function authorizeHandler(req, res) {
  if (!STRIPE_CONNECT_CLIENT_ID || !STRIPE_SECRET_KEY) {
    return res.status(503).json({ ok: false, error: 'Stripe Connect is not configured on Central' });
  }

  try {
    const farmId = resolveFarmId(req);
    const farmName = cleanString(req.body?.farmName || req.body?.farm_name || req.query?.farmName || req.query?.farm_name);
    const nonce = crypto.randomUUID();
    const payload = {
      provider: 'stripe',
      farm_id: farmId,
      nonce,
      ts: Date.now(),
      actor: cleanString(req.user?.userId || req.user?.email || req.user?.farmId || 'unknown'),
    };

    rememberOAuthState(payload);
    const state = createSignedState(payload);
    const redirectUri = getStripeRedirectUri(req);

    const authParams = new URLSearchParams({
      response_type: 'code',
      client_id: STRIPE_CONNECT_CLIENT_ID,
      scope: 'read_write',
      state,
      redirect_uri: redirectUri,
    });
    if (farmName) {
      authParams.set('stripe_user[business_name]', farmName);
    }

    const authorizationUrl = `https://connect.stripe.com/oauth/authorize?${authParams.toString()}`;

    await appendPaymentAudit(farmId, {
      action: 'authorize_requested',
      actor: payload.actor,
      farm_name: farmName || null,
    });

    return res.json({
      ok: true,
      status: 'ok',
      data: {
        farm_id: farmId,
        farmId,
        state,
        authorizationUrl,
        authorization_url: authorizationUrl,
      },
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

router.post('/authorize', express.json(), authorizeHandler);
router.get('/authorize', authorizeHandler);

router.get('/callback', async (req, res) => {
  const sendCallbackHtml = (ok, message, signalData = {}) => {
    const statusTitle = ok ? 'Stripe Connected' : 'Stripe Connection Failed';
    const safeMessage = cleanString(message).replace(/[<>]/g, '');
    const signalPayload = JSON.stringify({
      type: ok ? 'stripe-connected' : 'stripe-error',
      ...signalData,
    });

    res.status(ok ? 200 : 400).type('html').send(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${statusTitle}</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f7faf7; color: #1f2937; margin: 0; padding: 24px; }
      .card { max-width: 560px; margin: 28px auto; background: #fff; border: 1px solid #d1d5db; border-radius: 12px; padding: 24px; }
      h1 { margin-top: 0; font-size: 24px; }
      .ok { color: #166534; }
      .err { color: #991b1b; }
      p { line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1 class="${ok ? 'ok' : 'err'}">${statusTitle}</h1>
      <p>${safeMessage}</p>
      <p>You can close this window and return to GreenReach.</p>
    </div>
    <script>
      (function () {
        var signalData = ${signalPayload};
        try {
          if (window.opener) {
            window.opener.postMessage(signalData, '*');
          }
        } catch (e) {}
        setTimeout(function () { window.close(); }, 350);
      }());
    </script>
  </body>
</html>`);
  };

  try {
    if (!STRIPE_CONNECT_CLIENT_ID || !STRIPE_SECRET_KEY) {
      return sendCallbackHtml(false, 'Stripe Connect is not configured on Central.');
    }

    const code = cleanString(req.query?.code);
    const stateToken = cleanString(req.query?.state);
    const oauthError = cleanString(req.query?.error_description || req.query?.error);
    if (oauthError) {
      return sendCallbackHtml(false, oauthError);
    }
    if (!code || !stateToken) {
      return sendCallbackHtml(false, 'Missing OAuth code or state.');
    }

    const statePayload = parseAndVerifyState(stateToken);
    const storedState = consumeOAuthState(statePayload.nonce);
    if (!storedState) {
      return sendCallbackHtml(false, 'OAuth state expired. Please retry the connection flow.');
    }

    const farmId = cleanString(statePayload.farm_id || storedState.farm_id);
    if (!farmId) return sendCallbackHtml(false, 'No farm context found in OAuth state.');

    const tokenResponse = await fetch('https://connect.stripe.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: toFormBody({
        grant_type: 'authorization_code',
        code,
        client_secret: STRIPE_SECRET_KEY,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.stripe_user_id) {
      logger.warn('[StripeControl] Token exchange failed:', tokenData);
      return sendCallbackHtml(false, tokenData?.error_description || tokenData?.error || 'Token exchange failed.');
    }

    const nowIso = new Date().toISOString();
    const existing = await loadStripeRecord(farmId);
    const accountDetails = await fetchStripeAccountDetails(tokenData.stripe_user_id).catch(() => null);
    const businessName =
      accountDetails?.business_profile?.name
      || accountDetails?.company?.name
      || existing?.business_name
      || null;

    const record = {
      ...(existing || {}),
      provider: 'stripe',
      status: 'connected',
      connected_at: existing?.connected_at || nowIso,
      updated_at: nowIso,
      account_id: tokenData.stripe_user_id,
      access_token: tokenData.access_token || null,
      refresh_token: tokenData.refresh_token || null,
      scope: tokenData.scope || null,
      livemode: Boolean(tokenData.livemode),
      business_name: businessName,
    };

    await farmStore.set(farmId, 'stripe_oauth', record);
    await appendPaymentAudit(farmId, {
      action: 'oauth_connected',
      actor: cleanString(statePayload.actor || 'oauth-callback'),
      account_id: record.account_id,
      business_name: record.business_name,
    });

    return sendCallbackHtml(true, 'Stripe account connected successfully.', {
      farmId,
      accountId: record.account_id,
      businessName: record.business_name,
    });
  } catch (err) {
    logger.error('[StripeControl] Callback error:', err.message);
    return res.status(500).type('html').send('Stripe callback failed. Please retry.');
  }
});

router.post('/settings', express.json(), async (req, res) => {
  try {
    const farmId = resolveFarmId(req);
    const existing = await farmStore.get(farmId, 'stripe_payment_settings').catch(() => ({}));

    const feePercentRaw = Number(req.body?.application_fee_percent ?? req.body?.app_fee_percent ?? existing?.application_fee_percent ?? 0);
    const feePercent = Number.isFinite(feePercentRaw)
      ? Math.max(0, Math.min(100, feePercentRaw))
      : 0;

    const settings = {
      ...(existing && typeof existing === 'object' ? existing : {}),
      application_fee_percent: feePercent,
      fee_policy: cleanString(req.body?.fee_policy || existing?.fee_policy || ''),
      settlement_mode: cleanString(req.body?.settlement_mode || existing?.settlement_mode || ''),
      updated_at: new Date().toISOString(),
      updated_by: cleanString(req.user?.userId || req.user?.email || req.user?.farmId || 'unknown'),
    };

    await farmStore.set(farmId, 'stripe_payment_settings', settings);
    await appendPaymentAudit(farmId, {
      action: 'settings_updated',
      actor: settings.updated_by,
      application_fee_percent: settings.application_fee_percent,
    });

    return res.json({ ok: true, status: 'ok', data: settings });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

async function disconnectHandler(req, res) {
  try {
    const farmId = resolveFarmId(req);
    const record = await loadStripeRecord(farmId);
    if (!record?.account_id) {
      return res.status(404).json({ ok: false, error: 'No Stripe account connected' });
    }

    if (STRIPE_CONNECT_CLIENT_ID && STRIPE_SECRET_KEY && record.account_id) {
      try {
        await fetch('https://connect.stripe.com/oauth/deauthorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: toFormBody({
            client_id: STRIPE_CONNECT_CLIENT_ID,
            stripe_user_id: record.account_id,
          }),
          signal: AbortSignal.timeout(10000),
        });
      } catch (deauthErr) {
        logger.warn('[StripeControl] Deauthorize warning:', deauthErr.message);
      }
    }

    await farmStore.remove(farmId, 'stripe_oauth');
    await appendPaymentAudit(farmId, {
      action: 'disconnected',
      actor: cleanString(req.user?.userId || req.user?.email || req.user?.farmId || 'unknown'),
    });

    return res.json({
      ok: true,
      status: 'ok',
      message: 'Stripe account disconnected successfully',
      data: { farm_id: farmId, disconnected: true },
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

router.post('/disconnect', express.json(), disconnectHandler);
router.post('/disconnect/:farmId', express.json(), disconnectHandler);

export default router;
