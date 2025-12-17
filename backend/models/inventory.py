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
