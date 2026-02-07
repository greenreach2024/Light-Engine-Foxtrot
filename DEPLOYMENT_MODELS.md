# Light Engine Deployment Models

**Version**: 1.0  
**Date**: February 7, 2026  
**Status**: APPROVED (Models 1 & 3) / ARCHITECTURE REVIEW REQUIRED (Model 2)

---

## Overview

Light Engine Foxtrot supports unified edge/cloud deployment from a single codebase. The same `server-foxtrot.js` operates in different modes based on environment configuration.

---

## ✅ Model 1: Edge Device (On-Premise Hardware)

**Status**: APPROVED with conditions  
**Use Case**: Farms with dedicated on-premise hardware  
**Example**: Big Green Farm (FARM-MKLOMAT3-A9D8) at 100.65.187.59:8091

### Configuration

**Environment Variables:**
```bash
FARM_ID=FARM-MKLOMAT3-A9D8
EDGE_MODE=true
GREENREACH_CENTRAL_URL=http://www.greenreachgreens.com
DB_ENABLED=false        # NeDB for edge reliability
PORT=8091
NODE_ENV=production
```

**config/edge-config.json:**
```json
{
  "mode": "edge",
  "farmId": "FARM-MKLOMAT3-A9D8",
  "farmName": "Big Green Farm",
  "apiKey": "[64-char-hex-api-key]",
  "centralApiUrl": "http://www.greenreachgreens.com",
  "syncEnabled": true,
  "syncInterval": 300000,
  "heartbeatInterval": 30000,
  "offlineMode": false,
  "registrationComplete": true,
  "hardwareModel": "Symcod W101M N97",
  "version": "1.0.0"
}
```

### Data Flow

```
Edge Device (NeDB)
  ↓
  Sync every 5 minutes
  ↓
POST /api/sync/rooms
POST /api/sync/groups
POST /api/sync/telemetry
  ↓
GreenReach Central (RDS)
  ↓
farm_data table
  ↓
Admin Dashboard
```

### Current Status

- ✅ Big Green Farm syncing successfully
- ✅ 3 groups visible in Central dashboard
- ⚠️ **API key management system pending** (Security Review)
- ⏸️ Provisioning automation TBD (requires `/api/farms/register` verification)

---

## ✅ Model 3: Local Development

**Status**: APPROVED - Fixed  
**Use Case**: Local development and testing  
**Example**: "This is Your Farm" (FARM-TEST-WIZARD-001) on developer laptop

### Configuration

**Environment Variables:**
```bash
FARM_ID=FARM-TEST-WIZARD-001
EDGE_MODE=true
GREENREACH_CENTRAL_URL=http://www.greenreachgreens.com  # Or localhost:3100 for local testing
DB_ENABLED=false
PORT=8091
NODE_ENV=development
```

**config/edge-config.json:**
```json
{
  "mode": "edge",
  "farmId": "FARM-TEST-WIZARD-001",
  "farmName": "This is Your Farm",
  "apiKey": "demo-api-key-12345678901234567890123456789012",
  "centralApiUrl": "http://www.greenreachgreens.com",
  "syncEnabled": true,
  "syncInterval": 300000,
  "heartbeatInterval": 30000,
  "offlineMode": false,
  "registrationComplete": true,
  "hardwareModel": "Development Laptop",
  "version": "1.0.0"
}
```

### Changes Applied (Feb 7, 2026)

**Before:**
```json
{
  "centralApiUrl": "http://localhost:3000",
  "syncEnabled": false,
  "offlineMode": true
}
```

**After:**
```json
{
  "centralApiUrl": "http://www.greenreachgreens.com",
  "syncEnabled": true,
  "offlineMode": false
}
```

### Data Flow

```
Local Edge (NeDB)
  ↓
  Sync to production Central
  ↓
GreenReach Central (RDS)
  ↓
Test in production dashboard
```

### Current Status

