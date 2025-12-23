# Farm Supplies & Operations - Inventory Redesign

## Executive Summary

**Current Problem**: "Inventory Management" is confusing - sounds like crop inventory. System requires too many manual inputs that could be calculated automatically from existing data (tray assignments, nutrient dosing logs).

**Solution**: Rename to **"Farm Supplies & Operations"** and automate inventory tracking by integrating with:
1. **Tray data** → Auto-calculate seed & grow media usage
2. **Nutrient dosing logs** → Auto-track nutrient solution depletion
3. **GreenReach Central** → Automated reordering workflow

---

## Current System Analysis

### Existing "Inventory Management" Page
**Location**: `/farm-admin.html` (lines 1165-1300)  
**Backend**: `/backend/inventory_management.py`

**Current Tabs**:
- Seeds (variety, germination rate, expiration tracking)
- Packaging (clamshells, bags, boxes, labels)
- Nutrients (Base A/B, Cal-Mag, pH Up/Down)
- Equipment (maintenance scheduling)
- Supplies (gloves, pH strips, cleaning supplies)

**Problems**:
1. ✗ Manual entry required for all usage tracking
2. ✗ Nutrient usage not integrated with dosing system
3. ✗ Seed/media consumption not calculated from tray assignments
4. ✗ No connection to GreenReach purchasing
5. ✗ Confusing name conflicts with crop inventory

---

## Automated Inventory Calculations

### 1. **Planting Materials → Calculate from Tray Data**

**Data Source**: `backend/seed_tray_formats.py` + `backend/inventory_routes.py`

Each tray format has:
```python
{
    "name": "Microgreen Tray - 12 Hole",
    "plant_site_count": 12,              # Number of planting locations
    "target_weight_per_site": 2.5,       # oz per hole
    "is_weight_based": True,
    "system_type": "soil"
}
```

**Automated Calculation Logic**:

#### **Seeds**:
```python
# When tray is seeded via QR scan:
def calculate_seed_usage(tray_run):
    """Auto-deduct seeds from inventory when tray is planted"""
    
    # Get tray format
    format = get_tray_format(tray_run.tray_format_id)
    
    # Get crop seeding rate (seeds per planting site)
    recipe = get_recipe(tray_run.recipe_id)
    seeds_per_site = recipe.get("seeds_per_site", 1)  # e.g., lettuce = 1 seed/site
    
    # Calculate total seeds used
    total_seeds = format.plant_site_count * seeds_per_site
    
    # Deduct from seed inventory
    deduct_seed_inventory(
        variety=recipe.name,
        quantity=total_seeds,
        tray_id=tray_run.tray_id,
        timestamp=tray_run.seed_date
    )
    
    return {
        "seeds_used": total_seeds,
        "tray_format": format.name,
        "planting_sites": format.plant_site_count
    }
```

#### **Grow Media**:
```python
def calculate_media_usage(tray_run):
    """Auto-calculate grow media consumption based on tray format"""
    
    format = get_tray_format(tray_run.tray_format_id)
    
    # Media requirements per tray type
    MEDIA_REQUIREMENTS = {
        "Microgreen Tray - 4 Hole": 1.5,   # kg per tray
        "Microgreen Tray - 8 Hole": 1.2,
        "Microgreen Tray - 12 Hole": 1.0,
        "Microgreen Tray - 21 Hole": 0.8,
        "NFT Channel - 128 Site": 0.0,      # Hydro - no media
        "ZipGrow Tower": 2.5                 # kg per tower
    }
    
    media_kg = MEDIA_REQUIREMENTS.get(format.name, 1.0)
    
    # Deduct from grow media inventory
    if media_kg > 0:
        deduct_supply_inventory(
            supply_name="Grow Media (Coco Coir Mix)",
            quantity=media_kg,
            unit="kg",
            tray_id=tray_run.tray_id
        )
    
    return {
        "media_used_kg": media_kg,
        "tray_format": format.name
    }
```

**Integration Point**: Trigger calculations when scanning QR code during seeding workflow.

---

### 2. **Nutrients → Track from Dosing Logs**

**Data Source**: `backend/nutrient/mqtt_commands.py` + `backend/sustainability_esg.py`

**Current System**: ESP32 publishes MQTT messages when dosing nutrients:
```json
{
    "pump": "nutrientA",
    "ml": 150.0,
    "timestamp": 1703351234567
}
```

