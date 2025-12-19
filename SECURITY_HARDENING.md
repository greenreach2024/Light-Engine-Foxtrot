# Phase 1: Security Hardening Implementation Guide

**Status**: 🟡 In Progress  
**Date**: December 19, 2025  
**Target Completion**: 1-2 weeks

## ✅ Completed: Code Changes

### 1. CORS Restrictions Implemented
- **Files Modified**:
  - `server/middleware/cors.js` - Node.js CORS middleware
  - `backend/main.py` - Python FastAPI CORS configuration

- **Changes**:
  - ✅ Replaced wildcard `*` with specific allowed origins
  - ✅ Added S3 frontend URL: `http://light-engine-demo-1765326376.s3-website-us-east-1.amazonaws.com`
  - ✅ Added EB backend URL: `http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com`
  - ✅ Added HTTPS variants for future SSL setup
  - ✅ Preserved localhost for development
  - ✅ Added origin validation and logging

- **Testing**:
  ```bash
  # Test CORS from allowed origin
  curl -H "Origin: http://light-engine-demo-1765326376.s3-website-us-east-1.amazonaws.com" \
       -H "Access-Control-Request-Method: POST" \
       -X OPTIONS http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/api/env
  
  # Should return Access-Control-Allow-Origin header
  
  # Test CORS from unknown origin (should be rejected in production)
  curl -H "Origin: http://evil-site.com" \
       -H "Access-Control-Request-Method: POST" \
       -X OPTIONS http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/api/env
  ```

### 2. Rate Limiting System Created
- **File Created**: `server/middleware/rate-limiter.js`

- **Features**:
  - ✅ In-memory rate limiting for single-server deployments
  - ✅ Configurable time windows and request limits
  - ✅ Automatic cleanup of expired entries
  - ✅ Predefined limiters:
    - `authRateLimiter`: 5 requests per 15 min (login protection)
    - `apiRateLimiter`: 100 requests per 15 min (standard API)
    - `readRateLimiter`: 300 requests per 15 min (read-only)
    - `writeRateLimiter`: 30 requests per 15 min (write operations)
  - ✅ Standard HTTP headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
  - ✅ HTTP 429 responses with `Retry-After` header

- **Integration** (to be applied):
  ```javascript
  import { authRateLimiter, apiRateLimiter, writeRateLimiter } from './server/middleware/rate-limiter.js';
  
  // Apply to auth endpoints
  app.post('/api/auth/login', authRateLimiter, loginHandler);
  
  // Apply to all API routes
  app.use('/api', apiRateLimiter);
  
  // Apply stricter limits to write operations
  app.post('/api/groups', writeRateLimiter, createGroupHandler);
  app.put('/api/rules/:id', writeRateLimiter, updateRuleHandler);
  ```

### 3. Audit Logging System Created
- **File Created**: `server/middleware/audit-logger.js`

- **Features**:
  - ✅ Structured JSON logging for security events
  - ✅ Dual output: console (CloudWatch) + file system
  - ✅ Comprehensive event types:
    - Authentication: login, logout, token operations
    - Authorization: permission changes, role updates
    - Password management: resets, changes
    - Data access: sensitive reads/writes
    - Configuration: system changes
  - ✅ Request context capture: IP, user agent, user ID, tenant ID
  - ✅ Convenience functions for common events
  - ✅ Middleware for automatic logging of sensitive endpoints

- **Usage Examples**:
  ```javascript
  import { logLoginSuccess, logLoginFailure, logPermissionDenied } from './server/middleware/audit-logger.js';
  
  // On successful login
  logLoginSuccess(userId, email, req);
  
  // On failed login
  logLoginFailure(email, 'invalid_password', req);
  
  // On permission denial
  logPermissionDenied('/api/admin/users', 'DELETE', 'insufficient_role', req);
  ```

### 4. Environment Configuration Updated
- **File Modified**: `.env.example`

