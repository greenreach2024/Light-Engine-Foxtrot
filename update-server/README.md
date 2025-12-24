# Light Engine Update Distribution Server

Serves signed updates with staged rollout capabilities for edge devices and desktop apps.

## Overview

The update server (`updates.greenreach.com`) provides:
- **Version manifests** for stable/beta/alpha channels
- **Binary distribution** for multiple platforms
- **Staged rollouts** (5% → 25% → 100%)
- **Emergency rollback** capability
- **Update statistics** and monitoring

## Directory Structure

```
update-server/
├── server.js              # Express server
├── package.json
├── README.md
├── releases/              # Release binaries
│   ├── stable/
│   │   ├── linux-x64/
│   │   │   ├── manifest.json
│   │   │   └── 1.0.0/
│   │   │       ├── lightengine
│   │   │       ├── lightengine.sha256
│   │   │       └── lightengine.sig
│   │   ├── linux-arm64/
│   │   ├── darwin-x64/
│   │   └── win32-x64/
│   ├── beta/
│   └── alpha/
└── logs/
    ├── access.log
    └── update-checks.log
```

## API Endpoints

### Get Update Manifest

```bash
GET /manifest/:channel/:platform?deviceId=xxx&currentVersion=1.0.0
```

**Channels:** `stable`, `beta`, `alpha`  
**Platforms:** `linux-x64`, `linux-arm64`, `darwin-x64`, `win32-x64`

**Response:**
```json
{
  "version": "1.2.0",
  "releaseDate": "2025-01-15T12:00:00Z",
  "url": "https://updates.greenreach.com/download/stable/linux-x64/1.2.0/lightengine",
  "checksumUrl": "https://updates.greenreach.com/download/stable/linux-x64/1.2.0/lightengine.sha256",
  "signatureUrl": "https://updates.greenreach.com/download/stable/linux-x64/1.2.0/lightengine.sig",
  "size": 95842304,
  "changelog": "Bug fixes and performance improvements",
  "minimumVersion": "1.0.0"
}
```

### Download Binary

```bash
GET /download/:channel/:platform/:version/:filename
```

**Example:**
```bash
curl -O https://updates.greenreach.com/download/stable/linux-x64/1.2.0/lightengine
```

### List All Releases

```bash
GET /releases?channel=stable&platform=linux-x64
```

**Response:**
```json
{
  "ok": true,
  "count": 12,
  "releases": [
    {
      "channel": "stable",
      "platform": "linux-x64",
      "version": "1.2.0",
      "releaseDate": "2025-01-15T12:00:00Z",
      "rollout": {
        "percentage": 100,
        "enabled": true
      }
    }
  ]
}
```

### Configure Staged Rollout

```bash
POST /rollout/:version
Content-Type: application/json

{
  "percentage": 25,
  "enabled": true
}
```

**Rollout Strategy:**
1. **5%** - Initial canary deployment (monitor for 24h)
2. **25%** - Expanded deployment (monitor for 48h)
3. **100%** - Full rollout

### Emergency Rollback

```bash
POST /rollback/:version
```

Immediately disables distribution of a version.

### Update Statistics

```bash
GET /stats
```

**Response:**
```json
{
  "ok": true,
  "checks": 15420,
  "byChannel": {
    "stable": 14200,
    "beta": 1100,
    "alpha": 120
  },
  "byPlatform": {
    "linux-x64": 8500,
    "linux-arm64": 3200,
    "darwin-x64": 2500,
    "win32-x64": 1220
  },
  "byVersion": {
    "1.2.0": 12000,
    "1.1.5": 3200,
    "1.0.8": 220
  }
}
```

## Deployment

### Prerequisites

```bash
# Install dependencies
cd update-server
npm install
```

### Running Locally

```bash
npm start
# or with auto-reload
npm run dev
```

Server runs on port 3001 by default.

### Production Deployment

