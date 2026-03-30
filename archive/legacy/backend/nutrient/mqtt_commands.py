#!/usr/bin/env python3
"""
ESP32 Nutrient System - MQTT Command Publisher
Sends dosing commands to ESP32 via MQTT

Command Topics:
    - sensors/nutrient/command/dose        - Trigger nutrient dosing
    - sensors/nutrient/command/dose_ratio  - Split a total volume across pumps by ratio
    - sensors/nutrient/command/cal         - Start calibration procedure
    - sensors/nutrient/command/pump_cal    - Persist pump flow rates
    - sensors/nutrient/command/mix         - Activate mixing pump

Message Formats:
  Dose: {"pump": "phUp"|"phDown"|"nutrientA"|"nutrientB", "ml": float, "duration_ms": int}
    Dose Ratio: {"total_ml": float, "ratios": {"nutrientA": 3, "nutrientB": 1}}
  Cal:  {"sensor": "ph"|"ec", "mode": "mid"|"low"|"high"|"clear"}
  Mix:  {"duration_s": int}
"""

import paho.mqtt.client as mqtt
import json
import time
import sys

MQTT_BROKER = "localhost"
MQTT_PORT = 1883
MQTT_KEEPALIVE = 60

# Command topics
TOPIC_DOSE = "sensors/nutrient/command/dose"
TOPIC_DOSE_RATIO = "sensors/nutrient/command/dose_ratio"
TOPIC_CAL = "sensors/nutrient/command/cal"
TOPIC_MIX = "sensors/nutrient/command/mix"
TOPIC_PUMP_CAL = "sensors/nutrient/command/pump_cal"

class NutrientCommandPublisher:
    def __init__(self, broker=MQTT_BROKER, port=MQTT_PORT):
        self.client = mqtt.Client(client_id="nutrient_commander")
        self.client.on_connect = self._on_connect
        self.client.on_publish = self._on_publish
        self.broker = broker
        self.port = port
        self.connected = False
        
    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            print(f" Connected to MQTT broker at {self.broker}:{self.port}")
            self.connected = True
        else:
            print(f"✗ Connection failed with code {rc}")
            
    def _on_publish(self, client, userdata, mid):
        print(f" Message published (mid: {mid})")
        
    def connect(self):
        """Connect to MQTT broker"""
        try:
            self.client.connect(self.broker, self.port, MQTT_KEEPALIVE)
            self.client.loop_start()
            # Wait for connection
            timeout = 5
            start = time.time()
            while not self.connected and (time.time() - start) < timeout:
                time.sleep(0.1)
            return self.connected
        except Exception as e:
            print(f"✗ Connection error: {e}")
            return False
            
    def disconnect(self):
        """Disconnect from MQTT broker"""
        self.client.loop_stop()
        self.client.disconnect()
        
    def dose_pump(self, pump, ml, duration_ms=None):
        """
        Send dosing command to ESP32
        
        Args:
            pump: "phUp", "phDown", "nutrientA", or "nutrientB"
            ml: Volume in milliliters
            duration_ms: Override duration in milliseconds (optional)
        """
        if pump not in ["phUp", "phDown", "nutrientA", "nutrientB"]:
            print(f"✗ Invalid pump: {pump}")
            return False
            
        command = {
            "pump": pump,
            "ml": float(ml),
            "timestamp": int(time.time() * 1000)
        }
        
        if duration_ms is not None:
            command["duration_ms"] = int(duration_ms)
            
        payload = json.dumps(command)
        print(f"→ Dosing {ml}ml via {pump}")
        result = self.client.publish(TOPIC_DOSE, payload, qos=1)
        return result.rc == mqtt.MQTT_ERR_SUCCESS

    def dose_ratio(self, total_ml, ratio_pairs):
        """Split a total volume across pumps according to ratios."""
        if total_ml <= 0:
            print("✗ total_ml must be > 0")
            return False

        ratios = {}
        for pair in ratio_pairs:
            if "=" not in pair:
                print(f"✗ Invalid ratio pair '{pair}' (expected pump=value)")
                return False
            pump, value = pair.split("=", 1)
            pump = pump.strip()
            try:
                ratio_value = float(value)
            except ValueError:
                print(f"✗ Invalid ratio value for {pump}: {value}")
                return False

            if pump not in ["nutrientA", "nutrientB", "phUp", "phDown"]:
                print(f"✗ Unsupported pump for ratio dosing: {pump}")
                return False

            if ratio_value <= 0:
                print(f"✗ Ratio value must be positive for {pump}")
                return False

            ratios[pump] = ratio_value

        if not ratios:
            print("✗ No valid ratios provided")
            return False

        command = {
            "total_ml": float(total_ml),
            "ratios": ratios,
            "timestamp": int(time.time() * 1000)
        }

        payload = json.dumps(command)
        ratio_desc = ", ".join(f"{pump}={value}" for pump, value in ratios.items())
        print(f"→ Dosing {total_ml}ml by ratio ({ratio_desc})")
        result = self.client.publish(TOPIC_DOSE_RATIO, payload, qos=1)
        return result.rc == mqtt.MQTT_ERR_SUCCESS
        
    def calibrate_sensor(self, sensor, mode):
        """
        Send calibration command to ESP32
        
        Args:
            sensor: "ph" or "ec"
            mode: "mid", "low", "high", or "clear"
        """
        if sensor not in ["ph", "ec"]:
            print(f"✗ Invalid sensor: {sensor}")
            return False
            
        if mode not in ["mid", "low", "high", "clear"]:
            print(f"✗ Invalid calibration mode: {mode}")
            return False
            
        command = {
            "sensor": sensor,
            "mode": mode,
            "timestamp": int(time.time() * 1000)
        }
        
        payload = json.dumps(command)
        print(f"→ Calibrating {sensor} sensor: {mode}")
        result = self.client.publish(TOPIC_CAL, payload, qos=1)
        return result.rc == mqtt.MQTT_ERR_SUCCESS
        
    def mix_solution(self, duration_s):
        """
        Activate mixing pump
        
        Args:
            duration_s: Duration in seconds
        """
        command = {
            "duration_s": int(duration_s),
            "timestamp": int(time.time() * 1000)
        }
        
        payload = json.dumps(command)
        print(f"→ Mixing solution for {duration_s} seconds")
        result = self.client.publish(TOPIC_MIX, payload, qos=1)
        return result.rc == mqtt.MQTT_ERR_SUCCESS
        
    def calibrate_pump(self, pump, ml_per_sec):
        """
        Calibrate pump flow rate
        
        Args:
            pump: "phUp", "phDown", "nutrientA", or "nutrientB"
            ml_per_sec: Flow rate in ml/second
        """
        if pump not in ["phUp", "phDown", "nutrientA", "nutrientB"]:
            print(f"✗ Invalid pump: {pump}")
            return False
            
        command = {
            "pump": pump,
            "ml_per_sec": float(ml_per_sec),
            "timestamp": int(time.time() * 1000)
        }
        
        payload = json.dumps(command)
        print(f"→ Calibrating {pump} pump: {ml_per_sec} ml/s")
        result = self.client.publish(TOPIC_PUMP_CAL, payload, qos=1)
        return result.rc == mqtt.MQTT_ERR_SUCCESS


