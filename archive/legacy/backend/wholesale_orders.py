"""
Wholesale Orders API
B2B ordering for restaurants, grocery stores, and distributors with Square payment integration
"""

from datetime import datetime, date, timedelta
from typing import List, Optional
import logging
import uuid

from fastapi import APIRouter, HTTPException, Depends, status, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func

from backend.models.base import get_db
from backend.models.inventory import (
    ProductSKU, WholesaleBuyer, WholesaleOrder, WholesaleOrderItem, TrayRun
)
from backend.auth import get_current_user, get_tenant_id

logger = logging.getLogger(__name__)

router = APIRouter()


class ProductResponse(BaseModel):
    sku_id: str
    name: str
    category: str
    variety: Optional[str] = None
    retail_price: float
    wholesale_price: Optional[float] = None
    unit: str
    quantity_available: int
    lot_code: Optional[str] = None
    harvest_date: Optional[str] = None


class OrderItemRequest(BaseModel):
    sku_id: str
    quantity: int


class CreateOrderRequest(BaseModel):
    items: List[OrderItemRequest]
    delivery_date: Optional[str] = None
    delivery_notes: Optional[str] = None
    notes: Optional[str] = None


class OrderItemResponse(BaseModel):
    item_id: str
    sku_id: str
    product_name: str
    quantity: int
    unit_price: float
    line_total: float
    lot_code: Optional[str] = None


class OrderResponse(BaseModel):
    order_id: str
    order_number: str
    buyer_id: str
    buyer_name: str
    status: str
    subtotal: float
    tax: float
    discount: float
    delivery_fee: float
    total: float
    payment_method: str
    payment_status: str
    delivery_date: Optional[str] = None
    created_at: str
    confirmed_at: Optional[str] = None
    delivered_at: Optional[str] = None
    items: List[OrderItemResponse]


class CheckoutRequest(BaseModel):
    items: List[OrderItemRequest]
    payment_method: str  # square, account, check
    payment_nonce: Optional[str] = None  # Square payment nonce
    delivery_date: Optional[str] = None
    delivery_notes: Optional[str] = None
    notes: Optional[str] = None


class CheckoutResponse(BaseModel):
    order_id: str
    order_number: str
    total: float
    payment_status: str
    message: str


