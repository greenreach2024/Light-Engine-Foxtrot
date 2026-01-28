# Light Engine & GreenReach Central Production Readiness Report
**Date:** January 28, 2026  
**Farm:** Big Green Farm (FARM-MKLOMAT3-A9D8)  
**Edge Device:** 100.65.187.59:8091  
**Cloud:** GreenReach Central @ greenreachgreens.com  
**Reviewer:** AI Engineering Assistant

---

## Executive Summary

**Overall Status: CRITICAL ISSUE - IMMEDIATE ATTENTION REQUIRED**

### System Health
- **Light Engine Edge:** ONLINE with 1 Critical Bug
- **GreenReach Central:** Status Unknown (not tested in this audit)
- **Edge-to-Cloud Sync:** Not Verified
- **Data Integrity:** Good (all files present)
- **Services:** All Running (lightengine-node, lightengine-fastapi, sensor-ingester)

### Critical Finding

**CRITICAL BUG: Missing `isDemoMode()` Function**
- **Location:** [server-foxtrot.js](server-foxtrot.js) (Lines 18526 and others)
- **Error:** `ReferenceError: isDemoMode is not defined`
- **Impact:** Crashes on accessing `/data/env-cache.json` and `/data/farm.json` endpoints
- **Status:** Production code references removed function
- **Priority:** IMMEDIATE FIX REQUIRED

---

## 1. Edge Device Status (100.65.187.59)

### 1.1 System Information
```
Farm ID:    FARM-MKLOMAT3-A9D8
Farm Name:  Big Green Farm
Location:   Kingston, Ontario (44.2312, -76.4860)
Contact:    Peter Gilbert (shelbygilbert@rogers.com)
Timezone:   America/Toronto
Network:    WiFi (SSID: redbrick)
```

### 1.2 Service Health
| Service | Status | Port | Uptime | Memory | Restarts |
|---------|--------|------|--------|--------|----------|
| lightengine-node | ONLINE | 8091 | 6m | 139.8 MB | 16 |
| lightengine-fastapi | ONLINE | 8000 | 25h | 22.1 MB | 0 |
| sensor-ingester | ONLINE | N/A | 9m | 2.8 MB | 0 |

**Alert:** `lightengine-node` has restarted 16 times - indicating instability

### 1.3 Health Check Results
```json
{
  "status": "healthy",
  "uptime": "6m 24s",
  "memory": "140 MB / 7812 MB (2%)",
  "requests": {
    "total": 18,
    "errors": 2,
    "errorRate": "11.11%",
    "avgResponseTime": "26ms"
  }
}
```

**Issues:**
- Error rate: 11.11% (2 of 18 requests failing)
- Database: Disabled (using NeDB file storage)
- Disk status: Unknown

### 1.4 Configuration Verification
```
NODE_ENV=production
EDGE_MODE=true
DEMO_MODE=false
```

**Configuration Status:**
- Environment: Correctly set to production
- Edge Mode: Enabled (correct for on-site hardware)
- Demo Mode: Disabled (correct - no fake data)
- ALLOW_MOCKS: Not set (defaults to false - correct)

### 1.5 Data Files Status
All required data files present at `/home/greenreach/Light-Engine-Foxtrot/public/data/`:

**Core Configuration:**
- `farm.json` - Farm profile (VERIFIED)
- `rooms.json` - Room configuration (1 room: "Big Green Farm - Room 1")
- `groups.json` - Light groups (11 KB - populated)
- `schedules.json` - Automation schedules (3 KB - populated)
- `iot-devices.json` - Device registry (1 ESP32 sensor)

**Operational Data:**
- `env.json` - Environmental readings (6 KB - actively updated)
- `env-cache.json` - Sensor cache (79 bytes - minimal)
- `lighting-recipes.json` - Crop recipes (1.2 MB - full database)
- `equipment-metadata.json` - Hardware catalog

**Business Data:**
- `wholesale-products.json` - Product catalog
- `crop-pricing.json` - Pricing database

### 1.6 API Endpoints Status

**Working Endpoints:**
- `/health` - System health check
- `/api/health/insights` - Farm scoring and zone analysis
- `/data/rooms.json` - Room configuration
- POST `/ingest/env` - Sensor data ingestion (actively receiving data)

**Failing Endpoints:**
- `/data/farm.json` - Returns 500 Internal Server Error
- `/data/env-cache.json` - Returns 500 Internal Server Error
- `/api/env/latest?scope=zone-1` - Returns empty scope error

