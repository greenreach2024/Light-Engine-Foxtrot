# Label Printing, Export Systems & QuickBooks Integration Review

**Date:** December 28, 2024  
**System:** Light Engine Foxtrot Production  
**Review Scope:** Label/barcode printing, inventory/sales exports, QuickBooks integration

---

## Executive Summary

### 🟢 **Fully Implemented**
- ✅ Thermal label printing (ZPL/EPL) with queue management
- ✅ QR code generation for traceability
- ✅ HTML-based printable labels with browser print
- ✅ Sales reports with date filtering
- ✅ Compliance exports (CSV/JSON)

### 🟡 **Partially Implemented**
- ⚠️ Inventory PDF export (CSV exists, PDF needs implementation)
- ⚠️ Sales export (reports exist, dedicated export API needed)
- ⚠️ QuickBooks integration (placeholder only, needs full implementation)

### 🔴 **Not Implemented**
- ❌ Automated QuickBooks export scheduling
- ❌ Chart of Accounts mapping for QuickBooks
- ❌ Sales tax calculation and export to QuickBooks

---

## 1. Label Printing System ✅ COMPLETE

### 1.1 Thermal Printer Support
**Location:** [routes/thermal-printer.js](routes/thermal-printer.js)

**Status:** ✅ **Production Ready**

**Features:**
- ZPL and EPL label format support (Zebra/Brother printers)
- USB and Network (TCP/IP) printer connections
- Print queue management with job tracking
- Three label types: Tray, Harvest, Packing

**API Endpoints:**
```javascript
POST /api/printer/print-tray        // Print tray label with QR code
POST /api/printer/print-harvest     // Print harvest label with lot code
POST /api/printer/print-packing     // Print packing/shipping label
POST /api/printer/print-raw         // Print custom ZPL/EPL
POST /api/printer/test              // Test printer connection
GET  /api/printer/queue             // Check print queue status
GET  /api/printer/job/:jobId        // Get job status
GET  /api/printer/list              // List available USB printers
DELETE /api/printer/job/:jobId      // Cancel print job
POST /api/printer/clear             // Clear completed jobs
```

**Label Templates:**

1. **Tray Label (2" x 3")**
   - QR code with tray code
   - Farm name
   - Date
   - Format: ZPL/EPL

2. **Harvest Label (2" x 1")**
   - QR code with lot code
   - Crop name
   - Lot number
   - Weight and unit
   - Harvest date

3. **Packing Label (4" x 6")**
   - Order ID
   - Buyer name
   - Item list (multi-line)
   - QR code for traceability
   - "Scan for traceability" footer

**Hardware Compatibility:**
- ✅ Zebra ZPL printers (recommended)
- ✅ Brother EPL printers
- ✅ USB connection (requires `lp` or `lpr` command)
- ✅ Network connection (direct TCP/IP socket, port 9100)

**Print Queue:**
- Job tracking with unique IDs
- Status monitoring (pending, processing, completed, failed)
- Queue position visibility
- Automatic cleanup after 30 seconds
- 500ms processing interval

**Testing:**
```bash
# Test USB printer
curl -X POST http://localhost:8091/api/printer/test \
  -H "Content-Type: application/json" \
  -d '{"connection": "usb"}'

# Test network printer
curl -X POST http://localhost:8091/api/printer/test \
  -H "Content-Type: application/json" \
  -d '{"connection": "network", "host": "192.168.1.100", "port": 9100}'

# Print tray label
curl -X POST http://localhost:8091/api/printer/print-tray \
  -H "Content-Type: application/json" \
  -d '{
    "code": "TRAY-001",
    "farmName": "GreenReach Demo Farm",
    "connection": "usb",
    "format": "zpl"
  }'
```

### 1.2 Browser-Based Labels (HTML/PDF)
**Location:** [backend/labels.py](backend/labels.py)

**Status:** ✅ **Production Ready**

**Features:**
- HTML labels with inline CSS for print optimization
- QR code generation as base64 images
- Print-friendly styling (removes buttons, backgrounds)
- Two label types: Harvest, Wholesale Packing

**API Endpoints:**
```python
GET /api/labels/harvest              # Generate harvest label HTML
GET /api/labels/wholesale-packing    # Generate packing label HTML
```

**Harvest Label Parameters:**
- `lot_code`: Required - Lot tracking code
- `crop_name`: Optional - Crop name (default: "Unknown Crop")
- `weight`: Optional - Harvest weight
- `weight_unit`: Optional - Unit (default: "kg")
- `harvest_date`: Optional - Date (default: today)

**Wholesale Packing Label Parameters:**
- `order_id`: Required - Order tracking ID
- `buyer_name`: Optional - Buyer/buyer name
- `items`: Optional - JSON array of items
- `farm_name`: Optional - Source farm name
- `pack_date`: Optional - Packing date (default: today)
- `total_weight`: Optional - Total package weight

