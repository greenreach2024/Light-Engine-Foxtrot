# Security Guide

## Overview

GreenReach implements enterprise-grade security for edge devices and central infrastructure. This guide covers certificate management, credential storage, TLS configuration, and security best practices.

## Security Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Edge Device Security                     │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐   ┌──────────────┐  │
│  │ Certificate  │    │  Credential  │   │   Encrypted  │  │
│  │   Manager    │◄──►│   Manager    │◄─►│   Storage    │  │
│  └──────┬───────┘    └──────┬───────┘   └──────────────┘  │
│         │                    │                              │
│         │ TLS 1.3 + mTLS    │ AES-256-GCM                 │
│         │                    │                              │
└─────────┼────────────────────┼──────────────────────────────┘
          │                    │
          │ Mutual TLS Auth    │ API Key + Secret
          │                    │
┌─────────▼────────────────────▼──────────────────────────────┐
│              GreenReach Central Security                    │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐   ┌──────────────┐  │
│  │ Certificate  │    │     API      │   │   Secrets    │  │
│  │  Authority   │    │   Gateway    │   │   Manager    │  │
│  └──────────────┘    └──────────────┘   └──────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Certificate Management

### Overview

GreenReach uses TLS certificates for mutual authentication between edge devices and GreenReach Central. Each farm receives a unique certificate signed by the GreenReach Certificate Authority.

### Certificate Lifecycle

#### 1. Provisioning

**Process:**
1. Edge device generates private key (RSA 2048-bit)
2. Edge device creates CSR (Certificate Signing Request)
3. CSR sent to GreenReach Central via authenticated API
4. Central CA signs certificate
5. Certificate returned to edge device
6. Certificate and private key stored securely

**Command:**
```bash
# Automatic provisioning during setup
curl -X POST http://localhost:3000/api/certs/provision \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json"
```

**API Endpoint:**
```
POST /api/certs/provision
```

**Request:**
```json
{
  "farmId": "GR-17350001001",
  "csr": "-----BEGIN CERTIFICATE REQUEST-----\n..."
}
```

**Response:**
```json
{
  "certificate": "-----BEGIN CERTIFICATE-----\n...",
  "caCertificate": "-----BEGIN CERTIFICATE-----\n...",
  "expiresAt": "2025-12-19T00:00:00Z",
  "serialNumber": "1A2B3C4D5E6F"
}
```

#### 2. Storage

**File Locations:**
```
/etc/greenreach/certs/
├── GR-17350001001.crt    (Certificate, 0600)
├── GR-17350001001.key    (Private key, 0600)
├── ca.crt                (CA certificate, 0600)
└── backup/               (Certificate backups)
    ├── cert-2024-01-15.crt
    └── key-2024-01-15.key
```

**Permissions:**
- All files: `0600` (owner read/write only)
- Directory: `0700` (owner read/write/execute only)
- Owner: `root` or `greenreach` user

#### 3. Rotation

**Auto-Renewal:**
- Certificates valid for 365 days
- Auto-renewal triggered 30 days before expiry
- Daily check for expiration status
- Automatic backup before renewal
- Fallback to backup on renewal failure

**Manual Renewal:**
```bash
# Trigger manual renewal
curl -X POST http://localhost:3000/api/certs/renew \
  -H "Authorization: Bearer $API_KEY"
```

**Rotation Schedule:**
```
Day 0:    Certificate issued (valid 365 days)
Day 335:  Warning: Certificate expiring in 30 days
Day 335:  Auto-renewal triggered
Day 335:  New certificate provisioned
Day 365:  Old certificate expires (already replaced)
```

#### 4. Verification

**Check Certificate:**
```bash
# View certificate details
openssl x509 -in /etc/greenreach/certs/GR-17350001001.crt -noout -text

# Check expiry date
openssl x509 -in /etc/greenreach/certs/GR-17350001001.crt -noout -dates

# Verify certificate chain
openssl verify -CAfile /etc/greenreach/certs/ca.crt \
  /etc/greenreach/certs/GR-17350001001.crt
```

**API Verification:**
```bash
# Check certificate status
curl http://localhost:3000/api/certs/status
```

**Response:**
```json
{
  "valid": true,
  "expiresAt": "2025-12-19T00:00:00Z",
  "daysUntilExpiry": 180,
  "subject": "CN=GR-17350001001",
  "issuer": "CN=GreenReach CA"
}
```

