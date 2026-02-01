# Tailscale VPN Deployment Guide

## Overview
This guide configures Tailscale VPN to enable GreenReach Central (AWS cloud) to communicate with edge devices on private networks (192.168.x.x), solving the farm metadata sync issue.

**Problem**: Central server at AWS cannot reach edge devices with private IPs  
**Solution**: Tailscale mesh VPN - all devices join encrypted network with stable IPs  
**Benefit**: Immediate sync, secure by design, no firewall configuration

---

## Architecture

### Before (Broken)
```
AWS GreenReach Central (3.x.x.x public IP)
  ↓ [NETWORK ERROR]
  ↓ Cannot reach private IP
  ↓
Big Green Farm (192.168.2.222 private IP) ❌
```

### After (With Tailscale)
```
AWS GreenReach Central (100.x.x.x Tailscale IP)
  ↓ [ENCRYPTED TUNNEL]
  ↓ Via Tailscale mesh network
  ↓
Big Green Farm (100.y.y.y Tailscale IP) ✅
```

---

## Prerequisites

- Tailscale account (free tier: 100 devices, 3 users)
- SSH access to Central server (AWS Elastic Beanstalk)
- SSH access to edge device (Big Green Farm)
- Admin access to production database

---

## Step 1: Create Tailscale Account

### 1.1 Sign Up
1. Go to https://login.tailscale.com/start
2. Sign in with Google, Microsoft, or GitHub OAuth
3. Choose account type:
   - **Personal**: Free, 100 devices, 3 users (recommended for MVP)
   - **Business**: $5/user/month, unlimited devices

### 1.2 Generate Auth Keys
1. Go to **Settings → Keys** in Tailscale admin
2. Click **Generate auth key**
3. Configure:
   - **Reusable**: Yes (needed for multiple devices)
   - **Ephemeral**: No (devices should persist)
   - **Pre-approved**: Yes (auto-approve devices)
   - **Tags**: Add `tag:greenreach-central`, `tag:edge-device`
