"""
Code3 Controller - DMX512 Serial Communication for Grow3 Lights

Handles direct serial communication with Grow3 lights via Code3 bridge using DMX512 protocol.
Each Grow3 light has a unique device ID and responds to DMX512 commands.
"""

import serial
import time
import threading
from typing import Dict, List, Optional
from pathlib import Path
import json

# DMX512 Protocol Constants
DMX_BAUD_RATE = 250000
DMX_BREAK_TIME = 0.0001  # 100μs
DMX_MAB_TIME = 0.000012  # 12μs (Mark After Break)
DMX_REFRESH_RATE = 44  # Hz
DMX_REFRESH_INTERVAL = 1.0 / DMX_REFRESH_RATE  # ~23ms

# Grow3 channel mapping (per protocol.json)
CHANNEL_CW = 0  # Cool White (5000K)
CHANNEL_WW = 1  # Warm White (3000K)
CHANNEL_BL = 2  # Blue (450nm)
CHANNEL_RD = 3  # Red (660nm)

# Grow3 uses 0-64 decimal range (0x00-0x40 hex), NOT 0-255
GROW3_MAX_VALUE = 64


class Code3Controller:
    """Manages DMX512 communication with Grow3 lights via Code3 bridge"""
    
    def __init__(self, serial_port: str = "/dev/ttyCH343USB0"):
        self.serial_port = serial_port
        self.ser: Optional[serial.Serial] = None
        self.device_states: Dict[int, List[int]] = {}  # device_id -> [cw, ww, bl, rd]
        self.running = False
        self.refresh_thread: Optional[threading.Thread] = None
        self.device_map = self._load_device_map()
        
    def _load_device_map(self) -> Dict[int, Dict]:
        """Load device ID mapping from protocol.json"""
        try:
            protocol_path = Path(__file__).parent.parent / "server" / "controllers" / "code3" / "protocol.json"
            if protocol_path.exists():
                with open(protocol_path, 'r') as f:
                    data = json.load(f)
                    # Map numeric IDs to Code3 device IDs (e.g., 2 -> F00001)
                    return {int(k): v for k, v in data.get("deviceIds", {}).items()}
        except Exception as e:
            print(f"Warning: Could not load device map: {e}")
        
        # Default mapping
        return {
            1: "F00001",
            2: "F00001",  # Device ID 2 maps to F00001
            3: "F00002",
            4: "F00003",
            5: "F00005",
            6: "F00004"
        }
    
    def connect(self):
        """Open serial connection"""
        try:
            self.ser = serial.Serial(
                port=self.serial_port,
                baudrate=DMX_BAUD_RATE,
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_TWO,
                timeout=1
            )
            print(f"[Code3] Connected to {self.serial_port}")
            return True
        except Exception as e:
            print(f"[Code3] Failed to connect: {e}")
            return False
    
    def disconnect(self):
        """Close serial connection"""
        self.stop_refresh()
        if self.ser and self.ser.is_open:
            self.ser.close()
            print("[Code3] Disconnected")
    
    def send_dmx_frame(self, device_id: int, channels: List[int]):
        """Send a single DMX512 frame to a specific device
        
        Args:
            device_id: Numeric device ID (1-6)
            channels: List of 4 channel values [CW, WW, BL, RD] in range 0-64
        """
        if not self.ser or not self.ser.is_open:
            return False
        
        try:
            # For Grow3 lights, each device has a DMX address offset
            # According to protocol.json mapping:
            # Device 2 → F00001 (first physical light) → DMX channels 1-4
            # Device 3 → F00002 (second light) → DMX channels 5-8
            # Device 4 → F00003 (third light) → DMX channels 9-12, etc.
            
            # Map device IDs to DMX start channels
            # Device 2 (F00001) should use DMX channels 1-4
            device_to_dmx_offset = {
                1: 0,  # Channels 1-4 (in 0-indexed array: 0-3)
                2: 0,  # F00001 - Channels 1-4 (in 0-indexed array: 0-3)
                3: 4,  # F00002 - Channels 5-8 (in 0-indexed array: 4-7)
                4: 8,  # F00003 - Channels 9-12 (in 0-indexed array: 8-11)
                5: 12, # F00005 - Channels 13-16 (in 0-indexed array: 12-15)
                6: 16  # F00004 - Channels 17-20 (in 0-indexed array: 16-19)
            }
            dmx_start_channel = device_to_dmx_offset.get(device_id, 0)
            
            # Build DMX packet with all 512 channels (start with zeros)
            dmx_channels = [0] * 512
            
            # Set the 4 channels for this device
            for i, value in enumerate(channels[:4]):
                channel_idx = dmx_start_channel + i
                if channel_idx < 512:
                    # Ensure value is in Grow3 range (0-64)
                    dmx_channels[channel_idx] = max(0, min(GROW3_MAX_VALUE, value))
            
            # Send BREAK signal (100μs low)
            self.ser.send_break(duration=DMX_BREAK_TIME)
            
            # Send MAB (Mark After Break - 12μs high)
            time.sleep(DMX_MAB_TIME)
            
            # Send START code (0x00) + channel data
            dmx_packet = bytes([0x00] + dmx_channels)
            self.ser.write(dmx_packet)
            self.ser.flush()
            
            return True
            
        except Exception as e:
            print(f"[Code3] Error sending DMX frame: {e}")
            return False
    
    def set_device(self, device_id: int, status: str, channels_hex: str):
        """Set device state and update continuous refresh
        
        Args:
            device_id: Numeric device ID (1-6)
            status: "on" or "off"
            channels_hex: Hex string like "1D1D1D1D0000" (CW WW BL RD + reserved)
        """
        if status == "off":
            # Turn off all channels
            channels = [0, 0, 0, 0]
        else:
            # Parse hex string: "CCWWBBRR0000"
            # Each channel is 2 hex digits (00-40 for Grow3)
            try:
                cw = int(channels_hex[0:2], 16) if len(channels_hex) >= 2 else 0
                ww = int(channels_hex[2:4], 16) if len(channels_hex) >= 4 else 0
                bl = int(channels_hex[4:6], 16) if len(channels_hex) >= 6 else 0
                rd = int(channels_hex[6:8], 16) if len(channels_hex) >= 8 else 0
                channels = [cw, ww, bl, rd]
            except ValueError as e:
                print(f"[Code3] Invalid hex string '{channels_hex}': {e}")
                channels = [0, 0, 0, 0]
        
        # Update device state for continuous refresh
        self.device_states[device_id] = channels
        
        # Send immediate frame
        self.send_dmx_frame(device_id, channels)
        
        # Start refresh thread if not running
        if not self.running:
            self.start_refresh()
    
    def _refresh_loop(self):
        """Background thread that continuously refreshes DMX frames at 44Hz"""
        print("[Code3] Starting DMX refresh loop at 44Hz")
        
        while self.running:
            start_time = time.time()
            
            # Send frame to each device with active state
            for device_id, channels in self.device_states.items():
                self.send_dmx_frame(device_id, channels)
            
            # Sleep for remainder of refresh interval
            elapsed = time.time() - start_time
            sleep_time = max(0, DMX_REFRESH_INTERVAL - elapsed)
            time.sleep(sleep_time)
    
    def start_refresh(self):
        """Start continuous DMX refresh thread"""
        if not self.running:
            self.running = True
            self.refresh_thread = threading.Thread(target=self._refresh_loop, daemon=True)
            self.refresh_thread.start()
    
    def stop_refresh(self):
        """Stop continuous DMX refresh thread"""
        if self.running:
            self.running = False
            if self.refresh_thread:
                self.refresh_thread.join(timeout=1.0)
            print("[Code3] Stopped DMX refresh loop")
    
    def get_device_list(self) -> List[Dict]:
        """Get list of available devices based on device map"""
        devices = []
        
        for device_id, code3_id in self.device_map.items():
            devices.append({
                "id": device_id,
                "name": f"Grow3 Light {device_id}",
                "type": "grow3",
                "model": "Grow3",
                "code3_id": code3_id,
                "status": "on" if device_id in self.device_states else "off",
                "channelsValue": self._format_hex(self.device_states.get(device_id, [0,0,0,0])),
                "vendor": "Code3",
                "protocol": "dmx512",
                "online": True
            })
        
        return devices
    
    def _format_hex(self, channels: List[int]) -> str:
        """Format channel values as hex string: CCWWBBRR0000"""
        return ''.join([f"{ch:02X}" for ch in channels[:4]]) + "0000"


# Global controller instance
_controller: Optional[Code3Controller] = None


def get_controller() -> Code3Controller:
    """Get or create global Code3 controller instance"""
    global _controller
    
    if _controller is None:
        _controller = Code3Controller()
        # Connect on first access
        if not _controller.connect():
            print("[Code3] Warning: Failed to connect to serial port, commands will not work")
    
    return _controller


def shutdown_controller():
    """Shutdown global controller (call on app exit)"""
    global _controller
    
    if _controller:
        _controller.disconnect()
        _controller = None
