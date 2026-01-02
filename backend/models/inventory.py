"""Inventory and forecasting data models for tray lifecycle tracking."""

import uuid
import os
from datetime import datetime, date
from typing import Optional

from sqlalchemy import (
    Column,
    String,
    Integer,
    Date,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    Boolean,
    Float,
)
from sqlalchemy.orm import relationship

from .base import Base

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./lightengine.db")
USE_SQLITE = DATABASE_URL.startswith("sqlite")


# Helper to choose UUID column type based on database
if USE_SQLITE:
    def UUIDColumn(**kwargs):
        return Column(String(36), default=lambda: str(uuid.uuid4()), **kwargs)
else:
    from sqlalchemy.dialects.postgresql import UUID

    def UUIDColumn(**kwargs):
        return Column(UUID(as_uuid=True), default=uuid.uuid4, **kwargs)


class TimestampMixin:
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class TrayFormat(Base, TimestampMixin):
    __tablename__ = "tray_formats"

    tray_format_id = UUIDColumn(primary_key=True)
    name = Column(String(100), nullable=False)
    plant_site_count = Column(Integer, nullable=False)
    
    # Growing system details
    system_type = Column(String(50), nullable=True)  # aeroponics, nft, zipgrow, dwc, low_pressure_aero, soil
    tray_material = Column(String(50), nullable=True)  # plastic, metal, tower
    description = Column(String(500), nullable=True)
    
    # Yield forecasting
    target_weight_per_site = Column(Float, nullable=True)  # oz per planting location
    weight_unit = Column(String(20), nullable=True, default="oz")  # oz, lbs, g, kg
    is_weight_based = Column(Boolean, nullable=False, default=False)  # True for microgreens, False for heads
    
    # Crowd-sourced format tracking
    is_custom = Column(Boolean, nullable=False, default=False)  # Farm-created custom format
    created_by_farm_id = Column(String(36), nullable=True)  # Farm that created this format
    is_approved = Column(Boolean, nullable=False, default=True)  # GreenReach approval for system-wide use
    approval_notes = Column(String(500), nullable=True)

    trays = relationship("Tray", back_populates="tray_format")


class Tray(Base, TimestampMixin):
    __tablename__ = "trays"
    __table_args__ = (UniqueConstraint("qr_code_value", name="uq_tray_qr"),)

    tray_id = UUIDColumn(primary_key=True)
    qr_code_value = Column(String(255), nullable=False)
    tray_format_id = Column(String(36), ForeignKey("tray_formats.tray_format_id"), nullable=False)

    tray_format = relationship("TrayFormat", back_populates="trays")
    runs = relationship("TrayRun", back_populates="tray")


class Farm(Base, TimestampMixin):
    __tablename__ = "farms"

    farm_id = UUIDColumn(primary_key=True)
    name = Column(String(100), nullable=False, unique=True)

    rooms = relationship("Room", back_populates="farm")


class Room(Base, TimestampMixin):
    __tablename__ = "rooms"

    room_id = UUIDColumn(primary_key=True)
    name = Column(String(100), nullable=False)
    farm_id = Column(String(36), ForeignKey("farms.farm_id"), nullable=False)

    farm = relationship("Farm", back_populates="rooms")
    zones = relationship("Zone", back_populates="room")


class Zone(Base, TimestampMixin):
    __tablename__ = "zones"

    zone_id = UUIDColumn(primary_key=True)
    name = Column(String(100), nullable=False)
    room_id = Column(String(36), ForeignKey("rooms.room_id"), nullable=False)

    room = relationship("Room", back_populates="zones")
    groups = relationship("Group", back_populates="zone")


class Group(Base, TimestampMixin):
    __tablename__ = "groups"

    group_id = UUIDColumn(primary_key=True)
    name = Column(String(100), nullable=False)
    zone_id = Column(String(36), ForeignKey("zones.zone_id"), nullable=False)

    zone = relationship("Zone", back_populates="groups")
    locations = relationship("Location", back_populates="group")


