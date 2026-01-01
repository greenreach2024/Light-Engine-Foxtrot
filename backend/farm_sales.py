"""
Farm Sales API - Point of Sale, Orders, and Donation Programs
Connects POS terminals and online shop to farm inventory and payment processing
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, date
from enum import Enum
import uuid

router = APIRouter()

# ============================================================================
# ENUMS
# ============================================================================

class OrderStatus(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"

class OrderChannel(str, Enum):
    POS = "pos"
    ONLINE = "online"
    WHOLESALE = "wholesale"
    DONATION = "donation"

class PaymentMethod(str, Enum):
    CASH = "cash"
    CARD = "card"
    GIFT_CARD = "gift_card"
    CHECK = "check"
    ACCOUNT = "account"

class DonationProgramType(str, Enum):
    SNAP = "snap"
    WIC = "wic"
    SENIOR = "senior"
    FOOD_BANK = "food_bank"
    COMMUNITY = "community"

class ProgramStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    PENDING = "pending"

# ============================================================================
# MODELS
# ============================================================================

class ProductSKU(BaseModel):
    """Product SKU for retail sales"""
    sku_id: str
    name: str
    category: str
    retail_price: float
    wholesale_price: Optional[float] = None
    unit: str  # "lb", "oz", "bunch", "head", "each"
    available: int
    reserved: int
    is_taxable: bool = True
    lot_code: Optional[str] = None
    harvest_date: Optional[str] = None
    variety: Optional[str] = None

class Customer(BaseModel):
    """Customer information for order"""
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    gift_card: Optional[str] = None

class OrderItem(BaseModel):
    """Item in an order"""
    sku_id: str
    quantity: int
    unit_price: Optional[float] = None

class PaymentInfo(BaseModel):
    """Payment information"""
    method: PaymentMethod
    tendered: Optional[float] = None
    card_token: Optional[str] = None
    gift_card_number: Optional[str] = None

class Cashier(BaseModel):
    """Cashier/staff information"""
    name: str
    employee_id: Optional[str] = None

class CheckoutRequest(BaseModel):
    """POS checkout request"""
    customer: Optional[Customer] = None
    items: List[OrderItem]
    payment: PaymentInfo
    cashier: Optional[Cashier] = None
    notes: Optional[str] = None

class OrderPricing(BaseModel):
    """Order pricing breakdown"""
    subtotal: float
    tax: float
    discount: float = 0.0
    subsidy: float = 0.0
    total: float

class Order(BaseModel):
    """Sales order"""
    order_id: str
    channel: OrderChannel
    status: OrderStatus
    customer: Optional[Customer] = None
    items: List[Dict[str, Any]]
    pricing: OrderPricing
    payment: Dict[str, Any]
    cashier: Optional[Cashier] = None
    timestamps: Dict[str, str]
    notes: Optional[str] = None

class DonationProgram(BaseModel):
    """Food assistance/donation program"""
    program_id: str
    name: str
    type: DonationProgramType
    status: ProgramStatus
    subsidy_percent: float = Field(ge=0, le=100)
    grant: Dict[str, Any]
    eligible_products: List[str]
    verification_required: bool = True
    active_since: str
    expires_at: Optional[str] = None

class SquareStatus(BaseModel):
    """Square payment processor status"""
    connected: bool
    application_id: Optional[str] = None
    location_id: Optional[str] = None
    merchant_name: Optional[str] = None
    message: Optional[str] = None

# ============================================================================
# MOCK DATA (Replace with database queries in production)
# ============================================================================

# Sample inventory - In production, query from database
SAMPLE_INVENTORY = [
    {
        "sku_id": "SKU-001",
        "name": "Butterhead Lettuce",
        "category": "Lettuce",
        "retail_price": 3.99,
        "wholesale_price": 2.50,
        "unit": "head",
        "available": 45,
        "reserved": 5,
        "is_taxable": False,
        "lot_code": "LOT-2026001-BHL",
        "harvest_date": "2025-12-28",
        "variety": "Buttercrunch"
    },
    {
        "sku_id": "SKU-002",
        "name": "Romaine Hearts",
        "category": "Lettuce",
        "retail_price": 4.49,
        "wholesale_price": 2.75,
        "unit": "head",
        "available": 38,
        "reserved": 12,
        "is_taxable": False,
        "lot_code": "LOT-2025365-ROM",
        "harvest_date": "2025-12-27",
        "variety": "Paris Island"
    },
    {
        "sku_id": "SKU-003",
        "name": "Baby Kale Mix",
        "category": "Greens",
        "retail_price": 5.99,
        "wholesale_price": 3.50,
        "unit": "lb",
        "available": 12,
        "reserved": 3,
        "is_taxable": False,
        "lot_code": "LOT-2025364-KAL",
        "harvest_date": "2025-12-26",
        "variety": "Mixed Kale"
    },
    {
        "sku_id": "SKU-004",
        "name": "Fresh Basil",
        "category": "Herbs",
        "retail_price": 3.49,
        "wholesale_price": 2.00,
        "unit": "bunch",
        "available": 28,
        "reserved": 8,
        "is_taxable": False,
        "lot_code": "LOT-2026001-BAS",
        "harvest_date": "2025-12-29",
        "variety": "Genovese"
    },
    {
        "sku_id": "SKU-005",
        "name": "Arugula",
        "category": "Greens",
        "retail_price": 4.99,
        "wholesale_price": 2.95,
        "unit": "lb",
        "available": 18,
        "reserved": 6,
        "is_taxable": False,
        "lot_code": "LOT-2026001-ARU",
        "harvest_date": "2025-12-29",
        "variety": "Wild Rocket"
    },
    {
        "sku_id": "SKU-006",
        "name": "Microgreens Mix",
        "category": "Microgreens",
        "retail_price": 8.99,
        "wholesale_price": 5.50,
        "unit": "oz",
        "available": 24,
        "reserved": 4,
        "is_taxable": False,
        "lot_code": "LOT-2025363-MIC",
        "harvest_date": "2025-12-25",
        "variety": "Rainbow Mix"
    },
    {
        "sku_id": "SKU-007",
        "name": "Cherry Tomatoes",
        "category": "Vegetables",
        "retail_price": 6.99,
        "wholesale_price": 4.25,
        "unit": "lb",
        "available": 15,
        "reserved": 2,
        "is_taxable": False,
        "lot_code": "LOT-2025361-TOM",
        "harvest_date": "2025-12-23",
        "variety": "Sweet 100"
    },
    {
        "sku_id": "SKU-008",
        "name": "Spinach",
        "category": "Greens",
        "retail_price": 4.49,
        "wholesale_price": 2.75,
        "unit": "lb",
        "available": 22,
        "reserved": 8,
        "is_taxable": False,
        "lot_code": "LOT-2026001-SPN",
        "harvest_date": "2025-12-28",
        "variety": "Savoy"
    }
]

# Sample orders storage (In production, use database)
ORDERS_DB = []

# Sample donation programs
DONATION_PROGRAMS = [
    {
        "program_id": "PROG-001",
        "name": "SNAP/EBT Fresh Food",
        "type": "snap",
        "status": "active",
        "subsidy_percent": 50.0,
        "grant": {
            "provider": "USDA",
            "grant_number": "SNAP-2026-CA-001",
            "total_budget": 25000.00,
            "spent_to_date": 8750.50,
            "expires_at": "2026-12-31"
        },
        "eligible_products": ["all"],
        "verification_required": True,
        "active_since": "2026-01-01",
        "expires_at": "2026-12-31"
    },
    {
        "program_id": "PROG-002",
        "name": "Senior Farmers Market",
        "type": "senior",
        "status": "active",
        "subsidy_percent": 100.0,
        "grant": {
            "provider": "County of Santa Clara",
            "grant_number": "SFMP-2026-001",
            "total_budget": 15000.00,
            "spent_to_date": 3200.00,
            "expires_at": "2026-10-31"
        },
        "eligible_products": ["SKU-001", "SKU-002", "SKU-003", "SKU-004", "SKU-005"],
        "verification_required": True,
        "active_since": "2026-01-01",
        "expires_at": "2026-10-31"
    },
    {
        "program_id": "PROG-003",
        "name": "Community Food Bank",
        "type": "food_bank",
        "status": "active",
        "subsidy_percent": 100.0,
        "grant": {
            "provider": "Second Harvest Food Bank",
            "grant_number": "CFB-2026-045",
            "total_budget": 50000.00,
            "spent_to_date": 12450.00,
            "expires_at": "2026-06-30"
        },
        "eligible_products": ["all"],
        "verification_required": False,
        "active_since": "2025-07-01",
        "expires_at": "2026-06-30"
    }
]

# ============================================================================
# API ENDPOINTS
# ============================================================================

@router.get("/farm-sales/inventory")
async def get_inventory() -> Dict[str, Any]:
    """Get current product inventory for retail sales"""
    try:
        # In production, query actual inventory from database
        # For now, return sample data
        return {
            "ok": True,
            "inventory": SAMPLE_INVENTORY,
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/farm-sales/orders")
async def get_orders(
    date_from: Optional[str] = Query(None, description="Filter orders from date (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="Filter orders to date (YYYY-MM-DD)"),
    status: Optional[OrderStatus] = Query(None, description="Filter by order status"),
    channel: Optional[OrderChannel] = Query(None, description="Filter by sales channel")
) -> Dict[str, Any]:
    """Get sales orders with optional filters"""
    try:
        filtered_orders = ORDERS_DB.copy()
        
        # Apply filters
        if date_from:
            filtered_orders = [
                o for o in filtered_orders 
                if o["timestamps"]["created_at"] >= date_from
            ]
        
        if date_to:
            filtered_orders = [
                o for o in filtered_orders 
                if o["timestamps"]["created_at"] <= date_to
            ]
        
        if status:
            filtered_orders = [o for o in filtered_orders if o["status"] == status]
        
        if channel:
            filtered_orders = [o for o in filtered_orders if o["channel"] == channel]
        
        return {
            "ok": True,
            "orders": filtered_orders,
            "count": len(filtered_orders),
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/farm-sales/pos/checkout")
async def checkout(request: CheckoutRequest) -> Dict[str, Any]:
    """Process POS checkout and create order"""
    try:
        # Validate items exist in inventory
        for item in request.items:
            product = next((p for p in SAMPLE_INVENTORY if p["sku_id"] == item.sku_id), None)
            if not product:
                raise HTTPException(status_code=404, detail=f"Product {item.sku_id} not found")
            if product["available"] < item.quantity:
                raise HTTPException(status_code=400, detail=f"Insufficient inventory for {product['name']}")
        
        # Calculate pricing
        subtotal = 0.0
        taxable_subtotal = 0.0
        items_with_prices = []
        
        for item in request.items:
            product = next(p for p in SAMPLE_INVENTORY if p["sku_id"] == item.sku_id)
            unit_price = product["retail_price"]
            line_total = unit_price * item.quantity
            subtotal += line_total
            
            if product["is_taxable"]:
                taxable_subtotal += line_total
            
            items_with_prices.append({
                "sku_id": item.sku_id,
                "name": product["name"],
                "quantity": item.quantity,
                "unit_price": unit_price,
                "line_total": line_total,
                "lot_code": product.get("lot_code")
            })
        
        # Calculate tax (8% on taxable items)
        tax = round(taxable_subtotal * 0.08, 2)
        total = round(subtotal + tax, 2)
        
        # Validate payment
        if request.payment.method == PaymentMethod.CASH:
            if not request.payment.tendered or request.payment.tendered < total:
                raise HTTPException(status_code=400, detail="Insufficient cash tendered")
        
        # Process payment (in production, integrate with Square/Stripe)
        payment_result = {
            "method": request.payment.method,
            "amount": total,
            "status": "completed",
            "transaction_id": f"TXN-{uuid.uuid4().hex[:12].upper()}"
        }
        
        if request.payment.method == PaymentMethod.CASH:
            payment_result["tendered"] = request.payment.tendered
            payment_result["change"] = round(request.payment.tendered - total, 2)
        
        # Create order
        order_id = f"ORD-{datetime.now().strftime('%Y%m%d')}-{len(ORDERS_DB) + 1:04d}"
        now = datetime.utcnow().isoformat()
        
        order = {
            "order_id": order_id,
            "channel": "pos",
            "status": "completed",
            "customer": request.customer.dict() if request.customer else None,
            "items": items_with_prices,
            "pricing": {
                "subtotal": subtotal,
                "tax": tax,
                "discount": 0.0,
                "subsidy": 0.0,
                "total": total
            },
            "payment": payment_result,
            "cashier": request.cashier.dict() if request.cashier else None,
            "timestamps": {
                "created_at": now,
                "completed_at": now
            },
            "notes": request.notes
        }
        
        # Update inventory (reduce available quantity)
        for item in request.items:
            product = next(p for p in SAMPLE_INVENTORY if p["sku_id"] == item.sku_id)
            product["available"] -= item.quantity
        
        # Store order
        ORDERS_DB.append(order)
        
        return {
            "ok": True,
            "message": "Checkout completed successfully",
            "receipt": order,
            "timestamp": now
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Checkout failed: {str(e)}")


@router.get("/farm-sales/donations/programs")
async def get_donation_programs(
    status: Optional[ProgramStatus] = Query(None, description="Filter by program status")
) -> Dict[str, Any]:
    """Get food assistance/donation programs"""
    try:
        programs = DONATION_PROGRAMS.copy()
        
        if status:
            programs = [p for p in programs if p["status"] == status]
        
        return {
            "ok": True,
            "programs": programs,
            "count": len(programs),
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/farm/square/status")
async def get_square_status() -> Dict[str, Any]:
    """Get Square payment processor connection status"""
    try:
        # In production, check actual Square API credentials and connection
        # For now, return mock status
        return {
            "ok": True,
            "connected": False,
            "message": "Square payment processing not configured. Contact administrator.",
            "data": {
                "application_id": None,
                "location_id": None,
                "merchant_name": None
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/farm-sales/orders/{order_id}/refund")
async def refund_order(order_id: str, reason: Optional[str] = None) -> Dict[str, Any]:
    """Refund a completed order"""
    try:
        order = next((o for o in ORDERS_DB if o["order_id"] == order_id), None)
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        
        if order["status"] != "completed":
            raise HTTPException(status_code=400, detail="Only completed orders can be refunded")
        
        # Process refund (in production, call payment processor API)
        order["status"] = "refunded"
        order["timestamps"]["refunded_at"] = datetime.utcnow().isoformat()
        if reason:
            order["refund_reason"] = reason
        
        # Return items to inventory
        for item in order["items"]:
            product = next((p for p in SAMPLE_INVENTORY if p["sku_id"] == item["sku_id"]), None)
            if product:
                product["available"] += item["quantity"]
        
        return {
            "ok": True,
            "message": "Order refunded successfully",
            "order": order
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/farm-sales/reports/daily")
async def get_daily_report(report_date: Optional[str] = Query(None)) -> Dict[str, Any]:
    """Get daily sales report"""
    try:
        target_date = report_date or date.today().isoformat()
        
        # Filter orders for target date
        daily_orders = [
            o for o in ORDERS_DB 
            if o["timestamps"]["created_at"].startswith(target_date) and o["status"] == "completed"
        ]
        
        # Calculate totals
        total_revenue = sum(o["pricing"]["total"] for o in daily_orders)
        total_orders = len(daily_orders)
        total_items = sum(len(o["items"]) for o in daily_orders)
        
        # Break down by channel
        by_channel = {}
        for order in daily_orders:
            channel = order["channel"]
            if channel not in by_channel:
                by_channel[channel] = {"orders": 0, "revenue": 0.0}
            by_channel[channel]["orders"] += 1
            by_channel[channel]["revenue"] += order["pricing"]["total"]
        
        # Top products
        product_sales = {}
        for order in daily_orders:
            for item in order["items"]:
                sku = item["sku_id"]
                if sku not in product_sales:
                    product_sales[sku] = {
                        "name": item["name"],
                        "quantity": 0,
                        "revenue": 0.0
                    }
                product_sales[sku]["quantity"] += item["quantity"]
                product_sales[sku]["revenue"] += item["line_total"]
        
        top_products = sorted(
            product_sales.items(),
            key=lambda x: x[1]["revenue"],
            reverse=True
        )[:5]
        
        return {
            "ok": True,
            "date": target_date,
            "summary": {
                "total_revenue": round(total_revenue, 2),
                "total_orders": total_orders,
                "total_items": total_items,
                "average_order_value": round(total_revenue / total_orders, 2) if total_orders > 0 else 0
            },
            "by_channel": by_channel,
            "top_products": [
                {"sku_id": sku, **data} for sku, data in top_products
            ],
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
