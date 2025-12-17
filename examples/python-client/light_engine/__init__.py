"""
Light Engine Charlie Python SDK
Type-safe API client for environmental monitoring and device control
"""

__version__ = "1.0.0"
__author__ = "Light Engine Charlie"

from .client import LightEngineClient, AsyncLightEngineClient
from .models import (
    SensorReading,
    SensorPayload,
    LatestReadingsResponse,
    DiscoveryDevice,
    NetworkTestRequest,
    NetworkTestResponse,
    DeviceCommandRequest,
    LightingFixture,
    FailsafePowerRequest,
    AutomationRule,
    HealthResponse,
)
from .exceptions import (
    LightEngineError,
    APIError,
    TimeoutError,
    AuthenticationError,
)

__all__ = [
    # Clients
    "LightEngineClient",
    "AsyncLightEngineClient",
    # Models
    "SensorReading",
    "SensorPayload",
    "LatestReadingsResponse",
    "DiscoveryDevice",
    "NetworkTestRequest",
    "NetworkTestResponse",
    "DeviceCommandRequest",
    "LightingFixture",
    "FailsafePowerRequest",
    "AutomationRule",
    "HealthResponse",
    # Exceptions
    "LightEngineError",
    "APIError",
    "TimeoutError",
    "AuthenticationError",
]