class Location(Base, TimestampMixin):
    __tablename__ = "locations"
    __table_args__ = (UniqueConstraint("qr_code_value", name="uq_location_qr"),)

    location_id = UUIDColumn(primary_key=True)
    qr_code_value = Column(String(255), nullable=False)
    name = Column(String(100), nullable=True)
    group_id = Column(String(36), ForeignKey("groups.group_id"), nullable=False)

    group = relationship("Group", back_populates="locations")
    placements = relationship("TrayPlacement", back_populates="location")


class TrayRun(Base, TimestampMixin):
    __tablename__ = "tray_runs"

    tray_run_id = UUIDColumn(primary_key=True)
    tray_id = Column(String(36), ForeignKey("trays.tray_id"), nullable=False)
    recipe_id = Column(String(255), nullable=False)
    seed_date = Column(Date, nullable=False)
    planted_site_count = Column(Integer, nullable=False)
    status = Column(String(20), nullable=False, default="SEEDED")
    expected_harvest_date = Column(Date, nullable=False)
    lot_code = Column(String(100), nullable=True)
    actual_weight = Column(Float, nullable=True)
    weight_unit = Column(String(20), nullable=True)

    tray = relationship("Tray", back_populates="runs")
    placements = relationship("TrayPlacement", back_populates="tray_run")


class TrayPlacement(Base, TimestampMixin):
    __tablename__ = "tray_placements"

    placement_id = UUIDColumn(primary_key=True)
    tray_run_id = Column(String(36), ForeignKey("tray_runs.tray_run_id"), nullable=False)
    location_id = Column(String(36), ForeignKey("locations.location_id"), nullable=False)
    placed_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    removed_at = Column(DateTime, nullable=True)
    note = Column(String(255), nullable=True)

    tray_run = relationship("TrayRun", back_populates="placements")
    location = relationship("Location", back_populates="placements")


class ScanEvent(Base):
    __tablename__ = "scan_events"

    scan_event_id = UUIDColumn(primary_key=True)
    type = Column(String(50), nullable=False)
    raw_value = Column(String(255), nullable=False)
    actor_user_id = Column(String(50), nullable=True)
    tray_id = Column(String(36), nullable=True)
    tray_run_id = Column(String(36), nullable=True)
    location_id = Column(String(36), nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)


# ============================================================================
# SALES & RETAIL MODELS
# ============================================================================

class ProductSKU(Base, TimestampMixin):
    """Product SKU for retail sales"""
    __tablename__ = "product_skus"

    sku_id = UUIDColumn(primary_key=True)
    farm_id = Column(String(36), ForeignKey("farms.farm_id"), nullable=False)
    name = Column(String(200), nullable=False)
    category = Column(String(100), nullable=False)
    variety = Column(String(100), nullable=True)
    retail_price = Column(Float, nullable=False)
    wholesale_price = Column(Float, nullable=True)
    unit = Column(String(20), nullable=False)  # lb, oz, bunch, head, each
    is_taxable = Column(Boolean, nullable=False, default=True)
    is_active = Column(Boolean, nullable=False, default=True)
    
    # Link to tray runs for traceability
    tray_run_id = Column(String(36), ForeignKey("tray_runs.tray_run_id"), nullable=True)
    lot_code = Column(String(100), nullable=True)
    harvest_date = Column(Date, nullable=True)
    
    # Inventory tracking
    quantity_available = Column(Integer, nullable=False, default=0)
    quantity_reserved = Column(Integer, nullable=False, default=0)
    
    orders = relationship("SalesOrderItem", back_populates="product")


class SalesCustomer(Base, TimestampMixin):
    """Customer for retail sales"""
    __tablename__ = "sales_customers"

    customer_id = UUIDColumn(primary_key=True)
    name = Column(String(200), nullable=False)
    email = Column(String(200), nullable=True)
    phone = Column(String(50), nullable=True)
    
    # Loyalty and gift cards
    loyalty_points = Column(Integer, nullable=False, default=0)
    gift_card_balance = Column(Float, nullable=False, default=0.0)
    
    orders = relationship("SalesOrder", back_populates="customer")