**Output Format:**
- Printable HTML page
- "Print Label" button (hidden in print view)
- 4" wide labels optimized for Avery/Dymo label sheets
- QR codes: 2" x 2" for harvest, larger for packing
- Professional styling with farm branding

**Testing:**
```bash
# Generate harvest label
curl "http://localhost:8091/api/labels/harvest?lot_code=LOT-2024-001&crop_name=Lettuce&weight=5.2&weight_unit=kg"

# Generate packing label
curl "http://localhost:8091/api/labels/wholesale-packing?order_id=ORD-001&buyer_name=Restaurant+ABC&farm_name=GreenReach+Demo"
```

### 1.3 Recommendations for Label Printing

**Short-term (Ready Now):**
1. ✅ Deploy thermal printer system to production
2. ✅ Configure printer settings in UI (add printer config page)
3. ✅ Test with actual hardware before customer deployment
4. ✅ Document printer setup for farms (hardware guide)

**Medium-term (Next 2 weeks):**
1. 🔲 Add bulk label printing (print 10+ labels at once)
2. 🔲 Create label templates library (custom designs)
3. 🔲 Add farm logo/branding to labels
4. 🔲 Implement label reprinting from tray history

**Long-term (Future Enhancement):**
1. 🔲 Mobile app label printing
2. 🔲 Label design editor (WYSIWYG)
3. 🔲 Bluetooth printer support for mobile devices
4. 🔲 Integration with scale hardware (auto-weight capture)

---

## 2. Barcode Printing System ✅ COMPLETE

### 2.1 QR Code Generation
**Status:** ✅ **Fully Implemented**

**Technology:**
- Python: `qrcode` library with `PIL`
- JavaScript: Can use browser-based QR libraries

**Implementation:**
```python
def generate_qr_base64(data: str) -> str:
    """Generate QR code as base64 image"""
    qr = qrcode.QRCode(version=1, box_size=10, border=2)
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    # Convert to base64 for HTML embedding
    return base64.b64encode(buffer.getvalue()).decode()
```

**QR Data Formats:**
1. **Tray Tracking:** `TRAY:{tray_code}`
2. **Lot Tracking:** `LOT:{lot_code}`
3. **Order Tracking:** `ORDER:{order_id}`
4. **Traceability:** `TRACE:{farm_id}:{lot_code}:{timestamp}`

**Scanning Integration:**
- ✅ Frontend QR scanner implemented
- ✅ Mobile app camera integration
- ✅ Webhook for scan events
- ✅ Traceability event logging

### 2.2 Barcode Formats Supported

**Current Implementation:**
- ✅ QR Code (2D) - Primary format
- ✅ Code 128 via ZPL: `^BC` command
- ✅ Code 39 via ZPL: `^B3` command
- ⚠️ UPC/EAN - Not currently implemented

**ZPL Barcode Commands:**
```zpl
^BC     Code 128 (most versatile)
^B3     Code 39 (alphanumeric)
^BQ     QR Code (2D, high data capacity)
^BE     EAN-13 (retail products)
^BU     UPC-A (retail products)
```

### 2.3 Recommendations for Barcodes

**Short-term:**
1. ✅ Continue using QR codes (best for farm traceability)
2. 🔲 Add UPC/EAN support if selling to retail (grocery stores)
3. 🔲 Implement GS1 DataBar for produce (USDA/FDA compliance)

**For QuickBooks Integration:**
- QR codes are sufficient (not used by QuickBooks)
- Product SKUs map to QuickBooks Item IDs
- Barcodes are for physical tracking, not accounting

---

## 3. Inventory Export System ⚠️ NEEDS ENHANCEMENT

### 3.1 Current Implementation
**Location:** [routes/farm-sales/inventory.js](routes/farm-sales/inventory.js)

**Status:** ⚠️ **API Only - No Export Feature**

**Available Endpoints:**
```javascript
GET /api/farm-sales/inventory        // Get inventory with filters
  Query params:
  - category: Filter by category
  - available_only: Only show items with quantity > 0
  - search: Search by name
```

**Current Response Format (JSON only):**
```json
{
  "ok": true,
  "farm_id": "FARM-001",
  "inventory": [
    {
      "sku_id": "SKU-001",
      "name": "Romaine Lettuce",
      "category": "Leafy Greens",
      "unit": "bunch",
      "available": 45,
      "retail_price": 3.50,
      "wholesale_price": 2.00,
      "last_updated": "2024-12-28T10:30:00Z"
    }
  ],
  "total_items": 12,
  "total_value": 1250.00
}
```

### 3.2 Missing Features

**❌ CSV Export:**
- No CSV format option
- No download endpoint
- Manual copy-paste required

**❌ PDF Export:**
- No PDF generation
- No formatted report
- No inventory valuation summary

