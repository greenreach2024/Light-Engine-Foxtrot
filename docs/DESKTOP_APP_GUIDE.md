# Desktop Application Deployment Guide

Complete guide for distributing and installing Light Engine desktop applications for Windows and macOS.

## Table of Contents

1. [Overview](#overview)
2. [System Requirements](#system-requirements)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [Auto-Updates](#auto-updates)
6. [Uninstallation](#uninstallation)
7. [Troubleshooting](#troubleshooting)

## Overview

Desktop applications provide a native experience for inventory-only and full-license users who prefer traditional application interfaces over web access.

**Features:**
- Native OS integration (taskbar, notifications, file associations)
- Offline-first architecture with local SQLite database
- Automatic synchronization with cloud when online
- Auto-updates with rollback capability
- Hardware acceleration for better performance
- System tray integration for quick access

**Use Cases:**
- Inventory management without automation hardware
- Retail farm stores with Point-of-Sale integration
- Wholesale order management
- Offline operation in areas with poor connectivity

## System Requirements

### Windows

**Minimum:**
- Windows 10 64-bit (build 1809 or later)
- 4GB RAM
- 500MB free disk space
- 1280x720 display resolution

**Recommended:**
- Windows 11 64-bit
- 8GB RAM
- 2GB free disk space (for data and caching)
- 1920x1080 display resolution

### macOS

**Minimum:**
- macOS 10.15 Catalina or later
- 4GB RAM
- 500MB free disk space
- 1280x720 display resolution

**Recommended:**
- macOS 13 Ventura or later
- 8GB RAM
- 2GB free disk space
- 1920x1080 display resolution

**Architecture:**
- Intel (x86_64)
- Apple Silicon (ARM64) - native support

## Installation

### Windows

**Method 1: Download Installer**

1. Navigate to https://install.greenreach.io/downloads/
2. Download `Light-Engine-Setup-x.x.x.exe`
3. Run installer (administrator rights required)
4. Follow setup wizard:
   - Choose installation directory (default: `C:\Program Files\Light Engine`)
   - Select components (main app, shortcuts, file associations)
   - Choose start menu folder
   - Click Install

**Method 2: Microsoft Store** *(coming soon)*

**Silent Installation (IT Admins):**

```powershell
# Download installer
Invoke-WebRequest -Uri "https://install.greenreach.io/downloads/Light-Engine-Setup-latest.exe" -OutFile "LightEngineSetup.exe"

# Silent install with options
.\LightEngineSetup.exe /S /D=C:\Program Files\Light Engine

# Verify installation
Get-ItemProperty "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" | 
  Where-Object {$_.DisplayName -like "Light Engine*"}
```

**Group Policy Deployment:**

1. Copy installer to network share
2. Open Group Policy Management
3. Create new GPO or edit existing
4. Navigate to: Computer Configuration → Policies → Software Settings → Software Installation
5. Right-click → New → Package
6. Select installer from network share
7. Choose deployment method: Assigned or Published
8. Apply GPO to target OUs

### macOS

**Method 1: DMG Installer**

1. Navigate to https://install.greenreach.io/downloads/
2. Download `Light-Engine-x.x.x.dmg` (Universal - Intel & Apple Silicon)
3. Open DMG file
4. Drag Light Engine.app to Applications folder
5. Eject DMG

**First Launch:**

macOS Gatekeeper may block unsigned apps:

1. Right-click Light Engine.app → Open
2. Click "Open" in security dialog
3. Or: System Settings → Privacy & Security → Security → Allow

**Method 2: Homebrew Cask** *(coming soon)*

```bash
brew install --cask light-engine
```

**Silent Installation (IT Admins):**

```bash
# Download DMG
curl -O https://install.greenreach.io/downloads/Light-Engine-latest.dmg

# Mount DMG
hdiutil attach Light-Engine-latest.dmg

# Copy to Applications
cp -R "/Volumes/Light Engine/Light Engine.app" /Applications/

# Unmount
hdiutil detach "/Volumes/Light Engine"

# Remove quarantine attribute
xattr -d com.apple.quarantine "/Applications/Light Engine.app"
```

**MDM Deployment (Jamf, Kandji, etc.):**

1. Upload DMG to MDM software
2. Create deployment policy
3. Target computer groups
4. Schedule deployment
5. Optional: Use configuration profile for pre-configuration

## Configuration

### Initial Setup

**First Launch Wizard:**

1. **Welcome Screen**: Overview of Light Engine features
2. **License Type**: Choose deployment mode
   - Cloud-only (inventory)
   - Edge with hardware
   - Desktop-only (inventory + POS)
3. **Activation**: Enter activation code from administrator
4. **Farm Details**: Enter farm name and location
5. **Sync Settings**: Configure cloud synchronization
6. **Complete**: Launch application

### Configuration File

Location:
- **Windows**: `%APPDATA%\Light Engine\config.json`
- **macOS**: `~/Library/Application Support/Light Engine/config.json`

```json
{
  "license": {
    "activationCode": "XXXX-XXXX-XXXX-XXXX",
    "tier": "inventory-only",
    "farmId": "my-farm"
  },
  "sync": {
    "enabled": true,
    "cloudUrl": "https://my-farm.greenreach.io",
    "interval": 300000,
    "autoSync": true
  },
  "database": {
    "path": "data/lightengine.db",
    "backupEnabled": true,
    "backupInterval": 86400000
  },
  "updates": {
    "autoCheck": true,
    "autoDownload": true,
    "autoInstall": false,
    "channel": "stable"
  },
  "ui": {
    "theme": "system",
    "language": "en",
    "startMinimized": false,
    "minimizeToTray": true,
    "notifications": true
  }
}
```

### Command Line Options

**Windows:**
```powershell
# Custom data directory
"C:\Program Files\Light Engine\Light Engine.exe" --data-dir "D:\LightEngineData"

# Development mode
"C:\Program Files\Light Engine\Light Engine.exe" --dev

# Disable hardware acceleration
"C:\Program Files\Light Engine\Light Engine.exe" --disable-gpu

# Custom port
"C:\Program Files\Light Engine\Light Engine.exe" --port 3001

# Verbose logging
"C:\Program Files\Light Engine\Light Engine.exe" --verbose
```

**macOS:**
```bash
# Custom data directory
open -a "Light Engine" --args --data-dir ~/LightEngineData

# Development mode
open -a "Light Engine" --args --dev

# Disable hardware acceleration
open -a "Light Engine" --args --disable-gpu
```

### Environment Variables

```bash
# Windows (PowerShell)
$env:LIGHT_ENGINE_DATA_DIR = "D:\LightEngineData"
$env:LIGHT_ENGINE_LOG_LEVEL = "debug"

# macOS/Linux
export LIGHT_ENGINE_DATA_DIR="$HOME/LightEngineData"
export LIGHT_ENGINE_LOG_LEVEL="debug"
```

## Auto-Updates

### Update Mechanism

Desktop apps check for updates every 6 hours and install at 3 AM by default.

**Update Process:**
1. Check updates.greenreach.com for new version
2. Download update in background
3. Verify digital signature
4. Install at 3 AM (or next app launch)
5. Auto-rollback if update fails

### Manual Update Check

**Via UI:**
1. Click menu: Help → Check for Updates
2. If update available, click "Download & Install"
3. Application will restart after download

**Via Command Line:**

```bash
# Windows
"C:\Program Files\Light Engine\Light Engine.exe" --check-updates

# macOS
open -a "Light Engine" --args --check-updates
```

### Update Channels

**Stable** (Default):
- Production-ready releases
- Thoroughly tested
- Monthly updates
- Recommended for all users

**Beta**:
- Pre-release testing
- New features early access
- Weekly updates
- Some bugs expected

**Dev**:
- Daily builds
- Cutting edge features
- May be unstable
- For testing only

**Change channel:**

Settings → Updates → Update Channel → Select channel

### Disable Auto-Updates

**Via UI:**
Settings → Updates → Uncheck "Automatically install updates"

**Via config file:**
```json
{
  "updates": {
    "autoCheck": false,
    "autoDownload": false,
    "autoInstall": false
  }
}
```

**Via Group Policy (Windows):**

1. Create registry key:
   ```
   HKLM\SOFTWARE\Policies\Light Engine\Updates
   ```
2. Add DWORD value:
   ```
   AutoUpdateEnabled = 0
   ```

### Rollback Failed Update

**Automatic rollback** occurs if:
- Application crashes 3 times after update
- Critical error detected on startup
- Health check fails

**Manual rollback:**

1. Help → About → Version History
2. Select previous version
3. Click "Rollback to This Version"
4. Confirm and restart

## Uninstallation

### Windows

**Method 1: Control Panel**

1. Open Settings → Apps → Installed apps
2. Find "Light Engine"
3. Click three dots → Uninstall
4. Follow uninstall wizard
5. Choose to keep or remove data

**Method 2: Uninstaller**

```powershell
# Run uninstaller directly
& "C:\Program Files\Light Engine\Uninstall Light Engine.exe"

# Silent uninstall
& "C:\Program Files\Light Engine\Uninstall Light Engine.exe" /S
```

**Complete Removal:**

```powershell
# Remove application
Remove-Item -Recurse "C:\Program Files\Light Engine"

# Remove user data
Remove-Item -Recurse "$env:APPDATA\Light Engine"
Remove-Item -Recurse "$env:LOCALAPPDATA\Light Engine"

# Remove registry keys
Remove-Item -Path "HKCU:\Software\Light Engine" -Recurse
Remove-Item -Path "HKLM:\Software\Light Engine" -Recurse
```

### macOS

**Method 1: Drag to Trash**

1. Open Applications folder
2. Drag "Light Engine.app" to Trash
3. Empty Trash

**Method 2: Uninstaller Script**

```bash
#!/bin/bash
# Remove application
sudo rm -rf "/Applications/Light Engine.app"

# Remove user data
rm -rf "$HOME/Library/Application Support/Light Engine"
rm -rf "$HOME/Library/Preferences/io.greenreach.lightengine.plist"
rm -rf "$HOME/Library/Caches/Light Engine"
rm -rf "$HOME/Library/Logs/Light Engine"

# Remove launch agents (if any)
rm -f "$HOME/Library/LaunchAgents/io.greenreach.lightengine.plist"

echo "Light Engine has been uninstalled."
```

## Troubleshooting

### Application Won't Start

**Windows:**

1. **Check Event Viewer**:
   ```
   eventvwr.msc → Windows Logs → Application
   Filter for "Light Engine"
   ```

2. **Run as Administrator**:
   Right-click → Run as administrator

3. **Disable GPU acceleration**:
   ```powershell
   & "C:\Program Files\Light Engine\Light Engine.exe" --disable-gpu
   ```

4. **Check antivirus**: Add exclusion for Light Engine

5. **Reinstall Visual C++ Runtime**:
   Download from https://aka.ms/vs/17/release/vc_redist.x64.exe

**macOS:**

1. **Check Console logs**:
   ```bash
   log show --predicate 'process == "Light Engine"' --last 1h
   ```

2. **Remove quarantine**:
   ```bash
   xattr -d com.apple.quarantine "/Applications/Light Engine.app"
   ```

3. **Check permissions**:
   ```bash
   ls -la "/Applications/Light Engine.app"
   # Should show: drwxr-xr-x
   ```

4. **Reset application**:
   ```bash
   rm -rf "$HOME/Library/Application Support/Light Engine"
   # Restart application
   ```

### Database Errors

**Corrupted database:**

1. **Backup current database**:
   ```bash
   # Windows
   copy "%APPDATA%\Light Engine\data\lightengine.db" "%APPDATA%\Light Engine\data\lightengine.db.backup"
   
   # macOS
   cp "~/Library/Application Support/Light Engine/data/lightengine.db" "~/Library/Application Support/Light Engine/data/lightengine.db.backup"
   ```

2. **Verify database integrity**:
   ```bash
   sqlite3 lightengine.db "PRAGMA integrity_check;"
   ```

3. **Repair database**:
   ```bash
   sqlite3 lightengine.db "VACUUM;"
   ```

4. **Restore from backup** (if repair fails):
   - Application automatically keeps last 7 daily backups
   - Check backups folder in data directory

### Sync Issues

**Not syncing with cloud:**

1. **Check network connectivity**:
   ```bash
   ping my-farm.greenreach.io
   ```

2. **Verify cloud URL**:
   Settings → Sync → Cloud URL should match your farm subdomain

3. **Check license**:
   Help → About → License Status should show "Valid"

4. **Force sync**:
   File → Sync Now (or Ctrl+Shift+S / Cmd+Shift+S)

5. **View sync log**:
   ```bash
   # Windows
   type "%APPDATA%\Light Engine\logs\sync.log"
   
   # macOS
   cat "~/Library/Logs/Light Engine/sync.log"
   ```

### High Memory Usage

1. **Check memory usage**:
   - Windows: Task Manager → Details → Light Engine.exe
   - macOS: Activity Monitor → Light Engine

2. **Clear cache**:
   Settings → Advanced → Clear Cache

3. **Reduce cache size**:
   ```json
   {
     "cache": {
       "maxSize": 100,  // MB (default: 500)
       "clearOnExit": false
     }
   }
   ```

4. **Disable hardware acceleration** (reduces GPU memory):
   Settings → Advanced → Hardware Acceleration → Off

### Update Failures

**Update won't download:**

1. Check internet connection
2. Verify firewall allows updates.greenreach.com
3. Check disk space (need 500MB free minimum)
4. Download manually from website

**Update won't install:**

1. **Close application completely** (check system tray)
2. **Run installer manually**:
   ```bash
   # Windows
   "%LOCALAPPDATA%\Light Engine\updates\Light-Engine-Setup-x.x.x.exe"
   
   # macOS
   open "~/Library/Caches/Light Engine/updates/Light-Engine-x.x.x.dmg"
   ```

**Rollback stuck:**

1. Help → About → Version History
2. Select known good version
3. Click "Force Rollback"
4. If fails, reinstall from website

### Activation Issues

**Invalid activation code:**

1. **Verify code format**: XXXX-XXXX-XXXX-XXXX (16 characters)
2. **Check expiration**: Codes expire after 7 days
3. **Request new code** from administrator
4. **Check network**: Activation requires internet connection

**Hardware mismatch:**

If license bound to different hardware:

1. Contact administrator to transfer license
2. Administrator uses GreenReach Central to transfer
3. Reactivate with same code on new device

### Performance Issues

**Slow startup:**

1. **Disable auto-start items**:
   Settings → General → Launch on startup → Off

2. **Reduce preload**:
   Settings → Advanced → Preload data on startup → Off

3. **Check antivirus**: Exclude application folder

**Slow UI:**

1. **Enable hardware acceleration**:
   Settings → Advanced → Hardware Acceleration → On

2. **Reduce animations**:
   Settings → Appearance → Animations → Reduced

3. **Update graphics drivers**

### Logs and Diagnostics

**Collect logs:**

```bash
# Windows
"C:\Program Files\Light Engine\Light Engine.exe" --export-logs

# macOS
open -a "Light Engine" --args --export-logs
```

Logs exported to:
- Windows: `%USERPROFILE%\Documents\Light Engine Logs\`
- macOS: `~/Documents/Light Engine Logs/`

**Enable debug logging:**

Settings → Advanced → Log Level → Debug

Or via config:
```json
{
  "logging": {
    "level": "debug",
    "console": true,
    "file": true
  }
}
```

## Support

- **In-App Help**: Help → Documentation
- **Community Forum**: https://community.greenreach.io
- **Email Support**: support@greenreach.io
- **Report Bug**: Help → Report Bug (includes logs)

## Next Steps

- [Edge Deployment Guide](EDGE_DEPLOYMENT_GUIDE.md)
- [Cloud Deployment Guide](CLOUD_DEPLOYMENT_GUIDE.md)
- [Wholesale Integration](WHOLESALE_INTEGRATION_GUIDE.md)
- [Security Hardening](SECURITY_HARDENING_GUIDE.md)