4. Copy the auth key: `tskey-auth-xxxxxxxxxxxx-yyyyyyyyyyyyyyyyyy`
5. Save securely (you'll need it for both Central and edge devices)

### 1.3 Configure ACLs (Access Control)
1. Go to **Settings → Access Controls** in Tailscale admin
2. Add this policy:

```json
{
  "tagOwners": {
    "tag:greenreach-central": ["autogroup:admin"],
    "tag:edge-device": ["autogroup:admin"]
  },
  "acls": [
    {
      "action": "accept",
      "src": ["tag:greenreach-central"],
      "dst": ["tag:edge-device:8091"]
    },
    {
      "action": "accept",
      "src": ["tag:edge-device"],
      "dst": ["tag:greenreach-central:3100", "tag:greenreach-central:5432"]
    }
  ]
}
```

3. Click **Save**

**What this does**: 
- Central can access edge devices on port 8091 (API)
- Edge devices can access Central on ports 3100 (API) and 5432 (PostgreSQL for sync)

---

## Step 2: Install Tailscale on GreenReach Central (AWS)

### 2.1 Create Elastic Beanstalk Extension

Create `.ebextensions/01_tailscale.config`:

```yaml
# .ebextensions/01_tailscale.config
# Install and configure Tailscale on AWS Elastic Beanstalk

commands:
  01_install_tailscale:
    command: |
      # Check if already installed
      if ! command -v tailscale &> /dev/null; then
        echo "Installing Tailscale..."
        curl -fsSL https://tailscale.com/install.sh | sh
      else
        echo "Tailscale already installed"
      fi
    test: "! command -v tailscale"

  02_start_tailscale:
    command: |
      # Get auth key from environment variable
      TAILSCALE_KEY="${TAILSCALE_AUTH_KEY}"
      
      if [ -z "$TAILSCALE_KEY" ]; then
        echo "ERROR: TAILSCALE_AUTH_KEY environment variable not set"
        exit 1
      fi
      
      # Bring up Tailscale with auth key
      tailscale up --authkey="$TAILSCALE_KEY" \
                   --hostname="greenreach-central" \
                   --advertise-tags="tag:greenreach-central" \
                   --accept-routes
      
      echo "Tailscale started successfully"
    test: "[ ! -z \"$TAILSCALE_AUTH_KEY\" ]"
```

### 2.2 Set Environment Variable

```bash
cd ~/Light-Engine-Foxtrot/greenreach-central

# Set auth key in Elastic Beanstalk environment
eb setenv TAILSCALE_AUTH_KEY="tskey-auth-xxxxxxxxxxxx-yyyyyyyyyyyyyyyyyy"
```

### 2.3 Deploy with Tailscale

```bash
# Commit ebextensions file
git add .ebextensions/01_tailscale.config
git commit -m "Add Tailscale VPN for edge device connectivity"

# Deploy to production
eb deploy --message "Install Tailscale for farm metadata sync"
```

### 2.4 Verify Central Installation

```bash
# SSH to Central server
eb ssh

# Check Tailscale status
sudo tailscale status

# Expected output:
# 100.x.x.x   greenreach-central   [email]         linux   -
# 100.y.y.y   big-green-farm       [email]         linux   -

# Get Central's Tailscale IP
sudo tailscale ip -4
# Example: 100.64.0.1

# Exit SSH
exit
```

---

## Step 3: Install Tailscale on Big Green Farm Edge Device

### 3.1 SSH to Edge Device

```bash
# Replace with your edge device IP/hostname
ssh greenreach@192.168.2.222
# Or: ssh greenreach@100.65.187.59 (if already on Tailscale)
```

### 3.2 Install Tailscale

```bash
# Download and run Tailscale installer
curl -fsSL https://tailscale.com/install.sh | sh

# Start Tailscale with auth key
sudo tailscale up --authkey="tskey-auth-xxxxxxxxxxxx-yyyyyyyyyyyyyyyyyy" \
                  --hostname="big-green-farm" \
                  --advertise-tags="tag:edge-device" \
                  --accept-routes
```

### 3.3 Verify Edge Installation

```bash
# Check Tailscale status
sudo tailscale status

# Expected output:
# 100.y.y.y   big-green-farm       [email]         linux   -
# 100.x.x.x   greenreach-central   [email]         linux   -

# Get edge device's Tailscale IP
sudo tailscale ip -4
# Example: 100.64.0.2

# Test connectivity to Central
ping -c 3 100.64.0.1

# Test Central API from edge
curl http://100.64.0.1:3100/health
```

---

## Step 4: Update Production Database

### 4.1 Get Tailscale IP from Edge Device

From edge device terminal:
```bash
sudo tailscale ip -4
# Copy this IP, e.g., 100.64.0.2
```

### 4.2 Update farm api_url in Database

From your local machine:
```bash
cd ~/Light-Engine-Foxtrot/greenreach-central

# Update Big Green Farm with Tailscale IP
PGPASSWORD='LePphcacxDs35ciLLhnkhaXr7' psql \
  -h light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com \
  -U lightengine \
  -d lightengine \
  -c "UPDATE farms SET api_url = 'http://100.64.0.2:8091' WHERE farm_id = 'FARM-MKLOMAT3-A9D8';"

# Verify update
PGPASSWORD='LePphcacxDs35ciLLhnkhaXr7' psql \
  -h light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com \
  -U lightengine \
  -d lightengine \
  -c "SELECT farm_id, name, api_url FROM farms WHERE farm_id = 'FARM-MKLOMAT3-A9D8';" -x
```

---

## Step 5: Test Farm Metadata Sync

### 5.1 Test from Central to Edge

From Central server (via eb ssh or locally):
```bash
# Get Central's Tailscale IP
CENTRAL_IP=$(tailscale ip -4)
echo "Central IP: $CENTRAL_IP"

# Get Edge Tailscale IP from database
EDGE_IP="100.64.0.2"  # From Step 4.1

# Test edge device reachability
curl http://$EDGE_IP:8091/health

# Test metadata update (requires valid SYNC_API_KEY)
curl -X PATCH http://$EDGE_IP:8091/api/config/farm-metadata \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${SYNC_API_KEY:-default-sync-key}" \
  -d '{
    "contact": {
      "owner": "Test Owner",
      "name": "Test Contact",
      "phone": "+1 (555) 000-0000",
      "email": "test@example.com"
    }
  }'

# Expected response:
# {"success":true,"message":"Farm metadata updated successfully"}
```

### 5.2 Test from Production UI

1. Login to https://greenreachgreens.com/GR-central-admin-login.html
2. Navigate to **Farm Management**
3. Click **Big Green Farm** (FARM-MKLOMAT3-A9D8)
4. In Farm Summary card, click **Edit Info**
5. Update any field (e.g., Phone: `+1 (709) 398-3166`)
6. Click **Save & Sync**
7. Expected notification: **"✓ Changes saved and synced to farm device"**
8. SSH to edge device and verify:
   ```bash
   cat ~/farm.json | jq '.metadata.contact'
   ```

---

## Step 6: Configure Persistence (Edge Device)

### 6.1 Enable Tailscale on Boot

```bash
# On edge device
sudo systemctl enable tailscaled
sudo systemctl start tailscaled

# Verify service status
sudo systemctl status tailscaled
```

### 6.2 Set Environment Variable for SYNC_API_KEY

```bash
# On edge device - add to edge device environment
echo 'export SYNC_API_KEY="your-secure-api-key-here"' >> ~/.bashrc
source ~/.bashrc

# Or add to systemd service file if using PM2/systemd
# /etc/systemd/system/light-engine.service
```

### 6.3 Restart Edge Device Application

```bash
# If using PM2
pm2 restart server-foxtrot

# If using systemd
sudo systemctl restart light-engine

# If running manually
cd ~/Light-Engine-Foxtrot
lsof -ti tcp:8091 | xargs kill
PORT=8091 EDGE_MODE=true node server-foxtrot.js > /tmp/foxtrot.log 2>&1 &
```

---

## Troubleshooting

### Issue: Tailscale not connecting

**Symptoms**: `tailscale status` shows "not logged in" or no peers

**Solution**:
```bash
# Re-authenticate
sudo tailscale up --authkey="tskey-auth-xxxx"

# Check logs
sudo journalctl -u tailscaled -f
```

### Issue: Central can't reach edge device

**Symptoms**: `curl http://100.x.x.x:8091/health` times out

**Checklist**:
1. Verify edge Tailscale is running: `sudo tailscale status`
2. Verify edge device API is running: `lsof -ti tcp:8091`
3. Check ACL allows Central → Edge:8091 in Tailscale admin
4. Verify firewall on edge device allows Tailscale: `sudo ufw status`
5. Test from edge device: `curl http://localhost:8091/health`

### Issue: "Invalid API key" when syncing

**Symptoms**: Edge device returns 401 Unauthorized

**Solution**:
```bash
# On Central - check environment variable
eb printenv | grep SYNC_API_KEY

# On Edge - check environment variable
echo $SYNC_API_KEY

# Set matching keys on both sides
# Central:
eb setenv SYNC_API_KEY="your-secure-key"

# Edge:
export SYNC_API_KEY="your-secure-key"
```

### Issue: Database api_url still shows old IP

**Symptoms**: Sync says "unreachable" but Tailscale works

**Solution**:
```bash
# Verify database has Tailscale IP
PGPASSWORD='xxx' psql -h light-engine-db... -c \
  "SELECT farm_id, api_url FROM farms WHERE farm_id = 'FARM-MKLOMAT3-A9D8';"

# If wrong, update:
PGPASSWORD='xxx' psql -h light-engine-db... -c \
  "UPDATE farms SET api_url = 'http://100.64.0.2:8091' WHERE farm_id = 'FARM-MKLOMAT3-A9D8';"
```

---

## Security Considerations

### 1. API Key Rotation
**Current**: Using `default-sync-key` (insecure)

**Action Required**:
```bash
# Generate secure key
openssl rand -base64 32

# Set on Central
cd ~/Light-Engine-Foxtrot/greenreach-central
eb setenv SYNC_API_KEY="[generated-key]"

# Set on Edge
ssh greenreach@100.64.0.2
export SYNC_API_KEY="[generated-key]"
echo 'export SYNC_API_KEY="[generated-key]"' >> ~/.bashrc
```

### 2. Tailscale Key Expiry
**Auth keys expire** after period set during generation (default 90 days)

**Solution**: Use reusable key for infrastructure, monitor expiry in Tailscale admin

### 3. Network Segmentation
Tailscale ACLs enforce zero-trust:
- Central can ONLY access Edge:8091 (not SSH, not other ports)
- Edge can ONLY access Central:3100, Central:5432 (not other AWS services)

### 4. Audit Logging
Enable Tailscale audit logs:
- Go to **Settings → Logs** in Tailscale admin
- Connect to SIEM or log aggregator
- Monitor: Connection attempts, ACL denials, key usage

---

## Cost Analysis

### Tailscale Free Tier
- **Devices**: 100 maximum (3 currently: Central + Big Green Farm + Demo Farm)
- **Users**: 3 administrators
- **Features**: Full mesh network, MagicDNS, ACLs, audit logs
- **Cost**: $0/month

### Scaling Costs
- **10 farms**: Free tier ($0/month)
- **100 farms**: Free tier + Business ($5/user/month = $15/month)
- **1000 farms**: Business + Enterprise (contact sales)

### Alternative Comparison
- **ngrok tunnels**: $8-20/farm/month = $240/month for 12 farms
- **VPN server (AWS)**: $10/month + complexity
- **Public IPs**: $3.65/month/IP + security risk

**Verdict**: Tailscale is most cost-effective and secure solution

---

## Rollback Plan

If Tailscale causes issues:

### 1. Immediate Rollback (keep Central working)
```bash
# Stop Tailscale on Central
eb ssh
sudo tailscale down
exit

# System continues working, sync just fails (shows warning to users)
```

### 2. Full Rollback (remove Tailscale)
```bash
# Remove ebextensions config
git rm .ebextensions/01_tailscale.config
git commit -m "Remove Tailscale (rollback)"
eb deploy

# Reset database to original IP (won't work, but restores state)
PGPASSWORD='xxx' psql -h light-engine-db... -c \
  "UPDATE farms SET api_url = 'http://192.168.2.222:8091' WHERE farm_id = 'FARM-MKLOMAT3-A9D8';"
```

### 3. Edge Device Cleanup
```bash
ssh greenreach@192.168.2.222
sudo tailscale down
sudo apt remove tailscale  # or: sudo yum remove tailscale
```

---

## Next Steps After Deployment

1. **Add More Farms**: Repeat Step 3 for each new edge device
2. **Set Up Monitoring**: Monitor Tailscale connectivity in farm dashboard
3. **Document IPs**: Maintain spreadsheet of farm_id → Tailscale IP mapping
4. **Automate**: Consider auto-updating api_url during edge device registration
5. **Scale ACLs**: Add per-farm tags as fleet grows: `tag:farm-001`, `tag:farm-002`

---

## Support Resources

- **Tailscale Documentation**: https://tailscale.com/kb/
- **Tailscale Status Page**: https://status.tailscale.com/
- **Support**: support@tailscale.com (free tier: community forum)
- **Emergency Contact**: [Your phone] for production issues

---

**Deployment Checklist**:
- [ ] Created Tailscale account
- [ ] Generated reusable auth key
- [ ] Configured ACLs
- [ ] Installed Tailscale on Central (via ebextensions)
- [ ] Installed Tailscale on Big Green Farm
- [ ] Updated production database api_url
- [ ] Tested sync from production UI
- [ ] Verified farm.json updated on edge
- [ ] Rotated SYNC_API_KEY from default
- [ ] Documented Tailscale IPs
- [ ] Enabled Tailscale on boot (edge device)

**Status**: Ready for production deployment  
**Estimated Time**: 2-3 hours  
**Risk**: Low (rollback available, no code changes)
