# Google Analytics 4 Setup Guide

Google Analytics 4 tracking has been added to all GreenReach marketing pages.

## Production Configuration:
- **Property:** GreenReach Website
- **Stream URL:** https://www.greenreachgreens.com
- **Stream ID:** 13362368703
- **Measurement ID:** G-GBPD0VBEF2
- **Status:** ✅ Active and tracking

## Pages with Analytics Tracking:
- ✅ greenreach-org.html (Home)
- ✅ growing-made-easy.html
- ✅ grow-and-sell.html (Wholesale)
- ✅ wholesale-landing.html
- ✅ landing-edge.html (Edge device)
- ✅ landing-cloud.html (Cloud service)
- ✅ schedule.html
- ✅ purchase.html

## Setup Instructions:

### Step 1: Create Google Analytics Account
1. Go to https://analytics.google.com
2. Sign in with your Google account (use info@greenreachfarms.com)
3. Click "Start measuring"
4. Enter:
   - Account name: "GreenReach"
   - Property name: "GreenReach Website"
   - Time zone: Canada/Eastern
   - Currency: CAD (Canadian Dollar)
5. Click "Next"

### Step 2: Get Your Measurement ID
1. In GA4, go to Admin (gear icon)
2. Under Property → Data Streams
3. Click "Add stream" → "Web"
4. Enter:
   - Website URL: https://greenreachgreens.com
   - Stream name: GreenReach Website
5. Copy your **Measurement ID** (format: `G-XXXXXXXXXX`)

**✅ COMPLETED - Production Details:**
- **Measurement ID:** G-GBPD0VBEF2
- **Stream ID:** 13362368703
- **Stream URL:** https://www.greenreachgreens.com

### Step 3: Update Tracking Code
~~Replace `G-XXXXXXXXXX` with your actual Measurement ID in these files:~~

**✅ COMPLETED** - All pages updated with G-GBPD0VBEF2 on January 25, 2026

**In greenreach-central/public/ folder:**
```bash
# All files already updated with G-GBPD0VBEF2
# To verify:
grep -r "G-GBPD0VBEF2" greenreach-central/public/*.html
```

**Updated files (✅ Complete):**
- greenreach-central/public/greenreach-org.html
- greenreach-central/public/growing-made-easy.html
- greenreach-central/public/grow-and-sell.html
- greenreach-central/public/wholesale-landing.html
- greenreach-central/public/landing-edge.html
- greenreach-central/public/landing-cloud.html
- greenreach-central/public/schedule.html
- greenreach-central/public/purchase.html

~~**Quick command to replace all instances:**~~
~~```bash
cd greenreach-central/public
# Replace G-XXXXXXXXXX with your actual ID (e.g., G-ABC123DEF456)
find . -name "*.html" -exec sed -i '' 's/G-XXXXXXXXXX/G-YOUR-ACTUAL-ID/g' {} +
```~~

**✅ Already deployed with G-GBPD0VBEF2**

### Step 4: Deploy to AWS
~~```bash
cd greenreach-central
git add -A
git commit -m "Update Google Analytics Measurement ID"
git push origin main
eb deploy
```~~

**✅ DEPLOYED** - Live at https://greenreachgreens.com (January 25, 2026)

### Step 5: Verify Tracking
1. Go to https://analytics.google.com
2. Navigate to Reports → Realtime
3. Visit https://greenreachgreens.com in a new tab
4. You should see your visit appear in real-time (within 30 seconds)

## What You'll Track:

### Automatically Tracked:
- **Page Views:** Which pages people visit
- **Sessions:** How long people stay on site
- **Users:** Unique visitors (daily/monthly)
- **Traffic Sources:** Where visitors come from (Google, direct, social media)
- **Geography:** Visitor locations (city, country)
- **Devices:** Desktop vs mobile vs tablet
- **Bounce Rate:** % who leave after viewing one page
- **Browser/OS:** Chrome, Safari, Firefox, etc.

### Advanced Tracking (Optional):
To track button clicks and conversions, add event tracking:

```javascript
// Example: Track "Schedule Call" button clicks
gtag('event', 'schedule_call_click', {
  'event_category': 'engagement',
  'event_label': 'Calendly Button'
});

// Example: Track GROW page visits
gtag('event', 'view_grow_page', {
  'page_title': 'GROW Product Page'
});
```

## Privacy & GDPR Compliance:

Google Analytics 4 is configured with these privacy settings:
- IP anonymization (automatic in GA4)
- Cookie-based tracking (consider adding cookie consent banner)
- Data retention: 2-14 months (configurable)

**Recommended:** Add a cookie consent banner for EU visitors:
- Use CookieBot, OneTrust, or similar
- Or add a simple banner to all pages

## Viewing Reports:

### Most Useful Reports:
1. **Realtime Overview** - See current visitors
2. **Acquisition Overview** - Where traffic comes from
3. **Pages and Screens** - Most popular pages
4. **Events** - Button clicks, form submissions
5. **Demographics** - Age, interests, location

### Access Reports:
- Login: https://analytics.google.com
- Select "GreenReach Website" property
- Click "Reports" in left sidebar

## Troubleshooting:

### Not seeing data?
1. Check Measurement ID is correct (9 places)
2. Clear browser cache
3. Disable ad blockers
4. Wait 24-48 hours for full data processing

### Seeing test traffic?
1. In GA4 Admin → Data Streams → Configure tag settings
2. Enable "Define internal traffic"
3. Add your IP address to exclude

## Support:
- Google Analytics Help: https://support.google.com/analytics
- Contact: info@greenreachfarms.com
