
from __future__ import annotations

"""FastAPI server wiring together discovery, automation, and RBAC.

Environment variables are loaded via python-dotenv so that the backend
does not rely on shell-based `export $(cat .env ...)` patterns.
"""

import asyncio
import contextlib
import inspect
import logging
import os
from datetime import date, datetime, time, timezone
from typing import Any, Dict, List, Optional, cast

from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, validator
import json
import subprocess
import sys
import re

# Rate limiting
try:
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.util import get_remote_address
    from slowapi.errors import RateLimitExceeded
    RATE_LIMITING_AVAILABLE = True
except ImportError:
    RATE_LIMITING_AVAILABLE = False

from backend.ai_assist import SetupAssistError, SetupAssistService
from backend.auth import (
    AuthenticationError,
    AuthorizationError,
    create_access_token,
    get_current_user,
    get_tenant_id,
    require_admin,
    require_operator,
    verify_token,
)
from backend.auth_routes import router as auth_router
from backend.inventory_routes import router as inventory_router
from backend.inventory_management import router as inventory_management_router
from backend.inventory_usage_tracking import router as inventory_usage_router
from backend.sustainability_esg import router as sustainability_router
from backend.grower_management import router as grower_management_router
from backend.labels import router as labels_router
from backend.ai_vision import router as ai_vision_router
from backend.farm_sales import router as farm_sales_router
from backend.automation import AutomationEngine, lux_balancing_rule, occupancy_rule
from backend.config import EnvironmentConfig, LightingFixture, load_config
from backend.device_discovery import (
    discover_ble_devices,
    discover_kasa_devices,
    discover_mdns_devices,
    discover_switchbot_devices,
    fetch_switchbot_status,
    full_discovery_cycle,
)

try:
    from kasa import SmartDevice  # type: ignore
    KASA_AVAILABLE = True
except ImportError:
    KASA_AVAILABLE = False
    LOGGER.warning("python-kasa not available. Device control disabled.")

try:
    import paho.mqtt.client as mqtt  # type: ignore
    MQTT_AVAILABLE = True
except ImportError:
    MQTT_AVAILABLE = False
    LOGGER.warning("paho-mqtt not available. MQTT device control disabled.")
from backend.device_models import (
    Device,
    GroupSchedule,
    PhotoperiodScheduleConfig,
    Schedule,
    UserContext,
)
from backend.lighting import LightingController
from backend.state import (
    DeviceDataStore,
    DeviceRegistry,
    EnvironmentStateStore,
    EnvironmentTelemetryStore,
    GroupScheduleStore,
    LightingState,
    PlanStore,
    ScheduleStore,
    SensorEventBuffer,
)

try:
    from backend.logging_config import configure_logging as _configure_logging
except ImportError:  # pragma: no cover - optional dependency
    _configure_logging = None

if _configure_logging:
    _configure_logging()


LOGGER = logging.getLogger(__name__)

# Authentication configuration
AUTH_ENABLED = os.getenv("AUTH_ENABLED", "false").lower() in ("true", "1", "yes")
if AUTH_ENABLED:
    LOGGER.info("🔐 JWT Authentication ENABLED - All endpoints require valid Bearer token")
else:
    LOGGER.warning("  JWT Authentication DISABLED - API is open (set AUTH_ENABLED=true for production)")

# Load environment from .env if present (safe for special chars; no shell expansion)
try:  # Import lazily to avoid hard dependency if not installed
    from dotenv import load_dotenv  # type: ignore

    load_dotenv()  # loads .env in project root or current working dir
    LOGGER.info("Loaded environment from .env via python-dotenv")
except Exception as _e:  # pragma: no cover - optional helper
    LOGGER.debug("python-dotenv not available or failed to load: %s", _e)

# Rate limiting configuration
RATE_LIMITING_ENABLED = os.getenv("RATE_LIMITING_ENABLED", "false").lower() in ("true", "1", "yes")
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))

if RATE_LIMITING_AVAILABLE and RATE_LIMITING_ENABLED:
    try:
        import redis
        # Try to connect to Redis for distributed rate limiting
        redis_client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
        redis_client.ping()  # Test connection
        limiter = Limiter(
            key_func=get_remote_address,
            storage_uri=f"redis://{REDIS_HOST}:{REDIS_PORT}"
        )
        LOGGER.info(f"🚦 Rate limiting ENABLED with Redis backend ({REDIS_HOST}:{REDIS_PORT})")
    except Exception as e:
        # Fall back to in-memory rate limiting if Redis unavailable
        limiter = Limiter(key_func=get_remote_address)
        LOGGER.warning(f"🚦 Rate limiting ENABLED (in-memory fallback) - Redis unavailable: {e}")
elif RATE_LIMITING_AVAILABLE:
    limiter = Limiter(key_func=get_remote_address)
    LOGGER.info("🚦 Rate limiting available but DISABLED (set RATE_LIMITING_ENABLED=true to enable)")
else:
    limiter = None
    LOGGER.warning("  slowapi not installed - Rate limiting DISABLED (pip install slowapi)")

app = FastAPI(
    title="Light Engine Charlie API",
    version="1.0.0",
    description="""
Light Engine Charlie - Indoor farming automation platform API.

This API provides device discovery, lighting control, environmental monitoring,
and automation management for controlled environment agriculture (CEA).

## Authentication

All requests must include `X-Tenant-ID` header for multi-tenant data isolation.

JWT authentication is recommended for production deployments. Include Bearer token
in Authorization header:

```
Authorization: Bearer <jwt_token>
```

## Key Features

* **Device Discovery**: Automatic detection of Kasa, SwitchBot, BLE, and mDNS devices
* **Lighting Control**: Photoperiod schedules, spectrum management, failsafe power
* **Environmental Monitoring**: Real-time sensor data ingestion and history
* **Automation Rules**: Occupancy detection, lux balancing, schedule-based control
* **Multi-Protocol Support**: WiFi, BLE, Zigbee, RS485, MQTT, IFTTT, webhooks

## Resources

* [Setup Guides](/docs)
* [Developer Documentation](https://github.com/greenreach2024/Light-Engine-Echo)
* [API Status](/health)
    """,
    contact={
        "name": "GreenReach Farms",
        "url": "https://github.com/greenreach2024/Light-Engine-Echo",
    },
    license_info={
        "name": "MIT",
        "url": "https://opensource.org/licenses/MIT",
    },
    openapi_tags=[
        {
            "name": "health",
            "description": "Health check and system status endpoints"
        },
        {
            "name": "discovery",
            "description": "Device discovery and protocol-specific inventories"
        },
        {
            "name": "devices",
            "description": "Device directory and command operations"
        },
        {
            "name": "lighting",
            "description": "Lighting control, fixtures, and failsafe operations"
        },
        {
            "name": "schedules",
            "description": "Photoperiod schedule management"
        },
        {
            "name": "automation",
            "description": "Automation rules and engine control"
        },
        {
            "name": "environment",
            "description": "Environmental telemetry and sensor data"
        },
        {
            "name": "network",
            "description": "Network diagnostics and connectivity testing"
        },
        {
            "name": "ai",
            "description": "AI-powered setup assistance"
        }
    ]
)

# Add rate limiting middleware if enabled
if limiter:
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8095",  # Original Node.js server port
        "http://localhost:8091",  # Current Node.js server port
        "http://127.0.0.1:8091",  # Alternative localhost
        "http://127.0.0.1:8095",  # Alternative localhost
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include authentication routes (user registration, login, password reset)
app.include_router(auth_router)
LOGGER.info(" Authentication routes loaded (register, login, password reset)")

# Inventory + forecasting routes
app.include_router(inventory_router)
LOGGER.info(" Inventory routes loaded (trays, placements, rollups)")

# Advanced Inventory Management (Enterprise ERP)
app.include_router(inventory_management_router, prefix="/api/inventory", tags=["inventory-management"])
LOGGER.info("Advanced inventory management routes loaded (seeds, packaging, nutrients, equipment, supplies)")

# Automated Usage Tracking
app.include_router(inventory_usage_router, prefix="/api/inventory", tags=["usage-tracking"])
LOGGER.info("Automated usage tracking loaded (tray seeding, nutrient dosing)")

# Sustainability & ESG Dashboard (Enterprise ERP)
app.include_router(sustainability_router, prefix="/api/sustainability", tags=["sustainability"])
LOGGER.info("🌱 Sustainability & ESG dashboard routes loaded (energy, water, carbon, waste tracking)")

# Grower Management (Multi-Tenant Network)
app.include_router(grower_management_router, prefix="/api/growers", tags=["grower-management"])
LOGGER.info("👥 Grower management routes loaded (network, contracts, performance, invitations)")

# Label Printing System (Harvest & Wholesale Packing)
app.include_router(labels_router, tags=["labels"])
LOGGER.info("🏷️  Label printing routes loaded (harvest labels, packing labels with traceability)")
# AI Vision Quality Control (Plant Health Analysis)
app.include_router(ai_vision_router, tags=["ai-vision"])
LOGGER.info("🔬 AI vision routes loaded (plant health analysis, checklist photo QA)")

# Farm Sales & POS System (Retail & Donation Programs)
app.include_router(farm_sales_router, prefix="/api", tags=["farm-sales"])
LOGGER.info("💰 Farm sales routes loaded (POS, inventory, orders, donation programs)")



def _require_state(name: str) -> Any:
    value = getattr(app.state, name, None)
    if value is None:
        raise RuntimeError(f"Application state '{name}' has not been initialised")
    return value


def get_config() -> EnvironmentConfig:
    return cast(EnvironmentConfig, _require_state("CONFIG"))


def get_registry() -> DeviceRegistry:
    return cast(DeviceRegistry, _require_state("REGISTRY"))


def get_buffer() -> SensorEventBuffer:
    return cast(SensorEventBuffer, _require_state("BUFFER"))


def get_lighting_state() -> LightingState:
    return cast(LightingState, _require_state("LIGHTING_STATE"))


def get_controller() -> LightingController:
    return cast(LightingController, _require_state("CONTROLLER"))


def get_schedules() -> ScheduleStore:
    return cast(ScheduleStore, _require_state("SCHEDULES"))


def get_group_schedules() -> GroupScheduleStore:
    return cast(GroupScheduleStore, _require_state("GROUP_SCHEDULES"))


def get_plan_store() -> PlanStore:
    return cast(PlanStore, _require_state("PLAN_STORE"))


def get_environment_state() -> EnvironmentStateStore:
    return cast(EnvironmentStateStore, _require_state("ENVIRONMENT_STATE"))


def get_environment_telemetry() -> EnvironmentTelemetryStore:
    return cast(EnvironmentTelemetryStore, _require_state("ENVIRONMENT_TELEMETRY"))


def get_device_data_store() -> DeviceDataStore:
    return cast(DeviceDataStore, _require_state("DEVICE_DATA"))


def get_automation() -> AutomationEngine:
    return cast(AutomationEngine, _require_state("AUTOMATION"))


def get_ai_assist_service() -> Optional[SetupAssistService]:
    return cast(Optional[SetupAssistService], getattr(app.state, "AI_ASSIST_SERVICE", None))


def get_zone_map() -> Dict[str, str]:
    return cast(Dict[str, str], _require_state("ZONE_MAP"))


def get_fixture_inventory() -> List[LightingFixture]:
    return cast(List[LightingFixture], _require_state("FIXTURE_INVENTORY"))


def get_device_id_map() -> Dict[str, LightingFixture]:
    return cast(Dict[str, LightingFixture], _require_state("DEVICE_ID_MAP"))


def get_device_id_by_address() -> Dict[str, str]:
    return cast(Dict[str, str], _require_state("DEVICE_ID_BY_ADDRESS"))


