# Touchscreen Setup Guide

## Overview

This guide covers the installation, configuration, and troubleshooting of the Symcod W101M 10.1" capacitive touchscreen display for GreenReach edge devices.

## Hardware Specifications

### Symcod W101M Display

- **Size:** 10.1 inches diagonal
- **Resolution:** 1280x800 pixels (WXGA)
- **Touch Type:** Capacitive multi-touch (10 points)
- **Interface:** HDMI + USB (touch controller)
- **Brightness:** 400 cd/m²
- **Viewing Angle:** 178° (H/V)
- **Power:** 5V DC, <2.5W
- **Operating Temp:** 0°C to 60°C
- **Dimensions:** 263mm x 172mm x 14mm
- **Weight:** 380g

### Compatibility

- ✅ Raspberry Pi 5 (recommended)
- ✅ Raspberry Pi 4B
- ✅ Raspberry Pi 3B+
- ✅ Raspberry Pi Zero 2 W (limited performance)

---

## Physical Installation

### Package Contents

Verify you have all components:

- [ ] Symcod W101M touchscreen display
- [ ] HDMI cable (standard to micro HDMI)
- [ ] USB-A to USB-C cable (touch controller)
- [ ] 5V/3A power adapter (optional, can power from Pi)
- [ ] Mounting bracket
- [ ] M3 screws (4x)
- [ ] Quick start guide

### Mounting Options

#### Option 1: Desktop Stand

1. Attach mounting bracket to back of display using M3 screws
2. Unfold stand to desired viewing angle (30-70°)
3. Place on flat, stable surface
4. Route cables to avoid strain

**Recommended For:**
- Testing and development
- Temporary installations
- Mobile/portable setups

#### Option 2: Wall Mount

1. Mark mounting holes on wall (follow bracket template)
2. Install wall anchors (for drywall) or use wood screws
3. Attach mounting bracket to wall
4. Slide display onto bracket until locked
5. Route cables through cable management channel

**Recommended For:**
- Permanent installations
- Production environments
- Clean cable management

#### Option 3: VESA Mount

1. Verify display has VESA 75x75mm mounting holes
2. Attach VESA arm to display using M4 screws
3. Mount arm to desk/wall
4. Adjust to ergonomic viewing angle

**Recommended For:**
- Adjustable installations
- Multi-user environments
- Space-constrained areas

### Cable Connections

**Connection Order:**

1. **HDMI Video:**
   - Connect micro HDMI to Raspberry Pi HDMI0 port
   - Connect standard HDMI to display
   - Secure both connectors

2. **USB Touch Controller:**
   - Connect USB-C to display touch port
   - Connect USB-A to any Raspberry Pi USB port
   - Verify green LED illuminates on display

3. **Power (Optional):**
   - If using separate power: Connect 5V adapter to display
   - If using Pi power: Display draws from USB connection
   - Recommended: Use separate power for Pi 5 stability

**Cable Management:**
- Use cable ties to bundle HDMI and USB together
- Leave 6-8 inches of slack for movement
- Avoid sharp bends in HDMI cable
- Keep cables away from heat sources

---

## Software Configuration

### Raspberry Pi OS Setup

#### 1. Enable HDMI Output

Edit `/boot/config.txt`:

```bash
sudo nano /boot/config.txt
```

Add these lines:

```ini
# Enable HDMI output
hdmi_force_hotplug=1
hdmi_drive=2

# Set resolution for W101M (1280x800)
hdmi_group=2
hdmi_mode=28

# Disable HDMI overscan
disable_overscan=1

# Rotate display if needed (0, 90, 180, 270)
display_rotate=0
```

Save and reboot:

```bash
sudo reboot
```

#### 2. Configure Touch Controller

Install touch driver:

```bash
sudo apt-get update
sudo apt-get install -y xinput-calibrator
```

Verify touch device is detected:

```bash
xinput list
```

Expected output:
```
⎜   ↳ Goodix Capacitive TouchScreen    id=X    [slave  pointer  (Y)]
```

#### 3. Calibrate Touchscreen

Run calibration utility:

```bash
DISPLAY=:0 xinput_calibrator
```

Follow on-screen instructions:
1. Tap each target as it appears
2. Copy calibration output
3. Save to `/etc/X11/xorg.conf.d/99-calibration.conf`

Example calibration:

```bash
sudo mkdir -p /etc/X11/xorg.conf.d
sudo nano /etc/X11/xorg.conf.d/99-calibration.conf
```

