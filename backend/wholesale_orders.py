"""
Wholesale Order Management System
Handles multi-farm order splitting, verification, and payment workflow
"""

from datetime import datetime, timedelta
from typing import Optional, List, Dict
from enum import Enum
import stripe
import os

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

# Configure Stripe (use environment variable for key)
stripe.api_key = os.getenv('STRIPE_SECRET_KEY', 'sk_test_placeholder')

router = APIRouter(prefix="/api/wholesale/orders", tags=["wholesale_orders"])


class OrderStatus(str, Enum):
    PENDING_PAYMENT = "pending_payment"
    PAYMENT_AUTHORIZED = "payment_authorized"
    SPLIT_COMPLETE = "split_complete"
    PENDING_FARM_VERIFICATION = "pending_farm_verification"
    FARMS_VERIFIED = "farms_verified"
    PARTIAL_VERIFICATION = "partial_verification"
    SEEKING_ALTERNATIVES = "seeking_alternatives"
    PENDING_BUYER_REVIEW = "pending_buyer_review"
    BUYER_APPROVED = "buyer_approved"
    BUYER_REJECTED = "buyer_rejected"
    READY_FOR_PICKUP = "ready_for_pickup"
    PARTIALLY_PICKED_UP = "partially_picked_up"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"


class SubOrderStatus(str, Enum):
    PENDING_FARM = "pending_farm"
    FARM_ACCEPTED = "farm_accepted"
    FARM_DECLINED = "farm_declined"
    FARM_MODIFIED = "farm_modified"
    ALTERNATIVE_PENDING = "alternative_pending"
    ALTERNATIVE_ACCEPTED = "alternative_accepted"
    READY_FOR_PICKUP = "ready_for_pickup"
    PICKED_UP = "picked_up"
    PAYMENT_CAPTURED = "payment_captured"
    FARM_PAID = "farm_paid"


# Pydantic Models
class CartItem(BaseModel):
    sku_id: int
    product_name: str
    quantity: float
    unit: str
    price_per_unit: float
    farm_id: str


class CreateOrderRequest(BaseModel):
    buyer_id: int
    buyer_name: str
    buyer_email: str
    buyer_phone: str
    delivery_address: str
    delivery_city: str
    delivery_province: str
    delivery_postal_code: str
    cart_items: List[CartItem]
    payment_method_id: str  # Stripe payment method ID
    fulfillment_cadence: str = "one_time"
    delivery_instructions: Optional[str] = None


class FarmVerificationRequest(BaseModel):
    farm_id: str
    sub_order_id: int
    action: str  # "accept", "decline", "modify"
    modified_items: Optional[List[Dict]] = None
    decline_reason: Optional[str] = None


class BuyerReviewRequest(BaseModel):
    order_id: int
    action: str  # "accept", "reject"
    rejection_reason: Optional[str] = None


class PickupConfirmationRequest(BaseModel):
    sub_order_id: int
    qr_code: str
    farm_id: str


# Database would be PostgreSQL - these are placeholder functions
class WholesaleOrderDB:
    """Placeholder for database operations"""
    
    @staticmethod
    async def create_order(order_data: dict) -> int:
        """Create main wholesale order record"""
        # INSERT INTO wholesale_orders ... RETURNING id
        return 1  # Placeholder order_id
    
    @staticmethod
    async def create_sub_orders(order_id: int, sub_orders: List[dict]) -> List[int]:
        """Create farm sub-orders"""
        # INSERT INTO farm_sub_orders ... RETURNING id
        return [1, 2, 3]  # Placeholder sub_order_ids
    
    @staticmethod
    async def create_line_items(sub_order_id: int, items: List[dict]) -> None:
        """Create order line items"""
        # INSERT INTO order_line_items
        pass
    
    @staticmethod
    async def update_order_status(order_id: int, status: OrderStatus) -> None:
        """Update main order status"""
        # UPDATE wholesale_orders SET status = ? WHERE id = ?
        pass
    
    @staticmethod
    async def update_sub_order_status(sub_order_id: int, status: SubOrderStatus) -> None:
        """Update sub-order status"""
        # UPDATE farm_sub_orders SET status = ? WHERE id = ?
        pass
    
    @staticmethod
    async def get_order(order_id: int) -> dict:
        """Get order with all sub-orders and items"""
        # SELECT with JOINs
        return {}
    
    @staticmethod
    async def get_pending_farm_orders(farm_id: str) -> List[dict]:
        """Get orders awaiting farm verification"""
        # SELECT WHERE farm_id = ? AND status = 'pending_farm'
        return []
    
    @staticmethod
    async def create_pickup_confirmation(sub_order_id: int, qr_code: str) -> None:
        """Record pickup confirmation"""
        # INSERT INTO pickup_confirmations
        pass