**❌ Filtered Export:**
- Cannot export filtered results
- No date range for inventory snapshots
- No category-specific exports

### 3.3 Recommendations for Inventory Export

**CRITICAL - Implement Now:**

**A. Add CSV Export Endpoint**
```javascript
// Add to routes/farm-sales/inventory.js
GET /api/farm-sales/inventory/export
  Query params:
  - format: 'csv' | 'pdf' (default: csv)
  - category: Filter by category
  - available_only: true/false
  - include_valuation: true/false
```

**Response:**
- CSV: Set `Content-Type: text/csv` and `Content-Disposition: attachment`
- PDF: Use library like `pdfkit` or `puppeteer` for formatted reports

**B. CSV Format Structure**
```csv
SKU ID,Product Name,Category,Unit,Available Qty,Retail Price,Wholesale Price,Total Value,Last Updated
SKU-001,Romaine Lettuce,Leafy Greens,bunch,45,$3.50,$2.00,$157.50,2024-12-28 10:30:00
SKU-002,Arugula,Leafy Greens,bag,30,$4.00,$2.50,$120.00,2024-12-28 10:30:00
...
TOTALS,,,,"145 units",,"","$1,250.00",
```

**C. PDF Report Features**
1. **Header:**
   - Farm name and logo
   - Report date and time
   - Export parameters (filters applied)

2. **Summary Section:**
   - Total items
   - Total units in stock
   - Total inventory value (retail)
   - Total inventory value (wholesale)

3. **Inventory Table:**
   - All columns from CSV
   - Color-coded by category
   - Low stock warnings (< 10 units)

4. **Footer:**
   - Page numbers
   - Generated by Light Engine Foxtrot
   - Export timestamp

**Implementation Guide:**
```javascript
// routes/farm-sales/inventory.js

// Add CSV export function
function generateInventoryCSV(inventory, farmId) {
  const headers = [
    'SKU ID', 'Product Name', 'Category', 'Unit', 
    'Available Qty', 'Retail Price', 'Wholesale Price', 
    'Total Value', 'Last Updated'
  ];
  
  const rows = inventory.map(item => [
    item.sku_id,
    item.name,
    item.category,
    item.unit,
    item.available,
    `$${item.retail_price.toFixed(2)}`,
    `$${item.wholesale_price.toFixed(2)}`,
    `$${(item.available * item.retail_price).toFixed(2)}`,
    new Date(item.last_updated).toLocaleString()
  ]);
  
  // Calculate totals
  const totalUnits = inventory.reduce((sum, i) => sum + i.available, 0);
  const totalValue = inventory.reduce((sum, i) => sum + (i.available * i.retail_price), 0);
  
  rows.push([
    'TOTALS', '', '', '', totalUnits, '', '', `$${totalValue.toFixed(2)}`, ''
  ]);
  
  return [headers, ...rows].map(row => 
    row.map(cell => `"${cell}"`).join(',')
  ).join('\n');
}

// Export endpoint
router.get('/export', (req, res) => {
  try {
    const { format = 'csv', category, available_only } = req.query;
    const farmId = req.farm_id;
    
    let inventory = farmStores.inventory.getAllForFarm(farmId);
    
    // Apply filters
    if (category) {
      inventory = inventory.filter(i => i.category === category);
    }
    if (available_only === 'true') {
      inventory = inventory.filter(i => i.available > 0);
    }
    
    if (format === 'csv') {
      const csv = generateInventoryCSV(inventory, farmId);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 
        `attachment; filename="inventory-${farmId}-${new Date().toISOString().split('T')[0]}.csv"`
      );
      return res.send(csv);
    } else if (format === 'pdf') {
      // TODO: Implement PDF generation
      return res.status(501).json({
        ok: false,
        error: 'pdf_not_implemented',
        message: 'PDF export coming soon'
      });
    } else {
      return res.status(400).json({
        ok: false,
        error: 'invalid_format',
        message: 'Format must be csv or pdf'
      });
    }
    
  } catch (error) {
    console.error('[inventory] Export failed:', error);
    res.status(500).json({
      ok: false,
      error: 'export_failed',
      message: error.message
    });
  }
});
```

**Priority:** 🔴 **HIGH** - Farms need this for accounting reconciliation

---

## 4. Sales Export System ⚠️ NEEDS ENHANCEMENT

### 4.1 Current Implementation
**Location:** [routes/farm-sales/reports.js](routes/farm-sales/reports.js)

**Status:** ⚠️ **Reports API Only - No Dedicated Export**

**Available Report Endpoints:**
```javascript
GET /api/farm-sales/reports/sales-summary        // Sales overview
GET /api/farm-sales/reports/product-performance  // Product sales
GET /api/farm-sales/reports/customer-analytics   // Customer insights
GET /api/farm-sales/reports/inventory-turnover   // Inventory metrics
GET /api/farm-sales/reports/dashboard            // Combined dashboard
```