Paste calibration data:

```conf
Section "InputClass"
    Identifier "calibration"
    MatchProduct "Goodix Capacitive TouchScreen"
    Option "Calibration" "3936 227 268 3880"
    Option "SwapAxes" "0"
EndSection
```

Restart X server:

```bash
sudo systemctl restart lightdm
```

---

## GreenReach UI Configuration

### Browser Setup

GreenReach uses a full-screen Chromium browser for the UI.

#### 1. Install Chromium

```bash
sudo apt-get install -y chromium-browser unclutter
```

#### 2. Configure Kiosk Mode

Create startup script:

```bash
sudo nano /home/pi/start-greenreach-ui.sh
```

Add content:

```bash
#!/bin/bash

# Wait for X server
sleep 5

# Hide mouse cursor after 0.1s idle
unclutter -idle 0.1 &

# Disable screen blanking
xset s off
xset -dpms
xset s noblank

# Start Chromium in kiosk mode
chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --touch-events=enabled \
  http://localhost:3000/setup/wizard
```

Make executable:

```bash
chmod +x /home/pi/start-greenreach-ui.sh
```

#### 3. Auto-Start on Boot

Create desktop autostart entry:

```bash
mkdir -p ~/.config/autostart
nano ~/.config/autostart/greenreach-ui.desktop
```

Add content:

```ini
[Desktop Entry]
Type=Application
Name=GreenReach UI
Exec=/home/pi/start-greenreach-ui.sh
X-GNOME-Autostart-enabled=true
```

Reboot to test:

```bash
sudo reboot
```

### Touch Optimization

#### 1. Increase Touch Target Sizes

GreenReach UI uses large touch targets:
- Minimum size: 64x64px (recommended by Apple/Google)
- Button padding: 2rem (32px)
- Font sizes: 1.5-2.5rem for touch elements

#### 2. Disable Context Menus

Add to Chromium flags:

```bash
--disable-context-menu
```

#### 3. Prevent Accidental Zoom

CSS in GreenReach UI:

```css
* {
  touch-action: manipulation;
  user-select: none;
}
```

---

## Touchscreen Gestures

### Supported Gestures

| Gesture | Action | Use Case |
|---------|--------|----------|
| **Tap** | Click/select | Primary interaction |
| **Long Press** | Context menu | Advanced options |
| **Swipe** | Navigate | Page transitions |
| **Pinch** | Zoom | Charts/graphs (disabled in wizard) |
| **Two-Finger Tap** | Right-click | (Disabled in production) |

### Gesture Configuration

Disable unwanted gestures in JavaScript:

```javascript
// Disable pinch-to-zoom
document.addEventListener('gesturestart', function(e) {
  e.preventDefault();
});

// Disable double-tap zoom
let lastTap = 0;
document.addEventListener('touchend', function(e) {
  const now = Date.now();
  if (now - lastTap < 300) {
    e.preventDefault();
  }
  lastTap = now;
});
```

---

## On-Screen Keyboard

### Virtual Keyboard Options

#### Option 1: Matchbox Keyboard (Lightweight)

Install:

```bash
sudo apt-get install -y matchbox-keyboard
```

Auto-show on input focus:

```javascript
// In GreenReach UI
document.querySelectorAll('input, textarea').forEach(element => {
  element.addEventListener('focus', () => {
    // Show keyboard
    fetch('/api/keyboard/show');
  });
  
  element.addEventListener('blur', () => {
    // Hide keyboard
    fetch('/api/keyboard/hide');
  });
});
```

#### Option 2: Florence (Feature-Rich)

Install:

```bash
sudo apt-get install -y florence
```

Configure auto-hide:

```bash
gsettings set org.gnome.florence hide-on-start false
```

#### Option 3: Custom HTML Keyboard (Recommended)

GreenReach includes a custom on-screen keyboard:

**Features:**
- Large touch targets (60x60px keys)
- Uppercase/lowercase toggle
- Backspace and special characters
- Integrated with input fields
- No external dependencies

**Location:** `/setup-wizard.html` (included)

**Usage:**
```javascript
showKeyboard();  // Display keyboard
hideKeyboard();  // Hide keyboard
typeKey('A');    // Type a character
backspaceKey();  // Delete character
```

---

## Calibration

### When to Calibrate

Recalibrate if you experience:
- Touch offset (tap registers elsewhere)
- Inverted X or Y axis
- No touch response
- Erratic behavior

### 5-Point Calibration

#### Method 1: GreenReach UI

