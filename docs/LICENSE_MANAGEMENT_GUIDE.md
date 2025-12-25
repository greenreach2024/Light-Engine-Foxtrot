# License Management Guide

Complete guide for managing Light Engine licenses, activations, and tier upgrades.

## Table of Contents

1. [Overview](#overview)
2. [License Tiers](#license-tiers)
3. [License Generation](#license-generation)
4. [Activation](#activation)
5. [License Validation](#license-validation)
6. [Transfers & Renewals](#transfers--renewals)
7. [Tier Upgrades](#tier-upgrades)
8. [Grace Periods](#grace-periods)
9. [Troubleshooting](#troubleshooting)

## Overview

Light Engine uses a flexible licensing system that supports multiple deployment modes and business models.

**License System Features:**
- **Tiered Licensing**: Three tiers (inventory-only, full, enterprise)
- **Hardware Binding**: Optional binding to specific devices
- **Offline Activation**: Support for air-gapped environments
- **Grace Periods**: 14-day grace period for expired licenses
- **Transfers**: Transfer licenses between devices
- **Upgrades**: Seamless tier upgrades with prorated pricing

## License Tiers

### Inventory-Only Tier

**Price**: $29/month or $299/year

**Features**:
- ✅ Inventory management
- ✅ Wholesale marketplace (buying & selling)
- ✅ Basic analytics
- ✅ Cloud or desktop deployment
- ✅ Mobile PWA access
- ❌ Automation hardware support
- ❌ Environmental control
- ❌ Advanced analytics
- ❌ API access

**Use Cases**:
- Retail farm stores
- Wholesale-only operations
- Inventory tracking before hardware investment

### Full Tier

**Price**: $79/month or $799/year

**Features**:
- ✅ Everything in Inventory-Only
- ✅ Automation hardware support (grow lights, fans, pumps)
- ✅ Environmental control (VPD, DLI optimization)
- ✅ Advanced analytics (growth tracking, energy forecasting)
- ✅ Edge deployment (Raspberry Pi, Linux)
- ✅ Real-time sensor monitoring
- ✅ Automated recipes
- ❌ API access
- ❌ Priority support

**Use Cases**:
- Small to medium farms (< 1000 sq ft)
- Indoor vertical farms
- Greenhouse operations

### Enterprise Tier

**Price**: $299/month or $2,999/year

**Features**:
- ✅ Everything in Full
- ✅ API access for integrations
- ✅ Priority support (4-hour SLA)
- ✅ Custom integrations
- ✅ Multi-site management
- ✅ White-label options
- ✅ Dedicated account manager
- ✅ Training and onboarding

**Use Cases**:
- Large commercial operations (> 1000 sq ft)
- Multi-site operations
- OEM partners
- System integrators

## License Generation

### Generate License (Admin)

**Via GreenReach Central:**

1. Login to https://central.greenreach.io
2. Navigate to Licenses → Generate New
3. Fill in details:
   - Farm name
   - Contact email
   - Tier (inventory-only, full, enterprise)
   - Duration (monthly, annual)
   - Hardware binding (optional)
   - Expiration date
4. Click "Generate License"
5. Copy activation code (format: XXXX-XXXX-XXXX-XXXX)
6. Send to customer

**Via API:**

```bash
curl -X POST https://central.greenreach.io/api/licenses \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "farmName": "Green Valley Farm",
    "email": "admin@greenvalley.com",
    "tier": "full",
    "billingCycle": "annual",
    "expiresAt": "2026-12-25T00:00:00Z",
    "hardwareBinding": true,
    "maxDevices": 1
  }'
```

Response:
```json
{
  "licenseId": "lic_abc123",
  "activationCode": "GV4F-8K2L-9M3N-7P5Q",
  "tier": "full",
  "expiresAt": "2026-12-25T00:00:00Z",
  "activationsRemaining": 1,
  "createdAt": "2025-12-25T10:00:00Z"
}
```

### Bulk License Generation

**CSV Import:**

```csv
farmName,email,tier,billingCycle,expiresAt
Green Valley Farm,admin@greenvalley.com,full,annual,2026-12-25
Boulder Bistro,chef@bistro.com,inventory-only,monthly,2026-01-25
Mountain Greens,ops@mountaingreens.com,enterprise,annual,2026-12-25
```

```bash
curl -X POST https://central.greenreach.io/api/licenses/bulk-import \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "file=@licenses.csv"
```

## Activation

### Online Activation

**Web Wizard (Recommended):**

1. Open Light Engine application
2. If unlicensed, setup wizard appears automatically
3. Enter activation code: XXXX-XXXX-XXXX-XXXX
4. Click "Activate"
5. Wizard validates code with licensing server
6. License activated, features unlocked

**API Activation:**

```bash
curl -X POST https://my-farm.greenreach.io/api/license/activate \
  -H "Content-Type: application/json" \
  -d '{
    "activationCode": "GV4F-8K2L-9M3N-7P5Q",
    "deviceId": "rpi-12345",
    "deviceInfo": {
      "platform": "linux",
      "arch": "arm64",
      "hostname": "raspberrypi",
      "cpuSerial": "100000001234abcd"
    }
  }'
```

### Offline Activation

For air-gapped environments:

**Step 1: Generate Activation Request**

```bash
# On offline device
curl -X POST http://localhost:3000/api/license/offline-activation-request \
  -H "Content-Type: application/json" \
  -d '{
    "activationCode": "GV4F-8K2L-9M3N-7P5Q"
  }' > activation-request.json
```

**Step 2: Submit Request to Licensing Server**

```bash
# On online device
curl -X POST https://central.greenreach.io/api/licenses/offline-activation \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "request=@activation-request.json" > activation-response.json
```

**Step 3: Apply Response to Offline Device**

```bash
# Copy activation-response.json to offline device
curl -X POST http://localhost:3000/api/license/apply-offline-activation \
  -H "Content-Type: application/json" \
  -d @activation-response.json
```

### Hardware Binding

**Automatic Binding:**

When `hardwareBinding: true`, license is automatically bound to device hardware on first activation.

**Binding Details:**
- CPU serial number
- MAC addresses
- Storage device serial
- Motherboard serial (if available)

**Hardware Fingerprint:**

```javascript
function generateHardwareFingerprint() {
  const crypto = require('crypto');
  const os = require('os');
  
  const components = [
    getCpuSerial(),
    getMacAddresses(),
    getStorageSerial(),
    getMotherboardSerial()
  ].filter(Boolean);
  
  return crypto.createHash('sha256')
    .update(components.join('-'))
    .digest('hex');
}
```

## License Validation

### Runtime Validation

**Periodic Checks:**

```javascript
// Check license every 6 hours
setInterval(async () => {
  const isValid = await validateLicense();
  
  if (!isValid) {
    // Enter grace period or disable features
    handleInvalidLicense();
  }
}, 6 * 60 * 60 * 1000);
```

**Validation Logic:**

```javascript
async function validateLicense() {
  const license = await db.query('SELECT * FROM licenses WHERE id = 1');
  
  // Check expiration
  if (new Date(license.expiresAt) < new Date()) {
    const gracePeriod = 14 * 24 * 60 * 60 * 1000; // 14 days
    const gracePeriodEnd = new Date(license.expiresAt).getTime() + gracePeriod;
    
    if (Date.now() > gracePeriodEnd) {
      return false; // Expired, grace period over
    }
    
    showExpirationWarning(gracePeriodEnd);
  }
  
  // Check hardware binding
  if (license.hardwareBinding) {
    const currentFingerprint = generateHardwareFingerprint();
    if (currentFingerprint !== license.hardwareFingerprint) {
      return false; // Hardware mismatch
    }
  }
  
  // Online validation (every 7 days)
  if (Date.now() - license.lastValidated > 7 * 24 * 60 * 60 * 1000) {
    const isValidOnline = await validateLicenseOnline(license.licenseId);
    if (!isValidOnline) {
      return false;
    }
    
    await db.query('UPDATE licenses SET last_validated = NOW() WHERE id = 1');
  }
  
  return true;
}
```

**Online Validation:**

```bash
curl https://central.greenreach.io/api/licenses/lic_abc123/validate \
  -H "Authorization: Bearer $LICENSE_TOKEN"
```

Response:
```json
{
  "valid": true,
  "tier": "full",
  "expiresAt": "2026-12-25T00:00:00Z",
  "features": {
    "inventory": true,
    "wholesale": true,
    "automation": true,
    "api": false
  }
}
```

### Feature Gating

**Check Feature Access:**

```javascript
function hasFeature(feature) {
  const license = getLicense();
  
  const tierFeatures = {
    'inventory-only': ['inventory', 'wholesale', 'analytics-basic', 'pwa'],
    'full': ['inventory', 'wholesale', 'analytics-basic', 'analytics-advanced', 
             'automation', 'sensors', 'edge', 'pwa'],
    'enterprise': ['*'] // All features
  };
  
  const allowedFeatures = tierFeatures[license.tier] || [];
  return allowedFeatures.includes('*') || allowedFeatures.includes(feature);
}

// Usage
app.get('/api/automation/recipes', (req, res) => {
  if (!hasFeature('automation')) {
    return res.status(403).json({
      error: 'Automation features require Full or Enterprise tier',
      upgradeUrl: 'https://my-farm.greenreach.io/upgrade'
    });
  }
  
  // Return automation recipes
});
```

## Transfers & Renewals

### Transfer License to New Device

**Step 1: Deactivate on Old Device**

```bash
curl -X POST https://my-farm.greenreach.io/api/license/deactivate \
  -H "Authorization: Bearer $TOKEN"
```

Or via GreenReach Central (admin can force deactivation):

```bash
curl -X POST https://central.greenreach.io/api/licenses/lic_abc123/deactivate \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"reason": "Hardware replacement"}'
```

**Step 2: Activate on New Device**

Use same activation code on new device (see [Activation](#activation) section).

### Renewal

**Automatic Renewal (Subscription):**

For monthly/annual subscriptions with payment method on file:
- License automatically renews 7 days before expiration
- Email notification sent 14 days before renewal
- Charge appears on statement as "GreenReach Light Engine"

**Manual Renewal:**

1. Login to https://my-farm.greenreach.io
2. Navigate to Settings → License
3. Click "Renew License"
4. Choose duration (monthly, annual)
5. Enter payment information
6. Confirm renewal

**API Renewal:**

```bash
curl -X POST https://central.greenreach.io/api/licenses/lic_abc123/renew \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "duration": "annual",
    "paymentMethodId": "pm_card_123"
  }'
```

## Tier Upgrades

### Upgrade from Inventory-Only to Full

**Prorated Pricing:**

If upgrading mid-cycle, only pay the difference prorated to remaining time.

**Example:**
- Purchased Inventory-Only annual: $299 (Jan 1)
- Upgrade to Full on July 1 (6 months remaining)
- Full annual: $799
- Difference: $799 - $299 = $500
- Prorated: $500 × (6/12) = $250

**Via Web:**

1. Dashboard → Settings → License → Upgrade
2. Select target tier (Full or Enterprise)
3. Review prorated pricing
4. Enter payment information
5. Confirm upgrade
6. Features unlocked immediately

**Via API:**

```bash
curl -X POST https://my-farm.greenreach.io/api/license/upgrade \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "targetTier": "full",
    "paymentMethodId": "pm_card_123"
  }'
```

Response:
```json
{
  "success": true,
  "oldTier": "inventory-only",
  "newTier": "full",
  "proratedCharge": 250.00,
  "newExpiresAt": "2026-01-01T00:00:00Z",
  "unlockedFeatures": ["automation", "sensors", "analytics-advanced"]
}
```

### Downgrade

**Important**: Downgrades take effect at next billing cycle, not immediately.

1. Dashboard → Settings → License → Change Tier
2. Select lower tier
3. Confirm downgrade
4. Current tier remains active until expiration
5. New tier activates on next renewal

**Feature Data Retention:**

When downgrading:
- Automation recipes: Preserved but disabled (can re-enable if upgrade again)
- Sensor data: Preserved but not accessible via UI (available via API if re-upgrade)
- Advanced analytics: Historical data preserved, new data not collected

## Grace Periods

### Expiration Grace Period

**14-Day Grace Period:**

After license expires:
- Days 1-7: Full functionality with expiration warning banner
- Days 8-14: Read-only mode (no writes, no automation)
- Day 15+: Application disabled, renewal required

**Warning Notifications:**

- 30 days before expiration: Email reminder
- 14 days before: Email + in-app banner
- 7 days before: Email + persistent in-app notification
- Day of expiration: Email + SMS (if configured)
- Every day in grace period: Email + SMS

**Renewal During Grace Period:**

License can be renewed during grace period with no data loss or downtime.

### Payment Failure Grace Period

**Failed Payment Handling:**

1. **Day 0**: Payment fails, retry automatically
2. **Day 1**: Second retry attempt, email notification
3. **Day 3**: Third retry attempt, update payment method warning
4. **Day 7**: License suspended, enter grace period
5. **Day 14**: Account disabled if payment not updated

**Update Payment Method:**

```bash
curl -X POST https://my-farm.greenreach.io/api/billing/payment-method \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "paymentMethodId": "pm_card_456"
  }'
```

## Troubleshooting

### Activation Code Invalid

**Possible Causes:**
1. Code entered incorrectly (check for O vs 0, l vs 1)
2. Code already activated (check max activations)
3. Code expired (activation codes expire after 7 days)
4. Network connectivity issues

**Solutions:**

```bash
# Check license status
curl https://central.greenreach.io/api/licenses/lookup \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"activationCode": "GV4F-8K2L-9M3N-7P5Q"}'

# Response shows status
{
  "valid": true,
  "activated": false,
  "activationsRemaining": 1,
  "expiresAt": "2026-12-25T00:00:00Z"
}
```

If code is invalid:
- Request new activation code from administrator
- Administrator can generate replacement code in GreenReach Central

### Hardware Mismatch Error

**Error Message:**
```
License validation failed: Hardware fingerprint mismatch
This license is bound to different hardware
```

**Cause**: License is hardware-bound and device has changed (CPU, storage, etc.)

**Solutions:**

**Option 1: Transfer License (Legitimate Hardware Change)**

Contact administrator to transfer license:

```bash
# Admin deactivates old hardware
curl -X POST https://central.greenreach.io/api/licenses/lic_abc123/transfer \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "oldHardwareFingerprint": "abc123...",
    "reason": "Raspberry Pi hardware upgrade"
  }'

# Reactivate on new hardware with same code
```

**Option 2: Disable Hardware Binding**

If hardware changes frequently (cloud deployments):

```bash
curl -X PUT https://central.greenreach.io/api/licenses/lic_abc123 \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"hardwareBinding": false}'
```

### License Expired but Grace Period Not Working

**Check Grace Period Status:**

```bash
curl http://localhost:3000/api/license/status
```

Response:
```json
{
  "tier": "full",
  "expired": true,
  "expiresAt": "2025-12-01T00:00:00Z",
  "gracePeriodActive": true,
  "gracePeriodEndsAt": "2025-12-15T00:00:00Z",
  "daysRemaining": 7,
  "status": "grace_period"
}
```

If grace period not active:
- License may have been revoked (contact support)
- System date/time may be incorrect (check with `date`)
- License validation service may be down (check connectivity)

### Features Not Unlocking After Upgrade

**Possible Causes:**
1. Application hasn't refreshed license
2. Cache issue
3. License server sync delay

**Solutions:**

```bash
# Force license refresh
curl -X POST http://localhost:3000/api/license/refresh \
  -H "Authorization: Bearer $TOKEN"

# Restart application
sudo systemctl restart light-engine

# Clear browser cache and reload
# Chrome: Cmd/Ctrl + Shift + R
```

### Offline Validation Failing

**Check Last Validation:**

```bash
curl http://localhost:3000/api/license/status
```

Response:
```json
{
  "lastValidated": "2025-12-18T10:00:00Z",
  "validationRequired": false,
  "offlineGracePeriod": 30,
  "daysUntilValidationRequired": 23
}
```

Light Engine requires online validation every 30 days. If validation is overdue:

1. **Connect to Internet**: Temporarily connect device to internet
2. **Manual Validation**: Trigger validation manually
   ```bash
   curl -X POST http://localhost:3000/api/license/validate \
     -H "Authorization: Bearer $TOKEN"
   ```
3. **Offline Activation**: If internet not available, use offline activation process

## Support

- **License Issues**: licenses@greenreach.io
- **Billing Questions**: billing@greenreach.io
- **Technical Support**: support@greenreach.io
- **GreenReach Central**: https://central.greenreach.io
- **License Portal**: https://my-farm.greenreach.io/license

## Next Steps

- [Edge Deployment Guide](EDGE_DEPLOYMENT_GUIDE.md)
- [Cloud Deployment Guide](CLOUD_DEPLOYMENT_GUIDE.md)
- [Desktop App Guide](DESKTOP_APP_GUIDE.md)
- [Wholesale Integration](WHOLESALE_INTEGRATION_GUIDE.md)
- [Security Hardening](SECURITY_HARDENING_GUIDE.md)