**Automated Deduction Logic**:
```python
def track_nutrient_usage_from_dosing(mqtt_message):
    """Listen to MQTT dosing commands and auto-deduct from inventory"""
    
    pump = mqtt_message["pump"]
    ml_used = mqtt_message["ml"]
    timestamp = mqtt_message["timestamp"]
    
    # Map pump to inventory item
    PUMP_TO_INVENTORY = {
        "nutrientA": "NUT-BASE-A",
        "nutrientB": "NUT-BASE-B",
        "phUp": "NUT-PH-UP",
        "phDown": "NUT-PH-DOWN"
    }
    
    nutrient_id = PUMP_TO_INVENTORY.get(pump)
    
    if nutrient_id:
        # Get current inventory
        nutrient = get_nutrient_by_id(nutrient_id)
        
        # Deduct used volume
        nutrient.volume_remaining_ml -= ml_used
        
        # Check if concentrate needs dilution calculation
        if nutrient.concentration:  # e.g., "1:100" = 1 part concentrate : 100 parts water
            concentrate_ratio = parse_concentration(nutrient.concentration)
            concentrate_used = ml_used / concentrate_ratio
            nutrient.concentrate_remaining_ml -= concentrate_used
        
        # Save update
        update_nutrient_inventory(nutrient)
        
        # Create usage log entry
        log_nutrient_usage(
            nutrient_id=nutrient_id,
            volume_used_ml=ml_used,
            concentrate_used_ml=concentrate_used,
            timestamp=timestamp,
            source="mqtt_dosing"
        )
        
    return {
        "nutrient": pump,
        "volume_ml": ml_used,
        "remaining_ml": nutrient.volume_remaining_ml
    }
```

**Implementation**:
1. Add MQTT subscriber to `server-foxtrot.js`
2. Subscribe to `sensors/nutrient/command/dose` topic
3. Call inventory API to deduct volumes automatically
4. Display real-time usage in nutrient management page

---

### 3. **Packaging → Calculate from Harvest Events**

```python
def calculate_packaging_usage_from_harvest(harvest_event):
    """Auto-deduct packaging when crop is harvested"""
    
    crop_name = harvest_event.crop_name
    harvest_count = harvest_event.harvested_count  # Number of units
    
    # Get default packaging for this crop
    packaging_map = {
        "Butterhead Lettuce": "CLAM-16OZ",      # 16oz clamshell
        "Arugula": "BAG-5OZ",                    # 5oz salad bag
        "Basil": "CLAM-4OZ",                     # 4oz herb clamshell
        "Microgreens": "TRAY-2LB"                # 2lb harvest tray
    }
    
    packaging_sku = packaging_map.get(crop_name)
    
    if packaging_sku:
        deduct_packaging_inventory(
            packaging_id=packaging_sku,
            quantity=harvest_count,
            lot_code=harvest_event.lot_code
        )
    
    return {
        "packaging_used": harvest_count,
        "packaging_type": packaging_sku
    }
```

---

## Proposed New Structure

### **Rename: "Farm Supplies & Operations"**

**New Organization**:

```
┌─────────────────────────────────────────────┐
│  Farm Supplies & Operations Dashboard       │
├─────────────────────────────────────────────┤
│  Summary Cards:                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ Seeds    │ │ Nutrients │ │ Grow     │   │
│  │ 12 vars  │ │ 85% full  │ │ Media    │   │
│  │ 3 expiring│ │ ⚠ Reorder│ │ 45kg left│   │
│  └──────────┘ └──────────┘ └──────────┘   │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Tabs:                                       │
│  [Planting Materials] [Nutrients] [Packaging]│
│  [Equipment] [Lab Supplies] [Orders]        │
└─────────────────────────────────────────────┘
```

### **Tab 1: Planting Materials**
**Auto-calculated from tray assignments**

| Crop Variety | Seeds Remaining | Used This Week | Media (kg) | Reorder Status |
|-------------|----------------|----------------|-----------|---------------|
| Butterhead Lettuce | 850 seeds | 384 ↓ (32 trays) | 38.4kg ↓ |  Good |
| Arugula | 1,200 seeds | 512 ↓ (43 trays) | 51.2kg ↓ |  Order Soon |
| Basil | 345 seeds | 144 ↓ (12 trays) | 14.4kg ↓ |  Low Stock |

**Data Source**: Tray seeding events from Activity Hub QR scans

**Calculation Display**:
```
Last 7 Days Usage:
• 75 trays seeded = 900 seeds + 90kg grow media
• Projected 30-day usage: 3,857 seeds + 385kg media
• Reorder recommendation: 5,000 seeds, 400kg media
```

---

### **Tab 2: Nutrients**
**Auto-tracked from dosing logs**

