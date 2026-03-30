# Alerts vs Anomaly Detection

## Overview

The GreenReach Central Admin platform has two complementary systems for monitoring farm health and operations:

1. **Alert Management** - Rule-based notifications
2. **Anomaly Detection** - ML-based pattern recognition

## Alert Management

### What are Alerts?

**Definition**: Rule-based notifications triggered when specific thresholds or conditions are met.

**Characteristics**:
- **Immediate**: Triggered instantly when condition is met
- **Actionable**: Requires specific human intervention
- **Deterministic**: Same condition always triggers same alert
- **Reactive**: Responds to known problems

### Alert Types

1. **Environmental Alerts**
   - Temperature exceeds safe range (e.g., > 30°C or < 15°C)
   - Humidity outside optimal range (< 50% or > 80%)
   - CO2 levels critical (< 400ppm or > 1500ppm)
   - VPD (Vapor Pressure Deficit) out of range

2. **Device Health Alerts**
   - Sensor offline/not responding
   - Equipment malfunction detected
   - Communication failure with device
   - Battery low on wireless sensors

3. **Business Logic Alerts**
   - Harvest deadline approaching (< 24 hours)
   - Order verification overdue
   - Inventory below minimum threshold
   - Compliance deadline missed

4. **System Alerts**
   - Network connectivity issues
   - API errors or timeouts
   - Database connection failures
   - Authentication/security issues

### Alert Workflow

```
Condition Met → Alert Generated → Status: Active
                    ↓
              Acknowledged by operator → Status: Acknowledged
                    ↓
              Problem fixed → Status: Resolved
```

### Alert Properties

```javascript
{
  id: "alert-001",
  timestamp: "2026-01-18T21:00:00Z",
  farm_id: "GR-00001",
  farm_name: "Farm Alpha",
  severity: "critical|warning|info",
  type: "environmental|device|business|system",
  category: "temperature|humidity|offline|deadline",
  message: "Temperature exceeds threshold in Zone 2",
  value: "32.5°C",           // Current value
  threshold: "30°C",         // Threshold that was exceeded
  status: "active|acknowledged|resolved",
  acknowledged: true,
  acknowledged_by: "admin",
  acknowledged_at: "2026-01-18T21:05:00Z",
  resolved: false,
  resolved_at: null,
  source: "zone-2-temp-sensor",
  context: {
    room_id: "room-a",
    zone_id: "zone-2",
    device_id: "temp-sensor-zone-2"
  }
}
```

---

## Anomaly Detection

### What is Anomaly Detection?

**Definition**: Machine Learning-based system that identifies unusual patterns in data that deviate from expected behavior, even when no specific threshold is violated.

**Characteristics**:
- **Predictive**: Can catch problems before they become critical
- **Adaptive**: Learns from historical data patterns
- **Investigative**: May require analysis to determine if action needed
- **Proactive**: Catches emerging issues and unknown problems

### How it Works

1. **Data Collection**: Continuously monitors environmental metrics (temp, humidity, CO2, VPD)
2. **Feature Engineering**: Calculates statistics (mean, stddev, rate of change) over 24-hour rolling windows
3. **ML Model**: Isolation Forest algorithm analyzes feature matrix
4. **Scoring**: Each data point gets anomaly score (0-1)
5. **Alerting**: Scores > 0.6 trigger anomaly notification

### Anomaly Types Detected

1. **Environmental Drift**
   - Gradual shift in temperature patterns
   - Unusual humidity variance over time
   - Unexpected VPD fluctuations
   - Atypical CO2 cycling patterns

2. **Energy Consumption Anomalies**
   - Unusual power usage patterns
   - Equipment running inefficiently
   - Unexpected load increases

3. **Outdoor-Aware Anomalies**
   - Indoor conditions not matching expected outdoor influence
   - Example: Indoor 28°C when outdoor 15°C (expected 18-22°C) = equipment failure

4. **Multi-Metric Correlations**
   - Unusual relationships between metrics
   - Example: Humidity dropping while temperature stable (ventilation issue)

### Anomaly Properties

```javascript
{
  zone: "zone-2",
  severity: "critical|warning",
  reason: "Temperature spike detected (+3.2°C above expected)",
  timestamp: "2026-01-18T21:00:00Z",
  temperature: "72.5",
  humidity: "65",
  vpd: "0.95",
  anomaly_score: 0.85,      // 0-1 confidence score
  likelihood: 0.72          // Probability this is a real issue
}
```

---

## Key Differences

| Aspect | Alerts | Anomaly Detection |
|--------|--------|-------------------|
| **Trigger** | Rule-based thresholds | ML pattern analysis |
| **Response Time** | Immediate | Analyzes trends over time |
| **Known vs Unknown** | Known problems | Catches unknown issues |
| **Action Required** | Yes - immediate | Maybe - investigative |
| **False Positives** | Low | Higher (needs tuning) |
| **Configuration** | Set thresholds | Train models |
| **Use Case** | Reactive monitoring | Predictive maintenance |

---

## When to Use Each

### Use Alerts For:
- Known operational thresholds (safety limits)
- Equipment failures (device offline)
- Time-sensitive business logic (deadlines)
- Compliance requirements
- Situations requiring immediate response

### Use Anomaly Detection For:
- Discovering unknown issues
- Early warning signs (before alert threshold)
- Equipment degradation over time
- Unusual operational patterns
- Predictive maintenance
- Quality assurance

---

## Complementary Systems

**Both systems work together:**

1. **Anomaly Detection Finds** → Temperature gradually increasing over 3 days
2. **Alert Triggers When** → Temperature exceeds 30°C threshold
3. **Operator Action** → Acknowledges alert and investigates anomaly cause

**Example Scenario:**

```
Day 1: Anomaly detected - "Unusual temperature variance pattern"
       → Operator investigates, finds HVAC filter dirty
       
Day 2: No action taken
       
Day 3: Alert triggered - "Temperature exceeds 30°C"
       → Critical - crop damage risk
```

**Ideal Usage**: Monitor anomalies to prevent alerts from triggering.

---

## API Endpoints

### Alerts
- `GET /api/admin/alerts` - Get all active alerts
- `GET /api/admin/alerts?severity=critical` - Filter by severity
- `GET /api/admin/alerts?farm_id=GR-00001` - Filter by farm
- `POST /api/admin/alerts/:id/acknowledge` - Acknowledge alert
- `POST /api/admin/alerts/:id/resolve` - Resolve alert

### Anomaly Detection
- `GET /api/schedule-executor/ml-anomalies` - Get ML-detected anomalies
- `GET /api/ml/metrics/alerts` - Get drift and degradation alerts

---

## Dashboard Views

### Alert Management Dashboard
- Shows: Active, acknowledged, resolved alerts
- KPIs: Total active, critical count, warnings, resolved today
- Actions: Acknowledge, resolve, trace to source
- Filters: By severity, status, farm

### Anomaly Detection Dashboard
- Shows: Recent anomalies with confidence scores
- KPIs: Total anomalies, critical count, acknowledged, detection rate
- Actions: Trace to source, acknowledge, investigate
- Filters: By severity, type (environmental, device, energy)

---

## Integration with Farm Operations

Both systems feed into:
- Farm performance dashboards
- Operator notification system
- Maintenance scheduling
- Quality control reports
- Compliance documentation

**Goal**: Minimize alerts by addressing anomalies early.
