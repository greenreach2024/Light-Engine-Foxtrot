# Changelog

All notable changes to the Light Engine Mobile App will be documented in this file.

## [1.1.0] - 2024-12-XX (Current Development)

### Added

#### Environmental Monitoring
- **EnvironmentScreen** - Real-time sensor data visualization
  - Room/zone selector for multi-room farms
  - Current conditions grid: Temperature, RH, VPD, CO2, PPFD
  - Temperature trend chart with Bezier smoothing
  - Time range selector: 1 hour / 6 hours / 24 hours
  - ML-powered anomaly alerts (Critical/Warning/Info severity)
  - Target setpoint comparison (actual vs. target)
  - Integration with existing SARIMAX forecasting backend
  - IsolationForest anomaly detection with severity scoring

#### Notification System
- **NotificationsScreen** - Alert center with preferences
  - Unread badge counter in tab navigation
  - 5 notification types:
    - Harvest reminders (trays ready to harvest)
    - Anomaly alerts (temperature/humidity issues)
    - Device offline (sensors/lights disconnected)
    - Low inventory (supplies running low)
    - Daily summary (end-of-day reports)
  - Toggleable preferences with AsyncStorage persistence
  - Mark as read / Mark all as read functionality
  - Relative timestamp formatting ("Just now", "2h ago", "3d ago")
  - Mock notification data for UI testing (backend pending)

#### Navigation Updates
- Added Environment tab (thermometer icon) to bottom tab navigator
- Added Notifications tab (bell icon) with dynamic badge
- Updated tab order: Dashboard → Scanner → Environment → Notifications → Settings

#### API Service Extensions
- `getEnvironmentData(roomId, timeRange)` - Fetch environmental sensor data
- `getAnomalies()` - ML anomaly detection results
- `getForecast(zone, hours, metric)` - SARIMAX temperature predictions
- `getNotifications()` - Notification feed (mock implementation)
- `markNotificationRead(id)` - Mark single notification as read
- `markAllNotificationsRead()` - Bulk mark as read
- `updateNotificationPreferences(prefs)` - Sync preferences to backend

#### Dependencies
- `react-native-chart-kit` (^6.12.0) - Line chart visualization
- `react-native-svg` (^14.0.0) - Chart rendering (peer dependency)
- `@react-native-picker/picker` (^2.6.1) - Recipe/format dropdown selectors

#### Documentation
- `MOBILE_APP_ENVIRONMENTAL_FEATURES.md` - Comprehensive feature guide
- `NAVIGATION_STRUCTURE.md` - Navigation flow and screen details
- Updated `README.md` with new features and usage instructions

### Changed
- Bottom tab navigator expanded from 3 to 5 tabs
- App.js imports updated to include new screens
- Tab navigator configuration updated with new icons and badge

### Backend Integration Notes
- Environmental endpoints integrate with existing Node.js server (port 8091)
- Uses existing SARIMAX forecasting model (±0.5-1.5°C accuracy)
- Leverages weighted median sensor aggregation from `env-store.js`
- ML anomaly detection via existing `/api/ml/anomalies` endpoint
- Notification endpoints defined but not yet implemented in backend

### Pending Backend Work
- Notification database schema (notification table, user preferences)
- Notification CRUD endpoints (GET, POST, PUT)
- Push notification integration (Expo push tokens)
- Notification trigger system (harvest reminders, anomaly alerts, device status)
- Preference sync between mobile and web dashboard

---

## [1.0.0] - 2024-12-XX (Initial Release)

### Added

#### Core Features
- React Native 0.73 + Expo SDK 50 foundation
- Cross-platform support (iOS, Android, Web)
- Material Design 3 dark theme via React Native Paper

#### Authentication
- Farm-specific login screen
- Email + password + farm URL inputs
- JWT token storage with AsyncStorage
- Multi-farm user support
- AuthContext for global auth state

#### QR Code Scanning
- Real-time camera scanning with expo-camera
- Visual scan window with corner guides
- Camera permission handling (iOS + Android)
- Action selection dialog (Seed/Place/Harvest)
- Navigation to appropriate workflow screens

#### Inventory Workflows
- **DashboardScreen** - Home screen with inventory overview
  - Active tray count
  - Total plant count
  - Harvest forecast buckets (today, this week, next week)
  - Pull-to-refresh functionality
  - Farm name chip display

- **SeedTrayScreen** - Seed tray workflow
  - QR code display (scanned tray ID)
  - Recipe dropdown (fetches from Light Engine backend)
  - Tray format selector (128/200/288 cell)
  - Seed date picker
  - Plant count input
  - Integration with `/api/recipes` endpoint

