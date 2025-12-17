#!/usr/bin/env python3
"""
ESP32 Nutrient MQTT Subscriber
Subscribes to nutrient sensor topics and logs data
"""

import paho.mqtt.client as mqtt
import json
import time
from datetime import datetime

# MQTT Configuration
BROKER = "localhost"
PORT = 1883
TOPICS = [
    "sensors/nutrient/#",
    "sensors/#"
]

# Logging
LOG_FILE = "nutrient_mqtt_log.txt"

def on_connect(client, userdata, flags, rc):
    """Callback when connected to MQTT broker"""
    if rc == 0:
        print(f"✅ Connected to MQTT broker at {BROKER}:{PORT}")
        for topic in TOPICS:
            client.subscribe(topic)
            print(f"📡 Subscribed to: {topic}")
    else:
        print(f"❌ Connection failed with code {rc}")

def on_message(client, userdata, msg):
    """Callback when message received"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
    topic = msg.topic
    
    try:
        # Try to parse as JSON
        payload = msg.payload.decode('utf-8')
        try:
            data = json.loads(payload)
            payload_str = json.dumps(data, indent=2)
        except:
            payload_str = payload
    except:
        payload_str = str(msg.payload)
    
    # Console output
    print(f"\n{'='*60}")
    print(f"⏰ {timestamp}")
    print(f"📬 Topic: {topic}")
    print(f"📦 Payload:\n{payload_str}")
    
    # Log to file
    with open(LOG_FILE, 'a') as f:
        f.write(f"\n{'='*60}\n")
        f.write(f"Timestamp: {timestamp}\n")
        f.write(f"Topic: {topic}\n")
        f.write(f"Payload: {payload_str}\n")

def on_disconnect(client, userdata, rc):
    """Callback when disconnected"""
    if rc != 0:
        print(f"⚠️  Unexpected disconnect. Code: {rc}")
        print("🔄 Attempting to reconnect...")

def main():
    print("🌱 ESP32 Nutrient MQTT Monitor")
    print(f"{'='*60}")
    print(f"Broker: {BROKER}:{PORT}")
    print(f"Log: {LOG_FILE}")
    print(f"{'='*60}\n")
    
    # Write session start to log
    with open(LOG_FILE, 'a') as f:
        f.write(f"\n\n{'#'*60}\n")
        f.write(f"Session started: {datetime.now()}\n")
        f.write(f"{'#'*60}\n")
    
    # Create MQTT client
    client = mqtt.Client(client_id="reterminal_nutrient_monitor")
    client.on_connect = on_connect
    client.on_message = on_message
    client.on_disconnect = on_disconnect
    
    try:
        # Connect to broker
        print("🔌 Connecting to MQTT broker...")
        client.connect(BROKER, PORT, 60)
        
        # Start loop
        print("👂 Listening for messages... (Press Ctrl+C to stop)\n")
        client.loop_forever()
        
    except KeyboardInterrupt:
        print(f"\n\n✅ Monitoring stopped")
        print(f"📝 Log saved to: {LOG_FILE}")
        client.disconnect()
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        client.disconnect()

if __name__ == "__main__":
    main()
