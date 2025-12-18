#!/usr/bin/env python3
"""
Unified MQTT Nutrient Monitor
Subscribes to BOTH topic schemes:
1. Original ESP-IDF topics: sensors/nutrient/*
2. Local Arduino topics: sensors/NutrientRoom*
"""

import paho.mqtt.client as mqtt
import json
from datetime import datetime
import sys

# MQTT Configuration
BROKER = "192.168.2.42"
PORT = 1883
CLIENT_ID = "nutrient-monitor-unified"

# Subscribe to BOTH topic schemes
TOPICS = [
    # Original ESP-IDF topics (from greenreach2024/pid_nutrient_control-main)
    "sensors/nutrient/reading",
    "sensors/nutrient/pump",
    "notifs/alerts/reservoir",
    "sensors/nutrient/flow",
    
    # Local Arduino topics (from firmware/esp32-empty-tank-safety)
    "sensors/NutrientRoom",
    "sensors/NutrientRoom/ack",
    "commands/NutrientRoom"
]

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("╔═══════════════════════════════════════════════════════════╗")
        print("║    UNIFIED ESP32 NUTRIENT MONITOR - DUAL TOPIC SCHEME   ║")
        print("╚═══════════════════════════════════════════════════════════╝\n")
        print(f" Connected to MQTT broker: {BROKER}:{PORT}")
        print(f"   Client ID: {CLIENT_ID}\n")
        print("📡 Subscribed to BOTH topic schemes:")
        print("\n   Original ESP-IDF Topics (TLS):")
        print("   ├─ sensors/nutrient/reading")
        print("   ├─ sensors/nutrient/pump")
        print("   ├─ notifs/alerts/reservoir")
        print("   └─ sensors/nutrient/flow")
        print("\n   Local Arduino Topics (Plain MQTT):")
        print("   ├─ sensors/NutrientRoom")
        print("   ├─ sensors/NutrientRoom/ack")
        print("   └─ commands/NutrientRoom")
        
        for topic in TOPICS:
            result = client.subscribe(topic)
            status = "" if result[0] == 0 else "✗"
            # Don't print each subscription to avoid clutter
        
        print("\n⏳ Waiting for ESP32 telemetry...")
        print("   Press Ctrl+C to exit\n")
        print("─" * 70)
    else:
        errors = {
            1: "Incorrect protocol version",
            2: "Invalid client ID",
            3: "Server unavailable",
            4: "Bad username/password",
            5: "Not authorized"
        }
        print(f" Connection failed: {errors.get(rc, f'Unknown ({rc})')}")
        sys.exit(1)

