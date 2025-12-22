# Farm Selection & Logistics Optimization

## Overview

The wholesale ordering system uses intelligent algorithms to select supplier farms based on **multiple factors** including product availability, certifications, distance, and **route efficiency**. The goal is to minimize courier driving while ensuring buyers get high-quality products from certified farms.

## The Problem

When a wholesale buyer orders multiple products from different farms, naive selection can lead to:
- Couriers driving all over Ontario to pickup orders
- Farm A selected because it's 5km closer, but in opposite direction from Farm B
- Isolated farms requiring separate trips
- Inefficient routes increasing costs and delivery time

## The Solution: Multi-Factor Optimization

### Algorithm Overview

```
1. Filter farms by product availability and certifications
2. Apply radius restrictions (max 150km by default)
3. Identify geographic clusters (farms within 25km of each other)
4. Score each farm on 6 factors with weighted ranking
5. Prefer clustered farms over isolated farms
6. Generate optimal farm combinations for order fulfillment
```

### Scoring Factors

Each farm receives a score (0-100) based on these weighted factors:

| Factor | Weight | Description |
|--------|--------|-------------|
| **Product Match** | 30% | Has all requested products in stock |
| **Certifications** | 20% | Meets filter requirements (organic, local, etc.) |
| **Distance** | 20% | Proximity to buyer location |
| **Clustering** | 15% | Groups well with other selected farms |
| **Quality** | 10% | Farm quality score from performance tracking |
| **Price** | 5% | Price competitiveness vs market average |

### Geographic Clustering

Farms are grouped into clusters based on:
- **Distance**: Within 25km of each other (configurable)
- **Direction**: Similar bearing from buyer (within 45°)
- **Cluster Size**: Minimum 2 farms to be considered efficient

**Example:**
```
Buyer in Kingston, ON (44.23°N, 76.49°W)

Cluster 1 (Northwest - 85km, 3 farms):
  - Farm A: Organic vegetables, 82km
  - Farm B: Fruits, 85km  
  - Farm C: Herbs, 88km
  → Single pickup route, ~30 min extra driving

Isolated Farm D (East - 65km):
  - Closer but requires separate trip
  → Gets penalty for isolation
```

### Route Efficiency Logic

The optimizer applies these rules:

**Clustered Farms Get Bonuses:**
- Cluster bonus: +25 points
- Direction bonus: +15 points (same direction as others)
- Efficiency multiplier: 1.2x for large clusters (4+ farms)

**Isolated Farms Get Penalties:**
- Isolated farm penalty: -20 points
- Opposite direction penalty: -30 points
- Requires separate trip: Lower priority

**Smart Trade-offs:**
```
SCENARIO: Farm X is 65km (closer) but isolated
          Farm Y is 85km (farther) but in cluster with 2 others

DECISION: Select Farm Y
REASON:   3 farms in one direction > 1 farm alone
          Total route: ~85km vs 65km + 85km = 150km
```

## Configuration

### Default Configuration

```javascript
{
  // Radius restrictions (km)
  maxRadius: 150,           // Absolute maximum distance
  preferredRadius: 75,      // Bonus for being within this
  clusterRadius: 25,        // Farms within this = clustered
  
  // Scoring weights (sum = 100)
  weights: {
    productMatch: 30,       // Has products
    certifications: 20,     // Meets filters
    distance: 20,           // Proximity
    clustering: 15,         // Route efficiency
    quality: 10,            // Farm quality
    price: 5                // Pricing
  },
  
  // Bonuses and penalties
  clusterBonus: 25,         // For being in cluster
  directionBonus: 15,       // Same direction as others
  isolatedFarmPenalty: 20,  // Requires separate trip
  oppositeDirectionPenalty: 30  // Wrong direction
}
```

### Preset Configurations

Choose a preset based on your priorities:

**1. Balanced (Default)**
- Equal weight to quality, logistics, and distance
- Best for most situations
- `maxRadius: 150km, preferredRadius: 75km`

**2. Efficiency Focused**
- Maximize route clustering
- Prioritize grouped farms over isolated
- `clustering: 30%, maxRadius: 100km`

**3. Quality Focused**
- Prioritize certifications and farm quality
- Allow longer distances for better farms
- `certifications: 30%, quality: 15%, maxRadius: 200km`

**4. Local First**
- Maximize locality, minimize distance
- Strict radius restrictions
- `distance: 35%, maxRadius: 75km`