## Credential Management

### Overview

Credentials (API keys, passwords, secrets) are encrypted using AES-256-GCM and stored with file permissions restricting access.

### Credential Types

1. **API Credentials**
   - API Key (64 hex characters)
   - API Secret (64 hex characters, hashed)
   - Farm ID

2. **Database Credentials**
   - PostgreSQL username/password (Central)
   - SQLite encryption key (Edge)

3. **Service Credentials**
   - MQTT broker credentials
   - Cloud storage keys (S3, etc.)
   - Third-party API keys

### Storage

**Encryption:**
- Algorithm: AES-256-GCM
- Key derivation: PBKDF2 (100,000 iterations)
- Authentication: GCM tag for integrity
- IV: Random 16 bytes per credential

**File Structure:**
```
/etc/greenreach/credentials/
├── master.key                  (Master encryption key, 0600)
├── {hash}.json                 (Encrypted credentials)
└── backups/                    (Credential backups)
    └── backup-2024-01-15.json
```

**Credential File Format:**
```json
{
  "key": "api_key",
  "encrypted": {
    "iv": "1a2b3c4d5e6f...",
    "encrypted": "a1b2c3d4e5f6...",
    "tag": "9z8y7x6w5v..."
  },
  "metadata": {
    "createdAt": "2024-01-15T10:00:00Z",
    "updatedAt": "2024-01-15T10:00:00Z",
    "rotated": false
  }
}
```

### API Usage

#### Store Credential
```bash
curl -X POST http://localhost:3000/api/credentials \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "mqtt_password",
    "value": "secure_password_123",
    "metadata": {
      "service": "mqtt",
      "rotationDays": 90
    }
  }'
```

#### Retrieve Credential
```bash
curl http://localhost:3000/api/credentials/mqtt_password \
  -H "Authorization: Bearer $API_KEY"
```

#### Rotate Credential
```bash
curl -X POST http://localhost:3000/api/credentials/mqtt_password/rotate \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "newValue": "new_secure_password_456"
  }'
```

#### List Credentials
```bash
curl http://localhost:3000/api/credentials \
  -H "Authorization: Bearer $API_KEY"
```

**Response:**
```json
{
  "credentials": [
    {
      "key": "api_key",
      "metadata": {
        "createdAt": "2024-01-15T10:00:00Z",
        "rotated": false
      }
    },
    {
      "key": "mqtt_password",
      "metadata": {
        "createdAt": "2024-01-15T10:00:00Z",
        "rotated": true,
        "rotatedAt": "2024-01-20T10:00:00Z"
      }
    }
  ]
}
```

## Mutual TLS (mTLS)

### Overview

Mutual TLS provides two-way authentication where both client (edge device) and server (GreenReach Central) verify each other's identity.

### Configuration

#### Edge Device (Client)
```javascript
import https from 'https';
import fs from 'fs';

const options = {
  hostname: 'api.greenreach.com',
  port: 443,
  path: '/api/sync/health',
  method: 'POST',
  cert: fs.readFileSync('/etc/greenreach/certs/GR-17350001001.crt'),
  key: fs.readFileSync('/etc/greenreach/certs/GR-17350001001.key'),
  ca: fs.readFileSync('/etc/greenreach/certs/ca.crt'),
  rejectUnauthorized: true
};

const req = https.request(options, (res) => {
  console.log('Status:', res.statusCode);
});
```

#### GreenReach Central (Server)
```javascript
import https from 'https';
import fs from 'fs';

const options = {
  cert: fs.readFileSync('/etc/greenreach/server.crt'),
  key: fs.readFileSync('/etc/greenreach/server.key'),
  ca: fs.readFileSync('/etc/greenreach/ca.crt'),
  requestCert: true,
  rejectUnauthorized: true
};

const server = https.createServer(options, (req, res) => {
  // Verify client certificate
  const cert = req.socket.getPeerCertificate();
  
  if (!req.client.authorized) {
    res.writeHead(401);
    res.end('Unauthorized');
    return;
  }
  
  // Extract farm ID from certificate CN
  const farmId = cert.subject.CN;
  
  // Process authenticated request
  res.writeHead(200);
  res.end('Authenticated');
});
```

### Certificate Validation

