# Phase 2: Transport Security (HTTPS for Foxtrot)

**Date:** 2026-02-27  
**Phase Status:** Implementation in Progress  
**Entry Gate:** ✅ Phase 0-1 complete, both EB environments operational

---

## Phase 2 Objectives

1. **Enable HTTPS for Foxtrot** via CloudFront distribution
2. **Update inter-service communication** from HTTP to HTTPS
3. **Enforce webhook signature validation** in production
4. **Eliminate unencrypted production traffic** to/from Foxtrot edge devices

---

## Detailed Scope

### 2.1: CloudFront Distribution for Foxtrot

**What:** Create AWS CloudFront distribution in front of Foxtrot EB endpoint  
**Why:** 
- Enables HTTPS/TLS termination for all Foxtrot traffic
- Provides edge caching for static assets (reduce load)
- Isolate EB endpoint from direct internet access

**Implementation Steps:**
1. Request ACM certificate for Foxtrot domain (greenreach-edge.com or similar)
2. Create CloudFront distribution:
   - Origin: light-engine-foxtrot-prod-v2.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com
   - Viewer protocol policy: Redirect HTTP to HTTPS
   - Default TTL: 0 (disable caching for API endpoints)
   - Compress: Enable for JSON/text responses
3. Alias distribution to custom domain (greenreach-edge.com)
4. Update distribution certificate in CloudFront settings

**Configuration:**
```yaml
CloudFront Distribution:
  Origin:
    Domain: light-engine-foxtrot-prod-v2.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com
    Protocol: http (EB->CF private)
    Custom Headers: 
      X-Foxtrot-Origin: cloudfront
    
  Default Behavior:
    Allowed Methods: GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE
    Cached Methods: GET, HEAD
    ViewerProtocol: redirect-to-https
    TTL: 0 (no caching for API)
    Compress: true
    
  Restrictions:
    GeoLocation: Allow all (or restrict to CA/US if needed)
    WAF: Optional (Phase 3+)
    
  SSL/TLS:
    Certificate: ACM arn:aws:acm:us-east-1:...
    Minimum TLS Version: TLSv1.2_2021
```

### 2.2: Code Changes for HTTPS Communication

#### File: routes/checkout.js
**Change:** Replace hardcoded `http://127.0.0.1:8091` with env-based FOXTROT_API_URL

**Current Code:**
```javascript
const FOXTROT_API = process.env.FOXTROT_API_URL || 'http://127.0.0.1:8091';
```

**Updated Code:**
```javascript
function getFoxtrotApiUrl() {
  const configured = process.env.FOXTROT_API_URL;
  if (!configured && (process.env.NODE_ENV === 'production' || process.env.DEPLOYMENT_MODE === 'cloud')) {
    throw new Error('FOXTROT_API_URL environment variable is required in production');
  }
  return configured || 'http://127.0.0.1:8091';
}
const FOXTROT_API = getFoxtrotApiUrl();
```

**Rationale:** 
- Phase 0-1 pattern consistency (fail-fast for missing env vars)
- Development: falls back to localhost:8091
- Production: must be set to CloudFront HTTPS URL

#### File: greenreach-central/routes/sync.js (or relevant inter-service calls)
**Change:** Use env-based FOXTROT_API_URL for any internal service-to-service calls

**Locations to check:**
- Any axios calls to FOXTROT_API
- Webhook forwarding endpoints
- Data sync operations

#### File: greenreach-central/server.js
**Change:** Add FOXTROT_API_URL to required environment variables in production

**Current:**
```javascript
validateRequiredEnv(['JWT_SECRET', 'WHOLESALE_JWT_SECRET', 'RDS_HOSTNAME', 'RDS_PASSWORD', 'FOXTROT_API_URL']);
```

**Status:** Already added in Phase 0-1 ✅

### 2.3: Webhook Signature Validation

**Purpose:** Prevent unauthorized webhook requests from external sources  
**Pattern:** HMAC-SHA256 signature verification (Square, fulfillment, etc.)

#### Implementation Points:

1. **Routes to Protect:**
   - POST /api/webhooks (Square payment events)
   - POST /api/webhooks/fulfillment (fulfillment updates)
   - PUT /api/sync/webhook-events (edge device webhooks)

