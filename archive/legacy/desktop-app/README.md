# Light Engine Desktop

Electron-based desktop application for Light Engine inventory management.

## Overview

Light Engine Desktop is a cross-platform desktop app (Windows/macOS) that provides inventory management for vertical farms without requiring an edge device. Perfect for farms that want inventory tracking and wholesale marketplace access without automation features.

## Features

- **Inventory Management**: Track all crops, harvests, and stock levels
- **Harvest Scheduling**: Plan and schedule harvest activities
- **Wholesale Marketplace**: Buy and sell through GreenReach wholesale network
- **Reporting**: Generate harvest reports and analytics
- **Offline-First**: Works without internet connection (syncs when online)
- **Auto-Start**: Launches on computer startup
- **System Tray**: Runs in background with tray icon

## Architecture

- **Frontend**: Light Engine web interface (same as edge/cloud)
- **Backend**: Express server running locally
- **Database**: SQLite (local file)
- **Storage**: Local filesystem
- **Mode**: `inventory-only` deployment mode

## Development

Install dependencies:
```bash
cd desktop-app
npm install
```

Run in development mode:
```bash
npm run dev
```

## Building

### Windows (.msi installer)

```bash
npm run build:win
```

Output: `dist/Light Engine Setup 1.0.0.exe`

Requirements:
- Windows 10/11
- NSIS (installer creator)

### macOS (.dmg installer)

```bash
npm run build:mac
```

Output: `dist/Light Engine-1.0.0.dmg`

Requirements:
- macOS 12+ (Monterey or later)
- Xcode command line tools
- Code signing certificate (optional)

### Build Both

```bash
npm run build:all
```

## Installation

### Windows

1. Download `Light Engine Setup.exe`
2. Run installer
3. Choose installation directory
4. App installs and starts automatically
5. Access at http://localhost:8091

### macOS

1. Download `Light Engine.dmg`
2. Open DMG file
3. Drag app to Applications folder
4. Open from Applications
5. Access at http://localhost:8091

## Configuration

Config stored in:
- Windows: `%APPDATA%/lightengine-desktop/`
- macOS: `~/Library/Application Support/lightengine-desktop/`

Files:
- `config.json` - App configuration
- `lightengine.db` - SQLite database
- `logs/` - Application logs

## Auto-Start

### Windows
- Added to Windows Startup folder during installation
- Disable: Task Manager → Startup → Light Engine → Disable

### macOS
- Added to Login Items during installation
- Disable: System Preferences → Users & Groups → Login Items

## System Requirements

### Windows
- Windows 10 64-bit or later
- 4 GB RAM minimum
- 500 MB disk space
- Internet connection (for wholesale features)

### macOS
- macOS 12 (Monterey) or later
- 4 GB RAM minimum
- 500 MB disk space
- Internet connection (for wholesale features)

## Upgrading to Edge Device

To get automation features (climate control, sensors, ML):

1. Purchase Light Engine edge device from GreenReach
2. Export data: Settings → Export Data
3. Install edge device with exported data
4. Edge device takes over with full features
5. Desktop app can be uninstalled or kept as backup

## Troubleshooting

### App won't start
- Check port 8091 is not in use
- Check database file permissions
- Try resetting: Delete config folder and restart

### Can't access interface
- Ensure app is running (check system tray)
- Try http://localhost:8091 in browser
- Check firewall settings

### Database errors
- Close app completely
- Backup database file
- Delete database and restart (creates new one)

### Wholesale features not working
- Check internet connection
- Verify farm is registered on GreenReach
- Check firewall/antivirus settings

## Support

- Email: support@greenreach.io
- Documentation: https://docs.greenreach.io
- Community: https://community.greenreach.io

## License

Proprietary software. License required for production use.
Contact sales@greenreach.io for licensing information.
