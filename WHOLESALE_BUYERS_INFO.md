# Wholesale Buyers Site - Access Information

## Production URL

**Wholesale Marketplace (Buyers):**
```
http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/wholesale.html
```

**Wholesale Admin (Farm Side):**
```
http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/wholesale-admin.html
```

---

## Wholesale Buyers Interface

### Purpose
The wholesale buyers site allows restaurants, distributors, and commercial buyers to:
- Browse fresh produce from GreenReach farms
- Place wholesale orders online
- Track delivery schedules
- Manage buyer accounts
- View pricing and availability

### Key Features

#### 1. Product Catalog
- **Live Inventory**: Real-time availability from connected farms
- **Product Details**: Certifications, harvest dates, shelf life
- **Pricing**: Wholesale prices with quantity discounts
- **Categories**: Leafy greens, herbs, microgreens, etc.
- **Search & Filter**: By category, organic, farm, availability

#### 2. Shopping Cart
- Add products with custom quantities
- Real-time price calculations
- Minimum order requirements
- Delivery date selection
- Special instructions

#### 3. Order Management
- Order history and tracking
- Recurring orders setup
- Delivery confirmations
- Invoice generation
- Payment processing integration

#### 4. Buyer Account
- Registration with business verification
- Saved delivery addresses
- Payment methods
- Order preferences
- Communication history

---

## How It Works

### For Buyers

**1. Registration**
- Visit wholesale.html
- Click "Register" or "Sign Up"
- Provide business information:
  - Business name
  - Contact person
  - Delivery address
  - Tax ID/Business license
  - Contact details

**2. Browse Products**
- View available products from GreenReach farms
- Filter by category, organic, certifications
- See harvest dates and availability
- Check wholesale pricing

**3. Place Orders**
- Add items to cart
- Select delivery date
- Enter special instructions
- Review order total
- Submit order

**4. Order Fulfillment**
- Order routed to farm(s) automatically
- Inventory reserved
- Confirmation email sent
- Delivery scheduled
- Invoice generated

**5. Payment**
- Net 30 terms (default)
- Credit card on file
- ACH/Bank transfer
- Square/Stripe integration

### For Farms (Admin Side)

**1. Catalog Management** (wholesale-admin.html)
- Enable/disable wholesale integration
- Set wholesale pricing (% of retail)
- Define minimum order quantities
- Manage product visibility
- Update availability

**2. Order Processing**
- Receive webhook notifications
- Orders appear in farm dashboard
- Inventory auto-reserved
- Fulfillment workflow
- Delivery coordination

**3. Analytics**
- Wholesale revenue tracking
- Top buyers report
- Product performance
- Order trends
- Forecast demand

---

## Technical Details

### Architecture

**Frontend (Buyers):**
- File: `/public/wholesale.html`
- Script: `/public/js/wholesale.js`
- Single-page application
- Responsive design (mobile-friendly)

**Frontend (Farm Admin):**
- File: `/public/wholesale-admin.html`
- Script: `/public/js/wholesale-admin.js`
- Farm operator interface

**Backend API:**
- **Catalog Sync**: `/api/wholesale/catalog/sync`
- **Product Listing**: `/api/wholesale/products`
- **Order Creation**: `/api/wholesale/orders`
- **Buyer Registration**: `/api/wholesale/buyers/register`
- **Order History**: `/api/wholesale/orders/:buyerId`

**Integration:**
- GreenReach Central API connection
- mTLS certificate authentication
- Webhook order notifications
- Real-time inventory sync (5-minute intervals)

### Data Flow

```
┌─────────────┐
│   Buyer     │
│  (Browser)  │
└──────┬──────┘
       │ Browse/Order
       ▼
┌─────────────────────┐
│  wholesale.html     │
│  (Buyers Interface) │
└──────┬──────────────┘
       │ API Calls
       ▼
┌─────────────────────────┐
│ Edge Farm Server        │
│ /api/wholesale/*        │
└──────┬──────────────────┘
       │
       ├─► Local Inventory DB
       │
       └─► GreenReach Central
           (Order Processing)
```

---

## Demo/Testing

### Demo Mode
The wholesale site supports demo mode for testing:

**Demo Buyer Login:**
- Username: `demo-buyer@restaurant.com`
- Password: (Check demo config)

**Test Products:**
- Sample products loaded from demo data
- Test ordering workflow
- Fake payment processing

### Test Orders
To test the complete flow:
1. Visit wholesale.html
2. Register demo buyer account
3. Browse products
4. Add items to cart
5. Complete checkout
6. Check farm admin (wholesale-admin.html) for order

---

## Configuration

### Enable Wholesale on Farm

**Via Setup Wizard:**
1. Go to `/setup-wizard.html`
2. Step: Wholesale Integration
3. Enable "Join GreenReach Wholesale"
4. Set wholesale pricing percentage (e.g., 70% of retail)
5. Configure minimum order amounts
6. Save settings

**Via Admin Dashboard:**
1. Go to `/admin.html`
2. Navigate to "Wholesale" section
3. Toggle "Enable Wholesale"
4. Configure pricing and availability
5. Sync catalog

### Pricing Configuration

**Wholesale Pricing Strategy:**
```javascript
{
  "wholesalePriceMode": "percentage", // or "fixed"
  "wholesalePercentage": 70, // 70% of retail price
  "minimumOrderAmount": 100, // $100 minimum
  "volumeDiscounts": [
    { "threshold": 500, "discount": 5 },  // 5% off $500+
    { "threshold": 1000, "discount": 10 } // 10% off $1000+
  ]
}
```

---

## Features by Role

### Buyers Can:
✅ Browse product catalog  
✅ View real-time availability  
✅ Add products to cart  
✅ Place orders  
✅ Track order history  
✅ Manage delivery addresses  
✅ Save payment methods  
✅ Set up recurring orders  
✅ Download invoices  
✅ Contact farm directly  

### Farms Can:
✅ Enable/disable wholesale  
✅ Set wholesale pricing  
✅ Manage product visibility  
✅ Receive order notifications  
✅ Process wholesale orders  
✅ Track wholesale revenue  
✅ View buyer information  
✅ Generate reports  
✅ Sync with GreenReach Central  
✅ Set minimum order amounts  

---

## Integration with GreenReach Central

### Catalog Synchronization
- **Frequency**: Every 5 minutes
- **Direction**: Edge Farm → Central
- **Data**: Products, pricing, availability
- **Authentication**: mTLS certificates

### Order Flow
1. Buyer places order on Central marketplace
2. Central routes order to farm(s)
3. Webhook sent to edge device(s)
4. Edge validates and reserves inventory
5. Confirmation sent back to Central
6. Buyer receives confirmation

### Multi-Farm Orders
When buyers order from multiple farms:
- Order split automatically
- Each farm receives their portion
- Coordinated delivery scheduling
- Consolidated invoicing
- Centralized payment processing

---

## Security

### Buyer Authentication
- Email/password authentication
- Business verification required
- Session tokens (30-day expiry)
- Password reset via email

### API Security
- Farm authentication with API keys
- mTLS for Central communication
- Webhook signature verification
- Rate limiting on endpoints
- Input validation and sanitization

### Payment Security
- PCI-compliant payment processing
- Encrypted payment data
- Tokenized card storage
- Square/Stripe integration
- Secure checkout flow

---

## Support & Documentation

**Full Documentation:**
- [WHOLESALE_INTEGRATION.md](WHOLESALE_INTEGRATION.md) - Complete integration guide
- [README.md](README.md) - General system overview
- [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) - Production status

**API Reference:**
- Catalog API endpoints
- Order management endpoints
- Buyer registration/authentication
- Webhook specifications

**Contact:**
- Technical support: GitHub issues
- Business inquiries: Contact farm admin
- GreenReach Central: Central marketplace team

---

## Quick Start for Buyers

**1. Access the Site:**
```
http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/wholesale.html
```

**2. Register:**
- Click "Sign Up" or "Register"
- Fill in business information
- Verify email address
- Add delivery address

**3. Browse:**
- View available products
- Filter by category or certification
- Check pricing and availability

**4. Order:**
- Add items to cart
- Select delivery date
- Review and submit
- Receive confirmation

**5. Track:**
- View order status
- Check delivery schedule
- Access invoices
- Manage account

---

*Last updated: December 21, 2025*
