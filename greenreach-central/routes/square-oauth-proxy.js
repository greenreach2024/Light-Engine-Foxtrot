/**
 * Central-owned Square payment control plane.
 *
 * This router is mounted on both:
 * - /api/farm/square   (canonical farm payment API)
 * - /api/square-proxy  (compatibility alias for existing admin UI calls)
 *
 * Governance model:
 * - Control-plane actions (status/connect/disconnect/settings/capabilities) terminate in Central.
 * - LE acts as a thin client/proxy and never as the authority.
 */
import express from 'express';
import crypto from 'crypto';

import logger from '../utils/logger.js';
import { authOrAdminMiddleware } from '../middleware/auth.js';
import { farmStore } from '../lib/farm-data-store.js';

const router = express.Router();

const SQUARE_APP_ID = process.env.SQUARE_APP_ID || process.env.SQUARE_APPLICATION_ID || null;
const SQUARE_APP_SECRET = process.env.SQUARE_APP_SECRET || process.env.SQUARE_APPLICATION_SECRET || null;
const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || 'sandbox';
const SQUARE_BASE = SQUARE_ENVIRONMENT === 'production'
  ? 'https://connect.squareup.com'
  : 'https://connect.squareupsandbox.com';
const SQUARE_API_BASE = SQUARE_ENVIRONMENT === 'production'
  ? 'https://connect.squareup.com'
  : 'https://connect.squareupsandbox.com';

const OAUTH_STATE_SECRET =
  process.env.PAYMENT_OAUTH_STATE_SECRET
  || process.env.JWT_SECRET
  || process.env.GREENREACH_API_KEY
  || 'square-oauth-dev-secret';

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
    if (!farmId) {
      throw createHttpError(400, 'farmId is required for this action');
    }
    return farmId;
  }

  if (!callerFarmId) {
    throw createHttpError(401, 'Authentication required');
  }
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
  if (parts.length !== 2) {
    throw createHttpError(400, 'Invalid OAuth state');
  }

  const [encodedPayload, signature] = parts;
  const expectedSignature = signState(encodedPayload);
  const sigBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expectedSignature, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw createHttpError(400, 'OAuth state signature mismatch');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    throw createHttpError(400, 'Invalid OAuth state payload');
  }

  return payload;
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

function getSquareRedirectUri(req) {
  const configured = cleanString(process.env.FARM_SQUARE_REDIRECT_URI);
  if (configured) return configured;

  const host = cleanString(req.get('host')) || 'greenreachgreens.com';
  const proto = cleanString(req.get('x-forwarded-proto')) || req.protocol || 'https';
  return `${proto}://${host}/api/farm/square/callback`;
}

function toCompatAuthorizePayload({ farmId, authorizationUrl, state }) {
  return {
    ok: true,
    status: 'ok',
    data: {
      farm_id: farmId,
      farmId,
      state,
      authorizationUrl,
      authorization_url: authorizationUrl,
    },
  };
}

async function appendPaymentAudit(farmId, event) {
  try {
    const existing = await farmStore.get(farmId, 'payment_control_audit');
    const history = Array.isArray(existing) ? existing : [];
    history.push({
      timestamp: new Date().toISOString(),
      provider: 'square',
      ...event,
    });
    if (history.length > MAX_AUDIT_ENTRIES) {
      history.splice(0, history.length - MAX_AUDIT_ENTRIES);
    }
    await farmStore.set(farmId, 'payment_control_audit', history);
  } catch (err) {
    logger.warn('[SquareControl] Failed to append payment audit:', err.message);
  }
}

async function loadSquareRecord(farmId) {
  const record = await farmStore.get(farmId, 'square_oauth');
  return (record && typeof record === 'object') ? record : null;
}

function buildSquareStatusPayload(record, settings) {
  const connected = Boolean(record?.access_token);
  return {
    ok: true,
    connected,
    status: connected ? 'connected' : 'not_connected',
    data: connected
      ? {
          merchantId: record.merchant_id || null,
          merchant_id: record.merchant_id || null,
          locationId: record.location_id || null,
          location_id: record.location_id || null,
          locationName: record.location_name || null,
          location_name: record.location_name || null,
          connectedAt: record.connected_at || null,
          connected_at: record.connected_at || null,
          capabilities: {
            scopes: Array.isArray(record.scopes) ? record.scopes : [],
            payments: true,
            refunds: true,
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
    configured: Boolean(SQUARE_APP_ID && SQUARE_APP_SECRET),
    environment: SQUARE_ENVIRONMENT,
    authority: 'central',
    message: SQUARE_APP_ID && SQUARE_APP_SECRET
      ? 'Central Square control plane is ready'
      : 'Square not configured — set SQUARE_APP_ID and SQUARE_APP_SECRET',
  });
});

