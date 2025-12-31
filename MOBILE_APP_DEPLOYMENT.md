# Mobile App Deployment Guide

## Overview

Step-by-step guide to deploy the Light Engine Mobile app for iOS and Android. The app provides QR code scanning, harvest recording, inventory management, and environmental monitoring for farm staff.

---

## Prerequisites

**Required:**
- Node.js 18+ installed
- Expo CLI: `npm install -g expo-cli eas-cli`
- Apple Developer account (iOS) - $99/year
- Google Play Console account (Android) - $25 one-time

**Optional:**
- TestFlight for iOS beta testing
- Google Play Internal Testing for Android beta testing

**Time Estimates:**
- iOS setup: 2-3 hours + 1-2 days App Store review
- Android setup: 1-2 hours + 2-24 hours Play Store review
- TestFlight beta: 1-2 hours (no review required)

---

## App Information

**Name:** Light Engine Mobile  
**Version:** 1.0.0  
**Bundle ID (iOS):** com.greenreach.lightengine  
**Package (Android):** com.greenreach.lightengine  
**Minimum iOS:** 13.0+  
**Minimum Android:** 6.0+ (API 23)  

**Features:**
- QR code tray scanning
- Seed/place/harvest workflows
- Environmental monitoring (temperature, humidity)
- Push notifications for alerts
- Offline-first data storage
- Dark theme Material Design 3

---

## Step 1: Configure Expo Account

### Create Account

```bash
# Login or create account
eas login
```

If you don't have an account, visit https://expo.dev and sign up.

### Initialize EAS Build

```bash
cd mobile-app
eas build:configure
```

This creates `eas.json` with build profiles.

### Verify Configuration

```bash
# Check your Expo username
eas whoami

# Should show: your-expo-username
```

---

## Step 2: iOS Deployment

### 2.1 Apple Developer Account Setup

1. Visit https://developer.apple.com
2. Enroll in Apple Developer Program ($99/year)
3. Wait for approval (1-2 business days)

### 2.2 Create App Store Connect Listing

1. Visit https://appstoreconnect.apple.com
2. Click "My Apps" > "+" > "New App"
3. Fill in details:
   - **Platform:** iOS
   - **Name:** Light Engine Mobile
   - **Primary Language:** English
   - **Bundle ID:** com.greenreach.lightengine (must match app.json)
   - **SKU:** light-engine-mobile-001
   - **User Access:** Full Access

### 2.3 Configure App Information

**App Store Listing:**

- **Name:** Light Engine Mobile
- **Subtitle:** Farm Management & QR Scanning
- **Description:**

```
Light Engine Mobile is the companion app for Light Engine farm management systems. 
Scan QR codes on trays, record harvests, monitor environmental conditions, and 
manage inventory directly from your phone or tablet.

Features:
- QR code scanning for tray tracking
- Seed, place, and harvest workflows
- Real-time environmental monitoring
- Push notifications for alerts
- Offline mode for unreliable connections
- Dark theme optimized for greenhouse environments

Requires connection to a Light Engine backend system.
```

- **Keywords:** farm,agriculture,qr,scanner,harvest,greenhouse,hydroponics
- **Category:** Productivity
- **Age Rating:** 4+

**Screenshots Required:**
- 6.5" display (1284x2778) - 3 screenshots minimum
- 5.5" display (1242x2208) - 3 screenshots minimum

### 2.4 Build for iOS

```bash
cd mobile-app

# First build (creates signing credentials)
eas build --platform ios --profile production

# This will:
# 1. Ask to create Apple credentials (select "yes")
# 2. Generate signing certificate
# 3. Create provisioning profile
# 4. Build IPA file
# 5. Upload to Expo servers
```

**Build time:** 10-15 minutes

**Monitor progress:**
```bash
# Check build status
eas build:list

# View build logs
eas build:view
```

### 2.5 Download IPA

```bash
# Download completed build
eas build:download --platform ios --latest

# IPA file saved to current directory
```

### 2.6 Submit to App Store

**Option A: Using EAS Submit (Recommended)**

```bash
# Submit directly to App Store Connect
eas submit --platform ios

# Follow prompts:
# - Select IPA file
# - Enter Apple ID credentials
# - App will upload automatically
```

