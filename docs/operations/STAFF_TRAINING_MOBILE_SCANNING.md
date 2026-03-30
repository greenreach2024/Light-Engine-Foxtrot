# Staff Training Guide - Mobile Scanning App

**Tray Inventory Management & QR Code Scanning**

---

## Overview

The mobile scanning app is your tool for tracking trays throughout their lifecycle - from seeding to harvest. Using QR codes and your phone camera, you can quickly record all farming operations and keep inventory accurate in real-time.

**Training Time:** 45-60 minutes  
**Device Required:** Smartphone (iPhone or Android)  
**App Access:** Light Engine Mobile (TestFlight/internal APK)  
**Support Contact:** Farm Manager

---

## Quick Start (10 Minutes)

### Install App

**iOS (TestFlight):**
1. Install TestFlight app from App Store
2. Open invitation link sent by manager
3. Tap "Install" for Light Engine Mobile
4. Open app from home screen

**Android (Internal APK):**
1. Enable "Install from Unknown Sources" in Settings
2. Download APK from manager
3. Tap APK file to install
4. Open app from app drawer

### First Login

1. Open Light Engine Mobile app
2. Enter farm URL: `https://your-farm.com`
3. Enter your username
4. Enter your password
5. Tap "Login"
6. Grant camera permissions when prompted

### Scan Your First Tray

1. Tap "Scanner" tab at bottom
2. Point camera at tray QR code
3. Wait for scan (green frame appears)
4. Choose action: Seed, Place, or Harvest
5. Fill in details
6. Tap "Submit"
7. Done!

---

## Table of Contents

