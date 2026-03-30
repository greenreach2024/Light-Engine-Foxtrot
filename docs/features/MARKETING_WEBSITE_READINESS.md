# Light Engine Marketing Website & Download Portal Readiness

**Assessment Date**: December 25, 2025  
**Reviewer**: GitHub Copilot  
**Status**: ⚠️ INFRASTRUCTURE READY, WEBSITE NEEDED

---

## Executive Summary

**Current State**: Light Engine Foxtrot has **complete backend infrastructure** for software distribution but **NO customer-facing marketing website**. Users have no way to discover, learn about, or download the software.

### What We Have ✅
- ✅ **Install Server**: `install.greenreach.io` with binary hosting (3 endpoints)
- ✅ **Desktop Apps**: Windows .exe and macOS .dmg installers ready to build
- ✅ **Mobile App**: React Native "Activity Hub" for iOS/Android (Expo)
- ✅ **Edge Device Installer**: One-line bash script (`curl | bash`)
- ✅ **Update Server**: Auto-update infrastructure for all platforms
- ✅ **GreenReach Central**: Farm registration/provisioning portal
- ✅ **Documentation**: 15+ comprehensive deployment guides (3,000+ lines)

### What We're Missing ❌
- ❌ **Marketing Website**: No homepage or product information
- ❌ **Downloads Page**: No user-facing download portal
- ❌ **Getting Started Guide**: No non-technical user onboarding
- ❌ **Use Case Pages**: No separate pages for two user types
- ❌ **Pricing/Plans**: No visible pricing information
- ❌ **Support Portal**: No centralized help/docs landing page

### Critical Gap
**Users cannot discover or download Light Engine software** because there's no website at:
- `www.greenreach.io` (unregistered)
- `www.lightengine.io` (unregistered)
- `install.greenreach.io/downloads/` (returns JSON, not HTML)

---

## 1. Current Distribution Infrastructure

### 1.1 Install Server (Backend Only)

**Location**: `/install-server/`  
**Purpose**: Serves binaries and installation scripts  
**Status**: ✅ Functional but not user-facing

**Endpoints**:
```bash
# Installation script (for technical users)
curl -sSL https://install.greenreach.io | bash

# Binary downloads (API-style, no UI)
GET /lightengine-linux-x64
GET /lightengine-linux-arm64
GET /lightengine-{platform}.sha256

# Metadata endpoints
GET /binaries  # Returns JSON
GET /stats     # Returns JSON
GET /health    # Returns JSON
```

**Problem**: These are API endpoints, not user-facing pages. Non-technical users can't use them.

### 1.2 Desktop Applications

**Location**: `/desktop-app/`  
**Platform**: Electron-based (Windows/macOS)  
**Status**: ✅ Ready to build, but no distribution channel

**Build Commands**:
```bash
npm run build:win    # Creates Light-Engine-Setup-x.x.x.exe
npm run build:mac    # Creates Light-Engine-x.x.x.dmg
npm run build:all    # Both platforms
```

**Documentation References Download URLs**:
- `https://install.greenreach.io/downloads/Light-Engine-Setup-x.x.x.exe`
- `https://install.greenreach.io/downloads/Light-Engine-x.x.x.dmg`

**Problem**: These URLs are documented but **the files don't exist** on the server yet.

### 1.3 Mobile App (Activity Hub)

**Location**: `/mobile-app/`  
**Platform**: React Native + Expo (iOS/Android)  
**Status**: ✅ Built and tested, no distribution

**Features**:
- QR code tray scanning
- Harvest recording
- Environmental monitoring
- Push notifications
- Offline-first architecture

**Documentation**: `ACTIVITY_HUB_READINESS.md` (641 lines)

**Distribution Options**:
- **iOS**: Apple App Store (requires Apple Developer account)
- **Android**: Google Play Store (requires Google Play account)
- **Enterprise**: Expo OTA updates or APK direct download

**Problem**: No App Store listings, no direct download page for APK/IPA files.

### 1.4 Edge Device Installer

**Location**: `/scripts/install.sh`  
**Platform**: Linux (Ubuntu/Raspberry Pi)  
**Status**: ✅ Functional for technical users

