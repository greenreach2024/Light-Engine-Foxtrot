# Domain Page Assignment Audit
**Date**: December 28, 2025  
**Purpose**: Verify correct domain assignment for all pages

---

## ✅ CORRECT - Greenreach Pages (www.greenreachgreens.com)

### Buyer/Customer Facing
1. **wholesale.html** - "GreenReach Wholesale | Order Fresh Produce" ✅
2. **wholesale-admin.html** - "GreenReach Wholesale Admin" ✅
3. **farm-store.html** - "Farm Online Store" ✅
4. **farm-sales.html** - "Farm Sales Terminal" ✅
5. **shop.html** - "Farm Shop - Fresh Local Produce" ✅

---

## ❌ INCORRECT - Farm Pages Using GreenReach Branding

### Should be Light Engine/Urban Yeild:
1. **wholesale-farm-orders.html**
   - Current Title: "Wholesale Orders - Farm Dashboard"
   - Purpose: Farms manage their wholesale orders
   - **ISSUE**: Farm-facing tool, should be on urbanyeild.ca
   
2. **wholesale-farm-performance.html**
   - Current Title: "Farm Performance Dashboard - **GreenReach Central**"
   - Purpose: Individual farm analytics
   - **ISSUE**: Says "GreenReach Central" but it's a farm tool, not buyer tool
   
3. **wholesale-integrations.html**
   - Current Title: "Integrations | **GreenReach Wholesale**"
   - Purpose: Farms configure QuickBooks/accounting integrations
   - **ISSUE**: Farm configuration tool using GreenReach branding

4. **wholesale-order-review.html**
   - Current Title: "Review Order Modifications"
   - Purpose: Farms review buyer order modification requests
   - **ISSUE**: Farm-facing, redirects to /wholesale.html (buyer portal)
   - Line 342: `window.location.href = '/wholesale.html?view=orders';`

---

## ✅ CORRECT - Light Engine Pages (www.urbanyeild.ca)

### Environmental Control & Monitoring
1. **index.html** - "Light Engine Foxtrot" ✅
2. **vpd.html** - "VPD Automation Dashboard" ✅
3. **switchbot.html** - "SwitchBot Device Manager - Light Engine Charlie" ✅

### Farm Operations
4. **farm-admin.html** - "Farm Admin - Light Engine" ✅
5. **billing.html** - "Billing & Subscription - Light Engine" ✅
6. **farm-admin-login.html** - "Farm Admin Sign In - Light Engine" ✅

### Setup & Configuration
7. **setup-wizard.html** - "Farm Registration - GreenReach Central" ⚠️ (Mixed branding)
8. **migration-wizard.html** - "Cloud to Edge Migration - Light Engine" ✅
9. **qr-generator.html** - "QR Code Bulk Generator - Light Engine Foxtrot" ✅

### Landing/Marketing
10. **landing.html** - "Light Engine - Farm Management Solutions" ✅
11. **landing-edge.html** - "Light Engine Edge" ✅
12. **landing-cloud.html** - "Light Engine Cloud" ✅
13. **downloads.html** - "Download Light Engine" ✅
14. **purchase.html** - "Purchase Light Engine" ✅

---

## ⚠️ MIXED BRANDING ISSUES

### Pages with Incorrect Branding References

1. **admin.html** - "**GreenReach Admin** - Light Engine"
   - Title mixes GreenReach with Light Engine
   - Should be: "Farm Admin - Light Engine" or just "Admin - Light Engine"

2. **setup-wizard.html** - "Farm Registration - **GreenReach Central**"
   - Light Engine farm setup using GreenReach branding
   - Should be: "Farm Registration - Light Engine"

3. **notification-settings.html** - "Notification Settings - **GreenReach**"
   - Light Engine notifications using GreenReach branding
   - Should be: "Notification Settings - Light Engine"

---

## 🔧 REQUIRED FIXES

### Move These Pages to Urban Yeild Domain Context:

1. **wholesale-farm-orders.html**
   - Change API calls from relative to absolute if needed
   - Update any GreenReach branding references
   - Ensure it's documented as urbanyeild.ca page

2. **wholesale-farm-performance.html**
   - Remove "GreenReach Central" from title
   - Change to: "Farm Performance Dashboard - Light Engine"

3. **wholesale-integrations.html**
   - Remove "GreenReach Wholesale" from title
   - Change to: "Farm Integrations - Light Engine"

4. **wholesale-order-review.html**
   - Fix redirect on line 342: Should go to farm dashboard, not buyer portal
   - Change: `window.location.href = '/wholesale.html?view=orders';`
   - To: `window.location.href = '/farm-admin.html?view=wholesale-orders';`

### Fix Mixed Branding:

5. **admin.html** - Remove "GreenReach" from title
6. **setup-wizard.html** - Remove "GreenReach Central" from title
7. **notification-settings.html** - Remove "GreenReach" from title

---

## 📊 Summary

**Greenreach (www.greenreachgreens.com)**: 5 pages ✅
- wholesale.html
- wholesale-admin.html
- farm-store.html
- farm-sales.html
- shop.html

**Light Engine (www.urbanyeild.ca)**: 20+ pages
- All monitoring, automation, and farm operations pages
- **Add**: wholesale-farm-orders, wholesale-farm-performance, wholesale-integrations, wholesale-order-review

**Branding Issues Found**: 7 pages
- 4 farm wholesale pages using GreenReach branding/redirects
- 3 Light Engine pages with GreenReach in titles

---

## 🎯 Action Items

1. ✅ CORS is already configured for both domains
2. ❌ Fix page titles removing incorrect GreenReach branding
3. ❌ Fix redirect in wholesale-order-review.html (line 342)
4. ❌ Update documentation to reflect farm wholesale pages on urbanyeild.ca
5. ❌ Consider adding domain-based routing logic if strict separation is needed