**Option B: Manual Upload**

1. Open Xcode
2. Window > Organizer
3. Distribute App > Upload to App Store Connect
4. Select IPA file
5. Wait for upload to complete

### 2.7 Complete App Store Connect Listing

1. Return to App Store Connect
2. Select your app > "1.0 Prepare for Submission"
3. Upload screenshots (use iOS simulator or real device)
4. Add app icon (1024x1024 PNG)
5. Fill in required fields:
   - **Version:** 1.0.0
   - **Copyright:** 2025 Greenreach
   - **Contact Information:** support@greenreach.io
   - **Privacy Policy URL:** https://greenreach.io/privacy
   - **Support URL:** https://greenreach.io/support
6. Select build uploaded from EAS
7. Click "Submit for Review"

**Review time:** 1-2 days typically

---

## Step 3: iOS TestFlight Beta (Optional)

TestFlight allows beta testing before public App Store release.

### 3.1 Build for TestFlight

```bash
# Use preview profile for internal distribution
eas build --platform ios --profile preview
```

### 3.2 Upload to TestFlight

```bash
eas submit --platform ios
```

The build will appear in App Store Connect > TestFlight automatically.

### 3.3 Add Beta Testers

1. App Store Connect > TestFlight > Internal Testing
2. Click "+" to add testers
3. Enter email addresses
4. Enable "Automatic Distribution"
5. Testers receive email with TestFlight invite link

### 3.4 Install TestFlight

Testers must:
1. Install TestFlight app from App Store
2. Open email invite
3. Tap "View in TestFlight"
4. Tap "Install"

**No App Store review required for TestFlight builds**

---

## Step 4: Android Deployment

### 4.1 Google Play Console Setup

1. Visit https://play.google.com/console
2. Create account (requires $25 one-time fee)
3. Click "Create App"
4. Fill in details:
   - **Name:** Light Engine Mobile
   - **Default language:** English (US)
   - **App or game:** App
   - **Free or paid:** Free
5. Complete declarations:
   - Privacy policy URL: https://greenreach.io/privacy
   - Target audience: Business/Enterprise
   - Content rating: Everyone

### 4.2 Configure Store Listing

**Main Store Listing:**

- **App name:** Light Engine Mobile
- **Short description:**

```
Farm management app with QR scanning, harvest tracking, and environmental monitoring.
```

- **Full description:**

```
Light Engine Mobile is the companion app for Light Engine farm management systems.

Features:
- QR code scanning for tray tracking
- Seed, place, and harvest workflows  
- Real-time environmental monitoring (temperature, humidity)
- Push notifications for critical alerts
- Offline mode with local data storage
- Material Design 3 dark theme

Perfect for greenhouse operators, hydroponic farms, and vertical farming operations.

Requires connection to Light Engine backend system (Symcod device or cloud instance).
```

**Graphics:**

- **App icon:** 512x512 PNG (32-bit with alpha)
- **Feature graphic:** 1024x500 PNG
- **Phone screenshots:** 16:9 aspect ratio (1080x1920) - 2 minimum
- **Tablet screenshots:** 16:9 aspect ratio (1920x1080) - 2 minimum

### 4.3 Build for Android

```bash
cd mobile-app

# Build APK for internal testing
eas build --platform android --profile preview

# Or build AAB for Play Store (recommended)
eas build --platform android --profile production
```

**Output formats:**
- APK: Direct installation on devices
- AAB (Android App Bundle): Play Store optimized, smaller downloads

**Build time:** 8-12 minutes

### 4.4 Download Build

```bash
# Download APK or AAB
eas build:download --platform android --latest
```

### 4.5 Upload to Play Console

**Internal Testing (Fast, No Review):**

1. Play Console > Testing > Internal Testing
2. Create new release
3. Upload AAB or APK file
4. Add release notes:
```
Initial release with QR scanning, harvest tracking, and environmental monitoring.
```
5. Review and roll out
6. Add testers by email
7. Share link with testers

**Production Release:**

1. Play Console > Production
2. Create new release
3. Upload AAB file
4. Add release notes
5. Submit for review

**Review time:** 2-24 hours typically