**5. Budget Conscious**
- Balance price with logistics
- Accept slightly farther farms if cheaper
- `price: 20%, clustering: 15%`

### Adjusting Configuration

**Via API:**
```bash
# Get current config
GET /api/logistics/config

# Update specific parameters
POST /api/logistics/config
{
  "maxRadius": 120,
  "weights": {
    "clustering": 25  // Increase clustering importance
  }
}

# Apply preset
POST /api/logistics/config/apply-preset
{
  "preset": "efficiency_focused"
}

# Reset to defaults
POST /api/logistics/config/reset
```

**Via Admin Dashboard:**
Navigate to: **Settings > Logistics Configuration**

## How It Works: Step-by-Step

### Step 1: Initial Filtering

```sql
-- Find farms with required products
SELECT * FROM farms f
JOIN farm_inventory i ON f.farm_id = i.farm_id
WHERE i.product_id IN (buyer_requested_products)
  AND i.available_quantity >= requested_quantity
  AND f.is_active = true
  AND f.wholesale_enabled = true

-- Apply certification filters
WHERE f.certifications CONTAINS 'organic'  -- if buyer wants organic
  AND f.certifications CONTAINS 'locally_grown'  -- if buyer wants local
```

Result: 15 candidate farms

### Step 2: Radius Filtering

```javascript
farms.filter(farm => {
  const distance = calculateDistance(buyer.lat, buyer.lng, farm.lat, farm.lng);
  return distance <= maxRadius; // 150km
});
```

Result: 8 farms within radius

### Step 3: Cluster Identification

```javascript
// Group farms by proximity and direction
for (const farm of farms) {
  const bearing = calculateBearing(buyer, farm); // 0-360°
  
  // Find nearby farms in similar direction (±45°)
  const nearbyFarms = farms.filter(other => 
    distance(farm, other) <= clusterRadius &&  // 25km
    Math.abs(bearing - bearingTo(other)) <= 45  // Same direction
  );
  
  if (nearbyFarms.length >= minClusterSize) {  // 2+
    createCluster(nearbyFarms);
  }
}
```

Result: 3 clusters identified
- Cluster 1: 3 farms northwest (85km avg)
- Cluster 2: 2 farms north (95km avg)
- Isolated: 3 farms (various)

### Step 4: Scoring & Ranking

```javascript
for (const farm of farms) {
  const scores = {
    productMatch: hasAllProducts(farm) ? 100 : 60,
    certifications: matchesCertifications(farm) ? 100 : 0,
    distance: 100 * (1 - distance / maxRadius),
    clustering: isInCluster(farm) ? 75 : 30,
    quality: farm.quality_score || 50,
    price: calculatePriceScore(farm)
  };
  
  farm.totalScore = Object.entries(scores).reduce((sum, [key, score]) => {
    return sum + (score * weights[key] / 100);
  }, 0);
}
```

Result: Farms ranked by total score
1. Farm B: 87.5 (Cluster 1, organic, 85km)
2. Farm C: 85.2 (Cluster 1, local, 82km)
3. Farm A: 82.0 (Cluster 2, organic, 95km)
4. Farm D: 70.5 (Isolated, 65km)

### Step 5: Optimal Selection

```javascript
// Prefer clustered farms first
const selectedFarms = [];

// Add farms from largest clusters
for (const cluster of sortedClusters) {
  for (const farm of cluster.farms) {
    if (farm.hasRequiredProducts) {
      selectedFarms.push(farm);
    }
  }
}

// Add isolated farms if needed (lower priority)
for (const farm of isolatedFarms) {
  if (needsProducts(farm)) {
    selectedFarms.push(farm);
  }
}
```

Result: Order split across 4 farms
- Farm B: Tomatoes, Cucumbers (Cluster 1)
- Farm C: Lettuce, Herbs (Cluster 1)
- Farm A: Strawberries (Cluster 2)
- Farm D: Blueberries (Isolated - only source)

### Step 6: Logistics Summary

```javascript
{
  totalFarms: 4,
  clusteredFarms: 3,
  numberOfClusters: 2,
  avgDistance: "87.3km",
  estimatedPickupTime: 180,  // minutes
  routeEfficiency: "high",
  farmDetails: [
    { farm: "Farm B", distance: "85km", cluster: 1, efficiency: "high" },
    { farm: "Farm C", distance: "82km", cluster: 1, efficiency: "high" },
    { farm: "Farm A", distance: "95km", cluster: 2, efficiency: "high" },
    { farm: "Farm D", distance: "65km", cluster: "none", efficiency: "low" }
  ]
}
```