- **PlaceTrayScreen** - Place tray in location
  - Tray info card (recipe, seed date, expected harvest)
  - Location QR scan or manual entry
  - API integration for tray and location lookup

- **HarvestTrayScreen** - Record harvest data
  - Tray info card with days growing calculation
  - Actual harvest count input
  - Quality notes field
  - Harvest submission to backend

- **SettingsScreen** - User account and app info
  - User email display
  - Farm connection details (name, URL)
  - App version
  - Sign out button

#### API Service
- Centralized Axios-based HTTP client
- Farm-specific base URL configuration
- JWT authentication token injection
- 18 API methods:
  - Authentication: login()
  - Recipes: getRecipes()
  - Tray formats: getTrayFormats()
  - Inventory: getCurrentInventory(), getHarvestForecast()
  - Tray operations: registerTray(), seedTray(), getTrayInfo(), placeTray(), harvestTray()
  - Location lookup: getLocationByQR()

#### Navigation
- React Navigation 6 (Stack + Bottom Tabs)
- Bottom tab navigator: Dashboard, Scanner, Settings
- Stack navigator for workflow screens (Seed, Place, Harvest)
- Material Community Icons for tab icons
- Custom dark theme styling

#### Styling
- Material Design 3 dark theme
- Slate color palette (slate-800 bg, slate-700 borders)
- Blue-400 accent color (#60a5fa)
- Consistent header and tab bar styling
- Responsive layout with ScrollView

### Technical Stack
- **Framework**: React Native 0.73.6
- **SDK**: Expo 50
- **Navigation**: React Navigation 6
- **UI Library**: React Native Paper 5.11.6
- **State Management**: React Context API + AsyncStorage
- **HTTP Client**: Axios 1.6.5
- **Camera**: expo-camera 14.0 + expo-barcode-scanner 12.9
- **Icons**: react-native-vector-icons 10.0.3

### Backend Integration
- FastAPI backend on port 8000 (Python)
- Node.js Express on port 8091 (environmental data)
- SQLite database with 10 inventory tables
- QR inventory system integration
- Recipe management system integration

### Documentation
- `README.md` - Quick start and feature overview
- `QUICKSTART.md` - Step-by-step setup guide
- `package.json` - Dependency manifest with versions
- `app.json` - Expo configuration

---

## Versioning

This project follows [Semantic Versioning](https://semver.org/):
- **MAJOR** version for incompatible API changes
- **MINOR** version for new features (backward-compatible)
- **PATCH** version for bug fixes (backward-compatible)

## Release Process

1. Update version in `package.json` and `app.json`
2. Update this CHANGELOG.md with new features
3. Commit changes: `git commit -m "Release v1.x.x"`
4. Tag release: `git tag v1.x.x`
5. Push: `git push && git push --tags`
6. Build production: `expo build:ios` and `expo build:android`
7. Submit to App Store / Play Store

## Upcoming Features (Roadmap)

### v1.2.0 - Advanced Monitoring
- [ ] Forecast visualization screen (4-hour SARIMAX predictions)
- [ ] Push notification integration (Expo push tokens)
- [ ] Notification trigger system (backend implementation)
- [ ] Environmental alert history
- [ ] Multi-metric charts (temperature + humidity overlaid)

### v1.3.0 - QR Label Generation
- [ ] Print tray labels feature
- [ ] Print location labels feature
- [ ] QR code generation (`react-native-qrcode-svg`)
- [ ] PDF export for batch printing
- [ ] Label templates with farm branding

### v1.4.0 - Offline Mode
- [ ] AsyncStorage cache for critical data
- [ ] Offline queue for API calls (seed, place, harvest)
- [ ] Background sync when connection restored
- [ ] Offline indicator in header
- [ ] Conflict resolution for concurrent edits

### v1.5.0 - Recipe Management
- [ ] Recipe detail screen (spectrum, photoperiod, nutrients)
- [ ] Edit recipes (admin users only)
- [ ] Clone recipes for customization
- [ ] Recipe performance metrics (avg harvest weight, days to harvest)
- [ ] Recipe search and filtering

### v2.0.0 - Multi-Language Support
- [ ] i18n integration (`react-i18next`)
- [ ] Spanish translation
- [ ] French translation
- [ ] Chinese translation
- [ ] Language selector in Settings
- [ ] Locale-aware date/number formatting

---

**Maintainers**: Light Engine Development Team  
**License**: Proprietary  
**Support**: support@lightengine.com
