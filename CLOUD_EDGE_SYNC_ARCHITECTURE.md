# Cloud-to-Edge Sync Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         GreenReach Ecosystem                                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐          ┌──────────────────┐          ┌─────────────────┐
│                 │          │                  │          │                 │
│  Farm Owner's   │◄────────►│  GreenReach      │◄────────►│  Edge Device    │
│  Web Browser    │  HTTPS   │  Central (AWS)   │  HTTPS   │  (reTerminal)   │
│                 │          │                  │          │                 │
└─────────────────┘          └──────────────────┘          └─────────────────┘
         │                            │                             │
         │                            │                             │
    [User Login]              [farmSettingsStore]          [farm.json]
    [View Farm]               [In-Memory Map]              [SQLite DB]
    [Edit Settings]           [Audit Log]                  [PMX devices]
```

## Data Flow: Cloud → Edge (User makes remote change)

```
Step 1: User Authentication & Change Request
┌────────────────────┐
│  User Browser      │
│  portal.greenreach │
│  .com              │
└─────────┬──────────┘
          │ 1. POST /api/farm-settings/FARM-XXX/certifications
          │    Authorization: Bearer JWT-token
          │    Body: { certifications: ["GAP"], practices: ["Pesticide Free"] }
          ▼
┌────────────────────┐
│  GreenReach        │
│  Central (AWS)     │
│  Load Balancer     │
└─────────┬──────────┘
          │ 2. Validate JWT token → Extract farmId
          │    Check user permissions → Authorized
          ▼
┌────────────────────┐
│  farm-settings.js  │ ──────────────────────────────────┐
│  Route Handler     │                                   │
└─────────┬──────────┘                                   │
          │ 3. Store change in farmSettingsStore Map     │
          │    {                                         │
          │      farmId: "FARM-XXX",                     │
          │      pendingChanges: {                       │
          │        certifications: {                     │
          │          certifications: ["GAP"],            │
          │          practices: ["Pesticide Free"],      │
          │          updatedAt: "2026-01-22T10:30:00Z", │
          │          updatedBy: "user@example.com",      │
          │          synced: false ◄──────────────────────┘
          │        }
          │      }
          │    }
          │
          │ 4. Add to changeLog audit trail
          │    Return: { success: true, pendingSync: true }
          ▼
     Response to user:
     "Changes will sync to farm within 30 seconds"


Step 2: Edge Device Polling (Every 30 seconds)
┌────────────────────┐
│  Edge Device       │
│  100.65.187.59     │
│  :8091             │
└─────────┬──────────┘
          │ 5. Scheduled poll (setInterval 30000ms)
          │    GET /api/farm-settings/FARM-XXX/pending
          │    Headers:
          │      X-API-Key: edge-device-key
          │      X-Farm-ID: FARM-XXX
          ▼
┌────────────────────┐
│  farm-settings.js  │
│  authenticateFarm  │
└─────────┬──────────┘
          │ 6. Validate API key → Authorized
          │    Check farmSettingsStore[farmId]
          │    Find unsynced changes (synced: false)
          ▼
     Response:
     {
       hasPendingChanges: true,
       changes: {
         certifications: {
           certifications: ["GAP"],
           practices: ["Pesticide Free"],
           updatedAt: "2026-01-22T10:30:00Z",
           updatedBy: "user@example.com"
         }
       }
     }


Step 3: Apply Changes on Edge
┌────────────────────┐
│  Edge Device       │
│  FarmSettingsSync  │
│  Client            │
└─────────┬──────────┘
          │ 7. Receive pending changes
          │    applyChanges(changes)
          ▼
     For each changeType:
     ┌──────────────────────────────────┐
     │  applyCertifications(data)       │
     │    - Load farm.json              │
     │    - Update certifications       │
     │    - Save farm.json              │
     │    - Emit 'settings-updated'     │
     └──────────────────────────────────┘
          │
          │ 8. POST /api/farm-settings/FARM-XXX/ack
          │    Body: {
          │      changeType: "certifications",
          │      success: true
          │    }
          ▼