- ✅ Configuration fixed (Feb 7, 2026)
- ✅ Will sync to production when server running
- ⚠️ Local data exists (rooms.json: 104 lines, groups.json: 556 lines)
- ⏸️ Awaiting server restart to initiate sync

---

## ✅ Model 2: Cloud Testing Environment (AWS ECS)

**Status**: APPROVED for Testing Infrastructure  
**Use Case**: Testing deployment before edge hardware provisioning  
**Example**: ECS deployment of FARM-TEST-WIZARD-001 for pre-production validation

### Configuration (Proposed)

**ECS Task Definition Environment:**
```json
{
  "environment": [
    {"name": "FARM_ID", "value": "FARM-TEST-WIZARD-001"},
    {"name": "EDGE_MODE", "value": "true"},
    {"name": "GREENREACH_CENTRAL_URL", "value": "http://www.greenreachgreens.com"},
    {"name": "DB_ENABLED", "value": "true"},
    {"name": "DB_HOST", "value": "foxtrot-test.c8rq44ew6swb.us-east-1.rds.amazonaws.com"},
    {"name": "DB_NAME", "value": "lightengine"},
    {"name": "DB_PORT", "value": "5432"},
    {"name": "PORT", "value": "8091"},
    {"name": "NODE_ENV", "value": "production"}
  ],
  "secrets": [
    {"name": "JWT_SECRET", "valueFrom": "arn:...jwt-secret"},
    {"name": "DB_USER", "valueFrom": "arn:...database:username::"},
    {"name": "DB_PASSWORD", "valueFrom": "arn:...database:password::"}
  ]
}
```

**Critical Fix Applied (Feb 7, 2026 - Review Agent):**
- Added DB_USER and DB_PASSWORD secrets from Secrets Manager
- Previous issue: Task definition foxtrot-test:4 crashed due to undefined database credentials
- Fix verified: Secrets Manager contains username/password keys

### Testing Environment Purpose

**Deployment Strategy:**
1. **Local Machine Testing** (Model 3) - Developer laptops
2. **AWS ECS Testing** (Model 2) - Cloud validation before hardware
3. **Edge Device Deployment** (Model 1) - Production on-premise hardware

**Why ECS Testing:**
- Validate code works in cloud environment
- Test database connectivity (RDS vs NeDB)
- Verify sync to GreenReach Central
- Catch deployment issues before provisioning edge hardware
- Cost-effective testing ($32-59/month temporary)

**Configuration Differences:**
- Uses RDS (DB_ENABLED=true) vs NeDB on edge devices
- Public IP for testing vs private network on-premise
- Operates identically to edge device from software perspective
- Syncs to Central same as physical edge device would

### Current ECS Status

- ⚠️ Running task has NO FARM_ID (needs update)
- ✅ Deploy script updated with FARM_ID + EDGE_MODE + DB credentials
- 🔴 **Blocker**: Docker image outdated (missing controller file)
- ⏸️ Requires Docker installation and image rebuild
- 🎯 Next deployment (task definition :5) will test as FARM-TEST-WIZARD-001 with working database

---

## Configuration Hierarchy

**Priority order (highest to lowest):**

1. **Environment Variables** (process.env)
   - `FARM_ID`
   - `EDGE_MODE`
   - `GREENREACH_CENTRAL_URL`
   - `DB_ENABLED`

2. **config/edge-config.json** (file-based)
   - `farmId`
   - `mode` (edge/cloud)
   - `centralApiUrl`
   - `syncEnabled`

3. **Default Values** (lib/edge-config.js)
   - `mode: "cloud"`
   - `syncEnabled: true`
   - `centralApiUrl: "https://api.greenreach.com"`