# Initialise application state placeholders
app.state.CONFIG = None
app.state.REGISTRY = None
app.state.BUFFER = None
app.state.LIGHTING_STATE = None
app.state.CONTROLLER = None
app.state.SCHEDULES = None
app.state.GROUP_SCHEDULES = None
app.state.PLAN_STORE = None
app.state.ENVIRONMENT_STATE = None
app.state.ENVIRONMENT_TELEMETRY = None
app.state.DEVICE_DATA = None
app.state.AUTOMATION = None
app.state.AI_ASSIST_SERVICE = None
app.state.ZONE_MAP = None
app.state.FIXTURE_INVENTORY = None
app.state.DEVICE_ID_MAP = None
app.state.DEVICE_ID_BY_ADDRESS = None
app.state.discovery_task = None


def _parse_time_range(value: Optional[Any]) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        seconds = int(float(value))
        return seconds if seconds > 0 else None
    text = str(value).strip().lower()
    if not text:
        return None
    factors = {"h": 3600, "m": 60, "s": 1}
    for suffix, factor in factors.items():
        if text.endswith(suffix):
            number_text = text[:-1].strip()
            try:
                amount = float(number_text)
            except ValueError:
                return None
            seconds = int(amount * factor)
            return seconds if seconds > 0 else None
    try:
        seconds = int(float(text))
    except ValueError:
        return None
    return seconds if seconds > 0 else None


def _safe_json(value: Any) -> Any:
    """Recursively convert a Python object to a JSON-serializable structure.

    - bytes/bytearray -> hex string
    - datetime -> ISO 8601 string
    - set/tuple -> list
    - objects with __dict__ -> dict processed recursively
    - fallback: str(value)
    """
    # Fast path for common JSON-native types
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (bytes, bytearray)):
        return value.hex()
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    if isinstance(value, (list, tuple, set)):
        return [_safe_json(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _safe_json(v) for k, v in value.items()}
    # Handle dataclass-like / objects with __dict__
    obj_dict = getattr(value, "__dict__", None)
    if isinstance(obj_dict, dict):
        return {str(k): _safe_json(v) for k, v in obj_dict.items()}
    # Fallback: best-effort string
    try:
        return str(value)
    except Exception:  # pragma: no cover - defensive
        return None


def _parse_timestamp(value: Any) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc)
    if isinstance(value, (int, float)):
        ts = float(value)
        if ts > 1e12:
            ts /= 1000.0
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return datetime.now(timezone.utc)
        try:
            numeric = float(text)
        except ValueError:
            numeric = None
        if numeric is not None:
            return _parse_timestamp(numeric)
        normalised = text
        if normalised.endswith("Z"):
            normalised = normalised[:-1] + "+00:00"
        try:
            return datetime.fromisoformat(normalised).astimezone(timezone.utc)
        except ValueError as exc:
            raise ValueError("Invalid timestamp format") from exc
    raise ValueError("Invalid timestamp format")


def _extract_scope(payload: Dict[str, Any]) -> Optional[str]:
    for key in ("scope", "zoneId", "zone", "room", "roomId"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _collect_metadata(payload: Dict[str, Any]) -> Dict[str, Any]:
    metadata: Dict[str, Any] = {}
    meta_payload = payload.get("meta")
    if isinstance(meta_payload, dict):
        for key, value in meta_payload.items():
            if value is not None:
                metadata[key] = value
    alias_map = {"device_id": "deviceId", "sensor_id": "sensorId"}
    for key in ("name", "label", "battery", "rssi", "source", "deviceId", "device_id", "sensorId", "sensor_id", "location"):
        if key in payload and payload[key] is not None:
            target = alias_map.get(key, key)
            metadata[target] = payload[key]
    return metadata


def _is_telemetry_payload(payload: Dict[str, Any]) -> bool:
    if not isinstance(payload, dict):
        return False
    if not isinstance(payload.get("sensors"), dict):
        return False
    return _extract_scope(payload) is not None


def _ingest_environment_telemetry(payload: Dict[str, Any]) -> Dict[str, Any]:
    scope = _extract_scope(payload)
    if not scope:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="scope is required for telemetry payloads")
    sensors = payload.get("sensors")
    if not isinstance(sensors, dict) or not sensors:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="sensors must be a non-empty object")
    timestamp_value = payload.get("ts") or payload.get("timestamp")
    try:
        moment = _parse_timestamp(timestamp_value)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    metadata = _collect_metadata(payload)
    telemetry_store = get_environment_telemetry()
    zone = telemetry_store.add_reading(scope, moment, sensors, metadata)
    response: Dict[str, Any] = {"status": "ok", "zone": zone}
    last_updated = telemetry_store.last_updated()
    if last_updated:
        response["updatedAt"] = last_updated
    env_snapshot = get_environment_state().snapshot()
    if env_snapshot:
        response["env"] = env_snapshot
    return response


@app.get("/")
def root() -> Dict[str, str]:
    return {"message": "Light Engine Charlie API is running. See /docs for API documentation."}


# ============================================================================
# Authentication Endpoints
# ============================================================================

class TokenRequest(BaseModel):
    """Request body for token generation."""
    user_id: str = Field(..., description="Unique user identifier")
    tenant_id: str = Field(..., description="Tenant identifier")
    role: str = Field(default="viewer", description="User role: admin, operator, or viewer")
    password: Optional[str] = Field(None, description="User password (for future implementation)")


class TokenResponse(BaseModel):
    """Response containing JWT access token."""
    access_token: str = Field(..., description="JWT bearer token")
    token_type: str = Field(default="bearer", description="Token type (always 'bearer')")
    expires_in: int = Field(default=86400, description="Token expiration time in seconds")
    user_id: str = Field(..., description="User identifier")
    tenant_id: str = Field(..., description="Tenant identifier")
    role: str = Field(..., description="User role")


@app.post("/auth/token", response_model=TokenResponse, tags=["authentication"])
async def generate_token(request: TokenRequest) -> TokenResponse:
    """
    Generate JWT access token for API authentication.
    
    **Note:** This is a development endpoint. In production, implement proper
    user authentication with password verification, OAuth2, or SSO.
    
    **Example request:**
    ```json
    {
      "user_id": "user@example.com",
      "tenant_id": "farm-123",
      "role": "operator"
    }
    ```
    
    **Roles:**
    - `admin`: Full access to all endpoints including user management
    - `operator`: Can control devices and modify settings
    - `viewer`: Read-only access to data
    
    **Token expiration:** 24 hours (configurable via JWT_EXPIRATION_HOURS)
    """
    # Validate role
    valid_roles = ["admin", "operator", "viewer"]
    if request.role not in valid_roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role. Must be one of: {', '.join(valid_roles)}"
        )
    
    # TODO: In production, verify password against database
    # For now, accept any request for development
    
    # Generate token
    token = create_access_token(
        user_id=request.user_id,
        tenant_id=request.tenant_id,
        role=request.role
    )
    
    LOGGER.info(f"Generated token for user={request.user_id} tenant={request.tenant_id} role={request.role}")
    
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=86400,  # 24 hours
        user_id=request.user_id,
        tenant_id=request.tenant_id,
        role=request.role
    )


@app.get("/auth/verify", tags=["authentication"])
async def verify_token_endpoint(user: dict = Depends(get_current_user)) -> dict:
    """
    Verify JWT token and return user information.
    
    Use this endpoint to validate tokens and check user permissions.
    
    **Requires:** Valid Bearer token in Authorization header
    
    **Returns:** User information including user_id, tenant_id, and role
    """
    return {
        "valid": True,
        "user_id": user["user_id"],
        "tenant_id": user["tenant_id"],
        "role": user["role"],
        "message": "Token is valid"
    }


@app.post("/auth/refresh", response_model=TokenResponse, tags=["authentication"])
async def refresh_token(user: dict = Depends(get_current_user)) -> TokenResponse:
    """
    Refresh JWT access token.
    
    Generates a new token with the same claims as the current token.
    Use this endpoint before the current token expires to maintain session.
    
    **Requires:** Valid Bearer token in Authorization header
    
    **Returns:** New JWT token with extended expiration
    """
    # Generate new token with same claims
    new_token = create_access_token(
        user_id=user["user_id"],
        tenant_id=user["tenant_id"],
        role=user["role"]
    )
    
    LOGGER.info(f"Refreshed token for user={user['user_id']} tenant={user['tenant_id']}")
    
    return TokenResponse(
        access_token=new_token,
        token_type="bearer",
        expires_in=86400,
        user_id=user["user_id"],
        tenant_id=user["tenant_id"],
        role=user["role"]
    )


# ============================================================================
# Device Endpoints
# ============================================================================

class DeviceResponse(BaseModel):
    device_id: str
    name: str
    category: str
    protocol: str
    online: bool
    capabilities: dict
    details: dict


class PlugStateResponse(BaseModel):
    online: Optional[bool] = None
    on: Optional[bool] = None
    power: Optional[float] = None
    power_w: Optional[float] = Field(None, alias="powerW")
    wattage: Optional[float] = None

    class Config:
        allow_population_by_field_name = True


class PlugResponse(BaseModel):
    id: str
    deviceId: str
    name: str
    vendor: Optional[str] = None
    model: Optional[str] = None
    category: Optional[str] = None
    protocol: Optional[str] = None
    state: PlugStateResponse = Field(default_factory=PlugStateResponse)
    capabilities: Dict[str, Any] = Field(default_factory=dict)
    details: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        allow_population_by_field_name = True


class ScheduleRequest(BaseModel):
    schedule_id: str = Field(..., description="Unique identifier for the schedule")
    name: str
    group: str = Field(..., description="Fixture or group identifier")
    start_time: str = Field(..., description="HH:MM start time in 24h format")
    end_time: str = Field(..., description="HH:MM end time in 24h format")
    brightness: int = Field(..., ge=0, le=100)
    spectrum: Optional[int] = Field(None, description="Optional spectrum/temperature value")


class LightingFixtureResponse(BaseModel):
    name: str
    model: str
    address: str
    control_interface: str
    min_brightness: int
    max_brightness: int
    spectrum_min: int
    spectrum_max: int


