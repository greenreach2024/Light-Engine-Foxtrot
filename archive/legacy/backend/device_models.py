"""Dataclasses for device and scheduling models."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from typing import Any, Dict, List, Optional


@dataclass
class Device:
    """Represents a discovered device regardless of protocol."""

    device_id: str
    name: str
    category: str
    protocol: str
    online: bool
    tenant_id: Optional[str] = None  # Multi-tenant isolation
    capabilities: Dict[str, Any] = field(default_factory=dict)
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SensorEvent:
    """Represents a sensor update received via MQTT."""

    topic: str
    payload: Dict[str, Any]
    received_at: datetime


@dataclass
class Schedule:
    """Lighting schedule definition."""

    schedule_id: str
    name: str
    group: str
    start_time: time
    end_time: time
    brightness: int
    tenant_id: Optional[str] = None  # Multi-tenant isolation
    spectrum: Optional[int] = None


@dataclass
class PhotoperiodScheduleConfig:
    """Structured representation of a photoperiod schedule payload."""

    start: time
    duration_hours: int
    ramp_up_minutes: int
    ramp_down_minutes: int

    def as_dict(self) -> Dict[str, Any]:
        return {
            "type": "photoperiod",
            "start": self.start.strftime("%H:%M"),
            "durationHours": self.duration_hours,
            "rampUpMin": self.ramp_up_minutes,
            "rampDownMin": self.ramp_down_minutes,
        }


@dataclass
class GroupSchedule:
    """Persisted schedule definition scoped to a lighting group or device."""

    device_id: str
    plan_key: Optional[str]
    seed_date: date
    schedule: PhotoperiodScheduleConfig
    tenant_id: Optional[str] = None  # Multi-tenant isolation
    override: Optional[Dict[str, Any]] = None
    offsets: Dict[str, int] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def target_group(self) -> Optional[str]:
        if self.device_id.startswith("group:"):
            group = self.device_id.split(":", 1)[1].strip()
            return group or None
        return None

    def to_response_payload(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "deviceId": self.device_id,
            "seedDate": self.seed_date.isoformat(),
            "schedule": self.schedule.as_dict(),
            "offsets": dict(self.offsets),
            "updatedAt": self.updated_at.astimezone(timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z"),
        }
        if self.plan_key:
            payload["planKey"] = self.plan_key
        if self.override:
            payload["override"] = dict(self.override)
        if self.metadata:
            payload["metadata"] = dict(self.metadata)
        return payload


@dataclass
class UserContext:
    """Represents the authenticated user making a request."""

    user_id: str
    groups: List[str]
    tenant_id: str  # Tenant this user belongs to (required for auth)

    def can_access_group(self, group: str) -> bool:
        return group in self.groups
    
    def can_access_tenant(self, tenant_id: str) -> bool:
        """Check if user can access the specified tenant."""
        return self.tenant_id == tenant_id


__all__ = [
    "Device",
    "SensorEvent",
    "Schedule",
    "UserContext",
    "PhotoperiodScheduleConfig",
    "GroupSchedule",
]