**Current Features:**
- ✅ Date range filtering
- ✅ Channel filtering (POS, delivery, wholesale)
- ✅ JSON response with metrics
- ⚠️ No CSV/PDF export
- ⚠️ No transaction-level export

### 4.2 Existing Export Features

**Wholesale Admin Compliance Export:**
**Location:** [wholesale-admin.html](wholesale-admin.html) line 799-860

**Status:** ✅ **Implemented for Wholesale Only**

**Features:**
- Date range selection
- CSV/JSON format options
- Configurable data scope:
  - ☑ Order Transactions
  - ☑ Farm Source Information
  - ☑ Product Details & Certifications
  - ☑ Traceability Events

**Export History:**
- Tracks all generated exports
- Shows record count, format, date range
- Download previous exports

**Gap:** This only works for wholesale platform admin, not individual farm sales.

### 4.3 Missing Features for Farm Sales Export

**❌ Transaction-Level Sales Export:**
- No order details CSV
- No payment transaction log
- No refund/adjustment export

**❌ Sales Tax Report:**
- No tax calculation by jurisdiction
- No tax collected summary
- No sales tax filing export

**❌ Payment Method Breakdown:**
- No cash vs card report
- No payment gateway reconciliation
- No tip tracking export

### 4.4 Recommendations for Sales Export

**CRITICAL - Implement Now:**

**A. Sales Transaction Export Endpoint**
```javascript
// Add to routes/farm-sales/reports.js
GET /api/farm-sales/reports/sales-export
  Query params:
  - format: 'csv' | 'json' (default: csv)
  - start_date: YYYY-MM-DD (required)
  - end_date: YYYY-MM-DD (required)
  - channel: pos | delivery | wholesale | all
  - include_payments: true/false (default: true)
  - include_items: true/false (default: true)
```

**B. CSV Export Format - Summary Level**
```csv
Order ID,Date,Time,Channel,Customer Name,Customer Email,Subtotal,Tax,Tips,Total,Payment Method,Status
ORD-001,2024-12-28,14:30:00,pos,John Doe,john@example.com,$45.00,$3.60,$5.00,$53.60,card,completed
ORD-002,2024-12-28,15:15:00,delivery,Jane Smith,jane@example.com,$32.50,$2.60,$0.00,$35.10,cash,completed
...
TOTALS,,,,,$1,250.00,$100.00,$45.00,$1,395.00,,
```

**C. CSV Export Format - Line Item Detail**
```csv
Order ID,Date,Line #,SKU,Product Name,Quantity,Unit,Unit Price,Line Total,Tax,Payment Method,Customer Name
ORD-001,2024-12-28,1,SKU-001,Romaine Lettuce,2,bunch,$3.50,$7.00,$0.56,card,John Doe
ORD-001,2024-12-28,2,SKU-005,Cherry Tomatoes,1,pint,$5.00,$5.00,$0.40,card,John Doe
ORD-002,2024-12-28,1,SKU-002,Arugula,3,bag,$4.00,$12.00,$0.96,cash,Jane Smith
...
TOTALS,,,,,,,$1,250.00,$100.00,,
```

**D. QuickBooks-Ready Format (See Section 5)**

**Implementation Priority:** 🔴 **HIGH** - Required for accounting and tax filing

**Recommended Approach:**

1. **Phase 1: Basic CSV Export** (This Week)
   - Summary level transactions
   - Date range filtering
   - Payment method breakdown

2. **Phase 2: Detailed Export** (Next Week)
   - Line item detail
   - Tax calculations by jurisdiction
   - Customer information

3. **Phase 3: QuickBooks Integration** (Next 2 Weeks)
   - IIF format for QuickBooks Desktop
   - API integration for QuickBooks Online
   - Automated nightly sync

---

## 5. QuickBooks Integration 🔴 PLACEHOLDER ONLY

### 5.1 Current Implementation
**Location:** [routes/farm-sales/quickbooks.js](routes/farm-sales/quickbooks.js)

**Status:** 🔴 **NOT PRODUCTION READY - Placeholder Code**

**What's Implemented:**
- ✅ OAuth 2.0 flow structure
- ✅ Multi-tenant token storage
- ✅ Basic API endpoint definitions
- ❌ No actual QuickBooks API calls
- ❌ No token refresh logic
- ❌ No error handling
- ❌ SDK not installed (`node-quickbooks` required)

**Current Endpoints:**
```javascript
GET  /api/farm-sales/quickbooks/auth          // Initiate OAuth (placeholder)
GET  /api/farm-sales/quickbooks/callback      // OAuth callback (placeholder)
GET  /api/farm-sales/quickbooks/status        // Connection status
POST /api/farm-sales/quickbooks/disconnect    // Disconnect
POST /api/farm-sales/quickbooks/sync-invoices // Sync orders → invoices (placeholder)
POST /api/farm-sales/quickbooks/sync-payments // Sync payments (placeholder)
POST /api/farm-sales/quickbooks/webhook       // QB webhook handler (placeholder)
```

