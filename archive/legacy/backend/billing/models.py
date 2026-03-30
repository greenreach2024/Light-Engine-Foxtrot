"""
Data models for billing system.
"""

from typing import Dict, List, Optional, Any
from datetime import datetime
from pydantic import BaseModel, Field


class SubscriptionPlan(BaseModel):
    """Subscription plan definition."""
    plan_id: str
    name: str
    price: int  # In cents
    currency: str = "USD"
    interval: str = "MONTHLY"
    limits: Dict[str, int]
    overage_rates: Dict[str, int]


class Customer(BaseModel):
    """Customer record."""
    customer_id: str
    email: str
    first_name: str
    last_name: str
    tenant_id: str
    square_customer_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Subscription(BaseModel):
    """Subscription record."""
    subscription_id: str
    customer_id: str
    plan_id: str
    status: str  # active, canceled, past_due, paused
    square_subscription_id: Optional[str] = None
    current_period_start: Optional[datetime] = None
    current_period_end: Optional[datetime] = None
    cancel_at_period_end: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Payment(BaseModel):
    """Payment record."""
    payment_id: str
    customer_id: str
    subscription_id: Optional[str] = None
    amount: int  # In cents
    currency: str = "USD"
    status: str  # pending, completed, failed, refunded
    square_payment_id: Optional[str] = None
    payment_method: Optional[str] = None  # card, ach, etc.
    failure_reason: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Invoice(BaseModel):
    """Invoice record."""
    invoice_id: str
    customer_id: str
    subscription_id: Optional[str] = None
    amount_due: int  # In cents
    amount_paid: int = 0
    currency: str = "USD"
    status: str  # draft, open, paid, void, uncollectible
    due_date: Optional[datetime] = None
    paid_at: Optional[datetime] = None
    square_invoice_id: Optional[str] = None
    line_items: List[Dict[str, Any]] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class UsageRecord(BaseModel):
    """Usage tracking record."""
    tenant_id: str
    date: str  # ISO date
    devices: int = 0
    api_calls: int = 0
    storage_gb: float = 0.0
    metadata: Dict[str, Any] = {}
    created_at: datetime = Field(default_factory=datetime.utcnow)


class OverageCalculation(BaseModel):
    """Overage calculation result."""
    tenant_id: str
    plan_id: str
    usage: Dict[str, Any]
    limits: Dict[str, int]
    overages: Dict[str, Any]
    charges: Dict[str, int]
    total_overage_charge: int
    total_overage_charge_usd: str