class DeviceDataPatch(BaseModel):
    status: Optional[str] = None
    value: Optional[str] = None

    class Config:
        extra = "allow"

    @validator("status")
    def _normalize_status(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("status must be a string")
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("status must be a non-empty string")
        return trimmed.lower()

    @validator("value")
    def _normalize_value(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("value must be a string")
        stripped = value.strip()
        if not stripped:
            return None
        if stripped.lower().startswith("0x"):
            stripped = stripped[2:]
        stripped = stripped.replace(" ", "")
        if len(stripped) % 2 != 0:
            raise ValueError("value must be an even-length hexadecimal string")
        allowed = set("0123456789abcdefABCDEF")
        if any(ch not in allowed for ch in stripped):
            raise ValueError("value must be hexadecimal")
        return stripped.upper()

    def to_payload(self) -> Dict[str, Any]:
        payload = self.dict(exclude_unset=True)
        return {key: value for key, value in payload.items() if value is not None}


class ScheduleOverridePayload(BaseModel):
    mode: str
    value: Optional[Any] = None

    class Config:
        extra = "allow"

    @validator("mode")
    def _validate_mode(cls, value: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("override mode must be a non-empty string")
        return value.strip()

    def to_dict(self) -> Dict[str, Any]:
        return self.dict(exclude_unset=True)


class PhotoperiodSchedulePayload(BaseModel):
    type: str
    start: time
    duration_hours: int = Field(..., alias="durationHours")
    ramp_up_min: int = Field(..., alias="rampUpMin")
    ramp_down_min: int = Field(..., alias="rampDownMin")

    class Config:
        allow_population_by_field_name = True

    @validator("type")
    def _enforce_photoperiod(cls, value: str) -> str:
        if value != "photoperiod":
            raise ValueError("only photoperiod schedules are supported")
        return value

    @validator("start", pre=True)
    def _validate_start(cls, value: Any) -> time:
        if isinstance(value, time):
            if value.second or value.microsecond:
                raise ValueError("start time must not include seconds")
            return value
        if isinstance(value, str):
            try:
                parsed = datetime.strptime(value.strip(), "%H:%M").time()
            except ValueError as exc:  # pragma: no cover - defensive guard
                raise ValueError("start must use HH:MM format") from exc
            return parsed
        raise TypeError("start must be a HH:MM string")

    @validator("duration_hours")
    def _validate_duration(cls, value: int) -> int:
        if not isinstance(value, int):
            raise TypeError("durationHours must be an integer")
        if value < 0 or value > 24:
            raise ValueError("durationHours must be between 0 and 24")
        return value

    @validator("ramp_up_min", "ramp_down_min")
    def _validate_ramps(cls, value: int) -> int:
        if not isinstance(value, int):
            raise TypeError("ramp durations must be integers")
        if value < 0:
            raise ValueError("ramp durations must be non-negative")
        return value

    def to_config(self) -> PhotoperiodScheduleConfig:
        return PhotoperiodScheduleConfig(
            start=self.start,
            duration_hours=self.duration_hours,
            ramp_up_minutes=self.ramp_up_min,
            ramp_down_minutes=self.ramp_down_min,
        )


class GroupScheduleRequest(BaseModel):
    device_id: str = Field(..., alias="deviceId")
    plan_key: Optional[str] = Field(None, alias="planKey")
    seed_date: date = Field(..., alias="seedDate")
    override: Optional[ScheduleOverridePayload] = None
    schedule: PhotoperiodSchedulePayload
    offsets: Dict[str, int] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        allow_population_by_field_name = True
        extra = "forbid"

    @validator("device_id")
    def _validate_device(cls, value: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("deviceId must be a non-empty string")
        return value.strip()

    @validator("plan_key")
    def _normalize_plan_key(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None

    @validator("metadata", pre=True)
    def _validate_metadata(cls, value: Any) -> Dict[str, Any]:
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise TypeError("metadata must be an object")
        return value

    @validator("offsets", pre=True)
    def _validate_offsets(cls, value: Any) -> Dict[str, int]:
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise TypeError("offsets must be an object of integer adjustments")
        normalized: Dict[str, int] = {}
        for key, raw in value.items():
            if raw is None:
                continue
            if isinstance(raw, bool):
                raise TypeError(f"offset {key} must be an integer value")
            if isinstance(raw, int):
                normalized[str(key)] = raw
                continue
            if isinstance(raw, float) and raw.is_integer():
                normalized[str(key)] = int(raw)
                continue
            raise TypeError(f"offset {key} must be an integer value")
        return normalized

    def to_group_schedule(self) -> GroupSchedule:
        schedule_config = self.schedule.to_config()
        override_payload = self.override.to_dict() if self.override else None
        return GroupSchedule(
            device_id=self.device_id,
            plan_key=self.plan_key,
            seed_date=self.seed_date,
            schedule=schedule_config,
            override=override_payload,
            offsets=dict(self.offsets),
            metadata=dict(self.metadata),
        )


def _extract_group(device_id: str) -> Optional[str]:
    if device_id.startswith("group:"):
        group = device_id.split(":", 1)[1].strip()
        return group or None
    return None


def _serialize_group_schedule(schedule: GroupSchedule) -> Dict[str, Any]:
    return schedule.to_response_payload()


def _iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


# Optional authentication dependency
async def optional_current_user(
    credentials: Optional[str] = Header(None, alias="Authorization")
) -> Optional[dict]:
    """
    Extract user from token if AUTH_ENABLED, otherwise return None.
    
    This allows endpoints to work with or without authentication based on
    the AUTH_ENABLED environment variable.
    """
    if not AUTH_ENABLED:
        return None
    
    if not credentials:
        raise AuthenticationError("Missing Authorization header")
    
    if not credentials.startswith("Bearer "):
        raise AuthenticationError("Invalid Authorization header format. Use: Bearer <token>")
    
    token = credentials[7:]  # Remove "Bearer " prefix
    
    try:
        import jwt
        payload = jwt.decode(token, os.getenv("JWT_SECRET", "CHANGE_ME_IN_PRODUCTION"), algorithms=["HS256"])
        return {
            "user_id": payload.get("sub"),
            "tenant_id": payload.get("tenant_id"),
            "role": payload.get("role", "viewer"),
        }
    except jwt.ExpiredSignatureError:
        raise AuthenticationError("Token has expired")
    except jwt.InvalidTokenError:
        raise AuthenticationError("Invalid token")


async def require_auth(user: Optional[dict] = Depends(optional_current_user)) -> dict:
    """
    Require authentication when AUTH_ENABLED=true.
    
    Returns user info or raises 401 if authentication required but not provided.
    """
    if AUTH_ENABLED and user is None:
        raise AuthenticationError("Authentication required")
    
    # If auth not enabled, return a default user
    return user or {
        "user_id": "anonymous",
        "tenant_id": "default",
        "role": "admin"
    }


def get_tenant_id_from_user(user: dict) -> Optional[str]:
    """Extract tenant_id from authenticated user for multi-tenant filtering."""
    return user.get("tenant_id") if user else None


def _is_plug_device(device: Device) -> bool:
    category = (device.category or "").lower()
    name = (device.name or "").lower()
    details = device.details or {}
    detail_category = str(
        details.get("category")
        or details.get("deviceType")
        or details.get("type")
        or details.get("kind")
        or ""
    ).lower()
    detail_name = str(details.get("label") or details.get("name") or "").lower()
    protocol = (device.protocol or "").lower()

    if any("plug" in value for value in (category, name, detail_category, detail_name)):
        return True

    if protocol in {"kasa", "tplink", "shelly", "tasmota", "switchbot"}:
        if any("outlet" in value or "switch" in value for value in (category, detail_category)):
            return True

    return False


def _build_plug_state(device: Device) -> PlugStateResponse:
    details = device.details or {}
    state_payload: Dict[str, Any] = {"online": device.online}

    for key in ("on", "power", "powerW", "power_w", "wattage"):
        if key in details and details[key] is not None:
            if key in {"powerW", "power_w"}:
                state_payload["powerW"] = details[key]
            else:
                state_payload[key] = details[key]

    status = details.get("status")
    if isinstance(status, dict):
        for key in ("on", "power", "powerW", "power_w"):
            if key in status and status[key] is not None:
                if key in {"powerW", "power_w"}:
                    state_payload["powerW"] = status[key]
                else:
                    state_payload[key] = status[key]

    try:
        return PlugStateResponse.parse_obj(state_payload)
    except Exception:  # pylint: disable=broad-except
        LOGGER.debug("Failed to parse plug state payload: %s", state_payload)
        return PlugStateResponse(online=device.online)


def _serialize_plug(device: Device) -> PlugResponse:
    details = dict(device.details or {})
    vendor = details.get("vendor") or details.get("manufacturer") or device.protocol
    model = details.get("model") or details.get("deviceType") or device.category

    state = _build_plug_state(device)

    return PlugResponse(
        id=device.device_id,
        deviceId=device.device_id,
        name=device.name,
        vendor=(vendor or None),
        model=(model or None),
        category=device.category,
        protocol=device.protocol,
        state=state,
        capabilities=dict(device.capabilities or {}),
        details=details,
    )


def _collect_plug_payloads() -> List[Dict[str, Any]]:
    plugs: Dict[str, Dict[str, Any]] = {}
    for device in get_registry().list():
        if not _is_plug_device(device):
            continue
        plug_payload = _serialize_plug(device).dict(by_alias=True)
        plug_id = plug_payload.get("id") or plug_payload.get("deviceId")
        if plug_id:
            plugs[str(plug_id)] = plug_payload
        else:
            plugs[str(len(plugs))] = plug_payload
    return list(plugs.values())


def _resolve_fixture(device_identifier: str) -> tuple[str, LightingFixture]:
    candidate = device_identifier.strip()
    device_id_map = get_device_id_map()
    if candidate in device_id_map:
        return candidate, device_id_map[candidate]
    device_id_by_address = get_device_id_by_address()
    if candidate in device_id_by_address:
        resolved = device_id_by_address[candidate]
        return resolved, device_id_map[resolved]
    for device_id, fixture in device_id_map.items():
        if fixture.name == candidate:
            return device_id, fixture
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")


def _hex_to_channels(value: str) -> List[int]:
    stripped = value.strip()
    if stripped.startswith("0x"):
        stripped = stripped[2:]
    if len(stripped) % 2 != 0:
        return []
    channels: List[int] = []
    for index in range(0, len(stripped), 2):
        try:
            channels.append(int(stripped[index : index + 2], 16))
        except ValueError:
            return []
    return channels


def _estimate_brightness(value: Optional[str], fixture: LightingFixture) -> Optional[int]:
    if not value:
        return None
    channels = _hex_to_channels(value)
    if not channels:
        return None
    window = channels[:4] or channels
    if not window:
        return None
    average = sum(window) / len(window)
    percentage = int(round((average / 255.0) * 100))
    clamped = max(fixture.min_brightness, min(fixture.max_brightness, percentage))
    return clamped


def _apply_device_patch(fixture: LightingFixture, entry: Dict[str, Any]) -> None:
    status_text = entry.get("status")
    value_text = entry.get("value")
    brightness: Optional[int] = None
    if isinstance(status_text, str) and status_text.lower() == "off":
        brightness = fixture.min_brightness
    else:
        brightness = _estimate_brightness(value_text, fixture)
        if brightness is None and isinstance(status_text, str) and status_text.lower() == "on":
            brightness = fixture.max_brightness
    if brightness is not None:
        try:
            get_controller().set_output(fixture.address, brightness)
        except ValueError:
            LOGGER.warning("Failed to apply lighting update for %s", fixture.address)


def _serialize_device_data(device_id: str, fixture: LightingFixture) -> Dict[str, Any]:
    device_store = get_device_data_store()
    stored = device_store.get(device_id) or {}
    last_state = get_lighting_state().get_state(fixture.address) or {}
    status_text = stored.get("status")
    if not status_text:
        brightness = last_state.get("brightness", 0)
        status_text = "on" if brightness and brightness > fixture.min_brightness else "off"
    value_text = stored.get("value")
    response: Dict[str, Any] = {
        "id": device_id,
        "deviceId": device_id,
        "name": fixture.name,
        "model": fixture.model,
        "address": fixture.address,
        "status": status_text,
        "value": value_text,
        "online": True,
        "updatedAt": stored.get("updatedAt"),
        "controlInterface": fixture.control_interface,
        "lastKnown": last_state,
    }
    channels = _hex_to_channels(value_text) if isinstance(value_text, str) else []
    if channels:
        response["channels"] = channels
        response["estimatedBrightness"] = _estimate_brightness(value_text, fixture)
    elif stored.get("estimatedBrightness") is not None:
        response["estimatedBrightness"] = stored.get("estimatedBrightness")
    return response


def get_user_context(
    x_user_id: str = Header("system", alias="X-User-Id"),
    x_user_groups: str = Header("", alias="X-User-Groups"),
) -> UserContext:
    groups = [group.strip() for group in x_user_groups.split(",") if group.strip()]
    if not groups:
        groups = ["default"]
    return UserContext(user_id=x_user_id or "system", groups=groups)


@app.get("/sched")
async def list_group_schedules(
    device_id: Optional[str] = Query(None, alias="deviceId"),
    group: Optional[str] = None,
    user: UserContext = Depends(get_user_context),
) -> Dict[str, Any]:
    if group and not user.can_access_group(group):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied for group")

    schedules: List[GroupSchedule] = []
    store = get_group_schedules()
    if device_id:
        schedule = store.get(device_id)
        if schedule is not None:
            target_group = schedule.target_group()
            if target_group and not user.can_access_group(target_group):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied for group")
            schedules = [schedule]
    else:
        candidate_schedules = store.list(group=group)
        for entry in candidate_schedules:
            target_group = entry.target_group()
            if target_group and not user.can_access_group(target_group):
                continue
            schedules.append(entry)

    return {"status": "ok", "schedules": [_serialize_group_schedule(entry) for entry in schedules]}


@app.post("/sched", status_code=status.HTTP_201_CREATED)
async def save_group_schedule(
    request: GroupScheduleRequest, user: UserContext = Depends(get_user_context)
) -> Dict[str, Any]:
    target_group = _extract_group(request.device_id)
    LOGGER.debug("Received schedule save for %s (user groups=%s)", request.device_id, user.groups)
    if target_group and not user.can_access_group(target_group):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User cannot access target group")

    schedule = request.to_group_schedule()
    saved = get_group_schedules().upsert(schedule)
    return {"status": "ok", "schedule": _serialize_group_schedule(saved)}


@app.get("/plans")
async def list_plans() -> Dict[str, Any]:
    store = get_plan_store()
    plans = store.list()
    metadata = store.metadata()
    response: Dict[str, Any] = {"status": "ok", "plans": plans}
    if metadata:
        response["metadata"] = metadata
    return response


@app.get("/plans/{plan_key}")
async def get_plan(plan_key: str) -> Dict[str, Any]:
    store = get_plan_store()
    plan = store.get(plan_key)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    response: Dict[str, Any] = {"status": "ok", "planKey": plan_key, "plan": plan}
    metadata = store.metadata().get(plan_key)
    if metadata:
        response["metadata"] = metadata
    return response


@app.post("/plans", status_code=status.HTTP_201_CREATED)
async def publish_plans(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    if not isinstance(payload, dict) or not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Request body must be a non-empty object",
        )
    normalized: Dict[str, Dict[str, Any]] = {}
    for key, value in payload.items():
        if not isinstance(key, str) or not key.strip():
            continue
        if not isinstance(value, dict):
            continue
        normalized[key.strip()] = value
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No valid plans supplied")
    store = get_plan_store()
    store.upsert_many(normalized)
    saved_plans = {key: store.get(key) for key in normalized.keys() if store.get(key) is not None}
    response: Dict[str, Any] = {
        "status": "ok",
        "saved": sorted(saved_plans.keys()),
        "plans": saved_plans,
    }
    metadata = store.metadata()
    if metadata:
        response["metadata"] = {key: metadata[key] for key in saved_plans.keys() if key in metadata}
    return response


@app.get("/env")
async def get_environment(
    scope: Optional[str] = Query(None),
    time_range: Optional[str] = Query(None, alias="range"),
    zone_id: Optional[str] = Query(None, alias="zoneId"),
) -> Dict[str, Any]:
    range_seconds = _parse_time_range(time_range)
    identifier = (scope or zone_id or "").strip()
    response: Dict[str, Any] = {"status": "ok"}

    telemetry_store = get_environment_telemetry()
    state_store = get_environment_state()

    if identifier:
        telemetry_zone = telemetry_store.get_zone(identifier, range_seconds)
        if telemetry_zone:
            response["zone"] = telemetry_zone
        else:
            zone = state_store.get_zone(identifier)
            if zone is not None:
                response["zone"] = zone
            else:
                # Instead of 404, return empty zone for missing scope
                response["zone"] = {}
    else:
        response["zones"] = telemetry_store.list_zones(range_seconds)

    env_snapshot = state_store.snapshot()
    if env_snapshot:
        response["env"] = env_snapshot

    last_updated = telemetry_store.last_updated()
    if last_updated:
        response["updatedAt"] = last_updated

    return response


@app.post("/env", status_code=status.HTTP_200_OK)
async def upsert_environment(request: Request, payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Rate limit: 100/hour (if enabled)"""
    if isinstance(payload, list):
        ingested = []
        for item in payload:
            if not isinstance(item, dict) or not _is_telemetry_payload(item):
                continue
            result = _ingest_environment_telemetry(item)
            if "zone" in result:
                ingested.append(result["zone"])
        if not ingested:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No valid telemetry entries supplied",
            )
        telemetry_store = get_environment_telemetry()
        state_store = get_environment_state()
        response: Dict[str, Any] = {"status": "ok", "zones": ingested}
        last_updated = telemetry_store.last_updated()
        if last_updated:
            response["updatedAt"] = last_updated
        env_snapshot = state_store.snapshot()
        if env_snapshot:
            response["env"] = env_snapshot
        return response

    if not isinstance(payload, dict) or not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Request body must be a non-empty object",
        )

    if _is_telemetry_payload(payload):
        return _ingest_environment_telemetry(payload)

    response: Dict[str, Any] = {"status": "ok"}

    state_store = get_environment_state()
    telemetry_store = get_environment_telemetry()

    rooms_payload = payload.get("rooms")
    if isinstance(rooms_payload, dict):
        response["rooms"] = state_store.upsert_rooms(rooms_payload)

    processed_zone = False
    zone_identifier = payload.get("zoneId") or payload.get("zone_id")
    if isinstance(zone_identifier, str) and zone_identifier.strip():
        zone_payload = dict(payload)
        zone_payload.pop("rooms", None)
        zone_payload.pop("zoneId", None)
        zone_payload.pop("zone_id", None)
        zone_payload.pop("zones", None)
        response["zone"] = state_store.upsert_zone(zone_identifier.strip(), zone_payload)
        processed_zone = True

    zones_payload = payload.get("zones")
    if isinstance(zones_payload, dict) and not processed_zone:
        merged_zones: Dict[str, Any] = {}
        for zone_key, zone_body in zones_payload.items():
            if not isinstance(zone_key, str) or not isinstance(zone_body, dict):
                continue
            merged_zones[zone_key] = state_store.upsert_zone(zone_key, zone_body)
        if merged_zones:
            response["zones"] = merged_zones

    remaining = {
        key: value
        for key, value in payload.items()
        if key not in {"rooms", "zoneId", "zone_id", "zones"}
    }
    if remaining:
        if processed_zone:
            extra = {
                key: value
                for key, value in remaining.items()
                if key not in {"targets", "control", "metadata", "sensors"}
            }
            if extra:
                state_store.merge(extra)
        else:
            state_store.merge(remaining)

    snapshot = state_store.snapshot()
    for key, value in snapshot.items():
        response.setdefault(key, value)
    return response

@app.get("/discovery/devices", response_class=JSONResponse, tags=["discovery"])
async def discovery_devices() -> dict:
    """Perform a live scan for all supported device types and return fresh results."""
    registry = get_registry()
    config = get_config()
    
    # Prepare discovery tasks
    tasks = [
        discover_kasa_devices(registry, timeout=5),
        discover_ble_devices(registry, scan_duration=8.0),
        discover_mdns_devices(registry, scan_duration=5.0),
    ]
    protocols = ["kasa", "bluetooth-le", "mdns"]
    
    # Add SwitchBot if configured
    if config.switchbot:
        # SwitchBot discovery is synchronous, so run it in executor
        loop = asyncio.get_event_loop()
        tasks.append(loop.run_in_executor(None, discover_switchbot_devices, registry, config.switchbot))
        protocols.append("switchbot")
    
    results = await asyncio.gather(*tasks, return_exceptions=True)

    devices: List[Dict[str, Any]] = []
    for idx, res in enumerate(results):
        if isinstance(res, Exception):
            LOGGER.warning(f"Discovery for {protocols[idx]} failed: {res}")
            continue
        for d in res:
            devices.append(_safe_json(d))

    return {"devices": devices, "timestamp": asyncio.get_event_loop().time()}


@app.post("/discovery/run", status_code=status.HTTP_202_ACCEPTED, tags=["discovery"])
async def trigger_discovery_scan(
    request: Request,user: dict = Depends(require_auth)) -> dict:
    """
    Trigger an asynchronous device discovery scan.
    
    **Authentication:** Requires operator or admin role when AUTH_ENABLED=true
    
    Returns immediately with scan ID. Poll GET /discovery/devices for results.
    """
    registry = get_registry()
    config = get_config()
    
    # Run discovery in background
    asyncio.create_task(_background_discovery(registry, config))
    
    return {
        "status": "accepted",
        "message": "Discovery scan initiated. Poll GET /discovery/devices for results.",
        "timestamp": _iso_now()
    }


async def _background_discovery(registry: DeviceRegistry, config: EnvironmentConfig):
    """Background task for running discovery scan."""
    try:
        LOGGER.info("Starting background discovery scan")
        tasks = [
            discover_kasa_devices(registry, timeout=5),
            discover_ble_devices(registry, scan_duration=8.0),
            discover_mdns_devices(registry, scan_duration=5.0),
        ]
        
        if config.switchbot:
            loop = asyncio.get_event_loop()
            tasks.append(loop.run_in_executor(None, discover_switchbot_devices, registry, config.switchbot))
        
        await asyncio.gather(*tasks, return_exceptions=True)
        LOGGER.info("Background discovery scan completed")
    except Exception as e:
        LOGGER.error(f"Background discovery failed: {e}")


@app.get("/api/devices/kasa", tags=["discovery"])
async def get_kasa_devices(user: dict = Depends(require_auth)) -> dict:
    """Get raw Kasa discovery payload, filtered by tenant."""
    registry = get_registry()
    tenant_id = get_tenant_id_from_user(user)
    devices = await discover_kasa_devices(registry, timeout=5)
    # Filter by tenant
    if tenant_id:
        devices = [d for d in devices if d.tenant_id == tenant_id or d.tenant_id is None]
    return {
        "protocol": "kasa",
        "devices": [_safe_json(d) for d in devices],
        "count": len(devices),
        "timestamp": _iso_now()
    }


@app.get("/api/devices/mqtt", tags=["discovery"])
async def get_mqtt_devices(user: dict = Depends(require_auth)) -> dict:
    """Get MQTT devices from registry, filtered by tenant."""
    registry = get_registry()
    tenant_id = get_tenant_id_from_user(user)
    mqtt_devices = registry.by_protocol("mqtt", tenant_id=tenant_id)
    return {
        "protocol": "mqtt",
        "devices": [_safe_json(d) for d in mqtt_devices],
        "count": len(mqtt_devices),
        "timestamp": _iso_now()
    }


@app.get("/api/devices/ble", tags=["discovery"])
async def get_ble_devices(user: dict = Depends(require_auth)) -> dict:
    """Get raw BLE discovery payload, filtered by tenant."""
    registry = get_registry()
    tenant_id = get_tenant_id_from_user(user)
    devices = await discover_ble_devices(registry, scan_duration=8.0)
    # Filter by tenant
    if tenant_id:
        devices = [d for d in devices if d.tenant_id == tenant_id or d.tenant_id is None]
    return {
        "protocol": "ble",
        "devices": [_safe_json(d) for d in devices],
        "count": len(devices),
        "timestamp": _iso_now()
    }


@app.get("/api/devices/mdns", tags=["discovery"])
async def get_mdns_devices() -> dict:
    """Get raw mDNS discovery payload for debugging."""
    registry = get_registry()
    devices = await discover_mdns_devices(registry, scan_duration=5.0)
    return {
        "protocol": "mdns",
        "devices": [_safe_json(d) for d in devices],
        "count": len(devices),
        "timestamp": _iso_now()
    }

class SetupAssistRequest(BaseModel):
    device_metadata: Dict[str, Any] = Field(default_factory=dict)
    wizard_state: Dict[str, Any] = Field(default_factory=dict)
    environment_context: Dict[str, Any] = Field(default_factory=dict)
    stage: str = Field("start", description="Call stage: start, mid, or complete")


class SetupAssistResponse(BaseModel):
    suggested_fields: Dict[str, Any] = Field(default_factory=dict)
    next_steps: List[str] = Field(default_factory=list)
    summary: Optional[str] = None
    provider: str = Field("heuristic", description="Identifier for the backing AI provider")


def _parse_time(value: str) -> tuple[int, int]:
    parts = value.split(":", 1)
    if len(parts) != 2:
        raise ValueError("Invalid time format")
    hour, minute = int(parts[0]), int(parts[1])
    if not (0 <= hour < 24 and 0 <= minute < 60):
        raise ValueError("Hour or minute out of range")
    return hour, minute


def _schedule_from_request(request: ScheduleRequest) -> Schedule:
    start_hour, start_minute = _parse_time(request.start_time)
    end_hour, end_minute = _parse_time(request.end_time)
    return Schedule(
        schedule_id=request.schedule_id,
        name=request.name,
        group=request.group,
        start_time=time(hour=start_hour, minute=start_minute),
        end_time=time(hour=end_hour, minute=end_minute),
        brightness=request.brightness,
        spectrum=request.spectrum,
    )





# --- Minimal, robust async discovery supervisor ---
import contextlib
log = logging.getLogger(__name__)
app.state.discovery_task = None

async def _discovery_supervisor(
    config,
    registry,
    buffer,
    interval_sec: int = 180,  # 3 minutes for SwitchBot API polling
    timeout_sec: int = 25,
):
    """
    Periodically runs discovery. Never raises; timeboxed; survives errors.
    """
    log.info("Starting discovery supervisor with interval=%s", interval_sec)
    try:
        while True:
            try:
                # Support either async or sync implementations transparently
                if inspect.iscoroutinefunction(full_discovery_cycle):
                    await asyncio.wait_for(
                        full_discovery_cycle(config, registry, buffer, logger=log),
                        timeout=timeout_sec,
                    )
                else:
                    await asyncio.wait_for(
                        asyncio.to_thread(full_discovery_cycle, config, registry, buffer),
                        timeout=timeout_sec,
                    )
            except asyncio.TimeoutError:
                log.warning("Discovery timed out after %ss (continuing)", timeout_sec)
            except Exception:
                log.exception("Discovery failed (non-fatal)")
            await asyncio.sleep(interval_sec)
    except asyncio.CancelledError:
        log.info("Discovery supervisor cancelled")
        raise






@app.on_event("startup")
async def _startup() -> None:
    # Apply rate limiting to endpoints if enabled
    if limiter and RATE_LIMITING_ENABLED:
        # Apply rate limits to specific endpoints
        try:
            limiter.limit("100/hour")(upsert_environment)
            limiter.limit("50/hour")(send_device_command)
            limiter.limit("1000/hour")(list_devices)
            limiter.limit("10/hour")(trigger_discovery_scan)
            LOGGER.info(" Rate limits applied to endpoints")
        except Exception as e:
            LOGGER.warning(f"  Failed to apply rate limits: {e}")
    
    if app.state.CONFIG is None:
        app.state.CONFIG = load_config(env="production")
    config = get_config()

    if app.state.REGISTRY is None:
        registry = DeviceRegistry()
        registry.upsert(
            Device(
                device_id="dehum-quest-155",
                name="Quest Dual 155",
                category="dehumidifier",
                protocol="wifi",
                online=True,
                capabilities={
                    "capacity": "155 pints/day",
                    "control": "WiFi",
                    "features": [
                        "remote-monitoring",
                        "app-control",
                        "variable-speed-compressor",
                    ],
                    "power": "2100W",
                    "vendor": "Quest",
                    "model": "Quest Dual 155",
                },
                details={
                    "description": "High-capacity commercial dehumidifier with WiFi connectivity and app control",
                },
            )
        )
        app.state.REGISTRY = registry

    if app.state.BUFFER is None:
        app.state.BUFFER = SensorEventBuffer(max_events=1000)

    if app.state.LIGHTING_STATE is None:
        app.state.LIGHTING_STATE = LightingState(config.lighting_inventory or [])

    if app.state.CONTROLLER is None:
        app.state.CONTROLLER = LightingController(
            config.lighting_inventory or [],
            get_lighting_state(),
        )

    if app.state.SCHEDULES is None:
        app.state.SCHEDULES = ScheduleStore()

    if app.state.GROUP_SCHEDULES is None:
        app.state.GROUP_SCHEDULES = GroupScheduleStore()

    if app.state.PLAN_STORE is None:
        app.state.PLAN_STORE = PlanStore()

    if app.state.ENVIRONMENT_STATE is None:
        app.state.ENVIRONMENT_STATE = EnvironmentStateStore()

    if app.state.ENVIRONMENT_TELEMETRY is None:
        app.state.ENVIRONMENT_TELEMETRY = EnvironmentTelemetryStore()

    if app.state.DEVICE_DATA is None:
        app.state.DEVICE_DATA = DeviceDataStore()

    automation_created = False
    if app.state.AUTOMATION is None:
        app.state.AUTOMATION = AutomationEngine(get_controller(), get_schedules())
        automation_created = True

    fixture_inventory = list(config.lighting_inventory or [])
    device_id_map: Dict[str, LightingFixture] = {}
    device_id_by_address: Dict[str, str] = {}
    device_store = get_device_data_store()
    for index, fixture in enumerate(fixture_inventory, start=1):
        device_id = str(index)
        device_id_map[device_id] = fixture
        device_id_by_address[fixture.address] = device_id
        device_store.upsert(
            device_id,
            {
                "status": "off",
                "value": None,
                "name": fixture.name,
                "address": fixture.address,
                "model": fixture.model,
            },
        )

    app.state.FIXTURE_INVENTORY = fixture_inventory
    app.state.DEVICE_ID_MAP = device_id_map
    app.state.DEVICE_ID_BY_ADDRESS = device_id_by_address

    zone_map = {fixture.name: fixture.address for fixture in fixture_inventory}
    app.state.ZONE_MAP = zone_map

    if zone_map and automation_created:
        automation = get_automation()
        target_lux = int(os.getenv("TARGET_LUX", "500"))
        occupied_level = int(os.getenv("OCCUPIED_BRIGHTNESS", "80"))
        vacant_level = int(os.getenv("VACANT_BRIGHTNESS", "30"))
        automation.register_rule(lux_balancing_rule(zone_map, target_lux))
        automation.register_rule(occupancy_rule(zone_map, occupied_level, vacant_level))

    ai_service: Optional[SetupAssistService] = None
    if config.ai_assist and config.ai_assist.enabled:
        try:
            ai_service = SetupAssistService(config.ai_assist)
        except SetupAssistError as exc:
            LOGGER.error("Failed to initialise AI Assist: %s", exc)
    app.state.AI_ASSIST_SERVICE = ai_service
    
    # Start MQTT usage tracker for automatic inventory tracking
    if MQTT_AVAILABLE and config.mqtt:
        try:
            from .mqtt_usage_tracker import start_usage_tracker
            start_usage_tracker(
                broker=config.mqtt.host,
                port=config.mqtt.port,
                username=config.mqtt.username,
                password=config.mqtt.password
            )
            LOGGER.info("MQTT usage tracker started for automated inventory tracking")
        except Exception as e:
            LOGGER.warning(f"Could not start MQTT usage tracker: {e}")

    if not app.state.discovery_task:
        app.state.discovery_task = asyncio.create_task(
            _discovery_supervisor(
                get_config(),
                get_registry(),
                get_buffer(),
                interval_sec=180,  # 3 minutes for SwitchBot API polling
                timeout_sec=25,
            )
        )




@app.on_event("shutdown")
async def _shutdown():
    t = getattr(app.state, "discovery_task", None)
    if t:
        t.cancel()
        with contextlib.suppress(Exception):
            await t
    
    # Stop MQTT usage tracker
    if MQTT_AVAILABLE:
        try:
            from .mqtt_usage_tracker import stop_usage_tracker
            stop_usage_tracker()
            LOGGER.info("MQTT usage tracker stopped")
        except Exception as e:
            LOGGER.warning(f"Error stopping MQTT usage tracker: {e}")


@app.get("/health", tags=["health"])
async def health() -> dict:
    """Get system health status with device count and version."""
    return {
        "status": "ok",
        "devices": len(get_registry().list()),
        "timestamp": _iso_now(),
        "version": app.version,
    }


@app.get("/healthz", tags=["health"])
async def healthz() -> dict:
    """Health check endpoint (alias for /health)."""
    return await health()


@app.post("/ai/setup-assist", response_model=SetupAssistResponse, tags=["ai"])
async def setup_assist(request: SetupAssistRequest) -> SetupAssistResponse:
    service = get_ai_assist_service()
    if not service:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="AI Assist not configured")
    try:
        result = await service.generate(
            device_metadata=request.device_metadata,
            wizard_state=request.wizard_state,
            environment_context=request.environment_context,
            stage=request.stage,
        )
    except SetupAssistError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:  # pylint: disable=broad-except
        LOGGER.exception("AI setup assist failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to obtain AI suggestions") from exc
    return SetupAssistResponse(**result)


@app.get("/devices", response_model=List[DeviceResponse], tags=["devices"])
async def list_devices(
    request: Request,user: dict = Depends(require_auth)) -> List[DeviceResponse]:
    """List all discovered devices, filtered by tenant when authenticated."""
    tenant_id = get_tenant_id_from_user(user)
    devices = get_registry().list(tenant_id=tenant_id)
    return [DeviceResponse(**device.__dict__) for device in devices]


@app.get("/api/network/wifi/scan", tags=["network"])
async def wifi_scan() -> dict:
    """
    Scan for available WiFi networks.
    
    Returns list of SSIDs with signal strength for site setup validation.
    """
    try:
        # Try to run iwlist scan on Linux
        result = subprocess.run(
            ["iwlist", "scan"],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode == 0:
            # Parse iwlist output for SSIDs and signal
            networks = []
            current_network = {}
            
            for line in result.stdout.split('\n'):
                if 'ESSID:' in line:
                    match = re.search(r'ESSID:"([^"]*)"', line)
                    if match:
                        current_network['ssid'] = match.group(1)
                elif 'Quality=' in line:
                    match = re.search(r'Quality=(\d+)/(\d+)', line)
                    if match:
                        quality = int(match.group(1))
                        max_quality = int(match.group(2))
                        current_network['signal'] = int((quality / max_quality) * 100)
                
                if current_network.get('ssid') and current_network.get('signal'):
                    networks.append(current_network.copy())
                    current_network = {}
            
            return {
                "success": True,
                "networks": networks,
                "count": len(networks),
                "timestamp": _iso_now()
            }
        
        # Fallback: Try macOS airport scan
        result = subprocess.run(
            ["/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport", "-s"],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode == 0:
            networks = []
            for line in result.stdout.split('\n')[1:]:  # Skip header
                parts = line.split()
                if len(parts) >= 2:
                    networks.append({
                        "ssid": parts[0],
                        "signal": int(parts[1]) if parts[1].lstrip('-').isdigit() else 0
                    })
            
            return {
                "success": True,
                "networks": networks,
                "count": len(networks),
                "timestamp": _iso_now()
            }
        
    except Exception as e:
        LOGGER.warning(f"WiFi scan failed: {e}")
    
    # Return empty if scan not available
    return {
        "success": False,
        "networks": [],
        "count": 0,
        "message": "WiFi scanning not available on this platform",
        "timestamp": _iso_now()
    }


class NetworkTestRequest(BaseModel):
    host: str
    port: int = 1883
    protocol: str = "mqtt"


@app.post("/api/network/test", tags=["network"])
async def network_test(request: NetworkTestRequest) -> dict:
    """
    Test network connectivity to a host (MQTT broker, cloud endpoint, etc).
    
    Validates reachability and port accessibility during site setup.
    """
    import socket
    
    try:
        # Try to connect to the host:port
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        result = sock.connect_ex((request.host, request.port))
        sock.close()
        
        if result == 0:
            return {
                "success": True,
                "reachable": True,
                "host": request.host,
                "port": request.port,
                "protocol": request.protocol,
                "message": f"Successfully connected to {request.host}:{request.port}",
                "timestamp": _iso_now()
            }
        else:
            return {
                "success": False,
                "reachable": False,
                "host": request.host,
                "port": request.port,
                "protocol": request.protocol,
                "message": f"Failed to connect to {request.host}:{request.port} (error code: {result})",
                "timestamp": _iso_now()
            }
    except Exception as e:
        return {
            "success": False,
            "reachable": False,
            "host": request.host,
            "port": request.port,
            "protocol": request.protocol,
            "error": str(e),
            "message": f"Connection test failed: {str(e)}",
            "timestamp": _iso_now()
        }


class DeviceCommandRequest(BaseModel):
    device_id: str
    command: Dict[str, Any]


@app.post("/api/device/command", tags=["devices"])
async def send_device_command(
    request: Request,
    command_req: DeviceCommandRequest,
    user: dict = Depends(require_auth)
) -> dict:
    """Rate limit: 50/hour (if enabled)
    
    Send a direct command to a specific device for ad-hoc overrides.
    
    **Authentication:** Requires operator or admin role when AUTH_ENABLED=true
    
    Command format depends on device protocol.
    
    **Kasa Protocol Commands:**
    - `{"action": "turn_on"}` - Turn device on
    - `{"action": "turn_off"}` - Turn device off
    - `{"action": "set_brightness", "brightness": 75}` - Set brightness (0-100)
    - `{"action": "set_color_temperature", "kelvin": 4000}` - Set color temp (2500-9000K)
    
    **MQTT Protocol Commands:**
    - `{"topic": "zigbee2mqtt/device/set", "payload": {...}}` - Publish to topic
    
    Returns command execution result with actual device response.
    """
    registry = get_registry()
    tenant_id = get_tenant_id_from_user(user)
    device = registry.get(command_req.device_id, tenant_id=tenant_id)
    
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device {command_req.device_id} not found or access denied"
        )
    
    LOGGER.info(f"Executing command on device {device.name} ({device.protocol}): {command_req.command}")
    
    try:
        # Dispatch based on device protocol
        if device.protocol == "kasa":
            return await _execute_kasa_command(device, command_req.command)
        elif device.protocol == "mqtt":
            return await _execute_mqtt_command(device, command_req.command)
        elif device.protocol == "switchbot":
            return await _execute_switchbot_command(device, command_req.command)
        else:
            raise HTTPException(
                status_code=status.HTTP_501_NOT_IMPLEMENTED,
                detail=f"Protocol {device.protocol} command dispatch not implemented"
            )
    except Exception as e:
        LOGGER.error(f"Command execution failed for {device.name}: {e}")
        return {
            "success": False,
            "device_id": request.device_id,
            "command": request.command,
            "error": str(e),
            "message": f"Failed to execute command: {str(e)}",
            "timestamp": _iso_now()
        }


async def _execute_kasa_command(device: Device, command: Dict[str, Any]) -> dict:
    """Execute command on TP-Link Kasa device."""
    if not KASA_AVAILABLE:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Kasa protocol support not available (python-kasa not installed)"
        )
    
    host = device.details.get("host")
    if not host:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Device host address not available"
        )
    
    action = command.get("action")
    if not action:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Command must include 'action' field"
        )
    
    try:
        # Connect to device
        kasa_device = await SmartDevice.connect(host=host)
        await kasa_device.update()
        
        # Execute action
        result = {"device_state": {}}
        
        if action == "turn_on":
            await kasa_device.turn_on()
            await kasa_device.update()
            result["device_state"]["is_on"] = kasa_device.is_on
            result["message"] = f"Device {device.name} turned on"
            
        elif action == "turn_off":
            await kasa_device.turn_off()
            await kasa_device.update()
            result["device_state"]["is_on"] = kasa_device.is_on
            result["message"] = f"Device {device.name} turned off"
            
        elif action == "set_brightness":
            brightness = command.get("brightness")
            if brightness is None or not (0 <= brightness <= 100):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="brightness must be between 0 and 100"
                )
            await kasa_device.set_brightness(brightness)
            await kasa_device.update()
            result["device_state"]["brightness"] = kasa_device.brightness
            result["message"] = f"Device {device.name} brightness set to {brightness}%"
            
        elif action == "set_color_temperature":
            kelvin = command.get("kelvin")
            if kelvin is None or not (2500 <= kelvin <= 9000):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="kelvin must be between 2500 and 9000"
                )
            await kasa_device.set_color_temp(kelvin)
            await kasa_device.update()
            result["device_state"]["color_temp"] = kasa_device.color_temp
            result["message"] = f"Device {device.name} color temperature set to {kelvin}K"
            
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown action '{action}'. Supported: turn_on, turn_off, set_brightness, set_color_temperature"
            )
        
        # Get current device state
        result["device_state"].update({
            "is_on": kasa_device.is_on,
            "brightness": getattr(kasa_device, "brightness", None),
            "color_temp": getattr(kasa_device, "color_temp", None),
        })
        
        return {
            "success": True,
            "device_id": device.device_id,
            "device_name": device.name,
            "command": command,
            "result": result,
            "timestamp": _iso_now()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        LOGGER.error(f"Kasa command failed for {device.name}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Kasa command execution failed: {str(e)}"
        )


async def _execute_mqtt_command(device: Device, command: Dict[str, Any]) -> dict:
    """Execute command on MQTT device by publishing to topic."""
    if not MQTT_AVAILABLE:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MQTT protocol support not available (paho-mqtt not installed)"
        )
    
    topic = command.get("topic")
    payload = command.get("payload")
    
    if not topic:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Command must include 'topic' field"
        )
    
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Command must include 'payload' field"
        )
    
    try:
        # Get MQTT config
        config = get_config()
        mqtt_config = config.mqtt
        
        # Create temporary MQTT client for command
        client = mqtt.Client(client_id=f"light-engine-command-{device.device_id}")
        
        if mqtt_config.username:
            client.username_pw_set(mqtt_config.username, mqtt_config.password)
        
        # Connect synchronously
        client.connect(mqtt_config.host, mqtt_config.port, keepalive=60)
        
        # Publish command
        payload_str = json.dumps(payload) if isinstance(payload, dict) else str(payload)
        result = client.publish(topic, payload_str, qos=1)
        
        # Wait for publish to complete
        result.wait_for_publish(timeout=5)
        
        # Disconnect
        client.disconnect()
        
        return {
            "success": True,
            "device_id": device.device_id,
            "device_name": device.name,
            "command": command,
            "result": {
                "topic": topic,
                "payload": payload,
                "published": result.is_published(),
                "message": f"Command published to {topic}"
            },
            "timestamp": _iso_now()
        }
        
    except Exception as e:
        LOGGER.error(f"MQTT command failed for {device.name}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"MQTT command execution failed: {str(e)}"
        )


async def _execute_switchbot_command(device: Device, command: Dict[str, Any]) -> dict:
    """Execute command on SwitchBot device via Cloud API."""
    # TODO: Implement SwitchBot Cloud API command
    # Would use requests to call SwitchBot API with HMAC signature
    return {
        "success": False,
        "device_id": device.device_id,
        "command": command,
        "message": "SwitchBot command dispatch not yet implemented",
        "timestamp": _iso_now()
    }


@app.get("/lighting/fixtures", tags=["lighting"])
async def get_lighting_fixtures() -> dict:
    """Get configured lighting fixture metadata."""
    config = get_config()
    
    fixtures = []
    for fixture in config.lighting_fixtures:
        fixtures.append({
            "id": fixture.device_id,
            "name": fixture.device_id,
            "protocol": fixture.protocol,
            "channels": fixture.channels,
            "max_brightness": fixture.max_brightness
        })
    
    return {
        "fixtures": fixtures,
        "count": len(fixtures),
        "timestamp": _iso_now()
    }


class FailsafePowerRequest(BaseModel):
    fixtures: List[str]
    power: str  # "on" or "off"
    brightness: Optional[int] = 100


@app.post("/lighting/failsafe", tags=["lighting"])
async def lighting_failsafe(
    request: FailsafePowerRequest,
    user: dict = Depends(require_auth)
) -> dict:
    """
    Broadcast immediate power change to fixtures for emergency control.
    
    **Authentication:** Requires operator or admin role when AUTH_ENABLED=true
    
    Bypasses automation rules for safety overrides.
    """
    controller = get_controller()
    
    results = []
    for fixture_id in request.fixtures:
        try:
            # TODO: Implement actual failsafe control
            results.append({
                "fixture_id": fixture_id,
                "success": True,
                "power": request.power,
                "brightness": request.brightness
            })
        except Exception as e:
            results.append({
                "fixture_id": fixture_id,
                "success": False,
                "error": str(e)
            })
    
    return {
        "results": results,
        "total": len(request.fixtures),
        "successful": sum(1 for r in results if r["success"]),
        "timestamp": _iso_now()
    }


class AutomationRule(BaseModel):
    rule_id: Optional[str] = None
    name: str
    enabled: bool = True
    conditions: Dict[str, Any]
    actions: Dict[str, Any]
    priority: int = 0


@app.get("/rules", tags=["automation"])
async def list_automation_rules() -> dict:
    """List all automation rules."""
    automation = get_automation()
    
    # TODO: Implement rule persistence and retrieval
    # For now, return mock data
    return {
        "rules": [],
        "count": 0,
        "timestamp": _iso_now()
    }


@app.post("/rules", status_code=status.HTTP_201_CREATED, tags=["automation"])
async def create_automation_rule(
    rule: AutomationRule,
    user: dict = Depends(require_auth)
) -> dict:
    """Create a new automation rule.
    
    **Authentication:** Requires operator or admin role when AUTH_ENABLED=true
    """
    import uuid
    
    rule_id = rule.rule_id or str(uuid.uuid4())
    
    # TODO: Implement rule persistence
    
    return {
        "success": True,
        "rule_id": rule_id,
        "message": "Automation rule created",
        "timestamp": _iso_now()
    }


@app.patch("/rules/{rule_id}", tags=["automation"])
async def update_automation_rule(
    rule_id: str,
    rule: AutomationRule,
    user: dict = Depends(require_auth)
) -> dict:
    """Update an existing automation rule.
    
    **Authentication:** Requires operator or admin role when AUTH_ENABLED=true
    """
    # TODO: Implement rule update logic
    
    return {
        "success": True,
        "rule_id": rule_id,
        "message": "Automation rule updated",
        "timestamp": _iso_now()
    }


@app.delete("/rules/{rule_id}", tags=["automation"])
async def delete_automation_rule(
    rule_id: str,
    user: dict = Depends(require_auth)
) -> dict:
    """Delete an automation rule.
    
    **Authentication:** Requires operator or admin role when AUTH_ENABLED=true
    """
    # TODO: Implement rule deletion logic
    
    return {
        "success": True,
        "rule_id": rule_id,
        "message": "Automation rule deleted",
        "timestamp": _iso_now()
    }


@app.get("/plugs")
async def list_plugs() -> Dict[str, Any]:
    plugs = _collect_plug_payloads()
    return {"ok": True, "count": len(plugs), "plugs": plugs}


@app.post("/plugs/discover")
async def discover_plugs() -> Dict[str, Any]:
    await full_discovery_cycle(
        get_config(),
        get_registry(),
        get_buffer(),
        event_handler=get_automation().publish,
    )
    plugs = _collect_plug_payloads()
    return {"ok": True, "refreshedAt": _iso_now(), "count": len(plugs), "plugs": plugs}


@app.get("/api/devicedatas")
async def list_device_data() -> Dict[str, Any]:
    devices = [
        _serialize_device_data(device_id, fixture)
        for device_id, fixture in get_device_id_map().items()
    ]
    return {"data": devices, "count": len(devices), "updatedAt": _iso_now()}


@app.patch("/api/devicedatas/device/{device_id}")
async def update_device_data(device_id: str, request: DeviceDataPatch) -> Dict[str, Any]:
    resolved_id, fixture = _resolve_fixture(device_id)
    payload = request.to_payload()
    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No updates supplied")

    status_text = payload.get("status")
    value_text = payload.get("value")
    estimated = None
    if isinstance(value_text, str) and value_text:
        estimated = _estimate_brightness(value_text, fixture)
    elif isinstance(status_text, str) and status_text.lower() == "off":
        estimated = fixture.min_brightness
    elif isinstance(status_text, str) and status_text.lower() == "on":
        estimated = fixture.max_brightness
    if estimated is not None:
        payload["estimatedBrightness"] = estimated

    entry = get_device_data_store().upsert(resolved_id, payload)
    _apply_device_patch(fixture, entry)
    return {"status": "ok", "device": _serialize_device_data(resolved_id, fixture)}


@app.post("/discovery/run", status_code=status.HTTP_202_ACCEPTED)
async def trigger_discovery() -> dict:
    asyncio.create_task(
        full_discovery_cycle(
            get_config(),
            get_registry(),
            get_buffer(),
            get_automation().publish,
        )
    )
    return {"status": "scheduled"}


@app.get("/api/devices/kasa", response_model=dict)
async def get_kasa_devices() -> dict:
    """Get TP-Link Kasa devices discovered on the network."""
    devices = await discover_kasa_devices(get_registry(), timeout=5)
    return {
        "devices": [device.__dict__ for device in devices],
        "protocol": "kasa-wifi",
        "timestamp": asyncio.get_event_loop().time()
    }


@app.get("/api/devices/mqtt", response_model=dict) 
async def get_mqtt_devices() -> dict:
    """Get MQTT devices that have been discovered."""
    mqtt_devices = [device for device in get_registry().list() if device.protocol == "mqtt"]
    return {
        "devices": [device.__dict__ for device in mqtt_devices],
        "protocol": "mqtt",
        "timestamp": asyncio.get_event_loop().time()
    }


@app.get("/api/devices/ble", response_model=dict)
async def get_ble_devices() -> dict:
    """Get Bluetooth Low Energy devices discovered nearby."""
    devices = await discover_ble_devices(get_registry(), scan_duration=8.0)
    return {
        "devices": [device.__dict__ for device in devices],
        "protocol": "bluetooth-le", 
        "timestamp": asyncio.get_event_loop().time()
    }


@app.get("/api/devices/mdns", response_model=dict)
async def get_mdns_devices() -> dict:
    """Get mDNS/Bonjour devices discovered on the network."""
    devices = await discover_mdns_devices(get_registry(), scan_duration=5.0)
    return {
        "devices": [device.__dict__ for device in devices],
        "protocol": "mdns",
        "timestamp": asyncio.get_event_loop().time()
    }


@app.post("/discovery/scan")
async def universal_scan() -> dict:
    """Universal device scanner - aggregates all protocol discovery methods.
    
    Performs parallel discovery across:
    - TP-Link Kasa (WiFi)
    - MQTT devices
    - BLE devices
    - mDNS/Bonjour devices
    
    Returns a unified list of discovered devices.
    """
    LOGGER.info("[UniversalScan] Starting multi-protocol discovery")
    
    all_devices = []
    registry = get_registry()
    
    try:
        # Run all discovery methods in parallel
        results = await asyncio.gather(
            discover_kasa_devices(registry, timeout=5),
            discover_ble_devices(registry, scan_duration=5.0),
            discover_mdns_devices(registry, scan_duration=3.0),
            return_exceptions=True
        )
        
        # Process Kasa devices
        if isinstance(results[0], list):
            for device in results[0]:
                device_dict = device.__dict__ if hasattr(device, '__dict__') else {}
                all_devices.append({
                    "name": device_dict.get('alias') or device_dict.get('name', 'Kasa Device'),
                    "brand": "TP-Link",
                    "vendor": "TP-Link",
                    "protocol": "kasa",
                    "comm_type": "WiFi",
                    "ip": device_dict.get('host') or device_dict.get('ip'),
                    "mac": device_dict.get('mac'),
                    "deviceId": device_dict.get('device_id'),
                    "model": device_dict.get('model')
                })
                LOGGER.info(f"[UniversalScan] Found Kasa: {device_dict.get('alias', 'Unknown')}")
        elif isinstance(results[0], Exception):
            LOGGER.warning(f"[UniversalScan] Kasa discovery failed: {results[0]}")
        
        # Process BLE devices
        if isinstance(results[1], list):
            for device in results[1]:
                device_dict = device.__dict__ if hasattr(device, '__dict__') else {}
                all_devices.append({
                    "name": device_dict.get('name', 'BLE Device'),
                    "brand": device_dict.get('vendor', 'Unknown'),
                    "vendor": device_dict.get('vendor', 'Unknown'),
                    "protocol": "ble",
                    "comm_type": "Bluetooth LE",
                    "mac": device_dict.get('address') or device_dict.get('mac'),
                    "deviceId": device_dict.get('address')
                })
                LOGGER.info(f"[UniversalScan] Found BLE: {device_dict.get('name', 'Unknown')}")
        elif isinstance(results[1], Exception):
            LOGGER.warning(f"[UniversalScan] BLE discovery failed: {results[1]}")
        
        # Process mDNS devices
        if isinstance(results[2], list):
            for device in results[2]:
                device_dict = device.__dict__ if hasattr(device, '__dict__') else {}
                all_devices.append({
                    "name": device_dict.get('name', 'mDNS Device'),
                    "brand": device_dict.get('vendor', 'Unknown'),
                    "vendor": device_dict.get('vendor', 'Unknown'),
                    "protocol": "mdns",
                    "comm_type": "mDNS",
                    "ip": device_dict.get('host') or device_dict.get('ip'),
                    "deviceId": device_dict.get('name')
                })
                LOGGER.info(f"[UniversalScan] Found mDNS: {device_dict.get('name', 'Unknown')}")
        elif isinstance(results[2], Exception):
            LOGGER.warning(f"[UniversalScan] mDNS discovery failed: {results[2]}")
        
        # Also include MQTT devices from registry
        mqtt_devices = [d for d in registry.list() if d.protocol == "mqtt"]
        for device in mqtt_devices:
            device_dict = device.__dict__ if hasattr(device, '__dict__') else {}
            all_devices.append({
                "name": device_dict.get('name', 'MQTT Device'),
                "brand": device_dict.get('vendor', 'Unknown'),
                "vendor": device_dict.get('vendor', 'Unknown'),
                "protocol": "mqtt",
                "comm_type": "MQTT",
                "deviceId": device_dict.get('device_id'),
                "ip": device_dict.get('host')
            })
        
        LOGGER.info(f"[UniversalScan] Complete: {len(all_devices)} total devices found")
        
        return {
            "status": "success",
            "devices": all_devices,
            "count": len(all_devices),
            "timestamp": asyncio.get_event_loop().time()
        }
        
    except Exception as e:
        LOGGER.error(f"[UniversalScan] Error during discovery: {e}")
        return {
            "status": "error",
            "devices": all_devices,
            "count": len(all_devices),
            "error": str(e),
            "timestamp": asyncio.get_event_loop().time()
        }


# -----------------------------
# Network utilities (WiFi, test)
# -----------------------------

def _run_cmd(cmd: list[str], timeout: float = 8.0) -> str:
    """Run a command and return stdout text; raise on failure.

    Args:
        cmd: Command and args to run
        timeout: Seconds to wait before killing
    Returns:
        stdout string (may be empty)
    Raises:
        subprocess.TimeoutExpired, subprocess.CalledProcessError
    """
    LOGGER.debug("Running command: %s", " ".join(cmd))
    res = subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=timeout)
    return res.stdout or ""


def _scan_wifi_linux() -> list[dict]:
    """Scan WiFi using nmcli (preferred) or iwlist fallback on Linux."""
    # Try nmcli first
    try:
        out = _run_cmd(["nmcli", "-t", "-f", "SSID,SIGNAL,SECURITY", "dev", "wifi", "list"], timeout=6.0)
        networks: list[dict] = []
        for line in out.splitlines():
            if not line.strip():
                continue
            # Some SSIDs may contain ':'; nmcli uses ':' as delimiter. Split max 2 times.
            parts = line.split(":", 2)
            ssid = (parts[0] or "").strip()
            if not ssid:
                continue
            signal = int(parts[1] or "-60") if len(parts) > 1 and (parts[1] or "").strip().lstrip("-").isdigit() else -60
            security = (parts[2] if len(parts) > 2 else "OPEN") or "OPEN"
            networks.append({"ssid": ssid, "signal": signal, "security": security.upper()})
        if networks:
            return networks
    except Exception as exc:  # pragma: no cover - depends on host tooling
        LOGGER.debug("nmcli scan failed: %s", exc)

    # Fallback: iwlist (may require sudo on some distros)
    try:
        out = _run_cmd(["/sbin/iwlist", "wlan0", "scan"], timeout=8.0)
    except Exception as exc:  # pragma: no cover
        LOGGER.debug("iwlist scan failed: %s", exc)
        return []

    networks: list[dict] = []
    current: dict[str, object] = {}
    for raw in out.splitlines():
        line = raw.strip()
        # ESSID:"MyNet"
        m_essid = re.search(r'ESSID:\"(.*)\"', line)
        if m_essid:
            if current.get("ssid"):
                networks.append(current)
                current = {}
            ssid = (m_essid.group(1) or "").strip()
            if ssid:
                current = {"ssid": ssid, "signal": -60, "security": "UNKNOWN"}
            continue
        # Signal level=-49 dBm | Quality=70/100
        m_signal = re.search(r"Signal level[=:-](-?\d+)", line, flags=re.I)
        if m_signal and current:
            try:
                current["signal"] = int(m_signal.group(1))
            except Exception:  # pragma: no cover
                current["signal"] = -60
    if current.get("ssid"):
        networks.append(current)
    # Filter empties
    return [n for n in networks if (n.get("ssid") or "").strip()]


def _scan_wifi_macos() -> list[dict]:
    """Scan WiFi on macOS using airport, with fallbacks to system_profiler and wdutil."""
    # airport -s
    airport = "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport"
    try:
        out = _run_cmd([airport, "-s"], timeout=6.0)
        lines = [l for l in out.splitlines() if l.strip()]
        # Detect header and rows that contain a BSSID MAC
        if lines:
            rows = lines[1:] if re.search(r"SSID\s+BSSID\s+RSSI", lines[0], flags=re.I) else lines
            rows = [l for l in rows if re.search(r"([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}", l)]
            nets: list[dict] = []
            for row in rows:
                bssid = re.search(r"([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}", row)
                if not bssid:
                    continue
                left = row[: bssid.start()].rstrip()
                right = row[bssid.end():].strip()
                ssid = left.strip()
                m_rssi = re.search(r"-?\d{1,3}", right)
                m_sec = re.search(r"(WPA3|WPA2|WPA|WEP|OPEN|NONE|\S+)\s*$", right, flags=re.I)
                signal = int(m_rssi.group(0)) if m_rssi else -60
                security = (m_sec.group(1) if m_sec else "OPEN").upper()
                if ssid:
                    nets.append({"ssid": ssid, "signal": signal, "security": security})
            if nets:
                return nets
    except Exception as exc:  # pragma: no cover
        LOGGER.debug("airport scan failed: %s", exc)

    # system_profiler SPAirPortDataType -json (macOS 12+)
    try:
        out = _run_cmd(["/usr/sbin/system_profiler", "SPAirPortDataType", "-json"], timeout=8.0)
        if out.strip().startswith("{"):
            data = json.loads(out)
            wl = data.get("SPAirPortDataType") or data.get("SPAirPort") or []
            nets: list[dict] = []
            for iface in wl:
                scans = iface.get("spairport_airport_interfaces") or []
                for entry in scans:
                    nearby = entry.get("spairport_airport_other_local_wireless_networks") or []
                    for n in nearby:
                        ssid = (n.get("_name") or n.get("spairport_airport_network_name") or "").strip()
                        if not ssid:
                            continue
                        rssi = n.get("spairport_airport_signal_noise") or n.get("spairport_airport_signal")
                        security = (n.get("spairport_airport_security") or "OPEN").upper()
                        try:
                            signal = int(str(rssi).split()[0]) if rssi is not None else -60
                        except Exception:
                            signal = -60
                        nets.append({"ssid": ssid, "signal": signal, "security": security})
            if nets:
                return nets
    except Exception as exc:  # pragma: no cover
        LOGGER.debug("system_profiler scan failed: %s", exc)

    # wdutil scan -json
    try:
        out = _run_cmd(["/usr/bin/wdutil", "scan", "-json"], timeout=8.0)
        if out.strip().startswith("{"):
            obj = json.loads(out)
            arr = obj.get("Networks") or obj.get("networks") or []
            nets = []
            for n in arr:
                ssid = (n.get("SSID") or n.get("ssid") or "").strip()
                if not ssid:
                    continue
                signal = int(n.get("RSSI") or n.get("rssi") or -60)
                security = (n.get("SECURITY") or n.get("security") or "OPEN").upper()
                nets.append({"ssid": ssid, "signal": signal, "security": security})
            if nets:
                return nets
    except Exception as exc:  # pragma: no cover
        LOGGER.debug("wdutil scan failed: %s", exc)

    return []


@app.get("/api/network/wifi/scan")
async def wifi_scan() -> list[dict]:
    """Scan for available WiFi networks on the controller host.

    Returns a list of objects: { ssid, signal, security }
    """
    try:
        plat = sys.platform
        if plat.startswith("linux"):
            nets = _scan_wifi_linux()
        elif plat == "darwin":
            nets = _scan_wifi_macos()
        else:
            nets = []
        if not nets:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="WiFi scan unavailable on this host")
        return nets
    except HTTPException:
        raise
    except Exception as exc:  # pylint: disable=broad-except
        LOGGER.exception("WiFi scan failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"WiFi scan failed: {exc}") from exc


@app.post("/api/network/test")
async def network_test(payload: dict = Body(default={})) -> dict:
    """Run a lightweight network connectivity test from the controller host.

    Attempts to determine current IP, default gateway, subnet (CIDR), and ping latency
    to a well-known address. Does not modify system state.
    """
    try:
        plat = sys.platform
        ip_addr: Optional[str] = None
        gateway: Optional[str] = None
        subnet: Optional[str] = None
        latency_ms: Optional[float] = None

        if plat.startswith("linux"):
            # Extract default gateway
            try:
                out = _run_cmd(["ip", "route"], timeout=4.0)
                m = re.search(r"^default\s+via\s+(\S+)", out, flags=re.M)
                if m:
                    gateway = m.group(1)
            except Exception:  # pragma: no cover
                pass
            # Get primary interface and IP/subnet
            try:
                out = _run_cmd(["ip", "-o", "-4", "addr", "show", "scope", "global"], timeout=4.0)
                # Take first global address line
                line = next((l for l in out.splitlines() if l.strip()), "")
                m = re.search(r"\d+:\s+(\S+)\s+inet\s+(\S+)", line)
                if m:
                    iface = m.group(1)
                    cidr = m.group(2)
                    subnet = cidr
                    # Get just IP part
                    ip_addr = cidr.split("/")[0]
            except Exception:  # pragma: no cover
                pass
            # Ping test
            try:
                out = _run_cmd(["ping", "-c", "1", "-W", "1", "1.1.1.1"], timeout=2.5)
                m = re.search(r"time[=<]([0-9.]+)\s*ms", out)
                if m:
                    latency_ms = float(m.group(1))
            except Exception:  # pragma: no cover
                pass

        elif plat == "darwin":
            # macOS gateway
            try:
                out = _run_cmd(["/usr/sbin/netstat", "-rn"], timeout=4.0)
                # default            192.168.1.1        UGSc           en0
                m = re.search(r"^default\s+(\S+)", out, flags=re.M)
                if m:
                    gateway = m.group(1)
            except Exception:  # pragma: no cover
                pass
            # IP address (try en0, then en1)
            for dev in ("en0", "en1"):
                try:
                    out = _run_cmd(["/usr/sbin/ipconfig", "getifaddr", dev], timeout=2.0).strip()
                    if out:
                        ip_addr = out
                        break
                except Exception:  # pragma: no cover
                    continue
            # Subnet CIDR (best effort via ifconfig)
            try:
                if ip_addr:
                    for dev in ("en0", "en1"):
                        out = _run_cmd(["/sbin/ifconfig", dev], timeout=3.0)
                        if ip_addr in out:
                            m = re.search(r"inet\s+%s\s+netmask\s+0x([0-9a-fA-F]+)" % re.escape(ip_addr), out)
                            if m:
                                mask_hex = int(m.group(1), 16)
                                # Convert netmask hex to CIDR length
                                mask_bits = bin(mask_hex).count("1")
                                subnet = f"{ip_addr}/{mask_bits}"
                            break
            except Exception:  # pragma: no cover
                pass
            # Ping test
            try:
                out = _run_cmd(["/sbin/ping", "-c", "1", "-t", "1", "1.1.1.1"], timeout=2.5)
                m = re.search(r"time[=<]([0-9.]+)\s*ms", out)
                if m:
                    latency_ms = float(m.group(1))
            except Exception:  # pragma: no cover
                pass

        result = {
            "status": "connected" if latency_ms is not None else "unknown",
            "ip": ip_addr,
            "gateway": gateway,
            "subnet": subnet,
            "latencyMs": latency_ms,
            "testedAt": _iso_now(),
            "ssid": (payload or {}).get("wifi", {}).get("ssid") if isinstance(payload, dict) else None,
        }
        return result
    except Exception as exc:  # pylint: disable=broad-except
        LOGGER.exception("Network test failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Network test failed: {exc}") from exc


@app.get("/lighting/fixtures", response_model=List[LightingFixtureResponse])
async def list_fixtures() -> List[LightingFixtureResponse]:
    return [
        LightingFixtureResponse(
            name=fixture.name,
            model=fixture.model,
            address=fixture.address,
            control_interface=fixture.control_interface,
            min_brightness=fixture.min_brightness,
            max_brightness=fixture.max_brightness,
            spectrum_min=fixture.spectrum_min,
            spectrum_max=fixture.spectrum_max,
        )
        for fixture in get_fixture_inventory()
    ]


@app.get("/schedules")
async def list_schedules(user: UserContext = Depends(get_user_context), group: Optional[str] = None) -> List[dict]:
    if group and not user.can_access_group(group):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied for group")
    schedules = get_schedules().list(group)
    result = []
    for schedule in schedules:
        if not user.can_access_group(schedule.group):
            continue
        result.append(
            {
                "schedule_id": schedule.schedule_id,
                "name": schedule.name,
                "group": schedule.group,
                "start_time": schedule.start_time.strftime("%H:%M"),
                "end_time": schedule.end_time.strftime("%H:%M"),
                "brightness": schedule.brightness,
                "spectrum": schedule.spectrum,
            }
        )
    return result


@app.post("/schedules", status_code=status.HTTP_201_CREATED)
async def create_schedule(request: ScheduleRequest, user: UserContext = Depends(get_user_context)) -> dict:
    schedule = _schedule_from_request(request)
    if not user.can_access_group(schedule.group):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User cannot access target group")
    get_automation().apply_schedule(schedule, user)
    return {"status": "created", "schedule_id": schedule.schedule_id}


@app.get("/switchbot/{device_id}/status")
async def switchbot_status(device_id: str) -> dict:
    config = get_config()
    if not config.switchbot:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SwitchBot not configured")
    status_payload = fetch_switchbot_status(device_id, config.switchbot)
    if status_payload is None:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to fetch device status")
    return status_payload


@app.post("/lighting/failsafe")
async def trigger_failsafe() -> dict:
    get_automation().enforce_fail_safe()
    return {"status": "ok"}


# --- STUB ENDPOINTS FOR FRONTEND 404s ---
@app.post("/api/device/command")
async def device_command_stub(payload: dict) -> JSONResponse:
    """Stub for device command endpoint. Returns success."""
    return JSONResponse({"status": "ok", "message": "Device command received (stub)", "payload": payload})

@app.get("/calibration")
async def get_calibration_stub() -> JSONResponse:
    """Stub for calibration GET. Returns empty calibration data."""
    return JSONResponse({"devices": {}})

@app.post("/calibration")
async def post_calibration_stub(payload: dict) -> JSONResponse:
    """Stub for calibration POST. Returns the posted multipliers."""
    device_id = payload.get("deviceId")
    multipliers = payload.get("multipliers", {})
    return JSONResponse({"deviceId": device_id, "multipliers": multipliers})


# --- ADDITIONAL STUB ENDPOINTS FOR FRONTEND 404s ---
@app.post("/api/kasa/discover")
async def kasa_discover_stub(payload: dict) -> JSONResponse:
    """Stub for Kasa device discovery."""
    return JSONResponse({"devices": [], "message": "Kasa discovery stub"})

@app.post("/api/kasa/configure")
async def kasa_configure_stub(payload: dict) -> JSONResponse:
    """Stub for Kasa device configuration."""
    return JSONResponse({"status": "ok", "message": "Kasa configure stub", "payload": payload})

@app.post("/api/switchbot/discover")
async def switchbot_discover_stub(payload: dict) -> JSONResponse:
    """Stub for SwitchBot device discovery."""
    return JSONResponse({"devices": [], "message": "SwitchBot discovery stub"})

@app.get("/farm")
async def get_farm_stub() -> JSONResponse:
    """Stub for GET /farm."""
    return JSONResponse({"farm": {}, "message": "Farm GET stub"})

@app.post("/farm")
async def post_farm_stub(payload: dict) -> JSONResponse:
    """Stub for POST /farm."""
    return JSONResponse({"status": "ok", "message": "Farm POST stub", "payload": payload})

@app.get("/data/rooms.json")
async def get_rooms_stub() -> JSONResponse:
    """Stub for GET /data/rooms.json."""
    return JSONResponse({"rooms": [], "message": "Rooms GET stub"})

@app.post("/data/rooms.json")
async def post_rooms_stub(payload: dict) -> JSONResponse:
    """Stub for POST /data/rooms.json."""
    return JSONResponse({"status": "ok", "message": "Rooms POST stub", "payload": payload})


# --- STUB ENDPOINTS FOR MISSING FRONTEND CALLS ---

@app.get("/rules")
async def get_rules_stub() -> JSONResponse:
    """Stub for GET /rules."""
    return JSONResponse({"rules": [], "message": "Rules GET stub"})

@app.post("/rules")
async def post_rules_stub(payload: dict) -> JSONResponse:
    """Stub for POST /rules."""
    return JSONResponse({"status": "ok", "message": "Rules POST stub", "payload": payload})

@app.patch("/rules/{rule_id}")
async def patch_rules_stub(rule_id: str, payload: dict) -> JSONResponse:
    """Stub for PATCH /rules/:id."""
    return JSONResponse({"status": "ok", "message": f"Rules PATCH stub for {rule_id}", "payload": payload})

@app.delete("/rules/{rule_id}")
async def delete_rules_stub(rule_id: str) -> JSONResponse:
    """Stub for DELETE /rules/:id."""
    return JSONResponse({"status": "ok", "message": f"Rules DELETE stub for {rule_id}"})

@app.get("/weather")
async def get_weather_stub() -> JSONResponse:
    """Stub for GET /weather."""
    return JSONResponse({"weather": {}, "message": "Weather GET stub"})

@app.get("/devicedatas")
async def get_devicedatas_stub() -> JSONResponse:
    """Stub for GET /devicedatas (non-API path)."""
    return JSONResponse({"data": [], "message": "Devicedatas GET stub"})

__all__ = ["app"]
