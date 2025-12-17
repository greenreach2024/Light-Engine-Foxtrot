# Environmental Control System - ML-Enhanced Room-Level Automation

## 🎯 Overview

This modular environmental control system provides ML-enhanced, room-level automation for multi-zone grow environments. It replaces the old zone-specific control logic with intelligent, coordinated control across all zones.

## 📁 Architecture

```
controller/
├── checkAndControlEnvironment.js  # ML-enhanced sensor fusion & control coordinator
├── coreAllocator.js               # Room-level multi-zone allocation logic
└── INTEGRATION_GUIDE.js           # Step-by-step integration instructions

services/
├── ml-gateway.js                  # ML API gateway with caching
└── ml-gateway-example.js          # Usage examples

routes/
└── ml.js                          # ML API routes (anomalies, effects)
```

## 🔧 Key Components

### 1. **checkAndControlEnvironment.js**
Main control coordinator with ML-enhanced sensor fusion.

**Features:**
- ✅ Anomaly-resistant sensor readings using ML detection
- ✅ Spatial interpolation for failed sensors
- ✅ Distance-weighted median from neighboring zones
- ✅ Integrates ML effect matrices for smarter control

**Key Function:**
```javascript
robustSensor(zone, key, allZones, anomalies)
```
Returns robust sensor reading by:
1. Checking ML anomaly detection (severity >= 0.8)
2. Checking confidence score (< 0.5 triggers fallback)
3. Falling back to distance-weighted median from neighbors
4. Using Gaussian spatial weighting (σ ≈ 4)

### 2. **coreAllocator.js**
Room-level multi-zone environmental control.

**Control Strategy:**
1. **Find Active Zones** - Only zones with active growing groups
2. **Check ANY Exceeded** - If ANY active zone exceeds targets
3. **Use ALL Equipment** - Not filtered by zone (room-level)
4. **Equalize with Fans** - Circulation fans distribute conditions

**Equipment Types:**
- Dehumidifiers (high RH control)
- Humidifiers (low RH control)
- Circulation fans (equalization)
- Heaters/coolers (temperature control) *TODO*

**Control Logic:**
```
IF any_active_zone.rh > target.rh_max:
  → Activate ALL dehumidifiers
  → Activate ALL circulation fans
  → Wait 5 minute cooldown

IF any_active_zone.rh < target.rh_min:
  → Deactivate ALL dehumidifiers
  → Activate ALL humidifiers
  → Wait 5 minute cooldown

IF all_active_zones.rh in_range:
  → Deactivate humidity control equipment
```

### 3. **ml-gateway.js**
Caching gateway for ML endpoints.

**Cache Strategy:**
- `getAnomalies()`: 15 second TTL (frequent updates)
- `getEffects()`: 5 minute TTL (slow changes)

**API:**
```javascript
import { getAnomalies, getEffects, getCacheStats, clearCache } from './services/ml-gateway.js';

const anomalies = await getAnomalies();
const effects = await getEffects();
const stats = getCacheStats();
clearCache(); // Force refresh
```

## 🚀 Integration

See `controller/INTEGRATION_GUIDE.js` for complete step-by-step instructions.

**Quick Steps:**

1. **Import modules** in `server-charlie.js`:
```javascript
import { checkAndControlEnvironment } from './controller/checkAndControlEnvironment.js';
import { coreAllocator } from './controller/coreAllocator.js';
```

2. **Replace per-zone loop** with single call:
```javascript
// Old: for (const zone of zones) { await checkAndControlEnvironment(zone, zones); }

// New: Call once with all zones
await checkAndControlEnvironment(envData.zones, iotDevices, {
  coreAllocator,
  plugManager: prePlugManager,
  groups,
  targets,
  lastActions: preAutomationEngine._lastEnvironmentalActions || {}
});
```

3. **Remove old inline function** (lines ~14017-14072)

