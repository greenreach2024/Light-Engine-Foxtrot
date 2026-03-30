# Production Security Configuration

**Environment:** light-engine-foxtrot-prod  
**Region:** us-east-1  
**Last Updated:** _______________  
**Updated By:** _______________

---

## 🔐 AWS Resources

### JWT Secret Management

**Secret Name:** `foxtrot/jwt-secret`  
**Secret ARN:** `_______________________________________________________`

**How to retrieve:**
```bash
aws secretsmanager describe-secret --secret-id foxtrot/jwt-secret --region us-east-1
```

**Rotation Schedule:** Manual (rotate quarterly)  
**Last Rotated:** _______________  
**Next Rotation:** _______________

---

### SSL/TLS Certificate

**Certificate Type:** [ ] AWS Certificate Manager [ ] Default EB Certificate  
**Certificate ARN:** `_______________________________________________________`

**Domain(s):**
- Primary: _______________________________________________
- Alternate: _____________________________________________

**Expiration Date:** _______________  
**Auto-Renewal:** [ ] Enabled [ ] Disabled

**How to retrieve:**
```bash
aws acm describe-certificate --certificate-arn YOUR_ARN --region us-east-1
```

---

### AWS WAF

**Web ACL Name:** `foxtrot-web-acl`  
**Web ACL ARN:** `_______________________________________________________`

**Associated Resources:**
- Load Balancer ARN: `_______________________________________________________`

**Active Rules:**
1. ✅ Rate Limiting: 2000 requests per 5 minutes per IP
2. ✅ AWS Managed Rules - Common Rule Set (OWASP Top 10)
3. ✅ AWS Managed Rules - Known Bad Inputs
4. ✅ AWS Managed Rules - SQL Injection Protection
5. ✅ AWS Managed Rules - Linux OS Protection

**Metrics Namespace:** `AWS/WAFV2`  
**Metric Name:** `foxtrot-waf`

**How to retrieve:**
```bash
aws wafv2 list-web-acls --scope REGIONAL --region us-east-1
```

---

### CloudWatch Alarms

**SNS Topic ARN:** `_______________________________________________________`  
**Notification Email:** _______________________________________________

**Active Alarms:**

| Alarm Name | Metric | Threshold | State |
|------------|--------|-----------|-------|
| foxtrot-high-5xx-errors | HTTPCode_Target_5XX_Count | > 50 in 10 min | _____ |
| foxtrot-high-cpu | CPUUtilization | > 80% for 10 min | _____ |
| foxtrot-waf-high-blocks | BlockedRequests | > 1000 in 10 min | _____ |
| foxtrot-high-latency | TargetResponseTime | > 2s for 10 min | _____ |
| foxtrot-unhealthy-targets | UnHealthyHostCount | ≥ 1 for 2 min | _____ |

**How to check:**
```bash
aws cloudwatch describe-alarms --alarm-name-prefix foxtrot- --region us-east-1
```

---

## 🌐 Production URLs

### Frontend (S3 Static Hosting)
**HTTP URL:** `http://light-engine-demo-1765326376.s3-website-us-east-1.amazonaws.com`  
**HTTPS URL:** `_______________________________________________________`  
**Custom Domain:** `_______________________________________________________`

### Backend (Elastic Beanstalk)
**HTTP URL:** `http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com`  
**HTTPS URL:** `_______________________________________________________`  
**Custom Domain:** `_______________________________________________________`

### API Endpoints
**Health Check:** `_______________/health`  
**Auth Login:** `_______________/api/auth/login`  
**Protected Resource:** `_______________/api/protected`

---

## ⚙️ Environment Variables

### Elastic Beanstalk Environment Configuration

**Environment Name:** `light-engine-foxtrot-prod`  
**Environment ID:** `e-naez8b4zwp`  
**Platform:** Node.js 20 running on 64bit Amazon Linux 2023/6.7.0

**Security Configuration:**
```bash
JWT_SECRET_ARN=_______________________________________________________
RATE_LIMITING_ENABLED=_____________ (true/false)
AUTH_ENABLED=_____________ (true/false)
AUDIT_LOG_ENABLED=_____________ (true/false)
AWS_REGION=us-east-1
NODE_ENV=production
```

**Rate Limiting Settings (if enabled):**
```bash
RATE_LIMIT_AUTH_MAX=5
RATE_LIMIT_AUTH_WINDOW_MS=900000
RATE_LIMIT_API_MAX=100
RATE_LIMIT_API_WINDOW_MS=900000
RATE_LIMIT_READ_MAX=300
RATE_LIMIT_READ_WINDOW_MS=900000
RATE_LIMIT_WRITE_MAX=30
RATE_LIMIT_WRITE_WINDOW_MS=900000
```

**How to retrieve:**
```bash
eb printenv --environment light-engine-foxtrot-prod
```

---

## 🔒 IAM Roles & Permissions

### Elastic Beanstalk Instance Role

**Role Name:** `aws-elasticbeanstalk-ec2-role`  
**Role ARN:** `_______________________________________________________`

**Attached Policies:**
- [x] AWSElasticBeanstalkWebTier
- [x] AWSElasticBeanstalkWorkerTier
- [x] SecretsManagerReadWrite (for JWT secret access)
- [x] CloudWatchLogsFullAccess (for audit logging)

**How to verify:**
```bash
aws iam list-attached-role-policies --role-name aws-elasticbeanstalk-ec2-role
```

---

## 📊 Monitoring & Logging

### CloudWatch Log Groups

**Application Logs:**
- Log Group: `/aws/elasticbeanstalk/light-engine-foxtrot-prod/var/log/nodejs/nodejs.log`
- Retention: _____ days

