"""In-memory state containers for devices, schedules, and lighting."""
from __future__ import annotations

import math
import threading
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from .config import LightingFixture
from .device_models import Device, GroupSchedule, Schedule, SensorEvent


class DeviceRegistry:
    """Thread-safe registry of devices with multi-tenant isolation."""

    def __init__(self) -> None:
        self._devices: Dict[str, Device] = {}
        self._lock = threading.RLock()

    def upsert(self, device: Device) -> None:
        with self._lock:
            self._devices[device.device_id] = device

    def list(self, tenant_id: Optional[str] = None) -> List[Device]:
        """List all devices, optionally filtered by tenant_id."""
        with self._lock:
            if tenant_id is None:
                return list(self._devices.values())
            return [d for d in self._devices.values() if d.tenant_id == tenant_id or d.tenant_id is None]

    def get(self, device_id: str, tenant_id: Optional[str] = None) -> Optional[Device]:
        """Get a device by ID, optionally validating tenant access."""
        with self._lock:
            device = self._devices.get(device_id)
            if device is None:
                return None
            if tenant_id is not None and device.tenant_id is not None and device.tenant_id != tenant_id:
                return None  # Tenant isolation: deny access
            return device

    def by_protocol(self, protocol: str, tenant_id: Optional[str] = None) -> List[Device]:
        """List devices by protocol, optionally filtered by tenant_id."""
        with self._lock:
            devices = [device for device in self._devices.values() if device.protocol == protocol]
            if tenant_id is None:
                return devices
            return [d for d in devices if d.tenant_id == tenant_id or d.tenant_id is None]


class SensorEventBuffer:
    """Fixed-size buffer of sensor events to power automations."""

    def __init__(self, max_events: int = 1000) -> None:
        self._events: List[SensorEvent] = []
        self._max_events = max_events
        self._lock = threading.RLock()

    def add_event(self, event: SensorEvent) -> None:
        with self._lock:
            self._events.append(event)
            if len(self._events) > self._max_events:
                self._events = self._events[-self._max_events :]

    def latest(self, topic: Optional[str] = None) -> Optional[SensorEvent]:
        with self._lock:
            if topic is None:
                return self._events[-1] if self._events else None
            for event in reversed(self._events):
                if event.topic == topic:
                    return event
            return None