**Route Plan:**
1. Kingston → Cluster 1 (northwest 85km): Pick up from Farm B and C
2. Continue north → Cluster 2 (95km): Pick up from Farm A
3. Detour east → Farm D (65km): Pick up blueberries (only source)
4. Return to Kingston

Total distance: ~320km vs naive selection: ~450km
**Savings: 130km (29% reduction)**

## Examples

### Example 1: Urban Buyer (Dense Farm Area)

**Buyer:** Restaurant in Kingston, ON
**Order:** Tomatoes, lettuce, herbs, cucumbers

**Farms Found:**
- 12 farms within 100km
- 8 farms have all products
- 6 farms meet organic certification

**Clustering:**
- Cluster A: 4 farms near Napanee (45km west)
- Cluster B: 2 farms near Belleville (70km east)
- Isolated: 2 farms

**Selection:**
- Farm 1 (Cluster A): Tomatoes, Cucumbers
- Farm 2 (Cluster A): Lettuce, Herbs
- **Reasoning:** Both in same cluster, single pickup route
- **Alternative rejected:** Farm in Belleville closer for cucumbers, but opposite direction

**Result:**
- 2 farms selected
- 1 pickup route
- 90 min estimated pickup time
- High efficiency

### Example 2: Rural Buyer (Sparse Farm Area)

**Buyer:** School in Smiths Falls, ON
**Order:** Apples, carrots, potatoes, chicken

**Farms Found:**
- 5 farms within 150km
- Only 3 farms have required products
- No clusters possible (all >40km apart)

**Selection:**
- Farm A (80km): Apples, Carrots
- Farm B (95km): Potatoes
- Farm C (120km): Chicken (only source)
- **Reasoning:** No clustering possible, select based on distance + quality
- **Trade-off:** Must visit 3 separate farms

**Result:**
- 3 farms selected
- 3 separate routes
- 240 min estimated pickup time
- Medium efficiency (unavoidable given sparse farms)

### Example 3: Filter Constraints

**Buyer:** Organic grocery store in Ottawa, ON
**Order:** Various vegetables (organic certified only)
**Filters:** `{ organic: true, pesticide_free: true }`

**Farms Found:**
- 20 farms within 150km
- Only 6 farms meet organic + pesticide-free certification
- 4 of 6 form cluster

**Selection:**
- Prioritize certified farms even if farther
- Select from cluster of 4 organic farms (110km)
- Reject closer non-certified farms (70km)
- **Reasoning:** Certification requirement overrides distance

**Result:**
- Certifications: 100% match
- Distance: Acceptable (within preferred range)
- Efficiency: High (clustered organic farms)

## Monitoring & Optimization

### Performance Metrics

Track these metrics to tune configuration:

```javascript
{
  avgRouteDistance: "95km",      // Average per order
  avgClustering: 2.3,             // Farms per cluster
  clusteringRate: "75%",          // Orders with clusters
  isolatedFarmRate: "15%",        // Farms requiring solo trip
  buyerSatisfaction: 4.8,         // Rating
  courierEfficiency: "high",      // Route optimization
  costPerKm: "$1.20"              // Logistics cost
}
```

### When to Adjust Configuration

**Increase `clusterRadius` if:**
- Low clustering rate (<50%)
- Too many isolated farms
- High logistics costs

**Decrease `maxRadius` if:**
- Long delivery times
- High courier costs
- Prefer more local sourcing

**Increase `clustering` weight if:**
- Route efficiency is top priority
- Multiple pickups common
- Courier costs high

**Increase `distance` weight if:**
- Freshness is critical
- Delivery speed important
- Fuel costs high

## API Integration

### Creating Order with Filters

```javascript
POST /api/wholesale/orders/create
{
  "buyer_id": 123,
  "buyer_name": "Kingston Restaurant",
  "buyer_email": "orders@restaurant.com",
  "delivery_latitude": 44.2312,   // Required for optimization
  "delivery_longitude": -76.4860, // Required for optimization
  "delivery_city": "Kingston",
  "delivery_province": "ON",
  
  // Filters for farm selection
  "filters": {
    "organic": true,
    "locallyGrown": true,
    "pesticide_free": false
  },
  
  // Products requested
  "items": [
    { "product_id": 1, "product_name": "Tomatoes", "quantity": 10, "unit": "kg", "price_per_unit": 5.00 },
    { "product_id": 2, "product_name": "Lettuce", "quantity": 20, "unit": "heads", "price_per_unit": 2.00 }
  ],
  
  "payment_method_id": "pm_xxx"
}
```

