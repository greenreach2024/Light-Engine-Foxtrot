# Production Deployment Checklist

**Project:** Light Engine Foxtrot  
**Target Environment:** AWS Elastic Beanstalk Production  
**Deployment Date:** _________________

---

## Pre-Deployment Tasks

### 1. Code Preparation ✅ COMPLETE

- [x] All security features implemented
- [x] Test suite passing (15/17 tests)
- [x] Code committed to Git
- [x] Documentation complete

**Last Commit:** 60784ce  
**Branch:** main  
**Status:** Synced with origin

---

### 2. AWS Secrets Manager ⏳ PENDING

**Owner:** DevOps Team  
**Estimated Time:** 10 minutes

- [ ] Run JWT secret setup script:
  ```bash
  node scripts/setup-jwt-secret.js
  ```

- [ ] Grant EB instance role permissions:
  ```bash
  aws iam attach-role-policy \
    --role-name aws-elasticbeanstalk-ec2-role \
    --policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite
  ```

- [ ] Verify secret created:
  ```bash
  aws secretsmanager describe-secret \
    --secret-id foxtrot/jwt-secret \
    --region us-east-1
  ```

- [ ] Note JWT_SECRET_ARN: `________________________________`

**Documentation:** [AWS_INFRASTRUCTURE_SETUP.md](AWS_INFRASTRUCTURE_SETUP.md#1-jwt-secrets-manager-setup) Section 1

---

### 3. SSL/TLS Certificate ⏳ PENDING

**Owner:** DevOps Team  
**Estimated Time:** 30 minutes (+ DNS validation wait)

#### Option A: Use Default EB Certificate (Easiest)
- [ ] Skip to load balancer configuration below

#### Option B: Request Custom ACM Certificate
- [ ] Request certificate:
  ```bash
  aws acm request-certificate \
    --domain-name api.lightengine.io \
    --validation-method DNS \
    --region us-east-1
  ```

- [ ] Add DNS validation records to Route 53 / domain registrar
- [ ] Wait for certificate validation (5-30 minutes)
- [ ] Note Certificate ARN: `________________________________`

#### Load Balancer Configuration
- [ ] Update certificate ARN in `.ebextensions/https-redirect.config`
- [ ] Commit configuration:
  ```bash
  git add .ebextensions/https-redirect.config
  git commit -m "Configure HTTPS certificate"
  git push
  ```

**Documentation:** [AWS_INFRASTRUCTURE_SETUP.md](AWS_INFRASTRUCTURE_SETUP.md#2-ssltls-certificate-configuration) Section 2

---

### 4. Configure EB Environment ⏳ PENDING

**Owner:** DevOps Team  
**Estimated Time:** 5 minutes

- [ ] Run environment configuration script:
  ```bash
  ./scripts/configure-eb-environment.sh
  ```
  
  **Configuration Decisions:**
  - Rate Limiting: [ ] Enable (recommended after HTTPS)
  - Authentication: [ ] Enable (required: HTTPS configured)
  - Audit Logging: [x] Enable (recommended)

- [ ] OR manually set environment variables:
  ```bash
  eb setenv \
    JWT_SECRET_ARN="arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:foxtrot/jwt-secret-XXXXX" \
    RATE_LIMITING_ENABLED=false \
    AUTH_ENABLED=false \
    AUDIT_LOG_ENABLED=true
  ```

**Documentation:** Script includes interactive prompts

---

### 5. Deploy Application ⏳ PENDING

**Owner:** DevOps Team  
**Estimated Time:** 10 minutes

- [ ] Deploy to Elastic Beanstalk:
  ```bash
  eb deploy light-engine-foxtrot-prod
  ```

- [ ] Monitor deployment:
  ```bash
  eb logs --stream
  ```

- [ ] Verify deployment status:
  ```bash
  eb status
  ```

- [ ] Check health:
  ```bash
  curl https://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/health
  ```

**Expected Response:** `{"status":"ok"}`

---

### 6. Configure AWS WAF ⏳ PENDING

**Owner:** Security Team  
**Estimated Time:** 15 minutes

- [ ] Run WAF setup script:
  ```bash
  ./scripts/setup-waf.sh
  ```

- [ ] Verify Web ACL created:
  ```bash
  aws wafv2 list-web-acls --scope REGIONAL --region us-east-1
  ```

- [ ] Note Web ACL ARN: `________________________________`

- [ ] Test SQL injection protection:
  ```bash
  curl "https://YOUR_DOMAIN/api/test?id=1' OR '1'='1"
  # Expected: 403 Forbidden
  ```

**Documentation:** [AWS_INFRASTRUCTURE_SETUP.md](AWS_INFRASTRUCTURE_SETUP.md#3-aws-waf-configuration) Section 3

---

### 7. Setup CloudWatch Alarms ⏳ PENDING

**Owner:** DevOps Team  
**Estimated Time:** 10 minutes

- [ ] Create SNS topic for alerts (if not exists):
  ```bash
  aws sns create-topic --name foxtrot-alerts --region us-east-1
  ```

- [ ] Subscribe email to SNS topic:
  ```bash
  aws sns subscribe \
    --topic-arn arn:aws:sns:us-east-1:ACCOUNT:foxtrot-alerts \
    --protocol email \
    --notification-endpoint YOUR_EMAIL@example.com
  ```

- [ ] Confirm email subscription

- [ ] Run CloudWatch alarms setup:
  ```bash
  ./scripts/setup-cloudwatch-alarms.sh arn:aws:sns:us-east-1:ACCOUNT:foxtrot-alerts
  ```

- [ ] Verify alarms created:
  ```bash
  aws cloudwatch describe-alarms --alarm-name-prefix foxtrot-
  ```

**Documentation:** [AWS_INFRASTRUCTURE_SETUP.md](AWS_INFRASTRUCTURE_SETUP.md#5-cloudwatch-alarms) Section 5

---

## Post-Deployment Validation

### 8. Security Features Testing ⏳ PENDING

**Owner:** QA Team  
**Estimated Time:** 30 minutes

#### CORS Validation
- [ ] Test allowed origin:
  ```bash
  curl -H "Origin: http://light-engine-demo-1765326376.s3-website-us-east-1.amazonaws.com" \
    -I https://YOUR_DOMAIN/health
  # Expected: Access-Control-Allow-Origin header present
  ```

- [ ] Test blocked origin:
  ```bash
  curl -H "Origin: https://malicious-site.com" \
    -I https://YOUR_DOMAIN/health
  # Expected: No Access-Control-Allow-Origin header
  ```

#### HTTPS Validation
- [ ] Test HTTPS access:
  ```bash
  curl -I https://YOUR_DOMAIN/health
  # Expected: 200 OK
  ```

- [ ] Test HTTP redirect:
  ```bash
  curl -I http://YOUR_DOMAIN/health
  # Expected: 301 redirect to https://
  ```

- [ ] Verify certificate:
  ```bash
  openssl s_client -connect YOUR_DOMAIN:443 -servername YOUR_DOMAIN | grep "Verify return code"
  # Expected: Verify return code: 0 (ok)
  ```

#### Rate Limiting Validation (if enabled)
- [ ] Test rate limit on auth endpoint:
  ```bash
  for i in {1..10}; do
    curl -X POST https://YOUR_DOMAIN/api/auth/login
  done
  # Expected: 429 Too Many Requests after 5th request
  ```

#### Audit Logging Validation
- [ ] Check logs for audit events:
  ```bash
  eb logs | grep "AUDIT_LOG"
  # Expected: Structured JSON audit log entries
  ```

#### JWT Secrets Manager Validation
- [ ] Verify secret loaded from AWS:
  ```bash
  eb logs | grep "JWT secret loaded from AWS Secrets Manager"
  # Expected: Success message in logs
  ```

#### WAF Validation
- [ ] Test SQL injection block:
  ```bash
  curl "https://YOUR_DOMAIN/api/users?id=1' OR '1'='1"
  # Expected: 403 Forbidden
  ```

**Documentation:** [AWS_INFRASTRUCTURE_SETUP.md](AWS_INFRASTRUCTURE_SETUP.md#6-validation) Section 6

---

### 9. Enable Authentication ⏳ PENDING

**Owner:** DevOps Team  
**Estimated Time:** 5 minutes  
**Prerequisites:** HTTPS configured and tested

- [ ] Enable authentication:
  ```bash
  eb setenv AUTH_ENABLED=true
  eb deploy
  ```

- [ ] Test protected endpoint without token:
  ```bash
  curl https://YOUR_DOMAIN/api/protected
  # Expected: 401 Unauthorized
  ```

- [ ] Test login:
  ```bash
  curl -X POST -H "Content-Type: application/json" \
    -d '{"email":"admin@example.com","password":"test"}' \
    https://YOUR_DOMAIN/api/auth/login
  # Expected: JWT token returned
  ```

**Documentation:** [AWS_INFRASTRUCTURE_SETUP.md](AWS_INFRASTRUCTURE_SETUP.md#4-enable-authentication) Section 4

---

### 10. Enable Rate Limiting ⏳ PENDING

**Owner:** DevOps Team  
**Estimated Time:** 5 minutes

- [ ] Enable rate limiting:
  ```bash
  eb setenv RATE_LIMITING_ENABLED=true
  eb deploy
  ```

- [ ] Test rate limits (see validation section above)

---

### 11. Performance Testing ⏳ PENDING

**Owner:** QA Team  
**Estimated Time:** 20 minutes

- [ ] Run load test:
  ```bash
  ab -n 1000 -c 10 https://YOUR_DOMAIN/health
  ```

- [ ] Verify response times acceptable (< 2s average)
- [ ] Check no errors during load test
- [ ] Monitor CloudWatch CPU/Memory metrics

---

### 12. Monitoring Setup ⏳ PENDING

**Owner:** DevOps Team  
**Estimated Time:** 15 minutes

- [ ] Verify all CloudWatch alarms in "OK" state
- [ ] Set up CloudWatch dashboard:
  - [ ] Request count
  - [ ] Error rates (4xx, 5xx)
  - [ ] Response times
  - [ ] CPU/Memory utilization
  - [ ] WAF blocked requests

- [ ] Configure log retention (30 days recommended)

---

### 13. Documentation Update ⏳ PENDING

**Owner:** Tech Lead  
**Estimated Time:** 20 minutes

- [ ] Update SECURITY_HARDENING.md with:
  - [ ] Actual JWT_SECRET_ARN
  - [ ] Certificate ARN
  - [ ] Web ACL ARN
  - [ ] SNS Topic ARN
  - [ ] Production URLs

- [ ] Document rollback procedures
- [ ] Create runbook for common issues
- [ ] Update team wiki with deployment info

---

## Rollback Plan

### If Deployment Fails

1. **Check deployment logs:**
   ```bash
   eb logs
   ```

2. **Rollback to previous version:**
   ```bash
   eb deploy --version <PREVIOUS_VERSION>
   ```

3. **Restore environment variables:**
   ```bash
   eb printenv  # Check current
   eb setenv KEY=value  # Restore
   ```

### If Security Issues Found

1. **Disable affected feature:**
   ```bash
   eb setenv RATE_LIMITING_ENABLED=false AUTH_ENABLED=false
   eb deploy
   ```

2. **Investigate logs:**
   ```bash
   eb logs --stream
   ```

3. **Apply fix and redeploy**

---

## Sign-Off

### Development Team
- [ ] Code reviewed and approved
- [ ] Tests passing
- [ ] Documentation complete

**Signed:** _________________ Date: _________

### DevOps Team
- [ ] Infrastructure configured
- [ ] Deployment successful
- [ ] Monitoring active

**Signed:** _________________ Date: _________

### Security Team
- [ ] Security features validated
- [ ] WAF configured
- [ ] Audit logging verified

**Signed:** _________________ Date: _________

### QA Team
- [ ] Validation tests passed
- [ ] Performance acceptable
- [ ] No critical issues

**Signed:** _________________ Date: _________

---

## Post-Deployment

### Week 1 Monitoring
- [ ] Day 1: Check all alarms, no false positives
- [ ] Day 3: Review error rates, performance metrics
- [ ] Day 7: Analyze audit logs, security events

### Month 1 Review
- [ ] Review npm vulnerabilities (node-quickbooks)
- [ ] Consider migration to Square-only integration
- [ ] Performance optimization if needed
- [ ] Security audit by external firm

---

**Deployment Status:** ⏳ In Progress  
**Started:** _________________  
**Completed:** _________________  
**Production URL:** https://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com