**One-Line Install**:
```bash
curl -fsSL https://install.greenreach.io/install.sh | bash
```

**What It Does**:
1. Detects platform (linux-x64, linux-arm64, macos, windows)
2. Downloads appropriate binary from install server
3. Verifies SHA-256 checksum
4. Installs to `/opt/lightengine/`
5. Creates systemd service
6. Prompts for activation code

**Problem**: Requires terminal access and technical knowledge. No GUI option.

---

## 2. Two User Types Analysis

### User Type 1: Complete Farm Control (Edge Device)

**Profile**:
- Commercial vertical farm operators
- Want full automation (lights, climate, sensors)
- Need edge device with hardware control
- Technical or hire installer

**Software Needs**:
- Edge device installer (Linux binary)
- Setup wizard (touchscreen-optimized)
- Hardware drivers (DMX, Modbus, GPIO)
- ML models for automation

**Current Support**:
- ✅ One-line installer exists
- ✅ Setup wizard exists (`setup-wizard.html`, 850 lines)
- ✅ Hardware drivers included
- ✅ ML models integrated
- ✅ Documentation: `EDGE_DEPLOYMENT_GUIDE.md` (764 lines)

**Missing**:
- ❌ Landing page explaining edge deployment
- ❌ Hardware requirements page
- ❌ Video tutorials for installation
- ❌ Pre-configured device purchasing option

### User Type 2: Web-Based Inventory/POS/Sales

**Profile**:
- Small farms or farm stores
- Want inventory + POS + online sales
- No automation hardware
- Non-technical users

**Software Needs**:
- Desktop app (Windows/macOS)
- Mobile app (iOS/Android)
- Cloud-hosted option
- Payment processing (Square integration)
- GreenReach wholesale marketplace access

**Current Support**:
- ✅ Desktop app ready to build
- ✅ Mobile app functional
- ✅ Cloud deployment guide (`CLOUD_DEPLOYMENT_GUIDE.md`, 886 lines)
- ✅ Square OAuth integration
- ✅ Wholesale marketplace (`wholesale.html`)

**Missing**:
- ❌ Desktop app download page
- ❌ Mobile app store listings
- ❌ "Start Free Trial" cloud signup
- ❌ Pricing page for plans
- ❌ Comparison chart (Edge vs Cloud vs Desktop)

---

## 3. Recommended Marketing Website Structure

### 3.1 Homepage (www.lightengine.io)

**Purpose**: First impression, explain value proposition

**Sections**:
1. **Hero Section**
   - Headline: "Automate Your Vertical Farm"
   - Subheading: "Complete control system for indoor agriculture"
   - CTA Buttons: "Try Free" | "Download Desktop App" | "Watch Demo"
   - Hero Image: iPad showing Activity Hub dashboard

2. **Two User Paths**
   ```
   ┌─────────────────────────┐  ┌──────────────────────────┐
   │   🖥️ Edge Device         │  │   ☁️ Cloud + Desktop      │
   │   Complete Automation    │  │   Inventory & Sales       │
   │   "Learn More"           │  │   "Start Free Trial"      │
   └─────────────────────────┘  └──────────────────────────┘
   ```

3. **Features Overview**
   - Inventory Management
   - POS & Online Sales
   - Wholesale Marketplace
   - Environmental Monitoring
   - ML-Powered Automation
   - Tray Tracking with QR Codes

4. **Social Proof**
   - Testimonials (placeholder for now)
   - "Used by X farms worldwide"
   - Customer logos

5. **Pricing Teaser**
   - "Plans starting at $49/month"
   - Link to pricing page

6. **Footer**
   - Links: Downloads, Docs, Support, Community, Login
   - Contact: support@lightengine.io
   - Social: Twitter, YouTube, GitHub

### 3.2 Downloads Page (/downloads)

**URL**: `https://www.lightengine.io/downloads` or `https://install.greenreach.io/downloads/`