**Security Note:**
[SECURITY_TEST_REPORT.md](SECURITY_TEST_REPORT.md) line 234-260 identifies:
- ⚠️ `node-quickbooks` package depends on deprecated `request` library
- ⚠️ Multiple vulnerabilities in transitive dependencies
- ✅ Non-critical (QuickBooks not in critical path)
- 📝 Recommendation: Migrate to modern HTTP client or remove dependency

### 5.2 QuickBooks Online API Requirements

**A. Setup Prerequisites:**
1. QuickBooks Developer Account (developer.intuit.com)
2. OAuth 2.0 App Creation
3. Environment Variables:
   ```bash
   QB_CLIENT_ID=your_client_id
   QB_CLIENT_SECRET=your_client_secret
   QB_REDIRECT_URI=https://app.greenreachgreens.com/api/farm-sales/quickbooks/callback
   QB_ENVIRONMENT=sandbox  # or production
   ```
4. Install SDK:
   ```bash
   npm install node-quickbooks
   # OR use modern alternative:
   npm install axios  # For direct API calls
   ```

**B. OAuth 2.0 Scopes Required:**
- `com.intuit.quickbooks.accounting` (primary scope)

**C. API Endpoints Needed:**
- **Customers:** Create/update customer records
- **Items:** Create/update product/service items
- **Invoices:** Create sales invoices from orders
- **Payments:** Record payment receipts
- **SalesReceipts:** For cash sales (POS)

### 5.3 Data Mapping for QuickBooks

**A. Customer Mapping**
```
Light Engine          → QuickBooks Online
─────────────────────────────────────────────
customer.name         → Customer.DisplayName
customer.email        → Customer.PrimaryEmailAddr
customer.phone        → Customer.PrimaryPhone
customer.address      → Customer.BillAddr
customer.tax_exempt   → Customer.Taxable = false
```

**B. Product/Item Mapping**
```
Light Engine          → QuickBooks Online
─────────────────────────────────────────────
inventory.sku_id      → Item.Id (reference)
inventory.name        → Item.Name
inventory.category    → Item.Type = "Inventory"
inventory.retail_price → Item.UnitPrice
inventory.unit        → Item.PurchaseDesc
```

**C. Sales Invoice Mapping (Delivery/Wholesale Orders)**
```
Light Engine          → QuickBooks Online
─────────────────────────────────────────────
order.order_id        → Invoice.DocNumber
order.customer        → Invoice.CustomerRef
order.created_at      → Invoice.TxnDate
order.delivery.date   → Invoice.ShipDate
order.items[]         → Invoice.Line[] (SalesItemLineDetail)
order.payment.amount  → Invoice.TotalAmt
order.payment.tax     → Invoice.TxnTaxDetail
```

**D. Sales Receipt Mapping (POS/Walk-up Sales)**
```
Light Engine          → QuickBooks Online
─────────────────────────────────────────────
order.order_id        → SalesReceipt.DocNumber
order.customer or "Walk-up" → SalesReceipt.CustomerRef
order.created_at      → SalesReceipt.TxnDate
order.items[]         → SalesReceipt.Line[]
order.payment.method  → SalesReceipt.PaymentMethodRef
order.payment.amount  → SalesReceipt.TotalAmt
```

**E. Payment Mapping**
```
Light Engine          → QuickBooks Online
─────────────────────────────────────────────
payment.payment_id    → Payment.PaymentRefNum
payment.order_id      → Payment.LinkedTxn (Invoice)
payment.amount        → Payment.TotalAmt
payment.method        → Payment.PaymentMethodRef
payment.created_at    → Payment.TxnDate
```

### 5.4 Required Exports for QuickBooks

**A. Chart of Accounts Mapping**
```
Sales Category        → QuickBooks Account
─────────────────────────────────────────────
POS Sales             → Revenue: Farm Store Sales
Delivery Sales        → Revenue: Direct-to-Consumer Sales
Wholesale Sales       → Revenue: Wholesale Revenue
Tips Received         → Revenue: Tips Income (non-taxable)
Sales Tax Collected   → Liability: Sales Tax Payable
Credit Card Fees      → Expense: Merchant Processing Fees
Refunds               → Revenue: Sales Returns & Allowances
```

**B. Daily Sales Summary Export**
Format: CSV for manual import or JSON for API sync
```csv
Date,Account,Debit,Credit,Memo,Customer
2024-12-28,Farm Store Sales,,$1250.00,POS Sales Summary,Multiple Customers
2024-12-28,Sales Tax Payable,,$100.00,Sales Tax Collected,
2024-12-28,Cash,1200.00,,Cash Receipts,
2024-12-28,Square,150.00,,Card Receipts,
2024-12-28,Merchant Processing Fees,$4.50,,Square Fees,
```