def _merge_dicts(base: Dict[str, Any], updates: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively merge two dictionaries without mutating the inputs."""

    merged = dict(base)
    for key, value in updates.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_dicts(merged[key], value)
        else:
            merged[key] = deepcopy(value)
    return merged


def _utc_isoformat(ts: Optional[datetime] = None) -> str:
    moment = ts or datetime.now(timezone.utc)
    return moment.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class LightingState:
    """Track the last known output for fixtures to provide fail-safe defaults."""

    def __init__(self, fixtures: Iterable[LightingFixture]) -> None:
        self._state: Dict[str, Dict[str, int]] = {}
        self._lock = threading.RLock()
        for fixture in fixtures:
            self._state[fixture.address] = {
                "brightness": fixture.min_brightness,
                "spectrum": fixture.spectrum_min,
                "updated_at": int(datetime.utcnow().timestamp()),
            }

    def apply_setting(self, address: str, brightness: int, spectrum: Optional[int] = None) -> Dict[str, int]:
        with self._lock:
            state = self._state.setdefault(
                address,
                {"brightness": brightness, "spectrum": spectrum or 0, "updated_at": 0},
            )
            state["brightness"] = brightness
            if spectrum is not None:
                state["spectrum"] = spectrum
            state["updated_at"] = int(datetime.utcnow().timestamp())
            return dict(state)

    def get_state(self, address: str) -> Optional[Dict[str, int]]:
        with self._lock:
            return self._state.get(address)


class ScheduleStore:
    """In-memory schedule manager with RBAC-aware retrieval."""

    def __init__(self) -> None:
        self._schedules: Dict[str, Schedule] = {}
        self._lock = threading.RLock()

    def upsert(self, schedule: Schedule) -> None:
        with self._lock:
            self._schedules[schedule.schedule_id] = schedule

    def list(self, group: Optional[str] = None, tenant_id: Optional[str] = None) -> List[Schedule]:
        """List schedules, optionally filtered by group and tenant_id."""
        with self._lock:
            schedules = list(self._schedules.values())
            if group is not None:
                schedules = [s for s in schedules if s.group == group]
            if tenant_id is not None:
                schedules = [s for s in schedules if s.tenant_id == tenant_id or s.tenant_id is None]
            return schedules


class GroupScheduleStore:
    """Thread-safe storage for group or device scoped schedules."""

    def __init__(self) -> None:
        self._entries: Dict[str, GroupSchedule] = {}
        self._lock = threading.RLock()

    def upsert(self, schedule: GroupSchedule) -> GroupSchedule:
        with self._lock:
            self._entries[schedule.device_id] = schedule
            return schedule

    def get(self, device_id: str, tenant_id: Optional[str] = None) -> Optional[GroupSchedule]:
        """Get schedule by device_id, optionally validating tenant access."""
        with self._lock:
            schedule = self._entries.get(device_id)
            if schedule is None:
                return None
            if tenant_id is not None and schedule.tenant_id is not None and schedule.tenant_id != tenant_id:
                return None  # Tenant isolation: deny access
            return schedule

    def list(self, group: Optional[str] = None, tenant_id: Optional[str] = None) -> List[GroupSchedule]:
        """List schedules, optionally filtered by group and tenant_id."""
        with self._lock:
            values = list(self._entries.values())
            if group is not None:
                values = [v for v in values if v.target_group() == group]
            if tenant_id is not None:
                values = [v for v in values if v.tenant_id == tenant_id or v.tenant_id is None]
            return values
            return [entry for entry in values if entry.target_group() == group]

    def delete(self, device_id: str) -> None:
        with self._lock:
            self._entries.pop(device_id, None)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()


class PlanStore:
    """Thread-safe storage for lighting plans published via /plans."""

    def __init__(self) -> None:
        self._plans: Dict[str, Dict[str, Any]] = {}
        self._updated: Dict[str, str] = {}
        self._lock = threading.RLock()

    def upsert_many(self, plans: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        with self._lock:
            for key, payload in plans.items():
                if not isinstance(key, str) or not key.strip():
                    continue
                normalized_key = key.strip()
                existing = self._plans.get(normalized_key, {})
                if isinstance(payload, dict):
                    base = existing if isinstance(existing, dict) else {}
                    merged = _merge_dicts(base, payload)
                else:
                    merged = deepcopy(payload)
                self._plans[normalized_key] = merged
                self._updated[normalized_key] = _utc_isoformat()
        return self.list()

    def list(self) -> Dict[str, Dict[str, Any]]:
        with self._lock:
            return {key: deepcopy(value) for key, value in self._plans.items()}

    def get(self, plan_key: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            if plan_key not in self._plans:
                return None
            return deepcopy(self._plans[plan_key])

    def metadata(self) -> Dict[str, Dict[str, str]]:
        with self._lock:
            return {key: {"updatedAt": value} for key, value in self._updated.items()}

    def clear(self) -> None:
        with self._lock:
            self._plans.clear()
            self._updated.clear()


class EnvironmentStateStore:
    """Maintain the latest environmental targets and telemetry configuration."""

    def __init__(self) -> None:
        self._state: Dict[str, Any] = {"rooms": {}, "zones": {}}
        self._lock = threading.RLock()

    def upsert_rooms(self, rooms: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            current_rooms = self._state.get("rooms", {})
            merged = _merge_dicts(current_rooms, rooms)
            self._state["rooms"] = merged
            self._state["updatedAt"] = _utc_isoformat()
            return deepcopy(merged)

    def upsert_zone(self, zone_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            zones = self._state.setdefault("zones", {})
            existing = zones.get(zone_id, {"zoneId": zone_id})
            incoming = dict(payload)
            incoming["zoneId"] = zone_id
            incoming["updatedAt"] = _utc_isoformat()
            zones[zone_id] = _merge_dicts(existing, incoming)
            self._state["updatedAt"] = _utc_isoformat()
            return deepcopy(zones[zone_id])

    def merge(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            self._state = _merge_dicts(self._state, payload)
            self._state["updatedAt"] = _utc_isoformat()
            return self.snapshot()

    def get_zone(self, zone_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            zone = self._state.get("zones", {}).get(zone_id)
            return deepcopy(zone) if zone else None

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return deepcopy(self._state)

    def clear(self) -> None:
        with self._lock:
            self._state = {"rooms": {}, "zones": {}}


class EnvironmentTelemetryStore:
    """Track live environmental telemetry for scopes/rooms with history retention."""

    _ALIASES = {
        "temperature": "tempC",
        "temp": "tempC",
        "tempc": "tempC",
        "temp_c": "tempC",
        "temp_celsius": "tempC",
        "humidity": "rh",
        "relativehumidity": "rh",
        "rel_humidity": "rh",
        "co2": "co2",
        "co₂": "co2",
        "co2ppm": "co2",
        "carbon_dioxide": "co2",
    }

    def __init__(self, retention_hours: int = 168, max_samples: int = 288) -> None:
        self._scopes: Dict[str, Dict[str, Any]] = {}
        self._lookup: Dict[str, str] = {}
        self._retention_seconds = max(retention_hours, 0) * 3600
        self._max_samples = max(max_samples, 1)
        self._lock = threading.RLock()
        self._last_updated: Optional[float] = None

    def _normalise_key(self, key: str) -> Optional[str]:
        if not isinstance(key, str):
            return None
        trimmed = key.strip()
        if not trimmed:
            return None
        lowered = trimmed.lower()
        alias = self._ALIASES.get(lowered)
        if alias:
            return alias
        safe = lowered.replace(" ", "_")
        return safe

    @staticmethod
    def _coerce_value(value: Any) -> Optional[float]:
        if value is None:
            return None
        if isinstance(value, bool):
            return None
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        if not math.isfinite(number):
            return None
        return number

    def add_reading(
        self,
        scope: str,
        timestamp: datetime,
        sensors: Dict[str, Any],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        if not isinstance(scope, str) or not scope.strip():
            raise ValueError("scope must be a non-empty string")
        if not isinstance(timestamp, datetime):
            raise ValueError("timestamp must be a datetime instance")
        if not isinstance(sensors, dict) or not sensors:
            raise ValueError("sensors must be a non-empty mapping")

        scope_key = scope.strip()
        moment = timestamp.astimezone(timezone.utc)
        epoch = moment.timestamp()

        with self._lock:
            entry = self._scopes.setdefault(
                scope_key,
                {
                    "scope": scope_key,
                    "name": scope_key,
                    "sensors": {},
                    "meta": {},
                    "updatedAt": None,
                },
            )
            self._lookup[scope_key.lower()] = scope_key

            if metadata:
                meta = entry.setdefault("meta", {})
                for key, value in metadata.items():
                    if value is None:
                        continue
                    meta[key] = value
                    if key in {"name", "label"} and isinstance(value, str) and value.strip():
                        entry["name"] = value.strip()
                        self._lookup[value.strip().lower()] = scope_key

            sensors_map = entry.setdefault("sensors", {})
            for raw_key, raw_value in sensors.items():
                normalised_key = self._normalise_key(raw_key)
                if not normalised_key:
                    continue
                coerced = self._coerce_value(raw_value)
                if coerced is None:
                    continue
                metric = sensors_map.setdefault(normalised_key, {"samples": []})
                samples = metric.setdefault("samples", [])
                samples.insert(0, {"ts": epoch, "value": coerced})

                if self._retention_seconds:
                    cutoff = epoch - self._retention_seconds
                    samples[:] = [sample for sample in samples if sample["ts"] >= cutoff]
                if len(samples) > self._max_samples:
                    del samples[self._max_samples :]

                metric["current"] = coerced
                metric["updatedAt"] = _utc_isoformat(moment)

            entry["updatedAt"] = _utc_isoformat(moment)
            self._last_updated = epoch
            return self._render_zone(entry)

    def _render_zone(self, entry: Dict[str, Any], range_seconds: Optional[int] = None) -> Dict[str, Any]:
        sensors = {}
        now_epoch = datetime.now(timezone.utc).timestamp()
        for key, metric in entry.get("sensors", {}).items():
            samples = list(metric.get("samples", []))
            if range_seconds:
                cutoff = now_epoch - max(range_seconds, 0)
                samples = [sample for sample in samples if sample["ts"] >= cutoff]
            history = [sample["value"] for sample in samples]
            timestamps = [
                datetime.fromtimestamp(sample["ts"], timezone.utc)
                for sample in samples
            ]
            sensors[key] = {
                "current": metric.get("current"),
                "history": history,
                "timestamps": [
                    ts.isoformat().replace("+00:00", "Z") for ts in timestamps
                ],
                "setpoint": metric.get("setpoint"),
                "updatedAt": metric.get("updatedAt"),
            }

        return {
            "id": entry.get("scope"),
            "scope": entry.get("scope"),
            "name": entry.get("name") or entry.get("scope"),
            "meta": dict(entry.get("meta", {})),
            "sensors": sensors,
            "updatedAt": entry.get("updatedAt"),
        }

    def list_zones(self, range_seconds: Optional[int] = None) -> List[Dict[str, Any]]:
        with self._lock:
            zones = [self._render_zone(entry, range_seconds) for entry in self._scopes.values()]
            return sorted(zones, key=lambda zone: (zone.get("name") or "").lower())

    def get_zone(self, scope: str, range_seconds: Optional[int] = None) -> Optional[Dict[str, Any]]:
        with self._lock:
            entry = self._scopes.get(scope)
            if entry is None and isinstance(scope, str):
                key = self._lookup.get(scope.lower())
                if key:
                    entry = self._scopes.get(key)
            if not entry:
                return None
            return self._render_zone(entry, range_seconds)

    def last_updated(self) -> Optional[str]:
        with self._lock:
            if self._last_updated is None:
                return None
            ts = datetime.fromtimestamp(self._last_updated, timezone.utc)
            return _utc_isoformat(ts)

    def clear(self) -> None:
        with self._lock:
            self._scopes.clear()
            self._lookup.clear()
            self._last_updated = None


class DeviceDataStore:
    """Persist best-effort controller state for /api/devicedatas."""

    def __init__(self) -> None:
        self._entries: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.RLock()

    def upsert(self, device_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            entry = self._entries.get(device_id, {"deviceId": device_id})
            merged = _merge_dicts(entry, payload)
            merged["deviceId"] = device_id
            merged["updatedAt"] = _utc_isoformat()
            self._entries[device_id] = merged
            return deepcopy(merged)

    def get(self, device_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            entry = self._entries.get(device_id)
            return deepcopy(entry) if entry else None

    def list(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [deepcopy(entry) for entry in self._entries.values()]

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()


__all__ = [
    "DeviceRegistry",
    "SensorEventBuffer",
    "LightingState",
    "ScheduleStore",
    "GroupScheduleStore",
    "PlanStore",
    "EnvironmentStateStore",
    "EnvironmentTelemetryStore",
    "DeviceDataStore",
]
