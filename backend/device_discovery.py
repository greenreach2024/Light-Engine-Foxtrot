"""Device discovery routines for the supported protocols."""
from __future__ import annotations

import asyncio
from concurrent.futures import Future
import json
import logging
from datetime import datetime
from typing import Any, Awaitable, Callable, Dict, List, Optional

import requests

# Initialize logger first
LOGGER = logging.getLogger(__name__)

# Lazy imports for optional dependencies
KASA_AVAILABLE = False
BLEAK_AVAILABLE = False
ZEROCONF_AVAILABLE = False
MQTT_AVAILABLE = False

try:
    import paho.mqtt.client as mqtt
    MQTT_AVAILABLE = True
except ImportError:
    LOGGER.warning("paho-mqtt not available. MQTT discovery disabled.")

try:
    from kasa import Discover  # type: ignore
    KASA_AVAILABLE = True
except ImportError:
    LOGGER.warning("python-kasa not available. Kasa discovery disabled.")

try:
    from bleak import BleakScanner
    BLEAK_AVAILABLE = True
except ImportError:
    LOGGER.warning("bleak not available. Bluetooth LE discovery disabled.")

try:
    from zeroconf import ServiceBrowser, ServiceListener, Zeroconf
    ZEROCONF_AVAILABLE = True
except ImportError:
    LOGGER.warning("zeroconf not available. mDNS discovery disabled.")

from .config import MQTTConfig, SwitchBotConfig
from .device_models import Device, SensorEvent
from .state import DeviceRegistry, SensorEventBuffer


def _log_future_exception(future: Future) -> None:
    exc = future.exception()
    if exc is not None:
        LOGGER.error("MQTT event handler error: %s", exc)


async def discover_kasa_devices(
    registry: DeviceRegistry,
    timeout: int,
) -> List[Device]:
    """Discover TP-Link Kasa devices on the local network."""
    
    if not KASA_AVAILABLE:
        LOGGER.warning("Kasa discovery requested but python-kasa not available")
        return []

    LOGGER.debug("Starting Kasa device discovery with timeout=%s", timeout)
    try:
        devices = await Discover.discover(timeout=timeout)
    except Exception as exc:  # pylint: disable=broad-except
        LOGGER.error("Kasa discovery failed: %s", exc)
        return []

    discovered: List[Device] = []
    for address, kasa_device in devices.items():
        try:
            await kasa_device.update()
            device = Device(
                device_id=kasa_device.device_id,
                name=kasa_device.alias,
                category=kasa_device.device_type,
                protocol="kasa",
                online=True,
                capabilities={
                    "on_off": True,
                    "dimmable": getattr(kasa_device, "is_dimmable", False),
                    "emeter": getattr(kasa_device, "has_emeter", False),
                },
                details={
                    "host": address,
                    "model": kasa_device.model,
                },
            )
        except Exception as exc:  # pylint: disable=broad-except
            LOGGER.warning("Failed to update Kasa device at %s: %s", address, exc)
            continue

        registry.upsert(device)
        discovered.append(device)
        LOGGER.info("Discovered Kasa device %s (%s)", device.name, address)

    return discovered