- **Changes**:
  - ✅ Added comprehensive security configuration section
  - ✅ Documented JWT_SECRET generation: `openssl rand -base64 64`
  - ✅ Added rate limiting environment variables
  - ✅ Added audit logging configuration
  - ✅ Added instructions for AWS Secrets Manager integration
  - ✅ Documented CORS configuration location

---

## 🔨 Pending: AWS Infrastructure Tasks

### Task 1: Configure AWS Secrets Manager ⏳
**Priority**: 🔴 Critical  
**Estimated Time**: 30 minutes

**Steps**:
1. Generate strong JWT secret:
   ```bash
   openssl rand -base64 64
   ```
   
2. Store in AWS Secrets Manager:
   ```bash
   aws secretsmanager create-secret \
     --name foxtrot/jwt-secret \
     --description "JWT signing secret for Light Engine Foxtrot" \
     --secret-string "YOUR_GENERATED_SECRET_HERE" \
     --region us-east-1
   ```

3. Grant Elastic Beanstalk instance role read access:
   ```bash
   # Get EB instance role ARN
   aws elasticbeanstalk describe-configuration-settings \
     --environment-name light-engine-foxtrot-prod \
     --application-name light-engine-foxtrot
   
   # Attach policy to role
   aws iam attach-role-policy \
     --role-name aws-elasticbeanstalk-ec2-role \
     --policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite
   ```

4. Update EB environment to read from Secrets Manager:
   ```bash
   # Option A: Use EB CLI
   eb setenv JWT_SECRET_ARN=arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:foxtrot/jwt-secret
   
   # Option B: Update in AWS Console
   # Elastic Beanstalk > Environments > light-engine-foxtrot-prod > Configuration > Software
   # Add JWT_SECRET_ARN environment variable
   ```

5. Update server code to read from Secrets Manager:
   ```javascript
   // Add to server-foxtrot.js
   import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
   
   async function getJwtSecret() {
     if (process.env.JWT_SECRET_ARN) {
       const client = new SecretsManagerClient({ region: 'us-east-1' });
       const response = await client.send(
         new GetSecretValueCommand({ SecretId: process.env.JWT_SECRET_ARN })
       );
       return response.SecretString;
     }
     return process.env.JWT_SECRET;
   }
   ```

6. Install AWS SDK:
   ```bash
   npm install @aws-sdk/client-secrets-manager
   ```

---

### Task 2: Configure SSL/TLS Certificate ⏳
**Priority**: 🔴 Critical  
**Estimated Time**: 45 minutes

**Steps**:
1. Request certificate in AWS Certificate Manager (ACM):
   ```bash
   aws acm request-certificate \
     --domain-name light-engine-foxtrot.yourdomain.com \
     --validation-method DNS \
     --region us-east-1
   ```

2. Add DNS validation records (provided by ACM) to your DNS provider

3. Wait for certificate validation (usually 5-30 minutes)

4. Configure EB load balancer to use HTTPS:
   - AWS Console > Elastic Beanstalk > Environments > light-engine-foxtrot-prod
   - Configuration > Load Balancer
   - Add listener: Port 443, Protocol HTTPS, SSL Certificate (select from ACM)
   - Add redirect rule: Port 80 HTTP → Port 443 HTTPS

5. Update CORS allowed origins to include HTTPS:
   ```javascript
   // Already added in server/middleware/cors.js:
   'https://light-engine-demo-1765326376.s3-website-us-east-1.amazonaws.com',
   'https://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com',
   ```

6. Update frontend API_BASE to use HTTPS:
   ```javascript
   // In public/index.html line 13
   window.API_BASE = 'https://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com';
   ```

---

### Task 3: Configure AWS WAF ⏳
**Priority**: 🟡 High  
**Estimated Time**: 1 hour

**Steps**:
1. Create Web ACL:
   ```bash
   aws wafv2 create-web-acl \
     --name foxtrot-web-acl \
     --scope REGIONAL \
     --region us-east-1 \
     --default-action Allow={} \
     --description "Web ACL for Light Engine Foxtrot" \
     --rules file://waf-rules.json
   ```

