# Light Engine Mobile App - Navigation Structure

## App Flow Diagram

```
┌─────────────────────────────────────────────────┐
│                 LoginScreen                     │
│  - Email input                                  │
│  - Password input                               │
│  - Farm URL input                               │
│  - Login button                                 │
└────────────────────┬────────────────────────────┘
                     │ (on successful login)
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Bottom Tab Navigator                        │
├─────────────┬──────────────┬──────────────┬──────────────┬──────────┤
│  Dashboard  │   Scanner    │ Environment  │Notifications │ Settings │
│   (home)    │  (qrcode)    │(thermometer) │   (bell)     │  (cog)   │
└──────┬──────┴──────┬───────┴──────┬───────┴──────┬───────┴────┬─────┘
       │             │              │              │            │
       ▼             ▼              ▼              ▼            ▼
```

## Screen Details

### 1. Dashboard Screen
**Route**: `Dashboard`  
**Icon**: `view-dashboard` (Material Community Icons)  
**Purpose**: Home screen with inventory overview

**Features**:
- Active tray count card
- Total plant count
- Harvest forecast (today, this week, next week)
- Pull-to-refresh
- Farm name chip

**API Calls**:
- `getCurrentInventory()` → `/api/inventory/summary`
- `getHarvestForecast()` → `/api/inventory/harvest-forecast`

**Navigation From Here**:
- None (tab only)

---

### 2. Scanner Screen
**Route**: `Scanner`  
**Icon**: `qrcode-scan` (Material Community Icons)  
**Purpose**: QR code scanning with action dispatch

**Features**:
- Real-time camera preview
- Visual scan window with corner guides
- Action selection dialog (Seed, Place, Harvest)
- Camera permission handling

**Navigation From Here**:
- `SeedTrayScreen` (with trayId parameter)
- `PlaceTrayScreen` (with trayId parameter)
- `HarvestTrayScreen` (with trayId parameter)

**API Calls**:
- None (delegates to workflow screens)

---

### 3. Environment Screen (NEW)
**Route**: `Environment`  
**Icon**: `thermometer` (Material Community Icons)  
**Purpose**: Real-time environmental monitoring with ML anomaly detection

**Features**:
- **Room Selector**: Chip-based room filter
- **Anomaly Alerts**: 
  - Critical (red) - severity ≥ 0.8
  - Warning (yellow) - severity ≥ 0.5
  - Info (blue) - severity < 0.5
- **Current Conditions Grid**:
  - Temperature (°C) + sensor count
  - Relative Humidity (%) + sensor count
  - VPD (kPa) + calculated
  - CO2 (ppm) + sensor count
  - PPFD (μmol/m²/s) + sensor count
- **Temperature Trend Chart**:
  - Line chart with Bezier smoothing
  - Time range selector: 1H / 6H / 24H
  - Min/max temperature labels
- **Target Setpoints**:
  - Actual vs. Target comparison
  - Temperature, Humidity, CO2, PPFD

**API Calls**:
- `getEnvironmentData(roomId, timeRange)` → `GET /env?room=X&range=1h`
- `getAnomalies()` → `GET /api/ml/anomalies`

**Backend Integration**:
- SARIMAX forecasting model (±0.5-1.5°C accuracy)
- IsolationForest anomaly detection
- Weighted median sensor aggregation
- 6-hour data retention

**Navigation From Here**:
- None (tab only)

**Dependencies**:
- `react-native-chart-kit` - LineChart component
- `react-native-svg` - Chart rendering

---

### 4. Notifications Screen (NEW)
**Route**: `Notifications`  
**Icon**: `bell` (Material Community Icons)  
**Badge**: Dynamic unread count (currently hardcoded to 2)  
**Purpose**: Alert center with user preferences

**Features**:
- **Header Actions**:
  - Unread badge counter
  - "Mark all as read" button
- **Notification List**:
  - Icon + severity color (harvest=green, anomaly=red, device=gray, inventory=orange)
  - Title + message
  - Relative timestamp ("Just now", "2h ago", "3d ago")
  - Read/unread indicator (bold title for unread)
  - Tap to mark as read
- **Notification Preferences**:
  - 🌱 Harvest reminders (trays ready to harvest)
  - 🌡️ Anomaly alerts (temperature/humidity issues)
  - 📡 Device offline (sensors/lights disconnected)
  - 📦 Low inventory (supplies running low)
  - 📊 Daily summary (end-of-day reports)
  - Toggle switches with AsyncStorage persistence

**API Calls** (mock implementation):
- `getNotifications()` → Returns 3 sample notifications
- `markNotificationRead(id)` → TODO: Backend endpoint
- `markAllNotificationsRead()` → TODO: Backend endpoint
- `updateNotificationPreferences(prefs)` → TODO: Backend endpoint