class StripePaymentService:
    """Stripe payment authorization and capture"""
    
    @staticmethod
    async def authorize_payment(amount_cents: int, payment_method_id: str, 
                               customer_email: str, metadata: dict) -> str:
        """Create payment intent with authorization hold"""
        try:
            intent = stripe.PaymentIntent.create(
                amount=amount_cents,
                currency='cad',
                payment_method=payment_method_id,
                customer_email=customer_email,
                capture_method='manual',  # Hold funds, don't capture yet
                confirm=True,
                metadata=metadata
            )
            return intent.id
        except stripe.error.StripeError as e:
            raise HTTPException(status_code=400, detail=f"Payment authorization failed: {str(e)}")
    
    @staticmethod
    async def capture_payment(payment_intent_id: str, amount_cents: Optional[int] = None) -> bool:
        """Capture authorized payment (after pickup confirmed)"""
        try:
            intent = stripe.PaymentIntent.capture(
                payment_intent_id,
                amount_to_capture=amount_cents  # Can capture partial amount
            )
            return intent.status == 'succeeded'
        except stripe.error.StripeError as e:
            raise HTTPException(status_code=400, detail=f"Payment capture failed: {str(e)}")
    
    @staticmethod
    async def cancel_authorization(payment_intent_id: str) -> bool:
        """Cancel payment authorization (if order cancelled)"""
        try:
            intent = stripe.PaymentIntent.cancel(payment_intent_id)
            return intent.status == 'canceled'
        except stripe.error.StripeError as e:
            raise HTTPException(status_code=400, detail=f"Payment cancellation failed: {str(e)}")
    
    @staticmethod
    async def payout_to_farm(farm_stripe_account_id: str, amount_cents: int, 
                            order_id: int) -> str:
        """Transfer payment to farm (after platform fee deduction)"""
        try:
            transfer = stripe.Transfer.create(
                amount=amount_cents,
                currency='cad',
                destination=farm_stripe_account_id,
                metadata={'order_id': order_id}
            )
            return transfer.id
        except stripe.error.StripeError as e:
            raise HTTPException(status_code=400, detail=f"Farm payout failed: {str(e)}")


class NotificationService:
    """Email/SMS notifications for farms and buyers"""
    
    @staticmethod
    async def notify_farms_new_order(farm_ids: List[str], order_id: int) -> None:
        """Send notifications to farms about new orders"""
        # Implementation: Send email/SMS via SES, Twilio, etc.
        pass
    
    @staticmethod
    async def notify_buyer_order_placed(buyer_email: str, order_id: int) -> None:
        """Confirm order placement to buyer"""
        pass
    
    @staticmethod
    async def notify_buyer_modifications(buyer_email: str, order_id: int) -> None:
        """Notify buyer of farm modifications requiring review"""
        pass
    
    @staticmethod
    async def notify_farm_verification_deadline(farm_id: str, sub_order_id: int) -> None:
        """Reminder for farm verification deadline"""
        pass


# API Endpoints

@router.post("/create")
async def create_wholesale_order(request: CreateOrderRequest):
    """
    Create new wholesale order with payment authorization
    - Splits order by farm
    - Authorizes payment (hold, not charge)
    - Notifies farms for verification
    """
    
    # 1. Calculate totals
    total_amount = sum(item.price_per_unit * item.quantity for item in request.cart_items)
    total_cents = int(total_amount * 100)
    
    # 2. Authorize payment with Stripe
    payment_intent_id = await StripePaymentService.authorize_payment(
        amount_cents=total_cents,
        payment_method_id=request.payment_method_id,
        customer_email=request.buyer_email,
        metadata={
            'buyer_name': request.buyer_name,
            'order_type': 'wholesale',
            'fulfillment_cadence': request.fulfillment_cadence
        }
    )
    
    # 3. Create main order record
    order_data = {
        'buyer_id': request.buyer_id,
        'buyer_name': request.buyer_name,
        'buyer_email': request.buyer_email,
        'buyer_phone': request.buyer_phone,
        'delivery_address': request.delivery_address,
        'delivery_city': request.delivery_city,
        'delivery_province': request.delivery_province,
        'delivery_postal_code': request.delivery_postal_code,
        'total_amount': total_amount,
        'status': OrderStatus.PAYMENT_AUTHORIZED,
        'payment_intent_id': payment_intent_id,
        'fulfillment_cadence': request.fulfillment_cadence,
        'delivery_instructions': request.delivery_instructions,
        'created_at': datetime.utcnow(),
        'verification_deadline': datetime.utcnow() + timedelta(hours=24)
    }
    
    order_id = await WholesaleOrderDB.create_order(order_data)
    
    # 4. Split order by farm
    farm_orders = {}
    for item in request.cart_items:
        if item.farm_id not in farm_orders:
            farm_orders[item.farm_id] = []
        farm_orders[item.farm_id].append(item)
    
    # 5. Create sub-orders for each farm
    sub_order_ids = []
    for farm_id, items in farm_orders.items():
        farm_total = sum(item.price_per_unit * item.quantity for item in items)
        
        sub_order_data = {
            'wholesale_order_id': order_id,
            'farm_id': farm_id,
            'status': SubOrderStatus.PENDING_FARM,
            'sub_total': farm_total,
            'verification_deadline': datetime.utcnow() + timedelta(hours=24)
        }
        
        sub_order_id = (await WholesaleOrderDB.create_sub_orders(order_id, [sub_order_data]))[0]
        sub_order_ids.append(sub_order_id)
        
        # Create line items for sub-order
        line_items = [
            {
                'sub_order_id': sub_order_id,
                'sku_id': item.sku_id,
                'product_name': item.product_name,
                'quantity': item.quantity,
                'unit': item.unit,
                'price_per_unit': item.price_per_unit,
                'line_total': item.price_per_unit * item.quantity
            }
            for item in items
        ]
        await WholesaleOrderDB.create_line_items(sub_order_id, line_items)
    
    # 6. Update order status to pending verification
    await WholesaleOrderDB.update_order_status(order_id, OrderStatus.PENDING_FARM_VERIFICATION)
    
    # 7. Notify farms
    await NotificationService.notify_farms_new_order(list(farm_orders.keys()), order_id)
    
    # 8. Notify buyer
    await NotificationService.notify_buyer_order_placed(request.buyer_email, order_id)
    
    return {
        "ok": True,
        "order_id": order_id,
        "sub_order_ids": sub_order_ids,
        "payment_intent_id": payment_intent_id,
        "total_amount": total_amount,
        "verification_deadline": order_data['verification_deadline'].isoformat(),
        "message": "Order placed successfully. Farms have 24 hours to verify."
    }