router.get('/status', async (req, res) => {
  try {
    const farmId = resolveFarmId(req);
    const [record, settings] = await Promise.all([
      loadSquareRecord(farmId),
      farmStore.get(farmId, 'square_payment_settings').catch(() => null),
    ]);
    return res.json(buildSquareStatusPayload(record, settings));
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

async function authorizeHandler(req, res) {
  if (!SQUARE_APP_ID || !SQUARE_APP_SECRET) {
    return res.status(503).json({ ok: false, error: 'Square OAuth is not configured on Central' });
  }

  try {
    const farmId = resolveFarmId(req);
    const farmName = cleanString(req.body?.farmName || req.body?.farm_name || req.query?.farmName || req.query?.farm_name);
    const nonce = crypto.randomUUID();
    const payload = {
      provider: 'square',
      farm_id: farmId,
      nonce,
      ts: Date.now(),
      actor: cleanString(req.user?.userId || req.user?.email || req.user?.farmId || 'unknown'),
    };

    rememberOAuthState(payload);
    const state = createSignedState(payload);
    const redirectUri = getSquareRedirectUri(req);

    const scope = [
      'ITEMS_READ', 'ITEMS_WRITE',
      'ORDERS_READ', 'ORDERS_WRITE',
      'PAYMENTS_READ', 'PAYMENTS_WRITE',
      'MERCHANT_PROFILE_READ',
      'CUSTOMERS_READ', 'CUSTOMERS_WRITE',
      'INVOICES_READ', 'INVOICES_WRITE',
      'REFUNDS_WRITE'
    ].join('+');

    const authorizationUrl = `${SQUARE_BASE}/oauth2/authorize?${new URLSearchParams({
      client_id: SQUARE_APP_ID,
      scope,
      session: 'false',
      state,
      redirect_uri: redirectUri,
    }).toString()}`;

    await appendPaymentAudit(farmId, {
      action: 'authorize_requested',
      actor: payload.actor,
      farm_name: farmName || null,
      endpoint: req.baseUrl,
    });

    return res.json(toCompatAuthorizePayload({ farmId, authorizationUrl, state }));
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

router.post('/authorize', express.json(), authorizeHandler);
router.get('/authorize', authorizeHandler);

router.get('/callback', async (req, res) => {
  const sendCallbackHtml = (ok, message, signalData = {}) => {
    const statusTitle = ok ? 'Square Connected' : 'Square Connection Failed';
    const safeMessage = cleanString(message).replace(/[<>]/g, '');
    const signalPayload = JSON.stringify({
      type: ok ? 'square-connected' : 'square-error',
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
        try {
          localStorage.setItem('square_connected_signal', JSON.stringify(signalData));
        } catch (e) {}
        setTimeout(function () { window.close(); }, 350);
      }());
    </script>
  </body>
</html>`);
  };

  try {
    if (!SQUARE_APP_ID || !SQUARE_APP_SECRET) {
      return sendCallbackHtml(false, 'Square OAuth is not configured on Central.');
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
    if (!farmId) {
      return sendCallbackHtml(false, 'No farm context found in OAuth state.');
    }

    const tokenResponse = await fetch(`${SQUARE_BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SQUARE_APP_ID,
        client_secret: SQUARE_APP_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: getSquareRedirectUri(req),
      }),
      signal: AbortSignal.timeout(15000),
    });

    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.access_token) {
      logger.warn('[SquareControl] Token exchange failed:', tokenData);
      return sendCallbackHtml(false, tokenData?.message || 'Token exchange failed.');
    }

    let locationId = null;
    let locationName = null;
    try {
      const locationsResponse = await fetch(`${SQUARE_API_BASE}/v2/locations`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(12000),
      });
      const locationsData = await locationsResponse.json().catch(() => ({}));
      if (locationsResponse.ok && Array.isArray(locationsData.locations) && locationsData.locations.length > 0) {
        locationId = locationsData.locations[0].id || null;
        locationName = locationsData.locations[0].name || null;
      }
    } catch (locationErr) {
      logger.warn('[SquareControl] Could not fetch locations during callback:', locationErr.message);
    }

    const nowIso = new Date().toISOString();
    const existing = await loadSquareRecord(farmId);
    const record = {
      ...(existing || {}),
      provider: 'square',
      status: 'connected',
      connected_at: existing?.connected_at || nowIso,
      updated_at: nowIso,
      merchant_id: tokenData.merchant_id || existing?.merchant_id || null,
      location_id: locationId || existing?.location_id || null,
      location_name: locationName || existing?.location_name || null,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || existing?.refresh_token || null,
      expires_at: tokenData.expires_at || existing?.expires_at || null,
      scopes: Array.isArray(tokenData.scopes) ? tokenData.scopes : (existing?.scopes || []),
    };

    await farmStore.set(farmId, 'square_oauth', record);
    await appendPaymentAudit(farmId, {
      action: 'oauth_connected',
      actor: cleanString(statePayload.actor || 'oauth-callback'),
      merchant_id: record.merchant_id,
      location_id: record.location_id,
      location_name: record.location_name,
    });

    return sendCallbackHtml(true, 'Square account connected successfully.', {
      farmId,
      merchantId: record.merchant_id,
      locationId: record.location_id,
      locationName: record.location_name,
    });
  } catch (err) {
    logger.error('[SquareControl] Callback error:', err.message);
    return res.status(500).type('html').send('Square callback failed. Please retry.');
  }
});