**Audit Logs:**
- Log Group: `/aws/elasticbeanstalk/light-engine-foxtrot-prod/var/log/audit.log`
- Retention: _____ days

**WAF Logs:**
- Log Group: `aws-waf-logs-foxtrot`
- Retention: _____ days

**How to view:**
```bash
# Application logs
eb logs --all

# Stream live logs
eb logs --stream

# CloudWatch Insights query
aws logs filter-log-events \
  --log-group-name /aws/elasticbeanstalk/light-engine-foxtrot-prod/var/log/nodejs/nodejs.log \
  --filter-pattern "AUDIT_LOG"
```

---

## 🧪 Validation Results

### Deployment Date: _______________

#### CORS Validation
- [ ] Allowed origin receives CORS headers
- [ ] Blocked origin does NOT receive CORS headers
- [ ] Preflight OPTIONS requests handled correctly

**Test Command:**
```bash
curl -H "Origin: http://light-engine-demo-1765326376.s3-website-us-east-1.amazonaws.com" \
  -I https://YOUR_DOMAIN/health
```

**Result:** _____________________________________________

---

#### HTTPS Validation
- [ ] HTTPS endpoint accessible
- [ ] Valid SSL certificate
- [ ] HTTP redirects to HTTPS
- [ ] TLS 1.3 or 1.2 in use

**Test Command:**
```bash
openssl s_client -connect YOUR_DOMAIN:443 -servername YOUR_DOMAIN | grep "Protocol"
```

**Result:** _____________________________________________

---

#### Rate Limiting Validation
- [ ] Auth endpoint limits to 5 requests per 15 min
- [ ] Returns HTTP 429 after limit exceeded
- [ ] X-RateLimit-* headers present
- [ ] Retry-After header provided

**Test Command:**
```bash
for i in {1..10}; do curl -X POST https://YOUR_DOMAIN/api/auth/login; done
```

**Result:** _____________________________________________

---

#### Authentication Validation
- [ ] Protected endpoints require JWT token
- [ ] Returns 401 without valid token
- [ ] Login returns valid JWT token
- [ ] JWT expires after 24 hours

**Test Command:**
```bash
curl https://YOUR_DOMAIN/api/protected
# Expected: 401 Unauthorized
```

**Result:** _____________________________________________

---

#### Audit Logging Validation
- [ ] Login attempts logged
- [ ] Failed authentication logged
- [ ] Password resets logged
- [ ] Logs include IP, user agent, timestamps
- [ ] Logs in structured JSON format

**Test Command:**
```bash
eb logs | grep "AUDIT_LOG"
```

**Result:** _____________________________________________

---

#### WAF Validation
- [ ] SQL injection attempts blocked
- [ ] XSS attempts blocked
- [ ] Rate limit enforced (2000 req/5min)
- [ ] Blocked requests visible in CloudWatch

**Test Command:**
```bash
curl "https://YOUR_DOMAIN/api/test?id=1' OR '1'='1"
# Expected: 403 Forbidden
```

**Result:** _____________________________________________

---

#### JWT Secrets Manager Validation
- [ ] JWT secret loaded from AWS Secrets Manager
- [ ] Fallback to env var works locally
- [ ] No default secret in use
- [ ] Secret cached properly (1 hour TTL)

**Test Command:**
```bash
eb logs | grep "JWT secret loaded from AWS Secrets Manager"
```

**Result:** _____________________________________________

---

## 📋 Security Contacts

**Primary Security Contact:**
- Name: _______________________________
- Email: ______________________________
- Phone: ______________________________

**DevOps Lead:**
- Name: _______________________________
- Email: ______________________________
- Phone: ______________________________

**On-Call Rotation:**
- Current: ____________________________
- Next: _______________________________

---

## 🚨 Incident Response

### Security Event Contacts
1. Notify primary security contact immediately
2. Check CloudWatch alarms: `aws cloudwatch describe-alarms`
3. Review audit logs: `eb logs | grep AUDIT_LOG`
4. Check WAF blocks: CloudWatch → AWS/WAFV2 metrics

### Emergency Actions

**Disable Authentication (if auth system compromised):**
```bash
eb setenv AUTH_ENABLED=false
eb deploy
```

**Disable Rate Limiting (if causing issues):**
```bash
eb setenv RATE_LIMITING_ENABLED=false
eb deploy
```

**Rotate JWT Secret (if compromised):**
```bash
node scripts/setup-jwt-secret.js
eb deploy
```

**Block Specific IP (via WAF):**
```bash
# Add IP set to WAF rules
aws wafv2 create-ip-set \
  --name blocked-ips \
  --scope REGIONAL \
  --ip-address-version IPV4 \
  --addresses 1.2.3.4/32
```

---

## 📅 Maintenance Schedule

### Quarterly Tasks
- [ ] Rotate JWT secret
- [ ] Review and update WAF rules
- [ ] Review rate limiting thresholds
- [ ] Audit log analysis
- [ ] Security vulnerability scan

### Monthly Tasks
- [ ] Review CloudWatch alarms
- [ ] Check SSL certificate expiration
- [ ] Review audit logs for anomalies
- [ ] Update this document

### Weekly Tasks
- [ ] Monitor error rates
- [ ] Check WAF blocked requests
- [ ] Review alarm notifications

**Next Scheduled Review:** _______________

---

## 📝 Change Log

| Date | Change | Author | Commit |
|------|--------|--------|--------|
| 2025-12-19 | Initial template created | GitHub Copilot | 590dd52 |
| __________ | _________________________ | _______________ | _______ |
| __________ | _________________________ | _______________ | _______ |
| __________ | _________________________ | _______________ | _______ |

---

**Document Version:** 1.0  
**Last Reviewed:** _______________  
**Next Review:** _______________
