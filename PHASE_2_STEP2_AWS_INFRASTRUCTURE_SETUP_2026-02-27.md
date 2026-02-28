# Phase 2 Step 2: AWS Infrastructure Setup
## Transport Security - CloudFront + ACM Certificate Configuration
**Status**: Ready for Implementation  
**Commits**: b53be35, 41488e4  
**Code Changes Complete**: ✅ Yes  
**Date**: 2026-02-27

---

## Overview

Phase 2 Step 2 configures AWS infrastructure to provide HTTPS endpoint for Foxtrot via CloudFront. This unblocks the FOXTROT_API_URL environment variable (Phase 2 Step 1 code changes) by providing the actual HTTPS URL.

### Pre-Conditions Met
- ✅ Code changes committed (getFoxtrotApiUrl + webhook signature middleware)  
- ✅ Node.js syntax validated  
- ✅ Both EB environments deployed with Phase 0-1 hardening  
- ✅ Foxtrot EB endpoint accessible at current Elastic Beanstalk domain  

### Post-Conditions (Step 2 Success)
- ✅ ACM certificate provisioned for target domain  
- ✅ CloudFront distribution created and active  
- ✅ CloudFront domain assigned (e.g., `d1234abcd.cloudfront.net`)  
- ✅ Custom domain (if applicable) aliased to CloudFront  

---

## Step 2A: Request ACM Certificate

### Target Domain
Currently, three options are available:

| Option | Domain | CNAME | Notes |
|--------|--------|-------|-------|
| **Option 1** | `greenreach-edge.com` | Owned by project | ✅ Recommended for production |
| **Option 2** | `*.greenreachgreens.com` | Subdomain of main site | ⚠️ Requires BIG GREEN DNS access |
| **Option 3** | CloudFront default | `d1234abcd.cloudfront.net` | No custom domain; use CloudFront domain directly |

**Recommendation**: Use **Option 3 (CloudFront Default)** for Phase 2 proof-of-concept:
- No DNS setup required  
- Immediate availability  
- Can switch to custom domain in Phase 3  

### Procedure (AWS Console)

1. **Navigate to AWS Certificate Manager**
   - Region: **us-east-1** (required for CloudFront)  
   - Service: AWS Certificate Manager (ACM)  

2. **Request Public Certificate**
   - Click: "Request a certificate"  
   - Type: **Public certificate**  
   - Fully qualified domain name: **greenreach-edge.com**  
   - Validation method: **DNS validation** (faster than email)  

3. **DNS Validation** (if using custom domain)
   - ACM will provide a CNAME record  
   - Add this CNAME to domain registrar (Route53 or external)  
   - Wait for ACM status: "Issued" (typically 1-5 minutes)  

4. **Store Certificate ARN**
   - Example: `arn:aws:acm:us-east-1:123456789012:certificate/abc12345-1234-1234-1234-1234567890ab`  
   - **Action**: Note this ARN for CloudFront configuration in Step 2B  

### Timeline
- **DNS Validation**: 1-5 minutes after CNAME added  
- **Email Validation**: 24-48 hours  
- **Total Duration**: ~1-5 minutes (with DNS validation)  

---

## Step 2B: Create CloudFront Distribution

### Distribution Configuration

| Setting | Value | Notes |
|---------|-------|-------|
| **Origin Domain** | Foxtrot EB endpoint | e.g., `foxtrot-env.us-east-1.elasticbeanstalk.com` |
| **Origin Protocol** | HTTP | EB allows HTTP→CloudFront translates to HTTPS for clients |
| **Viewer Protocol** | HTTPS Only | Clients must use HTTPS; HTTP requests redirected |
| **Origin Path** | `/` | Root path; no specific API prefix needed |
| **Compress Objects** | Yes | Enable gzip compression for API responses |
| **Cache TTL** | 0 seconds (default) | APIs should not be cached; set to 0 or very short |
| **Price Class** | PriceClass_100 | US + Europe only (adequate for initial deployment) |
| **Default Root Object** | (leave empty) | Not needed for API distribution |

### Cache Behavior Settings

**Create custom behavior for API routes:**

| Path | TTL | Compress | Methods |
|------|-----|----------|---------|
| `/api/*` | 0 seconds | Yes | GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE |
| `/health` | 300 seconds | No | GET, HEAD, OPTIONS |
| `/*` | 0 seconds | Yes | GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE |

**Reason**: APIs should not be cached; health checks can be cached briefly.

### SSL/TLS Configuration

1. **Custom SSL Certificate**
   - Use certificate ARN from Step 2A  
   - Supported protocols: TLSv1.2_2021, TLSv1.2_2019, TLSv1_2  

2. **Security Policy**
   - Recommended: **TLSv1.2_2021**  
   - Minimum: TLSv1.2 (no TLSv1.0 or 1.1 for production)  

### Procedure (AWS Console)

1. **Navigate to CloudFront**
   - Service: CloudFront  
   - Click: "Create distribution"  

2. **Configure Origin**
   - Origin domain: Foxtrot EB endpoint (auto-populated if EB instance selected)  
   - Origin type: **HTTP (not HTTPS)**  
   - HTTP port: 80  
   - Protocol: **HTTP only** (EB handles non-HTTPS internally; CloudFront terminates HTTPS)  

