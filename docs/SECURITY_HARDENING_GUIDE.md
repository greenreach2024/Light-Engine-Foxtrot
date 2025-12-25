# Security Hardening Guide

Production security checklist and best practices for Light Engine deployments.

## Table of Contents

1. [Overview](#overview)
2. [Infrastructure Security](#infrastructure-security)
3. [Application Security](#application-security)
4. [Data Protection](#data-protection)
5. [Network Security](#network-security)
6. [Access Control](#access-control)
7. [Monitoring & Incident Response](#monitoring--incident-response)
8. [Compliance](#compliance)
9. [Security Checklist](#security-checklist)

## Overview

This guide provides comprehensive security hardening steps for production Light Engine deployments across all platforms (cloud, edge, desktop).

**Security Principles:**
- **Defense in Depth**: Multiple layers of security controls
- **Least Privilege**: Minimal permissions required for operation
- **Zero Trust**: Verify every access request
- **Encryption Everywhere**: Data encrypted at rest and in transit
- **Continuous Monitoring**: Real-time threat detection and response

## Infrastructure Security

### Cloud (AWS)

**VPC Configuration:**

```yaml
# Secure VPC with public/private subnets
VPC:
  CidrBlock: 10.0.0.0/16
  EnableDnsSupport: true
  EnableDnsHostnames: true

PublicSubnets:
  - CidrBlock: 10.0.1.0/24  # ALB only
  - CidrBlock: 10.0.2.0/24  # ALB only (multi-AZ)

PrivateSubnets:
  - CidrBlock: 10.0.10.0/24  # ECS tasks
  - CidrBlock: 10.0.11.0/24  # ECS tasks (multi-AZ)
  - CidrBlock: 10.0.20.0/24  # RDS primary
  - CidrBlock: 10.0.21.0/24  # RDS replica

# NO public IP addresses on ECS tasks or RDS instances
```

**Security Groups (Strict Rules):**

```yaml
# ALB Security Group
ALB-SG:
  Ingress:
    - Port: 443
      Source: 0.0.0.0/0  # HTTPS only from internet
  Egress:
    - Port: 3000
      Destination: ECS-SG  # To ECS tasks only

# ECS Security Group
ECS-SG:
  Ingress:
    - Port: 3000
      Source: ALB-SG  # Only from ALB
  Egress:
    - Port: 5432
      Destination: RDS-SG  # To database only
    - Port: 443
      Destination: 0.0.0.0/0  # For external API calls

# RDS Security Group
RDS-SG:
  Ingress:
    - Port: 5432
      Source: ECS-SG  # Only from ECS tasks
  Egress:
    - None  # Database doesn't initiate connections
```

**IAM Policies (Least Privilege):**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage"
      ],
      "Resource": "arn:aws:ecr:us-east-1:ACCOUNT:repository/light-engine"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:us-east-1:ACCOUNT:log-group:/ecs/light-engine:*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:light-engine/*"
    }
  ]
}
```

**Enable AWS Services:**

```bash
# GuardDuty (threat detection)
aws guardduty create-detector --enable

# Security Hub (compliance monitoring)
aws securityhub enable-security-hub

# Config (configuration monitoring)
aws configservice put-configuration-recorder \
  --configuration-recorder name=default,roleARN=$CONFIG_ROLE \
  --recording-group allSupported=true,includeGlobalResourceTypes=true

# CloudTrail (audit logging)
aws cloudtrail create-trail \
  --name light-engine-audit \
  --s3-bucket-name light-engine-audit-logs \
  --enable-log-file-validation \
  --is-multi-region-trail
```

### Edge Devices

**Operating System Hardening:**

```bash
# Keep system updated
sudo apt update && sudo apt upgrade -y
sudo apt install unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades

# Disable unnecessary services
sudo systemctl disable bluetooth
sudo systemctl disable avahi-daemon  # Unless using mDNS
sudo systemctl disable cups

# Configure firewall (UFW)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 443/tcp  # HTTPS only
sudo ufw enable

# Fail2ban for brute force protection
sudo apt install fail2ban
sudo systemctl enable fail2ban
```

**Fail2ban Configuration:**

```ini
# /etc/fail2ban/jail.local
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3

[light-engine]
enabled = true
port = 443
filter = light-engine
logpath = /var/log/light-engine/access.log
maxretry = 5

[sshd]
enabled = true
port = 22
maxretry = 3
```

**SSH Hardening:**

```bash
# Disable password authentication, use keys only
sudo sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/#PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sudo sed -i 's/X11Forwarding yes/X11Forwarding no/' /etc/ssh/sshd_config

# Change default port (optional but recommended)
sudo sed -i 's/#Port 22/Port 2222/' /etc/ssh/sshd_config

# Restart SSH
sudo systemctl restart sshd
```

## Application Security

### HTTPS/TLS

**Enforce HTTPS Everywhere:**

```javascript
// server-foxtrot.js
app.use((req, res, next) => {
  if (!req.secure && req.get('x-forwarded-proto') !== 'https' && process.env.NODE_ENV === 'production') {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});
```

**Strong TLS Configuration:**

```nginx
# nginx.conf
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
ssl_prefer_server_ciphers on;
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 10m;
ssl_stapling on;
ssl_stapling_verify on;

# HSTS header (force HTTPS for 1 year)
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
```

### Authentication & Session Management

**Secure Session Configuration:**

```javascript
app.use(session({
  secret: process.env.SESSION_SECRET,  // 64+ random characters
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,  // HTTPS only
    httpOnly: true,  // No JavaScript access
    sameSite: 'strict',  // CSRF protection
    maxAge: 3600000  // 1 hour
  },
  store: new RedisStore({
    client: redisClient,
    prefix: 'sess:'
  })
}));
```

**Password Policy:**

```javascript
const passwordPolicy = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSymbols: true,
  prohibitCommon: true,  // Check against common password list
  maxAge: 90,  // Days before forced reset
  historySize: 5  // Can't reuse last 5 passwords
};
```

**Multi-Factor Authentication:**

```bash
# Enable MFA for admin users
curl -X POST https://my-farm.greenreach.io/api/auth/mfa/enable \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "method": "totp",
    "backupCodes": true
  }'
```

### Input Validation & Sanitization

**SQL Injection Prevention:**

```javascript
// ALWAYS use parameterized queries
const { rows } = await db.query(
  'SELECT * FROM users WHERE email = $1',
  [email]  // Parameterized
);

// NEVER concatenate user input
// BAD: const { rows } = await db.query(`SELECT * FROM users WHERE email = '${email}'`);
```

**XSS Prevention:**

```javascript
const helmet = require('helmet');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],  // Minimize unsafe-inline
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));
```

**API Rate Limiting:**

```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,  // Max 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many requests, please try again later.'
    });
  }
});

app.use('/api/', limiter);

// Stricter limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,  // Only 5 login attempts per 15 minutes
  skipSuccessfulRequests: true
});

app.use('/api/auth/login', authLimiter);
```

## Data Protection

### Encryption at Rest

**Database Encryption:**

```bash
# AWS RDS - Enable encryption
aws rds modify-db-instance \
  --db-instance-identifier light-engine-db \
  --storage-encrypted \
  --kms-key-id alias/light-engine-db \
  --apply-immediately

# PostgreSQL - Enable pgcrypto for column-level encryption
CREATE EXTENSION pgcrypto;

# Encrypt sensitive columns
ALTER TABLE users ADD COLUMN ssn_encrypted BYTEA;
UPDATE users SET ssn_encrypted = pgp_sym_encrypt(ssn, 'encryption_key');
ALTER TABLE users DROP COLUMN ssn;
```

**File System Encryption:**

```bash
# Linux (LUKS)
sudo cryptsetup luksFormat /dev/sdb
sudo cryptsetup luksOpen /dev/sdb light-engine-data
sudo mkfs.ext4 /dev/mapper/light-engine-data
sudo mount /dev/mapper/light-engine-data /var/lib/light-engine

# macOS (FileVault)
sudo fdesetup enable

# Windows (BitLocker)
manage-bde -on C: -RecoveryPassword
```

### Encryption in Transit

**All External Communication:**

```javascript
// Force TLS for all outbound requests
const https = require('https');
const httpsAgent = new https.Agent({
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3'
});

axios.defaults.httpsAgent = httpsAgent;
```

**Database Connections:**

```javascript
// PostgreSQL with SSL
const pool = new Pool({
  host: process.env.DB_HOST,
  port: 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync('/path/to/ca-cert.pem').toString()
  }
});
```

### Secrets Management

**AWS Secrets Manager:**

```bash
# Store database credentials
aws secretsmanager create-secret \
  --name light-engine/db-credentials \
  --secret-string '{"username":"admin","password":"..."}'

# Rotate secrets automatically
aws secretsmanager rotate-secret \
  --secret-id light-engine/db-credentials \
  --rotation-lambda-arn arn:aws:lambda:us-east-1:ACCOUNT:function:RotateSecret \
  --rotation-rules AutomaticallyAfterDays=30
```

**Application Usage:**

```javascript
const AWS = require('aws-sdk');
const secretsManager = new AWS.SecretsManager();

async function getSecret(secretName) {
  const { SecretString } = await secretsManager.getSecretValue({
    SecretId: secretName
  }).promise();
  
  return JSON.parse(SecretString);
}

// Use in application
const dbCreds = await getSecret('light-engine/db-credentials');
```

### Backup Encryption

```bash
# Encrypt backups with GPG
pg_dump lightengine | gzip | gpg --encrypt --recipient admin@greenreach.io > backup.sql.gz.gpg

# Automated encrypted backups
#!/bin/bash
BACKUP_DATE=$(date +%Y%m%d)
pg_dump lightengine | gzip | \
  gpg --encrypt --recipient admin@greenreach.io > \
  /backups/lightengine-$BACKUP_DATE.sql.gz.gpg

# Upload to S3 with server-side encryption
aws s3 cp /backups/lightengine-$BACKUP_DATE.sql.gz.gpg \
  s3://light-engine-backups/ \
  --server-side-encryption aws:kms \
  --ssekms-key-id alias/light-engine-backups
```

## Network Security

### Firewall Configuration

**Cloud (AWS Security Groups):**
- See [Infrastructure Security](#infrastructure-security) section

**Edge (UFW):**

```bash
# Default deny
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow HTTPS
sudo ufw allow 443/tcp comment 'HTTPS'

# Allow SSH from specific IPs only
sudo ufw allow from 192.168.1.0/24 to any port 22 comment 'SSH from local network'

# Allow PostgreSQL from app server only
sudo ufw allow from 10.0.10.5 to any port 5432 comment 'PostgreSQL'

# Enable
sudo ufw enable
```

### Network Segmentation

**Separate Networks:**

```
Internet
    │
    ▼
┌─────────────────┐
│  DMZ (Public)   │  ← Web servers, ALB
└────────┬────────┘
         │
    ▼
┌─────────────────┐
│ Application     │  ← ECS tasks, app servers
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Data Tier       │  ← Databases, file storage
└─────────────────┘
```

### DDoS Protection

**AWS Shield & WAF:**

```bash
# Enable AWS Shield Standard (free)
# Automatically enabled on all AWS accounts

# Enable Shield Advanced (paid, $3000/month)
aws shield subscribe-to-shield-advanced

# Configure WAF rules
aws wafv2 create-web-acl \
  --name light-engine-waf \
  --scope REGIONAL \
  --default-action Allow={} \
  --rules file://waf-rules.json

# Associate WAF with ALB
aws wafv2 associate-web-acl \
  --web-acl-arn arn:aws:wafv2:... \
  --resource-arn arn:aws:elasticloadbalancing:...
```

**Rate Limiting (Application Level):**
- See [API Rate Limiting](#input-validation--sanitization) section

## Access Control

### Role-Based Access Control (RBAC)

**User Roles:**

```javascript
const roles = {
  admin: {
    permissions: ['*']  // Full access
  },
  manager: {
    permissions: [
      'users:read', 'users:write',
      'inventory:*',
      'orders:*',
      'wholesale:*',
      'reports:read'
    ]
  },
  operator: {
    permissions: [
      'inventory:read', 'inventory:write',
      'orders:read',
      'sensors:read',
      'automation:read', 'automation:write'
    ]
  },
  viewer: {
    permissions: [
      'inventory:read',
      'orders:read',
      'sensors:read',
      'automation:read',
      'reports:read'
    ]
  }
};
```

**Middleware:**

```javascript
function requirePermission(permission) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const userRole = roles[req.user.role];
    const hasPermission = userRole.permissions.includes('*') ||
                         userRole.permissions.includes(permission) ||
                         userRole.permissions.includes(permission.split(':')[0] + ':*');
    
    if (!hasPermission) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    next();
  };
}

// Usage
app.delete('/api/users/:id', requirePermission('users:delete'), deleteUser);
```

### API Key Management

**Generate Secure Keys:**

```javascript
const crypto = require('crypto');

function generateApiKey() {
  return 'sk_' + crypto.randomBytes(32).toString('base64url');
}

// Store hash, not plain key
function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}
```

**Key Rotation:**

```bash
# Rotate API keys every 90 days
curl -X POST https://my-farm.greenreach.io/api/auth/api-keys/rotate \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"keyId": "sk_abc123..."}'

# Response includes new key (save it!)
{
  "newKey": "sk_xyz789...",
  "expiresAt": "2026-03-25T00:00:00Z",
  "oldKeyValidUntil": "2025-12-31T00:00:00Z"
}
```

### Audit Logging

**Log All Access:**

```javascript
function auditLog(action, resource, details) {
  db.query(
    'INSERT INTO audit_logs (user_id, action, resource, details, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5, $6)',
    [req.user.id, action, resource, details, req.ip, req.get('user-agent')]
  );
}

// Usage
app.delete('/api/users/:id', requireAuth, async (req, res) => {
  await deleteUser(req.params.id);
  auditLog('DELETE', 'user', { userId: req.params.id });
  res.status(204).send();
});
```

## Monitoring & Incident Response

### Security Monitoring

**Log Aggregation:**

```bash
# Send logs to CloudWatch (AWS)
aws logs create-log-group --log-group-name /security/light-engine

# Configure log streaming
# server-foxtrot.js
const winston = require('winston');
const CloudWatchTransport = require('winston-cloudwatch');

const logger = winston.createLogger({
  transports: [
    new CloudWatchTransport({
      logGroupName: '/security/light-engine',
      logStreamName: 'security-events',
      awsRegion: 'us-east-1'
    })
  ]
});

// Log security events
logger.info('User login', { userId, ip: req.ip });
logger.warn('Failed login attempt', { email, ip: req.ip });
logger.error('SQL injection attempt detected', { query, ip: req.ip });
```

**Intrusion Detection:**

```bash
# Install OSSEC
sudo apt install ossec-hids

# Configure monitoring
# /var/ossec/etc/ossec.conf
<ossec_config>
  <syscheck>
    <directories check_all="yes">/var/www/light-engine</directories>
    <directories check_all="yes">/etc/light-engine</directories>
  </syscheck>
  
  <rootcheck>
    <frequency>36000</frequency>
  </rootcheck>
  
  <active-response>
    <command>firewall-drop</command>
    <location>local</location>
    <level>7</level>
  </active-response>
</ossec_config>
```

### Alerting

**CloudWatch Alarms:**

```bash
# Failed login attempts
aws cloudwatch put-metric-alarm \
  --alarm-name light-engine-failed-logins \
  --alarm-description "Too many failed login attempts" \
  --metric-name FailedLogins \
  --namespace LightEngine \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT:security-alerts

# Unauthorized API access
aws cloudwatch put-metric-alarm \
  --alarm-name light-engine-unauthorized-access \
  --metric-name UnauthorizedAccess \
  --namespace LightEngine \
  --statistic Sum \
  --period 60 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT:security-alerts
```

### Incident Response Plan

**Detection → Containment → Eradication → Recovery → Lessons Learned**

1. **Detection**:
   - Automated alerts from monitoring
   - User reports
   - Security scanning tools

2. **Containment**:
   - Isolate affected systems
   - Block malicious IPs
   - Disable compromised accounts
   - Preserve evidence

3. **Eradication**:
   - Remove malware/backdoors
   - Patch vulnerabilities
   - Reset credentials
   - Review audit logs

4. **Recovery**:
   - Restore from clean backups
   - Verify system integrity
   - Gradual service restoration
   - Enhanced monitoring

5. **Lessons Learned**:
   - Document incident timeline
   - Analyze root cause
   - Update security controls
   - Train team on findings

## Compliance

### GDPR (EU Data Protection)

**Data Subject Rights:**

```javascript
// Right to access
app.get('/api/gdpr/data-export', requireAuth, async (req, res) => {
  const userData = await getUserData(req.user.id);
  res.json(userData);
});

// Right to erasure
app.delete('/api/gdpr/delete-account', requireAuth, async (req, res) => {
  await anonymizeUserData(req.user.id);
  await deleteAccount(req.user.id);
  res.status(204).send();
});

// Right to data portability
app.get('/api/gdpr/data-export/json', requireAuth, async (req, res) => {
  const data = await exportUserData(req.user.id);
  res.json(data);
});
```

**Consent Management:**

```javascript
const consent = {
  necessary: true,  // Always true
  analytics: false,  // Optional
  marketing: false  // Optional
};

// Only track analytics if consent given
if (consent.analytics) {
  trackPageView();
}
```

### SOC 2 Readiness

**Access Controls:**
- MFA for all admin users
- Regular access reviews
- Automated de-provisioning

**Monitoring:**
- Centralized logging
- Security event alerting
- Annual penetration testing

**Data Protection:**
- Encryption at rest and in transit
- Regular backups
- Disaster recovery plan

**Change Management:**
- Code review required
- Staging environment testing
- Rollback procedures

## Security Checklist

### Pre-Deployment

- [ ] All dependencies updated to latest secure versions
- [ ] Security scanning passed (npm audit, Snyk, etc.)
- [ ] Secrets moved to environment variables or secrets manager
- [ ] HTTPS configured with valid certificates
- [ ] Firewall rules configured (least privilege)
- [ ] Database encrypted at rest
- [ ] Strong password policy enforced
- [ ] Rate limiting enabled on all APIs
- [ ] Input validation on all user inputs
- [ ] XSS protection headers configured
- [ ] CSRF protection enabled
- [ ] SQL injection prevention (parameterized queries)
- [ ] Logging configured for security events
- [ ] Monitoring and alerting set up
- [ ] Backup and recovery tested
- [ ] Incident response plan documented

### Post-Deployment

- [ ] Penetration testing completed
- [ ] Vulnerability scanning automated
- [ ] Security patches applied within 7 days
- [ ] Access logs reviewed weekly
- [ ] Failed login attempts monitored
- [ ] Unauthorized access attempts investigated
- [ ] Backup restoration tested monthly
- [ ] Disaster recovery plan tested quarterly
- [ ] Security training for team completed
- [ ] Compliance audit passed (if applicable)

### Ongoing

- [ ] Weekly security updates applied
- [ ] Monthly access review
- [ ] Quarterly penetration testing
- [ ] Annual security audit
- [ ] Continuous vulnerability monitoring
- [ ] Regular security awareness training
- [ ] Incident response drills

## Support

- **Security Issues**: security@greenreach.io
- **Bug Bounty**: https://greenreach.io/security/bug-bounty
- **Security Advisory**: https://greenreach.io/security/advisories
- **Compliance Questions**: compliance@greenreach.io

## Next Steps

- [Edge Deployment Guide](EDGE_DEPLOYMENT_GUIDE.md)
- [Cloud Deployment Guide](CLOUD_DEPLOYMENT_GUIDE.md)
- [Desktop App Guide](DESKTOP_APP_GUIDE.md)
- [Wholesale Integration](WHOLESALE_INTEGRATION_GUIDE.md)