**Client Validation (Central verifies edge):**
1. Certificate signed by GreenReach CA
2. Certificate not expired
3. Certificate not revoked (CRL check)
4. Farm ID matches certificate CN
5. Certificate chain valid

**Server Validation (Edge verifies central):**
1. Certificate signed by trusted CA
2. Certificate not expired
3. Hostname matches certificate CN
4. Certificate chain valid

## TLS Configuration

### Recommended Settings

**Protocol:**
- TLS 1.3 (required)
- TLS 1.2 (minimum)
- TLS 1.1 and below: DISABLED

**Cipher Suites (TLS 1.3):**
```
TLS_AES_256_GCM_SHA384
TLS_CHACHA20_POLY1305_SHA256
TLS_AES_128_GCM_SHA256
```

**Cipher Suites (TLS 1.2):**
```
ECDHE-RSA-AES256-GCM-SHA384
ECDHE-RSA-AES128-GCM-SHA256
DHE-RSA-AES256-GCM-SHA384
```

**Node.js Configuration:**
```javascript
const tlsOptions = {
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3',
  ciphers: [
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES128-GCM-SHA256'
  ].join(':'),
  honorCipherOrder: true,
  sessionTimeout: 300
};
```

### Testing TLS

**Test TLS Version:**
```bash
openssl s_client -connect api.greenreach.com:443 -tls1_3
```

**Test Cipher Suites:**
```bash
nmap --script ssl-enum-ciphers -p 443 api.greenreach.com
```

**SSL Labs Test:**
```bash
# Check Central API security
https://www.ssllabs.com/ssltest/analyze.html?d=api.greenreach.com
```

## API Authentication

### Bearer Token

All API requests require authentication via Bearer token.

**Header:**
```
Authorization: Bearer {apiKey}
X-Farm-ID: {farmId}
X-API-Secret: {apiSecret}
```

**Example:**
```bash
curl https://api.greenreach.com/api/sync/health \
  -H "Authorization: Bearer a1b2c3d4e5f6..." \
  -H "X-Farm-ID: GR-17350001001" \
  -H "X-API-Secret: z9y8x7w6v5u4..."
```

### API Key Generation

**Format:**
- API Key: 64 hex characters (256 bits)
- API Secret: 64 hex characters (256 bits)
- Generated using `crypto.randomBytes(32).toString('hex')`

**Storage:**
- API Key: Can be logged (used for identification)
- API Secret: NEVER log or expose (treated like password)
- Secret hashed with bcrypt before storage

**Rotation:**
- Recommended: Every 90 days
- Required: Annually
- Immediate: On suspected compromise

## Security Best Practices

### 1. Credential Management

✅ **DO:**
- Store credentials in encrypted credential manager
- Use environment variables for configuration
- Rotate credentials regularly (90 days)
- Limit credential scope and permissions
- Audit credential access
- Use unique credentials per farm
- Enable two-factor authentication where possible

❌ **DON'T:**
- Hard-code credentials in source code
- Commit credentials to version control
- Log sensitive credentials
- Share credentials between farms
- Use default passwords
- Store credentials in plain text

### 2. Certificate Management

✅ **DO:**
- Use strong key sizes (RSA 2048-bit minimum)
- Enable auto-renewal (30 days before expiry)
- Backup certificates before rotation
- Verify certificate integrity regularly
- Monitor certificate expiration
- Use certificate pinning for critical connections

❌ **DON'T:**
- Use self-signed certificates in production
- Ignore certificate expiration warnings
- Reuse private keys across farms
- Expose private keys
- Skip certificate validation

### 3. Network Security

✅ **DO:**
- Use TLS 1.3 for all connections
- Enable mutual TLS (mTLS)
- Implement rate limiting
- Use firewall rules to restrict access
- Enable DDoS protection
- Monitor for suspicious activity
- Use VPN for remote access

❌ **DON'T:**
- Allow unencrypted connections
- Expose admin interfaces publicly
- Use default ports
- Disable certificate validation
- Allow unlimited API requests

### 4. Data Protection

✅ **DO:**
- Encrypt data at rest (AES-256)
- Encrypt data in transit (TLS 1.3)
- Use authenticated encryption (GCM mode)
- Implement data retention policies
- Backup encrypted data
- Secure delete when removing data