1. Navigate to **Settings** → **Touchscreen**
2. Tap **Calibrate**
3. Follow on-screen prompts:
   - Tap top-left target
   - Tap top-right target
   - Tap bottom-right target
   - Tap bottom-left target
   - Tap center target
4. Test calibration
5. Tap **Save** to persist

#### Method 2: Command Line

```bash
# Run calibration utility
DISPLAY=:0 xinput_calibrator

# Output will show calibration values:
Section "InputClass"
    Identifier "calibration"
    MatchProduct "Goodix Capacitive TouchScreen"
    Option "Calibration" "3936 227 268 3880"
    Option "SwapAxes" "0"
EndSection

# Save to config file
sudo nano /etc/X11/xorg.conf.d/99-calibration.conf
# Paste above section

# Restart X server
sudo systemctl restart lightdm
```

### Testing Calibration

Use `evtest` to verify touch input:

```bash
sudo apt-get install -y evtest
sudo evtest
```

Select touch device, then tap corners to verify coordinates.

---

## Troubleshooting

### Display Issues

#### No Display Output

**Symptoms:** Black screen, no backlight

**Solutions:**
1. Check HDMI cable is securely connected
2. Verify Pi is powered on (green LED)
3. Try different HDMI cable
4. Test display with another device
5. Check `/boot/config.txt` HDMI settings
6. Force HDMI hotplug: `hdmi_force_hotplug=1`

#### Wrong Resolution

**Symptoms:** Stretched or cropped display

**Solutions:**
1. Set correct resolution in `/boot/config.txt`:
   ```ini
   hdmi_group=2
   hdmi_mode=28  # 1280x800
   ```
2. List available modes:
   ```bash
   tvservice -m DMT
   ```
3. Reboot after changes

#### Flickering Display

**Symptoms:** Screen flickers or blanks intermittently

**Solutions:**
1. Use high-quality HDMI cable (<3 ft recommended)
2. Check power supply is adequate (5V/5A for Pi 5)
3. Disable HDMI overscan: `disable_overscan=1`
4. Reduce HDMI output boost: `config_hdmi_boost=4`

### Touch Issues

#### No Touch Response

**Symptoms:** Screen displays correctly but doesn't respond to touch

**Solutions:**
1. Verify USB cable is connected to touch port
2. Check green LED on display is illuminated
3. List USB devices:
   ```bash
   lsusb
   ```
   Should show: `Bus 001 Device 00X: ID 0416:XXXX Winbond Electronics Corp.`
4. Check dmesg for errors:
   ```bash
   dmesg | grep -i touch
   ```
5. Reinstall touch driver:
   ```bash
   sudo apt-get install --reinstall xserver-xorg-input-evdev
   ```

#### Inverted Touch

**Symptoms:** Touch X/Y axis is flipped or mirrored

**Solutions:**
1. Edit calibration file:
   ```bash
   sudo nano /etc/X11/xorg.conf.d/99-calibration.conf
   ```
2. Add swap/invert options:
   ```conf
   Option "SwapAxes" "1"        # Swap X and Y
   Option "InvertX" "1"         # Invert X axis
   Option "InvertY" "1"         # Invert Y axis
   ```
3. Restart X server:
   ```bash
   sudo systemctl restart lightdm
   ```

#### Touch Offset

**Symptoms:** Touch registers 1-2 inches away from tap location

**Solutions:**
1. Run calibration tool (see Calibration section)
2. Verify display rotation matches touch rotation
3. Check no conflicting calibration files exist:
   ```bash
   find /etc -name "*calib*"
   find /usr/share -name "*calib*"
   ```

#### Multi-Touch Not Working

**Symptoms:** Only single touch detected

**Solutions:**
1. Verify device supports multi-touch:
   ```bash
   xinput list-props "Goodix Capacitive TouchScreen"
   ```
   Look for: `Multi Touch: 1`
2. Enable multi-touch in X config:
   ```conf
   Option "MaxTouches" "10"
   ```

### Performance Issues

#### Laggy Touch Response

**Symptoms:** Delay between tap and action (>200ms)

**Solutions:**
1. Close unnecessary applications
2. Disable desktop compositing:
   ```bash
   xfconf-query -c xfwm4 -p /general/use_compositing -s false
   ```
3. Increase CPU governor to performance:
   ```bash
   echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor
   ```
4. Enable GPU acceleration in Chromium:
   ```bash
   --enable-gpu-rasterization
   --enable-zero-copy
   ```