@router.post("/farm-verify")
async def farm_verify_order(request: FarmVerificationRequest):
    """
    Farm accepts/declines/modifies their portion of an order
    """
    
    if request.action == "accept":
        await WholesaleOrderDB.update_sub_order_status(
            request.sub_order_id, 
            SubOrderStatus.FARM_ACCEPTED
        )
        return {"ok": True, "message": "Order accepted"}
    
    elif request.action == "decline":
        await WholesaleOrderDB.update_sub_order_status(
            request.sub_order_id,
            SubOrderStatus.FARM_DECLINED
        )
        # TODO: Trigger alternative farm matching
        return {"ok": True, "message": "Order declined. Seeking alternative farms."}
    
    elif request.action == "modify":
        await WholesaleOrderDB.update_sub_order_status(
            request.sub_order_id,
            SubOrderStatus.FARM_MODIFIED
        )
        # TODO: Store modifications and notify buyer
        await NotificationService.notify_buyer_modifications(
            "buyer@example.com",  # Get from order
            request.sub_order_id
        )
        return {"ok": True, "message": "Modifications recorded. Buyer will review."}


@router.post("/buyer-review")
async def buyer_review_modifications(request: BuyerReviewRequest):
    """
    Buyer accepts/rejects farm modifications
    """
    
    if request.action == "accept":
        await WholesaleOrderDB.update_order_status(
            request.order_id,
            OrderStatus.BUYER_APPROVED
        )
        # TODO: Update payment authorization if total changed
        return {"ok": True, "message": "Order approved"}
    
    elif request.action == "reject":
        await WholesaleOrderDB.update_order_status(
            request.order_id,
            OrderStatus.BUYER_REJECTED
        )
        # TODO: Cancel order and refund payment authorization
        return {"ok": True, "message": "Order rejected. Payment authorization cancelled."}


@router.post("/confirm-pickup")
async def confirm_pickup(request: PickupConfirmationRequest):
    """
    Confirm pickup with QR code scan
    Triggers payment capture for this farm's portion
    """
    
    # 1. Validate QR code
    # TODO: Implement QR code validation
    
    # 2. Update sub-order status
    await WholesaleOrderDB.update_sub_order_status(
        request.sub_order_id,
        SubOrderStatus.PICKED_UP
    )
    
    # 3. Record pickup confirmation
    await WholesaleOrderDB.create_pickup_confirmation(
        request.sub_order_id,
        request.qr_code
    )
    
    # 4. Capture payment for this sub-order
    # TODO: Calculate sub-order amount and capture from payment intent
    
    # 5. Check if all sub-orders picked up
    # TODO: If all complete, mark main order as COMPLETED
    
    return {
        "ok": True,
        "message": "Pickup confirmed. Payment captured."
    }


@router.get("/pending-verification/{farm_id}")
async def get_pending_farm_orders(farm_id: str):
    """
    Get orders awaiting verification for a specific farm
    """
    orders = await WholesaleOrderDB.get_pending_farm_orders(farm_id)
    return {"ok": True, "orders": orders}


@router.get("/{order_id}")
async def get_order_details(order_id: int):
    """
    Get complete order details with all sub-orders and items
    """
    order = await WholesaleOrderDB.get_order(order_id)
    return {"ok": True, "order": order}


# Scheduled tasks (would run via cron/celery)
async def check_verification_deadlines():
    """
    Check for farm verification deadlines and send reminders
    Run every hour
    """
    # TODO: Query orders with approaching deadlines
    # TODO: Send reminder notifications
    pass


async def auto_decline_expired_verifications():
    """
    Auto-decline farm orders that exceeded verification deadline
    Run every 15 minutes
    """
    # TODO: Query sub-orders past deadline with pending status
    # TODO: Auto-decline and trigger alternative matching
    pass
