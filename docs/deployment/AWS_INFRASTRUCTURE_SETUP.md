# AWS Infrastructure Setup Guide

Complete guide for setting up production security infrastructure for Light Engine Foxtrot.

## Table of Contents

1. [JWT Secrets Manager Setup](#1-jwt-secrets-manager-setup)
2. [SSL/TLS Certificate Configuration](#2-ssltls-certificate-configuration)
3. [AWS WAF Configuration](#3-aws-waf-configuration)
4. [Enable Authentication](#4-enable-authentication)
5. [CloudWatch Alarms](#5-cloudwatch-alarms)
6. [Validation](#6-validation)

---

## 1. JWT Secrets Manager Setup

### Prerequisites
- AWS CLI configured with appropriate credentials
- Node.js environment with @aws-sdk/client-secrets-manager installed
- IAM permissions for Secrets Manager operations

### Step 1.1: Generate and Store JWT Secret

```bash
# Navigate to project directory
cd /Users/petergilbert/Light-Engine-Foxtrot

# Run the setup script
node scripts/setup-jwt-secret.js
```

This script will:
- Generate a cryptographically secure 64-byte JWT secret
- Store it in AWS Secrets Manager as `foxtrot/jwt-secret`
- Provide the next steps

### Step 1.2: Get the Secret ARN

```bash
# Retrieve the full ARN
aws secretsmanager describe-secret \
  --secret-id foxtrot/jwt-secret \
  --region us-east-1 \
  --query 'ARN' \
  --output text
```

**Example output:**
```
arn:aws:secretsmanager:us-east-1:123456789012:secret:foxtrot/jwt-secret-AbCdEf
```

Save this ARN - you'll need it for the next step.

### Step 1.3: Grant Elastic Beanstalk Permission

The EB instance needs permission to read the secret.

#### Option A: Using AWS Console (Recommended)

1. Go to IAM Console → Roles
2. Search for `aws-elasticbeanstalk-ec2-role`
3. Click on the role
4. Click "Add permissions" → "Attach policies"
5. Search for `SecretsManagerReadWrite`
6. Select and attach the policy

#### Option B: Using AWS CLI

```bash
# Attach the policy to the EB instance role
aws iam attach-role-policy \
  --role-name aws-elasticbeanstalk-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite
```

#### Option C: Custom Policy (Least Privilege - Recommended for Production)

Create a custom policy that only allows reading the specific secret:

```bash
# Create policy document
cat > /tmp/jwt-secret-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT_ID:secret:foxtrot/jwt-secret-*"
    }
  ]
}
EOF

# Create the policy
aws iam create-policy \
  --policy-name FoxtrotJWTSecretReadPolicy \
  --policy-document file:///tmp/jwt-secret-policy.json

# Attach to EB role
aws iam attach-role-policy \
  --role-name aws-elasticbeanstalk-ec2-role \
  --policy-arn arn:aws:iam::YOUR_ACCOUNT_ID:policy/FoxtrotJWTSecretReadPolicy
```

### Step 1.4: Configure Elastic Beanstalk Environment

Set the JWT_SECRET_ARN environment variable in your EB environment:

#### Option A: Using EB CLI

```bash
# Set the environment variable
eb setenv JWT_SECRET_ARN=arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT_ID:secret:foxtrot/jwt-secret-AbCdEf
```

#### Option B: Using AWS Console

1. Go to Elastic Beanstalk Console
2. Select your environment: `light-engine-foxtrot-prod`
3. Click "Configuration" in the left sidebar
4. Find "Software" section, click "Edit"
5. Scroll to "Environment properties"
6. Add new property:
   - **Name:** `JWT_SECRET_ARN`
   - **Value:** `arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT_ID:secret:foxtrot/jwt-secret-AbCdEf`
7. Click "Apply"

### Step 1.5: Deploy and Test

```bash
# Deploy the application
eb deploy light-engine-foxtrot-prod

# Monitor deployment
eb logs --stream

# Test JWT secret retrieval
eb ssh
# On the instance:
node -e "import('./server/utils/secrets-manager.js').then(m => m.getJwtSecret().then(s => console.log('Secret loaded:', s ? '✅' : '❌')))"
exit
```

### Verification

Check the application logs for:
```
✅ JWT secret loaded from AWS Secrets Manager
```

If you see this, Secrets Manager integration is working!

---

## 2. SSL/TLS Certificate Configuration

### Step 2.1: Request ACM Certificate

#### If you have a custom domain (e.g., api.lightengine.io):

```bash
# Request certificate for your domain
aws acm request-certificate \
  --domain-name api.lightengine.io \
  --validation-method DNS \
  --region us-east-1

# Get certificate ARN
aws acm list-certificates \
  --region us-east-1 \
  --query 'CertificateSummaryList[?DomainName==`api.lightengine.io`].CertificateArn' \
  --output text
```

**Next:** Add the DNS validation records to your domain's DNS settings. This is usually done in your domain registrar's control panel (e.g., Route 53, GoDaddy, Cloudflare).

Wait for validation (usually 5-30 minutes).

#### If using the default EB domain:

Elastic Beanstalk environments come with automatic SSL certificates for the default domain (*.elasticbeanstalk.com). You can enable HTTPS without requesting an ACM certificate.

### Step 2.2: Configure Load Balancer for HTTPS

#### Option A: Using AWS Console (Easiest)

1. Go to Elastic Beanstalk Console
2. Select environment: `light-engine-foxtrot-prod`
3. Click "Configuration" → "Load balancer"
4. Click "Edit"
5. Under "Listeners":
   - Click "Add listener"
   - **Port:** 443
   - **Protocol:** HTTPS
   - **SSL certificate:** Select your ACM certificate (or use default for *.elasticbeanstalk.com)
   - **SSL policy:** ELBSecurityPolicy-TLS13-1-2-2021-06 (recommended)
6. Modify the existing Port 80 listener:
   - **Listener rules:** Add redirect rule
   - **Redirect to:** HTTPS
   - **Port:** 443
   - **Status code:** 301 (Permanent)
7. Click "Apply"

#### Option B: Using EB CLI with Configuration File

Create `.ebextensions/https-redirect.config`:

```yaml
option_settings:
  aws:elbv2:listener:443:
    Protocol: HTTPS
    SSLCertificateArns: arn:aws:acm:us-east-1:YOUR_ACCOUNT_ID:certificate/YOUR_CERT_ID
    SSLPolicy: ELBSecurityPolicy-TLS13-1-2-2021-06
  
  aws:elbv2:listener:80:
    ListenerEnabled: true
    Rules: forward-to-https

Resources:
  AWSEBV2LoadBalancerListenerRule80:
    Type: AWS::ElasticLoadBalancingV2::ListenerRule
    Properties:
      Actions:
        - Type: redirect
          RedirectConfig:
            Protocol: HTTPS
            Port: '443'
            StatusCode: HTTP_301
      Conditions:
        - Field: path-pattern
          Values: ['*']
      ListenerArn:
        Ref: AWSEBV2LoadBalancerListener80
      Priority: 1
```

Then deploy:
```bash
git add .ebextensions/https-redirect.config
git commit -m "Configure HTTPS and redirect"
eb deploy
```

### Step 2.3: Update Frontend API Configuration

Update your frontend to use HTTPS:

1. If you have a custom domain, update `API_BASE_URL` in your frontend config
2. The CORS configuration already includes HTTPS URLs, so this should work automatically

### Step 2.4: Test HTTPS

```bash
# Test HTTPS endpoint
curl -I https://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/health

# Verify HTTP redirects to HTTPS
curl -I http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/health
# Should see 301 redirect to https://
```

---

## 3. AWS WAF Configuration

AWS WAF provides an additional security layer against common web attacks.

### Step 3.1: Create Web ACL

#### Using AWS Console:

1. Go to AWS WAF Console
2. Click "Create web ACL"
3. **Name:** `foxtrot-web-acl`
4. **Resource type:** Regional resources (Application Load Balancer)
5. **Region:** US East (N. Virginia)
6. Click "Next"

### Step 3.2: Add Managed Rule Groups

Add these AWS Managed Rules:

1. **Core rule set (CRS)**
   - Protects against OWASP Top 10
   - Click "Add managed rule groups"
   - Expand "AWS managed rule groups"
   - Select "Core rule set"
   - Click "Add rule"

2. **Known bad inputs**
   - Protects against known malicious patterns
   - Select "Known bad inputs"
   - Click "Add rule"

3. **SQL database**
   - Protects against SQL injection
   - Select "SQL database"
   - Click "Add rule"

4. **Linux operating system**
   - Protects against Linux-specific attacks
   - Select "Linux operating system"
   - Click "Add rule"

5. **PHP application**
   - Protects against PHP-specific vulnerabilities
   - Select "PHP application"
   - Click "Add rule"

### Step 3.3: Add Rate-Based Rule

1. Click "Add my own rules and rule groups"
2. Select "Rule builder"
3. **Rule type:** Rate-based rule
4. **Name:** `rate-limit-per-ip`
5. **Rate limit:** 2000 requests per 5 minutes
6. **IP address to use:** Source IP address
7. **Action:** Block
8. Click "Add rule"

### Step 3.4: Set Default Action

- **Default action:** Allow
- This allows traffic that doesn't match any rule

Click "Next"

### Step 3.5: Set Rule Priority

Arrange rules in this order (drag to reorder):
1. Rate-based rule (rate-limit-per-ip)
2. Core rule set
3. Known bad inputs
4. SQL database
5. Linux operating system
6. PHP application

Click "Next"

### Step 3.6: Configure CloudWatch Metrics

- Enable CloudWatch metrics
- **Metric name:** `foxtrot-waf`
- Enable sampled requests (100% for testing, can reduce later)

Click "Next", then "Create web ACL"

### Step 3.7: Associate with Load Balancer

1. In the Web ACL page, click "Associated AWS resources"
2. Click "Add AWS resources"
3. **Resource type:** Application Load Balancer
4. Select your Elastic Beanstalk load balancer
   - It will be named something like: `awseb-e-n-AWSEBLoa-...`
5. Click "Add"

### Step 3.8: CLI Alternative

```bash
# Create Web ACL
aws wafv2 create-web-acl \
  --name foxtrot-web-acl \
  --scope REGIONAL \
  --region us-east-1 \
  --default-action Allow={} \
  --rules file://waf-rules.json \
  --visibility-config SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName=foxtrot-waf

# Get your load balancer ARN
aws elbv2 describe-load-balancers \
  --region us-east-1 \
  --query "LoadBalancers[?contains(LoadBalancerName, 'awseb')].LoadBalancerArn" \
  --output text

# Associate with load balancer
aws wafv2 associate-web-acl \
  --web-acl-arn <WEB_ACL_ARN> \
  --resource-arn <LOAD_BALANCER_ARN> \
  --region us-east-1
```

### Step 3.9: Test WAF Rules

```bash
# Test rate limiting (should get blocked after 2000 requests in 5 min)
for i in {1..2100}; do
  curl -s -o /dev/null -w "%{http_code}\n" https://YOUR_DOMAIN/health
done

# Test SQL injection (should be blocked)
curl "https://YOUR_DOMAIN/api/users?id=1' OR '1'='1"

# Expected: 403 Forbidden
```

---

## 4. Enable Authentication

After SSL/TLS is configured, enable authentication in production.

### Step 4.1: Enable Auth in Environment

```bash
# Set auth flags
eb setenv AUTH_ENABLED=true RATE_LIMITING_ENABLED=true

# Deploy
eb deploy
```

### Step 4.2: Test Authentication

```bash
# Test without token (should fail)
curl -H "Authorization: Bearer invalid" \
  https://YOUR_DOMAIN/api/protected-endpoint

# Expected: 401 Unauthorized

# Test login
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"test123"}' \
  https://YOUR_DOMAIN/api/auth/login

# Should return JWT token
```

---

## 5. CloudWatch Alarms

Set up alarms for monitoring security events.

### Step 5.1: High Rate Limit Hits

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name foxtrot-high-rate-limit-hits \
  --alarm-description "Alert when rate limiting is frequently triggered" \
  --metric-name RateLimitExceeded \
  --namespace Foxtrot/Security \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 100 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:YOUR_ACCOUNT_ID:foxtrot-alerts
```

### Step 5.2: Failed Authentication Attempts

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name foxtrot-failed-auth-attempts \
  --alarm-description "Alert on high number of failed login attempts" \
  --metric-name LoginFailures \
  --namespace Foxtrot/Security \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 50 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:YOUR_ACCOUNT_ID:foxtrot-alerts
```

### Step 5.3: WAF Blocked Requests

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name foxtrot-waf-high-blocks \
  --alarm-description "Alert when WAF blocks many requests" \
  --metric-name BlockedRequests \
  --namespace AWS/WAFV2 \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 1000 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:YOUR_ACCOUNT_ID:foxtrot-alerts
```

### Step 5.4: High CPU Usage

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name foxtrot-high-cpu \
  --alarm-description "Alert when instance CPU is high" \
  --metric-name CPUUtilization \
  --namespace AWS/EC2 \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:YOUR_ACCOUNT_ID:foxtrot-alerts
```

---

## 6. Validation

### Security Features Checklist

Run through this checklist to validate all security features:

- [ ] **CORS**: Only allowed origins can make requests
  ```bash
  # Should succeed
  curl -H "Origin: http://light-engine-demo-1765326376.s3-website-us-east-1.amazonaws.com" \
    -I https://YOUR_DOMAIN/api/health
  
  # Should fail (no CORS headers)
  curl -H "Origin: https://evil.com" \
    -I https://YOUR_DOMAIN/api/health
  ```

- [ ] **Rate Limiting**: Requests are throttled
  ```bash
  # Hit auth endpoint 10 times quickly (limit is 5/15min)
  for i in {1..10}; do
    curl -X POST https://YOUR_DOMAIN/api/auth/login
  done
  # Should see 429 Too Many Requests after 5th attempt
  ```

- [ ] **Audit Logging**: Events are logged
  ```bash
  eb logs | grep "AUDIT_LOG"
  # Should see login attempts, password resets, etc.
  ```

- [ ] **JWT Secrets**: Loaded from Secrets Manager
  ```bash
  eb logs | grep "JWT secret loaded from AWS Secrets Manager"
  # Should see success message
  ```

- [ ] **HTTPS**: Traffic encrypted
  ```bash
  curl -I https://YOUR_DOMAIN/health
  # Should return 200 OK with proper TLS
  
  openssl s_client -connect YOUR_DOMAIN:443 -servername YOUR_DOMAIN
  # Should show valid certificate
  ```

- [ ] **HTTP Redirect**: HTTP traffic redirected
  ```bash
  curl -I http://YOUR_DOMAIN/health
  # Should return 301 redirect to https://
  ```

- [ ] **WAF Protection**: Malicious requests blocked
  ```bash
  # SQL injection test
  curl "https://YOUR_DOMAIN/api/users?id=1' OR '1'='1"
  # Should return 403 Forbidden
  ```

- [ ] **Authentication**: Protected endpoints require valid JWT
  ```bash
  curl https://YOUR_DOMAIN/api/protected
  # Should return 401 Unauthorized
  
  # Login and get token
  TOKEN=$(curl -X POST -H "Content-Type: application/json" \
    -d '{"email":"admin@example.com","password":"test"}' \
    https://YOUR_DOMAIN/api/auth/login | jq -r '.token')
  
  # Use token
  curl -H "Authorization: Bearer $TOKEN" \
    https://YOUR_DOMAIN/api/protected
  # Should return 200 OK
  ```

- [ ] **CloudWatch Alarms**: Alarms configured and active
  ```bash
  aws cloudwatch describe-alarms \
    --alarm-name-prefix foxtrot- \
    --query 'MetricAlarms[*].[AlarmName,StateValue]' \
    --output table
  # Should show all alarms in OK state
  ```

### Performance Testing

```bash
# Load test (requires apache bench)
ab -n 1000 -c 10 https://YOUR_DOMAIN/health

# Should complete without errors and maintain good response times
```

### Security Scan

```bash
# SSL test
sslyze YOUR_DOMAIN

# Security headers
curl -I https://YOUR_DOMAIN/
# Check for security headers:
# - Strict-Transport-Security
# - X-Content-Type-Options
# - X-Frame-Options
# - Content-Security-Policy
```

---

## Troubleshooting

### Secrets Manager Issues

**Problem:** JWT secret not loading from Secrets Manager

**Solutions:**
1. Check IAM permissions:
   ```bash
   aws iam get-role-policy --role-name aws-elasticbeanstalk-ec2-role
   ```
2. Verify secret exists:
   ```bash
   aws secretsmanager get-secret-value --secret-id foxtrot/jwt-secret
   ```
3. Check EB logs:
   ```bash
   eb logs | grep -i secret
   ```

### SSL/TLS Issues

**Problem:** Certificate validation failing

**Solutions:**
1. Check DNS records are correct
2. Wait for validation (can take up to 30 minutes)
3. Verify certificate status:
   ```bash
   aws acm describe-certificate --certificate-arn YOUR_CERT_ARN
   ```

### WAF Issues

**Problem:** Legitimate requests being blocked

**Solutions:**
1. Check CloudWatch Logs for WAF
2. Review sampled requests in WAF console
3. Add exceptions for false positives:
   ```bash
   # Create rule to bypass specific patterns
   aws wafv2 update-web-acl --name foxtrot-web-acl ...
   ```

### Rate Limiting Issues

**Problem:** Rate limits too restrictive

**Solutions:**
1. Adjust limits in `.env`:
   ```
   RATE_LIMIT_AUTH_MAX=10
   RATE_LIMIT_AUTH_WINDOW_MS=900000
   ```
2. Redeploy:
   ```bash
   eb deploy
   ```

---

## Summary

After completing all steps:

1. ✅ JWT secrets stored securely in AWS Secrets Manager
2. ✅ HTTPS enabled with TLS 1.3
3. ✅ HTTP traffic redirected to HTTPS
4. ✅ AWS WAF protecting against common attacks
5. ✅ Authentication enabled in production
6. ✅ CloudWatch alarms monitoring security events
7. ✅ All security features validated

**Your Light Engine Foxtrot production environment is now secure!** 🔒