def main():
    """CLI interface for sending commands"""
    if len(sys.argv) < 2:
        print("Usage:")
        print("  Dose:        python mqtt_commands.py dose <pump> <ml>")
        print("               Pumps: phUp, phDown, nutrientA, nutrientB")
        print("  Ratio Dose:  python mqtt_commands.py ratio <total_ml> <pump=value> [pump=value ...]")
        print("               Example: ratio 20 nutrientA=3 nutrientB=1")
        print("  Calibrate:   python mqtt_commands.py cal <sensor> <mode>")
        print("               Sensors: ph, ec")
        print("               Modes: mid, low, high, clear, dry")
        print("  Pump Cal:    python mqtt_commands.py pump_cal <pump> <ml_per_sec>")
        print("               Pumps: phUp, phDown, nutrientA, nutrientB")
        print("  Mix:         python mqtt_commands.py mix <seconds>")
        print("\nExamples:")
        print("  python mqtt_commands.py dose phUp 5.0")
        print("  python mqtt_commands.py cal ph mid")
        print("  python mqtt_commands.py ratio 18 nutrientA=2 nutrientB=1")
        print("  python mqtt_commands.py pump_cal phUp 2.5")
        print("  python mqtt_commands.py mix 30")
        sys.exit(1)
        
    commander = NutrientCommandPublisher()
    
    if not commander.connect():
        print("✗ Failed to connect to MQTT broker")
        sys.exit(1)
        
    command = sys.argv[1].lower()
    
    try:
        if command == "dose":
            if len(sys.argv) < 4:
                print("✗ Usage: dose <pump> <ml>")
                sys.exit(1)
            pump = sys.argv[2]
            ml = float(sys.argv[3])
            commander.dose_pump(pump, ml)

        elif command == "ratio":
            if len(sys.argv) < 5:
                print("✗ Usage: ratio <total_ml> <pump=value> [pump=value ...]")
                sys.exit(1)
            total_ml = float(sys.argv[2])
            ratio_args = sys.argv[3:]
            commander.dose_ratio(total_ml, ratio_args)
            
        elif command == "cal":
            if len(sys.argv) < 4:
                print("✗ Usage: cal <sensor> <mode>")
                sys.exit(1)
            sensor = sys.argv[2]
            mode = sys.argv[3]
            commander.calibrate_sensor(sensor, mode)
            
        elif command == "mix":
            if len(sys.argv) < 3:
                print("✗ Usage: mix <seconds>")
                sys.exit(1)
            duration = int(sys.argv[2])
            commander.mix_solution(duration)
            
        elif command == "pump_cal":
            if len(sys.argv) < 4:
                print("✗ Usage: pump_cal <pump> <ml_per_sec>")
                sys.exit(1)
            pump = sys.argv[2]
            ml_per_sec = float(sys.argv[3])
            commander.calibrate_pump(pump, ml_per_sec)
            
        else:
            print(f"✗ Unknown command: {command}")
            sys.exit(1)
            
        # Wait for message to be sent
        time.sleep(1)
        
    finally:
        commander.disconnect()


if __name__ == "__main__":
    main()