### 1.7 Sensor Integration
**ESP32 Sensor Device:**
```json
{
  "id": "serial-0001",
  "name": "ESP32 Sensor (ttyUSB1)",
  "brand": "Silicon Labs",
  "protocol": "usb-serial",
  "type": "environmental_sensor",
  "location": "Zone 1",
  "port": "/dev/ttyUSB0"
}
```

**Status:** Device registered, data ingestion active
**Issue:** Environmental sensor API returns "Scope 'zone-1' not found. Available: []"
- Suggests sensor data not properly cached or scoped

---

## 2. Code Analysis

### 2.1 Critical Bug: Missing isDemoMode() Function

**Problem:**
The [server-foxtrot.js](server-foxtrot.js) file has 20+ references to `isDemoMode()` function, but the function is not defined.

**Evidence:**
```javascript
// Line 41: Comment says "DEMO MODE REMOVED"
// DEMO MODE REMOVED - Production only uses real farm data and sensors

// Line 18526: Code still tries to call isDemoMode()
if (isDemoMode()) {
  // ... demo mode logic
}
```

**Error Log:**
```
ReferenceError: isDemoMode is not defined
    at file:///home/greenreach/Light-Engine-Foxtrot/server-foxtrot.js:18526:3
Request URL: /data/env-cache.json
Request Method: GET
```

**Impact:**
- Crashes when accessing farm configuration endpoints
- Prevents proper operation of environmental cache
- Causes 11% error rate in production
- Triggers frequent restarts (16 restarts observed)

**Root Cause:**
Incomplete refactoring - function was removed but all call sites were not updated

### 2.2 Architecture Assessment

**Light Engine Edge (server-foxtrot.js):**
- 24,952 lines of code
- Comprehensive feature set
- Good security middleware (rate limiting, audit logging, JWT auth)
- Plan-based access control (Cloud vs Edge plans)
- Real-time automation engine
- MQTT sensor ingestion
- RESTful API architecture

**FastAPI Backend (backend/main.py):**
- 794 lines of Python code
- Environmental sensor data API
- CORS properly configured
- Inventory management routes
- Device discovery capabilities
- Clean Pydantic models for validation

**GreenReach Central (greenreach-central/server.js):**
- 323 lines of code
- Lightweight monitoring platform
- PostgreSQL database backend
- WebSocket support for real-time updates
- Wholesale marketplace features
- In-memory farm registry with database fallback

### 2.3 Security Posture

**Strengths:**
- Helmet.js security headers
- JWT-based authentication
- Rate limiting on API endpoints
- Audit logging middleware
- CORS restrictions
- Plan-based access control
- Secrets manager for sensitive data

**Concerns:**
- No HTTPS verification mentioned (HTTP only on port 8091)
- Database disabled (using file storage)
- Missing isDemoMode() function could expose security issues

---

## 3. Deployment Architecture

### 3.1 Edge Deployment
**PM2 Configuration:** ecosystem.edge.config.js references `server-charlie.js`
**Actual Server:** Running `server-foxtrot.js`

**INCONSISTENCY DETECTED:**
- PM2 config specifies: `script: 'server-charlie.js'`
- No `server-charlie.js` file exists in repository
- System is actually running `server-foxtrot.js`
- This suggests manual override or config mismatch

**Recommendation:** Update ecosystem.edge.config.js to reference correct file

### 3.2 Data Flow

```
ESP32 Sensor (USB Serial)
    ↓
sensor-ingester (PM2 process)
    ↓
POST /ingest/env
    ↓
lightengine-node (server-foxtrot.js)
    ↓
Automation Rules Engine
    ↓
File Storage (public/data/*.json)
    ↓
Dashboard & API (Port 8091)
```

**Status:** Data flow operational but environmental cache not properly populated

### 3.3 Edge-to-Cloud Sync

**Not Verified in This Audit**
- Previous reports indicate cloud sync was not configured
- GreenReach Central status unknown
- No heartbeat verification performed
- Recommendation: Test full edge-to-cloud sync workflow

---

## 4. Operational Readiness

### 4.1 Production Readiness Checklist

| Category | Status | Score | Notes |
|----------|--------|-------|-------|
| **Core Services** | ONLINE | 8/10 | All processes running but unstable |
| **Code Quality** | CRITICAL | 3/10 | Missing function causing crashes |
| **Data Integrity** | GOOD | 9/10 | All files present and populated |
| **Sensor Integration** | PARTIAL | 6/10 | Data flowing but cache issues |
| **API Functionality** | DEGRADED | 5/10 | Key endpoints failing |
| **Security** | GOOD | 7/10 | Good middleware, no HTTPS |
| **Monitoring** | GOOD | 8/10 | Health checks working |
| **Documentation** | EXCELLENT | 9/10 | Comprehensive reports available |
| **Configuration** | GOOD | 8/10 | Proper env vars, minor mismatch |