2. Create `waf-rules.json` with managed rule groups:
   ```json
   [
     {
       "Name": "AWSManagedRulesCommonRuleSet",
       "Priority": 1,
       "Statement": {
         "ManagedRuleGroupStatement": {
           "VendorName": "AWS",
           "Name": "AWSManagedRulesCommonRuleSet"
         }
       },
       "OverrideAction": {"None": {}},
       "VisibilityConfig": {
         "SampledRequestsEnabled": true,
         "CloudWatchMetricsEnabled": true,
         "MetricName": "CommonRuleSet"
       }
     },
     {
       "Name": "AWSManagedRulesSQLiRuleSet",
       "Priority": 2,
       "Statement": {
         "ManagedRuleGroupStatement": {
           "VendorName": "AWS",
           "Name": "AWSManagedRulesSQLiRuleSet"
         }
       },
       "OverrideAction": {"None": {}},
       "VisibilityConfig": {
         "SampledRequestsEnabled": true,
         "CloudWatchMetricsEnabled": true,
         "MetricName": "SQLiRuleSet"
       }
     },
     {
       "Name": "RateLimitRule",
       "Priority": 3,
       "Statement": {
         "RateBasedStatement": {
           "Limit": 2000,
           "AggregateKeyType": "IP"
         }
       },
       "Action": {"Block": {}},
       "VisibilityConfig": {
         "SampledRequestsEnabled": true,
         "CloudWatchMetricsEnabled": true,
         "MetricName": "RateLimitRule"
       }
     }
   ]
   ```

3. Associate Web ACL with Load Balancer:
   ```bash
   # Get load balancer ARN
   aws elbv2 describe-load-balancers \
     --query "LoadBalancers[?contains(LoadBalancerName, 'foxtrot')].LoadBalancerArn" \
     --output text
   
   # Associate WAF with LB
   aws wafv2 associate-web-acl \
     --web-acl-arn arn:aws:wafv2:us-east-1:ACCOUNT:regional/webacl/foxtrot-web-acl/ID \
     --resource-arn arn:aws:elasticloadbalancing:us-east-1:ACCOUNT:loadbalancer/app/...
   ```

4. Configure CloudWatch metrics and alarms:
   ```bash
   aws cloudwatch put-metric-alarm \
     --alarm-name foxtrot-waf-blocked-requests \
     --alarm-description "Alert on high blocked request rate" \
     --metric-name BlockedRequests \
     --namespace AWS/WAFV2 \
     --statistic Sum \
     --period 300 \
     --threshold 100 \
     --comparison-operator GreaterThanThreshold \
     --evaluation-periods 2
   ```

---

### Task 4: Enable Authentication & Rate Limiting ⏳
**Priority**: 🔴 Critical  
**Estimated Time**: 1 hour

**Steps**:
1. Update EB environment variables:
   ```bash
   eb setenv AUTH_ENABLED=true RATE_LIMITING_ENABLED=true
   ```

2. Deploy rate limiting integration to server-foxtrot.js:
   ```bash
   # Create feature branch
   git checkout -b feature/rate-limiting
   
   # Edit server-foxtrot.js to add rate limiter imports and apply to routes
   # (See integration example in section 2 above)
   
   # Test locally
   npm start
   
   # Commit and deploy
   git add .
   git commit -m "feat: Add rate limiting to API endpoints"
   eb deploy light-engine-foxtrot-prod
   ```

3. Deploy audit logging integration:
   ```bash
   # Add audit logging to auth routes in backend/auth_routes.py
   # Add audit middleware to server-foxtrot.js
   # Commit and deploy
   ```

4. Test authentication flow:
   ```bash
   # Test login
   curl -X POST http://YOUR_DOMAIN/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"testpass"}'
   
   # Should return JWT token
   
   # Test protected endpoint without token
   curl http://YOUR_DOMAIN/api/admin/users
   # Should return 401 Unauthorized
   
   # Test protected endpoint with token
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://YOUR_DOMAIN/api/admin/users
   # Should return data
   ```