class SalesOrder(Base, TimestampMixin):
    """Sales order (POS, online, wholesale)"""
    __tablename__ = "sales_orders"

    order_id = UUIDColumn(primary_key=True)
    order_number = Column(String(50), nullable=False, unique=True)
    
    # Customer
    customer_id = Column(String(36), ForeignKey("sales_customers.customer_id"), nullable=True)
    
    # Order details
    channel = Column(String(20), nullable=False)  # pos, online, wholesale, donation
    status = Column(String(20), nullable=False, default="pending")  # pending, completed, cancelled, refunded
    
    # Pricing
    subtotal = Column(Float, nullable=False)
    tax = Column(Float, nullable=False, default=0.0)
    discount = Column(Float, nullable=False, default=0.0)
    subsidy = Column(Float, nullable=False, default=0.0)  # For donation programs
    total = Column(Float, nullable=False)
    
    # Payment
    payment_method = Column(String(20), nullable=False)  # cash, card, gift_card, check, account
    payment_status = Column(String(20), nullable=False, default="pending")
    payment_transaction_id = Column(String(100), nullable=True)
    
    # Staff
    cashier_name = Column(String(200), nullable=True)
    cashier_employee_id = Column(String(50), nullable=True)
    
    # Timestamps
    completed_at = Column(DateTime, nullable=True)
    cancelled_at = Column(DateTime, nullable=True)
    refunded_at = Column(DateTime, nullable=True)
    
    # Notes
    notes = Column(String(1000), nullable=True)
    refund_reason = Column(String(500), nullable=True)
    
    customer = relationship("SalesCustomer", back_populates="orders")
    items = relationship("SalesOrderItem", back_populates="order")


class SalesOrderItem(Base, TimestampMixin):
    """Item in a sales order"""
    __tablename__ = "sales_order_items"

    item_id = UUIDColumn(primary_key=True)
    order_id = Column(String(36), ForeignKey("sales_orders.order_id"), nullable=False)
    sku_id = Column(String(36), ForeignKey("product_skus.sku_id"), nullable=False)
    
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Float, nullable=False)
    line_total = Column(Float, nullable=False)
    
    # Traceability
    lot_code = Column(String(100), nullable=True)
    
    order = relationship("SalesOrder", back_populates="items")
    product = relationship("ProductSKU", back_populates="orders")


class DonationProgram(Base, TimestampMixin):
    """Food assistance/donation program"""
    __tablename__ = "donation_programs"

    program_id = UUIDColumn(primary_key=True)
    name = Column(String(200), nullable=False)
    program_type = Column(String(50), nullable=False)  # snap, wic, senior, food_bank, community
    status = Column(String(20), nullable=False, default="active")  # active, inactive, pending
    
    # Subsidy
    subsidy_percent = Column(Float, nullable=False)  # 0-100
    
    # Grant details
    grant_provider = Column(String(200), nullable=False)
    grant_number = Column(String(100), nullable=False)
    grant_total_budget = Column(Float, nullable=False)
    grant_spent_to_date = Column(Float, nullable=False, default=0.0)
    
    # Eligibility
    verification_required = Column(Boolean, nullable=False, default=True)
    eligible_products = Column(String(2000), nullable=True)  # JSON list of SKU IDs or "all"
    
    # Dates
    active_since = Column(Date, nullable=False)
    expires_at = Column(Date, nullable=True)