**Layout**:
```
┌─────────────────────────────────────────────────────┐
│  Light Engine Downloads                             │
│  Choose your platform to get started                │
└─────────────────────────────────────────────────────┘

┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  💻 Desktop       │  │  📱 Mobile        │  │  🖥️ Edge Device   │
│  Windows/macOS   │  │  iOS/Android     │  │  Linux           │
├──────────────────┤  ├──────────────────┤  ├──────────────────┤
│ [Download Win]   │  │ [App Store]      │  │ [Get Installer]  │
│ [Download Mac]   │  │ [Google Play]    │  │                  │
│ Version: 1.0.0   │  │ Version: 1.0.0   │  │ curl -sSL ...    │
│ 150 MB           │  │ 45 MB            │  │                  │
└──────────────────┘  └──────────────────┘  └──────────────────┘

System Requirements:
• Windows 10+ (64-bit) | macOS 12+ (Intel & Apple Silicon)
• 4 GB RAM, 500 MB disk space
• Internet connection for cloud sync

Installation Guides:
→ Desktop App Setup Guide
→ Mobile App Quick Start
→ Edge Device Installation
```

**Features**:
- Auto-detect user OS and highlight correct download
- Show file size and version number
- Link to changelog and release notes
- SHA-256 checksums visible
- "Need help?" → Support portal link

### 3.3 Edge Device Page (/edge)

**Purpose**: Explain full automation deployment for commercial farms

**Sections**:
1. **Hero**: "Complete Farm Automation"
   - "Control lights, climate, sensors, and more"
   - Photo: Grow room with touchscreen controller

2. **What You Get**:
   - Environmental control (temp, humidity, CO₂)
   - Automated lighting schedules
   - ML-powered anomaly detection
   - Sensor integration (Atlas, Modbus, DMX)
   - Touchscreen interface for floor workers

3. **Hardware Requirements**:
   - Raspberry Pi 4 (8GB) or Intel NUC
   - Supported sensors and controllers
   - Network connectivity
   - Optional: 7" touchscreen

4. **Installation Options**:
   - **DIY**: Download installer, follow guide (1-2 hours)
   - **Professional**: Hire certified installer ($500-1000)
   - **Pre-Configured**: Buy device with software pre-installed ($800)

5. **Pricing**:
   - Software: Free for single farm
   - Pro: $199/month (multi-room, cloud sync, support)
   - Enterprise: Custom (multi-site, API access)

6. **CTA**: "Download Installer" → `/downloads`

### 3.4 Cloud + Desktop Page (/cloud)

**Purpose**: Explain web-based inventory/POS/sales solution

**Sections**:
1. **Hero**: "Farm Management Without Hardware"
   - "Track inventory, run POS, sell online"
   - Screenshot: Farm Admin dashboard

2. **What You Get**:
   - Desktop app (Windows/macOS)
   - Mobile app (iOS/Android)
   - Cloud-hosted dashboard
   - POS system (Square integration)
   - Online store builder
   - GreenReach wholesale marketplace

3. **No Hardware Required**:
   - Works on existing computers/tablets
   - No sensors or controllers needed
   - Perfect for farm stores and small operations

4. **Pricing**:
   - **Free Trial**: 14 days, no credit card
   - **Starter**: $49/month (1 user, 100 products)
   - **Pro**: $149/month (5 users, unlimited products, POS)
   - **Enterprise**: Custom (multi-location, API)

5. **CTA**: "Start Free Trial" → Cloud registration form

### 3.5 Pricing Page (/pricing)

**Layout**:
```
┌────────────────────────────────────────────────────────────┐
│  Choose Your Plan                                          │
└────────────────────────────────────────────────────────────┘

┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  Free       │  │  Starter    │  │  Pro        │  │  Enterprise │
│  $0/month   │  │  $49/month  │  │  $199/month │  │  Custom     │
├─────────────┤  ├─────────────┤  ├─────────────┤  ├─────────────┤
│ • Desktop   │  │ All Free +  │  │ All Starter │  │ All Pro +   │
│ • Mobile    │  │ • Cloud     │  │ • Edge      │  │ • Multi-site│
│ • 1 user    │  │ • 1 user    │  │ • 5 users   │  │ • Custom    │
│ • 10 trays  │  │ • POS       │  │ • Hardware  │  │ • Dedicated │
│             │  │ • Store     │  │ • ML models │  │ • SLA       │
│             │  │ • 100 items │  │ • Unlimited │  │             │
│             │  │             │  │ • Support   │  │             │
├─────────────┤  ├─────────────┤  ├─────────────┤  ├─────────────┤
│ [Download]  │  │ [Try Free]  │  │ [Try Free]  │  │ [Contact]   │
└─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘
```