**Option 1: AWS EC2**
```bash
# SSH to server
ssh ubuntu@updates.greenreach.com

# Clone repo
git clone https://github.com/greenreach/lightengine.git
cd lightengine/update-server

# Install dependencies
npm install

# Install PM2
npm install -g pm2

# Start server
pm2 start server.js --name update-server

# Enable startup
pm2 startup
pm2 save
```

**Option 2: Docker**
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3001
CMD ["node", "server.js"]
```

**Option 3: AWS Lambda + API Gateway**
```bash
# Package for Lambda
npm run build:lambda

# Deploy with SAM
sam deploy --template-file template.yaml
```

### DNS Configuration

```
# Route 53 A Record
updates.greenreach.com → 52.10.45.180
```

### SSL Certificate

```bash
# Install certbot
sudo apt-get install certbot

# Get certificate
sudo certbot certonly --standalone -d updates.greenreach.com

# Auto-renewal
sudo certbot renew --dry-run
```

## Creating a Release

### 1. Build Binaries

```bash
# Build all platforms
npm run build:binaries

# Output: dist/
# - lightengine-linux-x64
# - lightengine-linux-arm64
# - lightengine-darwin-x64
# - lightengine-win32-x64.exe
```

### 2. Generate Checksums

```bash
cd dist
sha256sum lightengine-linux-x64 > lightengine-linux-x64.sha256
sha256sum lightengine-linux-arm64 > lightengine-linux-arm64.sha256
sha256sum lightengine-darwin-x64 > lightengine-darwin-x64.sha256
certutil -hashfile lightengine-win32-x64.exe SHA256 > lightengine-win32-x64.sha256
```

### 3. Sign Binaries

```bash
# Sign with RSA private key
openssl dgst -sha256 -sign greenreach-private.pem \
  -out lightengine-linux-x64.sig lightengine-linux-x64
```

### 4. Create Manifest

```json
{
  "version": "1.2.0",
  "releaseDate": "2025-01-15T12:00:00Z",
  "url": "https://updates.greenreach.com/download/stable/linux-x64/1.2.0/lightengine",
  "checksumUrl": "https://updates.greenreach.com/download/stable/linux-x64/1.2.0/lightengine.sha256",
  "signatureUrl": "https://updates.greenreach.com/download/stable/linux-x64/1.2.0/lightengine.sig",
  "size": 95842304,
  "changelog": "Bug fixes and performance improvements",
  "minimumVersion": "1.0.0"
}
```

### 5. Upload to Server

```bash
# Create release directory
mkdir -p releases/stable/linux-x64/1.2.0

# Copy files
cp dist/lightengine-linux-x64 releases/stable/linux-x64/1.2.0/lightengine
cp dist/lightengine-linux-x64.sha256 releases/stable/linux-x64/1.2.0/
cp dist/lightengine-linux-x64.sig releases/stable/linux-x64/1.2.0/

# Update manifest
cp manifest.json releases/stable/linux-x64/manifest.json
```

### 6. Configure Rollout

```bash
# Start with 5% canary
curl -X POST https://updates.greenreach.com/rollout/1.2.0 \
  -H "Content-Type: application/json" \
  -d '{"percentage": 5, "enabled": true}'

# Monitor for 24 hours, then increase to 25%
curl -X POST https://updates.greenreach.com/rollout/1.2.0 \
  -d '{"percentage": 25, "enabled": true}'

# If stable for 48 hours, full rollout
curl -X POST https://updates.greenreach.com/rollout/1.2.0 \
  -d '{"percentage": 100, "enabled": true}'