**Overall Readiness:** 63/90 (70%) - NOT PRODUCTION READY

### 4.2 Known Issues Summary

**CRITICAL (Must Fix Before Production):**
1. Missing `isDemoMode()` function causing crashes
2. 16 service restarts indicate instability
3. Environmental sensor cache not properly initialized

**HIGH (Should Fix Soon):**
4. PM2 config references non-existent server-charlie.js
5. 11% API error rate
6. Sensor scope mapping issue (zone-1 not found)

**MEDIUM (Can Delay):**
7. No HTTPS on Edge device
8. Database disabled (using file storage)
9. Edge-to-cloud sync not verified

**LOW (Nice to Have):**
10. Disk status unknown in health check
11. No uptime guarantees documented

---

## 5. Recommendations

### 5.1 Immediate Actions (Today)

**1. Fix isDemoMode() Bug**
- Add missing function definition to server-foxtrot.js
- Implement as: `const isDemoMode = () => process.env.DEMO_MODE === 'true';`
- Test all 20+ call sites
- Verify no crashes after fix

**2. Fix PM2 Configuration**
- Update ecosystem.edge.config.js
- Change `script: 'server-charlie.js'` to `script: 'server-foxtrot.js'`
- Restart services with correct config

**3. Initialize Environmental Cache**
- Investigate why scope 'zone-1' is not found
- Verify sensor data properly written to env-cache.json
- Test `/api/env/latest?scope=zone-1` endpoint

### 5.2 Short-Term Actions (This Week)

**4. Stabilize Services**
- Investigate why lightengine-node has 16 restarts
- Review logs for recurring errors
- Add automatic crash recovery
- Implement graceful shutdown

**5. Test Edge-to-Cloud Sync**
- Verify GreenReach Central is operational
- Test farm heartbeat mechanism
- Confirm data sync working
- Validate wholesale inventory sync

**6. Add HTTPS Support**
- Generate SSL certificates
- Configure HTTPS on port 443
- Update firewall rules
- Test secure connections

### 5.3 Medium-Term Actions (This Month)

**7. Enable Database**
- Configure PostgreSQL or SQLite
- Migrate from file storage
- Implement proper backup strategy
- Test database performance

**8. Comprehensive Testing**
- End-to-end workflow testing
- Load testing (simulate high sensor data volume)
- Failover testing (what happens if services crash)
- Security penetration testing

**9. Documentation**
- Update deployment guides
- Document troubleshooting procedures
- Create runbook for common issues
- Train operations team

---

## 6. Comparison to Previous Reports

### Changes Since January 24, 2026
**LIGHT_ENGINE_PRODUCTION_READINESS_2026-01-24.md:**
- Status was "PARTIALLY READY"
- All endpoints reported working
- No crashes reported
- **NEW ISSUE:** isDemoMode() bug not present in January 24 codebase

**Regression Detected:**
The system has regressed since January 24. Code changes removed the `isDemoMode()` function without updating all references.

### Changes Since January 21, 2026
**EDGE_PRODUCTION_READINESS_REPORT_2026-01-21.md:**
- Status was "PRODUCTION READY" after fixes
- 9/9 critical issues resolved
- All pages tested and functional
- **REGRESSION:** New critical bug introduced

### Changes Since January 19, 2026
**COMPREHENSIVE_PRODUCTION_READINESS_2026-01-19.md:**
- Edge device was offline (unreachable)
- GreenReach Central scored 7.5/10
- End-to-end testing impossible
- **IMPROVEMENT:** Edge device now accessible and responding

---

## 7. Testing Protocol

### 7.1 Verification Tests After Fix

**Test 1: Basic Endpoints**
```bash
curl http://100.65.187.59:8091/health
# Expected: 200 OK, healthy status

curl http://100.65.187.59:8091/data/farm.json
# Expected: 200 OK, farm configuration

curl http://100.65.187.59:8091/data/env-cache.json
# Expected: 200 OK, environmental cache
```

**Test 2: Sensor Data**
```bash
curl "http://100.65.187.59:8091/api/env/latest?scope=zone-1"
# Expected: 200 OK, sensor readings
```

**Test 3: Service Stability**
```bash
ssh greenreach@100.65.187.59 "pm2 list"
# Expected: 0 restarts for lightengine-node after fix
```

