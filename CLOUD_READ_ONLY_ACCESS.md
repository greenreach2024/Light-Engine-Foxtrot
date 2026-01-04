# Cloud Read-Only Access Control

## Overview

Cloud customers have **read-only monitoring access** to prevent control issues when their computer is offline. This ensures farm safety by preventing automated systems from failing due to network interruptions.

## Access Control Rules

### Cloud Plan - Read-Only Monitoring ✅
**Allowed:**
- ✅ View sensor data (temperature, humidity, VPD, CO2)
- ✅ View device status (lights, plugs, SwitchBot devices)
- ✅ View automation rules and schedules
- ✅ View nutrient system status
- ✅ Access dashboards and reports
- ✅ View historical data and analytics

**Blocked:**
- ❌ Control lights (on/off, dimming, spectrum)
- ❌ Control smart plugs (fans, dehumidifiers, pumps)
- ❌ Send SwitchBot device commands
- ❌ Modify automation rules or schedules
- ❌ Control nutrient dosing or calibration
- ❌ Execute manual control commands

### Edge Plan - Full Control ✅
**Allowed:**
- ✅ All monitoring capabilities (same as Cloud)
- ✅ **Full device control** (lights, plugs, sensors)
- ✅ **Automation control** (create/modify/execute rules)
- ✅ **Nutrient system control** (dosing, calibration)
- ✅ **Schedule execution** (24/7 on-site hardware)

---

## Why This Restriction Exists

### The Problem
If a Cloud user's computer goes offline:
- ❌ Automation stops running
- ❌ Lights won't adjust to schedule
- ❌ Nutrient dosing halts
- ❌ Environmental controls fail
- ⚠️ **Plants can be damaged or die**

### The Solution
**Cloud:** Read-only monitoring prevents users from creating dependencies on unreliable internet connections.

**Edge:** On-site hardware runs 24/7 independently, providing reliable control even without internet.

---

## Technical Implementation

### Middleware Function
```javascript
function requireEdgeForControl(req, res, next) {
  // Extract JWT token
  const token = req.headers.authorization?.substring(7) || req.query.token;
  
  // Verify and check planType
  const decoded = jwt.verify(token, jwtSecret);
  const planType = (decoded.planType || '').toLowerCase();
  
  // Block Cloud users from control operations
  if (planType === 'cloud') {
    return res.status(403).json({
      error: 'control_restricted',
      message: 'Cloud plan does not allow direct device control.',
      help: 'Use Edge hardware for reliable 24/7 automation.'
    });
  }
  
  next(); // Allow Edge users
}
```

### Protected Endpoints

#### Device Control (Edge-only)
```
POST   /api/switchbot/devices/:deviceId/commands
PATCH  /devices/:id
PATCH  /api/devicedatas/device/:id
POST   /plugs/:plugId/state
```

#### Automation Control (Edge-only)
```
POST   /automation/run
POST   /api/automation/rules
POST   /api/automation/trigger/:ruleId
POST   /api/automation/fan-rotation/rotate
POST   /api/automation/vpd/control/enable
```

#### Nutrient Control (Edge-only)
```
POST   /api/nutrients/targets
POST   /api/nutrients/command
POST   /api/nutrients/pump-calibration
POST   /api/nutrients/sensor-calibration
```

#### Read-Only (Both plans)
```
GET    /api/switchbot/devices
GET    /api/switchbot/status
GET    /devices
GET    /api/automation/rules
GET    /api/nutrients/status
GET    /env
```

---

## Error Responses

### Cloud User Attempts Control
```json
{
  "ok": false,
  "error": "control_restricted",
  "message": "Cloud plan does not allow direct device control. Use Edge hardware for reliable 24/7 automation.",
  "help": "Cloud customers can monitor sensors but cannot send control commands. This prevents farm failures when your computer is offline.",
  "planType": "cloud",
  "upgradeUrl": "/purchase.html?plan=edge"
}
```

### Edge User Gets Full Access
```json
{
  "ok": true,
  "status": "success",
  "message": "Command sent successfully"
}
```

---

## Plan Comparison

| Feature | Cloud Plan | Edge Plan |
|---------|-----------|-----------|
| **Price** | $299/month | $999 one-time |
| **Sensor Monitoring** | ✅ Yes | ✅ Yes |
| **Device Control** | ❌ No | ✅ Yes |
| **Automation** | ❌ View-only | ✅ Full control |
| **Nutrient Control** | ❌ No | ✅ Yes |
| **Reliability** | ⚠️ Requires internet | ✅ On-site 24/7 |
| **Use Case** | Monitoring only | Production farms |

---

## Upgrade Path

Cloud customers who need control capabilities can upgrade to Edge:
1. Visit `/purchase.html?plan=edge`
2. Purchase Edge hardware ($999)
3. Complete activation with 8-character code
4. JWT token updated with `planType: 'edge'`
5. Full control access granted

---

## Security Notes

1. **JWT Token Required:** All endpoints verify plan type from JWT token
2. **Backward Compatible:** PIN-based auth (legacy) bypasses check for existing setups
3. **Demo Mode:** Demo users get full access for testing
4. **Token Refresh:** Plan type persists in token through refresh cycles
5. **Database Source:** Plan type stored in `farms.plan_type` column

---

## Testing

### Test Cloud Restrictions
```bash
# Cloud user attempts control (should fail)
curl -X POST http://localhost:8091/api/switchbot/devices/ABC123/commands \
  -H "Authorization: Bearer CLOUD_USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command":"turnOn"}'

# Expected: 403 Forbidden with control_restricted error
```

### Test Edge Access
```bash
# Edge user controls device (should succeed)
curl -X POST http://localhost:8091/api/switchbot/devices/ABC123/commands \
  -H "Authorization: Bearer EDGE_USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command":"turnOn"}'

# Expected: 200 OK with success message
```

### Test Monitoring (Both Plans)
```bash
# Both Cloud and Edge can monitor
curl http://localhost:8091/api/switchbot/devices \
  -H "Authorization: Bearer ANY_VALID_TOKEN"

# Expected: 200 OK with device list
```

---

## Related Files

- `/server-foxtrot.js` - Middleware and endpoint protection
- `/routes/purchase.js` - Plan type storage during purchase
- `/public/login.html` - Plan type stored in localStorage
- `/CLOUD_VS_EDGE_FLOW.md` - Complete plan type flow documentation

---

## Support

For questions about access control:
- **Sales:** support@greenreachgreens.com
- **Docs:** `/docs/cloud-vs-edge.html`
- **Purchase:** `/purchase.html`
