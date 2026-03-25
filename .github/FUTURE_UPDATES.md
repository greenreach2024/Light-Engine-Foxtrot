# Future Updates

Planned features, automation targets, and infrastructure improvements.

---

## Automated Cost Surveys (Floor Price Automation)

**Goal**: Automatically populate the `farm_cost_surveys` table after each harvest so wholesale floor prices are data-driven rather than manually entered.

**Current State**: The `farm_cost_surveys` table and `getMaxFarmCost()` query exist and enforce a 20% margin floor on wholesale pricing. However, the table requires manual data entry via Central Admin. The infrastructure to automate it is largely in place.

### Data Already Collected

| Cost Category | Source | Collection Point |
|--------------|--------|-----------------|
| Energy (kWh) | Kasa smart plugs on lights, HVAC, pumps | Real-time wattage via server-foxtrot.js |
| Energy cost (CAD) | Sustainability metrics endpoint | `/api/sustainability/energy/usage` returns `total_cost_cad` |
| Growth days per crop | Lighting recipes + tray seed-to-harvest tracking | server.js crop growth params |
| PPFD/DLI per crop stage | `COMPAT_DEFAULT_PLANS` in server.js | Seedling, vegetative, finish light levels |
| Yield per harvest | Harvest weight (oz) from Activity Hub tray events | Tray management system |
| Seed and supply inventory | Farm Supplies section in LE-farm-admin | Seed qty, supplier, cost per unit |
| Grow media usage | Tracked per tray in supplies inventory | Supplies tracking |
| Network yield benchmarks | `crop_benchmarks` table | Nightly aggregation job |

### Missing Data

| Cost Category | What Is Needed | Where To Instrument |
|--------------|---------------|-------------------|
| Labor minutes per task | Time-per-task tracking for seeding, maintenance, harvest | Activity Hub (currently records events but not duration) |

### Automation Trigger

Post-harvest hook: when a tray harvest is recorded in the Activity Hub, run cost calculation and insert into `farm_cost_surveys`.

### Cost Calculation Formula

```
Per harvest event:
  grow_days       = harvest_date - seed_date
  energy_cost     = SUM(kasa_kWh[seed_date:harvest_date]) x local_rate / harvest_weight_oz
  seed_cost       = seed_lot_cost_from_inventory / harvest_weight_oz
  media_cost      = grow_media_kg x rate / harvest_weight_oz
  nutrient_cost   = nutrient_usage x price / harvest_weight_oz
  labor_cost      = (labor_minutes / 60) x wage / harvest_weight_oz  [NEEDS INSTRUMENTATION]
  overhead        = facility_allocation / harvest_weight_oz

  cost_per_oz     = energy + seed + media + nutrient + labor + overhead
```

### Target Schema (Already Exists)

```sql
INSERT INTO farm_cost_surveys (farm_id, crop, cost_per_unit, unit, cost_breakdown, survey_date)
VALUES (
  farm_id,
  crop_name,
  cost_per_oz,
  'oz',
  '{"energy_cost": 2.15, "materials_cost": 0.85, "labor_cost": 1.20, "overhead_cost": 0.40}',
  CURRENT_DATE
);
```

The `cost_breakdown` JSONB column provides audit trail. The `getMaxFarmCost()` function already queries this table and enforces `max_cost x 1.20` as the wholesale floor.

### Implementation Phases

1. **Phase 1**: Wire Kasa kWh readings to energy cost per harvest (energy + materials only)
2. **Phase 2**: Add labor time tracking to Activity Hub (start/stop per task)
3. **Phase 3**: Full cost-per-oz auto-calculation on each harvest event
4. **Phase 4**: Dashboard visibility -- show cost breakdown per crop in Farm Admin pricing tab
