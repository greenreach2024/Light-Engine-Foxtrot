# Farm Certifications & Buyer Filtering

## Overview

The farm certifications feature allows farms to specify their certifications, growing practices, and business attributes during registration. Wholesale buyers can then filter the product catalog based on these farm characteristics.

## Farm Certifications

### Types of Certifications

**Certifications:**
- **GAP Certified** (Good Agricultural Practices) - Industry-standard food safety certification
- **USDA Organic Certified** - Certified organic production
- **Food Safety Certified** (GFSI, SQF) - Third-party food safety audits
- **Greenhouse Grown Certified** - Certified controlled environment agriculture

**Growing Practices:**
- **Pesticide Free** - No synthetic pesticides used
- **Non-GMO** - Non-genetically modified crops
- **Hydroponic Growing** - Soilless growing systems
- **Local** (within 100 miles) - Locally sourced products
- **Year-Round Production** - Consistent year-round availability

**Farm Attributes:**
- **Woman-Owned Business** - Women-owned and operated
- **Veteran-Owned Business** - Veteran-owned and operated
- **Minority-Owned Business** - Minority-owned and operated
- **Family Farm** - Family-owned and operated
- **Sustainable Practices** - Commitment to environmental sustainability

## Setup Wizard Integration

### Step 3: Farm Certifications

During the initial setup wizard, farms are presented with Step 3: Farm Certifications, which includes:

1. **Certification Selection** - Checkboxes for GAP, USDA Organic, Food Safety, and Greenhouse certifications
2. **Growing Practices** - Checkboxes for pesticide-free, non-GMO, hydroponic, local, and year-round practices
3. **Special Attributes** - Checkboxes for business ownership and sustainability attributes

All checkboxes are:
- **Touch-optimized** - 32px × 32px for easy touchscreen interaction
- **Optional** - Farms can skip this step if desired
- **Multiple selection** - Farms can select any combination

### Data Storage

Certification data is stored in three formats:

**Edge Device (Local):**
```json
{
  "certifications": {
    "certifications": ["GAP", "organic"],
    "practices": ["pesticide_free", "local"],
    "attributes": ["family_farm", "sustainable"]
  }
}
```

**GreenReach Central Database:**
```sql
farms (
  certifications JSONB DEFAULT '[]',  -- ["GAP", "organic"]
  practices JSONB DEFAULT '[]',       -- ["pesticide_free", "local"]
  attributes JSONB DEFAULT '[]'       -- ["family_farm", "sustainable"]
)
```

**Indexes:**
```sql
CREATE INDEX idx_farms_certifications ON farms USING GIN (certifications);
CREATE INDEX idx_farms_practices ON farms USING GIN (practices);
CREATE INDEX idx_farms_attributes ON farms USING GIN (attributes);
```

## Wholesale Integration

### Catalog Sync

When inventory is synced to the wholesale catalog, farm-level certifications are automatically included:

```javascript
{
  productId: "...",
  farmId: "GR-00001",
  name: "Organic Basil",
  // ... product details ...
  farmCertifications: ["GAP", "organic"],
  farmPractices: ["pesticide_free", "hydroponic"],
  farmAttributes: ["woman_owned", "sustainable"]
}
```

### API Endpoints

**GET /api/wholesale/catalog**

Query wholesale catalog with optional certification filters.

**Query Parameters:**
- `certifications[]` - Array of certification types (GAP, organic, food_safety, greenhouse)
- `practices[]` - Array of practices (pesticide_free, non_gmo, hydroponic, local, year_round)
- `attributes[]` - Array of attributes (woman_owned, veteran_owned, minority_owned, family_farm, sustainable)
- `category` - Product category filter
- `organic` - Boolean filter for organic products
- `minQuantity` - Minimum available quantity
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 50, max: 200)

**Example Request:**
```bash
curl "https://central.greenreach.io/api/wholesale/catalog?certifications=GAP&practices=pesticide_free&attributes=woman_owned&page=1&limit=50"
```