❌ **DON'T:**
- Store sensitive data unencrypted
- Log personally identifiable information (PII)
- Keep unnecessary data
- Use weak encryption algorithms
- Share encryption keys

### 5. Access Control

✅ **DO:**
- Implement principle of least privilege
- Use role-based access control (RBAC)
- Require authentication for all APIs
- Audit all access attempts
- Implement session timeouts
- Use strong password policies

❌ **DON'T:**
- Use shared accounts
- Grant excessive permissions
- Allow anonymous access
- Skip authentication checks
- Use weak passwords

## Incident Response

### Security Incident Types

1. **Credential Compromise**
   - Suspected API key/secret exposure
   - Unauthorized access detected
   - Certificate theft

2. **System Compromise**
   - Malware detected
   - Unauthorized system access
   - Data breach

3. **Network Attack**
   - DDoS attack
   - Man-in-the-middle attack
   - Brute force attempts

### Response Procedure

#### 1. Detection
- Monitor security logs
- Set up alerts for anomalies
- Review access patterns
- Check certificate validity

#### 2. Containment
- Revoke compromised credentials immediately
- Block suspicious IP addresses
- Isolate affected systems
- Enable enhanced monitoring

#### 3. Investigation
- Analyze logs for root cause
- Identify scope of compromise
- Document timeline of events
- Preserve evidence

#### 4. Recovery
- Rotate all affected credentials
- Patch vulnerabilities
- Restore from backups if needed
- Update security policies

#### 5. Post-Incident
- Conduct post-mortem analysis
- Update security procedures
- Implement preventive measures
- Train staff on lessons learned

### Emergency Contacts

**GreenReach Security Team:**
- Email: security@greenreach.com
- Phone: 1-800-473-3673 (24/7)
- PGP Key: Available at keybase.io/greenreach

**Report Security Issue:**
```bash
# Email encrypted report
gpg --encrypt --recipient security@greenreach.com \
    --output incident.gpg incident-report.txt

# Or via secure form
https://greenreach.com/security/report
```

## Compliance

### Standards

GreenReach adheres to:
- **SOC 2 Type II**: Security, availability, confidentiality
- **ISO 27001**: Information security management
- **GDPR**: Data protection and privacy
- **CCPA**: California Consumer Privacy Act

### Auditing

**Audit Logs:**
- All API requests logged
- Credential access logged
- Certificate operations logged
- Security events logged

**Log Retention:**
- Security logs: 1 year
- Access logs: 90 days
- Audit logs: 7 years

**Log Format:**
```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "type": "security",
  "event": "credential_accessed",
  "farmId": "GR-17350001001",
  "userId": "admin@farm.com",
  "credentialKey": "api_key",
  "ipAddress": "192.168.1.100",
  "userAgent": "curl/7.68.0",
  "success": true
}
```

## Troubleshooting

### Certificate Issues

**Problem:** Certificate expired
```bash
# Check expiry
openssl x509 -in cert.crt -noout -dates

# Renew certificate
curl -X POST http://localhost:3000/api/certs/renew
```

**Problem:** TLS handshake failed
```bash
# Test connection
openssl s_client -connect api.greenreach.com:443 -showcerts

# Check certificate chain
openssl verify -CAfile ca.crt cert.crt
```

**Problem:** Certificate validation failed
```bash
# Verify certificate
curl -v --cacert ca.crt --cert cert.crt --key key.key \
  https://api.greenreach.com/health
```

### Credential Issues

**Problem:** Cannot decrypt credential
```bash
# Verify master key
ls -la /etc/greenreach/master.key

# Test decryption
curl http://localhost:3000/api/credentials/test_key
```

**Problem:** Permission denied
```bash
# Fix permissions
sudo chown -R greenreach:greenreach /etc/greenreach
sudo chmod 700 /etc/greenreach/credentials
sudo chmod 600 /etc/greenreach/credentials/*
```

### Authentication Issues

**Problem:** 401 Unauthorized
- Verify API key is correct
- Check API secret matches
- Ensure farm ID is valid
- Verify token not expired

**Problem:** 403 Forbidden
- Check API permissions
- Verify rate limits not exceeded
- Ensure IP not blocked
- Check firewall rules

---

**Document Version:** 1.0.0  
**Last Updated:** 2024-01-15  
**Maintained By:** GreenReach Security Team  
**License:** Proprietary - GreenReach Systems, Inc.
