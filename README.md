# Light Engine Charlie

Light Engine Charlie is a comprehensive platform for indoor farming automation, featuring both Node.js and Python backends for different deployment scenarios.

## 🌐 Live Demo

**View the live demo:** [https://greenreach2024.github.io/Light-Engine-Delta/](https://greenreach2024.github.io/Light-Engine-Delta/)

The demo includes:
- 2 Production Rooms with 8 zones
- 80 IoT Devices (lights, sensors, controllers)
- 320 Active Trays with 7,680 plants
- Real-time environmental monitoring
- E.V.I.E. AI guidance system
- Complete farm inventory and forecasting

## Quick Start

### Node.js Implementation (Dashboard & API)
1. Install dependencies and start the server.
2. Open the dashboard in a browser at http://127.0.0.1:8091.

```bash
npm install
npm run start
# or bind to a custom port
PORT=8089 npm run start
```

### Python Implementation (Device Discovery & Automation)
1. Install Python dependencies: `pip install -r requirements.txt`
2. Start the backend: `python -m backend`

### Demo Mode (Quick Evaluation)

Want to explore Light Engine without physical devices? Run the demo setup script:

```bash
./scripts/setup-demo.sh
npm start
# Open http://localhost:8091
```

This generates realistic farm data (rooms, zones, devices, inventory) in `public/data/` directory. The demo includes:
- **2 Production Rooms** with 4 zones each
- **Environmental Data**: Temperature, humidity, CO₂, VPD readings
- **82 Devices**: LED lights, sensors, actuators  
- **320 Active Trays**: 7,680 plants across lettuce, herbs, microgreens
- **Full Farm Hierarchy**: Farm → Rooms → Zones → Groups → Devices

**Deploy Demo to AWS/Cloud**:
```bash
# Generate demo data
./scripts/setup-demo.sh

# Copy to remote server
scp public/data/*.json ubuntu@YOUR_SERVER:~/Light-Engine-Delta/public/data/

# Restart server
ssh ubuntu@YOUR_SERVER 'pm2 restart light-engine'
```

The demo uses simple static JSON files - no middleware complexity, environment variables, or special configuration required!

## Architecture Overview

**Node.js Backend (`server-charlie.js`)**
- Primary dashboard server with web UI
- SwitchBot API integration with proper authentication
- Environmental monitoring and data visualization
- Device setup wizard and configuration management
- Live farm device discovery and control

**Python Backend (`backend/`)**
- Automated device discovery for TP-Link Kasa, MQTT, and SwitchBot
- Rules-driven automation engine
- Multi-protocol device management
- FastAPI-based REST endpoints

**Frontend Components**
- React/TypeScript device manager (`frontend/src/components/DeviceManager.tsx`)
- Device state management (`frontend/src/store/devices.ts`)
- Interactive dashboard with real-time monitoring

## Node.js Dashboard Features

### Standard Operating Procedure (SOP)

- Launch: Start the local server and confirm /healthz returns ok.
- Environment: Ensure /env returns zones with sensors; click a metric to view the 24h trend.
- Devices: Use device cards to view PPFD/DLI/energy. Research Mode reveals more controls.
- Groups: Use the zone summary card to see the paired LightGroup (photoperiod, ramps, spectrum, DLI via `/plans` + `/sched`) and EquipGroup (temperature/RH targets, hysteresis, dwell via `/env`) before editing rosters or applying changes.
- Guardrails: Offline devices are skipped with a toast. Payloads cap to 100% per channel.
- Persistence: UI saves to `/ui/<resource>` (backed by `public/data`) instead of the raw `/data/:name` helper to avoid collisions with controller endpoints.

### Live Farm Configuration
- **WiFi Network**: `greenreach` (password: `Farms2024`)
- **Device Discovery**: Scans for HLG, Spider Farmer, MARS HYDRO LED lights
- **Environmental Controls**: TrolMaster, AC Infinity, SwitchBot sensors
- **Power Monitoring**: Shelly Pro 4PM devices

### Smoke Test

Run the smoke test to verify key endpoints and assets.

```bash
npm run smoke
```

The script checks:
- GET /healthz
- GET /config
- GET /env
- GET /index.html
- POST /data/device-meta.json (dry-run to temp file)

### Ops: process manager & graceful shutdown

Use the included PM2 config to run both Node and Python backends under a process manager with health-aware restarts and graceful shutdown.

```bash
# Start both services under PM2
npm run start:pm2

# Inspect status and logs
pm2 status
pm2 logs

# Stop and remove from PM2
pm2 delete all
```

PM2 config: `ecosystem.config.cjs` (Node on port 8091, Python via uvicorn on port 8000).

Systemd units (optional): see `systemd/charlie-node.service` and `systemd/charlie-python.service` for running at boot on a Raspberry Pi or server.

Graceful shutdown is enabled: the server traps SIGINT/SIGTERM, stops schedulers, and closes listeners before exit.

### Tests and non-blocking test mode

To prevent hangs during ad‑hoc or CI test runs, the server supports a non‑blocking “test mode” that disables long‑running background loops.

- Set one of the following before starting tests (any of these enables test mode):
  - `NODE_ENV=test`
  - `CI=true`
  - `TEST_MODE=true` (or `TEST_MODE=1`)

When test mode is active, `server-charlie.js` will:
- Skip starting the PreAutomation engine
- Disable the Schedule Executor
- Skip weather polling and live sensor sync (and unref intervals when present)

Wizard behavior in test/CI:
- Kasa device discovery step short‑circuits to a fast stub to avoid real network scans. Unset the flags above to exercise real discovery.

Optional examples:

```bash
# Run Node’s built-in tests without background loops
TEST_MODE=true node --test

# Run a single test file
TEST_MODE=true node --test tests/wizard-flows.test.mjs
```

### Operator quick test

Before exercising Groups controls, run the combined preflight and scale probe helper:

```bash
./scripts/preflight-scale-probe.sh
```

The script executes the "preflight five" checks, validates CORS handling, and determines whether the controller expects the Grow3 `00-40` range or legacy `00-FF` channel scales (older `00-64` deployments remain backward compatible). See [`docs/operator-quick-test.md`](docs/operator-quick-test.md) for details and manual follow-up steps.

When the scale probe succeeds the chosen byte range is persisted to [`config/channel-scale.json`](config/channel-scale.json). The Node.js proxy, SpectraSync helpers, and Recipe Bridge all consume this file to keep payload math aligned.

## ML & AI Features

Light Engine Charlie includes a comprehensive machine learning system for predictive control and intelligent automation.

### Key Capabilities

- **📈 Predictive Forecasting**: 24-hour temperature predictions using SARIMAX models with 12 exogenous features
- **🚨 Anomaly Detection**: Real-time outlier detection with Isolation Forest algorithm
- **⚡ Energy Forecasting**: kWh predictions for lighting and HVAC based on schedules and climate
- **🤖 Automated Control**: Rules-based HVAC/lighting adjustments triggered by ML insights
- **🔄 Model Retraining**: Weekly automated retraining with A/B testing and rollback
- **📊 Performance Monitoring**: Drift detection, accuracy tracking (RMSE, MAE, MAPE), and health alerts

### ML Documentation

**Complete guides available**:
- [`ML_SYSTEM_OVERVIEW.md`](ML_SYSTEM_OVERVIEW.md) - Architecture, data flow, model specifications
- [`ML_API_REFERENCE.md`](ML_API_REFERENCE.md) - 20+ API endpoints with examples
- [`ML_DEPLOYMENT_GUIDE.md`](ML_DEPLOYMENT_GUIDE.md) - Production setup with PM2 cron jobs
- [`ML_TROUBLESHOOTING.md`](ML_TROUBLESHOOTING.md) - Debugging guide for common issues

### Quick Start (ML)

**Prerequisites**: Python 3.8+, Node.js 18+, 7+ days of sensor data

```bash
# Install ML dependencies
pip install -r requirements.txt

# Run health check
node scripts/ml-job-runner.js --health-check

# Generate forecast
node scripts/ml-job-runner.js --job forecast --zone main

# Check ML system status
curl http://localhost:8091/api/ml/metrics/health | python3 -m json.tool
```

**Scheduled Jobs (PM2)**:
- Anomaly detection: Hourly
- Forecasting: Every 2 hours
- Energy forecast: Daily at midnight
- Model retraining: Weekly (Sunday 2 AM)
- Metrics check: Hourly

**API Endpoints**:
- `GET /api/ml/forecast/:zone` - Get 24-hour temperature forecast
- `GET /api/ml/metrics/health` - Overall model health status
- `GET /api/anomalies/history` - Anomaly detection history
- `POST /api/energy/forecast` - Generate energy consumption forecast
- `POST /api/ml/retrain/:zone` - Trigger model retraining

### ML Performance Metrics

**Forecast Accuracy** (SARIMAX):
- Target RMSE: < 3.0°C for 24-hour predictions
- Confidence intervals: 95%
- Exogenous features: 12 (outdoor conditions, time, outdoor influence matrix)

**Anomaly Detection**:
- Algorithm: Isolation Forest with z-score threshold (2.5σ)
- Detection rate: ~10 events/day across 3 zones
- Severity levels: Warning (2.5-3.5σ), Critical (>3.5σ)

**Model Lifecycle**:
- Max model age: 7 days before retraining
- A/B testing: 10% → 100% gradual rollout
- Auto-rollback: If RMSE > 1.5x baseline

### Pre-AI Automation Layer

The pre-AI automation layer orchestrates smart plugs using real-time sensor data. It exposes REST endpoints on the primary Node.js server and persists telemetry for future ML training.

Key endpoints:

- `GET /env` – Returns the latest environmental scopes, including which rooms are currently governed by plug rules.
- `POST /env` – Submit sensor readings and target ranges for a scope (e.g., room) to keep the rules engine synchronized.
- `GET /plugs` / `POST /plugs/discover` – Enumerate Shelly, Kasa, SwitchBot, and manual Tasmota plugs across vendors via a unified schema.
- `POST /plugs/:plugId/state` – Toggle plug power state with guardrail enforcement.
- `POST /plugs/:plugId/rules` – Attach or detach automation rules from a plug, preserving vendor-agnostic guardrails such as cooldowns.
- `GET /rules` / `POST /rules` / `PATCH /rules/:id` / `DELETE /rules/:id` – Manage rule definitions that evaluate `when` thresholds and drive plug actions.

Telemetry written to `data/automation/events.ndjson` captures every state-action-result tuple:

```
timestamp, scope, ruleId, plugId, action, temp_before, rh_before, temp_after, rh_after, powerW
```

The dashboard now surfaces smart plug discovery, live power readings, and rule assignment under **Control Devices → Smart Plugs**, while an always-on “Centralized Automation” indicator in the header shows whether plug automation is active, idle, or degraded.

## Python Backend Configuration

### Environment Variables
* `ENVIRONMENT` – `production` by default; drives configuration defaults.
* `MQTT_HOST`, `MQTT_PORT`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_TOPICS` – configure MQTT discovery.
* `SWITCHBOT_TOKEN`, `SWITCHBOT_SECRET`, `SWITCHBOT_REGION` – enable SwitchBot Cloud discovery.
* `KASA_DISCOVERY_TIMEOUT` – discovery timeout in seconds (default `10`).
* `DISCOVERY_INTERVAL` – seconds between automatic discovery sweeps (default `300`).
* `TARGET_LUX`, `OCCUPIED_BRIGHTNESS`, `VACANT_BRIGHTNESS` – automation tuning parameters.

### Lighting Inventory
Defined in `data/lighting_inventory.yaml` with real fixture metadata for:
- HLG 550 V2 R-Spec LED grow lights
- Spider Farmer SF-7000
- MARS HYDRO FC-E6500
- Environmental sensors and controllers

Run the Python backend locally:

```bash
pip install -r requirements.txt  # ensure fastapi, uvicorn, paho-mqtt, python-kasa, requests, pyyaml are available
python -m backend
```

When the Node.js server (`npm start`) boots without a saved controller or `CTRL` override it now probes common local targets (default `http://127.0.0.1:8000`) and automatically points the proxy at a healthy Python backend. You can customise the probe list with `PY_BACKEND_URL` or tweak the timeout via `PY_BACKEND_HEALTH_TIMEOUT_MS`.

## SwitchBot Integration

### Direct API Access (Node.js)
- Proper HMAC-SHA256 signature generation
- v1.1 API endpoints with rate limiting
- Real device data (no mock fallbacks)
- Live status monitoring and control

### Environment Variables (do NOT commit these)
```bash
export SWITCHBOT_TOKEN=...   # from SwitchBot app
export SWITCHBOT_SECRET=...  # from SwitchBot app
export ZONE=LettuceRoom      # optional, default "SwitchBot"
export HOST=127.0.0.1        # optional, default 127.0.0.1
export PORT=8091             # optional, default 8091
```

### Direct SwitchBot Ingestion
```bash
npm run switchbot:once
# or loop every 10s
npm run switchbot:watch
```

Filter devices (optional):
```bash
INCLUDE_REGEX="CO2|TempHumid" npm run switchbot:once
EXCLUDE_REGEX="Button|Curtain" npm run switchbot:once
```

## Notes

- Research Mode is persisted in localStorage under `gr.researchMode`.
- Runtime config is available at /config and displayed as a chip in the header.
- Environment tiles show 12h sparklines, colored by setpoint status; click to open a larger 24h view.
- All mock/demo device fallbacks have been disabled to enforce live data only.
- Farm network discovery includes real lighting equipment and environmental controls.

## VPN + Forwarder workflow

When working over VPN with a Raspberry Pi forwarder:

- Mac dashboard server → http://127.0.0.1:8089 (your browser connects here)
- Mac dashboard CTRL → http://100.65.187.59:8089 (the Pi forwarder URL; replace with your Pi’s address)
- Pi forwarder target → http://192.168.2.80:3000 (the actual light controller)

On the Pi (forwarder):

```bash
# Foreground run so you can see [→] lines
PORT=8089 CTRL="http://192.168.2.80:3000" node forwarder.js
```

On your Mac (dashboard):

```bash
# Start Charlie bound to 8089 and pointing to the Pi forwarder
npm run start:vpn
```

Quick endpoint checks:

```bash
npm run smoke:8089   # test against 8089
npm run smoke:8091   # test against 8091
```

## Cloud Integration (AWS/Azure)

You can point the dashboard's `/env` endpoint to a cloud function (AWS Lambda, Azure Functions, etc.) that returns latest sensor readings. This enables centralized data processing and multi-site deployments.

### AWS Lambda Integration (Recommended)

See [docs/AWS_INTEGRATION.md](docs/AWS_INTEGRATION.md) for complete setup guide.

**Quick Start**:
```bash
# Set environment variables
export ENV_SOURCE=cloud
export AWS_ENDPOINT_URL="https://your-function.lambda-url.us-east-1.on.aws/"

# Or use .env file (see .env.example)
PORT=8091 node server-charlie.js
```

### Azure Functions (Legacy Support)

Azure Functions are still supported for backward compatibility:

```bash
# Example: local dev against your Function
export AZURE_LATEST_URL="https://<FUNC_NAME>.azurewebsites.net/api/env/latest"
export ENV_SOURCE=cloud
PORT=8091 node server-charlie.js
```

**Behavior**:
- When `ENV_SOURCE=cloud`, GET `/env` fetches from `CLOUD_ENDPOINT_URL` (or `AWS_ENDPOINT_URL` or `AZURE_LATEST_URL`)
- The server transforms results to the local `{ zones: [...] }` shape
- Maintains short in-memory histories per metric for sparklines
- `/config` and `/healthz` expose `envSource` and `cloudEndpointUrl` for visibility

**Troubleshooting**:
- If Azure is unreachable, /env returns HTTP 502 and, if available, serves the last cached values.
- Switch back to local file mode by unsetting ENV_SOURCE/AZURE_LATEST_URL.

## Direct SwitchBot ingestion (no Azure)

You can pull readings from SwitchBot OpenAPI and push directly into Charlie's `/env` endpoint.

Environment variables (do NOT commit these):

```bash
export SWITCHBOT_TOKEN=...   # from SwitchBot app
export SWITCHBOT_SECRET=...  # from SwitchBot app
export ZONE=LettuceRoom      # optional, default "SwitchBot"
export HOST=127.0.0.1        # optional, default 127.0.0.1
export PORT=8091             # optional, default 8091
```

Run once or watch:

```bash
npm run switchbot:once
# or loop every 10s
npm run switchbot:watch
```

Filter devices (optional):

```bash
INCLUDE_REGEX="CO2|TempHumid" npm run switchbot:once
EXCLUDE_REGEX="Button|Curtain" npm run switchbot:once
```

The script maps common SwitchBot device status fields into the telemetry schema `{ scope, sensors, ts, meta }`
and posts them to `/env`, which updates the in-memory telemetry store powering the HUD.

## Frontend Integration

### React/TypeScript Components
Integrate the device store by wrapping your application with `<DeviceProvider>` and include `<DeviceManager />` within the dashboard layout:

```typescript
import { DeviceProvider } from './store/devices';
import { DeviceManager } from './components/DeviceManager';

function App() {
  return (
    <DeviceProvider>
      <DeviceManager />
    </DeviceProvider>
  );
}
```
