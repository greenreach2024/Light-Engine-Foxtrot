"""Data models for Light Engine API requests and responses"""

from typing import Dict, List, Optional, Any, Literal
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class SensorReading:
    """Individual sensor reading with value and optional unit"""
    value: float
    unit: Optional[str] = None


@dataclass
class SensorPayload:
    """Sensor data ingestion payload"""
    scope: str
    ts: str  # ISO 8601 timestamp
    sensors: Dict[str, SensorReading]
    
    def to_dict(self) -> dict:
        return {
            "scope": self.scope,
            "ts": self.ts,
            "sensors": {
                k: {"value": v.value, "unit": v.unit} if isinstance(v, SensorReading)
                else {"value": v["value"], "unit": v.get("unit")}
                for k, v in self.sensors.items()
            }
        }


@dataclass
class LatestReadingsResponse:
    """Latest sensor readings for a scope"""
    scope: str
    sensors: Dict[str, Any]
    observedAt: str


@dataclass
class DiscoveryDevice:
    """Discovered device metadata"""
    id: str
    name: str
    protocol: Literal["kasa", "mqtt", "ble", "mdns"]
    host: Optional[str] = None
    mac: Optional[str] = None
    model: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class NetworkTestRequest:
    """Network connectivity test request"""
    host: str
    port: int = 1883
    protocol: str = "mqtt"
    
    def to_dict(self) -> dict:
        return {
            "host": self.host,
            "port": self.port,
            "protocol": self.protocol
        }


@dataclass
class NetworkTestResponse:
    """Network connectivity test response"""
    success: bool
    reachable: bool
    host: str
    port: int
    protocol: str
    message: str
    error: Optional[str] = None
    timestamp: Optional[str] = None


@dataclass
class DeviceCommandRequest:
    """Device command request"""
    device_id: str
    command: Dict[str, Any]
    
    def to_dict(self) -> dict:
        return {
            "device_id": self.device_id,
            "command": self.command
        }


@dataclass
class LightingFixture:
    """Lighting fixture metadata"""
    id: str
    name: str
    protocol: str
    channels: Optional[List[str]] = None
    max_brightness: Optional[int] = None


@dataclass
class FailsafePowerRequest:
    """Emergency failsafe power control request"""
    fixtures: List[str]
    power: Literal["on", "off"]
    brightness: int = 100
    
    def to_dict(self) -> dict:
        return {
            "fixtures": self.fixtures,
            "power": self.power,
            "brightness": self.brightness
        }


@dataclass
class AutomationRule:
    """Automation rule definition"""
    name: str
    enabled: bool = True
    conditions: Dict[str, Any] = field(default_factory=dict)
    actions: Dict[str, Any] = field(default_factory=dict)
    priority: int = 0
    rule_id: Optional[str] = None
    
    def to_dict(self) -> dict:
        result = {
            "name": self.name,
            "enabled": self.enabled,
            "conditions": self.conditions,
            "actions": self.actions,
            "priority": self.priority
        }
        if self.rule_id:
            result["rule_id"] = self.rule_id
        return result


@dataclass
class HealthResponse:
    """API health check response"""
    status: str
    version: Optional[str] = None
    uptime: Optional[int] = None
    timestamp: Optional[str] = None