| Nutrient Solution | Concentrate Remaining | Diluted Volume | Used This Week | Days Until Empty | Reorder |
|------------------|----------------------|----------------|---------------|----------------|---------|
| Base A (1:100) | 2.8L | 280L available | 45L ↓ | 18 days |  |
| Base B (1:100) | 2.3L | 230L available | 42L ↓ | 15 days |  Order |
| pH Down | 850ml | N/A | 125ml ↓ | 22 days |  |
| Cal-Mag | 1.2L | 120L available | 18L ↓ | 20 days |  |

**Real-time Integration**:
```javascript
// Subscribe to MQTT dosing events
mqtt.subscribe('sensors/nutrient/command/dose', (message) => {
    const {pump, ml} = JSON.parse(message);
    
    // Update UI immediately
    updateNutrientDisplay(pump, ml);
    
    // Save to inventory log
    recordNutrientUsage(pump, ml);
});
```

**Visual Display**:
- Progress bars showing % remaining
- Daily usage chart (line graph)
- "Days until empty" countdown
- Auto-generate reorder alert at 20% remaining

---

### **Tab 3: Packaging**
**Auto-deducted from harvest events**

| Packaging Type | Quantity | Used This Week | Reorder Point | Status |
|---------------|----------|----------------|---------------|--------|
| 16oz Clamshell | 850 | 124 ↓ | 200 |  Good |
| 5oz Salad Bag | 1,200 | 89 ↓ | 300 |  Good |
| 4oz Herb Clam | 345 | 67 ↓ | 100 |  Order |
| Lot Code Labels (roll) | 3 rolls | 0.3 roll ↓ | 1 roll |  Good |

**Linked to Harvest Workflow**:
- When grower scans harvest QR code
- System automatically deducts packaging based on crop type
- Updates inventory in real-time

---

### **Tab 4: Equipment**
*(Keep existing maintenance tracking - no changes)*

---

### **Tab 5: Lab Supplies**
*(Keep existing reorder alerts - no changes)*

---

### **Tab 6: Orders (NEW)**
**GreenReach Central Integration**

```
┌──────────────────────────────────────────────┐
│  Active Reorder Alerts                        │
├──────────────────────────────────────────────┤
│   Arugula Seeds - 345 remaining (order 5kg) │
│   Base B Nutrients - 15 days left (order 5L)│
│   4oz Clamshells - 345 remaining (order 1k) │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│  [ Create GreenReach Order]                 │
│                                               │
│  Auto-populated cart:                         │
│  ☑ Arugula Seeds (5kg) - $145               │
│  ☑ Base B Concentrate (5L) - $89            │
│  ☑ 4oz Clamshells (1,000) - $125            │
│                                               │
│  Subtotal: $359                              │
│  Estimated Delivery: 2-3 business days       │
│                                               │
│  [ Submit Order to GreenReach Central]     │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│  Recent Orders                                │
│  #GR-2025-001234  Dec 20  $412   Delivered │
│  #GR-2025-001189  Dec 15  $267   Delivered │
│  #GR-2025-001156  Dec 10  $534   Delivered │
└──────────────────────────────────────────────┘
```

---

## GreenReach Central Purchasing Integration

### **Automated Reorder Workflow**

```javascript
// Backend API: /api/farm-supplies/greenreach-order

async function createGreenReachOrder() {
    // 1. Get all items below reorder threshold
    const reorderItems = await getReorderAlerts();
    
    // 2. Map internal SKUs to GreenReach catalog
    const orderItems = reorderItems.map(item => ({
        greenreach_sku: mapToGreenReachSKU(item.internal_sku),
        quantity: item.recommended_reorder_quantity,
        farm_id: getFarmId()
    }));
    
    // 3. Submit order to GreenReach Central
    const response = await fetch('https://central.greenreach.farm/api/supply-orders/create', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${getGreenReachToken()}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            farm_id: getFarmId(),
            items: orderItems,
            delivery_address: getFarmAddress(),
            payment_method: 'farm_account',  // Billed to farm account
            notes: 'Auto-generated reorder from Light Engine'
        })
    });
    
    const order = await response.json();
    
    // 4. Save order reference locally
    await saveOrderReference({
        greenreach_order_id: order.order_id,
        order_date: new Date().toISOString(),
        status: 'pending',
        items: orderItems,
        total: order.total
    });
    
    // 5. Track delivery
    pollOrderStatus(order.order_id);
}
```

### **GreenReach Supply Catalog**

**Products Available for Automated Ordering**:
1. **Seeds** (all varieties stocked by GreenReach)
2. **Grow Media** (coco coir, peat moss, perlite)
3. **Nutrient Concentrates** (Base A/B, Cal-Mag, pH adjusters)
4. **Packaging** (clamshells, bags, labels, tape)
5. **Lab Supplies** (pH strips, EC meters, gloves)