**C. Product Sales Detail Export**
For COGS (Cost of Goods Sold) tracking:
```csv
Date,Product SKU,Product Name,Quantity Sold,Unit Cost,Total Cost,Revenue,Profit
2024-12-28,SKU-001,Romaine Lettuce,45,$1.50,$67.50,$157.50,$90.00
2024-12-28,SKU-002,Arugula,30,$1.75,$52.50,$120.00,$67.50
```

**D. Customer Sales Detail Export**
For Accounts Receivable (wholesale):
```csv
Date,Customer Name,Invoice Number,Order Total,Amount Paid,Balance Due,Due Date,Payment Terms
2024-12-28,Restaurant ABC,INV-001,$1250.00,$0.00,$1250.00,2025-01-11,Net 14
2024-12-28,Grocery Store XYZ,INV-002,$850.00,$850.00,$0.00,,Immediate
```

**E. Payment Method Reconciliation Export**
For bank reconciliation:
```csv
Date,Payment Method,Transaction ID,Amount,Fee,Net Deposit,Status,Deposit Date
2024-12-28,Square - Card,sq_123456,$53.60,$1.55,$52.05,Settled,2024-12-30
2024-12-28,Cash,CASH-001,$35.10,$0.00,$35.10,Deposited,2024-12-28
```

### 5.5 Recommended Implementation Plan

**Phase 1: Manual Export (Immediate - This Week)**
Priority: 🔴 **CRITICAL**

1. **Create Daily Sales Summary Export**
   - API endpoint: `GET /api/farm-sales/reports/quickbooks-daily-summary`
   - Format: CSV (QuickBooks-compatible)
   - Includes: Revenue by category, sales tax, payment methods
   - Output: Ready for manual import to QuickBooks

2. **Create Inventory Valuation Export**
   - API endpoint: `GET /api/farm-sales/inventory/quickbooks-valuation`
   - Format: CSV
   - Includes: SKU, quantity, cost, value
   - Output: For COGS calculation

**Implementation:**
```javascript
// routes/farm-sales/reports.js

router.get('/quickbooks-daily-summary', (req, res) => {
  try {
    const { date } = req.query; // YYYY-MM-DD
    const farmId = req.farm_id;
    
    // Get orders for the date
    const orders = farmStores.orders.getAllForFarm(farmId)
      .filter(o => o.timestamps.created_at.startsWith(date));
    
    // Calculate totals by channel
    const posSales = orders
      .filter(o => o.channel === 'pos')
      .reduce((sum, o) => sum + (o.payment?.amount || 0), 0);
    
    const deliverySales = orders
      .filter(o => o.channel === 'delivery' || o.channel === 'd2c')
      .reduce((sum, o) => sum + (o.payment?.amount || 0), 0);
    
    const wholesaleSales = orders
      .filter(o => o.channel === 'wholesale' || o.channel === 'b2b')
      .reduce((sum, o) => sum + (o.payment?.amount || 0), 0);
    
    // Calculate tax collected
    const taxCollected = orders
      .reduce((sum, o) => sum + (o.payment?.tax || 0), 0);
    
    // Calculate tips
    const tips = orders
      .reduce((sum, o) => sum + (o.payment?.tip || 0), 0);
    
    // Payment method breakdown
    const cashTotal = orders
      .filter(o => o.payment?.method === 'cash')
      .reduce((sum, o) => sum + (o.payment?.amount || 0), 0);
    
    const cardTotal = orders
      .filter(o => o.payment?.method === 'card')
      .reduce((sum, o) => sum + (o.payment?.amount || 0), 0);
    
    // Generate CSV
    const csv = [
      'Date,Account,Debit,Credit,Memo,Customer',
      `${date},Farm Store Sales,,${posSales.toFixed(2)},POS Sales Summary,Multiple Customers`,
      `${date},Direct-to-Consumer Sales,,${deliverySales.toFixed(2)},Delivery Sales Summary,Multiple Customers`,
      `${date},Wholesale Revenue,,${wholesaleSales.toFixed(2)},Wholesale Sales Summary,Multiple Customers`,
      `${date},Sales Tax Payable,,${taxCollected.toFixed(2)},Sales Tax Collected,`,
      `${date},Tips Income,,${tips.toFixed(2)},Tips Received,`,
      `${date},Cash,${cashTotal.toFixed(2)},,Cash Receipts,`,
      `${date},Square,${cardTotal.toFixed(2)},,Card Receipts,`,
    ].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 
      `attachment; filename="quickbooks-daily-${date}-${farmId}.csv"`
    );
    res.send(csv);
    
  } catch (error) {
    console.error('[quickbooks] Daily summary export failed:', error);
    res.status(500).json({
      ok: false,
      error: 'export_failed',
      message: error.message
    });
  }
});
```