┌────────────────────┐
│  farm-settings.js  │
└─────────┬──────────┘
          │ 9. Mark change as synced
          │    farmSettingsStore[farmId]
          │      .pendingChanges.certifications.synced = true
          │      .syncedAt = "2026-01-22T10:30:25Z"
          ▼
     Sync Complete ✓
```

## Data Flow: Edge → Cloud (User changes on-device)

```
Step 1: Local Change on Edge Device
┌────────────────────┐
│  Farm Admin UI     │
│  http://edge:8091  │
│  /farm-admin.html  │
└─────────┬──────────┘
          │ 1. User clicks "Edit Certifications"
          │    Selects: ["USDA Organic", "Food Safety Certified"]
          │    Clicks "Save"
          ▼
     POST /api/setup/certifications
     Body: {
       certifications: ["USDA Organic", "Food Safety Certified"],
       practices: ["Non-GMO", "Local"]
     }


Step 2: Edge Device Processes Change
┌────────────────────┐
│  server-foxtrot.js │
│  /api/setup/       │
│  certifications    │
└─────────┬──────────┘
          │ 2. Load data/farm.json
          │    Update certifications section
          │    Save farm.json
          │    ✓ Local change applied
          │
          │ 3. Push to cloud (bidirectional sync)
          │    POST {centralUrl}/api/farm-settings/{farmId}/certifications
          │    Headers: X-API-Key, X-Farm-ID
          │    Body: { certifications, practices }
          ▼
┌────────────────────┐
│  GreenReach        │
│  Central (AWS)     │
└─────────┬──────────┘
          │ 4. Store in farmSettingsStore
          │    (for other edge devices or cloud UI sync)
          │    Mark as already synced (synced: true)
          │    updatedBy: "edge-device"
          ▼
     Bidirectional sync complete ✓
```

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       GreenReach Central (AWS EB)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐       │
│  │  server.js       │   │  farm-settings.  │   │  farmSettings    │       │
│  │  Express app     │──►│  js Routes       │──►│  Store (Map)     │       │
│  │  Port 3000       │   │  Auth middleware │   │  In-memory       │       │
│  └──────────────────┘   └──────────────────┘   └──────────────────┘       │
│           │                                              │                  │
│           │                                              │                  │
│  ┌────────▼───────────────────────────────────────────┐ │                  │
│  │  API Endpoints:                                     │ │                  │
│  │  • POST /:farmId/certifications                     │ │                  │
│  │  • GET  /:farmId/pending ◄──────────────────────────┼─┘                  │
│  │  • POST /:farmId/ack                                │                    │
│  │  • GET  /:farmId/history                            │                    │
│  └─────────────────────────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ HTTPS (polling every 30s)
                                    │
┌───────────────────────────────────┼─────────────────────────────────────────┐
│                       Edge Device (reTerminal)                               │
├───────────────────────────────────┼─────────────────────────────────────────┤
│                                   │                                          │
│  ┌────────────────────────────────┴──────┐   ┌──────────────────┐          │
│  │  farm-settings-sync.js                │   │  server-foxtrot  │          │
│  │  FarmSettingsSyncClient               │◄──│  .js             │          │
│  │  • pollForChanges() every 30s         │   │  Port 8091       │          │
│  │  • applyChanges(changes)              │   └──────────────────┘          │
│  │  • acknowledgeSync(type, success)     │            │                     │
│  └───────────────────────────────────────┘            │                     │
│                       │                               │                     │
│                       ▼                               ▼                     │
│  ┌─────────────────────────────────────────────────────────────┐           │
│  │  data/farm.json                                              │           │
│  │  {                                                           │           │
│  │    "certifications": {                                       │           │
│  │      "certifications": ["GAP", "USDA Organic"],              │           │
│  │      "practices": ["Pesticide Free"],                        │           │
│  │      "lastSyncedAt": "2026-01-22T10:30:25Z"                 │           │
│  │    }                                                         │           │
│  │  }                                                           │           │
│  └─────────────────────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Sync States

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Change Lifecycle                                                             │
└──────────────────────────────────────────────────────────────────────────────┘

   CREATED                 PENDING                 SYNCED
   -------                 -------                 ------
      │                       │                       │
      │  User makes change    │                       │
      │  on cloud portal      │                       │
      ├──────────────────────►│                       │
      │                       │                       │
      │                       │  Edge device polls    │
      │                       │  Receives changes     │
      │                       ├──────────────────────►│
      │                       │                       │
      │                       │  Applies to farm.json │
      │                       │  Sends ACK            │
      │                       │                       │
                              │                       │
                              │◄──────────────────────┤
                              │  If sync fails,       │
                              │  remains in PENDING   │
                              │  (retry next poll)    │
```

