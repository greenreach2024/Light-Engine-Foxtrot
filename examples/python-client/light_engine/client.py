"""
Light Engine Charlie Python SDK Client
Synchronous and asynchronous HTTP clients with full type hints
"""

import asyncio
import requests
import aiohttp
from typing import Dict, List, Optional, Any
from urllib.parse import urlencode

from .models import (
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
from .exceptions import APIError, TimeoutError as SDKTimeoutError, AuthenticationError


class LightEngineClient:
    """
    Synchronous HTTP client for Light Engine Charlie API
    
    Example:
        client = LightEngineClient("http://localhost:8000")
        health = client.health()
        print(f"Status: {health['status']}")
    """
    
    def __init__(
        self,
        base_url: str = "http://localhost:8000",
        timeout: int = 10,
        api_key: Optional[str] = None
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.api_key = api_key
        self.session = requests.Session()
        
        if api_key:
            self.session.headers["Authorization"] = f"Bearer {api_key}"
    
    def _request(
        self,
        method: str,
        endpoint: str,
        data: Optional[dict] = None,
        params: Optional[dict] = None
    ) -> dict:
        """Make HTTP request with error handling"""
        url = f"{self.base_url}{endpoint}"
        
        try:
            response = self.session.request(
                method=method,
                url=url,
                json=data,
                params=params,
                timeout=self.timeout
            )
            
            if not response.ok:
                error_data = response.json() if response.content else {}
                raise APIError(
                    message=error_data.get("detail", f"HTTP {response.status_code}"),
                    status_code=response.status_code,
                    detail=error_data.get("detail")
                )
            
            return response.json()
        
        except requests.Timeout as e:
            raise SDKTimeoutError(f"Request timed out after {self.timeout}s") from e
        except requests.RequestException as e:
            raise APIError(f"Request failed: {str(e)}") from e
    
    # =========================================================================
    # Health & Status
    # =========================================================================
    
    def health(self) -> dict:
        """Get API health status"""
        return self._request("GET", "/health")
    
    # =========================================================================
    # Environmental Sensors
    # =========================================================================
    
    def ingest_sensor_data(self, payload: SensorPayload) -> dict:
        """Ingest sensor data"""
        return self._request("POST", "/api/env/ingest", data=payload.to_dict())
    
    def get_latest_readings(self, scope: str) -> dict:
        """Get latest sensor readings for a scope"""
        return self._request("GET", "/api/env/latest", params={"scope": scope})
    
    def get_sensor_history(
        self,
        scope: str,
        sensor: str,
        limit: int = 50
    ) -> dict:
        """Get historical sensor data"""
        params = {"scope": scope, "sensor": sensor, "limit": limit}
        return self._request("GET", "/api/env/history", params=params)
    
    def get_scopes(self) -> dict:
        """List all sensor scopes"""
        return self._request("GET", "/api/env/scopes")
    
    # =========================================================================
    # Device Discovery
    # =========================================================================
    
    def trigger_discovery(self) -> dict:
        """Trigger device discovery scan"""
        return self._request("POST", "/discovery/run")
    
    def get_discovered_devices(self) -> dict:
        """Get all discovered devices"""
        return self._request("GET", "/discovery/devices")
    
    def get_kasa_devices(self) -> dict:
        """Get TP-Link Kasa devices"""
        return self._request("GET", "/api/devices/kasa")
    
    def get_mqtt_devices(self) -> dict:
        """Get MQTT devices"""
        return self._request("GET", "/api/devices/mqtt")
    
    def get_ble_devices(self) -> dict:
        """Get Bluetooth LE devices"""
        return self._request("GET", "/api/devices/ble")
    
    def get_mdns_devices(self) -> dict:
        """Get mDNS/Bonjour devices"""
        return self._request("GET", "/api/devices/mdns")
    
    def get_devices(self) -> dict:
        """Get all registered devices"""
        return self._request("GET", "/devices")
    
    # =========================================================================
    # Network Diagnostics
    # =========================================================================
    
    def test_network_connection(self, request: NetworkTestRequest) -> dict:
        """Test network connectivity to a host"""
        return self._request("POST", "/api/network/test", data=request.to_dict())
    
    def scan_wifi_networks(self) -> dict:
        """Scan for available WiFi networks"""
        return self._request("GET", "/api/network/wifi/scan")
    
    # =========================================================================
    # Device Control
    # =========================================================================
    
    def send_device_command(self, request: DeviceCommandRequest) -> dict:
        """Send command to a device"""
        return self._request("POST", "/api/device/command", data=request.to_dict())
    
    # =========================================================================
    # Lighting Management
    # =========================================================================
    
    def get_lighting_fixtures(self) -> dict:
        """Get all lighting fixtures"""
        return self._request("GET", "/lighting/fixtures")
    
    def lighting_failsafe(self, request: FailsafePowerRequest) -> dict:
        """Emergency lighting power control"""
        return self._request("POST", "/lighting/failsafe", data=request.to_dict())
    
    # =========================================================================
    # Automation Rules
    # =========================================================================
    
    def list_rules(self) -> dict:
        """List all automation rules"""
        return self._request("GET", "/rules")
    
    def create_rule(self, rule: AutomationRule) -> dict:
        """Create new automation rule"""
        return self._request("POST", "/rules", data=rule.to_dict())
    
    def update_rule(self, rule_id: str, updates: dict) -> dict:
        """Update automation rule"""
        return self._request("PATCH", f"/rules/{rule_id}", data=updates)
    
    def delete_rule(self, rule_id: str) -> dict:
        """Delete automation rule"""
        return self._request("DELETE", f"/rules/{rule_id}")
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.session.close()


class AsyncLightEngineClient:
    """
    Asynchronous HTTP client for Light Engine Charlie API
    
    Example:
        async with AsyncLightEngineClient("http://localhost:8000") as client:
            health = await client.health()
            print(f"Status: {health['status']}")
    """
    
    def __init__(
        self,
        base_url: str = "http://localhost:8000",
        timeout: int = 10,
        api_key: Optional[str] = None
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = aiohttp.ClientTimeout(total=timeout)
        self.api_key = api_key
        self._session: Optional[aiohttp.ClientSession] = None
    
    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create aiohttp session"""
        if self._session is None or self._session.closed:
            headers = {}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            self._session = aiohttp.ClientSession(headers=headers)
        return self._session
    
    async def _request(
        self,
        method: str,
        endpoint: str,
        data: Optional[dict] = None,
        params: Optional[dict] = None
    ) -> dict:
        """Make async HTTP request with error handling"""
        url = f"{self.base_url}{endpoint}"
        session = await self._get_session()
        
        try:
            async with session.request(
                method=method,
                url=url,
                json=data,
                params=params,
                timeout=self.timeout
            ) as response:
                if not response.ok:
                    error_data = await response.json() if response.content_length else {}
                    raise APIError(
                        message=error_data.get("detail", f"HTTP {response.status}"),
                        status_code=response.status,
                        detail=error_data.get("detail")
                    )
                
                return await response.json()
        
        except asyncio.TimeoutError as e:
            raise SDKTimeoutError(f"Request timed out") from e
        except aiohttp.ClientError as e:
            raise APIError(f"Request failed: {str(e)}") from e
    
    # =========================================================================
    # Health & Status
    # =========================================================================
    
    async def health(self) -> dict:
        """Get API health status"""
        return await self._request("GET", "/health")
    
    # =========================================================================
    # Environmental Sensors
    # =========================================================================
    
    async def ingest_sensor_data(self, payload: SensorPayload) -> dict:
        """Ingest sensor data"""
        return await self._request("POST", "/api/env/ingest", data=payload.to_dict())
    
    async def get_latest_readings(self, scope: str) -> dict:
        """Get latest sensor readings for a scope"""
        return await self._request("GET", "/api/env/latest", params={"scope": scope})
    
    async def get_sensor_history(
        self,
        scope: str,
        sensor: str,
        limit: int = 50
    ) -> dict:
        """Get historical sensor data"""
        params = {"scope": scope, "sensor": sensor, "limit": limit}
        return await self._request("GET", "/api/env/history", params=params)
    
    async def get_scopes(self) -> dict:
        """List all sensor scopes"""
        return await self._request("GET", "/api/env/scopes")
    
    # =========================================================================
    # Device Discovery
    # =========================================================================
    
    async def trigger_discovery(self) -> dict:
        """Trigger device discovery scan"""
        return await self._request("POST", "/discovery/run")
    
    async def get_discovered_devices(self) -> dict:
        """Get all discovered devices"""
        return await self._request("GET", "/discovery/devices")
    
    async def get_kasa_devices(self) -> dict:
        """Get TP-Link Kasa devices"""
        return await self._request("GET", "/api/devices/kasa")
    
    async def get_mqtt_devices(self) -> dict:
        """Get MQTT devices"""
        return await self._request("GET", "/api/devices/mqtt")
    
    async def get_ble_devices(self) -> dict:
        """Get Bluetooth LE devices"""
        return await self._request("GET", "/api/devices/ble")
    
    async def get_mdns_devices(self) -> dict:
        """Get mDNS/Bonjour devices"""
        return await self._request("GET", "/api/devices/mdns")
    
    async def get_devices(self) -> dict:
        """Get all registered devices"""
        return await self._request("GET", "/devices")
    
    # =========================================================================
    # Network Diagnostics
    # =========================================================================
    
    async def test_network_connection(self, request: NetworkTestRequest) -> dict:
        """Test network connectivity to a host"""
        return await self._request("POST", "/api/network/test", data=request.to_dict())
    
    async def scan_wifi_networks(self) -> dict:
        """Scan for available WiFi networks"""
        return await self._request("GET", "/api/network/wifi/scan")
    
    # =========================================================================
    # Device Control
    # =========================================================================
    
    async def send_device_command(self, request: DeviceCommandRequest) -> dict:
        """Send command to a device"""
        return await self._request("POST", "/api/device/command", data=request.to_dict())
    
    # =========================================================================
    # Lighting Management
    # =========================================================================
    
    async def get_lighting_fixtures(self) -> dict:
        """Get all lighting fixtures"""
        return await self._request("GET", "/lighting/fixtures")
    
    async def lighting_failsafe(self, request: FailsafePowerRequest) -> dict:
        """Emergency lighting power control"""
        return await self._request("POST", "/lighting/failsafe", data=request.to_dict())
    
    # =========================================================================
    # Automation Rules
    # =========================================================================
    
    async def list_rules(self) -> dict:
        """List all automation rules"""
        return await self._request("GET", "/rules")
    
    async def create_rule(self, rule: AutomationRule) -> dict:
        """Create new automation rule"""
        return await self._request("POST", "/rules", data=rule.to_dict())
    
    async def update_rule(self, rule_id: str, updates: dict) -> dict:
        """Update automation rule"""
        return await self._request("PATCH", f"/rules/{rule_id}", data=updates)
    
    async def delete_rule(self, rule_id: str) -> dict:
        """Delete automation rule"""
        return await self._request("DELETE", f"/rules/{rule_id}")
    
    async def close(self):
        """Close the aiohttp session"""
        if self._session and not self._session.closed:
            await self._session.close()
    
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