**Example Response:**
```json
{
  "items": [
    {
      "id": "...",
      "productId": "...",
      "name": "Organic Basil",
      "category": "herbs",
      "quantity": 50,
      "unit": "lb",
      "wholesalePrice": 12.00,
      "farm": {
        "id": "GR-00001",
        "name": "Green Valley Farm",
        "city": "Portland",
        "state": "OR",
        "certifications": ["GAP", "organic"],
        "practices": ["pesticide_free", "hydroponic"],
        "attributes": ["woman_owned", "sustainable"]
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "totalItems": 125,
    "totalPages": 3
  },
  "filters": {
    "certifications": ["GAP"],
    "practices": ["pesticide_free"],
    "attributes": ["woman_owned"]
  }
}
```

**GET /api/wholesale/catalog/filters**

Get available filter options from active farms.

**Example Response:**
```json
{
  "certifications": ["GAP", "organic", "food_safety", "greenhouse"],
  "practices": ["pesticide_free", "non_gmo", "hydroponic", "local", "year_round"],
  "attributes": ["woman_owned", "veteran_owned", "family_farm", "sustainable"],
  "categories": ["produce", "herbs", "greens"]
}
```

**GET /api/wholesale/farms**

List all farms in the wholesale network with their certifications.

**Query Parameters:**
- `certifications[]` - Filter by certifications
- `practices[]` - Filter by practices
- `attributes[]` - Filter by attributes

**Example Response:**
```json
{
  "farms": [
    {
      "id": "GR-00001",
      "name": "Green Valley Farm",
      "city": "Portland",
      "state": "OR",
      "certifications": ["GAP", "organic"],
      "practices": ["pesticide_free", "hydroponic"],
      "attributes": ["woman_owned", "sustainable"],
      "tier": "professional",
      "lastSync": "2024-01-15T10:30:00Z",
      "productCount": 45
    }
  ]
}
```

**PATCH /api/farms/:id**

Update farm details including certifications.

**Authorization:** Requires farm's API key or admin token

**Request Body:**
```json
{
  "certifications": ["GAP", "organic"],
  "practices": ["pesticide_free", "local"],
  "attributes": ["family_farm"]
}
```

## Buyer Filtering UI

### Wholesale Portal

The wholesale portal (`/public/wholesale.html`) includes a comprehensive filtering interface:

**Filter Categories:**
1. **Farm Certifications** - Filter by GAP, Organic, Food Safety, Greenhouse
2. **Growing Practices** - Filter by Pesticide Free, Non-GMO, Hydroponic, Local, Year-Round
3. **Farm Attributes** - Filter by Woman/Veteran/Minority-Owned, Family Farm, Sustainable

**UI Features:**
- **Checkbox Interface** - Easy multi-select filtering
- **Apply Filters Button** - Trigger filtered catalog reload
- **Clear All Button** - Reset all filters at once
- **Visual Feedback** - Active filters highlighted
- **Responsive Design** - Works on desktop and mobile

**JavaScript Methods:**
```javascript
app.applyFilters()  // Apply selected filters and reload catalog
app.clearFilters()  // Clear all filters and reload full catalog
```

## Database Migration

To add certifications to an existing database:

```bash
cd greenreach-central
psql $DATABASE_URL -f migrations/002_add_farm_certifications.sql
```

**Migration File:** `greenreach-central/migrations/002_add_farm_certifications.sql`

Contents:
```sql
ALTER TABLE farms 
ADD COLUMN IF NOT EXISTS certifications JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS practices JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS attributes JSONB DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_farms_certifications ON farms USING GIN (certifications);
CREATE INDEX IF NOT EXISTS idx_farms_practices ON farms USING GIN (practices);
CREATE INDEX IF NOT EXISTS idx_farms_attributes ON farms USING GIN (attributes);
```

## Testing

### Test Farm Registration with Certifications

1. Navigate to setup wizard: `http://edge-device.local/setup-wizard.html`
2. Complete Steps 1-2 (Welcome, Network, Registration)
3. **Step 3: Farm Certifications**
   - Select: GAP Certified ✓
   - Select: Pesticide Free ✓
   - Select: Family Farm ✓
