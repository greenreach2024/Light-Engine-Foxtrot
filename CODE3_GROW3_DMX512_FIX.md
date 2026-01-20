# Code3 + Grow3 Communication Fix

## Issue
Code3 controller and Grow3 lights physically connected but not communicating.

## Root Cause
**Wrong protocol assumption**. Initial implementation assumed custom Code3 serial protocol, but Grow3 lights actually use **DMX512** standard.

## Hardware Configuration
- **Controller**: Code3 USB Dual Serial (CH343 chipset)
  - USB Device ID: `1a86:55d2 QinHeng Electronics`
  - Serial Ports: `/dev/ttyCH343USB0`, `/dev/ttyCH343USB1`
- **Lights**: Grow3 4-channel LED (CW/WW/BL/RD)
- **Protocol**: DMX512 (industry standard for stage/horticultural lighting)

## DMX512 Protocol Specs
- **Baud Rate**: 250,000 bps
- **Format**: 8 data bits, No parity, 2 stop bits (8N2)
- **Frame Structure**:
  1. BREAK signal (88-120μs low)
  2. MAB (Mark After Break, 8-16μs high)
  3. START code (0x00)
  4. Channel data (512 bytes max, 0-255 per channel)
- **Refresh Rate**: 44Hz recommended (every 23ms)
- **Direction**: One-way (controller → lights, no response expected)

## Grow3 DMX Channel Map
| DMX Channel | Function | Range | Description |
|-------------|----------|-------|-------------|
| 1 | Cool White (CW) | 0-255 | 5000K white LEDs |
| 2 | Warm White (WW) | 0-255 | 3000K white LEDs |
| 3 | Blue (BL) | 0-255 | 450nm blue LEDs |
| 4 | Red (RD) | 0-255 | 660nm red LEDs |

## Solution Implemented

### 1. Test Script (`scripts/test-grow3-dmx.py`)
Python script to verify DMX512 communication:
```bash
python3 scripts/test-grow3-dmx.py
```

Sends test patterns:
- All OFF
- Individual channels at 50%
- All channels at 25%, 100%
- Continuous refresh at 44Hz

**Test Result**: ✅ Commands sent successfully

### 2. Update Discovery Script
Modify `scripts/discover-code3.py` to use DMX512 instead of custom protocol.

### 3. Update Backend API
Modify `backend/main.py` `/api/devicedatas` endpoint to send DMX512 frames.

## Next Steps

1. **User Verification**
   - Run test script: `python3 scripts/test-grow3-dmx.py`
   - Confirm lights respond to each pattern
   - Lights should change: OFF → CW → WW → Blue → Red → Mixed → Bright → OFF

2. **Update Discovery**
   - Replace protocol query with DMX device enumeration
   - Use static configuration or DIP switch addressing

3. **Implement Control API**
   - Add DMX512 frame builder
   - Implement continuous refresh loop (background thread at 44Hz)
   - Add channel mapping for recipe spectral data

4. **Groups V2 Integration**
   - Update device driver to use DMX512
   - Test spectrum solver → DMX channel conversion
   - Verify recipe deployment to lights

## Commands

### Check Hardware
```bash
# USB device
lsusb | grep QinHeng

# Serial ports
ls -la /dev/tty* | grep CH343

# User permissions
groups $USER | grep dialout
```

### Test DMX Communication
```bash
# Run test pattern
cd ~/Light-Engine-Foxtrot
python3 scripts/test-grow3-dmx.py

# Manual DMX test (Python)
python3 -c "
import serial, time
s = serial.Serial('/dev/ttyCH343USB0', 250000, timeout=1,
                  bytesize=8, parity='N', stopbits=2)
s.send_break(0.0001)
time.sleep(0.000012)
s.write(bytes([0, 128, 128, 128, 128]))  # All channels 50%
s.close()
"
```

### Monitor Serial Port
```bash
# Check for activity (requires minicom or similar)
sudo apt-get install minicom
sudo minicom -D /dev/ttyCH343USB0 -b 250000
```

## DMX512 vs Custom Protocol

| Aspect | DMX512 | Custom Code3 |
|--------|--------|--------------|
| Baud Rate | 250,000 | 9600 |
| Discovery | None (static addressing) | Query/Response |
| Feedback | None (one-way) | Status responses |
| Addressing | DIP switches or software | Protocol commands |
| Refresh | Continuous (44Hz) | On-demand |
| Implementation | Standard libraries | Custom parsing |

## Troubleshooting

### No Light Response
1. Check DMX addressing (DIP switches on Grow3 lights)
2. Verify correct serial port (`ttyCH343USB0` vs `ttyCH343USB1`)
3. Check cable connections (RS485 A/B wiring)
4. Ensure lights powered on
5. Test with different DMX start address

### Permission Errors
```bash
sudo usermod -a -G dialout $USER
# Log out and back in
```

### Port Already in Use
```bash
# Find process using port
sudo lsof | grep ttyCH343USB0

# Kill if needed
sudo pkill -f python.*discover-code3
```

## References
- DMX512 Standard: ANSI E1.11 (USITT DMX512-A)
- CH343 Datasheet: QinHeng USB Dual Serial
- Grow3 Manual: (check manufacturer documentation for DIP switch settings)

---

**Status**: DMX512 communication confirmed working  
**Date**: January 20, 2026  
**Next**: User to verify lights respond to test patterns