router.post('/refresh', express.json(), async (req, res) => {
  try {
    if (!SQUARE_APP_ID || !SQUARE_APP_SECRET) {
      return res.status(503).json({ ok: false, error: 'Square OAuth is not configured on Central' });
    }
    const farmId = resolveFarmId(req);
    const record = await loadSquareRecord(farmId);
    if (!record?.refresh_token) {
      return res.status(404).json({ ok: false, error: 'Square account not connected or refresh token missing' });
    }

    const refreshResponse = await fetch(`${SQUARE_BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SQUARE_APP_ID,
        client_secret: SQUARE_APP_SECRET,
        grant_type: 'refresh_token',
        refresh_token: record.refresh_token,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const refreshData = await refreshResponse.json().catch(() => ({}));
    if (!refreshResponse.ok || !refreshData.access_token) {
      return res.status(502).json({ ok: false, error: refreshData?.message || 'Square refresh failed' });
    }

    const nowIso = new Date().toISOString();
    const updated = {
      ...record,
      access_token: refreshData.access_token,
      refresh_token: refreshData.refresh_token || record.refresh_token,
      expires_at: refreshData.expires_at || record.expires_at,
      updated_at: nowIso,
    };
    await farmStore.set(farmId, 'square_oauth', updated);
    await appendPaymentAudit(farmId, {
      action: 'token_refreshed',
      actor: cleanString(req.user?.userId || req.user?.email || req.user?.farmId || 'unknown'),
    });

    return res.json({ ok: true, status: 'ok', message: 'Square token refreshed', data: { farm_id: farmId } });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

router.post('/settings', express.json(), async (req, res) => {
  try {
    const farmId = resolveFarmId(req);
    const existing = await farmStore.get(farmId, 'square_payment_settings').catch(() => ({}));
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

    await farmStore.set(farmId, 'square_payment_settings', settings);
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
    const record = await loadSquareRecord(farmId);
    if (!record?.access_token) {
      return res.status(404).json({ ok: false, status: 'error', error: 'No Square account connected' });
    }

    if (SQUARE_APP_ID && record.access_token) {
      try {
        await fetch(`${SQUARE_BASE}/oauth2/revoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: SQUARE_APP_ID,
            access_token: record.access_token,
          }),
          signal: AbortSignal.timeout(10000),
        });
      } catch (revokeErr) {
        logger.warn('[SquareControl] Revoke warning:', revokeErr.message);
      }
    }

    await farmStore.remove(farmId, 'square_oauth');
    await appendPaymentAudit(farmId, {
      action: 'disconnected',
      actor: cleanString(req.user?.userId || req.user?.email || req.user?.farmId || 'unknown'),
    });

    return res.json({
      ok: true,
      status: 'ok',
      message: 'Square account disconnected successfully',
      data: { farm_id: farmId, disconnected: true },
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, status: 'error', error: err.message });
  }
}

router.post('/disconnect', express.json(), disconnectHandler);
router.post('/disconnect/:farmId', express.json(), disconnectHandler);

router.post('/test-payment', express.json(), async (req, res) => {
  try {
    const farmId = resolveFarmId(req);
    const record = await loadSquareRecord(farmId);
    if (!record?.access_token) {
      return res.status(404).json({ ok: false, error: 'Square account not connected' });
    }

    const testResponse = await fetch(`${SQUARE_API_BASE}/v2/locations`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${record.access_token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(12000),
    });

    const testData = await testResponse.json().catch(() => ({}));
    if (!testResponse.ok) {
      return res.status(502).json({ ok: false, error: testData?.message || 'Square connectivity check failed' });
    }

    const locations = Array.isArray(testData.locations) ? testData.locations : [];
    return res.json({
      ok: true,
      message: 'Square connection verified',
      data: {
        farm_id: farmId,
        locations: locations.map((loc) => ({ id: loc.id, name: loc.name, status: loc.status })),
      },
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

export default router;