5. Test rate limiting:
   ```bash
   # Rapid-fire requests to trigger rate limit
   for i in {1..10}; do
     curl -X POST http://YOUR_DOMAIN/api/auth/login \
       -H "Content-Type: application/json" \
       -d '{"email":"test@example.com","password":"wrong"}'
   done
   # Should see 429 Too Many Requests after 5 attempts
   ```

---

## 📊 Deployment Checklist

### Pre-Deployment
- [x] CORS restrictions implemented in code
- [x] Rate limiting middleware created
- [x] Audit logging system created
- [x] Environment variables documented
- [ ] AWS Secrets Manager configured
- [ ] SSL/TLS certificate requested and validated
- [ ] WAF rules created and tested
- [ ] Rate limiting integrated into server-foxtrot.js
- [ ] Audit logging integrated into auth routes

### Testing
- [ ] CORS from allowed origins works
- [ ] CORS from unknown origins is blocked
- [ ] Rate limiting triggers after threshold
- [ ] Rate limiting returns correct HTTP headers
- [ ] Authentication requires valid JWT
- [ ] Audit logs capture login events
- [ ] Audit logs capture failed auth attempts
- [ ] Audit logs capture permission denials

### Production Deployment
- [ ] Generate production JWT secret
- [ ] Store JWT secret in AWS Secrets Manager
- [ ] Update EB to read from Secrets Manager
- [ ] Deploy SSL certificate to load balancer
- [ ] Configure HTTP->HTTPS redirect
- [ ] Associate WAF with load balancer
- [ ] Set AUTH_ENABLED=true
- [ ] Set RATE_LIMITING_ENABLED=true
- [ ] Deploy updated code to EB
- [ ] Verify CloudWatch Logs receiving audit events

### Post-Deployment Validation
- [ ] Access site via HTTPS (green lock icon)
- [ ] Test login flow with valid credentials
- [ ] Test login flow with invalid credentials (should be rate limited after 5 attempts)
- [ ] Verify audit log entries in CloudWatch Logs
- [ ] Monitor WAF metrics in CloudWatch
- [ ] Test CORS from S3 frontend to EB backend
- [ ] Verify no console errors in browser

---

## 🎯 Success Criteria

### Security Metrics
- ✅ CORS restricted to 4 specific origins (+ localhost for dev)
- ⏳ HTTPS enabled with valid SSL certificate
- ⏳ JWT secrets stored in AWS Secrets Manager (not plaintext env vars)
- ⏳ Rate limiting active on all API endpoints
- ⏳ WAF protecting against OWASP Top 10 attacks
- ⏳ Audit logs capturing 100% of auth events

### Operational Metrics
- ⏳ Zero 401/403 errors for legitimate requests
- ⏳ Rate limit false positive rate < 1%
- ⏳ Audit log ingestion latency < 5 seconds
- ⏳ WAF block rate < 0.5% of total traffic (baseline dependent)

---

## 📝 Next Steps

1. **Immediate** (Today):
   - Generate JWT secret with `openssl rand -base64 64`
   - Store in AWS Secrets Manager
   - Request SSL certificate in ACM

2. **This Week**:
   - Complete SSL certificate validation
   - Configure HTTPS on load balancer
   - Deploy rate limiting integration
   - Deploy audit logging integration
   - Enable AUTH_ENABLED and RATE_LIMITING_ENABLED

3. **Next Week**:
   - Configure AWS WAF
   - Set up CloudWatch alarms for security events
   - Conduct penetration testing
   - Document runbooks for security incidents

---

## 📚 References

- [AWS Secrets Manager Documentation](https://docs.aws.amazon.com/secretsmanager/)
- [AWS Certificate Manager](https://docs.aws.amazon.com/acm/)
- [AWS WAF Developer Guide](https://docs.aws.amazon.com/waf/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Express Rate Limiting Best Practices](https://expressjs.com/en/advanced/best-practice-security.html#use-helmet)