**Comparison Table**:
| Feature | Free | Starter | Pro | Enterprise |
|---------|------|---------|-----|------------|
| Inventory | ✓ | ✓ | ✓ | ✓ |
| Harvest Tracking | ✓ | ✓ | ✓ | ✓ |
| Tray QR Codes | ✓ | ✓ | ✓ | ✓ |
| Point of Sale | - | ✓ | ✓ | ✓ |
| Online Store | - | ✓ | ✓ | ✓ |
| Wholesale Marketplace | - | ✓ | ✓ | ✓ |
| Hardware Control | - | - | ✓ | ✓ |
| ML Automation | - | - | ✓ | ✓ |
| Users | 1 | 1 | 5 | Unlimited |
| Support | Community | Email | Phone | Dedicated |

### 3.6 Documentation Portal (/docs)

**Purpose**: Centralized hub for all documentation

**Structure**:
```
/docs/
├── /getting-started/
│   ├── desktop-app-quickstart.md
│   ├── mobile-app-quickstart.md
│   ├── edge-device-quickstart.md
│   └── cloud-quickstart.md
├── /guides/
│   ├── inventory-management.md
│   ├── harvest-tracking.md
│   ├── pos-setup.md
│   ├── online-store-setup.md
│   ├── wholesale-selling.md
│   └── automation-rules.md
├── /deployment/
│   ├── edge-deployment-guide.md (764 lines - EXISTS)
│   ├── cloud-deployment-guide.md (886 lines - EXISTS)
│   ├── desktop-app-guide.md (655 lines - EXISTS)
│   └── security-hardening.md (920 lines - EXISTS)
├── /api/
│   ├── authentication.md
│   ├── inventory-api.md
│   ├── wholesale-api.md
│   └── webhooks.md
└── /troubleshooting/
    ├── common-issues.md
    ├── connectivity.md
    └── contact-support.md
```

**Features**:
- Searchable documentation
- Code examples with syntax highlighting
- Video tutorials embedded
- Version selector (show docs for v1.0, v1.1, etc.)
- Breadcrumb navigation
- "Was this helpful?" feedback buttons

---

## 4. User Journey Mapping

### Journey 1: Farm Owner Discovering Light Engine

**Discovery**:
1. Google search: "vertical farm automation software"
2. Lands on: `www.lightengine.io`
3. Reads: Homepage hero explaining two options
4. Clicks: "Edge Device - Complete Automation"

**Evaluation**:
5. Reads: `/edge` page with features and pricing
6. Watches: Embedded demo video (3 minutes)
7. Checks: Hardware requirements list
8. Decision: "I'll try the DIY installation"

**Download**:
9. Clicks: "Download Installer" → Redirects to `/downloads`
10. Sees: Linux one-line installer command
11. Copies: `curl -sSL https://install.greenreach.io | bash`
12. Opens: Terminal on Raspberry Pi

**Installation**:
13. Pastes: Installation command
14. Follows: On-screen prompts for activation code
15. Visits: `https://central.greenreach.io/register` to get code
16. Completes: First-run setup wizard on touchscreen

**Outcome**: Successfully installed in 30 minutes with documentation.

### Journey 2: Farm Store Manager Needs POS

**Discovery**:
1. Google search: "farm POS system inventory"
2. Lands on: `www.lightengine.io`
3. Reads: Homepage explaining cloud + desktop option
4. Clicks: "Cloud + Desktop - Inventory & Sales"

**Evaluation**:
5. Reads: `/cloud` page features
6. Sees: "Free Trial" option
7. Clicks: "Start Free Trial"

**Signup**:
8. Lands on: Cloud registration form
9. Enters: Email, farm name, password
10. Selects: "Starter" plan (14-day free trial)
11. Confirms: Email verification link
12. Redirects: To farm dashboard at `myfarm.greenreach.io`

