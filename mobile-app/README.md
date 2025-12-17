# Light Engine Mobile App

Mobile QR scanner and farm monitoring application for Light Engine indoor agriculture platform.

## Features

### Core Inventory Management
- **Cross-platform**: iOS and Android support via React Native + Expo
- **QR Scanning**: Real-time camera scanning for trays and locations
- **Tray Workflows**: 
  - Seed new trays with recipe selection
  - Place trays in locations
  - Record harvest data
- **Dashboard**: View active trays, plant counts, and harvest forecasts
- **Authentication**: Farm-specific login with secure token storage
- **Multi-Farm**: Each user assigned to specific farm instance

### Environmental Monitoring (NEW)
- **Real-Time Sensors**: Temperature, humidity, VPD, CO2, PPFD monitoring
- **Trend Charts**: Historical temperature visualization with 1H/6H/24H views
- **ML Anomaly Detection**: Critical/warning/info alerts powered by IsolationForest
- **Target Setpoints**: Actual vs. target comparison for all metrics
- **Multi-Room Support**: Room/zone selector for large farms

### Notifications & Alerts (NEW)
- **Alert Center**: Unified notification feed with unread badge
- **Harvest Reminders**: Daily alerts for trays ready to harvest
- **Anomaly Alerts**: Real-time environmental warnings
- **Device Status**: Offline sensor/light notifications
- **Low Inventory**: Supply level warnings
- **Daily Summary**: End-of-day reports
- **Customizable Preferences**: Toggle notification types on/off

## Prerequisites

- Node.js 18+ installed
- Expo CLI: `npm install -g expo-cli`
- Expo Go app on your phone (for testing)
- Light Engine backend running (port 8000)

## Installation

```bash
cd mobile-app
npm install
```

## Development

### Start Development Server

```bash
npm start
```

This opens Expo DevTools. Options:
- **Scan QR code** with Expo Go app (iOS/Android)
- **Press 'i'** to open iOS simulator
- **Press 'a'** to open Android emulator

### Run on Specific Platform

```bash
npm run ios       # iOS simulator
npm run android   # Android emulator
npm run web       # Browser (limited functionality)
```

## Configuration

### Farm Connection

On first launch, enter:
- **Email**: Your user account email
- **Password**: Your password
- **Farm URL**: Your farm's backend address

Example URLs:
- Local network: `http://192.168.1.100:8000`
- VPN/tunneled: `http://10.0.0.5:8000`
- Production: `https://farm.example.com`

### Backend Requirements

The mobile app connects to Light Engine backend API endpoints:

**Inventory Endpoints:**
- `POST /api/login` - Authentication (future)
- `GET /api/recipes` - List available recipes
- `GET /api/tray-formats` - List tray formats
- `POST /api/trays/register` - Register new tray
- `POST /api/trays/{id}/seed` - Seed a tray
- `POST /api/tray-runs/{id}/place` - Place tray in location
- `POST /api/tray-runs/{id}/harvest` - Record harvest
- `GET /api/inventory/current` - Dashboard inventory data
- `GET /api/inventory/forecast` - Harvest forecast
- `GET /api/locations/by-qr/{qr}` - Lookup location by QR code

**Environmental Endpoints (NEW):**
- `GET /env` - Current environmental data (port 8091)
- `GET /api/ml/anomalies` - ML anomaly detection (port 8091)
- `GET /api/ml/forecast` - SARIMAX temperature predictions (port 8091)

**Notification Endpoints (Pending Backend Implementation):**
- `GET /api/notifications` - Fetch user notifications
- `POST /api/notifications/:id/read` - Mark notification as read
- `POST /api/notifications/read-all` - Mark all as read
- `PUT /api/users/:userId/notification-preferences` - Update preferences

## Usage Guide

### 1. Login

Enter credentials and farm URL. The app stores your session securely.

### 2. Dashboard

View farm overview:
- Active tray count
- Total plant count
- Harvest forecast (today, this week, next week)
- Pull down to refresh

### 3. Scan QR Codes

Tap **Scanner** tab → Point camera at QR code → Choose action:
- **Seed**: Start new crop cycle
- **Place**: Move tray to location
- **Harvest**: Record harvest data

### 4. Seed Tray