def on_message(client, userdata, msg):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    topic = msg.topic
    payload = msg.payload.decode('utf-8', errors='replace')
    
    # Detect which firmware is sending
    if topic.startswith("sensors/nutrient/"):
        firmware = "ESP-IDF (Original)"
        emoji = "🔵"
    elif topic.startswith("sensors/NutrientRoom") or topic.startswith("commands/NutrientRoom"):
        firmware = "Arduino (Local)"
        emoji = "🟢"
    else:
        firmware = "Unknown"
        emoji = "⚪"
    
    # Try to parse as JSON and pretty-print
    try:
        data = json.loads(payload)
        
        print(f"\n{emoji} [{timestamp}] {firmware}")
        print(f"📍 Topic: {topic}")
        print("─" * 70)
        
        # Handle Local Arduino Format (sensors/NutrientRoom)
        if topic == "sensors/NutrientRoom":
            scope = data.get('scope', 'Unknown')
            ts = data.get('ts', 'N/A')
            sensors = data.get('sensors', {})
            targets = data.get('targets', {})
            
            print(f"Scope:     {scope}")
            print(f"Timestamp: {ts}")
            print("\nSENSORS:")
            
            if 'ph' in sensors:
                ph_val = sensors['ph'].get('value', 'N/A')
                print(f"  🔬 pH:          {ph_val}")
            
            if 'ec' in sensors:
                ec_val = sensors['ec'].get('value', 'N/A')
                ec_unit = sensors['ec'].get('unit', '')
                print(f"  ⚡ EC:          {ec_val} {ec_unit}")
            
            if 'temperature' in sensors:
                temp_val = sensors['temperature'].get('value', 'N/A')
                print(f"  🌡  Temperature: {temp_val} °C")
            
            if targets:
                print("\nTARGETS:")
                print(f"  pH:  {targets.get('phTarget', 'N/A')} ± {targets.get('phTolerance', 'N/A')}")
                print(f"  EC:  {targets.get('ecTarget', 'N/A')} ± {targets.get('ecTolerance', 'N/A')}")
            
            if 'guardrails' in data:
                guards = data['guardrails']
                print("\nGUARDRAILS:")
                print(f"  Daily pH Runtime:  {guards.get('dailyPhRuntimeSec', 0):.1f}s")
                print(f"  Daily EC-A Runtime: {guards.get('dailyEcARuntimeSec', 0):.1f}s")
                print(f"  Daily EC-B Runtime: {guards.get('dailyEcBRuntimeSec', 0):.1f}s")
        
        # Handle Local Arduino ACK (sensors/NutrientRoom/ack)
        elif topic == "sensors/NutrientRoom/ack":
            status = data.get('status', 'unknown')
            action = data.get('action', 'N/A')
            reason = data.get('reason', '')
            ec = data.get('ec', 'N/A')
            
            emoji_status = "" if status == "accepted" else "" if status == "rejected" else "ℹ"
            print(f"{emoji_status} Status: {status}")
            print(f"   Action: {action}")
            print(f"   EC:     {ec}")
            if reason:
                print(f"   Reason: {reason}")
        
        # Handle Original ESP-IDF Format (sensors/nutrient/reading)
        elif topic == "sensors/nutrient/reading":
            timestamp_esp = data.get('timestamp', 'N/A')
            temp = data.get('temp', 'N/A')
            ec = data.get('EC_PID_Input', 'N/A')
            ph = data.get('PH_PID_Input', 'N/A')
            
            print(f"Timestamp: {timestamp_esp}")
            print("\nSENSORS:")
            print(f"  🌡  Temperature: {temp} °C")
            print(f"  ⚡ EC:          {ec} uS/cm")
            print(f"  🔬 pH:          {ph}")
        
        # Handle Original ESP-IDF Pump Event (sensors/nutrient/pump)
        elif topic == "sensors/nutrient/pump":
            pump_name = data.get('pump_name', 'Unknown')
            action = data.get('action', 'N/A')
            duration = data.get('duration_sec', 0)
            timestamp_esp = data.get('timestamp', 'N/A')
            
            print(f"Pump:      {pump_name}")
            print(f"Action:    {action}")
            print(f"Duration:  {duration}s")
            print(f"Timestamp: {timestamp_esp}")
        
        # Handle Original ESP-IDF Reservoir Alert (notifs/alerts/reservoir)
        elif topic == "notifs/alerts/reservoir":
            alert = data.get('alert', 'N/A')
            sensor = data.get('sensor', 'N/A')
            value = data.get('value', 'N/A')
            threshold = data.get('threshold', 'N/A')
            timestamp_esp = data.get('timestamp', 'N/A')
            
            print(f"  ALERT: {alert}")
            print(f"   Sensor:    {sensor}")
            print(f"   Value:     {value}")
            print(f"   Threshold: {threshold}")
            print(f"   Timestamp: {timestamp_esp}")
        
        # Handle Original ESP-IDF Flow Reading (sensors/nutrient/flow)
        elif topic == "sensors/nutrient/flow":
            flow_rate = data.get('flow_rate', 'N/A')
            total_volume = data.get('total_volume', 'N/A')
            timestamp_esp = data.get('timestamp', 'N/A')
            
            print(f"Flow Rate:    {flow_rate} L/min")
            print(f"Total Volume: {total_volume} L")
            print(f"Timestamp:    {timestamp_esp}")
        
        # Handle Local Arduino Commands (for debugging)
        elif topic == "commands/NutrientRoom":
            action = data.get('action', 'N/A')
            duration = data.get('durationSec', 0)
            print(f"🎮 COMMAND SENT:")
            print(f"   Action:   {action}")
            print(f"   Duration: {duration}s")
        
        else:
            # Generic JSON
            formatted = json.dumps(data, indent=2)
            for line in formatted.split('\n'):
                print(f"  {line}")
        
        print("─" * 70)
        
    except json.JSONDecodeError:
        # Not JSON, print raw
        print(f"\n{emoji} [{timestamp}] {firmware}")
        print(f"📍 Topic: {topic}")
        print(f"   Raw: {payload}")
        print("─" * 70)

def on_disconnect(client, userdata, rc):
    if rc != 0:
        print(f"\n  Disconnected (code {rc}). Reconnecting...")

if __name__ == "__main__":
    client = mqtt.Client(client_id=CLIENT_ID)
    client.on_connect = on_connect
    client.on_message = on_message
    client.on_disconnect = on_disconnect
    
    try:
        print(f"🔌 Connecting to {BROKER}:{PORT}...")
        client.connect(BROKER, PORT, 60)
        client.loop_forever()
    except KeyboardInterrupt:
        print("\n\n🛑 Stopped by user")
        client.disconnect()
        sys.exit(0)
    except ConnectionRefusedError:
        print(f"\n Connection refused: {BROKER}:{PORT}")
        print("\nPossible issues:")
        print("  1. MQTT broker (mosquitto) not running")
        print("  2. Check with: sudo systemctl status mosquitto")
        print("  3. Or test: mosquitto_sub -h 192.168.2.42 -p 1883 -t '#' -v")
        sys.exit(1)
    except Exception as e:
        print(f"\n Error: {e}")
        sys.exit(1)