```

## Staged Rollout Algorithm

Devices are deterministically assigned to rollout groups based on their device ID hash:

```javascript
function isEligibleForRollout(deviceId, percentage) {
  // Hash device ID to 0-99
  const hash = crypto.createHash('md5').update(deviceId).digest('hex');
  const bucket = parseInt(hash.substring(0, 8), 16) % 100;
  
  // Eligible if bucket < percentage
  return bucket < percentage;
}
```

**Example:**
- Device `abc123` → bucket 42
- At 25% rollout → eligible (42 < 25 = false) ❌
- At 50% rollout → eligible (42 < 50 = true) ✅

This ensures:
- Consistent rollout groups (same devices always in same buckets)
- Gradual expansion (lower buckets get updates first)
- Easy rollback (reduce percentage)

## Emergency Rollback

If a critical bug is discovered:

```bash
# 1. Immediately disable version
curl -X POST https://updates.greenreach.com/rollback/1.2.0

# 2. This sets percentage to 0 and marks as rolled back
# Devices will no longer receive this version

# 3. Monitor update-checks.log to see devices reverting
tail -f logs/update-checks.log

# 4. Prepare hotfix release 1.2.1
# 5. Follow normal staged rollout process
```

## Monitoring

### CloudWatch Metrics (if on AWS)

- Update check requests per minute
- Download success rate
- Rollout percentage by version
- Error rates

### Log Analysis

```bash
# Check update checks
tail -f logs/update-checks.log | jq .

# Access logs
tail -f logs/access.log

# Error rate by version
grep "error" logs/access.log | awk '{print $7}' | sort | uniq -c

# Most active devices
cat logs/update-checks.log | jq -r .deviceId | sort | uniq -c | sort -rn | head -20
```

## Security

### Binary Signing

All binaries MUST be signed with GreenReach private key:

```bash
# Sign
openssl dgst -sha256 -sign greenreach-private.pem \
  -out lightengine.sig lightengine

# Verify
openssl dgst -sha256 -verify greenreach-public.pem \
  -signature lightengine.sig lightengine
```

### Checksum Verification

All downloads are verified with SHA-256:

```bash
# Generate
sha256sum lightengine > lightengine.sha256

# Verify
sha256sum -c lightengine.sha256
```

### HTTPS Only

Update server MUST use HTTPS with valid SSL certificate.

## Troubleshooting

### No Updates Available

```bash
# Check releases directory
ls -la releases/stable/linux-x64/

# Verify manifest exists
cat releases/stable/linux-x64/manifest.json

# Check server logs
tail -f logs/access.log
```

### Update Check Failing

```bash
# Test endpoint manually
curl https://updates.greenreach.com/manifest/stable/linux-x64

# Check device logs
journalctl -u lightengine | grep UpdateAgent

# Verify DNS
dig updates.greenreach.com

# Check SSL
openssl s_client -connect updates.greenreach.com:443
```

### Rollout Not Working

```bash
# Check rollout config
curl https://updates.greenreach.com/releases

# Verify device ID is being sent
# Check update-checks.log for deviceId field

# Test rollout calculation
node -e "
const crypto = require('crypto');
const deviceId = 'YOUR_DEVICE_ID';
const hash = crypto.createHash('md5').update(deviceId).digest('hex');
const bucket = parseInt(hash.substring(0, 8), 16) % 100;
console.log('Bucket:', bucket);
"
```

## Performance

### Caching Strategy

- Manifest files: Cache-Control: max-age=3600 (1 hour)
- Binaries: Cache-Control: max-age=86400 (24 hours)
- Use CloudFront CDN for global distribution

### Bandwidth Optimization

- Compress binaries with Brotli
- Use byte-range requests for resume support
- Delta updates (future enhancement)

## Future Enhancements

- [ ] Delta updates (binary diffs)
- [ ] Torrent distribution for large files
- [ ] Multi-region replication
- [ ] Automatic rollback on error threshold
- [ ] A/B testing support
- [ ] Update scheduling by timezone
- [ ] Bandwidth throttling
- [ ] Enterprise proxy support

## Support

For issues or questions:
- GitHub: https://github.com/greenreach/lightengine/issues
- Email: support@greenreach.com
- Docs: https://docs.greenreach.com/updates
