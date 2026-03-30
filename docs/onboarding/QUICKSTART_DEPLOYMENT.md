# Quick Start - AWS Deployment

**Fast path to production deployment for Light Engine Foxtrot**

---

## Prerequisites Check

```bash
# Verify tools installed
which aws && which eb && which node && echo "✅ All tools ready"

# Check AWS credentials
aws sts get-caller-identity

# Verify project directory
cd /Users/petergilbert/Light-Engine-Foxtrot
```

---

## 5-Minute Deployment

### 1. Setup JWT Secret (2 min)
```bash
node scripts/setup-jwt-secret.js
```
Copy the ARN displayed.

### 2. Configure Environment (1 min)
```bash
./scripts/configure-eb-environment.sh
# Or manually:
eb setenv JWT_SECRET_ARN="YOUR_ARN" \
          AUDIT_LOG_ENABLED=true \
          RATE_LIMITING_ENABLED=false \
          AUTH_ENABLED=false
```

### 3. Deploy Application (2 min)
```bash
eb deploy light-engine-foxtrot-prod
eb logs --stream  # Monitor deployment
```

### 4. Verify (30 sec)
```bash
curl https://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/health
# Expected: {"status":"ok"}
```

✅ **Basic deployment complete!**

---

## Full Production Setup (30 minutes)

### Step 1: JWT Secret (5 min) ✅
```bash
node scripts/setup-jwt-secret.js
```

### Step 2: HTTPS Configuration (10 min)

**Option A: Use default EB certificate (easiest)**
- HTTPS works automatically on `*.elasticbeanstalk.com`

**Option B: Custom domain with ACM**
```bash
# Request certificate
aws acm request-certificate \
  --domain-name api.yourdomain.com \
  --validation-method DNS \
  --region us-east-1

# Update .ebextensions/https-redirect.config with certificate ARN
# Commit and deploy
git add .ebextensions/https-redirect.config
git commit -m "Add HTTPS certificate"
eb deploy
```

### Step 3: Deploy with Secrets (5 min)
```bash
./scripts/configure-eb-environment.sh
eb deploy light-engine-foxtrot-prod
```

### Step 4: AWS WAF (5 min)
```bash
./scripts/setup-waf.sh
```

### Step 5: CloudWatch Alarms (5 min)
```bash
# Create SNS topic
aws sns create-topic --name foxtrot-alerts --region us-east-1
# Subscribe your email
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:YOUR_ACCOUNT:foxtrot-alerts \
  --protocol email \
  --notification-endpoint your@email.com

# Setup alarms
./scripts/setup-cloudwatch-alarms.sh arn:aws:sns:us-east-1:YOUR_ACCOUNT:foxtrot-alerts
```

### Step 6: Enable Security Features
```bash
eb setenv AUTH_ENABLED=true RATE_LIMITING_ENABLED=true
eb deploy
```

✅ **Full production deployment complete!**

---

## Validation Tests

### Quick Health Check
```bash
curl -I https://YOUR_DOMAIN/health
```

### CORS Test
```bash
curl -H "Origin: https://evil.com" -I https://YOUR_DOMAIN/health
# Should NOT include Access-Control-Allow-Origin header
```

### HTTPS Test
```bash
curl -I http://YOUR_DOMAIN/health
# Should return 301 redirect to https://
```

### Rate Limit Test (if enabled)
```bash
for i in {1..10}; do curl -X POST https://YOUR_DOMAIN/api/auth/login; done
# Should get 429 after 5 requests
```

### WAF Test
```bash
curl "https://YOUR_DOMAIN/api/test?id=1' OR '1'='1"
# Should return 403 Forbidden
```

---

## Common Commands

### View Logs
```bash
eb logs                    # Download logs
eb logs --stream          # Stream logs live
eb logs | grep ERROR      # Search for errors
eb logs | grep AUDIT_LOG  # View security events
```

### Environment Info
```bash
eb status                  # Current status
eb printenv               # Environment variables
eb config                 # Full configuration
```

### Deployment
```bash
eb deploy                 # Deploy current code
eb deploy --staged        # Deploy staged changes only
eb deploy --version v1.2  # Deploy specific version
```

### Troubleshooting
```bash
eb health                 # Health status
eb ssh                    # SSH into instance
eb terminate              # Terminate environment (careful!)
```

---

## Rollback

### Quick Rollback
```bash
eb deploy --version <PREVIOUS_VERSION_LABEL>
```

### View Versions
```bash
aws elasticbeanstalk describe-application-versions \
  --application-name light-engine-foxtrot \
  --max-records 10
```

---

## Emergency Contacts

**AWS Issues:** AWS Support Console  
**Application Issues:** GitHub Issues  
**Security Issues:** security@example.com

---

## Documentation

- **Detailed Guide:** [AWS_INFRASTRUCTURE_SETUP.md](AWS_INFRASTRUCTURE_SETUP.md)
- **Security Implementation:** [SECURITY_HARDENING.md](SECURITY_HARDENING.md)
- **Test Report:** [SECURITY_TEST_REPORT.md](SECURITY_TEST_REPORT.md)
- **Deployment Checklist:** [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md)

---

## Scripts Reference

| Script | Purpose | Time |
|--------|---------|------|
| `scripts/setup-jwt-secret.js` | Generate & store JWT secret | 2 min |
| `scripts/configure-eb-environment.sh` | Set environment variables | 5 min |
| `scripts/setup-waf.sh` | Create Web ACL with security rules | 5 min |
| `scripts/setup-cloudwatch-alarms.sh` | Create monitoring alarms | 5 min |

---

**Last Updated:** December 19, 2025  
**Version:** 1.0.0  
**Environment:** light-engine-foxtrot-prod
