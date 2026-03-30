# Farm Admin Dashboard - Visual Navigation Map

## 🗺️ Page Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      FARM ADMIN DASHBOARD                               │
│                    (Page Header with 4 Dropdowns)                       │
├─────────────────────────────────────────────────────────────────────────┤
│  SIDEBAR                │  MAIN CONTENT AREA (4,500 lines)              │
│  (250px width)          │                                               │
│                         │  Section ID: section-{name}                   │
│  ┌─────────────────┐   │  Visibility: toggled via data-section          │
│  │  PRO PLAN ⭐    │   │  JavaScript handlers                            │
│  └─────────────────┘   │                                               │
│                         │  ┌──────────────────────────────────────┐     │
│  Farm Operations (5)    │  │ DASHBOARD (Default View)             │     │
│  ├─ Dashboard ✓         │  ├─ Welcome Alert                       │     │
│  ├─ Dashboard Setup     │  ├─ KPI Grid (4 cards)                 │     │
│  ├─ Activity Hub        │  ├─ Quick Actions (6 cards)            │     │
│  ├─ Farm Summary        │  └─ Recent Activity Table              │     │
│  └─ Inventory           │  └──────────────────────────────────────┘     │
│                         │                                               │
│  Enterprise ERP (5)     │  ┌──────────────────────────────────────┐     │
│  ├─ Farm Supplies       │  │ INVENTORY MANAGEMENT                 │     │
│  ├─ Sustainability      │  ├─ 4 Stat Cards (alerts, value)       │     │
│  ├─ Traceability        │  ├─ 5 Tab Buttons                      │     │
│  ├─ Production Planning │  │  ├─ Planting Materials (table)      │     │
│  └─ Quality Control     │  │  ├─ Nutrients (table)               │     │
│                         │  │  ├─ Packaging (table)               │     │
│  Wholesale (1)          │  │  ├─ Equipment (table)               │     │
│  └─ Wholesale Orders    │  │  └─ Lab Supplies (table)            │     │
│                         │  ├─ Reorder Alerts Card               │     │
│  Administration (7)     │  └──────────────────────────────────────┘     │
│  ├─ Financial Summary   │                                               │
│  ├─ Exports             │  ┌──────────────────────────────────────┐     │
│  ├─ Payment Methods     │  │ SUSTAINABILITY & ESG                 │     │
│  ├─ Crop Pricing        │  ├─ ESG Score Card (main + 5 metrics) │     │
│  ├─ Crop Value          │  ├─ Export ESG Report button          │     │
│  ├─ Users & Access      │  └──────────────────────────────────────┘     │
│  └─ Settings            │                                               │
│                         │  ┌──────────────────────────────────────┐     │
│  Support (2)            │  │ TRACEABILITY SYSTEM                  │     │
│  ├─ Help & Docs         │  ├─ 4 Stat Cards (batches, events)    │     │
│  └─ Contact Support     │  ├─ + New Batch button (→ modal)      │     │
│                         │  ├─ Batch List Table                   │     │
│  [LOGOUT BUTTON]        │  │  └─ View → Batch Detail Modal      │     │
│                         │  └──────────────────────────────────────┘     │
│                         │                                               │
│                         │  ┌──────────────────────────────────────┐     │
│                         │  │ PRODUCTION PLANNING                  │     │
│                         │  ├─ Generate Schedule button           │     │
│                         │  ├─ + New Production Plan button       │     │
│                         │  ├─ AI Recommendations Card           │     │
│                         │  └─ Production Plans List              │     │
│                         │  └──────────────────────────────────────┘     │
│                         │                                               │
│                         │  ┌──────────────────────────────────────┐     │
│                         │  │ FINANCIAL SUMMARY                    │     │
│                         │  ├─ Period Selector (today/week/month) │     │
│                         │  ├─ 4 Financial Cards (revenue/exp)    │     │
│                         │  ├─ Operations Summary Grid            │     │
│                         │  ├─ Revenue Breakdown Table           │     │
│                         │  ├─ Expense Breakdown Table           │     │
│                         │  ├─ Export Report & Print buttons     │     │
│                         │  └──────────────────────────────────────┘     │
│                         │                                               │
│                         │  ┌──────────────────────────────────────┐     │
│                         │  │ DATA EXPORTS                         │     │
│                         │  ├─ Inventory Export Card             │     │
│                         │  ├─ Sales Export Card                 │     │
│                         │  ├─ QuickBooks Export Card            │     │
│                         │  └─ Export Tips Grid                   │     │
│                         │  └──────────────────────────────────────┘     │
│                         │                                               │
│                         │  ┌──────────────────────────────────────┐     │
│                         │  │ PAYMENT METHODS & RECEIPTS           │     │
│                         │  ├─ Square Connection Status           │     │
│                         │  ├─ Connected Payment Methods          │     │
│                         │  ├─ Receipt Filter & Receipts Table    │     │
│                         │  └──────────────────────────────────────┘     │
│                         │                                               │
│                         │  ┌──────────────────────────────────────┐     │
│                         │  │ QUALITY CONTROL                      │     │
│                         │  ├─ 4 Metric Cards (pass rate, tests)  │     │
│                         │  ├─ 4 Test Category Cards             │     │
│                         │  ├─ Quality Tests Table               │     │
│                         │  ├─ Quality Standards Card            │     │
│                         │  └─ + New Test button (→ modal)       │     │
│                         │  └──────────────────────────────────────┘     │
└─────────────────────────┴─────────────────────────────────────────────────┘
```

---

## 🔗 Navigation Flow Diagram

### Header Dropdowns (4 Menus)

```
┌─ Inventory Management (Amber #f59e0b)
│  ├─ Planting Scheduler
│  ├─ Tray Setup
│  ├─ Farm Inventory
│  └─ Activity Hub
│
├─ Farm Monitoring (Green #10b981)
│  ├─ Farm Summary
│  ├─ Nutrient Management
│  └─ Room Heat Map
│
├─ Admin (Purple #8b5cf6)
│  ├─ Farm Admin (CURRENT)
│  └─ Dashboard Setup
│
└─ Sales (Cyan #06b6d4)
   ├─ POS
   └─ Wholesale Orders
```

### Sidebar Navigation (24 Items in 5 Sections)

```
Farm Operations
├─ Dashboard (data-section="dashboard")
├─ Dashboard Setup (external)
├─ Activity Hub (external)
├─ Farm Summary
└─ Inventory

Enterprise ERP
├─ Farm Supplies & Operations (data-section="farm-supplies")
├─ Sustainability & ESG (data-section="sustainability")
├─ Traceability (data-section="traceability")
├─ Production Planning (data-section="planning")
└─ Quality Control (data-section="quality")

Wholesale
└─ Wholesale Orders (data-section="wholesale-orders")

Administration
├─ Financial Summary (data-section="accounting")
├─ Exports (data-section="exports")
├─ Payment Methods (data-section="payments")
├─ Crop Pricing (data-section="pricing")
├─ Crop Value (data-section="crop-value")
├─ Users & Access (data-section="users")
└─ Settings (data-section="settings")

Support
├─ Help & Docs (data-section="help")
└─ Contact Support (mailto: support@lightengine.io)
```

---

## 🎯 Button Action Map

### Quick Actions Card (Dashboard)

```
┌─────────────────────────────────────────────────────────────┐
│                    QUICK ACTIONS (6 Cards)                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │   View      │  │  Financial   │  │  Crop Pricing ⭐ │   │
│  │   Farm      │  │  Summary     │  │                  │   │
│  │             │  │              │  │ (Highlighted)    │   │
│  └─────────────┘  └──────────────┘  └──────────────────┘   │
│                                                              │
│  ┌──────────────────┐  ┌────────────────┐  ┌────────────┐   │
│  │  Crop Value ⭐  │  │  AI Pricing ⭐ │  │  Manage    │   │
│  │                 │  │  Assistant     │  │  Users     │   │
│  │ (Highlighted)   │  │ (Highlighted)  │  │            │   │
│  └──────────────────┘  └────────────────┘  └────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Inventory Tab System

```
┌─ PLANTING MATERIALS ────┐
│ + Add Seed              │
│ ┌─────────────────────┐ │
│ │ Seed List Table     │ │
│ │ (seeds inventory)   │ │
│ └─────────────────────┘ │
└─────────────────────────┘

┌─ NUTRIENTS ─────────────┐
│ Record Usage            │
│ ┌─────────────────────┐ │
│ │ Nutrients Table     │ │
│ │ (nutrient stock)    │ │
│ └─────────────────────┘ │
└─────────────────────────┘

┌─ PACKAGING ─────────────┐
│ + Add Packaging         │
│ ┌─────────────────────┐ │
│ │ Packaging Table     │ │
│ │ (packaging stock)   │ │
│ └─────────────────────┘ │
└─────────────────────────┘

┌─ EQUIPMENT ─────────────┐
│ Log Maintenance         │
│ ┌─────────────────────┐ │
│ │ Equipment Table     │ │
│ │ (equipment records) │ │
│ └─────────────────────┘ │
└─────────────────────────┘

┌─ LAB SUPPLIES ──────────┐
│ Record Usage            │
│ ┌─────────────────────┐ │
│ │ Supplies Table      │ │
│ │ (lab supplies)      │ │
│ └─────────────────────┘ │
└─────────────────────────┘
```

---

## 🎭 Modal Dialog Map

### Modal 1: Batch Detail
```
┌─────────────────────────────────────────────┐
│ Batch {ID}  [X]                             │
├─────────────────────────────────────────────┤
│                                             │
│ BATCH INFORMATION (2-column grid)           │
│ ├─ Batch ID: {id}                          │
│ ├─ Crop: {crop} (variety)                  │
│ ├─ Seed Source: {source}                   │
│ ├─ Quantity: {qty}                         │
│ ├─ Location: {location}                    │
│ └─ Status: {status}                        │
│                                             │
│ LIFECYCLE TIMELINE ({N} events)             │
│ ├─ EVENT 1: timestamp, location, notes     │
│ ├─ EVENT 2: timestamp, location, notes     │
│ └─ ...                                      │
│                                             │
│ SALES ({N} records) [if exists]            │
│ ├─ Sale 1: buyer, amount, quantity         │
│ └─ ...                                      │
│                                             │
├─────────────────────────────────────────────┤
│ [Generate Report]  [Record Event]           │
└─────────────────────────────────────────────┘
```

### Modal 2: New Batch
```
┌─────────────────────────────────────────────┐
│ Create Batch        [X]                     │
├─────────────────────────────────────────────┤
│                                             │
│ Crop:              [dropdown/text]          │
│ Variety:           [text]                   │
│ Seed Source:       [text]                   │
│ Quantity:          [number]                 │
│ Location:          [dropdown]               │
│ Expected Harvest:  [date]                   │
│ Notes:             [textarea]               │
│                                             │
├─────────────────────────────────────────────┤
│ [Cancel]           [Create Batch]           │
└─────────────────────────────────────────────┘
```

### Modal 3: New Production Plan
```
┌─────────────────────────────────────────────┐
│ Create Production Plan   [X]                │
├─────────────────────────────────────────────┤
│                                             │
│ [Plan form fields]                         │
│ (structure varies by implementation)       │
│                                             │
├─────────────────────────────────────────────┤
│ [Cancel]           [Create Plan]            │
└─────────────────────────────────────────────┘
```

---

## 📊 Content Section Overview

### Section-by-Section Breakdown

```
1. DASHBOARD (Default)
   └─ 4 KPI Cards + 6 Quick Actions + Activity Table
   
2. INVENTORY MANAGEMENT
   ├─ 4 Stat Cards
   ├─ 5 Tab Buttons
   ├─ 5 Tabbed Tables
   └─ Reorder Alerts Card
   
3. SUSTAINABILITY & ESG
   ├─ ESG Score Card
   └─ 5 Sub-Metrics
   
4. TRACEABILITY
   ├─ 4 Stat Cards
   ├─ + New Batch Button
   ├─ Batch List Table
   ├─ Batch Detail Modal
   └─ New Batch Modal
   
5. PRODUCTION PLANNING
   ├─ Generate Schedule Button
   ├─ + New Plan Button
   ├─ AI Recommendations Card
   └─ Plans List
   
6. FINANCIAL SUMMARY
   ├─ Period Selector
   ├─ 4 Financial Cards
   ├─ Operations Summary Grid
   ├─ Revenue Breakdown Table
   └─ Expense Breakdown Table
   
7. DATA EXPORTS
   ├─ Inventory Export Card
   ├─ Sales Export Card
   ├─ QuickBooks Export Card
   └─ Export Tips Grid
   
8. PAYMENT METHODS
   ├─ Square Status Display
   ├─ Payment Methods List
   └─ Receipts Table
   
9. QUALITY CONTROL
   ├─ 4 Metric Cards
   ├─ 4 Test Category Cards
   ├─ Quality Tests Table
   └─ Quality Standards Card
```

---

## 🔴 Critical Issues Location Map

```
ISSUE #1: Incomplete Function (HIGH)
├─ Function: recordEvent()
├─ Location: JavaScript section ~line 3957
├─ Current State: Shows alert only
└─ Impact: Batch event recording non-functional

ISSUE #2: Label Error (HIGH)
├─ Location: Line 1227 in Inventory section
├─ Current: "Packaging Materials" header
├─ Expected: "Nutrient Solutions"
└─ Impact: User confusion in Nutrients tab

ISSUE #3: Missing Validation (HIGH)
├─ Location: All form inputs
├─ Missing: HTML5 validation attributes
├─ Impact: Invalid data can be submitted
└─ Examples: No required, min, max, pattern attrs

ISSUE #4: Error Handling (MEDIUM)
├─ Location: API fetch calls (various)
├─ Current: Inconsistent error handling
└─ Impact: User-unfriendly error messages

ISSUE #5: Modal Management (MEDIUM)
├─ Location: All 3 modals
├─ Current: Inline style="display: none"
└─ Impact: No CSS-based state management

ISSUE #6: Code Organization (MEDIUM)
├─ Location: JavaScript scattered across blocks
├─ Current: No clear module structure
└─ Impact: Difficult to maintain
```

---

## 📋 Button Count Summary

```
NAVIGATION BUTTONS
├─ Header Dropdowns: 4 menus (8 items total)
├─ Sidebar Nav Items: 24 items (across 5 sections)
└─ Total: 32 navigation buttons

ACTION/FEATURE BUTTONS
├─ Dashboard: 1 Refresh
├─ Quick Actions: 6 cards
├─ Inventory: 5 add/record/log buttons
├─ Traceability: 1 New Batch, + View buttons
├─ Production: 3 buttons (Schedule, New Plan, Apply)
├─ Financial: 2 buttons (Export, Print)
├─ Exports: 3 download buttons
├─ Payments: 2 buttons (Refresh, Download)
├─ Quality: 2 buttons (New Test, Export)
└─ Total: 25+ action buttons

MODAL BUTTONS
├─ Open: 3 (New Batch, New Plan, New Test)
├─ Close: 6 (3 X buttons, 3 Cancel buttons)
├─ Submit: 3 (Create Batch, Create Plan, New Test)
└─ Total: 12 modal buttons

TAB/FILTER BUTTONS
├─ Inventory Tabs: 5 tabs
├─ Filter Dropdowns: 5+ dropdown selectors
└─ Total: 10+ tab/filter buttons

GRAND TOTAL: 80+ interactive buttons & controls
```

---

## 🎓 How to Use This Map

### For Navigation Testing
→ Use the "Navigation Flow Diagram" section to verify all links

### For Button Testing
→ Use the "Button Action Map" and "Button Count Summary" to validate handlers

### For Modal Testing
→ Use the "Modal Dialog Map" to test open/close/submit flows

### For Content Verification
→ Use the "Content Section Overview" to verify all sections load

### For Issue Tracking
→ Use the "Critical Issues Location Map" to find and fix problems

---

**Document Purpose:** Quick visual reference for implementation details  
**Best Used With:** The comprehensive analysis documents  
**Last Updated:** February 2025