class _MQTTDiscoveryClient:
    """Temporary MQTT client that captures retained device messages."""

    def __init__(
        self,
        config: MQTTConfig,
        buffer: SensorEventBuffer,
        registry: DeviceRegistry,
        event_handler: Optional[Callable[[SensorEvent], Awaitable[None]]] = None,
    ) -> None:
        self._config = config
        self._buffer = buffer
        self._registry = registry
        self._event_handler = event_handler
        self._loop = asyncio.get_event_loop()
        self._client = mqtt.Client()
        if config.username:
            self._client.username_pw_set(config.username, config.password)

        self._client.on_connect = self._on_connect
        self._client.on_message = self._on_message

    def _on_connect(self, client: mqtt.Client, userdata, flags, rc) -> None:  # type: ignore[override]
        if rc != 0:
            LOGGER.error("Failed to connect to MQTT broker: rc=%s", rc)
            return
        LOGGER.info("Connected to MQTT broker %s:%s", self._config.host, self._config.port)
        client.subscribe(self._config.topics)

    def _on_message(self, client: mqtt.Client, userdata, message: mqtt.MQTTMessage) -> None:  # type: ignore[override]
        try:
            payload = json.loads(message.payload.decode("utf-8"))
        except json.JSONDecodeError:
            LOGGER.warning("Ignoring non-JSON MQTT payload from %s", message.topic)
            return

        event = SensorEvent(topic=message.topic, payload=payload, received_at=datetime.utcnow())
        self._buffer.add_event(event)

        device_id = payload.get("device_id") or message.topic
        device = Device(
            device_id=device_id,
            name=payload.get("name", device_id),
            category=payload.get("category", "sensor"),
            protocol="mqtt",
            online=True,
            capabilities=payload.get("capabilities", {}),
            details={
                "topic": message.topic,
                "last_seen": datetime.utcnow().isoformat(),
            },
        )
        self._registry.upsert(device)

        if self._event_handler:
            future = asyncio.run_coroutine_threadsafe(self._event_handler(event), self._loop)
            future.add_done_callback(_log_future_exception)

    def connect(self) -> None:
        self._client.connect(self._config.host, self._config.port, keepalive=30)

    def disconnect(self) -> None:
        try:
            self._client.disconnect()
        except Exception as exc:  # pylint: disable=broad-except
            LOGGER.warning("Error disconnecting MQTT client: %s", exc)

    async def run(self, duration: float) -> None:
        self.connect()
        self._client.loop_start()
        try:
            await asyncio.sleep(duration)
        finally:
            self._client.loop_stop()
            self.disconnect()


async def discover_mqtt_devices(
    registry: DeviceRegistry,
    buffer: SensorEventBuffer,
    config: MQTTConfig,
    listen_seconds: float = 5.0,
    event_handler: Optional[Callable[[SensorEvent], Awaitable[None]]] = None,
) -> None:
    """Subscribe to MQTT topics to populate devices."""
    
    if not MQTT_AVAILABLE:
        LOGGER.warning("MQTT discovery requested but paho-mqtt not available")
        return

    LOGGER.debug("Beginning MQTT discovery window of %s seconds", listen_seconds)
    client = _MQTTDiscoveryClient(config=config, buffer=buffer, registry=registry, event_handler=event_handler)
    try:
        await client.run(listen_seconds)
    except Exception as exc:  # pylint: disable=broad-except
        LOGGER.error("MQTT discovery failed: %s", exc)


def _switchbot_request(path: str, config: SwitchBotConfig) -> Optional[Dict[str, Any]]:
    url = f"{config.base_url}{path}"
    headers = config.base_headers
    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
    except requests.RequestException as exc:
        LOGGER.error("SwitchBot request to %s failed: %s", path, exc)
        return None

    try:
        payload = response.json()
    except ValueError as exc:
        LOGGER.error("Invalid SwitchBot JSON: %s", exc)
        return None

    status_code = payload.get("statusCode")
    if status_code != 100:
        LOGGER.error("SwitchBot API error %s: %s", status_code, payload)
        return None

    return payload.get("body")


def discover_switchbot_devices(registry: DeviceRegistry, config: SwitchBotConfig) -> List[Device]:
    """Fetch device list from the SwitchBot Cloud API."""

    body = _switchbot_request("/devices", config)
    if not body:
        return []

    devices: List[Device] = []
    for entry in body.get("deviceList", []):
        device = Device(
            device_id=entry["deviceId"],
            name=entry.get("deviceName", entry["deviceId"]),
            category=entry.get("deviceType", "switchbot"),
            protocol="switchbot",
            online=entry.get("enableCloudService", True),
            capabilities={"commands": entry.get("commands", [])},
            details={"hub": entry.get("hubDeviceId")},
        )
        registry.upsert(device)
        devices.append(device)
        LOGGER.info("Discovered SwitchBot device %s", device.name)

    return devices


def fetch_switchbot_status(device_id: str, config: SwitchBotConfig) -> Optional[Dict[str, Any]]:
    body = _switchbot_request(f"/devices/{device_id}/status", config)
    if body is None:
        return None
    return body