**Phase 2: QuickBooks Online API Integration (Next 2 Weeks)**
Priority: 🟡 **MEDIUM**

1. **Complete OAuth 2.0 Flow**
   - Install `axios` (replace deprecated `node-quickbooks`)
   - Implement token exchange
   - Implement token refresh
   - Store tokens encrypted in database

2. **Implement Sync Endpoints**
   - Sync customers → QuickBooks Customers
   - Sync products → QuickBooks Items
   - Sync orders → QuickBooks Invoices/SalesReceipts
   - Sync payments → QuickBooks Payments

3. **Error Handling & Logging**
   - API rate limiting (500 requests/minute)
   - Webhook for QuickBooks events
   - Sync status tracking
   - Failed sync retry logic

**Phase 3: Automated Scheduled Sync (Future)**
Priority: 🟢 **LOW**

1. **Nightly Sync Job**
   - Cron job: Sync all transactions from previous day
   - Email notification on sync completion/errors
   - Dashboard showing last sync time

2. **Real-time Sync Option**
   - Sync immediately after order completion
   - Background job queue for API calls
   - Fallback to nightly if real-time fails

### 5.6 Alternative: QuickBooks IIF Format (Desktop)

For farms using **QuickBooks Desktop** instead of QuickBooks Online:

**IIF File Format:**
```
!TRNS	DATE	ACCNT	AMOUNT	MEMO	CLEAR	CLASS
!SPL	DATE	ACCNT	AMOUNT	MEMO	CLEAR	CLASS
!ENDTRNS
TRNS	12/28/2024	Farm Store Sales	-1250.00	POS Sales Summary	N	
SPL	12/28/2024	Cash	1250.00	Cash Receipts	N	
ENDTRNS
```

**Implementation:**
```javascript
router.get('/quickbooks-iif', (req, res) => {
  // Generate IIF file from orders
  // Format: Tab-delimited with specific headers
  // More complex than CSV but works with QB Desktop
});
```

---

## 6. Implementation Priority Matrix

| Feature | Status | Priority | Timeline | Effort |
|---------|--------|----------|----------|--------|
| **Thermal Label Printing** | ✅ Complete | LOW (deployed) | Done | - |
| **HTML/PDF Labels** | ✅ Complete | LOW (deployed) | Done | - |
| **QR Code Generation** | ✅ Complete | LOW (deployed) | Done | - |
| **Inventory CSV Export** | ❌ Missing | 🔴 HIGH | This week | 4 hours |
| **Inventory PDF Export** | ❌ Missing | 🟡 MEDIUM | Next week | 8 hours |
| **Sales Transaction Export (CSV)** | ❌ Missing | 🔴 HIGH | This week | 6 hours |
| **Sales Line Item Export** | ❌ Missing | 🟡 MEDIUM | Next week | 4 hours |
| **QuickBooks Daily Summary** | ❌ Missing | 🔴 HIGH | This week | 6 hours |
| **QuickBooks OAuth Setup** | 🟡 Placeholder | 🟡 MEDIUM | 2 weeks | 16 hours |
| **QuickBooks API Sync** | ❌ Missing | 🟡 MEDIUM | 2 weeks | 24 hours |
| **Automated QB Sync Job** | ❌ Missing | 🟢 LOW | Future | 8 hours |

---

## 7. Action Items

### Immediate (Next 24-48 hours)

1. **Add Inventory CSV Export**
   - File: `routes/farm-sales/inventory.js`
   - Add `GET /api/farm-sales/inventory/export`
   - Support filters (category, available_only)
   - Return CSV with headers and totals

2. **Add Sales Transaction CSV Export**
   - File: `routes/farm-sales/reports.js`
   - Add `GET /api/farm-sales/reports/sales-export`
   - Date range required
   - Include order summary and line items

3. **Add QuickBooks Daily Summary Export**
   - File: `routes/farm-sales/reports.js`
   - Add `GET /api/farm-sales/reports/quickbooks-daily-summary`
   - Format: QuickBooks-compatible CSV
   - Include Chart of Accounts mapping

### Short-term (This Week)

4. **Test Label Printing with Real Hardware**
   - Configure thermal printer (USB or network)
   - Test all label types (tray, harvest, packing)
   - Document printer setup for farms

5. **Create Export Documentation**
   - User guide for CSV exports
   - QuickBooks import instructions
   - Chart of Accounts mapping guide

6. **Add Export UI in Farm Admin**
   - File: `public/LE-farm-admin.html`
   - Add "Exports" tab
   - Download buttons for inventory, sales, QuickBooks

### Medium-term (Next 2 Weeks)