#### High CPU Usage

**Symptoms:** System sluggish, fan constantly running

**Solutions:**
1. Check CPU usage:
   ```bash
   top -u pi
   ```
2. Disable Chromium hardware acceleration if unstable:
   ```bash
   --disable-gpu
   ```
3. Reduce animation complexity in CSS
4. Enable lightweight desktop environment (LXDE instead of XFCE)

---

## Maintenance

### Cleaning

**Frequency:** Weekly (or as needed)

**Process:**
1. Power off display
2. Use microfiber cloth slightly dampened with water
3. Gently wipe screen in circular motions
4. Avoid harsh chemicals (alcohol, ammonia, acetone)
5. Dry with clean microfiber cloth

**Do NOT:**
- ❌ Spray liquid directly on screen
- ❌ Use paper towels (can scratch)
- ❌ Apply excessive pressure
- ❌ Clean while powered on

### Firmware Updates

Check for display firmware updates:

```bash
# Update system packages
sudo apt-get update
sudo apt-get upgrade -y

# Update Raspberry Pi firmware
sudo rpi-update

# Reboot
sudo reboot
```

### Backup Calibration

Save calibration settings:

```bash
# Backup calibration file
sudo cp /etc/X11/xorg.conf.d/99-calibration.conf \
       /etc/X11/xorg.conf.d/99-calibration.conf.bak

# Backup entire X11 config
sudo tar -czf /home/pi/xorg-backup-$(date +%Y%m%d).tar.gz /etc/X11
```

---

## Advanced Configuration

### Custom Resolution

For non-standard resolutions:

```bash
# Calculate CVT timings
cvt 1280 800 60

# Output: Modeline "1280x800_60.00" 83.46 1280 1344 1480 1680 800 801 804 828 -HSync +Vsync

# Add to /boot/config.txt
hdmi_timings=1280 1 344 480 1680 800 1 4 28 828 0 0 0 60 0 83460000 5

# Set custom mode
hdmi_group=2
hdmi_mode=87  # Use custom timings
```

### Screen Rotation

Rotate display for different orientations:

```bash
# Edit /boot/config.txt
sudo nano /boot/config.txt

# Add rotation (0, 90, 180, 270)
display_rotate=90  # or 0, 180, 270

# Also rotate touch input
# In /etc/X11/xorg.conf.d/99-calibration.conf
Option "TransformationMatrix" "0 1 0 -1 0 1 0 0 1"  # 90° rotation
```

### Brightness Control

Adjust backlight brightness:

```bash
# Via sysfs (if supported)
echo 50 | sudo tee /sys/class/backlight/*/brightness

# Or via HDMI
vcgencmd display_power 0  # Off
vcgencmd display_power 1  # On
```

---

## Specifications Comparison

| Feature | Symcod W101M | Raspberry Pi Official 7" | Generic HDMI 10" |
|---------|--------------|--------------------------|------------------|
| **Size** | 10.1" | 7" | 10.1" |
| **Resolution** | 1280x800 | 800x480 | 1024x600 |
| **Touch Type** | Capacitive (10-point) | Capacitive (10-point) | Resistive (1-point) |
| **Interface** | HDMI + USB | DSI + I2C | HDMI + USB |
| **Brightness** | 400 cd/m² | 430 cd/m² | 300 cd/m² |
| **Price** | $89 | $75 | $45-60 |
| **Recommended** | ✅ Yes | Limited size | No (low quality) |

---

## Support Resources

### Official Documentation

- **Symcod W101M Manual:** [symcod.com/w101m](https://symcod.com/w101m)
- **Raspberry Pi Display Docs:** [raspberrypi.org/documentation](https://raspberrypi.org/documentation)
- **GreenReach Support:** support@greenreach.com

### Community Forums

- Raspberry Pi Forums: [raspberrypi.org/forums](https://raspberrypi.org/forums)
- GreenReach Community: [community.greenreach.com](https://community.greenreach.com)

### Diagnostic Tools

```bash
# Display information
vcgencmd display_power
tvservice -s

# Touch input
evtest
xinput list
xinput list-props <device>

# System info
cat /proc/cpuinfo
cat /proc/meminfo
vcgencmd get_mem arm && vcgencmd get_mem gpu
```

---

**Document Version:** 1.0.0  
**Last Updated:** 2024-01-15  
**Compatible With:** GreenReach Edge OS 1.0+  
**Hardware:** Symcod W101M Display  
**License:** Proprietary - GreenReach Systems, Inc.