**Mock Data Structure**:
```javascript
{
  id: '1',
  type: 'harvest', // 'harvest' | 'anomaly' | 'device' | 'inventory' | 'summary'
  title: 'Trays Ready for Harvest',
  message: '3 trays of Buttercrunch Lettuce are ready',
  timestamp: Date,
  severity: 'info', // 'critical' | 'warning' | 'info'
  read: false,
}
```

**Navigation From Here**:
- None (tab only)

**Pending Backend Work**:
- `POST /api/notifications` - Create notification
- `GET /api/notifications` - Fetch user notifications
- `POST /api/notifications/:id/read` - Mark as read
- `POST /api/notifications/read-all` - Bulk mark read
- `PUT /api/users/:userId/notification-preferences` - Update preferences
- Push notification integration (Expo push tokens)

---

### 5. Settings Screen
**Route**: `Settings`  
**Icon**: `cog` (Material Community Icons)  
**Purpose**: User account and app information

**Features**:
- User info display (email)
- Farm connection details (name, URL)
- App version
- Sign out button

**API Calls**:
- None (uses AuthContext)

**Navigation From Here**:
- Logout → Back to `LoginScreen`

---

### 6. Seed Tray Screen
**Route**: `SeedTray` (Stack navigator, not in tabs)  
**Purpose**: Record tray seeding with recipe selection

**Features**:
- QR code display (scanned tray ID)
- Recipe dropdown (fetched from backend)
- Tray format selector (128-cell, 200-cell, 288-cell)
- Seed date picker
- Plant count input
- Submit button

**API Calls**:
- `getRecipes()` → `/api/recipes`
- `registerTray(trayId)` → `POST /api/inventory/trays`
- `seedTray(trayId, data)` → `POST /api/inventory/trays/{id}/seed`

**Navigation From Here**:
- Back to `Dashboard` (after successful seed)

**Dependencies**:
- `@react-native-picker/picker` - Dropdown selectors

---

### 7. Place Tray Screen
**Route**: `PlaceTray` (Stack navigator, not in tabs)  
**Purpose**: Assign tray to physical location

**Features**:
- Scanned tray QR display
- Tray info card (recipe, seed date, expected harvest)
- Location input (scan or manual entry)
- Submit button

**API Calls**:
- `getTrayInfo(trayId)` → `GET /api/inventory/trays/{id}`
- `getLocationByQR(qr)` → `GET /api/inventory/locations/by-qr/{qr}`
- `placeTray(trayId, locationId)` → `POST /api/inventory/trays/{id}/place`

**Navigation From Here**:
- Back to `Dashboard` (after successful placement)

---

### 8. Harvest Tray Screen
**Route**: `HarvestTray` (Stack navigator, not in tabs)  
**Purpose**: Record harvest data

**Features**:
- Scanned tray QR display
- Tray info card (recipe, seed date, days growing)
- Actual harvest count input
- Notes input (optional)
- Submit button

**API Calls**:
- `getTrayInfo(trayId)` → `GET /api/inventory/trays/{id}`
- `harvestTray(trayId, data)` → `POST /api/inventory/trays/{id}/harvest`

**Navigation From Here**:
- Back to `Dashboard` (after successful harvest)

---

## Navigation Flow Diagram

```
┌──────────────┐
│ LoginScreen  │
└──────┬───────┘
       │ login()
       ▼
┌─────────────────────────────────────────┐
│         Bottom Tab Navigator             │
│  ┌────────┬────────┬────────┬────────┐  │
│  │Dashboard│Scanner │Environ.│Notifs. │  │
│  └────────┴───┬────┴────────┴────────┘  │
│               │                          │
│               │ onScan(trayId)           │
│               ▼                          │
│  ┌────────────────────────┐             │
│  │  Action Dialog         │             │
│  │  - Seed Tray           │             │
│  │  - Place Tray          │             │
│  │  - Harvest Tray        │             │
│  └──┬──────┬────────┬─────┘             │
│     │      │        │                   │
└─────┼──────┼────────┼───────────────────┘
      ▼      ▼        ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│SeedTray  │ │PlaceTray │ │HarvestTray│
│Screen    │ │Screen    │ │Screen     │
└─────┬────┘ └────┬─────┘ └────┬──────┘
      │           │            │
      └───────────┴────────────┘
                  │ onSuccess()
                  ▼
            Back to Dashboard
```

## State Management

### Global State (AuthContext)
```javascript
{
  user: {
    id: string,
    email: string,
    name: string,
    farm: {
      id: string,
      name: string,
      url: string,
    },
  },
  token: string | null,
  isLoading: boolean,
}
```

### Local State (AsyncStorage)
```javascript
{
  '@auth_token': string,           // JWT token
  '@user_data': JSON,               // User object
  '@notification_preferences': JSON, // Notification toggles
}
```

