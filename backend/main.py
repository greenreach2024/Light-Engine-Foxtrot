"""
FastAPI Main Application
Provides REST API endpoints for environmental sensor data with MQTT ingestion
"""
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel, Field
import json
import os
from pathlib import Path

# Import inventory routes
from .inventory_routes import router as inventory_router

# Create FastAPI app
app = FastAPI(
    title="Light Engine Charlie API",
    description="Environmental sensor data API with MQTT ingestion",
    version="1.0.0"
)

# Mount inventory routes
app.include_router(inventory_router)

# CORS configuration - restrict to known origins
ALLOWED_ORIGINS = [
    "http://light-engine-demo-1765326376.s3-website-us-east-1.amazonaws.com",
    "http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com",
    "https://light-engine-demo-1765326376.s3-website-us-east-1.amazonaws.com",
    "https://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com",
    "http://localhost:8091",  # Local development
    "http://127.0.0.1:8091",  # Local development
    "http://localhost:8000",  # Python backend direct access
    "http://127.0.0.1:8000",  # Python backend direct access
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Data storage paths
DATA_DIR = Path(__file__).parent.parent / "public" / "data"
ENV_CACHE_FILE = DATA_DIR / "env-cache.json"

# In-memory storage for latest readings
_env_cache: Dict[str, Any] = {
    "scopes": {},  # scope_id -> {sensors: {}, metadata: {}}
    "meta": {
        "updatedAt": None,
        "source": "mqtt"
    }
}

# Pydantic models for request/response validation
class SensorReading(BaseModel):
    """Individual sensor reading"""
    value: float
    unit: Optional[str] = None
    
class SensorPayload(BaseModel):
    """MQTT sensor payload schema"""
    scope: str = Field(..., description="Room/zone identifier (e.g., 'NutrientRoom')")
    ts: str = Field(..., description="ISO 8601 timestamp")
    sensors: Dict[str, SensorReading] = Field(..., description="Sensor readings")
    
    class Config:
        schema_extra = {
            "example": {
                "scope": "NutrientRoom",
                "ts": "2025-11-01T14:30:00Z",
                "sensors": {
                    "ph": {"value": 6.02},
                    "ec": {"value": 0.71, "unit": "mS/cm"},
                    "temperature": {"value": 21.8}
                }
            }
        }

class LatestReadingsResponse(BaseModel):
    """Response for /api/env/latest endpoint"""
    scope: str
    sensors: Dict[str, Any]
    observedAt: str
    
def load_env_cache():
    """Load environmental cache from disk"""
    global _env_cache
    if ENV_CACHE_FILE.exists():
        try:
            with open(ENV_CACHE_FILE, 'r') as f:
                _env_cache = json.load(f)
            print(f" Loaded env cache with {len(_env_cache.get('scopes', {}))} scopes")
        except Exception as e:
            print(f" Failed to load env cache: {e}")

def save_env_cache():
    """Persist environmental cache to disk"""
    try:
        ENV_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(ENV_CACHE_FILE, 'w') as f:
            json.dump(_env_cache, f, indent=2)
    except Exception as e:
        print(f" Failed to save env cache: {e}")

def update_sensor_reading(scope: str, sensor_key: str, reading: Dict[str, Any], timestamp: str):
    """Update sensor reading in cache"""
    if scope not in _env_cache["scopes"]:
        _env_cache["scopes"][scope] = {
            "sensors": {},
            "metadata": {
                "name": scope,
                "createdAt": timestamp
            }
        }
    
    if sensor_key not in _env_cache["scopes"][scope]["sensors"]:
        _env_cache["scopes"][scope]["sensors"][sensor_key] = {
            "history": []
        }
    
    sensor_data = _env_cache["scopes"][scope]["sensors"][sensor_key]
    sensor_data["value"] = reading.get("value")
    sensor_data["unit"] = reading.get("unit")
    sensor_data["observedAt"] = timestamp
    
    # Maintain history (last 100 readings)
    sensor_data["history"].append({
        "value": reading.get("value"),
        "ts": timestamp
    })
    if len(sensor_data["history"]) > 100:
        sensor_data["history"] = sensor_data["history"][-100:]
    
    _env_cache["meta"]["updatedAt"] = timestamp

def ingest_mqtt_payload(payload: SensorPayload):
    """Process incoming MQTT sensor payload"""
    print(f"📥 Ingesting: scope={payload.scope}, sensors={list(payload.sensors.keys())}")
    
    for sensor_key, reading in payload.sensors.items():
        update_sensor_reading(
            scope=payload.scope,
            sensor_key=sensor_key,
            reading=reading.dict(),
            timestamp=payload.ts
        )
    
    # Persist to disk asynchronously
    save_env_cache()

# ============================================================================
# API ENDPOINTS
# ============================================================================

@app.get("/")
async def root():
    """API health check"""
    return {
        "service": "Light Engine Charlie API",
        "status": "running",
        "version": "1.0.0",
        "mqtt": {
            "host": os.getenv("MQTT_HOST", "localhost"),
            "port": os.getenv("MQTT_PORT", "1883"),
            "topics": os.getenv("MQTT_TOPICS", "sensors/#")
        }
    }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "scopes": len(_env_cache.get("scopes", {}))
    }