4. Complete Steps 4-5 (Hardware Detection, Complete)
5. Verify certifications saved to database

### Test Wholesale Filtering

1. Navigate to wholesale portal: `https://central.greenreach.io/wholesale.html`
2. **Filter by Certification:**
   - Check "GAP Certified" ✓
   - Click "Apply Filters"
   - Verify only GAP-certified farms' products appear
3. **Filter by Practice:**
   - Check "Pesticide Free" ✓
   - Click "Apply Filters"
   - Verify filtered results
4. **Combine Filters:**
   - Check "GAP Certified", "Pesticide Free", "Woman-Owned"
   - Click "Apply Filters"
   - Verify products match ALL selected filters
5. **Clear Filters:**
   - Click "Clear All"
   - Verify full catalog restored

### Test API Filtering

```bash
# Test certification filter
curl "http://localhost:3000/api/wholesale/catalog?certifications=GAP"

# Test practice filter
curl "http://localhost:3000/api/wholesale/catalog?practices=pesticide_free"

# Test attribute filter
curl "http://localhost:3000/api/wholesale/catalog?attributes=woman_owned"

# Test combined filters
curl "http://localhost:3000/api/wholesale/catalog?certifications=GAP&practices=pesticide_free&attributes=woman_owned"

# Test available filters endpoint
curl "http://localhost:3000/api/wholesale/catalog/filters"

# Test farms list
curl "http://localhost:3000/api/wholesale/farms?certifications=GAP"
```

## Business Value

### For Farms
- **Market Differentiation** - Stand out with certifications and practices
- **Premium Pricing** - Certified products command higher prices
- **Buyer Matching** - Connect with buyers seeking specific attributes
- **Transparency** - Build trust through clear certification disclosure

### For Buyers
- **Efficient Sourcing** - Find farms matching specific requirements
- **Compliance** - Meet procurement standards (GAP, organic, etc.)
- **Values Alignment** - Support woman-owned, veteran-owned, sustainable farms
- **Time Savings** - Filter catalog instead of manual searching

### For Platform
- **Competitive Advantage** - Unique filtering capability in wholesale marketplace
- **User Retention** - Buyers return for powerful filtering tools
- **Data Insights** - Track popular certifications and attributes
- **Premium Features** - Potential for tiered certification verification services

## Future Enhancements

### Certification Verification
- **Document Upload** - Allow farms to upload certification documents
- **Expiration Tracking** - Alert farms when certifications need renewal
- **Verification Badges** - Display verified vs. self-reported certifications
- **Third-Party Integration** - Auto-verify with certification databases

### Advanced Filtering
- **Proximity Filters** - "Within X miles of my location"
- **Delivery Date Matching** - "Available for delivery on specific date"
- **Price Range** - "Products within budget"
- **Saved Filter Sets** - "My preferred suppliers"

### Analytics Dashboard
- **Buyer Insights** - Which filters are most popular?
- **Farm Recommendations** - "Suggested certifications based on buyer demand"
- **Market Trends** - Track certification adoption rates
- **ROI Tracking** - Measure impact of certifications on sales

## Support

### Farms
- **Setup Questions:** support@greenreach.io
- **Certification Changes:** Update via farm settings or contact support
- **Verification Process:** Coming soon - document upload portal

### Buyers
- **Filter Questions:** Help docs at /docs/filtering
- **Custom Filters:** Enterprise plans support custom filter sets
- **API Access:** API documentation at /docs/api

## Related Documentation

- [WHOLESALE_INTEGRATION.md](WHOLESALE_INTEGRATION.md) - Wholesale platform overview
- [FIRST_RUN_GUIDE.md](docs/FIRST_RUN_GUIDE.md) - Setup wizard documentation
- [API_DOCUMENTATION.md](greenreach-central/API_DOCUMENTATION.md) - Complete API reference
- [PROJECT_COMPLETE.md](PROJECT_COMPLETE.md) - Overall project status