2. **Signature Verification Pattern:**
```javascript
import crypto from 'crypto';

function verifyWebhookSignature(req, res, next) {
  const signature = req.headers['x-webhook-signature'];
  const webhookSecret = process.env.WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({ error: 'WEBHOOK_SECRET not configured' });
    }
    // Development: skip verification
    return next();
  }
  
  // Reconstruct signed payload: body + timestamp check
  const body = JSON.stringify(req.body);
  const timestamp = req.headers['x-timestamp'];
  
  const message = `${timestamp}.${body}`;
  const computed = crypto
    .createHmac('sha256', webhookSecret)
    .update(message)
    .digest('hex');
  
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed))) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }
  
  next();
}

app.post('/api/webhooks', verifyWebhookSignature, async (req, res) => {
  // Handle webhook
});
```

3. **Configuration:**
   - WEBHOOK_SECRET: Already set in Phase 0-1 ✅
   - Signature algorithm: HMAC-SHA256 (consistent with Square)
   - Timestamp tolerance: 5 minutes (prevent replay attacks)

---

## Implementation Sequence

### Step 1: Code Changes (Today)
- [ ] Update routes/checkout.js with fail-fast FOXTROT_API_URL
- [ ] Identify all inter-service HTTP calls → ensure using env var
- [ ] Add webhook signature verification middleware
- [ ] Syntax validation on all changed files

### Step 2: CloudFront Setup (AWS Console)
- [ ] Request ACM certificate for greenreach-edge.com
- [ ] Create CloudFront distribution pointing to Foxtrot EB endpoint
- [ ] Configure distribution settings (TTL=0, HTTPS only, compression)
- [ ] Alias domain to CloudFront (update DNS if needed)

### Step 3: Environment Configuration
- [ ] Set FOXTROT_API_URL=https://greenreach-edge.com in Central EB environment
- [ ] Verify existing WEBHOOK_SECRET configured (Phase 0-1 ✅)
- [ ] Test environment variable interpolation in code

### Step 4: Deployment & Verification
- [ ] Deploy code changes to both Foxtrot and Central EB environments
- [ ] Verify CloudFront distribution is healthy (HTTP 200)
- [ ] Test HTTPS endpoint from Central → Foxtrot (via CloudFront)
- [ ] Verify webhook signature validation works
- [ ] Check logs for any certificate/HTTPS issues

---

## Phase 2 Exit Gate Verification

**All must pass before Phase 3 begins:**

1. ✅ CloudFront distribution created and healthy
2. ✅ Foxtrot accessible only via HTTPS (HTTP redirects)
3. ✅ Central-to-Foxtrot traffic uses HTTPS URL (FOXTROT_API_URL env var)
4. ✅ Webhook signature validation enforced in production
5. ✅ No unencrypted production traffic on Foxtrot endpoints
6. ✅ Certificate chain valid (ACM validation complete)

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Certificate not provisioned in time | Request immediately; can proceed with dev certs during testing |
| CloudFront distribution misconfigured | Use distribution health dashboard; test with curl before deployment |
| FOXTROT_API_URL not set in Central | Fail-fast pattern throws error at startup if missing in production |
| Webhook signature verification breaks integrations | Verify with Square sandbox first; ensure webhook includes timestamp |
| Origin EB endpoint becomes unreachable | CloudFront will start returning 502; revert EB changes quickly |

---

## Timeline

**Phase 2 Duration:** 2-3 hours (assuming ACM certificate provisioning is quick)

- **Hours 1-0.5:** Code changes + syntax validation
- **Hours 0.5-1.5:** CloudFront + ACM setup, environment configuration
- **Hours 1.5-3:** Deployment, verification, exit gate testing

---

## Success Criteria

- ✅ All code changes committed and deployed
- ✅ Zero unencrypted Foxtrot traffic in production
- ✅ CloudFront distribution operational (healthy)
- ✅ Webhook signatures enforced
- ✅ Central-to-Foxtrot communication via HTTPS verified
- ✅ Both EB environments healthy after deployment
- ✅ Exit gate verification matrix 100% pass

**Next Phase:** Phase 3 - Persistence Migration (Map → NeDB cutover)

