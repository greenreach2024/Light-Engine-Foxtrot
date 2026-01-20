#!/usr/bin/env python3
"""
Test Grow3 Lights via DMX512 Protocol
Sends test patterns to verify communication
"""

import serial
import time
import sys

def send_dmx_frame(ser, channels):
    """
    Send a DMX512 frame
    channels: list of 0-255 values for each DMX channel
    """
    # DMX512 BREAK signal (88-120 microseconds low)
    ser.send_break(duration=0.0001)  # 100μs
    time.sleep(0.000012)  # MAB (Mark After Break) 12μs
    
    # Build DMX packet: START code (0x00) + channel data
    dmx_packet = bytes([0x00] + channels)
    ser.write(dmx_packet)
    ser.flush()

def main():
    port = '/dev/ttyCH343USB0'  # Code3 controller port
    
    print("Grow3 Light DMX512 Test")
    print("=" * 50)
    print(f"Port: {port}")
    print(f"Protocol: DMX512 (250000 baud, 8N2)")
    print()
    
    try:
        # Open serial port with DMX512 settings
        ser = serial.Serial(
            port=port,
            baudrate=250000,
            bytesize=serial.EIGHTBITS,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_TWO,
            timeout=1
        )
        
        print("✓ Serial port opened")
        time.sleep(0.5)
        
        # Test patterns
        tests = [
            {
                "name": "All OFF",
                "channels": [0, 0, 0, 0],
                "wait": 2
            },
            {
                "name": "Cool White 50%",
                "channels": [128, 0, 0, 0],
                "wait": 2
            },
            {
                "name": "Warm White 50%",
                "channels": [0, 128, 0, 0],
                "wait": 2
            },
            {
                "name": "Blue 50%",
                "channels": [0, 0, 128, 0],
                "wait": 2
            },
            {
                "name": "Red 50%",
                "channels": [0, 0, 0, 128],
                "wait": 2
            },
            {
                "name": "All channels 25%",
                "channels": [64, 64, 64, 64],
                "wait": 2
            },
            {
                "name": "All channels 100%",
                "channels": [255, 255, 255, 255],
                "wait": 2
            },
            {
                "name": "All OFF (end)",
                "channels": [0, 0, 0, 0],
                "wait": 1
            }
        ]
        
        for test in tests:
            print(f"\n▶ Test: {test['name']}")
            print(f"  Channels: CW={test['channels'][0]}, WW={test['channels'][1]}, BL={test['channels'][2]}, RD={test['channels'][3]}")
            
            # Send DMX frame repeatedly for the duration
            # (DMX requires continuous refresh, ideally 44Hz or faster)
            end_time = time.time() + test['wait']
            frame_count = 0
            
            while time.time() < end_time:
                send_dmx_frame(ser, test['channels'])
                frame_count += 1
                time.sleep(0.023)  # ~44Hz refresh rate
            
            print(f"  Sent {frame_count} frames in {test['wait']}s")
        
        ser.close()
        print("\n✓ Test complete!")
        print("\nDid you see the lights change? (Yes/No)")
        
    except serial.SerialException as e:
        print(f"\n✗ Serial error: {e}")
        print(f"  Make sure {port} is accessible and not in use")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