## 📊 Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Sensor Sync (every 30s)                                     │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ↓
┌─────────────────────────────────────────────────────────────┐
│ checkAndControlEnvironment()                                │
│  1. Fetch ML anomalies (15s cache)                         │
│  2. Fetch ML effects (5min cache)                          │
│  3. Robustify sensors with spatial interpolation           │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ↓
┌─────────────────────────────────────────────────────────────┐
│ coreAllocator()                                             │
│  1. Find active zones (zones with active groups)           │
│  2. Check if ANY active zone exceeds targets               │
│  3. Find ALL room equipment (not zone-filtered)            │
│  4. Apply room-level control with circulation              │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ↓
┌─────────────────────────────────────────────────────────────┐
│ Device Control (plugManager)                                │
│  - Dehumidifiers ON/OFF                                     │
│  - Humidifiers ON/OFF                                       │
│  - Circulation fans ON/OFF                                  │
│  - Heaters/coolers ON/OFF (TODO)                            │
└─────────────────────────────────────────────────────────────┘
```

## 🧪 ML Integration

### Anomaly Detection
Flags sensors with high anomaly severity:
```json
{
  "anomalies": [
    {
      "zoneId": "zone-1",
      "sensor": "rh",
      "severity": 0.95,
      "message": "RH sensor spike detected"
    }
  ],
  "confidences": {
    "zone-1.rh": 0.3,
    "zone-1.tempC": 0.9
  }
}
```

### Effect Matrices
ML-learned spatial effects of actuators:
```json
{
  "H": [[0.8, 0.1], [0.1, 0.8]],  // Humidity effect
  "T": [[0.7, 0.2], [0.2, 0.7]],  // Temperature effect
  "confidence": 0.85
}
```

## 🎛️ Configuration

### Environment Variables
```bash
ML_API_BASE=http://localhost:8091  # ML API base URL
PYTHON_BIN=python3                  # Python executable
```

### Device Requirements
Devices in `iot-devices.json` must have:
- `automationControl: true` - Enable automation
- `zone: <number>` - Zone assignment
- `name: <string>` - Must contain keywords:
  - "dehumid" → dehumidifier
  - "humidif" → humidifier  
  - "fan" or "circulation" → circulation fan

### Target Configuration
Targets from lighting recipes via `preEnvStore`:
```javascript
{
  "zone-1": {
    "rh_max": 65,
    "rh_min": 50,
    "temp_max": 24,
    "temp_min": 18
  }
}
```

## 🔍 Debugging

Enable detailed logging:
```javascript
console.log('[env-control]', ...);  // Main control flow
console.log('[allocator]', ...);    // Allocator decisions
console.log('[ML API]', ...);       // ML endpoint calls
```

Check cache statistics:
```javascript
import { getCacheStats } from './services/ml-gateway.js';
console.log(getCacheStats());
```

## 📈 Benefits Over Old System

| Old System | New System |
|------------|------------|
| ❌ Zone-specific control | ✅ Room-level coordination |
| ❌ No anomaly detection | ✅ ML anomaly-resistant |
| ❌ Single sensor failures | ✅ Spatial interpolation |
| ❌ No equipment coordination | ✅ ALL equipment used |
| ❌ No circulation fans | ✅ Active equalization |
| ❌ Hard-coded thresholds | ✅ ML effect matrices |
| ❌ Per-zone cooldowns | ✅ Room-level cooldowns |
| ❌ Inline 87-line function | ✅ Modular, testable |

## 🚦 Status

- ✅ Core modules created
- ✅ ML gateway with caching
- ✅ Room-level allocator
- ✅ Anomaly-resistant sensor fusion
- ✅ Integration guide
- ⏳ Server integration pending
- ⏳ Testing with real data
- ⏳ ML script implementation

## 📝 Next Steps

1. Integrate into `server-charlie.js` following `INTEGRATION_GUIDE.js`
2. Create ML anomaly detection script (`scripts/simple-anomaly-detector.py`)
3. Create ML effects learning script (`scripts/learn-effects.py`)
4. Test with live sensor data
5. Add temperature control (heaters, coolers, exhaust fans)
6. Add VPD-based control logic
7. Add predictive control using ML forecasts
