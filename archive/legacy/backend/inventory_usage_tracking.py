"""
Automated Inventory Usage Tracking
Calculates and records usage from tray seeding and nutrient dosing events
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta
from enum import Enum

router = APIRouter()

# ============================================================================
# MODELS
# ============================================================================

class TrayUsageEvent(BaseModel):
    """Records usage when a tray is seeded"""
    event_id: str
    tray_id: str
    tray_format: str  # e.g., "Microgreen Tray - 12 Hole"
    plant_site_count: int
    crop_variety: str
    seed_date: str
    seeds_used: int
    grow_media_kg: float
    recorded_at: str

class NutrientUsageEvent(BaseModel):
    """Records nutrient dosing from MQTT"""
    event_id: str
    nutrient_type: str  # "nutrientA", "nutrientB", "phUp", "phDown"
    volume_ml: float
    concentrate_used_ml: Optional[float] = None
    timestamp: str
    source: str = "mqtt_dosing"

class UsageSummary(BaseModel):
    """Weekly usage summary for display"""
    period_start: str
    period_end: str
    seeds_used: dict  # {variety: count}
    grow_media_kg: float
    nutrients_used: dict  # {type: ml}
    tray_count: int

# ============================================================================
# IN-MEMORY STORAGE
# ============================================================================

tray_usage_events: List[TrayUsageEvent] = []
nutrient_usage_events: List[NutrientUsageEvent] = []

# Tray format specifications for media calculation
TRAY_MEDIA_REQUIREMENTS = {
    "Microgreen Tray - 4 Hole": 1.5,
    "Microgreen Tray - 8 Hole": 1.2,
    "Microgreen Tray - 12 Hole": 1.0,
    "Microgreen Tray - 21 Hole": 0.8,
    "NFT Channel - 128 Site": 0.0,  # Hydro - no media
    "Aeroponic Tower - 72 Site": 0.0,
    "ZipGrow Tower": 2.5
}

# Seeds per planting site by crop type (defaults)
SEEDS_PER_SITE = {
    "Butterhead Lettuce": 1,
    "Arugula": 2,
    "Basil": 1,
    "Kale": 1,
    "Spinach": 2,
    "Bok Choy": 1,
    "Microgreens": 20  # Much denser seeding
}

# ============================================================================
# TRAY USAGE TRACKING
# ============================================================================

@router.post("/usage/tray-seeding")
async def record_tray_seeding(
    tray_id: str,
    tray_format: str,
    plant_site_count: int,
    crop_variety: str,
    seed_date: Optional[str] = None
):
    """
    Auto-calculate and record seed/media usage when tray is seeded
    Called by tray seeding workflow (QR scan endpoint)
    """
    import uuid
    
    # Calculate seeds used
    seeds_per_site = SEEDS_PER_SITE.get(crop_variety, 1)
    seeds_used = plant_site_count * seeds_per_site
    
    # Calculate grow media
    grow_media_kg = TRAY_MEDIA_REQUIREMENTS.get(tray_format, 1.0)
    
    # Create usage event
    event = TrayUsageEvent(
        event_id=f"TRAY-USE-{uuid.uuid4().hex[:8].upper()}",
        tray_id=tray_id,
        tray_format=tray_format,
        plant_site_count=plant_site_count,
        crop_variety=crop_variety,
        seed_date=seed_date or datetime.now().isoformat(),
        seeds_used=seeds_used,
        grow_media_kg=grow_media_kg,
        recorded_at=datetime.now().isoformat()
    )
    
    # Store event
    tray_usage_events.append(event)
    
    # TODO: Deduct from seed inventory
    # TODO: Deduct from grow media supply
    
    return {
        "ok": True,
        "event": event,
        "calculation": {
            "seeds_per_site": seeds_per_site,
            "total_seeds": seeds_used,
            "grow_media_kg": grow_media_kg,
            "tray_format": tray_format
        }
    }

@router.get("/usage/weekly-summary")
async def get_weekly_usage_summary(days: int = 7):
    """Get usage summary for the last N days"""
    
    cutoff = datetime.now() - timedelta(days=days)
    
    # Filter recent tray events
    recent_trays = [
        event for event in tray_usage_events
        if datetime.fromisoformat(event.seed_date) >= cutoff
    ]
    
    # Filter recent nutrient events
    recent_nutrients = [
        event for event in nutrient_usage_events
        if datetime.fromisoformat(event.timestamp) >= cutoff
    ]
    
    # Aggregate seed usage by variety
    seeds_by_variety = {}
    for event in recent_trays:
        variety = event.crop_variety
        seeds_by_variety[variety] = seeds_by_variety.get(variety, 0) + event.seeds_used
    
    # Aggregate nutrient usage by type
    nutrients_by_type = {}
    for event in recent_nutrients:
        nutrient_type = event.nutrient_type
        nutrients_by_type[nutrient_type] = nutrients_by_type.get(nutrient_type, 0) + event.volume_ml
    
    # Total grow media
    total_media = sum(event.grow_media_kg for event in recent_trays)
    
    return {
        "ok": True,
        "period": {
            "start": cutoff.isoformat(),
            "end": datetime.now().isoformat(),
            "days": days
        },
        "summary": {
            "trays_seeded": len(recent_trays),
            "seeds_used": seeds_by_variety,
            "grow_media_kg": round(total_media, 2),
            "nutrients_used_ml": nutrients_by_type
        }
    }

@router.get("/usage/tray-events")
async def get_tray_usage_events(limit: int = 50):
    """Get recent tray seeding events"""
    
    # Sort by recorded_at descending
    sorted_events = sorted(
        tray_usage_events,
        key=lambda e: e.recorded_at,
        reverse=True
    )
    
    return {
        "ok": True,
        "events": sorted_events[:limit],
        "total_count": len(tray_usage_events)
    }

# ============================================================================
# NUTRIENT USAGE TRACKING
# ============================================================================

@router.post("/usage/nutrient-dosing")
async def record_nutrient_dosing(
    pump: str,
    volume_ml: float,
    timestamp: Optional[str] = None
):
    """
    Record nutrient usage from MQTT dosing event
    Called by MQTT subscriber when ESP32 doses nutrients
    """
    import uuid
    
    # Map pump names to nutrient types
    PUMP_TO_NUTRIENT = {
        "nutrientA": "base_a",
        "nutrientB": "base_b",
        "phUp": "ph_up",
        "phDown": "ph_down"
    }
    
    nutrient_type = PUMP_TO_NUTRIENT.get(pump, pump)
    
    # Calculate concentrate used (if diluted 1:100)
    # Most concentrates are 1:100 ratio
    concentrate_ml = volume_ml / 100.0
    
    # Create usage event
    event = NutrientUsageEvent(
        event_id=f"NUT-USE-{uuid.uuid4().hex[:8].upper()}",
        nutrient_type=nutrient_type,
        volume_ml=volume_ml,
        concentrate_used_ml=concentrate_ml,
        timestamp=timestamp or datetime.now().isoformat(),
        source="mqtt_dosing"
    )
    
    # Store event
    nutrient_usage_events.append(event)
    
    # TODO: Deduct from nutrient inventory
    
    return {
        "ok": True,
        "event": event,
        "calculation": {
            "diluted_volume_ml": volume_ml,
            "concentrate_used_ml": concentrate_ml,
            "concentration_ratio": "1:100"
        }
    }

@router.get("/usage/nutrient-events")
async def get_nutrient_usage_events(limit: int = 100):
    """Get recent nutrient dosing events"""
    
    sorted_events = sorted(
        nutrient_usage_events,
        key=lambda e: e.timestamp,
        reverse=True
    )
    
    return {
        "ok": True,
        "events": sorted_events[:limit],
        "total_count": len(nutrient_usage_events)
    }

# ============================================================================
# INTEGRATION HELPERS
# ============================================================================

@router.get("/usage/dashboard")
async def get_usage_dashboard():
    """
    Combined dashboard showing all automated tracking
    Used by Farm Supplies & Operations frontend
    """
    
    # Get last 7 days summary
    summary_7d = await get_weekly_usage_summary(7)
    
    # Get last 30 days for projections
    summary_30d = await get_weekly_usage_summary(30)
    
    # Calculate daily averages for projections
    trays_per_day = summary_30d["summary"]["trays_seeded"] / 30
    
    # Project 30-day needs based on current usage
    projected_seeds = {}
    for variety, count in summary_30d["summary"]["seeds_used"].items():
        projected_seeds[variety] = int(count)
    
    projected_media = summary_30d["summary"]["grow_media_kg"]
    
    return {
        "ok": True,
        "last_7_days": summary_7d["summary"],
        "last_30_days": summary_30d["summary"],
        "projections": {
            "trays_per_day": round(trays_per_day, 1),
            "seeds_needed_30d": projected_seeds,
            "media_needed_30d_kg": round(projected_media, 1)
        },
        "recent_activity": {
            "latest_tray": tray_usage_events[-1] if tray_usage_events else None,
            "latest_nutrient": nutrient_usage_events[-1] if nutrient_usage_events else None
        }
    }