1. Scan tray QR code
2. Select recipe (uses Light Engine recipe names)
3. Choose tray format (cell count)
4. Set seed date
5. Tap **Seed Tray**

### 5. Place Tray

1. Scan tray QR code
2. Scan location QR code (or enter manually)
3. Add notes (optional)
4. Tap **Place Tray**

### 6. Harvest Tray

1. Scan tray QR code
2. Enter actual harvest count
3. Add quality notes
4. Tap **Record Harvest**

### 7. Monitor Environment (NEW)

Tap **Environment** tab:
- **Select Room**: Tap room chip to filter data
- **View Anomalies**: Critical/warning alerts at top
- **Check Conditions**: Temperature, humidity, VPD, CO2, PPFD
- **Review Trends**: Temperature chart with 1H/6H/24H time ranges
- **Compare Targets**: Actual vs. target setpoints

### 8. Manage Notifications (NEW)

Tap **Notifications** tab (bell icon with badge):
- **Read Alerts**: Tap notification to mark as read
- **Clear All**: Use "Mark all as read" button
- **Customize Preferences**: Toggle notification types:
  - 🌱 Harvest reminders
  - 🌡️ Anomaly alerts
  - 📡 Device offline
  - 📦 Low inventory
  - 📊 Daily summary

**Current Status**: Mock notifications for UI testing. Backend integration pending.

## Building for Production

### iOS Build

```bash
expo build:ios
```

Requirements:
- Apple Developer account ($99/year)
- iOS distribution certificate
- Provisioning profile

### Android Build

```bash
expo build:android
```

Generates APK or AAB file for:
- Google Play Store
- Direct APK installation

### Standalone Configuration

Edit `app.json`:
```json
{
  "expo": {
    "ios": {
      "bundleIdentifier": "com.yourcompany.lightengine"
    },
    "android": {
      "package": "com.yourcompany.lightengine"
    }
  }
}
```

## Troubleshooting

### Camera Not Working

**iOS**: Check Settings → Light Engine → Camera permission
**Android**: Check Settings → Apps → Light Engine → Permissions

### Cannot Connect to Farm

- Verify farm URL is correct
- Ensure phone and farm server on same network (or VPN connected)
- Check backend is running: `curl http://YOUR_FARM_URL/api/recipes`
- Disable phone VPN if causing routing issues

### QR Codes Not Scanning

- Ensure good lighting
- Hold phone steady
- Try manual entry as fallback
- Verify QR codes are high-contrast (black on white)

### Recipe Names Not Showing

Backend must return recipes in format:
```json
{
  "lettuce-buttercrunch-21d": {
    "name": "Buttercrunch Lettuce (21 day)",
    "daysToHarvest": 21
  }
}
```

## Architecture

```
mobile-app/
├── App.js                      # Main app entry + navigation
├── src/
│   ├── context/
│   │   └── AuthContext.js      # Authentication state
│   ├── screens/
│   │   ├── LoginScreen.js      # Login form
│   │   ├── DashboardScreen.js  # Inventory overview
│   │   ├── ScannerScreen.js    # QR camera scanner
│   │   ├── SeedTrayScreen.js   # Seed workflow
│   │   ├── PlaceTrayScreen.js  # Placement workflow
│   │   ├── HarvestTrayScreen.js # Harvest workflow
│   │   └── SettingsScreen.js   # User settings
│   └── services/
│       └── api.js              # API client (axios)
├── app.json                    # Expo configuration
└── package.json                # Dependencies
```

## Tech Stack

- **Framework**: React Native 0.73
- **Platform**: Expo SDK 50
- **UI Library**: React Native Paper (Material Design)
- **Navigation**: React Navigation 6
- **QR Scanner**: expo-camera + expo-barcode-scanner
- **HTTP Client**: axios
- **Storage**: AsyncStorage

## Security Notes

- Tokens stored in AsyncStorage (encrypted on device)
- HTTPS recommended for production farm URLs
- Camera permissions requested at runtime
- No sensitive data in logs

## Support

For issues or questions:
1. Check backend logs for API errors
2. Review Expo DevTools console
3. Verify network connectivity
4. Test API endpoints with curl

## License

Copyright 2024 Greenreach. All rights reserved.