**Response:**
```javascript
{
  "success": true,
  "order_id": 12345,
  "total_amount": 90.00,
  "verification_deadline": "2025-12-23T15:00:00Z",
  
  // Logistics optimization info
  "logistics": {
    "totalFarms": 2,
    "clusteredFarms": 2,
    "numberOfClusters": 1,
    "avgDistance": "82.5km",
    "routeEfficiency": "high",
    "farmDetails": [
      { "farm_id": "F001", "farm_name": "Sunrise Organics", "distance": "80km", "cluster": 1 },
      { "farm_id": "F002", "farm_name": "Green Valley Farm", "distance": "85km", "cluster": 1 }
    ]
  },
  
  "optimization_note": "Selected 2 farms with high route efficiency"
}
```

## Best Practices

### For Buyers

1. **Provide Accurate Location**: Lat/lng enables optimal farm selection
2. **Be Flexible on Filters**: Strict filters may limit clustering options
3. **Order in Batches**: Larger orders allow better farm grouping
4. **Review Logistics Summary**: Check route efficiency before confirming

### For Administrators

1. **Monitor Clustering Rates**: Aim for >60% clustered orders
2. **Adjust Seasonally**: Tighter radius in winter, wider in summer
3. **Review Weekly Reports**: Track courier costs and satisfaction
4. **Test Presets**: Try different presets for different buyer types

### For Farms

1. **Update Inventory Regularly**: Availability affects selection
2. **Maintain Quality Scores**: Higher quality → better ranking
3. **Partner with Nearby Farms**: Clustering increases selection
4. **Communicate Location Changes**: Accurate coordinates critical

## Technical Details

### Distance Calculation

Uses Haversine formula for great-circle distance:

```javascript
const R = 6371; // Earth radius in km
const dLat = toRad(lat2 - lat1);
const dLon = toRad(lon2 - lon1);

const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
          Math.sin(dLon/2) * Math.sin(dLon/2);

const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
const distance = R * c; // km
```

### Bearing Calculation

Direction from buyer to farm (0-360°, where 0=North):

```javascript
const dLon = toRad(lon2 - lon1);
const y = Math.sin(dLon) * Math.cos(toRad(lat2));
const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
          Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);

let bearing = Math.atan2(y, x);
bearing = toDeg(bearing);
return (bearing + 360) % 360;
```

### Complexity

- **Time:** O(n²) for clustering + O(n log n) for sorting = O(n²)
- **Space:** O(n) for farm storage + O(c) for clusters = O(n)
- **Scalability:** Handles 1000s of farms efficiently

Where n = number of candidate farms, c = number of clusters

## Troubleshooting

### No Farms Found

**Cause:** Filters too strict or radius too small
**Solution:** 
- Relax certification requirements
- Increase `maxRadius`
- Check product availability

### Low Clustering Rate

**Cause:** Farms too spread out or `clusterRadius` too small
**Solution:**
- Increase `clusterRadius` from 25km to 35km
- Increase `maxDetourPercent` to allow farther clusters
- Recruit more farms in high-demand areas

### High Logistics Costs

**Cause:** Too many isolated farms selected
**Solution:**
- Increase `clustering` weight from 15% to 25%
- Increase `isolatedFarmPenalty`
- Apply "efficiency_focused" preset

### Complaints About Distance

**Cause:** Clustering prioritized over proximity
**Solution:**
- Increase `distance` weight from 20% to 30%
- Decrease `maxRadius`
- Apply "local_first" preset

## Summary

The farm selection optimizer solves the complex problem of multi-farm order fulfillment by:

✅ **Filtering** by product availability and certifications
✅ **Clustering** geographically nearby farms  
✅ **Scoring** on 6 weighted factors
✅ **Optimizing** for route efficiency
✅ **Configuring** easily via presets or API
✅ **Monitoring** with detailed logistics metrics

Result: **Reduced courier driving, lower costs, faster deliveries, happy buyers and farms.**