**Setup**:
13. Follows: Setup wizard (5 steps)
14. Downloads: Desktop app from dashboard "Apps" section
15. Installs: Windows .exe file (3 minutes)
16. Connects: Desktop app to cloud account
17. Downloads: Mobile app from App Store
18. Scans: QR code to link mobile app

**Outcome**: Up and running in 15 minutes, no technical knowledge needed.

---

## 5. Technical Implementation Plan

### Phase 1: Create Marketing Website (Week 1-2)

**Subdomain Options**:
- **Option A**: `www.lightengine.io` (requires domain purchase)
- **Option B**: `www.greenreach.io` (requires domain purchase)
- **Option C**: `marketing.greenreach.io` (use existing infrastructure)

**Tech Stack**:
- **Static Site**: Next.js or plain HTML/CSS/JS
- **Hosting**: AWS S3 + CloudFront or Netlify
- **Domain**: Route 53 (if purchasing domain)
- **SSL**: AWS Certificate Manager or Let's Encrypt

**Pages to Build**:
1. Homepage (`/`) - 1 day
2. Downloads (`/downloads`) - 1 day
3. Edge Device (`/edge`) - 1 day
4. Cloud + Desktop (`/cloud`) - 1 day
5. Pricing (`/pricing`) - 1 day
6. Documentation Portal (`/docs`) - 2 days
7. Support/Contact (`/support`) - 0.5 days

**Total Effort**: 7.5 days for initial site

### Phase 2: Populate Install Server (Week 2)

**Tasks**:
1. Build desktop apps:
   ```bash
   cd desktop-app
   npm run build:all
   ```

2. Copy binaries to install server:
   ```bash
   cp dist/Light-Engine-Setup-1.0.0.exe install-server/downloads/
   cp dist/Light-Engine-1.0.0.dmg install-server/downloads/
   ```

3. Generate SHA-256 checksums:
   ```bash
   cd install-server/downloads
   sha256sum Light-Engine-Setup-1.0.0.exe > Light-Engine-Setup-1.0.0.exe.sha256
   sha256sum Light-Engine-1.0.0.dmg > Light-Engine-1.0.0.dmg.sha256
   ```

4. Add HTML downloads page:
   ```html
   <!-- install-server/downloads/index.html -->
   <html>
   <head><title>Light Engine Downloads</title></head>
   <body>
     <h1>Download Light Engine</h1>
     <ul>
       <li><a href="/Light-Engine-Setup-1.0.0.exe">Windows Installer</a></li>
       <li><a href="/Light-Engine-1.0.0.dmg">macOS Installer</a></li>
     </ul>
   </body>
   </html>
   ```

5. Update server.js to serve HTML:
   ```javascript
   app.get('/downloads/', (req, res) => {
     res.sendFile(__dirname + '/downloads/index.html');
   });
   ```

**Total Effort**: 1 day

### Phase 3: Deploy Mobile App (Week 3)

**iOS Deployment**:
1. Enroll in Apple Developer Program ($99/year)
2. Create App Store Connect listing
3. Build for production:
   ```bash
   cd mobile-app
   eas build --platform ios
   ```
4. Submit for App Store review
5. Wait 1-2 days for approval

**Android Deployment**:
1. Create Google Play Console account ($25 one-time)
2. Create app listing
3. Build APK:
   ```bash
   eas build --platform android
   ```
4. Upload to Google Play
5. Submit for review (usually same day)

**Alternative (Faster)**:
- Use Expo OTA updates for now
- Add direct APK download link on website
- Defer app store listings to Phase 4

**Total Effort**: 2-3 days (plus 1-2 days review time)

### Phase 4: Cloud Registration Flow (Week 3-4)

**GreenReach Central Enhancement**:
Currently exists at `greenreach-central-app/public/register.html` but needs:

1. **Public Registration Page**:
   - Remove admin-only restrictions
   - Add Stripe payment form
   - Add email verification
   - Add plan selection (Starter/Pro)