---

## Step 5: Configure Backend Connection

The mobile app needs to connect to your Light Engine backend.

### 5.1 Set API Endpoint

Users enter their farm's API URL on login screen:

**Examples:**
- Local Symcod: `http://192.168.1.100:8091`
- Cloud instance: `https://farm-001.greenreach.io`

### 5.2 SSL/HTTPS for Production

For cloud deployments, use HTTPS:

```bash
# Enable SSL in backend
export USE_SSL=true
export SSL_CERT_PATH=/path/to/cert.pem
export SSL_KEY_PATH=/path/to/key.pem
```

### 5.3 Test Connection

```bash
# Verify API endpoint is accessible
curl https://farm-001.greenreach.io/health

# Should return: {"status": "ok"}
```

---

## Step 6: Push Notifications Setup

### 6.1 Create Expo Push Notification Credentials

```bash
# Generate push notification credentials
eas credentials
```

Select:
- Platform: iOS or Android
- Action: Generate Push Notification credentials

### 6.2 Configure Backend

Update backend environment variables:

```bash
# Add to .env or environment
export EXPO_PUSH_TOKEN_ENABLED=true
```

### 6.3 Test Push Notifications

```javascript
// Send test notification from backend
const { Expo } = require('expo-server-sdk');
const expo = new Expo();

const messages = [{
  to: 'ExponentPushToken[user-device-token]',
  sound: 'default',
  title: 'Environmental Alert',
  body: 'Temperature exceeded 80°F in Zone A1',
  data: { zone_id: 'A1', alert_type: 'temperature' }
}];

await expo.sendPushNotificationsAsync(messages);
```

---

## Step 7: Post-Deployment Testing

### 7.1 Install on Test Device

**iOS:**
- TestFlight: Open invite link on device
- Production: Search "Light Engine Mobile" in App Store

**Android:**
- Internal testing: Open link from Play Console
- Production: Search in Google Play Store

### 7.2 Test Core Features

```bash
# Checklist:
- [ ] App launches successfully
- [ ] Login screen accepts credentials
- [ ] Camera permission requested
- [ ] QR code scanner opens camera
- [ ] Scan tray QR code successfully
- [ ] Seed workflow completes
- [ ] Place workflow completes  
- [ ] Harvest workflow completes
- [ ] Environmental data displays
- [ ] Push notification received
- [ ] Offline mode works (disable WiFi)
- [ ] Settings save correctly
- [ ] Logout returns to login screen
```

### 7.3 Monitor Crashes

**iOS:**
- Xcode > Organizer > Crashes
- App Store Connect > Analytics > Crashes

**Android:**
- Play Console > Quality > Android vitals > Crashes

### 7.4 Check Analytics

**iOS:**
- App Store Connect > Analytics > Metrics
- View downloads, sessions, crashes

**Android:**
- Play Console > Statistics > Overview
- View installs, active devices

---

## Troubleshooting

### iOS Build Fails

**Error: "No bundle identifier found"**

Fix: Verify `app.json` has correct bundle ID:
```json
{
  "expo": {
    "ios": {
      "bundleIdentifier": "com.greenreach.lightengine"
    }
  }
}
```

**Error: "Provisioning profile expired"**

Fix:
```bash
# Clear credentials and regenerate
eas credentials --platform ios --clear
eas build --platform ios --profile production
```

### Android Build Fails

**Error: "Package name already exists"**

Fix: Change package name in `app.json`:
```json
{
  "expo": {
    "android": {
      "package": "com.greenreach.lightengine.v2"
    }
  }
}
```

### Camera Not Working

**iOS:** Check Info.plist has camera permission:
```json
{
  "ios": {
    "infoPlist": {
      "NSCameraUsageDescription": "Camera access required for QR scanning"
    }
  }
}
```

**Android:** Verify permissions in app.json:
```json
{
  "android": {
    "permissions": ["CAMERA"]
  }
}
```

### Cannot Connect to Backend

**Check backend is accessible:**
```bash
# From device's network
curl http://192.168.1.100:8091/health
```

**Verify firewall allows connections:**
```bash
# Open port 8091
sudo ufw allow 8091/tcp
```

### App Crashes on Launch