### API Client State
```javascript
{
  baseURL: string,  // Farm-specific URL (e.g., 'http://192.168.2.80:8091')
  authToken: string, // Bearer token for Authorization header
}
```

## Tab Navigator Configuration

```javascript
<Tab.Navigator
  screenOptions={{
    tabBarActiveTintColor: '#60a5fa',    // Blue-400
    tabBarInactiveTintColor: '#64748b',  // Slate-500
    tabBarStyle: {
      backgroundColor: '#1e293b',         // Slate-800
      borderTopColor: '#334155',          // Slate-700
    },
    headerStyle: {
      backgroundColor: '#1e293b',
    },
    headerTintColor: '#f8fafc',          // Slate-50
  }}
>
  <Tab.Screen name="Dashboard" component={DashboardScreen} />
  <Tab.Screen name="Scanner" component={ScannerScreen} />
  <Tab.Screen 
    name="Environment" 
    component={EnvironmentScreen}
    options={{ title: 'Environment' }}
  />
  <Tab.Screen 
    name="Notifications" 
    component={NotificationsScreen}
    options={{ 
      title: 'Alerts',
      tabBarBadge: 2, // TODO: Make dynamic from notification count
    }}
  />
  <Tab.Screen name="Settings" component={SettingsScreen} />
</Tab.Navigator>
```

## Deep Linking (Future Enhancement)

### URL Scheme: `lightengine://`

**Examples**:
```
lightengine://tray/scan          → Open scanner
lightengine://tray/seed/T12345   → Open seed workflow for tray T12345
lightengine://tray/harvest/T12345 → Open harvest workflow
lightengine://environment/room1  → Open environment screen filtered to room1
lightengine://notifications      → Open notifications screen
```

**Configuration** (app.json):
```json
{
  "expo": {
    "scheme": "lightengine",
    "ios": {
      "bundleIdentifier": "com.lightengine.mobile"
    },
    "android": {
      "package": "com.lightengine.mobile"
    }
  }
}
```

## Testing Navigation

### Manual Test Flow
1. **Start**: Open app → LoginScreen
2. **Login**: Enter credentials → MainTabs appear
3. **Dashboard**: Verify inventory cards render
4. **Scanner**: Tap Scanner tab → Camera opens
5. **Scan QR**: Point at tray QR → Action dialog appears
6. **Seed Flow**: Select "Seed Tray" → SeedTrayScreen → Fill form → Submit → Back to Dashboard
7. **Environment**: Tap Environment tab → Sensor data displays
8. **Anomalies**: Verify anomaly alerts (if any)
9. **Chart**: Change time range (1H → 6H → 24H) → Chart updates
10. **Notifications**: Tap Notifications tab → See badge "2"
11. **Read Notification**: Tap a notification → Badge decrements
12. **Preferences**: Toggle notification settings → Close app → Reopen → Settings persist
13. **Settings**: Tap Settings tab → Verify user info
14. **Logout**: Tap "Sign Out" → Back to LoginScreen

### Automated Tests (Future)
```bash
# Jest + React Native Testing Library
npm test -- --coverage

# Example test
describe('Navigation Flow', () => {
  it('navigates from Scanner to SeedTray on QR scan', async () => {
    const { getByText, getByTestId } = render(<App />);
    await login();
    fireEvent.press(getByText('Scanner'));
    fireEvent(getByTestId('camera'), 'onBarCodeScanned', { 
      data: 'TRAY-12345' 
    });
    fireEvent.press(getByText('Seed Tray'));
    expect(getByText('Recipe')).toBeTruthy();
  });
});
```

## Performance Considerations

### Navigation Performance
- **Lazy Loading**: Screens only mount when navigated to (default behavior)
- **Tab Pre-caching**: Bottom tabs pre-render adjacent screens for instant switching
- **Stack Memory**: Workflow screens (Seed/Place/Harvest) unmount when navigating back

### Data Fetching Strategy
- **Dashboard**: Fetch on mount + pull-to-refresh
- **Environment**: Fetch on mount + 30-second auto-refresh
- **Notifications**: Fetch on mount + badge update every 60 seconds
- **Settings**: No API calls (uses cached AuthContext)

### Navigation Tracking (Analytics)
```javascript
// In App.js
import * as Analytics from 'expo-firebase-analytics';

const navigationRef = React.useRef();
const routeNameRef = React.useRef();

function onNavigationStateChange() {
  const previousRouteName = routeNameRef.current;
  const currentRouteName = navigationRef.current.getCurrentRoute().name;

  if (previousRouteName !== currentRouteName) {
    Analytics.logEvent('screen_view', {
      screen_name: currentRouteName,
      screen_class: currentRouteName,
    });
  }
  routeNameRef.current = currentRouteName;
}
```

---

**Last Updated**: December 2024  
**App Version**: 1.0.0  
**React Navigation**: 6.x  
**Expo SDK**: 50