**Pricing**:
- Farm-direct wholesale pricing
- Volume discounts automatically applied
- Subscription pricing for recurring orders

**Delivery**:
- 2-3 business day shipping
- Order tracking via GreenReach portal
- Email/SMS notifications on delivery

---

## Implementation Plan

### **Phase 1: Rename & Reorganize** (1-2 days)
1.  Rename "Inventory Management" → "Farm Supplies & Operations"
2.  Update navigation labels in farm-admin.html
3.  Reorganize tab structure (Planting Materials, Nutrients, Packaging)
4.  Update all internal references

### **Phase 2: Automated Calculations** (3-5 days)
1.  Create seed/media calculation from tray data
   - Hook into QR scan seeding workflow
   - Auto-deduct inventory on tray assignment
2.  Create nutrient tracking from dosing logs
   - Subscribe to MQTT dosing topics
   - Real-time inventory updates
3.  Create packaging deduction from harvest events
   - Hook into harvest QR scan workflow
   - Map crops to packaging types

### **Phase 3: GreenReach Integration** (5-7 days)
1.  Create GreenReach order API endpoint
2.  Build SKU mapping (internal → GreenReach catalog)
3.  Implement order submission workflow
4.  Add order tracking and status updates
5.  Build "Orders" tab in UI
6.  Test end-to-end automated reordering

### **Phase 4: Smart Reorder Logic** (3-4 days)
1.  Forecasting based on historical usage
2.  Seasonal adjustment (summer vs winter growth rates)
3.  Smart suggestions: "Based on 75 trays/week, order 5kg seeds"
4.  One-click reorder approval

---

## Benefits

### **For Farm Operators**:
 **90% reduction in manual data entry**
- Seeds/media auto-calculated from tray scans
- Nutrients auto-tracked from dosing system
- Packaging auto-deducted from harvests

 **Real-time inventory accuracy**
- Live updates from operational data
- No more spreadsheet reconciliation
- Always know what you have

 **Proactive reordering**
- Never run out of critical supplies
- Auto-generated purchase recommendations
- One-click ordering via GreenReach

### **For GreenReach Central**:
 **Predictable farm purchasing patterns**
- Data-driven supply forecasting
- Optimize inventory at central warehouse
- Better volume discounts

 **Recurring revenue stream**
- Automated farm reordering
- Subscription-based supply delivery
- Central marketplace for all farm inputs

 **Network effects**
- Aggregate purchasing across farms
- Better supplier negotiations
- Shared logistics optimization

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      OPERATIONAL DATA                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  [Tray QR Scans] ──→ Calculate Seeds/Media ──→ Deduct       │
│       ↓                                                       │
│  [Activity Hub]                                              │
│                                                               │
│  [MQTT Dosing] ──→ Track Nutrient Volume ──→ Deduct         │
│       ↓                                                       │
│  [ESP32 Controller]                                          │
│                                                               │
│  [Harvest Scans] ──→ Calculate Packaging ──→ Deduct         │
│       ↓                                                       │
│  [Lot Traceability]                                          │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│               FARM SUPPLIES & OPERATIONS                      │
│                   (Automated Inventory)                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  • Seeds: 850 remaining (-384 this week from 32 trays)      │
│  • Media: 45kg left (-38kg from seeding)                     │
│  • Nutrients: Base A 280L available (-45L from dosing)       │
│  • Packaging: 850 clamshells (-124 from harvests)           │
│                                                               │
│   REORDER ALERTS:                                          │
│  • Arugula seeds (345 left - order 5kg)                     │
│  • Base B nutrients (15 days left - order 5L)               │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│              GREENREACH CENTRAL ORDERING                      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  [Auto-Generate Order]                                       │
│  ☑ Arugula Seeds 5kg - $145                                 │
│  ☑ Base B Concentrate 5L - $89                              │
│                                                               │
│  [Submit Order] ──→ GreenReach Supply Chain                 │
│                 ──→ 2-3 Day Delivery                        │
│                 ──→ Auto-update inventory on receipt         │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Next Steps

**Decision Required**:
1.  Approve rename: "Inventory Management" → "Farm Supplies & Operations"
2.  Approve automated calculations from tray/nutrient data
3.  Approve GreenReach Central purchasing integration

**Let me know if you'd like me to**:
- Start implementation immediately
- Create mockup UI screens first
- Build GreenReach order API specs
- Prototype the automated calculations

This redesign will transform inventory from a manual chore into an automated, data-driven system that works for you, not the other way around.