## Security Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Authentication Flow                                                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐           ┌──────────────┐           ┌──────────────┐
│  Cloud User  │           │  Edge Device │           │  GreenReach  │
│              │           │              │           │  Central     │
└──────┬───────┘           └──────┬───────┘           └──────┬───────┘
       │                          │                          │
       │ JWT Token                │                          │
       │ (user authentication)    │                          │
       ├─────────────────────────────────────────────────────►│
       │                          │                          │
       │                          │ X-API-Key                │
       │                          │ (farm authentication)    │
       │                          ├─────────────────────────►│
       │                          │                          │
       │                          │                          │
       │                          │ Validates:               │
       │                          │ • API key exists         │
       │                          │ • farmId matches         │
       │                          │ • Not rate limited       │
       │                          │                          │
```

## Monitoring & Observability

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Logging & Metrics                                                           │
└─────────────────────────────────────────────────────────────────────────────┘

Edge Device Logs:
  [Settings Sync] Starting sync client...
  [Settings Sync] ✓ Sync client started
  [Settings Sync] 📥 Pending changes detected
  [Settings Sync] Applying certifications...
  [Settings Sync] ✓ certifications applied successfully
  [Settings Sync] ❌ Poll error (3x): Connection timeout

Cloud Logs:
  [farm-settings] POST /certifications - FARM-XXX - user@example.com
  [farm-settings] GET /pending - FARM-XXX - edge device
  [farm-settings] POST /ack - FARM-XXX - certifications - success
  [farm-settings] Audit: 45 changes in last 24h

Metrics to Track:
  • sync_latency_seconds (target: <35s)
  • sync_success_rate (target: >99%)
  • pending_changes_count (alert if >10)
  • consecutive_errors_count (alert if >5)
  • poll_interval_seconds (default: 30s)
```

## Error Handling

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Failure Scenarios & Recovery                                                │
└─────────────────────────────────────────────────────────────────────────────┘

Scenario 1: Network Timeout
  Edge device ──X──► Cloud
  • Edge logs warning
  • Increments consecutiveErrors counter
  • Retries on next poll cycle (30s)
  • Alert if >5 consecutive failures

Scenario 2: Cloud Server Restart
  Cloud restarts → farmSettingsStore cleared (in-memory)
  • Pending changes lost ◄── LIMITATION
  • Mitigation: Quick sync cycles (30s), rare restarts
  • Future: Persist to database

Scenario 3: Edge Device Offline
  Edge offline for 2 hours
  • Cloud continues queueing changes
  • When edge comes back online:
    - Polls for pending changes
    - Receives all queued changes
    - Applies batch update
    - Sends ACK

Scenario 4: Apply Change Fails
  Edge receives change but can't write to farm.json
  • Edge sends ACK with success: false
  • Cloud keeps change in pending state
  • Edge retries on next poll
  • Logs error details for debugging
```

---

**Diagram Version**: 1.0  
**Last Updated**: 2026-01-22  
**Status**: Reflects current implementation