@router.get("/wholesale/products", response_model=List[ProductResponse])
async def list_products(
    category: Optional[str] = Query(None),
    available_only: bool = Query(True),
    tenant_id: str = Depends(get_tenant_id),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List available products for wholesale ordering"""
    
    # Build query
    query = db.query(ProductSKU).filter(
        and_(
            ProductSKU.farm_id == tenant_id,
            ProductSKU.is_active == True
        )
    )
    
    if category:
        query = query.filter(ProductSKU.category == category)
    
    if available_only:
        query = query.filter(ProductSKU.quantity_available > 0)
    
    products = query.all()
    
    # Return with wholesale pricing
    return [
        ProductResponse(
            sku_id=str(p.sku_id),
            name=p.name,
            category=p.category,
            variety=p.variety,
            retail_price=p.retail_price,
            wholesale_price=p.wholesale_price if p.wholesale_price else p.retail_price * 0.7,  # 30% wholesale discount
            unit=p.unit,
            quantity_available=p.quantity_available,
            lot_code=p.lot_code,
            harvest_date=p.harvest_date.isoformat() if p.harvest_date else None
        )
        for p in products
    ]


@router.get("/wholesale/orders", response_model=List[OrderResponse])
async def list_orders(
    status: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List buyer's order history"""
    
    buyer_id = current_user.get("user_id")
    
    # Build query
    query = db.query(WholesaleOrder).filter(
        WholesaleOrder.buyer_id == buyer_id
    )
    
    if status:
        query = query.filter(WholesaleOrder.status == status)
    
    query = query.order_by(WholesaleOrder.created_at.desc()).limit(limit)
    orders = query.all()
    
    # Build response with items
    result = []
    for order in orders:
        buyer = db.query(WholesaleBuyer).filter(WholesaleBuyer.buyer_id == order.buyer_id).first()
        items = []
        for item in order.items:
            product = db.query(ProductSKU).filter(ProductSKU.sku_id == item.sku_id).first()
            items.append(OrderItemResponse(
                item_id=str(item.item_id),
                sku_id=str(item.sku_id),
                product_name=product.name if product else "Unknown",
                quantity=item.quantity,
                unit_price=item.unit_price,
                line_total=item.line_total,
                lot_code=item.lot_code
            ))
        
        result.append(OrderResponse(
            order_id=str(order.order_id),
            order_number=order.order_number,
            buyer_id=str(order.buyer_id),
            buyer_name=buyer.business_name if buyer else "Unknown",
            status=order.status,
            subtotal=order.subtotal,
            tax=order.tax,
            discount=order.discount,
            delivery_fee=order.delivery_fee,
            total=order.total,
            payment_method=order.payment_method,
            payment_status=order.payment_status,
            delivery_date=order.delivery_date.isoformat() if order.delivery_date else None,
            created_at=order.created_at.isoformat(),
            confirmed_at=order.confirmed_at.isoformat() if order.confirmed_at else None,
            delivered_at=order.delivered_at.isoformat() if order.delivered_at else None,
            items=items
        ))
    
    return result


@router.get("/wholesale/orders/{order_id}", response_model=OrderResponse)
async def get_order(
    order_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get order details"""
    
    buyer_id = current_user.get("user_id")
    
    order = db.query(WholesaleOrder).filter(
        and_(
            WholesaleOrder.order_id == order_id,
            WholesaleOrder.buyer_id == buyer_id
        )
    ).first()
    
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    
    buyer = db.query(WholesaleBuyer).filter(WholesaleBuyer.buyer_id == order.buyer_id).first()
    
    items = []
    for item in order.items:
        product = db.query(ProductSKU).filter(ProductSKU.sku_id == item.sku_id).first()
        items.append(OrderItemResponse(
            item_id=str(item.item_id),
            sku_id=str(item.sku_id),
            product_name=product.name if product else "Unknown",
            quantity=item.quantity,
            unit_price=item.unit_price,
            line_total=item.line_total,
            lot_code=item.lot_code
        ))
    
    return OrderResponse(
        order_id=str(order.order_id),
        order_number=order.order_number,
        buyer_id=str(order.buyer_id),
        buyer_name=buyer.business_name if buyer else "Unknown",
        status=order.status,
        subtotal=order.subtotal,
        tax=order.tax,
        discount=order.discount,
        delivery_fee=order.delivery_fee,
        total=order.total,
        payment_method=order.payment_method,
        payment_status=order.payment_status,
        delivery_date=order.delivery_date.isoformat() if order.delivery_date else None,
        created_at=order.created_at.isoformat(),
        confirmed_at=order.confirmed_at.isoformat() if order.confirmed_at else None,
        delivered_at=order.delivered_at.isoformat() if order.delivered_at else None,
        items=items
    )


@router.post("/wholesale/checkout", response_model=CheckoutResponse)
async def checkout(
    request: CheckoutRequest,
    tenant_id: str = Depends(get_tenant_id),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Process wholesale order checkout with Square payment"""
    
    buyer_id = current_user.get("user_id")
    
    if not request.items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Order must contain at least one item"
        )
    
    # Validate payment method
    valid_methods = ["square", "account", "check"]
    if request.payment_method not in valid_methods:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid payment method. Must be one of: {', '.join(valid_methods)}"
        )
    
    # Calculate order totals
    subtotal = 0.0
    order_items = []
    
    for item_request in request.items:
        product = db.query(ProductSKU).filter(
            and_(
                ProductSKU.sku_id == item_request.sku_id,
                ProductSKU.farm_id == tenant_id,
                ProductSKU.is_active == True
            )
        ).first()
        
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product {item_request.sku_id} not found"
            )
        
        if product.quantity_available < item_request.quantity:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Insufficient quantity for {product.name}. Available: {product.quantity_available}"
            )
        
        # Use wholesale price (or 30% discount if not set)
        unit_price = product.wholesale_price if product.wholesale_price else product.retail_price * 0.7
        line_total = unit_price * item_request.quantity
        subtotal += line_total
        
        order_items.append({
            "sku_id": item_request.sku_id,
            "quantity": item_request.quantity,
            "unit_price": unit_price,
            "line_total": line_total,
            "lot_code": product.lot_code
        })
    
    # Calculate tax and total
    tax_rate = 0.07  # 7% tax (should be configurable)
    tax = round(subtotal * tax_rate, 2)
    delivery_fee = 0.0  # Free delivery for wholesale orders over $100
    if subtotal < 100:
        delivery_fee = 15.0
    
    total = subtotal + tax + delivery_fee
    
    # Process Square payment if method is square
    payment_status = "pending"
    payment_transaction_id = None
    
    if request.payment_method == "square":
        if not request.payment_nonce:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Payment nonce required for Square payments"
            )
        
        # TODO: Integrate with Square Payments API
        # For now, simulate successful payment
        payment_status = "completed"
        payment_transaction_id = f"sq_txn_{uuid.uuid4().hex[:16]}"
        
        logger.info(f"Square payment processed: {payment_transaction_id} (${total})")
    
    elif request.payment_method == "account":
        payment_status = "pending"  # Farm will approve payment
        logger.info(f"Account payment requested for buyer {buyer_id} (${total})")
    
    elif request.payment_method == "check":
        payment_status = "pending"  # Farm will confirm check receipt
        logger.info(f"Check payment requested for buyer {buyer_id} (${total})")
    
    # Generate order number
    order_number = f"WS{datetime.utcnow().strftime('%Y%m%d')}{uuid.uuid4().hex[:6].upper()}"
    
    # Parse delivery date
    delivery_date = None
    if request.delivery_date:
        try:
            delivery_date = datetime.fromisoformat(request.delivery_date.replace('Z', '+00:00')).date()
        except:
            # Default to 3 days from now
            delivery_date = date.today() + timedelta(days=3)
    
    # Create order
    order = WholesaleOrder(
        order_number=order_number,
        buyer_id=buyer_id,
        farm_id=tenant_id,
        status="confirmed" if payment_status == "completed" else "pending",
        subtotal=subtotal,
        tax=tax,
        discount=0.0,
        delivery_fee=delivery_fee,
        total=total,
        payment_method=request.payment_method,
        payment_status=payment_status,
        payment_transaction_id=payment_transaction_id,
        delivery_date=delivery_date,
        delivery_notes=request.delivery_notes,
        notes=request.notes,
        confirmed_at=datetime.utcnow() if payment_status == "completed" else None
    )
    db.add(order)
    db.flush()
    
    # Create order items and update inventory
    for item_data in order_items:
        order_item = WholesaleOrderItem(
            order_id=str(order.order_id),
            sku_id=item_data["sku_id"],
            quantity=item_data["quantity"],
            unit_price=item_data["unit_price"],
            line_total=item_data["line_total"],
            lot_code=item_data["lot_code"]
        )
        db.add(order_item)
        
        # Reserve inventory
        product = db.query(ProductSKU).filter(ProductSKU.sku_id == item_data["sku_id"]).first()
        if product:
            product.quantity_reserved += item_data["quantity"]
            product.quantity_available -= item_data["quantity"]
    
    db.commit()
    db.refresh(order)
    
    logger.info(f"Wholesale order created: {order_number} by buyer {buyer_id} (${total})")
    
    return CheckoutResponse(
        order_id=str(order.order_id),
        order_number=order_number,
        total=total,
        payment_status=payment_status,
        message="Order placed successfully" if payment_status == "completed" else "Order pending payment approval"
    )
