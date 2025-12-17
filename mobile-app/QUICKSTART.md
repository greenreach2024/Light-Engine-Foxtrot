# Light Engine Mobile App - Quick Start

## 5-Minute Setup

### 1. Install Dependencies
```bash
cd Light-Engine-Delta/mobile-app
npm install
```

### 2. Start Backend
In separate terminal:
```bash
cd Light-Engine-Delta
PORT=8000 npm start
```

Verify: `curl http://localhost:8000/api/recipes`

### 3. Start Mobile App
```bash
cd mobile-app
npm start
```

### 4. Open on Phone
- Install **Expo Go** from App Store or Google Play
- Scan QR code shown in terminal
- App opens in Expo Go

### 5. Login
- Email: `test@farm.local`
- Password: `demo123`
- Farm URL: 
  - **Same WiFi**: `http://YOUR_COMPUTER_IP:8000`
  - **Find IP**: `ifconfig | grep inet` (Mac/Linux)

### 6. Test QR Scanning
Create test QR codes:
```bash
# Generate tray QR codes (use online generator)
TRAY-001
TRAY-002
TRAY-003

# Generate location QR codes
LOC-A1
LOC-A2
LOC-B1
```

Print or display on screen, then:
1. Tap **Scanner** tab
2. Point camera at QR code
3. Choose **Seed** action
4. Select a recipe (e.g., "Buttercrunch Lettuce")
5. Confirm

## Common Issues

**"Cannot connect to farm"**
→ Use computer's local IP, not `localhost`
→ Example: `http://192.168.1.123:8000`

**"Camera permission denied"**
→ Settings → Expo Go → Allow Camera

**"Recipe list is empty"**
→ Ensure backend has sample recipes loaded:
```bash
curl http://localhost:8000/api/recipes
```

## Next Steps

1. Create tray formats: See `QR_INVENTORY_QUICKSTART.md`
2. Register farm hierarchy: Farms → Rooms → Zones → Groups
3. Print QR labels for physical trays
4. Test full workflow: Seed → Place → Harvest

## Production Build

```bash
# iOS
expo build:ios

# Android  
expo build:android
```

Requires Expo account (free tier available).