async def discover_ble_devices(registry: DeviceRegistry, scan_duration: float = 10.0) -> List[Device]:
    """Discover Bluetooth Low Energy devices."""
    
    if not BLEAK_AVAILABLE:
        LOGGER.warning("Bleak not available - BLE discovery disabled")
        return []
    
    LOGGER.debug("Starting BLE device discovery for %s seconds", scan_duration)
    devices: List[Device] = []
    
    try:
        discovered = await BleakScanner.discover(timeout=scan_duration, return_adv=True)
        for device_address, (device, advertisement_data) in discovered.items():
            # Filter out devices without names or services (likely not IoT devices)
            if not device.name and not advertisement_data.service_uuids:
                continue

            # Extract manufacturer info if present
            manufacturer_data = dict(advertisement_data.manufacturer_data) if advertisement_data.manufacturer_data else {}
            # JSON-safe transform: encode manufacturer payload bytes as hex strings
            safe_manufacturer_data: Dict[int, Any] = {}
            for cid, payload in manufacturer_data.items():
                if isinstance(payload, (bytes, bytearray)):
                    safe_manufacturer_data[cid] = payload.hex()
                else:
                    try:
                        safe_manufacturer_data[cid] = str(payload)
                    except Exception:
                        safe_manufacturer_data[cid] = None
            vendor = None
            if manufacturer_data:
                # BLE manufacturer data keys are 16-bit company IDs; try to map to a known vendor
                # For Samsung, the company ID is 0x0075 (117)
                company_id_map = {
                    0x0075: "Samsung",
                    0x004C: "Apple",
                    0x0006: "Microsoft",
                    0x000F: "Broadcom",
                    0x003D: "Google",
                    0x0131: "Sony",
                    0x00E0: "LG Electronics",
                    0x0171: "Amazon",
                    0x00C7: "Fitbit",
                    0x00D2: "Garmin",
                    0x00A0: "Bosch",
                    0x00E1: "Lenovo",
                    0x00A4: "Huawei",
                    0x00E2: "Nokia",
                    0x00A9: "HTC",
                    0x00B0: "Intel",
                    0x00B1: "Cisco",
                    0x00B2: "Motorola",
                    0x00B3: "Texas Instruments",
                    0x00B4: "STMicroelectronics",
                    0x00B5: "Infineon",
                    0x00B6: "Qualcomm",
                    0x00B7: "NXP",
                    0x00B8: "Dialog Semiconductor",
                    0x00B9: "Nordic Semiconductor",
                    0x00BA: "Silicon Labs",
                    0x00BB: "Dialog Semiconductor",
                    0x00BC: "Xiaomi",
                    0x00BD: "Oppo",
                    0x00BE: "Vivo",
                    0x00BF: "Realtek",
                }
                for cid in manufacturer_data.keys():
                    if cid in company_id_map:
                        vendor = company_id_map[cid]
                        break
                    # fallback: show hex if not mapped
                    vendor = f"0x{cid:04X}"

            # Service data may contain bytes; convert to hex strings and ensure keys are strings
            raw_service_data = dict(advertisement_data.service_data) if advertisement_data.service_data else {}
            safe_service_data: Dict[str, Any] = {}
            for key, payload in raw_service_data.items():
                key_text = str(key)
                if isinstance(payload, (bytes, bytearray)):
                    safe_service_data[key_text] = payload.hex()
                else:
                    try:
                        safe_service_data[key_text] = str(payload)
                    except Exception:
                        safe_service_data[key_text] = None

            device_obj = Device(
                device_id=device.address,
                name=device.name or f"BLE Device {device.address[-8:]}",
                category="ble-peripheral",
                protocol="bluetooth-le",
                online=True,
                capabilities={
                    "services": list(advertisement_data.service_uuids),
                    "connectable": True,
                },
                details={
                    "address": device.address,
                    "rssi": advertisement_data.rssi,
                    "manufacturer_data": safe_manufacturer_data,
                    "service_data": safe_service_data,
                },
            )
            # Attach vendor as top-level field if found
            if vendor:
                setattr(device_obj, 'vendor', vendor)
            registry.upsert(device_obj)
            devices.append(device_obj)
            LOGGER.info("Discovered BLE device %s (%s) vendor=%s", device_obj.name, device.address, vendor)
    except Exception as exc:
        LOGGER.error("BLE discovery failed: %s", exc)
    return devices