1. [App Navigation](#app-navigation)
2. [QR Code Basics](#qr-code-basics)
3. [Seeding Trays](#seeding-trays)
4. [Placing Trays](#placing-trays)
5. [Harvesting Trays](#harvesting-trays)
6. [Batch Operations](#batch-operations)
7. [Inventory Dashboard](#inventory-dashboard)
8. [Troubleshooting](#troubleshooting)
9. [Best Practices](#best-practices)

---

## App Navigation

### Main Screen (Dashboard)

**Top Section: Farm Overview**
```
Farm Name Badge
Active Trays: 487
Total Plants: 98,560
```

**Harvest Forecast:**
- Today: 12 trays (2,304 plants)
- This Week: 67 trays (12,864 plants)  
- Next Week: 89 trays (17,088 plants)

**Quick Actions:**
- Refresh button (pull down to refresh)
- Settings gear icon

### Bottom Navigation Tabs

**4 Main Tabs:**

1. **Dashboard** (Home icon)
   - Farm overview and stats
   - Harvest forecast
   - Quick access to common tasks

2. **Scanner** (QR code icon)
   - Camera view for scanning
   - Real-time QR detection
   - Action selection dialog

3. **Inventory** (Box icon)
   - Current inventory by crop
   - Stock levels
   - Harvest schedule

4. **Environment** (Temperature icon)
   - Room conditions (temp, humidity)
   - Alerts and anomalies
   - Target vs actual metrics

---

## QR Code Basics

### What are QR Codes?

QR codes are square barcodes that store tray IDs, location codes, and other data. They allow fast, accurate data entry without typing.

### Types of QR Codes

**1. Tray QR Codes**
- Attached to each tray
- Format: `TRAY-001` through `TRAY-999`
- Unique identifier for that specific tray
- Permanent (lasts life of tray)

**2. Location QR Codes**
- Attached to shelf positions
- Format: `A1-R2-P3` (Zone-Rack-Position)
- Identifies exact placement in grow room
- Permanent installation

**3. Batch QR Codes** (optional)
- For grouping trays together
- Useful for large harvests
- Temporary codes

### Where to Find QR Codes

**Tray Codes:**
- Printed on adhesive label
- Attached to tray end
- Waterproof and durable
- Do NOT remove or cover

**Location Codes:**
- Laminated signs on racks
- Posted at each shelf position
- Multiple copies for backup
- Contact manager if missing

### Scanning Tips

**Good Lighting:**
- Natural light is best
- Use phone flashlight in dim areas
- Avoid direct sunlight (causes glare)

**Proper Distance:**
- Hold phone 6-12 inches from code
- Not too close (blurry)
- Not too far (won't detect)

**Steady Hands:**
- Keep phone still
- Wait 1-2 seconds
- Green frame appears when detected

**Clean Codes:**
- Wipe dirty codes with damp cloth
- Report damaged codes to manager
- System can't read scratched/torn codes

---

## Seeding Trays

### When to Seed

- New tray starts fresh crop cycle
- Tray was harvested and cleaned
- Expanding production
- Starting new recipe/variety

### Seeding Workflow

**Step 1: Scan Tray**

1. Tap "Scanner" tab
2. Point camera at tray QR code
3. Code detected: `TRAY-142`
4. Dialog appears: "What action?"
5. Tap "Seed"

**Step 2: Select Recipe**

```
Screen: Seed Tray
Tray: TRAY-142

Recipe: [Dropdown]
- Lettuce - Green Oakleaf
- Lettuce - Red Romaine
- Basil - Genovese
- Kale - Lacinato
- [...]
```

1. Tap "Recipe" dropdown
2. Scroll to find crop type
3. Tap to select
4. Recipe name appears in field

**Step 3: Choose Tray Format**

```
Tray Format: [Dropdown]
- 128-cell tray
- 200-cell tray
- 288-cell tray (microgreens)
```

1. Select format based on actual tray
2. Most common: 200-cell
3. Microgreens: 288-cell
4. Large crops: 128-cell

**Step 4: Set Seed Date**

```
Seed Date: [Date Picker]
Default: Today
```

- Usually leave as today
- Adjust if seeding happened yesterday
- Cannot set future date

**Step 5: Enter Plant Count** (Optional)

```
Plant Count: [Number Input]
Placeholder: "Leave blank for default"
```

- System uses format default if blank
- Override if seeding partial tray
- Example: Only seeded 150 cells instead of 200

**Step 6: Add Notes** (Optional)

```
Notes: [Text Input]
Examples:
- "Using new seed batch #1234"
- "Experimental variety"
- "Double-seeded per cell"
```

**Step 7: Submit**

1. Review all fields
2. Tap "Seed Tray" button
3. Loading spinner appears
4. Success message: "Tray seeded successfully"
5. Returns to scanner

### After Seeding

**Physical Tasks:**
- Place tray in germination area
- Water according to recipe
- Cover with humidity dome (if required)
- Label with seed date (paper label)

**System Updates:**
- Tray marked as "active"
- Expected harvest date calculated
- Inventory forecast updated
- Appears in dashboard stats

---

## Placing Trays

### When to Place

- Move tray from germination to grow room
- Relocate tray to different position
- Consolidate sparse areas
- Make room for new trays

### Placement Workflow

**Step 1: Scan Tray**

1. Scanner tab
2. Scan tray QR code: `TRAY-142`
3. Select "Place" action

**Step 2: Verify Tray Info**

```
Screen: Place Tray
Tray: TRAY-142

Tray Information:
Recipe: Lettuce - Green Oakleaf
Seeded: 2025-12-15
Expected Harvest: 2025-12-30
Days Growing: 16 days
```

- Confirm this is the correct tray
- Check recipe matches physical tray
- Verify days growing is accurate

**Step 3: Scan Location**

Two options:

**Option A: Scan Location QR**
1. Tap "Scan Location" button
2. Camera activates
3. Point at location QR code
4. Code detected: `A1-R3-P7`
5. Location name appears: "Zone A1, Rack 3, Position 7"

**Option B: Enter Manually**
1. Tap "Enter Location Manually"
2. Type location code: `A1-R3-P7`
3. System validates code
4. Location name appears

**Step 4: Add Notes** (Optional)

```
Notes: [Text Input]
Examples:
- "Moved from germination"
- "Repositioned for better light"
- "Consolidated with Zone B"
```

**Step 5: Submit**

1. Tap "Place Tray" button
2. Success: "Tray placed successfully"
3. System updates location
4. Old location freed up
5. New location marked occupied

### Physical Placement

**After Scanning:**
1. Physically move tray to scanned location
2. Verify position matches QR code
3. Check tray is level and stable
4. Ensure adequate spacing
5. Connect to irrigation/lighting if applicable

**Important:** Always scan BEFORE moving tray. This prevents confusion if you're interrupted mid-task.

---

## Harvesting Trays

### When to Harvest

- Recipe days reached (e.g., day 21 for lettuce)
- Visual maturity check passed
- Customer order requires harvest
- Planned harvest schedule

### Pre-Harvest Check

**Visual Inspection:**
- Proper size for crop type
- Healthy green color
- No pests or disease
- Roots established

**System Check:**
- Dashboard → Harvest Forecast → "Ready Today"
- List of trays at harvest day
- Plan harvest order

### Harvest Workflow

**Step 1: Scan Tray**

1. Scanner tab
2. Scan tray QR: `TRAY-142`
3. Select "Harvest" action

**Step 2: Verify Tray Info**

```
Screen: Harvest Tray
Tray: TRAY-142

Tray Information:
Recipe: Lettuce - Green Oakleaf
Seeded: 2025-12-10
Days Growing: 21 days
Expected: Ready to harvest
```

- Confirm correct tray
- Verify days growing matches expectation
- Check "Ready to harvest" status

**Step 3: Enter Actual Harvest Count**

```
Actual Harvest Count: [Number Input]
Placeholder: "Number of plants harvested"
```

**Why Count?**
- Tracks yield per tray
- Identifies germination issues
- Calculates plant loss
- Improves forecasting

**Example:**
- Tray seeded: 200 cells
- Actual harvested: 192 plants
- Loss: 8 plants (4%)
- Reason: Poor germination in corner

**Step 4: Enter Harvest Weight** (Optional)

```
Harvest Weight: [Number Input]
Unit: kg or lbs
```

- Weigh harvested crop on scale
- Enter total weight
- Helps calculate yield/sqft
- Used for sales pricing

**Step 5: Record Quality Notes**

```
Notes: [Text Input]
Examples:
- "Excellent quality, uniform size"
- "Some tip burn on 5% of plants"
- "Slightly undersized due to cold week"
- "Perfect harvest timing"
```

**Quality Indicators:**
- Size: Small, Medium, Large, Extra Large
- Color: Pale, Good, Excellent
- Uniformity: Poor, Fair, Good, Excellent
- Defects: None, Minor, Moderate, Significant

**Step 6: Submit**

1. Tap "Record Harvest" button
2. Loading spinner
3. Success: "Harvest recorded"
4. System updates:
   - Tray marked "harvested"
   - Inventory incremented
   - Lot code generated (FDA traceability)
   - Forecast updated

### Post-Harvest Tasks

**Physical:**
1. Clean tray thoroughly
2. Sanitize with approved cleaner
3. Stack in clean tray storage
4. Label harvest batch with lot code
5. Store harvested crop properly

**System:**
- Tray now available for re-seeding
- Inventory updated in real-time
- Harvest appears in sales system
- Manager notified if quality issues

---

## Batch Operations

### Batch Harvest Mode

**Use Case:** Harvesting multiple trays of same crop at once

**Benefits:**
- Faster workflow
- Consistent weight entry
- Single quality check
- Bulk lot code generation

### Batch Harvest Workflow

**Step 1: Enable Batch Mode**

```
Scanner Tab → Scan Modal
[Toggle] Batch Harvest Mode: ON
```

**Step 2: Scan Multiple Trays**

1. Scan first tray: `TRAY-142`
2. Tray added to batch list
3. "Scan another or continue?"
4. Scan second tray: `TRAY-143`
5. Added to batch
6. Repeat for all trays

**Batch List:**
```
Scanned Trays (5):
TRAY-142 - Lettuce Green Oakleaf
TRAY-143 - Lettuce Green Oakleaf
TRAY-144 - Lettuce Green Oakleaf
TRAY-145 - Lettuce Green Oakleaf
TRAY-146 - Lettuce Green Oakleaf
```

**Step 3: Set Harvest Weight**

```
Enter harvest weight for ALL 5 trays:
Weight: [Number Input]
Example: 7.5 kg total (1.5 kg per tray)
```

- System divides total by tray count
- Each tray gets equal weight
- Or enter individual weights

**Step 4: Quality Notes**

```
Notes apply to entire batch:
"Excellent quality, uniform batch"
```

**Step 5: Harvest All**

1. Tap "Harvest All Trays"
2. System processes each tray
3. Progress indicator: "Processing 2 of 5..."
4. Success: "5 trays harvested"
5. Single lot code for batch: `A1-LETTUCE-251231-001`

### Quick Move Mode

**Use Case:** Relocating many trays (weekly shuffling)

**Workflow:**
1. Enable "Quick Move" mode
2. Scan tray QR
3. Scan new location QR
4. Auto-confirms without additional screens
5. Repeat for next tray

**Speed:**
- 2-3 seconds per tray
- 20 trays in 1 minute
- No typing required

---

## Inventory Dashboard

### Accessing Inventory

Tap "Inventory" tab at bottom.

### Inventory View

**By Crop Type:**
```
Lettuce - Green Oakleaf
  Active Trays: 47
  Total Plants: 9,400
  Ready to Harvest: 12 trays
  Harvest Next Week: 23 trays

Basil - Genovese
  Active Trays: 22
  Total Plants: 4,400
  Ready to Harvest: 3 trays
  Harvest Next Week: 8 trays

[...]
```

**Filter Options:**
- All Crops
- Ready to Harvest
- Needs Placement
- Germinating

**Sort Options:**
- By Crop Name (A-Z)
- By Harvest Date (Soonest First)
- By Quantity (Most First)

### Harvest Schedule

**48-Hour Forecast:**
```
Today (Dec 31):
- 12 trays ready
- Lettuce (8), Basil (4)
- Total: 2,304 plants

Tomorrow (Jan 1):
- 15 trays ready
- Kale (6), Lettuce (5), Herbs (4)
- Total: 2,880 plants

Day After (Jan 2):
- 18 trays ready
- Microgreens (10), Lettuce (8)
- Total: 5,760 plants
```

**Action Buttons:**
- "View Details" - See specific tray IDs
- "Print Harvest List" - Generate pick list
- "Mark as Planned" - Confirm harvest scheduled

### Inventory Alerts

**System Notifications:**

**Low Stock:**
```
Alert: Basil - Genovese
Current: 2 trays ready
Orders: 5 trays needed this week
Action Required: Seed 3 more trays immediately
```

**Overdue Harvest:**
```
Warning: 4 trays overdue
TRAY-087 - Lettuce (Day 25, expected Day 21)
TRAY-089 - Lettuce (Day 24, expected Day 21)
[...]
Action: Harvest immediately or document delay
```

**Missing Placement:**
```
Notice: 7 trays germinated but not placed
Seeded 10 days ago
Action: Move to grow room positions
```

---

## Troubleshooting

### Issue: QR Code Won't Scan

**Symptoms:**
- Camera shows code but doesn't detect
- Red frame appears then disappears
- "Invalid QR code" error

**Solutions:**

1. **Check Lighting**
   - Move to brighter area
   - Turn on phone flashlight
   - Avoid direct sunlight glare

2. **Clean QR Code**
   - Wipe with damp cloth
   - Remove dirt/water droplets
   - Check if laminate is scratched

3. **Adjust Distance**
   - Try holding phone closer (6 inches)
   - Try holding phone farther (12 inches)
   - Keep phone still for 2 seconds

4. **Verify Code Format**
   - Tray codes: TRAY-001 format
   - Location codes: A1-R2-P3 format
   - If wrong format, re-print code

5. **Manual Entry Backup**
   - Tap "Enter Manually" button
   - Type QR code text
   - System validates entry

6. **Camera Permission Issue**
   - Settings → Apps → Light Engine
   - Permissions → Camera → Allow
   - Restart app

### Issue: "Tray Not Found" Error

**Symptoms:**
- QR scans successfully
- System says "Tray not found in database"

**Causes & Solutions:**

1. **New Tray Not Registered**
   - Tray QR never scanned before
   - Solution: First scan registers it
   - Enter tray format and details

2. **Wrong Farm Selected**
   - Logged into wrong farm account
   - Solution: Log out, log in to correct farm

3. **Deleted Tray**
   - Tray removed from system
   - Solution: Contact manager to restore

4. **Typo in Manual Entry**
   - Check spelling: `TRAY-142` not `TRAY-l42`
   - Solution: Re-scan or re-type carefully

### Issue: App Crashes When Scanning

**Symptoms:**
- App closes when opening camera
- Black screen when scanning
- "App has stopped" error

**Solutions:**

1. **Restart App**
   - Close app completely
   - Reopen from home screen

2. **Clear App Cache**
   - Settings → Apps → Light Engine
   - Storage → Clear Cache
   - (Keep "Clear Data" as last resort)

3. **Update App**
   - Check for app updates
   - Install latest version
   - Restart phone after update

4. **Free Up Phone Storage**
   - Need 500MB+ free space
   - Delete old photos/videos
   - Offload unused apps

5. **Reinstall App**
   - Uninstall Light Engine
   - Restart phone
   - Reinstall from TestFlight/APK

### Issue: Slow Scanner Response

**Symptoms:**
- 5+ seconds to detect QR
- Laggy camera view
- Delayed action selection

**Solutions:**

1. **Close Other Apps**
   - Double-click home button (iOS)
   - Swipe up to close apps
   - Free up phone memory

2. **Check Internet Connection**
   - Switch to WiFi if on cellular
   - Move closer to router
   - Test speed: Should be >5 Mbps

3. **Reduce App Load**
   - Log out and log back in
   - Clears cached data
   - Starts fresh session

### Issue: Wrong Tray Scanned

**Solution:**
1. Don't panic!
2. Cancel current action
3. Back button returns to scanner
4. Scan correct tray
5. If already submitted:
   - Contact manager immediately
   - Manager can reverse action
   - Document correction in notes

### Issue: Forgot to Scan Movement

**Scenario:** Moved tray physically but forgot to scan new location.

**Solution:**
1. Return tray to original location
2. Scan tray
3. Select "Place" action
4. Scan new location
5. Move tray again
6. System now accurate

**OR:**

1. Contact manager
2. Manager can update location manually
3. Document reason in notes

---

## Best Practices

### Daily Routine

**Morning Startup (15 minutes):**

1. Open app and refresh dashboard
2. Check harvest forecast for today
3. Review inventory alerts
4. Plan harvest order (priority crops first)
5. Gather scanning device and supplies

**During Seeding:**
- Scan immediately after seeding
- Don't delay - fresh data is accurate
- Use batch mode for large seeding runs
- Double-check recipe selection

**During Placement:**
- Scan before moving (prevents errors)
- Verify location QR matches position
- Use quick move for mass relocations
- Note any placement issues

**During Harvest:**
- Count plants honestly (don't estimate)
- Weigh crops on clean scale
- Record quality observations
- Use batch mode for uniform crops

**End of Day (10 minutes):**
- Review all scans completed
- Check for any error notifications
- Sync data if offline mode used
- Charge scanning device overnight

### Accuracy Tips

**1. Count Don't Guess**
- Harvest count should be actual, not estimated
- Take 30 seconds to count properly
- Accuracy improves forecasting for everyone

**2. Immediate Scanning**
- Scan right after completing task
- Don't wait until end of shift
- Fresh observations = better notes

**3. Meaningful Notes**
- "Some tip burn" is better than "OK"
- "Excellent uniform size" beats "Good"
- Future you will thank present you

**4. Verify Before Submit**
- Double-check recipe selection
- Confirm tray ID matches physical tray
- Review harvest count for typos
- Can't undo after submit!

### Speed Optimization

**For Busy Harvest Days:**

1. **Pre-Stage Materials**
   - Phone charged and ready
   - Clean scale
   - Harvest bins labeled
   - QR codes visible

2. **Batch Processing**
   - Enable batch harvest mode
   - Scan all trays first
   - Enter weights together
   - Submit all at once

3. **Two-Person Teams**
   - Person A: Physical harvest
   - Person B: Scanning and data entry
   - 2x faster than solo

4. **Memorize Common Codes**
   - Top 10 tray IDs
   - Main grow zone locations
   - Reduces scan time

### Quality Control

**Weekly Audits:**

1. **Physical Inventory Check**
   - Count 10 random trays
   - Verify location matches system
   - Check plant count accuracy
   - Report discrepancies

2. **QR Code Maintenance**
   - Inspect codes for damage
   - Clean dirty labels
   - Replace worn codes
   - Test scan speed

3. **Data Quality Review**
   - Manager reviews harvest notes
   - Identify recurring issues
   - Adjust growing protocols
   - Improve seed quality

### Team Coordination

**Communication:**
- Daily huddle: Discuss harvest plan
- Share inventory alerts
- Report damaged QR codes
- Celebrate accurate scanning

**Training:**
- New staff shadow experienced scanner
- Practice with test trays
- Quiz on workflow steps
- Certify competency before solo work

---

## Training Checklist

New staff member should complete all tasks:

### Week 1: Basics

**Day 1:**
- [ ] Install app successfully
- [ ] Log in with credentials
- [ ] Navigate all 4 tabs
- [ ] Grant camera permissions
- [ ] Scan 5 different QR codes

**Day 2:**
- [ ] Seed new tray (full workflow)
- [ ] Select correct recipe
- [ ] Enter accurate plant count
- [ ] Add meaningful notes
- [ ] Verify tray appears in inventory

**Day 3:**
- [ ] Place tray in grow room
- [ ] Scan tray and location QR
- [ ] Verify location updates in system
- [ ] Move tray to different spot
- [ ] Update placement again

### Week 2: Intermediate

**Day 4:**
- [ ] Harvest first tray
- [ ] Count plants accurately
- [ ] Weigh harvest crop
- [ ] Record quality observations
- [ ] Verify inventory update

**Day 5:**
- [ ] Use batch harvest mode
- [ ] Scan 3+ trays in batch
- [ ] Enter weights for batch
- [ ] Submit successfully
- [ ] Verify all trays updated

**Day 6:**
- [ ] Check harvest forecast
- [ ] Plan day's harvest list
- [ ] Execute full harvest independently
- [ ] Complete end-of-day review
- [ ] Report any issues

### Week 3: Advanced

**Day 7:**
- [ ] Handle QR code scanning issue
- [ ] Use manual entry backup
- [ ] Report damaged QR code
- [ ] Request replacement code
- [ ] Continue workflow without delay

**Day 8:**
- [ ] Train new staff member
- [ ] Demonstrate full workflow
- [ ] Explain best practices
- [ ] Answer questions
- [ ] Supervise their first scans

**Day 9:**
- [ ] Complete weekly audit
- [ ] Physical count vs system count
- [ ] Location verification
- [ ] Report discrepancies
- [ ] Propose improvements

### Certification

- [ ] Pass written quiz (25 questions)
- [ ] Complete 20 supervised scans
- [ ] Seed 10 trays accurately
- [ ] Place 10 trays correctly
- [ ] Harvest 10 trays with counts
- [ ] Use batch mode successfully
- [ ] Handle 2 troubleshooting scenarios
- [ ] Manager signs off on competency

---

## Quick Reference Card

Print and laminate for scanning station:

```
MOBILE SCANNING - QUICK REFERENCE

APP LOGIN
Farm URL: [Your Farm URL]
Username: [Your Username]
Password: [Your Password]

SEEDING WORKFLOW
1. Scanner tab
2. Scan tray QR
3. Choose "Seed"
4. Select recipe
5. Choose format
6. Set seed date
7. Enter plant count
8. Submit

PLACEMENT WORKFLOW
1. Scanner tab
2. Scan tray QR
3. Choose "Place"
4. Scan location QR
5. Add notes (optional)
6. Submit

HARVEST WORKFLOW
1. Scanner tab
2. Scan tray QR
3. Choose "Harvest"
4. Enter harvest count
5. Enter weight
6. Add quality notes
7. Submit

BATCH HARVEST
1. Enable batch mode toggle
2. Scan multiple trays
3. Enter total weight
4. Add notes
5. "Harvest All"

TROUBLESHOOTING
- Code won't scan? Check lighting, clean code
- Tray not found? Verify farm login
- App crash? Restart app
- Slow response? Close other apps

MANAGER: [Phone Number]
TECH SUPPORT: [Email]
```

---

## Additional Resources

- [QR Code Label Generation Guide](QR_LABEL_GENERATION_GUIDE.md)
- [Tray Inventory System Overview](Coming Soon)
- [Harvest Quality Guidelines](Coming Soon)
- [FDA Traceability & Lot Codes](RECALL_WORKFLOW_TESTING.md)

---

## FAQ

**Q: What if I scan the wrong tray?**  
A: Press back button before submitting. If already submitted, contact manager to reverse.

**Q: Can I scan offline (no internet)?**  
A: Yes! App queues scans and syncs when connection returns.

**Q: What if QR code is damaged?**  
A: Use manual entry or contact manager for replacement code.

**Q: How long does battery last while scanning?**  
A: Full charge = 6-8 hours of active scanning. Bring charger/battery pack for long days.

**Q: Can I use multiple devices?**  
A: Yes, log in on phone and tablet. Data syncs across devices.

**Q: What if I forget to scan before moving tray?**  
A: Return tray to original spot, scan placement, then move again. Or contact manager for manual correction.

**Q: How accurate does harvest count need to be?**  
A: Count actual plants. +/- 2 plants is acceptable. Estimating defeats the purpose.

**Q: Can I edit scan after submitting?**  
A: No, scans are permanent. Contact manager for corrections.

**Q: What's the difference between notes and quality issues?**  
A: Notes are observations. Quality issues require manager attention and may affect sales.

**Q: Why batch mode for harvest but not seeding?**  
A: Harvest is repetitive (same crop, same weight). Seeding varies (different recipes, formats).

---

**Training Complete!** You're ready to use the mobile scanning app for all tray operations. Remember: Accurate data makes everyone's job easier!

**Version:** 1.0  
**Last Updated:** December 31, 2025  
**Next Review:** March 2026