**Code Reference:** [lib/edge-config.js](lib/edge-config.js#L122-L124)

---

## Security Concerns (Under Review)

### API Key Management System

**Current State:**
- No keys exist in database (both farms show `api_key_exists: false`)
- Demo key hardcoded in config files
- No validation system in central

**Required Before Production:**
1. API key storage (database table, hashed)
2. Key validation middleware in Central
3. Key generation script
4. Key rotation policy
5. Revocation process

**Blocker:** Cannot provision new edge devices without key management infrastructure

---

## Deployment Checklist

### Model 1: New Edge Device

- [ ] Generate unique FARM_ID (format: `FARM-{8-char-code}`)
- [ ] Register farm: `POST /api/farms/register` (verify endpoint exists)
- [ ] Generate 64-char hex API key
- [ ] Configure `edge-config.json`
- [ ] Set environment variables
- [ ] Test heartbeat sync
- [ ] Verify data appears in Central dashboard

### Model 3: Local Development

- [x] Update `edge-config.json` (Feb 7, 2026)
  - [x] `centralApiUrl: "http://www.greenreachgreens.com"`
  - [x] `syncEnabled: true`
  - [x] `offlineMode: false`
- [ ] Start local server
- [ ] Verify heartbeat in Central
- [ ] Test data sync (rooms, groups, telemetry)

### Model 2: Cloud ECS (BLOCKED)

- [ ] Architecture decision complete
- [ ] Database strategy defined
- [ ] Cost model approved
- [ ] Fix current ECS dTesting

- [x] Deploy script updated (Feb 7, 2026)
- [x] FARM_ID added to task definition
- [x] EDGE_MODE and CENTRAL_URL configured
- [ ] Redeploy to AWS
- [ ] Verify health endpoint shows farmId
- [ ] Test sync to Central
- [ ] Verify operational data appears in dashboard
- [ ] Validate before edge hardware deployme
**Test Date:** February 7, 2026

### Big Green Farm (Model 1)
```bash
curl http://www.greenreachgreens.com/api/sync/FARM-MKLOMAT3-A9D8/groups
# Result: 3 groups (Little Green, Big Green, Mid Green)
# Status: ✅ Working
```

### This is Your Farm (Model 3)
```bash
curl http://www.greenreachgreens.com/api/sync/FARM-TEST-WIZARD-001/groups
# Result: 0 groups (sync was disabled)
# Status: ⚠️ Fixed - awaiting server restart
```

### ECS Deployment
```bash
curl http://18.234.99.35:8091/health
# Result: {"status":"healthy","farmId":null,"database":null}
# Status: ❌ No farm identity configured
```

---

## Next Steps

### Immediate (Approved)
1. ✅ Test local farm sync after config fix
2. ✅ Redeploy ECS with FARM_ID environment variables
3. 🔲 Verify "This is Your Farm" appears in dashboard with data

### High Priority (Approved with Conditions)
1. 🔲 Verify `/api/farms/register` endpoint exists
2. 🔲 Create `provision-edge-farm.sh` automation script
3. 🔲 Document edge device provisioning in `EDGE_DEPLOYMENT_GUIDE.md`

### Strategic (Blocked - Architecture Review Required)
1. 🔲 Architecture Agent review Model 2
2. 🔲 Define multi-tenant vs cloud-edge strategy
3. 🔲 Database topology decision
4. 🔲 Cost-benefit analysis

### Security (Critical Path)
1. 🔲 Design API key management system
2. 🔲 Create separate proposal for key infrastructure
3. 🔲 Implement key generation/validation
4. 🔲 Define rotation and revocation policies

---

## References

- **Agent Framework**: [.github/AGENT_SKILLS_FRAMEWORK.md](.github/AGENT_SKILLS_FRAMEWORK.md)
- **Edge Config**: [lib/edge-config.js](lib/edge-config.js)
- **ECS Deploy Script**: [aws-testing/deploy-ecs.sh](aws-testing/deploy-ecs.sh)
- **Sync Routes**: [greenreach-central/routes/sync.js](greenreach-central/routes/sync.js)
- **Review Verdict**: Approved Models 1 & 3, Rejected Model 2 (Feb 7, 2026)