if ZEROCONF_AVAILABLE:
    class mDNSListener(ServiceListener):
        """Service listener for mDNS device discovery."""
        
        def __init__(self, registry: DeviceRegistry):
            self.registry = registry
            self.discovered_devices: List[Device] = []
        
        def add_service(self, zc: Zeroconf, type_: str, name: str) -> None:
            info = zc.get_service_info(type_, name)
            if info:
                device = Device(
                    device_id=f"mdns:{name}",
                    name=name.split('.')[0],  # Remove service type from name
                    category="network-service",
                    protocol="mdns",
                    online=True,
                    capabilities={
                        "service_type": type_,
                        "port": info.port,
                    },
                    details={
                        "addresses": [addr for addr in info.parsed_addresses()],
                        "port": info.port,
                        "service_type": type_,
                        "properties": {
                            (k.decode('utf-8') if k is not None else ""): (v.decode('utf-8') if v is not None else "")
                            for k, v in info.properties.items()
                        },
                    },
                )
                self.registry.upsert(device)
                self.discovered_devices.append(device)
                LOGGER.info("Discovered mDNS service %s (%s)", device.name, type_)

        def update_service(self, zc, type_, name):
            # No-op implementation to avoid NotImplementedError
            pass
else:
    # Dummy class when zeroconf not available
    class mDNSListener:
        def __init__(self, registry: DeviceRegistry):
            self.registry = registry
            self.discovered_devices: List[Device] = []


async def discover_mdns_devices(registry: DeviceRegistry, scan_duration: float = 10.0) -> List[Device]:
    """Discover devices via mDNS/Bonjour."""
    
    if not ZEROCONF_AVAILABLE:
        LOGGER.warning("Zeroconf not available - mDNS discovery disabled")
        return []
    
    LOGGER.debug("Starting mDNS device discovery for %s seconds", scan_duration)
    
    zc = Zeroconf()
    listener = mDNSListener(registry)
    
    # Common IoT device service types
    service_types = [
        "_http._tcp.local.",
        "_https._tcp.local.", 
        "_ipp._tcp.local.",
        "_airplay._tcp.local.",
        "_homekit._tcp.local.",
        "_hap._tcp.local.",
        "_matter._tcp.local.",
        "_thread._tcp.local.",
        "_meshcop._tcp.local.",
        "_kasa._tcp.local.",
        "_tplink._tcp.local.",
    ]
    
    try:
        browsers = []
        for service_type in service_types:
            browser = ServiceBrowser(zc, service_type, listener)
            browsers.append(browser)
        
        # Let discovery run for specified duration
        await asyncio.sleep(scan_duration)
        
    except Exception as exc:
        LOGGER.error("mDNS discovery failed: %s", exc)
    finally:
        zc.close()
    
    return listener.discovered_devices


async def full_discovery_cycle(
    config,
    registry: DeviceRegistry,
    buffer: SensorEventBuffer,
    event_handler: Optional[Callable[[SensorEvent], Awaitable[None]]] = None,
    logger: Optional[logging.Logger] = None,
) -> None:
    """Run discovery for all protocols with graceful error handling."""

    # If a caller provides a logger, use it for local logging; otherwise fall back to module LOGGER
    log = logger or LOGGER

    tasks: List[asyncio.Future] = []
    
    # WiFi/Network device discovery
    tasks.append(asyncio.ensure_future(discover_kasa_devices(registry=registry, timeout=config.kasa_discovery_timeout)))
    
    # mDNS/Bonjour discovery
    tasks.append(asyncio.ensure_future(discover_mdns_devices(registry=registry, scan_duration=5.0)))
    
    # BLE device discovery
    tasks.append(asyncio.ensure_future(discover_ble_devices(registry=registry, scan_duration=8.0)))

    # MQTT device discovery
    if config.mqtt:
        tasks.append(
            asyncio.ensure_future(
                discover_mqtt_devices(
                    registry=registry,
                    buffer=buffer,
                    config=config.mqtt,
                    event_handler=event_handler,
                )
            )
        )

    # SwitchBot Cloud API discovery
    if config.switchbot:
        loop = asyncio.get_event_loop()
        tasks.append(loop.run_in_executor(None, discover_switchbot_devices, registry, config.switchbot))

    results = await asyncio.gather(*tasks, return_exceptions=True)
    for result in results:
        if isinstance(result, Exception):
            # Prefer caller-supplied logger when available
            log.error("Discovery task raised error: %s", result)


