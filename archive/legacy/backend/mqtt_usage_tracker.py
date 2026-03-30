"""
MQTT listener for automatic inventory usage tracking.
Subscribes to nutrient dosing events and records usage in inventory system.
"""

import json
import logging
from typing import Optional
import requests

try:
    import paho.mqtt.client as mqtt
    MQTT_AVAILABLE = True
except ImportError:
    MQTT_AVAILABLE = False

LOGGER = logging.getLogger(__name__)

# MQTT Topics to monitor
DOSING_TOPICS = [
    "sensors/nutrient/pump",        # ESP-IDF firmware
    "commands/NutrientRoom",         # Arduino firmware
    "sensors/nutrient/command/dose"  # Alternative topic
]

# Pump name to nutrient type mapping
PUMP_TO_NUTRIENT = {
    "nutrientA": "base_a",
    "nutrientB": "base_b",
    "phDown": "ph_down",
    "phUp": "ph_up",
    "pump1": "base_a",
    "pump2": "base_b",
    "pump3": "ph_down",
    "pump4": "ph_up"
}


class MQTTUsageTracker:
    """Background service that tracks inventory usage from MQTT events."""
    
    def __init__(self, broker: str, port: int = 1883, username: Optional[str] = None, password: Optional[str] = None):
        """Initialize MQTT usage tracker.
        
        Args:
            broker: MQTT broker hostname/IP
            port: MQTT broker port (default 1883)
            username: Optional MQTT username
            password: Optional MQTT password
        """
        if not MQTT_AVAILABLE:
            raise RuntimeError("paho-mqtt not installed. Cannot start MQTT usage tracker.")
        
        self.broker = broker
        self.port = port
        self.username = username
        self.password = password
        self.client: Optional[mqtt.Client] = None
        self.running = False
        
    def start(self):
        """Start the MQTT listener in background."""
        if self.running:
            LOGGER.warning("MQTT usage tracker already running")
            return
        
        self.client = mqtt.Client(client_id="light-engine-usage-tracker")
        
        if self.username:
            self.client.username_pw_set(self.username, self.password)
        
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        self.client.on_disconnect = self._on_disconnect
        
        try:
            self.client.connect(self.broker, self.port, keepalive=60)
            self.client.loop_start()
            self.running = True
            LOGGER.info(f"MQTT usage tracker started: {self.broker}:{self.port}")
        except Exception as e:
            LOGGER.error(f"Failed to start MQTT usage tracker: {e}")
            raise
    
    def stop(self):
        """Stop the MQTT listener."""
        if not self.running:
            return
        
        if self.client:
            self.client.loop_stop()
            self.client.disconnect()
        
        self.running = False
        LOGGER.info("MQTT usage tracker stopped")
    
    def _on_connect(self, client, userdata, flags, rc):
        """Callback when connected to MQTT broker."""
        if rc == 0:
            LOGGER.info("MQTT usage tracker connected to broker")
            
            # Subscribe to all dosing topics
            for topic in DOSING_TOPICS:
                result = client.subscribe(topic)
                if result[0] == 0:
                    LOGGER.info(f"Subscribed to {topic}")
                else:
                    LOGGER.warning(f"Failed to subscribe to {topic}")
        else:
            LOGGER.error(f"MQTT connection failed with code {rc}")
    
    def _on_disconnect(self, client, userdata, rc):
        """Callback when disconnected from MQTT broker."""
        if rc != 0:
            LOGGER.warning(f"Unexpected MQTT disconnect (code {rc}). Will auto-reconnect.")
    
    def _on_message(self, client, userdata, msg):
        """Callback when MQTT message received."""
        try:
            topic = msg.topic
            payload = msg.payload.decode('utf-8')
            
            # Parse JSON payload
            try:
                data = json.loads(payload)
            except json.JSONDecodeError:
                LOGGER.warning(f"Invalid JSON from {topic}: {payload}")
                return
            
            # Extract dosing information
            pump_name = None
            volume_ml = None
            
            # Try different payload formats
            if "pump" in data and "volume" in data:
                # Format: {"pump": "nutrientA", "volume": 100}
                pump_name = data["pump"]
                volume_ml = data["volume"]
            elif "command" in data and data["command"] == "dose":
                # Format: {"command": "dose", "pump": "pump1", "duration": 5000}
                pump_name = data.get("pump")
                duration_ms = data.get("duration", 0)
                # Assume 20ml/sec flow rate
                volume_ml = (duration_ms / 1000) * 20
            elif "action" in data and data["action"] == "dose":
                # Format: {"action": "dose", "nutrient": "A", "ml": 50}
                nutrient_letter = data.get("nutrient", "")
                pump_name = f"nutrient{nutrient_letter}"
                volume_ml = data.get("ml", 0)
            
            if not pump_name or not volume_ml:
                return  # Not a dosing event
            
            # Map pump to nutrient type
            nutrient_type = PUMP_TO_NUTRIENT.get(pump_name)
            if not nutrient_type:
                LOGGER.warning(f"Unknown pump name: {pump_name}")
                return
            
            # Record usage via API
            self._record_nutrient_usage(pump_name, nutrient_type, volume_ml)
            
        except Exception as e:
            LOGGER.error(f"Error processing MQTT message: {e}")
    
    def _record_nutrient_usage(self, pump: str, nutrient_type: str, volume_ml: float):
        """Record nutrient dosing event to inventory system.
        
        Args:
            pump: Pump identifier (e.g., "nutrientA", "pump1")
            nutrient_type: Nutrient type (base_a, base_b, ph_down, ph_up)
            volume_ml: Volume dosed in milliliters
        """
        try:
            # Call inventory usage tracking API
            response = requests.post(
                "http://localhost:8000/api/inventory/usage/nutrient-dosing",
                json={
                    "pump": pump,
                    "nutrient_type": nutrient_type,
                    "volume_ml": volume_ml
                },
                timeout=5.0
            )
            
            if response.status_code == 200:
                LOGGER.info(f"Recorded {volume_ml}ml {nutrient_type} usage from {pump}")
            else:
                LOGGER.warning(f"Failed to record nutrient usage: {response.status_code}")
        
        except requests.RequestException as e:
            LOGGER.error(f"Error recording nutrient usage: {e}")
        except Exception as e:
            LOGGER.error(f"Unexpected error recording nutrient usage: {e}")


# Global tracker instance
_tracker: Optional[MQTTUsageTracker] = None


def start_usage_tracker(broker: str, port: int = 1883, username: Optional[str] = None, password: Optional[str] = None):
    """Start the global MQTT usage tracker.
    
    Args:
        broker: MQTT broker hostname/IP
        port: MQTT broker port (default 1883)
        username: Optional MQTT username
        password: Optional MQTT password
    """
    global _tracker
    
    if _tracker and _tracker.running:
        LOGGER.warning("MQTT usage tracker already started")
        return
    
    if not MQTT_AVAILABLE:
        LOGGER.warning("paho-mqtt not available. MQTT usage tracking disabled.")
        return
    
    try:
        _tracker = MQTTUsageTracker(broker, port, username, password)
        _tracker.start()
    except Exception as e:
        LOGGER.error(f"Failed to start MQTT usage tracker: {e}")


def stop_usage_tracker():
    """Stop the global MQTT usage tracker."""
    global _tracker
    
    if _tracker:
        _tracker.stop()
        _tracker = None