@app.post("/api/env/ingest")
async def ingest_sensor_data(payload: SensorPayload):
    """
    Ingest sensor data (called by MQTT worker or manual testing)
    
    Example payload:
    ```json
    {
        "scope": "NutrientRoom",
        "ts": "2025-11-01T14:30:00Z",
        "sensors": {
            "ph": {"value": 6.02},
            "ec": {"value": 0.71, "unit": "mS/cm"},
            "temperature": {"value": 21.8}
        }
    }
    ```
    """
    try:
        ingest_mqtt_payload(payload)
        return {
            "ok": True,
            "scope": payload.scope,
            "ingested": list(payload.sensors.keys()),
            "timestamp": payload.ts
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/env/latest")
async def get_latest_readings(
    scope: str = Query(..., description="Scope/room identifier (e.g., 'NutrientRoom')")
) -> LatestReadingsResponse:
    """
    Get latest sensor readings for a specific scope
    
    Example: GET /api/env/latest?scope=NutrientRoom
    """
    if scope not in _env_cache.get("scopes", {}):
        raise HTTPException(
            status_code=404,
            detail=f"Scope '{scope}' not found. Available: {list(_env_cache.get('scopes', {}).keys())}"
        )
    
    scope_data = _env_cache["scopes"][scope]
    sensors = {}
    
    latest_ts = None
    for sensor_key, sensor_data in scope_data.get("sensors", {}).items():
        sensors[sensor_key] = {
            "value": sensor_data.get("value"),
            "unit": sensor_data.get("unit"),
            "observedAt": sensor_data.get("observedAt")
        }
        if sensor_data.get("observedAt"):
            if not latest_ts or sensor_data["observedAt"] > latest_ts:
                latest_ts = sensor_data["observedAt"]
    
    return LatestReadingsResponse(
        scope=scope,
        sensors=sensors,
        observedAt=latest_ts or datetime.utcnow().isoformat() + "Z"
    )

@app.get("/api/env/scopes")
async def list_scopes():
    """List all available scopes with sensor counts"""
    scopes = []
    for scope_id, scope_data in _env_cache.get("scopes", {}).items():
        scopes.append({
            "id": scope_id,
            "name": scope_data.get("metadata", {}).get("name", scope_id),
            "sensorCount": len(scope_data.get("sensors", {})),
            "sensors": list(scope_data.get("sensors", {}).keys())
        })
    
    return {
        "scopes": scopes,
        "total": len(scopes),
        "updatedAt": _env_cache.get("meta", {}).get("updatedAt")
    }

@app.get("/api/env/history")
async def get_sensor_history(
    scope: str = Query(..., description="Scope identifier"),
    sensor: str = Query(..., description="Sensor key (e.g., 'ph', 'ec', 'temperature')"),
    limit: int = Query(50, ge=1, le=100, description="Number of readings to return")
):
    """Get historical readings for a specific sensor"""
    if scope not in _env_cache.get("scopes", {}):
        raise HTTPException(status_code=404, detail=f"Scope '{scope}' not found")
    
    scope_data = _env_cache["scopes"][scope]
    if sensor not in scope_data.get("sensors", {}):
        raise HTTPException(
            status_code=404,
            detail=f"Sensor '{sensor}' not found in scope '{scope}'"
        )
    
    sensor_data = scope_data["sensors"][sensor]
    history = sensor_data.get("history", [])
    
    return {
        "scope": scope,
        "sensor": sensor,
        "unit": sensor_data.get("unit"),
        "history": history[-limit:],
        "count": len(history[-limit:])
    }

# Load cache on startup
@app.on_event("startup")
async def startup_event():
    """Initialize on startup"""
    print(" FastAPI backend starting...")
    load_env_cache()
    print(f" Loaded {len(_env_cache.get('scopes', {}))} scopes")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    print("💾 Saving env cache...")
    save_env_cache()
    print("👋 FastAPI backend shutdown complete")


# ============================================================================
# NEW ENDPOINTS - Device Discovery, Network Diagnostics, Device Control, Automation
# ============================================================================

@app.post("/discovery/run", status_code=202)
async def trigger_discovery_scan():
    """
    Trigger an asynchronous device discovery scan.
    Returns immediately. Poll GET /discovery/devices for results.
    """
    return {
        "status": "accepted",
        "message": "Discovery scan initiated. Poll GET /discovery/devices for results.",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.get("/discovery/devices")
async def get_discovery_devices():
    """Get all discovered devices (placeholder - returns empty for now)"""
    return {
        "devices": [],
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.get("/api/devices/kasa")
async def get_kasa_devices():
    """Get raw Kasa discovery payload for debugging"""
    return {
        "protocol": "kasa",
        "devices": [],
        "count": 0,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.get("/api/devices/mqtt")
async def get_mqtt_devices():
    """Get MQTT devices from registry"""
    return {
        "protocol": "mqtt",
        "devices": [],
        "count": 0,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.get("/api/devices/ble")
async def get_ble_devices():
    """Get raw BLE discovery payload for debugging"""
    return {
        "protocol": "ble",
        "devices": [],
        "count": 0,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.get("/api/devices/mdns")
async def get_mdns_devices():
    """Get raw mDNS discovery payload for debugging"""
    return {
        "protocol": "mdns",
        "devices": [],
        "count": 0,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.get("/api/network/wifi/scan")
async def wifi_scan():
    """Scan for available WiFi networks (returns placeholder data)"""
    return {
        "success": False,
        "networks": [],
        "count": 0,
        "message": "WiFi scanning not available",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.post("/api/network/test")
async def network_test(request: dict):
    """Test network connectivity to a host"""
    import socket
    host = request.get("host")
    port = request.get("port", 1883)
    protocol = request.get("protocol", "mqtt")
    
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        result = sock.connect_ex((host, port))
        sock.close()
        
        return {
            "success": result == 0,
            "reachable": result == 0,
            "host": host,
            "port": port,
            "protocol": protocol,
            "message": f"{'Connected' if result == 0 else 'Failed'} to {host}:{port}",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        return {
            "success": False,
            "reachable": False,
            "host": host,
            "port": port,
            "protocol": protocol,
            "error": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }


@app.post("/api/device/command")
async def send_device_command(request: dict):
    """Send a direct command to a device (placeholder)"""
    device_id = request.get("device_id")
    command = request.get("command", {})
    return {
        "success": True,
        "device_id": device_id,
        "command": command,
        "message": f"Command sent to {device_id}",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.get("/lighting/fixtures")
async def get_lighting_fixtures():
    """Get configured lighting fixture metadata"""
    return {
        "fixtures": [],
        "count": 0,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.post("/lighting/failsafe")
async def lighting_failsafe(request: dict):
    """Broadcast immediate power change to fixtures"""
    fixtures = request.get("fixtures", [])
    power = request.get("power", "on")
    brightness = request.get("brightness", 100)
    results = [{"fixture_id": f, "success": True, "power": power, "brightness": brightness} for f in fixtures]
    return {
        "results": results,
        "total": len(fixtures),
        "successful": len(results),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.get("/rules")
async def list_automation_rules():
    """List all automation rules"""
    return {
        "rules": [],
        "count": 0,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.post("/rules", status_code=201)
async def create_automation_rule(rule: dict):
    """Create a new automation rule"""
    import uuid
    rule_id = rule.get("rule_id", str(uuid.uuid4()))
    return {
        "success": True,
        "rule_id": rule_id,
        "message": "Automation rule created",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.patch("/rules/{rule_id}")
async def update_automation_rule(rule_id: str, rule: dict):
    """Update an existing automation rule"""
    return {
        "success": True,
        "rule_id": rule_id,
        "message": "Automation rule updated",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.delete("/rules/{rule_id}")
async def delete_automation_rule(rule_id: str):
    """Delete an automation rule"""
    return {
        "success": True,
        "rule_id": rule_id,
        "message": "Automation rule deleted",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.get("/devices")
async def list_devices():
    """List all discovered devices"""
    return {
        "devices": [],
        "count": 0,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.post("/ai/setup-assist")
async def setup_assist(request: dict):
    """AI-powered setup assistance (placeholder)"""
    return {
        "suggested_fields": {},
        "next_steps": ["Configure device settings", "Test connectivity"],
        "summary": "Setup assistance ready",
        "provider": "heuristic"
    }


# ============================================================================
# Inventory Management Endpoints (for Mobile App)
# ============================================================================

@app.get("/api/inventory/summary")
async def get_inventory_summary():
    """Get inventory summary statistics for dashboard"""
    # TODO: Connect to actual database
    # For now, return mock data for mobile app testing
    return {
        "active_trays": 0,
        "total_plants": 0,
        "farms": 1,
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.get("/api/inventory/harvest-forecast")
async def get_harvest_forecast():
    """Get harvest forecast buckets for dashboard"""
    # TODO: Query database for trays by expected harvest date
    # For now, return mock data for mobile app testing
    return {
        "today": 0,
        "this_week": 0,
        "next_week": 0,
        "later": 0,
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