2. **Free Trial Logic**:
   ```javascript
   // Add to provisioning.js
   router.post('/api/public-register', async (req, res) => {
     const { email, farmName, plan } = req.body;
     
     // Create farm with 14-day trial
     const farm = await createFarm({
       name: farmName,
       tier: plan, // 'starter' or 'pro'
       trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
     });
     
     // Send welcome email with activation link
     await sendWelcomeEmail(email, farm.activationCode);
     
     res.json({ success: true, farmUrl: `https://${farm.subdomain}.greenreach.io` });
   });
   ```

3. **Email Templates**:
   - Welcome email with activation link
   - Trial expiration reminders (7 days, 3 days, 1 day)
   - Upgrade prompts

**Total Effort**: 3 days

---

## 6. Quick Win: Downloads Page Only (1 Day)

If a full marketing website is too much initially, create a **minimal downloads page**:

**File**: `install-server/public/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Light Engine Downloads</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 50px auto; padding: 20px; }
    h1 { color: #10b981; }
    .platform { border: 2px solid #e5e7eb; border-radius: 12px; padding: 24px; margin: 20px 0; }
    .platform h2 { margin-top: 0; }
    .btn { background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; }
    .btn:hover { background: #059669; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>🌱 Light Engine Downloads</h1>
  <p>Choose your platform to get started with Light Engine farm management software.</p>
  
  <div class="platform">
    <h2>💻 Desktop App (Windows/macOS)</h2>
    <p>Standalone application for inventory, POS, and sales management.</p>
    <p><strong>Requirements:</strong> Windows 10+ or macOS 12+, 4GB RAM, 500MB disk</p>
    <p>
      <a href="/downloads/Light-Engine-Setup-1.0.0.exe" class="btn">Download for Windows</a>
      <a href="/downloads/Light-Engine-1.0.0.dmg" class="btn">Download for macOS</a>
    </p>
    <p><small>Version 1.0.0 • <a href="/docs/DESKTOP_APP_GUIDE.md">Installation Guide</a></small></p>
  </div>
  
  <div class="platform">
    <h2>📱 Mobile App (iOS/Android)</h2>
    <p>Activity Hub for QR scanning, harvest recording, and farm monitoring.</p>
    <p><strong>Requirements:</strong> iOS 13+ or Android 8+</p>
    <p>
      <a href="https://apps.apple.com/app/light-engine" class="btn">Download on App Store</a>
      <a href="https://play.google.com/store/apps/details?id=io.lightengine.app" class="btn">Get it on Google Play</a>
    </p>
    <p><small>Version 1.0.0 • <a href="/docs/mobile-app/README.md">Quick Start Guide</a></small></p>
  </div>
  
  <div class="platform">
    <h2>🖥️ Edge Device Installer (Linux)</h2>
    <p>Complete farm automation with hardware control for Raspberry Pi or Intel NUC.</p>
    <p><strong>Requirements:</strong> Ubuntu 22.04 LTS or Raspberry Pi OS, 4GB RAM, Network connection</p>
    <p><strong>One-Line Install:</strong></p>
    <pre><code>curl -fsSL https://install.greenreach.io/install.sh | bash</code></pre>
    <p><small><a href="/docs/EDGE_DEPLOYMENT_GUIDE.md">Complete Installation Guide</a></small></p>
  </div>
  
  <hr>
  <p><strong>Need Help?</strong> Visit <a href="/docs/">Documentation</a> or email <a href="mailto:support@lightengine.io">support@lightengine.io</a></p>
  <p><small>© 2025 GreenReach. All rights reserved. • <a href="/privacy">Privacy</a> • <a href="/terms">Terms</a></small></p>
</body>
</html>
```

**Deploy**:
```bash
# Update install-server/server.js
app.use(express.static('public'));

# Create public directory
mkdir install-server/public

# Save HTML file
# Copy to public/index.html

# Restart server
pm2 restart install-server
```

**Result**: Users can visit `https://install.greenreach.io` and see a proper downloads page instead of JSON.

---

## 7. Priority Recommendations

### Immediate (This Week)
1. ✅ **Domain Registration**: Buy `lightengine.io` or `greenreach.io` ($12/year)
2. ✅ **Simple Downloads Page**: Deploy HTML page to install server (4 hours)
3. ✅ **Build Desktop Apps**: Generate .exe and .dmg installers (2 hours)
4. ✅ **Upload Binaries**: Copy to install server downloads folder (1 hour)

### Short-Term (Next 2 Weeks)
5. ✅ **Marketing Homepage**: Build landing page with two user paths (3 days)
6. ✅ **Documentation Portal**: Publish existing docs with search (2 days)
7. ✅ **Mobile App APK**: Build Android APK for direct download (1 day)

### Medium-Term (Next Month)
8. ✅ **App Store Submissions**: iOS App Store and Google Play listings (1 week)
9. ✅ **Cloud Registration**: Public signup flow with free trial (3 days)
10. ✅ **Video Tutorials**: Record 3-5 minute product demos (1 week)

### Long-Term (Next Quarter)
11. ✅ **SEO Optimization**: Keyword research and content marketing
12. ✅ **Customer Testimonials**: Case studies from beta farms
13. ✅ **Comparison Pages**: "Light Engine vs [Competitor]"
14. ✅ **Affiliate Program**: Partner with farm supply companies

---

## 8. Budget Estimate

### One-Time Costs
| Item | Cost | Notes |
|------|------|-------|
| Domain (lightengine.io) | $12/year | GoDaddy or Namecheap |
| Apple Developer | $99/year | For iOS App Store |
| Google Play Developer | $25 once | For Android |
| SSL Certificate | $0 | Let's Encrypt (free) |
| **Subtotal** | **$136** | First year |

### Monthly Costs
| Item | Cost | Notes |
|------|------|-------|
| Website Hosting (Netlify) | $0 | Free tier sufficient |
| CDN (CloudFront) | ~$5 | For binary downloads |
| Domain Email (Google Workspace) | $6 | support@lightengine.io |
| **Subtotal** | **$11/month** | |

### Development Time
| Task | Hours | Rate ($100/hr) | Cost |
|------|-------|----------------|------|
| Marketing website (7 pages) | 60 | $100 | $6,000 |
| Downloads infrastructure | 8 | $100 | $800 |
| Mobile app deployment | 16 | $100 | $1,600 |
| Cloud registration flow | 24 | $100 | $2,400 |
| Video tutorials | 40 | $100 | $4,000 |
| **Total Development** | **148 hours** | | **$14,800** |

**Total First Year**: $136 + ($11 × 12) + $14,800 = **$15,068**

**Alternative (DIY)**: If you build it yourself, just $136 + $132/year = **$268/year** ongoing.

---

## 9. Success Metrics

After website launch, track:

### Traffic Metrics
- **Visitors**: Unique visitors per month
- **Page Views**: Total page views
- **Bounce Rate**: % leaving after one page (target: <60%)
- **Time on Site**: Average session duration (target: >2 min)

### Conversion Metrics
- **Download Rate**: % of visitors who download
- **Signup Rate**: % who register for cloud trial
- **Activation Rate**: % who complete first-run setup
- **Trial Conversion**: % of trials that become paid

### Product Metrics
- **Active Installs**: Desktop/mobile/edge devices active
- **Daily Active Users (DAU)**: Users logging in daily
- **Feature Usage**: Most-used features (harvest tracking, POS, etc.)
- **Retention**: % of users still active after 30/90 days

---

## 10. Conclusion

**Current Situation**: Light Engine has **world-class software** and **complete deployment infrastructure**, but **zero customer acquisition capability** because there's no website.

**Critical Path to Launch**:
1. **Week 1**: Buy domain, deploy downloads page, build desktop apps
2. **Week 2**: Build marketing homepage with two user paths
3. **Week 3**: Add cloud registration and mobile app distribution
4. **Week 4**: Launch publicly and announce

**Minimal Viable Launch (1 Week)**:
- Domain: `www.lightengine.io`
- Homepage: Single page explaining edge vs cloud
- Downloads: HTML page with links to installers
- Documentation: Link to existing guides

**Cost**: $268/year if you build it, or $15,000 to hire developer.

**Recommendation**: Start with **Quick Win downloads page** (1 day), then iterate based on user feedback. The infrastructure is ready—users just need a way to find it.

---

**Next Steps**:
1. Choose domain name and register
2. Deploy simple downloads page to install server
3. Build and upload desktop app installers
4. Share downloads page with beta testers
5. Iterate based on feedback before building full marketing site

---

*This assessment assumes all current code is production-ready. Review individual component documentation for deployment details.*