3. **Configure Cache Behavior**
   - Viewer protocol policy: **Redirect HTTP to HTTPS**  
   - Allowed HTTP methods: **All** (GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE)  
   - Cache key section:
     - Query strings: **Include all**  
     - Headers: **Include list: Authorization, Host, User-Agent, X-Farm-ID, X-API-Key**  
   - Compress objects: **Yes**  
   - Cache TTL:
     - Minimum: 0  
     - Default: 0  
     - Maximum: 1 (or leave defaults)  

4. **Configure SSL**
   - SSL certificate: Select certificate from Step 2A  
   - Security policy: **TLSv1.2_2021**  

5. **Review & Create**
   - Review all settings  
   - Click "Create distribution"  
   - **Save CloudFront domain name**: e.g., `d1234abcd.cloudfront.net`  

### Timeline
- **Distribution creation**: 15-30 minutes (CloudFront deploys globally)  
- **Status check**: View AWS Console → CloudFront → Distributions  
- **Keep polling** for "Deployed" status (Status = "Deployed" when ready)  

---

## Step 2C: Alias Custom Domain to CloudFront (Optional)

If using custom domain (greenreach-edge.com or similar):

### Route53 Configuration

1. **Navigate to Route53**
   - Service: Route53  
   - Hosted zone: Domain being aliased  

2. **Create Alias Record**
   - Record name: `greenreach-edge.com` (or subdomain)  
   - Record type: **A**  
   - Value: **Alias to CloudFront distribution** → Select distribution from Step 2B  
   - Routing policy: **Simple routing**  
   - Evaluate target health: **No**  
   - Click: "Create records"  

3. **Verify DNS Propagation**
   - Command: `nslookup greenreach-edge.com`  
   - Expected: Should resolve to CloudFront domain  
   - Timeline: 5-30 minutes for global DNS propagation  

### External DNS Provider (if not using Route53)

If domain is with external provider (GoDaddy, Namecheap, etc.):
1. Create CNAME record: `greenreach-edge.com` → CloudFront domain  
2. Verify propagation (5-30 minutes)  

---

## Step 2D: Update Central EB Environment Variable

Once CloudFront is deployed and domain is verified:

### Update Environment Variable

**Variable**: `FOXTROT_API_URL`  
**Value**: CloudFront domain or custom domain with HTTPS  

**Options**:
- `https://d1234abcd.cloudfront.net` (CloudFront default)  
- `https://greenreach-edge.com` (custom domain, if aliased)  

### Procedure (AWS Console)

1. **Navigate to Elastic Beanstalk**
   - Environment: GreenReach Central (production)  
   - Click: "Configuration"  

2. **Update Environment Properties**
   - Section: "Software"  
   - Click: "Edit"  
   - Environment properties: Add/update `FOXTROT_API_URL`  
   - Value: CloudFront HTTPS URL  

3. **Apply Changes**
   - Click: "Apply"  
   - Wait for environment to redeploy (~5 minutes)  
   - Check health: Should remain "Green"  

### Validation After Deployment
```bash
# SSH into Central EB instance
# Verify env var is set
echo $FOXTROT_API_URL

# Test the HTTPS endpoint
curl -I https://d1234abcd.cloudfront.net/api/wholesale/catalog
# Expected: 200 OK or 401 (auth required, but endpoint is reachable)
```

---

## Rollback Plan (If Issues Arise)

### Scenario 1: CloudFront Not Deploying
- **Action**: Delete distribution, retry  
- **Time**: 15-30 minutes  
- **Impact**: No impact; Central still works with localhost (develop mode default)  

### Scenario 2: FOXTROT_API_URL Env Var Breaks Central
- **Action**: Revert to `FOXTROT_API_URL=""` (empty) in EB console  
- **Time**: 5 minutes  
- **Impact**: Central falls back to localhost dev mode  

### Scenario 3: Certificate Not Issuing
- **Action**: Use CloudFront default domain (d1234abcd.cloudfront.net)  
- **Time**: Immediate  
- **Workaround**: Skip custom domain, deploy with CloudFront domain  

---

## Verification Checklist

After Step 2 completion, verify:

- [ ] ACM certificate status: **Issued**  
- [ ] CloudFront distribution status: **Deployed**  
- [ ] CloudFront domain resolves: `nslookup d1234abcd.cloudfront.net`  
- [ ] Custom domain resolves (if used): `nslookup greenreach-edge.com`  
- [ ] HTTPS endpoint accessible: `curl -I https://cloudfront-domain/health`  
- [ ] Central env var set: `FOXTROT_API_URL=https://...`  
- [ ] Central EB environment healthy: Status = "Green"  
- [ ] Central→Foxtrot calls work: Test checkout preview endpoint  

---

## Next Steps (Phase 2 Step 3)

After AWS infrastructure is live:
- [ ] Test HTTPS connectivity end-to-end  
- [ ] Redeploy Foxtrot with FOXTROT_API_URL validation  
- [ ] Run smoke tests on checkout flow  
- [ ] Monitor CloudFront metrics for errors  

---

## Reference Documentation

- [AWS CloudFront Documentation](https://docs.aws.amazon.com/cloudfront/)  
- [AWS ACM Documentation](https://docs.aws.amazon.com/acm/)  
- [AWS Elastic Beanstalk Environment Variables](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/environments-cfg-softwaresettings.html)  
- Phase 2 Transport Security Plan: `PHASE_2_TRANSPORT_SECURITY_PLAN_2026-02-27.md`  

---

**Estimated Duration**: 30 minutes to 1 hour  
**Complexity**: Medium (AWS console navigation; straightforward configuration)  
**Risk**: Low (no production data affected; rollback is simple)  

