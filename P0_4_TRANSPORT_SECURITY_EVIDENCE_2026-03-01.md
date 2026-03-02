# P0-4 Transport Security Evidence Package — 2026-03-01

Status: ✅ Complete (evidence consolidated)

## Scope

This package closes P0-4 from `PRIORITIZED_BUILD_CHECKLIST_2026-03-01.md` by recording:

1. CloudFront distribution ID
2. ACM certificate ARN
3. Production `FOXTROT_API_URL`
4. HTTPS endpoint and certificate validation evidence
5. Webhook signature verification evidence in production paths

---

## Acceptance Mapping

### A1) Evidence package includes successful HTTPS checks and cert chain validation

#### Live verification (executed in workspace)

```bash
curl -sSI https://foxtrot.greenreachgreens.com/health | head -n 20
openssl s_client -connect foxtrot.greenreachgreens.com:443 -servername foxtrot.greenreachgreens.com </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates
```

Observed output:

- `HTTP/2 200`
- `subject=CN=foxtrot.greenreachgreens.com`
- `issuer=C=US, O=Amazon, CN=Amazon RSA 2048 M04`
- Validity window present (`notBefore`/`notAfter`)

#### Prior deployment evidence

From `PHASE_2_TRANSPORT_SECURITY_DEPLOYMENT_REPORT.md`:

- HTTPS health check returns `HTTP/2 200`
- CloudFront headers present (`x-cache`, `via`)

Result: ✅ HTTPS endpoint and certificate evidence present.

---

### A2) `FOXTROT_API_URL` in production points to HTTPS domain

From `PHASE_2_TRANSPORT_SECURITY_DEPLOYMENT_REPORT.md`:

- Central production config lists:
  - `FOXTROT_API_URL=https://foxtrot.greenreachgreens.com`
  - `NODE_ENV=production`
  - `DEPLOYMENT_MODE=cloud`

- Included AWS CLI config query output confirms:

```json
[{"OptionName":"FOXTROT_API_URL","Value":"https://foxtrot.greenreachgreens.com"}]
```

Code usage confirms runtime path is env-driven and used for Central→Foxtrot calls:

- `greenreach-central/routes/farm-sales.js` uses `process.env.FOXTROT_API_URL` for AI chat proxy target.

Result: ✅ Production `FOXTROT_API_URL` is HTTPS and actively consumed.

---

### A3) Record deployed CloudFront distribution ID and ACM cert ARN

From `PHASE_2_TRANSPORT_SECURITY_DEPLOYMENT_REPORT.md`:

- Foxtrot CloudFront Distribution ID: `E2H4LSZS4AMUA3`
- Foxtrot Domain: `https://foxtrot.greenreachgreens.com`
- Foxtrot ACM certificate ARN:
  - `arn:aws:acm:us-east-1:634419072974:certificate/926a481a-475f-4b83-a073-519e14fa9766`

Result: ✅ CloudFront and ACM identifiers recorded.

---

### A4) Webhook signature verification active in production paths

Code evidence:

- `greenreach-central/middleware/webhook-signature.js`
  - Production/cloud mode requires `WEBHOOK_SECRET`
  - Rejects missing signature/timestamp in production
  - Verifies `HMAC-SHA256`
  - Uses timestamp freshness checks and constant-time comparison

- `greenreach-central/routes/wholesale-fulfillment.js`
  - `verifyWebhookSignature` applied to webhook-sensitive POST routes:
    - `/order-statuses`
    - `/tracking-numbers`
    - `/order-tracking`
    - `/orders/farm-verify`
    - `/orders/:orderId/verify`

Deployment evidence:

- `PHASE_2_TRANSPORT_SECURITY_DEPLOYMENT_REPORT.md` documents webhook signature rollout and protected routes.

Result: ✅ Signature verification is implemented and mounted on production webhook paths.

---

## Final P0-4 Decision

P0-4 acceptance criteria are met based on:

1. Live HTTPS+TLS verification against Foxtrot production domain
2. Recorded CloudFront + ACM identifiers
3. Production HTTPS `FOXTROT_API_URL` evidence
4. Active webhook signature verification middleware on fulfillment endpoints

Recommendation: Keep this file as the canonical P0-4 audit artifact and update only if distribution/certificate/environment values rotate.