**Check logs:**

iOS:
```bash
# Xcode > Devices and Simulators > View Device Logs
```

Android:
```bash
# View logcat
adb logcat | grep "ReactNative"
```

---

## Maintenance & Updates

### Release New Version

1. Update version in `app.json` and `package.json`:
```json
{
  "version": "1.1.0"
}
```

2. Build new version:
```bash
eas build --platform all --profile production
```

3. Submit updates:
```bash
eas submit --platform all
```

### OTA Updates (No Store Submission)

For JavaScript-only changes:

```bash
# Publish OTA update
eas update --branch production --message "Bug fixes"
```

Users receive update automatically without reinstalling.

**Note:** Native code changes (new permissions, native modules) require full app store submission.

---

## App Store Guidelines

### iOS App Store Review Guidelines

**Common rejection reasons:**
- Missing privacy policy
- Unclear app description
- Broken functionality in review
- Missing required screenshots
- Copyright violations

**Approval tips:**
- Provide test account credentials in "App Review Information"
- Add detailed testing notes
- Ensure all features work in production mode
- Include video demo if app requires hardware

### Google Play Review Guidelines

**Common rejection reasons:**
- Incomplete store listing
- Missing privacy policy
- Dangerous permissions without justification
- Content rating mismatch

**Approval tips:**
- Complete all required fields
- Justify camera permission (QR scanning)
- Test on multiple Android versions
- Provide clear app description

---

## Cost Summary

**iOS:**
- Apple Developer Program: $99/year
- No per-app fees
- TestFlight: Free

**Android:**
- Google Play Console: $25 one-time
- No annual fees
- Internal testing: Free

**Expo EAS:**
- Free tier: 30 builds/month
- Production tier: $29/month for unlimited builds
- OTA updates: Included

**Total first year:** $124 (iOS) + $25 (Android) + $0-348 (Expo) = $149-497

---

## Production Checklist

**Before Submitting:**

- [ ] Version number updated in app.json and package.json
- [ ] Bundle ID and package name match store listings
- [ ] Privacy policy URL added
- [ ] Support URL added
- [ ] App icon created (1024x1024)
- [ ] Screenshots captured (iOS: 6.5" and 5.5", Android: phone + tablet)
- [ ] Feature graphic created (Android: 1024x500)
- [ ] Test account credentials provided
- [ ] Camera permission description clear
- [ ] Backend API endpoint configured
- [ ] SSL certificate installed (for HTTPS)
- [ ] Push notifications tested
- [ ] Offline mode tested
- [ ] All workflows tested (seed, place, harvest)
- [ ] Error tracking configured (Sentry, Bugsnag)
- [ ] Analytics configured (Firebase, Amplitude)

**After Approval:**

- [ ] Monitor crash reports
- [ ] Check user reviews
- [ ] Respond to support requests
- [ ] Plan next version features
- [ ] Schedule regular updates (quarterly recommended)

---

## Support Resources

**Expo Documentation:**
- https://docs.expo.dev
- https://docs.expo.dev/build/introduction/
- https://docs.expo.dev/submit/introduction/

**Apple Developer:**
- https://developer.apple.com/support/
- https://developer.apple.com/app-store/review/guidelines/

**Google Play:**
- https://support.google.com/googleplay/android-developer
- https://developer.android.com/distribute/best-practices/launch

**Light Engine:**
- Backend API: See server-foxtrot.js routes
- Mobile app source: mobile-app/
- Issue tracker: https://github.com/greenreach/light-engine/issues

---

## Related Documentation

- [mobile-app/README.md](mobile-app/README.md) - Mobile app development guide
- [mobile-app/QUICKSTART.md](mobile-app/QUICKSTART.md) - 5-minute setup
- [STAFF_TRAINING_MOBILE.md](STAFF_TRAINING_MOBILE.md) - Staff training for mobile app
- [PRODUCTION_MONITORING_SETUP.md](PRODUCTION_MONITORING_SETUP.md) - Backend monitoring

---

**Deployment Time:** 4-6 hours setup + 1-3 days review  
**Difficulty:** Intermediate  
**Prerequisites:** Apple/Google developer accounts  
**Production Ready:** YES