**Test 4: Error Rate**
```bash
curl http://100.65.187.59:8091/health | jq '.metrics.requests.errorRate'
# Expected: "0.00%" or very low
```

### 7.2 Load Testing
```bash
# Generate 100 requests to test stability
for i in {1..100}; do
  curl -s http://100.65.187.59:8091/health > /dev/null
  echo "Request $i complete"
done

# Check for crashes
ssh greenreach@100.65.187.59 "pm2 list"
```

---

## 8. Risk Assessment

### 8.1 Current Risks

**HIGH RISK:**
- Production crashes due to isDemoMode() bug
- Data loss if services restart frequently
- Farm operations interrupted by API failures
- Customer dissatisfaction from unreliable system

**MEDIUM RISK:**
- Sensor data not properly cached
- Edge-to-cloud sync may be broken
- No HTTPS exposes data in transit
- File storage could corrupt under high load

**LOW RISK:**
- Configuration mismatch could cause confusion
- Missing documentation for new bugs
- Performance degradation over time

### 8.2 Mitigation Strategies

**For High Risks:**
- Implement emergency fix for isDemoMode()
- Add comprehensive error handling
- Set up automated monitoring and alerts
- Create rollback procedure

**For Medium Risks:**
- Test and verify all sync mechanisms
- Add SSL/TLS certificates
- Migrate to proper database
- Implement data validation

**For Low Risks:**
- Document all configuration files
- Regular code reviews
- Performance monitoring
- Capacity planning

---

## 9. Conclusion

### 9.1 Current State
The Light Engine Edge system is **ONLINE but UNSTABLE** due to a critical code regression. A recent refactoring removed the `isDemoMode()` function without updating all call sites, causing crashes and a 11% error rate. The system has 16 service restarts and failing endpoints.

### 9.2 Path to Production Readiness

**Estimated Time to Production Ready:** 1-2 days

**Required Work:**
1. Fix isDemoMode() bug (2 hours)
2. Test all affected endpoints (2 hours)
3. Stabilize services (4 hours)
4. Verify edge-to-cloud sync (4 hours)
5. Comprehensive testing (8 hours)

**Total Effort:** 20 hours (2-3 developer days)

### 9.3 Final Recommendation

**DO NOT DEPLOY TO ADDITIONAL FARMS** until isDemoMode() bug is resolved and services are stable for 24+ hours without restarts.

**RECOMMENDED ACTIONS:**
1. Apply emergency fix to server-foxtrot.js
2. Deploy to test environment first
3. Run comprehensive test suite
4. Monitor for 24 hours
5. If stable, proceed with production deployment

### 9.4 Sign-Off Criteria

**System will be considered Production Ready when:**
- Zero crashes or restarts for 24 hours
- Error rate below 1%
- All API endpoints returning 200 OK
- Sensor data properly cached and accessible
- Edge-to-cloud sync verified working
- HTTPS enabled (optional for Phase 1)

---

## Appendix A: Edge Device Access

**IP Address:** 100.65.187.59  
**SSH Access:** `ssh greenreach@100.65.187.59` (Password: Farms2024)  
**Web UI:** http://100.65.187.59:8091  
**Farm Dashboard:** http://100.65.187.59:8091/views/farm-summary.html  
**Installation Path:** /home/greenreach/Light-Engine-Foxtrot  

**PM2 Commands:**
```bash
pm2 list                  # View all processes
pm2 logs lightengine-node # View logs
pm2 restart all           # Restart all services
pm2 save                  # Save PM2 configuration
```

---

## Appendix B: Related Documentation

- [LIGHT_ENGINE_PRODUCTION_READINESS_2026-01-24.md](LIGHT_ENGINE_PRODUCTION_READINESS_2026-01-24.md) - Previous readiness report
- [EDGE_PRODUCTION_READINESS_REPORT_2026-01-21.md](EDGE_PRODUCTION_READINESS_REPORT_2026-01-21.md) - Edge deployment status
- [COMPREHENSIVE_PRODUCTION_READINESS_2026-01-19.md](COMPREHENSIVE_PRODUCTION_READINESS_2026-01-19.md) - Full system audit
- [EDGE_DEVICE_PRODUCTION_READINESS_FINAL.md](EDGE_DEVICE_PRODUCTION_READINESS_FINAL.md) - Edge device guide

---

**Report Generated:** January 28, 2026  
**Next Review:** After isDemoMode() fix is deployed  
**Contact:** AI Engineering Assistant