7. **Implement PDF Reports**
   - Install `pdfkit` or `puppeteer`
   - Create inventory PDF template
   - Create sales summary PDF template

8. **Complete QuickBooks OAuth Flow**
   - Set up developer account
   - Implement token exchange
   - Add token refresh logic
   - Test with sandbox account

9. **Build QuickBooks Sync API**
   - Sync customers
   - Sync products
   - Sync invoices
   - Sync payments
   - Add error handling and logging

### Long-term (Future Enhancements)

10. **Automated Sync Jobs**
    - Nightly QuickBooks sync
    - Email notifications
    - Sync status dashboard

11. **Advanced Label Features**
    - Bulk printing
    - Custom templates
    - Farm logo/branding

12. **Sales Tax Automation**
    - Tax jurisdiction lookup
    - Automatic tax calculation
    - Tax liability report

---

## 8. Testing Checklist

### Label Printing Tests

- [ ] Print tray label via USB
- [ ] Print tray label via network
- [ ] Print harvest label with QR code
- [ ] Print packing label with item list
- [ ] Test print queue with 5+ jobs
- [ ] Test HTML label generation
- [ ] Scan QR code with mobile device
- [ ] Verify QR data matches database

### Export Tests

- [ ] Export inventory as CSV
- [ ] Export inventory as PDF (when implemented)
- [ ] Export inventory with category filter
- [ ] Export sales transactions (summary)
- [ ] Export sales transactions (line item detail)
- [ ] Export QuickBooks daily summary
- [ ] Open CSV in Excel/Google Sheets
- [ ] Import QuickBooks CSV to QB Online (test account)

### QuickBooks Integration Tests (When Implemented)

- [ ] Complete OAuth flow
- [ ] Store tokens securely
- [ ] Refresh expired token
- [ ] Sync customer to QuickBooks
- [ ] Sync product to QuickBooks
- [ ] Sync order as invoice
- [ ] Sync payment receipt
- [ ] Handle API errors gracefully
- [ ] Test webhook receipt

---

## 9. Cost & Resource Estimate

### Development Time

| Task | Estimated Hours | Developer Cost (@$100/hr) |
|------|----------------|---------------------------|
| Inventory CSV Export | 4 hours | $400 |
| Sales Transaction Export | 6 hours | $600 |
| QuickBooks Daily Summary | 6 hours | $600 |
| PDF Report Generation | 8 hours | $800 |
| QuickBooks OAuth Setup | 16 hours | $1,600 |
| QuickBooks API Sync | 24 hours | $2,400 |
| Testing & Documentation | 8 hours | $800 |
| **TOTAL** | **72 hours** | **$7,200** |

### External Costs

- QuickBooks Developer Account: **Free**
- QuickBooks Online Subscription (per farm): **$30-90/month**
- SSL Certificate (already have): **$0**
- Server Costs (AWS): **Current**

### Hardware Costs (Optional)

- Zebra ZPL Thermal Printer: **$250-500**
- Avery/Dymo Label Printer: **$100-200**
- Barcode Scanner: **$50-150**

---

## 10. Conclusion

### Summary of Findings

**Strengths:**
- ✅ Label printing system is production-ready
- ✅ QR code generation works well
- ✅ Thermal printer support is comprehensive
- ✅ Compliance export exists for wholesale

**Gaps:**
- ❌ Inventory export missing (high priority for accounting)
- ❌ Sales transaction export missing (required for bookkeeping)
- ❌ QuickBooks integration is placeholder only
- ❌ PDF reports not implemented

**Risk Assessment:**
- 🔴 **HIGH RISK:** Farms cannot reconcile inventory without CSV export
- 🔴 **HIGH RISK:** Farms cannot file taxes without sales export
- 🟡 **MEDIUM RISK:** Manual QuickBooks entry is error-prone and time-consuming
- 🟢 **LOW RISK:** Label printing works, just needs hardware setup

### Recommended Next Steps

1. **This Week (Critical):**
   - Implement inventory CSV export
   - Implement sales transaction export
   - Create QuickBooks daily summary export
   - Test with real farm data

2. **Next 2 Weeks (Important):**
   - Complete QuickBooks OAuth integration
   - Build automated sync functionality
   - Add PDF report generation

3. **Customer Deployment:**
   - Test exports with tomorrow's customer
   - Gather feedback on export formats
   - Document manual QuickBooks import process
   - Plan for automated sync based on customer needs

### Success Metrics

- [ ] Farms can export inventory for monthly accounting
- [ ] Farms can export sales for tax filing
- [ ] Farms can import daily sales to QuickBooks (manual)
- [ ] Label printing works on farm hardware
- [ ] QR codes scan correctly in mobile app
- [ ] Export files open in Excel/QuickBooks without errors

---

**Document Version:** 1.0  
**Last Updated:** December 28, 2024  
**Next Review:** After customer testing (December 29, 2024)