async def discover_serial_devices(registry: DeviceRegistry) -> List[Device]:
    """Discover USB serial devices (ESP32, Arduino sensors).
    
    Scans USB serial ports for environmental sensors and other serial devices.
    Detects ESP32 BME680 sensors and similar devices by attempting to read
    JSON-formatted sensor data.
    """
    
    devices: List[Device] = []
    
    try:
        import serial.tools.list_ports
        import serial
        import time
    except ImportError:
        LOGGER.warning("pyserial not available - USB serial discovery disabled")
        return []
    
    LOGGER.debug("Starting USB serial device discovery")
    
    try:
        # Scan for USB serial ports
        ports = serial.tools.list_ports.comports()
        
        for port in ports:
            # Filter for USB serial devices (ESP32, Arduino, FTDI)
            description = port.description.lower() if port.description else ""
            manufacturer = str(port.manufacturer).lower() if port.manufacturer else ""
            
            # Skip non-USB serial devices
            if not any(x in description + manufacturer for x in [
                'cp210', 'ch340', 'ftdi', 'uart', 'usb', 'serial', 'arduino', 'esp32'
            ]):
                continue
            
            LOGGER.debug(f"Checking serial port: {port.device} - {port.description}")
            
            try:
                # Try to read device info
                ser = serial.Serial(port.device, 115200, timeout=2)
                time.sleep(0.5)  # Give device time to send data
                
                # Read a few lines to determine device type
                capabilities = {}
                device_type = "serial_sensor"  # Default type for USB serial devices
                device_name = f"USB Serial Device ({port.device.split('/')[-1]})"
                
                # If it's a CP2102, likely an ESP32
                if 'cp210' in description:
                    device_name = f"ESP32 Sensor ({port.device.split('/')[-1]})"
                    device_type = "environmental_sensor"
                
                for _ in range(5):
                    if ser.in_waiting > 0:
                        line = ser.readline().decode('utf-8', errors='ignore').strip()
                        
                        if line.startswith('{'):
                            try:
                                data = json.loads(line)
                                
                                # Detect BME680 sensor (ESP32)
                                if 'bme680' in data or ('averaged' in data and 'temperature_c' in data.get('averaged', {})):
                                    device_type = "environmental_sensor"
                                    device_name = f"ESP32 Environmental Sensor ({port.device.split('/')[-1]})"
                                    
                                    # Determine capabilities from data
                                    if 'bme680' in data:
                                        bme_data = data['bme680']
                                        if 'temperature_c' in bme_data:
                                            capabilities["temperature"] = True
                                        if 'humidity' in bme_data:
                                            capabilities["humidity"] = True
                                        if 'pressure_hpa' in bme_data:
                                            capabilities["pressure"] = True
                                        if 'gas_kohms' in bme_data:
                                            capabilities["gas_resistance"] = True
                                    
                                    if 'averaged' in data:
                                        avg_data = data['averaged']
                                        if 'temperature_c' in avg_data:
                                            capabilities["temperature"] = True
                                        if 'humidity' in avg_data:
                                            capabilities["humidity"] = True
                                        if 'pressure_hpa' in avg_data:
                                            capabilities["pressure"] = True
                                    
                                    break
                                
                            except json.JSONDecodeError:
                                pass
                    time.sleep(0.2)
                
                ser.close()
                
                # Always add USB serial devices we can open
                device_obj = Device(
                    device_id=f"serial-{port.serial_number or port.device.split('/')[-1]}",
                    name=device_name,
                    category=device_type,
                    protocol="usb-serial",
                    online=True,
                    capabilities=capabilities if capabilities else {"serial": True},
                    details={
                        "port": port.device,
                        "baud": 115200,
                        "manufacturer": port.manufacturer or "Unknown",
                        "serial_number": port.serial_number,
                        "vid": f"0x{port.vid:04X}" if port.vid else None,
                        "pid": f"0x{port.pid:04X}" if port.pid else None,
                        "description": port.description,
                    }
                )
                registry.upsert(device_obj)
                devices.append(device_obj)
                LOGGER.info(f"Discovered serial device: {device_name}")
                
            except (serial.SerialException, OSError) as e:
                LOGGER.debug(f"Could not read from serial port {port.device}: {e}")
                continue
    
    except Exception as exc:
        LOGGER.error(f"Serial device discovery failed: {exc}")
    
    return devices


__all__ = [
    "discover_kasa_devices",
    "discover_mqtt_devices", 
    "discover_switchbot_devices",
    "discover_ble_devices",
    "discover_mdns_devices",
    "discover_serial_devices",
    "fetch_switchbot_status",
    "full_discovery_cycle",
]