class WholesaleBuyer(Base, TimestampMixin):
    """B2B wholesale buyer account (restaurants, grocery stores, distributors)"""
    __tablename__ = "wholesale_buyers"

    buyer_id = UUIDColumn(primary_key=True)
    farm_id = Column(String(36), ForeignKey("farms.farm_id"), nullable=False)
    
    # Business details
    business_name = Column(String(200), nullable=False)
    contact_name = Column(String(200), nullable=False)
    email = Column(String(200), nullable=False, unique=True)
    phone = Column(String(50), nullable=True)
    
    # Buyer type
    buyer_type = Column(String(50), nullable=False)  # restaurant, grocery, institutional, distributor
    
    # Location
    postal_code = Column(String(20), nullable=True)
    province = Column(String(100), nullable=True)
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    
    # Delivery preferences
    preferred_delivery_day = Column(String(20), nullable=True)  # monday, tuesday, etc
    delivery_notes = Column(String(1000), nullable=True)
    
    # Account status
    verified = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)
    
    # Relationships
    credentials = relationship("WholesaleBuyerCredentials", back_populates="buyer", uselist=False)
    orders = relationship("WholesaleOrder", back_populates="buyer")


class WholesaleBuyerCredentials(Base, TimestampMixin):
    """Secure credentials for wholesale buyer authentication"""
    __tablename__ = "wholesale_buyer_credentials"

    credential_id = UUIDColumn(primary_key=True)
    buyer_id = Column(String(36), ForeignKey("wholesale_buyers.buyer_id"), nullable=False, unique=True)
    
    # Password (bcrypt hashed)
    password_hash = Column(String(255), nullable=False)
    
    # Security
    last_login = Column(DateTime, nullable=True)
    failed_login_attempts = Column(Integer, nullable=False, default=0)
    locked_until = Column(DateTime, nullable=True)
    
    # Relationships
    buyer = relationship("WholesaleBuyer", back_populates="credentials")


class WholesaleOrder(Base, TimestampMixin):
    """Wholesale B2B order"""
    __tablename__ = "wholesale_orders"

    order_id = UUIDColumn(primary_key=True)
    order_number = Column(String(50), nullable=False, unique=True)
    
    # Buyer
    buyer_id = Column(String(36), ForeignKey("wholesale_buyers.buyer_id"), nullable=False)
    farm_id = Column(String(36), ForeignKey("farms.farm_id"), nullable=False)
    
    # Order details
    status = Column(String(20), nullable=False, default="pending")  # pending, confirmed, packed, delivered, cancelled
    
    # Pricing
    subtotal = Column(Float, nullable=False)
    tax = Column(Float, nullable=False, default=0.0)
    discount = Column(Float, nullable=False, default=0.0)
    delivery_fee = Column(Float, nullable=False, default=0.0)
    total = Column(Float, nullable=False)
    
    # Payment
    payment_method = Column(String(20), nullable=False)  # square, account, check
    payment_status = Column(String(20), nullable=False, default="pending")
    payment_transaction_id = Column(String(100), nullable=True)
    
    # Delivery
    delivery_date = Column(Date, nullable=True)
    delivery_notes = Column(String(1000), nullable=True)
    
    # Timestamps
    confirmed_at = Column(DateTime, nullable=True)
    packed_at = Column(DateTime, nullable=True)
    delivered_at = Column(DateTime, nullable=True)
    cancelled_at = Column(DateTime, nullable=True)
    
    # Notes
    notes = Column(String(1000), nullable=True)
    cancellation_reason = Column(String(500), nullable=True)
    
    # Relationships
    buyer = relationship("WholesaleBuyer", back_populates="orders")
    items = relationship("WholesaleOrderItem", back_populates="order")


class WholesaleOrderItem(Base, TimestampMixin):
    """Item in a wholesale order"""
    __tablename__ = "wholesale_order_items"

    item_id = UUIDColumn(primary_key=True)
    order_id = Column(String(36), ForeignKey("wholesale_orders.order_id"), nullable=False)
    sku_id = Column(String(36), ForeignKey("product_skus.sku_id"), nullable=False)
    
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Float, nullable=False)  # Wholesale price
    line_total = Column(Float, nullable=False)
    
    # Traceability
    lot_code = Column(String(100), nullable=True)
    
    # Relationships
    order = relationship("WholesaleOrder", back_populates="items")
    product = relationship("ProductSKU")
