"""
MQTT Worker - Listens to MQTT broker and forwards to FastAPI backend
Run automatically when starting backend with: python -m backend
"""
import paho.mqtt.client as mqtt
import json
import os
import sys
import threading
import time
import requests
from datetime import datetime
from typing import Optional

class MQTTWorker:
    """MQTT subscriber that forwards sensor data to FastAPI"""
    
    def __init__(self):
        # Load configuration from environment
        self.broker_host = os.getenv("MQTT_HOST", "localhost")
        self.broker_port = int(os.getenv("MQTT_PORT", "1883"))
        self.username = os.getenv("MQTT_USERNAME", "")
        self.password = os.getenv("MQTT_PASSWORD", "")
        self.topics = os.getenv("MQTT_TOPICS", "sensors/#").split(",")
        
        # FastAPI backend URL
        self.api_base = os.getenv("BACKEND_API_URL", "http://localhost:8000")
        
        # MQTT client
        self.client: Optional[mqtt.Client] = None
        self.connected = False
        self.message_count = 0
        
        print(f"🔧 MQTT Worker Configuration:")
        print(f"   Broker: {self.broker_host}:{self.broker_port}")
        print(f"   Topics: {self.topics}")
        print(f"   API: {self.api_base}")
        
    def on_connect(self, client, userdata, flags, rc):
        """Callback when connected to MQTT broker"""
        if rc == 0:
            self.connected = True
            print(f"✅ Connected to MQTT broker at {self.broker_host}:{self.broker_port}")
            
            # Subscribe to topics
            for topic in self.topics:
                topic = topic.strip()
                client.subscribe(topic)
                print(f"📡 Subscribed to: {topic}")
        else:
            print(f"❌ Failed to connect to MQTT broker. Return code: {rc}")
            print(f"   Codes: 0=Success, 1=Protocol, 2=ClientID, 3=Unavailable, 4=Auth, 5=Not Authorized")
            self.connected = False
    
    def on_disconnect(self, client, userdata, rc):
        """Callback when disconnected from MQTT broker"""
        self.connected = False
        if rc != 0:
            print(f"⚠️ Unexpected disconnect from MQTT broker (code {rc}). Reconnecting...")
        else:
            print("👋 Disconnected from MQTT broker")
    
    def on_message(self, client, userdata, msg):
        """Callback when message received from MQTT broker"""
        try:
            self.message_count += 1
            topic = msg.topic
            payload_str = msg.payload.decode('utf-8')
            
            print(f"📨 [{self.message_count}] Topic: {topic}")
            print(f"   Payload: {payload_str[:200]}{'...' if len(payload_str) > 200 else ''}")
            
            # Parse JSON payload
            try:
                payload = json.loads(payload_str)
            except json.JSONDecodeError as e:
                print(f"⚠️ Invalid JSON payload: {e}")
                return
            
            # Validate required fields
            if not self._validate_payload(payload):
                print(f"⚠️ Invalid payload structure")
                return
            
            # Forward to FastAPI
            self._forward_to_api(payload)
            
        except Exception as e:
            print(f"❌ Error processing message: {e}")
    
    def _validate_payload(self, payload: dict) -> bool:
        """Validate payload has required structure"""
        # Check for required fields
        if "scope" not in payload:
            print("⚠️ Missing 'scope' field")
            return False
        
        if "sensors" not in payload or not isinstance(payload["sensors"], dict):
            print("⚠️ Missing or invalid 'sensors' field")
            return False
        
        # Add timestamp if missing
        if "ts" not in payload:
            payload["ts"] = datetime.utcnow().isoformat() + "Z"
            print(f"   Added timestamp: {payload['ts']}")
        
        return True
    
    def _forward_to_api(self, payload: dict):
        """Forward validated payload to FastAPI backend"""
        try:
            url = f"{self.api_base}/api/env/ingest"
            response = requests.post(
                url,
                json=payload,
                timeout=5
            )
            
            if response.status_code == 200:
                result = response.json()
                print(f"✅ Ingested: scope={result.get('scope')}, sensors={result.get('ingested')}")
            else:
                print(f"⚠️ API error: {response.status_code} - {response.text}")
                
        except requests.exceptions.RequestException as e:
            print(f"❌ Failed to forward to API: {e}")
    
    def start(self):
        """Start MQTT worker in background thread"""
        print("\n🚀 Starting MQTT Worker...")
        
        # Create MQTT client
        self.client = mqtt.Client(client_id="light-engine-mqtt-worker")
        
        # Set authentication if provided
        if self.username and self.password:
            self.client.username_pw_set(self.username, self.password)
            print(f"🔐 Using authentication (username: {self.username})")
        
        # Set callbacks
        self.client.on_connect = self.on_connect
        self.client.on_disconnect = self.on_disconnect
        self.client.on_message = self.on_message
        
        # Connect to broker
        try:
            print(f"🔌 Connecting to {self.broker_host}:{self.broker_port}...")
            self.client.connect(self.broker_host, self.broker_port, 60)
            
            # Start network loop in background thread
            self.client.loop_start()
            print("✅ MQTT Worker running in background")
            
        except Exception as e:
            print(f"❌ Failed to start MQTT worker: {e}")
            raise
    
    def stop(self):
        """Stop MQTT worker"""
        if self.client:
            print("\n🛑 Stopping MQTT Worker...")
            self.client.loop_stop()
            self.client.disconnect()
            print(f"📊 Total messages processed: {self.message_count}")

def start_mqtt_worker_background():
    """Start MQTT worker in background (called by backend startup)"""
    worker = MQTTWorker()
    
    def run_worker():
        try:
            worker.start()
            # Keep thread alive
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            worker.stop()
        except Exception as e:
            print(f"❌ MQTT Worker error: {e}")
    
    # Start in daemon thread so it doesn't block shutdown
    thread = threading.Thread(target=run_worker, daemon=True)
    thread.start()
    
    return worker

if __name__ == "__main__":
    """Run MQTT worker standalone for testing"""
    print("=" * 60)
    print("MQTT Worker - Standalone Mode")
    print("=" * 60)
    
    worker = MQTTWorker()
    
    try:
        worker.start()
        print("\n✅ Worker running. Press Ctrl+C to stop...")
        
        # Keep main thread alive
        while True:
            time.sleep(1)
            
    except KeyboardInterrupt:
        print("\n")
        worker.stop()
        print("👋 Goodbye!")
